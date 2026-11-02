# Keel

A local-first, private personal finance tracker for Windows and Android.

- [Requirements](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Progress](docs/PROGRESS.md)

## Development

Prerequisites: Node 22, Rust (stable). On Linux, the Tauri system libraries
(`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`).

```bash
npm install

# UI in a browser against the real Rust core (development database in target/devdata)
npm run dev:backend      # terminal 1
npm run dev              # terminal 2, then open http://localhost:5173

# Desktop app window
npx tauri dev

# Checks
npm run typecheck && npm test
cargo test -p keel-core
cargo clippy --workspace --all-targets -- -D warnings
npm run e2e              # needs Playwright with Chromium
```

The development backend (`crates/keel-devserver`) is never shipped. It binds to
127.0.0.1 only and uses a fixed development key, so never point it at real data.

## Build

```bash
npx tauri build          # Windows: .msi and .exe installers in target/release/bundle
```
