// ==UserScript==
// @name         Lectio Change Radar
// @namespace    https://github.com/RktRobinhood/Lectio-Scripts
// @version      0.9.8
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
    version: '0.9.8',
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
    trackDocumentUpdates: false,

    // The teacher to-do (issue #76): lessons still waiting for absence
    // registration, submissions waiting to be marked, assignments due this
    // week. On by default, and inert for anyone who is not a teacher - see
    // SETTING_AUDIENCE below. It only ever counts and links.
    teacherTodo: true,
    teacherTodoMarks: true
  });

  /*
   * Who each setting is for. Students and teachers do not watch the same
   * things: the absence page is a student's own record for one and a list of
   * lessons still to register for the other, and an assignment's status and
   * grade exist only on a student's list. A key here is sent to the Manager as
   * the control's `audience`, which a current Manager uses to hide a control
   * the detected account cannot use - but that is presentation only. The
   * module is the authority: settingOn() reads every key through this map, so
   * a watch tagged for the other role neither fetches nor logs anything,
   * whatever value is stored for it. A key that is not here applies to both.
   *
   * An account whose role could not be read off the page counts as a student,
   * which is what the absence URL already assumed before this map existed.
   */
  const SETTING_AUDIENCE = Object.freeze({
    trackAssignmentStatus: Object.freeze(['student']),
    trackAbsence: Object.freeze(['student']),
    trackAbsenceRegistrations: Object.freeze(['student']),
    trackAbsencePercent: Object.freeze(['student']),
    teacherTodo: Object.freeze(['teacher']),
    teacherTodoMarks: Object.freeze(['teacher'])
  });

  // The sources the teacher to-do reads. It rides the same capture as the
  // watches above - same request slot, same backoff, same thirty-minute
  // floor - so turning it on adds no rhythm of its own.
  const TODO_SOURCE_KEYS = Object.freeze(['assignments', 'absence']);

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

  // The teacher list's column of submissions waiting on the teacher. Lectio
  // writes the header as "Afventer<br/>lærer", so its text has no space.
  const WAITING_COLUMN_PATTERN = /^(?:afventer\s*lærer|awaiting\s*teacher)$/i;
  const OWNER_COLUMN_PATTERN = /^(?:ansvarlig|responsible)$/i;
  const MISSING_REGISTRATION_PATTERN = /^(?:manglende\s+registrering(?:er)?|missing\s+registrations?)$/i;

  // Pages on which a lesson block is already the registration list itself,
  // so a mark would only repeat the row it sits in.
  const TODO_MARK_SKIP_PATH = /(?:fravaerlaerer|ActivityAbsenceRegistration)\.aspx$/i;

  /*
   * The teacher to-do's own words (issue #76), in both languages (ADR-0013).
   * `{name}` is filled in by fillText(). Numbers only, no alarm words: a
   * registration running late is common and not a crisis.
   */
  const TODO_TEXT = Object.freeze({
    // i18n:en
    en: {
      title: 'To do',
      cardLabel: 'Teacher to-do, from Change Radar',
      checkedAt: 'Checked {time}',
      absenceLabel: 'Absence',
      absenceNone: 'Every lesson is registered',
      absenceOne: '1 lesson not registered',
      absenceMany: '{count} lessons not registered',
      absenceLink: 'Open absence registration',
      markingLabel: 'Marking',
      markingNone: 'Nothing waiting on you',
      submissionOne: '1 submission',
      submissionMany: '{count} submissions',
      acrossOne: 'on 1 assignment',
      acrossMany: 'across {count} assignments',
      markingLine: '{submissions} waiting {across}',
      markingLink: 'Open the assignment list',
      dueLabel: 'Due this week',
      dueNone: 'Nothing due',
      dueOne: '1 assignment',
      dueMany: '{count} assignments',
      dueLink: 'Open the assignment list',
      oldest: 'oldest {date}',
      oldestDeadline: 'oldest deadline {date}',
      markLabel: 'Absence not registered for this lesson. Opens its registration page - nothing is registered for you.'
    },
    // i18n:da
    da: {
      title: 'Huskeliste',
      cardLabel: 'Lærerens huskeliste, fra Ændringsradaren',
      checkedAt: 'Tjekket {time}',
      absenceLabel: 'Fravær',
      absenceNone: 'Alle lektioner er registreret',
      absenceOne: '1 lektion mangler registrering',
      absenceMany: '{count} lektioner mangler registrering',
      absenceLink: 'Åbn fraværsregistrering',
      markingLabel: 'Retning',
      markingNone: 'Intet venter på dig',
      submissionOne: '1 aflevering',
      submissionMany: '{count} afleveringer',
      acrossOne: 'på 1 opgave',
      acrossMany: 'fordelt på {count} opgaver',
      markingLine: '{submissions} venter {across}',
      markingLink: 'Åbn opgavelisten',
      dueLabel: 'Frist denne uge',
      dueNone: 'Ingen frister',
      dueOne: '1 opgave',
      dueMany: '{count} opgaver',
      dueLink: 'Åbn opgavelisten',
      oldest: 'ældste {date}',
      oldestDeadline: 'ældste frist {date}',
      markLabel: 'Fraværet er ikke registreret for denne lektion. Åbner lektionens registreringsside - der registreres ikke noget for dig.'
    }
    // i18n:end
  });

  /*
   * The settings panel's own words, in both languages (ADR-0013). The Manager
   * renders schema strings exactly as given, so settingSchema() below words
   * the schema in whichever language is current each time it is announced,
   * and lectio-manager:language re-announces it; the floating HUD's own
   * settings panel reads the same schema. Keys, types, defaults, option
   * values and the section grouping never vary - only the words do. One entry
   * per setting: its label, its help text, and one line per option value.
   *
   * The two literals sit between i18n markers so scripts/check-i18n.mjs can
   * hold their keys in step, at every depth.
   */
  const SETTING_TEXT = Object.freeze({
    // i18n:en
    en: {
      sections: {
        watch: 'What to watch',
        todo: 'Teacher to-do',
        alerts: 'Notifications',
        appearance: 'Appearance',
        timetable: 'Timetable details',
        assignments: 'Assignment details',
        absence: 'Absence details',
        documents: 'Document details'
      },
      displayMode: { label: 'Radar location', help: 'Where the radar lives. Automatic uses Lectio Manager\'s shared dock when the Manager is installed, and falls back to a floating radar when it is not.', auto: 'Automatic', dock: 'Always the Manager dock', floating: 'Always floating on the page' },
      urgentHours: { label: 'Urgent window', help: 'An unseen change to an activity inside this window turns the radar red.', 6: 'Next 6 hours', 12: 'Next 12 hours', 24: 'Next 24 hours', 48: 'Next 48 hours' },
      recentHours: { label: 'Recent-change window', help: 'After changes are seen, keep the radar amber for this long before returning to green.', 12: '12 hours', 24: '24 hours', 48: '48 hours', 72: '72 hours' },
      attentionAnimation: { label: 'Urgent animation', help: 'Pulse the radar signal when an urgent unseen change needs attention.' },
      hoverOpen: { label: 'Open on hover', help: 'Open the change log when the pointer rests on the radar. Click still pins it open.' },
      historyLimit: { label: 'History size', help: 'Maximum number of recent changes kept in the rotating local log.', 5: '5 changes', 10: '10 changes', 20: '20 changes' },
      pollMinutes: { label: 'Check frequency', help: 'How often Change Radar checks Lectio while a Lectio tab is open.', 5: 'Every 5 minutes', 10: 'Every 10 minutes', 15: 'Every 15 minutes', 30: 'Every 30 minutes' },
      weeksAhead: { label: 'Weeks to watch', help: 'How far ahead the radar snapshots your timetable.', 0: 'This week only', 1: 'This week + next', 2: 'This week + 2 weeks' },
      trackCancellations: { label: 'Cancellations', help: 'Report a lesson being cancelled, and a cancellation later being lifted.' },
      trackTimeChanges: { label: 'Time and date moves', help: 'Report a lesson moving to a different day, start time, or end time.' },
      trackRoomChanges: { label: 'Room changes', help: 'Report a lesson moving to a different room.' },
      trackTeacherChanges: { label: 'Teacher changes', help: 'Report a different teacher being put on a lesson, such as a substitute.' },
      trackAddedLessons: { label: 'Lessons added', help: 'Report an activity appearing in a week the radar was already watching.' },
      trackRemovedLessons: { label: 'Lessons removed', help: 'Report an activity disappearing from a week the radar is watching. That is not the same as a cancellation, which leaves the lesson visible.' },
      trackHomework: { label: 'Homework', help: 'Report homework (Lektier) being set, changed, or cleared on a lesson.' },
      trackLessonNotes: { label: 'Notes and other content', help: 'Report changes to a lesson\'s note or its other-content field. These get edited often, so this is off by default.' },
      trackLessonDetails: { label: 'Other lesson details', help: 'Report changes to a lesson\'s class, title, resources, or participants, and changes Lectio flags without saying what changed. Off by default because most of these are administrative.' },
      trackAssignments: { label: 'Watch assignments', help: 'Check your assignment list as well as your timetable. Costs one extra request per check, at most twice an hour.' },
      trackNewAssignments: { label: 'New assignments', help: 'Report an assignment appearing on your list.' },
      trackUpcomingAssignments: { label: 'Due soon', help: 'Raise an assignment on the radar once its deadline comes inside the window you set under Weeks to watch, so a deadline announces itself before it is on top of you rather than only when it moves.' },
      trackAssignmentDeadlines: { label: 'Deadline changes', help: 'Report an assignment deadline moving.' },
      trackAssignmentStatus: { label: 'Status and grades', help: 'Report an assignment changing status, or a grade being published for one.' },
      trackAbsence: { label: 'Watch absence', help: 'Check your absence page as well as your timetable. Costs one extra request per check, at most twice an hour. Off by default.' },
      trackAbsenceRegistrations: { label: 'New registrations', help: 'Report a new absence registration appearing against you.' },
      trackAbsencePercent: { label: 'Percentage changes', help: 'Report your absence percentage moving for a class. That shifts on its own as lessons pass, so it is off by default.' },
      trackDocuments: { label: 'Watch documents', help: 'Check your document overview as well as your timetable. Costs one extra request per check, at most twice an hour. Off by default.' },
      trackNewDocuments: { label: 'New documents', help: 'Report a document appearing in your overview.' },
      trackDocumentUpdates: { label: 'Document updates', help: 'Report an existing document being replaced or renamed.' },
      teacherTodo: { label: 'Show my to-do', help: 'For teachers. A small card on the front page (Forside) counting lessons still waiting for absence registration, submissions waiting for you to mark, and assignments due this week, each linking to the Lectio page with the details. It reads your absence page and assignment list alongside the other checks, at most twice an hour. It only counts and links: it never registers or marks anything for you.' },
      teacherTodoMarks: { label: 'Mark lessons missing registration', help: 'Put a small mark in the corner of a lesson on the timetable while its absence is not registered. The mark opens that lesson\'s registration page.' }
    },
    // i18n:da
    da: {
      sections: {
        watch: 'Hvad der holdes øje med',
        todo: 'Lærerens huskeliste',
        alerts: 'Notifikationer',
        appearance: 'Udseende',
        timetable: 'Detaljer om skemaet',
        assignments: 'Detaljer om opgaver',
        absence: 'Detaljer om fravær',
        documents: 'Detaljer om dokumenter'
      },
      displayMode: { label: 'Radarens placering', help: 'Hvor radaren sidder. Automatisk bruger Lectio Managers fælles dock, når Manageren er installeret, og lader ellers radaren flyde på siden.', auto: 'Automatisk', dock: 'Altid Managerens dock', floating: 'Altid flydende på siden' },
      urgentHours: { label: 'Hastevindue', help: 'En uset ændring af en aktivitet inden for dette tidsrum gør radaren rød.', 6: 'De næste 6 timer', 12: 'De næste 12 timer', 24: 'De næste 24 timer', 48: 'De næste 48 timer' },
      recentHours: { label: 'Vindue for nylige ændringer', help: 'Når ændringerne er set, forbliver radaren gul så længe, før den bliver grøn igen.', 12: '12 timer', 24: '24 timer', 48: '48 timer', 72: '72 timer' },
      attentionAnimation: { label: 'Animation ved hast', help: 'Lad radarsignalet pulsere, når en uset hasteændring kræver opmærksomhed.' },
      hoverOpen: { label: 'Åbn, når musen holdes over', help: 'Åbn ændringsloggen, når musen hviler på radaren. Et klik fastholder den stadig åben.' },
      historyLimit: { label: 'Historikkens længde', help: 'Højeste antal nylige ændringer, der gemmes i den roterende lokale log.', 5: '5 ændringer', 10: '10 ændringer', 20: '20 ændringer' },
      pollMinutes: { label: 'Hvor ofte der tjekkes', help: 'Hvor ofte Change Radar tjekker Lectio, mens en Lectio-fane er åben.', 5: 'Hvert 5. minut', 10: 'Hvert 10. minut', 15: 'Hvert 15. minut', 30: 'Hvert 30. minut' },
      weeksAhead: { label: 'Uger at holde øje med', help: 'Hvor langt frem radaren tager øjebliksbilleder af dit skema.', 0: 'Kun denne uge', 1: 'Denne uge + næste', 2: 'Denne uge + 2 uger' },
      trackCancellations: { label: 'Aflysninger', help: 'Meld, når en lektion aflyses, og når en aflysning senere ophæves.' },
      trackTimeChanges: { label: 'Flytning af tid og dato', help: 'Meld, når en lektion flyttes til en anden dag eller får et andet start- eller sluttidspunkt.' },
      trackRoomChanges: { label: 'Lokaleskift', help: 'Meld, når en lektion flyttes til et andet lokale.' },
      trackTeacherChanges: { label: 'Lærerskift', help: 'Meld, når en anden lærer sættes på en lektion, fx en vikar.' },
      trackAddedLessons: { label: 'Tilføjede lektioner', help: 'Meld, når en aktivitet dukker op i en uge, radaren allerede holdt øje med.' },
      trackRemovedLessons: { label: 'Fjernede lektioner', help: 'Meld, når en aktivitet forsvinder fra en uge, radaren holder øje med. Det er ikke det samme som en aflysning, hvor lektionen stadig kan ses.' },
      trackHomework: { label: 'Lektier', help: 'Meld, når der gives, ændres eller fjernes lektier på en lektion.' },
      trackLessonNotes: { label: 'Noter og øvrigt indhold', help: 'Meld ændringer i en lektions note eller i feltet Øvrigt indhold. De redigeres tit, så dette er slået fra som standard.' },
      trackLessonDetails: { label: 'Andre lektionsdetaljer', help: 'Meld ændringer i en lektions hold, titel, ressourcer eller deltagere samt ændringer, Lectio markerer uden at sige, hvad der er ændret. Slået fra som standard, fordi de fleste af dem er administrative.' },
      trackAssignments: { label: 'Hold øje med opgaver', help: 'Tjek din opgaveliste ud over dit skema. Koster én ekstra forespørgsel pr. tjek, højst to gange i timen.' },
      trackNewAssignments: { label: 'Nye opgaver', help: 'Meld, når en opgave dukker op på din liste.' },
      trackUpcomingAssignments: { label: 'Frist nærmer sig', help: 'Vis en opgave på radaren, når dens frist kommer inden for det tidsrum, du har valgt under Uger at holde øje med, så en frist melder sig, før den er over dig, og ikke kun når den flyttes.' },
      trackAssignmentDeadlines: { label: 'Ændrede frister', help: 'Meld, når en opgaves frist flyttes.' },
      trackAssignmentStatus: { label: 'Status og karakterer', help: 'Meld, når en opgave skifter status, eller når der offentliggøres en karakter for den.' },
      trackAbsence: { label: 'Hold øje med fravær', help: 'Tjek din fraværsside ud over dit skema. Koster én ekstra forespørgsel pr. tjek, højst to gange i timen. Slået fra som standard.' },
      trackAbsenceRegistrations: { label: 'Nye registreringer', help: 'Meld, når der registreres nyt fravær på dig.' },
      trackAbsencePercent: { label: 'Ændret fraværsprocent', help: 'Meld, når din fraværsprocent for et hold ændrer sig. Den flytter sig af sig selv, efterhånden som lektionerne går, så dette er slået fra som standard.' },
      trackDocuments: { label: 'Hold øje med dokumenter', help: 'Tjek din dokumentoversigt ud over dit skema. Koster én ekstra forespørgsel pr. tjek, højst to gange i timen. Slået fra som standard.' },
      trackNewDocuments: { label: 'Nye dokumenter', help: 'Meld, når et dokument dukker op i din oversigt.' },
      trackDocumentUpdates: { label: 'Opdaterede dokumenter', help: 'Meld, når et eksisterende dokument erstattes eller omdøbes.' },
      teacherTodo: { label: 'Vis min huskeliste', help: 'For lærere. Et lille kort på forsiden, der tæller lektioner, som stadig mangler fraværsregistrering, afleveringer, der venter på at blive rettet af dig, og opgaver med frist i denne uge - hver med et link til den Lectio-side, der viser detaljerne. Den læser din fraværsside og opgaveliste sammen med de øvrige tjek, højst to gange i timen. Den tæller og linker kun: den registrerer eller retter aldrig noget for dig.' },
      teacherTodoMarks: { label: 'Markér lektioner uden registrering', help: 'Sæt et lille mærke i hjørnet af en lektion i skemaet, så længe dens fravær ikke er registreret. Mærket åbner lektionens registreringsside.' }
    }
    // i18n:end
  });

  /*
   * The schema, worded in the current language. Built fresh on every call so
   * a language switch is answered with the right words; everything else in it
   * is fixed here and never varies between the two.
   *
   * Four groups a person reads, then the fine print (issue #76 - the flat
   * list had grown to twenty-eight rows in six headings). What to watch holds
   * the switches that decide what is fetched at all; the teacher to-do is its
   * own group; Notifications and Appearance are how the radar behaves. The
   * per-change trackers underneath each source are `advanced`, so a Manager
   * that understands it (every control in a section advanced) folds each of
   * those groups behind a click - their defaults already cover most people.
   *
   * Every control carries the section it belongs to, and the role-specific
   * ones an `audience` from SETTING_AUDIENCE.
   */
  function settingSchema() {
    const text = SETTING_TEXT[radarLanguage()];
    const detail = new Set(['timetable', 'assignments', 'absence', 'documents']);
    const finish = (control, section) => {
      if (detail.has(section)) control.advanced = true;
      if (SETTING_AUDIENCE[control.key]) control.audience = [...SETTING_AUDIENCE[control.key]];
      return control;
    };
    const select = (key, defaultValue, values, section) => finish(makeSelectSetting(
      key, text[key].label, text[key].help, defaultValue,
      values.map((value) => [value, text[key][value]]), text.sections[section]
    ), section);
    const toggle = (key, defaultValue, section) => finish(makeToggleSetting(
      key, text[key].label, text[key].help, defaultValue, text.sections[section]
    ), section);

    return [
      select('weeksAhead', 1, [0, 1, 2], 'watch'),
      toggle('trackAssignments', true, 'watch'),
      toggle('trackAbsence', false, 'watch'),
      toggle('trackDocuments', false, 'watch'),

      toggle('teacherTodo', true, 'todo'),
      toggle('teacherTodoMarks', true, 'todo'),

      select('pollMinutes', 10, [5, 10, 15, 30], 'alerts'),
      select('urgentHours', 24, [6, 12, 24, 48], 'alerts'),
      select('recentHours', 24, [12, 24, 48, 72], 'alerts'),
      toggle('attentionAnimation', true, 'alerts'),

      select('displayMode', 'auto', ['auto', 'dock', 'floating'], 'appearance'),
      toggle('hoverOpen', true, 'appearance'),
      select('historyLimit', 10, [5, 10, 20], 'appearance'),

      toggle('trackCancellations', true, 'timetable'),
      toggle('trackTimeChanges', true, 'timetable'),
      toggle('trackRoomChanges', true, 'timetable'),
      toggle('trackTeacherChanges', true, 'timetable'),
      toggle('trackAddedLessons', true, 'timetable'),
      toggle('trackRemovedLessons', true, 'timetable'),
      toggle('trackHomework', true, 'timetable'),
      toggle('trackLessonNotes', false, 'timetable'),
      toggle('trackLessonDetails', false, 'timetable'),

      toggle('trackNewAssignments', true, 'assignments'),
      toggle('trackUpcomingAssignments', true, 'assignments'),
      toggle('trackAssignmentDeadlines', true, 'assignments'),
      toggle('trackAssignmentStatus', false, 'assignments'),

      toggle('trackAbsenceRegistrations', true, 'absence'),
      toggle('trackAbsencePercent', false, 'absence'),

      toggle('trackNewDocuments', true, 'documents'),
      toggle('trackDocumentUpdates', false, 'documents')
    ];
  }

  const UI = Object.freeze({
    root: 'lectio-change-radar',
    style: 'lectio-change-radar-style',
    button: 'lectio-change-radar-button',
    panel: 'lectio-change-radar-panel',
    list: 'lectio-change-radar-list',
    status: 'lectio-change-radar-status',
    todoCard: 'lectio-change-radar-todo'
  });

  // The Manager builds this element during its own boot, before it fires its
  // one start-up Discovery, and never removes it. It is read here and never
  // touched: it is how Automatic knows the dock is on the page when the
  // Manager was evaluated first, because Tampermonkey injects both scripts at
  // document-idle in an order nothing controls, and a Discovery fired before
  // this module was listening is simply never heard (issue #66).
  const MANAGER_DOCK_ROOT_ID = 'lectio-manager-dock-root';

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
    slotsUnanswered: false,

    // What the teacher to-do last drew, as one string, so the many callers
    // of renderHud() redraw the card and the timetable marks only when what
    // they say has changed. Page-view state like the rest of this object.
    todoDrawn: ''
  };

  // The Manager announces itself by asking every module to register, and that
  // is the only signal there is when it is evaluated after this module. Automatic
  // mode waits this long for it before falling back to a floating radar, so a
  // page with the Manager installed does not flash a floating HUD that then
  // jumps away. (The other order needs no wait: see MANAGER_DOCK_ROOT_ID.)
  const MANAGER_GRACE_MS = 2500;
  const loadedAt = Date.now();

  // Before anything is read: a snapshot belonging to a login this browser has
  // not used in two months is bytes nothing will ever look at again (#29).
  pruneStaleStorage();

  runtime.settings = loadSettings();
  runtime.state = loadState();

  registerWithManager();
  window.addEventListener('lectio-manager:discover', handleDiscovery);
  // The schema was worded in whichever language was current when it was
  // announced, so a language chosen later is answered with a fresh one.
  window.addEventListener('lectio-manager:language', handleLanguageChange);
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

  // Whether a setting tagged with an audience applies to the account this
  // page belongs to. Untagged settings apply to everyone.
  function settingApplies(key) {
    const audience = SETTING_AUDIENCE[key];
    return !audience || audience.includes(userRole);
  }

  // The one way a role-specific setting is read: switched on, and meant for
  // this account. A stored value for the other role's watch is kept - it is
  // the person's choice and survives a role being misread once - but it does
  // nothing here.
  function settingOn(key) {
    return Boolean(runtime.settings?.[key]) && settingApplies(key);
  }

  function handleLanguageChange() {
    // The schema and the to-do are both worded in the language current when
    // they were drawn.
    registerWithManager();
    runtime.todoDrawn = '';
    renderTeacherTodo();
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
        settingsSchema: settingSchema().map((item) => ({ ...item, value: currentValues[item.key] })),
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
            label: { en: 'Timetable snapshot, change log and to-do counts', da: 'Skema-øjebliksbillede, ændringslog og huskeliste' }
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

    // The to-do decides what is fetched as well, so switching it on asks for
    // a check just as switching on a watch does. Its marks toggle does not:
    // it only redraws what is already stored. A setting meant for the other
    // role changes nothing here, so it does not cost a check either.
    const watchChanged = BOOLEAN_SETTING_KEYS
      .filter((key) => (key.startsWith('track') || key === 'teacherTodo') && settingApplies(key))
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
  //
  // A source is fetched when a watch that applies to this account wants it, or
  // when the teacher to-do does. The two are separate questions because only
  // the first produces change-log entries: a teacher with the to-do on and
  // Watch assignments off gets the assignment list read and counted, and not
  // one "new assignment" in the radar.
  function todoActive() {
    return settingOn('teacherTodo');
  }

  function sourceWatched(source) {
    return settingOn(source.gate);
  }

  function sourceNeededForTodo(source) {
    return todoActive() && TODO_SOURCE_KEYS.includes(source.key);
  }

  async function buildSourceSnapshots(previous) {
    const carried = previous?.sources || {};
    const sources = {};
    const now = Date.now();

    for (const source of EXTRA_SOURCES) {
      const forTodo = sourceNeededForTodo(source);
      if (!sourceWatched(source) && !forTodo) continue;

      const reader = getSourceReader(source.key);
      const existing = carried[source.key];

      // A capture made before the to-do existed has none of what it counts,
      // so the to-do's first check reads the page again rather than drawing
      // nothing for half an hour. Once per upgrade, and still one request.
      const lacksTodo = forTodo && reader.meta && !existing?.meta;
      if (existing && !lacksTodo && now - Number(existing.capturedAt || 0) < EXTRA_SOURCE_MIN_GAP_MS) {
        sources[source.key] = existing;
        continue;
      }

      try {
        const doc = await fetchLectioDocument(reader.url());
        const records = reader.parse(doc);

        // A Lectio layout change can empty a parser that used to see rows. Keep
        // the last good capture rather than announcing that everything the user
        // had has just disappeared.
        if (existing && looksLikeParseFailure(existing.records, records)) {
          sources[source.key] = existing;
          continue;
        }

        const capture = { capturedAt: now, records };
        if (reader.meta) capture.meta = reader.meta(doc, records);
        sources[source.key] = capture;
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
      // Read for the to-do only, or for a watch meant for the other role:
      // captured, and not news.
      if (!sourceWatched(source)) continue;

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
        meta: assignmentListMeta,
        compare: compareAssignments
      };
    }

    if (key === 'absence') {
      return {
        url: () => `/lectio/${schoolId}/subnav/${userRole === 'teacher' ? 'fravaerlaerer' : 'fravaerelev'}.aspx`,
        parse: parseAbsence,
        meta: absencePageMeta,
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
      // `cell` is kept for the readers that need what is inside it rather
      // than its text - the context card naming who an assignment belongs to.
      // Rows are transient; nothing here is stored.
      const columns = headers.length
        ? (grid.get(row) || []).map((cell, index) => ({
          header: headers[index] || '',
          text: cell ? cellText(cell) : '',
          cell: cell || null
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

      const record = {
        id: row.id,
        title: row.title || 'Assignment',
        dueDate: due.dateIso,
        dueTime: due.time,
        status: findAssignmentStatus(row.cells, grade),
        context: findAssignmentContext(row.cells, row.title, grade),
        url: row.url
      };

      // The teacher to-do's two fields, present only when the list has the
      // column and the cell reads as what it should: a whole number of
      // submissions waiting, and the context card of the teacher the
      // assignment belongs to. Absent is "could not read", never 0.
      const waiting = findColumn(row, WAITING_COLUMN_PATTERN);
      if (waiting != null && /^\d{1,4}$/.test(waiting)) record.waiting = Number(waiting);

      const owner = findColumnCard(row, OWNER_COLUMN_PATTERN);
      if (/^T\d+$/i.test(owner)) record.owner = owner;

      records[row.id] = record;
    }

    return records;
  }

  // The context card inside the first column whose header matches, or ''.
  function findColumnCard(row, pattern) {
    const column = (row.columns || []).find((entry) => pattern.test(entry.header));
    const card = column?.cell?.querySelector('[data-lectiocontextcard]');
    return card ? cleanText(card.getAttribute('data-lectiocontextcard')) : '';
  }

  /*
   * What the to-do needs from the list page beyond its rows: whose list it
   * is. Lectio's page heading carries the context card of the person the page
   * is about, and on your own OpgaveListe that is you - so an assignment whose
   * Ansvarlig card is somebody else's is waiting on them, not on you. A page
   * with no such heading, or one that is not a teacher's, gives no owner, and
   * the to-do then counts every row rather than guessing.
   */
  function assignmentListMeta(doc) {
    const heading = doc.querySelector('#s_m_HeaderContent_MainTitle[data-lectiocontextcard], .maintitle[data-lectiocontextcard]');
    const card = cleanText(heading?.getAttribute('data-lectiocontextcard') || '');
    return { self: /^T\d+$/i.test(card) ? card : '' };
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

      const record = {
        id: row.id,
        type: 'registration',
        title: blockTitle || row.title || row.cells[0] || 'Absence registration',
        detail: row.cells.slice(0, 4).join(' · '),
        url: row.url
      };

      // For the teacher to-do: which lesson this is, as the timetable names
      // it (the block's own ABS id - on the real page the registration link's
      // id= is the same number), and the day it was taught.
      const activity = brick ? getActivityId(brick) : '';
      if (activity) record.activity = activity;
      const dateIso = brick ? tooltipDateIso(brick.getAttribute('data-tooltip')) : '';
      if (dateIso) record.dateIso = dateIso;

      records[row.id] = record;
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

  /*
   * Whether the teacher absence page's list of lessons awaiting registration
   * was there to read. Registrations parsed answer that on their own; this is
   * for the list that parsed to nothing, which is only "all registered" when
   * the Manglende registrering island is on the page and holds no lesson
   * data row the parser skipped. Anything else - no island, or an island
   * with more rows than were read - is unreadable, and the to-do then shows
   * no absence line at all rather than a 0 it cannot vouch for.
   */
  function absencePageMeta(doc, records) {
    const read = Object.values(records || {}).filter((record) => record.type === 'registration').length;

    for (const header of doc.querySelectorAll('.islandHeader, th, h1, h2, h3')) {
      if (!MISSING_REGISTRATION_PATTERN.test(cleanText(header.textContent || ''))) continue;

      const island = header.closest('section, .lf-island') || header.parentElement;
      if (!island) continue;

      const rows = Array.from(island.querySelectorAll('tr'))
        .filter((row) => row.querySelectorAll('td').length >= 2).length;
      return { island: true, listSeen: read >= rows };
    }

    return { island: false, listSeen: false };
  }

  function tooltipDateIso(tooltip) {
    const match = String(tooltip || '').match(/\b(\d{1,2})\/(\d{1,2})-(\d{4})\b/);
    return match ? `${match[3]}-${pad2(Number(match[2]))}-${pad2(Number(match[1]))}` : '';
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
            facets: [
              flagFacet('', 'New on the assignment list'),
              ...(next.dueDate ? [flagFacet('Due', formatDeadline(next))] : []),
              ...contextFacets(next)
            ],
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
          facets: [pairFacet('Deadline', formatDeadline(previous), formatDeadline(next)), ...contextFacets(next)],
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
          facets: [flagFacet('Due', formatDeadline(next)), ...contextFacets(next)],
          noticedAt,
          record: next
        }));
      }

      // Status and grade exist only on a student's list (SETTING_AUDIENCE).
      if (settingOn('trackAssignmentStatus') && fieldChanged(previous.status, next.status)) {
        changes.push(makeSourceEntry({
          kind: 'status',
          title: next.title,
          detail: `Status: ${previous.status || 'none'} -> ${next.status || 'none'}`,
          facets: [pairFacet('Status', previous.status, next.status)],
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
        if (!previous && settingOn('trackAbsenceRegistrations')) {
          changes.push(makeSourceEntry({
            kind: 'absence',
            title: next.title,
            detail: next.detail ? `New absence registration · ${truncate(next.detail, 70)}` : 'New absence registration',
            facets: [
              flagFacet('', 'New absence registration'),
              ...(next.detail ? [flagFacet('Details', next.detail)] : [])
            ],
            noticedAt,
            record: next
          }));
        }
        continue;
      }

      if (settingOn('trackAbsencePercent') && previous && fieldChanged(previous.detail, next.detail)) {
        changes.push(makeSourceEntry({
          kind: 'absence',
          title: next.title,
          detail: `Absence: ${previous.detail || 'none'} -> ${next.detail || 'none'}`,
          facets: [pairFacet('Absence', previous.detail, next.detail)],
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
            facets: [
              flagFacet('', 'New document'),
              ...(next.detail ? [flagFacet('Details', next.detail)] : [])
            ],
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
          facets: [pairFacet('Document', previous.detail, next.detail)],
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
  function makeSourceEntry({ kind, title, detail, facets, noticedAt, record }) {
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
      facets,
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
          facets: [flagFacet('', 'Added to your schedule')],
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
          facets: [flagFacet('', 'Removed from your schedule')],
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
    const facets = [];
    let kind = 'changed';

    if (settings.trackCancellations) {
      if (next.status === 'cancelled' && before.status !== 'cancelled') {
        kind = 'cancelled';
        details.push('Cancelled');
        facets.push(flagFacet('Status', 'Cancelled'));
      } else if (before.status === 'cancelled' && next.status !== 'cancelled') {
        kind = 'restored';
        details.push('Cancellation cleared');
        facets.push(flagFacet('Status', 'Cancellation cleared'));
      }
    }

    if (settings.trackTimeChanges &&
        (before.dateIso !== next.dateIso || before.start !== next.start || before.end !== next.end || before.allDay !== next.allDay)) {
      if (kind === 'changed') kind = 'time';
      details.push(`Time: ${formatEventWhen(before)} -> ${formatEventWhen(next)}`);
      facets.push(pairFacet('Time', formatEventWhen(before), formatEventWhen(next)));
    }

    if (settings.trackRoomChanges && fieldChanged(before.room, next.room)) {
      if (kind === 'changed') kind = 'room';
      details.push(`Room: ${before.room || 'none'} -> ${next.room || 'none'}`);
      facets.push(pairFacet('Room', before.room, next.room));
    }

    if (settings.trackTeacherChanges && fieldChanged(before.teacher, next.teacher)) {
      if (kind === 'changed') kind = 'teacher';
      details.push(`Teacher: ${before.teacher || 'none'} -> ${next.teacher || 'none'}`);
      facets.push(pairFacet('Teacher', before.teacher, next.teacher));
    }

    if (settings.trackHomework && fieldChanged(before.homework, next.homework)) {
      if (kind === 'changed') kind = 'homework';
      details.push(`Homework ${summarizeFieldChange(before.homework, next.homework)}`);
      facets.push(pairFacet('Homework', before.homework, next.homework));
    }

    if (settings.trackLessonNotes) {
      if (fieldChanged(before.note, next.note)) {
        if (kind === 'changed') kind = 'note';
        details.push(`Note ${summarizeFieldChange(before.note, next.note)}`);
        facets.push(pairFacet('Note', before.note, next.note));
      }
      if (fieldChanged(before.otherContent, next.otherContent)) {
        if (kind === 'changed') kind = 'note';
        details.push(`Other content ${summarizeFieldChange(before.otherContent, next.otherContent)}`);
        facets.push(pairFacet('Other content', before.otherContent, next.otherContent));
      }
    }

    if (settings.trackLessonDetails) {
      if (fieldChanged(before.hold, next.hold)) {
        details.push(`Class: ${before.hold || 'none'} -> ${next.hold || 'none'}`);
        facets.push(pairFacet('Class', before.hold, next.hold));
      }
      if (fieldChanged(before.title, next.title)) {
        details.push(`Title: ${before.title || 'untitled'} -> ${next.title || 'untitled'}`);
        facets.push(pairFacet('Title', before.title, next.title));
      }
      if (fieldChanged(before.resources, next.resources)) {
        details.push(`Resources: ${before.resources || 'none'} -> ${next.resources || 'none'}`);
        facets.push(pairFacet('Resources', before.resources, next.resources));
      }
      if (fieldChanged(before.participants, next.participants)) {
        details.push(`Participants: ${before.participants || 'none'} -> ${next.participants || 'none'}`);
        facets.push(pairFacet('Participants', before.participants, next.participants));
      }

      // Lectio sometimes marks a brick changed even when the compact tooltip does
      // not expose which field changed. It belongs here because an unnamed change
      // is exactly the administrative noise this toggle governs.
      if (!details.length && next.status === 'changed' && before.status !== 'changed') {
        details.push('Lectio marked this activity as changed');
        facets.push(flagFacet('', 'Lectio marked this activity as changed'));
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
      facets,
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

  /*
   * A change is two values, not a sentence. Every comparison above keeps
   * writing the flat sentence it always wrote - it is what the history dedupe
   * fingerprints, what entries stored by an earlier version carry, and what
   * the panel falls back to - and now also records the pair the sentence was
   * made of, so the panel can set the old value against the new one instead of
   * running every changed field into a single line.
   *
   * The limit is inside the function rather than beside it, for the reason
   * boundedStateForStorage() spells out: this file is evaluated top to bottom
   * with init() called from a boot block above here, so a module-scope const
   * this far down is still in its temporal dead zone when an early caller
   * runs. It is more generous than the sentence's 70-character excerpt because
   * reading the two values against each other is the whole point of the pair.
   */
  function pairFacet(label, before, next) {
    const valueLimit = 160;
    return {
      label,
      before: truncate(before, valueLimit),
      after: truncate(next, valueLimit)
    };
  }

  // A change with no "before" to show: a cancellation, a new document, a
  // deadline arriving. One value, stated rather than compared.
  function flagFacet(label, text) {
    const valueLimit = 160;
    return { label, text: truncate(text, valueLimit) };
  }

  // A source record often knows which class or hold it belongs to, which the
  // sentence appends with withContext(). As a facet it gets its own labelled
  // row instead of trailing off the end of the line.
  function contextFacets(record) {
    return record?.context ? [flagFacet('Class', record.context)] : [];
  }

  function truncate(value, limit) {
    const text = cleanText(value);
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
  }

  function makeHistoryEntry({ event, kind, title, detail, facets, noticedAt }) {
    const fingerprint = [
      event.id,
      kind,
      detail,
      event.dateIso,
      event.start
    ].join('|');

    const entry = {
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

    // Deliberately absent rather than empty when there is nothing laid out to
    // show: the stored log is size-bounded, and an entry that has only its
    // sentence should not spend bytes saying so.
    const laidOut = usableFacets(facets);
    if (laidOut.length) entry.facets = laidOut;

    return entry;
  }

  // A pair whose two sides are both empty says nothing; a pair with one empty
  // side says the field was filled in or cleared, which is news worth a row.
  function usableFacets(facets) {
    if (!Array.isArray(facets)) return [];
    return facets.filter((facet) => facet && (facet.text || facet.before || facet.after));
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
        width: min(380px, calc(100vw - 24px));
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
        max-height: min(62vh, 520px);
        overflow-y: auto;
        overscroll-behavior: contain;
        background: var(--lcr-surface) !important;
      }

      .lcr-item {
        display: block;
        box-sizing: border-box;
        border: 0;
        border-bottom: 1px solid var(--lcr-border) !important;
        border-left: 3px solid var(--lcr-border) !important;
        background: var(--lcr-surface) !important;
        color: var(--lcr-text) !important;
        padding: 9px 11px 10px 9px;
        text-decoration: none !important;
      }

      /*
       * The stripe carries the category, so the eye lands on the right entry
       * before it reads a word of it. Colour on a 3px rule rather than on text:
       * the panel takes its surface from whatever Lectio is wearing, and a hue
       * that has to stay legible as 9px type on both a white and a near-black
       * background is a hue that ends up legible on neither.
       */
      .lcr-item[data-tone="drop"] { border-left-color: #d94b43 !important; }
      .lcr-item[data-tone="add"] { border-left-color: #3b9a58 !important; }
      .lcr-item[data-tone="move"] { border-left-color: #d79619 !important; }
      .lcr-item[data-tone="watch"] { border-left-color: #4a7fbf !important; }
      .lcr-item[data-tone="content"] { border-left-color: #7b62b0 !important; }
      .lcr-item[data-tone="plain"] { border-left-color: transparent !important; }
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

      /*
       * One row per changed field: a label in a narrow left column, the old and
       * the new value in the right one. Short pairs sit on a line with an arrow
       * between them; anything longer stacks as was / now, because the pair
       * wrapping into each other is exactly the run-on line this replaces.
       */
      .lcr-facets {
        margin-top: 5px;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .lcr-facet {
        display: grid;
        grid-template-columns: 66px minmax(0, 1fr);
        column-gap: 8px;
        align-items: baseline;
      }
      /* A row whose label would only repeat the chip above it drops the column
         rather than the alignment. */
      .lcr-facet.is-bare { grid-template-columns: minmax(0, 1fr); }
      .lcr-facet-label {
        color: var(--lcr-muted) !important;
        font-size: 8.5px;
        font-weight: 800;
        letter-spacing: .045em;
        line-height: 1.5;
        text-transform: uppercase;
        overflow-wrap: normal;
        word-break: keep-all;
      }
      .lcr-facet-values {
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 2px 6px;
        font-size: 10.5px;
        line-height: 1.45;
      }
      .lcr-facet.is-stacked .lcr-facet-values {
        flex-direction: column;
        align-items: stretch;
        gap: 2px;
      }
      .lcr-side-line {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .lcr-side {
        flex: 0 0 26px;
        color: var(--lcr-muted) !important;
        font-size: 8.5px;
        font-weight: 700;
        letter-spacing: .04em;
        text-transform: uppercase;
      }
      .lcr-was {
        min-width: 0;
        color: var(--lcr-muted) !important;
        text-decoration: line-through !important;
        text-decoration-thickness: 1px;
        overflow-wrap: anywhere;
      }
      .lcr-now {
        min-width: 0;
        border-radius: 4px;
        background: var(--lcr-soft) !important;
        color: var(--lcr-text) !important;
        padding: 1px 5px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .lcr-was.is-blank, .lcr-now.is-blank {
        color: var(--lcr-muted) !important;
        font-style: italic;
        font-weight: 400;
        text-decoration: none !important;
      }
      .lcr-now.is-blank { background: transparent !important; padding: 0; }
      .lcr-arrow {
        flex: 0 0 auto;
        color: var(--lcr-muted) !important;
        font-weight: 700;
      }
      .lcr-flag {
        min-width: 0;
        color: var(--lcr-text) !important;
        font-weight: 700;
        overflow-wrap: anywhere;
      }

      /* Read aloud, never drawn: the arrow and the strikethrough are the only
         thing saying which value is which, and neither reaches a screen reader. */
      .lcr-sr {
        position: absolute !important;
        width: 1px;
        height: 1px;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
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

      /*
       * The teacher to-do (issue #76). Calm on purpose: page colours through
       * the theming seam (ADR-0006), no red, no badge - a nudge, not an alarm.
       */
      #${UI.todoCard} {
        box-sizing: border-box;
        margin: 0 0 12px;
        padding: 10px 12px 8px;
        border: 1px solid var(--lectio-theme-muted, #c8d4dc);
        border-radius: var(--lectio-theme-radius, 10px);
        background: var(--lectio-theme-surface, #ffffff);
        color: var(--lectio-theme-text, #243746);
        font: 13px/1.4 Roboto, Arial, sans-serif;
      }
      #${UI.todoCard} .lcr-todo-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }
      #${UI.todoCard} .lcr-todo-title { font-weight: 700; }
      #${UI.todoCard} .lcr-todo-meta,
      #${UI.todoCard} .lcr-todo-label {
        color: var(--lectio-theme-muted, #667783);
        font-size: 11px;
      }
      #${UI.todoCard} .lcr-todo-line {
        display: flex;
        gap: 10px;
        padding: 5px 0;
        border-top: 1px solid var(--lectio-theme-surface-alt, #eef1f2);
        color: var(--lectio-theme-text, #243746) !important;
        text-decoration: none !important;
      }
      #${UI.todoCard} .lcr-todo-label {
        flex: 0 0 7.5em;
        font-weight: 700;
        letter-spacing: .03em;
        text-transform: uppercase;
      }
      #${UI.todoCard} .lcr-todo-text { color: var(--lectio-theme-accent, #0f6f6f); }
      #${UI.todoCard} .lcr-todo-line:hover .lcr-todo-text,
      #${UI.todoCard} .lcr-todo-line:focus-visible .lcr-todo-text { text-decoration: underline; }

      .lcr-todo-anchor { position: relative; }
      .lcr-todo-mark {
        position: absolute;
        right: 2px;
        bottom: 2px;
        z-index: 2;
        width: 14px;
        height: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        border-radius: 50%;
        background: var(--lectio-theme-surface, #ffffff) !important;
        color: var(--lectio-theme-accent, #0f6f6f) !important;
        box-shadow: 0 0 0 1px var(--lectio-theme-muted, #c8d4dc);
        text-decoration: none !important;
      }
      .lcr-todo-mark svg { width: 10px; height: 10px; display: block; }
      .lcr-todo-mark:hover, .lcr-todo-mark:focus-visible {
        box-shadow: 0 0 0 2px var(--lectio-theme-accent, #0f6f6f);
        outline: none;
      }

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

    // Hover and focus open and close the panel; they must not rebuild it. A
    // pointer click focuses the button it lands on, so focusin fires between
    // mousedown and mouseup - and a rebuild there replaces that button with a
    // new node, so the click has no target left and never fires. That is why
    // Settings, and every other button in the floating panel, did nothing
    // for the mouse (issue #66).
    root.addEventListener('mouseenter', () => {
      if (!runtime.settings.hoverOpen) return;
      setHovered(true);
    });
    root.addEventListener('mouseleave', () => setHovered(false));
    root.addEventListener('focusin', () => setHovered(true));
    root.addEventListener('focusout', (event) => {
      if (!root.contains(event.relatedTarget)) setHovered(false);
    });

    document.body.appendChild(root);
  }

  function setHovered(hovered) {
    if (runtime.hovered === hovered) return;
    runtime.hovered = hovered;
    syncExpanded();
  }

  // The one piece of renderHud() that hover and focus need: the open/closed
  // state, on the existing nodes, without replacing any of them.
  function syncExpanded() {
    const root = document.getElementById(UI.root);
    if (!root) return;

    const expanded = runtime.pinned || runtime.hovered;
    root.classList.toggle('is-expanded', expanded);
    document.getElementById(UI.button)?.setAttribute('aria-expanded', String(expanded));

    const history = runtime.state?.history || [];
    const status = getRadarState(history, readNumber(STORAGE.lastViewed));
    scheduleAutoSeen(expanded && !runtime.settingsOpen, status.unseen);
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

    // A radar still waiting for this answer moves into the dock now, and one
    // already there re-registers its item, which the dock contract asks for on
    // every Discovery. Neither may wait for the next poll to redraw it.
    if (resolveDisplayMode() === 'dock') renderHud();
  }

  /*
   * Whether the Manager is on this page. Discovery is the answer when the
   * Manager is evaluated after this module; when it was evaluated first, its
   * Discovery has already fired into a page with no listener for it, so the
   * dock root it built during that same boot is the answer instead. Either
   * one settles it for the life of the page.
   */
  function managerOnPage() {
    if (!runtime.managerSeen && document.getElementById(MANAGER_DOCK_ROOT_ID)) {
      runtime.managerSeen = true;
    }
    return runtime.managerSeen;
  }

  // 'auto' resolves to the dock whenever the Manager is on the page, and to the
  // floating radar once it is clear no Manager is going to be. 'waiting' is that
  // short gap.
  function resolveDisplayMode() {
    const mode = runtime.settings.displayMode;
    if (mode === 'dock' || mode === 'floating') return mode;
    if (managerOnPage()) return 'dock';
    return Date.now() - loadedAt < MANAGER_GRACE_MS ? 'waiting' : 'floating';
  }

  function renderHud() {
    syncTheme();
    renderTeacherTodo();

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

  // ---------------------------------------------------------------
  // TEACHER TO-DO (issue #76)
  // ---------------------------------------------------------------
  //
  // Read-only, and drawn only from what the checks above already stored: the
  // to-do never fetches on its own and never writes to Lectio (ADR-0009).
  // Each count is null when the table behind it could not be read - and a
  // null line is not drawn at all, never drawn as 0 (the Unread rule).

  function teacherTodoSummary() {
    if (!todoActive()) return null;

    const sources = runtime.state?.snapshot?.sources || {};
    const now = new Date();
    const today = toIsoDate(now);
    const weekEnd = toIsoDate(addDays(startOfIsoWeek(now), 6));
    const summary = { absence: null, marking: null, due: null, checkedAt: 0 };
    const stamp = (capture) => {
      const at = Number(capture?.capturedAt) || 0;
      if (at && (!summary.checkedAt || at < summary.checkedAt)) summary.checkedAt = at;
    };

    const absence = sources.absence;
    if (absence?.records && absence.meta) {
      const lessons = Object.values(absence.records).filter((record) => record?.type === 'registration');
      // With the list found, every row in it must have been read; without
      // it (another layout), the registrations that were read stand alone.
      if (absence.meta.island ? absence.meta.listSeen : lessons.length > 0) {
        const dates = lessons.map((record) => record.dateIso).filter(Boolean).sort();
        summary.absence = {
          count: lessons.length,
          oldest: dates[0] || '',
          lessons: lessons
            .filter((record) => record.activity && record.url)
            .map((record) => ({ activity: record.activity, url: record.url }))
        };
        stamp(absence);
      }
    }

    const assignments = sources.assignments;
    if (assignments?.records && assignments.meta) {
      const rows = Object.values(assignments.records).filter(Boolean);

      // Only rows whose waiting cell was read count, and of those only the
      // ones that are this teacher's when the list says whose each one is.
      const counted = rows.filter((record) => typeof record.waiting === 'number');
      if (counted.length) {
        const self = assignments.meta.self || '';
        const waiting = counted.filter((record) =>
          record.waiting > 0 && (!self || !record.owner || record.owner === self));
        const deadlines = waiting.map((record) => record.dueDate).filter(Boolean).sort();
        summary.marking = {
          total: waiting.reduce((sum, record) => sum + record.waiting, 0),
          assignments: waiting.length,
          oldest: deadlines[0] || ''
        };
        stamp(assignments);
      }

      // Still to come this ISO week. A list with no readable deadline says
      // nothing either way.
      const dated = rows.filter((record) => record.dueDate);
      if (dated.length) {
        summary.due = {
          count: dated.filter((record) => record.dueDate >= today && record.dueDate <= weekEnd).length
        };
        stamp(assignments);
      }
    }

    return summary.absence || summary.marking || summary.due ? summary : null;
  }

  function fillText(template, values) {
    return String(template).replace(/\{(\w+)\}/g, (_, name) => (values[name] ?? ''));
  }

  function formatDayMonth(isoDate) {
    const match = String(isoDate || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
    return match ? `${Number(match[2])}/${Number(match[1])}` : '';
  }

  function isForside() {
    return /\/forside\.aspx$/i.test(location.pathname);
  }

  // Redraws the Forside card and the timetable marks when what they would say
  // has changed, and removes both when there is nothing to say. Cheap to call
  // from every renderHud(): an unchanged to-do returns before touching the DOM.
  function renderTeacherTodo() {
    if (!document.body || !document.getElementById(UI.style)) return;

    const summary = teacherTodoSummary();
    const language = radarLanguage();
    const marks = Boolean(summary?.absence) && settingOn('teacherTodoMarks') &&
      !TODO_MARK_SKIP_PATH.test(location.pathname);
    const drawn = summary ? JSON.stringify([language, marks, summary]) : '';

    const card = document.getElementById(UI.todoCard);
    const cardWanted = Boolean(summary) && isForside();
    if (drawn === runtime.todoDrawn && Boolean(card) === cardWanted) return;
    runtime.todoDrawn = drawn;

    card?.remove();
    clearTodoMarks();
    if (!summary) return;

    const text = TODO_TEXT[language];
    if (cardWanted) placeTodoCard(buildTodoCard(summary, text));
    if (marks) markUnregisteredLessons(summary.absence.lessons, text);
  }

  function buildTodoCard(summary, text) {
    const card = document.createElement('section');
    card.id = UI.todoCard;
    card.className = 'lcr-todo-card';
    card.setAttribute('aria-label', text.cardLabel);

    const head = document.createElement('div');
    head.className = 'lcr-todo-head';
    const title = document.createElement('span');
    title.className = 'lcr-todo-title';
    title.textContent = text.title;
    head.appendChild(title);
    if (summary.checkedAt) {
      const meta = document.createElement('span');
      meta.className = 'lcr-todo-meta';
      meta.textContent = fillText(text.checkedAt, { time: formatTodoStamp(summary.checkedAt) });
      head.appendChild(meta);
    }
    card.appendChild(head);

    const list = `/lectio/${schoolId}/OpgaveListe.aspx`;
    const line = (kind, label, value, href, linkTitle) => {
      const link = document.createElement('a');
      link.className = 'lcr-todo-line';
      link.dataset.todo = kind;
      link.href = href;
      link.title = linkTitle;
      const name = document.createElement('span');
      name.className = 'lcr-todo-label';
      name.textContent = label;
      const detail = document.createElement('span');
      detail.className = 'lcr-todo-text';
      detail.textContent = value;
      link.append(name, detail);
      card.appendChild(link);
    };

    const { absence, marking, due } = summary;

    if (absence) {
      let value = absence.count === 0
        ? text.absenceNone
        : absence.count === 1 ? text.absenceOne : fillText(text.absenceMany, { count: absence.count });
      if (absence.count && absence.oldest) value += ` (${fillText(text.oldest, { date: formatDayMonth(absence.oldest) })})`;
      line('absence', text.absenceLabel, value, `/lectio/${schoolId}/subnav/fravaerlaerer.aspx`, text.absenceLink);
    }

    if (marking) {
      let value = text.markingNone;
      if (marking.total > 0) {
        value = fillText(text.markingLine, {
          submissions: marking.total === 1 ? text.submissionOne : fillText(text.submissionMany, { count: marking.total }),
          across: marking.assignments === 1 ? text.acrossOne : fillText(text.acrossMany, { count: marking.assignments })
        });
        if (marking.oldest) value += ` (${fillText(text.oldestDeadline, { date: formatDayMonth(marking.oldest) })})`;
      }
      line('marking', text.markingLabel, value, list, text.markingLink);
    }

    if (due) {
      const value = due.count === 0
        ? text.dueNone
        : due.count === 1 ? text.dueOne : fillText(text.dueMany, { count: due.count });
      line('due', text.dueLabel, value, list, text.dueLink);
    }

    return card;
  }

  function formatTodoStamp(timestamp) {
    const then = new Date(timestamp);
    return toIsoDate(then) === toIsoDate(new Date())
      ? formatClock(timestamp)
      : `${formatDayMonth(toIsoDate(then))} ${formatClock(timestamp)}`;
  }

  // At the top of the Forside's first column of islands, where the eye starts.
  // A Forside laid out some other way gets no card rather than a card
  // somewhere odd.
  function placeTodoCard(card) {
    const column = document.querySelector('.ls-dashboard .ls-std-island-layout-col');
    if (column) {
      column.insertBefore(card, column.firstChild);
      return;
    }

    const content = document.getElementById('contenttable') || document.querySelector('.ls-content');
    if (content) content.insertBefore(card, content.firstChild);
  }

  function clearTodoMarks() {
    for (const mark of document.querySelectorAll('.lcr-todo-mark')) mark.remove();
    for (const block of document.querySelectorAll('.lcr-todo-anchor')) block.classList.remove('lcr-todo-anchor');
  }

  /*
   * A small corner mark on each lesson block of this page whose absence is
   * still waiting for registration, linking to that lesson's registration
   * page - where the teacher registers it themselves, in Lectio's own form.
   * Matched on the block's activity id, and only on real lesson blocks
   * ([data-tooltip], AGENTS.md). Bottom right, inside the block: Chairs Up
   * owns the top-right corner, and the block's colour belongs to whoever
   * painted it (ADR-0011) - the mark only sits on top.
   */
  function markUnregisteredLessons(lessons, text) {
    const byActivity = new Map((lessons || []).map((lesson) => [lesson.activity, lesson.url]));
    if (!byActivity.size) return;

    for (const block of document.querySelectorAll('.s2skemabrik[data-tooltip]')) {
      const url = byActivity.get(getActivityId(block));
      if (!url || block.classList.contains('s2cancelled')) continue;

      if (getComputedStyle(block).position === 'static') block.classList.add('lcr-todo-anchor');

      const mark = document.createElement('a');
      mark.className = 'lcr-todo-mark';
      mark.href = url;
      mark.title = text.markLabel;
      mark.setAttribute('aria-label', text.markLabel);
      mark.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">' +
        '<rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
      // The block is itself a link with Lectio's own handlers on it. The mark
      // is the nearer link, so the browser follows it; stopping the event
      // here keeps the block's handlers from also acting on the same click.
      mark.addEventListener('click', (event) => event.stopPropagation());
      block.appendChild(mark);
    }
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
    node.dataset.tone = kindTone(item.kind);

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
      ${renderChangeBody(item)}
      <div class="lcr-meta">${escapeHtml(when)}${when && noticed ? ' · ' : ''}${escapeHtml(noticed)}</div>`;
    return node;
  }

  /*
   * What actually changed, laid out as rows rather than as one run-on line.
   *
   * Three sources, in order of how much they know. An entry written by this
   * version carries the pairs the comparison found. An entry stored by an
   * earlier one has only the sentence, so the sentence is read back into pairs
   * - the log holds at most twenty entries and turns over in days, but the
   * ones already on screen when this version lands should not be the only
   * unreadable ones. Anything that parses into nothing is shown exactly as it
   * always was, which is also where a future detail shape lands.
   */
  function renderChangeBody(item) {
    const stored = usableFacets(item.facets);
    const facets = stored.length ? stored : parseDetailFacets(item.detail);

    if (!facets.length) {
      return `<div class="lcr-detail">${escapeHtml(item.detail || 'Schedule changed')}</div>`;
    }

    // A single row labelled the same as the chip above it says "ROOM" twice in
    // two lines. The chip is the one that stays: it is what the eye scans.
    const bare = facets.length === 1 &&
      cleanText(facets[0].label).toLowerCase() === kindLabel(item.kind).toLowerCase();

    return `<div class="lcr-facets">${facets.map((facet) => renderFacet(facet, bare)).join('')}</div>`;
  }

  function renderFacet(facet, bare) {
    const label = bare || !facet.label
      ? ''
      : `<span class="lcr-facet-label">${escapeHtml(facet.label)}</span>`;

    const row = label ? 'lcr-facet' : 'lcr-facet is-bare';

    if (facet.text) {
      return `<div class="${row}">${label}<div class="lcr-facet-values">` +
        `<span class="lcr-flag">${escapeHtml(facet.text)}</span></div></div>`;
    }

    const before = cleanText(facet.before);
    const after = cleanText(facet.after);
    const was = before
      ? `<span class="lcr-was" title="${escapeHtml(before)}">${escapeHtml(before)}</span>`
      : '<span class="lcr-was is-blank">nothing</span>';
    const now = after
      ? `<span class="lcr-now" title="${escapeHtml(after)}">${escapeHtml(after)}</span>`
      : '<span class="lcr-now is-blank">cleared</span>';

    // A room code against a room code reads fine on one line; two paragraphs of
    // homework in a 380px panel does not. The threshold is where the pair stops
    // fitting the width the panel actually has.
    if (before.length + after.length <= 34 && before.length <= 20 && after.length <= 20) {
      return `<div class="${row}">${label}<div class="lcr-facet-values">` +
        `<span class="lcr-sr">was </span>${was}` +
        `<span class="lcr-arrow"><span class="lcr-sr">, now </span><span aria-hidden="true">&#8594;</span></span>` +
        `${now}</div></div>`;
    }

    return `<div class="${row} is-stacked">${label}<div class="lcr-facet-values">` +
      `<div class="lcr-side-line"><span class="lcr-side">was</span>${was}</div>` +
      `<div class="lcr-side-line"><span class="lcr-side">now</span>${now}</div>` +
      `</div></div>`;
  }

  // The sentence's own grammar, read backwards: fields joined with " · ", a
  // pair written "Label: before -> after". A part that does not fit that shape
  // is kept whole as a stated line, so nothing is ever dropped on the way.
  function parseDetailFacets(detail) {
    const text = cleanText(detail);
    if (!text) return [];

    // The words the sentence writes where a field was empty. Read back as the
    // empty values they stand for, so an old entry says 'nothing' in the same
    // italics a new one does rather than the literal word 'none'.
    const blank = (value) => (/^(?:none|untitled)$/i.test(value) ? '' : value);

    return text.split(' · ').map((part) => {
      const pair = part.match(/^([^:]{1,24}): (.+?) -> (.+)$/);
      return pair ? pairFacet(pair[1], blank(pair[2]), blank(pair[3])) : flagFacet('', part);
    });
  }

  // The colour of the stripe down the left of an item, so a cancellation and a
  // room move are told apart before either is read. Four meanings, not sixteen:
  // something is gone, something arrived, something moved, something is owed.
  function kindTone(kind) {
    const tones = {
      cancelled: 'drop',
      removed: 'drop',
      added: 'add',
      restored: 'add',
      assignment: 'add',
      document: 'add',
      time: 'move',
      room: 'move',
      teacher: 'move',
      deadline: 'move',
      due: 'watch',
      absence: 'watch',
      status: 'watch',
      homework: 'content',
      note: 'content'
    };
    return tones[kind] || 'plain';
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

    // The panel is the module's own, so it hides what does not apply to this
    // account itself rather than leaving that to a Manager.
    for (const schema of settingSchema().filter((control) => settingApplies(control.key))) {
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
