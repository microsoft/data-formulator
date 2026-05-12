from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PY_SRC = PROJECT_ROOT / "py-src"

if str(PY_SRC) not in sys.path:
    sys.path.insert(0, str(PY_SRC))

# Snapshot captured at conftest load time — before any test or load_dotenv() runs.
_PRISTINE_ENV: dict[str, str] = dict(os.environ)


def _reset_to_pristine() -> None:
    """Replace os.environ with the pristine snapshot, keeping pytest internals."""
    pytest_vars = {k: v for k, v in os.environ.items() if k.startswith("PYTEST_")}
    os.environ.clear()
    os.environ.update(_PRISTINE_ENV)
    os.environ.update(pytest_vars)


@pytest.fixture(autouse=True)
def _isolate_env():
    """Restore os.environ to its pre-session state before every test.

    When any test imports ``data_formulator.app``, the module-level
    ``load_dotenv()`` call injects the developer's ``.env`` into
    ``os.environ``, polluting all subsequent tests in the same process.
    This fixture ensures each test starts with the pristine environment
    that existed before any test ran.
    """
    _reset_to_pristine()
    yield
    _reset_to_pristine()
