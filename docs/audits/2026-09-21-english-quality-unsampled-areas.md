# English quality audit — the unsampled areas (issue #21)

Second English-quality pass, covering what the Sept 16 audit for #9
(`2026-09-16-english-mode-translation-audit.md`) listed as not sampled: the Manager and
module settings UI, and five Lectio areas plus the three Create forms. The student role is
**dropped**, not deferred — see the owner's comment on #21. No student screen was opened
and no student account was requested.

Two sources, and every finding below says which it came from:

- **Repo** — reading `manager/Lectio-Manager.user.js`, every module's `settingsSchema` in
  `modules/` and `modules-unstable/`, and English Mode's `CORE` dictionary in
  `modules-unstable/Lectio-English-Mode.user.js` (the copy under work; its `CORE` is
  byte-identical to the frozen `modules/` copy at 1.9.3, so Part 2 holds for both).
- **Rendered page (Danish)** — a read-only session in the owner's Chrome, logged in as a
  teacher at school 223 (`https://www.lectio.dk/lectio/223/…`), reading the screens through
  the browser's accessibility tree and page text. **Tampermonkey was off in that profile, so
  neither the Manager nor English Mode was running, and rendered English could not be
  observed.** Part 3 therefore reads the Danish UI strings actually on each screen and
  checks them against the dictionary offline, with the module's own lookup functions.
  It is a worklist with the strings pinned down, not a set of rendered-English findings.

No consequential action was taken: nothing saved, submitted, registered or cancelled
(ADR-0009). The three Create forms were opened to read their labels and left by navigating
away. No names, message subjects or personal ids from any page appear in this document.

