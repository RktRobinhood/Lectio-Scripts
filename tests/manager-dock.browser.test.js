const { execFile } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const test = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);
const chromePath = process.env.CHROME_PATH ||
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

async function runFixture(fixtureName, profilePrefix) {
    const profileDirectory = await mkdtemp(join(tmpdir(), profilePrefix));
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', fixtureName)).href;

    try {
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            fixtureUrl
        ]);

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
    } finally {
        await rm(profileDirectory, { recursive: true, force: true });
    }
}

test('manager dock supports lifecycle, activation, panels, ordering, and placement', async () => {
    await runFixture('manager-dock.html', 'lectio-manager-dock-');
});

test('manager migrates v1 dock placement and renders the channel as one dropdown', async () => {
    await runFixture('manager-prefs.html', 'lectio-manager-prefs-');
});
