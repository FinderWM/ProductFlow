from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.application.inspiration_workflow import graph as inspiration_workflow_graph
from inspiration_one_backend.infrastructure.db.models import (
    CopySet,
    InspirationWorkflow,
    PosterVariant,
    SourceAsset,
    WorkflowEdge,
    WorkflowNode,
    WorkflowRun,
)


class WorkflowQueryService:
    """Small workflow query boundary for execution/reuse hot paths."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def get_workflow_or_raise(self, workflow_id: str) -> InspirationWorkflow:
        return inspiration_workflow_graph.get_workflow_or_raise(self.session, workflow_id)

    def get_node_or_raise(self, node_id: str) -> WorkflowNode:
        return inspiration_workflow_graph.get_node_or_raise(self.session, node_id)

    def get_edge_or_raise(self, edge_id: str) -> WorkflowEdge:
        return inspiration_workflow_graph.get_edge_or_raise(self.session, edge_id)

    def workflow_run_with_node_runs(self, run_id: str) -> WorkflowRun | None:
        return self.session.scalar(
            select(WorkflowRun).options(selectinload(WorkflowRun.node_runs)).where(WorkflowRun.id == run_id)
        )

    def copy_set_for_inspiration(self, copy_set_id: str, inspiration_id: str) -> CopySet | None:
        copy_set = self.session.get(CopySet, copy_set_id)
        if copy_set is None or copy_set.inspiration_id != inspiration_id:
            return None
        return copy_set

    def source_assets_by_ids(self, asset_ids: list[str]) -> list[SourceAsset]:
        if not asset_ids:
            return []
        return list(self.session.scalars(select(SourceAsset).where(SourceAsset.id.in_(asset_ids))))

    def has_any_source_asset_for_inspiration(self, inspiration_id: str, asset_ids: list[str]) -> bool:
        return any(asset.inspiration_id == inspiration_id for asset in self.source_assets_by_ids(asset_ids))

    def posters_by_ids(self, poster_ids: list[str]) -> list[PosterVariant]:
        if not poster_ids:
            return []
        return list(self.session.scalars(select(PosterVariant).where(PosterVariant.id.in_(poster_ids))))
