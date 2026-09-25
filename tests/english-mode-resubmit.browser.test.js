const { createServer } = require('node:http');
const { existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

/* The copy under test: Unstable while one exists, Stable once promoted. */
const MODULE_FILE = ['modules-unstable', 'modules']
    .map((folder) => resolve(__dirname, '..', folder, 'Lectio-English-Mode.user.js'))
    .find((file) => existsSync(file));

const PAGE_PATH = '/lectio/223/aktivitet/aktivitetforside2.aspx';

/* Issue #72. Adding a file or link to homework is a whole-page postback, so
   the page it leaves behind is the answer to a POST. Switching language
   reloaded that page with location.reload(), which sends the POST again -
   and on Lectio that adds the material a second time. */
test('switching language after a postback does not send the postback again', async () => {
    const profileDirectory = await createProfile('lectio-english-mode-resubmit-');
    const requests = [];
    const server = createServer(async (request, response) => {
        const { pathname } = new URL(request.url, 'http://localhost');

        if (pathname === '/module.user.js') {
            response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
            response.end(await readFile(MODULE_FILE));
            return;
        }

        if (pathname !== PAGE_PATH) {
            response.writeHead(404).end();
            return;
        }

        requests.push(request.method);
        request.resume();

        const page = (await readFile(resolve(__dirname, 'fixtures', 'english-mode-resubmit.html'), 'utf8'))
            .replace('<html lang="da">', `<html lang="da" data-method="${request.method}">`);

        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(page);
    });

    await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
    const { port } = server.address();

    try {
        await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=10000',
            '--dump-dom',
            `http://127.0.0.1:${port}${PAGE_PATH}`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        /* The first load, the one postback, and then the module's reload. */
        assert.deepEqual(
            requests,
            ['GET', 'POST', 'GET'],
            `the language switch reloaded the page as ${requests.slice(2).join(', ') || 'nothing'}`
        );
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
});
