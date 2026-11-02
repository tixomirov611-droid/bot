"""NikCar Taxi provisional Telegram webhook bot.

This is a new minimal implementation, not the missing January archive.
No Telegram webhook is changed automatically: existing bot stays untouched
until an explicit, separately verified cutover.
"""
import os
import json
import hmac
import hashlib
import threading
import time
import math
import secrets
import sqlite3
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import urllib.request
import urllib.error
import urllib.parse
from flask import Flask, request, jsonify

app = Flask(__name__)
TOKEN = os.environ.get("BOT_TOKEN", "")
API = "https://api.telegram.org/bot" + TOKEN + "/"
LANGS = {"Українська": "uk", "Русский": "ru", "English": "en"}
STRINGS = {
 "uk": ("Вітаємо в NikCar Taxi! Надішліть номер телефону для реєстрації.", "Поділитися номером", "Замовити таксі", "Надішліть геолокацію місця посадки.", "Тепер надішліть геолокацію пункту призначення.", "Скільки пасажирів? (1–4)", "Коли подати авто?", "Зараз", "Через 15 хв", "Через 30 хв", "Замовлення прийнято. Очікуйте підтвердження диспетчера."),
 "ru": ("Добро пожаловать в NikCar Taxi! Отправьте телефон для регистрации.", "Поделиться номером", "Заказать такси", "Отправьте геолокацию места посадки.", "Теперь отправьте геолокацию пункта назначения.", "Сколько пассажиров? (1–4)", "Когда подать машину?", "Сейчас", "Через 15 мин", "Через 30 мин", "Заявка принята. Ожидайте подтверждения диспетчера."),
 "en": ("Welcome to NikCar Taxi! Share your phone to register.", "Share phone", "Order taxi", "Send pickup location.", "Now send destination location.", "How many passengers? (1–4)", "When do you need pickup?", "Now", "In 15 min", "In 30 min", "Request received. Await dispatcher confirmation.")
}

MENU = {
 "uk": ["🚕 Замовити таксі","🛣 Міжмісто","📦 Доставка","👨‍✈️ Драйвер","🪝 Буксировка","🔋 Прикурити авто","🚕 Робота в таксі (оренда авто)","ℹ️ Як користуватися","💰 Тарифи","👤 Профіль","📋 Мої поїздки","🆘 Підтримка"],
 "ru": ["🚕 Заказать такси","🛣 Межгород","📦 Доставка","👨‍✈️ Драйвер","🪝 Буксировка","🔋 Прикурить авто","🚕 Работа в такси (аренда авто)","ℹ️ Как пользоваться","💰 Тарифы","👤 Профиль","📋 Мои поездки","🆘 Поддержка"],
 "en": ["🚕 Order taxi","🛣 Intercity","📦 Delivery","👨‍✈️ Driver","🪝 Towing","🔋 Jump start","🚕 Taxi jobs (car rental)","ℹ️ How to use","💰 Fares","👤 Profile","📋 My trips","🆘 Support"]
}
BACK = {"uk":"⬅️ Головне меню","ru":"⬅️ Главное меню","en":"⬅️ Main menu"}
UNAVAILABLE = {
 "uk":"Цей розділ поки не підключено до диспетчерської. Заявка не створена.",
 "ru":"Этот раздел пока не подключён к диспетчерской. Заявка не создана.",
 "en":"This section is not yet connected to dispatch. No request was created."
}
def main_keyboard(lang):
    items=MENU.get(lang,MENU["uk"])
    return {"keyboard":[[{"text":items[0]},{"text":items[1]}],[{"text":items[2]},{"text":items[3]}],[{"text":items[4]},{"text":items[5]}],[{"text":items[6]}],[{"text":items[7]},{"text":items[8]}],[{"text":items[9]},{"text":items[10]}],[{"text":items[11]}]],"resize_keyboard":True}
