/*
 * The Manager's page-health sampler: rare, numbers only, and silent on a
 * healthy page. See PAGE HEALTH in the Manager and docs/manager-problem-log.md.
 *
 * The sampler's first reading is minutes after load and the next a quarter of
 * an hour later, so both runs sit on Chrome's virtual clock: twenty-odd
 * virtual minutes for a few real seconds.
 */

const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

async function runScenario(scenario) {
    const profileDirectory = await createProfile(`lectio-manager-health-${scenario}-`);
    const fixtureUrl = `${pathToFileURL(resolve(__dirname, 'fixtures', 'manager-page-health.html')).href}?scenario=${scenario}`;

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=1500000',
            '--dump-dom',
            fixtureUrl
        ], { maxBuffer: 128 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout.slice(0, 2000));
    } finally {
        await releaseProfile(profileDirectory);
    }
}

test('a healthy page is never logged, however long it stays open', async () => {
    await runScenario('quiet');
});

test('a huge page being redrawn non-stop is logged once per metric, as numbers', async () => {
    await runScenario('busy');
});
