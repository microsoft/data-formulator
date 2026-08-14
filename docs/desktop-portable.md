# Portable desktop build

Data Formulator's desktop bundle runs the existing Flask application on a
random loopback port and displays it in a native pywebview window. It is built
as a PyInstaller `onedir` bundle so users can unzip it and launch it without
installing Python or Node.js.

## Build

Build on each target operating system; PyInstaller does not cross-compile.

```bash
uv sync --extra desktop
./scripts/build-desktop.sh
```

On Windows and Linux, the output is `dist/Data Formulator/`; distribute the
complete directory as a zip archive. On macOS, distribute
`dist/Data Formulator.app`. Code signing and macOS notarization should be added
before a public release.

## Azure CLI authentication

Kusto and other Entra-enabled connectors reuse the user's Azure CLI identity.
The desktop app does not request delegated `user_impersonation` permission for
its own app registration.

Azure CLI remains an external prerequisite for Azure connections. Users can
sign in from Data Formulator's connector UI; the backend runs `az login` and
then Azure Identity obtains tokens from the CLI cache. Other features remain
usable when Azure CLI is absent.

The launcher adds common Azure CLI install locations to `PATH`, including
Homebrew locations that are normally missing when a macOS app is opened from
Finder.