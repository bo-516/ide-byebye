/**
 * Design tokens for the inspector UI: type, neutral surfaces, accent, semantic colours, and elevation, in a light
 * theme plus a dark theme that follows the OS `prefers-color-scheme`.
 *
 * Boundary: tokens live on `:host` because custom properties survive the host's inline `all: initial` reset, whereas
 * inherited real properties (`font-family`, `color-scheme`) do not — those are re-applied on every top-level shadow
 * child here instead. Every later fragment reads these variables, so this must be composed first; a fragment used
 * without it renders with unresolved `var()` values (transparent surfaces, default fonts).
 *
 * @type {string} CSS fragment composed into the shadow-root stylesheet.
 */
export const TOKENS_STYLE = `
:host {
  --cii-font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --cii-mono: ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", "Cascadia Code", Menlo, Consolas, "Liberation Mono", monospace;

  --cii-surface: #ffffff;
  --cii-surface-raised: #ffffff;
  --cii-surface-sunken: #f5f5f7;
  --cii-surface-veil: rgba(255, 255, 255, 0.74);
  --cii-key: #ffffff;
  --cii-fill: rgba(22, 22, 30, 0.05);
  --cii-fill-strong: rgba(22, 22, 30, 0.09);
  --cii-line: rgba(22, 22, 30, 0.08);
  --cii-line-strong: rgba(22, 22, 30, 0.15);

  --cii-text: #18181d;
  --cii-text-muted: #5c5c68;
  --cii-text-faint: #9696a2;

  --cii-accent: #6655ff;
  --cii-accent-text: #4f3ff0;
  --cii-accent-soft: rgba(102, 85, 255, 0.11);
  --cii-accent-softer: rgba(102, 85, 255, 0.06);

  --cii-ink: #18181d;
  --cii-ink-top: #35353e;
  --cii-ink-hover: #2b2b33;
  --cii-on-ink: #ffffff;
  --cii-on-ink-soft: rgba(255, 255, 255, 0.16);

  --cii-danger: #e5484d;
  --cii-danger-soft: rgba(229, 72, 77, 0.14);
  --cii-success: #138a55;
  --cii-success-soft: rgba(19, 138, 85, 0.09);
  --cii-success-line: rgba(19, 138, 85, 0.32);
  --cii-warning: #c26d00;

  --cii-scrim: rgba(12, 12, 16, 0.22);
  --cii-scrim-strong: rgba(12, 12, 16, 0.56);
  --cii-shadow-panel: 0 0 0 1px rgba(22, 22, 30, 0.07), 0 1px 2px rgba(22, 22, 30, 0.05),
    0 12px 28px -8px rgba(22, 22, 30, 0.14), 0 36px 80px -18px rgba(22, 22, 30, 0.30);
  --cii-shadow-pop: 0 0 0 1px rgba(22, 22, 30, 0.08), 0 6px 16px -4px rgba(22, 22, 30, 0.12),
    0 20px 44px -12px rgba(22, 22, 30, 0.26);
  --cii-shadow-key: 0 0 0 1px rgba(22, 22, 30, 0.09), 0 1px 2px rgba(22, 22, 30, 0.06);
  --cii-shadow-key-hover: 0 0 0 1px rgba(22, 22, 30, 0.14), 0 3px 8px -2px rgba(22, 22, 30, 0.14);
  --cii-shadow-ink: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 2px rgba(22, 22, 30, 0.24),
    0 6px 14px -6px rgba(22, 22, 30, 0.5);
  --cii-tip-bg: #18181d;
  --cii-tip-text: #f5f5f7;
}
:host > * {
  color-scheme: light;
  font-family: var(--cii-font);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
@media (prefers-color-scheme: dark) {
  :host {
    --cii-surface: #1c1c21;
    --cii-surface-raised: #26262d;
    --cii-surface-sunken: #151518;
    --cii-surface-veil: rgba(38, 38, 45, 0.76);
    --cii-key: #28282f;
    --cii-fill: rgba(255, 255, 255, 0.06);
    --cii-fill-strong: rgba(255, 255, 255, 0.11);
    --cii-line: rgba(255, 255, 255, 0.08);
    --cii-line-strong: rgba(255, 255, 255, 0.15);

    --cii-text: #ededf1;
    --cii-text-muted: #a5a5b1;
    --cii-text-faint: #6f6f7c;

    --cii-accent: #8d80ff;
    --cii-accent-text: #aaa1ff;
    --cii-accent-soft: rgba(141, 128, 255, 0.17);
    --cii-accent-softer: rgba(141, 128, 255, 0.09);

    --cii-ink: #e7e7ed;
    --cii-ink-top: #ffffff;
    --cii-ink-hover: #ffffff;
    --cii-on-ink: #18181d;
    --cii-on-ink-soft: rgba(24, 24, 29, 0.10);

    --cii-danger: #f2555a;
    --cii-danger-soft: rgba(242, 85, 90, 0.18);
    --cii-success: #3dd68c;
    --cii-success-soft: rgba(61, 214, 140, 0.12);
    --cii-success-line: rgba(61, 214, 140, 0.34);
    --cii-warning: #f5a524;

    --cii-scrim: rgba(0, 0, 0, 0.40);
    --cii-scrim-strong: rgba(0, 0, 0, 0.64);
    --cii-shadow-panel: 0 0 0 1px rgba(255, 255, 255, 0.09), inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 16px 40px -8px rgba(0, 0, 0, 0.55), 0 40px 90px -20px rgba(0, 0, 0, 0.7);
    --cii-shadow-pop: 0 0 0 1px rgba(255, 255, 255, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 20px 44px -10px rgba(0, 0, 0, 0.65);
    --cii-shadow-key: 0 0 0 1px rgba(255, 255, 255, 0.07), inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 1px 2px rgba(0, 0, 0, 0.3);
    --cii-shadow-key-hover: 0 0 0 1px rgba(255, 255, 255, 0.13), inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 3px 8px -2px rgba(0, 0, 0, 0.4);
    --cii-shadow-ink: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 1px 2px rgba(0, 0, 0, 0.4),
      0 6px 16px -6px rgba(0, 0, 0, 0.6);
    --cii-tip-bg: #f0f0f4;
    --cii-tip-text: #18181d;
  }
  :host > * { color-scheme: dark; }
}
`;
