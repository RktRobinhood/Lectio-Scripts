/*
 * "Update available: v1.9.3 (installed v1.8.2)" gives a teacher no reason to
 * act. A catalogue entry may now carry an optional `changelog` - a sentence or
 * two about what the offered version changes - and the Manager renders it
 * under the update row.
 *
 * Three things are being protected here, in the fixture this drives.
 *
 * The field is optional, so an entry without one has to render the card it
 * rendered before the field existed - checked structurally, not by eye.
 *
 * The text is untrusted. The Catalogue is fetched over HTTPS and rendered
 * inside an authenticated Lectio session, so a changelog full of markup must
 * arrive on screen as the characters it is made of, with nothing parsed and
 * nothing run.
 *
 * The text is unbounded at the source and must be bounded here: one entry with
 * a runaway changelog cannot be allowed to push the rest of the panel off it.
 */

const { execFile } = require('node:child_process');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile } = require('./chrome-harness');

const execFileAsync = promisify(execFile);
const chromePath = process.env.CHROME_PATH ||
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

test('the update offer shows the catalogue\'s changelog, as text, bounded, and only when there is one', async () => {
    const profileDirectory = await createProfile('lectio-manager-changelog-');
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'manager-changelog.html')).href;

    try {
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            fixtureUrl
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
    } finally {
        await releaseProfile(profileDirectory);
    }
});

/*
 * The rendering above runs against a fixture. This runs against the Catalogue
 * that actually ships, because an acceptance criterion the fixture cannot meet
 * is that a real entry carries a changelog - a field nobody fills is worse than
 * no field, and it is also what makes catalogue-compat's run over every shipped
 * Manager an exercise of this change rather than of the catalogue before it.
 */
test('the shipped catalogues carry a real changelog, in the shape the Manager reads', () => {
    const catalogues = [
        require(resolve(__dirname, '..', 'catalogue', 'modules.json')),
        require(resolve(__dirname, '..', 'modules-unstable', 'modules.json'))
    ];

    const withChangelog = catalogues
        .flatMap((catalogue) => catalogue.modules)
        .filter((entry) => entry.changelog !== undefined);

    assert.ok(
        withChangelog.length > 0,
        'no shipped catalogue entry carries a changelog, so nothing exercises the rendering for real'
    );

    for (const entry of withChangelog) {
        assert.equal(typeof entry.changelog, 'string', `${entry.id}: changelog is not a string`);
        assert.ok(entry.changelog.trim().length > 0, `${entry.id}: changelog is blank`);

        // 240 is the Manager's cap; past it the line is truncated on screen.
        assert.ok(
            entry.changelog.length <= 240,
            `${entry.id}: changelog is ${entry.changelog.length} characters and will be cut off at 240`
        );

        for (const [code, fields] of Object.entries(entry.i18n ?? {})) {
            if (fields.changelog === undefined) continue;

            assert.equal(typeof fields.changelog, 'string', `${entry.id} (${code}): changelog is not a string`);
            assert.ok(
                fields.changelog.length <= 240,
                `${entry.id} (${code}): changelog is ${fields.changelog.length} characters and will be cut off at 240`
            );
        }
    }

    // Every required field an old Manager reads is still there, unrenamed. The
    // real proof is catalogue-compat running the Managers themselves; this is
    // the cheap version that fails first and says why.
    for (const catalogue of catalogues) {
        assert.equal(catalogue.schemaVersion, 1, 'schemaVersion moved, which empties the list on every old Manager');
        assert.ok(Array.isArray(catalogue.modules) && catalogue.modules.length > 0, 'modules is no longer a non-empty array');

        for (const entry of catalogue.modules) {
            for (const field of ['id', 'name', 'description', 'version', 'installUrl']) {
                assert.equal(typeof entry[field], 'string', `${entry.id}: lost required field '${field}'`);
                assert.ok(entry[field].trim().length > 0, `${entry.id}: required field '${field}' is blank`);
            }
        }
    }
});
