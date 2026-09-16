# English Mode translation audit (issue #9)

Real computer-use session against the live Ikast-Brande Gymnasium Lectio instance
(`https://www.lectio.dk/lectio/223/`), logged in as **Teacher MP – Matthew Pilley**,
with English Mode active (its own `DA/EN` toggle in the top-right, which is how the
module itself was confirmed to be installed and running). No consequential action
(absence recording, message sending, grade entry, etc.) was submitted at any point.

## Screens checked (teacher role)

| Screen | Path |
|---|---|
| Overview / Home | `forside.aspx` |
| Schedule (week view) | `SkemaNy.aspx` |
| Activity/lesson detail popup | `aktivitet/aktivitetforside2.aspx` |
| Attendance entry | `subnav/fravaerlaerer.aspx` |
| Assignments list | `OpgaveListe.aspx` |
| Grades / grading overview | `Grades/teacher_listgrades.aspx` |
| Documents | `DokumentOversigt.aspx` |
| Messages (inbox) | `beskeder2.aspx` |
| Profile / settings | `indstillinger/laerer_indstillinger.aspx` |
| Native "page not found" error state | (invalid grades URL, `karakterer/laerer_gruppeoversigt.aspx`) |

## Coverage gaps (not checked — flagging per acceptance criteria rather than omitting silently)

- **Student role**: no student test account was available in this session, so nothing here covers student-facing screens (their Schedule, Grades, Absence, Study Plan views can differ in wording from the teacher equivalents).
- Not sampled this pass: Study Plan, Surveys (beyond the sidebar label), Course Plan, Annual Summary, Time Tracking, and most dialogs/modals (e.g. the "Create Lesson/Other Activity/Private Appointment" forms), hover tooltips, and the Manager/module settings UI itself.
- Findings below were caught by re-checking pages multiple times with waits (1s–4s) because the translator runs asynchronously and some strings only resolve, or only break, on a later pass — see "Reproducibility" note per finding.

## Findings

### 1. Class-code corruption: "1i" → "1 in" (functional bug, not just wording)

On the Schedule and Attendance pages, the class code **`1i`** (e.g. `1i TOK/1`, `1i TOK/2`, `1i TOK/4`, `1i aktivitet/4`) is sometimes rewritten to **`1 in`** (`1 in TOK/1`, `1 in activity/4`), splitting the identifier and inserting a wrong word. It reproduced on both live re-render and a full hard reload of `SkemaNy.aspx`.

Crucially it's inconsistent: `1i Math AA SL/2` and `1i Psyc HL`/`1i Psyc SL` are never affected, only `1i` immediately followed by `TOK` or `aktivitet`. Likely cause: those two combinations aren't in the dictionary as a protected multi-word class-name unit, so they fall through to a generic word-level pass that matches the lone Danish preposition "i" ("in") inside `1i` and replaces it — corrupting a student-facing class identifier rather than a sentence. When it does trigger, the accompanying "aktivitet" → "activity" translation also renders in the wrong case ("activity" lowercase) versus the correctly-cased "Activity" seen elsewhere on the same page (`2i Activity/3`).

- Screens: `SkemaNy.aspx`, `subnav/fravaerlaerer.aspx`, `indstillinger/laerer_indstillinger.aspx` (own Profile favourites list)
- Screenshot: `screenshot-1789572768219-3.jpg` (Schedule, top-left and other "1i TOK" cells)
- Proposed fix: treat class/group codes (`^\d[a-zA-Zæøå]+(/\d+)?$`-shaped tokens) as opaque and never pass them through the generic word translator, regardless of whether the exact "1i X" phrase has a dictionary entry.

### 2. "Standpunktskarakter" mistranslated as "Point of view" (contextually wrong, not just missing)

On the Grades page (`Grades/teacher_listgrades.aspx`), the row label rendered as **"Point of view final - in writing"**. The dictionary (`modules/Lectio-English-Mode.user.js:438`) already maps the exact string `Standpunktskarakter` → `Current Grade`, but the actual DOM text is `Standpunktskarakter afsl.` (with a suffix), which doesn't match the dictionary key exactly. It falls through to the Google Translate fallback, which renders the Danish grading term "Standpunktskarakter" (an interim/standing grade) as if it were the unrelated English idiom "point of view" — actively misleading for a teacher scanning grade-entry deadlines.

