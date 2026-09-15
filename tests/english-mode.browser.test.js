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

test('English Mode persists and immediately applies the language switch position', async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'lectio-english-mode-'));
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'english-mode.html')).href;

    try {
        for (const stage of ['fresh', 'floating', 'locked', 'invalid']) {
            const { stdout } = await execFileAsync(chromePath, [
                '--headless=new',
                '--disable-gpu',
                '--allow-file-access-from-files',
                `--user-data-dir=${profileDirectory}`,
                '--dump-dom',
                `${fixtureUrl}?stage=${stage}`
            ]);

            const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
            assert.equal(result, 'pass', result || stdout);
        }
    } finally {
        await rm(profileDirectory, { recursive: true, force: true });
    }
});
