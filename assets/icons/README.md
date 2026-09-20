# Dock icons

The Manager's shared dock draws its icons from these files. They are **not**
edited here by hand and they are **not** read at runtime.

## Where they come from

[Lucide](https://lucide.dev) v0.544.0, ISC licensed, fetched unmodified from
`https://unpkg.com/lucide-static@0.544.0/icons/<name>.svg`. Lucide is drawn on a
24x24 grid at stroke-width 2 with round caps and joins, which is exactly the
house style the dock wants, and it is maintained by people who draw icons for a
living. Earlier versions of the dock drew its icons by hand and it showed - a
palette whose paint dabs were three hollow rings the same colour as the outline,
a refresh arrow whose lower arc had its large-arc flag set and so swallowed the
upper one.

## How they reach the userscript

A userscript is a single file handed to Tampermonkey. There is no bundler and no
runtime fetch, so the geometry has to be inlined into
`manager/Lectio-Manager.user.js`. That inlining is generated:

```bash
node scripts/build-dock-icons.mjs          # rewrite the inlined block
node scripts/build-dock-icons.mjs --check  # fail if it has drifted
```

The script owns everything between the `BEGIN GENERATED ICONS` and
`END GENERATED ICONS` markers. Never edit those strings directly - change the
SVG, or the key-to-icon mapping in the script, and regenerate.

## Adding an icon

1. Download it into this directory from the URL above, unmodified.
2. Add a `key: 'lucide-name'` line to `MAP` in `scripts/build-dock-icons.mjs`.
3. Run the script and commit both the SVG and the regenerated Manager.

Modules ask for an icon by key (`icon: 'palette'`), never by Lucide name, so
which drawing a key resolves to stays the Manager's decision.

## Deliberate departures

Every shape is Lucide's byte for byte except where `OVERRIDES` in the build
script says otherwise, and each of those carries its reason in a comment:

- **palette** - Lucide sizes the paint dabs at `r=".5"`, a little over a third
  of a device pixel once the dock scales the icon to about 21px. They disappear
  and the palette reads as an empty blob, so they are enlarged to `r="1.15"`.
- **radar** - the sweep arm is wrapped in a group the dock's hover animation can
  rotate on its own, leaving the rings and dish arcs still.

## Licence

Lucide is ISC licensed. The upstream licence text travels with each file as the
`@license` comment Lucide ships in its SVGs; the full text is at
<https://github.com/lucide-icons/lucide/blob/main/LICENSE>.
