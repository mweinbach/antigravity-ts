#!/usr/bin/env tsx
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
console.log('dist directory removed');
