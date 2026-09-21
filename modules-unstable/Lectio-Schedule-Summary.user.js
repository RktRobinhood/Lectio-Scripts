// ==UserScript==
// @name         Lectio - Schedule Summary
// @namespace    https://www.lectio.dk/
// @version      0.2.5
// @description  Collapses the schedule's week information into a compact, previewable summary strip.
// @match        https://www.lectio.dk/lectio/*/SkemaNy.aspx*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Schedule-Summary.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Schedule-Summary.user.js
// ==/UserScript==

(() => {
    'use strict';

    const MODULE_ID = 'schedule-summary';
    const MODULE_NAME = 'Lectio - Schedule Summary';
    const MODULE_VERSION = '0.2.5';
    const STYLE_ID = 'lectio-schedule-summary-styles';
    const ENHANCED_ATTRIBUTE = 'data-lectio-schedule-summary';
    const SETTINGS_KEY = 'lectioScheduleSummary.settings.v1';
    const STRIP_SIZE_OPTIONS = [
        { value: 'slim', label: 'Slim' },
        { value: 'compact', label: 'Compact' },
        { value: 'comfortable', label: 'Comfortable' }
    ];
    const INITIAL_STATE_OPTIONS = [
        { value: 'collapsed', label: 'Collapsed' },
        { value: 'expanded', label: 'Expanded' }
    ];
    const DEFAULT_SETTINGS = Object.freeze({
        stripSize: 'compact',
        hoverPreview: true,
        initialState: 'collapsed'
    });
    const INFO_ANIMATION_MS = 200;
    const lifecycle = new AbortController();
    let settings = loadSettings();
    let collapseTimeoutId = null;

    function announce() {
        window.dispatchEvent(new CustomEvent('lectio-module:register', {
            detail: {
                id: MODULE_ID,
                name: MODULE_NAME,
                version: MODULE_VERSION,
                settingsSchema: [
                    {
                        key: 'stripSize',
                        type: 'select',
                        label: 'Strip size',
                        section: 'Display',
                        description: 'Choose the height and spacing of the summary strip.',
                        options: STRIP_SIZE_OPTIONS
                    },
                    {
                        key: 'hoverPreview',
                        type: 'toggle',
                        label: 'Hover preview',
                        section: 'Interaction',
                        description: 'Preview week information when pointing at the collapsed strip.'
                    },
                    {
                        key: 'initialState',
                        type: 'select',
                        label: 'Initial state',
                        section: 'Interaction',
                        description: 'Choose whether week information starts collapsed or expanded.',
                        options: INITIAL_STATE_OPTIONS
                    }
                ],
                currentValues: { ...settings },
                /*
                 * What this module keeps in the browser, so the Manager can
                 * show it without knowing what it is (issue #47,
                 * docs/manager-storage-api.md). One key, and it is a setting:
                 * the blob is replaced on every save rather than accumulating,
                 * so there is nothing here to expire, and nothing is offered
                 * up for deletion - a setting never is.
                 */
                storage: [
                    {
                        key: SETTINGS_KEY,
                        kind: 'setting',
                        label: { en: 'Settings', da: 'Indstillinger' }
                    }
                ]
            }
        }));
    }

    /*
     * The Manager asks; the module deletes. Nothing this module declares is
     * prunable, so a request aimed here removes nothing - and a request naming
     * another module's key is not this module's to act on either way. The
     * listener exists so the contract is answered rather than ignored, and so
     * a prunable cache added later has its handler waiting.
     */
    function handlePruneStorage(event) {
        const detail = event?.detail;

        if (detail?.id !== MODULE_ID) return;

        // Nothing declared prunable: deliberately nothing to do.
    }

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
            return {
                stripSize: hasOption(STRIP_SIZE_OPTIONS, saved.stripSize)
                    ? saved.stripSize
                    : DEFAULT_SETTINGS.stripSize,
                hoverPreview: typeof saved.hoverPreview === 'boolean'
                    ? saved.hoverPreview
                    : DEFAULT_SETTINGS.hoverPreview,
                initialState: hasOption(INITIAL_STATE_OPTIONS, saved.initialState)
                    ? saved.initialState
                    : DEFAULT_SETTINGS.initialState
            };
        } catch (_) {
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (_) {
            // Continue with in-memory settings when storage is unavailable -
            // and say so once, so a setting that stops sticking has a cause
            // the person can see in the Manager's problem log
            // (docs/manager-storage-api.md). Nothing listens without a
            // Manager, which is the point.
            if (!saveSettings.reported) {
                saveSettings.reported = true;
                window.dispatchEvent(new CustomEvent('lectio-module:report', {
                    detail: { moduleId: MODULE_ID, kind: 'error', code: 'storage-write' }
                }));
            }
        }
    }

    function hasOption(options, value) {
        return options.some(option => option.value === value);
    }

    function setExpanded(summaryRow, informationRow, expanded, { animate = true } = {}) {
        const toggle = summaryRow?.querySelector('.lectio-schedule-summary__toggle');
        const chevron = summaryRow?.querySelector('.lectio-schedule-summary__chevron');
        if (!summaryRow || !informationRow || !toggle || !chevron) return;

        const localizedLabels = labels();
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute(
            'aria-label',
            `${expanded ? localizedLabels.hide : localizedLabels.show} ${localizedLabels.summary.toLowerCase()}`
        );
        summaryRow.classList.toggle('is-expanded', expanded);
        chevron.textContent = expanded ? '▴' : '▾';

        if (collapseTimeoutId !== null) {
            window.clearTimeout(collapseTimeoutId);
            collapseTimeoutId = null;
        }

        if (!animate) {
            informationRow.hidden = !expanded;
            informationRow.classList.toggle('lectio-schedule-summary__info--visible', expanded);
            return;
        }

        if (expanded) {
            informationRow.hidden = false;
            // Force a reflow so the browser registers the collapsed (0-height)
            // state before the visible class is added, so the height/opacity
            // transition actually plays instead of jumping straight to open.
            void informationRow.offsetHeight;
            informationRow.classList.add('lectio-schedule-summary__info--visible');
        } else {
            informationRow.classList.remove('lectio-schedule-summary__info--visible');
            collapseTimeoutId = window.setTimeout(() => {
                informationRow.hidden = true;
                collapseTimeoutId = null;
            }, INFO_ANIMATION_MS);
        }
    }

    function applyDisplaySettings() {
        const summaryRow = document.querySelector('.lectio-schedule-summary__row');
        if (!summaryRow) return;

        summaryRow.dataset.stripSize = settings.stripSize;
        summaryRow.dataset.hoverPreview = String(settings.hoverPreview);
    }

    function applyInitialState() {
        const informationRow = document.querySelector(`[${ENHANCED_ATTRIBUTE}]`);
        const summaryRow = document.querySelector('.lectio-schedule-summary__row');
        setExpanded(summaryRow, informationRow, settings.initialState === 'expanded', { animate: false });
    }

    function handleSetting(event) {
        const detail = event.detail;
        if (!detail || detail.id !== MODULE_ID) return;

        if (detail.key === 'stripSize' && hasOption(STRIP_SIZE_OPTIONS, detail.value)) {
            settings.stripSize = detail.value;
            applyDisplaySettings();
        } else if (detail.key === 'hoverPreview' && typeof detail.value === 'boolean') {
            settings.hoverPreview = detail.value;
            applyDisplaySettings();
        } else if (detail.key === 'initialState' && hasOption(INITIAL_STATE_OPTIONS, detail.value)) {
            settings.initialState = detail.value;
            applyInitialState();
        } else {
            return;
        }

        saveSettings();
        announce();
    }

    window.addEventListener('lectio-manager:discover', announce, {
        signal: lifecycle.signal
    });
    window.addEventListener('lectio-manager:set-setting', handleSetting, {
        signal: lifecycle.signal
    });
    window.addEventListener('lectio-manager:prune-storage', handlePruneStorage, {
        signal: lifecycle.signal
    });
    // Deliberately not { once: true }, and deliberately split on
    // event.persisted. A page frozen for the back/forward cache fires pagehide
    // with persisted set and may be restored without this script ever running
    // again, so aborting the lifecycle there left a restored page with its
    // summary strip fully painted and completely inert - the toggle dead, the
    // hover preview unable to re-arm, Manager settings ignored and Discovery
    // unanswered, for the rest of that page's life, with no error to show for
    // it. That is issue #45. A frozen page is now left exactly as it is; only
    // a page genuinely going away is torn down.
    //
    // There is no pageshow half here, and that is the point rather than an
    // omission: unlike its siblings this module has nothing running to
    // suspend - no fetch, no poll, no interval, no observer - so a frozen page
    // has nothing to give up and a restored one has nothing to restart. Its
    // whole runtime is the five lifecycle-scoped listeners above and below
    // (Discovery, set-setting, prune-storage, the toggle's click, the strip's
    // mouseleave), and not aborting them is the entire resume. A pageshow handler would
    // only exist to need a guard against reviving a page that had already
    // gone. If background work is ever added here, it wants suspend/resume and
    // the pageshow half that goes with it - see the skeleton in templates/.
    //
    // One registration, at module scope, so it cannot accumulate: a bfcache
    // restore does not re-execute the script, and a real navigation discards
    // the page along with the listener. lifecycle.abort() is idempotent, so a
    // persisted pagehide followed later by a terminal one still tears down
    // exactly once.
    window.addEventListener('pagehide', (event) => {
        if (event && event.persisted) return;

        lifecycle.abort();
    });
    announce();

    function labels() {
        // Language, in order of authority: the Manager's published choice, then
        // whatever Lectio (or English Mode) has put on <html lang>, then Danish -
        // Lectio is a Danish system, so a module running on its own stays Danish.
        const preferred = document.documentElement?.dataset?.lectioLanguage;
        const language = (preferred || document.documentElement.lang || 'da').toLowerCase();
        const english = language.startsWith('en');

        return english
            ? {
                summary: 'Week information',
                compactSummary: 'Info',
                show: 'Show',
                hide: 'Hide',
                oneDay: '1 day',
                manyDays: count => `${count} days`,
                fallbackDay: index => `Day ${index}`
            }
            : {
                summary: 'Ugeinformation',
                compactSummary: 'Info',
                show: 'Vis',
                hide: 'Skjul',
                oneDay: '1 dag',
                manyDays: count => `${count} dage`,
                fallbackDay: index => `Dag ${index}`
            };
    }

    function normalizedText(element) {
        const clone = element.cloneNode(true);
        clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));

        return (clone.textContent || '')
            .split('\n')
            .map(line => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join('\n');
    }

    function findInformationRow() {
        const cells = [...document.querySelectorAll(
            'td.s2infoHeader.s2skemabrikcontainer'
        )];

        const rows = [...new Set(cells.map(cell => cell.closest('tr')).filter(Boolean))];
        return rows.find(row => normalizedText(row)) || null;
    }

    function findDayHeaderRow(informationRow) {
        const table = informationRow.closest('table');
        return table?.querySelector('tr.s2dayHeader') || null;
    }

    function ensureInformationRowId(informationRow) {
        if (!informationRow.id) {
            informationRow.id = 'lectio-schedule-summary-information';
        }
        return informationRow.id;
    }

    function cloneCellContents(cell) {
        const content = document.createElement('div');
        content.className = 'lectio-schedule-summary__tooltip-content';

        [...cell.childNodes].forEach(node => {
            content.appendChild(node.cloneNode(true));
        });
        content.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));

        return content;
    }

    function buildTooltip(informationRow, dayHeaderRow, localizedLabels) {
        const tooltip = document.createElement('div');
        tooltip.className = 'lectio-schedule-summary__tooltip';
        tooltip.id = 'lectio-schedule-summary-tooltip';
        tooltip.setAttribute('role', 'tooltip');

        const informationCells = [...informationRow.cells];
        const dayCells = dayHeaderRow ? [...dayHeaderRow.cells] : [];

        informationCells.forEach((cell, index) => {
            const text = normalizedText(cell);
            if (!text) return;

            const section = document.createElement('section');
            const heading = document.createElement('strong');
            const content = cloneCellContents(cell);
            const dayName = normalizedText(dayCells[index]) || localizedLabels.fallbackDay(index);

            heading.textContent = dayName;
            section.append(heading, content);
            tooltip.appendChild(section);
        });

        return tooltip;
    }

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .lectio-schedule-summary__cell {
                position: relative;
                padding: 0 !important;
                background: color-mix(in srgb, var(--lectio-theme-surface-alt, #eef1f2) 42%, transparent);
                color: var(--lectio-theme-muted, #5e6870);
            }

            .lectio-schedule-summary__toggle {
                align-items: center;
                background: color-mix(in srgb, var(--lectio-theme-surface-alt, #eef1f2) 22%, transparent);
                border: 1px solid color-mix(in srgb, var(--lectio-theme-muted, #d6dde0) 48%, transparent);
                border-radius: max(3px, calc(var(--lectio-theme-radius, 10px) / 2));
                color: var(--lectio-theme-muted, #5e6870);
                cursor: pointer;
                display: flex;
                font: 400 10.5px/1.1 Roboto, Arial, sans-serif;
                gap: 4px;
                justify-content: center;
                min-height: 22px;
                padding: 2px 8px;
                width: 100%;
            }

            .lectio-schedule-summary__row[data-strip-size="slim"] .lectio-schedule-summary__toggle {
                font-size: 10px;
                min-height: 18px;
                padding: 1px 6px;
            }

            .lectio-schedule-summary__row[data-strip-size="comfortable"] .lectio-schedule-summary__toggle {
                font-size: 12px;
                min-height: 36px;
                padding: 7px 10px;
            }

            @media (pointer: coarse) {
                .lectio-schedule-summary__row[data-strip-size="slim"] .lectio-schedule-summary__toggle {
                    min-height: 24px;
                }

                .lectio-schedule-summary__row[data-strip-size="compact"] .lectio-schedule-summary__toggle {
                    min-height: 32px;
                }

                .lectio-schedule-summary__row[data-strip-size="comfortable"] .lectio-schedule-summary__toggle {
                    min-height: 44px;
                }
            }

            .lectio-schedule-summary__toggle:hover,
            .lectio-schedule-summary__toggle:focus-visible {
                background: color-mix(in srgb, var(--lectio-theme-surface, #ffffff) 58%, transparent);
                border-color: color-mix(in srgb, var(--lectio-theme-accent, #0f6f6f) 38%, var(--lectio-theme-muted, #d6dde0));
                color: var(--lectio-theme-text, #10201e);
                outline: none;
            }

            .lectio-schedule-summary__chevron {
                color: var(--lectio-theme-muted, #5e6870);
                font-size: 10px;
                line-height: 1;
            }

            .lectio-schedule-summary__tooltip {
                background: var(--lectio-theme-surface, #ffffff);
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
                border-radius: max(4px, var(--lectio-theme-radius, 10px));
                box-shadow: 0 10px 28px color-mix(in srgb, var(--lectio-theme-muted, #5e6870) 28%, transparent);
                color: var(--lectio-theme-text, #10201e);
                display: grid;
                font-size: 80%;
                gap: 10px;
                grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                left: 0;
                line-height: 1.2;
                opacity: 0;
                padding: 10px;
                pointer-events: none;
                position: absolute;
                right: 0;
                text-align: left;
                top: calc(100% + 4px);
                transform: translateY(-4px);
                transition: opacity 140ms ease, transform 140ms ease;
                z-index: 1000;
            }

            .lectio-schedule-summary__row[data-hover-preview="true"][data-hover-armed="true"]:not(.is-expanded):hover .lectio-schedule-summary__tooltip,
            .lectio-schedule-summary__row:not(.is-expanded) .lectio-schedule-summary__toggle:focus-visible + .lectio-schedule-summary__tooltip {
                opacity: 1;
                pointer-events: auto;
                transform: translateY(0);
            }

            .lectio-schedule-summary__tooltip section {
                min-width: 0;
            }

            .lectio-schedule-summary__tooltip section > strong,
            .lectio-schedule-summary__tooltip-content {
                display: block;
            }

            .lectio-schedule-summary__tooltip strong {
                color: var(--lectio-theme-accent, #0f6f6f);
                margin-bottom: 3px;
            }

            .lectio-schedule-summary__tooltip-content {
                color: var(--lectio-theme-text, #10201e);
                font-weight: 400;
                white-space: pre-line;
            }

            .lectio-schedule-summary__tooltip-content a {
                color: var(--lectio-theme-accent, #0f6f6f);
            }

            @media (max-width: 700px) {
                .lectio-schedule-summary__tooltip {
                    max-height: 60vh;
                    overflow: auto;
                }
            }

            tr[${ENHANCED_ATTRIBUTE}] > td {
                interpolate-size: allow-keywords;
                height: 0;
                opacity: 0;
                overflow: hidden;
                transition: height ${INFO_ANIMATION_MS}ms ease, opacity ${INFO_ANIMATION_MS}ms ease;
            }

            tr[${ENHANCED_ATTRIBUTE}].lectio-schedule-summary__info--visible > td {
                height: auto;
                opacity: 1;
            }

            @media (prefers-reduced-motion: reduce) {
                .lectio-schedule-summary__tooltip,
                tr[${ENHANCED_ATTRIBUTE}] > td {
                    transition: none;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function enhanceSchedule() {
        const informationRow = findInformationRow();
        if (!informationRow || informationRow.hasAttribute(ENHANCED_ATTRIBUTE)) return;

        const localizedLabels = labels();
        const dayHeaderRow = findDayHeaderRow(informationRow);
        const populatedDays = [...informationRow.cells]
            .filter(cell => normalizedText(cell)).length;
        const dayCount = populatedDays === 1
            ? localizedLabels.oneDay
            : localizedLabels.manyDays(populatedDays);

        const summaryRow = document.createElement('tr');
        const summaryCell = document.createElement('td');
        const toggle = document.createElement('button');
        const label = document.createElement('span');
        const chevron = document.createElement('span');
        const tooltip = buildTooltip(informationRow, dayHeaderRow, localizedLabels);
        const informationRowId = ensureInformationRowId(informationRow);

        summaryRow.className = 'lectio-schedule-summary__row';
        summaryCell.className = 'lectio-schedule-summary__cell';
        summaryCell.colSpan = Math.max(1, informationRow.cells.length);
        toggle.className = 'lectio-schedule-summary__toggle';
        toggle.type = 'button';
        toggle.setAttribute('aria-controls', informationRowId);
        toggle.setAttribute('aria-describedby', tooltip.id);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', `${localizedLabels.show} ${localizedLabels.summary.toLowerCase()}`);
        label.textContent = `${localizedLabels.compactSummary} · ${dayCount}`;
        chevron.className = 'lectio-schedule-summary__chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = '▾';

        toggle.append(label, chevron);
        summaryCell.append(toggle, tooltip);
        summaryRow.appendChild(summaryCell);
        informationRow.parentNode.insertBefore(summaryRow, informationRow);
        informationRow.setAttribute(ENHANCED_ATTRIBUTE, 'true');
        summaryRow.dataset.hoverArmed = 'true';
        applyDisplaySettings();
        setExpanded(summaryRow, informationRow, settings.initialState === 'expanded', { animate: false });

        toggle.addEventListener('click', () => {
            const expanded = toggle.getAttribute('aria-expanded') === 'true';
            const nextExpanded = !expanded;
            // Disarm the hover preview on close so it doesn't pop back up
            // while the pointer is still resting on the toggle; re-armed
            // below once the pointer actually leaves and comes back.
            summaryRow.dataset.hoverArmed = String(nextExpanded);
            setExpanded(summaryRow, informationRow, nextExpanded);
        }, { signal: lifecycle.signal });

        summaryRow.addEventListener('mouseleave', () => {
            summaryRow.dataset.hoverArmed = 'true';
        }, { signal: lifecycle.signal });
    }

    addStyles();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', enhanceSchedule, {
            once: true,
            signal: lifecycle.signal
        });
    } else {
        enhanceSchedule();
    }
})();
