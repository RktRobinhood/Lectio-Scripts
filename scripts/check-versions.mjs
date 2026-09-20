#!/usr/bin/env node
/*
 * Version consistency guard.
 *
 * A module's version is written down in three places that have to agree, and a
 * fourth rule that has no single home: if the file changed, the number must have
 * moved. Missing any one of them produces the same silent symptom - the Manager
 * keeps offering the old number, so nobody is ever told an update exists. That
 * has now cost several rounds of "why am I not seeing the update", so it is
 * checked here instead of remembered.
 *
 *   node scripts/check-versions.mjs            # compare against origin/main
 *   node scripts/check-versions.mjs --base HEAD
 *   node scripts/check-versions.mjs --no-drift # skip the changed-but-not-bumped check
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const baseRef = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
const checkDrift = !args.includes('--no-drift');

const problems = [];
const notes = [];

// Git stores these files with LF and checks them out with CRLF, so a raw
// comparison marks every file as changed. Only the content difference matters.
const normalize = (text) => text.replace(/\r\n/g, '\n');

function atBase(path) {
    try {
        return execFileSync('git', ['show', `${baseRef}:${path}`], { encoding: 'utf8' });
    } catch {
        return null; // new file, nothing to compare against
    }
}

function headerVersion(source) {
    return source.match(/@version\s+(\S+)/)?.[1] ?? null;
}

// Modules declare themselves either as `const MODULE_VERSION = '…'` or inside a
// frozen MODULE object as `version: '…'`. Both are the number the module reports
// at registration, which is what the Manager compares against the catalogue.
function registeredVersion(source) {
    return source.match(/(?:MODULE_VERSION\s*=|version:)\s*'([\d][^']*)'/)?.[1] ?? null;
}

function moduleId(source) {
    return source.match(/(?:MODULE_ID\s*=\s*'|id:\s*')([a-z0-9-]+)'/)?.[1] ?? null;
}

function readCatalogue(path) {
    const entries = new Map();
    for (const entry of JSON.parse(readFileSync(path, 'utf8')).modules) {
        entries.set(entry.id, { version: entry.version, path });
    }
    return entries;
}

const catalogued = new Map([
    ...readCatalogue('catalogue/modules.json'),
    ...readCatalogue('modules-unstable/modules.json')
]);

const userscripts = [
    ...readdirSync('modules').map((name) => join('modules', name)),
    ...readdirSync('modules-unstable').map((name) => join('modules-unstable', name)),
    'manager/Lectio-Manager.user.js'
].filter((path) => path.endsWith('.user.js')).map((path) => path.replaceAll('\\', '/'));

const seen = new Set();

for (const path of userscripts) {
    const source = readFileSync(path, 'utf8');
    const header = headerVersion(source);
    const registered = registeredVersion(source);
    const isManager = path.startsWith('manager/');
    const id = isManager ? null : moduleId(source);

    if (!header) problems.push(`${path}: no @version in the userscript header`);

    // The Manager is not a module: it never registers itself, and it is not in
    // any catalogue. Tampermonkey's own update check is what ships it.
    if (!registered && !isManager) {
        problems.push(`${path}: could not find the version it reports at registration`);
    }

    if (header && registered && header !== registered) {
        problems.push(
            `${path}: @version is ${header} but it registers ${registered} - ` +
            `the Manager compares the registered number, so the header alone is not enough`
        );
    }

    if (!isManager) {
        if (!id) {
            problems.push(`${path}: could not find its module id`);
        } else {
            seen.add(id);
            const entry = catalogued.get(id);

            if (!entry) {
                problems.push(`${path}: '${id}' has no entry in either catalogue, so the Manager cannot offer it`);
            } else if (entry.version !== header) {
                problems.push(
                    `${path}: @version is ${header} but ${entry.path} says ${entry.version} - ` +
                    `the Manager reads the catalogue, so this is the number users are offered`
                );
            }
        }
    }

    if (checkDrift) {
        const before = atBase(path);

        if (before === null) {
            notes.push(`${path}: new since ${baseRef}, no drift check`);
        } else if (normalize(before) !== normalize(source) && headerVersion(before) === header) {
            problems.push(
                `${path}: changed since ${baseRef} but @version is still ${header} - ` +
                `bump it, or the Manager will never tell anyone there is an update`
            );
        }
    }
}

for (const [id, entry] of catalogued) {
    if (!seen.has(id)) {
        problems.push(`${entry.path}: lists '${id}', but no userscript declares that id`);
    }
}

for (const note of notes) console.log(`note: ${note}`);

if (problems.length) {
    console.error(`\n${problems.length} version problem(s):\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('');
    process.exit(1);
}

console.log(`Versions agree across headers, registrations, and catalogues (base: ${baseRef}).`);
