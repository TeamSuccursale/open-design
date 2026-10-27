import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { applyUpdate, formatUpdatePlan, gitIn, planUpdate } from "../src/update.js";

const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@localhost", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@localhost" };
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();
}

/** A team repository and an engineer's clone of it, one commit apart from nothing. */
function teamAndClone() {
  const root = mkdtempSync(path.join(tmpdir(), "melillo-update-"));
  roots.push(root);
  const team = path.join(root, "team");
  mkdirSync(team);
  git(team, "init", "-q", "-b", "team");
  writeFileSync(path.join(team, "app.txt"), "round 1\n");
  git(team, "add", ".");
  git(team, "commit", "-q", "-m", "Round 1");
  git(team, "tag", "team-r1");
  const pc = path.join(root, "pc");
  git(root, "clone", "-q", team, pc);
  return { team, pc };
}
function nextRound(team: string, subject = "Round 2") {
  writeFileSync(path.join(team, "app.txt"), `${subject}\n`);
  git(team, "commit", "-q", "-am", subject);
}
const idle = { activeRuns: async () => 0, stopApps: async () => {} };

describe("MelilloDesign update", () => {
  it("says the PC is current when the team branch has nothing new", async () => {
    const { pc } = teamAndClone();
    const plan = await planUpdate(gitIn(pc));
    assert.deepEqual(plan, { kind: "current", version: "team-r1" });
    assert.match(formatUpdatePlan(plan), /già aggiornato.*team-r1/);
  });

  it("stops the app, then fast-forwards to the team branch", async () => {
    const { team, pc } = teamAndClone();
    nextRound(team, "Round 2: header zoom");
    const plan = await planUpdate(gitIn(pc));
    assert.equal(plan.kind, "ready");
    assert.match(formatUpdatePlan(plan), /Round 2: header zoom/);
    const steps: string[] = [];
    await applyUpdate(gitIn(pc), plan, { activeRuns: async () => { steps.push("check"); return 0; }, stopApps: async () => { steps.push(`stop at ${git(pc, "rev-parse", "HEAD")}`); } });
    assert.equal(git(pc, "rev-parse", "HEAD"), git(team, "rev-parse", "HEAD"));
    assert.deepEqual(steps, ["check", `stop at ${git(team, "rev-parse", "HEAD~1")}`]);
  });

  it("refuses while an agent is working, before stopping anything", async () => {
    const { team, pc } = teamAndClone();
    nextRound(team);
    const before = git(pc, "rev-parse", "HEAD");
    let stopped = false;
    await assert.rejects(applyUpdate(gitIn(pc), await planUpdate(gitIn(pc)), { activeRuns: async () => 1, stopApps: async () => { stopped = true; } }), /lavoro in corso/);
    assert.equal(stopped, false);
    assert.equal(git(pc, "rev-parse", "HEAD"), before);
  });

  it("refuses when a tracked file was changed on this PC, and names it", async () => {
    const { team, pc } = teamAndClone();
    nextRound(team);
    writeFileSync(path.join(pc, "app.txt"), "edited here\n");
    const plan = await planUpdate(gitIn(pc));
    assert.equal(plan.kind, "blocked");
    assert.match(formatUpdatePlan(plan), /app\.txt/);
  });

  it("ignores untracked files such as runtime data", async () => {
    const { team, pc } = teamAndClone();
    nextRound(team);
    writeFileSync(path.join(pc, "local.log"), "runtime\n");
    assert.equal((await planUpdate(gitIn(pc))).kind, "ready");
  });

  it("refuses when this PC has commits the team branch does not", async () => {
    const { team, pc } = teamAndClone();
    nextRound(team);
    writeFileSync(path.join(pc, "mine.txt"), "local\n");
    git(pc, "add", ".");
    git(pc, "commit", "-q", "-m", "Local work");
    const plan = await planUpdate(gitIn(pc));
    assert.equal(plan.kind, "blocked");
    assert.match(formatUpdatePlan(plan), /1 modifica/);
  });

  it("refuses on a branch that follows no remote branch", async () => {
    const { pc } = teamAndClone();
    git(pc, "switch", "-q", "-c", "loose");
    const plan = await planUpdate(gitIn(pc));
    assert.equal(plan.kind, "blocked");
    assert.match(formatUpdatePlan(plan), /non segue/);
  });
});

const launcherSource = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "MelilloDesign.cmd");
const fakePnpm = [
  "@echo off",
  "echo %*>>\"%FAKE_PNPM_LOG%\"",
  "echo %* | findstr /c:\"tools-dev update\" >nul && goto update",
  "echo %* | findstr /c:\" install\" >nul && exit /b %FAKE_INSTALL_EXIT%",
  "exit /b 0",
  ":update",
  "if \"%FAKE_UPDATE%\"==\"fail\" exit /b 1",
  "if \"%FAKE_UPDATE%\"==\"advance\" git commit --allow-empty -q -m next",
  "exit /b 0",
  "",
].join("\r\n");

