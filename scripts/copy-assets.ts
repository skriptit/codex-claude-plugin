import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/runtime', { recursive: true });
cpSync('src/runtime/containment.ps1', 'dist/runtime/containment.ps1');
