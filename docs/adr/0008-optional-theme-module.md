# The theme layer is an optional, self-contained module

Lectio Theming is implemented as an independent module rather than in the Manager or a shared stylesheet. It owns its storage, palette extraction, settings behavior, and complete CSS. The Manager only renders the module-supplied Settings Schema, as it does for every other module.

The module exposes its palette through `--lectio-theme-*` CSS custom properties with hard-coded fallbacks. Its selectors style Lectio surfaces but deliberately exclude the Manager's controls, so the Manager remains a stable control surface and other modules remain usable without the theme installed.

Palette import accepts a local image or a user-supplied HTTPS image or website URL. Local image pixels are sampled without uploading the file. Website imports inspect color literals in the document and a bounded set of linked HTTPS stylesheets. Network requests are anonymous, happen only after the user presses **Import**, and are capped at 8 MB per response. Arbitrary URL sources require Tampermonkey's `@connect *` permission; the README must explain that permission and its privacy implications.

## Consequences

- No module may depend on Lectio Theming, its variables, or its presence.
- Theme selectors should prefer known Lectio surfaces and establish a dark background whenever they override foreground text.
- Imported colors are source material, not a literal stylesheet: the module derives dark surfaces and checks accent contrast before applying them.
- New theme behavior and selectors belong in Lectio Theming, never in the Manager.
- If Lectio markup changes, the module should degrade to its root background and variables without blocking core Lectio behavior.
