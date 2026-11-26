from pathlib import Path
import hashlib
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
        "analyst/chart_catalog.json",
        "data_loader/guides/*.md",
    ],
)
# Shipped demos: profile, images, story seeds and the build.py the app runs to install them.
datas += collect_data_files("data_formulator", includes=["demos/**/*"], excludes=["**/__pycache__/**"],
                            include_py_files=True)
binaries = []
hiddenimports = collect_submodules("data_formulator")
# Session sharing (design-docs/71): Twisted, autobahn and txaio choose their backends at runtime.
hiddenimports += collect_submodules("wormhole", filter=lambda name: ".test" not in name)
hiddenimports += collect_submodules("txaio") + collect_submodules("autobahn.twisted")
# autobahn's cffi validators read their C sources at import and load top-level extension modules.
datas += collect_data_files("autobahn", includes=["nvx/*.c"])
hiddenimports += ["_nvx_utf8validator", "_nvx_xormasker"]

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
    # The Public Suffix List snapshot sign-in specs are checked against (accounts/specs.py).
    "tldextract",
    "webview",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(
        package,
        include_py_files=False,
        exclude_datas=["include/**", "includes/**", "src/**", "tests/**"] if package == "pyarrow" else None,
    )
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

if sys.platform == "win32":
    # The WinForms backend loads .NET assemblies through pythonnet / clr_loader:
    # - clr_loader's native ClrLoader.dll (loaded via cffi by the netfx loader)
    #   must ship verbatim; collect_data_files skips DLLs, so collect it here.
    # - pythonnet's managed assembly Python.Runtime.dll is re-added after
    #   Analysis (see _configure_windows_runtime); only non-DLL data files are
    #   collected here.
    import importlib.util

    for _pkg in ("clr_loader",):
        _spec = importlib.util.find_spec(_pkg)
        if _spec and _spec.origin:
            _root = Path(_spec.origin).parent
            for _dll in _root.rglob("*.dll"):
                _dest = Path(_pkg) / _dll.parent.relative_to(_root)
                datas.append((str(_dll), str(_dest)))
    datas += collect_data_files("pythonnet")
    datas += collect_data_files("clr_loader")
    hiddenimports += ["clr", "clr_loader", "clr_loader.netfx", "clr_loader.util"]


def _pythonnet_runtime_dll() -> Path:
    """Return the managed Python.Runtime.dll from the installed pythonnet."""
    import importlib.util

    spec = importlib.util.find_spec("pythonnet")
    if not spec or not spec.origin:
        raise SystemExit("pythonnet is not installed; the Windows desktop build needs it")
    dll = Path(spec.origin).parent / "runtime" / "Python.Runtime.dll"
    if not dll.exists():
        raise SystemExit(f"pythonnet runtime assembly not found: {dll}")
    return dll


def _configure_windows_runtime(a):
    """Fix how the pythonnet managed assembly is bundled.

    Python.Runtime.dll is a managed .NET assembly, not a native DLL. The
    clr_loader needs it to resolve Python.Runtime.Loader.Initialize. PyInstaller
    classifies any .dll as BINARY, and BINARY entries take precedence over DATA
    entries with the same destination; pythonnet's own hook also pulls in 96
    .NET Core reference assemblies from runtime/ that the WinForms / .NET
    Framework path never uses. So we drop every pythonnet/runtime BINARY and
    re-add Python.Runtime.dll as verbatim DATA (entries appended after Analysis
    are not reclassified).
    """
    prefix = "pythonnet/runtime/"
    a.binaries = [
        entry for entry in a.binaries
        if not str(entry[0]).replace("\\", "/").startswith(prefix)
    ]
    a.datas.append(("pythonnet/runtime/Python.Runtime.dll", str(_pythonnet_runtime_dll()), "DATA"))


def _verify_windows_runtime():
    """Post-build check: the bundled assembly must exist and be byte-identical."""
    bundle = Path(DISTPATH) / "Data Formulator" / "_internal" / "pythonnet" / "runtime" / "Python.Runtime.dll"
    if not bundle.exists():
        raise SystemExit(f"Windows bundle is missing {bundle}; the WinForms backend will fail at startup")
    if hashlib.sha256(bundle.read_bytes()).digest() != hashlib.sha256(_pythonnet_runtime_dll().read_bytes()).digest():
        raise SystemExit(f"{bundle} differs from the pythonnet source; CLR loading will fail")
    print(f"OK: bundled Python.Runtime.dll matches the pythonnet source ({bundle})")


a = Analysis(
    [str(project_root / "packaging" / "data_formulator_desktop.py")],
    pathex=[str(project_root / "py-src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)

if sys.platform == "win32":
    _configure_windows_runtime(a)

pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Data Formulator",
    console=False,
    icon=str(icon_path),
    entitlements_file=str(project_root / "packaging" / "macos" / "entitlements.plist") if sys.platform == "darwin" else None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="Data Formulator",
)

if sys.platform == "win32":
    _verify_windows_runtime()

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="Data Formulator.app",
        bundle_identifier="com.microsoft.data-formulator",
        icon=str(icon_path),
        # macOS asks before an app sends Apple Events or opens these folders, showing these strings; without the Apple
        # Events one it refuses outright. The browser tool drives the user's Edge, Chrome or Safari through Apple Events
        # (data_formulator/browser/applescript.py), and the agent's terminal commands and file loads read the user's files.
        info_plist={
            "NSAppleEventsUsageDescription":
                "Data Formulator opens and reads web pages in your browser when you ask the agent to.",
            "NSDocumentsFolderUsageDescription":
                "Data Formulator reads files in your Documents folder when you load them or ask the agent to.",
            "NSDesktopFolderUsageDescription":
                "Data Formulator reads files on your Desktop when you load them or ask the agent to.",
            "NSDownloadsFolderUsageDescription":
                "Data Formulator reads files in your Downloads folder when you load them or ask the agent to.",
            "NSRemovableVolumesUsageDescription":
                "Data Formulator reads files on external drives when you load them or ask the agent to.",
            "NSNetworkVolumesUsageDescription":
                "Data Formulator reads files on network drives when you load them or ask the agent to.",
        },
    )
