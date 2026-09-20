# modules-unstable

**Where every module change lands first.** Not a Git branch — a folder and a catalogue, both on `main`, read only by people who have switched their own Lectio Manager to the release channel it serves — labelled **Experimental** in the Manager, since that is what it means to the students and teachers choosing it; `unstable` everywhere in the code, the stored setting and this folder. Stable users never see any of it. The rule and its reasoning are [ADR-0014](../docs/adr/0014-unstable-first-releases.md); the short version lives in [AGENTS.md](../AGENTS.md).

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

Only the repo owner decides when something is promoted, and they say so in those words. The six steps — copy up, rewrite the URLs, bump the patch once more, update `catalogue/modules.json`, delete the file, entry and section from here, re-run the checks — are in [ADR-0014](../docs/adr/0014-unstable-first-releases.md#promoting).

The extra patch bump at promotion is not ceremony. A tester's installed copy points at a `modules-unstable/` URL that promotion deletes; shipping stable on the same number would leave them there silently, updating from a 404 forever. One more bump makes the Manager offer them the stable file instead.

## What is here now

### `Lectio-English-Mode.user.js`
Stable `1.9.3` with the translation cache written on a flush instead of on every learned string (issue #26). Measured over a page that learns 200 new strings with 2,000 already cached: 200 storage writes and 47 MB serialised before, 2 writes and 0.48 MB after, with a third write on `pagehide`. Cache contents and eviction policy are unchanged.

### `Lectio-Chairs-Up.user.js`
Stable `1.1.1` with a safety net around its background fetches (issue #36): an eight-second `AbortController` timeout on every request, an abort of anything in flight on `pagehide`, a jittered first request, a backoff that doubles from two seconds to a one-minute ceiling after three consecutive failures and clears on the first success, and one request at a time instead of a `Promise.all()` burst, so a request never starts while another is in flight. The ~30-day room-id cache and its expiry are untouched.

### `Lectio-Unread-Message-Notifications.user.js`
Stable `0.6.1` with a safety net around its Forside poll (issue #37): an eight-second `AbortController` timeout on every background request, an abort of anything in flight on `pagehide`, a random offset of up to 1.5s on the first check of a page view, and a backoff that doubles from one minute to a fifteen-minute ceiling after three consecutive failures and clears on the first success. A tick still never stacks on a running refresh — and now cannot be wedged by a request that never answers. The module's rule that a failure is never "zero unread" covers all three new failure paths: a timeout, an abort and a backed-off skip each leave the badge and the stored count exactly as they were.

### `Lectio-Change-Radar.user.js`
An experimental timetable watcher — a compact themed radar HUD with urgency states, unseen-change tracking, configurable polling and a rotating local change log. Unstable-only so far; it has never had a stable release, so promoting it would be its first.
