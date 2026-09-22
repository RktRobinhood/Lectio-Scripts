/*
 * Every Experimental module's settings schema in both languages, and the
 * Manager re-wording an open settings view when the language changes
 * (issue #60).
 *
 * Two fixtures, both served over the suite's own HTTP server so the modules
 * read a Lectio-shaped path and so a deliberately broken copy of a module or
 * of the Manager can be handed to the page from memory - the file on disk is
 * never touched - and the fixture required to fail naming the breakage.
 *
 * module-schema-i18n.html has no Manager: it publishes a language the way the
 * Manager does and checks that each of the seven modules answers with the
 * same controls (keys, types, defaults, option values, section grouping) and
 * different words. manager-module-language.html has the real Manager and the
 * real Chairs Up, and checks the switch re-words the open view in place and
 * that a settings file is the same file under either language.
 */

const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

const PAGE_PATH = '/lectio/223/SkemaNy.aspx';

// Folder-qualified: each module is served from the channel it actually lives
// in, so promoting one moves its path here and nothing else changes.
const MODULES = [
    'modules/Lectio-Chairs-Up.user.js',
    'modules-unstable/Lectio-Change-Radar.user.js',
    'modules/Lectio-English-Mode.user.js',
    'modules/Lectio-Schedule-Summary.user.js',
    'modules/Lectio-Subject-Colours.user.js',
    'modules/Lectio-Theming.user.js',
    'modules/Lectio-Unread-Message-Notifications.user.js'
];

const MANAGER = 'manager/Lectio-Manager.user.js';

function routesFor(fixture) {
    return new Map([
        [PAGE_PATH, {
            file: resolve(__dirname, 'fixtures', fixture),
            type: 'text/html; charset=utf-8'
        }],
        [`/${MANAGER}`, {
            file: resolve(__dirname, '..', MANAGER),
            type: 'text/javascript; charset=utf-8'
        }],
        ...MODULES.map((path) => [`/${path}`, {
            file: resolve(__dirname, '..', path),
            type: 'text/javascript; charset=utf-8'
        }])
    ]);
}

/*
 * Serves one fixture with the Manager and the seven modules, handing each
 * userscript's source through `mutate(name, source)` on the way out - the
 * name is the file's basename. The default is identity; the bite tests below
 * replace one line of one file in memory.
 */
async function runFixture(fixture, mutate = (name, source) => source) {
    const routes = routesFor(fixture);
    const profileDirectory = await createProfile('lectio-schema-i18n-');
    const server = createServer(async (request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const route = routes.get(pathname);

        if (!route) {
            response.writeHead(404).end();
            return;
        }

        let body = await readFile(route.file);

        if (pathname.endsWith('.user.js')) {
            body = mutate(pathname.slice(pathname.lastIndexOf('/') + 1), body.toString('utf8'));
        }

        response.writeHead(200, { 'content-type': route.type });
        response.end(body);
    });

    await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
    const { port } = server.address();

    try {
        const { stdout } = await runChrome([
            '--headless=new',
            '--disable-gpu',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=6000',
            '--dump-dom',
            `http://127.0.0.1:${port}${PAGE_PATH}`
        ], { maxBuffer: 64 * 1024 * 1024, env: chromeEnvironment(profileDirectory) });

        return {
            result: stdout.match(/data-test-result="([^"]*)"/)?.[1],
            detail: stdout.match(/<pre id="detail">([\s\S]*?)<\/pre>/)?.[1],
            stdout
        };
    } finally {
        await new Promise((closed) => server.close(closed));
        await releaseProfile(profileDirectory);
    }
}

// A mutation that did not land is a bite test that proves nothing, so the
// replacement is required to find the text it rewrites, in the file it
// names. Line endings are normalised first: the file is checked out with
// CRLF on Windows and LF on the CI runner.
function replacing(file, from, to) {
    return (name, source) => {
        if (name !== file) return source;
        const normalised = source.replace(/\r\n/g, '\n');
        assert.ok(normalised.includes(from), `${file} no longer contains the text this bite test rewrites: ${from}`);
        return normalised.replace(from, to);
    };
}

test('every Experimental module announces one settings schema in English and in Danish, differing only in its words', async () => {
    const { result, detail, stdout } = await runFixture('module-schema-i18n.html');

    assert.equal(result, 'pass', detail || result || stdout);
    // One line per module, so a module that silently dropped out of the
    // fixture's list would show here.
    assert.equal((detail || '').split('\n').filter(Boolean).length, MODULES.length, detail);
});

test('the Manager re-words an open settings view when its language changes, and a settings file is the same file under either language', async () => {
    const { result, detail, stdout } = await runFixture('manager-module-language.html');

    assert.equal(result, 'pass', detail || result || stdout);
});

// Chairs Up with one Danish label left in English. The fixture must name the
// module, the control and the untranslated words.
test('a module whose Danish side still carries an English label is caught', async () => {
    const { result, detail } = await runFixture('module-schema-i18n.html', replacing(
        'Lectio-Chairs-Up.user.js',
        "markerStyleLabel: 'Markering i skemaet'",
        "markerStyleLabel: 'Timetable marker'"
    ));

    assert.match(result, /^fail/, `the mutated module passed the fixture: ${detail}`);
    assert.match(detail, /chairs-up: control 'markerStyle' label reads the same in English and Danish: "Timetable marker"/, detail);
});

// Schedule Summary announcing its strip sizes with the translated word as
// the option's value as well as its label: a settings file written under
// one language would then name a value the other language does not offer.
test('a module whose option values change with the language is caught', async () => {
    const { result, detail } = await runFixture('module-schema-i18n.html', replacing(
        'Lectio-Schedule-Summary.user.js',
        'options: STRIP_SIZES.map(value => ({ value, label: text.stripSizes[value] }))',
        'options: STRIP_SIZES.map(value => ({ value: text.stripSizes[value], label: text.stripSizes[value] }))'
    ));

    assert.match(result, /^fail/, `the mutated module passed the fixture: ${detail}`);
    assert.match(detail, /schedule-summary: control 'stripSize' has a different shape in the two languages/, detail);
});

// Unread Message Notifications no longer listening for the language: its
// schema stays in whichever language was current at page load.
test('a module that does not re-announce on a language change is caught', async () => {
    const { result, detail } = await runFixture('module-schema-i18n.html', replacing(
        'Lectio-Unread-Message-Notifications.user.js',
        "window.addEventListener('lectio-manager:language', announce);",
        ''
    ));

    assert.match(result, /^fail/, `the mutated module passed the fixture: ${detail}`);
    assert.match(detail, /message-notifications did not re-announce on lectio-manager:language \(en\)/, detail);
});

// The Manager's card label back to the hard-coded English it had before
// 1.32.0. The switch still re-words the settings view; the card behind it
// must be what fails.
test('a Manager whose Installed label is not in its string tables is caught', async () => {
    const { result, detail } = await runFixture('manager-module-language.html', replacing(
        'Lectio-Manager.user.js',
        "t('installedVersion', record.version || module.version)",
        '`Installed v${record.version || module.version}`'
    ));

    assert.match(result, /^fail/, `the mutated Manager passed the fixture: ${detail}`);
    assert.match(detail, /the card's Installed label stayed English: "Installed v/, detail);
});
