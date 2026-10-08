// ==UserScript==
// @name         Lectio - Unit Copier
// @namespace    https://github.com/RktRobinhood/Lectio-Scripts
// @version      0.2.1
// @description  Reuse last year's unit in a new class: explains Lectio's Kopiér, checks the class Lectio really chose, suggests the Periode, and on the copied unit lines last year's lessons up with the new ones. Plan only - nothing is copied into Lectio yet.
// @author       RktRobinhood
// @match        https://www.lectio.dk/lectio/*/studieplan/forloeb_vis.aspx*
// @match        https://www.lectio.dk/lectio/*/studieplan/forloeb_kopier.aspx*
// @noframes
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/RktRobinhood/Lectio-Scripts
// @supportURL   https://github.com/RktRobinhood/Lectio-Scripts/issues
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Unit-Copier.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Unit-Copier.user.js
// ==/UserScript==

/*
 * UNIT COPIER (issue #74)
 *
 * The job: "put last year's unit into this year's class". Lectio does it in
 * two steps, and this module sits on both:
 *
 * 1. KOPIÉR FORLØB (studieplan/forloeb_kopier.aspx). Lectio creates a new
 *    unit for the chosen class. Its lessons are the class's timetabled
 *    lessons inside the Periode, and they are EMPTY; last year's material
 *    goes into the new unit's Forløbsmaterialet pile. The form says none of
 *    that. This module explains it, checks which class Lectio has really
 *    stored (its type-ahead can store a different class from the one the box
 *    shows - seen twice on 2026-10-07), and suggests a Periode long enough
 *    for last year's lessons. The person presses Kopiér; this never does.
 *
 * 2. THE COPIED UNIT (studieplan/forloeb_vis.aspx). Lectio remembers where a
 *    copy came from: its material picker lists the original under
 *    "Relaterede forløb". This module finds it there, reads both units, and
 *    offers a plan: last year's lessons in order on this unit's lessons,
 *    adjusted by skipping a day, leaving a lesson out, or dragging.
 *
 * THIS VERSION ONLY READS. Every request is a GET of a page the person can
 * already open. Writing the plan into the lessons comes later, under the
 * ADR-0009 amendment of 2026-10-07 and the safety bar written there.
 *
 * Everything is matched on ids and attributes, never on Danish text the page
 * shows, because English Mode may have translated it. The few Danish strings
 * matched (tooltip lines, the picker's tree) are read from fetched pages,
 * which no module has touched.
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
    const MODULE_VERSION = '0.2.1';

    const STYLE_ID = 'lectio-unit-copier-styles';
    const BANNER_ID = 'lectio-unit-copier-banner';
    const DIALOG_ID = 'lectio-unit-copier';
    const GUIDE_ID = 'lectio-unit-copier-guide';
    const DRAG_PREFIX = 'lectio-unit-copier:';

    /*
     * Plans, so a teacher can come back when the school publishes more of the
     * timetable and carry on where they stopped. One key, keyed inside by the
     * copied unit's phase id. Declared to the Manager as prunable: losing it
     * only resets a plan to its default.
     */
    const PLANS_KEY = 'lectioUnitCopier.plans.v1';
    const PLAN_LIFE_MS = 400 * 24 * 60 * 60 * 1000;

    const FETCH_TIMEOUT_MS = 10000;
    const CLASS_CHECK_MS = 700;
    const PERIOD_SCAN_WEEKS = 12;

    const TIME_PATTERN = /(\d{1,2})\/(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s+til\s+(\d{1,2}):(\d{2})/;

    // One controller for every listener, and one for every request, so
    // teardown is two abort() calls rather than lists that drift.
    const lifecycle = new AbortController();
    const requests = new AbortController();

    // Page-view state, declared above the boot call at the bottom
    // (scripts/check-boot-order.mjs).
    let unit = null;            // this unit, read off the page
    let source = null;          // the unit it was copied from, fetched
    let plan = null;            // see newPlan()
    let lastFocus = null;
    let classTimer = 0;
    // Bumped by every start and by teardown, so a start that was still
    // waiting on its fetch when a newer one began - a language switch does
    // that - knows it is stale and does not arm a second, unclearable timer.
    let copyFormRun = 0;
    let waitingCause = null;    // why lessons are waiting: see checkWaitingCause()
    let checkedClassId = null;   // null: nothing checked yet, not even the empty box

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
                bannerCopied: 'Copied from {source} ({count} lessons).',
                bannerState: 'Lessons with material: {filled} of {total}.',
                bannerButton: 'Place last year\'s lessons',
                bannerChecking: 'Unit Copier: checking where this unit was copied from...',
                title: 'Place last year\'s lessons',
                subtitle: '{source} ({sourceYear}) → {target} ({targetYear})',
                colYours: 'Your lesson',
                colGets: 'Gets last year\'s lesson',
                placedOne: '1 of {total} lessons from last year placed.',
                placedMany: '{placed} of {total} lessons from last year placed.',
                waitingOne: '1 more needs a lesson: this unit only has lessons up to {date}.',
                waitingMany: '{n} more need lessons: this unit only has lessons up to {date}.',
                waitingChecking: 'Checking your timetable to see why...',
                waitingPeriod: 'Your timetable already has {more} more {name} lessons after this unit\'s Periode ends ({end}), up to {last}. Make the Periode longer to place them now; this plan is kept.',
                waitingTimetable: 'Your timetable has no {name} lessons after {last} yet: the school has not published further. Come back when it has; this plan is kept.',
                editPeriod: 'Change the Periode (Rediger forløb)',
                bannerNotFound: 'Unit Copier could not tell which unit this one was copied from, so it cannot line up last year\'s lessons here.',
                skippedOne: '1 lesson already has material and is left alone.',
                skippedMany: '{n} lessons already have material and are left alone.',
                week: 'Week {week}',
                lessonNumber: 'Lesson {n}',
                was: 'was {date}',
                noMaterial: '(no material)',
                kindHomework: 'Homework',
                kindOther: 'Other',
                kindPresentation: 'Presentation',
                hasContent: 'Already has material, not touched',
                skipped: 'Skipped',
                free: 'Free: no more lessons from last year',
                skipDay: 'Skip this day',
                skipDayTip: 'Keep this lesson free. The rest move one lesson later.',
                leaveOut: 'Leave out',
                leaveOutTip: 'Drop this lesson from the plan. The rest move one lesson earlier.',
                useAnyway: 'Use anyway',
                useAnywayTip: 'Put last year\'s lesson here as well. Nothing already on it will be changed.',
                undo: 'Undo',
                putBack: 'Put back',
                dragTip: 'Drag onto another of your lessons to start this lesson there.',
                waitingHeading: 'Waiting for lessons ({n})',
                leftOutHeading: 'Left out ({n})',
                planOnly: 'This is a plan. Nothing is changed in Lectio yet.',
                startOver: 'Start over',
                copyPlan: 'Copy plan as text',
                copied: 'Copied',
                close: 'Close',
                noLessons: 'This unit has no lessons yet. Lengthen its Periode (Rediger forløb) so it covers the class\'s lessons.',
                guideTitle: 'What Kopiér does',
                guideStep1: 'Lectio makes a new unit for the class you choose. Its lessons are that class\'s lessons between the two Periode dates, and they start empty.',
                guideStep2: 'Last year\'s material goes into the new unit\'s Forløbsmateriale, not into the lessons.',
                guideStep3: 'After you press Kopiér, open the new unit and press "Place last year\'s lessons" to line them up.',
                classChecking: 'Checking which class Lectio has stored...',
                classOk: 'Lectio has stored the class: {name}.',
                classMismatch: 'Careful: the box shows "{shown}", but Lectio has stored "{name}". Choose the class again from the list.',
                classNone: 'Choose a class from the list that appears as you type.',
                periodSource: 'Last year\'s unit has {count} lessons.',
                periodScanning: 'Reading your timetable for {name}: week {week}...',
                periodSuggested: 'Suggested Periode: {start} to {end}.',
                periodExact: 'All {count} lessons fit in your published timetable.',
                periodEstimate: '{shown} of them are in your timetable (up to {last}); the other {rest} are estimated at about {perWeek} lessons a week.',
                periodNoLessons: 'No upcoming lessons for {name} were found in your timetable.',
                periodUse: 'Use {start} to {end}',
                periodUsed: 'Dates filled in. Check them before you press Kopiér.',
                weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
                months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
            }
            // i18n:da
            : {
                bannerCopied: 'Kopieret fra {source} ({count} lektioner).',
                bannerState: 'Lektioner med materiale: {filled} af {total}.',
                bannerButton: 'Placér sidste års lektioner',
                bannerChecking: 'Forløbskopiering: tjekker, hvor forløbet er kopieret fra...',
                title: 'Placér sidste års lektioner',
                subtitle: '{source} ({sourceYear}) → {target} ({targetYear})',
                colYours: 'Din lektion',
                colGets: 'Får sidste års lektion',
                placedOne: '1 af {total} lektioner fra sidste år er placeret.',
                placedMany: '{placed} af {total} lektioner fra sidste år er placeret.',
                waitingOne: '1 mangler en lektion: forløbet har kun lektioner til og med {date}.',
                waitingMany: '{n} mangler lektioner: forløbet har kun lektioner til og med {date}.',
                waitingChecking: 'Tjekker dit skema for at se hvorfor...',
                waitingPeriod: 'Dit skema har allerede {more} lektioner mere med {name} efter forløbets Periode slutter ({end}), til og med {last}. Gør Periode længere for at placere dem nu; planen bliver gemt.',
                waitingTimetable: 'Dit skema har endnu ingen lektioner med {name} efter {last}: skolen har ikke lagt mere ud. Kom tilbage, når det er sket; planen bliver gemt.',
                editPeriod: 'Ret Periode (Rediger forløb)',
                bannerNotFound: 'Forløbskopiering kunne ikke se, hvilket forløb dette er kopieret fra, så den kan ikke sætte sidste års lektioner op her.',
                skippedOne: '1 lektion har allerede materiale og bliver ikke rørt.',
                skippedMany: '{n} lektioner har allerede materiale og bliver ikke rørt.',
                week: 'Uge {week}',
                lessonNumber: 'Lektion {n}',
                was: 'var {date}',
                noMaterial: '(intet materiale)',
                kindHomework: 'Lektie',
                kindOther: 'Øvrigt',
                kindPresentation: 'Præsentation',
                hasContent: 'Har allerede materiale, bliver ikke rørt',
                skipped: 'Sprunget over',
                free: 'Fri: ikke flere lektioner fra sidste år',
                skipDay: 'Spring dagen over',
                skipDayTip: 'Hold lektionen fri. Resten rykker én lektion senere.',
                leaveOut: 'Udelad',
                leaveOutTip: 'Tag lektionen ud af planen. Resten rykker én lektion tidligere.',
                useAnyway: 'Brug alligevel',
                useAnywayTip: 'Læg også sidste års lektion her. Intet, der allerede ligger her, bliver ændret.',
                undo: 'Fortryd',
                putBack: 'Tag med igen',
                dragTip: 'Træk over på en anden af dine lektioner for at starte lektionen dér.',
                waitingHeading: 'Venter på lektioner ({n})',
                leftOutHeading: 'Udeladt ({n})',
                planOnly: 'Dette er en plan. Intet bliver ændret i Lectio endnu.',
                startOver: 'Start forfra',
                copyPlan: 'Kopiér planen som tekst',
                copied: 'Kopieret',
                close: 'Luk',
                noLessons: 'Forløbet har ingen lektioner endnu. Gør dets Periode længere (Rediger forløb), så den dækker holdets lektioner.',
                guideTitle: 'Det gør Kopiér',
                guideStep1: 'Lectio laver et nyt forløb til det hold, du vælger. Dets lektioner er holdets lektioner mellem de to datoer i Periode, og de starter tomme.',
                guideStep2: 'Sidste års materiale lægges i det nye forløbs Forløbsmateriale, ikke i lektionerne.',
                guideStep3: 'Når du har trykket Kopiér, så åbn det nye forløb og tryk "Placér sidste års lektioner" for at sætte dem på plads.',
                classChecking: 'Tjekker, hvilket hold Lectio har gemt...',
                classOk: 'Lectio har gemt holdet: {name}.',
                classMismatch: 'Pas på: feltet viser "{shown}", men Lectio har gemt "{name}". Vælg holdet igen fra listen.',
                classNone: 'Vælg et hold fra listen, der kommer frem, når du skriver.',
                periodSource: 'Sidste års forløb har {count} lektioner.',
                periodScanning: 'Læser dit skema for {name}: uge {week}...',
                periodSuggested: 'Foreslået Periode: {start} til {end}.',
                periodExact: 'Alle {count} lektioner ligger i dit skema.',
                periodEstimate: '{shown} af dem ligger i dit skema (til og med {last}); de øvrige {rest} er anslået ud fra omkring {perWeek} lektioner om ugen.',
                periodNoLessons: 'Der blev ikke fundet kommende lektioner for {name} i dit skema.',
                periodUse: 'Brug {start} til {end}',
                periodUsed: 'Datoerne er udfyldt. Tjek dem, før du trykker Kopiér.',
                weekdays: ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'],
                months: ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
            };
            // i18n:end
    }

    function fill(template, values) {
        return String(template).replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
    }

    /* ---------------------------------------------------------------- *
     * Discovery (ADR-0002), storage (docs/manager-storage-api.md)
     * ---------------------------------------------------------------- */

    function announce() {
        window.dispatchEvent(new CustomEvent('lectio-module:register', {
            detail: {
                id: MODULE_ID,
                name: MODULE_NAME,
                version: MODULE_VERSION,
                settingsSchema: [],
                currentValues: {},
                storage: [
                    {
                        key: PLANS_KEY,
                        kind: 'state',
                        prunable: true,
                        label: { en: 'Unit plans in progress', da: 'Forløbsplaner i gang' }
                    }
                ]
            }
        }));
    }

    function handlePrune(event) {
        const detail = event?.detail;

        if (detail?.id !== MODULE_ID || detail.key !== PLANS_KEY) return;

        try {
            localStorage.removeItem(PLANS_KEY);
        } catch (_) {
            // Nothing to remove if storage cannot be reached.
        }
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

    function schoolId() {
        return (location.pathname.match(/^\/lectio\/(\d+)\//) || [])[1] || null;
    }

    function parseTime(tooltip) {
        const match = String(tooltip || '').match(TIME_PATTERN);

        if (!match) return null;

        const [, day, month, year, startHour, startMinute, endHour, endMinute] = match.map(Number);

        return {
            date: new Date(year, month - 1, day, startHour, startMinute),
            start: `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`,
            end: `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`
        };
    }

    function isCancelled(block) {
        if (!block) return false;
        if (block.classList.contains('s2cancelled') || block.querySelector('.s2cancelled')) return true;

        return /^\s*(Aflyst!|Cancelled|Canceled)/i.test(block.getAttribute('data-tooltip') || '');
    }

    async function fetchDoc(url) {
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), FETCH_TIMEOUT_MS);
        const relay = () => timeout.abort();

        requests.signal.addEventListener('abort', relay, { once: true });

        try {
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: { Accept: 'text/html,application/xhtml+xml' },
                signal: timeout.signal
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            if (/login/i.test(response.url || '')) throw Object.assign(new Error('session'), { code: 'session' });

            return new DOMParser().parseFromString(await response.text(), 'text/html');
        } finally {
            clearTimeout(timer);
            requests.signal.removeEventListener('abort', relay);
        }
    }

    /*
     * A unit page - this one, or one fetched. Lessons are
     * div.ls-phase-activity#ACC<id> with their timetable block in the heading;
     * items are [data-to-toc-id^="ACH"] under *_InlineHomework (Lektier) or
     * *_InlineOther (Øvrigt indhold), and the presentation is ACP.
     */
    function readUnit(doc, href) {
        const container = doc.querySelector('[id$="_actContainer"]');
        const lessons = [];

        (container ? container.querySelectorAll('.ls-phase-activity[id^="ACC"]') : []).forEach((lesson) => {
            const block = lesson.querySelector('a.s2skemabrik[data-tooltip]');
            const items = [];

            lesson.querySelectorAll('[data-to-toc-id^="ACH"], [data-to-toc-id^="ACP"]').forEach((item) => {
                const id = item.getAttribute('data-to-toc-id');

                if (item.tagName === 'A' || items.some((known) => known.id === id)) return;

                const kind = id.startsWith('ACP') ? 'presentation' : item.closest('[id$="_InlineOther"]') ? 'other' : 'homework';
                const heading = item.querySelector('h1, h2, h3');
                const title = (heading?.textContent || item.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);

                items.push({ id, kind, title });
            });

            // The class, by the timetable's own HE card on the lesson's block.
            const card = block?.querySelector('[data-lectiocontextcard^="HE"]');

            lessons.push({
                id: lesson.id,
                time: block ? parseTime(block.getAttribute('data-tooltip')) : null,
                cancelled: isCancelled(block),
                hold: card ? { id: card.getAttribute('data-lectiocontextcard'), name: card.textContent.trim() } : null,
                items
            });
        });

        const heading = doc.querySelector('[data-to-toc-id="overview"]');
        const title = (heading?.textContent || '').replace(/\s+/g, ' ').trim().replace(/^Forløb\s*-\s*/i, '');

        // "19-10-2026 — 06-11-2026" in the unit's Periode row.
        const periodDates = (doc.querySelector('[id$="_PeriodsRow"] td')?.textContent || '').match(/\d{1,2}-\d{1,2}-\d{4}/g) || [];
        const periodEnd = periodDates[1] ? (([day, month, year]) => new Date(year, month - 1, day, 23, 59))(periodDates[1].split('-').map(Number)) : null;

        return {
            phaseId: new URL(href, location.href).searchParams.get('phaseid') || '',
            title,
            periodEnd,
            lessons
        };
    }

    // Last year's lessons as a sequence. A lesson cancelled with nothing on it
    // never happened, so it takes no place; one with material keeps its place.
    function sourceSequence(sourceUnit) {
        return sourceUnit.lessons.filter((lesson) => !lesson.cancelled || lesson.items.length);
    }

    // This unit's lessons that can take something: the cancelled ones cannot.
    function targetLessons(targetUnit) {
        return targetUnit.lessons
            .filter((lesson) => !lesson.cancelled && lesson.time)
            .map((lesson) => ({ id: lesson.id, time: lesson.time, hasContent: lesson.items.length > 0 }));
    }

    function schoolYear() {
        const chosen = Number(document.querySelector('#m_ChooseTerm_term, [id$="_ChooseTerm_term"]')?.value);

        if (Number.isInteger(chosen) && chosen > 2000) return chosen;

        const now = new Date();

        return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    }

    /*
     * Where this unit was copied from. Lectio's own material picker lists it
     * first under "Relaterede forløb": the tree's first node, with the
     * original as PH<phase id> inside it. The picker is a page anyone with
     * this unit can open; this only reads it.
     */
    async function findSourcePhaseId(targetUnit) {
        const first = targetUnit.lessons[0];

        if (!first || !targetUnit.phaseId) return null;

        const url = `/lectio/${schoolId()}/documentchoosercontent.aspx?mode=pickhomework&year=${schoolYear()}` +
            `&activitycontentid=${encodeURIComponent(first.id.replace(/^ACC/, ''))}&phaseids=${encodeURIComponent(targetUnit.phaseId)}`;
        const doc = await fetchDoc(url);
        const root = doc.querySelector('[lec-node-id]');

        if (!root) {
            reportToManager('drift', 'picker-tree', 0);

            return null;
        }

        const title = root.querySelector('.TreeNode-title')?.textContent || '';

        if (!/relaterede|related/i.test(title) && root.getAttribute('lec-node-id') !== '__26') return null;

        const related = [...root.querySelectorAll('[lec-node-id^="PH"]')]
            .map((node) => (node.getAttribute('lec-node-id').match(/^PH(\d+)/) || [])[1])
            .filter((id) => id && id !== targetUnit.phaseId);

        return related[0] || null;
    }

    /* ---------------------------------------------------------------- *
     * Plans kept between visits
     * ---------------------------------------------------------------- */

    function loadPlans() {
        try {
            const plans = JSON.parse(localStorage.getItem(PLANS_KEY) || '{}');

            return plans && typeof plans === 'object' ? plans : {};
        } catch (_) {
            return {};
        }
    }

    function writePlans(plans) {
        try {
            if (Object.keys(plans).length) localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
            else localStorage.removeItem(PLANS_KEY);
        } catch (_) {
            if (!writePlans.reported) {
                writePlans.reported = true;
                reportToManager('error', 'storage-write');
            }
        }
    }

    // On load, not only on the path that reads a plan (issue #29).
    function prunePlans() {
        const plans = loadPlans();
        const now = Date.now();
        let changed = false;

        Object.entries(plans).forEach(([key, entry]) => {
            if (!entry || typeof entry !== 'object' || !(now - Number(entry.at || 0) < PLAN_LIFE_MS)) {
                delete plans[key];
                changed = true;
            }
        });

        if (changed) writePlans(plans);
    }

    function savePlan() {
        if (!unit?.phaseId || !plan) return;

        const plans = loadPlans();

        plans[unit.phaseId] = {
            source: source.phaseId,
            count: plan.lessons.length,
            order: plan.order,
            leftOut: [...plan.leftOut],
            skip: [...plan.skip],
            at: Date.now()
        };

        writePlans(plans);
    }

    function restorePlan() {
        const saved = loadPlans()[unit.phaseId];
        const count = plan.lessons.length;

        if (!saved || saved.source !== source.phaseId || saved.count !== count) return;
        if (!Array.isArray(saved.order) || saved.order.length !== count) return;
        if ([...saved.order].sort((a, b) => a - b).some((value, index) => value !== index)) return;

        plan.order = saved.order;
        plan.leftOut = new Set((saved.leftOut || []).filter((index) => Number.isInteger(index) && index < count));
        plan.skip = new Map((saved.skip || []).filter((entry) => Array.isArray(entry) && typeof entry[1] === 'boolean'));
    }

    /* ---------------------------------------------------------------- *
     * The plan
     *
     * order:   last year's lessons, by index, in the order they are placed.
     * leftOut: last year's lessons the teacher left out.
     * skip:    per lesson of this unit, an override of "leave it free".
     *          Without one, a lesson that already has material is left free.
     * ---------------------------------------------------------------- */

    function newPlan() {
        const lessons = sourceSequence(source);

        return {
            lessons,
            targets: targetLessons(unit),
            order: lessons.map((_, index) => index),
            leftOut: new Set(),
            skip: new Map()
        };
    }

    function isSkipped(target) {
        return plan.skip.has(target.id) ? plan.skip.get(target.id) : target.hasContent;
    }

    function assign() {
        const queue = plan.order.filter((index) => !plan.leftOut.has(index));
        let next = 0;

        const rows = plan.targets.map((target) => {
            if (isSkipped(target)) {
                return { target, lesson: null, reason: target.hasContent && !plan.skip.has(target.id) ? 'has-content' : 'skipped' };
            }

            const index = queue[next];

            next += 1;

            return { target, lesson: index === undefined ? null : index, reason: index === undefined ? 'free' : '' };
        });

        return { rows, waiting: queue.slice(next) };
    }

    // Put one of last year's lessons on one of this unit's lessons; everything
    // placed after it moves along with it.
    function placeAt(lessonIndex, targetIndex) {
        const target = plan.targets[targetIndex];

        if (!target) return;
        if (isSkipped(target)) plan.skip.set(target.id, false);

        plan.leftOut.delete(lessonIndex);

        const before = plan.targets.slice(0, targetIndex).filter((slot) => !isSkipped(slot)).length;
        const placed = plan.order.filter((index) => index !== lessonIndex && !plan.leftOut.has(index));
        const outside = plan.order.filter((index) => index !== lessonIndex && plan.leftOut.has(index));

        placed.splice(Math.min(before, placed.length), 0, lessonIndex);
        plan.order = [...placed, ...outside];
    }

    /* ---------------------------------------------------------------- *
     * Formatting
     * ---------------------------------------------------------------- */

    function isoWeek(date) {
        const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const weekday = day.getUTCDay() || 7;

        day.setUTCDate(day.getUTCDate() + 4 - weekday);

        const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));

        return { week: Math.ceil(((day - yearStart) / 86400000 + 1) / 7), year: day.getUTCFullYear() };
    }

    function dayLabel(date) {
        const text = labels();

        return `${text.weekdays[date.getDay()]} ${date.getDate()} ${text.months[date.getMonth()]}`;
    }

    function dayWithYear(date) {
        return `${dayLabel(date)} ${date.getFullYear()}`;
    }

    function lectioDate(date) {
        return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
    }

    function addDays(date, days) {
        const next = new Date(date);

        next.setDate(next.getDate() + days);

        return next;
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

    /* ---------------------------------------------------------------- *
     * Presentation (ADR-0006: every colour through the theming seam)
     * ---------------------------------------------------------------- */

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');

        style.id = STYLE_ID;
        style.textContent = `
            /* Lectio's page CSS reaches into anything put on the page; reset
               what it changes before styling. */
            #${DIALOG_ID}, #${DIALOG_ID} *, #${BANNER_ID}, #${BANNER_ID} *, #${GUIDE_ID}, #${GUIDE_ID} * {
                box-sizing: border-box;
                text-align: left;
                text-transform: none;
                letter-spacing: normal;
                float: none;
            }

            #${DIALOG_ID} :is(h2, h3, p, ol, ul, li), #${BANNER_ID} :is(p), #${GUIDE_ID} :is(h3, p, ol, li) {
                margin: 0;
                padding: 0;
            }

            #${DIALOG_ID} :is(ol, ul), #${GUIDE_ID} ol {
                list-style: none;
            }

            #${DIALOG_ID} :is(button, select, input), #${BANNER_ID} button, #${GUIDE_ID} button {
                font: inherit;
                line-height: 1.25;
                width: auto;
                height: auto;
                text-align: center;
                cursor: pointer;
                border: 1px solid var(--lectio-theme-muted, #9aa6ab);
                border-radius: 6px;
                padding: 4px 10px;
                background: var(--lectio-theme-surface, #ffffff);
                color: var(--lectio-theme-text, #17242a);
            }

            #${DIALOG_ID} .luc-primary, #${BANNER_ID} .luc-primary, #${GUIDE_ID} .luc-primary {
                background: var(--lectio-theme-accent, #0f6f6f);
                border-color: var(--lectio-theme-accent, #0f6f6f);
                color: var(--lectio-theme-on-accent, #ffffff);
                font-weight: 600;
            }

            #${BANNER_ID}, #${GUIDE_ID} {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px 14px;
                margin: 0 0 14px;
                padding: 10px 14px;
                border: 1px solid var(--lectio-theme-accent, #0f6f6f);
                border-left-width: 5px;
                border-radius: var(--lectio-theme-radius, 8px);
                background: var(--lectio-theme-surface, #ffffff);
                color: var(--lectio-theme-text, #17242a);
                font: 400 13px/1.45 Roboto, Arial, sans-serif;
            }

            #${BANNER_ID} p {
                flex: 1 1 320px;
            }

            #${GUIDE_ID} {
                display: block;
                max-width: 640px;
                margin: 14px 0;
            }

            #${GUIDE_ID} h3 {
                font-size: 14px;
                margin-bottom: 6px;
            }

            #${GUIDE_ID} ol {
                counter-reset: luc-step;
                margin-bottom: 8px;
            }

            #${GUIDE_ID} ol li {
                counter-increment: luc-step;
                padding-left: 22px;
                position: relative;
                margin-bottom: 4px;
            }

            #${GUIDE_ID} ol li::before {
                content: counter(luc-step) ".";
                position: absolute;
                left: 0;
                font-weight: 600;
            }

            #${GUIDE_ID} .luc-check {
                margin-top: 6px;
            }

            #${GUIDE_ID} .luc-check[data-kind="ok"] {
                color: var(--lectio-theme-accent, #0f6f6f);
            }

            #${GUIDE_ID} .luc-check[data-kind="warn"] {
                color: var(--lectio-theme-accent-alt, #9a3b1f);
                font-weight: 600;
            }

            #${GUIDE_ID} .luc-suggested {
                margin-top: 6px;
                font-weight: 700;
            }

            #${GUIDE_ID} .luc-muted, #${BANNER_ID} .luc-muted {
                color: var(--lectio-theme-muted, #5b676d);
            }

            /* A native modal: it sits in the browser's top layer, above
               anything another module floats over the page. */
            #${DIALOG_ID} {
                width: min(1100px, calc(100vw - 32px));
                max-height: calc(100vh - 32px);
                padding: 0;
                border: 0;
                border-radius: var(--lectio-theme-radius, 10px);
                background: var(--lectio-theme-surface, #ffffff);
                color: var(--lectio-theme-text, #17242a);
                font: 400 13px/1.45 Roboto, Arial, sans-serif;
                box-shadow: 0 12px 40px var(--lectio-theme-shadow, rgba(0, 0, 0, 0.3));
            }

            #${DIALOG_ID}[open] {
                display: flex;
                flex-direction: column;
            }

            #${DIALOG_ID}::backdrop {
                background: var(--lectio-theme-backdrop, rgba(16, 24, 28, 0.45));
            }

            #${DIALOG_ID} .luc-head, #${DIALOG_ID} .luc-foot {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 6px 12px;
                padding: 12px 18px;
                background: var(--lectio-theme-surface-alt, #f1f4f5);
            }

            #${DIALOG_ID} .luc-head h2 {
                font-size: 17px;
                flex: 1 1 auto;
            }

            #${DIALOG_ID} .luc-subtitle {
                flex-basis: 100%;
                color: var(--lectio-theme-muted, #5b676d);
            }

            #${DIALOG_ID} .luc-status {
                padding: 10px 18px;
                border-bottom: 1px solid var(--lectio-theme-muted, #d6dde0);
            }

            #${DIALOG_ID} .luc-status strong {
                display: block;
                font-size: 14px;
            }

            #${DIALOG_ID} .luc-scroll {
                overflow: auto;
                flex: 1;
                min-height: 0;
                padding: 0 18px 12px;
            }

            #${DIALOG_ID} .luc-columns, #${DIALOG_ID} .luc-row {
                display: grid;
                grid-template-columns: 11em 1fr auto;
                gap: 4px 14px;
                align-items: start;
            }

            #${DIALOG_ID} .luc-columns {
                position: sticky;
                top: 0;
                z-index: 1;
                padding: 8px 0 6px;
                background: var(--lectio-theme-surface, #ffffff);
                color: var(--lectio-theme-muted, #5b676d);
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
            }

            #${DIALOG_ID} .luc-week {
                padding: 10px 0 4px;
                font-weight: 700;
                color: var(--lectio-theme-muted, #5b676d);
            }

            #${DIALOG_ID} .luc-row {
                padding: 8px 10px;
                margin-bottom: 6px;
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
                border-radius: 8px;
            }

            #${DIALOG_ID} .luc-row[data-state="has-content"], #${DIALOG_ID} .luc-row[data-state="skipped"] {
                border-style: dashed;
                color: var(--lectio-theme-muted, #5b676d);
            }

            #${DIALOG_ID} .luc-row[data-drop="true"] {
                outline: 2px solid var(--lectio-theme-accent, #0f6f6f);
                outline-offset: 1px;
            }

            #${DIALOG_ID} .luc-when {
                font-weight: 600;
            }

            #${DIALOG_ID} .luc-when small {
                display: block;
                font-weight: 400;
                color: var(--lectio-theme-muted, #5b676d);
            }

            #${DIALOG_ID} .luc-lesson {
                display: flex;
                gap: 8px;
                align-items: flex-start;
            }

            #${DIALOG_ID} .luc-grip {
                cursor: grab;
                user-select: none;
                padding: 0 2px;
                font-size: 16px;
                line-height: 1.1;
                color: var(--lectio-theme-muted, #5b676d);
            }

            /* Text colour, not accent: in link blue it read as clickable. */
            #${DIALOG_ID} .luc-number {
                font-weight: 700;
                color: var(--lectio-theme-text, #17242a);
                white-space: nowrap;
                margin-right: 6px;
            }

            #${DIALOG_ID} .luc-edit-period {
                color: var(--lectio-theme-accent, #0f6f6f);
                font-weight: 600;
                text-decoration: underline;
            }

            #${DIALOG_ID} .luc-kind {
                display: block;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            #${DIALOG_ID} .luc-kind b {
                font-weight: 600;
            }

            #${DIALOG_ID} .luc-muted {
                color: var(--lectio-theme-muted, #5b676d);
            }

            #${DIALOG_ID} .luc-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                justify-content: flex-end;
            }

            #${DIALOG_ID} .luc-actions button {
                font-size: 12px;
                padding: 2px 8px;
            }

            #${DIALOG_ID} .luc-horizon {
                margin: 14px 0 6px;
                padding-top: 10px;
                border-top: 3px solid var(--lectio-theme-accent-alt, #9a3b1f);
            }

            #${DIALOG_ID} .luc-horizon h3, #${DIALOG_ID} details summary {
                font-size: 14px;
                font-weight: 700;
            }

            #${DIALOG_ID} .luc-waiting li {
                padding: 2px 0;
            }

            #${DIALOG_ID} details {
                margin-top: 10px;
            }

            #${DIALOG_ID} .luc-foot .luc-note {
                flex: 1 1 260px;
                color: var(--lectio-theme-muted, #5b676d);
            }

            @media (max-width: 860px) {
                #${DIALOG_ID} {
                    width: 100vw;
                    max-height: 100vh;
                    border-radius: 0;
                }

                #${DIALOG_ID} .luc-columns {
                    display: none;
                }

                #${DIALOG_ID} .luc-row {
                    grid-template-columns: 1fr;
                }

                #${DIALOG_ID} .luc-actions {
                    justify-content: flex-start;
                }
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    /* ---------------------------------------------------------------- *
     * The copied unit: banner and planner
     * ---------------------------------------------------------------- */

    function canEdit() {
        return Boolean(document.querySelector('[id$="_editbtn"], [id$="_activateEditModeBtn"]'));
    }

    async function startUnitPage() {
        unit = readUnit(document, location.href);

        if (!canEdit() || !unit.phaseId) return;

        if (!unit.lessons.length) {
            // A container with lesson boxes this could not read is drift. A
            // unit with no lessons in its Periode has none to read.
            if (document.querySelector('[id$="_actContainer"] .ls-phase-activity')) reportToManager('drift', 'unit-lessons', 0);

            return;
        }

        addStyles();

        // Say what is happening while it looks, so a copied unit never just
        // shows nothing (the failure of 0.1.0).
        renderBanner('checking');

        source = await loadSource();

        if (source) {
            renderBanner('ready');
        } else if (targetLessons(unit).every((lesson) => !lesson.hasContent)) {
            // Every lesson empty is what a fresh copy looks like, so a unit
            // like that deserves a word. Any other unit is simply left alone.
            renderBanner('not-found');
        } else {
            document.getElementById(BANNER_ID)?.remove();
        }
    }

    async function loadSource() {
        let sourceId = null;
        let found = null;

        try {
            sourceId = await findSourcePhaseId(unit);

            if (!sourceId) return null;

            const url = `/lectio/${schoolId()}/studieplan/forloeb_vis.aspx?phaseid=${encodeURIComponent(sourceId)}`;

            found = readUnit(await fetchDoc(url), url);
        } catch (_) {
            return null;
        }

        if (!sourceSequence(found).length) return null;

        // Lectio may relate the two units both ways, so last year's unit can
        // list this year's copy under Relaterede forløb too. A source is
        // older: its first lesson comes before this unit's first lesson.
        const sourceFirst = found.lessons.find((lesson) => lesson.time)?.time.date;
        const ownFirst = unit.lessons.find((lesson) => lesson.time)?.time.date;

        return sourceFirst && ownFirst && sourceFirst < ownFirst ? found : null;
    }

    function renderBanner(state) {
        if (state) renderBanner.state = state;
        if (!renderBanner.state) return;

        const text = labels();
        let banner = document.getElementById(BANNER_ID);

        if (!banner) {
            banner = element('div');
            banner.id = BANNER_ID;
            banner.setAttribute('role', 'status');

            const anchor = document.querySelector('.ls-phase-activity#overview') || document.querySelector('[id$="_actContainer"]');

            anchor.before(banner);
        }

        banner.dataset.state = renderBanner.state;

        if (renderBanner.state === 'checking') {
            banner.replaceChildren(element('p', 'luc-muted', text.bannerChecking));

            return;
        }

        if (renderBanner.state === 'not-found' || !source) {
            banner.replaceChildren(element('p', '', text.bannerNotFound));

            return;
        }

        const lessons = targetLessons(unit);
        const filled = lessons.filter((lesson) => lesson.hasContent).length;
        const copy = element('p');

        copy.append(
            element('strong', '', fill(text.bannerCopied, { source: source.title, count: sourceSequence(source).length })),
            document.createTextNode(' '),
            document.createTextNode(fill(text.bannerState, { filled, total: lessons.length }))
        );

        banner.replaceChildren(copy, button(text.bannerButton, openDialog, 'luc-primary'));
    }

    function openDialog() {
        if (!source || document.getElementById(DIALOG_ID)) return;

        lastFocus = document.activeElement;
        plan = newPlan();
        restorePlan();

        const dialog = element('dialog');

        dialog.id = DIALOG_ID;
        // Escape closes a native dialog by itself; the Close button goes
        // through closeDialog(). Either way it leaves the page at once, so
        // the banner can open a fresh one straight after.
        dialog.addEventListener('close', () => forgetDialog(dialog));
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) dialog.close();
        });
        document.body.append(dialog);
        render();

        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');

        if (!waitingCause && assign().waiting.length) {
            checkWaitingCause().then(render);
        }
    }

    /*
     * Why some of last year's lessons have nowhere to go yet, in the teacher's
     * terms. Either the class already has more lessons in the timetable after
     * this unit's Periode ends (lengthen the Periode now), or the school has
     * not published the timetable that far (come back later). Reads the
     * person's own timetable from the day after the Periode, stopping once
     * it has found enough lessons or two weeks in a row with none of the
     * person's classes in them - past the published timetable.
     */
    async function checkWaitingCause() {
        waitingCause = { kind: 'checking' };

        const hold = unit.lessons.find((lesson) => lesson.hold)?.hold;
        const lastTarget = targetLessons(unit).map((lesson) => lesson.time.date).sort((a, b) => b - a)[0];
        const periodEnd = unit.periodEnd || lastTarget;

        if (!hold || !periodEnd) {
            waitingCause = null;

            return;
        }

        const needed = assign().waiting.length;
        const seen = new Set();
        let last = null;
        let quiet = 0;

        try {
            for (let offset = 0; offset < PERIOD_SCAN_WEEKS && seen.size < needed; offset += 1) {
                const { week, year } = isoWeek(addDays(periodEnd, 1 + offset * 7));
                const doc = await fetchDoc(`/lectio/${schoolId()}/SkemaNy.aspx?week=${String(week).padStart(2, '0')}${year}&showtype=0`);
                const blocks = [...doc.querySelectorAll('a.s2skemabrik[data-tooltip]')];

                if (!blocks.some((block) => block.querySelector('[data-lectiocontextcard^="HE"]'))) {
                    quiet += 1;

                    if (quiet >= 2) break;

                    continue;
                }

                quiet = 0;

                blocks.forEach((block) => {
                    if (isCancelled(block) || !block.querySelector(`[data-lectiocontextcard="${hold.id}"]`)) return;

                    const time = parseTime(block.getAttribute('data-tooltip'));
                    const key = block.getAttribute('href') || block.getAttribute('data-brikid') || '';

                    if (!time || time.date <= periodEnd || seen.has(key)) return;

                    seen.add(key);

                    if (!last || time.date > last) last = time.date;
                });
            }
        } catch (_) {
            waitingCause = null;

            return;
        }

        waitingCause = seen.size
            ? { kind: 'period', more: seen.size, last, end: periodEnd, name: hold.name }
            : { kind: 'timetable', last: lastTarget || periodEnd, name: hold.name };
    }

    function waitingCauseText(text) {
        if (!waitingCause) return '';
        if (waitingCause.kind === 'checking') return text.waitingChecking;

        if (waitingCause.kind === 'period') {
            return fill(text.waitingPeriod, {
                more: waitingCause.more,
                name: waitingCause.name,
                end: dayWithYear(waitingCause.end),
                last: dayWithYear(waitingCause.last)
            });
        }

        return fill(text.waitingTimetable, { name: waitingCause.name, last: dayWithYear(waitingCause.last) });
    }

    // Lectio's own "Rediger forløb" link on this page, where the Periode is set.
    function editPeriodLink(text) {
        const href = document.querySelector('[id$="_editbtn"]')?.getAttribute('href');

        if (!href) return null;

        const link = element('a', 'luc-edit-period', text.editPeriod);

        link.href = href;

        return link;
    }

    function closeDialog() {
        const dialog = document.getElementById(DIALOG_ID);

        if (!dialog) return;

        if (typeof dialog.close === 'function' && dialog.open) dialog.close();

        forgetDialog(dialog);
    }

    function forgetDialog(dialog) {
        if (!dialog.isConnected) return;

        dialog.remove();

        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();

        lastFocus = null;
    }

    function lessonCell(index, text) {
        const lesson = plan.lessons[index];
        const box = element('div', 'luc-lesson');
        const grip = element('span', 'luc-grip', '⠿');
        const body = element('div');

        grip.draggable = true;
        grip.title = text.dragTip;
        grip.setAttribute('aria-hidden', 'true');
        grip.addEventListener('dragstart', (event) => {
            event.dataTransfer.setData('text/plain', DRAG_PREFIX + index);
            event.dataTransfer.effectAllowed = 'move';
        });

        body.append(element('span', 'luc-number', fill(text.lessonNumber, { n: index + 1 })));

        const groups = [
            ['homework', text.kindHomework],
            ['other', text.kindOther],
            ['presentation', text.kindPresentation]
        ];

        if (!lesson.items.length) {
            body.append(document.createTextNode(' '), element('span', 'luc-muted', text.noMaterial));
        }

        groups.forEach(([kind, label]) => {
            const titles = lesson.items.filter((item) => item.kind === kind).map((item) => item.title);

            if (!titles.length) return;

            const line = element('span', 'luc-kind');

            line.dataset.kind = kind;
            line.title = titles.join('\n');
            line.append(element('b', '', `${label}: `), document.createTextNode(titles.join(' · ')));
            body.append(line);
        });

        if (lesson.time) body.append(element('span', 'luc-muted', fill(text.was, { date: dayWithYear(lesson.time.date) })));

        box.append(grip, body);

        return box;
    }

    function render() {
        const dialog = document.getElementById(DIALOG_ID);

        if (!dialog || !plan) return;

        const text = labels();
        const { rows, waiting } = assign();
        const placed = rows.filter((row) => row.lesson !== null).length;
        const total = plan.order.length - plan.leftOut.size;
        const hasContent = rows.filter((row) => row.reason === 'has-content').length;
        const scrollTop = dialog.querySelector('.luc-scroll')?.scrollTop || 0;

        dialog.setAttribute('aria-label', text.title);

        /* Header. */
        const head = element('div', 'luc-head');

        head.append(
            element('h2', '', text.title),
            button(`✕ ${text.close}`, closeDialog),
            element('p', 'luc-subtitle', fill(text.subtitle, subtitleValues()))
        );

        /* What the plan comes to, in a sentence or three. */
        const status = element('div', 'luc-status');

        status.setAttribute('role', 'status');
        status.append(element('strong', '', fill(placed === 1 ? text.placedOne : text.placedMany, { placed, total })));

        if (hasContent) status.append(element('p', '', fill(hasContent === 1 ? text.skippedOne : text.skippedMany, { n: hasContent })));

        const lastTarget = plan.targets[plan.targets.length - 1];

        if (waiting.length && lastTarget) {
            const line = element('p', '', fill(waiting.length === 1 ? text.waitingOne : text.waitingMany, {
                n: waiting.length,
                date: dayWithYear(lastTarget.time.date)
            }));
            const cause = waitingCauseText(text);

            if (cause) line.append(document.createTextNode(` ${cause}`));

            if (waitingCause?.kind === 'period') {
                const link = editPeriodLink(text);

                if (link) line.append(document.createTextNode(' '), link);
            }

            status.append(line);
        }

        /* The timeline. */
        const scroll = element('div', 'luc-scroll');

        if (!plan.targets.length) {
            scroll.append(element('p', 'luc-muted', text.noLessons));
        } else {
            const columns = element('div', 'luc-columns');

            columns.append(element('span', '', text.colYours), element('span', '', text.colGets), element('span'));
            scroll.append(columns);

            const list = element('ol', 'luc-timeline');
            let currentWeek = '';

            rows.forEach((row, targetIndex) => {
                const { week, year } = isoWeek(row.target.time.date);
                const weekKey = `${year}-${week}`;

                if (weekKey !== currentWeek) {
                    currentWeek = weekKey;
                    list.append(element('li', 'luc-week', fill(text.week, { week })));
                }

                const item = element('li', 'luc-row');
                const when = element('div', 'luc-when', dayLabel(row.target.time.date));
                const middle = element('div');
                const actions = element('div', 'luc-actions');

                when.append(element('small', '', `${row.target.time.start}-${row.target.time.end}`));
                item.dataset.target = row.target.id;
                item.dataset.state = row.lesson !== null ? 'placed' : row.reason;

                if (row.lesson !== null) {
                    middle.append(lessonCell(row.lesson, text));
                    actions.append(
                        button(text.skipDay, () => { plan.skip.set(row.target.id, true); changed(); }, '', text.skipDayTip),
                        button(text.leaveOut, () => { plan.leftOut.add(row.lesson); changed(); }, '', text.leaveOutTip)
                    );
                } else if (row.reason === 'has-content') {
                    middle.append(element('span', '', text.hasContent));
                    actions.append(button(text.useAnyway, () => { plan.skip.set(row.target.id, false); changed(); }, '', text.useAnywayTip));
                } else if (row.reason === 'skipped') {
                    middle.append(element('span', '', text.skipped));
                    actions.append(button(text.undo, () => {
                        if (row.target.hasContent) plan.skip.set(row.target.id, true);
                        else plan.skip.delete(row.target.id);
                        changed();
                    }));
                } else {
                    middle.append(element('span', 'luc-muted', text.free));
                }

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

                    if (!Number.isInteger(lessonIndex) || !plan.lessons[lessonIndex]) return;

                    placeAt(lessonIndex, targetIndex);
                    changed();
                });

                item.append(when, middle, actions);
                list.append(item);
            });

            scroll.append(list);
        }

        /* Waiting: last year's lessons this unit has no lesson for yet. */
        if (waiting.length) {
            const horizon = element('section', 'luc-horizon');
            const list = element('ol', 'luc-waiting');

            horizon.append(element('h3', '', fill(text.waitingHeading, { n: waiting.length })));

            const cause = waitingCauseText(text);

            if (cause) horizon.append(element('p', 'luc-muted', cause));

            waiting.forEach((index) => {
                const lesson = plan.lessons[index];
                const titles = lesson.items.map((entry) => entry.title).join(' · ') || text.noMaterial;
                const was = lesson.time ? ` (${fill(text.was, { date: dayWithYear(lesson.time.date) })})` : '';

                list.append(element('li', '', `${fill(text.lessonNumber, { n: index + 1 })}: ${titles}${was}`));
            });

            horizon.append(list);
            scroll.append(horizon);
        }

        /* Left out, out of the way until wanted. */
        if (plan.leftOut.size) {
            const details = element('details');
            const list = element('ol');

            details.append(element('summary', '', fill(text.leftOutHeading, { n: plan.leftOut.size })));

            [...plan.leftOut].sort((a, b) => a - b).forEach((index) => {
                const line = element('li', '', `${fill(text.lessonNumber, { n: index + 1 })} `);

                line.append(button(text.putBack, () => { plan.leftOut.delete(index); changed(); }));
                list.append(line);
            });

            details.append(list);
            details.open = true;
            scroll.append(details);
        }

        /* Footer. */
        const foot = element('div', 'luc-foot');
        const copyButton = button(text.copyPlan, () => copyPlanText(copyButton), 'luc-primary');

        foot.append(
            element('p', 'luc-note', text.planOnly),
            button(text.startOver, () => { plan = newPlan(); changed(); }),
            copyButton
        );

        dialog.replaceChildren(head, status, scroll, foot);
        dialog.querySelector('.luc-scroll').scrollTop = scrollTop;
    }

    // "2025/26": a school year runs August to July. Both units usually
    // share a title, so the years are what tell them apart.
    function schoolYearOf(targetUnit) {
        const first = targetUnit.lessons.find((lesson) => lesson.time)?.time.date;

        if (!first) return '';

        const start = first.getMonth() >= 7 ? first.getFullYear() : first.getFullYear() - 1;

        return `${start}/${String(start + 1).slice(-2)}`;
    }

    function subtitleValues() {
        return { source: source.title, sourceYear: schoolYearOf(source), target: unit.title, targetYear: schoolYearOf(unit) };
    }

    function changed() {
        savePlan();
        render();
    }

    function planText() {
        const text = labels();
        const { rows, waiting } = assign();
        const lines = [fill(text.subtitle, subtitleValues()), ''];

        rows.forEach((row) => {
            const when = `${dayWithYear(row.target.time.date)} ${row.target.time.start}`;

            if (row.lesson === null) {
                lines.push(`${when}\t${row.reason === 'has-content' ? text.hasContent : row.reason === 'skipped' ? text.skipped : text.free}`);
            } else {
                const lesson = plan.lessons[row.lesson];

                lines.push(`${when}\t${fill(text.lessonNumber, { n: row.lesson + 1 })}: ${lesson.items.map((item) => item.title).join(' · ') || text.noMaterial}`);
            }
        });

        if (waiting.length) {
            lines.push('', fill(text.waitingHeading, { n: waiting.length }));
            waiting.forEach((index) => lines.push(`  ${fill(text.lessonNumber, { n: index + 1 })}: ${plan.lessons[index].items.map((item) => item.title).join(' · ') || text.noMaterial}`));
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
                // The plan is still on screen.
            }

            area.remove();
        }

        trigger.textContent = `${labels().copied} ✓`;
    }

    /* ---------------------------------------------------------------- *
     * Lectio's Kopiér form: explain it, check the class, suggest a Periode
     * ---------------------------------------------------------------- */

    function classFields() {
        return {
            box: document.querySelector('[id$="_EntityChooserCtrl_inp"]'),
            stored: document.querySelector('input[type="hidden"][name$="EntityChooserCtrl$inpid"]'),
            start: document.querySelector('[id$="_diCtrl_start__date_tb"]'),
            end: document.querySelector('[id$="_diCtrl_end__date_tb"]')
        };
    }

    async function startCopyForm() {
        const run = ++copyFormRun;
        const fields = classFields();

        if (!fields.box || !fields.stored || !fields.start || !fields.end) {
            reportToManager('drift', 'copy-form', 0);

            return;
        }

        addStyles();

        const text = labels();
        const guide = element('section');
        const steps = element('ol');

        guide.id = GUIDE_ID;
        guide.setAttribute('role', 'note');
        steps.append(element('li', '', text.guideStep1), element('li', '', text.guideStep2), element('li', '', text.guideStep3));
        guide.append(element('h3', '', text.guideTitle), steps, element('p', 'luc-check luc-class'), element('div', 'luc-period'));

        const form = fields.end.closest('table') || fields.end.parentElement;

        form.after(guide);

        const sourceId = new URL(location.href).searchParams.get('fromphaseid');

        if (sourceId) {
            try {
                const url = `/lectio/${schoolId()}/studieplan/forloeb_vis.aspx?phaseid=${encodeURIComponent(sourceId)}`;

                source = readUnit(await fetchDoc(url), url);
            } catch (_) {
                source = null;
            }
        }

        if (run !== copyFormRun || lifecycle.signal.aborted) return;

        clearInterval(classTimer);
        checkClass();
        classTimer = setInterval(checkClass, CLASS_CHECK_MS);
    }

    function contextName(doc) {
        // "Hold - 1i Math AA SL/2 Fag: ..." on a context card.
        const textContent = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();

        return ((textContent.match(/^\S+\s+-\s+(.+?)\s+(Fag|Subject):/) || [])[1] || '').trim();
    }

    async function checkClass() {
        const fields = classFields();
        const guide = document.getElementById(GUIDE_ID);

        if (!guide || !fields.stored) return;

        const storedId = fields.stored.value || '';

        if (storedId === checkedClassId) return;

        checkedClassId = storedId;

        const line = guide.querySelector('.luc-class');
        const period = guide.querySelector('.luc-period');
        const text = labels();

        period.replaceChildren();

        if (!/^HE\d+$/.test(storedId)) {
            line.textContent = text.classNone;
            line.dataset.kind = '';

            return;
        }

        line.textContent = text.classChecking;
        line.dataset.kind = '';

        let name = '';

        try {
            name = contextName(await fetchDoc(`/lectio/${schoolId()}/contextcard/contextcard.aspx?lectiocontextcard=${encodeURIComponent(storedId)}`));
        } catch (_) {
            name = '';
        }

        // A newer choice may have been made while this one was being looked up.
        if (checkedClassId !== storedId || !name) return;

        const shown = (fields.box.value || '').replace(/\s*\(\d{4}\/\d{2}\)\s*$/, '').trim();

        if (shown && shown.toLowerCase() !== name.toLowerCase()) {
            line.textContent = fill(text.classMismatch, { shown, name });
            line.dataset.kind = 'warn';

            return;
        }

        line.textContent = fill(text.classOk, { name });
        line.dataset.kind = 'ok';

        await suggestPeriod(name, storedId);
    }

    /*
     * How long the new unit needs to be. Reads the person's own timetable a
     * few weeks ahead for the chosen class (by the name Lectio confirmed; the
     * chooser's ids and the timetable's are different id spaces), stopping
     * when it has enough lessons or the published timetable runs out.
     */
    async function suggestPeriod(name, storedId) {
        const guide = document.getElementById(GUIDE_ID);
        const period = guide?.querySelector('.luc-period');

        if (!period || !source) return;

        const text = labels();
        const needed = sourceSequence(source).length;
        const found = [];
        const seen = new Set();
        // Lessons of this class per published week. The first week is partial
        // (it starts today) and so is the last one before the published
        // timetable runs out, so the typical week is the most common count,
        // not the average (which read 2 a week for a 3-a-week class).
        const perWeekCounts = [];
        let quietWeeks = 0;

        // Progress while it reads, so the box never sits silent.
        const progress = element('p', 'luc-muted');

        period.replaceChildren(element('p', '', fill(text.periodSource, { count: needed })), progress);

        const today = new Date();

        today.setHours(0, 0, 0, 0);

        // A lesson already under way today is not where a new unit starts.
        const now = new Date();

        try {
            for (let offset = 0; offset < PERIOD_SCAN_WEEKS && found.length < needed; offset += 1) {
                const date = addDays(today, offset * 7);
                const { week, year } = isoWeek(date);

                progress.textContent = fill(text.periodScanning, { name, week });

                const doc = await fetchDoc(`/lectio/${schoolId()}/SkemaNy.aspx?week=${String(week).padStart(2, '0')}${year}&showtype=0`);
                const blocks = [...doc.querySelectorAll('a.s2skemabrik[data-tooltip]')];

                // A week with none of the person's classes in it is past the
                // published timetable (or a holiday): two in a row ends it.
                const anyClass = blocks.some((block) => block.querySelector('[data-lectiocontextcard^="HE"]'));

                if (!anyClass) {
                    quietWeeks += 1;

                    if (quietWeeks >= 2) break;

                    continue;
                }

                quietWeeks = 0;

                let inWeek = 0;

                blocks.forEach((block) => {
                    if (isCancelled(block)) return;

                    const cards = [...block.querySelectorAll('[data-lectiocontextcard^="HE"]')];

                    if (!cards.some((card) => card.textContent.trim().toLowerCase() === name.toLowerCase())) return;

                    const time = parseTime(block.getAttribute('data-tooltip'));
                    const key = block.getAttribute('href') || block.getAttribute('data-brikid') || '';

                    if (!time || seen.has(key)) return;

                    seen.add(key);
                    inWeek += 1;

                    if (time.date >= now) found.push(time.date);
                });

                if (inWeek) perWeekCounts.push(inWeek);
            }
        } catch (_) {
            // Whatever was found is still worth showing.
        }

        if (checkedClassId !== storedId) return;

        progress.remove();
        found.sort((a, b) => a - b);

        if (!found.length) {
            period.append(element('p', '', fill(text.periodNoLessons, { name })));

            return;
        }

        let start = found[0];
        let end;
        let sentence;

        if (found.length >= needed) {
            end = found[needed - 1];
            sentence = fill(text.periodExact, { count: needed });
        } else {
            // The lessons the timetable already shows are exact, holidays
            // included; only the rest, past its last lesson, is estimated.
            const perWeek = typicalWeek(perWeekCounts);
            const last = found[found.length - 1];
            const rest = needed - found.length;
            const weeks = Math.ceil(rest / perWeek);

            end = addDays(last, weeks * 7);
            sentence = fill(text.periodEstimate, {
                name, perWeek, weeks, rest,
                shown: found.length,
                last: dayWithYear(last),
                start: dayWithYear(start),
                end: dayWithYear(end)
            });
        }

        // The answer first, then how it was reached.
        const range = { start: dayWithYear(start), end: dayWithYear(end) };
        const use = button(fill(text.periodUse, range), () => {
            const fields = classFields();

            [[fields.start, start], [fields.end, end]].forEach(([input, date]) => {
                input.value = lectioDate(date);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            });

            note.textContent = text.periodUsed;
        });
        const note = element('p', 'luc-muted');

        period.append(element('p', 'luc-suggested', fill(text.periodSuggested, range)), element('p', '', sentence), use, note);
    }

    // The most common number of lessons in a week; a tie goes to the larger.
    function typicalWeek(counts) {
        const tally = new Map();

        counts.forEach((count) => tally.set(count, (tally.get(count) || 0) + 1));

        const [best] = [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] || [1];

        return Math.max(1, best);
    }

    /* ---------------------------------------------------------------- *
     * Language changes, teardown, start
     * ---------------------------------------------------------------- */

    function relabel() {
        announce();
        renderBanner();
        render();

        if (document.getElementById(GUIDE_ID)) {
            document.getElementById(GUIDE_ID).remove();
            checkedClassId = null;
            clearInterval(classTimer);
            classTimer = 0;
            startCopyForm();
        }
    }

    function teardown() {
        requests.abort();
        lifecycle.abort();
        copyFormRun += 1;
        clearInterval(classTimer);
        classTimer = 0;
        document.getElementById(DIALOG_ID)?.remove();
        document.getElementById(BANNER_ID)?.remove();
        document.getElementById(GUIDE_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
    }

    window.addEventListener('lectio-manager:discover', announce, { signal: lifecycle.signal });
    window.addEventListener('lectio-manager:prune-storage', handlePrune, { signal: lifecycle.signal });
    window.addEventListener('lectio-manager:language', relabel, { signal: lifecycle.signal });

    // Every request here is started by the page loading or by a click, so a
    // frozen page has nothing to resume. A page really going away is torn
    // down (issue #41's pattern).
    window.addEventListener('pagehide', (event) => {
        if (event && event.persisted) return;

        teardown();
    });

    function start() {
        announce();
        prunePlans();

        if (/\/studieplan\/forloeb_kopier\.aspx$/i.test(location.pathname)) {
            startCopyForm();
        } else if (/\/studieplan\/forloeb_vis\.aspx$/i.test(location.pathname)) {
            startUnitPage();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true, signal: lifecycle.signal });
    } else {
        start();
    }
})();
