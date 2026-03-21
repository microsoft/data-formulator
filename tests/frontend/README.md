# Frontend Tests

Frontend unit tests powered by **Vitest** + **@testing-library/react** (jsdom).

## Directory Layout

```text
tests/frontend/
  setup.ts                          # Global test setup (jest-dom matchers)
  unit/
    data/
      coerceDate.test.ts            # Type coercion – Date handling
      resolveExcelCellValue.test.ts # Excel cell value resolution
    app/
      dfSelectors.test.ts           # Redux selectors (getActiveModel)
    views/
      safeCellRender.test.tsx       # Component rendering object safety
```

## Directory Responsibilities

- `unit/data/` — Pure function tests for `src/data/` modules (type coercion, Excel parsing)
- `unit/app/` — Redux selector and state logic tests for `src/app/` modules
- `unit/views/` — Rendering safety and component behavior tests for `src/views/` modules

## Running Tests

```bash
# Run all frontend tests
npm test

# Watch mode
npm run test:watch
```
