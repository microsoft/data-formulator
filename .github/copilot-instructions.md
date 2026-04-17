# Project Instructions

## Python Environment

- Always use `uv` instead of `pip` for installing packages (e.g. `uv pip install`, `uv pip install -e .`).
- Use `uv run` to execute Python scripts and modules (e.g. `uv run python script.py`, `uv run pytest`).
- The virtual environment is at `.venv/`. Activate it with `source .venv/bin/activate` if needed.
- The Python source is under `py-src/`. The project is installed in editable mode via `uv pip install -e .`.
