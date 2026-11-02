from flask import Flask, jsonify
app = Flask(__name__)
@app.get("/")
def home():
    return jsonify(service="NikCar Taxi", mode="staging", telegram_connected=False, message="Awaiting original archive; existing bot remains untouched.")
@app.get("/health")
def health():
    return jsonify(status="ok", mode="staging")
