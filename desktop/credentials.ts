import { app, safeStorage } from 'electron';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ProviderSchema, ModelSchema } from './providers';
import { providerDefaults, type ProviderId, type Connection } from '../src/services/bridge';
const ConfigSchema = z.record(
  ProviderSchema,
  z.object({ model: ModelSchema, encryptedKey: z.string().max(20000).optional() }).strict(),
);
type Config = z.infer<typeof ConfigSchema>;
let config: Config | undefined;
const path = () => join(app.getPath('userData'), 'connections.v1.json');
async function read() {
  if (config) return config;
  try {
    config = ConfigSchema.parse(JSON.parse(await readFile(path(), 'utf8')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Provider configuration is unreadable. Existing credentials were preserved.');
    config = Object.fromEntries(
      Object.entries(providerDefaults).map(([p, v]) => [p, { model: v.model }]),
    ) as Config;
  }
  return config;
}
export async function listConnections(): Promise<Connection[]> {
  const c = await read();
  return Object.keys(providerDefaults).map((p) => ({
    provider: p as ProviderId,
    model: c[p as ProviderId].model,
    configured: !!c[p as ProviderId].encryptedKey,
  }));
}
export async function setConnection(input: unknown) {
  const a = z
    .object({
      provider: ProviderSchema,
      model: ModelSchema,
      key: z.string().trim().min(8).max(1000).optional(),
      remove: z.boolean().optional(),
    })
    .strict()
    .parse(input);
  const c = structuredClone(await read());
  if (a.key && !safeStorage.isEncryptionAvailable())
    throw new Error('macOS credential encryption unavailable; key was not saved.');
  c[a.provider] = {
    model: a.model,
    encryptedKey: a.remove
      ? undefined
      : a.key
        ? safeStorage.encryptString(a.key).toString('base64')
        : c[a.provider].encryptedKey,
  };
  await mkdir(app.getPath('userData'), { recursive: true });
  const temp = path() + '.tmp';
  await writeFile(temp, JSON.stringify(c, null, 2), { mode: 0o600 });
  await rename(temp, path());
  config = c;
  return listConnections();
}
export async function keyFor(provider: ProviderId) {
  const c = await read();
  if (!c[provider].encryptedKey)
    throw new Error(`No ${provider} API key configured. Manual editing is available.`);
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Credential encryption unavailable');
  try {
    return safeStorage.decryptString(Buffer.from(c[provider].encryptedKey!, 'base64'));
  } catch {
    throw new Error('Stored API key cannot be decrypted on this Mac');
  }
}
