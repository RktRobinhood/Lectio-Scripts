// ==UserScript==
// @name         Lectio Theming
// @namespace    https://www.lectio.dk/
// @version      0.1.0
// @description  Gives Lectio a polished Hyprland-inspired shell and can derive its palette from a website or image.
// @match        https://www.lectio.dk/lectio/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      *
// @updateURL    https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-Theming.user.js
// @downloadURL  https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-Theming.user.js
// ==/UserScript==

(() => {
    'use strict';

    const MODULE_ID = 'lectio-theming';
    const MODULE_NAME = 'Lectio Theming';
    const MODULE_VERSION = '0.1.0';
    const STORAGE_KEY = 'lectioTheming.settings.v1';
    const STYLE_ID = 'lectio-theming-styles';
    const ROOT_CLASS = 'lectio-themed';
    const LOG = '[Lectio Theming]';
    const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

    const PRESETS = Object.freeze({
        graphite: {
            background: '#0b1014', surface: '#141b21', surfaceAlt: '#1b252c',
            text: '#e8f0f2', muted: '#9babb1', accent: '#65d1c7', accentAlt: '#8aa8ff', danger: '#ff6b81'
        },
        catppuccin: {
            background: '#11111b', surface: '#181825', surfaceAlt: '#24243a',
            text: '#cdd6f4', muted: '#a6adc8', accent: '#cba6f7', accentAlt: '#89b4fa', danger: '#f38ba8'
        },
        nord: {
            background: '#242933', surface: '#2e3440', surfaceAlt: '#3b4252',
            text: '#eceff4', muted: '#aeb8c7', accent: '#88c0d0', accentAlt: '#81a1c1', danger: '#bf616a'
        }
    });

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        preset: 'graphite',
        sourceUrl: '',
        radius: 12,
        blur: true,
        density: 'compact',
        palette: PRESETS.graphite
    });

    let settings = loadSettings();

    announce();
    applyTheme();

    window.addEventListener('lectio-manager:discover', announce);
    window.addEventListener('lectio-manager:set-setting', handleSetting);

    function announce() {
        window.dispatchEvent(new CustomEvent('lectio-module:register', {
            detail: {
                id: MODULE_ID,
                name: MODULE_NAME,
                version: MODULE_VERSION,
                settingsSchema: [
                    {
                        key: 'enabled', type: 'toggle', label: 'Theme enabled',
                        description: 'Switch the visual layer on or off.'
                    },
                    {
                        key: 'preset', type: 'select', label: 'Base palette',
                        description: 'Start with a built-in palette or your imported colours.',
                        options: [
                            { value: 'graphite', label: 'Graphite mint' },
                            { value: 'catppuccin', label: 'Catppuccin' },
                            { value: 'nord', label: 'Nord' },
                            { value: 'custom', label: 'Imported palette' }
                        ]
                    },
                    {
                        key: 'sourceUrl', type: 'text', label: 'Palette source',
                        description: 'Paste an https image or website URL.'
                    },
                    {
                        key: 'applySource', type: 'button', label: 'Import colours',
                        description: 'Sample the image or colours used by the website.', buttonLabel: 'Import'
                    },
                    {
                        key: 'chooseImage', type: 'button', label: 'Local image',
                        description: 'Choose an image from this device. It never leaves the browser.', buttonLabel: 'Choose image'
                    },
                    {
                        key: 'radius', type: 'range', label: 'Corner radius',
                        description: 'Round panels and controls.', min: 4, max: 20, step: 1, suffix: 'px'
                    },
                    {
                        key: 'blur', type: 'toggle', label: 'Glass blur',
                        description: 'Use translucent, blurred navigation surfaces.'
                    },
                    {
                        key: 'density', type: 'select', label: 'Spacing',
                        description: 'Choose compact or roomier controls.',
                        options: [
                            { value: 'compact', label: 'Compact' },
                            { value: 'comfortable', label: 'Comfortable' }
                        ]
                    },
                    {
                        key: 'resetTheme', type: 'button', label: 'Reset theme',
                        description: 'Restore the Graphite mint defaults.', buttonLabel: 'Reset'
                    }
                ],
                currentValues: {
                    enabled: settings.enabled,
                    preset: settings.preset,
                    sourceUrl: settings.sourceUrl,
                    radius: settings.radius,
                    blur: settings.blur,
                    density: settings.density
                }
            }
        }));
    }

    async function handleSetting(event) {
        const detail = event?.detail;

        if (detail?.id !== MODULE_ID) {
            return;
        }

        switch (detail.key) {
            case 'enabled':
                settings.enabled = Boolean(detail.value);
                break;
            case 'preset':
                if (!['graphite', 'catppuccin', 'nord', 'custom'].includes(detail.value)) return;
                settings.preset = detail.value;
                if (PRESETS[detail.value]) settings.palette = { ...PRESETS[detail.value] };
                break;
            case 'sourceUrl':
                settings.sourceUrl = String(detail.value || '').trim();
                saveSettings();
                return;
            case 'radius':
                settings.radius = clamp(Number(detail.value), 4, 20);
                break;
            case 'blur':
                settings.blur = Boolean(detail.value);
                break;
            case 'density':
                if (!['compact', 'comfortable'].includes(detail.value)) return;
                settings.density = detail.value;
                break;
            case 'applySource':
                await importPalette();
                return;
            case 'chooseImage':
                chooseLocalImage();
                return;
            case 'resetTheme':
                settings = cloneDefaults();
                break;
            default:
                return;
        }

        saveSettings();
        applyTheme();
        announce();
    }

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            const preset = ['graphite', 'catppuccin', 'nord', 'custom'].includes(saved.preset)
                ? saved.preset
                : DEFAULT_SETTINGS.preset;
            const savedPalette = validatePalette(saved.palette);

            return {
                enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_SETTINGS.enabled,
                preset,
                sourceUrl: typeof saved.sourceUrl === 'string' ? saved.sourceUrl : '',
                radius: clamp(Number(saved.radius) || DEFAULT_SETTINGS.radius, 4, 20),
                blur: typeof saved.blur === 'boolean' ? saved.blur : DEFAULT_SETTINGS.blur,
                density: ['compact', 'comfortable'].includes(saved.density) ? saved.density : DEFAULT_SETTINGS.density,
                palette: preset === 'custom' && savedPalette ? savedPalette : { ...(PRESETS[preset] || PRESETS.graphite) }
            };
        } catch (_) {
            return cloneDefaults();
        }
    }

    function cloneDefaults() {
        return { ...DEFAULT_SETTINGS, palette: { ...DEFAULT_SETTINGS.palette } };
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (error) {
            console.warn(LOG, 'Could not save settings:', error);
        }
    }

    function validatePalette(value) {
        const keys = ['background', 'surface', 'surfaceAlt', 'text', 'muted', 'accent', 'accentAlt', 'danger'];
        return value && keys.every((key) => /^#[0-9a-f]{6}$/i.test(value[key] || ''))
            ? Object.fromEntries(keys.map((key) => [key, value[key]]))
            : null;
    }

    function applyTheme() {
        const root = document.documentElement;
        root.classList.toggle(ROOT_CLASS, settings.enabled);
        root.classList.toggle('lectio-theme-blur', settings.blur);
        root.dataset.lectioThemeDensity = settings.density;

        const palette = settings.palette;
        const variables = {
            '--lectio-theme-bg': palette.background,
            '--lectio-theme-surface': palette.surface,
            '--lectio-theme-surface-alt': palette.surfaceAlt,
            '--lectio-theme-text': palette.text,
            '--lectio-theme-muted': palette.muted,
            '--lectio-theme-accent': palette.accent,
            '--lectio-theme-accent-alt': palette.accentAlt,
            '--lectio-theme-danger': palette.danger,
            '--lectio-theme-radius': `${settings.radius}px`,
            '--lectio-theme-space': settings.density === 'compact' ? '6px' : '10px'
        };

        for (const [key, value] of Object.entries(variables)) {
            root.style.setProperty(key, value);
        }

        injectStyles();
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            :root {
                --lectio-theme-bg: #0b1014;
                --lectio-theme-surface: #141b21;
                --lectio-theme-surface-alt: #1b252c;
                --lectio-theme-text: #e8f0f2;
                --lectio-theme-muted: #9babb1;
                --lectio-theme-accent: #65d1c7;
                --lectio-theme-accent-alt: #8aa8ff;
                --lectio-theme-danger: #ff6b81;
                --lectio-theme-radius: 12px;
                --lectio-theme-space: 6px;
            }

            html.${ROOT_CLASS},
            html.${ROOT_CLASS} body {
                color-scheme: dark;
                background: var(--lectio-theme-bg) !important;
                color: var(--lectio-theme-text) !important;
            }

            html.${ROOT_CLASS} body {
                background-image:
                    radial-gradient(circle at 15% -10%, color-mix(in srgb, var(--lectio-theme-accent) 16%, transparent), transparent 34rem),
                    radial-gradient(circle at 100% 15%, color-mix(in srgb, var(--lectio-theme-accent-alt) 12%, transparent), transparent 30rem) !important;
                background-attachment: fixed !important;
            }

            html.${ROOT_CLASS} :where(#masterContent, #content, #m_Content, .ls-master-container, .ls-content-container,
                .ls-card, .island, fieldset, .s2skemabrikcontainer, .s2skemabrik, .s2day, .s2weekHeader) {
                border-color: color-mix(in srgb, var(--lectio-theme-accent) 24%, transparent) !important;
                border-radius: var(--lectio-theme-radius) !important;
            }

            html.${ROOT_CLASS} :where(.ls-card, .island, fieldset, .s2skemabrikcontainer, .s2day, table, tbody, tr, td, th) {
                color: var(--lectio-theme-text);
                border-color: color-mix(in srgb, var(--lectio-theme-muted) 22%, transparent) !important;
            }

            html.${ROOT_CLASS} :where(table, tbody, tr, td, th) {
                background-color: transparent !important;
            }

            html.${ROOT_CLASS} table {
                background: var(--lectio-theme-surface) !important;
            }

            html.${ROOT_CLASS} :where(th, tr:nth-child(even) > td) {
                background: color-mix(in srgb, var(--lectio-theme-surface-alt) 72%, transparent) !important;
            }

            html.${ROOT_CLASS} :where(.ls-card, .island, fieldset, .s2skemabrikcontainer) {
                background: color-mix(in srgb, var(--lectio-theme-surface) 94%, transparent) !important;
                box-shadow: 0 10px 30px rgba(0, 0, 0, .18), inset 0 1px rgba(255, 255, 255, .035);
                padding: var(--lectio-theme-space);
            }

            html.${ROOT_CLASS} :where(#s_m_masterleftDiv, .ls-master-header, .ls-top-nav, .ls-master-pageheader) {
                background: color-mix(in srgb, var(--lectio-theme-surface) 88%, transparent) !important;
                border: 1px solid color-mix(in srgb, var(--lectio-theme-accent) 22%, transparent) !important;
                color: var(--lectio-theme-text) !important;
                box-shadow: 0 12px 30px rgba(0, 0, 0, .24);
            }

            html.${ROOT_CLASS}.lectio-theme-blur :where(#s_m_masterleftDiv, .ls-master-header, .ls-top-nav, .ls-card, .island) {
                backdrop-filter: blur(18px) saturate(125%);
            }

            html.${ROOT_CLASS} :where(a, .ls-link):not(#lectio-manager-root *) {
                color: var(--lectio-theme-accent) !important;
                text-decoration-color: color-mix(in srgb, var(--lectio-theme-accent) 45%, transparent);
            }

            html.${ROOT_CLASS} :where(a:hover, .ls-link:hover):not(#lectio-manager-root *) {
                color: color-mix(in srgb, var(--lectio-theme-accent) 72%, white) !important;
            }

            html.${ROOT_CLASS} :where(input, select, textarea, button, .button, .ls-button):not(#lectio-manager-root *) {
                border: 1px solid color-mix(in srgb, var(--lectio-theme-muted) 35%, transparent) !important;
                border-radius: max(6px, calc(var(--lectio-theme-radius) - 4px)) !important;
                background: var(--lectio-theme-surface-alt) !important;
                color: var(--lectio-theme-text) !important;
                padding: var(--lectio-theme-space);
            }

            html.${ROOT_CLASS} :where(button, .button, .ls-button):not(#lectio-manager-root *):hover {
                border-color: var(--lectio-theme-accent) !important;
                box-shadow: 0 0 0 2px color-mix(in srgb, var(--lectio-theme-accent) 18%, transparent);
            }

            html.${ROOT_CLASS} :where(input, select, textarea):not(#lectio-manager-root *):focus {
                outline: 2px solid color-mix(in srgb, var(--lectio-theme-accent) 65%, transparent) !important;
                outline-offset: 1px;
            }

            html.${ROOT_CLASS} :where(.s2skemabrik, a.s2skemabrik.s2brik) {
                background: var(--lectio-theme-surface-alt) !important;
                color: var(--lectio-theme-text) !important;
                border: 1px solid color-mix(in srgb, var(--lectio-theme-accent-alt) 35%, transparent) !important;
                border-radius: max(5px, calc(var(--lectio-theme-radius) - 5px)) !important;
                box-shadow: inset 3px 0 var(--lectio-theme-accent-alt), 0 3px 10px rgba(0, 0, 0, .16);
            }

            html.${ROOT_CLASS} :where(.s2cancelled, .ls-status-cancelled) {
                opacity: .68;
                border-color: var(--lectio-theme-danger) !important;
                box-shadow: inset 3px 0 var(--lectio-theme-danger) !important;
            }

            html.${ROOT_CLASS} :where(h1, h2, h3, h4, legend, .ls-heading) {
                color: var(--lectio-theme-text) !important;
                letter-spacing: -.015em;
            }

            html.${ROOT_CLASS} :where(.muted, .ls-muted, small, .s2info) {
                color: var(--lectio-theme-muted) !important;
            }

            html.${ROOT_CLASS} ::selection {
                background: color-mix(in srgb, var(--lectio-theme-accent) 45%, transparent);
                color: var(--lectio-theme-text);
            }

            @media (prefers-reduced-motion: no-preference) {
                html.${ROOT_CLASS} :where(a, button, input, select, .s2skemabrik) {
                    transition: color 140ms ease, border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    async function importPalette() {
        let url;

        try {
            url = new URL(settings.sourceUrl);
            if (url.protocol !== 'https:') throw new Error('Use an https URL.');
        } catch (error) {
            showToast(error.message || 'Enter a valid https URL.', true);
            return;
        }

        showToast('Reading palette…');

        try {
            const response = await requestArrayBuffer(url.href);
            const contentType = getContentType(response.responseHeaders);
            let colours;

            if (contentType.startsWith('image/') || looksLikeImageUrl(url.pathname)) {
                colours = await sampleImageColours(response.response, contentType || 'image/png');
            } else {
                const html = new TextDecoder().decode(response.response);
                colours = await extractWebsiteColours(html, response.finalUrl || url.href);
            }

            if (colours.length < 2) {
                throw new Error('Not enough distinct colours were found. Try a direct image URL.');
            }

            settings.palette = derivePalette(colours);
            settings.preset = 'custom';
            saveSettings();
            applyTheme();
            announce();
            showToast(`Imported ${colours.length} source colours.`);
        } catch (error) {
            console.warn(LOG, 'Palette import failed:', error);
            showToast(error.message || 'Could not import that palette.', true);
        }
    }

    function chooseLocalImage() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            if (file.size > MAX_SOURCE_BYTES) {
                showToast('Palette images must be smaller than 8 MB.', true);
                return;
            }

            try {
                const colours = await sampleImageColours(await file.arrayBuffer(), file.type || 'image/png');
                if (colours.length < 2) throw new Error('Not enough distinct colours were found.');
                settings.palette = derivePalette(colours);
                settings.preset = 'custom';
                saveSettings();
                applyTheme();
                announce();
                showToast(`Imported ${colours.length} image colours.`);
            } catch (error) {
                console.warn(LOG, 'Local palette import failed:', error);
                showToast(error.message || 'Could not read that image.', true);
            }
        }, { once: true });
        input.click();
    }

    function requestArrayBuffer(url) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                callback(value);
            };
            const request = GM_xmlhttpRequest({
                method: 'GET', url, responseType: 'arraybuffer', timeout: 20000, anonymous: true, redirect: 'error',
                onprogress: (progress) => {
                    if (progress.loaded > MAX_SOURCE_BYTES || (progress.lengthComputable && progress.total > MAX_SOURCE_BYTES)) {
                        request.abort();
                        finish(reject, new Error('Palette sources must be smaller than 8 MB.'));
                    }
                },
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        finish(reject, new Error(`Palette source returned HTTP ${response.status}.`));
                        return;
                    }
                    try {
                        if (new URL(response.finalUrl || url).protocol !== 'https:') {
                            finish(reject, new Error('Palette sources must remain on HTTPS after redirects.'));
                            return;
                        }
                    } catch (_) {
                        finish(reject, new Error('The palette source returned an invalid final URL.'));
                        return;
                    }
                    if (!(response.response instanceof ArrayBuffer) || response.response.byteLength > MAX_SOURCE_BYTES) {
                        finish(reject, new Error('Palette sources must be smaller than 8 MB.'));
                        return;
                    }
                    finish(resolve, response);
                },
                onerror: () => finish(reject, new Error('The palette source could not be reached.')),
                ontimeout: () => finish(reject, new Error('The palette source timed out.'))
            });
        });
    }

    function getContentType(headers) {
        const match = String(headers || '').match(/^content-type:\s*([^;\r\n]+)/im);
        return match ? match[1].trim().toLowerCase() : '';
    }

    function looksLikeImageUrl(pathname) {
        return /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i.test(pathname);
    }

    async function sampleImageColours(buffer, contentType) {
        const blob = new Blob([buffer], { type: contentType });
        const image = await loadImage(blob);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const scale = Math.min(1, 96 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const counts = new Map();

        for (let index = 0; index < pixels.length; index += 16) {
            if (pixels[index + 3] < 180) continue;
            const rgb = [pixels[index], pixels[index + 1], pixels[index + 2]]
                .map((value) => Math.round(value / 24) * 24)
                .map((value) => clamp(value, 0, 255));
            const hex = rgbToHex(rgb);
            counts.set(hex, (counts.get(hex) || 0) + 1);
        }

        if (typeof image.close === 'function') image.close();
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 32).map(([colour]) => colour);
    }

    function loadImage(blob) {
        if ('createImageBitmap' in window) return createImageBitmap(blob);

        return new Promise((resolve, reject) => {
            const image = new Image();
            const objectUrl = URL.createObjectURL(blob);
            image.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('The image could not be decoded.'));
            };
            image.src = objectUrl;
        });
    }

    function extractDocumentColours(source) {
        const counts = new Map();
        const tokens = source.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || [];

        for (const token of tokens) {
            const hex = parseColour(token);
            if (!hex) continue;
            counts.set(hex, (counts.get(hex) || 0) + 1);
        }

        return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([colour]) => colour);
    }

    async function extractWebsiteColours(source, sourceUrl) {
        const colours = extractDocumentColours(source);
        const documentCopy = new DOMParser().parseFromString(source, 'text/html');
        const themeColour = parseColour(documentCopy.querySelector('meta[name="theme-color"]')?.content || '');
        if (themeColour) colours.unshift(themeColour);

        const stylesheetUrls = [...documentCopy.querySelectorAll('link[rel~="stylesheet"][href]')]
            .map((link) => {
                try {
                    const url = new URL(link.getAttribute('href'), sourceUrl);
                    return url.protocol === 'https:' ? url.href : null;
                } catch (_) {
                    return null;
                }
            })
            .filter(Boolean)
            .filter((value, index, all) => all.indexOf(value) === index)
            .slice(0, 6);

        const stylesheets = await Promise.allSettled(stylesheetUrls.map(requestArrayBuffer));
        for (const result of stylesheets) {
            if (result.status !== 'fulfilled') continue;
            const css = new TextDecoder().decode(result.value.response);
            colours.push(...extractDocumentColours(css));
        }

        return [...new Set(colours)];
    }

    function parseColour(token) {
        if (/^hsla?\(/i.test(token)) {
            const values = token.match(/[\d.]+/g)?.map(Number);
            if (!values || values.length < 3 || values[1] > 100 || values[2] > 100 || !hasVisibleAlpha(token, values)) return null;
            return rgbToHex(hslToRgb(values[0], values[1] / 100, values[2] / 100));
        }

        if (token.startsWith('#')) {
            let value = token.slice(1);
            if (value.length === 4 && Number.parseInt(value[3] + value[3], 16) < 128) return null;
            if (value.length === 8 && Number.parseInt(value.slice(6), 16) < 128) return null;
            if (value.length === 3 || value.length === 4) value = value.slice(0, 3).split('').map((part) => part + part).join('');
            if (value.length === 8) value = value.slice(0, 6);
            return value.length === 6 ? `#${value.toLowerCase()}` : null;
        }

        const values = token.match(/[\d.]+/g)?.map(Number);
        if (!values || values.length < 3 || values.slice(0, 3).some((value) => value > 255)) return null;
        if (!hasVisibleAlpha(token, values)) return null;
        return rgbToHex(values.slice(0, 3));
    }

    function hasVisibleAlpha(token, values) {
        const percentage = token.match(/\/\s*([\d.]+)%/);
        if (percentage) return Number(percentage[1]) >= 50;
        return values.length < 4 || values[3] >= .5;
    }

    function hslToRgb(hue, saturation, lightness) {
        const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
        const segment = ((hue % 360) + 360) % 360 / 60;
        const second = chroma * (1 - Math.abs(segment % 2 - 1));
        const choices = [
            [chroma, second, 0], [second, chroma, 0], [0, chroma, second],
            [0, second, chroma], [second, 0, chroma], [chroma, 0, second]
        ];
        const base = choices[Math.floor(segment) % 6];
        const match = lightness - chroma / 2;
        return base.map((value) => (value + match) * 255);
    }

    function derivePalette(colours) {
        const ranked = [...new Set(colours)].map((hex) => ({
            hex,
            rgb: hexToRgb(hex),
            light: relativeLightness(hexToRgb(hex)),
            saturation: colourSaturation(hexToRgb(hex))
        }));

        const darkest = ranked.reduce((best, item) => item.light < best.light ? item : best);
        const lightest = ranked.reduce((best, item) => item.light > best.light ? item : best);
        const vivid = ranked
            .filter((item) => item.light > .08 && item.light < .82 && item.saturation > .12)
            .sort((a, b) => (b.saturation * .75 + b.light * .25) - (a.saturation * .75 + a.light * .25));
        const fallbackAccent = {
            hex: PRESETS.graphite.accent,
            rgb: hexToRgb(PRESETS.graphite.accent)
        };
        const accent = vivid[0] || fallbackAccent;
        const accentAlt = vivid.find((item) => colourDistance(item.rgb, accent.rgb) > 90) || vivid[1] || accent;
        const background = mixHex(darkest.hex, '#05080d', darkest.light > .12 ? .7 : .25);
        const surface = mixHex(background, accent.hex, .10);

        return {
            background,
            surface,
            surfaceAlt: mixHex(surface, '#ffffff', .07),
            text: mixHex(lightest.hex, '#ffffff', .62),
            muted: mixHex(lightest.hex, background, .38),
            accent: ensureAccent(accent.hex, background),
            accentAlt: ensureAccent(accentAlt.hex, background),
            danger: '#ff6b81'
        };
    }

    function ensureAccent(colour, background) {
        return contrastRatio(colour, background) >= 3 ? colour : mixHex(colour, '#ffffff', .34);
    }

    function hexToRgb(hex) {
        const value = Number.parseInt(hex.slice(1), 16);
        return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    }

    function rgbToHex(rgb) {
        return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
    }

    function mixHex(a, b, amount) {
        const first = hexToRgb(a);
        const second = hexToRgb(b);
        return rgbToHex(first.map((value, index) => value + (second[index] - value) * amount));
    }

    function relativeLightness(rgb) {
        const channels = rgb.map((value) => {
            const channel = value / 255;
            return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    }

    function colourSaturation(rgb) {
        const max = Math.max(...rgb);
        const min = Math.min(...rgb);
        return max === 0 ? 0 : (max - min) / max;
    }

    function colourDistance(a, b) {
        return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));
    }

    function contrastRatio(a, b) {
        const first = relativeLightness(hexToRgb(a));
        const second = relativeLightness(hexToRgb(b));
        return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function showToast(message, isError = false) {
        const render = () => {
            document.getElementById('lectio-theme-toast')?.remove();
            const toast = document.createElement('div');
            toast.id = 'lectio-theme-toast';
            toast.textContent = message;
            Object.assign(toast.style, {
                position: 'fixed', right: '18px', bottom: '72px', zIndex: '999998',
                maxWidth: '300px', padding: '10px 13px', borderRadius: '10px',
                background: isError ? settings.palette.danger : settings.palette.surfaceAlt,
                color: settings.palette.text, border: `1px solid ${isError ? settings.palette.danger : settings.palette.accent}`,
                boxShadow: '0 10px 28px rgba(0,0,0,.32)', font: '600 12px Roboto, Arial, sans-serif'
            });
            document.body.appendChild(toast);
            window.setTimeout(() => toast.remove(), isError ? 5000 : 3000);
        };

        if (document.body) render();
        else document.addEventListener('DOMContentLoaded', render, { once: true });
    }
})();