/** Runs the real launcher against a fake Codex runtime whose pnpm only records its calls. */
function launch(update: "advance" | "same" | "fail", installExit = 0, pc?: string, action = "update") {
  const root = mkdtempSync(path.join(tmpdir(), "melillo-launcher-"));
  roots.push(root);
  const checkout = pc ?? path.join(root, "pc");
  if (!pc) {
    mkdirSync(checkout);
    copyFileSync(launcherSource, path.join(checkout, "MelilloDesign.cmd"));
    git(checkout, "init", "-q");
    git(checkout, "add", ".");
    git(checkout, "commit", "-q", "-m", "Round 1");
  }
  const runtime = path.join(root, "home", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies");
  mkdirSync(path.join(runtime, "node", "bin"), { recursive: true });
  mkdirSync(path.join(runtime, "bin", "fallback"), { recursive: true });
  writeFileSync(path.join(runtime, "node", "bin", "node.exe"), "");
  writeFileSync(path.join(runtime, "bin", "fallback", "pnpm.cmd"), fakePnpm);
  const log = path.join(root, "pnpm.log");
  const result = spawnSync("cmd.exe", ["/d", "/c", path.join(checkout, "MelilloDesign.cmd"), action], {
    env: { ...gitEnv, USERPROFILE: path.join(root, "home"), FAKE_PNPM_LOG: log, FAKE_UPDATE: update, FAKE_INSTALL_EXIT: String(installExit) },
    encoding: "utf8",
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split(/\r?\n/).map((line) => line.replace(/^dlx pnpm@10\.33\.2 /, "").replace(/\s+/g, " ").trim()) : [];
  return { code: result.status, calls, checkout, output: `${result.stdout}${result.stderr}`, pending: existsSync(path.join(checkout, ".tmp", "melillo-install-pending")) };
}

describe("MelilloDesign.cmd update", { skip: process.platform !== "win32" }, () => {
  it("installs and starts only after the checkout moved", () => {
    const run = launch("advance");
    assert.equal(run.code, 0);
    assert.deepEqual(run.calls, ["tools-dev update --namespace project-workspace", "install --frozen-lockfile", "tools-dev start web --namespace project-workspace --daemon-port 17456 --web-port 17573 --prod"]);
    assert.equal(run.pending, false);
  });

  it("does nothing more when the PC was already current", () => {
    const run = launch("same");
    assert.equal(run.code, 0);
    assert.deepEqual(run.calls, ["tools-dev update --namespace project-workspace"]);
  });

  it("stops when the checkout step refuses", () => {
    const run = launch("fail");
    assert.equal(run.code, 1);
    assert.deepEqual(run.calls, ["tools-dev update --namespace project-workspace"]);
  });

  it("does not start after a failed install, and repeats the install on the next update", () => {
    const failed = launch("advance", 1);
    assert.equal(failed.code, 1);
    assert.deepEqual(failed.calls.slice(1), ["install --frozen-lockfile"]);
    assert.equal(failed.pending, true);
    const retried = launch("same", 0, failed.checkout);
    assert.equal(retried.code, 0);
    assert.deepEqual(retried.calls, ["tools-dev update --namespace project-workspace", "install --frozen-lockfile", "tools-dev start web --namespace project-workspace --daemon-port 17456 --web-port 17573 --prod"]);
    assert.equal(retried.pending, false);
  });
});

// The team works on the production web build, several times faster to load than the dev server; tools-dev
// builds it when it is missing or older than the checkout.
describe("MelilloDesign.cmd start", { skip: process.platform !== "win32" }, () => {
  it("serves the production web build", () => {
    for (const action of ["start", "restart"]) {
      const run = launch("same", 0, undefined, action);
      assert.equal(run.code, 0);
      assert.deepEqual(run.calls, [`tools-dev ${action} web --namespace project-workspace --daemon-port 17456 --web-port 17573 --prod`]);
    }
  });

  it("leaves status and stop as they were", () => {
    assert.deepEqual(launch("same", 0, undefined, "status").calls, ["tools-dev status --namespace project-workspace"]);
    assert.deepEqual(launch("same", 0, undefined, "stop").calls, ["tools-dev stop --namespace project-workspace"]);
  });
});

// A fresh clone has no node_modules, so `pnpm tools-dev` (doctor, update) cannot run until the first install.
describe("MelilloDesign.cmd install", { skip: process.platform !== "win32" }, () => {
  it("installs a fresh checkout, then checks the PC instead of starting", () => {
    const run = launch("same", 0, undefined, "install");
    assert.equal(run.code, 0);
    assert.deepEqual(run.calls, ["install --frozen-lockfile", "tools-dev doctor --namespace project-workspace --daemon-port 17456 --web-port 17573"]);
    assert.equal(run.pending, false);
  });

  it("after a failed install asks to repeat the install, since doctor cannot run yet", () => {
    const run = launch("same", 1, undefined, "install");
    assert.equal(run.code, 1);
    assert.deepEqual(run.calls, ["install --frozen-lockfile"]);
    assert.match(run.output, /rilancia MelilloDesign\.cmd install/);
  });
});
