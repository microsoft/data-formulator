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

# Both "oidc" and "oauth2" map to the same OIDCProvider class.
# The provider reads AUTH_PROVIDER at runtime to choose the correct
# discovery path (openid-configuration vs oauth-authorization-server).
_EXTRA_NAMES: dict[str, str] = {
    "oauth2": "oidc",
}

for _alias, _target in _EXTRA_NAMES.items():
    if _alias not in _PROVIDER_REGISTRY and _target in _PROVIDER_REGISTRY:
        _PROVIDER_REGISTRY[_alias] = _PROVIDER_REGISTRY[_target]


def get_provider_class(name: str) -> Optional[type[AuthProvider]]:
    """Return the provider class registered under *name*, or ``None``."""
    return _PROVIDER_REGISTRY.get(name)


def list_available_providers() -> list[str]:
    """Return sorted names of all discovered providers."""
    return sorted(_PROVIDER_REGISTRY.keys())
