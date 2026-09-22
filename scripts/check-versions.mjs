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
 * There is a fifth place, and it is the one a user actually reads. Most modules
 * print a start-up banner to the console - `[Lectio Chairs Up] v1.4.5 started` -
 * and README.md's bug-report template asks reporters for the module version,
 * which is the obvious place to read it from. Two modules had that number typed
 * in as a literal beside the constant rather than taken from it, and both had
 * drifted for months: Chairs Up printed v1.1.2 while declaring 1.4.3, English
 * Mode printed v1.5.3 while declaring 1.11.6. Nothing above catches it, because
 * a bare `v1.1.2` inside a string is invisible to a check that compares
 * `@version`, the registered constant and the catalogue to each other. The
 * symptom is not a missing update - it is a bug report naming a version that
 * has not existed since March, sending whoever reads it to the wrong code.
 *
 * So: any `v<major>.<minor>.<patch>` a userscript can *print* must agree with
 * the version that file declares. "Print" is the load-bearing word - see
 * stringLiterals() for why only strings and template literals are read, and
 * never comments.
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

/*
 * A printed version that disagrees with its file, in a file that cannot be
 * edited yet. Under ADR-0014 a module under test exists twice, and the copy in
 * modules/ is frozen until the owner promotes - so a banner fixed in
 * modules-unstable/ is still wrong in modules/, by design, for as long as the
 * fix is on the Unstable channel. Failing on the frozen copy would mean the fix
 * could not be shipped through the channel the project requires it to go
 * through.
 *
 * This is the same shape as DEFERRED_FINDINGS in scripts/check-boot-order.mjs,
 * and it self-destructs the same way: an entry is matched on the exact number
 * printed, so new drift in the same file still fails, and an entry that matches
 * nothing FAILS the run - so the promotion that carries the fix into modules/
 * is forced to delete the entry in that same commit. Do not add an entry here
 * to silence a banner you could simply fix.
 */
const DEFERRED_BANNERS = [
    { path: 'modules/Lectio-Chairs-Up.user.js', printed: '1.1.2', fixedIn: 'modules-unstable at 1.4.5' },
    { path: 'modules/Lectio-English-Mode.user.js', printed: '1.5.3', fixedIn: 'modules-unstable at 1.11.7' }
];

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
 * Every string and template-literal chunk in the file, with the line it starts
 * on. Comments are excluded, and that exclusion is the whole point rather than
 * an optimisation.
 *
 * A plain text sweep for `v\d+\.\d+\.\d+` finds ten matches across this repo's
 * userscripts and only two of them are defects. The other eight are ordinary
 * history written down where history belongs - "the proven v1.13.4 UI" in the
 * Manager, "Keep the room map discovered successfully by v1.0.2/1.0.3" in
 * Chairs Up, "v0.2.2 made the mistake of searching for ANY descendant" in
 * Unread. Those are correct, and a guard that fails the repo on day one in
 * three files it has no business touching is a guard that gets deleted in the
 * first week. A comment cannot drift, because nobody reads a version out of
 * one; a string can, because that is what reaches the console and then the bug
 * report.
 *
 * The `v` prefix is required for the same reason. Bare three-part numbers in
 * strings are common and legitimate - the Manager's sample data, the minimum
 * Manager version a module compares itself against, the declaration
 * `const MODULE_VERSION = '1.4.5'` itself - and matching those would flag all
 * of them.
 *
 * There is no parser to lean on (no dependencies, no build step - AGENTS.md),
 * so the file is lexed by hand the way scripts/check-boot-order.mjs does it:
 * line and block comments, quoted strings, template literals including
 * `${...}` substitutions (which return to code and can nest), and regular
 * expressions. A delimiter stack is kept only so an unbalanced result can be
 * reported: the single guess in JavaScript lexing is '/' as regex or division,
 * and if it ever goes wrong this says so loudly instead of quietly ceasing to
 * look inside strings.
 */
