// ==UserScript==
// @name         Lectio - Chairs Up
// @namespace    https://www.lectio.dk/
// @version      1.0.3
// @description  Shows when a lesson or activity is the final booking of the day in its room. Universal Lectio version.
// @match        https://www.lectio.dk/lectio/*/SkemaNy.aspx*
// @match        https://www.lectio.dk/lectio/*/aktivitet/aktivitetforside2.aspx*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // =========================================================
  // SCHOOL
  // =========================================================

  const schoolMatch =
    location.pathname.match(/^\/lectio\/(\d+)\//);

  if (!schoolMatch) return;

  const SCHOOL = schoolMatch[1];

  console.info(
    `[Lectio Chairs Up] v1.0.3 started - school ${SCHOOL}`
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


  // =========================================================
  // CACHE
  // =========================================================

  /*
   * Keep the v1.0.2 cache.
   *
   * Room discovery is now working, so there is no reason
   * to force Lectio to rediscover all 74 rooms again.
   */
  const CACHE_PREFIX =
    `lectioChairsUp.v102.${SCHOOL}`;

  const ROOM_MAP_KEY =
    `${CACHE_PREFIX}.roomMap`;

  const ROOM_MAP_TIME_KEY =
    `${CACHE_PREFIX}.roomMapTime`;

  const ROOM_WEEK_PREFIX =
    `${CACHE_PREFIX}.roomWeek`;


  // =========================================================
  // CSS
  // =========================================================

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


    if (
      url.pathname.endsWith('/SkemaNy.aspx')
    ) {
      /*
       * Do not decorate room schedule pages.
       */
      if (
        url.searchParams.get('type') === 'lokale'
      ) {
        return;
      }

      await runTimetablePage();
      return;
    }


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
        '[Lectio Chairs Up] No activities with rooms found.'
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
     * Paint instantly from cached room-week data.
     */
    paintTimetableFromCache(
      lessons,
      roomMap
    );


    /*
     * Refresh only data that needs it.
     */
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
     * Recalculate after fresh room data arrives.
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
      .map(
        parseLectioActivity
      )
      .filter(Boolean);
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
  // ACTIVITY PARSER
  // =========================================================

  function parseLectioActivity(
    element
  ) {
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
    // -------------------------------------------------------
    // Existing successful cache
    // -------------------------------------------------------

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


    // -------------------------------------------------------
    // Current page
    // -------------------------------------------------------

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


    // -------------------------------------------------------
    // Activity edit page bootstrap
    // -------------------------------------------------------

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


    // -------------------------------------------------------
    // Schedule-front-page fallback
    // -------------------------------------------------------

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
        console.info(
          '[Lectio Chairs Up] Room found on edit control:',
          wanted,
          id
        );

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
  // ROOM PAGE
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

    catch (_) {}
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

    catch (_) {}


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
    }
  }


  // =========================================================
  // LAST-BOOKING LOGIC
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


      const bookings =
        cache.days?.[
          lesson.isoDate
        ] || [];


      /*
       * -----------------------------------------------------
       * v1.0.3
       *
       * Ask:
       *
       * "After ignoring this activity itself, is there any
       * other booking whose occupancy continues beyond the
       * end of this activity?"
       *
       * This handles ordinary lessons, meetings, trips,
       * odd-length events and overlapping bookings.
       * -----------------------------------------------------
       */

      const laterOccupancyExists =
        bookings.some(
          booking => {

            /*
             * Strongest self-match:
             * same Lectio activity ID.
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
             * Defensive self-match.
             *
             * Lectio occasionally represents special
             * activities differently between teacher and
             * room timetables.
             *
             * If the start/end pair is identical, treat it
             * as the same occupancy rather than allowing an
             * ID mismatch to disqualify the lesson.
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
             * If another booking continues beyond us,
             * this is not the final occupancy.
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
            item.status ===
            'last'
        )
        .map(
          item =>
            item.room
        );


    const unknownRooms =
      statuses
        .filter(
          item =>
            item.status ===
            'unknown'
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
      `CHAIRS UP - Last booking in ${lastRooms.join(', ')}`;


    if (
      unknownRooms.length
    ) {
      text +=
        `\nCould not verify: ${unknownRooms.join(', ')}`;
    }


    return text;
  }


  // =========================================================
  // REFRESH
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
      await fetchHtml(
        url
      );


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
    element
  ) {
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
      haystack ===
      needle
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


    if (
      !response.ok
    ) {
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
  // CHAIR
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


      /* TIMETABLE BADGE */

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


      /* ACTIVITY PAGE BANNER */

      .${LESSON_NOTICE_CLASS} {
        position:
          absolute;

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
            10px 10px 12px auto;
        }
      }
    `;


    document.head.appendChild(
      style
    );
  }

})();