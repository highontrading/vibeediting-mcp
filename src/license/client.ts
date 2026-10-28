import fs from 'node:fs/promises';
import { apiUrl, dirs, VERSION } from '../util/config.js';
import { readJson, sha256, writeJson } from '../util/fsx.js';
import { log } from '../util/log.js';
import { readUserConfig } from '../util/userConfig.js';
import { isValidKeyFormat, maskKey, normalizeKey } from './key.js';
import { getMachineId } from './machineId.js';
import {
  graceExpiredMessage,
  type LicenseReason,
  missingKeyMessage,
  offlineNeverActivatedMessage,
  reasonMessage,
} from './messages.js';

/** A key saved on this computer (given in chat or during setup) wins over the app settings. */
async function defaultKey(): Promise<string | undefined> {
  const saved = (await readUserConfig()).licenseKey;
  return saved || process.env.VIBE_LICENSE_KEY;
}

export const RECHECK_MS = 24 * 60 * 60 * 1000;
export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type LicenseState = 'valid' | 'grace' | 'missing' | 'invalid' | 'offline';

export interface LicenseStatus {
  ok: boolean;
  state: LicenseState;
  message: string;
  reason?: string;
  keyMasked: string;
  plan?: string;
  expiresAt?: string | null;
  activations?: { used: number; max: number };
  checkedAt?: string;
  /** Where this answer came from. */
  source: 'cache' | 'server' | 'none';
}

interface CacheFile {
  v: 1;
  keyHash: string;
  machineId: string;
  plan?: string;
  expiresAt?: string | null;
  activations?: { used: number; max: number };
  checkedAt: number;
}

interface VerifyResponse {
  valid: boolean;
  reason?: LicenseReason;
  plan?: string;
  expiresAt?: string | null;
  activations?: { used: number; max: number };
}

export interface LicenseClientOptions {
  getKey?: () => string | undefined | Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheFile?: () => string;
  machineId?: () => Promise<string>;
  timeoutMs?: number;
}

type NetResult = { kind: 'response'; status: number; body: any } | { kind: 'network'; error: string };

export class LicenseClient {
  private readonly getKey: () => string | undefined | Promise<string | undefined>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cacheFile: () => string;
  private readonly machineId: () => Promise<string>;
  private readonly timeoutMs: number;
  private memo: { status: LicenseStatus; at: number; key: string } | null = null;
  private inflight: Promise<LicenseStatus> | null = null;

