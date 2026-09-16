const { execFile } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const test = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);
const chromePath = process.env.CHROME_PATH ||
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

// Independent of the module's own OKLab/CVD implementation on purpose: this
// is the check the palette has to survive, not a mirror of how it was built.
// See modules/Lectio-Subject-Colours.user.js's "COLOUR-VISION-SAFE HUE
// SPACING" section for the matrices' provenance (classic HCIRN/colorjack
// dichromacy matrices, applied directly to gamma-encoded RGB).
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex) {
    const number = Number.parseInt(hex.slice(1), 16);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function srgbToLinearChannel(value) {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgbToOklab([red, green, blue]) {
    const r = srgbToLinearChannel(red);
    const g = srgbToLinearChannel(green);
    const b = srgbToLinearChannel(blue);

    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return [
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    ];
}

function oklabDistance(rgbA, rgbB) {
    const a = rgbToOklab(rgbA);
    const b = rgbToOklab(rgbB);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const CVD_MATRICES = {
    protanopia: [[0.567, 0.433, 0.000], [0.558, 0.442, 0.000], [0.000, 0.242, 0.758]],
    deuteranopia: [[0.625, 0.375, 0.000], [0.700, 0.300, 0.000], [0.000, 0.300, 0.700]],
    tritanopia: [[0.950, 0.050, 0.000], [0.000, 0.433, 0.567], [0.000, 0.475, 0.525]]
};

function simulateCvd([red, green, blue], type) {
    const [row0, row1, row2] = CVD_MATRICES[type];
    return [
        clamp(row0[0] * red + row0[1] * green + row0[2] * blue, 0, 255),
        clamp(row1[0] * red + row1[1] * green + row1[2] * blue, 0, 255),
        clamp(row2[0] * red + row2[1] * green + row2[2] * blue, 0, 255)
    ];
}

// The minimum distance between two fills across normal vision and all three
// simulated deficiencies — the worst case a real viewer might actually see.
function worstCaseGap(hexA, hexB) {
    const rgbA = hexToRgb(hexA);
    const rgbB = hexToRgb(hexB);
    let gap = oklabDistance(rgbA, rgbB);

    for (const type of Object.keys(CVD_MATRICES)) {
        gap = Math.min(gap, oklabDistance(simulateCvd(rgbA, type), simulateCvd(rgbB, type)));
    }

    return gap;
}

// A floor comfortably below what the greedy hue picker actually achieves for
// up to 12 classes under either Catppuccin theme (measured ~0.008-0.06
// depending on class count), so this is a regression guard against the
// palette collapsing back towards raw hue spacing, not a hand-tuned ceiling.
const MIN_ACCEPTABLE_GAP = 0.005;

async function runFixture(classCount, theme) {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'lectio-subject-palette-'));
    try {
        const fixtureUrl = pathToFileURL(resolve(__dirname, 'fixtures', 'subject-colours-palette.html')).href;
        const { stdout } = await execFileAsync(chromePath, [
            '--headless=new',
            '--disable-gpu',
            '--allow-file-access-from-files',
            `--user-data-dir=${profileDirectory}`,
            '--dump-dom',
            `${fixtureUrl}?count=${classCount}&theme=${theme}`
        ]);
        return stdout;
    } finally {
        await rm(profileDirectory, { recursive: true, force: true });
    }
}

function fillsFrom(dom) {
    assert.match(dom, /data-test-result="pass"/, dom);
    const match = dom.match(/data-fills="([^"]*)"/);
    assert.ok(match, `no fills recorded in fixture output\n${dom}`);
    // The fixture serialises with JSON.stringify into an HTML attribute, so
    // double quotes come back as &quot; entities.
    return JSON.parse(match[1].replace(/&quot;/g, '"'));
}

test('Subject Colours keeps class fills perceptually apart under simulated colour blindness', async () => {
    for (let classCount = 2; classCount <= 12; classCount += 1) {
        const [lightDom, darkDom] = await Promise.all([
            runFixture(classCount, 'light'),
            runFixture(classCount, 'dark')
        ]);

        const lightFills = fillsFrom(lightDom);
        const darkFills = fillsFrom(darkDom);
        assert.equal(lightFills.length, classCount);
        assert.equal(darkFills.length, classCount);

        for (const [theme, fills] of [['light', lightFills], ['dark', darkFills]]) {
            for (let i = 0; i < fills.length; i += 1) {
                for (let j = i + 1; j < fills.length; j += 1) {
                    const gap = worstCaseGap(fills[i], fills[j]);
                    assert.ok(
                        gap >= MIN_ACCEPTABLE_GAP,
                        `${theme} theme, ${classCount} classes: class ${i + 1} (${fills[i]}) and ` +
                        `class ${j + 1} (${fills[j]}) collapse under simulation (gap ${gap.toFixed(4)})`
                    );
                }
            }
        }
    }
});
