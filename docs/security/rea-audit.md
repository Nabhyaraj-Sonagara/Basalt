# REA audit of the Basalt desktop build

**Date:** 2026-11-16 · **Tool:** REA (`rea-agents` 6.9.0) · **Target:** `apps/desktop/release/linux-unpacked` (Linux x64, Electron 45.3.3)

REA was used on Basalt's **own** packaged build to check its Electron security posture. This was static analysis of the shipped files plus a fuse read. Nothing here observed the app running.

## What REA observed

| Area | Result | Evidence |
|---|---|---|
| `BrowserWindow` webPreferences | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true` (literal values, exact) | `ev_1b7d70d5…` (analyze-javascript-application on `out/main` + `out/preload`) |
| Preload bridge | One `contextBridge` API, `window.basalt`, with `app`, `hive` and `ai` groups. Two members are built dynamically, so REA lists them as partially unknown. | same |
| IPC | Main handlers are registered through one wrapper, so REA sees the channel names as dynamic. The renderer listens on three literal push channels: `hive:change`, `ai:chat` and `ai:index-progress`. **REA observed no IPC sender validation in the first build.** | same |
| Custom protocol | `basalt-file` is registered with `protocol.handle`. | same |
| Electron fuses (first build) | **Exposed:** RunAsNode (high), OnlyLoadAppFromAsar off (medium), NodeCliInspectArguments on (medium). | `ev_ed873d72…` (audit-release-exposure) |
| Payload | `packaging.extractable_payload` (low): the app ships in a readable asar. This is expected for an open-source app. | same |

## What changed in response

1. **Electron fuses** are now set at packaging time in `apps/desktop/electron-builder.yml`:
   - `runAsNode: false`
   - `enableNodeOptionsEnvironmentVariable: false`
   - `enableNodeCliInspectArguments: false`
   - `onlyLoadAppFromAsar: true`
   - `enableEmbeddedAsarIntegrityValidation: true`
   - `enableCookieEncryption: true`

   REA's fuse reader confirms them on the rebuilt binary (`ev_1be1cba6…`). `GrantFileProtocolExtraPrivileges` stays enabled because the renderer loads from `file://`. Turning it off was tried and dropped: that build didn't get past launch in this environment.
2. **IPC sender validation.** Every `ipcMain.handle` call now rejects a call unless it comes from Basalt's own window and renderer origin (`trustedSender` in `src/main/index.ts`).

## Re-audit

After the rebuild, `audit-release-exposure` (`ev_1edaa3f4…`) no longer reports any fuse as **exposed**. It reports them as **unknown** instead. Its aggregate check reads four ELF images in the bundle and doesn't attribute fuse state to the main executable alone. The direct fuse read above is the authoritative result for `basalt`. ASAR integrity is enforced by Electron on macOS and Windows only, so on Linux it stays unknown.

Two more checks after the change:
- The fused build launches and opens a hive (`apps/desktop/e2e/packaged-check.cjs`).
- `ELECTRON_RUN_AS_NODE=1 basalt -e …` now starts the GUI instead of a Node shell.

## Not covered

- Runtime behaviour. Nothing was traced while the app ran.
- Renderer bundle internals. Mermaid's chunks made a whole-asar analysis exceed the time budget, so the analysis covered only main and preload.
- macOS and Windows builds.
- Code signing.
