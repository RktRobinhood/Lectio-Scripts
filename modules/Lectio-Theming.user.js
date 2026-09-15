// ==UserScript==
// @name         Lectio Theming
// @namespace    https://www.lectio.dk/
// @version      0.15.0
// @description  Gives Lectio a soft, translucent glass shell with 26 built-in colour schemes (Catppuccin, Nord, Dracula, Cyberpunk and more), each with its own distinct background photo, and can derive a scheme from a website or image, take its background from your own picture, and let you hand-pick every key colour.
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
    const MODULE_VERSION = '0.15.0';
    const STORAGE_KEY = 'lectioTheming.settings.v2';
    // The chosen background picture lives in its own entry rather than in the
    // settings blob: it is orders of magnitude larger than every other setting
    // put together, and keeping it apart means an ordinary settings save never
    // re-serialises a megabyte of image data.
    const BACKGROUND_STORAGE_KEY = 'lectioTheming.background.v1';
    const STYLE_ID = 'lectio-theming-styles';
    const ROOT_CLASS = 'lectio-themed';
    const LOG = '[Lectio Theming]';
    const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
    // A chosen background is re-encoded before it is stored. A phone photo is
    // both far more data than localStorage will hold and far more pixels than
    // a page background needs — and a browser pays for an oversized
    // fixed-attachment background on every single scroll. Each step is tried
    // in turn until one fits the budget below.
    const BACKGROUND_STEPS = Object.freeze([
        { size: 1920, quality: .82 }, { size: 1600, quality: .74 },
        { size: 1280, quality: .66 }, { size: 1024, quality: .58 }
    ]);
    // A data URL carries ~4 bytes for every 3 it encodes, and an origin's
    // whole localStorage is typically about 5 MB — shared with every other
    // module's settings. Stay well inside that.
    const MAX_BACKGROUND_CHARS = 2 * 1024 * 1024;
    const MAX_BACKGROUND_SOURCE_BYTES = 32 * 1024 * 1024;
    const MAX_VEIL = 80;
    const MODE_KEYS = ['light', 'dark'];
    // Which palette colour each generic colour control edits. The Manager
    // knows none of this: it just renders a colour control per key.
    const COLOUR_SETTING_KEYS = Object.freeze({
        colourBackground: 'background', colourText: 'text',
        colourAccent: 'accent', colourAccentAlt: 'accentAlt'
    });
    const COLOUR_KEYS = Object.freeze(Object.values(COLOUR_SETTING_KEYS));
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
    const CHOICE_CONTROL_SELECTOR = 'input[type="checkbox"], input[type="radio"]';
    const DIALOG_CLOSE_SELECTOR = '.ui-dialog .ui-dialog-titlebar-close';
    // The boxes Lectio nests inside its content shell to hold actual content:
    // cards, paper/read-mode surfaces, sections and schedule slots. Listed once
    // because both the "a box inside a box adds no second veil" rule and the
    // frost rule below need the same set. Layout tables are deliberately not in
    // here: they are structure rather than content, and a card inside one keeps
    // its own surface (see the rule that drops a table's veil instead).
    const FROSTED_CONTENT_BOX_SELECTOR = '[class*="ls-card"], [class*="ls-island"], fieldset, .ls-paper, .lc-display-fragment';
    const CONTENT_BOX_SELECTOR = `${FROSTED_CONTENT_BOX_SELECTOR}, .s2skemabrikcontainer`;
    // Shared theming seam (see ADR-0006): any other module may read these
    // same custom properties, with its own fallback in var(--name, fallback),
    // to follow the active theme without depending on this module being
    // installed. Listed once so applyTheme() can also clear all of them
    // cleanly when the theme is switched off.
    const THEME_VARIABLE_NAMES = [
        '--lectio-theme-bg', '--lectio-theme-surface', '--lectio-theme-surface-alt',
        '--lectio-theme-text', '--lectio-theme-muted', '--lectio-theme-accent',
        '--lectio-theme-accent-alt', '--lectio-theme-blend', '--lectio-theme-danger',
        '--lectio-theme-bg-image', '--lectio-theme-radius', '--lectio-theme-space'
    ];
    // Surface and background treatment, internal to this module rather than
    // part of the ADR-0006 seam: it lets the stylesheet below say "a thin veil
    // for the page shell, a little more body for the boxes inside it" in one
    // place, lets applyTheme() thin and tint those surfaces per palette mode,
    // and carries how strongly the palette is laid over a user's own
    // background picture. Cleared alongside the seam variables whenever the
    // theme is switched off.
    const CONTENT_SURFACE_VARIABLE_NAMES = [
        '--lectio-theme-shell-surface', '--lectio-theme-content-surface',
        '--lectio-theme-content-stripe', '--lectio-theme-bg-veil'
    ];

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
        { value: 'custom', label: 'Custom palette' }
    ];

    // Neutral starting point for the custom palette only — named themes above
    // never touch these, they carry their own authentic colours. Once any
    // colour is imported or hand-picked, settings.customColours carries the
    // whole custom palette and these are only the base a reset returns to.
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
        customColours: null,
        backgroundVeil: 35
    });

    let settings = loadSettings();
    let customBackground = loadCustomBackground();
    let currentPalette = resolvePalette(settings.preset, settings.mode, settings.customColours);
    // One load listener per editor frame for that frame's whole lifetime, and
    // one re-theming pass per batch of DOM changes. Both matter on a page that
    // stays open all day: CKEditor re-inserts its iframe on every postback, so
    // attaching a listener each time one was seen left a growing pile of
    // handlers on the same element, and re-theming once per added node meant
    // walking the document hundreds of times for a single batch.
    const watchedEditorFrames = new WeakSet();
    let editorFrameTimer = 0;
    let toastTimer = 0;

    announce();
    applyTheme();
    observeEditorFrames();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', themeEditorFrames);
    }
    window.addEventListener('load', themeEditorFrames);

    window.addEventListener('lectio-manager:discover', announce);
    window.addEventListener('lectio-manager:set-setting', handleSetting);
    window.addEventListener('lectio-manager:preview-setting', handleSettingPreview);
    window.addEventListener('lectio-manager:clear-setting-preview', handleSettingPreviewClear);

    function announce() {
        const colours = currentCustomColours();

        window.dispatchEvent(new CustomEvent('lectio-module:register', {
            detail: {
                id: MODULE_ID,
                name: MODULE_NAME,
                version: MODULE_VERSION,
                settingsSchema: [
                    {
                        key: 'enabled', type: 'toggle', label: 'Theme enabled', section: 'Theme',
                        description: 'Switch the visual layer on or off.'
                    },
                    {
                        key: 'preset', type: 'select', label: 'Theme', section: 'Theme',
                        description: 'Hover to preview a built-in colour scheme, then choose it to keep it.',
                        previewOnHover: true,
                        options: PRESET_OPTIONS
                    },
                    {
                        key: 'mode', type: 'select', label: 'Light or dark base', section: 'Custom palette',
                        description: 'The starting point for the custom palette — built-in themes keep their own light or dark look.',
                        options: [
                            { value: 'light', label: 'Light' },
                            { value: 'dark', label: 'Dark' }
                        ]
                    },
                    {
                        key: 'colourBackground', type: 'color', label: 'Page colour', section: 'Custom palette',
                        description: 'Pick the colour behind everything. Choosing any colour here switches to the custom palette.'
                    },
                    {
                        key: 'colourText', type: 'color', label: 'Text colour', section: 'Custom palette',
                        description: 'Darkened or lightened automatically if the pair would be hard to read.'
                    },
                    {
                        key: 'colourAccent', type: 'color', label: 'Accent colour', section: 'Custom palette',
                        description: 'Links, buttons, highlights and focus rings.'
                    },
                    {
                        key: 'colourAccentAlt', type: 'color', label: 'Second accent', section: 'Custom palette',
                        description: 'Secondary highlights, lesson stripes and background gradients.'
                    },
                    {
                        key: 'sourceUrl', type: 'text', label: 'Palette source', section: 'Custom palette',
                        description: 'Paste an https image or website URL.'
                    },
                    {
                        key: 'applySource', type: 'button', label: 'Import colours', section: 'Custom palette',
                        description: 'Sample the image or colours used by the website.', buttonLabel: 'Import'
                    },
                    {
                        key: 'chooseImage', type: 'button', label: 'Local image', section: 'Custom palette',
                        description: 'Take the two accents from an image on this device. It never leaves the browser.', buttonLabel: 'Choose image'
                    },
                    {
                        key: 'resetColours', type: 'button', label: 'Reset custom colours', section: 'Custom palette',
                        description: 'Drop the hand-picked and imported colours and go back to the neutral base.', buttonLabel: 'Reset colours'
                    },
                    {
                        key: 'chooseBackground', type: 'button', label: 'Background picture', section: 'Background',
                        description: 'Use a picture from this device behind Lectio, whichever colour theme is selected. It is stored in this browser only and is never uploaded.',
                        buttonLabel: 'Choose picture'
                    },
                    {
                        key: 'clearBackground', type: 'button', label: 'Remove background picture', section: 'Background',
                        description: 'Go back to the selected theme’s own background.', buttonLabel: 'Remove'
                    },
                    {
                        key: 'backgroundVeil', type: 'range', label: 'Background tint', section: 'Background',
                        description: 'How much of the theme colour is laid over your picture. Raise it if text is hard to read.',
                        min: 0, max: MAX_VEIL, step: 5, suffix: '%'
                    },
                    {
                        key: 'radius', type: 'range', label: 'Corner radius', section: 'Appearance',
                        description: 'Round panels and controls.', min: 4, max: 20, step: 1, suffix: 'px'
                    },
                    {
                        key: 'blur', type: 'toggle', label: 'Glass blur', section: 'Appearance',
                        description: 'Use translucent, blurred navigation surfaces.'
                    },
                    {
                        key: 'density', type: 'select', label: 'Spacing', section: 'Appearance',
                        description: 'Choose compact or roomier controls.',
                        options: [
                            { value: 'compact', label: 'Compact' },
                            { value: 'comfortable', label: 'Comfortable' }
                        ]
                    },
                    {
                        key: 'resetTheme', type: 'button', label: 'Reset theme', section: 'Reset',
                        description: 'Restore the Catppuccin Latte defaults. Keeps any background picture you chose.', buttonLabel: 'Reset'
                    }
                ],
                currentValues: {
                    enabled: settings.enabled,
                    preset: settings.preset,
                    mode: settings.mode,
                    sourceUrl: settings.sourceUrl,
                    radius: settings.radius,
                    blur: settings.blur,
                    density: settings.density,
                    backgroundVeil: settings.backgroundVeil,
                    colourBackground: colours.background,
                    colourText: colours.text,
                    colourAccent: colours.accent,
                    colourAccentAlt: colours.accentAlt
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
                // Light or dark is the custom palette's starting point, so
                // switching it re-bases the neutral page and text colours
                // while keeping whatever accents are already in play.
                if (settings.customColours) {
                    const base = CUSTOM_BASE[detail.value];
                    settings.customColours = {
                        ...settings.customColours, background: base.background, text: base.text
                    };
                }
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
            case 'backgroundVeil':
                settings.backgroundVeil = clamp(Number(detail.value) || 0, 0, MAX_VEIL);
                break;
            case 'colourBackground':
            case 'colourText':
            case 'colourAccent':
            case 'colourAccentAlt': {
                const hex = normaliseHex(detail.value);
                if (!hex) return;
                // Start from whatever the custom palette currently resolves
                // to, so a first hand-picked colour changes only that one
                // colour instead of dropping the rest back to the base.
                settings.customColours = { ...currentCustomColours(), [COLOUR_SETTING_KEYS[detail.key]]: hex };
                settings.preset = 'custom';
                break;
            }
            case 'resetColours':
                settings.customColours = null;
                break;
            case 'applySource':
                await importPalette();
                return;
            case 'chooseImage':
                chooseLocalImage();
                return;
            case 'chooseBackground':
                chooseBackgroundImage();
                return;
            case 'clearBackground':
                clearCustomBackground();
                return;
            case 'resetTheme':
                // Deliberately leaves the stored picture alone: it is a file
                // the person had to go and find, and it has its own Remove.
                settings = cloneDefaults();
                break;
            default:
                return;
        }

        saveSettings();
        applyTheme();
        announce();
    }

    function handleSettingPreview(event) {
        const detail = event?.detail;
        if (detail?.id !== MODULE_ID || detail.key !== 'preset' || !PRESET_KEYS.includes(detail.value)) {
            return;
        }
        applyTheme({ preset: detail.value });
    }

    function handleSettingPreviewClear(event) {
        const detail = event?.detail;
        if (detail?.id !== MODULE_ID || detail.key !== 'preset') return;
        applyTheme();
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
                backgroundVeil: clamp(
                    Number.isFinite(Number(saved.backgroundVeil)) ? Number(saved.backgroundVeil) : DEFAULT_SETTINGS.backgroundVeil,
                    0, MAX_VEIL
                ),
                customColours: validateColours(saved.customColours) || migrateHues(saved.customHues, saved.mode)
            };
        } catch (_) {
            return cloneDefaults();
        }
    }

    function cloneDefaults() {
        return { ...DEFAULT_SETTINGS, customColours: null };
    }

    // The picture is read back on its own so a corrupt or outsized entry can
    // be dropped without taking the rest of the settings with it.
    function loadCustomBackground() {
        try {
            const saved = JSON.parse(localStorage.getItem(BACKGROUND_STORAGE_KEY) || 'null');
            const dataUrl = typeof saved?.dataUrl === 'string' ? saved.dataUrl : '';

            // This value goes straight into a CSS url(), so anything that is
            // not a self-contained image data URL is discarded rather than
            // written into the page — it must not be able to point elsewhere.
            if (!/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(dataUrl) || dataUrl.length > MAX_BACKGROUND_CHARS) {
                if (dataUrl) localStorage.removeItem(BACKGROUND_STORAGE_KEY);
                return null;
            }

            return { dataUrl, name: typeof saved.name === 'string' ? saved.name.slice(0, 120) : '' };
        } catch (error) {
            console.warn(LOG, 'Could not read the stored background:', error);
            return null;
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (error) {
            console.warn(LOG, 'Could not save settings:', error);
        }
    }

    function normaliseHex(value) {
        const text = String(value || '').trim().toLowerCase();
        return /^#[0-9a-f]{6}$/.test(text) ? text : '';
    }

    function validateColours(value) {
        if (!value || !COLOUR_KEYS.every((key) => normaliseHex(value[key]))) return null;
        return Object.fromEntries(COLOUR_KEYS.map((key) => [key, normaliseHex(value[key])]));
    }

    // Settings saved before colours could be hand-picked carried only the two
    // accents an import had derived. Keep those, and take the page and text
    // colours from the neutral base that palette was already being drawn on,
    // so an upgrade looks like nothing happened.
    function migrateHues(hues, mode) {
        const accent = normaliseHex(hues?.accent);
        const accentAlt = normaliseHex(hues?.accentAlt);
        if (!accent || !accentAlt) return null;

        const base = CUSTOM_BASE[MODE_KEYS.includes(mode) ? mode : DEFAULT_SETTINGS.mode];
        return { background: base.background, text: base.text, accent, accentAlt };
    }

    // What the four colour controls show and edit. With nothing customised yet
    // this is the resolved neutral palette, so a first hand-picked colour
    // changes one colour rather than replacing the whole palette at once.
    function currentCustomColours() {
        if (settings.customColours) return { ...settings.customColours };

        const palette = resolvePalette('custom', settings.mode, null);
        return {
            background: palette.background, text: palette.text,
            accent: palette.accent, accentAlt: palette.accentAlt
        };
    }

    function resolvePalette(preset, mode, customColours) {
        const theme = THEMES[preset];

        if (theme) {
            return {
                background: theme.background, surface: theme.surface, surfaceAlt: theme.surfaceAlt,
                text: theme.text, muted: theme.muted, accent: theme.accent, accentAlt: theme.accentAlt,
                danger: theme.danger, blend: mixHex(theme.accent, theme.accentAlt, .5),
                mode: theme.mode, pattern: theme.pattern, image: `bg-${preset}.jpg`
            };
        }

        if (customColours) return resolveCustomPalette(customColours);

        const base = CUSTOM_BASE[mode] || CUSTOM_BASE.light;
        const hues = CUSTOM_FALLBACK_HUES;
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

    // A hand-picked palette carries only the four colours a person actually
    // wants to choose. Everything else — panel surfaces, muted text, the blend
    // the background gradients use — is derived from those, light or dark is
    // read off the chosen page colour rather than asked for again, and both
    // the text and the accents are nudged until they stay readable on it.
    // That is what lets someone build a bright pink theme without ending up
    // with pink text on a pink card.
    function resolveCustomPalette(chosen) {
        const background = chosen.background;
        const dark = relativeLightness(hexToRgb(background)) < .3;
        const surface = dark ? mixHex(background, '#ffffff', .07) : mixHex(background, '#ffffff', .6);
        const text = ensureTextContrast(chosen.text, [background, surface]);
        const surfaceAlt = dark ? mixHex(background, '#ffffff', .14) : mixHex(background, text, .07);
        const ensureAccent = dark ? ensureAccentOnDark : ensureAccentOnLight;
        const accent = ensureAccent(chosen.accent, background);
        const accentAlt = ensureAccent(chosen.accentAlt, background);
        const pattern = dark ? 'grid' : 'blobs';

        return {
            background, surface, surfaceAlt, text,
            muted: mixHex(text, background, .35),
            accent, accentAlt, danger: CUSTOM_FALLBACK_HUES.danger,
            blend: mixHex(accent, accentAlt, .5),
            mode: dark ? 'dark' : 'light', pattern, image: `bg-${pattern}.jpg`
        };
    }

    // Push the chosen text colour toward black or white until it is
    // comfortably readable, rather than silently discarding the colour the
    // person asked for. It has to hold up on both the page colour and the
    // panel colour derived from it, and those two can pull in opposite
    // directions — a mid-bright pink page with a pale pink panel is exactly
    // that case — so pick the single direction that serves the worse of the
    // two instead of correcting once per surface and undoing the first pass.
    function ensureTextContrast(colour, surfaces) {
        const worst = (candidate) => Math.min(...surfaces.map((surface) => contrastRatio(candidate, surface)));
        const toward = worst('#000000') >= worst('#ffffff') ? '#000000' : '#ffffff';
        let result = colour;
        let guard = 0;

        while (worst(result) < 4.5 && guard < 16) {
            result = mixHex(result, toward, .12);
            guard += 1;
        }

        return result;
    }

    function applyTheme(overrides = {}) {
        const root = document.documentElement;
        const effectiveSettings = { ...settings, ...overrides };
        root.classList.toggle(ROOT_CLASS, effectiveSettings.enabled);
        root.classList.toggle('lectio-theme-blur', effectiveSettings.blur);
        root.dataset.lectioThemeDensity = effectiveSettings.density;

        currentPalette = resolvePalette(effectiveSettings.preset, effectiveSettings.mode, effectiveSettings.customColours);

        // Other modules are encouraged (see ADR-0006) to read these same
        // --lectio-theme-* custom properties, with their own hard-coded
        // fallback in the var() call, so they pick up the active theme
        // without depending on this module being installed or present.
        // That seam only works cleanly if we clear these when the theme is
        // switched off, so a sibling module's fallback kicks back in
        // instead of it being left showing a stale, no-longer-active theme.
        if (effectiveSettings.enabled) {
            // A chosen picture is independent of the palette: it stands in for
            // the theme's own background photo and its decorative gradients,
            // and changes none of the colours the theme provides.
            const backgroundImage = customBackground?.dataUrl || '';

            root.dataset.lectioThemePattern = backgroundImage ? 'custom' : currentPalette.pattern;
            root.style.colorScheme = currentPalette.mode === 'dark' ? 'dark' : 'light';

            // The page shell and the boxes nested inside it are the largest
            // sheet of colour on a Lectio page, so together they decide how
            // much of the background image survives. Two things used to make
            // them read as flat panels: one fixed alpha, and nesting — a shell
            // inside a shell, a box inside a box — stacking that alpha onto
            // itself, so four themed layers still added up to a near-white
            // slab on a real activity page. The stylesheet below now gives
            // each nesting level exactly one veil, and these alphas are chosen
            // for the composite that leaves behind: a box sitting inside the
            // shell lands near half-opaque in a light theme and a little
            // thinner in a dark one, where the box colour is also pulled
            // toward the palette's own background instead of a lighter neutral
            // grey. Only the surface changes — text, links, borders and
            // controls keep the contrast they already had.
            const darkPalette = currentPalette.mode === 'dark';
            const contentPanel = darkPalette
                ? mixHex(currentPalette.surface, currentPalette.background, .3)
                : currentPalette.surface;
            const shellVeil = darkPalette ? '16%' : '26%';
            const contentVeil = darkPalette ? '28%' : '32%';
            const stripeVeil = darkPalette ? '16%' : '22%';

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
                '--lectio-theme-bg-image': backgroundImage
                    ? `url("${backgroundImage}")`
                    : `url('${ASSET_BASE_URL}/${currentPalette.image}')`,
                '--lectio-theme-radius': `${effectiveSettings.radius}px`,
                '--lectio-theme-space': effectiveSettings.density === 'compact' ? '6px' : '10px',
                '--lectio-theme-shell-surface': `color-mix(in srgb, ${contentPanel} ${shellVeil}, transparent)`,
                '--lectio-theme-content-surface': `color-mix(in srgb, ${contentPanel} ${contentVeil}, transparent)`,
                '--lectio-theme-content-stripe': `color-mix(in srgb, ${currentPalette.surfaceAlt} ${stripeVeil}, transparent)`
            };

            for (const [key, value] of Object.entries(variables)) {
                root.style.setProperty(key, value);
            }

            // Only a chosen picture carries a tint variable. The built-in
            // patterns keep the hand-tuned veil written into each of their
            // stylesheet rules, so nothing about them changes here.
            if (backgroundImage) {
                root.style.setProperty(
                    '--lectio-theme-bg-veil',
                    `${clamp(Number(effectiveSettings.backgroundVeil) || 0, 0, MAX_VEIL)}%`
                );
            } else {
                root.style.removeProperty('--lectio-theme-bg-veil');
            }
        } else {
            delete root.dataset.lectioThemePattern;
            root.style.colorScheme = '';
            for (const key of [...THEME_VARIABLE_NAMES, ...CONTENT_SURFACE_VARIABLE_NAMES]) {
                root.style.removeProperty(key);
            }
        }

        injectStyles();
        themeEditorFrames();
    }

    function themeEditorFrames() {
        const isThemed = document.documentElement.classList.contains(ROOT_CLASS);
        const frames = document.querySelectorAll('iframe.cke_wysiwyg_frame');
        for (const frame of frames) {
            try {
                const doc = frame.contentDocument || frame.contentWindow?.document;
                if (!doc || !doc.head) continue;
                let style = doc.getElementById('lectio-theme-editor-frame');
                if (!isThemed) {
                    style?.remove();
                    continue;
                }
                if (!style) {
                    style = doc.createElement('style');
                    style.id = 'lectio-theme-editor-frame';
                    doc.head.appendChild(style);
                }
                const textColor = document.documentElement.style.getPropertyValue('--lectio-theme-text') || 'inherit';
                const accentColor = document.documentElement.style.getPropertyValue('--lectio-theme-accent') || 'inherit';
                style.textContent = `
                    html, body {
                        background: transparent !important;
                        background-color: transparent !important;
                        color: ${textColor} !important;
                    }
                    :where(p, span, h1, h2, h3, h4, h5, h6, li, blockquote, div, td, th, label) {
                        color: inherit !important;
                    }
                    a {
                        color: ${accentColor} !important;
                    }
                `;
            } catch (_) {}
        }
    }

    function watchEditorFrame(frame) {
        // A frame Lectio re-inserts (every postback re-creates the editor) is
        // seen again by the observer below, and a second load listener on the
        // same element would never be removed. The WeakSet keeps it to one
        // listener for the frame's lifetime and holds nothing itself once the
        // element is gone.
        if (watchedEditorFrames.has(frame)) return;
        watchedEditorFrames.add(frame);
        frame.addEventListener('load', scheduleEditorFrameTheming);
    }

    function scheduleEditorFrameTheming() {
        if (editorFrameTimer) return;
        editorFrameTimer = window.setTimeout(() => {
            editorFrameTimer = 0;
            themeEditorFrames();
        }, 0);
    }

    function observeEditorFrames() {
        if (!window.MutationObserver) return;

        const observer = new MutationObserver((mutations) => {
            let found = false;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    if (node.matches?.('iframe.cke_wysiwyg_frame')) {
                        watchEditorFrame(node);
                        found = true;
                    } else if (node.querySelector?.('iframe.cke_wysiwyg_frame')) {
                        for (const frame of node.querySelectorAll('iframe.cke_wysiwyg_frame')) {
                            watchEditorFrame(frame);
                        }
                        found = true;
                    }
                }
            }

            // One pass per batch of DOM changes, not one per added node: a
            // Lectio page that renders a few hundred elements at once used to
            // re-scan and rewrite every editor frame a few hundred times.
            if (found) scheduleEditorFrameTheming();
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });
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
                /* Light-theme defaults for the content-surface treatment
                   applyTheme() derives from the active palette. */
                --lectio-theme-shell-surface: color-mix(in srgb, #ffffff 26%, transparent);
                --lectio-theme-content-surface: color-mix(in srgb, #ffffff 32%, transparent);
                --lectio-theme-content-stripe: color-mix(in srgb, #e6e9ef 22%, transparent);
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

            /* A picture the user chose themselves gets one layer and no
               decorative gradients: it is their image, and the only thing laid
               over it is as much of the palette's page colour as they asked
               for with the Background tint setting.

               It goes on the root element rather than on <body>, unlike the
               built-in patterns: <body> only paints as tall as its own
               content, which is invisible with a background photo that tiles
               the same colours but obvious with a photo of something, where
               the picture would simply stop partway down a short page. */
            html.${ROOT_CLASS}[data-lectio-theme-pattern="custom"] {
                background-image:
                    linear-gradient(
                        color-mix(in srgb, var(--lectio-theme-bg) var(--lectio-theme-bg-veil, 35%), transparent),
                        color-mix(in srgb, var(--lectio-theme-bg) var(--lectio-theme-bg-veil, 35%), transparent)
                    ),
                    var(--lectio-theme-bg-image) !important;
                background-attachment: fixed !important;
                background-repeat: no-repeat !important;
                background-position: center !important;
                background-size: cover !important;
            }

            html.${ROOT_CLASS}[data-lectio-theme-pattern="custom"] body {
                background-color: transparent !important;
                background-image: none !important;
            }

            html.${ROOT_CLASS} :where(#masterContent, #content, #m_Content, .ls-master-container, .ls-content-container,
                [class*="ls-card"], [class*="ls-island"], fieldset, .s2skemabrikcontainer, .s2skemabrik, .s2day, .s2weekHeader) {
                border-radius: var(--lectio-theme-radius) !important;
            }

            html.${ROOT_CLASS} :where(#masterContent, #content, #m_Content, .ls-master-container, .ls-content-container) {
                background: var(--lectio-theme-shell-surface) !important;
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
                background: var(--lectio-theme-content-surface) !important;
                color: var(--lectio-theme-text);
            }

            html.${ROOT_CLASS} :where(th, tr:nth-child(even) > td) {
                background: var(--lectio-theme-content-stripe) !important;
            }

            html.${ROOT_CLASS} :where([class*="ls-card"], [class*="ls-island"], fieldset, .s2skemabrikcontainer) {
                background: var(--lectio-theme-content-surface) !important;
                box-shadow: 0 8px 22px color-mix(in srgb, var(--lectio-theme-muted) 18%, transparent), inset 0 1px color-mix(in srgb, var(--lectio-theme-text) 6%, transparent);
                padding: var(--lectio-theme-space);
            }

            html.${ROOT_CLASS} :where(#s_m_masterleftDiv, .ls-master-header, .ls-top-nav, .ls-master-pageheader, #s_m_mastermenu, .lectioToolbar) {
                background: color-mix(in srgb, var(--lectio-theme-surface) 62%, transparent) !important;
                border: 1px solid color-mix(in srgb, var(--lectio-theme-accent) 10%, transparent) !important;
                color: var(--lectio-theme-text) !important;
                box-shadow: 0 10px 24px color-mix(in srgb, var(--lectio-theme-muted) 20%, transparent);
            }

            /* Frost is what keeps a very thin veil readable, so it covers the
               paper/editor/section surfaces the actual lesson text sits on,
               not just the navigation chrome. The schedule slots are left out
               deliberately: they number in the hundreds, where a
               backdrop-filter costs more scroll smoothness than it returns. */
            html.${ROOT_CLASS}.lectio-theme-blur :where(
                #s_m_masterleftDiv, .ls-master-header, .ls-top-nav, #s_m_mastermenu, .lectioToolbar,
                ${FROSTED_CONTENT_BOX_SELECTOR}
            ) {
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

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :where(
                input:not([type="checkbox"]):not([type="radio"]):not([type="image"]),
                select,
                textarea,
                button,
                .button,
                .ls-button
            ) {
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

            /* Keep native choice controls native-sized and stateful. The
               generic text-control padding above made these look like empty
               rounded text fields, especially inside Lectio dialogs. */
            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :where(${CHOICE_CONTROL_SELECTOR}) {
                appearance: auto !important;
                accent-color: var(--lectio-theme-accent);
                box-sizing: border-box !important;
                width: 1rem !important;
                height: 1rem !important;
                min-width: 1rem !important;
                min-height: 1rem !important;
                margin: 3px 4px 3px 0;
                padding: 0 !important;
                vertical-align: -2px;
                background: initial !important;
                box-shadow: none !important;
            }

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :where(${CHOICE_CONTROL_SELECTOR}):hover:not(:disabled) {
                filter: brightness(1.08);
            }

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :where(${CHOICE_CONTROL_SELECTOR}):focus-visible {
                outline: 2px solid color-mix(in srgb, var(--lectio-theme-accent) 70%, transparent) !important;
                outline-offset: 2px;
            }

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :where(${CHOICE_CONTROL_SELECTOR}):disabled {
                cursor: not-allowed;
                opacity: .55;
            }

            /* Lectio's current jQuery UI close icon is a background image.
               The generic button background above hides it, so draw a
               theme-aware glyph without replacing the element or its events. */
            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :is(${DIALOG_CLOSE_SELECTOR}) {
                box-sizing: border-box !important;
                display: inline-grid !important;
                place-items: center;
                width: 1.875rem !important;
                height: 1.875rem !important;
                min-width: 1.875rem !important;
                min-height: 1.875rem !important;
                padding: 0 !important;
                border: 1px solid color-mix(in srgb, var(--lectio-theme-muted) 35%, transparent) !important;
                border-radius: max(6px, calc(var(--lectio-theme-radius) - 5px)) !important;
                background: var(--lectio-theme-surface-alt) !important;
                color: var(--lectio-theme-text) !important;
                font-size: 0 !important;
                line-height: 1 !important;
                text-decoration: none !important;
                cursor: pointer;
            }

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :is(${DIALOG_CLOSE_SELECTOR})::before {
                content: "×";
                color: currentColor;
                font: 700 1.35rem/1 Arial, sans-serif;
            }

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :is(${DIALOG_CLOSE_SELECTOR}):hover {
                border-color: var(--lectio-theme-accent) !important;
                background: color-mix(in srgb, var(--lectio-theme-accent) 16%, var(--lectio-theme-surface-alt)) !important;
            }

            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :is(${DIALOG_CLOSE_SELECTOR}):focus-visible {
                outline: 2px solid color-mix(in srgb, var(--lectio-theme-accent) 70%, transparent) !important;
                outline-offset: 2px;
            }

            html.${ROOT_CLASS} :where(.ls-paper, .lc-display-fragment) {
                background: var(--lectio-theme-content-surface) !important;
                color: var(--lectio-theme-text) !important;
            }

            /* One veil per nesting level. Lectio nests these freely — a real
               activity page puts .ls-content-container inside #masterContent,
               and the editor's .lc-display-fragment inside the homework
               .ls-paper — and every extra veil used to stack onto the ones
               behind it, so a fully themed page still came out near-white.
               A shell inside a shell, or a box inside a box, therefore adds no
               second veil of its own: the outermost one already carries the
               surface, and the nesting only contributes layout. */
            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}) :is(${CONTENT_ROOT_SELECTOR}),
            html.${ROOT_CLASS} :is(${CONTENT_BOX_SELECTOR}) :is(${CONTENT_BOX_SELECTOR}) {
                background: transparent !important;
                box-shadow: none !important;
            }

            /* A layout table is structure, not content, so it carries no veil
               of its own once something above it already does. Its cells keep
               theirs, which is what keeps the schedule grid reading as slots:
               one shell veil plus one cell veil, not two sheets. */
            html.${ROOT_CLASS} :is(${CONTENT_ROOT_SELECTOR}, ${CONTENT_BOX_SELECTOR}) table {
                background: transparent !important;
                box-shadow: none !important;
            }

            html.${ROOT_CLASS} :where(.ls-toolbarMenuInnerContainer, .ls-std-toolbar-filled) {
                background: color-mix(in srgb, var(--lectio-theme-surface-alt) 55%, transparent) !important;
                color: var(--lectio-theme-text) !important;
            }

            html.${ROOT_CLASS} :where(.message-thread-container, .message-reply-summary, .message-thread-message) {
                background: color-mix(in srgb, var(--lectio-theme-surface) 60%, transparent) !important;
                color: var(--lectio-theme-text) !important;
                border-color: color-mix(in srgb, var(--lectio-theme-muted) 25%, transparent) !important;
            }

            html.${ROOT_CLASS} :where(.message-thread-message.viewed-persons-message, .message-reply-summary.viewed-persons-message) {
                background: color-mix(in srgb, var(--lectio-theme-accent-alt) 18%, var(--lectio-theme-surface)) !important;
            }

            html.${ROOT_CLASS} :where(.cke_top, .cke_bottom) {
                background: color-mix(in srgb, var(--lectio-theme-surface-alt) 75%, transparent) !important;
            }

            html.${ROOT_CLASS} .cke_chrome {
                border-color: color-mix(in srgb, var(--lectio-theme-muted) 25%, transparent) !important;
                border-radius: max(4px, calc(var(--lectio-theme-radius) - 4px)) !important;
                background: transparent !important;
                box-shadow: none !important;
            }

            /* CKEditor skins paint a solid white background on .cke_inner,
               .cke_wysiwyg_div, .cke_wysiwyg_frame, and .cke_source, which resists
               the theme and leaves the lesson editor as an opaque white box.
               Clear those backgrounds so the editor rests cleanly on the
               underlying paper/card surface without adding an opaque veil or
               stacking extra layers. */
            html.${ROOT_CLASS} :where(
                .cke_inner,
                .cke_contents,
                .cke_wysiwyg_frame,
                .cke_wysiwyg_div,
                .cke_editable,
                .cke_source
            ) {
                background: transparent !important;
                background-color: transparent !important;
                color: var(--lectio-theme-text) !important;
            }

            html.${ROOT_CLASS} :where(.cke_editable, .cke_wysiwyg_div, .lc-display-fragment) :where(
                p, span, h1, h2, h3, h4, h5, h6, li, blockquote, div, td, th, label
            ) {
                color: inherit !important;
            }

            html.${ROOT_CLASS} :where(.cke_editable, .cke_wysiwyg_div, .lc-display-fragment) a {
                color: var(--lectio-theme-accent) !important;
            }

            /* Floating tooltips (e.g. lesson header hover details) */
            html.${ROOT_CLASS} :where(.ui-tooltip, .ui-tooltip-content) {
                background: color-mix(in srgb, var(--lectio-theme-surface) 85%, transparent) !important;
                border: 1px solid color-mix(in srgb, var(--lectio-theme-accent) 25%, transparent) !important;
                color: var(--lectio-theme-text) !important;
                border-radius: max(4px, calc(var(--lectio-theme-radius) - 6px)) !important;
                box-shadow: 0 8px 24px color-mix(in srgb, var(--lectio-theme-muted) 25%, transparent) !important;
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

            const hues = deriveHues(colours);
            settings.customColours = { ...currentCustomColours(), accent: hues.accent, accentAlt: hues.accentAlt };
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

    async function chooseLocalImage() {
        const file = await pickImageFile();
        if (!file) return;
        if (file.size > MAX_SOURCE_BYTES) {
            showToast('Palette images must be smaller than 8 MB.', true);
            return;
        }

        try {
            const colours = await sampleImageColours(await file.arrayBuffer(), file.type || 'image/png');
            if (colours.length < 2) throw new Error('Not enough distinct colours were found.');
            const hues = deriveHues(colours);
            settings.customColours = { ...currentCustomColours(), accent: hues.accent, accentAlt: hues.accentAlt };
            settings.preset = 'custom';
            saveSettings();
            applyTheme();
            announce();
            showToast(`Imported ${colours.length} image colours.`);
        } catch (error) {
            console.warn(LOG, 'Local palette import failed:', error);
            showToast(error.message || 'Could not read that image.', true);
        }
    }

    // Nothing here uploads anything: the file is read by this page, re-encoded
    // in a canvas, and kept in this browser's own storage for this origin.
    async function chooseBackgroundImage() {
        const file = await pickImageFile();
        if (!file) return;
        if (file.size > MAX_BACKGROUND_SOURCE_BYTES) {
            showToast('Background pictures must be smaller than 32 MB.', true);
            return;
        }

        showToast('Preparing the background…');

        try {
            customBackground = await storeBackgroundImage(file);
            applyTheme();
            announce();
            showToast('Background saved on this device only.');
        } catch (error) {
            console.warn(LOG, 'Background picture failed:', error);
            showToast(error.message || 'Could not use that picture.', true);
        }
    }

    // Try progressively smaller encodings until one both fits the budget and
    // is accepted by storage, so a large photo degrades to a smaller one
    // instead of failing outright or leaving the theme half-applied.
    async function storeBackgroundImage(file) {
        const image = await loadImage(new Blob([await file.arrayBuffer()], { type: file.type || 'image/png' }));

        try {
            for (const step of BACKGROUND_STEPS) {
                const dataUrl = encodeBackground(image, step);
                if (dataUrl.length > MAX_BACKGROUND_CHARS) continue;

                const record = { dataUrl, name: String(file.name || '').slice(0, 120) };

                try {
                    localStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(record));
                    return record;
                } catch (error) {
                    console.warn(LOG, 'Background did not fit storage at', step.size, error);
                }
            }
        } finally {
            if (typeof image.close === 'function') image.close();
        }

        throw new Error('There was no room to store that picture. Try a smaller one.');
    }

    function encodeBackground(image, step) {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, step.size / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));

        const context = canvas.getContext('2d');
        // Flatten onto the palette's own page colour first: the stored copy is
        // JPEG, so a transparent PNG would otherwise come back as black.
        context.fillStyle = currentPalette.background;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        return canvas.toDataURL('image/jpeg', step.quality);
    }

    function clearCustomBackground() {
        try {
            localStorage.removeItem(BACKGROUND_STORAGE_KEY);
        } catch (error) {
            console.warn(LOG, 'Could not remove the stored background:', error);
        }

        if (!customBackground) {
            showToast('No background picture is set.');
            return;
        }

        customBackground = null;
        applyTheme();
        announce();
        showToast('Background removed — back to the theme\u2019s own.');
    }

    function pickImageFile() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            // Resolve on cancel too, so a dismissed picker doesn't leave a
            // pending promise (and the closure behind it) alive for the rest
            // of the page's life.
            input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
            input.addEventListener('cancel', () => resolve(null), { once: true });
            input.click();
        });
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

        try {
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

            return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 32).map(([colour]) => colour);
        } finally {
            // An ImageBitmap keeps its decoded pixels outside the JS heap
            // until it is closed, so release it even if the read above throws.
            if (typeof image.close === 'function') image.close();
        }
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
            // Replacing a toast has to cancel the old one's removal timer too,
            // or that timer keeps the detached node alive until it fires.
            window.clearTimeout(toastTimer);
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
            toastTimer = window.setTimeout(() => {
                toastTimer = 0;
                toast.remove();
            }, isError ? 5000 : 3000);
        };

        if (document.body) render();
        else document.addEventListener('DOMContentLoaded', render, { once: true });
    }
})();
