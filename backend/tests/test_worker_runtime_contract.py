from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_just_worker_commands_use_single_process() -> None:
    justfile = (REPO_ROOT / "justfile").read_text(encoding="utf-8")

    assert "dramatiq --processes 2" not in justfile
    assert (
        "bash scripts/with_dev_env.sh uv run --directory backend dramatiq --processes 1 --threads 4 "
        "inspiration_one_backend.workers"
    ) in justfile
    assert (
        "uv run --directory backend dramatiq --processes 1 --threads 4 inspiration_one_backend.workers"
    ) in justfile


def test_compose_worker_command_uses_single_process() -> None:
    compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    assert 'command: ["dramatiq", "--processes", "2"' not in compose
    assert (
        'command: ["dramatiq", "--processes", "1", "--threads", "4", "inspiration_one_backend.workers"]'
    ) in compose
