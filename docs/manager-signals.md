# What the Manager's gear is allowed to say

The Manager has a few ways to tell a person something without interrupting
them. They follow one idea, and this page is that idea written down, because it
was re-derived three times in a row (#24, #31, #50 with #44) and would have been
re-derived a fourth time the next time someone wanted a badge. It is the
Manager-owned half of the picture; the module-facing dock contract is
[`docs/manager-dock-api.md`](./manager-dock-api.md).

**The default answer to "should this get a badge?" is no.** The last section
says what is deliberately never signalled and what a new signal has to pass.

## Where a signal may live

**On the gear, or indoors beside the thing it is about. Never on the dock.**

The gear (`#lectio-manager-toggle`) is the Manager's own button, built eagerly
on every page whether or not the panel ever opens, so it is the only place a
global signal can be seen without the user already having gone looking. The
dock is the modules' furniture: it exists for what modules register through
the dock contract ([ADR-0012](./adr/0012-manager-owned-shared-dock.md)), it is
hidden entirely while no module has a visible item, and a Manager mark on it
would sit beside the modules' own badges and compete with them. The owner
turned a dock badge down in those terms when the update count was proposed
(#31): "a little number on the gear is an okay idea, not on the dock that will
clutter things". A Manager signal is the Manager talking about itself, and it
does that from its own button.

Indoors means the panel, and specifically the control the signal is about: the
unseen count sits on the **Problem log** summary because that is where the
entries are. A signal one click short of its destination is the failure #44
fixed — the dot said "something was recorded", the panel opened onto several
identical collapsed sections, and the trail stopped.

## Two shapes: a chip is a count, a dot is a mark

**A chip is a count.** A ringed pill filled with `--lectio-theme-surface`,
ringed in the colour of whatever it counts, with a numeral inside. It appears
twice, and it is the same chip both times:

- gear, top-right corner, ringed in `--lectio-theme-accent` — the number of
  updates waiting (`data-update-count` on the toggle);
- **Problem log** summary, inline after the label, ringed in
  `--lectio-theme-danger` — the number of entries not yet read.

**A dot is a mark, not a number.** A 9px `--lectio-theme-danger` disc with a
white ring, gear, bottom-right corner. It says "something was recorded"; the
number arrives one click later on the summary chip, next to the entries it
counts.

Why the two are different shapes: a count belongs where its items are. The
gear can carry one legible number and the updates took it, because an update is
still waiting to be acted on and a two-digit count of them is plausible, so it
needs the prominent corner and the room. A problem has already happened, its
entries are one click away, and the gear only needs to say that there is
something to read. The corners were swapped to this arrangement in 1.29.0
(#50): before that the count sat bottom-right in an 11px box and was close to
unreadable.

Both can show at once. They sit in opposite corners so neither can cover the
other, and both are absolutely positioned with `pointer-events: none`, so
neither resizes the 44px gear nor takes a click away from it. One function,
`updateLauncherIndicators()`, owns both, because they share one button and one
accessible name.

## Two colours, two meanings

**Accent means there is something to install. Danger means something went
wrong.** Those are the only two meanings a Manager signal has. A third colour
would be a third meaning, and would need a rule here before it needed CSS.

**Meaning goes in the ring; legibility goes in the numeral** (#56). Each chip
first drew its numeral in its own ring colour, and measured across Lectio
Theming's 46 palettes that fell to 2.53:1 for the update chip and 2.46:1 for
the problem chip, against the 4.5:1 that 12px bold text needs. No palette is
designed to put accent or danger text on surface. So the ring — 2px of colour
nobody has to read — carries the meaning and still tells the two chips apart,
and the numeral is drawn in `--lectio-manager-chip-ink`: the theme's own text
colour, the one pairing every palette is built around
([ADR-0006](./adr/0006-css-custom-property-theming-seam.md)), pushed a little
further from the fill where a browser can do the arithmetic.
`tests/manager-chip-contrast.browser.test.js` walks every palette and fails if
that regresses.

The fill is surface rather than accent for the same family of reason: the gear
itself is accent-coloured, so an accent-filled chip would vanish into it, and
the text-on-surface inversion 1.24.0 guessed at is a pairing no theme designs
for. Accent ring on surface is the Manager's own outlined-control pairing, the
one its buttons already use.

## Colour is never the only channel

Every signal is a numeral, or is named in the accessible name of the control it
sits on, or both.

- The gear's `title` and `aria-label` are one string built from the same parts
  the marks are drawn from, joined with ` — `:
  `Lectio Tools — 1 problem recorded — 3 updates available`. With nothing to
  say it is just `Lectio Tools`. The sentences are `problemLogUnseen` and
  `updatesWaiting` from the string table, so both languages are covered.
- The summary chip carries its own sentence (`2 problems recorded`) as `title`
  and `aria-label`; the numeral inside it is language-neutral.

What this asks of a new signal: it must be a number the user can read, or a
sentence in the accessible name of the button it is attached to, in both
languages through the existing string table, before it is a colour. A colour
change on its own is not a signal. Neither is an animation; nothing on the
gear moves.

## A signal clears when the thing it points at is resolved

Not when the user has glanced at it, and never as a side effect of a click made
for some other reason.

**The update count is outstanding, not unseen.** It is simply
`availableUpdates().length` — every installed module on the selected channel
whose registered version is behind the catalogue, plus the Manager itself when
the catalogue's `manager` entry is ahead of `MANAGER_VERSION`. The only thing
that takes a module off it is that module arriving at a version the catalogue
no longer flags. Until 1.29.0 it subtracted a remembered signature of what the
panel had last been open in front of, so clicking the gear for settings or the
problem log put the badge out and it never came back for that same
un-installed update (#50). Looking at a list is not installing from it. The
key that remembered it, `lectioManager.updatesSeen.v1`, is retired and left
unread.

**The problem mark clears on reading.** A problem is a thing that has already
happened, so for it "resolved" is "read": expanding the **Problem log**
section is what clears the gear's dot and the summary's chip together, and
**Clear log** does the same. Opening the panel does not. Reading the count on a
collapsed summary does not. An entry recorded later marks the gear again.

The two clear on different events on purpose, and the rule for a new signal
follows from them: name the event that resolves the thing before adding the
signal. If the honest answer is "when they have looked at it", then the event
is the action that constitutes looking at *that thing* — opening its section,
not opening the panel it is in.

## What we deliberately do not signal

- **An error the Manager cannot attribute.** Uncaught errors and unhandled
  rejections that reach its window are recorded in the log with a redacted
  message but do not mark the gear, because a window error handler cannot tell
  whose script threw — Lectio's own included — and a permanent mark for
  somebody else's error is worse than no mark. Only entries with an owner count
  toward the dot: a module's own report, a request-slot notice filed under the
  module that held the slot, and the Manager's `catalogue-refresh` failure,
  which it files under `manager` because that one is its own.
- **Anything already read.** The dot and the summary chip count unread entries
  only; the log itself keeps up to 25.
- **An update for a module installed outside the selected channel.** Its card
  offers no update either.
- **Modules that are not installed.** The count covers installed modules only.
  The Manager lists what is available; it does not nag anyone to install more.
- **The Manager's own update as a separate signal.** It is one entry in the
  update count and a notice inside the panel, nothing more.
- **Which channel is selected.** Stable or Experimental is stated in the panel
  and never on the gear.
- **Storage.** The Storage section measures on demand when it is looked at;
  nothing watches the budget and nothing warns from the gear.
- **Success.** A refreshed catalogue, a copied report, a saved setting: at most
  a transient label inside the panel, never a mark outside it.
- **Anything a module wants to say.** A module's counts and states go on its
  own dock item through the dock contract, in the module's own words. The
  Manager never repeats a module's badge on the gear and never invents one for
  it — a signal about one module's feature would be feature-specific logic in
  the Manager ([ADR-0001](./adr/0001-manager-module-separation.md)).
- **Anything on the dock.** See above; the dock is the modules'.

A new signal has to pass all of these before it exists: it is the Manager's own
generic concern, not a module's; the person can act on it and the action has a
definite resolving event; it is a count (chip) or a mark (dot) in one of the two
colours; it is a numeral or named in an accessible name, in both languages; and
it fits on the gear or beside the thing it is about in the panel without going
near the dock. Anything that fails one of those is a line in the panel or an
entry in the problem log, not a badge.
