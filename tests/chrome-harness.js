/*
 * How the suite launches Chrome, in one place.
 *
 * Every browser test here spawns a headless Chrome and reads its --dump-dom.
 * Each one already handed Chrome its own --user-data-dir and deleted it
 * afterwards - and the suite still filled the maintainer's system drive
 * (issue #43). The profile was never the whole story: Chrome unpacks its
 * component extensions into scoped_dir* directories and drops loose <uuid>.tmp
 * files, and it puts all of that in the *ambient* temp directory, not in the
 * profile. None of it is cleaned up when the browser is killed. One measured
 * full run left 169 entries and 559 MB behind that way; five days of runs left
 * ~1100 directories and ~21 GB, and 66 MB of free space.
 *
 * So a run gets one directory it owns, and Chrome is told that directory is
 * both its profile and its temp. Deleting that one directory then takes
 * everything Chrome made with it - the profile, the unpacked extensions and
 * the stray .tmp files alike.
 *
 * The deletion belongs in a `finally`, so it runs when the test fails or times
 * out as well as when it passes. That is a Node-side delete of a directory
 * Chrome no longer holds, so it still happens when a test kills Chrome hard
 * rather than waiting for it to exit.
 *
 * A new browser test copies that shape: createProfile, hand the profile to
 * runChrome as chromeEnvironment(profile), releaseProfile in a `finally`.
 *
 *
 * THE WATCHDOG (issue #51)
 *
 * A headless Chrome can finish its work and never exit. The DOM is dumped in
 * full - the fixture already reads `pass` - and the browser process just sits
 * there. Nothing downstream notices: the promise awaiting the child never
 * settles, the test never ends, and on CI the job burns its whole
 * timeout-minutes before failing. A hang that costs twenty minutes and reads
 * as "your change broke something" is worse than an ordinary red build,
 * because the first thing the next person does is go looking for a bug that
 * is not there.
 *
 * So every launch gets a wall-clock ceiling. On expiry Chrome is killed - the
 * whole tree, because the renderer and GPU children inherit the pipe this side
 * is reading, and killing only the browser process can leave that pipe open
 * and the wait alive - and the launch fails as CHROME_DID_NOT_EXIT, named and
 * unmistakable. The caller's `finally` runs as it would for any other
 * rejection, so releaseProfile still happens.
 *
 * The ceiling is deliberately far above anything legitimate, because a
 * watchdog that goes off on a slow machine would be the same lie in the other
 * direction. It was measured, not guessed: one full run is 109 Chrome
 * launches, and across a run they came out at 1.1s minimum, 4.1s median, 12.2s
 * at the 90th percentile and 18.0s at the slowest - the real-pages corpus,
 * which loads a saved Lectio page under a 25s virtual-time budget. 180s is ten
 * times that slowest launch, so a runner having a bad day still passes and
 * only a genuine stall is caught. LECTIO_CHROME_TIMEOUT_MS overrides it, and
 * LECTIO_CHROME_TRACE=1 prints every launch's duration so the numbers above
 * can be taken again rather than trusted.
 *
 *
 * WHY CHROME DOES NOT EXIT, WHERE IT IS KNOWN
 *
 * One cause was found and fixed rather than merely survived: a page that
 * starts a file download can leave the browser process alive after --dump-dom
 * has printed. Measured on tests/fixtures/manager-settings-file.html, whose
 * export button hands the browser a Blob to save: 20 of 68 launches never
 * exited with the download firing, 0 of 48 with the same fixture declining it
 * (see the note in that fixture). It is a race against Chrome's shutdown, so
 * it is intermittent, and the DOM is complete every time.
 *
 * That is one cause, not the cause, which is why the ceiling stays.
 */

const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const chromePath = process.env.CHROME_PATH ||
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

// The wall-clock ceiling on one Chrome invocation. See THE WATCHDOG above.
const CHROME_TIMEOUT_MS = Number(process.env.LECTIO_CHROME_TIMEOUT_MS) || 180000;

// After the kill, how long to wait for the process to actually go away before
// giving up on it. This only delays the named failure; it exists so the
// profile delete that follows is not racing Chrome's last file handles.
const KILL_GRACE_MS = 10000;

// A dumped DOM is tens of kilobytes; the real-pages corpus is the big one and
// still well under a megabyte. The cap is only here so a fixture that somehow
// writes without stopping is bounded by memory as well as by time.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

// A fresh directory for one Chrome invocation, named so a stray one can be
// traced back to the test that made it.
async function createProfile(prefix) {
    return mkdtemp(join(tmpdir(), prefix));
}

// Chrome inherits this. TEMP and TMP are what Chrome reads on Windows, TMPDIR
// what it reads on the Linux CI runner; all three point at the directory the
// test is going to delete.
function chromeEnvironment(profileDirectory) {
    return {
        ...process.env,
        TEMP: profileDirectory,
        TMP: profileDirectory,
        TMPDIR: profileDirectory
    };
}

