---
status: accepted
---

# Issues only — no external pull requests are merged

Contributions are accepted only as GitHub Issues (bug reports and ideas); external pull requests are not merged into `modules/` or `manager/`. Userscripts run with broad access inside an authenticated Lectio session (timetables, messages, personal data), so merging outside code would mean running code from contributors the maintainer can't vet, inside real students' and teachers' sessions. Issues let anyone influence the project's direction without ever letting their code run.

## Consequences

The maintainer (with AI agents) writes all code that ships. A contributor's Issue may describe a feature in detail, but implementing it is still the maintainer's/an agent's job, never a merge of supplied code.

GitHub has no setting that disables pull requests on a public repository, and forking cannot be turned off on one either, so the decision is enforced rather than merely announced: [`.github/workflows/decline-pull-requests.yml`](../../.github/workflows/decline-pull-requests.yml) answers any pull request not opened by the repository owner with the reason and closes it, within about a minute. It runs on `pull_request_target` so that a fork's pull request gets a token that can actually close it, which is only safe because the job never checks out or executes the pull request's code — that constraint is load-bearing, not incidental.

The policy is also stated where a person meets it, not only where an agent does: [CONTRIBUTING.md](../../CONTRIBUTING.md), the README's *Issues, not pull requests* section, and [`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md), which says so in the compose box before anyone spends effort on a diff. Turning code away has a cost in goodwill, so each of those gives the reasoning and points at Issues rather than simply refusing.
