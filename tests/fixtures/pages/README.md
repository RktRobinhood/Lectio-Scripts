# Real Lectio pages, redacted

Every other fixture in `tests/fixtures/` is markup we wrote ourselves. That
makes them useful for driving a module through a scenario, and useless for the
one question that actually matters: is the parser right about the page Lectio
serves? A parser can pass a hand-written test and be wrong about production.

The pages in this folder are real. They were saved from a logged-in Lectio
session, scrubbed, and committed so the modules' own parsing can be run over
them. They are a regression net, not an archive — keep the set small, and add a
page only when a module reads something no page here shows.

These pages contain no real names, ids, message content, grades or session
data. Keeping it that way is the whole of the procedure below. This repository
is public and its history is permanent, so a leak here cannot be taken back by
deleting a file.

## What is in the corpus

Every page is exercised by `tests/real-pages.browser.test.js`; the last column
says what each one is exercised *for*.

| File | Page | Exercised by |
| --- | --- | --- |
| `aktivitetsforside.html` | One activity's front page (`aktivitet/aktivitetforside2.aspx`): one lesson block plus one `.s2skemabrik` that is decoration | Subject Colours (decoration left alone); the tooltip shape every module reads; the twice-rendered card count |
| `skemany.html` | A teacher's own full week (`SkemaNy.aspx`, 21–25 September 2026): 29 lesson blocks, 22 timed and 7 all-day, one cancelled, 7 rooms, 7 holds, one two-hold lesson, one title-keyed activity with no hold | Subject Colours (cancelled block unpainted, a recurring hold promoted, the no-hold cases by name); Chairs Up (15 roomed lessons read, the cancelled and unroomed ones not, a later booking respected); Change Radar's schedule parser (22 events); the raw camelCase `data-lectioContextCard` form |
| `opgaveliste.html` | The assignment list (`OpgaveListe.aspx`): 25 assignments linked with `exeid=` | Change Radar `parseAssignments` — pinned at the 0 it currently returns, see #59 |
| `dokumentoversigt.html` | The document tree (`DokumentOversigt.aspx`): 2 documents | Change Radar `parseDocuments` (2 of 2) |
| `fravaersangivelse.html` | Absence registration (`subnav/fravaerlaerer.aspx`): 6 registrations linked with `ActivityAbsenceRegistration.aspx?id=`, no percentages; the page that renders every lesson block twice | Change Radar `parseAbsence` — pinned at the 0 it currently returns, see #59; Subject Colours keying one hold, not two, off a doubled block |
| `forside.html` | The Forside (`forside.aspx`) with 4 unread messages: three links labelled `Beskeder`, one `4 ulæste` span, four message rows, today's 14 lesson blocks | Unread Message Notifications reading 4 off the live page without fetching it |

The three list pages are what Change Radar had been parsing by pattern,
against markup nobody in this repo had ever seen. Two of its three parsers
turned out to see nothing at all on them; that is issue #59, and the tests pin
the wrong answers until it is fixed.

Still wanted:

- A student-role view of anything. Every page here is a teacher's. In
  particular `subnav/fravaerelev.aspx`, the student absence page Change Radar
  also watches, and the student `OpgaveListe.aspx`, whose links may not be
  `exeid=` either.
- A Forside from a second school. The one here is school 223's, so Unread's
  selectors are now confirmed against a real rendering, but still only one.

## Two ways to save, and only one of them the patterns knew

`SkemaNy.aspx?week=NNYYYY` works; adding `&nosubnav=1` returns a Lectio error
page, whatever AGENTS.md says.

More importantly: **how you save changes the markup you get.** Chrome's
"Webpage, Complete" serialises the live DOM, which lowercases attribute names
and rewrites every quote to `"`. A page saved any other way keeps what Lectio
actually sent — `data-lectioContextCard='HE123'`, camelCased and single-quoted,
and `class='...'` single-quoted on four fifths of the page.

