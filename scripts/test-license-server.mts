/**
 * A local stand-in for vibeediting.app's license API, for testing the MCP before the
 * website's database is ready. It accepts exactly one key: VIBE-2345-6789-ABCD-EFGH.
 *
 *   npx tsx scripts/test-license-server.mts
 *
 * Then connect Claude Code with VIBE_API_URL=http://127.0.0.1:8787 (see the message it prints).
 * The MCP remembers a successful check for 24 hours, so you can stop this server after the
 * first "Check my vibeediting license".
 */
import { startMockLicense, VALID_KEY } from '../test/helpers/mockLicense.js';

const port = Number(process.env.PORT ?? 8787);
const server = await startMockLicense(port);
console.log(`Test license server running at ${server.url}`);
console.log(`Test key: ${VALID_KEY}`);
console.log('Press Ctrl+C to stop.');
setInterval(() => {
  const last = server.calls.at(-1);
  if (last) {
    console.log(`${new Date().toLocaleTimeString()} ${last.path}`);
    server.calls.length = 0;
  }
}, 1000);
