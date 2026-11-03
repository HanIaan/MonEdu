/**
 * Locates playwright-core without adding a dependency to frontend/package.json:
 * $PLAYWRIGHT_CORE (dir of the package) → tests/e2e/node_modules → global resolution.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export async function loadChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    join(resolve(HERE, '..', '..', '..'), 'tests', 'e2e', 'node_modules', 'playwright-core'),
    join(resolve(HERE, '..', '..', '..'), 'tests', 'e2e', 'node_modules', '@playwright', 'test'),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const req = createRequire(join(c, 'package.json'));
      const mod = req(c);
      if (mod.chromium) return mod.chromium;
    } catch {
      /* try next */
    }
  }
  throw new Error('playwright-core not found: set PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core (or npm ci in tests/e2e)');
}
