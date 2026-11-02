package ua.nikcar.fleet;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.ClipData;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Button;
import android.widget.Toast;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.URI;
import java.util.ArrayList;

/**
 * NikCar's Android pilot is a narrow WebView shell around the live HTTPS app.
 * It never stores or embeds a privileged Supabase key, and is not an offline rental app.
 */
public final class MainActivity extends Activity {
    private static final String HOME = "https://nikcar-cloud-pilot.onrender.com/";
    private static final String WEB_HOST = "nikcar-cloud-pilot.onrender.com";
    private static final int FILE_PICKER_REQUEST = 6308;
    private WebView webView;
    private LinearLayout offline;
    private ProgressBar progress;
    private ValueCallback<Uri[]> fileResult;
    private Uri cameraUri;
    private boolean cameraChosen;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        final FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(245,248,247));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        root.addView(webView, new FrameLayout.LayoutParams(-1,-1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        FrameLayout.LayoutParams pl = new FrameLayout.LayoutParams(-1, 7);
        root.addView(progress, pl);
        offline = new LinearLayout(this);
        offline.setOrientation(LinearLayout.VERTICAL);
        offline.setGravity(android.view.Gravity.CENTER);
        offline.setPadding(40,40,40,40);
        offline.setBackgroundColor(Color.rgb(245,248,247));
        TextView brand = new TextView(this);
        brand.setText("NikCar"); brand.setTextSize(30); brand.setTextColor(Color.rgb(7,132,119));
        brand.setGravity(android.view.Gravity.CENTER);
        TextView message = new TextView(this);
        message.setText("Нет соединения с NikCar. Проверьте интернет и повторите попытку.\n\nНемає з’єднання з NikCar. Перевірте інтернет.");
        message.setTextSize(15); message.setTextColor(Color.rgb(25,46,53));
        message.setGravity(android.view.Gravity.CENTER);
        Button retry = new Button(this); retry.setText("Повторить / Оновити");
        retry.setOnClickListener(v -> { offline.setVisibility(View.GONE); webView.loadUrl(HOME); });
        offline.addView(brand, new LinearLayout.LayoutParams(-1,-2));
        offline.addView(message, new LinearLayout.LayoutParams(-1,-2));
        offline.addView(retry, new LinearLayout.LayoutParams(-2,-2));
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(-1,-1));
        setContentView(root);
        if(Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view,insets) -> {
                android.graphics.Insets sys = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(sys.left,sys.top,sys.right,sys.bottom);
                return insets;
            });
        }
        setupBrowser();
        if (state == null) webView.loadUrl(HOME); else webView.restoreState(state);
    }

    private void setupBrowser() {
        final WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        WebView.setWebContentsDebuggingEnabled(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                String next = request.getUrl().toString();
                if (allowedAppPage(next)) return false;
                openExternal(next);
                return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); showOffline();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }
            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                if (allowedAppPage(url)) offline.setVisibility(View.GONE);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                      FileChooserParams params) {
                if (fileResult != null) fileResult.onReceiveValue(null);
                fileResult = callback;
                return showImageChooser(params);
            }
            @Override public boolean onCreateWindow(WebView view, boolean isDialog,
                    boolean isUserGesture, android.os.Message resultMsg) {
                if(!isUserGesture) return false;
                final WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest request) {
                        Uri destination=request.getUrl();
                        if ("https".equalsIgnoreCase(destination.getScheme()) &&
                            ("cvrbpeuadfxgumvmosni.supabase.co".equalsIgnoreCase(destination.getHost()) ||
                             WEB_HOST.equalsIgnoreCase(destination.getHost()))) {
                            openExternal(destination.toString());
                        }
                        w.post(w::destroy);
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport)resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
    }

    private boolean allowedAppPage(String url) {
        try {
            URI u = new URI(url);
            return "https".equalsIgnoreCase(u.getScheme()) && WEB_HOST.equalsIgnoreCase(u.getHost()) &&
                   (u.getPort()==-1 || u.getPort()==443) && u.getUserInfo()==null;
        } catch(Exception ignored) { return false; }
    }

    private void openExternal(String url) {
        try {
            Uri u=Uri.parse(url);
            if (!"https".equalsIgnoreCase(u.getScheme())) return;
            Intent intent = new Intent(Intent.ACTION_VIEW,u);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this,"Невозможно открыть ссылку",Toast.LENGTH_LONG).show();
        }
    }

    private void showOffline() {
        runOnUiThread(() -> { progress.setVisibility(View.GONE); offline.setVisibility(View.VISIBLE); });
    }

    private boolean showImageChooser(WebChromeClient.FileChooserParams params) {
        cameraUri = null;
        cameraChosen = false;
        try {
            Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
            gallery.setType("image/*");
            gallery.addCategory(Intent.CATEGORY_OPENABLE);
            gallery.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(gallery, "NikCar · Выберите фотографию");
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            if(camera.resolveActivity(getPackageManager())!=null) {
                File dir = new File(getCacheDir(), "camera");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("No camera cache");
                File shot = File.createTempFile("nikcar_", ".jpg", dir);
                cameraUri = FileProvider.getUriForFile(this,getPackageName()+".files",shot);
                camera.putExtra(MediaStore.EXTRA_OUTPUT,cameraUri);
                camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_READ_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS,new Intent[]{camera});
            }
            startActivityForResult(chooser,FILE_PICKER_REQUEST);
            return true;
        } catch (Exception e) {
            if(fileResult!=null) fileResult.onReceiveValue(null);
            fileResult=null;
            cameraUri=null;
            Toast.makeText(this,"Не удалось открыть фотографии",Toast.LENGTH_LONG).show();
            return true;
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode!=FILE_PICKER_REQUEST) return;
        if(fileResult==null) return;
        Uri[] selection = null;
        if(resultCode==RESULT_OK) {
            // The gallery returns an URI in data. Camera output is pre-created in app cache.
            if(data!=null && data.getData()!=null) {
                Uri uri=data.getData();
                if("content".equals(uri.getScheme())) selection = new Uri[]{uri};
            } else if(cameraUri!=null) {
                selection = new Uri[]{cameraUri};
            }
        }
        fileResult.onReceiveValue(selection);
        fileResult=null;
        cameraUri=null;
    }

    @Override public void onBackPressed() {
        if(offline.getVisibility()==View.VISIBLE) { offline.setVisibility(View.GONE); webView.loadUrl(HOME); return; }
        if(webView.canGoBack()) { webView.goBack(); return; }
        new AlertDialog.Builder(this).setTitle("NikCar")
            .setMessage("Закрыть приложение?")
            .setNegativeButton("Отмена",null).setPositiveButton("Закрыть",(d,w)->finish()).show();
    }
    @Override protected void onSaveInstanceState(Bundle state) { webView.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onDestroy() {
        if(fileResult!=null) fileResult.onReceiveValue(null);
        if(webView!=null) { webView.destroy(); webView=null; }
        super.onDestroy();
    }
}