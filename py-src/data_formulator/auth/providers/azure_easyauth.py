# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Azure App Service built-in authentication (EasyAuth) provider.

When Data Formulator is deployed on Azure App Service with authentication
enabled, Azure verifies the user's identity *before* the request reaches
Flask and injects trusted headers:

* ``X-MS-CLIENT-PRINCIPAL-ID`` — user's Object ID (always present)
* ``X-MS-CLIENT-PRINCIPAL-NAME`` — display name (optional)

These headers are set by the Azure infrastructure and cannot be forged
by end-user clients.
"""

from __future__ import annotations

import logging
from typing import Optional

from flask import Request

from .base import AuthProvider, AuthResult

logger = logging.getLogger(__name__)


class AzureEasyAuthProvider(AuthProvider):

    @property
    def name(self) -> str:
        return "azure_easyauth"

    def authenticate(self, request: Request) -> Optional[AuthResult]:
        principal_id = request.headers.get("X-MS-CLIENT-PRINCIPAL-ID")
        if not principal_id:
            return None

        principal_name = request.headers.get("X-MS-CLIENT-PRINCIPAL-NAME", "")
        logger.debug("Azure EasyAuth: principal_id=%s...", principal_id[:8])

        return AuthResult(
            user_id=principal_id.strip(),
            display_name=principal_name.strip() or None,
        )

    def get_auth_info(self) -> dict:
        return {
            "action": "transparent",
            "label": "Azure App Service Authentication",
        }
