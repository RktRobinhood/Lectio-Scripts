#!/usr/bin/env node
/*
 * String-table parity guard.
 *
 * Every script here carries both of its languages inline (ADR-0013), and in
 * every case a string missing on one side fails silently: the Manager's t()
 * falls back to English on purpose, and a module's labels() simply hands the
 * Manager `undefined`, which renders as the control's key. A key added to one
 * side and forgotten on the other therefore shows a Danish reader English - or
 * a bare identifier - and nothing else ever says so. Issue #21 audited the
 * Manager's two tables by hand and found them in step; issue #60 gave every
 * module a pair of its own. This keeps all of them in step without anyone
 * having to look.
 *
 *   node scripts/check-i18n.mjs
 *
 * Two shapes are checked.
 *
 * THE MANAGER: one TEXT object with an `en` side and a `da` side, every key
 * at twelve spaces of indent. Nested option maps such as alignVertical's
 * { start, center, end } are inline and so never match.
 *
 * THE MODULES (and the skeleton in templates/): each pair of language
 * literals is marked, so this script can find it without parsing JavaScript:
 *
 *     return language.startsWith('en')
 *         // i18n:en
 *         ? {
 *             sectionMain: 'Skeleton',
 *             sizes: { small: 'Small', large: 'Large' },
 *             ...
 *         }
 *         // i18n:da
 *         : {
 *             sectionMain: 'Skabelon',
 *             sizes: { small: 'Lille', large: 'Stor' },
 *             ...
 *         };
 *         // i18n:end
 *
 * The rule is small: the line after a marker opens the literal and is skipped
 * (so `? {`, `: {`, `en: {` and `da: {` all work); every line after that up
 * to the next marker that reads `<key>:` at the start is a key, and its depth
 * is its indent relative to the shallowest key in the block. The two sides
 * must name the same keys at every depth. A nested literal written on one
 * line (`sizes: { small: 'Small' }`) counts as one key, `sizes`, so put a
 * nested object on its own lines if you want its keys compared too. Only
 * display strings belong between the markers - never a key, a type, a default
 * or an option value - so a difference here is always a wording gap.
 *
 * A file may carry several marked pairs, and a file with none is reported
 * and passes: translating a module is optional (ADR-0013), and a module that
 * has not been translated is not broken. A file with a marker but not the
 * other two is a broken pair and fails.
 *
 * Exits non-zero on a key present on one side and absent on the other, on a
 * key declared twice on the same side, or on a marked pair this script cannot
 * read.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const problems = [];
const notes = [];

const normalise = (text) => text.replace(/\r\n/g, '\n');
const duplicates = (keys) => keys.filter((key, index) => keys.indexOf(key) !== index);

function compareSides(where, en, da) {
    for (const key of en.filter((key) => !da.includes(key))) {
        problems.push(`${where}: '${key}' is in en but not in da - a Danish reader silently gets the English string`);
    }
    for (const key of da.filter((key) => !en.includes(key))) {
        problems.push(`${where}: '${key}' is in da but not in en - there is nothing to fall back to`);
    }
    for (const key of duplicates(en)) problems.push(`${where}: '${key}' is declared twice in en`);
    for (const key of duplicates(da)) problems.push(`${where}: '${key}' is declared twice in da`);
}

/* ------------------------------------------------------------------ *
 * The Manager's TEXT table.
 * ------------------------------------------------------------------ */