- Same row also shows the "skriftlig" (written) suffix rendered three different ways across the table: `- written`, `- in writing`, and `not final. - in writing` — inconsistent phrasing for what should be the same recurring suffix.
- Screenshot: `screenshot-1789572768194-2.jpg`
- Proposed fix: match dictionary keys as prefixes/substrings (or add explicit suffixed variants like `Standpunktskarakter afsl.` / `ikke afsl.`) instead of requiring an exact full-string match; standardize the "written" suffix to one phrasing.

### 3. Documents screen: toolbar and table headers not translated, and "Ny mappe" → "The map" (false-friend MT error)

`DokumentOversigt.aspx` toolbar and file-list header are the least-translated screen sampled:

| Danish source | Seen in English Mode | Proposed |
|---|---|---|
| Ny fil | *(untranslated)*, or once "The file" | New File |
| Ny mappe | *(untranslated)*, or once **"The map"** | New Folder |
| Rediger mappe | *(untranslated)* | Edit Folder |
| Filnavn (column header) | *(untranslated)* | Filename |
| Kommentar (column header) | *(untranslated)* | Comment |
| Ændret af (column header) | *(untranslated)* | Modified By |
| Størrelse (column header) | *(untranslated)* | Size |
| Vis/Red. (column header) | *(untranslated)* | View/Edit |
| Flyt | *(untranslated)* | Move |

None of `Filnavn`/`Kommentar`/`Ny fil`/`Ny mappe`/`Flyt`/`Antal`/`Holdelement` exist anywhere in the dictionary (confirmed by grep) — this is a genuine coverage gap, not a timing issue: it persisted through waits up to 4s and a full page reload. On one load, the MT fallback did kick in for "Ny fil"/"Ny mappe" and produced **"The map"** for "mappe" — a textbook Danish false-friend (mappe = folder, not map) that a one-line dictionary entry would eliminate outright.

- Screenshots: `screenshot-1789572768191-1.jpg` (untranslated state), `screenshot-1789572768194-2.jpg`(N/A – see Grades); the "The map" mistranslation was observed live but not separately saved — reproduce by hard-reloading Documents a few times.
- Also on this screen: the checkbox label "Søg kun i aktuel mappe" is untranslated on first paint but does resolve to "Search current folder only" after ~1–2s — a timing issue, not missing coverage; harmless but worth confirming the debounce/observer isn't too slow on slower connections.

### 4. Assignment list: table headers not applied despite existing correct dictionary entries

On `OpgaveListe.aspx`, column headers **"Elevtid"** and **"Afventer lærer"** stayed in Danish, and **"Ikke afleveret"** rendered as **"Not delivered"** — even though the dictionary already defines all three correctly (`Elevtid` → `Student Workload`, `Afventer lærer` → `Awaiting Teacher`, `Ikke afleveret` → `Not Submitted`, at `modules/Lectio-English-Mode.user.js:360,408,411`). This means the table-header cells in this specific table aren't being reached by the translator's DOM walk at all, so they fall through to the MT fallback (hence "Not delivered", the machine's literal guess at "afleveret" = "delivered", rather than the dictionary's better "Not Submitted") or aren't touched (Danish headers). `Antal` and `Holdelement` have no dictionary entry at all (also seen as headers on this page and on Grades).

