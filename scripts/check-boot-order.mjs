#!/usr/bin/env node
/*
 * Temporal-dead-zone guard for every userscript's boot block.
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
 * The modules have the same shape and the same exposure - every one of them
 * boots synchronously at document-idle too - and two of them have already had
 * a near miss caught by hand rather than by a check: Chairs Up's fetch
 * safety-net state (#36, c604041) and Unread's nav-drift flag (#24, d891e65)
 * were both placed above the boot call on purpose, with a comment saying why.
 * A hand-placed declaration is one refactor away from being a shipped one.
 *
 * So: find each file's boot call site, and fail if any module-scope `const`,
 * `let` or `class` is declared after it. Crude and automatic beats careful and
 * remembered. It would have caught all three Manager cases in well under a
 * second, and it catches both module near misses if they are reintroduced
 * (tests/check-boot-order.test.js does exactly that).
 *
 * The companion for the Manager is tests/fixtures/manager-boot-integrity.html,
 * which boots it the way Tampermonkey does and fails on any exception,
 * including a swallowed one. This catches the declaration; that catches the
 * consequence, including shapes this cannot see.
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
 * innermost enclosing *block* - the body of the file's IIFE. A declaration is
 * at module scope if and only if its own stack is exactly that prefix. One
 * extra '(', '[' or '{' of any kind and it is nested, so it is not flagged.
 * The rule holds with no IIFE at all (the prefix is simply empty).
 *
 * `var` is deliberately not flagged: it hoists and is initialised to
 * `undefined`, so it has no dead zone. `class` is flagged, because a class
 * declaration has exactly the same dead zone a `const` does.
 *
 *
 * HOW THE BOOT ANCHOR IS FOUND (the decision behind issue #52)
 * ------------------------------------------------------------
 * The userscripts do not share one boot shape, so the anchor is found by the
 * first of these rules that applies, and the per-file output line says which:
 *
 *   1. Exactly one `document.readyState` test in the file: that is the anchor.
 *      The Manager, Schedule Summary, Subject Colours, Theming, Change Radar,
 *      the skeleton template and English Mode all have it. English Mode's is
 *      spread over several lines, which costs nothing here because the
 *      tokeniser never cared about layout. Two or more such tests is an
 *      ambiguous anchor and fails outright, as it always has.
 *
 *   2. No readyState test: the first module-scope call statement - an
 *      identifier at the start of a statement, at module scope, followed by
 *      '(' - is the anchor. Chairs Up starts with `injectStyles();` and Unread
 *      with `init();`, both bare calls at module scope with no readyState test
 *      anywhere, and a bare call at module scope is exactly the thing that
 *      runs the module during top-level evaluation.
 *
 *   3. Neither: the check FAILS and names the file, unless the file carries the
 *      opt-out marker below. A file this check cannot understand is never
 *      skipped quietly - "not checked" must be a visible, deliberate statement
 *      in the file itself, not a gap in the checker.
 *
 * Why the readyState test wins over an earlier call (rule 1 before rule 2):
 * several modules make housekeeping calls at module scope before their boot
 * block - Subject Colours calls ensureLockedTheme() and then declares a dozen
 * pieces of state before its readyState test; Change Radar prunes storage and
 * registers with the Manager first; Theming announces and applies before
 * testing readyState. Anchoring on the first call would flag every one of
 * those declarations, none of which the early call reads, and this check has
 * no reachability analysis to tell that apart. A guard that is wrong on day
 * one gets deleted. So a readyState test, when the file has one, is taken as
 * the file's own statement of where boot is, and a call before it is reported
 * on the file's output line as not being an anchor, so the gap is visible
 * rather than assumed away.
 *
 *
 * THE OPT-OUT MARKER
 * ------------------
 * A file with no recognisable boot shape may say so, in itself, with one line
 * comment of exactly this form (the dash may be '-' or an em dash):
 *
 *   // boot-order: not-checked — <reason>
 *
 * The file is then reported as NOT CHECKED with its reason, on its own line,
 * and does not fail the run. The reason is required. No file carries this
 * marker today; tests/check-boot-order.test.js pins the set of files that do,
 * so one cannot appear without the test being updated in the same change.
 *
 *
 * DEFERRED FINDINGS
 * -----------------
 * Extending the check to the modules found three module-scope declarations
 * below their file's boot anchor, in files that cannot be edited here: Chairs
 * Up's three notice-watcher `let`s (in both the frozen Stable copy and the
 * Experimental one) and Change Radar's ASSIGNMENT_STATUS_PATTERN. None is a
 * live dead-zone read - each is reached only behind an `await` or from a
 * timer - but the rule is deliberately conservative and does not know that.
 * The fix is to move them, which is a version bump and an Experimental ship
 * per ADR-0014, and the Stable copy of Chairs Up is frozen until promotion, so
 * an opt-out marker cannot be written into it at all.
 *
 * Those findings are therefore listed in DEFERRED_FINDINGS below, by file and
 * declared name, with the issue that tracks moving them. Issue #58 moved the
 * Experimental ones (Chairs Up 1.4.1, Change Radar 0.9.3); what remains is the
 * frozen Stable copy of Chairs Up, whose three entries the promotion commit
 * must delete. A deferred finding is still printed on every run, marked
 * DEFERRED with its issue number; it just does not fail the run. The list is
 * not an allow-list in the usual sense:
 *   - it matches one declared name in one file, so a NEW declaration below the
 *     same boot block still fails;
 *   - an entry that matches nothing any more FAILS the run, so a fixed or
 *     promoted file forces its entry to be deleted in the same change;
 *   - tests/check-boot-order.test.js asserts the set of deferred findings the
 *     default run reports is exactly the set expected, so it cannot grow
 *     without that test being changed too.
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
 * - It knows the boot shapes listed above and no others. A boot written as
 *   `await start()`, or a call guarded by an `if` with no braces, is not
 *   recognised; the file fails and the author adds a recognisable shape or the
 *   marker. That is on purpose, because the alternative is a guard that
 *   silently stops guarding.
 * - A module-scope call made before a readyState anchor is not checked
 *   against (see the decision above). The output line says how many there are.
 * - It is conservative by design. A module-scope `const` below the boot block
 *   that boot never actually reads is still flagged. That is the convention
 *   anyway (all module state lives above the boot block) and the alternative
 *   is reachability analysis, which needs a real parser.
 * - It cannot see any other temporal-dead-zone shape: a const inside a function
 *   read by a nested call before its declaration, a getter that fires early, a
 *   cycle between two files. The Manager's boot fixture is what covers those.
 *
 *   node scripts/check-boot-order.mjs
 *       every .user.js under manager/, modules/, modules-unstable/, templates/
 *   node scripts/check-boot-order.mjs path/to/some.user.js [more paths or directories]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const DEFAULT_DIRECTORIES = ['manager', 'modules', 'modules-unstable', 'templates'];

// A finding the check makes today and cannot act on here, with the issue that
// will act on it. Read DEFERRED FINDINGS above before adding to this; the test
// pins the set, a stale entry fails the run, and the list is printed every time.
const DEFERRED_FINDINGS = [
    { file: 'modules/Lectio-Chairs-Up.user.js', name: 'noticeObserver', issue: 58 },
    { file: 'modules/Lectio-Chairs-Up.user.js', name: 'noticeFrame', issue: 58 },
    { file: 'modules/Lectio-Chairs-Up.user.js', name: 'noticeNeedsPlacement', issue: 58 }
];

// `// boot-order: not-checked — <reason>`, on a line of its own.
const OPT_OUT_MARKER = /^[ \t]*\/\/[ \t]*boot-order:[ \t]*not-checked[ \t]*(?:—|-+)?[ \t]*(.*)$/m;

// Declaration keywords with a temporal dead zone. `var` is absent on purpose.
const DEAD_ZONE_KEYWORDS = new Set(['const', 'let', 'class']);

// Words that can start a statement and be followed by '(' without being a
// call of a module function. `async` covers `async function` and `async (`.
const STATEMENT_KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'return', 'throw', 'typeof', 'new', 'await',
    'function', 'class', 'const', 'let', 'var', 'try', 'catch', 'finally', 'do',
    'else', 'import', 'export', 'delete', 'void', 'yield', 'async', 'with',
    'break', 'continue', 'debugger'
]);

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
 * stack it was seen at and whether it opens a statement, plus whether the
 * delimiters balanced. Nothing here interprets JavaScript beyond what lexing
 * needs.
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
                // Whether this word opens a statement: nothing, ';', '{' or '}'
                // before it, or the `else` of an if. `if (x) call();` is not
                // recognised, and that is listed under WHAT THIS CANNOT DO.
                startsStatement: previous === '' || previous === ';' || previous === '{' || previous === '}'
                    || (previous === 'w' && previousWord === 'else'),
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

// A statement that is a call of something by name: `init();`, `main().catch(`.
function isCallStatement(entry) {
    return entry.startsStatement
        && !entry.afterDot
        && !STATEMENT_KEYWORDS.has(entry.word)
        && /^\s*\(/.test(entry.rest);
}

// The innermost enclosing block of a token's delimiter stack.
function enclosingBlock(scope) {
    const lastBlock = scope.lastIndexOf('{');
    return lastBlock === -1 ? '' : scope.slice(0, lastBlock + 1);
}

/*
 * The boot anchor, by the rules in the header. Returns either { anchor, kind,
 * moduleScope } or { error: [lines] }.
 */
