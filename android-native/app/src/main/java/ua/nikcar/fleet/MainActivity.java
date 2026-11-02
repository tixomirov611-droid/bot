package ua.nikcar.fleet;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** NikCar Android Native Pilot: no WebView, no embedded webpages. All screens are Android Views. */
public final class MainActivity extends Activity {
    private static final int TEAL=Color.rgb(4,121,108), BG=Color.rgb(245,249,248), DARK=Color.rgb(25,45,52), MUTED=Color.rgb(91,115,120);
    private static final int PHOTO_REQUEST=71;
    private NikCarApi api;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private LinearLayout root, body, toolbar, bottom;
    private JSONObject profile=new JSONObject();
    private final Map<String,JSONArray> data=new HashMap<>();
    private String page="cars", role="", access="", selectedCar="", photoKind="", photoCar="", currentRepair="", authEmail="";
    private boolean busy=false, english=false;

    interface Job {void run() throws Exception;}
    interface Done {void run();}
    @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(TEAL);getWindow().setNavigationBarColor(BG);api=new NikCarApi(this);buildShell();working("Відновлення сеансу…");job(()->{if(api.restore())refreshData();},()->render());}
    @Override protected void onDestroy(){super.onDestroy();executor.shutdownNow();}
    private String tr(String uk,String en){return english?en:uk;}
    private int dp(float n){return Math.round(getResources().getDisplayMetrics().density*n);}
    private GradientDrawable shape(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    private TextView label(String txt,int sp,boolean bold,int color){TextView t=new TextView(this);t.setText(txt);t.setTextSize(sp);t.setTextColor(color);t.setTypeface(null,bold?Typeface.BOLD:Typeface.NORMAL);t.setPadding(dp(2),dp(5),dp(2),dp(5));return t;}
    private LinearLayout column(){LinearLayout a=new LinearLayout(this);a.setOrientation(LinearLayout.VERTICAL);return a;}
    private LinearLayout row(){LinearLayout a=new LinearLayout(this);a.setOrientation(LinearLayout.HORIZONTAL);a.setGravity(Gravity.CENTER_VERTICAL);return a;}
    private LinearLayout.LayoutParams match(){return new LinearLayout.LayoutParams(-1,-2);}
    private void add(LinearLayout holder,View v){holder.addView(v,match());}
    private void space(LinearLayout h,int dp){View v=new View(this);h.addView(v,new LinearLayout.LayoutParams(1,dp(dp)));}
    private void buildShell(){root=column();root.setBackgroundColor(BG);root.setPadding(0,0,0,0);setContentView(root);toolbar=row();toolbar.setPadding(dp(18),dp(9),dp(16),dp(9));toolbar.setBackgroundColor(TEAL);add(root,toolbar);ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));body=column();body.setPadding(dp(16),dp(12),dp(16),dp(28));scroll.addView(body);HorizontalScrollView nav=new HorizontalScrollView(this);nav.setHorizontalScrollBarEnabled(false);nav.setBackgroundColor(Color.WHITE);root.addView(nav,match());bottom=row();bottom.setPadding(dp(4),dp(6),dp(4),dp(8));nav.addView(bottom);}
    private void toast(String msg){Toast.makeText(this,msg,Toast.LENGTH_LONG).show();}
    private void working(String msg){body.removeAllViews();add(body,label(msg,17,true,DARK));}
    private void job(Job j,Done done){if(busy){toast(tr("Зачекайте завершення запиту","Request in progress"));return;}busy=true;executor.execute(()->{String error=null;try{j.run();}catch(Exception e){error=e.getMessage();}final String failure=error;runOnUiThread(()->{if(isFinishing()||isDestroyed())return;busy=false;if(failure!=null)toast(failure);if(done!=null)done.run();});});}
    private void refreshData() throws Exception {
        if(!api.signedIn())return;
        JSONArray mine=api.select("profiles","select=id,user_id,full_name,phone,role,access&user_id=eq."+api.userId());
        if(mine==null||mine.length()==0)throw new Exception(tr("Профіль ще створюється. Спробуйте оновити.","Profile is not ready. Refresh."));
        profile=mine.getJSONObject(0);role=profile.optString("role");access=profile.optString("access");
        String[] tables={"cars","rental_requests","driver_documents","payment_claims","chat_messages","sos_requests","announcements","profiles","repair_jobs","repair_parts","expense_entries"};
        for(String table:tables){if(!isOwner() && (table.equals("repair_jobs")||table.equals("repair_parts")||table.equals("expense_entries")))continue;
            String cols="*";if(table.equals("profiles"))cols="id,user_id,full_name,phone,role,access,created_at";
            try{JSONArray a=api.select(table,"select="+cols+"&limit=250");data.put(table,a==null?new JSONArray():a);}catch(Exception ignored){data.put(table,new JSONArray());}
        }
    }
    private boolean isOwner(){return "owner".equals(role)&&"active".equals(access);}
    private boolean activeDriver(){return "driver".equals(role)&&"active".equals(access);}
    private String myId(){return profile.optString("id");}
    private JSONArray arr(String table){return data.getOrDefault(table,new JSONArray());}
    private JSONObject find(String table,String id){JSONArray a=arr(table);for(int i=0;i<a.length();i++){JSONObject v=a.optJSONObject(i);if(v!=null&&id.equals(v.optString("id")))return v;}return new JSONObject();}
    private String carLabel(String id){JSONObject j=find("cars",id);return j.optString("model",tr("Авто","Car"))+" · "+j.optString("plate","");}
    private String personLabel(String id){JSONObject p=find("profiles",id);return p.optString("full_name","").trim().isEmpty()?id.substring(0,Math.min(8,id.length())):p.optString("full_name");}
    private String fmt(Object o){return o==null?"0":o.toString();}
    private String money(Object o){return fmt(o)+" ₴";}
    private String date(String v){return v.length()>=16?v.substring(0,16).replace('T',' '):v;}
    private void title(String text){add(body,label(text,23,true,DARK));space(body,10);}
    private void info(String text){add(body,label(text,13,false,MUTED));}
    private LinearLayout card(){LinearLayout c=column();c.setPadding(dp(15),dp(13),dp(15),dp(14));c.setBackground(shape(Color.WHITE,15));LinearLayout.LayoutParams p=match();p.bottomMargin=dp(11);body.addView(c,p);return c;}
    private Button btn(String text,boolean primary,Runnable action){Button b=new Button(this);b.setAllCaps(false);b.setText(text);b.setTextSize(14);b.setTextColor(primary?Color.WHITE:TEAL);b.setBackground(shape(primary?TEAL:Color.rgb(230,244,241),10));b.setPadding(dp(14),dp(8),dp(14),dp(8));b.setOnClickListener(v->action.run());return b;}
    private void action(LinearLayout parent,String text,boolean primary,Runnable r){LinearLayout.LayoutParams p=match();p.topMargin=dp(5);parent.addView(btn(text,primary,r),p);}
    private EditText field(LinearLayout h,String hint,String value,int input){EditText e=new EditText(this);e.setSingleLine(true);e.setHint(hint);e.setText(value);e.setTextColor(DARK);e.setTextSize(16);e.setInputType(input);e.setPadding(dp(8),dp(13),dp(8),dp(13));add(h,e);return e;}
    private void alert(String message){new AlertDialog.Builder(this).setTitle("NikCar").setMessage(message).setPositiveButton("OK",(d,w)->{}).show();}
    private void confirm(String text,Runnable yes){new AlertDialog.Builder(this).setTitle("NikCar").setMessage(text).setNegativeButton(tr("Скасувати","Cancel"),null).setPositiveButton(tr("Підтвердити","Confirm"),(d,w)->yes.run()).show();}
    private void send(Job j){job(()->{j.run();refreshData();},this::render);}
    private void navigate(String p){page=p;render();}
    private void render(){toolbar.removeAllViews();body.removeAllViews();bottom.removeAllViews();
        TextView brand=label("NikCar",24,true,Color.WHITE);toolbar.addView(brand,new LinearLayout.LayoutParams(0,-2,1));
        TextView lang=label(english?"UA":"EN",14,true,Color.WHITE);lang.setOnClickListener(v->{english=!english;render();});toolbar.addView(lang);
        if(!api.signedIn()){loginPage();return;}
        if(profile.length()==0){action(body,tr("Оновити","Refresh"),true,()->send(()->{}));return;}
        String[] tabs=isOwner()?new String[]{"overview","cars","requests","drivers","payments","repairs","chat","sos","announcements","documents","profile"}:
                new String[]{"cars","requests","documents","payments","chat","sos","announcements","profile"};
        for(String tab:tabs){Button x=btn(tabTitle(tab),tab.equals(page),()->navigate(tab));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,dp(49));p.setMargins(dp(3),0,dp(3),0);bottom.addView(x,p);}
        if(isOwner()){
            switch(page){case "overview":overview();break;case "cars":carsPage();break;case "requests":requestPage();break;case "drivers":driversPage();break;case "documents":documentsPage();break;case "payments":paymentsPage();break;case "repairs":repairsPage();break;case "chat":chatPage();break;case "sos":sosPage();break;case "announcements":announcementsPage();break;default:profilePage();}
        }else{
            switch(page){case "cars":carsPage();break;case "requests":requestPage();break;case "documents":documentsPage();break;case "payments":paymentsPage();break;case "chat":chatPage();break;case "sos":sosPage();break;case "announcements":announcementsPage();break;default:profilePage();}
        }
    }
    private String tabTitle(String t){switch(t){case "overview":return tr("Огляд","Overview");case "cars":return tr("Авто","Cars");case "requests":return tr("Заявки","Requests");case "drivers":return tr("Водії","Drivers");case "documents":return tr("Документи","Docs");case "payments":return tr("Оплата","Payments");case "repairs":return tr("Ремонти","Repairs");case "chat":return tr("Чат","Chat");case "sos":return "SOS";case "announcements":return tr("Оголошення","News");default:return tr("Профіль","Account");}}
    private void loginPage(){title(tr("Вхід до автопарку","Fleet account"));LinearLayout c=card();info(tr("Вхід лише email і пароль. Google/Apple ще не підключені.","Email/password only. Google/Apple are not enabled."));
        EditText email=field(c,"Email",authEmail,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        EditText password=field(c,tr("Пароль","Password"),"",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        action(c,tr("Увійти","Sign in"),true,()->{authEmail=email.getText().toString().trim();job(()->{api.login(authEmail,password.getText().toString());refreshData();},()->{if(api.signedIn())page="cars";render();});});
        action(c,tr("Зареєструватись","Sign up"),false,()->signUpDialog());
        action(c,tr("Надіслати підтвердження повторно","Resend confirmation"),false,()->emailAction(true));
        action(c,tr("Забули пароль?","Forgot password?"),false,()->emailAction(false));
        info(tr("Після підтвердження email поверніться у додаток та увійдіть. Не завантажуйте справжні документи в тестовій версії.","After confirming email, return to this app and sign in. Do not upload real identity documents during pilot."));}
    private void signUpDialog(){LinearLayout layout=column();layout.setPadding(dp(18),dp(6),dp(18),0);EditText name=field(layout,tr("ПІБ","Full name"),"",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_WORDS);EditText email=field(layout,"Email",authEmail,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);EditText pass=field(layout,tr("Пароль від 8 символів","Password, at least 8 chars"),"",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        new AlertDialog.Builder(this).setTitle(tr("Реєстрація водія","Driver registration")).setView(layout).setNegativeButton(tr("Назад","Back"),null).setPositiveButton(tr("Створити","Create"),(d,w)->job(()->api.register(email.getText().toString().trim(),pass.getText().toString(),name.getText().toString().trim()),()->{authEmail=email.getText().toString().trim();alert(tr("Перевірте email і натисніть посилання підтвердження. Потім увійдіть у NikCar.","Check your email and confirm your account. Then sign in to NikCar."));})).show();}
    private void emailAction(boolean resend){EditText input=new EditText(this);input.setHint("Email");input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);input.setText(authEmail);new AlertDialog.Builder(this).setTitle(resend?tr("Повторне підтвердження","Resend confirmation"):tr("Відновлення пароля","Password recovery")).setView(input).setNegativeButton(tr("Скасувати","Cancel"),null).setPositiveButton(tr("Надіслати","Send"),(d,w)->job(()->{String email=input.getText().toString().trim();if(resend)api.resendConfirmation(email);else api.sendReset(email);},()->toast(tr("Якщо адреса існує, перевірте пошту. Посилання відкриється на сайті NikCar.","Check your email for a NikCar link.")))).show();}
    private void overview(){title(tr("Панель власника","Owner dashboard"));LinearLayout c=card();add(c,label(tr("Автомобілі: ","Cars: ")+arr("cars").length(),19,true,DARK));add(c,label(tr("Водії: ","Drivers: ")+arr("profiles").length(),18,false,DARK));add(c,label(tr("Заявки: ","Requests: ")+arr("rental_requests").length(),18,false,DARK));add(c,label(tr("Платежі на перевірку: ","Payments pending: ")+countStatus("payment_claims","declared"),18,true,TEAL));add(c,label(tr("SOS: ","SOS: ")+countStatus("sos_requests","open"),18,false,DARK));info(tr("АЗС та Fuel Points вимкнені до окремого оновлення.","Fuel station and Fuel Points are not available yet."));action(body,tr("Оновити дані","Refresh data"),true,()->send(()->{}));}
    private int countStatus(String tbl,String status){int n=0;JSONArray a=arr(tbl);for(int i=0;i<a.length();i++){JSONObject j=a.optJSONObject(i);if(j!=null&&status.equals(j.optString("status")))n++;}return n;}
    private void carsPage(){title(tr("Автопарк","Fleet"));if(isOwner())action(body,tr("+ Додати автомобіль","+ Add car"),true,this::addCar);
        if(arr("cars").length()==0)info(tr("Автомобілів поки немає.","No vehicles yet."));JSONArray a=arr("cars");for(int i=0;i<a.length();i++){JSONObject car=a.optJSONObject(i);if(car==null)continue;
            LinearLayout c=card();add(c,label(car.optString("model")+" · "+car.optString("plate"),19,true,DARK));add(c,label(money(car.opt("daily_rate"))+tr(" / доба"," / day"),16,true,TEAL));info(car.optString("status"));
            if(!isOwner()&&"free".equals(car.optString("status"))){action(c,tr("Вибрати авто","Select car"),true,()->{selectedCar=car.optString("id");page="documents";render();});}
        }}
    private void addCar(){LinearLayout lay=column();lay.setPadding(dp(14),0,dp(14),0);EditText plate=field(lay,tr("Держномер","Plate"),"",InputType.TYPE_CLASS_TEXT);EditText model=field(lay,tr("Марка та модель","Model"),"",InputType.TYPE_CLASS_TEXT);EditText year=field(lay,tr("Рік (необов'язково)","Year (optional)"),"",InputType.TYPE_CLASS_NUMBER);EditText rate=field(lay,tr("Оренда грн/доба","Daily rate UAH"),"",InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
        new AlertDialog.Builder(this).setTitle(tr("Нове авто","New car")).setView(lay).setNegativeButton(tr("Скасувати","Cancel"),null).setPositiveButton(tr("Додати","Add"),(d,w)->send(()->{JSONObject b=new JSONObject().put("plate",plate.getText().toString().trim().toUpperCase(Locale.ROOT)).put("model",model.getText().toString().trim()).put("daily_rate",Double.parseDouble(rate.getText().toString()));if(year.length()>0)b.put("year",Integer.parseInt(year.getText().toString()));api.insert("cars",b);})).show();}
    private void requestPage(){title(tr("Заявки на авто","Rental requests"));JSONArray a=arr("rental_requests");int shown=0;
        for(int i=0;i<a.length();i++){JSONObject r=a.optJSONObject(i);if(r==null)continue;if(!isOwner()&&!myId().equals(r.optString("driver_id")))continue;shown++;
            LinearLayout c=card();add(c,label(carLabel(r.optString("car_id")),17,true,DARK));add(c,label(tr("Статус: ","Status: ")+r.optString("status"),14,false,MUTED));if(isOwner())add(c,label(personLabel(r.optString("driver_id")),15,false,DARK));
            if(isOwner()&&"pending".equals(r.optString("status"))){action(c,tr("Схвалити","Approve"),true,()->updateRequest(r.optString("id"),"approved"));action(c,tr("Відхилити","Reject"),false,()->updateRequest(r.optString("id"),"rejected"));}
            if(!isOwner()&&"pending".equals(r.optString("status")))action(c,tr("Скасувати заявку","Cancel request"),false,()->updateRequest(r.optString("id"),"cancelled"));
        }if(shown==0)info(tr("Заявок поки немає.","No requests yet."));}
    private void updateRequest(String id,String status){confirm(tr("Змінити статус заявки?","Change request status?"),()->send(()->api.patch("rental_requests","id=eq."+id,new JSONObject().put("status",status))));}
    private void driversPage(){title(tr("Водії","Drivers"));JSONArray a=arr("profiles");for(int i=0;i<a.length();i++){JSONObject p=a.optJSONObject(i);if(p==null||!"driver".equals(p.optString("role")))continue;
        LinearLayout c=card();add(c,label(p.optString("full_name","" ).trim().isEmpty()?p.optString("user_id"):p.optString("full_name"),17,true,DARK));add(c,label(p.optString("access")+" · "+p.optString("phone"),14,false,MUTED));action(c,tr("Змінити доступ","Change access"),false,()->{String[] states={"candidate","active","archived","blocked"};new AlertDialog.Builder(this).setTitle(tr("Статус водія","Driver access")).setItems(states,(dlg,index)->confirm(tr("Змінити доступ?","Change access?"),()->send(()->api.rpc("nikcar_owner_set_driver_access",new JSONObject().put("target_driver_id",p.optString("id")).put("target_access",states[index]))))).show();});}}
    private void documentsPage(){title(tr("Документи водія","Driver documents"));if(isOwner()){info(tr("Документи доступні лише водію та власнику. Не завантажуйте реальні дані, доки не завершено перевірку захисту персональних даних.","Private documents. Use test files only."));}
        else{info(tr("Після вибору авто завантажте 3 сторінки паспорта, РНОКПП та договір саме цього авто.","Select a car and provide the 3 passport pages, tax ID and rental contract."));
            if(!selectedCar.trim().isEmpty())add(body,label(tr("Обране авто: ","Selected car: ")+carLabel(selectedCar),17,true,TEAL));
            else action(body,tr("Обрати автомобіль","Choose car"),true,()->navigate("cars"));}
        JSONArray docs=arr("driver_documents");String[] types={"passport_1","passport_2","passport_3","tax_id","rental_contract"};String[] captions={tr("Паспорт · сторінка 1","Passport · page 1"),tr("Паспорт · сторінка 2","Passport · page 2"),tr("Паспорт · сторінка 3","Passport · page 3"),tr("ІПН / РНОКПП","Tax ID"),tr("Договір оренди","Rental contract")};
        if(isOwner()){for(int i=0;i<docs.length();i++){JSONObject d=docs.optJSONObject(i);if(d==null)continue;LinearLayout c=card();add(c,label(personLabel(d.optString("driver_id"))+" · "+d.optString("kind"),16,true,DARK));action(c,tr("Переглянути фото","View image"),false,()->viewPhoto(d.optString("object_path")));}return;}
        for(int i=0;i<types.length;i++){String kind=types[i];JSONObject doc=findDocument(kind,selectedCar);LinearLayout c=card();add(c,label(captions[i],16,true,DARK));add(c,label(doc.length()>0?tr("Завантажено","Uploaded"):tr("Немає фото","Missing"),14,false,doc.length()>0?TEAL:MUTED));if(doc.length()>0)action(c,tr("Переглянути","View"),false,()->viewPhoto(doc.optString("object_path")));
            else if(!selectedCar.trim().isEmpty())action(c,tr("Зробити або вибрати фото","Take or select photo"),false,()->{photoKind=kind;photoCar=selectedCar;selectPhoto();});}
        if(!selectedCar.trim().isEmpty()){
            boolean complete=true;for(String kind:types){if(findDocument(kind,selectedCar).length()==0){complete=false;break;}}
            if(complete){action(body,tr("Завершити вибір — надіслати заявку","Complete selection — request car"),true,()->confirm(tr("Відправити заявку власнику?","Send rental request?"),()->send(()->{api.insert("rental_requests",new JSONObject().put("car_id",selectedCar).put("driver_id",myId()));selectedCar="";page="requests";})));}
            else info(tr("Без усіх п'яти документів завершити вибір авто неможливо. Обмеження перевіряється також у базі даних.","All five documents are required by the server."));
        }}
    private JSONObject findDocument(String kind,String carId){JSONArray docs=arr("driver_documents");for(int i=0;i<docs.length();i++){JSONObject d=docs.optJSONObject(i);if(d==null||!myId().equals(d.optString("driver_id"))||!kind.equals(d.optString("kind")))continue;if(kind.equals("rental_contract")&&!carId.equals(d.optString("car_id")))continue;return d;}return new JSONObject();}
    private void selectPhoto(){Intent intent=new Intent(Intent.ACTION_GET_CONTENT);intent.setType("image/*");intent.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(Intent.createChooser(intent,tr("Виберіть тестове фото","Choose test image")),PHOTO_REQUEST);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=PHOTO_REQUEST||result!=RESULT_OK||data==null||data.getData()==null)return;Uri uri=data.getData();
        confirm(tr("Завантажити обране фото? Поки що використовуйте тільки тестові зображення.","Upload selected test photo?"),()->send(()->{
            byte[] bytes;try(InputStream stream=getContentResolver().openInputStream(uri)){Bitmap original=BitmapFactory.decodeStream(stream);if(original==null)throw new Exception("Invalid image");int max=1600;int w=original.getWidth(),h=original.getHeight();Bitmap compressed=original;if(w>max||h>max){float factor=Math.min((float)max/w,(float)max/h);compressed=Bitmap.createScaledBitmap(original,Math.max(1,(int)(w*factor)),Math.max(1,(int)(h*factor)),true);}ByteArrayOutputStream mem=new ByteArrayOutputStream();if(!compressed.compress(Bitmap.CompressFormat.JPEG,78,mem))throw new Exception("Photo compression failed");bytes=mem.toByteArray();if(compressed!=original)compressed.recycle();original.recycle();}
            String filename=UUID.randomUUID().toString().replace("-","")+".jpg";
            String path=api.userId()+"/"+photoKind+"/"+(photoKind.equals("rental_contract")?photoCar+"/":"")+filename;
            api.storage("POST",path,bytes);
            JSONObject row=new JSONObject().put("driver_id",myId()).put("kind",photoKind).put("object_path",path);
            if(photoKind.equals("rental_contract"))row.put("car_id",photoCar);
            api.insert("driver_documents",row);
        }));}
    private void viewPhoto(String path){job(()->{byte[] b=api.storage("GET",path,null);Bitmap img=BitmapFactory.decodeByteArray(b,0,b.length);if(img==null)throw new Exception("Cannot decode image");runOnUiThread(()->{ImageView view=new ImageView(this);view.setImageBitmap(img);view.setAdjustViewBounds(true);new AlertDialog.Builder(this).setTitle(tr("Приватний документ","Private document")).setView(view).setPositiveButton(tr("Закрити","Close"),null).show();});},null);}
    private void paymentsPage(){title(tr("Облік платежів","Payments"));info(tr("Повідомлення «Оплатив» ще не означає, що гроші надійшли. Лише власник може підтвердити отримання.","A driver's payment claim is not a receipt until the owner confirms."));
        if(!isOwner())action(body,tr("Повідомити про оплату","Report payment"),true,this::reportPayment);
        JSONArray a=arr("payment_claims");for(int i=0;i<a.length();i++){JSONObject p=a.optJSONObject(i);if(p==null||(!isOwner()&&!myId().equals(p.optString("driver_id"))))continue;
            LinearLayout c=card();add(c,label(money(p.opt("amount"))+" · "+p.optString("method"),19,true,TEAL));add(c,label(tr("Статус: ","Status: ")+p.optString("status"),14,true,DARK));if(isOwner())add(c,label(personLabel(p.optString("driver_id")),14,false,MUTED));
            if(isOwner()&&"declared".equals(p.optString("status"))){action(c,tr("Підтвердити отримання","Confirm received"),true,()->decidePayment(p.optString("id"),true));action(c,tr("Відхилити","Reject"),false,()->decidePayment(p.optString("id"),false));}
        }}
    private void reportPayment(){JSONArray r=arr("rental_requests");ArrayList<JSONObject> approved=new ArrayList<>();for(int i=0;i<r.length();i++){JSONObject j=r.optJSONObject(i);if(j!=null&&myId().equals(j.optString("driver_id"))&&"approved".equals(j.optString("status")))approved.add(j);}
        if(approved.isEmpty()){alert(tr("Спершу потрібна схвалена заявка на авто.","Approved rental required."));return;}
        String[] labels=new String[approved.size()];for(int i=0;i<approved.size();i++)labels[i]=carLabel(approved.get(i).optString("car_id"));
        new AlertDialog.Builder(this).setTitle(tr("Оберіть авто","Choose rental")).setItems(labels,(d,which)->{
            LinearLayout lay=column();lay.setPadding(dp(18),0,dp(18),0);EditText amount=field(lay,tr("Сума, грн","Amount UAH"),"",InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);String[] methods={tr("Готівка","Cash"),tr("Переказ на картку","Card transfer")};final int[] picked={0};RadioGroup rg=new RadioGroup(this);for(int z=0;z<2;z++){RadioButton b=new RadioButton(this);b.setText(methods[z]);b.setId(100+z);rg.addView(b);}rg.check(100);lay.addView(rg);
            EditText note=field(lay,tr("Примітка (необов'язково)","Note (optional)"),"",InputType.TYPE_CLASS_TEXT);
            new AlertDialog.Builder(this).setTitle(tr("Повідомити про оплату","Report payment")).setView(lay).setNegativeButton(tr("Скасувати","Cancel"),null).setPositiveButton(tr("Оплатив — повідомити","Paid — notify"),(d2,w)->send(()->{double value=Double.parseDouble(amount.getText().toString());api.insert("payment_claims",new JSONObject().put("driver_id",myId()).put("rental_request_id",approved.get(which).optString("id")).put("amount",value).put("method",rg.getCheckedRadioButtonId()==100?"cash":"card_transfer").put("driver_note",note.getText().toString()));})).show();
        }).show();}
    private void decidePayment(String id,boolean confirm){confirm(confirm?tr("Підтверджуєте, що гроші реально отримано?","Confirm money was received?"):tr("Відхилити платіж?","Reject claim?"),()->send(()->api.rpc("nikcar_decide_payment",new JSONObject().put("p_id",id).put("p_confirm",confirm).put("p_note",""))));}
    private void repairsPage(){title(tr("Ремонти та витрати","Repairs and expenses"));if(!isOwner())return;
        action(body,tr("+ Новий розрахунок","+ New estimate"),true,this::newRepair);
        JSONArray repairs=arr("repair_jobs");for(int i=0;i<repairs.length();i++){JSONObject r=repairs.optJSONObject(i);if(r==null)continue;LinearLayout c=card();add(c,label(r.optString("title"),18,true,DARK));add(c,label(carLabel(r.optString("car_id")),15,false,MUTED));add(c,label(tr("Статус: ","Status: ")+r.optString("status"),14,false,TEAL));double total=r.optDouble("labor_cost",0);JSONArray parts=arr("repair_parts");for(int j=0;j<parts.length();j++){JSONObject p=parts.optJSONObject(j);if(p!=null&&r.optString("id").equals(p.optString("repair_id")))total+=p.optDouble("quantity")*p.optDouble("unit_price");}
            add(c,label(tr("Разом: ","Total: ")+money(String.format(Locale.US,"%.2f",total)),18,true,TEAL));
            if("draft".equals(r.optString("status"))){action(c,tr("Додати деталь","Add part"),false,()->addPart(r.optString("id")));action(c,tr("Провести у витрати","Post expense"),true,()->confirm(tr("Витрата буде записана остаточно. Підтвердити?","Post final expense?"),()->send(()->api.rpc("nikcar_post_repair",new JSONObject().put("p_repair",r.optString("id"))))));}
        }
        info(tr("Ціни Inter Cars поки вводяться вручну. Автоматичний API-пошук не активовано.","Inter Cars prices are manual until an authorized API connection is configured."));}
    private void newRepair(){JSONArray cars=arr("cars");if(cars.length()==0){alert(tr("Спочатку додайте автомобіль","Add a vehicle first"));return;}String[] labels=new String[cars.length()];for(int i=0;i<cars.length();i++)labels[i]=carLabel(cars.optJSONObject(i).optString("id"));new AlertDialog.Builder(this).setTitle(tr("Оберіть авто","Choose car")).setItems(labels,(d,index)->{LinearLayout lay=column();lay.setPadding(dp(14),0,dp(14),0);EditText title=field(lay,tr("Назва ремонту","Repair title"),"",InputType.TYPE_CLASS_TEXT);EditText vin=field(lay,"VIN (17)","",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);EditText symptoms=field(lay,tr("Опис несправності","Symptoms"),"",InputType.TYPE_CLASS_TEXT);EditText labor=field(lay,tr("Робота, грн","Labor UAH"),"0",InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);new AlertDialog.Builder(this).setTitle(tr("Кошторис ремонту","Repair estimate")).setView(lay).setNegativeButton(tr("Скасувати","Cancel"),null).setPositiveButton(tr("Створити","Create"),(d2,w)->send(()->{JSONObject obj=new JSONObject().put("car_id",cars.optJSONObject(index).optString("id")).put("created_by",myId()).put("title",title.getText().toString()).put("symptoms",symptoms.getText().toString()).put("labor_cost",Double.parseDouble(labor.getText().toString()));if(!vin.getText().toString().trim().isEmpty())obj.put("vin",vin.getText().toString().trim().toUpperCase(Locale.ROOT));api.insert("repair_jobs",obj);})).show();}).show();}
    private void addPart(String id){LinearLayout lay=column();lay.setPadding(dp(14),0,dp(14),0);EditText item=field(lay,tr("Назва запчастини","Part"),"",InputType.TYPE_CLASS_TEXT);EditText article=field(lay,tr("Артикул","Article"),"",InputType.TYPE_CLASS_TEXT);EditText qty=field(lay,tr("Кількість","Quantity"),"1",InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);EditText price=field(lay,tr("Ціна за одиницю, грн","Unit price"),"",InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);EditText url=field(lay,tr("Посилання HTTPS (якщо є)","HTTPS URL"),"",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
        new AlertDialog.Builder(this).setTitle(tr("Додати деталь","Add part")).setView(lay).setNegativeButton(tr("Скасувати","Cancel"),null).setPositiveButton(tr("Додати","Add"),(d,w)->send(()->api.insert("repair_parts",new JSONObject().put("repair_id",id).put("item_name",item.getText().toString()).put("article",article.getText().toString()).put("quantity",Double.parseDouble(qty.getText().toString())).put("unit_price",Double.parseDouble(price.getText().toString())).put("supplier","manual").put("supplier_url",url.getText().toString().trim())))).show();}
    private void chatPage(){title(tr("Чат автопарку","Fleet chat"));if(!isOwner()&&!activeDriver()){info(tr("Чат доступний тільки активним водіям.","Chat requires active driver status."));return;}
        JSONArray a=arr("chat_messages");for(int i=Math.max(0,a.length()-70);i<a.length();i++){JSONObject m=a.optJSONObject(i);if(m==null)continue;LinearLayout c=card();add(c,label(personLabel(m.optString("sender_id"))+" · "+date(m.optString("created_at")),12,true,TEAL));add(c,label(m.optString("body"),16,false,DARK));}
        LinearLayout c=card();EditText message=field(c,tr("Повідомлення","Message"),"",InputType.TYPE_CLASS_TEXT);action(c,tr("Надіслати","Send"),true,()->send(()->api.insert("chat_messages",new JSONObject().put("sender_id",myId()).put("body",message.getText().toString()))));}
    private void sosPage(){title("SOS · "+tr("Допомога","Help"));if(activeDriver())action(body,tr("+ Попросити допомогу","+ Request help"),true,this::createSos);JSONArray a=arr("sos_requests");for(int i=0;i<a.length();i++){JSONObject s=a.optJSONObject(i);if(s==null)continue;LinearLayout c=card();add(c,label(s.optString("category")+" · "+s.optString("status"),16,true,DARK));add(c,label(s.optString("note")+" · "+s.optString("location_text"),14,false,MUTED));if(activeDriver()&&"open".equals(s.optString("status"))&&!myId().equals(s.optString("requester_id")))action(c,tr("Допоможу","I can help"),true,()->sosPatch(s.optString("id"),"claimed",myId()));
            if(activeDriver()&&"claimed".equals(s.optString("status"))&&myId().equals(s.optString("helper_id")))action(c,tr("Допомога надана","Resolved"),true,()->sosPatch(s.optString("id"),"resolved",myId()));}
    }
    private void createSos(){String[] category={"jump_start","tow","wheel","other"};new AlertDialog.Builder(this).setTitle(tr("Тип допомоги","Help type")).setItems(category,(d,which)->{LinearLayout lay=column();lay.setPadding(dp(16),0,dp(16),0);EditText location=field(lay,tr("Локація/орієнтир","Location"),"",InputType.TYPE_CLASS_TEXT);EditText note=field(lay,tr("Що сталося","Details"),"",InputType.TYPE_CLASS_TEXT);new AlertDialog.Builder(this).setTitle("SOS").setView(lay).setNegativeButton(tr("Скасувати","Cancel"),null).setPositiveButton(tr("Відправити","Send"),(dlg,w)->send(()->api.insert("sos_requests",new JSONObject().put("requester_id",myId()).put("category",category[which]).put("location_text",location.getText().toString()).put("note",note.getText().toString())))).show();}).show();}
    private void sosPatch(String id,String status,String helper){confirm(tr("Оновити SOS?","Update SOS?"),()->send(()->{JSONObject b=new JSONObject().put("status",status).put("helper_id",helper);if("resolved".equals(status))b.put("resolved_at",new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.US){{setTimeZone(TimeZone.getTimeZone("UTC"));}}.format(new Date()));api.patch("sos_requests","id=eq."+id,b);}));}
    private void announcementsPage(){title(tr("Оголошення","Announcements"));if(isOwner())action(body,tr("+ Оголошення","+ Announcement"),true,this::newAnnouncement);
        JSONArray a=arr("announcements");for(int i=a.length()-1;i>=0;i--){JSONObject news=a.optJSONObject(i);if(news==null)continue;LinearLayout c=card();add(c,label(news.optString(english?"title_en":"title_uk"),18,true,DARK));add(c,label(news.optString(english?"body_en":"body_uk"),15,false,DARK));}}
    private void newAnnouncement(){LinearLayout lay=column();lay.setPadding(dp(16),0,dp(16),0);EditText ua=field(lay,"Заголовок UA","",InputType.TYPE_CLASS_TEXT);EditText en=field(lay,"Title EN","",InputType.TYPE_CLASS_TEXT);EditText textUA=field(lay,"Текст UA","",InputType.TYPE_CLASS_TEXT);EditText textEN=field(lay,"Text EN","",InputType.TYPE_CLASS_TEXT);new AlertDialog.Builder(this).setTitle(tr("Оголошення","Announcement")).setView(lay).setNegativeButton(tr("Скасувати","Cancel"),null).setPositiveButton(tr("Опублікувати","Post"),(d,w)->send(()->api.insert("announcements",new JSONObject().put("author_id",myId()).put("title_uk",ua.getText().toString()).put("title_en",en.getText().toString()).put("body_uk",textUA.getText().toString()).put("body_en",textEN.getText().toString())))).show();}
    private void profilePage(){title(tr("Мій профіль","My profile"));LinearLayout c=card();add(c,label(profile.optString("full_name"),18,true,DARK));add(c,label(tr("Роль: ","Role: ")+role+" · "+access,15,false,TEAL));EditText name=field(c,tr("ПІБ","Full name"),profile.optString("full_name"),InputType.TYPE_CLASS_TEXT);EditText phone=field(c,tr("Телефон","Phone"),profile.optString("phone"),InputType.TYPE_CLASS_PHONE);action(c,tr("Зберегти","Save"),true,()->send(()->api.patch("profiles","id=eq."+myId(),new JSONObject().put("full_name",name.getText().toString()).put("phone",phone.getText().toString()))));
        action(c,tr("Вийти з акаунта","Sign out"),false,()->confirm(tr("Вийти?","Sign out?"),()->{api.clear();data.clear();profile=new JSONObject();role="";page="cars";render();}));info(tr("Усі дані завантажуються напряму із Supabase. Немає WebView або вбудованого браузера.","All data is loaded from Supabase. No browser/WebView is embedded."));}
}