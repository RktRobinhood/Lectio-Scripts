---
status: accepted
---

# Issues only — no external pull requests are merged

Contributions are accepted only as GitHub Issues (bug reports and ideas); external pull requests are not merged into `modules/` or `manager/`. Userscripts run with broad access inside an authenticated Lectio session (timetables, messages, personal data), so merging outside code would mean running code from contributors the maintainer can't vet, inside real students' and teachers' sessions. Issues let anyone influence the project's direction without ever letting their code run.

## Consequences

The maintainer (with AI agents) writes all code that ships. A contributor's Issue may describe a feature in detail, but implementing it is still the maintainer's/an agent's job, never a merge of supplied code.
