/*
 * Modules clearing up after themselves, and saying what they keep (issue #29).
 *
 * The four localStorage modules on a browser that has been used for a while:
 * an expired room map, room-week snapshots for a week that has gone, cache
 * keys from versions that no longer exist, a scan lock from a tab closed
 * mid-scan, and a Change Radar snapshot for a login nobody has used in
 * months. Every one of those was already bounded, and every bound only ran on
 * a path that happened to be taken - so on a browser that opens Lectio and
 * learns nothing new, none of them ran.
 *
 * No Manager is installed, which is the point twice over: the Storage
 * Declaration is a one-way dispatch, and the prune request is one-way the
 * other way, so both ends must work with the fixture standing in and neither
 * may change how a module behaves installed alone.
 *
 * Issue #47 adds the two modules with nothing to expire, Lectio Theming and
 * Schedule Summary, for the labelling and for the one Clear worth having: the
 * background picture. The two tests after the first serve a deliberately
 * broken copy of a module from memory - the file on disk is never touched -
 * and require the fixture to fail naming the breakage, so the assertions that
 * guard a hand-built palette are known to bite rather than assumed to.
 */

const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

/* Every module here reads its school off the path, and the seeded keys are
   scoped to it, so the fixture is served from a Lectio-shaped URL rather than
   opened off disk. */
const PAGE_PATH = '/lectio/223/SkemaNy.aspx';

// Folder-qualified: each module is served from the channel it actually lives
// in, so promoting one moves its path here and nothing else changes.
const MODULES = [
    'modules/Lectio-Subject-Colours.user.js',
    'modules/Lectio-Chairs-Up.user.js',
    'modules/Lectio-Unread-Message-Notifications.user.js',
    'modules/Lectio-Change-Radar.user.js',
    'modules/Lectio-Theming.user.js',
    'modules/Lectio-Schedule-Summary.user.js'
];

const ROUTES = new Map([
    [PAGE_PATH, {
        file: resolve(__dirname, 'fixtures', 'module-storage.html'),
        type: 'text/html; charset=utf-8'
    }],
    ...MODULES.map((path) => [`/${path}`, {
        file: resolve(__dirname, '..', path),
        type: 'text/javascript; charset=utf-8'
    }])
]);

/*
 * Serves the fixture and the modules, and hands each module's source through
 * `mutate(name, source)` on the way out. The default is identity; the bite
 * tests below replace one line of one module in memory. Returns what the
 * fixture reported and the detail it wrote beside it.
 */
async function runStorageFixture(mutate = (name, source) => source) {
    const profileDirectory = await createProfile('lectio-module-storage-');
    const server = createServer(async (request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const route = ROUTES.get(pathname);

        if (!route) {
            response.writeHead(404).end();
            return;
        }

        let body = await readFile(route.file);

        if (pathname.startsWith('/modules/') || pathname.startsWith('/modules-unstable/')) {
            body = mutate(pathname.slice(pathname.lastIndexOf('/') + 1), body.toString('utf8'));
        }

        response.writeHead(200, { 'content-type': route.type });
        response.end(body);
    });

    await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
    const { port } = server.address();

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=20000',
            '--dump-dom',
            `http://127.0.0.1:${port}${PAGE_PATH}`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        return {
            result: stdout.match(/data-test-result="([^"]*)"/)?.[1],
            detail: stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1],
            stdout
        };
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
}

// A mutation that did not land is a bite test that proves nothing, so the
// replacement is required to find the line it rewrites. Line endings are
// normalised first: the files are checked out with CRLF on Windows and LF on
// the CI runner, and the line being rewritten spans two of them.
function replacing(target, from, to) {
    return (name, source) => {
        if (name !== target) return source;

        const normalised = source.replace(/\r\n/g, '\n');
        assert.ok(normalised.includes(from), `${target} no longer contains the line this bite test rewrites: ${from}`);
        return normalised.replace(from, to);
    };
}

test('modules prune their own stale caches on load and declare what they keep', async () => {
    const { result, detail, stdout } = await runStorageFixture();

    assert.equal(result, 'pass', detail || result || stdout);
});

// Theming's prune handler with its key check taken out - a handler that trusts
// whatever key the request names, which is the realistic way to get this wrong.
// The fixture's misaimed requests then cost the hand-built palette and another
// module's settings both, and it must fail naming one of them; which one is
// whichever it checks first, so either name is accepted, and nothing else is.
test('a Theming prune handler that stopped matching its declared key is caught before it costs a palette', async () => {
    const { result, detail } = await runStorageFixture(replacing(
        'Lectio-Theming.user.js',
        "if (detail?.id !== MODULE_ID || detail.key !== BACKGROUND_STORAGE_KEY) return;",
        "if (detail?.id !== MODULE_ID) return; localStorage.removeItem(detail.key);"
    ));

    assert.equal(result, 'fail', `the mutated Theming passed the fixture: ${detail}`);
    assert.match(detail,
        /A misaimed prune request deleted something: lectio(Theming\.settings\.v2|SubjectColours\.settings\.v1)/,
        detail);
});

// Schedule Summary's one declared entry offered up for deletion. A settings
// blob is never prunable, whatever its key is called, and the fixture must say
// which module offered it.
test('a Schedule Summary declaration that offers its settings for clearing is caught', async () => {
    const { result, detail } = await runStorageFixture(replacing(
        'Lectio-Schedule-Summary.user.js',
        "kind: 'setting',\n                        label: { en: 'Settings', da: 'Indstillinger' }",
        "kind: 'setting', prunable: true,\n                        label: { en: 'Settings', da: 'Indstillinger' }"
    ));

    assert.equal(result, 'fail', `the mutated Schedule Summary passed the fixture: ${detail}`);
    assert.match(detail, /schedule-summary offered to delete a setting/, detail);
});
