/**
 * What the daemon this client is talking to can actually do, as opposed to what
 * the client-side runtime looks like. Served per request and never persisted:
 * the same data dir can be opened by a desktop daemon on Monday and a headless
 * one on Tuesday, so a stored answer would be a stale claim.
 *
 * Optional so a newer client keeps working against an older daemon — treat an
 * absent field as "unknown", not as "false".
 */
export interface AppRuntimeCapabilities {
  /**
   * Whether the daemon can render deck slides off-screen — the capability
   * behind PPTX / screenshot-PDF / image export. Only the desktop sidecar
   * injects that renderer, so a headless or container deployment reports
   * `false` and those export routes answer 501.
   *
   * Deliberately NOT derivable from `packaged`: a packaged binary run as a
   * plain daemon still has no renderer.
   */
  slideRenderer: boolean;
}

export interface AppVersionInfo {
  version: string;
  channel: string;
  packaged: boolean;
  platform: string;
  arch: string;
  /** The source build a git checkout runs; absent in a packaged app and from older daemons. */
  build?: AppBuildInfo;
  capabilities?: AppRuntimeCapabilities;
}

export interface AppBuildInfo {
  /** Short commit hash of HEAD when the daemon started. */
  commit: string;
  /** The tag HEAD sits exactly on, such as a test round; null between tags. */
  tag: string | null;
  /** Tracked files differ from the commit, so the commit alone does not describe the build. */
  localChanges: boolean;
}

export interface AppVersionResponse {
  version: AppVersionInfo;
}
