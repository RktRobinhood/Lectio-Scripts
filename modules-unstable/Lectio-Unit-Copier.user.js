// ==UserScript==
// @name         Lectio - Unit Copier
// @namespace    https://github.com/RktRobinhood/Lectio-Scripts
// @version      0.1.0
// @description  Plan copying last year's unit into one of your classes: the old lessons side by side with your class's lessons, paired in order, ready to adjust. Plan only - nothing is copied into Lectio yet.
// @author       RktRobinhood
// @match        https://www.lectio.dk/lectio/*/studieplan/forloeb_vis.aspx*
// @noframes
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/RktRobinhood/Lectio-Scripts
// @supportURL   https://github.com/RktRobinhood/Lectio-Scripts/issues
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Unit-Copier.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Unit-Copier.user.js
// ==/UserScript==

/*
 * UNIT COPIER - THE PLANNER (issue #74)
 *
 * The teacher's job: "put last year's unit into this year's class". Lectio's
 * own flow is Kopier forløb (an empty shell) and then, lesson by lesson, the
 * Vælg materiale picker. This module turns the matching half of that into one
 * screen: last year's lessons on the left, this class's lessons on the right,
 * paired in order by default, and adjusted by dragging, leaving a lesson empty
 * or leaving an old lesson out.
 *
 * THIS VERSION ONLY READS. It reads the unit page it runs on, and the
 * teacher's own timetable (SkemaNy.aspx, one GET per week) to find the class's
 * lessons. It never posts anything to Lectio. Copying the plan into Lectio is
 * a later version, under the ADR-0009 amendment of 2026-10-07 and the safety
 * bar written there.
 *
 * What it relies on, all read off real pages (see issue #74):
 *   - a lesson on the unit page is div.ls-phase-activity#ACC<activity id>,
 *     with its timetable block (a.s2skemabrik[data-tooltip]) in its heading;
 *   - its items are article[data-to-toc-id^="ACH"], under *_InlineHomework
 *     (Lektier) or *_InlineOther (Øvrigt indhold); the presentation is
 *     [data-to-toc-id^="ACP"] under *_InlinePresentation;
 *   - a class is the HE<digits> context card on a lesson block, and a lesson
 *     that already has material carries a "Lektier:" or "Øvrigt indhold:"
 *     line in its tooltip.
 * Everything is matched on ids and attributes, never on Danish text, because
 * English Mode may have translated the text by the time this reads it.
 */

