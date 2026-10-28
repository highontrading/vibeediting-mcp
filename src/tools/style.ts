import * as z from 'zod/v4';
import { FONTS } from '../styles/presets.js';
import { listStyles, mergeStyle, resolveStyle, saveStyle } from '../styles/store.js';
import { captionSettings } from '../captions/captions.js';
import { type App, done, text, tool, zProject } from './kit.js';

export function registerStyleTools(app: App): void {
  tool(
    app,
    'list_styles',
    {
      title: 'List styles',
      description:
        "Show the caption/title styles: built-in presets, the user's saved styles and my-style.json in the working folder.",
      input: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const all = await listStyles(app.ws.root);
      return text(
        `${all.map((s) => `${s.style.name} (${s.origin}): ${s.style.description}`).join('\n')}\nFonts: ${Object.keys(FONTS).join(', ')}.`,
      );
    },
  );

  tool(
    app,
    'apply_style',
    {
      title: 'Apply style',
      description:
        'Switch the project to a style (fonts, colours, caption look, title animation, pacing, music level). Resets caption overrides unless keep_overrides=true.',
      input: z.object({ project: zProject, style: z.string(), keep_overrides: z.boolean().optional() }),
    },
    async (args) => {
      const p = await app.store.load(args.project);
      const s = await resolveStyle(args.style, app.ws.root);
      p.style = s;
      p.styleName = s.name;
      if (p.captions && !args.keep_overrides) p.captions.overrides = {};
      await app.store.save(p, `Style ${s.name}.`);
      return done(p, `Style is now ${s.name}: ${s.description}`);
    },
  );

  tool(
    app,
    'save_style',
    {
      title: 'Save style',
      description:
        'Save a style for later (e.g. "save this as my default"). Starts from the current project\'s look (style + caption changes) or from another style, applies `changes` (same shape as list_styles entries: fonts, colors, caption, title, pacing, music), and saves to ~/.vibeediting/styles. as_default=true uses it for new projects.',
      input: z.object({
        name: z.string().min(1),
        project: zProject,
        from_style: z.string().optional(),
        changes: z.record(z.string(), z.any()).optional(),
        description: z.string().optional(),
        as_default: z.boolean().optional(),
      }),
    },
    async (args) => {
      let base;
      let p = null;
      if (args.from_style) base = await resolveStyle(args.from_style, app.ws.root);
      else {
        p = await app.store.load(args.project);
        const cs = p.captions ? captionSettings(p.style, p.captions.overrides) : null;
        base = mergeStyle(
          p.style,
          cs
            ? {
                caption: cs,
                colors: { highlight: cs.highlightColor, text: cs.textColor },
                fonts: { caption: cs.font },
              }
            : {},
        );
      }
      const style = mergeStyle(base, {
        ...(args.changes ?? {}),
        name: args.name,
        description: args.description ?? `Saved from ${p ? `project ${p.name}` : args.from_style}`,
      });
      const file = await saveStyle(style, { asDefault: args.as_default });
      const msg = `Saved style "${style.name}" to ${file}.${args.as_default ? ' It is now the default for new projects.' : ''}`;
      return p ? done(p, msg) : text(msg);
    },
  );
}
