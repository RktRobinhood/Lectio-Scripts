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

async function runFixture(hash) {
    const profileDirectory = await createProfile('lectio-theming-custom-');
    const fixtureUrl = `${pathToFileURL(resolve(__dirname, 'fixtures', 'theming-custom.html')).href}${hash}`;

    try {
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            fixtureUrl
        ], { env: chromeEnvironment(profileDirectory) });

        return { result: stdout.match(/data-test-result="([^"]*)"/)?.[1], stdout };
    } finally {
        await releaseProfile(profileDirectory);
    }
}

test('a stored picture becomes the background without changing the chosen palette', async () => {
    const { result, stdout } = await runFixture('');
    assert.equal(result, 'pass', result || stdout);
});

test('a stored background that is not a self-contained image is discarded', async () => {
    const { result, stdout } = await runFixture('#invalid');
    assert.equal(result, 'pass', result || stdout);
});
