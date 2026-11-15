# Interface polish review

Reviewed the workspace, search flow, sidebar, ambient texture, and network against the `emil-design-eng` skill. The intended behavior is immediate for repeated keyboard actions, restrained for pointer feedback, and stable while searching.

| Before | After | Why |
| --- | --- | --- |
| Collection pages repeated headings, generic descriptions, counts, tabs, filters, and layout controls. | The default view is a title row and materials; optional controls are in one disclosure. Only active filters add a short status row. | Keep the content primary and reveal controls when needed. |
| Filtering rebuilt the disclosure and could lose keyboard focus. | The open state and focused control survive sorting, filtering, and layout changes; Escape and outside clicks dismiss it. | Preserve context during repeated adjustments. |
| Product copy included repeated slogans and empty metadata prompts. | Generic descriptions, literary captions, footer pitches, and empty summary sections are omitted. Authored text, actual data, errors, and required setup instructions remain. | Remove clutter without losing information or guidance. |
| Search included an extra instructional footer. | The dialog contains the search field and results; the footer row is removed. | Keep the frequent interaction focused on finding and opening material. |
| The results area changed height with the number of matches. | A bounded results area uses `height: min(49dvh, 392px)` with internal scrolling and a stable scrollbar gutter. | Typing no longer moves the surrounding dialog as results change. |
| Each query rebuilt searchable strings for the entire archive and collected every match before slicing. | A search index is cached per catalog snapshot; queries stop after 14 matches. | Reduce repeated allocations and unnecessary work while keeping the existing result limit. |
| Search appeared abruptly for pointer invocation. | A 160 ms entrance changes opacity and moves from `translateY(6px) scale(.985)` using `cubic-bezier(.23, 1, .32, 1)`. | Give an occasional pointer opening a small spatial cue without slowing the interaction. |
| Keyboard shortcuts could receive the same entrance as a pointer opening. | Command/Ctrl+K and `/` explicitly request `animate: false`. | Repeated keyboard actions stay immediate. |
| Enter/Space activation of a search button still used its default animated path. | Both search-button click paths now animate only when `event.detail > 0`. | Keyboard-generated clicks receive the same immediate behavior as shortcuts. This was found and resolved during the review. |
| Button press scaling also applied to keyboard activation. | Pointer presses retain the subtle `.98` scale; `button:focus-visible:active` removes the transform for keyboard activation. | Preserve tactile pointer feedback without moving focused keyboard controls. This was found and resolved during the review. |
| A previous search entrance could remain active while another dialog opened. | `showModal()` cancels the previous entrance before replacing dialog content. | An interrupted interaction cannot leave the next dialog in an old animation state. |
| Motion preferences needed to cover the new search entrance. | Search skips its Web Animations entrance when reduced motion is requested; the base reduced-motion rule disables CSS transitions and smooth scrolling. | Respect the same preference across JavaScript and CSS effects. |
| Decorative effects could introduce repeated movement or an idle rendering loop. | The ambient ribbon texture draws once per size, coalesces resize work, and removes its canvas, observer, and pending frame on destruction. | Keep the visual texture while leaving reading, searching, and graph navigation still. |
| The sidebar had no persistent desktop rail state. | Desktop collapse persists locally; the mobile drawer keeps its own state, restores focus, and becomes inert when closed. | Navigation remains predictable across routes and usable with a keyboard. |
| The network showed dense media connections and crowded labels. | Only text/link materials enter the orbital graph; selection reveals the relevant relationships and labels without an animated physics loop. | Make the diagram readable and keep its motion tied to deliberate interaction. |
| Hover treatment could affect touch interaction. | Network hover styling is restricted to fine pointers with hover support. | Avoid sticky hover feedback on touch devices. |
| Glass surfaces could use unnecessarily heavy blur. | Static glass blur is capped at 18px. | Retain translucency while limiting compositing cost. |
| Glass surfaces relied on backdrop filtering. | Opaque neutral surfaces are provided when backdrop filtering is unavailable or reduced transparency is requested. | Keep dialogs and dashboard controls legible across rendering capabilities and preferences. |

The bounded review found no further implementation bugs in these paths after the keyboard fixes. Transitions name their properties explicitly; there is no `transition: all`, zero-scale entrance, slow `ease-in` opening, or continuously animated ambient layer in the reviewed implementation.

Validation: `node --test tests/app-ui.test.mjs` passes against the actual app modules. It verifies dashboard boot and ambient mounting, real search-to-detail navigation, persistent desktop collapse, text/link-only graph routing, and the absence of graph-focus controls on image details. It does not measure browser frame timing or substitute for the Chrome visual check.

Reviewed sources: [workspace styles](../web/workspace.css), [app wiring](../web/app.mjs), [sidebar](../web/sidebar.mjs), [ambient texture](../web/ambient.mjs), [network styles](../web/network.css), and [gradient primitives](../web/gradient-components.css).
# Artifact browsing pass

| Before | After | Why |
| --- | --- | --- |
| Filename titles and repeated image metadata | Image-only cards with larger contained previews | Make the artifact the focus |
| Large article headings in the grid | Two- or three-word titles at 12px | Keep reading material identifiable without dominating the grid |
| Expanded collection trees | Ordered, closed section folders | Let the user choose how much structure to reveal |
| Taxonomy-only connections | Separate Related reading and all-media Discover views | Make useful connections browsable with clear provenance |

