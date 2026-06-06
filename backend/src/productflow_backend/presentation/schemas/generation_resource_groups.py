from __future__ import annotations

from pydantic import BaseModel

from productflow_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    DEFAULT_GENERATION_RESOURCE_GROUP_KEY,
    GenerationResourceGroup,
)

DEFAULT_GENERATION_RESOURCE_GROUP_NAME = "默认分组"


class GenerationResourceGroupTagResponse(BaseModel):
    id: str
    key: str
    name: str


def serialize_generation_resource_group_tag(
    group: GenerationResourceGroup | None,
    *,
    resource_group_id: str | None,
) -> GenerationResourceGroupTagResponse:
    if group is not None:
        return GenerationResourceGroupTagResponse(id=group.id, key=group.key, name=group.name)
    resolved_id = resource_group_id or DEFAULT_GENERATION_RESOURCE_GROUP_ID
    if resolved_id == DEFAULT_GENERATION_RESOURCE_GROUP_ID:
        return GenerationResourceGroupTagResponse(
            id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            key=DEFAULT_GENERATION_RESOURCE_GROUP_KEY,
            name=DEFAULT_GENERATION_RESOURCE_GROUP_NAME,
        )
    return GenerationResourceGroupTagResponse(id=resolved_id, key=resolved_id, name="未知分组")
