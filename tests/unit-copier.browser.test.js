const { createServer } = require('node:http');
const { existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

/* The copy under test: Unstable while one exists, Stable once promoted. */
const MODULE_FILE = ['modules-unstable', 'modules']
    .map((folder) => resolve(__dirname, '..', folder, 'Lectio-Unit-Copier.user.js'))
    .find((file) => existsSync(file));

/* The module @matches studieplan/forloeb_vis.aspx and reads the school off the
   path, so the fixture is served from there. */
const PAGE_PATH = '/lectio/223/studieplan/forloeb_vis.aspx';

const ROUTES = new Map([
    [PAGE_PATH, { file: resolve(__dirname, 'fixtures', 'unit-copier.html'), type: 'text/html; charset=utf-8' }],
    ['/unit-copier.user.js', { file: MODULE_FILE, type: 'text/javascript; charset=utf-8' }]
]);

async function runPage(search, profilePrefix) {
    const profileDirectory = await createProfile(profilePrefix);
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
        /* The fixture polls for the settled state. The budget covers the scan:
           up to 30 week requests with a short gap between them, which is
           virtual time here, so a run that settles early ends early. */
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=60000',
            '--dump-dom',
            `http://127.0.0.1:${port}${PAGE_PATH}${search}`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];

        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
}

/* Issue #74: the read-only planner. Default class, in-order pairing that
   skips filled and cancelled lessons and crosses a holiday week, leave
   empty, leave out, drag, both languages, and nothing but timetable GETs. */
test('Unit Copier plans a unit into the right class, in order, and only reads', async () => {
    await runPage('', 'lectio-unit-copier-');
});

test('Unit Copier offers nothing on a unit the person cannot edit', async () => {
    await runPage('?readonly=1', 'lectio-unit-copier-readonly-');
});
