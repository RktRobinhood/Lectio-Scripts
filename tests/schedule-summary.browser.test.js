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

test('schedule information can be previewed and expanded from a compact summary', async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'lectio-schedule-summary-'));
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'schedule.html')).href;

    try {
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            fixtureUrl
        ]);

        assert.match(stdout, /data-test-result="pass"/, stdout);
    } finally {
        await rm(profileDirectory, { recursive: true, force: true });
    }
});
