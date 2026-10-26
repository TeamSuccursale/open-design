# MelilloDesign

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Extend the user's fork of `nexu-io/open-design`. Retain its React/Next.js interface, Node daemon, SQLite storage, and agent integrations. Use Python for PDF processing, as requested. Follow the upstream module boundaries and the daemon data directory contract in AGENTS.md.

## Users

Initially one person working on project documents in a browser on a Windows PC.

## Product Purpose

Turn project PDFs into a searchable collection of reusable images, charts, drawings, and tables. The eventual document editor should let the user compose A4/A3 reports and tender documents from text and that collection.

## Operating Context

The user selected an existing tender project as the first real test case. Its previous-project documents, original tender documents, and readable PDF copies are available locally. Treat those sources as read-only inputs; keep project documents and extracted content out of the public source fork.

## Capabilities and Constraints

The first working milestone is real PDF intake, automatic extraction, AI descriptions and tags, and a searchable gallery. Extracted items enter the gallery automatically, without a required review gate.

Intake always has two entry points: Codex processes documents directly in the project folder, and users add documents through the UI for processing in the background. Both entry points use the same intake procedure and feed the same gallery with source provenance.

Scanned or raster pages require two passes: analyze the full page to locate useful regions, then crop those regions and analyze the crops. Preserve the relationship between each item, its source document, page, and crop coordinates. Digital PDFs also need complete figures and charts, including content assembled from vector drawing operations.

AI analysis uses the installed Codex CLI with ChatGPT subscription authentication and GPT-6 Luna. The CLI installation, ChatGPT login and live image analysis have been verified on the sample. Processing currently caps concurrent work at two documents and two model calls; capacity for larger workloads remains to be established.

The gallery must support direct browsing and search. Agent-driven retrieval is also part of the intended scope. Titles, useful descriptions, tags, and source information should travel with an item when it is reused in a document.

The project gallery opens as a drawer from the bottom or top, with a control to switch its position. Users can search, select multiple items, and add an individual note to each. Selection and notes persist while searching. Confirming adds the actual images, titles and notes to the chat draft for review before sending, with source references and descriptions carried privately to the agent. Documents added in the gallery are copied into the local project and processed in the background.

Chat remains the default workspace, including for imported folders. Recognized assets belong in the right-hand explorer and open a preview on a single click. Gallery selection is opened explicitly. Gallery folder settings expose the project link, additional read-only source folders and a project-relative destination for new images. Codex and the UI share the project-root intake.config.json and the existing intake catalog. Changing the output folder preserves existing asset paths.

Selected graphs, tables, drawings and recognized key maps offer **Redesign as SVG** (**Ridisegna in SVG**) beside their notes. It prepares a chat draft with the original image, a short visual-redesign request and the user's note. The aim is a more attractive graphic for a report, with freedom determined by its meaning. Key maps, surveys, dimensioned machine plans and construction drawings retain exact native or precisely traced shapes, positions, orientation, dimensions, scale, topology and internal technical labels; presentation improves through colours, contrast, line hierarchy and external typography or legends. Explanatory process diagrams can be recomposed while keeping steps, directions, dependencies, quantities and meaning extremely consistent. A steam-engine explanation can be recomposed; its fabrication plan retains its geometry. Uncertain classification preserves geometry. Provenance, native editable SVG requirements and instructions to flag unreadable details travel privately to the agent. The user reviews and sends the draft; clicking the shortcut does not run a model or modify the extraction. CLI agents prepare the same request through the shared API and prompt builder.

Intake provenance is carried privately to the agent. The composer and user message show the image, title, user's note and a short request; paths, crop coordinates, tags and extraction details are not inserted into visible text. The same private reference is retained in ordinary runtime prompts and frozen inputs for multi-step agent work.

SVG reworkings are saved as separate versions in each original asset's project-local vector folder. The gallery automatically recognizes saved native SVGs, links them to the source and offers preview and reuse in chat. The user can choose a preferred version and explain why. That exact file fingerprint, choice and explanation persist by source asset; an edited or removed file requires a new choice. Linked versions and preferences travel privately to the agent on later source or SVG use. CLI and UI share registration, lookup and preference APIs. Original extractions and earlier versions remain intact.

Generated SVGs are visible in the chat's captured-version card and the main file preview. Live Codex requests have verified native SVG creation, source-folder discovery and both previews. An earlier Luna map was rejected for schematic geometry. A subsequent Sol/Max run produced a detailed native v2.svg trace, reviewed against the source at full view and in six enlarged comparisons, with the original and v1 intact. The separate visual-redesign run completed successfully and saved v3.svg, independently reviewed at full view and in six comparisons. It retains all nonempty v2 map paths, applies only a global translation to that geometry, and improves muted colours, contrast, zone typography, legend and title. The catalog links v1, v2 and v3 to the source with no preferred version selected. Source scans still limit fine detail; these presentation changes add no survey accuracy. The saved output's review does not establish the user's design approval. Choosing a preferred version remains the user's action.

