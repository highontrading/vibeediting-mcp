import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const VALID_KEY = 'VIBE-2345-6789-ABCD-EFGH';

export interface MockLicense {
  url: string;
  calls: Array<{ path: string; body: any }>;
  /** Change how the server answers verify calls. */
  mode:
    | 'valid'
    | 'not_found'
    | 'revoked'
    | 'expired'
    | 'activation_limit'
    | 'invalid_format'
    | 'server_error'
    | 'down'
    | 'bad_request';
  close(): Promise<void>;
}

/** A tiny stand-in for https://vibeediting.app/api/license/*. */
export async function startMockLicense(port = 0): Promise<MockLicense> {
  const state: MockLicense = { url: '', calls: [], mode: 'valid', close: async () => undefined };
  const machines = new Set<string>();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: any;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      state.calls.push({ path: req.url ?? '', body });
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (state.mode === 'down') {
        req.socket.destroy();
        return;
      }
      if (req.url === '/api/license/deactivate') {
        machines.delete(body?.machineId);
        return send(200, { ok: body?.licenseKey === VALID_KEY });
      }
      if (req.url !== '/api/license/verify') return send(404, { error: 'not found' });
      if (
        !body ||
        typeof body.licenseKey !== 'string' ||
        typeof body.machineId !== 'string' ||
        body.machineId.length < 8
      )
        return send(400, { valid: false, reason: 'bad_request' });
      switch (state.mode) {
        case 'server_error':
          return send(500, { valid: false, reason: 'server_error' });
        case 'bad_request':
          return send(400, { valid: false, reason: 'bad_request' });
        case 'valid':
          if (body.licenseKey !== VALID_KEY) return send(200, { valid: false, reason: 'not_found' });
          machines.add(body.machineId);
          return send(200, {
            valid: true,
            plan: 'lifetime',
            expiresAt: null,
            activations: { used: machines.size, max: 2 },
          });
        default:
          return send(200, { valid: false, reason: state.mode });
      }
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () =>
    new Promise<void>((r) => {
      server.closeAllConnections?.();
      server.close(() => r());
    });
  return state;
}
