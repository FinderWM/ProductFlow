# Frontend Development Guidelines

> Project-specific frontend conventions for ProductFlow.

---

## Overview

These files document the frontend conventions that are actually present in this repository. They are based on `AGENTS.md`,
`web/package.json`, `web/tsconfig*.json`, `web/vite.config.ts`, `justfile`, and the current code under `web/src/`.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | React/Vite app layout, pages, components, lib boundaries | Filled |
| [Component Guidelines](./component-guidelines.md) | Function components, props, Tailwind styling, forms/accessibility | Filled |
| [Hook Guidelines](./hook-guidelines.md) | React Query, mutations/cache updates, polling, local hooks | Filled |
| [State Management](./state-management.md) | Server/local/URL state split and query key conventions | Filled |
| [Quality Guidelines](./quality-guidelines.md) | TypeScript build gate, API centralization, UI review checklist | Filled |
| [Type Safety](./type-safety.md) | Strict TS, DTO mirroring, ApiError, runtime validation reality | Filled |
| [Inspiration Workbench DAG](./inspiration-workbench-dag.md) | Inspiration detail DAG workbench UI, API DTOs, and cache contracts | Filled |
| [Resource Governance Guidelines](./resource-governance-guidelines.md) | Resource library, gallery governance, admin readonly, moderation UI contracts | Filled |
| [UI Layout Guidelines](./ui-layout-guidelines.md) | Layout scheme, workspace appearance, navigation, shell, and verification contracts | Filled |

---

## Feature Coverage Map

Use this map when the change is feature-driven rather than file-driven:

- Resource library UI and authenticated-default API consumption: read `./resource-governance-guidelines.md`,
  `./type-safety.md`, `./state-management.md`, and `../backend/error-handling.md`.
- Gallery browsing, save-to-gallery state, and admin moderation controls: read `./resource-governance-guidelines.md`,
  `./component-guidelines.md`, `./state-management.md`, `./type-safety.md`, and `../backend/database-guidelines.md`.
- Workspace shell, top navigation, workspace home anchors, and appearance switching: read `./ui-layout-guidelines.md`,
  `./component-guidelines.md`, and `./state-management.md`.
- RBAC-gated navigation or protected actions: read `./type-safety.md`, `./state-management.md`,
  and `../backend/error-handling.md`.
- Image-chat handoff, generated asset gallery state, and resource-group URL state: read `./type-safety.md`,
  `./state-management.md`, `./component-guidelines.md`, `./resource-governance-guidelines.md`, and
  `../backend/database-guidelines.md`.

If a feature is not represented here, update this map in the same change that adds or changes the feature contract.

---

## Pre-Development Checklist

Before frontend changes, read:

1. `./directory-structure.md`
2. `./quality-guidelines.md`
3. The topic-specific file for the area you are changing:
   - components/forms: `./component-guidelines.md`
   - hooks/data fetching: `./hook-guidelines.md`
   - state/cache behavior: `./state-management.md`
   - API DTOs/types: `./type-safety.md`
   - inspiration workbench DAG: `./inspiration-workbench-dag.md`
   - resource library, gallery governance, admin readonly, or moderation UI: `./resource-governance-guidelines.md`
   - UI layout schemes, workspace appearances, navigation, or shell CSS: `./ui-layout-guidelines.md`

If a frontend change consumes or changes backend API contracts, also read `../backend/error-handling.md`,
`../backend/database-guidelines.md`, or `../backend/directory-structure.md` as relevant.

---

**Language**: All documentation in this directory is written in English.
