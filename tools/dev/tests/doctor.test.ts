import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDoctorReport, runDoctor, type DoctorProbes } from "../src/doctor.js";

const healthy: DoctorProbes = {
  nodeVersion: "v24.11.0",
  pythonExecutable: "python.exe",
  codexExecutable: "codex.exe",
  run: async (command, args) => {
    if (command === "pnpm") return { code: 0, stdout: "11.25.0\n" };
    if (command === "python.exe") return { code: 0, stdout: "" };
    if (command === "git") return { code: 0, stdout: "true\n" };
    if (command === "codex.exe") return { code: 0, stdout: "Logged in using ChatGPT\n" };
    if (command === "node" && args.join(" ").includes("better-sqlite3")) return { code: 0, stdout: "" };
    return { code: 1, stdout: "" };
  },
  portState: async () => "free",
};

describe("tools-dev doctor", () => {
  it("passes on a PC set up as the guide says", async () => {
    const results = await runDoctor(healthy, { daemonPort: 17456, webPort: 17573 });
    assert.deepEqual(results.filter((result) => !result.ok), []);
    assert.match(formatDoctorReport(results), /Tutto pronto/);
  });

  it("says in one Italian line what to do for each missing piece", async () => {
    const broken: DoctorProbes = {
      ...healthy,
      nodeVersion: "v22.4.0",
      codexExecutable: null,
      run: async (command, args) => {
        if (command === "git") return { code: 1, stdout: "" };
        if (command === "python.exe") return { code: 1, stdout: "", stderr: "ModuleNotFoundError: No module named 'pdfplumber'" };
        if (command === "node" && args.join(" ").includes("better-sqlite3")) return { code: 1, stdout: "", stderr: "was compiled against a different Node.js version" };
        return healthy.run(command, args);
      },
      portState: async (port) => (port === 17573 ? "other" : "free"),
    };
    const failed = (await runDoctor(broken, { daemonPort: 17456, webPort: 17573 })).filter((result) => !result.ok);
    assert.deepEqual(failed.map((result) => result.id), ["node", "python", "sqlite", "git-longpaths", "codex", "port-web"]);
    for (const result of failed) {
      assert.ok(result.fix && !result.fix.includes("\n"), `${result.id} needs a one-line fix`);
    }
    assert.match(failed.find((result) => result.id === "git-longpaths")!.fix!, /git config --global core\.longpaths true/);
    assert.match(failed.find((result) => result.id === "python")!.fix!, /pip install -r apps[\\/]daemon[\\/]pdf-intake[\\/]requirements\.txt/);
    assert.match(formatDoctorReport(failed), /6 cose da sistemare/);
  });

  it("treats a port held by a running MelilloDesign as fine", async () => {
    const running = { ...healthy, portState: async () => "melillodesign" as const };
    const results = await runDoctor(running, { daemonPort: 17456, webPort: 17573 });
    assert.ok(results.filter((result) => result.id.startsWith("port-")).every((result) => result.ok));
  });

  it("reads Codex's sign-in status from stderr, where the CLI prints it", async () => {
    const stderrOnly: DoctorProbes = { ...healthy, run: async (command, args) => (command === "codex.exe" ? { code: 0, stdout: "", stderr: "Logged in using ChatGPT\n" } : healthy.run(command, args)) };
    const codex = (await runDoctor(stderrOnly, { daemonPort: 17456, webPort: 17573 })).find((result) => result.id === "codex")!;
    assert.equal(codex.ok, true);
  });

  it("asks to sign in to Codex when the CLI is found but signed out", async () => {
    const signedOut: DoctorProbes = { ...healthy, run: async (command, args) => (command === "codex.exe" ? { code: 1, stdout: "Not logged in\n" } : healthy.run(command, args)) };
    const codex = (await runDoctor(signedOut, { daemonPort: 17456, webPort: 17573 })).find((result) => result.id === "codex")!;
    assert.equal(codex.ok, false);
    assert.match(codex.fix!, /accedi/i);
  });
});
