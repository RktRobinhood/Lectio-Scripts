const { execFile } = require('node:child_process');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, resolve } = require('node:path');
const { promisify } = require('node:util');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile } = require('./chrome-harness');

const execFileAsync = promisify(execFile);
const chromePath = process.env.CHROME_PATH ||
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const repositoryRoot = resolve(__dirname, '..');

test('Change Radar reports only what its trackers are switched on for', async () => {
    const profileDirectory = await createProfile('lectio-change-radar-tracking-');
    const fixture = resolve(__dirname, 'fixtures', 'change-radar-tracking.html');
    const server = createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, 'http://localhost').pathname;
            const file = pathname === '/lectio/223/change-radar-tracking.html'
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
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=25000',
            '--dump-dom',
            `http://127.0.0.1:${port}/lectio/223/change-radar-tracking.html`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];
        assert.equal(result, 'pass', detail || result || stdout);
    } finally {
        await new Promise((resolveClose) => server.close(resolveClose));
        await releaseProfile(profileDirectory);
    }
});
