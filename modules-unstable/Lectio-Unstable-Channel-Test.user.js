// ==UserScript==
// @name         Lectio Unstable Channel Test
// @namespace    https://github.com/RktRobinhood/Lectio-Scripts
// @version      0.2.0
// @description  Harmless diagnostic module for testing the Lectio Manager unstable release channel.
// @author       RktRobinhood
// @match        https://www.lectio.dk/lectio/*
// @grant        none
// @homepageURL  https://github.com/RktRobinhood/Lectio-Scripts
// @supportURL   https://github.com/RktRobinhood/Lectio-Scripts/issues
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Unstable-Channel-Test.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Unstable-Channel-Test.user.js
// ==/UserScript==

(() => {
  'use strict';

  const MODULE = Object.freeze({
    id: 'unstable-channel-test',
    name: 'Unstable Channel Test',
    version: '0.2.0',
    channel: 'unstable'
  });

  function registerWithManager() {
    const detail = {
      id: MODULE.id,
      name: MODULE.name,
      version: MODULE.version,
      channel: MODULE.channel,
      settingsSchema: [],
      currentValues: {}
    };

    window.dispatchEvent(new CustomEvent('lectio-module:register', { detail }));
  }

  function registerDockItem() {
    window.dispatchEvent(new CustomEvent('lectio-manager:dock:register', {
      detail: {
        moduleId: MODULE.id,
        itemId: 'diagnostic',
        type: 'panel',
        icon: 'wrench',
        label: 'Unstable channel diagnostic',
        tooltip: 'Open the unstable channel diagnostic',
        state: 'warning',
        defaultPriority: 900
      }
    }));
  }

  function renderDockPanel(event) {
    const { moduleId, itemId, mount } = event.detail || {};
    if (moduleId !== MODULE.id || itemId !== 'diagnostic' || !mount) return;

    const heading = document.createElement('strong');
    heading.textContent = 'Unstable channel is running';

    const body = document.createElement('p');
    body.textContent = `This harmless test module is using Lectio Manager's shared dock. Version ${MODULE.version}; channel ${MODULE.channel}.`;

    const note = document.createElement('p');
    note.textContent = 'If this panel opened beside the dock, the registration, activation, and Manager-owned flyout plumbing are working.';

    mount.append(heading, body, note);
  }

  function announce() {
    registerWithManager();
    registerDockItem();
  }

  window.addEventListener('lectio-manager:discover', announce);
  window.addEventListener('lectio-manager:dock:render-panel', renderDockPanel);
  window.addEventListener('pagehide', () => {
    window.dispatchEvent(new CustomEvent('lectio-manager:dock:remove', {
      detail: { moduleId: MODULE.id, itemId: 'diagnostic' }
    }));
  }, { once: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announce, { once: true });
  } else {
    announce();
  }

  // A second registration shortly after startup makes detection resilient when
  // the Manager and module initialize in an unexpected order.
  window.setTimeout(announce, 500);
})();
