/** Load .env for local scripts (Node >= 20.12) and read required variables. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Add it to .env (see .env.example).`);
    process.exit(1);
  }
  return v;
}
