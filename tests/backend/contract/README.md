# Backend Contract Tests

This directory contains API contract tests.

Contract tests focus on guarantees rather than implementation details:

- what is accepted as input
- what is returned as output
- which fields must remain stable
- which compatibility guarantees must not regress

For the current issue, the main guarantees to lock down are:

- a Chinese table name must not be sanitized into an empty string
- Chinese column names must not disappear at the boundary layer
- the `table_name` returned to the frontend must remain traceable to the actual stored name
