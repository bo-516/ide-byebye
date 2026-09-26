// Package entry. Per-bundler entry points let callers pick the adapter without ever passing a `bundler` string:
//   import inspector from 'ide-byebye'           // Vite (back-compat default)
//   import inspector from 'ide-byebye/vite'      // Vite (explicit)
//   import inspector from 'ide-byebye/webpack'   // webpack
//   import inspector from 'ide-byebye/rspack'    // rspack
//   import inspector from 'ide-byebye/rsbuild'   // rsbuild
//   import inspector from 'ide-byebye/esbuild'   // esbuild
//   import inspector from 'ide-byebye/farm'      // Farm
//   import withIdeByebye from 'ide-byebye/next'  // Next.js (Turbopack + webpack, auto-mounted bootstrap)
//   import inspector from 'ide-byebye/turbopack' // Next.js Turbopack rules only
//   import inspector from 'ide-byebye/mako'      // Umi Mako (data-insp-path only)
//   import { angularProxy } from 'ide-byebye/angular' // Angular CLI (proxyConfig + dev scripts)
export type {
    PathStyle,
    Locale,
    AgentId,
    ApplyMode,
    ClickModifier,
    AgentOpenOptions,
    ClaudeAppAgentOptions,
    CodexAppAgentOptions,
    CursorAppAgentOptions,
    GrokBuildAgentOptions,
    AgentEntry,
    AgentsOptions,
    RecordingOptions,
    CodeInspectorOptions,
    EscapeTag,
    SourceStampOptions,
    IdeByebyeOptions,
    NextIdeByebyeOptions,
    AngularIdeByebyeOptions,
    VitePlugin,
    PluginInstance,
} from './types.js';
export {
    vite,
    webpack,
    rspack,
    rsbuild,
    esbuild,
    farm,
    turbopack,
    mako,
    codeIntentInspectorPlugin,
} from './plugin.js';
export { withIdeByebye } from './server/next/with-next.js';
export { angularProxy } from './server/angular/proxy.js';
export { codeIntentInspectorPlugin as default } from './plugin.js';
