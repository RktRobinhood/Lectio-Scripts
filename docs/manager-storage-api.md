# Lectio Manager storage API

`localStorage` for `lectio.dk` is roughly 5 MB and every module shares it. A
module that cannot write catches the failure and carries on in memory, which is
the right behaviour and is also why running out is invisible: the symptom is
"my settings keep resetting", and the cause is usually a different module.

The Manager shows what is using that allowance. It measures; it does not
interpret.

## Where the seam is

**The Manager works out for itself:** which keys exist in this origin's
`localStorage`, and how large each one is. That is true of any web page and
needs no knowledge of any module.

**The module declares:** which of those keys are its own, what each one is for,
and whether it is safe to throw away. A key name says nothing about whether it
holds a disposable cache or the only copy of a learned palette, so the Manager
never infers any of it and never deletes anything itself.

Concretely, the Manager:

- never holds a table of keys, module ids, or recognised prefixes;
- never parses, decodes or displays a stored **value** — names and sizes only;
- never calls `removeItem`. A prune is a request the owning module carries out.

A key no running module has claimed is listed under **Not claimed by a running
module**, with its name and size, and has no Clear button at all.

## Declaring your storage

Add an optional `storage` array to the Registration you already dispatch on
`lectio-module:register`. Everything else about Registration is unchanged, and
a module that declares nothing simply contributes nothing to the readout.

```javascript
window.dispatchEvent(new CustomEvent('lectio-module:register', {
  detail: {
    id: 'my-module',
    name: 'My Module',
    version: '1.2.0',
    settingsSchema: [],
    currentValues: {},
    storage: [
      {
        key: 'lectioMyModule.settings.v1',
        kind: 'setting',
        label: { en: 'Settings', da: 'Indstillinger' }
      },
      {
        prefix: 'lectioMyModule.rooms.v1.',
        kind: 'cache',
        prunable: true,
        label: { en: 'Harvested room list', da: 'Indsamlet lokaleliste' }
      }
    ]
  }
}));
```

| Field | Meaning |
|---|---|
| `key` | One exact `localStorage` key. |
| `prefix` | Every key that starts with this string — for per-school or per-week keys. |
| `kind` | `cache`, `setting`, or `state`. Rendered as a word; the Manager attaches no behaviour to it. |
| `area` | `page` (default) for `localStorage`, or `script` for `GM_setValue` storage. |
| `prunable` | `true` to offer a Clear button. Anything else means no button. |
| `label` | Optional prose: a string, or `{ en, da }`. Without one the key name is shown. |

Exactly one of `key` and `prefix` per entry; an entry carrying both or neither
is dropped, because what a prune would remove would be ambiguous. Up to 40
entries per module, each identifier up to 160 characters. A declared key that is
not currently written is not listed — there is nothing there to show or clear.

`area: 'script'` exists because **userscript storage is per-script and cannot be
enumerated from another script.** The Manager cannot see, size, or clear
`GM_getValue` data belonging to a different userscript. Declaring it anyway is
worth doing: it is listed under the module with no size and a note that it sits
outside the page's 5 MB, so its absence does not read as a module that stores
nothing. A `script` entry may still be `prunable` — the module does the
deleting, so it works exactly as well there.

## Pruning

The Manager renders a Clear button beside a `prunable` entry that currently has
something in it. It takes two clicks — the first turns the button into its own
confirmation — and on the second the Manager dispatches:

```javascript
window.addEventListener('lectio-manager:prune-storage', (event) => {
  const { id, key, prefix } = event.detail || {};
  if (id !== 'my-module') return;

  // Exactly one of key/prefix is set, and it is the same string you declared.
  if (prefix === 'lectioMyModule.rooms.v1.') dropHarvestedRooms();
});
```

The event echoes back the entry as declared: the same `key`, or the same
`prefix`, unmodified. It is one-way, and there is deliberately no fallback — if
nothing answers, nothing is deleted. The Manager re-reads sizes on the next tick
and shows whatever the module actually did, including nothing.

Only declare `prunable: true` for data the module can rebuild or genuinely does
not need. A settings blob, a learned translation cache that took a term to
build, or hand-picked colours are not prunable, whatever their key is called.

## Pruning your own stale entries

The readout is a diagnostic, not the mechanism. A module is still responsible
for dropping its own expired caches on load — an expiry that only runs when
something happens to look at a cache is an expiry that mostly does not run.

## Reporting a write that failed

Keep catching a failed write and carrying on in memory; that rule has not
changed. What is new is saying so, through the problem log
([`docs/manager-problem-log.md`](./manager-problem-log.md)):

```javascript
try {
  localStorage.setItem(key, JSON.stringify(value));
} catch (_) {
  window.dispatchEvent(new CustomEvent('lectio-module:report', {
    detail: { moduleId: 'my-module', kind: 'error', code: 'storage-write' }
  }));
}
```

A token, never the value that would not fit. With no Manager installed nothing
listens and nothing happens, which is the point.
