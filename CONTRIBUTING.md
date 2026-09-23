# Contributing

**This project accepts Issues, not pull requests.**

Ideas, bug reports and compatibility reports are wanted and welcome — they are how the project decides what to build next. Code from outside the project is not merged, and pull requests are closed unread. If you open one, an automated reply explains this and points you back here; nothing personal is meant by it, and it does not count against you.

- **[Report a bug](https://github.com/RktRobinhood/Lectio-Scripts/issues/new?template=bug-report.yml)**
- **[Suggest a feature or a module](https://github.com/RktRobinhood/Lectio-Scripts/issues/new?template=feature-maker-idea.yml)**
- **[Report a school where a module misbehaves](https://github.com/RktRobinhood/Lectio-Scripts/issues/new?template=school-compatibility.yml)**

---

## Why no pull requests

**Security.** These are userscripts. They run with broad access inside your authenticated Lectio session — your timetable, your messages, your grades, your school's pages — on the machines of students and teachers who installed them from this repository on trust. Merged code runs there too. A reviewer reading a friendly-looking diff is a thin defence against code written to survive exactly that reading, and the cost of getting it wrong once is not paid by the maintainer; it is paid by every person running the script. The project would rather forgo good contributions than accept that risk on other people's behalf. This is [ADR-0004](./docs/adr/0004-issues-only-no-external-prs.md), and it is not a judgement about any individual contributor.

**Time.** The project is maintained by one person, with AI agents as the working collaborators. Reviewing outside code to a standard that would actually catch a hostile diff is slower than writing the feature — so the review would either be honest and expensive, or cheap and worthless. Reading an Issue and building the thing is the better use of the same hour.

This follows the development model described by Swamp Club AI: the maintainer owns the code, users own the direction.

---

## What an Issue is worth

An Issue is not a lesser contribution here — it is the contribution. The project's modules exist because someone described a daily annoyance in Lectio well enough to build against. You do not need to write code, know JavaScript, or propose an implementation. Describe what you do, what Lectio does, and what you wish happened instead.

A good Issue carries:

- which module and `@version` (or the Manager's version), your browser and Tampermonkey version
- the kind of Lectio page, and your school if it seems specific to it
- exact steps to reproduce, what you expected, what actually happened

The full checklist is in the README under [Reporting bugs and ideas](./README.md#reporting-bugs-and-ideas).

> [!IMPORTANT]
> Issues are public. Redact screenshots and Console output before posting — no names, grades, messages, or anything else that identifies a student or teacher.

---

## If you want to change a script for yourself

Do. The licence permits it, and the README has a whole section on doing it safely with an LLM: [Make it yours with an LLM](./README.md#make-it-yours-with-an-llm). Keep an untouched copy, rename your version's `@name` so the Manager does not fight it, and read what an LLM hands you before you install it — the same reasoning that closes pull requests here applies to code an LLM writes for you.

If your change turns out to be generally useful, open an Issue describing what it does and why. Describe the behaviour, not the diff. If it fits the project, it gets built here.

---

## What is not built, however it arrives

Two kinds of request are declined on principle, whether they come as an Issue or as code:

- **Anything that acts for you without you.** A module may surface information, pre-fill a form, or link you to the right page. It must never submit, cancel, register or send on your behalf without your click, in that moment ([ADR-0009](./docs/adr/0009-human-in-the-loop-no-automated-consequential-actions.md)).
- **Anything that fabricates a record.** Auto-writing an absence excuse, auto-completing elevfeedback — anything that presents machine output as a person's own honest input ([ADR-0010](./docs/adr/0010-no-academic-dishonesty-features.md)).
