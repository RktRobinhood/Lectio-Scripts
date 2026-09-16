const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { mkdtemp, rm, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const chromePath = process.env.CHROME_PATH ||
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

// Lectio answers a request it does not like with its own error page under a
// perfectly ordinary 200: a styled shell with no week table in it. This is the
// shape the real thing has, reduced to the part the module has to notice.
const errorPage = `<!DOCTYPE html><html><head><title>Fejl - Lectio</title></head>
    <body><div class="ls-master-container"><h1>Der er sket en fejl</h1></div></body></html>`;

const timetablePage = (date) => `<!DOCTYPE html><html><head><title>Skema - Lectio</title></head>
    <body><table id="s_m_Content_Content_SkemaNy_skematabel">
        <tr class="s2dayHeader"><th>Uge</th></tr>
        <tr><td data-date="${date}">
            <a class="s2skemabrik s2brik s2normal" data-tooltip="${date.slice(8)}/${Number(date.slice(5, 7))}-${date.slice(0, 4)} 09:40 til 10:50&#10;Hold: 1i Psyc HL">
                <span data-lectiocontextcard="HE111">1i Psyc HL</span>
            </a>
        </td></tr>
    </table></body></html>`;

// Weeks are served Monday-dated so the module's own ISO week arithmetic decides
// which week a served day belongs to, rather than the test asserting its own.
const mondayOfIsoWeek = (week) => {
    const number = Number(week.slice(0, 2));
    const year = Number(week.slice(2));
    const fourth = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(fourth);
    monday.setUTCDate(fourth.getUTCDate() - ((fourth.getUTCDay() || 7) - 1) + (number - 1) * 7);
    return monday.toISOString().slice(0, 10);
};

test('a Lectio error page is never mistaken for a scanned week', async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'lectio-subject-scan-'));
    const requested = [];
    let badWeek = null;
    let reported;
    const verdict = new Promise((resolve) => { reported = resolve; });

    const server = createServer(async (request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');

        if (url.pathname === '/verdict') {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            response.end('ok');
            reported(chunks.join(''));
            return;
        }

        if (url.pathname.endsWith('/SkemaNy.aspx')) {
            const week = url.searchParams.get('week');
            requested.push(request.url);
            // The first week asked for is answered the way Lectio answers a
            // request it rejects: HTTP 200, no timetable in it.
            if (badWeek === null) badWeek = week;
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(week === badWeek ? errorPage : timetablePage(mondayOfIsoWeek(week)));
            return;
        }

        const file = url.pathname === '/lectio/223/skema'
            ? resolve(__dirname, 'fixtures', 'subject-colours-scan.html')
            : resolve(__dirname, '..', url.pathname.replace(/^\//, ''));

        let body;

        try {
            body = await readFile(file);
        } catch (_) {
            response.writeHead(404).end('not found');
            return;
        }

        response.writeHead(200, {
            'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8'
        });
        response.end(body);
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const chrome = spawn(chromePath, [
        '--headless=new',
        '--disable-gpu',
        `--user-data-dir=${profileDirectory}`,
        `http://127.0.0.1:${port}/lectio/223/skema`
    ], { stdio: 'ignore' });

    try {
        const store = JSON.parse(await Promise.race([
            verdict,
            new Promise((_, reject) => setTimeout(() => reject(new Error('the fixture never reported back')), 40000))
        ]));

        assert.ok(store, 'the module never wrote a store');
        assert.ok(requested.length > 1, `the scan asked for ${requested.length} weeks`);

        // The bogus parameter that made every real request come back as an
        // error page in the first place.
        for (const url of requested) {
            assert.ok(!url.includes('nosubnav'), `the scan still sends nosubnav: ${url}`);
        }

        const recorded = Object.keys(store.weeks || {});
        assert.ok(
            !recorded.includes(badWeek),
            `an error page was recorded as a scanned week (${recorded.join()})`
        );
        assert.ok(recorded.length > 0, 'no week was recorded even though timetables were served');

        // The weeks that did come back are still read, so one bad answer costs
        // only its own week.
        const evidence = store.entries['h:HE111'];
        assert.ok(evidence, 'the fetched timetables taught the module nothing');
        assert.ok(
            Object.keys(evidence.weekCounts).length > 0,
            'a served timetable was not counted as evidence'
        );
    } finally {
        chrome.kill();
        // Chrome still holds files in its profile for a moment after the kill,
        // and a profile left in the system temp directory is not worth failing
        // a passing test over.
        await new Promise(resolve => chrome.once('exit', resolve));
        server.close();
        await rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
    }
});