def show_menu(cid,st):
    st["step"]="menu"
    st.pop("submitting",None)
    lang=st.get("lang","uk")
    heading={"uk":"🚕 Головне меню NikCar Taxi","ru":"🚕 Главное меню NikCar Taxi","en":"🚕 NikCar Taxi main menu"}.get(lang,"🚕 NikCar Taxi")
    notice={"uk":"⚠️ Увага! Бот може переходити в режим сну. Іноді відповідь на команду може тривати до 30 секунд. Будь ласка, зачекайте й не надсилайте команду повторно.","ru":"⚠️ Внимание! Бот может переходить в спящий режим. Иногда ожидание ответа на команду может достигать 30 секунд. Пожалуйста, подождите и не отправляйте команду повторно.","en":"⚠️ Notice: The bot may go to sleep. Occasionally, a command response may take up to 30 seconds. Please wait and avoid sending the command again."}.get(lang,"")
    send(cid,heading+"\n\n"+notice,main_keyboard(lang))

# Session state is transient; registrations are stored separately.
states = {}
REGISTRY_PATH = os.getenv("REGISTRY_PATH", "/tmp/nikcar_registrations.sqlite3")
def registration_db():
    conn=sqlite3.connect(REGISTRY_PATH, timeout=5)
    conn.execute("CREATE TABLE IF NOT EXISTS registrations (user_id INTEGER PRIMARY KEY, lang TEXT NOT NULL, phone TEXT NOT NULL)")
    return conn
def load_registration(uid):
    try:
        with registration_db() as conn:
            row=conn.execute("SELECT lang,phone FROM registrations WHERE user_id=?",(uid,)).fetchone()
        return {"lang":row[0],"phone":row[1]} if row else None
    except Exception:
        app.logger.exception("Registration lookup failed")
        return None
def save_registration(uid,lang,phone):
    try:
        with registration_db() as conn:
            conn.execute("INSERT INTO registrations(user_id,lang,phone) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET lang=excluded.lang,phone=excluded.phone",(uid,lang,phone))
        return True
    except Exception:
        app.logger.exception("Registration save failed")
        return False

DATABASE_URL = os.getenv("DATABASE_URL", "")
DISPATCH = os.getenv("DISPATCH_CHAT_ID", "")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET") or (hashlib.sha256(("nikcar-webhook-v1:"+TOKEN).encode()).hexdigest() if TOKEN else "")
TZ = ZoneInfo("Europe/Kyiv")
def connect():
    if not DATABASE_URL: raise RuntimeError("DATABASE_URL missing")
    import psycopg
    return psycopg.connect(DATABASE_URL)
def distance(a,b):
    x1,x2=math.radians(a["latitude"]),math.radians(b["latitude"])
    dx=x2-x1;dy=math.radians(b["longitude"]-a["longitude"])
    return 12742*math.asin(min(1,math.sqrt(math.sin(dx/2)**2+math.cos(x1)*math.cos(x2)*math.sin(dy/2)**2)))
_geo_lock=threading.Lock()
_geo_last=0.0
_geo_cache={}
def geocode_point(p):
    global _geo_last
    if "latitude" in p and "longitude" in p:
        return float(p["latitude"]),float(p["longitude"])
    address=(p.get("address") or "").strip()
    if not address: return None
    if not any(x in address.lower() for x in ("николаев","миколаїв","mykolaiv","украина","україна","ukraine")):
        address+=", Миколаїв, Україна"
    if address in _geo_cache: return _geo_cache[address]
    params=urllib.parse.urlencode({"q":address,"format":"json","limit":1,"countrycodes":"ua"})
    try:
        with _geo_lock:
            delay=max(0,1.1-(time.monotonic()-_geo_last))
            if delay: time.sleep(delay)
            _geo_last=time.monotonic()
            req=urllib.request.Request("https://nominatim.openstreetmap.org/search?"+params,headers={"User-Agent":"NikCarTaxi/1.0","Accept":"application/json"})
            with urllib.request.urlopen(req,timeout=7) as resp: data=json.load(resp)
        if not data: return None
        result=float(data[0]["lat"]),float(data[0]["lon"])
        _geo_cache[address]=result
        return result
    except Exception:
        app.logger.exception("Address geocoding failed")
        return None
