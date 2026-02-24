# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Authentication and identity management for Data Formulator.

This module provides a hybrid identity system that supports both anonymous
browser-based users and authenticated users (via Azure App Service or JWT).

Security Model:
- Anonymous users: Browser UUID from X-Identity-Id header (prefixed with "browser:")
- Authenticated users: Verified identity from Azure headers or JWT (prefixed with "user:")
- Namespacing ensures authenticated user data cannot be accessed by spoofing headers
"""

import logging
import re
from flask import request, current_app

logger = logging.getLogger(__name__)

# Maximum raw length for identity values (before namespacing).
_MAX_IDENTITY_LENGTH = 256

# Allowed characters: word chars, @, dot, dash (covers emails, UUIDs, etc.).
_IDENTITY_RE = re.compile(r'^[\w@.\-]+$', re.ASCII)


def _validate_identity_value(value: str, source: str) -> str:
    """Validate and return a trimmed identity value.

    Raises ``ValueError`` if the value is empty, too long, or contains
    characters that should never appear in an identity string (e.g.
    path separators, control characters, shell metacharacters).
    """
    value = value.strip()
    if not value:
        raise ValueError(f"Empty identity value from {source}")
    if len(value) > _MAX_IDENTITY_LENGTH:
        raise ValueError(
            f"Identity value from {source} exceeds "
            f"{_MAX_IDENTITY_LENGTH} characters"
        )
    if not _IDENTITY_RE.match(value):
        raise ValueError(
            f"Identity value from {source} contains disallowed characters"
        )
    return value


def get_identity_id() -> str:
    """
    Get identity ID with proper security priority:
    
    1. Verified user from Azure App Service auth headers (trusted, set by Azure)
    2. Verified user from JWT bearer token (trusted, cryptographically verified)
    3. Browser ID from X-Identity-Id header (untrusted, for anonymous users only)
    
    The key insight: for anonymous users, we trust X-Identity-Id because there's
    no security risk (who cares if someone "steals" a random UUID?). For authenticated
    users, we MUST extract identity from verified sources, not client-provided headers.
    
    Identity is namespaced as "user:<id>" or "browser:<id>" to ensure authenticated
    user data is never accessible via anonymous browser identity spoofing.
    
    Returns:
        str: The namespaced identity ID string (e.g., "user:alice@..." or "browser:550e8400-...")
    
    Raises:
        ValueError: If no identity could be determined
    """
    
    # Priority 1: Azure App Service Authentication (EasyAuth)
    # When deployed to Azure with authentication enabled, Azure injects these headers.
    # These are SET BY AZURE (not the client) after verifying the user's identity.
    azure_principal_id = request.headers.get('X-MS-CLIENT-PRINCIPAL-ID')
    if azure_principal_id:
        validated = _validate_identity_value(azure_principal_id, "Azure principal")
        logger.debug(f"Using Azure principal ID: {validated[:8]}...")
        return f"user:{validated}"
    
    # Priority 2: JWT Bearer Token (for custom auth implementations)
    # If you implement your own auth, verify the JWT here and extract user ID.
    # Example (uncomment and configure when implementing JWT auth):
    # 
    # auth_header = request.headers.get('Authorization', '')
    # if auth_header.startswith('Bearer '):
    #     token = auth_header[7:]
    #     try:
    #         import jwt
    #         payload = jwt.decode(token, current_app.config['JWT_SECRET'], algorithms=['HS256'])
    #         user_id = payload.get('sub') or payload.get('user_id')
    #         if user_id:
    #             logger.debug(f"Using JWT user ID: {user_id[:8]}...")
    #             return f"user:{user_id}"
    #     except Exception as e:
    #         logger.warning(f"Invalid JWT token: {e}")
    #         # Fall through to browser identity
    
    # Priority 3: Anonymous browser identity (UNTRUSTED - from client header)
    # SECURITY: We NEVER trust the namespace prefix from X-Identity-Id header.
    # Even if client sends "user:alice@...", we force "browser:" prefix.
    # Only verified auth (Azure headers, JWT) can result in "user:" prefix.
    client_identity = request.headers.get('X-Identity-Id')
    if client_identity:
        # Extract the ID part, ignoring any client-provided prefix
        # e.g., "browser:550e8400-..." → "550e8400-..."
        # e.g., "user:alice@..." → "alice@..." (but forced to browser: namespace)
        if ':' in client_identity:
            # Strip the prefix - we don't trust client-provided namespaces
            identity_value = client_identity.split(':', 1)[1]
        else:
            identity_value = client_identity
        
        validated = _validate_identity_value(identity_value, "X-Identity-Id header")
        # Always use browser: prefix for client-provided identities
        return f"browser:{validated}"
    
    raise ValueError("X-Identity-Id header is required. Please refresh the page.")