# NikCar Android — test build

Android Trusted Web Activity shell for https://nikcar-cloud-pilot.onrender.com/.

To build: install Android SDK 35, Java 17 and Gradle 8.9; run `cd android-app && gradle :app:assembleDebug`. Debug APK is for internal testing only.

To publish on Google Play: sign a release AAB, set up Play App Signing, and host `/.well-known/assetlinks.json` with package `ua.nikcar.fleet` and the real signing certificate SHA-256 fingerprint. Until domain association is verified, Chrome may show its address bar. Test login, camera, location and notifications on actual Android devices. Native background push requires separate implementation. Do not commit keystore or signing credentials.
