const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

const PAGE_PATH = '/lectio/223/SkemaNy.aspx';
const MODULE_PATH = '/modules/Lectio-Chairs-Up.user.js';

const ROUTES = new Map([
    [PAGE_PATH, {
        file: resolve(__dirname, 'fixtures', 'chairs-up-brick-overflow.html'),
        type: 'text/html; charset=utf-8'
    }],
    [MODULE_PATH, {
        file: resolve(__dirname, '..', 'modules', 'Lectio-Chairs-Up.user.js'),
        type: 'text/javascript; charset=utf-8'
    }]
]);

/* Issue #73. Chairs Up set overflow: visible on every lesson block so its
   badge could hang over the corner, which also switched off Lectio's own
   clipping: the text of every short lesson spilled out of its box. */
test('lesson text stays inside its block, and the badge still hangs over the corner', async () => {
    const profileDirectory = await createProfile('lectio-chairs-up-brick-overflow-');
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
            '--virtual-time-budget=5000',
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
