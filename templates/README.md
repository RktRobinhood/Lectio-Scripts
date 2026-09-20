# templates

Copy-me starting points. **Nothing here ships.** No file in this folder is in
`catalogue/modules.json` or `modules-unstable/modules.json`, nothing loads any
of it at runtime, and no module should ever import from it — a module that came
from a template is fully self-contained the moment it is copied, which is what
keeps the no-shared-runtime-code invariant in
[ADR-0001](../docs/adr/0001-manager-module-separation.md) intact.

`node scripts/check-versions.mjs` and `node scripts/build-dock-icons.mjs --check`
read `manager/`, `modules/`, `modules-unstable/` and `assets/icons/` only, so
they do not see this folder and a template needs no catalogue entry. CI does
syntax-check every `templates/*.user.js` with `node --check`, so a template has
to parse.

## `Lectio-Module-Skeleton.user.js`

A complete, working, do-nothing module: it registers with the Manager, declares
one setting of every control type the Manager renders, reads the language,
writes its colours through the theming seam, registers one dock item that fails
quietly with no Manager installed, and tears everything down again. It touches
nothing Lectio rendered. Copy it, rename it, and delete what you do not need.

## Checklist for a module built from it

The skeleton already does everything in the top half of this list. It is here so
you can confirm nothing fell out while you were editing.

**In the file**

- [ ] `@name`, `@description` and `MODULE_NAME` describe *your* module.
- [ ] `MODULE_ID` is a new, stable, lowercase-hyphen id, and it matches the `id`
      in the catalogue entry.
- [ ] `@match` is `https://www.lectio.dk/lectio/*` or a narrower path — never a
      single school. Derive the school from `location.pathname`
      ([ADR-0007](../docs/adr/0007-school-agnostic-by-default.md)).
- [ ] `@updateURL` and `@downloadURL` point at the folder the file actually
      lives in. Tampermonkey follows these, not the catalogue, once installed.
- [ ] It registers on load **and** on `lectio-manager:discover`
      ([ADR-0002](../docs/adr/0002-event-based-discovery.md)).
- [ ] Every colour is `var(--lectio-theme-*, <your own hard-coded value>)`
      ([ADR-0006](../docs/adr/0006-css-custom-property-theming-seam.md)).
      Required, not optional.
- [ ] Both languages are inline in the one file, Danish as the fallback
      ([ADR-0013](../docs/adr/0013-one-script-per-module-both-languages-inline.md)).
- [ ] Any persistent global control goes through the
      [dock event contract](../docs/manager-dock-api.md), with no module-chosen
      coordinates or z-index, and fails quietly with no Manager
      ([ADR-0012](../docs/adr/0012-manager-owned-shared-dock.md)).
- [ ] Every listener, timer, interval, observer and inserted node is torn down.
- [ ] Installed **without** the Manager it still loads and throws nothing.

**Around the file**

- [ ] An entry in `modules-unstable/modules.json` with the same `id`, and a
      section in `modules-unstable/README.md`.
- [ ] The three "which script" dropdowns in
      [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/) list the new
      module. They are the only channel non-technical users have; a module
      missing from them turns every report into "Other".
- [ ] `node scripts/check-versions.mjs`, `node scripts/build-dock-icons.mjs --check`
      and `node --test "tests/**/*.test.js"` all pass.

## It goes to Experimental first

Every new module, and every change to an existing one, lands in
`modules-unstable/` before it reaches anyone on Stable. This is not optional —
[ADR-0014](../docs/adr/0014-unstable-first-releases.md).

The channel has two names on purpose, and they mean the same thing: the Manager
calls it **Experimental**, because that is what it means to a student or teacher
choosing it; the repository, the folder and the stored setting call it
**unstable**. It is a folder on `main`, not a Git branch, so "push to `main` when
it's done" still holds.

Only the repo owner promotes to Stable, and they ask for it in those words. The
six steps are in [ADR-0014](../docs/adr/0014-unstable-first-releases.md#promoting).
The Manager is the one exception: it goes straight to Stable, because it is what
delivers the channels.

## The four places a version number lives

Miss one and there is no error — the Manager simply keeps offering the old
version, so nobody is ever told an update exists. That has cost several rounds
of "why am I not seeing the update", which is why it is a script and not a
habit.

| # | Where | What reads it |
| - | ----- | ------------- |
| 1 | `@version` in the userscript header | Tampermonkey's own update check |
| 2 | `MODULE_VERSION` (or the frozen `MODULE` object's `version:`) | what the module reports at Discovery, and what the Manager compares against the catalogue |
| 3 | `modules-unstable/modules.json`, or `catalogue/modules.json` once promoted | the number users are actually offered — the Manager reads this over HTTPS, not the file on disk |
| 4 | The bump itself | if the file changed at all, the number must move |

`MAJOR.MINOR.PATCH`, exactly one part per change, never reused, never decreased,
and no `-beta` suffixes
([ADR-0003](../docs/adr/0003-static-catalogue-independent-versioning.md)). One
number line across both channels: stable at `1.9.3` → `1.9.4` in unstable,
further rounds `1.9.5`, `1.9.6`, and promotion bumps once more to `1.9.7`.

`node scripts/check-versions.mjs` checks all four, including the one the others
cannot catch: a file edited with its version left alone.

A correct bump still will not appear immediately. The Manager caches the stable
catalogue for 24 hours and the Experimental overlay for 5 minutes; the refresh
button in the Manager header forces a refetch.
