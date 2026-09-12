---
status: accepted — revisit if the project outgrows Tampermonkey
---

# Tampermonkey as the platform, not a custom browser extension

Modules and the Manager are distributed as Tampermonkey userscripts rather than as a purpose-built browser extension. This was a deliberate choice for install simplicity right now — a user needs only Tampermonkey plus one click per script, with no extension-store review process or per-browser packaging — not a belief that a dedicated extension is wrong forever.

## Consequences

Some things stay awkward as a result and are accepted rather than worked around: no true uninstall/disable API for the Manager to call (see the Manager/module separation ADR), a per-browser dance to reach Tampermonkey's own dashboard, and no background/service-worker execution when Lectio isn't open. If the project grows enough that these limits become the binding constraint, building a dedicated extension is the documented escape hatch — this ADR is what should get superseded, not silently worked around.
