# Tests

The test tree is organized with a clear backend/frontend split:

- `tests/backend`
  - backend unit tests
  - backend integration tests
  - regression tests directly related to `py-src/data_formulator/**`
- `tests/frontend`
  - frontend-related contract tests driven by `pytest`
  - focused on request/response boundary behavior
  - not intended for React component-level unit tests yet

## Suggested Commands

Run all tests:

```bash
pytest
```

Run backend tests only:

```bash
pytest tests/backend
```

Run frontend contract tests only:

```bash
pytest tests/frontend
```
