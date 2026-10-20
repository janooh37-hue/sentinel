"""Process confinement for native PDF work (PyMuPDF / MuPDF).

MuPDF keeps global state and is not safe to run from several threads of one process, and a
native fault (segfault, OOM, runaway page) takes the whole API process with it. Every PyMuPDF
entrypoint reachable from API routes therefore runs in a dedicated *worker process*; the API
process only does pipe I/O (which releases the GIL) and plain file/DB work.

Design
------
* ``spawn`` always (``MP_CONTEXT``): identical on Windows and POSIX, never a fork of a threaded
  process that holds SQLite/Word state. The child entry is ``pdf_child.worker_main``.
* Two lazily started pools, ``calls`` (short request/response ops) and ``streams`` (raster
  streams, whose worker stays leased while the consumer OCRs a page). A long OCR therefore
  cannot starve a short call.
* A job *leases one worker exclusively*. Its execution deadline starts at the lease, never at
  submission; waiting for a worker has its own bounded ``lease_timeout`` and ends in
  ``NativeWorkerBusyError`` WITHOUT touching anybody's worker. A timeout, cancel or crash kills
  and replaces only the leased worker, so one job can never reap a sibling.
* No automatic retry: a failed job raises, the caller decides. (A worker found dead while idle is
  replaced before the job is sent; that is not a retry.)
* Workers are started lazily: on a pool's first use, or to replace one that died or was killed.
  Nothing is spawned at import or startup. After a lull a pool keeps its last healthy idle worker
  warm, so the first hot job after it does not pay a spawn; only *surplus* idle workers older
  than ``IDLE_RETIRE_SECONDS`` retire (lazily, at the next lease). Capacity stays bounded by
  ``max_workers``, and ``shutdown()`` still removes every worker.
* Streams are credit-based with a window of one item: the child produces the next page only
  when the parent asks for it, so a consumer that stops early (``close()``, ``islice``, GC)
  leaves at most the pages it actually took rendered.
* Infrastructure failures are ``NativeWorkerError`` (an ``AppError``, HTTP 503) and are
  deliberately NOT ``RuntimeError``/``ValueError``/``OSError``, so no file-validation ``except``
  mistakes a dead worker for a bad upload. An exception the *op* raised crosses as itself, or as
  ``NativeOpError`` when it cannot be pickled (MuPDF's SWIG ``FzError*`` family).
* There is no inline/in-process mode and no environment switch: the worker is the only place
  these ops run.
"""

from __future__ import annotations

import atexit
import contextlib
import logging
import multiprocessing
import pickle
import threading
import time
from collections import deque
from dataclasses import dataclass
from multiprocessing.connection import Connection
from multiprocessing.process import BaseProcess
from types import TracebackType
from typing import Any, Final

from app.api.errors import AppError
from app.core import pdf_child

log = logging.getLogger(__name__)

START_METHOD: Final = "spawn"
# The literal selects typeshed's ``SpawnContext`` overload (the only one that declares ``Process``).
MP_CONTEXT = multiprocessing.get_context("spawn")

# The child entry point; module-level and importable by reference, so spawn can unpickle it.
_worker_main = pdf_child.worker_main

# Execution budgets (seconds). Counted from the moment a worker is leased, never from submission.
CALL_TIMEOUT_SECONDS = 120.0
STEP_TIMEOUT_SECONDS = 120.0
# Bounded wait for a free worker before giving up (no kill, no side effect).
CALL_LEASE_TIMEOUT_SECONDS = 60.0
STREAM_LEASE_TIMEOUT_SECONDS = 900.0  # streams are held across OCR time; this is a queue, not a run
STARTUP_TIMEOUT_SECONDS = 60.0  # spawn + imports, budgeted separately from any job
CLOSE_GRACE_SECONDS = 5.0  # a stream's polite ``close`` before its worker is killed
REAP_SECONDS = 5.0
# Idle workers older than this retire lazily at the next lease, except the last healthy one.
IDLE_RETIRE_SECONDS = 120.0
CALL_POOL_WORKERS = 3
STREAM_POOL_WORKERS = 3
JOB_HISTORY = 256


