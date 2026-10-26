---
name: image-specialists
description: Delegate photographic cutouts, native SVG reworkings and source-fidelity reviews to the configured MelilloDesign image specialists, for page assets or direct image requests.
triggers:
  - "remove background"
  - "transparent cutout"
  - "alpha mask"
  - "photo to svg"
  - "vector illustration"
  - "scontorno"
  - "vettorializza"
od:
  mode: utility
  category: image-generation
---

# Image specialists

Use the native roles advertised by the active runtime for bounded image work, including assets needed while composing a page. Check available originals, existing vector versions and the user's saved preference before making another variant.

- `melillo_image_alpha` prepares a photographic cutout and its actual grayscale alpha channel. A faithful extraction masks the original pixels; it must not silently regenerate the subject. Request generative restyling only when the user asked for it and identify the result as a derivative.
- `melillo_photo_vector` creates an editable native SVG and a rendered comparison. Technical maps and dimensioned/CAD geometry stay exact; explanatory diagrams may be recomposed while retaining meaning. A single photograph supports an interpretation of visible form, not invented hidden geometry or measured survey claims.
- `melillo_image_review` independently checks the actual cutout or native SVG against the source, returning concrete fixes and limits. It does not choose the user's preferred version.

Give each worker the original path and provenance, intended use, operation, protected meaning or geometry, relevant preferences and its own output directory. Require real saved files, method, checks and remaining uncertainty. The canonical role definitions are maintained in `packages/contracts/src/prompts/image-specialists.ts`; the configured native roles carry their detailed working instructions.

Wait for the results, inspect the actual saved images and integrate them into the requested page or deliverable. For a cutout, verify unchanged retained RGB and inspect white/dark composites; for an SVG, inspect its rendered full view and details against the source. Preserve earlier files and leave preference selection to the user.

This skill routes work; it does not install models, providers, MCP servers or editing tools. Use only roles and capabilities actually exposed in the session and report a missing capability honestly. Follow the active execution mode: Plan and Chat restrictions still apply, and Blockout stays within structural planning until refinement is authorized. An internal OD Next planning turn cannot spawn workers or execute image work, even in a Design conversation; leave that handoff for the execution turn.
