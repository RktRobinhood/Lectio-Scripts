const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

/* Chairs Up only does background work where the path names a school and a
   timetable, so the fixture has to be served from a Lectio-shaped URL rather
   than opened off disk. */
const TIMETABLE_PATH = '/lectio/223/SkemaNy.aspx';
const MODULE_PATH = '/modules-unstable/Lectio-Chairs-Up.user.js';

const ROUTES = new Map([
    [TIMETABLE_PATH, {
        file: resolve(__dirname, 'fixtures', 'chairs-up-fetch-safety.html'),
        type: 'text/html; charset=utf-8'
    }],
    [MODULE_PATH, {
        file: resolve(__dirname, '..', 'modules-unstable', 'Lectio-Chairs-Up.user.js'),
        type: 'text/javascript; charset=utf-8'
    }]
]);

test('a hung Lectio request times out, and the next one never stacks on it', async () => {
    const profileDirectory = await createProfile('lectio-chairs-up-fetch-');
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
        /* The fixture's requests only end on the module's own eight-second
           timeout, so the run needs more virtual time than that to reach its
           assertions. */
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=25000',
            '--dump-dom',
            `http://127.0.0.1:${port}${TIMETABLE_PATH}`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];

        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
});
