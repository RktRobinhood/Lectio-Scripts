#!/usr/bin/env node
/*
 * String-table parity guard for the Manager.
 *
 * The Manager carries both of its languages inline (ADR-0013) as one TEXT
 * object with an `en` side and a `da` side. t() falls back to English for any
 * key the Danish side does not have, on purpose - a missing string should be
 * an English string rather than a blank control. The cost of that choice is
 * that the fallback is silent: a key added to one side and forgotten on the
 * other shows English to a Danish reader and nothing else ever says so.
 * Issue #21 audited the two tables by hand and found them in step; this keeps
 * them that way without anyone having to look.
 *
 *   node scripts/check-i18n.mjs
 *
 * Exits non-zero on a key present on one side and absent on the other, or
 * declared twice on the same side. Module settings schemas are not checked:
 * they are English-only plain strings today (issue #21), so there is no
 * second language there to compare against yet.
 */

import { readFileSync } from 'node:fs';

const path = 'manager/Lectio-Manager.user.js';
const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const start = source.indexOf('\n    const TEXT = {');
const end = source.indexOf('\n    };', start);

if (start < 0 || end < 0) {
    console.error(`${path}: could not find the TEXT string table`);
    process.exit(1);
}

const table = source.slice(start, end);
const enStart = table.indexOf('\n        en: {');
const daStart = table.indexOf('\n        da: {');

if (enStart < 0 || daStart < 0 || daStart < enStart) {
    console.error(`${path}: TEXT does not have an en side followed by a da side`);
    process.exit(1);
}

// Every key sits at exactly twelve spaces of indent; nested option maps such
// as alignVertical's { start, center, end } are inline and so never match.
const keysOf = (side) => [...side.matchAll(/^ {12}([A-Za-z0-9_]+):/gm)].map((match) => match[1]);

const en = keysOf(table.slice(enStart, daStart));
const da = keysOf(table.slice(daStart));

const problems = [];
const duplicates = (keys) => keys.filter((key, index) => keys.indexOf(key) !== index);

for (const key of en.filter((key) => !da.includes(key))) {
    problems.push(`'${key}' is in en but not in da - a Danish reader silently gets the English string`);
}
for (const key of da.filter((key) => !en.includes(key))) {
    problems.push(`'${key}' is in da but not in en - t() has nothing to fall back to`);
}
for (const key of duplicates(en)) problems.push(`'${key}' is declared twice in en`);
for (const key of duplicates(da)) problems.push(`'${key}' is declared twice in da`);

if (en.length === 0) {
    problems.push('no keys were read from the en side - the table shape has changed and this check saw nothing');
}

if (problems.length) {
    console.error(`${path}:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
}

console.log(`${path}: en and da agree on ${en.length} keys.`);
