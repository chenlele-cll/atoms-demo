---
name: atoms-frontend-design
description: Use when designing, implementing, or reviewing Atoms frontend UI, including DESIGN.md, project navigation, prompt input, conversations, generation states, previews, code, and version history. Applies the approved Lovable-inspired warm minimal workspace style to the platform itself.
---

# Atoms Frontend Design

## Scope And Workflow

This is the authoritative design contract for the Atoms platform: describe an application, generate it, preview it, refine it through conversation, and revisit saved projects and code versions.

1. Read the root `README.md` and inspect the affected frontend components to establish what actually works.
2. Apply the product rules below to new platform UI. For the existing connection-check screen, read [references/initial-screen.md](references/initial-screen.md) and preserve its contract until an intentional restyle or replacement.
3. Implement with React, TypeScript, CSS Modules, native semantic HTML, and a small global token layer. The style does not require additional dependencies.
4. Add or revise tokens and reusable patterns here when the UI needs them. Keep root `DESIGN.md` as the entry point.
5. Verify the affected behavior using the checklist below and report the actual results.

This contract applies to the host platform. Generated applications follow the user's requested style and must not inherit host CSS across the preview boundary.

## Visual Direction

Use a warm, quiet creation workspace inspired by Lovable. Cream backgrounds, charcoal actions, fine warm borders, and clear typography make the prompt and the user's application the focal points. Use space and alignment to establish hierarchy; reserve shadows for subtle button depth and floating overlays.

The source documents describe a marketing website. The workspace layouts, status rules, accessibility requirements, and compact spacing below are Atoms adaptations. Do not copy marketing-scale spacing into the editor.

## Tokens

Use semantic CSS custom properties when implementing these values. These are the approved product tokens; the initial screen retains its separately documented palette.

| Role | Value | Usage |
| --- | --- | --- |
| Canvas | `#f7f4ed` | Page and workspace background |
| Surface | `#fcfbf8` | Composer, panels, menus |
| Text / primary action | `#1c1c1c` | Headings, body, primary button fill |
| Muted text | `#5f5f5d` | Supporting copy and metadata |
| Subtle border | `#eceae4` | Panel separation and passive card edges |
| Control border | `rgba(28, 28, 28, 0.4)` | Input and outlined control boundaries |
| Hover / selected wash | `rgba(28, 28, 28, 0.04)` | Navigation and secondary action hover |
| Focus | `#20573e` | Visible keyboard focus outline |
| Success | `#20573e` | Confirmed completion or saved state |
| Warning | `#8a4b0f` | Recoverable warning or interruption |
| Error | `#a52d25` | Failure text and destructive actions |

- Primary button text: `#fcfbf8`. Verify contrast for each actual foreground/background pairing; subtle dividers alone do not identify interactive controls.
- Green, warning, and error colors are semantic Atoms additions, used with text or icons. Keep the general chrome neutral.
- Font: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; use available system CJK fallbacks for Chinese. Technical content: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Body and conversation: 16px, line-height 1.6; controls and navigation: 14px, line-height 1.5; metadata: 12px, line-height 1.5. Do not place essential instructions only in metadata.
- Weights: 400 for body, 500 for controls, 600 for headings. Workspace headings: 20-24px; creation-entry title: responsive 32-48px. Keep Chinese body tracking normal; avoid aggressive negative tracking on Chinese headings.
- Spacing: 4, 8, 12, 16, 24, 32, 48px. Use 16-24px inside panels and 8-12px between related controls.
- Radius: 6-8px for buttons and inputs, 12px for cards, 16px for the main composer. Pills are limited to compact suggestions or labels.
- Standard panels have no shadow. A dark primary button may use `inset 0 0.5px 0 rgba(255, 255, 255, 0.2), 0 1px 2px rgba(0, 0, 0, 0.05)`.
- Overlay shadow: `0 8px 24px rgba(28, 28, 28, 0.12)`, only on menus and dialogs that actually float above content.

## Page And Workspace Layouts

### Creation Entry

- Lead with a brief, concrete invitation and a large multiline prompt composer, approximately 640-760px wide on desktop within a centered content column.
- Place a small number of actionable example prompts below the composer. Selecting one must populate or submit an actual prompt according to its explicit label.
- Show recent projects when persistence is implemented; otherwise show an honest empty state. Preserve user-entered text after recoverable errors.
- Use generous entry-page whitespace without pushing the composer below the initial viewport on common laptop screens. Avoid unnecessary promotional sections.

### Project Navigation

- Use a compact, approximately 224-256px desktop sidebar for project access and history. Separate project switching from version selection within the current project.
- Selected rows use a neutral wash plus a persistent text, weight, or shape cue. Provide explicit labels for icon-only controls.
- Long project titles truncate in the row while remaining available through an accessible name and the project header. Menus must work with keyboard and touch.

### Editing Workspace

