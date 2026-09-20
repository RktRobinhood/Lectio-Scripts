const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

/* Chairs Up only runs where the path names a school and an activity page,
   so this fixture has to be served from a Lectio-shaped URL rather than
   opened off disk like the others. */
const ACTIVITY_PATH = '/lectio/223/aktivitet/aktivitetforside2.aspx';
const MODULE_PATH = '/modules/Lectio-Chairs-Up.user.js';

const ROUTES = new Map([
    [ACTIVITY_PATH, {
        file: resolve(__dirname, 'fixtures', 'chairs-up-notice.html'),
        type: 'text/html; charset=utf-8'
    }],
    [MODULE_PATH, {
        file: resolve(__dirname, '..', 'modules', 'Lectio-Chairs-Up.user.js'),
        type: 'text/javascript; charset=utf-8'
    }]
]);

async function startFixtureServer() {
    const server = createServer(async (request, response) => {
        const route = ROUTES.get(new URL(request.url, 'http://localhost').pathname);

        if (!route) {
            response.writeHead(404).end();
            return;
        }

        response.writeHead(200, { 'content-type': route.type });
        response.end(await readFile(route.file));
    });

    await new Promise((done) => server.listen(0, '127.0.0.1', done));

    return server;
}

test('the activity notice stays clear of the page and of Lectio overlays', async () => {
    const profileDirectory = await createProfile('lectio-chairs-up-');
    const server = await startFixtureServer();
    const origin = `http://127.0.0.1:${server.address().port}`;

    const runLayout = async (layout, size) => {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--window-size=${size}`,
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            `${origin}${ACTIVITY_PATH}?absid=81266224407&layout=${layout}`
        ], { env: chromeEnvironment(profileDirectory) });
        return stdout;
    };

    try {
        /* Wide enough for the gutter beside the activity paper, then narrow
           enough that there is none. */
        const wide = await runLayout('wide', '1440,900');
        assert.match(wide, /data-test-result="pass"/, wide);

        const narrow = await runLayout('narrow', '420,900');
        assert.match(narrow, /data-test-result="pass"/, narrow);
    } finally {
        await new Promise((done) => server.close(done));
        await releaseProfile(profileDirectory);
    }
});
