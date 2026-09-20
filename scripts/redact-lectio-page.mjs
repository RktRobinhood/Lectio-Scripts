#!/usr/bin/env node
/*
 * Redaction pass for real Lectio pages destined for tests/fixtures/pages/.
 *
 * A saved Lectio page is the only honest test input this project has - every
 * other fixture is markup we wrote ourselves, so a parser can pass its test and
 * still be wrong about the page Lectio actually serves. Those pages are also
 * full of real students, staff, holds, homework and session tokens, and this
 * repo is public and its history permanent. The corpus is worth having and a
 * leak is not undoable, so the scrubbing is a reviewed script rather than a
 * careful afternoon.
 *
 * Three steps, deliberately separate, because the middle one needs a human:
 *
 *   node scripts/redact-lectio-page.mjs --scan <in.htm> [more.htm ...]
 *       Finds the identifying material and writes/extends redaction-map.json
 *       with a suggested placeholder for each thing found. Changes no page.
 *
 *   node scripts/redact-lectio-page.mjs --apply <in.htm> --out <out.html>
 *       Applies the reviewed map plus the mechanical rules below.
 *
 *   node scripts/redact-lectio-page.mjs --check <out.html> [more.html ...]
 *       Reads the map only to prove none of its left-hand side survived, and
 *       scans for anything that still looks like a token, a name or a real id.
 *       This is the gate before committing, and it exits non-zero.
 *
 * redaction-map.json holds the real values, so it is git-ignored and must stay
 * that way. The committed record of what was done is the placeholders in the
 * pages themselves and tests/fixtures/pages/README.md.
 *
 * The mechanical rules (applied by --apply, no map needed):
 *   - <script>, <noscript> and HTML comments are dropped entirely. Nothing in
 *     the corpus should execute, and comments carry server build details.
 *   - External <link> and asset references are dropped. A saved page rewrites
 *     them to a sibling _files/ folder that is not committed, and the test
 *     harness must not reach the network.
 *   - Every ASP.NET hidden field (__VIEWSTATE and friends) and every hidden
 *     input whose value looks like a token is emptied, keeping the field so the
 *     form's shape survives.
 *   - Context card ids (HE/T/S/RO + digits) are renumbered into reserved
 *     ranges, consistently across the whole corpus, because parsers key on them.
 *   - Personal ids in query strings (elevid, laererid, ...) are renumbered the
 *     same way.
 *
 * What is deliberately NOT changed: the school id in /lectio/223/ paths, the
 * class names, the element ids, the table shapes and the tooltip line formats.
 * Those are the things under test.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = resolve(repositoryRoot, 'redaction-map.json');

const args = process.argv.slice(2);
const mode = ['--scan', '--apply', '--check'].find((flag) => args.includes(flag));
const outIndex = args.indexOf('--out');
const outPath = outIndex === -1 ? '' : args[outIndex + 1];
const inputs = args.filter((value, index) => {
    if (value.startsWith('--')) return false;
    if (index === outIndex + 1) return false;
    return true;
});

if (!mode || !inputs.length) {
    console.error('usage: redact-lectio-page.mjs --scan|--apply|--check <page> [...] [--out <file>]');
    process.exit(2);
}

/* ---------------------------------------------------------------- the map */

const emptyMap = { contextCards: {}, personIds: {}, objectIds: {}, replacements: [], allowedText: [] };
const readMap = () => (existsSync(mapPath)
    ? { ...emptyMap, ...JSON.parse(readFileSync(mapPath, 'utf8')) }
    : structuredClone(emptyMap));

const writeMap = (map) => writeFileSync(mapPath, `${JSON.stringify(map, null, 4)}\n`, 'utf8');

// Placeholder context cards are given a shape no real one has: a 90xxxxx run,
// two to four digits shorter than anything Lectio issues. Recognising them by
// shape rather than by "is it a big number" is what lets --check state flatly
// that every card left in a page is one we put there.
const CARD_PREFIXES = ['HE', 'T', 'S', 'RO'];
const PLACEHOLDER_CARD = /^(?:HE|T|S|RO)90\d{5}$/;
const PERSON_ID_FIELDS = ['elevid', 'laererid', 'studentid', 'teacherid', 'personid', 'brugerid'];

const nextPlaceholder = (map, prefix) => {
    const used = Object.values(map.contextCards).filter((value) => value.startsWith(prefix));
    return `${prefix}${9000001 + used.length}`;
};

/* --------------------------------------------------------------- scanning */

const decode = (text) => text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

