# English Mode translation audit (issue #9)

Real computer-use session against the live Ikast-Brande Gymnasium Lectio instance
(`https://www.lectio.dk/lectio/223/`), logged in as **Teacher MP – Matthew Pilley**,
with English Mode active (its own `DA/EN` toggle in the top-right, which is how the
module itself was confirmed to be installed and running). No consequential action
(absence recording, message sending, grade entry, etc.) was submitted at any point.

**Status: all findings are now fixed in `modules/Lectio-English-Mode.user.js`.** Findings 1, 2,
3, 5, 6, 7, and part of 8 ("Ændret") were fixed in v1.9.0; findings 4, the "Rediger" and
"Genvej" cases in finding 8, and the finding-2 "skriftlig" wording cosmetic were fixed in
v1.9.1 following a live re-verification pass for issue #20 — see "Fix status" under each
finding below for the root cause of each.

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

**Fix status: FIXED in v1.9.0.** Root cause confirmed by reading the code: `hasDanish()` tokenizes with `/\p{L}+/gu`, which only matches letter runs — digits are simply skipped, so "1i" tokenizes to a bare word `"i"`, and `"i"` is in `DANISH_WORDS` (the Danish word for "in"). That single false hit was enough to make `hasDanish("1i TOK/1 • LK MP • 219")` return `true` even though the string has no real Danish content, which sent the whole string to the Google fallback — and Google then genuinely translated the fused "i" into "in", producing "1 in TOK/1". `1i Math AA SL/2` and `1i Psyc HL` never hit this because they contain no Danish (real or fake), so `hasDanish` was already `false` for other reasons and they were never sent to MT at all.

Two changes: (1) `hasDanish`'s tokenizer now excludes letter runs directly adjacent to a digit (`(?<![\p{N}])\p{L}+(?![\p{N}])`), so "1i" no longer counts as containing the word "i". (2) As defence in depth, `postCorrect` now repairs any `"N in"` the Google fallback still produces back to `"Ni"`, but only when that exact `Ni` token is present in the original source — so a genuine translated "in" is never touched. Also added: `postCorrect` now normalizes "activity"/"activities" casing to Title Case in UI contexts, fixing the `1i activity/4` vs `2i Activity/3` inconsistency.

Verified with a standalone harness that evaluates the real (modified) `hasDanish`/`postCorrect` functions in Node against both the buggy case and a same-shape case that must still translate (`1i aktivitet/4`) — both behave correctly; see "Verification" at the end of this document.

### 2. "Standpunktskarakter" mistranslated as "Point of view" (contextually wrong, not just missing)

On the Grades page (`Grades/teacher_listgrades.aspx`), the row label rendered as **"Point of view final - in writing"**. The dictionary (`modules/Lectio-English-Mode.user.js:438`) already maps the exact string `Standpunktskarakter` → `Current Grade`, but the actual DOM text is `Standpunktskarakter afsl.` (with a suffix), which doesn't match the dictionary key exactly. It falls through to the Google Translate fallback, which renders the Danish grading term "Standpunktskarakter" (an interim/standing grade) as if it were the unrelated English idiom "point of view" — actively misleading for a teacher scanning grade-entry deadlines.

