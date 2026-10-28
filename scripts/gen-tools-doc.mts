/** Writes docs/tools.md from the real tool list of dist/cli.js, so the docs never drift. */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const EXAMPLES: Record<string, string> = {
  check_setup: 'Check my vibeediting setup.',
  check_license: 'Check my vibeediting license.',
  activate_license: 'Activate vibeediting with VIBE-XXXX-XXXX-XXXX-XXXX.',
  deactivate_this_computer: 'Deactivate vibeediting on this computer.',
  set_working_folder: 'My videos are in D:\\Videos\\Reels.',
  get_job_status: 'Is the export done yet?',
  probe_media: 'What resolution is talk.mp4?',
  transcribe: 'Transcribe my video. It is in Hinglish.',
  get_transcript: 'Where do I talk about pricing?',
  analyze_video: 'Review my video like an editor. Is the hook strong?',
  detect_silences: 'How many long pauses are in my video?',
  view_frames: 'Show me what the preview looks like at 0:05 and 0:20.',
  create_project: 'Start a Reel from talk.mp4.',
  get_project: 'What have you changed so far?',
  undo: 'Undo that.',
  cut_silences: 'Cut the silences but keep it natural.',
  remove_fillers: 'Remove the umms and "matlab"s.',
  remove_retakes: 'I repeated some sentences. Remove the bad takes.',
  cut_range: 'Delete 0:42 to 0:51.',
  trim: 'Start the video at my first word and end at 0:58.',
  split: 'Split the video at 0:30.',
  reorder_clips: 'Put the last part first.',
  set_aspect_ratio: 'Make it 9:16 for Reels, keep me in the frame.',
  add_captions: 'Add yellow word-by-word captions, 3 words per line.',
  set_caption_text: 'Write the captions from 0:10 to 0:14 in Roman Hinglish.',
  add_title_card: 'Add a title "3 mistakes every creator makes" at the start.',
  add_lower_third: 'Show my name, Asha, Founder of Acme, at 0:03.',
  add_zoom: 'Add punch-in zooms every few seconds.',
  add_text_overlay: 'Put "Link in bio" at the bottom for the last 3 seconds.',
  render_motion_graphic: 'Show an animated counter to 10,000 subscribers when I say it.',
  update_overlay: 'Move the title to 0:02 and make it shorter.',
  search_stock_footage: 'Find a stock clip of a busy Mumbai street.',
  add_broll: 'Use that clip at 0:12 for 3 seconds.',
  add_music: 'Add music.mp3 quietly in the background.',
  normalize_audio: 'Make the volume right for Instagram.',
  denoise_audio: 'There is a fan noise. Clean it up a bit.',
  preview_video: 'Make a quick preview so I can check.',
  export_video: 'Looks good, export it for Reels.',
  export_subtitles: 'Give me an SRT file for YouTube.',
  export_chapters: 'Make YouTube chapters for this video.',
  make_shorts_from_long_video: 'Find the 3 best Shorts in my podcast.',
  list_styles: 'What caption styles do you have?',
  apply_style: 'Use the Hinglish style.',
  save_style: 'Save this look as my default style.',
};

function typeOf(s: any): string {
  if (!s) return 'any';
  if (s.enum) return s.enum.map((v: unknown) => `\`${String(v)}\``).join(' / ');
  if (s.anyOf || s.oneOf) return (s.anyOf ?? s.oneOf).map(typeOf).join(' or ');
  if (s.type === 'array') return `list of ${typeOf(s.items)}`;
  if (s.const !== undefined) return `\`${String(s.const)}\``;
  return s.type ?? 'object';
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve(import.meta.dirname, '../dist/cli.js')],
  env: { PATH: process.env.PATH ?? '' },
  stderr: 'ignore',
});
const client = new Client({ name: 'docs', version: '1' });
await client.connect(transport);
const { tools } = await client.listTools();
const groups: Array<[string, string[]]> = [
  [
    'Setup',
    [
      'check_setup',
      'check_license',
      'activate_license',
      'deactivate_this_computer',
      'set_working_folder',
      'get_job_status',
    ],
  ],
  [
    'Understand the video',
    ['probe_media', 'transcribe', 'get_transcript', 'analyze_video', 'detect_silences', 'view_frames'],
  ],
  [
    'Edit plan',
    [
      'create_project',
      'get_project',
      'undo',
      'cut_silences',
      'remove_fillers',
      'remove_retakes',
      'cut_range',
      'trim',
      'split',
      'reorder_clips',
      'set_aspect_ratio',
    ],
  ],
  [
    'Captions and graphics',
    [
      'add_captions',
      'set_caption_text',
      'add_title_card',
      'add_lower_third',
      'add_zoom',
      'add_text_overlay',
      'render_motion_graphic',
      'update_overlay',
    ],
  ],
  ['B-roll', ['search_stock_footage', 'add_broll']],
  ['Audio', ['add_music', 'normalize_audio', 'denoise_audio']],
  [
    'Output',
    ['preview_video', 'export_video', 'export_subtitles', 'export_chapters', 'make_shorts_from_long_video'],
  ],
  ['Styles', ['list_styles', 'apply_style', 'save_style']],
];
const out: string[] = [
  '# vibeediting tools',
  '',
  `This list is generated from the server itself (${tools.length} tools). You never call these by hand: you talk to your AI agent, and it calls them. The example sentences show what you can say.`,
  '',
  'All times are in seconds (`12.5`) or minutes:seconds (`1:05`). Edit tools use the time in the *current edit* (after cuts).',
  '',
];
const seen = new Set<string>();
for (const [title, names] of groups) {
  out.push(`## ${title}`, '');
  for (const n of names) {
    const t = tools.find((x) => x.name === n);
    if (!t) continue;
    seen.add(n);
    out.push(`### \`${n}\``, '', t.description ?? '', '');
    if (EXAMPLES[n]) out.push(`Say: *"${EXAMPLES[n]}"*`, '');
    const props = Object.entries((t.inputSchema as any).properties ?? {});
    const req = new Set<string>((t.inputSchema as any).required ?? []);
    if (props.length) {
      out.push('| Input | Type | Required | What it does |', '|---|---|---|---|');
      for (const [k, s] of props as Array<[string, any]>)
        out.push(
          `| \`${k}\` | ${typeOf(s)} | ${req.has(k) ? 'yes' : ''} | ${(s.description ?? '').replace(/\|/g, '\\|')} |`,
        );
      out.push('');
    }
  }
}
const missing = tools.filter((t) => !seen.has(t.name)).map((t) => t.name);
if (missing.length) throw new Error(`Tools missing from docs groups: ${missing.join(', ')}`);
fs.writeFileSync(path.resolve(import.meta.dirname, '../docs/tools.md'), out.join('\n'));
await client.close();
console.log(`docs/tools.md written (${tools.length} tools)`);
