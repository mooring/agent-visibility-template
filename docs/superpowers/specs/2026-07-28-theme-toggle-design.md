# Theme Toggle Design

## Goal

Preserve the existing dark appearance and add a complete white light theme that
users can switch from the page header. The selected theme persists across page
reloads.

## Theme state

The application supports exactly two values: `dark` and `light`. Dark remains
the default when no valid saved value exists. On startup, React reads the
`image-console-theme` local-storage key, applies the valid value, and ignores
any other value.

Changing the theme updates `data-theme` on the document root and writes only
the theme name to local storage. Tokens, URLs, prompts, request parameters,
images, and logs remain in memory and are not persisted.

## Interface

A theme button appears in the hero header and displays the theme the user can
switch to: `Light theme` while dark mode is active and `Dark theme` while light
mode is active. It uses a native button, remains keyboard accessible, and
includes an `aria-label` describing the action.

The hero header allows the control to wrap below the heading on narrow screens.
The request, results, and diagnostics layout otherwise remains unchanged.

## Styling

The existing dark colors become the default CSS custom properties. A
`data-theme="light"` selector overrides the properties for page background,
surface, elevated surface, border, primary and muted text, inputs, buttons,
empty states, logs, links, shadows, and image backgrounds.

Both themes retain the existing purple accent, success, warning, and error
semantics. Light-theme values must maintain readable contrast for labels,
inputs, logs, secondary buttons, and image cards. Component rules consume the
variables rather than duplicating complete dark and light stylesheets.

## Testing

A pure theme helper will validate stored values and return `dark` for missing or
invalid input. Focused tests cover valid dark/light values and fallback behavior.
The production build verifies the React and CSS integration, followed by desktop
and narrow-mobile visual checks in both themes.

## Documentation

The README feature list will describe the persistent dark/light theme toggle.
No deployment configuration or Worker API contract changes are required.