The first page here was serialised; the next four were not, and every pattern
in `redact-lectio-page.mjs` had been written against the first. The Forside
was captured a third way — the server's own response for `forside.aspx`,
fetched from the logged-in tab and saved as text — which is the same
un-serialised form as the middle four, with no `_files/` folder at all. The scan found
**0 of 117 context cards** and reported success. That is fixed, and the
patterns now accept either form — but it is the reason to distrust a clean
`--check` on the first page you save a new way.

## What a clean --check did not catch

All of these got through a run that printed `5 page(s) clean`, and all are
fixed now. They are recorded because each one was invisible to the single
pattern that was looking, and the next gap will be too:

- **Initials are not always upper case.** `Matthew Travers (Tr)` did not match
  `[A-ZÆØÅ]{2,4}`, so a teacher's full name survived — and `--check` hunts for
  survivors with the same pattern, so it confirmed the page clean.
- **`\w` is ASCII.** `Hana Cárska`, `Tadeás Jan Novák`, `Gadus-Baraknoyi
  András`. This is an IB school; a class roll is full of them.
- **Students are not written like staff.** They are `Navn (1i 03)` — class and
  roll, not initials — and `OpgaveListe.aspx` puts an entire class in one
  `title=` attribute. 145 of them, with nothing looking for that shape.

The name net was widened three times against one page before the lesson took:
it is no longer the only net. A `(1i 03)` token is unambiguous, so whatever
text precedes one is now redacted whatever it looks like. Over-redacting a
roster is harmless; the alternative is not.

**Verify independently.** Every one of these leaks passed the gate because the
gate reuses the scan's patterns. After `--check`, look for the real values
yourself with something that shares no code with the script.

## Capturing a page

1. **Turn Tampermonkey off, and every other extension with it.** This is not
   tidiness. The first page captured for this corpus was saved with the scripts
   running, and it contained: the Manager's whole panel, Lectio Theming's
   palette written as `--lectio-theme-*` custom properties on `<html>`, a
   Chairs Up marker attribute, and — worst — the Unread badge's cached tooltip,
   carrying a real student's name and message subject in a `data-signature`
   attribute. A fixture with our own output in it also makes the tests
   circular: the parser reads back markup the module wrote.
   `redact-lectio-page.mjs` strips all of this and `--check` fails if any of it
   survives, but not capturing it is better than removing it.
2. Log in normally and navigate to the page you want.
3. Save it with **Ctrl+S → "Webpage, Complete"**. The sibling `_files/` folder
   is not committed and not needed; the redaction drops every reference to it.
4. Put the saved `.htm` somewhere outside the repository. `copies of Lectio
   Pages/` next to the checkout is where the existing ones live.

## Redacting it

`scripts/redact-lectio-page.mjs` does this in three steps, and the middle one
is a person reading a file. Run them from the repository root.

```bash
node scripts/redact-lectio-page.mjs --scan "../copies of Lectio Pages/<saved>.htm"
```

This writes `redaction-map.json` — every identifying thing it found, with a
suggested placeholder. **The map holds the real values, so it is git-ignored and
must stay that way.** It is shared across the whole corpus: scan every new page
into the same map, so a hold that appears on two pages gets the same placeholder
on both, and the cross-page assertions keep meaning something.

Now read it, and:

- fix any placeholder that reads wrong. The scan cannot tell that two holds are
  the same subject at two levels; it suggested `1a Fag1 HL` and `1a Fag2 HL`
  for what was really an HL/SL pair, and that distinction is one Subject
  Colours cares about.
- set `"skip": true` on anything that is page furniture rather than personal
  data. The name-shaped-text rule is deliberately broad and catches Danish UI
  labels like `Ny Besked`; add those to `allowedText` too, so `--check` stops
  asking about them.
- add anything the scan missed.

```bash
node scripts/redact-lectio-page.mjs --apply "../copies of Lectio Pages/<saved>.htm" \
    --out tests/fixtures/pages/<name>.html
node scripts/redact-lectio-page.mjs --check tests/fixtures/pages/*.html
```

`--check` exits non-zero and is the gate. **Run it before committing, and read
what it says rather than just its exit code.**

