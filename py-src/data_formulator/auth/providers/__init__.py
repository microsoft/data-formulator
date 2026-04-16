# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Auto-discovery registry for AuthProvider subclasses.

On import, every ``.py`` module in this package (except ``base``) is
scanned for concrete ``AuthProvider`` subclasses.  Each discovered class
is instantiated once to read its ``name`` property, then stored in the
registry keyed by that name.

Activation of a specific provider is controlled by the ``AUTH_PROVIDER``
environment variable in ``auth.py`` — discovery only populates the
*available* set.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import Optional

from .base import AuthProvider

_log = logging.getLogger(__name__)

_PROVIDER_REGISTRY: dict[str, type[AuthProvider]] = {}


def _discover_providers() -> None:
    """Scan this package for AuthProvider subclasses and register them."""
    for _finder, module_name, _ispkg in pkgutil.iter_modules(__path__):
        if module_name == "base":
            continue
        try:
            mod = importlib.import_module(f".{module_name}", __package__)
            for attr_name in dir(mod):
                cls = getattr(mod, attr_name)
                if (
                    isinstance(cls, type)
                    and issubclass(cls, AuthProvider)
                    and cls is not AuthProvider
                ):
                    instance = cls()
                    _PROVIDER_REGISTRY[instance.name] = cls
                    _log.debug(
                        "Discovered auth provider: '%s' from %s",
                        instance.name,
                        module_name,
                    )
        except ImportError as exc:
            _log.debug("Skipped auth provider module '%s' (missing dep): %s", module_name, exc)


_discover_providers()

# Aliases let users write AUTH_PROVIDER=oauth2 instead of AUTH_PROVIDER=oidc.
# The OIDC provider handles any OAuth2 + JWT + JWKS identity provider, not
# just strict OpenID Connect, so the alias avoids confusion.
_ALIASES: dict[str, str] = {
    "oauth2": "oidc",
}


def get_provider_class(name: str) -> Optional[type[AuthProvider]]:
    """Return the provider class registered under *name* (or alias), or ``None``."""
    canonical = _ALIASES.get(name, name)
    return _PROVIDER_REGISTRY.get(canonical)


def list_available_providers() -> list[str]:
    """Return sorted names of all discovered providers (including aliases)."""
    return sorted(set(_PROVIDER_REGISTRY.keys()) | set(_ALIASES.keys()))
