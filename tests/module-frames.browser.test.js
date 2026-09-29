/*
 * Modules that draw UI or fetch in the background run on the top page only,
 * as the Manager does (issues #80, #81). The fixture explains what it asserts.
 */

const { createServer } = require('node:http');
const { existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

/* The copies under test: Unstable while one exists, Stable once promoted. */
const moduleFile = (name) => ['modules-unstable', 'modules']
    .map((folder) => resolve(__dirname, '..', folder, name))
    .find((file) => existsSync(file));

const TOP_PATH = '/lectio/223/aktivitet/aktivitetforside2.aspx';

const ROUTES = new Map([
    [TOP_PATH, resolve(__dirname, 'fixtures', 'module-frames.html')],
    ['/lectio/223/SkemaNy.aspx', resolve(__dirname, 'fixtures', 'module-frames-inner.html')],
    ['/chairs-up.user.js', moduleFile('Lectio-Chairs-Up.user.js')],
    ['/change-radar.user.js', moduleFile('Lectio-Change-Radar.user.js')]
]);

test('Chairs Up and Change Radar run on the top page and stand aside inside a frame', async () => {
    const profileDirectory = await createProfile('lectio-module-frames-');
    const server = createServer(async (request, response) => {
        const file = ROUTES.get(new URL(request.url, 'http://localhost').pathname);

        if (!file) {
            response.writeHead(404).end();
            return;
        }

        response.writeHead(200, {
            'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8'
        });
        response.end(await readFile(file));
    });

    await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
    const { port } = server.address();

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            // The frame is added after the top page's load event, and the
            // assertions wait out Change Radar's grace window after that.
            '--virtual-time-budget=20000',
            '--dump-dom',
            `http://127.0.0.1:${port}${TOP_PATH}`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];

        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
});
