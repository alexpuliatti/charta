# React Bits components and references

## Installed React components in Connections

Connections renders the official **Animated List** and **Branched Menu** React components from React Bits, using React and React DOM. The source files and CSS were installed by hand from the official `JS-CSS` registry on 15 November 2026, following React Bits’ documented source installation method:

- `https://reactbits.dev/r/AnimatedList-JS-CSS.json`
- `https://reactbits.dev/r/BranchedMenu-JS-CSS.json`

The installed source is in `web/vendor/react-bits/`. `source.json` records each registry payload hash, each original source-file SHA-256, and all local patches. `scripts/build-components.mjs` reverses those documented patches to verify the exact upstream bytes before bundling. The upstream component implementations and their CSS are retained; these are not native JavaScript recreations.

`web/components/connections.jsx` supplies Charta reading data, accessible labels, selection callbacks, and theme variables. Animated List has three small documented keyboard-accessibility changes: keyboard selection snaps the indicator, and its two keyboard scroll calls use immediate scrolling. Branched Menu is unchanged. The adjacent `LICENSE.md` retains the upstream license. The generated local bundles contain React, React DOM, and the icon dependencies and do not contact a CDN at runtime.

## Installed Orb component in Ask archive

The **Ask archive** thinking display renders the official [Orb](https://reactbits.dev/backgrounds/orb) React component, installed by hand from `https://reactbits.dev/r/Orb-JS-CSS.json` on 15 November 2026. Its JSX and CSS live in `web/vendor/react-bits/`, with upstream hashes and the single local patch recorded in `source.json`. The patch marks the first rendered WebGL frame so the static CSS fallback is hidden only after the Orb successfully draws.

`web/components/archive-thinking.jsx` sets the muted lavender and blue palette, disables pointer effects, and pauses the Orb for reduced motion. Changes to the motion preference remount the component so its internal preference snapshot stays current. `web/research.mjs` loads the bundled component when showing a running question and destroys its React root when the request finishes, fails, is cancelled, or its view is left. A late module download cannot mount a cancelled animation. Background research continues when the view is left; returning to a running question mounts a fresh Orb. The upstream component releases its frame loop, observers, listeners, and WebGL resources on unmount and pauses while the document is hidden or the Orb is outside the viewport. The static ring remains available if the module or WebGL cannot load, or the context is lost. The local bundle needs no CDN or extra runtime dependencies.

## Native interaction references elsewhere in Charta

Charta's search surface and palette adapt interaction patterns from React Bits by David Haz, reviewed on 15 November 2026:

- [Spotlight Card](https://reactbits.dev/components/spotlight-card): softened pointer-following light, adapted to plain JavaScript and CSS.
- [Prompt Bar](https://reactbits.dev/micro/prompt-bar): a compact input surface with a separate action strip.
- [Animated List](https://reactbits.dev/components/animated-list) and [Glide Select](https://reactbits.dev/micro/glide-select): rounded result rows, a moving selection surface, and arrow-key navigation.
- [Warm Tooltip](https://reactbits.dev/micro/warm-tooltip): delayed first hint followed by instant neighboring hints.

Additional Charta controls adapt the following micro interactions:

- Glide Select: filter chips with anchored popovers, a gliding row highlight, and keyboard/typeahead selection (`glide-select.mjs`). The underlying native select still provides form values and change events.
- [Rubber Segment](https://reactbits.dev/micro/rubber-segment): a stretching selection pill for grid/list, connection view, and material type switches (`micro.mjs`).
- Prompt Bar: the Add resource composer groups attachments and submission inside its input surface, grows with pasted text, and supports Command/Control + Enter (`resources.mjs`).
- [Wake Slider](https://reactbits.dev/micro/wake-slider): canvas zoom uses an accessible native range input over bars that react to adjustment speed (`micro.mjs`, `canvas.mjs`).
- [Shredder](https://reactbits.dev/micro/shredder): discarding a pending attachment has a short strip animation. Saved materials retain their existing confirmation and save flow (`micro.mjs`).

These implementations are scoped to Charta in `search-ui.mjs`, `search.css`, `tooltips.mjs`, `micro.mjs`, `micro.css`, and `glide-select.mjs`. Folder navigation uses the separately attributed [Gradient Components primitives](GRADIENT-COMPONENTS-NOTICE.md). Those native adaptations do not use the React components. The Connections integration described above does include React and the official components. Keyboard interactions remain immediate; reduced-motion preferences suppress decorative movement.

Upstream source: https://github.com/DavidHDev/react-bits

Upstream license: https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md

## License retained from upstream

MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

## Commons Clause Restriction

You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**

The same restriction covers the React Bits tools (Background Studio, Texture Lab, Shape Magic, Center Stage, Sound Lab and any tools added later) and the sounds in the sound library. **You may not sell, sublicense, or redistribute the tools or the sounds themselves, or offer the tools or a substantially similar copy of them as a hosted service-whether alone, in a bundle, or as a ported version.**

What you make with the tools is yours to use. You can use exported code, images, videos, and audio files in any personal or commercial application, website, or product, including paid ones. **You may not sell or redistribute the exports on their own, either individually or as the product itself, such as a sound, texture, background, or template pack.**

## No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
