const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

const repositoryRoot = resolve(__dirname, '..');

/*
 * Serves a fixture at /lectio/223/<name> - the school-scoped path the module
 * reads its school id from - and everything else straight out of the
 * repository, so the fixture loads the real Manager and the real module.
 */
async function runFixture(fixtureName, { query = '', chromeArgs = [] } = {}) {
    const profileDirectory = await createProfile('lectio-subject-colours-idle-');
    const server = createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, 'http://localhost').pathname;
            const fixture = pathname.match(/^\/lectio\/223\/([\w.-]+\.html)$/);
            const file = fixture
                ? resolve(__dirname, 'fixtures', fixture[1])
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
            ...chromeArgs,
            `http://127.0.0.1:${port}/lectio/223/${fixtureName}${query}`
        ], { env: chromeEnvironment(profileDirectory) });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        const detail = stdout.match(/<pre id="test-result"[^>]*>([^<]*)<\/pre>/)?.[1];
        assert.equal(result, 'pass', `${fixtureName}${query}: ${detail || result || stdout}`);
    } finally {
        await new Promise((resolveClose) => server.close(resolveClose));
        await releaseProfile(profileDirectory);
    }
}

// The fixture adds the scripts after `load` and asserts 3.5s later, past the
// module's 2.5s Manager grace window; the budget lets headless Chrome run
// that clock forward instead of waiting it out.
const pastGraceWindow = { chromeArgs: ['--virtual-time-budget=8000'] };

/*
 * Issue #67. Tampermonkey injects the Manager and the module at document-idle
 * in an order nothing controls, and the Manager's one start-up Discovery is
 * fired during its own evaluation - so with the Manager first, the module
 * never hears it. The Automatic colour key must land in the dock in both
 * orders, and a stored choice must come back the same on the next page view.
 */
test('The Automatic colour key lands in the dock when the Manager is injected first', async () => {
    await runFixture('subject-colours-idle-order.html', { query: '?order=manager-first', ...pastGraceWindow });
});

test('The Automatic colour key lands in the dock when the module is injected first', async () => {
    await runFixture('subject-colours-idle-order.html', { query: '?order=module-first', ...pastGraceWindow });
});

test('A stored Automatic survives a reload and still lands in the dock', async () => {
    await runFixture('subject-colours-idle-order.html', { query: '?order=manager-first&stored=auto', ...pastGraceWindow });
});

test('A stored dock choice survives a reload in either injection order', async () => {
    await runFixture('subject-colours-idle-order.html', { query: '?order=manager-first&stored=dock', ...pastGraceWindow });
    await runFixture('subject-colours-idle-order.html', { query: '?order=module-first&stored=dock', ...pastGraceWindow });
});

test('A stored floating choice is honoured with the Manager present', async () => {
    await runFixture('subject-colours-idle-order.html', { query: '?order=manager-first&stored=floating', ...pastGraceWindow });
});