function stringLiterals(source) {
    const literals = [];
    const lexProblems = [];
    const stack = [];
    const length = source.length;

    let index = 0;
    let line = 1;
    let previous = '';
    let previousWord = '';

    while (index < length) {
        const character = source[index];

        // ---- inside a template literal ---------------------------------
        if (stack[stack.length - 1] === '`') {
            const startLine = line;
            let text = '';

            while (index < length) {
                const inner = source[index];

                if (inner === '\\') {
                    if (source[index + 1] === '\n') line += 1;
                    text += source.slice(index, index + 2);
                    index += 2;
                    continue;
                }
                if (inner === '`') {
                    stack.pop();
                    previous = 's';
                    index += 1;
                    break;
                }
                if (inner === '$' && source[index + 1] === '{') {
                    stack.push('$');
                    previous = '{';
                    index += 2;
                    break;
                }
                if (inner === '\n') line += 1;
                text += inner;
                index += 1;
            }

            literals.push({ text, line: startLine });
            continue;
        }

        // ---- code ------------------------------------------------------
        if (character === '\n') {
            line += 1;
            index += 1;
            continue;
        }

        if (character === '/' && source[index + 1] === '/') {
            const end = source.indexOf('\n', index);
            index = end === -1 ? length : end;
            continue;
        }

        if (character === '/' && source[index + 1] === '*') {
            const end = source.indexOf('*/', index + 2);
            const stop = end === -1 ? length : end + 2;
            for (let scan = index; scan < stop; scan += 1) {
                if (source[scan] === '\n') line += 1;
            }
            index = stop;
            continue;
        }

        if (character === '"' || character === "'") {
            const startLine = line;
            let text = '';
            index += 1;

            while (index < length && source[index] !== character) {
                if (source[index] === '\\') {
                    text += source.slice(index, index + 2);
                    index += 2;
                    continue;
                }
                if (source[index] === '\n') {
                    // Unterminated - a syntax error `node --check` would catch,
                    // but this must not run off the end silently either.
                    lexProblems.push(`line ${line}: unterminated string literal`);
                    break;
                }
                text += source[index];
                index += 1;
            }

            index += 1;
            previous = 's';
            literals.push({ text, line: startLine });
            continue;
        }

        if (character === '`') {
            stack.push('`');
            index += 1;
            continue;
        }

        if (character === '/') {
            const regexAllowed = previous === 'w'
                ? REGEX_MAY_FOLLOW_KEYWORD.has(previousWord)
                : REGEX_MAY_FOLLOW_PUNCTUATION.has(previous);

            if (regexAllowed) {
                index += 1;
                let inClass = false;
                while (index < length) {
                    const inner = source[index];
                    if (inner === '\\') {
                        index += 2;
                        continue;
                    }
                    if (inner === '\n') {
                        lexProblems.push(`line ${line}: unterminated regular expression literal`);
                        break;
                    }
                    if (inner === '[') inClass = true;
                    else if (inner === ']') inClass = false;
                    else if (inner === '/' && !inClass) break;
                    index += 1;
                }
                index += 1;
                while (index < length && /[a-z]/.test(source[index])) index += 1; // flags
                previous = 's';
                continue;
            }

            previous = '/';
            index += 1;
            continue;
        }

        if (character === '(' || character === '[' || character === '{') {
            stack.push(character);
            previous = character;
            index += 1;
            continue;
        }

        if (character === ')' || character === ']' || character === '}') {
            const top = stack.pop();

            if (character === '}' && top === '$') {
                // Back into the template literal this substitution sat in.
                index += 1;
                previous = 's';
                continue;
            }

            const expected = { ')': '(', ']': '[', '}': '{' }[character];
            if (top !== expected) {
                lexProblems.push(`line ${line}: '${character}' closes '${top ?? 'nothing'}', expected '${expected}'`);
            }

            previous = character;
            index += 1;
            continue;
        }

        if (/[A-Za-z_$]/.test(character)) {
            let end = index;
            while (end < length && /[A-Za-z0-9_$]/.test(source[end])) end += 1;
            previousWord = source.slice(index, end);
            previous = 'w';
            index = end;
            continue;
        }

        if (character >= '0' && character <= '9') {
            let end = index;
            while (end < length && /[0-9a-fA-FxXoObBn._]/.test(source[end])) end += 1;
            previous = 'n';
            index = end;
            continue;
        }

        if (!/\s/.test(character)) previous = character;
        index += 1;
    }

    if (stack.length) {
        lexProblems.push(`end of file: ${stack.length} delimiter(s) left open (${stack.join('')})`);
    }

    return { literals, lexProblems };
}

/*
 * After one of these a '/' opens a regular expression; after anything else it
 * is division. The standard lexer heuristic, kept identical to the copy in
 * scripts/check-boot-order.mjs.
 */
const REGEX_MAY_FOLLOW_PUNCTUATION = new Set(
    ['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>']
);
const REGEX_MAY_FOLLOW_KEYWORD = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'do', 'else', 'case', 'yield', 'await', 'throw'
]);