def route_estimate(st):
    a=geocode_point(st["origin"])
    b=geocode_point(st["destination"])
    if not a or not b: return None
    coords=f"{a[1]},{a[0]};{b[1]},{b[0]}"
    url="https://router.project-osrm.org/route/v1/driving/"+coords+"?overview=false"
    try:
        req=urllib.request.Request(url,headers={"User-Agent":"NikCarTaxi/1.0"})
        with urllib.request.urlopen(req,timeout=8) as resp: data=json.load(resp)
        if data.get("code")!="Ok" or not data.get("routes"): return None
        return round(data["routes"][0]["distance"]/1000,2)
    except Exception:
        app.logger.exception("OSRM routing failed")
        return None
def fare_estimate(km,delay=0):
    if km is None: return None
    hour=(datetime.now(TZ)+timedelta(minutes=delay)).hour
    if 0<=hour<5: return round(300+90*km)
    return round(75+25*max(0,km-1.5))
def make_order(uid,username,st):
    km=st.get("route_km") or distance(st["origin"],st["destination"])
    now=datetime.now(TZ)
    night=(now+timedelta(minutes=st.get("delay",0))).hour<5
    with connect() as conn:
        with conn.cursor() as q:
            q.execute("SELECT key,value FROM nikcar_taxi.settings WHERE key=ANY(%s)",(["night_base","night_per_km","day_base","day_per_km","day_included_km"],))
            t=dict(q.fetchall())
            price=(float(t["night_base"])+float(t["night_per_km"])*km if night else float(t["day_base"])+float(t["day_per_km"])*max(0,km-float(t["day_included_km"])))
            oid=secrets.token_hex(6)
            q.execute("""INSERT INTO nikcar_taxi.orders(id,type,status,client_id,client_username,client_phone,scheduled_at,base_price,km,passengers,origin,destination,meta)
            VALUES(%s,'taxi','new',%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb)""",(oid,uid,username,st["phone"],now+timedelta(minutes=st.get("delay",0)),round(price,2),round(km,2),st["passengers"],json.dumps(st["origin"]),json.dumps(st["destination"]),json.dumps({"estimate":"osrm_driving_route" if st.get("route_km") else "straight_line","night":night,"car_class":st.get("car_class","Standard"),"payment":st.get("payment","Наличные")})))
            q.execute("INSERT INTO nikcar_taxi.users(user_id,username,lang,phone) VALUES(%s,%s,%s,%s) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,updated_at=now()",(uid,username,st["lang"].upper(),st["phone"]))
        conn.commit()
    return oid,km,price
def location_label(p):
    if p.get("address"): return p["address"]
    return f"https://maps.google.com/?q={p['latitude']},{p['longitude']}"

def dispatch_message(oid,st,km=None,price=None):
    now=datetime.now(TZ)
    delay=st.get("delay",0)
    pickup=now+timedelta(minutes=delay)
    hour=pickup.hour
    tariff="ТАКСИ НОЧЬ" if 0<=hour<5 else "ТАКСИ ДЕНЬ"
    payment="КАРТА (согласовать)" if st.get("payment")=="card" else "НАЛИЧНЫЕ"
    lines=[
        f"🚕 Заказ {oid}    ⏱ {now:%H:%M}",
        "🧾 Тип: taxi",
        f"🕒 Подача: {pickup:%d.%m %H:%M}",
        f"👥 Пассажиры: {st.get('passengers',1)}",
        f"📏 Дистанция: {km:.1f} км" if km is not None else "📏 Дистанция: уточняется",
        f"💰 Ориентировочная цена: {price:.0f} грн" if price is not None else "💰 Цена: уточняется",
        f"📌 Тариф: {tariff}",
        f"🚘 Класс: {st.get('car_class','Standard')}",
        f"💳 Оплата: {payment}",
        f"📱 Телефон: {st.get('phone','—')}",
        "",
        f"📍 Откуда: {location_label(st['origin'])}",
        f"🏁 Куда: {location_label(st['destination'])}"
    ]
    origin=geocode_point(st["origin"])
    destination=geocode_point(st["destination"])
    if origin:
        pickup=f"{origin[0]},{origin[1]}"
        lines.append("📍 Подача (Google Maps): https://www.google.com/maps/search/?"+urllib.parse.urlencode({"api":1,"query":pickup}))
        lines.append("🚗 Waze — ехать к клиенту: https://waze.com/ul?"+urllib.parse.urlencode({"ll":pickup,"navigate":"yes"}))
    if origin and destination:
        route_url="https://www.google.com/maps/dir/?"+urllib.parse.urlencode({"api":1,"origin":f"{origin[0]},{origin[1]}","destination":f"{destination[0]},{destination[1]}","travelmode":"driving"})
        lines.append("🗺 Маршрут Google Maps: "+route_url)
    return "\n".join(lines)

