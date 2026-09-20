#!/usr/bin/env node
/*
 * Temporal-dead-zone guard for the Manager's boot block.
 *
 * THE BUG THIS EXISTS FOR
 * -----------------------
 * The Manager has shipped the same defect three times (1.21.0, 1.25.0,
 * 1.27.0-in-progress). Every time the shape was identical: a module-scope
 * `const` or `let` declared *below* the point where init() is called.
 *
 * Tampermonkey injects the Manager at document-idle, so on a real install
 * `document.readyState` is never 'loading' and init() runs synchronously,
 * during the file's own top-level evaluation. Anything init() reaches that is
 * declared further down the file is still in its temporal dead zone, so the
 * read throws a ReferenceError. That ReferenceError then lands in one of the
 * many `catch` blocks the Manager has for good reasons - several of which are
 * deliberately silent - and the Manager carries on, degraded, with no console
 * error and no crash:
 *
 *   1.21.0  DOCK_SHELL_OPACITY_DEFAULT / DOCK_ITEM_OPACITY_DEFAULT
 *           nothing was built at all - no gear, no dock, no panel
 *   1.25.0  the changelog length cap (issue #32, fixed in 934b55f)
 *           every page load discarded the cached catalogue and refetched
 *           both catalogues from GitHub
 *   1.27.0  DOCK_EDGES / DOCK_ALIGNMENTS / LEGACY_DOCK_POSITIONS
 *           (issue #30, fixed in 4be2312) loadDockPreferences threw on every
 *           page load, handed the user the default dock, and overwrote their
 *           real one on the next save
 *
 * CI and the full local suite passed all three. `node --check` passes too:
 * this is valid JavaScript, it is only wrong at runtime, and only in the one
 * arrangement no plain <script> fixture reproduces.
 *
 * So: find the boot call site, and fail if any module-scope `const`, `let` or
 * `class` is declared after it. Crude and automatic beats careful and
 * remembered. It would have caught all three in well under a second.
 *
 * The companion is tests/fixtures/manager-boot-integrity.html, which boots the
 * Manager the way Tampermonkey does and fails on any exception, including a
 * swallowed one. This catches the declaration; that catches the consequence,
 * including shapes this cannot see.
 *
 *
 * HOW MODULE SCOPE IS TOLD APART FROM EVERYTHING ELSE
 * ---------------------------------------------------
 * A `const` inside a function, a block, a class body, an object literal or any
 * other nested scope after the boot block is completely fine, and flagging one
 * would get this check deleted by the first false positive. There is no parser
 * to lean on - this repo has no dependencies, no package.json and no build
 * step (AGENTS.md) - so the file is tokenised here by hand.
 *
 * The tokeniser walks the source once, skipping line comments, block comments,
 * single- and double-quoted strings, template literals (including `${...}`
 * substitutions, which return to code mode and can nest) and regular-expression
 * literals. Outside all of those it maintains a stack of open delimiters:
 * '(', '[', '{', '`' for a template and '$' for a substitution.
 *
 * "Module scope" is then derived from the file rather than assumed: the stack
 * at the boot anchor is truncated at and including its last '{', which is the
 * innermost enclosing *block* - the body of the Manager's IIFE. A declaration
 * is at module scope if and only if its own stack is exactly that prefix. One
 * extra '(', '[' or '{' of any kind and it is nested, so it is not flagged.
 * The rule holds with no IIFE at all (the prefix is simply empty).
 *
 * `var` is deliberately not flagged: it hoists and is initialised to
 * `undefined`, so it has no dead zone. `class` is flagged, because a class
 * declaration has exactly the same dead zone a `const` does.
 *
 *
 * WHAT THIS CANNOT DO - read this before trusting it
 * ---------------------------------------------------
 * - It is text analysis, not parsing. The one genuinely ambiguous character in
 *   JavaScript lexing is '/' (regex or division), resolved here by the usual
 *   preceding-token heuristic. If that heuristic ever guessed wrong the
 *   delimiter stack would end unbalanced, so the run ends by checking that the
 *   stack is empty and refuses to pass if it is not. A wrong guess becomes a
 *   loud failure, never a quiet one.
 * - It only knows the one boot shape this file has: a single module-scope
 *   `document.readyState` test. If the boot block is rewritten, or a second
 *   readyState test appears, the anchor is ambiguous and the check fails rather
 *   than guessing - that is on purpose, because the alternative is a guard that
 *   silently stops guarding.
 * - It is conservative by design. A module-scope `const` below the boot block
 *   that init() never actually reads is still flagged. That is the file's
 *   convention anyway (all module state lives above the boot block) and the
 *   alternative is reachability analysis, which needs a real parser.
 * - It cannot see any other temporal-dead-zone shape: a const inside a function
 *   read by a nested call before its declaration, a getter that fires early, a
 *   cycle between two files. The boot fixture is what covers those.
 * - It checks the Manager only. Modules do not all have one unambiguous boot
 *   anchor - several have no readyState test at all - and a check that skipped
 *   the files it could not understand would be worse than none. The Manager is
 *   the file that matters most here: it is Stable-exempt, ships straight to
 *   users, and runs on every Lectio page for everyone.
 *
 *   node scripts/check-boot-order.mjs
 *   node scripts/check-boot-order.mjs path/to/some-other.user.js
 */

