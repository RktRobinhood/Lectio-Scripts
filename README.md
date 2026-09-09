# Lectio Scripts

Small, unofficial **Tampermonkey userscripts** that add useful features to [Lectio](https://www.lectio.dk/).

They run locally in your browser while you use Lectio. Install only the scripts you want; each works independently.

> [!NOTE]
> This project is not affiliated with or endorsed by Lectio or Tampermonkey.

---

## Contents

- [Scripts](#scripts)
- [Quick install](#quick-install)
- [Tampermonkey setup](#tampermonkey-setup)
- [Phones and tablets](#phones-and-tablets)
- [Using and updating scripts](#using-and-updating-scripts)
- [Troubleshooting](#troubleshooting)
- [Reporting bugs and ideas](#reporting-bugs-and-ideas)
- [Getting Console errors](#getting-console-errors)
- [Make it yours with an LLM](#make-it-yours-with-an-llm)
- [Privacy and security](#privacy-and-security)
- [Useful links](#useful-links)
- [License](#license)

---

## Scripts

All scripts are designed for Lectio and are intended to work across Lectio installations.

| Script | What it does | Best for |
|---|---|---|
| **[Chairs Up](scripts/Chairs%20Up.js)** | Marks a lesson when it is the **last booking of the day in that room**. | Teachers |
| **[English Mode](scripts/English%20Mode.js)** | Adds a **DA / EN** switch and translates the Lectio interface into context-aware English. | Students and staff |
| **[Unread Message Notifications](scripts/Unread%20Message%20Notifications.js)** | Shows unread messages beside **Beskeder / Messages** and plays a soft chime when the unread count increases. | Students and staff |

You can install one, several, or all of them.

---

## Quick install

For most users, this is all you need:

1. Install **[Tampermonkey](https://www.tampermonkey.net/)**.
2. Open the script you want in the [`/scripts`](scripts/) folder.
3. Copy the **entire JavaScript file**.
4. Click the Tampermonkey icon.
5. Choose **Create a new script...**
6. Delete Tampermonkey's example code.
7. Paste the Lectio script.
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

- [Chairs Up — Raw](https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/scripts/Chairs%20Up.js)
- [English Mode — Raw](https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/scripts/English%20Mode.js)
- [Unread Message Notifications — Raw](https://raw.githubusercontent.com/RktRobinhood/Lectio-Scripts/main/scripts/Unread%20Message%20Notifications.js)

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

### Mobile notes for these scripts

**English Mode** should generally translate Lectio normally, although very narrow screens may expose layout issues.

**Chairs Up** uses normal Lectio timetable information, but the visual marker may appear differently on a mobile layout.

**Unread Message Notifications** works while Lectio is open, but it is **not a native push-notification service**. Phones often suspend background browser tabs, so do not expect reliable alerts while the browser is closed or Lectio is suspended.

When you return to Lectio, the script can check again. The notification sound may also require one tap or other interaction with the page before the browser allows audio.

Official mobile links:

- [Tampermonkey versions and mobile options](https://www.tampermonkey.net/faq.php?q=Q406)
- [Microsoft Edge mobile extensions](https://microsoftedge.microsoft.com/addons/collections/mobile_android_extensions)
- [Tampermonkey for Firefox Android](https://addons.mozilla.org/en-US/android/addon/tampermonkey/)
- [Tampermonkey for iPhone/iPad](https://apps.apple.com/dk/app/tampermonkey/id6738342400)

> [!NOTE]
> Mobile support for the scripts is still worth testing across different devices and browsers. If something looks or behaves incorrectly, please report it.

---

## Using and updating scripts

### Check that a script is running

1. Open Lectio.
2. Click the Tampermonkey icon.
3. Make sure Tampermonkey is **Enabled**.
4. Open **Dashboard** if needed.
5. Confirm the Lectio script is enabled.
6. Reload Lectio.

### Install several scripts

Repeat the normal installation process for each file. They appear separately in the Tampermonkey Dashboard.

### Update

Scripts installed by copy-paste should be treated as **manual installations** unless their userscript metadata says otherwise.

To update:

1. Open the newest version in this repository.
2. Copy the entire script.
3. Open the installed script in **Tampermonkey → Dashboard**.
4. Replace the old code.
5. Save.
6. Reload Lectio.

The installed version can usually be found near the top of the script:

```javascript
// @version ...
```

### Disable or remove

To temporarily disable a script, switch it **Off** in the Tampermonkey Dashboard and reload Lectio.

To remove it completely, delete it from the Dashboard. Nothing needs to be removed from Lectio itself.

---

## Troubleshooting

| Problem | What to try |
|---|---|
| **Nothing happens** | Confirm Tampermonkey and the script are enabled, reload Lectio, and check Chrome/Edge userscript permissions. |
| **GitHub Raw only shows JavaScript** | Copy the complete file and use **Create a new script...** instead. |
| **English translation is incomplete** | Reload, switch **DA → EN**, and report repeatable untranslated text. |
| **English Mode requests extra permissions** | It can use Tampermonkey storage and Google Translate fallback; review the permissions before installing. |
| **Message sound does not play** | Interact with the Lectio page once, check tab/system audio, and remember that the first unread check is deliberately silent. |
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

- script name and `@version`
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
Script: Unread Message Notifications
Version: 1.x
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

Before installing or modifying a script:

- read its userscript header and `@match` rules
- review requested permissions
- inspect external network requests
- install code only from a source you trust
- never put your Lectio password into a userscript
- never publish cookies, tokens, or private Lectio data

### English Mode and translation

**English Mode can use Google Translate as a fallback.**

Common interface terms are handled by the script, but text it does not recognize may be sent to Google translation endpoints.

The script can declare access to:

```text
translate.googleapis.com
translate.google.com
```

Consider your institution's privacy/data-protection requirements before using translation features on pages containing confidential or personally identifiable information.

### GitHub Issues are public

Assume anything attached to an Issue can be seen publicly. Redact screenshots and diagnostic output before posting.

---

## Useful links

| Resource | Link |
|---|---|
| Repository | [RktRobinhood/Lectio-Scripts](https://github.com/RktRobinhood/Lectio-Scripts) |
| Scripts | [`/scripts`](https://github.com/RktRobinhood/Lectio-Scripts/tree/main/scripts) |
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
