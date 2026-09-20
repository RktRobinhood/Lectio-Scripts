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

| File | Page | Exercised by |
| --- | --- | --- |
| `aktivitetsforside.html` | One activity's front page (`aktivitet/aktivitetforside2.aspx`) | `tests/real-pages.browser.test.js` |

Still wanted, in rough order of how much they would earn (see issue #23):

- `SkemaNy.aspx` for a full week, including a cancelled activity (`s2cancelled`
  / `Aflyst!`), a lesson belonging to more than one hold, and an activity with
  no hold at all. This is the page Subject Colours, Chairs Up and Change Radar
  all lean on hardest, and nothing here covers it yet.
- `OpgaveListe.aspx`, `subnav/fravaerelev.aspx` (or `fravaerlaerer.aspx`) and
  `DokumentOversigt.aspx` — Change Radar parses all three by pattern, against
  markup nobody in this repo has ever seen.
- The Forside with a non-zero unread count, for Unread Message Notifications,
  whose selectors have only ever been confirmed against one school's rendering.

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
  which.
