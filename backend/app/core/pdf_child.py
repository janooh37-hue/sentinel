"""Worker-process entry point for confined native PDF work (child side of ``pdf_worker``).

Stdlib only on purpose: a worker must never import FastAPI/SQLAlchemy, so it stays lean
(~56 MB) and its imports cannot touch application state. ``worker_main`` is a module-level
function taking one picklable ``Connection`` so ``multiprocessing``'s ``spawn`` start method
(the only one on Windows) can start it.

Wire protocol (every message is a tuple; ``Connection.send`` pickles it)::

    parent -> child
      ("call", op, args)    run ``OPS[op](*args)``       -> ("ok", result) | ("err", *payload)
      ("stream", op, args)  arm a generator op; no reply. Then, per page:
      ("next",)             advance the generator       -> ("item", meta, nbytes) + send_bytes(blob)
                                                         | ("end", produced) | ("err", *payload)
      ("close",)            stop the stream             -> ("closed", produced)
      ("stop",)             exit

    child -> parent at startup:  ("ready", pid) | ("startup_failed", *payload)

    payload = ("pickled", blob, traceback_text) | ("opaque", type_name, message, traceback_text)

A generator op runs only when the parent sends ``("next",)``, so the child never renders or
reads ahead of its consumer (credit window of one item).
"""

from __future__ import annotations

import contextlib
import os
import pickle
import signal
import traceback
from multiprocessing.connection import Connection
from typing import Any


def exception_payload(exc: BaseException) -> tuple[Any, ...]:
    """Describe ``exc`` for the parent.

    The exception itself is shipped only when it provably round-trips through pickle here
    (so the parent can never fail to rebuild it); anything else, e.g. MuPDF's SWIG-backed
    ``FzError*`` family, crosses as an opaque (type name, message) pair.
    """
    trace = "".join(traceback.format_exception(exc))
    try:
        blob = pickle.dumps(exc)
        pickle.loads(blob)
    except Exception:
        try:
            message = str(exc)
        except Exception:
            message = "<unprintable>"
        return ("opaque", f"{type(exc).__module__}.{type(exc).__qualname__}", message, trace)
    return ("pickled", blob, trace)


def _reply(conn: Connection, message: object) -> bool:
    """Send ``message``; ``False`` once the parent is gone."""
    try:
        conn.send(message)
    except (OSError, EOFError):
        return False
    return True


def _serve_call(conn: Connection, ops: dict[str, Any], request: tuple[Any, ...]) -> bool:
    _tag, name, args = request
    try:
        result = ops[name](*args)
    except Exception as exc:
        return _reply(conn, ("err", *exception_payload(exc)))
    try:
        conn.send(("ok", result))
    except (OSError, EOFError):
        return False
    except Exception as exc:  # result not picklable: nothing was written
        return _reply(conn, ("err", *exception_payload(exc)))
    return True


def _serve_stream(conn: Connection, ops: dict[str, Any], request: tuple[Any, ...]) -> bool:
    _tag, name, args = request
    generator: Any = None
    produced = 0
    try:
        while True:
            try:
                command = conn.recv()
            except (EOFError, OSError):
                return False
            tag = command[0]
            if tag == "close":
                return _reply(conn, ("closed", produced))
            if tag != "next":
                error = ValueError(f"unexpected stream command {tag!r}")
                return _reply(conn, ("err", *exception_payload(error)))
            try:
                if generator is None:
                    generator = ops[name](*args)
                meta, blob = next(generator)
            except StopIteration:
                return _reply(conn, ("end", produced))
            except Exception as exc:
                return _reply(conn, ("err", *exception_payload(exc)))
            produced += 1
            try:
                conn.send(("item", meta, len(blob)))
                conn.send_bytes(blob)
            except (OSError, EOFError):
                return False
            except Exception as exc:  # meta not picklable: nothing was written
                return _reply(conn, ("err", *exception_payload(exc)))
            del blob
    finally:
        if generator is not None:
            with contextlib.suppress(Exception):
                generator.close()


def worker_main(conn: Connection) -> None:
    """Serve requests until the parent says stop or disappears (EOF on the pipe)."""
    with contextlib.suppress(Exception):
        # Ctrl-C reaches the whole console process group; the parent owns shutdown.
        signal.signal(signal.SIGINT, signal.SIG_IGN)
    try:
        from app.core import pdf_ops

        ops: dict[str, Any] = pdf_ops.OPS
    except BaseException as exc:
        _reply(conn, ("startup_failed", *exception_payload(exc)))
        return
    if not _reply(conn, ("ready", os.getpid())):
        return
    while True:
        try:
            request = conn.recv()
        except (EOFError, OSError):
            return
        except Exception as exc:  # request could not be unpickled
            if not _reply(conn, ("err", *exception_payload(exc))):
                return
            continue
        tag = request[0]
        if tag == "call":
            alive = _serve_call(conn, ops, request)
        elif tag == "stream":
            alive = _serve_stream(conn, ops, request)
        elif tag == "stop":
            return
        else:
            alive = _reply(conn, ("err", *exception_payload(ValueError(f"bad request {tag!r}"))))
        if not alive:
            return
