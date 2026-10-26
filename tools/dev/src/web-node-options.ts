export const WEB_MAX_OLD_SPACE_SIZE_ENV = "OD_WEB_MAX_OLD_SPACE_SIZE_MB";

/** Applied only to the web child; never mutate the launcher's process.env. */
export function resolveWebRuntimeNodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const configured = env[WEB_MAX_OLD_SPACE_SIZE_ENV]?.trim();
  if (!configured) return {};
  const limit = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(`${WEB_MAX_OLD_SPACE_SIZE_ENV} must be a positive integer in MiB`);
  }
  // Node takes the last duplicate heap option. Preserve all other caller
  // options, including quoted paths, without reparsing or changing them.
  return { NODE_OPTIONS: [env.NODE_OPTIONS?.trim(), `--max-old-space-size=${limit}`].filter(Boolean).join(" ") };
}