import { readFileSync } from 'node:fs';

const DEFAULT_TARGET = 'manager/Lectio-Manager.user.js';
const target = process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? DEFAULT_TARGET;

// Declaration keywords with a temporal dead zone. `var` is absent on purpose.
const DEAD_ZONE_KEYWORDS = new Set(['const', 'let', 'class']);

/*
 * After one of these, a '/' opens a regular expression; after anything else it
 * is division. This is the standard lexer heuristic and the only place the
 * tokeniser guesses - see WHAT THIS CANNOT DO above for how a wrong guess is
 * turned into a loud failure rather than a quiet one.
 */
const REGEX_MAY_FOLLOW_PUNCTUATION = new Set(
    ['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>']
);
const REGEX_MAY_FOLLOW_KEYWORD = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'do', 'else', 'case', 'yield', 'await', 'throw'
]);

const isIdentifierStart = (character) => /[A-Za-z_$]/.test(character);
const isIdentifierPart = (character) => /[A-Za-z0-9_$]/.test(character);

/*
 * One pass over the file.
 *
 * Returns every identifier seen in code position, each with the delimiter
 * stack it was seen at, plus whether the delimiters balanced. Nothing here
 * interprets JavaScript beyond what lexing needs.
 */
function tokenise(source) {
    const words = [];
    const stack = [];
    const problems = [];

    let index = 0;
    let line = 1;

    // The last significant character in code position. 'w' stands for an
    // identifier, 'n' for a numeric literal and 's' for a string or template,
    // because what matters downstream is only whether a value just ended.
    let previous = '';
    let previousWord = '';

    const length = source.length;

    while (index < length) {
        const character = source[index];

        // ---- template literal text -------------------------------------
        if (stack[stack.length - 1] === '`') {
            if (character === '\\') {
                if (source[index + 1] === '\n') line += 1;
                index += 2;
                continue;
            }
            if (character === '`') {
                stack.pop();
                previous = 's';
                index += 1;
                continue;
            }
            if (character === '$' && source[index + 1] === '{') {
                stack.push('$');
                previous = '{';
                index += 2;
                continue;
            }
            if (character === '\n') line += 1;
            index += 1;
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
            index += 1;
            while (index < length && source[index] !== character) {
                if (source[index] === '\\') {
                    index += 2;
                    continue;
                }
                if (source[index] === '\n') {
                    // Unterminated - a syntax error `node --check` would catch,
                    // but this must not run off the end silently either.
                    problems.push(`line ${line}: unterminated string literal`);
                    break;
                }
                index += 1;
            }
            index += 1;
            previous = 's';
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
                        problems.push(`line ${line}: unterminated regular expression literal`);
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
                problems.push(`line ${line}: '${character}' closes '${top ?? 'nothing'}', expected '${expected}'`);
            }

            previous = character;
            index += 1;
            continue;
        }

        if (isIdentifierStart(character)) {
            let end = index;
            while (end < length && isIdentifierPart(source[end])) end += 1;
            const word = source.slice(index, end);

            words.push({
                word,
                line,
                index,
                scope: stack.join(''),
                afterDot: previous === '.',
                rest: source.slice(end, end + 200)
            });

            previousWord = word;
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

        if (!/\s/.test(character)) {
            previous = character;
        }

        index += 1;
    }

    if (stack.length) {
        problems.push(`end of file: ${stack.length} delimiter(s) left open (${stack.join('')})`);
    }

    return { words, problems };
}

// The name a declaration introduces, for the failure message. A destructuring
// pattern is reported as such rather than picked apart.
function declaredName(rest) {
    const trimmed = rest.replace(/^[\s]+/, '');
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return '(destructured)';
    return trimmed.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0] ?? '(unnamed)';
}

