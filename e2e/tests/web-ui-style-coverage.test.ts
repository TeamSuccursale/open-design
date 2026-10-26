import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('includes lazy SPA component styles in the initial route stylesheet', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const sourceRoot = path.join(root, 'apps/web/src');
  const registry = await readFile(path.join(root, 'apps/web/app/ui-styles.ts'), 'utf8');
  const files = await readdir(sourceRoot, { recursive: true });
  const missing = files.filter((file) => file.endsWith('.module.css'))
    .map((file) => `../src/${file.replaceAll('\\', '/')}`)
    .filter((file) => !registry.includes(`'${file}'`) && !registry.includes(`"${file}"`));
  expect(missing, 'A missing eager stylesheet leaves lazy views unstyled in the browser').toEqual([]);
});
