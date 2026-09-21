/*
 * English Mode's pattern-level rules from issue #61, against the copy under
 * test in modules-unstable/.
 *
 * The other English Mode fixtures load the frozen modules/ copy off disk, so
 * nothing in the suite exercised the Experimental copy's dictionary or its
 * pattern pass. This one serves the fixture and the modules-unstable/ module
 * over the suite's own HTTP server, the way module-storage does, which also
 * makes it possible to hand a deliberately broken copy of the module to the
 * page from memory - the file on disk is never touched - and require the
 * fixture to fail naming the breakage. Two of the seven rules get that
 * treatment, so the assertions are known to bite rather than assumed to.
 */

const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromeEnvironment, createProfile, releaseProfile, runChrome } = require('./chrome-harness');

const PAGE_PATH = '/lectio/223/laerer_aarsopgoerelse.aspx';
const MODULE = 'Lectio-English-Mode.user.js';

const ROUTES = new Map([
    [PAGE_PATH, {
        file: resolve(__dirname, 'fixtures', 'english-mode-patterns.html'),
        type: 'text/html; charset=utf-8'
    }],
    [`/modules-unstable/${MODULE}`, {
        file: resolve(__dirname, '..', 'modules-unstable', MODULE),
        type: 'text/javascript; charset=utf-8'
    }]
]);

async function runPatternFixture(mutate = (source) => source) {
    const profileDirectory = await createProfile('lectio-english-patterns-');
    const server = createServer(async (request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const route = ROUTES.get(pathname);

        if (!route) {
            response.writeHead(404).end();
            return;
        }

        let body = await readFile(route.file);

        if (pathname.startsWith('/modules-unstable/')) {
            body = mutate(body.toString('utf8'));
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
            '--virtual-time-budget=20000',
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
// replacement is required to find the text it rewrites. Line endings are
// normalised first: the file is checked out with CRLF on Windows and LF on
// the CI runner.
function replacing(from, to) {
    return (source) => {
        const normalised = source.replace(/\r\n/g, '\n');
        assert.ok(normalised.includes(from), `${MODULE} no longer contains the text this bite test rewrites: ${from}`);
        return normalised.replace(from, to);
    };
}

test('English Mode resolves the issue #61 shapes locally and leaves their near misses alone', async () => {
    const { result, detail, stdout } = await runPatternFixture();

    assert.equal(result, 'pass', detail || result || stdout);
});

// The hour rule with its replacement neutered: "10,5 t." comes out as "10,5 t."
// again, and the fixture must say which footer cell stayed Danish.
test('a copy whose hour abbreviation rule no longer rewrites is caught', async () => {
    const { result, detail } = await runPatternFixture(replacing(
        "'$1 h'",
        "'$1 t.'"
    ));

    assert.match(result, /^fail/, `the mutated module passed the fixture: ${detail}`);
    assert.match(detail, /Study Plan total: "Total: 10,5 t\."/, detail);
});

// fixShortcutLetterSplit() back to joining only the letter with the text after
// it, as it did before #61: "Tids" + "r" + "egistrering" is never looked up as
// one word, so "Tids" stays and the two fragments after it go to the fallback
// as words of their own. The fixture must name the tab, still starting "Tids".
test('a copy whose shortcut-letter join ignores the text before the span is caught', async () => {
    const { result, detail } = await runPatternFixture(replacing(
        'start + letter + remainder',
        'letter + remainder'
    ));

    assert.match(result, /^fail/, `the mutated module passed the fixture: ${detail}`);
    assert.match(detail, /Time Tracking tab: "Tids/, detail);
});

// Issue #63: the label-before-figure rule with its lookup removed, so every
// label is written back as it was. "Arbejde: 232,7, ..." carries no word the
// fallback gate recognises, so nothing else can rescue it, and the fixture
// must name the breakdown cell.
test('a copy whose label-before-figure rule no longer looks labels up is caught', async () => {
    const { result, detail } = await runPatternFixture(replacing(
        'exactCore(label) ??\n                        label',
        'label'
    ));

    assert.match(result, /^fail/, `the mutated module passed the fixture: ${detail}`);
    assert.match(detail, /Time Tracking breakdown: "Arbejde: 232,7/, detail);
});

// Issue #68 (a): the lesson-block guard removed, so data-tooltip is translated
// everywhere it appears. The SkemaNy-shaped block's "Hold:" line is what the
// other modules parse, and the fixture must name that block as changed.
test('a copy that translates data-tooltip on lesson blocks too is caught', async () => {
    const { result, detail } = await runPatternFixture(replacing(
        'isLessonTooltip(element)\n        ) {\n            return;',
        'false\n        ) {\n            return;'
    ));

    assert.match(result, /^fail/, `the mutated module passed the fixture: ${detail}`);
    assert.match(detail, /lesson block tooltip changed \(#lesson\): "/, detail);
});

// Issue #68 (b): the data-tooltip pass removed altogether, back to 1.11.4. The
// Study Plan week cell has no other text, so it stays Danish and the fixture
// must name it.
test('a copy that never reads data-tooltip is caught', async () => {
    const { result, detail } = await runPatternFixture(replacing(
        'processTooltip(element);',
        ';'
    ));

    assert.match(result, /^fail/, `the mutated module passed the fixture: ${detail}`);
    assert.match(detail, /Study Plan week cell: "ma 6\/7-26 - sø 12\/7-26"/, detail);
});
