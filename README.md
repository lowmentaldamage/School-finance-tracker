# Keel Finance Tracker

A local-first, private personal finance tracker for Android, Windows 11, and macOS.

- [Requirements](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Progress](docs/PROGRESS.md)

---

## Prerequisites

Before cloning and building **Keel**, ensure your system has the following tools installed:
- **Git** ([Download Git](https://git-scm.com/))
- **Node.js** (v22 or newer)
- **Rust** (stable toolchain - [rustup.rs](https://rustup.rs/))
- **Platform-Specific Build Tools:**
  - **Windows 11:** Microsoft Visual Studio C++ Build Tools and the WebView2 runtime.
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
  - **Linux:** Tauri system libraries (`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`).

---

## Getting Started

Clone the repository and enter the project directory:

```bash
git clone [https://github.com/your-username/keel.git](https://github.com/your-username/keel.git)
cd keel

Install the JavaScript dependencies:
npm install

Development & Running Locally
Running the Desktop App (Windows 11 & macOS)
Launch the native desktop app window in development mode via Tauri:
npx tauri dev

Running the Browser UI with Backend
Alternatively, you can run the web UI against the live Rust core (storing local development data in target/devdata):
# Terminal 1: Start the backend core
npm run dev:backend

# Terminal 2: Start the frontend dev server
npm run dev

Then, open your browser and navigate to http://localhost:5173.
Running Tests and Quality Checks
npm run typecheck && npm test
cargo test -p keel-core
cargo clippy --workspace --all-targets -- -D warnings
npm run e2e              # Requires Playwright with Chromium installed

(Note: The development backend crates/keel-devserver binds exclusively to 127.0.0.1 using a fixed development key; never point it at real financial data.)
Building Desktop Apps for Windows 11 & macOS
To generate distribution-ready installation bundles for your desktop operating system:
npx tauri build

The compiled binaries and installers will be output inside src-tauri/target/release/bundle/.
Android App Installation & Building
Requires Android 8.0 or newer.
From GitHub Releases (Recommended for Users)
 * On your phone, open the repository's Releases page and download the newest keel-x.y.z.apk.
 * Open the file. If prompted, allow installations from your browser (Settings → Allow from this source), go back, and tap Install. Choose Install anyway if Play Protect displays a warning.
 * Open Keel and follow the setup instructions.
Updating: Install the newer APK over the old one. Your local data is preserved.
Test Builds (Every Push)
Go to Actions → latest CI run → artifact keel-android (a zip file). Extract it and install keel-test-signed-universal.apk. Test builds use a throwaway key, so they cannot be updated in place (uninstalling removes their data, so back up first).
Good to Know
 * If you set a PIN, store the recovery key shown during setup. Without the PIN or the recovery key, the data cannot be recovered.
 * Keel sends nothing anywhere unless you connect Dropbox sync. To move data without sync, use Settings → Data → Create backup and restore it on the other phone.
Building the Android APK Yourself
Building Android packages requires the Android SDK, NDK 27, and Java 17, with environment variables configured (ANDROID_HOME, NDK_HOME, ANDROID_NDK_ROOT).
# Build a release APK containing all ABIs
npx tauri android build --apk

# Run live on a connected Android device or emulator
npx tauri android dev

Android Release Signing
Release builds read src-tauri/gen/android/keystore.properties (never commit this file):
storeFile=/absolute/path/keel-release.jks
storePassword=...
keyAlias=keel
keyPassword=...

Generate your signing key manually once (keep a secure offline backup; losing it permanently prevents updating existing device installations):
keytool -genkeypair -v -keystore keel-release.jks -alias keel -keyalg RSA -keysize 4096 -validity 10000