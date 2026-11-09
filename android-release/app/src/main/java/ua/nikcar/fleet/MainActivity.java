package ua.nikcar.fleet;

import android.Manifest;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.webkit.*;
import android.net.Uri;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.graphics.Color;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;

public class MainActivity extends Activity {
 private WebView web;
 private ValueCallback<Uri[]> fileCallback;
 private static final int PICK_FILE=401;
 private static final String APP_URL="https://nikcar-cloud-pilot.onrender.com/";
 @Override public void onCreate(Bundle state) {
  super.onCreate(state);
  LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);
  ProgressBar progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
  progress.setIndeterminate(true);layout.addView(progress,new LinearLayout.LayoutParams(-1,6));
  web=new WebView(this);layout.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(layout);
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
  settings.setAllowFileAccess(false);settings.setMediaPlaybackRequiresUserGesture(true);
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest req){
    Uri u=req.getUrl();if("https".equals(u.getScheme())&&"nikcar-cloud-pilot.onrender.com".equals(u.getHost()))return false;
    try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception ignored){}return true;
   }
   @Override public void onPageFinished(WebView view,String url){progress.setVisibility(View.GONE);}
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> callback,FileChooserParams params){
    if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
    try{startActivityForResult(params.createIntent(),PICK_FILE);return true;}
    catch(Exception e){fileCallback=null;return false;}
   }
   @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback callback){
    boolean allowed=checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;
    if(!allowed){requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},10);}
    callback.invoke(origin,allowed,false);
   }
  });
  web.loadUrl(APP_URL);
 }
 @Override protected void onActivityResult(int request,int result,Intent data){
  super.onActivityResult(request,result,data);
  if(request==PICK_FILE&&fileCallback!=null){fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));fileCallback=null;}
 }
 @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
 @Override protected void onDestroy(){web.destroy();super.onDestroy();}
}
