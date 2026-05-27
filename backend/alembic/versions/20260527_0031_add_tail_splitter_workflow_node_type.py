"""add tail splitter workflow node enum value"""

from alembic import op

revision = "20260527_0031"
down_revision = "20260527_0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE workflownodetype ADD VALUE IF NOT EXISTS 'tail_splitter'")


def downgrade() -> None:
    # PostgreSQL enum values cannot be safely removed without rebuilding the type.
    # Keep downgrade as a no-op so existing workflow rows remain readable.
    pass
