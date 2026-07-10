"""Container App deployment safety tests for stateful runtime components."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

pytestmark = [pytest.mark.backend]

_REPO_ROOT = Path(__file__).resolve().parents[3]
_MAIN_BICEP = _REPO_ROOT / "infra" / "main.bicep"
_MAIN_PARAMETERS = _REPO_ROOT / "infra" / "main.bicepparam"
_CONTAINERAPP_BICEP = _REPO_ROOT / "infra" / "modules" / "containerapp.bicep"
_NETWORK_BICEP = _REPO_ROOT / "infra" / "modules" / "network.bicep"
_OPENAI_BICEP = _REPO_ROOT / "infra" / "modules" / "openai.bicep"
_REGISTRY_BICEP = _REPO_ROOT / "infra" / "modules" / "registry.bicep"
_DOCKERFILE = _REPO_ROOT / "Dockerfile"
_PYPROJECT = _REPO_ROOT / "pyproject.toml"


def test_container_app_is_single_replica_while_state_is_instance_local() -> None:
    """Autoscaling must stay disabled until every required state store is shared."""
    content = _CONTAINERAPP_BICEP.read_text(encoding="utf-8")
    match = re.search(r"maxReplicas:\s*(\d+)", content)

    assert match is not None, "Container App must declare an explicit replica cap"
    assert int(match.group(1)) == 1


def test_production_container_uses_gunicorn() -> None:
    dockerfile = _DOCKERFILE.read_text(encoding="utf-8")
    pyproject = _PYPROJECT.read_text(encoding="utf-8")

    assert '"gunicorn' in pyproject
    assert 'ENTRYPOINT ["gunicorn"' in dockerfile
    assert "data_formulator.app:app" in dockerfile


def test_production_ingress_state_is_parameterized() -> None:
    main = _MAIN_BICEP.read_text(encoding="utf-8")
    parameters = _MAIN_PARAMETERS.read_text(encoding="utf-8")
    container_app = _CONTAINERAPP_BICEP.read_text(encoding="utf-8")

    assert "customDomainName" in main
    assert "customDomainCertificateId" in main
    assert "customDomainName" in parameters
    assert "customDomains:" in container_app
    assert "traffic:" in container_app


def test_policy_managed_subnet_nsgs_are_preserved() -> None:
    main = _MAIN_BICEP.read_text(encoding="utf-8")
    parameters = _MAIN_PARAMETERS.read_text(encoding="utf-8")
    network = _NETWORK_BICEP.read_text(encoding="utf-8")

    assert "infrastructureSubnetNsgId" in main
    assert "privateEndpointSubnetNsgId" in main
    assert "infrastructureSubnetNsgId" in parameters
    assert "privateEndpointSubnetNsgId" in parameters
    assert network.count("networkSecurityGroup:") == 2


def test_production_references_policy_managed_vnet_without_updating_it() -> None:
    main = _MAIN_BICEP.read_text(encoding="utf-8")
    parameters = _MAIN_PARAMETERS.read_text(encoding="utf-8")
    network = _NETWORK_BICEP.read_text(encoding="utf-8")

    assert "useExistingVirtualNetwork" in main
    assert "param useExistingVirtualNetwork = true" in parameters
    assert "existingVirtualNetwork" in network
    assert "if (!useExistingVirtualNetwork)" in network


def test_stable_service_defaults_are_reasserted() -> None:
    container_app = _CONTAINERAPP_BICEP.read_text(encoding="utf-8")
    registry = _REGISTRY_BICEP.read_text(encoding="utf-8")

    assert "peerAuthentication:" in container_app
    assert "peerTrafficConfiguration:" in container_app
    assert "networkRuleBypassAllowedForTasks: false" in registry
    assert "roleAssignmentMode: 'LegacyRegistryPermissions'" in registry
