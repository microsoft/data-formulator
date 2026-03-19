# Frontend Tests

This directory is reserved for frontend-related tests that are still driven by `pytest`.

Because the frontend is primarily `React + TypeScript`, while this round standardizes on `pytest`,
the initial focus here is on contract and boundary testing rather than direct component unit tests.

Suggested future coverage:

- preservation of Chinese table names from frontend submission to backend response
- traceability of Chinese column names in recommendation, derivation, and export flows
- consistency of API fields such as `table_name`, `displayId`, and `columns`
