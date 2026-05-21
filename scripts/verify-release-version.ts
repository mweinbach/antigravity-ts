#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';

interface PackageJson {
  version: string;
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson;
const releaseRef = process.env.GITHUB_REF_NAME;

if (!releaseRef) {
  throw new Error('GITHUB_REF_NAME is required to verify the release version.');
}

const tag = releaseRef.replace(/^v/, '');
if (pkg.version !== tag) {
  throw new Error(`Release tag ${releaseRef} does not match package.json version ${pkg.version}`);
}