For page composition and direct image requests, the main Codex agent can delegate to three configured native specialists: photographic alpha/transparency, photo-to-vector, and independent image review. Faithful cutouts mask the original RGB pixels and export the actual alpha channel; generative restyling requires an explicit request and remains a separate derivative. Vector work preserves exact technical geometry or identifies the output as an interpretation of visible form. Workers return saved files, provenance and limitations; the coordinator integrates and visually checks them. SVG workers and their reviewer use at least Sol/Max while retaining a stronger parent choice. These roles use the tools actually available in the session and report missing capabilities. Planning and Blockout scope restrictions remain in force.

The eventual layout interface must support A4/A3 pages containing text, images, and tables. Editable export formats and the depth of the layout editor remain open decisions.

## Brand Commitments

The app is named MelilloDesign. Start from OpenDesign's existing interface and features, with Codex connection as the primary onboarding action. Use architectural imagery on the right side of onboarding. The user selected the repository as the foundation instead of beginning with a separate visual mockup.

## Evidence on Hand

The OpenDesign source is checked out in this repository. The GitHub fork is `TeamSuccursale/open-design`; the upstream is `nexu-io/open-design`.

The intake and gallery implementation has been exercised with small, private samples from the real test-case folder. It uses Python PDF rendering, two-pass Codex CLI image analysis with GPT-6 Luna, shared folder/UI intake APIs, and a searchable gallery drawer with per-item notes. This does not constitute an intake of the complete tender archive.

Named documents, shared header/footer designs, structural Blockout selection/editing, autosave, private project recovery history and post-design composition updates are implemented. Recorded real CLI journeys and their limits are indexed in the [26 October checkpoint](docs/checkpoints/2026-10-26.md). The [development diary](docs/DEVELOPMENT-DIARY.md) ties this work to actual commits; the [UI/UX testing roadmap](specs/current/melillodesign-ui-ux-testing-roadmap.md) identifies the remaining acceptance work. These records supersede older milestone statements where behavior has changed.

## Product Principles

Use real project material from the first working milestone. Keep extracted items traceable to their sources. Make automatic processing visible through progress and failure states. Reuse the existing OpenDesign interface and runtime boundaries.

## Graphic Support and Blockout Mode

MelilloDesign supports the engineer with graphic design: visual direction, typography, image treatment, page composition, information graphics, and visual production quality. The engineer owns the text, data, technical meaning, and decisions. Tender drafting, evaluation criteria, bid strategy, and technical decision-making are outside this skill system.

Reuse the app's existing graphic capabilities and relevant design skills. Add short task-specific notes for working with engineers rather than separate specialist skills for visual direction, typography or image preparation. Tender-domain skills and workflows do not belong in this graphic mode.

Document preparation offers Blockout before detailed graphic design, with a choice to draw the page structure or ask the agent to propose it. It produces three independent structural proposals by default, using the document type, page budget, content roles and confirmed constraints. Use native parallel agents when available, with separate proposal files; otherwise disclose sequential generation. The page body remains schematic functional blocks with stable IDs, real paper proportions and visible fit uncertainties; the project's actual images and finished content are not required to populate it. Optional faint gallery references express the user's intention. Approved recurring headers/footers may already appear around the body. Preserve the engineer's text, data, drawing relationships and decisions during the later design. The engineer chooses and edits a proposal in the visual workspace, navigates its pages, and answers an explicit acceptance question before starting graphic design. The editor remains available throughout design, with an optional faint finished-page guide and readaptation from changed blocks. Page-wide decoration remains independent of content-block geometry. Documents group per-page Blockout files; their previews and chat cards show editable structures. The existing skill catalogue is not replaced or filtered by this mode; its shared instructions constrain the task to graphic structure.

The Blockout editor provides an editable canvas with separate page navigation and a docked inspector. Users add, move, resize, rotate, duplicate and delete blocks, change aspect ratios and page sizes, and set expectations and fixed/guided/free layout flexibility at page or block level. Content images and multiple feedback images come from the project gallery. The resolved brief, geometry, image provenance and question answers are saved in the project as the engineer's starting point before staging the normal chat draft. Agent questions use the existing question-form flow with page/block IDs; the referenced outline is highlighted while the form is docked beside the canvas.

Automatic snapping is switchable and aligns blocks to page edges, safe margins and other blocks. Each page shows an adjustable safe area, initially inset by 10 mm; a block crossing it receives a visible warning, including when rotated. The warning preserves the engineer's ability to place an intentional bleed.

## Open Decisions

Interface and metadata languages, cross-project search, typical collection size, retrieval beyond text and tags, and document export formats are not yet settled.
