"""B5/P8 — the in-process job registry is bounded (no unbounded memory growth)."""

from app.services import job_registry


def test_registry_prunes_oldest_terminal_jobs_over_cap(monkeypatch):
    job_registry._jobs.clear()
    monkeypatch.setattr(job_registry, "_MAX_JOBS", 3)
    ids = []
    for _ in range(6):
        jid = job_registry.submit_job()
        job_registry.set_done(jid, submission_id="s", documents=[])
        ids.append(jid)
    assert len(job_registry._jobs) <= 3
    assert job_registry.get_job(ids[-1]) is not None  # newest survives
    assert job_registry.get_job(ids[0]) is None  # oldest evicted


def test_registry_never_evicts_in_flight_jobs(monkeypatch):
    job_registry._jobs.clear()
    monkeypatch.setattr(job_registry, "_MAX_JOBS", 2)
    running = [job_registry.submit_job() for _ in range(4)]
    for jid in running:
        job_registry.set_running(jid)
    # nothing terminal to evict → all four running jobs stay, even over cap
    assert all(job_registry.get_job(j) is not None for j in running)
