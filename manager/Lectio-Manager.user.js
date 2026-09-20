// ==UserScript==
// @name         Lectio Manager
// @namespace    https://www.lectio.dk/
// @version      1.21.0
// @description  Discover, install, and manage independent Lectio Tampermonkey modules, including their settings and shared dock controls.
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
     * routes, shows status, and hosts generic settings and dock controls.
     *
     * It must never download and eval() module JavaScript, bundle
     * feature code, or touch Tampermonkey's own enable/disable
     * switches. Catalogue fields are rendered as text/links only.
     */

    /*
     * LANGUAGE
     * --------
     * Lectio itself is Danish, so a module running on its own has no reason to
     * be anything else and defaults to Danish. The Manager is the exception: it
     * exists mainly for IB students, so its own interface starts in English and
     * offers Danish as a setting.
     *
     * Whatever the Manager is set to is published on the <html> element as
     * data-lectio-language and announced on lectio-manager:language, so a module
     * can follow the person's one choice instead of guessing. The order a module
     * should read is: that attribute, then documentElement.lang (which Lectio
     * sets, and English Mode overrides), then Danish.
     */
    const LANGUAGES = ['en', 'da'];
    const DEFAULT_LANGUAGE = 'en';
    const LANGUAGE_ATTRIBUTE = 'lectioLanguage';

    const TEXT = {
        en: {
            appTitle: 'Lectio Tools',
            settingsBtn: 'Manager settings',
            settingsBtnChannel: (channel) => `Manager settings — channel: ${channel}`,
            helpBtn: 'How to disable, update, or remove a script',
            refreshBtn: 'Refresh catalogue',
            close: 'Close',
            closePanel: 'Close panel',
            dockToolbar: 'Lectio tools',
            dockPanel: 'Dock panel',
            language: 'Language',
            languageInfo: 'What does this change?',
            languageHelp: 'This sets the language of the Manager itself, and tells any module that supports it which language you prefer. Lectio is Danish, so a module on its own stays Danish until you choose otherwise.',
            releaseChannel: 'Release channel',
            releaseChannelInfo: 'What is a release channel?',
            releaseChannelHelp: 'A release channel decides which list of modules the Manager reads. <strong>Stable</strong> offers finished modules only. <strong>Unstable</strong> also offers experimental ones that are still being built, so they can change or break without warning.',
            unstableNote: 'Unstable adds experimental modules from modules-unstable. Switching channel only changes what the Manager offers. It never installs, disables, or removes a userscript automatically.',
            stable: 'Stable',
            unstable: 'Unstable',
            dock: 'Dock',
            screenEdge: 'Screen edge',
            positionOnEdge: 'Position on edge',
            iconSize: 'Icon size',
            edgeLeft: 'Left',
            edgeRight: 'Right',
            edgeTop: 'Top',
            edgeBottom: 'Bottom',
            alignVertical: { start: 'Top', center: 'Middle', end: 'Bottom' },
            alignHorizontal: { start: 'Left', center: 'Centre', end: 'Right' },
            sizeAuto: 'Auto',
            sizeSmall: 'Small',
            sizeNormal: 'Normal',
            sizeLarge: 'Large',
            dockOpacity: 'Dock background',
            itemOpacity: 'Icon background',
            shrinkToFit: 'Shrink icons to fit the screen',
            autoHide: 'Auto-hide until hovered or focused',
            resetDockOrder: 'Reset dock order',
            dockWarning: 'The dock only appears when a module is using it. Drag an icon, or press Ctrl with an arrow key, to reorder.',
            helpPanel: 'The Manager shows available module updates and opens Tampermonkey’s normal confirmation page. To disable, manually check, or remove a script, click the Tampermonkey icon in your browser toolbar and choose <strong>Dashboard</strong>.',
            updateTip: 'Get automatic updates: open Tampermonkey → Settings → enable "Check for updates".',
            dismissTip: 'Dismiss tip',
            selfUpdate: (available, running) => `Lectio Manager v${available} is available (you have v${running}).`,
            update: 'Update',
            downgrade: 'Downgrade',
            install: 'Install',
            installTest: 'Install test',
            installed: 'Installed',
            backToInstalled: '← Installed',
            available: 'Available',
            modules: 'Modules',
            allModules: 'All available modules',
            audience: 'Audience',
            student: 'Student',
            teacher: 'Teacher',
            category: 'Category',
            sortByName: 'A–Z',
            experimental: 'Experimental',
            notActiveHere: 'Not active on this page',
            notDetected: 'Not detected',
            settings: 'Settings',
            remove: 'Remove',
            removeHint: 'Remove from Installed — use this only if you have uninstalled the module in Tampermonkey.',
            loading: 'Loading catalogue…',
            noInstalled: 'No installed modules detected yet.',
            allInstalled: 'All available modules are installed.',
            noneMatch: 'No available modules match this filter.',
            updateAvailable: (version, installed) => `Update available: v${version} (installed v${installed})`,
            channelTarget: (channel, version, installed) => `${channel} target: v${version} (installed v${installed})`,
            selectedTarget: 'Selected',
            lastRefreshed: (time) => `Last refreshed: ${time}`,
            neverRefreshed: 'not refreshed yet',
            refreshedJustNow: 'Catalogue updated just now',
            refreshFailedAll: 'Could not load the module catalogue.',
            refreshFailedSome: (detail) => `Could not refresh everything - showing last valid data. ${detail}`,
            settingInfo: (label) => `What does “${label}” do?`,
            choose: 'Choose',
            run: 'Run',
            reportIssue: 'Report a bug or idea'
        },
        da: {
            appTitle: 'Lectio Tools',
            settingsBtn: 'Indstillinger for Manager',
            settingsBtnChannel: (channel) => `Indstillinger for Manager — kanal: ${channel}`,
            helpBtn: 'Sådan slår du et script fra, opdaterer eller fjerner det',
            refreshBtn: 'Opdater kataloget',
            close: 'Luk',
            closePanel: 'Luk panelet',
            dockToolbar: 'Lectio-værktøjer',
            dockPanel: 'Dokpanel',
            language: 'Sprog',
            languageInfo: 'Hvad ændrer det?',
            languageHelp: 'Dette vælger sproget i selve Manageren og fortæller de moduler, der understøtter det, hvilket sprog du foretrækker. Lectio er dansk, så et modul, der kører alene, bliver på dansk, indtil du vælger andet.',
            releaseChannel: 'Udgivelseskanal',
            releaseChannelInfo: 'Hvad er en udgivelseskanal?',
            releaseChannelHelp: 'En udgivelseskanal afgør, hvilken liste over moduler Manageren læser. <strong>Stabil</strong> tilbyder kun færdige moduler. <strong>Ustabil</strong> tilbyder også eksperimentelle moduler, der stadig er under udvikling, og som derfor kan ændre sig eller gå i stykker uden varsel.',
            unstableNote: 'Ustabil tilføjer eksperimentelle moduler fra modules-unstable. At skifte kanal ændrer kun, hvad Manageren tilbyder dig. Den installerer, deaktiverer eller fjerner aldrig et userscript af sig selv.',
            stable: 'Stabil',
            unstable: 'Ustabil',
            dock: 'Dok',
            screenEdge: 'Skærmkant',
            positionOnEdge: 'Placering på kanten',
            iconSize: 'Ikonstørrelse',
            edgeLeft: 'Venstre',
            edgeRight: 'Højre',
            edgeTop: 'Top',
            edgeBottom: 'Bund',
            alignVertical: { start: 'Øverst', center: 'Midt', end: 'Nederst' },
            alignHorizontal: { start: 'Venstre', center: 'Midt', end: 'Højre' },
            sizeAuto: 'Automatisk',
            sizeSmall: 'Lille',
            sizeNormal: 'Normal',
            sizeLarge: 'Stor',
            dockOpacity: 'Dokkens baggrund',
            itemOpacity: 'Ikonernes baggrund',
            shrinkToFit: 'Formindsk ikoner, så de passer til skærmen',
            autoHide: 'Skjul automatisk, indtil musen eller fokus er på den',
            resetDockOrder: 'Nulstil dokkens rækkefølge',
            dockWarning: 'Dokken vises kun, når et modul bruger den. Træk et ikon, eller hold Ctrl nede og brug piletasterne, for at ændre rækkefølgen.',
            helpPanel: 'Manageren viser tilgængelige modulopdateringer og åbner Tampermonkeys egen bekræftelsesside. For at slå et script fra, tjekke manuelt eller fjerne det skal du klikke på Tampermonkey-ikonet i browserens værktøjslinje og vælge <strong>Dashboard</strong>.',
            updateTip: 'Få automatiske opdateringer: åbn Tampermonkey → Indstillinger → slå "Check for updates" til.',
            dismissTip: 'Skjul tippet',
            selfUpdate: (available, running) => `Lectio Manager v${available} er tilgængelig (du har v${running}).`,
            update: 'Opdater',
            downgrade: 'Nedgrader',
            install: 'Installer',
            installTest: 'Installer test',
            installed: 'Installeret',
            backToInstalled: '← Installeret',
            available: 'Tilgængelige',
            modules: 'Moduler',
            allModules: 'Alle tilgængelige moduler',
            audience: 'Målgruppe',
            student: 'Elev',
            teacher: 'Lærer',
            category: 'Kategori',
            sortByName: 'A–Å',
            experimental: 'Eksperimentel',
            notActiveHere: 'Ikke aktiv på denne side',
            notDetected: 'Ikke fundet',
            settings: 'Indstillinger',
            remove: 'Fjern',
            removeHint: 'Fjern fra Installeret — brug kun dette, hvis du har afinstalleret modulet i Tampermonkey.',
            loading: 'Henter kataloget…',
            noInstalled: 'Ingen installerede moduler fundet endnu.',
            allInstalled: 'Alle tilgængelige moduler er installeret.',
            noneMatch: 'Ingen tilgængelige moduler matcher dette filter.',
            updateAvailable: (version, installed) => `Opdatering tilgængelig: v${version} (installeret v${installed})`,
            channelTarget: (channel, version, installed) => `${channel} mål: v${version} (installeret v${installed})`,
            selectedTarget: 'Valgt',
            lastRefreshed: (time) => `Sidst opdateret: ${time}`,
            neverRefreshed: 'ikke opdateret endnu',
            refreshedJustNow: 'Kataloget er lige opdateret',
            refreshFailedAll: 'Kunne ikke hente modulkataloget.',
            refreshFailedSome: (detail) => `Kunne ikke opdatere alt - viser senest gyldige data. ${detail}`,
            settingInfo: (label) => `Hvad gør “${label}”?`,
            choose: 'Vælg',
            run: 'Kør',
            reportIssue: 'Rapportér en fejl eller idé'
        }
    };

    /*
     * The Catalogue is written once, in English, and read by everyone. Two kinds
     * of value in it reach the screen and so need translating.
     *
     * Category and audience are a small, closed vocabulary the repository
     * controls, so they are translated here rather than repeated in the JSON for
     * every module that uses them. An unknown value falls through unchanged,
     * which is what should happen to a category invented after this table.
     *
     * A module's name and description are prose belonging to that module, so
     * they live with it: a Catalogue entry may carry an optional `i18n` block
     * (see localizedField). Neither is required - an untranslated module shows
     * its English description, which is the honest thing to do.
     */
    const CATALOGUE_VOCABULARY = {
        da: {
            Interface: 'Brugerflade',
            Timetable: 'Skema',
            Messages: 'Beskeder',
            Schedule: 'Skema',
            Testing: 'Test',
            General: 'Generelt',
            student: 'elev',
            teacher: 'lærer'
        }
    };

    function translateVocabulary(value) {
        return CATALOGUE_VOCABULARY[language]?.[value] ?? value;
    }

    // A Catalogue entry may carry { i18n: { da: { description: '…' } } }.
    function localizedField(entry, field) {
        const translated = entry?.i18n?.[language]?.[field];
        return isNonEmptyString(translated) ? translated : entry?.[field];
    }

    let language = DEFAULT_LANGUAGE;

    // Falls back to English for any key a translation has not caught up with,
    // so a missing string is an English string rather than a blank control.
    function t(key, ...args) {
        const value = TEXT[language]?.[key] ?? TEXT.en[key];
        if (value === undefined) return key;
        return typeof value === 'function' ? value(...args) : value;
    }

    // Kept in step with the @version header by scripts/check-versions.mjs. The
    // header is metadata Tampermonkey reads; this is the only copy the running
    // script can see, and it is what the self-update notice compares.
    const MANAGER_VERSION = '1.21.0';

    const STABLE_CATALOGUE_URL =
        'https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/catalogue/modules.json';

    const UNSTABLE_CATALOGUE_URL =
        'https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/modules.json';

    const APPROVED_HOST =
        'raw.githubusercontent.com';

    const APPROVED_PATH_PREFIX =
        '/RktRobinhood/Lectio-Scripts/';

    const STABLE_REFRESH_INTERVAL_MS =
        24 * 60 * 60 * 1000;

    const UNSTABLE_REFRESH_INTERVAL_MS =
        5 * 60 * 1000;

    const DISCOVER_EVENT = 'lectio-manager:discover';
    const LANGUAGE_EVENT = 'lectio-manager:language';
    const REGISTER_EVENT = 'lectio-module:register';
    const SET_SETTING_EVENT = 'lectio-manager:set-setting';
    const PREVIEW_SETTING_EVENT = 'lectio-manager:preview-setting';
    const CLEAR_SETTING_PREVIEW_EVENT = 'lectio-manager:clear-setting-preview';
    const DOCK_REGISTER_EVENT = 'lectio-manager:dock:register';
    const DOCK_UPDATE_EVENT = 'lectio-manager:dock:update';
    const DOCK_REMOVE_EVENT = 'lectio-manager:dock:remove';
    const DOCK_ACTIVATE_EVENT = 'lectio-manager:dock:activate';
    const DOCK_RENDER_PANEL_EVENT = 'lectio-manager:dock:render-panel';

    // Keep the original stable cache keys so existing users do not lose their
    // last-known-good production catalogue during this upgrade.
    const STORAGE_CATALOGUE = 'lectioManager.catalogue.v1';
    const STORAGE_LAST_REFRESH = 'lectioManager.lastRefresh.v1';

    // The experimental overlay is cached separately. This is important: deleting
    // an unstable module from GitHub must never pollute the stable catalogue.
    const STORAGE_UNSTABLE_CATALOGUE = 'lectioManager.catalogue.unstable.v1';
    const STORAGE_UNSTABLE_LAST_REFRESH = 'lectioManager.lastRefresh.unstable.v1';
    const STORAGE_RELEASE_CHANNEL = 'lectioManager.releaseChannel.v1';
    const STORAGE_LANGUAGE = 'lectioManager.language.v1';

    const STORAGE_VIEW = 'lectioManager.view.v1';
    const STORAGE_SORT_MODE = 'lectioManager.sortMode.v1';
    const STORAGE_UPDATE_TIP_DISMISSED = 'lectioManager.updateTipDismissed.v1';
    const STORAGE_INSTALLED = 'lectioManager.installed.v1';
    const STORAGE_DOCK = 'lectioManager.dock.v1';

    const ISSUES_URL = 'https://github.com/RktRobinhood/Lectio-Scripts/issues/new/choose';

    const AUDIENCE_VIEW_PREFIX = 'audience:';
    const CATEGORY_VIEW_PREFIX = 'category:';

    const LOG = '[Lectio Manager]';

    // `catalogue` remains the catalogue the UI renders. Stable mode points at
    // the production catalogue; Unstable mode overlays modules-unstable on top.
    // Keeping this single effective catalogue means the proven v1.13.4 UI and
    // settings machinery below can remain almost entirely unchanged.
    let catalogue = null;
    let stableCatalogue = null;
    let unstableCatalogue = null;
    let lastRefresh = 0;
    let unstableLastRefresh = 0;
    let releaseChannel = 'stable';
    let refreshing = false;
    let elements = null;
    let updatedLabelTimer = null;
    let currentView = 'installed';
    let sortMode = 'category';
    let openSettingsModuleId = null;
    let pendingSettingsRefresh = null;
    let dockElements = null;
    let dockPreferences = null;
    let pointerDockDrag = null;
    let suppressDockClickKey = null;
    let openDockPanelKey = null;

    const dockItems = new Map();

    // Modules that registered on THIS page load. A module only registers where its
    // own @match lets it run, so this is "active here", not "installed".
    const detected = new Map();

    // Modules seen at least once on any Lectio page, persisted across page loads.
    // This is what Installed/Available are counted from.
    const installed = new Map();

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

        stableCatalogue = loadCachedCatalogue(STORAGE_CATALOGUE);
        unstableCatalogue = loadCachedCatalogue(STORAGE_UNSTABLE_CATALOGUE);
        lastRefresh = Number(GM_getValue(STORAGE_LAST_REFRESH, 0)) || 0;
        unstableLastRefresh = Number(GM_getValue(STORAGE_UNSTABLE_LAST_REFRESH, 0)) || 0;
        releaseChannel = normalizeReleaseChannel(GM_getValue(STORAGE_RELEASE_CHANNEL, 'stable'));
        language = normalizeLanguage(GM_getValue(STORAGE_LANGUAGE, DEFAULT_LANGUAGE));
        // Published before anything is built, so a module that loads alongside
        // the Manager sees the choice on its first read rather than starting in
        // one language and being corrected.
        publishLanguage({ announce: false });
        catalogue = buildEffectiveCatalogue();
        currentView = normalizeView(GM_getValue(STORAGE_VIEW, 'installed'));
        sortMode = normalizeSortMode(GM_getValue(STORAGE_SORT_MODE, 'category'));
        dockPreferences = loadDockPreferences();
        loadInstalledRegistry();

        buildUI();
        buildDock();
        applyStaticText();
        renderModuleList();
        updateRefreshedLabel({ justUpdated: false });
        updateChannelUI();

        window.addEventListener(REGISTER_EVENT, handleModuleRegister);
        window.addEventListener(DOCK_REGISTER_EVENT, handleDockRegister);
        window.addEventListener(DOCK_UPDATE_EVENT, handleDockUpdate);
        window.addEventListener(DOCK_REMOVE_EVENT, handleDockRemove);
        window.addEventListener('resize', updateDockFit, { passive: true });
        requestDiscovery();

        const stableAge = Date.now() - lastRefresh;
        const unstableAge = Date.now() - unstableLastRefresh;
        const stableStale = !stableCatalogue || stableAge > STABLE_REFRESH_INTERVAL_MS;
        const unstableStale = releaseChannel === 'unstable' &&
            (!unstableCatalogue || unstableAge > UNSTABLE_REFRESH_INTERVAL_MS);

        if (stableStale || unstableStale) {
            refreshCatalogue({ force: false });
        }
    }

    // ============================================================
    // CATALOGUE: CACHE
    // ============================================================

    function loadCachedCatalogue(storageKey) {
        const raw = GM_getValue(storageKey, '');

        if (!raw) {
            return null;
        }

        try {
            return validateCatalogue(raw);
        } catch (error) {
            console.warn(LOG, `Discarding invalid cached catalogue (${storageKey}):`, error.message);
            return null;
        }
    }

    function saveCatalogueCache(validatedCatalogue, timestamp, { unstable = false } = {}) {
        try {
            GM_setValue(
                unstable ? STORAGE_UNSTABLE_CATALOGUE : STORAGE_CATALOGUE,
                JSON.stringify(validatedCatalogue)
            );
            GM_setValue(
                unstable ? STORAGE_UNSTABLE_LAST_REFRESH : STORAGE_LAST_REFRESH,
                timestamp
            );
        } catch (error) {
            console.warn(LOG, 'Could not persist catalogue cache:', error);
        }
    }

    // ============================================================
    // CATALOGUE: FETCH + VALIDATE
    // ============================================================

    async function refreshCatalogue({ force = true } = {}) {
        if (refreshing) {
            return;
        }

        refreshing = true;
        setRefreshingUI(true);

        const errors = [];
        let refreshedAnything = false;

        try {
            const now = Date.now();
            const stableStale = !stableCatalogue ||
                (now - lastRefresh) > STABLE_REFRESH_INTERVAL_MS;

            if (force || stableStale) {
                try {
                    const raw = await fetchCatalogueText(STABLE_CATALOGUE_URL);
                    const validated = validateCatalogue(raw);
                    stableCatalogue = validated;
                    lastRefresh = Date.now();
                    saveCatalogueCache(validated, lastRefresh);
                    refreshedAnything = true;
                } catch (error) {
                    errors.push(`Stable catalogue: ${error.message}`);
                }
            }

            if (releaseChannel === 'unstable') {
                const unstableStale = !unstableCatalogue ||
                    (now - unstableLastRefresh) > UNSTABLE_REFRESH_INTERVAL_MS;

                if (force || unstableStale) {
                    try {
                        // Always request the overlay with a cache-busting URL. The
                        // unstable catalogue changes often while it is being tested.
                        const raw = await fetchCatalogueText(UNSTABLE_CATALOGUE_URL);
                        const validated = validateCatalogue(raw);
                        unstableCatalogue = validated;
                        unstableLastRefresh = Date.now();
                        saveCatalogueCache(validated, unstableLastRefresh, { unstable: true });
                        refreshedAnything = true;
                    } catch (error) {
                        errors.push(`Unstable overlay: ${error.message}`);
                    }
                }
            }

            catalogue = buildEffectiveCatalogue();

            if (errors.length) {
                console.warn(LOG, 'Catalogue refresh partially failed:', errors);
                showError(
                    stableCatalogue
                        ? t('refreshFailedSome', errors.join(' | '))
                        : t('refreshFailedAll')
                );
            } else {
                showError(null);
            }

            renderModuleList();
            updateRefreshedLabel({ justUpdated: refreshedAnything });
            updateChannelUI();

        } finally {
            refreshing = false;
            setRefreshingUI(false);
        }
    }

    function fetchCatalogueText(baseUrl) {
        return new Promise((resolve, reject) => {
            const separator = baseUrl.includes('?') ? '&' : '?';
            const url = `${baseUrl}${separator}ts=${Date.now()}`;

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
                aliases: Array.isArray(entry.aliases) ? entry.aliases.filter(isNonEmptyString) : [],
                status: isNonEmptyString(entry.status) ? entry.status : 'stable',
                i18n: validateTranslations(entry.i18n),
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
            manager: validateManagerEntry(parsed.manager),
            modules
        };
    }

    /*
     * The Manager is not a module - it is in no channel and registers with
     * nobody - but it is the one script here that cannot tell you it is out of
     * date. Modules get an "Update available" row because the Manager compares
     * their registered version against the catalogue; the Manager itself has
     * only Tampermonkey's own update check, which is off by default and silent
     * when it is on. So the catalogue carries the Manager's current version too,
     * and the Manager reads its own entry. Optional: an older catalogue without
     * it simply means no notice.
     */
    /*
     * Optional per-module translations from the Catalogue, kept to the two
     * fields that are prose - a name and a description - and to languages this
     * build knows. Everything else in an entry is either machinery or part of
     * the closed vocabulary translated in CATALOGUE_VOCABULARY, so there is
     * nothing to be gained by letting the Catalogue override it, and something
     * to be lost: these strings are rendered as text, never as markup, and the
     * narrower the surface the easier that is to keep true.
     */
    function validateTranslations(value) {
        if (!value || typeof value !== 'object') return null;

        const translations = {};

        for (const code of LANGUAGES) {
            const entry = value[code];
            if (!entry || typeof entry !== 'object') continue;

            const fields = {};
            for (const field of ['name', 'description']) {
                if (isNonEmptyString(entry[field])) fields[field] = entry[field];
            }

            if (Object.keys(fields).length) translations[code] = fields;
        }

        return Object.keys(translations).length ? translations : null;
    }

    function validateManagerEntry(entry) {
        if (!entry || typeof entry !== 'object') return null;

        const { version, installUrl } = entry;

        if (!isNonEmptyString(version) || !isNonEmptyString(installUrl)) return null;
        if (!isApprovedInstallUrl(installUrl)) {
            console.warn(LOG, 'Ignoring manager entry with disallowed installUrl:', installUrl);
            return null;
        }

        return { version, installUrl };
    }

    /*
     * Shown at the top of the panel when the catalogue advertises a newer
     * Manager than the one running. It cannot install anything itself - the link
     * opens the raw userscript, which is what makes Tampermonkey offer its own
     * install page - so this is a notice, not an updater. Deliberately not
     * dismissible: unlike the Tampermonkey tip, it goes away by being acted on,
     * and it only ever appears when there is genuinely something newer.
     */
    function renderManagerUpdateNotice() {
        if (!elements?.selfUpdate) return;

        const entry = catalogue?.manager;
        const comparison = entry ? compareVersions(MANAGER_VERSION, entry.version) : null;

        if (comparison === null || comparison >= 0) {
            elements.selfUpdate.hidden = true;
            return;
        }

        elements.selfUpdateText.textContent = t('selfUpdate', entry.version, MANAGER_VERSION);
        elements.selfUpdateLink.href = entry.installUrl;
        elements.selfUpdate.hidden = false;
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

    function normalizeLanguage(value) {
        return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
    }

    /*
     * One choice, published two ways. The attribute is for modules that read it
     * whenever they happen to render; the event is for modules already running
     * that need to re-render on a change. A module reads, in order:
     * data-lectio-language, then documentElement.lang, then Danish.
     */
    function publishLanguage({ announce = true } = {}) {
        if (document.documentElement) {
            document.documentElement.dataset[LANGUAGE_ATTRIBUTE] = language;
        }

        if (announce) {
            window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { language } }));
        }
    }

    function setLanguage(value) {
        const next = normalizeLanguage(value);
        if (next === language) return;

        language = next;
        GM_setValue(STORAGE_LANGUAGE, language);
        publishLanguage();
        applyStaticText();
        renderModuleList();
        updateRefreshedLabel({ justUpdated: false });
        updateChannelUI();
        syncDockPreferenceControls();
        renderDock();
    }

    /*
     * The Manager builds its chrome once from a template, so switching language
     * cannot go back through that template without tearing the panel down and
     * losing whatever is open. Instead every fixed string is written here, from
     * the same table, on load and again on every change. Anything that already
     * re-renders per catalogue - the module list, the dock - is left to its own
     * render function.
     */
    function applyStaticText() {
        if (!elements) return;

        const { root } = elements;
        const set = (selector, text) => {
            const node = root.querySelector(selector);
            if (node) node.textContent = text;
        };
        const label = (selector, text) => {
            const node = root.querySelector(selector);
            if (!node) return;
            node.title = text;
            node.setAttribute('aria-label', text);
        };

        set('.lectio-manager-title', t('appTitle'));
        label('#lectio-manager-toggle', t('appTitle'));
        label('.lectio-manager-help', t('helpBtn'));
        label('.lectio-manager-refresh', t('refreshBtn'));
        label('.lectio-manager-close', t('close'));

        set('.lectio-manager-language-label label', t('language'));
        label('.lectio-manager-language-info', t('languageInfo'));
        set('.lectio-manager-language-help', t('languageHelp'));

        set('.lectio-manager-channel-label label', t('releaseChannel'));
        label('.lectio-manager-channel-info', t('releaseChannelInfo'));

        const channelHelp = root.querySelector('.lectio-manager-channel-help');
        if (channelHelp) channelHelp.innerHTML = t('releaseChannelHelp');

        set('.lectio-manager-channel-note', t('unstableNote'));

        const channelSelect = root.querySelector('.lectio-manager-channel-select');
        if (channelSelect) {
            channelSelect.querySelector('option[value="stable"]').textContent = t('stable');
            channelSelect.querySelector('option[value="unstable"]').textContent = t('unstable');
        }

        set('.lectio-manager-prefs-section > summary', t('dock'));
        set('.lectio-manager-dock-edge-label', t('screenEdge'));
        set('.lectio-manager-dock-align-label', t('positionOnEdge'));
        set('.lectio-manager-dock-size-label', t('iconSize'));
        set('.lectio-manager-dock-shell-opacity-label', t('dockOpacity'));
        set('.lectio-manager-dock-item-opacity-label', t('itemOpacity'));
        set('.lectio-manager-dock-fit-label', t('shrinkToFit'));
        set('.lectio-manager-dock-autohide-label', t('autoHide'));
        set('.lectio-manager-dock-reset', t('resetDockOrder'));
        set('.lectio-manager-prefs-warning', t('dockWarning'));

        const edgeSelect = root.querySelector('.lectio-manager-dock-edge');
        if (edgeSelect) {
            const edges = { left: 'edgeLeft', right: 'edgeRight', top: 'edgeTop', bottom: 'edgeBottom' };
            for (const option of edgeSelect.options) option.textContent = t(edges[option.value]);
        }

        const sizeSelect = root.querySelector('.lectio-manager-dock-size');
        if (sizeSelect) {
            const sizes = { auto: 'sizeAuto', small: 'sizeSmall', normal: 'sizeNormal', large: 'sizeLarge' };
            for (const option of sizeSelect.options) option.textContent = t(sizes[option.value]);
        }

        const helpPanel = root.querySelector('.lectio-manager-help-panel');
        if (helpPanel) helpPanel.innerHTML = t('helpPanel');

        set('.lectio-manager-tip-text', t('updateTip'));
        label('.lectio-manager-tip-dismiss', t('dismissTip'));
        set('.lectio-manager-self-update-link', t('update'));
        set('.lectio-manager-footer-link', t('reportIssue'));
        set('[data-sort="category"]', t('category'));
        set('[data-sort="name"]', t('sortByName'));
        set('.lectio-manager-settings-back', t('backToInstalled'));

        const tabs = root.querySelector('.lectio-manager-tabs');
        if (tabs) tabs.setAttribute('aria-label', t('modules'));

        const installedTab = root.querySelector('[data-primary-view="installed"]');
        const availableTab = root.querySelector('[data-primary-view="all"]');
        if (installedTab) installedTab.childNodes[0].nodeValue = `${t('installed')} `;
        if (availableTab) availableTab.childNodes[0].nodeValue = `${t('available')} `;

        const dockItems = document.querySelector('.lectio-manager-dock-items');
        if (dockItems) dockItems.setAttribute('aria-label', t('dockToolbar'));

        const flyout = document.querySelector('.lectio-manager-dock-flyout');
        if (flyout) flyout.setAttribute('aria-label', t('dockPanel'));

        const flyoutClose = document.querySelector('.lectio-manager-dock-flyout-close');
        if (flyoutClose) flyoutClose.setAttribute('aria-label', t('closePanel'));

        const languageSelect = root.querySelector('.lectio-manager-language-select');
        if (languageSelect) languageSelect.value = language;
    }

    function normalizeReleaseChannel(value) {
        return value === 'unstable' ? 'unstable' : 'stable';
    }

    function buildEffectiveCatalogue() {
        if (!stableCatalogue) {
            return null;
        }

        const stableModules = stableCatalogue.modules.map((module) => ({
            ...module,
            selectedChannel: 'stable',
            stableModule: module,
            unstableModule: null
        }));

        if (releaseChannel !== 'unstable' || !unstableCatalogue) {
            return {
                ...stableCatalogue,
                modules: stableModules
            };
        }

        const byId = new Map(stableModules.map((module) => [module.id, module]));

        for (const experimental of unstableCatalogue.modules) {
            const stableMatch = findStableMatch(stableCatalogue.modules, experimental);

            if (stableMatch) {
                byId.set(stableMatch.id, {
                    ...stableMatch,
                    ...experimental,
                    id: stableMatch.id,
                    aliases: uniqueStrings([
                        ...(stableMatch.aliases || []),
                        ...(experimental.aliases || []),
                        experimental.id
                    ]),
                    status: 'unstable',
                    selectedChannel: 'unstable',
                    stableModule: stableMatch,
                    unstableModule: experimental
                });
            } else {
                byId.set(experimental.id, {
                    ...experimental,
                    status: 'unstable',
                    selectedChannel: 'unstable',
                    stableModule: null,
                    unstableModule: experimental
                });
            }
        }

        return {
            schemaVersion: 1,
            generatedAt: unstableCatalogue.generatedAt || stableCatalogue.generatedAt,
            // The Manager ships from one place whatever channel is selected, so
            // its entry always comes from the stable catalogue.
            manager: stableCatalogue.manager,
            modules: [...byId.values()]
        };
    }

    function findStableMatch(stableModules, experimental) {
        const experimentalIds = new Set([
            experimental.id,
            ...(experimental.aliases || [])
        ]);

        return stableModules.find((stable) => {
            if (experimentalIds.has(stable.id)) {
                return true;
            }

            const stableIds = new Set([
                stable.id,
                ...(stable.aliases || [])
            ]);

            if (stableIds.has(experimental.id)) {
                return true;
            }

            return [...experimentalIds].some((id) => stableIds.has(id));
        }) || null;
    }

    function uniqueStrings(values) {
        return [...new Set(values.filter(isNonEmptyString))];
    }

    function getViewLabel(view) {
        if (view === 'installed') {
            return t('installed');
        }

        if (view.startsWith(AUDIENCE_VIEW_PREFIX)) {
            const audience = view.slice(AUDIENCE_VIEW_PREFIX.length);
            return audience === 'student' ? t('student') : t('teacher');
        }

        if (view.startsWith(CATEGORY_VIEW_PREFIX)) {
            return translateVocabulary(view.slice(CATEGORY_VIEW_PREFIX.length));
        }

        return t('available');
    }

    // ============================================================
    // INSTALLED REGISTRY
    // ============================================================

    function loadInstalledRegistry() {
        const raw = GM_getValue(STORAGE_INSTALLED, '');

        if (!raw) {
            return;
        }

        try {
            const parsed = JSON.parse(raw);

            if (!parsed || typeof parsed !== 'object') {
                return;
            }

            for (const [id, entry] of Object.entries(parsed)) {
                if (!isNonEmptyString(id) || !entry || typeof entry !== 'object') {
                    continue;
                }

                installed.set(id, {
                    id,
                    name: isNonEmptyString(entry.name) ? entry.name : id,
                    version: isNonEmptyString(entry.version) ? entry.version : '',
                    lastSeenAt: Number(entry.lastSeenAt) || 0
                });
            }
        } catch (_) {
            console.warn(LOG, 'Ignoring malformed installed registry');
        }
    }

    function saveInstalledRegistry() {
        const plain = {};

        for (const [id, entry] of installed) {
            plain[id] = { name: entry.name, version: entry.version, lastSeenAt: entry.lastSeenAt };
        }

        GM_setValue(STORAGE_INSTALLED, JSON.stringify(plain));
    }

    function rememberInstalled(registration) {
        installed.set(registration.id, {
            id: registration.id,
            name: registration.name,
            version: registration.version,
            lastSeenAt: Date.now()
        });

        saveInstalledRegistry();
    }

    function forgetInstalled(moduleId) {
        if (!installed.delete(moduleId)) {
            return;
        }

        detected.delete(moduleId);
        saveInstalledRegistry();
        renderModuleList();
    }

    // A module is installed if it has ever registered, not merely if it is running
    // on the page in front of us: Schedule Summary only matches SkemaNy.aspx, and
    // Unread Message Notifications only matches one school.
    function isInstalled(moduleId) {
        return detected.has(moduleId) || installed.has(moduleId);
    }

    // The record to show on a card: the live registration when the module is running
    // here, otherwise what we last persisted about it.
    function getModuleRecord(moduleId) {
        return detected.get(moduleId) || installed.get(moduleId) || null;
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

        rememberInstalled(detected.get(detail.id));
        renderModuleList({ refreshFocusedSettings: detail.id === openSettingsModuleId });
    }

    function emitSettingChange(moduleId, key, value) {
        window.dispatchEvent(new CustomEvent(SET_SETTING_EVENT, {
            detail: { id: moduleId, key, value }
        }));
    }

    function emitSettingPreview(moduleId, key, value) {
        window.dispatchEvent(new CustomEvent(PREVIEW_SETTING_EVENT, {
            detail: { id: moduleId, key, value }
        }));
    }

    function clearSettingPreview(moduleId, key) {
        window.dispatchEvent(new CustomEvent(CLEAR_SETTING_PREVIEW_EVENT, {
            detail: { id: moduleId, key }
        }));
    }

    // ============================================================
    // SHARED DOCK
    // ============================================================

    // Placement is two independent choices: which screen edge the dock hugs, and
    // where along that edge it sits. The edge also decides the dock's
    // orientation, so a left/right dock is a column and a top/bottom dock a row.
    const DOCK_EDGES = ['left', 'right', 'top', 'bottom'];
    const DOCK_ALIGNMENTS = ['start', 'center', 'end'];

    // v1 stored a single vertical `position` and always hugged the left edge.
    const LEGACY_DOCK_POSITIONS = { top: 'start', center: 'center', bottom: 'end' };

    /*
     * The two fills are deliberately low. The dock is glass: most of what makes
     * it readable is the blur and the saturation boost behind it, not the fill,
     * so a thin fill still reads as a panel while the page keeps showing
     * through. The icons are drawn in currentColor and are never faded - only
     * what sits behind them moves with these numbers.
     */
    const DOCK_SHELL_OPACITY_DEFAULT = 30;
    const DOCK_ITEM_OPACITY_DEFAULT = 60;

    function defaultDockPreferences() {
        return {
            version: 2,
            order: [],
            edge: 'left',
            align: 'center',
            sizeMode: 'auto',
            autoFit: true,
            autoHide: false,
            shellOpacity: DOCK_SHELL_OPACITY_DEFAULT,
            itemOpacity: DOCK_ITEM_OPACITY_DEFAULT
        };
    }

    function clampDockOpacity(value, fallback) {
        const number = Math.round(Number(value));
        if (!Number.isFinite(number)) return fallback;
        return Math.min(100, Math.max(0, number));
    }

    function isVerticalDock(edge = dockPreferences?.edge) {
        return edge === 'left' || edge === 'right';
    }

    function loadDockPreferences() {
        const defaults = defaultDockPreferences();

        try {
            const raw = GM_getValue(STORAGE_DOCK, '');
            if (!raw) return defaults;

            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!parsed || typeof parsed !== 'object') return defaults;

            const migratedAlign = LEGACY_DOCK_POSITIONS[parsed.position];

            return {
                ...defaults,
                order: Array.isArray(parsed.order)
                    ? [...new Set(parsed.order.filter((key) => typeof key === 'string'))]
                    : [],
                edge: DOCK_EDGES.includes(parsed.edge) ? parsed.edge : defaults.edge,
                align: DOCK_ALIGNMENTS.includes(parsed.align)
                    ? parsed.align
                    : (migratedAlign || defaults.align),
                sizeMode: ['auto', 'small', 'normal', 'large'].includes(parsed.sizeMode)
                    ? parsed.sizeMode
                    : defaults.sizeMode,
                autoFit: parsed.autoFit !== false,
                autoHide: parsed.autoHide === true,
                shellOpacity: clampDockOpacity(parsed.shellOpacity, defaults.shellOpacity),
                itemOpacity: clampDockOpacity(parsed.itemOpacity, defaults.itemOpacity)
            };
        } catch (error) {
            console.warn(LOG, 'Discarding invalid dock preferences:', error);
            return defaults;
        }
    }

    function saveDockPreferences() {
        try {
            GM_setValue(STORAGE_DOCK, JSON.stringify(dockPreferences));
        } catch (error) {
            console.warn(LOG, 'Could not persist dock preferences:', error);
        }
    }

    function dockItemKey(moduleId, itemId) {
        return `${moduleId}:${itemId}`;
    }

    function normalizeDockItem(detail, existing = {}) {
        if (!detail || typeof detail !== 'object') return null;

        const moduleId = String(detail.moduleId || '').trim();
        const itemId = String(detail.itemId || '').trim();
        const label = String(detail.label || existing.label || '').trim();

        const validIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
        if (!validIdentifier.test(moduleId) || !validIdentifier.test(itemId) || !label) return null;

        const type = ['action', 'toggle', 'panel', 'status'].includes(detail.type)
            ? detail.type
            : (existing.type || 'action');
        const state = ['default', 'active', 'busy', 'warning', 'error', 'disabled'].includes(detail.state)
            ? detail.state
            : (existing.state || 'default');

        return {
            ...existing,
            moduleId,
            itemId,
            type,
            icon: String(detail.icon || existing.icon || 'default'),
            label,
            tooltip: String(detail.tooltip || existing.tooltip || label),
            badge: detail.badge === undefined ? existing.badge : detail.badge,
            state,
            enabled: detail.enabled === undefined ? existing.enabled !== false : detail.enabled !== false,
            visible: detail.visible === undefined ? existing.visible !== false : detail.visible !== false,
            value: detail.value === undefined ? existing.value === true : detail.value === true,
            defaultPriority: Number.isFinite(Number(detail.defaultPriority))
                ? Number(detail.defaultPriority)
                : (existing.defaultPriority || 100)
        };
    }

    function handleDockRegister(event) {
        const detail = event.detail;
        const moduleId = String(detail?.moduleId || '').trim();
        const itemId = String(detail?.itemId || '').trim();
        const key = dockItemKey(moduleId, itemId);
        const item = normalizeDockItem(detail, dockItems.get(key));

        if (!item) {
            console.warn(LOG, 'Ignoring invalid dock registration. IDs must use letters, digits, dot, underscore, or hyphen; label is required.');
            return;
        }

        dockItems.set(key, item);
        renderDock();
    }

    function handleDockUpdate(event) {
        const detail = event.detail;
        const moduleId = String(detail?.moduleId || '').trim();
        const itemId = String(detail?.itemId || '').trim();
        const key = dockItemKey(moduleId, itemId);
        const existing = dockItems.get(key);

        if (!existing) return;

        const patch = detail.patch && typeof detail.patch === 'object' ? detail.patch : detail;
        const item = normalizeDockItem({ ...existing, ...patch, moduleId, itemId }, existing);
        if (!item) return;

        dockItems.set(key, item);
        renderDock();
    }

    function handleDockRemove(event) {
        const moduleId = String(event.detail?.moduleId || '').trim();
        const itemId = event.detail?.itemId == null ? null : String(event.detail.itemId).trim();

        for (const [key, item] of dockItems) {
            if (item.moduleId === moduleId && (itemId === null || item.itemId === itemId)) {
                dockItems.delete(key);
                if (openDockPanelKey === key) closeDockPanel(false);
            }
        }

        renderDock();
    }

    function buildDock() {
        if (document.getElementById('lectio-manager-dock-root')) return;

        const root = document.createElement('div');
        root.id = 'lectio-manager-dock-root';
        root.hidden = true;
        root.setAttribute('inert', '');
        root.setAttribute('aria-hidden', 'true');
        root.innerHTML = `
            <div class="lectio-manager-dock-shell">
                <div class="lectio-manager-dock-items" role="toolbar" aria-label="Lectio tools"></div>
            </div>
            <div id="lectio-manager-dock-tooltip" class="lectio-manager-dock-tooltip" role="tooltip" hidden></div>
            <section class="lectio-manager-dock-flyout" aria-label="Dock panel" hidden>
                <button type="button" class="lectio-manager-dock-flyout-close" aria-label="Close panel">${closeSvg()}</button>
                <div class="lectio-manager-dock-flyout-content"></div>
            </section>
        `;

        document.body.appendChild(root);

        const items = root.querySelector('.lectio-manager-dock-items');
        const tooltip = root.querySelector('.lectio-manager-dock-tooltip');
        const flyout = root.querySelector('.lectio-manager-dock-flyout');
        const flyoutContent = root.querySelector('.lectio-manager-dock-flyout-content');

        root.querySelector('.lectio-manager-dock-flyout-close')
            .addEventListener('click', closeDockPanel);

        dockElements = { root, items, tooltip, flyout, flyoutContent };
        applyDockPreferences();
    }

    function sortedDockEntries() {
        const savedIndexes = new Map(dockPreferences.order.map((key, index) => [key, index]));

        return [...dockItems.entries()]
            .filter(([, item]) => item.visible)
            .sort(([keyA, itemA], [keyB, itemB]) => {
                const indexA = savedIndexes.has(keyA) ? savedIndexes.get(keyA) : Infinity;
                const indexB = savedIndexes.has(keyB) ? savedIndexes.get(keyB) : Infinity;
                if (indexA !== indexB) return indexA - indexB;
                if (itemA.defaultPriority !== itemB.defaultPriority) {
                    return itemA.defaultPriority - itemB.defaultPriority;
                }
                return keyA.localeCompare(keyB);
            });
    }

    /*
     * Everything a tile's DOM is built from, in one string. Modules re-register
     * their item on every internal render, and most of those registrations say
     * exactly what the last one said - so comparing this is what tells a real
     * change from the far more common no-op.
     */
    function dockItemSignature(item) {
        return JSON.stringify([
            item.type, item.icon, item.label, item.tooltip,
            item.badge === undefined ? null : item.badge,
            item.state, item.enabled, item.value
        ]);
    }

    function renderDock() {
        if (!dockElements) return;

        const entries = sortedDockEntries();
        const visibleKeys = new Set(entries.map(([key]) => key));
        if (openDockPanelKey && (!visibleKeys.has(openDockPanelKey) || dockItems.get(openDockPanelKey)?.type !== 'panel')) {
            closeDockPanel(false);
        }

        /*
         * Reuse every tile whose content is unchanged, and touch the row only
         * when the result differs from what is already there. Rebuilding
         * unconditionally was invisible until a pointer was resting on a tile:
         * the button under it was destroyed and replaced mid-hover, so the
         * hover lift dropped and came back and the arrival nudge started over,
         * once per registration. A module that re-registers on a timer or a
         * DOM observer turned that into a permanent flicker.
         */
        const existing = new Map(
            [...dockElements.items.children].map((element) => [element.dataset.dockKey, element])
        );
        const buttons = entries.map(([key, item]) => {
            const current = existing.get(key);
            if (current && current.dataset.dockSignature === dockItemSignature(item)) {
                current.classList.toggle('is-active', openDockPanelKey === key);
                return current;
            }
            return buildDockItem(key, item);
        });

        const children = [...dockElements.items.children];
        const unchanged = buttons.length === children.length
            && buttons.every((button, index) => button === children[index]);

        if (!unchanged) {
            hideDockTooltip();
            dockElements.items.replaceChildren(...buttons);
        }

        const hasItems = entries.length > 0;
        dockElements.root.hidden = !hasItems;
        dockElements.root.setAttribute('aria-hidden', String(!hasItems));

        if (!hasItems) {
            dockElements.root.setAttribute('inert', '');
            closeDockPanel(false);
        } else {
            dockElements.root.removeAttribute('inert');
        }

        applyDockPreferences();
        window.requestAnimationFrame(updateDockFit);
    }

    function buildDockItem(key, item) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lectio-manager-dock-item';
        button.dataset.dockKey = key;
        button.dataset.dockSignature = dockItemSignature(item);
        button.dataset.state = item.state;
        button.dataset.type = item.type;
        button.classList.toggle('is-active', openDockPanelKey === key);
        button.disabled = !item.enabled || item.state === 'disabled';
        const hasBadge = item.badge !== undefined && item.badge !== null && item.badge !== '' && item.badge !== false;
        button.setAttribute('aria-label', hasBadge ? `${item.label}, ${item.badge} notifications` : item.label);
        button.setAttribute('aria-describedby', 'lectio-manager-dock-tooltip');

        if (item.type === 'toggle') {
            button.setAttribute('aria-pressed', String(item.value));
        }
        if (item.state === 'busy') {
            button.setAttribute('aria-busy', 'true');
        }

        const icon = document.createElement('span');
        icon.className = 'lectio-manager-dock-icon';
        icon.innerHTML = dockIconSvg(item.icon);
        button.appendChild(icon);

        if (hasBadge) {
            const badge = document.createElement('span');
            badge.className = 'lectio-manager-dock-badge';
            badge.textContent = formatDockBadge(item.badge);
            badge.setAttribute('aria-label', `${item.badge} notifications`);
            button.appendChild(badge);
        }

        button.addEventListener('click', () => {
            if (suppressDockClickKey === key) {
                suppressDockClickKey = null;
                return;
            }
            activateDockItem(key);
        });
        button.addEventListener('pointerenter', () => {
            showDockTooltip(button, item.tooltip);
            nudgeDockItem(button);
        });
        button.addEventListener('pointerleave', hideDockTooltip);
        button.addEventListener('focus', () => {
            showDockTooltip(button, item.tooltip);
            nudgeDockItem(button);
        });
        button.addEventListener('blur', hideDockTooltip);
        button.addEventListener('keydown', (event) => {
            // Both axes are accepted whatever the edge, so the shortcut still
            // works when someone's muscle memory does not match the orientation.
            const offsets = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };
            if (!event.ctrlKey || !(event.key in offsets)) return;
            event.preventDefault();
            moveDockItemByKeyboard(key, offsets[event.key]);
        });
        button.addEventListener('pointerdown', (event) => beginPointerDockDrag(event, key, button));
        button.addEventListener('pointermove', updatePointerDockDrag);
        button.addEventListener('pointerup', finishPointerDockDrag);
        button.addEventListener('pointercancel', cancelPointerDockDrag);

        return button;
    }

    /*
     * The nudge is an arrival, not a hover state: it plays once when the
     * pointer or focus reaches a tile and is over before the pointer has
     * settled. Driving it from a class rather than from :hover is what keeps it
     * to one play - a CSS hover trigger restarts the animation on every hover
     * edge, and a pointer crossing a tile's rim can produce several of those in
     * a second, which reads as a tile that will not stop shaking.
     */
    function nudgeDockItem(button) {
        const icon = button.querySelector('.lectio-manager-dock-icon');
        if (!icon || icon.classList.contains('is-nudging')) return;

        icon.classList.add('is-nudging');
        icon.addEventListener('animationend', () => icon.classList.remove('is-nudging'), { once: true });
    }

    function formatDockBadge(value) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 99) return '99+';
        return String(value).slice(0, 4);
    }

    function showDockTooltip(button, text) {
        if (!dockElements || !text || openDockPanelKey) return;

        dockElements.tooltip.textContent = text;
        dockElements.tooltip.hidden = false;
        const rootRect = dockElements.root.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();

        // A column dock centres its tooltip on the item's row; a row dock
        // centres it on the item's column instead. The unused axis is cleared so
        // a stale offset from the previous edge cannot survive a settings change.
        if (isVerticalDock()) {
            dockElements.tooltip.style.left = '';
            dockElements.tooltip.style.top = `${buttonRect.top - rootRect.top + (buttonRect.height / 2)}px`;
        } else {
            dockElements.tooltip.style.top = '';
            dockElements.tooltip.style.left = `${buttonRect.left - rootRect.left + (buttonRect.width / 2)}px`;
        }
    }

    function hideDockTooltip() {
        if (!dockElements) return;
        dockElements.tooltip.hidden = true;
        dockElements.tooltip.textContent = '';
    }

    function beginPointerDockDrag(event, key, button) {
        if (event.button !== 0 || button.disabled) return;

        pointerDockDrag = {
            key,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            targetKey: key,
            dragging: false,
            button
        };
        try {
            button.setPointerCapture?.(event.pointerId);
        } catch (_) {
            // Synthetic events and older engines may not expose an active pointer.
        }
    }

    function updatePointerDockDrag(event) {
        if (!pointerDockDrag || pointerDockDrag.pointerId !== event.pointerId) return;

        const distance = Math.hypot(
            event.clientX - pointerDockDrag.startX,
            event.clientY - pointerDockDrag.startY
        );
        if (!pointerDockDrag.dragging && distance < 6) return;

        pointerDockDrag.dragging = true;
        pointerDockDrag.button.classList.add('is-dragging');
        hideDockTooltip();
        event.preventDefault();

        const target = document.elementFromPoint(event.clientX, event.clientY)
            ?.closest('.lectio-manager-dock-item');
        pointerDockDrag.targetKey = target?.dataset.dockKey || null;

        for (const item of dockElements.items.querySelectorAll('.is-drop-target')) {
            item.classList.remove('is-drop-target');
        }
        if (target && target.dataset.dockKey !== pointerDockDrag.key) {
            target.classList.add('is-drop-target');
        }
    }

    function finishPointerDockDrag(event) {
        if (!pointerDockDrag || pointerDockDrag.pointerId !== event.pointerId) return;

        const { key, targetKey, dragging, button } = pointerDockDrag;
        try {
            button.releasePointerCapture?.(event.pointerId);
        } catch (_) {
            // The pointer may already have been released by the browser.
        }
        clearPointerDockDrag();

        if (dragging) {
            suppressDockClickKey = key;
            if (targetKey !== key) reorderDockItem(key, targetKey);
            window.setTimeout(() => {
                if (suppressDockClickKey === key) suppressDockClickKey = null;
            }, 0);
        }
    }

    function cancelPointerDockDrag(event) {
        if (!pointerDockDrag || pointerDockDrag.pointerId !== event.pointerId) return;
        clearPointerDockDrag();
    }

    function clearPointerDockDrag() {
        if (!pointerDockDrag) return;
        pointerDockDrag.button.classList.remove('is-dragging');
        pointerDockDrag = null;
        for (const item of dockElements.items.querySelectorAll('.is-drop-target')) {
            item.classList.remove('is-drop-target');
        }
    }

    function activateDockItem(key) {
        const item = dockItems.get(key);
        if (!item || !item.enabled || item.state === 'disabled') return;

        if (item.type === 'toggle') {
            item.value = !item.value;
            renderDock();
        }

        if (item.type === 'panel') {
            if (openDockPanelKey === key) {
                closeDockPanel();
            } else {
                openDockPanel(key, item);
            }
        }

        window.dispatchEvent(new CustomEvent(DOCK_ACTIVATE_EVENT, {
            detail: {
                moduleId: item.moduleId,
                itemId: item.itemId,
                type: item.type,
                value: item.type === 'toggle' ? item.value : undefined
            }
        }));
    }

    function openDockPanel(key, item) {
        closeDockPanel(false);
        hideDockTooltip();
        openDockPanelKey = key;
        dockElements.flyoutContent.replaceChildren();
        const mount = document.createElement('div');
        mount.className = 'lectio-manager-dock-module-content';
        dockElements.flyoutContent.appendChild(mount);
        dockElements.flyout.hidden = false;
        dockElements.root.classList.add('has-open-panel');
        dockElements.items.querySelector(`[data-dock-key="${CSS.escape(key)}"]`)?.classList.add('is-active');

        window.dispatchEvent(new CustomEvent(DOCK_RENDER_PANEL_EVENT, {
            detail: {
                moduleId: item.moduleId,
                itemId: item.itemId,
                mount,
                close: closeDockPanel
            }
        }));
    }

    function closeDockPanel(restoreFocus = true) {
        if (!dockElements) return;

        const closingKey = openDockPanelKey;
        openDockPanelKey = null;
        dockElements.flyout.hidden = true;
        dockElements.flyoutContent.replaceChildren();
        dockElements.root.classList.remove('has-open-panel');
        for (const item of dockElements.items.querySelectorAll('.is-active')) {
            item.classList.remove('is-active');
        }
        if (restoreFocus && closingKey) {
            dockElements.items.querySelector(`[data-dock-key="${CSS.escape(closingKey)}"]`)?.focus();
        }
    }

    function reorderDockItem(movingKey, beforeKey) {
        const visibleKeys = sortedDockEntries().map(([key]) => key);
        const fromIndex = visibleKeys.indexOf(movingKey);
        if (fromIndex < 0) return;

        visibleKeys.splice(fromIndex, 1);
        const toIndex = beforeKey === null ? visibleKeys.length : visibleKeys.indexOf(beforeKey);
        visibleKeys.splice(toIndex < 0 ? visibleKeys.length : toIndex, 0, movingKey);
        persistDockOrder(visibleKeys, movingKey);
    }

    function moveDockItemByKeyboard(key, offset) {
        const keys = sortedDockEntries().map(([entryKey]) => entryKey);
        const index = keys.indexOf(key);
        const target = Math.max(0, Math.min(keys.length - 1, index + offset));
        if (index === target) return;

        keys.splice(index, 1);
        keys.splice(target, 0, key);
        persistDockOrder(keys, key);
    }

    function persistDockOrder(visibleKeys, focusKey) {
        const visibleSet = new Set(visibleKeys);
        const fullOrder = [...dockPreferences.order];
        for (const key of visibleKeys) {
            if (!fullOrder.includes(key)) fullOrder.push(key);
        }

        let visibleIndex = 0;
        dockPreferences.order = fullOrder.map((key) => (
            visibleSet.has(key) ? visibleKeys[visibleIndex++] : key
        ));
        saveDockPreferences();
        renderDock();
        dockElements.items.querySelector(`[data-dock-key="${CSS.escape(focusKey)}"]`)?.focus();
    }

    function applyDockPreferences() {
        if (!dockElements) return;

        dockElements.root.dataset.edge = dockPreferences.edge;
        dockElements.root.dataset.align = dockPreferences.align;
        dockElements.root.dataset.orientation = isVerticalDock() ? 'vertical' : 'horizontal';
        dockElements.root.classList.toggle('is-auto-hide', dockPreferences.autoHide);

        /*
         * Both fills are written as ready-made percentages rather than as raw
         * numbers, so the stylesheet can drop them straight into color-mix()
         * and keep its own values as the fallback. The shell's second stop is
         * the weaker end of its gradient, and a tile lifts by a fixed amount
         * under the pointer, which is what keeps an icon readable while it is
         * also the thing being scaled.
         */
        const shellOpacity = clampDockOpacity(dockPreferences.shellOpacity, DOCK_SHELL_OPACITY_DEFAULT);
        const itemOpacity = clampDockOpacity(dockPreferences.itemOpacity, DOCK_ITEM_OPACITY_DEFAULT);
        dockElements.root.style.setProperty('--lectio-dock-shell-fill', `${shellOpacity}%`);
        dockElements.root.style.setProperty('--lectio-dock-shell-fill-fade', `${Math.round(shellOpacity * 0.45)}%`);
        dockElements.root.style.setProperty('--lectio-dock-item-fill', `${itemOpacity}%`);
        dockElements.root.style.setProperty('--lectio-dock-item-fill-hover', `${Math.min(100, itemOpacity + 20)}%`);
        hideDockTooltip();
        syncDockPreferenceControls();
        updateDockFit();
    }

    // "Start" and "end" mean different things on a column than on a row, so the
    // labels follow the chosen edge rather than exposing the raw values.
    function dockAlignmentLabels(edge) {
        return isVerticalDock(edge) ? t('alignVertical') : t('alignHorizontal');
    }

    function syncDockPreferenceControls() {
        if (!elements || !dockPreferences) return;

        const edge = elements.root.querySelector('.lectio-manager-dock-edge');
        const align = elements.root.querySelector('.lectio-manager-dock-align');
        const size = elements.root.querySelector('.lectio-manager-dock-size');
        const fit = elements.root.querySelector('.lectio-manager-dock-fit');
        const autoHide = elements.root.querySelector('.lectio-manager-dock-autohide');

        if (edge) edge.value = dockPreferences.edge;

        if (align) {
            const labels = dockAlignmentLabels(dockPreferences.edge);
            for (const option of align.options) {
                option.textContent = labels[option.value] || option.value;
            }
            align.value = dockPreferences.align;
        }

        if (size) size.value = dockPreferences.sizeMode;
        if (fit) fit.checked = dockPreferences.autoFit;
        if (autoHide) autoHide.checked = dockPreferences.autoHide;

        for (const [selector, value] of [
            ['shell-opacity', dockPreferences.shellOpacity],
            ['item-opacity', dockPreferences.itemOpacity]
        ]) {
            const slider = elements.root.querySelector(`.lectio-manager-dock-${selector}`);
            const readout = elements.root.querySelector(`.lectio-manager-dock-${selector}-value`);
            // Writing the value back mid-drag is harmless - it is the value the
            // drag just produced - and it is what keeps the two in step when the
            // preference changes from anywhere else.
            if (slider) slider.value = String(value);
            if (readout) readout.textContent = `${value}%`;
        }
    }

    function updateDockFit() {
        if (!dockElements || dockElements.root.hidden) return;

        const configuredSizes = { auto: 42, small: 34, normal: 42, large: 50 };
        const itemCount = sortedDockEntries().length;
        const vertical = isVerticalDock();
        // A column is bounded by the window height, a row by its width. Some room
        // is left for Lectio's own chrome at either end of the run.
        const available = vertical
            ? Math.max(120, window.innerHeight - 32)
            : Math.max(120, window.innerWidth - 120);
        let itemSize = configuredSizes[dockPreferences.sizeMode] || 42;
        let gap = itemSize >= 48 ? 7 : 6;

        if (dockPreferences.autoFit && itemCount > 0) {
            const required = (itemCount * itemSize) + ((itemCount - 1) * gap) + 12;
            if (required > available) {
                itemSize = Math.max(30, Math.floor((available - 12 - ((itemCount - 1) * 4)) / itemCount));
                gap = Math.max(3, Math.min(6, Math.floor(itemSize / 7)));
            }
        }

        dockElements.root.style.setProperty('--lectio-dock-item-size', `${itemSize}px`);
        dockElements.root.style.setProperty('--lectio-dock-gap', `${gap}px`);

        /*
         * Only clamp and scroll when the icons genuinely do not fit. A scroll
         * container counts a magnified tile's transform as overflow, so leaving
         * this on permanently meant hovering the first or last icon grew it past
         * the box, raised a scrollbar nobody asked for, and clipped the very
         * animation that caused it. Off, the tile is free to grow over the edge
         * of the shell, which is what a dock is supposed to look like.
         */
        const needed = (itemCount * itemSize) + (Math.max(0, itemCount - 1) * gap) + 12;
        const scrollable = itemCount > 0 && needed > available;

        dockElements.items.classList.toggle('is-scrollable', scrollable);
        dockElements.items.style.maxHeight = scrollable && vertical ? `${available - 12}px` : '';
        dockElements.items.style.maxWidth = scrollable && !vertical ? `${available - 12}px` : '';
    }

    /*
     * Dock icon house style
     * ---------------------
     * One monochrome set, drawn on a 24 grid at stroke-width 2 with round caps
     * and joins, inheriting the theme through currentColor so the dock recolours
     * with everything else rather than sitting on top of it as a sticker sheet.
     *
     * The shapes are not drawn here. They come from Lucide (ISC) in
     * assets/icons/ and are inlined by scripts/build-dock-icons.mjs, because a
     * userscript is one file with no bundler and no runtime fetch. Hand-drawing
     * them is what produced a palette with hollow rings for paint and a refresh
     * arrow that swept the wrong way, so the block below is generated - edit the
     * SVGs or the mapping in that script, never these strings.
     */
    function dockIconSvg(key) {
        const icons = {
        // --- BEGIN GENERATED ICONS (node scripts/build-dock-icons.mjs) ---
            mail: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>', // lucide/mail
            translate: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>', // lucide/languages
            chair: '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M5 18v2"/><path d="M19 18v2"/>', // lucide/armchair
            refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', // lucide/refresh-cw
            settings: '<path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>', // lucide/settings-2
            calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>', // lucide/calendar
            warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>', // lucide/triangle-alert
            info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>', // lucide/info
            bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>', // lucide/bell
            wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>', // lucide/wrench
            palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r="1.15" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1.15" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1.15" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1.15" fill="currentColor"/>', // lucide/palette
            radar: '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>', // lucide/radar
            default: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>', // lucide/circle-dot
        // --- END GENERATED ICONS ---
        };

        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[key] || icons.default}</svg>`;
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
                    <button type="button" class="lectio-manager-channel-btn" title="Manager settings" aria-label="Manager settings" aria-haspopup="true" aria-expanded="false">${settingsSvg()}</button>
                    <button type="button" class="lectio-manager-help" title="How to disable, update, or remove a script" aria-label="How to disable, update, or remove a script" aria-haspopup="true" aria-expanded="false">${helpSvg()}</button>
                    <button type="button" class="lectio-manager-refresh" title="Refresh catalogue" aria-label="Refresh catalogue">${refreshSvg()}</button>
                    <button type="button" class="lectio-manager-close" title="Close" aria-label="Close">${closeSvg()}</button>
                </div>
                <div class="lectio-manager-channel-panel lectio-manager-prefs-panel" hidden>
                    <div class="lectio-manager-prefs-field lectio-manager-channel-field">
                        <span class="lectio-manager-prefs-row-label lectio-manager-language-label">
                            <label for="lectio-manager-language-select">Language</label>
                            <button type="button" class="lectio-manager-setting-info lectio-manager-language-info" aria-controls="lectio-manager-language-help" aria-expanded="false">${helpSvg()}</button>
                        </span>
                        <select id="lectio-manager-language-select" class="lectio-manager-language-select">
                            <option value="en">English</option>
                            <option value="da">Dansk</option>
                        </select>
                    </div>
                    <small id="lectio-manager-language-help" class="lectio-manager-language-help" hidden></small>
                    <div class="lectio-manager-prefs-field lectio-manager-channel-field">
                        <span class="lectio-manager-channel-label">
                            <label for="lectio-manager-channel-select">Release channel</label>
                            <button type="button" class="lectio-manager-setting-info lectio-manager-channel-info" title="What is a release channel?" aria-label="What is a release channel?" aria-controls="lectio-manager-channel-help" aria-expanded="false">${helpSvg()}</button>
                        </span>
                        <select id="lectio-manager-channel-select" class="lectio-manager-channel-select">
                            <option value="stable">Stable</option>
                            <option value="unstable">Unstable</option>
                        </select>
                    </div>
                    <small id="lectio-manager-channel-help" class="lectio-manager-channel-help" hidden>A release channel decides which list of modules the Manager reads. <strong>Stable</strong> offers finished modules only. <strong>Unstable</strong> also offers experimental ones that are still being built, so they can change or break without warning.</small>
                    <small class="lectio-manager-channel-note" hidden>Unstable adds experimental modules from modules-unstable. Switching channel only changes what the Manager offers. It never installs, disables, or removes a userscript automatically.</small>
                    <details class="lectio-manager-prefs-section">
                        <summary>Dock</summary>
                        <label class="lectio-manager-prefs-field">
                            <span class="lectio-manager-dock-edge-label">Screen edge</span>
                            <select class="lectio-manager-dock-edge">
                                <option value="left">Left</option>
                                <option value="right">Right</option>
                                <option value="top">Top</option>
                                <option value="bottom">Bottom</option>
                            </select>
                        </label>
                        <label class="lectio-manager-prefs-field">
                            <span class="lectio-manager-dock-align-label">Position on edge</span>
                            <select class="lectio-manager-dock-align">
                                <option value="start">Top</option>
                                <option value="center">Middle</option>
                                <option value="end">Bottom</option>
                            </select>
                        </label>
                        <label class="lectio-manager-prefs-field">
                            <span class="lectio-manager-dock-size-label">Icon size</span>
                            <select class="lectio-manager-dock-size">
                                <option value="auto">Auto</option>
                                <option value="small">Small</option>
                                <option value="normal">Normal</option>
                                <option value="large">Large</option>
                            </select>
                        </label>
                        <label class="lectio-manager-prefs-field lectio-manager-prefs-range">
                            <span class="lectio-manager-dock-shell-opacity-label">Dock background</span>
                            <input type="range" class="lectio-manager-dock-shell-opacity" min="0" max="100" step="5">
                            <output class="lectio-manager-dock-shell-opacity-value"></output>
                        </label>
                        <label class="lectio-manager-prefs-field lectio-manager-prefs-range">
                            <span class="lectio-manager-dock-item-opacity-label">Icon background</span>
                            <input type="range" class="lectio-manager-dock-item-opacity" min="0" max="100" step="5">
                            <output class="lectio-manager-dock-item-opacity-value"></output>
                        </label>
                        <label class="lectio-manager-prefs-check">
                            <input type="checkbox" class="lectio-manager-dock-fit">
                            <span class="lectio-manager-dock-fit-label">Shrink icons to fit the screen</span>
                        </label>
                        <label class="lectio-manager-prefs-check">
                            <input type="checkbox" class="lectio-manager-dock-autohide">
                            <span class="lectio-manager-dock-autohide-label">Auto-hide until hovered or focused</span>
                        </label>
                        <button type="button" class="lectio-manager-dock-reset">Reset dock order</button>
                        <small class="lectio-manager-prefs-warning">The dock only appears when a module is using it. Drag an icon, or press Ctrl with an arrow key, to reorder.</small>
                    </details>
                </div>
                <div class="lectio-manager-help-panel" hidden>
                    The Manager shows available module updates and opens Tampermonkey's normal confirmation page. To disable, manually check, or remove a script, click the Tampermonkey icon in your browser toolbar and choose <strong>Dashboard</strong>.
                </div>
                <div id="lectio-manager-main-view" class="lectio-manager-main-view">
                    <div class="lectio-manager-self-update" role="status" hidden>
                        <span class="lectio-manager-self-update-text"></span>
                        <a class="lectio-manager-self-update-link" target="_blank" rel="noopener noreferrer">Update</a>
                    </div>
                    <div class="lectio-manager-tip" hidden>
                        <span class="lectio-manager-tip-text">Get automatic updates: open Tampermonkey &rarr; Settings &rarr; enable "Check for updates".</span>
                        <button type="button" class="lectio-manager-tip-dismiss" aria-label="Dismiss tip">&times;</button>
                    </div>
                    <div class="lectio-manager-tabs" role="tablist" aria-label="Modules">
                        <button type="button" class="lectio-manager-tab" data-primary-view="installed" role="tab" aria-controls="lectio-manager-main-view" aria-selected="true">
                            Installed <span class="lectio-manager-installed-count"></span>
                        </button>
                        <button type="button" class="lectio-manager-tab" data-primary-view="all" role="tab" aria-controls="lectio-manager-main-view" aria-selected="false">
                            Available <span class="lectio-manager-available-count"></span>
                        </button>
                    </div>
                    <div class="lectio-manager-nav">
                        <button type="button" class="lectio-manager-nav-trigger" aria-haspopup="true" aria-expanded="false">
                            <span class="lectio-manager-nav-current">All modules</span>
                            ${chevronSvg()}
                        </button>
                        <div class="lectio-manager-nav-menu" role="menu" hidden></div>
                    </div>
                    <div class="lectio-manager-error" hidden></div>
                    <div class="lectio-manager-list-toolbar">
                        <div class="lectio-manager-view-heading"></div>
                        <div class="lectio-manager-sort" aria-label="Sort modules">
                            <button type="button" data-sort="category"></button>
                            <button type="button" data-sort="name"></button>
                        </div>
                    </div>
                    <div class="lectio-manager-list"></div>
                </div>
                <div class="lectio-manager-settings-view" hidden>
                    <div class="lectio-manager-settings-view-header">
                        <button type="button" class="lectio-manager-settings-back"></button>
                        <div class="lectio-manager-settings-title-row">
                            <div>
                                <span class="lectio-manager-settings-category"></span>
                                <strong class="lectio-manager-settings-title"></strong>
                            </div>
                            <span class="lectio-manager-settings-version"></span>
                        </div>
                    </div>
                    <div class="lectio-manager-settings-body"></div>
                </div>
                <div class="lectio-manager-footer">
                    <a class="lectio-manager-footer-link" href="${ISSUES_URL}" target="_blank" rel="noopener noreferrer">Report a bug or idea</a>
                </div>
            </div>
        `;

        document.body.appendChild(root);
        injectStyles();

        const toggle = root.querySelector('#lectio-manager-toggle');
        const panel = root.querySelector('#lectio-manager-panel');
        const channelBtn = root.querySelector('.lectio-manager-channel-btn');
        const channelPanel = root.querySelector('.lectio-manager-channel-panel');
        const helpBtn = root.querySelector('.lectio-manager-help');
        const helpPanel = root.querySelector('.lectio-manager-help-panel');
        const refreshBtn = root.querySelector('.lectio-manager-refresh');
        const closeBtn = root.querySelector('.lectio-manager-close');
        const navTrigger = root.querySelector('.lectio-manager-nav-trigger');
        const navMenu = root.querySelector('.lectio-manager-nav-menu');
        const navCurrent = root.querySelector('.lectio-manager-nav-current');
        const tipBanner = root.querySelector('.lectio-manager-tip');
        const tipDismissBtn = root.querySelector('.lectio-manager-tip-dismiss');
        const mainView = root.querySelector('.lectio-manager-main-view');
        const settingsView = root.querySelector('.lectio-manager-settings-view');

        channelBtn.addEventListener('click', () => {
            const willShow = channelPanel.hidden;
            channelPanel.hidden = !willShow;
            channelBtn.setAttribute('aria-expanded', String(willShow));

            if (willShow) {
                helpPanel.hidden = true;
                helpBtn.setAttribute('aria-expanded', 'false');
            }
        });

        channelPanel.addEventListener('change', (event) => {
            const select = event.target.closest('.lectio-manager-channel-select');
            if (!select) return;
            setReleaseChannel(select.value);
        });

        // "Release channel" means nothing on its own, so the row keeps one line
        // and hides the explanation behind the same info toggle module settings use.
        const infoToggle = (infoSelector, helpSelector) => {
            const info = channelPanel.querySelector(infoSelector);
            const help = channelPanel.querySelector(helpSelector);
            if (!info || !help) return;

            info.addEventListener('click', () => {
                const willShow = help.hidden;
                help.hidden = !willShow;
                info.setAttribute('aria-expanded', String(willShow));
            });
        };

        infoToggle('.lectio-manager-channel-info', '.lectio-manager-channel-help');
        infoToggle('.lectio-manager-language-info', '.lectio-manager-language-help');

        channelPanel.querySelector('.lectio-manager-language-select')
            .addEventListener('change', (event) => setLanguage(event.target.value));

        helpBtn.addEventListener('click', () => {
            const willShow = helpPanel.hidden;
            helpPanel.hidden = !willShow;
            helpBtn.setAttribute('aria-expanded', String(willShow));

            if (willShow) {
                channelPanel.hidden = true;
                channelBtn.setAttribute('aria-expanded', 'false');
            }
        });

        root.querySelector('.lectio-manager-dock-edge').addEventListener('change', (event) => {
            if (!DOCK_EDGES.includes(event.target.value)) return;
            dockPreferences.edge = event.target.value;
            saveDockPreferences();
            applyDockPreferences();
        });

        root.querySelector('.lectio-manager-dock-align').addEventListener('change', (event) => {
            if (!DOCK_ALIGNMENTS.includes(event.target.value)) return;
            dockPreferences.align = event.target.value;
            saveDockPreferences();
            applyDockPreferences();
        });

        root.querySelector('.lectio-manager-dock-size').addEventListener('change', (event) => {
            dockPreferences.sizeMode = event.target.value;
            saveDockPreferences();
            applyDockPreferences();
        });

        /*
         * The dock is behind the settings panel while these are dragged, so the
         * only way to choose a fill is to watch it change: every input event
         * repaints, and the preference is written once the drag settles rather
         * than on every pixel of it.
         */
        for (const [selector, key] of [
            ['shell-opacity', 'shellOpacity'],
            ['item-opacity', 'itemOpacity']
        ]) {
            const slider = root.querySelector(`.lectio-manager-dock-${selector}`);
            if (!slider) continue;

            slider.addEventListener('input', (event) => {
                dockPreferences[key] = clampDockOpacity(event.target.value, dockPreferences[key]);
                applyDockPreferences();
            });
            slider.addEventListener('change', saveDockPreferences);
        }

        root.querySelector('.lectio-manager-dock-fit').addEventListener('change', (event) => {
            dockPreferences.autoFit = event.target.checked;
            saveDockPreferences();
            applyDockPreferences();
        });

        root.querySelector('.lectio-manager-dock-autohide').addEventListener('change', (event) => {
            dockPreferences.autoHide = event.target.checked;
            saveDockPreferences();
            applyDockPreferences();
        });

        root.querySelector('.lectio-manager-dock-reset').addEventListener('click', () => {
            dockPreferences.order = [];
            saveDockPreferences();
            renderDock();
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
                event.stopPropagation();
                currentView = normalizeView(viewItem.dataset.view);
                GM_setValue(STORAGE_VIEW, currentView);
                renderModuleList();
            }
        });

        root.querySelector('.lectio-manager-tabs').addEventListener('click', (event) => {
            const tab = event.target.closest('[data-primary-view]');
            if (!tab) return;

            currentView = normalizeView(tab.dataset.primaryView);
            GM_setValue(STORAGE_VIEW, currentView);
            closeNavMenu();
            renderModuleList();
        });

        root.querySelector('.lectio-manager-sort').addEventListener('click', (event) => {
            const sortItem = event.target.closest('[data-sort]');
            if (!sortItem) return;

            sortMode = normalizeSortMode(sortItem.dataset.sort);
            GM_setValue(STORAGE_SORT_MODE, sortMode);
            renderModuleList();
        });

        root.querySelector('.lectio-manager-settings-back').addEventListener('click', showMainView);

        document.addEventListener('click', (event) => {
            if (!elements) {
                return;
            }

            if (!elements.navMenu.hidden &&
                !elements.navTrigger.contains(event.target) &&
                !elements.navMenu.contains(event.target)) {
                closeNavMenu();
            }

            if (!elements.channelPanel.hidden &&
                !elements.channelBtn.contains(event.target) &&
                !elements.channelPanel.contains(event.target)) {
                elements.channelPanel.hidden = true;
                elements.channelBtn.setAttribute('aria-expanded', 'false');
            }

            if (!elements.panel.hasAttribute('hidden') && !elements.root.contains(event.target)) {
                closePanel();
            }

            if (openDockPanelKey && !dockElements.root.contains(event.target)) {
                closeDockPanel(false);
            }

            for (const previewSelect of document.querySelectorAll('.lectio-manager-preview-select.is-open')) {
                if (!previewSelect.contains(event.target)) {
                    closePreviewSelect(previewSelect);
                }
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !elements) {
                return;
            }

            if (openDockPanelKey) {
                closeDockPanel();
                return;
            }

            if (!elements.navMenu.hidden) {
                closeNavMenu();
                return;
            }

            if (!elements.settingsView.hidden) {
                showMainView();
                return;
            }

            closePanel();
        });

        elements = {
            root,
            panel,
            channelBtn,
            channelPanel,
            refreshBtn,
            navTrigger,
            navMenu,
            navCurrent,
            nav: root.querySelector('.lectio-manager-nav'),
            tabs: [...root.querySelectorAll('.lectio-manager-tab')],
            installedCount: root.querySelector('.lectio-manager-installed-count'),
            availableCount: root.querySelector('.lectio-manager-available-count'),
            sortButtons: [...root.querySelectorAll('.lectio-manager-sort [data-sort]')],
            mainView,
            settingsView,
            settingsBody: root.querySelector('.lectio-manager-settings-body'),
            settingsTitle: root.querySelector('.lectio-manager-settings-title'),
            settingsCategory: root.querySelector('.lectio-manager-settings-category'),
            settingsVersion: root.querySelector('.lectio-manager-settings-version'),
            helpBtn,
            helpPanel,
            list: root.querySelector('.lectio-manager-list'),
            viewHeading: root.querySelector('.lectio-manager-view-heading'),
            errorBox: root.querySelector('.lectio-manager-error'),
            selfUpdate: root.querySelector('.lectio-manager-self-update'),
            selfUpdateText: root.querySelector('.lectio-manager-self-update-text'),
            selfUpdateLink: root.querySelector('.lectio-manager-self-update-link')
        };

        syncDockPreferenceControls();

        // focusout fires before the next element takes focus, so check on the
        // next tick — otherwise moving focus between two controls in the same
        // settings view would look like the view going idle and re-render mid-tab.
        elements.settingsBody.addEventListener('focusout', () => {
            setTimeout(flushPendingSettingsRefresh, 0);
        });
    }

    function setReleaseChannel(value) {
        const next = normalizeReleaseChannel(value);

        if (next === releaseChannel) {
            updateChannelUI();
            return;
        }

        releaseChannel = next;
        GM_setValue(STORAGE_RELEASE_CHANNEL, releaseChannel);
        catalogue = buildEffectiveCatalogue();
        updateChannelUI();
        renderModuleList();

        if (releaseChannel === 'unstable') {
            const age = Date.now() - unstableLastRefresh;
            if (!unstableCatalogue || age > UNSTABLE_REFRESH_INTERVAL_MS) {
                refreshCatalogue({ force: false });
            }
        }
    }

    function updateChannelUI() {
        if (!elements?.channelPanel) {
            return;
        }

        const select = elements.channelPanel.querySelector('.lectio-manager-channel-select');
        if (select) select.value = releaseChannel;

        // The caveat is only worth a line of the panel while it actually applies.
        const note = elements.channelPanel.querySelector('.lectio-manager-channel-note');
        if (note) note.hidden = releaseChannel !== 'unstable';

        elements.channelPanel.classList.toggle('is-unstable', releaseChannel === 'unstable');
        elements.channelBtn.classList.toggle('is-unstable', releaseChannel === 'unstable');
        elements.channelBtn.title = releaseChannel === 'unstable'
            ? t('settingsBtnChannel', t('unstable'))
            : t('settingsBtnChannel', t('stable'));
        elements.channelBtn.setAttribute('aria-label', elements.channelBtn.title);
    }

    function closePanel() {
        if (!elements || elements.panel.hasAttribute('hidden')) {
            return;
        }

        closeAllPreviewSelects();
        elements.panel.setAttribute('hidden', '');
        elements.channelPanel.hidden = true;
        elements.channelBtn.setAttribute('aria-expanded', 'false');
        closeNavMenu();
        showMainView({ restoreFocus: false });
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

    function renderModuleList({ refreshFocusedSettings = true } = {}) {
        if (!elements) {
            return;
        }

        renderNavMenu();
        renderPrimaryTabs();
        renderManagerUpdateNotice();

        const { list, viewHeading } = elements;
        list.innerHTML = '';

        if (!catalogue) {
            const loading = document.createElement('div');
            loading.className = 'lectio-manager-loading';
            loading.textContent = t('loading');
            list.appendChild(loading);
            viewHeading.textContent = '';
            return;
        }

        const modules = getFilteredSortedModules();

        viewHeading.textContent = modules.length
            ? `${getViewLabel(currentView)} · ${modules.length}`
            : getViewLabel(currentView);

        for (const button of elements.sortButtons) {
            const active = button.dataset.sort === sortMode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        }

        if (!modules.length) {
            const empty = document.createElement('div');
            empty.className = 'lectio-manager-loading';
            empty.textContent = getEmptyStateText(currentView);
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
                categoryHeading.textContent = translateVocabulary(module.category);
                list.appendChild(categoryHeading);
            }

            list.appendChild(buildModuleCard(module));
        }

        if (openSettingsModuleId && refreshFocusedSettings) {
            const module = getInstalledDisplayModules().find((entry) => entry.id === openSettingsModuleId)
                || catalogue.modules.find((entry) => entry.id === openSettingsModuleId);
            const registration = detected.get(openSettingsModuleId);
            if (module && registration) {
                refreshFocusedSettingsView(module, registration);
            } else {
                showMainView();
            }
        }
    }

    // A schema can grow while its settings view is open (Subject Colours discovers
    // classes from the timetable a second or two after the page loads). Rebuilding
    // the view is safe most of the time -- a toggle, select, or preview-select all
    // commit atomically, so replacing them afterwards loses nothing, and the open
    // module's own committed change is expected to redraw the panel immediately
    // even mid-preview. A text or range input is different: it holds uncommitted
    // state (a partial keystroke, a drag in progress) between focus and its
    // eventual `change` event, and rebuilding out from under that would discard
    // it. So: rebuild immediately, unless a text/range input has focus, in which
    // case queue the rebuild for the moment that input loses focus.
    function isSettingsBodyBusy() {
        if (!elements) {
            return false;
        }

        const { settingsBody } = elements;
        const active = document.activeElement;

        if (!settingsBody.contains(active) || active === settingsBody) {
            return false;
        }

        return active.tagName === 'INPUT' && (active.type === 'text' || active.type === 'range');
    }

    function refreshFocusedSettingsView(module, registration) {
        if (isSettingsBodyBusy()) {
            pendingSettingsRefresh = { module, registration };
            return;
        }

        pendingSettingsRefresh = null;
        renderFocusedSettings(module, registration);
    }

    function flushPendingSettingsRefresh() {
        if (!pendingSettingsRefresh || isSettingsBodyBusy()) {
            return;
        }

        const { module, registration } = pendingSettingsRefresh;
        pendingSettingsRefresh = null;

        if (openSettingsModuleId === module.id) {
            renderFocusedSettings(module, registration);
        }
    }

    function renderPrimaryTabs() {
        const installedCount = catalogue
            ? getInstalledDisplayModules().length
            : 0;
        const availableCount = catalogue
            ? getAvailableModules().length
            : 0;
        const primaryView = currentView === 'installed' ? 'installed' : 'all';

        elements.installedCount.textContent = String(installedCount);
        elements.availableCount.textContent = String(availableCount);
        for (const tab of elements.tabs) {
            const active = tab.dataset.primaryView === primaryView;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
        }

        elements.nav.hidden = primaryView === 'installed';
    }

    function getFilteredSortedModules() {
        if (!catalogue) {
            return [];
        }

        let filtered;

        if (currentView === 'installed') {
            filtered = getInstalledDisplayModules();
        } else if (currentView.startsWith(AUDIENCE_VIEW_PREFIX)) {
            const audience = currentView.slice(AUDIENCE_VIEW_PREFIX.length);
            filtered = getAvailableModules().filter((module) => !module.audience.length || module.audience.includes(audience));
        } else if (currentView.startsWith(CATEGORY_VIEW_PREFIX)) {
            const category = currentView.slice(CATEGORY_VIEW_PREFIX.length);
            filtered = getAvailableModules().filter((module) => module.category === category);
        } else {
            filtered = getAvailableModules();
        }

        const sorted = filtered.slice();

        if (sortMode === 'name' || currentView.startsWith(CATEGORY_VIEW_PREFIX)) {
            sorted.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            sorted.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
        }

        return sorted;
    }

    function getAvailableModules() {
        return catalogue.modules.filter((module) => !isInstalled(module.id));
    }

    function getInstalledDisplayModules() {
        if (!catalogue) {
            return [];
        }

        const result = catalogue.modules
            .filter((module) => isInstalled(module.id))
            .map((module) => ({ ...module }));

        const seen = new Set(result.map((module) => module.id));

        // Stable mode deliberately hides uninstalled experimental modules, but an
        // experimental module that is already installed must remain manageable.
        if (releaseChannel === 'stable') {
            const overlay = unstableCatalogue?.modules || [];

            for (const record of installed.values()) {
                if (seen.has(record.id)) {
                    continue;
                }

                const experimental = overlay.find((module) => module.id === record.id);
                const looksExperimental = /(?:^|[-.])(alpha|beta|rc|dev|unstable|experimental)(?:[.-]|$)/i
                    .test(String(record.version || ''));

                if (!experimental && !looksExperimental) {
                    continue;
                }

                const live = detected.get(record.id);
                const source = experimental || {};

                result.push({
                    id: record.id,
                    name: source.name || live?.name || record.name || record.id,
                    description: source.description || '',
                    category: source.category || 'Experimental',
                    audience: Array.isArray(source.audience) ? source.audience : [],
                    aliases: Array.isArray(source.aliases) ? source.aliases : [],
                    status: 'unstable',
                    version: source.version || record.version || '',
                    installUrl: source.installUrl || '',
                    supportUrl: source.supportUrl || 'https://github.com/RktRobinhood/Lectio-Scripts/issues',
                    selectedChannel: 'unstable',
                    stableModule: null,
                    unstableModule: experimental || null,
                    outsideSelectedChannel: true
                });
                seen.add(record.id);
            }
        }

        return result;
    }

    function getEmptyStateText(view) {
        if (view === 'installed') {
            return t('noInstalled');
        }

        if (getAvailableModules().length === 0) {
            return t('allInstalled');
        }

        return t('noneMatch');
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

        navMenu.innerHTML = '';

        const topGroup = document.createElement('div');
        topGroup.className = 'lectio-manager-nav-group';
        topGroup.appendChild(buildNavMenuItem('all', t('allModules')));
        navMenu.appendChild(topGroup);

        const audienceGroup = document.createElement('div');
        audienceGroup.className = 'lectio-manager-nav-group';
        audienceGroup.appendChild(buildNavGroupLabel(t('audience')));
        audienceGroup.appendChild(buildNavMenuItem(`${AUDIENCE_VIEW_PREFIX}student`, t('student')));
        audienceGroup.appendChild(buildNavMenuItem(`${AUDIENCE_VIEW_PREFIX}teacher`, t('teacher')));
        navMenu.appendChild(audienceGroup);

        if (categories.length) {
            const categoryGroup = document.createElement('div');
            categoryGroup.className = 'lectio-manager-nav-group';
            categoryGroup.appendChild(buildNavGroupLabel(t('category')));

            for (const category of categories) {
                categoryGroup.appendChild(buildNavMenuItem(`${CATEGORY_VIEW_PREFIX}${category}`, translateVocabulary(category)));
            }

            navMenu.appendChild(categoryGroup);
        }

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

    function buildModuleCard(module) {
        const live = detected.get(module.id);
        const record = getModuleRecord(module.id);
        const compact = currentView === 'installed';

        const card = document.createElement('div');
        card.className = 'lectio-manager-card';
        card.classList.toggle('is-compact', compact);
        card.classList.toggle('is-experimental', isExperimentalModule(module, record));
        card.dataset.moduleId = module.id;
        card.dataset.category = module.category;

        const main = document.createElement('div');
        main.className = 'lectio-manager-card-main';

        const meta = document.createElement('div');
        meta.className = 'lectio-manager-card-meta';

        const category = document.createElement('span');
        category.className = 'lectio-manager-card-category';
        category.textContent = translateVocabulary(module.category);
        meta.appendChild(category);

        if (isExperimentalModule(module, record)) {
            const experimental = document.createElement('span');
            experimental.className = 'lectio-manager-card-experimental';
            experimental.textContent = t('experimental');
            meta.appendChild(experimental);
        }

        if (!compact && module.audience.length) {
            const audience = document.createElement('span');
            audience.className = 'lectio-manager-card-audience';
            audience.textContent = module.audience.map(translateVocabulary).join(' · ');
            meta.appendChild(audience);
        }

        const nameRow = document.createElement('div');
        nameRow.className = 'lectio-manager-card-name';
        nameRow.textContent = localizedField(module, 'name');

        const desc = document.createElement('div');
        desc.className = 'lectio-manager-card-desc';
        desc.textContent = localizedField(module, 'description');

        main.append(meta, nameRow);

        if (!compact) {
            main.appendChild(desc);
        }

        const status = document.createElement('div');
        status.className = 'lectio-manager-card-status';

        const actions = document.createElement('div');
        actions.className = 'lectio-manager-card-actions';

        if (record) {
            const comparison = module.outsideSelectedChannel
                ? 0
                : compareVersions(record.version, module.version);

            const hasUpdate = comparison !== null && comparison < 0;
            const hasDowngrade = comparison !== null && comparison > 0;

            const installedLabel = document.createElement('span');

            installedLabel.className = (hasUpdate || hasDowngrade)
                ? 'lectio-manager-status-update'
                : 'lectio-manager-status-installed';

            if (hasUpdate) {
                installedLabel.textContent =
                    t('updateAvailable', module.version, record.version);
            } else if (hasDowngrade) {
                installedLabel.textContent =
                    t('channelTarget', releaseChannel === 'stable' ? t('stable') : t('selectedTarget'), module.version, record.version);
            } else {
                installedLabel.textContent =
                    `Installed v${record.version || module.version}`;
            }

            status.appendChild(installedLabel);

            if (!live) {
                const idle = document.createElement('span');
                idle.className = 'lectio-manager-status-idle';
                idle.textContent = t('notActiveHere');
                idle.title =
                    `${module.name} is installed but does not run on this Lectio page, so its settings cannot be changed from here.`;
                status.appendChild(idle);
            }

            if ((hasUpdate || hasDowngrade) && isApprovedInstallUrl(module.installUrl)) {
                const updateLink = document.createElement('a');
                updateLink.className = 'lectio-manager-update-btn';
                updateLink.classList.toggle('is-downgrade', hasDowngrade);
                updateLink.href = module.installUrl;
                updateLink.target = '_blank';
                updateLink.rel = 'noopener noreferrer';
                updateLink.textContent = hasDowngrade ? t('downgrade') : t('update');

                updateLink.title = hasDowngrade
                    ? `Open Tampermonkey with the selected ${releaseChannel === 'stable' ? 'Stable' : 'Unstable'} version`
                    : "Open Tampermonkey's update/install page";

                actions.appendChild(updateLink);
            }

            // This is deliberately the original v1.13.4 settings route.
            if (live && live.settingsSchema.length) {
                const settingsBtn = document.createElement('button');
                settingsBtn.type = 'button';
                settingsBtn.className = 'lectio-manager-settings-btn';
                settingsBtn.textContent = t('settings');
                settingsBtn.addEventListener('click', () => showSettingsView(module, live));
                actions.appendChild(settingsBtn);
            }

            if (!live) {
                const forgetBtn = document.createElement('button');
                forgetBtn.type = 'button';
                forgetBtn.className = 'lectio-manager-forget-btn';
                forgetBtn.textContent = t('remove');
                forgetBtn.title =
                    t('removeHint');
                forgetBtn.addEventListener('click', () => forgetInstalled(module.id));
                actions.appendChild(forgetBtn);
            }

        } else {
            const notDetected = document.createElement('span');
            notDetected.className = 'lectio-manager-status-missing';
            notDetected.textContent = t('notDetected');
            status.appendChild(notDetected);

            const installLink = document.createElement('a');
            installLink.className = 'lectio-manager-install-btn';
            installLink.href = module.installUrl;
            installLink.target = '_blank';
            installLink.rel = 'noopener noreferrer';
            installLink.textContent =
                isExperimentalModule(module, null) ? t('installTest') : t('install');

            actions.appendChild(installLink);
        }

        status.appendChild(actions);
        card.append(main, status);

        return card;
    }

    function isExperimentalModule(module, record) {
        if (
            module?.outsideSelectedChannel ||
            module?.status === 'unstable' ||
            module?.selectedChannel === 'unstable'
        ) {
            return true;
        }

        const version = String(record?.version || module?.version || '');

        if (
            /(?:^|[-.])(alpha|beta|rc|dev|unstable|experimental)(?:[.-]|$)/i
                .test(version)
        ) {
            return true;
        }

        return Boolean(
            (unstableCatalogue?.modules || []).find(
                (candidate) =>
                    candidate.id === module?.id &&
                    candidate.version === record?.version
            )
        );
    }

    function showSettingsView(module, registration) {
        openSettingsModuleId = module.id;
        renderFocusedSettings(module, registration);
        closeNavMenu();
        elements.helpPanel.hidden = true;
        elements.helpBtn.setAttribute('aria-expanded', 'false');
        elements.mainView.hidden = true;
        elements.settingsView.hidden = false;

        queueMicrotask(() => {
            if (!elements.settingsView.hidden) {
                elements.settingsView
                    .querySelector('.lectio-manager-settings-back')
                    .focus();
            }
        });
    }

    function renderFocusedSettings(module, registration) {
        elements.settingsTitle.textContent = module.name;
        elements.settingsCategory.textContent = module.category;
        elements.settingsVersion.textContent =
            `v${registration.version || module.version}`;

        const { scrollTop } = elements.settingsBody;

        renderSettingsControls(
            elements.settingsBody,
            module,
            registration
        );

        elements.settingsBody.scrollTop = scrollTop;
    }

    function showMainView({ restoreFocus = true } = {}) {
        if (!elements) {
            return;
        }

        closeAllPreviewSelects();

        const moduleId = openSettingsModuleId;
        openSettingsModuleId = null;

        if (moduleId) {
            currentView = 'installed';
            GM_setValue(STORAGE_VIEW, currentView);
            renderModuleList();
        }

        elements.settingsView.hidden = true;
        elements.mainView.hidden = false;

        if (restoreFocus && moduleId) {
            elements.list
                .querySelector(
                    `[data-module-id="${CSS.escape(moduleId)}"] .lectio-manager-settings-btn`
                )
                ?.focus();
        }
    }

    // ============================================================
    // EVERYTHING BELOW HERE IS THE ORIGINAL v1.13.4 SETTINGS PATH.
    // ============================================================

    function findAdvancedSections(schema) {
        const grouped = new Map();

        for (const control of schema) {
            if (
                !control ||
                !isNonEmptyString(control.key) ||
                !isNonEmptyString(control.type)
            ) {
                continue;
            }

            const sectionName =
                isNonEmptyString(control.section)
                    ? control.section.trim()
                    : '';

            if (!sectionName) {
                continue;
            }

            if (!grouped.has(sectionName)) {
                grouped.set(sectionName, []);
            }

            grouped.get(sectionName).push(control);
        }

        const advanced = new Set();

        for (const [sectionName, controls] of grouped) {
            if (controls.every((control) => control.advanced === true)) {
                advanced.add(sectionName);
            }
        }

        return advanced;
    }

    function renderSettingsControls(container, module, registration) {
        container.innerHTML = '';
        const sections = new Map();
        const advancedSections =
            findAdvancedSections(registration.settingsSchema);

        for (const control of registration.settingsSchema) {
            if (
                !control ||
                !isNonEmptyString(control.key) ||
                !isNonEmptyString(control.type)
            ) {
                continue;
            }

            const sectionName =
                isNonEmptyString(control.section)
                    ? control.section.trim()
                    : '';

            let section = sections.get(sectionName);

            if (!section) {
                const isAdvanced =
                    sectionName &&
                    advancedSections.has(sectionName);

                section =
                    document.createElement(
                        isAdvanced ? 'details' : 'section'
                    );

                section.className =
                    'lectio-manager-settings-section';

                if (sectionName) {
                    const heading =
                        document.createElement(
                            isAdvanced ? 'summary' : 'h3'
                        );

                    heading.className =
                        'lectio-manager-settings-section-heading';

                    heading.textContent = sectionName;

                    section.appendChild(heading);
                }

                const rows = document.createElement('div');
                rows.className =
                    'lectio-manager-settings-section-rows';

                section.appendChild(rows);
                sections.set(sectionName, section);
                container.appendChild(section);
            }

            const row = document.createElement('div');
            row.className = 'lectio-manager-setting-row';

            const copy = document.createElement('div');
            copy.className = 'lectio-manager-setting-copy';

            const labelRow = document.createElement('div');
            labelRow.className =
                'lectio-manager-setting-label-row';

            const label = document.createElement('label');
            label.className =
                'lectio-manager-setting-label';
            label.textContent =
                control.label || control.key;

            labelRow.appendChild(label);
            copy.appendChild(labelRow);

            if (isNonEmptyString(control.description)) {
                const descriptionId =
                    `lectio-manager-setting-desc-${module.id}-${control.key}`
                        .replace(/[^a-zA-Z0-9_-]/g, '-');

                const description =
                    document.createElement('span');

                description.id = descriptionId;
                description.className =
                    'lectio-manager-setting-description';
                description.textContent =
                    control.description;
                description.hidden = true;

                const infoBtn =
                    document.createElement('button');

                infoBtn.type = 'button';
                infoBtn.className =
                    'lectio-manager-setting-info';

                infoBtn.setAttribute(
                    'aria-expanded',
                    'false'
                );

                infoBtn.setAttribute(
                    'aria-controls',
                    descriptionId
                );

                infoBtn.setAttribute(
                    'aria-label',
                    t('settingInfo', control.label || control.key)
                );

                infoBtn.innerHTML = helpSvg();

                infoBtn.addEventListener(
                    'click',
                    () => {
                        const expanded =
                            infoBtn.getAttribute('aria-expanded') === 'true';

                        infoBtn.setAttribute(
                            'aria-expanded',
                            String(!expanded)
                        );

                        description.hidden = expanded;
                    }
                );

                labelRow.appendChild(infoBtn);
                copy.appendChild(description);
            }

            row.appendChild(copy);

            const currentValue =
                registration.currentValues[control.key];

            let input;

            switch (control.type) {
                case 'toggle':
                    row.classList.add('is-toggle');

                    input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = Boolean(currentValue);

                    input.addEventListener(
                        'change',
                        () =>
                            emitSettingChange(
                                module.id,
                                control.key,
                                input.checked
                            )
                    );
                    break;

                case 'select':
                    if (control.previewOnHover === true) {
                        row.classList.add('is-preview-select');

                        input =
                            buildPreviewSelect(
                                module,
                                control,
                                currentValue
                            );
                    } else {
                        input =
                            document.createElement('select');

                        for (const option of control.options || []) {
                            const opt =
                                document.createElement('option');

                            opt.value =
                                option.value ?? option;

                            opt.textContent =
                                option.label ?? option;

                            input.appendChild(opt);
                        }

                        input.value = currentValue ?? '';

                        input.addEventListener(
                            'change',
                            () =>
                                emitSettingChange(
                                    module.id,
                                    control.key,
                                    input.value
                                )
                        );
                    }
                    break;

                case 'range':
                    row.classList.add('is-range');

                    input = document.createElement('input');
                    input.type = 'range';
                    input.min = control.min ?? 0;
                    input.max = control.max ?? 100;
                    input.step = control.step ?? 1;
                    input.value =
                        currentValue ?? control.min ?? 0;

                    {
                        const value =
                            document.createElement('output');

                        value.className =
                            'lectio-manager-range-value';

                        value.textContent =
                            `${input.value}${control.suffix || ''}`;

                        input.addEventListener(
                            'input',
                            () => {
                                value.textContent =
                                    `${input.value}${control.suffix || ''}`;
                            }
                        );

                        row.appendChild(value);
                    }

                    input.addEventListener(
                        'change',
                        () =>
                            emitSettingChange(
                                module.id,
                                control.key,
                                input.value
                            )
                    );
                    break;

                case 'text':
                    input = document.createElement('input');
                    input.type = 'text';
                    input.value = currentValue ?? '';

                    input.addEventListener(
                        'change',
                        () =>
                            emitSettingChange(
                                module.id,
                                control.key,
                                input.value
                            )
                    );
                    break;

                case 'color':
                    row.classList.add('is-color');

                    input = document.createElement('input');
                    input.type = 'color';

                    input.value =
                        /^#[0-9a-f]{6}$/i.test(
                            String(currentValue ?? '')
                        )
                            ? String(currentValue).toLowerCase()
                            : '#808080';

                    input.addEventListener(
                        'change',
                        () =>
                            emitSettingChange(
                                module.id,
                                control.key,
                                input.value
                            )
                    );
                    break;

                case 'button':
                    row.classList.add('is-button');

                    input =
                        document.createElement('button');

                    input.type = 'button';

                    input.textContent =
                        control.buttonLabel ||
                        control.label ||
                        t('run');

                    input.addEventListener(
                        'click',
                        () =>
                            emitSettingChange(
                                module.id,
                                control.key,
                                true
                            )
                    );
                    break;

                default:
                    continue;
            }

            if (input.matches('input, select, textarea')) {
                input.id =
                    `lectio-manager-setting-${module.id}-${control.key}`
                        .replace(/[^a-zA-Z0-9_-]/g, '-');

                label.htmlFor = input.id;

            } else if (
                input.classList.contains(
                    'lectio-manager-preview-select'
                )
            ) {
                label.id =
                    `lectio-manager-setting-label-${module.id}-${control.key}`
                        .replace(/[^a-zA-Z0-9_-]/g, '-');

                input.querySelector(
                    '.lectio-manager-preview-select-trigger'
                )
                    .setAttribute(
                        'aria-labelledby',
                        label.id
                    );
            }

            row.appendChild(input);

            section.querySelector(
                '.lectio-manager-settings-section-rows'
            )
                .appendChild(row);
        }
    }

    function buildPreviewSelect(
        module,
        control,
        currentValue
    ) {
        const options =
            (control.options || []).map(
                (option) => ({
                    value:
                        String(
                            option.value ?? option
                        ),

                    label:
                        String(
                            option.label ?? option
                        )
                })
            );

        const selected =
            options.find(
                (option) =>
                    option.value ===
                    String(currentValue ?? '')
            ) ||
            options[0];

        const wrapper =
            document.createElement('div');

        wrapper.className =
            'lectio-manager-preview-select';

        wrapper.dataset.moduleId =
            module.id;

        wrapper.dataset.settingKey =
            control.key;

        const trigger =
            document.createElement('button');

        trigger.type = 'button';

        trigger.className =
            'lectio-manager-preview-select-trigger';

        trigger.setAttribute(
            'role',
            'combobox'
        );

        trigger.setAttribute(
            'aria-haspopup',
            'listbox'
        );

        trigger.setAttribute(
            'aria-expanded',
            'false'
        );

        trigger.textContent =
            selected?.label || t('choose');

        const menu =
            document.createElement('div');

        menu.className =
            'lectio-manager-preview-select-menu';

        menu.setAttribute(
            'role',
            'listbox'
        );

        menu.hidden = true;

        for (const option of options) {
            const item =
                document.createElement('button');

            item.type = 'button';

            item.className =
                'lectio-manager-preview-select-option';

            item.dataset.previewValue =
                option.value;

            item.setAttribute(
                'role',
                'option'
            );

            item.setAttribute(
                'aria-selected',
                String(
                    option.value ===
                    selected?.value
                )
            );

            item.textContent = option.label;

            const preview = () =>
                emitSettingPreview(
                    module.id,
                    control.key,
                    option.value
                );

            const clearPreview = () =>
                clearSettingPreview(
                    module.id,
                    control.key
                );

            item.addEventListener(
                'mouseenter',
                preview
            );

            item.addEventListener(
                'mouseleave',
                clearPreview
            );

            item.addEventListener(
                'focus',
                preview
            );

            item.addEventListener(
                'blur',
                clearPreview
            );

            item.addEventListener(
                'click',
                (event) => {
                    event.stopPropagation();

                    trigger.textContent =
                        option.label;

                    for (
                        const sibling
                        of menu.querySelectorAll(
                            '[role="option"]'
                        )
                    ) {
                        sibling.setAttribute(
                            'aria-selected',
                            String(sibling === item)
                        );
                    }

                    emitSettingChange(
                        module.id,
                        control.key,
                        option.value
                    );

                    closePreviewSelect(
                        wrapper,
                        { restore: false }
                    );

                    clearSettingPreview(
                        module.id,
                        control.key
                    );
                }
            );

            menu.appendChild(item);
        }

        trigger.addEventListener(
            'click',
            (event) => {
                event.stopPropagation();

                if (
                    wrapper.classList.contains('is-open')
                ) {
                    closePreviewSelect(wrapper);

                } else {
                    for (
                        const other
                        of document.querySelectorAll(
                            '.lectio-manager-preview-select.is-open'
                        )
                    ) {
                        closePreviewSelect(other);
                    }

                    wrapper.classList.add('is-open');
                    menu.hidden = false;

                    trigger.setAttribute(
                        'aria-expanded',
                        'true'
                    );
                }
            }
        );

        trigger.addEventListener(
            'keydown',
            (event) => {
                if (
                    !['ArrowDown', 'ArrowUp']
                        .includes(event.key)
                ) {
                    return;
                }

                event.preventDefault();

                if (
                    !wrapper.classList.contains('is-open')
                ) {
                    trigger.click();
                }

                const items = [
                    ...menu.querySelectorAll(
                        '[role="option"]'
                    )
                ];

                const selectedIndex =
                    Math.max(
                        0,
                        items.findIndex(
                            (item) =>
                                item.getAttribute('aria-selected') ===
                                'true'
                        )
                    );

                items[
                    event.key === 'ArrowUp'
                        ? Math.max(0, selectedIndex - 1)
                        : Math.min(
                            items.length - 1,
                            selectedIndex + 1
                        )
                ]?.focus();
            }
        );

        menu.addEventListener(
            'keydown',
            (event) => {
                const items = [
                    ...menu.querySelectorAll(
                        '[role="option"]'
                    )
                ];

                const index =
                    items.indexOf(
                        document.activeElement
                    );

                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();

                    closePreviewSelect(wrapper);
                    trigger.focus();

                } else if (
                    event.key === 'ArrowDown' ||
                    event.key === 'ArrowUp'
                ) {
                    event.preventDefault();

                    const offset =
                        event.key === 'ArrowDown'
                            ? 1
                            : -1;

                    items[
                        Math.max(
                            0,
                            Math.min(
                                items.length - 1,
                                index + offset
                            )
                        )
                    ]?.focus();
                }
            }
        );

        wrapper.append(trigger, menu);

        return wrapper;
    }

    function closePreviewSelect(
        wrapper,
        { restore = true } = {}
    ) {
        if (
            !wrapper?.classList.contains('is-open')
        ) {
            return;
        }

        wrapper.classList.remove('is-open');

        wrapper
            .querySelector(
                '.lectio-manager-preview-select-menu'
            )
            .hidden = true;

        wrapper
            .querySelector(
                '.lectio-manager-preview-select-trigger'
            )
            .setAttribute(
                'aria-expanded',
                'false'
            );

        if (restore) {
            clearSettingPreview(
                wrapper.dataset.moduleId,
                wrapper.dataset.settingKey
            );
        }
    }

    function closeAllPreviewSelects() {
        for (
            const previewSelect
            of document.querySelectorAll(
                '.lectio-manager-preview-select.is-open'
            )
        ) {
            closePreviewSelect(previewSelect);
        }
    }

    // ============================================================
    // VERSION COMPARISON
    // ============================================================

    function compareVersions(left, right) {
        const a = parseComparableVersion(left);
        const b = parseComparableVersion(right);

        if (!a || !b) {
            return null;
        }

        for (let index = 0; index < 3; index += 1) {
            if (a.core[index] !== b.core[index]) {
                return a.core[index] < b.core[index]
                    ? -1
                    : 1;
            }
        }

        if (!a.pre.length && !b.pre.length) {
            return 0;
        }

        if (!a.pre.length) {
            return 1;
        }

        if (!b.pre.length) {
            return -1;
        }

        const length =
            Math.max(a.pre.length, b.pre.length);

        for (let index = 0; index < length; index += 1) {
            const av = a.pre[index];
            const bv = b.pre[index];

            if (av === undefined) {
                return -1;
            }

            if (bv === undefined) {
                return 1;
            }

            if (av === bv) {
                continue;
            }

            const an =
                /^\d+$/.test(av)
                    ? Number(av)
                    : null;

            const bn =
                /^\d+$/.test(bv)
                    ? Number(bv)
                    : null;

            if (an !== null && bn !== null) {
                return an < bn ? -1 : 1;
            }

            if (an !== null) {
                return -1;
            }

            if (bn !== null) {
                return 1;
            }

            return av.localeCompare(bv) < 0
                ? -1
                : 1;
        }

        return 0;
    }

    function parseComparableVersion(value) {
        const text =
            String(value || '')
                .trim()
                .replace(/^v/i, '');

        const match =
            text.match(
                /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
            );

        if (!match) {
            return null;
        }

        return {
            core: [
                Number(match[1]),
                Number(match[2] || 0),
                Number(match[3] || 0)
            ],

            pre:
                match[4]
                    ? match[4].split('.')
                    : []
        };
    }

    function isVersionNewer(candidate, installed) {
        const comparison =
            compareVersions(installed, candidate);

        return (
            comparison !== null &&
            comparison < 0
        );
    }

    // ============================================================
    // UI: STATUS TEXT
    // ============================================================

    function updateRefreshedLabel({ justUpdated }) {
        if (!elements) {
            return;
        }

        if (!lastRefresh) {
            elements.refreshBtn.title =
                `${t('refreshBtn')} — ${t('neverRefreshed')}`;

            elements.refreshBtn.setAttribute(
                'aria-label',
                `${t('refreshBtn')} — ${t('neverRefreshed')}`
            );

            return;
        }

        window.clearTimeout(updatedLabelTimer);

        if (justUpdated) {
            elements.refreshBtn.title =
                t('refreshedJustNow');

            elements.refreshBtn.setAttribute(
                'aria-label',
                t('refreshedJustNow')
            );

            updatedLabelTimer =
                window.setTimeout(
                    () => {
                        updateRefreshedLabel({
                            justUpdated: false
                        });
                    },
                    5000
                );

        } else {
            const status =
                t('lastRefreshed', formatTime(lastRefresh));

            elements.refreshBtn.title =
                `${t('refreshBtn')} — ${status}`;

            elements.refreshBtn.setAttribute(
                'aria-label',
                `${t('refreshBtn')} — ${status}`
            );
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
        elements.refreshBtn.classList.toggle(
            'is-spinning',
            isRefreshing
        );
    }

    function formatTime(timestamp) {
        if (!timestamp) {
            return '--:--';
        }

        return new Date(timestamp)
            .toLocaleTimeString(
                [],
                {
                    hour: '2-digit',
                    minute: '2-digit'
                }
            );
    }

    // ============================================================
    // ICONS
    // ============================================================

    function gearSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.5-2-3.4-2.2.9a7.6 7.6 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.2-.9-2 3.4L4.6 10.5a7.6 7.6 0 0 0 0 3l-1.9 1.5 2 3.4 2.2-.9c.77.66 1.65 1.17 2.6 1.5l.5 2.4h4l.5-2.4a7.6 7.6 0 0 0 2.6-1.5l2.2.9 2-3.4-1.9-1.5Z"></path></svg>`;
    }

    // Two opposing three-quarter arcs, each closed by its own arrow head. The
    // previous drawing set the large-arc flag on the lower arc, so it swept past
    // 180deg, swallowed the upper arc, and read as a single lopsided half circle.
    function refreshSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 11.5A8 8 0 0 1 17.7 6.3L20.5 9"></path><path d="M20.5 4.5V9H16"></path><path d="M20 12.5A8 8 0 0 1 6.3 17.7L3.5 15"></path><path d="M3.5 19.5V15H8"></path></svg>`;
    }

    function closeSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>`;
    }

    function chevronSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"></path></svg>`;
    }

    // Two sliders rather than a cog: the header renders this at 16px, where the
    // cog's twelve tooth curves collapsed into a smudge, and a cog beside the
    // Manager's own cog-shaped launcher read as the same button twice.
    function settingsSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 8h9"></path><path d="M18 8h2"></path><circle cx="15.5" cy="8" r="2.5"></circle><path d="M4 16h3"></path><path d="M12 16h8"></path><circle cx="8.5" cy="16" r="2.5"></circle></svg>`;
    }

    // The full stop was a filled 0.15-radius circle, which is a third of a device
    // pixel at this size and disappeared. A zero-length round-capped stroke draws
    // a dot the same weight as the rest of the glyph, at any size.
    function helpSvg() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M9.6 9.4a2.5 2.5 0 0 1 4.86.83c0 1.67-2.46 2.1-2.46 3.43"></path><path d="M12 16.9h.01"></path></svg>`;
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
                color: var(--lectio-theme-text, #10201e);
            }

            #lectio-manager-toggle {
                width: 44px;
                height: 44px;
                border-radius: 50%;
                border: none;
                background: var(--lectio-theme-accent, #0f6f6f);
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
                background:
                    color-mix(
                        in srgb,
                        var(--lectio-theme-accent, #0d5f5f) 85%,
                        black
                    );
            }

            #lectio-manager-panel {
                position: absolute;
                right: 0;
                bottom: 54px;
                width: min(390px, calc(100vw - 32px));
                max-height: min(78vh, 640px);
                display: flex;
                flex-direction: column;
                background: var(--lectio-theme-surface, #ffffff);
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
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
                background: var(--lectio-theme-accent, #0f6f6f);
                color: #ffffff;
                border-radius: 10px 10px 0 0;
            }

            .lectio-manager-footer {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 8px 12px;
                border-top: 1px solid var(--lectio-theme-muted, #eef1f2);
                background: var(--lectio-theme-surface-alt, #fafbfb);
                border-radius: 0 0 10px 10px;
            }

            .lectio-manager-footer-link {
                border: none;
                background: transparent;
                padding: 0;
                font-size: 11px;
                font-weight: 600;
                font-family: inherit;
                color: var(--lectio-theme-accent, #0f6f6f);
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

            .lectio-manager-channel-btn,
            .lectio-manager-help,
            .lectio-manager-refresh,
            .lectio-manager-close {
                width: 28px;
                height: 28px;
                border: none;
                background: transparent;
                color: #ffffff;
                text-decoration: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 7px;
                -webkit-tap-highlight-color: transparent;
                transition:
                    background-color 140ms ease,
                    color 140ms ease,
                    transform 140ms cubic-bezier(.2,.7,.3,1);
            }

            .lectio-manager-channel-btn:hover,
            .lectio-manager-channel-btn[aria-expanded='true'],
            .lectio-manager-help:hover,
            .lectio-manager-help[aria-expanded='true'],
            .lectio-manager-refresh:hover,
            .lectio-manager-close:hover {
                background: rgba(255,255,255,.16);
            }

            .lectio-manager-channel-btn:focus-visible,
            .lectio-manager-help:focus-visible,
            .lectio-manager-refresh:focus-visible,
            .lectio-manager-close:focus-visible {
                outline: 2px solid #ffffff;
                outline-offset: 1px;
                background: rgba(255,255,255,.16);
            }

            .lectio-manager-channel-btn:active,
            .lectio-manager-help:active,
            .lectio-manager-refresh:active:not(:disabled),
            .lectio-manager-close:active {
                transform: scale(.9);
            }

            /* The icon moves, not the button, so the hover plate stays still. */
            .lectio-manager-close:hover svg {
                transform: rotate(90deg);
            }

            .lectio-manager-refresh:hover:not(:disabled) svg {
                transform: rotate(-38deg);
            }

            .lectio-manager-refresh:disabled {
                opacity: .6;
                cursor: default;
            }

            /* 16px off a 24 viewBox is a 2:3 scale, so stroke-width 1.8 lands on
               1.2 CSS px instead of the 1.25 that 15px/2 produced — close enough
               to a whole device pixel on a 2x screen to stop the fuzz. The
               geometricPrecision hint keeps curves from being snapped to that
               grid, which is what was eating the small detail. */
            .lectio-manager-channel-btn svg,
            .lectio-manager-help svg,
            .lectio-manager-refresh svg,
            .lectio-manager-close svg {
                width: 16px;
                height: 16px;
                display: block;
                fill: none;
                stroke: currentColor;
                stroke-width: 1.8;
                stroke-linecap: round;
                stroke-linejoin: round;
                shape-rendering: geometricPrecision;
                transform-origin: 50% 50%;
                transition: transform 180ms cubic-bezier(.2,.7,.3,1);
            }

            .lectio-manager-channel-btn.is-unstable {
                color: #ffe2a6;
            }

            .lectio-manager-channel-panel {
                margin: 6px 12px 0;
                padding: 9px 10px;
                background: var(--lectio-theme-surface-alt, #eef3f6);
                color: var(--lectio-theme-text, #2a4250);
                border: 1px solid var(--lectio-theme-muted, #d8e3e9);
                border-radius: 8px;
            }

            .lectio-manager-channel-panel[hidden] {
                display: none !important;
            }

            .lectio-manager-channel-field {
                padding: 1px 1px 7px;
            }

            .lectio-manager-channel-label,
            .lectio-manager-prefs-row-label {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                min-width: 0;
            }

            .lectio-manager-channel-label label {
                cursor: pointer;
            }

            .lectio-manager-channel-help {
                display: block;
                margin: 0 0 8px;
                color: var(--lectio-theme-text, #2a4250);
                font-size: 10px;
                line-height: 1.35;
            }

            .lectio-manager-channel-help[hidden] {
                display: none !important;
            }

            .lectio-manager-channel-panel.is-unstable .lectio-manager-channel-select {
                border-color: #c08324;
                color: #a35d00;
                font-weight: 700;
            }

            .lectio-manager-channel-note {
                display: block;
                margin: 0 0 8px;
                color: var(--lectio-theme-muted, #68767b);
                font-size: 10px;
                line-height: 1.3;
            }

            .lectio-manager-channel-note[hidden] {
                display: none !important;
            }

            .lectio-manager-help-panel {
                margin: 6px 12px 0;
                padding: 8px 10px;
                font-size: 11px;
                line-height: 1.4;
                background: var(--lectio-theme-surface-alt, #eef3f6);
                color: var(--lectio-theme-text, #2a4250);
                border: 1px solid var(--lectio-theme-muted, #d8e3e9);
                border-radius: 8px;
            }

            .lectio-manager-help-panel[hidden] {
                display: none !important;
            }

            .lectio-manager-prefs-panel {
                margin: 6px 12px 0;
                padding: 8px 10px;
                background: var(--lectio-theme-surface-alt, #eef3f6);
                border: 1px solid var(--lectio-theme-muted, #d8e3e9);
                border-radius: 8px;
            }

            .lectio-manager-prefs-panel[hidden] {
                display: none !important;
            }

            .lectio-manager-prefs-section {
                border: 1px solid var(--lectio-theme-muted, #d8e3e9);
                border-radius: 7px;
                background: var(--lectio-theme-surface, #ffffff);
                padding: 0 8px 8px;
            }

            .lectio-manager-prefs-section + .lectio-manager-prefs-section {
                margin-top: 6px;
            }

            .lectio-manager-prefs-section > summary {
                padding: 7px 1px;
                color: var(--lectio-theme-text, #2a4250);
                cursor: pointer;
                font-size: 11px;
                font-weight: 750;
            }

            .lectio-manager-prefs-field,
            .lectio-manager-prefs-check {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                color: var(--lectio-theme-text, #2a4250);
                font-size: 11px;
            }

            .lectio-manager-prefs-field + .lectio-manager-prefs-field,
            .lectio-manager-prefs-field + .lectio-manager-prefs-check,
            .lectio-manager-prefs-check + .lectio-manager-prefs-check {
                margin-top: 7px;
            }

            .lectio-manager-prefs-field select {
                min-width: 116px;
                border: 1px solid var(--lectio-theme-muted, #cbd7d9);
                border-radius: 6px;
                background: #ffffff;
                color: #10201e;
                padding: 4px 6px;
                font: inherit;
            }

            /* A slider needs the room a select does not, so the label keeps only
               what it needs and the track takes the rest of the row. */
            .lectio-manager-prefs-range input[type='range'] {
                flex: 1 1 auto;
                min-width: 0;
                margin: 0;
                accent-color: var(--lectio-theme-accent, #0f6f6f);
                cursor: pointer;
            }

            .lectio-manager-prefs-range output {
                min-width: 32px;
                color: var(--lectio-theme-accent, #176766);
                font-size: 10px;
                font-weight: 700;
                text-align: right;
                font-variant-numeric: tabular-nums;
            }

            .lectio-manager-prefs-check {
                justify-content: flex-start;
                cursor: pointer;
            }

            .lectio-manager-prefs-check input {
                margin: 0;
                accent-color: var(--lectio-theme-accent, #0f6f6f);
                cursor: pointer;
            }

            .lectio-manager-prefs-warning {
                display: block;
                margin-top: 7px;
                color: var(--lectio-theme-muted, #5e6870);
                font-size: 10px;
                line-height: 1.35;
            }

            .lectio-manager-dock-reset {
                margin-top: 8px;
                border: 1px solid var(--lectio-theme-accent, #0f6f6f);
                border-radius: 6px;
                background: var(--lectio-theme-surface, #ffffff);
                color: var(--lectio-theme-accent, #0f6f6f);
                padding: 4px 8px;
                font: inherit;
                font-size: 10px;
                font-weight: 700;
                cursor: pointer;
            }

            /* The arrow heads point clockwise, so the spin has to run clockwise
               too, or the icon reads as winding itself backwards. */
            .lectio-manager-refresh.is-spinning svg {
                animation: lectio-manager-spin 900ms linear infinite;
                transition: none;
            }

            @keyframes lectio-manager-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }

            @media (prefers-reduced-motion: reduce) {
                .lectio-manager-channel-btn,
                .lectio-manager-help,
                .lectio-manager-refresh,
                .lectio-manager-close,
                .lectio-manager-channel-btn svg,
                .lectio-manager-help svg,
                .lectio-manager-refresh svg,
                .lectio-manager-close svg {
                    transition: none;
                }

                .lectio-manager-channel-btn:active,
                .lectio-manager-help:active,
                .lectio-manager-refresh:active:not(:disabled),
                .lectio-manager-close:active,
                .lectio-manager-close:hover svg,
                .lectio-manager-refresh:hover:not(:disabled) svg {
                    transform: none;
                }

                .lectio-manager-refresh.is-spinning svg {
                    animation-duration: 2.4s;
                }
            }

            .lectio-manager-main-view,
            .lectio-manager-settings-view {
                display: flex;
                flex: 1;
                min-height: 0;
                flex-direction: column;
            }

            .lectio-manager-main-view[hidden],
            .lectio-manager-settings-view[hidden] {
                display: none !important;
            }

            .lectio-manager-tabs {
                display: flex;
                gap: 2px;
                padding: 6px 12px 0;
                border-bottom: 1px solid var(--lectio-theme-muted, #eef1f2);
            }

            .lectio-manager-tab {
                flex: 1;
                border: none;
                border-bottom: 2px solid transparent;
                background: transparent;
                color: var(--lectio-theme-muted, #5e6870);
                cursor: pointer;
                font: inherit;
                font-size: 12px;
                font-weight: 650;
                padding: 7px 10px 6px;
            }

            .lectio-manager-tab:hover {
                color: var(--lectio-theme-text, #10201e);
            }

            .lectio-manager-tab.is-active {
                border-bottom-color: var(--lectio-theme-accent, #0f6f6f);
                color: var(--lectio-theme-accent, #0f6f6f);
            }

            .lectio-manager-installed-count,
            .lectio-manager-available-count {
                color: var(--lectio-theme-muted, #5e6870);
                font-size: 10px;
            }

            .lectio-manager-nav {
                position: relative;
                padding: 6px 12px 0;
            }

            .lectio-manager-nav[hidden] {
                display: none !important;
            }

            .lectio-manager-nav-trigger {
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 100%;
                gap: 8px;
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
                background: var(--lectio-theme-surface, #ffffff);
                border-radius: 8px;
                padding: 6px 10px;
                font-size: 12px;
                font-weight: 700;
                color: var(--lectio-theme-text, #10201e);
                cursor: pointer;
            }

            .lectio-manager-nav-trigger:hover {
                border-color: var(--lectio-theme-accent, #0f6f6f);
            }

            .lectio-manager-nav-trigger svg {
                width: 12px;
                height: 12px;
                flex-shrink: 0;
                fill: none;
                stroke: var(--lectio-theme-muted, #5e6870);
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
                background: var(--lectio-theme-surface, #ffffff);
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
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
                border: 1px solid var(--lectio-theme-muted, #e2e8ea);
                border-radius: 8px;
                background: var(--lectio-theme-surface-alt, #f1f6f6);
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
                color: var(--lectio-theme-muted, #8a949c);
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
                color: var(--lectio-theme-text, #10201e);
                cursor: pointer;
            }

            .lectio-manager-nav-item:hover {
                background: var(--lectio-theme-surface-alt, #f2f6f6);
            }

            .lectio-manager-nav-item.is-active {
                background: var(--lectio-theme-accent, #0f6f6f);
                color: #ffffff;
                font-weight: 700;
            }

            .lectio-manager-list-toolbar {
                display: flex;
                align-items: center;
                gap: 8px;
                justify-content: space-between;
                padding: 8px 12px 4px;
            }

            .lectio-manager-view-heading {
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: .03em;
                color: var(--lectio-theme-muted, #5e6870);
            }

            .lectio-manager-sort {
                display: flex;
                overflow: hidden;
                border: 1px solid var(--lectio-theme-muted, #d6dde0);
                border-radius: 6px;
            }

            .lectio-manager-sort button {
                border: none;
                background: var(--lectio-theme-surface, #ffffff);
                color: var(--lectio-theme-muted, #5e6870);
                cursor: pointer;
                font: inherit;
                font-size: 10px;
                padding: 3px 7px;
            }

            .lectio-manager-sort button + button {
                border-left: 1px solid var(--lectio-theme-muted, #d6dde0);
            }

            .lectio-manager-sort button.is-active {
                background: var(--lectio-theme-surface-alt, #eef3f6);
                color: var(--lectio-theme-accent, #0f6f6f);
                font-weight: 700;
            }

            /* Warmer than the Tampermonkey tip beside it, because this one is
               about the Manager being out of date rather than a suggestion. */
            .lectio-manager-self-update {
                display: flex;
                align-items: center;
                gap: 10px;
                margin: 6px 12px 0;
                padding: 8px 10px;
                font-size: 11px;
                line-height: 1.35;
                background: #fff6e5;
                color: #7a4a00;
                border: 1px solid #f0cf94;
                border-radius: 8px;
            }

            .lectio-manager-self-update[hidden] {
                display: none !important;
            }

            .lectio-manager-self-update-text {
                flex: 1;
                min-width: 0;
                font-weight: 600;
            }

            .lectio-manager-self-update-link {
                flex: none;
                border: 1px solid #c08324;
                border-radius: 6px;
                background: #ffffff;
                color: #8a5200;
                padding: 3px 9px;
                font-weight: 700;
                text-decoration: none;
                white-space: nowrap;
            }

            .lectio-manager-self-update-link:hover,
            .lectio-manager-self-update-link:focus-visible {
                background: #8a5200;
                color: #ffffff;
            }

            .lectio-manager-tip {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                margin: 6px 12px 0;
                padding: 8px 10px;
                font-size: 11px;
                line-height: 1.35;
                background: var(--lectio-theme-surface-alt, #eaf5f2);
                color: var(--lectio-theme-accent, #0d4d4d);
                border: 1px solid var(--lectio-theme-muted, #cfe8e3);
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
                color: var(--lectio-theme-accent, #0d4d4d);
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
                border-bottom: 1px solid var(--lectio-theme-muted, #eef1f2);
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
                color: var(--lectio-theme-muted, #5e6870);
                text-align: center;
                font-size: 12px;
            }

            .lectio-manager-category-heading {
                margin: 12px 2px 5px;
                font-size: 10px;
                font-weight: 800;
                color: var(--lectio-theme-muted, #66767b);
                letter-spacing: .08em;
                text-transform: uppercase;
            }

            .lectio-manager-category-heading:first-child {
                margin-top: 0;
            }

            .lectio-manager-card {
                position: relative;
                padding: 11px 12px;
                border: 1px solid var(--lectio-theme-muted, #dde5e6);
                border-radius: 10px;
                background: var(--lectio-theme-surface, #ffffff);
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
                background: var(--lectio-theme-accent-alt, #69a9a5);
            }

            .lectio-manager-card:hover {
                border-color: var(--lectio-theme-muted, #b9cbcc);
            }

            .lectio-manager-card-main {
                margin-bottom: 9px;
            }

            .lectio-manager-card.is-compact {
                padding-block: 8px;
            }

            .lectio-manager-card.is-compact .lectio-manager-card-main {
                margin-bottom: 6px;
            }

            .lectio-manager-card-meta {
                display: flex;
                align-items: center;
                gap: 7px;
                margin-bottom: 5px;
            }

            .lectio-manager-card.is-experimental::before {
                background: #d99b46;
            }

            .lectio-manager-card-experimental {
                padding: 2px 6px;
                border-radius: 999px;
                background: #fff0dc;
                color: #9a5700;
                font-size: 9px;
                font-weight: 800;
                letter-spacing: .05em;
                text-transform: uppercase;
            }

            .lectio-manager-card-category {
                padding: 2px 6px;
                border-radius: 999px;
                background: var(--lectio-theme-surface-alt, #e9f3f2);
                color: var(--lectio-theme-accent, #176766);
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
                color: var(--lectio-theme-muted, #778187);
                text-transform: uppercase;
                letter-spacing: .04em;
            }

            .lectio-manager-card-desc {
                margin-top: 3px;
                font-size: 12px;
                color: var(--lectio-theme-text, #394a57);
                line-height: 1.4;
            }

            .lectio-manager-card-status {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .lectio-manager-status-installed,
            .lectio-manager-status-update,
            .lectio-manager-status-missing {
                flex: 1;
            }

            .lectio-manager-status-installed {
                font-size: 11px;
                font-weight: 600;
                color: #0f6f4f;
            }

            .lectio-manager-status-update {
                font-size: 11px;
                font-weight: 700;
                color: #9a4f00;
            }

            .lectio-manager-status-missing {
                font-size: 11px;
                color: var(--lectio-theme-muted, #5e6870);
            }

            .lectio-manager-status-idle {
                font-size: 10px;
                font-style: italic;
                color: var(--lectio-theme-muted, #5e6870);
                white-space: nowrap;
            }

            .lectio-manager-card-actions {
                display: flex;
                gap: 6px;
            }

            .lectio-manager-forget-btn {
                border-color: var(--lectio-theme-muted, #5e6870);
                color: var(--lectio-theme-muted, #5e6870);
            }

            .lectio-manager-install-btn,
            .lectio-manager-update-btn,
            .lectio-manager-forget-btn,
            .lectio-manager-settings-btn {
                border: 1px solid var(--lectio-theme-accent, #0f6f6f);
                color: var(--lectio-theme-accent, #0f6f6f);
                background: var(--lectio-theme-surface, #ffffff);
                border-radius: 6px;
                padding: 3px 10px;
                font-size: 11px;
                font-weight: 600;
                text-decoration: none;
                cursor: pointer;
                white-space: nowrap;
            }

            .lectio-manager-update-btn.is-downgrade {
                border-color: #a36a13;
                color: #8b590e;
            }

            .lectio-manager-install-btn:hover,
            .lectio-manager-update-btn:hover,
            .lectio-manager-forget-btn:hover,
            .lectio-manager-settings-btn:hover {
                background: var(--lectio-theme-surface-alt, #e8f3f3);
            }

            .lectio-manager-settings-view-header {
                padding: 8px 12px 10px;
                border-bottom: 1px solid var(--lectio-theme-muted, #eef1f2);
            }

            .lectio-manager-settings-back {
                border: none;
                background: transparent;
                color: var(--lectio-theme-accent, #0f6f6f);
                cursor: pointer;
                font: inherit;
                font-size: 11px;
                font-weight: 650;
                padding: 2px 0 7px;
            }

            .lectio-manager-settings-title-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }

            .lectio-manager-settings-title-row > div {
                display: flex;
                min-width: 0;
                flex-direction: column;
                gap: 2px;
            }

            .lectio-manager-settings-category {
                color: var(--lectio-theme-accent, #0f6f6f);
                font-size: 9px;
                font-weight: 800;
                letter-spacing: .05em;
                text-transform: uppercase;
            }

            .lectio-manager-settings-title {
                color: var(--lectio-theme-text, #10201e);
                font-size: 14px;
            }

            .lectio-manager-settings-version {
                color: var(--lectio-theme-muted, #5e6870);
                font-size: 10px;
            }

            .lectio-manager-settings-body {
                display: flex;
                min-height: 0;
                flex: 1;
                flex-direction: column;
                gap: 9px;
                overflow-y: auto;
                padding: 10px 12px 14px;
            }

            .lectio-manager-settings-section {
                border: 1px solid var(--lectio-theme-muted, #dce9e8);
                border-radius: 8px;
                background: var(--lectio-theme-surface-alt, #f6f9f9);
                overflow: visible;
            }

            .lectio-manager-settings-section-heading {
                margin: 0;
                padding: 8px 10px 0;
                color: var(--lectio-theme-accent, #176766);
                font-size: 10px;
                font-weight: 800;
                letter-spacing: .07em;
                text-transform: uppercase;
            }

            summary.lectio-manager-settings-section-heading {
                cursor: pointer;
                user-select: none;
            }

            summary.lectio-manager-settings-section-heading::-webkit-details-marker {
                color: var(--lectio-theme-accent, #176766);
            }

            .lectio-manager-setting-label-row {
                display: flex;
                align-items: center;
                gap: 5px;
            }

            .lectio-manager-setting-info {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
                padding: 0;
                border: none;
                border-radius: 50%;
                background: transparent;
                color: var(--lectio-theme-muted, #8a969b);
                cursor: pointer;
                flex: none;
                transition: color 140ms ease;
            }

            .lectio-manager-setting-info svg {
                width: 100%;
                height: 100%;
                display: block;
                fill: none;
                stroke: currentColor;
                stroke-width: 1.8;
                stroke-linecap: round;
                stroke-linejoin: round;
                shape-rendering: geometricPrecision;
            }

            .lectio-manager-setting-info:hover,
            .lectio-manager-setting-info:focus-visible,
            .lectio-manager-setting-info[aria-expanded='true'] {
                color: var(--lectio-theme-accent, #176766);
            }

            .lectio-manager-settings-section-rows {
                display: flex;
                flex-direction: column;
                gap: 10px;
                padding: 9px 10px 10px;
            }

            .lectio-manager-setting-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(110px, 42%);
                align-items: center;
                gap: 10px;
                font-size: 12px;
            }

            .lectio-manager-setting-copy {
                display: flex;
                min-width: 0;
                flex-direction: column;
                gap: 2px;
            }

            .lectio-manager-setting-label {
                color: var(--lectio-theme-text, #203431);
                font-weight: 650;
            }

            .lectio-manager-setting-description {
                color: var(--lectio-theme-muted, #68767b);
                font-size: 10px;
                line-height: 1.3;
            }

            .lectio-manager-setting-row select,
            .lectio-manager-setting-row input[type='text'] {
                min-width: 0;
                width: 100%;
                box-sizing: border-box;
                border: 1px solid var(--lectio-theme-accent, #cbd7d9);
                border-radius: 6px;
                background: #ffffff;
                color: #10201e;
                padding: 5px 7px;
                font: inherit;
            }

            .lectio-manager-setting-row.is-preview-select {
                align-items: start;
            }

            .lectio-manager-preview-select {
                position: relative;
                min-width: 0;
                width: 100%;
            }

            .lectio-manager-preview-select-trigger {
                width: 100%;
                border: 1px solid var(--lectio-theme-accent, #cbd7d9);
                border-radius: 6px;
                background: #ffffff;
                color: #10201e;
                padding: 5px 24px 5px 7px;
                font: inherit;
                text-align: left;
                cursor: pointer;
            }

            .lectio-manager-preview-select-trigger::after {
                content: '⌄';
                position: absolute;
                right: 8px;
                color: #5e6870;
            }

            .lectio-manager-preview-select-menu {
                position: absolute;
                top: calc(100% + 3px);
                left: 0;
                right: 0;
                z-index: 20;
                max-height: 220px;
                overflow-y: auto;
                padding: 4px;
                border: 1px solid var(--lectio-theme-accent, #cbd7d9);
                border-radius: 6px;
                background: #ffffff;
                box-shadow: 0 8px 18px rgba(0,0,0,.18);
            }

            .lectio-manager-preview-select-menu[hidden] {
                display: none !important;
            }

            .lectio-manager-preview-select-option {
                display: block;
                width: 100%;
                border: none;
                border-radius: 4px;
                background: transparent;
                color: #10201e;
                padding: 5px 7px;
                font: inherit;
                text-align: left;
                cursor: pointer;
            }

            .lectio-manager-preview-select-option:hover,
            .lectio-manager-preview-select-option:focus-visible {
                outline: none;
                background: #e8f3f3;
            }

            .lectio-manager-preview-select-option[aria-selected='true'] {
                font-weight: 700;
            }

            .lectio-manager-setting-row input[type='checkbox'] {
                justify-self: end;
                width: 34px;
                height: 18px;
                accent-color: var(--lectio-theme-accent, #0f6f6f);
            }

            .lectio-manager-setting-row.is-color {
                grid-template-columns: minmax(0, 1fr) auto;
            }

            .lectio-manager-setting-row input[type='color'] {
                width: 44px;
                height: 26px;
                padding: 2px;
                border: 1px solid var(--lectio-theme-accent, #cbd7d9);
                border-radius: 6px;
                background: #ffffff;
                cursor: pointer;
            }

            .lectio-manager-setting-row.is-range {
                grid-template-columns: minmax(0, 1fr) minmax(90px, 1fr) auto;
            }

            .lectio-manager-setting-row input[type='range'] {
                grid-column: 2;
                min-width: 0;
                width: 100%;
                accent-color: var(--lectio-theme-accent, #0f6f6f);
            }

            .lectio-manager-range-value {
                grid-column: 3;
                grid-row: 1;
                min-width: 35px;
                color: var(--lectio-theme-accent, #176766);
                font-size: 10px;
                font-weight: 700;
                text-align: right;
            }

            .lectio-manager-setting-row.is-button {
                grid-template-columns: minmax(0, 1fr) auto;
            }

            .lectio-manager-setting-row.is-button > button {
                border: 1px solid var(--lectio-theme-accent, #0f6f6f);
                border-radius: 6px;
                background: var(--lectio-theme-surface, #ffffff);
                color: var(--lectio-theme-accent, #0f6f6f);
                padding: 5px 9px;
                font: inherit;
                font-weight: 700;
                cursor: pointer;
            }

            #lectio-manager-dock-root {
                --lectio-dock-item-size: 42px;
                --lectio-dock-gap: 6px;
                position: fixed;
                z-index: 999998;
                display: flex;
                align-items: flex-start;
                font-family: Roboto, Arial, sans-serif;
                color: var(--lectio-theme-text, #10201e);
            }

            #lectio-manager-dock-root[hidden] {
                display: none !important;
                pointer-events: none !important;
            }

            /* Which edge the dock hugs. */
            #lectio-manager-dock-root[data-edge='left'] { left: 14px; }
            #lectio-manager-dock-root[data-edge='right'] { right: 14px; }
            #lectio-manager-dock-root[data-edge='top'] { top: 14px; }
            #lectio-manager-dock-root[data-edge='bottom'] { bottom: 14px; }

            /* Where it sits along that edge. */
            #lectio-manager-dock-root[data-orientation='vertical'][data-align='start'] {
                top: 16px;
            }

            #lectio-manager-dock-root[data-orientation='vertical'][data-align='center'] {
                top: 50%;
                transform: translateY(-50%);
            }

            #lectio-manager-dock-root[data-orientation='vertical'][data-align='end'] {
                bottom: 16px;
            }

            #lectio-manager-dock-root[data-orientation='horizontal'][data-align='start'] {
                left: 16px;
            }

            #lectio-manager-dock-root[data-orientation='horizontal'][data-align='center'] {
                left: 50%;
                transform: translateX(-50%);
            }

            /* A bottom-right dock would land on the Manager's own gear button. */
            #lectio-manager-dock-root[data-orientation='horizontal'][data-align='end'] {
                right: 16px;
            }

            #lectio-manager-dock-root[data-edge='bottom'][data-align='end'] {
                right: 72px;
            }

            /*
             * Glass, not a white card. Three things make it read as glass and
             * all of them are needed: a heavily blurred and saturated backdrop
             * so whatever is behind it stays recognisable as itself, a fill weak
             * enough to see through, and a bright inner top edge standing in for
             * a specular highlight on a real bevel. The old 92% fill left it
             * opaque, which is why it looked like a floating white pill.
             */
            .lectio-manager-dock-shell {
                padding: 7px;
                border: 1px solid rgba(255, 255, 255, .38);
                border-radius: calc((var(--lectio-dock-item-size) / 2) + 8px);
                background:
                    linear-gradient(
                        155deg,
                        color-mix(in srgb, var(--lectio-theme-surface, #ffffff) var(--lectio-dock-shell-fill, 20%), transparent),
                        color-mix(in srgb, var(--lectio-theme-surface, #ffffff) var(--lectio-dock-shell-fill-fade, 9%), transparent)
                    );
                box-shadow:
                    0 12px 32px rgba(0, 0, 0, .16),
                    0 2px 8px rgba(0, 0, 0, .08),
                    inset 0 1px 0 rgba(255, 255, 255, .45),
                    inset 0 0 0 1px rgba(255, 255, 255, .08);
                /* Most of the legibility comes from the blur and the saturation
                   boost, not from the fill - which is why the fill can be this
                   thin and the photo behind it still reads as the photo. */
                -webkit-backdrop-filter: blur(24px) saturate(190%);
                backdrop-filter: blur(24px) saturate(190%);
                transition: transform 150ms ease, opacity 150ms ease;
            }

            /* Without a backdrop-filter the fill alone is far too faint to sit
               on a photo, so those browsers get an opaque shell instead. */
            @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
                .lectio-manager-dock-shell {
                    background: color-mix(in srgb, var(--lectio-theme-surface, #ffffff) 90%, transparent);
                }
            }

            /* Auto-hide slides the shell off whichever edge it is docked to. */
            #lectio-manager-dock-root.is-auto-hide:not(:hover):not(:focus-within):not(.has-open-panel) .lectio-manager-dock-shell {
                opacity: .55;
            }

            #lectio-manager-dock-root[data-edge='left'].is-auto-hide:not(:hover):not(:focus-within):not(.has-open-panel) .lectio-manager-dock-shell {
                transform: translateX(calc(-100% + 10px));
            }

            #lectio-manager-dock-root[data-edge='right'].is-auto-hide:not(:hover):not(:focus-within):not(.has-open-panel) .lectio-manager-dock-shell {
                transform: translateX(calc(100% - 10px));
            }

            #lectio-manager-dock-root[data-edge='top'].is-auto-hide:not(:hover):not(:focus-within):not(.has-open-panel) .lectio-manager-dock-shell {
                transform: translateY(calc(-100% + 10px));
            }

            #lectio-manager-dock-root[data-edge='bottom'].is-auto-hide:not(:hover):not(:focus-within):not(.has-open-panel) .lectio-manager-dock-shell {
                transform: translateY(calc(100% - 10px));
            }

            /* Visible by default so a magnified tile can grow past the shell.
               Scrolling is switched on from updateDockFit only when the icons
               really do not fit, which is also when magnifying them is pointless. */
            .lectio-manager-dock-items {
                display: flex;
                gap: var(--lectio-dock-gap);
                overflow: visible;
                scrollbar-width: thin;
            }

            #lectio-manager-dock-root[data-orientation='vertical'] .lectio-manager-dock-items {
                flex-direction: column;
            }

            #lectio-manager-dock-root[data-orientation='horizontal'] .lectio-manager-dock-items {
                flex-direction: row;
            }

            #lectio-manager-dock-root[data-orientation='vertical'] .lectio-manager-dock-items.is-scrollable {
                overflow-x: hidden;
                overflow-y: auto;
            }

            #lectio-manager-dock-root[data-orientation='horizontal'] .lectio-manager-dock-items.is-scrollable {
                overflow-x: auto;
                overflow-y: hidden;
            }

            .lectio-manager-dock-items.is-scrollable .lectio-manager-dock-item:hover,
            .lectio-manager-dock-items.is-scrollable .lectio-manager-dock-item:focus-visible,
            .lectio-manager-dock-items.is-scrollable .lectio-manager-dock-item:hover + .lectio-manager-dock-item,
            .lectio-manager-dock-items.is-scrollable .lectio-manager-dock-item:has(+ .lectio-manager-dock-item:hover) {
                transform: none;
            }

            /* The tiles are glass too, but denser than the shell they sit in -
               roughly two thirds to its third - so they read as objects resting
               on the panel rather than holes cut out of it. */
            .lectio-manager-dock-item {
                position: relative;
                display: flex;
                flex: 0 0 auto;
                width: var(--lectio-dock-item-size);
                height: var(--lectio-dock-item-size);
                align-items: center;
                justify-content: center;
                box-sizing: border-box;
                border: 1px solid rgba(255, 255, 255, .42);
                border-radius: 50%;
                background: color-mix(in srgb, var(--lectio-theme-surface, #ffffff) var(--lectio-dock-item-fill, 38%), transparent);
                color: var(--lectio-theme-accent, #0f6f6f);
                padding: 0;
                cursor: pointer;
                touch-action: none;
                -webkit-backdrop-filter: blur(12px) saturate(160%);
                backdrop-filter: blur(12px) saturate(160%);
                box-shadow:
                    0 2px 6px rgba(0, 0, 0, .12),
                    inset 0 1px 0 rgba(255, 255, 255, .5);
                transform-origin: var(--lectio-dock-grow, center center);
                transition:
                    transform 200ms cubic-bezier(.22, .8, .3, 1.1),
                    background-color 180ms ease,
                    border-color 180ms ease,
                    box-shadow 180ms ease;
            }

            .lectio-manager-dock-item:hover,
            .lectio-manager-dock-item:focus-visible,
            .lectio-manager-dock-item.is-active {
                /* Hover is the one moment the tile earns some opacity: it is the
                   thing being looked at, and the icon has to stay readable while
                   it is also the thing being scaled. No ring and no drop shadow:
                   anything that appears *behind* the icon on hover is the first
                   thing to read as a blink when the pointer crosses a rim, and
                   the scale already says which tile is under the cursor. The
                   tile keeps its resting shadow the whole time, so nothing
                   behind it ever changes. */
                border-color: rgba(255, 255, 255, .7);
                background: color-mix(in srgb, var(--lectio-theme-surface, #ffffff) var(--lectio-dock-item-fill-hover, 62%), transparent);
                outline: none;
            }

            /* Keyboard focus still needs to be visible, and it does not flicker,
               because focus moves deliberately rather than with the pointer. */
            .lectio-manager-dock-item:focus-visible {
                box-shadow:
                    0 2px 6px rgba(0, 0, 0, .12),
                    inset 0 1px 0 rgba(255, 255, 255, .7),
                    0 0 0 2px color-mix(in srgb, var(--lectio-theme-accent, #0f6f6f) 55%, transparent);
            }

            /*
             * Dock magnification. The hovered tile grows most and its immediate
             * neighbours a little, which is the whole of the macOS effect at
             * this row length. The :has(+ :hover) rule reaches the tile *before*
             * the hovered one - the sibling combinator only ever looks forward -
             * so both sides respond without any pointer maths in JS.
             */
            .lectio-manager-dock-item:hover,
            .lectio-manager-dock-item:focus-visible {
                transform: scale(1.26);
                z-index: 2;
            }

            .lectio-manager-dock-item:hover + .lectio-manager-dock-item,
            .lectio-manager-dock-item:focus-visible + .lectio-manager-dock-item,
            .lectio-manager-dock-item:has(+ .lectio-manager-dock-item:hover),
            .lectio-manager-dock-item:has(+ .lectio-manager-dock-item:focus-visible) {
                transform: scale(1.11);
                z-index: 1;
            }

            /* Tiles grow away from the screen edge, never into it. */
            #lectio-manager-dock-root[data-edge='left'] .lectio-manager-dock-item { --lectio-dock-grow: left center; }
            #lectio-manager-dock-root[data-edge='right'] .lectio-manager-dock-item { --lectio-dock-grow: right center; }
            #lectio-manager-dock-root[data-edge='top'] .lectio-manager-dock-item { --lectio-dock-grow: center top; }
            #lectio-manager-dock-root[data-edge='bottom'] .lectio-manager-dock-item { --lectio-dock-grow: center bottom; }

            /* Dragging owns the transform; magnification must not fight it. */
            .lectio-manager-dock-item.is-dragging,
            .lectio-manager-dock-item.is-dragging:hover {
                transform: none;
            }

            .lectio-manager-dock-item.is-dragging {
                opacity: .45;
            }

            #lectio-manager-dock-root[data-orientation='vertical'] .lectio-manager-dock-item.is-drop-target {
                box-shadow: 0 -3px 0 var(--lectio-theme-accent, #0f6f6f);
            }

            #lectio-manager-dock-root[data-orientation='horizontal'] .lectio-manager-dock-item.is-drop-target {
                box-shadow: -3px 0 0 var(--lectio-theme-accent, #0f6f6f);
            }

            .lectio-manager-dock-item:disabled {
                cursor: not-allowed;
                opacity: .48;
            }

            .lectio-manager-dock-item[data-state='active'] {
                background: var(--lectio-theme-accent, #0f6f6f);
                color: #ffffff;
            }

            .lectio-manager-dock-item[data-state='warning'] {
                border-color: #b66a00;
                color: #9a4f00;
            }

            .lectio-manager-dock-item[data-state='error'] {
                border-color: #b42318;
                color: #b42318;
            }

            .lectio-manager-dock-item[data-state='busy'] .lectio-manager-dock-icon {
                animation: lectio-manager-spin 900ms linear infinite;
            }

            .lectio-manager-dock-icon,
            .lectio-manager-dock-icon svg {
                display: block;
                width: calc(var(--lectio-dock-item-size) * .5);
                height: calc(var(--lectio-dock-item-size) * .5);
            }

            /* Lucide is drawn for stroke-width 2 on this grid; thinning it to
               taste is what makes a sourced set look redrawn. Only currentColor
               is used, so the dock follows the active theme and its own
               active/warning/error states without any per-icon colour. */
            .lectio-manager-dock-icon svg {
                fill: none;
                stroke: currentColor;
                stroke-width: 2;
                stroke-linecap: round;
                stroke-linejoin: round;
                shape-rendering: geometricPrecision;
            }

            /*
             * One movement for every icon: a single settle when the pointer
             * arrives, then stillness. A per-icon animation - the radar's sweep
             * turning on hover - meant one tile behaved unlike its neighbours and
             * kept moving the whole time the pointer rested on it, which reads as
             * a fault rather than as feedback. The class is added once on arrival
             * and removed when the animation ends, so this plays for under half a
             * second however long the pointer then rests there.
             */
            .lectio-manager-dock-icon.is-nudging {
                animation: lectio-manager-dock-nudge 460ms cubic-bezier(.36, .07, .19, .97) both;
            }

            @keyframes lectio-manager-dock-nudge {
                0%   { transform: rotate(0deg); }
                22%  { transform: rotate(-8deg); }
                48%  { transform: rotate(6deg); }
                72%  { transform: rotate(-3deg); }
                100% { transform: rotate(0deg); }
            }

            @media (prefers-reduced-motion: reduce) {
                .lectio-manager-dock-item {
                    transition: background-color 180ms ease, border-color 180ms ease;
                }

                .lectio-manager-dock-item:hover,
                .lectio-manager-dock-item:focus-visible,
                .lectio-manager-dock-item:hover + .lectio-manager-dock-item,
                .lectio-manager-dock-item:focus-visible + .lectio-manager-dock-item,
                .lectio-manager-dock-item:has(+ .lectio-manager-dock-item:hover),
                .lectio-manager-dock-item:has(+ .lectio-manager-dock-item:focus-visible) {
                    transform: none;
                }

                .lectio-manager-dock-icon.is-nudging {
                    animation: none;
                }
            }

            .lectio-manager-dock-badge {
                position: absolute;
                top: -4px;
                right: -5px;
                min-width: 16px;
                max-width: 28px;
                height: 16px;
                box-sizing: border-box;
                overflow: hidden;
                border: 2px solid var(--lectio-theme-surface, #ffffff);
                border-radius: 9px;
                background: #b42318;
                color: #ffffff;
                padding: 0 3px;
                font-size: 9px;
                font-weight: 800;
                line-height: 12px;
                text-align: center;
                text-overflow: clip;
                white-space: nowrap;
            }

            .lectio-manager-dock-tooltip {
                position: absolute;
                z-index: 2;
                max-width: min(260px, calc(100vw - 100px));
                border: 1px solid rgba(255, 255, 255, .16);
                border-radius: 7px;
                background: color-mix(in srgb, var(--lectio-theme-text, #10201e) 82%, transparent);
                color: var(--lectio-theme-surface, #ffffff);
                box-shadow: 0 6px 18px rgba(0, 0, 0, .28);
                -webkit-backdrop-filter: blur(12px) saturate(160%);
                backdrop-filter: blur(12px) saturate(160%);
                padding: 5px 8px;
                font-size: 10px;
                line-height: 1.25;
                pointer-events: none;
                white-space: nowrap;
            }

            /* The tooltip always sits on the inward side of the dock. */
            #lectio-manager-dock-root[data-edge='left'] .lectio-manager-dock-tooltip {
                left: calc(100% + 8px);
                transform: translateY(-50%);
            }

            #lectio-manager-dock-root[data-edge='right'] .lectio-manager-dock-tooltip {
                right: calc(100% + 8px);
                transform: translateY(-50%);
            }

            #lectio-manager-dock-root[data-edge='top'] .lectio-manager-dock-tooltip {
                top: calc(100% + 8px);
                transform: translateX(-50%);
            }

            #lectio-manager-dock-root[data-edge='bottom'] .lectio-manager-dock-tooltip {
                bottom: calc(100% + 8px);
                transform: translateX(-50%);
            }

            .lectio-manager-dock-tooltip[hidden] {
                display: none !important;
            }

            .lectio-manager-dock-flyout {
                position: absolute;
                width: min(360px, calc(100vw - 100px));
                max-height: min(76vh, 560px);
                box-sizing: border-box;
                overflow: auto;
                border: 1px solid rgba(255, 255, 255, .42);
                border-radius: 12px;
                background: color-mix(in srgb, var(--lectio-theme-surface, #ffffff) 88%, transparent);
                box-shadow:
                    0 14px 36px rgba(0, 0, 0, .24),
                    inset 0 1px 0 rgba(255, 255, 255, .6);
                -webkit-backdrop-filter: blur(20px) saturate(175%);
                backdrop-filter: blur(20px) saturate(175%);
                padding: 14px;
            }

            .lectio-manager-dock-flyout[hidden] {
                display: none !important;
            }

            /* The flyout opens away from the edge, then lines up with the dock. */
            #lectio-manager-dock-root[data-edge='left'] .lectio-manager-dock-flyout {
                left: calc(100% + 10px);
            }

            #lectio-manager-dock-root[data-edge='right'] .lectio-manager-dock-flyout {
                right: calc(100% + 10px);
            }

            #lectio-manager-dock-root[data-edge='top'] .lectio-manager-dock-flyout {
                top: calc(100% + 10px);
            }

            #lectio-manager-dock-root[data-edge='bottom'] .lectio-manager-dock-flyout {
                bottom: calc(100% + 10px);
            }

            #lectio-manager-dock-root[data-orientation='vertical'][data-align='start'] .lectio-manager-dock-flyout {
                top: 0;
            }

            #lectio-manager-dock-root[data-orientation='vertical'][data-align='center'] .lectio-manager-dock-flyout {
                top: 50%;
                transform: translateY(-50%);
            }

            #lectio-manager-dock-root[data-orientation='vertical'][data-align='end'] .lectio-manager-dock-flyout {
                bottom: 0;
            }

            #lectio-manager-dock-root[data-orientation='horizontal'][data-align='start'] .lectio-manager-dock-flyout {
                left: 0;
            }

            #lectio-manager-dock-root[data-orientation='horizontal'][data-align='center'] .lectio-manager-dock-flyout {
                left: 50%;
                transform: translateX(-50%);
            }

            #lectio-manager-dock-root[data-orientation='horizontal'][data-align='end'] .lectio-manager-dock-flyout {
                right: 0;
            }

            .lectio-manager-dock-flyout-close {
                position: sticky;
                top: 0;
                float: right;
                display: flex;
                width: 26px;
                height: 26px;
                align-items: center;
                justify-content: center;
                border: none;
                border-radius: 6px;
                background: var(--lectio-theme-surface-alt, #eef3f6);
                color: var(--lectio-theme-muted, #5e6870);
                padding: 0;
                cursor: pointer;
            }

            .lectio-manager-dock-flyout-close svg {
                width: 14px;
                height: 14px;
                fill: none;
                stroke: currentColor;
                stroke-width: 2;
                stroke-linecap: round;
            }

            .lectio-manager-dock-flyout-content {
                min-width: 0;
                font-size: 12px;
                line-height: 1.45;
            }

            @media (max-width: 420px) {
                #lectio-manager-root {
                    right: 10px;
                    bottom: 10px;
                }

                #lectio-manager-panel {
                    width: calc(100vw - 20px);
                }

                #lectio-manager-dock-root[data-edge='left'] {
                    left: 8px;
                }

                #lectio-manager-dock-root[data-edge='right'] {
                    right: 8px;
                }

                .lectio-manager-dock-flyout {
                    width: calc(100vw - 82px);
                }
            }
        `;

        document.head.appendChild(style);
    }

})();
