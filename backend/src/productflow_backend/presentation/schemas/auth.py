from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class AuthUserResponse(BaseModel):
    id: str
    username: str
    display_name: str
    role_id: str
    is_admin: bool
    enabled: bool
    password_pending: bool


class MenuPermissionResponse(BaseModel):
    code: str
    title: str
    sort_order: int


class SessionCreateRequest(BaseModel):
    admin_key: str = Field(default="")
    username: str = Field(default="")
    password: str = Field(default="")
    client_password_md5: str = Field(default="")


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str | None = Field(default=None, min_length=1)
    client_password_md5: str | None = Field(default=None, min_length=32, max_length=32)

    @model_validator(mode="after")
    def require_password_credential(self) -> LoginRequest:
        if not (self.password or self.client_password_md5):
            raise ValueError("密码不能为空")
        return self


class PasswordSetRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    setup_token: str = Field(min_length=1)
    password: str | None = Field(default=None, min_length=1)
    client_password_md5: str | None = Field(default=None, min_length=32, max_length=32)

    @model_validator(mode="after")
    def require_password_credential(self) -> PasswordSetRequest:
        if not (self.password or self.client_password_md5):
            raise ValueError("密码不能为空")
        return self


class SessionResponse(BaseModel):
    ok: bool = True


class SessionStateResponse(BaseModel):
    authenticated: bool
    access_required: bool
    user: AuthUserResponse | None = None
    menus: list[MenuPermissionResponse] = Field(default_factory=list)
    api_permissions: list[str] = Field(default_factory=list)
