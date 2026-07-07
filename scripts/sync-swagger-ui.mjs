import { mkdirSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = resolve(root, 'node_modules/swagger-ui-dist');
const targetDir = resolve(root, 'public/vendor/swagger-ui');

mkdirSync(targetDir, { recursive: true });

for (const file of [
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js',
]) {
  cpSync(resolve(sourceDir, file), resolve(targetDir, file));
}