const collapse = (text) => decode(text).replace(/\s+/g, ' ').trim();

// The three id substitutions, shared by --scan (which needs to know which
// digits are already spoken for) and --apply. Order matters: a context card's
// digits must stop being a bare number before bare numbers are renumbered.
const substituteIds = (html, map) => {
    let output = html;

    for (const [card, placeholder] of Object.entries(map.contextCards)) {
        output = output.replaceAll(card, placeholder);
    }

    for (const [real, placeholder] of Object.entries(map.personIds)) {
        output = output.replaceAll(real, placeholder);
        // Lectio nests return urls inside query strings, so the same field
        // turns up percent-encoded in the same page. Missing that is how a real
        // teacher id survived a run that reported itself clean.
        output = output.replaceAll(real.replace('=', '%3d'), placeholder.replace('=', '%3d'));
        output = output.replaceAll(real.replace('=', '%3D'), placeholder.replace('=', '%3D'));
    }

    // Only digits either side are excluded. Anything narrower misses an id sat
    // behind a percent-encoded separator; the ids we have already issued are
    // kept out of the map instead, which is what stops this corrupting them.
    for (const [real, placeholder] of Object.entries(map.objectIds)) {
        output = output.replace(new RegExp(`(?<!\\d)${real}(?!\\d)`, 'g'), placeholder);
    }

    return output;
};

// The digits of every placeholder this map has already issued. A renumbering
// pass must not renumber its own output.
const reservedDigits = (map) => new Set([
    ...Object.values(map.contextCards).map((card) => card.replace(/^[A-Z]+/, '')),
    ...Object.values(map.personIds).map((field) => field.split('=')[1]),
    ...Object.values(map.objectIds)
]);

// One text node at a time. A person's name sits inside a single node, so
// examining nodes separately is what tells "Timotej Janota" apart from two
// unrelated menu items that happen to sit next to each other in the markup.
const textNodes = (html) => html
    .split(/<[^>]+>/)
    .map((chunk) => collapse(chunk))
    .filter(Boolean);

const NAME_IN_NODE = /^[A-ZÆØÅ][a-zæøå'-]{1,}(?:\s+[A-ZÆØÅ][a-zæøå'-]{1,}){1,3}(?:\s*\([^)]{1,12}\))?$/;

// A person in Lectio text is written "Fulde Navn (XX)" - in a tooltip's Laerer:
// line, in a participant list, in a page title. The initials matter as much as
// the name: they are what a lesson block shows on its own.
const PERSON_PATTERN = /([A-ZÆØÅ][\wÆØÅæøå'-]+(?:\s+[A-ZÆØÅ][\wÆØÅæøå'-]+)+)\s*\(([A-ZÆØÅ]{2,4})\)/g;

