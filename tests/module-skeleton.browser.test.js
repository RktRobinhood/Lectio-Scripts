/*
 * The module skeleton in templates/ ships to nobody, but it is the thing every
 * new module is copied from, so a break in it is a break seeded into every
 * module written after it. This drives it exactly as a Lectio page would: once
 * with no Manager listening at all, then with a stub Manager playing the
 * Discovery, settings, preview and dock-panel parts, then through teardown.
 */
const { execFile } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);
const chromePath = process.env.CHROME_PATH ||
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

const skeletonPath = resolve(__dirname, '..', 'templates', 'Lectio-Module-Skeleton.user.js');

test('the module skeleton loads clean with and without the Manager, and tears down', async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'lectio-module-skeleton-'));
    const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'module-skeleton.html')).href;

    try {
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            fixtureUrl
        ]);

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', result || stdout);
    } finally {
        await rm(profileDirectory, { recursive: true, force: true });
    }
});

/*
 * The version triple is the one thing check-versions.mjs cannot police here:
 * it reads manager/, modules/ and modules-unstable/ only, and the template is
 * deliberately in neither catalogue. The header and the registered version
 * still have to agree, or the skeleton teaches the mistake it warns about.
 */
test('the skeleton\'s header version and registered version agree', () => {
    const source = readFileSync(skeletonPath, 'utf8');
    const header = source.match(/@version\s+(\S+)/)?.[1];
    const registered = source.match(/MODULE_VERSION\s*=\s*'([^']+)'/)?.[1];

    assert.match(header ?? '', /^\d+\.\d+\.\d+$/, 'no three-part @version in the header');
    assert.equal(registered, header, '@version and MODULE_VERSION disagree');
});
