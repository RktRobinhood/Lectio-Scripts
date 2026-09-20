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

async function runFixture(fixtureName, profilePrefix, query = '', extraArguments = []) {
    const profileDirectory = await mkdtemp(join(tmpdir(), profilePrefix));
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', fixtureName)).href + query;

    try {
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            ...extraArguments,
            '--dump-dom',
            fixtureUrl
        ]);

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
    } finally {
        await rm(profileDirectory, { recursive: true, force: true });
    }
}

test('manager dock supports lifecycle, activation, panels, ordering, and placement', async () => {
    await runFixture('manager-dock.html', 'lectio-manager-dock-');
});

// Tampermonkey runs the Manager at document-idle, so init() is reached before
// the rest of the file has been evaluated. Loading it with a plain script tag,
// as every other fixture does, hides anything init needs that is declared below
// the boot block - and that is a ReferenceError for every real user.
test('manager boots when it is injected into an already-loaded page', async () => {
    // This fixture reports after the load event, so Chrome has to keep running
    // past it rather than dumping the DOM the moment loading finishes.
    await runFixture('manager-late-inject.html', 'lectio-manager-late-', '', ['--virtual-time-budget=6000']);
});

// Switching channel re-reads that channel's catalogue, and that refresh can be
// queued behind the one the Manager starts as it boots - so this fixture waits
// for the request and reports after the load event.
test('manager migrates v1 dock placement and renders the channel as one dropdown', async () => {
    await runFixture('manager-prefs.html', 'lectio-manager-prefs-', '', ['--virtual-time-budget=6000']);
});

// Lectio is Danish and serves lang="da", but the Manager is mainly for IB
// students, so it starts in English and publishes whatever is chosen for modules
// to follow.
test('manager starts in English, remembers Danish, and publishes the choice', async () => {
    for (const phase of ['fresh', 'stored-da']) {
        await runFixture('manager-language.html', 'lectio-manager-lang-', `?phase=${phase}`);
    }
});

// Nothing else can tell the Manager it is stale, so it reads its own catalogue
// entry. The notice must appear only for a genuinely newer version behind an
// install link on this repository's raw host.
test('manager notices when the catalogue advertises a newer Manager than itself', async () => {
    for (const phase of ['newer', 'older', 'unapproved', 'missing']) {
        await runFixture('manager-self-update.html', 'lectio-manager-self-', `?phase=${phase}`);
    }
});
