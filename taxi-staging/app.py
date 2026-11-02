"""NikCar Taxi provisional Telegram webhook bot.

This is a new minimal implementation, not the missing January archive.
No Telegram webhook is changed automatically: existing bot stays untouched
until an explicit, separately verified cutover.
"""
import os
import json
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
    return jsonify(service="NikCar Taxi", mode="ready_for_cutover", telegram_connected=False, note="Webhook not activated; existing bot untouched")
@app.get("/health")
def health():
    return jsonify(status="ok", token_configured=bool(TOKEN), webhook_activated=False)
@app.post("/telegram/webhook")
def webhook():
    if not TOKEN: return jsonify(ok=False),503
    msg=(request.get_json(silent=True) or {}).get("message") or {}
    cid=(msg.get("chat") or {}).get("id")
    if not cid: return jsonify(ok=True)
    text=(msg.get("text") or "").strip()
    uid=(msg.get("from") or {}).get("id")
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
            st.update(step="menu")
            send(cid,"⚠️ NikCar Taxi test mode: request flow checked, but dispatcher is not connected. No taxi has been booked.",keyboard([s[2]]))
    return jsonify(ok=True)
