"""add canvas template entry modes"""

from alembic import op
import sqlalchemy as sa

revision = "20260529_0032"
down_revision = "20260527_0031"
branch_labels = None
depends_on = None

WORKFLOW_ENTRY_MODES = "'image', 'copy', 'tail', 'blank'"
TEMPLATE_ENTRY_MODES = "'image', 'copy', 'tail'"


def upgrade() -> None:
    with op.batch_alter_table("product_workflows") as batch_op:
        batch_op.add_column(
            sa.Column("initial_entry_mode", sa.String(length=20), nullable=False, server_default="image")
        )
        batch_op.create_check_constraint(
            "ck_product_workflows_initial_entry_mode",
            f"initial_entry_mode IN ({WORKFLOW_ENTRY_MODES})",
        )

    with op.batch_alter_table("canvas_templates") as batch_op:
        batch_op.add_column(sa.Column("entry_mode", sa.String(length=20), nullable=False, server_default="image"))
        batch_op.add_column(sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"))
        batch_op.create_check_constraint(
            "ck_canvas_templates_entry_mode",
            f"entry_mode IN ({TEMPLATE_ENTRY_MODES})",
        )

    op.create_index("ix_product_workflows_initial_entry_mode", "product_workflows", ["initial_entry_mode"])
    op.create_index("ix_canvas_templates_entry_mode", "canvas_templates", ["entry_mode"])
    op.create_index("ix_canvas_templates_sort_order", "canvas_templates", ["sort_order"])
    op.create_index(
        "ix_canvas_templates_scope_owner_entry_category_sort",
        "canvas_templates",
        ["scope", "owner_user_id", "entry_mode", "category_id", "sort_order"],
    )


def downgrade() -> None:
    op.drop_index("ix_canvas_templates_scope_owner_entry_category_sort", table_name="canvas_templates")
    op.drop_index("ix_canvas_templates_sort_order", table_name="canvas_templates")
    op.drop_index("ix_canvas_templates_entry_mode", table_name="canvas_templates")
    op.drop_index("ix_product_workflows_initial_entry_mode", table_name="product_workflows")

    with op.batch_alter_table("canvas_templates") as batch_op:
        batch_op.drop_constraint("ck_canvas_templates_entry_mode", type_="check")
        batch_op.drop_column("sort_order")
        batch_op.drop_column("entry_mode")

    with op.batch_alter_table("product_workflows") as batch_op:
        batch_op.drop_constraint("ck_product_workflows_initial_entry_mode", type_="check")
        batch_op.drop_column("initial_entry_mode")
