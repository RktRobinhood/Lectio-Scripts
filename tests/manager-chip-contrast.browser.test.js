const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

// Issue #56: the gear's update count and the Problem log's unseen count are
// both a numeral on the theme's surface colour, and each used to be drawn in
// its own ring colour - a pairing no palette in Lectio Theming is designed
// around. The fixture applies every palette the module itself offers and
// measures what Chrome resolves, so a new palette is covered automatically.
test('both count chips keep a readable numeral in every Lectio Theming palette', async () => {
    const profileDirectory = await createProfile('lectio-chip-contrast-');
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'manager-chip-contrast.html')).href;

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            // The walk applies a palette, yields, and measures, so the dump
            // has to wait for the timers rather than for `load`.
            '--virtual-time-budget=20000',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            fixtureUrl
        ], { env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const worst = stdout.match(/data-test-worst="([^"]*)"/)?.[1];
        const themes = stdout.match(/data-test-themes="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
        // Printed rather than only asserted: the numbers are the point of the
        // issue, and a guard nobody can read the margin off gets relaxed.
        console.log(`  ${themes} palettes walked — ${worst}`);
    } finally {
        await releaseProfile(profileDirectory);
    }
});
