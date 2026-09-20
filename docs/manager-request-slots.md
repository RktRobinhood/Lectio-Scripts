# Lectio Manager request slots

Four modules fetch Lectio pages in the background. Each one already damps its
own rhythm — a hard timeout, an abort on `pagehide`, a backoff after repeated
failures, a small random offset on the first poll — but nothing staggers them
*against each other*. On one poll interval a browser with several installed
fires a burst at the school's server from every script at once, and no module
can fix that alone, because a module may not know the others exist.

So the Manager hands out turns. A module about to do background work asks for a
slot; the Manager grants one at a time.

**The Manager knows nothing about what is being fetched, why, or whether
anything is being fetched at all.** A slot is a turn. Both fields on every
event are opaque strings it only ever compares and echoes back. If this ever
needed to know which module was asking, or what for, it would be the wrong
design ([ADR-0001](./adr/0001-manager-module-separation.md)).

This is optional on both sides. A module that never asks for a slot is not
affected by any of it, and a module that asks loses nothing when nobody
answers.

## The contract

Four events, one namespace, the same two fields on every one of them.

| Event | Direction | Meaning |
|---|---|---|
| `lectio-manager:slot:request` | module → Manager | I am about to do background work. |
| `lectio-manager:slot:wait` | Manager → module | Heard you. You are behind somebody else. |
| `lectio-manager:slot:grant` | Manager → module | Go now. |
| `lectio-manager:slot:release` | module → Manager | Done — or gone ahead without you. |

```javascript
window.dispatchEvent(new CustomEvent('lectio-manager:slot:request', {
  detail: { moduleId: 'my-module', requestId: 'r7' }
}));
```

- `moduleId` — the same id the module registers with.
- `requestId` — any token the module made up, unique among *its own* requests
  on this page. A counter is enough.

Both must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`, up to 64 characters — the same
token rule as a problem-log code, for the same reason and one more: `:` is the
Manager's compound-key separator. A request the Manager cannot name is one it
never answers, so the module falls through to its own timer and goes ahead.

The Manager answers **inside the dispatch**, synchronously, with either a
`wait` or a `grant`. That is what makes "nothing came back" a reliable signal
rather than a guess.

## Asking for one — and never waiting on it

The module's own clock is the authority. Nothing the Manager sends can make a
module wait longer than the module decided to wait.

```javascript
const SLOT_ANSWER_MS = 1200;   // no answer at all by now: there is no Manager
const SLOT_MAX_WAIT_MS = 8000; // acknowledged, but this page's ceiling anyway

async function fetchInBackground(url) {
  // Before the request's own timeout is armed, so a turn spent waiting is
  // not spent out of the time the request itself is allowed.
  const releaseSlot = await takeManagerSlot();
  if (pageIsGoingAway) { releaseSlot(); throw new Error('the page stopped'); }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { credentials: 'include', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    releaseSlot();
  }
}
```

`takeManagerSlot()` resolves with the function that gives the turn back, and
**resolves either way**: on a grant, or on the module's own timer. It has no
rejection path and no path that never settles. Each of the four modules carries
its own copy of about forty lines — there is no shared runtime code between
modules, and there is not going to be
([ADR-0001](./adr/0001-manager-module-separation.md)).

Four rules make it work:

1. **No answer within `SLOT_ANSWER_MS` → go.** No Manager installed, an old
   Manager that has never heard of slots, and a Manager that has stopped
   answering are the same case, and all three cost one short pause.
2. **That pause is paid once, not once per request.** A module remembers that
   its last request went unanswered and stops waiting for the next one — a room
   discovery pass is dozens of requests, and paying the window for each of them
   would turn "proceeds immediately" into a minute and a half of nothing. Any
   answer clears the flag again, so a Manager evaluated *after* the module, or
   one that comes back, is picked up on the very next request rather than
   ignored for the life of the page. The unwaited request is still sent, which
   is what gives a late Manager something to answer.
3. **A `wait` buys more time, up to a ceiling the module sets.** A live Manager
   is holding the request behind somebody else, which is worth waiting for. Only
   the *first* `wait` extends anything, so a Manager repeating itself cannot
   keep pushing the ceiling out. Past the ceiling the work goes ahead anyway.
4. **Always release, including after going ahead without a grant.** A release
   for a request still in the queue takes it out of the queue. A grant that
   arrives for work that has already finished is handed straight back, or the
   Manager holds a turn for nobody until its lease runs out.

Nothing may outlive its page. On `pagehide` a module resolves every waiter it
has left — so no promise is dangling and no timer is pending — and releases
every request. Because a resolved waiter goes on to start a fetch, the fetch
path re-checks the module's own suspended flag immediately after the await and
bails if the page has stopped.

**A slot a module gave up on is not a failure.** It is not a fetch error, it
does not feed a backoff, and it must not be mistaken for an empty result — a
request that never ran leaves the module's state exactly as it was.

## What the Manager does with it

- **One at a time.** The burst is what hurts, not the requests.
- **A lease, not a promise.** A granted slot not released within 30 seconds is
  reclaimed and the queue moves on. That is comfortably longer than the longest
  fetch timeout any module sets (20s), so reaching it means the work really has
  hung. A Manager that granted a slot to a module that then died does not wedge.
- **A full queue grants rather than refuses.** Past 24 waiting requests the next
  one is granted immediately. A queue that long is the Manager's problem, and
  making somebody wait for the Manager's own mess is the one thing this must
  never do.
- **Nothing is persisted.** Holders and queue live in memory for one page view
  and go with the page.

## What reaches the problem log

Two lines, both through the ordinary
[problem log](./manager-problem-log.md), both carrying a module id and a token
and nothing else:

| Code | When |
|---|---|
| `slot-reclaimed` | A slot came back on its lease instead of from the module. |
| `slot-queue-full` | A request arrived with the queue already full, and was granted anyway. |

A repeat folds into a counter there, so a module whose background work keeps
hanging shows up as one row with a number on it — which is what that log is
for. Neither line is an error the user has to act on; both are `notice`.

## Why not something simpler

- **Why not have the Manager do the fetching?** It would have to know what a
  module wants and what to do with the answer. That is feature logic in the
  Manager, which is the thing ADR-0001 exists to prevent.
- **Why an acknowledgement rather than just a timeout?** Without one, "no
  answer yet" cannot be told from "no Manager", so the wait would have to be
  either short enough to be useless as a queue or long enough to punish every
  install that has no Manager. The `wait` is what separates the two.
- **Why does the module ignore the Manager's own numbers?** Because then there
  is exactly one way a module can be made to wait longer: a bug in the module.
