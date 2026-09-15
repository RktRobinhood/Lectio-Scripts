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

test('subject colours are learned from a repeating timetable and keep their own colour space', async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'lectio-subject-colours-'));
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'subject-colours.html')).href;
    const runFixture = async (phase) => {
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            phase ? `${fixtureUrl}?phase=${phase}` : fixtureUrl
        ]);
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
    } finally {
        await rm(profileDirectory, { recursive: true, force: true });
    }
});
