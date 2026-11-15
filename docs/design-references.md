# Charta dark interface references

Reviewed on 15 November 2026. Charta remains a static, buildless browser application backed by its existing content format.

## Gradient Components and Puliatti

The CSS primitives in `web/gradient-components.css` adapt [Alex Puliatti's Gradient Components](https://github.com/alexpuliatti/gradient-components), pinned to [revision `4ba7a657985e898f3a96767ebdcea5a9ce488d83`](https://github.com/alexpuliatti/gradient-components/tree/4ba7a657985e898f3a96767ebdcea5a9ce488d83). Upstream declares MIT in [package.json](https://github.com/alexpuliatti/gradient-components/blob/4ba7a657985e898f3a96767ebdcea5a9ce488d83/package.json) and [README.md](https://github.com/alexpuliatti/gradient-components/blob/4ba7a657985e898f3a96767ebdcea5a9ce488d83/README.md).

The reusable source is [src/index.css](https://github.com/alexpuliatti/gradient-components/blob/4ba7a657985e898f3a96767ebdcea5a9ce488d83/src/index.css): gradient lines, dividers, borders, and underlines. Charta retains recognizable class names and the underlying CSS approach while adapting sizing, colors, states, and motion for a library interface. Folder-tree trunks and curved branches use these gradient-line primitives, with vertical tapering and brighter hover, focus, and active states. React, Framer Motion, the demo application, and its remote font imports are not required for this static integration. See [the retained notice](../web/vendor/GRADIENT-COMPONENTS-NOTICE.md).

[Puliatti.com](https://puliatti.com/) supplies the visual direction: near-black surfaces, white editorial typography, restrained navigation, fine dividers, and selective gradients. Its inspected [stylesheet](https://puliatti.com/assets/index-ChwioXR4.css) declares `#030303` background, `#FAFAFA` foreground, Geist typography, and translucent active navigation pills. This reference is visual inspiration, rather than a copy of the portfolio application.

## Earlier network references

The user's orbital diagram reference provides concentric guides, outlined nodes, abbreviated labels, and generous negative space. [Flywheel](https://flywheel.paradigma.inc/) adds graph-focused navigation, category-sensitive node colors, quiet edges, and orbital grouping. Its public application has separate orbit and edge palette tokens, along with component-placement logic for concentric ring layouts. Charta's graph implementation is independent; Flywheel's application bundles are not included.

The network contains text and link materials such as articles, tweets, threads, and notes. Image, video, audio, and file records remain outside the network. The earlier orbital layout has been replaced by focused Connections. Saved tags, direct links, and reviewed suggestions establish the current relationships; categories and collection membership provide filters and context.

## Orbserve

[Orbserve](https://github.com/jnsahaj/orbserve/tree/71a79d256bf29f1f5a66b55d73b3bb7d9eb673f3) is an image-to-particle-motion tool built with React, PixiJS, and Rapier. It is not a graph-layout library. Its [README](https://github.com/jnsahaj/orbserve/blob/71a79d256bf29f1f5a66b55d73b3bb7d9eb673f3/README.md) describes physics-driven image particles and video export.

Charta takes visual cues from its floating controls and focused canvas workspace. Orbserve's source, shaders, physics runtime, and media are not copied. The inspected repository contains no license declaration or standalone license file. Charta does not add those dependencies for the network redesign.
# Implemented workspace

The homepage centers the dashboard horizontally and vertically in the workspace beneath the toolbar. The dithered background has been removed in favor of a plain charcoal canvas and opaque card surfaces. The existing Gradient Components adaptations provide a tapered brand accent and hover/focus underlines. The activity palette and small decorative orbital SVG share the blue, lilac, and peach accents. Cards align to the search width and stack on smaller screens; short viewports scroll naturally.

The page keeps real archive activity and recent collections, and a persistent desktop icon rail. The mobile drawer and general dialogs use blurred translucent backgrounds with opaque fallbacks. These are Charta controls and data; no third-party product branding or dashboard data is included.

## Search and React Bits

The search box adapts [Spotlight Card](https://reactbits.dev/components/spotlight-card) and [Prompt Bar](https://reactbits.dev/micro/prompt-bar) into a compact charcoal input surface with a separate action strip and a restrained pointer-following light. Clicking no longer outlines the enclosing card. Keyboard focus stays on the individual control.

The homepage and header provide directly editable search fields, with results appearing underneath after typing. The search dropdown adapts [Animated List](https://reactbits.dev/components/animated-list) and [Glide Select](https://reactbits.dev/micro/glide-select): distinct icon tiles, compact metadata, and a shared selection surface that moves between rows. Arrow keys select results while focus stays in the combobox; Enter opens the selected result. Keyboard and reduced-motion interactions remain immediate. [Warm Tooltip](https://reactbits.dev/micro/warm-tooltip) informs the topbar and action hints: the first hover waits, and adjacent hints appear immediately while warm.

Search continues to use the existing plain JavaScript implementation. [Retained attribution and license](../web/vendor/REACT-BITS-NOTICE.md) identify the references. Rubber Segment, Wake Slider, Branched Menu, and Shredder were reviewed for matching controls; they are not part of search.

Connections uses the actual [Animated List](https://reactbits.dev/components/animated-list) and [Branched Menu](https://reactbits.dev/micro/branched-menu) React components, installed from the official JS-CSS registry. `web/components/connections.jsx` mounts them inside the existing application. The list provides upstream selection and keyboard behavior; the map uses upstream folding, SVG branches, and active-path drawing. Charta supplies reading titles, explanations, ranking, previews, and history. Categories and folders filter results without creating relationships on their own. Source hashes, local keyboard patches, and the retained license are documented in [the React Bits notice](../web/vendor/REACT-BITS-NOTICE.md).

## Artefact viewer and control references

The centered artefact popup takes its translucent surfaces and reflective edges from the [React Bits Glass Surface](https://reactbits.dev/components/glass-surface) reference. The artefact appears alone initially; the plus button reveals information in a separate column, or a separate row on small screens, keeping the media and playback controls unobstructed. Images and players fit their available space. These controls use native dialogs and CSS.

Icon labels adapt the grouped timing of [Warm Tooltip](https://reactbits.dev/micro/warm-tooltip): the first hover waits briefly, nearby labels then appear immediately, and keyboard focus reveals a label immediately. The implementation is independent native JavaScript.

Charta applies [Glide Select](https://reactbits.dev/micro/glide-select) to browse filters, [Rubber Segment](https://reactbits.dev/micro/rubber-segment) to view and material-type switches, [Prompt Bar](https://reactbits.dev/micro/prompt-bar) to Add resource, [Wake Slider](https://reactbits.dev/micro/wake-slider) to canvas zoom. [Shredder](https://reactbits.dev/micro/shredder) feedback appears only when discarding a pending attachment; deleting saved content retains its confirmation and save behavior. These are scoped native JavaScript/CSS adaptations with keyboard access, immediate keyboard feedback, and reduced-motion support.

