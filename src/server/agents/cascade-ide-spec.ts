/**
 * Product-specific constants shared by the two Cascade-family IDE adapters (Devin Desktop, Windsurf).
 *
 * Boundary: every difference between the two apps lives here — the bridge, launcher, host-restart, and
 * emitted extension code all read a spec instead of branching on app names.
 */

/**
 * One Cascade-family IDE product.
 *
 * Boundary: `commandIds` are internal workbench command ids observed in the shipped bundles; they are not a
 * public API and can change between IDE versions. `lsMarker` / `helperMarker` identify processes — wrong
 * values disable only the extension-host restart fallback, not the bridge itself.
 */
export interface CascadeIdeSpec {
    /** Adapter id and registry name (`devin-ide`, `windsurf-ide`). */
    adapterId: string;
    /** Product name in user-facing and log strings (`Devin`, `Windsurf`). */
    displayName: string;
    /** Per-user app data directory under `~` (`'.devin'`, `'.windsurf'`). */
    dataDirName: string;
    /** Bridge directory name under the data dir (`ide-byebye-bridge`). */
    bridgeDirName: string;
    /** Installed extension folder under `<dataDir>/extensions` (includes the version suffix). */
    extensionDirName: string;
    /** package.json `name` for the emitted bridge extension. */
    extensionName: string;
    /** Default CLI name probed on PATH. */
    defaultCommand: string;
    /** macOS app-bundle CLI (empty when the product has none). */
    darwinAppCli?: string;
    /** CLI path under `%LOCALAPPDATA%` on Windows (empty when unknown). */
    win32AppDataCli?: string;
    /** Substring that identifies the extension-host process (`'<App> Helper (Plugin)'`). */
    helperMarker: string;
    /**
     * Substring identifying this app's language server: the `--extensions_dir` flag value segment
     * (`'/.devin/extensions'`). Normalized to forward slashes before matching.
     */
    extensionsDirMarker: string;
    /** `sendChatActionMessage` command ids in probe order (the app prefix first). */
    commandIds: string[];
    /** Launcher file tag so devin-ide / windsurf-ide launchers are distinguishable in `launches/`. */
    launchTag: string;
    /** Install hint for `isAvailable` errors. */
    installHint: string;
}

/** Devin Desktop (the merged Windsurf product). */
export const DEVIN_IDE_SPEC: CascadeIdeSpec = {
    adapterId: 'devin-ide',
    displayName: 'Devin',
    dataDirName: '.devin',
    bridgeDirName: 'ide-byebye-bridge',
    extensionDirName: 'local.ide-byebye-cascade-bridge-0.1.0',
    extensionName: 'ide-byebye-cascade-bridge',
    defaultCommand: 'devin-desktop',
    darwinAppCli: '/Applications/Devin.app/Contents/Resources/app/bin/devin-desktop',
    helperMarker: 'Devin Helper (Plugin)',
    extensionsDirMarker: '/.devin/extensions',
    commandIds: ['devin.sendChatActionMessage', 'windsurf.sendChatActionMessage'],
    launchTag: 'devin-ide',
    installHint: 'Install Devin Desktop and ensure `devin-desktop` is on PATH (Shell Command from the app menu).',
};

/** Windsurf (pre-merge standalone editor). */
export const WINDSURF_IDE_SPEC: CascadeIdeSpec = {
    adapterId: 'windsurf-ide',
    displayName: 'Windsurf',
    dataDirName: '.windsurf',
    bridgeDirName: 'ide-byebye-bridge',
    extensionDirName: 'local.ide-byebye-cascade-bridge-0.1.0',
    extensionName: 'ide-byebye-cascade-bridge',
    defaultCommand: 'windsurf',
    darwinAppCli: '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf',
    win32AppDataCli: 'Programs\\Windsurf\\bin\\windsurf.cmd',
    helperMarker: 'Windsurf Helper (Plugin)',
    extensionsDirMarker: '/.windsurf/extensions',
    commandIds: ['windsurf.sendChatActionMessage', 'devin.sendChatActionMessage'],
    launchTag: 'windsurf-ide',
    installHint: 'Install Windsurf and ensure `windsurf` is on PATH (Shell Command from the app menu).',
};
