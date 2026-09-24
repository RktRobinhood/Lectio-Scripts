/*
 * A module that stops matching what it depends on does nothing at all, which
 * looks exactly like a quiet day. The reporting half of that is checked here:
 * four modules on a timetable page whose blocks have lost the attribute and
 * the classes they read, with no Manager installed at all.
 *
 * No Manager is the point. The report event is one-way and additive, so with
 * nobody listening it must be a no-op and every module must go on working
 * exactly as it does installed alone.
 */

const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

/* Chairs Up routes off the path and every module reads its school off it, so
   the fixture is served from a Lectio-shaped URL rather than opened off disk. */
const PAGE_PATH = '/lectio/223/SkemaNy.aspx';

// Folder-qualified: each module is served from the channel it actually lives
// in, so promoting one moves its path here and nothing else changes.
const MODULES = [
    'modules/Lectio-Subject-Colours.user.js',
    'modules/Lectio-Chairs-Up.user.js',
    'modules/Lectio-Unread-Message-Notifications.user.js',
    'modules/Lectio-Change-Radar.user.js'
];

const ROUTES = new Map([
    [PAGE_PATH, {
        file: resolve(__dirname, 'fixtures', 'module-problem-reports.html'),
        type: 'text/html; charset=utf-8'
    }],
    ...MODULES.map((path) => [`/${path}`, {
        file: resolve(__dirname, '..', path),
        type: 'text/javascript; charset=utf-8'
    }])
]);

test('modules report a selector that matched nothing, and still work with no Manager', async () => {
    const profileDirectory = await createProfile('lectio-module-reports-');
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
        const { stdout } = await runChrome([
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