(() => {
    'use strict';

    /*
     * Top page only. @noframes says so to Tampermonkey; this says it again for
     * a manager that ignores the header. Anything unexpected reads as "top
     * page", so the worst this can do is leave the module running.
     */
    let hostFrame = null;

    try {
        hostFrame = window.frameElement;
    } catch (_) {
        hostFrame = null;
    }

    if (hostFrame) return;

    // All three of these move together with modules-unstable/modules.json;
    // `node scripts/check-versions.mjs` enforces it.
    const MODULE_ID = 'unit-copier';
    const MODULE_NAME = 'Lectio - Unit Copier';
    const MODULE_VERSION = '0.1.0';

    const STYLE_ID = 'lectio-unit-copier-styles';
    const BUTTON_ID = 'lectio-unit-copier-open';
    const OVERLAY_ID = 'lectio-unit-copier';
    const DRAG_PREFIX = 'lectio-unit-copier:';

    // The plan is a draft for this tab only: kept across a reload, gone when
    // the tab closes. Nothing goes into localStorage.
    const DRAFT_PREFIX = 'lectioUnitCopier.draft.';

    // How far ahead to look for the class's lessons, and when to stop early.
    const MAX_WEEKS = 30;
    const SPARE_SLOTS = 4;
    const WEEK_FETCH_TIMEOUT_MS = 10000;
    const WEEK_FETCH_GAP_MS = 250;

    const TIME_PATTERN = /(\d{1,2})\/(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s+til\s+(\d{1,2}):(\d{2})/;
    const CONTENT_LINE_PATTERN = /^\s*(Lektier|Øvrigt indhold)\s*:\s*$/m;

    // One controller for every listener the module adds, so teardown is one
    // abort() rather than a list that drifts out of step.
    const lifecycle = new AbortController();

    // Page-view state. Declared here, above the boot call at the bottom, so
    // nothing start() reaches is still in its temporal dead zone
    // (scripts/check-boot-order.mjs).
    let source = null;          // { phaseId, title, holdNames, lessons }
    let plan = null;            // see newPlan()
    let scanController = null;  // the week scan in flight, if any
    let lastFocus = null;

    /* ---------------------------------------------------------------- *
     * Language (ADR-0013)
     * ---------------------------------------------------------------- */

    function language() {
        const preferred = document.documentElement?.dataset?.lectioLanguage;

        return (preferred || document.documentElement.lang || 'da').toLowerCase().startsWith('en') ? 'en' : 'da';
    }

    function labels() {
        return language() === 'en'
            // i18n:en
            ? {
                openButton: 'Copy into a class',
                openButtonTitle: 'Plan putting this unit into one of your classes',
                title: 'Copy this unit into a class',
                planOnly: 'Plan only: nothing is copied into Lectio yet. Copying comes in a later version.',
                classLabel: 'Class',
                classLoading: 'Reading your timetable...',
                classNone: 'No classes found in your timetable for the next two weeks.',
                startLabel: 'From',
                findButton: 'Find lessons',
                scanning: 'Reading week {week}...',
                scanStopped: 'Stopped after week {week}.',
                sessionLost: 'Lectio did not return your timetable. Are you still logged in? Reload the page and try again.',
                fetchFailed: 'Could not read week {week}. The lessons found so far are shown; try again to read the rest.',
                sourceHeading: 'Last year',
                targetHeading: 'Your class',
                targetEmpty: 'Choose a class and press Find lessons.',
                noLessonsFound: 'No lessons found for this class from that date.',
                summary: '{source} lessons from last year onto {filled} of your lessons.',
                summaryNotPlaced: '{n} not placed.',
                summaryHasContent: '{n} of your lessons already have material and are left alone.',
                summaryCancelled: '{n} cancelled lessons ignored.',
                notPlacedHeading: 'Not placed',
                leaveEmpty: 'Leave empty',
                useLesson: 'Use this lesson',
                leaveOut: 'Leave out',
                putBack: 'Put back',
                moveUp: 'Move up',
                moveDown: 'Move down',
                emptySlot: 'Nothing goes here',
                leftEmpty: 'Left empty',
                hasContent: 'Already has material - left alone',
                leftOutNote: 'Left out',
                noItems: 'No material',
                dragHint: 'Drag a lesson from the left onto one of your lessons to put it there.',
                kindHomework: 'Homework',
                kindOther: 'Other content',
                kindPresentation: 'Presentation',
                kindFile: 'file',
                kindLink: 'link',
                cancelledLastYear: 'cancelled last year',
                copyPlan: 'Copy plan as text',
                copied: 'Plan copied.',
                close: 'Close',
                resetPlan: 'Start over',
                weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            }
            // i18n:da
            : {
                openButton: 'Kopiér ind i et hold',
                openButtonTitle: 'Planlæg at lægge dette forløb ind på et af dine hold',
                title: 'Kopiér forløbet ind i et hold',
                planOnly: 'Kun en plan: intet bliver kopieret ind i Lectio endnu. Kopieringen kommer i en senere version.',
                classLabel: 'Hold',
                classLoading: 'Læser dit skema...',
                classNone: 'Ingen hold fundet i dit skema de næste to uger.',
                startLabel: 'Fra',
                findButton: 'Find lektioner',
                scanning: 'Læser uge {week}...',
                scanStopped: 'Stoppede efter uge {week}.',
                sessionLost: 'Lectio sendte ikke dit skema. Er du stadig logget ind? Genindlæs siden, og prøv igen.',
                fetchFailed: 'Kunne ikke læse uge {week}. Lektionerne, der er fundet indtil nu, vises; prøv igen for at læse resten.',
                sourceHeading: 'Sidste år',
                targetHeading: 'Dit hold',
                targetEmpty: 'Vælg et hold, og tryk Find lektioner.',
                noLessonsFound: 'Ingen lektioner fundet for holdet fra den dato.',
                summary: '{source} lektioner fra sidste år på {filled} af dine lektioner.',
                summaryNotPlaced: '{n} ikke placeret.',
                summaryHasContent: '{n} af dine lektioner har allerede materiale og bliver ikke rørt.',
                summaryCancelled: '{n} aflyste lektioner springes over.',
                notPlacedHeading: 'Ikke placeret',
                leaveEmpty: 'Lad stå tom',
                useLesson: 'Brug lektionen',
                leaveOut: 'Udelad',
                putBack: 'Tag med igen',
                moveUp: 'Flyt op',
                moveDown: 'Flyt ned',
                emptySlot: 'Intet her',
                leftEmpty: 'Står tom',
                hasContent: 'Har allerede materiale - bliver ikke rørt',
                leftOutNote: 'Udeladt',
                noItems: 'Intet materiale',
                dragHint: 'Træk en lektion fra venstre over på en af dine lektioner for at lægge den dér.',
                kindHomework: 'Lektie',
                kindOther: 'Øvrigt indhold',
                kindPresentation: 'Præsentation',
                kindFile: 'fil',
                kindLink: 'link',
                cancelledLastYear: 'aflyst sidste år',
                copyPlan: 'Kopiér planen som tekst',
                copied: 'Planen er kopieret.',
                close: 'Luk',
                resetPlan: 'Start forfra',
                weekdays: ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør']
            };
            // i18n:end
    }

    function fill(template, values) {
        return String(template).replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
    }

    /* ---------------------------------------------------------------- *
     * Discovery (ADR-0002). No settings and nothing in localStorage yet.
     * ---------------------------------------------------------------- */

    function announce() {
        window.dispatchEvent(new CustomEvent('lectio-module:register', {
            detail: {
                id: MODULE_ID,
                name: MODULE_NAME,
                version: MODULE_VERSION,
                settingsSchema: [],
                currentValues: {},
                storage: []
            }
        }));
    }

    // A token written here, never text read off the page
    // (docs/manager-problem-log.md).
    function reportToManager(kind, code, found) {
        window.dispatchEvent(new CustomEvent('lectio-module:report', {
            detail: { moduleId: MODULE_ID, kind, code, found }
        }));
    }

    /* ---------------------------------------------------------------- *
     * Reading Lectio
     * ---------------------------------------------------------------- */

    function parseTime(tooltip) {
        const match = String(tooltip || '').match(TIME_PATTERN);

        if (!match) return null;

        const [, day, month, year, startHour, startMinute, endHour, endMinute] = match.map(Number);

        return {
            date: new Date(year, month - 1, day, startHour, startMinute),
            iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            start: `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`,
            end: `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`
        };
    }

    function isCancelled(block) {
        if (!block) return false;
        if (block.classList.contains('s2cancelled') || block.querySelector('.s2cancelled')) return true;

        return /^\s*(Aflyst!|Cancelled|Canceled)/i.test(block.getAttribute('data-tooltip') || '');
    }

    // Distinct HE<digits> cards, with the name Lectio shows for each. The
    // block's content is rendered twice (desktop and mobile), so each card
    // appears twice and is counted once.
    function holdsOf(element) {
        const holds = new Map();

        element.querySelectorAll('[data-lectiocontextcard^="HE"]').forEach((card) => {
            const id = card.getAttribute('data-lectiocontextcard');

            if (/^HE\d+$/.test(id) && !holds.has(id)) holds.set(id, card.textContent.trim());
        });

        return holds;
    }

    function absIdOf(block) {
        const href = block.getAttribute('href') || '';
        const fromHref = href.match(/[?&]absid=(\d+)/i);

        if (fromHref) return fromHref[1];

        const fromBrik = (block.getAttribute('data-brikid') || '').match(/ABS(\d+)/i);

        return fromBrik ? fromBrik[1] : null;
    }

    /*
     * The unit this page shows. Read once, from the DOM Lectio rendered:
     * nothing is fetched for the source side.
     */
    function readSourceUnit() {
        const container = document.querySelector('[id$="_actContainer"]');

        if (!container) return null;

        const lessons = [];

        container.querySelectorAll('.ls-phase-activity[id^="ACC"]').forEach((lesson) => {
            const block = lesson.querySelector('a.s2skemabrik[data-tooltip]');
            const time = block ? parseTime(block.getAttribute('data-tooltip')) : null;
            const items = [];

            lesson.querySelectorAll('[data-to-toc-id^="ACH"], [data-to-toc-id^="ACP"]').forEach((item) => {
                const id = item.getAttribute('data-to-toc-id');

                // The table of contents repeats each id on an anchor; only the
                // rendered item itself counts.
                if (item.tagName === 'A' || items.some((known) => known.id === id)) return;

                const kind = id.startsWith('ACP')
                    ? 'presentation'
                    : item.closest('[id$="_InlineOther"]')
                        ? 'other'
                        : 'homework';
                const heading = item.querySelector('h1, h2, h3');
                const linkType = item.querySelector('[data-lc-display-linktype]')?.getAttribute('data-lc-display-linktype') || '';
                const title = (heading?.textContent || item.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);

                items.push({ id, kind, linkType, title });
            });

            lessons.push({
                id: lesson.id,
                time,
                cancelled: isCancelled(block),
                items
            });
        });

        // A lesson cancelled last year with nothing on it never happened, so
        // it takes no place in the sequence. One with material keeps its place:
        // the material was planned, even if the lesson fell through.
        const sequence = lessons.filter((lesson) => !lesson.cancelled || lesson.items.length);

        // The classes the unit already belongs to, oldest first:
        // "2025/26: 1i MathAnSL/2", then the same class a year on.
        const holdRow = document.querySelector('[id$="_HoldRow"]');
        const holdCards = holdRow ? [...holdRow.querySelectorAll('[data-lectiocontextcard^="HE"]')] : [];
        const holdNames = holdCards.map((card) => card.textContent.replace(/^\s*\d{4}\/\d{2}\s*:\s*/, '').trim());
        const holdIds = new Set(holdCards.map((card) => card.getAttribute('data-lectiocontextcard')));

        const phaseId = new URL(location.href).searchParams.get('phaseid') || '';
        const heading = document.querySelector('[data-to-toc-id="overview"]');

        return {
            phaseId,
            title: (heading?.textContent || document.title).replace(/\s+/g, ' ').trim(),
            holdNames,
            holdIds,
            lessons: sequence
        };
    }

    function schoolId() {
        return (location.pathname.match(/^\/lectio\/(\d+)\//) || [])[1] || null;
    }

    function isoWeek(date) {
        const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const weekday = day.getUTCDay() || 7;

        day.setUTCDate(day.getUTCDate() + 4 - weekday);

        const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));

        return { week: Math.ceil(((day - yearStart) / 86400000 + 1) / 7), year: day.getUTCFullYear() };
    }

    function addDays(date, days) {
        const next = new Date(date);

        next.setDate(next.getDate() + days);

        return next;
    }

    /*
     * One week of the teacher's own timetable. Own lessons only, by
     * construction: SkemaNy.aspx without a type is the signed-in person's
     * schedule. A page that is not a timetable at all (a login page after the
     * session ran out) is an error, not an empty week.
     */
    async function fetchWeek(date, signal) {
        const { week, year } = isoWeek(date);
        const url = `/lectio/${schoolId()}/SkemaNy.aspx?week=${String(week).padStart(2, '0')}${year}&showtype=0`;
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), WEEK_FETCH_TIMEOUT_MS);
        const relay = () => timeout.abort();

        signal.addEventListener('abort', relay, { once: true });

        try {
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: { Accept: 'text/html,application/xhtml+xml' },
                signal: timeout.signal
            });

            if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: 'fetch' });

            const doc = new DOMParser().parseFromString(await response.text(), 'text/html');

            if (/login/i.test(response.url || '') || !doc.querySelector('[data-date], tr.s2dayHeader')) {
                throw Object.assign(new Error('not a timetable'), { code: 'session' });
            }

            return { week, doc };
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', relay);
        }
    }

    function lessonsInWeek(doc) {
        return [...doc.querySelectorAll('a.s2skemabrik[data-tooltip]')]
            .map((block) => {
                const tooltip = block.getAttribute('data-tooltip') || '';
                const time = parseTime(tooltip);

                if (!time) return null;

                return {
                    absId: absIdOf(block),
                    time,
                    holds: holdsOf(block),
                    cancelled: isCancelled(block),
                    hasContent: CONTENT_LINE_PATTERN.test(tooltip),
                    href: block.getAttribute('href') || ''
                };
            })
            .filter(Boolean);
    }

    /* ---------------------------------------------------------------- *
     * Which class: the teacher's classes, best guess first
     * ---------------------------------------------------------------- */

    // "1i Math AA SL/2" and "2i MathAnSL/2" are the same course in different
    // years. Drop the leading class code, then compare letter pairs.
    function courseKey(name) {
        return String(name).toLowerCase().replace(/^\s*\d+\s*[a-zæøå]+\s+/, '').replace(/[^a-z0-9æøå]/g, '');
    }

    function similarity(a, b) {
        const pairs = (text) => {
            const out = [];

            for (let index = 0; index < text.length - 1; index += 1) out.push(text.slice(index, index + 2));

            return out;
        };
        const left = pairs(courseKey(a));
        const right = pairs(courseKey(b));

        if (!left.length || !right.length) return 0;

        const pool = [...right];
        let shared = 0;

        left.forEach((pair) => {
            const at = pool.indexOf(pair);

            if (at >= 0) {
                shared += 1;
                pool.splice(at, 1);
            }
        });

        return (2 * shared) / (left.length + right.length);
    }

    /*
     * Best guess first, never chosen silently: the teacher sees the guess in
     * the class menu and can change it.
     *
     * The unit is usually still attached to last year's class, which has
     * moved up a year ("1i" is now "2i") and is the wrong target, so the
     * classes the unit already belongs to go last. Among the rest, the same
     * course in the same year-group as last year's class wins: last year's
     * "1i MathAnSL/2" points at this year's "1i Math AA SL/2".
     */
    function rankClasses(holds, unit) {
        const firstYear = (String(unit.holdNames[0] || '').match(/^\s*(\d+)/) || [])[1];

        return [...holds.values()]
            .map((hold) => {
                const course = Math.max(0, ...unit.holdNames.map((name) => similarity(name, hold.name)));
                const sameYear = firstYear && (String(hold.name).match(/^\s*(\d+)/) || [])[1] === firstYear ? 0.15 : 0;
                const ownClass = unit.holdIds.has(hold.id) ? -1 : 0;

                return { ...hold, score: course + sameYear + ownClass };
            })
            .sort((a, b) => b.score - a.score || b.count - a.count || a.name.localeCompare(b.name));
    }

    async function discoverClasses(signal) {
        const today = new Date();
        const holds = new Map();

        for (const date of [today, addDays(today, 7)]) {
            const { doc } = await fetchWeek(date, signal);

            lessonsInWeek(doc).forEach((lesson) => {
                if (lesson.cancelled) return;

                lesson.holds.forEach((name, id) => {
                    const known = holds.get(id) || { id, name, count: 0 };

                    known.count += 1;
                    holds.set(id, known);
                });
            });
        }

        return holds;
    }

    /* ---------------------------------------------------------------- *
     * The plan
     *
     * order:   the source lessons, by index, in the order they are placed.
     * leftOut: source indices the teacher left out.
     * skip:    per target lesson (by absId), an override of "leave empty".
     *          Without one, a lesson that already has material is left
     *          empty and every other lesson is used.
     * ---------------------------------------------------------------- */

    function newPlan() {
        return {
            holdId: '',
            start: todayIso(),
            classes: [],
            targets: [],
            cancelledTargets: 0,
            order: source.lessons.map((_, index) => index),
            leftOut: new Set(),
            skip: new Map(),
            status: '',
            statusKind: ''
        };
    }

    function todayIso() {
        const now = new Date();

        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    function isSkipped(target) {
        return plan.skip.has(target.absId) ? plan.skip.get(target.absId) : target.hasContent;
    }

    function assign() {
        const queue = plan.order.filter((index) => !plan.leftOut.has(index));
        let next = 0;

        const rows = plan.targets.map((target) => {
            if (isSkipped(target)) {
                return { target, lesson: null, reason: target.hasContent && !plan.skip.has(target.absId) ? 'has-content' : 'left-empty' };
            }

            const index = queue[next];

            next += 1;

            return { target, lesson: index === undefined ? null : index, reason: index === undefined ? 'nothing' : '' };
        });

        return { rows, notPlaced: queue.slice(next) };
    }

    // Put a source lesson on a target lesson: everything placed after it moves
    // along with it, which is what "start from here" means to a teacher.
    function placeAt(lessonIndex, targetIndex) {
        const target = plan.targets[targetIndex];

        if (!target) return;
        if (isSkipped(target)) plan.skip.set(target.absId, false);

        plan.leftOut.delete(lessonIndex);

        const before = plan.targets.slice(0, targetIndex).filter((slot) => !isSkipped(slot)).length;
        const placed = plan.order.filter((index) => index !== lessonIndex && !plan.leftOut.has(index));
        const outside = plan.order.filter((index) => index !== lessonIndex && plan.leftOut.has(index));

        placed.splice(Math.min(before, placed.length), 0, lessonIndex);
        plan.order = [...placed, ...outside];
    }

    function moveLesson(lessonIndex, step) {
        const at = plan.order.indexOf(lessonIndex);
        const to = at + step;

        if (at < 0 || to < 0 || to >= plan.order.length) return;

        [plan.order[at], plan.order[to]] = [plan.order[to], plan.order[at]];
    }

    function saveDraft() {
        try {
            sessionStorage.setItem(DRAFT_PREFIX + source.phaseId, JSON.stringify({
                lessons: source.lessons.length,
                holdId: plan.holdId,
                start: plan.start,
                order: plan.order,
                leftOut: [...plan.leftOut],
                skip: [...plan.skip]
            }));
        } catch (_) {
            // A draft that cannot be kept is only a convenience lost.
        }
    }

    function loadDraft() {
        try {
            const draft = JSON.parse(sessionStorage.getItem(DRAFT_PREFIX + source.phaseId) || 'null');
            const count = source.lessons.length;

            if (!draft || draft.lessons !== count) return;
            if (!Array.isArray(draft.order) || draft.order.length !== count) return;
            if ([...draft.order].sort((a, b) => a - b).some((value, index) => value !== index)) return;

            plan.holdId = typeof draft.holdId === 'string' ? draft.holdId : '';
            plan.start = /^\d{4}-\d{2}-\d{2}$/.test(draft.start) ? draft.start : plan.start;
            plan.order = draft.order;
            plan.leftOut = new Set((draft.leftOut || []).filter((index) => Number.isInteger(index) && index < count));
            plan.skip = new Map((draft.skip || []).filter((entry) => Array.isArray(entry) && typeof entry[1] === 'boolean'));
        } catch (_) {
            // A draft that cannot be read is simply not restored.
        }
    }

    /* ---------------------------------------------------------------- *
     * Finding the class's lessons
     * ---------------------------------------------------------------- */

    async function findLessons() {
        if (!plan.holdId) return;

        cancelScan();
        scanController = new AbortController();

        const signal = scanController.signal;
        const text = labels();
        const [year, month, day] = plan.start.split('-').map(Number);
        const from = new Date(year, month - 1, day);
        const needed = plan.order.filter((index) => !plan.leftOut.has(index)).length + SPARE_SLOTS;
        const found = new Map();
        let cancelled = 0;
        let lastWeek = isoWeek(from).week;

        plan.targets = [];
        plan.cancelledTargets = 0;

        try {
            for (let offset = 0; offset < MAX_WEEKS; offset += 1) {
                const date = addDays(from, offset * 7);

                lastWeek = isoWeek(date).week;
                setStatus(fill(text.scanning, { week: lastWeek }), 'busy');

                const { doc } = await fetchWeek(date, signal);

                lessonsInWeek(doc).forEach((lesson) => {
                    if (!lesson.holds.has(plan.holdId) || !lesson.absId || found.has(lesson.absId)) return;

                    const lessonDay = new Date(lesson.time.date);

                    lessonDay.setHours(0, 0, 0, 0);

                    if (lessonDay < from) return;

                    if (lesson.cancelled) {
                        cancelled += 1;

                        return;
                    }

                    found.set(lesson.absId, lesson);
                });

                plan.targets = [...found.values()].sort((a, b) => a.time.date - b.time.date);
                plan.cancelledTargets = cancelled;
                render();

                const usable = plan.targets.filter((target) => !isSkipped(target)).length;

                if (usable >= needed) break;

                await new Promise((resolve) => setTimeout(resolve, WEEK_FETCH_GAP_MS));

                if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' });
            }

            setStatus(plan.targets.length ? '' : text.noLessonsFound, plan.targets.length ? '' : 'warn');
        } catch (error) {
            if (signal.aborted && error.code !== 'session') {
                setStatus(fill(text.scanStopped, { week: lastWeek }), 'warn');
            } else if (error.code === 'session') {
                setStatus(text.sessionLost, 'error');
            } else {
                setStatus(fill(text.fetchFailed, { week: lastWeek }), 'error');
            }
        } finally {
            if (scanController && scanController.signal === signal) scanController = null;

            saveDraft();
            render();
        }
    }

    function cancelScan() {
        if (scanController) {
            scanController.abort();
            scanController = null;
        }
    }

    function setStatus(message, kind) {
        plan.status = message;
        plan.statusKind = kind || '';

        const status = document.querySelector(`#${OVERLAY_ID} .luc-status`);

        if (status) {
            status.textContent = message;
            status.dataset.kind = plan.statusKind;
        }
    }

    /* ---------------------------------------------------------------- *
     * Presentation (ADR-0006: every colour through the theming seam)
     * ---------------------------------------------------------------- */

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');

        style.id = STYLE_ID;
        style.textContent = `
            #${OVERLAY_ID} {
                position: fixed;
                inset: 0;
                z-index: 100000;
                display: flex;
                align-items: stretch;
                justify-content: center;
                padding: 24px;
                box-sizing: border-box;
                background: rgba(16, 24, 28, 0.45);
                font: 400 13px/1.4 Roboto, Arial, sans-serif;
            }

            #${OVERLAY_ID} .luc-dialog {
                display: flex;
                flex-direction: column;
                width: min(1200px, 100%);
                background: var(--lectio-theme-surface, #ffffff);
                color: var(--lectio-theme-text, #17242a);
                border-radius: var(--lectio-theme-radius, 10px);
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
                overflow: hidden;
            }

            #${OVERLAY_ID} header,
            #${OVERLAY_ID} footer {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 10px 14px;
                padding: 12px 16px;
                background: var(--lectio-theme-surface-alt, #f1f4f5);
            }

            #${OVERLAY_ID} header h2 {
                margin: 0 auto 0 0;
                font-size: 17px;
            }

            #${OVERLAY_ID} .luc-plan-only {
                flex-basis: 100%;
                margin: 0;
                color: var(--lectio-theme-muted, #5b676d);
            }

            #${OVERLAY_ID} label {
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }

            #${OVERLAY_ID} select,
            #${OVERLAY_ID} input[type="date"] {
                font: inherit;
                padding: 3px 6px;
                max-width: 260px;
            }

            #${OVERLAY_ID} button {
                font: inherit;
                cursor: pointer;
                border: 1px solid var(--lectio-theme-muted, #9aa6ab);
                border-radius: 6px;
                padding: 4px 10px;
                background: var(--lectio-theme-surface, #ffffff);
                color: var(--lectio-theme-text, #17242a);
            }

            #${OVERLAY_ID} button.luc-primary {
                background: var(--lectio-theme-accent, #0f6f6f);
                border-color: var(--lectio-theme-accent, #0f6f6f);
                color: #ffffff;
            }

            #${OVERLAY_ID} button.luc-small {
                padding: 1px 7px;
                font-size: 12px;
            }

            #${OVERLAY_ID} button:disabled {
                opacity: 0.5;
                cursor: default;
            }

            #${OVERLAY_ID} .luc-summary,
            #${OVERLAY_ID} .luc-status {
                flex-basis: 100%;
                margin: 0;
            }

            #${OVERLAY_ID} .luc-summary {
                font-weight: 600;
            }

            #${OVERLAY_ID} .luc-status:empty {
                display: none;
            }

            #${OVERLAY_ID} .luc-status[data-kind="error"],
            #${OVERLAY_ID} .luc-status[data-kind="warn"] {
                color: var(--lectio-theme-accent-alt, #9a3b1f);
            }

            #${OVERLAY_ID} .luc-body {
                display: grid;
                grid-template-columns: minmax(260px, 2fr) minmax(320px, 3fr);
                gap: 16px;
                padding: 12px 16px;
                overflow: auto;
                flex: 1;
                min-height: 0;
            }

            #${OVERLAY_ID} .luc-column h3 {
                margin: 0 0 8px;
                font-size: 14px;
            }

            #${OVERLAY_ID} ol {
                list-style: none;
                margin: 0;
                padding: 0;
            }

            #${OVERLAY_ID} .luc-card,
            #${OVERLAY_ID} .luc-row {
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
                border-radius: 8px;
                padding: 6px 8px;
                margin-bottom: 6px;
                background: var(--lectio-theme-surface, #ffffff);
            }

            #${OVERLAY_ID} .luc-card[draggable="true"] {
                cursor: grab;
            }

            #${OVERLAY_ID} .luc-card[data-left-out="true"] {
                opacity: 0.55;
            }

            #${OVERLAY_ID} .luc-row[data-drop="true"] {
                outline: 2px dashed var(--lectio-theme-accent, #0f6f6f);
                outline-offset: 1px;
            }

            #${OVERLAY_ID} .luc-row[data-state="skipped"] {
                background: var(--lectio-theme-surface-alt, #f1f4f5);
            }

            #${OVERLAY_ID} .luc-line {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 6px;
            }

            #${OVERLAY_ID} .luc-when {
                font-weight: 600;
                min-width: 120px;
            }

            #${OVERLAY_ID} .luc-tools {
                margin-left: auto;
                display: inline-flex;
                gap: 4px;
            }

            #${OVERLAY_ID} .luc-items {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 4px;
            }

            #${OVERLAY_ID} .luc-item {
                border-radius: 999px;
                padding: 1px 8px;
                font-size: 12px;
                background: var(--lectio-theme-surface-alt, #e8eef0);
                color: var(--lectio-theme-text, #17242a);
            }

            #${OVERLAY_ID} .luc-item[data-kind="other"] {
                border: 1px dashed var(--lectio-theme-muted, #9aa6ab);
            }

            #${OVERLAY_ID} .luc-muted {
                color: var(--lectio-theme-muted, #5b676d);
            }

            #${OVERLAY_ID} .luc-hint {
                margin: 0 0 8px;
                color: var(--lectio-theme-muted, #5b676d);
            }

            @media (max-width: 760px) {
                #${OVERLAY_ID} {
                    padding: 0;
                }

                #${OVERLAY_ID} .luc-body {
                    grid-template-columns: 1fr;
                }
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);

        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;

        return node;
    }

    function button(label, onClick, className, title) {
        const node = element('button', className || '', label);

        node.type = 'button';

        if (title) node.title = title;

        node.addEventListener('click', onClick);

        return node;
    }

    function whenOf(time) {
        if (!time) return '';

        const weekday = labels().weekdays[time.date.getDay()];

        return `${weekday} ${time.date.getDate()}/${time.date.getMonth() + 1} · ${time.start}-${time.end}`;
    }

    function itemChips(lesson, text) {
        const box = element('div', 'luc-items');

        if (!lesson.items.length) {
            box.append(element('span', 'luc-muted', text.noItems));

            return box;
        }

        lesson.items.forEach((item) => {
            const kind = item.kind === 'other' ? text.kindOther : item.kind === 'presentation' ? text.kindPresentation : text.kindHomework;
            const link = item.linkType === 'file' ? ` (${text.kindFile})` : item.linkType ? ` (${text.kindLink})` : '';
            const chip = element('span', 'luc-item', item.title || kind);

            chip.dataset.kind = item.kind;
            chip.title = `${kind}${link}`;
            box.append(chip);
        });

        return box;
    }

    function lessonLabel(lesson, text) {
        const parts = [whenOf(lesson.time) || lesson.id];

        if (lesson.cancelled) parts.push(`(${text.cancelledLastYear})`);

        return parts.join(' ');
    }

    function render() {
        const overlay = document.getElementById(OVERLAY_ID);

        if (!overlay || !plan) return;

        const text = labels();
        const { rows, notPlaced } = assign();
        const dialog = overlay.querySelector('.luc-dialog');
        const scrollTop = overlay.querySelector('.luc-body')?.scrollTop || 0;

        dialog.replaceChildren();
        dialog.setAttribute('aria-label', text.title);

        /* Header: the one decision - which class, from when. */
        const header = element('header');

        header.append(element('h2', '', text.title));

        const classLabel = element('label', '', text.classLabel);
        const classSelect = element('select');

        if (!plan.classes.length) {
            const option = element('option', '', plan.statusKind === 'error' ? '-' : text.classLoading);

            option.value = '';
            classSelect.append(option);
            classSelect.disabled = true;
        } else {
            plan.classes.forEach((hold) => {
                const option = element('option', '', hold.name);

                option.value = hold.id;
                option.selected = hold.id === plan.holdId;
                classSelect.append(option);
            });
        }

        classSelect.addEventListener('change', () => {
            plan.holdId = classSelect.value;
            plan.targets = [];
            plan.skip = new Map();
            saveDraft();
            render();
        });
        classLabel.append(classSelect);

        const startLabel = element('label', '', text.startLabel);
        const startInput = element('input');

        startInput.type = 'date';
        startInput.value = plan.start;
        startInput.addEventListener('change', () => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(startInput.value)) {
                plan.start = startInput.value;
                plan.targets = [];
                saveDraft();
                render();
            }
        });
        startLabel.append(startInput);

        const find = button(text.findButton, () => findLessons(), 'luc-primary');

        find.disabled = !plan.holdId || Boolean(scanController);

        header.append(classLabel, startLabel, find, button(text.close, close));

        const placed = rows.filter((row) => row.lesson !== null).length;
        const hasContent = rows.filter((row) => row.reason === 'has-content').length;
        const summary = element('p', 'luc-summary');
        const sentences = [fill(text.summary, { source: plan.order.length - plan.leftOut.size, filled: placed })];

        if (plan.targets.length && notPlaced.length) sentences.push(fill(text.summaryNotPlaced, { n: notPlaced.length }));
        if (hasContent) sentences.push(fill(text.summaryHasContent, { n: hasContent }));
        if (plan.cancelledTargets) sentences.push(fill(text.summaryCancelled, { n: plan.cancelledTargets }));

        summary.textContent = plan.targets.length ? sentences.join(' ') : '';

        const status = element('p', 'luc-status', plan.status);

        status.dataset.kind = plan.statusKind;
        status.setAttribute('role', 'status');

        header.append(summary, status, element('p', 'luc-plan-only', text.planOnly));

        /* Left: last year's lessons, in the order they will be placed. */
        const body = element('div', 'luc-body');
        const left = element('section', 'luc-column luc-source');
        const sourceList = element('ol');

        left.append(element('h3', '', `${text.sourceHeading}: ${source.title}`));

        plan.order.forEach((lessonIndex, position) => {
            const lesson = source.lessons[lessonIndex];
            const card = element('li', 'luc-card');
            const line = element('div', 'luc-line');
            const out = plan.leftOut.has(lessonIndex);
            const tools = element('span', 'luc-tools');
            const up = button('↑', () => { moveLesson(lessonIndex, -1); saveDraft(); render(); }, 'luc-small', text.moveUp);
            const down = button('↓', () => { moveLesson(lessonIndex, 1); saveDraft(); render(); }, 'luc-small', text.moveDown);

            card.draggable = true;
            card.dataset.lesson = String(lessonIndex);
            card.dataset.leftOut = String(out);
            card.addEventListener('dragstart', (event) => {
                event.dataTransfer.setData('text/plain', DRAG_PREFIX + lessonIndex);
                event.dataTransfer.effectAllowed = 'move';
            });

            up.disabled = position === 0;
            down.disabled = position === plan.order.length - 1;

            tools.append(
                up,
                down,
                button(out ? text.putBack : text.leaveOut, () => {
                    if (out) plan.leftOut.delete(lessonIndex);
                    else plan.leftOut.add(lessonIndex);
                    saveDraft();
                    render();
                }, 'luc-small')
            );

            line.append(element('span', 'luc-when', lessonLabel(lesson, text)));

            if (out) line.append(element('span', 'luc-muted', text.leftOutNote));

            line.append(tools);
            card.append(line, itemChips(lesson, text));
            sourceList.append(card);
        });

        left.append(sourceList);

        /* Right: this class's lessons, each with what lands on it. */
        const right = element('section', 'luc-column luc-target');
        const holdName = plan.classes.find((hold) => hold.id === plan.holdId)?.name || '';

        right.append(element('h3', '', holdName ? `${text.targetHeading}: ${holdName}` : text.targetHeading));

        if (!plan.targets.length) {
            right.append(element('p', 'luc-muted', text.targetEmpty));
        } else {
            right.append(element('p', 'luc-hint', text.dragHint));

            const targetList = element('ol');

            rows.forEach((row, targetIndex) => {
                const item = element('li', 'luc-row');
                const line = element('div', 'luc-line');
                const tools = element('span', 'luc-tools');
                const skipped = row.reason === 'has-content' || row.reason === 'left-empty';

                item.dataset.target = row.target.absId;
                item.dataset.state = skipped ? 'skipped' : row.lesson === null ? 'empty' : 'filled';

                item.addEventListener('dragover', (event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    item.dataset.drop = 'true';
                });
                item.addEventListener('dragleave', () => { delete item.dataset.drop; });
                item.addEventListener('drop', (event) => {
                    event.preventDefault();
                    delete item.dataset.drop;

                    const data = event.dataTransfer.getData('text/plain') || '';

                    if (!data.startsWith(DRAG_PREFIX)) return;

                    const lessonIndex = Number(data.slice(DRAG_PREFIX.length));

                    if (!Number.isInteger(lessonIndex) || !source.lessons[lessonIndex]) return;

                    placeAt(lessonIndex, targetIndex);
                    saveDraft();
                    render();
                });

                tools.append(button(skipped ? text.useLesson : text.leaveEmpty, () => {
                    plan.skip.set(row.target.absId, !skipped);
                    saveDraft();
                    render();
                }, 'luc-small'));

                line.append(element('span', 'luc-when', whenOf(row.target.time)), tools);
                item.append(line);

                if (row.lesson !== null) {
                    const lesson = source.lessons[row.lesson];

                    item.append(element('div', 'luc-muted', `← ${lessonLabel(lesson, text)}`), itemChips(lesson, text));
                } else {
                    item.append(element('div', 'luc-muted',
                        row.reason === 'has-content' ? text.hasContent : row.reason === 'left-empty' ? text.leftEmpty : text.emptySlot));
                }

                targetList.append(item);
            });

            right.append(targetList);

            if (notPlaced.length) {
                const leftover = element('div', 'luc-card');

                leftover.append(element('strong', '', `${text.notPlacedHeading} (${notPlaced.length})`));
                leftover.append(element('div', 'luc-muted', notPlaced.map((index) => lessonLabel(source.lessons[index], text)).join(', ')));
                right.append(leftover);
            }
        }

        body.append(left, right);

        /* Footer. */
        const footer = element('footer');
        const copyButton = button(text.copyPlan, () => copyPlanText(copyButton));

        copyButton.disabled = !plan.targets.length;
        footer.append(copyButton, button(text.resetPlan, () => {
            const keep = { holdId: plan.holdId, start: plan.start, classes: plan.classes, targets: plan.targets, cancelledTargets: plan.cancelledTargets };

            plan = Object.assign(newPlan(), keep);
            saveDraft();
            render();
        }));

        dialog.append(header, body, footer);
        body.scrollTop = scrollTop;
    }

    function planText() {
        const text = labels();
        const { rows, notPlaced } = assign();
        const holdName = plan.classes.find((hold) => hold.id === plan.holdId)?.name || '';
        const lines = [`${source.title} → ${holdName}`, ''];

        rows.forEach((row) => {
            const when = whenOf(row.target.time);

            if (row.lesson === null) {
                lines.push(`${when}\t${row.reason === 'has-content' ? text.hasContent : row.reason === 'left-empty' ? text.leftEmpty : text.emptySlot}`);
            } else {
                const lesson = source.lessons[row.lesson];
                const items = lesson.items.map((item) => item.title).join('; ') || text.noItems;

                lines.push(`${when}\t← ${lessonLabel(lesson, text)}: ${items}`);
            }
        });

        if (notPlaced.length) {
            lines.push('', `${text.notPlacedHeading}: ${notPlaced.map((index) => lessonLabel(source.lessons[index], text)).join(', ')}`);
        }

        return lines.join('\n');
    }

    async function copyPlanText(trigger) {
        const value = planText();

        try {
            await navigator.clipboard.writeText(value);
        } catch (_) {
            const area = element('textarea');

            area.value = value;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.append(area);
            area.select();

            try {
                document.execCommand('copy');
            } catch (__) {
                // Nothing more to try; the plan is still on screen.
            }

            area.remove();
        }

        trigger.textContent = labels().copied;
    }

    /* ---------------------------------------------------------------- *
     * Opening and closing
     * ---------------------------------------------------------------- */

    async function open() {
        if (document.getElementById(OVERLAY_ID)) return;

        lastFocus = document.activeElement;
        plan = newPlan();
        loadDraft();

        const overlay = element('div');
        const dialog = element('div', 'luc-dialog');

        overlay.id = OVERLAY_ID;
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.tabIndex = -1;
        overlay.append(dialog);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
        });
        document.body.append(overlay);
        render();
        dialog.focus();

        cancelScan();
        scanController = new AbortController();

        const signal = scanController.signal;

        try {
            const holds = await discoverClasses(signal);

            plan.classes = rankClasses(holds, source);

            if (!plan.classes.some((hold) => hold.id === plan.holdId)) plan.holdId = plan.classes[0]?.id || '';

            setStatus(plan.classes.length ? '' : labels().classNone, plan.classes.length ? '' : 'warn');
        } catch (error) {
            if (!signal.aborted) setStatus(error.code === 'session' ? labels().sessionLost : fill(labels().fetchFailed, { week: isoWeek(new Date()).week }), 'error');
        } finally {
            if (scanController && scanController.signal === signal) scanController = null;
        }

        render();
    }

    function close() {
        cancelScan();
        document.getElementById(OVERLAY_ID)?.remove();

        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();

        lastFocus = null;
    }

    function handleKey(event) {
        if (event.key === 'Escape' && document.getElementById(OVERLAY_ID)) close();
    }

    function installButton() {
        if (document.getElementById(BUTTON_ID)) return;

        // Only on a unit the person can edit: the same page Lectio gives
        // Kopiér forløb and Rediger forløb to.
        const copyLink = document.querySelector('[id$="_newfrombtn"]');
        const canEdit = document.querySelector('[id$="_editbtn"], [id$="_activateEditModeBtn"]');

        if (!copyLink || !canEdit) return;

        const text = labels();
        const wrapper = element('div', 'buttontext');
        const link = element('a');

        wrapper.id = BUTTON_ID;
        link.href = '#';
        link.setAttribute('data-role', 'button');
        link.title = text.openButtonTitle;
        // An icon name Lectio's own navigation already uses, so the font has it.
        link.append(element('span', 'ls-fonticon', 'calendar_month'), document.createTextNode(text.openButton));
        link.addEventListener('click', (event) => {
            event.preventDefault();
            open();
        });
        wrapper.append(link);

        const host = copyLink.closest('.buttontext') || copyLink;

        host.after(document.createTextNode(' '), wrapper);
    }

    function relabel() {
        const wrapper = document.getElementById(BUTTON_ID);

        if (wrapper) {
            wrapper.remove();
            installButton();
        }

        render();
    }

    /* ---------------------------------------------------------------- *
     * Teardown
     * ---------------------------------------------------------------- */

    function teardown() {
        cancelScan();
        lifecycle.abort();
        document.getElementById(OVERLAY_ID)?.remove();
        document.getElementById(BUTTON_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
    }

    /* ---------------------------------------------------------------- *
     * Start
     * ---------------------------------------------------------------- */

    window.addEventListener('lectio-manager:discover', announce, { signal: lifecycle.signal });
    window.addEventListener('lectio-manager:language', () => { announce(); relabel(); }, { signal: lifecycle.signal });
    document.addEventListener('keydown', handleKey, { signal: lifecycle.signal });

    // A frozen page only stops its week scan; a page really going away is
    // torn down. pageshow needs nothing back: a scan is only ever started by
    // a click (issue #41's pattern, without its bug).
    window.addEventListener('pagehide', (event) => {
        cancelScan();

        if (event && event.persisted) return;

        teardown();
    });

    function start() {
        announce();

        source = readSourceUnit();

        if (!source) return;

        if (!source.lessons.length) {
            // The unit's lesson container is there and holds nothing this
            // could read. A unit with no lessons has no container at all.
            if (document.querySelector('[id$="_actContainer"] .ls-phase-activity')) reportToManager('drift', 'unit-lessons', 0);

            return;
        }

        addStyles();
        installButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true, signal: lifecycle.signal });
    } else {
        start();
    }
})();
