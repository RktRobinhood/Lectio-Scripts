# Lectio Manager settings file

Everything a person configures lives in one browser's local storage and only
there. A new laptop, a reinstalled browser or cleared site data wipes it, and
there was no way to carry a setup from a work machine to a home one — or from
a teacher who spent an afternoon getting it right to a colleague who wants the
same thing.

The Manager's **Backup and sharing** section writes that setup to a JSON file
and reads one back. No module needed a line of new code for it, and the
Manager learned nothing about what any setting means.

## Where the seam is

**The Manager already renders settings it does not understand**, from each
module's Settings Schema, and already writes them through
`lectio-manager:set-setting`. Export and import are the same seam in both
directions:

- **Export** reads the `currentValues` a module reported at Registration, keeps
  only the keys its own `settingsSchema` declares a control for, and writes
  those.
- **Import** replays accepted values through `lectio-manager:set-setting` —
  the same event a hand-turned control fires. A module cannot tell the
  difference, which is the point.

The Manager branches on no module id and no setting key anywhere in this.

## What a file contains

```json
{
  "format": "lectio-manager-settings",
  "formatVersion": 1,
  "exportedAt": "2026-09-20T18:40:00.000Z",
  "managerVersion": "1.27.0",
  "manager": {
    "language": "en",
    "releaseChannel": "stable",
    "view": "installed",
    "sortMode": "category",
    "dock": { "version": 2, "order": [], "edge": "left", "align": "center",
              "sizeMode": "auto", "autoFit": true, "autoHide": false,
              "shellOpacity": 30, "itemOpacity": 60 }
  },
  "modules": {
    "subject-colours": {
      "name": "Subject Colours",
      "version": "0.9.1",
      "values": { "enabled": true, "style": "soft", "class:HE1234": "#8d6cab" }
    }
  }
}
```

`name` and `version` inside a module block are for the person reading the file.
Import reads neither: the module id is the only thing it matches on, and the
running module's own schema is the only authority on what its values may be.

### Included

- The Manager's own preferences: language, release channel, list view, sort
  order, and every dock preference.
- Per module id, the value of every control its Settings Schema declares —
  toggle, select, range, text and colour.

### Not included, and why

| Not carried | Why |
| --- | --- |
| A `button` control | An action, not a value. Replaying one would *run* something on import rather than restore anything. |
| Anything in `currentValues` with no control behind it | It is not a setting the Manager renders, so it is not a setting the Manager moves. This is what keeps a module's learned data and private tokens out of a file people share. |
| Theming's background picture | A multi-megabyte data URL in `localStorage`, never reported at Registration. The section says so rather than producing a restore that looks wrong for an unexplained reason. |
| Learned caches, room maps, scanned weeks | Same reason: browser storage the Manager can *measure* (see [manager-storage-api.md](./manager-storage-api.md)) but has never been told the meaning of. Nothing from the storage readout reaches a settings file. |
| The problem log | A redacted diagnostic about this browser, with its own copy button and its own warning. It is not configuration and has no business travelling with one. |
| Catalogue caches, the installed registry, "seen" markers | Manager bookkeeping. Restoring it on another machine would describe that machine wrongly. |
| Anything from Lectio itself, and any credential | Never read in the first place. |

A file can still name your school through a setting you chose, and it carries
the choices you made, so the section says plainly: this is yours, read it
before you share it.

**A module only reports where it runs.** Export carries the modules that
registered on the page it was taken from. Save from a page your modules
actually run on — the front page is usually the right one.

## Importing

Nothing is applied by choosing a file. The steps are separate on purpose:

1. **Choose a file, or paste one.** Either way the text lands in a box, in
   front of the person, as text.
2. **Check this file.** The file is parsed and read field by field, and a
   *plan* is built: what would be applied, and how much would be skipped. The
   review names each module and the Manager preferences the file would change.
   Nothing has changed yet.
3. **Apply these settings.** The plan is replayed. Because the whole file was
   validated before this point, a value further down turning out to be
   nonsense cannot leave the import half-done.

Afterwards the Manager asks for Discovery again and reports how many of the
planned values the modules actually hold, rather than claiming success from
having dispatched an event.

### What is refused, and what is skipped

Refused whole, with nothing applied:

- text that is not JSON, or JSON that is not an object;
- a missing or wrong `format` stamp — it was not written by this Manager;
- a `formatVersion` newer than this Manager reads. Fields it would read
  wrongly are worse than fields it does not read at all;
- anything far larger than a settings file.

Skipped quietly, counted, and shown in the review:

- a module id that is not running here;
- a key with no control in that module's current schema;
- a value of the wrong type for its control, outside a range control's
  `min`/`max`, or a select option the module no longer offers;
- a colour that is not `#rrggbb`.

That list is also the whole answer to version skew between the file and what
is installed: a file is data, and the live schema is the authority. A control
that has since changed type or disappeared is skipped by the same rule that
skips a hostile value, so a file from an older or newer Manager imports
whatever still makes sense and says what it left behind.

### An imported file is untrusted input

It is parsed inside an authenticated Lectio session, whoever handed it over.

- Nothing in a file is ever `eval`'d, and no part of the Manager downloads or
  runs code (see the boundary comment at the top of the Manager).
- Nothing from a file is ever assigned as markup. The review is built node by
  node and every string from the file — a module id most of all — goes in as
  `textContent`.
- Values are checked against the live schema before the plan exists, so a file
  cannot put a module into a state it does not offer.
- The number of modules, the number of keys, and the length of any text value
  are all bounded.