- Same row also shows the "skriftlig" (written) suffix rendered three different ways across the table: `- written`, `- in writing`, and `not final. - in writing` — inconsistent phrasing for what should be the same recurring suffix. **Fixed in v1.9.1 (issue #20).** `translateStructured()`'s local regex pass already renders "skriftlig" as "written" consistently; "in writing" only ever appeared when a row's exact phrasing missed the local pass and fell through to the Google fallback instead, which chose different wording for the same word. Rather than chase every row shape that can reach MT, `postCorrect()` now normalizes any Google-fallback `"in writing"` back to `"written"` whenever the source contains "skriftlig", so one wording reaches the page regardless of which pipeline produced it.
- Screenshot: `screenshot-1789572768194-2.jpg`

**Fix status: FIXED in v1.9.0.** `exactCore()` now also matches when the text is a known CORE key plus a trailing `afsl.` or `ikke afsl.` qualifier, resolving to the dictionary's own translation of the base term plus `(finalized)` / `(not yet finalized)` — so `Standpunktskarakter afsl.` → `Current Grade (finalized)` and `Årskarakter ikke afsl.` → `Final Course Grade (not yet finalized)`, both handled locally without ever reaching the Google fallback (which is what produced "Point of view" in the first place). This generically covers every grade-type key already in `CORE` (Standpunktskarakter, Terminskarakter, Årskarakter, Eksamenskarakter), not just the one observed on screen.

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

Note this table's **"Dato" → "Date"** header sits in the exact same header row and translated correctly the whole time (it already had a `CORE` entry). That's good evidence this was purely a missing-dictionary-entry problem, not a selector/rendering-coverage bug — the `<th>` cells in this table are clearly reachable by the translator whenever a dictionary entry exists for their text.

- Screenshots: `screenshot-1789572768191-1.jpg` (untranslated state), `screenshot-1789572768194-2.jpg`(N/A – see Grades); the "The map" mistranslation was observed live but not separately saved — reproduce by hard-reloading Documents a few times.
- Also on this screen: the checkbox label "Søg kun i aktuel mappe" is untranslated on first paint but does resolve to "Search current folder only" after ~1–2s — a timing issue, not missing coverage; harmless but worth confirming the debounce/observer isn't too slow on slower connections.

**Fix status: FIXED in v1.9.0.** Added `CORE` entries for all nine strings in the table above (`Ny fil`, `Ny mappe`, `Rediger mappe`, `Filnavn`, `Kommentar`, `Ændret af`, `Størrelse`, `Vis/Red.`, `Flyt`), plus `Antal` and `Holdelement` for the Grades/Assignments tables. This also directly fixes the "Ny mappe" → "The map" false-friend error, since the exact string now resolves locally and never reaches the Google fallback.

### 4. Assignment list: table headers not applied despite existing correct dictionary entries

On `OpgaveListe.aspx`, column headers **"Elevtid"** and **"Afventer lærer"** stayed in Danish, and **"Ikke afleveret"** rendered as **"Not delivered"** — even though the dictionary already defines all three correctly (`Elevtid` → `Student Workload`, `Afventer lærer` → `Awaiting Teacher`, `Ikke afleveret` → `Not Submitted`, at `modules/Lectio-English-Mode.user.js:360,408,411`). `Antal` and `Holdelement` have no dictionary entry at all (also seen as headers on this page and on Grades; fixed as part of finding 3).

**Fix status: FIXED in v1.9.1 (issue #20).** Re-verified live on `OpgaveListe.aspx` with a 5s wait per the follow-up instructions — the headers were still broken, so the "just async timing" theory from the original pass was wrong. Root-caused by inspecting the live DOM directly:

- `Elevtid` is not the plain word it appears to be — Lectio's own markup is `Elev­tid`, with a soft hyphen (U+00AD, invisible) spliced in for line-wrap hinting. `normalize()` stripped ` ` but not `­`, so the exact-match lookup compared `"Elev­tid"` against the dictionary's plain `"Elevtid"` key and never matched. Fixed by stripping `­` in `normalize()`.
- `Ikke afleveret` and `Afventer lærer` are genuinely split across a literal `<br>` inside the `<a>` (`Ikke<br>afleveret`, confirmed by toggling back to Danish and reading the raw DOM), so the two words are two separate text nodes and the whole-phrase dictionary key can never match either fragment alone — each word fell through independently, translating fine word-by-word but never resolving to the dictionary's precise `Not Submitted` / `Awaiting Teacher`. Added a `fixBrSplitPhrase()` pass that joins the two text nodes around a single `<br>`, looks the combined phrase up in `CORE`, and redistributes the translation back across the original two nodes (preserving the line break).

Verified against a fixture reproducing the exact live DOM shapes (`tests/fixtures/issue-20-verify.html`, `tests/issue-20-verify.browser.test.js`) and re-checked live.

### 5. Mixed-language heading: "Select Hold Favorites"

On Profile (`indstillinger/laerer_indstillinger.aspx`), the heading for the class-favourites picker renders as **"Select Hold Favorites"** — half-translated, leaving the Danish word "Hold" (class/team) sitting inside an otherwise-English sentence. The adjacent, near-identical section below it ("Vælg Stamklasse-favoritter") isn't translated at all.

- Screenshot: `screenshot-1789572768188-0.jpg`

**Fix status: FIXED in v1.9.0.** Confirmed the exact Danish source by toggling the live page back to Danish: the heading is literally **"Vælg Hold-favoritter"** (hyphenated as one compound word) — not in `CORE` at all before this fix, so it fell to the Google fallback, which correctly translated "Vælg" → "Select" and "-favoritter" → "Favorites" but left "Hold" untouched (a genuine Danish/English false-friend ambiguity for MT, since "hold" is also an ordinary English word). Added exact `CORE` entries for both `Vælg Hold-favoritter` → `Select Class Favorites` and `Vælg Stamklasse-favoritter` → `Select Home Class Favorites`, so both now resolve locally and never reach MT.

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

**Fix status: FIXED in v1.9.0.** Verified every string above against the live Danish page and added exact `CORE` entries for all of them (the sentence-length ones included, matched as full exact strings the same way the rest of the dictionary works).

### 7. Untranslated action on a native error/empty state

Navigating to a non-existent Lectio path produces Lectio's own "page not found" screen. The heading and body text are well translated ("An error occurred" / "You have searched for a page that does not exist in Lectio."), but the recovery button, **"Gå til Hovedmenu"**, is completely untranslated — despite `Hovedmenu` → `Main Menu` already existing in the dictionary at line 210.

**Fix status: FIXED in v1.9.0.** The dictionary only had the bare word `Hovedmenu`, used by the separate fixed-navigation subsystem (`repairNavigation`) that recognizes and relabels the top nav bar specifically — this button isn't part of that nav bar, and the general text pipeline (`exactCore`) requires an exact match against the *whole* button string, so `"Gå til Hovedmenu"` (a different, longer string) never matched anything before this fix. Not a selector/coverage mystery — just a missing multi-word dictionary entry. Added `Gå til Hovedmenu` → `Go to Main Menu` directly.

### 8. Small/singleton items

- **"Rediger"** (Edit) link on the lesson/activity detail popup (`aktivitet/aktivitetforside2.aspx`) stayed as Danish even though `Rediger` → `Edit` exists in the dictionary (line 504).

  **Fix status: FIXED in v1.9.1 (issue #20).** Found the missing "R": it isn't missing at all, it's in its own text node. `document.createTreeWalker` over the `<a>` (id `s_m_Content_Content_tocAndToolbar_editModeBtn`) shows three child nodes — a `<span class="ls-fonticon ls-fonticon-fill">` (the pencil icon glyph, textContent `"edit"`), then a `<span class="shortcutletter">R</span>`, then a bare text node `"ediger"`. The `shortcutletter` span is Lectio's own native keyboard-accesskey markup (the same class appears, empty, on the top-nav items) — it wraps a word's mnemonic letter separately so the browser can style it, so the DOM never contains the contiguous string `"Rediger"` for the dictionary's exact-match to find. Not a Lectio rendering quirk and not the same shape as finding 1's corruption — a second instance of the same "phrase split across nodes" problem as finding 4's `<br>`-split headers. Fixed with `fixShortcutLetterSplit()`, which joins the `shortcutletter` span's letter with the following text node, looks up the combined word, and writes the translation's first character back into the span and the remainder into the text node.

- **"Genvej: Alt+G"** / **"Genvej: Alt+K"** etc. — hidden keyboard-shortcut labels attached to every top-nav item are in Danish ("Genvej" = "Shortcut"); low visual impact (not usually shown) but will read oddly to a screen reader or on hover-tooltip. **Fixed in v1.9.1 (issue #20).** Captured the exact live attribute directly (`title="Genvej: Alt+O"`, `"Genvej: Alt+M"`, `"Genvej: Alt+Æ"`, `"Genvej: Alt+G"`, `"Genvej: Alt+K"`, one per top-nav anchor). Root cause: these anchors get `data-lectio-en-fixed-nav="1"` from `repairNavigation()` once their label is translated, and both `processElement()` and `processAttr()` skip any element matched by `isFixedNav()` — by design, so the generic pipeline doesn't fight with the nav-repair system over the anchor's text — but that guard incidentally also blocked the `title` attribute, which nothing else was translating either. Fixed by translating `Genvej:` → `Shortcut:` directly inside `repairNavigation()`, which already owns these exact anchors.
- **"Ændret"** column header on Messages (`beskeder2.aspx`). **Fixed in v1.9.0** — added as a `CORE` entry (shared with the Documents "Ændret af" fix in finding 3).
- **"Info · 5 dage"** schedule toolbar label is Danish on first paint, resolves to "Info · 5 days" after ~1s — timing-only, confirmed not a bug, no fix needed.

## Verification

Since this repo has no unit tests for the translation dictionary/logic itself (only a DOM-fixture test for the DA/EN switch), I built a one-off Node harness that loads the real, modified `hasDanish`/`exactCore`/`postCorrect`/`normalize` functions from the actual file (via `vm`, with minimal `document`/`window`/`GM_*` stubs) and asserts against them directly — not a reimplementation, the genuine functions. 16 assertions, all passing, covering: the "1i" corruption fix (both that it no longer false-fires, and that a case needing real translation, e.g. `1i aktivitet/4`, still does), the exact suffix-qualifier resolution for `Standpunktskarakter afsl.` and `Årskarakter ikke afsl.`, several of the new dictionary entries, the `postCorrect` "N in" → "Ni" repair (including a check that it does *not* touch a genuine "in"), and the activity/activities casing normalization. Also ran `node --check` on the full file and the repo's existing `tests/english-mode.browser.test.js` (headless-Chrome DA/EN switch test) — both pass.

This confirms the logic is correct in isolation. It does **not** replace re-checking the live site after this update ships and Tampermonkey picks up the new version (`@updateURL` points at `main`), since some of what's fixed here (the async translator pipeline, `postCorrect`'s interaction with the real Google fallback) can only be fully exercised against the real page.

### Issue #20 follow-up (v1.9.1)

Each of the four root causes above (the soft hyphen, the two `<br>`-split headers, the `shortcutletter`-split "Rediger", and the `Genvej:` title) was confirmed directly against the live DOM in a computer-use session (teacher role) — reading `outerHTML`/`childNodes` with `document.createTreeWalker`, and for the `<br>`-split headers, toggling back to Danish to read the raw pre-translation markup. The fixes themselves were verified against a new fixture (`tests/fixtures/issue-20-verify.html`, run via `tests/issue-20-verify.browser.test.js`) that reproduces the exact live DOM shapes byte-for-byte and asserts the module resolves each of them correctly in a real headless-Chrome page, plus `node --check` and the existing DA/EN switch test — all pass. As with v1.9.0, this doesn't replace a final live re-check once Tampermonkey picks up the new version.

## Suggested follow-up issue batches (remaining, after this update)

None remaining from this audit — all four items filed as issue #20 were resolved in v1.9.1 (see each finding's "Fix status" above). Any further gaps (e.g. the student-role and Study Plan/Surveys/Course Plan coverage noted above as not sampled) would need their own fresh audit pass.

## Screenshots saved this session

- `screenshot-1789572768188-0.jpg` — Profile/settings (findings 1 partial, 5, 6)
- `screenshot-1789572768191-1.jpg` — Documents, untranslated toolbar/headers (finding 3)
- `screenshot-1789572768194-2.jpg` — Grades, "Point of view final" (finding 2)
- `screenshot-1789572768219-3.jpg` — Schedule, "1 in TOK" corruption (finding 1)

These were saved locally to the session's temp screenshot folder during the audit; move/attach them wherever the follow-up issues are filed.
