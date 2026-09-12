# Modules stay self-styled; theming is an optional override seam, not a dependency

Modules must keep their own complete CSS and look correct installed entirely alone (per the module-separation ADR) — no module may depend on a shared stylesheet or the Manager for its visual identity. At the same time, school- or class-level branding was raised as a plausible future direction worth keeping open. The chosen seam, for new modules going forward, is to expose each module's key colors as CSS custom properties with hard-coded fallback values, so an optional future theme layer could override those properties without any module depending on it being present.

## Consequences

This is a convention for new modules to adopt, not a requirement to retrofit onto the three existing modules today. No central theme layer is being built as part of this decision — only the seam is being kept open. A future ADR should record the actual theme-layer design if and when one is built.
