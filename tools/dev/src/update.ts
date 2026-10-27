import { execFile } from "node:child_process";

/**
 * The checkout half of `MelilloDesign.cmd update`: a fast-forward to the branch this clone follows,
 * refused whenever it could overwrite work done on the PC. The launcher installs and starts afterwards.
 * Every refusal is one Italian line saying what to do.
 */

export interface UpdateGitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type UpdateGit = (args: string[]) => Promise<UpdateGitResult>;

export type UpdatePlan =
  | { kind: "blocked"; reason: string }
  | { kind: "current"; version: string }
  | { kind: "ready"; from: string; to: string; changes: string[] };

const ASK_INSTALLER = "Chiedi a chi ha installato MelilloDesign su questo PC.";
const SHOWN_CHANGES = 15;

export function gitIn(root: string): UpdateGit {
  return (args) => new Promise((resolve) => {
    execFile("git", ["-C", root, ...args], { timeout: 120_000, windowsHide: true, maxBuffer: 4_000_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const firstLine = (result: UpdateGitResult) => lines(result.stderr)[0] ?? lines(result.stdout)[0] ?? "";

async function version(git: UpdateGit, revision: string): Promise<string> {
  return (await git(["describe", "--tags", "--always", revision])).stdout.trim();
}

export async function planUpdate(git: UpdateGit): Promise<UpdatePlan> {
  if ((await git(["rev-parse", "--is-inside-work-tree"])).code !== 0) {
    return { kind: "blocked", reason: `Questa cartella non è un clone Git di MelilloDesign: da qui non si può aggiornare. ${ASK_INSTALLER}` };
  }
  // Untracked files are runtime data (.tmp, logs) that a fast-forward never touches.
  // Porcelain lines start with a two-letter status that may begin with a space, so they are not trimmed.
  const changed = (await git(["status", "--porcelain", "--untracked-files=no"])).stdout.split(/\r?\n/).filter((line) => line.length > 3).map((line) => line.slice(3));
  if (changed.length) {
    const named = changed.slice(0, 5).join(", ") + (changed.length > 5 ? ` e altri ${changed.length - 5}` : "");
    return { kind: "blocked", reason: `Su questo PC sono stati modificati file di MelilloDesign (${named}): l'aggiornamento li sovrascriverebbe. ${ASK_INSTALLER}` };
  }
  if ((await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).code !== 0) {
    return { kind: "blocked", reason: `Questo ramo non segue il ramo del team, quindi non c'è da dove aggiornare. ${ASK_INSTALLER}` };
  }
  const fetched = await git(["fetch", "--quiet", "--tags"]);
  if (fetched.code !== 0) {
    return { kind: "blocked", reason: `Non riesco a scaricare gli aggiornamenti (${firstLine(fetched)}): controlla la connessione e l'accesso a GitHub, poi riprova.` };
  }
  const [ahead = 0, behind = 0] = (await git(["rev-list", "--left-right", "--count", "HEAD...@{u}"])).stdout.trim().split(/\s+/).map(Number);
  if (ahead > 0) {
    return { kind: "blocked", reason: `Su questo PC ci sono ${ahead === 1 ? "1 modifica salvata" : `${ahead} modifiche salvate`} che il ramo del team non ha: l'aggiornamento non le sovrascrive. ${ASK_INSTALLER}` };
  }
  if (behind === 0) return { kind: "current", version: await version(git, "HEAD") };
  const changes = lines((await git(["log", "--format=%s", `--max-count=${SHOWN_CHANGES}`, "HEAD..@{u}"])).stdout);
  return { kind: "ready", from: await version(git, "HEAD"), to: await version(git, "@{u}"), changes: behind > changes.length ? [...changes, `… e altre ${behind - changes.length}`] : changes };
}

export function formatUpdatePlan(plan: UpdatePlan): string {
  if (plan.kind === "blocked") return plan.reason;
  if (plan.kind === "current") return `MelilloDesign è già aggiornato (${plan.version}).`;
  return [`Aggiornamento da ${plan.from} a ${plan.to}:`, ...plan.changes.map((change) => `  - ${change}`)].join("\n");
}

/** Stops the app only once nothing is running, so an update never cuts an agent's work short. */
export async function applyUpdate(git: UpdateGit, plan: UpdatePlan, app: { activeRuns: () => Promise<number>; stopApps: () => Promise<void> }): Promise<string> {
  if (plan.kind !== "ready") return formatUpdatePlan(plan);
  if (await app.activeRuns() > 0) {
    throw new Error("C'è un lavoro in corso in MelilloDesign: aspetta che finisca, poi rilancia MelilloDesign.cmd update.");
  }
  await app.stopApps();
  const merged = await git(["merge", "--ff-only", "--quiet", "@{u}"]);
  if (merged.code !== 0) {
    throw new Error(`L'aggiornamento non si è applicato (${firstLine(merged)}) e nessun file è cambiato: riavvia la versione di prima con MelilloDesign.cmd. ${ASK_INSTALLER}`);
  }
  return `Aggiornato a ${plan.to}.`;
}
