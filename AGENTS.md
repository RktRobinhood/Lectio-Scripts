# Agent instructions — Lectio Scripts

This repo stores, versions, and updates Tampermonkey userscripts for Lectio (a Danish school timetable/messaging platform, `https://www.lectio.dk/lectio/*`). Users install scripts manually (copy-paste) or through the Lectio Manager. Domain vocabulary lives in [CONTEXT.md](./CONTEXT.md); architectural decisions live in [docs/adr/](./docs/adr/) — read both before making non-trivial changes.

## Non-negotiable invariants

- **No shared runtime code between modules.** Every `modules/*.user.js` file is fully self-contained and must work if copy-pasted alone into Tampermonkey. Never introduce a shared library, common helper file, or shared CSS dependency between modules. See [ADR-0001](./docs/adr/0001-manager-module-separation.md).
- **No build step.** Plain userscripts only — no bundler, no `package.json`, no transpilation. Write code as it will run.
- **No server-side component.** `catalogue/modules.json` is static JSON fetched over HTTPS; nothing dynamic or executable lives server-side. See [ADR-0003](./docs/adr/0003-static-catalogue-independent-versioning.md).
- **The Manager never gains feature-specific logic.** `manager/Lectio-Manager.user.js` only discovers modules, links to install them, renders a *generic* settings UI from a module-supplied schema, and shortcuts to Tampermonkey's dashboard. If a request sounds like "have the Manager do X for module Y," the answer is to put X in module Y, not in the Manager. See [ADR-0001](./docs/adr/0001-manager-module-separation.md).
- **No memory leaks.** Modules run persistently on every matched Lectio page load. Any listener, `setInterval`/`setTimeout`, or `MutationObserver` a module adds must be capable of being torn down or scoped so it doesn't accumulate across navigations. Be conservative with polling.

## Contribution model

Solo-maintained by the repo owner with AI agents as the primary collaborators. **Issues only — no external pull requests are merged** (see [ADR-0004](./docs/adr/0004-issues-only-no-external-prs.md)): userscripts run with broad access inside an authenticated Lectio session, so outside code is a supply-chain risk the owner won't accept. Feature/bug feedback from end users (non-technical teachers and students) arrives via GitHub Issues, linked from the Manager's footer.

Tampermonkey itself (not a custom browser extension) is the deliberately chosen distribution platform for now — see [ADR-0005](./docs/adr/0005-tampermonkey-as-platform.md) if you're tempted to suggest otherwise.

## Adding a new module

A new module is just:

1. A new `modules/<Name>.user.js` file with a standard header (`@name`, `@version`, `@match https://www.lectio.dk/lectio/*` or a narrower path, `@updateURL`/`@downloadURL` pointing at its own raw GitHub path) that, on load and on receiving the `lectio-manager:discover` event, dispatches `lectio-module:register` with `{ id, name, version, settingsSchema, currentValues }` (an empty `settingsSchema: []` is fine if the module has no configurable options yet).
2. A matching entry in `catalogue/modules.json` (`id`, `name`, `description`, `category`, `audience`, `status`, `version`, `installUrl` under `raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/`, `supportUrl`).

Nothing else is required, and the Manager's own code never needs to change for a new module.

## Lectio platform notes (extracted from the existing modules)

