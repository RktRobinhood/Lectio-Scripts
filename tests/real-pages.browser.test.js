/*
 * The modules, run against real Lectio markup.
 *
 * Every other fixture in this folder is markup we wrote ourselves, so it can
 * only ever confirm that a parser agrees with our idea of the page. These tests
 * load the redacted pages in tests/fixtures/pages/ - saved from a live Lectio -
 * and let the modules read them exactly as they would in a browser.
 *
 * The corpus pages are served untouched. The harness a test needs is injected
 * by the server as the page is served, so nothing test-shaped is ever committed
 * into a page that is supposed to be what Lectio sent.
 */

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
const pagesDirectory = resolve(__dirname, 'fixtures', 'pages');

// Serve one corpus page at a Lectio-shaped path, with `prelude` running before
// anything else on the page and `postlude` after the module has loaded.
async function runAgainstPage({ page, path, prelude = '', modules = [], postlude }) {
    const profileDirectory = await createProfile('lectio-real-pages-');
    const html = await readFile(resolve(pagesDirectory, page), 'utf8');

    const scripts = modules.map((module) => `<script src="${module}"></script>`).join('');

    // Both insertion points are found in the saved page and spliced in one
    // pass. Two chained replaces read their own output: a prelude that stubs a
    // fetch with an HTML string in it contains a </body>, and the second
    // replace then injects the module into the middle of the first script.
    // That failed silently - the page still loaded, and nothing ran.
    const headTag = html.match(/<head(\s[^>]*)?>/i);
    if (!headTag) throw new Error(`${page} has no <head>`);

    const headEnd = headTag.index + headTag[0].length;
    const bodyClose = html.toLowerCase().lastIndexOf('</body>');
    if (bodyClose === -1) throw new Error(`${page} has no </body>`);

    const body = html.slice(0, headEnd) +
        `<script>${prelude}</script>` +
        html.slice(headEnd, bodyClose) +
        scripts +
        `<script>${postlude}</script>` +
        html.slice(bodyClose);

    const server = createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, 'http://localhost').pathname;

            if (pathname === path) {
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                response.end(body);
                return;
            }

            const file = resolve(repositoryRoot, pathname.replace(/^\/+/, ''));
            const content = await readFile(file);
            const contentType = extname(file) === '.js' ? 'text/javascript' : 'text/html';
            response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
            response.end(content);
        } catch (_) {
            response.writeHead(404);
            response.end('Not found');
        }
    });

    await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
    const { port } = server.address();

    try {
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=25000',
            '--dump-dom',
            `http://127.0.0.1:${port}${path}`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        return {
            result: stdout.match(/data-test-result="([^"]*)"/)?.[1],
            detail: stdout.match(/<pre id="test-result"[^>]*>([\s\S]*?)<\/pre>/)?.[1]
        };
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
}

// Shared by every postlude: collect failures, then publish them where
// --dump-dom will show them.
const REPORTER = `
    const failures = [];
    const check = (condition, message) => { if (!condition) failures.push(message); };
    const publish = () => {
        const pre = document.createElement('pre');
        pre.id = 'test-result';
        pre.textContent = failures.join('\\n') || 'ok';
        document.documentElement.setAttribute('data-test-result', failures.length ? 'fail' : 'pass');
        document.body.appendChild(pre);
    };
`;

