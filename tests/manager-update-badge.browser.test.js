/*
 * The Manager knows an update exists long before anyone opens the panel that
 * says so, and #27 made the panel lazy, so on most page loads that knowledge
 * has nowhere to go. The gear's count badge is where it goes.
 *
 * What matters here is that the count is computed from catalogue-versus-
 * registration state rather than from the update lines the panel renders: every
 * counting assertion below runs with no panel in the document at all, which is
 * also the state in which a throw would take the whole Manager down.
 *
 * Since #50 it also matters where the badge is and how long it lasts. It is in
 * the top-right corner at a size a two-digit count fits in, the problem mark
 * has the bottom-right one so both can show, and opening the panel - for this
 * or for anything else - no longer clears it. Only the update actually being
 * installed does.
 */

const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

async function runFixture(prefix, fixture) {
    const profileDirectory = await createProfile(prefix);
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', fixture)).href;

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            fixtureUrl
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        return { result: stdout.match(/data-test-result="([^"]*)"/)?.[1], stdout };
    } finally {
        await releaseProfile(profileDirectory);
    }
}

test('the gear counts waiting updates legibly, survives the panel, and clears on resolution', async () => {
    const { result, stdout } = await runFixture('lectio-manager-update-badge-', 'manager-update-badge.html');
    assert.equal(result, 'pass', result || stdout);
});

test('the count follows the Experimental overlay and includes the Manager itself', async () => {
    const { result, stdout } = await runFixture(
        'lectio-manager-update-badge-experimental-',
        'manager-update-badge-experimental.html'
    );
    assert.equal(result, 'pass', result || stdout);
});
