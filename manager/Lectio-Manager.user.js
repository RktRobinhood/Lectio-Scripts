// ==UserScript==
// @name         Lectio Manager
// @namespace    https://www.lectio.dk/
// @version      1.0.0
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

    const LOG = '[Lectio Manager]';

    let catalogue = null;
    let lastRefresh = 0;
    let refreshing = false;
    let elements = null;
    let updatedLabelTimer = null;

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
                    <button type="button" class="lectio-manager-refresh" title="Refresh catalogue" aria-label="Refresh catalogue">${refreshSvg()}</button>
                    <button type="button" class="lectio-manager-close" title="Close" aria-label="Close">${closeSvg()}</button>
                </div>
                <div class="lectio-manager-refreshed-row">
                    <span class="lectio-manager-refreshed-label"></span>
                </div>
                <div class="lectio-manager-error" hidden></div>
                <div class="lectio-manager-list"></div>
            </div>
        `;

        document.body.appendChild(root);
        injectStyles();

        const toggle = root.querySelector('#lectio-manager-toggle');
        const panel = root.querySelector('#lectio-manager-panel');
        const refreshBtn = root.querySelector('.lectio-manager-refresh');
        const closeBtn = root.querySelector('.lectio-manager-close');

        toggle.addEventListener('click', () => {
            if (panel.hasAttribute('hidden')) {
                panel.removeAttribute('hidden');
                requestDiscovery();
            } else {
                panel.setAttribute('hidden', '');
            }
        });

        closeBtn.addEventListener('click', () => panel.setAttribute('hidden', ''));
        refreshBtn.addEventListener('click', () => refreshCatalogue());

        elements = {
            root,
            panel,
            refreshBtn,
            list: root.querySelector('.lectio-manager-list'),
            refreshedLabel: root.querySelector('.lectio-manager-refreshed-label'),
            errorBox: root.querySelector('.lectio-manager-error')
        };
    }

    // ============================================================
    // UI: RENDER
    // ============================================================

    function renderModuleList() {
        if (!elements) {
            return;
        }

        const { list } = elements;
        list.innerHTML = '';

        if (!catalogue) {
            const loading = document.createElement('div');
            loading.className = 'lectio-manager-loading';
            loading.textContent = 'Loading catalogue…';
            list.appendChild(loading);
            return;
        }

        for (const module of catalogue.modules) {
            list.appendChild(buildModuleCard(module));
        }
    }

    function buildModuleCard(module) {
        const registration = detected.get(module.id);

        const card = document.createElement('div');
        card.className = 'lectio-manager-card';

        const main = document.createElement('div');
        main.className = 'lectio-manager-card-main';

        const nameRow = document.createElement('div');
        nameRow.className = 'lectio-manager-card-name';
        nameRow.textContent = module.name;

        if (module.audience.length) {
            const audience = document.createElement('span');
            audience.className = 'lectio-manager-card-audience';
            audience.textContent = module.audience.join(' · ');
            nameRow.appendChild(audience);
        }

        const desc = document.createElement('div');
        desc.className = 'lectio-manager-card-desc';
        desc.textContent = module.description;

        main.append(nameRow, desc);

        const status = document.createElement('div');
        status.className = 'lectio-manager-card-status';

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
                settingsBtn.addEventListener('click', () => toggleSettingsPanel(card, module, registration));
                status.appendChild(settingsBtn);
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
            status.appendChild(installLink);
        }

        card.append(main, status);

        const settingsContainer = document.createElement('div');
        settingsContainer.className = 'lectio-manager-settings';
        settingsContainer.hidden = true;
        card.appendChild(settingsContainer);

        return card;
    }

    function toggleSettingsPanel(card, module, registration) {
        const container = card.querySelector('.lectio-manager-settings');
        const wasHidden = container.hidden;

        if (wasHidden) {
            renderSettingsControls(container, module, registration);
        }

        container.hidden = !wasHidden;
    }

    function renderSettingsControls(container, module, registration) {
        container.innerHTML = '';

        for (const control of registration.settingsSchema) {
            if (!control || !isNonEmptyString(control.key) || !isNonEmptyString(control.type)) {
                continue;
            }

            const row = document.createElement('div');
            row.className = 'lectio-manager-setting-row';

            const label = document.createElement('label');
            label.textContent = control.label || control.key;
            row.appendChild(label);

            const currentValue = registration.currentValues[control.key];
            let input;

            switch (control.type) {
                case 'toggle':
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
                    input = document.createElement('input');
                    input.type = 'range';
                    input.min = control.min ?? 0;
                    input.max = control.max ?? 100;
                    input.step = control.step ?? 1;
                    input.value = currentValue ?? control.min ?? 0;
                    input.addEventListener('change', () => emitSettingChange(module.id, control.key, input.value));
                    break;

                case 'text':
                    input = document.createElement('input');
                    input.type = 'text';
                    input.value = currentValue ?? '';
                    input.addEventListener('change', () => emitSettingChange(module.id, control.key, input.value));
                    break;

                case 'button':
                    input = document.createElement('button');
                    input.type = 'button';
                    input.textContent = control.label || 'Run';
                    input.addEventListener('click', () => emitSettingChange(module.id, control.key, true));
                    break;

                default:
                    continue;
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
                width: min(340px, calc(100vw - 32px));
                max-height: min(70vh, 520px);
                display: flex;
                flex-direction: column;
                background: #ffffff;
                border: 1px solid #d6dde0;
                border-radius: 10px;
                box-shadow: 0 10px 28px rgba(0,0,0,.22);
                overflow: hidden;
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
            }

            .lectio-manager-title {
                flex: 1;
                font-weight: 700;
                font-size: 14px;
            }

            .lectio-manager-refresh,
            .lectio-manager-close {
                width: 26px;
                height: 26px;
                border: none;
                background: transparent;
                color: #ffffff;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 6px;
            }

            .lectio-manager-refresh:hover,
            .lectio-manager-close:hover {
                background: rgba(255,255,255,.16);
            }

            .lectio-manager-refresh:disabled {
                opacity: .6;
                cursor: default;
            }

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

            .lectio-manager-refresh.is-spinning svg {
                animation: lectio-manager-spin 800ms linear infinite;
            }

            @keyframes lectio-manager-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }

            .lectio-manager-refreshed-row {
                padding: 6px 12px;
                font-size: 11px;
                color: #5e6870;
                border-bottom: 1px solid #eef1f2;
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
                overflow-y: auto;
                padding: 6px 8px 10px;
            }

            .lectio-manager-loading {
                padding: 16px 8px;
                color: #5e6870;
                text-align: center;
                font-size: 12px;
            }

            .lectio-manager-card {
                padding: 8px 6px;
                border-bottom: 1px solid #eef1f2;
            }

            .lectio-manager-card:last-child {
                border-bottom: none;
            }

            .lectio-manager-card-main {
                margin-bottom: 6px;
            }

            .lectio-manager-card-name {
                font-weight: 700;
                font-size: 13px;
                display: flex;
                align-items: baseline;
                gap: 6px;
            }

            .lectio-manager-card-audience {
                font-weight: 400;
                font-size: 10px;
                color: #5e6870;
                text-transform: uppercase;
                letter-spacing: .02em;
            }

            .lectio-manager-card-desc {
                margin-top: 2px;
                font-size: 12px;
                color: #394a57;
                line-height: 1.35;
            }

            .lectio-manager-card-status {
                display: flex;
                align-items: center;
                gap: 8px;
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

            .lectio-manager-install-btn,
            .lectio-manager-settings-btn {
                margin-left: auto;
                border: 1px solid #0f6f6f;
                color: #0f6f6f;
                background: #ffffff;
                border-radius: 6px;
                padding: 3px 10px;
                font-size: 11px;
                font-weight: 600;
                text-decoration: none;
                cursor: pointer;
            }

            .lectio-manager-install-btn:hover,
            .lectio-manager-settings-btn:hover {
                background: #e8f3f3;
            }

            .lectio-manager-settings {
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px dashed #d6dde0;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .lectio-manager-settings[hidden] {
                display: none !important;
            }

            .lectio-manager-setting-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                font-size: 12px;
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
