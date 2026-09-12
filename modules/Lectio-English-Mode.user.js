// ==UserScript==
// @name         Lectio English Mode
// @namespace    lectio-english-mode
// @version      1.7.0
// @description  Context-aware English layer for Lectio with instant core UI translation, persistent cache and Google fallback.
// @match        https://www.lectio.dk/lectio/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      translate.googleapis.com
// @connect      translate.google.com
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-English-Mode.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-English-Mode.user.js
// ==/UserScript==

(() => {
    'use strict';

    const MODE_DA = 'da';
    const MODE_EN = 'en';
    const STORAGE_MODE = 'lectioEnglish.mode';
    const LOG = '[Lectio English Mode]';

    /*
     * Lectio Manager handshake.
     * Lets the Manager show this module as installed without
     * touching its private storage. See catalogue/modules.json.
     */
    (function registerWithLectioManager() {
        const MODULE_ID = 'english-mode';
        const MODULE_NAME = 'Lectio English Mode';
        const MODULE_VERSION = '1.7.0';

        function announce() {
            const storedMode = GM_getValue(STORAGE_MODE, MODE_DA);

            window.dispatchEvent(new CustomEvent('lectio-module:register', {
                detail: {
                    id: MODULE_ID,
                    name: MODULE_NAME,
                    version: MODULE_VERSION,
                    settingsSchema: [
                        {
                            key: 'language',
                            type: 'select',
                            label: 'Interface language',
                            description: 'Reloads Lectio in the selected language.',
                            options: [
                                { value: MODE_DA, label: 'Dansk' },
                                { value: MODE_EN, label: 'English' }
                            ]
                        }
                    ],
                    currentValues: {
                        language: [MODE_DA, MODE_EN].includes(storedMode) ? storedMode : MODE_DA
                    }
                }
            }));
        }

        function handleSetting(event) {
            const detail = event?.detail;

            if (detail?.id !== MODULE_ID || detail.key !== 'language' || ![MODE_DA, MODE_EN].includes(detail.value)) {
                return;
            }

            GM_setValue(STORAGE_MODE, detail.value);
            announce();
            location.reload();
        }

        window.addEventListener('lectio-manager:discover', announce);
        window.addEventListener('lectio-manager:set-setting', handleSetting);
        announce();
    })();
    const STORAGE_CACHE = 'lectioEnglish.learned.v5';

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
                'Name'
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

        GM_setValue(
            STORAGE_CACHE,
            cache
        );
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

    function isEditable(element) {
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

        const words =
            lower.match(
                /\p{L}+/gu
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

        result =
            result.replace(
                /^([A-Za-zÆØÅæøå]{2,3})(?=\s+\d{1,2}\/\d{1,2})/i,
                match =>
                    SHORT_DAYS[
                        match.toLowerCase()
                    ] ||
                    match
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

    function processElement(element) {
        if (
            mode !== MODE_EN ||
            !(
                element instanceof
                Element
            ) ||
            ignored(element) ||
            isFixedNav(element)
        ) {
            return;
        }

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

        processInput(element);
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
                position: fixed;
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

                location.reload();
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
            'v1.5.3 started'
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
