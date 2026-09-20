const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

test('English Mode persists and immediately applies the language switch position', async () => {
    const profileDirectory = await createProfile('lectio-english-mode-');
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'english-mode.html')).href;

    try {
        for (const stage of ['fresh', 'floating', 'locked', 'invalid']) {
            const { stdout } = await runChrome([
                '--headless=new',
                '--disable-gpu',
                '--allow-file-access-from-files',
                `--user-data-dir=${profileDirectory}`,
                '--dump-dom',
                `${fixtureUrl}?stage=${stage}`
            ], { env: chromeEnvironment(profileDirectory) });

            const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
            assert.equal(result, 'pass', result || stdout);
        }
    } finally {
        await releaseProfile(profileDirectory);
    }
});