const PRINTED_VERSION = /v(\d+\.\d+\.\d+)/g;

// Every printed `v<x.y.z>` in one file, checked against what that file says it
// is. Returns the deferrals it used, so a stale one can be reported.
function checkPrintedVersions(path, source, declared) {
    const used = new Set();

    if (!declared) return used; // already reported as a missing declaration

    const { literals, lexProblems } = stringLiterals(source);

    if (lexProblems.length) {
        problems.push(
            `${path}: could not lex the file to check the version it prints (${lexProblems.join('; ')}) - ` +
            `this means scripts/check-versions.mjs mis-read something, most likely a regular expression ` +
            `taken for a division or the reverse; fix the check rather than dropping it`
        );
        return used;
    }

    for (const literal of literals) {
        for (const match of literal.text.matchAll(PRINTED_VERSION)) {
            const printed = match[1];
            if (printed === declared) continue;

            const deferral = DEFERRED_BANNERS.find((entry) => entry.path === path && entry.printed === printed);

            if (deferral) {
                used.add(deferral);
                notes.push(
                    `${path}:${literal.line}: prints v${printed} but declares ${declared} - ` +
                    `deferred, fixed in ${deferral.fixedIn}`
                );
                continue;
            }

            problems.push(
                `${path}:${literal.line}: prints "v${printed}" but the file declares ${declared} - ` +
                `a version typed into a string drifts the moment the number moves, and README.md's ` +
                `bug-report template asks reporters to read it off exactly this line. Interpolate the ` +
                `constant instead: \`v\${MODULE_VERSION}\`. (A version in a *comment* is history and is ` +
                `never read here; this is a string, so it reaches the console.)`
            );
        }
    }

    return used;
}

/*
 * `changelog` is optional prose about the version in the same entry, shown by
 * the Manager under the update row. The Manager ignores one that is not a
 * usable string, which is the safe thing for it to do and the wrong thing to
 * find out about later: the line just never appears. Wrong shape is caught
 * here instead, where it is a failing check rather than a silent omission.
 */
function checkChangelog(path, entry, label = `'${entry.id}'`) {
    for (const [where, value] of [
        [label, entry.changelog],
        ...Object.entries(entry.i18n ?? {}).map(([code, fields]) => [`${label} (${code})`, fields?.changelog])
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

// The manager entry may carry the same optional changelog a module entry does
// (issue #46), shown on the self-update notice, and it fails the same silent
// way when its shape is wrong.
if (managerEntry) checkChangelog('catalogue/modules.json', managerEntry, 'the manager entry');

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

const usedDeferrals = new Set();

for (const path of userscripts) {
    const source = readFileSync(path, 'utf8');
    const header = headerVersion(source);
    const registered = registeredVersion(source);
    const isManager = path.startsWith('manager/');
    const id = isManager ? null : moduleId(source);

    if (!header) problems.push(`${path}: no @version in the userscript header`);

    // The registered constant is what the running script can actually see, so
    // it is what a banner should be interpolating; fall back to the header only
    // when a file has no constant (already a problem in its own right).
    for (const deferral of checkPrintedVersions(path, source, registered ?? header)) {
        usedDeferrals.add(deferral);
    }

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

/*
 * A deferral that matched nothing has done its job and is now hiding the next
 * one. This is what forces the promotion carrying a fixed banner into modules/
 * to delete the entry in that same commit.
 *
 * Only a deferral whose file was actually scanned can be judged: this script
 * reads whatever tree it is run in, and tests/check-versions.test.js runs it
 * against small fixture trees that contain none of these files. Absent means
 * "nothing to say", not "stale". Nothing is lost in the real repo, where these
 * paths are in modules/ - a promotion overwrites those files, it does not
 * delete them, so the entry still goes stale the moment the fix lands there.
 */
for (const deferral of DEFERRED_BANNERS) {
    if (usedDeferrals.has(deferral) || !userscripts.includes(deferral.path)) continue;

    problems.push(
        `scripts/check-versions.mjs: DEFERRED_BANNERS still lists ${deferral.path} printing v${deferral.printed}, ` +
        `but that file does not print it any more - it has been fixed or promoted. Delete the entry ` +
        `(and its case in tests/check-versions.test.js) in this same change.`
    );
}

for (const note of notes) console.log(`note: ${note}`);

if (problems.length) {
    console.error(`\n${problems.length} version problem(s):\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('');
    process.exit(1);
}

console.log(`Versions agree across headers, registrations, and catalogues (base: ${baseRef}).`);
