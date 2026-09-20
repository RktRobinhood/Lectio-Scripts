const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

test('subject colours are learned from a repeating timetable and keep their own colour space', async () => {
    const profileDirectory = await createProfile('lectio-subject-colours-');
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'subject-colours.html')).href;
    // Each phase runs its own Chrome and builds on what the ones before it
    // learned, but the profile on disk is not what carries that. Chrome's
    // storage service commits localStorage on a batching timer, and a
    // --dump-dom process exits as soon as the DOM is printed, so a phase's
    // writes may simply not be there when the next phase opens the profile
    // (issue #35). Losing the opening phase's write is what produced "a
    // twice-weekly hold was not recognised as a class" out of a good tree.
    // So the storage comes back out of each dump and goes into the next
    // phase through the fixture's own #state= hash instead.
    let carried = '';

    // A phase that has to outlast a timer needs Chrome to keep the page alive
    // past the load event, which a virtual-time budget does by fast-forwarding
    // its clock instead of making the suite wait in real time.
    const runFixture = async (phase, { virtualTimeMs = 0 } = {}) => {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            ...(virtualTimeMs ? [`--virtual-time-budget=${virtualTimeMs}`] : []),
            '--dump-dom',
            `${phase ? `${fixtureUrl}?phase=${phase}` : fixtureUrl}${carried ? `#state=${carried}` : ''}`
        ], { env: chromeEnvironment(profileDirectory) });

        // A phase that reported no storage has broken the chain, and every
        // later phase would then be testing a blank slate it was never meant
        // to see. That is a failure in its own right, not something to carry
        // an empty string past.
        const handover = stdout.match(/<pre id="test-state">([^<]*)<\/pre>/);
        assert.ok(handover, `the ${phase || 'first'} phase did not hand its storage on:\n${stdout}`);
        carried = handover[1];

        return stdout;
    };

    try {
        // One week of evidence is not a class yet.
        const firstWeek = await runFixture('');
        assert.match(firstWeek, /data-test-result="pass"/, firstWeek);

        // A second week of the same holds is.
        const secondWeek = await runFixture('second');
        assert.match(secondWeek, /data-test-result="pass"/, secondWeek);

        // The same classes under a dark theme come back dark.
        const darkTheme = await runFixture('dark');
        assert.match(darkTheme, /data-test-result="pass"/, darkTheme);

        // Somebody else's timetable colours the same holds but teaches the
        // module nothing about how often they are yours.
        const roomView = await runFixture('room&type=lokale');
        assert.match(roomView, /data-test-result="pass"/, roomView);

        // A block another colouring extension has claimed is left alone.
        const foreignColours = await runFixture('foreign');
        assert.match(foreignColours, /data-test-result="pass"/, foreignColours);

        // A hand-picked colour asked to be kept exactly comes out identical
        // under a light theme and a dark one. The light run records it; the
        // dark run is the one that can fail.
        const lockedLight = await runFixture('locked-light');
        assert.match(lockedLight, /data-test-result="pass"/, lockedLight);

        const lockedDark = await runFixture('locked');
        assert.match(lockedDark, /data-test-result="pass"/, lockedDark);

        // A built-in theme whose own text colour is too middling to ever
        // clear the contrast bar (Solarized Light) must not be able to wash
        // every class out to the same white block.
        const solarized = await runFixture('solarized');
        assert.match(solarized, /data-test-result="pass"/, solarized);

        // The on-page colour key lists exactly the classes on screen, starts
        // collapsed, and lets a class be recoloured directly from it.
        const legend = await runFixture('legend');
        assert.match(legend, /data-test-result="pass"/, legend);

        // The same colour key can be handed to the Manager-owned dock without
        // leaving its old floating control behind.
        const dock = await runFixture('dock');
        assert.match(dock, /data-test-result="pass"/, dock);

        // Left on automatic, the key goes to the dock when a Manager answers
        // Discovery, and falls back to the page when none ever does.
        const autoDock = await runFixture('auto-dock');
        assert.match(autoDock, /data-test-result="pass"/, autoDock);

        const autoFloating = await runFixture('auto-floating', { virtualTimeMs: 12000 });
        assert.match(autoFloating, /data-test-result="pass"/, autoFloating);

        // An install carrying 0.7.0's persisted 'floating' is moved to automatic
        // once, so the dock default reaches people who already had the module.
        const legacyFloating = await runFixture('legacy-floating');
        assert.match(legacyFloating, /data-test-result="pass"/, legacyFloating);

        // Turning the key off in settings removes it from the page entirely.
        const legendOff = await runFixture('legend-off');
        assert.match(legendOff, /data-test-result="pass"/, legendOff);

        // The optional per-class shape marker (issue #19): off by default,
        // anchored bottom-right at its base size, and never applied to a
        // one-off when it is switched on.
        const pattern = await runFixture('pattern');
        assert.match(pattern, /data-test-result="pass"/, pattern);

        // The marker's own size setting actually resizes it.
        const patternScale = await runFixture('pattern-scale');
        assert.match(patternScale, /data-test-result="pass"/, patternScale);
    } finally {
        await releaseProfile(profileDirectory);
    }
});
