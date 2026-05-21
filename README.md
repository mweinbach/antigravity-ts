# unofficial-antigravity-sdk

Unofficial TypeScript SDK port for Google Antigravity.

This package bundles the `localharness` runtime extracted from the published
`google-antigravity` Python wheels. The runtime resolver picks the matching
binary for the current platform from `vendor/localharness/<platform>/`.

Currently available upstream runtimes:

- `darwin-arm64`
- `linux-arm64`
- `linux-x64`

Refresh bundled runtimes with:

```sh
npm run sync:localharness
```

CI runs the same sync step before build, tests, and package verification.

The `localharness` executable is authored in TypeScript under `src/bin/` and
emitted into `dist/bin/` during `npm run build`, so published packages do not
need a separate handwritten JavaScript wrapper.
