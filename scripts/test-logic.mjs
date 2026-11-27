// Compila i test della logica con esbuild (già installato con l'interfaccia) e li esegue con node --test.
import { build } from '../ui/node_modules/esbuild/lib/main.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(mkdtempSync(join(tmpdir(), 'sa-test-')), 'logic.test.mjs');
await build({ entryPoints: ['tests/logic.test.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
const r = spawnSync(process.execPath, ['--test', out], { stdio: 'inherit' });
process.exit(r.status ?? 1);
