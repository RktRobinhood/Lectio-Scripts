# Lectio Manager dock API

The Manager owns one compact dock. It stays completely hidden and non-interactive while no module has a visible item. Modules remain standalone Tampermonkey userscripts and communicate with it through DOM `CustomEvent`s; they do not import Manager code or manipulate the dock DOM.

Where the dock sits is the user's choice, not the module's: they pick a screen edge (left by default, or right, top, or bottom) and a position along that edge. A left or right dock is a column; a top or bottom dock is a row. A module never needs to know which — the Manager places every item, tooltip, and flyout itself.

## Register an item

Dispatch `lectio-manager:dock:register` after startup and whenever `lectio-manager:discover` fires. Registration is idempotent: the same `moduleId` + `itemId` updates the existing item instead of creating a duplicate.

```javascript
window.dispatchEvent(new CustomEvent('lectio-manager:dock:register', {
  detail: {
    moduleId: 'my-module',
    itemId: 'main',
    type: 'action', // action | toggle | panel | status
    icon: 'refresh',
    label: 'Refresh my module',
    tooltip: 'Refresh now',
    badge: 3,
    state: 'default', // default | active | busy | warning | error | disabled
    enabled: true,
    visible: true,
    defaultPriority: 100
  }
}));
```

Stable identifiers are required. `moduleId` and `itemId` must start with a letter or digit and then use only letters, digits, `.`, `_`, or `-`; `:` is reserved as the Manager's collision-free compound-key separator. Labels are accessible names, not identifiers. Supported bundled icon keys are `mail`, `translate`, `chair`, `refresh`, `settings`, `calendar`, `warning`, `info`, `bell`, `wrench`, `palette`, and `radar`; unknown keys receive a safe fallback icon.

The Manager owns icon size, badge rendering, tooltip placement, item order, adaptive overflow, screen position, z-index, and flyout chrome. Do not include positioning data or raw button HTML in a registration.

This page is the module-facing side. What the Manager signals on its own behalf — the update count and problem mark on its gear — and why none of it ever goes on the dock is [`docs/manager-signals.md`](./manager-signals.md).

### `label` and `tooltip` may be translated

Either field may be a plain string, or the same `{ en, da }` object a catalogue entry's `i18n` block uses:

```javascript
label: { en: 'Lectio Change Radar', da: 'Lectio Ændringsradar' },
tooltip: { en: '3 unseen Lectio changes.', da: '3 usete Lectio-ændringer.' }
```

A plain string is shown as written, in whatever language it was written in — that is what every module registering one today already gets, and it does not need to change. Only the languages in [ADR-0013](./adr/0013-one-script-per-module-both-languages-inline.md) are read; any other key in the object is ignored, and an object with no usable text is treated as absent.

**The Manager resolves the value at render time, not at registration time.** So a module registers once with both languages and never listens for `lectio-manager:language`: when the person switches, the Manager repaints its own dock, and the tooltip and label already on screen change with it. A module that would rather re-register on a language change may still do so — registration is idempotent — but it does not have to.

Only the module's own prose travels this way. The Manager never translates a module string; it picks between the ones the module supplied. The chrome the Manager wraps around a label — the badge's "3 notifications" in the accessible name — is the Manager's own text and is translated by the Manager.

### What reaches a screen reader

The Manager builds the accessible name from `label` (with the badge count appended when there is one) and the accessible description from `tooltip`, both on the button itself. The visual tooltip is a separate, decorative surface: it appears on `pointerenter` **and on keyboard focus**, stays up for as long as the pointer or focus rests on the item, and is dismissed by leaving, by clicking the item, by opening a flyout, by starting a drag, and by <kbd>Esc</kbd>. Another module registering or updating its own item does not dismiss it. A module supplies the text and nothing else; it must not add a `title` attribute or a tooltip of its own to a dock item.

## React to activation

Listen for `lectio-manager:dock:activate` and filter by both identifiers:

```javascript
window.addEventListener('lectio-manager:dock:activate', (event) => {
  const { moduleId, itemId, type, value } = event.detail || {};
  if (moduleId !== 'my-module' || itemId !== 'main') return;

  // Run the module action. For a toggle, value is the new boolean state.
});
```

Callback functions are deliberately not stored in the registration. Event replies work across the Manager's and module's separate userscript sandboxes.

## Update and remove

Updates are patch-based:

```javascript
window.dispatchEvent(new CustomEvent('lectio-manager:dock:update', {
  detail: {
    moduleId: 'my-module',
    itemId: 'main',
    patch: { badge: 7, state: 'active' }
  }
}));
```

