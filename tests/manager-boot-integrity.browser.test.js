/*
 * Boot the Manager exactly as Tampermonkey does, and fail on anything at all
 * going wrong on the way - including an exception that is caught and merely
 * warned about, or caught and silently swallowed.
 *
 * Issue #49. The Manager has shipped the same temporal-dead-zone defect three
 * times (1.21.0, 1.25.0 / #32, 1.27.0-in-progress / #30): a module-scope const
 * declared below init()'s call site, read during the file's own top-level
 * evaluation because Tampermonkey injects at document-idle. Two of the three
 * landed in a catch and warned; the third never built anything. CI and the
 * full local suite passed all three.
 *
 * The static half of the guard is scripts/check-boot-order.mjs, which finds the
 * declaration. This is the half that catches the consequence, including shapes
 * a text check cannot see. The fixture explains what it asserts and why each
 * assertion is the one a silent failure cannot get past.
 *
 * tests/fixtures/manager-late-inject.html stays as it is: it is the regression
 * test naming the three historical bugs, and this is the general invariant.
 * Two tests that fail differently are the point - see the note at the head of
 * the fixture for why this is a sibling rather than a third strengthening of
 * that one.
 */

const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

test('the Manager boots at document-idle with every subsystem loaded and nothing swallowed', async () => {
    const profileDirectory = await createProfile('lectio-manager-boot-integrity-');
    const fixtureUrl = pathToFileURL(
        resolve(__dirname, 'fixtures', 'manager-boot-integrity.html')
    ).href;

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            // The fixture injects the Manager after the load event and reports
            // after it has settled, so Chrome has to keep running past load
            // rather than dumping the DOM the moment loading finishes.
            '--virtual-time-budget=8000',
            '--dump-dom',
            fixtureUrl
        ], { env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
    } finally {
        await releaseProfile(profileDirectory);
    }
});
