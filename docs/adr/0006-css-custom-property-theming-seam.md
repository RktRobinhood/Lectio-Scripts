# Modules stay self-styled; theming is a required override seam, not a dependency

Modules must keep their own complete CSS and look correct installed entirely alone (per the module-separation ADR) — no module may depend on a shared stylesheet or the Manager for its visual identity. The seam for this is for every module to expose its key colors as CSS custom properties with hard-coded fallback values (`var(--lectio-theme-accent, #0f6f6f)`), so an independent theme layer can override those properties without any module depending on it being present or knowing it exists.

This started as an optional convention kept open for a possible future theme layer. That theme layer now exists — **[Lectio Theming](../../modules/Lectio-Theming.user.js)** — and sets these properties on `:root` (only while its own toggle is enabled; it removes all of them when disabled, so a module's fallback correctly kicks back in). Exposing colors through this seam is therefore **required for every new module**, not optional, so it participates in theming automatically.

## The variable names

Use these exact names so a new module's colors line up with every theme Lectio Theming ships, without either module needing to know about the other:

| Variable | Role |
|---|---|
| `--lectio-theme-bg` | Page background |
| `--lectio-theme-surface` | Primary panel/card background |
| `--lectio-theme-surface-alt` | Secondary/hover background, striping |
| `--lectio-theme-text` | Primary text |
| `--lectio-theme-muted` | Secondary text, borders |
| `--lectio-theme-accent` | Primary brand/link/focus color |
| `--lectio-theme-accent-alt` | Secondary accent |
| `--lectio-theme-danger` | Error/destructive state |
| `--lectio-theme-radius` | Corner radius |

Every use must supply the module's own current hard-coded value as the `var()` fallback, so the module is visually unchanged with Lectio Theming absent or disabled. Semantic status colors (success/warning/error badges meant to stay recognizable regardless of theme) are exempt — leave those hard-coded.

Two pitfalls found while retrofitting the Manager, worth avoiding by construction in new modules:

- **Don't theme a `<select>`'s background/text color.** A browser's open native `<option>` popup doesn't reliably inherit an author's `background`/`color` from the `<select>` across browsers and OS light/dark settings — a dark theme's light text can land on a still-light native popup and become illegible. Keep `<select>` (and `<input type="text">` next to it, for visual consistency) on a fixed, always-legible base and only theme its `border-color`.
- **Text sitting on `--lectio-theme-accent` must not use `--lectio-theme-surface` for its color.** These are two independent theme colors with no guaranteed contrast relationship — a dark theme's dark surface can end up as dark-on-accent instead of the light-on-accent the design intended. Use a fixed `#ffffff` (or `--lectio-theme-bg`/`-text`, whichever this theme's own contrast logic actually pairs with accent — none of the shipped themes guarantee `-surface` does) for any text/icon that sits directly on an accent-colored background.

## Consequences

New modules must adopt this seam from day one (see the "Adding a new module" checklist in [AGENTS.md](../../AGENTS.md)). Retrofitting it onto existing modules is being done incrementally, not required to land all at once — Lectio English Mode's DA/EN switch and Lectio Manager's panel have already been migrated as of this ADR's last update.
