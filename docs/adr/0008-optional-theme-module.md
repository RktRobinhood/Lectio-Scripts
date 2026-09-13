# The theme layer is an optional, self-contained module

Lectio Theming is implemented as an independent module rather than in the Manager or a shared stylesheet. It owns its storage, palette extraction, settings behavior, and complete CSS. The Manager only renders the module-supplied Settings Schema, as it does for every other module.

The module exposes its palette through `--lectio-theme-*` CSS custom properties with hard-coded fallbacks. Other modules — the Manager and English Mode as of this update — read those same variables (with their own value as fallback) to recolor their own UI, per [ADR-0006](./0006-css-custom-property-theming-seam.md); this keeps every module usable, unchanged, without the theme installed, rather than the theme module reaching into their markup itself.

Palette import accepts a local image or a user-supplied HTTPS image or website URL. Local image pixels are sampled without uploading the file. Website imports inspect color literals in the document and a bounded set of linked HTTPS stylesheets. Network requests are anonymous, happen only after the user presses **Import**, and are capped at 8 MB per response. Arbitrary URL sources require Tampermonkey's `@connect *` permission; the README must explain that permission and its privacy implications.

## Consequences

- No module may depend on Lectio Theming, its variables, or its presence.
- Theme selectors should prefer known, verified Lectio surfaces (see the project's sample-pages verification approach) and always pair a background override with the matching text-color override, for either a light or a dark theme — the module ships 26 named light and dark schemes, not a single dark look.
- Imported colors are source material, not a literal stylesheet: the module derives accent hues from them and checks their contrast (against a light or dark base, per the user's own light/dark choice) before applying them — an import never bypasses the same contrast checks a named theme's own accent gets.
- New theme behavior and selectors belong in Lectio Theming, never in the Manager.
- If Lectio markup changes, the module should degrade to its root background and variables without blocking core Lectio behavior.
