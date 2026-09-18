// ==UserScript==
// @name         Lectio Manager
// @namespace    https://github.com/RktRobinhood/Lectio-Scripts
// @version      2.1.0
// @description  Discover, configure and manage Lectio userscript modules with Stable and Unstable release channels.
// @author       RktRobinhood
// @match        https://www.lectio.dk/lectio/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @homepageURL  https://github.com/RktRobinhood/Lectio-Scripts
// @supportURL   https://github.com/RktRobinhood/Lectio-Scripts/issues
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/manager/Lectio-Manager.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/manager/Lectio-Manager.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '2.1.0';
  const REPO_RAW = 'https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main';
  const STABLE_CATALOGUE_URL = `${REPO_RAW}/catalogue/modules.json`;
  const UNSTABLE_CATALOGUE_URL = `${REPO_RAW}/modules-unstable/modules.json`;
  const STABLE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const UNSTABLE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const DISABLED_MODULES_KEY = 'lectioManager.disabledModules.v1';

  const KEY = Object.freeze({
    channel: 'lectioManager.releaseChannel.v1',
    stableCatalogue: 'lectioManager.catalogue.stable.v1',
    stableRefresh: 'lectioManager.catalogue.stable.refreshedAt.v1',
    unstableCatalogue: 'lectioManager.catalogue.unstable.v1',
    unstableRefresh: 'lectioManager.catalogue.unstable.refreshedAt.v1',
    activeCollection: 'lectioManager.activeCollection.v1',
    sortMode: 'lectioManager.sortMode.v1'
  });

  const ID = Object.freeze({
    launcher: 'lectio-manager-launcher',
    backdrop: 'lectio-manager-backdrop',
    panel: 'lectio-manager-panel',
    style: 'lectio-manager-style',
    body: 'lectio-manager-panel-body',
    dialog: 'lectio-manager-subdialog'
  });

  const state = {
    channel: normalizeChannel(GM_getValue(KEY.channel, 'stable')),
    activeCollection: normalizeCollection(GM_getValue(KEY.activeCollection, 'installed')),
    sortMode: normalizeSortMode(GM_getValue(KEY.sortMode, 'category')),
    stableCatalogue: readStoredCatalogue(KEY.stableCatalogue),
    unstableCatalogue: readStoredCatalogue(KEY.unstableCatalogue),
    stableRefreshedAt: Number(GM_getValue(KEY.stableRefresh, 0)) || 0,
    unstableRefreshedAt: Number(GM_getValue(KEY.unstableRefresh, 0)) || 0,
    registrations: new Map(),
    panelOpen: false,
    settingsView: false,
    refreshInFlight: false,
    statusMessage: '',
    statusKind: 'info'
  };

  window.addEventListener('lectio-module:register', onModuleRegister);
  window.addEventListener('storage', event => {
    if (event.key === DISABLED_MODULES_KEY && state.panelOpen) renderPanelBody();
  });

  installStyles();
  installLauncher();
  requestModuleDiscovery();
  window.setTimeout(requestModuleDiscovery, 400);
  window.setTimeout(requestModuleDiscovery, 1400);
  void refreshIfNeeded();

  function normalizeChannel(value) {
    return value === 'unstable' ? 'unstable' : 'stable';
  }

  function normalizeCollection(value) {
    return value === 'available' ? 'available' : 'installed';
  }

  function normalizeSortMode(value) {
    return value === 'az' ? 'az' : 'category';
  }

  function normalizeRegisteredChannel(value) {
    if (value === 'stable' || value === 'unstable') return value;
    return 'unknown';
  }

  function readStoredCatalogue(key) {
    const raw = GM_getValue(key, null);
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return validateCatalogue(parsed, { allowUnstableChannel: true });
    } catch (_) {
      return null;
    }
  }

  function writeStoredCatalogue(key, catalogue) {
    GM_setValue(key, JSON.stringify(catalogue));
  }

  function onModuleRegister(event) {
    const detail = event?.detail;
    if (!detail || typeof detail !== 'object') return;

    const id = cleanString(detail.id);
    const version = cleanString(detail.version);
    if (!id || !version) return;

    const aliases = Array.isArray(detail.aliases)
      ? detail.aliases.map(cleanString).filter(Boolean)
      : [];

    state.registrations.set(id, {
      id,
      aliases,
      name: cleanString(detail.name) || id,
      version,
      channel: normalizeRegisteredChannel(detail.channel),
      settingsSchema: Array.isArray(detail.settingsSchema) ? detail.settingsSchema : [],
      currentValues: detail.currentValues && typeof detail.currentValues === 'object'
        ? { ...detail.currentValues }
        : detail.settings && typeof detail.settings === 'object'
          ? { ...detail.settings }
          : {},
      setSetting: typeof detail.setSetting === 'function' ? detail.setSetting : null,
      applySetting: typeof detail.applySetting === 'function' ? detail.applySetting : null,
      updateSettings: typeof detail.updateSettings === 'function' ? detail.updateSettings : null,
      setEnabled: typeof detail.setEnabled === 'function' ? detail.setEnabled : null,
      capabilities: detail.capabilities && typeof detail.capabilities === 'object'
        ? { ...detail.capabilities }
        : {},
      enabled: detail.enabled !== false
    });

    if (state.panelOpen) renderPanelBody();
  }

  function requestModuleDiscovery() {
    window.dispatchEvent(new CustomEvent('lectio-manager:discover', {
      detail: { managerVersion: VERSION, channel: state.channel }
    }));
  }

  async function refreshIfNeeded() {
    const now = Date.now();
    const stableStale = !state.stableCatalogue || now - state.stableRefreshedAt >= STABLE_REFRESH_INTERVAL_MS;
    const unstableStale = state.channel === 'unstable' &&
      (!state.unstableCatalogue || now - state.unstableRefreshedAt >= UNSTABLE_REFRESH_INTERVAL_MS);

    if (!stableStale && !unstableStale) return;
    await refreshCatalogues({ force: false });
  }

  async function refreshCatalogues({ force }) {
    if (state.refreshInFlight) return;
    state.refreshInFlight = true;
    state.statusMessage = 'Refreshing module catalogues...';
    state.statusKind = 'info';
    renderPanelBody();

    const errors = [];
    const now = Date.now();

    try {
      if (force || !state.stableCatalogue || now - state.stableRefreshedAt >= STABLE_REFRESH_INTERVAL_MS) {
        try {
          const stable = await fetchCatalogue(STABLE_CATALOGUE_URL, { force });
          state.stableCatalogue = stable;
          state.stableRefreshedAt = Date.now();
          writeStoredCatalogue(KEY.stableCatalogue, stable);
          GM_setValue(KEY.stableRefresh, state.stableRefreshedAt);
        } catch (error) {
          errors.push(`Stable catalogue: ${error.message}`);
        }
      }

      if (state.channel === 'unstable' &&
          (force || !state.unstableCatalogue || now - state.unstableRefreshedAt >= UNSTABLE_REFRESH_INTERVAL_MS)) {
        try {
          const unstable = await fetchCatalogue(UNSTABLE_CATALOGUE_URL, { force: true });
          state.unstableCatalogue = unstable;
          state.unstableRefreshedAt = Date.now();
          writeStoredCatalogue(KEY.unstableCatalogue, unstable);
          GM_setValue(KEY.unstableRefresh, state.unstableRefreshedAt);
        } catch (error) {
          errors.push(`Unstable overlay: ${error.message}`);
        }
      }
    } finally {
      state.refreshInFlight = false;
    }

    if (errors.length) {
      const hasUsableStable = Boolean(state.stableCatalogue);
      state.statusMessage = hasUsableStable
        ? `Could not refresh everything. Using last known good data. ${errors.join(' | ')}`
        : `Catalogue refresh failed. ${errors.join(' | ')}`;
      state.statusKind = 'error';
    } else {
      state.statusMessage = 'Updated just now.';
      state.statusKind = 'success';
    }

    requestModuleDiscovery();
    renderPanelBody();
  }

  function fetchCatalogue(baseUrl, { force }) {
    return new Promise((resolve, reject) => {
      const url = force
        ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}_=${Date.now()}`
        : baseUrl;

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: {
          Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
          'Cache-Control': force ? 'no-cache' : 'max-age=0'
        },
        timeout: 15000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }

          try {
            const parsed = JSON.parse(response.responseText);
            resolve(validateCatalogue(parsed, { allowUnstableChannel: true }));
          } catch (error) {
            reject(new Error(`Invalid JSON/catalogue: ${error.message}`));
          }
        },
        onerror() {
          reject(new Error('Network error'));
        },
        ontimeout() {
          reject(new Error('Request timed out'));
        }
      });
    });
  }

  function validateCatalogue(input, { allowUnstableChannel }) {
    if (!input || typeof input !== 'object') throw new Error('Catalogue is not an object');
    if (Number(input.schemaVersion) !== 1) throw new Error(`Unsupported schemaVersion ${input.schemaVersion}`);
    if (!Array.isArray(input.modules)) throw new Error('Catalogue modules must be an array');

    if (input.channel && !allowUnstableChannel) {
      throw new Error('Unexpected channel field');
    }

    const ids = new Set();
    const modules = input.modules.map((module, index) => validateModule(module, index));

    for (const module of modules) {
      if (ids.has(module.id)) throw new Error(`Duplicate module id: ${module.id}`);
      ids.add(module.id);
    }

    return { ...input, schemaVersion: 1, modules };
  }

  function validateModule(input, index) {
    if (!input || typeof input !== 'object') throw new Error(`Module ${index + 1} is invalid`);

    const id = cleanString(input.id);
    const name = cleanString(input.name);
    const description = cleanString(input.description);
    const version = cleanString(input.version);
    const installUrl = cleanString(input.installUrl);

    if (!id || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error(`Invalid module id at ${index + 1}`);
    if (!name) throw new Error(`Missing module name for ${id}`);
    if (!version) throw new Error(`Missing version for ${id}`);
    if (!isApprovedInstallUrl(installUrl)) throw new Error(`Unapproved install URL for ${id}`);

    return {
      ...input,
      id,
      name,
      description,
      version,
      installUrl,
      category: cleanString(input.category) || 'Other',
      status: cleanString(input.status) || 'stable',
      aliases: Array.isArray(input.aliases) ? input.aliases.map(cleanString).filter(Boolean) : [],
      audience: Array.isArray(input.audience) ? input.audience.map(cleanString).filter(Boolean) : []
    };
  }

  function isApprovedInstallUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return false;
      if (url.hostname === 'raw.githubusercontent.com') {
        return url.pathname.startsWith('/RktRobinhood/Lectio-Scripts/');
      }
      if (url.hostname === 'github.com') {
        return url.pathname.startsWith('/RktRobinhood/Lectio-Scripts/') && url.pathname.includes('/raw/');
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function installLauncher() {
    if (document.getElementById(ID.launcher)) return;

    const button = document.createElement('button');
    button.id = ID.launcher;
    button.type = 'button';
    button.setAttribute('aria-label', 'Open Lectio Tools');
    button.title = 'Lectio Tools';
    button.innerHTML = iconSvg('tools');
    button.addEventListener('click', openPanel);
    document.body.appendChild(button);
  }

  function openPanel() {
    state.panelOpen = true;
    state.settingsView = false;
    requestModuleDiscovery();
    window.setTimeout(requestModuleDiscovery, 250);

    let backdrop = document.getElementById(ID.backdrop);
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = ID.backdrop;
      backdrop.addEventListener('click', event => {
        if (event.target === backdrop) closePanel();
      });
      document.body.appendChild(backdrop);
    }

    backdrop.hidden = false;
    renderPanel();
  }

  function closePanel() {
    state.panelOpen = false;
    closeSubdialog();
    const backdrop = document.getElementById(ID.backdrop);
    if (backdrop) backdrop.hidden = true;
  }

  function renderPanel() {
    const backdrop = document.getElementById(ID.backdrop);
    if (!backdrop) return;

    let panel = document.getElementById(ID.panel);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = ID.panel;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Lectio Tools');
      backdrop.appendChild(panel);
    }

    const counts = getCollectionCounts();

    panel.innerHTML = `
      <header class="lm-header">
        <h2>Lectio Tools</h2>
        <div class="lm-header-actions">
          <button type="button" class="lm-icon-button ${state.settingsView ? 'is-active' : ''}" data-action="settings" title="Manager settings" aria-label="Manager settings">${iconSvg('settings')}</button>
          <button type="button" class="lm-icon-button" data-action="help" title="Help" aria-label="Help">${iconSvg('help')}</button>
          <button type="button" class="lm-icon-button ${state.refreshInFlight ? 'is-spinning' : ''}" data-action="refresh" title="Refresh catalogues" aria-label="Refresh catalogues">${iconSvg('refresh')}</button>
          <button type="button" class="lm-icon-button" data-action="close" title="Close" aria-label="Close">${iconSvg('close')}</button>
        </div>
      </header>
      ${state.settingsView ? '' : `
        <nav class="lm-tabs" aria-label="Tool collections">
          <button type="button" data-collection="installed" class="${state.activeCollection === 'installed' ? 'active' : ''}">
            Installed <strong>${counts.installed}</strong>
          </button>
          <button type="button" data-collection="available" class="${state.activeCollection === 'available' ? 'active' : ''}">
            Available <strong>${counts.available}</strong>
          </button>
        </nav>
      `}
      <div id="${ID.body}" class="lm-body"></div>
      <footer class="lm-footer"><button type="button" data-action="report">Report a bug or idea</button></footer>
    `;

    panel.querySelector('[data-action="close"]').addEventListener('click', closePanel);
    panel.querySelector('[data-action="settings"]').addEventListener('click', () => {
      state.settingsView = !state.settingsView;
      renderPanel();
    });
    panel.querySelector('[data-action="help"]').addEventListener('click', showHelpDialog);
    panel.querySelector('[data-action="refresh"]').addEventListener('click', () => {
      void refreshCatalogues({ force: true });
    });
    panel.querySelector('[data-action="report"]').addEventListener('click', () => {
      window.open('https://github.com/RktRobinhood/Lectio-Scripts/issues/new/choose', '_blank', 'noopener,noreferrer');
    });

    for (const tab of panel.querySelectorAll('[data-collection]')) {
      tab.addEventListener('click', () => {
        state.activeCollection = normalizeCollection(tab.dataset.collection);
        GM_setValue(KEY.activeCollection, state.activeCollection);
        renderPanel();
      });
    }

    renderPanelBody();
  }

  function renderPanelBody() {
    if (!state.panelOpen) return;
    const body = document.getElementById(ID.body);
    if (!body) return;
    body.innerHTML = '';

    if (state.statusMessage) {
      const status = document.createElement('div');
      status.className = `lm-status is-${state.statusKind}`;
      status.textContent = state.statusMessage;
      body.appendChild(status);
    }

    if (state.settingsView) {
      renderManagerSettings(body);
      return;
    }

    if (!state.stableCatalogue) {
      const empty = document.createElement('div');
      empty.className = 'lm-empty';
      empty.innerHTML = '<strong>Loading tool catalogue...</strong><span>Last known good data is kept if GitHub is temporarily unavailable.</span>';
      body.appendChild(empty);
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'lm-list-toolbar';
    toolbar.innerHTML = `
      <div class="lm-list-label">${state.activeCollection === 'installed' ? 'INSTALLED' : 'AVAILABLE'} - ${getCollectionCounts()[state.activeCollection]}</div>
      <div class="lm-sort-toggle" role="group" aria-label="Sort tools">
        <button type="button" data-sort="category" class="${state.sortMode === 'category' ? 'active' : ''}">Category</button>
        <button type="button" data-sort="az" class="${state.sortMode === 'az' ? 'active' : ''}">A-Z</button>
      </div>
    `;
    for (const button of toolbar.querySelectorAll('[data-sort]')) {
      button.addEventListener('click', () => {
        state.sortMode = normalizeSortMode(button.dataset.sort);
        GM_setValue(KEY.sortMode, state.sortMode);
        renderPanelBody();
      });
    }
    body.appendChild(toolbar);

    if (state.channel === 'unstable') {
      const banner = document.createElement('div');
      banner.className = 'lm-channel-note';
      banner.innerHTML = '<strong>UNSTABLE</strong><span>Experimental builds are visible. Channel changes never install or remove tools automatically.</span>';
      body.appendChild(banner);
    }

    const entries = state.activeCollection === 'installed'
      ? buildInstalledEntries()
      : buildAvailableEntries();

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'lm-empty';
      empty.textContent = state.activeCollection === 'installed'
        ? 'No Lectio tools are currently detected.'
        : `No additional ${state.channel === 'unstable' ? 'Stable or Unstable' : 'Stable'} tools are available.`;
      body.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'lm-module-list';

    if (state.sortMode === 'az') {
      for (const entry of [...entries].sort((a, b) => displayName(a).localeCompare(displayName(b)))) {
        list.appendChild(renderModuleCard(entry));
      }
    } else {
      const groups = groupByCategory(entries);
      for (const [category, categoryEntries] of groups) {
        const heading = document.createElement('div');
        heading.className = 'lm-category-heading';
        heading.textContent = category.toUpperCase();
        list.appendChild(heading);
        for (const entry of categoryEntries) list.appendChild(renderModuleCard(entry));
      }
    }

    body.appendChild(list);
  }

  function renderManagerSettings(body) {
    const section = document.createElement('section');
    section.className = 'lm-settings-section';
    section.innerHTML = `
      <div class="lm-settings-heading">
        <div>
          <h3>Release channel</h3>
          <p>The channel controls what can be installed or updated. It does not hide installed tools and never changes them automatically.</p>
        </div>
        <span class="lm-version">Manager v${escapeHtml(VERSION)}</span>
      </div>
      <div class="lm-channel-options">
        <label class="lm-channel-option ${state.channel === 'stable' ? 'selected' : ''}">
          <input type="radio" name="lm-channel" value="stable" ${state.channel === 'stable' ? 'checked' : ''}>
          <span><strong>Stable</strong><small>Only production catalogue entries are offered in Available.</small></span>
        </label>
        <label class="lm-channel-option is-danger ${state.channel === 'unstable' ? 'selected' : ''}">
          <input type="radio" name="lm-channel" value="unstable" ${state.channel === 'unstable' ? 'checked' : ''}>
          <span><strong>Unstable</strong><small>Includes experimental overlay modules and test versions.</small></span>
        </label>
      </div>
      <div class="lm-settings-note">
        <strong>Installed means installed.</strong> Experimental tools that are already running remain visible in the Installed tab after you return to Stable. Uninstalled experimental tools disappear from Available.
      </div>
      <div class="lm-refresh-info">
        <div><strong>Stable catalogue:</strong> ${escapeHtml(formatRefresh(state.stableRefreshedAt))}</div>
        <div><strong>Unstable overlay:</strong> ${escapeHtml(formatRefresh(state.unstableRefreshedAt))}</div>
        <div><strong>Unstable refresh interval:</strong> 5 minutes while Unstable is selected</div>
      </div>
    `;

    for (const input of section.querySelectorAll('input[name="lm-channel"]')) {
      input.addEventListener('change', () => void setChannel(input.value));
    }
    body.appendChild(section);
  }

  async function setChannel(nextValue) {
    const next = normalizeChannel(nextValue);
    if (next === state.channel) return;

    if (next === 'unstable') {
      const accepted = window.confirm(
        'Switch Lectio Tools to the UNSTABLE channel?\n\n' +
        'Experimental modules may contain bugs or breaking changes. Nothing is installed automatically.'
      );
      if (!accepted) {
        renderPanel();
        return;
      }
    }

    state.channel = next;
    GM_setValue(KEY.channel, state.channel);
    state.statusMessage = next === 'unstable'
      ? 'Unstable channel selected. No installed tools were changed.'
      : 'Stable channel selected. Installed experimental tools remain visible until you pause or remove them.';
    state.statusKind = 'success';
    requestModuleDiscovery();

    if (next === 'unstable') {
      await refreshCatalogues({ force: true });
    } else {
      renderPanel();
    }
  }

  function getCollectionCounts() {
    return {
      installed: buildInstalledEntries().length,
      available: state.stableCatalogue ? buildAvailableEntries().length : 0
    };
  }

  function buildEffectiveModules() {
    const stable = state.stableCatalogue?.modules || [];
    const byId = new Map(stable.map(module => [module.id, {
      ...module,
      selectedChannel: 'stable',
      stableModule: module,
      unstableModule: null
    }]));

    if (state.channel !== 'unstable') return [...byId.values()];

    for (const experimental of state.unstableCatalogue?.modules || []) {
      const stableMatch = findStableMatch(stable, experimental);
      if (stableMatch) {
        byId.set(stableMatch.id, {
          ...stableMatch,
          ...experimental,
          id: stableMatch.id,
          aliases: uniqueStrings([...(stableMatch.aliases || []), ...(experimental.aliases || []), experimental.id]),
          selectedChannel: 'unstable',
          stableModule: stableMatch,
          unstableModule: experimental
        });
      } else {
        byId.set(experimental.id, {
          ...experimental,
          selectedChannel: 'unstable',
          stableModule: null,
          unstableModule: experimental
        });
      }
    }

    return [...byId.values()];
  }

  function buildInstalledEntries() {
    const selected = buildEffectiveModules();
    const overlay = state.unstableCatalogue?.modules || [];
    const entries = [];

    for (const registration of state.registrations.values()) {
      let module = selected.find(candidate => registrationMatchesModule(registration, candidate)) || null;
      let outsideSelectedChannel = false;

      if (!module) {
        const unstable = overlay.find(candidate => registrationMatchesModule(registration, candidate)) || null;
        if (unstable) {
          module = {
            ...unstable,
            selectedChannel: 'unstable',
            stableModule: null,
            unstableModule: unstable
          };
        } else {
          module = {
            id: registration.id,
            aliases: registration.aliases || [],
            name: registration.name,
            description: '',
            version: registration.version,
            installUrl: '',
            category: registration.channel === 'unstable' ? 'Experimental' : 'Other',
            status: registration.channel === 'unstable' ? 'unstable' : registration.channel,
            selectedChannel: registration.channel === 'unstable' ? 'unstable' : 'stable',
            stableModule: null,
            unstableModule: null
          };
        }
        outsideSelectedChannel = true;
      }

      entries.push({
        module,
        registration,
        installed: true,
        outsideSelectedChannel,
        experimental: registration.channel === 'unstable' || module.selectedChannel === 'unstable' || module.status === 'unstable'
      });
    }

    return dedupeEntries(entries);
  }

  function buildAvailableEntries() {
    return buildEffectiveModules()
      .filter(module => !findRegistrationForModule(module))
      .map(module => ({
        module,
        registration: null,
        installed: false,
        outsideSelectedChannel: false,
        experimental: module.selectedChannel === 'unstable' || module.status === 'unstable'
      }));
  }

  function dedupeEntries(entries) {
    const seen = new Set();
    return entries.filter(entry => {
      const key = entry.registration?.id || entry.module.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function findStableMatch(stableModules, experimental) {
    const experimentalIds = new Set([experimental.id, ...(experimental.aliases || [])]);
    return stableModules.find(stable => {
      if (experimentalIds.has(stable.id)) return true;
      const stableIds = new Set([stable.id, ...(stable.aliases || [])]);
      if (stableIds.has(experimental.id)) return true;
      return [...experimentalIds].some(id => stableIds.has(id));
    }) || null;
  }

  function registrationMatchesModule(registration, module) {
    const moduleIds = new Set([module.id, ...(module.aliases || [])]);
    if (module.stableModule) {
      moduleIds.add(module.stableModule.id);
      for (const alias of module.stableModule.aliases || []) moduleIds.add(alias);
    }
    if (module.unstableModule) {
      moduleIds.add(module.unstableModule.id);
      for (const alias of module.unstableModule.aliases || []) moduleIds.add(alias);
    }
    const registrationIds = new Set([registration.id, ...(registration.aliases || [])]);
    for (const id of registrationIds) if (moduleIds.has(id)) return true;
    return false;
  }

  function findRegistrationForModule(module) {
    for (const registration of state.registrations.values()) {
      if (registrationMatchesModule(registration, module)) return registration;
    }
    return null;
  }

  function groupByCategory(entries) {
    const groups = new Map();
    const sorted = [...entries].sort((a, b) => {
      const ca = displayCategory(a);
      const cb = displayCategory(b);
      const c = ca.localeCompare(cb);
      return c || displayName(a).localeCompare(displayName(b));
    });
    for (const entry of sorted) {
      const category = displayCategory(entry);
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(entry);
    }
    return groups;
  }

  function displayCategory(entry) {
    const raw = cleanString(entry.module?.category) || 'Other';
    const map = {
      schedule: 'Timetable',
      timetable: 'Timetable',
      message: 'Messages',
      messages: 'Messages',
      interface: 'Interface',
      testing: 'Testing',
      experimental: 'Experimental'
    };
    return map[raw.toLowerCase()] || raw;
  }

  function displayName(entry) {
    return entry.module?.name || entry.registration?.name || entry.module?.id || 'Unknown tool';
  }

  function renderModuleCard(entry) {
    const { module, registration } = entry;
    const card = document.createElement('article');
    card.className = `lm-module-card ${entry.experimental ? 'is-unstable' : ''} ${entry.outsideSelectedChannel ? 'is-outside-channel' : ''}`;

    const paused = registration ? isModulePaused(registration.id) : false;
    const action = registration ? determineAction(module, registration) : determineAction(module, null);
    const category = displayCategory(entry).toUpperCase();
    const tags = [
      `<span class="lm-tag">${escapeHtml(category)}</span>`,
      entry.experimental ? '<span class="lm-tag is-unstable">experimental</span>' : '',
      paused ? '<span class="lm-tag is-paused">paused</span>' : '',
      entry.outsideSelectedChannel && state.channel === 'stable'
        ? '<span class="lm-tag is-muted">installed only</span>'
        : ''
    ].filter(Boolean).join(' ');

    const versionLine = registration
      ? buildInstalledVersionLine(entry, action)
      : `<span>Version <strong>v${escapeHtml(module.version)}</strong></span>`;

    card.innerHTML = `
      <div class="lm-module-main">
        <div class="lm-module-tags">${tags}</div>
        <h3>${escapeHtml(displayName(entry))}</h3>
        ${module.description ? `<p>${escapeHtml(module.description)}</p>` : ''}
        <div class="lm-version-line">${versionLine}</div>
      </div>
      <div class="lm-module-actions"></div>
    `;

    const actions = card.querySelector('.lm-module-actions');

    if (!registration) {
      actions.appendChild(makeTextAction(action.label, () => openInstall(module, action), 'Install this tool'));
      return card;
    }

    if (action.kind !== 'current') {
      actions.appendChild(makeTextAction(action.label, () => openInstall(module, action), action.tooltip));
    }

    const consoleEl = document.createElement('div');
    consoleEl.className = 'lm-action-console';

    const pauseSupported = supportsManagerPause(registration);
    const pauseButton = makeIconAction(
      paused ? 'play' : 'pause',
      paused ? 'Enable tool' : 'Pause tool',
      () => toggleModulePause(entry),
      { disabled: !pauseSupported }
    );
    if (!pauseSupported) {
      pauseButton.title = 'This installed version does not yet support Manager pause. Disable it in Tampermonkey instead.';
    }
    consoleEl.appendChild(pauseButton);

    consoleEl.appendChild(makeIconAction('settings', 'Tool settings', () => showModuleSettings(entry)));
    consoleEl.appendChild(makeIconAction('trash', 'Uninstall / remove', () => showRemoveDialog(entry), { danger: true }));
    actions.appendChild(consoleEl);

    return card;
  }

  function buildInstalledVersionLine(entry, action) {
    const installed = escapeHtml(entry.registration.version);
    if (action.kind === 'current') {
      return `<span class="lm-installed-current">Installed v${installed}</span>`;
    }
    if (action.kind === 'upgrade') {
      return `<span class="lm-installed-update">Update available: v${escapeHtml(entry.module.version)} <small>(installed v${installed})</small></span>`;
    }
    if (action.kind === 'downgrade') {
      return `<span class="lm-installed-update is-downgrade">Stable target v${escapeHtml(entry.module.version)} <small>(installed v${installed})</small></span>`;
    }
    return `<span>Installed <strong>v${installed}</strong></span>`;
  }

  function determineAction(module, registration) {
    if (!registration) {
      return {
        kind: 'install',
        label: module.selectedChannel === 'unstable' ? 'Install test' : 'Install',
        tooltip: `Open ${module.version} in Tampermonkey. Nothing is installed until you confirm there.`
      };
    }

    if (!module.installUrl || !module.version) {
      return { kind: 'current', label: 'Installed', tooltip: '' };
    }

    const comparison = compareVersions(registration.version, module.version);
    if (comparison === null) {
      return {
        kind: 'reinstall',
        label: 'Reinstall',
        tooltip: `The Manager cannot safely compare ${registration.version} with ${module.version}.`
      };
    }
    if (comparison < 0) {
      return {
        kind: 'upgrade',
        label: 'Update',
        tooltip: `Update from ${registration.version} to ${module.version}. Tampermonkey will ask you to confirm.`
      };
    }
    if (comparison > 0) {
      return {
        kind: 'downgrade',
        label: 'Downgrade',
        tooltip: `Return from ${registration.version} to selected ${state.channel} target ${module.version}. Tampermonkey will ask you to confirm.`
      };
    }
    return { kind: 'current', label: 'Up to date', tooltip: '' };
  }

  function openInstall(module, action) {
    if (!isApprovedInstallUrl(module.installUrl)) {
      state.statusMessage = `No approved install URL is available for ${module.name}.`;
      state.statusKind = 'error';
      renderPanelBody();
      return;
    }

    const verb = action.kind === 'downgrade' ? 'downgrade' :
      action.kind === 'upgrade' ? 'update' :
      action.kind === 'reinstall' ? 'reinstall' : 'install';
    state.statusMessage = `Opening ${module.name} to ${verb} through Tampermonkey.`;
    state.statusKind = 'info';
    renderPanelBody();

    const opened = window.open(module.installUrl, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = module.installUrl;
  }

  function makeTextAction(label, handler, title = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lm-text-action';
    button.textContent = label;
    if (title) button.title = title;
    button.addEventListener('click', handler);
    return button;
  }

  function makeIconAction(icon, label, handler, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lm-console-button ${options.danger ? 'is-danger' : ''}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = iconSvg(icon);
    if (options.disabled) button.disabled = true;
    else button.addEventListener('click', handler);
    return button;
  }

  function supportsManagerPause(registration) {
    return Boolean(
      registration?.capabilities?.pause === true ||
      registration?.capabilities?.managerPause === true ||
      typeof registration?.setEnabled === 'function'
    );
  }

  function readDisabledModules() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DISABLED_MODULES_KEY) || '[]');
      return new Set(Array.isArray(parsed) ? parsed.map(cleanString).filter(Boolean) : []);
    } catch (_) {
      return new Set();
    }
  }

  function writeDisabledModules(set) {
    try {
      localStorage.setItem(DISABLED_MODULES_KEY, JSON.stringify([...set].sort()));
    } catch (_) {}
  }

  function isModulePaused(id) {
    return readDisabledModules().has(id);
  }

  function toggleModulePause(entry) {
    const registration = entry.registration;
    if (!registration || !supportsManagerPause(registration)) return;

    const disabled = readDisabledModules();
    const nextPaused = !disabled.has(registration.id);
    if (nextPaused) disabled.add(registration.id);
    else disabled.delete(registration.id);
    writeDisabledModules(disabled);

    if (registration.setEnabled) {
      try { registration.setEnabled(!nextPaused); } catch (_) {}
    }

    const detail = {
      moduleId: registration.id,
      aliases: registration.aliases || [],
      enabled: !nextPaused,
      source: 'lectio-manager'
    };
    window.dispatchEvent(new CustomEvent('lectio-manager:module-enabled-change', { detail }));
    window.dispatchEvent(new CustomEvent('lectio-manager:set-enabled', { detail }));

    state.statusMessage = nextPaused
      ? `${registration.name} is paused. Reloading Lectio so it stops cleanly.`
      : `${registration.name} is enabled. Reloading Lectio.`;
    state.statusKind = 'success';
    renderPanelBody();
    window.setTimeout(() => location.reload(), 300);
  }

  function showModuleSettings(entry) {
    const registration = entry.registration;
    const schema = Array.isArray(registration?.settingsSchema) ? registration.settingsSchema : [];

    if (!schema.length) {
      showDialog({
        title: `${displayName(entry)} settings`,
        bodyHtml: '<p>This installed version does not expose configurable settings to Lectio Tools yet.</p>',
        buttons: [{ label: 'Close', kind: 'secondary', action: closeSubdialog }]
      });
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'lm-setting-list';
    const controls = new Map();

    for (const item of schema) {
      const key = cleanString(item.key || item.id);
      if (!key) continue;
      const row = document.createElement('label');
      row.className = 'lm-setting-row';

      const copy = document.createElement('span');
      copy.className = 'lm-setting-copy';
      copy.innerHTML = `<strong>${escapeHtml(item.label || key)}</strong>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}`;

      const current = registration.currentValues?.[key] ?? item.value ?? item.defaultValue ?? item.default;
      let control;
      const type = String(item.type || item.control || item.kind || '').toLowerCase();

      if (type === 'boolean' || type === 'toggle' || item.inputType === 'checkbox') {
        control = document.createElement('input');
        control.type = 'checkbox';
        control.checked = Boolean(current);
      } else if (type === 'select' || Array.isArray(item.options) || Array.isArray(item.choices)) {
        control = document.createElement('select');
        const options = Array.isArray(item.options) ? item.options : item.choices || [];
        for (const option of options) {
          const el = document.createElement('option');
          const value = option && typeof option === 'object' ? option.value : option;
          const label = option && typeof option === 'object' ? (option.label ?? option.value) : option;
          el.value = String(value);
          el.textContent = String(label);
          if (String(value) === String(current)) el.selected = true;
          control.appendChild(el);
        }
      } else {
        control = document.createElement('input');
        control.type = type === 'number' ? 'number' : 'text';
        control.value = current ?? '';
      }

      control.dataset.settingKey = key;
      row.append(copy, control);
      wrapper.appendChild(row);
      controls.set(key, { item, control });
    }

    showDialog({
      title: `${displayName(entry)} settings`,
      bodyNode: wrapper,
      buttons: [
        { label: 'Cancel', kind: 'secondary', action: closeSubdialog },
        {
          label: 'Save',
          kind: 'primary',
          action: () => {
            const values = {};
            for (const [key, { item, control }] of controls) {
              let value;
              if (control.type === 'checkbox') value = control.checked;
              else value = control.value;
              const defaultValue = item.defaultValue ?? item.default;
              if (typeof defaultValue === 'number' && value !== '') value = Number(value);
              values[key] = value;
            }
            applyModuleSettings(registration, values);
            closeSubdialog();
          }
        }
      ]
    });
  }

  function applyModuleSettings(registration, values) {
    try {
      if (registration.updateSettings) {
        registration.updateSettings(values);
      } else if (registration.setSetting || registration.applySetting) {
        const fn = registration.setSetting || registration.applySetting;
        for (const [key, value] of Object.entries(values)) fn(key, value);
      } else {
        const detail = { moduleId: registration.id, values, source: 'lectio-manager' };
        for (const eventName of [
          'lectio-manager:settings-change',
          'lectio-manager:update-setting',
          'lectio-module:update-settings'
        ]) {
          window.dispatchEvent(new CustomEvent(eventName, { detail }));
        }
      }
      registration.currentValues = { ...registration.currentValues, ...values };
      state.statusMessage = `${registration.name} settings saved.`;
      state.statusKind = 'success';
      window.setTimeout(requestModuleDiscovery, 100);
      renderPanelBody();
    } catch (error) {
      state.statusMessage = `Could not update ${registration.name}: ${error.message}`;
      state.statusKind = 'error';
      renderPanelBody();
    }
  }

  function showRemoveDialog(entry) {
    const name = displayName(entry);
    const pauseSupported = supportsManagerPause(entry.registration);
    const body = document.createElement('div');
    body.innerHTML = `
      <p><strong>${escapeHtml(name)}</strong> is installed in your userscript manager.</p>
      <p>Tampermonkey does not expose a userscript API that lets one script uninstall another. The trash button therefore takes you through a safe manual removal instead of pretending the script was deleted.</p>
      <ol>
        <li>Open the Tampermonkey dashboard.</li>
        <li>Find <strong>${escapeHtml(name)}</strong>.</li>
        <li>Use Tampermonkey's delete/remove control.</li>
        <li>Reload Lectio. It will disappear from Installed automatically.</li>
      </ol>
    `;

    const buttons = [
      { label: 'Copy tool name', kind: 'secondary', action: () => copyText(name) }
    ];
    if (pauseSupported && !isModulePaused(entry.registration.id)) {
      buttons.push({ label: 'Pause instead', kind: 'secondary', action: () => { closeSubdialog(); toggleModulePause(entry); } });
    }
    buttons.push({ label: 'Close', kind: 'primary', action: closeSubdialog });

    showDialog({ title: 'Remove tool', bodyNode: body, buttons });
  }

  function showHelpDialog() {
    showDialog({
      title: 'Lectio Tools help',
      bodyHtml: `
        <p><strong>Installed</strong> always shows tools that are actually detected, including experimental tools while Stable is selected.</p>
        <p><strong>Available</strong> follows the selected release channel. Stable hides uninstalled experimental tools; Unstable includes them.</p>
        <p>The pause icon is active only for module versions that support Manager pause. The trash icon explains the Tampermonkey removal step because userscripts cannot uninstall one another directly.</p>
      `,
      buttons: [{ label: 'Close', kind: 'primary', action: closeSubdialog }]
    });
  }

  function showDialog({ title, bodyHtml = '', bodyNode = null, buttons = [] }) {
    closeSubdialog();
    const host = document.createElement('div');
    host.id = ID.dialog;
    host.className = 'lm-subdialog-backdrop';
    host.innerHTML = `
      <section class="lm-subdialog" role="dialog" aria-modal="true">
        <header><h3>${escapeHtml(title)}</h3><button type="button" data-dialog-close aria-label="Close">${iconSvg('close')}</button></header>
        <div class="lm-subdialog-body"></div>
        <footer class="lm-subdialog-actions"></footer>
      </section>
    `;
    const body = host.querySelector('.lm-subdialog-body');
    if (bodyNode) body.appendChild(bodyNode);
    else body.innerHTML = bodyHtml;

    const footer = host.querySelector('.lm-subdialog-actions');
    for (const spec of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `lm-dialog-button ${spec.kind === 'primary' ? 'is-primary' : ''}`;
      button.textContent = spec.label;
      button.addEventListener('click', spec.action);
      footer.appendChild(button);
    }

    host.querySelector('[data-dialog-close]').addEventListener('click', closeSubdialog);
    host.addEventListener('click', event => {
      if (event.target === host) closeSubdialog();
    });
    document.body.appendChild(host);
  }

  function closeSubdialog() {
    document.getElementById(ID.dialog)?.remove();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      state.statusMessage = `Copied: ${text}`;
      state.statusKind = 'success';
      closeSubdialog();
      renderPanelBody();
    } catch (_) {
      window.prompt('Copy this tool name:', text);
    }
  }

  function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) return null;

    for (let i = 0; i < 3; i += 1) {
      if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
    }

    if (!a.pre.length && !b.pre.length) return 0;
    if (!a.pre.length) return 1;
    if (!b.pre.length) return -1;

    const length = Math.max(a.pre.length, b.pre.length);
    for (let i = 0; i < length; i += 1) {
      const av = a.pre[i];
      const bv = b.pre[i];
      if (av === undefined) return -1;
      if (bv === undefined) return 1;
      if (av === bv) continue;

      const an = /^\d+$/.test(av) ? Number(av) : null;
      const bn = /^\d+$/.test(bv) ? Number(bv) : null;
      if (an !== null && bn !== null) return an < bn ? -1 : 1;
      if (an !== null) return -1;
      if (bn !== null) return 1;
      return av.localeCompare(bv) < 0 ? -1 : 1;
    }

    return 0;
  }

  function parseVersion(value) {
    const text = String(value || '').trim().replace(/^v/i, '');
    const match = text.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) return null;
    return {
      core: [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)],
      pre: match[4] ? match[4].split('.') : []
    };
  }

  function formatRefresh(timestamp) {
    if (!timestamp) return 'not yet refreshed';
    try {
      return new Date(timestamp).toLocaleString([], {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (_) {
      return 'unknown';
    }
  }

  function uniqueStrings(values) {
    return [...new Set(values.map(cleanString).filter(Boolean))];
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function iconSvg(name) {
    const icons = {
      tools: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 4.2v-1.4l-2-.7a7 7 0 0 0-.6-1.4l.9-1.9-1-1-1.9.9a7 7 0 0 0-1.4-.6l-.7-2h-1.4l-.7 2a7 7 0 0 0-1.4.6l-1.9-.9-1 1 .9 1.9a7 7 0 0 0-.6 1.4l-2 .7v1.4l2 .7c.1.5.3 1 .6 1.4l-.9 1.9 1 1 1.9-.9c.4.3.9.5 1.4.6l.7 2h1.4l.7-2c.5-.1 1-.3 1.4-.6l1.9.9 1-1-.9-1.9c.3-.4.5-.9.6-1.4l2-.7Z"/></svg>',
      settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 4.2v-1.4l-2-.7a7 7 0 0 0-.6-1.4l.9-1.9-1-1-1.9.9a7 7 0 0 0-1.4-.6l-.7-2h-1.4l-.7 2a7 7 0 0 0-1.4.6l-1.9-.9-1 1 .9 1.9a7 7 0 0 0-.6 1.4l-2 .7v1.4l2 .7c.1.5.3 1 .6 1.4l-.9 1.9 1 1 1.9-.9c.4.3.9.5 1.4.6l.7 2h1.4l.7-2c.5-.1 1-.3 1.4-.6l1.9.9 1-1-.9-1.9c.3-.4.5-.9.6-1.4l2-.7Z"/></svg>',
      help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 0 1 4.6 1c0 1.9-2.4 2.1-2.4 4"/><path d="M12 17h.01"/></svg>',
      refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 4"/></svg>',
      close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
      pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12"/></svg>',
      play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6Z"/></svg>',
      trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>'
    };
    return icons[name] || icons.help;
  }

  function installStyles() {
    if (document.getElementById(ID.style)) return;
    const style = document.createElement('style');
    style.id = ID.style;
    style.textContent = `
      #${ID.launcher} {
        position: fixed; right: 14px; bottom: 14px; z-index: 2147482500;
        width: 38px; height: 38px; padding: 8px; border: 1px solid rgba(25,82,105,.55);
        border-radius: 50%; background: #237b96; color: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.18);
        cursor: pointer;
      }
      #${ID.launcher} svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      #${ID.backdrop} {
        position: fixed; inset: 0; z-index: 2147482800; display: flex; align-items: center; justify-content: center;
        padding: 18px; box-sizing: border-box; background: rgba(20,30,40,.20);
      }
      #${ID.backdrop}[hidden] { display: none !important; }
      #${ID.panel} {
        width: min(430px, calc(100vw - 24px)); height: min(704px, calc(100vh - 32px));
        overflow: hidden; display: flex; flex-direction: column; border: 1px solid #5f8195; border-radius: 12px;
        background: #f8fafb; color: #26343d; box-shadow: 0 18px 60px rgba(0,0,0,.24);
        font: 13px/1.35 Arial, Helvetica, sans-serif;
      }
      .lm-header {
        flex: 0 0 auto; min-height: 50px; display: flex; align-items: center; justify-content: space-between;
        padding: 0 14px 0 98px; background: #2b7b94; color: #fff;
      }
      .lm-header h2 { margin: 0; font-size: 15px; color: #fff; }
      .lm-header-actions { display: flex; align-items: center; gap: 6px; }
      .lm-icon-button {
        width: 30px; height: 30px; padding: 6px; border: 0; border-radius: 6px; background: transparent; color: #fff; cursor: pointer;
      }
      .lm-icon-button:hover, .lm-icon-button.is-active { background: rgba(255,255,255,.13); }
      .lm-icon-button svg, .lm-console-button svg, .lm-subdialog header button svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .lm-icon-button.is-spinning svg { animation: lm-spin .9s linear infinite; }
      @keyframes lm-spin { to { transform: rotate(360deg); } }
      .lm-tabs { flex: 0 0 auto; display: grid; grid-template-columns: 1fr 1fr; background: #fff; border-bottom: 1px solid #829aa9; }
      .lm-tabs button {
        border: 0; border-bottom: 2px solid transparent; background: transparent; padding: 13px 8px 10px;
        color: #667984; font-weight: 700; cursor: pointer;
      }
      .lm-tabs button.active { color: #27708a; border-bottom-color: #277c9d; }
      .lm-tabs strong { font-size: 11px; }
      .lm-body { flex: 1 1 auto; overflow: auto; padding: 10px 14px 12px; }
      .lm-footer { flex: 0 0 auto; display: flex; justify-content: center; border-top: 1px solid #a8b8c1; background: #e9f1f5; }
      .lm-footer button { border: 0; background: transparent; color: #237094; font-weight: 700; font-size: 11px; padding: 9px 12px; cursor: pointer; }
      .lm-list-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; }
      .lm-list-label { color: #6b7f8b; font-size: 12px; font-weight: 800; letter-spacing: .04em; }
      .lm-sort-toggle { display: inline-flex; border: 1px solid #7f9bad; border-radius: 7px; overflow: hidden; }
      .lm-sort-toggle button { border: 0; border-right: 1px solid #a7bac4; background: #f8fbfc; color: #476878; padding: 4px 8px; font-size: 10px; cursor: pointer; }
      .lm-sort-toggle button:last-child { border-right: 0; }
      .lm-sort-toggle button.active { background: #dcecf2; color: #21657d; font-weight: 800; }
      .lm-channel-note { display: flex; gap: 8px; align-items: center; margin: 0 0 8px; padding: 7px 9px; border-radius: 7px; background: #fff5df; color: #76500d; font-size: 10px; }
      .lm-channel-note strong { font-size: 9px; letter-spacing: .08em; }
      .lm-status { margin-bottom: 8px; border-radius: 7px; padding: 7px 9px; background: #edf4f8; color: #31566f; font-size: 10px; }
      .lm-status.is-error { background: #fff0ed; color: #8a2d1d; }
      .lm-status.is-success { background: #eaf6ee; color: #26613c; }
      .lm-module-list { display: grid; gap: 8px; }
      .lm-category-heading { text-align: center; color: #71828d; font-size: 10px; font-weight: 800; letter-spacing: .05em; margin: 2px 0 -2px; }
      .lm-module-card {
        position: relative; display: flex; justify-content: space-between; align-items: center; gap: 10px;
        border: 1px solid #6f8999; border-radius: 10px; background: rgba(255,255,255,.96); padding: 10px 12px 9px;
        box-shadow: inset 3px 0 0 #c9b47f;
      }
      .lm-module-card.is-unstable { box-shadow: inset 3px 0 0 #d99b46; }
      .lm-module-card.is-outside-channel { border-style: dashed; }
      .lm-module-main { min-width: 0; flex: 1 1 auto; }
      .lm-module-tags { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 5px; }
      .lm-tag { display: inline-flex; border-radius: 999px; padding: 2px 7px; background: #dcebf0; color: #24718a; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
      .lm-tag.is-unstable { background: #fff0dc; color: #a76109; }
      .lm-tag.is-paused { background: #eceff1; color: #58666e; }
      .lm-tag.is-muted { background: #eff1f2; color: #7b858b; }
      .lm-module-card h3 { margin: 0 0 4px; color: #26343d; font-size: 14px; }
      .lm-module-card p { margin: 0 0 5px; color: #607079; font-size: 10px; }
      .lm-version-line { color: #667780; font-size: 10px; }
      .lm-installed-current { color: #0b7b4a; font-weight: 800; }
      .lm-installed-update { color: #a45b00; font-weight: 800; }
      .lm-installed-update small { display: block; font-weight: 700; }
      .lm-installed-update.is-downgrade { color: #855b16; }
      .lm-module-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; }
      .lm-text-action { border: 1px solid #2b7898; border-radius: 7px; background: #fff; color: #24718f; padding: 5px 9px; font-weight: 800; font-size: 10px; cursor: pointer; }
      .lm-action-console { display: inline-flex; gap: 3px; align-items: center; padding-left: 2px; }
      .lm-console-button { width: 28px; height: 28px; padding: 5px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #4b7184; cursor: pointer; }
      .lm-console-button:hover { border-color: #aac0cc; background: #eef5f8; color: #216b87; }
      .lm-console-button.is-danger:hover { border-color: #e0aaa3; background: #fff0ed; color: #a33b2e; }
      .lm-console-button:disabled { opacity: .28; cursor: not-allowed; }
      .lm-empty { display: flex; flex-direction: column; gap: 4px; border: 1px dashed #c9d3db; border-radius: 8px; padding: 18px; text-align: center; color: #63717b; }
      .lm-settings-section { border: 1px solid #c7d4dc; border-radius: 9px; background: #fff; padding: 13px; }
      .lm-settings-heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
      .lm-settings-heading h3 { margin: 0; color: #244760; font-size: 14px; }
      .lm-settings-heading p { margin: 4px 0 12px; color: #5f6e79; font-size: 11px; }
      .lm-version { color: #74848d; font-size: 9px; white-space: nowrap; }
      .lm-channel-options { display: grid; gap: 8px; }
      .lm-channel-option { display: flex; gap: 9px; border: 1px solid #ccd7df; border-radius: 8px; padding: 9px; cursor: pointer; }
      .lm-channel-option.selected { border-color: #4680a8; background: #f3f8fb; box-shadow: inset 0 0 0 1px #4680a8; }
      .lm-channel-option.is-danger.selected { border-color: #cc8428; background: #fff9ee; box-shadow: inset 0 0 0 1px #cc8428; }
      .lm-channel-option span { display: flex; flex-direction: column; gap: 2px; }
      .lm-channel-option small { color: #6b7781; font-size: 10px; }
      .lm-settings-note { margin-top: 12px; border-left: 3px solid #7497ae; padding: 8px 10px; background: #f5f8fa; color: #53616b; font-size: 10px; }
      .lm-refresh-info { display: grid; gap: 3px; margin-top: 12px; color: #6b7781; font-size: 10px; }
      .lm-subdialog-backdrop { position: fixed; inset: 0; z-index: 2147483400; display: flex; align-items: center; justify-content: center; padding: 18px; background: rgba(15,25,35,.38); }
      .lm-subdialog { width: min(420px, calc(100vw - 32px)); max-height: min(620px, calc(100vh - 40px)); overflow: hidden; display: flex; flex-direction: column; border: 1px solid #7794a4; border-radius: 11px; background: #fff; box-shadow: 0 18px 60px rgba(0,0,0,.30); color: #293942; }
      .lm-subdialog header { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 11px 13px; border-bottom: 1px solid #d5dfe4; }
      .lm-subdialog header h3 { margin: 0; font-size: 14px; }
      .lm-subdialog header button { width: 28px; height: 28px; padding: 6px; border: 0; border-radius: 6px; background: transparent; color: #577283; cursor: pointer; }
      .lm-subdialog-body { overflow: auto; padding: 13px; color: #4e5f69; font-size: 11px; }
      .lm-subdialog-body p:first-child { margin-top: 0; }
      .lm-subdialog-actions { display: flex; justify-content: flex-end; gap: 7px; padding: 10px 13px; border-top: 1px solid #d5dfe4; background: #f7f9fa; }
      .lm-dialog-button { border: 1px solid #99adba; border-radius: 7px; background: #fff; color: #41677b; padding: 6px 10px; font-weight: 700; font-size: 10px; cursor: pointer; }
      .lm-dialog-button.is-primary { border-color: #2b7898; background: #2d7d9c; color: #fff; }
      .lm-setting-list { display: grid; gap: 10px; }
      .lm-setting-row { display: flex; justify-content: space-between; align-items: center; gap: 14px; border-bottom: 1px solid #edf0f2; padding-bottom: 9px; }
      .lm-setting-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .lm-setting-copy strong { color: #344b58; }
      .lm-setting-copy small { color: #71808a; font-size: 9px; }
      .lm-setting-row select, .lm-setting-row input[type="text"], .lm-setting-row input[type="number"] { max-width: 150px; border: 1px solid #aebfc9; border-radius: 6px; padding: 5px 7px; background: #fff; color: #26343d; }
      @media (max-width: 620px) {
        #${ID.backdrop} { padding: 0; align-items: stretch; }
        #${ID.panel} { width: 100vw; height: 100vh; border: 0; border-radius: 0; }
        .lm-header { padding-left: 14px; }
        .lm-module-card { align-items: flex-start; }
        .lm-module-actions { flex-direction: column; align-items: flex-end; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
})();
