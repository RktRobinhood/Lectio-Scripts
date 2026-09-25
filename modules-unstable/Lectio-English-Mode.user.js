// ==UserScript==
// @name         Lectio English Mode
// @namespace    lectio-english-mode
// @version      1.11.9
// @description  Context-aware English layer for Lectio with instant core UI translation, persistent cache and Google fallback.
// @match        https://www.lectio.dk/lectio/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      translate.googleapis.com
// @connect      translate.google.com
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-English-Mode.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-English-Mode.user.js
// ==/UserScript==

(() => {
    'use strict';

    const MODE_DA = 'da';
    const MODE_EN = 'en';
    const STORAGE_MODE = 'lectioEnglish.mode';
    const SWITCH_POSITION_LOCKED = 'locked';
    const SWITCH_POSITION_FLOATING = 'floating';
    const SWITCH_POSITIONS = [
        SWITCH_POSITION_LOCKED,
        SWITCH_POSITION_FLOATING
    ];
    const STORAGE_SWITCH_POSITION = 'lectioEnglish.switchPosition';
    /*
     * Moved up here from beside the learned library below, because the
     * Manager handshake runs during this file's own evaluation and would
     * otherwise read it while it was still in its temporal dead zone.
     */
    const STORAGE_CACHE = 'lectioEnglish.learned.v5';
    const LOG = '[Lectio English Mode]';

    function readSwitchPosition() {
        const savedPosition = GM_getValue(
            STORAGE_SWITCH_POSITION,
            SWITCH_POSITION_LOCKED
        );

        return SWITCH_POSITIONS.includes(savedPosition)
            ? savedPosition
            : SWITCH_POSITION_LOCKED;
    }

    let switchPosition = readSwitchPosition();

    function applySwitchPosition() {
        const languageSwitch = document.getElementById(
            'lectio-english-switch'
        );

        if (languageSwitch) {
            languageSwitch.dataset.position = switchPosition;
        }
    }

    /*
     * The one place this module's version is written down in code, at module
     * scope because two things read it: the handshake below, and the start-up
     * banner in init(). The banner used to carry its own copy typed in by
     * hand, which is exactly what drifted - it printed v1.5.3 for months while
     * this said 1.11.x. Anything that needs the number reads it from here.
     *
     * It has to be declared out here rather than inside the handshake: init()
     * could not see a const scoped to that function. Keep it above the boot
     * block (scripts/check-boot-order.mjs).
     */
    const MODULE_VERSION = '1.11.9';

    /*
     * Lectio Manager handshake.
     * Lets the Manager show this module as installed without
     * touching its private storage. See catalogue/modules.json.
     */
    (function registerWithLectioManager() {
        const MODULE_ID = 'english-mode';
        const MODULE_NAME = 'Lectio English Mode';

        /*
         * The settings panel's own words, in both languages (ADR-0013). The
         * Manager renders these strings exactly as given, so the schema is
         * built from whichever language is current each time announce()
         * runs, and lectio-manager:language re-announces it. Order of
         * authority: the Manager's published choice, then <html lang> -
         * which this very module sets to its own mode - then Danish.
         *
         * The two language names in the picker are deliberately not here:
         * a language is named in itself, in both panels.
         *
         * The two literals sit between i18n markers so
         * scripts/check-i18n.mjs can hold their keys in step. Only display
         * strings live here - never a key, a type, a default or an option
         * value.
         */
        function labels() {
            const preferred = document.documentElement?.dataset?.lectioLanguage;
            const language = (preferred || document.documentElement?.lang || 'da').toLowerCase();

            return language.startsWith('en')
                // i18n:en
                ? {
                    languageLabel: 'Interface language',
                    languageHelp: 'Reloads Lectio in the selected language.',
                    positionLabel: 'Language switch position',
                    positionHelp: 'Choose whether the DA/EN switch scrolls with the page or stays visible.',
                    positionLocked: 'Locked',
                    positionFloating: 'Floating'
                }
                // i18n:da
                : {
                    languageLabel: 'Sprog i brugerfladen',
                    languageHelp: 'Genindlæser Lectio på det valgte sprog.',
                    positionLabel: 'Sprogknappens placering',
                    positionHelp: 'Vælg, om DA/EN-knappen ruller med siden eller bliver stående synlig.',
                    positionLocked: 'Låst',
                    positionFloating: 'Flydende'
                };
                // i18n:end
        }

        function announce() {
            const storedMode = GM_getValue(STORAGE_MODE, MODE_DA);
            const text = labels();

            window.dispatchEvent(new CustomEvent('lectio-module:register', {
                detail: {
                    id: MODULE_ID,
                    name: MODULE_NAME,
                    version: MODULE_VERSION,
                    settingsSchema: [
                        {
                            key: 'language',
                            type: 'select',
                            label: text.languageLabel,
                            description: text.languageHelp,
                            options: [
                                { value: MODE_DA, label: 'Dansk' },
                                { value: MODE_EN, label: 'English' }
                            ]
                        },
                        {
                            key: 'switchPosition',
                            type: 'select',
                            label: text.positionLabel,
                            description: text.positionHelp,
                            options: [
                                { value: SWITCH_POSITION_LOCKED, label: text.positionLocked },
                                { value: SWITCH_POSITION_FLOATING, label: text.positionFloating }
                            ]
                        }
                    ],
                    currentValues: {
                        language: [MODE_DA, MODE_EN].includes(storedMode) ? storedMode : MODE_DA,
                        switchPosition
                    },
                    /*
                     * What this module keeps, and where (issue #29,
                     * docs/manager-storage-api.md).
                     *
                     * All of it is `area: 'script'`. This is the one module
                     * that holds GM_getValue storage rather than the page's
                     * localStorage, so none of it counts against the site's
                     * ~5 MB and none of it is visible to the Manager - GM
                     * storage is per-script and cannot be enumerated from
                     * another userscript. Declaring it anyway is the point:
                     * the readout says so in as many words, instead of
                     * leaving this module's absence to read as a bug.
                     *
                     * The learned library is prunable: every entry in it can
                     * be translated again. The two settings are not.
                     */
                    storage: [
                        {
                            key: STORAGE_MODE,
                            area: 'script',
                            kind: 'setting',
                            label: { en: 'Chosen language', da: 'Valgt sprog' }
                        },
                        {
                            key: STORAGE_SWITCH_POSITION,
                            area: 'script',
                            kind: 'setting',
                            label: { en: 'Switch position', da: 'Knappens placering' }
                        },
                        {
                            key: STORAGE_CACHE,
                            area: 'script',
                            kind: 'cache',
                            prunable: true,
                            label: { en: 'Learned translations', da: 'Lærte oversættelser' }
                        }
                    ]
                }
            }));
        }

        /*
         * The Manager asks; this does the deleting, and only for the one key
         * it declared prunable. The Manager could not do this itself even if
         * it wanted to: GM storage belongs to this script alone.
         */
        function handlePrune(event) {
            const detail = event?.detail;

            if (detail?.id !== MODULE_ID || detail.key !== STORAGE_CACHE) return;

            forgetLearnedTranslations();
        }

        function handleSetting(event) {
            const detail = event?.detail;

            if (detail?.id !== MODULE_ID) {
                return;
            }

            if (detail.key === 'language' && [MODE_DA, MODE_EN].includes(detail.value)) {
                // Replaying a settings file sends the language it already
                // has; that is no reason to reload the page under the user.
                if (detail.value === GM_getValue(STORAGE_MODE, MODE_DA)) {
                    return;
                }

                GM_setValue(STORAGE_MODE, detail.value);
                announce();
                reloadWithoutResubmitting();
            } else if (
                detail.key === 'switchPosition' &&
                SWITCH_POSITIONS.includes(detail.value)
            ) {
                switchPosition = detail.value;
                GM_setValue(STORAGE_SWITCH_POSITION, switchPosition);
                applySwitchPosition();
                announce();
            }
        }

        window.addEventListener('lectio-manager:discover', announce);
        window.addEventListener('lectio-manager:set-setting', handleSetting);
        window.addEventListener('lectio-manager:prune-storage', handlePrune);
        // The schema was worded in whichever language was current when it
        // was announced, so a language chosen later is answered with a fresh
        // one.
        window.addEventListener('lectio-manager:language', announce);
        announce();
    })();

    /*
     * OWN STORAGE: PRUNE AND REPORT (issue #29)
     *
     * There is no GM_deleteValue in this script's grants, so emptying the
     * object is the delete: the next flush writes {} over what was there.
     */
    function forgetLearnedTranslations() {
        cache = {};

        try {
            GM_setValue(STORAGE_CACHE, cache);
        } catch (_) {
            reportStorageWriteFailure();
        }
    }

    /*
     * A failed write is still caught and this module still translates from
     * memory - unchanged. What is new is saying so once per page load, as a
     * token with nothing from the page in it. The flag hangs off the function
     * rather than sitting beside it as a module-scope binding, because a
     * declaration hoists and this file runs its handshake part-way through
     * its own evaluation.
     */
    function reportStorageWriteFailure() {
        if (reportStorageWriteFailure.reported) return;
        reportStorageWriteFailure.reported = true;

        try {
            reportToManager('error', 'storage-write', 0);
        } catch (_) {
            // Reporting a failure must never become a second failure.
        }
    }

    const CFG = {
        translateReadOnlyContent: true,
        maxUiChars: 320,
        maxContentChars: 1600,
        maxCacheEntries: 3500,
        maxPendingKeys: 250,
        maxListenersPerKey: 40,
        googleConcurrency: 4,
        googleGapMs: 30,
        mutationBatchMs: 80,
        navRepairMs: 5000,
        uiRepairMs: 15000,
        bootHideMaxMs: 800
    };

    let mode = GM_getValue(STORAGE_MODE, MODE_DA);

    if (
        mode !== MODE_DA &&
        mode !== MODE_EN
    ) {
        mode = MODE_DA;
    }

    /*
     * Lectio serves every page as lang="da". This module translates that page
     * into English but used to leave the attribute saying Danish, so the other
     * modules that localise themselves - Subject Colours, Schedule Summary -
     * read "da" and stayed Danish inside an otherwise English page. Publishing
     * the mode here is the whole fix: it is the signal they already read.
     */
    if (document.documentElement) {
        document.documentElement.lang = mode;
    }

    /*
     * ============================================================
     * BOOT COVER
     * ============================================================
     */

    let bootTimer = null;

    if (
        mode === MODE_EN &&
        document.documentElement
    ) {
        document.documentElement
            .classList
            .add('lectio-en-booting');

        const style =
            document.createElement('style');

        style.textContent =
            'html.lectio-en-booting body{' +
            'visibility:hidden!important' +
            '}';

        document.documentElement
            .appendChild(style);

        bootTimer =
            setTimeout(
                revealPage,
                CFG.bootHideMaxMs
            );
    }

    function revealPage() {
        document.documentElement
            ?.classList
            .remove('lectio-en-booting');

        if (bootTimer !== null) {
            clearTimeout(bootTimer);
            bootTimer = null;
        }
    }

    /*
     * ============================================================
     * FIXED NAVIGATION
     * ============================================================
     */

    const GLOBAL_NAV =
        Object.freeze({
            'Forside': 'Home',
            'Skema': 'Schedule',
            'Hovedmenu': 'Main Menu',
            'Tidsregistrering': 'Time Tracking',
            'Log ud': 'Log out',
            'Log ind': 'Log in',
            'Kontakt': 'Contact',
            'Hjælp': 'Help',
            'Søg': 'Search'
        });

    const PERSONAL_NAV =
        Object.freeze({
            'Forside': 'Overview',
            'Skema': 'Schedule',
            'Studieplan': 'Course Plan',
            'Årsopgørelse': 'Annual Summary',
            'Fravær': 'Attendance',
            'Opgaver': 'Assignments',
            'Lektier': 'Homework',
            'Karakterer': 'Grades',
            'Spørgeskema': 'Surveys',
            'Spørgeskemaer': 'Surveys',
            'Dokumenter': 'Documents',
            'Beskeder': 'Messages',
            'Profil': 'Profile',
            'Indstillinger': 'Settings'
        });

    const GLOBAL_EN =
        new Set(Object.values(GLOBAL_NAV));

    const PERSONAL_EN =
        new Set(Object.values(PERSONAL_NAV));

    /*
     * ============================================================
     * CURATED LECTIO LIBRARY
     * ============================================================
     */

    const CORE =
        Object.freeze({
            'Forside': 'Overview',
            'Skema': 'Schedule',
            'Studieplan': 'Course Plan',
            'Årsopgørelse': 'Annual Summary',
            'Fravær': 'Attendance',

            'Opgave': 'Assignment',
            'Opgaver': 'Assignments',

            'Lektie': 'Homework',
            'Lektier': 'Homework',

            'Karakter': 'Grade',
            'Karakterer': 'Grades',

            'Besked': 'Message',
            'Beskeder': 'Messages',

            'Spørgeskema': 'Survey',
            'Spørgeskemaer': 'Surveys',

            'Dokumenter': 'Documents',
            'Profil': 'Profile',

            'Lærer': 'Teacher',
            'Læreren': 'Teacher',
            'Lærere': 'Teachers',

            'Elev': 'Student',
            'Eleven': 'Student',
            'Elever': 'Students',

            'Hold': 'Class',
            'Holdet': 'Class',
            'Mine hold': 'My Classes',
            'Alle hold': 'All Classes',

            'Klasse': 'Class',
            'Klasser': 'Classes',

            'Gruppe': 'Group',
            'Grupper': 'Groups',

            'Lokale': 'Room',
            'Lokaler': 'Rooms',

            'Fag': 'Subject',

            'Modul': 'Period',
            'Moduler': 'Periods',

            'Lektion': 'Lesson',
            'Lektioner': 'Lessons',

            'Aktivitet': 'Activity',
            'Aktiviteter': 'Activities',

            '1 uge': '1 week',
            '4 uger': '4 weeks',
            '16 uger': '16 weeks',

            'Månedskalender': 'Month Calendar',
            'Anden aktivitet': 'Other Activity',
            'Privat aftale': 'Private Appointment',
            'Fællessamling': 'Assembly',

            'Vis ledige hold i skemaet.':
                'Show available classes in the schedule.',

            'Registreringer': 'Attendance Entries',

            'Manglende registrering':
                'Missing Attendance Entry',

            'Manglende registreringer':
                'Missing Attendance Entries',

            'Aktuel information':
                'Current Information',

            'Hold og grupper':
                'Classes and Groups',

            'Opgaveaflevering':
                'Assignment Submissions',

            'Ingen nye beskeder':
                'No new messages',

            'Få Lectio på din mobil':
                'Get Lectio on your phone',

            'Kalender': 'Calendar',
            'Liste': 'List',

            'Undervisningsbeskrivelse':
                'Course Description',

            'Forløb': 'Unit',

            'Forløb og opgaver':
                'Units and Assignments',

            'Opret forløb':
                'Create Unit',

            'Kun aktuelle hold':
                'Current classes only',

            'Elevtid':
                'Student Workload',

            'Fraværsangivelse':
                'Attendance Entry',

            'Registrer på månedsbasis':
                'Enter Attendance by Month',

            'Angiv fravær':
                'Record Absence',

            'Fraværsårsag':
                'Reason for Absence',

            'Godskrevet':
                'Excused',

            'Ikke godskrevet':
                'Unexcused',

            'Skriftligt fravær':
                'Missing Written Work',

            'Vælg hold':
                'Select Class',

            'Opgaveliste':
                'Assignment List',

            'Opgavetitel':
                'Assignment Title',

            'Opgavenote':
                'Assignment Note',

            'Frist':
                'Due Date',

            'Afleveringsfrist':
                'Due Date',

            'Ansvarlig':
                'Teacher',

            'Uafsluttede':
                'Incomplete',

            'Ikke afleveret':
                'Not Submitted',

            'Afventer lærer':
                'Awaiting Teacher',

            'Vis kun aktive':
                'Active only',

            'Vis kun for indeværende skoleår':
                'Current school year only',

            'Opret opgave':
                'Create Assignment',

            'Eksamen':
                'Exam',

            'Karaktergivning':
                'Grading',

            'Lærers karaktergivning':
                'Teacher Grading',

            'Indtastningsfrist':
                'Entry Deadline',

            'Karaktertype':
                'Grade Type',

            'Standpunktskarakter':
                'Current Grade',

            'Terminskarakter':
                'Term Grade',

            'Årskarakter':
                'Final Course Grade',

            'Eksamenskarakter':
                'Exam Grade',

            'Alle ulæste':
                'All Unread',

            'Alle med flag':
                'Flagged',

            'Nyeste':
                'Recent',

            'Alle slettede':
                'Deleted',

            'Egne beskeder':
                'My Messages',

            'Sendte beskeder':
                'Sent Messages',

            'Ny besked':
                'New Message',

            'Alle læst':
                'Mark All Read',

            'Vis/skjul slettede':
                'Show/Hide Deleted',

            'Emne':
                'Subject',

            'Seneste besked':
                'Latest Message',

            'Første besked':
                'First Message',

            'Modtagere':
                'Recipients',

            'Aktivitetsforside':
                'Activity Overview',

            'Skemaaktivitet':
                'Schedule Activity',

            'Holdets aktiviteter':
                'Class Activities',

            'Dagsbaseret fravær':
                'Daily Attendance',

            'Rediger aktivitet':
                'Edit Activity',

            'Rediger':
                'Edit',

            'Indhold':
                'Content',

            'Elevfeedback':
                'Student Feedback',

            'Aktivitetsinformation':
                'Activity Information',

            'Gem':
                'Save',

            'Læs':
                'View',

            'Formatering':
                'Formatting',

            'Indsæt:':
                'Insert:',

            'Materiale':
                'Material',

            'Fil':
                'File',

            'Billede':
                'Image',

            'Lyd':
                'Audio',

            'Afsnit':
                'Section',

            'Tabel':
                'Table',

            'Formel':
                'Formula',

            'Symbol':
                'Symbol',

            'Præsentation':
                'Presentation',

            'Præsentation (opret)':
                'Presentation (create)',

            'Præsentation (ingen)':
                'Presentation (none)',

            '(ingen)':
                '(none)',

            'Elevfeedback (ingen)':
                'Student Feedback (none)',

            'Offentlig':
                'Public',

            'Skriv nyt indhold her...':
                'Write new content here...',

            'Opret':
                'Create',

            'Slet':
                'Delete',

            'Tilføj':
                'Add',

            'Fjern':
                'Remove',

            'Åbn':
                'Open',

            'Luk':
                'Close',

            'Annuller':
                'Cancel',

            'Svar':
                'Reply',

            'Send':
                'Send',

            'Vælg':
                'Select',

            'Vælg alle':
                'Select All',

            'Ingen':
                'None',

            'Tilbage':
                'Back',

            'Næste':
                'Next',

            'Forrige':
                'Previous',

            'Dato':
                'Date',

            'Tid':
                'Time',

            'Fra':
                'From',

            'Til':
                'To',

            'Status':
                'Status',

            'Type':
                'Type',

            'Navn':
                'Name',

            /*
             * Documents screen toolbar and list headers
             * (issue #9 audit: previously had no dictionary
             * coverage at all, so they never resolved even
             * via the Google fallback).
             */
            'Ny fil':
                'New File',

            'Ny mappe':
                'New Folder',

            'Rediger mappe':
                'Edit Folder',

            'Filnavn':
                'Filename',

            'Kommentar':
                'Comment',

            'Ændret af':
                'Modified By',

            'Ændret':
                'Modified',

            'Størrelse':
                'Size',

            'Vis/Red.':
                'View/Edit',

            'Flyt':
                'Move',

            /*
             * Assignment/grade table headers with no coverage.
             */
            'Antal':
                'Number',

            'Holdelement':
                'Class Element',

            /*
             * Native error page recovery button (issue #9 audit:
             * "Hovedmenu" alone is already mapped for the fixed
             * nav bar, but this full button string on the error
             * template isn't reached by that path).
             */
            'Gå til Hovedmenu':
                'Go to Main Menu',

            /*
             * Profile / settings screen (issue #9 audit: this
             * whole screen had close to zero dictionary coverage).
             */
            'Vælg Hold-favoritter':
                'Select Class Favorites',

            'Vælg Stamklasse-favoritter':
                'Select Home Class Favorites',

            'Valgte:':
                'Selected:',

            'Konto':
                'Account',

            'Skoleår:':
                'School Year:',

            '(Gælder kun indtil næste login)':
                '(Applies only until next login)',

            'Du kan nemt få Lectio på mobilen (eller andre enheder) sådan her:':
                'You can easily get Lectio on your phone (or other devices) like this:',

            'Scan QR koden med din mobil':
                'Scan the QR code with your phone',

            'Vis QR kode':
                'Show QR Code',

            'På mobilen: Opret genvej på startskærm':
                'On your phone: create a shortcut on the home screen',

            'Du er færdig':
                'You\'re done',

            'For at scanne QR-koden skal kameraet på din mobil være i fototilstand (ikke video), og QR-scanning skal være aktiveret i kameraindstillingerne.':
                'To scan the QR code, your phone\'s camera must be in photo mode (not video), and QR scanning must be enabled in the camera settings.',

            'De hold man er holdlærer for vil automatisk være tilknyttet som holdfavoritter, og de vil ikke kunne fjernes.':
                'The classes you are a class teacher for are automatically added as class favorites and cannot be removed.',

            'Ved at vælge en stamklasse som stamklassefavorit vil der være adgang til den indbyggede gruppe med stamklassens lærere:"Alle stamklassenavn lærere" fra Dokumenter, Beskeder samt på Forsiden.':
                'Selecting a home class as a home class favorite gives access to the built-in group of that home class\'s teachers: "All [home class name] teachers" from Documents, Messages, and the Overview page.',

            /*
             * Study Plan, Annual Summary, Time Tracking, Surveys and the
             * three create forms (issue #21 audit, teacher role, school
             * 223). Every key below was read off the rendered Danish page;
             * none is guessed. Most were not merely missing here - they
             * contain no word the hasDanish() gate recognises, so they were
             * never even sent to the Google fallback and stayed Danish
             * outright. "Privat Aftale" is the form's own heading, which
             * Lectio title-cases differently from the link that opens it.
             */
            'Deling': 'Sharing',
            'Fagvalg': 'Subject Choice',
            'Vis': 'Show',
            'Søg': 'Search',
            'Kun opgaver': 'Assignments only',
            'Horisontal': 'Horizontal',
            'Måned': 'Month',
            'Uge': 'Week',
            'Medlemsskema': 'Member Schedule',
            'Materialer': 'Materials',
            'Modulregnskab': 'Period Count',
            'Lærere-Elever': 'Teachers-Students',
            'Adgangskoder': 'Access Codes',
            'Forløbsliste': 'Unit List',
            'Der er ingen forløb': 'There are no units',
            'Anvend': 'Apply',
            'Tryk for at se flere muligheder': 'Click to see more options',
            'Åbn hjælp til dette skærmbillede': 'Open help for this screen',
            'Vis større foto': 'Show larger photo',
            'Søg efter beskeder og dokumenter': 'Search messages and documents',
            'Gem data og luk posten. Genvej: Alt+S': 'Save and close. Shortcut: Alt+S',
            'Luk posten uden at gemme. Genvej: Alt+Z': 'Close without saving. Shortcut: Alt+Z',
            'Gem data uden at lukke posten. Genvej: Alt+W': 'Save without closing. Shortcut: Alt+W',

            'Timeberegning': 'Hour Calculation',
            'Ekstra timer': 'Extra Hours',
            'Eks.Belastning': 'Exam Load',
            'Tidsregistrering': 'Time Tracking',
            /*
             * The start-registration control in the global nav,
             * on every teacher page. Read off the live DOM at
             * school 223 (issue #61); the source carries a line
             * break after the first sentence, which normalize()
             * collapses to the space used here.
             */
            'Starter ny tidsregistrering og sætter starttid til nu. Posten kan efterfølgende redigeres på Tidsregistreringssiden.':
                'Starts a new time registration with the start time set to now. The entry can be edited afterwards on the Time Tracking page.',
            'Min periode': 'My Period',
            'Budgetteret': 'Budgeted',
            'Realiseret': 'Actual',
            'LærerKred': 'Teacher Credit',
            'Holdnorm': 'Class Norm',
            'Lærernorm': 'Teacher Norm',
            'Timer': 'Hours',
            'Ekstra': 'Extra',
            'Ej hold': 'No Class',
            'Undervisning i alt': 'Teaching Total',
            'Tillæg/opgaver': 'Supplements/Tasks',
            'Bemærkninger': 'Remarks',
            'Ingen tillæg': 'No supplements',
            'Sum': 'Total',
            'Aftalt timetal': 'Agreed Hours',
            'Overtimer/Undertimer': 'Overtime/Undertime',

            'Vis hele året': 'Show whole year',
            'Registrer ferie': 'Register Holiday',
            'Dag': 'Day',
            'Fra kl.': 'From',
            'Til kl.': 'To',
            'Timetal': 'Hour Count',
            'Arbejde': 'Work',
            'Helligdag': 'Public Holiday',
            'Ferie': 'Holiday',
            'Særlige feriedage': 'Special Holiday Days',
            'Sygdom': 'Sick Leave',
            'Barns sygdom': 'Child Sick Leave',
            'Omsorgsdag': 'Care Day',
            'Omsorgsdage': 'Care Days',
            'Afspadsering': 'Time Off in Lieu',
            'Barsel': 'Parental Leave',
            'Andet': 'Other',
            'Kopiér rækken': 'Copy row',
            'Opgørelse': 'Statement',
            'Periode': 'Period',
            'Saldo': 'Balance',
            'Udspecificeret': 'Breakdown',

            'Opret spørgeskema': 'Create Survey',
            'Åbne for besvarelse': 'Open for Responses',
            'Åbne for rapportering': 'Open for Reporting',
            'Egne spørgeskemaer': 'My Surveys',
            'Titel': 'Title',
            'Ejer': 'Owner',
            'Anonym': 'Anonymous',
            'Svarfrist': 'Response Deadline',
            'Frigives': 'Released',
            'Udløber': 'Expires',
            'Ingen spørgeskemaer åbne for besvarelse...': 'No surveys open for responses...',
            'Ingen spørgeskemaer...': 'No surveys...',
            'Vis kun aktuelle': 'Current only',
            'Besvarelse foregår anonymt: Ja/Nej': 'Responses are anonymous: Yes/No',
            'Besvar spørgeskema inden dette tidspunkt': 'Answer the survey before this time',
            'Frigivelse af spørgeskemaundersøgelsens resultater': 'Release of the survey results',
            'Herefter er resultaterne ikke længere tilgængelige': 'After this the results are no longer available',
            'Vis resultat af spørgeskemaundersøgelsen': 'Show survey results',

            'Opret aktivitet': 'Create Activity',
            'Anden aktivitetsliste': 'Other Activity List',
            'Vælg modul': 'Select Period',
            'Aflyst': 'Cancelled',
            'Deltagere': 'Participants',
            'Valgte': 'Selected',
            'Ressourcer': 'Resources',
            'Krediteret lærer': 'Credited Teacher',
            'Krediteringsnote': 'Credit Note',
            'Krediteringsrolle': 'Credit Role',
            'Krediteret hold': 'Credited Class',
            'Dobbeltbookninger': 'Double Bookings',
            'Opdater': 'Update',
            'Aflys dobbeltbookede aktiviteter': 'Cancel double-booked activities',
            'Der er ikke fundet nogen dobbeltbookninger': 'No double bookings found',
            'Vælg Hold': 'Select Class',
            'Vælg Lærer': 'Select Teacher',
            'Vælg Lokale': 'Select Room',
            'Vælg Ressource': 'Select Resource',
            'Søg: hold, lærer, lokale, ressource': 'Search: class, teacher, room, resource',
            'Tilføj hold, lærer, lokale eller ressource som deltager': 'Add a class, teacher, room or resource as a participant',
            'Sætter hak i alle bokse': 'Ticks every box',
            'Fjerner hak i alle bokse': 'Unticks every box',
            'Start': 'Start',
            'Slut': 'End',
            'Vises i': 'Shown in',
            'Skema-top': 'Schedule Top',
            'Dags/Ugeændringer': 'Day/Week Changes',
            'Skjul elevdeltagelse for andre elever': 'Hide student participation from other students',
            'Frivillig aktivitet (Reserverer ikke deltagere)': 'Optional activity (does not reserve participants)',
            'Tilmelding': 'Sign-up',
            'Brug tilmelding': 'Use sign-up',
            'Dobbeltbookede entiteter': 'Double-booked entities',
            'Note på aflyste aktiviteter': 'Note on cancelled activities',
            'Aflysningsårsag': 'Cancellation Reason',
            'Censor': 'Examiner',
            'Ekskursion': 'Field Trip',
            'Ferietimer': 'Holiday Hours',
            'Fællesaktiviteter': 'Joint Activities',
            'Kurser': 'Courses',
            'Studievejledning': 'Student Counselling',
            'Tjenestefri': 'Leave of Absence',
            'Privat Aftale': 'Private Appointment',
            'Private aftaler kan ikke ses af andre': 'Private appointments cannot be seen by others',

            /*
             * What the rendered-English pass over the same screens found
             * (issue #63, English Mode running as a teacher at school 223).
             * Each key is the source of a string that rendered wrong: still
             * Danish, mistranslated by the fallback ("Afmarkér alle" ->
             * "Demarcate all", "Lærerkred." -> "Teaching staff."), or
             * inconsistent with the module's own words ("Studieplan
             * Kalender" -> "Study plan Calendar" beside "Course Plan").
             *
             * The single capitalised words are here for a reason beyond
             * vocabulary: looksLikeName() treats a lone capitalised word
             * with no recognisable Danish in it as a person's name and
             * never translates it, which is why "Mandag".."Fredag" stayed
             * Danish on Time Tracking while "Lørdag" and "Søndag" (with
             * their ø) did not, and why "Mere", "Tidsreg." and
             * "Hurtignavigering" never moved. An exact entry is checked
             * before that guard.
             */
            'Studieplan Kalender': 'Course Plan Calendar',
            'Mandag': 'Monday',
            'Tirsdag': 'Tuesday',
            'Onsdag': 'Wednesday',
            'Torsdag': 'Thursday',
            'Fredag': 'Friday',
            'Lørdag': 'Saturday',
            'Søndag': 'Sunday',
            'Mere': 'More',
            'Tidsreg.': 'Time reg.',
            'Hurtignavigering': 'Quick navigation',
            'Se versioninformation': 'Show version information',
            'Visning: - Forløb og opgaver. Viser hold med mindst én opgave eller forløb. - Kun opgaver: Viser hold, som har mindst én opgave.':
                'Show: - Units and Assignments. Shows classes with at least one assignment or unit. - Assignments only: Shows classes with at least one assignment.',
            'Aktuelle hold er: Aktive holdelementer, med mindst én aktiv elev på dags dato.':
                'Current classes are: active classes with at least one active student as of today.',
            'Lærerkred. - Summen af afholdte og planlagte moduler med læreren.':
                'Teacher credit - the sum of held and planned periods with the teacher.',
            'Opgjort i moduler af 70 min.': 'Calculated in periods of 70 min.',
            'Dagsnorm': 'Daily norm',
            'Registreret': 'Registered',
            'Forventet': 'Expected',
            'Timer uden ferie/helligdage': 'Hours excluding holidays/public holidays',
            'Der er ingen lærere at kreditere': 'There are no teachers to credit',
            'Markér alle': 'Select all',
            'Afmarkér alle': 'Deselect all',
            'Afkrydsning i Dags/Ugeændringer er ikke gyldigt uden afkrydsning i Skema eller Skema-top.':
                'A tick in Day/Week Changes is not valid without a tick in Schedule or Schedule Top.',
            'Sæt kryds hvis tilmelding skal slås til på begivenheden': 'Tick to enable sign-up for the event',
            'Bruges fx til skjule en fraværssamtale for andre elever':
                'Used, for example, to hide an absence interview from other students',
            'Ved flueben i Frivillig aktivitet reserveres deltagere ikke. Bemærk dog at lokaler og ressourcer altid reserveres. Deltagere er dermed i denne kontekst; lærere og elever.':
                'Ticking Optional activity does not reserve participants. Note that rooms and resources are always reserved. Participants in this context means teachers and students.'
        });

    const WEEKDAYS =
        Object.freeze({
            Mandag: 'Monday',
            Tirsdag: 'Tuesday',
            Onsdag: 'Wednesday',
            Torsdag: 'Thursday',
            Fredag: 'Friday',
            Lørdag: 'Saturday',
            Søndag: 'Sunday'
        });

    const SHORT_DAYS =
        Object.freeze({
            ma: 'Mon',
            man: 'Mon',
            ti: 'Tue',
            tir: 'Tue',
            on: 'Wed',
            ons: 'Wed',
            to: 'Thu',
            tor: 'Thu',
            fr: 'Fri',
            fre: 'Fri',
            lø: 'Sat',
            lør: 'Sat',
            sø: 'Sun',
            søn: 'Sun'
        });

    /*
     * Danish month abbreviations as the Study Plan calendar
     * writes them ("okt. 2026", "maj. 2027"). They carry no
     * word hasDanish() recognises, so they never reached the
     * fallback and stayed Danish outright (issue #61).
     */
    const SHORT_MONTHS =
        Object.freeze({
            jan: 'Jan',
            feb: 'Feb',
            mar: 'Mar',
            apr: 'Apr',
            maj: 'May',
            jun: 'Jun',
            jul: 'Jul',
            aug: 'Aug',
            sep: 'Sep',
            sept: 'Sep',
            okt: 'Oct',
            nov: 'Nov',
            dec: 'Dec'
        });

    /*
     * Full month names, as the Time Tracking statement writes them
     * ("Juli 2026"). Like the abbreviations, only with a year after
     * them (issue #63).
     */
    const MONTHS =
        Object.freeze({
            januar: 'January',
            februar: 'February',
            marts: 'March',
            april: 'April',
            maj: 'May',
            juni: 'June',
            juli: 'July',
            august: 'August',
            september: 'September',
            oktober: 'October',
            november: 'November',
            december: 'December'
        });

    /*
     * Phrases that only ever occur next to a figure that varies - the
     * Annual Summary tooltips "Budgetterede timer: 0 + 0 Realiserede
     * timer: 4,4 + 0 + 0" and "Aftalt timetal i alt 26/27: 1694,6
     * Periode: ... (365 dage) ...". Sent to the fallback, they came back
     * readable but with every decimal comma turned into a point
     * ("4,4" -> "4.4", "1694,6" -> "1694.6"), so they are resolved
     * locally, phrase by phrase, and the figures are never touched
     * (issue #63).
     */
    const PHRASES =
        Object.freeze({
            'Aftalt timetal i alt': 'Agreed hours in total',
            'Aftalt timetal i perioden': 'Agreed hours in the period',
            'Antal kalenderdage': 'Number of calendar days',
            'Budgetterede timer': 'Budgeted hours',
            'Realiserede timer': 'Actual hours'
        });

    /*
     * ============================================================
     * LOCAL LEARNED LIBRARY
     * ============================================================
     */

    let cache =
        GM_getValue(
            STORAGE_CACHE,
            {}
        );

    if (
        !cache ||
        typeof cache !== 'object' ||
        Array.isArray(cache)
    ) {
        cache = {};
    }

    function cacheGet(source) {
        const entry = cache[source];

        if (!entry) {
            return null;
        }

        if (typeof entry === 'string') {
            return {
                raw: entry,
                lang: null
            };
        }

        return (
            typeof entry.raw === 'string'
                ? entry
                : null
        );
    }

    /*
     * Persistence is a flush, not a write per learned string.
     *
     * cachePut used to serialise the whole cache - up to
     * maxCacheEntries entries, a couple of hundred KB - every
     * single time it learned something, and rebuilt
     * Object.entries(cache) just to test the size. A text-heavy
     * page learning 200 strings therefore did 200 full writes of
     * a structure that only grew. The in-memory cache is the
     * authority; storage catches up on idle, and always before
     * the page goes away. Contents and eviction policy are
     * unchanged - only when they are written moved.
     */
    const CACHE_FLUSH_MS = 1000;

    let cacheDirty = false;
    let cacheFlushTimer = null;
    let cacheFlushIdle = null;

    function cancelCacheFlush() {
        if (cacheFlushTimer !== null) {
            clearTimeout(cacheFlushTimer);

            cacheFlushTimer = null;
        }

        if (cacheFlushIdle !== null) {
            if (
                typeof cancelIdleCallback ===
                'function'
            ) {
                cancelIdleCallback(
                    cacheFlushIdle
                );
            }

            cacheFlushIdle = null;
        }
    }

    function flushCache() {
        /*
         * Always clear the pending work first, so a pending timer
         * can never outlive the page it belongs to and keep its
         * cache alive.
         */
        cancelCacheFlush();

        if (!cacheDirty) {
            return;
        }

        cacheDirty = false;

        const entries =
            Object.entries(cache);

        if (
            entries.length >
            CFG.maxCacheEntries
        ) {
            entries.sort(
                (a, b) =>
                    (b[1]?.ts || 0) -
                    (a[1]?.ts || 0)
            );

            cache =
                Object.fromEntries(
                    entries.slice(
                        0,
                        CFG.maxCacheEntries
                    )
                );
        }

        try {
            GM_setValue(
                STORAGE_CACHE,
                cache
            );
        }

        catch (_) {
            // Carry on translating from memory, and say so once (issue #29).
            reportStorageWriteFailure();
        }
    }

    /*
     * One flush per burst: scheduling is a no-op while a flush is
     * already pending, so a page that learns 200 strings collapses
     * into a single write rather than resetting a debounce
     * forever and never persisting at all.
     */
    function scheduleCacheFlush() {
        if (
            cacheFlushTimer !== null ||
            cacheFlushIdle !== null
        ) {
            return;
        }

        if (
            typeof requestIdleCallback ===
            'function'
        ) {
            cacheFlushIdle =
                requestIdleCallback(
                    () => {
                        cacheFlushIdle = null;
                        flushCache();
                    },
                    {
                        timeout: CACHE_FLUSH_MS
                    }
                );

            return;
        }

        cacheFlushTimer =
            setTimeout(
                () => {
                    cacheFlushTimer = null;
                    flushCache();
                },
                CACHE_FLUSH_MS
            );
    }

    function handleCacheFlushVisibility() {
        if (document.hidden) {
            flushCache();
        }
    }

    /*
     * Lectio is a multi-page app, so navigation - not tab close -
     * is the normal exit. pagehide is the last point at which the
     * page can still write. A page kept for the back/forward
     * cache (persisted) keeps its listeners, because it can be
     * restored and go on learning; one that is really going away
     * drops them along with any pending flush.
     */
    function handleCacheFlushPagehide(event) {
        flushCache();

        if (event?.persisted) {
            return;
        }

        window.removeEventListener(
            'pagehide',
            handleCacheFlushPagehide
        );

        document.removeEventListener(
            'visibilitychange',
            handleCacheFlushVisibility
        );
    }

    window.addEventListener(
        'pagehide',
        handleCacheFlushPagehide
    );

    document.addEventListener(
        'visibilitychange',
        handleCacheFlushVisibility
    );

    function cachePut(
        source,
        raw,
        lang
    ) {
        cache[source] = {
            raw,
            lang: lang || null,
            ts: Date.now()
        };

        cacheDirty = true;

        scheduleCacheFlush();
    }

    /*
     * ============================================================
     * DOM STATE
     * ============================================================
     */

    const textState =
        new WeakMap();

    const attrState =
        new WeakMap();

    const inputState =
        new WeakMap();

    const pending =
        new Map();

    const googleQueue = [];

    let activeGoogle = 0;
    let googleTimer = null;

    let fallbackWarningShown =
        false;

    const mutationRoots =
        new Set();

    let mutationTimer = null;
    let observer = null;

    /*
     * ============================================================
     * HELPERS
     * ============================================================
     */

    function normalize(text) {
        return String(
            text ?? ''
        )
            /*
             * Lectio hyphenates some headers with a soft hyphen
             * (U+00AD, invisible unless the browser wraps the
             * line) e.g. "Elev\u00adtid" for "Elevtid" (issue #20).
             * Strip it so exact-match dictionary lookups aren't
             * defeated by an invisible character in the source.
             */
            .replace(
                /\u00ad/g,
                ''
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

    function preserveWhitespace(
        original,
        translated
    ) {
        return (
            (
                String(original)
                    .match(/^\s*/)?.[0] ||
                ''
            ) +
            translated +
            (
                String(original)
                    .match(/\s*$/)?.[0] ||
                ''
            )
        );
    }

    function ordinal(n) {
        const value =
            Number(n);

        const mod100 =
            value % 100;

        if (
            mod100 >= 11 &&
            mod100 <= 13
        ) {
            return `${value}th`;
        }

        return (
            `${value}${
                value % 10 === 1
                    ? 'st'
                    : value % 10 === 2
                        ? 'nd'
                        : value % 10 === 3
                            ? 'rd'
                            : 'th'
            }`
        );
    }

    function exactCore(text) {
        const source =
            normalize(text);

        if (
            Object.prototype
                .hasOwnProperty
                .call(
                    CORE,
                    source
                )
        ) {
            return CORE[source];
        }

        if (
            source.endsWith(':')
        ) {
            const bare =
                source
                    .slice(0, -1)
                    .trim();

            if (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        CORE,
                        bare
                    )
            ) {
                return (
                    CORE[bare] +
                    ':'
                );
            }
        }

        /*
         * Grade-type labels carry an "afsl."/"ikke afsl."
         * (finalized/not yet finalized) qualifier suffix that
         * isn't part of the base CORE key, e.g. the on-screen
         * "Standpunktskarakter afsl.". Without this, the exact
         * match above misses and the whole label falls through
         * to the Google fallback, which mistranslated it as
         * "Point of view final" (issue #9 audit).
         */
        const qualifierMatch =
            source.match(
                /^(.+?)\s+(ikke\s+afsl\.|afsl\.)$/i
            );

        if (qualifierMatch) {
            const [
                ,
                base,
                qualifier
            ] = qualifierMatch;

            if (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        CORE,
                        base
                    )
            ) {
                return (
                    CORE[base] +
                    (
                        /^ikke/i
                            .test(qualifier)
                            ? ' (not yet finalized)'
                            : ' (finalized)'
                    )
                );
            }
        }

        return null;
    }

    function isOurUi(element) {
        return !!element
            ?.closest
            ?.(
                '#lectio-english-switch,' +
                '#lectio-english-toast,' +
                '.lectio-unread-badge,' +
                '.lectio-unread-tooltip'
            );
    }

    function isFixedNav(element) {
        return !!element
            ?.closest
            ?.(
                '[data-lectio-en-fixed-nav="1"]'
            );
    }

    /*
     * Switching language reloads the page, and on Lectio the page is often
     * the answer to a form post: adding a file or link to homework is a
     * whole-page postback. location.reload() would send that post again -
     * behind a "Confirm resubmission" prompt people click through - and add
     * the material a second time (issue #72). Navigating to the same address
     * loads it with a plain GET instead. The fragment is dropped because
     * replacing a URL that differs only by its fragment just scrolls.
     */
    function reloadWithoutResubmitting() {
        location.replace(
            location.href.split('#')[0]
        );
    }

    /*
     * Anything someone is typing into is theirs, and a rich-text editor's
     * content is what Lectio saves. isContentEditable also covers the
     * editor's own descendants, contenteditable="" and a document in design
     * mode, which the attribute selector below cannot.
     */
    function isEditable(element) {
        if (element?.isContentEditable) {
            return true;
        }

        return !!element
            ?.closest
            ?.(
                'textarea,' +
                '[contenteditable="true"],' +
                'input[type="text"],' +
                'input[type="search"],' +
                'input[type="email"],' +
                'input[type="password"],' +
                'input[type="number"]'
            );
    }

    function ignored(element) {
        return (
            !element ||
            isOurUi(element) ||
            !!element.closest(
                'script,' +
                'style,' +
                'noscript,' +
                'code,' +
                'pre'
            )
        );
    }

    /*
     * ============================================================
     * FIXED NAVIGATION
     * ============================================================
     */

    function navLabel(anchor) {
        return normalize(
            anchor.textContent
        );
    }

    function detectNavType(labels) {
        const globalMarkers = [
            'Hovedmenu',
            'Main Menu',
            'Tidsregistrering',
            'Time Tracking',
            'Log ud',
            'Log out'
        ];

        const personalMarkers = [
            'Studieplan',
            'Course Plan',
            'Årsopgørelse',
            'Annual Summary',
            'Karakterer',
            'Grades',
            'Beskeder',
            'Messages'
        ];

        let globalScore = 0;
        let personalScore = 0;

        for (const label of labels) {
            if (
                globalMarkers.includes(
                    label
                )
            ) {
                globalScore++;
            }

            if (
                personalMarkers.includes(
                    label
                )
            ) {
                personalScore++;
            }
        }

        if (
            globalScore >= 1 &&
            globalScore > personalScore
        ) {
            return 'global';
        }

        if (
            personalScore >= 1 &&
            personalScore > globalScore
        ) {
            return 'personal';
        }

        return null;
    }

    function navTranslation(
        label,
        type
    ) {
        const map =
            type === 'global'
                ? GLOBAL_NAV
                : PERSONAL_NAV;

        const english =
            type === 'global'
                ? GLOBAL_EN
                : PERSONAL_EN;

        if (
            Object.prototype
                .hasOwnProperty
                .call(
                    map,
                    label
                )
        ) {
            return map[label];
        }

        if (
            english.has(label)
        ) {
            return label;
        }

        return null;
    }

    function setNavLabel(
        anchor,
        translated
    ) {
        anchor.dataset
            .lectioEnFixedNav =
            '1';

        const nodes = [];

        const walker =
            document.createTreeWalker(
                anchor,
                NodeFilter.SHOW_TEXT
            );

        let node;

        while (
            (
                node =
                    walker.nextNode()
            )
        ) {
            if (
                normalize(
                    node.nodeValue
                )
            ) {
                nodes.push(node);
            }
        }

        if (!nodes.length) {
            return;
        }

        nodes[0].nodeValue =
            preserveWhitespace(
                nodes[0].nodeValue,
                translated
            );

        for (
            let i = 1;
            i < nodes.length;
            i++
        ) {
            nodes[i].nodeValue = '';
        }
    }

    function repairNavigation() {
        if (
            mode !== MODE_EN ||
            !document.body
        ) {
            return;
        }

        const anchors =
            Array.from(
                document.querySelectorAll('a')
            )
                .filter(
                    anchor => {
                        if (
                            isOurUi(anchor)
                        ) {
                            return false;
                        }

                        const rect =
                            anchor
                                .getBoundingClientRect();

                        return (
                            rect.width > 0 &&
                            rect.height > 0 &&
                            rect.top >= 0 &&
                            rect.top < 300
                        );
                    }
                );

        /*
         * Every top-nav item carries a hidden "Genvej: Alt+X"
         * (Shortcut: Alt+X) tooltip that the generic attribute
         * pipeline never reaches: processAttr/processElement both
         * skip elements matched by isFixedNav, which is exactly
         * these anchors once their label is repaired below
         * (issue #20). Fix the title directly here instead.
         */
        for (const anchor of anchors) {
            const title =
                anchor.getAttribute('title');

            if (
                title &&
                /^Genvej:/.test(title)
            ) {
                anchor.setAttribute(
                    'title',
                    title.replace(
                        /^Genvej:/,
                        'Shortcut:'
                    )
                );
            }
        }

        const rows = [];

        for (const anchor of anchors) {
            const rect =
                anchor
                    .getBoundingClientRect();

            const y =
                Math.round(
                    rect.top +
                    rect.height / 2
                );

            let row =
                rows.find(
                    item =>
                        Math.abs(
                            item.y - y
                        ) <= 5
                );

            if (!row) {
                row = {
                    y,
                    anchors: []
                };

                rows.push(row);
            }

            row.anchors
                .push(anchor);
        }

        for (const row of rows) {
            if (
                row.anchors.length < 4
            ) {
                continue;
            }

            const type =
                detectNavType(
                    row.anchors
                        .map(navLabel)
                );

            if (!type) {
                continue;
            }

            for (
                const anchor
                of row.anchors
            ) {
                const translated =
                    navTranslation(
                        navLabel(anchor),
                        type
                    );

                if (translated) {
                    setNavLabel(
                        anchor,
                        translated
                    );
                }
            }
        }
    }

    /*
     * ============================================================
     * FALLBACK DETECTION
     * ============================================================
     */

    const DANISH_WORDS =
        new Set([
            'af',
            'alle',
            'at',
            'den',
            'der',
            'det',
            'du',
            'eller',
            'en',
            'er',
            'et',
            'for',
            'fra',
            'har',
            'her',
            'hvis',
            'i',
            'ikke',
            'kan',
            'kun',
            'med',
            'og',
            'om',
            'op',
            'på',
            'skal',
            'som',
            'til',
            'ud',
            'ved',
            'vi',
            'vis',
            'vælg',
            'år',
            'uge',
            'uger',
            'måned',
            'hold',
            'elev',
            'elever',
            'lærer',
            'lærere',
            'fravær',
            'opgave',
            'opgaver',
            'lektie',
            'lektier',
            'besked',
            'beskeder',
            'skema',
            'karakter',
            'karakterer',
            'aktivitet',
            'aktiviteter',
            'indhold',
            'opret',
            'rediger',
            'manglende',
            'aktuelle',
            'offentlig',
            'gem',
            'søg',
            'afleveret',
            'aflevering',
            'ingen'
        ]);

    const DANISH_STEMS = [
        'hovedmenu',
        'tidsregistr',
        'studieplan',
        'årsopgør',
        'spørgeskema',
        'undervisning',
        'fravær',
        'opgave',
        'aflever',
        'lektie',
        'besked',
        'karakter',
        'aktivitet',
        'registrering',
        'måned',
        'skema',
        'forløb',
        'elev',
        'lærer',
        'holde',
        'mangl',
        'aktuel',
        'offentlig',
        'indhold',
        'ansvarlig',
        'frist',
        'fagvalg',
        'bemærk',
        'godskr',
        'frigiv',
        'ubesvar',
        'præsent',
        'rediger'
    ];

    function hasDanish(text) {
        const source =
            normalize(text);

        if (!source) {
            return false;
        }

        if (
            /[æøåÆØÅ]/
                .test(source)
        ) {
            return true;
        }

        const lower =
            source.toLowerCase();

        if (
            DANISH_STEMS
                .some(
                    stem =>
                        lower.includes(stem)
                )
        ) {
            return true;
        }

        /*
         * A letter run glued directly to a digit (no space),
         * e.g. the "i" in class code "1i", is part of an
         * identifier, not a standalone Danish word. Without
         * these lookarounds a lone "i" ("in") gets counted as
         * a Danish-word hit, which used to send whole class
         * codes like "1i TOK/1" to the Google fallback and get
         * them corrupted into "1 in TOK/1" (issue #9 audit).
         */
        const words =
            lower.match(
                /(?<![\p{N}])\p{L}+(?![\p{N}])/gu
            ) || [];

        let hits = 0;

        for (const word of words) {
            if (
                DANISH_WORDS.has(word)
            ) {
                hits++;
            }
        }

        return (
            hits >=
            (
                words.length <= 4
                    ? 1
                    : 2
            )
        );
    }

    function looksLikeName(text) {
        const source =
            normalize(text);

        if (
            !source ||
            hasDanish(source)
        ) {
            return false;
        }

        const pieces =
            source.split(/\s+/);

        return (
            pieces.length >= 1 &&
            pieces.length <= 4 &&
            pieces.every(
                piece =>
                    /^[A-ZÆØÅ][\p{L}'’.-]+$/u
                        .test(piece) ||
                    /^[A-ZÆØÅ]{1,4}$/
                        .test(piece)
            )
        );
    }

    function looksLikeIdentifier(text) {
        const source =
            normalize(text);

        if (!source) {
            return true;
        }

        if (
            exactCore(source) !== null
        ) {
            return false;
        }

        if (
            /^[\d\s:.,/()+\-]+$/
                .test(source)
        ) {
            return true;
        }

        if (
            /^(https?:\/\/|www\.)/i
                .test(source)
        ) {
            return true;
        }

        /*
         * The footer's "Lectio version 24.035" is a product name and a
         * number. The fallback rendered it "Reading version 24.035" -
         * lectio is Latin - so it is an identifier here and never sent
         * (issue #63).
         */
        if (
            /^Lectio version [\d.]+$/i
                .test(source)
        ) {
            return true;
        }

        if (
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                .test(source)
        ) {
            return true;
        }

        if (
            /\.(pdf|docx?|xlsx?|pptx?|txt|zip|jpg|jpeg|png|gif|webp|mp3|mp4)$/i
                .test(source)
        ) {
            return true;
        }

        if (
            /^[A-ZÆØÅ]{1,4}$/
                .test(source)
        ) {
            return true;
        }

        if (
            !source.includes(' ') &&
            /^[A-Za-zÆØÅæøå]{0,4}\d+[A-Za-zÆØÅæøå]{0,4}$/
                .test(source)
        ) {
            return true;
        }

        return looksLikeName(source);
    }

    function isUiLike(
        element,
        text
    ) {
        if (!element) {
            return false;
        }

        const selector =
            'a,' +
            'button,' +
            'label,' +
            'th,' +
            'legend,' +
            'option,' +
            'h1,' +
            'h2,' +
            'h3,' +
            'h4,' +
            'h5,' +
            'h6,' +
            '[role="button"],' +
            '[role="tab"],' +
            '[role="menuitem"],' +
            '[role="navigation"],' +
            '[role="columnheader"]';

        if (
            element.matches(selector) ||
            element.closest(selector)
        ) {
            return true;
        }

        const marker =
            (
                `${element.id || ''} ` +
                `${String(
                    element.className || ''
                )}`
            )
                .toLowerCase();

        if (
            /(menu|nav|tab|toolbar|header|caption|title|button|pager|filter|selector)/
                .test(marker)
        ) {
            return true;
        }

        return (
            normalize(text).length <= 90 &&
            !!element.closest('form') &&
            !element.closest('td')
        );
    }

    function shouldFallback(
        text,
        element
    ) {
        const source =
            normalize(text);

        if (
            !source ||
            looksLikeIdentifier(source)
        ) {
            return false;
        }

        if (
            isUiLike(
                element,
                source
            )
        ) {
            return (
                source.length <=
                CFG.maxUiChars
            );
        }

        return (
            CFG.translateReadOnlyContent &&
            source.length <=
                CFG.maxContentChars &&
            hasDanish(source)
        );
    }

    /*
     * ============================================================
     * STRUCTURED LOCAL TRANSLATION
     * ============================================================
     */

    function translateStructured(text) {
        const original =
            normalize(text);

        const exact =
            exactCore(original);

        if (exact !== null) {
            return {
                text: exact,
                complete: true
            };
        }

        let result = original;

        if (
            result.includes(' - ')
        ) {
            const pieces =
                result.split(' - ');

            result =
                pieces.map(
                    (
                        piece,
                        index
                    ) => {
                        const value =
                            normalize(piece);

                        if (
                            /^Læreren\b/i
                                .test(value)
                        ) {
                            return value
                                .replace(
                                    /^Læreren\b/i,
                                    'Teacher'
                                );
                        }

                        if (
                            /^Eleven\b/i
                                .test(value)
                        ) {
                            return value
                                .replace(
                                    /^Eleven\b/i,
                                    'Student'
                                );
                        }

                        /*
                         * A class's own pages: "Holdet 1i TOK/4 -
                         * Studieplan Kalender", "Holdet 1i TOK/4 -
                         * Forløbsliste". The fallback wrote "class 1i
                         * TOK/4 - Progress list" (issue #63).
                         */
                        if (
                            /^Holdet\b/i
                                .test(value)
                        ) {
                            return value
                                .replace(
                                    /^Holdet\b/i,
                                    'Class'
                                );
                        }

                        if (
                            index ===
                                pieces.length - 1 &&
                            value === 'Forside'
                        ) {
                            return 'Overview';
                        }

                        return (
                            exactCore(value) ??
                            piece
                        );
                    }
                )
                    .join(' - ');
        }

        result =
            result.replace(
                /\b(\d{1,2})\.\s*modul\b/gi,
                (
                    _,
                    number
                ) =>
                    `${
                        ordinal(number)
                    } period`
            );

        /*
         * "1. modul kl. 08:15-09:25" (the Modul row of Create
         * Lesson) used to leave the pattern pass as "1st period
         * kl. 08:15-09:25". Drop the "kl." only when it sits
         * between the period just written above and a clock
         * time (issue #61).
         */
        result =
            result.replace(
                /\bperiod kl\.\s*(?=\d{1,2}[:.]\d{2})/g,
                'period '
            );

        result =
            result.replace(
                /\bUge\s+(\d{1,2})\b/gi,
                'Week $1'
            );

        for (
            const [
                danish,
                english
            ]
            of Object.entries(WEEKDAYS)
        ) {
            result =
                result.replace(
                    new RegExp(
                        `\\b${danish}\\b`,
                        'gi'
                    ),
                    english
                );
        }

        /*
         * A weekday abbreviation before a date, at the start of the
         * string and after " - ", so the Study Plan calendar's week
         * range "ma 6/7-26 - sø 12/7-26" comes out "Mon 6/7-26 - Sun
         * 12/7-26" rather than stopping at the first day (issue #68).
         */
        result =
            result.replace(
                /(^| - )([A-Za-zÆØÅæøå]{2,3})(?=\s+\d{1,2}\/\d{1,2})/gi,
                (
                    _,
                    lead,
                    day
                ) =>
                    lead +
                    (
                        SHORT_DAYS[
                            day.toLowerCase()
                        ] ||
                        day
                    )
            );

        result =
            result.replace(
                /^(\d+)\s+manglende registreringer?$/i,
                (
                    _,
                    number
                ) =>
                    `${number} missing attendance ${
                        Number(number) === 1
                            ? 'entry'
                            : 'entries'
                    }`
            );

        result =
            result.replace(
                /\b(\d+)\s+ulæste\b/gi,
                '$1 unread'
            );

        result =
            result.replace(
                /\b(\d+)\s+ubesvaret\b/gi,
                '$1 unanswered'
            );

        result =
            result.replace(
                /\b(\d+)\s+frigivne?\b/gi,
                '$1 released'
            );

        result =
            result.replace(
                /\bAlle Lærere\b/gi,
                'All Teachers'
            );

        result =
            result.replace(
                /\bAlle ([\p{L}-]+)-lærere\b/giu,
                'All $1 teachers'
            );

        result =
            result.replace(
                /\b(\d+)\.\s*standpunkt\b/gi,
                (
                    _,
                    number
                ) =>
                    `${
                        ordinal(number)
                    } current grade`
            );

        result =
            result.replace(
                /\bÅrsprøve\b/gi,
                'Year-end Exam'
            );

        result =
            result.replace(
                /\bLokal prøve\b/gi,
                'Internal Exam'
            );

        result =
            result
                .replace(
                    /\bskriftlig\b/gi,
                    'written'
                )
                .replace(
                    /\bmundtlig\b/gi,
                    'oral'
                );

        /*
         * Study Plan calendar month labels: "okt. 2026" ->
         * "Oct 2026". Only an abbreviation with its trailing
         * dot and a four-digit year after it (issue #61).
         */
        result =
            result.replace(
                /(^|\s)(jan|feb|mar|apr|maj|jun|jul|aug|sept?|okt|nov|dec)\.\s+(?=\d{4}\b)/gi,
                (
                    _,
                    lead,
                    month
                ) =>
                    `${lead}${
                        SHORT_MONTHS[
                            month.toLowerCase()
                        ]
                    } `
            );

        /*
         * The hour abbreviation "t." (timer) after a number,
         * as in the Study Plan footer "Total: 10,5 t." and
         * "Norm: 32 t.". Only the number-space-"t." shape, at
         * the end or before punctuation, so a "t." anywhere in
         * ordinary text is untouched (issue #61).
         */
        result =
            result.replace(
                /(\d)\s+t\.(?=$|[\s,;:)])/g,
                '$1 h'
            );

        /*
         * Annual Summary period names. The year varies, so
         * these cannot be exact entries; each rule needs the
         * period word and the year shape together (issue #61).
         */
        result =
            result
                .replace(
                    /\bSkoleåret\s+(?=\d{2,4}\/\d{2,4}\b)/gi,
                    'School year '
                )
                .replace(
                    /\bAndet halvår\s+(?=\d{4}\b)/gi,
                    'Second half '
                )
                .replace(
                    /\bFørste halvår\s+(?=\d{4}\b)/gi,
                    'First half '
                )
                .replace(
                    /\bFinansåret\s+(?=\d{4}\b)/gi,
                    'Financial year '
                );

        /*
         * A class code followed by "aktivitet" ("1i - aktivitet",
         * "1i aktivitet/4", "2i Aktivitet") is the name Lectio
         * gives a class's non-lesson activities. It used to go
         * to the fallback on the strength of "aktivitet" and
         * rely on postCorrect() to repair the class code
         * afterwards. The whole string must be exactly that
         * shape - digits, one to three letters, a separator,
         * the word, an optional "/N" - so nothing else matches
         * (issue #61). Capitalised as postCorrect() already
         * renders it.
         */
        result =
            result.replace(
                /^(\d{1,2}\p{L}{1,3})( - | )aktivitet(\/\d+)?$/iu,
                '$1$2Activity$3'
            );

        /*
         * Full month names with a year: "Juli 2026" -> "July 2026"
         * (issue #63). "August 2026" comes out as it went in.
         */
        result =
            result.replace(
                /(^|\s)(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)(?=\s+\d{4}\b)/gi,
                (
                    _,
                    lead,
                    month
                ) =>
                    `${lead}${
                        MONTHS[
                            month.toLowerCase()
                        ]
                    }`
            );

        /*
         * The footer's page time: "21/9-2026 kl. 21:00" -> "21/9-2026
         * at 21:00". Only a full date, "kl." and a clock time, so the
         * "kl." of any other shape is left to the rules above
         * (issue #63).
         */
        result =
            result.replace(
                /^(\d{1,2}\/\d{1,2}-\d{4}) kl\. (\d{1,2}:\d{2})$/,
                '$1 at $2'
            );

        for (
            const [
                danish,
                english
            ]
            of Object.entries(PHRASES)
        ) {
            result =
                result.replace(
                    new RegExp(
                        `\\b${danish}\\b`,
                        'g'
                    ),
                    english
                );
        }

        result =
            result.replace(
                /\((\d+) dage\)/g,
                '($1 days)'
            );

        /*
         * A label in front of a figure - "Arbejde: 232,7, Barns sygdom:
         * 7,4", "Saldo: 10,7", "Dagsnorm: 7,4" on Time Tracking - is
         * looked up as an entry of its own. Only labels the dictionary
         * knows change, so "Total: 10,5 h" and "Norm: 32 h" are as they
         * were; a label the fallback would have to guess at is not the
         * kind of thing this rule is for (issue #63).
         */
        result =
            result.replace(
                /(^|, |\s)([\p{L}][\p{L} \/]*?)(?=: -?\d)/gu,
                (
                    _,
                    lead,
                    label
                ) =>
                    lead +
                    (
                        exactCore(label) ??
                        label
                    )
            );

        return {
            text: result,

            complete:
                result !== original &&
                !hasDanish(result)
        };
    }

    /*
     * ============================================================
     * GOOGLE FALLBACK
     * ============================================================
     */

    const ENDPOINTS = [
        'https://translate.googleapis.com/translate_a/single',
        'https://translate.google.com/translate_a/single'
    ];

    /*
     * Telling the Manager something failed (docs/manager-problem-log.md).
     * One-way and additive: with no Manager installed this lands on a window
     * nobody is listening to, which is a no-op.
     *
     * This module has no fragile Lectio selector to report drift against - it
     * reads headings, links and buttons, which are HTML rather than Lectio -
     * so what it has to say is this: the fallback it leans on for anything it
     * does not know itself stopped answering. The symptom today is a page
     * that is half translated and no explanation anywhere.
     *
     * `code` is a token written here, never text read off a page or out of a
     * response - there is deliberately no field for a message, because this
     * log is written to be pasted into a public issue, and the text this
     * module handles is the text of someone's Lectio.
     */
    let reportedTranslateFailure = false;

    function reportToManager(kind, code, found) {
        window.dispatchEvent(
            new CustomEvent(
                'lectio-module:report',
                {
                    detail: {
                        moduleId: 'english-mode',
                        kind,
                        code,
                        found
                    }
                }
            )
        );
    }

    function gmRequest(details) {
        return new Promise(
            (
                resolve,
                reject
            ) =>
                GM_xmlhttpRequest({
                    ...details,

                    onload: resolve,

                    onerror: reject,

                    ontimeout:
                        () =>
                            reject(
                                new Error('timeout')
                            ),

                    onabort:
                        () =>
                            reject(
                                new Error('aborted')
                            )
                })
        );
    }

    async function requestGoogle(source) {
        let lastError = null;

        for (
            const endpoint
            of ENDPOINTS
        ) {
            const params =
                'client=gtx' +
                '&sl=auto' +
                '&tl=en' +
                '&dt=t' +
                '&ie=UTF-8' +
                '&oe=UTF-8';

            const encoded =
                encodeURIComponent(source);

            const url =
                `${endpoint}?` +
                `${params}` +
                `&q=${encoded}`;

            try {
                const response =
                    url.length < 1800

                        ? await gmRequest({
                            method: 'GET',
                            url,
                            timeout: 8000
                        })

                        : await gmRequest({
                            method: 'POST',

                            url:
                                `${endpoint}?${params}`,

                            data:
                                `q=${encoded}`,

                            timeout: 10000,

                            headers: {
                                'Content-Type':
                                    'application/x-www-form-urlencoded;charset=UTF-8'
                            }
                        });

                if (
                    response.status < 200 ||
                    response.status >= 300
                ) {
                    throw new Error(
                        `HTTP ${response.status}`
                    );
                }

                const data =
                    JSON.parse(
                        response.responseText
                    );

                const raw =
                    (
                        data?.[0] || []
                    )
                        .map(
                            item =>
                                item?.[0] || ''
                        )
                        .join('')
                        .trim();

                const lang =
                    typeof data?.[2] ===
                        'string'
                        ? data[2]
                        : null;

                if (!raw) {
                    throw new Error(
                        'empty translation'
                    );
                }

                return {
                    raw,
                    lang
                };

            } catch (error) {
                lastError = error;
            }
        }

        // Once per page load: every untranslated string on the page is about
        // to fail the same way, and one row says as much as a thousand.
        if (!reportedTranslateFailure) {
            reportedTranslateFailure = true;

            reportToManager(
                'error',
                'translation-endpoints',
                0
            );
        }

        throw (
            lastError ||
            new Error(
                'translation unavailable'
            )
        );
    }

    function postCorrect(
        source,
        translated,
        element
    ) {
        let result =
            translated;

        const lower =
            source.toLowerCase();

        const ui =
            isUiLike(
                element,
                source
            );

        if (
            lower.includes('modul')
        ) {
            result =
                result
                    .replace(
                        /\bmodules\b/gi,
                        'periods'
                    )
                    .replace(
                        /\bmodule\b/gi,
                        'period'
                    );
        }

        if (
            ui &&
            lower.includes('opgave')
        ) {
            result =
                result
                    .replace(
                        /\btasks\b/gi,
                        'assignments'
                    )
                    .replace(
                        /\btask\b/gi,
                        'assignment'
                    );
        }

        if (
            ui &&
            lower.includes('hold')
        ) {
            result =
                result
                    .replace(
                        /\bteams\b/gi,
                        'classes'
                    )
                    .replace(
                        /\bteam\b/gi,
                        'class'
                    );
        }

        if (
            ui &&
            lower.includes('karakter')
        ) {
            result =
                result
                    .replace(
                        /\bcharacters\b/gi,
                        'grades'
                    )
                    .replace(
                        /\bcharacter\b/gi,
                        'grade'
                    );
        }

        if (
            ui &&
            lower.includes('besked')
        ) {
            result =
                result
                    .replace(
                        /\bnotifications\b/gi,
                        'messages'
                    )
                    .replace(
                        /\bnotification\b/gi,
                        'message'
                    );
        }

        /*
         * The "skriftlig" (written) grade-type suffix renders
         * inconsistently across the Grades table depending on
         * whether it resolves locally (translateStructured's
         * "skriftlig" -> "written") or falls through to the
         * Google fallback, which instead renders it as "in
         * writing" (issue #20 audit, cosmetic finding). Only one
         * wording should ever reach the page.
         */
        if (
            lower.includes('skriftlig')
        ) {
            result =
                result.replace(
                    /\bin writing\b/gi,
                    'written'
                );
        }

        /*
         * Defence in depth for the "1i" class-code corruption
         * (issue #9 audit): a string that legitimately needs the
         * Google fallback (e.g. "1i aktivitet/4", which contains
         * real Danish) can still have its class code mangled by
         * the remote translation into "1 in aktivitet/4". Put
         * back any "Ni" identifier the fallback split into
         * "N in", but only when that exact identifier is present
         * in the original source, so this never touches a
         * genuine "in".
         */
        result =
            result.replace(
                /\b(\d+)\s+in\b/gi,
                (
                    match,
                    number
                ) =>
                    new RegExp(
                        `\\b${number}i\\b`,
                        'i'
                    )
                        .test(source)
                        ? `${number}i`
                        : match
            );

        if (
            ui &&
            lower.includes('aktivitet')
        ) {
            result =
                result
                    .replace(
                        /\bactivities\b/g,
                        'Activities'
                    )
                    .replace(
                        /\bactivity\b/g,
                        'Activity'
                    );
        }

        return result;
    }

    /*
     * ============================================================
     * TRANSLATION QUEUE
     * ============================================================
     */

    function queueTranslation(
        source,
        element,
        callback
    ) {
        const key =
            normalize(source);

        const exact =
            exactCore(key);

        if (exact !== null) {
            callback(
                exact,
                'da'
            );

            return true;
        }

        const learned =
            cacheGet(key);

        if (learned) {
            callback(
                postCorrect(
                    key,
                    learned.raw,
                    element
                ),

                learned.lang
            );

            return true;
        }

        if (
            pending.has(key)
        ) {
            let listeners =
                pending.get(key);

            /*
             * A pending translation holds temporary references
             * to DOM nodes. Remove nodes which Lectio has already
             * detached and impose a hard limit per translation.
             */
            listeners =
                listeners.filter(
                    listener =>
                        listener.element
                            ?.isConnected !== false
                );

            pending.set(
                key,
                listeners
            );

            if (
                listeners.length >=
                CFG.maxListenersPerKey
            ) {
                return false;
            }

            listeners.push({
                element,
                callback
            });

            return true;
        }

        /*
         * Global backpressure.
         *
         * This stops a DOM mutation storm from producing an
         * unlimited Google translation queue.
         */
        if (
            pending.size >=
            CFG.maxPendingKeys
        ) {
            return false;
        }

        pending.set(
            key,
            [{
                element,
                callback
            }]
        );

        googleQueue.push(key);

        scheduleGoogle();

        return true;
    }

    function scheduleGoogle() {
        if (
            googleTimer !== null
        ) {
            return;
        }

        googleTimer =
            setTimeout(
                () => {
                    googleTimer = null;
                    runGoogleQueue();
                },
                CFG.googleGapMs
            );
    }

    function runGoogleQueue() {
        while (
            activeGoogle <
                CFG.googleConcurrency &&
            googleQueue.length
        ) {
            const source =
                googleQueue.shift();

            activeGoogle++;

            requestGoogle(source)
                .then(
                    result => {
                        const listeners =
                            pending.get(source) ||
                            [];

                        pending.delete(source);

                        const raw =
                            result.lang === 'en'
                                ? source
                                : result.raw;

                        cachePut(
                            source,
                            raw,
                            result.lang
                        );

                        for (
                            const listener
                            of listeners
                        ) {
                            /*
                             * Do not process stale detached nodes.
                             */
                            if (
                                listener.element
                                    ?.isConnected === false
                            ) {
                                continue;
                            }

                            listener.callback(
                                postCorrect(
                                    source,
                                    raw,
                                    listener.element
                                ),
                                result.lang
                            );
                        }
                    }
                )
                .catch(
                    error => {
                        const listeners =
                            pending.get(source) ||
                            [];

                        /*
                         * Always release the pending entry,
                         * including failed requests.
                         */
                        pending.delete(source);

                        for (
                            const listener
                            of listeners
                        ) {
                            if (
                                listener.element
                                    ?.isConnected === false
                            ) {
                                continue;
                            }

                            listener.callback(
                                null,
                                null
                            );
                        }

                        console.warn(
                            LOG,
                            'Fallback failed:',
                            source,
                            error
                        );

                        if (
                            !fallbackWarningShown
                        ) {
                            fallbackWarningShown =
                                true;

                            showToast(
                                'Online translation fallback is unavailable. Core Lectio English is still active.'
                            );
                        }
                    }
                )
                .finally(
                    () => {
                        activeGoogle =
                            Math.max(
                                0,
                                activeGoogle - 1
                            );

                        scheduleGoogle();
                    }
                );
        }
    }

    /*
     * ============================================================
     * TEXT TRANSLATION
     * ============================================================
     */

    function textStateFor(node) {
        const current =
            node.nodeValue ?? '';

        let state =
            textState.get(node);

        if (!state) {
            state = {
                source: current,
                rendered: null,
                final: null,
                pending: null
            };

            textState.set(
                node,
                state
            );

        } else if (
            current !== state.source &&
            current !== state.rendered
        ) {
            state.source = current;
            state.rendered = null;
            state.final = null;
            state.pending = null;
        }

        return state;
    }

    function renderText(
        node,
        state,
        translated
    ) {
        const desired =
            preserveWhitespace(
                state.source,
                translated
            );

        state.final =
            translated;

        state.rendered =
            desired;

        if (
            node.nodeValue !== desired
        ) {
            node.nodeValue = desired;
        }
    }

    function processText(node) {
        if (
            mode !== MODE_EN ||
            node.nodeType !==
                Node.TEXT_NODE
        ) {
            return;
        }

        const element =
            node.parentElement;

        if (
            !element ||
            ignored(element) ||
            isEditable(element) ||
            isFixedNav(element)
        ) {
            return;
        }

        const state =
            textStateFor(node);

        const source =
            normalize(state.source);

        if (
            !source ||
            looksLikeIdentifier(source)
        ) {
            return;
        }

        if (
            state.final !== null
        ) {
            renderText(
                node,
                state,
                state.final
            );

            return;
        }

        const local =
            translateStructured(source);

        if (
            local.text !== source &&
            local.complete
        ) {
            renderText(
                node,
                state,
                local.text
            );

            return;
        }

        const learned =
            cacheGet(source);

        if (learned) {
            renderText(
                node,
                state,
                postCorrect(
                    source,
                    learned.raw,
                    element
                )
            );

            return;
        }

        if (
            local.text !== source
        ) {
            renderText(
                node,
                state,
                local.text
            );

            state.final = null;
        }

        if (
            !shouldFallback(
                source,
                element
            ) ||
            state.pending === source
        ) {
            return;
        }

        state.pending = source;

        const queued =
            queueTranslation(
                source,
                element,

                translated => {
                    const latest =
                        textState.get(node);

                    if (
                        latest &&
                        normalize(
                            latest.source
                        ) === source
                    ) {
                        latest.pending = null;
                    }

                    if (
                        mode !== MODE_EN ||
                        !node.isConnected ||
                        !translated ||
                        !latest ||
                        normalize(
                            latest.source
                        ) !== source
                    ) {
                        return;
                    }

                    renderText(
                        node,
                        latest,
                        exactCore(source) ??
                            translated
                    );
                }
            );

        if (
            !queued &&
            state.pending === source
        ) {
            state.pending = null;
        }
    }

    /*
     * ============================================================
     * ATTRIBUTES
     * ============================================================
     */

    function attributeState(
        element,
        name
    ) {
        let map =
            attrState.get(element);

        if (!map) {
            map = new Map();

            attrState.set(
                element,
                map
            );
        }

        const current =
            element.getAttribute(name);

        let state =
            map.get(name);

        if (!state) {
            state = {
                source: current,
                rendered: null,
                final: null,
                pending: null
            };

            map.set(
                name,
                state
            );

        } else if (
            current !== state.source &&
            current !== state.rendered
        ) {
            state.source = current;
            state.rendered = null;
            state.final = null;
            state.pending = null;
        }

        return state;
    }

    function processAttr(
        element,
        name
    ) {
        if (
            mode !== MODE_EN ||
            !element.hasAttribute(name) ||
            isFixedNav(element)
        ) {
            return;
        }

        const state =
            attributeState(
                element,
                name
            );

        const source =
            normalize(state.source);

        if (
            !source ||
            looksLikeIdentifier(source)
        ) {
            return;
        }

        if (
            state.final !== null
        ) {
            if (
                element.getAttribute(name) !==
                state.final
            ) {
                element.setAttribute(
                    name,
                    state.final
                );
            }

            return;
        }

        const local =
            translateStructured(source);

        if (
            local.text !== source &&
            local.complete
        ) {
            state.final =
                local.text;

            state.rendered =
                local.text;

            element.setAttribute(
                name,
                local.text
            );

            return;
        }

        const learned =
            cacheGet(source);

        if (learned) {
            state.final =
                postCorrect(
                    source,
                    learned.raw,
                    element
                );

            state.rendered =
                state.final;

            element.setAttribute(
                name,
                state.final
            );

            return;
        }

        if (
            !shouldFallback(
                source,
                element
            ) ||
            state.pending === source
        ) {
            return;
        }

        state.pending = source;

        const queued =
            queueTranslation(
                source,
                element,

                translated => {
                    const latest =
                        attributeState(
                            element,
                            name
                        );

                    if (
                        normalize(
                            latest.source
                        ) === source
                    ) {
                        latest.pending = null;
                    }

                    if (
                        mode !== MODE_EN ||
                        !element.isConnected ||
                        !translated ||
                        normalize(
                            latest.source
                        ) !== source
                    ) {
                        return;
                    }

                    latest.final =
                        exactCore(source) ??
                        translated;

                    latest.rendered =
                        latest.final;

                    element.setAttribute(
                        name,
                        latest.final
                    );
                }
            );

        if (
            !queued &&
            state.pending === source
        ) {
            state.pending = null;
        }
    }

    /*
     * ============================================================
     * INPUT BUTTONS
     * ============================================================
     */

    function processInput(element) {
        if (
            !(
                element instanceof
                HTMLInputElement
            ) ||
            ![
                'button',
                'submit',
                'reset'
            ].includes(element.type)
        ) {
            return;
        }

        let state =
            inputState.get(element);

        const current =
            element.value;

        if (!state) {
            state = {
                source: current,
                rendered: null,
                final: null,
                pending: null
            };

            inputState.set(
                element,
                state
            );

        } else if (
            current !== state.source &&
            current !== state.rendered
        ) {
            state.source = current;
            state.rendered = null;
            state.final = null;
            state.pending = null;
        }

        const source =
            normalize(state.source);

        if (
            !source ||
            looksLikeIdentifier(source)
        ) {
            return;
        }

        const local =
            translateStructured(source);

        const learned =
            cacheGet(source);

        const immediate =
            (
                local.complete &&
                local.text !== source
            )
                ? local.text

                : learned
                    ? postCorrect(
                        source,
                        learned.raw,
                        element
                    )
                    : null;

        if (
            immediate !== null
        ) {
            state.final = immediate;
            state.rendered = immediate;
            element.value = immediate;

            return;
        }

        if (
            !shouldFallback(
                source,
                element
            ) ||
            state.pending === source
        ) {
            return;
        }

        state.pending = source;

        const queued =
            queueTranslation(
                source,
                element,

                translated => {
                    const latest =
                        inputState.get(element);

                    if (
                        latest &&
                        normalize(
                            latest.source
                        ) === source
                    ) {
                        latest.pending = null;
                    }

                    if (
                        mode !== MODE_EN ||
                        !element.isConnected ||
                        !translated ||
                        !latest ||
                        normalize(
                            latest.source
                        ) !== source
                    ) {
                        return;
                    }

                    latest.final =
                        exactCore(source) ??
                        translated;

                    latest.rendered =
                        latest.final;

                    element.value =
                        latest.final;
                }
            );

        if (
            !queued &&
            state.pending === source
        ) {
            state.pending = null;
        }
    }

    /*
     * ============================================================
     * SPLIT-NODE PHRASES
     * ============================================================
     *
     * Lectio sometimes splits a single dictionary phrase across
     * more than one DOM node for its own layout/markup reasons,
     * which defeats an exact-match lookup that only ever sees one
     * node's text at a time (issue #20). Two known shapes:
     *
     * - A table header wraps at a literal <br> inside one <a>,
     *   e.g. "Ikke<br>afleveret" (OpgaveListe.aspx). The two
     *   words are two separate text nodes.
     * - Lectio's own keyboard-accesskey markup wraps the first
     *   letter of a word in <span class="shortcutletter">,
     *   e.g. <span class="shortcutletter">R</span>ediger, so the
     *   full word "Rediger" never exists in one text node.
     *
     * Both are joined here, looked up as one phrase, and the
     * translation is redistributed back across the original
     * nodes so the pipeline's normal per-node processing (which
     * still needs to visit them) sees already-English text and
     * leaves it alone.
     */

    function fixBrSplitPhrase(element) {
        if (
            element.children.length !== 1 ||
            element.children[0].tagName !== 'BR'
        ) {
            return;
        }

        const br =
            element.children[0];

        const before =
            br.previousSibling;

        const after =
            br.nextSibling;

        if (
            !before ||
            !after ||
            before.nodeType !== Node.TEXT_NODE ||
            after.nodeType !== Node.TEXT_NODE ||
            before.previousSibling ||
            after.nextSibling
        ) {
            return;
        }

        const combined =
            `${normalize(before.nodeValue)} ${
                normalize(after.nodeValue)
            }`;

        const translated =
            exactCore(combined);

        if (!translated) {
            return;
        }

        const splitAt =
            translated.indexOf(' ');

        if (splitAt === -1) {
            before.nodeValue = translated;
            after.nodeValue = '';

        } else {
            before.nodeValue =
                translated.slice(0, splitAt);

            after.nodeValue =
                translated.slice(splitAt + 1);
        }
    }

    /*
     * Writes a fragment of an already-translated word into a
     * text node and records it as final, so processText() does
     * not take "acking" or "T" for a Danish string of its own
     * and send it to the fallback.
     */
    function pinTextNode(node, value) {
        node.nodeValue = value;

        const state =
            textStateFor(node);

        state.source = value;
        state.rendered = value;
        state.final = value;
        state.pending = null;
    }

    /*
     * Lectio wraps a keyboard accesskey letter in
     * <span class="shortcutletter">, so a label is two or three
     * nodes and no single one of them matches its dictionary
     * entry. Issue #20 handled the leading letter
     * ("<span>R</span>ediger"); the Annual Summary tabs put it
     * mid-word ("Tids<span>r</span>egistrering",
     * "Eks.<span>B</span>elastning") and the personal nav does
     * the same ("Bes<span>k</span>eder"), so the text node
     * before the span is part of the word too (issue #61).
     *
     * The English is redistributed so the span keeps the
     * accesskey letter where it occurs in the English word
     * ("Time T", "r", "acking" for Alt+R), and keeps the first
     * character when the letter does not occur at all, as the
     * #20 shape did.
     */
    function fixShortcutLetterSplit(element) {
        const letterSpan =
            element.querySelector(
                ':scope > .shortcutletter'
            );

        const rest =
            letterSpan?.nextSibling;

        if (
            !letterSpan ||
            !rest ||
            rest.nodeType !== Node.TEXT_NODE
        ) {
            return;
        }

        const lead =
            letterSpan.previousSibling;

        const head =
            lead &&
            lead.nodeType === Node.TEXT_NODE
                ? lead
                : null;

        const letter =
            normalize(letterSpan.textContent);

        const remainder =
            normalize(rest.nodeValue);

        const start =
            head
                ? normalize(head.nodeValue)
                : '';

        if (!letter || !remainder) {
            return;
        }

        let translated =
            start
                ? exactCore(
                    start + letter + remainder
                )
                : null;

        const usesHead =
            translated !== null;

        if (translated === null) {
            translated =
                exactCore(letter + remainder);
        }

        if (!translated) {
            return;
        }

        let at =
            translated
                .toLowerCase()
                .indexOf(
                    letter.toLowerCase()
                );

        /*
         * The letter can only move into the text before the
         * span when that text is part of the same word.
         */
        if (
            at < 0 ||
            (
                at > 0 &&
                !usesHead
            )
        ) {
            at = 0;
        }

        if (usesHead) {
            pinTextNode(
                head,

                (
                    head.nodeValue
                        .match(/^\s*/)?.[0] ||
                    ''
                ) +
                translated.slice(0, at)
            );
        }

        letterSpan.textContent =
            translated.slice(at, at + 1);

        if (letterSpan.firstChild) {
            pinTextNode(
                letterSpan.firstChild,
                letterSpan.firstChild.nodeValue
            );
        }

        pinTextNode(
            rest,

            translated.slice(at + 1) +
            (
                rest.nodeValue
                    .match(/\s*$/)?.[0] ||
                ''
            )
        );
    }

    function processElement(element) {
        // Inside a rich-text editor every attribute and text node is the
        // user's content, not Lectio's UI: an image's alt, a link's title,
        // a line broken with <br> that happens to match a dictionary phrase.
        // Translating any of it wrote English into the homework that was
        // then saved. A plain text input is not content-editable, so its
        // placeholder is still translated.
        if (
            mode !== MODE_EN ||
            !(
                element instanceof
                Element
            ) ||
            element.isContentEditable ||
            ignored(element) ||
            isFixedNav(element)
        ) {
            return;
        }

        fixBrSplitPhrase(element);
        fixShortcutLetterSplit(element);

        for (
            const name
            of [
                'title',
                'aria-label',
                'placeholder',
                'alt'
            ]
        ) {
            processAttr(
                element,
                name
            );
        }

        processTooltip(element);
        processInput(element);
    }

    /*
     * Lectio's own hover text is a data-tooltip attribute, and on
     * the Study Plan calendar it is the only text of the cell
     * ("ma 6/7-26 - sø 12/7-26" on div.columnContainer, "2i
     * Aktivitet" on the column headers). It is translated in place
     * like a title, with one exception: a timetable lesson block.
     * Chairs Up, Subject Colours and Change Radar parse that
     * attribute as Danish - the "Hold:" and "Lokale(r):" lines, an
     * "Aflyst!" prefix - and a lesson block is what carries it on
     * SkemaNy, Forside and the absence page (AGENTS.md, "Timetable
     * lesson elements"; ADR-0011 on who owns a block). So a block,
     * anything inside one, and any tooltip shaped like a block's
     * are left byte-identical, whatever page they are on. The
     * class check runs only on an element that carries the
     * attribute, never per text node (issue #68).
     *
     * The MutationObserver watches childList only, so a tooltip
     * Lectio rewrites on an existing element is picked up by the
     * next uiRepair() pass, the same as a rewritten title.
     */
    const LESSON_BLOCK_SELECTOR =
        '.s2skemabrik, ' +
        '.s2brik, ' +
        '[data-lectiocontextcard]';

    const LESSON_TOOLTIP_START =
        /^\s*Aflyst!/;

    const LESSON_TOOLTIP_LINE =
        /^\s*(?:Hold|Lokale(?:r|\(r\))?|Lærer(?:e|\(e\))?)\s*:/m;

    function isLessonTooltip(element) {
        if (
            element.closest(
                LESSON_BLOCK_SELECTOR
            )
        ) {
            return true;
        }

        const text =
            element.getAttribute(
                'data-tooltip'
            ) || '';

        return (
            LESSON_TOOLTIP_START
                .test(text) ||
            LESSON_TOOLTIP_LINE
                .test(text)
        );
    }

    function processTooltip(element) {
        if (
            !element.hasAttribute(
                'data-tooltip'
            ) ||
            isLessonTooltip(element)
        ) {
            return;
        }

        processAttr(
            element,
            'data-tooltip'
        );
    }

    /*
     * ============================================================
     * DOM SCANNER
     * ============================================================
     */

    function processSubtree(
        root,
        limit = Infinity
    ) {
        if (
            mode !== MODE_EN ||
            !root ||
            !root.isConnected
        ) {
            return;
        }

        if (
            root.nodeType ===
            Node.TEXT_NODE
        ) {
            processText(root);
            return;
        }

        if (
            !(
                root instanceof
                Element
            ) ||
            ignored(root) ||
            isFixedNav(root)
        ) {
            return;
        }

        processElement(root);

        const walker =
            document.createTreeWalker(
                root,

                NodeFilter.SHOW_ELEMENT |
                NodeFilter.SHOW_TEXT,

                {
                    acceptNode(node) {
                        if (
                            node.nodeType ===
                            Node.ELEMENT_NODE
                        ) {
                            return (
                                ignored(node) ||
                                isFixedNav(node)
                            )
                                ? NodeFilter
                                    .FILTER_REJECT
                                : NodeFilter
                                    .FILTER_ACCEPT;
                        }

                        if (
                            node.nodeType ===
                            Node.TEXT_NODE
                        ) {
                            const parent =
                                node.parentElement;

                            return (
                                !parent ||
                                ignored(parent) ||
                                isEditable(parent) ||
                                isFixedNav(parent)
                            )
                                ? NodeFilter
                                    .FILTER_REJECT
                                : NodeFilter
                                    .FILTER_ACCEPT;
                        }

                        return NodeFilter
                            .FILTER_SKIP;
                    }
                }
            );

        let node;
        let count = 0;

        while (
            count < limit &&
            (
                node =
                    walker.nextNode()
            )
        ) {
            if (
                node.nodeType ===
                Node.TEXT_NODE
            ) {
                processText(node);

            } else {
                processElement(node);
            }

            count++;
        }
    }

    /*
     * ============================================================
     * PRIORITY UI REPAIR
     * ============================================================
     */

    function uiRepair() {
        if (
            mode !== MODE_EN
        ) {
            return;
        }

        repairNavigation();

        const selector =
            'a,' +
            'button,' +
            'label,' +
            'th,' +
            'legend,' +
            'option,' +
            'h1,' +
            'h2,' +
            'h3,' +
            'h4,' +
            '[role="button"],' +
            '[role="tab"],' +
            '[role="menuitem"],' +
            'input[type="button"],' +
            'input[type="submit"],' +
            'input[type="reset"]';

        for (
            const element
            of document
                .querySelectorAll(selector)
        ) {
            if (
                !isOurUi(element) &&
                !isFixedNav(element)
            ) {
                processSubtree(
                    element,
                    60
                );
            }
        }
    }

    /*
     * ============================================================
     * DYNAMIC LECTIO CONTENT
     * ============================================================
     */

    function queueMutation(node) {
        if (
            mode !== MODE_EN ||
            !node ||
            ![
                Node.ELEMENT_NODE,
                Node.TEXT_NODE
            ].includes(node.nodeType)
        ) {
            return;
        }

        if (
            node instanceof Element &&
            (
                isOurUi(node) ||
                isFixedNav(node)
            )
        ) {
            return;
        }

        mutationRoots.add(node);

        if (
            mutationTimer !== null
        ) {
            return;
        }

        mutationTimer =
            setTimeout(
                () => {
                    mutationTimer = null;

                    const roots =
                        Array.from(
                            mutationRoots
                        )
                            .filter(
                                item =>
                                    item.isConnected
                            );

                    mutationRoots.clear();

                    const minimal =
                        roots.filter(
                            root =>
                                !roots.some(
                                    other =>
                                        other !== root &&
                                        other instanceof
                                            Element &&
                                        other.contains
                                            ?.(
                                                root
                                            )
                                )
                        );

                    for (
                        const root
                        of minimal
                    ) {
                        processSubtree(
                            root,
                            1000
                        );
                    }

                    repairNavigation();
                },

                CFG.mutationBatchMs
            );
    }

    function installObserver() {
        if (
            observer ||
            !document.body
        ) {
            return;
        }

        observer =
            new MutationObserver(
                mutations => {
                    if (
                        mode !== MODE_EN
                    ) {
                        return;
                    }

                    for (
                        const mutation
                        of mutations
                    ) {
                        if (
                            mutation.type !==
                            'childList'
                        ) {
                            continue;
                        }

                        mutation
                            .addedNodes
                            .forEach(
                                queueMutation
                            );
                    }
                }
            );

        observer.observe(
            document.body,
            {
                subtree: true,
                childList: true
            }
        );
    }

    /*
     * ============================================================
     * DA / EN SWITCH
     * ============================================================
     */

    function installStyles() {
        if (
            document.getElementById(
                'lectio-english-style'
            )
        ) {
            return;
        }

        const style =
            document.createElement(
                'style'
            );

        style.id =
            'lectio-english-style';

        style.textContent = `
            #lectio-english-switch {
                position: absolute;
                top: 36px;
                right: max(
                    72px,
                    calc((100vw - 1280px)/2 + 150px)
                );
                z-index: 2147483000;
                display: flex;
                align-items: center;
                padding: 2px;
                background: color-mix(in srgb, var(--lectio-theme-surface, #f7fafc) 97%, transparent);
                border: 1px solid color-mix(in srgb, var(--lectio-theme-accent, #375a78) 22%, transparent);
                border-radius: var(--lectio-theme-radius, 4px);
                box-shadow: 0 1px 3px rgba(0,0,0,.10);
                font-family: Arial, Helvetica, sans-serif;
                user-select: none;
            }

            #lectio-english-switch[data-position="floating"] {
                position: fixed;
            }

            #lectio-english-switch button {
                min-width: 29px;
                height: 19px;
                padding: 0 5px;
                margin: 0;
                border: 0;
                border-radius: 3px;
                background: transparent;
                color: var(--lectio-theme-text, #35658c);
                font: 700 10px/19px Arial, Helvetica, sans-serif;
                cursor: pointer;
            }

            #lectio-english-switch button:hover {
                background: color-mix(in srgb, var(--lectio-theme-accent, #35658c) 10%, transparent);
            }

            #lectio-english-switch button.active {
                background: var(--lectio-theme-accent, #35658c);
                color: #fff;
            }

            #lectio-english-switch .divider {
                width: 1px;
                height: 12px;
                margin: 0 1px;
                background: color-mix(in srgb, var(--lectio-theme-text, #000) 16%, transparent);
            }

            #lectio-english-toast {
                position: fixed;
                right: 18px;
                bottom: 18px;
                z-index: 2147483001;
                max-width: 360px;
                padding: 9px 12px;
                border-radius: 5px;
                background: color-mix(in srgb, var(--lectio-theme-surface-alt, #232d37) 94%, transparent);
                color: var(--lectio-theme-text, #fff);
                font: 12px/1.35 Arial, Helvetica, sans-serif;
                box-shadow: 0 2px 12px rgba(0,0,0,.22);
            }
        `;

        document.head
            .appendChild(style);
    }

    function installSwitch() {
        if (
            document.getElementById(
                'lectio-english-switch'
            )
        ) {
            return;
        }

        const box =
            document.createElement('div');

        box.id =
            'lectio-english-switch';

        box.dataset.position =
            switchPosition;

        box.innerHTML =
            '<button type="button" data-lang="da" title="Dansk">DA</button>' +
            '<div class="divider"></div>' +
            '<button type="button" data-lang="en" title="English">EN</button>';

        box.addEventListener(
            'click',
            event => {
                const button =
                    event.target
                        .closest(
                            'button[data-lang]'
                        );

                if (
                    !button ||
                    button.dataset.lang === mode ||
                    ![
                        MODE_DA,
                        MODE_EN
                    ].includes(
                        button.dataset.lang
                    )
                ) {
                    return;
                }

                GM_setValue(
                    STORAGE_MODE,
                    button.dataset.lang
                );

                reloadWithoutResubmitting();
            }
        );

        document.body
            .appendChild(box);

        for (
            const button
            of box.querySelectorAll(
                'button[data-lang]'
            )
        ) {
            button.classList
                .toggle(
                    'active',
                    button.dataset.lang ===
                        mode
                );
        }
    }

    function showToast(text) {
        document
            .getElementById(
                'lectio-english-toast'
            )
            ?.remove();

        const toast =
            document.createElement('div');

        toast.id =
            'lectio-english-toast';

        toast.textContent =
            text;

        document.body
            .appendChild(toast);

        setTimeout(
            () =>
                toast.remove(),
            7000
        );
    }

    /*
     * ============================================================
     * ASP.NET FORM SAFETY
     * ============================================================
     *
     * Important memory fix:
     *
     * Earlier versions retained translated input controls inside
     * a normal Set. Removed controls therefore remained strongly
     * referenced indefinitely.
     *
     * We now use inputState (a WeakMap) and query only the actual
     * form being submitted.
     */

    function installFormSafety() {
        document.addEventListener(
            'submit',

            event => {
                const form =
                    event.target;

                if (
                    !(
                        form instanceof
                        HTMLFormElement
                    )
                ) {
                    return;
                }

                for (
                    const input
                    of form.querySelectorAll(
                        'input[type="button"],' +
                        'input[type="submit"],' +
                        'input[type="reset"]'
                    )
                ) {
                    const state =
                        inputState.get(input);

                    if (state) {
                        input.value =
                            state.source ?? '';
                    }
                }
            },

            true
        );
    }

    /*
     * ============================================================
     * START
     * ============================================================
     */

    function init() {
        console.log(
            LOG,
            `v${MODULE_VERSION} started`
        );

        installStyles();
        installSwitch();
        installFormSafety();

        if (
            mode === MODE_EN
        ) {
            /*
             * Navigation gets exclusive ownership first.
             */
            repairNavigation();

            /*
             * Immediate cached/local pass while the page is hidden.
             */
            processSubtree(
                document.body,
                Infinity
            );

            repairNavigation();

            revealPage();

            /*
             * Primary dynamic mechanism.
             */
            installObserver();

            /*
             * A few targeted late repairs for Lectio's post-load UI.
             */
            setTimeout(
                repairNavigation,
                150
            );

            setTimeout(
                uiRepair,
                450
            );

            setTimeout(
                uiRepair,
                1200
            );

            /*
             * Fallback navigation scan.
             *
             * Reduced substantially from the old ~650 ms loop.
             */
            setInterval(
                () => {
                    if (
                        !document.hidden
                    ) {
                        repairNavigation();
                    }
                },
                CFG.navRepairMs
            );

            /*
             * Broader fallback repair.
             *
             * MutationObserver remains the main path, so there is
             * no reason to rescan the UI every couple of seconds.
             */
            setInterval(
                () => {
                    if (
                        !document.hidden
                    ) {
                        uiRepair();
                    }
                },
                CFG.uiRepairMs
            );

            document
                .addEventListener(
                    'visibilitychange',
                    () => {
                        if (
                            !document.hidden
                        ) {
                            repairNavigation();
                            uiRepair();
                        }
                    }
                );

        } else {
            revealPage();
        }
    }

    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            init,
            {
                once: true
            }
        );

    } else {
        init();
    }

})();