Remove one item during teardown, or omit `itemId` to remove every item belonging to the module:

```javascript
window.dispatchEvent(new CustomEvent('lectio-manager:dock:remove', {
  detail: { moduleId: 'my-module', itemId: 'main' }
}));
```

## Manager-owned panels

A `panel` item opens a flyout positioned by the Manager. Render only inside the supplied mount node:

```javascript
window.addEventListener('lectio-manager:dock:render-panel', (event) => {
  const { moduleId, itemId, mount, close } = event.detail || {};
  if (moduleId !== 'my-module' || itemId !== 'main' || !mount) return;

  const heading = document.createElement('strong');
  heading.textContent = 'My module';
  mount.appendChild(heading);

  // Call close() after a completed panel action when appropriate.
});
```

Only one dock panel is open at once. The Manager closes it on Escape, outside click, a second activation, or item removal. The module may style content inside `mount`, but must not position the flyout shell or inject styles into the shared dock chrome.
Each opening receives a disposable mount node. It is disconnected when that panel closes or another panel opens; modules should treat `mount.isConnected === false` as the end of that rendering session.

## Falling back when the Manager is absent

A module that had its own floating control before the dock existed keeps that control as a fallback, because the module must still work installed on its own. The recommended default is an `auto` setting rather than a fixed choice:

- `auto` — the dock whenever the Manager is on the page, the module's own floating control once it is clear it is not;
- `dock` and `floating` — explicit overrides for people who want one or the other regardless.

Discovery alone cannot tell a module whether the Manager is on the page. Tampermonkey injects the Manager and every module at `document-idle` in an order nothing controls, and the Manager fires its one start-up `lectio-manager:discover` synchronously during its own evaluation — so a module evaluated *after* the Manager has no listener attached when that event goes out, and never hears it (issue #66). The Manager builds its dock root, `#lectio-manager-dock-root`, during that same boot, before Discovery, and never removes it. A module resolving `auto` should treat that element's presence as the Manager being on the page — reading it, never touching it — and keep listening for Discovery, which covers the other order.

When neither is there yet, Discovery may still arrive a moment after page load, so resolving `auto` straight to `floating` would show a floating control that immediately jumps into the dock. Hold the decision for a short grace window (2.5s in Subject Colours and Change Radar), render nothing until it closes, and re-render once either Discovery fires or the window expires — including moving a control that was waiting into the dock the moment Discovery fires, rather than on some later redraw. Clear the timer on `pagehide`.

## Ordering and cleanup

Users can drag items or press Ctrl with an arrow key while an item is focused. The Manager persists their order. New items follow known items and then use `defaultPriority`; removing an item does not corrupt saved ordering.

Register again when Discovery fires so the dock recovers regardless of Manager/module startup order. Remove items when a module has a real runtime unload path. A failure in one activation or panel listener must not make another module depend on its state.

The unstable channel test module in [`modules-unstable/Lectio-Unstable-Channel-Test.user.js`](../modules-unstable/Lectio-Unstable-Channel-Test.user.js) is the reference `panel` implementation.

## Initial migration inventory

| Module | Current persistent UI | Placement | Dock fit | Migration note |
|---|---|---|---|---|
| Unstable Channel Test | Diagnostic launcher and details | Former fixed chip/panel | `panel` | Migrated as the v1 reference; no module-owned coordinates remain. |
| English Mode | Global DA/EN switch and transient toast | Fixed viewport control | `toggle` | Good next candidate, but medium complexity because users already configure the switch position. Keep the toast module-owned. |
| Subject Colours | Optional colour key on schedule pages | Manager dock, or floating | `panel` | Migrated. Defaults to Automatic: the dock when the Manager answers Discovery, the floating key when nothing does. |
| Lectio Change Radar | Radar HUD and change log | Manager dock, or floating | `panel` | Migrated. Defaults to Automatic; the unseen count and urgency state become the dock badge and item state. |
| Unread Message Notifications | Badge attached to Lectio's Messages navigation | In-page navigation badge | Possibly `status`/`panel` | Defer: its current UI belongs to the Messages link rather than a free-floating HUD. |
| Chairs Up | Urgent notice/dialog surfaces | Page-local overlays | Poor | Keep page-local because the warning is contextual and time-sensitive, not a global launcher. |
| Schedule Summary | Compact schedule row | In-page schedule content | None | Keep page-local; it is not persistent global UI. |
