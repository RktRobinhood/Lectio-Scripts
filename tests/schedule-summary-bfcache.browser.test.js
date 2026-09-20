const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

/* Issue #45. Schedule Summary does its rendering in one pass and then lives
   entirely off listeners registered with its lifecycle AbortController - the
   toggle's click, the strip's mouseleave, and the Manager's discover and
   set-setting events. Aborting that controller on a page that is only frozen
   leaves the strip on screen and completely inert. */
async function runPhase(phase, profilePrefix) {
    const profileDirectory = await createProfile(profilePrefix);
    const fixture = pathToFileURL(resolve(__dirname, 'fixtures', 'schedule-summary-bfcache.html')).href;

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            `${fixture}?phase=${phase}`
        ], { env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];

        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await releaseProfile(profileDirectory);
    }
}

test('a page restored from the back/forward cache still has a working summary strip', async () => {
    await runPhase('restore', 'lectio-schedule-summary-bfcache-restore-');
});

test('a page that is genuinely going away is torn down and stays torn down', async () => {
    await runPhase('terminal', 'lectio-schedule-summary-bfcache-terminal-');
});