def dispatch_direct(uid,username,st):
    if not DISPATCH: return {"ok":False,"description":"DISPATCH_CHAT_ID missing"},None
    oid="T"+secrets.token_hex(4).upper()
    message=dispatch_message(oid,st,st.get("route_km"),st.get("route_price"))
    result=api("sendMessage",{"chat_id":int(DISPATCH),"text":message,"disable_web_page_preview":True})
    if not result.get("ok"):
        app.logger.error("Dispatch delivery failed: %s",result.get("description","unknown Telegram error"))
    return result,oid


def dispatch_order(oid,st,km,price):
    payload={"chat_id":int(DISPATCH),"text":dispatch_message(oid,st,st.get("route_km") or km,st.get("route_price") or price),"disable_web_page_preview":True,"reply_markup":{"inline_keyboard":[[{"text":"🚕 Принять","callback_data":"accept:"+oid}]]}}
    result=api("sendMessage",payload)
    if result.get("ok"):
        with connect() as conn:
            with conn.cursor() as q:
                q.execute("UPDATE nikcar_taxi.orders SET dispatch_message_id=%s WHERE id=%s",(result["result"]["message_id"],oid))
            conn.commit()
    return result
def driver_callback(c):
    data=c.get("data","");uid=c["from"]["id"];cid=c["message"]["chat"]["id"]
    if cid!=int(DISPATCH or "0") or ":" not in data: return "Недоступно"
    action,oid=data.split(":",1)
    with connect() as conn:
        with conn.cursor() as q:
            q.execute("SELECT approved,phone,car_model,car_plate FROM nikcar_taxi.drivers WHERE user_id=%s",(uid,))
            driver=q.fetchone()
            if not driver or not driver[0]:return "Водитель не подтверждён"
            q.execute("SELECT status,client_id,driver_id,base_price,on_site_at,wait_fee,meta FROM nikcar_taxi.orders WHERE id=%s FOR UPDATE",(oid,))
            o=q.fetchone()
            if not o:return "Заказ не найден"
            status,client_id,assigned,base,on_site,wait_fee,meta=o
            if action=="accept" and status=="new":
                q.execute("SELECT count(*) FROM nikcar_taxi.orders WHERE driver_id=%s AND status IN ('accepted','onsite','on_route')",(uid,))
                if q.fetchone()[0]:return "У вас уже есть активный заказ"
                q.execute("UPDATE nikcar_taxi.orders SET status='accepted',driver_id=%s,accepted_at=now() WHERE id=%s",(uid,oid))
                next_action="onsite";message=f"Водитель принял заказ #{oid}. Телефон: {driver[1] or '-'}, авто: {driver[2] or '-'}, номер: {driver[3] or '-'}"
            elif assigned==uid and action=="onsite" and status=="accepted":
                q.execute("UPDATE nikcar_taxi.orders SET status='onsite',on_site_at=now() WHERE id=%s",(oid,))
                next_action="route";message="Водитель на месте. Первые 5 минут бесплатно."
            elif assigned==uid and action=="route" and status=="onsite":
                q.execute("SELECT EXTRACT(EPOCH FROM(now()-on_site_at))/60 FROM nikcar_taxi.orders WHERE id=%s",(oid,))
                minutes=math.ceil(float(q.fetchone()[0]));fee=max(0,minutes-5)*(10 if meta.get("night") else 5)
                q.execute("UPDATE nikcar_taxi.orders SET status='on_route',on_route_at=now(),wait_minutes=%s,wait_fee=%s WHERE id=%s",(minutes,fee,oid))
                next_action="done";message=f"Поездка началась. Ожидание {minutes} мин, доплата {fee} грн."
            elif assigned==uid and action=="done" and status=="on_route":
                q.execute("UPDATE nikcar_taxi.orders SET status='done',done_at=now() WHERE id=%s",(oid,))
                next_action=None;message=f"Поездка завершена. Итого {float(base)+float(wait_fee or 0):.0f} грн."
            else:return "Действие уже выполнено или заказ другого водителя"
        conn.commit()
    send(client_id,message)
    buttons={"onsite":"📍 На месте","route":"▶️ В пути","done":"🏁 Завершить"}
    if next_action:api("sendMessage",{"chat_id":cid,"text":f"Заказ #{oid}: {message}","reply_markup":{"inline_keyboard":[[{"text":buttons[next_action],"callback_data":next_action+":"+oid}]]}})
    return "Готово"