const PARTICIPANT_LINES = /(?:Lærer|Lærere|Elev|Elever|Deltagere|Deltager):\s*([^\n"]+)/g;

const FREE_TEXT_LINES = /(?:Lektier|Note|Noter|Emne|Overskrift):\s*([^\n"]{8,})/g;

// Scanning reads the page as --apply will leave it, not as it was saved. The
// mechanical rules run first either way, and scanning the raw page instead
// fills the map with this project's own module UI - a suggestion to redact the
// Manager's module list is noise that hides the one real name underneath it.
const scanPage = (raw, map, found) => {
    const html = applyMechanical(raw);

    for (const match of html.matchAll(/data-lectiocontextcard="([A-Z]+)(\d+)"/g)) {
        const prefix = match[1];
        const card = prefix + match[2];
        if (!CARD_PREFIXES.includes(prefix)) continue;
        if (PLACEHOLDER_CARD.test(card)) continue;
        if (map.contextCards[card]) continue;

        map.contextCards[card] = nextPlaceholder(map, prefix);
        found.push(`context card ${card} -> ${map.contextCards[card]}`);
    }

    for (const field of PERSON_ID_FIELDS) {
        for (const match of html.matchAll(new RegExp(`[?&]${field}=(\\d+)`, 'gi'))) {
            const key = `${field}=${match[1]}`;
            if (map.personIds[key]) continue;

            map.personIds[key] = `${field}=${1000001 + Object.keys(map.personIds).length}`;
            found.push(`person id ${key} -> ${map.personIds[key]}`);
        }
    }

    // Every other long number on the page: activity ids, document ids, hold
    // ids in query strings, the ids behind a context menu. Individually dull,
    // collectively a map straight back to one school's real objects - and the
    // parsers only care that an id is stable and distinct, not what it is.
    // Scanned against a page with the cards and person ids already substituted,
    // so their digits are not counted a second time under a different name.
    const reserved = reservedDigits(map);
    for (const match of substituteIds(html, map).matchAll(/(?<!\d)\d{7,}(?!\d)/g)) {
        const id = match[0];
        if (map.objectIds[id] || reserved.has(id)) continue;
        map.objectIds[id] = String(70000001 + Object.keys(map.objectIds).length);
        reserved.add(map.objectIds[id]);
        found.push(`object id ${id} -> ${map.objectIds[id]}`);
    }

    const known = new Set(map.replacements.map((entry) => entry.find));
    const suggest = (find, replace, note) => {
        if (!find || known.has(find) || find === replace) return;
        known.add(find);
        map.replacements.push({ find, replace, note });
        found.push(`text "${find}" -> "${replace}" (${note})`);
    };

    // Names carried alongside their initials, wherever they appear.
    let people = 0;
    for (const match of decode(html).matchAll(PERSON_PATTERN)) {
        const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[people % 26];
        suggest(match[1], `${letter}nne ${letter}ndersen`, 'person name');
        suggest(match[2], `${letter}${letter}`, 'person initials');
        people += 1;
    }

    // The short label hung on a context card: a hold's display name, a
    // teacher's initials. These are the strings the tooltips repeat, so they
    // have to move together with the card itself.
    for (const match of html.matchAll(/data-lectiocontextcard="([A-Z]+\d+)"[^>]*>([^<]{1,80})</g)) {
        const label = collapse(match[2]);
        if (!label || /^[\d\s.,:/-]*$/.test(label)) continue;
        // A longer run of text is a page heading that merely carries a card;
        // the person-name rules below already cover what is personal in it.
        if (label.length > 30) continue;

        const prefix = match[1].match(/^[A-Z]+/)[0];
        const placeholder = map.contextCards[match[1]] || match[1];
        const index = Number(placeholder.replace(/^[A-Z]+/, '')) - 9000001;
        const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.max(0, index) % 26];
        suggest(label, prefix === 'HE' ? `1a Fag${Math.max(0, index) + 1} HL` : `${letter}${letter}`, `${prefix} label`);
    }

    // People listed in a tooltip without initials in brackets.
    for (const match of decode(html).matchAll(PARTICIPANT_LINES)) {
        for (const part of match[1].split(',')) {
            const name = collapse(part).replace(/\s*\([A-ZÆØÅ]{2,4}\)\s*$/, '');
            if (!/^[A-ZÆØÅ][\wÆØÅæøå'-]+(\s+[A-ZÆØÅ][\wÆØÅæøå'-]+)+$/.test(name)) continue;
            suggest(name, 'Bente Bertelsen', 'tooltip participant');
        }
    }

    // A text node that is nothing but a name. This is the rule that catches a
    // person Lectio mentions without a context card and without initials in
    // brackets - a message sender, a participant in a list, a shared-document
    // owner - which the two rules above both miss.
    let others = 0;
    for (const node of textNodes(html)) {
        if (!NAME_IN_NODE.test(node)) continue;
        if (node.split(/\s+/).length > 4) continue;
        const letter = 'CDEFGHIJKLMNOPQRSTUVWXYZ'[others % 24];
        suggest(node, `${letter}arl ${letter}arlsen`, 'name-shaped text node - review');
        others += 1;
    }

    const title = collapse(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
    const school = title.split(' - ').pop();
    if (school && !/^lectio$/i.test(school)) suggest(school, 'Eksempel Gymnasium', 'school name');

    // Free text a person wrote: homework, notes, message subjects. Left as a
    // suggestion rather than a rule, because only a reader can tell which of
    // these is somebody's words and which is page furniture.
    for (const match of decode(html).matchAll(FREE_TEXT_LINES)) {
        suggest(collapse(match[1]).slice(0, 120), 'Placeholder text', 'free text - review');
    }
};

/* --------------------------------------------------------------- applying */

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

// Remove a whole element, not just its opening tag, by walking forward and
// counting nested tags of the same name. Node has no DOM and this repo has no
// build step, so a balanced-tag scan is what is available; it is enough for the
// self-contained subtrees the modules inject.
const removeElements = (html, openTagPattern) => {
    let output = html;

    for (;;) {
        const open = output.match(openTagPattern);
        if (!open) return output;

        const start = open.index;
        const name = open[0].match(/^<([a-zA-Z0-9-]+)/)[1].toLowerCase();

        if (VOID_ELEMENTS.has(name) || open[0].endsWith('/>')) {
            output = output.slice(0, start) + output.slice(start + open[0].length);
            continue;
        }

        const tags = new RegExp(`<${name}\\b[^>]*>|</${name}\\s*>`, 'gi');
        tags.lastIndex = start;

        let depth = 0;
        let end = -1;
        for (let tag = tags.exec(output); tag; tag = tags.exec(output)) {
            depth += tag[0].startsWith('</') ? -1 : 1;
            if (depth === 0) {
                end = tag.index + tag[0].length;
                break;
            }
        }

        // An unbalanced subtree means the page is not what this script assumes;
        // dropping the rest of the document would be worse than stopping.
        if (end === -1) {
            console.error(`Could not find the end of ${open[0].slice(0, 60)} - left in place.`);
            return output;
        }

        output = output.slice(0, start) + output.slice(end);
    }
};

// Anything one of this project's own modules put on the page. A page saved from
// a browser with Tampermonkey running carries the modules' rendered output, and
// a fixture containing it would have the parsers reading our own markup back -
// the test passes and proves nothing. The Unread badge is the sharpest case: it
// caches real senders and message subjects in a data-signature attribute.
const MODULE_MARKUP = [
    /<[a-zA-Z0-9-]+[^>]*\sid="lectio-(?:manager|module|unread|english|chairs|subject|theme|change-radar)[^"]*"[^>]*>/i,
    /<[a-zA-Z0-9-]+[^>]*\sclass="[^"]*\blectio-(?:manager|unread|english|chairs|subject|change-radar)-[^"]*"[^>]*>/i
];

const stripModuleMarkup = (html) => {
    let output = html;
    for (const pattern of MODULE_MARKUP) output = removeElements(output, pattern);

    // Classes and attributes the modules add to Lectio's own elements rather
    // than to elements of their own.
    return output
        .replace(/\sclass="([^"]*)"/gi, (whole, value) => {
            const kept = value.split(/\s+/).filter((name) => name && !/^lectio-(?:manager|unread|english|chairs|subject|theme|themed|change-radar)/.test(name));
            return kept.length ? ` class="${kept.join(' ')}"` : '';
        })
        // Every data-lectio-* attribute is ours. Lectio's own is
        // data-lectiocontextcard, with no hyphen, so it is not caught here.
        .replace(/\sdata-lectio-[a-z-]+="[^"]*"/gi, '')
        // Lectio Theming publishes its palette as --lectio-theme-* custom
        // properties in an inline style on <html>, and a module's own
        // registered colours ride along in the same attribute.
        .replace(/\sstyle="([^"]*)"/gi, (whole, value) => {
            // Only rewrite the attributes that carry one, so a lesson block's
            // own inline colour is never reformatted by a splitter this crude.
            if (!/--lectio-/i.test(value)) return whole;

            const kept = value
                .split(';')
                .map((declaration) => declaration.trim())
                .filter((declaration) => declaration && !/^--lectio-/i.test(declaration));
            return kept.length ? ` style="${kept.join('; ')};"` : '';
        });
};

