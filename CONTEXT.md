# Lectio Scripts

A repository that stores, versions, and distributes independent Tampermonkey userscripts for Lectio, installable either manually (copy-paste) or through the Manager.

## Language

**Module**:
An independent Tampermonkey userscript, in `modules/`, that adds exactly one Lectio feature. Fully self-contained — no shared runtime code with any other module — and works whether installed alone or alongside others.
_Avoid_: script (too generic), extension, plugin.

**Manager**:
The single always-on userscript (`manager/Lectio-Manager.user.js`) that discovers installed modules, links to install them, and hosts a generic settings surface for them. Contains no feature-specific logic of its own.
_Avoid_: dashboard (reserved for Tampermonkey's own dashboard), app.

**Catalogue**:
The static `catalogue/modules.json` file listing every module that exists and where to install it from. Fetched by the Manager over HTTPS and read as text data only.
_Avoid_: registry (implies a dynamic/server-backed service, which this isn't), index.

**Discovery**:
The handshake by which the Manager learns which modules are currently running: the Manager broadcasts a request, and each installed module answers for itself, on its own page load.
_Avoid_: detection, polling, scanning.

**Registration**:
A module's answer to Discovery — it reports its id, name, version, and (optionally) a Settings Schema, without the Manager reading any of the module's own private storage.
_Avoid_: handshake reply, check-in.

**Settings Schema**:
The set of generic controls (toggles, dropdowns, ranges, text fields, colour pickers, buttons) a module declares so the Manager can render an options panel for it, without the Manager ever knowing what those options mean or do. A control may include a `section` label so related settings are grouped in the focused settings view; schemas without sections remain valid. A control's `description` is rendered behind a click-to-reveal info toggle rather than shown inline, so a module can explain a setting fully without the panel reading as more overwhelming than it needs to. A select control may opt into `previewOnHover`, in which case the Manager emits generic preview/clear-preview events while the user explores options and persists only the option they choose. A control may opt into `advanced: true`; when every control sharing a `section` does, the Manager renders that whole section collapsed behind a click, for settings — like a hand-picked colour palette — that most people will never need because a built-in default already covers them.
_Avoid_: config, preferences, options panel (these describe the rendered result, not the mechanism).

**School**:
A single Lectio installation/tenant, identified by the numeric id in its URL path (e.g. `/lectio/223/`). Modules and cached data are frequently scoped per School.
_Avoid_: institution, tenant, organization.

**Audience**:
A catalogue tag (student, teacher) describing who a module is aimed at. Used to filter the Manager's module list; does not restrict installation.
_Avoid_: role, user type.

**Category**:
A catalogue tag grouping modules by feature area (e.g. Interface, Timetable, Messages), used to organize the Manager's module list.
_Avoid_: type, group.
