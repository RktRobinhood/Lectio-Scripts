# Manager owns the optional shared dock

## Status

Accepted. Amends ADR-0001's description of the Manager's generic UI responsibilities.

## Context

Independent modules increasingly need persistent global controls. If each module creates a fixed button, it must independently choose viewport coordinates, z-index, sizing, responsive behavior, and collision rules. Those choices cannot remain independent as the number of modules grows.

The modules are separate Tampermonkey userscripts and must not import shared runtime code. Their existing integration with the Manager already crosses userscript sandboxes through namespaced DOM events.

## Decision

The Manager may own one generic left-side dock. Modules describe semantic controls through the documented `lectio-manager:dock:*` event contract; the Manager owns only shared presentation and interaction concerns: placement, icon resolution, badge chrome, states, sizing, ordering, persistence, accessibility wrappers, and flyout shells.

Feature behavior remains inside each module. The Manager must not branch on a module identity or contain module-specific actions, data, or panel content. Modules do not import Manager code and do not manipulate shared dock DOM.

A module using the dock must fail quietly when the Manager is absent. It must not recreate fixed-position placement as a fallback. Its underlying page-local or background feature should remain standalone where that feature has behavior independent of its global control. A diagnostic whose sole purpose is to test Manager integration may intentionally have no standalone UI, provided that dependency is explicit in its name and documentation.

The canonical event contract is [`docs/manager-dock-api.md`](../manager-dock-api.md).

## Consequences

- There is one collision-free home for persistent global module controls.
- The Manager gains generic platform UI, but no feature-specific logic.
- Dock presentation requires the Manager; modules remain separate scripts and exchange structured events rather than shared code.
- A module installed without the Manager continues without errors, but a dock-only entry point is unavailable.
- Page-local controls that genuinely belong beside Lectio content remain module-owned.
- Future persistent global controls use the dock instead of selecting their own fixed viewport coordinates.
