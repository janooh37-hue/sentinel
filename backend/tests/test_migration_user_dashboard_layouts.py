from __future__ import annotations

import json
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[2]


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option(
        "script_location",
        str(ROOT / "backend" / "app" / "db" / "migrations"),
    )
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


def test_0079_copies_global_layout_to_every_user_and_is_reversible(tmp_path: Path) -> None:
    database = tmp_path / "user-dashboard-layouts.db"
    config = _config(database)
    command.upgrade(config, "0078")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    layout = {
        "widgets": [{"id": "pending", "visible": True, "order": 0, "zone": "top"}],
        "quick_actions": [],
        "canvas_width": "compact",
    }

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (email, password_hash, role, status) VALUES "
                "('one@x.ae', 'x', 'operator', 'active'), "
                "('two@x.ae', 'x', 'manager', 'active')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO app_settings (key, value, dashboard_layout) "
                "VALUES (:key, :value, :layout)"
            ),
            {
                "key": "settings.dashboard_layout",
                "value": json.dumps(None),
                "layout": json.dumps(layout),
            },
        )

    command.upgrade(config, "0079_user_dashboard_layouts")

    with engine.connect() as connection:
        tables = set(inspect(connection).get_table_names())
        assert "user_dashboard_layouts" in tables
        columns = {column["name"] for column in inspect(connection).get_columns("app_settings")}
        assert "dashboard_layout" not in columns
        copied = connection.execute(
            text("SELECT user_id, layout FROM user_dashboard_layouts ORDER BY user_id")
        ).all()
        assert len(copied) == 2
        assert [json.loads(row.layout) for row in copied] == [layout, layout]
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM app_settings WHERE key = 'settings.dashboard_layout'")
            ).scalar_one()
            == 0
        )

    command.downgrade(config, "0078")

    with engine.connect() as connection:
        assert "user_dashboard_layouts" not in inspect(connection).get_table_names()
        columns = {column["name"] for column in inspect(connection).get_columns("app_settings")}
        assert "dashboard_layout" in columns
