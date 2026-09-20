/*
 * A promotion leaves the same module in both catalogues for a while: Stable has
 * the promoted build, and the overlay still carries the one it was promoted
 * from. The overlay used to replace the stable entry outright, which pointed
 * anyone on the Experimental channel back at the older build and offered it as
 * the version to install - a downgrade, presented as an update, at exactly the
 * moment a promotion is trying to move people forward.
 *
 * So: Stable reads Stable alone, and Experimental reads both and takes whichever
 * version is higher.
 */

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

test('the experimental channel offers the higher version and stable ignores the overlay', async () => {
    const profileDirectory = await createProfile('lectio-manager-channels-');
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'manager-channel-versions.html')).href;

    try {
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            // The fixture waits for the module list to render, so Chrome has to
            // keep running past the load event rather than dumping immediately.
            '--virtual-time-budget=6000',
            '--dump-dom',
            fixtureUrl
        ], { env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
    } finally {
        await releaseProfile(profileDirectory);
    }
});
