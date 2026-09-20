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
 */

const { execFile } = require('node:child_process');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { promisify } = require('node:util');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile } = require('./chrome-harness');

const execFileAsync = promisify(execFile);
const chromePath = process.env.CHROME_PATH ||
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

/* Every module here reads its school off the path, and the seeded keys are
   scoped to it, so the fixture is served from a Lectio-shaped URL rather than
   opened off disk. */
const PAGE_PATH = '/lectio/223/SkemaNy.aspx';

const MODULES = [
    'Lectio-Subject-Colours.user.js',
    'Lectio-Chairs-Up.user.js',
    'Lectio-Unread-Message-Notifications.user.js',
    'Lectio-Change-Radar.user.js'
];

const ROUTES = new Map([
    [PAGE_PATH, {
        file: resolve(__dirname, 'fixtures', 'module-storage.html'),
        type: 'text/html; charset=utf-8'
    }],
    ...MODULES.map((name) => [`/modules-unstable/${name}`, {
        file: resolve(__dirname, '..', 'modules-unstable', name),
        type: 'text/javascript; charset=utf-8'
    }])
]);

test('modules prune their own stale caches on load and declare what they keep', async () => {
    const profileDirectory = await createProfile('lectio-module-storage-');
    const server = createServer(async (request, response) => {
        const route = ROUTES.get(new URL(request.url, 'http://localhost').pathname);

        if (!route) {
            response.writeHead(404).end();
            return;
        }

        response.writeHead(200, { 'content-type': route.type });
        response.end(await readFile(route.file));
    });

    await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
    const { port } = server.address();

    try {
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=20000',
            '--dump-dom',
            `http://127.0.0.1:${port}${PAGE_PATH}`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];

        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
});