function findAnchor(words) {
    const readyStates = words.filter((entry, position) =>
        entry.word === 'readyState' && entry.afterDot && words[position - 1]?.word === 'document');

    if (readyStates.length > 1) {
        return {
            error: [
                `expected at most one \`document.readyState\` boot test, found ${readyStates.length}`,
                `  at lines ${readyStates.map((anchor) => anchor.line).join(', ')}`,
                '',
                '  This check finds the boot call site by that test, and two of them make the',
                '  anchor ambiguous. If the boot block has been rewritten, teach this script',
                '  the new shape - the temporal-dead-zone trap it guards against (issues #30,',
                '  #32, and 1.21.0) has cost three shipped Manager versions and is invisible',
                '  to every other gate.'
            ]
        };
    }

    if (readyStates.length === 1) {
        const anchor = readyStates[0];
        return { anchor, kind: 'readyState test', moduleScope: enclosingBlock(anchor.scope) };
    }

    // No readyState test. Module scope is the shallowest scope any call
    // statement is made at; the first call at that scope is the boot.
    const calls = words.filter(isCallStatement);
    if (calls.length) {
        const moduleScope = calls.map((entry) => entry.scope).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
        const anchor = calls.find((entry) => entry.scope === moduleScope);
        return { anchor, kind: 'first module-scope call', moduleScope };
    }

    return {
        error: [
            'no boot anchor recognised: no `document.readyState` test and no call statement',
            '  at module scope.',
            '',
            '  This check needs to know where the file starts running in order to flag',
            '  module-scope const/let/class declared below that point. Either give the file',
            '  a recognisable boot shape - a single `if (document.readyState === \'loading\')`',
            '  test, or a bare `init();`-style call at module scope - or, if the file',
            '  genuinely has no boot, say so in the file itself with a line comment of',
            '  exactly this form, reason included:',
            '',
            '    // boot-order: not-checked — <reason>',
            '',
            '  A file this check cannot understand is never skipped quietly.'
        ]
    };
}