const applyMechanical = (html) => stripModuleMarkup(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<link\b[^>]*>/gi, '')
    // Lectio's own CSS goes with them. Dropping the <link>s and keeping 69KB of
    // inline rules would give a half-styled page that is neither the real thing
    // nor small, and nothing under test reads Lectio's stylesheet - the modules
    // that colour a lesson block write the colour inline.
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    // A saved page rewrites every asset to a sibling _files/ folder that is not
    // committed; leaving the reference in makes the harness ask for a file that
    // will never exist.
    .replace(/\s(?:src|href)="[^"]*_files\/[^"]*"/gi, ' src="about:blank"')
    .replace(/(<input[^>]*name="(?:__[A-Z_]+|time|query)"[^>]*value=")[^"]*(")/gi, '$1$2')
    .replace(/(<input[^>]*type="hidden"[^>]*value=")[^"]{40,}(")/gi, '$1$2');

const applyMap = (html, map) => {
    let output = substituteIds(html, map);

    for (const entry of map.replacements) {
        if (entry.skip) continue;

        // Short strings are initials and hold codes, which turn up inside longer
        // words often enough that a bare replace corrupts the page.
        const boundary = entry.wordBoundary ?? entry.find.length <= 4;
        const pattern = boundary
            ? new RegExp(`(?<![\\wÆØÅæøå])${escapeRegExp(entry.find)}(?![\\wÆØÅæøå])`, 'g')
            : new RegExp(escapeRegExp(entry.find), 'g');

        output = output.replace(pattern, entry.replace);
    }

    return output;
};

/* --------------------------------------------------------------- checking */

const checkPage = (name, html, map) => {
    const problems = [];

    for (const card of Object.keys(map.contextCards)) {
        if (html.includes(card)) problems.push(`real context card ${card} still present`);
    }

    for (const real of Object.keys(map.personIds)) {
        if (html.includes(real)) problems.push(`real ${real} still present`);
    }

    // Not "is each mapped id gone" but "is every long number here one we
    // issued". The weaker question passed a page that still carried a real
    // teacher id twelve times, because the id had never made it into the map:
    // it sat behind a percent-encoded separator the scan's pattern skipped.
    const reserved = reservedDigits(map);
    for (const match of html.matchAll(/(?<!\d)\d{7,}(?!\d)/g)) {
        if (reserved.has(match[0])) continue;
        problems.push(`long number that is not a placeholder: ${match[0]}`);
    }

    for (const entry of map.replacements) {
        if (entry.skip) continue;
        if (html.includes(entry.find)) problems.push(`real text "${entry.find}" still present`);
    }

    // Independent of the map: anything that still looks like a secret or an
    // unmapped person. The map only catches what --scan thought to look for.
    for (const match of html.matchAll(/value="([A-Za-z0-9+/=_-]{40,})"/g)) {
        problems.push(`token-shaped value survives: ${match[1].slice(0, 24)}...`);
    }

    const placeholders = new Set(map.replacements.map((entry) => entry.replace));
    for (const match of decode(html).matchAll(PERSON_PATTERN)) {
        if (placeholders.has(match[1])) continue;
        problems.push(`unmapped "Name (XX)" survives: ${match[0]}`);
    }

    for (const match of html.matchAll(/data-lectiocontextcard="([A-Z]+\d+)"/g)) {
        if (!PLACEHOLDER_CARD.test(match[1])) {
            problems.push(`context card is not a placeholder: ${match[1]}`);
        }
    }

    // The net under the map: a text node that reads as somebody's name and was
    // not something we put there. This is what caught a real student's name
    // sitting inside the Unread badge's own cached tooltip, which no rule about
    // context cards or tooltips would ever have looked at.
    const allowed = new Set([...placeholders, ...(map.allowedText || [])]);
    for (const node of textNodes(html)) {
        if (!NAME_IN_NODE.test(node) || allowed.has(node)) continue;
        if (node.split(/\s+/).length > 4) continue;
        problems.push(`name-shaped text survives: "${node}" (map it, or add it to allowedText)`);
    }

    for (const marker of ['lectio-manager', 'lectio-unread', 'lectio-english', 'data-signature']) {
        if (html.includes(marker)) problems.push(`this project's own markup survives: ${marker}`);
    }

    if (/<script\b/i.test(html)) problems.push('a <script> survives');

    return problems.map((problem) => `${name}: ${problem}`);
};

/* ------------------------------------------------------------------- main */

if (mode === '--scan') {
    const map = readMap();
    const found = [];
    for (const input of inputs) scanPage(readFileSync(resolve(input), 'utf8'), map, found);
    writeMap(map);

    console.log(found.length ? found.join('\n') : 'Nothing new found.');
    console.log(`\n${found.length} new entries. Review ${mapPath} before --apply:`);
    console.log('  - fix any placeholder that reads wrong or collides,');
    console.log('  - set "skip": true on a suggestion that is page furniture, not personal data,');
    console.log('  - add anything the scan missed.');
} else if (mode === '--apply') {
    if (inputs.length !== 1 || !outPath) {
        console.error('--apply takes exactly one page and an --out path.');
        process.exit(2);
    }

    const map = readMap();
    const output = applyMap(applyMechanical(readFileSync(resolve(inputs[0]), 'utf8')), map);
    writeFileSync(resolve(outPath), output, 'utf8');

    const problems = checkPage(outPath, output, map);
    console.log(`Wrote ${outPath} (${output.length} bytes).`);
    if (problems.length) {
        console.log(`\n${problems.length} thing(s) still to deal with:`);
        console.log(problems.join('\n'));
    }
} else {
    const map = readMap();
    const problems = inputs.flatMap((input) => checkPage(input, readFileSync(resolve(input), 'utf8'), map));

    if (problems.length) {
        console.error(`${problems.length} problem(s):`);
        console.error(problems.join('\n'));
        process.exit(1);
    }

    console.log(`${inputs.length} page(s) clean.`);
}
