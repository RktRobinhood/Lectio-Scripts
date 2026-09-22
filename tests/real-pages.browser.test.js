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

const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

const repositoryRoot = resolve(__dirname, '..');
const pagesDirectory = resolve(__dirname, 'fixtures', 'pages');

// Serve one corpus page at a Lectio-shaped path, with `prelude` running before
// anything else on the page and `postlude` after the module has loaded.
//
// `rawPages` maps a Lectio path to a corpus page served *untouched* - no
// prelude, no module, no postlude. That is how a module that goes and fetches
// another page gets real markup to parse: Change Radar reads OpgaveListe,
// DokumentOversigt and the absence page with its own fetch and its own
// DOMParser, so stubbing fetch with a hand-written string would put us back to
// testing our idea of the page. Only the landing page is ever instrumented.
//
// `virtualTimeMs` is the page's whole budget. A module that polls on a timer
// and then fetches several pages needs more of it than one that only reads the
// DOM in front of it.
async function runAgainstPage({
    page,
    path,
    prelude = '',
    modules = [],
    postlude,
    rawPages = {},
    virtualTimeMs = 25000
}) {
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

    const raw = new Map();
    for (const [url, file] of Object.entries(rawPages)) {
        raw.set(url, await readFile(resolve(pagesDirectory, file)));
    }

    const server = createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, 'http://localhost').pathname;

            if (pathname === path) {
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                response.end(body);
                return;
            }

            // Matched on the path alone, so SkemaNy.aspx?week=382026 gets the
            // saved week whichever week the module asks for. That is what keeps
            // these tests from expiring when the calendar rolls past the week
            // the page was captured in.
            if (raw.has(pathname)) {
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                response.end(raw.get(pathname));
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
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            `--virtual-time-budget=${virtualTimeMs}`,
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

/*
 * ---------------------------------------------------------------------------
 * The four pages added in c55cf21.
 *
 * Every count below was read off the saved page, not predicted. Where a module
 * disagrees with the page, the page wins and the disagreement is written down
 * as a bug rather than negotiated away in the expectation.
 * ---------------------------------------------------------------------------
 */

// A teacher's own week. What the page is, before any module touches it.
test('a real SkemaNy week is 29 lesson blocks with one cancelled activity', async () => {
    const { result, detail } = await runAgainstPage({
        page: 'skemany.html',
        path: '/lectio/223/SkemaNy.aspx',
        postlude: `${REPORTER}
            const all = [...document.querySelectorAll('.s2skemabrik')];
            const lessons = all.filter((element) => element.hasAttribute('data-tooltip'));

            check(all.length === 29, 'expected 29 .s2skemabrik in the saved week, got ' + all.length);
            check(lessons.length === 29,
                'expected all 29 to carry a tooltip, got ' + lessons.length);
            check(lessons.every((element) => element.tagName === 'A'),
                'a lesson block on SkemaNy is an <a>; found ' +
                    [...new Set(lessons.map((element) => element.tagName))].join('/'));

            // The two cancellation signals AGENTS.md names, on the same one
            // activity. If they ever disagree, this says which one moved.
            const byClass = lessons.filter((element) =>
                element.classList.contains('s2cancelled') || element.querySelector('.s2cancelled'));
            const byTooltip = lessons.filter((element) =>
                /^\\s*Aflyst!/.test(element.getAttribute('data-tooltip') || ''));
            check(byClass.length === 1, 'expected 1 s2cancelled block, got ' + byClass.length);
            check(byTooltip.length === 1, 'expected 1 Aflyst! tooltip, got ' + byTooltip.length);
            check(byClass[0] === byTooltip[0], 's2cancelled and Aflyst! are on different blocks');

            // 22 of the 29 are timetabled lessons with a start and an end; the
            // other 7 are all-day entries. A parser keyed on the time range
            // silently drops those 7, which is worth knowing the size of.
            const timed = lessons.filter((element) =>
                /\\b\\d{1,2}\\/\\d{1,2}-\\d{4} \\d{2}:\\d{2} til \\d{2}:\\d{2}\\b/
                    .test(element.getAttribute('data-tooltip') || ''));
            const allDay = lessons.filter((element) =>
                /Hele dagen/.test(element.getAttribute('data-tooltip') || ''));
            check(timed.length === 22, 'expected 22 timed lessons, got ' + timed.length);
            check(allDay.length === 7, 'expected 7 all-day entries, got ' + allDay.length);
            check(lessons.filter((element) => element.hasAttribute('data-brikid')).length === 22,
                'expected the 22 timed lessons to be the ones carrying data-brikid');

            // Hold identity, and the three cases issue #23 asked this week to
            // cover: a lesson on two holds, a lesson on one, and an activity
            // with no hold at all.
            const holdsIn = (element) => [...element.querySelectorAll('[data-lectiocontextcard^="HE"]')];
            const holdCounts = lessons.map((element) =>
                new Set(holdsIn(element).map((card) => card.getAttribute('data-lectiocontextcard'))).size);
            const tally = (n) => holdCounts.filter((count) => count === n).length;
            check(tally(0) === 15, 'expected 15 lessons with no hold, got ' + tally(0));
            check(tally(1) === 11, 'expected 11 lessons on one hold, got ' + tally(1));
            check(tally(2) === 3, 'expected 3 lessons on two holds, got ' + tally(2));

            const holdCards = [...document.querySelectorAll('[data-lectiocontextcard^="HE"]')];
            const holdIds = new Set(holdCards.map((card) => card.getAttribute('data-lectiocontextcard')));
            check(holdCards.length === 17, 'expected 17 hold card nodes, got ' + holdCards.length);
            check(holdIds.size === 7, 'expected 7 distinct holds across the week, got ' + holdIds.size);

            const teacherCards = [...document.querySelectorAll('[data-lectiocontextcard^="T"]')];
            const teacherIds = new Set(teacherCards.map((card) => card.getAttribute('data-lectiocontextcard')));
            check(teacherCards.length === 16, 'expected 16 teacher card nodes, got ' + teacherCards.length);
            check(teacherIds.size === 2, 'expected 2 distinct teachers, got ' + teacherIds.size);

            // Not every Lectio page doubles its lesson contents - this one does
            // not double at all. A module that assumed the doubling and halved
            // its counts would be wrong here, which is why both this and the
            // absence page's doubling are pinned.
            const copies = document.querySelectorAll('.OnlyDesktop, .OnlyMobile').length;
            check(copies === 0,
                'the saved SkemaNy week has grown OnlyDesktop/OnlyMobile copies: ' + copies);

            publish();
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('a lesson block on the real absence page renders its contents twice', async () => {
    // The doubling the corpus README warns about, on the page that does it.
    // Every context card inside a block therefore appears twice over, and a
    // module counting nodes rather than distinct ids reads one hold as two.
    const { result, detail } = await runAgainstPage({
        page: 'fravaersangivelse.html',
        path: '/lectio/223/subnav/fravaerlaerer.aspx',
        postlude: `${REPORTER}
            const blocks = [...document.querySelectorAll('.s2skemabrik[data-tooltip]')];
            check(blocks.length === 6, 'expected 6 lesson blocks on the absence page, got ' + blocks.length);

            const desktop = blocks.filter((block) =>
                block.querySelectorAll('.s2skemabrikcontent.OnlyDesktop').length === 1);
            const mobile = blocks.filter((block) =>
                block.querySelectorAll('.s2skemabrikcontent.OnlyMobile').length === 1);
            check(desktop.length === 6,
                'expected every block to carry exactly one .OnlyDesktop copy, got ' + desktop.length);
            check(mobile.length === 6,
                'expected every block to carry exactly one .OnlyMobile copy, got ' + mobile.length);

            // Both numbers, so the day either changes the test says which.
            const holdCards = blocks.flatMap((block) =>
                [...block.querySelectorAll('[data-lectiocontextcard^="HE"]')]);
            const holdIds = new Set(holdCards.map((card) => card.getAttribute('data-lectiocontextcard')));
            check(holdCards.length === 12,
                'expected 12 hold card nodes (6 blocks, one hold each, rendered twice), got ' + holdCards.length);
            check(holdIds.size === 4, 'expected 4 distinct holds across the 6 blocks, got ' + holdIds.size);

            const teacherCards = blocks.flatMap((block) =>
                [...block.querySelectorAll('[data-lectiocontextcard^="T"]')]);
            const teacherIds = new Set(teacherCards.map((card) => card.getAttribute('data-lectiocontextcard')));
            check(teacherCards.length === 12,
                'expected 12 teacher card nodes (rendered twice), got ' + teacherCards.length);
            check(teacherIds.size === 1, 'expected 1 distinct teacher, got ' + teacherIds.size);

            // Every block is a real booking with a tooltip in the shape the
            // modules read, and none of them is cancelled.
            check(blocks.every((block) =>
                /\\b\\d{1,2}\\/\\d{1,2}-\\d{4} \\d{2}:\\d{2} til \\d{2}:\\d{2}\\b/
                    .test(block.getAttribute('data-tooltip') || '')),
                'a block on the absence page has no D/M-YYYY HH:MM til HH:MM line');
            check(blocks.every((block) => /^Hold: /m.test(block.getAttribute('data-tooltip') || '')),
                'a block on the absence page has no Hold: line');

            publish();
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('the context-card attribute survives its raw camelCase single-quoted form', async () => {
    // Lectio sends data-lectioContextCard='HE9000003' - camelCase, and single
    // quoted. Every module selects on [data-lectiocontextcard], lower case, and
    // that works only because the DOM normalises both. The saved page is the
    // only place in this repository where the un-normalised form exists, so it
    // is the only place the normalisation can be demonstrated rather than
    // assumed - and if the page were ever re-saved through a DOM serialiser,
    // the demonstration would quietly become vacuous. Hence the file check.
    const source = await readFile(join(pagesDirectory, 'skemany.html'), 'utf8');
    assert.ok(source.includes("data-lectioContextCard='HE"),
        'skemany.html no longer carries the raw camelCase single-quoted attribute; the page ' +
        'was probably re-saved through a DOM serialiser, which makes this test vacuous');
    assert.equal(source.includes('data-lectiocontextcard'), false,
        'skemany.html now has a lower-cased context-card attribute in its source, so the ' +
        'selector below no longer proves anything about normalisation');

    const { result, detail } = await runAgainstPage({
        page: 'skemany.html',
        path: '/lectio/223/SkemaNy.aspx',
        postlude: `${REPORTER}
            const lower = document.querySelectorAll('[data-lectiocontextcard]').length;
            const camel = document.querySelectorAll('[data-lectioContextCard]').length;
            check(lower === 33, 'expected 33 context cards via the lower-case selector, got ' + lower);
            check(camel === 33, 'an attribute selector is case-insensitive for an HTML attribute name, ' +
                'so the camelCase spelling should match the same 33; got ' + camel);

            const card = document.querySelector('[data-lectiocontextcard]');
            check(card.getAttribute('data-lectioContextCard') === card.getAttribute('data-lectiocontextcard'),
                'getAttribute stopped being case-insensitive for an HTML attribute name');
            check(/^(HE|T|U|S)\\d{7}$/.test(card.getAttribute('data-lectiocontextcard')),
                'context card is not in the redacted 90xxxxx shape: ' +
                    card.getAttribute('data-lectiocontextcard'));

            publish();
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('Subject Colours paints a real week and leaves the cancelled activity alone', async () => {
    const { result, detail } = await runAgainstPage({
        page: 'skemany.html',
        path: '/lectio/223/SkemaNy.aspx',
        prelude: `
            localStorage.clear();
            localStorage.setItem('lectioSubjectColours.settings.v1', JSON.stringify({
                enabled: true, style: 'fill', intensity: 100, regularity: 'balanced',
                scanWeeks: 0, colourOther: true, overrides: {}
            }));
        `,
        modules: ['/modules/Lectio-Subject-Colours.user.js'],
        postlude: `${REPORTER}
            setTimeout(() => {
                const lessons = [...document.querySelectorAll('.s2skemabrik[data-tooltip]')];
                const cancelled = lessons.filter((element) =>
                    element.classList.contains('s2cancelled') || element.querySelector('.s2cancelled'));
                const painted = lessons.filter((element) => element.hasAttribute('data-lectio-subject'));

                check(lessons.length === 29, 'expected 29 lesson blocks, got ' + lessons.length);
                check(cancelled.length === 1, 'expected 1 cancelled block, got ' + cancelled.length);
                check(painted.length === 28,
                    'expected 28 of 29 painted - everything but the cancelled one - got ' + painted.length);
                check(cancelled[0] && !cancelled[0].hasAttribute('data-lectio-subject'),
                    'the cancelled activity was classified as a real booking: ' +
                        (cancelled[0] && cancelled[0].getAttribute('data-lectio-subject')));
                check(cancelled[0] && !cancelled[0].style.backgroundColor,
                    'the cancelled activity was painted');
                check(painted.every((element) => element.style.backgroundColor),
                    'a classified block was left without the inline colour the module claims the surface with');

                // scanWeeks is 0, so nothing has been learned and the honest
                // answer for every block is "other". The class case is the next
                // test, and it needs a scan to mean anything.
                const kinds = [...new Set(painted.map((element) => element.getAttribute('data-lectio-subject')))];
                check(kinds.length === 1 && kinds[0] === 'other',
                    'with no scanned timetable every block should be other, got ' + kinds.join('/'));

                publish();
            }, 4000);
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('Subject Colours promotes a hold that recurs inside the real week to a class', async () => {
    // The case the activity-page test could not reach, and said so. One week
    // is scanned - the saved one, served back through the module's own fetch -
    // and "loose" regularity is one week with two occurrences, so a hold that
    // genuinely meets twice in this teacher's week qualifies while a one-off
    // meeting does not. The recurrence is the real timetable's, not staged.
    const { result, detail } = await runAgainstPage({
        page: 'skemany.html',
        path: '/lectio/223/SkemaNy.aspx',
        rawPages: { '/lectio/223/SkemaNy.aspx': 'skemany.html' },
        virtualTimeMs: 60000,
        prelude: `
            localStorage.clear();
            localStorage.setItem('lectioSubjectColours.settings.v1', JSON.stringify({
                enabled: true, style: 'fill', intensity: 100, regularity: 'loose',
                scanWeeks: 1, colourOther: true, overrides: {}
            }));
        `,
        modules: ['/modules/Lectio-Subject-Colours.user.js'],
        postlude: `${REPORTER}
            setTimeout(() => {
                const lessons = [...document.querySelectorAll('.s2skemabrik[data-tooltip]')];
                const kindOf = (element) => element.getAttribute('data-lectio-subject') || 'unpainted';
                const count = (kind) => lessons.filter((element) => kindOf(element) === kind).length;

                check(lessons.length === 29, 'expected 29 lesson blocks, got ' + lessons.length);
                check(count('class') === 13,
                    'expected 13 blocks on a recurring hold to be classified as a class, got ' + count('class'));
                check(count('other') === 15,
                    'expected 15 one-off activities to stay other, got ' + count('other'));
                check(count('unpainted') === 1,
                    'expected only the cancelled activity to stay unpainted, got ' + count('unpainted'));

                // What makes a block a class is the hold on its context card,
                // not its title. Every class key is a hold key, and nothing
                // keyed on a title or a participant list was promoted.
                const keysFor = (kind) => [...new Set(lessons
                    .filter((element) => kindOf(element) === kind)
                    .map((element) => element.getAttribute('data-lectio-subject-key')))].sort();
                const classKeys = keysFor('class');
                check(classKeys.length === 5, 'expected 5 distinct recurring holds, got ' + classKeys.join(', '));
                check(classKeys.every((key) => /^h:HE\\d{7}(\\+HE\\d{7})*$/.test(key)),
                    'a class was keyed on something other than its hold context cards: ' + classKeys.join(', '));
                check(classKeys.some((key) => key.split('+').length === 2),
                    'expected one recurring class to be the two-hold lesson, got ' + classKeys.join(', '));
                check(keysFor('other').every((key) => !/^h:/.test(key)),
                    'a hold-keyed block stayed other while others on a hold became a class: ' +
                        keysFor('other').join(', '));

                // The no-hold cases, by name. Two blocks on this week carry no
                // hold card, and they are not the same case:
                //
                // The Wednesday assembly in room Q has no card but its tooltip
                // has a Hold: line naming every school-wide group, so the
                // module keys it on those names ("n:"), and it stays other
                // only because it does not recur. "No hold card" is not "no
                // hold" - the module reads the tooltip line as well.
                const keyOf = (element) => element.getAttribute('data-lectio-subject-key') || '';
                const assembly = lessons.find((element) => element.getAttribute('data-brikid') === 'ABS70000030');
                check(!!assembly, 'the assembly block (ABS70000030) is no longer on the week');
                check(assembly && kindOf(assembly) === 'other' && /^n:alle /.test(keyOf(assembly)),
                    'the assembly should be other, keyed on the group names in its Hold: line; got ' +
                        (assembly && kindOf(assembly)) + ' / ' + (assembly && keyOf(assembly)));

                // The student meeting on Wednesday 12:40 has neither a card
                // nor a Hold: line - an Elev: line instead - so it is keyed on
                // its title ("t:"). This is the one genuinely hold-less
                // activity on the week, the signal the module classifies on.
                const meeting = lessons.find((element) => element.getAttribute('data-brikid') === 'ABS70000031');
                check(!!meeting, 'the student meeting (ABS70000031) is no longer on the week');
                check(meeting && kindOf(meeting) === 'other' && keyOf(meeting) === 't:aktivitet 18',
                    'the hold-less meeting should be other, keyed on its title; got ' +
                        (meeting && kindOf(meeting)) + ' / ' + (meeting && keyOf(meeting)));

                publish();
            }, 25000);
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

/*
 * The three list pages, and what Change Radar makes of them.
 *
 * Each page's own test states what a human reading it can see, and states the
 * query-string shape its rows are actually linked with. The module test that
 * follows then runs the real Change Radar over all three at once and pins what
 * it reads off each - the counts, and the shape of a record from every page.
 * Two of the three parsers read nothing at all until issue #59, because they
 * were written against key names the pages do not use.
 */

test('the real assignment list has 25 assignments linked with exeid, and no exerciseid', async () => {
    const { result, detail } = await runAgainstPage({
        page: 'opgaveliste.html',
        path: '/lectio/223/OpgaveListe.aspx',
        postlude: `${REPORTER}
            const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');

            const exe = [...new Set(hrefs
                .map((href) => (href.match(/[?&]exeid=(\\d+)/i) || [])[1])
                .filter(Boolean))];
            check(exe.length === 25, 'expected 25 distinct exeid assignment links, got ' + exe.length);

            // The key parseAssignments was first written against (issue #59).
            // It is not on this page; the parser accepts both, and this is
            // here so that the day a page does carry it, the test says which.
            check(hrefs.filter((href) => /exerciseid=/i.test(href)).length === 0,
                'the page now carries exerciseid links; say so in tests/fixtures/pages/README.md');

            const headers = [...document.querySelectorAll('th')].map((cell) => cell.textContent.trim());
            for (const column of ['Hold', 'Opgavetitel', 'Frist']) {
                check(headers.includes(column), 'no ' + column + ' column: ' + JSON.stringify(headers));
            }
            check(!headers.some((header) => /karakter|grade/i.test(header)),
                'the teacher list now has a grade column, so the no-grade assertion on its records needs revisiting: ' +
                    JSON.stringify(headers));

            // The deadline format the parser's own date pattern is written
            // against. Every assignment row carries one, in its Frist cell -
            // matched cell by cell, as the parser does, because a row's joined
            // textContent runs "Test24/9-2026" together and a word boundary
            // then finds only the 7 rows whose note happens to end in
            // punctuation.
            const deadlines = [...document.querySelectorAll('tr')]
                .filter((row) => [...row.querySelectorAll('td')]
                    .some((cell) => /^\\d{1,2}\\/\\d{1,2}-\\d{4} \\d{2}:\\d{2}$/.test(cell.textContent.trim())));
            check(deadlines.length === 25,
                'expected all 25 rows to carry a d/m-yyyy hh:mm deadline, got ' + deadlines.length);

            // The week column spans rows, so a later row of a week has one
            // cell fewer than the header has columns. A parser counting cells
            // from the left reads the wrong column on those rows.
            const spanned = [...document.querySelectorAll('td[rowspan]')]
                .filter((cell) => Number(cell.getAttribute('rowspan')) > 1).length;
            check(spanned > 0, 'the week column no longer spans rows, so the rowspan case is untested here');

            publish();
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('the real absence page has 6 registrations, no absenseId and no percentages', async () => {
    const { result, detail } = await runAgainstPage({
        page: 'fravaersangivelse.html',
        path: '/lectio/223/subnav/fravaerlaerer.aspx',
        postlude: `${REPORTER}
            const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');

            const registrations = [...new Set(hrefs
                .filter((href) => /ActivityAbsenceRegistration\\.aspx/i.test(href))
                .map((href) => (href.match(/[?&]id=(\\d+)/i) || [])[1])
                .filter(Boolean))];
            check(registrations.length === 6,
                'expected 6 distinct absence registrations to fill in, got ' + registrations.length);

            // The key parseAbsence was first written against (issue #59). It
            // is not on this page; the parser accepts both. The percentages
            // its second half reads are a student page's, and this is not one.
            check(hrefs.filter((href) => /absenseId=/i.test(href)).length === 0,
                'the page now carries absenseId links; say so in tests/fixtures/pages/README.md');
            const percentages = (document.body.textContent || '').match(/\\d+(?:[,.]\\d+)?\\s?%/g) || [];
            check(percentages.length === 0,
                'the teacher absence page now shows percentages after all: ' + percentages.join(', '));

            const headers = [...document.querySelectorAll('th')].map((cell) => cell.textContent.trim());
            check(headers.join('|') === 'Uge|Aktivitet|',
                'the absence table columns changed: ' + JSON.stringify(headers));

            publish();
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('the real document tree has 2 documents behind documentid links', async () => {
    const { result, detail } = await runAgainstPage({
        page: 'dokumentoversigt.html',
        path: '/lectio/223/DokumentOversigt.aspx',
        postlude: `${REPORTER}
            const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');
            const ids = [...new Set(hrefs
                .map((href) => (href.match(/[?&]documentid=(\\d+)/i) || [])[1])
                .filter(Boolean))];
            check(ids.length === 2, 'expected 2 distinct documents, got ' + ids.length);

            const rows = [...document.querySelectorAll('tr')]
                .filter((row) => row.querySelector('a[href*="documentid="]'));
            check(rows.length === 2, 'expected 2 document rows, got ' + rows.length);

            const headers = [...document.querySelectorAll('th')].map((cell) => cell.textContent.trim());
            for (const column of ['Filnavn', 'Kommentar', 'Dato']) {
                check(headers.includes(column), 'no ' + column + ' column: ' + JSON.stringify(headers));
            }

            publish();
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('Change Radar, run over all four real pages, reads every list', async () => {
    /*
     * The real module, not its parsers lifted out of it: settings answered
     * through the key it asks for, its own startup poll, its own fetch, its
     * own DOMParser, and its own captured state read back out of its own
     * localStorage entry. Every page it goes for is served untouched.
     *
     * Until issue #59 two of the three parsers read nothing here, and this
     * test pinned the 0s: parseAssignments harvested on exerciseid= where the
     * real OpgaveListe.aspx links with exeid=, and parseAbsence on absenseId=
     * where the real subnav/fravaerlaerer.aspx links with
     * ActivityAbsenceRegistration.aspx?id=. Both are read now, and what is
     * pinned is the exact count off each page plus the shape of a record -
     * never "at least something", which would let either key drift again.
     *
     * looksLikeParseFailure could not catch the original: it only carries a
     * capture forward when a source that used to see >= 3 rows suddenly sees
     * none, and a parser that has never seen a row never trips it. So the
     * module now reports drift to the Manager's problem log when a page that
     * is plainly the list yields no rows - and on these pages, which parse,
     * it must report nothing at all.
     */
    const { result, detail } = await runAgainstPage({
        page: 'fravaersangivelse.html',
        path: '/lectio/223/subnav/fravaerlaerer.aspx',
        rawPages: {
            '/lectio/223/SkemaNy.aspx': 'skemany.html',
            '/lectio/223/OpgaveListe.aspx': 'opgaveliste.html',
            '/lectio/223/DokumentOversigt.aspx': 'dokumentoversigt.html',
            '/lectio/223/subnav/fravaerlaerer.aspx': 'fravaersangivelse.html'
        },
        virtualTimeMs: 60000,
        prelude: `
            localStorage.clear();
            window.__radarReports = [];
            window.addEventListener('lectio-module:report', (event) => window.__radarReports.push(event.detail || {}));

            // The module keys its storage on the school and the account it
            // detects off the page, so the settings key is not known here.
            // Answering whatever key it asks for beats guessing one: a guess
            // that missed would hand the module its defaults, which have two
            // of the three sources switched off, and this test would then
            // "find" the same emptiness for entirely the wrong reason.
            const settings = {
                pollMinutes: 15, weeksAhead: 0, historyLimit: 10,
                trackAssignments: true, trackAbsence: true, trackDocuments: true,
                trackAbsenceRegistrations: true, trackAbsencePercent: true,
                trackNewAssignments: true, trackNewDocuments: true
            };
            const realGetItem = Storage.prototype.getItem;
            Storage.prototype.getItem = function (key) {
                if (/^lectioChangeRadar\\..*\\.settings$/.test(String(key))) return JSON.stringify(settings);
                return realGetItem.call(this, key);
            };
        `,
        modules: ['/modules-unstable/Lectio-Change-Radar.user.js'],
        postlude: `${REPORTER}
            setTimeout(() => {
                const stateKey = Object.keys(localStorage)
                    .find((key) => key.startsWith('lectioChangeRadar') && key.endsWith('.state'));
                check(stateKey === 'lectioChangeRadar.v1.223.teacher-1000001.state',
                    'the module keyed its state somewhere unexpected, so it read a different school ' +
                    'or account off the page: ' + stateKey);

                let state = null;
                try { state = JSON.parse(localStorage.getItem(stateKey)); } catch (_) {}
                check(!!state, 'Change Radar never wrote a snapshot; its startup poll did not complete');
                if (!state) { publish(); return; }

                const sources = (state.snapshot && state.snapshot.sources) || {};
                const countOf = (key) => Object.keys((sources[key] && sources[key].records) || {}).length;

                check(Object.keys(sources).sort().join(',') === 'absence,assignments,documents',
                    'expected all three extra sources to have been captured, got ' +
                        Object.keys(sources).sort().join(','));

                // The timetable parser, which reads a known element rather than
                // guessing at a query string, and gets the real week right: the
                // 22 timed lessons, not the 7 all-day entries.
                const events = Object.keys((state.snapshot && state.snapshot.events) || {}).length;
                check(events === 22, 'expected 22 timetable events off the real week, got ' + events);

                // Documents: right. 2 records for the 2 documents on the page.
                const documents = (sources.documents && sources.documents.records) || {};
                check(countOf('documents') === 2,
                    'expected 2 document records, got ' + countOf('documents'));
                check(Object.keys(documents).sort().join(',') === 'DOC70000180,DOC70000181',
                    'document ids drifted: ' + Object.keys(documents).sort().join(','));
                check(Object.values(documents).every((record) => /\\.(zip|pdf)$/i.test(record.title || '')),
                    'a document record lost its filename: ' +
                        Object.values(documents).map((record) => record.title).join(', '));

                // Assignments: 25 records for the 25 exeid= rows.
                const assignments = (sources.assignments && sources.assignments.records) || {};
                const assignmentIds = Object.keys(assignments).sort();
                const assignmentRecords = Object.values(assignments);
                check(assignmentIds.length === 25,
                    'expected 25 assignment records off the real OpgaveListe, got ' + assignmentIds.length);
                check(assignmentIds.every((id) => /^EX7\\d{7}$/.test(id)),
                    'an assignment id is not EX + the redacted 7xxxxxxx run: ' + assignmentIds.join(','));
                check(assignmentIds[0] === 'EX70000052' && assignmentIds[24] === 'EX70000076',
                    'assignment ids drifted: ' + assignmentIds[0] + ' .. ' + assignmentIds[24]);

                // One record in full. Its deadline is the Frist cell, its
                // context carries the hold, and its url is the row's own link.
                const first = assignments.EX70000052 || {};
                check(first.title === 'Assignment 1', 'first assignment title: ' + first.title);
                check(first.dueDate === '2026-09-03' && first.dueTime === '12:00',
                    'first assignment should be due 2026-09-03 12:00 off the Frist column, got ' +
                        first.dueDate + ' ' + first.dueTime);
                check(/1a Fag1 HL/.test(first.context || ''),
                    'first assignment context should carry its hold, got: ' + first.context);
                check(/\\/lectio\\/223\\/fravaer_indtastskriftlig\\.aspx\\?exeid=70000052/.test(first.url || ''),
                    'first assignment url: ' + first.url);

                // Every row on the saved list has a title and a Frist.
                check(assignmentRecords.every((record) => record.title),
                    'an assignment record has no title: ' +
                        assignmentRecords.filter((record) => !record.title).map((record) => record.id).join(','));
                check(assignmentRecords.every((record) =>
                        /^\\d{4}-\\d{2}-\\d{2}$/.test(record.dueDate) && /^\\d{2}:\\d{2}$/.test(record.dueTime)),
                    'a record came back without the deadline its row carries: ' +
                        assignmentRecords.filter((record) => !record.dueDate).map((record) => record.id).join(','));
                check(assignmentRecords.filter((record) => record.title === 'Midterm test').length === 4,
                    'expected 4 rows titled Midterm test, got ' +
                        assignmentRecords.filter((record) => record.title === 'Midterm test').length);

                // The rowspan case: EX70000055 is a later row of week 39 and
                // has no week cell of its own, so it is one cell short of the
                // header. Its deadline is still read from the Frist column.
                const spanned = assignments.EX70000055 || {};
                check(spanned.title === 'Test' && spanned.dueDate === '2026-09-24' && spanned.dueTime === '22:00',
                    'the rowspan-shortened row should still read Test, due 2026-09-24 22:00, got: ' +
                        spanned.title + ' ' + spanned.dueDate + ' ' + spanned.dueTime);

                // A count is not a grade. EX70000053 has 7 in its "Ikke
                // afleveret" column and 7 is on the 7-point scale; the teacher
                // list has no Karakter column and no status words, so no record
                // may carry a status at all.
                check(assignmentRecords.every((record) => record.status === ''),
                    'a record on the teacher list carries a status, so a count was read as a grade: ' +
                        JSON.stringify(assignmentRecords.filter((record) => record.status)
                            .map((record) => [record.id, record.status])));

                // Absence: 6 registration records for the 6
                // ActivityAbsenceRegistration.aspx?id= rows, titled by their
                // lesson block - read once, although the page renders every
                // block twice - and no percentages, because this page has none.
                const absence = (sources.absence && sources.absence.records) || {};
                const absenceIds = Object.keys(absence).sort();
                check(absenceIds.join(',') ===
                        'ABSENCE70000025,ABSENCE70000182,ABSENCE70000183,ABSENCE70000184,ABSENCE70000185,ABSENCE70000186',
                    'expected the 6 registrations off the real absence page, got: ' + absenceIds.join(','));
                check(Object.values(absence).every((record) => record.type === 'registration'),
                    'the teacher absence page has no percentages, yet a record is not a registration: ' +
                        JSON.stringify(Object.values(absence).filter((record) => record.type !== 'registration')
                            .map((record) => [record.id, record.type])));
                check(Object.values(absence).every((record) =>
                        /\\/lectio\\/223\\/ActivityAbsenceRegistration\\.aspx\\?id=\\d+/.test(record.url || '')),
                    'a registration lost its link: ' +
                        Object.values(absence).map((record) => record.url).join(' '));

                const registration = absence.ABSENCE70000182 || {};
                check(/^fr 28\\/8 2\\. modul - 1a aktivitet\\/4 . AA . 229$/.test(registration.title || ''),
                    'a registration should be titled by its lesson block, read once, got: ' + registration.title);
                check(!/2\\. modul[\\s\\S]*2\\. modul/.test(registration.detail || ''),
                    'a registration detail reads the twice-rendered block twice: ' + registration.detail);
                check(/^35 · /.test(registration.detail || '') && /Angiv frav/.test(registration.detail || ''),
                    'a registration detail should carry the week and the link text, got: ' + registration.detail);

                // Every page parsed, so nothing may have been reported as drift.
                check(window.__radarReports.length === 0,
                    'the parsers read every page, yet the module reported: ' + JSON.stringify(window.__radarReports));

                publish();
            }, 30000);
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

/*
 * ---------------------------------------------------------------------------
 * Chairs Up and Subject Colours, each on the page it reads hardest.
 * ---------------------------------------------------------------------------
 */

test('Chairs Up reads the 15 roomed lessons off the real week and marks the last booking in each room', async () => {
    /*
     * The saved week is 21-25 September 2026, ISO week 39. Chairs Up keys its
     * room-week cache on that, so the cache below is written for week 39 of
     * 2026 whichever week the test runs in.
     *
     * The module is given what it would otherwise go and harvest: a fresh room
     * map naming every room on the page, and one fresh, empty week per room.
     * With nothing else booked, every lesson it parses is the last booking in
     * its room and gets the chair - except Tuesday 15:15 in room 225, whose
     * week is seeded with a later booking, so that one stays unmarked. What is
     * marked is therefore exactly what the module read off the real tooltips:
     * a timed line, a Lokale line, and no cancellation.
     */
    const { result, detail } = await runAgainstPage({
        page: 'skemany.html',
        path: '/lectio/223/SkemaNy.aspx',
        prelude: `
            localStorage.clear();
            const rooms = {
                '223A': 'RO9000001', '133': 'RO9000002', '205': 'RO9000003', '222': 'RO9000004',
                '225': 'RO9000005', 'Q': 'RO9000006', '206': 'RO9000007'
            };
            localStorage.setItem('lectioChairsUp.v102.223.roomMap', JSON.stringify(rooms));
            localStorage.setItem('lectioChairsUp.v102.223.roomMapTime', String(Date.now()));
            for (const roomId of Object.values(rooms)) {
                const days = roomId === 'RO9000005'
                    ? { '2026-09-22': [{ absid: '1', startMinutes: 17 * 60, endMinutes: 18 * 60 }] }
                    : {};
                localStorage.setItem(
                    'lectioChairsUp.v104.223.roomWeek.' + roomId + '.2026.39',
                    JSON.stringify({ fetchedAt: Date.now(), days })
                );
            }

            // Nothing should leave the page with caches this fresh; if it
            // does, say what.
            window.__fetched = [];
            window.fetch = async (url) => {
                window.__fetched.push(String(url));
                return {
                    ok: true, status: 200, url: new URL(String(url), location.href).href,
                    text: async () => '<!doctype html><html><body></body></html>'
                };
            };
            window.__reports = [];
            window.addEventListener('lectio-module:report', (event) => window.__reports.push(event.detail));

            // The module logs the rooms it parsed before it does anything
            // with them; that list is its reading of the page.
            window.__rooms = null;
            const realInfo = console.info;
            console.info = (...args) => {
                if (args[0] === '[Lectio Chairs Up] Room candidates:') window.__rooms = args[1];
                realInfo.apply(console, args);
            };
        `,
        modules: ['/modules/Lectio-Chairs-Up.user.js'],
        postlude: `${REPORTER}
            setTimeout(() => {
                const lessons = [...document.querySelectorAll('a.s2skemabrik.s2brik[data-tooltip]')];
                check(lessons.length === 22, 'expected 22 timed lesson blocks, got ' + lessons.length);

                check(Array.isArray(window.__rooms) && [...window.__rooms].sort().join(',') === '133,205,206,222,223A,225,Q',
                    'expected the 7 rooms on the week to be the room candidates, got ' + JSON.stringify(window.__rooms));

                const marked = lessons.filter((element) => element.classList.contains('lectio-chairs-up-last'));
                const icons = document.querySelectorAll('.lectio-chairs-up-icon');
                check(marked.length === 14,
                    'expected 14 lessons marked (15 roomed lessons, one with a later booking in its room), got ' + marked.length);
                check(icons.length === 14, 'expected 14 chair icons, got ' + icons.length);

                const byId = (id) => lessons.find((element) => element.getAttribute('data-brikid') === id);
                const isMarked = (element) => !!element && element.classList.contains('lectio-chairs-up-last');

                // Tuesday 15:15-16:25 in room 225, the seeded later booking:
                // the status calculation read this lesson's real end time.
                check(byId('ABS70000029') && !isMarked(byId('ABS70000029')),
                    'the lesson with a later booking in its room was marked as the last one');

                // The assembly in room Q. No hold at all - the case Subject
                // Colours keeps apart - but to Chairs Up a room booking is a
                // room booking.
                check(isMarked(byId('ABS70000030')), 'the no-hold assembly in room Q was not read as a booking');

                const cancelled = lessons.filter((element) =>
                    element.classList.contains('s2cancelled') || element.querySelector('.s2cancelled'));
                check(cancelled.length === 1 && !isMarked(cancelled[0]) && !cancelled[0].querySelector('.lectio-chairs-up-icon'),
                    'the cancelled activity was decorated');

                // The 7 timed blocks with no Lokale line: five morning
                // information slots, one student meeting, the cancelled one.
                const unroomed = lessons.filter((element) => !/Lokaler?\\s*:/i.test(element.getAttribute('data-tooltip') || ''));
                check(unroomed.length === 7, 'expected 7 timed blocks without a room line, got ' + unroomed.length);
                check(unroomed.every((element) => !isMarked(element)), 'a block with no room was marked');

                check(window.__fetched.length === 0,
                    'with fresh caches the module should not fetch anything; it fetched ' + JSON.stringify(window.__fetched));
                check(window.__reports.length === 0, 'the module reported drift on the real week: ' + JSON.stringify(window.__reports));

                publish();
            }, 4000);
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('Subject Colours reads one hold, not two, off a block that renders its contents twice', async () => {
    // The absence page is the one in the corpus that doubles every lesson's
    // contents (.OnlyDesktop and .OnlyMobile), so every hold card inside a
    // block is there twice. A module keying a class on the card nodes rather
    // than the distinct ids would key each of these six one-hold blocks as a
    // two-hold class, and the key is what its colour table is filed under.
    const { result, detail } = await runAgainstPage({
        page: 'fravaersangivelse.html',
        path: '/lectio/223/subnav/fravaerlaerer.aspx',
        prelude: `
            localStorage.clear();
            localStorage.setItem('lectioSubjectColours.settings.v1', JSON.stringify({
                enabled: true, style: 'fill', intensity: 100, regularity: 'balanced',
                scanWeeks: 0, colourOther: true, overrides: {}
            }));
        `,
        modules: ['/modules/Lectio-Subject-Colours.user.js'],
        postlude: `${REPORTER}
            setTimeout(() => {
                const blocks = [...document.querySelectorAll('.s2skemabrik[data-tooltip]')];
                check(blocks.length === 6, 'expected 6 lesson blocks, got ' + blocks.length);

                const painted = blocks.filter((element) => element.hasAttribute('data-lectio-subject'));
                check(painted.length === 6, 'expected all 6 blocks to be classified, got ' + painted.length);

                const keys = painted.map((element) => element.getAttribute('data-lectio-subject-key'));
                check(keys.every((key) => /^h:HE\\d{7}$/.test(key)),
                    'a one-hold block rendered twice was keyed on more than one hold: ' + JSON.stringify(keys));
                check(new Set(keys).size === 4, 'expected 4 distinct hold keys across the 6 blocks, got ' + new Set(keys).size);

                publish();
            }, 4000);
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

/*
 * ---------------------------------------------------------------------------
 * The Forside, and the module whose one number comes off it.
 * ---------------------------------------------------------------------------
 */

test('the real Forside links Beskeder three times and shows one unread count', async () => {
    const { result, detail } = await runAgainstPage({
        page: 'forside.html',
        path: '/lectio/223/forside.aspx',
        postlude: `${REPORTER}
            const links = [...document.querySelectorAll('a[href*="/lectio/223/beskeder2.aspx"]')];
            check(links.length === 8, 'expected 8 links into beskeder2.aspx, got ' + links.length);

            // What Unread's nav-link test reads: the link text with the
            // icon's ligature name taken out.
            const label = (link) => {
                const clone = link.cloneNode(true);
                clone.querySelectorAll('.ls-fonticon').forEach((node) => node.remove());
                return clone.textContent.replace(/\\s+/g, ' ').trim();
            };
            const nav = links.filter((link) => /^Beskeder$/.test(label(link)));
            check(nav.length === 3,
                'expected 3 links labelled exactly Beskeder (two menus and the quick-nav), got ' + nav.length);

            const rows = links.filter((link) => /type=visbesked/.test(link.getAttribute('href') || ''));
            check(rows.length === 4, 'expected 4 message rows on the dashboard, got ' + rows.length);

            // The count. Lectio renders it as its own span beside the
            // "Beskeder" heading, so their common parent reads
            // "Beskeder4 ulæste" - no whitespace before the digit. That is why
            // the module's first pass, which walks up from a Beskeder header,
            // never matches here, and the standalone-element pass is what
            // finds it. If either of these changes, the module's path changes
            // with it.
            const counts = [...document.querySelectorAll('span')]
                .filter((span) => span.textContent.trim() === '4 ulæste');
            check(counts.length === 1, 'expected exactly one "4 ulæste" span, got ' + counts.length);
            const parentText = counts[0] && counts[0].parentElement.textContent.replace(/\\s+/g, ' ').trim();
            check(parentText === 'Beskeder4 ulæste',
                'the container of the count reads differently now: ' + JSON.stringify(parentText));
            // The page's own text, without the scripts this harness injected
            // - their source would otherwise be searched too.
            const pageOnly = document.body.cloneNode(true);
            pageOnly.querySelectorAll('script').forEach((node) => node.remove());
            check(!/\\bunread\\b/i.test(pageOnly.textContent), 'the Danish page now carries an English "unread"');

            // Today's timetable on the Forside is real lesson blocks too.
            const blocks = [...document.querySelectorAll('a.s2skemabrik.s2brik[data-tooltip]')];
            check(blocks.length === 14, 'expected 14 lesson blocks on the Forside, got ' + blocks.length);
            const cards = [...document.querySelectorAll('[data-lectiocontextcard]')];
            const ids = new Set(cards.map((card) => card.getAttribute('data-lectiocontextcard')));
            check(cards.length === 22, 'expected 22 context card nodes, got ' + cards.length);
            check(ids.size === 8, 'expected 8 distinct context cards, got ' + ids.size);

            publish();
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('Unread Message Notifications reads 4 unread off the real Forside without fetching it', async () => {
    const { result, detail } = await runAgainstPage({
        page: 'forside.html',
        path: '/lectio/223/forside.aspx',
        prelude: `
            localStorage.clear();

            // Every request the module makes, answered with an empty page.
            // The inbox (beskeder2.aspx) is not in the corpus and only feeds
            // the previews; the count must not depend on it.
            window.__fetched = [];
            window.fetch = async (url) => {
                window.__fetched.push(String(url));
                return {
                    ok: true, status: 200, url: new URL(String(url), location.href).href,
                    text: async () => '<!doctype html><html><body></body></html>'
                };
            };
            window.__reports = [];
            window.addEventListener('lectio-module:report', (event) => window.__reports.push(event.detail));
            window.__warnings = [];
            const realWarn = console.warn;
            console.warn = (...args) => {
                window.__warnings.push(args.map(String).join(' '));
                realWarn.apply(console, args);
            };
        `,
        modules: ['/modules/Lectio-Unread-Message-Notifications.user.js'],
        postlude: `${REPORTER}
            // The first check waits 700ms plus up to 1500ms of jitter, then
            // up to 1200ms for a Manager slot before the preview fetch.
            setTimeout(() => {
                const badges = [...document.querySelectorAll('.lectio-unread-badge')];
                check(badges.length === 1, 'expected one badge, got ' + badges.length);
                const badge = badges[0];
                check(badge && !badge.hidden, 'the badge is hidden: the count was read as zero, or not at all');

                const count = badge && badge.querySelector('.lectio-unread-count');
                check(count && count.textContent === '4',
                    'expected the badge to read 4, got ' + JSON.stringify(count && count.textContent));
                check(badge && badge.getAttribute('aria-label') === '4 ulæste beskeder',
                    'expected a Danish label for 4, got ' + JSON.stringify(badge && badge.getAttribute('aria-label')));

                const host = badge && badge.parentElement;
                check(host && host.tagName === 'A' && /beskeder2\\.aspx/.test(host.getAttribute('href') || ''),
                    'the badge is not on a link into beskeder2.aspx');
                check(host && host.classList.contains('lectio-unread-host'), 'the host link was not marked as the host');

                let state = null;
                try { state = JSON.parse(localStorage.getItem('lectioUnreadMessages.cache.v4.223')); } catch (_) {}
                check(!!state, 'no cache was written for school 223');
                check(state && state.unreadCount === 4,
                    'cached unreadCount is ' + (state && state.unreadCount) + ', expected 4');
                check(state && Array.isArray(state.messages) && state.messages.length === 0,
                    'previews should be empty against an empty inbox');

                // The count came off the page in front of it: the only
                // request is the preview fetch, and none went to the Forside.
                check(window.__fetched.length === 1,
                    'expected exactly 1 fetch (the inbox preview), got ' + JSON.stringify(window.__fetched));
                check(window.__fetched.every((url) => /\\/lectio\\/223\\/beskeder2\\.aspx$/.test(url)),
                    'a fetch went somewhere other than the inbox: ' + JSON.stringify(window.__fetched));
                check(window.__reports.length === 0,
                    'the module reported drift on the real Forside: ' + JSON.stringify(window.__reports));
                check(!window.__warnings.some((line) => /Could not locate/.test(line)),
                    'the module could not find the count on the real Forside');

                publish();
            }, 8000);
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

// Issue #68: English Mode translates data-tooltip now, and the timetable's
// lesson blocks carry that attribute in the Danish shape Chairs Up, Subject
// Colours and Change Radar parse. Run it over the real week and require every
// block's tooltip to be exactly what the page was served with.
test('English Mode leaves every lesson block tooltip on the real week untouched', async () => {
    const { result, detail } = await runAgainstPage({
        page: 'skemany.html',
        path: '/lectio/223/SkemaNy.aspx',
        prelude: `
            // The GM_* grants English Mode runs under, with the switch on EN
            // and a fallback that never answers, so anything that changes
            // was changed by the module's own local pass.
            window.GM_getValue = (key, fallback) => key === 'lectioEnglish.mode' ? 'en' : fallback;
            window.GM_setValue = () => {};
            window.GM_xmlhttpRequest = () => {};
            window.__tooltipWrites = [];
            new MutationObserver((records) => {
                for (const record of records) {
                    window.__tooltipWrites.push({
                        block: !!record.target.closest('.s2skemabrik, .s2brik, [data-lectiocontextcard]'),
                        from: record.oldValue,
                        to: record.target.getAttribute('data-tooltip')
                    });
                }
            }).observe(document.documentElement, {
                subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-tooltip']
            });
        `,
        modules: ['/modules/Lectio-English-Mode.user.js'],
        postlude: `${REPORTER}
            setTimeout(async () => {
                check(document.documentElement.lang === 'en', 'English Mode did not switch the page to en');
                check([...document.querySelectorAll('a')].some((link) => link.textContent.trim() === 'Messages'),
                    'English Mode translated nothing on the real week (no Messages link)');

                // The served page, parsed again without any script running.
                const served = new DOMParser().parseFromString(await (await fetch(location.pathname)).text(), 'text/html');
                const before = [...served.querySelectorAll('.s2skemabrik[data-tooltip]')].map((element) => element.getAttribute('data-tooltip'));
                const after = [...document.querySelectorAll('.s2skemabrik[data-tooltip]')].map((element) => element.getAttribute('data-tooltip'));

                check(before.length === 29, 'expected 29 lesson blocks in the served page, got ' + before.length);
                check(after.length === before.length, 'expected ' + before.length + ' lesson blocks after English Mode, got ' + after.length);
                before.forEach((tooltip, index) => {
                    check(after[index] === tooltip, 'lesson block ' + index + ' tooltip changed: ' + JSON.stringify(after[index]));
                });

                const blockWrites = window.__tooltipWrites.filter((write) => write.block);
                check(blockWrites.length === 0,
                    'data-tooltip was written on a lesson block: ' + JSON.stringify(blockWrites.slice(0, 3)));

                publish();
            }, 4000);
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});
