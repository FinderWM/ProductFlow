"""remove database business constraints

Revision ID: 20260603_0040
Revises: 20260603_0039
Create Date: 2026-06-03
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260603_0040"
down_revision = "20260603_0039"
branch_labels = None
depends_on = None


ENUM_COLUMNS: tuple[tuple[str, str, int], ...] = (
    ("copy_sets", "status", 9),
    ("image_session_assets", "kind", 16),
    ("image_session_generation_tasks", "status", 9),
    ("poster_variants", "kind", 12),
    ("source_assets", "kind", 23),
    ("workflow_nodes", "node_type", 16),
    ("workflow_nodes", "status", 9),
    ("workflow_node_runs", "status", 9),
    ("workflow_runs", "status", 20),
)
POSTGRES_ENUM_TYPES = (
    "copystatus",
    "imagesessionassetkind",
    "jobkind",
    "jobstatus",
    "posterkind",
    "sourceassetkind",
    "workflownodestatus",
    "workflownodetype",
    "workflowrunstatus",
)
POSTGRES_PARTIAL_UNIQUE_INDEXES: tuple[tuple[str, str, tuple[str, ...], sa.TextClause], ...] = (
    (
        "uq_source_assets_one_original_per_product",
        "source_assets",
        ("product_id",),
        sa.text("kind = 'original_image'"),
    ),
    (
        "uq_workflow_node_runs_one_active_per_node",
        "workflow_node_runs",
        ("node_id",),
        sa.text("status IN ('queued', 'running')"),
    ),
)
SQLITE_NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        _drop_postgresql_partial_unique_indexes()
        _drop_postgresql_foreign_keys_and_checks(bind)
        _convert_postgresql_enum_columns()
        _create_postgresql_partial_unique_indexes()
        _drop_postgresql_enum_types()
        return
    if bind.dialect.name == "sqlite":
        _drop_sqlite_foreign_keys_and_checks(bind)


def downgrade() -> None:
    pass


def _drop_postgresql_foreign_keys_and_checks(bind: sa.engine.Connection) -> None:
    inspector = sa.inspect(bind)
    for table_name in inspector.get_table_names():
        for foreign_key in inspector.get_foreign_keys(table_name):
            constraint_name = foreign_key.get("name")
            if constraint_name:
                op.drop_constraint(constraint_name, table_name, type_="foreignkey")
        for check_constraint in inspector.get_check_constraints(table_name):
            constraint_name = check_constraint.get("name")
            if constraint_name:
                op.drop_constraint(constraint_name, table_name, type_="check")


def _drop_postgresql_partial_unique_indexes() -> None:
    for index_name, _, _, _ in POSTGRES_PARTIAL_UNIQUE_INDEXES:
        op.execute(sa.text(f'DROP INDEX IF EXISTS "{index_name}"'))


def _create_postgresql_partial_unique_indexes() -> None:
    for index_name, table_name, columns, predicate in POSTGRES_PARTIAL_UNIQUE_INDEXES:
        op.create_index(
            index_name,
            table_name,
            list(columns),
            unique=True,
            postgresql_where=predicate,
        )


def _convert_postgresql_enum_columns() -> None:
    for table_name, column_name, length in ENUM_COLUMNS:
        op.execute(
            sa.text(
                f'ALTER TABLE "{table_name}" '
                f'ALTER COLUMN "{column_name}" TYPE VARCHAR({length}) '
                f'USING "{column_name}"::text'
            )
        )


def _drop_postgresql_enum_types() -> None:
    for type_name in POSTGRES_ENUM_TYPES:
        op.execute(sa.text(f'DROP TYPE IF EXISTS "{type_name}"'))


def _drop_sqlite_foreign_keys_and_checks(bind: sa.engine.Connection) -> None:
    inspector = sa.inspect(bind)
    enum_columns_by_table: dict[str, list[tuple[str, int]]] = {}
    for table_name, column_name, length in ENUM_COLUMNS:
        enum_columns_by_table.setdefault(table_name, []).append((column_name, length))

    table_names = inspector.get_table_names()
    constraints_by_table = {
        table_name: (
            inspector.get_foreign_keys(table_name),
            inspector.get_check_constraints(table_name),
            enum_columns_by_table.get(table_name, []),
        )
        for table_name in table_names
    }

    op.execute("PRAGMA foreign_keys=OFF")
    for table_name in table_names:
        foreign_keys, check_constraints, enum_columns = constraints_by_table[table_name]
        if not foreign_keys and not check_constraints and not enum_columns:
            continue
        with op.batch_alter_table(
            table_name,
            naming_convention=SQLITE_NAMING_CONVENTION,
            recreate="always",
        ) as batch_op:
            for foreign_key in foreign_keys:
                constraint_name = foreign_key.get("name") or _sqlite_foreign_key_name(table_name, foreign_key)
                batch_op.drop_constraint(constraint_name, type_="foreignkey")
            for check_constraint in check_constraints:
                constraint_name = check_constraint.get("name")
                if constraint_name:
                    batch_op.drop_constraint(constraint_name, type_="check")
            for column_name, length in enum_columns:
                batch_op.alter_column(
                    column_name,
                    type_=sa.String(length=length),
                    existing_nullable=False,
                )


def _sqlite_foreign_key_name(table_name: str, foreign_key: dict[str, object]) -> str:
    constrained_columns = foreign_key.get("constrained_columns") or []
    referred_table = str(foreign_key.get("referred_table"))
    first_column = str(constrained_columns[0])
    return f"fk_{table_name}_{first_column}_{referred_table}"
