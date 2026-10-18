# Personal portfolio template

Adapted from [veldig/react-engineer-portfolio](https://github.com/veldig/react-engineer-portfolio/tree/d859a81d974fc276943f0c398991746b75a1a413), pinned to full commit `d859a81d974fc276943f0c398991746b75a1a413`. The original MIT license and Martin Vizcaino copyright are preserved in [LICENSE](./LICENSE). This is a curated upstream template adaptation, not model-generated portfolio work or a claim about a real person's career.

## Provenance

[manifest.json](./manifest.json) maps 15 upstream inputs to local files. Git blob SHA-1 and SHA-256 values describe the original bytes at the pinned commit, before adaptation. They are not checksums of the adapted TSX/CSS. LICENSE and the two SVG illustrations are retained verbatim; the topographic pattern moves from public/ to src/assets/. Every recorded hash is obtained from the actual upstream Git checkout.

## Adaptation

- Retains the original neon `#ccff00`, near-black surfaces, uppercase display headings, outlined surname, hero glow, headshot placeholder, topographic pattern, section order, skills, career cards, and three project examples. Hero, About, Experience, Projects, Contact, navigation and footer are adapted from the corresponding upstream components, with the upstream configuration separated into typed data.
- Converts JSX to React TSX and uses exact React/React DOM 18.3.1. Motion wrappers and decorative animation are removed; icons become text controls, so Framer Motion and Lucide are unnecessary. The layout remains visible without scroll-triggered JavaScript animations. Reduced-motion preferences disable smooth scrolling and transitions.
- Keeps upstream Tailwind colors and layouts, converts configuration to CommonJS, and precompiles CSS using the existing repository preparation function. The entry imports only the resulting styles.css. No runtime Tailwind CDN is used. SVGs become embedded asset modules during preparation, including the pattern previously referenced by an absolute public URL.
- Removes Google Fonts requests. Display text uses locally installed Oswald, then Impact / Arial Narrow; body text uses locally installed Inter, then Arial. Font metrics vary by device. No remote image, font, analytics, API or contact request is needed for rendering.
- Adds All / Frontend / Data / AI project filtering and local native-dialog details. These are adaptation features; upstream only has project cards and external links. Details explicitly distinguish sample descriptions from running products. Native dialog supports Escape, modal keyboard focus and return to the launching control.
- Keeps section-anchor navigation and a responsive menu. Adds accessible menu labels, expanded state, Escape closing, closure on navigation and desktop resize, visible focus styles, a skip link and 44px controls. Hire Me navigates to the contact section.
- Removes missing resume.pdf, placeholder company/social/demo/GitHub destinations, and placeholder Open Graph URLs. Only the actual upstream repository is linked, explicitly labeled external. No external demo is included. External links can be restricted by the hosting preview sandbox.
- Replaces contact launch behavior with selectable sample email and an explicit copy action. Clipboard success is reported only after an acknowledged write; unavailable/denied clipboard access gives a manual-copy message. The sample address does not send mail. There is no contact form, submission, backend service, resume download, persistence or fabricated delivery state.
- Retains upstream sample career claims but labels them as sample history. Footer provides upstream attribution instead of presenting the sample identity as an established copyright owner.

## Preparation And Scope

From the repository root, import `prepareCompanyTemplate` from `scripts/prepare-company-template.mjs` and pass this folder as `sourceDirectory` and an approved temporary file as `outputFile`. The shared helper validates the manifest/imports, precompiles CSS, embeds SVGs, and enforces at most 64 snapshot files and 2 MiB of file contents. Its generated HTML has a company-template title; App updates the live document title to `Your Name | Portfolio Template`. The shared helper is deliberately unchanged.

Only assets under templates/personal-portfolio/ are delivered here. Catalog registration, host thumbnails, shared preparation wiring, backend/frontend integration and the other selected template belong to the surrounding integration task. No shared generated directory is modified by this task. Runtime package/bundler acquisition may still need network access in the host preview; local assets do not make that runtime an offline distribution.

## Observed Verification

Verified on 2026-10-18 using the custom sourceDirectory and a temporary outputFile, without running the shared default preparation targets:

- Preparation and bundle validation passed: 16 snapshot files, 48,591 content bytes, digest `fb5d502ba0bc473b5ec456f622314e099f52d9a26f50b5eab79a0cbbc2258074`.
- All 15 provenance records were rechecked against the pinned Git objects. LICENSE and both SVGs match upstream bytes exactly.
- An isolated temporary harness checked the prepared virtual files with strict TypeScript and React 18 type definitions, then compiled them with exact React/React DOM 18.3.1. Both passed. This exercises the prepared snapshot, not host catalog integration or Sandpack acceptance.
- Chrome checks passed at 1280px desktop and 320px/375px mobile: all category filters, correct project details, close/Escape, dialog focus containment and focus return, section navigation, menu selection/Escape, and closing the menu when crossing the desktop breakpoint. No horizontal page overflow was observed at either mobile width.
- Clipboard success and an injected clipboard-denial path both produced the expected honest feedback. Reduced-motion rendering and local/data-URI resource loading passed. Desktop/mobile screenshots were inspected; browser console contained only the React development-tools notice.
- A resize check exposed a timing-sensitive menu handler; the implementation now uses the media-query event's matches value, and the affected resize check passed after rebuilding. No repository-wide tests or host integration acceptance are claimed for this asset-only change.