/*
 * One file. Returns { file, status, lines } where status is 'passed',
 * 'deferred' (passed, with findings deferred to an issue), 'not-checked'
 * (opted out in the file) or 'failed'.
 */
function checkFile(file) {
    const source = readFileSync(file, 'utf8');

    const marker = source.match(OPT_OUT_MARKER);
    if (marker) {
        const reason = marker[1].trim();
        if (!reason) {
            return {
                file,
                status: 'failed',
                lines: [
                    'the `boot-order: not-checked` marker needs a reason after the dash.',
                    '  "Not checked" is a statement to the next reader; say why.'
                ]
            };
        }
        const markerLine = source.slice(0, marker.index).split('\n').length;
        return { file, status: 'not-checked', lines: [`NOT CHECKED - ${reason} (marker at line ${markerLine})`] };
    }

    const { words, problems } = tokenise(source);

    if (problems.length) {
        return {
            file,
            status: 'failed',
            lines: [
                'this check could not tokenise the file, so it is not passing it.',
                '',
                ...problems.map((problem) => `  - ${problem}`),
                '',
                '  scripts/check-boot-order.mjs lexes by hand (no parser dependency in this',
                '  repo). An unbalanced result means it mis-read something - most likely a',
                '  regular expression it took for a division, or the reverse. Fix the check;',
                '  do not delete it.'
            ]
        };
    }

    const found = findAnchor(words);
    if (found.error) return { file, status: 'failed', lines: found.error };

    const { anchor, kind, moduleScope } = found;

    const declarations = words.filter((entry) =>
        DEAD_ZONE_KEYWORDS.has(entry.word)
        && !entry.afterDot
        && entry.scope === moduleScope
        && introducesBinding(entry.rest));

    /*
     * A guard that passes because it found nothing to look at is the failure
     * mode that matters most here, since it looks exactly like a guard that
     * works. Every userscript in this repo carries module-scope declarations;
     * if this run saw none, the scope derivation is wrong, not the file.
     */
    if (!declarations.length) {
        return {
            file,
            status: 'failed',
            lines: [
                'found no module-scope const/let/class declarations at all.',
                '',
                '  That is not credible for a userscript, so the scope derivation in this',
                '  check is what is broken. It is refusing to pass rather than report a clean',
                `  bill of health it did not earn. (boot anchor: ${kind} at line ${anchor.line},`,
                `  scope "${moduleScope}")`
            ]
        };
    }

    const above = declarations.filter((entry) => entry.index < anchor.index);
    const below = declarations.filter((entry) => entry.index > anchor.index);

    const earlierCalls = kind === 'readyState test'
        ? words.filter((entry) => isCallStatement(entry) && entry.scope === moduleScope && entry.index < anchor.index)
        : [];
    const anchorNote = `${kind} at line ${anchor.line}` + (earlierCalls.length
        ? `; ${earlierCalls.length} earlier module-scope call(s) at line(s) ${earlierCalls.map((entry) => entry.line).join(', ')} not treated as boot`
        : '');

    const deferrals = DEFERRED_FINDINGS.filter((entry) => entry.file === file);
    const deferred = [];
    const failing = [];
    for (const entry of below) {
        const name = declaredName(entry.rest);
        const deferral = deferrals.find((candidate) => candidate.name === name);
        (deferral ? deferred : failing).push({ entry, name, deferral });
    }
    const stale = deferrals.filter((candidate) => !deferred.some((finding) => finding.deferral === candidate));

    const lines = [];

    if (failing.length) {
        lines.push(
            `${failing.length} module-scope declaration(s) below the boot block (${kind} at line ${anchor.line}):`,
            '',
            ...failing.map(({ entry, name }) => `  - ${file}:${entry.line}: ${entry.word} ${name}`),
            '',
            '  Tampermonkey injects every userscript at document-idle, so readyState is never',
            '  \'loading\' on a real install and boot runs during the file\'s own top-level',
            '  evaluation. Anything boot reaches that is declared below that line is read',
            '  inside its temporal dead zone, throws a ReferenceError into whichever catch',
            '  block is nearest, and leaves the script running degraded with nothing on the',
            '  console.',
            '',
            '  Move the declaration above the boot block, where the rest of the module-scope',
            '  state lives. If it belongs beside the function that uses it, put it inside',
            '  that function - a function declaration hoists, and its body is not evaluated',
            '  until it is called (that is what 934b55f did with the changelog cap).',
            '',
            '  This has shipped three times in the Manager: 1.21.0, 1.25.0 (#32) and',
            '  1.27.0 (#30).'
        );
    }

    if (stale.length) {
        if (lines.length) lines.push('');
        lines.push(
            `${stale.length} stale entry(ies) in DEFERRED_FINDINGS for this file matched no finding:`,
            '',
            ...stale.map((candidate) => `  - ${candidate.name} (issue #${candidate.issue})`),
            '',
            '  The declaration has been moved, renamed or the file replaced. Delete the entry',
            '  from scripts/check-boot-order.mjs and the expected set in',
            '  tests/check-boot-order.test.js in the same change.'
        );
    }

    if (lines.length) return { file, status: 'failed', lines };

    if (deferred.length) {
        return {
            file,
            status: 'deferred',
            lines: [
                `DEFERRED: ${deferred.length} module-scope declaration(s) below the boot block ` +
                `(${anchorNote}), tracked in ` +
                `${[...new Set(deferred.map(({ deferral }) => `#${deferral.issue}`))].join(', ')}: ` +
                deferred.map(({ entry, name }) => `${entry.word} ${name} (line ${entry.line})`).join(', ') +
                `; ${above.length} above.`
            ]
        };
    }

    return {
        file,
        status: 'passed',
        lines: [
            `${above.length} module-scope const/let/class declaration(s), all above the boot block ` +
            `(${anchorNote}).`
        ]
    };
}

