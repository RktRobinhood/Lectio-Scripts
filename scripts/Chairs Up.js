// ==UserScript==
// @name         Lectio - Chairs Up Smart Cache
// @namespace    https://www.lectio.dk/lectio/223/
// @version      0.8.0
// @description  Shows a chairs-up reminder when a lesson is the final booking of the day in its room.
// @match        https://www.lectio.dk/lectio/223/SkemaNy.aspx*
// @match        https://www.lectio.dk/lectio/223/aktivitet/aktivitetforside2.aspx*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // =========================================================
  // CONFIG
  // =========================================================

  const SCHOOL = '223';

  // Room 100. We only use this page to discover Lectio's room IDs.
  const ROOM_INDEX_SEED_ID = '1420165716';

  const ROOM_INDEX_URL =
    `/lectio/${SCHOOL}/SkemaNy.aspx` +
    `?type=lokale&nosubnav=1&id=${ROOM_INDEX_SEED_ID}&showtype=0`;

  // Future schedules: at most once per day.
  const FUTURE_REFRESH_MS =
    24 * 60 * 60 * 1000;

  // Room-ID list: effectively static.
  const ROOM_MAP_REFRESH_MS =
    30 * 24 * 60 * 60 * 1000;

  // On the actual day, do a fresh verification shortly before class.
  const SAME_DAY_CHECK_WINDOW_MINUTES = 15;

  // Don't repeatedly hit Lectio if pages are reopened.
  const SAME_DAY_RECHECK_MS =
    10 * 60 * 1000;

  const LOOKAHEAD_DAYS = 7;

  /*
   * IMPORTANT:
   * Keep using the v7 cache namespace.
   *
   * This means updating from the previous script does NOT
   * unnecessarily throw away all the room schedules that
   * have already been cached.
   */
  const CACHE_PREFIX =
    'lectioChairsUp.v7';

  const ROOM_MAP_KEY =
    `${CACHE_PREFIX}.roomMap`;

  const ROOM_MAP_TIME_KEY =
    `${CACHE_PREFIX}.roomMapTime`;

  const ROOM_WEEK_PREFIX =
    `${CACHE_PREFIX}.roomWeek`;

  // CSS
  const LAST_CLASS =
    'lectio-chairs-up-last';

  const ICON_CLASS =
    'lectio-chairs-up-icon';

  const LESSON_NOTICE_CLASS =
    'lectio-chairs-up-lesson-notice';


  // =========================================================
  // START
  // =========================================================

  injectStyles();

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

    // -----------------------------------------
    // Normal timetable
    // -----------------------------------------

    if (
      url.pathname.endsWith('/SkemaNy.aspx')
    ) {
      /*
       * Don't decorate actual room timetables.
       */
      if (
        url.searchParams.get('type') === 'lokale'
      ) {
        return;
      }

      await runTimetablePage();

      return;
    }

    // -----------------------------------------
    // Lesson / activity page
    // -----------------------------------------

    if (
      url.pathname.endsWith(
        '/aktivitet/aktivitetforside2.aspx'
      )
    ) {
      await runActivityPage();
    }
  }


  // =========================================================
  // TIMETABLE
  // =========================================================

  async function runTimetablePage() {
    const lessons =
      getTimetableLessons();

    if (!lessons.length) {
      console.info(
        '[Lectio Chairs Up] No timetable lessons found.'
      );

      return;
    }

    const roomMap =
      await getRoomMap();

    /*
     * Instant UI from previously cached room data.
     */
    paintTimetableFromCache(
      lessons,
      roomMap
    );

    /*
     * Then quietly refresh stale schedules.
     */
    const jobs =
      buildRefreshPlan(
        lessons,
        roomMap
      );

    if (!jobs.length) {
      console.info(
        '[Lectio Chairs Up] Cached room schedules are fresh.'
      );

      return;
    }

    await refreshRoomWeeks(
      jobs
    );

    /*
     * Reflect any schedule changes.
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
      .map(parseLectioActivity)
      .filter(Boolean);
  }


  // =========================================================
  // ACTIVITY / LESSON PAGE
  // =========================================================

  async function runActivityPage() {
    /*
     * THIS is the important fix.
     *
     * Lectio puts the real activity brick in:
     *
     * #s_m_Content_Content_tocAndToolbar_actHeader
     *
     * and its data-tooltip already contains exact date,
     * start/end times, and room.
     *
     * We no longer try to infer anything from headings.
     */

    const activityBrick =
      document.querySelector(
        '#s_m_Content_Content_tocAndToolbar_actHeader ' +
        'a.s2skemabrik[data-tooltip]'
      ) ||

      /*
       * Fallback in case Lectio changes the generated ID
       * but keeps its activity structure.
       */
      document.querySelector(
        '#homeworkContentContainer ' +
        'a.s2skemabrik[data-tooltip]'
      );

    if (!activityBrick) {
      console.warn(
        '[Lectio Chairs Up] Activity-page lesson brick was not found.'
      );

      return;
    }

    const lesson =
      parseLectioActivity(
        activityBrick
      );

    if (!lesson) {
      console.warn(
        '[Lectio Chairs Up] Could not parse activity-page lesson data.',
        activityBrick.getAttribute('data-tooltip')
      );

      return;
    }

    console.info(
      '[Lectio Chairs Up] Activity:',
      lesson
    );

    const roomMap =
      await getRoomMap();

    /*
     * Display from cache immediately if possible.
     */
    renderActivityStatusFromCache(
      lesson,
      roomMap
    );

    /*
     * Apply exactly the same conservative refresh policy.
     */
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

    /*
     * Re-render after fresh data.
     */
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
          item => item.room
        );

    if (!lastRooms.length) {
      console.info(
        '[Lectio Chairs Up] This activity is not the last booking in its room.'
      );

      return;
    }

    createActivityNotice(
      lastRooms
    );
  }


  function createActivityNotice(
    lastRooms
  ) {
    /*
     * The saved page shows that the actual lesson card is:
     *
     * <div class="ls-texteditor-paper-container">
     *   <div id="homeworkContentContainer" class="ls-paper">
     *
     * So target that exact element.
     */

    const card =
      document.querySelector(
        '#homeworkContentContainer'
      );

    if (!card) {
      console.warn(
        '[Lectio Chairs Up] homeworkContentContainer not found.'
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
        <span>Last booking in room ${escapeHtml(roomText)}</span>
      </div>
    `;

    card.appendChild(
      notice
    );
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
  }


  // =========================================================
  // GENERIC LECTIO ACTIVITY PARSER
  // =========================================================

  function parseLectioActivity(
    el
  ) {
    const tooltip =
      el.getAttribute(
        'data-tooltip'
      ) || '';

    /*
     * Example from your actual lesson page:
     *
     * 9/9-2026 15:15 til 16:25
     * Hold: 2i TOK/3
     * Lærer: Matthew Pilley (MP)
     * Lokale: 225
     */

    const timed =
      tooltip.match(
        /(\d{1,2})\/(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s+til\s+(\d{1,2}):(\d{2})/i
      );

    if (!timed) {
      return null;
    }

    /*
     * Supports both:
     *
     * Lokale: 225
     * Lokaler: 100, 103, 104
     */
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
      el,

      rooms,

      absid:
        getAbsId(el),

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
  // CALCULATE STATUS
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
          normalizeRoom(room)
        );

      if (!roomId) {
        statuses.push({
          room,
          status: 'unknown'
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
          status: 'unknown'
        });

        continue;
      }

      const bookings =
        cache.days?.[
          lesson.isoDate
        ] || [];

      const laterBookingExists =
        bookings.some(
          booking => {

            /*
             * Ignore the lesson itself.
             */
            if (
              lesson.absid &&
              booking.absid &&
              lesson.absid === booking.absid
            ) {
              return false;
            }

            /*
             * Someone starts using the room after
             * this lesson ends.
             */
            return (
              booking.startMinutes >=
              lesson.endMinutes
            );
          }
        );

      statuses.push({
        room,

        status:
          laterBookingExists
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
    el,
    statuses
  ) {
    /*
     * Clean previous pass.
     */
    el
      .querySelectorAll(
        `.${ICON_CLASS}`
      )
      .forEach(
        node =>
          node.remove()
      );

    el.classList.remove(
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

    el.classList.add(
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

    el.appendChild(
      icon
    );
  }


  function buildTooltip(
    lastRooms,
    unknownRooms
  ) {
    let text =
      `CHAIRS UP — Last booking in ${lastRooms.join(', ')}`;

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

      /*
       * Ignore old activities and dates outside our
       * small look-ahead window.
       */
      if (
        daysAway < 0 ||
        daysAway > LOOKAHEAD_DAYS
      ) {
        continue;
      }

      for (
        const room of lesson.rooms
      ) {
        const roomId =
          roomMap.get(
            normalizeRoom(room)
          );

        if (!roomId) {
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

        // -------------------------------------
        // Future days: once daily
        // -------------------------------------

        if (
          daysAway > 0 &&
          cacheAge >= FUTURE_REFRESH_MS
        ) {
          shouldRefresh =
            true;

          reason =
            'daily-future-refresh';
        }

        // -------------------------------------
        // Today
        // -------------------------------------

        if (
          daysAway === 0
        ) {
          const minutesUntilClass =
            (
              lesson.dateObj.getTime() -
              now.getTime()
            ) / 60000;

          const nearClass =
            minutesUntilClass <=
              SAME_DAY_CHECK_WINDOW_MINUTES &&
            minutesUntilClass >= -5;

          /*
           * No data at all:
           * fetch one copy.
           */
          if (!cache) {
            shouldRefresh =
              true;

            reason =
              'missing-today-cache';
          }

          /*
           * Data exists:
           * only force a check as the lesson approaches.
           */
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

        /*
         * A room/week is fetched only once even if several
         * lessons use it.
         */
        if (
          shouldRefresh &&
          !jobs.has(key)
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
  // ROOM DATA FETCH
  // =========================================================

  async function refreshRoomWeeks(
    jobs
  ) {
    console.info(
      '[Lectio Chairs Up] Refreshing room data:',
      jobs
    );

    await Promise.all(
      jobs.map(
        async job => {
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
      )
    );
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
      await fetchHtml(url);

    const days = {};

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

      const bookings =
        [
          ...cell.querySelectorAll(
            'a.s2skemabrik.s2brik[data-tooltip]'
          )
        ]
          .map(
            parseRoomBooking
          )
          .filter(Boolean);

      days[isoDate] =
        bookings;
    }

    return {
      fetchedAt:
        Date.now(),

      days
    };
  }


  function parseRoomBooking(
    el
  ) {
    const tooltip =
      el.getAttribute(
        'data-tooltip'
      ) || '';

    const timed =
      tooltip.match(
        /(\d{1,2})\/(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s+til\s+(\d{1,2}):(\d{2})/i
      );

    if (!timed) {
      return null;
    }

    return {
      absid:
        getAbsId(el),

      startMinutes:
        Number(timed[4]) * 60 +
        Number(timed[5]),

      endMinutes:
        Number(timed[6]) * 60 +
        Number(timed[7])
    };
  }


  // =========================================================
  // ROOM MAP
  // =========================================================

  async function getRoomMap() {
    try {
      const cached =
        JSON.parse(
          localStorage.getItem(
            ROOM_MAP_KEY
          ) || 'null'
        );

      const cachedAt =
        Number(
          localStorage.getItem(
            ROOM_MAP_TIME_KEY
          ) || 0
        );

      if (
        cached &&
        Date.now() - cachedAt <
          ROOM_MAP_REFRESH_MS
      ) {
        return new Map(
          Object.entries(
            cached
          )
        );
      }
    }

    catch (_) {
      // Fall through and rebuild map.
    }

    const doc =
      await fetchHtml(
        ROOM_INDEX_URL
      );

    const map =
      new Map();

    for (
      const link of doc.querySelectorAll(
        'a[href*="SkemaNy.aspx?type=lokale"]'
      )
    ) {
      const roomName =
        normalizeRoom(
          link.textContent
        );

      if (!roomName) {
        continue;
      }

      const roomUrl =
        new URL(
          link.href,
          location.origin
        );

      const roomId =
        roomUrl.searchParams.get(
          'id'
        );

      if (roomId) {
        map.set(
          roomName,
          roomId
        );
      }
    }

    if (!map.size) {
      throw new Error(
        'Could not discover Lectio room IDs.'
      );
    }

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

    catch (_) {
      // Caching failure isn't fatal.
    }

    return map;
  }


  // =========================================================
  // ROOM CACHE
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
        '[Lectio Chairs Up] Cache write failed:',
        error
      );
    }
  }


  // =========================================================
  // CHAIR ICON
  // =========================================================

  function sideChairSvg() {
    return `
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >

        <!-- tall back -->
        <path d="M7 4v9"></path>

        <!-- back top -->
        <path d="M7 4h3"></path>

        <!-- upper seat -->
        <path d="M7 13h10"></path>

        <!-- lower / thickness of seat -->
        <path d="M7 15.5h10"></path>

        <!-- front of seat -->
        <path d="M17 13v2.5"></path>

        <!-- rear leg -->
        <path d="M8.5 15.5 7 20"></path>

        <!-- front leg -->
        <path d="M15.5 15.5 17 20"></path>

      </svg>
    `;
  }


  // =========================================================
  // STYLE
  // =========================================================

  function injectStyles() {
    const style =
      document.createElement(
        'style'
      );

    style.textContent = `

      /* =====================================================
         TIMETABLE BADGE
         ===================================================== */

      a.s2skemabrik.s2brik {
        overflow:
          visible !important;
      }

      .${LAST_CLASS} {
        z-index:
          25 !important;
      }

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
          0 5px 10px
            rgba(0,0,0,0.34),
          0 0 0 1px
            rgba(130,0,20,0.14);

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
         LESSON PAGE NOTICE
         ===================================================== */

      .${LESSON_NOTICE_CLASS} {
        position:
          absolute;

        /*
         * There is unused space at the upper right of
         * homeworkContentContainer.
         */
        top:
          18px;

        right:
          52px;

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
          0 4px 12px
            rgba(0,0,0,0.24),
          0 0 0 1px
            rgba(130,0,20,0.16);

        color:
          #ffffff;

        z-index:
          500;

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

      /*
       * A little bit of the same dock feel.
       */
      .${LESSON_NOTICE_CLASS}:hover {
        transform:
          scale(1.06);

        box-shadow:
          0 7px 17px
            rgba(0,0,0,0.29),
          0 0 0 1px
            rgba(130,0,20,0.16);
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


        .${LESSON_NOTICE_CLASS} {
          position:
            relative;

          top:
            auto;

          right:
            auto;

          width:
            max-content;

          max-width:
            calc(
              100% - 20px
            );

          margin:
            10px 10px 12px
            auto;
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }


  // =========================================================
  // HELPERS
  // =========================================================

  async function fetchHtml(
    url
  ) {
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
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} loading ${url}`
      );
    }

    const html =
      await response.text();

    return new DOMParser()
      .parseFromString(
        html,
        'text/html'
      );
  }


  function getAbsId(
    el
  ) {
    /*
     * Room timetable uses a URL with absid.
     */
    const href =
      el.getAttribute(
        'href'
      ) || '';

    const hrefMatch =
      href.match(
        /[?&]absid=(\d+)/i
      );

    if (hrefMatch) {
      return hrefMatch[1];
    }

    /*
     * Activity page gives us:
     *
     * data-brikid="ABS81909264901"
     */
    const brik =
      el.getAttribute(
        'data-brikid'
      ) || '';

    const brikMatch =
      brik.match(
        /ABS(\d+)/i
      );

    if (brikMatch) {
      return brikMatch[1];
    }

    /*
     * Final fallback: activity URL itself.
     */
    return (
      new URL(
        location.href
      )
        .searchParams
        .get('absid')
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
        startOfDay(a).getTime() -
        startOfDay(b).getTime()
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

})();