test('Subject Colours reads a real activity front page without painting its decoration', async () => {
    // The page Lectio serves for one activity. It carries exactly one real
    // lesson block and one .s2skemabrik that is a table-of-contents bullet
    // borrowing the icon - the case that made the module match on the tooltip
    // rather than on the class.
    const { result, detail } = await runAgainstPage({
        page: 'aktivitetsforside.html',
        path: '/lectio/223/aktivitet/aktivitetforside2.aspx',
        prelude: `
            localStorage.clear();
            localStorage.setItem('lectioSubjectColours.settings.v1', JSON.stringify({
                enabled: true, style: 'fill', intensity: 100, regularity: 'balanced',
                scanWeeks: 1, colourOther: true, overrides: {}
            }));
            // The module widens its picture of the timetable by fetching other
            // weeks. This test is about the page in front of it, so those come
            // back empty rather than reaching for a week nobody saved.
            window.fetch = async () => ({
                ok: true, status: 200, url: '',
                text: async () => '<!doctype html><html><body></body></html>'
            });
        `,
        modules: ['/modules/Lectio-Subject-Colours.user.js'],
        postlude: `${REPORTER}
            setTimeout(() => {
                const all = [...document.querySelectorAll('.s2skemabrik')];
                const lessons = all.filter((element) => element.hasAttribute('data-tooltip'));
                const decoration = all.filter((element) => !element.hasAttribute('data-tooltip'));

                // What the real page is, before anything about the module.
                check(all.length === 2, 'expected 2 .s2skemabrik in the saved page, got ' + all.length);
                check(lessons.length === 1, 'expected 1 of them to carry a tooltip, got ' + lessons.length);
                check(decoration.some((element) => element.classList.contains('prepend-fonticon-activity')),
                    'expected the decorative .s2skemabrik to be the activity bullet');

                // What the module did with it.
                check(lessons[0] && lessons[0].hasAttribute('data-lectio-subject'),
                    'the real lesson block was not classified');
                // "other", not "class", and that is right: the module calls a
                // hold a class once it has seen it recur in a scanned
                // timetable, and this page is one activity with nothing
                // learned behind it. Asserting the honest answer keeps the
                // test about what an activity page can actually show. The
                // "class" case belongs with a real SkemaNy week.
                check(lessons[0] && lessons[0].getAttribute('data-lectio-subject') === 'other',
                    'a lesson on a page with no learned timetable should be "other", got '
                        + (lessons[0] && lessons[0].getAttribute('data-lectio-subject')));

                const painted = decoration.filter((element) => element.hasAttribute('data-lectio-subject'));
                check(painted.length === 0, painted.length + ' decorative .s2skemabrik were painted');

                publish();
            }, 4000);
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('a real activity front page still carries the tooltip shape the modules read', async () => {
    // Not about any one module: this is the page itself. Chairs Up, Subject
    // Colours, Schedule Summary and Change Radar all read a lesson's date, its
    // holds and its teacher out of these tooltip lines, so the day Lectio
    // reformats one of them, this is the test that says so.
    const { result, detail } = await runAgainstPage({
        page: 'aktivitetsforside.html',
        path: '/lectio/223/aktivitet/aktivitetforside2.aspx',
        postlude: `${REPORTER}
            const block = document.querySelector('.s2skemabrik[data-tooltip]');
            check(!!block, 'no lesson block with a tooltip on the page');

            const lines = String(block ? block.getAttribute('data-tooltip') : '')
                .split('\\n').map((line) => line.trim());

            check(lines.some((line) => /^\\d{1,2}\\/\\d{1,2}-\\d{4} \\d{2}:\\d{2} til \\d{2}:\\d{2}$/.test(line)),
                'no "D/M-YYYY HH:MM til HH:MM" line: ' + JSON.stringify(lines));
            check(lines.some((line) => /^Hold: /.test(line)), 'no "Hold:" line: ' + JSON.stringify(lines));
            check(lines.some((line) => /^Lærer: /.test(line)), 'no "Lærer:" line: ' + JSON.stringify(lines));
            check(lines.some((line) => /^Lokale: /.test(line)), 'no "Lokale:" line: ' + JSON.stringify(lines));

            // The holds are on context cards inside the block, which is the
            // identity every module keys on rather than the display name.
            //
            // A real block renders its contents twice - once in a
            // .s2skemabrik.OnlyDesktop span and once in an .OnlyMobile one - so
            // every card inside it appears twice over. No hand-written fixture
            // in this folder does that, and a module that counted cards rather
            // than distinct ids would read this two-hold lesson as four. Both
            // numbers are asserted, so the day either changes, this says which.
            const holds = [...block.querySelectorAll('[data-lectiocontextcard^="HE"]')];
            const holdIds = new Set(holds.map((card) => card.getAttribute('data-lectiocontextcard')));
            check(holds.length === 4, 'expected 4 hold card nodes (2 holds, rendered twice), got ' + holds.length);
            check(holdIds.size === 2, 'expected 2 distinct holds, got ' + holdIds.size);

            const teachers = [...block.querySelectorAll('[data-lectiocontextcard^="T"]')];
            const teacherIds = new Set(teachers.map((card) => card.getAttribute('data-lectiocontextcard')));
            check(teachers.length === 2, 'expected 2 teacher card nodes (1 teacher, rendered twice), got ' + teachers.length);
            check(teacherIds.size === 1, 'expected 1 distinct teacher, got ' + teacherIds.size);

            publish();
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});
