package ua.nikcar.fleet;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Native Supabase REST client. Only the publishable key ships inside the APK. */
final class NikCarApi {
    static final String BASE="https://cvrbpeuadfxgumvmosni.supabase.co";
    static final String KEY="sb_publishable_jHVXYfGP5tB_Xz4hhyyUWA_jqxy_N9V";
    private static final String ALIAS="nikcar_refresh_v1";
    private static final String WEB_REDIRECT="https://nikcar-cloud-pilot.onrender.com/";
    private static String encodedRedirect() throws Exception {return URLEncoder.encode(WEB_REDIRECT,"UTF-8");}
    private static byte[] bytes(InputStream in) throws Exception {try(ByteArrayOutputStream b=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){b.write(buffer,0,n);}return b.toByteArray();}}
    private final SharedPreferences prefs;
    private volatile String access="", refresh="",userId="";
    private volatile long expires=0;
    NikCarApi(Context context){prefs=context.getSharedPreferences("nikcar_session",Context.MODE_PRIVATE);}
    String userId(){return userId;}
    boolean signedIn(){return !access.trim().isEmpty();}
    void clear(){access="";refresh="";userId="";expires=0;prefs.edit().remove("refresh").apply();}
    void saveRefresh(String token) throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        if(!ks.containsAlias(ALIAS)){
            KeyGenerator kg=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());kg.generateKey();
        }
        SecretKey key=((KeyStore.SecretKeyEntry)ks.getEntry(ALIAS,null)).getSecretKey();
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key);
        byte[] encrypted=c.doFinal(token.getBytes(StandardCharsets.UTF_8));
        prefs.edit().putString("refresh",Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(encrypted,Base64.NO_WRAP)).apply();
    }
    String loadRefresh() throws Exception {
        String raw=prefs.getString("refresh","");if(raw.isEmpty())return "";
        String[] s=raw.split(":",2);if(s.length!=2)throw new Exception("Invalid stored session");
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        SecretKey key=((KeyStore.SecretKeyEntry)ks.getEntry(ALIAS,null)).getSecretKey();
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Base64.decode(s[0],Base64.DEFAULT)));
        return new String(c.doFinal(Base64.decode(s[1],Base64.DEFAULT)),StandardCharsets.UTF_8);
    }
    boolean restore() throws Exception {
        String token=loadRefresh();if(token.isEmpty())return false;
        try{authResponse(request("POST","/auth/v1/token?grant_type=refresh_token",new JSONObject().put("refresh_token",token).toString(),null,false,false));return true;}
        catch(Exception e){clear();return false;}
    }
    JSONObject login(String email,String password) throws Exception {
        JSONObject body=new JSONObject().put("email",email).put("password",password);
        JSONObject result=request("POST","/auth/v1/token?grant_type=password",body.toString(),null,false,false);
        authResponse(result);return result;
    }
    void register(String email,String password,String fullName) throws Exception {
        JSONObject body=new JSONObject().put("email",email).put("password",password)
            .put("data",new JSONObject().put("full_name",fullName));
        request("POST","/auth/v1/signup?redirect_to="+encodedRedirect(),body.toString(),null,false,false);
    }
    void resendConfirmation(String email) throws Exception {
        request("POST","/auth/v1/resend?redirect_to="+encodedRedirect(),new JSONObject().put("type","signup").put("email",email).toString(),null,false,false);
    }
    void sendReset(String email) throws Exception {
        request("POST","/auth/v1/recover?redirect_to="+encodedRedirect(),new JSONObject().put("email",email).toString(),null,false,false);
    }
    void authResponse(JSONObject result) throws Exception {
        access=result.optString("access_token","");refresh=result.optString("refresh_token","");
        if(access.trim().isEmpty()||refresh.trim().isEmpty())throw new Exception("Session tokens missing");
        expires=System.currentTimeMillis()+Math.max(120,result.optLong("expires_in",3600)-90)*1000;
        userId=result.optJSONObject("user")!=null?result.getJSONObject("user").optString("id",""):userId;
        saveRefresh(refresh);
    }
    private synchronized void ensureFresh() throws Exception {
        if(access.trim().isEmpty())throw new Exception("Sign in required");
        if(System.currentTimeMillis()<expires)return;
        JSONObject j=request("POST","/auth/v1/token?grant_type=refresh_token",
            new JSONObject().put("refresh_token",refresh).toString(),null,false,false);authResponse(j);
    }
    JSONObject request(String method,String path,String body,String mime,boolean auth,boolean rawObject) throws Exception {
        if(auth)ensureFresh();
        HttpURLConnection con=(HttpURLConnection)new URL(BASE+path).openConnection();
        con.setRequestMethod(method);con.setConnectTimeout(15000);con.setReadTimeout(25000);
        con.setRequestProperty("apikey",KEY);con.setRequestProperty("Accept","application/json");
        con.setRequestProperty("User-Agent","NikCar-Native-Android/1.0");
        if(auth)con.setRequestProperty("Authorization","Bearer "+access);
        if(body!=null){con.setDoOutput(true);con.setRequestProperty("Content-Type",mime==null?"application/json":mime);
            try(OutputStream o=con.getOutputStream()){o.write(body.getBytes(StandardCharsets.UTF_8));}}
        return parse(con,rawObject);
    }
    private JSONObject parse(HttpURLConnection con,boolean rawObject) throws Exception {
        int status=con.getResponseCode();InputStream input=(status>=400?con.getErrorStream():con.getInputStream());
        String response=input==null?"":new String(bytes(input),StandardCharsets.UTF_8);con.disconnect();
        if(status>=400){String err=response;try{JSONObject e=new JSONObject(response);err=e.optString("message",e.optString("msg",e.optString("error_description",e.optString("error",response))));}catch(Exception ignored){}
            throw new Exception("HTTP "+status+": "+err);}
        if(response.trim().isEmpty())return new JSONObject();
        if(response.trim().startsWith("[")){return new JSONObject().put("rows",new JSONArray(response));}
        if(response.trim().startsWith("{") ){return new JSONObject(response);}
        return new JSONObject().put("value",response.trim());
    }
    JSONArray select(String table,String params) throws Exception {
        return request("GET","/rest/v1/"+table+"?"+params,null,null,true,false).optJSONArray("rows");
    }
    JSONObject insert(String table,JSONObject obj) throws Exception {
        ensureFresh();
        HttpURLConnection con=(HttpURLConnection)new URL(BASE+"/rest/v1/"+table+"?select=*").openConnection();
        con.setRequestMethod("POST");con.setConnectTimeout(15000);con.setReadTimeout(25000);
        con.setRequestProperty("apikey",KEY);con.setRequestProperty("Authorization","Bearer "+access);
        con.setRequestProperty("Content-Type","application/json");con.setRequestProperty("Prefer","return=representation");con.setDoOutput(true);
        try(OutputStream out=con.getOutputStream()){out.write(obj.toString().getBytes(StandardCharsets.UTF_8));}
        JSONArray list=parse(con,false).optJSONArray("rows");return list!=null&&list.length()>0?list.getJSONObject(0):new JSONObject();
    }
    JSONArray patch(String table,String filter,JSONObject obj) throws Exception {
        ensureFresh();HttpURLConnection con=(HttpURLConnection)new URL(BASE+"/rest/v1/"+table+"?"+filter+"&select=*").openConnection();
        con.setRequestMethod("PATCH");con.setConnectTimeout(15000);con.setReadTimeout(25000);
        con.setRequestProperty("apikey",KEY);con.setRequestProperty("Authorization","Bearer "+access);
        con.setRequestProperty("Content-Type","application/json");con.setRequestProperty("Prefer","return=representation");con.setDoOutput(true);
        try(OutputStream out=con.getOutputStream()){out.write(obj.toString().getBytes(StandardCharsets.UTF_8));}
        return parse(con,false).optJSONArray("rows");
    }
    JSONObject rpc(String name,JSONObject body) throws Exception {return request("POST","/rest/v1/rpc/"+name,body.toString(),null,true,false);}
    byte[] storage(String method,String path,byte[] upload) throws Exception {
        ensureFresh();String url=BASE+"/storage/v1/object/nikcar-driver-docs/"+path;
        HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();c.setRequestMethod(method);c.setConnectTimeout(20000);c.setReadTimeout(35000);
        c.setRequestProperty("apikey",KEY);c.setRequestProperty("Authorization","Bearer "+access);
        if(upload!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","image/jpeg");c.setRequestProperty("x-upsert","false");try(OutputStream out=c.getOutputStream()){out.write(upload);}}
        int code=c.getResponseCode();InputStream in=code<400?c.getInputStream():c.getErrorStream();byte[] data=in==null?new byte[0]:bytes(in);c.disconnect();
        if(code>=400)throw new Exception("Photo storage HTTP "+code+": "+new String(data,StandardCharsets.UTF_8));return data;
    }
}