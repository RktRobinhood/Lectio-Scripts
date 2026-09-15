# Static catalogue JSON, independent per-module versioning

`catalogue/modules.json` is a static file the Manager fetches over HTTPS and caches locally (refreshed at most daily, or on manual refresh) — there is no server generating it dynamically, and no central version number for "the project." Each module keeps its own `@version`/`@updateURL`/`@downloadURL` and updates independently through Tampermonkey's own update mechanism, entirely separately from the Manager's own version and from the catalogue's freshness. This was chosen over a central registry/version service because it needs no infrastructure beyond GitHub itself, and it keeps every module's install/update story identical whether a user goes through the Manager, GitHub Raw, or copy-paste.

## Versioning rule

Every userscript — modules and the Manager alike — uses three-part `MAJOR.MINOR.PATCH`, digits only, with no `v` prefix and no pre-release suffix. Increment exactly one part per delivered change:

- **PATCH** (`0.14.2` → `0.14.3`) — bug fix, styling correction, or selector repair; nothing changes about what the module offers the user.
- **MINOR** (`1.7.0` → `1.8.0`) — new user-visible behaviour or a new setting, backwards compatible with existing configuration.
- **MAJOR** (`0.14.3` → `1.0.0`) — a module leaving `experimental` for `stable`, a removed or renamed setting, or any change that breaks an existing user's saved configuration.

Never reuse or decrease a version. Tampermonkey and the Manager both decide "is there an update?" with a strictly-greater comparison, so a repeated version ships to nobody and a lowered one strands everyone already installed.

Two-part versions (`1.3`) were considered and rejected. The Manager already treats a missing part as zero, so two- and three-part numbers interoperate fine — the problem is migrating the scripts that exist: `1.8.0` → `1.8` compares equal (no update fires) and `0.14.3` → `0.14` is a decrease. Three parts also keep "fixed a bug" distinguishable from "added a setting" in the one place users actually read it.

A module's version lives in three places that must always match: the `@version` header, the `MODULE_VERSION` constant it registers with, and its `catalogue/modules.json` entry. The Manager compares the Catalogue version against the registered version, so a Catalogue entry lagging the module hides the update entirely, while one running ahead advertises an update that installing cannot satisfy.

## Consequences

Adding, removing, or changing a module never requires touching the Manager's code — only a new file under `modules/` and a matching entry in `catalogue/modules.json`.
