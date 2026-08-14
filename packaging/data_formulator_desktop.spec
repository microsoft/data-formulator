from pathlib import Path
import sys

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules


project_root = Path(SPECPATH).parent
package_root = project_root / "py-src" / "data_formulator"
icon_path = project_root / "packaging" / "icons" / (
    "data-formulator.icns" if sys.platform == "darwin" else "data-formulator.ico"
)

datas = [(str(package_root / "dist"), "data_formulator/dist")]
datas += collect_data_files(
    "data_formulator",
    includes=[
        "analyst/skills/**/SKILL.md",
        "analyst/skills/**/tools.json",
        "data_loader/guides/*.md",
    ],
)
binaries = []
hiddenimports = collect_submodules("data_formulator")

for package in (
    "azure.identity",
    "azure.kusto.data",
    "flask_session",
    "httpcore",
    "httpx",
    "litellm",
    "mssql_python",
    "openai",
    "pyarrow",
    "tiktoken",
    "tiktoken_ext",
    "webview",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

if sys.platform == "win32":
    # pywebview's WinForms backend loads Python.Runtime.dll via pythonnet. That
    # file is a managed .NET assembly, not a native DLL: collected as a binary,
    # PyInstaller rewrites it and the CLR can no longer resolve
    # Python.Runtime.Loader.Initialize. Ship it verbatim as data instead.
    # `collect_data_files` skips shared libraries, so the DLLs are listed by hand.
    import importlib.util

    for _pkg, _subdir in (("pythonnet", "runtime"), ("clr_loader", None)):
        _spec = importlib.util.find_spec(_pkg)
        if not _spec or not _spec.origin:
            continue
        _root = Path(_spec.origin).parent
        _search = _root / _subdir if _subdir else _root
        for _dll in _search.rglob("*.dll"):
            _dest = Path(_pkg) / _dll.parent.relative_to(_root)
            datas.append((str(_dll), str(_dest)))

    datas += collect_data_files("pythonnet")
    datas += collect_data_files("clr_loader")
    hiddenimports += [
        "clr",
        "clr_loader",
        "clr_loader.netfx",
        "clr_loader.util",
    ]

a = Analysis(
    [str(project_root / "packaging" / "data_formulator_desktop.py")],
    pathex=[str(project_root / "py-src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)

if sys.platform == "win32":
    # Drop the binary copies the analysis picked up, so the verbatim data copies
    # above are the ones that land in the bundle.
    _managed = ("python.runtime.dll",)
    a.binaries = [
        entry for entry in a.binaries
        if not str(entry[0]).lower().endswith(_managed)
    ]
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Data Formulator",
    console=False,
    icon=str(icon_path),
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="Data Formulator",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="Data Formulator.app",
        bundle_identifier="com.microsoft.data-formulator",
        icon=str(icon_path),
    )
