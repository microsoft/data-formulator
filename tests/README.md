# Tests

The test tree is organized with a clear backend/frontend split:

- `tests/backend`
  - backend unit tests, integration tests, and contract tests
  - driven by `pytest`
  - regression tests directly related to `py-src/data_formulator/**`
- `tests/frontend`
  - frontend unit tests powered by **Vitest** + **@testing-library/react** (jsdom)
  - covers pure functions, Redux selectors, and React component rendering
  - see `tests/frontend/README.md` for directory layout details

## Suggested Commands

Run backend tests (pytest):

```bash
pytest tests/backend
```

Run frontend tests (Vitest):

```bash
npm test
```

Run frontend tests in watch mode:

```bash
npm run test:watch
```
