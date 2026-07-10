"""Container App deployment safety tests for stateful runtime components."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

pytestmark = [pytest.mark.backend]

_REPO_ROOT = Path(__file__).resolve().parents[3]
_CONTAINERAPP_BICEP = _REPO_ROOT / "infra" / "modules" / "containerapp.bicep"
_DOCKERFILE = _REPO_ROOT / "Dockerfile"
_PYPROJECT = _REPO_ROOT / "pyproject.toml"


def test_container_app_is_single_replica_while_state_is_instance_local() -> None:
    """Autoscaling must stay disabled until every required state store is shared."""
    content = _CONTAINERAPP_BICEP.read_text(encoding="utf-8")
    match = re.search(r"maxReplicas:\s*(\d+)", content)

    assert match is not None, "Container App must declare an explicit replica cap"
    assert int(match.group(1)) == 1


def test_production_container_uses_gunicorn() -> None:
    dockerfile = _DOCKERFILE.read_text(encoding="utf-8")
    pyproject = _PYPROJECT.read_text(encoding="utf-8")

    assert '"gunicorn' in pyproject
    assert 'ENTRYPOINT ["gunicorn"' in dockerfile
    assert "data_formulator.app:app" in dockerfile
