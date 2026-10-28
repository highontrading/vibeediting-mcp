import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GRACE_MS, LicenseClient, RECHECK_MS } from '../../src/license/client.js';
import { isValidKeyFormat, maskKey, normalizeKey } from '../../src/license/key.js';
import { type MockLicense, startMockLicense, VALID_KEY } from '../helpers/mockLicense.js';
import { tmpDir } from '../helpers/fixtures.js';

describe('license key format', () => {
  it('normalizes pasted keys', () => {
    expect(normalizeKey('  vibe-2345-6789-abcd-efgh ')).toBe(VALID_KEY);
    expect(normalizeKey('"VIBE—2345—6789—ABCD—EFGH"')).toBe(VALID_KEY);
    expect(normalizeKey('VIBE 2345 6789 ABCD EFGH')).toBe(VALID_KEY);
    expect(normalizeKey('vibe23456789abcdefgh')).toBe(VALID_KEY);
    expect(normalizeKey(undefined)).toBe('');
  });
  it('accepts only the allowed alphabet', () => {
    expect(isValidKeyFormat(VALID_KEY)).toBe(true);
    expect(isValidKeyFormat('VIBE-2345-6789-ABCD-EFG1')).toBe(false); // 1 not allowed
    expect(isValidKeyFormat('VIBE-0000-6789-ABCD-EFGH')).toBe(false); // 0 not allowed
    expect(isValidKeyFormat('VIBE-2345-6789-ABCD-EFGO')).toBe(false); // O not allowed
    expect(isValidKeyFormat('VIBE-2345-6789-ABCD')).toBe(false);
    expect(isValidKeyFormat('ABCD-2345-6789-ABCD-EFGH')).toBe(false);
  });
  it('masks keys for display', () => {
    expect(maskKey(VALID_KEY)).toBe('VIBE-****-****-****-EFGH');
  });
});

describe('license client', () => {
  let mock: MockLicense;
  let dir: string;
  let now: number;
  let key: string | undefined;
  const make = () =>
    new LicenseClient({
      getKey: () => key,
      now: () => now,
      cacheFile: () => path.join(dir, 'license.json'),
      machineId: async () => 'm'.repeat(64),
      timeoutMs: 2000,
    });

  beforeAll(async () => {
    mock = await startMockLicense();
    process.env.VIBE_API_URL = mock.url;
  });
  afterAll(async () => {
    await mock.close();
    delete process.env.VIBE_API_URL;
  });
  beforeEach(() => {
    dir = tmpDir('lic-');
    now = Date.parse('2026-10-01T10:00:00Z');
    key = VALID_KEY;
    mock.mode = 'valid';
    mock.calls.length = 0;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reports a missing key with a link', async () => {
    key = undefined;
    const s = await make().check();
    expect(s.ok).toBe(false);
    expect(s.state).toBe('missing');
    expect(s.message).toContain('https://vibeediting.app/docs/activate-license');
    expect(mock.calls.length).toBe(0);
  });

  it('rejects a badly formatted key without calling the server', async () => {
    key = 'VIBE-1234';
    const s = await make().check();
    expect(s.ok).toBe(false);
    expect(s.message).toContain('Check your key for typos');
    expect(mock.calls.length).toBe(0);
  });

  it('accepts a valid key, sends the contract fields and caches it', async () => {
    const s = await make().check();
    expect(s.ok).toBe(true);
    expect(s.state).toBe('valid');
    expect(s.activations).toEqual({ used: 1, max: 2 });
    expect(mock.calls[0].path).toBe('/api/license/verify');
    expect(mock.calls[0].body).toMatchObject({ licenseKey: VALID_KEY, machineId: 'm'.repeat(64) });
    expect(typeof mock.calls[0].body.mcpVersion).toBe('string');
    const cache = JSON.parse(fs.readFileSync(path.join(dir, 'license.json'), 'utf8'));
    expect(cache.keyHash).not.toContain(VALID_KEY);
    expect(JSON.stringify(cache)).not.toContain(VALID_KEY);
  });

  it('uses the cache for 24 hours, then re-checks', async () => {
    await make().check();
    now += RECHECK_MS - 60_000;
    await make().check();
    expect(mock.calls.length).toBe(1);
    now += 2 * 60_000;
    await make().check();
    expect(mock.calls.length).toBe(2);
  });

  it.each([
    ['not_found', 'Check your key for typos'],
    ['invalid_format', 'Check your key for typos'],
    ['activation_limit', 'in use on 2 computers'],
    ['revoked', 'This key was disabled'],
    ['expired', 'Your license has expired'],
  ] as const)('explains reason %s', async (reason, text) => {
    mock.mode = reason;
    const s = await make().check();
    expect(s.ok).toBe(false);
    expect(s.reason).toBe(reason);
    expect(s.message).toContain(text);
  });

  it('a definite "no" clears the cached activation', async () => {
    await make().check();
    mock.mode = 'revoked';
    const s = await make().check({ force: true });
    expect(s.ok).toBe(false);
    expect(fs.existsSync(path.join(dir, 'license.json'))).toBe(false);
  });

  it('offline: uses the cached result for up to 7 days', async () => {
    await make().check();
    mock.mode = 'down';
    now += 3 * 24 * 3600 * 1000;
    const s = await make().check();
    expect(s.ok).toBe(true);
    expect(s.state).toBe('grace');
    expect(s.message).toMatch(/offline/i);
  });

  it('server_error counts as offline (grace), not as invalid', async () => {
    await make().check();
    mock.mode = 'server_error';
    now += 2 * RECHECK_MS;
    const s = await make().check();
    expect(s.ok).toBe(true);
    expect(s.state).toBe('grace');
  });

  it('offline for more than 7 days blocks with a clear message', async () => {
    await make().check();
    mock.mode = 'down';
    now += GRACE_MS + 60_000;
    const s = await make().check();
    expect(s.ok).toBe(false);
    expect(s.state).toBe('offline');
    expect(s.message).toContain('more than 7 days');
  });

  it('offline and never activated explains that internet is needed once', async () => {
    mock.mode = 'down';
    const s = await make().check();
    expect(s.ok).toBe(false);
    expect(s.message).toContain('has not been activated yet');
  });

  it("a different key does not reuse another key's cache", async () => {
    await make().check();
    key = 'VIBE-2345-6789-ABCD-EFGJ';
    mock.mode = 'down';
    const s = await make().check();
    expect(s.ok).toBe(false);
  });

  it('bad_request (HTTP 400) is reported, not treated as offline', async () => {
    await make().check();
    mock.mode = 'bad_request';
    const s = await make().check({ force: true });
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('bad_request');
  });

  it('deactivates this computer and clears the cache', async () => {
    await make().check();
    const r = await make().deactivate();
    expect(r.ok).toBe(true);
    expect(mock.calls.at(-1)?.path).toBe('/api/license/deactivate');
    expect(fs.existsSync(path.join(dir, 'license.json'))).toBe(false);
  });

  it('deactivate while offline changes nothing and says so', async () => {
    await make().check();
    mock.mode = 'down';
    const r = await make().deactivate();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/could not reach/i);
    expect(fs.existsSync(path.join(dir, 'license.json'))).toBe(true);
  });
});
