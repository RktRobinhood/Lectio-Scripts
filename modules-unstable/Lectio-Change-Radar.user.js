// ==UserScript==
// @name         Lectio Change Radar
// @namespace    https://github.com/RktRobinhood/Lectio-Scripts
// @version      0.1.0-beta.1
// @description  Watches your Lectio timetable for cancellations and schedule changes and keeps a compact recent-change HUD.
// @author       RktRobinhood
// @match        https://www.lectio.dk/lectio/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/RktRobinhood/Lectio-Scripts
// @supportURL   https://github.com/RktRobinhood/Lectio-Scripts/issues
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Change-Radar.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Change-Radar.user.js
// ==/UserScript==

(() => {
  'use strict';

  const MODULE = Object.freeze({
    id: 'change-radar',
    aliases: ['schedule-change-radar', 'lectio-change-radar', 'change-log'],
    name: 'Lectio Change Radar',
    version: '0.1.0-beta.1',
    channel: 'unstable'
  });

  const CONFIG = Object.freeze({
    pollMs: 10 * 60 * 1000,
    minRefreshGapMs: 90 * 1000,
    maxHistory: 10,
    weeksAhead: 1,
    fetchTimeoutMs: 20 * 1000
  });

  const UI = Object.freeze({
    root: 'lectio-change-radar',
    style: 'lectio-change-radar-style',
    panel: 'lectio-change-radar-panel',
    header: 'lectio-change-radar-header',
    list: 'lectio-change-radar-list',
    status: 'lectio-change-radar-status'
  });

  const schoolId = getSchoolId();
  if (!schoolId) return;

  const identity = detectIdentity();
  const storageBase = `lectioChangeRadar.v1.${schoolId}.${identity}`;
  const STORAGE = Object.freeze({
    state: `${storageBase}.state`,
    lastPoll: `${storageBase}.lastPoll`,
    lastViewed: `${storageBase}.lastViewed`
  });

  const runtime = {
    state: loadState(),
    inFlight: false,
    pinned: false,
    hovered: false,
    timer: null,
    lastError: '',
    refreshQueued: false
  };

  registerWithManager();
  window.addEventListener('lectio-manager:discover', registerWithManager);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  function registerWithManager() {
    window.dispatchEvent(new CustomEvent('lectio-module:register', {
      detail: {
        id: MODULE.id,
        aliases: MODULE.aliases,
        name: MODULE.name,
        version: MODULE.version,
        channel: MODULE.channel,
        settingsSchema: [],
        currentValues: {}
      }
    }));
  }

  function init() {
    if (!document.body) return;

    installStyles();
    installHud();
    renderHud();

    void refresh({ reason: 'startup' });

    runtime.timer = window.setInterval(() => {
      void refresh({ reason: 'interval' });
    }, CONFIG.pollMs);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const lastPoll = readNumber(STORAGE.lastPoll);
        if (Date.now() - lastPoll >= CONFIG.pollMs) {
          void refresh({ reason: 'visible' });
        }
      }
    });

    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE.state && event.key !== STORAGE.lastViewed) return;
      runtime.state = loadState();
      renderHud();
    });

    // Give the Manager more than one opportunity to discover the module.
    window.setTimeout(registerWithManager, 500);
    window.setTimeout(registerWithManager, 1500);
  }

  async function refresh({ reason = 'manual', force = false } = {}) {
    if (runtime.inFlight) return;

    const now = Date.now();
    const lastPoll = readNumber(STORAGE.lastPoll);

    if (!force && reason !== 'manual' && now - lastPoll < CONFIG.minRefreshGapMs) {
      return;
    }

    runtime.inFlight = true;
    runtime.lastError = '';
    renderHud();

    try {
      const snapshot = await buildSnapshot();
      const previous = runtime.state?.snapshot || null;

      if (!previous) {
        runtime.state = {
          version: 1,
          initializedAt: now,
          checkedAt: now,
          snapshot,
          history: []
        };
      } else {
        const changes = compareSnapshots(previous, snapshot, now);
        const currentHistory = Array.isArray(runtime.state.history) ? runtime.state.history : [];
        const history = mergeHistory(changes, currentHistory);

        runtime.state = {
          version: 1,
          initializedAt: runtime.state.initializedAt || now,
          checkedAt: now,
          snapshot,
          history
        };
      }

      saveState(runtime.state);
      writeNumber(STORAGE.lastPoll, now);
    } catch (error) {
      runtime.lastError = friendlyError(error);
    } finally {
      runtime.inFlight = false;
      renderHud();
    }
  }

  async function buildSnapshot() {
    const now = new Date();
    const weekInfos = [];

    for (let offset = 0; offset <= CONFIG.weeksAhead; offset += 1) {
      weekInfos.push(getIsoWeekInfo(addDays(now, offset * 7)));
    }

    const docs = await Promise.all(weekInfos.map(fetchScheduleWeek));
    const events = {};

    for (const { doc } of docs) {
      for (const event of parseSchedule(doc)) {
        events[event.id] = event;
      }
    }

    const rangeStart = startOfIsoWeek(now);
    const rangeEnd = addDays(rangeStart, ((CONFIG.weeksAhead + 1) * 7) - 1);

    return {
      capturedAt: Date.now(),
      rangeStart: toIsoDate(rangeStart),
      rangeEnd: toIsoDate(rangeEnd),
      events
    };
  }

  async function fetchScheduleWeek(weekInfo) {
    const url = `/lectio/${schoolId}/SkemaNy.aspx?week=${weekInfo.week}${weekInfo.year}&showtype=0`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Schedule request failed with HTTP ${response.status}.`);
      }

      if (/login\.aspx/i.test(response.url || '')) {
        throw new Error('Lectio login expired.');
      }

      const html = await response.text();
      if (/name=["']password["']/i.test(html) && /log ind|login/i.test(html)) {
        throw new Error('Lectio login expired.');
      }

      const doc = new DOMParser().parseFromString(html, 'text/html');
      return { doc, url };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function parseSchedule(doc) {
    const result = [];
    const bricks = doc.querySelectorAll('a.s2skemabrik.s2brik[data-tooltip]');

    for (const brick of bricks) {
      const parsed = parseBrick(brick);
      if (parsed) result.push(parsed);
    }

    return result;
  }

  function parseBrick(brick) {
    const tooltip = cleanMultiline(brick.getAttribute('data-tooltip') || '');
    if (!tooltip) return null;

    const id = getActivityId(brick);
    if (!id) return null;

    const lines = tooltip.split('\n').map(cleanText).filter(Boolean);
    const dateIndex = lines.findIndex((line) => /\b\d{1,2}\/\d{1,2}-\d{4}\b/.test(line));
    const dateLine = dateIndex >= 0 ? lines[dateIndex] : '';
    const dateMatch = dateLine.match(/\b(\d{1,2})\/(\d{1,2})-(\d{4})(?:\s+(?:(\d{1,2}):(\d{2})\s+til\s+(\d{1,2}):(\d{2})|(Hele dagen)))?/i);

    let dateIso = '';
    let start = '';
    let end = '';
    let allDay = false;

    if (dateMatch) {
      const day = Number(dateMatch[1]);
      const month = Number(dateMatch[2]);
      const year = Number(dateMatch[3]);
      dateIso = `${year}-${pad2(month)}-${pad2(day)}`;

      if (dateMatch[8]) {
        allDay = true;
      } else if (dateMatch[4] != null) {
        start = `${pad2(Number(dateMatch[4]))}:${dateMatch[5]}`;
        end = `${pad2(Number(dateMatch[6]))}:${dateMatch[7]}`;
      }
    }

    const beforeDate = dateIndex > 0 ? lines.slice(0, dateIndex) : [];
    const hold = extractField(lines, /^Hold\s*:\s*(.+)$/i);
    const teacher = extractField(lines, /^Lærer\s*:\s*(.+)$/i);
    const room = extractField(lines, /^Lokaler?\s*:\s*(.+)$/i);
    const titleFromTooltip = beforeDate.join(' · ');
    const visibleText = cleanText(brick.querySelector('.s2skemabrikcontent')?.textContent || brick.textContent || '');
    const title = titleFromTooltip || hold || visibleText || 'Lectio activity';

    let status = 'normal';
    if (brick.classList.contains('s2cancelled')) status = 'cancelled';
    else if (brick.classList.contains('s2changed')) status = 'changed';

    const href = brick.getAttribute('href') || '';
    let absoluteUrl = '';
    try {
      absoluteUrl = href ? new URL(href, location.origin).href : '';
    } catch (_) {}

    return {
      id,
      dateIso,
      start,
      end,
      allDay,
      title,
      hold,
      teacher,
      room,
      status,
      tooltip,
      url: absoluteUrl
    };
  }

  function compareSnapshots(previous, current, noticedAt) {
    const changes = [];
    const oldEvents = previous.events || {};
    const newEvents = current.events || {};
    const oldIds = new Set(Object.keys(oldEvents));
    const newIds = new Set(Object.keys(newEvents));
    const today = toIsoDate(new Date());

    for (const id of newIds) {
      const next = newEvents[id];
      const before = oldEvents[id];

      if (before) {
        const change = compareEvent(before, next, noticedAt);
        if (change) changes.push(change);
        continue;
      }

      // Only call an item "added" when its date was already inside the old
      // monitored window. This prevents a new week entering the rolling
      // two-week window from creating a wall of false "added" events.
      if (isDateInside(next.dateIso, previous.rangeStart, previous.rangeEnd) && next.dateIso >= today) {
        changes.push(makeHistoryEntry({
          event: next,
          kind: 'added',
          title: next.title,
          detail: `Added to schedule${scheduleSuffix(next)}`,
          noticedAt
        }));
      }
    }

    for (const id of oldIds) {
      if (newIds.has(id)) continue;
      const before = oldEvents[id];

      // Same boundary protection in the other direction: only call an item
      // removed when it should still be visible in the new monitored window.
      if (isDateInside(before.dateIso, current.rangeStart, current.rangeEnd) && before.dateIso >= today) {
        changes.push(makeHistoryEntry({
          event: before,
          kind: 'removed',
          title: before.title,
          detail: `Removed from schedule${scheduleSuffix(before)}`,
          noticedAt
        }));
      }
    }

    return changes.sort((a, b) => {
      const byDate = String(a.eventDate || '').localeCompare(String(b.eventDate || ''));
      if (byDate !== 0) return byDate;
      return String(a.eventStart || '').localeCompare(String(b.eventStart || ''));
    });
  }

  function compareEvent(before, next, noticedAt) {
    const details = [];
    let kind = 'changed';

    if (next.status === 'cancelled' && before.status !== 'cancelled') {
      kind = 'cancelled';
      details.push('Cancelled');
    } else if (before.status === 'cancelled' && next.status !== 'cancelled') {
      kind = 'restored';
      details.push('Cancellation cleared');
    }

    if (before.dateIso !== next.dateIso || before.start !== next.start || before.end !== next.end || before.allDay !== next.allDay) {
      if (kind === 'changed') kind = 'time';
      details.push(`Time: ${formatEventWhen(before)} -> ${formatEventWhen(next)}`);
    }

    if (normalizeCompare(before.room) !== normalizeCompare(next.room)) {
      if (kind === 'changed') kind = 'room';
      details.push(`Room: ${before.room || 'none'} -> ${next.room || 'none'}`);
    }

    if (normalizeCompare(before.teacher) !== normalizeCompare(next.teacher)) {
      details.push(`Teacher: ${before.teacher || 'none'} -> ${next.teacher || 'none'}`);
    }

    if (normalizeCompare(before.hold) !== normalizeCompare(next.hold)) {
      details.push(`Class: ${before.hold || 'none'} -> ${next.hold || 'none'}`);
    }

    if (normalizeCompare(before.title) !== normalizeCompare(next.title)) {
      details.push(`Title: ${before.title || 'untitled'} -> ${next.title || 'untitled'}`);
    }

    // Lectio sometimes marks a brick changed even when the compact tooltip does
    // not expose which field changed. Preserve that signal rather than missing it.
    if (!details.length && next.status === 'changed' && before.status !== 'changed') {
      details.push('Lectio marked this activity as changed');
    }

    // Ignore a change marker simply disappearing; that is often Lectio clearing
    // its own visual state rather than a user-relevant schedule change.
    if (!details.length) return null;

    return makeHistoryEntry({
      event: next,
      kind,
      title: next.title,
      detail: details.join(' · '),
      noticedAt
    });
  }

  function makeHistoryEntry({ event, kind, title, detail, noticedAt }) {
    const fingerprint = [
      event.id,
      kind,
      detail,
      event.dateIso,
      event.start
    ].join('|');

    return {
      id: `${noticedAt}-${simpleHash(fingerprint)}`,
      eventId: event.id,
      kind,
      title: title || 'Lectio activity',
      detail: detail || 'Schedule changed',
      noticedAt,
      eventDate: event.dateIso || '',
      eventStart: event.start || '',
      eventEnd: event.end || '',
      url: event.url || ''
    };
  }

  function mergeHistory(changes, history) {
    if (!changes.length) return history.slice(0, CONFIG.maxHistory);

    const combined = [...changes.slice().reverse(), ...history];
    const seen = new Set();
    const deduped = [];

    for (const item of combined) {
      const key = `${item.eventId}|${item.kind}|${item.detail}|${item.noticedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
      if (deduped.length >= CONFIG.maxHistory) break;
    }

    return deduped;
  }

  function installStyles() {
    if (document.getElementById(UI.style)) return;

    const style = document.createElement('style');
    style.id = UI.style;
    style.textContent = `
      #${UI.root} {
        --lcr-border: #c8d4dc;
        --lcr-text: #243746;
        --lcr-muted: #667783;
        --lcr-bg: rgba(255, 255, 255, .98);
        --lcr-soft: #f5f8fa;
        --lcr-accent: #3b6f93;
        position: fixed;
        top: 96px;
        right: 12px;
        z-index: 2147482900;
        width: 286px;
        box-sizing: border-box;
        border: 1px solid var(--lcr-border);
        border-radius: 10px;
        background: var(--lcr-bg);
        color: var(--lcr-text);
        box-shadow: 0 5px 20px rgba(28, 46, 58, .16);
        font: 12px/1.35 Arial, Helvetica, sans-serif;
        overflow: hidden;
      }

      #${UI.root}.is-error { --lcr-accent: #a44b40; }
      #${UI.root}.has-unseen { border-color: #9bb5c7; }

      #${UI.header} {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        box-sizing: border-box;
        border: 0;
        background: #fff;
        color: var(--lcr-text);
        padding: 9px 10px;
        text-align: left;
        cursor: pointer;
        font: inherit;
      }

      #${UI.header}:hover,
      #${UI.header}:focus-visible {
        background: var(--lcr-soft);
        outline: none;
      }

      .lcr-pulse {
        width: 8px;
        height: 8px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: var(--lcr-accent);
        box-shadow: 0 0 0 3px rgba(59, 111, 147, .12);
      }

      .lcr-heading {
        min-width: 0;
        flex: 1;
      }

      .lcr-heading strong {
        display: block;
        font-size: 12px;
        line-height: 1.2;
      }

      .lcr-heading small {
        display: block;
        margin-top: 2px;
        color: var(--lcr-muted);
        font-size: 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .lcr-count {
        min-width: 20px;
        height: 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: #e9f1f6;
        color: #315e7d;
        padding: 0 6px;
        box-sizing: border-box;
        font-weight: 700;
        font-size: 10px;
      }

      .lcr-chevron {
        color: var(--lcr-muted);
        font-size: 12px;
        transition: transform .12s ease;
      }

      #${UI.root}.is-expanded .lcr-chevron { transform: rotate(180deg); }

      .lcr-preview {
        border-top: 1px solid #e4eaee;
        background: #fff;
      }

      .lcr-preview .lcr-item:nth-child(n+3) { display: none; }

      #${UI.panel} {
        display: none;
        border-top: 1px solid #dfe7ec;
        background: #fff;
      }

      #${UI.root}.is-expanded .lcr-preview { display: none; }
      #${UI.root}.is-expanded #${UI.panel} { display: block; }

      #${UI.list} {
        max-height: min(52vh, 430px);
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      .lcr-item {
        display: block;
        position: relative;
        box-sizing: border-box;
        padding: 9px 10px 9px 13px;
        border-bottom: 1px solid #edf1f3;
        color: inherit;
        text-decoration: none;
        background: #fff;
      }

      .lcr-item::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: #8ca8ba;
      }

      .lcr-item[data-kind='cancelled']::before,
      .lcr-item[data-kind='removed']::before { background: #b55a4e; }
      .lcr-item[data-kind='restored']::before,
      .lcr-item[data-kind='added']::before { background: #5f8d69; }
      .lcr-item[data-kind='room']::before,
      .lcr-item[data-kind='time']::before { background: #b2873d; }

      a.lcr-item:hover,
      a.lcr-item:focus-visible {
        background: #f7f9fa;
        outline: none;
      }

      .lcr-item-top {
        display: flex;
        align-items: baseline;
        gap: 7px;
      }

      .lcr-kind {
        flex: 0 0 auto;
        color: var(--lcr-muted);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: .04em;
        text-transform: uppercase;
      }

      .lcr-title {
        min-width: 0;
        flex: 1;
        font-size: 11px;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lcr-detail {
        margin-top: 3px;
        color: #425764;
        font-size: 10.5px;
        overflow-wrap: anywhere;
      }

      .lcr-meta {
        margin-top: 4px;
        color: #788791;
        font-size: 9.5px;
      }

      .lcr-empty {
        padding: 14px 12px;
        color: var(--lcr-muted);
        text-align: center;
        font-size: 10.5px;
      }

      .lcr-footer {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 7px;
        align-items: center;
        padding: 8px 9px;
        background: var(--lcr-soft);
      }

      #${UI.status} {
        min-width: 0;
        color: var(--lcr-muted);
        font-size: 9.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .lcr-action {
        border: 1px solid #c6d1d8;
        border-radius: 6px;
        background: #fff;
        color: #3c5667;
        padding: 4px 7px;
        cursor: pointer;
        font: 600 9.5px/1.2 Arial, Helvetica, sans-serif;
      }

      .lcr-action:hover,
      .lcr-action:focus-visible {
        background: #edf3f6;
        outline: none;
      }

      .lcr-action[disabled] {
        opacity: .55;
        cursor: default;
      }

      @media (max-width: 900px) {
        #${UI.root}:not(.is-expanded) {
          width: auto;
          max-width: calc(100vw - 20px);
          border-radius: 999px 0 0 999px;
          right: 0;
        }

        #${UI.root}:not(.is-expanded) #${UI.header} {
          width: auto;
          padding: 7px 9px 7px 10px;
        }

        #${UI.root}:not(.is-expanded) .lcr-heading,
        #${UI.root}:not(.is-expanded) .lcr-chevron,
        #${UI.root}:not(.is-expanded) .lcr-preview {
          display: none;
        }

        #${UI.root}.is-expanded {
          width: min(326px, calc(100vw - 20px));
          right: 10px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        #${UI.root} *, #${UI.root} *::before, #${UI.root} *::after {
          transition: none !important;
        }
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function installHud() {
    if (document.getElementById(UI.root)) return;

    const root = document.createElement('aside');
    root.id = UI.root;
    root.setAttribute('aria-label', 'Lectio Change Radar');

    const header = document.createElement('button');
    header.id = UI.header;
    header.type = 'button';
    header.setAttribute('aria-expanded', 'false');
    header.addEventListener('click', () => {
      runtime.pinned = !runtime.pinned;
      if (runtime.pinned) markViewed();
      renderHud();
    });

    root.addEventListener('mouseenter', () => {
      runtime.hovered = true;
      renderHud();
    });

    root.addEventListener('mouseleave', () => {
      runtime.hovered = false;
      renderHud();
    });

    root.addEventListener('focusin', () => {
      runtime.hovered = true;
      renderHud();
    });

    root.addEventListener('focusout', (event) => {
      if (!root.contains(event.relatedTarget)) {
        runtime.hovered = false;
        renderHud();
      }
    });

    document.body.appendChild(root);
  }

  function renderHud() {
    const root = document.getElementById(UI.root);
    if (!root) return;

    const history = runtime.state?.history || [];
    const lastViewed = readNumber(STORAGE.lastViewed);
    const unseen = history.filter((item) => Number(item.noticedAt) > lastViewed).length;
    const expanded = runtime.pinned || runtime.hovered;

    root.classList.toggle('is-expanded', expanded);
    root.classList.toggle('has-unseen', unseen > 0);
    root.classList.toggle('is-error', Boolean(runtime.lastError));

    const latest = history.slice(0, 2);
    const headerSubtext = runtime.lastError
      ? runtime.lastError
      : runtime.inFlight
        ? 'Checking timetable...'
        : history.length
          ? `${history.length} recent change${history.length === 1 ? '' : 's'}`
          : runtime.state?.snapshot
            ? 'Watching this week + next'
            : 'Starting watcher...';

    root.replaceChildren();

    const header = document.createElement('button');
    header.id = UI.header;
    header.type = 'button';
    header.setAttribute('aria-expanded', String(expanded));
    header.innerHTML = `
      <span class="lcr-pulse" aria-hidden="true"></span>
      <span class="lcr-heading">
        <strong>Change Radar</strong>
        <small>${escapeHtml(headerSubtext)}</small>
      </span>
      <span class="lcr-count" title="${unseen} unseen change${unseen === 1 ? '' : 's'}">${unseen || history.length}</span>
      <span class="lcr-chevron" aria-hidden="true">▾</span>
    `;
    header.addEventListener('click', () => {
      runtime.pinned = !runtime.pinned;
      if (runtime.pinned) markViewed();
      renderHud();
    });
    root.appendChild(header);

    const preview = document.createElement('div');
    preview.className = 'lcr-preview';
    if (latest.length) {
      latest.forEach((item) => preview.appendChild(renderHistoryItem(item)));
    } else {
      const empty = document.createElement('div');
      empty.className = 'lcr-empty';
      empty.textContent = runtime.state?.snapshot
        ? 'No timetable changes noticed yet.'
        : 'Creating the first timetable baseline.';
      preview.appendChild(empty);
    }
    root.appendChild(preview);

    const panel = document.createElement('div');
    panel.id = UI.panel;

    const list = document.createElement('div');
    list.id = UI.list;
    if (history.length) {
      history.forEach((item) => list.appendChild(renderHistoryItem(item)));
    } else {
      const empty = document.createElement('div');
      empty.className = 'lcr-empty';
      empty.textContent = runtime.state?.snapshot
        ? 'No changes in the log. The radar keeps the newest 10.'
        : 'First check creates a baseline; later differences become log entries.';
      list.appendChild(empty);
    }
    panel.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'lcr-footer';

    const status = document.createElement('div');
    status.id = UI.status;
    status.textContent = getStatusText();
    footer.appendChild(status);

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'lcr-action';
    refreshButton.textContent = runtime.inFlight ? 'Checking...' : 'Refresh';
    refreshButton.disabled = runtime.inFlight;
    refreshButton.addEventListener('click', (event) => {
      event.stopPropagation();
      void refresh({ reason: 'manual', force: true });
    });
    footer.appendChild(refreshButton);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'lcr-action';
    clearButton.textContent = 'Clear';
    clearButton.disabled = history.length === 0;
    clearButton.title = 'Clear the recent-change log but keep the current timetable baseline.';
    clearButton.addEventListener('click', (event) => {
      event.stopPropagation();
      clearHistory();
    });
    footer.appendChild(clearButton);

    panel.appendChild(footer);
    root.appendChild(panel);
  }

  function renderHistoryItem(item) {
    const tag = item.url ? 'a' : 'div';
    const node = document.createElement(tag);
    node.className = 'lcr-item';
    node.dataset.kind = item.kind || 'changed';

    if (item.url) {
      node.href = item.url;
      node.title = 'Open activity in Lectio';
    }

    const when = formatHistoryEventTime(item);
    const noticed = formatNoticed(item.noticedAt);

    node.innerHTML = `
      <div class="lcr-item-top">
        <span class="lcr-kind">${escapeHtml(kindLabel(item.kind))}</span>
        <span class="lcr-title">${escapeHtml(item.title || 'Lectio activity')}</span>
      </div>
      <div class="lcr-detail">${escapeHtml(item.detail || 'Schedule changed')}</div>
      <div class="lcr-meta">${escapeHtml(when)}${when && noticed ? ' · ' : ''}${escapeHtml(noticed)}</div>
    `;

    return node;
  }

  function markViewed() {
    writeNumber(STORAGE.lastViewed, Date.now());
  }

  function clearHistory() {
    if (!runtime.state) return;
    runtime.state = {
      ...runtime.state,
      history: []
    };
    saveState(runtime.state);
    markViewed();
    renderHud();
  }

  function getStatusText() {
    if (runtime.lastError) return runtime.lastError;
    if (runtime.inFlight) return 'Checking now...';
    const checkedAt = Number(runtime.state?.checkedAt || 0);
    if (!checkedAt) return 'Waiting for first check';
    return `Checked ${formatClock(checkedAt)} · every 10 min`;
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE.state) || 'null');
      if (!parsed || parsed.version !== 1) return null;
      if (!parsed.snapshot || typeof parsed.snapshot.events !== 'object') return null;
      return {
        ...parsed,
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, CONFIG.maxHistory) : []
      };
    } catch (_) {
      return null;
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE.state, JSON.stringify(state));
    } catch (_) {}
  }

  function readNumber(key) {
    try {
      return Number(localStorage.getItem(key) || 0) || 0;
    } catch (_) {
      return 0;
    }
  }

  function writeNumber(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_) {}
  }

  function getSchoolId() {
    const match = location.pathname.match(/^\/lectio\/(\d+)(?:\/|$)/i);
    return match ? match[1] : '';
  }

  function detectIdentity() {
    const candidates = [];
    const startUrl = document.querySelector('meta[name="msapplication-starturl"]')?.getAttribute('content');
    if (startUrl) candidates.push(startUrl);
    candidates.push(location.href);

    const formAction = document.querySelector('form#aspnetForm')?.getAttribute('action');
    if (formAction) candidates.push(formAction);

    for (const anchor of document.querySelectorAll('a[href*="laererid="], a[href*="elevid="]')) {
      candidates.push(anchor.getAttribute('href'));
      if (candidates.length >= 8) break;
    }

    for (const candidate of candidates) {
      try {
        const url = new URL(candidate, location.origin);
        const teacherId = url.searchParams.get('laererid');
        if (teacherId) return `teacher-${safeKey(teacherId)}`;
        const studentId = url.searchParams.get('elevid');
        if (studentId) return `student-${safeKey(studentId)}`;
      } catch (_) {}
    }

    return 'current-user';
  }

  function getActivityId(brick) {
    const href = brick.getAttribute('href') || '';
    const hrefMatch = href.match(/[?&]absid=(\d+)/i);
    if (hrefMatch) return `ABS${hrefMatch[1]}`;

    const brikId = brick.getAttribute('data-brikid') || '';
    const brickMatch = brikId.match(/ABS(\d+)/i);
    if (brickMatch) return `ABS${brickMatch[1]}`;

    return '';
  }

  function extractField(lines, pattern) {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) return cleanText(match[1]);
    }
    return '';
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanMultiline(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(cleanText)
      .filter(Boolean)
      .join('\n');
  }

  function normalizeCompare(value) {
    return cleanText(value).toLocaleLowerCase('da-DK');
  }

  function scheduleSuffix(event) {
    const when = formatEventWhen(event);
    return when ? ` · ${when}` : '';
  }

  function formatEventWhen(event) {
    const date = formatShortDate(event.dateIso);
    if (!date) return '';
    if (event.allDay) return `${date}, all day`;
    if (event.start && event.end) return `${date}, ${event.start}-${event.end}`;
    if (event.start) return `${date}, ${event.start}`;
    return date;
  }

  function formatHistoryEventTime(item) {
    const date = formatShortDate(item.eventDate);
    if (!date) return '';
    if (item.eventStart && item.eventEnd) return `${date} ${item.eventStart}-${item.eventEnd}`;
    if (item.eventStart) return `${date} ${item.eventStart}`;
    return date;
  }

  function formatShortDate(isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return '';
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      }).format(date);
    } catch (_) {
      return `${day}/${month}`;
    }
  }

  function formatNoticed(timestamp) {
    if (!timestamp) return '';
    const then = new Date(timestamp);
    const now = new Date();
    const sameDay = then.getFullYear() === now.getFullYear()
      && then.getMonth() === now.getMonth()
      && then.getDate() === now.getDate();

    if (sameDay) return `noticed ${formatClock(timestamp)}`;

    try {
      const day = new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short'
      }).format(then);
      return `noticed ${day} ${formatClock(timestamp)}`;
    } catch (_) {
      return `noticed ${then.toLocaleString()}`;
    }
  }

  function formatClock(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return '';
    }
  }

  function kindLabel(kind) {
    const labels = {
      cancelled: 'Cancelled',
      restored: 'Restored',
      time: 'Time',
      room: 'Room',
      added: 'Added',
      removed: 'Removed',
      changed: 'Changed'
    };
    return labels[kind] || 'Changed';
  }

  function friendlyError(error) {
    if (error?.name === 'AbortError') return 'Schedule check timed out';
    const text = cleanText(error?.message || error || 'Could not check timetable');
    return text.length > 70 ? `${text.slice(0, 67)}...` : text;
  }

  function isDateInside(dateIso, startIso, endIso) {
    if (!dateIso || !startIso || !endIso) return false;
    return dateIso >= startIso && dateIso <= endIso;
  }

  function startOfIsoWeek(date) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = copy.getDay() || 7;
    copy.setDate(copy.getDate() - day + 1);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function getIsoWeekInfo(date) {
    const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const year = utc.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return { year, week };
  }

  function addDays(date, days) {
    const copy = new Date(date.getTime());
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function toIsoDate(date) {
    const year = date.getFullYear();
    return `${year}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function safeKey(value) {
    return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
  }

  function simpleHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
