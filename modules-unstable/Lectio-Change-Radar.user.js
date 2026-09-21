// ==UserScript==
// @name         Lectio Change Radar
// @namespace    https://github.com/RktRobinhood/Lectio-Scripts
// @version      0.9.3
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
    version: '0.9.3',
    channel: 'unstable'
  });

  const BASE_CONFIG = Object.freeze({
    minRefreshGapMs: 90 * 1000,
    fetchTimeoutMs: 20 * 1000,
    autoSeenDelayMs: 1200
  });

  // Backoff measured against this module's own rhythm, not a sibling's. A poll
  // here is five to thirty minutes apart, so a seconds-scale backoff would be
  // stepped straight over. What actually hammers a sick Lectio is not the poll
  // timer at all: a failed check never reaches writeNumber(STORAGE.lastPoll),
  // so lastPoll stops moving and every single return to the tab passes the
  // visibilitychange test and starts another check, held back only by
  // minRefreshGapMs. Two failed checks rather than three, because a check is
  // already a burst of one request per watched week plus any extra source, and
  // at the default ten-minute cadence a third round is twenty more minutes of
  // it. The base is the fastest cadence the settings offer (5 minutes) - a
  // shorter one would be a backoff the poll timer simply steps over - and the
  // ceiling is the slowest (30 minutes), which is also EXTRA_SOURCE_MIN_GAP_MS.
  // The ceiling is deliberately tighter than the siblings': a stale badge or an
  // unlearned colour costs nothing for an hour, but this module's output is a
  // cancellation you need before you leave the house.
  const POLL_FAILURES_BEFORE_BACKOFF = 2;
  const POLL_BACKOFF_BASE_MS = 5 * 60 * 1000;
  const POLL_BACKOFF_CEILING_MS = 30 * 60 * 1000;

  // A small random offset on the first check of a page view, so a class that
  // all opens Lectio on the same bell does not fire the same burst at the same
  // instant. Four seconds is several times the length of a healthy request and
  // costs the user nothing visible, because the HUD renders from stored state
  // long before the first check answers.
  const FIRST_POLL_JITTER_MS = 4000;

  /*
   * The Manager's optional request-slot broker (docs/manager-request-slots.md).
   * Jitter keeps this module from marching in step with other copies of itself;
   * a slot keeps it from marching in step with the other modules, which is the
   * part no module can arrange on its own because it may not know they exist.
   *
   * Both numbers below are this page's own, and they are what makes the whole
   * thing safe: nothing here can be starved by a Manager. An answer of any
   * kind is expected almost immediately, because a live Manager replies inside
   * the dispatch - so no answer within the first window means no Manager, an
   * old Manager, or a Manager that has stopped, all of which are the same case
   * and all of which mean go now. A `wait` says a live Manager is holding the
   * request behind somebody else, which is worth waiting longer for, but only
   * up to a ceiling this module sets: past it the request goes ahead anyway
   * and gives the slot straight back. The Manager's own numbers are never
   * read, so it cannot ask for more patience than this.
   */
  const SLOT_REQUEST_EVENT = 'lectio-manager:slot:request';
  const SLOT_WAIT_EVENT = 'lectio-manager:slot:wait';
  const SLOT_GRANT_EVENT = 'lectio-manager:slot:grant';
  const SLOT_RELEASE_EVENT = 'lectio-manager:slot:release';
  const SLOT_ANSWER_MS = 1200;
  const SLOT_MAX_WAIT_MS = 8000;

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
    trackUpcomingAssignments: true,
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

  // The words an assignment row's status cell can hold, in either language, as
  // a whole cell. Used only by the assignment parser far below, but declared
  // here with the other patterns: init() is called during this file's own
  // evaluation, and a module-scope const after that call would still be in its
  // temporal dead zone when reached (issue #58, scripts/check-boot-order.mjs).
  const ASSIGNMENT_STATUS_PATTERN = /^(?:Afleveret|Ikke afleveret|Mangler|Afventer|Venter|Afsluttet|Godkendt|Ikke godkendt|Handed in|Not handed in|Missing|Awaiting|Closed|Approved|Not approved)$/i;

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
    makeToggleSetting('trackUpcomingAssignments', 'Due soon', 'Raise an assignment on the radar once its deadline comes inside the window you set under Weeks to watch, so a deadline announces itself before it is on top of you rather than only when it moves.', true, 'Assignments'),
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
    lastError: '',

    // Everything the safety net needs lives on this object, which is declared
    // above the start block below - module-scope state declared further down,
    // beside the functions that use it, would be read in its temporal dead
    // zone on the cold-start path and throw. All of it lasts one page view:
    // pagehide clears the two timers, empties the controller Set and sets
    // suspended, and a bfcache restore puts them back. The backoff is in
    // memory rather than stored because the hammering it damps happens inside
    // a single page view, and a new page view has earned a fresh try.
    //
    // liveFetchControllers is bounded by construction: a request adds its own
    // controller on the way in and removes it in fetchLectioDocument's
    // finally, so every exit path - answered, failed, timed out or aborted -
    // takes it back out, and the Set is empty again between checks.
    suspended: false,
    startTimer: null,
    pollFailures: 0,
    backoffUntil: 0,
    liveFetchControllers: new Set(),

    // Slot requests this page view is still waiting on, and the counter their
    // names come from. Bounded the same way liveFetchControllers is: an entry
    // goes in when a request is made and comes out when it is released, on
    // every exit path, and suspendPolling empties what is left.
    slotSeq: 0,
    pendingSlots: new Map(),

    // Whether the last request this page made went unanswered. One page view
    // with no Manager on it must not pay the answer window once per request:
    // the first one establishes that nothing is listening and the rest go
    // straight through. Any answer clears it again, so a Manager evaluated
    // after this module - or one that comes back - is picked up on the next
    // request rather than being ignored for the life of the page.
    slotsUnanswered: false
  };

  // The Manager announces itself by asking every module to register. Automatic
  // mode waits that long before falling back to a floating radar, so a page with
  // the Manager installed does not flash a floating HUD that then jumps away.
  const MANAGER_GRACE_MS = 2500;
  const loadedAt = Date.now();

  // Before anything is read: a snapshot belonging to a login this browser has
  // not used in two months is bytes nothing will ever look at again (#29).
  pruneStaleStorage();

  runtime.settings = loadSettings();
  runtime.state = loadState();

  registerWithManager();
  window.addEventListener('lectio-manager:discover', handleDiscovery);
  window.addEventListener('lectio-manager:set-setting', handleManagerSettingsEvent);
  window.addEventListener('lectio-manager:prune-storage', handlePruneStorage);
  window.addEventListener('lectio-manager:dock:render-panel', handleDockPanelRender);
  window.addEventListener(SLOT_WAIT_EVENT, handleSlotAnswer);
  window.addEventListener(SLOT_GRANT_EVENT, handleSlotAnswer);
  // Deliberately not { once: true }, and deliberately split in two. A page
  // frozen for the back/forward cache fires pagehide with persisted set and may
  // be restored without this script ever running again, so tearing the module
  // down there left a restored page permanently switched off - no poll timer
  // and no dock item, for the rest of that page's life. That is the bug filed
  // as #41 against Chairs Up, and this listener had it. A frozen page now only
  // has its background checking suspended, and pageshow puts it back; a page
  // that is genuinely going away is torn down exactly as before. One
  // registration each, at module scope, so neither can accumulate.
  window.addEventListener('pagehide', (event) => {
    suspendPolling();

    if (event && event.persisted) return;

    removeDockItem();
    window.clearTimeout(runtime.viewTimer);
    window.clearTimeout(runtime.graceTimer);
    window.clearTimeout(runtime.settingsRefreshTimer);
  });
  window.addEventListener('pageshow', resumePolling);

  for (const eventName of [
    'lectio-manager:setting-change',
    'lectio-manager:settings-change',
    'lectio-manager:update-setting',
    'lectio-module:setting-change',
    'lectio-module:update-settings'
  ]) {
    window.addEventListener(eventName, handleManagerSettingsEvent);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
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
        /*
         * What this module keeps in the browser, so the Manager can show it
         * without knowing what any of it is (issue #29,
         * docs/manager-storage-api.md). Only the snapshot-and-log entry is
         * prunable: losing it costs one quiet poll while the radar re-reads
         * the timetable it compares against. The settings blob is not, and
         * neither is the "last seen" mark, which is the only record that
         * something has already been read.
         */
        storage: [
          {
            key: STORAGE.settings,
            kind: 'setting',
            label: { en: 'Settings', da: 'Indstillinger' }
          },
          {
            key: STORAGE.state,
            kind: 'cache',
            prunable: true,
            label: { en: 'Timetable snapshot and change log', da: 'Skema-øjebliksbillede og ændringslog' }
          },
          {
            key: STORAGE.lastPoll,
            kind: 'state',
            label: { en: 'Last check', da: 'Sidste tjek' }
          },
          {
            key: STORAGE.lastViewed,
            kind: 'state',
            label: { en: 'Last seen', da: 'Sidst set' }
          }
        ]
      }
    }));

    // The Manager can be installed after this script has already rendered.
    // Re-advertise the dock item when its discovery request arrives.
    if (document.getElementById(UI.style)) renderHud();
  }

  function init() {
    if (!document.body) return;

    installStyles();
    syncTheme();
    installThemeObserver();
    renderHud();

    // The first check of a page view is offset by a random fraction of a few
    // seconds. Re-armable and single-shot: the previous timer is always
    // cleared first, so no two can be outstanding, and pagehide clears it.
    if (runtime.startTimer) window.clearTimeout(runtime.startTimer);
    runtime.startTimer = window.setTimeout(() => {
      runtime.startTimer = null;
      if (!runtime.suspended) void refresh({ reason: 'startup' });
    }, Math.floor(Math.random() * FIRST_POLL_JITTER_MS));

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
    runtime.timer = null;

    // A settings change or a cross-tab storage event can land after the page
    // has been frozen or torn down. Neither may resurrect a timer; resuming
    // is pageshow's job and it clears the flag before calling back in here.
    if (runtime.suspended) return;

    runtime.timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh({ reason: 'interval' });
      }
    }, getPollMs());
  }

  // Suspending is not tearing down: everything here is reversible, because a
  // page frozen for the back/forward cache may come back without this script
  // ever running again. Nothing may be left in flight while it is frozen
  // though - a frozen page must not go on holding a Lectio request open - so
  // the live controllers are aborted here rather than only on the terminal
  // branch of pagehide. A restored page simply starts a fresh check.
  function suspendPolling() {
    runtime.suspended = true;

    if (runtime.timer) {
      window.clearInterval(runtime.timer);
      runtime.timer = null;
    }

    if (runtime.startTimer) {
      window.clearTimeout(runtime.startTimer);
      runtime.startTimer = null;
    }

    for (const controller of runtime.liveFetchControllers) {
      try {
        controller.abort();
      } catch (_) {
        // A controller that has already settled cannot be aborted.
      }
    }

    runtime.liveFetchControllers.clear();
    releaseManagerSlots();
  }

  function resumePolling(event) {
    if (!event || !event.persisted || !runtime.suspended) return;

    runtime.suspended = false;
    restartPollTimer();
  }

  function notePollFailure() {
    // A check the page's own freeze stopped is not Lectio failing, and must
    // not push a healthy install into a backoff for being navigated away from.
    if (runtime.suspended) return;

    runtime.pollFailures += 1;
    if (runtime.pollFailures < POLL_FAILURES_BEFORE_BACKOFF) return;

    runtime.backoffUntil = Date.now() + Math.min(
      POLL_BACKOFF_BASE_MS * Math.pow(2, runtime.pollFailures - POLL_FAILURES_BEFORE_BACKOFF),
      POLL_BACKOFF_CEILING_MS
    );
  }

  function clearPollBackoff() {
    runtime.pollFailures = 0;
    runtime.backoffUntil = 0;
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
    // Never stack. A check already running is not joined and not queued behind
    // - this tick simply does not happen. Nor does one on a page whose own
    // teardown has suspended background work.
    if (runtime.inFlight || runtime.suspended) return;

    const now = Date.now();
    const lastPoll = readNumber(STORAGE.lastPoll);

    if (!force && reason !== 'manual' && now - lastPoll < BASE_CONFIG.minRefreshGapMs) {
      return;
    }

    // Somebody pressing Refresh, or changing what is watched, is asking for
    // another go, so it clears the backoff rather than being swallowed by it.
    // A backed-off background check returns before reading or writing
    // anything, so the HUD goes on showing exactly what it was showing.
    if (force || reason === 'manual') clearPollBackoff();
    else if (now < runtime.backoffUntil) return;

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

      // Lectio answered with a timetable, so it is reachable and signed in.
      // Whatever else the check found, the backoff goes.
      clearPollBackoff();
    } catch (error) {
      runtime.lastError = friendlyError(error);
      notePollFailure();
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

      // Both snapshots carry the horizon they were built with, so "how far ahead
      // is it looking" means the same thing for an assignment deadline as it
      // does for the timetable, and follows the same Weeks-to-watch setting.
      const window = {
        previousEnd: previous?.rangeEnd || '',
        currentEnd: current?.rangeEnd || '',
        today: toIsoDate(new Date())
      };

      changes.push(
        ...getSourceReader(source.key).compare(before, after, noticedAt, window).slice(0, MAX_CHANGES_PER_SOURCE)
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

  function emitSlot(name, requestId) {
    window.dispatchEvent(new CustomEvent(name, {
      detail: { moduleId: MODULE.id, requestId }
    }));
  }

  function handleSlotAnswer(event) {
    const detail = event && event.detail;
    if (!detail || detail.moduleId !== MODULE.id) return;

    // Something is listening after all, so the next request pays the answer
    // window again rather than assuming this page has no broker on it.
    runtime.slotsUnanswered = false;

    const pending = runtime.pendingSlots.get(detail.requestId);

    if (!pending) {
      // A grant for work this page has already finished or already given up
      // on. Hand it straight back, or the Manager holds a turn for nobody
      // until its own lease runs out and everything else queues behind it.
      if (event.type === SLOT_GRANT_EVENT) emitSlot(SLOT_RELEASE_EVENT, detail.requestId);
      return;
    }

    if (event.type === SLOT_GRANT_EVENT) pending.go();
    else pending.hold();
  }

  /*
   * Resolves with the function that gives the turn back, and resolves either
   * way - on a grant, or on this page's own timer. There is no rejection path
   * and no path that never settles, which is the whole safety property: the
   * worst a missing, old or broken Manager can cost is SLOT_ANSWER_MS.
   */
  function takeManagerSlot() {
    runtime.slotSeq += 1;
    const requestId = `r${runtime.slotSeq}`;

    return new Promise((resolve) => {
      let timer = 0;
      let settled = false;
      let held = false;

      const release = () => {
        runtime.pendingSlots.delete(requestId);
        emitSlot(SLOT_RELEASE_EVENT, requestId);
      };

      const go = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        timer = 0;
        resolve(release);
      };

      // Going ahead because nothing answered, rather than because the page is
      // being torn down or the Manager said so. That is the one thing worth
      // remembering between requests.
      const giveUp = () => {
        runtime.slotsUnanswered = true;
        go();
      };

      runtime.pendingSlots.set(requestId, {
        go,
        // Only the first wait extends anything. A Manager repeating itself
        // cannot keep pushing this page's ceiling further out.
        hold() {
          if (settled || held) return;
          held = true;
          window.clearTimeout(timer);
          timer = window.setTimeout(go, SLOT_MAX_WAIT_MS);
        }
      });

      // A live Manager answers inside the dispatch below, so even the zero
      // here still gets a grant when there is one to get: the timer cannot
      // fire until the current task ends, and the answer arrives inside it.
      timer = window.setTimeout(giveUp, runtime.slotsUnanswered ? 0 : SLOT_ANSWER_MS);
      emitSlot(SLOT_REQUEST_EVENT, requestId);
    });
  }

  // Nothing waiting on a turn may outlive the page view, frozen or gone: the
  // waiters are resolved so no promise is left dangling, and every turn is
  // handed back so the Manager is not holding slots for a page that has
  // stopped. The suspended re-check in fetchLectioDocument is what keeps a
  // resolved waiter from starting a request on the way out.
  function releaseManagerSlots() {
    for (const pending of [...runtime.pendingSlots.values()]) pending.go();
    for (const requestId of [...runtime.pendingSlots.keys()]) {
      runtime.pendingSlots.delete(requestId);
      emitSlot(SLOT_RELEASE_EVENT, requestId);
    }
  }

  async function fetchLectioDocument(url) {
    // Ask the Manager for a turn before anything is armed, so a request that
    // waits does not spend its own timeout waiting.
    const releaseSlot = await takeManagerSlot();

    if (runtime.suspended) {
      releaseSlot();
      throw new Error('The page stopped background checking.');
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), BASE_CONFIG.fetchTimeoutMs);

    // The timeout is one reason a request can end; the page going away is the
    // other. Tracking the controller is what lets pagehide reach a request
    // that is already in the air - and the delete in the finally below is on
    // every exit path, so nothing accumulates.
    runtime.liveFetchControllers.add(controller);

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
      runtime.liveFetchControllers.delete(controller);
      releaseSlot();
    }
  }

  /*
   * Telling the Manager that a selector matched nothing
   * (docs/manager-problem-log.md). One-way and additive: with no Manager
   * installed this lands on a window nobody is listening to, which is a no-op.
   *
   * `code` is a token written here, never text read off a page - there is
   * deliberately no field for a message, because this log is written to be
   * pasted into a public issue.
   */
  function reportToManager(kind, code, found) {
    window.dispatchEvent(new CustomEvent('lectio-module:report', {
      detail: { moduleId: MODULE.id, kind, code, found }
    }));
  }

  function parseSchedule(doc) {
    const result = [];
    const bricks = doc.querySelectorAll('a.s2skemabrik.s2brik[data-tooltip]');

    /*
     * A week this reads as empty is reported as no changes at all, which is
     * exactly what a quiet week looks like - so an empty week is left alone
     * and only the unambiguous case is raised: the fetched page rendered
     * blocks, and none of them matched what is parsed here.
     */
    if (!bricks.length && doc.querySelector('.s2skemabrik')) {
      reportToManager('drift', 'schedule-bricks', 0);
    }

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
  // These three pages are list views, read by pattern rather than by position:
  // a row is interesting when it links to something carrying a stable Lectio id,
  // and its fields are recognised by shape (a d/m-yyyy date, a percentage, a
  // status word) wherever they happen to sit. That survives a column being added
  // or reordered. Where the table names its columns, the named column wins over
  // the pattern - the deadline is read from the Frist column, and a grade only
  // ever from a Karakter column - because the teacher's real OpgaveListe (in
  // tests/fixtures/pages/, issue #59) has a column of counts that share their
  // digits with the 7-point scale.
  //
  // When a parser stops matching it yields nothing rather than nonsense, and
  // looksLikeParseFailure absorbs that - but only for a source that used to see
  // rows. A parser that has never seen a row looks like a quiet week, which is
  // how both key names below were wrong for as long as the feature existed
  // (issue #59). So each parser also reports drift to the Manager's problem
  // log for the one unambiguous case: the page is plainly the right list, has
  // data rows, and none of them was read.

  // A Lectio table row's cells lined up with its header, rowspan and colspan
  // resolved. OpgaveListe groups rows by week with a rowspan on the week cell,
  // so the later rows of a week have one td fewer than the header has columns,
  // and "the fifth cell" is the wrong column on those rows. A spanning cell is
  // repeated into every slot it covers. HTMLTableElement.rows and row.cells stop
  // at this table's own sections, so a nested table is one cell, not many rows.
  function tableGrid(table) {
    const grid = new Map();
    const spans = [];

    for (const row of Array.from(table.rows)) {
      const cells = [];
      let column = 0;

      const place = (cell) => {
        cells[column] = cell;
        column += 1;
      };
      const carrySpans = () => {
        while (spans[column] && spans[column].remaining > 0) {
          spans[column].remaining -= 1;
          place(spans[column].cell);
        }
      };

      for (const cell of Array.from(row.cells)) {
        carrySpans();
        const colSpan = Math.max(1, Number(cell.colSpan) || 1);
        const rowSpan = Math.max(1, Number(cell.rowSpan) || 1);
        for (let index = 0; index < colSpan; index += 1) {
          if (rowSpan > 1) spans[column] = { cell, remaining: rowSpan - 1 };
          place(cell);
        }
      }
      carrySpans();

      grid.set(row, cells);
    }

    return grid;
  }

  function tableHeaders(table, grid) {
    for (const row of Array.from(table.rows)) {
      const cells = grid.get(row) || [];
      if (!cells.some((cell) => cell && cell.tagName === 'TH')) continue;
      return cells.map((cell) => cleanText(cell ? cell.textContent : ''));
    }

    return [];
  }

  // A lesson block renders its contents twice, once .OnlyDesktop and once
  // .OnlyMobile, so a cell holding one reads doubled unless one copy is dropped.
  function cellText(cell) {
    if (!cell.querySelector('.OnlyMobile')) return cleanText(cell.textContent || '');

    const copy = cell.cloneNode(true);
    for (const mobile of copy.querySelectorAll('.OnlyMobile')) mobile.remove();
    return cleanText(copy.textContent || '');
  }

  function harvestRows(doc, match) {
    const rows = {};
    const tables = new Map();

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

      // The row's cells by named column, when the table names them. A table
      // with no header row yields no columns, and the readers fall back to
      // recognising fields by shape.
      const table = row.closest('table');
      if (table && !tables.has(table)) {
        const grid = tableGrid(table);
        tables.set(table, { grid, headers: tableHeaders(table, grid) });
      }
      const { grid, headers } = tables.get(table) || { grid: new Map(), headers: [] };
      const columns = headers.length
        ? (grid.get(row) || []).map((cell, index) => ({
          header: headers[index] || '',
          text: cell ? cellText(cell) : ''
        }))
        : [];

      const cells = Array.from(row.querySelectorAll('td'))
        .map(cellText)
        .filter(Boolean);

      rows[id] = { id, title: title || cells[0] || '', cells, columns, url, element: row };
    }

    return rows;
  }

  // The text under the first header matching `pattern`, or null when the table
  // has no such column - which is different from the column being empty.
  function findColumn(row, pattern) {
    const column = (row.columns || []).find((entry) => pattern.test(entry.header));
    return column ? column.text : null;
  }

  // The unambiguous case for drift: a table headed like the list this parser
  // reads, with data rows in it, and none of them harvested. An empty list has
  // no data rows and says nothing; a page that is not the list has no such
  // header. Either way nothing is reported, which is the fail-closed side.
  function looksLikeListPage(doc, headerPattern) {
    for (const header of doc.querySelectorAll('th')) {
      if (!headerPattern.test(cleanText(header.textContent || ''))) continue;

      const table = header.closest('table');
      if (!table) continue;

      const dataRows = Array.from(table.rows).filter((row) =>
        Array.from(row.cells).filter((cell) => cell.tagName === 'TD').length >= 3);
      if (dataRows.length) return true;
    }

    return false;
  }

  function parseAssignments(doc) {
    const records = {};

    // The teacher's OpgaveListe links every assignment with exeid=, read off a
    // real page (issue #59). exerciseid= was the guess before that page was
    // seen; it is kept because no student list is in the corpus yet and the
    // two views need not link the same way.
    const rows = harvestRows(doc, (href) => {
      const match = href.match(/[?&](?:exeid|exerciseid)=(\d+)/i);
      return match ? `EX${match[1]}` : '';
    });

    if (!Object.keys(rows).length && looksLikeListPage(doc, /opgavetitel|assignment/i)) {
      reportToManager('drift', 'assignment-rows', 0);
    }

    for (const row of Object.values(rows)) {
      // With a Frist column, only that column is a deadline: the note column
      // sits before it on the real page and is free text somebody wrote, which
      // can carry a date of its own. Without one, the first date-shaped cell.
      const deadlineCell = findColumn(row, /frist|deadline/i);
      const due = findRowDateTime(deadlineCell == null ? row.cells : [deadlineCell]);
      const grade = findAssignmentGrade(row);

      records[row.id] = {
        id: row.id,
        title: row.title || 'Assignment',
        dueDate: due.dateIso,
        dueTime: due.time,
        status: findAssignmentStatus(row.cells, grade),
        context: findAssignmentContext(row.cells, row.title, grade),
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

  // A grade is read only from a column headed Karakter/Grade, and only when it
  // is on the closed 7-point scale. The scale shares its tokens with small
  // counts: the teacher's list has a column of how many students have not
  // handed in, and 7 of 80 read as "Grade 7" until the column was named. No
  // header, no grade.
  function findAssignmentGrade(row) {
    const cell = findColumn(row, /karakter|grade/i);
    return cell != null && GRADE_TOKENS.includes(cell) ? cell : '';
  }

  function findAssignmentStatus(cells, grade) {
    const parts = cells.filter((cell) => ASSIGNMENT_STATUS_PATTERN.test(cell));
    if (grade) parts.push(`Grade ${grade}`);
    return parts.join(' · ');
  }

  // Whatever else the row carries once its title, deadline, status and grade are
  // accounted for - the class and the expected hours, on the lists seen so far.
  // Taking the remainder rather than named columns means the radar shows what
  // the assignment page shows without claiming to know its layout.
  function findAssignmentContext(cells, title, grade) {
    const parts = cells.filter((cell) => {
      if (!cell || cell === title) return false;
      if (/\b\d{1,2}\/\d{1,2}-\d{4}\b/.test(cell)) return false;
      if (ASSIGNMENT_STATUS_PATTERN.test(cell)) return false;
      return !grade || cell !== grade;
    });

    return truncate(parts.join(' · '), 60);
  }

  function parseAbsence(doc) {
    const records = {};

    // A registration links to ActivityAbsenceRegistration.aspx?id=<n>, read off
    // the real teacher page (issue #59) and matched on the page name as well as
    // the parameter, because a bare id= is on half of Lectio's links. absenseId=
    // was the guess before that page was seen, and stays accepted.
    const rows = harvestRows(doc, (href) => {
      const match = href.match(/ActivityAbsenceRegistration\.aspx\?(?:[^#]*?&)?id=(\d+)/i) ||
        href.match(/[?&]absenseId=(\d+)/i);
      return match ? `ABSENCE${match[1]}` : '';
    });

    for (const row of Object.values(rows)) {
      // The row's lesson block is what the reader sees; the link text on the
      // teacher page is "Angiv fravær" on every row and names the action, not
      // the lesson. The block's first copy is read so the doubled page reads
      // once.
      const brick = row.element.querySelector('.s2skemabrik[data-tooltip]');
      const blockTitle = cleanText((brick && (brick.querySelector('.s2skemabrikcontent') || brick).textContent) || '');

      records[row.id] = {
        id: row.id,
        type: 'registration',
        title: blockTitle || row.title || row.cells[0] || 'Absence registration',
        detail: row.cells.slice(0, 4).join(' · '),
        url: row.url
      };
    }

    // Per-class percentages: any row carrying a hold context card and at least
    // one percentage. Keying on the card means a reordered table is not news.
    //
    // This half is written for the student page, subnav/fravaerelev.aspx, which
    // lists each hold with its absence percentage - the "Percentage changes"
    // setting is a student's. The teacher page (subnav/fravaerlaerer.aspx, the
    // one in tests/fixtures/pages/) is a list of lessons awaiting registration
    // and carries no percentage anywhere, so this finds nothing there, by
    // design. No student page has been seen yet (issue #59), so it stays as
    // written and fails closed rather than being reworked against a page
    // nobody has looked at.
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

    // Drift, on the one shape known for certain: the teacher page is a table
    // headed Aktivitet whose rows hold lesson blocks. Blocks in the rows of
    // such a table and nothing read is the parser missing them, not a quiet
    // week. A page with neither says nothing.
    if (!Object.keys(records).length &&
        looksLikeListPage(doc, /^(?:aktivitet|activity)$/i) &&
        doc.querySelector('tr .s2skemabrik[data-tooltip]')) {
      reportToManager('drift', 'absence-rows', 0);
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

  function compareAssignments(before, after, noticedAt, window) {
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
            detail: withContext(next.dueDate ? `New assignment, due ${formatDeadline(next)}` : 'New assignment', next),
            noticedAt,
            record: next
          }));
        }
        continue;
      }

      const deadlineMoved = previous.dueDate !== next.dueDate || previous.dueTime !== next.dueTime;

      if (settings.trackAssignmentDeadlines && deadlineMoved) {
        changes.push(makeSourceEntry({
          kind: 'deadline',
          title: next.title,
          detail: withContext(`Deadline: ${formatDeadline(previous)} -> ${formatDeadline(next)}`, next),
          noticedAt,
          record: next
        }));
      }

      // The deadline crossing into the watched window is its own news, and it
      // arrives without the assignment itself changing at all - usually just the
      // window rolling forward a week. A moved deadline already names the new
      // date, so it is not also announced as due soon.
      if (settings.trackUpcomingAssignments && !deadlineMoved &&
          isDueSoon(next, window.currentEnd, window.today) &&
          !isDueSoon(previous, window.previousEnd, window.today)) {
        changes.push(makeSourceEntry({
          kind: 'due',
          title: next.title,
          detail: withContext(`Due ${formatDeadline(next)}`, next),
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

  function isDueSoon(record, rangeEnd, today) {
    if (!record?.dueDate || !rangeEnd) return false;
    return record.dueDate >= today && record.dueDate <= rangeEnd;
  }

  function withContext(detail, record) {
    return record?.context ? `${detail} · ${record.context}` : detail;
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
    button.title = pickRadarText(status.tooltip);
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
        // Both values go over as { en, da }; the Manager picks the active
        // language when it renders and repaints them when that changes, so
        // this module needs no language listener of its own.
        label: { en: 'Lectio Change Radar', da: 'Lectio Ændringsradar' },
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

  /*
   * ADR-0013's reading order: the Manager's published choice, then the page's
   * own lang (English Mode sets that), then Danish, because Lectio is Danish
   * and a module running without the Manager should stay Danish.
   */
  function radarLanguage() {
    const published = document.documentElement?.dataset?.lectioLanguage;
    if (published === 'en' || published === 'da') return published;
    return (document.documentElement?.lang || '').toLowerCase().startsWith('en') ? 'en' : 'da';
  }

  /*
   * A dock tooltip is handed to the Manager as { en, da } and resolved there at
   * render time, so switching language repaints it without this module doing
   * anything. This resolver is for the floating HUD, which the module draws
   * itself and which is the only surface left when no Manager is installed.
   */
  function pickRadarText(value) {
    if (typeof value === 'string') return value;
    const language = radarLanguage();
    return value?.[language] || value?.en || value?.da || '';
  }

  function getRadarState(history, lastViewed) {
    if (runtime.lastError) {
      return {
        level: 'error', unseen: 0, urgentUnseen: 0,
        heading: 'Radar check problem',
        subheading: runtime.lastError,
        tooltip: {
          en: `Change Radar: ${runtime.lastError}`,
          da: `Ændringsradar: ${runtime.lastError}`
        },
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
        tooltip: {
          en: `Urgent: ${urgentItems.length} unseen upcoming Lectio change${urgentItems.length === 1 ? '' : 's'}.`,
          da: `Haster: ${urgentItems.length} ${urgentItems.length === 1 ? 'uset kommende Lectio-ændring' : 'usete kommende Lectio-ændringer'}.`
        },
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
        tooltip: unseenItems.length
          ? {
            en: `${unseenItems.length} unseen Lectio change${unseenItems.length === 1 ? '' : 's'}.`,
            da: `${unseenItems.length} ${unseenItems.length === 1 ? 'uset Lectio-ændring' : 'usete Lectio-ændringer'}.`
          }
          : { en: 'Recent Lectio changes have been reviewed.', da: 'Nylige Lectio-ændringer er gennemset.' },
        ariaLabel: `Lectio Change Radar. Amber. ${subheading}.`
      };
    }

    return {
      level: 'green', unseen: 0, urgentUnseen: 0,
      heading: 'All clear',
      subheading: runtime.inFlight ? 'Checking Lectio...' : 'No recent changes need attention',
      tooltip: { en: 'Change Radar: all clear.', da: 'Ændringsradar: alt er roligt.' },
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
    try {
      localStorage.setItem(STORAGE.settings, JSON.stringify(settings));
    } catch (_) {
      reportStorageWriteFailure();
    }
  }

  // ---------------------------------------------------------------
  // OWN STORAGE: BOUND, PRUNE AND REPORT (issue #29)
  // ---------------------------------------------------------------

  /*
   * The change log was bounded by entry count and not by size. An entry's own
   * fields are truncated, but a snapshot of a whole watched week sits in the
   * same value, so the real bound on what this module writes is here: the
   * serialised state is capped in characters, and the oldest log entries go
   * until it fits. The state on screen is untouched - only what is written is
   * trimmed - so nothing the user is looking at disappears under them.
   *
   * The cap lives inside the function on purpose. This file is evaluated top
   * to bottom with init() called from a boot block hundreds of lines above
   * here, so a module-scope `const` at this point in the file is still in its
   * temporal dead zone when the first save runs - the shape that shipped as
   * Manager 1.21.0 and again as 1.25.0. A declaration hoists; what is inside
   * it is not evaluated until it is called.
   */
  function boundedStateForStorage(state) {
    const maxChars = 192 * 1024;

    let candidate = state;
    let serialised = JSON.stringify(candidate);

    if (serialised.length <= maxChars) return serialised;

    const history = Array.isArray(state.history) ? [...state.history] : [];

    while (history.length && serialised.length > maxChars) {
      // Newest first in this list, so the oldest entry is the last one.
      history.pop();
      candidate = { ...state, history };
      serialised = JSON.stringify(candidate);
    }

    return serialised;
  }

  // The flag hangs off the function rather than sitting beside it as a
  // module-scope binding, so nothing here can be read before it exists.
  function reportStorageWriteFailure() {
    if (reportStorageWriteFailure.reported) return;
    reportStorageWriteFailure.reported = true;

    try {
      reportToManager('error', 'storage-write', 0);
    } catch (_) {
      // Reporting a failure must never become a second failure.
    }
  }

  function handlePruneStorage(event) {
    const detail = event?.detail;

    // Only the one entry this module declared prunable, matched exactly.
    // Anything else - another module's key, or this module's own settings -
    // removes nothing.
    if (detail?.id !== MODULE.id || detail.key !== STORAGE.state) return;

    try {
      localStorage.removeItem(STORAGE.state);
    } catch (_) {
      return;
    }

    runtime.state = null;
    renderHud();
  }

  /*
   * Stale-cache pruning on load.
   *
   * Every key here is scoped to one identity, and an identity changes when
   * Lectio issues a new student or teacher id - so a browser accumulates a
   * full snapshot per identity it has ever seen at this school, and nothing
   * ever went back for the old ones. One that has not been polled in
   * two months is dropped whole.
   *
   * The threshold is inside the function for the same reason the state cap
   * above is: this is called from the boot block far above this line.
   */
  function pruneStaleStorage() {
    const identityStaleMs = 60 * 24 * 60 * 60 * 1000;
    const schoolPrefix = `lectioChangeRadar.v1.${schoolId}.`;

    try {
      const bases = new Set();

      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (typeof key !== 'string' || !key.startsWith(schoolPrefix)) continue;

        const cut = key.lastIndexOf('.');
        if (cut > 0) bases.add(key.slice(0, cut));
      }

      const doomed = [];

      for (const base of bases) {
        if (base === storageBase) continue;

        const lastPoll = Number(localStorage.getItem(`${base}.lastPoll`) || 0);
        if (lastPoll && Date.now() - lastPoll < identityStaleMs) continue;

        // No lastPoll at all is a half-written leftover, and an old one is a
        // login this browser has not used in two months.
        for (const suffix of ['state', 'lastPoll', 'lastViewed', 'settings']) {
          doomed.push(`${base}.${suffix}`);
        }
      }

      // Collected first: removing while enumerating renumbers the keys behind
      // the cursor and skips every other one.
      for (const key of doomed) localStorage.removeItem(key);
    } catch (_) {
      // Storage unreadable; there is nothing to prune.
    }
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
    try {
      localStorage.setItem(STORAGE.state, boundedStateForStorage(state));
    } catch (_) {
      reportStorageWriteFailure();
    }
  }

  function readNumber(key) {
    try { return Number(localStorage.getItem(key) || 0) || 0; } catch (_) { return 0; }
  }

  function writeNumber(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) { reportStorageWriteFailure(); }
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
      due: 'Due soon',
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
