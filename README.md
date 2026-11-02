# Keel

A local-first, private personal finance tracker for Android.

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

## Android build

Requires the Android SDK, NDK 27 and Java 17 (`ANDROID_HOME`, `NDK_HOME`, `ANDROID_NDK_ROOT`).

```bash
npx tauri android build --apk          # release APK (all ABIs)
npx tauri android dev                  # run on a connected device or emulator
```

Release signing reads `src-tauri/gen/android/keystore.properties` (never committed):

```
storeFile=/absolute/path/keel-release.jks
storePassword=...
keyAlias=keel
keyPassword=...
```

Create the key once and keep an offline copy. Losing it means existing installs can't be updated:

```bash
keytool -genkeypair -v -keystore keel-release.jks -alias keel -keyalg RSA -keysize 4096 -validity 10000
```

CI builds the APK on every push. To have CI sign with your release key, add these repository
secrets: `ANDROID_KEYSTORE_BASE64` (`base64 -w0 keel-release.jks`), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them CI signs with a throwaway test key,
and the artifact is named `keel-test-signed-universal.apk`.
