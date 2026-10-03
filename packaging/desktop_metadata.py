import argparse
import json
import platform
import tomllib
from pathlib import Path

from packaging.version import Version


def release_metadata(project_file: Path) -> dict:
    version = Version(tomllib.loads(project_file.read_text())["project"]["version"])
    if version.epoch or version.dev is not None or version.post is not None or version.local or len(version.release) > 3:
        raise ValueError(f"Unsupported desktop release version: {version}")
    release = (*version.release, *([0] * (3 - len(version.release))))
    stage = 60000
    if version.pre:
        label, number = version.pre
        if number >= 10000:
            raise ValueError("Prerelease number must be below 10000")
        stage = {"a": 10000, "b": 20000, "rc": 30000}[label] + number
    parts = (*release, stage)
    if any(part > 65535 for part in parts):
        raise ValueError("Windows version components must fit in 16 bits")
    return {"version": str(version), "windows_version": ".".join(map(str, parts))}


def bundle_inventory(root: Path) -> dict:
    if not root.is_dir():
        raise ValueError(f"Bundle directory does not exist: {root}")
    groups = {}
    files = total_bytes = symlinks = source_files = 0
    for filename in sorted(root.rglob("*")):
        if filename.is_symlink():
            symlinks += 1
            continue
        if not filename.is_file():
            continue
        size = filename.stat().st_size
        group = filename.relative_to(root).parts[0]
        summary = groups.setdefault(group, {"files": 0, "bytes": 0})
        summary["files"] += 1
        summary["bytes"] += size
        files += 1
        total_bytes += size
        source_files += filename.suffix == ".py"
    return {
        "root": str(root), "host_architecture": platform.machine(),
        "files": files, "bytes": total_bytes, "symlinks": symlinks,
        "python_source_files": source_files, "groups": groups,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1] / "pyproject.toml")
    parser.add_argument("--inventory", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = release_metadata(args.project)
    if args.inventory:
        result["inventory"] = bundle_inventory(args.inventory)
    content = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content)
    else:
        print(content, end="")


if __name__ == "__main__":
    main()