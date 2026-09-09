// ==UserScript==
// @name         Lectio - Unread Message Notifications
// @namespace    https://www.lectio.dk/
// @version      0.3.1
// @description  Shows unread Lectio messages beside the main Beskeder / Messages navigation link and plays a soft chime when the unread count increases.
// @match        https://www.lectio.dk/lectio/*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  /*
   * Universal Lectio message notifier.
   *
   * - Detects the active school automatically.
   * - Adds ONE badge only: to the highest visible inbox link in the page header.
   * - Checks once per page load and every 10 minutes while the page stays visible.
   * - Plays a locally generated chime only when the unread count increases.
   * - Uses no MutationObserver.
   */

  const SCHOOL_ID = getSchoolId();
  if (!SCHOOL_ID) return;

  const CHECK_INTERVAL = 10 * 60 * 1000;
  const INITIAL_CHECK_DELAY = 1200;
  const MAX_PREVIEW_ITEMS = 6;

  const CACHE_KEY = `lectioUnreadMessages.v3.${SCHOOL_ID}`;
  const HOST_CLASS = 'lectio-msg-host';
  const BADGE_CLASS = 'lectio-msg-notification';
  const TOOLTIP_CLASS = 'lectio-msg-tooltip';

  let messages = [];
  let checkedAt = 0;
  let checking = false;

  let audioContext = null;
  let audioReady = false;

  start();

  function start() {
    cleanupOldCaches();
    injectStyles();
    loadCachedState();

    attachBadge();
    renderAll(false);

    // Bounded retries instead of observing the entire DOM.
    window.setTimeout(() => {
      attachBadge();
      renderAll(false);
    }, 500);

    window.setTimeout(() => {
      attachBadge();
      renderAll(false);
    }, 2500);

    installAudioUnlock();

    // One check after every Lectio page load.
    window.setTimeout(checkMessages, INITIAL_CHECK_DELAY);

    // If the user remains on a page, check only once every 10 minutes.
    window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkMessages();
      }
    }, CHECK_INTERVAL);

    // Returning to a tab only causes a request if the last check is stale.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;

      attachBadge();
      renderAll(false);

      if (Date.now() - checkedAt >= CHECK_INTERVAL) {
        checkMessages();
      }
    });

    // Share state between open tabs for the same school.
    window.addEventListener('storage', (event) => {
      if (event.key !== CACHE_KEY || !event.newValue) return;

      try {
        const incoming = JSON.parse(event.newValue);
        if (!isValidState(incoming)) return;

        messages = incoming.messages;
        checkedAt = incoming.checkedAt;

        attachBadge();
        renderAll(false);
      } catch (_) {
        // Ignore malformed cache data.
      }
    });
  }

  // ============================================================
  // SCHOOL / URL HELPERS
  // ============================================================

  function getSchoolId() {
    const match = location.pathname.match(/^\/lectio\/(\d+)\//);
    return match ? match[1] : null;
  }

  function getInboxCandidates() {
    const expectedPath =
      `/lectio/${SCHOOL_ID}/beskeder2.aspx`.toLowerCase();

    return Array.from(
      document.querySelectorAll('a[href]')
    )
      .map((link) => {
        try {
          return {
            link,
            url: new URL(
              link.getAttribute('href'),
              location.href
            )
          };
        } catch (_) {
          return null;
        }
      })
      .filter((item) =>
        item &&
        item.url.origin === location.origin &&
        item.url.pathname.toLowerCase() === expectedPath
      );
  }

  function isVisibleLink(link) {
    const style =
      window.getComputedStyle(link);

    const rect =
      link.getBoundingClientRect();

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function getNavigationMessageLink() {
    const candidates =
      getInboxCandidates();

    if (!candidates.length) {
      return null;
    }

    /*
     * Individual message subjects normally have query parameters.
     *
     * The top navigation link and the dashboard Messages heading
     * both point to the plain inbox.
     *
     * We therefore:
     *
     * 1. Prefer links without query parameters.
     * 2. Choose the highest visible one on the page.
     *
     * The persistent Lectio navigation is above the dashboard card.
     */

    const plainInboxLinks =
      candidates.filter(
        (item) =>
          !item.url.search &&
          !item.url.hash
      );

    const pool =
      plainInboxLinks.length
        ? plainInboxLinks
        : candidates;

    const visible =
      pool.filter(
        (item) =>
          isVisibleLink(item.link)
      );

    const ranked =
      visible.length
        ? visible
        : pool;

    ranked.sort(
      (a, b) => {
        const aRect =
          a.link.getBoundingClientRect();

        const bRect =
          b.link.getBoundingClientRect();

        if (
          aRect.top !==
          bRect.top
        ) {
          return (
            aRect.top -
            bRect.top
          );
        }

        return (
          aRect.left -
          bRect.left
        );
      }
    );

    return (
      ranked[0]?.link ||
      null
    );
  }

  function getInboxUrl() {
    const navigationLink =
      getNavigationMessageLink();

    if (navigationLink) {
      try {
        const url =
          new URL(
            navigationLink.getAttribute('href'),
            location.href
          );

        url.search = '';
        url.hash = '';

        return url.href;
      } catch (_) {
        // Fall through.
      }
    }

    return (
      `${location.origin}` +
      `/lectio/${SCHOOL_ID}/beskeder2.aspx`
    );
  }

  // ============================================================
  // CHECK LECTIO
  // ============================================================

  async function checkMessages() {
    if (checking) return;

    checking = true;

    try {
      const response =
        await fetch(
          getInboxUrl(),
          {
            method: 'GET',

            credentials:
              'include',

            cache:
              'no-store',

            headers: {
              Accept:
                'text/html,application/xhtml+xml'
            }
          }
        );

      if (!response.ok) {
        throw new Error(
          `Lectio returned HTTP ${response.status}`
        );
      }

      const finalUrl =
        new URL(
          response.url,
          location.origin
        );

      if (
        !/\/beskeder2\.aspx$/i.test(
          finalUrl.pathname
        )
      ) {
        throw new Error(
          'Lectio did not return the message inbox.'
        );
      }

      const html =
        await response.text();

      const inboxDocument =
        new DOMParser()
          .parseFromString(
            html,
            'text/html'
          );

      const parsed =
        parseUnreadMessages(
          inboxDocument
        );

      /*
       * Preserve the previous known-good count if Lectio's
       * markup ever changes.
       */

      if (parsed === null) {
        console.warn(
          '[Lectio Messages] Inbox layout was not recognised.'
        );

        return;
      }

      const previous =
        readCachedState();

      const hasBaseline =
        previous !== null;

      const previousCount =
        previous
          ? previous.messages.length
          : 0;

      const increased =
        hasBaseline &&
        parsed.length >
          previousCount;

      messages = parsed;
      checkedAt = Date.now();

      saveCachedState();

      attachBadge();
      renderAll(increased);

      if (increased) {
        playLectioChime();
      }
    } catch (error) {
      console.warn(
        '[Lectio Messages] Could not check unread messages:',
        error
      );
    } finally {
      checking = false;
    }
  }

  // ============================================================
  // PARSE MESSAGE LIST
  // ============================================================

  function parseUnreadMessages(doc) {
    const rows =
      Array.from(
        doc.querySelectorAll('tr')
      )
        .filter(
          (row) =>
            row.querySelector(
              '.message-list-thread-container'
            )
        );

    const messageInterfaceExists =
      Boolean(
        doc.querySelector(
          [
            '.message-folder-header',
            '.message-thread-container',
            '.message-list-thread-container',
            '[id*="threadGV"]'
          ].join(',')
        )
      );

    if (
      rows.length === 0 &&
      !messageInterfaceExists
    ) {
      return null;
    }

    const unreadRows =
      rows.filter(
        (row) =>
          row.classList.contains(
            'unread'
          )
      );

    return unreadRows.map(
      (row) => {
        const container =
          row.querySelector(
            '.message-list-thread-container'
          ) ||
          row;

        const sender =
          clean(
            container.querySelector(
              '.message-list-thread-from'
            )?.textContent ||

            row.querySelector(
              '[class*="thread-from"], [class*="sender"]'
            )?.textContent
          );

        const subject =
          clean(
            container.querySelector(
              '.message-list-thread-subject'
            )?.textContent ||

            row.querySelector(
              '[class*="thread-subject"], [class*="subject"]'
            )?.textContent
          );

        const date =
          clean(
            container.querySelector(
              '.message-list-thread-datetime'
            )?.textContent ||

            row.querySelector(
              '[class*="datetime"], [class*="date"]'
            )?.textContent
          );

        return {
          sender,
          subject,
          date
        };
      }
    );
  }

  // ============================================================
  // BADGE
  // ============================================================

  function attachBadge() {
    const target =
      getNavigationMessageLink();

    /*
     * Remove any stray badges left by the old v0.3.0 behaviour.
     */

    document
      .querySelectorAll(
        `.${BADGE_CLASS}`
      )
      .forEach(
        (badge) => {
          if (
            !target ||
            badge.parentElement !== target
          ) {
            badge.remove();
          }
        }
      );

    document
      .querySelectorAll(
        `.${HOST_CLASS}`
      )
      .forEach(
        (host) => {
          if (host !== target) {
            host.classList.remove(
              HOST_CLASS
            );
          }
        }
      );

    if (!target) return;

    target.classList.add(
      HOST_CLASS
    );

    if (
      target.querySelector(
        `:scope > .${BADGE_CLASS}`
      )
    ) {
      return;
    }

    const badge =
      document.createElement(
        'span'
      );

    badge.className =
      BADGE_CLASS;

    badge.setAttribute(
      'aria-hidden',
      'true'
    );

    const count =
      document.createElement(
        'span'
      );

    count.className =
      'lectio-msg-count';

    badge.appendChild(
      count
    );

    const tooltip =
      document.createElement(
        'span'
      );

    tooltip.className =
      TOOLTIP_CLASS;

    badge.appendChild(
      tooltip
    );

    target.appendChild(
      badge
    );
  }

  // ============================================================
  // RENDER
  // ============================================================

  function renderAll(animate) {
    const badge =
      document.querySelector(
        `.${BADGE_CLASS}`
      );

    if (badge) {
      renderBadge(
        badge,
        animate
      );
    }
  }

  function renderBadge(
    badge,
    animate
  ) {
    const count =
      messages.length;

    if (count === 0) {
      badge.hidden = true;

      badge.classList.remove(
        'is-new'
      );

      badge.setAttribute(
        'aria-hidden',
        'true'
      );

      return;
    }

    badge.hidden = false;

    badge.setAttribute(
      'aria-hidden',
      'false'
    );

    const countElement =
      badge.querySelector(
        '.lectio-msg-count'
      );

    if (countElement) {
      countElement.textContent =
        count > 99
          ? '99+'
          : String(count);
    }

    const language =
      detectUiLanguage();

    const labels =
      language === 'en'
        ? {
            header:
              `${count} unread ${
                count === 1
                  ? 'message'
                  : 'messages'
              }`,

            unknown:
              'Unknown sender',

            noSubject:
              'No subject',

            more:
              (number) =>
                `+${number} more`,

            checked:
              'Checked'
          }
        : {
            header:
              `${count} ${
                count === 1
                  ? 'ulæst besked'
                  : 'ulæste beskeder'
              }`,

            unknown:
              'Ukendt afsender',

            noSubject:
              'Intet emne',

            more:
              (number) =>
                `+${number} mere`,

            checked:
              'Tjekket'
          };

    badge.setAttribute(
      'aria-label',
      labels.header
    );

    const tooltip =
      badge.querySelector(
        `.${TOOLTIP_CLASS}`
      );

    if (tooltip) {
      renderTooltip(
        tooltip,
        labels
      );
    }

    if (animate) {
      badge.classList.remove(
        'is-new'
      );

      void badge.offsetWidth;

      badge.classList.add(
        'is-new'
      );
    }
  }

  // ============================================================
  // TOOLTIP
  // ============================================================

  function renderTooltip(
    tooltip,
    labels
  ) {
    tooltip.replaceChildren();

    const header =
      document.createElement(
        'span'
      );

    header.className =
      'lectio-msg-tooltip-header';

    header.textContent =
      labels.header;

    tooltip.appendChild(
      header
    );

    for (
      const message of
      messages.slice(
        0,
        MAX_PREVIEW_ITEMS
      )
    ) {
      const row =
        document.createElement(
          'span'
        );

      row.className =
        'lectio-msg-tooltip-row';

      const sender =
        document.createElement(
          'span'
        );

      sender.className =
        'lectio-msg-tooltip-sender';

      sender.textContent =
        message.sender ||
        labels.unknown;

      const subject =
        document.createElement(
          'span'
        );

      subject.className =
        'lectio-msg-tooltip-subject';

      subject.textContent =
        message.subject ||
        labels.noSubject;

      row.append(
        sender,
        subject
      );

      tooltip.appendChild(
        row
      );
    }

    if (
      messages.length >
      MAX_PREVIEW_ITEMS
    ) {
      const more =
        document.createElement(
          'span'
        );

      more.className =
        'lectio-msg-tooltip-more';

      more.textContent =
        labels.more(
          messages.length -
          MAX_PREVIEW_ITEMS
        );

      tooltip.appendChild(
        more
      );
    }

    if (checkedAt) {
      const checked =
        document.createElement(
          'span'
        );

      checked.className =
        'lectio-msg-tooltip-checked';

      checked.textContent =
        `${labels.checked} ${
          formatTime(
            checkedAt
          )
        }`;

      tooltip.appendChild(
        checked
      );
    }
  }

  // ============================================================
  // DANISH / ENGLISH UI DETECTION
  // ============================================================

  function detectUiLanguage() {
    const link =
      getNavigationMessageLink();

    if (!link) {
      return 'da';
    }

    const clone =
      link.cloneNode(
        true
      );

    clone
      .querySelectorAll(
        `.${BADGE_CLASS}, .ls-fonticon`
      )
      .forEach(
        (node) =>
          node.remove()
      );

    const text =
      clean(
        clone.textContent
      );

    if (
      /\bmessages?\b/i.test(
        text
      )
    ) {
      return 'en';
    }

    if (
      /\bbeskeder?\b/i.test(
        text
      )
    ) {
      return 'da';
    }

    return 'da';
  }

  // ============================================================
  // AUDIO
  // ============================================================

  function installAudioUnlock() {
    const eventNames = [
      'pointerdown',
      'keydown',
      'touchstart'
    ];

    const unlock = () => {
      unlockAudio();

      for (
        const eventName of
        eventNames
      ) {
        document.removeEventListener(
          eventName,
          unlock,
          true
        );
      }
    };

    for (
      const eventName of
      eventNames
    ) {
      document.addEventListener(
        eventName,
        unlock,
        {
          capture: true,
          passive: true
        }
      );
    }
  }

  async function unlockAudio() {
    try {
      if (!audioContext) {
        const AudioContextClass =
          window.AudioContext ||
          window.webkitAudioContext;

        if (!AudioContextClass) {
          return;
        }

        audioContext =
          new AudioContextClass();
      }

      if (
        audioContext.state ===
        'suspended'
      ) {
        await audioContext.resume();
      }

      audioReady =
        audioContext.state ===
        'running';
    } catch (_) {
      audioReady = false;
    }
  }

  function playLectioChime() {
    if (
      !audioContext ||
      !audioReady ||
      audioContext.state !==
        'running'
    ) {
      return;
    }

    const context =
      audioContext;

    const start =
      context.currentTime +
      0.02;

    const master =
      context.createGain();

    master.gain.setValueAtTime(
      0.9,
      start
    );

    master.connect(
      context.destination
    );

    const notes = [
      {
        frequency: 659.25,
        offset: 0.00,
        duration: 0.30,
        gain: 0.040
      },
      {
        frequency: 783.99,
        offset: 0.10,
        duration: 0.36,
        gain: 0.034
      },
      {
        frequency: 1046.50,
        offset: 0.22,
        duration: 0.46,
        gain: 0.027
      }
    ];

    for (
      const note of
      notes
    ) {
      playTone(
        context,
        master,
        start + note.offset,
        note
      );
    }
  }

  function playTone(
    context,
    destination,
    startTime,
    note
  ) {
    const oscillator =
      context.createOscillator();

    const gain =
      context.createGain();

    oscillator.type =
      'sine';

    oscillator.frequency
      .setValueAtTime(
        note.frequency,
        startTime
      );

    gain.gain
      .setValueAtTime(
        0.0001,
        startTime
      );

    gain.gain
      .exponentialRampToValueAtTime(
        note.gain,
        startTime + 0.012
      );

    gain.gain
      .exponentialRampToValueAtTime(
        0.0001,
        startTime +
        note.duration
      );

    oscillator.connect(
      gain
    );

    gain.connect(
      destination
    );

    oscillator.start(
      startTime
    );

    oscillator.stop(
      startTime +
      note.duration +
      0.03
    );

    const overtone =
      context.createOscillator();

    const overtoneGain =
      context.createGain();

    overtone.type =
      'sine';

    overtone.frequency
      .setValueAtTime(
        note.frequency * 2,
        startTime
      );

    overtoneGain.gain
      .setValueAtTime(
        0.0001,
        startTime
      );

    overtoneGain.gain
      .exponentialRampToValueAtTime(
        note.gain * 0.14,
        startTime + 0.008
      );

    overtoneGain.gain
      .exponentialRampToValueAtTime(
        0.0001,
        startTime +
        note.duration * 0.72
      );

    overtone.connect(
      overtoneGain
    );

    overtoneGain.connect(
      destination
    );

    overtone.start(
      startTime
    );

    overtone.stop(
      startTime +
      note.duration +
      0.03
    );
  }

  // ============================================================
  // CACHE
  // ============================================================

  function readCachedState() {
    try {
      const parsed =
        JSON.parse(
          localStorage.getItem(
            CACHE_KEY
          ) ||
          'null'
        );

      return isValidState(
        parsed
      )
        ? parsed
        : null;
    } catch (_) {
      return null;
    }
  }

  function loadCachedState() {
    const cached =
      readCachedState();

    if (!cached) return;

    messages =
      cached.messages;

    checkedAt =
      cached.checkedAt;
  }

  function saveCachedState() {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          schoolId:
            SCHOOL_ID,

          messages,

          checkedAt
        })
      );
    } catch (_) {
      // Ignore storage errors.
    }
  }

  function isValidState(value) {
    return Boolean(
      value &&
      Array.isArray(
        value.messages
      ) &&
      Number.isFinite(
        value.checkedAt
      )
    );
  }

  function cleanupOldCaches() {
    try {
      localStorage.removeItem(
        'lectioUnreadMessages.cache.v1'
      );

      localStorage.removeItem(
        'lectioUnreadMessages.safe.v1'
      );

      localStorage.removeItem(
        'lectioUnreadMessages.v2'
      );
    } catch (_) {
      // Not important.
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function clean(value) {
    return String(
      value || ''
    )
      .replace(
        /\u00a0/g,
        ' '
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();
  }

  function formatTime(timestamp) {
    try {
      return new Date(
        timestamp
      )
        .toLocaleTimeString(
          [],
          {
            hour: '2-digit',
            minute: '2-digit'
          }
        );
    } catch (_) {
      return '';
    }
  }

  // ============================================================
  // STYLES
  // ============================================================

  function injectStyles() {
    const styleId =
      'lectio-msg-notification-style-v3';

    if (
      document.getElementById(
        styleId
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      styleId;

    style.textContent = `
      .${HOST_CLASS} {
        position: relative !important;
        overflow: visible !important;
      }

      .${BADGE_CLASS} {
        position: absolute;
        top: -7px;
        right: -8px;
        z-index: 5000;

        min-width: 20px;
        height: 18px;
        padding: 0 5px;

        box-sizing: border-box;

        display: inline-flex;
        align-items: center;
        justify-content: center;

        background: #cae6ff;
        color: #102c3c;

        border: 1px solid #aab9c5;
        border-radius: 6px 6px 6px 2px;

        box-shadow:
          0 1px 3px
          rgba(0, 0, 0, 0.20);

        font-family: Arial, sans-serif;
        font-size: 11px;
        font-weight: 700;
        line-height: 18px;
        text-decoration: none;

        cursor: default;

        transform-origin:
          50% 60%;
      }

      .${BADGE_CLASS}[hidden] {
        display: none !important;
      }

      .${BADGE_CLASS}::after {
        content: "";

        position: absolute;

        left: 2px;
        bottom: -4px;

        border-top:
          5px solid #cae6ff;

        border-right:
          5px solid transparent;
      }

      .${BADGE_CLASS}.is-new {
        animation:
          lectio-message-arrived
          520ms
          cubic-bezier(.2, .9, .3, 1.2);
      }

      @keyframes lectio-message-arrived {
        0% {
          transform:
            scale(0.82);
        }

        52% {
          transform:
            scale(1.18);
        }

        100% {
          transform:
            scale(1);
        }
      }

      .${TOOLTIP_CLASS} {
        position: absolute;

        top: 25px;
        right: -10px;

        z-index: 6000;

        display: none;

        width: 300px;
        padding: 10px;

        box-sizing: border-box;

        background: #f2f5f8;
        color: #172b36;

        border:
          1px solid #bcc7cf;

        border-radius:
          5px;

        box-shadow:
          0 4px 12px
          rgba(0, 0, 0, 0.18);

        font-family:
          Arial,
          sans-serif;

        font-size:
          12px;

        font-weight:
          400;

        line-height:
          1.35;

        text-align:
          left;

        white-space:
          normal;

        pointer-events:
          none;
      }

      .${BADGE_CLASS}:hover
      > .${TOOLTIP_CLASS},

      .${BADGE_CLASS}:focus-within
      > .${TOOLTIP_CLASS} {
        display: block;
      }

      .lectio-msg-tooltip-header {
        display: block;

        padding-bottom: 6px;
        margin-bottom: 6px;

        border-bottom:
          1px solid #d2dbe1;

        font-weight: 700;
      }

      .lectio-msg-tooltip-row {
        display: grid;

        grid-template-columns:
          100px 1fr;

        gap: 8px;

        margin: 4px 0;
      }

      .lectio-msg-tooltip-sender,
      .lectio-msg-tooltip-subject {
        overflow: hidden;

        text-overflow:
          ellipsis;

        white-space:
          nowrap;
      }

      .lectio-msg-tooltip-sender {
        font-weight: 700;
      }

      .lectio-msg-tooltip-subject {
        color: #425664;
      }

      .lectio-msg-tooltip-more {
        display: block;

        margin-top: 6px;

        color: #425664;

        font-weight: 700;
      }

      .lectio-msg-tooltip-checked {
        display: block;

        margin-top: 7px;
        padding-top: 6px;

        border-top:
          1px solid #d2dbe1;

        color: #687983;

        font-size: 10px;
      }

      @media (hover: none) {
        .${TOOLTIP_CLASS} {
          display: none !important;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .${BADGE_CLASS}.is-new {
          animation: none;
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }

})();