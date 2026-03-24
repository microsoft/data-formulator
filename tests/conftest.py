from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PY_SRC = PROJECT_ROOT / "py-src"

if str(PY_SRC) not in sys.path:
    sys.path.insert(0, str(PY_SRC))
