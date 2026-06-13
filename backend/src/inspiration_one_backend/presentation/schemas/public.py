from __future__ import annotations

from pydantic import BaseModel, Field


class LoginPageConfigResponse(BaseModel):
    template_id: str
    template_name: str
    content: dict[str, str] = Field(default_factory=dict)
    assets: dict[str, str] = Field(default_factory=dict)
