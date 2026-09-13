// ==UserScript==
// @name         Lectio - Schedule Summary
// @namespace    https://www.lectio.dk/
// @version      0.1.0
// @description  Collapses the schedule's week information into a compact, previewable summary strip.
// @match        https://www.lectio.dk/lectio/*/SkemaNy.aspx*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-Schedule-Summary.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-Schedule-Summary.user.js
// ==/UserScript==

(() => {
    'use strict';

    const MODULE_ID = 'schedule-summary';
    const MODULE_NAME = 'Lectio - Schedule Summary';
    const MODULE_VERSION = '0.1.0';
    const STYLE_ID = 'lectio-schedule-summary-styles';
    const ENHANCED_ATTRIBUTE = 'data-lectio-schedule-summary';
    const lifecycle = new AbortController();

    function announce() {
        window.dispatchEvent(new CustomEvent('lectio-module:register', {
            detail: {
                id: MODULE_ID,
                name: MODULE_NAME,
                version: MODULE_VERSION,
                settingsSchema: [],
                currentValues: {}
            }
        }));
    }

    window.addEventListener('lectio-manager:discover', announce, {
        signal: lifecycle.signal
    });
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
    announce();

    function labels() {
        const language = (document.documentElement.lang || '').toLowerCase();
        const english = language.startsWith('en');

        return english
            ? {
                summary: 'Week information',
                show: 'Show',
                hide: 'Hide',
                oneDay: '1 day',
                manyDays: count => `${count} days`,
                fallbackDay: index => `Day ${index}`
            }
            : {
                summary: 'Ugeinformation',
                show: 'Vis',
                hide: 'Skjul',
                oneDay: '1 dag',
                manyDays: count => `${count} dage`,
                fallbackDay: index => `Dag ${index}`
            };
    }

    function normalizedText(element) {
        const copy = element.cloneNode(true);
        copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'));

        return (copy.textContent || '')
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

    function ensureId(element, suffix) {
        if (!element.id) {
            element.id = `lectio-schedule-summary-${suffix}`;
        }
        return element.id;
    }

    function buildTooltip(informationRow, dayHeaderRow, copy) {
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
            const content = document.createElement('span');
            const dayName = normalizedText(dayCells[index]) || copy.fallbackDay(index);

            heading.textContent = dayName;
            content.textContent = text;
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
                background: var(--lectio-theme-surface-alt, #eef1f2);
                color: var(--lectio-theme-text, #10201e);
            }

            .lectio-schedule-summary__toggle {
                align-items: center;
                background: transparent;
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
                border-radius: max(4px, var(--lectio-theme-radius, 10px));
                color: var(--lectio-theme-text, #10201e);
                cursor: pointer;
                display: flex;
                font: 600 12px/1.2 Roboto, Arial, sans-serif;
                gap: 7px;
                justify-content: center;
                min-height: 30px;
                padding: 5px 12px;
                width: 100%;
            }

            .lectio-schedule-summary__toggle:hover,
            .lectio-schedule-summary__toggle:focus-visible {
                background: var(--lectio-theme-surface, #ffffff);
                border-color: var(--lectio-theme-accent, #0f6f6f);
                outline: none;
            }

            .lectio-schedule-summary__chevron {
                color: var(--lectio-theme-accent, #0f6f6f);
                font-size: 15px;
                line-height: 1;
            }

            .lectio-schedule-summary__tooltip {
                background: var(--lectio-theme-surface, #ffffff);
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
                border-radius: max(4px, var(--lectio-theme-radius, 10px));
                box-shadow: 0 10px 28px color-mix(in srgb, var(--lectio-theme-muted, #5e6870) 28%, transparent);
                color: var(--lectio-theme-text, #10201e);
                display: none;
                gap: 12px;
                left: 0;
                padding: 12px;
                position: absolute;
                right: 0;
                text-align: left;
                top: calc(100% + 4px);
                z-index: 1000;
            }

            .lectio-schedule-summary__row:not(.is-expanded):hover .lectio-schedule-summary__tooltip,
            .lectio-schedule-summary__row:not(.is-expanded):focus-within .lectio-schedule-summary__tooltip {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            }

            .lectio-schedule-summary__tooltip section {
                min-width: 0;
            }

            .lectio-schedule-summary__tooltip strong,
            .lectio-schedule-summary__tooltip span {
                display: block;
            }

            .lectio-schedule-summary__tooltip strong {
                color: var(--lectio-theme-accent, #0f6f6f);
                margin-bottom: 4px;
            }

            .lectio-schedule-summary__tooltip span {
                color: var(--lectio-theme-text, #10201e);
                font-weight: 400;
                white-space: pre-line;
            }

            @media (max-width: 700px) {
                .lectio-schedule-summary__tooltip {
                    max-height: 60vh;
                    overflow: auto;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function enhanceSchedule() {
        const informationRow = findInformationRow();
        if (!informationRow || informationRow.hasAttribute(ENHANCED_ATTRIBUTE)) return;

        const copy = labels();
        const dayHeaderRow = findDayHeaderRow(informationRow);
        const populatedDays = [...informationRow.cells]
            .filter(cell => normalizedText(cell)).length;
        const dayCount = populatedDays === 1
            ? copy.oneDay
            : copy.manyDays(populatedDays);

        const summaryRow = document.createElement('tr');
        const summaryCell = document.createElement('td');
        const toggle = document.createElement('button');
        const label = document.createElement('span');
        const chevron = document.createElement('span');
        const tooltip = buildTooltip(informationRow, dayHeaderRow, copy);
        const informationRowId = ensureId(informationRow, 'information');

        summaryRow.className = 'lectio-schedule-summary__row';
        summaryCell.className = 'lectio-schedule-summary__cell';
        summaryCell.colSpan = Math.max(1, informationRow.cells.length);
        toggle.className = 'lectio-schedule-summary__toggle';
        toggle.type = 'button';
        toggle.setAttribute('aria-controls', informationRowId);
        toggle.setAttribute('aria-describedby', tooltip.id);
        toggle.setAttribute('aria-expanded', 'false');
        label.textContent = `${copy.summary} · ${dayCount} · ${copy.show}`;
        chevron.className = 'lectio-schedule-summary__chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = '▾';

        toggle.append(label, chevron);
        summaryCell.append(toggle, tooltip);
        summaryRow.appendChild(summaryCell);
        informationRow.parentNode.insertBefore(summaryRow, informationRow);
        informationRow.hidden = true;
        informationRow.setAttribute(ENHANCED_ATTRIBUTE, 'true');

        toggle.addEventListener('click', () => {
            const expanded = toggle.getAttribute('aria-expanded') === 'true';
            const nextExpanded = !expanded;

            toggle.setAttribute('aria-expanded', String(nextExpanded));
            informationRow.hidden = !nextExpanded;
            summaryRow.classList.toggle('is-expanded', nextExpanded);
            label.textContent = nextExpanded
                ? `${copy.summary} · ${copy.hide}`
                : `${copy.summary} · ${dayCount} · ${copy.show}`;
            chevron.textContent = nextExpanded ? '▴' : '▾';
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
