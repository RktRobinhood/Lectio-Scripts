const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

/* The copy under test: Unstable while one exists, Stable once promoted. */
const MODULE_FILE = ['modules-unstable', 'modules']
    .map((folder) => resolve(__dirname, '..', folder, 'Lectio-English-Mode.user.js'))
    .find((file) => existsSync(file));

/* Issue #72 side finding. English Mode translated the attributes of every
   element on the page, and joined text split by <br>, without asking whether
   the element was inside Lectio's rich-text editor - so in English mode an
   image's alt, a link's title or a line of the teacher's own homework could
   be rewritten into English and then saved. */
test('English Mode translates the page but leaves the homework editor alone', async () => {
    const profileDirectory = await createProfile('lectio-english-mode-editor-');
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'english-mode-editor.html'));
    fixtureUrl.searchParams.set('module', pathToFileURL(MODULE_FILE).href);

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=10000',
            '--dump-dom',
            fixtureUrl.href
        ], { env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
    } finally {
        await releaseProfile(profileDirectory);
    }
});
