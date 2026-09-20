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
 * A new browser test copies that shape: createProfile, pass
 * chromeEnvironment(profile) as the child's `env`, releaseProfile in a
 * `finally`.
 */

const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

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

module.exports = { createProfile, chromeEnvironment, releaseProfile };
