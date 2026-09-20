const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

const repositoryRoot = resolve(__dirname, '..');

test('Change Radar can move between its floating HUD and the shared Manager dock', async () => {
    const profileDirectory = await createProfile('lectio-change-radar-dock-');
    const fixture = resolve(__dirname, 'fixtures', 'change-radar-dock.html');
    const server = createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, 'http://localhost').pathname;
            const file = pathname === '/lectio/223/change-radar-dock.html'
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
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            `http://127.0.0.1:${port}/lectio/223/change-radar-dock.html`
        ], { env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];
        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((resolveClose) => server.close(resolveClose));
        await releaseProfile(profileDirectory);
    }
});
