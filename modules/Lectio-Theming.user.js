// ==UserScript==
// @name         Lectio Theming
// @namespace    https://www.lectio.dk/
// @version      0.8.0
// @description  Gives Lectio a soft, translucent glass shell with 26 built-in colour schemes (Catppuccin, Nord, Dracula, Cyberpunk and more), each with its own distinct background photo, and can derive a scheme from a website or image.
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
    const MODULE_VERSION = '0.8.0';
    const STORAGE_KEY = 'lectioTheming.settings.v2';
    const STYLE_ID = 'lectio-theming-styles';
    const ROOT_CLASS = 'lectio-themed';
    const LOG = '[Lectio Theming]';
    const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
    const MODE_KEYS = ['light', 'dark'];
    // Self-hosted so nothing goes stale and no third-party image host sees a
    // viewer's IP on every page load. One real photo per background pattern
    // family; see assets/theming/CREDITS.md for source/licence details.
    const ASSET_BASE_URL = 'https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/assets/theming';
    // Lectio's own page shell — scoping link/form-control rules to live
    // inside this (rather than excluding known sibling-module IDs one by
    // one) means any other module's floating UI (appended straight to
    // <body>, outside this shell) is never touched, without this module
    // needing to know that other module exists.
    const CONTENT_ROOT_SELECTOR = '#masterContent, #content, #m_Content, .ls-master-container, .ls-content-container';

    // Named themes carry their own authentic background/surface/text values,
    // so they keep their real character (a dark theme is meant to be dark).
    // "mode" only drives color-scheme + which background pattern family suits
    // it; "pattern" picks a shared, parameterised CSS background generator
    // below rather than hot-linking an external photo (nothing to go stale,
    // nothing that leaks a viewer's IP to a third-party image host).
    const THEMES = Object.freeze({
        'catppuccin-latte': {
            label: 'Catppuccin Latte', mode: 'light', pattern: 'blobs',
            background: '#eff1f5', surface: '#ffffff', surfaceAlt: '#e6e9ef',
            text: '#4c4f69', muted: '#6c6f85', accent: '#1e66f5', accentAlt: '#8839ef', danger: '#d20f39'
        },
        'gruvbox-light': {
            label: 'Gruvbox Light', mode: 'light', pattern: 'blobs',
            background: '#fbf1c7', surface: '#f9f5d7', surfaceAlt: '#ebdbb2',
            text: '#3c3836', muted: '#7c6f64', accent: '#076678', accentAlt: '#427b58', danger: '#9d0006'
        },
        'solarized-light': {
            label: 'Solarized Light', mode: 'light', pattern: 'blobs',
            background: '#fdf6e3', surface: '#f7f0da', surfaceAlt: '#eee8d5',
            text: '#657b83', muted: '#93a1a1', accent: '#268bd2', accentAlt: '#2aa198', danger: '#dc322f'
        },
        'rose-pine-dawn': {
            label: 'Rosé Pine Dawn', mode: 'light', pattern: 'blobs',
            background: '#faf4ed', surface: '#fffaf3', surfaceAlt: '#f2e9e1',
            text: '#575279', muted: '#9893a5', accent: '#907aa9', accentAlt: '#56949f', danger: '#b4637a'
        },
        'everforest-light': {
            label: 'Everforest Light', mode: 'light', pattern: 'blobs',
            background: '#fdf6e3', surface: '#f4f0d9', surfaceAlt: '#efebd4',
            text: '#5c6a72', muted: '#939f91', accent: '#8da101', accentAlt: '#35a77c', danger: '#f85552'
        },
        'github-light': {
            label: 'GitHub Light', mode: 'light', pattern: 'blobs',
            background: '#ffffff', surface: '#f6f8fa', surfaceAlt: '#eaeef2',
            text: '#1f2328', muted: '#656d76', accent: '#0969da', accentAlt: '#8250df', danger: '#d1242f'
        },
        nord: {
            label: 'Nord', mode: 'dark', pattern: 'waves',
            background: '#2e3440', surface: '#3b4252', surfaceAlt: '#434c5e',
            text: '#eceff4', muted: '#9aa5b1', accent: '#88c0d0', accentAlt: '#81a1c1', danger: '#bf616a'
        },
        'rose-pine': {
            label: 'Rosé Pine', mode: 'dark', pattern: 'waves',
            background: '#191724', surface: '#1f1d2e', surfaceAlt: '#26233a',
            text: '#e0def4', muted: '#6e6a86', accent: '#c4a7e7', accentAlt: '#9ccfd8', danger: '#eb6f92'
        },
        'everforest-dark': {
            label: 'Everforest Dark', mode: 'dark', pattern: 'waves',
            background: '#2d353b', surface: '#343f44', surfaceAlt: '#3d484d',
            text: '#d3c6aa', muted: '#859289', accent: '#a7c080', accentAlt: '#83c092', danger: '#e67e80'
        },
        kanagawa: {
            label: 'Kanagawa', mode: 'dark', pattern: 'waves',
            background: '#1f1f28', surface: '#2a2a37', surfaceAlt: '#363646',
            text: '#dcd7ba', muted: '#727169', accent: '#7e9cd8', accentAlt: '#957fb8', danger: '#c34043'
        },
        'tokyo-night': {
            label: 'Tokyo Night', mode: 'dark', pattern: 'waves',
            background: '#1a1b26', surface: '#24283b', surfaceAlt: '#292e42',
            text: '#c0caf5', muted: '#565f89', accent: '#7aa2f7', accentAlt: '#bb9af7', danger: '#f7768e'
        },
        dracula: {
            label: 'Dracula', mode: 'dark', pattern: 'waves',
            background: '#282a36', surface: '#343746', surfaceAlt: '#44475a',
            text: '#f8f8f2', muted: '#6272a4', accent: '#bd93f9', accentAlt: '#ff79c6', danger: '#ff5555'
        },
        'catppuccin-mocha': {
            label: 'Catppuccin Mocha', mode: 'dark', pattern: 'grid',
            background: '#1e1e2e', surface: '#181825', surfaceAlt: '#313244',
            text: '#cdd6f4', muted: '#a6adc8', accent: '#89b4fa', accentAlt: '#cba6f7', danger: '#f38ba8'
        },
        'catppuccin-frappe': {
            label: 'Catppuccin Frappé', mode: 'dark', pattern: 'grid',
            background: '#303446', surface: '#292c3c', surfaceAlt: '#414559',
            text: '#c6d0f5', muted: '#a5adce', accent: '#8caaee', accentAlt: '#ca9ee6', danger: '#e78284'
        },
        'catppuccin-macchiato': {
            label: 'Catppuccin Macchiato', mode: 'dark', pattern: 'grid',
            background: '#24273a', surface: '#1e2030', surfaceAlt: '#363a4f',
            text: '#cad3f5', muted: '#a5adcb', accent: '#8aadf4', accentAlt: '#c6a0f6', danger: '#ed8796'
        },
        'gruvbox-dark': {
            label: 'Gruvbox Dark', mode: 'dark', pattern: 'grid',
            background: '#282828', surface: '#3c3836', surfaceAlt: '#504945',
            text: '#ebdbb2', muted: '#928374', accent: '#fe8019', accentAlt: '#8ec07c', danger: '#fb4934'
        },
        'solarized-dark': {
            label: 'Solarized Dark', mode: 'dark', pattern: 'grid',
            background: '#002b36', surface: '#073642', surfaceAlt: '#0a4a57',
            text: '#93a1a1', muted: '#586e75', accent: '#268bd2', accentAlt: '#2aa198', danger: '#dc322f'
        },
        'one-dark': {
            label: 'One Dark', mode: 'dark', pattern: 'grid',
            background: '#282c34', surface: '#2c313a', surfaceAlt: '#3e4451',
            text: '#abb2bf', muted: '#5c6370', accent: '#61afef', accentAlt: '#c678dd', danger: '#e06c75'
        },
        'monokai-pro': {
            label: 'Monokai Pro', mode: 'dark', pattern: 'grid',
            background: '#2d2a2e', surface: '#403e41', surfaceAlt: '#4a474a',
            text: '#fcfcfa', muted: '#939293', accent: '#a9dc76', accentAlt: '#ab9df2', danger: '#ff6188'
        },
        'ayu-dark': {
            label: 'Ayu Dark', mode: 'dark', pattern: 'grid',
            background: '#0a0e14', surface: '#0d1420', surfaceAlt: '#131721',
            text: '#b3b1ad', muted: '#5c6773', accent: '#ffb454', accentAlt: '#59c2ff', danger: '#f07178'
        },
        'ayu-mirage': {
            label: 'Ayu Mirage', mode: 'dark', pattern: 'grid',
            background: '#1f2430', surface: '#232834', surfaceAlt: '#2b3040',
            text: '#cbccc6', muted: '#707a8c', accent: '#ffcc66', accentAlt: '#5ccfe6', danger: '#f28779'
        },
        nightfox: {
            label: 'Nightfox', mode: 'dark', pattern: 'grid',
            background: '#192330', surface: '#212e3f', surfaceAlt: '#29394f',
            text: '#cdcecf', muted: '#71839b', accent: '#719cd6', accentAlt: '#63cdcf', danger: '#c94f6d'
        },
        oxocarbon: {
            label: 'Oxocarbon', mode: 'dark', pattern: 'grid',
            background: '#161616', surface: '#262626', surfaceAlt: '#393939',
            text: '#f2f4f8', muted: '#8d8d8d', accent: '#3ddbd9', accentAlt: '#be95ff', danger: '#ff8389'
        },
        'material-ocean': {
            label: 'Material Ocean', mode: 'dark', pattern: 'grid',
            background: '#0f111a', surface: '#181a24', surfaceAlt: '#1f2233',
            text: '#a6accd', muted: '#4b526d', accent: '#82aaff', accentAlt: '#c792ea', danger: '#ff5370'
        },
        cyberpunk: {
            label: 'Cyberpunk Neon', mode: 'dark', pattern: 'scanlines',
            background: '#0b0014', surface: '#150022', surfaceAlt: '#1f0233',
            text: '#f4e8ff', muted: '#9d7bb0', accent: '#ff2bd6', accentAlt: '#00f0ff', danger: '#ff003c'
        },
        synthwave84: {
            label: "Synthwave '84", mode: 'dark', pattern: 'scanlines',
            background: '#241b2f', surface: '#2a2139', surfaceAlt: '#34294f',
            text: '#f6eff5', muted: '#848bbd', accent: '#ff7edb', accentAlt: '#36f9f6', danger: '#fe4450'
        }
    });

    const THEME_KEYS = Object.keys(THEMES);
    const PRESET_KEYS = [...THEME_KEYS, 'custom'];
    const PRESET_OPTIONS = [
        ...THEME_KEYS.map((key) => ({
            value: key,
            label: `${THEMES[key].label} — ${THEMES[key].mode === 'dark' ? 'Dark' : 'Light'}`
        })),
        { value: 'custom', label: 'Imported palette' }
    ];

    // Neutral bases for the imported/custom palette only — named themes above
    // never touch these, they carry their own authentic colours.
    const CUSTOM_BASE = Object.freeze({
        light: { background: '#f6f5fb', surface: '#ffffff', surfaceAlt: '#eceffb', text: '#20243a', muted: '#5b6178' },
        dark: { background: '#14161f', surface: '#1c1f2b', surfaceAlt: '#242840', text: '#e5e7f0', muted: '#8890a8' }
    });
    const CUSTOM_FALLBACK_HUES = Object.freeze({ accent: '#4fb0a6', accentAlt: '#8b8fe8', danger: '#e0596b' });

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        preset: 'catppuccin-latte',
        mode: 'light',
        sourceUrl: '',
        radius: 12,
        blur: true,
        density: 'compact',
        customHues: null
    });

    let settings = loadSettings();
    let currentPalette = resolvePalette(settings.preset, settings.mode, settings.customHues);

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
                        key: 'preset', type: 'select', label: 'Theme',
                        description: 'Pick a built-in colour scheme, or Imported palette for your own colours.',
                        options: PRESET_OPTIONS
                    },
                    {
                        key: 'mode', type: 'select', label: 'Light or dark (imported palette)',
                        description: 'Only affects the imported palette below — built-in themes keep their own light or dark look.',
                        options: [
                            { value: 'light', label: 'Light' },
                            { value: 'dark', label: 'Dark' }
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
                        description: 'Restore the Catppuccin Latte defaults.', buttonLabel: 'Reset'
                    }
                ],
                currentValues: {
                    enabled: settings.enabled,
                    preset: settings.preset,
                    mode: settings.mode,
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
            case 'mode':
                if (!MODE_KEYS.includes(detail.value)) return;
                settings.mode = detail.value;
                break;
            case 'preset':
                if (!PRESET_KEYS.includes(detail.value)) return;
                settings.preset = detail.value;
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

            return {
                enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_SETTINGS.enabled,
                preset: PRESET_KEYS.includes(saved.preset) ? saved.preset : DEFAULT_SETTINGS.preset,
                mode: MODE_KEYS.includes(saved.mode) ? saved.mode : DEFAULT_SETTINGS.mode,
                sourceUrl: typeof saved.sourceUrl === 'string' ? saved.sourceUrl : '',
                radius: clamp(Number(saved.radius) || DEFAULT_SETTINGS.radius, 4, 20),
                blur: typeof saved.blur === 'boolean' ? saved.blur : DEFAULT_SETTINGS.blur,
                density: ['compact', 'comfortable'].includes(saved.density) ? saved.density : DEFAULT_SETTINGS.density,
                customHues: validateHues(saved.customHues)
            };
        } catch (_) {
            return cloneDefaults();
        }
    }

    function cloneDefaults() {
        return { ...DEFAULT_SETTINGS, customHues: null };
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (error) {
            console.warn(LOG, 'Could not save settings:', error);
        }
    }

    function validateHues(value) {
        const keys = ['accent', 'accentAlt', 'danger'];
        return value && keys.every((key) => /^#[0-9a-f]{6}$/i.test(value[key] || ''))
            ? Object.fromEntries(keys.map((key) => [key, value[key]]))
            : null;
    }

    function resolvePalette(preset, mode, customHues) {
        const theme = THEMES[preset];

        if (theme) {
            return {
                background: theme.background, surface: theme.surface, surfaceAlt: theme.surfaceAlt,
                text: theme.text, muted: theme.muted, accent: theme.accent, accentAlt: theme.accentAlt,
                danger: theme.danger, blend: mixHex(theme.accent, theme.accentAlt, .5),
                mode: theme.mode, pattern: theme.pattern, image: `bg-${preset}.jpg`
            };
        }

        const base = CUSTOM_BASE[mode] || CUSTOM_BASE.light;
        const hues = customHues || CUSTOM_FALLBACK_HUES;
        const ensureAccent = mode === 'dark' ? ensureAccentOnDark : ensureAccentOnLight;
        const pattern = mode === 'dark' ? 'grid' : 'blobs';

        return {
            background: base.background, surface: base.surface, surfaceAlt: base.surfaceAlt,
            text: base.text, muted: base.muted,
            accent: ensureAccent(hues.accent, base.background),
            accentAlt: ensureAccent(hues.accentAlt, base.background),
            danger: hues.danger,
            blend: mixHex(hues.accent, hues.accentAlt, .5),
            mode, pattern, image: `bg-${pattern}.jpg`
        };
    }

    function applyTheme() {
        const root = document.documentElement;
        root.classList.toggle(ROOT_CLASS, settings.enabled);
        root.classList.toggle('lectio-theme-blur', settings.blur);
        root.dataset.lectioThemeDensity = settings.density;

        currentPalette = resolvePalette(settings.preset, settings.mode, settings.customHues);
        root.dataset.lectioThemePattern = currentPalette.pattern;
        root.style.colorScheme = currentPalette.mode === 'dark' ? 'dark' : 'light';

        const variables = {
            '--lectio-theme-bg': currentPalette.background,
            '--lectio-theme-surface': currentPalette.surface,
            '--lectio-theme-surface-alt': currentPalette.surfaceAlt,
            '--lectio-theme-text': currentPalette.text,
            '--lectio-theme-muted': currentPalette.muted,
            '--lectio-theme-accent': currentPalette.accent,
            '--lectio-theme-accent-alt': currentPalette.accentAlt,
            '--lectio-theme-blend': currentPalette.blend,
            '--lectio-theme-danger': currentPalette.danger,
            '--lectio-theme-bg-image': `url('${ASSET_BASE_URL}/${currentPalette.image}')`,
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
                --lectio-theme-bg: #eff1f5;
                --lectio-theme-surface: #ffffff;
                --lectio-theme-surface-alt: #e6e9ef;
                --lectio-theme-text: #4c4f69;
                --lectio-theme-muted: #6c6f85;
                --lectio-theme-accent: #1e66f5;
                --lectio-theme-accent-alt: #8839ef;
                --lectio-theme-blend: #5152ba;
                --lectio-theme-danger: #d20f39;
                --lectio-theme-radius: 12px;
                --lectio-theme-space: 6px;
            }

            html.${ROOT_CLASS},
            html.${ROOT_CLASS} body {
                background: var(--lectio-theme-bg) !important;
                color: var(--lectio-theme-text) !important;
            }

            html.${ROOT_CLASS}[data-lectio-theme-pattern] body {
                background-attachment: fixed !important;
                background-repeat: no-repeat !important;
                background-position: center !important;
                background-size: cover !important;
            }

            html.${ROOT_CLASS}[data-lectio-theme-pattern="blobs"] body {
                background-image:
                    radial-gradient(circle at 10% -10%, color-mix(in srgb, var(--lectio-theme-accent) 22%, transparent), transparent 40rem),
                    radial-gradient(circle at 105% 8%, color-mix(in srgb, var(--lectio-theme-accent-alt) 20%, transparent), transparent 38rem),
                    radial-gradient(circle at 40% 118%, color-mix(in srgb, var(--lectio-theme-blend) 16%, transparent), transparent 46rem),
                    linear-gradient(color-mix(in srgb, var(--lectio-theme-bg) 62%, transparent), color-mix(in srgb, var(--lectio-theme-bg) 62%, transparent)),
                    var(--lectio-theme-bg-image) !important;
            }

            html.${ROOT_CLASS}[data-lectio-theme-pattern="waves"] body {
                background-image:
                    linear-gradient(125deg, color-mix(in srgb, var(--lectio-theme-accent) 14%, transparent) 0%, transparent 45%),
                    linear-gradient(-115deg, color-mix(in srgb, var(--lectio-theme-accent-alt) 12%, transparent) 10%, transparent 55%),
                    radial-gradient(circle at 30% 15%, color-mix(in srgb, var(--lectio-theme-blend) 16%, transparent), transparent 50rem),
                    linear-gradient(color-mix(in srgb, var(--lectio-theme-bg) 60%, transparent), color-mix(in srgb, var(--lectio-theme-bg) 60%, transparent)),
                    var(--lectio-theme-bg-image) !important;
            }

            html.${ROOT_CLASS}[data-lectio-theme-pattern="grid"] body {
                background-image:
                    repeating-linear-gradient(0deg, color-mix(in srgb, var(--lectio-theme-accent) 6%, transparent) 0px, transparent 1px, transparent 42px),
                    repeating-linear-gradient(90deg, color-mix(in srgb, var(--lectio-theme-accent) 6%, transparent) 0px, transparent 1px, transparent 42px),
                    radial-gradient(circle at 20% -10%, color-mix(in srgb, var(--lectio-theme-accent-alt) 14%, transparent), transparent 44rem),
                    linear-gradient(color-mix(in srgb, var(--lectio-theme-bg) 64%, transparent), color-mix(in srgb, var(--lectio-theme-bg) 64%, transparent)),
                    var(--lectio-theme-bg-image) !important;
            }

            html.${ROOT_CLASS}[data-lectio-theme-pattern="scanlines"] body {
                background-image:
                    repeating-linear-gradient(180deg, color-mix(in srgb, var(--lectio-theme-text) 5%, transparent) 0px, transparent 2px, transparent 5px),
                    radial-gradient(circle at 15% 0%, color-mix(in srgb, var(--lectio-theme-accent) 26%, transparent), transparent 42rem),
                    radial-gradient(circle at 100% 10%, color-mix(in srgb, var(--lectio-theme-accent-alt) 22%, transparent), transparent 40rem),
                    linear-gradient(0deg, color-mix(in srgb, var(--lectio-theme-accent) 16%, transparent) 0%, transparent 30%),
                    linear-gradient(color-mix(in srgb, var(--lectio-theme-bg) 50%, transparent), color-mix(in srgb, var(--lectio-theme-bg) 50%, transparent)),
                    var(--lectio-theme-bg-image) !important;
            }

            html.${ROOT_CLASS} :where(#masterContent, #content, #m_Content, .ls-master-container, .ls-content-container,
                [class*="ls-card"], [class*="ls-island"], fieldset, .s2skemabrikcontainer, .s2skemabrik, .s2day, .s2weekHeader) {
                border-radius: var(--lectio-theme-radius) !important;
            }

            html.${ROOT_CLASS} :where(#masterContent, #content, #m_Content, .ls-master-container, .ls-content-container) {
                background: color-mix(in srgb, var(--lectio-theme-surface) 55%, transparent) !important;
                color: var(--lectio-theme-text) !important;
            }

            html.${ROOT_CLASS} :where([class*="ls-card"], [class*="ls-island"], fieldset, .s2skemabrikcontainer, .s2day, .s2weekHeader) {
                border: 1px solid color-mix(in srgb, var(--lectio-theme-accent) 10%, transparent) !important;
            }

            html.${ROOT_CLASS} :where([class*="ls-card"], [class*="ls-island"], fieldset, .s2skemabrikcontainer, .s2day, table) {
                color: var(--lectio-theme-text);
            }

            html.${ROOT_CLASS} :where(table, tbody, tr, td, th) {
                background-color: transparent !important;
                border: none !important;
            }

            html.${ROOT_CLASS} table {
                background: color-mix(in srgb, var(--lectio-theme-surface) 55%, transparent) !important;
                color: var(--lectio-theme-text);
            }

            html.${ROOT_CLASS} :where(th, tr:nth-child(even) > td) {
                background: color-mix(in srgb, var(--lectio-theme-surface-alt) 40%, transparent) !important;
            }

            html.${ROOT_CLASS} :where([class*="ls-card"], [class*="ls-island"], fieldset, .s2skemabrikcontainer) {
                background: color-mix(in srgb, var(--lectio-theme-surface) 55%, transparent) !important;
                box-shadow: 0 8px 22px color-mix(in srgb, var(--lectio-theme-muted) 18%, transparent), inset 0 1px color-mix(in srgb, var(--lectio-theme-text) 6%, transparent);
                padding: var(--lectio-theme-space);
            }

            html.${ROOT_CLASS} :where(#s_m_masterleftDiv, .ls-master-header, .ls-top-nav, .ls-master-pageheader, #s_m_mastermenu, .lectioToolbar) {
                background: color-mix(in srgb, var(--lectio-theme-surface) 62%, transparent) !important;
                border: 1px solid color-mix(in srgb, var(--lectio-theme-accent) 10%, transparent) !important;
                color: var(--lectio-theme-text) !important;
                box-shadow: 0 10px 24px color-mix(in srgb, var(--lectio-theme-muted) 20%, transparent);
            }

            html.${ROOT_CLASS}.lectio-theme-blur :where(#s_m_masterleftDiv, .ls-master-header, .ls-top-nav, #s_m_mastermenu, .lectioToolbar, [class*="ls-card"], [class*="ls-island"]) {
                backdrop-filter: blur(18px) saturate(130%);
            }

            html.${ROOT_CLASS} :where(.s2infoHeader, .ls-mobil-menu, .ls-mobil-mere-sheet-menu) {
                background: color-mix(in srgb, var(--lectio-theme-surface) 60%, transparent) !important;
                color: var(--lectio-theme-text) !important;
                border-color: color-mix(in srgb, var(--lectio-theme-muted) 20%, transparent) !important;
            }

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :where(a, .ls-link) {
                color: var(--lectio-theme-accent) !important;
                text-decoration-color: color-mix(in srgb, var(--lectio-theme-accent) 45%, transparent);
            }

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :where(a:hover, .ls-link:hover) {
                color: color-mix(in srgb, var(--lectio-theme-accent) 75%, var(--lectio-theme-text)) !important;
            }

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :where(input, select, textarea, button, .button, .ls-button) {
                border: 1px solid color-mix(in srgb, var(--lectio-theme-muted) 28%, transparent) !important;
                border-radius: max(6px, calc(var(--lectio-theme-radius) - 4px)) !important;
                background: color-mix(in srgb, var(--lectio-theme-surface-alt) 65%, transparent) !important;
                color: var(--lectio-theme-text) !important;
                padding: var(--lectio-theme-space);
            }

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :where(button, .button, .ls-button):hover {
                border-color: var(--lectio-theme-accent) !important;
                box-shadow: 0 0 0 2px color-mix(in srgb, var(--lectio-theme-accent) 16%, transparent);
            }

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :where(input, select, textarea):focus {
                outline: 2px solid color-mix(in srgb, var(--lectio-theme-accent) 55%, transparent) !important;
                outline-offset: 1px;
            }

            html.${ROOT_CLASS} :where(.ls-paper, .lc-display-fragment) {
                background: color-mix(in srgb, var(--lectio-theme-surface) 65%, transparent) !important;
                color: var(--lectio-theme-text) !important;
            }

            html.${ROOT_CLASS} :where(.ls-toolbarMenuInnerContainer, .ls-std-toolbar-filled) {
                background: color-mix(in srgb, var(--lectio-theme-surface-alt) 55%, transparent) !important;
                color: var(--lectio-theme-text) !important;
            }

            html.${ROOT_CLASS} .s2module-bg {
                background: color-mix(in srgb, var(--lectio-theme-surface) 40%, transparent) !important;
                border-top: 1px solid color-mix(in srgb, var(--lectio-theme-muted) 14%, transparent) !important;
                border-bottom: 1px solid color-mix(in srgb, var(--lectio-theme-muted) 14%, transparent) !important;
            }

            html.${ROOT_CLASS} .s2time-off {
                background: color-mix(in srgb, var(--lectio-theme-muted) 14%, transparent) !important;
            }

            html.${ROOT_CLASS} .s2module-info {
                color: var(--lectio-theme-muted) !important;
            }

            html.${ROOT_CLASS} :where(.s2skemabrik, a.s2skemabrik.s2brik) {
                background: color-mix(in srgb, var(--lectio-theme-surface-alt) 68%, transparent) !important;
                color: var(--lectio-theme-text) !important;
                border: 1px solid color-mix(in srgb, var(--lectio-theme-accent-alt) 14%, transparent) !important;
                border-radius: max(5px, calc(var(--lectio-theme-radius) - 5px)) !important;
                box-shadow: inset 3px 0 color-mix(in srgb, var(--lectio-theme-accent-alt) 55%, transparent), 0 3px 10px color-mix(in srgb, var(--lectio-theme-muted) 16%, transparent);
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
                background: color-mix(in srgb, var(--lectio-theme-accent) 35%, transparent);
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

            settings.customHues = deriveHues(colours);
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
                settings.customHues = deriveHues(colours);
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

    function deriveHues(colours) {
        const ranked = [...new Set(colours)].map((hex) => ({
            hex,
            rgb: hexToRgb(hex),
            light: relativeLightness(hexToRgb(hex)),
            saturation: colourSaturation(hexToRgb(hex))
        }));

        const vivid = ranked
            .filter((item) => item.light > .08 && item.light < .82 && item.saturation > .12)
            .sort((a, b) => (b.saturation * .75 + b.light * .25) - (a.saturation * .75 + a.light * .25));
        const accent = vivid[0]?.hex || CUSTOM_FALLBACK_HUES.accent;
        const accentAlt = vivid.find((item) => colourDistance(item.rgb, hexToRgb(accent)) > 90)?.hex
            || vivid[1]?.hex
            || CUSTOM_FALLBACK_HUES.accentAlt;

        return { accent, accentAlt, danger: CUSTOM_FALLBACK_HUES.danger };
    }

    function ensureAccentOnLight(colour, background) {
        let result = colour;
        let guard = 0;
        while (contrastRatio(result, background) < 3.2 && guard < 6) {
            result = mixHex(result, '#000000', .18);
            guard += 1;
        }
        return result;
    }

    function ensureAccentOnDark(colour, background) {
        let result = colour;
        let guard = 0;
        while (contrastRatio(result, background) < 3 && guard < 6) {
            result = mixHex(result, '#ffffff', .18);
            guard += 1;
        }
        return result;
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
                background: isError ? currentPalette.danger : currentPalette.surfaceAlt,
                color: currentPalette.text, border: `1px solid ${isError ? currentPalette.danger : currentPalette.accent}`,
                boxShadow: '0 10px 28px rgba(0,0,0,.24)', font: '600 12px Roboto, Arial, sans-serif'
            });
            document.body.appendChild(toast);
            window.setTimeout(() => toast.remove(), isError ? 5000 : 3000);
        };

        if (document.body) render();
        else document.addEventListener('DOMContentLoaded', render, { once: true });
    }
})();
