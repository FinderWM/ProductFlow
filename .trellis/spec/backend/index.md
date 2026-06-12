# Backend Development Guidelines

> Project-specific backend conventions for ProductFlow.

---

## Overview

These files document the backend conventions that are actually present in this repository. They are based on
`AGENTS.md`, `backend/pyproject.toml`, `justfile`, `docs/ARCHITECTURE.md`, and the current code under
`backend/src/inspiration_one_backend/` and `backend/tests/`.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | FastAPI/application/domain/infrastructure layout and file placement | Filled |
| [Database Guidelines](./database-guidelines.md) | SQLAlchemy models, sessions, Alembic migrations, runtime settings | Filled |
| [Error Handling](./error-handling.md) | ValueError-to-HTTP mapping, upload errors, auth, queue/provider boundaries | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Ruff/pytest tooling, tests, required/forbidden backend patterns | Filled |
| [Logging Guidelines](./logging-guidelines.md) | Current minimal logging reality and safe logging extension rules | Filled |
| [Realtime Task Notifications](./realtime-task-notifications.md) | WebSocket + Redis pub/sub task-result notification contract | Filled |
| [Inspiration Workbench DAG](./inspiration-workflow-dag.md) | Canvas/workflow DAG templates, validation, and user-template contracts | Filled |

---

## Feature Coverage Map

Use this map when the change is feature-driven rather than file-driven:

- Resource moderation, effective availability, disabled-field serializers, or admin governance APIs: read
  `./database-guidelines.md`, `./error-handling.md`, and `../frontend/resource-governance-guidelines.md`.
- Resource library source references, save/load semantics, ownership boundaries, or source disabled propagation: read
  `./database-guidelines.md`, `./error-handling.md`, and `../frontend/resource-governance-guidelines.md`.
- Gallery save semantics, list filtering, pagination/counts, moderation visibility, or view counting: read
  `./database-guidelines.md`, `./quality-guidelines.md`, and `../frontend/component-guidelines.md`.
- Queue/status snapshots or task-result notifications: read `./quality-guidelines.md` and
  `./realtime-task-notifications.md`.
- Storage-backed uploads, generated files, downloads, or object metadata: read `./database-guidelines.md`,
  `./error-handling.md`, and `./directory-structure.md`.
- Inspiration workbench DAG, canvas templates, workflow nodes/edges, or user templates: read
  `./inspiration-workflow-dag.md`.

If a feature is not represented here, update this map in the same change that adds or changes the feature contract.

---

## Pre-Development Checklist

Before backend changes, read:

1. `./directory-structure.md`
2. `./quality-guidelines.md`
3. The topic-specific file for the area you are changing:
   - database/schema/config: `./database-guidelines.md`
   - API/business failures/uploads: `./error-handling.md`
   - observability/logging: `./logging-guidelines.md`
   - realtime task-result notifications: `./realtime-task-notifications.md`
   - inspiration workbench DAG: `./inspiration-workflow-dag.md`

If a backend change affects frontend API contracts, also read `../frontend/type-safety.md` and
`../frontend/state-management.md`.

---

**Language**: All documentation in this directory is written in English.
