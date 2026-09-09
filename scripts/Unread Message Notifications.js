// ==UserScript==
// @name         Lectio - Unread Message Notifications
// @namespace    https://www.lectio.dk/lectio/223/
// @version      0.2.0
// @description  Shows unread Lectio messages beside Beskeder / Messages and plays a soft chime when the unread count increases.
// @match        https://www.lectio.dk/lectio/223/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const SCHOOL_ID = '223';
  const INBOX_URL = `/lectio/${SCHOOL_ID}/beskeder2.aspx`;

  /*
   * CHECKING STRATEGY
   *
   * 1. Once whenever a Lectio page loads.
   * 2. Every 10 minutes if you remain on the same page.
   * 3. When returning to a tab, but only if 10+ minutes have
   *    passed since the previous check.
   *
   * NO MutationObserver.
   */

  const CHECK_INTERVAL = 10 * 60 * 1000;
  const INITIAL_CHECK_DELAY = 1200;

  const MAX_PREVIEW_ITEMS = 6;

  const CACHE_KEY =
    'lectioUnreadMessages.v2';

  const HOST_CLASS =
    'lectio-msg-host';

  const BADGE_CLASS =
    'lectio-msg-notification';

  const TOOLTIP_CLASS =
    'lectio-msg-tooltip';

  let messages = [];
  let checkedAt = 0;
  let checking = false;

  let audioContext = null;
  let audioReady = false;

  start();


  // ============================================================
  // STARTUP
  // ============================================================

  function start() {
    cleanupOldCaches();

    injectStyles();
    loadCachedState();

    attachBadges();
    renderAll(false);

    /*
     * These are deliberately bounded retries.
     *
     * Your translation userscript may finish altering the
     * navigation slightly after this script starts.
     *
     * We therefore try attaching the badge a couple more times,
     * rather than watching the DOM continuously.
     */

    window.setTimeout(
      attachBadges,
      500
    );

    window.setTimeout(
      attachBadges,
      2500
    );


    /*
     * Firefox normally requires a user interaction before
     * webpages may generate sound.
     *
     * Clicking, tapping, or pressing a key once on this Lectio
     * page arms the notification chime.
     */

    installAudioUnlock();


    /*
     * One check after each Lectio page loads.
     */

    window.setTimeout(() => {
      checkMessages();
    }, INITIAL_CHECK_DELAY);


    /*
     * If you sit on the same page:
     *
     * check only every 10 minutes,
     * and only if the tab is visible.
     */

    window.setInterval(() => {

      if (
        document.visibilityState ===
        'visible'
      ) {
        checkMessages();
      }

    }, CHECK_INTERVAL);


    /*
     * Returning to Lectio does not automatically cause another
     * request unless the previous check is already 10+ minutes old.
     */

    document.addEventListener(
      'visibilitychange',
      () => {

        if (
          document.visibilityState !==
          'visible'
        ) {
          return;
        }

        attachBadges();

        if (
          Date.now() - checkedAt >=
          CHECK_INTERVAL
        ) {
          checkMessages();
        }
      }
    );


    /*
     * Multiple open Lectio tabs share their result.
     *
     * Only the tab that actually discovers an increase attempts
     * to make the notification sound.
     */

    window.addEventListener(
      'storage',
      (event) => {

        if (
          event.key !== CACHE_KEY ||
          !event.newValue
        ) {
          return;
        }

        try {

          const incoming =
            JSON.parse(
              event.newValue
            );

          if (
            !isValidState(incoming)
          ) {
            return;
          }

          messages =
            incoming.messages;

          checkedAt =
            incoming.checkedAt;

          attachBadges();
          renderAll(false);

        } catch (_) {

          // Ignore malformed cache data.

        }
      }
    );
  }


  // ============================================================
  // CHECK LECTIO
  // ============================================================

  async function checkMessages() {

    /*
     * Never allow overlapping requests.
     */

    if (checking) {
      return;
    }

    checking = true;

    try {

      const response =
        await fetch(
          INBOX_URL,
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


      /*
       * Make sure Lectio hasn't redirected us to something such
       * as a login page.
       */

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


      const inboxDoc =
        new DOMParser()
          .parseFromString(
            html,
            'text/html'
          );


      const parsed =
        parseUnreadMessages(
          inboxDoc
        );


      /*
       * If Lectio changes its HTML structure, DON'T suddenly
       * claim that you have zero messages.
       *
       * Preserve the previous known-good state instead.
       */

      if (parsed === null) {

        console.warn(
          '[Lectio Messages] Inbox layout was not recognised.'
        );

        return;
      }


      /*
       * Re-read the shared cache immediately before comparing.
       *
       * This helps prevent two Lectio tabs from both deciding
       * that the same new message has just arrived.
       */

      const previous =
        readCachedState();


      const previousCount =
        previous
          ? previous.messages.length
          : null;


      /*
       * No sound on first installation.
       *
       * The first successful check becomes our baseline.
       */

      const hasBaseline =
        previous !== null;


      const increased =
        hasBaseline &&
        parsed.length >
          previousCount;


      messages =
        parsed;


      checkedAt =
        Date.now();


      saveCachedState();


      attachBadges();


      renderAll(
        increased
      );


      /*
       * Sound ONLY if unread count increased.
       */

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
  // PARSE LECTIO MESSAGE LIST
  // ============================================================

  function parseUnreadMessages(doc) {

    /*
     * Lectio currently places message threads inside rows
     * containing:
     *
     * .message-list-thread-container
     *
     * Unread rows are marked:
     *
     * <tr class="unread">
     */

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


    /*
     * Distinguish:
     *
     * "zero messages"
     *
     * from
     *
     * "we couldn't recognise the page".
     */

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

  function attachBadges() {

    for (
      const link of
      getMessageLinks()
    ) {

      link.classList.add(
        HOST_CLASS
      );


      /*
       * Do absolutely nothing if this link already has our badge.
       */

      if (
        link.querySelector(
          `:scope > .${BADGE_CLASS}`
        )
      ) {
        continue;
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


      link.appendChild(
        badge
      );
    }
  }


  function getMessageLinks() {

    return Array.from(

      document.querySelectorAll(
        [
          `a[href*="/lectio/${SCHOOL_ID}/beskeder2.aspx"]`,
          'a[href$="/beskeder2.aspx"]'
        ].join(',')
      )

    );
  }


  // ============================================================
  // RENDER BADGE
  // ============================================================

  function renderAll(animate) {

    for (
      const badge of
      document.querySelectorAll(
        `.${BADGE_CLASS}`
      )
    ) {

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


    const lang =
      detectUiLanguage();


    const labels =
      lang === 'en'

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
              (n) =>
                `+${n} more`,

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
              (n) =>
                `+${n} mere`,

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


    /*
     * Small visual pop when the count increases.
     *
     * This does not trigger anything else because there is
     * no MutationObserver.
     */

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
  // DANISH / ENGLISH
  // ============================================================

  function detectUiLanguage() {

    for (
      const link of
      getMessageLinks()
    ) {

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
    }


    return 'da';
  }


  // ============================================================
  // CUSTOM LECTIO MESSAGE SOUND
  // ============================================================

  function installAudioUnlock() {

    const events = [
      'pointerdown',
      'keydown',
      'touchstart'
    ];


    const unlock = () => {

      unlockAudio();


      /*
       * We only need one interaction.
       */

      for (
        const eventName of
        events
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
      events
    ) {

      document.addEventListener(
        eventName,
        unlock,
        {
          capture: true,
          once: false,
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

    /*
     * If Firefox has not yet allowed audio on this page,
     * simply skip the sound.
     *
     * The visual notification still works.
     */

    if (
      !audioContext ||
      !audioReady ||
      audioContext.state !==
        'running'
    ) {
      return;
    }


    const ctx =
      audioContext;


    const now =
      ctx.currentTime +
      0.02;


    const master =
      ctx.createGain();


    master.gain.setValueAtTime(
      0.9,
      now
    );


    master.connect(
      ctx.destination
    );


    /*
     * CUSTOM LECTIO CHIME
     *
     * Soft E5 -> G5 -> C6.
     *
     * Short enough to be noticeable without becoming obnoxious
     * in a classroom.
     *
     * It is generated entirely in the browser.
     * No MP3, WAV, CDN, or external request.
     */

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
        ctx,
        master,
        now + note.offset,
        note
      );

    }
  }


  function playTone(
    ctx,
    destination,
    startTime,
    note
  ) {

    /*
     * Main tone
     */

    const oscillator =
      ctx.createOscillator();


    const gain =
      ctx.createGain();


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


    /*
     * Very quiet overtone.
     *
     * This gives it a slightly glassy notification character
     * instead of sounding like a generic sine-wave beep.
     */

    const overtone =
      ctx.createOscillator();


    const overtoneGain =
      ctx.createGain();


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


    if (!cached) {
      return;
    }


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
          messages,
          checkedAt
        })

      );

    } catch (_) {

      // Ignore localStorage failure.

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


  /*
   * Clean up cache keys left by the experimental versions.
   */

  function cleanupOldCaches() {

    try {

      localStorage.removeItem(
        'lectioUnreadMessages.cache.v1'
      );


      localStorage.removeItem(
        'lectioUnreadMessages.safe.v1'
      );


    } catch (_) {

      // Nothing important.

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

    if (
      document.getElementById(
        'lectio-msg-notification-style-v2'
      )
    ) {
      return;
    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      'lectio-msg-notification-style-v2';


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


        background:
          #cae6ff;

        color:
          #102c3c;


        border:
          1px solid
          #aab9c5;


        border-radius:
          6px 6px 6px 2px;


        box-shadow:
          0 1px 3px
          rgba(0, 0, 0, 0.20);


        font-family:
          Arial,
          sans-serif;

        font-size:
          11px;

        font-weight:
          700;

        line-height:
          18px;

        text-decoration:
          none;


        cursor:
          default;


        transform-origin:
          50% 60%;
      }


      .${BADGE_CLASS}[hidden] {
        display:
          none !important;
      }


      /*
       * Small speech-bubble point.
       */

      .${BADGE_CLASS}::after {

        content: "";

        position:
          absolute;

        left:
          2px;

        bottom:
          -4px;


        border-top:
          5px solid
          #cae6ff;

        border-right:
          5px solid
          transparent;
      }


      /*
       * A restrained pop when a new unread message arrives.
       */

      .${BADGE_CLASS}.is-new {

        animation:
          lectio-message-arrived
          520ms
          cubic-bezier(
            .2,
            .9,
            .3,
            1.2
          );
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


      /*
       * HOVER PREVIEW
       */

      .${TOOLTIP_CLASS} {

        position:
          absolute;

        top:
          25px;

        right:
          -10px;

        z-index:
          6000;


        display:
          none;


        width:
          300px;


        padding:
          10px;


        box-sizing:
          border-box;


        background:
          #f2f5f8;


        color:
          #172b36;


        border:
          1px solid
          #bcc7cf;


        border-radius:
          5px;


        box-shadow:
          0 4px 12px
          rgba(
            0,
            0,
            0,
            0.18
          );


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

        display:
          block;
      }


      .lectio-msg-tooltip-header {

        display:
          block;


        padding-bottom:
          6px;


        margin-bottom:
          6px;


        border-bottom:
          1px solid
          #d2dbe1;


        font-weight:
          700;
      }


      .lectio-msg-tooltip-row {

        display:
          grid;


        grid-template-columns:
          100px 1fr;


        gap:
          8px;


        margin:
          4px 0;
      }


      .lectio-msg-tooltip-sender,
      .lectio-msg-tooltip-subject {

        overflow:
          hidden;


        text-overflow:
          ellipsis;


        white-space:
          nowrap;
      }


      .lectio-msg-tooltip-sender {

        font-weight:
          700;
      }


      .lectio-msg-tooltip-subject {

        color:
          #425664;
      }


      .lectio-msg-tooltip-more {

        display:
          block;


        margin-top:
          6px;


        color:
          #425664;


        font-weight:
          700;
      }


      .lectio-msg-tooltip-checked {

        display:
          block;


        margin-top:
          7px;


        padding-top:
          6px;


        border-top:
          1px solid
          #d2dbe1;


        color:
          #687983;


        font-size:
          10px;
      }


      /*
       * Touch devices do not have a meaningful hover state.
       */

      @media (hover: none) {

        .${TOOLTIP_CLASS} {

          display:
            none !important;
        }
      }


      @media (
        prefers-reduced-motion:
        reduce
      ) {

        .${BADGE_CLASS}.is-new {

          animation:
            none;
        }
      }

    `;


    document.head.appendChild(
      style
    );
  }

})();