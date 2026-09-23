"""Word's save stamp must not wait for a whole workforce scheduler run."""

from __future__ import annotations

from threading import Event, Thread
from types import SimpleNamespace

from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, insert, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import BookEditSession
from app.services import scheduler_service, word_session_repo


def test_occurrence_job_releases_writer_between_employees(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'scheduler.db'}", connect_args={"timeout": 0.2})
    metadata = MetaData()
    crews = Table("crews", metadata, Column("crew_id", Integer, primary_key=True))
    members = Table("members", metadata, Column("employee_id", String, primary_key=True))
    marker = Table(
        "marker", metadata, Column("id", Integer, primary_key=True), Column("value", Integer)
    )
    metadata.create_all(engine)
    BookEditSession.__table__.create(engine)
    with engine.begin() as connection:
        connection.execute(insert(crews).values(crew_id=1))
        connection.execute(insert(members), [{"employee_id": "a"}, {"employee_id": "b"}])
        connection.execute(insert(marker).values(id=1, value=0))
        connection.execute(
            insert(BookEditSession.__table__).values(
                id=1, book_id=1, user_id=1, token="test", working_path="test.docx"
            )
        )

    monkeypatch.setattr(scheduler_service, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(
        scheduler_service, "WorkCrewSchedule", SimpleNamespace(crew_id=crews.c.crew_id)
    )
    monkeypatch.setattr(
        scheduler_service, "WorkCrewMembership", SimpleNamespace(employee_id=members.c.employee_id)
    )
    monkeypatch.setattr(
        scheduler_service,
        "_load_workforce_configuration",
        lambda session: SimpleNamespace(evaluation_start_at=None),
    )
    monkeypatch.setattr(
        scheduler_service.attendance_evaluation_service,
        "materialize_scheduled_cases",
        lambda *args, **kwargs: [],
    )

    waiting = Event()
    resume = Event()
    errors: list[Exception] = []

    def generate(session: Session, **kwargs):
        session.execute(text("UPDATE marker SET value = value + 1 WHERE id = 1"))
        return []

    def reconcile(session: Session, *, employee_id: str, **kwargs):
        if employee_id == "b":
            waiting.set()
            assert resume.wait(5)
        session.execute(text("UPDATE marker SET value = value + 1 WHERE id = 1"))

    monkeypatch.setattr(
        scheduler_service.workforce_schedule_service, "generate_occurrences", generate
    )
    monkeypatch.setattr(
        scheduler_service.workforce_schedule_service, "reconcile_duty_crew_membership", reconcile
    )

    def run_job():
        try:
            scheduler_service._run_workforce_occurrence_generation()
        except Exception as exc:
            errors.append(exc)

    thread = Thread(target=run_job)
    thread.start()
    try:
        assert waiting.wait(5)
        with Session(engine) as session:
            word_session_repo.record_put(session, 1)
    finally:
        resume.set()
        thread.join(timeout=5)
    assert not thread.is_alive()
    assert not errors
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT value FROM marker WHERE id = 1")) == 3
        assert connection.scalar(text("SELECT last_put_at FROM book_edit_sessions WHERE id = 1"))
    engine.dispose()
