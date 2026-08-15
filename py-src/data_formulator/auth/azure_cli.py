import os
import shutil
import sys
from pathlib import Path


def find_azure_cli() -> str | None:
    executable = shutil.which("az")
    if executable:
        return executable

    if sys.platform == "darwin":
        candidates = (
            "/opt/homebrew/bin/az",
            "/usr/local/bin/az",
        )
    elif sys.platform == "win32":
        candidates = tuple(
            str(Path(root) / "Microsoft SDKs" / "Azure" / "CLI2" / "wbin" / "az.cmd")
            for root in filter(None, (
                os.environ.get("ProgramFiles"),
                os.environ.get("ProgramFiles(x86)"),
            ))
        )
    else:
        candidates = ("/usr/bin/az", "/usr/local/bin/az")

    return next((path for path in candidates if Path(path).is_file()), None)


def expose_azure_cli() -> str | None:
    executable = find_azure_cli()
    if not executable:
        return None

    executable_dir = str(Path(executable).parent)
    path_entries = os.environ.get("PATH", "").split(os.pathsep)
    if executable_dir not in path_entries:
        os.environ["PATH"] = os.pathsep.join((executable_dir, *path_entries))
    return executable