# Initial UI Contract

This file covers the repository connection-check screen only. Product workspace design will be defined when its UI work begins.

## Scope

- Show the project identity, initialization status, and an explicit backend connectivity check.
- Do not display simulated conversations, generated applications, or inactive product controls.
- Use native HTML elements, CSS Modules, and system fonts. No visual libraries or remote assets are needed for this screen.

## Tokens

- Background: `#f6f5f1`; surface: `#ffffff`; foreground: `#202823`; muted: `#59635d`.
- Accent: `#20573e`; border: `#d7ddd7`; error: `#a52d25`.
- Body font: system sans-serif; technical labels: system monospace.
- Body: 16px / 1.6; heading: clamp(2rem, 6vw, 3.5rem); eyebrow: 12px.
- Spacing scale: 8, 16, 24, 32, 48px. Content max width: 880px.
- Border radius: 6px for buttons, 12px for the status panel.

## Layout And States

- Single-column document layout with a compact header and one status panel.
- Page padding: 48px desktop, 24px at widths below 600px. Long technical strings must wrap.
- Connectivity button: idle, disabled while checking, success, and failure feedback.
- Status text uses a polite live region; color is never the only status indicator.
- Buttons have a visible keyboard focus outline, at least 44px height, and readable contrast.
- No decorative animation or external fonts. The screen must remain usable at 320px width.
