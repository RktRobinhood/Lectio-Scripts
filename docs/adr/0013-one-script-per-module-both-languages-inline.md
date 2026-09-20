# ADR-0013: One script per module, with both languages inline

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

Lectio is a Danish system and serves every page as `lang="da"`. The Manager,
however, is used mainly by IB students, so its own interface wants to be English
by default with Danish available. That means at least the Manager, and over time
some modules, must carry two languages.

The obvious worry is bloat. Three ways to hold two languages were considered.

**Parallel files** — ship `Lectio-Manager-EN.user.js` and
`Lectio-Manager-DA.user.js`, one language each.

**Fetched language packs** — keep one script and pull `lang/da.json` over HTTPS
at runtime, the way the Catalogue is fetched.

**Both languages inline** — one script, one string table with an `en` and a `da`
side, chosen at runtime.

## Decision

**Both languages inline, in one file per script.**

The measurement settles it. In the Manager, adding Danish costs **4.8 KB on a
197 KB file — 2.4%**. Parallel files would take the repository's scripts from
**670 KB to 1340 KB** to avoid that 2.4%: duplicating the 97% that is code in
order to vary the 3% that is text.

Parallel files also double everything that has already proved easy to get wrong
here. Every version bump, every Catalogue entry, every bug fix and every test
would have to be done twice, and a fix applied to one language and forgotten in
the other is invisible until a user in that language reports it. The repository
already has a standing problem with bumps being missed across *three* files
(see AGENTS.md); six is not an improvement.

Fetched language packs fail for a more concrete reason: **six of the eight
modules run `@grant none`** and cannot make a cross-origin request at all. Only
the Manager and Theming hold `GM_xmlhttpRequest`. Giving every module a network
grant so it can download its own button labels would widen the trust boundary
this project deliberately keeps narrow (see ADR-0002), add a runtime dependency
on GitHub being reachable before the UI can render text, and introduce a flash
of untranslated interface on every page load. The fetch, cache, validate and
fall-back code would also be larger than the 4.8 KB of strings it saves.

## Consequences

- A script carries every language it supports. The cost is a few KB of text.
- **The Manager owns the choice.** It stores the person's language, publishes it
  on `<html data-lectio-language>`, and announces changes on
  `lectio-manager:language`.
- **A module reads, in order:** `data-lectio-language`, then
  `documentElement.lang`, then Danish. Lectio is Danish, so a module running
  without the Manager stays Danish; English Mode sets `documentElement.lang`,
  so a module inside an English page follows the page.
- A module is not required to translate anything. Ones that do not simply stay
  as they are; no module is blocked on a translation.
- If a third language is ever wanted, this decision is worth revisiting against
  the same measurement rather than by assumption.
