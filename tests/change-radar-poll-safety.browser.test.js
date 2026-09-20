const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

const repositoryRoot = resolve(__dirname, '..');

test('Change Radar jitters its first check, never stacks, backs off, recovers and survives the bfcache', async () => {
    const profileDirectory = await createProfile('lectio-change-radar-poll-safety-');
    const fixture = resolve(__dirname, 'fixtures', 'change-radar-poll-safety.html');
    const server = createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, 'http://localhost').pathname;
            const file = pathname === '/lectio/223/change-radar-poll-safety.html'
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
        /* A three-second jittered start, a hung request ended only by the
           module's own twenty-second timeout, and then a five-minute wait for
           the poll timer the bfcache restore had to re-arm: the run needs the
           better part of a virtual ten minutes to reach its assertions. */
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=900000',
            '--dump-dom',
            `http://127.0.0.1:${port}/lectio/223/change-radar-poll-safety.html`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];
        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((resolveClose) => server.close(resolveClose));
        await releaseProfile(profileDirectory);
    }
});
