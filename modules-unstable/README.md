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

**Change Radar 0.9.8** (Stable ships 0.9.7). Issue #76, as a teacher-only part of Change Radar rather than a new module:

- A teacher to-do. On the Forside, a small card counts lessons still waiting for absence registration (with the oldest), submissions waiting in the *Afventer lærer* column of the teacher's own assignments, and assignments due in the rest of this ISO week; each line links to the Lectio page with the detail. A lesson block on any timetable whose absence is unregistered gets a small corner mark linking to its registration page. It is read-only (ADR-0009), rides the existing checks (request slots, backoff, at most every 30 minutes), and a table it cannot read shows no line at all rather than a 0.
- The settings are regrouped - What to watch, Teacher to-do, Notifications, Appearance, then four folded *details* groups - and each role-specific control carries an `audience`. The module itself ignores a watch meant for the other role, whatever is stored for it: the absence watch and its trackers and the assignment status tracker are students', the to-do is teachers'.

`tests/change-radar-teacher-todo.browser.test.js` runs it over the real saved pages; like English Mode's tests it loads the Unstable copy while it exists.

**Change Radar 0.9.9** adds one fix on top: it runs on the top page only (`@noframes` plus the Manager's `window.frameElement` guard). Lectio's *Vælg materiale* dialog is another Lectio page in an iframe, and inside it the radar found no Manager and drew a second, floating radar over the dialog (issue #80).

**Chairs Up 1.4.8** (Stable ships 1.4.7):

- The `lesson-bricks` drift report no longer fires on a week of all-day entries only. Lectio renders an all-day entry as `a.s2skemabrik.s2normal` with no `s2brik`; the saved real week has seven of them. A report now needs an anchor Chairs Up should have read: one with a timed tooltip, or with no tooltip at all (issue #79).
- Top page only, like Change Radar above (issues #80, #81).

`tests/module-frames.browser.test.js` and `tests/chairs-up-drift.browser.test.js` cover both; they load the Unstable copies while they exist and the Stable ones after promotion.

**Chairs Up 1.4.9** adds a yellow **courtesy chairs up** marker (issue #83). It marks a lesson when exactly one class has the room for the rest of the day after it, and our class is more than *ratio* × that class's size. Gaps before that class don't matter, and a double lesson of the same class still counts as one class.

- The ratio is a new setting, **Courtesy chairs up**: Off, 1.25, 1.5 (default) or 2 chairs per student. Red still wins: a lesson that is last in any of its rooms is never yellow.
- Class size is the enrolled count from the hold's members page (`subnav/members.aspx?holdelementid=…&showstudents=1&showteachers=1`, "Antal elever: N"). Only the number is cached, per hold, for 14 days. A page without a count is cached as unknown for a day. Students get the feature too; if their account cannot open another class's members page, the size is unknown and nothing shows.
- Anything unknown shows nothing: a later booking with no hold, a hold with 0 students, or a size that could not be read. Sizes are only fetched for lessons that have exactly one class after them, at most 12 per page view, through the same request slots and backoff as the room weeks.
- Room-week caches now record each booking's hold ids (`format: 2`). A cache from before this version still paints red, and is refetched as if it were missing.

`tests/chairs-up-courtesy.browser.test.js` covers seven rooms on the timetable and the activity-page notice. It loads the Unstable copy while it exists and the Stable one after promotion.

**Chairs Up 1.4.10** follows the owner's first test of 1.4.9:

- The wording now says you are the second-to-last class: "You're the second-to-last class in 213. The last class has 12 students; you have 30." The tooltip and the notice use the same sentence.
- The lesson-page notice is capped at 300px wide. Its message wraps onto a second line instead of stretching towards the window edge. The heading stays on one line, and the red notice's short message is unaffected.

**Chairs Up 1.4.11** follows the owner's second test:

- The words Chairs Up puts on the page now follow ADR-0013's language order, like its settings panel already did: the Manager's `data-lectio-language`, then `<html lang>`, then Danish. That covers the notice and both tooltips, red and yellow. A `lectio-manager:language` event repaints them in place. Danish: **STOLE OP** / **STOLE OP AF HENSYN**, "I er næstsidste hold i 213. Det sidste hold har 12 elever; I har 30." The strings are an `i18n:en` / `i18n:da` pair in `pageText()`, so `check-i18n.mjs` holds the keys in step.
- A lesson on a day that has passed gets no marker, red or yellow, and its lesson page gets no notice. Today counts all day.
- `tests/chairs-up-notice.browser.test.js` and the Chairs Up case in `tests/real-pages.browser.test.js` had deliberately marked past lessons (a lesson on Monday of the current week, and a clock stopped on the Saturday after the saved week). Their lesson is now today, and their clock stands before the saved week's first lesson. Both now load the Unstable copy while it exists, so they test what promotion will ship.

`modules.json` must never be emptied. Every shipped Manager rejects an overlay with no modules in it, keeps the overlay it cached last, and reports the failure on every refresh; a Manager older than 1.22.1 also lets that cached overlay win outright, so it would keep offering installs from the `modules-unstable/` URLs a promotion deletes. So when the last module here is promoted, the overlay keeps one entry that is an exact copy of its entry in `catalogue/modules.json`, `installUrl` included. A current Manager resolves equal versions to Stable, and an old one installs the Stable file whichever entry it picks. `node scripts/check-versions.mjs` accepts an overlay entry with no file here only when it is that exact copy, and fails an overlay with no entries at all.
