# Manager and modules share no runtime code

The Manager (`manager/Lectio-Manager.user.js`) discovers, installs, and hosts settings for modules, but never contains feature-specific logic, and modules never share a library with each other or with the Manager — each `modules/*.user.js` file is fully self-contained. This was chosen over a monolith or a shared-library approach so that installing (or copy-pasting) any single file is safe and complete on its own: nothing else needs to be trusted, downloaded, or kept in sync. The Manager's own file even carries a "NON-NEGOTIABLE BOUNDARY" comment enforcing this.

## Consequences

Every new feature idea must ask "does this belong in one module, or does it need the Manager to grow feature logic?" — the answer is always the former. Anything that looks like shared code between two modules (a common helper, a shared style, a shared cache) should be duplicated per-module rather than extracted, unless a future ADR revisits this.
