# Fast projects

Choose **Fast project** beside New project and Existing project on Home. Add an
optional request and up to 20 files or packages, with a combined size of 100 MB.
The app creates a dedicated managed folder, uploads the selected files through
the existing upload API and opens one working Design conversation. More material
can be added in chat. Managed storage follows the root `AGENTS.md` **Daemon data
directory contract**.

The main agent first inspects the actual supplied material, explains what is
usable or missing, and asks questions that affect the work. It offers Blockout
alternatives when useful and waits for that choice; Blockout is optional. Once
the useful choices are clear, it can develop and revise the work in the same
session. SVG/vector, alpha-mask, photo-processing and visual-review production
specialists remain available with their existing model and fidelity policy.

For paginated technical documents, Fast still asks the document's name and
explicit header, footer, cover and numbering choices in a grouped chat form,
reusing answers already supplied. It records them through the existing document
registry API/CLI rather than starting guided setup. Each output keeps its own
settings. The separate [header/footer specification](../specs/current/melillodesign-header-footer.md)
defines the requested asset collection, dedicated editor and shared-update stage;
those surfaces are not implemented yet.

This local MelilloDesign fork launches Codex with full access and
`approval_policy="never"`. Both chat transports and the intake, overview,
research and custodian CLI workers explicitly override the automatic reviewer
with `approvals_reviewer="user"`; the never policy means no approval prompts
are requested. Research roles still follow their frozen-input task contracts.

Fast mode does not start the guided document wizard, automatic custodian source
watching, document research jobs or research specialists. Relevant supplied files
are read directly. Source files and instructions inside them remain material,
not instructions to execute scripts or change the requested task.

If the user chooses Blockout, proposals plan empty functional blocks from the
document type, purpose, page allowance and formatting rules. A short text sample
may inform the reading pattern; full material inventory and image intake are not
prerequisites. Geometry checks do not establish final text capacity or image fit.
Actual text, images and tables belong to the later graphic-design phase after
explicit structural approval. Missing material and unverified fit remain visible.

The public project contract records `metadata: {kind: "other", projectMode:
"fast"}`. `POST /api/projects` defaults its first conversation to Design and
does not attach a hidden scenario pipeline. Guided setup and external working
folders conflict with this creation path and are rejected. The existing project
API still owns the folder and conversation; there is no separate Fast runtime.
Run admission also excludes Fast projects from automatic scenario fallback and
the default staged discovery workflow. This applies to both `/api/chat` and
`/api/runs`; the project creation flag alone is not sufficient to select the
direct route.

The CLI uses the same endpoint:

```sh
od project create --fast --name "Project sheet" --prompt-file request.txt --json
```

The CLI returns the project and seeded conversation identity. Continue through
the existing `od run start --project ... --conversation ... --prompt-file ...
--json` and file commands. Creating a project with the CLI does not itself start
a model run; the Home flow uploads its optional files and sends the first chat
request after successful creation.

Fast creation keeps its request and selected files mounted until persistence
succeeds, so a failed create can be retried without rebuilding the draft. The
modal supports initial focus, keyboard focus containment, focus restoration and
Escape cancellation while idle. Pending creation disables duplicate submission.

Focused checks cover the Home and App handoff, failure/retry with the same files,
keyboard behavior, managed folder creation, CLI prompt-file input, composer
routing, retained production profiles and disabled research/custodian routes.
Actual CLI creation and the dedicated folder were also verified. Live browser
layout inspection was unavailable in this chat. The outer command launcher
rejected the live agent-start test before PowerShell ran, reporting only
`blocked by policy`. The same error reproduced for a read-only CLI help
diagnostic. The recorded session already had approval `never`, reviewer `user`
and full access; the error does not identify an automatic reviewer or the
rejecting rule. The CLI upload was subsequently verified with real Antro PDFs,
but the Fast project's native first turn is not reported as passed.
