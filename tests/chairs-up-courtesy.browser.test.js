const { createServer } = require('node:http');
const { existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

const FIXTURE = resolve(__dirname, 'fixtures', 'chairs-up-courtesy.html');
/* The copy under test: Unstable while one exists, Stable once promoted. */
const MODULE_FILE = ['modules-unstable', 'modules']
    .map((folder) => resolve(__dirname, '..', folder, 'Lectio-Chairs-Up.user.js'))
    .find((file) => existsSync(file));

const ROUTES = new Map([
    ['/lectio/223/SkemaNy.aspx', { file: FIXTURE, type: 'text/html; charset=utf-8' }],
    ['/lectio/223/aktivitet/aktivitetforside2.aspx', { file: FIXTURE, type: 'text/html; charset=utf-8' }],
    ['/chairs-up.user.js', { file: MODULE_FILE, type: 'text/javascript; charset=utf-8' }]
]);

async function runPage(pagePath, profilePrefix) {
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
        /* The fixture polls for the settled state; the budget only has to
           cover the module's start jitter and its one unanswered slot
           request, and a run that finishes early ends early. */
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=30000',
            '--dump-dom',
            `http://127.0.0.1:${port}${pagePath}`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];

        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
}

/* Issue #83: yellow when exactly one class has the room after this lesson
   and our class is more than the chosen ratio (1.5 by default) times its
   size; nothing when that cannot be known. */
test('timetable: courtesy marker follows the ratio and never guesses', async () => {
    await runPage('/lectio/223/SkemaNy.aspx', 'lectio-chairs-up-courtesy-timetable-');
});

test('activity page: courtesy notice for a lesson with a much smaller class after it', async () => {
    await runPage('/lectio/223/aktivitet/aktivitetforside2.aspx?absid=8102', 'lectio-chairs-up-courtesy-activity-');
});