**Status.** Every one-line finding is fixed: Manager **1.31.1** (straight to Stable, as the
Manager always does), English Mode **1.11.1** (`modules-unstable/`, Experimental channel),
and one catalogue category. Everything larger is filed: #60, #61, #63, #64. The
rendered-English pass (#63) was **done later the same day** with English Mode running —
see [Rendered-English pass](#rendered-english-pass-2026-09-21-evening-issue-63) at the end
of Part 3; what it found is English Mode **1.11.4** and issue #68.

## Part 1 — The Manager and the module settings UI (repo)

### 1.1 String-table parity

The Manager's two tables (`TEXT.en` from line 51, `TEXT.da` from line 198 at 1.31.0) were
compared key by key: **139 keys on each side, none present on one side and absent from the
other, no duplicates.** No parity gap existed. The comparison is now
`scripts/check-i18n.mjs`, run by CI after the boot-order check, so a key added to one
side and forgotten on the other fails the build instead of showing a Danish reader English
in silence (which is exactly what `t()`'s fallback would do).

### 1.2 Strings that `applyStaticText()` never overwrote

The Manager builds its panel once from a template (`buildPanel()`, ~line 4508), the dock
from another (`buildDock()`, ~line 3606) and the gear from a third (~line 4392), all in
English, and `applyStaticText()` (~line 1265; there is no function called
`applyLanguage()`, this is the one that swaps language) rewrites the fixed strings from the
table on load and on every change. Method: every literal in the three templates
(`textContent`, `title`, `aria-label`, `placeholder`, option labels, the help panel, the
tip, the tabs, the footer) and every `textContent =` / `.title =` / `setAttribute('aria-label'…)`
write in the JavaScript between the tables and the stylesheet was listed and matched
against the 45 `set(…)`/`label(…)` calls plus the render functions that own their own text
(`renderModuleList`, `renderProblemLog`, `renderStorageReadout`, `renderNavigation`,
`updateChannelUI`, `syncDockPreferenceControls`, `updateRefreshedLabel`,
`updateLauncherIndicators`). Everything that did not resolve to a `t()` lookup:

| # | Where (1.31.0 line) | String | Reaches the screen as | Fix |
|---|---|---|---|---|
| 1 | template, 4667 | `aria-label="Sort modules"` on the sort button group | permanently English in both languages; only a screen reader ever hears it, which is why it survived eleven versions | **Fixed 1.31.1** — `sortModules` key (`Sort modules` / `Sortér moduler`), set from `applyStaticText()` |
| 2 | `renderModuleList`, 5464–5466 | `Open Tampermonkey with the selected Stable/Experimental version` and `Open Tampermonkey's update/install page` (the update/downgrade link's tooltip) | English in a Danish panel, re-rendered per catalogue so it *would* switch if it had a key | **Fixed 1.31.1** — `updateLinkTitle`, `downgradeLinkTitle(channel)`; the channel word comes from `t('stable')`/`t('unstable')` |
| 3 | `renderModuleList`, 5450–5451 | `${name} is installed but does not run on this Lectio page, so its settings cannot be changed from here.` (tooltip on the "Not active on this page" note) | English tooltip beside a Danish label | **Fixed 1.31.1** — `notActiveHereTitle(name)` |
| 4 | catalogue refresh, 879 and 898 | `Stable catalogue: ${error.message}` / `Experimental modules: ${error.message}`, joined into `refreshFailedSome` | English fragments inside the Danish failure banner | **Left, recorded in #64** — the same string is the problem-log `message`, which is pasted into GitHub issues, where English is right |
| 5 | template, 4526–4527 | language options `English` / `Dansk` | each in its own language | deliberate; a language picker names each language in itself |
| 6 | template, 4658 | `All modules` in `.lectio-manager-nav-current` | overwritten by `renderNavigation()` → `getViewLabel()` before the panel is shown | not a finding; listed because it looks like one |
| 7 | settings view, 5733 / 5761 / 5777 / 5982 / 6099 | `sectionName`, `control.label`, `control.description`, `control.buttonLabel`, option labels | the module's own strings, rendered verbatim | not the Manager's to translate — see 1.4 and #60 |

So: **three permanently-English strings found and fixed, one recorded as intentional, and
the rest of the template is covered.** `tests/fixtures/manager-language.html` now installs
an outdated module that is not running on the page, so the Installed tab renders the update
link and the not-active note, and asserts all three strings switch to Danish and back. It
bites: a scratch copy of the Manager with the one `sortModules` line removed fails the
fixture with `the sort group stayed English: Sort modules`; the real file passes.

### 1.3 Danish quality and consistency

The Danish reads as Danish, not as translated English — sentence shape, `du`-form, real
compounds (`Udgivelseskanal`, `Sikkerhedskopi`, `indstillingsfil`), and the long help texts
(`storageHelp`, `settingsFileHelp`, `problemLogHelp`) are idiomatic. What was found:

| Finding | Source | Outcome |
|---|---|---|
| `installTest: 'Install test'` / `'Installer test'` labels the button that installs a module from the **Experimental** channel, beside a chip that says *Experimental / Eksperimentel*. Two words for one concept (#34). | repo | **Fixed 1.31.1** — `Install experimental` / `Installer eksperimentel` |
| `unstable` never reaches the user: every channel name on screen goes through `t('stable')`/`t('unstable')` (`updateChannelUI`, `channelTarget`, the select options). Confirmed by reading every call site. | repo | nothing to do |
| Change Radar's catalogue category was `Schedule`; every other timetable module is `Timetable`. `CATALOGUE_VOCABULARY.da` maps both to `Skema`, so a Danish reader saw **two `Skema` groups** in the list. | repo (`modules-unstable/modules.json`) | **Fixed** — category is now `Timetable` (catalogue only; no userscript changed) |
| `Dok` / `Dokpanel` / `Dokkens baggrund` / `Dokken vises kun…` — "dok" is a dry dock in Danish; Danish UIs keep *Dock*. | repo | #64 (wording, owner's call) |
| `channelTarget` renders `Stabil mål: v…` — ungrammatical. | repo | #64 |
| `logKindNotice: 'Note'` (→ `Bemærkning`), `problemLog: 'Fejllog'` (the log also holds notices and drift; `Problemlog` keeps the English distinction). | repo | #64 |
| `settingsBtn: 'Indstillinger for Manager'` vs `settingsFilePrefs: 'Manager-indstillinger'`, and `Manageren`/`Manager` alternating as the subject. | repo | #64 |

### 1.4 Module settings schemas

Every module's `settingsSchema` was read in both folders. **None of the seven carries a
second language.** Labels, `section` names, `description` help text, `buttonLabel`s and
select option labels are plain English strings in all of them:

| Module | Controls | How it localises the schema | Stable vs Experimental copy |
|---|---|---|---|
| Chairs Up | 2 | not at all | schema identical; the Experimental copy adds `storage[].label` as `{ en, da }` |
| English Mode | 2 | not at all (its `Dansk`/`English` option labels are language names) | identical; Experimental adds `{ en, da }` storage labels |
| Schedule Summary | 3 | not at all — but its on-page strip *is* bilingual (`labels()`, ADR-0013 order) | identical; Experimental adds a storage label |
| Unread Message Notifications | 3 | not at all | identical; Experimental adds storage labels |
| Theming | 17 | not at all | identical; Experimental adds storage labels |
| Subject Colours | 14 + one colour control per learned class | not at all — its on-page colour key *is* bilingual (`legendLabels()`) | identical; Experimental adds storage labels |
| Change Radar | 30 (`SETTING_SCHEMA`, line 164) | not at all; its dock tooltip is `{ en, da }`, its floating HUD strings are English | Experimental only |

The only Danish any module hands the Manager at registration is the `storage[].label`
`{ en, da }` object (Experimental copies) and the dock `label`/`tooltip`, both of which the
Manager resolves with `dockText()`. The settings renderer does **not** accept that shape:
it writes `control.label || control.key` and `control.description` straight into
`textContent`, so a module trying `{ en, da }` there would render `[object Object]`. And
the Manager does not dispatch `lectio-manager:discover` on a language change, nor does any
module re-announce on `lectio-manager:language` (the skeleton only rebuilds its dock item),
so a schema built at registration keeps its language until the next page load. ADR-0013
makes translating a module optional, so this is a gap rather than a bug — but it is the
whole module-settings surface, and it is not a one-line fix. **Filed as #60** with the
module-side shape the skeleton already uses (`labels()` at `announce()` time, re-announce
on the language event) and the one Manager change it needs (re-render an open settings
view when its module re-registers).

Parity within the English: consistent. British spelling throughout (`colour`, `Centre`),
`hold` is *class*, `modul` is *period*, `forløb` is *unit* in every module and in English
Mode's dictionary; no module calls the channel anything but Experimental.

## Part 2 — Dictionary coverage for the unsampled areas (repo)

**What this is worth.** A `CORE` entry is an exact, whole-string match after `normalize()`
(soft hyphen and NBSP stripped, whitespace collapsed; a trailing `:` and the grade
`afsl.`/`ikke afsl.` qualifiers are also handled). A string with no entry goes to
`translateStructured()` — a short list of regex rules (`Uge N`, `N. modul`, weekdays,
`skriftlig`/`mundtlig`, ` - `-separated pieces…) — and if that leaves Danish behind it goes
to the Google fallback **only if `hasDanish()` says so**: the string must contain `æøå`, one
of ~35 `DANISH_STEMS`, or enough tokens from the ~60-word `DANISH_WORDS` list. So a gap is
one of two things, and the second is worse than the first: either the string goes to Google
(evidence it *may* be mistranslated — `Ny mappe` → `The map`), or it has no recognisable
Danish word and **stays Danish outright** (`Titel`, `Ferie`, `Deltagere`, `Anvend`, `Dag`).
Neither is evidence of what the screen renders; that needs eyes on the page (#63).

Before this change, per area (read from `origin/main`; the Stable copy is the same):

| Area | Danish names | In `CORE` | Elsewhere in the module | Absent |
|---|---|---|---|---|
| Study Plan | `Studieplan` | `Studieplan` → *Course Plan*, `Undervisningsbeskrivelse` → *Course Description*, `Forløb` → *Unit*, `Forløb og opgaver`, `Opret forløb`, `Kun aktuelle hold`, `Elevtid`, `Kalender`, `Liste` | `PERSONAL_NAV` (`Studieplan` → *Course Plan*), `DANISH_STEMS` (`studieplan`, `forløb`) | the rest of the sub-nav (`Søg`, `Deling`, `Fagvalg`), the class sub-nav, `Måned`, `Uge`, `Horisontal`, `Kun opgaver`, the month abbreviations, `Total`/`Norm` |
| Surveys | `Spørgeskema`, `Undersøgelse` | `Spørgeskema` → *Survey*, `Spørgeskemaer` → *Surveys* | `PERSONAL_NAV` (`Spørgeskema` → *Surveys* — note the nav says *Surveys* for the singular and `CORE` says *Survey*), `DANISH_STEMS` | everything on the screen itself: `Opret spørgeskema`, the three section headings, every column header, both empty states, every header tooltip. **`Undersøgelse` appears nowhere in the module** — and nowhere on the teacher screen either (see Part 3) |
| Course Plan | `Holdplan` | nothing | nothing | **`Holdplan` appears nowhere in the module** — and is not a label at school 223: the per-class plan is `Studieplan` under the class sub-nav, with `Kalender` / `Liste` (`Forløbsliste`) / `Undervisningsbeskrivelse` views (Part 3) |
| Annual Summary | `Årsopgørelse`, `Årsrapport` | `Årsopgørelse` → *Annual Summary* | `PERSONAL_NAV`, `DANISH_STEMS` (`årsopgør`) | every tab, header and row label on the screen. **`Årsrapport` appears nowhere in the module** and not on the screen |
| Time Tracking | `Tidsregistrering` | nothing | `GLOBAL_NAV` (`Tidsregistrering` → *Time Tracking*, for the fixed nav only), `DANISH_STEMS` (`tidsregistr`) | the word itself as a tab label or heading, and every string on the screen |
| Create Lesson / Other Activity / Private Appointment | `Opret aktivitet`, `Anden aktivitet`, `Privat aftale` | `Anden aktivitet` → *Other Activity*, `Privat aftale` → *Private Appointment*, `Aktivitet`, `Lektion`, `Opret`, `Gem`, `Annuller`, `Tilføj`, `Hold`, `Lærere`, `Lokaler`, `Elever`, `Dato`, `Indhold`, `Ændret`, `Kommentar`, `Type`, `Status` | — | `Opret aktivitet`, `Titel`, `Deltagere`, `Ressourcer`, `Valgte`, `Aflyst`, `Anvend`, `Start`/`Slut`, the whole credit table, the double-booking block, the pickers and their tooltips |

Terminology note: the issue calls `Studieplan` *Study Plan* and `Holdplan` *Course Plan*;
the module has translated `Studieplan` as *Course Plan* since #9 and that is what every
Course-Plan string in it means. Kept as is — nothing on the live screens needed the other
name, and renaming would churn every existing entry.

## Part 3 — The live Lectio screens (rendered page, Danish only)

**Rendered English was not checked, and why:** the Chrome profile used has Tampermonkey
switched off, so no userscript ran; the Manager's DA/EN switch and English Mode's toggle
were absent from every page. What follows is the Danish UI vocabulary actually present on
each screen, read from the accessibility tree and page text, classified by running each
string through the *real* `exactCore()`, `translateStructured()` and `hasDanish()` from the
module (loaded into Node with `vm`, the same way the #9 audit verified its fixes). Classes:

- **exact** — a `CORE` entry resolves the whole string locally.
- **pattern** — a `translateStructured()` rule resolves it locally.
- **Google** — no local result and `hasDanish()` is true, so it goes to the fallback.
- **stays Danish** — no local result and no recognisable Danish word, so it is never sent
  anywhere and renders in Danish.

Counts per screen, before and after English Mode 1.11.1 (every string listed under the
screen was read on the page):

| Screen (school 223 path) | Strings | Before: exact / pattern / Google / stays Danish | After 1.11.1 |
|---|---|---|---|
| Study Plan calendar + class Study Plan + Unit list — `studieplan.aspx?displaytype=ugeteksttabel`, `…&holdelementid=…`, `studieplan/forloebsliste.aspx` | 47 | 11 / 1 / 20 / 15 | 34 / 1 / 4 / 8 |
| Annual Summary — `laerer_aarsopgoerelse.aspx` | 31 | 3 / 0 / 14 / 14 | 23 / 0 / 6 / 2 |
| Time Tracking — `laerer_aarsopgoerelse.aspx?lectab=tidsreg` | 38 | 3 / 2 / 9 / 24 | 26 / 2 / 2 / 8 |
| Surveys — `spoergeskema/spoergeskema_rapport.aspx` | 20 (+3 names from the issue, not seen) | 2 / 0 / 17 / 4 | 20 / 0 / 2 / 1 |
| Create Lesson — `aktivitet/aktivitetrediger.aspx?action=create&type=lesson` | 46 | 15 / 1 / 16 / 14 | 42 / 1 / 0 / 3 |
| Create Other Activity — same page, `type=aa` (its additional strings) | 26 | 3 / 0 / 9 / 14 | 25 / 0 / 1 / 0 |
| Private Appointment — `privat_aftale.aspx` | 9 | 4 / 0 / 1 / 4 | 9 / 0 / 0 / 0 |

Not read / refused: **none** — every screen loaded and was readable. `Holdplan`,
`Årsrapport` and `Undersøgelse` were **not found on any teacher screen** at school 223, so
no entry was added for them (an entry for a string that does not exist is the thing the
issue warned against).

### What is on each screen

**Study Plan** (`Studieplan - Kalender` heading; page title `Studieplan Kalender`). Sub-nav
`Kalender`, `Søg`, `Liste`, `Undervisningsbeskrivelse`, `Deling`, `Fagvalg`, `Opret forløb`;
`Vis:` select with `Forløb og opgaver` / `Kun opgaver`; checkboxes `Kun aktuelle hold`,
`Horisontal`; headers `Måned`, `Uge`, one column per class code, `Elevtid`; footer
`Total: 10,5 t.` / `Norm: 32 t.`; month labels `jul. 2026` … `maj. 2027`. A class's own
Study Plan carries the class sub-nav `Skema`, `Medlemsskema`, `Studieplan`, `Materialer`,
`Modulregnskab`, `Aktiviteter`, `Lærere-Elever`, `Fravær`, `Opgaver`, `Karakterer`,
`Dokumenter`, `Beskeder`, `Adgangskoder`; its `Liste` view is `Forløbsliste` with
`Der er ingen forløb` and `Gem` / `Annuller` / `Anvend` (tooltips `Gem data og luk posten.
Genvej: Alt+S`, `Luk posten uden at gemme. Genvej: Alt+Z`, `Gem data uden at lukke posten.
Genvej: Alt+W`). Global-nav tooltips on every page: `Tryk for at se flere muligheder`,
`Åbn hjælp til dette skærmbillede`, `Vis større foto`, `Søg efter beskeder og dokumenter`,
and the Time Tracking start link `Starter ny tidsregistrering og sætter starttid til nu.
Posten kan efterfølgende redigeres på Tidsreg…` (truncated in the tree; not added).

**Annual Summary.** Tabs `Årsopgørelse`, `Timeberegning`, `Ekstra timer`, `Eks.Belastning`,
`Tidsregistrering`; period select `Skoleåret 26/27`, `Andet halvår 2026`, `Første halvår
2027`, `Finansåret 2026`/`2027`, `2026 Q3`…, `Min periode`; headers `Hold`, `Moduler`,
`Budgetteret`, `Realiseret`, `LærerKred`, `Holdnorm`, `Lærernorm`, `Timer`, `Ekstra`; rows
`Ej hold`, `Undervisning i alt`, `Tillæg/opgaver`, `Bemærkninger`, `Ingen tillæg`, `Sum`,
`Aftalt timetal`, `Overtimer/Undertimer`; class rows including `1i - aktivitet` and
`1i aktivitet/4`.

**Time Tracking.** `Vis hele året`, `Registrer ferie`, week field `Uge 39 (21/9-27/9) 2026`
with `Forrige Genvej: Alt+B` / `Næste Genvej: Alt+N`; headers `Dato`, `Dag`, `Uge`,
`Fra kl.`, `Til kl.`, `Timetal`, `Timer`, `Type`, `Note`; weekday names; the type select
`Arbejde`, `Helligdag`, `Ferie`, `Særlige feriedage`, `Sygdom`, `Barns sygdom`,
`Omsorgsdag`, `Afspadsering`, `Barsel`, `Andet`; `Kopiér rækken`; `Gem`; the `Opgørelse`
table with `Periode`, `Timer`, `Saldo`, `Udspecificeret`, `Timer uden ferie/helligdage: …`,
`Periode: 01-07-2026 - 30-06-2027`, month names `August 2026`, `Juli 2026`, and breakdown
cells like `Arbejde: 232,7, Ferie: 185,0`.

**Surveys** (page title `Spørgeskemaer`). `Opret spørgeskema`; sections `Åbne for
besvarelse`, `Åbne for rapportering`, `Egne spørgeskemaer`; headers `Titel`, `Ejer`,
`Anonym`, `Svarfrist`, `Frigives`, `Udløber`, each a sort link whose tooltip is a sentence:
`Besvarelse foregår anonymt: Ja/Nej`, `Besvar spørgeskema inden dette tidspunkt`,
`Frigivelse af spørgeskemaundersøgelsens resultater`, `Herefter er resultaterne ikke længere
tilgængelige`; the report link `Vis resultat af spørgeskemaundersøgelsen`; empty states
`Ingen spørgeskemaer åbne for besvarelse...` and `Ingen spørgeskemaer...`; `Vis kun
aktuelle`.

**The Create forms.** On the teacher's own timetable the three links are `Lektion`, `Anden
aktivitet` and `Privat aftale` (the text before them could not be confirmed as a node; the
issue's `Opret aktivitet` is the *page title* the first two open). Create Lesson: `Type:`
`Lektion`, `Titel:`, `Dato:`, `Modul:` with `1. modul kl. 08:15-09:25` and `Vælg modul`,
`Status:` `Normal` / `Ændret` / `Aflyst`, `Deltagere:`, `Valgte`, `Hold:`, `Lærere:`,
`Lokaler:`, `Ressourcer:`, `Tilføj`, `Elever:`, `Note:`, `Indhold:`; pickers `Vælg Hold`,
`Vælg Lærer`, `Vælg Lokale`, `Vælg Ressource`; search placeholder `Søg: hold, lærer,
lokale, ressource` and its button `Tilføj hold, lærer, lokale eller ressource som deltager`;
the credit table `Krediteret lærer`, `Hold`, `Moduler`, `Ekstra timer`, `Krediteringsnote`,
`Krediterings­rolle` (soft hyphen in the source), `Auto`, `Krediteret hold`, `Ej hold`;
`Dobbeltbookninger`, `Opdater`, `Aflys dobbeltbookede aktiviteter`, `Der er ikke fundet
nogen dobbeltbookninger`, `Sætter hak i alle bokse` / `Fjerner hak i alle bokse`; `Gem`,
`Annuller`, `Anvend`. Other Activity adds `Start:` / `Slut:`, `Vises i:` `Skema` /
`Skema-top` / `Dags/Ugeændringer`, `Andet:` `Skjul elevdeltagelse for andre elever`,
`Frivillig aktivitet (Reserverer ikke deltagere)`, `Tilmelding:` `Brug tilmelding`,
`Dobbeltbookede entiteter:`, `Note på aflyste aktiviteter:`, `Aflysningsårsag:` with
`Andet`, `Barns sygdom`, `Censor`, `Eksamen`, `Ekskursion`, `Ferietimer`,
`Fællesaktiviteter`, `Kurser`, `Omsorgsdage`, `Studievejledning`, `Sygdom`, `Tjenestefri`,
`Krediteringsnote:`. Private Appointment: heading **`Privat Aftale`** (title-cased, unlike
the `Privat aftale` link — the exact entry did not match it, and with no recognisable Danish
word it stayed Danish), `Titel:`, `Start:`, `Slut:`, `Kommentar:`, `Private aftaler kan ikke
ses af andre`, `Gem`, `Annuller`.

### Known failure classes seen on these screens (rendered page, DOM shape)

- **Shortcut letter mid-word.** The Annual Summary sub-nav wraps its accesskey letter in
  `<span class="shortcutletter">` in the middle of the word: `Tids[r]egistrering` (Alt+R)
  and `[Å]rsopgørelse` (Alt+Å); the accessibility tree reads `Tidsegistrering` and
  `rsopgørelse`. `fixShortcutLetterSplit()` from #20 only joins a *leading* span with the
  text after it, so neither tab label can ever match its entry. New shape of #20's
  `R|ediger`. → #61.
- **Class codes with `aktivitet`** — `1i - aktivitet`, `1i aktivitet/4`, `2i Aktivitet` on
  Annual Summary and the Study Plan. Still routed to Google (`aktivitet` is a Danish word);
  the #9 guards are what protect them. Exactly the cells to look at in the rendered pass.
- **Abbreviations with no Danish token** — `t.` (`Total: 10,5 t.`), `kl.` (`1. modul kl.
  08:15-09:25` comes out of the pattern pass as `1st period kl. 08:15-09:25`), `Eks.` in
  `Eks.Belastning`, the month abbreviations `jul.`/`okt.`/`maj.`. Stay Danish or half-done. → #61.
- **Glued compounds** — `LærerKred`, `Skema-top`, `Dags/Ugeændringer`, `Overtimer/Undertimer`,
  `Tillæg/opgaver`. All now exact entries; none would have survived word-level MT well.
- **Casing variant** — `Privat aftale` (link) vs `Privat Aftale` (form heading). Both now exact.
- **Soft hyphen** — `Krediterings­rolle`. `normalize()` already strips it (#20); the entry is
  on the plain form.
- **Period names** — `Skoleåret 26/27`, `Andet halvår 2026`, `Finansåret 2026` go to Google
  by virtue of `å`; not one-line entries because the year varies. → #61.

### Rendered-English pass — owner checklist (filed as #63, done below)

Written when no Tampermonkey was on in the available Chrome profile. Done later the same
day; each item is ticked where the rendered English was actually read, with the exceptions
noted inline.

- [x] Study Plan calendar — sub-nav, `Vis:` select, checkboxes, headers, month abbreviations, `Total`/`Norm`, class-code columns
- [x] A class's Study Plan — the class sub-nav and the `Holdet … - Studieplan Kalender` heading
- [x] Unit list (`Forløbsliste`) — empty state and the Gem/Annuller/Anvend tooltips
- [x] Annual Summary — the five tabs (two with a mid-word shortcut letter), period select, table headers, row labels, the `1i - aktivitet` / `1i aktivitet/4` rows
- [x] Time Tracking — toolbar, headers, the type select, `Kopiér rækken`, the Opgørelse table
- [x] Surveys — toolbar, section headings, headers **and their hover tooltips**, both empty states
- [x] Create Lesson — every row label, pickers, search placeholder, credit table, double-booking block; left by navigating away
- [x] Create Other Activity — `Vises i:`, `Frivillig aktivitet (…)`, `Tilmelding`; left by navigating away. **`Aflysningsårsag` options not observed** — the select is not in the DOM until Status is set to Aflyst, and the form was not changed
- [x] Private Appointment — the `Privat Aftale` heading, `Kommentar`, the footnote; left by navigating away
- [x] Hover tooltips on timetable cells — observed on the Study Plan calendar: **all still Danish** (→ #68)

### Rendered-English pass (2026-09-21, evening, issue #63)

**How.** Read-only, in the owner's Chrome, logged in as a teacher at school 223 (ADR-0009:
nothing saved, submitted, registered or cancelled; the three Create forms were opened,
read, and left by navigating away; no radio, checkbox or field was changed). The plan had
been to inject the Experimental copy with `GM_*` shims because Tampermonkey was believed to
be off — but on opening the tab **Tampermonkey was on**, with the Manager and six modules
running, and English Mode **1.11.2** registered (read off `lectio-module:register`, the
DA/EN switch on EN). So the pass observed the real Tampermonkey install of 1.11.2, not an
injected copy, which is the genuine condition the issue asked for. 1.11.3 differs from
1.11.2 only in the Manager settings labels (71f43f1), which are not on any of these screens.
The one attempt to inject before that was noticed timed out and never ran (nothing of it is
in any page; `window.__shimReady` stayed undefined), and no extension or setting was
touched. Two scratch HTTP servers on 127.0.0.1 were started for the injection and stopped
afterwards.

Each screen was read at +4 s and again at +7–8 s after load (the Annual Summary also at
+18 s, because its tooltips arrive from the fallback late) through a DOM walk over every
text node plus every `title`, `placeholder`, `alt`, button value and `<option>`, filtered
for anything still carrying Danish; the interesting strings were then checked by eye
against the page text. The Danish source of each finding was read from a fresh fetch of the
same page's HTML, so it is the exact attribute or node, not a guess.

**What rendered correctly** (nothing to do): every 1.11.1 entry that is on screen — the
Study Plan sub-nav, `Vis:` select and its options, both checkboxes, `Month`/`Week`/`Student
Workload`, `Jul 2026`…`Jun 2027`, `Total: 10,5 h` / `Norm: 32 h`, `2i Activity` as a column
header; the class sub-nav in full; `There are no units` and the three Save/Cancel/Apply
tooltips; all five Annual Summary tabs with their mid-word shortcut letters (`Time T` + `r`
+ `acking` reads as one word), the period select (`School year 26/27` … `My Period`), every
header and row label, `1i - Activity` and `1i Activity/4`; Time Tracking's toolbar, headers,
the whole type select, `Copy row`, `Previous/Next Shortcut: Alt+B/N`, `Statement`,
`Period`, `Balance`, `Breakdown`; every Surveys string including all five header tooltips
and both empty states; every Create Lesson and Other Activity row label, `1st period
08:15-09:25`, `Select Period`, the pickers, the search placeholder and its button, the
credit table, the double-booking block, `Shown in`, `Optional activity (does not reserve
participants)`, `Use sign-up`; and Private Appointment in full, `Private Appointment`
heading included. Not one `1 in`, mid-word split or casing fault was seen.

**Findings.** Fix = English Mode **1.11.4** unless an issue number is given.

| Screen | Danish source | Rendered (1.11.2) | Why | Fix |
|---|---|---|---|---|
| Study Plan (teacher) | `Studieplan Kalender` (heading, own text node) | `Study plan Calendar` | Google; inconsistent with *Course Plan* everywhere else | exact entry → `Course Plan Calendar` |
| Class Study Plan | `Holdet 1i TOK/4 - Studieplan Kalender` | `class 1i TOK/4 - Study plan Calendar` | Google; lower-case *class* | ` - ` rule: `Holdet` → `Class`, plus the entry above → `Class 1i TOK/4 - Course Plan Calendar` |
| Unit list | `Holdet 1i TOK/4 - Forløbsliste` | `class 1i TOK/4 - Progress list` | Google, though `Forløbsliste` is an entry (the whole string is not) | same rule → `Class 1i TOK/4 - Unit List` |
| Study Plan | `Visning: - Forløb og opgaver. Viser hold med mindst én opgave eller forløb. - Kun opgaver: Viser hold, som har mindst én opgave.` (`Vis:` tooltip) | `Display: - Progress and tasks. Shows teams with at least one task or process. - Tasks only: …` | Google; *teams*, *tasks*, *process* | exact entry |
| Study Plan | `Aktuelle hold er: Aktive holdelementer, med mindst én aktiv elev på dags dato.` (`Kun aktuelle hold` tooltip) | `Current classes are: Active class elements, with at least one active student to date.` | Google, readable but odd | exact entry |
| Every page | `Lectio version 24.035` (footer) | `Reading version 24.035` | Google: *lectio* is Latin | `looksLikeIdentifier()` treats `Lectio version N` as an identifier; never sent |
| Every page | `Se versioninformation` (footer tooltip), `Hurtignavigering` (quick-nav tooltip) | stayed Danish | single capitalised word → `looksLikeName()` → skipped | exact entries |
| Every page | `Mere`, `Tidsreg.` (the narrow-layout menu; hidden on wide screens but in the DOM) | stayed Danish | same name guard | exact entries → `More`, `Time reg.` (judgement call: the tooltip beside it says *time registration*) |
| Every page | `21/9-2026 kl. 21:00` (footer) | stayed Danish | no rule for the date-`kl.`-time shape | rule → `21/9-2026 at 21:00` |
| Annual Summary | `Lærerkred. - Summen af afholdte og planlagte moduler med læreren.` (`LærerKred` tooltip) | Danish at +7 s, then `Teaching staff. - The sum of held and planned periods with the teacher.` | Google, late; *Teaching staff* is wrong | exact entry |
| Annual Summary | `Opgjort i moduler af 70 min.` (header tooltips) | Danish at +7 s, `Calculated in periods of 70 min.` at +18 s | Google, late but right | exact entry, so it is immediate |
| Annual Summary | `Budgetterede timer: 0 + 0 Realiserede timer: 4,4 + 0 + 0` | `Budgeted hours: 0 + 0 Realized hours: 4.4 + 0 + 0` | Google turned the decimal comma into a point | phrase rules; figures untouched |
| Annual Summary | `Aftalt timetal i alt 26/27: 1694,6 Periode: 3/7-26 - 2/7-27 (365 dage) Antal kalenderdage 26/27: 365 Aftalt timetal i perioden: …` | readable, every `1694,6` as `1694.6` | same | phrase rules + `(N dage)` + label rule |
| Time Tracking | `Mandag` … `Fredag` (day column) | stayed Danish, while `Lørdag`/`Søndag` rendered `Saturday`/`Sunday` | `looksLikeName()`: a lone capitalised word with no `æøå` and no listed Danish word is taken for a name before `translateStructured()` runs; the two with `ø` pass `hasDanish()` | all seven weekdays as exact entries (checked before the guard) |
| Time Tracking | `Juli 2026` (statement rows) | stayed Danish (`August 2026` is the same word) | no full-month rule | `MONTHS` table, only with a year after it |
| Time Tracking | `Arbejde: 232,7, Barns sygdom: 7,4, Ferie: 185,0, Sygdom: 14,8` (the breakdown cells) | stayed Danish | no recognisable Danish word, so never sent | label-before-figure rule: each `Label:` looked up as an entry |
| Time Tracking | `Timer uden ferie/helligdage: 254,9`, `Dagsnorm: 7,4` (tooltip), `Registreret: 439,9 Forventet: 429,2 Saldo: 10,7` (tooltip) | stayed Danish | same | entries + the same rule |
| Create Lesson | `Der er ingen lærere at kreditere` | Danish at +4 s, `There are no teachers to credit` at +8 s | Google, late | exact entry |
| Create Lesson / Other Activity | `Afmarkér alle` (alt) | `Demarcate all` | Google | exact entries `Select all` / `Deselect all` |
| Other Activity | `Afkrydsning i Dags/Ugeændringer er ikke gyldigt uden afkrydsning i Skema eller Skema-top.` | `A tick in Daily/Weekly Changes is not valid without a tick in Schema or Schema-top.` | Google; *Schema* | exact entry |
| Other Activity | `Sæt kryds hvis tilmelding skal slås til på begivenheden` (tooltip) | `Tick ​​if registration is to be activated for the event` (with two zero-width spaces) | Google | exact entry → `Tick to enable sign-up for the event` |
| Other Activity | `Ved flueben i Frivillig aktivitet reserveres deltagere ikke. …` (tooltip) | `By ticking Voluntary activity, participants are not reserved. Note, however, that premises and resources …` | Google; *Voluntary*, *premises* | exact entry |
| Other Activity | `Bruges fx til skjule en fraværssamtale for andre elever` (tooltip) | `Used, for example, to hide an absence conversation from other students` | Google, acceptable | exact entry, for stability |
| Study Plan | `data-tooltip` on every cell: `2i Aktivitet`, `ma 6/7-26 - sø 12/7-26`, … | all Danish | `processElement()` never reads `data-tooltip`; and other modules parse that attribute on lesson blocks, so it is not a one-line change | **#68** |

**Behavioural notes.** The fallback is slow on attribute text: tooltips were routinely
still Danish at +7 s and English at +18 s, which is why several findings above are entries
for strings Google eventually got right. The page `<title>` is never translated (not on the
checklist; not filed). `Survey` (from `CORE`) sits in a hidden node beside the visible
`Surveys` nav label (from `PERSONAL_NAV`); only the latter is seen, so it is left.

**Not observed:** the `Aflysningsårsag` options, `Dobbeltbookede entiteter:` and `Note på
aflyste aktiviteter:` on Other Activity — only rendered after Status is set to Aflyst, and
the form was not changed. Everything else on the checklist was reached.

**Verification of 1.11.4.** `tests/fixtures/english-mode-patterns.html` now carries every
shape above in its live DOM form (the `&nbsp;Mandag` cell, the tooltips verbatim) and
asserts the rendered English, that `August 2026` is untouched, and that none of the sources
reached the fallback stub; a third broken copy served from memory — the label rule with its
lookup removed — fails naming the breakdown cell. The live pages were not re-observed with
1.11.4 (it is not installed in that profile; injecting it beside the running 1.11.2 would
have double-processed the page).

## Fixes applied

| Where | Version | What |
|---|---|---|
| `manager/Lectio-Manager.user.js`, `catalogue/modules.json` (manager entry) | 1.31.0 → **1.31.1** (Stable) | `sortModules`, `updateLinkTitle`, `downgradeLinkTitle`, `notActiveHereTitle` keys in both tables; the three DOM writes go through `t()`; `installTest` → *Install experimental* / *Installer eksperimentel*. Changelog in both languages. |
| `tests/fixtures/manager-language.html` | — | Installs an outdated, non-running module so the update link and not-active note render; asserts all three strings switch da→en→da. Proven to fail against a Manager missing the `sortModules` line. |
| `scripts/check-i18n.mjs`, `.github/workflows/checks.yml`, `AGENTS.md` | — | String-table key parity guard, run in CI after the boot-order check. |
| `modules-unstable/Lectio-English-Mode.user.js`, `modules-unstable/modules.json`, `modules-unstable/README.md` | 1.11.0 → **1.11.1** (Experimental) | 127 exact `CORE` entries, every one read off a rendered page in this session; none invented. Changelog in both languages. `modules/` untouched (frozen). |
| `modules-unstable/modules.json` (change-radar) | — | category `Schedule` → `Timetable`, so Danish readers no longer see two `Skema` groups. |
| `modules-unstable/Lectio-English-Mode.user.js`, `modules-unstable/modules.json`, `modules-unstable/README.md` | 1.11.3 → **1.11.4** (Experimental) | The rendered pass (#63): 27 exact entries, `MONTHS` and `PHRASES` tables, the `Holdet` piece rule, the footer-time rule, the label-before-figure rule, `Lectio version N` as an identifier. Changelog in both languages. `modules/` untouched (frozen). |
| `tests/fixtures/english-mode-patterns.html`, `tests/english-mode-patterns.browser.test.js` | — | Every #63 shape in its live DOM form, one near miss, the fallback log, and a third bite test. |

No test in the suite exercises English Mode's dictionary against the Experimental copy
(`tests/issue-20-verify.html` loads the frozen `modules/` file, and
`tests/english-mode.browser.test.js` covers the switch position only), so the new entries
are verified by the harness below rather than by the suite. Recorded, not fixed here.

## Verification

- **Dictionary harness** (scratch, not committed): loads the real `GLOBAL_NAV`…`isOurUi`
  and `DANISH_WORDS`…`translateStructured` sections of the module into a `vm` context with
  `GM_*`/`window`/`document` stubs and runs the 217 strings read in Part 3 through
  `exactCore()`, `translateStructured()` and `hasDanish()` — the module's own functions, not
  a reimplementation. Before: 41 exact, 4 pattern, 86 Google, 89 stays-Danish. After 1.11.1:
  179 exact, 4 pattern, 17 Google, 22 stays-Danish. What remains is the list in #61 plus
  strings that are the same in English (`Note`, `Normal`, `Auto`), class codes, and values.
- **Fixture bite**: `manager-language.html` run against a scratch copy of the Manager with
  the `sortModules` relabel removed → `fail: the sort group stayed English: Sort modules`;
  against the real file → `pass`.
- **Gates**: `node --check` on both changed userscripts; `scripts/check-versions.mjs`
  (`Versions agree across headers, registrations, and catalogues`);
  `scripts/build-dock-icons.mjs --check`; `scripts/check-boot-order.mjs` (14 passed, the
  three Chairs Up findings deferred to #58 as before); `scripts/check-i18n.mjs`
  (`en and da agree on 143 keys`); the full browser suite (100 tests). The first full run
  failed one test — the Danish English Mode changelog was 245 characters against the
  Manager's 240-character cap, caught by `tests/manager-changelog.browser.test.js` — and
  all four changelog lines were shortened to under 240 before the second run.

## Follow-up issues

- **#60** — localise every module's settings schema and re-announce on language change (Part 1.4).
- **#61** — English Mode pattern-level gaps from these screens: mid-word shortcut letters, `kl.`, `t.`, month abbreviations, period names, the Time Tracking start tooltip (Part 3).
- **#63** — the rendered-English re-check with English Mode running — **done** (the section at the end of Part 3); its one-line findings are 1.11.4.
- **#64** — Manager Danish wording and consistency notes (Part 1.3).
- **#68** — Study Plan cell tooltips (`data-tooltip`) stay Danish; not a one-line change because other modules parse that attribute on lesson blocks.
