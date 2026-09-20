// ==UserScript==
// @name         Lectio - Module Skeleton
// @namespace    https://github.com/RktRobinhood/Lectio-Scripts
// @version      0.3.0
// @description  A complete, do-nothing module you copy to start a new one. Registers, renders one control of every type, themes itself, speaks both languages, and tears down cleanly.
// @author       RktRobinhood
// @match        https://www.lectio.dk/lectio/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/RktRobinhood/Lectio-Scripts
// @supportURL   https://github.com/RktRobinhood/Lectio-Scripts/issues
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/templates/Lectio-Module-Skeleton.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/templates/Lectio-Module-Skeleton.user.js
// ==/UserScript==

/*
 * THIS IS A COPY-ME STARTING POINT, NOT A DEPENDENCY.
 *
 * Copy this file to modules-unstable/<Your-Module>.user.js, rename it, and
 * delete the parts you do not need. Nothing imports it, nothing loads it, and
 * nothing at runtime should ever reference it. It is in neither catalogue and
 * is not a shippable module.
 *
 * Do not turn it into a library. Every module in this repository contains its
 * own complete logic and must run correctly copy-pasted alone into
 * Tampermonkey - that is the no-shared-runtime-code invariant in ADR-0001, and
 * "but it's only the skeleton" is exactly how a repository loses it.
 *
 * What it demonstrates, and where the rules live:
 *   - Discovery handshake, on load and on request        ADR-0002
 *   - One setting of every control type the Manager renders
 *   - Colours through the --lectio-theme-* seam           ADR-0006
 *   - Optional dock item that fails quietly alone         ADR-0012
 *   - Selector-drift reporting to the Manager             docs/manager-problem-log.md
 *   - Declaring what it stores, and pruning on request    docs/manager-storage-api.md
 *   - Both languages inline, Danish by default            ADR-0013
 *   - Teardown of every listener, timer and DOM insertion
 *
 * It deliberately does nothing to Lectio: it never reads, styles or modifies
 * anything Lectio rendered. Your feature goes where the TODO markers are.
 *
 * templates/README.md has the checklist a skeleton cannot enforce for you -
 * the Experimental-first release path and the four places a version lives.
 */

