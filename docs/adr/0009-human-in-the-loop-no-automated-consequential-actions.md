# Scripts stay human-in-the-loop; no automating consequential Lectio actions

A script may make a consequential action on Lectio *easier to perform* — surfacing information, pre-filling a form, one-click-opening the right page — but must never *perform it automatically*, without an explicit, per-action click from the person it affects. "Consequential" means anything that writes state to Lectio a person didn't directly and knowingly trigger in that moment: cancelling or creating a lesson/activity, registering or editing attendance (fravær), submitting a message, grade, or feedback on someone's behalf, or any other write a school or a person would reasonably expect a human decided to make.

This applies regardless of how convenient the automation would be, and regardless of confidence the automated decision would usually be correct. The goal of this project is to make genuine use of Lectio easier, not to take over decisions that carry real consequences — for one person, or (since these scripts run identically across every install) for every school running them at once. A silent bug in a script that merely *displays* something wrong is an annoyance; a silent bug in a script that *acts* on attendance or cancellations across a whole userbase is a much larger, and much less reversible, kind of failure.

## Consequences

- No module may run a `__doPostBack`, form submission, or equivalent state-changing action against Lectio without that specific action being the direct result of an explicit click on that action, by the person it affects, in that moment. A `setInterval`/`MutationObserver`-driven background loop may look, but must not write.
- Chairs Up may *detect and surface* that a lesson is the last booking of the day in a room; it must not act on that (e.g. auto-release the room) itself.
- A future module may pre-fill or link directly to Lectio's own cancel/absence/feedback forms, but the final submission must still go through Lectio's own UI with the human pressing the button.
- Batch or scheduled ("run this every night") automation of anything on this list is out of scope for this project, not just an implementation detail to be careful with.
