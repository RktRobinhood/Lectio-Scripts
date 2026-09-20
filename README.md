# Lectio Scripts

Small, unofficial **Tampermonkey userscripts** that add useful features to [Lectio](https://www.lectio.dk/).

They run locally in your browser while you use Lectio. Install only the modules you want; each works independently.

> [!NOTE]
> This project is not affiliated with or endorsed by Lectio or Tampermonkey.

---

## Contents

- [Lectio Manager](#lectio-manager)
- [Modules](#modules)
- [Quick install](#quick-install)
- [Tampermonkey setup](#tampermonkey-setup)
- [Phones and tablets](#phones-and-tablets)
- [Using and updating things](#using-and-updating-things)
- [Troubleshooting](#troubleshooting)
- [Reporting bugs and ideas](#reporting-bugs-and-ideas)
- [Getting Console errors](#getting-console-errors)
- [Make it yours with an LLM](#make-it-yours-with-an-llm)
- [Privacy and security](#privacy-and-security)
- [Repository layout](#repository-layout)
- [Useful links](#useful-links)
- [License](#license)

---

## Lectio Manager

**[Lectio Manager](manager/Lectio-Manager.user.js)** is a small, stable control surface that lives inside Lectio. Install it once and it:

- shows a **catalogue** of modules that are still available to install, fetched from this repository (`catalogue/modules.json`),
- lets you **install** a module with one click, using Tampermonkey's own install screen,
- remembers every module it has ever seen as **installed**, and shows whether that module is also running on the page you are on,
- caches the catalogue locally and refreshes it automatically at most once every 24 hours, with a manual refresh button whenever you want the latest list,
- opens on a compact **Installed** tab, with a counted **Available** tab for discovering modules you have not installed yet; its audience and category filters narrow only that available set, and an installed module never appears in both,
- sorts either tab by Category or Name immediately, without interrupting navigation,
- explains a setting when you click the small **ⓘ** next to it, instead of always showing that text, so a module's settings panel doesn't read as more overwhelming than it needs to; and keeps a settings group most people will never need — such as Lectio Theming's **Custom palette** — collapsed behind a click, so the built-in themes stay what you see first,
- owns a compact **shared dock** for modules that need an always-available control, including consistent icons, badges, flyouts, adaptive sizing, and saved drag ordering; it sits on the left edge by default, can be moved to any screen edge, and disappears completely when no module uses it. The dock is frosted glass rather than a white panel, its icons come from [Lucide](https://lucide.dev) and follow the active theme's colour, and hovering one magnifies it and its neighbours the way a desktop dock does,
- tells you when **the Manager itself** is out of date. Every module gets an "Update available" row because the Manager compares what the module reports against the catalogue, but nothing does that for the Manager — so the catalogue carries the Manager's own version too, and a notice appears at the top of the panel when a newer one exists. Without it, the Manager relies entirely on Tampermonkey's update check, which is off by default,
- has one **wrench button** in the header that opens Tampermonkey's own dashboard directly, for disabling, updating, or removing any script — since that dashboard already lists everything installed, there's no need for a separate button per module,
- has a **Report a bug or idea** link at the bottom of the panel, straight to this repository's GitHub Issue templates.

The Manager itself contains **no feature logic**. Translation, message polling, room logic, and every other feature live entirely inside their own independent module. Installing only the Manager and one module means only that module's code ever runs — nothing else is downloaded or executed.

Look for a small teal gear button in the bottom-right corner of any Lectio page after installing it.

The settings button inside the Manager header opens Manager preferences. **Release channel** is a single dropdown for the Stable/Unstable choice, with an **ⓘ** beside it that explains what a channel is; the extra warning appears only while Unstable is selected. Every module change lands on Unstable first and reaches Stable only when it has been used and promoted deliberately, so Unstable is where new work actually appears — and where it can be rough. The Manager itself is the exception: it ships to Stable directly, because it is what the channel switch lives in. Under **Dock**, **Screen edge** puts the dock on the left (the default), right, top, or bottom of the window, and **Position on edge** slides it along that edge — top/middle/bottom for a left or right dock, left/centre/right for a top or bottom one. The same section sets icon size, whether icons shrink to fit the screen, auto-hide, and a reset for the saved order. **Dock background** and **Icon background** are separate opacity sliders for the panel and for the plates behind the icons, starting at 30% and 60% so the page reads through both; the icons themselves stay fully opaque at every setting. Each slider moves everything that paints inside its shape - fill, blur, saturation, inner highlight and drop shadow - so 0% leaves nothing but the edge line and 100% is the glass as it was before either was adjustable. Dock controls can also be reordered directly by dragging them or by focusing one and pressing **Ctrl** with an arrow key.

> [!NOTE]
> A module tells the Manager it exists by replying to a handshake, which it can only do on pages its own `@match` covers — Schedule Summary only runs on the schedule page, for example. The Manager therefore **remembers** each module it has seen and keeps counting it as installed everywhere, marking it *"Not active on this page"* where it isn't running. Settings stay hidden there, because a module that isn't running cannot receive them.
>
> The trade-off is that the Manager cannot see a module you remove in Tampermonkey; it has no API to check. Use **Remove** on the module's card to forget it.

> [!NOTE]
> Tampermonkey has no API for a userscript to uninstall or disable *another* script, so the Manager can't do that directly — that stays Tampermonkey's job by design. The header's wrench button is a shortcut to Tampermonkey's dashboard, not a bypass, and its reliability depends on your browser:
>
> | Browser | What happens |
> |---|---|
> | Chrome, Edge, Brave, Opera, Vivaldi (Chromium-based) | Opens directly, using that browser's own fixed Tampermonkey extension ID. |
> | Firefox | Assigns a random per-profile extension ID that can never be hardcoded, so it asks **once** for your own dashboard link (open your Tampermonkey icon → Dashboard, copy the address bar URL, paste it in) and remembers it after that. |
> | Safari | Tampermonkey's settings live inside Safari's own Settings → Extensions panel rather than a normal browser tab, so there's usually no link to paste at all — open it from there instead. |
>
> Use the **Set dashboard link** button at the bottom of the panel to add, fix, or clear a saved link at any time (useful if a Chromium guess is wrong, or after Tampermonkey gets reinstalled and Firefox assigns it a new ID). The wrench icon is a real link (not a script-driven popup), so it always reflects whatever URL was last saved or guessed — click it directly rather than expecting anything to happen automatically right after saving a link.

---

## Modules

All modules are designed for Lectio and are intended to work across Lectio installations, unless noted otherwise.

| Module | What it does | Best for |
|---|---|---|
| **[English Mode](modules/Lectio-English-Mode.user.js)** | Adds a **DA / EN** switch and translates the Lectio interface into context-aware English. | Students and staff |
| **[Chairs Up](modules/Lectio-Chairs-Up.user.js)** | Marks a lesson when it is the **last booking of the day in that room**. | Teachers |
| **[Schedule Summary](modules/Lectio-Schedule-Summary.user.js)** | Collapses the schedule's tall **week-information row** into a compact strip; hover to preview it or click to expand it. | Students and staff |
| **[Unread Message Notifications](modules/Lectio-Unread-Message-Notifications.user.js)** | Shows an unread-message badge beside **Beskeder / Messages**. Currently limited to Lectio school `223`. | Students and staff at that school |
| **[Subject Colours](modules/Lectio-Subject-Colours.user.js)** | Works out which classes are really yours from your own timetable and gives each one its own colour, keeping one-off activities in a separate muted spectrum. | Students and staff |
| **[Lectio Theming](modules/Lectio-Theming.user.js)** | Applies a soft, translucent glass shell with **46 built-in colour schemes** (Catppuccin, Nord, Dracula, Cyberpunk, plus sports, social-app, IB and Danish-landscape palettes), each with its own distinct background photo, or build your own: pick the key colours yourself, derive them from an **image or website URL**, and use **your own picture** as the background. | Students and staff |

You can install one, several, or all of them, either through the Manager or by copying a file directly (see below).

---

## Quick install

### Recommended: through the Manager

1. Install **[Tampermonkey](https://www.tampermonkey.net/)**.
2. Install **[Lectio Manager](https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/manager/Lectio-Manager.user.js)** — Tampermonkey should offer its normal install screen; confirm it.
3. Open Lectio and click the small gear button in the bottom-right corner.
4. Click **Install** next to any module you want.
5. Confirm Tampermonkey's install screen for that module too.

Each module keeps its own version and updates independently of the Manager and of every other module.

Installed modules can expose their own settings in the Manager. Open Lectio Tools, find an installed module, and choose **Settings** to open its focused, sectioned settings view. The Manager only renders these controls; each independent module owns and applies its values.

For Lectio Theming, open the **Theme** dropdown and hover any option to preview it temporarily; choose one to keep it. The 46 built-in colour schemes (Catppuccin, Nord, Dracula, Gruvbox, Solarized, Tokyo Night, Rosé Pine, Everforest, One Dark, Monokai Pro, Ayu, Kanagawa, Nightfox, Oxocarbon, Material Ocean, GitHub, Cyberpunk Neon, Synthwave '84, plus Bubblegum, Pastel Dream, Matcha Latte, Lemon, Hardwood, Handball Court, Golf Fairway, Floodlit Pitch, Paddock, Stable, Skate Park, North Sea, Heathland, Deep Space, Feed Gradient, Clip Neon, Playlist, Blurple, IB Light and IB Dark) each keep their own authentic light or dark look and distinct background photo (see [assets/theming/CREDITS.md](assets/theming/CREDITS.md) for sources). To build your own look instead, use the **Custom palette** section. **Page colour**, **Text colour**, **Accent colour** and **Second accent** are ordinary colour pickers — choosing any of them switches the theme to **Custom palette** — and panel shades, muted text and light-or-dark are worked out from what you pick, so a bright pink page keeps dark, readable text on pink panels rather than pink on pink. You can also fill those colours in automatically: paste an HTTPS image or website URL into **Palette source** and choose **Import**, or use **Choose image** for a local file that never leaves the browser. Direct image URLs give the most predictable result; website imports use colours found in the page and up to six linked stylesheets. **Light or dark base** sets the neutral starting point for this palette, and **Reset custom colours** returns to it.

The **Background** section is independent of all of that. **Choose picture** puts a picture from your device behind Lectio whichever colour theme is selected; it is scaled down, stored in this browser only, and never uploaded. **Background tint** controls how much of the theme's page colour is laid over it — raise it if text is hard to read — and **Remove background picture** hands the selected theme its own background back. Large pictures are re-encoded smaller automatically, and if there is no room left in browser storage the module says so and keeps the background you already had.

Unread Message Notifications includes a **Bubble size** setting from 75% to 175%. Its count text automatically switches between light and dark text as themes change so the badge remains readable.

A hold that Lectio uses to mean everyone — **Alle Lærere**, **Alle 1i-elever** and the like — is never treated as one of your classes, however reliably it recurs, and neither is a block that lists more than three holds at once. Subject Colours has nothing to set up: it reads your own timetable, works out which holds keep coming back week after week, and gives each of those its own colour. Everything else on your schedule — assemblies, meetings, trips, a lesson you covered once — is deliberately kept out of that colour space and marked instead in a muted grey-toned spectrum with a broken edge line, so a glance separates "one of my classes" from "something else today" without having to read anything. Under **Colours** you can switch between filling a lesson block, marking only its leading edge, or both; set how strong the colours are; and turn the one-off marking off entirely. Under **Detection**, **What counts as a class** decides how much evidence a hold needs before it earns a colour, **Weeks to learn from** sets how much of your timetable is read in the background (0 means it only learns from pages you open yourself), and **Read my timetable again** starts a fresh scan. Every class it has found is listed under **Your classes** with a colour picker, so you can overrule any colour you don't like; **Reset chosen colours** hands them all back. The colours themselves are derived from whatever theme is active, so installing Lectio Theming or switching its scheme re-derives them to suit — a dark scheme gets deep colours with light text, a light one gets soft colours with dark text, and text is contrast-checked against its own block either way. If you would rather a colour you picked stayed exactly as you picked it, **Keep my colours exactly** stops the theme having any say in it: the colour and the edge line and the text that goes with it are all worked out from that one colour and stay put whichever scheme is running. It applies only to classes you have picked a colour for — everything else carries on following the theme. Text is still contrast-checked, because a colour nobody can read on is not what anyone is asking for.

> [!NOTE]
> A class needs to be seen in more than one week before it earns a colour, so a freshly installed Subject Colours has some learning to do. It does most of that in the background within a few seconds of opening your schedule; the class list in Settings is built when the module registers, so reopen **Settings** after a scan to see newly found classes.

> [!TIP]
> Already running **Lectio Farver**, **Lectio i farver** or **Lectio Colors++**? Both Subject Colours and Lectio Theming now leave any lesson block those extensions have coloured exactly as they left it, instead of painting over it. Lectio Theming used to overwrite them silently — that is fixed. You can keep using whichever you prefer; you just shouldn't expect two colouring extensions to agree about the same block.

### Manual: copy-paste a single module

If you'd rather not use the Manager, any module still works entirely on its own:

1. Install **[Tampermonkey](https://www.tampermonkey.net/)**.
2. Open the module you want in the [`/modules`](modules/) folder.
3. Copy the **entire JavaScript file**.
4. Click the Tampermonkey icon.
5. Choose **Create a new script...**
6. Delete Tampermonkey's example code.
7. Paste the module's code.
8. Save with **Ctrl + S** / **Cmd + S**.
9. Reload Lectio.

![Current Tampermonkey menu showing Create a new script](assets/tampermonkey-menu.png)

> [!TIP]
> The userscript header at the top of the file is part of the script. Copy it too.

---

## Tampermonkey setup

### Install Tampermonkey

Get it from the official site:

**[tampermonkey.net](https://www.tampermonkey.net/)**

Tampermonkey is available for major desktop browsers including Chrome, Firefox, Edge, Safari, and Opera.

### Chrome and Edge: allow userscripts

Some Chromium-based versions require an additional permission before Tampermonkey can execute scripts.

If a script installs but never runs:

1. Open your browser's extension settings.
2. Open **Tampermonkey**.
3. Enable **Allow User Scripts** if available.
4. If that option is not shown, Tampermonkey may require **Developer Mode** instead.

Official guidance:

**[Tampermonkey — Permission to execute userscripts](https://www.tampermonkey.net/faq.php?locale=en&q=Q209)**

<details>
<summary><strong>Alternative installation: GitHub Raw</strong></summary>

Tampermonkey can sometimes install a userscript directly from GitHub:

1. Open the JavaScript file.
2. Click **Raw**.
3. If Tampermonkey opens an installation page, review the script and click **Install**.
4. If the browser simply displays JavaScript, use the copy-and-paste method above.

Current raw files:

- [Lectio Manager — Raw](https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/manager/Lectio-Manager.user.js)
- [English Mode — Raw](https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-English-Mode.user.js)
- [Chairs Up — Raw](https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-Chairs-Up.user.js)
- [Schedule Summary — Raw](https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-Schedule-Summary.user.js)
- [Unread Message Notifications — Raw](https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-Unread-Message-Notifications.user.js)
- [Lectio Theming — Raw](https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/modules/Lectio-Theming.user.js)

Installing this way (rather than copy-paste) lets Tampermonkey check that raw URL for updates automatically.

</details>

---

## Phones and tablets

Yes — userscripts can run on supported phones and tablets, but mobile browser support differs from desktop.

| Platform | Browser | Tampermonkey/userscript support |
|---|---|---|
| **Android** | Microsoft Edge | Yes |
| **Android** | Firefox | Yes |
| **Android** | Chrome | No standard extension support |
| **iPhone / iPad** | Safari | Yes, through the Tampermonkey App Store extension |
| **Desktop** | Chrome / Edge / Firefox / Safari / Opera | Yes |

### Mobile notes

**Lectio Manager** renders as a small floating gear button; on very narrow screens its panel takes up nearly the full width of the viewport but stays scrollable.

**English Mode** should generally translate Lectio normally, although very narrow screens may expose layout issues.

**Chairs Up** uses normal Lectio timetable information, but the visual marker may appear differently on a mobile layout.

**Unread Message Notifications** works while Lectio is open, but it is **not a native push-notification service**. Phones often suspend background browser tabs, so do not expect reliable alerts while the browser is closed or Lectio is suspended.

When you return to Lectio, the script can check again.

Official mobile links:

- [Tampermonkey versions and mobile options](https://www.tampermonkey.net/faq.php?q=Q406)
- [Microsoft Edge mobile extensions](https://microsoftedge.microsoft.com/addons/collections/mobile_android_extensions)
- [Tampermonkey for Firefox Android](https://addons.mozilla.org/en-US/android/addon/tampermonkey/)
- [Tampermonkey for iPhone/iPad](https://apps.apple.com/dk/app/tampermonkey/id6738342400)

> [!NOTE]
> Mobile support is still worth testing across different devices and browsers. If something looks or behaves incorrectly, please report it.

---

## Using and updating things

### Check that a script is running

1. Open Lectio.
2. Click the Tampermonkey icon.
3. Make sure Tampermonkey is **Enabled**.
4. Open **Dashboard** if needed.
5. Confirm the script is enabled.
6. Reload Lectio.

### The Manager's catalogue vs. script updates

These are two separate, independent things:

| What | How it updates |
|---|---|
| **The catalogue** (which modules exist, their description/version) | The Manager fetches `catalogue/modules.json` on its own, at most once every 24 hours, or immediately when you click its refresh button. |
| **The Manager's own code** | Normal Tampermonkey update check against `manager/Lectio-Manager.user.js`. |
| **A module's own code** | Normal Tampermonkey update check against that module's own file in `modules/`. |

> [!TIP]
> Every file in `manager/` and `modules/` includes an `@updateURL`/`@downloadURL` in its header, so Tampermonkey can check for updates **no matter how you installed it** — through the Manager, via GitHub Raw, or by copy-paste (as long as you copied the header too). This only works if Tampermonkey's own update checking is turned on: **Tampermonkey Dashboard → Settings → Update**, and confirm an interval is set (Tampermonkey checks in the background on that schedule; it does not update instantly the moment a new version is published here). The Manager shows a one-time dismissible reminder about this the first time you open its panel.
>
> There's no way around that manual step: Tampermonkey gives userscripts no API to read or change its own settings, and no reliable cross-browser way to deep-link straight to its Settings tab (only the general dashboard, which the **Manage** button already opens).

When the Catalogue lists a newer version than an installed module reports, the Manager marks that module **Update available** and shows an **Update** link. The link opens the module's approved GitHub Raw userscript URL, where Tampermonkey can show its normal update/reinstall confirmation page.

### Install several modules

Repeat the install steps for each one, through the Manager or manually. They appear separately in the Tampermonkey Dashboard.

### Disable or remove

To temporarily disable a script, switch it **Off** in the Tampermonkey Dashboard and reload Lectio. The Manager will keep listing it as installed — it cannot see Tampermonkey's on/off state — but will mark it *"Not active on this page"*.

To remove it completely, delete it from the Dashboard, then click **Remove** on that module's card in the Manager so it stops being counted as installed and returns to **Available**.

---

## Troubleshooting

| Problem | What to try |
|---|---|
| **Nothing happens** | Confirm Tampermonkey and the script are enabled, reload Lectio, and check Chrome/Edge userscript permissions. |
| **No gear button appears** | Confirm the Lectio Manager script is installed and enabled in the Tampermonkey Dashboard, then reload Lectio. |
| **The Manager's module list is empty or stuck loading** | This means it has never successfully fetched the catalogue. Check your connection and click the manual refresh (circular arrow) button. |
| **A module shows "Not active on this page"** | Expected when that module doesn't run everywhere — Schedule Summary only runs on the schedule page. It still counts as installed. Open a page it covers to change its settings. |
| **A module I removed still shows as installed** | The Manager can't see removals in Tampermonkey. Click **Remove** on its card to forget it. |
| **A module never appears as installed** | Confirm it is **enabled** (not just installed) in the Tampermonkey Dashboard, then load a Lectio page that module actually runs on. |
| **The wrench (Tampermonkey) button doesn't open anything** | On Chromium browsers it should work automatically. On Firefox it prompts you once for your own dashboard link (Tampermonkey icon → Dashboard → copy the address bar URL). On Safari, open it from Safari's own Settings → Extensions instead. Use **Set dashboard link** at the bottom of the panel to add, fix, or clear a saved link manually. |
| **GitHub Raw only shows JavaScript** | Copy the complete file and use **Create a new script...** instead. |
| **English translation is incomplete** | Reload, switch **DA → EN**, and report repeatable untranslated text. |
| **English Mode requests extra permissions** | It can use Tampermonkey storage and Google Translate fallback; review the permissions before installing. |
| **Chairs Up does not appear** | Confirm the lesson is actually the final booking in that room; if it is, collect Console errors and report it. |
| **A script suddenly stops working** | Lectio may have changed its page structure. Check for an updated script and open an Issue if the problem is reproducible. |
| **Only one device/browser has a problem** | Include the device, OS, browser, and browser version in a compatibility report. |

> [!TIP]
> If you have several Lectio userscripts installed, temporarily disable the others and test again. This helps identify extension/script conflicts.

---

## Reporting bugs and ideas

Use **[GitHub Issues](https://github.com/RktRobinhood/Lectio-Scripts/issues)** for reproducible problems, compatibility issues, or improvements.

### Before reporting

1. Confirm you are using the newest **unmodified** version of the script.
2. Reload Lectio and reproduce the problem.
3. Search existing Issues for duplicates.
4. If possible, test with other Lectio userscripts temporarily disabled.
5. Remove private information from screenshots and Console output.

### Include this information

- script/module name and `@version` (or the Manager's own version, if the issue is with the Manager itself)
- browser and browser version
- Tampermonkey version
- device/OS if relevant
- type of Lectio page
- exact steps to reproduce
- expected behaviour
- actual behaviour
- relevant Console error
- redacted screenshot, if useful

A report like this is actionable:

```text
Module: Unread Message Notifications
Version: 0.2.x
Browser: Firefox 154
Tampermonkey: 5.x
Page: Timetable

Steps:
1. Open Lectio.
2. Open the timetable.
3. Reproduce the problem.

Expected:
The unread count updates normally.

Actual:
The badge does not update.

Console:
[paste relevant redacted error here]
```

A report that only says **"it doesn't work"** usually is not enough to diagnose.

---

## Getting Console errors

The browser Console often shows exactly where a userscript failed.

### Open the Console

| Browser | Windows / Linux | macOS |
|---|---|---|
| **Chrome / Edge** | `Ctrl + Shift + J` | `Cmd + Option + J` |
| **Firefox** | `Ctrl + Shift + K` | `Cmd + Option + K` |

You can also press **F12** and choose **Console**.

### Capture the useful part

1. Open the Lectio page where the problem occurs.
2. Open the Console.
3. Enable **Preserve log** if the problem involves reloading or navigation.
4. Reproduce the problem.
5. Copy the red error and its stack trace.
6. Remove private information.
7. Paste it into the GitHub Issue.

Example:

```text
Uncaught TypeError: ...
    at ...
```

You do **not** need to understand the error yourself.

<details>
<summary><strong>What should I redact?</strong></summary>

Before sharing Console text or screenshots, remove:

- student or staff names where appropriate
- private messages
- grades or attendance information
- email addresses or personal identifiers
- URLs containing personal information
- authentication/session information

Replace removed content with:

```text
[REDACTED]
```

**Never publish:**

- Lectio passwords
- session cookies
- authentication tokens
- authorization headers
- full Network/HAR exports
- browser storage containing login/session data
- complete private page source
- unredacted student data

A full Network/HAR dump can contain credentials or session information. For normal bug reports, **reproduction steps + a Console error + a redacted screenshot** are usually enough.

</details>

> [!CAUTION]
> Do not paste unknown commands into the Developer Console. Code entered there runs inside the page you are logged into. Read it first or ask a trusted person or LLM to explain it.

---

## Make it yours with an LLM

These scripts are public JavaScript. You can give the **script itself** to ChatGPT, Claude, Gemini, a local model, or another coding assistant and ask it to explain, audit, or customize the code.

That can be a good way to move from simply using a script to understanding and modifying it.

### Ask an LLM to inspect safety

<details>
<summary><strong>Example prompt: Is this userscript safe?</strong></summary>

```text
I am considering installing this Tampermonkey userscript.

Inspect the actual code and explain:

1. Which websites it can run on.
2. Which Tampermonkey permissions it requests.
3. Whether it sends information to any external website or API.
4. What it stores in my browser.
5. What Lectio information it reads or changes.
6. Anything I should understand before installing it.

Do not modify the code yet.
Explain the security and privacy implications in plain language.
```

</details>

### Change the design or behaviour

Examples:

```text
Change the notification badge from red to dark blue.
Do not change how messages are detected.
Show me exactly what you changed.
```

```text
Change the Chairs Up text to "LAST CLASS — CHAIRS UP".
Do not change the room-checking logic.
```

```text
Change the message-check interval from 10 minutes to 20 minutes.
Change only that behaviour and explain the edit.
```

```text
Explain the major functions in this script as if I am learning JavaScript.
Then help me make one small change myself.
```

### Safer modification workflow

1. Keep an untouched copy of the current working script.
2. Give the LLM the **complete** script.
3. State exactly what should change — and what should not.
4. Ask whether the change adds permissions, storage, or external network requests.
5. Ask for a diff or concise list of changed lines.
6. Save the result under a different `@name` while testing.
7. Test on non-sensitive Lectio pages first.
8. If the change is generally useful, submit an Issue or Pull Request.

For example:

```javascript
// @name         Lectio Message Notifications - My Version
```

> [!IMPORTANT]
> The public JavaScript is fine to share with an LLM. Your private Lectio data is not. Do not provide passwords, cookies, tokens, private messages, grades, or unredacted student information.

---

## Privacy and security

Userscripts are JavaScript with permission to run on specified webpages. Treat them as software.

Before installing or modifying anything:

- read its userscript header and `@match` rules
- review requested permissions
- inspect external network requests
- install code only from a source you trust
- never put your Lectio password into a userscript
- never publish cookies, tokens, or private Lectio data

### Lectio Manager and the catalogue

The Manager fetches `catalogue/modules.json` from this repository over HTTPS and reads it as **text data only** — names, descriptions, versions, and install links. It never executes catalogue content as code, and it only opens install links that point at this repository's own `raw.githubusercontent.com` files.

Detecting whether a module is running uses a small, namespaced browser event (`lectio-manager:discover` / `lectio-module:register`) rather than reading another script's private Tampermonkey storage.

### English Mode and translation

**English Mode can use Google Translate as a fallback.**

Common interface terms are handled by the script, but text it does not recognize may be sent to Google translation endpoints.

The script can declare access to:

```text
translate.googleapis.com
translate.google.com
```

Consider your institution's privacy/data-protection requirements before using translation features on pages containing confidential or personally identifiable information.

### Lectio Theming and palette sources

Lectio Theming only contacts a palette-source URL when you press **Import**. That anonymous request is made from your browser to the URL you supplied, so the destination can receive normal connection metadata such as your IP address. The module reads image pixels or colour values from responses of at most 8 MB; it does not send Lectio page content, cookies, or login details to the palette source. Its broad `@connect *` permission is required because the source website is chosen by you.

A picture you choose with **Choose image** or **Choose picture**, by contrast, never leaves the device at all: it is read by the page, resized in a canvas, and — for a background picture — kept in this browser's own storage for lectio.dk. Nothing uploads it, and clearing your browser's site data for Lectio removes it.

### Subject Colours and your timetable

Subject Colours learns from your own Lectio schedule pages, which it reads the same way your browser already does — a signed-in request to `www.lectio.dk` for your own timetable, a handful of weeks at a time, spaced out and capped. It contacts no other host, declares no `@connect` permission, and has no code path that sends anything anywhere. What it works out (your holds, how often each appears, and the colour assigned to each) is kept in this browser's storage for lectio.dk and nowhere else; clearing your site data for Lectio removes it, as does **Forget what was learned** in its settings. Set **Weeks to learn from** to 0 if you would rather it made no background requests at all and learned only from pages you open yourself.

### GitHub Issues are public

Assume anything attached to an Issue can be seen publicly. Redact screenshots and diagnostic output before posting.

---

## Repository layout

```text
Lectio-Scripts/
├── manager/
│   └── Lectio-Manager.user.js       Discovery + install UI. No feature logic.
├── catalogue/
│   └── modules.json                 Metadata only: what modules exist and where to install them.
├── modules/
│   ├── Lectio-English-Mode.user.js
│   ├── Lectio-Chairs-Up.user.js
│   ├── Lectio-Schedule-Summary.user.js
│   ├── Lectio-Subject-Colours.user.js
│   ├── Lectio-Theming.user.js
│   └── Lectio-Unread-Message-Notifications.user.js
├── assets/
├── .github/                         Issue templates
└── README.md
```

Each module owns its own `@version` and update URL. Adding a new module means adding its file under `modules/` and adding a matching entry to `catalogue/modules.json` — the Manager's own code does not need to change.

---

## Useful links

| Resource | Link |
|---|---|
| Repository | [RktRobinhood/Lectio-Scripts](https://github.com/RktRobinhood/Lectio-Scripts) |
| Lectio Manager | [`manager/Lectio-Manager.user.js`](https://github.com/RktRobinhood/Lectio-Scripts/tree/main/manager) |
| Modules | [`/modules`](https://github.com/RktRobinhood/Lectio-Scripts/tree/main/modules) |
| Catalogue | [`catalogue/modules.json`](https://github.com/RktRobinhood/Lectio-Scripts/tree/main/catalogue) |
| Report a problem or idea | [GitHub Issues](https://github.com/RktRobinhood/Lectio-Scripts/issues) |
| Tampermonkey | [tampermonkey.net](https://www.tampermonkey.net/) |
| Installing userscripts | [Tampermonkey FAQ](https://www.tampermonkey.net/faq.php?q=Q102) |
| Chrome/Edge userscript permission | [Tampermonkey FAQ](https://www.tampermonkey.net/faq.php?locale=en&q=Q209) |
| Tampermonkey documentation | [Documentation](https://www.tampermonkey.net/documentation.php) |

---

## License

This repository is released under the **GNU General Public License v3.0**.

See **[LICENSE](LICENSE)**.

---

### Disclaimer

These scripts are independent customizations for Lectio. Lectio, browsers, and Tampermonkey can change over time, so a working script may occasionally require maintenance after an update.

Use the scripts in accordance with your institution's IT, privacy, and data-protection policies.
