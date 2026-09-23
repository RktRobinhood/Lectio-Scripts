/*
 * Two copies of one module running side by side (issue #70).
 *
 * A module promoted from Unstable to Stable ships as a second file with the
 * same @name and a different download URL, so a tester can end up with both
 * installed. Both register, and until 1.32.1 whichever answered last defined
 * the version the Manager reported - so the older copy could keep the panel
 * offering an update that was already installed, permanently.
 *
 * The fixture makes both copies answer one Discovery dispatch, which is what
 * tells the Manager there are two of them rather than one module announcing
 * twice, and checks that the doubled module is reported as a problem to fix by
 * hand rather than as an update to install again.
 */

const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

async function runFixture(prefix, fixture) {
    const profileDirectory = await createProfile(prefix);
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', fixture)).href;

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            fixtureUrl
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        return { result: stdout.match(/data-test-result="([^"]*)"/)?.[1], stdout };
    } finally {
        await releaseProfile(profileDirectory);
    }
}

test('two copies of one module are named as two copies, not offered as an update', async () => {
    const { result, stdout } = await runFixture(
        'lectio-manager-duplicate-copies-',
        'manager-duplicate-copies.html'
    );
    assert.equal(result, 'pass', result || stdout);
});
