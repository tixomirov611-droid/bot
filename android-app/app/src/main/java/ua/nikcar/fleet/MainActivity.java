package ua.nikcar.fleet;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;

/**
 * Android shell for the existing NikCar website.
 * Chrome verifies the association via /.well-known/assetlinks.json.
 * Until verified, the browser may show its address bar.
 */
public final class MainActivity extends Activity {
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri url = Uri.parse("https://nikcar-cloud-pilot.onrender.com/");
        try {
            new TrustedWebActivityIntentBuilder(url)
                .build(this)
                .launchTrustedWebActivity(this);
        } catch (Exception ignored) {
            android.content.Intent browser = new android.content.Intent(android.content.Intent.ACTION_VIEW, url);
            startActivity(browser);
        }
        finish();
    }
}