class NativeWorkerError(AppError):
    """The confined worker could not complete a job (infrastructure, not the caller's file)."""

    default_code = "PDF_WORKER_UNAVAILABLE"
    default_message = "PDF processing is temporarily unavailable. Please try again."

    def __init__(self, message: str | None = None, **details: Any) -> None:
        super().__init__(
            self.default_code,
            message or self.default_message,
            http_status=503,
            details=details or None,
        )


class NativeWorkerTimeoutError(NativeWorkerError):
    default_code = "PDF_WORKER_TIMEOUT"
    default_message = "PDF processing took too long and was stopped. Please try again."


class NativeWorkerCrashedError(NativeWorkerError):
    default_code = "PDF_WORKER_FAILED"
    default_message = "PDF processing failed unexpectedly. Please try again."


class NativeWorkerCancelledError(NativeWorkerError):
    default_code = "PDF_WORKER_CANCELLED"
    default_message = "PDF processing was cancelled."


class NativeWorkerBusyError(NativeWorkerError):
    default_code = "PDF_WORKER_BUSY"
    default_message = "PDF processing is busy. Please try again shortly."


class NativeOpError(Exception):
    """An op raised an exception that cannot be pickled across the process boundary.

    Behaves like the original un-picklable MuPDF error did in-process: an ordinary
    ``Exception`` (not a ``RuntimeError``), so ``except Exception`` sites treat it as before.
    """

    def __init__(self, type_name: str, message: str) -> None:
        super().__init__(f"{type_name}: {message}")
        self.type_name = type_name


class _RemoteTraceback(Exception):
    """Carries the worker-side traceback text as ``__cause__`` of a re-raised exception."""

    def __init__(self, text: str) -> None:
        super().__init__(text)
        self.text = text

    def __str__(self) -> str:
        return f"\n{self.text}"


@dataclass(frozen=True, slots=True)
class JobRecord:
    pool: str
    op: str
    pid: int
    outcome: str  # ok | error | closed | timeout | cancelled | crashed | aborted
    items: int
    run_ms: float


@dataclass(frozen=True, slots=True)
class PoolSnapshot:
    idle_pids: tuple[int, ...]  # in lease order: the first one is leased next
    leased_pids: tuple[int, ...]


def _remote_exception(payload: tuple[Any, ...]) -> BaseException:
    """Rebuild the exception an op raised from a ``("err", *payload)`` reply."""
    if payload[0] == "pickled":
        try:
            rebuilt: BaseException = pickle.loads(payload[1])
        except Exception as exc:  # cannot happen: the child proved the round trip
            rebuilt = NativeOpError("<unloadable>", str(exc))
        trace = str(payload[2])
    else:
        rebuilt = NativeOpError(str(payload[1]), str(payload[2]))
        trace = str(payload[3])
    rebuilt.__cause__ = _RemoteTraceback(trace)
    return rebuilt


class _Worker:
    """One spawned worker process and its pipe. Owned by exactly one lease at a time."""

    def __init__(self, process: BaseProcess, conn: Connection) -> None:
        self.process = process
        self.conn = conn
        self.pid: int = process.pid if process.pid is not None else -1
        self.kill_reason: str | None = None
        self.idle_since = time.monotonic()
        self._lock = threading.Lock()
        self._disposed = False

    @property
    def alive(self) -> bool:
        if self.kill_reason is not None or self._disposed:
            return False
        try:
            return self.process.is_alive()
        except ValueError:  # process object already closed
            return False

    def kill(self, reason: str) -> None:
        """Thread-safe and idempotent; never closes the pipe (only the lease owner does)."""
        with self._lock:
            if self.kill_reason is None:
                self.kill_reason = reason
            disposed = self._disposed
        if not disposed:
            with contextlib.suppress(Exception):
                self.process.kill()

    def dispose(self) -> None:
        """Kill if still running, reap, close handles. Lease owner or pool only."""
        with self._lock:
            if self._disposed:
                return
            self._disposed = True
            if self.kill_reason is None:
                self.kill_reason = "disposed"
        with contextlib.suppress(Exception):
            self.process.kill()
        with contextlib.suppress(Exception):
            self.conn.close()
        with contextlib.suppress(Exception):
            self.process.join(REAP_SECONDS)
        with contextlib.suppress(Exception):
            self.process.close()

    def failure(self, op: str) -> NativeWorkerError:
        """Classify why the pipe broke during ``op``."""
        reason = self.kill_reason
        if reason == "timeout":
            return NativeWorkerTimeoutError(op=op)
        if reason in {"cancelled", "shutdown"}:
            return NativeWorkerCancelledError(op=op)
        self.kill("crashed")
        exitcode: int | None = None
        with contextlib.suppress(Exception):
            self.process.join(1.0)
            exitcode = self.process.exitcode
        return NativeWorkerCrashedError(op=op, exitcode=exitcode)


