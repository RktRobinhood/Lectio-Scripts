# Scripts stay human-in-the-loop; no automating consequential Lectio actions

A script may make a consequential action on Lectio *easier to perform* — surfacing information, pre-filling a form, one-click-opening the right page — but must never *perform it automatically*, without an explicit, per-action click from the person it affects. "Consequential" means anything that writes state to Lectio a person didn't directly and knowingly trigger in that moment: cancelling or creating a lesson/activity, registering or editing attendance (fravær), submitting a message, grade, or feedback on someone's behalf, or any other write a school or a person would reasonably expect a human decided to make.

This applies regardless of how convenient the automation would be, and regardless of confidence the automated decision would usually be correct. The goal of this project is to make genuine use of Lectio easier, not to take over decisions that carry real consequences — for one person, or (since these scripts run identically across every install) for every school running them at once. A silent bug in a script that merely *displays* something wrong is an annoyance; a silent bug in a script that *acts* on attendance or cancellations across a whole userbase is a much larger, and much less reversible, kind of failure.

## Consequences

- No module may run a `__doPostBack`, form submission, or equivalent state-changing action against Lectio without that specific action being the direct result of an explicit click on that action, by the person it affects, in that moment. A `setInterval`/`MutationObserver`-driven background loop may look, but must not write.
- Chairs Up may *detect and surface* that a lesson is the last booking of the day in a room; it must not act on that (e.g. auto-release the room) itself.
- A future module may pre-fill or link directly to Lectio's own cancel/absence/feedback forms, but the final submission must still go through Lectio's own UI with the human pressing the button.
- Batch or scheduled ("run this every night") automation of anything on this list is out of scope for this project, not just an implementation detail to be careful with.

## Amendment (2026-10-07): one narrow exception, for copying a unit

The owner approved this exception for issue #74, with the reasoning: *"this is still human in the loop, but is a huge quality of life improvement."* A teacher copying last year's unit into this year's lessons is one decision, "put this unit into my class". Lectio makes it roughly twenty postbacks and some 180 clicks. Requiring a click per lesson keeps all of that busywork and adds no judgement, because the judgement is already made in the preview.

**Exception (Unit Copier only).** One click may confirm a batch of writes, but only when every write is listed in a preview the person has just reviewed, and the click runs exactly that list. Within that batch:

- **What a write may do:** only *add* teaching material that Lectio's own material picker offers the person, to a lesson the person is listed as teaching.
- **What a write must never do:** edit, move or delete existing content; touch attendance, grades, messages, feedback, lesson times or cancellations; or touch another person's lessons.
- **How the batch runs:** only in the open tab that started it, one write at a time. It stops at the first write it cannot confirm by re-reading the lesson, or that differs from the preview.
- **Retries:** no write is ever repeated. Each is recorded before it is sent, and a write whose outcome is unknown is shown to the person, never retried.
- **Removal:** removing copied material remains a manual action in Lectio's own UI.

Any other batch write, in this module or any other, needs its own ADR. Everything above this amendment still applies everywhere else, including to the rest of a Unit Copier module.

**Minimum bar before any version that writes reaches Experimental** (from the review on #74):

- **Preview:** frozen once shown. The click runs that list and nothing else.
- **Ownership:** each target is checked against the user's own `T` card. Co-taught lessons are skipped by default.
- **Each write:** a fresh GET before it, and a re-read after it comparing the lesson's content ids before and after.
- **Bookkeeping:** an intent record before each POST, and a cross-tab lock.
- **Pace:** one write at a time, a few seconds apart, with a hard cap per batch.
- **Defaults:** a dry run is the default, and writing is a separate setting that is off by default.
- **Undo and recovery:** a list of everything added, so it can be removed by hand. A patch version that disables writing is the kill switch.