function checkManager() {
    const path = 'manager/Lectio-Manager.user.js';
    const source = normalise(readFileSync(path, 'utf8'));

    const start = source.indexOf('\n    const TEXT = {');
    const end = source.indexOf('\n    };', start);

    if (start < 0 || end < 0) {
        problems.push(`${path}: could not find the TEXT string table`);
        return;
    }

    const table = source.slice(start, end);
    const enStart = table.indexOf('\n        en: {');
    const daStart = table.indexOf('\n        da: {');

    if (enStart < 0 || daStart < 0 || daStart < enStart) {
        problems.push(`${path}: TEXT does not have an en side followed by a da side`);
        return;
    }

    const keysOf = (side) => [...side.matchAll(/^ {12}([A-Za-z0-9_]+):/gm)].map((match) => match[1]);
    const en = keysOf(table.slice(enStart, daStart));
    const da = keysOf(table.slice(daStart));

    if (en.length === 0) {
        problems.push(`${path}: no keys were read from the en side - the table shape has changed and this check saw nothing`);
        return;
    }

    compareSides(`${path} TEXT`, en, da);
    notes.push(`${path}: en and da agree on ${en.length} keys.`);
}

/* ------------------------------------------------------------------ *
 * Marked pairs in every other userscript.
 * ------------------------------------------------------------------ */

const MARKER = /^\s*\/\/\s*i18n:(en|da|end)\s*$/;

// Keys as "<depth>/<name>", depth relative to the shallowest key in the block,
// so a nested literal's keys are compared with the other side's nested keys
// and never mistaken for top-level ones.
function keysOfBlock(lines) {
    const found = [];
    for (const line of lines) {
        const match = line.match(/^(\s*)([A-Za-z0-9_]+):\s/);
        if (match) found.push({ indent: match[1].length, key: match[2] });
    }
    if (!found.length) return [];
    const shallowest = Math.min(...found.map((entry) => entry.indent));
    return found.map((entry) => `${entry.indent - shallowest}/${entry.key}`);
}

function checkMarkedPairs(path) {
    const lines = normalise(readFileSync(path, 'utf8')).split('\n');
    let pairs = 0;
    let index = 0;

    while (index < lines.length) {
        const marker = lines[index].match(MARKER);
        index += 1;
        if (!marker) continue;

        if (marker[1] !== 'en') {
            problems.push(`${path}:${index}: an i18n:${marker[1]} marker with no i18n:en before it`);
            continue;
        }

        const enLine = index;
        const en = [];
        const da = [];
        let side = en;
        let seenDa = false;
        let closed = false;

        // The line after each marker opens the literal; skip it.
        index += 1;

        while (index < lines.length) {
            const next = lines[index].match(MARKER);
            index += 1;

            if (!next) {
                side.push(lines[index - 1]);
                continue;
            }
            if (next[1] === 'da' && !seenDa) {
                seenDa = true;
                side = da;
                index += 1; // the line that opens the Danish literal
                continue;
            }
            if (next[1] === 'end' && seenDa) {
                closed = true;
                break;
            }
            problems.push(`${path}:${index}: unexpected i18n:${next[1]} inside the pair that opened at line ${enLine}`);
            closed = true;
            break;
        }

        if (!seenDa || !closed) {
            problems.push(`${path}:${enLine}: the i18n:en marker here is not followed by i18n:da and i18n:end`);
            continue;
        }

        const enKeys = keysOfBlock(en);
        const daKeys = keysOfBlock(da);

        if (!enKeys.length) {
            problems.push(`${path}:${enLine}: no keys were read from the en side of this pair - the shape has changed and this check saw nothing`);
            continue;
        }

        pairs += 1;
        const before = problems.length;
        compareSides(`${path}:${enLine}`, enKeys, daKeys);
        if (problems.length === before) {
            notes.push(`${path}:${enLine}: en and da agree on ${enKeys.length} keys.`);
        }
    }

    if (pairs === 0) {
        notes.push(`${path}: no marked language pair (translating a module is optional).`);
    }
}

checkManager();

for (const directory of ['modules', 'modules-unstable', 'templates']) {
    for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.user.js')).sort()) {
        checkMarkedPairs(join(directory, name).replace(/\\/g, '/'));
    }
}

for (const note of notes) console.log(note);

if (problems.length) {
    console.error('');
    for (const problem of problems) console.error(problem);
    process.exit(1);
}
