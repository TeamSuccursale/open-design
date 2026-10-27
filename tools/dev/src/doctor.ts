import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";

import { resolveToolsDevDataRoot } from "./data-root.js";

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
  /** OD_DATA_DIR as tools-dev hands it to the daemon; null when it is not set. */
  dataRoot: string | null;
  run: (command: string, args: string[], options?: { cwd?: string }) => Promise<DoctorRunResult>;
  portState: (port: number) => Promise<DoctorPortState>;
  /** Free bytes on the disk holding the given folder; null when the system cannot say. */
  freeDiskBytes: (folder: string) => Promise<number | null>;
}

export interface DoctorResult {
  id: string;
  label: string;
  ok: boolean;
  fix?: string;
}

const PDF_REQUIREMENTS = path.join("apps", "daemon", "pdf-intake", "requirements.txt");
/** Below this the production web build, project history and extracted images can fill the disk mid-run. */
export const MIN_FREE_DISK_BYTES = 5 * 1024 ** 3;

const gigabytes = (bytes: number) => (bytes / 1024 ** 3).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** The free-space line for the disk that holds the app and, unless OD_DATA_DIR moves them, the projects. */
export function diskSpaceResult(freeBytes: number | null): DoctorResult | null {
  if (freeBytes === null) return null;
  const label = `Spazio libero sul disco: ${gigabytes(freeBytes)} GB`;
  return freeBytes >= MIN_FREE_DISK_BYTES
    ? { id: "disk", label, ok: true }
    : { id: "disk", label, ok: false, fix: `Sul disco restano ${gigabytes(freeBytes)} GB liberi: liberane almeno 5, perché con il disco pieno il programma si ferma e il lavoro in corso non si salva.` };
}

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

  // Project history guards against an engineer's own mistakes, not against losing the disk: the folder the
  // projects live in belongs in the PC's normal backup, and this is where the guide sends people to find it.
  results.push(probes.dataRoot
    ? { id: "data-root", label: `Cartella dei progetti (OD_DATA_DIR): ${probes.dataRoot}, da includere nel backup del PC`, ok: true }
    : { id: "data-root", label: "Cartella dei progetti: quella predefinita, perché OD_DATA_DIR non è impostata", ok: true });

  const disk = diskSpaceResult(await probes.freeDiskBytes(probes.dataRoot ?? workspaceRoot));
  if (disk) results.push(disk);

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

export async function freeDiskBytes(folder: string): Promise<number | null> {
  try {
    const stats = await statfs(folder);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
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

export function localDoctorProbes(workspaceRoot: string): DoctorProbes {
  return {
    nodeVersion: process.version,
    pythonExecutable: pythonExecutable(),
    codexExecutable: codexExecutable(),
    dataRoot: resolveToolsDevDataRoot(workspaceRoot),
    run: runCommand,
    portState,
    freeDiskBytes,
  };
}
