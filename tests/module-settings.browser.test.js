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

test('theme previews and unread badge appearance settings apply through module events', async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'lectio-module-settings-'));
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'module-settings.html')).href;

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
});
