# Blockplan

A day and week planner built from time blocks. You keep a pile of things to do (the tray), then drag them onto a horizontal timeline. A block's width is its duration.

## How it works

- **Types** have a name and one of ten colors. Day and week plans share types, so a color means the same thing everywhere.
- **Blocks** have a name, type, and length. Day blocks use 15-minute steps. Week blocks use whole hours, and a week's timeline runs through each day's planning hours from Monday to Sunday, so “Half day” is half a day wide.
- **Reusable** blocks stay in the tray when placed; a copy goes on the timeline.
- Overlapping blocks stack into lanes. Week blocks that fall on a day appear as a thin strip above that day's timeline.

## Interactions

| Action | Mouse | Touch | Keyboard |
| --- | --- | --- | --- |
| Place | Drag to the timeline, or click to pick up and click a time | Press and hold, then drag, or tap to pick up and tap a time | Enter on a tray block, then **Next free time** |
| Move | Drag along the timeline | Press, hold, drag | ← / → by one step |
| Resize | Drag the right edge | Drag the right edge | Shift + ← / → |
| Unplan | Drag back to the tray | Drag back to the tray | Delete |
| Edit | Click | Tap | Enter |

Ctrl/⌘ Z undoes any change. Press N for a new block. Typing a length after a name (“Write report 90m”, “Gym 1h30”, “Offsite 1d”) sets the length.

## Code

- `model.js`: pure planning logic (dates, durations, lanes, placement, validation). Unit tested in `tests/blockplan.test.js`.
- `store.js`: the plan is saved on the device first. When signed in, it syncs to `users/{uid}/apps/blockplan/data/state` through the shared platform. Guest and account copies use separate local keys.
- `drag.js`: a single pointer controller for mouse, pen, and touch, with edge auto-scroll.
- `app.js`: rendering, sheets, and wiring. Browser tests are in `tests/browser/blockplan.spec.js`.
