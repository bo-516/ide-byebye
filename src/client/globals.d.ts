/** Ambient browser extensions used by the inspector client. */
interface Window {
  __CII_INSTALLED__?: boolean;
  __CODE_INTENT_INSPECTOR__?: Record<string, unknown>;
}

interface Navigator {
  userAgentData?: {
    platform?: string;
  };
}
