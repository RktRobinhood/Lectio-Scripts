const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

async function runFixture(fixtureName, profilePrefix, query = '', extraArguments = []) {
    const profileDirectory = await createProfile(profilePrefix);
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', fixtureName)).href + query;

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            ...extraArguments,
            '--dump-dom',
            fixtureUrl
        ], { env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
    } finally {
        await releaseProfile(profileDirectory);
    }
}

test('manager dock supports lifecycle, activation, panels, ordering, and placement', async () => {
    await runFixture('manager-dock.html', 'lectio-manager-dock-');
});

// A dock tooltip used to close itself a moment after it appeared, because every
// renderDock() hid it blindly - so one module's poll dismissed the tooltip of
// whatever item the pointer was resting on, for every item in the dock. The
// pointer never fires a second pointerenter, so nothing brought it back
// (issue #48). The same fixture covers the keyboard path, what reaches a screen
// reader, and both languages, because they are the same few functions.
test('a dock tooltip survives another module rendering, answers the keyboard, and follows the language', async () => {
    await runFixture('manager-dock-tooltip.html', 'lectio-manager-dock-tooltip-', '', ['--virtual-time-budget=6000']);
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

// The Manager runs on every Lectio page and most of them never see its panel
// opened, so the panel DOM, the panel stylesheet and the first module-list
// render wait for the first gear click. Everything that happens before that
// click has to survive the panel's absence without throwing, and nothing it
// collected may be lost when the panel finally arrives.
test('manager builds its panel on first open, not on every page load', async () => {
    await runFixture('manager-lazy-panel.html', 'lectio-manager-lazy-', '', ['--virtual-time-budget=6000']);
});

// The problem log is recorded before anything is on screen and pasted into a
// public repository afterwards, so both ends are checked: that capture beats
// the panel and cannot throw without one, that the log stays bounded, and that
// a name, a message subject and a school-scoped URL in a captured error message
// do not survive into what a user copies.
test('manager records a bounded, redacted problem log before its panel exists', async () => {
    await runFixture('manager-problem-log.html', 'lectio-manager-log-', '?phase=one', ['--virtual-time-budget=6000']);
});

// The state most browsers are in is the empty one, and it used to answer
// "nothing has been recorded" above a full report preview and two live-looking
// buttons, one of which emptied an already-empty list. The empty section is now
// only the notice, a first entry brings the frame back with no reopen, and the
// count on the collapsed summary finishes the trail the gear's mark starts.
test('manager shows an empty problem log as one notice, and counts unseen entries on its summary', async () => {
    await runFixture('manager-problem-log-empty.html', 'lectio-manager-log-empty-', '', ['--virtual-time-budget=6000']);
});

// The storage readout is the only place the Manager looks at data it does not
// own, and the only place it can destroy any. The seam is what is checked: it
// measures localStorage and takes everything else from a module's declaration,
// a module that declares nothing is not guessed at, and a prune removes
// exactly what was declared prunable - by the owning module, never by the
// Manager, and never another module's key or one that merely looks like the
// Manager's own.
test('manager measures storage generically and prunes only what a module declared', async () => {
    await runFixture('manager-storage.html', 'lectio-manager-storage-', '', ['--virtual-time-budget=6000']);
});

// The same readout against the two real modules that joined it last (issue
// #47), loaded from modules/ now that both have been promoted. Lectio Theming and Schedule Summary are listed as claimed
// under their catalogue names with exactly the rows they declared, the one
// Clear is the background picture's, pressing it goes through the module and
// leaves the hand-built palette beside it untouched, and a key nobody claims
// is still listed afterwards.
test('manager lists Theming and Schedule Summary as claimed and clears only the background picture', async () => {
    await runFixture('manager-storage-modules.html', 'lectio-manager-storage-modules-', '', ['--virtual-time-budget=6000']);
});

// A settings file leaves this browser and comes back into an authenticated
// Lectio session, so both directions are checked: that a file carries the
// declared settings and nothing else - no learned data, no caches, no problem
// log - and that a file arriving from anywhere cannot apply a value the
// running module has not said it will take, be rendered as markup, or be
// applied at all when the file itself does not add up.
test('manager exports only declared settings and imports nothing it cannot validate', async () => {
    await runFixture('manager-settings-file.html', 'lectio-manager-settings-file-', '', ['--virtual-time-budget=6000']);
});

// Nothing else can tell the Manager it is stale, so it reads its own catalogue
// entry. The notice must appear only for a genuinely newer version behind an
// install link on this repository's raw host. The entry may carry a changelog
// (#46), shown under the version line with the bounds a module's has: absent
// renders the notice exactly as before, markup arrives as characters, an
// over-long line is capped, and Danish picks the translation.
test('manager notices when the catalogue advertises a newer Manager than itself', async () => {
    for (const phase of ['newer', 'older', 'unapproved', 'missing', 'noted', 'noted-da', 'hostile', 'huge']) {
        await runFixture('manager-self-update.html', 'lectio-manager-self-', `?phase=${phase}`);
    }
});
