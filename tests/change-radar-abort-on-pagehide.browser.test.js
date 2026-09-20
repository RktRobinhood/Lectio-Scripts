const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

const repositoryRoot = resolve(__dirname, '..');

test('Change Radar aborts an in-flight request when the page goes away, frozen or not', async () => {
    const profileDirectory = await createProfile('lectio-change-radar-abort-on-pagehide-');
    const fixture = resolve(__dirname, 'fixtures', 'change-radar-abort-on-pagehide.html');
    const server = createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, 'http://localhost').pathname;
            const file = pathname === '/lectio/223/change-radar-abort-on-pagehide.html'
                ? fixture
                : resolve(repositoryRoot, pathname.replace(/^\/+/, ''));
            const body = await readFile(file);
            const contentType = extname(file) === '.js' ? 'text/javascript' : 'text/html';
            response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
            response.end(body);
        } catch (_) {
            response.writeHead(404);
            response.end('Not found');
        }
    });

    await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening));
    const { port } = server.address();

    try {
        /* A three-second jittered start, a freeze, a restored check left to
           run the full twenty-second timeout, and one more request ended by a
           terminal pagehide: a virtual minute or so, with room to spare. */
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=300000',
            '--dump-dom',
            `http://127.0.0.1:${port}/lectio/223/change-radar-abort-on-pagehide.html`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];
        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((resolveClose) => server.close(resolveClose));
        await releaseProfile(profileDirectory);
    }
});
