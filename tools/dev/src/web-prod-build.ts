import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * `--prod` serves the production web build in apps/web/.next, which loads several times faster than the dev
 * server. A build older than the checkout would keep serving the previous version after an update, so start
 * rebuilds it when anything it is built from changed, the way the daemon and contracts builds are kept fresh.
 *
 * The stamp records when the last successful build started; `next build` clears .next first, so a failed or
 * interrupted build leaves no stamp and the next start builds again.
 */
const STAMP_PATH = "apps/web/.next/od-prod-build.json";

// What the web bundle is built from. Workspace packages resolve through their dist, and components is also
// transpiled from source. Files next build writes itself (next-env.d.ts, tsbuildinfo) are deliberately absent.
const BUILD_INPUTS = [
  "apps/web/app",
  "apps/web/src",
  "apps/web/public",
  "apps/web/next.config.ts",
  "apps/web/package.json",
  "apps/web/postcss.config.mjs",
  "apps/web/tsconfig.json",
  "apps/web/tsconfig.build.json",
  ...["components", "contracts", "host", "platform", "sidecar", "sidecar-proto"].flatMap((name) => [
    `packages/${name}/src`,
    `packages/${name}/dist`,
    `packages/${name}/package.json`,
  ]),
  "pnpm-lock.yaml",
];

export const WEB_PROD_BUILD_ARGS = ["--filter", "@open-design/web", "exec", "next", "build"];

export type WebProdBuildCheck = { needed: false } | { needed: true; reason: string };

async function newestFile(filePath: string): Promise<{ filePath: string; mtimeMs: number } | null> {
  const entry = await lstat(filePath).catch(() => null);
  if (entry == null) return null;
  if (!entry.isDirectory()) return { filePath, mtimeMs: entry.mtimeMs };
  let newest: { filePath: string; mtimeMs: number } | null = null;
  for (const child of await readdir(filePath, { withFileTypes: true }).catch(() => [])) {
    if (child.name === "node_modules") continue;
    const candidate = await newestFile(path.join(filePath, child.name));
    if (candidate != null && (newest == null || candidate.mtimeMs > newest.mtimeMs)) newest = candidate;
  }
  return newest;
}

export async function checkWebProdBuild(workspaceRoot: string): Promise<WebProdBuildCheck> {
  const stamp = await readFile(path.join(workspaceRoot, STAMP_PATH), "utf8")
    .then((text) => JSON.parse(text) as { startedAtMs?: unknown })
    .catch(() => null);
  if (typeof stamp?.startedAtMs !== "number" || await lstat(path.join(workspaceRoot, "apps/web/.next/BUILD_ID")).catch(() => null) == null) {
    return { needed: true, reason: "there is no production web build yet" };
  }
  for (const input of BUILD_INPUTS) {
    const newest = await newestFile(path.join(workspaceRoot, input));
    if (newest != null && newest.mtimeMs > stamp.startedAtMs) {
      const changed = path.relative(workspaceRoot, newest.filePath).replaceAll("\\", "/");
      return { needed: true, reason: `${changed} changed after the last production web build` };
    }
  }
  return { needed: false };
}

export async function recordWebProdBuild(workspaceRoot: string, startedAtMs: number): Promise<void> {
  await writeFile(path.join(workspaceRoot, STAMP_PATH), `${JSON.stringify({ startedAtMs })}\n`);
}

/** A server bundle in .next, which is where `--prod` serves from; without these Next makes a static export. */
export function webProdBuildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, NODE_ENV: "production", OD_WEB_OUTPUT_MODE: "server", OD_WEB_PROD: "1" };
}
