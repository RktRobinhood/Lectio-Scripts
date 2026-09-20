/*
 * The Catalogue is read by Managers this repository no longer controls.
 *
 * Users install the Manager once and update it through Tampermonkey, whose
 * update check is off by default - so old versions stay in the wild for a long
 * time, and a Catalogue that a shipped Manager cannot parse breaks the module
 * list for everyone still on it, silently and all at once. There is no server to
 * roll back and no way to reach those installs.
 *
 * So every Manager version that has ever been published is run against the
 * Catalogue as it stands right now, and must still list every module.
 *
 * Adding a field is safe, and this proves it rather than assuming it: every
 * shipped validateCatalogue copies named fields into a fresh object, so a key it
 * has never heard of is ignored by construction. Removing or renaming a required
 * field is what would break them, and that is what this test is here to catch.
 */

const { execFile, execFileSync } = require('node:child_process');
const { mkdtemp, rm, writeFile, copyFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const test = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);
const chromePath = process.env.CHROME_PATH ||
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

const repoRoot = resolve(__dirname, '..');

/*
 * Every Manager version that has been published, oldest first, pinned to the
 * commit that shipped it. Add a row here whenever a Manager version reaches
 * origin/main; never remove one, because removing a row does not remove that
 * version from anyone's browser.
 */
const SHIPPED_MANAGERS = [
    { version: '1.16.0', commit: '9886d17' },
    { version: '1.17.0', commit: '4041394' },
    { version: '1.18.0', commit: 'd666778' },
    { version: '1.19.0', commit: '1880e11' },
    { version: '1.20.0', commit: 'afa839a' },
    { version: '1.20.1', commit: '64245bf' },
    { version: '1.21.1', commit: 'b0a475b' },
    { version: '1.21.2', commit: '6d6db4c' }
];

/*
 * 1.21.0 (146d29f) is deliberately absent. It reached origin/main and was
 * replaced by 1.21.1 within the hour: it referenced a const declared below its
 * own boot block, so at document-idle it threw before building anything. A
 * Manager that never boots lists no modules whatever the catalogue says, so
 * running it here would prove nothing and would fail forever. The version
 * number itself stays used and is never reissued.
 */

const FIXTURE = `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><title>catalogue compat</title>
<script>
Promise.all([
  fetch('stable.json').then(r => r.text()),
  fetch('unstable.json').then(r => r.text())
]).then(([stable, unstable]) => {
  const storage = new Map([
    ['lectioManager.catalogue.v1', stable],
    ['lectioManager.catalogue.unstable.v1', unstable],
    ['lectioManager.lastRefresh.v1', Date.now()],
    ['lectioManager.lastRefresh.unstable.v1', Date.now()],
    ['lectioManager.releaseChannel.v1', 'unstable'],
    ['lectioManager.updateTipDismissed.v1', true]
  ]);
  window.GM_getValue = (k, f) => storage.has(k) ? storage.get(k) : f;
  window.GM_setValue = (k, v) => storage.set(k, v);
  window.GM_xmlhttpRequest = () => {};

  window.__warnings = [];
  const warn = console.warn.bind(console);
  console.warn = (...args) => { window.__warnings.push(args.map(String).join(' ')); warn(...args); };
  window.__errors = [];
  window.addEventListener('error', (event) => window.__errors.push(String(event.message)));

  const script = document.createElement('script');
  script.src = 'manager.js';
  script.onload = () => setTimeout(check, 500);
  document.head.appendChild(script);
});

function check() {
  try {
    document.querySelector('#lectio-manager-toggle').click();
    document.querySelector('[data-primary-view="all"]')?.click();

    setTimeout(() => {
      try {
        const names = [...document.querySelectorAll('.lectio-manager-card-name')].map((e) => e.textContent.trim());
        const errorBox = document.querySelector('.lectio-manager-error');

        if (window.__errors.length) throw new Error('threw: ' + window.__errors.join(' | '));

        const rejected = window.__warnings.filter((w) => /Skipping|Malformed|Unsupported|no modules|not an object/i.test(w));
        if (rejected.length) throw new Error('rejected catalogue content: ' + rejected.join(' | '));

        if (errorBox && !errorBox.hidden) throw new Error('showed an error: ' + errorBox.textContent.trim());

        if (names.length !== EXPECTED_COUNT) {
          throw new Error('listed ' + names.length + ' modules, expected ' + EXPECTED_COUNT + ': ' + names.join(', '));
        }

        document.documentElement.dataset.testResult = 'pass';
      } catch (error) {
        document.documentElement.dataset.testResult = 'fail: ' + error.message;
      }
    }, 400);
  } catch (error) {
    document.documentElement.dataset.testResult = 'fail: ' + error.message;
  }
}
</script></head><body></body></html>`;

async function runAgainst({ version, commit }, expectedCount) {
    const directory = await mkdtemp(join(tmpdir(), `lectio-compat-${version}-`));
    const profile = await mkdtemp(join(tmpdir(), 'lectio-compat-profile-'));

    try {
        const manager = execFileSync('git', ['show', `${commit}:manager/Lectio-Manager.user.js`], {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024
        });

        await writeFile(join(directory, 'manager.js'), manager);
        await copyFile(join(repoRoot, 'catalogue', 'modules.json'), join(directory, 'stable.json'));
        await copyFile(join(repoRoot, 'modules-unstable', 'modules.json'), join(directory, 'unstable.json'));
        await writeFile(
            join(directory, 'compat.html'),
            FIXTURE.replace('EXPECTED_COUNT', String(expectedCount)).replaceAll('EXPECTED_COUNT', String(expectedCount))
        );

        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profile}`,
            '--virtual-time-budget=6000',
            '--dump-dom',
            pathToFileURL(join(directory, 'compat.html')).href
        ], { maxBuffer: 64 * 1024 * 1024 });

        const result = stdout.match(/data-test-result="([^"]*)"/)?.[1];
        assert.equal(result, 'pass', `Manager ${version}: ${result || 'never reported a result'}`);
    } finally {
        await rm(directory, { recursive: true, force: true });
        await rm(profile, { recursive: true, force: true });
    }
}

test('every published Manager can still read the current catalogue', async (t) => {
    const stable = require(join(repoRoot, 'catalogue', 'modules.json'));
    const unstable = require(join(repoRoot, 'modules-unstable', 'modules.json'));

    // The unstable overlay replaces a stable entry when their ids match, so the
    // count an old Manager should show is the union, not the sum.
    const ids = new Set([...stable.modules, ...unstable.modules].map((m) => m.id));
    const expected = ids.size;

    for (const shipped of SHIPPED_MANAGERS) {
        await t.test(`Manager ${shipped.version}`, async () => {
            await runAgainst(shipped, expected);
        });
    }
});
