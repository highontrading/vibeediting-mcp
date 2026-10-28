---
name: podcast-to-shorts
description: Find the best 30-60 second moments in a podcast, interview or long talk and turn each into a captioned vertical short with vibeediting. Use when the user wants clips, shorts or reels cut from a long video.
license: Proprietary. See https://vibeediting.app/terms
metadata:
  author: vibeediting
  version: "0.1.0"
---

# Podcast to Shorts

1. `create_project` with the long video (aspect `original`), then `transcribe`.
2. `make_shorts_from_long_video` (optionally with `keywords` the user cares about). Read the candidates, then show the best 3 to 5 to the user with a one-line summary each. Wait for their choice.
3. `make_shorts_from_long_video` with `create: [ids]`. This makes one 9:16 project per moment, with captions.
4. For each new project (pass `project: "<name>"`):
   - `cut_silences`
   - `apply_style` `podcast` (or the user's style)
   - `add_title_card` with a short hook
   - `preview_video`
5. After the user approves, `export_video` with preset `shorts` for each one.
