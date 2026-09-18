# modules-unstable

Experimental overlay used by Lectio Manager 2.x.

This folder does not replace `modules/` and does not require a separate Git branch. Stable users continue to use the normal stable catalogue and stable module files unless they explicitly change their own Lectio Manager setting to **Unstable**.

## Files in this test pack

### `Lectio-Unstable-Channel-Test.user.js`
A harmless diagnostic module. It:

- runs on Lectio pages;
- registers itself with Lectio Manager as version `0.1.1-beta.1`;
- adds a small **UNSTABLE TEST** button above the Manager gear;
- shows a small information panel when clicked;
- does not modify Lectio records, messages, grades, attendance, or account data.

Its purpose is to prove that an unstable-only module becomes visible only when the Manager is set to Unstable.

### `Lectio-Unread-Message-Notifications.user.js`
A version-channel test copy of the existing Unread Message Notifications userscript.

The feature logic is intentionally kept the same as the stable snapshot used to create this test file. The test copy changes only release plumbing:

- version is deliberately set to `99.0.0-beta.1`;
- `@updateURL` and `@downloadURL` point to `modules-unstable/`;
- it registers its installed version with Lectio Manager;
- it includes several catalogue ID aliases so it can match the existing stable module even if the stable catalogue uses a slightly different ID.

The high version number is deliberate. In Unstable mode the Manager should offer an **Upgrade** from the stable version to `99.0.0-beta.1`. After that is installed, switching the Manager back to Stable should make the Manager compare the installed `99.0.0-beta.1` against the stable catalogue version and offer a **Downgrade**.

## Promotion rule

Do not promote the `99.0.0-beta.1` test version to stable. It exists only to exercise the channel/version plumbing.

For real development, create or copy a module into this folder, use a normal beta progression such as `1.4.1-beta.1`, test it here, and then copy the tested code into `modules/` with a normal stable version such as `1.4.1`.
