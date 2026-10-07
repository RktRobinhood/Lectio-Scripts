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

/* The module routes on the path and reads the school off it, so each fixture
   is served from the Lectio page it stands for. */
const ROUTES = new Map([
    ['/lectio/223/studieplan/forloeb_vis.aspx', resolve(__dirname, 'fixtures', 'unit-copier-unit.html')],
    ['/lectio/223/studieplan/forloeb_kopier.aspx', resolve(__dirname, 'fixtures', 'unit-copier-form.html')],
    ['/unit-copier.user.js', MODULE_FILE]
]);

async function runPage(pathAndQuery, profilePrefix) {
    const profileDirectory = await createProfile(profilePrefix);
    const server = createServer(async (request, response) => {
        const file = ROUTES.get(new URL(request.url, 'http://localhost').pathname);

        if (!file) {
            response.writeHead(404).end();
            return;
        }

        response.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
        response.end(await readFile(file));
    });

    await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
    const { port } = server.address();

    try {
        /* The fixtures poll for the settled state; the budget only has to
           cover a few mocked requests and the class check's interval, and a
           run that settles early ends early. */
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=30000',
            '--dump-dom',
            `http://127.0.0.1:${port}${pathAndQuery}`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];

        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
}

/* Issue #74. On a copied unit: finds last year's unit through Lectio's own
   picker, lines it up in order, explains what is waiting, and lets the plan
   be adjusted and kept - reading only. */
test('Unit Copier plans a copied unit from the unit it was copied from', async () => {
    await runPage('/lectio/223/studieplan/forloeb_vis.aspx', 'lectio-unit-copier-unit-');
});

test('Unit Copier stays out of a unit the person cannot edit', async () => {
    await runPage('/lectio/223/studieplan/forloeb_vis.aspx?readonly=1', 'lectio-unit-copier-readonly-');
});

test('Unit Copier says so when it cannot tell where a fresh copy came from', async () => {
    await runPage('/lectio/223/studieplan/forloeb_vis.aspx?unrelated=1', 'lectio-unit-copier-unrelated-');
});

test('Unit Copier never offers to copy a newer unit into an older one', async () => {
    await runPage('/lectio/223/studieplan/forloeb_vis.aspx?backwards=1', 'lectio-unit-copier-backwards-');
});

/* On Lectio's Kopiér form: explains it, catches a class the type-ahead stored
   by mistake, and suggests a Periode from the published timetable. */
test('Unit Copier explains Kopiér, checks the stored class, and suggests a Periode', async () => {
    await runPage('/lectio/223/studieplan/forloeb_kopier.aspx', 'lectio-unit-copier-form-');
});

test('Unit Copier estimates the Periode when the timetable is not published far enough', async () => {
    await runPage('/lectio/223/studieplan/forloeb_kopier.aspx?short=1', 'lectio-unit-copier-form-short-');
});
