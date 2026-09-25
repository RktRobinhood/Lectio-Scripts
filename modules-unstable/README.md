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

**English Mode 1.11.9** (Stable ships 1.11.8). Two fixes found while investigating issue #72:

- Nothing inside a rich-text editor is translated any more. In English mode, 1.11.8 rewrote the `alt`/`title` of images and links in the homework editor, and a line of the teacher's own text split by `<br>` that matched a dictionary phrase, into English that Lectio then saved. `tests/english-mode-editor.browser.test.js`.
- Switching language reloads with a GET to the same address instead of `location.reload()`, which re-sent the postback a page was the answer to - adding a homework file or link a second time. A Manager set-setting that names the language already in use no longer reloads at all. `tests/english-mode-resubmit.browser.test.js`.

Both tests load the Unstable copy while it exists and the Stable one after promotion, so neither needs editing then.

`modules.json` must never be emptied. Every shipped Manager rejects an overlay with no modules in it, keeps the overlay it cached last, and reports the failure on every refresh; a Manager older than 1.22.1 also lets that cached overlay win outright, so it would keep offering installs from the `modules-unstable/` URLs a promotion deletes. So when the last module here is promoted, the overlay keeps one entry that is an exact copy of its entry in `catalogue/modules.json`, `installUrl` included. A current Manager resolves equal versions to Stable, and an old one installs the Stable file whichever entry it picks. `node scripts/check-versions.mjs` accepts an overlay entry with no file here only when it is that exact copy, and fails an overlay with no entries at all.
