/*
 * scripts/check-versions.mjs's printed-version rule, held honest.
 *
 * The sibling of tests/check-boot-order.test.js, for the sibling guard, and it
 * exists for the same reason: the rule is text analysis with no parser behind
 * it, and its failure mode that matters is passing a file it did not
 * understand - or failing one it did.
 *
 * What is pinned here:
 *
 * 1. The default run over the real repo passes, and reports exactly the
 *    expected set of deferred banners. That set growing is a change to this
 *    file, in the open.
 *
 * 2. It bites on the two shapes the real defects had: a bare quoted string
 *    (English Mode logged 'v1.5.3 started' while declaring 1.11.6) and a
 *    template literal carrying a substitution (Chairs Up logged
 *    `[Lectio Chairs Up] v1.1.2 started - school ${SCHOOL}` while declaring
 *    1.4.3). Both are reproduced in a fixture tree rather than against the real
 *    modules, so these cases survive the promotion that fixes them.
 *
 * 3. It does NOT bite on a version in a comment. This is the case that decides
 *    whether the guard is usable at all: a plain text sweep finds ten
 *    `v<semver>` matches across this repo's userscripts and eight of them are
 *    ordinary history in comments ("the proven v1.13.4 UI", "v0.2.2 made the
 *    mistake of..."). A guard that failed those would have been deleted in its
 *    first week. Line comments, block comments, a comment sharing a line with
 *    code, and a bare number with no `v` are all covered.
 *
 * 4. Its own guard: a file it cannot lex is failed, not passed.
 *
 * The fixture trees are minimal but complete - check-versions.mjs reads
 * manager/, modules/, modules-unstable/ and both catalogues from its working
 * directory, so each tree carries all of them. `--no-drift` is passed
 * throughout: the drift half compares against origin/main and is not what these
 * cases are about.
 */

const { spawnSync } = require('node:child_process');
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = resolve(__dirname, '..');
const script = resolve(repoRoot, 'scripts', 'check-versions.mjs');

/*
 * The banners that disagree with their file today and cannot be fixed in
 * place: both live in modules/, which ADR-0014 freezes while the fix is under
 * test in modules-unstable/. Each entry here must match one in
 * DEFERRED_BANNERS in the script. Promoting either module empties its entry
 * from both places in the same commit - the script fails on a deferral that no
 * longer matches, so it cannot be forgotten.
 */
const EXPECTED_DEFERRED = [
    'modules/Lectio-Chairs-Up.user.js prints v1.1.2, declares 1.4.4',
    'modules/Lectio-English-Mode.user.js prints v1.5.3, declares 1.11.6'
];