class _Deadline:
    """Kills the leased worker if the guarded step outlives its budget.

    The thread that owns the lease is blocked in ``send``/``recv``; the kill makes that call
    fail with EOF/BrokenPipe, and ``_Worker.failure`` then reports a timeout. A step that
    finishes in time cancels the timer, so a fast job never leaves a timer behind.
    """

    def __init__(self, worker: _Worker, seconds: float) -> None:
        self._timer = threading.Timer(seconds, worker.kill, args=("timeout",))
        self._timer.daemon = True

    def __enter__(self) -> None:
        self._timer.start()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self._timer.cancel()


def _outcome_of(error: NativeWorkerError) -> str:
    if isinstance(error, NativeWorkerTimeoutError):
        return "timeout"
    if isinstance(error, NativeWorkerCancelledError):
        return "cancelled"
    return "crashed"


def _spawn_worker(name: str, startup_timeout: float) -> _Worker:
    """Start one worker and wait for its ``ready`` handshake (budgeted apart from any job)."""
    parent_conn, child_conn = MP_CONTEXT.Pipe(duplex=True)
    process = MP_CONTEXT.Process(
        target=_worker_main,
        args=(child_conn,),
        name=f"gssg-pdf-{name}",
        daemon=True,  # never outlives the interpreter that started it
    )
    try:
        process.start()
    except Exception as exc:
        parent_conn.close()
        child_conn.close()
        raise NativeWorkerCrashedError("PDF worker could not be started", pool=name) from exc
    finally:
        # Only the child may hold its end: when it dies (or we die) the pipe reports EOF.
        with contextlib.suppress(Exception):
            child_conn.close()
    worker = _Worker(process, parent_conn)
    try:
        if not parent_conn.poll(startup_timeout):
            worker.kill("timeout")
            raise NativeWorkerTimeoutError("PDF worker did not start in time", pool=name)
        hello = parent_conn.recv()
    except (EOFError, OSError) as exc:
        worker.dispose()
        raise NativeWorkerCrashedError("PDF worker exited during startup", pool=name) from exc
    except BaseException:
        worker.dispose()
        raise
    if hello[0] != "ready":
        worker.dispose()
        raise NativeWorkerCrashedError(
            "PDF worker failed to initialise", pool=name
        ) from _remote_exception(hello[1:])
    log.info("native_pdf_worker_started", extra={"pool": name, "worker_pid": worker.pid})
    return worker


