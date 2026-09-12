# Modules should be school-agnostic by default; single-school hardcoding is debt, not scope

The project's goal is to work at any Lectio school, not just the maintainer's own. Chairs Up and English Mode already do this — they derive the school id from `location.pathname` (or don't need one at all) rather than hardcoding it. Unread Message Notifications instead hardcodes `@match https://www.lectio.dk/lectio/223/*` and was written against one school's rendering, because that was the fastest way to ship it against the school actually available to test with. That restriction is accepted **debt to eventually fix**, not a deliberate scope boundary — it should not be read as precedent for future modules.

## Consequences

New modules must default to deriving the school id dynamically (as Chairs Up does), not hardcoding one school's number into `@match` or into scraping logic. Generalizing Unread Message Notifications later means both widening its `@match` and re-verifying its DOM-scraping assumptions hold at other schools — the catalogue's `status` field should reflect this if it's ever marked as school-limited more formally (e.g. a future `"status": "school-limited"` convention), but that's not decided here.