function run(cwd) {
    const result = spawnSync(process.execPath, [script, '--no-drift'], { cwd, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: result.stdout + result.stderr };
}

function deferredBanners(stdout) {
    return stdout.split('\n')
        .map((line) => line.match(/^note: (\S+):\d+: prints v(\S+) but declares (\S+) - deferred/))
        .filter(Boolean)
        .map((match) => `${match[1]} prints v${match[2]}, declares ${match[3]}`)
        .sort();
}

test('the default run over the repo passes and reports exactly the expected deferred banners', () => {
    const result = run(repoRoot);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(deferredBanners(result.stdout), EXPECTED_DEFERRED);
});

/*
 * A complete little repo in a temporary directory. `module` is the body of the
 * one module in modules/; everything else is the minimum the script insists on
 * finding. The module declares 2.1.0 throughout, so any `v<x.y.z>` in the body
 * other than v2.1.0 is drift.
 */
async function withTree(body) {
    const directory = await mkdtemp(join(tmpdir(), 'lectio-check-versions-'));

    for (const folder of ['manager', 'modules', 'modules-unstable', 'catalogue']) {
        await mkdir(join(directory, folder));
    }

    await writeFile(join(directory, 'modules', 'Demo.user.js'), [
        '// ==UserScript==',
        '// @version      2.1.0',
        '// @updateURL    https://example.invalid/main/modules/Demo.user.js',
        '// @downloadURL  https://example.invalid/main/modules/Demo.user.js',
        '// ==/UserScript==',
        '(() => {',
        "    const MODULE_ID = 'demo';",
        "    const MODULE_VERSION = '2.1.0';",
        body,
        '    init();',
        '    function init() {}',
        '})();',
        ''
    ].join('\n'));

    await writeFile(join(directory, 'manager', 'Lectio-Manager.user.js'), [
        '// ==UserScript==',
        '// @version      3.0.0',
        '// ==/UserScript==',
        '(() => {',
        "    const MANAGER_VERSION = '3.0.0';",
        '    init();',
        '    function init() {}',
        '})();',
        ''
    ].join('\n'));

    await writeFile(join(directory, 'catalogue', 'modules.json'), JSON.stringify({
        schemaVersion: 1,
        manager: { version: '3.0.0' },
        modules: [{ id: 'demo', name: 'Demo', description: 'd', version: '2.1.0', installUrl: 'https://example.invalid/' }]
    }));

    await writeFile(join(directory, 'modules-unstable', 'modules.json'), JSON.stringify({
        schemaVersion: 1,
        channel: 'unstable',
        modules: []
    }));

    try {
        return { result: run(directory), directory };
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test('bites on a drifted version printed from a plain string (English Mode\'s shape)', async () => {
    const { result } = await withTree("    console.log(LOG, 'v1.5.3 started');");

    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /modules\/Demo\.user\.js:9: prints "v1\.5\.3" but the file declares 2\.1\.0/);
    assert.match(result.output, /Interpolate the constant instead/);
});

test('bites on a drifted version printed from a template literal with a substitution (Chairs Up\'s shape)', async () => {
    const { result } = await withTree('    console.info(`[Demo] v1.1.2 started - school ${SCHOOL}`);');

    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /modules\/Demo\.user\.js:9: prints "v1\.1\.2" but the file declares 2\.1\.0/);
});

test('passes a banner that interpolates the constant, which is the fix', async () => {
    const { result } = await withTree('    console.info(`[Demo] v${MODULE_VERSION} started - school ${SCHOOL}`);');

    assert.equal(result.status, 0, result.output);
});

test('passes a printed version that agrees with the file', async () => {
    const { result } = await withTree("    console.log('v2.1.0 started');");

    assert.equal(result.status, 0, result.output);
});

/*
 * The eight legitimate matches in the real repo are all of these shapes. The
 * same-line case is the one a naive line-based skip gets wrong in both
 * directions at once: skip the whole line and the string on it stops being
 * checked, keep the whole line and the comment on it starts being checked.
 */
test('ignores versions in comments, including a comment sharing a line with a checked string', async () => {
    const { result } = await withTree([
        '    // Keep the map discovered successfully by v1.0.2/1.0.3.',
        '    /*',
        '     * v1.0.4 CANCELLATION FIX - the proven v1.13.4 UI.',
        '     */',
        "    console.log('v2.1.0 started'); // v0.2.2 made the mistake of searching for ANY descendant",
        "    const MINIMUM_MANAGER = '1.29.0';",
        '    const RATIO = 6 / 2 / 1;'
    ].join('\n'));

    assert.equal(result.status, 0, result.output);
});

test('a drifted version on a line that also carries a comment is still caught', async () => {
    const { result } = await withTree("    console.log('v1.5.3 started'); // safe to read: v1.0.4 is history");

    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /prints "v1\.5\.3"/);
    assert.doesNotMatch(result.output, /prints "v1\.0\.4"/);
});

test('refuses to pass a file it cannot lex, rather than reporting it clean', async () => {
    // An unterminated template literal leaves the delimiter stack open, which is
    // how a mis-read regex would surface too.
    const { result } = await withTree('    console.info(`[Demo] v1.1.2 started');

    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /could not lex the file to check the version it prints/);
});
