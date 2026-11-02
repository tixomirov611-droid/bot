"""NikCar Taxi provisional Telegram webhook bot.

This is a new minimal implementation, not the missing January archive.
No Telegram webhook is changed automatically: existing bot stays untouched
until an explicit, separately verified cutover.
"""
import os
import json
import hmac
import math
import secrets
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import urllib.request
import urllib.error
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
# Ephemeral state: use persistent database before production use.
states = {}
DATABASE_URL = os.getenv("DATABASE_URL", "")
DISPATCH = os.getenv("DISPATCH_CHAT_ID", "")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
TZ = ZoneInfo("Europe/Kyiv")
def connect():
    if not DATABASE_URL: raise RuntimeError("DATABASE_URL missing")
    import psycopg
    return psycopg.connect(DATABASE_URL)
def distance(a,b):
    x1,x2=math.radians(a["latitude"]),math.radians(b["latitude"])
    dx=x2-x1;dy=math.radians(b["longitude"]-a["longitude"])
    return 12742*math.asin(min(1,math.sqrt(math.sin(dx/2)**2+math.cos(x1)*math.cos(x2)*math.sin(dy/2)**2)))
def make_order(uid,username,st):
    km=distance(st["origin"],st["destination"])
    now=datetime.now(TZ)
    night=(now+timedelta(minutes=st.get("delay",0))).hour<5
    with connect() as conn:
        with conn.cursor() as q:
            q.execute("SELECT key,value FROM nikcar_taxi.settings WHERE key=ANY(%s)",(["night_base","night_per_km","day_base","day_per_km","day_included_km"],))
            t=dict(q.fetchall())
            price=(float(t["night_base"])+float(t["night_per_km"])*km if night else float(t["day_base"])+float(t["day_per_km"])*max(0,km-float(t["day_included_km"])))
            oid=secrets.token_hex(6)
            q.execute("""INSERT INTO nikcar_taxi.orders(id,type,status,client_id,client_username,client_phone,scheduled_at,base_price,km,passengers,origin,destination,meta)
            VALUES(%s,'taxi','new',%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb)""",(oid,uid,username,st["phone"],now+timedelta(minutes=st.get("delay",0)),round(price,2),round(km,2),st["passengers"],json.dumps(st["origin"]),json.dumps(st["destination"]),json.dumps({"estimate":"straight_line","night":night})))
            q.execute("INSERT INTO nikcar_taxi.users(user_id,username,lang,phone) VALUES(%s,%s,%s,%s) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,updated_at=now()",(uid,username,st["lang"].upper(),st["phone"]))
        conn.commit()
    return oid,km,price
def dispatch_order(oid,st,km,price):
    a,b=st["origin"],st["destination"]
    payload={"chat_id":int(DISPATCH),"text":f"🚕 NikCar #{oid}\\nТелефон: {st['phone']}\\nПассажиров: {st['passengers']}\\nРасстояние по прямой: {km:.1f} км\\nОриентир: {price:.0f} грн\\nПосадка: https://maps.google.com/?q={a['latitude']},{a['longitude']}\\nНазначение: https://maps.google.com/?q={b['latitude']},{b['longitude']}","reply_markup":{"inline_keyboard":[[{"text":"🚕 Принять","callback_data":"accept:"+oid}]]}}
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
def send(cid, text, kb=None):
    p={"chat_id":cid,"text":text}
    if kb: p["reply_markup"]=kb
    return api("sendMessage",p)
@app.get("/")
def home():
    return jsonify(service="NikCar Taxi", mode="staging", telegram_connected=False)
@app.get("/health")
def health():
    return jsonify(status="ok", token_configured=bool(TOKEN), database_configured=bool(DATABASE_URL), dispatch_configured=bool(DISPATCH), webhook_secret_configured=bool(WEBHOOK_SECRET))
@app.post("/telegram/webhook")
def webhook():
    if not TOKEN or not WEBHOOK_SECRET: return jsonify(ok=False),503
    if not hmac.compare_digest(request.headers.get("X-Telegram-Bot-Api-Secret-Token",""),WEBHOOK_SECRET):return jsonify(ok=False),403
    payload=request.get_json(silent=True) or {}
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
    st=states.setdefault(uid,{"step":"lang","lang":"uk"})
    if text=="/start":
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
            send(cid,"NikCar Taxi",keyboard([STRINGS[st["lang"]][2]]))
    elif st["step"]=="menu":
        st["step"]="origin"
        send(cid,STRINGS[st["lang"]][3],{"keyboard":[[{"text":"📍 Location","request_location":True}]],"resize_keyboard":True})
    elif st["step"] in ("origin","destination"):
        if not msg.get("location"):
            send(cid,STRINGS[st["lang"]][3 if st["step"]=="origin" else 4])
        elif st["step"]=="origin":
            st.update(origin=msg["location"],step="destination")
            send(cid,STRINGS[st["lang"]][4])
        else:
            st.update(destination=msg["location"],step="passengers")
            send(cid,STRINGS[st["lang"]][5],keyboard(["1","2","3","4"]))
    elif st["step"]=="passengers":
        if text not in ("1","2","3","4"):
            send(cid,STRINGS[st["lang"]][5])
        else:
            st.update(passengers=int(text),step="schedule")
            s=STRINGS[st["lang"]]
            send(cid,s[6],keyboard([s[7],s[8],s[9]]))
    elif st["step"]=="schedule":
        s=STRINGS[st["lang"]]
        if text not in (s[7],s[8],s[9]):
            send(cid,s[6])
        else:
            # No dispatch or DB persistence yet; do not falsely confirm a real booking.
            st["delay"]=0 if text==s[7] else 15 if text==s[8] else 30
            if not DATABASE_URL or not DISPATCH:
                send(cid,"Оформление заказов временно недоступно: сервер подключается к диспетчерской. Попробуйте позже.")
                return jsonify(ok=True)
            try:
                oid,km,price=make_order(uid,msg["from"].get("username"),st)
                result=dispatch_order(oid,st,km,price)
                if not result.get("ok"):
                    send(cid,"Заказ сохранён, но отправка диспетчеру не удалась. Позвоните диспетчеру.")
                else:
                    send(cid,f"Заказ #{oid} передан диспетчеру. Ориентир: {price:.0f} грн (расстояние по прямой).",keyboard([s[2]]))
                st.update(step="menu")
            except Exception:
                app.logger.exception("Order failed")
                send(cid,"Не удалось оформить заказ. Повторите позже.")
    return jsonify(ok=True)
