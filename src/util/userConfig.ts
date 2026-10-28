import path from 'node:path';
import { vibeHome } from './config.js';
import { readJson, writeJson } from './fsx.js';

/** Settings saved on this computer: ~/.vibeediting/config.json */
export interface UserConfig {
  licenseKey?: string;
  savedAt?: string;
}

export function userConfigFile(): string {
  return path.join(vibeHome(), 'config.json');
}

export async function readUserConfig(): Promise<UserConfig> {
  return (await readJson<UserConfig>(userConfigFile())) ?? {};
}

export async function writeUserConfig(patch: UserConfig): Promise<void> {
  const current = await readUserConfig();
  await writeJson(userConfigFile(), { ...current, ...patch, savedAt: new Date().toISOString() });
}
