// ==UserScript==
// @name         Lectio Manager
// @namespace    https://github.com/RktRobinhood/Lectio-Scripts
// @version      2.0.0
// @description  Discover and manage Lectio userscript modules with Stable and Unstable release channels.
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

  const VERSION = '2.0.0';
  const REPO_RAW = 'https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main';
  const STABLE_CATALOGUE_URL = `${REPO_RAW}/catalogue/modules.json`;
  const UNSTABLE_CATALOGUE_URL = `${REPO_RAW}/modules-unstable/modules.json`;
  const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

  const KEY = Object.freeze({
    channel: 'lectioManager.releaseChannel.v1',
    stableCatalogue: 'lectioManager.catalogue.stable.v1',
    stableRefresh: 'lectioManager.catalogue.stable.refreshedAt.v1',
    unstableCatalogue: 'lectioManager.catalogue.unstable.v1',
    unstableRefresh: 'lectioManager.catalogue.unstable.refreshedAt.v1',
    activeTab: 'lectioManager.activeTab.v1'
  });

  const ID = Object.freeze({
    launcher: 'lectio-manager-launcher',
    backdrop: 'lectio-manager-backdrop',
    panel: 'lectio-manager-panel',
    style: 'lectio-manager-style'
  });

  const state = {
    channel: normalizeChannel(GM_getValue(KEY.channel, 'stable')),
    activeTab: normalizeTab(GM_getValue(KEY.activeTab, 'modules')),
    stableCatalogue: readStoredCatalogue(KEY.stableCatalogue),
    unstableCatalogue: readStoredCatalogue(KEY.unstableCatalogue),
    stableRefreshedAt: Number(GM_getValue(KEY.stableRefresh, 0)) || 0,
    unstableRefreshedAt: Number(GM_getValue(KEY.unstableRefresh, 0)) || 0,
    registrations: new Map(),
    panelOpen: false,
    refreshInFlight: false,
    statusMessage: '',
    statusKind: 'info'
  };

  window.addEventListener('lectio-module:register', onModuleRegister);

  installStyles();
  installLauncher();
  requestModuleDiscovery();
  window.setTimeout(requestModuleDiscovery, 400);
  window.setTimeout(requestModuleDiscovery, 1400);

  // Refresh in the background only when needed. Cached data renders instantly.
  void refreshIfNeeded();

  function normalizeChannel(value) {
    return value === 'unstable' ? 'unstable' : 'stable';
  }

  function normalizeTab(value) {
    return value === 'settings' ? 'settings' : 'modules';
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
        ? detail.currentValues
        : {}
    });

    if (state.panelOpen) renderPanelBody();
  }

  function normalizeRegisteredChannel(value) {
    if (value === 'stable' || value === 'unstable') return value;
    return 'unknown';
  }

  function requestModuleDiscovery() {
    window.dispatchEvent(new CustomEvent('lectio-manager:discover', {
      detail: { managerVersion: VERSION, channel: state.channel }
    }));
  }

  async function refreshIfNeeded() {
    const now = Date.now();
    const stableStale = !state.stableCatalogue || now - state.stableRefreshedAt >= REFRESH_INTERVAL_MS;
    const unstableStale = state.channel === 'unstable' &&
      (!state.unstableCatalogue || now - state.unstableRefreshedAt >= REFRESH_INTERVAL_MS);

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

    try {
      if (force || !state.stableCatalogue || Date.now() - state.stableRefreshedAt >= REFRESH_INTERVAL_MS) {
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
          (force || !state.unstableCatalogue || Date.now() - state.unstableRefreshedAt >= REFRESH_INTERVAL_MS)) {
        try {
          const unstable = await fetchCatalogue(UNSTABLE_CATALOGUE_URL, { force });
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

    return {
      ...input,
      schemaVersion: 1,
      modules
    };
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
      aliases: Array.isArray(input.aliases)
        ? input.aliases.map(cleanString).filter(Boolean)
        : [],
      audience: Array.isArray(input.audience)
        ? input.audience.map(cleanString).filter(Boolean)
        : []
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
        return url.pathname.startsWith('/RktRobinhood/Lectio-Scripts/') &&
          url.pathname.includes('/raw/');
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
    button.setAttribute('aria-label', 'Open Lectio Manager');
    button.title = 'Lectio Manager';
    button.innerHTML = '<span aria-hidden="true">⚙</span>';
    button.addEventListener('click', openPanel);

    document.body.appendChild(button);
  }

  function openPanel() {
    state.panelOpen = true;
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
      panel.setAttribute('aria-label', 'Lectio Manager');
      backdrop.appendChild(panel);
    }

    panel.innerHTML = `
      <header class="lm-header">
        <div>
          <div class="lm-title-row">
            <h2>Lectio Manager</h2>
            <span class="lm-channel-badge ${state.channel === 'unstable' ? 'is-unstable' : ''}">
              ${state.channel === 'unstable' ? 'UNSTABLE' : 'STABLE'}
            </span>
          </div>
          <div class="lm-version">Manager v${escapeHtml(VERSION)}</div>
        </div>
        <div class="lm-header-actions">
          <button type="button" class="lm-icon-button" data-action="refresh" title="Refresh module catalogues now" aria-label="Refresh module catalogues">↻</button>
          <button type="button" class="lm-icon-button" data-action="close" title="Close" aria-label="Close Lectio Manager">×</button>
        </div>
      </header>
      <nav class="lm-tabs" aria-label="Lectio Manager sections">
        <button type="button" data-tab="modules" class="${state.activeTab === 'modules' ? 'active' : ''}">Modules</button>
        <button type="button" data-tab="settings" class="${state.activeTab === 'settings' ? 'active' : ''}">Settings</button>
      </nav>
      <div id="lectio-manager-panel-body" class="lm-body"></div>
    `;

    panel.querySelector('[data-action="close"]').addEventListener('click', closePanel);
    panel.querySelector('[data-action="refresh"]').addEventListener('click', () => {
      void refreshCatalogues({ force: true });
    });

    for (const tab of panel.querySelectorAll('[data-tab]')) {
      tab.addEventListener('click', () => {
        state.activeTab = normalizeTab(tab.dataset.tab);
        GM_setValue(KEY.activeTab, state.activeTab);
        renderPanel();
      });
    }

    renderPanelBody();
  }

  function renderPanelBody() {
    if (!state.panelOpen) return;
    const body = document.getElementById('lectio-manager-panel-body');
    if (!body) return;

    body.innerHTML = '';

    if (state.channel === 'unstable') {
      body.appendChild(makeWarning(
        'UNSTABLE CHANNEL',
        'Experimental modules may contain bugs, incomplete features, or breaking changes. Nothing is installed automatically. You can switch back to Stable at any time.'
      ));
    }

    if (state.statusMessage) {
      const status = document.createElement('div');
      status.className = `lm-status is-${state.statusKind}`;
      status.textContent = state.statusMessage;
      body.appendChild(status);
    }

    if (state.activeTab === 'settings') {
      renderSettings(body);
    } else {
      renderModules(body);
    }
  }

  function renderSettings(body) {
    const section = document.createElement('section');
    section.className = 'lm-settings-section';
    section.innerHTML = `
      <div class="lm-section-heading">
        <div>
          <h3>Release channel</h3>
          <p>Choose which versions the Manager offers. Changing this setting never installs, upgrades, or downgrades a userscript by itself.</p>
        </div>
      </div>
      <div class="lm-channel-options">
        <label class="lm-channel-option ${state.channel === 'stable' ? 'selected' : ''}">
          <input type="radio" name="lm-channel" value="stable" ${state.channel === 'stable' ? 'checked' : ''}>
          <span class="lm-channel-copy">
            <strong>Stable <span class="lm-help" title="Recommended. Uses production-tested module versions. Experimental versions are ignored. If a newer test build is installed, the Manager can offer a Downgrade button back to Stable.">?</span></strong>
            <small>Recommended for normal use. Production-tested module versions.</small>
          </span>
        </label>
        <label class="lm-channel-option is-danger ${state.channel === 'unstable' ? 'selected' : ''}">
          <input type="radio" name="lm-channel" value="unstable" ${state.channel === 'unstable' ? 'checked' : ''}>
          <span class="lm-channel-copy">
            <strong>Unstable <span class="lm-help" title="Experimental. Shows modules and versions still being tested. They may break. Switching channels alone changes no installed code; each Install, Upgrade, or Downgrade still requires your explicit click and Tampermonkey confirmation.">?</span></strong>
            <small>Experimental versions for testing. Bugs and regressions are possible.</small>
          </span>
        </label>
      </div>
      <div class="lm-explainer">
        <strong>Important:</strong> the channel is a catalogue preference, not an automatic deployment switch. The Manager only changes installed code when you explicitly click an action such as <em>Upgrade</em> or <em>Downgrade</em> and then confirm it in Tampermonkey.
      </div>
      <div class="lm-refresh-info">
        <div><strong>Stable catalogue:</strong> ${formatRefresh(state.stableRefreshedAt)}</div>
        <div><strong>Unstable overlay:</strong> ${formatRefresh(state.unstableRefreshedAt)}</div>
      </div>
    `;

    for (const input of section.querySelectorAll('input[name="lm-channel"]')) {
      input.addEventListener('change', () => {
        void setChannel(input.value);
      });
    }

    body.appendChild(section);
  }

  async function setChannel(nextValue) {
    const next = normalizeChannel(nextValue);
    if (next === state.channel) return;

    if (next === 'unstable') {
      const accepted = window.confirm(
        'Switch Lectio Manager to the UNSTABLE channel?\n\n' +
        'Unstable modules are experimental and may contain bugs or breaking changes. ' +
        'Changing the channel does NOT install anything automatically.'
      );
      if (!accepted) {
        renderPanel();
        return;
      }
    }

    state.channel = next;
    GM_setValue(KEY.channel, state.channel);
    state.statusMessage = next === 'unstable'
      ? 'Unstable channel selected. No modules have been changed.'
      : 'Stable channel selected. Installed test versions have not been changed; use Downgrade where offered.';
    state.statusKind = 'success';

    requestModuleDiscovery();
    renderPanel();

    if (next === 'unstable' && !state.unstableCatalogue) {
      await refreshCatalogues({ force: true });
    }
  }

  function renderModules(body) {
    if (!state.stableCatalogue) {
      const empty = document.createElement('div');
      empty.className = 'lm-empty';
      empty.innerHTML = '<strong>Loading module catalogue...</strong><span>The Manager will keep the last valid catalogue when GitHub is temporarily unavailable.</span>';
      body.appendChild(empty);
      return;
    }

    const modules = buildEffectiveModules();

    if (!modules.length) {
      const empty = document.createElement('div');
      empty.className = 'lm-empty';
      empty.textContent = 'No modules are listed in this catalogue.';
      body.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'lm-module-list';

    for (const module of modules) {
      list.appendChild(renderModuleCard(module));
    }

    body.appendChild(list);

    const unmatched = getUnmatchedRegistrations(modules);
    if (unmatched.length) {
      const heading = document.createElement('h3');
      heading.className = 'lm-subheading';
      heading.textContent = 'Other detected modules';
      body.appendChild(heading);

      const note = document.createElement('div');
      note.className = 'lm-status is-info';
      note.textContent = state.channel === 'stable'
        ? 'These running modules are not in the selected Stable catalogue. An unstable-only test module can appear here after you switch back to Stable.'
        : 'These running modules did not match a catalogue entry.';
      body.appendChild(note);

      for (const registration of unmatched) {
        const card = document.createElement('article');
        card.className = 'lm-module-card is-outside';
        card.innerHTML = `
          <div class="lm-module-main">
            <div class="lm-module-title-row">
              <h3>${escapeHtml(registration.name)}</h3>
              <span class="lm-tag">detected</span>
            </div>
            <p>Running version ${escapeHtml(registration.version)} is outside the selected ${escapeHtml(capitalize(state.channel))} catalogue.</p>
            <div class="lm-version-line">Installed: <strong>${escapeHtml(registration.version)}</strong></div>
          </div>
        `;
        body.appendChild(card);
      }
    }

    const footer = document.createElement('div');
    footer.className = 'lm-footer-note';
    footer.innerHTML = `Last stable refresh: <strong>${escapeHtml(formatRefresh(state.stableRefreshedAt))}</strong>` +
      (state.channel === 'unstable'
        ? ` · Unstable overlay: <strong>${escapeHtml(formatRefresh(state.unstableRefreshedAt))}</strong>`
        : '');
    body.appendChild(footer);
  }

  function buildEffectiveModules() {
    const stable = state.stableCatalogue?.modules || [];
    const byId = new Map(stable.map(module => [module.id, {
      ...module,
      selectedChannel: 'stable',
      stableModule: module
    }]));

    if (state.channel !== 'unstable') {
      return sortModules([...byId.values()]);
    }

    const overlay = state.unstableCatalogue?.modules || [];

    for (const experimental of overlay) {
      const stableMatch = findStableMatch(stable, experimental);
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

    return sortModules([...byId.values()]);
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

  function sortModules(modules) {
    return modules.sort((a, b) => {
      const category = String(a.category || '').localeCompare(String(b.category || ''));
      if (category) return category;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  function renderModuleCard(module) {
    const registration = findRegistrationForModule(module);
    const action = determineAction(module, registration);

    const card = document.createElement('article');
    card.className = `lm-module-card ${module.selectedChannel === 'unstable' ? 'is-unstable' : ''}`;

    const statusLabel = module.selectedChannel === 'unstable'
      ? '<span class="lm-tag is-unstable">experimental</span>'
      : '<span class="lm-tag">stable</span>';

    card.innerHTML = `
      <div class="lm-module-main">
        <div class="lm-module-title-row">
          <h3>${escapeHtml(module.name)}</h3>
          ${statusLabel}
        </div>
        <p>${escapeHtml(module.description || '')}</p>
        <div class="lm-version-line">
          Target: <strong>${escapeHtml(module.version)}</strong>
          ${registration ? ` · Installed: <strong>${escapeHtml(registration.version)}</strong>` : ' · Installed: <strong>Not detected</strong>'}
        </div>
        ${module.selectedChannel === 'unstable' && module.stableModule
          ? `<div class="lm-stable-reference">Stable target: ${escapeHtml(module.stableModule.version)}</div>`
          : ''}
      </div>
      <div class="lm-module-action"></div>
    `;

    const actionHost = card.querySelector('.lm-module-action');
    if (action.kind === 'current') {
      const badge = document.createElement('span');
      badge.className = 'lm-current';
      badge.textContent = 'Up to date';
      badge.title = `Installed version ${registration.version} matches the selected ${state.channel} target.`;
      actionHost.appendChild(badge);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `lm-action-button ${action.kind === 'downgrade' ? 'is-downgrade' : ''}`;
      button.textContent = action.label;
      button.title = action.tooltip;
      button.addEventListener('click', () => openInstall(module, action));
      actionHost.appendChild(button);
    }

    return card;
  }

  function findRegistrationForModule(module) {
    const ids = new Set([module.id, ...(module.aliases || [])]);

    if (module.stableModule) {
      ids.add(module.stableModule.id);
      for (const alias of module.stableModule.aliases || []) ids.add(alias);
    }
    if (module.unstableModule) {
      ids.add(module.unstableModule.id);
      for (const alias of module.unstableModule.aliases || []) ids.add(alias);
    }

    for (const registration of state.registrations.values()) {
      const registrationIds = new Set([registration.id, ...(registration.aliases || [])]);
      for (const id of ids) {
        if (registrationIds.has(id)) return registration;
      }
    }

    return null;
  }

  function determineAction(module, registration) {
    if (!registration) {
      return {
        kind: 'install',
        label: module.selectedChannel === 'unstable' ? 'Install test version' : 'Install',
        tooltip: `Open ${module.version} in Tampermonkey. Nothing is installed until you confirm there.`
      };
    }

    const comparison = compareVersions(registration.version, module.version);
    if (comparison === null) {
      return {
        kind: 'reinstall',
        label: 'Reinstall selected version',
        tooltip: `The Manager cannot safely compare ${registration.version} with ${module.version}. Open the selected version in Tampermonkey.`
      };
    }

    if (comparison < 0) {
      return {
        kind: 'upgrade',
        label: `Upgrade to ${module.version}`,
        tooltip: `Installed ${registration.version} is older than the selected ${state.channel} target ${module.version}. Tampermonkey will ask you to confirm.`
      };
    }

    if (comparison > 0) {
      return {
        kind: 'downgrade',
        label: `Downgrade to ${module.version}`,
        tooltip: `Installed ${registration.version} is newer than the selected ${state.channel} target ${module.version}. This explicitly opens the older selected version in Tampermonkey; nothing happens automatically.`
      };
    }

    return { kind: 'current', label: 'Up to date', tooltip: '' };
  }

  function openInstall(module, action) {
    if (!isApprovedInstallUrl(module.installUrl)) {
      state.statusMessage = `Blocked unapproved install URL for ${module.name}.`;
      state.statusKind = 'error';
      renderPanelBody();
      return;
    }

    const verb = action.kind === 'downgrade' ? 'downgrade' :
      action.kind === 'upgrade' ? 'upgrade' :
      action.kind === 'reinstall' ? 'reinstall' : 'install';

    state.statusMessage = `Opening ${module.name} ${module.version} to ${verb} through Tampermonkey. The Manager does not install code silently.`;
    state.statusKind = 'info';
    renderPanelBody();

    const opened = window.open(module.installUrl, '_blank', 'noopener,noreferrer');
    if (!opened) {
      // Fallback for browsers that block the new tab despite a direct user click.
      window.location.href = module.installUrl;
    }
  }

  function getUnmatchedRegistrations(modules) {
    return [...state.registrations.values()].filter(registration => {
      return !modules.some(module => {
        const ids = new Set([module.id, ...(module.aliases || [])]);
        if (module.stableModule) {
          ids.add(module.stableModule.id);
          for (const alias of module.stableModule.aliases || []) ids.add(alias);
        }
        if (module.unstableModule) {
          ids.add(module.unstableModule.id);
          for (const alias of module.unstableModule.aliases || []) ids.add(alias);
        }
        return ids.has(registration.id) || (registration.aliases || []).some(alias => ids.has(alias));
      });
    });
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
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return 'unknown';
    }
  }

  function makeWarning(title, text) {
    const box = document.createElement('div');
    box.className = 'lm-warning';
    box.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span>`;
    return box;
  }

  function uniqueStrings(values) {
    return [...new Set(values.map(cleanString).filter(Boolean))];
  }

  function capitalize(value) {
    const text = String(value || '');
    return text ? text[0].toUpperCase() + text.slice(1) : text;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function installStyles() {
    if (document.getElementById(ID.style)) return;

    const style = document.createElement('style');
    style.id = ID.style;
    style.textContent = `
      #${ID.launcher} {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 2147482500;
        width: 34px;
        height: 34px;
        border: 1px solid rgba(32, 64, 92, .35);
        border-radius: 50%;
        background: #f5f8fb;
        color: #315f86;
        font: 700 18px/32px Arial, Helvetica, sans-serif;
        box-shadow: 0 2px 10px rgba(0, 0, 0, .16);
        cursor: pointer;
      }
      #${ID.launcher}:hover,
      #${ID.launcher}:focus-visible {
        background: #e8f1f8;
        outline: 2px solid rgba(49, 95, 134, .2);
      }
      #${ID.backdrop} {
        position: fixed;
        inset: 0;
        z-index: 2147482800;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        padding: 18px;
        box-sizing: border-box;
        background: rgba(20, 30, 40, .34);
      }
      #${ID.backdrop}[hidden] { display: none !important; }
      #${ID.panel} {
        width: min(560px, calc(100vw - 36px));
        max-height: calc(100vh - 36px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border: 1px solid #bcc8d2;
        border-radius: 12px;
        background: #f9fbfc;
        color: #17222c;
        box-shadow: 0 18px 60px rgba(0, 0, 0, .28);
        font: 13px/1.4 Arial, Helvetica, sans-serif;
      }
      .lm-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px 11px;
        border-bottom: 1px solid #d9e0e6;
        background: #fff;
      }
      .lm-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .lm-header h2 {
        margin: 0;
        font-size: 18px;
        color: #1f3f59;
      }
      .lm-version {
        margin-top: 2px;
        color: #687783;
        font-size: 11px;
      }
      .lm-channel-badge,
      .lm-tag {
        display: inline-flex;
        align-items: center;
        border: 1px solid #b6c8d6;
        border-radius: 999px;
        padding: 2px 7px;
        background: #edf4f8;
        color: #315f86;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: .04em;
        text-transform: uppercase;
      }
      .lm-channel-badge.is-unstable,
      .lm-tag.is-unstable {
        border-color: #c77a12;
        background: #fff3d9;
        color: #7f4700;
      }
      .lm-header-actions {
        display: flex;
        gap: 7px;
      }
      .lm-icon-button {
        width: 32px;
        height: 32px;
        border: 1px solid #c7d1d9;
        border-radius: 7px;
        background: #fff;
        color: #365c78;
        font: 700 18px/28px Arial, Helvetica, sans-serif;
        cursor: pointer;
      }
      .lm-tabs {
        display: flex;
        gap: 4px;
        padding: 8px 12px 0;
        background: #f2f6f8;
        border-bottom: 1px solid #d9e0e6;
      }
      .lm-tabs button {
        border: 0;
        border-bottom: 3px solid transparent;
        background: transparent;
        padding: 8px 12px 7px;
        color: #5b6975;
        font-weight: 700;
        cursor: pointer;
      }
      .lm-tabs button.active {
        color: #214f72;
        border-bottom-color: #356f98;
      }
      .lm-body {
        overflow: auto;
        padding: 14px;
      }
      .lm-warning {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        margin-bottom: 12px;
        border: 1px solid #e1a544;
        border-radius: 8px;
        background: #fff5df;
        padding: 10px 12px;
        color: #684000;
      }
      .lm-warning strong {
        flex: 0 0 auto;
        font-size: 10px;
        letter-spacing: .05em;
      }
      .lm-warning span { font-size: 12px; }
      .lm-status {
        margin-bottom: 10px;
        border-radius: 7px;
        padding: 8px 10px;
        background: #edf4f8;
        color: #31566f;
        font-size: 11px;
      }
      .lm-status.is-error { background: #fff0ed; color: #8a2d1d; }
      .lm-status.is-success { background: #eaf6ee; color: #26613c; }
      .lm-module-list {
        display: grid;
        gap: 10px;
      }
      .lm-module-card {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid #d3dce3;
        border-radius: 9px;
        background: #fff;
        padding: 12px;
      }
      .lm-module-card.is-unstable {
        border-color: #ddad65;
        background: #fffdfa;
      }
      .lm-module-card.is-outside {
        margin-top: 8px;
        border-style: dashed;
      }
      .lm-module-main { min-width: 0; }
      .lm-module-title-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 7px;
      }
      .lm-module-card h3,
      .lm-settings-section h3,
      .lm-subheading {
        margin: 0;
        color: #244760;
        font-size: 14px;
      }
      .lm-module-card p {
        margin: 5px 0 6px;
        color: #52616d;
        font-size: 12px;
      }
      .lm-version-line,
      .lm-stable-reference {
        color: #6b7781;
        font-size: 11px;
      }
      .lm-stable-reference { margin-top: 2px; }
      .lm-module-action {
        flex: 0 0 auto;
        align-self: center;
      }
      .lm-action-button {
        max-width: 180px;
        border: 1px solid #3977a2;
        border-radius: 7px;
        background: #3d7fab;
        color: #fff;
        padding: 7px 10px;
        font-weight: 700;
        font-size: 11px;
        cursor: pointer;
      }
      .lm-action-button.is-downgrade {
        border-color: #9b6519;
        background: #fff4dc;
        color: #704300;
      }
      .lm-current {
        display: inline-block;
        border-radius: 999px;
        background: #eaf6ee;
        color: #27613c;
        padding: 5px 9px;
        font-size: 10px;
        font-weight: 800;
      }
      .lm-settings-section {
        border: 1px solid #d3dce3;
        border-radius: 9px;
        background: #fff;
        padding: 13px;
      }
      .lm-section-heading p {
        margin: 5px 0 12px;
        color: #5f6e79;
        font-size: 12px;
      }
      .lm-channel-options {
        display: grid;
        gap: 8px;
      }
      .lm-channel-option {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        border: 1px solid #ccd7df;
        border-radius: 8px;
        padding: 10px;
        cursor: pointer;
      }
      .lm-channel-option.selected {
        border-color: #4680a8;
        box-shadow: inset 0 0 0 1px #4680a8;
        background: #f3f8fb;
      }
      .lm-channel-option.is-danger.selected {
        border-color: #cc8428;
        box-shadow: inset 0 0 0 1px #cc8428;
        background: #fff9ee;
      }
      .lm-channel-copy {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .lm-channel-copy strong { color: #244760; }
      .lm-channel-copy small { color: #63717b; }
      .lm-help {
        display: inline-flex;
        width: 15px;
        height: 15px;
        align-items: center;
        justify-content: center;
        border: 1px solid #9fb0bd;
        border-radius: 50%;
        color: #4a687d;
        font-size: 10px;
        cursor: help;
      }
      .lm-explainer {
        margin-top: 12px;
        border-left: 3px solid #7497ae;
        padding: 8px 10px;
        background: #f5f8fa;
        color: #53616b;
        font-size: 11px;
      }
      .lm-refresh-info {
        display: grid;
        gap: 3px;
        margin-top: 12px;
        color: #6b7781;
        font-size: 11px;
      }
      .lm-empty {
        display: flex;
        flex-direction: column;
        gap: 4px;
        border: 1px dashed #c9d3db;
        border-radius: 8px;
        padding: 18px;
        text-align: center;
        color: #63717b;
      }
      .lm-subheading { margin-top: 16px; }
      .lm-footer-note {
        margin-top: 13px;
        color: #77838d;
        font-size: 10px;
        text-align: right;
      }
      @media (max-width: 620px) {
        #${ID.backdrop} {
          align-items: stretch;
          padding: 0;
        }
        #${ID.panel} {
          width: 100vw;
          max-height: 100vh;
          border: 0;
          border-radius: 0;
        }
        .lm-module-card {
          flex-direction: column;
        }
        .lm-module-action {
          align-self: stretch;
        }
        .lm-action-button { width: 100%; max-width: none; }
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }
})();