// ---- targets -----------------------------------------------------------

function userscriptsIn(directory) {
    return readdirSync(directory)
        .filter((name) => name.endsWith('.user.js'))
        .sort()
        .map((name) => `${directory}/${name}`);
}

function resolveTargets(args) {
    const unknownFlags = args.filter((argument) => argument.startsWith('--'));
    if (unknownFlags.length) {
        console.error(`unknown option(s): ${unknownFlags.join(' ')} - this script takes file or directory paths only.`);
        process.exit(2);
    }

    const requested = args.map((argument) => argument.replace(/\\/g, '/').replace(/^\.\//, ''));
    if (!requested.length) {
        return DEFAULT_DIRECTORIES.filter((directory) => existsSync(directory)).flatMap(userscriptsIn);
    }

    return requested.flatMap((path) => {
        if (!existsSync(path)) {
            console.error(`${path}: no such file or directory.`);
            process.exit(2);
        }
        return statSync(path).isDirectory() ? userscriptsIn(path) : [path];
    });
}

// ---- run ---------------------------------------------------------------

const targets = resolveTargets(process.argv.slice(2));

if (!targets.length) {
    console.error('No .user.js files were found - this check would have checked nothing, so it is failing instead.');
    process.exit(1);
}

const results = targets.map(checkFile);

// A deferral for a file that no longer exists is as stale as one for a moved
// declaration; only a default run can tell, since an explicit run may
// legitimately not include the file.
if (!process.argv.slice(2).length) {
    for (const entry of DEFERRED_FINDINGS) {
        if (!targets.includes(entry.file)) {
            results.push({
                file: entry.file,
                status: 'failed',
                lines: [
                    `listed in DEFERRED_FINDINGS (${entry.name}, issue #${entry.issue}) but the file no longer exists.`,
                    '  Delete the entry from scripts/check-boot-order.mjs and the expected set in',
                    '  tests/check-boot-order.test.js in the same change.'
                ]
            });
        }
    }
}

const counts = { passed: 0, deferred: 0, 'not-checked': 0, failed: 0 };

for (const result of results) {
    counts[result.status] += 1;
    if (result.status === 'failed') {
        console.error('');
        console.error(`${result.file}: FAILED - ${result.lines[0]}`);
        for (const line of result.lines.slice(1)) console.error(line);
        console.error('');
    } else {
        console.log(`${result.file}: ${result.lines.join(' ')}`);
    }
}

const summary =
    `Checked ${results.length} file(s): ${counts.passed} passed, ${counts.deferred} with deferred findings, ` +
    `${counts['not-checked']} not checked, ${counts.failed} failed.`;

if (counts.failed) {
    console.error(summary);
    process.exit(1);
}

console.log(summary);
