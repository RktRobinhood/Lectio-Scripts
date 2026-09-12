# Static catalogue JSON, independent per-module versioning

`catalogue/modules.json` is a static file the Manager fetches over HTTPS and caches locally (refreshed at most daily, or on manual refresh) — there is no server generating it dynamically, and no central version number for "the project." Each module keeps its own `@version`/`@updateURL`/`@downloadURL` and updates independently through Tampermonkey's own update mechanism, entirely separately from the Manager's own version and from the catalogue's freshness. This was chosen over a central registry/version service because it needs no infrastructure beyond GitHub itself, and it keeps every module's install/update story identical whether a user goes through the Manager, GitHub Raw, or copy-paste.

## Consequences

Adding, removing, or changing a module never requires touching the Manager's code — only a new file under `modules/` and a matching entry in `catalogue/modules.json`.
