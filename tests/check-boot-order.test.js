/*
 * scripts/check-boot-order.mjs, held honest (issue #52).
 *
 * The check is text analysis with no parser behind it, and its failure mode
 * that matters is passing a file it did not understand. Three things are
 * pinned here, none of them needing Chrome:
 *
 * 1. The default run over the whole repo passes, checks every .user.js that
 *    exists (counted independently here, so a directory dropping out of the
 *    run cannot go unnoticed), and reports exactly the expected set of
 *    deferred findings and exactly the expected set of opted-out files.
 *    Either set growing is a change to this file, in the open.
 *
 * 2. It bites on the two real module near misses: Chairs Up's fetch
 *    safety-net state (#36, c604041) and Unread's nav-drift flag (#24,
 *    d891e65). Both were placed above the boot call by hand, with a comment
 *    saying a declaration beside the function that uses it would be read in
 *    its dead zone. Each is moved back to that spot in a scratch copy of the
 *    module, and the check must fail naming that declaration. The module files
 *    on disk are never touched.
 *
 * 3. Its own guards refuse to pass on an unbalanced delimiter stack, on a file
 *    with no module-scope declarations, and on a file with no recognisable
 *    boot shape - unless that file says so itself with the documented marker.
 */

const { spawnSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = resolve(__dirname, '..');
const script = resolve(repoRoot, 'scripts', 'check-boot-order.mjs');

// The findings the check reports today and cannot act on: see DEFERRED
// FINDINGS in the script header and the issue each one names. Empty since
// Chairs Up 1.4.3 was promoted; growing it needs a reason written there.
const EXPECTED_DEFERRED = [];

// Files carrying `// boot-order: not-checked — <reason>`. None today.
const EXPECTED_NOT_CHECKED = [];

const CHECKED_DIRECTORIES = ['manager', 'modules', 'modules-unstable', 'templates'];

function run(args = [], cwd = repoRoot) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: result.stdout + result.stderr };
}

function deferredFindings(stdout) {
    const findings = [];
    for (const line of stdout.split('\n')) {
        const match = line.match(/^(\S+): DEFERRED: .*?: (.*); \d+ above\.$/);
        if (!match) continue;
        for (const item of match[2].split(', ')) {
            const declaration = item.match(/^(const|let|class) ([A-Za-z_$][A-Za-z0-9_$]*) \(line \d+\)$/);
            assert.ok(declaration, `unparsed deferred item "${item}" in line: ${line}`);
            findings.push(`${match[1]}: ${declaration[1]} ${declaration[2]}`);
        }
    }
    return findings.sort();
}

function notCheckedFiles(stdout) {
    return stdout.split('\n')
        .map((line) => line.match(/^(\S+): NOT CHECKED - /))
        .filter(Boolean)
        .map((match) => match[1])
        .sort();
}

function failureNames(output) {
    return [...output.matchAll(/^ {2}- \S+:\d+: (const|let|class) (\S+)$/gm)].map((match) => `${match[1]} ${match[2]}`);
}

