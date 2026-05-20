import fs from 'fs';
fs.rmSync('dist', { recursive: true, force: true });
console.log('dist directory removed');
