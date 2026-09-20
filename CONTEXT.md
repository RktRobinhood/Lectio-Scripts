# Lectio Scripts

A repository that stores, versions, and distributes independent Tampermonkey userscripts for Lectio, installable either manually (copy-paste) or through the Manager.

## Language

**Module**:
An independent Tampermonkey userscript, in `modules/` once it is on the stable Channel and in `modules-unstable/` while it is being worked on, that adds exactly one Lectio feature. Its feature logic is fully self-contained — no shared runtime code with any other module — and runs safely whether installed alone or alongside others. Optional Manager-dock presentation is available only when the Manager is installed.
_Avoid_: script (too generic), extension, plugin.

**Manager**:
The single always-on userscript (`manager/Lectio-Manager.user.js`) that discovers installed modules, links to install them, hosts a generic settings surface, and owns the optional shared dock used by module-declared global controls. Contains no feature-specific logic of its own.
_Avoid_: dashboard (reserved for Tampermonkey's own dashboard), app.

**Catalogue**:
The static `catalogue/modules.json` file listing every module that exists and where to install it from. Fetched by the Manager over HTTPS and read as text data only.
_Avoid_: registry (implies a dynamic/server-backed service, which this isn't), index.

**Channel**:
Which set of module versions a user's Manager reads: Stable (`catalogue/modules.json`) or Unstable (`modules-unstable/modules.json`, overlaid on top of it). Chosen by the user in the Manager's own settings and nowhere else. Not a Git branch — both live on `main`.
**Unstable is the repo's word for it; no user ever sees it.** Inside the repo it is Unstable — the folder `modules-unstable/`, the stored value and catalogue `status` `unstable`, and the term AGENTS.md and [ADR-0014](./docs/adr/0014-unstable-first-releases.md) use throughout. Every string the Manager shows says **Experimental** (Danish **Eksperimentel**); Stable is **Stable** / **Stabil**. So anything a user reads — the issue forms, README instructions, release notes, anything quoting the Manager — says Experimental, and repo- and agent-facing text says Unstable. (The Manager also badges individual modules *Experimental*; that is a maturity marker on one module, not the Channel.)
_Avoid_: branch, track, ring; Unstable in anything a user reads.

**Promotion**:
Moving a module from the Unstable Channel to the Stable one: the owner asks for it by name, and the module's file and catalogue entry move from `modules-unstable/` to `modules/` and `catalogue/modules.json` with one more patch bump. The only way anything reaches Stable users, per ADR-0014.
_Avoid_: release, merge, ship (all ambiguous about which Channel is meant).

**Discovery**:
The handshake by which the Manager learns which modules are currently running: the Manager broadcasts a request, and each installed module answers for itself, on its own page load.
_Avoid_: detection, polling, scanning.

**Registration**:
A module's answer to Discovery — it reports its id, name, version, and (optionally) a Settings Schema, without the Manager reading any of the module's own private storage.
_Avoid_: handshake reply, check-in.

**Settings Schema**:
The set of generic controls (toggles, dropdowns, ranges, text fields, colour pickers, buttons) a module declares so the Manager can render an options panel for it, without the Manager ever knowing what those options mean or do. A control may include a `section` label so related settings are grouped in the focused settings view; schemas without sections remain valid. A control's `description` is rendered behind a click-to-reveal info toggle rather than shown inline, so a module can explain a setting fully without the panel reading as more overwhelming than it needs to. A select control may opt into `previewOnHover`, in which case the Manager emits generic preview/clear-preview events while the user explores options and persists only the option they choose. A control may opt into `advanced: true`; when every control sharing a `section` does, the Manager renders that whole section collapsed behind a click, for settings — like a hand-picked colour palette — that most people will never need because a built-in default already covers them.
_Avoid_: config, preferences, options panel (these describe the rendered result, not the mechanism).

**Storage Declaration**:
The optional list a module adds to its Registration saying which browser-storage keys are its own, whether each is a cache, a setting or state, and which of them are safe to throw away. The Manager measures sizes for itself and takes everything else from here, so it can show what is using the page's ~5 MB without knowing what any of it means; a key no running module claims is listed as unclaimed and cannot be cleared from the Manager at all. Pruning is a request (`lectio-manager:prune-storage`) that the owning module carries out — the Manager never deletes a module's data itself. The contract is [`docs/manager-storage-api.md`](./docs/manager-storage-api.md).
_Avoid_: storage manifest, quota list (neither is a description of who decides).

**Request Slot**:
A turn at doing background work, asked for by a module and granted by the Manager one at a time, so several modules stop firing at Lectio in the same instant. The Manager knows only two opaque strings — who to answer and which request — and never what is being fetched or why. It is optional in both directions and fails open: a module waits a short moment for any answer at all, goes ahead on its own clock if none comes, remembers that nothing answered so the next request does not wait either, and can never be made to wait longer than it decided to — so no Manager, an old Manager and a broken one are the same case, costing one short pause per page view. The contract is [`docs/manager-request-slots.md`](./docs/manager-request-slots.md).
_Avoid_: lock, semaphore, rate limit (all describe a guarantee this deliberately does not give), queue (that is the Manager's side of it, not the thing a module holds).

**Settings File**:
The JSON file the Manager writes from, and reads back into, the settings it already renders: its own preferences, and the values of every control each running module declares in its Settings Schema. It is stamped with a format version and keyed by module id, it is shown before it is saved and described before it is applied, and importing one replays values through the same `lectio-manager:set-setting` event a hand-turned control uses — so no module has code for it and the Manager still knows what nothing means. It cannot carry a cache, a learned palette, the problem log or Theming's background picture. The format is [`docs/manager-settings-file.md`](./docs/manager-settings-file.md).
_Avoid_: backup (it restores settings, not a browser), profile, preset (reserved for a theme's own).

**School**:
A single Lectio installation/tenant, identified by the numeric id in its URL path (e.g. `/lectio/223/`). Modules and cached data are frequently scoped per School.
_Avoid_: institution, tenant, organization.

**Audience**:
A catalogue tag (student, teacher) describing who a module is aimed at. Used to filter the Manager's module list; does not restrict installation.
_Avoid_: role, user type.

**Category**:
A catalogue tag grouping modules by feature area (e.g. Interface, Timetable, Messages), used to organize the Manager's module list.
_Avoid_: type, group.
