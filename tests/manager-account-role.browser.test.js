/*
 * Issue #78. The Manager reads which kind of account is signed in off the
 * msapplication-starturl tag Lectio writes into every page, and on Stable
 * offers only the modules and settings meant for that account. Experimental is
 * for testing and shows every role, marking the ones that are not for this
 * account.
 */

const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

test('Stable shows an account only its own role, Experimental shows every role', async () => {
    const profileDirectory = await createProfile('lectio-manager-account-role-');
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'manager-account-role.html')).href;

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            // The fixture waits for the module list to render, so Chrome has to
            // keep running past the load event rather than dumping immediately.
            '--virtual-time-budget=6000',
            '--dump-dom',
            fixtureUrl
        ], { env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
    } finally {
        await releaseProfile(profileDirectory);
    }
});
