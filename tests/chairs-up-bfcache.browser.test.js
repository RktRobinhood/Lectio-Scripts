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

/* Chairs Up only does background work where the path names a school and a
   timetable, so the fixture has to be served from a Lectio-shaped URL rather
   than opened off disk. */
const TIMETABLE_PATH = '/lectio/223/SkemaNy.aspx';
const MODULE_PATH = '/modules-unstable/Lectio-Chairs-Up.user.js';

const ROUTES = new Map([
    [TIMETABLE_PATH, {
        file: resolve(__dirname, 'fixtures', 'chairs-up-bfcache.html'),
        type: 'text/html; charset=utf-8'
    }],
    [MODULE_PATH, {
        file: resolve(__dirname, '..', 'modules-unstable', 'Lectio-Chairs-Up.user.js'),
        type: 'text/javascript; charset=utf-8'
    }]
]);

async function runPhase(phase, profilePrefix) {
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
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=45000',
            '--dump-dom',
            `http://127.0.0.1:${port}${TIMETABLE_PATH}?phase=${phase}`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];

        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
}

/* Issue #41. The bfcache does not re-execute a userscript, so a pagehide
   listener that is spent after one call, plus a flag nothing can lift, leaves
   a restored page silently switched off for the rest of its life. */
test('a page restored from the back/forward cache goes back to fetching', async () => {
    await runPhase('restore', 'lectio-chairs-up-bfcache-restore-');
});

test('a page that is genuinely going away aborts and stays aborted', async () => {
    await runPhase('terminal', 'lectio-chairs-up-bfcache-terminal-');
});