// Windows can still hold a handle open for a moment after Chrome exits, hence
// the retries. A profile that survives them is not worth failing an otherwise
// passing test over, and it is not worth masking a real failure this sits in
// the `finally` of either - so the last resort is to give up quietly.
async function releaseProfile(profileDirectory) {
    await rm(profileDirectory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
    }).catch(() => {});
}

// Chrome is a process tree, and the children hold the stdout pipe this side is
// reading. Killing the browser process alone can therefore leave the read
// open, which is the very stall the watchdog exists to end - so take the tree.
function killChromeTree(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;

    if (process.platform === 'win32') {
        // No process-group signals on Windows; taskkill /T is the tree.
        try {
            spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true
            }).on('error', () => {});
        } catch (_) { /* fall through to the plain kill below */ }
    } else {
        // Spawned detached on POSIX, so the negated pid is its process group.
        try {
            process.kill(-child.pid, 'SIGKILL');
            return;
        } catch (_) { /* the group may already be gone */ }
    }

    try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
}

// The named failure. A distinct class so a hang can never be mistaken for a
// generic timeout, an assertion, or a change someone just made.
class ChromeDidNotExitError extends Error {
    constructor(seconds, args) {
        const url = args[args.length - 1];
        super(
            `CHROME_DID_NOT_EXIT: Chrome did not exit within ${seconds}s and was killed.\n` +
            `  url: ${url}\n` +
            '  This is the suite\'s Chrome watchdog (issue #51), not a failed assertion.\n' +
            '  Chrome finishes the page and then sometimes never shuts down; the DOM is\n' +
            '  usually already complete when it happens. Re-running normally passes. If\n' +
            '  it happens every time, that is a real hang and worth chasing.'
        );
        this.name = 'ChromeDidNotExitError';
        this.code = 'CHROME_DID_NOT_EXIT';
    }
}

/*
 * One Chrome invocation, guarded.
 *
 * Resolves with { stdout, stderr } the way promisified execFile did, so a test
 * reads the dumped DOM exactly as before. Rejects with ChromeDidNotExitError
 * if the ceiling is reached, and with Chrome's own failure otherwise.
 */
function runChrome(args, { env, timeout = CHROME_TIMEOUT_MS, maxBuffer = MAX_OUTPUT_BYTES } = {}) {
    return new Promise((resolve, reject) => {
        // How the ceiling above gets re-measured rather than guessed at:
        // LECTIO_CHROME_TRACE=1 prints how long every launch in a run took.
        const startedAt = Date.now();
        const trace = process.env.LECTIO_CHROME_TRACE
            ? () => process.stderr.write(
                `chrome-trace ${Date.now() - startedAt}ms ${args[args.length - 1]}\n`)
            : () => {};

        const child = spawn(chromePath, args, {
            env,
            windowsHide: true,
            // A process group of its own, so the tree kill above can take the
            // renderer and GPU children with it. Windows has no equivalent and
            // would open a console window for it, so it is POSIX-only.
            detached: process.platform !== 'win32'
        });

        let stdout = '';
        let stderr = '';
        let settled = false;
        let expired = false;
        let overflowed = false;
        let graceTimer = null;

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        const settle = (finish) => {
            if (settled) return;
            settled = true;
            clearTimeout(watchdog);
            clearTimeout(graceTimer);
            trace();
            finish();
        };

        const fail = () => settle(() => reject(new ChromeDidNotExitError(Math.round(timeout / 1000), args)));

        const watchdog = setTimeout(() => {
            expired = true;
            killChromeTree(child);
            // The kill should bring 'close' along in a moment, which is the
            // tidier path because the process is really gone by then. If it
            // does not, fail anyway - the caller's `finally` has to run.
            graceTimer = setTimeout(fail, KILL_GRACE_MS);
        }, timeout);

        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            if (stdout.length > maxBuffer && !overflowed) {
                overflowed = true;
                killChromeTree(child);
            }
        });
        child.stderr.on('data', (chunk) => {
            // Chrome is chatty on stderr and nothing reads more than the tail
            // of it, so it is bounded separately and cheaply.
            stderr = (stderr + chunk).slice(-64 * 1024);
        });

        child.on('error', (error) => settle(() => reject(error)));

        child.on('close', (code, signal) => {
            if (expired) {
                fail();
                return;
            }

            if (overflowed) {
                settle(() => reject(new Error(
                    `Chrome wrote more than ${maxBuffer} bytes to stdout and was killed: ${args[args.length - 1]}`
                )));
                return;
            }

            if (code === 0) {
                settle(() => resolve({ stdout, stderr }));
                return;
            }

            settle(() => {
                const error = new Error(
                    `Chrome exited with ${signal ? `signal ${signal}` : `code ${code}`}\n${stderr.slice(-2000)}`
                );
                error.code = code;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            });
        });
    });
}

module.exports = { chromeEnvironment, createProfile, releaseProfile, runChrome };
