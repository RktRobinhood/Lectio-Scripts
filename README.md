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

- shows a **catalogue** of every available module, fetched from this repository (`catalogue/modules.json`),
- lets you **install** a module with one click, using Tampermonkey's own install screen,
- shows whether a module is currently **detected as running**,
- caches the catalogue locally and refreshes it automatically at most once every 24 hours, with a manual refresh button whenever you want the latest list,
- has a single **navigation menu** (tap the row under "Last refreshed") for moving between All modules, Installed, an audience (Student / Teacher), or a category — plus a Category/Name sort — so the panel stays navigable as the module library grows,
- has one **wrench button** in the header that opens Tampermonkey's own dashboard directly, for disabling, updating, or removing any script — since that dashboard already lists everything installed, there's no need for a separate button per module,
- has a **Report a bug or idea** link at the bottom of the panel, straight to this repository's GitHub Issue templates.

The Manager itself contains **no feature logic**. Translation, message polling, room logic, and every other feature live entirely inside their own independent module. Installing only the Manager and one module means only that module's code ever runs — nothing else is downloaded or executed.

Look for a small teal gear button in the bottom-right corner of any Lectio page after installing it.

> [!NOTE]
> The Manager can only tell a module is installed if that module is currently **enabled and running** and replies to the Manager's handshake. If a module was disabled directly in Tampermonkey, or simply isn't installed, the Manager shows the same honest **"Not detected"** status either way — it cannot tell those two states apart.

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
| **[Unread Message Notifications](modules/Lectio-Unread-Message-Notifications.user.js)** | Shows an unread-message badge beside **Beskeder / Messages**. Currently limited to Lectio school `223`. | Students and staff at that school |
| **[Lectio Theming](modules/Lectio-Theming.user.js)** | Applies a soft, translucent glass shell with **26 built-in colour schemes** (Catppuccin, Nord, Dracula, Cyberpunk and more), each with a matching generated background, or derive your own from an **image or website URL**. | Students and staff |

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

Installed modules can expose their own settings in the Manager. Open Lectio Tools, find an installed module, and choose **Settings**. The Manager only renders these controls; each independent module owns and applies its values.

For Lectio Theming, pick a **Theme** from 26 built-in colour schemes (Catppuccin, Nord, Dracula, Gruvbox, Solarized, Tokyo Night, Rosé Pine, Everforest, One Dark, Monokai Pro, Ayu, Kanagawa, Nightfox, Oxocarbon, Material Ocean, GitHub, Cyberpunk Neon, Synthwave '84, and more) — each keeps its own authentic light or dark look and a matching generated background style. To use your own colours instead, choose **Imported palette**, then paste an HTTPS image or website URL into **Palette source** and choose **Import**, or use **Choose image** for a local file that never leaves the browser; the **Light or dark** setting only affects this imported palette. Direct image URLs give the most predictable result; website imports use colours found in the page and up to six linked stylesheets.

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

### Install several modules

Repeat the install steps for each one, through the Manager or manually. They appear separately in the Tampermonkey Dashboard.

### Disable or remove

To temporarily disable a script, switch it **Off** in the Tampermonkey Dashboard and reload Lectio. The Manager will then correctly show that module as **"Not detected"**.

To remove it completely, delete it from the Dashboard. Nothing needs to be removed from Lectio itself, and nothing needs to be removed from the Manager either — an uninstalled module simply disappears from the "installed" state the next time the Manager asks.

---

## Troubleshooting

| Problem | What to try |
|---|---|
| **Nothing happens** | Confirm Tampermonkey and the script are enabled, reload Lectio, and check Chrome/Edge userscript permissions. |
| **No gear button appears** | Confirm the Lectio Manager script is installed and enabled in the Tampermonkey Dashboard, then reload Lectio. |
| **The Manager's module list is empty or stuck loading** | This means it has never successfully fetched the catalogue. Check your connection and click the manual refresh (circular arrow) button. |
| **A module always shows "Not detected" even though it's installed** | Confirm it is **enabled** (not just installed) in the Tampermonkey Dashboard, then reload Lectio. The Manager cannot distinguish "disabled" from "never installed." |
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
