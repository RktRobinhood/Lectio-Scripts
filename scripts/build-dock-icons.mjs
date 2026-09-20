#!/usr/bin/env node
/*
 * Builds the Manager's dock icon map from the Lucide SVGs in assets/icons/.
 *
 * The dock icons used to be drawn by hand, and it showed: a palette whose paint
 * dabs were three hollow rings, a refresh arrow whose lower arc swept the wrong
 * way. Redrawing them by hand again would only move the problem, so the shapes
 * now come from Lucide - a maintained, ISC-licensed set drawn on the same 24
 * grid at the same stroke weight - and this script inlines them.
 *
 * The userscript cannot read assets/ at runtime: it is one file served to
 * Tampermonkey, with no network fetch and no bundler. So the geometry is
 * inlined into the Manager between markers, and this script owns that block.
 *
 *   node scripts/build-dock-icons.mjs           # rewrite the block
 *   node scripts/build-dock-icons.mjs --check   # fail if it is out of date
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ICON_DIR = 'assets/icons';
const TARGET = 'manager/Lectio-Manager.user.js';
const BEGIN = '        // --- BEGIN GENERATED ICONS (node scripts/build-dock-icons.mjs) ---';
const END = '        // --- END GENERATED ICONS ---';

// Dock icon key -> Lucide icon name. A module asks for the key; which drawing
// that key resolves to is the Manager's business, not the module's.
const MAP = {
    mail: 'mail',
    translate: 'languages',
    chair: 'armchair',
    refresh: 'refresh-cw',
    settings: 'settings-2',
    calendar: 'calendar',
    warning: 'triangle-alert',
    info: 'info',
    bell: 'bell',
    wrench: 'wrench',
    palette: 'palette',
    radar: 'radar',
    default: 'circle-dot'
};

/*
 * Deliberate departures from the upstream drawing, each with a reason. Anything
 * not listed here is Lucide's geometry byte for byte.
 */
const OVERRIDES = {
    // Lucide sizes the paint dabs at r=.5, which is a little over a third of a
    // device pixel once the dock scales the icon to ~21px - they vanish, and the
    // palette reads as an empty blob. Nothing else about the drawing changes.
    palette: (shapes) => shapes.replaceAll('r=".5"', 'r="1.15"'),

};

function shapesFor(name) {
    const source = readFileSync(join(ICON_DIR, `${name}.svg`), 'utf8');
    const body = source.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1];

    if (!body) throw new Error(`${name}.svg: could not find an <svg> body`);

    const shapes = body
        .replace(/\s*\/>/g, '/>')        // <path … /> -> <path …/>
        .replace(/\s+/g, ' ')            // Lucide pretty-prints one attribute per line
        .replace(/>\s+</g, '><')
        .trim();

    if (!shapes.startsWith('<')) throw new Error(`${name}.svg: unexpected body`);

    const override = OVERRIDES[name === MAP[name] ? name : Object.keys(MAP).find((k) => MAP[k] === name)];
    return override ? override(shapes) : shapes;
}

const lines = Object.entries(MAP).map(([key, name]) => {
    const shapes = shapesFor(name);
    if (shapes.includes("'")) throw new Error(`${name}.svg: shape data contains a single quote`);
    return `            ${key}: '${shapes}', // lucide/${name}`;
});

const block = [BEGIN, ...lines, END].join('\n');

const current = readFileSync(TARGET, 'utf8');
const eol = current.includes('\r\n') ? '\r\n' : '\n';
const pattern = new RegExp(
    `${BEGIN.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}`
);

if (!pattern.test(current.replace(/\r\n/g, '\n'))) {
    console.error(`${TARGET}: could not find the generated icon markers`);
    process.exit(1);
}

const next = current
    .replace(/\r\n/g, '\n')
    .replace(pattern, block)
    .replaceAll('\n', eol);

if (process.argv.includes('--check')) {
    if (next !== current) {
        console.error(
            `${TARGET}: the inlined dock icons do not match ${ICON_DIR}/.\n` +
            '  Run: node scripts/build-dock-icons.mjs'
        );
        process.exit(1);
    }
    console.log(`Dock icons match ${ICON_DIR}/.`);
} else {
    writeFileSync(TARGET, next);
    console.log(`Inlined ${lines.length} icons from ${ICON_DIR}/ into ${TARGET}.`);
}