class Stream:
    """Pull-based view of a streaming op (one item per ``next``), holding one leased worker.

    ``close()`` is idempotent, safe after any failure, and never raises for a worker that is
    already gone. ``cancel()`` may be called from any thread: it kills only this stream's
    worker, and the consumer blocked in ``next`` then raises ``NativeWorkerCancelledError``.
    """

    def __init__(self, pool: WorkerPool, worker: _Worker, op: str, step_timeout: float) -> None:
        self._pool = pool
        self._worker = worker
        self._op = op
        self._step_timeout = step_timeout
        self._started = time.monotonic()
        self._state = threading.Lock()
        self._finished = False
        self.pid = worker.pid
        self.received = 0  # items handed to the consumer
        self.produced: int | None = None  # items the child says it produced (set on end/close)

    def __iter__(self) -> Stream:
        return self

    def _start(self, args: tuple[object, ...]) -> None:
        try:
            with _Deadline(self._worker, self._step_timeout):
                self._worker.conn.send(("stream", self._op, args))
        except (EOFError, OSError):
            raise self._fail() from None
        except BaseException:
            self._finish(reusable=False, outcome="aborted")
            raise

    def __next__(self) -> tuple[Any, bytearray]:
        if self._finished:
            raise StopIteration
        conn = self._worker.conn
        try:
            with _Deadline(self._worker, self._step_timeout):
                conn.send(("next",))
                reply = conn.recv()
                blob = bytearray(0)
                if reply[0] == "item":
                    blob = bytearray(reply[2])
                    conn.recv_bytes_into(blob)
        except (EOFError, OSError):
            raise self._fail() from None
        except BaseException:
            self._finish(reusable=False, outcome="aborted")
            raise
        tag = reply[0]
        if tag == "item":
            self.received += 1
            return reply[1], blob
        if tag == "end":
            self.produced = int(reply[1])
            self._finish(reusable=True, outcome="ok")
            raise StopIteration
        if tag == "err":
            self._finish(reusable=True, outcome="error")
            raise _remote_exception(reply[1:])
        self._finish(reusable=False, outcome="crashed")
        raise NativeWorkerCrashedError("PDF worker sent an unexpected reply", op=self._op)

    def _fail(self) -> NativeWorkerError:
        error = self._worker.failure(self._op)
        self._finish(reusable=False, outcome=_outcome_of(error))
        return error

    def _finish(self, *, reusable: bool, outcome: str) -> None:
        with self._state:
            if self._finished:
                return
            self._finished = True
        self._pool._release(self._worker, reusable=reusable)
        self._pool._record(self._op, self._worker.pid, outcome, self.received, self._started)

    def close(self) -> None:
        """Stop the stream. A clean close leaves the worker idle and reusable."""
        if self._finished:
            return
        worker = self._worker
        try:
            with _Deadline(worker, CLOSE_GRACE_SECONDS):
                worker.conn.send(("close",))
                reply = worker.conn.recv()
        except (EOFError, OSError):
            error = worker.failure(self._op)
            self._finish(reusable=False, outcome=_outcome_of(error))
            return
        except BaseException:
            self._finish(reusable=False, outcome="aborted")
            raise
        if reply[0] == "closed":
            self.produced = int(reply[1])
            self._finish(reusable=True, outcome="closed")
        else:
            self._finish(reusable=False, outcome="crashed")

    def cancel(self) -> None:
        """Kill this stream's worker (any thread). Siblings are untouched."""
        with self._state:
            if self._finished:
                return
            self._worker.kill("cancelled")


