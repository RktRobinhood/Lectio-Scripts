# Manager and modules share no runtime code

> Amended by [ADR-0012](./0012-manager-owned-shared-dock.md): the Manager may provide generic dock presentation and interaction through namespaced DOM events. It still contains no module-specific feature logic and shares no imported runtime library with modules.

The Manager (`manager/Lectio-Manager.user.js`) discovers, installs, and hosts generic presentation for modules, but never contains feature-specific logic, and modules never share a library with each other or with the Manager — each `modules/*.user.js` file contains its own feature logic. This was chosen over a monolith or a shared-library approach so that installing (or copy-pasting) any single module runs safely on its own: no feature implementation needs to be trusted, downloaded, or kept in sync from another module. An optional dock entry point requires the Manager's generic presentation service as specified by ADR-0012, but its absence must not break the module. The Manager's own file carries a "NON-NEGOTIABLE BOUNDARY" comment enforcing the feature-logic boundary.

## Consequences

Every new feature idea must ask "does this belong in one module, or does it need the Manager to grow feature logic?" — the answer is always the former. Generic Manager platform surfaces may present structured module declarations as described by a later ADR, but the behavior behind a control remains in its module. Anything that looks like shared feature code between two modules (a common helper, feature-specific style, or shared cache) should be duplicated per-module rather than extracted, unless a future ADR revisits this.
