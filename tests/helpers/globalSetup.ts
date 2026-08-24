import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Brings the dedicated test database up to the current migration state before
 * any test runs. `migrate deploy` only applies migrations — it never resets or
 * drops, so pointing this at a populated database would still be safe.
 */
export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required to run the test suite');

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
