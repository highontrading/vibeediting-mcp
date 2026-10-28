import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { prefetchFfmpeg } from './media/ffmpeg.js';
import { createServer, createShared } from './server.js';
import { VERSION } from './util/config.js';
import { log, protectStdout } from './util/log.js';

protectStdout();

const argv = process.argv.slice(2);
if (argv.includes('--version') || argv.includes('-v')) {
  process.stderr.write(`${VERSION}\n`);
  process.exit(0);
}
if (argv[0] === 'setup' || argv.includes('--setup')) {
  const { runSetup } = await import('./setup/run.js');
  process.exit(await runSetup(argv));
}
if (argv.includes('--help') || argv.includes('-h')) {
  process.stderr.write(
    [
      `vibeediting MCP server ${VERSION}`,
      'This program is started by your AI app (Claude Code, Codex, Cursor...), not by hand.',
      '',
      'One-time setup (asks for your key, connects your AI apps, downloads FFmpeg and the speech model):',
      '  npx -y @vibeediting/mcp --setup [--license KEY] [--no-model] [--model turbo] [--no-apps] [--yes]',
      'Setup guide: https://vibeediting.app/docs',
      '',
      'Environment variables:',
      '  VIBE_LICENSE_KEY   your license key (VIBE-XXXX-XXXX-XXXX-XXXX)',
      '  PEXELS_API_KEY     optional, for stock footage',
      '  PIXABAY_API_KEY    optional, for stock footage',
      '  VIBE_WHISPER_MODEL optional: tiny, base, small, medium, turbo, large',
      '  VIBE_TOOLSET       optional: "core" for a smaller tool list',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const shared = createShared();
log.info(`starting ${VERSION}; working folder: ${shared.ws.root ?? '(not set yet)'}`);
process.on('unhandledRejection', (err) => log.error('unhandled', err));
process.on('uncaughtException', (err) => log.error('uncaught', err));

serveStdio(() => createServer(shared), { onerror: (err) => log.error('transport', err) });

// Get FFmpeg ready in the background if this computer has none.
void prefetchFfmpeg();
