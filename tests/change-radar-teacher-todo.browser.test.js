/*
 * Change Radar's teacher to-do (issue #76), run over the real saved pages.
 *
 * The harness is real-pages.browser.test.js's: a corpus page served untouched
 * at a Lectio-shaped path, the module's own background fetches answered with
 * other corpus pages, and the test's prelude and postlude injected as the page
 * is served. Nothing test-shaped is committed into a saved page.
 *
 * The saved pages are from late September 2026, so the page's clock is fixed
 * at Wednesday 23 September 2026, 10:00 local time - inside ISO week 39, the
 * week the saved timetable and deadlines belong to. Every verdict polls for
 * the settled state rather than waiting a flat time (issue #69), and every
 * poll's deadline sits inside the Chrome virtual-time budget it runs under.
 *
 * The copy under test is the Unstable one while it exists, the Stable one
 * after promotion, so none of this needs editing then.
 */

const { createServer } = require('node:http');
const { existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { extname, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

const repositoryRoot = resolve(__dirname, '..');
const pagesDirectory = resolve(__dirname, 'fixtures', 'pages');

const MODULE_PATH = ['modules-unstable', 'modules']
    .map((folder) => `/${folder}/Lectio-Change-Radar.user.js`)
    .find((path) => existsSync(resolve(repositoryRoot, path.slice(1))));

const VIRTUAL_TIME_MS = 60000;
const SETTLE_LIMIT_MS = 45000;

// `rawPages` maps a Lectio path to a corpus file, or to { file, edit } where
// edit(html) returns the markup to serve instead - how a test hands the module
// a table it cannot read. `html` replaces the landing page with markup of the
// test's own, for the case no saved page covers (a student account).
async function runAgainstPage({ page, html, path, prelude = '', postlude, rawPages = {} }) {
    const profileDirectory = await createProfile('lectio-change-radar-todo-');
    const source = html || await readFile(resolve(pagesDirectory, page), 'utf8');

    const headTag = source.match(/<head(\s[^>]*)?>/i);
    if (!headTag) throw new Error(`${page || 'page'} has no <head>`);
    const headEnd = headTag.index + headTag[0].length;
    const bodyClose = source.toLowerCase().lastIndexOf('</body>');
    if (bodyClose === -1) throw new Error(`${page || 'page'} has no </body>`);

    const body = source.slice(0, headEnd) +
        `<script>${prelude}</script>` +
        source.slice(headEnd, bodyClose) +
        `<script src="${MODULE_PATH}"></script>` +
        `<script>${postlude}</script>` +
        source.slice(bodyClose);

    const raw = new Map();
    for (const [url, entry] of Object.entries(rawPages)) {
        const spec = typeof entry === 'string' ? { file: entry } : entry;
        const text = await readFile(resolve(pagesDirectory, spec.file), 'utf8');
        raw.set(url, spec.edit ? spec.edit(text) : text);
    }

    const server = createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, 'http://localhost').pathname;
            if (pathname === path) {
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                response.end(body);
                return;
            }
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
            `--virtual-time-budget=${VIRTUAL_TIME_MS}`,
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

// The clock, the settings and a record of every URL the module fetches.
// Settings are answered for whatever key the module asks for, because the key
// carries the account it detects off the page. `seedState`, when given, is
// handed back the first time the module reads its state, so a test can start
// it from a known previous check; every later read is the real one.
function preludeFor(settings, seedState = null) {
    return `
        localStorage.clear();
        (() => {
            const RealDate = Date;
            const offset = new RealDate(2026, 8, 23, 10, 0, 0).getTime() - RealDate.now();
            class FixedDate extends RealDate {
                constructor(...args) { if (args.length) super(...args); else super(RealDate.now() + offset); }
                static now() { return RealDate.now() + offset; }
            }
            window.Date = FixedDate;
        })();

        window.__fetched = [];
        const realFetch = window.fetch;
        window.fetch = function (input) {
            window.__fetched.push(String((input && input.url) || input));
            return realFetch.apply(this, arguments);
        };

        window.__schemas = [];
        window.addEventListener('lectio-module:register', (event) => {
            if (event.detail && event.detail.id === 'change-radar') window.__schemas.push(event.detail.settingsSchema);
        });

        const settings = ${JSON.stringify(settings)};
        let seed = ${JSON.stringify(seedState)};
        const realGetItem = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
            if (/^lectioChangeRadar\\..*\\.settings$/.test(String(key))) return JSON.stringify(settings);
            if (seed && /^lectioChangeRadar\\..*\\.state$/.test(String(key))) {
                const value = JSON.stringify(seed);
                seed = null;
                return value;
            }
            return realGetItem.call(this, key);
        };
    `;
}

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
    // Polls rather than waiting a flat time (issue #69); the limit is inside
    // the virtual-time budget the test grants.
    const settle = (condition, then) => {
        const started = performance.now();
        const tick = () => {
            let ready = false;
            try { ready = condition(); } catch (_) {}
            if (ready || performance.now() - started > ${SETTLE_LIMIT_MS}) {
                check(ready, 'the page never reached the state this test waits for');
                then();
                publish();
            } else {
                setTimeout(tick, 200);
            }
        };
        tick();
    };
    const readState = () => {
        const key = Object.keys(localStorage)
            .find((name) => name.startsWith('lectioChangeRadar') && name.endsWith('.state'));
        try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
    };
    const checked = () => Object.keys(localStorage)
        .some((name) => name.startsWith('lectioChangeRadar') && name.endsWith('.lastPoll') &&
            Number(localStorage.getItem(name)) > 0);
    const todoLines = () => [...document.querySelectorAll('#lectio-change-radar-todo .lcr-todo-line')];
    const lineText = (kind) => {
        const line = todoLines().find((node) => node.dataset.todo === kind);
        return line ? line.querySelector('.lcr-todo-text').textContent : null;
    };
    const lineHref = (kind) => {
        const line = todoLines().find((node) => node.dataset.todo === kind);
        return line ? line.getAttribute('href') : null;
    };
`;

const TEACHER_PAGES = {
    '/lectio/223/SkemaNy.aspx': 'skemany.html',
    '/lectio/223/OpgaveListe.aspx': 'opgaveliste.html',
    '/lectio/223/subnav/fravaerlaerer.aspx': 'fravaersangivelse.html'
};

test('the to-do reads the real absence page and assignment list, and the Forside card says what they show', async () => {
    const { result, detail } = await runAgainstPage({
        page: 'forside.html',
        path: '/lectio/223/forside.aspx',
        rawPages: TEACHER_PAGES,
        prelude: preludeFor({
            pollMinutes: 15, weeksAhead: 0,
            trackAssignments: false, trackAbsence: false, trackDocuments: false,
            teacherTodo: true, teacherTodoMarks: true
        }),
        postlude: `${REPORTER}
            settle(() => todoLines().length === 3, () => {
                const state = readState() || {};
                const sources = (state.snapshot && state.snapshot.sources) || {};

                // The absence parser against the real page: its 6 lessons in
                // Manglende registrering, each with the lesson it is and the
                // day it was taught, and the list itself seen.
                const absence = sources.absence || {};
                const lessons = Object.values(absence.records || {}).filter((record) => record.type === 'registration');
                check(lessons.length === 6, 'expected 6 lessons awaiting registration, got ' + lessons.length);
                const first = (absence.records || {}).ABSENCE70000182 || {};
                check(first.activity === 'ABS70000182' && first.dateIso === '2026-08-28',
                    'the first registration should be lesson ABS70000182 on 2026-08-28, got ' +
                        first.activity + ' ' + first.dateIso);
                check(absence.meta && absence.meta.listSeen === true,
                    'the Manglende registrering list was not recognised: ' + JSON.stringify(absence.meta));

                // The assignment parser against the real list: every row's
                // Afventer laerer cell read, and whose each assignment is.
                const assignments = (sources.assignments && sources.assignments.records) || {};
                const counted = Object.values(assignments).filter((record) => typeof record.waiting === 'number');
                check(counted.length === 25, 'expected all 25 rows to carry a waiting count, got ' + counted.length);
                const waiting = (id) => (assignments[id] || {}).waiting;
                check(waiting('EX70000052') === 21 && waiting('EX70000053') === 74 && waiting('EX70000054') === 13,
                    'waiting counts off the page: ' + [waiting('EX70000052'), waiting('EX70000053'), waiting('EX70000054')]);
                check((assignments.EX70000053 || {}).owner === 'T9000003' && (assignments.EX70000052 || {}).owner === 'T9000001',
                    'the Ansvarlig column was not read into owners');
                check(sources.assignments && sources.assignments.meta && sources.assignments.meta.self === 'T9000001',
                    'the list page heading did not name its teacher: ' + JSON.stringify(sources.assignments && sources.assignments.meta));

                // The card, in Danish (no Manager, no English Mode). 34 is
                // 21 + 13: the 74 on EX70000053 are waiting on its own
                // teacher, not this one. Due this week is what is still to
                // come on 23/9: the two on 24/9, not the one on 21/9.
                check(lineText('absence') === '6 lektioner mangler registrering (ældste 28/8)',
                    'absence line: ' + lineText('absence'));
                check(lineText('marking') === '34 afleveringer venter fordelt på 2 opgaver (ældste frist 3/9)',
                    'marking line: ' + lineText('marking'));
                check(lineText('due') === '2 opgaver', 'due line: ' + lineText('due'));
                check(lineHref('absence') === '/lectio/223/subnav/fravaerlaerer.aspx', 'absence link: ' + lineHref('absence'));
                check(lineHref('marking') === '/lectio/223/OpgaveListe.aspx', 'marking link: ' + lineHref('marking'));
                check(lineHref('due') === '/lectio/223/OpgaveListe.aspx', 'due link: ' + lineHref('due'));

                const card = document.getElementById('lectio-change-radar-todo');
                check(card && card.parentElement && card.parentElement.matches('.ls-dashboard .ls-std-island-layout-col'),
                    'the card is not at the top of the Forside\\'s first column');

                // Today's lesson ABS70000025 is on the unregistered list, so
                // its block on the Forside carries the mark, and nothing else.
                const marks = [...document.querySelectorAll('.lcr-todo-mark')];
                check(marks.length === 1, 'expected 1 timetable mark on the Forside, got ' + marks.length);
                check(marks[0] && marks[0].closest('[data-brikid="ABS70000025"]'),
                    'the mark is not on lesson ABS70000025');

                // It rode the checks it was given and nothing else: the two
                // pages it counts, and not the documents nobody asked for.
                check(window.__fetched.some((url) => /fravaerlaerer\\.aspx/.test(url)), 'the absence page was never read');
                check(window.__fetched.some((url) => /OpgaveListe\\.aspx/.test(url)), 'the assignment list was never read');
                check(!window.__fetched.some((url) => /DokumentOversigt/.test(url)), 'documents were fetched unasked');
            });
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('a table the to-do cannot read shows no line at all, never a 0', async () => {
    const { result, detail } = await runAgainstPage({
        page: 'forside.html',
        path: '/lectio/223/forside.aspx',
        rawPages: {
            '/lectio/223/SkemaNy.aspx': 'skemany.html',
            // The list without its Afventer laerer column: deadlines still
            // readable, waiting counts not.
            '/lectio/223/OpgaveListe.aspx': {
                file: 'opgaveliste.html',
                edit: (html) => html.replace('Afventer<br/>lærer', 'Noget andet')
            },
            // Not the absence page at all.
            '/lectio/223/subnav/fravaerlaerer.aspx': 'dokumentoversigt.html'
        },
        prelude: preludeFor({
            pollMinutes: 15, weeksAhead: 0,
            trackAssignments: false, trackAbsence: false, trackDocuments: false,
            teacherTodo: true, teacherTodoMarks: true
        }),
        postlude: `${REPORTER}
            settle(() => checked() && todoLines().length > 0, () => {
                const kinds = todoLines().map((line) => line.dataset.todo);
                check(kinds.join(',') === 'due', 'only the readable line should show, got: ' + kinds.join(','));
                check(lineText('due') === '2 opgaver', 'due line: ' + lineText('due'));
                const card = document.getElementById('lectio-change-radar-todo');
                check(card && !/(^|\\D)0(\\D|$)/.test(card.textContent), 'the card shows a 0: ' + (card && card.textContent));
                check(document.querySelectorAll('.lcr-todo-mark').length === 0, 'a mark was drawn from an unreadable list');
            });
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test("on a teacher's timetable the unregistered lesson is marked, and the student-only absence watch stays silent", async () => {
    // A previous check with an empty absence capture: if the absence watch
    // ran for this teacher, the six lessons on the page would arrive as six
    // "new absence registration" entries. It is a student's watch, so none may.
    const seedState = {
        version: 1, initializedAt: 1, checkedAt: 1, history: [],
        snapshot: {
            capturedAt: 1, rangeStart: '', rangeEnd: '', events: {},
            sources: { absence: { capturedAt: 1, records: {}, meta: { listSeen: true } } }
        }
    };

    const { result, detail } = await runAgainstPage({
        page: 'skemany.html',
        path: '/lectio/223/SkemaNy.aspx',
        rawPages: TEACHER_PAGES,
        prelude: preludeFor({
            pollMinutes: 15, weeksAhead: 0,
            trackAssignments: false, trackDocuments: false,
            trackAbsence: true, trackAbsenceRegistrations: true,
            teacherTodo: true, teacherTodoMarks: true
        }, seedState),
        postlude: `${REPORTER}
            settle(() => checked() && document.querySelectorAll('.lcr-todo-mark').length > 0, () => {
                const marks = [...document.querySelectorAll('.lcr-todo-mark')];
                check(marks.length === 1, 'expected exactly 1 marked lesson on the week, got ' + marks.length);
                const block = marks[0] && marks[0].closest('.s2skemabrik[data-tooltip]');
                check(block && block.getAttribute('data-brikid') === 'ABS70000025',
                    'the mark is not on lesson ABS70000025: ' + (block && block.getAttribute('data-brikid')));
                check(marks[0] && /\\/lectio\\/223\\/ActivityAbsenceRegistration\\.aspx\\?id=70000025/.test(marks[0].href),
                    'the mark does not open that lesson\\'s registration page: ' + (marks[0] && marks[0].href));
                check(!document.getElementById('lectio-change-radar-todo'), 'the Forside card was drawn on the timetable');

                const state = readState() || {};
                const absenceEntries = (state.history || []).filter((entry) => entry.kind === 'absence');
                check(absenceEntries.length === 0,
                    'the student-only absence watch logged ' + absenceEntries.length + ' entries for a teacher');

                // The schema: every control grouped, the role-specific ones
                // tagged, the per-change trackers folded.
                const schema = window.__schemas[window.__schemas.length - 1] || [];
                check(schema.length > 0 && schema.every((control) => control.section), 'a control has no section');
                const audience = (key) => ((schema.find((control) => control.key === key) || {}).audience || []).join(',');
                for (const key of ['teacherTodo', 'teacherTodoMarks', 'teacherTodoMarkStyle', 'teacherTodoMarkColour']) {
                    check(audience(key) === 'teacher', key + ' is not tagged for teachers: ' + audience(key));
                }
                for (const key of ['trackAbsence', 'trackAbsenceRegistrations', 'trackAbsencePercent', 'trackAssignmentStatus']) {
                    check(audience(key) === 'student', key + ' is not tagged for students: ' + audience(key));
                }
                check(audience('trackCancellations') === '' && audience('trackAssignments') === '',
                    'a control for both roles carries an audience');
                const sections = [...new Set(schema.filter((control) => !control.advanced).map((control) => control.section))];
                check(sections.length === 4, 'expected four unfolded groups, got ' + JSON.stringify(sections));
            });
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('a student account never runs the teacher to-do, whatever is stored for it', async () => {
    const html = `<!doctype html><html lang="da"><head><title>Forside</title></head><body>
        <a href="/lectio/223/elev.aspx?elevid=5550001">Elev</a>
        <div id="contenttable" class="ls-content"><div class="ls-dashboard"><div class="ls-std-island-layout-col"></div></div></div>
    </body></html>`;

    const { result, detail } = await runAgainstPage({
        html,
        path: '/lectio/223/forside.aspx',
        rawPages: TEACHER_PAGES,
        prelude: preludeFor({
            pollMinutes: 15, weeksAhead: 0,
            trackAssignments: true, trackAbsence: false, trackDocuments: false,
            teacherTodo: true, teacherTodoMarks: true
        }),
        postlude: `${REPORTER}
            settle(() => checked() && window.__fetched.some((url) => /OpgaveListe/.test(url)), () => {
                check(!document.getElementById('lectio-change-radar-todo'), 'a student got the teacher to-do card');
                check(!window.__fetched.some((url) => /fravaer/.test(url)),
                    'a student with Watch absence off had an absence page fetched: ' + window.__fetched.join(' '));
            });
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

// ---------------------------------------------------------------------------
// The mark follows the registration (0.9.10). Before it, a lesson registered
// since the last read kept its mark for up to half an hour, and registering
// the last lessons on the list kept every mark for good: an emptied list was
// taken for a parser gone blind, and the old one was kept.
// ---------------------------------------------------------------------------

// The saved absence page with lessons registered: their rows are gone from
// Manglende registrering, and the island and its header row stay.
function withoutRegistrations(html, keep = () => false) {
    return html.replace(/<tr>[\s\S]*?<\/tr>/g, (row) =>
        /ActivityAbsenceRegistration\.aspx/.test(row) && !keep(row) ? '' : row);
}

// Epoch milliseconds for a local time on the page's fixed day. Node and the
// Chrome it launches share the machine's time zone.
const at = (hours, minutes) => new Date(2026, 8, 23, hours, minutes, 0).getTime();

function seedWithAbsence(ids, capturedAt, extra = {}) {
    const records = {};
    for (const id of ids) {
        records[`ABSENCE${id}`] = {
            id: `ABSENCE${id}`,
            type: 'registration',
            title: 'Lesson',
            activity: `ABS${id}`,
            dateIso: '2026-09-23',
            url: `/lectio/223/ActivityAbsenceRegistration.aspx?id=${id}&prevurl=subnav%2ffravaerlaerer.aspx`
        };
    }
    return {
        version: 1, initializedAt: 1, checkedAt: capturedAt, history: [],
        snapshot: {
            capturedAt, rangeStart: '', rangeEnd: '', events: {},
            sources: { absence: { capturedAt, records, meta: { island: true, listSeen: true } } }
        },
        ...extra
    };
}

const TODO_ONLY = {
    pollMinutes: 15, weeksAhead: 0,
    trackAssignments: false, trackAbsence: false, trackDocuments: false,
    teacherTodo: true, teacherTodoMarks: true
};

const absenceOf = `(state) => (state && state.snapshot && state.snapshot.sources && state.snapshot.sources.absence) || {}`;

test('a lesson registered since the last read loses its mark on the next page view, and never flashes it first', async () => {
    // Read five minutes ago - well inside the half-hour cadence - with
    // ABS70000025 still on it, and a registration page left two minutes ago.
    const seedState = seedWithAbsence(['70000025', '70000182'], at(9, 55), { absenceRecheckAfter: at(9, 58) });

    const { result, detail } = await runAgainstPage({
        page: 'skemany.html',
        path: '/lectio/223/SkemaNy.aspx',
        rawPages: {
            ...TEACHER_PAGES,
            '/lectio/223/subnav/fravaerlaerer.aspx': {
                file: 'fravaersangivelse.html',
                edit: (html) => withoutRegistrations(html, (row) => !/id=70000025\b/.test(row))
            }
        },
        prelude: preludeFor(TODO_ONLY, seedState),
        postlude: `${REPORTER}
            // Every mark drawn on this page view, including one removed again.
            window.__marksSeen = 0;
            new MutationObserver((records) => {
                for (const record of records) {
                    for (const node of record.addedNodes) {
                        if (node.nodeType === 1 && node.classList.contains('lcr-todo-mark')) window.__marksSeen += 1;
                    }
                }
            }).observe(document.documentElement, { childList: true, subtree: true });
            const absenceOf = ${absenceOf};

            settle(() => checked() && Number(absenceOf(readState()).capturedAt) > ${at(9, 58)}, () => {
                const state = readState() || {};
                const records = absenceOf(state).records || {};
                check(!records.ABSENCE70000025, 'the registered lesson is still on the stored list');
                check(Object.keys(records).length === 5, 'expected the 5 lessons still waiting, got ' + Object.keys(records).length);
                check(!('absenceRecheckAfter' in state), 'the re-read request was not cleared');
                check(window.__marksSeen === 0, 'a mark was drawn for the registered lesson (' + window.__marksSeen + ')');
                const reads = window.__fetched.filter((url) => /fravaerlaerer\\.aspx/.test(url)).length;
                check(reads === 1, 'expected the absence list to be read once, got ' + reads);
            });
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('registering the last lessons empties the list, and the empty list replaces the stored one', async () => {
    const seedState = seedWithAbsence(['70000025', '70000182', '70000183', '70000184'], 1);

    const { result, detail } = await runAgainstPage({
        page: 'skemany.html',
        path: '/lectio/223/SkemaNy.aspx',
        rawPages: {
            ...TEACHER_PAGES,
            '/lectio/223/subnav/fravaerlaerer.aspx': { file: 'fravaersangivelse.html', edit: (html) => withoutRegistrations(html) }
        },
        prelude: preludeFor(TODO_ONLY, seedState),
        postlude: `${REPORTER}
            const absenceOf = ${absenceOf};
            settle(() => checked(), () => {
                const absence = absenceOf(readState());
                check(Object.keys(absence.records || {}).length === 0,
                    'the old list was kept: ' + Object.keys(absence.records || {}).join(','));
                check(absence.meta && absence.meta.listSeen === true, 'the empty island was not recognised');
                check(document.querySelectorAll('.lcr-todo-mark').length === 0, 'a lesson is still marked');
            });
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test("the teacher's absence page, open on screen, is stored as it stands without being fetched", async () => {
    const seedState = seedWithAbsence(['70000999'], at(9, 55));

    const { result, detail } = await runAgainstPage({
        page: 'fravaersangivelse.html',
        path: '/lectio/223/subnav/fravaerlaerer.aspx',
        rawPages: TEACHER_PAGES,
        prelude: preludeFor(TODO_ONLY, seedState),
        postlude: `${REPORTER}
            const absenceOf = ${absenceOf};
            settle(() => checked(), () => {
                const records = absenceOf(readState()).records || {};
                check(!records.ABSENCE70000999, 'the stored list was not replaced by the page on screen');
                check(Object.keys(records).length === 6, 'expected the 6 lessons on the page, got ' + Object.keys(records).length);
                check(!window.__fetched.some((url) => /fravaerlaerer\\.aspx/.test(url)),
                    'the page on screen was fetched again: ' + window.__fetched.join(' '));
                check(document.querySelectorAll('.lcr-todo-mark').length === 0, 'the registration list itself got marks');
            });
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('leaving a registration page asks the next page view to re-read the absence list', async () => {
    const seedState = seedWithAbsence(['70000025'], at(9, 55));

    const { result, detail } = await runAgainstPage({
        // Any teacher page will do for the markup; the path is what counts.
        page: 'forside.html',
        path: '/lectio/223/ActivityAbsenceRegistration.aspx',
        rawPages: TEACHER_PAGES,
        prelude: preludeFor(TODO_ONLY, seedState),
        postlude: `${REPORTER}
            const absenceOf = ${absenceOf};
            settle(() => checked(), () => {
                check(!('absenceRecheckAfter' in (readState() || {})), 'a re-read was asked for before the page was left');
                check(document.querySelectorAll('.lcr-todo-mark').length === 0, 'the registration page got marks');
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
                const state = readState() || {};
                const captured = Number(absenceOf(state).capturedAt);
                check(Number(state.absenceRecheckAfter) >= captured,
                    'leaving did not ask for a re-read: ' + state.absenceRecheckAfter + ' vs ' + captured);
            });
        `
    });

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

// The look, read off the one marked lesson: which classes the mark and its
// block carry, the word on the mark, and whether the icon is there.
async function markLook(settings, expect) {
    return runAgainstPage({
        page: 'skemany.html',
        path: '/lectio/223/SkemaNy.aspx',
        rawPages: TEACHER_PAGES,
        prelude: preludeFor({ ...TODO_ONLY, ...settings }),
        postlude: `${REPORTER}
            // Room for the tag, whatever size the headless window lays out.
            const roomy = document.createElement('style');
            roomy.textContent = '[data-brikid="ABS70000025"] { min-width: 140px !important; min-height: 50px !important; }';
            document.head.appendChild(roomy);
            window.__expect = (look) => settle(() => checked() && document.querySelector('.lcr-todo-mark'), () => {
                const mark = document.querySelector('.lcr-todo-mark');
                const block = mark.closest('.s2skemabrik[data-tooltip]');
                look({
                    mark: mark.className.split(/\\s+/),
                    block: [...block.classList],
                    word: (mark.querySelector('span') || {}).textContent || '',
                    icon: Boolean(mark.querySelector('svg')),
                    label: mark.getAttribute('aria-label') || ''
                });
            });
            ${expect}
        `
    });
}

test('the mark spells out what it is: an amber tag with the roll-call icon and the word Fravær', async () => {
    const { result, detail } = await markLook({}, `window.__expect((look) => {
            check(look.mark.includes('lcr-todo-mark-tag'), 'not the tag style: ' + look.mark.join(' '));
            check(look.mark.includes('lcr-mark-amber'), 'not amber: ' + look.mark.join(' '));
            check(look.icon, 'the mark has no icon');
            check(look.word === 'Fravær', 'the tag says ' + JSON.stringify(look.word));
            check(/registreret/.test(look.label), 'the mark\\'s label does not say what it is: ' + look.label);
            check(!look.block.includes('lcr-todo-outline'), 'the tag style outlined the lesson');
        });`);

    assert.equal(result, 'pass', detail || result || 'no result reported');
});

test('the outline style rings the lesson and the chosen colour reaches mark and ring', async () => {
    const { result, detail } = await markLook({
        teacherTodoMarkStyle: 'outline',
        teacherTodoMarkColour: 'blue'
    }, `window.__expect((look) => {
            check(look.mark.includes('lcr-todo-mark-icon') && look.icon && !look.word,
                'the outline style should carry the icon alone: ' + look.mark.join(' ') + ' ' + look.word);
            check(look.mark.includes('lcr-mark-blue'), 'the mark is not blue: ' + look.mark.join(' '));
            check(look.block.includes('lcr-todo-outline') && look.block.includes('lcr-mark-blue'),
                'the lesson is not ringed in blue: ' + look.block.join(' '));
        });`);

    assert.equal(result, 'pass', detail || result || 'no result reported');
});