- Use a compact project header, a conversation pane approximately 340-420px wide, and a flexible preview area with the largest share of desktop space. Collapse the sidebar before squeezing the preview beyond usability.
- Anchor the composer within the conversation pane. Keep long conversations scrollable without moving the preview toolbar out of reach.
- Group real task events under the associated response. Present code and version history as explicit views or panels when implemented.
- The preview toolbar belongs to the host. Keep the generated application's own colors, typography, and scrolling inside its isolated preview.
- Preserve view state when switching between preview, code, and history where feasible. Name the active project and version so the user can identify the result they are viewing.

## Components And Interaction

- Primary actions use charcoal fill and light text. Secondary actions use a neutral surface and visible border; tertiary actions use clear text labels and a hover wash. Give destructive actions explicit wording.
- Inputs have persistent accessible labels, readable placeholders, visible boundaries, and a clear focus outline. Composer submit controls must expose their action and disabled reason when applicable.
- Distinguish Enter from multiline entry deliberately. If Enter submits, Shift+Enter inserts a newline, and IME composition must never submit accidentally. Document the chosen behavior near the composer when helpful.
- Keep one clear primary action per local task. Show only implemented controls; do not add inactive model, upload, publish, or deployment selectors as decoration.
- Suggestions and project cards respond to hover, focus, and activation. Card titles and metadata remain readable without hovering.
- Use brief 150-200ms color or opacity transitions. Honor `prefers-reduced-motion`; avoid decorative looping motion, glow effects, and large gradient backgrounds in the workspace.

## Truthful States And Recovery

| State | Required presentation |
| --- | --- |
| Empty | Explain the next available action; no fabricated projects or conversations |
| Submitting / generating | Reflect actual request or task state, prevent duplicate submission, expose cancellation when supported |
| Progress | Show only actual events; no fabricated tool steps, progress percentages, or timers that imply work completed |
| Cancelling / cancelled | Distinguish a cancellation request from acknowledged cancellation; preserve usable prior output |
| Generated | Identify the resulting version; report compilation or interaction checks separately and only with evidence |
| Failed / disconnected | State the failure near the affected action, preserve the prompt and last usable result, offer a working retry when supported |
| Saving / saved / save failed | Reflect persistence acknowledgement; never claim a result is saved based only on local rendering |
| Preview failure | Keep the surrounding workspace usable and explain the preview error without replacing the conversation |

Use a polite live region for meaningful status changes, without announcing every streaming token. Errors must be discoverable by assistive technology. Color is always paired with an explicit label or other meaningful cue.

## Responsive And Accessible Behavior

- At 1200px and above, use the desktop sidebar and split conversation/preview layout when space permits.
- From 768px to 1199px, collapse navigation to a drawer or compact control. Retain split panes only while both remain usable; otherwise use explicit view tabs.
- Below 768px, show conversation, preview, code, and history as separate selectable views. Keep the current view labelled, preserve input and scroll state, and avoid horizontally shrinking the whole desktop layout.
- Support 320px width with 16px page padding. Long URLs, file paths, and error messages wrap; code may scroll within its own container. All flex/grid panes must be allowed to shrink appropriately.
- Interactive targets are at least 44px in both dimensions, including toolbar icon hit areas. Use a visible 2px focus outline with a 2px offset; a soft shadow alone is insufficient.
- Use semantic buttons, forms, headings, and navigation. Follow established keyboard behavior for any tabs, menus, or dialogs; manage dialog focus and restore it to the trigger.
- Preview frames need a descriptive title. Keep controls reachable at browser zoom and with the mobile keyboard open; do not rely on color, hover, or motion alone.

## Verification

- Run `pnpm check` and `pnpm build` after relevant implementation changes.
- Exercise changed UI in a browser at desktop and 320/375px widths. Check overflow, keyboard navigation, focus visibility, loading, empty, and failure states.
- Test actual streaming, disconnection, and cancellation against a running server when those behaviors change. Injection tests alone do not prove them.
- Use `pnpm smoke` for the existing startup and connectivity flows when affected. Extend behavior coverage as product features replace the skeleton.
- Documentation-only changes require checking links, skill metadata, and consistency; they do not establish that any product UI has been implemented or browser-tested.

## Sources And Adaptation

Approved direction: Lovable-inspired warm minimal workspace. The documents below were reviewed during selection on 2026-10-18; they are third-party analyses, not official Lovable specifications.

- [VoltAgent awesome-design-md: Lovable](https://github.com/voltagent/awesome-design-md/blob/main/design-md/lovable/DESIGN.md)
- [OpenDesign: Lovable](https://github.com/nexu-io/open-design/blob/main/design-systems/lovable/DESIGN.md)

Their core Lovable guidance is substantially the same. This file is a project-specific adaptation, not a verbatim import. It retains the cream/charcoal palette, restrained borders, shallow depth, and approachable composer. It replaces proprietary font assumptions with system fonts and adds workspace layouts, semantic states, stronger focus treatment, and touch targets. References to Tailwind, shadcn/ui, or Radix in the sources are not dependency requirements for Atoms.