class WorkerPool:
    """A bounded set of lazily spawned workers, leased exclusively one job at a time.

    A worker is started on the pool's first use or to replace one that died or was killed.
    Idle ones retire lazily at the next lease once older than ``idle_retire``, but the last
    healthy idle worker is kept warm (see ``_drop_idle``); nothing is ever started eagerly.
    """

    def __init__(
        self,
        name: str,
        *,
        max_workers: int,
        lease_timeout: float = CALL_LEASE_TIMEOUT_SECONDS,
        call_timeout: float = CALL_TIMEOUT_SECONDS,
        step_timeout: float = STEP_TIMEOUT_SECONDS,
        startup_timeout: float = STARTUP_TIMEOUT_SECONDS,
        idle_retire: float = IDLE_RETIRE_SECONDS,
    ) -> None:
        if max_workers < 1:
            raise ValueError("max_workers must be at least 1")
        self.name = name
        self.max_workers = max_workers
        self.lease_timeout = lease_timeout
        self.call_timeout = call_timeout
        self.step_timeout = step_timeout
        self.startup_timeout = startup_timeout
        self.idle_retire = idle_retire
        self.jobs: deque[JobRecord] = deque(maxlen=JOB_HISTORY)
        self._cond = threading.Condition()
        self._idle: list[_Worker] = []  # a stack: the last released is leased first
        self._leased: set[_Worker] = set()
        self._starting = 0
        self._closed = False

    # -- leasing -------------------------------------------------------------------------

    def _drop_idle(self, now: float) -> list[_Worker]:
        """Remove dead and surplus-stale idle workers and return them for disposal.

        The caller holds ``_cond``. A dead worker is never kept. A healthy idle worker older
        than ``idle_retire`` retires only while another healthy idle worker remains: when none
        is fresh, the most recently idle one is kept as the pool's warm floor, so the first job
        after a lull is served by a live process instead of paying a spawn. Leased workers are
        not idle and never count toward the floor.
        """
        healthy: list[_Worker] = []
        dropped: list[_Worker] = []
        for candidate in self._idle:
            if candidate.alive:
                healthy.append(candidate)
            else:
                dropped.append(candidate)
        keep = [worker for worker in healthy if now - worker.idle_since <= self.idle_retire]
        if not keep and healthy:
            keep = [healthy[-1]]  # the stack top: the most recently idle healthy worker
        dropped.extend(worker for worker in healthy if worker not in keep)
        self._idle = keep
        return dropped

    def _lease(self) -> _Worker:
        deadline = time.monotonic() + self.lease_timeout
        doomed: list[_Worker] = []
        try:
            with self._cond:
                while True:
                    if self._closed:
                        raise NativeWorkerCancelledError(
                            "PDF worker pool is shut down", pool=self.name
                        )
                    now = time.monotonic()
                    doomed.extend(self._drop_idle(now))
                    if self._idle:
                        worker = self._idle.pop()
                        self._leased.add(worker)
                        return worker
                    if len(self._leased) + self._starting < self.max_workers:
                        self._starting += 1
                        break
                    remaining = deadline - now
                    if remaining <= 0:
                        raise NativeWorkerBusyError(
                            "No PDF worker became free in time", pool=self.name
                        )
                    self._cond.wait(remaining)
        finally:
            for stale in doomed:
                stale.dispose()
        return self._finish_spawn(leased=True)

    def _finish_spawn(self, *, leased: bool) -> _Worker:
        """Spawn the worker whose slot ``_starting`` already reserved."""
        try:
            worker = _spawn_worker(self.name, self.startup_timeout)
        except BaseException:
            with self._cond:
                self._starting -= 1
                self._cond.notify()
            raise
        with self._cond:
            self._starting -= 1
            closed = self._closed
            if not closed:
                if leased:
                    self._leased.add(worker)
                else:
                    worker.idle_since = time.monotonic()
                    self._idle.append(worker)
                    self._cond.notify()
        if closed:
            worker.dispose()
            raise NativeWorkerCancelledError("PDF worker pool is shut down", pool=self.name)
        return worker

    def _release(self, worker: _Worker, *, reusable: bool) -> None:
        keep = reusable and worker.alive
        with self._cond:
            self._leased.discard(worker)
            keep = keep and not self._closed
            if keep:
                worker.idle_since = time.monotonic()
                self._idle.append(worker)
            self._cond.notify()
        if not keep:
            worker.dispose()

    def _record(self, op: str, pid: int, outcome: str, items: int, started: float) -> None:
        run_ms = round((time.monotonic() - started) * 1000, 1)
        self.jobs.append(JobRecord(self.name, op, pid, outcome, items, run_ms))
        level = logging.INFO if outcome in {"ok", "error", "closed"} else logging.WARNING
        log.log(
            level,
            "native_pdf_op",
            extra={
                "pool": self.name,
                "op": op,
                "worker_pid": pid,
                "outcome": outcome,
                "items": items,
                "run_ms": run_ms,
            },
        )

    # -- jobs ----------------------------------------------------------------------------

    def call(self, op: str, *args: object, timeout: float | None = None) -> Any:
        """Run ``op`` in a leased worker and return its result (or raise what it raised)."""
        worker = self._lease()
        started = time.monotonic()
        budget = self.call_timeout if timeout is None else timeout
        reusable = False
        outcome = "aborted"
        try:
            try:
                with _Deadline(worker, budget):
                    worker.conn.send(("call", op, args))
                    reply = worker.conn.recv()
            except (EOFError, OSError):
                error = worker.failure(op)
                outcome = _outcome_of(error)
                raise error from None
            if reply[0] == "ok":
                reusable = True
                outcome = "ok"
                return reply[1]
            if reply[0] == "err":
                reusable = True
                outcome = "error"
                raise _remote_exception(reply[1:])
            outcome = "crashed"
            raise NativeWorkerCrashedError("PDF worker sent an unexpected reply", op=op)
        finally:
            self._release(worker, reusable=reusable)
            self._record(op, worker.pid, outcome, 0, started)

    def open_stream(self, op: str, *args: object, step_timeout: float | None = None) -> Stream:
        """Lease a worker and arm the streaming ``op``; items are pulled with ``next``."""
        worker = self._lease()
        stream = Stream(
            self, worker, op, self.step_timeout if step_timeout is None else step_timeout
        )
        stream._start(args)
        return stream

    # -- lifecycle / diagnostics ---------------------------------------------------------

    def warm(self, count: int = 1) -> None:
        """Start workers until ``count`` live ones exist (capped at ``max_workers``)."""
        target = min(count, self.max_workers)
        while True:
            with self._cond:
                if self._closed:
                    raise NativeWorkerCancelledError("PDF worker pool is shut down", pool=self.name)
                if len(self._idle) + len(self._leased) + self._starting >= target:
                    return
                self._starting += 1
            self._finish_spawn(leased=False)

    def snapshot(self) -> PoolSnapshot:
        with self._cond:
            return PoolSnapshot(
                idle_pids=tuple(worker.pid for worker in reversed(self._idle)),
                leased_pids=tuple(sorted(worker.pid for worker in self._leased)),
            )

    def shutdown(self) -> None:
        """Permanently close this pool: kill idle workers now and leased ones under their owners.

        Idempotent. In-flight jobs fail with ``NativeWorkerCancelledError``; their owners reap
        the dead worker when they release it.
        """
        with self._cond:
            self._closed = True
            idle, self._idle = self._idle, []
            leased = list(self._leased)
            self._cond.notify_all()
        for worker in leased:
            worker.kill("shutdown")
        for worker in idle:
            worker.dispose()


