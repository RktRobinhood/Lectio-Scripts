// ==UserScript==
// @name         Lectio - Subject Colours
// @namespace    https://www.lectio.dk/
// @version      0.3.1
// @description  Learns which classes are actually yours from your own timetable and gives each one its own colour, with a separate muted spectrum for one-off activities like assemblies and meetings.
// @match        https://www.lectio.dk/lectio/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-Subject-Colours.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-Subject-Colours.user.js
// ==/UserScript==

(() => {
    'use strict';

    const MODULE_ID = 'subject-colours';
    const MODULE_NAME = 'Lectio - Subject Colours';
    const MODULE_VERSION = '0.3.1';
    const LOG = '[Lectio Subject Colours]';
    const STYLE_ID = 'lectio-subject-colours-styles';

    // Written onto every lesson block this module colours. The kind attribute
    // is also what the stylesheet keys off, so a block is either fully marked
    // or completely untouched — there is no half-coloured state to reason about.
    const KIND_ATTRIBUTE = 'data-lectio-subject';
    const KEY_ATTRIBUTE = 'data-lectio-subject-key';
    const STYLE_ATTRIBUTE = 'data-lectio-subject-style';

    // The on-page colour legend: a small floating strip, not part of any
    // Lectio table, so it works the same on every page this module paints
    // rather than depending on one page's row structure.
    const LEGEND_ID = 'lectio-subject-colours-legend';
    const LEGEND_PANEL_ID = 'lectio-subject-colours-legend-panel';
    const HIGHLIGHT_CLASS = 'lectio-subject-colours-highlight';

    const SETTINGS_KEY = 'lectioSubjectColours.settings.v1';
    // Learned schedule data is scoped per school: the same browser can be
    // signed in to more than one Lectio installation, and a hold id from one
    // means nothing in another.
    const STORE_PREFIX = 'lectioSubjectColours.schedule.v1';
    const SCAN_LOCK_KEY = 'lectioSubjectColours.scanLock.v1';

    const SCHOOL = (location.pathname.match(/^\/lectio\/(\d+)\//) || [])[1] || '';

    // A learned week is re-checked after this long; a whole store older than
    // this is re-scanned from scratch, so a new term's timetable replaces last
    // term's rather than being averaged with it.
    const WEEK_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
    const STORE_FRESHNESS_MS = 21 * 24 * 60 * 60 * 1000;
    // Two tabs opening at once must not both scan. The lock is advisory and
    // expires on its own, so a tab closed mid-scan cannot wedge the module.
    const SCAN_LOCK_MS = 3 * 60 * 1000;
    const SCAN_GAP_MS = 220;
    const SCAN_START_DELAY_MS = 1800;
    const MAX_ENTRIES = 400;
    const MAX_TRACKED_WEEKS = 26;

    const STYLE_OPTIONS = [
        { value: 'fill', label: 'Fill the block' },
        { value: 'stripe', label: 'Edge stripe only' },
        { value: 'both', label: 'Fill and stripe' }
    ];
    // How much evidence a hold needs before it counts as one of your regular
    // classes rather than a one-off. "Weeks" is the load-bearing half: a class
    // recurs week after week, while a three-lesson project day does not.
    const REGULARITY_OPTIONS = [
        { value: 'loose', label: 'Loose — colour almost everything' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'strict', label: 'Strict — only firm weekly classes' }
    ];
    const REGULARITY_THRESHOLDS = Object.freeze({
        loose: { minWeeks: 1, minOccurrences: 2 },
        balanced: { minWeeks: 2, minOccurrences: 3 },
        strict: { minWeeks: 3, minOccurrences: 5 }
    });

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        style: 'fill',
        intensity: 100,
        regularity: 'balanced',
        scanWeeks: 8,
        colourOther: true,
        showLegend: false,
        lockColours: false,
        lockedTheme: null,
        overrides: {}
    });

    // Lectio's own defaults, used whenever Lectio Theming is absent or switched
    // off, so this module looks deliberate on a stock Lectio page too.
    const FALLBACK_THEME = Object.freeze({
        bg: '#ffffff',
        text: '#10201e',
        accent: '#0f6f6f',
        muted: '#5e6870'
    });

    // Tooltip lines Lectio prefixes with a field name. They are metadata about
    // an activity, never its title, so they are dropped when working out what
    // to call a no-hold activity.
    const TOOLTIP_FIELD_PATTERN = /^(Hold|Lærer|Laerer|Teacher|Teachers|Lokale|Lokaler|Room|Rooms|Elever|Students|Grupper|Groups|Ressourcer|Resources|Lektier|Homework|Note|Noter|Øvrigt indhold|Other content)\s*:/i;
    const CANCELLED_PATTERN = /^\s*(aflyst|cancell?ed)\b/i;
    // Lectio opens a tooltip with a status word of its own where there is
    // one: Aflyst! for a cancelled lesson, Ændret! for a changed one.
    // Cancellation is answered on its own; the rest are still not what the
    // activity is called, and without this a changed one-off is filed under
    // the word Ændret!.
    const STATUS_PATTERN = /^\s*(ændret|aendret|changed|flyttet|moved)\s*!*\s*$/i;
    // Lectio uses a hold for school-wide groupings as well as for classes:
    // Alle Laerere, Alle 1i-elever, Alle Matematik-laerere. Danish "alle" is
    // "everyone", and a hold that means everyone is by definition not one of
    // your own subjects. They also recur far more reliably than any lesson, so
    // left alone the staff hold becomes the most frequent thing in a teacher's
    // timetable and takes the first colour ahead of every real class.
    const EVERYONE_HOLD_PATTERN = /^\s*alle\b/i;
    // A lesson belongs to a class or two; a block listing half the school's
    // year groups at once is an assembly, whatever its holds are called.
    const MAX_CLASS_HOLDS = 3;

    const HOLD_FIELD_PATTERN = /^(?:Hold|Team|Class)\s*:\s*(.+)$/i;
    const TOOLTIP_DATE_PATTERN = /(\d{1,2})\/(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/;

    const lifecycle = new AbortController();
    let settings = loadSettings();
    let store = loadStore();
    let theme = readTheme();
    // A page can load with the lock already on from a previous session (or
    // from settings written before this freeze existed) and no theme ever
    // captured for it. Catching that here, once, means the freeze always has
    // something to hold onto by the time anything gets painted.
    ensureLockedTheme();
    let previewStyle = null;
    let legendExpanded = false;
    let scanning = false;
    let applyHandle = 0;
    let themeHandle = 0;
    // Bumped whenever anything a block's colour depends on changes, so an
    // ordinary DOM mutation only has to look at blocks that are actually out of
    // date rather than re-deriving every colour on the page.
    let revision = 1;
    let storeDirty = false;

    // ============================================================
    // SETTINGS
    // ============================================================

    function loadSettings() {
        const saved = readJson(SETTINGS_KEY, {});
        const overrides = {};

        if (saved.overrides && typeof saved.overrides === 'object') {
            for (const [key, value] of Object.entries(saved.overrides)) {
                if (isHexColour(value)) overrides[key] = String(value).toLowerCase();
            }
        }

        return {
            enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_SETTINGS.enabled,
            style: hasOption(STYLE_OPTIONS, saved.style) ? saved.style : DEFAULT_SETTINGS.style,
            intensity: clamp(Number(saved.intensity) || DEFAULT_SETTINGS.intensity, 60, 140),
            regularity: hasOption(REGULARITY_OPTIONS, saved.regularity)
                ? saved.regularity
                : DEFAULT_SETTINGS.regularity,
            scanWeeks: clamp(Math.round(Number(saved.scanWeeks ?? DEFAULT_SETTINGS.scanWeeks)), 0, 16),
            colourOther: typeof saved.colourOther === 'boolean'
                ? saved.colourOther
                : DEFAULT_SETTINGS.colourOther,
            showLegend: typeof saved.showLegend === 'boolean'
                ? saved.showLegend
                : DEFAULT_SETTINGS.showLegend,
            lockColours: typeof saved.lockColours === 'boolean'
                ? saved.lockColours
                : DEFAULT_SETTINGS.lockColours,
            lockedTheme: isValidLockedTheme(saved.lockedTheme) ? saved.lockedTheme : DEFAULT_SETTINGS.lockedTheme,
            overrides
        };
    }

    function isValidLockedTheme(value) {
        return Boolean(value)
            && typeof value === 'object'
            && typeof value.dark === 'boolean'
            && Number.isFinite(value.accentHue)
            && Number.isFinite(value.mutedHue)
            && isHexColour(value.bg) && isHexColour(value.text)
            && isHexColour(value.accent) && isHexColour(value.muted);
    }

    function saveSettings() {
        writeJson(SETTINGS_KEY, settings);
    }

    function hasOption(options, value) {
        return options.some(option => option.value === value);
    }

    function thresholds() {
        return REGULARITY_THRESHOLDS[settings.regularity] || REGULARITY_THRESHOLDS.balanced;
    }

    // ============================================================
    // STORAGE
    // ============================================================

    function storeKey() {
        return `${STORE_PREFIX}.${SCHOOL || 'unknown'}`;
    }

    function emptyStore() {
        return { scannedAt: 0, weeks: {}, slots: {}, otherSlots: {}, entries: {}, aliases: {} };
    }

    function loadStore() {
        const saved = readJson(storeKey(), null);
        if (!saved || typeof saved !== 'object') return emptyStore();

        const result = emptyStore();
        result.scannedAt = Number(saved.scannedAt) || 0;

        for (const source of ['weeks', 'slots', 'otherSlots', 'aliases']) {
            if (saved[source] && typeof saved[source] === 'object') {
                Object.assign(result[source], saved[source]);
            }
        }

        if (saved.entries && typeof saved.entries === 'object') {
            for (const [key, entry] of Object.entries(saved.entries)) {
                if (!entry || typeof entry !== 'object') continue;
                result.entries[key] = {
                    label: String(entry.label || key),
                    hold: Boolean(entry.hold),
                    ids: Array.isArray(entry.ids) ? entry.ids.slice(0, 8) : [],
                    names: Array.isArray(entry.names) ? entry.names.slice(0, 8) : [],
                    weekCounts: (entry.weekCounts && typeof entry.weekCounts === 'object')
                        ? entry.weekCounts
                        : {},
                    lastSeen: Number(entry.lastSeen) || 0
                };
            }
        }

        return result;
    }

    function saveStore() {
        pruneStore();
        writeJson(storeKey(), store);
        storeDirty = false;
    }

    function flushStore() {
        if (storeDirty) saveStore();
    }

    // A browser's localStorage is shared with every other module, so the learned
    // schedule is capped rather than left to grow for as long as someone keeps
    // the same browser profile.
    function pruneStore() {
        const entries = Object.entries(store.entries);

        if (entries.length > MAX_ENTRIES) {
            entries
                .sort((a, b) => (a[1].lastSeen || 0) - (b[1].lastSeen || 0))
                .slice(0, entries.length - MAX_ENTRIES)
                .forEach(([key]) => {
                    delete store.entries[key];
                    delete store.slots[key];
                    delete store.otherSlots[key];
                });
        }

        for (const entry of Object.values(store.entries)) {
            const weeks = Object.keys(entry.weekCounts).sort();
            for (const week of weeks.slice(0, Math.max(0, weeks.length - MAX_TRACKED_WEEKS))) {
                delete entry.weekCounts[week];
            }
        }

        const trackedWeeks = Object.keys(store.weeks).sort();
        for (const week of trackedWeeks.slice(0, Math.max(0, trackedWeeks.length - MAX_TRACKED_WEEKS))) {
            delete store.weeks[week];
        }
    }

    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (_) {
            // Continue with in-memory state when storage is full or blocked.
        }
    }

    // ============================================================
    // READING A LESSON BLOCK
    // ============================================================

    // Lectio reuses the .s2skemabrik class decoratively: an activity page's
    // table-of-contents entry carries it purely to borrow the block icon, with
    // no tooltip, no hold and no date. The class on its own is therefore not
    // enough to identify a lesson. Every real lesson or booking block carries
    // the tooltip this module already reads its date, hold names and
    // cancellation from, so requiring one keeps decoration out of both the
    // paint and the learned timetable, and costs nothing on a block the module
    // could have said anything about.
    function blockElements(root) {
        return [...root.querySelectorAll('.s2skemabrik[data-tooltip]')];
    }

    function tooltipLines(element) {
        return String(element.getAttribute('data-tooltip') || '')
            .split('\n')
            .map(line => line.replace(/ /g, ' ').replace(/\s+/g, ' ').trim());
    }

    function isCancelled(element, lines) {
        if (element.classList.contains('s2cancelled') || element.querySelector('.s2cancelled')) return true;
        return lines.some(line => CANCELLED_PATTERN.test(line));
    }

    function normaliseName(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function holdIdsOf(element) {
        return [...new Set(
            [...element.querySelectorAll('[data-lectiocontextcard^="HE"]')]
                .map(node => node.getAttribute('data-lectiocontextcard'))
                .filter(Boolean)
        )].sort();
    }

    function holdNamesOf(element, lines) {
        const fromTooltip = lines
            .map(line => (line.match(HOLD_FIELD_PATTERN) || [])[1])
            .find(Boolean);

        if (fromTooltip) {
            return [...new Set(fromTooltip.split(',').map(name => name.trim()).filter(Boolean))];
        }

        return [...new Set(
            [...element.querySelectorAll('[data-lectiocontextcard^="HE"]')]
                .map(node => node.textContent.replace(/\s+/g, ' ').trim())
                .filter(Boolean)
        )];
    }

    // The title of an activity that has no hold — an assembly, a meeting, a
    // trip. Everything Lectio labels with a field name is metadata, and the
    // homework block runs to the end of the tooltip, so both are dropped.
    function titleOf(element, lines) {
        const useful = [];

        for (const line of lines) {
            if (!line) continue;
            if (STATUS_PATTERN.test(line)) continue;
            if (TOOLTIP_FIELD_PATTERN.test(line)) {
                if (/^(Lektier|Homework|Note|Noter|Øvrigt indhold|Other content)\s*:/i.test(line)) break;
                continue;
            }
            if (TOOLTIP_DATE_PATTERN.test(line) && /\d{1,2}:\d{2}/.test(line)) continue;
            useful.push(line);
        }

        if (useful.length) return useful[0].slice(0, 60);

        const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
        return text.replace(/^\p{L}{2,3}\s+\d{1,2}\/\d{1,2}\s*/u, '').slice(0, 60) || 'Aktivitet';
    }

    function dateOf(element, lines) {
        const cell = element.closest('td[data-date]');
        const cellDate = cell?.getAttribute('data-date');

        if (cellDate && /^\d{4}-\d{2}-\d{2}$/.test(cellDate)) {
            const [year, month, day] = cellDate.split('-').map(Number);
            return new Date(year, month - 1, day);
        }

        for (const line of lines) {
            const match = line.match(TOOLTIP_DATE_PATTERN);
            if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
        }

        return null;
    }

    // A block is described by whatever the page actually exposes: hold ids are
    // the stable identity, hold names are what a person recognises, and a
    // titled activity with no hold at all is the signal that this is not a
    // class in the first place.
    function describeBlock(element) {
        const lines = tooltipLines(element);
        if (isCancelled(element, lines)) return null;

        const ids = holdIdsOf(element);
        const names = holdNamesOf(element, lines);
        const hold = ids.length > 0 || names.length > 0;
        const label = hold ? names.join(' + ') || ids.join(' + ') : titleOf(element, lines);
        const key = ids.length
            ? `h:${ids.join('+')}`
            : (names.length ? `n:${names.map(normaliseName).sort().join('+')}` : `t:${normaliseName(label)}`);

        return { key, label, hold, ids, names, date: dateOf(element, lines) };
    }

    // A block seen with hold ids on one page and only hold names on another
    // must not become two different classes, so every name a keyed hold is seen
    // under is remembered and resolves back to that same key.
    function resolveKey(description) {
        if (description.key.startsWith('h:')) {
            for (const name of description.names) {
                const alias = normaliseName(name);
                if (alias && store.aliases[alias] !== description.key) {
                    store.aliases[alias] = description.key;
                    storeDirty = true;
                }
            }
            return description.key;
        }

        for (const name of description.names.length ? description.names : [description.label]) {
            const alias = store.aliases[normaliseName(name)];
            if (alias && store.entries[alias]) return alias;
        }

        return description.key;
    }

    // ============================================================
    // LEARNING
    // ============================================================

    function isoWeekOf(date) {
        const point = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const day = point.getUTCDay() || 7;
        point.setUTCDate(point.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(point.getUTCFullYear(), 0, 1));
        const week = Math.ceil(((point - yearStart) / 86400000 + 1) / 7);
        return `${String(week).padStart(2, '0')}${point.getUTCFullYear()}`;
    }

    function weekWindow(count) {
        const weeks = [];
        const today = new Date();
        // Biased towards weeks already taught: a past week is settled fact,
        // where a week far ahead may simply not be planned yet.
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7 * Math.floor((count - 1) * 0.6));

        for (let index = 0; index < count; index += 1) {
            const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index * 7);
            const week = isoWeekOf(day);
            if (!weeks.includes(week)) weeks.push(week);
        }

        return weeks;
    }

    function entryFor(key, description) {
        const existing = store.entries[key];

        if (existing) {
            // A description that carries a hold knows the real name of this
            // class; one that does not is only ever a fallback title.
            if (description.label && (description.hold || !existing.hold)) {
                existing.label = description.label;
            }
            existing.hold = existing.hold || description.hold;
            existing.ids = [...new Set([...existing.ids, ...description.ids])].slice(0, 8);
            existing.names = [...new Set([...existing.names, ...description.names])].slice(0, 8);
            existing.lastSeen = Date.now();
            storeDirty = true;
            return existing;
        }

        storeDirty = true;
        store.entries[key] = {
            label: description.label,
            hold: description.hold,
            ids: description.ids,
            names: description.names,
            weekCounts: {},
            lastSeen: Date.now()
        };

        return store.entries[key];
    }

    // Only your own timetable is evidence about your own classes. A room's
    // page, a colleague's schedule and a hold's own page all render the same
    // blocks, and counting those would hand a colour to a class that is not
    // yours — so they are read for identity and never for frequency.
    // Lectio asks for somebody else's timetable with an explicit type in the
    // URL — type=lokale for a room, type=elev or type=laerer for a person,
    // type=hold for a class — and renders it with exactly the same blocks. Your
    // own schedule and front page carry no type at all, which is the one
    // distinction worth trusting here.
    function isOwnTimetable() {
        return !new URLSearchParams(location.search).get('type');
    }

    // A document that renders a whole week is authoritative for that week and
    // replaces what was counted before; a page that happens to show a couple of
    // blocks (the front page, an activity page) may only raise a count, never
    // lower one.
    // The rendered week table is what makes a document authoritative about a
    // week, and equally what makes it a timetable at all rather than an error
    // page wearing a 200. One definition, used for both.
    function isTimetable(doc) {
        return Boolean(doc.querySelector('tr.s2dayHeader, [id$="_skematabel"]'));
    }

    function harvestDocument(doc, { counting = true } = {}) {
        const fullWeek = counting && isTimetable(doc);
        const counts = new Map();
        let observed = 0;

        for (const element of blockElements(doc)) {
            const description = describeBlock(element);
            if (!description || !description.date) continue;

            const key = resolveKey(description);
            entryFor(key, description);
            observed += 1;

            if (!counting) continue;

            const week = isoWeekOf(description.date);
            if (!counts.has(week)) counts.set(week, new Map());
            const forWeek = counts.get(week);
            forWeek.set(key, (forWeek.get(key) || 0) + 1);
        }

        for (const [week, forWeek] of counts) {
            for (const [key, count] of forWeek) {
                const entry = store.entries[key];
                if (!entry) continue;
                const previous = Number(entry.weekCounts[week]) || 0;
                entry.weekCounts[week] = fullWeek ? count : Math.max(previous, count);
            }

            if (!fullWeek) continue;

            // A whole week that no longer contains a hold is evidence of
            // absence, not missing evidence. Without this, a class dropped at
            // the end of a term would keep its old count and its colour for as
            // long as the store lived.
            for (const [key, entry] of Object.entries(store.entries)) {
                if (!forWeek.has(key)) delete entry.weekCounts[week];
            }
        }

        return { observed, fullWeek, weeks: [...counts.keys()] };
    }

    function occurrencesOf(entry) {
        return Object.values(entry.weekCounts).reduce((total, count) => total + (Number(count) || 0), 0);
    }

    function weeksSeenOf(entry) {
        return Object.values(entry.weekCounts).filter(count => Number(count) > 0).length;
    }

    // A class is a hold that keeps coming back. Anything without a hold is not a
    // class at all, however often it recurs — that is exactly the assembly,
    // meeting and trip case this module wants to keep out of the class palette.
    function kindOf(key) {
        const entry = store.entries[key];
        if (!entry) return 'other';
        if (!entry.hold) return 'other';
        if (entry.ids.length > MAX_CLASS_HOLDS || entry.names.length > MAX_CLASS_HOLDS) return 'other';
        if (entry.names.length && entry.names.every(name => EVERYONE_HOLD_PATTERN.test(name))) return 'other';

        const limits = thresholds();
        return (weeksSeenOf(entry) >= limits.minWeeks && occurrencesOf(entry) >= limits.minOccurrences)
            ? 'class'
            : 'other';
    }

    function classKeys() {
        return Object.keys(store.entries)
            .filter(key => kindOf(key) === 'class')
            .sort((a, b) => {
                const difference = occurrencesOf(store.entries[b]) - occurrencesOf(store.entries[a]);
                return difference || a.localeCompare(b);
            });
    }

    // Slots are handed out once and then kept. Deriving a colour from a class's
    // current rank instead would mean every class changed colour the moment a
    // new one appeared, which is the opposite of what colour-coding is for.
    function slotFor(key, kind) {
        const table = kind === 'class' ? store.slots : store.otherSlots;
        if (Number.isInteger(table[key])) return table[key];

        const used = new Set(Object.values(table).filter(Number.isInteger));
        let slot = 0;
        while (used.has(slot)) slot += 1;
        table[key] = slot;
        storeDirty = true;
        return slot;
    }

    // ============================================================
    // COLOUR
    // ============================================================

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function isHexColour(value) {
        return /^#[0-9a-f]{6}$/i.test(String(value || ''));
    }

    function parseColour(value) {
        const text = String(value || '').trim();
        if (!text) return null;

        const short = text.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
        if (short) return short.slice(1).map(part => Number.parseInt(part + part, 16));

        if (isHexColour(text)) {
            const number = Number.parseInt(text.slice(1), 16);
            return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
        }

        const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
        if (rgb) return rgb.slice(1, 4).map(part => clamp(Math.round(Number(part)), 0, 255));

        return null;
    }

    function toHex(rgb) {
        return `#${rgb.map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`;
    }

    function rgbToHsl([red, green, blue]) {
        const r = red / 255;
        const g = green / 255;
        const b = blue / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const lightness = (max + min) / 2;
        const delta = max - min;

        if (!delta) return [0, 0, lightness * 100];

        const saturation = delta / (1 - Math.abs(2 * lightness - 1));
        let hue;

        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);

        return [(hue + 360) % 360, clamp(saturation, 0, 1) * 100, lightness * 100];
    }

    function hslToRgb([hue, saturation, lightness]) {
        const s = clamp(saturation, 0, 100) / 100;
        const l = clamp(lightness, 0, 100) / 100;
        const chroma = (1 - Math.abs(2 * l - 1)) * s;
        const section = ((hue % 360) + 360) % 360 / 60;
        const second = chroma * (1 - Math.abs((section % 2) - 1));
        const match = l - chroma / 2;
        const table = [
            [chroma, second, 0], [second, chroma, 0], [0, chroma, second],
            [0, second, chroma], [second, 0, chroma], [chroma, 0, second]
        ];
        const [r, g, b] = table[Math.floor(section) % 6];

        return [(r + match) * 255, (g + match) * 255, (b + match) * 255];
    }

    function hslHex(hue, saturation, lightness) {
        return toHex(hslToRgb([hue, saturation, lightness]));
    }

    function relativeLightness(rgb) {
        const channels = rgb.map(value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }

    function contrastRatio(a, b) {
        const first = relativeLightness(parseColour(a) || [0, 0, 0]);
        const second = relativeLightness(parseColour(b) || [255, 255, 255]);
        return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    }

    // Read the ADR-0006 seam. Every value falls back to Lectio's own look, so
    // this module never depends on Lectio Theming being installed — it just
    // follows it when it is.
    function readTheme() {
        const computed = getComputedStyle(document.documentElement);
        const read = (name, fallback) => {
            const parsed = parseColour(computed.getPropertyValue(name));
            return parsed ? toHex(parsed) : fallback;
        };

        const result = {
            bg: read('--lectio-theme-bg', FALLBACK_THEME.bg),
            text: read('--lectio-theme-text', FALLBACK_THEME.text),
            accent: read('--lectio-theme-accent', FALLBACK_THEME.accent),
            muted: read('--lectio-theme-muted', FALLBACK_THEME.muted)
        };

        result.dark = relativeLightness(parseColour(result.bg)) < 0.32;
        result.accentHue = rgbToHsl(parseColour(result.accent))[0];

        const mutedHsl = rgbToHsl(parseColour(result.muted));
        // A neutral grey has no hue worth borrowing, so the one-off band is
        // anchored on the accent instead and simply kept almost colourless.
        result.mutedHue = mutedHsl[1] > 6 ? mutedHsl[0] : (result.accentHue + 180) % 360;

        return result;
    }

    // Successive hues a golden angle apart stay far from each other for any
    // number of classes, and for every prefix of that sequence — which is what
    // makes a stable slot number safe to hand out before anyone knows how many
    // classes there will end up being.
    // Locking freezes the hue every auto-derived colour is built from, not
    // just the ones someone has hand-picked: the lock is against the theme
    // moving colours out from under a class, and a class nobody has picked a
    // colour of their own for is otherwise still riding the live theme.
    //
    // Lectio is a page-at-a-time site, not a single page app: almost every
    // click reloads this module from scratch. Freezing the theme only in
    // memory would mean the very next navigation re-derives it from whatever
    // theme happens to be active by then — silently re-opening the door the
    // lock was meant to close. Saving it here is what makes the freeze
    // outlive the page it was set on.
    function ensureLockedTheme() {
        if (settings.lockColours && !settings.lockedTheme) {
            settings.lockedTheme = { ...theme };
            saveSettings();
        }
    }

    // What every colour in this module is actually built from: the live
    // theme normally, or the one frozen the moment the lock went on, for as
    // long as it stays on.
    function effectiveTheme() {
        return settings.lockColours && settings.lockedTheme ? settings.lockedTheme : theme;
    }

    function classHue(slot) {
        return (effectiveTheme().accentHue + 40 + slot * 137.508) % 360;
    }

    function otherHue(slot) {
        return (effectiveTheme().mutedHue + ((slot % 5) - 2) * 14 + 360) % 360;
    }

    function paletteFor(key, kind) {
        const activeTheme = effectiveTheme();
        const intensity = settings.intensity / 100;
        const slot = slotFor(key, kind);
        const override = settings.overrides[key];
        let fill;
        let line;

        if (kind === 'class') {
            const hue = classHue(slot);
            fill = activeTheme.dark
                ? hslHex(hue, clamp(38 * intensity, 12, 70), clamp(24 + (intensity - 1) * 10, 14, 40))
                : hslHex(hue, clamp(55 * intensity, 16, 92), clamp(88 - (intensity - 1) * 14, 64, 95));
            line = hslHex(hue, clamp(64 * intensity, 20, 96), activeTheme.dark ? 60 : 42);
        } else {
            const hue = otherHue(slot);
            fill = activeTheme.dark
                ? hslHex(hue, clamp(9 * intensity, 0, 22), 22)
                : hslHex(hue, clamp(12 * intensity, 0, 26), 92);
            line = hslHex(hue, clamp(18 * intensity, 0, 34), activeTheme.dark ? 48 : 62);
        }

        const chosen = isHexColour(override);
        // A locked colour is the one thing on the page the theme does not get a
        // say in: it is used exactly as it was picked, and everything paired
        // with it is derived from the colour itself rather than the scheme, so
        // it looks identical whichever theme is running.
        const locked = chosen && settings.lockColours;

        if (chosen) {
            fill = String(override).toLowerCase();
            const [hue, saturation, lightness] = rgbToHsl(parseColour(fill));
            line = locked
                ? hslHex(hue, clamp(saturation + 18, 18, 96),
                    clamp(lightness < 50 ? lightness + 28 : lightness - 28, 0, 100))
                : hslHex(hue, clamp(saturation + 18, 18, 96), activeTheme.dark ? 62 : 40);
        }

        // The theme's own text colour is kept wherever it can be read, because
        // that is what makes a coloured block still look like part of the theme.
        // Only when it cannot is the block's own fill moved out of the way —
        // and never when the fill is a colour someone picked by hand, where the
        // text is the only side of the pair this module still gets to choose.
        let text = activeTheme.text;
        let guard = 0;

        // Bounded well short of pure black or white: a theme whose own text
        // colour is too middling to ever clear 4.5 against anything (Solarized
        // Light's does not, even against white) would otherwise have this loop
        // run every class all the way to the same washed-out extreme, erasing
        // hue and turning "colour the schedule" into "blank the schedule".
        // Stopping short keeps every class's own hue showing through — legible
        // or not is then the job of the text-colour fallback just below.
        while (!chosen && contrastRatio(text, fill) < 4.5 && guard < 10) {
            const [hue, saturation, lightness] = rgbToHsl(parseColour(fill));
            fill = hslHex(hue, saturation, clamp(lightness + (activeTheme.dark ? -5 : 5), 8, 92));
            guard += 1;
        }

        // Readability is not what the lock is for: a colour someone picked
        // still has to be legible, so the text is chosen against that colour
        // instead of inherited from a theme the lock is ignoring.
        if (locked || contrastRatio(text, fill) < 4.5) {
            text = contrastRatio('#ffffff', fill) >= contrastRatio('#000000', fill) ? '#ffffff' : '#000000';
        }

        return { fill, line, text };
    }

    // ============================================================
    // APPLYING
    // ============================================================

    function effectiveStyle() {
        return previewStyle || settings.style;
    }

    // Only ever takes back this module's own paint. A block carrying somebody
    // else's inline colour was never marked, so nothing is removed from it —
    // standing aside would be worthless if it stripped the other extension's
    // work on the way past.
    function clearBlock(element) {
        const wasPainted = element.hasAttribute(KIND_ATTRIBUTE);

        element.removeAttribute(KIND_ATTRIBUTE);
        element.removeAttribute(KEY_ATTRIBUTE);
        delete element.dataset.lectioSubjectRev;

        if (!wasPainted) return;

        for (const property of [
            '--lectio-subject-fill', '--lectio-subject-line', '--lectio-subject-text',
            'background-color', 'background-image', 'color'
        ]) {
            element.style.removeProperty(property);
        }
    }

    // The stripe drawn down a block's leading edge. A one-off activity gets a
    // broken line rather than a solid one, so "this is not one of my classes"
    // survives being read by someone who cannot separate the two colours.
    function stripeImage(kind) {
        return kind === 'other'
            ? 'repeating-linear-gradient(to bottom, var(--lectio-subject-line) 0 5px, transparent 5px 10px)'
            : 'linear-gradient(var(--lectio-subject-line), var(--lectio-subject-line))';
    }

    // Filling a block has to be written inline and important: Lectio Theming
    // colours links inside Lectio's content shell through an id-carrying
    // selector, which no practical class-and-attribute selector can out-rank,
    // and a lesson block is itself a link. Striping does not need it, so it
    // stays in the stylesheet — which is what lets a striped block keep the
    // themed surface underneath it.
    function paintBlock(element, palette, kind) {
        const style = effectiveStyle();

        element.style.setProperty('--lectio-subject-fill', palette.fill);
        element.style.setProperty('--lectio-subject-line', palette.line);
        element.style.setProperty('--lectio-subject-text', palette.text);

        if (style === 'fill' || style === 'both') {
            element.style.setProperty('background-color', palette.fill, 'important');
            element.style.setProperty('color', palette.text, 'important');
        } else {
            element.style.removeProperty('background-color');
            element.style.removeProperty('color');
        }

        if (style === 'both') {
            element.style.setProperty('background-image', stripeImage(kind), 'important');
        } else {
            element.style.removeProperty('background-image');
        }
    }

    function invalidate() {
        revision += 1;
    }

    // Another subject-colouring extension (Lectio Farver, Lectio i farver,
    // Lectio Colors++) writes its colour straight onto the block as an inline
    // background. On a block this module has not marked, an inline background
    // is therefore always somebody else's — and that block is left entirely
    // alone rather than fought over.
    function hasForeignBackground(element) {
        if (element.hasAttribute(KIND_ATTRIBUTE)) return false;

        const inline = element.style;
        return Boolean(inline.background || inline.backgroundColor || inline.backgroundImage);
    }

    function applyAll() {
        const root = document.documentElement;

        if (!settings.enabled) {
            root.removeAttribute(STYLE_ATTRIBUTE);
            blockElements(document).forEach(clearBlock);
            removeLegend();
            return;
        }

        root.setAttribute(STYLE_ATTRIBUTE, effectiveStyle());

        for (const element of blockElements(document)) {
            if (Number(element.dataset.lectioSubjectRev) === revision) continue;

            if (hasForeignBackground(element)) {
                clearBlock(element);
                continue;
            }

            const description = describeBlock(element);

            if (!description) {
                clearBlock(element);
                continue;
            }

            const key = resolveKey(description);
            // A block can be on screen before anything is known about it: a
            // colleague's schedule, a room's own page, the very first load.
            // Registering it here means it is classified by the same rule as
            // everything else rather than by a separate unknown case.
            if (!store.entries[key]) entryFor(key, description);

            const kind = kindOf(key);

            if (kind !== 'class' && !settings.colourOther) {
                clearBlock(element);
                continue;
            }

            element.setAttribute(KIND_ATTRIBUTE, kind);
            element.setAttribute(KEY_ATTRIBUTE, key);
            element.dataset.lectioSubjectRev = String(revision);
            paintBlock(element, paletteFor(key, kind), kind);
        }

        renderLegend();
        flushStore();
    }

    function queueApply() {
        window.clearTimeout(applyHandle);
        applyHandle = window.setTimeout(() => {
            if (!lifecycle.signal.aborted) applyAll();
        }, 120);
    }

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        // Everything here is deliberately more specific than the schedule-block
        // rule in Lectio Theming, so a subject colour composes with the themed
        // shell — border, radius, shadow — instead of replacing it. Striping a
        // block leaves its surface to whatever theme is installed, which is why
        // the stripe lives here and the fill does not.
        style.textContent = `
            html[${STYLE_ATTRIBUTE}="stripe"] .s2skemabrik[${KIND_ATTRIBUTE}],
            html[${STYLE_ATTRIBUTE}="both"] .s2skemabrik[${KIND_ATTRIBUTE}] {
                background-repeat: no-repeat !important;
                background-size: 4px 100% !important;
                background-position: left top !important;
            }

            html[${STYLE_ATTRIBUTE}="stripe"] .s2skemabrik[${KIND_ATTRIBUTE}] {
                background-image: ${stripeImage('class')} !important;
            }

            html[${STYLE_ATTRIBUTE}="stripe"] .s2skemabrik[${KIND_ATTRIBUTE}="other"] {
                background-image: ${stripeImage('other')} !important;
            }

            html[${STYLE_ATTRIBUTE}="fill"] .s2skemabrik[${KIND_ATTRIBUTE}] *,
            html[${STYLE_ATTRIBUTE}="both"] .s2skemabrik[${KIND_ATTRIBUTE}] * {
                color: inherit !important;
            }

            .s2skemabrik[${KIND_ATTRIBUTE}].${HIGHLIGHT_CLASS} {
                outline: 2px solid var(--lectio-subject-line, currentColor) !important;
                outline-offset: -2px;
            }

            #${LEGEND_ID} {
                bottom: 14px;
                font: 400 12px/1.3 Roboto, Arial, sans-serif;
                left: 14px;
                position: fixed;
                z-index: 900;
            }

            #${LEGEND_ID} .lectio-subject-colours-legend__toggle {
                align-items: center;
                background: var(--lectio-theme-surface, #ffffff);
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
                border-radius: 999px;
                box-shadow: 0 2px 10px color-mix(in srgb, var(--lectio-theme-muted, #5e6870) 30%, transparent);
                color: var(--lectio-theme-text, #10201e);
                cursor: pointer;
                display: flex;
                gap: 6px;
                padding: 6px 12px;
            }

            #${LEGEND_ID} .lectio-subject-colours-legend__toggle:hover,
            #${LEGEND_ID} .lectio-subject-colours-legend__toggle:focus-visible {
                border-color: var(--lectio-theme-accent, #0f6f6f);
                outline: none;
            }

            #${LEGEND_ID} .lectio-subject-colours-legend__swatches {
                display: flex;
                gap: 3px;
            }

            #${LEGEND_ID} .lectio-subject-colours-legend__dot {
                border-radius: 50%;
                height: 10px;
                width: 10px;
            }

            #${LEGEND_ID} .lectio-subject-colours-legend__chevron {
                color: var(--lectio-theme-muted, #5e6870);
                font-size: 10px;
            }

            #${LEGEND_PANEL_ID} {
                background: var(--lectio-theme-surface, #ffffff);
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
                border-radius: max(6px, var(--lectio-theme-radius, 10px));
                bottom: calc(100% + 8px);
                box-shadow: 0 10px 28px color-mix(in srgb, var(--lectio-theme-muted, #5e6870) 28%, transparent);
                left: 0;
                max-height: 60vh;
                max-width: min(280px, calc(100vw - 28px));
                overflow: auto;
                padding: 8px;
                position: absolute;
            }

            #${LEGEND_PANEL_ID}[hidden] {
                display: none;
            }

            .lectio-subject-colours-legend__header {
                align-items: center;
                color: var(--lectio-theme-muted, #5e6870);
                display: flex;
                font-size: 11px;
                justify-content: space-between;
                margin-bottom: 4px;
                padding: 0 2px;
                text-transform: uppercase;
            }

            .lectio-subject-colours-legend__close {
                background: none;
                border: none;
                border-radius: 4px;
                color: inherit;
                cursor: pointer;
                font-size: 14px;
                line-height: 1;
                padding: 2px 5px;
            }

            .lectio-subject-colours-legend__close:hover,
            .lectio-subject-colours-legend__close:focus-visible {
                background: var(--lectio-theme-surface-alt, #eef1f2);
                outline: none;
            }

            .lectio-subject-colours-legend__list {
                display: grid;
                gap: 2px;
                list-style: none;
                margin: 0;
                padding: 0;
            }

            .lectio-subject-colours-legend__entry {
                align-items: center;
                background: none;
                border: none;
                border-radius: 5px;
                color: var(--lectio-theme-text, #10201e);
                cursor: pointer;
                display: flex;
                gap: 8px;
                padding: 4px 6px;
                text-align: left;
                width: 100%;
            }

            .lectio-subject-colours-legend__entry:hover,
            .lectio-subject-colours-legend__entry:focus-visible,
            .lectio-subject-colours-legend__row.is-hover .lectio-subject-colours-legend__entry {
                background: var(--lectio-theme-surface-alt, #eef1f2);
                outline: none;
            }

            .lectio-subject-colours-legend__swatch {
                background: var(--entry-fill);
                border: 1px solid var(--entry-line);
                border-radius: 4px;
                flex: none;
                height: 14px;
                width: 14px;
            }

            .lectio-subject-colours-legend__label {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .lectio-subject-colours-legend__row .lectio-subject-colours-legend__picker {
                height: 1px;
                left: -9999px;
                opacity: 0;
                position: absolute;
                width: 1px;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // ============================================================
    // LEGEND
    // ============================================================
    //
    // A compact, collapsed-by-default key listing the classes actually on
    // screen — a floating strip rather than a row injected into a schedule
    // table, so it works the same on every page this module paints instead
    // of depending on one page's layout. Rebuilt only when the visible set
    // of classes or their colours actually changes, so an unrelated page
    // mutation does not interrupt someone mid-hover.

    let legendSignature = '';

    function legendLabels() {
        const language = (document.documentElement.lang || '').toLowerCase();
        const english = language.startsWith('en');

        return english
            ? {
                toggle: count => `Colours · ${count}`,
                show: 'Show colour key',
                hide: 'Hide colour key',
                heading: 'Colour key'
            }
            : {
                toggle: count => `Farver · ${count}`,
                show: 'Vis farvenøgle',
                hide: 'Skjul farvenøgle',
                heading: 'Farvenøgle'
            };
    }

    // Only a class already painted on the page counts: a quiet week with two
    // classes shows two entries, not every class ever learned.
    function visibleClassKeys() {
        const seen = new Set();

        for (const element of blockElements(document)) {
            if (element.getAttribute(KIND_ATTRIBUTE) !== 'class') continue;
            const key = element.getAttribute(KEY_ATTRIBUTE);
            if (key) seen.add(key);
        }

        return classKeys().filter(key => seen.has(key));
    }

    function setBlocksHighlighted(key, on) {
        for (const element of blockElements(document)) {
            if (element.getAttribute(KEY_ATTRIBUTE) === key) {
                element.classList.toggle(HIGHLIGHT_CLASS, on);
            }
        }
    }

    function setEntryHighlighted(key, on) {
        const container = document.getElementById(LEGEND_ID);
        if (!container) return;

        for (const row of container.querySelectorAll('.lectio-subject-colours-legend__row')) {
            if (row.dataset.key === key) row.classList.toggle('is-hover', on);
        }
    }

    function setLegendExpanded(container, expanded) {
        const toggle = container.querySelector('.lectio-subject-colours-legend__toggle');
        const panel = document.getElementById(LEGEND_PANEL_ID);
        const chevron = container.querySelector('.lectio-subject-colours-legend__chevron');
        const strings = legendLabels();
        if (!toggle || !panel) return;

        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? strings.hide : strings.show);
        panel.hidden = !expanded;
        if (chevron) chevron.textContent = expanded ? '▾' : '▴';
    }

    function updateLegendToggleLabel(container, count) {
        const label = container.querySelector('.lectio-subject-colours-legend__toggle-label');
        if (label) label.textContent = legendLabels().toggle(count);
    }

    // Recolouring straight from the legend, with no trip through the
    // Manager: a native colour input sits right next to the swatch, and
    // clicking the entry opens it directly.
    function applyLegendOverride(key, value) {
        if (!isHexColour(value)) return;

        settings.overrides[key] = String(value).toLowerCase();
        saveSettings();
        invalidate();
        applyAll();
        announce();
    }

    function buildLegendRow(key) {
        const entry = store.entries[key];
        const palette = paletteFor(key, 'class');

        const row = document.createElement('li');
        row.className = 'lectio-subject-colours-legend__row';
        row.dataset.key = key;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lectio-subject-colours-legend__entry';
        button.title = entry?.label || key;

        const swatch = document.createElement('span');
        swatch.className = 'lectio-subject-colours-legend__swatch';
        swatch.style.setProperty('--entry-fill', palette.fill);
        swatch.style.setProperty('--entry-line', palette.line);
        swatch.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'lectio-subject-colours-legend__label';
        label.textContent = entry?.label || key;

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'lectio-subject-colours-legend__picker';
        picker.tabIndex = -1;
        picker.setAttribute('aria-hidden', 'true');
        picker.value = isHexColour(palette.fill) ? palette.fill : '#808080';

        button.append(swatch, label);

        button.addEventListener('click', () => picker.click(), { signal: lifecycle.signal });
        button.addEventListener('mouseenter', () => setBlocksHighlighted(key, true), { signal: lifecycle.signal });
        button.addEventListener('mouseleave', () => setBlocksHighlighted(key, false), { signal: lifecycle.signal });
        button.addEventListener('focus', () => setBlocksHighlighted(key, true), { signal: lifecycle.signal });
        button.addEventListener('blur', () => setBlocksHighlighted(key, false), { signal: lifecycle.signal });
        picker.addEventListener('change', () => applyLegendOverride(key, picker.value), { signal: lifecycle.signal });

        row.append(button, picker);
        return row;
    }

    function ensureLegendContainer() {
        const existing = document.getElementById(LEGEND_ID);
        if (existing) return existing;

        const strings = legendLabels();
        const container = document.createElement('div');
        container.id = LEGEND_ID;

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'lectio-subject-colours-legend__toggle';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', LEGEND_PANEL_ID);
        toggle.setAttribute('aria-label', strings.show);

        const label = document.createElement('span');
        label.className = 'lectio-subject-colours-legend__toggle-label';

        const swatches = document.createElement('span');
        swatches.className = 'lectio-subject-colours-legend__swatches';
        swatches.setAttribute('aria-hidden', 'true');

        const chevron = document.createElement('span');
        chevron.className = 'lectio-subject-colours-legend__chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = '▴';

        toggle.append(swatches, label, chevron);
        toggle.addEventListener('click', () => {
            legendExpanded = !legendExpanded;
            setLegendExpanded(container, legendExpanded);
        }, { signal: lifecycle.signal });

        const panel = document.createElement('div');
        panel.id = LEGEND_PANEL_ID;
        panel.hidden = true;

        const header = document.createElement('div');
        header.className = 'lectio-subject-colours-legend__header';

        const heading = document.createElement('span');
        heading.textContent = strings.heading;

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'lectio-subject-colours-legend__close';
        close.setAttribute('aria-label', strings.hide);
        close.textContent = '×';
        close.addEventListener('click', () => {
            legendExpanded = false;
            setLegendExpanded(container, false);
        }, { signal: lifecycle.signal });

        header.append(heading, close);

        const list = document.createElement('ul');
        list.className = 'lectio-subject-colours-legend__list';

        panel.append(header, list);
        container.append(toggle, panel);
        (document.body || document.documentElement).appendChild(container);
        setLegendExpanded(container, legendExpanded);

        return container;
    }

    function removeLegend() {
        const container = document.getElementById(LEGEND_ID);
        if (container) container.remove();
        legendSignature = '';
    }

    function renderLegend() {
        if (!settings.showLegend) {
            removeLegend();
            return;
        }

        const keys = visibleClassKeys();
        if (!keys.length) {
            removeLegend();
            return;
        }

        const container = ensureLegendContainer();
        const signature = keys.map(key => `${key}:${paletteFor(key, 'class').fill}`).join('|');

        if (signature !== legendSignature) {
            legendSignature = signature;

            const swatches = container.querySelector('.lectio-subject-colours-legend__swatches');
            swatches.textContent = '';
            for (const key of keys.slice(0, 4)) {
                const dot = document.createElement('span');
                dot.className = 'lectio-subject-colours-legend__dot';
                dot.style.background = paletteFor(key, 'class').fill;
                swatches.appendChild(dot);
            }

            const list = container.querySelector('.lectio-subject-colours-legend__list');
            list.textContent = '';
            for (const key of keys) list.appendChild(buildLegendRow(key));
        }

        updateLegendToggleLabel(container, keys.length);
    }

    // Delegated once for the whole page rather than per block, so blocks
    // that come and go with a week change never need their own listeners
    // attached or torn down.
    function watchLegendHover() {
        let hoveredBlock = null;

        document.addEventListener('mouseover', (event) => {
            const block = event.target.closest?.(`.s2skemabrik[${KIND_ATTRIBUTE}="class"]`);
            if (!block || block === hoveredBlock) return;
            hoveredBlock = block;
            setEntryHighlighted(block.getAttribute(KEY_ATTRIBUTE), true);
        }, { signal: lifecycle.signal });

        document.addEventListener('mouseout', (event) => {
            const block = event.target.closest?.(`.s2skemabrik[${KIND_ATTRIBUTE}="class"]`);
            if (!block || block.contains(event.relatedTarget)) return;
            if (block === hoveredBlock) hoveredBlock = null;
            setEntryHighlighted(block.getAttribute(KEY_ATTRIBUTE), false);
        }, { signal: lifecycle.signal });
    }

    // ============================================================
    // SCANNING
    // ============================================================

    function acquireScanLock() {
        const held = Number(readJson(SCAN_LOCK_KEY, 0)) || 0;
        if (Date.now() - held < SCAN_LOCK_MS) return false;
        writeJson(SCAN_LOCK_KEY, Date.now());
        return true;
    }

    function releaseScanLock() {
        writeJson(SCAN_LOCK_KEY, 0);
    }

    function delay(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    async function fetchWeek(week) {
        const response = await fetch(
            `/lectio/${SCHOOL}/SkemaNy.aspx?week=${week}`,
            {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                signal: lifecycle.signal,
                headers: { Accept: 'text/html,application/xhtml+xml' }
            }
        );

        if (!response.ok) throw new Error(`HTTP ${response.status} loading week ${week}`);

        const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');

        // Lectio answers a request it does not like with its own error page and
        // a perfectly ordinary 200, so the status line says nothing about
        // whether a timetable actually came back. Without this the scan read
        // eight error pages, learned nothing from any of them, recorded all
        // eight as freshly scanned and reported none of it -- leaving every
        // class permanently one week short of being recognised.
        if (!isTimetable(parsed)) throw new Error(`week ${week} did not return a timetable`);

        return parsed;
    }

    function weeksToScan(force) {
        const candidates = weekWindow(settings.scanWeeks);
        const stale = force || Date.now() - store.scannedAt > STORE_FRESHNESS_MS;

        return candidates.filter(week => stale || Date.now() - (Number(store.weeks[week]) || 0) > WEEK_FRESHNESS_MS);
    }

    async function runScan({ force = false } = {}) {
        if (scanning || !SCHOOL || settings.scanWeeks <= 0) return;

        const pending = weeksToScan(force);
        if (!pending.length) return;
        if (!acquireScanLock()) return;

        scanning = true;
        let failures = 0;

        try {
            for (const week of pending) {
                if (lifecycle.signal.aborted) return;

                try {
                    const weekDocument = await fetchWeek(week);
                    harvestDocument(weekDocument, { counting: true });
                    store.weeks[week] = Date.now();
                    failures = 0;
                } catch (error) {
                    if (lifecycle.signal.aborted) return;
                    failures += 1;
                    console.warn(`${LOG} Could not read week ${week}:`, error);
                    // Two failures in a row means signed out, offline, or a
                    // changed page — none of which the next eleven requests
                    // would fix.
                    if (failures >= 2) break;
                }

                await delay(SCAN_GAP_MS);
            }

            store.scannedAt = Date.now();
            saveStore();
            invalidate();
            applyAll();
            announce();
        } finally {
            scanning = false;
            releaseScanLock();
        }
    }

    // ============================================================
    // MANAGER REGISTRATION
    // ============================================================

    function classControls() {
        return classKeys().map(key => {
            const entry = store.entries[key];
            const weeks = weeksSeenOf(entry);

            return {
                key: `class:${key}`,
                type: 'color',
                label: entry.label,
                section: 'Your classes',
                description: `Seen ${occurrencesOf(entry)} time${occurrencesOf(entry) === 1 ? '' : 's'} `
                    + `across ${weeks} week${weeks === 1 ? '' : 's'}.`
            };
        });
    }

    function settingsSchema() {
        const classes = classControls();

        return [
            {
                key: 'enabled',
                type: 'toggle',
                label: 'Colour the schedule',
                section: 'Colours',
                description: 'Give each of your regular classes its own colour.'
            },
            {
                key: 'style',
                type: 'select',
                label: 'Colour style',
                section: 'Colours',
                description: 'Fill the whole lesson block, mark only its edge, or both.',
                options: STYLE_OPTIONS,
                previewOnHover: true
            },
            {
                key: 'intensity',
                type: 'range',
                label: 'Colour strength',
                section: 'Colours',
                description: 'How saturated the colours are against the current theme.',
                min: 60,
                max: 140,
                step: 5,
                suffix: '%'
            },
            {
                key: 'colourOther',
                type: 'toggle',
                label: 'Mark one-off activities',
                section: 'Colours',
                description: 'Give assemblies, meetings and trips a muted grey-toned colour of their own.'
            },
            {
                key: 'showLegend',
                type: 'toggle',
                label: 'Show colour key on the schedule',
                section: 'Colours',
                description: 'Off by default. A small, collapsed key on the page listing the classes currently on screen. '
                    + 'Hover an entry to highlight its blocks, or click its swatch to recolour it there and then.'
            },
            {
                key: 'regularity',
                type: 'select',
                label: 'What counts as a class',
                section: 'Detection',
                description: 'How often a hold must appear in your timetable before it earns its own colour.',
                options: REGULARITY_OPTIONS
            },
            {
                key: 'scanWeeks',
                type: 'range',
                label: 'Weeks to learn from',
                section: 'Detection',
                description: 'How much of your own timetable is read in the background. Set to 0 to learn only from pages you open yourself.',
                min: 0,
                max: 16,
                step: 1
            },
            {
                key: 'rescan',
                type: 'button',
                label: 'Read my timetable again',
                buttonLabel: 'Rescan',
                section: 'Detection',
                description: classes.length
                    ? `${classes.length} class${classes.length === 1 ? '' : 'es'} found so far. Reopen Settings after a rescan to see changes.`
                    : 'No classes found yet. Open your schedule and rescan.'
            },
            ...classes,
            ...(classes.length
                ? [{
                    key: 'lockColours',
                    type: 'toggle',
                    label: 'Keep my colours exactly',
                    section: 'Your classes',
                    description: 'Freeze every class colour, picked or not, so switching Lectio Theming\'s colour scheme '
                        + 'never reshuffles them. You can still change a class\'s colour by hand at any time.'
                }, {
                    key: 'resetColours',
                    type: 'button',
                    label: 'Reset chosen colours',
                    buttonLabel: 'Reset',
                    section: 'Your classes',
                    description: 'Hand every class back the colour worked out from your theme.'
                }]
                : []),
            {
                key: 'forget',
                type: 'button',
                label: 'Forget what was learned',
                buttonLabel: 'Forget',
                section: 'Detection',
                description: 'Clear the learned timetable and every colour assignment for this school.'
            }
        ];
    }

    function currentValues() {
        const values = {
            enabled: settings.enabled,
            style: settings.style,
            intensity: settings.intensity,
            colourOther: settings.colourOther,
            showLegend: settings.showLegend,
            lockColours: settings.lockColours,
            regularity: settings.regularity,
            scanWeeks: settings.scanWeeks
        };

        for (const key of classKeys()) {
            values[`class:${key}`] = settings.overrides[key] || paletteFor(key, 'class').fill;
        }

        return values;
    }

    function announce() {
        window.dispatchEvent(new CustomEvent('lectio-module:register', {
            detail: {
                id: MODULE_ID,
                name: MODULE_NAME,
                version: MODULE_VERSION,
                settingsSchema: settingsSchema(),
                currentValues: currentValues()
            }
        }));
    }

    function handleSetting(event) {
        const detail = event.detail;
        if (!detail || detail.id !== MODULE_ID) return;

        const { key, value } = detail;

        if (key.startsWith('class:')) {
            const target = key.slice('class:'.length);
            if (!isHexColour(value)) return;
            settings.overrides[target] = String(value).toLowerCase();
        } else if (key === 'enabled' && typeof value === 'boolean') {
            settings.enabled = value;
        } else if (key === 'style' && hasOption(STYLE_OPTIONS, value)) {
            previewStyle = null;
            settings.style = value;
        } else if (key === 'intensity') {
            settings.intensity = clamp(Math.round(Number(value) || DEFAULT_SETTINGS.intensity), 60, 140);
        } else if (key === 'colourOther' && typeof value === 'boolean') {
            settings.colourOther = value;
        } else if (key === 'showLegend' && typeof value === 'boolean') {
            settings.showLegend = value;
        } else if (key === 'lockColours' && typeof value === 'boolean') {
            settings.lockColours = value;
            // Turning the lock off drops the freeze, so a later lock starts
            // from whatever the theme looks like then rather than a stale
            // reading from last time; turning it on captures a fresh one.
            settings.lockedTheme = null;
            ensureLockedTheme();
        } else if (key === 'regularity' && hasOption(REGULARITY_OPTIONS, value)) {
            settings.regularity = value;
        } else if (key === 'scanWeeks') {
            settings.scanWeeks = clamp(Math.round(Number(value) || 0), 0, 16);
        } else if (key === 'rescan') {
            runScan({ force: true });
            return;
        } else if (key === 'resetColours') {
            settings.overrides = {};
        } else if (key === 'forget') {
            store = emptyStore();
            settings.overrides = {};
            saveStore();
            saveSettings();
            invalidate();
            blockElements(document).forEach(clearBlock);
            applyAll();
            announce();
            runScan({ force: true });
            return;
        } else {
            return;
        }

        saveSettings();
        saveStore();
        invalidate();
        applyAll();
        announce();
    }

    function handlePreview(event) {
        const detail = event.detail;
        if (!detail || detail.id !== MODULE_ID || detail.key !== 'style') return;
        if (!hasOption(STYLE_OPTIONS, detail.value)) return;

        previewStyle = detail.value;
        invalidate();
        applyAll();
    }

    function handleClearPreview(event) {
        const detail = event.detail;
        if (!detail || detail.id !== MODULE_ID || detail.key !== 'style') return;

        previewStyle = null;
        invalidate();
        applyAll();
    }

    // ============================================================
    // LIFECYCLE
    // ============================================================

    function watchPage() {
        watchLegendHover();

        // Lectio re-renders the schedule table in place when a week is changed,
        // so new blocks arrive without a page load. Both observers are torn down
        // with the page rather than left to accumulate across navigations.
        const pageObserver = new MutationObserver(queueApply);
        pageObserver.observe(document.body, { childList: true, subtree: true });

        const themeObserver = new MutationObserver(() => {
            window.clearTimeout(themeHandle);
            themeHandle = window.setTimeout(() => {
                if (lifecycle.signal.aborted) return;
                theme = readTheme();
                invalidate();
                applyAll();
                announce();
            }, 150);
        });
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });

        lifecycle.signal.addEventListener('abort', () => {
            pageObserver.disconnect();
            themeObserver.disconnect();
            window.clearTimeout(applyHandle);
            window.clearTimeout(themeHandle);
        }, { once: true });
    }

    function start() {
        addStyles();

        const hasBlocks = blockElements(document).length > 0;
        harvestDocument(document, { counting: isOwnTimetable() });
        flushStore();

        applyAll();
        watchPage();
        announce();

        // Only pages that actually show a timetable are worth learning from, so
        // an ordinary Lectio page never triggers background requests.
        if (hasBlocks && settings.scanWeeks > 0) {
            window.setTimeout(() => {
                if (!lifecycle.signal.aborted) runScan();
            }, SCAN_START_DELAY_MS);
        }
    }

    window.addEventListener('lectio-manager:discover', announce, { signal: lifecycle.signal });
    window.addEventListener('lectio-manager:set-setting', handleSetting, { signal: lifecycle.signal });
    window.addEventListener('lectio-manager:preview-setting', handlePreview, { signal: lifecycle.signal });
    window.addEventListener('lectio-manager:clear-setting-preview', handleClearPreview, { signal: lifecycle.signal });
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true, signal: lifecycle.signal });
    } else {
        start();
    }
})();
