# NikCar Fleet Control — Android pilot 0.7

This is a **test Android WebView shell** pointing to the published NikCar Fleet Control cloud site:
https://nikcar-cloud-pilot.onrender.com

Build on GitHub Actions using `.github/workflows/nikcar-android.yml`, or in Android Studio with Android SDK Platform 36 and Gradle 8.13. Debug builds are **not signed for distribution or Play Store**; GitHub Actions automatically signs debug builds with ephemeral debug keys so the APK is locally installable. Installing a later debug build from a different Actions runner may require uninstalling the old debug build first.

## Android capabilities
- Browser-style secure login to existing Supabase account via live HTTPS app.
- HTML camera/gallery upload input uses native chooser. Photos must be under the server-side 6 MB limit.
- Open signed document URLs in external Android browser; no private documents bundled in APK.
- No privileged keys: only public key exists on hosted web page.
- Auto updates to live web console after next launch, but Android shell itself needs new APK for native updates.

## Security / product limitations
- Internet connection required. Server-side feature support limited to current cloud pilot: no lease handover, vehicle returns, debts, bank payments, fuel or Fuel Points.
- Driver identity documents are sensitive; keep using dummy photos until written privacy/retention/deletion policy and access audit are complete.
- Links outside nikcar-cloud-pilot.onrender.com open in external browser; SSL failures are never ignored.
- WebView loads external jsdelivr ES module; network access must permit it.
- This is a **development debug build**, not production. Play Store requires properly signed release AAB and policy compliance.
- Camera image from device may exceed 6 MB; use compressed images if needed. Production implementation should add native compression.

## Install
Download APK from latest successful GitHub Actions run artifact; unzip it and tap the `.apk` on Android, allow this source when prompted. For Play Store, separate signed release workflow and review are needed.