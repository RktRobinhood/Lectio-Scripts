// ==UserScript==
// @name         Lectio - Chairs Up
// @namespace    https://www.lectio.dk/
// @version      1.4.3
// @description  Shows when a lesson is the final active booking of the day in its room. Universal Lectio version.
// @match        https://www.lectio.dk/lectio/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Chairs-Up.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Chairs-Up.user.js
// ==/UserScript==

(() => {
  'use strict';

  const SETTINGS_KEY =
    'lectioChairsUp.settings.v1';


  /*
   * Everything this module keeps in localStorage, named here rather than
   * further down beside the code that uses it, because the Manager handshake
   * below runs during this file's own evaluation and would otherwise read a
   * const that is still in its temporal dead zone.
   *
   * Both cache prefixes are deliberately school-independent. A key is
   * per-school underneath, but a browser that has been used at two schools is
   * carrying both, and a readout that only admitted to the current one would
   * under-report exactly the case worth seeing.
   */
  const ROOM_MAP_KEY_PREFIX =
    'lectioChairsUp.v102.';

  const ROOM_WEEK_KEY_PREFIX =
    'lectioChairsUp.v104.';

  const DEFAULT_SETTINGS = {
    markerStyle: 'badge',
    showLessonNotice: true
  };

  let settings =
    loadSettings();


  // =========================================================
  // LECTIO MANAGER HANDSHAKE
  // =========================================================

  /*
   * Lets the Manager show this module as installed without
   * touching its private storage. See catalogue/modules.json.
   */
  (function registerWithLectioManager() {
    const MODULE_ID = 'chairs-up';
    const MODULE_NAME = 'Lectio - Chairs Up';
    const MODULE_VERSION = '1.4.3';

    /*
     * The settings panel's own words, in both languages (ADR-0013). The
     * Manager renders these strings exactly as given, so the schema is built
     * from whichever language is current each time announce() runs, and
     * lectio-manager:language re-announces it. Order of authority: the
     * Manager's published choice, then whatever Lectio (or English Mode) put
     * on <html lang>, then Danish, because Lectio is Danish and a module on
     * its own stays Danish.
     *
     * The two literals sit between i18n markers so scripts/check-i18n.mjs can
     * hold their keys in step. Only display strings live here - never a key,
     * a type, a default or an option value.
     */
    function labels() {
      const preferred = document.documentElement?.dataset?.lectioLanguage;
      const language = (preferred || document.documentElement.lang || 'da').toLowerCase();

      return language.startsWith('en')
        // i18n:en
        ? {
          markerStyleLabel: 'Timetable marker',
          markerStyleHelp: 'Choose how strongly the final lesson stands out.',
          markerBadge: 'Chair badge',
          markerOutline: 'Outline',
          markerQuiet: 'Quiet dot',
          lessonNoticeLabel: 'Lesson-page notice',
          lessonNoticeHelp: 'Show the large Chairs Up notice on activity pages.'
        }
        // i18n:da
        : {
          markerStyleLabel: 'Markering i skemaet',
          markerStyleHelp: 'Vælg, hvor tydeligt dagens sidste lektion skal skille sig ud.',
          markerBadge: 'Stolemærke',
          markerOutline: 'Ramme',
          markerQuiet: 'Diskret prik',
          lessonNoticeLabel: 'Besked på aktivitetssiden',
          lessonNoticeHelp: 'Vis den store Chairs Up-besked på aktivitetssider.'
        };
        // i18n:end
    }

    function announce() {
      const text = labels();

      window.dispatchEvent(new CustomEvent('lectio-module:register', {
        detail: {
          id: MODULE_ID,
          name: MODULE_NAME,
          version: MODULE_VERSION,
          settingsSchema: [
            {
              key: 'markerStyle',
              type: 'select',
              label: text.markerStyleLabel,
              description: text.markerStyleHelp,
              options: [
                { value: 'badge', label: text.markerBadge },
                { value: 'outline', label: text.markerOutline },
                { value: 'quiet', label: text.markerQuiet }
              ]
            },
            {
              key: 'showLessonNotice',
              type: 'toggle',
              label: text.lessonNoticeLabel,
              description: text.lessonNoticeHelp
            }
          ],
          currentValues: { ...settings },
          /*
           * What this module keeps in the browser, so the Manager can show it
           * without knowing anything about it (issue #29,
           * docs/manager-storage-api.md). Only the two caches are prunable:
           * both are rebuilt by harvesting Lectio again, which costs a few
           * background requests. The settings blob is not - losing it silently
           * resets someone's chosen marker.
           */
          storage: [
            {
              key: SETTINGS_KEY,
              kind: 'setting',
              label: { en: 'Settings', da: 'Indstillinger' }
            },
            {
              prefix: ROOM_MAP_KEY_PREFIX,
              kind: 'cache',
              prunable: true,
              label: {
                en: 'Harvested room list',
                da: 'Indsamlet lokaleliste'
              }
            },
            {
              prefix: ROOM_WEEK_KEY_PREFIX,
              kind: 'cache',
              prunable: true,
              label: {
                en: 'Cached room timetables',
                da: 'Gemte lokaleskemaer'
              }
            }
          ]
        }
      }));
    }

    /*
     * The Manager asks; this does the deleting. It matches on the prefix it
     * declared and nothing else, so a request naming another module's key, or
     * a key this module never claimed, removes nothing.
     */
    function handlePrune(event) {
      const detail = event?.detail;

      if (detail?.id !== MODULE_ID) {
        return;
      }

      if (
        detail.prefix === ROOM_MAP_KEY_PREFIX ||
        detail.prefix === ROOM_WEEK_KEY_PREFIX
      ) {
        dropKeysWithPrefix(detail.prefix);
      }
    }

    function handleSetting(event) {
      const detail = event?.detail;

      if (detail?.id !== MODULE_ID) {
        return;
      }

      if (
        detail.key === 'markerStyle' &&
        ['badge', 'outline', 'quiet'].includes(detail.value)
      ) {
        settings.markerStyle = detail.value;
      } else if (detail.key === 'showLessonNotice') {
        settings.showLessonNotice = Boolean(detail.value);
      } else {
        return;
      }

      saveSettings();
      applySettingsToPage();
      announce();
    }

    window.addEventListener('lectio-manager:discover', announce);
    window.addEventListener('lectio-manager:set-setting', handleSetting);
    window.addEventListener('lectio-manager:prune-storage', handlePrune);
    // The schema was worded in whichever language was current when it was
    // announced, so a language chosen later is answered with a fresh one.
    window.addEventListener('lectio-manager:language', announce);
    announce();
  })();


  // =========================================================
  // OWN STORAGE: PRUNE AND REPORT
  // =========================================================

  /*
   * A write that fails is still caught and still carried in memory - that rule
   * has not changed. What is new is that it says so, once per page load, as a
   * token with nothing from the page in it. With no Manager installed nothing
   * listens and this is a no-op. See docs/manager-problem-log.md.
   *
   * The once-per-page flag hangs off the function rather than sitting beside
   * it as a module-scope `let`: this file is evaluated top to bottom with the
   * Manager handshake running part-way through it, and a declaration hoists
   * where a binding would still be in its temporal dead zone.
   */
  function reportStorageWriteFailure() {
    if (reportStorageWriteFailure.reported) {
      return;
    }

    reportStorageWriteFailure.reported = true;

    try {
      window.dispatchEvent(new CustomEvent('lectio-module:report', {
        detail: {
          moduleId: 'chairs-up',
          kind: 'error',
          code: 'storage-write'
        }
      }));
    }

    catch (_) {
      // Reporting a failure must never become a second failure.
    }
  }


  function dropKeysWithPrefix(
    prefix
  ) {
    try {
      const doomed = [];

      for (
        let index = 0;
        index < localStorage.length;
        index += 1
      ) {
        const key =
          localStorage.key(index);


        if (
          typeof key === 'string' &&
          key.startsWith(prefix)
        ) {
          doomed.push(key);
        }
      }


      // Collected first: removing while enumerating renumbers the keys behind
      // the cursor and silently skips every other one.
      for (const key of doomed) {
        localStorage.removeItem(key);
      }


      return doomed.length;
    }

    catch (_) {
      return 0;
    }
  }


  /*
   * Expiry that only runs when something happens to look at a cache is expiry
   * that mostly does not run (issue #29). The room map already had a ~30-day
   * life and was only ever checked on the read path; the room-week cache had
   * no life at all - one key per room per week, kept for as long as the
   * browser profile lasts.
   *
   * Both are dropped here, on load, before anything reads them.
   */
  function pruneStaleStorage() {
    try {
      const fetchedAt =
        Number(
          localStorage.getItem(
            ROOM_MAP_TIME_KEY
          ) || 0
        );


      if (
        fetchedAt &&
        Date.now() - fetchedAt >= ROOM_MAP_REFRESH_MS
      ) {
        localStorage.removeItem(ROOM_MAP_KEY);
        localStorage.removeItem(ROOM_MAP_TIME_KEY);
      }
    }

    catch (_) {
      // Nothing to prune if storage cannot be read at all.
    }


    pruneStaleRoomWeeks();
    pruneLegacyStorage();
  }


  /*
   * A room-week entry is a snapshot of one room's bookings in one ISO week.
   * Last week's is never read again, so anything older than the current week
   * goes. This week's and next week's stay, because that is the lookahead the
   * module actually uses.
   */
  function pruneStaleRoomWeeks() {
    const current =
      getISOWeek(
        new Date()
      );


    const cutoff =
      current.isoYear * 100 +
      current.isoWeek;


    try {
      const doomed = [];


      for (
        let index = 0;
        index < localStorage.length;
        index += 1
      ) {
        const key =
          localStorage.key(index);


        if (
          typeof key !== 'string' ||
          !key.startsWith(`${ROOM_WEEK_PREFIX}.`)
        ) {
          continue;
        }


        const parts =
          key.split('.');


        const isoWeek =
          Number(parts[parts.length - 1]);

        const isoYear =
          Number(parts[parts.length - 2]);


        // A key that does not parse is not one this version wrote, and
        // guessing at it is exactly what must not happen here.
        if (
          !Number.isInteger(isoWeek) ||
          !Number.isInteger(isoYear)
        ) {
          continue;
        }


        if (isoYear * 100 + isoWeek < cutoff) {
          doomed.push(key);
        }
      }


      for (const key of doomed) {
        localStorage.removeItem(key);
      }
    }

    catch (_) {
      // Storage unavailable; there is nothing to prune and nothing to say.
    }
  }


  /*
   * Every cache-key scheme this module used before ROOM_MAP_KEY_PREFIX and
   * ROOM_WEEK_KEY_PREFIX (a bare `v1`, then `v3` through `v7`, each
   * abandoned in place rather than migrated when the format next changed)
   * is dead: no version since has ever read or written under one of those
   * old prefixes again. They were never declared to the Manager either, so
   * all they ever did was pile up as bytes nobody could see or clear (the
   * Manager's storage readout shows them as "Not claimed by a running
   * module" precisely because it holds no table of any module's key names -
   * see docs/manager-storage-api.md). Dropping them is this module's job,
   * not the Manager's guess.
   */
  function pruneLegacyStorage() {
    const legacyKeyShape =
      /^lectioChairsUp\.(v\d+\.|roomMap\.v\d+)/;

    try {
      const doomed = [];

      for (
        let index = 0;
        index < localStorage.length;
        index += 1
      ) {
        const key =
          localStorage.key(index);

        if (
          typeof key !== 'string' ||
          key === SETTINGS_KEY ||
          key.startsWith(ROOM_MAP_KEY_PREFIX) ||
          key.startsWith(ROOM_WEEK_KEY_PREFIX)
        ) {
          continue;
        }

        if (legacyKeyShape.test(key)) {
          doomed.push(key);
        }
      }

      // Collected first: removing while enumerating renumbers the keys
      // behind the cursor and silently skips every other one.
      for (const key of doomed) {
        localStorage.removeItem(key);
      }
    }

    catch (_) {
      // Storage unavailable; there is nothing to prune and nothing to say.
    }
  }


  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        markerStyle: ['badge', 'outline', 'quiet'].includes(parsed.markerStyle)
          ? parsed.markerStyle
          : DEFAULT_SETTINGS.markerStyle,
        showLessonNotice: typeof parsed.showLessonNotice === 'boolean'
          ? parsed.showLessonNotice
          : DEFAULT_SETTINGS.showLessonNotice
      };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) {
      // The visual setting still applies for this page when storage is
      // unavailable - but a setting that stops sticking is the symptom this
      // is worth reporting for.
      reportStorageWriteFailure();
    }
  }

  function applySettingsToPage() {
    document.documentElement.dataset.lectioChairsUpMarker = settings.markerStyle;
    document.documentElement.classList.toggle(
      'lectio-chairs-up-hide-notice',
      !settings.showLessonNotice
    );
  }


  // =========================================================
  // SCHOOL
  // =========================================================

  const schoolMatch =
    location.pathname.match(/^\/lectio\/(\d+)\//);

  if (!schoolMatch) return;

  const SCHOOL =
    schoolMatch[1];

  console.info(
    `[Lectio Chairs Up] v1.1.2 started - school ${SCHOOL}`
  );


  // =========================================================
  // CONFIG
  // =========================================================

  const FUTURE_REFRESH_MS =
    24 * 60 * 60 * 1000;

  const ROOM_MAP_REFRESH_MS =
    30 * 24 * 60 * 60 * 1000;

  const SAME_DAY_CHECK_WINDOW_MINUTES =
    15;

  const SAME_DAY_RECHECK_MS =
    10 * 60 * 1000;

  const LOOKAHEAD_DAYS =
    7;


  /*
   * Background-fetch safety net (issue #36).
   *
   * Eight seconds is longer than any healthy Lectio page takes
   * and short enough that a hung request does not outlive the
   * page view. Room-week jobs run one at a time, so once three
   * in a row have failed the rest of the pass backs off instead
   * of spending eight seconds each proving the same point; the
   * wait doubles from two seconds up to a one-minute ceiling,
   * and one success clears it. The start jitter only has to
   * break the lockstep of many browsers loading a timetable on
   * the same bell, so it is small enough nobody notices it.
   */
  const FETCH_TIMEOUT_MS =
    8000;

  const FETCH_FAILURES_BEFORE_BACKOFF =
    3;

  const FETCH_BACKOFF_BASE_MS =
    2000;

  const FETCH_BACKOFF_CEILING_MS =
    60 * 1000;

  const FETCH_START_JITTER_MS =
    750;


  /*
   * The Manager's optional request-slot broker
   * (docs/manager-request-slots.md). The start jitter above keeps
   * this module out of step with other copies of itself; a slot
   * keeps it out of step with the other modules, which is the
   * part no module can arrange on its own because it may not know
   * they exist.
   *
   * Both numbers below belong to this page, and that is what
   * makes the whole thing safe: nothing here can be starved by a
   * Manager. A live Manager answers inside the dispatch, so no
   * answer at all within the first window means no Manager, an old
   * Manager, or one that has stopped - the same case, and it means
   * go now. A `wait` says a live Manager is holding the request
   * behind somebody else, which is worth waiting longer for, but
   * only up to a ceiling this module sets: past it the request
   * goes ahead and hands the slot straight back. Nothing the
   * Manager sends can ask for more patience than this.
   *
   * The id is repeated here because the one the handshake uses
   * lives inside its own function; both are the same string the
   * Manager knows this module by.
   */
  const SLOT_MODULE_ID =
    'chairs-up';

  const SLOT_REQUEST_EVENT =
    'lectio-manager:slot:request';

  const SLOT_WAIT_EVENT =
    'lectio-manager:slot:wait';

  const SLOT_GRANT_EVENT =
    'lectio-manager:slot:grant';

  const SLOT_RELEASE_EVENT =
    'lectio-manager:slot:release';

  const SLOT_ANSWER_MS =
    1200;

  const SLOT_MAX_WAIT_MS =
    8000;


  // =========================================================
  // BACKGROUND FETCH SAFETY NET
  // =========================================================

  /*
   * All of this module's background requests go through
   * fetchHtml(), so the whole safety net fits around that one
   * function: a hard timeout, an abort on pagehide, a backoff
   * after consecutive failures, a jittered first request, and a
   * gate so a request never starts while another is in flight.
   *
   * Every piece of state here lives for one page view and is
   * released on pagehide: the controllers are aborted and the
   * set emptied, and the jitter timer is cleared and its waiter
   * resolved. A page frozen for the back/forward cache gets that
   * same release and then has it lifted again on pageshow.
   */

  const liveFetchControllers =
    new Set();

  let fetchInFlight =
    false;

  let consecutiveFetchFailures =
    0;

  let fetchBackoffUntil =
    0;

  let pendingStartJitterMs =
    -1;

  let startJitterTimer =
    0;

  let releaseStartJitter =
    null;

  let pageIsGoingAway =
    false;

  let pageIsGone =
    false;


  /*
   * Slot requests this page view is still waiting on, and the
   * counter their names come from. Bounded exactly like
   * liveFetchControllers above: an entry goes in when a request is
   * made and comes out when it is released, on every exit path,
   * and abortBackgroundFetches empties whatever is left.
   */
  const pendingSlots =
    new Map();

  let slotSeq =
    0;


  /*
   * Whether the last request this page made went unanswered. A room
   * discovery pass is dozens of requests one after another, and a
   * page view with no Manager on it must not pay the answer window
   * for every one of them: the first request establishes that
   * nothing is listening and the rest go straight through. Any
   * answer clears it again, so a Manager evaluated after this module
   * - or one that comes back - is picked up on the next request
   * rather than ignored for the life of the page.
   */
  let slotsUnanswered =
    false;


  window.addEventListener(
    SLOT_WAIT_EVENT,
    handleSlotAnswer
  );

  window.addEventListener(
    SLOT_GRANT_EVENT,
    handleSlotAnswer
  );


  /*
   * Deliberately not { once: true }, and deliberately split in
   * two. A page frozen for the back/forward cache fires pagehide
   * with persisted set and may be restored without this script
   * ever running again, so a spent listener plus a flag nothing
   * could lift left a restored page permanently switched off -
   * every fetch skipped for the rest of that page's life, with
   * no error to show for it. That is issue #41.
   *
   * A frozen page therefore only has its background fetching
   * suspended, and pageshow puts it back; a page that is
   * genuinely going away is marked gone, and nothing - not even
   * a stray persisted pageshow - lifts the gate again.
   *
   * One registration each, at module scope, so neither listener
   * can accumulate: a bfcache restore does not re-execute the
   * script, and a real navigation discards the page along with
   * both listeners.
   */
  window.addEventListener(
    'pagehide',
    handlePageHide
  );

  window.addEventListener(
    'pageshow',
    resumeBackgroundFetches
  );


  function handlePageHide(
    event
  ) {
    abortBackgroundFetches();


    if (
      event &&
      event.persisted
    ) {
      return;
    }


    pageIsGone =
      true;
  }


  /*
   * Chairs Up does its background work in one pass per page
   * view, driven by main(), so "resume" is exactly this: lift
   * the gate, and the jobs the freeze cut short go through on
   * the pass that is still running. There is no timer to
   * restart.
   */
  function resumeBackgroundFetches(
    event
  ) {
    if (
      !event ||
      !event.persisted ||
      pageIsGone
    ) {
      return;
    }


    pageIsGoingAway =
      false;
  }


  function abortBackgroundFetches() {
    pageIsGoingAway =
      true;


    if (startJitterTimer) {
      clearTimeout(
        startJitterTimer
      );

      startJitterTimer =
        0;
    }


    if (releaseStartJitter) {
      const release =
        releaseStartJitter;

      releaseStartJitter =
        null;

      release();
    }


    for (
      const controller of liveFetchControllers
    ) {
      try {
        controller.abort();
      }

      catch (_) {
        // A controller that is already settled cannot be aborted.
      }
    }


    liveFetchControllers.clear();

    releaseManagerSlots();
  }


  /*
   * Nothing waiting on a turn may outlive the page view, frozen or
   * gone: the waiters are resolved so no promise is left dangling,
   * and every turn is handed back so the Manager is not holding
   * slots for a page that has stopped. The pageIsGoingAway
   * re-check in fetchHtml is what keeps a resolved waiter from
   * starting a request on the way out.
   */
  function releaseManagerSlots() {
    for (
      const pending of [...pendingSlots.values()]
    ) {
      pending.go();
    }


    for (
      const requestId of [...pendingSlots.keys()]
    ) {
      pendingSlots.delete(requestId);

      emitSlot(
        SLOT_RELEASE_EVENT,
        requestId
      );
    }
  }


  function emitSlot(
    name,
    requestId
  ) {
    window.dispatchEvent(
      new CustomEvent(
        name,

        {
          detail: {
            moduleId:
              SLOT_MODULE_ID,

            requestId
          }
        }
      )
    );
  }


  function handleSlotAnswer(
    event
  ) {
    const detail =
      event && event.detail;


    if (
      !detail ||
      detail.moduleId !== SLOT_MODULE_ID
    ) {
      return;
    }


    /*
     * Something is listening after all, so the next request pays the
     * answer window again rather than assuming this page has no
     * broker on it.
     */
    slotsUnanswered =
      false;


    const pending =
      pendingSlots.get(
        detail.requestId
      );


    if (!pending) {
      /*
       * A grant for work this page has already finished or
       * already given up on. Hand it straight back, or the
       * Manager holds a turn for nobody until its own lease
       * runs out and everything else queues behind it.
       */
      if (
        event.type === SLOT_GRANT_EVENT
      ) {
        emitSlot(
          SLOT_RELEASE_EVENT,
          detail.requestId
        );
      }

      return;
    }


    if (
      event.type === SLOT_GRANT_EVENT
    ) {
      pending.go();
    }

    else {
      pending.hold();
    }
  }


  /*
   * Resolves with the function that gives the turn back, and
   * resolves either way - on a grant, or on this page's own
   * timer. There is no rejection path and no path that never
   * settles, which is the whole safety property: the worst a
   * missing, old or broken Manager can cost is SLOT_ANSWER_MS.
   */
  function takeManagerSlot() {
    slotSeq += 1;

    const requestId =
      `r${slotSeq}`;


    return new Promise(
      resolve => {
        let timer = 0;
        let settled = false;
        let held = false;


        const release = () => {
          pendingSlots.delete(
            requestId
          );

          emitSlot(
            SLOT_RELEASE_EVENT,
            requestId
          );
        };


        const go = () => {
          if (settled) {
            return;
          }

          settled = true;

          clearTimeout(timer);

          timer = 0;

          resolve(release);
        };


        /*
         * Going ahead because nothing answered, rather than because
         * the page is being torn down or the Manager said so. That
         * is the one thing worth remembering between requests.
         */
        const giveUp = () => {
          slotsUnanswered =
            true;

          go();
        };


        pendingSlots.set(
          requestId,

          {
            go,

            /*
             * Only the first wait extends anything, so a
             * Manager repeating itself cannot keep pushing
             * this page's own ceiling further out.
             */
            hold() {
              if (
                settled ||
                held
              ) {
                return;
              }

              held = true;

              clearTimeout(timer);

              timer = setTimeout(
                go,
                SLOT_MAX_WAIT_MS
              );
            }
          }
        );


        /*
         * A live Manager answers inside the dispatch below, so even
         * the zero here still gets a grant when there is one to get:
         * the timer cannot fire until the current task ends, and the
         * answer arrives inside it.
         */
        timer = setTimeout(
          giveUp,

          slotsUnanswered
            ? 0
            : SLOT_ANSWER_MS
        );

        emitSlot(
          SLOT_REQUEST_EVENT,
          requestId
        );
      }
    );
  }


  /*
   * The first background request of a page view waits a short
   * random moment, so many browsers opening a timetable on the
   * same bell do not all hit Lectio in the same instant. Later
   * requests in the same page view are not delayed.
   */
  function waitForStartJitter() {
    if (
      pendingStartJitterMs < 0
    ) {
      pendingStartJitterMs =
        Math.floor(
          Math.random() *
          FETCH_START_JITTER_MS
        );
    }


    const delay =
      pendingStartJitterMs;


    pendingStartJitterMs =
      0;


    if (
      delay <= 0 ||
      pageIsGoingAway
    ) {
      return Promise.resolve();
    }


    return new Promise(
      resolve => {
        releaseStartJitter =
          resolve;

        startJitterTimer =
          setTimeout(
            () => {
              startJitterTimer =
                0;

              releaseStartJitter =
                null;

              resolve();
            },
            delay
          );
      }
    );
  }


  function noteFetchFailure() {
    consecutiveFetchFailures +=
      1;


    if (
      consecutiveFetchFailures <
      FETCH_FAILURES_BEFORE_BACKOFF
    ) {
      return;
    }


    const wait =
      Math.min(
        FETCH_BACKOFF_BASE_MS *
        Math.pow(
          2,
          consecutiveFetchFailures -
          FETCH_FAILURES_BEFORE_BACKOFF
        ),
        FETCH_BACKOFF_CEILING_MS
      );


    fetchBackoffUntil =
      Date.now() + wait;
  }


  // =========================================================
  // CACHE
  // =========================================================

  /*
   * IMPORTANT:
   *
   * Keep the room map discovered successfully by v1.0.2/1.0.3.
   * That avoids rediscovering all 74 rooms.
   */
  const ROOM_MAP_PREFIX =
    `${ROOM_MAP_KEY_PREFIX}${SCHOOL}`;

  const ROOM_MAP_KEY =
    `${ROOM_MAP_PREFIX}.roomMap`;

  const ROOM_MAP_TIME_KEY =
    `${ROOM_MAP_PREFIX}.roomMapTime`;


  /*
   * NEW v1.0.4 room-week cache.
   *
   * We intentionally do NOT reuse the previous schedule cache,
   * because it may contain cancelled bookings that were parsed
   * before cancellation-awareness was added.
   */
  const ROOM_WEEK_PREFIX =
    `${ROOM_WEEK_KEY_PREFIX}${SCHOOL}.roomWeek`;


  // =========================================================
  // CSS CLASSES
  // =========================================================

  const LAST_CLASS =
    'lectio-chairs-up-last';

  const ICON_CLASS =
    'lectio-chairs-up-icon';

  const LESSON_NOTICE_CLASS =
    'lectio-chairs-up-lesson-notice';


  // =========================================================
  // ACTIVITY NOTICE LAYOUT
  // =========================================================

  /*
   * The notice only moves out beside the activity paper when the
   * gutter there can hold the whole notice, this gap between the
   * two, and this much breathing space at the window edge.
   */
  const NOTICE_SIDE_GAP =
    18;

  const NOTICE_EDGE_GAP =
    12;


  /*
   * Overlays the notice must never cover: Lectio's jQuery UI
   * dialogs (the Grupper group maker among them), native and
   * ARIA dialogs, Bootstrap modals, and Lectio's own mobile
   * modal background. Each match is still visibility-checked,
   * because Lectio leaves dialog shells in the page unused.
   */
  const OVERLAY_SELECTOR = [
    '.ui-dialog',
    '.ui-widget-overlay',
    '.modal.show',
    '.modal-backdrop',
    '#modalBackgroundID',
    'dialog[open]',
    '[role="dialog"]',
    '[role="alertdialog"]'
  ].join(', ');


  /*
   * The notice watchers' shared state, scoped to the lifetime of
   * a notice: both watchers are torn down again as soon as no
   * notice is left on the page. Declared up here with the rest of
   * the page-view state rather than beside the watchers themselves
   * (NOTICE WATCHERS, far below), because main() is called in the
   * START block during this file's own evaluation, and a
   * module-scope let declared after that call would still be in
   * its temporal dead zone when reached. Nothing main() does
   * synchronously reaches these today; the rule is the same one
   * every module follows, checked by scripts/check-boot-order.mjs
   * (issue #58).
   */
  let noticeObserver =
    null;

  let noticeFrame =
    0;

  let noticeNeedsPlacement =
    false;


  // =========================================================
  // START
  // =========================================================

  injectStyles();
  applySettingsToPage();
  // Before anything reads a cache, so a stale one is gone rather than merely
  // ignored on the one read path that happened to check its age (issue #29).
  pruneStaleStorage();

  main().catch(error => {
    console.error(
      '[Lectio Chairs Up]',
      error
    );
  });


  // =========================================================
  // ROUTER
  // =========================================================

  async function main() {
    const url =
      new URL(location.href);


    // ---------------------------------------------------------
    // Normal timetable
    // ---------------------------------------------------------

    if (
      url.pathname.endsWith('/SkemaNy.aspx')
    ) {
      /*
       * Never decorate a room timetable itself.
       */
      if (
        url.searchParams.get('type') === 'lokale'
      ) {
        return;
      }

      await runTimetablePage();

      return;
    }


    // ---------------------------------------------------------
    // Individual lesson/activity page
    // ---------------------------------------------------------

    if (
      url.pathname.endsWith(
        '/aktivitet/aktivitetforside2.aspx'
      )
    ) {
      await runActivityPage();
    }
  }


  // =========================================================
  // TIMETABLE PAGE
  // =========================================================

  /*
   * Telling the Manager that a selector matched nothing
   * (docs/manager-problem-log.md). One-way and additive: with no Manager
   * installed this lands on a window nobody is listening to, which is a no-op.
   *
   * `code` is a token written here, never text read off the page - there is
   * deliberately no field for a message, because this log is written to be
   * pasted into a public issue.
   */
  function reportToManager(kind, code, found) {
    window.dispatchEvent(new CustomEvent('lectio-module:report', {
      detail: { moduleId: 'chairs-up', kind, code, found }
    }));
  }


  async function runTimetablePage() {
    const lessons =
      getTimetableLessons();


    if (!lessons.length) {
      /*
       * Nothing to mark is the normal case on a day off, and marking nothing
       * is also what happens if Lectio renames the classes this reads. The
       * two look identical on screen, so they are separated here: blocks are
       * on the page and none of them matched.
       */
      if (
        !document.querySelector(
          'a.s2skemabrik.s2brik[data-tooltip]'
        ) &&
        document.querySelector('.s2skemabrik')
      ) {
        reportToManager(
          'drift',
          'lesson-bricks',
          0
        );
      }

      console.info(
        '[Lectio Chairs Up] No live activities with room information found.'
      );

      return;
    }


    console.info(
      '[Lectio Chairs Up] Room candidates:',
      uniqueRoomNamesFromLessons(lessons)
    );


    const roomMap =
      await getRoomMap(
        lessons
      );


    console.info(
      `[Lectio Chairs Up] Room map ready: ${roomMap.size} rooms.`
    );


    /*
     * Paint immediately if we already have schedule cache.
     */
    paintTimetableFromCache(
      lessons,
      roomMap
    );


    const jobs =
      buildRefreshPlan(
        lessons,
        roomMap
      );


    if (!jobs.length) {
      console.info(
        '[Lectio Chairs Up] Room schedule cache is fresh.'
      );

      return;
    }


    await refreshRoomWeeks(
      jobs
    );


    /*
     * Repaint after fresh room data arrives.
     */
    paintTimetableFromCache(
      lessons,
      roomMap
    );
  }


  function getTimetableLessons() {
    return [
      ...document.querySelectorAll(
        'a.s2skemabrik.s2brik[data-tooltip]'
      )
    ]
      /*
       * Cancelled activities are ignored completely.
       */
      .filter(
        element =>
          !isCancelledActivity(
            element
          )
      )
      .map(
        parseLectioActivity
      )
      .filter(Boolean);
  }


  // =========================================================
  // CANCELLATION DETECTION
  // =========================================================

  function isCancelledActivity(
    element
  ) {
    if (!element) {
      return false;
    }


    /*
     * Primary Lectio-native signal.
     *
     * Confirmed on cancelled room booking:
     *
     * class="... s2cancelled ..."
     */
    if (
      element.classList?.contains(
        's2cancelled'
      )
    ) {
      return true;
    }


    /*
     * Sometimes the class may be on a child.
     */
    if (
      element.querySelector?.(
        '.s2cancelled'
      )
    ) {
      return true;
    }


    /*
     * Confirmed secondary signal:
     *
     * data-tooltip="Aflyst! ..."
     */
    const tooltip =
      element.getAttribute?.(
        'data-tooltip'
      ) || '';


    if (
      /^\s*Aflyst!/i.test(
        tooltip
      )
    ) {
      return true;
    }


    /*
     * English fallback in case Lectio/localization ever
     * exposes translated cancellation wording.
     */
    if (
      /^\s*(Cancelled|Canceled)!?/i.test(
        tooltip
      )
    ) {
      return true;
    }


    return false;
  }


  // =========================================================
  // ACTIVITY PAGE
  // =========================================================

  async function runActivityPage() {
    const activityBrick =
      document.querySelector(
        '#s_m_Content_Content_tocAndToolbar_actHeader ' +
        'a.s2skemabrik[data-tooltip]'
      ) ||

      document.querySelector(
        '#homeworkContentContainer ' +
        'a.s2skemabrik[data-tooltip]'
      );


    if (!activityBrick) {
      console.warn(
        '[Lectio Chairs Up] Activity brick not found.'
      );

      return;
    }


    /*
     * A cancelled activity never gets a chair reminder.
     */
    if (
      isCancelledActivity(
        activityBrick
      )
    ) {
      console.info(
        '[Lectio Chairs Up] Activity is cancelled - ignored.'
      );

      removeActivityNotice();

      return;
    }


    const lesson =
      parseLectioActivity(
        activityBrick
      );


    if (!lesson) {
      console.warn(
        '[Lectio Chairs Up] Could not parse activity.'
      );

      return;
    }


    const roomMap =
      await getRoomMap(
        [lesson]
      );


    renderActivityStatusFromCache(
      lesson,
      roomMap
    );


    const jobs =
      buildRefreshPlan(
        [lesson],
        roomMap
      );


    if (!jobs.length) {
      return;
    }


    await refreshRoomWeeks(
      jobs
    );


    renderActivityStatusFromCache(
      lesson,
      roomMap
    );
  }


  function renderActivityStatusFromCache(
    lesson,
    roomMap
  ) {
    removeActivityNotice();


    const statuses =
      calculateLessonRoomStatuses(
        lesson,
        roomMap
      );


    const lastRooms =
      statuses
        .filter(
          item =>
            item.status === 'last'
        )
        .map(
          item =>
            item.room
        );


    if (!lastRooms.length) {
      return;
    }


    createActivityNotice(
      lastRooms
    );
  }


  function createActivityNotice(
    lastRooms
  ) {
    const card =
      document.querySelector(
        '#homeworkContentContainer'
      );


    if (!card) {
      console.warn(
        '[Lectio Chairs Up] Lesson card not found.'
      );

      return;
    }


    card.style.position =
      'relative';


    const notice =
      document.createElement(
        'div'
      );


    notice.className =
      LESSON_NOTICE_CLASS;


    const roomText =
      lastRooms.join(', ');


    notice.innerHTML = `
      <div class="lectio-chairs-up-lesson-chair">
        ${sideChairSvg()}
      </div>

      <div class="lectio-chairs-up-lesson-copy">
        <strong>CHAIRS UP</strong>
        <span>Last active booking in room ${escapeHtml(roomText)}</span>
      </div>
    `;


    /*
     * First child, so the in-flow fallback reads with the
     * activity heading instead of trailing the whole lesson.
     */
    card.insertBefore(
      notice,
      card.firstChild
    );


    placeActivityNotice(
      notice
    );


    watchNoticeSurroundings();
  }


  /*
   * The activity paper is a fixed-width column, so a wide window
   * usually leaves a gutter beside it. The notice moves out there
   * when the gutter can actually hold it, and otherwise stays in
   * the flow above the content, where it cannot cover anything.
   */
  function placeActivityNotice(
    notice
  ) {
    const card =
      notice.parentElement;


    if (!card) {
      return;
    }


    /*
     * A hidden notice measures as zero-width, so leave the
     * placement alone until it is shown again.
     */
    if (
      notice.dataset.overlay ===
        'open'
    ) {
      return;
    }


    /*
     * Measure in the flow first, where the notice takes its
     * natural width.
     */
    notice.dataset.placement =
      'inline';


    const gutter =
      document.documentElement.clientWidth -
      card.getBoundingClientRect().right;


    const needed =
      notice.offsetWidth +
      NOTICE_SIDE_GAP +
      NOTICE_EDGE_GAP;


    if (
      gutter >= needed
    ) {
      notice.dataset.placement =
        'beside';
    }
  }


  function removeActivityNotice() {
    document
      .querySelectorAll(
        `.${LESSON_NOTICE_CLASS}`
      )
      .forEach(
        element =>
          element.remove()
      );


    unwatchNoticeSurroundings();
  }


  // =========================================================
  // LECTIO OVERLAYS
  // =========================================================

  /*
   * Lectio opens dialogs and nested views (the Grupper group
   * maker among them) over the activity page. The notice is
   * page furniture, so it steps aside for all of them rather
   * than competing for the same space.
   */
  function syncNoticeOverlayState() {
    const open =
      isLectioOverlayOpen();


    document
      .querySelectorAll(
        `.${LESSON_NOTICE_CLASS}`
      )
      .forEach(
        notice => {
          const wasOpen =
            notice.dataset.overlay ===
              'open';


          if (
            wasOpen === open
          ) {
            return;
          }


          notice.dataset.overlay =
            open
              ? 'open'
              : 'clear';


          /*
           * The page may have reflowed while the notice was
           * hidden, so re-measure before showing it again.
           */
          if (!open) {
            placeActivityNotice(
              notice
            );
          }
        }
      );
  }


  function isLectioOverlayOpen() {
    return [
      ...document.querySelectorAll(
        OVERLAY_SELECTOR
      )
    ]
      .some(
        isVisibleOverlay
      );
  }


  function isVisibleOverlay(
    element
  ) {
    /*
     * Feature-detected rather than trusted: Lectio leaves
     * dialog shells in the page between uses.
     */
    const style =
      getComputedStyle(
        element
      );


    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return false;
    }


    const box =
      element.getBoundingClientRect();


    return (
      box.width > 0 &&
      box.height > 0
    );
  }


  // =========================================================
  // NOTICE WATCHERS
  // =========================================================

  /*
   * The state these share - noticeObserver, noticeFrame and
   * noticeNeedsPlacement - is declared above the START block with
   * the rest of the page-view state, under ACTIVITY NOTICE LAYOUT.
   */


  function watchNoticeSurroundings() {
    syncNoticeOverlayState();


    if (noticeObserver) {
      return;
    }


    noticeObserver =
      new MutationObserver(
        handleNoticeMutations
      );


    noticeObserver.observe(
      document.body,

      {
        childList: true,
        subtree: true,
        attributes: true,

        attributeFilter: [
          'class',
          'style',
          'open',
          'hidden',
          'aria-hidden'
        ]
      }
    );


    window.addEventListener(
      'resize',
      handleNoticeResize
    );
  }


  function unwatchNoticeSurroundings() {
    if (!noticeObserver) {
      return;
    }


    noticeObserver.disconnect();

    noticeObserver =
      null;


    window.removeEventListener(
      'resize',
      handleNoticeResize
    );


    if (noticeFrame) {
      cancelAnimationFrame(
        noticeFrame
      );

      noticeFrame =
        0;
    }


    noticeNeedsPlacement =
      false;
  }


  function handleNoticeMutations() {
    scheduleNoticeSync();
  }


  function handleNoticeResize() {
    noticeNeedsPlacement =
      true;

    scheduleNoticeSync();
  }


  function scheduleNoticeSync() {
    if (noticeFrame) {
      return;
    }


    noticeFrame =
      requestAnimationFrame(
        runNoticeSync
      );
  }


  function runNoticeSync() {
    noticeFrame =
      0;


    const notices =
      document.querySelectorAll(
        `.${LESSON_NOTICE_CLASS}`
      );


    if (!notices.length) {
      unwatchNoticeSurroundings();

      return;
    }


    if (noticeNeedsPlacement) {
      noticeNeedsPlacement =
        false;


      notices.forEach(
        placeActivityNotice
      );
    }


    syncNoticeOverlayState();
  }


  // =========================================================
  // ACTIVITY PARSER
  // =========================================================

  function parseLectioActivity(
    element
  ) {
    /*
     * Defensive cancellation check.
     */
    if (
      isCancelledActivity(
        element
      )
    ) {
      return null;
    }


    const tooltip =
      element.getAttribute(
        'data-tooltip'
      ) || '';


    const timed =
      tooltip.match(
        /(\d{1,2})\/(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s+til\s+(\d{1,2}):(\d{2})/i
      );


    if (!timed) {
      return null;
    }


    const roomsMatch =
      tooltip.match(
        /Lokaler?\s*:\s*([^\n\r]+)/i
      );


    if (!roomsMatch) {
      return null;
    }


    const [
      ,
      day,
      month,
      year,
      startHour,
      startMinute,
      endHour,
      endMinute
    ] =
      timed;


    const rooms =
      roomsMatch[1]
        .split(
          /\s*,\s*|\s*;\s*/
        )
        .map(
          normalizeRoom
        )
        .filter(Boolean);


    if (!rooms.length) {
      return null;
    }


    const dateObj =
      new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(startHour),
        Number(startMinute),
        0,
        0
      );


    return {
      el:
        element,

      rooms,

      absid:
        getAbsId(
          element
        ),

      dateObj,

      isoDate:
        `${year}-${pad2(month)}-${pad2(day)}`,

      startMinutes:
        Number(startHour) * 60 +
        Number(startMinute),

      endMinutes:
        Number(endHour) * 60 +
        Number(endMinute)
    };
  }


  // =========================================================
  // UNIVERSAL ROOM DISCOVERY
  // =========================================================

  async function getRoomMap(
    lessons = []
  ) {
    const cached =
      loadCachedRoomMap();


    if (cached) {
      console.info(
        `[Lectio Chairs Up] Using cached room map: ${cached.size} rooms.`
      );

      return cached;
    }


    const targetRooms =
      uniqueRoomNamesFromLessons(
        lessons
      );


    console.info(
      `[Lectio Chairs Up] Building universal room map for school ${SCHOOL}.`
    );


    console.info(
      '[Lectio Chairs Up] Need rooms:',
      targetRooms
    );


    // ---------------------------------------------------------
    // Current page may expose room links
    // ---------------------------------------------------------

    const directlyFound =
      new Map();


    discoverRoomLinks(
      document,
      directlyFound
    );


    if (
      directlyFound.size
    ) {
      const seed =
        firstMapValue(
          directlyFound
        );


      if (seed) {
        const fullMap =
          await tryHarvestFullMap(
            seed
          );


        if (
          fullMap &&
          fullMap.size
        ) {
          saveRoomMap(
            fullMap
          );

          return fullMap;
        }
      }
    }


    // ---------------------------------------------------------
    // Activity-edit bootstrap
    // ---------------------------------------------------------

    const seedResult =
      await discoverSeedFromActivities(
        lessons
      );


    if (
      seedResult &&
      seedResult.roomId
    ) {
      console.info(
        `[Lectio Chairs Up] Resolved seed room ${seedResult.roomName} -> ${seedResult.roomId}`
      );


      const fullMap =
        await tryHarvestFullMap(
          seedResult.roomId
        );


      if (
        fullMap &&
        fullMap.size
      ) {
        console.info(
          `[Lectio Chairs Up] SUCCESS - harvested ${fullMap.size} rooms.`
        );


        saveRoomMap(
          fullMap
        );


        return fullMap;
      }
    }


    // ---------------------------------------------------------
    // Schedule front page fallback
    // ---------------------------------------------------------

    const frontPageMap =
      await tryScheduleFrontPage();


    if (
      frontPageMap.size
    ) {
      const seed =
        firstMapValue(
          frontPageMap
        );


      if (seed) {
        const fullMap =
          await tryHarvestFullMap(
            seed
          );


        if (
          fullMap &&
          fullMap.size
        ) {
          saveRoomMap(
            fullMap
          );

          return fullMap;
        }
      }
    }


    throw new Error(
      `Could not discover room IDs for Lectio school ${SCHOOL}.`
    );
  }


  // =========================================================
  // ACTIVITY EDIT PAGE BOOTSTRAP
  // =========================================================

  async function discoverSeedFromActivities(
    lessons
  ) {
    const tried =
      new Set();


    const candidates =
      lessons
        .filter(
          lesson =>
            lesson.absid &&
            lesson.rooms.length
        )
        .slice(
          0,
          4
        );


    for (
      const lesson of candidates
    ) {
      if (
        tried.has(
          lesson.absid
        )
      ) {
        continue;
      }


      tried.add(
        lesson.absid
      );


      const url =
        `/lectio/${SCHOOL}/aktivitet/aktivitetrediger.aspx` +
        `?action=edit` +
        `&id=${encodeURIComponent(lesson.absid)}`;


      console.info(
        '[Lectio Chairs Up] Inspecting activity edit page:',
        {
          absid:
            lesson.absid,

          rooms:
            lesson.rooms
        }
      );


      try {
        const doc =
          await fetchHtml(
            url
          );


        for (
          const room of lesson.rooms
        ) {
          const roomId =
            findRoomIdInEditDocument(
              doc,
              room
            );


          if (roomId) {
            return {
              roomName:
                room,

              roomId
            };
          }
        }


        const rawHtml =
          doc.documentElement.outerHTML;


        for (
          const room of lesson.rooms
        ) {
          const roomId =
            findRoomIdNearRoomName(
              rawHtml,
              room
            );


          if (roomId) {
            return {
              roomName:
                room,

              roomId
            };
          }
        }
      }

      catch (error) {
        console.warn(
          '[Lectio Chairs Up] Could not inspect activity edit page:',
          error
        );
      }
    }


    return null;
  }


  function findRoomIdInEditDocument(
    doc,
    targetRoom
  ) {
    const wanted =
      normalizeRoom(
        targetRoom
      );


    // ---------------------------------------------------------
    // Options
    // ---------------------------------------------------------

    for (
      const option of doc.querySelectorAll(
        'option'
      )
    ) {
      const text =
        normalizeRoom(
          option.textContent
        );


      if (
        !roomNamesMatch(
          text,
          wanted
        )
      ) {
        continue;
      }


      const id =
        extractRoomIdFromElement(
          option
        );


      if (id) {
        console.info(
          '[Lectio Chairs Up] Room found on edit control:',
          wanted,
          id
        );

        return id;
      }
    }


    // ---------------------------------------------------------
    // Custom Lectio controls
    // ---------------------------------------------------------

    const elements =
      doc.querySelectorAll(
        'input, a, span, div, li, label, [data-value], [data-id]'
      );


    for (
      const element of elements
    ) {
      const text =
        normalizeRoom(
          element.textContent
        );


      const value =
        normalizeRoom(
          element.getAttribute?.(
            'value'
          )
        );


      const smallTextMatch =
        text &&
        text.length <= 100 &&
        roomTextContains(
          text,
          wanted
        );


      const valueMatch =
        value &&
        value.length <= 100 &&
        roomTextContains(
          value,
          wanted
        );


      if (
        !smallTextMatch &&
        !valueMatch
      ) {
        continue;
      }


      let id =
        extractRoomIdFromElement(
          element
        );


      if (id) {
        return id;
      }


      const parent =
        element.parentElement;


      if (parent) {
        id =
          extractRoomIdFromElement(
            parent
          );


        if (id) {
          return id;
        }
      }
    }


    return null;
  }


  function findRoomIdNearRoomName(
    html,
    roomName
  ) {
    const wanted =
      String(
        roomName || ''
      ).trim();


    if (!wanted) {
      return null;
    }


    const lowerHtml =
      html.toLowerCase();


    const lowerRoom =
      wanted.toLowerCase();


    let startIndex =
      0;


    for (
      let attempt = 0;
      attempt < 25;
      attempt++
    ) {
      const index =
        lowerHtml.indexOf(
          lowerRoom,
          startIndex
        );


      if (
        index === -1
      ) {
        break;
      }


      const from =
        Math.max(
          0,
          index - 700
        );


      const to =
        Math.min(
          html.length,
          index +
          lowerRoom.length +
          700
        );


      const neighbourhood =
        html.slice(
          from,
          to
        );


      const id =
        extractRoomIdFromString(
          neighbourhood,
          true
        );


      if (id) {
        return id;
      }


      startIndex =
        index +
        lowerRoom.length;
    }


    return null;
  }


  // =========================================================
  // ROOM ID EXTRACTION
  // =========================================================

  function extractRoomIdFromElement(
    element
  ) {
    const candidates = [];


    if (
      element.value !== undefined
    ) {
      candidates.push(
        String(
          element.value || ''
        )
      );
    }


    if (
      element.attributes
    ) {
      for (
        const attr of element.attributes
      ) {
        candidates.push(
          String(
            attr.value || ''
          )
        );
      }
    }


    const nearbyInputs =
      element.parentElement
        ?.querySelectorAll?.(
          'input[type="hidden"]'
        ) || [];


    for (
      const input of nearbyInputs
    ) {
      candidates.push(
        String(
          input.value || ''
        )
      );


      for (
        const attr of input.attributes || []
      ) {
        candidates.push(
          String(
            attr.value || ''
          )
        );
      }
    }


    for (
      const candidate of candidates
    ) {
      const id =
        extractRoomIdFromString(
          candidate
        );


      if (id) {
        return id;
      }
    }


    return null;
  }


  function extractRoomIdFromString(
    value,
    allowLoose = false
  ) {
    const text =
      String(
        value || ''
      );


    let match =
      text.match(
        /\bRO(\d{5,})\b/i
      );


    if (match) {
      return match[1];
    }


    match =
      text.match(
        /anyLectioId\s*=\s*(?:RO)?(\d{5,})/i
      );


    if (match) {
      return match[1];
    }


    match =
      text.match(
        /type\s*=\s*lokale[\s\S]{0,180}?[?&](?:amp;)?id\s*=\s*(\d{5,})/i
      );


    if (match) {
      return match[1];
    }


    match =
      text.match(
        /(?:lokale|lokaleid|room|roomid)\s*[=:]\s*(?:RO)?(\d{5,})/i
      );


    if (match) {
      return match[1];
    }


    match =
      text.match(
        /value\s*=\s*["'](?:RO)(\d{5,})["']/i
      );


    if (match) {
      return match[1];
    }


    if (allowLoose) {
      match =
        text.match(
          /(?:value|data-value|data-id)\s*=\s*["'](\d{5,})["']/i
        );


      if (match) {
        return match[1];
      }
    }


    return null;
  }


  // =========================================================
  // ROOM PAGE / FULL ROOM MAP
  // =========================================================

  async function tryHarvestFullMap(
    seedRoomId
  ) {
    try {
      console.info(
        '[Lectio Chairs Up] Opening seed room timetable:',
        seedRoomId
      );


      const map =
        await harvestFullRoomMap(
          seedRoomId
        );


      if (
        map.size
      ) {
        return map;
      }
    }

    catch (error) {
      console.warn(
        '[Lectio Chairs Up] Could not harvest room map:',
        error
      );
    }


    return null;
  }


  async function harvestFullRoomMap(
    seedRoomId
  ) {
    const url =
      `/lectio/${SCHOOL}/SkemaNy.aspx` +
      `?type=lokale` +
      `&nosubnav=1` +
      `&id=${encodeURIComponent(seedRoomId)}` +
      `&showtype=0`;


    const doc =
      await fetchHtml(
        url
      );


    const map =
      new Map();


    const table =
      doc.querySelector(
        '[id$="_linkTable"]'
      );


    if (table) {
      for (
        const link of table.querySelectorAll(
          'a[href*="type=lokale"]'
        )
      ) {
        addRoomLinkToMap(
          link,
          map
        );
      }
    }


    if (
      map.size < 2
    ) {
      discoverRoomLinks(
        doc,
        map
      );
    }


    console.info(
      `[Lectio Chairs Up] Room timetable exposed ${map.size} room links.`
    );


    return map;
  }


  function discoverRoomLinks(
    doc,
    map
  ) {
    for (
      const link of doc.querySelectorAll(
        'a[href*="SkemaNy.aspx"][href*="type=lokale"]'
      )
    ) {
      addRoomLinkToMap(
        link,
        map
      );
    }
  }


  function addRoomLinkToMap(
    link,
    map
  ) {
    const roomName =
      normalizeRoom(
        link.textContent
      );


    if (
      !roomName ||
      roomName.length > 80
    ) {
      return;
    }


    try {
      const url =
        new URL(
          link.getAttribute(
            'href'
          ),
          location.origin
        );


      if (
        url.searchParams.get(
          'type'
        ) !== 'lokale'
      ) {
        return;
      }


      const id =
        url.searchParams.get(
          'id'
        );


      if (id) {
        map.set(
          roomName,
          id
        );
      }
    }

    catch (_) {
      // Ignore malformed links.
    }
  }


  // =========================================================
  // SCHEDULE FRONT PAGE FALLBACK
  // =========================================================

  async function tryScheduleFrontPage() {
    const map =
      new Map();


    const url =
      `/lectio/${SCHOOL}/SkemaForside/SkemaForside.aspx`;


    try {
      const doc =
        await fetchHtml(
          url
        );


      discoverRoomLinks(
        doc,
        map
      );


      for (
        const option of doc.querySelectorAll(
          'select option'
        )
      ) {
        const text =
          normalizeRoom(
            option.textContent
          );


        if (!text) {
          continue;
        }


        const id =
          extractRoomIdFromElement(
            option
          );


        if (id) {
          map.set(
            text,
            id
          );
        }
      }
    }

    catch (_) {
      // Fallback only.
    }


    return map;
  }


  // =========================================================
  // ROOM MAP CACHE
  // =========================================================

  function loadCachedRoomMap() {
    try {
      const data =
        JSON.parse(
          localStorage.getItem(
            ROOM_MAP_KEY
          ) || 'null'
        );


      const fetchedAt =
        Number(
          localStorage.getItem(
            ROOM_MAP_TIME_KEY
          ) || 0
        );


      if (
        !data ||
        !Object.keys(
          data
        ).length
      ) {
        return null;
      }


      if (
        Date.now() -
        fetchedAt >=
        ROOM_MAP_REFRESH_MS
      ) {
        return null;
      }


      return new Map(
        Object.entries(
          data
        )
      );
    }

    catch (_) {
      return null;
    }
  }


  function saveRoomMap(
    map
  ) {
    try {
      localStorage.setItem(
        ROOM_MAP_KEY,

        JSON.stringify(
          Object.fromEntries(
            map
          )
        )
      );


      localStorage.setItem(
        ROOM_MAP_TIME_KEY,
        String(
          Date.now()
        )
      );
    }

    catch (error) {
      console.warn(
        '[Lectio Chairs Up] Could not save room map:',
        error
      );
    


      reportStorageWriteFailure();
    }
  }


  // =========================================================
  // LAST ACTIVE BOOKING LOGIC
  // =========================================================

  function calculateLessonRoomStatuses(
    lesson,
    roomMap
  ) {
    const statuses = [];


    for (
      const room of lesson.rooms
    ) {
      const roomId =
        roomMap.get(
          normalizeRoom(
            room
          )
        );


      if (!roomId) {
        statuses.push({
          room,
          status:
            'unknown'
        });

        continue;
      }


      const {
        isoWeek,
        isoYear
      } =
        getISOWeek(
          lesson.dateObj
        );


      const cache =
        getRoomWeekCache(
          roomId,
          isoWeek,
          isoYear
        );


      if (!cache) {
        statuses.push({
          room,
          status:
            'unknown'
        });

        continue;
      }


      /*
       * IMPORTANT:
       *
       * The room-week parser below already removes all
       * cancelled bookings before anything gets cached.
       */
      const bookings =
        cache.days?.[
          lesson.isoDate
        ] || [];


      const laterOccupancyExists =
        bookings.some(
          booking => {

            /*
             * Same Lectio activity.
             */
            if (
              lesson.absid &&
              booking.absid &&
              lesson.absid ===
                booking.absid
            ) {
              return false;
            }


            /*
             * Defensive self-match if Lectio exposes the same
             * occupancy under slightly different activity IDs.
             */
            const sameTime =
              booking.startMinutes ===
                lesson.startMinutes &&
              booking.endMinutes ===
                lesson.endMinutes;


            if (sameTime) {
              return false;
            }


            /*
             * If another LIVE booking continues beyond this
             * lesson, this is not the final active occupancy.
             */
            return (
              booking.endMinutes >
              lesson.endMinutes
            );
          }
        );


      statuses.push({
        room,

        status:
          laterOccupancyExists
            ? 'later'
            : 'last'
      });
    }


    return statuses;
  }


  // =========================================================
  // TIMETABLE PAINT
  // =========================================================

  function paintTimetableFromCache(
    lessons,
    roomMap
  ) {
    /*
     * First remove any stale badge from a cancelled activity
     * that may already exist in the DOM.
     */
    document
      .querySelectorAll(
        `.${ICON_CLASS}`
      )
      .forEach(
        icon => {
          const activity =
            icon.closest(
              'a.s2skemabrik'
            );

          if (
            activity &&
            isCancelledActivity(
              activity
            )
          ) {
            icon.remove();

            activity.classList.remove(
              LAST_CLASS
            );
          }
        }
      );


    for (
      const lesson of lessons
    ) {
      const statuses =
        calculateLessonRoomStatuses(
          lesson,
          roomMap
        );


      decorateTimetableLesson(
        lesson.el,
        statuses
      );
    }
  }


  function decorateTimetableLesson(
    element,
    statuses
  ) {
    /*
     * Absolute safety:
     * never decorate cancelled activities.
     */
    if (
      isCancelledActivity(
        element
      )
    ) {
      element
        .querySelectorAll(
          `.${ICON_CLASS}`
        )
        .forEach(
          node =>
            node.remove()
        );

      element.classList.remove(
        LAST_CLASS
      );

      return;
    }


    element
      .querySelectorAll(
        `.${ICON_CLASS}`
      )
      .forEach(
        node =>
          node.remove()
      );


    element.classList.remove(
      LAST_CLASS
    );


    const lastRooms =
      statuses
        .filter(
          item =>
            item.status === 'last'
        )
        .map(
          item =>
            item.room
        );


    const unknownRooms =
      statuses
        .filter(
          item =>
            item.status === 'unknown'
        )
        .map(
          item =>
            item.room
        );


    if (!lastRooms.length) {
      return;
    }


    element.classList.add(
      LAST_CLASS
    );


    const icon =
      document.createElement(
        'div'
      );


    icon.className =
      ICON_CLASS;


    const tooltip =
      buildTooltip(
        lastRooms,
        unknownRooms
      );


    icon.setAttribute(
      'title',
      tooltip
    );


    icon.setAttribute(
      'aria-label',
      tooltip
    );


    icon.innerHTML =
      sideChairSvg();


    element.appendChild(
      icon
    );
  }


  function buildTooltip(
    lastRooms,
    unknownRooms
  ) {
    let text =
      `CHAIRS UP - Last active booking in ${lastRooms.join(', ')}`;


    if (
      unknownRooms.length
    ) {
      text +=
        `\nCould not verify: ${unknownRooms.join(', ')}`;
    }


    return text;
  }


  // =========================================================
  // REFRESH POLICY
  // =========================================================

  function buildRefreshPlan(
    lessons,
    roomMap
  ) {
    const now =
      new Date();


    const jobs =
      new Map();


    for (
      const lesson of lessons
    ) {
      const daysAway =
        differenceInCalendarDays(
          lesson.dateObj,
          now
        );


      if (
        daysAway < 0 ||
        daysAway >
          LOOKAHEAD_DAYS
      ) {
        continue;
      }


      for (
        const room of lesson.rooms
      ) {
        const roomId =
          roomMap.get(
            normalizeRoom(
              room
            )
          );


        if (!roomId) {
          console.warn(
            '[Lectio Chairs Up] Room unresolved:',
            room
          );

          continue;
        }


        const {
          isoWeek,
          isoYear
        } =
          getISOWeek(
            lesson.dateObj
          );


        const key =
          `${roomId}|${isoYear}|${isoWeek}`;


        const cache =
          getRoomWeekCache(
            roomId,
            isoWeek,
            isoYear
          );


        const cacheAge =
          cache
            ? Date.now() -
              Number(
                cache.fetchedAt || 0
              )
            : Infinity;


        let shouldRefresh =
          false;


        let reason =
          '';


        // -----------------------------------------------------
        // Future days
        // -----------------------------------------------------

        if (
          daysAway > 0 &&
          cacheAge >=
            FUTURE_REFRESH_MS
        ) {
          shouldRefresh =
            true;


          reason =
            'daily-future-refresh';
        }


        // -----------------------------------------------------
        // Today
        // -----------------------------------------------------

        if (
          daysAway === 0
        ) {
          const minutesUntilClass =
            (
              lesson.dateObj.getTime() -
              now.getTime()
            ) /
            60000;


          const nearClass =
            minutesUntilClass <=
              SAME_DAY_CHECK_WINDOW_MINUTES &&
            minutesUntilClass >=
              -5;


          if (!cache) {
            shouldRefresh =
              true;


            reason =
              'missing-today-cache';
          }

          else if (
            nearClass &&
            cacheAge >=
              SAME_DAY_RECHECK_MS
          ) {
            shouldRefresh =
              true;


            reason =
              'near-class-check';
          }
        }


        if (
          shouldRefresh &&
          !jobs.has(
            key
          )
        ) {
          jobs.set(
            key,

            {
              roomId,
              isoWeek,
              isoYear,
              reason
            }
          );
        }
      }
    }


    return [
      ...jobs.values()
    ];
  }


  // =========================================================
  // FETCH ROOM SCHEDULES
  // =========================================================

  async function refreshRoomWeeks(
    jobs
  ) {
    console.info(
      '[Lectio Chairs Up] Refreshing:',
      jobs.map(
        job =>
          `${job.roomId} (${job.reason})`
      )
    );


    /*
     * One job at a time. This used to be a Promise.all(), which
     * fired every room-week request at Lectio in the same
     * instant; with a hard timeout on each of them that burst is
     * also the worst case for a hung network, and the backoff
     * below can only cut a pass short if it can see the previous
     * request's outcome before starting the next.
     */
    for (
      const job of jobs
    ) {
      try {
        const data =
          await fetchAndParseRoomWeek(
            job.roomId,
            job.isoWeek,
            job.isoYear
          );


        saveRoomWeekCache(
          job.roomId,
          job.isoWeek,
          job.isoYear,
          data
        );
      }

      catch (error) {
        console.warn(
          '[Lectio Chairs Up] Room refresh failed:',
          job,
          error
        );
      }
    }
  }


  async function fetchAndParseRoomWeek(
    roomId,
    isoWeek,
    isoYear
  ) {
    const url =
      `/lectio/${SCHOOL}/SkemaNy.aspx` +
      `?type=lokale` +
      `&nosubnav=1` +
      `&id=${encodeURIComponent(roomId)}` +
      `&week=${isoWeek}${isoYear}` +
      `&showtype=0`;


    const doc =
      await fetchHtml(
        url
      );


    const days = {};


    let cancelledCount =
      0;


    for (
      const cell of doc.querySelectorAll(
        'td[data-date]'
      )
    ) {
      const isoDate =
        cell.getAttribute(
          'data-date'
        );


      if (!isoDate) {
        continue;
      }


      const bookingElements =
        [
          ...cell.querySelectorAll(
            'a.s2skemabrik.s2brik[data-tooltip]'
          )
        ];


      /*
       * Useful diagnostic during testing.
       */
      cancelledCount +=
        bookingElements.filter(
          element =>
            isCancelledActivity(
              element
            )
        ).length;


      /*
       * parseRoomBooking() returns null for cancelled
       * activities, so they never enter the cache.
       */
      const bookings =
        bookingElements
          .map(
            parseRoomBooking
          )
          .filter(Boolean);


      days[isoDate] =
        bookings;
    }


    if (
      cancelledCount > 0
    ) {
      console.info(
        `[Lectio Chairs Up] Ignored ${cancelledCount} cancelled booking(s) in room ${roomId}, week ${isoWeek}.`
      );
    }


    return {
      fetchedAt:
        Date.now(),

      days
    };
  }


  // =========================================================
  // ROOM BOOKING PARSER
  // =========================================================

  function parseRoomBooking(
    element
  ) {
    const tooltip =
      element.getAttribute(
        'data-tooltip'
      ) || '';


    /*
     * =======================================================
     * v1.0.4 CANCELLATION FIX
     * =======================================================
     *
     * Confirmed Lectio structure:
     *
     * class:
     *   s2skemabrik s2bgbox s2cancelled s2brik ...
     *
     * tooltip:
     *   Aflyst!
     *   10/9-2026 13:55 til 15:05
     *   ...
     *
     * Cancelled bookings are therefore treated as if the
     * room is empty.
     */
    if (
      isCancelledActivity(
        element
      )
    ) {
      return null;
    }


    const timed =
      tooltip.match(
        /(\d{1,2})\/(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s+til\s+(\d{1,2}):(\d{2})/i
      );


    if (!timed) {
      return null;
    }


    return {
      absid:
        getAbsId(
          element
        ),

      startMinutes:
        Number(
          timed[4]
        ) *
        60 +
        Number(
          timed[5]
        ),

      endMinutes:
        Number(
          timed[6]
        ) *
        60 +
        Number(
          timed[7]
        )
    };
  }


  // =========================================================
  // ROOM-WEEK CACHE
  // =========================================================

  function roomWeekCacheKey(
    roomId,
    isoWeek,
    isoYear
  ) {
    return (
      `${ROOM_WEEK_PREFIX}.` +
      `${roomId}.` +
      `${isoYear}.` +
      `${isoWeek}`
    );
  }


  function getRoomWeekCache(
    roomId,
    isoWeek,
    isoYear
  ) {
    try {
      return JSON.parse(
        localStorage.getItem(
          roomWeekCacheKey(
            roomId,
            isoWeek,
            isoYear
          )
        ) || 'null'
      );
    }

    catch (_) {
      return null;
    }
  }


  function saveRoomWeekCache(
    roomId,
    isoWeek,
    isoYear,
    data
  ) {
    try {
      localStorage.setItem(
        roomWeekCacheKey(
          roomId,
          isoWeek,
          isoYear
        ),

        JSON.stringify(
          data
        )
      );
    }

    catch (error) {
      console.warn(
        '[Lectio Chairs Up] Room cache write failed:',
        error
      );
    


      reportStorageWriteFailure();
    }
  }


  // =========================================================
  // GENERIC HELPERS
  // =========================================================

  function uniqueRoomNamesFromLessons(
    lessons
  ) {
    return [
      ...new Set(
        lessons.flatMap(
          lesson =>
            lesson.rooms.map(
              normalizeRoom
            )
        )
      )
    ];
  }


  function firstMapValue(
    map
  ) {
    for (
      const value of map.values()
    ) {
      if (value) {
        return value;
      }
    }


    return null;
  }


  function roomNamesMatch(
    a,
    b
  ) {
    return (
      normalizeRoom(a)
        .toLowerCase() ===
      normalizeRoom(b)
        .toLowerCase()
    );
  }


  function roomTextContains(
    text,
    room
  ) {
    const haystack =
      normalizeRoom(
        text
      ).toLowerCase();


    const needle =
      normalizeRoom(
        room
      ).toLowerCase();


    if (
      !haystack ||
      !needle
    ) {
      return false;
    }


    if (
      haystack === needle
    ) {
      return true;
    }


    const escaped =
      escapeRegex(
        needle
      );


    return new RegExp(
      `(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,
      'i'
    ).test(
      haystack
    );
  }


  function escapeRegex(
    value
  ) {
    return String(
      value
    ).replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );
  }


  async function fetchHtml(
    url
  ) {
    if (pageIsGoingAway) {
      throw new Error(
        `Skipped ${url}: the page is going away.`
      );
    }


    /*
     * Never stack: a request that arrives while another is in
     * flight is skipped, not queued behind it.
     */
    if (fetchInFlight) {
      throw new Error(
        `Skipped ${url}: another background request is already in flight.`
      );
    }


    if (
      Date.now() <
      fetchBackoffUntil
    ) {
      throw new Error(
        `Skipped ${url}: backing off after ${consecutiveFetchFailures} failed request(s).`
      );
    }


    await waitForStartJitter();


    if (pageIsGoingAway) {
      throw new Error(
        `Skipped ${url}: the page is going away.`
      );
    }


    /*
     * Ask the Manager for a turn before anything is armed, so a
     * request that waits does not spend its own timeout waiting.
     */
    const releaseSlot =
      await takeManagerSlot();


    if (pageIsGoingAway) {
      releaseSlot();

      throw new Error(
        `Skipped ${url}: the page is going away.`
      );
    }


    const controller =
      new AbortController();


    const timeoutTimer =
      setTimeout(
        () =>
          controller.abort(),
        FETCH_TIMEOUT_MS
      );


    fetchInFlight =
      true;

    liveFetchControllers.add(
      controller
    );


    try {
      const response =
        await fetch(
          url,

          {
            method:
              'GET',

            credentials:
              'include',

            cache:
              'no-store',

            headers: {
              Accept:
                'text/html,application/xhtml+xml'
            },

            signal:
              controller.signal
          }
        );


      if (
        !response.ok
      ) {
        throw new Error(
          `HTTP ${response.status} loading ${url}`
        );
      }


      const html =
        await response.text();


      consecutiveFetchFailures =
        0;

      fetchBackoffUntil =
        0;


      return new DOMParser()
        .parseFromString(
          html,
          'text/html'
        );
    }

    catch (error) {
      noteFetchFailure();

      throw error;
    }

    finally {
      clearTimeout(
        timeoutTimer
      );

      liveFetchControllers.delete(
        controller
      );

      fetchInFlight =
        false;

      releaseSlot();
    }
  }


  function getAbsId(
    element
  ) {
    const href =
      element.getAttribute(
        'href'
      ) || '';


    const hrefMatch =
      href.match(
        /[?&]absid=(\d+)/i
      );


    if (
      hrefMatch
    ) {
      return hrefMatch[1];
    }


    const brik =
      element.getAttribute(
        'data-brikid'
      ) || '';


    const brikMatch =
      brik.match(
        /ABS(\d+)/i
      );


    if (
      brikMatch
    ) {
      return brikMatch[1];
    }


    return (
      new URL(
        location.href
      )
        .searchParams
        .get(
          'absid'
        )
    );
  }


  function normalizeRoom(
    value
  ) {
    return String(
      value || ''
    )
      .replace(
        /\u00a0/g,
        ' '
      )
      .trim()
      .replace(
        /\s+/g,
        ' '
      );
  }


  function pad2(
    value
  ) {
    return String(
      value
    )
      .padStart(
        2,
        '0'
      );
  }


  function startOfDay(
    date
  ) {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      0,
      0,
      0,
      0
    );
  }


  function differenceInCalendarDays(
    a,
    b
  ) {
    return Math.round(
      (
        startOfDay(
          a
        ).getTime() -
        startOfDay(
          b
        ).getTime()
      ) /
      86400000
    );
  }


  function getISOWeek(
    date
  ) {
    const d =
      new Date(
        Date.UTC(
          date.getFullYear(),
          date.getMonth(),
          date.getDate()
        )
      );


    const dayNumber =
      d.getUTCDay() || 7;


    d.setUTCDate(
      d.getUTCDate() +
      4 -
      dayNumber
    );


    const isoYear =
      d.getUTCFullYear();


    const yearStart =
      new Date(
        Date.UTC(
          isoYear,
          0,
          1
        )
      );


    const isoWeek =
      Math.ceil(
        (
          (
            d -
            yearStart
          ) /
          86400000 +
          1
        ) /
        7
      );


    return {
      isoWeek,
      isoYear
    };
  }


  function escapeHtml(
    value
  ) {
    return String(
      value
    ).replace(
      /[&<>'"]/g,

      character => ({
        '&':
          '&amp;',

        '<':
          '&lt;',

        '>':
          '&gt;',

        "'":
          '&#39;',

        '"':
          '&quot;'
      }[character])
    );
  }


  // =========================================================
  // CHAIR SVG
  // =========================================================

  function sideChairSvg() {
    return `
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M7 4v9"></path>
        <path d="M7 4h3"></path>
        <path d="M7 13h10"></path>
        <path d="M7 15.5h10"></path>
        <path d="M17 13v2.5"></path>
        <path d="M8.5 15.5 7 20"></path>
        <path d="M15.5 15.5 17 20"></path>
      </svg>
    `;
  }


  // =========================================================
  // STYLES
  // =========================================================

  function injectStyles() {
    const style =
      document.createElement(
        'style'
      );


    style.textContent = `

      a.s2skemabrik.s2brik {
        overflow:
          visible !important;
      }


      .${LAST_CLASS} {
        z-index:
          25 !important;
      }

      html[data-lectio-chairs-up-marker='outline'] .${LAST_CLASS} {
        outline: 3px solid #e31845 !important;
        outline-offset: 2px !important;
      }

      html[data-lectio-chairs-up-marker='outline'] .${ICON_CLASS} {
        display: none !important;
      }

      html[data-lectio-chairs-up-marker='quiet'] .${ICON_CLASS} {
        width: 12px;
        height: 12px;
        top: -3px;
        right: -3px;
        border-width: 1px;
      }

      html[data-lectio-chairs-up-marker='quiet'] .${ICON_CLASS} svg {
        display: none;
      }

      html.lectio-chairs-up-hide-notice .${LESSON_NOTICE_CLASS} {
        display: none !important;
      }


      /* =====================================================
         TIMETABLE BADGE
         ===================================================== */

      .${ICON_CLASS} {
        position:
          absolute;

        top:
          -6px;

        right:
          -6px;

        width:
          24px;

        height:
          24px;

        display:
          flex;

        align-items:
          center;

        justify-content:
          center;

        border-radius:
          50%;

        background:
          linear-gradient(
            180deg,
            #ff3155 0%,
            #d9002f 100%
          );

        border:
          2px solid #ffffff;

        box-shadow:
          0 2px 5px rgba(0,0,0,0.28),
          0 0 0 1px rgba(130,0,20,0.12);

        z-index:
          100;

        cursor:
          help;

        pointer-events:
          auto;

        transform:
          scale(1);

        transform-origin:
          center;

        transition:
          transform 180ms
            cubic-bezier(
              0.34,
              1.56,
              0.64,
              1
            ),
          box-shadow 180ms ease,
          filter 180ms ease;
      }


      .${ICON_CLASS}:hover {
        transform:
          scale(1.20);

        box-shadow:
          0 5px 10px rgba(0,0,0,0.34),
          0 0 0 1px rgba(130,0,20,0.14);

        filter:
          brightness(1.04);
      }


      .${ICON_CLASS} svg {
        width:
          15px;

        height:
          15px;

        fill:
          none;

        stroke:
          #ffffff;

        stroke-width:
          2.7;

        stroke-linecap:
          round;

        stroke-linejoin:
          round;

        pointer-events:
          none;
      }


      /* =====================================================
         ACTIVITY PAGE NOTICE
         ===================================================== */

      /*
       * In the flow by default: a notice that shares the paper's
       * own column can never cover the activity heading, its
       * actions, links, or the lesson material.
       */
      .${LESSON_NOTICE_CLASS} {
        position:
          relative;

        box-sizing:
          border-box;

        width:
          max-content;

        max-width:
          100%;

        margin:
          0 0 16px auto;

        display:
          flex;

        align-items:
          center;

        gap:
          11px;

        padding:
          9px 14px 9px 9px;

        border-radius:
          16px;

        background:
          linear-gradient(
            180deg,
            #ff3155 0%,
            #d9002f 100%
          );

        border:
          3px solid #ffffff;

        box-shadow:
          0 4px 12px rgba(0,0,0,0.24),
          0 0 0 1px rgba(130,0,20,0.16);

        color:
          #ffffff;

        /*
         * Modest, because the notice no longer sits over the
         * page: overlays are handled by stepping aside, not by
         * out-stacking them.
         */
        z-index:
          40;

        user-select:
          none;

        transform:
          scale(1);

        transform-origin:
          center;

        transition:
          transform 180ms
            cubic-bezier(
              0.34,
              1.56,
              0.64,
              1
            ),
          box-shadow 180ms ease;
      }


      .${LESSON_NOTICE_CLASS}:hover {
        transform:
          scale(1.06);

        box-shadow:
          0 7px 17px rgba(0,0,0,0.29),
          0 0 0 1px rgba(130,0,20,0.16);
      }


      /*
       * Set only after the gutter beside the activity paper has
       * been measured and found wide enough to hold the notice.
       */
      .${LESSON_NOTICE_CLASS}[data-placement='beside'] {
        position:
          absolute;

        top:
          18px;

        left:
          100%;

        margin:
          0 0 0 ${NOTICE_SIDE_GAP}px;
      }


      /*
       * A Lectio dialog, popup, or nested subview is open in
       * front of the page.
       */
      .${LESSON_NOTICE_CLASS}[data-overlay='open'] {
        display:
          none !important;
      }


      .lectio-chairs-up-lesson-chair {
        width:
          38px;

        height:
          38px;

        flex:
          0 0 38px;

        display:
          flex;

        align-items:
          center;

        justify-content:
          center;

        border-radius:
          50%;

        background:
          rgba(
            255,
            255,
            255,
            0.16
          );

        border:
          2px solid
            rgba(
              255,
              255,
              255,
              0.95
            );
      }


      .lectio-chairs-up-lesson-chair svg {
        width:
          25px;

        height:
          25px;

        fill:
          none;

        stroke:
          #ffffff;

        stroke-width:
          2.8;

        stroke-linecap:
          round;

        stroke-linejoin:
          round;
      }


      .lectio-chairs-up-lesson-copy {
        display:
          flex;

        flex-direction:
          column;

        /*
         * Lets the copy shrink instead of pushing the notice
         * wider than the space it was placed in.
         */
        min-width:
          0;

        line-height:
          1.05;

        white-space:
          nowrap;
      }


      .lectio-chairs-up-lesson-copy strong {
        color:
          #ffffff;

        font-size:
          16px;

        font-weight:
          850;

        letter-spacing:
          0.4px;
      }


      .lectio-chairs-up-lesson-copy span {
        margin-top:
          4px;

        color:
          rgba(
            255,
            255,
            255,
            0.94
          );

        font-size:
          11px;

        font-weight:
          600;
      }


      /* =====================================================
         MOBILE
         ===================================================== */

      @media (
        max-width: 700px
      ) {

        .${ICON_CLASS} {
          width:
            26px;

          height:
            26px;

          top:
            -5px;

          right:
            -5px;
        }


        .${ICON_CLASS} svg {
          width:
            16px;

          height:
            16px;
        }


        /*
         * Narrow layouts never get the gutter placement, so the
         * notice only has to stay inside the paper and wrap its
         * copy rather than overflow it.
         */
        .${LESSON_NOTICE_CLASS} {
          max-width:
            100%;

          margin:
            0 0 12px;
        }


        .lectio-chairs-up-lesson-copy {
          white-space:
            normal;
        }
      }
    `;


    document.head.appendChild(
      style
    );
  }

})();