test('the default run passes, checks every userscript, and reports exactly the expected deferred and opted-out sets', () => {
    const result = run();
    assert.equal(result.status, 0, result.output);

    const onDisk = CHECKED_DIRECTORIES.flatMap((directory) =>
        readdirSync(resolve(repoRoot, directory)).filter((name) => name.endsWith('.user.js')).map((name) => `${directory}/${name}`));
    // A floor, not a count: it catches a directory walk that has stopped
    // finding anything. Nine is the whole set today - six modules, Change
    // Radar on Unstable, the Manager and the template - where it was fifteen
    // while six modules existed in both channels at once.
    assert.ok(onDisk.length >= 9, `only ${onDisk.length} userscripts found on disk`);

    const summary = result.stdout.match(/^Checked (\d+) file\(s\): (\d+) passed, (\d+) with deferred findings, (\d+) not checked, (\d+) failed\.$/m);
    assert.ok(summary, `no summary line in:\n${result.stdout}`);
    assert.equal(Number(summary[1]), onDisk.length, 'the run checked a different number of files than exist on disk');
    assert.equal(Number(summary[5]), 0);

    for (const file of onDisk) {
        assert.ok(new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `, 'm').test(result.stdout), `no output line for ${file}`);
    }

    assert.deepEqual(deferredFindings(result.stdout), EXPECTED_DEFERRED);
    assert.deepEqual(notCheckedFiles(result.stdout), EXPECTED_NOT_CHECKED);
});

// A scratch copy of a module with one edit applied, in a directory of its own.
// `edit` must change the source; a replacement that matched nothing would test
// the unmodified module and pass for the wrong reason.
async function withScratch(directory, sourceFile, edit) {
    const original = readFileSync(resolve(repoRoot, sourceFile), 'utf8');
    const edited = edit(original);
    assert.notEqual(edited, original, `the edit to ${sourceFile} changed nothing`);

    const controlPath = join(directory, 'control-' + sourceFile.split('/').pop());
    const editedPath = join(directory, 'edited-' + sourceFile.split('/').pop());
    await writeFile(controlPath, original);
    await writeFile(editedPath, edited);
    return { control: run([controlPath]), edited: run([editedPath]) };
}

test('bites on Chairs Up (#36): the fetch safety-net state moved below the START block', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lectio-boot-order-'));
    try {
        const { control, edited } = await withScratch(directory, 'modules/Lectio-Chairs-Up.user.js', (source) => {
            // c604041 declared this above START "on purpose: fetchHtml() can be
            // reached synchronously from main()". Put it beside fetchHtml instead.
            const declaration = '  let fetchInFlight =\n    false;\n';
            assert.ok(source.includes(declaration), 'Chairs Up no longer declares fetchInFlight the way c604041 did');
            const routerBanner = '  // =========================================================\n  // ROUTER\n';
            assert.ok(source.includes(routerBanner));
            return source.replace(declaration, '').replace(routerBanner, declaration + '\n' + routerBanner);
        });

        // Since #58 moved the notice-watcher lets above START, the Experimental
        // copy is clean, so the control passes on its own merits at a scratch
        // path - with no DEFERRED_FINDINGS entry to lean on.
        assert.equal(control.status, 0, control.output);
        assert.match(control.stdout, /all above the boot block \(first module-scope call at line \d+\)/);

        assert.equal(edited.status, 1, edited.output);
        assert.deepEqual(failureNames(edited.output), ['let fetchInFlight'], edited.output);
        assert.match(edited.output, /module-scope declaration\(s\) below the boot block \(first module-scope call at line \d+\)/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('bites on Unread (#24): the nav-drift flag moved down beside findMessageNavLink()', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lectio-boot-order-'));
    try {
        const { control, edited } = await withScratch(directory, 'modules/Lectio-Unread-Message-Notifications.user.js', (source) => {
            // d891e65 declared this "up here with the rest of the page-view
            // state" because init() reaches findMessageNavLink() synchronously.
            const declaration = '    let reportedNavDrift = false;\n';
            assert.ok(source.includes(declaration), 'Unread no longer declares reportedNavDrift the way d891e65 did');
            const target = '    function findMessageNavLink() {\n';
            assert.ok(source.includes(target));
            return source.replace(declaration, '').replace(target, declaration + '\n' + target);
        });

        assert.equal(control.status, 0, control.output);
        assert.match(control.stdout, /all above the boot block \(first module-scope call at line \d+\)/);

        assert.equal(edited.status, 1, edited.output);
        assert.deepEqual(failureNames(edited.output), ['let reportedNavDrift']);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('its own guards: unbalanced delimiters, no declarations, no anchor, the marker, and both anchor shapes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lectio-boot-order-'));
    const cases = [
        {
            name: 'unbalanced',
            source: '(() => {\n    const a = 1;\n    init();\n    function init() {\n})();\n',
            status: 1,
            expect: /could not tokenise the file/
        },
        {
            name: 'no-declarations',
            source: '(() => {\n    init();\n    function init() {}\n})();\n',
            status: 1,
            expect: /found no module-scope const\/let\/class declarations at all/
        },
        {
            name: 'no-anchor',
            source: '(() => {\n    const a = 1;\n    function init() {}\n})();\n',
            status: 1,
            expect: /no boot anchor recognised[\s\S]*\/\/ boot-order: not-checked — <reason>/
        },
        {
            name: 'marker',
            source: '// boot-order: not-checked — helper file with no boot of its own\n(() => {\n    const a = 1;\n    function init() {}\n})();\n',
            status: 0,
            expect: /NOT CHECKED - helper file with no boot of its own \(marker at line 1\)/
        },
        {
            name: 'marker-without-reason',
            source: '// boot-order: not-checked —\n(() => {\n    const a = 1;\n})();\n',
            status: 1,
            expect: /marker needs a reason/
        },
        {
            name: 'multiline-readystate-below',
            source: '(() => {\n    const a = 1;\n    if (\n        document.readyState ===\n        \'loading\'\n    ) {\n        document.addEventListener(\'DOMContentLoaded\', init);\n    } else {\n        init();\n    }\n    function init() {}\n    const late = 2;\n})();\n',
            status: 1,
            expect: /below the boot block \(readyState test at line 4\)[\s\S]*const late/
        },
        {
            name: 'two-readystate-tests',
            source: '(() => {\n    const a = 1;\n    if (document.readyState === \'loading\') init(); else init();\n    if (document.readyState === \'complete\') init();\n    function init() {}\n})();\n',
            status: 1,
            expect: /expected at most one `document.readyState` boot test, found 2/
        },
        {
            name: 'bare-call-below',
            source: '(() => {\n    const a = 1;\n    init();\n    function init() {}\n    let late = 0;\n})();\n',
            status: 1,
            expect: /below the boot block \(first module-scope call at line 3\)[\s\S]*let late/
        },
        {
            name: 'bare-call-clean',
            source: '(() => {\n    const a = 1;\n    let b = 2;\n    init();\n    function init() {\n        const inner = 3;\n        return inner;\n    }\n})();\n',
            status: 0,
            expect: /2 module-scope const\/let\/class declaration\(s\), all above the boot block \(first module-scope call at line 4\)/
        },
        {
            name: 'no-iife-plain-file',
            source: 'const a = 1;\nif (document.readyState === \'loading\') init(); else init();\nfunction init() {}\nclass Late {}\n',
            status: 1,
            expect: /class Late/
        }
    ];

    try {
        for (const item of cases) {
            const path = join(directory, `${item.name}.user.js`);
            await writeFile(path, item.source);
            const result = run([path]);
            assert.equal(result.status, item.status, `${item.name}:\n${result.output}`);
            assert.match(result.output, item.expect, item.name);
        }

        // A directory argument takes only the .user.js files in it.
        const clean = join(directory, 'clean');
        await mkdir(clean);
        await writeFile(join(clean, 'module.user.js'), cases.find((item) => item.name === 'bare-call-clean').source);
        await writeFile(join(clean, 'not-a-userscript.js'), 'const a = 1;\n');
        const byDirectory = run([clean]);
        assert.equal(byDirectory.status, 0, byDirectory.output);
        assert.match(byDirectory.stdout, /Checked 1 file\(s\): 1 passed/);

        // A directory with nothing to check is a failure, not a pass.
        const empty = join(directory, 'empty');
        await mkdir(empty);
        const nothing = run([empty]);
        assert.equal(nothing.status, 1, nothing.output);
        assert.match(nothing.output, /would have checked nothing/);

        assert.equal(run(['--file', clean]).status, 2, 'an unknown flag must not be ignored');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