- **School scoping**: a Lectio installation is identified by a numeric id in the URL path, e.g. `/lectio/223/...`. Some modules (Chairs Up) work universally across schools by parsing the school id out of `location.pathname`; others (Unread Message Notifications) are hard-restricted to one school via `@match https://www.lectio.dk/lectio/223/*` because their DOM-scraping logic hasn't been generalized yet.
- **Timetable lesson elements**: lessons/bookings render as `a.s2skemabrik.s2brik[data-tooltip]`; the tooltip text carries the actual date/time (`D/M-YYYY HH:MM til HH:MM`, Danish) and room list (`Lokale(r): ...`).
- **Cancelled activities**: detected via the `s2cancelled` CSS class (on the element or a child) or tooltip text starting with `Aflyst!` (Danish) / `Cancelled`/`Canceled` (English fallback). Always filter these out rather than treating them as real bookings.
- **Room identifiers**: Lectio room ids appear in URLs/attributes as `RO<digits>` or bare numeric ids behind `type=lokale`. There's no direct API for "all rooms" — Chairs Up discovers them by harvesting room links off pages that happen to expose them (a room's own timetable page, the schedule front page, or an activity-edit page), then caches the result for ~30 days.
- **Unread messages**: found by locating nav text matching `/^(Beskeder|Messages)$/i`, then parsing a `"N unread"` pattern near it on the Forside (front page), with a fallback scan of message rows for `tr.unread`, `.message-list-thread-container.unread`, or `data-status="unread"`/`data-state="unread"` attributes. A parsing failure must never be treated as "zero unread" — that's a deliberate rule in the existing code, not an oversight.
- **English Mode** runs on every Lectio page (`@match https://www.lectio.dk/lectio/*`, no school restriction), uses a `MutationObserver` to catch newly-rendered Danish text, and falls back to the Google Translate API (`translate.googleapis.com`, `translate.google.com`) for text it doesn't recognize itself.
- Server-rendered pages can be fetched and parsed directly (`fetch(url, { credentials: 'include' })` + `DOMParser`) to read data the current page doesn't expose — used by Chairs Up to look up room schedules the visible timetable doesn't show.

## Visual starting point (current, informal — see also ADR-0006)

No shared stylesheet exists or should exist, but for visual consistency when hand-matching a new module's look:

- **Manager**: teal `#0f6f6f` (header background, buttons, active nav items), white panel `#ffffff`, body text `#10201e`, secondary text `#5e6870`, `Roboto, Arial, sans-serif`, 10px card/panel border-radius, thin `#d6dde0`/`#eef1f2` borders, minimal-stroke line-art SVG icons (gear, wrench, refresh, close, chevron).
- **Chairs Up**: alert-red gradient `#ff3155` → `#d9002f` for its badge/notice (deliberately urgent, not matched to the Manager's teal).
- **Unread Message Notifications**: light blue `#cae6ff` badge background, dark navy `#001e2f` text.
- **English Mode**: mid blue `#35658c` accents.

There is no enforced consistency today — each module picked its own palette independently. A new module should either match the Manager's teal (if it's a neutral utility) or pick a deliberate, distinct accent color (as Chairs Up did for urgency) — but per [ADR-0006](./docs/adr/0006-css-custom-property-theming-seam.md), expose its key colors as CSS custom properties with hard-coded fallbacks so a future optional theme layer could override them.

## Known gaps / future directions (not committed work, just notes)

- **The Manager's settings seam is unused.** `manager/Lectio-Manager.user.js` fully implements rendering a generic settings panel (toggle/select/range/text/button controls) from a module's `settingsSchema`, wired through the `lectio-manager:set-setting` event — but all three existing modules currently register with `settingsSchema: []`. The first real candidate for future work is wiring an actual option (e.g. a chime on/off toggle for Unread Message Notifications, or a poll-interval control) into one existing module, to exercise this seam end-to-end for the first time.
- **Resilience to Lectio's own changes.** Lectio can change its page structure at any time, and there's no automated monitoring for that today. The working principle: modules should feature-detect and degrade gracefully (as the "never treat a parse failure as zero unread" rule already does) rather than hard-depend on fragile selectors, and checking real Lectio pages for structural drift is a periodic manual/agent-assisted maintenance task, not an automated one yet.
- **School/class-level theming** is a motivating long-term idea (raised as "foundational") but nothing beyond the CSS-custom-property seam in ADR-0006 has been decided. Do not build a central theme layer speculatively — wait for an explicit decision.
