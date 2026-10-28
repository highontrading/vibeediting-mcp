---
name: edit-video
description: Edit any video with the vibeediting tools using the safe plan, approve, preview, render loop. Use when the user asks to edit, cut, caption, reframe or export a video and no more specific vibeediting skill fits.
license: Proprietary. See https://vibeediting.app/terms
metadata:
  author: vibeediting
  version: "0.1.0"
---

# Edit a video with vibeediting

vibeediting runs on the user's computer. The original video is never changed. Finished files go to an `exports` folder next to the video.

## The loop (always)

1. **Understand.** `create_project` with the video. Use `aspect: "9:16"` for Reels, Shorts and TikTok, `"16:9"` for YouTube. Then `transcribe` and `analyze_video`. Read the results yourself.
2. **Plan.** Tell the user, in 4 to 6 short bullets, what you will do. Use simple words. **Wait for their OK.**
3. **Apply.** Cuts first (`cut_silences`, `remove_fillers`, `remove_retakes`, `trim`, `cut_range`). Then looks (`add_captions`, `add_title_card`, `add_zoom`, B-roll, `add_music`).
4. **Preview.** `preview_video`. Ask the user to open `exports/<name>-preview.mp4` and watch it. Use `view_frames` to check details yourself.
5. **Fix.** Change only what the user asks. `undo` reverts the last change.
6. **Export once.** `export_video` with the right preset. Tell the user the file path.

## Good to know

- Edit tools use **output times** (after cuts). Re-read `get_project` or `get_transcript` before placing overlays.
- If a tool answers with a job id, call `get_job_status` with it. Do not start the same job again.
- Hindi or Hinglish: `transcribe` with `language: "hi"`, use style `hinglish-pop`. Captions come out in Devanagari. If the user wants Roman script, rewrite lines with `set_caption_text`.
- Never use AI-generated video, images, voices or music. B-roll is motion graphics (`render_motion_graphic`) or free stock clips (`search_stock_footage`, `add_broll`).
- If something fails, the error says what to do. Run `check_setup` when unsure.
