/*
 * Chairs Up's `lesson-bricks` drift report fires only for a block it should
 * have read (issue #79). The fixture explains the four cases.
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
    .map((folder) => resolve(__dirname, '..', folder, 'Lectio-Chairs-Up.user.js'))
    .find((file) => existsSync(file));

/* Chairs Up routes off the path, so the fixture is served from one. */
const PAGE_PATH = '/lectio/223/SkemaNy.aspx';

for (const fixtureCase of ['all-day', 'decoration', 'timed-without-s2brik', 'no-tooltip']) {
    test(`Chairs Up drift report: ${fixtureCase}`, async () => {
        const profileDirectory = await createProfile('lectio-chairs-up-drift-');
        const server = createServer(async (request, response) => {
            const { pathname } = new URL(request.url, 'http://localhost');
            const file = pathname === PAGE_PATH
                ? resolve(__dirname, 'fixtures', 'chairs-up-drift.html')
                : pathname === '/chairs-up.user.js' ? MODULE_FILE : null;

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
                '--virtual-time-budget=5000',
                '--dump-dom',
                `http://127.0.0.1:${port}${PAGE_PATH}?case=${fixtureCase}`
            ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

            const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
            const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];

            assert.equal(result, 'pass', detail || result || stdout);
        } finally {
            await new Promise((closed) => server.close(closed));
            await releaseProfile(profileDirectory);
        }
    });
}
