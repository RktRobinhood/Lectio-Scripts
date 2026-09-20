// ==UserScript==
// @name         Lectio - Unread Message Notifications
// @namespace    https://www.lectio.dk/
// @version      0.7.0
// @description  Shows one unread-message badge using Lectio's own unread count, at any Lectio school. Includes direct and group-addressed messages.
// @match        https://www.lectio.dk/lectio/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Unread-Message-Notifications.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules-unstable/Lectio-Unread-Message-Notifications.user.js
// ==/UserScript==

(() => {
    'use strict';

    /*
     * The school this page belongs to, read off the URL rather than
     * hardcoded - a browser can be signed in to more than one Lectio
     * installation, and every path and cached count below is only
     * meaningful within one of them. Empty on any Lectio page that
     * carries no school id at all; the guard below stops there.
     *
     * Declared first because the config section builds its URLs and
     * its cache key out of it.
     */
    const SCHOOL =
        (location.pathname.match(/^\/lectio\/(\d+)\//) || [])[1] || '';

    /*
     * Settings are deliberately NOT scoped per school: how often to
     * check and how big the bubble is are preferences about the
     * person, not about the installation. The cached count is, and
     * is scoped below.
     */
    const SETTINGS_KEY = 'lectioUnreadMessages.settings.v1';
    const DEFAULT_SETTINGS = {
        pollMinutes: 10,
        showPreview: true,
        bubbleScale: 100
    };
    let settings = loadSettings();
    let pollTimer = null;

    // ============================================================
    // LECTIO MANAGER HANDSHAKE
    // ============================================================

    /*
     * Lets the Manager show this module as installed without
     * touching its private storage. See catalogue/modules.json.
     */
    (function registerWithLectioManager() {
        const MODULE_ID = 'message-notifications';
        const MODULE_NAME = 'Lectio - Unread Message Notifications';
        const MODULE_VERSION = '0.7.0';

        function announce() {
            window.dispatchEvent(new CustomEvent('lectio-module:register', {
                detail: {
                    id: MODULE_ID,
                    name: MODULE_NAME,
                    version: MODULE_VERSION,
                    settingsSchema: [
                        {
                            key: 'pollMinutes',
                            type: 'select',
                            label: 'Check for messages',
                            description: 'How often to refresh while Lectio is visible.',
                            options: [
                                { value: '2', label: 'Every 2 minutes' },
                                { value: '5', label: 'Every 5 minutes' },
                                { value: '10', label: 'Every 10 minutes' },
                                { value: '15', label: 'Every 15 minutes' },
                                { value: '30', label: 'Every 30 minutes' }
                            ]
                        },
                        {
                            key: 'showPreview',
                            type: 'toggle',
                            label: 'Message preview',
                            description: 'Show recent unread messages when hovering the badge.'
                        },
                        {
                            key: 'bubbleScale',
                            type: 'range',
                            label: 'Bubble size',
                            description: 'Scale the unread-message bubble to suit your screen.',
                            min: 75,
                            max: 175,
                            step: 5,
                            suffix: '%'
                        }
                    ],
                    currentValues: {
                        pollMinutes: String(settings.pollMinutes),
                        showPreview: settings.showPreview,
                        bubbleScale: settings.bubbleScale
                    }
                }
            }));
        }

        function handleSetting(event) {
            const detail = event?.detail;

            if (detail?.id !== MODULE_ID) {
                return;
            }

            if (detail.key === 'pollMinutes' && ['2', '5', '10', '15', '30'].includes(String(detail.value))) {
                settings.pollMinutes = Number(detail.value);
                startPolling();
            } else if (detail.key === 'showPreview') {
                settings.showPreview = Boolean(detail.value);
                applySettingsToPage();
            } else if (detail.key === 'bubbleScale') {
                const bubbleScale = normalizeBubbleScale(detail.value, null);
                if (bubbleScale === null) return;
                settings.bubbleScale = bubbleScale;
                applySettingsToPage();
            } else {
                return;
            }

            saveSettings();
            announce();
        }

        window.addEventListener('lectio-manager:discover', announce);
        window.addEventListener('lectio-manager:set-setting', handleSetting);
        announce();
    })();

    function loadSettings() {
        try {
            const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
            const pollMinutes = [2, 5, 10, 15, 30].includes(Number(parsed.pollMinutes))
                ? Number(parsed.pollMinutes)
                : DEFAULT_SETTINGS.pollMinutes;

            return {
                pollMinutes,
                showPreview: typeof parsed.showPreview === 'boolean'
                    ? parsed.showPreview
                    : DEFAULT_SETTINGS.showPreview,
                bubbleScale: normalizeBubbleScale(parsed.bubbleScale, DEFAULT_SETTINGS.bubbleScale)
            };
        } catch (_) {
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (_) {
            // Continue with in-memory settings when storage is unavailable.
        }
    }

    function applySettingsToPage() {
        document.documentElement.classList.toggle(
            'lectio-unread-hide-preview',
            !settings.showPreview
        );
        document.documentElement.style.setProperty(
            '--lectio-unread-badge-scale',
            String(settings.bubbleScale / 100)
        );
        updateBadgeContrast();
    }

    function normalizeBubbleScale(value, fallback) {
        if (value === null || value === '' || !Number.isFinite(Number(value))) return fallback;
        return Math.min(175, Math.max(75, Math.round(Number(value) / 5) * 5));
    }

    function updateBadgeContrast() {
        const root = document.documentElement;
        const background = getComputedStyle(root).getPropertyValue('--lectio-theme-accent').trim() || '#cae6ff';
        const rgb = parseCssColour(background);
        if (!rgb) return;
        const darkText = [0, 30, 47];
        const lightText = [255, 255, 255];
        const darkRatio = contrastRatio(rgb, darkText);
        const lightRatio = contrastRatio(rgb, lightText);
        const colour = Math.max(darkRatio, lightRatio) < 4.5
            ? '#000000'
            : darkRatio >= lightRatio ? '#001e2f' : '#ffffff';
        if (root.style.getPropertyValue('--lectio-unread-badge-text') !== colour) {
            root.style.setProperty('--lectio-unread-badge-text', colour);
        }
    }

    function parseCssColour(value) {
        const hex = value.match(/^#([0-9a-f]{6})$/i);
        if (hex) {
            return [0, 2, 4].map((offset) => Number.parseInt(hex[1].slice(offset, offset + 2), 16));
        }
        const rgb = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)/i);
        return rgb ? rgb.slice(1, 4).map(Number) : null;
    }

    function contrastRatio(first, second) {
        const luminance = (colour) => {
            const channels = colour.map((channel) => {
                const normalized = channel / 255;
                return normalized <= 0.03928
                    ? normalized / 12.92
                    : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        };
        const lighter = Math.max(luminance(first), luminance(second));
        const darker = Math.min(luminance(first), luminance(second));
        return (lighter + 0.05) / (darker + 0.05);
    }

    // ============================================================
    // CONFIG
    // ============================================================

    const HOME_URL =
        `/lectio/${SCHOOL}/forside.aspx`;

    const INBOX_URL =
        `/lectio/${SCHOOL}/beskeder2.aspx`;

    /*
     * New cache version deliberately avoids the bad "100 unread"
     * state produced by v0.2.2.
     *
     * v4 additionally carries the school id: an unread count read at
     * one school says nothing about another, and the unsuffixed v3 key
     * would have let two installations overwrite each other's badge in
     * the same browser. Old v3 entries are simply left behind - this
     * cache expires after ten minutes anyway.
     */
    const CACHE_KEY =
        `lectioUnreadMessages.cache.v4.${SCHOOL}`;

    const RETURN_REFRESH_AGE =
        10 * 60 * 1000;

    const CACHE_MAX_AGE =
        10 * 60 * 1000;

    /*
     * Background-fetch safety net (issue #37).
     *
     * Eight seconds is longer than a healthy Lectio page takes and
     * short enough that a hung request cannot outlive the page view
     * and wedge the in-flight guard for the rest of it.
     *
     * The backoff is measured against this module's own rhythm, not
     * Chairs Up's: a poll is two to thirty minutes apart, so seconds
     * of backoff would mean nothing. What actually hammers a sick
     * Lectio here is handleVisibilityChange() - while refreshes keep
     * failing, state.checkedAt never moves, so every single return to
     * the tab starts another one. After three consecutive failures the
     * wait starts at a minute and doubles to a fifteen-minute ceiling;
     * one success clears it.
     *
     * The first check of a page view already waits 700ms for Lectio to
     * finish rendering. The jitter is added on top of that, so many
     * browsers opening Lectio on the same bell stop marching in step.
     * It is small enough that nobody notices it.
     *
     * None of these three new failure paths - timeout, abort, backed-off
     * skip - may ever be mistaken for "no unread messages". Each one
     * leaves `state`, the cache and the badge exactly as they were; see
     * refreshUnreadMessages() and fetchDocument() below.
     */
    const FETCH_TIMEOUT_MS =
        8000;

    const FETCH_FAILURES_BEFORE_BACKOFF =
        3;

    const FETCH_BACKOFF_BASE_MS =
        60 * 1000;

    const FETCH_BACKOFF_CEILING_MS =
        15 * 60 * 1000;

    const FIRST_CHECK_DELAY_MS =
        700;

    const FIRST_CHECK_JITTER_MS =
        1500;

    const MAX_PREVIEW_ITEMS = 6;

    const HOST_CLASS =
        'lectio-unread-host';

    const BADGE_CLASS =
        'lectio-unread-badge';

    const TOOLTIP_CLASS =
        'lectio-unread-tooltip';

    const MESSAGE_LINK_SELECTOR =
        `a[href*="/lectio/${SCHOOL}/beskeder2.aspx"]`;

    /*
     * Every Lectio page that means anything to this module sits under
     * /lectio/<school>/. Anything else - the bare /lectio/ entry point
     * among them - has no front page to read a count off, so the module
     * stops here rather than fetching a path it just built out of an
     * empty string. The Manager handshake above has already run, so the
     * module still reports itself as installed on such a page.
     */
    if (!SCHOOL) {
        return;
    }

    let state =
        loadCache();

    let inFlight = false;

    /*
     * Reported once per page load: the badge re-syncs on every mutation, and
     * a link that was not recognised will not be recognised on the next one.
     *
     * Declared up here with the rest of the page-view state for the reason
     * written below it - init() runs synchronously a few lines down and
     * reaches findMessageNavLink(), so a flag declared beside that function
     * would be read in its temporal dead zone and throw on cold start.
     */
    let reportedNavDrift = false;

    let observerQueued = false;

    /*
     * Safety-net state, declared here on purpose - above init(), which
     * runs synchronously on the next line and reaches every one of
     * these. State declared down beside the functions that use it would
     * be read in its temporal dead zone and throw on cold start.
     *
     * All of it lives for one page view: pagehide aborts the live
     * controllers, empties the set, clears the first-check timer and
     * stops the poll interval, and a bfcache restore puts them back.
     */
    const liveFetchControllers =
        new Set();

    let consecutiveFetchFailures =
        0;

    let fetchBackoffUntil =
        0;

    let firstCheckTimer =
        null;

    let pageIsGoingAway =
        false;

    init();

    // ============================================================
    // INITIALISATION
    // ============================================================

    function init() {
        injectStyles();
        applySettingsToPage();

        /*
         * Discard stale cached state.
         */
        if (
            state &&
            Date.now() - state.checkedAt >
                CACHE_MAX_AGE
        ) {
            state = null;
        }

        syncBadge(false);

        installNavigationObserver();
        installThemeObserver();

        window.addEventListener(
            'storage',
            handleStorageUpdate
        );

        document.addEventListener(
            'visibilitychange',
            handleVisibilityChange
        );

        /*
         * One listener each, registered once per page load, so nothing
         * accumulates across navigations.
         */
        window.addEventListener(
            'pagehide',
            abortBackgroundWork
        );

        window.addEventListener(
            'pageshow',
            handlePageShow
        );

        /*
         * Give Lectio a moment to finish building the page, plus a
         * small random offset so many browsers loading Lectio at the
         * same time do not all hit Forside in the same instant.
         */
        firstCheckTimer = window.setTimeout(
            () => {
                firstCheckTimer = null;
                refreshUnreadMessages();
            },
            FIRST_CHECK_DELAY_MS +
            Math.floor(
                Math.random() *
                FIRST_CHECK_JITTER_MS
            )
        );

        /*
         * Normal background refresh.
         */
        startPolling();
    }

    /*
     * Nothing this module started may outlive the page view: every
     * live request is aborted, the first-check timer is cleared and
     * the poll interval is stopped.
     *
     * This deliberately touches neither `state` nor the cache nor the
     * badge. An abort is a failure, and a failure here must never be
     * read as "you have no messages" - whatever the badge was showing
     * before pagehide, it goes on showing.
     */
    function abortBackgroundWork() {
        pageIsGoingAway = true;

        if (firstCheckTimer !== null) {
            window.clearTimeout(firstCheckTimer);
            firstCheckTimer = null;
        }

        if (pollTimer !== null) {
            window.clearInterval(pollTimer);
            pollTimer = null;
        }

        for (const controller of liveFetchControllers) {
            try {
                controller.abort();
            } catch (_) {
                // A controller that has already settled cannot be aborted.
            }
        }

        liveFetchControllers.clear();
    }

    /*
     * A page restored from the back/forward cache never re-runs this
     * script, so without this the module would stay switched off for
     * the rest of that page's life - polling stopped and every refresh
     * skipped - and the badge would freeze at whatever it last showed.
     * That would be a regression against the module's behaviour today.
     */
    function handlePageShow(event) {
        if (!event?.persisted) {
            return;
        }

        pageIsGoingAway = false;
        startPolling();
    }

    function startPolling() {
        if (pollTimer !== null) {
            window.clearInterval(pollTimer);
        }

        pollTimer = window.setInterval(
            () => {
                if (document.visibilityState === 'visible') {
                    refreshUnreadMessages();
                }
            },
            settings.pollMinutes * 60 * 1000
        );
    }

    // ============================================================
    // AUTHORITATIVE UNREAD COUNT
    // ============================================================

    /*
     * This is the important change.
     *
     * We no longer decide whether a message "belongs" to the user.
     *
     * Lectio already knows that.
     *
     * If Lectio's front page says:
     *
     *     2 ulæste
     *
     * then the userscript shows 2.
     *
     * It makes no difference whether those messages were sent:
     *
     * - directly to the user
     * - to a class
     * - to an activity
     * - to a group
     * - to several groups
     *
     * The recipient field is never inspected.
     */
    function parseHomepageUnreadCount(doc) {
        if (!doc?.body) {
            return null;
        }

        /*
         * First find things literally called "Beskeder" / "Messages".
         *
         * There may be several:
         * - top navigation
         * - front-page message card
         *
         * We walk upward from each looking for Lectio's unread text.
         */
        const headers = [
            ...doc.querySelectorAll(
                'a, span, div, td, th, ' +
                'h1, h2, h3, h4, strong'
            )
        ].filter(element => {
            const text =
                cleanText(
                    element.textContent
                );

            return /^(Beskeder|Messages)$/i
                .test(text);
        });

        for (
            const header
            of headers
        ) {
            let container =
                header;

            for (
                let depth = 0;
                depth < 7;
                depth++
            ) {
                container =
                    container.parentElement;

                if (!container) {
                    break;
                }

                const text =
                    cleanText(
                        container.textContent
                    );

                /*
                 * Stop once we've climbed into a huge page wrapper.
                 */
                if (
                    text.length >
                    2500
                ) {
                    break;
                }

                const count =
                    extractUnreadNumber(
                        text
                    );

                if (
                    count !== null
                ) {
                    return count;
                }
            }
        }

        /*
         * Second pass:
         *
         * Look for short standalone elements such as:
         *
         *     2 ulæste
         *     2 unread
         *
         * This matches the front-page counter shown in your
         * screenshot without scanning arbitrary long page text.
         */
        const candidates = [
            ...doc.querySelectorAll(
                'span, div, td, th, a, strong'
            )
        ];

        const values = [];

        for (
            const element
            of candidates
        ) {
            const text =
                cleanText(
                    element.textContent
                );

            if (
                !text ||
                text.length > 80
            ) {
                continue;
            }

            const count =
                extractStandaloneUnreadNumber(
                    text
                );

            if (
                count !== null
            ) {
                values.push(count);
            }
        }

        if (
            values.length
        ) {
            return Math.max(
                ...values
            );
        }

        return null;
    }

    function extractUnreadNumber(text) {
        const source =
            cleanText(text);

        const patterns = [
            /(?:^|\s)(\d{1,3})\s+ulæst(?:e)?(?:\s+besked(?:er)?)?(?=\s|$)/i,

            /(?:^|\s)(\d{1,3})\s+unread(?:\s+messages?)?(?=\s|$)/i
        ];

        for (
            const pattern
            of patterns
        ) {
            const match =
                source.match(pattern);

            if (!match) {
                continue;
            }

            const value =
                Number(match[1]);

            if (
                Number.isInteger(value) &&
                value >= 0 &&
                value <= 999
            ) {
                return value;
            }
        }

        return null;
    }

    function extractStandaloneUnreadNumber(
        text
    ) {
        const source =
            cleanText(text);

        let match =
            source.match(
                /^(\d{1,3})\s+ulæst(?:e)?(?:\s+besked(?:er)?)?$/i
            );

        if (!match) {
            match =
                source.match(
                    /^(\d{1,3})\s+unread(?:\s+messages?)?$/i
                );
        }

        if (!match) {
            return null;
        }

        const value =
            Number(match[1]);

        return (
            Number.isInteger(value) &&
            value >= 0 &&
            value <= 999
        )
            ? value
            : null;
    }

    // ============================================================
    // REFRESH
    // ============================================================

    async function refreshUnreadMessages() {
        /*
         * Never stack: a tick that arrives while a refresh is still
         * running is skipped, not queued behind it. This guard already
         * existed, and the hard timeout below is what makes it safe -
         * before it, a request that never answered left this flag set
         * for the rest of the page view and silently stopped every
         * later poll.
         */
        if (inFlight) {
            return;
        }

        if (pageIsGoingAway) {
            return;
        }

        /*
         * Backed-off skip. Like every other failure path here it
         * returns before touching anything: `state`, the cache and the
         * badge are all left exactly as they were, so a skipped check
         * shows the last known count and never a zero.
         */
        if (Date.now() < fetchBackoffUntil) {
            return;
        }

        inFlight = true;

        try {
            const previousCount =
                getUnreadCount();

            let unreadCount = null;

            /*
             * If we're already on Forside, try the live DOM first.
             */
            if (
                /\/forside\.aspx$/i
                    .test(
                        location.pathname
                    )
            ) {
                unreadCount =
                    parseHomepageUnreadCount(
                        document
                    );
            }

            /*
             * Otherwise fetch Forside in the background.
             *
             * Forside is the authoritative source for the count.
             */
            if (
                unreadCount === null
            ) {
                const homeDoc =
                    await fetchDocument(
                        HOME_URL,
                        /\/forside\.aspx$/i
                    );

                unreadCount =
                    parseHomepageUnreadCount(
                        homeDoc
                    );
            }

            /*
             * Do NOT turn a parsing failure into zero unread.
             *
             * Keep the previous known-good state instead.
             */
            if (
                unreadCount === null
            ) {
                console.warn(
                    '[Lectio Message Notifications] ' +
                    'Could not locate Lectio\'s unread count on Forside.'
                );

                return;
            }

            let messages = [];

            /*
             * Inbox parsing is now ONLY for previews.
             *
             * It does not determine the badge number.
             */
            if (
                unreadCount > 0
            ) {
                try {
                    const inboxDoc =
                        await fetchDocument(
                            INBOX_URL,
                            /\/beskeder2\.aspx$/i
                        );

                    messages =
                        parseStrictUnreadPreviews(
                            inboxDoc
                        );

                    /*
                     * Never allow preview parsing to contradict Lectio's
                     * authoritative unread count.
                     */
                    if (
                        messages.length >
                        unreadCount
                    ) {
                        messages =
                            messages.slice(
                                0,
                                unreadCount
                            );
                    }

                } catch (error) {
                    console.warn(
                        '[Lectio Message Notifications] ' +
                        'Preview parsing failed:',
                        error
                    );

                    messages = [];
                }
            }

            state = {
                checkedAt:
                    Date.now(),

                unreadCount,

                messages
            };

            saveCache(state);

            syncBadge(
                unreadCount >
                previousCount
            );

            /*
             * Useful test output.
             */
            console.debug(
                '[Lectio Message Notifications]',
                {
                    authoritativeUnreadCount:
                        unreadCount,

                    parsedUnreadPreviews:
                        messages.length
                }
            );

        } catch (error) {
            console.warn(
                '[Lectio Message Notifications] Refresh failed:',
                error
            );

        } finally {
            inFlight = false;
        }
    }

    // ============================================================
    // FETCH
    // ============================================================

    /*
     * Every background request this module makes goes through here,
     * so the whole net fits around this one function: a hard timeout,
     * registration with the set pagehide aborts, and the consecutive-
     * failure count the backoff is built on.
     *
     * Every way out of here that is not a parsed document throws. It
     * never returns an empty document, a null, or anything else the
     * caller could parse as "nothing unread" - a timeout and an abort
     * reject exactly like a network error always has, and the caller's
     * existing "do NOT turn a parsing failure into zero unread" path
     * catches all three the same way.
     */
    async function fetchDocument(
        url,
        expectedPath
    ) {
        const controller =
            new AbortController();

        const timeoutTimer =
            window.setTimeout(
                () => controller.abort(),
                FETCH_TIMEOUT_MS
            );

        liveFetchControllers.add(controller);

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
                    `HTTP ${response.status} for ${url}`
                );
            }

            const finalUrl =
                new URL(
                    response.url,
                    location.origin
                );

            if (
                !expectedPath.test(
                    finalUrl.pathname
                )
            ) {
                throw new Error(
                    'Lectio returned an unexpected page. ' +
                    'The login session may have expired.'
                );
            }

            const html =
                await response.text();

            /*
             * Lectio answered. Whatever the page turns out to say,
             * the connection is healthy, so the backoff clears.
             */
            consecutiveFetchFailures = 0;
            fetchBackoffUntil = 0;

            return new DOMParser()
                .parseFromString(
                    html,
                    'text/html'
                );

        } catch (error) {
            noteFetchFailure();

            throw error;

        } finally {
            window.clearTimeout(timeoutTimer);
            liveFetchControllers.delete(controller);
        }
    }

    function noteFetchFailure() {
        consecutiveFetchFailures += 1;

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

    // ============================================================
    // STRICT INBOX PREVIEW PARSER
    // ============================================================

    /*
     * v0.2.2 made the mistake of searching for ANY descendant
     * whose class contained "unread".
     *
     * Lectio apparently has unread-related controls/classes inside
     * many or all message rows, which resulted in:
     *
     *     parsedUnreadThreads: 100
     *
     * This parser is deliberately conservative.
     *
     * Only the message row/container ITSELF may identify itself as
     * unread.
     *
     * If we cannot prove that a particular row is unread, it is not
     * used for the preview.
     *
     * The badge still remains correct because Forside supplies the
     * authoritative count.
     */
    function parseStrictUnreadPreviews(
        doc
    ) {
        const units =
            new Set();

        /*
         * Classic Lectio row marker.
         */
        for (
            const row
            of doc.querySelectorAll(
                'tr.unread'
            )
        ) {
            units.add(row);
        }

        /*
         * Container itself explicitly marked unread.
         */
        for (
            const container
            of doc.querySelectorAll(
                '.message-list-thread-container.unread'
            )
        ) {
            units.add(
                container.closest('tr') ||
                container
            );
        }

        /*
         * Explicit state attributes on message rows.
         */
        for (
            const row
            of doc.querySelectorAll(
                'tr[data-status="unread" i],' +
                'tr[data-state="unread" i],' +
                'tr[aria-label*="unread" i]'
            )
        ) {
            units.add(row);
        }

        /*
         * Danish explicit state attributes, if Lectio uses them.
         */
        for (
            const row
            of doc.querySelectorAll(
                'tr[data-status*="ulæst" i],' +
                'tr[data-state*="ulæst" i],' +
                'tr[aria-label*="ulæst" i]'
            )
        ) {
            units.add(row);
        }

        return [
            ...units
        ].map(
            (
                unit,
                index
            ) =>
                parseMessagePreview(
                    unit,
                    index
                )
        );
    }

    function parseMessagePreview(
        unit,
        index
    ) {
        const sender =
            cleanText(
                unit.querySelector(
                    '.message-list-thread-from,' +
                    '[class*="thread-from"],' +
                    '[class*="sender"]'
                )
                    ?.textContent ||
                ''
            );

        const subject =
            cleanText(
                unit.querySelector(
                    '.message-list-thread-subject,' +
                    '[class*="thread-subject"],' +
                    '[class*="subject"]'
                )
                    ?.textContent ||
                ''
            );

        const datetime =
            cleanText(
                unit.querySelector(
                    '.message-list-thread-datetime,' +
                    '[class*="datetime"],' +
                    '[class*="date"]'
                )
                    ?.textContent ||
                ''
            );

        return {
            sender,
            subject,
            datetime,

            key:
                [
                    unit.id || '',
                    sender,
                    subject,
                    datetime,
                    index
                ].join('|')
        };
    }

    // ============================================================
    // NAVIGATION LINK
    // ============================================================

    function getLinkLabel(link) {
        const clone =
            link.cloneNode(true);

        clone
            .querySelectorAll(
                `.${BADGE_CLASS},` +
                '.ls-fonticon'
            )
            .forEach(
                node =>
                    node.remove()
            );

        return cleanText(
            clone.textContent
        );
    }

    function isMessageNavCandidate(
        link
    ) {
        if (
            !(link instanceof
                HTMLAnchorElement)
        ) {
            return false;
        }

        let url;

        try {
            url =
                new URL(
                    link.href,
                    location.origin
                );

        } catch (_) {
            return false;
        }

        if (
            !url.pathname
                .toLowerCase()
                .endsWith(
                    '/beskeder2.aspx'
                )
        ) {
            return false;
        }

        return /^(Beskeder|Messages)$/i
            .test(
                getLinkLabel(link)
            );
    }

    /*
     * Telling the Manager that a selector matched nothing
     * (docs/manager-problem-log.md). One-way and additive: with no Manager
     * installed this lands on a window nobody is listening to, which is a
     * no-op.
     *
     * `code` is a token written here, never text read off the page - there is
     * deliberately no field for a message, because this log is written to be
     * pasted into a public issue.
     */
    function reportToManager(
        kind,
        code,
        found
    ) {
        window.dispatchEvent(
            new CustomEvent(
                'lectio-module:report',
                {
                    detail: {
                        moduleId:
                            'message-notifications',
                        kind,
                        code,
                        found
                    }
                }
            )
        );
    }

    function findMessageNavLink() {
        const links = [
            ...document.querySelectorAll(
                MESSAGE_LINK_SELECTOR
            )
        ];

        const candidates =
            links.filter(
                isMessageNavCandidate
            );

        if (
            !candidates.length
        ) {
            /*
             * This module's own rule is that a parse failure is never read as
             * zero unread, so a link it cannot recognise shows as nothing at
             * all - indistinguishable from an empty inbox, and the reason
             * nobody has ever reported it from a school other than the one it
             * was written against. If the page links to Beskeder and none of
             * those links matched, say so once.
             */
            if (
                links.length &&
                !reportedNavDrift
            ) {
                reportedNavDrift = true;

                reportToManager(
                    'drift',
                    'messages-nav-link',
                    0
                );
            }

            return null;
        }

        /*
         * There can also be a "Beskeder" link inside the front-page
         * message card.
         *
         * The navigation link is physically higher on the page.
         */
        const visible =
            candidates
                .map(
                    link => ({
                        link,
                        rect:
                            link.getBoundingClientRect()
                    })
                )
                .filter(
                    item =>
                        item.rect.width > 0 &&
                        item.rect.height > 0
                )
                .sort(
                    (a, b) =>
                        a.rect.top -
                        b.rect.top
                );

        if (
            visible.length
        ) {
            return visible[0].link;
        }

        return candidates[0];
    }

    // ============================================================
    // BADGE
    // ============================================================

    function syncBadge(
        animate
    ) {
        const navLink =
            findMessageNavLink();

        if (!navLink) {
            return;
        }

        /*
         * Delete any old/duplicate bubbles.
         */
        for (
            const badge
            of document.querySelectorAll(
                `.${BADGE_CLASS}`
            )
        ) {
            if (
                badge.parentElement !==
                navLink
            ) {
                const oldParent =
                    badge.parentElement;

                badge.remove();

                oldParent
                    ?.classList
                    .remove(
                        HOST_CLASS
                    );
            }
        }

        navLink.classList.add(
            HOST_CLASS
        );

        let badge =
            navLink.querySelector(
                `:scope > .${BADGE_CLASS}`
            );

        if (!badge) {
            badge =
                document.createElement(
                    'span'
                );

            badge.className =
                BADGE_CLASS;

            const countElement =
                document.createElement(
                    'span'
                );

            countElement.className =
                'lectio-unread-count';

            badge.appendChild(
                countElement
            );

            const tooltip =
                document.createElement(
                    'span'
                );

            tooltip.className =
                TOOLTIP_CLASS;

            badge.appendChild(
                tooltip
            );

            navLink.appendChild(
                badge
            );
        }

        updateBadge(
            badge,
            animate
        );
    }

    function updateBadge(
        badge,
        animate
    ) {
        const count =
            getUnreadCount();

        if (
            count <= 0
        ) {
            badge.hidden = true;

            badge.classList.remove(
                'is-new'
            );

            return;
        }

        badge.hidden = false;

        const countElement =
            badge.querySelector(
                '.lectio-unread-count'
            );

        if (countElement) {
            countElement.textContent =
                count > 99
                    ? '99+'
                    : String(count);
        }

        const language =
            detectLanguage();

        const labels =
            language === 'en'
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

                    missingPreview:
                        n =>
                            `${n} ${
                                n === 1
                                    ? 'message is'
                                    : 'messages are'
                            } counted by Lectio but not available in the preview.`,

                    checked:
                        'Checked'
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

                    missingPreview:
                        n =>
                            `${n} ${
                                n === 1
                                    ? 'besked tælles'
                                    : 'beskeder tælles'
                            } af Lectio, men kan ikke vises i forhåndsvisningen.`,

                    checked:
                        'Tjekket'
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
        const count =
            getUnreadCount();

        const messages =
            state?.messages || [];

        const signature =
            JSON.stringify({
                count,

                checkedAt:
                    state?.checkedAt || 0,

                messages:
                    messages.map(
                        message => [
                            message.key,
                            message.sender,
                            message.subject
                        ]
                    )
            });

        /*
         * Do not rewrite identical tooltip DOM.
         *
         * This is important for avoiding the old MutationObserver
         * feedback/memory problem.
         */
        if (
            tooltip.dataset.signature ===
            signature
        ) {
            return;
        }

        tooltip.dataset.signature =
            signature;

        tooltip.replaceChildren();

        const header =
            document.createElement(
                'span'
            );

        header.className =
            'lectio-unread-tooltip-header';

        header.textContent =
            labels.header;

        tooltip.appendChild(
            header
        );

        const list =
            document.createElement(
                'span'
            );

        list.className =
            'lectio-unread-tooltip-list';

        for (
            const message
            of messages.slice(
                0,
                MAX_PREVIEW_ITEMS
            )
        ) {
            const item =
                document.createElement(
                    'span'
                );

            item.className =
                'lectio-unread-tooltip-item';

            const sender =
                document.createElement(
                    'span'
                );

            sender.className =
                'lectio-unread-tooltip-sender';

            sender.textContent =
                message.sender ||
                labels.unknown;

            const subject =
                document.createElement(
                    'span'
                );

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

        /*
         * If Lectio says 2 unread but we could only identify
         * 0 or 1 specific inbox rows, the badge is still correct.
         */
        const missing =
            Math.max(
                0,
                count -
                messages.length
            );

        if (
            missing > 0
        ) {
            const fallback =
                document.createElement(
                    'span'
                );

            fallback.className =
                'lectio-unread-tooltip-fallback';

            fallback.textContent =
                labels.missingPreview(
                    missing
                );

            list.appendChild(
                fallback
            );
        }

        tooltip.appendChild(
            list
        );

        const footer =
            document.createElement(
                'span'
            );

        footer.className =
            'lectio-unread-tooltip-footer';

        footer.textContent =
            `${labels.checked} ${
                formatTime(
                    state?.checkedAt
                )
            }`;

        tooltip.appendChild(
            footer
        );
    }

    // ============================================================
    // NAVIGATION OBSERVER
    // ============================================================

    function installNavigationObserver() {
        if (!document.body) {
            return;
        }

        const observer =
            new MutationObserver(
                mutations => {
                    /*
                     * Completely ignore changes made inside our own
                     * badge/tooltip.
                     */
                    const relevant =
                        mutations.some(
                            mutation => {
                                if (
                                    mutation.target instanceof
                                        Element &&
                                    mutation.target.closest(
                                        `.${BADGE_CLASS}`
                                    )
                                ) {
                                    return false;
                                }

                                for (
                                    const node
                                    of mutation.addedNodes
                                ) {
                                    if (
                                        !(node instanceof
                                            Element)
                                    ) {
                                        continue;
                                    }

                                    if (
                                        node.matches?.(
                                            MESSAGE_LINK_SELECTOR
                                        ) ||
                                        node.querySelector?.(
                                            MESSAGE_LINK_SELECTOR
                                        )
                                    ) {
                                        return true;
                                    }
                                }

                                return false;
                            }
                        );

                    if (
                        !relevant ||
                        observerQueued
                    ) {
                        return;
                    }

                    observerQueued = true;

                    queueMicrotask(
                        () => {
                            observerQueued = false;

                            syncBadge(false);
                        }
                    );
                }
            );

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );
    }

    function installThemeObserver() {
        const observer = new MutationObserver(updateBadgeContrast);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'style']
        });
    }

    // ============================================================
    // CROSS-TAB / VISIBILITY
    // ============================================================

    function handleStorageUpdate(
        event
    ) {
        if (
            event.key !== CACHE_KEY ||
            !event.newValue
        ) {
            return;
        }

        try {
            const incoming =
                normalizeState(
                    JSON.parse(
                        event.newValue
                    )
                );

            if (!incoming) {
                return;
            }

            const oldCount =
                getUnreadCount();

            state = incoming;

            syncBadge(
                incoming.unreadCount >
                oldCount
            );

        } catch (_) {
            // Ignore corrupt state.
        }
    }

    function handleVisibilityChange() {
        if (
            document.visibilityState !==
            'visible'
        ) {
            return;
        }

        syncBadge(false);

        const age =
            Date.now() -
            (state?.checkedAt || 0);

        if (
            age >=
            RETURN_REFRESH_AGE
        ) {
            refreshUnreadMessages();
        }
    }

    // ============================================================
    // STATE
    // ============================================================

    function getUnreadCount() {
        return (
            Number.isFinite(
                state?.unreadCount
            )
                ? Math.max(
                    0,
                    Math.floor(
                        state.unreadCount
                    )
                )
                : 0
        );
    }

    function normalizeState(
        value
    ) {
        if (
            !value ||
            !Number.isFinite(
                value.checkedAt
            ) ||
            !Number.isFinite(
                value.unreadCount
            ) ||
            !Array.isArray(
                value.messages
            )
        ) {
            return null;
        }

        return {
            checkedAt:
                value.checkedAt,

            unreadCount:
                Math.max(
                    0,
                    Math.floor(
                        value.unreadCount
                    )
                ),

            messages:
                value.messages
        };
    }

    function loadCache() {
        try {
            return normalizeState(
                JSON.parse(
                    localStorage.getItem(
                        CACHE_KEY
                    ) ||
                    'null'
                )
            );

        } catch (_) {
            return null;
        }
    }

    function saveCache(
        value
    ) {
        try {
            localStorage.setItem(
                CACHE_KEY,
                JSON.stringify(
                    value
                )
            );

        } catch (_) {
            // Cache failure is non-fatal.
        }
    }

    // ============================================================
    // LANGUAGE / UTILITIES
    // ============================================================

    function detectLanguage() {
        const link =
            findMessageNavLink();

        if (
            link &&
            /^Messages$/i.test(
                getLinkLabel(link)
            )
        ) {
            return 'en';
        }

        return 'da';
    }

    function cleanText(
        value
    ) {
        return String(
            value || ''
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

    function formatTime(
        timestamp
    ) {
        if (!timestamp) {
            return '';
        }

        try {
            return new Date(
                timestamp
            ).toLocaleTimeString(
                [],
                {
                    hour:
                        '2-digit',

                    minute:
                        '2-digit'
                }
            );

        } catch (_) {
            return '';
        }
    }

    // ============================================================
    // STYLES
    // ============================================================

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
            html.lectio-unread-hide-preview .${TOOLTIP_CLASS} {
                display: none !important;
            }
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

                background: var(--lectio-theme-accent, #cae6ff);
                /* Computed by the module from the active accent so every
                   theme gets a WCAG-readable light or dark count colour. */
                color: var(--lectio-unread-badge-text, #001e2f);

                border: 1px solid var(--lectio-theme-muted, #c1c7ce);

                border-radius:
                    0.38rem
                    0.38rem
                    0.38rem
                    0.12rem;

                box-shadow:
                    rgba(0,0,0,.16)
                    0 1px 3px,

                    rgba(0,0,0,.08)
                    0 2px 5px;

                font-family:
                    Roboto,
                    Arial,
                    sans-serif;

                font-size: .72rem;
                font-weight: 700;
                line-height: 1;

                cursor: pointer;

                transform-origin:
                    50% 70%;

                scale: var(--lectio-unread-badge-scale, 1);
            }

            .${BADGE_CLASS}[hidden] {
                display: none !important;
            }

            .${BADGE_CLASS}::after {
                content: "";

                position: absolute;

                left: .12rem;
                bottom: -.22rem;

                width: 0;
                height: 0;

                border-top:
                    .28rem solid
                    var(--lectio-theme-accent, #cae6ff);

                border-right:
                    .28rem solid
                    transparent;

                pointer-events:
                    none;
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
                        scale(.72)
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
                        100% + .62rem
                    );

                right: -.65rem;

                z-index: 10030;

                width:
                    min(
                        19rem,
                        calc(
                            100vw - 2rem
                        )
                    );

                padding:
                    .7rem .78rem;

                box-sizing:
                    border-box;

                display: none;

                flex-direction:
                    column;

                gap: .48rem;

                background:
                    var(--lectio-theme-surface, #f5f8fb);

                color:
                    var(--lectio-theme-text, #001e2f);

                border:
                    1px solid
                    var(--lectio-theme-muted, #c1c7ce);

                border-radius:
                    .5rem;

                box-shadow:
                    rgba(0,0,0,.18)
                    0 4px 8px -2px,

                    rgba(0,0,0,.12)
                    0 8px 16px 1px;

                font-family:
                    Roboto,
                    Arial,
                    sans-serif;

                font-size:
                    .82rem;

                font-weight:
                    400;

                line-height:
                    1.28;

                text-align:
                    left;

                white-space:
                    normal;

                pointer-events:
                    none;
            }

            .${BADGE_CLASS}:hover
                > .${TOOLTIP_CLASS},

            .${BADGE_CLASS}:focus-within
                > .${TOOLTIP_CLASS} {

                display: flex;
            }

            .lectio-unread-tooltip-header {
                display: block;

                padding-bottom:
                    .38rem;

                border-bottom:
                    1px solid
                    var(--lectio-theme-muted, #d3dae0);

                font-weight:
                    700;

                font-size:
                    .88rem;
            }

            .lectio-unread-tooltip-list {
                display: flex;

                flex-direction:
                    column;

                gap:
                    .42rem;
            }

            .lectio-unread-tooltip-item {
                display: grid;

                grid-template-columns:
                    minmax(
                        6.4rem,
                        .8fr
                    )
                    minmax(
                        8rem,
                        1.2fr
                    );

                gap:
                    .5rem;

                align-items:
                    baseline;
            }

            .lectio-unread-tooltip-sender {
                overflow: hidden;

                text-overflow:
                    ellipsis;

                white-space:
                    nowrap;

                font-weight:
                    600;
            }

            .lectio-unread-tooltip-subject {
                overflow: hidden;

                text-overflow:
                    ellipsis;

                white-space:
                    nowrap;

                color:
                    var(--lectio-theme-muted, #394a57);
            }

            .lectio-unread-tooltip-fallback {
                display: block;

                padding-top:
                    .2rem;

                color:
                    var(--lectio-theme-muted, #5e6870);

                font-size:
                    .76rem;

                line-height:
                    1.3;
            }

            .lectio-unread-tooltip-footer {
                display: block;

                padding-top:
                    .36rem;

                border-top:
                    1px solid
                    var(--lectio-theme-muted, #d3dae0);

                color:
                    var(--lectio-theme-muted, #5e6870);

                font-size:
                    .72rem;
            }

            @media (hover: none) {
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
                    animation:
                        none;
                }
            }
        `;

        document.head
            .appendChild(
                style
            );
    }

})();
