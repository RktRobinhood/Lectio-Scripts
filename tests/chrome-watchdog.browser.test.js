/*
 * The Chrome watchdog, against a Chrome that really will not exit (issue #51).
 *
 * The failure this guards against cost a twenty-minute CI job and read as
 * "your change broke something", so the guard is worth a test of its own
 * rather than a note saying it was checked once. tests/fixtures/
 * chrome-never-exits.html holds the load event open forever, so --dump-dom
 * never prints and the process never ends - the real hang, on demand.
 *
 * Three things have to be true and none of them are about a module: the wait
 * ends, it ends as its own named failure rather than a generic timeout, and
 * the profile directory #43 promised to delete is gone afterwards.
 *
 * The ceiling is passed in short so this costs seconds rather than the three
 * minutes a real launch is allowed.
 */

const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

test('a Chrome that will not exit is killed, named, and takes its profile with it', async () => {
    const profileDirectory = await createProfile('lectio-chrome-watchdog-');
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'chrome-never-exits.html')).href;

    let thrown = null;

    try {
        await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            fixtureUrl
        ], { env: chromeEnvironment(profileDirectory), timeout: 5000 });
    } catch (error) {
        thrown = error;
    } finally {
        await releaseProfile(profileDirectory);
    }

    assert.ok(thrown, 'the watchdog let a Chrome that never exits run on');

    // Named, so nobody reading a red build starts by suspecting their own
    // change. This is the assertion the issue is actually about.
    assert.equal(thrown.code, 'CHROME_DID_NOT_EXIT', thrown.message);
    assert.equal(thrown.name, 'ChromeDidNotExitError', thrown.message);
    assert.match(thrown.message, /Chrome did not exit within 5s/, thrown.message);

    // #43's guarantee has to hold on this path too: the kill is what the
    // `finally` above runs after, not something that replaces it.
    assert.equal(existsSync(profileDirectory), false,
        `the profile survived the watchdog path: ${profileDirectory}`);
});
