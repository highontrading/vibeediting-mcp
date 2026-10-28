---
name: add-broll
description: Add B-roll to a vibeediting project - animated motion graphics (counters, charts, checklists, custom HTML animations) and free stock clips from Pexels or Pixabay - at the right moments. Use when the user asks for B-roll, cutaways, graphics or visuals.
license: Proprietary. See https://vibeediting.app/terms
metadata:
  author: vibeediting
  version: "0.1.0"
---

# Add B-roll

No AI-generated media, ever. B-roll is either code-made motion graphics or real stock footage.

1. `get_project` and `get_transcript` to see what is said when (output times).
2. Propose 3 to 6 moments and wait for OK:
   - Numbers, lists, comparisons: `render_motion_graphic` with a template:
     - `counter` `{from, to, prefix, suffix, label}`
     - `bar_chart` `{title, bars: [{label, value}]}`
     - `progress_bar` `{percent, label}`
     - `checklist` `{title, items: []}`
     - `quote` `{text, author}`
     - `callout` `{text, x, y}`
   - Something special: write a small HTML/CSS/JS animation and pass it as `html`. Transparent background. Animate with CSS, `requestAnimationFrame`, or `window.seek = (t) => {...}`. Fonts: Poppins, Mukta, Anton, Bebas Neue, Noto Sans Devanagari. Needs Chrome or Edge.
   - Real scenes ("city traffic", "typing on laptop"): `search_stock_footage` (needs the user's free Pexels or Pixabay key), then `add_broll` with the id. Credits are saved to `broll/credits.json`.
3. `preview_video` and ask the user to check. Remind them to add stock credits to the post description.
