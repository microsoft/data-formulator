# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Chart creation guide injected lazily on the first ``visualize`` tool call.

This module consolidates the code-execution rules, chart type reference,
semantic type reference, and statistical analysis guidance that the data
agent needs when writing ``visualize`` tool calls.  The content is
extracted from the existing ``DataRecAgent`` / ``DataTransformationAgent``
prompts and de-duplicated.
"""

from data_formulator.agents.agent_data_rec import (
    SHARED_CHART_REFERENCE,
    SHARED_DUCKDB_NOTES,
    SHARED_ENVIRONMENT,
    SHARED_SEMANTIC_TYPE_REFERENCE,
    SHARED_STATISTICAL_ANALYSIS,
)

CHART_CREATION_GUIDE = f"""\
## Chart Creation Guide

The following reference material applies when you call the `visualize` tool.

### A. Code Execution Rules

{SHARED_ENVIRONMENT}

{SHARED_DUCKDB_NOTES}

**Datetime handling:**
- Year → number. Year-month / year-month-day → string ("2020-01" / "2020-01-01").
- Hour alone → number. Hour:min or h:m:s → string. Never return raw datetime objects.

### B. Chart Type Reference

{SHARED_CHART_REFERENCE}

### C. Semantic Type Reference

{SHARED_SEMANTIC_TYPE_REFERENCE}

### D. Statistical Analysis Guide

{SHARED_STATISTICAL_ANALYSIS}
"""
