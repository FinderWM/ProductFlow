"""move template permission to settings menu"""

import sqlalchemy as sa

from alembic import op

revision = "20260530_0033"
down_revision = "20260529_0032"
branch_labels = None
depends_on = None


def _has_foreign_key(table_name: str, constraint_name: str) -> bool:
    return any(
        foreign_key.get("name") == constraint_name
        for foreign_key in sa.inspect(op.get_bind()).get_foreign_keys(table_name)
    )


def upgrade() -> None:
    op.execute(
        """
        UPDATE rbac_api_permissions
        SET menu_code = 'settings',
            sort_order = 50
        WHERE code = 'templates:manage_global'
        """
    )
    op.execute(
        """
        INSERT INTO role_api_permissions (role_id, permission_code)
        SELECT template_roles.role_id, 'settings:read'
        FROM role_api_permissions AS template_roles
        WHERE template_roles.permission_code = 'templates:manage_global'
          AND NOT EXISTS (
              SELECT 1
              FROM role_api_permissions AS existing_settings_read
              WHERE existing_settings_read.role_id = template_roles.role_id
                AND existing_settings_read.permission_code = 'settings:read'
          )
        """
    )
    op.execute(
        """
        INSERT INTO role_menu_permissions (role_id, menu_code)
        SELECT template_roles.role_id, 'settings'
        FROM role_api_permissions AS template_roles
        WHERE template_roles.permission_code = 'templates:manage_global'
          AND NOT EXISTS (
              SELECT 1
              FROM role_menu_permissions AS existing_settings_menu
              WHERE existing_settings_menu.role_id = template_roles.role_id
                AND existing_settings_menu.menu_code = 'settings'
          )
        """
    )
    op.execute(
        """
        DELETE FROM role_menu_permissions
        WHERE menu_code = 'rbac'
          AND role_id IN (
              SELECT role_id
              FROM role_api_permissions
              WHERE permission_code = 'templates:manage_global'
          )
          AND NOT EXISTS (
              SELECT 1
              FROM role_api_permissions AS rbac_permission
              WHERE rbac_permission.role_id = role_menu_permissions.role_id
                AND rbac_permission.permission_code IN ('rbac:manage', 'resources:moderate')
          )
        """
    )

    with op.batch_alter_table("canvas_templates") as batch_op:
        batch_op.add_column(sa.Column("review_status", sa.String(length=20), nullable=False, server_default="none"))
        batch_op.add_column(sa.Column("review_note", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("review_submitted_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("reviewed_by_user_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_canvas_templates_reviewed_by_user_id",
            "auth_users",
            ["reviewed_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_canvas_templates_review_status", "canvas_templates", ["review_status"])

    with op.batch_alter_table("products") as batch_op:
        batch_op.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("deleted_by_user_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_products_deleted_by_user_id",
            "auth_users",
            ["deleted_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_products_deleted_at", "products", ["deleted_at"])

    with op.batch_alter_table("image_sessions") as batch_op:
        batch_op.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("deleted_by_user_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_image_sessions_deleted_by_user_id",
            "auth_users",
            ["deleted_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_image_sessions_deleted_at", "image_sessions", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_image_sessions_deleted_at", table_name="image_sessions")
    has_image_sessions_deleted_fk = _has_foreign_key(
        "image_sessions",
        "fk_image_sessions_deleted_by_user_id",
    )
    with op.batch_alter_table("image_sessions") as batch_op:
        if has_image_sessions_deleted_fk:
            batch_op.drop_constraint("fk_image_sessions_deleted_by_user_id", type_="foreignkey")
        batch_op.drop_column("deleted_by_user_id")
        batch_op.drop_column("deleted_at")

    op.drop_index("ix_products_deleted_at", table_name="products")
    has_products_deleted_fk = _has_foreign_key("products", "fk_products_deleted_by_user_id")
    with op.batch_alter_table("products") as batch_op:
        if has_products_deleted_fk:
            batch_op.drop_constraint("fk_products_deleted_by_user_id", type_="foreignkey")
        batch_op.drop_column("deleted_by_user_id")
        batch_op.drop_column("deleted_at")

    op.drop_index("ix_canvas_templates_review_status", table_name="canvas_templates")
    has_canvas_templates_reviewed_fk = _has_foreign_key(
        "canvas_templates",
        "fk_canvas_templates_reviewed_by_user_id",
    )
    with op.batch_alter_table("canvas_templates") as batch_op:
        if has_canvas_templates_reviewed_fk:
            batch_op.drop_constraint("fk_canvas_templates_reviewed_by_user_id", type_="foreignkey")
        batch_op.drop_column("reviewed_by_user_id")
        batch_op.drop_column("reviewed_at")
        batch_op.drop_column("review_submitted_at")
        batch_op.drop_column("review_note")
        batch_op.drop_column("review_status")

    op.execute(
        """
        UPDATE rbac_api_permissions
        SET menu_code = 'rbac',
            sort_order = 30
        WHERE code = 'templates:manage_global'
        """
    )
    op.execute(
        """
        INSERT INTO role_menu_permissions (role_id, menu_code)
        SELECT template_roles.role_id, 'rbac'
        FROM role_api_permissions AS template_roles
        WHERE template_roles.permission_code = 'templates:manage_global'
          AND NOT EXISTS (
              SELECT 1
              FROM role_menu_permissions AS existing_rbac_menu
              WHERE existing_rbac_menu.role_id = template_roles.role_id
                AND existing_rbac_menu.menu_code = 'rbac'
          )
        """
    )
