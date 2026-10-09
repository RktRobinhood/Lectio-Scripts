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

### Unit Copier 0.2.0 (new, Experimental only)

Issue #74, rebuilt after the owner's first test of 0.1.0. That version put a planner on the old unit's page, where he never goes, and failed on his real timetable. **It still only reads**: every request is a GET of a page the person can already open.

**The flow follows Lectio's own two steps:**

1. **Lectio's Kopiér form** (`studieplan/forloeb_kopier.aspx`). A "What Kopiér does" box sits under the fields.
   - **Three steps, explained:** the new unit's lessons are the class's lessons inside the *Periode*, and they start empty; the material goes to *Forløbsmaterialet*; then use the banner on the new unit.
   - **The class check.** It reads the class Lectio actually stored (hidden `…EntityChooserCtrl$inpid`, looked up on `contextcard.aspx`) and warns if that differs from the box. The type-ahead was seen storing a different class twice.
   - **A suggested Periode.** It reads the person's own timetable for that class. Lessons the published timetable shows count exactly, holidays included. Only the remainder past the last published lesson is estimated, from the class's typical lessons per week. "Use these dates" fills the two fields; the person still presses Kopiér.
2. **The copied unit** (`studieplan/forloeb_vis.aspx`). Lectio's material picker lists the original under *Relaterede forløb* (the tree's first node, `PH<phase id>`), so the source is found with one GET and nothing stored. A banner reads "Copied from … (N lessons). Lessons with material: X of Y. [Place last year's lessons]".
   - **No backwards banner.** It does not appear if the related unit is newer than this one, since Lectio may relate the units both ways.
   - **The planner.** It is a native modal `<dialog>`, in the browser's top layer, so nothing floating on the page covers it. It shows one timeline by week, "Your lesson | Gets last year's lesson".
   - **Row actions:** *Skip this day*, *Leave out*, *Use anyway* (on a lesson that already has material) and *Undo*. A drag grip starts a lesson somewhere else.
   - **The rest:** a "Waiting for lessons (n)" section says why (the unit only has the lessons in its Periode that are timetabled) and what to do. "Copy plan as text" sits in the footer.
   - **The plan is kept** in `localStorage` (`lectioUnitCopier.plans.v1`, declared to the Manager, pruned after 400 days), so a teacher can come back when more of the timetable is published.

**Tested live, read-only, on the owner's account (2026-10-07):**
- The banner found *Unit 1* (21 lessons) from his copied test unit.
- On the Kopiér form for *Sequences and Series* (18 lessons) for 1i Math AA SL/2, it confirmed the class and read "next 8 lessons, up to Mon 2 Nov; about 3 a week; the other 10 take about 4 more weeks; to about Mon 30 Nov". The timetable is published only to week 45.
- `tests/unit-copier.browser.test.js` covers: the copied unit; a unit the person cannot edit; a related unit newer than this one; the Kopiér form with a class mismatch and an exact Periode; and an estimated Periode.

**To try it:** in Lectio's unit list, choose your class at the top, press **Kopiér** on last year's unit, and follow the box. After Kopiér, open the new unit and press **Place last year's lessons**.

### English Mode 1.11.11 (Stable has 1.11.10)

- **No switch inside dialogs** (#90). *Vælg materiale* is another Lectio page in a frame, and English Mode built a second DA / EN switch there. Inside a frame it now translates and stays silent: no switch, no toast, no styles for them, and no Registration. Translation in the dialog follows the mode chosen on the top page. `tests/module-frames.browser.test.js` covers it.

To try it: in English, open a lesson and press the green **+** to open *Vælg materiale*. The dialog should be in English, with no switch over its top right.

## When nothing is under test

`modules.json` must never be emptied. Every shipped Manager rejects an overlay with no modules in it, keeps the overlay it cached last, and reports the failure on every refresh; a Manager older than 1.22.1 also lets that cached overlay win outright, so it would keep offering installs from the `modules-unstable/` URLs a promotion deletes. So when the last module here is promoted, the overlay keeps one entry that is an exact copy of its entry in `catalogue/modules.json`, `installUrl` included. A current Manager resolves equal versions to Stable, and an old one installs the Stable file whichever entry it picks. `node scripts/check-versions.mjs` accepts an overlay entry with no file here only when it is that exact copy, and fails an overlay with no entries at all.
