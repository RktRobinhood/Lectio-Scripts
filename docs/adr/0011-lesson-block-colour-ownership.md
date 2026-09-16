# One owner per lesson block: subject colour wins, theme keeps the frame, another extension's colour is left alone

Three things want to paint the same `a.s2skemabrik` element: [Lectio Theming](../../modules/Lectio-Theming.user.js), [Subject Colours](../../modules/Lectio-Subject-Colours.user.js), and whichever third-party colouring extension a user already had installed (Lectio Farver, Lectio i farver, Lectio Colors++). Before this decision the last one to declare `!important` simply won, which is how Lectio Theming came to silently erase every per-subject colour those extensions assigned ([issue #1](https://github.com/RktRobinhood/Lectio-Scripts/issues/1)).

The block is therefore split by role rather than fought over:

- **The frame belongs to the theme.** Border, corner radius and shadow are Lectio Theming's, on every block, coloured or not.
- **The surface belongs to whoever is colouring by subject.** Lectio Theming's surface rule now carries `:not([style*="background"])`, so a block that already has an inline background keeps it. That is a marker no extension has to know about or opt into: writing the colour inline is what every one of them already does.
- **A block another extension has claimed is not touched at all.** Subject Colours skips any block that arrives carrying an inline background it did not write itself, and its own clean-up only ever removes its own paint. Two colouring extensions running at once leaves the older one visibly in charge, rather than producing a flicker or a half-coloured schedule.

## Why the fill is written inline

Subject Colours paints a filled block with inline `!important` declarations rather than from its own stylesheet. Lectio Theming colours links inside Lectio's content shell through a selector carrying `#masterContent`, and a lesson block *is* a link — no practical class-and-attribute selector out-ranks an id. An inline important declaration is the only author-level way to be sure the colour and its text land together, which matters because the two are chosen as a contrast-checked pair.

The edge stripe is the opposite case and stays in the stylesheet: nothing competes for `background-image` at that specificity, and leaving the surface alone is exactly what lets a striped block keep the themed glass underneath it.

## Consequences

- A module that colours lesson blocks must decide, explicitly, whether it is claiming the surface — and if it is, write it inline so Lectio Theming stands aside.
- Lectio Theming must never re-acquire the surface of a block that carries an inline background, including for future features.
- The `:not([style*="background"])` guard is a heuristic about a shared platform, not a contract with any particular extension. If an extension ever colours blocks through a stylesheet instead, it will lose to the theme again, and the fix then is a recognisable marker class rather than widening this guard.
- Neither module reads or depends on the other, per [ADR-0001](./0001-manager-module-separation.md) and [ADR-0006](./0006-css-custom-property-theming-seam.md). Subject Colours derives its palette from the `--lectio-theme-*` seam with its own fallbacks, so it composes with the theme without knowing whether one is installed.
