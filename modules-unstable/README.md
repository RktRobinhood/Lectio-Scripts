# modules-unstable

**Where every module change lands first.** Not a Git branch — a folder and a catalogue, both on `main`, read only by people who have switched their own Lectio Manager to the **Unstable** release channel. Stable users never see any of it. The rule and its reasoning are [ADR-0014](../docs/adr/0014-unstable-first-releases.md); the short version lives in [AGENTS.md](../AGENTS.md).

`modules-unstable/modules.json` is an overlay, not a replacement: an entry here with the same `id` as one in `catalogue/modules.json` replaces it for Unstable users, and an `id` that appears only here is an Unstable-only module. The Manager caches this overlay for five minutes against twenty-four hours for the stable catalogue, so a change here is visible almost immediately.

## Working here

A module being worked on exists twice — the frozen copy stable users have in `modules/`, and the live one here, at least one version ahead. While it is under test the copy in `modules/` is not edited for any reason.

Starting work on a module that is not here yet:

1. Copy it in from `modules/`.
2. Bump its version — `@version` and the version it registers, together. No `-beta` suffixes: plain `MAJOR.MINOR.PATCH`, as [ADR-0003](../docs/adr/0003-static-catalogue-independent-versioning.md) requires of every script in this repository.
3. Point `@updateURL` and `@downloadURL` at this folder's raw path. Tampermonkey follows those, not the catalogue, once a script is installed.
4. Add its entry to `modules-unstable/modules.json` with the same `id` as the stable entry, `status: "unstable"`, and an `installUrl` under `modules-unstable/`.

`node scripts/check-versions.mjs` enforces all of it: each file is checked against the catalogue for the folder it lives in, a copy here must be strictly ahead of what stable ships, the two URLs must point at the folder the file is actually in, and an entry whose file has gone is reported rather than ignored.

## Promotion

Only the repo owner decides when something is promoted, and they say so in those words. The six steps — copy up, rewrite the URLs, bump the patch once more, update `catalogue/modules.json`, delete the file and entry from here, re-run the checks — are in [ADR-0014](../docs/adr/0014-unstable-first-releases.md#promoting).

The extra patch bump at promotion is not ceremony. A tester's installed copy points at a `modules-unstable/` URL that promotion deletes; shipping stable on the same number would leave them there silently, updating from a 404 forever. One more bump makes the Manager offer them the stable file instead.

## What is here now

### `Lectio-Unstable-Channel-Test.user.js`
A harmless diagnostic module: it runs on Lectio pages, registers itself with the Manager, puts a warning-state icon in the shared dock, and renders into a Manager-owned flyout when clicked. It modifies no Lectio records, messages, grades, attendance or account data. It exists to prove that an Unstable-only module appears only on the Unstable channel and that the dock registration and panel contract work without module-owned fixed positioning. **It is never promoted.**

### `Lectio-Unread-Message-Notifications.user.js`
The school-agnostic build. Stable still ships `@match https://www.lectio.dk/lectio/223/*` with the school id written into the script as a string; this copy matches `/lectio/*` and reads the id off `location.pathname` the way Chairs Up and Subject Colours already do, which is the debt [ADR-0007](../docs/adr/0007-school-agnostic-by-default.md) recorded rather than a change of scope. Its cached count is scoped per school too, so two installations open in one browser cannot overwrite each other's badge.

What needs testing is not the URL handling but the scraping underneath it: the unread count is read out of Forside's own text (`N ulæste` / `N unread`) and the previews out of the inbox's row markup, and neither has ever been confirmed against a school other than 223. A parse failure deliberately keeps the last known-good count rather than showing zero, so the failure mode to watch for is a badge that quietly stops moving, not one that reads wrong. Confirmation from a second school is what this needs before it is worth promoting.

### `Lectio-Change-Radar.user.js`
An experimental timetable watcher — a compact themed radar HUD with urgency states, unseen-change tracking, configurable polling and a rotating local change log. Unstable-only so far; it has never had a stable release, so promoting it would be its first.