def api(method, payload):
    if not TOKEN: return {"ok": False, "description": "BOT_TOKEN missing"}
    data = json.dumps(payload).encode()
    req = urllib.request.Request(API + method, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.load(resp)
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        app.logger.warning("Telegram request failed: %s", type(e).__name__)
        return {"ok": False}
def keyboard(items, request_contact=False):
    return {"keyboard": [[{"text": items[0], **({"request_contact": True} if request_contact else {})}]] if request_contact else [[{"text": x} for x in items]], "resize_keyboard": True}
def step_keyboard(lang, choices=None, location=False):
    rows=[]
    if location:
        label={"uk":"📍 Надіслати геолокацію","ru":"📍 Отправить геолокацию","en":"📍 Send location"}.get(lang,"📍 Location")
        rows.append([{"text":label,"request_location":True}])
    elif choices:
        rows.extend([[{"text":v} for v in choices[i:i+2]] for i in range(0,len(choices),2)])
    rows.append([{"text":BACK.get(lang,BACK["uk"])}])
    return {"keyboard":rows,"resize_keyboard":True}

def send(cid, text, kb=None):
    p={"chat_id":cid,"text":text}
    if kb: p["reply_markup"]=kb
    result = api("sendMessage",p)
    if not result.get("ok"): app.logger.error("Telegram sendMessage failed: %s", result.get("description", "no description"))
    return result
@app.get("/")
def home():
    return jsonify(service="NikCar Taxi", mode="staging", telegram_connected=False)
@app.get("/health")
def health():
    return jsonify(status="ok", token_configured=bool(TOKEN), database_configured=bool(DATABASE_URL), dispatch_configured=bool(DISPATCH), webhook_secret_configured=bool(WEBHOOK_SECRET))
@app.post("/telegram/webhook")
def webhook():
    if not TOKEN or not WEBHOOK_SECRET: return jsonify(ok=False),503
    if not hmac.compare_digest(request.headers.get("X-Telegram-Bot-Api-Secret-Token",""),WEBHOOK_SECRET):
        app.logger.error("Webhook rejected: secret mismatch")
        return jsonify(ok=False),403
    payload=request.get_json(silent=True) or {}
    app.logger.warning("Webhook update received: id=%s, kind=%s", payload.get("update_id"), "callback" if payload.get("callback_query") else "message")
    if payload.get("callback_query"):
        c=payload["callback_query"]
        try:answer=driver_callback(c)
        except Exception:
            app.logger.exception("Driver callback failed");return jsonify(ok=False),503
        api("answerCallbackQuery",{"callback_query_id":c["id"],"text":answer});return jsonify(ok=True)
    msg=(request.get_json(silent=True) or {}).get("message") or {}
    cid=(msg.get("chat") or {}).get("id")
    if not cid: return jsonify(ok=True)
    text=(msg.get("text") or "").strip()
    uid=(msg.get("from") or {}).get("id")
    if not uid or (msg.get("chat") or {}).get("type")!="private": return jsonify(ok=True)
    if uid not in states:
        reg=load_registration(uid)
        states[uid]={"step":"menu","lang":reg["lang"],"phone":reg["phone"]} if reg else {"step":"lang","lang":"uk"}
    st=states[uid]
    if text in ("/menu","/cancel","❌ Отмена / Скасувати") and st.get("step") not in ("lang","phone"):
        show_menu(cid,st)
        return jsonify(ok=True)
    if text=="/start":
        reg=load_registration(uid)
        if reg or st.get("phone"):
            saved=reg or {"lang":st["lang"],"phone":st["phone"]}
            st.clear();st.update(step="menu",**saved)
            show_menu(cid,st)
        else:
            st.clear();st.update(step="lang",lang="uk")
            send(cid,"Вас вітає NikCar Taxi / Welcome to NikCar Taxi. Оберіть мову / Choose language",keyboard(list(LANGS)))
        return jsonify(ok=True)
    if st["step"]=="lang":
        if text not in LANGS:
            send(cid,"Оберіть мову / Choose language",keyboard(list(LANGS)))
        else:
            st.update(step="phone",lang=LANGS[text])
            s=STRINGS[st["lang"]]
            send(cid,s[0],keyboard([s[1]],True))
    elif st["step"]=="phone":
        contact=msg.get("contact") or {}
        if not contact.get("phone_number") or contact.get("user_id")!=uid:
            send(cid,STRINGS[st["lang"]][0])
        else:
            st.update(step="menu",phone=contact["phone_number"])
            save_registration(uid,st["lang"],st["phone"])
            show_menu(cid,st)
    elif text in (BACK.get(st.get("lang","uk")), "/menu", "/cancel") and st.get("step") not in ("lang","phone"):
        show_menu(cid,st)
    elif st["step"]=="menu":
        lang=st.get("lang","uk")
        options=MENU.get(lang,MENU["uk"])
        if text==options[0]:
            st["step"]="origin"
            send(cid,STRINGS[lang][3]+"\n\n📍 Выберите точку на карте через кнопку ниже ИЛИ напишите адрес текстом (например: Николаев, Соборная 12).",step_keyboard(lang,location=True))
        elif text==options[7]:
            send(cid,{"uk":"Оберіть послугу в головному меню. Для замовлення таксі надішліть місце посадки, пункт призначення, кількість пасажирів і час подачі.","ru":"Выберите услугу в главном меню. Для заказа такси укажите место посадки, пункт назначения, число пассажиров и время подачи.","en":"Choose a service. For a taxi, send pickup and destination locations, passenger count and pickup time."}[lang],main_keyboard(lang))
        elif text==options[8]:
            send(cid,{"uk":"💰 День: 75 грн (1,5 км), далі 25 грн/км. Ніч 00:00–05:00: 300 грн + 90 грн/км. Очікування: 5 хв безкоштовно, потім 5/10 грн за хвилину. Ціна орієнтовна.","ru":"💰 День: 75 грн (1,5 км), далее 25 грн/км. Ночь 00:00–05:00: 300 грн + 90 грн/км. Ожидание: 5 минут бесплатно, затем 5/10 грн за минуту. Цена ориентировочная.","en":"💰 Day: 75 UAH (1.5 km), then 25 UAH/km. Night 00:00–05:00: 300 UAH + 90 UAH/km. First 5 waiting minutes free; then 5/10 UAH/min. Indicative fares."}[lang],main_keyboard(lang))
        elif text==options[9]:
            send(cid,{"uk":"👤 Профіль","ru":"👤 Профиль","en":"👤 Profile"}[lang]+"\\n"+(st.get("phone") or "—"),main_keyboard(lang))
        elif text==options[10]:
            if not DATABASE_URL:
                send(cid,{"uk":"📋 Історія поїздок буде доступна після підключення бази.","ru":"📋 История поездок будет доступна после подключения базы.","en":"📋 Trip history will be available once the database is connected."}[lang],main_keyboard(lang))
            else:
                try:
                    with connect() as conn:
                        with conn.cursor() as q:
                            q.execute("SELECT id,status,base_price,created_at FROM nikcar_taxi.orders WHERE client_id=%s ORDER BY created_at DESC LIMIT 5",(uid,))
                            orders=q.fetchall()
                    lines=[f"#{oid} — {status} — {price} грн — {created:%d.%m %H:%M}" for oid,status,price,created in orders]
                    send(cid,"📋 "+("\\n".join(lines) if lines else "Заказов пока нет / Замовлень поки немає"),main_keyboard(lang))
                except Exception:
                    app.logger.exception("Trip history failed")
                    send(cid,"История временно недоступна / Історія тимчасово недоступна",main_keyboard(lang))
        elif text==options[11]:
            send(cid,{"uk":"🆘 Звернення до підтримки поки не підключені.","ru":"🆘 Обращения в поддержку пока не подключены.","en":"🆘 Support requests are not yet connected."}[lang],main_keyboard(lang))
        elif text in options:
            st["step"]="section"
            send(cid,options[options.index(text)]+"\n\n"+UNAVAILABLE[lang],keyboard([BACK[lang]]))
        else:
            show_menu(cid,st)
    elif st["step"]=="section":
        show_menu(cid,st)
    elif st["step"] in ("origin","destination"):
        loc=msg.get("location")
        if not loc and text and not text.startswith("/") and len(text)>=5 and len(text)<=250:
            loc={"address":text}
        if not loc:
            send(cid,"📍 Выберите точку на карте или напишите адрес текстом (например: Николаев, Соборная 12).",step_keyboard(st["lang"],location=True))
        elif st["step"]=="origin":
            st.update(origin=loc,step="destination")
            send(cid,STRINGS[st["lang"]][4]+"\n\n📍 Выберите точку на карте ИЛИ напишите адрес назначения текстом.",step_keyboard(st["lang"],location=True))
        else:
            st.update(destination=loc,step="passengers")
            send(cid,STRINGS[st["lang"]][5],step_keyboard(st["lang"],["1","2","3","4"]))
    elif st["step"]=="passengers":
        if text not in ("1","2","3","4"):
            send(cid,STRINGS[st["lang"]][5])
        else:
            st.update(passengers=int(text),step="class")
            send(cid,"🚘 Выберите класс автомобиля / Оберіть клас авто",step_keyboard(st["lang"],["Standard","Comfort","Universal"]))
    elif st["step"]=="class":
        if text not in ("Standard","Comfort","Universal"):
            send(cid,"Выберите класс / Оберіть клас",step_keyboard(st["lang"],["Standard","Comfort","Universal"]))
        else:
            st.update(car_class=text,step="payment")
            send(cid,"💳 Выберите способ оплаты / Оберіть спосіб оплати. Карта — только по согласованию с диспетчером, онлайн-списания нет.",step_keyboard(st["lang"],["💵 Наличные","💳 Карта"]))
    elif st["step"]=="payment":
        choice=text.casefold()
        cash=choice in ("💵 наличные","💵 наличные / готівка","наличка","наличные","готівка","готівкою","cash","нал")
        card=choice in ("💳 карта","карта","картой","карткою","card")
        if not cash and not card:
            send(cid,"Выберите наличные или карту / Оберіть готівку або картку",step_keyboard(st["lang"],["💵 Наличные","💳 Карта"]))
        else:
            st.update(payment="card" if card else "cash",step="schedule")
            z=STRINGS[st["lang"]]
            send(cid,z[6],step_keyboard(st["lang"],[z[7],z[8],z[9]]))
    elif st["step"]=="schedule":
        z=STRINGS[st["lang"]]
        aliases={"сейчас":0,"зараз":0,"now":0,"через 15 мин":15,"через 15 хв":15,"через 30 мин":30,"через 30 хв":30}
        delay={z[7]:0,z[8]:15,z[9]:30}.get(text,aliases.get(text.casefold()))
        if delay is None:
            send(cid,z[6],keyboard([z[7],z[8],z[9]]))
        else:
            st.update(delay=delay,step="confirm")
            km=route_estimate(st)
            st["route_km"]=km
            st["route_price"]=fare_estimate(km,delay)
            a,b=st["origin"],st["destination"]
            lines=[
                "🚕 NikCar Taxi — подтверждение заказа",
                f"📍 Откуда: {location_label(a)}",
                f"🏁 Куда: {location_label(b)}",
                f"👥 Пассажиров: {st['passengers']}",
                f"🚘 Класс: {st.get('car_class','Standard')}",
                f"💳 Оплата: {'карта' if st.get('payment')=='card' else 'наличные'}",
                f"🕒 Подача: {'сейчас' if delay==0 else 'через '+str(delay)+' мин'}",
                f"🚗 Маршрут по дорогам: {km:.1f} км" if km is not None else "🚗 Расстояние: пока не рассчитано",
                f"💰 Ориентировочная стоимость: {st['route_price']} грн" if st["route_price"] is not None else "💰 Стоимость уточнит диспетчер",
                "Подтвердить заказ? / Підтвердити замовлення?"
            ]
            summary="\\n".join(lines)
            send(cid,summary,step_keyboard(st["lang"],["✅ Подтвердить / Підтвердити","❌ Отмена / Скасувати"]))
    elif st["step"]=="confirm":
        if text in ("❌ Отмена / Скасувати","Отмена","Скасувати"):
            show_menu(cid,st)
        elif text!="✅ Подтвердить / Підтвердити":
            send(cid,"Выберите подтверждение или отмену / Оберіть підтвердження або скасування",step_keyboard(st["lang"],["✅ Подтвердить / Підтвердити","❌ Отмена / Скасувати"]))
        elif st.get("submitting"):
            send(cid,"Заказ уже обрабатывается / Замовлення вже обробляється")
        elif not DISPATCH:
            send(cid,"⚠️ Диспетчерская группа не настроена. Заказ не создан / Диспетчерська група не налаштована.")
            show_menu(cid,st)
        elif not DATABASE_URL or any("latitude" not in p for p in (st["origin"],st["destination"])):
            st["submitting"]=True
            result,oid=dispatch_direct(uid,msg["from"].get("username"),st)
            if result.get("ok"):
                send(cid,f"✅ Заказ #{oid} отправлен диспетчеру. Ожидайте подтверждения / Замовлення надіслано диспетчеру. Очікуйте підтвердження.")
            else:
                send(cid,"❌ Не удалось отправить заказ диспетчеру. Заказ не принят / Не вдалося передати замовлення.")
            show_menu(cid,st)
        else:
            st["submitting"]=True
            try:
                oid,km,price=make_order(uid,msg["from"].get("username"),st)
                result=dispatch_order(oid,st,km,price)
                if not result.get("ok"):
                    send(cid,f"⚠️ Заказ #{oid} сохранён, но диспетчер не получил уведомление. Повторно не оформляйте заказ.")
                else:
                    send(cid,f"✅ Заказ #{oid} передан диспетчеру. Ориентир: {price:.0f} грн (по прямой).")
                show_menu(cid,st)
            except Exception:
                app.logger.exception("Order failed")
                send(cid,"Не удалось оформить заказ / Не вдалося оформити замовлення")
                show_menu(cid,st)
    return jsonify(ok=True)


# Register the Telegram webhook using the token stored only in Render environment.
def _register_webhook():
    if not TOKEN: 
        app.logger.error("BOT_TOKEN missing; cannot register Telegram webhook")
        return
    target = os.getenv("WEBHOOK_URL", "https://nikcar-taxi-staging.onrender.com/telegram/webhook")
    for attempt in range(4):
        try:
            result = api("setWebhook", {"url": target, "secret_token": WEBHOOK_SECRET, "allowed_updates": ["message", "callback_query"], "drop_pending_updates": False})
            if result.get("ok"):
                app.logger.warning("Telegram webhook registered successfully")
                info=api("getWebhookInfo", {})
                if info.get("ok"):
                    x=info.get("result",{})
                    app.logger.warning("Telegram webhook diagnostics: pending=%s last_error=%s",x.get("pending_update_count"),x.get("last_error_message"))
                return
            app.logger.error("Telegram setWebhook rejected: %s", result.get("description", "unknown"))
        except Exception:
            app.logger.exception("Telegram webhook registration failed")
        time.sleep(5 * (attempt + 1))

threading.Thread(target=_register_webhook, daemon=True).start()
