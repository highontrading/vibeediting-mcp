import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const args = z.object({
  video: z.string().optional().describe('video file name in the working folder'),
  notes: z.string().optional().describe('anything the user wants (language, style, length...)'),
});

function msg(textBody: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: textBody } }] };
}

const v = (a: { video?: string }) =>
  a.video ? `the video "${a.video}"` : 'my video (ask me which file if there are several)';
const n = (a: { notes?: string }) => (a.notes ? `\nMy notes: ${a.notes}` : '');

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'talking-head-reel',
    {
      title: 'Talking-head reel',
      description:
        'Turn a talking-head recording into a punchy 9:16 Reel/Short with captions, a hook title and zooms.',
      argsSchema: args,
    },
    (a) =>
      msg(`Edit ${v(a)} into a talking-head Reel with vibeediting.${n(a)}
Steps:
1. create_project with aspect "9:16" (style bold-yellow-pop, or hinglish-pop if I speak Hindi/Hinglish).
2. transcribe (language "hi" for Hindi/Hinglish), then analyze_video.
3. Tell me the plan in 4-6 short bullet points: cut silences and fillers, remove retakes (list them), fix a slow start, captions style, a hook title card for the first 2-3 s, auto zooms every ~7 s, music only if I give a file. Wait for my OK.
4. Apply it, then preview_video and ask me to watch the preview.
5. Fix what I say, then export_video with preset "reels" (or "shorts").`),
  );

  server.registerPrompt(
    'youtube-long-form',
    {
      title: 'YouTube long-form edit',
      description:
        'Clean up a long horizontal video: tighten pauses, fix the intro, lower thirds, chapters and subtitles.',
      argsSchema: args,
    },
    (a) =>
      msg(`Edit ${v(a)} as a YouTube video (16:9) with vibeediting.${n(a)}
Steps:
1. create_project with aspect "16:9" and style "youtube-clean". transcribe, then analyze_video.
2. Plan (wait for my OK): cut long pauses (gentle, keep a natural pace), remove retakes, trim a slow intro, lower third with my name, simple fade titles for sections, optional captions, chapters.
3. Apply, preview_video (you may preview only parts with start/end), and ask me to check.
4. export_video preset "youtube", export_subtitles (srt) and export_chapters. Give me the chapter text to paste.`),
  );

  server.registerPrompt(
    'podcast-to-shorts',
    {
      title: 'Podcast to Shorts',
      description:
        'Find the best 30-60 s moments in a podcast or long talk and turn each into a captioned 9:16 short.',
      argsSchema: args,
    },
    (a) =>
      msg(`Turn ${v(a)} into Shorts with vibeediting.${n(a)}
Steps:
1. create_project (aspect original) and transcribe it.
2. make_shorts_from_long_video to get candidates. Show me the best 3-5 with a one-line summary each and wait for my choice.
3. make_shorts_from_long_video with create=[my picks]. For each new project: cut_silences, apply_style "podcast" (or my style), add a hook title card, add_captions, preview_video.
4. After my OK, export_video preset "shorts" for each.`),
  );

  server.registerPrompt(
    'add-broll',
    {
      title: 'Add B-roll',
      description: 'Add motion-graphic and stock B-roll at the right moments of the current edit.',
      argsSchema: args,
    },
    (a) =>
      msg(`Add B-roll to my current vibeediting project${a.video ? ` (${a.video})` : ''}.${n(a)}
Steps:
1. get_project and get_transcript to see what is said when (output times).
2. Propose 3-6 B-roll moments: for numbers, lists and comparisons use render_motion_graphic templates (counter, bar_chart, checklist, progress_bar, quote, callout) or a custom HTML animation; for scenes ("city", "laptop", "money") use search_stock_footage (needs my Pexels/Pixabay key). No AI-generated media. Wait for my OK.
3. Add them, preview_video, and ask me to check. Stock credits are saved automatically.`),
  );
}