# -- module-level pools --------------------------------------------------------------------

_pools: dict[str, WorkerPool] = {}
_pools_lock = threading.Lock()


def _new_pool(name: str) -> WorkerPool:
    if name == "calls":
        return WorkerPool(
            name,
            max_workers=CALL_POOL_WORKERS,
            lease_timeout=CALL_LEASE_TIMEOUT_SECONDS,
            call_timeout=CALL_TIMEOUT_SECONDS,
            step_timeout=STEP_TIMEOUT_SECONDS,
            startup_timeout=STARTUP_TIMEOUT_SECONDS,
            idle_retire=IDLE_RETIRE_SECONDS,
        )
    if name == "streams":
        return WorkerPool(
            name,
            max_workers=STREAM_POOL_WORKERS,
            lease_timeout=STREAM_LEASE_TIMEOUT_SECONDS,
            call_timeout=CALL_TIMEOUT_SECONDS,
            step_timeout=STEP_TIMEOUT_SECONDS,
            startup_timeout=STARTUP_TIMEOUT_SECONDS,
            idle_retire=IDLE_RETIRE_SECONDS,
        )
    raise ValueError(f"unknown PDF worker pool {name!r}")


def get_pool(name: str) -> WorkerPool:
    """The module pool ``name`` (``"calls"`` or ``"streams"``), created on first use."""
    with _pools_lock:
        pool = _pools.get(name)
        if pool is None:
            pool = _pools[name] = _new_pool(name)
        return pool


def pools() -> dict[str, WorkerPool]:
    with _pools_lock:
        return dict(_pools)


def call(op: str, *args: object, timeout: float | None = None) -> Any:
    """Run a short op in the ``calls`` pool."""
    return get_pool("calls").call(op, *args, timeout=timeout)


def open_stream(op: str, *args: object, step_timeout: float | None = None) -> Stream:
    """Arm a streaming op in the ``streams`` pool."""
    return get_pool("streams").open_stream(op, *args, step_timeout=step_timeout)


def shutdown() -> None:
    """Stop every worker. Idempotent and reversible: the pools are rebuilt lazily on next use."""
    with _pools_lock:
        stopping = list(_pools.values())
        _pools.clear()
    for pool in stopping:
        pool.shutdown()


atexit.register(shutdown)
