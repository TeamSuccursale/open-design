import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { resolveWebRuntimeNodeEnv, WEB_MAX_OLD_SPACE_SIZE_ENV } from "../src/web-node-options.js";

describe("web-only V8 heap configuration", () => {
  it("leaves unconfigured launches and the original environment unchanged", () => {
    const inherited = { NODE_OPTIONS: "--no-warnings" };
    assert.deepEqual(resolveWebRuntimeNodeEnv(inherited), {});
    const configured = { ...inherited, [WEB_MAX_OLD_SPACE_SIZE_ENV]: "8192" };
    assert.deepEqual(resolveWebRuntimeNodeEnv(configured), { NODE_OPTIONS: "--no-warnings --max-old-space-size=8192" });
    assert.deepEqual(inherited, { NODE_OPTIONS: "--no-warnings" });
    assert.equal(configured.NODE_OPTIONS, "--no-warnings");
  });

  it("validates the local MiB setting and preserves quoted caller options", () => {
    for (const value of ["0", "-1", "3.5", "8GB", "8192 --inspect", "9007199254740992"]) {
      assert.throws(() => resolveWebRuntimeNodeEnv({ [WEB_MAX_OLD_SPACE_SIZE_ENV]: value }), /positive integer/);
    }
    assert.deepEqual(resolveWebRuntimeNodeEnv({ [WEB_MAX_OLD_SPACE_SIZE_ENV]: " 8192 ", NODE_OPTIONS: '--require "C:\\Folder with spaces\\hook.cjs" --enable-source-maps' }), {
      NODE_OPTIONS: '--require "C:\\Folder with spaces\\hook.cjs" --enable-source-maps --max-old-space-size=8192',
    });
  });

  it("gives only the spawned web child an 8192 MiB old-space ceiling while retaining other flags", () => {
    for (const originalHeapOption of ["--max-old-space-size=4096", "--max_old_space_size=4096"]) {
      const env = { ...process.env, NODE_OPTIONS: `--no-warnings --stack-trace-limit=37 ${originalHeapOption}`, [WEB_MAX_OLD_SPACE_SIZE_ENV]: "8192" };
      const output = execFileSync(process.execPath, ["-e", 'console.log(JSON.stringify({heapLimit:require("node:v8").getHeapStatistics().heap_size_limit,stackLimit:Error.stackTraceLimit}))'], {
        encoding: "utf8", env: { ...env, ...resolveWebRuntimeNodeEnv(env) },
      });
      const result = JSON.parse(output) as { heapLimit: number; stackLimit: number };
      // V8's total heap includes a small young-generation allowance above old space.
      assert.ok(result.heapLimit >= 8192 * 1024 ** 2 && result.heapLimit < 8448 * 1024 ** 2, String(result.heapLimit));
      assert.equal(result.stackLimit, 37);
      assert.equal(env.NODE_OPTIONS, `--no-warnings --stack-trace-limit=37 ${originalHeapOption}`);
    }
  });
});
