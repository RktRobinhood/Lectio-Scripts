// ==UserScript==
// @name         Lectio Unstable Channel Test
// @namespace    https://github.com/RktRobinhood/Lectio-Scripts
// @version      0.1.1-beta.1
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
    version: '0.1.1-beta.1',
    channel: 'unstable'
  });

  const CHIP_ID = 'lectio-unstable-channel-test-chip';
  const PANEL_ID = 'lectio-unstable-channel-test-panel';
  const STYLE_ID = 'lectio-unstable-channel-test-style';

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

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CHIP_ID} {
        position: fixed;
        right: 14px;
        bottom: 58px;
        z-index: 2147483000;
        border: 1px solid #b66a00;
        border-radius: 999px;
        background: #fff7e8;
        color: #6e3d00;
        padding: 6px 10px;
        font: 600 11px/1.2 Arial, Helvetica, sans-serif;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
        cursor: pointer;
        user-select: none;
      }

      #${CHIP_ID}:hover,
      #${CHIP_ID}:focus-visible {
        background: #ffedc7;
        outline: none;
      }

      #${PANEL_ID} {
        position: fixed;
        right: 14px;
        bottom: 98px;
        z-index: 2147483000;
        width: min(330px, calc(100vw - 28px));
        box-sizing: border-box;
        border: 1px solid #b66a00;
        border-radius: 8px;
        background: #fffdf8;
        color: #2b2b2b;
        padding: 12px 14px;
        font: 12px/1.45 Arial, Helvetica, sans-serif;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.20);
      }

      #${PANEL_ID} strong {
        display: block;
        margin-bottom: 5px;
        color: #6e3d00;
        font-size: 13px;
      }

      #${PANEL_ID} code {
        font-size: 11px;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function togglePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      existing.remove();
      return;
    }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'status');
    panel.innerHTML = `
      <strong>Unstable channel is running</strong>
      This is a harmless test module.<br>
      Version: <code>${MODULE.version}</code><br>
      Channel: <code>${MODULE.channel}</code><br><br>
      If the Lectio Manager can detect this module and later remove or replace it through the normal install flow, the channel plumbing is working.
    `;

    document.body.appendChild(panel);
  }

  function installChip() {
    if (!document.body || document.getElementById(CHIP_ID)) return;

    installStyles();

    const chip = document.createElement('button');
    chip.id = CHIP_ID;
    chip.type = 'button';
    chip.textContent = 'UNSTABLE TEST';
    chip.title = 'Diagnostic module from the Lectio Manager unstable channel. Click for details.';
    chip.addEventListener('click', togglePanel);

    document.body.appendChild(chip);
  }

  window.addEventListener('lectio-manager:discover', registerWithManager);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      installChip();
      registerWithManager();
    }, { once: true });
  } else {
    installChip();
    registerWithManager();
  }

  // A second registration shortly after startup makes detection resilient when
  // the Manager and module initialize in an unexpected order.
  window.setTimeout(registerWithManager, 500);
})();
