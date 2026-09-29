/**
 * Ambient browser extensions used by the inspector client.
 * Purpose: merge the install flag and the UA-CH platform onto the DOM `Window` and `Navigator`.
 * Boundary: the augmentations live in `declare global`, and `export {}` keeps this file a module.
 * A later import must not turn them into module-scoped interfaces, or `window.__CII_INSTALLED__`
 * and `navigator.userAgentData` stop type-checking at the boot call site.
 */
export {};

declare global {
    interface Window {
        /** Set once boot has installed listeners, so a second injection does not double-bind. */
        __CII_INSTALLED__?: boolean;
        /** Host page hook reserved for the inspector runtime. Optional; absent on a normal page. */
        __CODE_INTENT_INSPECTOR__?: Record<string, unknown>;
    }

    interface Navigator {
        /**
         * User-Agent Client Hints platform, when the browser exposes it.
         * Absent on browsers that only provide the legacy `navigator.platform` string.
         */
        userAgentData?: {
            platform?: string;
        };
    }
}
