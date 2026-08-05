from pathlib import Path
import sys

from PyInstaller.utils.hooks import collect_all, collect_submodules


project_root = Path(SPECPATH).parent
package_root = project_root / "py-src" / "data_formulator"

datas = [(str(package_root / "dist"), "data_formulator/dist")]
binaries = []
hiddenimports = collect_submodules("data_formulator")

for package in (
    "azure.identity",
    "azure.kusto.data",
    "flask_session",
    "litellm",
    "mssql_python",
    "tiktoken",
    "tiktoken_ext",
    "webview",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

a = Analysis(
    [str(project_root / "packaging" / "data_formulator_desktop.py")],
    pathex=[str(project_root / "py-src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Data Formulator",
    console=False,
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
    )