(() => {
    'use strict';

    // All three of these must move together with catalogue/modules.json (or
    // modules-unstable/modules.json) whenever the file changes. See the README
    // next to this file; `node scripts/check-versions.mjs` enforces it.
    const MODULE_ID = 'module-skeleton';
    const MODULE_NAME = 'Lectio - Module Skeleton';
    const MODULE_VERSION = '0.3.0';

    const STYLE_ID = 'lectio-module-skeleton-styles';
    const SETTINGS_KEY = 'lectioModuleSkeleton.settings.v1';

    const ACCENT_OPTIONS = [
        { value: 'teal', label: 'Teal' },
        { value: 'blue', label: 'Blue' },
        { value: 'plum', label: 'Plum' }
    ];

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        accent: 'teal',
        scale: 100,
        note: '',
        tint: '#0f6f6f',
        reset: false // A button carries no stored value; it only ever arrives as an event.
    });

    // One controller for every listener the module adds, so teardown is a
    // single abort() rather than a list of removeEventListener calls that
    // drifts out of step with the list of addEventListener calls.
    const lifecycle = new AbortController();

    let settings = loadSettings();
    let preview = null;        // The option currently being hovered in the Manager, never persisted.
    let dockMount = null;      // The Manager's disposable flyout mount, valid only while connected.
    let exampleTimer = 0;
    let suspended = false;   // True while the page is frozen for the back/forward cache.

    /* ---------------------------------------------------------------- *
     * Discovery (ADR-0002)
     *
     * The Manager broadcasts lectio-manager:discover; every module answers
     * for itself. Answer on load too - the Manager may already have asked
     * before this module was injected.
     * ---------------------------------------------------------------- */

    function announce() {
        const text = labels();

        window.dispatchEvent(new CustomEvent('lectio-module:register', {
            detail: {
                id: MODULE_ID,
                name: MODULE_NAME,
                version: MODULE_VERSION,
                // One of each control type the Manager actually renders:
                // toggle, select, range, text, color, button. A Manager too old
                // to know a type skips that row instead of failing, so adding
                // one is always safe.
                settingsSchema: [
                    {
                        key: 'enabled',
                        type: 'toggle',
                        label: text.enabledLabel,
                        section: text.sectionMain,
                        // A description is rendered behind a click-to-reveal
                        // info toggle, so explain the setting properly here
                        // rather than cramming it into the label.
                        description: text.enabledHelp
                    },
                    {
                        key: 'accent',
                        type: 'select',
                        label: text.accentLabel,
                        section: text.sectionMain,
                        description: text.accentHelp,
                        // The Manager emits lectio-manager:preview-setting while
                        // an option is hovered or focused, and
                        // lectio-manager:clear-setting-preview when the preview
                        // ends. Apply a preview; never save one.
                        previewOnHover: true,
                        options: ACCENT_OPTIONS
                    },
                    {
                        key: 'scale',
                        type: 'range',
                        label: text.scaleLabel,
                        section: text.sectionMain,
                        description: text.scaleHelp,
                        min: 50,
                        max: 150,
                        step: 10,
                        suffix: '%'
                    },
                    {
                        key: 'note',
                        type: 'text',
                        label: text.noteLabel,
                        section: text.sectionMain,
                        description: text.noteHelp
                    },
                    // When every control in a section is advanced, the Manager
                    // renders the whole section collapsed behind a click - for
                    // settings a built-in default already covers.
                    {
                        key: 'tint',
                        type: 'color',
                        label: text.tintLabel,
                        section: text.sectionAdvanced,
                        description: text.tintHelp,
                        advanced: true
                    },
                    {
                        key: 'reset',
                        type: 'button',
                        label: text.resetLabel,
                        section: text.sectionAdvanced,
                        description: text.resetHelp,
                        buttonLabel: text.resetButton,
                        advanced: true
                    }
                ],
                currentValues: { ...settings },
                /*
                 * What this module keeps in the browser. Optional, and
                 * rendered by the Manager without it understanding any of it:
                 * the Manager measures localStorage and takes which keys are
                 * whose, and which are safe to throw away, from here.
                 *
                 * `kind` is cache | setting | state, `area` is page
                 * (localStorage, the default) or script (GM storage, which
                 * the Manager cannot see or measure), and `prunable: true`
                 * puts a Clear button beside the row. Only ever mark
                 * something prunable that this module can rebuild - a
                 * settings blob never is. Exactly one of `key` and `prefix`.
                 *
                 * See docs/manager-storage-api.md.
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
     * The Manager asks; the module deletes. The Manager never removes a key
     * itself, so a request this ignores leaves everything exactly as it was.
     * Match on the id and on the entry as declared, and nothing else.
     */
    function handlePruneStorage(event) {
        const detail = event?.detail;

        if (detail?.id !== MODULE_ID) return;

        // Nothing here is declared prunable, so there is nothing to do. A
        // module with a cache would compare detail.key or detail.prefix
        // against what it declared and remove exactly that.
    }

    /* ---------------------------------------------------------------- *
     * Settings
     * ---------------------------------------------------------------- */

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');

            // Validate every value on the way in. Storage is user-editable and
            // survives a schema change, so never trust what comes back.
            return {
                ...DEFAULT_SETTINGS,
                enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_SETTINGS.enabled,
                accent: isAccent(saved.accent) ? saved.accent : DEFAULT_SETTINGS.accent,
                scale: isScale(saved.scale) ? saved.scale : DEFAULT_SETTINGS.scale,
                note: typeof saved.note === 'string' ? saved.note.slice(0, 120) : DEFAULT_SETTINGS.note,
                tint: isHexColour(saved.tint) ? saved.tint.toLowerCase() : DEFAULT_SETTINGS.tint
            };
        } catch (_) {
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (_) {
            // Private browsing, a full quota, or storage switched off. Carry on
            // with the in-memory copy rather than throwing on a Lectio page -
            // and say so once, so a setting that stops sticking has a cause
            // the user can see. See docs/manager-problem-log.md.
            if (!saveSettings.reported) {
                saveSettings.reported = true;
                window.dispatchEvent(new CustomEvent('lectio-module:report', {
                    detail: { moduleId: MODULE_ID, kind: 'error', code: 'storage-write' }
                }));
            }
        }
    }

    const isAccent = (value) => ACCENT_OPTIONS.some((option) => option.value === value);
    const isScale = (value) => Number.isFinite(Number(value)) && Number(value) >= 50 && Number(value) <= 150;
    const isHexColour = (value) => /^#[0-9a-f]{6}$/i.test(String(value ?? ''));

    function handleSetting(event) {
        const detail = event.detail;
        if (!detail || detail.id !== MODULE_ID) return;

        switch (detail.key) {
            case 'enabled':
                if (typeof detail.value !== 'boolean') return;
                settings.enabled = detail.value;
                break;
            case 'accent':
                if (!isAccent(detail.value)) return;
                settings.accent = detail.value;
                break;
            case 'scale':
                // A range reports a string; store the number.
                if (!isScale(detail.value)) return;
                settings.scale = Number(detail.value);
                break;
            case 'note':
                if (typeof detail.value !== 'string') return;
                settings.note = detail.value.slice(0, 120);
                break;
            case 'tint':
                if (!isHexColour(detail.value)) return;
                settings.tint = String(detail.value).toLowerCase();
                break;
            case 'reset':
                // A button arrives as value: true and stores nothing of its own.
                settings = { ...DEFAULT_SETTINGS };
                break;
            default:
                return;
        }

        saveSettings();
        apply();
        // Re-announce so the Manager's panel shows the values that were
        // actually accepted, not the ones it sent.
        announce();
    }

    function handlePreview(event) {
        const detail = event.detail;
        if (!detail || detail.id !== MODULE_ID || detail.key !== 'accent') return;
        if (!isAccent(detail.value)) return;

        preview = detail.value;
        apply();
    }

    function handleClearPreview(event) {
        const detail = event.detail;
        if (!detail || detail.id !== MODULE_ID || detail.key !== 'accent') return;

        preview = null;
        apply();
    }

    /* ---------------------------------------------------------------- *
     * Language (ADR-0013)
     *
     * Both languages inline in this one file - there is no -EN/-DA pair and
     * nothing fetched at runtime. Order of authority: the Manager's published
     * choice, then whatever Lectio (or English Mode) put on <html lang>, then
     * Danish, because Lectio is Danish and a module on its own stays Danish.
     * ---------------------------------------------------------------- */

    function labels() {
        const preferred = document.documentElement?.dataset?.lectioLanguage;
        const language = (preferred || document.documentElement.lang || 'da').toLowerCase();

        return language.startsWith('en')
            ? {
                sectionMain: 'Skeleton',
                sectionAdvanced: 'Advanced',
                enabledLabel: 'Enabled',
                enabledHelp: 'Switch this module off without uninstalling it.',
                accentLabel: 'Accent colour',
                accentHelp: 'Hover an option to preview it, then choose it to keep it.',
                scaleLabel: 'Size',
                scaleHelp: 'How large this module draws its own interface.',
                noteLabel: 'Note',
                noteHelp: 'A short free-text example. Anything typed here is kept in this browser only.',
                tintLabel: 'Custom tint',
                tintHelp: 'A hand-picked colour, for the rare case the built-in accents do not fit.',
                resetLabel: 'Reset settings',
                resetHelp: 'Put every setting in this module back to its default.',
                resetButton: 'Reset',
                panelTitle: 'Module skeleton',
                panelBody: 'Nothing to see - this is a starting point, not a feature.'
            }
            : {
                sectionMain: 'Skabelon',
                sectionAdvanced: 'Avanceret',
                enabledLabel: 'Slået til',
                enabledHelp: 'Slå modulet fra uden at afinstallere det.',
                accentLabel: 'Accentfarve',
                accentHelp: 'Hold musen over en mulighed for at se den, og vælg den for at beholde den.',
                scaleLabel: 'Størrelse',
                scaleHelp: 'Hvor stort modulet tegner sin egen grænseflade.',
                noteLabel: 'Note',
                noteHelp: 'Et kort eksempel på fritekst. Det, du skriver her, bliver kun i denne browser.',
                tintLabel: 'Egen farve',
                tintHelp: 'En håndvalgt farve, hvis de indbyggede accenter ikke passer.',
                resetLabel: 'Nulstil indstillinger',
                resetHelp: 'Sæt alle modulets indstillinger tilbage til standard.',
                resetButton: 'Nulstil',
                panelTitle: 'Modulskabelon',
                panelBody: 'Ikke noget at se - det her er et udgangspunkt, ikke en funktion.'
            };
    }

    /* ---------------------------------------------------------------- *
     * Presentation (ADR-0006)
     *
     * Every colour goes through var(--lectio-theme-*, <this module's own
     * value>). Lectio Theming can then recolour the module without either
     * module knowing about the other, and with Theming absent the fallback is
     * exactly the colour the module would have hard-coded anyway.
     *
     * These rules only ever match this module's own classes. Nothing Lectio
     * rendered is selected, read or restyled.
     * ---------------------------------------------------------------- */

    const ACCENT_VARIABLE = {
        teal: 'var(--lectio-theme-accent, #0f6f6f)',
        blue: 'var(--lectio-theme-accent-alt, #35658c)',
        plum: 'var(--lectio-theme-accent-alt, #7b4b78)'
    };

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .lectio-module-skeleton {
                background: var(--lectio-theme-surface, #ffffff);
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
                border-radius: var(--lectio-theme-radius, 10px);
                color: var(--lectio-theme-text, #10201e);
                display: block;
                font: 400 13px/1.4 Roboto, Arial, sans-serif;
                min-width: 180px;
                padding: 10px 12px;
            }

            .lectio-module-skeleton strong {
                color: var(--lectio-module-skeleton-accent, var(--lectio-theme-accent, #0f6f6f));
                display: block;
                margin-bottom: 4px;
            }

            .lectio-module-skeleton p {
                color: var(--lectio-theme-muted, #5e6870);
                margin: 0;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function apply() {
        // A preview is the hovered option, not the saved one, and is dropped
        // again the moment the Manager clears it.
        const accent = preview || settings.accent;

        document.documentElement.style.setProperty(
            '--lectio-module-skeleton-accent',
            settings.tint !== DEFAULT_SETTINGS.tint ? settings.tint : ACCENT_VARIABLE[accent]
        );

        // TODO: your feature goes here. Read what you need off the page,
        // render your own elements, and respect settings.enabled.

        // Lectio can move anything at any time, and a selector that quietly
        // matches nothing looks exactly like a quiet day. Say so instead - but
        // only from a page that really should have had some, or "found none" is
        // noise rather than a signal.
        if (/\/SkemaNy\.aspx$/i.test(location.pathname)) {
            const blocks = document.querySelectorAll('a.s2skemabrik[data-tooltip]');
            if (!blocks.length) reportToManager('drift', 'lesson-blocks', 0);
        }

        renderDockPanel();
        registerDockItem();
    }

    /* ---------------------------------------------------------------- *
     * Reporting to the Manager (docs/manager-problem-log.md)
     *
     * One event, one direction, no reply: with no Manager installed this
     * lands on a window nobody is listening to, which is a no-op - the same
     * "fails quietly" the dock section relies on.
     *
     * `code` is a token you wrote, never a string you read off the page. The
     * Manager drops anything with a space in it, and there is deliberately no
     * field for a message: this log gets pasted into a public repository, and
     * a parser that fails is usually holding a name, a message subject or a
     * hold at the time.
     * ---------------------------------------------------------------- */

    function reportToManager(kind, code, found) {
        window.dispatchEvent(new CustomEvent('lectio-module:report', {
            detail: { moduleId: MODULE_ID, kind, code, found }
        }));
    }

    /* ---------------------------------------------------------------- *
     * Dock (ADR-0012)
     *
     * The Manager owns the dock: placement, icon size, ordering, flyout
     * chrome. A module sends semantic data and nothing else. With no Manager
     * installed these dispatches land on a window nobody is listening to,
     * which is a no-op - that is the whole of "fails quietly".
     *
     * Delete this section if your module has no global control to offer.
     * ---------------------------------------------------------------- */

    function registerDockItem() {
        if (!settings.enabled) {
            removeDockItem();
            return;
        }

        const text = labels();

        window.dispatchEvent(new CustomEvent('lectio-manager:dock:register', {
            detail: {
                moduleId: MODULE_ID,
                itemId: 'main',
                type: 'panel',            // action | toggle | panel | status
                icon: 'info',             // A bundled key; an unknown one gets a safe fallback.
                label: text.panelTitle,   // An accessible name, not an identifier.
                tooltip: text.panelTitle,
                state: 'default',
                defaultPriority: 100
            }
        }));
    }

    function removeDockItem() {
        dockMount = null;
        window.dispatchEvent(new CustomEvent('lectio-manager:dock:remove', {
            detail: { moduleId: MODULE_ID, itemId: 'main' }
        }));
    }

    function handleDockPanelRender(event) {
        const detail = event.detail || {};
        if (detail.moduleId !== MODULE_ID || detail.itemId !== 'main' || !detail.mount) return;

        // Each opening hands over a fresh, disposable mount node. Render only
        // inside it, and never position the flyout shell yourself.
        dockMount = detail.mount;
        renderDockPanel();
    }

    function renderDockPanel() {
        if (!dockMount) return;

        // A disconnected mount means that panel session has ended.
        if (!dockMount.isConnected) {
            dockMount = null;
            return;
        }

        const text = labels();
        const panel = document.createElement('div');
        const title = document.createElement('strong');
        const body = document.createElement('p');

        panel.className = 'lectio-module-skeleton';
        panel.style.fontSize = `${settings.scale}%`;
        title.textContent = text.panelTitle;
        body.textContent = settings.note || text.panelBody;

        panel.append(title, body);
        dockMount.replaceChildren(panel);
    }

    /* ---------------------------------------------------------------- *
     * Teardown
     *
     * Modules run on every matched Lectio page load and Lectio navigates a
     * lot. Every listener, timer, observer and inserted node must be able to
     * go away again, or they accumulate for as long as the tab is open.
     * ---------------------------------------------------------------- */

    // What a frozen page must stop doing, and nothing more: timers, polling,
    // background requests. Not the styles, nodes or dock item it has already
    // put on the page - the person will be looking at those again the moment
    // the page comes back.
    function suspend() {
        suspended = true;
        window.clearTimeout(exampleTimer);                  // every timer and interval
        exampleTimer = 0;
        // TODO: abort in-flight fetches and stop any poll interval here, and
        // have the work itself check `suspended` before it starts something.
    }

    function resume(event) {
        // Only a bfcache restore, and never after a real teardown.
        if (!event || !event.persisted || lifecycle.signal.aborted) return;

        suspended = false;
        // TODO: restart whatever suspend() stopped.
    }

    function teardown() {
        lifecycle.abort();                                  // every listener added with the signal
        window.clearTimeout(exampleTimer);                  // every timer and interval
        // TODO: observer?.disconnect() for every MutationObserver you add.
        removeDockItem();
        document.getElementById(STYLE_ID)?.remove();        // every node put into the page
        dockMount = null;
    }

    /* ---------------------------------------------------------------- *
     * Start
     * ---------------------------------------------------------------- */

    window.addEventListener('lectio-manager:discover', announce, { signal: lifecycle.signal });
    window.addEventListener('lectio-manager:set-setting', handleSetting, { signal: lifecycle.signal });
    window.addEventListener('lectio-manager:prune-storage', handlePruneStorage, { signal: lifecycle.signal });
    window.addEventListener('lectio-manager:preview-setting', handlePreview, { signal: lifecycle.signal });
    window.addEventListener('lectio-manager:clear-setting-preview', handleClearPreview, { signal: lifecycle.signal });
    window.addEventListener('lectio-manager:dock:render-panel', handleDockPanelRender, { signal: lifecycle.signal });

    // The dock label and the panel are captured in whichever language was
    // current when they were built, so rebuild them when the Manager changes it.
    window.addEventListener('lectio-manager:language', () => {
        registerDockItem();
        renderDockPanel();
    }, { signal: lifecycle.signal });

    // Deliberately not { once: true }, and deliberately split in two. A page
    // frozen for the back/forward cache fires pagehide with persisted set and
    // may be restored without this script ever running again, so tearing the
    // module down there leaves a restored page permanently switched off - no
    // listeners, no styles, no dock item, for the rest of that page's life,
    // with no error to show for it. That is the bug filed as #41. A frozen
    // page therefore only has its background work suspended, and pageshow
    // puts it back; a page that is genuinely going away is torn down exactly
    // as before. One registration each, at module scope, so neither listener
    // can accumulate: a bfcache restore does not re-execute the script, and a
    // real navigation discards the page along with both listeners.
    window.addEventListener('pagehide', (event) => {
        suspend();

        if (event && event.persisted) return;

        teardown();
    });
    window.addEventListener('pageshow', resume);

    function start() {
        addStyles();
        apply();
        announce();

        // An example of a timer that teardown() is responsible for. Delete it
        // with the rest of what you do not need.
        exampleTimer = window.setTimeout(() => { exampleTimer = 0; }, 2500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true, signal: lifecycle.signal });
    } else {
        start();
    }
})();
