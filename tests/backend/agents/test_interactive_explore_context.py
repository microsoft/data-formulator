"""Tests for recommendation-question context construction and inspect behavior."""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from data_formulator.agents.agent_interactive_explore import InteractiveExploreAgent
from data_formulator.agents.agent_utils import format_dataframe_sample_with_budget
from data_formulator.agents.context import build_lightweight_table_context
from data_formulator.datalake.workspace_metadata import (
    ColumnInfo,
    TableMetadata,
    WorkspaceMetadata,
)

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def workspace_with_metadata():
    workspace = MagicMock()
    workspace.read_data_as_df.return_value = pd.DataFrame({
        "category": ["office", "electronics", "office", "furniture", "office"],
        "profit": [10, 20, 15, 5, 30],
    })
    workspace.get_relative_data_file_path.return_value = "data/sales.parquet"

    metadata = WorkspaceMetadata.create_new()
    metadata.add_table(TableMetadata(
        name="sales",
        source_type="data_loader",
        filename="sales.parquet",
        file_type="parquet",
        created_at=datetime.now(timezone.utc),
        description="Sales performance table",
        columns=[
            ColumnInfo("category", "text", description="Business category"),
            ColumnInfo("profit", "float64", description="Net profit"),
        ],
    ))
    workspace.get_metadata.return_value = metadata
    return workspace


class TestRecommendationContext:
    def test_lightweight_context_includes_metadata_and_field_values(self, workspace_with_metadata):
        context = build_lightweight_table_context(
            [{"name": "sales"}],
            workspace_with_metadata,
        )

        assert "Sales performance table" in context
        assert "Business category" in context
        assert "Net profit" in context
        assert "Field value samples" in context
        assert "office" in context
        assert "electronics" in context
        assert "Numeric stats" in context

    def test_sample_rows_floor_down_to_fit_budget(self):
        df = pd.DataFrame({
            "name": ["alpha" * 20, "beta" * 20, "gamma" * 20],
            "value": [1, 2, 3],
        })

        sample, displayed_rows, truncated = format_dataframe_sample_with_budget(
            df,
            max_rows=3,
            max_chars=150,
            index=False,
        )

        assert len(sample) <= 150
        assert displayed_rows < 3
        assert truncated is True


class TestInteractiveExploreAgent:
    def test_run_skips_inspect_round_by_default(self, workspace_with_metadata):
        client = MagicMock()
        client.get_completion.return_value = [
            SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        delta=SimpleNamespace(content='{"type":"question","text":"Q","goal":"G","tag":"pivot"}\n')
                    )
                ]
            )
        ]

        agent = InteractiveExploreAgent(client=client, workspace=workspace_with_metadata)

        with patch.object(agent, "_run_inspect_round", wraps=agent._run_inspect_round) as inspect_round:
            chunks = list(agent.run([{"name": "sales"}]))

        assert inspect_round.call_count == 0
        text_chunks = [c for c in chunks if isinstance(c, str)]
        assert text_chunks == ['{"type":"question","text":"Q","goal":"G","tag":"pivot"}\n']

    def test_run_yields_progress_events_in_order(self, workspace_with_metadata):
        """Progress events must appear before any LLM text chunks."""
        client = MagicMock()
        client.get_completion.return_value = [
            SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        delta=SimpleNamespace(content='{"type":"question","text":"Q","goal":"G","tag":"pivot"}\n')
                    )
                ]
            )
        ]

        agent = InteractiveExploreAgent(client=client, workspace=workspace_with_metadata)
        chunks = list(agent.run([{"name": "sales"}]))

        progress_events = [c for c in chunks if isinstance(c, dict) and c.get("type") == "progress"]
        assert len(progress_events) == 2
        assert progress_events[0]["phase"] == "building_context"
        assert progress_events[1]["phase"] == "generating"

        first_text_idx = next(i for i, c in enumerate(chunks) if isinstance(c, str))
        last_progress_idx = max(i for i, c in enumerate(chunks) if isinstance(c, dict) and c.get("type") == "progress")
        assert last_progress_idx < first_text_idx
