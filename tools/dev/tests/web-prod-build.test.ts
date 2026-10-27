import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { checkWebProdBuild, recordWebProdBuild, webProdBuildEnv } from "../src/web-prod-build.js";

const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const BUILT_AT = Date.parse("2026-10-27T03:00:00Z");

/** A workspace whose every file predates the build that will be recorded at BUILT_AT. */
function workspace(files: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), "web-prod-build-"));
  roots.push(root);
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), "x");
    utimesSync(path.join(root, file), new Date(BUILT_AT - 60_000), new Date(BUILT_AT - 60_000));
  }
  return root;
}
const touch = (root: string, file: string, at = BUILT_AT + 1_000) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), "y");
  utimesSync(path.join(root, file), new Date(at), new Date(at));
};

const SOURCES = ["apps/web/src/i18n/index.tsx", "apps/web/app/layout.tsx", "apps/web/next.config.ts", "packages/contracts/dist/index.mjs", "pnpm-lock.yaml"];
const BUILT = [...SOURCES, "apps/web/.next/BUILD_ID"];

// The team launcher serves the production web build, which loads several times faster than the dev server.
// After an update that build must not keep serving the previous version, so start rebuilds it when it is stale.
describe("the production web build", () => {
  it("is built when there is none yet", async () => {
    const root = workspace(SOURCES);
    const check = await checkWebProdBuild(root);
    assert.equal(check.needed, true);
    assert.match(check.needed ? check.reason : "", /no production web build/);
  });

  it("is built again when the build output is gone though the stamp is not", async () => {
    const root = workspace(SOURCES);
    mkdirSync(path.join(root, "apps/web/.next"), { recursive: true });
    await recordWebProdBuild(root, BUILT_AT);
    assert.equal((await checkWebProdBuild(root)).needed, true);
  });

  it("is reused while nothing it is built from changed", async () => {
    const root = workspace(BUILT);
    await recordWebProdBuild(root, BUILT_AT);
    assert.deepEqual(await checkWebProdBuild(root), { needed: false });
  });

  it("is rebuilt after a source or a workspace package it bundles changed, and says which", async () => {
    for (const changed of ["apps/web/src/i18n/index.tsx", "packages/contracts/dist/index.mjs", "pnpm-lock.yaml"]) {
      const root = workspace(BUILT);
      await recordWebProdBuild(root, BUILT_AT);
      touch(root, changed);
      const check = await checkWebProdBuild(root);
      assert.equal(check.needed, true, changed);
      assert.match(check.needed ? check.reason : "", new RegExp(changed.replace(/[./]/g, "\\$&")));
    }
  });

  it("ignores files the build does not read, and those next build writes itself", async () => {
    const root = workspace(BUILT);
    await recordWebProdBuild(root, BUILT_AT);
    for (const file of ["apps/web/tests/i18n/x.test.ts", "apps/web/next-env.d.ts", "apps/web/tsconfig.tsbuildinfo", "apps/web/node_modules/next/x.js", "apps/daemon/src/server.ts"]) touch(root, file);
    assert.deepEqual(await checkWebProdBuild(root), { needed: false });
  });

  it("builds a server bundle, not the static export, into the directory --prod serves", () => {
    const parent = { NODE_OPTIONS: "--max-old-space-size=6144", OD_WEB_DIST_DIR: ".tmp/dev" };
    const env = webProdBuildEnv(parent);
    assert.equal(env.NODE_ENV, "production");
    assert.equal(env.OD_WEB_OUTPUT_MODE, "server");
    assert.equal(env.OD_WEB_PROD, "1");
    assert.equal(env.NODE_OPTIONS, "--max-old-space-size=6144");
    assert.deepEqual(parent, { NODE_OPTIONS: "--max-old-space-size=6144", OD_WEB_DIST_DIR: ".tmp/dev" });
  });
});
