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
    return source.match(/(?:MANAGER_VERSION\s*=|MODULE_VERSION\s*=|version:)\s*'([\d][^']*)'/)?.[1] ?? null;
}

function moduleId(source) {
    return source.match(/(?:MODULE_ID\s*=\s*'|id:\s*')([a-z0-9-]+)'/)?.[1] ?? null;
}

/*
 * `changelog` is optional prose about the version in the same entry, shown by
 * the Manager under the update row. The Manager ignores one that is not a
 * usable string, which is the safe thing for it to do and the wrong thing to
 * find out about later: the line just never appears. Wrong shape is caught
 * here instead, where it is a failing check rather than a silent omission.
 */
function checkChangelog(path, entry) {
    for (const [where, value] of [
        [`'${entry.id}'`, entry.changelog],
        ...Object.entries(entry.i18n ?? {}).map(([code, fields]) => [`'${entry.id}' (${code})`, fields?.changelog])
    ]) {
        if (value === undefined) continue;

        if (typeof value !== 'string' || !value.trim()) {
            problems.push(`${path}: ${where} has a changelog that is not a non-empty string - the Manager will ignore it`);
        }
    }
}

function readCatalogue(path) {
    const entries = new Map();
    for (const entry of JSON.parse(readFileSync(path, 'utf8')).modules) {
        checkChangelog(path, entry);
        entries.set(entry.id, { version: entry.version, path });
    }
    return entries;
}

/*
 * The two catalogues are kept apart, not merged. Under ADR-0014 a module being
 * worked on exists twice - a frozen copy in modules/ at the version stable users
 * have, and the live one in modules-unstable/ one or more bumps ahead - and both
 * files declare the same id. Merging them into one map meant the unstable entry
 * won for both files, so the frozen stable copy was reported as lagging its own
 * catalogue the moment work started on it. Each file is checked against the
 * catalogue for the folder it lives in.
 */
const stableCatalogue = readCatalogue('catalogue/modules.json');
const unstableCatalogue = readCatalogue('modules-unstable/modules.json');
const catalogueFor = (path) => (path.startsWith('modules-unstable/') ? unstableCatalogue : stableCatalogue);

// The Manager's own entry, which drives its self-update notice. A stale one here
// fails silently: the notice simply never appears, and the Manager goes on
// looking current forever.
const managerEntry = JSON.parse(readFileSync('catalogue/modules.json', 'utf8')).manager ?? null;

const userscripts = [
    ...readdirSync('modules').map((name) => join('modules', name)),
    ...readdirSync('modules-unstable').map((name) => join('modules-unstable', name)),
    'manager/Lectio-Manager.user.js'
].filter((path) => path.endsWith('.user.js')).map((path) => path.replaceAll('\\', '/'));

// Which ids a userscript actually declares, per channel. An entry whose file is
// gone - a promotion that removed the file but left the overlay entry behind -
// advertises an installUrl that 404s, and the id still existing in the other
// channel must not cover for it.
const seen = { 'catalogue/modules.json': new Set(), 'modules-unstable/modules.json': new Set() };

// "1.9.10" is ahead of "1.9.9", which a string comparison gets backwards.
function isAhead(version, other) {
    const parts = (value) => String(value).split('.').map((part) => Number(part) || 0);
    const [a, b] = [parts(version), parts(other)];

    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
    }
    return false;
}

for (const path of userscripts) {
    const source = readFileSync(path, 'utf8');
    const header = headerVersion(source);
    const registered = registeredVersion(source);
    const isManager = path.startsWith('manager/');
    const id = isManager ? null : moduleId(source);

    if (!header) problems.push(`${path}: no @version in the userscript header`);

    if (!registered) {
        problems.push(
            isManager
                ? `${path}: could not find its MANAGER_VERSION constant`
                : `${path}: could not find the version it reports at registration`
        );
    }

    if (header && registered && header !== registered) {
        problems.push(
            `${path}: @version is ${header} but it registers ${registered} - ` +
            `the Manager compares the registered number, so the header alone is not enough`
        );
    }

    if (isManager) {
        if (!managerEntry) {
            problems.push(
                'catalogue/modules.json: has no "manager" entry, so the Manager can never ' +
                'tell anyone it is out of date'
            );
        } else if (managerEntry.version !== header) {
            problems.push(
                `${path}: @version is ${header} but catalogue/modules.json's manager entry says ` +
                `${managerEntry.version} - the self-update notice compares against that entry`
            );
        }
    } else {
        if (!id) {
            problems.push(`${path}: could not find its module id`);
        } else {
            seen[path.startsWith('modules-unstable/') ? 'modules-unstable/modules.json' : 'catalogue/modules.json'].add(id);
            const catalogue = catalogueFor(path);
            const entry = catalogue.get(id);

            if (!entry) {
                problems.push(
                    `${path}: '${id}' has no entry in ${path.startsWith('modules-unstable/') ? 'modules-unstable/modules.json' : 'catalogue/modules.json'}, ` +
                    `so the Manager cannot offer it on that channel`
                );
            } else if (entry.version !== header) {
                problems.push(
                    `${path}: @version is ${header} but ${entry.path} says ${entry.version} - ` +
                    `the Manager reads the catalogue, so this is the number users are offered`
                );
            }

            // A module under test is ahead of the copy stable users have, or the
            // Manager offers the tester a downgrade and the work reaches nobody.
            if (path.startsWith('modules-unstable/')) {
                const stable = stableCatalogue.get(id);

                if (stable && !isAhead(header, stable.version)) {
                    problems.push(
                        `${path}: is ${header} but stable ships ${stable.version} - ` +
                        `an unstable copy has to be ahead of stable, or nobody is offered it`
                    );
                }
            }

            /*
             * Tampermonkey follows these, not the catalogue, once a script is
             * installed. A copy carrying the other folder's URLs updates itself
             * across channels behind the user's back - and after a promotion
             * deletes the unstable file, points at a 404 forever.
             */
            const folder = path.slice(0, path.indexOf('/'));
            for (const key of ['updateURL', 'downloadURL']) {
                const url = source.match(new RegExp(`@${key}\\s+(\\S+)`))?.[1];

                if (url && !url.includes(`/${folder}/`)) {
                    problems.push(`${path}: @${key} points outside ${folder}/ (${url})`);
                }
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

for (const [id, entry] of [...stableCatalogue, ...unstableCatalogue]) {
    if (!seen[entry.path].has(id)) {
        problems.push(`${entry.path}: lists '${id}', but no userscript in that folder declares it`);
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
