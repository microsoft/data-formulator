# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from .local_sandbox import LocalSandbox
from .docker_sandbox import DockerSandbox

# Valid values for the --sandbox CLI option / SANDBOX env var.
SANDBOX_OPTIONS = ("local", "docker")


def create_sandbox(sandbox: str = "local") -> LocalSandbox | DockerSandbox:
    """Instantiate a sandbox from a config string.

    Parameters
    ----------
    sandbox : str
        ``"local"`` (default) or ``"docker"``.
    """
    if sandbox == "docker":
        return DockerSandbox()
    return LocalSandbox()
