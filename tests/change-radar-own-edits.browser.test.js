/*
 * Change Radar leaves out a change the teacher made to a lesson themselves
 * (issue #84), and one entry can be removed from the log on its own (issue
 * #85). The fixture explains the rounds.
 */

const { createServer } = require('node:http');
const { existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

/* The copy under test: Unstable while one exists, Stable once promoted. */
const MODULE_FILE = ['modules-unstable', 'modules']
    .map((folder) => resolve(__dirname, '..', folder, 'Lectio-Change-Radar.user.js'))
    .find((file) => existsSync(file));

/* A teacher's own activity page: the path says which lesson is being
   edited, and laererid says whose account this is. */
const PAGE_PATH = '/lectio/223/aktivitet/aktivitetforside2.aspx';

test('Change Radar skips a teacher\'s own edit and removes one entry at a time', async () => {
    const profileDirectory = await createProfile('lectio-change-radar-own-edits-');
    const server = createServer(async (request, response) => {
        const { pathname } = new URL(request.url, 'http://localhost');
        const file = pathname === PAGE_PATH
            ? resolve(__dirname, 'fixtures', 'change-radar-own-edits.html')
            : pathname === '/change-radar.user.js' ? MODULE_FILE : null;

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
            '--virtual-time-budget=25000',
            '--dump-dom',
            `http://127.0.0.1:${port}${PAGE_PATH}?absid=900001&laererid=1`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];
        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
});