  constructor(opts: LicenseClientOptions = {}) {
    this.getKey = opts.getKey ?? defaultKey;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.now = opts.now ?? (() => Date.now());
    this.cacheFile = opts.cacheFile ?? dirs.licenseFile;
    this.machineId = opts.machineId ?? getMachineId;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async key(): Promise<string> {
    return normalizeKey(await this.getKey());
  }

  /** Where the key in use came from, for messages. */
  async keySource(): Promise<'saved' | 'settings' | 'none'> {
    const saved = (await readUserConfig()).licenseKey;
    if (saved) return 'saved';
    return process.env.VIBE_LICENSE_KEY?.trim() ? 'settings' : 'none';
  }

  /** Check the license. Uses the cache when it is less than 24 hours old. */
  async check(opts: { force?: boolean } = {}): Promise<LicenseStatus> {
    const key = await this.key();
    // Short in-memory memo so a burst of tool calls does not re-read the cache file.
    if (
      !opts.force &&
      this.memo &&
      this.memo.key === key &&
      this.now() - this.memo.at < 60_000 &&
      this.memo.status.ok
    ) {
      return this.memo.status;
    }
    if (this.inflight && !opts.force) return this.inflight;
    this.inflight = this.doCheck(key, !!opts.force).finally(() => {
      this.inflight = null;
    });
    const status = await this.inflight;
    this.memo = { status, at: this.now(), key };
    return status;
  }

  private async doCheck(key: string, force: boolean): Promise<LicenseStatus> {
    const keyMasked = maskKey(key);
    if (!key) return { ok: false, state: 'missing', message: missingKeyMessage(), keyMasked, source: 'none' };
    if (!isValidKeyFormat(key)) {
      return {
        ok: false,
        state: 'invalid',
        reason: 'invalid_format',
        message: reasonMessage('invalid_format'),
        keyMasked,
        source: 'none',
      };
    }
    const machineId = await this.machineId();
    const keyHash = sha256(key);
    const cache = await this.readCache(keyHash, machineId);
    const now = this.now();

    if (cache && !force && now - cache.checkedAt < RECHECK_MS && !this.expired(cache)) {
      return this.validFromCache(cache, keyMasked, 'valid');
    }

    const res = await this.post('/api/license/verify', { licenseKey: key, machineId, mcpVersion: VERSION });

    if (res.kind === 'response' && res.body && typeof res.body.valid === 'boolean') {
      const body = res.body as VerifyResponse;
      if (body.valid) {
        const fresh: CacheFile = {
          v: 1,
          keyHash,
          machineId,
          plan: body.plan,
          expiresAt: body.expiresAt ?? null,
          activations: body.activations,
          checkedAt: now,
        };
        await this.writeCache(fresh);
        return this.validFromCache(fresh, keyMasked, 'valid', 'server');
      }
      const reason = body.reason ?? 'server_error';
      if (reason === 'server_error') return this.offline(cache, keyMasked, now, 'server_error');
      // A definite "no" from the server: forget the cached activation.
      if (reason !== 'bad_request') await this.clearCache();
      return {
        ok: false,
        state: 'invalid',
        reason,
        message: reasonMessage(reason),
        keyMasked,
        source: 'server',
      };
    }
    if (res.kind === 'response' && res.status >= 400 && res.status < 500 && res.status !== 429) {
      return {
        ok: false,
        state: 'invalid',
        reason: 'bad_request',
        message: reasonMessage('bad_request'),
        keyMasked,
        source: 'server',
      };
    }
    return this.offline(cache, keyMasked, now, res.kind === 'network' ? res.error : `HTTP ${res.status}`);
  }

  private offline(cache: CacheFile | null, keyMasked: string, now: number, why: string): LicenseStatus {
    log.info(`license server not reachable (${why}); checking offline grace period`);
    if (cache && now - cache.checkedAt < GRACE_MS && now >= cache.checkedAt && !this.expired(cache)) {
      const s = this.validFromCache(cache, keyMasked, 'grace');
      const daysLeft = Math.max(0, Math.ceil((cache.checkedAt + GRACE_MS - now) / 86_400_000));
      s.message = `License OK (offline mode). The license server could not be reached, so I used your last successful check. Connect to the internet within ${daysLeft} day(s) to keep editing.`;
      return s;
    }
    const message = cache ? graceExpiredMessage(7) : offlineNeverActivatedMessage();
    return { ok: false, state: 'offline', reason: 'offline', message, keyMasked, source: 'none' };
  }

  private expired(cache: CacheFile): boolean {
    if (!cache.expiresAt) return false;
    const t = Date.parse(cache.expiresAt);
    return Number.isFinite(t) && t < this.now();
  }

  private validFromCache(
    c: CacheFile,
    keyMasked: string,
    state: 'valid' | 'grace',
    source: 'cache' | 'server' = 'cache',
  ): LicenseStatus {
    const act = c.activations
      ? ` This key is active on ${c.activations.used} of ${c.activations.max} computers.`
      : '';
    return {
      ok: true,
      state,
      message: `License OK (${c.plan ?? 'lifetime'}).${act}`,
      keyMasked,
      plan: c.plan,
      expiresAt: c.expiresAt ?? null,
      activations: c.activations,
      checkedAt: new Date(c.checkedAt).toISOString(),
      source,
    };
  }

  /** Free this computer's activation slot. */
  async deactivate(): Promise<{ ok: boolean; message: string }> {
    const key = await this.key();
    if (!key) return { ok: false, message: missingKeyMessage() };
    if (!isValidKeyFormat(key)) return { ok: false, message: reasonMessage('invalid_format') };
    const machineId = await this.machineId();
    const res = await this.post('/api/license/deactivate', { licenseKey: key, machineId });
    if (res.kind === 'response' && res.body && res.body.ok === true) {
      await this.clearCache();
      this.memo = null;
      return {
        ok: true,
        message:
          'Done. vibeediting is deactivated on this computer and the slot is free. You can now activate it on another computer. (To use it here again later, just keep the key in your settings and restart your AI app.)',
      };
    }
    if (res.kind === 'network') {
      return {
        ok: false,
        message:
          'I could not reach the vibeediting license server, so nothing was changed. Check your internet connection and try again.',
      };
    }
    return {
      ok: false,
      message:
        'The license server did not deactivate this computer. Maybe it was not activated with this key. Check the key, or contact support: https://vibeediting.app/docs/activate-license',
    };
  }

  private async post(pathname: string, body: unknown): Promise<NetResult> {
    try {
      const res = await this.fetchImpl(`${apiUrl()}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': `vibeediting-mcp/${VERSION}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { kind: 'response', status: res.status, body: json };
    } catch (err) {
      return { kind: 'network', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async readCache(keyHash: string, machineId: string): Promise<CacheFile | null> {
    const c = await readJson<CacheFile>(this.cacheFile());
    if (
      !c ||
      c.v !== 1 ||
      c.keyHash !== keyHash ||
      c.machineId !== machineId ||
      typeof c.checkedAt !== 'number'
    )
      return null;
    // A clock that went backwards makes the cache untrustworthy for the 24 h skip, but it may still count for grace.
    if (c.checkedAt > this.now() + 5 * 60_000) return { ...c, checkedAt: 0 };
    return c;
  }

  private async writeCache(c: CacheFile): Promise<void> {
    try {
      await writeJson(this.cacheFile(), c);
    } catch (err) {
      log.error('could not save the license cache', err);
    }
  }

  private async clearCache(): Promise<void> {
    await fs.rm(this.cacheFile(), { force: true });
  }
}
