"""Migration 0113: every book folder belongs to one desk box; existing ones go to Incoming."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0113_book_folder_box"
PARENT = "0112_ledger_book_importance"
FOLDER_INSERT = (
    "INSERT INTO book_folders (id, owner_user_id, name, created_by_user_id{columns}) "
    "VALUES ({id}, {owner}, '{name}', 7{values})"
)


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "backend/app/db/migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    return config


@pytest.fixture
def at_parent(tmp_path: Path) -> Iterator[tuple[Engine, Config]]:
    database = tmp_path / "book-folder-box.db"
    config = _config(database)
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database}")
    try:
        with engine.begin() as c:
            c.execute(text("PRAGMA foreign_keys = OFF"))
            c.execute(text(FOLDER_INSERT.format(id=1, owner=7, name="Mine", columns="", values="")))
            c.execute(
                text(FOLDER_INSERT.format(id=2, owner="NULL", name="Team", columns="", values=""))
            )
            c.execute(
                text("INSERT INTO book_folder_shares (folder_id, department) VALUES (2, 'Finance')")
            )
        yield engine, config
    finally:
        engine.dispose()


def _boxes(engine: Engine) -> list[tuple[int, str]]:
    with engine.connect() as c:
        return [
            tuple(row) for row in c.execute(text("SELECT id, box FROM book_folders ORDER BY id"))
        ]


def _insert(engine: Engine, folder_id: int, box: str) -> None:
    with engine.begin() as c:
        c.execute(text("PRAGMA foreign_keys = OFF"))
        c.execute(
            text(
                FOLDER_INSERT.format(
                    id=folder_id, owner=7, name="New", columns=", box", values=f", '{box}'"
                )
            )
        )


def test_single_head_follows_parent() -> None:
    script = ScriptDirectory.from_config(_config(ROOT / "unused.db"))
    assert script.get_heads() == [HEAD]
    assert script.get_revision(HEAD).down_revision == PARENT


def test_upgrade_puts_existing_folders_in_incoming_and_checks_the_box(
    at_parent: tuple[Engine, Config],
) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    assert _boxes(engine) == [(1, "incoming"), (2, "incoming")]
    column = {c["name"]: c for c in inspect(engine).get_columns("book_folders")}["box"]
    assert column["nullable"] is False
    for folder_id, box in enumerate(("outgoing", "done", "archived"), start=3):
        _insert(engine, folder_id, box)
    with pytest.raises(IntegrityError):
        _insert(engine, 9, "inbox")
    with engine.connect() as c:
        # The share survives the table rebuild.
        assert c.execute(text("SELECT folder_id FROM book_folder_shares")).scalars().all() == [2]


def test_downgrade_then_upgrade_round_trips(at_parent: tuple[Engine, Config]) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    _insert(engine, 3, "archived")
    command.downgrade(config, PARENT)
    assert "box" not in {c["name"] for c in inspect(engine).get_columns("book_folders")}
    with engine.connect() as c:
        assert c.execute(text("SELECT id FROM book_folders ORDER BY id")).scalars().all() == [
            1,
            2,
            3,
        ]
    command.upgrade(config, HEAD)
    assert _boxes(engine) == [(1, "incoming"), (2, "incoming"), (3, "incoming")]
