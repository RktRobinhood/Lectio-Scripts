/*
 * The module half of the request-slot contract
 * (docs/manager-request-slots.md). All four background-fetching modules on
 * one page, five times over, against five different Managers.
 *
 * Four of the five are about a Manager that cannot help: missing, old,
 * silent, or one that acknowledged a request and then stopped. A module that
 * hangs waiting for a turn is strictly worse than the simultaneous requests
 * this exists to spread out, so those four are the point of the file and the
 * serialisation run is the one that shows it was worth doing.
 *
 * The `old` run is not a mock. It is Manager 1.27.0 exactly as it reached
 * origin/main, pulled out of git the same way tests/catalogue-compat does -
 * a Manager that has genuinely never heard of a slot.
 */

const { execFileSync } = require('node:child_process');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

const repositoryRoot = resolve(__dirname, '..');

// The last Manager published before request slots existed. Same commit the
// SHIPPED_MANAGERS row in tests/catalogue-compat.browser.test.js pins.
const MANAGER_BEFORE_SLOTS = '4be2312';

// Every module reads its school off the path, and Chairs Up routes off it, so
// the fixture is served from a Lectio-shaped URL rather than opened off disk.
const PAGE_PATH = '/lectio/223/SkemaNy.aspx';

const SCENARIOS = [
    ['none', 'no Manager at all'],
    ['silent', 'a Manager that answers Discovery and has never heard of slots'],
    ['acked', 'a Manager that acknowledges a request and then stops'],
    ['old', 'Manager 1.27.0, the real last release before slots'],
    ['real', 'the Manager in this working tree']
];

test('every module fetches whatever the Manager does, and takes turns when there is one', async (t) => {
    const oldManager = execFileSync(
        'git',
        ['show', `${MANAGER_BEFORE_SLOTS}:manager/Lectio-Manager.user.js`],
        { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );

    const fixture = resolve(__dirname, 'fixtures', 'module-request-slots.html');
    const server = createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, 'http://localhost').pathname;

            if (pathname === '/manager-old.js') {
                response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
                response.end(oldManager);
                return;
            }

            const file = pathname === PAGE_PATH
                ? fixture
                : resolve(repositoryRoot, pathname.replace(/^\/+/, ''));
            const body = await readFile(file);
            const type = extname(file) === '.js' ? 'text/javascript' : 'text/html';
            response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
            response.end(body);
        } catch (_) {
            response.writeHead(404).end('Not found');
        }
    });

    await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
    const { port } = server.address();

    try {
        for (const [scenario, description] of SCENARIOS) {
            await t.test(description, async () => {
                const profileDirectory = await createProfile(`lectio-module-slots-${scenario}-`);

                try {
                    /* The budget has to cover the fixture's own observation
                       window, which is 45s: the brokered run takes twelve
                       stubbed requests strictly in turn, and an acknowledged
                       module waits out its own eight-second ceiling on top of
                       Subject Colours not arming a scan until 1.8s. Chrome
                       runs it on a virtual clock and fast-forwards the idle
                       stretches, so a virtual minute and a half costs a few
                       seconds of real time - the same few seconds the 60s
                       budget before it did. */
                    const { stdout } = await runChrome([
                        '--headless=new',
                        '--disable-gpu',
                        `--user-data-dir=${profileDirectory}`,
                        '--virtual-time-budget=90000',
                        '--dump-dom',
                        `http://127.0.0.1:${port}${PAGE_PATH}?scenario=${scenario}`
                    ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

                    const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
                    const detail = stdout.match(/<pre id="test-result"[^>]*>([\s\S]*?)<\/pre>/)?.[1];

                    assert.equal(result, 'pass', detail || result || stdout);
                } finally {
                    await releaseProfile(profileDirectory);
                }
            });
        }
    } finally {
        await new Promise((closed) => server.close(closed));
    }
});
