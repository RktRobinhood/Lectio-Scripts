# Lectio Manager problem log

When something goes wrong today the user sees nothing: a module that throws on
start-up simply does not appear, and a module whose selectors stopped matching
does nothing at all, which looks exactly like "there was nothing to show".

The Manager keeps a small rolling log of what went wrong and turns it into one
block of text a person can paste into the bug-report form, instead of being
asked to open DevTools and redact a stack trace. The log lives in the Manager
because it is generic: it records what it is handed and knows nothing about what
any module does.

## Reporting from a module

One event, one direction, no reply. A module that fires it with no Manager
installed does nothing at all, which is the point — nothing listens, and nothing
in the module depends on anything listening.

```javascript
window.dispatchEvent(new CustomEvent('lectio-module:report', {
  detail: {
    moduleId: 'my-module',
    kind: 'drift',          // error | drift | notice
    code: 'lesson-blocks',  // a token, not a sentence
    found: 0
  }
}));
```

- `moduleId` — the same id the module registers with.
- `kind` — `error` for something that failed, `drift` for a selector that
  matched nothing, `notice` for anything else worth a line.
- `code` — **a token you wrote, never a string you read off the page.** It must
  match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (so it cannot contain a space) and is
  dropped entirely if it does not. Name what you looked for: `lesson-blocks`,
  `unread-count`, `room-links`.
- `found` — an optional count, `0`–`9999`. With `kind: 'drift'` the Manager
  renders the pair as "looked for `lesson-blocks`, found 0".

**There is no field for a message, and this is deliberate.** A parser usually
fails while holding the text it could not parse, so a free-text field is where a
student's name, a message subject or a hold would end up — in a log whose whole
purpose is to be pasted into a public repository. A module says *what* it looked
for and *how many* it found; the Manager supplies the page type and the time.

A selector that matched nothing tends to match nothing again on the next
mutation, so reporting drift from inside an observer is fine: an identical
report repeated bumps a counter rather than adding a row.

## What the Manager records by itself

- Uncaught errors and unhandled rejections that reach its window, with the error
  type and a redacted message.
- Its own catalogue-refresh failures.

## Redaction

Every free-text string that reaches the log is rewritten first. In order: web
addresses, Lectio paths and e-mail addresses are removed whole; `key=value`
pairs are removed; any run of three or more digits becomes `<id>`, keeping up to
three prefix letters (`HE80549259557` → `HE<id>`) while small counts survive;
a quoted span containing a space is taken to be a sentence rather than a
property name and becomes `<text>`; a run of two or more capitalised words —
what a person's name and a school's name both look like — becomes `<name>`; and
what is left is truncated.

Over-redaction is the intended failure mode. A log entry that is too vague costs
one round of questions on an issue; one that is too specific cannot be taken
back out of a public repository.

The page is identified by its type only (`SkemaNy.aspx`, or `other`), never by
its URL, and the school id is included because the issue templates ask for it. A
student id is not, and neither is a query string.

## Bounds and delivery

- 25 entries, each field truncated, repeats folded into a counter.
- Stored in the Manager's own `GM_setValue` storage, in that browser only.
- **Nothing is transmitted.** There is no code path from the log to the network.
  The only way anything leaves the browser is a person copying the previewed
  block and pasting it somewhere themselves.

## Where it appears

In the Manager's own settings panel, under **Problem log**, with the exact block
that will be copied shown above the copy button. The gear carries a small mark
while something reported by a module is waiting to be read; an uncaught error
the Manager cannot attribute to anything is recorded but does not mark the gear,
because it may well be Lectio's own.