## What gets scrubbed, and what deliberately does not

Removed outright: `<script>`, `<noscript>`, HTML comments, `<link>`, inline
`<style>`, every reference to the saved page's `_files/` folder, and anything
this project's own modules put on the page.

Emptied: every ASP.NET hidden field (`__VIEWSTATE` and friends — one of them
carried a `LECWEB2-...` session token) and any hidden input whose value is long
enough to be a token.

Renumbered, consistently across the corpus:

- context cards, `HE`/`T`/`S`/`RO` + digits, into a `90xxxxx` run that no real
  Lectio id has, so `--check` can state flatly that every card left in a page is
  one we put there;
- personal ids in query strings (`elevid`, `laererid`, …), including their
  percent-encoded forms — Lectio nests return urls inside query strings, and a
  real teacher id once survived a run that reported itself clean because
  `laererid%3d…` did not match the pattern looking for `laererid=…`;
- every other run of seven or more digits: activity ids, document ids, the ids
  behind a context menu. Dull one at a time, collectively a map back to one
  school's real objects.

Replaced from the map: person names and their initials, hold display names, the
school's name, and free text somebody wrote (homework, notes, message
subjects).

**Deliberately left alone**, because these are the things under test: the school
id in `/lectio/223/` paths, Lectio's class names, element ids, table structure,
and the exact format of the tooltip lines.

## Writing a test against a page

`tests/real-pages.browser.test.js` has the harness. A corpus page is served
untouched at a Lectio-shaped URL, and the test injects what it needs — settings
into `localStorage`, a `fetch` stub, the module itself, and its assertions — as
the page is served. Nothing test-shaped is ever committed into a page that is
supposed to be what Lectio sent.

Two things a hand-written fixture will not teach you, both found the first time
a real page went through this:

- `.s2skemabrik` is on decoration as well as lessons. The activity page's
  table-of-contents bullet carries the class to borrow the icon, with no
  tooltip. Match on `[data-tooltip]`.
- **a lesson block renders its contents twice**, once in an `.OnlyDesktop` span
  and once in an `.OnlyMobile` one, so every context card inside it appears
  twice. A module that counts cards rather than distinct ids reads a two-hold
  lesson as four. Subject Colours already de-duplicates; the test asserts both
  the node count and the distinct count, so the day either changes, it says
  which. Not every page does this: the activity page and the absence page
  double, `SkemaNy.aspx` does not, and both facts are pinned.

Three more, from the pages that came after:

- **"No hold card" is not "no hold".** Fifteen blocks on the saved week carry
  no `HE` context card, and Subject Colours reads only one of them as
  hold-less. The rest have a `Hold:` line in the tooltip naming a group
  (`Alle Lærere`, every year group at once for the assembly), and the module
  keys on those names. The genuinely hold-less activity — no card, no `Hold:`
  line, an `Elev:` line instead — is a ten-minute student meeting, and it is
  pinned by its `data-brikid`. If you need the no-hold case, that is the block.
- **Lectio writes the unread count with no space before it.** On the Forside,
  `Beskeder` and `4 ulæste` are adjacent spans, so the text of any ancestor
  reads `Beskeder4 ulæste`. Unread's first pass, which walks up from a
  `Beskeder` heading looking for `\s(\d+)\s+ulæste`, cannot match that; the
  count comes from its second pass over short standalone elements. The module
  is right on this page, but by its fallback, and the test says so.
- **The harness's own scripts are in the DOM.** A postlude that searches
  `document.body.textContent` finds its own source, including whatever word it
  was asserting is absent. Search a clone with the `<script>` elements removed.

To show that a test bites without touching a shared file, take a throwaway
copy of the test, hook the branch that serves `/modules-unstable/...` and hand
back `source.replace(...)` from memory. Done for three of these: Subject
Colours without the `new Set` in `holdIdsOf` keys every doubled block as
`h:HE…+HE…`, Unread with the Danish count pattern misspelled leaves the badge
hidden, and Chairs Up looking for a room line Lectio does not write logs no
room candidates at all.
