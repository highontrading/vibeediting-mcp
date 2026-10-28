import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { sha256 } from '../util/fsx.js';
import { run } from '../util/proc.js';

async function rawMachineId(): Promise<string> {
  try {
    if (process.platform === 'darwin') {
      const r = await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeoutMs: 5000 });
      const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(r.stdout);
      if (m) return m[1];
    } else if (process.platform === 'win32') {
      const sysRoot = process.env.SystemRoot || 'C:\\Windows';
      const r = await run(
        `${sysRoot}\\System32\\reg.exe`,
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        {
          timeoutMs: 5000,
        },
      );
      const m = /MachineGuid\s+REG_\w+\s+([^\s]+)/i.exec(r.stdout);
      if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try {
          const id = (await readFile(f, 'utf8')).trim();
          if (id) return id;
        } catch {
          /* try next */
        }
      }
    }
  } catch {
    /* fall through to hostname */
  }
  return `host:${os.hostname()}`;
}

function username(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || process.env.USERNAME || 'user';
  }
}

let cached: string | null = null;

/**
 * A stable, anonymous id for this computer and user: SHA-256 of the OS machine id
 * plus the user name. The raw values never leave the computer.
 */
export async function getMachineId(): Promise<string> {
  if (process.env.VIBE_MACHINE_ID_OVERRIDE) return process.env.VIBE_MACHINE_ID_OVERRIDE;
  if (!cached) cached = sha256(`vibeediting:v1:${await rawMachineId()}:${username()}`);
  return cached;
}
