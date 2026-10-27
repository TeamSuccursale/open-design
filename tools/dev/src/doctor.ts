import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";

/**
 * The setup check behind `MelilloDesign.cmd doctor`: what the launcher and the daemon assume about a team PC.
 * Each check that fails says, in one Italian line, what to do about it.
 */

export interface DoctorRunResult {
  code: number | null;
  stdout: string;
  stderr?: string;
}

export type DoctorPortState = "free" | "melillodesign" | "other";

export interface DoctorProbes {
  nodeVersion: string;
  pythonExecutable: string;
  codexExecutable: string | null;
  run: (command: string, args: string[], options?: { cwd?: string }) => Promise<DoctorRunResult>;
  portState: (port: number) => Promise<DoctorPortState>;
}

export interface DoctorResult {
  id: string;
  label: string;
  ok: boolean;
  fix?: string;
}

const PDF_REQUIREMENTS = path.join("apps", "daemon", "pdf-intake", "requirements.txt");

export async function runDoctor(probes: DoctorProbes, ports: { daemonPort: number; webPort: number }, workspaceRoot = "."): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  const nodeMajor = Number(/^v(\d+)/.exec(probes.nodeVersion)?.[1]);
  results.push(nodeMajor === 24
    ? { id: "node", label: `Node ${probes.nodeVersion}`, ok: true }
    : { id: "node", label: `Node ${probes.nodeVersion}`, ok: false, fix: "Serve Node 24: aggiorna l'app Codex, che lo installa, oppure installa Node 24 da nodejs.org." });

  const pnpm = await probes.run("pnpm", ["--version"]);
  results.push(pnpm.code === 0
    ? { id: "pnpm", label: `pnpm ${pnpm.stdout.trim()}`, ok: true }
    : { id: "pnpm", label: "pnpm", ok: false, fix: "pnpm non risponde: aggiorna l'app Codex oppure esegui npm install -g pnpm@10.33.2." });

  const python = await probes.run(probes.pythonExecutable, ["-I", "-c", "import pypdfium2, pdfplumber, PIL"]);
  results.push(python.code === 0
    ? { id: "python", label: "Python con i pacchetti per leggere i PDF", ok: true }
    : { id: "python", label: "Python con i pacchetti per leggere i PDF", ok: false, fix: `Mancano i pacchetti PDF: esegui "${probes.pythonExecutable}" -m pip install -r ${PDF_REQUIREMENTS}` });

  const sqlite = await probes.run("node", ["-e", "require('better-sqlite3')"], { cwd: path.join(workspaceRoot, "apps", "daemon") });
  results.push(sqlite.code === 0
    ? { id: "sqlite", label: "Database locale (better-sqlite3)", ok: true }
    : { id: "sqlite", label: "Database locale (better-sqlite3)", ok: false, fix: "Il database locale non si carica: installa Visual Studio Build Tools 2022 con «Sviluppo di applicazioni desktop C++», poi esegui pnpm install." });

  const longPaths = await probes.run("git", ["config", "--get", "core.longpaths"]);
  results.push(longPaths.code === 0 && longPaths.stdout.trim() === "true"
    ? { id: "git-longpaths", label: "Git con i percorsi lunghi attivi", ok: true }
    : { id: "git-longpaths", label: "Git con i percorsi lunghi attivi", ok: false, fix: "Attiva i percorsi lunghi di Git: esegui git config --global core.longpaths true" });

  if (!probes.codexExecutable) {
    results.push({ id: "codex", label: "Codex", ok: false, fix: "Codex non trovato: installa l'app Codex e accedi con il tuo account." });
  } else {
    const login = await probes.run(probes.codexExecutable, ["login", "status"]);
    // The CLI prints its sign-in status on stderr.
    results.push(login.code === 0 && /logged in/i.test(`${login.stdout}\n${login.stderr ?? ""}`)
      ? { id: "codex", label: "Codex con accesso effettuato", ok: true }
      : { id: "codex", label: "Codex", ok: false, fix: "Codex non ha un accesso attivo: apri l'app Codex e accedi con il tuo account." });
  }

  for (const [id, port] of [["port-daemon", ports.daemonPort], ["port-web", ports.webPort]] as const) {
    const state = await probes.portState(port);
    const label = `Porta ${port}`;
    results.push(state === "other"
      ? { id, label, ok: false, fix: `La porta ${port} è occupata da un altro programma: chiudilo, oppure riavvia il PC.` }
      : { id, label: state === "melillodesign" ? `${label} (MelilloDesign è già in esecuzione)` : `${label} libera`, ok: true });
  }
  return results;
}

export function formatDoctorReport(results: readonly DoctorResult[]): string {
  const failed = results.filter((result) => !result.ok);
  const lines = results.map((result) => (result.ok ? `  OK        ${result.label}` : `  DA FARE   ${result.fix}`));
  lines.push("");
  lines.push(failed.length === 0
    ? "Tutto pronto: avvia MelilloDesign con MelilloDesign.cmd"
    : `${failed.length} ${failed.length === 1 ? "cosa da sistemare" : "cose da sistemare"}, poi rilancia MelilloDesign.cmd doctor`);
  return lines.join("\n");
}

function runCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<DoctorRunResult> {
  return new Promise((resolve) => {
    // Windows starts pnpm and git shims only through cmd.exe; the arguments here are fixed, never user input.
    const viaCmd = process.platform === "win32" && !/\.exe$/i.test(command);
    const child = spawn(viaCmd ? "cmd.exe" : command, viaCmd ? ["/d", "/c", command, ...args] : args, { cwd: options.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill(), 20_000);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: error.message }); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

async function portState(port: number): Promise<DoctorPortState> {
  const free = await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
  if (free) return "free";
  const answers = async (url: string) => {
    try { return (await fetch(url, { signal: AbortSignal.timeout(3_000) })).ok; } catch { return false; }
  };
  return (await answers(`http://127.0.0.1:${port}/api/version`)) || (await answers(`http://127.0.0.1:${port}/api/health`)) ? "melillodesign" : "other";
}

/** The daemon reads PDFs with the Codex runtime's Python unless MELILLO_PYTHON names another one. */
function pythonExecutable(): string {
  const bundled = path.join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
  return process.env.MELILLO_PYTHON || (existsSync(bundled) ? bundled : "python");
}

/** The Codex app keeps its CLI in one folder per build under LocalAppData; the newest build is the one in use. */
function codexExecutable(): string | null {
  const binRoot = path.join(process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local"), "OpenAI", "Codex", "bin");
  let builds: string[] = [];
  try { builds = readdirSync(binRoot); } catch { /* no app install */ }
  const found = builds.map((build) => path.join(binRoot, build, "codex.exe")).filter((file) => existsSync(file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? (process.platform === "win32" ? null : "codex");
}

export function localDoctorProbes(): DoctorProbes {
  return { nodeVersion: process.version, pythonExecutable: pythonExecutable(), codexExecutable: codexExecutable(), run: runCommand, portState };
}
