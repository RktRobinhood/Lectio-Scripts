// ==UserScript==
// @name         Lectio Change Radar
// @namespace    https://github.com/RktRobinhood/Lectio-Scripts
// @version      0.5.0
// @description  Watches Lectio for the changes you choose to track - timetable, assignments, absence, documents - and keeps a compact recent-change HUD.
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
    version: '0.5.0',
    channel: 'unstable'
  });

  const MANAGER_DISABLED_KEY = 'lectioManager.disabledModules.v1';

  const BASE_CONFIG = Object.freeze({
    minRefreshGapMs: 90 * 1000,
    fetchTimeoutMs: 20 * 1000,
    autoSeenDelayMs: 1200
  });

  const DISPLAY_MODES = Object.freeze(['auto', 'dock', 'floating']);
  // Bumped when a stored setting needs rewriting rather than merely
  // re-defaulting. Schema 2 introduced displayMode: 'auto'.
  const SETTINGS_SCHEMA = 2;

  const DEFAULT_SETTINGS = Object.freeze({
    displayMode: 'auto',
    pollMinutes: 10,
    weeksAhead: 1,
    urgentHours: 24,
    recentHours: 24,
    attentionAnimation: true,
    hoverOpen: true,
    historyLimit: 10,

    // What the radar watches. Every tracker is a plain boolean so the Manager
    // renders it as a generic toggle and the module stays the only thing that
    // knows what any of them mean.
    trackCancellations: true,
    trackTimeChanges: true,
    trackRoomChanges: true,
    trackTeacherChanges: true,
    trackAddedLessons: true,
    trackRemovedLessons: true,
    trackHomework: true,
    trackLessonNotes: false,
    trackLessonDetails: false,

    trackAssignments: true,
    trackNewAssignments: true,
    trackAssignmentDeadlines: true,
    trackAssignmentStatus: false,

    trackAbsence: false,
    trackAbsenceRegistrations: true,
    trackAbsencePercent: false,

    trackDocuments: false,
    trackNewDocuments: true,
    trackDocumentUpdates: false
  });

  // Sources beyond the timetable each cost their own request per check, so they
  // are gated by a master toggle and run on a much slower cadence than the
  // timetable poll. Nothing here is fetched unless its gate is on.
  const EXTRA_SOURCES = Object.freeze([
    Object.freeze({ key: 'assignments', gate: 'trackAssignments', label: 'Assignments' }),
    Object.freeze({ key: 'absence', gate: 'trackAbsence', label: 'Absence' }),
    Object.freeze({ key: 'documents', gate: 'trackDocuments', label: 'Documents' })
  ]);

  const EXTRA_SOURCE_MIN_GAP_MS = 30 * 60 * 1000;

  // Every boolean default is a toggle, so the sanitiser and the coercer derive
  // their key list rather than carrying a hand-maintained copy that a new
  // tracker would silently fall out of.
  const BOOLEAN_SETTING_KEYS = Object.freeze(
    Object.keys(DEFAULT_SETTINGS).filter((key) => typeof DEFAULT_SETTINGS[key] === 'boolean')
  );

  // A Lectio layout change can make a parser match far more rows than it should.
  // Capping per source means structural drift shows up as a handful of odd
  // entries rather than a log flooded past everything real.
  const MAX_CHANGES_PER_SOURCE = 12;

  // Shared with the tooltip block reader: these are the field labels Lectio puts
  // at the start of a tooltip line, and they mark where one field's text stops.
  const TOOLTIP_FIELD_PATTERN = /^(?:Hold|Lærer|Laerer|Teacher|Teachers|Lokale|Lokaler|Room|Rooms|Elever|Students|Grupper|Groups|Ressourcer|Resources|Lektier|Homework|Note|Noter|Øvrigt indhold|Other content)\s*:/i;

  // The Danish 7-point scale, as a closed set. Matching a grade against a fixed
  // list rather than "a number in a cell" keeps room numbers and counts out.
  const GRADE_TOKENS = Object.freeze(['-3', '00', '02', '4', '7', '10', '12']);

  const SETTING_SCHEMA = Object.freeze([
    makeSelectSetting('displayMode', 'Radar location', 'Where the radar lives. Automatic uses Lectio Manager\'s shared dock when the Manager is installed, and falls back to a floating radar when it is not.', 'auto', [
      ['auto', 'Automatic'], ['dock', 'Always the Manager dock'], ['floating', 'Always floating on the page']
    ], 'Radar'),
    makeSelectSetting('urgentHours', 'Urgent window', 'An unseen change to an activity inside this window turns the radar red.', 24, [
      [6, 'Next 6 hours'], [12, 'Next 12 hours'], [24, 'Next 24 hours'], [48, 'Next 48 hours']
    ], 'Radar'),
    makeSelectSetting('recentHours', 'Recent-change window', 'After changes are seen, keep the radar amber for this long before returning to green.', 24, [
      [12, '12 hours'], [24, '24 hours'], [48, '48 hours'], [72, '72 hours']
    ], 'Radar'),
    makeToggleSetting('attentionAnimation', 'Urgent animation', 'Pulse the radar signal when an urgent unseen change needs attention.', true, 'Radar'),
    makeToggleSetting('hoverOpen', 'Open on hover', 'Open the change log when the pointer rests on the radar. Click still pins it open.', true, 'Radar'),
    makeSelectSetting('historyLimit', 'History size', 'Maximum number of recent changes kept in the rotating local log.', 10, [
      [5, '5 changes'], [10, '10 changes'], [20, '20 changes']
    ], 'Radar'),

    makeSelectSetting('pollMinutes', 'Check frequency', 'How often Change Radar checks Lectio while a Lectio tab is open.', 10, [
      [5, 'Every 5 minutes'], [10, 'Every 10 minutes'], [15, 'Every 15 minutes'], [30, 'Every 30 minutes']
    ], 'Checking'),
    makeSelectSetting('weeksAhead', 'Weeks to watch', 'How far ahead the radar snapshots your timetable.', 1, [
      [0, 'This week only'], [1, 'This week + next'], [2, 'This week + 2 weeks']
    ], 'Checking'),

    makeToggleSetting('trackCancellations', 'Cancellations', 'Report a lesson being cancelled, and a cancellation later being lifted.', true, 'Timetable'),
    makeToggleSetting('trackTimeChanges', 'Time and date moves', 'Report a lesson moving to a different day, start time, or end time.', true, 'Timetable'),
    makeToggleSetting('trackRoomChanges', 'Room changes', 'Report a lesson moving to a different room.', true, 'Timetable'),
    makeToggleSetting('trackTeacherChanges', 'Teacher changes', 'Report a different teacher being put on a lesson, such as a substitute.', true, 'Timetable'),
    makeToggleSetting('trackAddedLessons', 'Lessons added', 'Report an activity appearing in a week the radar was already watching.', true, 'Timetable'),
    makeToggleSetting('trackRemovedLessons', 'Lessons removed', 'Report an activity disappearing from a week the radar is watching. That is not the same as a cancellation, which leaves the lesson visible.', true, 'Timetable'),
    makeToggleSetting('trackHomework', 'Homework', 'Report homework (Lektier) being set, changed, or cleared on a lesson.', true, 'Timetable'),
    makeToggleSetting('trackLessonNotes', 'Notes and other content', 'Report changes to a lesson\'s note or its other-content field. These get edited often, so this is off by default.', false, 'Timetable'),
    makeToggleSetting('trackLessonDetails', 'Other lesson details', 'Report changes to a lesson\'s class, title, resources, or participants, and changes Lectio flags without saying what changed. Off by default because most of these are administrative.', false, 'Timetable'),

    makeToggleSetting('trackAssignments', 'Watch assignments', 'Check your assignment list as well as your timetable. Costs one extra request per check, at most twice an hour.', true, 'Assignments'),
    makeToggleSetting('trackNewAssignments', 'New assignments', 'Report an assignment appearing on your list.', true, 'Assignments'),
    makeToggleSetting('trackAssignmentDeadlines', 'Deadline changes', 'Report an assignment deadline moving.', true, 'Assignments'),
    makeToggleSetting('trackAssignmentStatus', 'Status and grades', 'Report an assignment changing status, or a grade being published for one.', false, 'Assignments'),

    makeToggleSetting('trackAbsence', 'Watch absence', 'Check your absence page as well as your timetable. Costs one extra request per check, at most twice an hour. Off by default.', false, 'Absence'),
    makeToggleSetting('trackAbsenceRegistrations', 'New registrations', 'Report a new absence registration appearing against you.', true, 'Absence'),
    makeToggleSetting('trackAbsencePercent', 'Percentage changes', 'Report your absence percentage moving for a class. That shifts on its own as lessons pass, so it is off by default.', false, 'Absence'),

    makeToggleSetting('trackDocuments', 'Watch documents', 'Check your document overview as well as your timetable. Costs one extra request per check, at most twice an hour. Off by default.', false, 'Documents'),
    makeToggleSetting('trackNewDocuments', 'New documents', 'Report a document appearing in your overview.', true, 'Documents'),
    makeToggleSetting('trackDocumentUpdates', 'Document updates', 'Report an existing document being replaced or renamed.', false, 'Documents')
  ]);

  const UI = Object.freeze({
    root: 'lectio-change-radar',
    style: 'lectio-change-radar-style',
    button: 'lectio-change-radar-button',
    panel: 'lectio-change-radar-panel',
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
    lastViewed: `${storageBase}.lastViewed`,
    settings: `${storageBase}.settings`
  });

  // detectIdentity() already resolves which kind of account this is; the absence
  // page is the one source whose URL differs between the two.
  const userRole = identity.startsWith('teacher-') ? 'teacher' : 'student';

  const runtime = {
    state: null,
    settings: null,
    inFlight: false,
    pinned: false,
    hovered: false,
    settingsOpen: false,
    timer: null,
    viewTimer: null,
    dockMount: null,
    managerSeen: false,
    graceTimer: null,
    settingsRefreshTimer: null,
    lastError: ''
  };

  // The Manager announces itself by asking every module to register. Automatic
  // mode waits that long before falling back to a floating radar, so a page with
  // the Manager installed does not flash a floating HUD that then jumps away.
  const MANAGER_GRACE_MS = 2500;
  const loadedAt = Date.now();

  runtime.settings = loadSettings();
  runtime.state = loadState();

  registerWithManager();
  window.addEventListener('lectio-manager:discover', handleDiscovery);
  window.addEventListener('lectio-manager:set-setting', handleManagerSettingsEvent);
  window.addEventListener('lectio-manager:dock:render-panel', handleDockPanelRender);
  window.addEventListener('pagehide', () => {
    removeDockItem();
    window.clearInterval(runtime.timer);
    window.clearTimeout(runtime.viewTimer);
    window.clearTimeout(runtime.graceTimer);
  }, { once: true });

  for (const eventName of [
    'lectio-manager:setting-change',
    'lectio-manager:settings-change',
    'lectio-manager:update-setting',
    'lectio-module:setting-change',
    'lectio-module:update-settings'
  ]) {
    window.addEventListener(eventName, handleManagerSettingsEvent);
  }

  if (!isManagerPaused()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }

  function makeSelectSetting(key, label, description, defaultValue, pairs, section) {
    const options = pairs.map(([value, optionLabel]) => ({ value, label: optionLabel }));
    return {
      id: key,
      key,
      section,
      type: 'select',
      control: 'select',
      kind: 'select',
      label,
      description,
      default: defaultValue,
      defaultValue,
      options,
      choices: options
    };
  }

  function makeToggleSetting(key, label, description, defaultValue, section) {
    return {
      id: key,
      key,
      section,
      type: 'toggle',
      control: 'toggle',
      kind: 'toggle',
      inputType: 'checkbox',
      label,
      description,
      default: defaultValue,
      defaultValue
    };
  }

  function registerWithManager() {
    const currentValues = { ...runtime.settings };
    const apply = (key, value) => applySetting(key, value, { source: 'manager-callback' });
    const applyMany = (values) => applySettings(values, { source: 'manager-callback' });

    window.dispatchEvent(new CustomEvent('lectio-module:register', {
      detail: {
        id: MODULE.id,
        aliases: MODULE.aliases,
        name: MODULE.name,
        version: MODULE.version,
        channel: MODULE.channel,
        settingsSchema: SETTING_SCHEMA.map((item) => ({ ...item, value: currentValues[item.key] })),
        currentValues,
        settings: currentValues,
        setSetting: apply,
        applySetting: apply,
        updateSettings: applyMany,
        enabled: !isManagerPaused(),
        capabilities: {
          pause: true,
          managerPause: true
        }
      }
    }));

    // The Manager can be installed after this script has already rendered.
    // Re-advertise the dock item when its discovery request arrives.
    if (document.getElementById(UI.style)) renderHud();
  }

  function isManagerPaused() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MANAGER_DISABLED_KEY) || '[]');
      return Array.isArray(parsed) && parsed.includes(MODULE.id);
    } catch (_) {
      return false;
    }
  }

  function init() {
    if (!document.body) return;

    installStyles();
    syncTheme();
    installThemeObserver();
    renderHud();

    void refresh({ reason: 'startup' });
    restartPollTimer();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        syncTheme();
        const lastPoll = readNumber(STORAGE.lastPoll);
        if (Date.now() - lastPoll >= getPollMs()) {
          void refresh({ reason: 'visible' });
        }
      }
    });

    window.addEventListener('storage', (event) => {
      if (![STORAGE.state, STORAGE.lastViewed, STORAGE.settings].includes(event.key)) return;
      runtime.settings = loadSettings();
      runtime.state = loadState();
      restartPollTimer();
      renderHud();
      registerWithManager();
    });

    // Give the Manager more than one opportunity to discover the module.
    window.setTimeout(registerWithManager, 500);
    window.setTimeout(registerWithManager, 1500);
  }

  function restartPollTimer() {
    if (runtime.timer) window.clearInterval(runtime.timer);
    runtime.timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh({ reason: 'interval' });
      }
    }, getPollMs());
  }

  function getPollMs() {
    return Math.max(5, Number(runtime.settings?.pollMinutes) || DEFAULT_SETTINGS.pollMinutes) * 60 * 1000;
  }

  function getHistoryLimit() {
    return Math.max(5, Math.min(20, Number(runtime.settings?.historyLimit) || DEFAULT_SETTINGS.historyLimit));
  }

  function handleManagerSettingsEvent(event) {
    const detail = event?.detail;
    if (!detail || typeof detail !== 'object') return;

    const moduleRef = detail.moduleId || detail.module?.id || detail.module || (detail.key ? detail.id : '');
    if (!moduleRef || (moduleRef !== MODULE.id && !MODULE.aliases.includes(moduleRef))) return;

    if (detail.values && typeof detail.values === 'object') {
      applySettings(detail.values, { source: 'manager-event' });
      return;
    }

    const key = detail.key || detail.settingId || detail.settingKey || detail.name;
    if (!key || !Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) return;
    applySetting(key, detail.value, { source: 'manager-event' });
  }

  function applySetting(key, value, { source = 'local' } = {}) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) return false;
    return applySettings({ [key]: value }, { source });
  }

  function applySettings(values, { source = 'local' } = {}) {
    if (!values || typeof values !== 'object') return false;
    const before = runtime.settings;
    const next = sanitizeSettings({ ...before, ...values });
    const changed = Object.keys(next).some((key) => next[key] !== before[key]);
    if (!changed) return false;

    runtime.settings = next;
    saveSettings(next);

    if (next.historyLimit !== before.historyLimit && runtime.state?.history) {
      runtime.state = { ...runtime.state, history: runtime.state.history.slice(0, getHistoryLimit()) };
      saveState(runtime.state);
    }

    if (next.pollMinutes !== before.pollMinutes) restartPollTimer();

    const watchChanged = BOOLEAN_SETTING_KEYS
      .filter((key) => key.startsWith('track'))
      .some((key) => next[key] !== before[key]);

    if (next.weeksAhead !== before.weeksAhead || watchChanged) {
      // Debounced: ticking several trackers in a row is one intent, not one
      // full re-check per checkbox.
      scheduleSettingsRefresh();
    }

    renderHud();
    registerWithManager();
    window.dispatchEvent(new CustomEvent('lectio-module:settings-updated', {
      detail: { id: MODULE.id, source, currentValues: { ...runtime.settings } }
    }));
    return true;
  }

  function scheduleSettingsRefresh() {
    if (runtime.settingsRefreshTimer) window.clearTimeout(runtime.settingsRefreshTimer);
    runtime.settingsRefreshTimer = window.setTimeout(() => {
      runtime.settingsRefreshTimer = null;
      void refresh({ reason: 'settings', force: true });
    }, 600);
  }

  async function refresh({ reason = 'manual', force = false } = {}) {
    if (runtime.inFlight) return;

    const now = Date.now();
    const lastPoll = readNumber(STORAGE.lastPoll);

    if (!force && reason !== 'manual' && now - lastPoll < BASE_CONFIG.minRefreshGapMs) {
      return;
    }

    runtime.inFlight = true;
    runtime.lastError = '';
    renderHud();

    try {
      const previous = runtime.state?.snapshot || null;
      const snapshot = await buildSnapshot(previous);

      if (!previous) {
        runtime.state = {
          version: 1,
          initializedAt: now,
          checkedAt: now,
          snapshot,
          history: []
        };
      } else {
        const changes = [
          ...compareSnapshots(previous, snapshot, now),
          ...compareSourceSnapshots(previous, snapshot, now)
        ];
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

  async function buildSnapshot(previous) {
    const now = new Date();
    const weekInfos = [];

    for (let offset = 0; offset <= (Number(runtime.settings.weeksAhead) || 0); offset += 1) {
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
    const rangeEnd = addDays(rangeStart, (((Number(runtime.settings.weeksAhead) || 0) + 1) * 7) - 1);

    return {
      capturedAt: Date.now(),
      rangeStart: toIsoDate(rangeStart),
      rangeEnd: toIsoDate(rangeEnd),
      events,
      sources: await buildSourceSnapshots(previous)
    };
  }

  // Sources beyond the timetable run one at a time, only when switched on, and
  // only when their own slower cadence has elapsed. A carried-forward capture
  // diffs against itself and so produces nothing, which is what lets one flaky
  // page fail without taking the timetable check down with it.
  async function buildSourceSnapshots(previous) {
    const carried = previous?.sources || {};
    const sources = {};
    const now = Date.now();

    for (const source of EXTRA_SOURCES) {
      if (!runtime.settings[source.gate]) continue;

      const existing = carried[source.key];
      if (existing && now - Number(existing.capturedAt || 0) < EXTRA_SOURCE_MIN_GAP_MS) {
        sources[source.key] = existing;
        continue;
      }

      const reader = getSourceReader(source.key);

      try {
        const records = reader.parse(await fetchLectioDocument(reader.url()));

        // A Lectio layout change can empty a parser that used to see rows. Keep
        // the last good capture rather than announcing that everything the user
        // had has just disappeared.
        if (existing && looksLikeParseFailure(existing.records, records)) {
          sources[source.key] = existing;
          continue;
        }

        sources[source.key] = { capturedAt: now, records };
      } catch (_) {
        if (existing) sources[source.key] = existing;
      }
    }

    return sources;
  }

  function looksLikeParseFailure(before, after) {
    return Object.keys(before || {}).length >= 3 && Object.keys(after || {}).length === 0;
  }

  function compareSourceSnapshots(previous, current, noticedAt) {
    const changes = [];

    for (const source of EXTRA_SOURCES) {
      const before = previous?.sources?.[source.key]?.records;
      const after = current?.sources?.[source.key]?.records;

      // A missing previous capture means the source was only just switched on.
      // Its first read is a baseline, not a pile of news.
      if (!before || !after) continue;

      changes.push(
        ...getSourceReader(source.key).compare(before, after, noticedAt).slice(0, MAX_CHANGES_PER_SOURCE)
      );
    }

    return changes;
  }

  function getSourceReader(key) {
    if (key === 'assignments') {
      return {
        url: () => `/lectio/${schoolId}/OpgaveListe.aspx`,
        parse: parseAssignments,
        compare: compareAssignments
      };
    }

    if (key === 'absence') {
      return {
        url: () => `/lectio/${schoolId}/subnav/${userRole === 'teacher' ? 'fravaerlaerer' : 'fravaerelev'}.aspx`,
        parse: parseAbsence,
        compare: compareAbsence
      };
    }

    return {
      url: () => `/lectio/${schoolId}/DokumentOversigt.aspx`,
      parse: parseDocuments,
      compare: compareDocuments
    };
  }

  async function fetchScheduleWeek(weekInfo) {
    const url = `/lectio/${schoolId}/SkemaNy.aspx?week=${weekInfo.week}${weekInfo.year}&showtype=0`;
    return { doc: await fetchLectioDocument(url), url };
  }

  async function fetchLectioDocument(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), BASE_CONFIG.fetchTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Lectio request failed with HTTP ${response.status}.`);
      }

      if (/login\.aspx/i.test(response.url || '')) {
        throw new Error('Lectio login expired.');
      }

      const html = await response.text();
      if (/name=["']password["']/i.test(html) && /log ind|login/i.test(html)) {
        throw new Error('Lectio login expired.');
      }

      return new DOMParser().parseFromString(html, 'text/html');
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
    const resources = extractField(lines, /^(?:Ressourcer|Resources)\s*:\s*(.+)$/i);
    const participants = extractField(lines, /^(?:Elever|Students|Grupper|Groups)\s*:\s*(.+)$/i);
    // Homework, note and other content run on past their own line, so they are
    // read as a block up to the next field label rather than a single line.
    const homework = extractBlock(lines, /^(?:Lektier|Homework)\s*:\s*(.*)$/i);
    const note = extractBlock(lines, /^(?:Note|Noter)\s*:\s*(.*)$/i);
    const otherContent = extractBlock(lines, /^(?:Øvrigt indhold|Other content)\s*:\s*(.*)$/i);
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
      resources,
      participants,
      homework,
      note,
      otherContent,
      status,
      tooltip,
      url: absoluteUrl
    };
  }

  // --- Sources beyond the timetable -----------------------------------------
  //
  // The timetable parser can lean on a known element (a.s2skemabrik[data-tooltip]).
  // These three pages are list views whose exact column layout is not pinned down
  // anywhere in this repo, so they are read by pattern rather than by position:
  // a row is interesting when it links to something carrying a stable Lectio id,
  // and its fields are recognised by shape (a d/m-yyyy date, a percentage, a
  // status word, a 7-point grade) wherever they happen to sit. That survives a
  // column being added or reordered, and when it does stop matching it yields
  // nothing rather than nonsense, which looksLikeParseFailure then absorbs.

  const ASSIGNMENT_STATUS_PATTERN = /^(?:Afleveret|Ikke afleveret|Mangler|Afventer|Venter|Afsluttet|Godkendt|Ikke godkendt|Handed in|Not handed in|Missing|Awaiting|Closed|Approved|Not approved)$/i;

  function harvestRows(doc, match) {
    const rows = {};

    for (const row of doc.querySelectorAll('tr')) {
      let id = '';
      let url = '';
      let title = '';

      for (const anchor of row.querySelectorAll('a[href]')) {
        const href = anchor.getAttribute('href') || '';
        const matched = match(href);
        if (!matched) continue;

        id = matched;
        title = cleanText(anchor.textContent || '');
        try { url = new URL(href, location.origin).href; } catch (_) {}
        break;
      }

      if (!id || rows[id]) continue;

      const cells = Array.from(row.querySelectorAll('td'))
        .map((cell) => cleanText(cell.textContent || ''))
        .filter(Boolean);

      rows[id] = { id, title: title || cells[0] || '', cells, url };
    }

    return rows;
  }

  function parseAssignments(doc) {
    const records = {};
    const rows = harvestRows(doc, (href) => {
      const match = href.match(/[?&]exerciseid=(\d+)/i);
      return match ? `EX${match[1]}` : '';
    });

    for (const row of Object.values(rows)) {
      const due = findRowDateTime(row.cells);
      records[row.id] = {
        id: row.id,
        title: row.title || 'Assignment',
        dueDate: due.dateIso,
        dueTime: due.time,
        status: findAssignmentStatus(row.cells),
        url: row.url
      };
    }

    return records;
  }

  function findRowDateTime(cells) {
    for (const cell of cells) {
      const match = cell.match(/\b(\d{1,2})\/(\d{1,2})-(\d{4})\b(?:\s+(\d{1,2}):(\d{2}))?/);
      if (!match) continue;

      return {
        dateIso: `${match[3]}-${pad2(Number(match[2]))}-${pad2(Number(match[1]))}`,
        time: match[4] != null ? `${pad2(Number(match[4]))}:${match[5]}` : ''
      };
    }

    return { dateIso: '', time: '' };
  }

  // A grade is matched against the closed 7-point scale rather than "a number in
  // a cell", so a room number or a count of anything cannot be read as one.
  function findAssignmentStatus(cells) {
    const parts = [];

    for (const cell of cells) {
      if (ASSIGNMENT_STATUS_PATTERN.test(cell)) parts.push(cell);
      else if (GRADE_TOKENS.includes(cell)) parts.push(`Grade ${cell}`);
    }

    return parts.join(' · ');
  }

  function parseAbsence(doc) {
    const records = {};

    // Individual registrations link to the day-based absence view. That URL was
    // read off a real Lectio page, so it is the firmest handle on this page.
    const rows = harvestRows(doc, (href) => {
      const match = href.match(/[?&]absenseId=(\d+)/i);
      return match ? `ABSENCE${match[1]}` : '';
    });

    for (const row of Object.values(rows)) {
      records[row.id] = {
        id: row.id,
        type: 'registration',
        title: row.title || row.cells[0] || 'Absence registration',
        detail: row.cells.slice(0, 4).join(' · '),
        url: row.url
      };
    }

    // Per-class percentages: any row carrying a hold context card and at least
    // one percentage. Keying on the card means a reordered table is not news.
    for (const row of doc.querySelectorAll('tr')) {
      const card = row.querySelector('[data-lectiocontextcard]');
      const cells = Array.from(row.querySelectorAll('td')).map((cell) => cleanText(cell.textContent || ''));
      const percents = cells.join(' ').match(/\d+(?:[,.]\d+)?\s?%/g);
      if (!percents?.length) continue;

      const label = cleanText(card?.textContent || cells[0] || '');
      if (!label) continue;

      const id = `ABSPCT${safeKey(card?.getAttribute('data-lectiocontextcard') || label)}`;
      if (records[id]) continue;

      records[id] = {
        id,
        type: 'percent',
        title: label,
        detail: percents.map((value) => value.replace(/\s+/g, '')).join(' / '),
        url: ''
      };
    }

    return records;
  }

  function parseDocuments(doc) {
    const records = {};
    const rows = harvestRows(doc, (href) => {
      if (!/dokument|document|showfile/i.test(href)) return '';
      const match = href.match(/[?&](?:documentid|dokumentid|fileid|id)=(\d+)/i);
      return match ? `DOC${match[1]}` : '';
    });

    for (const row of Object.values(rows)) {
      records[row.id] = {
        id: row.id,
        title: row.title || 'Document',
        detail: row.cells.slice(0, 4).join(' · '),
        url: row.url
      };
    }

    return records;
  }

  function compareAssignments(before, after, noticedAt) {
    const settings = runtime.settings || DEFAULT_SETTINGS;
    const changes = [];

    for (const [id, next] of Object.entries(after)) {
      const previous = before[id];

      // An assignment leaving the list is usually the list narrowing to what is
      // still current, so there is deliberately no "removed" tracker here.
      if (!previous) {
        if (settings.trackNewAssignments) {
          changes.push(makeSourceEntry({
            kind: 'assignment',
            title: next.title,
            detail: next.dueDate ? `New assignment, due ${formatDeadline(next)}` : 'New assignment',
            noticedAt,
            record: next
          }));
        }
        continue;
      }

      if (settings.trackAssignmentDeadlines && (previous.dueDate !== next.dueDate || previous.dueTime !== next.dueTime)) {
        changes.push(makeSourceEntry({
          kind: 'deadline',
          title: next.title,
          detail: `Deadline: ${formatDeadline(previous)} -> ${formatDeadline(next)}`,
          noticedAt,
          record: next
        }));
      }

      if (settings.trackAssignmentStatus && fieldChanged(previous.status, next.status)) {
        changes.push(makeSourceEntry({
          kind: 'status',
          title: next.title,
          detail: `Status: ${previous.status || 'none'} -> ${next.status || 'none'}`,
          noticedAt,
          record: next
        }));
      }
    }

    return changes;
  }

  function compareAbsence(before, after, noticedAt) {
    const settings = runtime.settings || DEFAULT_SETTINGS;
    const changes = [];

    for (const [id, next] of Object.entries(after)) {
      const previous = before[id];

      if (next.type === 'registration') {
        if (!previous && settings.trackAbsenceRegistrations) {
          changes.push(makeSourceEntry({
            kind: 'absence',
            title: next.title,
            detail: next.detail ? `New absence registration · ${truncate(next.detail, 70)}` : 'New absence registration',
            noticedAt,
            record: next
          }));
        }
        continue;
      }

      if (settings.trackAbsencePercent && previous && fieldChanged(previous.detail, next.detail)) {
        changes.push(makeSourceEntry({
          kind: 'absence',
          title: next.title,
          detail: `Absence: ${previous.detail || 'none'} -> ${next.detail || 'none'}`,
          noticedAt,
          record: next
        }));
      }
    }

    return changes;
  }

  function compareDocuments(before, after, noticedAt) {
    const settings = runtime.settings || DEFAULT_SETTINGS;
    const changes = [];

    for (const [id, next] of Object.entries(after)) {
      const previous = before[id];

      if (!previous) {
        if (settings.trackNewDocuments) {
          changes.push(makeSourceEntry({
            kind: 'document',
            title: next.title,
            detail: next.detail ? `New document · ${truncate(next.detail, 70)}` : 'New document',
            noticedAt,
            record: next
          }));
        }
        continue;
      }

      if (settings.trackDocumentUpdates && fieldChanged(previous.detail, next.detail)) {
        changes.push(makeSourceEntry({
          kind: 'document',
          title: next.title,
          detail: `Updated · ${truncate(next.detail, 70)}`,
          noticedAt,
          record: next
        }));
      }
    }

    return changes;
  }

  // Source records reuse the timetable history entry, so an assignment deadline
  // lands in eventDate/eventStart and is picked up by the existing urgency
  // window for free. A record with no date simply never counts as urgent.
  function makeSourceEntry({ kind, title, detail, noticedAt, record }) {
    return makeHistoryEntry({
      event: {
        id: record.id,
        dateIso: record.dueDate || '',
        start: record.dueTime || '',
        url: record.url || ''
      },
      kind,
      title,
      detail,
      noticedAt
    });
  }

  function formatDeadline(record) {
    if (!record?.dueDate) return 'no deadline';
    return record.dueTime ? `${formatShortDate(record.dueDate)} ${record.dueTime}` : formatShortDate(record.dueDate);
  }

  function compareSnapshots(previous, current, noticedAt) {
    const settings = runtime.settings || DEFAULT_SETTINGS;
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
      if (settings.trackAddedLessons && isDateInside(next.dateIso, previous.rangeStart, previous.rangeEnd) && next.dateIso >= today) {
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
      if (settings.trackRemovedLessons && isDateInside(before.dateIso, current.rangeStart, current.rangeEnd) && before.dateIso >= today) {
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
    const settings = runtime.settings || DEFAULT_SETTINGS;
    const details = [];
    let kind = 'changed';

    if (settings.trackCancellations) {
      if (next.status === 'cancelled' && before.status !== 'cancelled') {
        kind = 'cancelled';
        details.push('Cancelled');
      } else if (before.status === 'cancelled' && next.status !== 'cancelled') {
        kind = 'restored';
        details.push('Cancellation cleared');
      }
    }

    if (settings.trackTimeChanges &&
        (before.dateIso !== next.dateIso || before.start !== next.start || before.end !== next.end || before.allDay !== next.allDay)) {
      if (kind === 'changed') kind = 'time';
      details.push(`Time: ${formatEventWhen(before)} -> ${formatEventWhen(next)}`);
    }

    if (settings.trackRoomChanges && fieldChanged(before.room, next.room)) {
      if (kind === 'changed') kind = 'room';
      details.push(`Room: ${before.room || 'none'} -> ${next.room || 'none'}`);
    }

    if (settings.trackTeacherChanges && fieldChanged(before.teacher, next.teacher)) {
      if (kind === 'changed') kind = 'teacher';
      details.push(`Teacher: ${before.teacher || 'none'} -> ${next.teacher || 'none'}`);
    }

    if (settings.trackHomework && fieldChanged(before.homework, next.homework)) {
      if (kind === 'changed') kind = 'homework';
      details.push(`Homework ${summarizeFieldChange(before.homework, next.homework)}`);
    }

    if (settings.trackLessonNotes) {
      if (fieldChanged(before.note, next.note)) {
        if (kind === 'changed') kind = 'note';
        details.push(`Note ${summarizeFieldChange(before.note, next.note)}`);
      }
      if (fieldChanged(before.otherContent, next.otherContent)) {
        if (kind === 'changed') kind = 'note';
        details.push(`Other content ${summarizeFieldChange(before.otherContent, next.otherContent)}`);
      }
    }

    if (settings.trackLessonDetails) {
      if (fieldChanged(before.hold, next.hold)) {
        details.push(`Class: ${before.hold || 'none'} -> ${next.hold || 'none'}`);
      }
      if (fieldChanged(before.title, next.title)) {
        details.push(`Title: ${before.title || 'untitled'} -> ${next.title || 'untitled'}`);
      }
      if (fieldChanged(before.resources, next.resources)) {
        details.push(`Resources: ${before.resources || 'none'} -> ${next.resources || 'none'}`);
      }
      if (fieldChanged(before.participants, next.participants)) {
        details.push(`Participants: ${before.participants || 'none'} -> ${next.participants || 'none'}`);
      }

      // Lectio sometimes marks a brick changed even when the compact tooltip does
      // not expose which field changed. It belongs here because an unnamed change
      // is exactly the administrative noise this toggle governs.
      if (!details.length && next.status === 'changed' && before.status !== 'changed') {
        details.push('Lectio marked this activity as changed');
      }
    }

    // Nothing the user still tracks moved. Also covers a change marker simply
    // disappearing, which is often Lectio clearing its own visual state rather
    // than a user-relevant schedule change.
    if (!details.length) return null;

    return makeHistoryEntry({
      event: next,
      kind,
      title: next.title,
      detail: details.join(' · '),
      noticedAt
    });
  }

  function fieldChanged(before, next) {
    return normalizeCompare(before) !== normalizeCompare(next);
  }

  // Homework and notes are free text and can run long, so they are reported as
  // what happened plus a short excerpt rather than a full before/after pair.
  function summarizeFieldChange(before, next) {
    if (!cleanText(before) && cleanText(next)) return `set: ${truncate(next, 70)}`;
    if (cleanText(before) && !cleanText(next)) return 'cleared';
    return `changed: ${truncate(next, 70)}`;
  }

  function truncate(value, limit) {
    const text = cleanText(value);
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
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
    if (!changes.length) return history.slice(0, getHistoryLimit());

    const combined = [...changes.slice().reverse(), ...history];
    const seen = new Set();
    const deduped = [];

    for (const item of combined) {
      const key = `${item.eventId}|${item.kind}|${item.detail}|${item.noticedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
      if (deduped.length >= getHistoryLimit()) break;
    }

    return deduped;
  }

  function installStyles() {
    if (document.getElementById(UI.style)) return;

    const style = document.createElement('style');
    style.id = UI.style;
    style.textContent = `
      #${UI.root} {
        --lcr-surface: #ffffff;
        --lcr-text: #243746;
        --lcr-muted: #667783;
        --lcr-border: #c8d4dc;
        --lcr-soft: #f4f7f9;
        --lcr-signal: #3b9a58;
        --lcr-signal-rgb: 59, 154, 88;
        position: fixed;
        top: 92px;
        right: 12px;
        z-index: 2147482900;
        width: 42px;
        height: 42px;
        box-sizing: border-box;
        color: var(--lcr-text) !important;
        font: 12px/1.35 Arial, Helvetica, sans-serif;
      }

      #${UI.panel}.is-dock-panel {
        --lcr-surface: #ffffff;
        --lcr-text: #243746;
        --lcr-muted: #667783;
        --lcr-border: #c8d4dc;
        --lcr-soft: #f4f7f9;
        --lcr-signal: #3b9a58;
        --lcr-signal-rgb: 59, 154, 88;
        min-width: min(330px, calc(100vw - 48px));
        font: 12px/1.35 Arial, Helvetica, sans-serif;
      }

      #${UI.root}.state-yellow, #${UI.panel}.state-yellow { --lcr-signal: #d79619; --lcr-signal-rgb: 215, 150, 25; }
      #${UI.root}.state-red, #${UI.panel}.state-red { --lcr-signal: #d94b43; --lcr-signal-rgb: 217, 75, 67; }
      #${UI.root}.state-error, #${UI.panel}.state-error { --lcr-signal: #7a8790; --lcr-signal-rgb: 122, 135, 144; }

      #${UI.button} {
        position: relative;
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        box-sizing: border-box;
        border: 1px solid var(--lcr-border) !important;
        border-radius: 50%;
        background: var(--lcr-surface) !important;
        color: var(--lcr-signal) !important;
        box-shadow: 0 3px 12px rgba(0, 0, 0, .16);
        padding: 0;
        cursor: pointer;
        overflow: visible;
      }

      #${UI.button}:hover,
      #${UI.button}:focus-visible {
        background: var(--lcr-soft) !important;
        outline: 2px solid rgba(var(--lcr-signal-rgb), .22);
        outline-offset: 2px;
      }

      .lcr-radar-svg {
        width: 27px;
        height: 27px;
        display: block;
        overflow: visible;
      }

      .lcr-radar-svg path,
      .lcr-radar-svg circle,
      .lcr-radar-svg line {
        stroke: currentColor;
      }

      .lcr-radar-wave {
        opacity: .55;
        transform-origin: 15px 11px;
      }

      #${UI.root}.is-urgent-animated .lcr-radar-wave.wave-1 {
        animation: lcr-wave 1.45s ease-out infinite;
      }
      #${UI.root}.is-urgent-animated .lcr-radar-wave.wave-2 {
        animation: lcr-wave 1.45s .48s ease-out infinite;
      }

      #${UI.root}.is-urgent-animated #${UI.button} {
        animation: lcr-button-pulse 1.55s ease-in-out infinite;
      }

      @keyframes lcr-wave {
        0% { opacity: .78; transform: scale(.78); }
        75%, 100% { opacity: 0; transform: scale(1.28); }
      }

      @keyframes lcr-button-pulse {
        0%, 100% { box-shadow: 0 3px 12px rgba(0,0,0,.16), 0 0 0 0 rgba(var(--lcr-signal-rgb), .30); }
        50% { box-shadow: 0 3px 12px rgba(0,0,0,.16), 0 0 0 7px rgba(var(--lcr-signal-rgb), 0); }
      }

      .lcr-count-badge {
        position: absolute;
        top: -5px;
        right: -5px;
        min-width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        border: 2px solid var(--lcr-surface);
        border-radius: 999px;
        background: var(--lcr-signal) !important;
        color: #fff !important;
        padding: 0 4px;
        font: 800 9px/1 Arial, Helvetica, sans-serif;
      }

      .lcr-panel-wrap {
        position: absolute;
        top: 100%;
        right: 0;
        width: min(348px, calc(100vw - 24px));
        box-sizing: border-box;
        padding-top: 7px;
        display: none;
      }

      #${UI.root}.is-expanded .lcr-panel-wrap { display: block; }

      #${UI.panel} {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--lcr-border) !important;
        border-radius: 10px;
        background: var(--lcr-surface) !important;
        color: var(--lcr-text) !important;
        box-shadow: 0 10px 32px rgba(0, 0, 0, .22);
        overflow: hidden;
      }

      .lcr-panel-head {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 10px 11px 9px;
        border-bottom: 1px solid var(--lcr-border) !important;
        background: var(--lcr-surface) !important;
      }

      .lcr-status-dot {
        width: 9px;
        height: 9px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: var(--lcr-signal) !important;
        box-shadow: 0 0 0 3px rgba(var(--lcr-signal-rgb), .14);
      }

      .lcr-panel-heading { min-width: 0; flex: 1; }
      .lcr-panel-heading strong {
        display: block;
        color: var(--lcr-text) !important;
        font-size: 12px;
      }
      .lcr-panel-heading small {
        display: block;
        margin-top: 2px;
        color: var(--lcr-muted) !important;
        font-size: 10px;
      }

      .lcr-pin {
        border: 0;
        background: transparent !important;
        color: var(--lcr-muted) !important;
        padding: 4px 5px;
        cursor: pointer;
        font: 700 10px/1 Arial, Helvetica, sans-serif;
      }

      #${UI.list} {
        max-height: min(50vh, 420px);
        overflow-y: auto;
        overscroll-behavior: contain;
        background: var(--lcr-surface) !important;
      }

      .lcr-item {
        display: block;
        box-sizing: border-box;
        border: 0;
        border-bottom: 1px solid var(--lcr-border) !important;
        background: var(--lcr-surface) !important;
        color: var(--lcr-text) !important;
        padding: 9px 11px;
        text-decoration: none !important;
      }
      .lcr-item:last-child { border-bottom: 0 !important; }
      a.lcr-item:hover, a.lcr-item:focus-visible {
        background: var(--lcr-soft) !important;
        outline: none;
      }

      .lcr-item-top { display: flex; align-items: center; gap: 7px; }
      .lcr-kind {
        flex: 0 0 auto;
        color: var(--lcr-muted) !important;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: .045em;
        text-transform: uppercase;
      }
      .lcr-unseen {
        flex: 0 0 auto;
        border-radius: 999px;
        background: rgba(var(--lcr-signal-rgb), .13) !important;
        color: var(--lcr-signal) !important;
        padding: 2px 5px;
        font-size: 8px;
        font-weight: 800;
        letter-spacing: .04em;
      }
      .lcr-title {
        min-width: 0;
        flex: 1;
        color: var(--lcr-text) !important;
        font-size: 11px;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lcr-detail {
        margin-top: 3px;
        color: var(--lcr-text) !important;
        opacity: .90;
        font-size: 10.5px;
        overflow-wrap: anywhere;
      }
      .lcr-meta {
        margin-top: 4px;
        color: var(--lcr-muted) !important;
        font-size: 9.5px;
      }

      .lcr-empty {
        padding: 18px 12px;
        background: var(--lcr-surface) !important;
        color: var(--lcr-muted) !important;
        text-align: center;
        font-size: 10.5px;
      }

      .lcr-footer {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 9px;
        border-top: 1px solid var(--lcr-border) !important;
        background: var(--lcr-soft) !important;
      }
      #${UI.status} {
        min-width: 0;
        flex: 1;
        color: var(--lcr-muted) !important;
        font-size: 9.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .lcr-action {
        border: 1px solid var(--lcr-border) !important;
        border-radius: 6px;
        background: var(--lcr-surface) !important;
        color: var(--lcr-text) !important;
        padding: 4px 7px;
        cursor: pointer;
        font: 700 9.5px/1.2 Arial, Helvetica, sans-serif;
      }
      .lcr-action:hover, .lcr-action:focus-visible {
        background: var(--lcr-soft) !important;
        outline: none;
      }
      .lcr-action[disabled] { opacity: .52; cursor: default; }

      .lcr-settings {
        max-height: min(52vh, 430px);
        overflow-y: auto;
        padding: 8px 11px 10px;
        background: var(--lcr-surface) !important;
      }
      .lcr-setting-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        padding: 8px 0;
        border-bottom: 1px solid var(--lcr-border) !important;
      }
      .lcr-setting-row:last-child { border-bottom: 0 !important; }
      .lcr-setting-section {
        margin: 12px 0 0;
        padding-top: 8px;
        border-top: 1px solid var(--lcr-border) !important;
        color: var(--lcr-muted) !important;
        font: 600 9px/1.4 Roboto, Arial, sans-serif;
        letter-spacing: .09em;
        text-transform: uppercase;
      }
      .lcr-setting-section:first-child { margin-top: 0; padding-top: 0; border-top: 0 !important; }
      .lcr-setting-section + .lcr-setting-row { border-top: 0 !important; }
      .lcr-setting-copy strong {
        display: block;
        color: var(--lcr-text) !important;
        font-size: 10.5px;
      }
      .lcr-setting-copy small {
        display: block;
        margin-top: 2px;
        max-width: 215px;
        color: var(--lcr-muted) !important;
        font-size: 9px;
      }
      .lcr-setting-control {
        max-width: 132px;
        border: 1px solid var(--lcr-border) !important;
        border-radius: 5px;
        background: var(--lcr-surface) !important;
        color: var(--lcr-text) !important;
        padding: 4px 5px;
        font: 10px Arial, Helvetica, sans-serif;
      }
      .lcr-setting-toggle { width: 16px; height: 16px; accent-color: var(--lcr-signal); }

      @media (max-width: 600px) {
        #${UI.root} { top: 82px; right: 8px; }
        .lcr-panel-wrap { width: min(338px, calc(100vw - 16px)); right: -1px; }
      }

      @media (prefers-reduced-motion: reduce) {
        #${UI.root} *, #${UI.root} *::before, #${UI.root} *::after {
          animation: none !important;
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

    root.addEventListener('mouseenter', () => {
      if (!runtime.settings.hoverOpen) return;
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

  function radarSvg() {
    return `
      <svg class="lcr-radar-svg" viewBox="0 0 30 30" aria-hidden="true">
        <path d="M7.2 17.2c3.6 3.6 9.4 3.6 13 0l-6.5-6.5-6.5 6.5Z" fill="currentColor" fill-opacity=".13" stroke-width="1.6" stroke-linejoin="round"/>
        <line x1="13.7" y1="17.2" x2="10.7" y2="23.1" stroke-width="1.6" stroke-linecap="round"/>
        <line x1="8.6" y1="23.1" x2="13" y2="23.1" stroke-width="1.6" stroke-linecap="round"/>
        <circle cx="13.7" cy="10.7" r="1.55" fill="currentColor" stroke="none"/>
        <path class="lcr-radar-wave wave-1" d="M17.1 9.7c1.8.6 3.2 2 3.8 3.8" fill="none" stroke-width="1.55" stroke-linecap="round"/>
        <path class="lcr-radar-wave wave-2" d="M18.5 6.4c3.2 1.1 5.8 3.6 6.9 6.9" fill="none" stroke-width="1.55" stroke-linecap="round"/>
      </svg>`;
  }

  function handleDiscovery() {
    runtime.managerSeen = true;
    window.clearTimeout(runtime.graceTimer);
    runtime.graceTimer = null;
    registerWithManager();
  }

  // 'auto' resolves to the dock once the Manager has spoken, and to the floating
  // radar once it is clear no Manager is going to. 'waiting' is that short gap.
  function resolveDisplayMode() {
    const mode = runtime.settings.displayMode;
    if (mode === 'dock' || mode === 'floating') return mode;
    if (runtime.managerSeen) return 'dock';
    return Date.now() - loadedAt < MANAGER_GRACE_MS ? 'waiting' : 'floating';
  }

  function renderHud() {
    syncTheme();

    const history = runtime.state?.history || [];
    const lastViewed = readNumber(STORAGE.lastViewed);
    const status = getRadarState(history, lastViewed);
    const view = { status, history, lastViewed };
    const mode = resolveDisplayMode();

    if (mode === 'waiting') {
      document.getElementById(UI.root)?.remove();
      if (!runtime.graceTimer) {
        runtime.graceTimer = window.setTimeout(() => {
          runtime.graceTimer = null;
          renderHud();
        }, MANAGER_GRACE_MS - (Date.now() - loadedAt));
      }
      return;
    }

    if (mode === 'dock') {
      document.getElementById(UI.root)?.remove();
      registerDockItem(status);
      renderDockPanel(view);
      return;
    }

    removeDockItem();
    installHud();
    const root = document.getElementById(UI.root);
    if (!root) return;

    const expanded = runtime.pinned || runtime.hovered;

    root.className = `state-${status.level}`;
    root.classList.toggle('is-expanded', expanded);
    root.classList.toggle(
      'is-urgent-animated',
      status.level === 'red' && status.urgentUnseen > 0 && runtime.settings.attentionAnimation
    );

    root.replaceChildren();

    const button = document.createElement('button');
    button.id = UI.button;
    button.type = 'button';
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', status.ariaLabel);
    button.title = status.tooltip;
    button.innerHTML = radarSvg() + (status.unseen > 0
      ? `<span class="lcr-count-badge">${status.unseen > 9 ? '9+' : status.unseen}</span>`
      : '');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      runtime.pinned = !runtime.pinned;
      runtime.settingsOpen = false;
      renderHud();
    });
    root.appendChild(button);

    const wrap = document.createElement('div');
    wrap.className = 'lcr-panel-wrap';
    wrap.appendChild(buildRadarPanel(view, false));
    root.appendChild(wrap);

    scheduleAutoSeen(expanded && !runtime.settingsOpen, status.unseen);
  }

  function registerDockItem(status) {
    const state = status.level === 'red' || status.level === 'error'
      ? 'error'
      : status.level === 'yellow' ? 'warning' : 'default';

    window.dispatchEvent(new CustomEvent('lectio-manager:dock:register', {
      detail: {
        moduleId: MODULE.id,
        itemId: 'radar',
        type: 'panel',
        icon: 'radar',
        label: 'Lectio Change Radar',
        tooltip: status.tooltip,
        badge: status.unseen || null,
        state,
        defaultPriority: 100
      }
    }));
  }

  function removeDockItem() {
    runtime.dockMount = null;
    window.dispatchEvent(new CustomEvent('lectio-manager:dock:remove', {
      detail: { moduleId: MODULE.id, itemId: 'radar' }
    }));
  }

  function handleDockPanelRender(event) {
    const detail = event.detail || {};
    if (detail.moduleId !== MODULE.id || detail.itemId !== 'radar' || !detail.mount) return;

    runtime.dockMount = detail.mount;
    syncTheme();
    const history = runtime.state?.history || [];
    const lastViewed = readNumber(STORAGE.lastViewed);
    renderDockPanel({ status: getRadarState(history, lastViewed), history, lastViewed });
  }

  function renderDockPanel(view) {
    if (!runtime.dockMount?.isConnected) {
      runtime.dockMount = null;
      return;
    }

    runtime.dockMount.replaceChildren(buildRadarPanel(view, true));
    scheduleAutoSeen(!runtime.settingsOpen, view.status.unseen);
  }

  function buildRadarPanel({ status, history, lastViewed }, inDock) {
    const panel = document.createElement('section');
    panel.id = UI.panel;
    panel.classList.toggle('is-dock-panel', inDock);
    panel.classList.add(`state-${status.level}`);
    panel.setAttribute('aria-label', 'Lectio Change Radar details');

    const head = document.createElement('div');
    head.className = 'lcr-panel-head';
    head.innerHTML = `
      <span class="lcr-status-dot" aria-hidden="true"></span>
      <span class="lcr-panel-heading">
        <strong>${escapeHtml(runtime.settingsOpen ? 'Change Radar settings' : status.heading)}</strong>
        <small>${escapeHtml(runtime.settingsOpen ? 'Stored only in this browser.' : status.subheading)}</small>
      </span>`;

    if (!inDock) {
      const pin = document.createElement('button');
      pin.className = 'lcr-pin';
      pin.type = 'button';
      pin.textContent = runtime.pinned ? 'Unpin' : 'Pin';
      pin.title = runtime.pinned ? 'Close when the pointer leaves' : 'Keep this panel open';
      pin.addEventListener('click', (event) => {
        event.stopPropagation();
        runtime.pinned = !runtime.pinned;
        renderHud();
      });
      head.appendChild(pin);
    }
    panel.appendChild(head);

    if (runtime.settingsOpen) {
      panel.appendChild(renderSettingsPanel());
    } else {
      const list = document.createElement('div');
      list.id = UI.list;
      if (history.length) {
        history.forEach((item) => list.appendChild(renderHistoryItem(item, lastViewed)));
      } else {
        const empty = document.createElement('div');
        empty.className = 'lcr-empty';
        empty.textContent = runtime.state?.snapshot
          ? 'No timetable changes noticed yet.'
          : 'Creating the first timetable baseline. Later differences will appear here.';
        list.appendChild(empty);
      }
      panel.appendChild(list);
    }

    panel.appendChild(renderFooter(status, history));
    return panel;
  }

  function renderHistoryItem(item, lastViewed) {
    const node = document.createElement(item.url ? 'a' : 'div');
    node.className = 'lcr-item';
    node.dataset.kind = item.kind || 'changed';

    if (item.url) {
      node.href = item.url;
      node.title = 'Open activity in Lectio';
    }

    const unseen = Number(item.noticedAt) > lastViewed;
    const when = formatHistoryEventTime(item);
    const noticed = formatNoticed(item.noticedAt);

    node.innerHTML = `
      <div class="lcr-item-top">
        <span class="lcr-kind">${escapeHtml(kindLabel(item.kind))}</span>
        ${unseen ? '<span class="lcr-unseen">UNSEEN</span>' : ''}
        <span class="lcr-title">${escapeHtml(item.title || 'Lectio activity')}</span>
      </div>
      <div class="lcr-detail">${escapeHtml(item.detail || 'Schedule changed')}</div>
      <div class="lcr-meta">${escapeHtml(when)}${when && noticed ? ' · ' : ''}${escapeHtml(noticed)}</div>`;
    return node;
  }

  function renderFooter(status, history) {
    const footer = document.createElement('div');
    footer.className = 'lcr-footer';

    const statusText = document.createElement('div');
    statusText.id = UI.status;
    statusText.textContent = getStatusText();
    footer.appendChild(statusText);

    if (status.unseen > 0 && !runtime.settingsOpen) {
      const seenButton = actionButton('Mark seen', () => markViewed());
      footer.appendChild(seenButton);
    }

    const settingsButton = actionButton(runtime.settingsOpen ? 'Done' : 'Settings', () => {
      runtime.settingsOpen = !runtime.settingsOpen;
      runtime.pinned = true;
      renderHud();
    });
    footer.appendChild(settingsButton);

    if (!runtime.settingsOpen) {
      const refreshButton = actionButton(runtime.inFlight ? 'Checking...' : 'Refresh', () => {
        void refresh({ reason: 'manual', force: true });
      });
      refreshButton.disabled = runtime.inFlight;
      footer.appendChild(refreshButton);

      const clearButton = actionButton('Clear', clearHistory);
      clearButton.disabled = history.length === 0;
      clearButton.title = 'Clear the change log but keep the current timetable baseline.';
      footer.appendChild(clearButton);
    }

    return footer;
  }

  function actionButton(label, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lcr-action';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
    return button;
  }

  function renderSettingsPanel() {
    const host = document.createElement('div');
    host.className = 'lcr-settings';
    let openSection = null;

    for (const schema of SETTING_SCHEMA) {
      // Twenty-odd trackers in one flat list is unreadable, so the module's own
      // panel groups on the same section labels the Manager reads.
      if (schema.section && schema.section !== openSection) {
        openSection = schema.section;
        const heading = document.createElement('div');
        heading.className = 'lcr-setting-section';
        heading.textContent = schema.section;
        host.appendChild(heading);
      }

      const row = document.createElement('label');
      row.className = 'lcr-setting-row';

      const copy = document.createElement('span');
      copy.className = 'lcr-setting-copy';
      copy.innerHTML = `<strong>${escapeHtml(schema.label)}</strong><small>${escapeHtml(schema.description || '')}</small>`;
      row.appendChild(copy);

      let control;
      if (schema.type === 'toggle' || schema.type === 'boolean') {
        control = document.createElement('input');
        control.type = 'checkbox';
        control.className = 'lcr-setting-toggle';
        control.checked = Boolean(runtime.settings[schema.key]);
        control.addEventListener('change', () => applySetting(schema.key, control.checked));
      } else {
        control = document.createElement('select');
        control.className = 'lcr-setting-control';
        for (const option of schema.options || []) {
          const element = document.createElement('option');
          element.value = String(option.value);
          element.textContent = option.label;
          if (String(runtime.settings[schema.key]) === String(option.value)) element.selected = true;
          control.appendChild(element);
        }
        control.addEventListener('change', () => applySetting(schema.key, coerceSettingValue(schema.key, control.value)));
      }

      row.appendChild(control);
      host.appendChild(row);
    }

    return host;
  }

  function getRadarState(history, lastViewed) {
    if (runtime.lastError) {
      return {
        level: 'error', unseen: 0, urgentUnseen: 0,
        heading: 'Radar check problem',
        subheading: runtime.lastError,
        tooltip: `Change Radar: ${runtime.lastError}`,
        ariaLabel: `Lectio Change Radar. Check problem: ${runtime.lastError}`
      };
    }

    const now = Date.now();
    const unseenItems = history.filter((item) => Number(item.noticedAt) > lastViewed);
    const urgentCutoff = now + (Number(runtime.settings.urgentHours) || 24) * 60 * 60 * 1000;
    const urgentItems = unseenItems.filter((item) => {
      const time = historyEventTimestamp(item);
      return time && time >= now && time <= urgentCutoff;
    });

    if (urgentItems.length) {
      return {
        level: 'red',
        unseen: unseenItems.length,
        urgentUnseen: urgentItems.length,
        heading: 'Urgent change',
        subheading: `${urgentItems.length} unseen change${urgentItems.length === 1 ? '' : 's'} coming up soon`,
        tooltip: `Urgent: ${urgentItems.length} unseen upcoming timetable change${urgentItems.length === 1 ? '' : 's'}.`,
        ariaLabel: `Lectio Change Radar. Red alert. ${urgentItems.length} urgent unseen change${urgentItems.length === 1 ? '' : 's'}.`
      };
    }

    const recentCutoff = now - (Number(runtime.settings.recentHours) || 24) * 60 * 60 * 1000;
    const recent = history.filter((item) => Number(item.noticedAt) >= recentCutoff);

    if (unseenItems.length || recent.length) {
      const subheading = unseenItems.length
        ? `${unseenItems.length} unseen change${unseenItems.length === 1 ? '' : 's'} to review`
        : `Recent changes have been seen`;
      return {
        level: 'yellow',
        unseen: unseenItems.length,
        urgentUnseen: 0,
        heading: unseenItems.length ? 'Changes to review' : 'Recent change',
        subheading,
        tooltip: unseenItems.length ? `${unseenItems.length} unseen timetable change${unseenItems.length === 1 ? '' : 's'}.` : 'Recent timetable changes have been reviewed.',
        ariaLabel: `Lectio Change Radar. Amber. ${subheading}.`
      };
    }

    return {
      level: 'green', unseen: 0, urgentUnseen: 0,
      heading: 'All clear',
      subheading: runtime.inFlight ? 'Checking Lectio...' : 'No recent changes need attention',
      tooltip: 'Change Radar: all clear.',
      ariaLabel: 'Lectio Change Radar. Green. All clear.'
    };
  }

  function historyEventTimestamp(item) {
    if (!item?.eventDate) return 0;
    const time = /^\d{2}:\d{2}$/.test(item.eventStart || '') ? item.eventStart : '08:00';
    const timestamp = Date.parse(`${item.eventDate}T${time}:00`);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function scheduleAutoSeen(expanded, unseenCount) {
    if (runtime.viewTimer) {
      window.clearTimeout(runtime.viewTimer);
      runtime.viewTimer = null;
    }
    if (!expanded || unseenCount <= 0) return;

    runtime.viewTimer = window.setTimeout(() => {
      runtime.viewTimer = null;
      if (runtime.pinned || runtime.hovered) markViewed();
    }, BASE_CONFIG.autoSeenDelayMs);
  }

  function markViewed() {
    writeNumber(STORAGE.lastViewed, Date.now());
    renderHud();
  }

  function clearHistory() {
    if (!runtime.state) return;
    runtime.state = { ...runtime.state, history: [] };
    saveState(runtime.state);
    markViewed();
  }

  function getStatusText() {
    if (runtime.lastError) return runtime.lastError;
    if (runtime.inFlight) return 'Checking now...';
    const checkedAt = Number(runtime.state?.checkedAt || 0);
    if (!checkedAt) return 'Waiting for first check';
    return `Checked ${formatClock(checkedAt)} · every ${runtime.settings.pollMinutes} min`;
  }

  function syncTheme() {
    const target = document.getElementById(UI.root) || runtime.dockMount;
    if (!target) return;

    const candidates = [
      document.querySelector('.islandContent'),
      document.querySelector('.lectioTabContent'),
      document.querySelector('.ls-paper'),
      document.querySelector('.ls-master-container2'),
      document.getElementById('masterContent'),
      document.body
    ].filter(Boolean);

    let surface = '';
    let text = '';
    let border = '';

    for (const node of candidates) {
      const css = getComputedStyle(node);
      if (!surface && isVisibleColor(css.backgroundColor)) surface = css.backgroundColor;
      if (!text && isVisibleColor(css.color)) text = css.color;
      if (!border && isVisibleColor(css.borderColor)) border = css.borderColor;
      if (surface && text) break;
    }

    const dark = document.body?.dataset?.theme === 'dark' || document.documentElement?.dataset?.theme === 'dark';
    surface ||= dark ? 'rgb(41, 41, 41)' : 'rgb(255, 255, 255)';
    text ||= dark ? 'rgb(100, 173, 213)' : 'rgb(36, 55, 70)';
    border ||= dark ? 'rgb(82, 91, 98)' : 'rgb(200, 212, 220)';

    target.style.setProperty('--lcr-surface', surface);
    target.style.setProperty('--lcr-text', text);
    target.style.setProperty('--lcr-border', border);
    target.style.setProperty('--lcr-muted', mixWithSurface(text, surface, .62));
    target.style.setProperty('--lcr-soft', mixWithSurface(text, surface, .055));
  }

  function installThemeObserver() {
    const callback = () => window.requestAnimationFrame(syncTheme);
    const observer = new MutationObserver(callback);
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    if (document.documentElement) observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  }

  function isVisibleColor(value) {
    if (!value) return false;
    return !/rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(value) && value !== 'transparent';
  }

  function mixWithSurface(foreground, background, amount) {
    const fg = parseRgb(foreground);
    const bg = parseRgb(background);
    if (!fg || !bg) return amount > .5 ? foreground : background;
    const mix = (a, b) => Math.round((a * amount) + (b * (1 - amount)));
    return `rgb(${mix(fg[0], bg[0])}, ${mix(fg[1], bg[1])}, ${mix(fg[2], bg[2])})`;
  }

  function parseRgb(value) {
    const match = String(value || '').match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }

  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE.settings) || '{}');
      const settings = sanitizeSettings(parsed);

      // A stored value always beats a changed default, and 0.3.0 stored its own
      // default of 'floating'. Without rewriting it once, "prefer the dock"
      // would only ever reach installs that had never saved a setting.
      if ((Number(parsed?.schema) || 0) < SETTINGS_SCHEMA && settings.displayMode === 'floating') {
        settings.displayMode = 'auto';
        saveSettings(settings);
      }

      return settings;
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function sanitizeSettings(values) {
    const out = { ...DEFAULT_SETTINGS, schema: SETTINGS_SCHEMA };
    if (DISPLAY_MODES.includes(values?.displayMode)) {
      out.displayMode = values.displayMode;
    }
    const allowed = {
      pollMinutes: [5, 10, 15, 30],
      weeksAhead: [0, 1, 2],
      urgentHours: [6, 12, 24, 48],
      recentHours: [12, 24, 48, 72],
      historyLimit: [5, 10, 20]
    };

    for (const [key, options] of Object.entries(allowed)) {
      const n = Number(values?.[key]);
      if (options.includes(n)) out[key] = n;
    }
    for (const key of BOOLEAN_SETTING_KEYS) {
      if (typeof values?.[key] === 'boolean') out[key] = values[key];
      else if (values?.[key] === 'true' || values?.[key] === 1 || values?.[key] === '1') out[key] = true;
      else if (values?.[key] === 'false' || values?.[key] === 0 || values?.[key] === '0') out[key] = false;
    }
    return out;
  }

  function coerceSettingValue(key, value) {
    if (BOOLEAN_SETTING_KEYS.includes(key)) return Boolean(value);
    if (key === 'displayMode') return value;
    return Number(value);
  }

  function saveSettings(settings) {
    try { localStorage.setItem(STORAGE.settings, JSON.stringify(settings)); } catch (_) {}
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE.state) || 'null');
      if (!parsed || parsed.version !== 1) return null;
      if (!parsed.snapshot || typeof parsed.snapshot.events !== 'object') return null;
      return { ...parsed, history: Array.isArray(parsed.history) ? parsed.history.slice(0, getHistoryLimit()) : [] };
    } catch (_) {
      return null;
    }
  }

  function saveState(state) {
    try { localStorage.setItem(STORAGE.state, JSON.stringify(state)); } catch (_) {}
  }

  function readNumber(key) {
    try { return Number(localStorage.getItem(key) || 0) || 0; } catch (_) { return 0; }
  }

  function writeNumber(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) {}
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

  // Reads a tooltip field that may wrap onto following lines, stopping at the
  // next field label. extractField stays for the one-line fields.
  function extractBlock(lines, pattern) {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index < 0) return '';

    const parts = [cleanText(lines[index].match(pattern)?.[1] || '')];
    for (let i = index + 1; i < lines.length; i += 1) {
      if (TOOLTIP_FIELD_PATTERN.test(lines[i])) break;
      parts.push(cleanText(lines[i]));
    }

    return cleanText(parts.filter(Boolean).join(' '));
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
      teacher: 'Teacher',
      homework: 'Homework',
      note: 'Note',
      assignment: 'Assignment',
      deadline: 'Deadline',
      status: 'Status',
      absence: 'Absence',
      document: 'Document',
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
