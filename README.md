# Keel

A local-first, private personal finance tracker for Android.

- [Requirements](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Progress](docs/PROGRESS.md)

## Install on an Android phone

Requires Android 8.0 or newer.

**From GitHub Releases (recommended):**
1. On the phone, open the repository's **Releases** page and tap the newest `keel-x.y.z.apk`.
2. Open the downloaded file. If Android asks, allow installs from your browser
   (**Settings → Allow from this source**), go back and tap **Install**.
   If Play Protect warns about an unknown app, choose **Install anyway**.
3. Open Keel and follow the setup steps.

**Updating:** install the newer APK from Releases over the old one. Your data is kept.

**Test builds** (every push): Actions → latest **CI** run → artifact **keel-android** (a zip).
Extract it and install `keel-test-signed-universal.apk`. Test builds use a throwaway key, so they
can't be updated in place; uninstalling removes their data (back up first).

Good to know:
- If you set a PIN, store the recovery key shown during setup. Without the PIN or the recovery key
  the data can't be recovered.
- Keel sends nothing anywhere unless you connect Dropbox sync. To move data without sync, use
  **Settings → Data → Create backup** and restore it on the other phone.

## Publishing a release (from the phone)

One-time setup:
1. **Signing key.** In the repository: **Settings → Secrets and variables → Actions → Secrets →
   New repository secret**. Add the four secrets `ANDROID_KEYSTORE_BASE64`,
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Keep a copy of all
   four values in your password manager: losing them means future versions can't update existing
   installs.
2. **Dropbox (optional).** At <https://www.dropbox.com/developers/apps> tap **Create app** →
   **Scoped access** → **App folder** → name it (e.g. `Keel Sync`). On the app's page:
   - **Permissions** tab: tick `files.content.write` and `files.content.read`, tap **Submit**.
   - **Settings** tab: under *OAuth 2 → Redirect URIs* add `db-<your app key>://auth`
     (the App key is shown on the same page).
   - In GitHub: **Settings → Secrets and variables → Actions → Variables → New repository
     variable** named `DROPBOX_APP_KEY` with the App key. Without it, Keel is built without sync
     and without any internet permission.
   - Dropbox allows 500 users while the app is in *development* status; apply for production in
     the Dropbox app console before sharing widely.

Each release:
1. Bump `version` in `src-tauri/tauri.conf.json` and `package.json` (e.g. `0.2.0` → `0.3.0`).
2. **Actions → Release → Run workflow**. About 25 minutes later the signed APK is on the
   **Releases** page.

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

## Building the APK yourself

Requires the Android SDK, NDK 27 and Java 17 (`ANDROID_HOME`, `NDK_HOME`, `ANDROID_NDK_ROOT`).

```bash
npx tauri android build --apk          # release APK (all ABIs)
npx tauri android dev                  # run on a connected device or emulator
```

### Release signing

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
