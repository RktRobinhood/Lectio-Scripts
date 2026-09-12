// ==UserScript==
// @name         Lectio Manager
// @namespace    https://www.lectio.dk/
// @version      1.6.0
// @description  Discover, install, and manage independent Lectio Tampermonkey modules from one small gear panel.
// @match        https://www.lectio.dk/lectio/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/manager/Lectio-Manager.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/manager/Lectio-Manager.user.js
// ==/UserScript==

(() => {
    'use strict';

    /*
     * ============================================================
     * NON-NEGOTIABLE BOUNDARY
     * ============================================================
     *
     * This Manager only discovers, describes, opens installation
     * routes, shows status, and hosts generic settings controls.
     *
     * It must never download and eval() module JavaScript, bundle
     * feature code, or touch Tampermonkey's own enable/disable
     * switches. Catalogue fields are rendered as text/links only.
     */

    const CATALOGUE_URL =
        'https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/catalogue/modules.json';

    const APPROVED_HOST =
        'raw.githubusercontent.com';

    const APPROVED_PATH_PREFIX =
        '/RktRobinhood/Lectio-Scripts/';

    const REFRESH_INTERVAL_MS =
        24 * 60 * 60 * 1000;

    const DISCOVER_EVENT = 'lectio-manager:discover';
    const REGISTER_EVENT = 'lectio-module:register';
    const SET_SETTING_EVENT = 'lectio-manager:set-setting';

    const STORAGE_CATALOGUE = 'lectioManager.catalogue.v1';
    const STORAGE_LAST_REFRESH = 'lectioManager.lastRefresh.v1';
    const STORAGE_VIEW = 'lectioManager.view.v1';
    const STORAGE_SORT_MODE = 'lectioManager.sortMode.v1';
    const STORAGE_UPDATE_TIP_DISMISSED = 'lectioManager.updateTipDismissed.v1';

    const ISSUES_URL = 'https://github.com/RktRobinhood/Lectio-Scripts/issues/new/choose';

    const AUDIENCE_VIEW_PREFIX = 'audience:';
    const CATEGORY_VIEW_PREFIX = 'category:';

    const LOG = '[Lectio Manager]';

    let catalogue = null;
    let lastRefresh = 0;
    let refreshing = false;
    let elements = null;
    let updatedLabelTimer = null;
    let currentView = 'all';
    let sortMode = 'category';
    let openSettingsModuleId = null;

    const detected = new Map();

    // ============================================================
    // BOOT
    // ============================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    function init() {
        if (!document.body) {
            window.setTimeout(init, 50);
            return;
        }

        catalogue = loadCachedCatalogue();
        lastRefresh = Number(GM_getValue(STORAGE_LAST_REFRESH, 0)) || 0;
        currentView = normalizeView(GM_getValue(STORAGE_VIEW, 'all'));
        sortMode = normalizeSortMode(GM_getValue(STORAGE_SORT_MODE, 'category'));

        buildUI();
        renderModuleList();
        updateRefreshedLabel({ justUpdated: false });

        window.addEventListener(REGISTER_EVENT, handleModuleRegister);
        requestDiscovery();

        const age = Date.now() - lastRefresh;

        if (!catalogue || age > REFRESH_INTERVAL_MS) {
            refreshCatalogue();
        }
    }

    // ============================================================
    // CATALOGUE: CACHE
    // ============================================================

    function loadCachedCatalogue() {
        const raw = GM_getValue(STORAGE_CATALOGUE, '');

        if (!raw) {
            return null;
        }

        try {
            return validateCatalogue(raw);
        } catch (error) {
            console.warn(LOG, 'Discarding invalid cached catalogue:', error.message);
            return null;
        }
    }

    function saveCatalogueCache(validatedCatalogue, timestamp) {
        try {
            GM_setValue(STORAGE_CATALOGUE, JSON.stringify(validatedCatalogue));
            GM_setValue(STORAGE_LAST_REFRESH, timestamp);
        } catch (error) {
            console.warn(LOG, 'Could not persist catalogue cache:', error);
        }
    }

    // ============================================================
    // CATALOGUE: FETCH + VALIDATE
    // ============================================================

    async function refreshCatalogue() {
        if (refreshing) {
            return;
        }

        refreshing = true;
        setRefreshingUI(true);

        try {
            const raw = await fetchCatalogueText();
            const validated = validateCatalogue(raw);

            catalogue = validated;
            lastRefresh = Date.now();

            saveCatalogueCache(validated, lastRefresh);
            showError(null);
            renderModuleList();
            updateRefreshedLabel({ justUpdated: true });

        } catch (error) {
            console.warn(LOG, 'Catalogue refresh failed:', error);

            showError(
                lastRefresh
                    ? `Could not refresh - showing data from ${formatTime(lastRefresh)}`
                    : 'Could not load the module catalogue.'
            );

        } finally {
            refreshing = false;
            setRefreshingUI(false);
        }
    }

    function fetchCatalogueText() {
        return new Promise((resolve, reject) => {
            const url = `${CATALOGUE_URL}?ts=${Date.now()}`;

            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 15000,
                headers: { 'Cache-Control': 'no-cache' },
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`HTTP ${response.status}`));
                    }
                },
                onerror: () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Request timed out'))
            });
        });
    }

    function validateCatalogue(raw) {
        let parsed;

        try {
            parsed = JSON.parse(raw);
        } catch (_) {
            throw new Error('Malformed JSON');
        }

        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Catalogue is not an object');
        }

        if (parsed.schemaVersion !== 1) {
            throw new Error(`Unsupported schemaVersion: ${parsed.schemaVersion}`);
        }

        if (!Array.isArray(parsed.modules)) {
            throw new Error('Catalogue has no modules array');
        }

        const seenIds = new Set();
        const modules = [];

        for (const entry of parsed.modules) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }

            const { id, name, description, version, installUrl } = entry;

            if (
                !isNonEmptyString(id) ||
                !isNonEmptyString(name) ||
                !isNonEmptyString(description) ||
                !isNonEmptyString(version) ||
                !isNonEmptyString(installUrl)
            ) {
                console.warn(LOG, 'Skipping module with missing required fields:', entry);
                continue;
            }

            if (seenIds.has(id)) {
                console.warn(LOG, 'Skipping duplicate module id:', id);
                continue;
            }

            if (!isApprovedInstallUrl(installUrl)) {
                console.warn(LOG, 'Skipping module with disallowed installUrl:', id, installUrl);
                continue;
            }

            seenIds.add(id);

            modules.push({
                id,
                name,
                description,
                category: isNonEmptyString(entry.category) ? entry.category : 'General',
                audience: Array.isArray(entry.audience) ? entry.audience.filter(isNonEmptyString) : [],
                status: isNonEmptyString(entry.status) ? entry.status : 'stable',
                version,
                installUrl,
                supportUrl: isNonEmptyString(entry.supportUrl)
                    ? entry.supportUrl
                    : 'https://github.com/RktRobinhood/Lectio-Scripts/issues'
            });
        }

        if (!modules.length) {
            throw new Error('Catalogue contained no valid modules');
        }

        return {
            schemaVersion: 1,
            generatedAt: isNonEmptyString(parsed.generatedAt) ? parsed.generatedAt : new Date().toISOString(),
            modules
        };
    }

    function isApprovedInstallUrl(value) {
        try {
            const url = new URL(value);

            return (
                url.protocol === 'https:' &&
                url.host === APPROVED_HOST &&
                url.pathname.startsWith(APPROVED_PATH_PREFIX)
            );
        } catch (_) {
            return false;
        }
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim().length > 0;
    }

    function normalizeView(value) {
        if (value === 'all' || value === 'installed') {
            return value;
        }

        if (isNonEmptyString(value) && (value.startsWith(AUDIENCE_VIEW_PREFIX) || value.startsWith(CATEGORY_VIEW_PREFIX))) {
            return value;
        }

        return 'all';
    }

    function normalizeSortMode(value) {
        return ['category', 'name'].includes(value) ? value : 'category';
    }

    function getViewLabel(view) {
        if (view === 'installed') {
            const count = catalogue ? catalogue.modules.filter((module) => detected.has(module.id)).length : 0;
            return `Installed (${count})`;
        }

        if (view.startsWith(AUDIENCE_VIEW_PREFIX)) {
            const audience = view.slice(AUDIENCE_VIEW_PREFIX.length);
            return audience.charAt(0).toUpperCase() + audience.slice(1);
        }

        if (view.startsWith(CATEGORY_VIEW_PREFIX)) {
            return view.slice(CATEGORY_VIEW_PREFIX.length);
        }

        return 'All modules';
    }

    // ============================================================
    // MODULE HANDSHAKE
    // ============================================================

    function requestDiscovery() {
        window.dispatchEvent(new CustomEvent(DISCOVER_EVENT));
    }

    function handleModuleRegister(event) {
        const detail = event?.detail;

        if (!detail || !isNonEmptyString(detail.id)) {
            return;
        }

        detected.set(detail.id, {
            id: detail.id,
            name: isNonEmptyString(detail.name) ? detail.name : detail.id,
            version: isNonEmptyString(detail.version) ? detail.version : '',
            settingsSchema: Array.isArray(detail.settingsSchema) ? detail.settingsSchema : [],
            currentValues: (detail.currentValues && typeof detail.currentValues === 'object')
                ? detail.currentValues
                : {},
            seenAt: Date.now()
        });

        renderModuleList();
    }

    function emitSettingChange(moduleId, key, value) {
        window.dispatchEvent(new CustomEvent(SET_SETTING_EVENT, {
            detail: { id: moduleId, key, value }
        }));
    }

    // ============================================================
    // UI: BUILD
    // ============================================================

    function buildUI() {
        const root = document.createElement('div');
        root.id = 'lectio-manager-root';

        root.innerHTML = `
            <button id="lectio-manager-toggle" type="button" title="Lectio Tools" aria-label="Lectio Tools">${gearSvg()}</button>
            <div id="lectio-manager-panel" hidden>
                <div class="lectio-manager-header">
                    <span class="lectio-manager-title">Lectio Tools</span>
                    <button type="button" class="lectio-manager-help" title="How to disable, update, or remove a script" aria-label="How to disable, update, or remove a script" aria-haspopup="true" aria-expanded="false">${helpSvg()}</button>
                    <button type="button" class="lectio-manager-refresh" title="Refresh catalogue" aria-label="Refresh catalogue">${refreshSvg()}</button>
                    <button type="button" class="lectio-manager-close" title="Close" aria-label="Close">${closeSvg()}</button>
                </div>
                <div class="lectio-manager-help-panel" hidden>
                    To disable, update, or remove a script: click the Tampermonkey icon in your browser toolbar, then choose <strong>Dashboard</strong>. Every installed script is managed from there - the Manager itself can only install and describe modules.
                </div>
                <div class="lectio-manager-refreshed-row">
                    <span class="lectio-manager-refreshed-label"></span>
                </div>
                <div class="lectio-manager-tip" hidden>
                    <span class="lectio-manager-tip-text">Get automatic updates: open Tampermonkey &rarr; Settings &rarr; enable "Check for updates".</span>
                    <button type="button" class="lectio-manager-tip-dismiss" aria-label="Dismiss tip">&times;</button>
                </div>
                <div class="lectio-manager-nav">
                    <button type="button" class="lectio-manager-nav-trigger" aria-haspopup="true" aria-expanded="false">
                        <span class="lectio-manager-nav-current">All modules</span>
                        ${chevronSvg()}
                    </button>
                    <div class="lectio-manager-nav-menu" role="menu" hidden></div>
                </div>
                <div class="lectio-manager-error" hidden></div>
                <div class="lectio-manager-view-heading"></div>
                <div class="lectio-manager-list"></div>
                <div class="lectio-manager-footer">
                    <a class="lectio-manager-footer-link" href="${ISSUES_URL}" target="_blank" rel="noopener noreferrer">Report a bug or idea</a>
                </div>
            </div>
        `;

        document.body.appendChild(root);
        injectStyles();

        const toggle = root.querySelector('#lectio-manager-toggle');
        const panel = root.querySelector('#lectio-manager-panel');
        const helpBtn = root.querySelector('.lectio-manager-help');
        const helpPanel = root.querySelector('.lectio-manager-help-panel');
        const refreshBtn = root.querySelector('.lectio-manager-refresh');
        const closeBtn = root.querySelector('.lectio-manager-close');
        const navTrigger = root.querySelector('.lectio-manager-nav-trigger');
        const navMenu = root.querySelector('.lectio-manager-nav-menu');
        const navCurrent = root.querySelector('.lectio-manager-nav-current');
        const tipBanner = root.querySelector('.lectio-manager-tip');
        const tipDismissBtn = root.querySelector('.lectio-manager-tip-dismiss');

        helpBtn.addEventListener('click', () => {
            const willShow = helpPanel.hidden;
            helpPanel.hidden = !willShow;
            helpBtn.setAttribute('aria-expanded', String(willShow));
        });

        if (!GM_getValue(STORAGE_UPDATE_TIP_DISMISSED, false)) {
            tipBanner.hidden = false;
        }

        tipDismissBtn.addEventListener('click', () => {
            tipBanner.hidden = true;
            GM_setValue(STORAGE_UPDATE_TIP_DISMISSED, true);
        });

        toggle.addEventListener('click', () => {
            if (panel.hasAttribute('hidden')) {
                panel.removeAttribute('hidden');
                requestDiscovery();
            } else {
                closePanel();
            }
        });

        closeBtn.addEventListener('click', () => closePanel());

        refreshBtn.addEventListener('click', () => refreshCatalogue());

        navTrigger.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleNavMenu();
        });

        navMenu.addEventListener('click', (event) => {
            const viewItem = event.target.closest('[data-view]');

            if (viewItem) {
                currentView = normalizeView(viewItem.dataset.view);
                GM_setValue(STORAGE_VIEW, currentView);
                closeNavMenu();
                renderModuleList();
                return;
            }

            const sortItem = event.target.closest('[data-sort]');

            if (sortItem) {
                sortMode = normalizeSortMode(sortItem.dataset.sort);
                GM_setValue(STORAGE_SORT_MODE, sortMode);
                closeNavMenu();
                renderModuleList();
            }
        });

        document.addEventListener('click', (event) => {
            if (!elements) {
                return;
            }

            if (!elements.navMenu.hidden &&
                !elements.navTrigger.contains(event.target) &&
                !elements.navMenu.contains(event.target)) {
                closeNavMenu();
            }

            if (!elements.panel.hasAttribute('hidden') && !elements.root.contains(event.target)) {
                closePanel();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !elements) {
                return;
            }

            if (!elements.navMenu.hidden) {
                closeNavMenu();
                return;
            }

            closePanel();
        });

        elements = {
            root,
            panel,
            refreshBtn,
            navTrigger,
            navMenu,
            navCurrent,
            list: root.querySelector('.lectio-manager-list'),
            viewHeading: root.querySelector('.lectio-manager-view-heading'),
            refreshedLabel: root.querySelector('.lectio-manager-refreshed-label'),
            errorBox: root.querySelector('.lectio-manager-error')
        };
    }

    function closePanel() {
        if (!elements || elements.panel.hasAttribute('hidden')) {
            return;
        }

        elements.panel.setAttribute('hidden', '');
        closeNavMenu();
    }

    function toggleNavMenu() {
        if (elements.navMenu.hidden) {
            openNavMenu();
        } else {
            closeNavMenu();
        }
    }

    function openNavMenu() {
        elements.navMenu.hidden = false;
        elements.navTrigger.setAttribute('aria-expanded', 'true');
    }

    function closeNavMenu() {
        if (!elements) {
            return;
        }

        elements.navMenu.hidden = true;
        elements.navTrigger.setAttribute('aria-expanded', 'false');
    }

    // ============================================================
    // UI: RENDER
    // ============================================================

    function renderModuleList() {
        if (!elements) {
            return;
        }

        renderNavMenu();

        const { list, viewHeading } = elements;
        list.innerHTML = '';

        if (!catalogue) {
            const loading = document.createElement('div');
            loading.className = 'lectio-manager-loading';
            loading.textContent = 'Loading catalogue…';
            list.appendChild(loading);
            viewHeading.textContent = '';
            return;
        }

        const modules = getFilteredSortedModules();

        viewHeading.textContent = modules.length
            ? `${getViewLabel(currentView)} · ${modules.length}`
            : getViewLabel(currentView);

        if (!modules.length) {
            const empty = document.createElement('div');
            empty.className = 'lectio-manager-loading';
            empty.textContent = 'No modules in this view yet.';
            list.appendChild(empty);
            return;
        }

        const groupByCategory = sortMode === 'category' && !currentView.startsWith(CATEGORY_VIEW_PREFIX);
        let lastCategory = null;

        for (const module of modules) {
            if (groupByCategory && module.category !== lastCategory) {
                lastCategory = module.category;

                const categoryHeading = document.createElement('div');
                categoryHeading.className = 'lectio-manager-category-heading';
                categoryHeading.textContent = module.category;
                list.appendChild(categoryHeading);
            }

            list.appendChild(buildModuleCard(module));
        }
    }

    function getFilteredSortedModules() {
        if (!catalogue) {
            return [];
        }

        let filtered;

        if (currentView === 'installed') {
            filtered = catalogue.modules.filter((module) => detected.has(module.id));
        } else if (currentView.startsWith(AUDIENCE_VIEW_PREFIX)) {
            const audience = currentView.slice(AUDIENCE_VIEW_PREFIX.length);
            filtered = catalogue.modules.filter((module) => !module.audience.length || module.audience.includes(audience));
        } else if (currentView.startsWith(CATEGORY_VIEW_PREFIX)) {
            const category = currentView.slice(CATEGORY_VIEW_PREFIX.length);
            filtered = catalogue.modules.filter((module) => module.category === category);
        } else {
            filtered = catalogue.modules.slice();
        }

        const sorted = filtered.slice();

        if (sortMode === 'name' || currentView.startsWith(CATEGORY_VIEW_PREFIX)) {
            sorted.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            sorted.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
        }

        return sorted;
    }

    // ============================================================
    // UI: NAVIGATION MENU
    // ============================================================

    function renderNavMenu() {
        if (!elements) {
            return;
        }

        const { navMenu, navCurrent } = elements;

        const categories = catalogue
            ? [...new Set(catalogue.modules.map((module) => module.category))].sort((a, b) => a.localeCompare(b))
            : [];

        const installedCount = catalogue
            ? catalogue.modules.filter((module) => detected.has(module.id)).length
            : 0;

        navMenu.innerHTML = '';

        const topGroup = document.createElement('div');
        topGroup.className = 'lectio-manager-nav-group';
        topGroup.appendChild(buildNavMenuItem('all', 'All modules'));
        topGroup.appendChild(buildNavMenuItem('installed', `Installed (${installedCount})`));
        navMenu.appendChild(topGroup);

        const audienceGroup = document.createElement('div');
        audienceGroup.className = 'lectio-manager-nav-group';
        audienceGroup.appendChild(buildNavGroupLabel('Audience'));
        audienceGroup.appendChild(buildNavMenuItem(`${AUDIENCE_VIEW_PREFIX}student`, 'Student'));
        audienceGroup.appendChild(buildNavMenuItem(`${AUDIENCE_VIEW_PREFIX}teacher`, 'Teacher'));
        navMenu.appendChild(audienceGroup);

        if (categories.length) {
            const categoryGroup = document.createElement('div');
            categoryGroup.className = 'lectio-manager-nav-group';
            categoryGroup.appendChild(buildNavGroupLabel('Category'));

            for (const category of categories) {
                categoryGroup.appendChild(buildNavMenuItem(`${CATEGORY_VIEW_PREFIX}${category}`, category));
            }

            navMenu.appendChild(categoryGroup);
        }

        const sortGroup = document.createElement('div');
        sortGroup.className = 'lectio-manager-nav-group';
        sortGroup.appendChild(buildNavGroupLabel('Sort'));
        sortGroup.appendChild(buildSortMenuItem('category', 'Category'));
        sortGroup.appendChild(buildSortMenuItem('name', 'Name (A-Z)'));
        navMenu.appendChild(sortGroup);

        navCurrent.textContent = getViewLabel(currentView);
    }

    function buildNavGroupLabel(text) {
        const label = document.createElement('div');
        label.className = 'lectio-manager-nav-group-label';
        label.textContent = text;
        return label;
    }

    function buildNavMenuItem(view, label) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'lectio-manager-nav-item';
        item.dataset.view = view;
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(view === currentView));
        item.classList.toggle('is-active', view === currentView);
        item.textContent = label;
        return item;
    }

    function buildSortMenuItem(mode, label) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'lectio-manager-nav-item';
        item.dataset.sort = mode;
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(mode === sortMode));
        item.classList.toggle('is-active', mode === sortMode);
        item.textContent = label;
        return item;
    }

    function buildModuleCard(module) {
        const registration = detected.get(module.id);

        const card = document.createElement('div');
        card.className = 'lectio-manager-card';
        card.dataset.moduleId = module.id;
        card.dataset.category = module.category;

        const main = document.createElement('div');
        main.className = 'lectio-manager-card-main';

        const meta = document.createElement('div');
        meta.className = 'lectio-manager-card-meta';

        const category = document.createElement('span');
        category.className = 'lectio-manager-card-category';
        category.textContent = module.category;
        meta.appendChild(category);

        if (module.audience.length) {
            const audience = document.createElement('span');
            audience.className = 'lectio-manager-card-audience';
            audience.textContent = module.audience.join(' · ');
            meta.appendChild(audience);
        }

        const nameRow = document.createElement('div');
        nameRow.className = 'lectio-manager-card-name';
        nameRow.textContent = module.name;

        const desc = document.createElement('div');
        desc.className = 'lectio-manager-card-desc';
        desc.textContent = module.description;

        main.append(meta, nameRow, desc);

        const status = document.createElement('div');
        status.className = 'lectio-manager-card-status';

        const actions = document.createElement('div');
        actions.className = 'lectio-manager-card-actions';

        if (registration) {
            const installed = document.createElement('span');
            installed.className = 'lectio-manager-status-installed';
            installed.textContent = `Installed v${registration.version || module.version}`;
            status.appendChild(installed);

            if (registration.settingsSchema.length) {
                const settingsBtn = document.createElement('button');
                settingsBtn.type = 'button';
                settingsBtn.className = 'lectio-manager-settings-btn';
                settingsBtn.textContent = 'Settings';
                settingsBtn.setAttribute('aria-expanded', String(openSettingsModuleId === module.id));
                settingsBtn.addEventListener('click', () => toggleSettingsPanel(card, module, registration));
                actions.appendChild(settingsBtn);
            }
        } else {
            const notDetected = document.createElement('span');
            notDetected.className = 'lectio-manager-status-missing';
            notDetected.textContent = 'Not detected';
            status.appendChild(notDetected);

            const installLink = document.createElement('a');
            installLink.className = 'lectio-manager-install-btn';
            installLink.href = module.installUrl;
            installLink.target = '_blank';
            installLink.rel = 'noopener noreferrer';
            installLink.textContent = 'Install';
            actions.appendChild(installLink);
        }

        status.appendChild(actions);
        card.append(main, status);

        const settingsContainer = document.createElement('div');
        settingsContainer.className = 'lectio-manager-settings';
        settingsContainer.hidden = openSettingsModuleId !== module.id;
        if (!settingsContainer.hidden && registration) {
            renderSettingsControls(settingsContainer, module, registration);
        }
        card.appendChild(settingsContainer);

        return card;
    }

    function toggleSettingsPanel(card, module, registration) {
        const container = card.querySelector('.lectio-manager-settings');
        const wasHidden = container.hidden;

        for (const other of elements.list.querySelectorAll('.lectio-manager-settings:not([hidden])')) {
            other.hidden = true;
            other.closest('.lectio-manager-card')
                ?.querySelector('.lectio-manager-settings-btn')
                ?.setAttribute('aria-expanded', 'false');
        }

        if (wasHidden) {
            renderSettingsControls(container, module, registration);
            openSettingsModuleId = module.id;
            container.hidden = false;
            card.querySelector('.lectio-manager-settings-btn')?.setAttribute('aria-expanded', 'true');
        } else {
            openSettingsModuleId = null;
        }
    }

    function renderSettingsControls(container, module, registration) {
        container.innerHTML = '';

        const heading = document.createElement('div');
        heading.className = 'lectio-manager-settings-heading';
        heading.textContent = 'Module settings';
        container.appendChild(heading);

        for (const control of registration.settingsSchema) {
            if (!control || !isNonEmptyString(control.key) || !isNonEmptyString(control.type)) {
                continue;
            }

            const row = document.createElement('div');
            row.className = 'lectio-manager-setting-row';

            const copy = document.createElement('div');
            copy.className = 'lectio-manager-setting-copy';

            const label = document.createElement('label');
            label.className = 'lectio-manager-setting-label';
            label.textContent = control.label || control.key;
            copy.appendChild(label);

            if (isNonEmptyString(control.description)) {
                const description = document.createElement('span');
                description.className = 'lectio-manager-setting-description';
                description.textContent = control.description;
                copy.appendChild(description);
            }

            row.appendChild(copy);

            const currentValue = registration.currentValues[control.key];
            let input;

            switch (control.type) {
                case 'toggle':
                    row.classList.add('is-toggle');
                    input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = Boolean(currentValue);
                    input.addEventListener('change', () => emitSettingChange(module.id, control.key, input.checked));
                    break;

                case 'select':
                    input = document.createElement('select');
                    for (const option of control.options || []) {
                        const opt = document.createElement('option');
                        opt.value = option.value ?? option;
                        opt.textContent = option.label ?? option;
                        input.appendChild(opt);
                    }
                    input.value = currentValue ?? '';
                    input.addEventListener('change', () => emitSettingChange(module.id, control.key, input.value));
                    break;

                case 'range':
                    row.classList.add('is-range');
                    input = document.createElement('input');
                    input.type = 'range';
                    input.min = control.min ?? 0;
                    input.max = control.max ?? 100;
                    input.step = control.step ?? 1;
                    input.value = currentValue ?? control.min ?? 0;
                    {
                        const value = document.createElement('output');
                        value.className = 'lectio-manager-range-value';
                        value.textContent = `${input.value}${control.suffix || ''}`;
                        input.addEventListener('input', () => {
                            value.textContent = `${input.value}${control.suffix || ''}`;
                        });
                        row.appendChild(value);
                    }
                    input.addEventListener('change', () => emitSettingChange(module.id, control.key, input.value));
                    break;

                case 'text':
                    input = document.createElement('input');
                    input.type = 'text';
                    input.value = currentValue ?? '';
                    input.addEventListener('change', () => emitSettingChange(module.id, control.key, input.value));
                    break;

                case 'button':
                    row.classList.add('is-button');
                    input = document.createElement('button');
                    input.type = 'button';
                    input.textContent = control.buttonLabel || control.label || 'Run';
                    input.addEventListener('click', () => emitSettingChange(module.id, control.key, true));
                    break;

                default:
                    continue;
            }

            if (input.tagName !== 'BUTTON') {
                input.id = `lectio-manager-setting-${module.id}-${control.key}`
                    .replace(/[^a-zA-Z0-9_-]/g, '-');
                label.htmlFor = input.id;
            }

            row.appendChild(input);
            container.appendChild(row);
        }
    }

    // ============================================================
    // UI: STATUS TEXT
    // ============================================================

    function updateRefreshedLabel({ justUpdated }) {
        if (!elements) {
            return;
        }

        const label = elements.refreshedLabel;

        if (!lastRefresh) {
            label.textContent = 'Not refreshed yet';
            label.title = '';
            return;
        }

        label.title = new Date(lastRefresh).toLocaleString();

        window.clearTimeout(updatedLabelTimer);

        if (justUpdated) {
            label.textContent = 'Updated just now';
            updatedLabelTimer = window.setTimeout(() => {
                label.textContent = `Last refreshed: ${formatTime(lastRefresh)}`;
            }, 5000);
        } else {
            label.textContent = `Last refreshed: ${formatTime(lastRefresh)}`;
        }
    }

    function showError(message) {
        if (!elements) {
            return;
        }

        if (!message) {
            elements.errorBox.hidden = true;
            elements.errorBox.textContent = '';
            return;
        }

        elements.errorBox.hidden = false;
        elements.errorBox.textContent = message;
    }

    function setRefreshingUI(isRefreshing) {
        if (!elements) {
            return;
        }

        elements.refreshBtn.disabled = isRefreshing;
        elements.refreshBtn.classList.toggle('is-spinning', isRefreshing);
    }

    function formatTime(timestamp) {
        if (!timestamp) {
            return '--:--';
        }

        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // ============================================================
    // ICONS
    // ============================================================

    function gearSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.5-2-3.4-2.2.9a7.6 7.6 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.2-.9-2 3.4L4.6 10.5a7.6 7.6 0 0 0 0 3l-1.9 1.5 2 3.4 2.2-.9c.77.66 1.65 1.17 2.6 1.5l.5 2.4h4l.5-2.4a7.6 7.6 0 0 0 2.6-1.5l2.2.9 2-3.4-1.9-1.5Z"></path></svg>`;
    }

    function refreshSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12a8 8 0 0 1 13.66-5.66L20 8"></path><path d="M20 4v4h-4"></path><path d="M20 12a8 8 0 0 1-13.66 5.66L4 16"></path><path d="M4 20v-4h4"></path></svg>`;
    }

    function closeSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 5l14 14"></path><path d="M19 5 5 19"></path></svg>`;
    }

    function chevronSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"></path></svg>`;
    }

    function helpSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M9.5 9.3a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 1.9-2.4 3.4"></path><circle cx="12" cy="16.8" r=".15" fill="currentColor" stroke-width="1.2"></circle></svg>`;
    }

    // ============================================================
    // STYLES
    // ============================================================

    function injectStyles() {
        const style = document.createElement('style');

        style.textContent = `
            #lectio-manager-root {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 999999;
                font-family: Roboto, Arial, sans-serif;
                font-size: 13px;
                color: #10201e;
            }

            #lectio-manager-toggle {
                width: 44px;
                height: 44px;
                border-radius: 50%;
                border: none;
                background: #0f6f6f;
                box-shadow: 0 3px 10px rgba(0,0,0,.28);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
            }

            #lectio-manager-toggle svg {
                width: 22px;
                height: 22px;
                fill: none;
                stroke: #ffffff;
                stroke-width: 1.6;
                stroke-linecap: round;
                stroke-linejoin: round;
            }

            #lectio-manager-toggle:hover {
                background: #0d5f5f;
            }

            #lectio-manager-panel {
                position: absolute;
                right: 0;
                bottom: 54px;
                width: min(390px, calc(100vw - 32px));
                max-height: min(78vh, 640px);
                display: flex;
                flex-direction: column;
                background: #ffffff;
                border: 1px solid #d6dde0;
                border-radius: 10px;
                box-shadow: 0 10px 28px rgba(0,0,0,.22);
            }

            #lectio-manager-panel[hidden] {
                display: none !important;
            }

            .lectio-manager-header {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                background: #0f6f6f;
                color: #ffffff;
                border-radius: 10px 10px 0 0;
            }

            .lectio-manager-footer {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 8px 12px;
                border-top: 1px solid #eef1f2;
                background: #fafbfb;
                border-radius: 0 0 10px 10px;
            }

            .lectio-manager-footer-link {
                border: none;
                background: transparent;
                padding: 0;
                font-size: 11px;
                font-weight: 600;
                font-family: inherit;
                color: #0f6f6f;
                text-decoration: none;
                cursor: pointer;
            }

            .lectio-manager-footer-link:hover {
                text-decoration: underline;
            }

            .lectio-manager-title {
                flex: 1;
                font-weight: 700;
                font-size: 14px;
            }

            .lectio-manager-help,
            .lectio-manager-refresh,
            .lectio-manager-close {
                width: 26px;
                height: 26px;
                border: none;
                background: transparent;
                color: #ffffff;
                text-decoration: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 6px;
            }

            .lectio-manager-help:hover,
            .lectio-manager-refresh:hover,
            .lectio-manager-close:hover {
                background: rgba(255,255,255,.16);
            }

            .lectio-manager-refresh:disabled {
                opacity: .6;
                cursor: default;
            }

            .lectio-manager-help svg,
            .lectio-manager-refresh svg,
            .lectio-manager-close svg {
                width: 15px;
                height: 15px;
                fill: none;
                stroke: currentColor;
                stroke-width: 2;
                stroke-linecap: round;
                stroke-linejoin: round;
            }

            .lectio-manager-help-panel {
                margin: 6px 12px 0;
                padding: 8px 10px;
                font-size: 11px;
                line-height: 1.4;
                background: #eef3f6;
                color: #2a4250;
                border: 1px solid #d8e3e9;
                border-radius: 8px;
            }

            .lectio-manager-help-panel[hidden] {
                display: none !important;
            }

            .lectio-manager-refresh.is-spinning svg {
                animation: lectio-manager-spin 800ms linear infinite;
            }

            @keyframes lectio-manager-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }

            .lectio-manager-refreshed-row {
                padding: 6px 12px 0;
                font-size: 11px;
                color: #5e6870;
            }

            .lectio-manager-nav {
                position: relative;
                padding: 6px 12px;
                border-bottom: 1px solid #eef1f2;
            }

            .lectio-manager-nav-trigger {
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 100%;
                gap: 8px;
                border: 1px solid #d6dde0;
                background: #ffffff;
                border-radius: 8px;
                padding: 6px 10px;
                font-size: 12px;
                font-weight: 700;
                color: #10201e;
                cursor: pointer;
            }

            .lectio-manager-nav-trigger:hover {
                border-color: #0f6f6f;
            }

            .lectio-manager-nav-trigger svg {
                width: 12px;
                height: 12px;
                flex-shrink: 0;
                fill: none;
                stroke: #5e6870;
                stroke-width: 2;
                stroke-linecap: round;
                stroke-linejoin: round;
            }

            .lectio-manager-nav-menu {
                position: absolute;
                left: 12px;
                right: 12px;
                top: calc(100% + 4px);
                z-index: 10;
                background: #ffffff;
                border: 1px solid #d6dde0;
                border-radius: 8px;
                box-shadow: 0 8px 20px rgba(0,0,0,.18);
                padding: 6px;
                max-height: 260px;
                overflow-y: auto;
            }

            .lectio-manager-nav-menu[hidden] {
                display: none !important;
            }

            .lectio-manager-nav-group {
                display: flex;
                flex-direction: column;
                gap: 2px;
                border: 1px solid #e2e8ea;
                border-radius: 8px;
                background: linear-gradient(180deg, #fbfdfd 0%, #f1f6f6 100%);
                padding: 4px;
                margin-bottom: 6px;
            }

            .lectio-manager-nav-group:last-child {
                margin-bottom: 0;
            }

            .lectio-manager-nav-group-label {
                padding: 4px 8px 2px;
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: .04em;
                color: #8a949c;
            }

            .lectio-manager-nav-item {
                display: block;
                width: 100%;
                text-align: left;
                border: none;
                background: transparent;
                border-radius: 6px;
                padding: 6px 8px;
                font-size: 12px;
                font-weight: 500;
                color: #10201e;
                cursor: pointer;
            }

            .lectio-manager-nav-item:hover {
                background: #f2f6f6;
            }

            .lectio-manager-nav-item.is-active {
                background: #0f6f6f;
                color: #ffffff;
                font-weight: 700;
            }

            .lectio-manager-view-heading {
                padding: 10px 14px 4px;
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: .03em;
                color: #5e6870;
            }

            .lectio-manager-tip {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                margin: 6px 12px 0;
                padding: 8px 10px;
                font-size: 11px;
                line-height: 1.35;
                background: #eaf5f2;
                color: #0d4d4d;
                border: 1px solid #cfe8e3;
                border-radius: 8px;
            }

            .lectio-manager-tip[hidden] {
                display: none !important;
            }

            .lectio-manager-tip-text {
                flex: 1;
            }

            .lectio-manager-tip-dismiss {
                border: none;
                background: transparent;
                color: #0d4d4d;
                font-size: 14px;
                line-height: 1;
                cursor: pointer;
                padding: 0 2px;
            }

            .lectio-manager-error {
                padding: 8px 12px;
                font-size: 12px;
                background: #fff4e5;
                color: #7a4a00;
                border-bottom: 1px solid #eef1f2;
            }

            .lectio-manager-error[hidden] {
                display: none !important;
            }

            .lectio-manager-list {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                padding: 6px 12px 14px;
            }

            .lectio-manager-loading {
                padding: 16px 8px;
                color: #5e6870;
                text-align: center;
                font-size: 12px;
            }

            .lectio-manager-category-heading {
                margin: 12px 2px 5px;
                font-size: 10px;
                font-weight: 800;
                color: #66767b;
                letter-spacing: .08em;
                text-transform: uppercase;
            }

            .lectio-manager-category-heading:first-child {
                margin-top: 0;
            }

            .lectio-manager-card {
                position: relative;
                padding: 11px 12px;
                border: 1px solid #dde5e6;
                border-radius: 10px;
                background: #ffffff;
                box-shadow: 0 1px 2px rgba(16,32,30,.04);
                overflow: hidden;
            }

            .lectio-manager-card + .lectio-manager-card {
                margin-top: 7px;
            }

            .lectio-manager-card::before {
                content: '';
                position: absolute;
                inset: 0 auto 0 0;
                width: 3px;
                background: #69a9a5;
            }

            .lectio-manager-card:hover {
                border-color: #b9cbcc;
            }

            .lectio-manager-card-main {
                margin-bottom: 9px;
            }

            .lectio-manager-card-meta {
                display: flex;
                align-items: center;
                gap: 7px;
                margin-bottom: 5px;
            }

            .lectio-manager-card-category {
                padding: 2px 6px;
                border-radius: 999px;
                background: #e9f3f2;
                color: #176766;
                font-size: 9px;
                font-weight: 800;
                letter-spacing: .05em;
                text-transform: uppercase;
            }

            .lectio-manager-card-name {
                font-weight: 700;
                font-size: 13px;
                display: flex;
                align-items: baseline;
                gap: 6px;
            }

            .lectio-manager-card-audience {
                font-weight: 600;
                font-size: 9px;
                color: #778187;
                text-transform: uppercase;
                letter-spacing: .04em;
            }

            .lectio-manager-card-desc {
                margin-top: 3px;
                font-size: 12px;
                color: #394a57;
                line-height: 1.4;
            }

            .lectio-manager-card-status {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .lectio-manager-status-installed,
            .lectio-manager-status-missing {
                flex: 1;
            }

            .lectio-manager-status-installed {
                font-size: 11px;
                font-weight: 600;
                color: #0f6f4f;
            }

            .lectio-manager-status-missing {
                font-size: 11px;
                color: #5e6870;
            }

            .lectio-manager-card-actions {
                display: flex;
                gap: 6px;
            }

            .lectio-manager-install-btn,
            .lectio-manager-settings-btn {
                border: 1px solid #0f6f6f;
                color: #0f6f6f;
                background: #ffffff;
                border-radius: 6px;
                padding: 3px 10px;
                font-size: 11px;
                font-weight: 600;
                text-decoration: none;
                cursor: pointer;
                white-space: nowrap;
            }

            .lectio-manager-install-btn:hover,
            .lectio-manager-settings-btn:hover {
                background: #e8f3f3;
            }

            .lectio-manager-settings {
                margin: 10px -4px -3px;
                padding: 10px;
                border: 1px solid #dce9e8;
                border-radius: 8px;
                background: #f6f9f9;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }

            .lectio-manager-settings[hidden] {
                display: none !important;
            }

            .lectio-manager-setting-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(110px, 42%);
                align-items: center;
                gap: 10px;
                font-size: 12px;
            }

            .lectio-manager-settings-heading {
                font-size: 10px;
                font-weight: 800;
                color: #176766;
                letter-spacing: .07em;
                text-transform: uppercase;
            }

            .lectio-manager-setting-copy {
                display: flex;
                min-width: 0;
                flex-direction: column;
                gap: 2px;
            }

            .lectio-manager-setting-label {
                color: #203431;
                font-weight: 650;
            }

            .lectio-manager-setting-description {
                color: #68767b;
                font-size: 10px;
                line-height: 1.3;
            }

            .lectio-manager-setting-row select,
            .lectio-manager-setting-row input[type='text'] {
                min-width: 0;
                width: 100%;
                box-sizing: border-box;
                border: 1px solid #cbd7d9;
                border-radius: 6px;
                background: #ffffff;
                color: #10201e;
                padding: 5px 7px;
                font: inherit;
            }

            .lectio-manager-setting-row input[type='checkbox'] {
                justify-self: end;
                width: 34px;
                height: 18px;
                accent-color: #0f6f6f;
            }

            .lectio-manager-setting-row.is-range {
                grid-template-columns: minmax(0, 1fr) minmax(90px, 1fr) auto;
            }

            .lectio-manager-setting-row input[type='range'] {
                grid-column: 2;
                min-width: 0;
                width: 100%;
                accent-color: #0f6f6f;
            }

            .lectio-manager-range-value {
                grid-column: 3;
                grid-row: 1;
                min-width: 35px;
                color: #176766;
                font-size: 10px;
                font-weight: 700;
                text-align: right;
            }

            .lectio-manager-setting-row.is-button {
                grid-template-columns: minmax(0, 1fr) auto;
            }

            .lectio-manager-setting-row.is-button button {
                border: 1px solid #0f6f6f;
                border-radius: 6px;
                background: #ffffff;
                color: #0f6f6f;
                padding: 5px 9px;
                font: inherit;
                font-weight: 700;
                cursor: pointer;
            }

            @media (max-width: 420px) {
                #lectio-manager-root {
                    right: 10px;
                    bottom: 10px;
                }

                #lectio-manager-panel {
                    width: calc(100vw - 20px);
                }
            }
        `;

        document.head.appendChild(style);
    }

})();
