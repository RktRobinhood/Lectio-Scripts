// ==UserScript==
// @name         Lectio - Unread Message Notifications
// @namespace    https://www.lectio.dk/lectio/223/
// @version      0.2.0
// @description  Shows a Lectio-style unread-message badge beside Beskeder / Messages, with sender previews on hover.
// @match        https://www.lectio.dk/lectio/223/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const SCHOOL = '223';
  const INBOX_URL = `/lectio/${SCHOOL}/beskeder2.aspx`;

  const CACHE_KEY = 'lectioUnreadMessages.cache.v1';
  const POLL_MS = 10 * 60 * 1000;
  const CACHE_RENDER_MAX_AGE = 10 * 60 * 1000;
  const RETURN_REFRESH_AGE = 10 * 60 * 1000;
  const MAX_PREVIEW_ITEMS = 6;

  const HOST_CLASS = 'lectio-unread-host';
  const BADGE_CLASS = 'lectio-unread-badge';
  const TOOLTIP_CLASS = 'lectio-unread-tooltip';
  const MESSAGE_LINK_SELECTOR =
    `a[href*="/lectio/${SCHOOL}/beskeder2.aspx"], a[href$="/beskeder2.aspx"]`;

  let state = loadCache();
  let inFlight = false;
  let observerQueued = false;

  init();

  function init() {
    injectStyles();

    // Render a recent cached result immediately so navigation does not have to
    // wait for the first background request.
    if (state && Date.now() - state.checkedAt > CACHE_RENDER_MAX_AGE) {
      state = null;
    }

    attachBadges();

    if (state) {
      renderAll(false);
    }

    // Translation/theme scripts can replace Lectio navigation nodes after this
    // script has run. Watch only for changes that could affect message links.
    //
    // Critically, ignore mutations inside our own badge/tooltip UI so rendering
    // the badge cannot trigger an observer -> render -> observer feedback loop.
    const observer = new MutationObserver((mutations) => {
      const relevant = mutations.some(mutationTouchesMessageNavigation);

      if (!relevant || observerQueued) {
        return;
      }

      observerQueued = true;

      queueMicrotask(() => {
        observerQueued = false;
        attachBadges();
      });
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    // If another Lectio tab refreshes the shared cache, update this tab too.
    window.addEventListener('storage', (event) => {
      if (event.key !== CACHE_KEY || !event.newValue) {
        return;
      }

      try {
        const incoming = JSON.parse(event.newValue);

        if (!isValidState(incoming)) {
          return;
        }

        const oldCount = state?.messages?.length ?? 0;

        state = incoming;

        attachBadges();
        renderAll(incoming.messages.length > oldCount);
      } catch (_) {
        // Ignore malformed cache data.
      }
    });

    // Returning to Lectio after it has been sitting for at least ten minutes
    // warrants a new check.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      const age = Date.now() - (state?.checkedAt || 0);

      if (age >= RETURN_REFRESH_AGE) {
        refreshUnreadMessages();
      }
    });

    // Let Lectio finish its own page setup before the initial request.
    window.setTimeout(() => {
      refreshUnreadMessages();
    }, 600);

    // Modest periodic polling while the tab is actually visible.
    window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshUnreadMessages();
      }
    }, POLL_MS);
  }

  async function refreshUnreadMessages() {
    if (inFlight) {
      return;
    }

    inFlight = true;

    try {
      const doc = await fetchHtml(INBOX_URL);
      const parsed = parseUnreadMessages(doc);

      // If Lectio changes its message markup, keep the previous known-good
      // result rather than falsely displaying "0 unread".
      if (!parsed) {
        console.warn(
          '[Lectio Message Notifications] Could not recognise the current message-list markup.'
        );
        return;
      }

      const oldCount = state?.messages?.length ?? 0;

      const next = {
        checkedAt: Date.now(),
        messages: parsed,
      };

      state = next;

      saveCache(next);
      attachBadges();
      renderAll(next.messages.length > oldCount);
    } catch (err) {
      console.warn(
        '[Lectio Message Notifications] Refresh failed:',
        err
      );
    } finally {
      inFlight = false;
    }
  }

  async function fetchHtml(url) {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    const finalUrl = new URL(res.url, location.origin);

    if (!/\/beskeder2\.aspx$/i.test(finalUrl.pathname)) {
      throw new Error(
        'Lectio did not return the inbox page; the login session may have expired.'
      );
    }

    const html = await res.text();

    return new DOMParser().parseFromString(
      html,
      'text/html'
    );
  }

  function parseUnreadMessages(doc) {
    // Current Lectio message rows use .message-list-thread-container, and
    // unread rows are explicitly marked <tr class="unread">.
    const currentRows = [...doc.querySelectorAll('tr')].filter(
      (row) =>
        row.querySelector(
          '.message-list-thread-container'
        )
    );

    // A valid empty inbox can have no rows, so also recognise the surrounding
    // message UI before deciding parsing failed.
    const hasMessageUi = Boolean(
      doc.querySelector(
        '.message-folder-header, ' +
          '.message-thread-container, ' +
          '[id*="threadGV"], ' +
          '[class*="message-list-thread"]'
      )
    );

    if (!currentRows.length && !hasMessageUi) {
      return null;
    }

    const unreadRows = currentRows.filter(
      (row) => row.classList.contains('unread')
    );

    return unreadRows.map((row, index) => {
      const container =
        row.querySelector(
          '.message-list-thread-container'
        ) || row;

      const sender = cleanText(
        container.querySelector(
          '.message-list-thread-from'
        )?.textContent ||
          row.querySelector(
            '[class*="thread-from"], [class*="sender"]'
          )?.textContent ||
          ''
      );

      const subject = cleanText(
        container.querySelector(
          '.message-list-thread-subject'
        )?.textContent ||
          row.querySelector(
            '[class*="thread-subject"], [class*="subject"]'
          )?.textContent ||
          ''
      );

      const datetime = cleanText(
        container.querySelector(
          '.message-list-thread-datetime'
        )?.textContent ||
          row.querySelector(
            '[class*="datetime"], [class*="date"]'
          )?.textContent ||
          ''
      );

      const subjectLink =
        container.querySelector(
          '.message-list-thread-subject a[href]'
        ) ||
        container.querySelector('a[href]');

      return {
        sender,
        subject,
        datetime,
        href: subjectLink
          ? new URL(
              subjectLink.getAttribute('href'),
              location.origin
            ).href
          : INBOX_URL,
        key: buildMessageKey(
          row,
          sender,
          subject,
          datetime,
          index
        ),
      };
    });
  }

  function buildMessageKey(
    row,
    sender,
    subject,
    datetime,
    index
  ) {
    const id =
      row.getAttribute('data-id') ||
      row.id ||
      row.querySelector('[id]')?.id ||
      '';

    return [
      id,
      sender,
      subject,
      datetime,
      index,
    ].join('|');
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function attachBadges() {
    const links = getMessageLinks();

    for (const link of links) {
      link.classList.add(HOST_CLASS);

      /*
       * IMPORTANT:
       *
       * Existing badges are deliberately left alone here.
       *
       * State updates are handled by renderAll().
       *
       * This makes attachBadges() idempotent and prevents
       * MutationObserver activity from repeatedly rebuilding
       * the tooltip.
       */
      if (
        link.querySelector(
          `:scope > .${BADGE_CLASS}`
        )
      ) {
        continue;
      }

      const badge =
        document.createElement('span');

      badge.className = BADGE_CLASS;
      badge.setAttribute(
        'aria-hidden',
        'true'
      );

      const count =
        document.createElement('span');

      count.className =
        'lectio-unread-count';

      badge.appendChild(count);

      const tooltip =
        document.createElement('span');

      tooltip.className =
        TOOLTIP_CLASS;

      badge.appendChild(tooltip);

      link.appendChild(badge);

      updateBadge(
        badge,
        false
      );
    }
  }

  function mutationTouchesMessageNavigation(
    mutation
  ) {
    /*
     * Never react to DOM modifications generated inside
     * our own badge.
     *
     * This is the main protection against a self-sustaining
     * MutationObserver loop.
     */
    if (
      mutation.target instanceof Element &&
      mutation.target.closest(
        `.${BADGE_CLASS}`
      )
    ) {
      return false;
    }

    /*
     * A message link itself, or something inside one,
     * was rewritten.
     */
    if (
      mutation.target instanceof Element &&
      (
        mutation.target.matches(
          MESSAGE_LINK_SELECTOR
        ) ||
        mutation.target.closest(
          MESSAGE_LINK_SELECTOR
        )
      )
    ) {
      return true;
    }

    /*
     * A new subtree containing a message link was added.
     *
     * This catches Lectio or another userscript rebuilding
     * the navigation bar.
     */
    for (
      const node
      of mutation.addedNodes
    ) {
      if (
        !(node instanceof Element)
      ) {
        continue;
      }

      if (
        node.matches(
          MESSAGE_LINK_SELECTOR
        ) ||
        node.querySelector(
          MESSAGE_LINK_SELECTOR
        )
      ) {
        return true;
      }
    }

    return false;
  }

  function getMessageLinks() {
    return [
      ...document.querySelectorAll(
        MESSAGE_LINK_SELECTOR
      ),
    ].filter(
      (link) =>
        !link.closest(
          `.${TOOLTIP_CLASS}`
        )
    );
  }

  function renderAll(animate) {
    for (
      const badge
      of document.querySelectorAll(
        `.${BADGE_CLASS}`
      )
    ) {
      updateBadge(
        badge,
        animate
      );
    }
  }

  function updateBadge(
    badge,
    animate
  ) {
    const count =
      state?.messages?.length ?? 0;

    if (!count) {
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

    const countEl =
      badge.querySelector(
        '.lectio-unread-count'
      );

    if (countEl) {
      countEl.textContent =
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
              (n) => `+${n} more`,

            checked:
              'Checked',
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
              (n) => `+${n} mere`,

            checked:
              'Tjekket',
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

      /*
       * Restart the animation if another
       * unread-count increase occurred.
       */
      void badge.offsetWidth;

      badge.classList.add(
        'is-new'
      );
    }
  }

  function renderTooltip(
    tooltip,
    labels
  ) {
    tooltip.replaceChildren();

    const header =
      document.createElement('span');

    header.className =
      'lectio-unread-tooltip-header';

    header.textContent =
      labels.header;

    tooltip.appendChild(
      header
    );

    const list =
      document.createElement('span');

    list.className =
      'lectio-unread-tooltip-list';

    for (
      const message
      of state.messages.slice(
        0,
        MAX_PREVIEW_ITEMS
      )
    ) {
      const item =
        document.createElement('span');

      item.className =
        'lectio-unread-tooltip-item';

      const sender =
        document.createElement('span');

      sender.className =
        'lectio-unread-tooltip-sender';

      sender.textContent =
        message.sender ||
        labels.unknown;

      const subject =
        document.createElement('span');

      subject.className =
        'lectio-unread-tooltip-subject';

      subject.textContent =
        message.subject ||
        labels.noSubject;

      item.append(
        sender,
        subject
      );

      list.appendChild(
        item
      );
    }

    if (
      state.messages.length >
      MAX_PREVIEW_ITEMS
    ) {
      const more =
        document.createElement('span');

      more.className =
        'lectio-unread-tooltip-more';

      more.textContent =
        labels.more(
          state.messages.length -
          MAX_PREVIEW_ITEMS
        );

      list.appendChild(
        more
      );
    }

    tooltip.appendChild(
      list
    );

    const footer =
      document.createElement('span');

    footer.className =
      'lectio-unread-tooltip-footer';

    footer.textContent =
      `${labels.checked} ${
        formatTime(
          state.checkedAt
        )
      }`;

    tooltip.appendChild(
      footer
    );
  }

  function detectUiLanguage() {
    const links =
      getMessageLinks();

    for (
      const link
      of links
    ) {
      const clone =
        link.cloneNode(true);

      clone
        .querySelectorAll(
          `.${BADGE_CLASS}, .ls-fonticon`
        )
        .forEach(
          (node) =>
            node.remove()
        );

      const text =
        cleanText(
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

  function formatTime(timestamp) {
    try {
      return new Date(
        timestamp
      ).toLocaleTimeString(
        [],
        {
          hour: '2-digit',
          minute: '2-digit',
        }
      );
    } catch (_) {
      return '';
    }
  }

  function loadCache() {
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

  function saveCache(value) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify(value)
      );
    } catch (_) {
      // Cache failure should never break Lectio.
    }
  }

  function isValidState(value) {
    return Boolean(
      value &&
        Number.isFinite(
          value.checkedAt
        ) &&
        Array.isArray(
          value.messages
        )
    );
  }

  function injectStyles() {
    if (
      document.getElementById(
        'lectio-unread-message-styles'
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      'lectio-unread-message-styles';

    style.textContent = `
      .${HOST_CLASS} {
        position: relative !important;
        overflow: visible !important;
      }

      .${BADGE_CLASS} {
        position: absolute;
        top: -0.48rem;
        right: -0.42rem;
        z-index: 10020;

        min-width: 1.35rem;
        height: 1.2rem;
        padding: 0 0.36rem;
        box-sizing: border-box;

        display: inline-flex;
        align-items: center;
        justify-content: center;

        background: #cae6ff;
        color: #001e2f;

        border:
          1px solid #c1c7ce;

        border-radius:
          0.38rem
          0.38rem
          0.38rem
          0.12rem;

        box-shadow:
          rgba(0,0,0,0.16)
            0 1px 3px,
          rgba(0,0,0,0.08)
            0 2px 5px;

        font-family:
          Roboto,
          Arial,
          sans-serif;

        font-size: 0.72rem;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0;
        text-align: center;
        text-decoration: none;

        cursor: pointer;

        transform-origin:
          50% 70%;
      }

      .${BADGE_CLASS}[hidden] {
        display:
          none !important;
      }

      .${BADGE_CLASS}::after {
        content: "";

        position: absolute;

        left: 0.12rem;
        bottom: -0.22rem;

        width: 0;
        height: 0;

        border-top:
          0.28rem solid #cae6ff;

        border-right:
          0.28rem solid transparent;

        pointer-events: none;
      }

      .${BADGE_CLASS}:hover,
      .${BADGE_CLASS}:focus-within {
        background: #cae6ff;
        color: #001e2f;

        opacity: 0.96;

        box-shadow:
          rgba(0,0,0,0.18)
            0 2px 4px,
          rgba(0,0,0,0.10)
            0 4px 8px;
      }

      .${BADGE_CLASS}.is-new {
        animation:
          lectio-unread-pop
          520ms
          cubic-bezier(
            .2,
            .9,
            .3,
            1.25
          );
      }

      @keyframes lectio-unread-pop {
        0% {
          transform:
            scale(0.72)
            translateY(2px);
        }

        55% {
          transform:
            scale(1.16)
            translateY(-1px);
        }

        100% {
          transform:
            scale(1)
            translateY(0);
        }
      }

      .${TOOLTIP_CLASS} {
        position: absolute;

        top:
          calc(
            100% + 0.62rem
          );

        right: -0.65rem;

        z-index: 10030;

        width:
          min(
            19rem,
            calc(
              100vw - 2rem
            )
          );

        padding:
          0.7rem
          0.78rem;

        box-sizing:
          border-box;

        display: none;

        flex-direction:
          column;

        gap: 0.48rem;

        background:
          oklch(
            0.9667
            0.012
            259.82
            /
            1
          );

        color: #001e2f;

        border:
          1px solid #c1c7ce;

        border-radius:
          0.5rem;

        box-shadow:
          rgba(0,0,0,0.18)
            0 4px 8px -2px,
          rgba(0,0,0,0.12)
            0 8px 16px 1px;

        font-family:
          Roboto,
          Arial,
          sans-serif;

        font-size: 0.82rem;
        font-weight: 400;
        line-height: 1.28;
        letter-spacing: normal;
        text-align: left;
        white-space: normal;

        pointer-events: none;
      }

      .${BADGE_CLASS}:hover
        > .${TOOLTIP_CLASS},

      .${BADGE_CLASS}:focus
        > .${TOOLTIP_CLASS},

      .${BADGE_CLASS}:focus-within
        > .${TOOLTIP_CLASS} {

        display: flex;
      }

      .lectio-unread-tooltip-header {
        display: block;

        padding-bottom:
          0.38rem;

        border-bottom:
          1px solid #d3dae0;

        font-weight: 700;
        font-size: 0.88rem;
      }

      .lectio-unread-tooltip-list {
        display: flex;

        flex-direction:
          column;

        gap: 0.42rem;
      }

      .lectio-unread-tooltip-item {
        display: grid;

        grid-template-columns:
          minmax(
            6.4rem,
            0.8fr
          )
          minmax(
            8rem,
            1.2fr
          );

        gap: 0.5rem;

        align-items:
          baseline;
      }

      .lectio-unread-tooltip-sender {
        overflow: hidden;

        text-overflow:
          ellipsis;

        white-space:
          nowrap;

        font-weight: 600;
      }

      .lectio-unread-tooltip-subject {
        overflow: hidden;

        text-overflow:
          ellipsis;

        white-space:
          nowrap;

        color: #394a57;

        font-weight: 400;
      }

      .lectio-unread-tooltip-more {
        display: block;

        padding-top:
          0.1rem;

        color: #394a57;

        font-weight: 600;
      }

      .lectio-unread-tooltip-footer {
        display: block;

        padding-top:
          0.36rem;

        border-top:
          1px solid #d3dae0;

        color: #5e6870;

        font-size: 0.72rem;
        font-weight: 400;
      }

      @media (
        max-width: 700px
      ) {
        .${BADGE_CLASS} {
          top: -0.34rem;
          right: -0.24rem;

          min-width:
            1.28rem;

          height:
            1.16rem;

          padding:
            0 0.32rem;

          font-size:
            0.7rem;
        }
      }

      @media (
        hover: none
      ) {
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
          animation: none;
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }
})();
