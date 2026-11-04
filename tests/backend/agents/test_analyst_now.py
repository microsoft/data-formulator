"""The request tells the analyst the user's date and time ([NOW]), so it need not look the date up."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from data_formulator.analyst.agent import AnalystAgent, now_note

pytestmark = [pytest.mark.backend]

NOON_UTC = datetime(2026, 11, 3, 16, 12, tzinfo=timezone.utc)


def test_now_note_reads_the_server_clock_in_the_users_time_zone():
    assert now_note("America/Los_Angeles", NOON_UTC) == "[NOW]\n\nTuesday, 3 November 2026, 08:12 (America/Los_Angeles, UTC-08:00).\n\n"
    assert now_note("Asia/Kolkata", NOON_UTC) == "[NOW]\n\nTuesday, 3 November 2026, 21:42 (Asia/Kolkata, UTC+05:30).\n\n"
    # Across midnight the date is the user's, not the server's.
    assert now_note("Pacific/Auckland", datetime(2026, 11, 3, 13, 0, tzinfo=timezone.utc)).startswith("[NOW]\n\nWednesday, 4 November 2026, 02:00")


@pytest.mark.parametrize("zone", [None, "", "Not/AZone"])
def test_now_note_falls_back_to_utc(zone):
    assert now_note(zone, NOON_UTC) == "[NOW]\n\nTuesday, 3 November 2026, 16:12 (UTC, UTC+00:00).\n\n"


def test_the_request_says_when_it_was_sent_just_before_the_question():
    workspace = MagicMock()
    workspace.user_home = None
    agent = AnalystAgent(client=None, workspace=workspace)
    agent._build_system_prompt = lambda *args, **kwargs: "SYS"
    agent._timezone = "Europe/Paris"
    user = agent._build_initial_messages("What happened this year?")[1]["content"]
    assert "[NOW]\n\n" in user and "(Europe/Paris, UTC+0" in user
    assert user.index("[NOW]") < user.index("[USER QUESTION]")
    # The system prompt stays the same across requests (it is cached); the date is in the request.
    assert "[NOW]" not in agent._build_initial_messages("q")[0]["content"]


def test_the_system_prompt_explains_now():
    workspace = MagicMock()
    workspace.user_home = None
    agent = AnalystAgent(client=None, workspace=workspace)
    assert "**[NOW]**" in agent._build_system_prompt()
