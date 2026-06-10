from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute

from inspiration_one_backend.config import get_settings
from inspiration_one_backend.domain.rbac import API_RBAC_MANAGE, API_RESOURCES_MODERATE
from inspiration_one_backend.presentation import deps

PUBLIC_ROUTES = frozenset(
    {
        ("GET", "/healthz"),
        ("POST", "/api/auth/session"),
        ("POST", "/api/auth/login"),
        ("POST", "/api/auth/password"),
        ("GET", "/api/auth/session"),
        ("DELETE", "/api/auth/session"),
    }
)

ADMIN_ROUTE_PREFIX_PERMISSIONS: Mapping[str, str] = {
    "/api/rbac": API_RBAC_MANAGE,
    "/api/resources": API_RESOURCES_MODERATE,
    "/api/resource-moderation": API_RESOURCES_MODERATE,
}

AUTHENTICATED_DEFAULT_ROUTE_PREFIXES = frozenset({"/api/resource-library"})

HTTP_METHODS = frozenset({"DELETE", "GET", "PATCH", "POST", "PUT"})
PERMISSION_DEPENDENCY_QUALNAMES = frozenset(
    {
        "require_api_permission.<locals>.dependency",
        "require_any_api_permission.<locals>.dependency",
    }
)


@dataclass(frozen=True, slots=True)
class RouteGate:
    dependency_names: tuple[str, ...]
    api_permissions: frozenset[str]
    has_authenticated: bool
    has_admin: bool


@pytest.fixture()
def contract_app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[FastAPI]:
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "route-contract-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "route-contract-session-key")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'contract.db'}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path / "storage"))
    monkeypatch.setenv("LOG_DIR", str(tmp_path / "logs"))
    get_settings.cache_clear()

    from inspiration_one_backend.presentation.api import create_app

    yield create_app()
    get_settings.cache_clear()


def test_routes_have_explicit_rbac_contract(contract_app: FastAPI) -> None:
    failures: list[str] = []
    seen_public_routes: set[tuple[str, str]] = set()

    for route in _http_routes(contract_app):
        gate = _inspect_route_gate(route)
        for method in _route_methods(route):
            route_key = (method, route.path)
            if route_key in PUBLIC_ROUTES:
                seen_public_routes.add(route_key)
                continue
            if not route.path.startswith("/api"):
                continue

            failures.extend(_validate_private_route(method, route.path, gate))

    missing_public_routes = PUBLIC_ROUTES - seen_public_routes
    for method, path in sorted(missing_public_routes):
        failures.append(f"{method} {path}: public route is allowlisted but is not registered")

    assert not failures, "RBAC route contract violations:\n" + "\n".join(f"- {failure}" for failure in failures)


def _http_routes(app: FastAPI) -> Iterator[APIRoute]:
    for route in app.routes:
        if isinstance(route, APIRoute):
            yield route


def _route_methods(route: APIRoute) -> tuple[str, ...]:
    return tuple(sorted((route.methods or set()) & HTTP_METHODS))


def _validate_private_route(method: str, path: str, gate: RouteGate) -> list[str]:
    failures: list[str] = []
    if _is_authenticated_default_route(path):
        if not gate.has_authenticated:
            failures.append(_format_failure(method, path, gate, "missing authentication dependency"))
        return failures

    if not gate.api_permissions:
        failures.append(_format_failure(method, path, gate, "missing API permission dependency"))

    required_admin_permission = _required_admin_permission(path)
    if required_admin_permission is None:
        return failures

    if not gate.has_admin:
        failures.append(_format_failure(method, path, gate, "missing admin dependency"))
    if required_admin_permission not in gate.api_permissions:
        failures.append(
            _format_failure(
                method,
                path,
                gate,
                f"missing required permission {required_admin_permission!r}",
            )
        )
    return failures


def _required_admin_permission(path: str) -> str | None:
    for prefix, permission in ADMIN_ROUTE_PREFIX_PERMISSIONS.items():
        if path == prefix or path.startswith(f"{prefix}/"):
            return permission
    return None


def _is_authenticated_default_route(path: str) -> bool:
    return any(
        path == prefix or path.startswith(f"{prefix}/")
        for prefix in AUTHENTICATED_DEFAULT_ROUTE_PREFIXES
    )


def _inspect_route_gate(route: APIRoute) -> RouteGate:
    dependency_calls = tuple(_iter_dependency_calls(route.dependant))
    dependency_names = tuple(_call_name(call) for call in dependency_calls)
    return RouteGate(
        dependency_names=dependency_names,
        api_permissions=frozenset(
            permission for call in dependency_calls for permission in _api_permissions_from_dependency(call)
        ),
        has_authenticated=any(_is_authenticated_dependency(call) for call in dependency_calls),
        has_admin=any(_is_admin_dependency(call) for call in dependency_calls),
    )


def _iter_dependency_calls(dependant: Any) -> Iterator[Any]:
    stack = list(getattr(dependant, "dependencies", ()))
    while stack:
        dependency = stack.pop()
        call = getattr(dependency, "call", None)
        if call is not None:
            yield call
        stack.extend(getattr(dependency, "dependencies", ()))


def _api_permissions_from_dependency(call: Any) -> frozenset[str]:
    if getattr(call, "__qualname__", "") not in PERMISSION_DEPENDENCY_QUALNAMES:
        return frozenset()

    permission_codes: set[str] = set()
    for value in _call_bound_values(call):
        permission_codes.update(_permission_codes_from_value(value))
    return frozenset(permission_codes)


def _call_bound_values(call: Any) -> Iterator[Any]:
    for cell in getattr(call, "__closure__", None) or ():
        yield cell.cell_contents
    yield from getattr(call, "__defaults__", None) or ()
    yield from (getattr(call, "__kwdefaults__", None) or {}).values()


def _permission_codes_from_value(value: Any) -> frozenset[str]:
    if isinstance(value, str) and ":" in value:
        return frozenset({value})
    if isinstance(value, (frozenset, list, set, tuple)):
        return frozenset(item for item in value if isinstance(item, str) and ":" in item)
    return frozenset()


def _is_admin_dependency(call: Any) -> bool:
    return call is deps.require_admin or (
        getattr(call, "__module__", "") == deps.__name__ and getattr(call, "__qualname__", "") == "require_admin"
    )


def _is_authenticated_dependency(call: Any) -> bool:
    return call is deps.require_authenticated or (
        getattr(call, "__module__", "") == deps.__name__
        and getattr(call, "__qualname__", "") == "require_authenticated"
    )


def _call_name(call: Any) -> str:
    module = getattr(call, "__module__", type(call).__module__)
    qualname = getattr(call, "__qualname__", getattr(call, "__name__", type(call).__qualname__))
    return f"{module}.{qualname}"


def _format_failure(method: str, path: str, gate: RouteGate, reason: str) -> str:
    dependencies = ", ".join(gate.dependency_names) or "<none>"
    permissions = ", ".join(sorted(gate.api_permissions)) or "<none>"
    return (
        f"{method} {path}: {reason}; admin={gate.has_admin}; permissions=[{permissions}]; dependencies=[{dependencies}]"
    )
