import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
mkdirSync('dist/runtime', { recursive: true });
writeFileSync('dist/runtime/containment.ps1', readFileSync('src/runtime/containment.ps1', 'utf8').replace(/\r\n/g, '\n'));
