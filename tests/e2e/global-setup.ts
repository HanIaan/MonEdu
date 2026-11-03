import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Build Chrome fake-camera MJPEG streams (concatenated JPEG frames) from committed stills. */
export default function globalSetup() {
  const dir = join(import.meta.dirname, 'fixtures');
  for (const name of ['person', 'nobody']) {
    const jpg = readFileSync(join(dir, `${name}.jpg`));
    writeFileSync(join(dir, `${name}.mjpeg`), Buffer.concat(Array.from({ length: 30 }, () => jpg)));
  }
}
