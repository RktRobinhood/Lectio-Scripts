/*
 * The Manager's half of the request-slot contract
 * (docs/manager-request-slots.md): it hands out turns, one at a time, and
 * knows nothing about what any of them are for.
 *
 * The fixture's stand-in modules fetch nothing at all, deliberately - the
 * broker is generic, so anything it could learn about a fetch would be a
 * failure of the design rather than something to assert about.
 */

const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

test('the Manager serialises turns, reclaims one nobody hands back, and logs it', async () => {
    const profileDirectory = await createProfile('lectio-manager-slots-');
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'manager-request-slots.html')).href;

    try {
        /* The lease is thirty seconds, and the run has to sit past it twice -
           once to prove it does not fire early. Chrome runs the wait on a
           virtual clock, so a virtual minute and a half costs a real second. */
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=120000',
            '--dump-dom',
            fixtureUrl
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
    } finally {
        await releaseProfile(profileDirectory);
    }
});
