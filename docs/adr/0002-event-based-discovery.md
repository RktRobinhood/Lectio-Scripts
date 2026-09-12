# Module discovery uses namespaced DOM events, not shared storage

The Manager needs to know which modules are currently installed and enabled. It could have read each module's own Tampermonkey storage directly, but that would mean the Manager depends on every module's private storage layout, and any module could read another's storage the same way. Instead, the Manager broadcasts a `lectio-manager:discover` `CustomEvent` on `window`, and each module listens for it and answers with `lectio-module:register`, carrying only its id, name, version, and settings schema.

## Consequences

A module that isn't currently running (disabled, or the page hasn't finished loading it yet) is indistinguishable from one that was never installed — the Manager has no fallback way to check. This is a known, accepted limitation (documented in the README), not a bug to fix by adding a storage-based check.
