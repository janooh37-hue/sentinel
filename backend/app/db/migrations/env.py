"""Alembic environment.

Resolves the database URL from :mod:`app.config` (so the same source of truth
governs the running app and migrations) and registers ``Base.metadata`` for
autogenerate. The CLI is invoked from the project root, where ``alembic.ini``
lives; ``prepend_sys_path = backend`` in that file makes ``app`` importable.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Importing models registers every table on Base.metadata.
from app.config import get_settings
from app.db import models  # noqa: F401  (side-effect import populates metadata)
from app.db.base import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _resolved_url() -> str:
    settings = get_settings()
    return f"sqlite:///{str(settings.db_path).replace(chr(92), '/')}"


# Honour, in order: ``-x url=...`` from the CLI, any URL the caller already
# set via ``Config.set_main_option`` (tests do this), then fall back to
# ``app.config`` so prod migrations mirror the running application.
_PLACEHOLDER = "sqlite:///placeholder.db"
_explicit = (
    context.get_x_argument(as_dictionary=True).get("url")
    or (
        config.get_main_option("sqlalchemy.url")
        if config.get_main_option("sqlalchemy.url") != _PLACEHOLDER
        else None
    )
)
config.set_main_option("sqlalchemy.url", _explicit or _resolved_url())

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Emit SQL to stdout without connecting to a database."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live engine — the default path."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
