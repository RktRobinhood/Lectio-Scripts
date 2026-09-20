const { execFile } = require('node:child_process');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile } = require('./chrome-harness');

const execFileAsync = promisify(execFile);
const chromePath = process.env.CHROME_PATH ||
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

test('English Mode batches cache writes and flushes them on pagehide', async () => {
    const profileDirectory = await createProfile('lectio-english-cache-');
    const fixtureUrl = pathToFileURL(
        resolve(__dirname, 'fixtures', 'english-mode-cache-flush.html')
    ).href;

    try {
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=120000',
            '--dump-dom',
            `${fixtureUrl}?module=modules-unstable`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="detail">([\s\S]*?)<\/pre>/)?.[1];
        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await releaseProfile(profileDirectory);
    }
});
