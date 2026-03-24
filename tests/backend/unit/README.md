# Backend Unit Tests

This directory contains pure backend unit tests.

Good candidates for this layer:

- pure `sanitize_*` functions
- DataFrame / schema utility helpers
- logic that does not require a real Flask request context

Naming guidelines:

- prefer one file per concern
- name files by behavior or capability, not by large source filenames

Examples:

- `test_unicode_table_name_sanitization.py`
- `test_unicode_column_name_handling.py`
- `test_workspace_name_generation.py`
