# Every module change ships to Unstable first; Stable is promoted by hand

Both release channels exist and are proven: the Manager reads `catalogue/modules.json` for Stable and overlays `modules-unstable/modules.json` for Unstable, an entry in the overlay replaces the Stable entry with the same `id`, and `tests/catalogue-compat.browser.test.js` runs every Manager ever published against both. Until now that machinery carried almost nothing. Changes went straight to Stable, which is where students and teachers are, mid-school-day, with no way to roll anything back: there is no server, Tampermonkey's update check is off by default, and an install that has already happened cannot be reached (see [ADR-0003](./0003-static-catalogue-independent-versioning.md) and [ADR-0005](./0005-tampermonkey-as-platform.md)).

## Decision

**Every change to a userscript that is not the Manager lands in `modules-unstable/` first.** It reaches Stable only when the repo owner says to promote it, in those words, after using it themselves.

"Unstable" is a folder and a catalogue, **not a Git branch**. Everything still lands on `main`: unstable-first changes the release path, not the branching model, and [ADR-0004](./0004-issues-only-no-external-prs.md) is untouched.

**The Manager is exempt and stays a Stable-only script.** It is the thing that delivers the channels: a Manager that will not boot takes the channel switch down with it and there is no Unstable copy to fall back to, because reaching one would require the broken Manager. Manager 1.21.0 shipped dead to Stable for twenty minutes and demonstrated exactly that. The Manager's protection is its test suite, not a channel.

### Version continuity

Plain three-part `MAJOR.MINOR.PATCH` throughout, exactly as [ADR-0003](./0003-static-catalogue-independent-versioning.md) requires — no `-beta` or `-rc` suffixes in either channel. One number line per module, shared by both channels:

1. A module sits at its Stable number, say `1.9.3`, in `modules/` and `catalogue/modules.json`.
2. The first change opens an Unstable copy at `1.9.4`: the file in `modules-unstable/`, its entry in `modules-unstable/modules.json`. Stable stays at `1.9.3` and its file is **frozen** — while a module is under test, the copy in `modules/` is not edited for any reason.
3. Each further round of work bumps again: `1.9.5`, `1.9.6`. Testers get every one within five minutes, because the Manager caches the Unstable overlay for five minutes against twenty-four hours for Stable.
4. Promotion bumps the patch once more and Stable takes that number.

Stable therefore skips numbers — `1.9.3` straight to `1.9.7` — and that is correct, not a mistake to tidy up. The skipped numbers were really published to real installs; reissuing one would ship to nobody, because every comparison in the chain is strictly-greater.

**The promotion bump is not ceremony.** A tester installed the Unstable file, so their Tampermonkey copy points `@updateURL`/`@downloadURL` at `modules-unstable/`, which promotion deletes. If Stable shipped the same number the tester was already on, the Manager would see an installed version equal to the catalogue's, offer nothing, and leave them on a file whose update URL now 404s — stranded forever on the last Unstable build, silently. One more patch makes the Manager offer them an update whose `installUrl` is the Stable path, and installing it moves them back onto the Stable file.

**And installing it does not always remove the Unstable copy** — issue #70, found in the field after the 2026-09-22 promotion of six modules. The two files carry the same `@name` and `@namespace` but different download URLs, and a tester ended up with both installed and both running: the Stable file at the new version, and the deleted-from-GitHub Unstable file still sitting beside it at the old one. Both announce to the Manager, so the older copy could define the version the Manager reported, and the panel offered an update that was already installed — permanently, since installing it again only replaced the copy that was already current. Manager 1.32.1 makes that state legible rather than silent: two answers to one Discovery pass under two versions is counted as two copies, the newer one defines the module, and the card asks for the older one to be deleted instead of offering an update that cannot take. Nothing in the repository can remove the stale install; only the person can, from the Tampermonkey dashboard.

### Promoting

Promotion is one commit that does all of this:

1. Copy `modules-unstable/<Name>.user.js` to `modules/<Name>.user.js`.
2. Rewrite `@updateURL` and `@downloadURL` in the copy to the `modules/` raw path. Forgetting this is what points a Stable install at a file that is about to be deleted.
3. Bump the patch in the copy: `@version` and the registered version together.
4. Update the module's entry in `catalogue/modules.json` — `version`, and anything else the work changed, `description` included — or add the entry if the module is new to Stable.
5. Delete `modules-unstable/<Name>.user.js`, its entry from `modules-unstable/modules.json`, and its section from `modules-unstable/README.md` — that README says what is on the channel now, and a promoted module is not. **If that would leave the overlay with no entries, replace the last one with an exact copy of its new `catalogue/modules.json` entry instead of deleting it.** Every shipped Manager rejects a catalogue with no modules, so an emptied overlay fails its refresh, leaves each Experimental user on the overlay they cached last, and reports the failure every time. A Manager older than 1.22.1 also lets that cached overlay win outright, so it keeps offering installs from the `modules-unstable/` URLs this step deletes. A copy with equal versions resolves to Stable in a current Manager, and an old one installs the Stable file either way. `check-versions.mjs` accepts an overlay entry with no file only when it is that exact copy. First needed on 2026-09-24, when Change Radar, Chairs Up and English Mode were promoted together and nothing was left under test.
6. Run `node scripts/check-versions.mjs` and the browser suite, then push.
7. Tell testers to check the Tampermonkey dashboard for a second entry under the same module name and delete the one whose update URL still says `modules-unstable/`. Step 5 deletes the file, not their install of it.

### The one exception

A fix for something already broken for Stable users may go straight to Stable: a module that throws on load, one that has stopped working against a Lectio change, data loss, or anything actively damaging what a user sees or has saved. It is written down as an exception because it is narrow — "this would be nice sooner" is not one, and neither is a new feature attached to a fix. Say in the commit message which break it is fixing.

## Consequences

- **Two copies of a module exist while it is under test**, and only the Unstable one is live work. The Stable copy is frozen until promotion, so nothing needs merging at promotion time — it is a copy, never a three-way diff.
- **`scripts/check-versions.mjs` resolves each userscript against its own channel's catalogue.** It used to merge both catalogues into one map keyed by `id`, where the Unstable entry won, so a frozen Stable file was reported as lagging its own catalogue the moment an Unstable copy appeared. It now also requires the Unstable copy to be strictly ahead of the Stable entry, and requires each file's `@updateURL`/`@downloadURL` to point at the folder it actually lives in.
- **Nothing reaches Stable users without the owner asking for it**, which is the whole point; the cost is that a finished, tested change can sit in Unstable indefinitely, and only the owner can move it.
- **Unstable is not private.** It is on `main` and anyone who switches channel gets it. It is a soak, not a sandbox: it still must not break Lectio, and every invariant in [AGENTS.md](../../AGENTS.md) applies to it unchanged.