- Proposed fix: check whether these table headers render inside a structure (e.g. nested `<span>`/attribute-driven cell, or a table built after the module's main observer attaches) that the translator's selector doesn't cover; this looks like a selector/coverage bug distinct from a missing-dictionary-entry bug, and worth its own investigation since it silently defeats otherwise-correct dictionary entries.

### 5. Mixed-language heading: "Select Hold Favorites"

On Profile (`indstillinger/laerer_indstillinger.aspx`), the heading for the class-favourites picker renders as **"Select Hold Favorites"** — half-translated, leaving the Danish word "Hold" (class/team) sitting inside an otherwise-English sentence. The adjacent, near-identical section below it ("Vælg Stamklasse-favoritter") isn't translated at all. Proposed: "Select Favorite Classes" / "Select Home Class Favorites" respectively.

- Screenshot: `screenshot-1789572768188-0.jpg`

### 6. Profile/settings screen: several complete sentences left in Danish

Same Profile screen, still within `screenshot-1789572768188-0.jpg`:

| Danish source | Proposed English |
|---|---|
| De hold man er holdlærer for vil automatisk være tilknyttet som holdfavoritter, og de vil ikke kunne fjernes. | The classes you are a class teacher for are automatically added as class favourites and cannot be removed. |
| Konto | Account |
| Skoleår: | School year: |
| (Gælder kun indtil næste login) | (Applies only until next login) |
| Du kan nemt få Lectio på mobilen (eller andre enheder) sådan her: | You can easily get Lectio on your phone (or other devices) like this: |
| Scan QR koden med din mobil | Scan the QR code with your phone |
| På mobilen: Opret genvej på startskærm | On your phone: create a shortcut on the home screen |
| Du er færdig | You're done |
| Vis QR kode (button) | Show QR Code |
| For at scanne QR-koden skal kameraet på din mobil være i fototilstand (ikke video), og QR-scanning skal være aktiveret i kameraindstillingerne. | To scan the QR code, your phone's camera must be in photo mode (not video), and QR scanning must be enabled in the camera settings. |

This whole "Get Lectio on your phone" panel and the account/school-year panel appear to have zero dictionary coverage — likely a self-contained widget that was never audited when the dictionary was built.

### 7. Untranslated action on a native error/empty state

Navigating to a non-existent Lectio path produces Lectio's own "page not found" screen. The heading and body text are well translated ("An error occurred" / "You have searched for a page that does not exist in Lectio."), but the recovery button, **"Gå til Hovedmenu"**, is completely untranslated — despite `Hovedmenu` → `Main Menu` already existing in the dictionary at line 210. This suggests the error-page button isn't reached by the translator's DOM walk (possibly because it renders inside a distinct error-page template/selector scope the module doesn't target), even though the exact dictionary key would resolve it correctly if applied.

- Proposed fix: Go to Main Menu.

### 8. Small/singleton items

- **"Rediger"** (Edit) link on the lesson/activity detail popup (`aktivitet/aktivitetforside2.aspx`) stayed as Danish even though `Rediger` → `Edit` exists in the dictionary (line 504) — same selector-coverage pattern as finding 4.
- **"Genvej: Alt+G"** / **"Genvej: Alt+K"** etc. — hidden keyboard-shortcut labels attached to every top-nav item are in Danish ("Genvej" = "Shortcut"); low visual impact (not usually shown) but will read oddly to a screen reader or on hover-tooltip.
- **"Ændret"** column header on Messages (`beskeder2.aspx`) stayed untranslated after resolving everything else on that page; likely needs its own dictionary entry ("Modified" or "Changed").
- **"Info · 5 dage"** schedule toolbar label is Danish on first paint, resolves to "Info · 5 days" after ~1s — timing-only, no fix needed beyond confirming the delay is acceptable.

## Suggested follow-up issue batches

1. **Fix "1i" identifier corruption** (finding 1) — functional bug, arguably higher priority than wording since it garbles real class codes. Should include a regression test/fixture for `1i TOK/…` and `1i aktivitet/…` patterns.
2. **Dictionary additions: Documents & Profile screens** (findings 3, 5, 6) — batch of new key/value pairs, no logic changes. Includes the "Ny mappe" → "map" false-friend fix.
3. **Selector/coverage bug: dictionary entries not applied on some table headers and the error page** (findings 4, 7, 8's "Rediger" case) — needs investigation into why existing correct dictionary entries aren't reaching these specific DOM nodes; distinct from missing-entry work in batch 2.
4. **Contextual mistranslation cleanup** (finding 2, "Standpunktskarakter", plus the "written"/"in writing" suffix inconsistency) — likely needs the dictionary matcher to support substring/prefix matching rather than exact-string-only.
5. **Minor polish** (finding 8's shortcut labels and "Ændret" header) — low priority, batch together.

## Screenshots saved this session

- `screenshot-1789572768188-0.jpg` — Profile/settings (findings 1 partial, 5, 6)
- `screenshot-1789572768191-1.jpg` — Documents, untranslated toolbar/headers (finding 3)
- `screenshot-1789572768194-2.jpg` — Grades, "Point of view final" (finding 2)
- `screenshot-1789572768219-3.jpg` — Schedule, "1 in TOK" corruption (finding 1)

These were saved locally to the session's temp screenshot folder during the audit; move/attach them wherever the follow-up issues are filed.
