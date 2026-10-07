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

### Change Radar 0.9.17 (Stable has 0.9.16)

- **Remove one entry** (#85). Each change in the log has a small × in its top-right corner that removes that entry alone; Clear still empties the whole log.
- **Ignore changes I make** (#84), a teacher-only toggle under *What to watch*, on by default. Lectio does not say who changed a lesson, so the radar remembers when you were the one editing it: typing or saving on an activity's own page (`aktivitetforside2.aspx`) or its edit page (`aktivitetrediger.aspx`), or arriving back from one. A timetable change to that lesson found by the check that takes in your edit is not logged. Later changes, and changes to other lessons, still are. Known gap: editing a whole series ("alle i serien") only marks the lesson you edited from.
- **A week that cannot be read fails the check** (#86, follow-up to the Stable fix). If a fetched week has blocks that should be lessons and none can be read, the check fails and the last good snapshot stays, instead of every lesson in that week being logged as removed.

To try it: as a teacher, change a lesson's room and press Refresh; nothing should appear. A colleague's change to one of your lessons still should.

### Unit Copier 0.1.0 (new, Experimental only)

The first part of issue #74: **the planner. It only reads.** On a unit's page (`studieplan/forloeb_vis.aspx`), a **Copy into a class** button appears next to Lectio's *Kopiér forløb*, and only on units the person can edit. It opens a side-by-side plan:

- **Left:** the unit's lessons and their items, read off the page itself (`ACC` lessons; `ACH` items under *Lektier* or *Øvrigt indhold*; the `ACP` presentation). A lesson cancelled last year with nothing on it takes no place in the sequence.
- **Right:** the chosen class's lessons from the chosen date, read week by week from the person's own `SkemaNy.aspx`. It stops once it has enough lessons, or after 30 weeks.
  - The class menu's first guess is the same course in the same year-group as last year's class. The classes the unit already belongs to are listed last.
  - Cancelled lessons are ignored. A lesson whose tooltip already has a *Lektier:* or *Øvrigt indhold:* line is left alone.
- **Default plan:** last year's lessons in order onto the class's next free lessons. Holiday weeks fall out naturally.
- **Adjusting:**
  - *Leave empty* on a lesson moves everything after it along by one.
  - *Leave out* drops one of last year's lessons.
  - Dragging one of last year's lessons onto a lesson starts the sequence there.
  - The up and down arrows reorder last year's lessons.
- The draft is kept in `sessionStorage` for the tab. Nothing goes into `localStorage`.
- **Copy plan as text** puts the plan on the clipboard.

It sends only GETs of the person's own timetable. Copying the plan into Lectio comes later, under the ADR-0009 amendment of 2026-10-07 and its safety bar, once the write path has been checked on a throwaway lesson (issue #74, assessment section 5).

`tests/unit-copier.browser.test.js` covers it: the default class, the in-order pairing across a holiday, leave empty, leave out, drag, both languages, only timetable GETs, and no button on a unit you cannot edit. The parser was also run once against a real saved unit page, outside the repo: it read 21 lessons and 18 items (16 homework, 1 other content, 1 presentation), matching the page's 17 `ACH` items plus 1 `ACP`.

To try it: open last year's version of a unit you teach again this year, press **Copy into a class**, check the class it guessed, press **Find lessons**, and adjust.

## When nothing is under test

`modules.json` must never be emptied. Every shipped Manager rejects an overlay with no modules in it, keeps the overlay it cached last, and reports the failure on every refresh; a Manager older than 1.22.1 also lets that cached overlay win outright, so it would keep offering installs from the `modules-unstable/` URLs a promotion deletes. So when the last module here is promoted, the overlay keeps one entry that is an exact copy of its entry in `catalogue/modules.json`, `installUrl` included. A current Manager resolves equal versions to Stable, and an old one installs the Stable file whichever entry it picks. `node scripts/check-versions.mjs` accepts an overlay entry with no file here only when it is that exact copy, and fails an overlay with no entries at all.
