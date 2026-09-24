/*
 * The Manager runs on the top page only. Lectio's "Vælg materiale" dialog is
 * another Lectio page in an iframe, and up to 1.32.2 the Manager booted a
 * second instance there - a second gear and dock over the dialog, out of step
 * with the page behind it. The fixture explains what it asserts.
 */

const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

test('the Manager builds on the top page and stands aside inside a frame', async () => {
    const profileDirectory = await createProfile('lectio-manager-frames-');
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'manager-frames.html')).href;

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            // The frame is added after the top page's load event, so Chrome has
            // to keep running past load rather than dumping the DOM at once.
            '--virtual-time-budget=5000',
            '--dump-dom',
            fixtureUrl
        ], { env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
    } finally {
        await releaseProfile(profileDirectory);
    }
});
