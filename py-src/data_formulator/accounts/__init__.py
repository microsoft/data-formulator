# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Accounts: the user's sign-ins to data providers, used by the agent's ``api_fetch`` (design-docs/72).

One sign-in per user and provider, kept in the credential vault. The agent never sees a token: ``api_fetch`` attaches
it on the server, only for the provider's own hosts. Local mode only, like the user's MCP servers.
"""

from __future__ import annotations


def accounts_available() -> bool:
    """Accounts follow the user's tools: the single-user local app, with user connections allowed."""
    from data_formulator.mcp_servers.config import mcp_available

    return mcp_available()