// `let` is not a reserved word, so make sure this one introduces a binding
// rather than being used as an ordinary identifier somewhere.
function introducesBinding(rest) {
    return /^\s+([A-Za-z_$][A-Za-z0-9_$]*|[{[])/.test(rest);
}

function fail(lines) {
    console.error('');
    for (const line of lines) console.error(line);
    console.error('');
    process.exit(1);
}

const source = readFileSync(target, 'utf8');
const { words, problems } = tokenise(source);

if (problems.length) {
    fail([
        `${target}: this check could not tokenise the file, so it is not passing it.`,
        '',
        ...problems.map((problem) => `  - ${problem}`),
        '',
        '  scripts/check-boot-order.mjs lexes by hand (no parser dependency in this',
        '  repo). An unbalanced result means it mis-read something - most likely a',
        '  regular expression it took for a division, or the reverse. Fix the check;',
        '  do not delete it.'
    ]);
}

/*
 * The anchor: `document.readyState`, the test the boot block makes. Exactly one
 * is required. Zero means the boot block moved or was rewritten; more than one
 * means the anchor is ambiguous. Either way this check no longer knows where
 * boot is, and a guard that does not know that must fail, not shrug.
 */
const anchors = words.filter((entry, position) =>
    entry.word === 'readyState' && entry.afterDot && words[position - 1]?.word === 'document');

if (anchors.length !== 1) {
    fail([
        `${target}: expected exactly one \`document.readyState\` boot test, found ${anchors.length}.`,
        anchors.length
            ? `  at line(s) ${anchors.map((anchor) => anchor.line).join(', ')}`
            : '',
        '',
        '  This check finds the boot call site by that test. If the boot block has',
        '  been rewritten, teach this script the new shape - the temporal-dead-zone',
        '  trap it guards against (issues #30, #32, and 1.21.0) has cost three',
        '  shipped Manager versions and is invisible to every other gate.'
    ].filter(Boolean));
}

const boot = anchors[0];

/*
 * Module scope, derived rather than assumed: the delimiter stack at the boot
 * test, truncated at and including its last '{' - the innermost enclosing
 * block, which here is the body of the Manager's IIFE. A declaration is at
 * module scope only if its stack matches this exactly.
 */
const bootScope = boot.scope;
const lastBlock = bootScope.lastIndexOf('{');
const moduleScope = lastBlock === -1 ? '' : bootScope.slice(0, lastBlock + 1);

const declarations = words.filter((entry) =>
    DEAD_ZONE_KEYWORDS.has(entry.word)
    && !entry.afterDot
    && entry.scope === moduleScope
    && introducesBinding(entry.rest));

const above = declarations.filter((entry) => entry.index < boot.index);
const below = declarations.filter((entry) => entry.index > boot.index);

/*
 * A guard that passes because it found nothing to look at is the failure mode
 * that matters most here, since it looks exactly like a guard that works. The
 * Manager carries scores of module-scope declarations above its boot block; if
 * this run saw none, the scope derivation is wrong, not the file.
 */
if (!above.length) {
    fail([
        `${target}: found no module-scope const/let/class declarations at all.`,
        '',
        '  That is not credible for this file, so the scope derivation in this check',
        '  is what is broken. It is refusing to pass rather than report a clean bill',
        `  of health it did not earn. (boot test at line ${boot.line}, scope "${moduleScope}")`
    ]);
}

if (below.length) {
    fail([
        `${below.length} module-scope declaration(s) below the boot block in ${target}:`,
        '',
        ...below.map((entry) =>
            `  - ${target}:${entry.line}: ${entry.word} ${declaredName(entry.rest)}`),
        '',
        `  The boot block is at line ${boot.line}. Tampermonkey injects this script at`,
        '  document-idle, so readyState is never \'loading\' on a real install and init()',
        '  runs during the file\'s own top-level evaluation. Anything init() reaches that',
        '  is declared below that line is read inside its temporal dead zone, throws a',
        '  ReferenceError into one of the catch blocks below, and leaves the Manager',
        '  running degraded with nothing on the console.',
        '',
        '  Move the declaration above the boot block, where the rest of the module-scope',
        '  state lives. If it belongs beside the function that uses it, put it inside',
        '  that function - a function declaration hoists, and its body is not evaluated',
        '  until it is called (that is what 934b55f did with the changelog cap).',
        '',
        '  This has shipped three times: 1.21.0, 1.25.0 (#32) and 1.27.0 (#30).'
    ]);
}

console.log(
    `${target}: ${above.length} module-scope const/let/class declaration(s), all above the ` +
    `boot block at line ${boot.line}.`
);
