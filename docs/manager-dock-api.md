# Lectio Manager dock API

The Manager owns one compact dock on the left of the viewport. It stays completely hidden and non-interactive while no module has a visible item. Modules remain standalone Tampermonkey userscripts and communicate with it through DOM `CustomEvent`s; they do not import Manager code or manipulate the dock DOM.

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

Stable identifiers are required. `moduleId` and `itemId` must start with a letter or digit and then use only letters, digits, `.`, `_`, or `-`; `:` is reserved as the Manager's collision-free compound-key separator. Labels are accessible names, not identifiers. Supported bundled icon keys are `mail`, `translate`, `chair`, `refresh`, `settings`, `calendar`, `warning`, `info`, `bell`, and `wrench`; unknown keys receive a safe fallback icon.

The Manager owns icon size, badge rendering, tooltip placement, item order, adaptive overflow, screen position, z-index, and flyout chrome. Do not include positioning data or raw button HTML in a registration.

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

## Ordering and cleanup

Users can drag items or press Ctrl+Arrow Up/Down while an item is focused. The Manager persists their order. New items follow known items and then use `defaultPriority`; removing an item does not corrupt saved ordering.

Register again when Discovery fires so the dock recovers regardless of Manager/module startup order. Remove items when a module has a real runtime unload path. A failure in one activation or panel listener must not make another module depend on its state.

The unstable channel test module in [`modules-unstable/Lectio-Unstable-Channel-Test.user.js`](../modules-unstable/Lectio-Unstable-Channel-Test.user.js) is the reference `panel` implementation.

## Initial migration inventory

| Module | Current persistent UI | Placement | Dock fit | Migration note |
|---|---|---|---|---|
| Unstable Channel Test | Diagnostic launcher and details | Former fixed chip/panel | `panel` | Migrated as the v1 reference; no module-owned coordinates remain. |
| English Mode | Global DA/EN switch and transient toast | Fixed viewport control | `toggle` | Good next candidate, but medium complexity because users already configure the switch position. Keep the toast module-owned. |
| Subject Colours | Collapsible colour key on schedule pages | Fixed contextual legend | Possibly `panel` | Defer: the legend is page-specific and may remain page-local under the dock rule. |
| Unread Message Notifications | Badge attached to Lectio's Messages navigation | In-page navigation badge | Possibly `status`/`panel` | Defer: its current UI belongs to the Messages link rather than a free-floating HUD. |
| Chairs Up | Urgent notice/dialog surfaces | Page-local overlays | Poor | Keep page-local because the warning is contextual and time-sensitive, not a global launcher. |
| Schedule Summary | Compact schedule row | In-page schedule content | None | Keep page-local; it is not persistent global UI. |
