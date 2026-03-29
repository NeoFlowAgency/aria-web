"""
neo-control — Serveur de contrôle VPS pour robot NEO
  • REST API compatible Next.js (Vercel)
  • WebSocket (SocketIO) pour dashboard local VPS
  • MQTT ↔ ESP32 (commandes, status)
  • Relay vers neo-bridge (speak, mode)

Variables d'environnement :
  NEO_API_KEY   — clé secrète partagée avec Vercel
  NEO_MQTT_HOST — IP du broker Mosquitto (défaut 127.0.0.1)
  NEO_MQTT_PORT — port broker (défaut 1883)
  OPENCLAW_WS   — WebSocket OpenClaw (défaut ws://127.0.0.1:18789)
"""

import json
import os
import threading
import time
import websocket
from collections import deque
from flask import Flask, jsonify, render_template, request, send_from_directory
from flask_socketio import SocketIO, emit
import paho.mqtt.client as mqtt

# ── Config ────────────────────────────────────────────────────
MQTT_HOST   = os.environ.get("NEO_MQTT_HOST", "127.0.0.1")
MQTT_PORT   = int(os.environ.get("NEO_MQTT_PORT", "1883"))
OPENCLAW_WS = os.environ.get("NEO_OPENCLAW_WS", "ws://127.0.0.1:18789")
NEO_API_KEY = os.environ.get("NEO_API_KEY", "")

TOPIC_CMD    = "neo/commandes"
TOPIC_STATUS = "neo/status"
TOPIC_STATE  = "neo/state"
TOPIC_SPEAK  = "neo/speak"

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "neo-secret-change-me")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# ── État robot (mis à jour par neo-bridge via neo/state) ─────
_state_lock    = threading.Lock()
_etat          = "repos"
_mode_continu  = False
_partial       = ""
_messages      = deque(maxlen=50)

# ── État connexions ────────────────────────────────────────────
mqtt_connected  = False
openclaw_ok     = False
esp32_last_seen = 0
servo_state     = {"pan": 90}
logs            = deque(maxlen=400)

# ── Auth ───────────────────────────────────────────────────────
def verify_neo_key(req) -> bool:
    if not NEO_API_KEY:
        return False
    key = (req.headers.get("X-NEO-Key")
           or req.headers.get("Authorization", "").replace("Bearer ", "").strip())
    return key == NEO_API_KEY

# ── Logging ───────────────────────────────────────────────────
def log(level: str, msg: str):
    entry = {"t": time.strftime("%H:%M:%S"), "l": level, "m": msg}
    logs.append(entry)
    try:
        socketio.emit("log_entry", entry)
    except Exception:
        pass
    print(f"[{level}] {msg}")

# ── MQTT ──────────────────────────────────────────────────────
mqtt_client = mqtt.Client()

def on_mqtt_connect(client, userdata, flags, rc):
    global mqtt_connected
    if rc == 0:
        mqtt_connected = True
        client.subscribe(TOPIC_STATUS)
        client.subscribe(TOPIC_STATE)
        log("OK", f"MQTT connecté ({MQTT_HOST}:{MQTT_PORT})")
        socketio.emit("conn_state", get_conn_state())
    else:
        log("ERR", f"MQTT échec rc={rc}")

def on_mqtt_disconnect(client, userdata, rc):
    global mqtt_connected
    mqtt_connected = False
    log("WARN", "MQTT déconnecté")
    socketio.emit("conn_state", get_conn_state())

def on_mqtt_message(client, userdata, msg):
    global esp32_last_seen, _etat, _mode_continu, _partial

    if msg.topic == TOPIC_STATUS:
        # Heartbeat / keypad events depuis ESP32
        try:
            payload = msg.payload.decode("utf-8")
            data = json.loads(payload)
            esp32_last_seen = time.time()
            socketio.emit("neo_status", data)
            log("INFO", f"ESP32 → {payload[:80]}")
        except Exception as e:
            log("ERR", f"MQTT status parse: {e}")

    elif msg.topic == TOPIC_STATE:
        # Mise à jour d'état depuis neo-bridge
        try:
            data = json.loads(msg.payload.decode("utf-8"))
            with _state_lock:
                if "etat"         in data: _etat         = data["etat"]
                if "mode_continu" in data: _mode_continu = data["mode_continu"]
                if "partial"      in data: _partial       = data["partial"]
                if "message"      in data:
                    _messages.append(data["message"])
            socketio.emit("robot_state", {
                "etat": _etat, "mode_continu": _mode_continu, "partial": _partial,
            })
        except Exception as e:
            log("ERR", f"MQTT state parse: {e}")

def mqtt_loop():
    mqtt_client.on_connect    = on_mqtt_connect
    mqtt_client.on_disconnect = on_mqtt_disconnect
    mqtt_client.on_message    = on_mqtt_message
    while True:
        try:
            mqtt_client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            mqtt_client.loop_forever()
        except Exception as e:
            log("ERR", f"MQTT loop: {e} — retry in 5s")
            time.sleep(5)

def send_command(action: str, **kwargs):
    if not mqtt_connected:
        log("WARN", f"MQTT non connecté — commande '{action}' ignorée")
        return False
    payload = {"action": action, **kwargs}
    mqtt_client.publish(TOPIC_CMD, json.dumps(payload))
    log("CMD", f"→ {action} {kwargs or ''}")
    return True

# ── OpenClaw (pour le chat SocketIO du dashboard) ─────────────
_oc_ws   = None
_oc_lock = threading.Lock()
_oc_id   = 0

def openclaw_send(message: str):
    global _oc_ws, _oc_id, openclaw_ok
    with _oc_lock:
        try:
            if _oc_ws is None or not _oc_ws.connected:
                _oc_ws = websocket.create_connection(OPENCLAW_WS, timeout=15)
            _oc_id += 1
            req = {
                "method": "agent.send_message",
                "params": {"agentId": "main", "message": message},
                "id": _oc_id,
            }
            _oc_ws.send(json.dumps(req))
            data = json.loads(_oc_ws.recv())
            openclaw_ok = True
            socketio.emit("conn_state", get_conn_state())
            return data.get("result", {}).get("output", "")
        except Exception as e:
            openclaw_ok = False
            _oc_ws = None
            log("ERR", f"OpenClaw: {e}")
            socketio.emit("conn_state", get_conn_state())
            return None

# ── Helpers ───────────────────────────────────────────────────
def get_conn_state():
    esp32_alive = (time.time() - esp32_last_seen) < 30 if esp32_last_seen else False
    return {"mqtt": mqtt_connected, "openclaw": openclaw_ok, "esp32": esp32_alive}

# ══════════════════════════════════════════════════════════════
# REST API — compatible avec Next.js / Vercel
# Toutes les routes nécessitent le header X-NEO-Key
# ══════════════════════════════════════════════════════════════

@app.route("/status")
def route_status():
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    esp32_alive = (time.time() - esp32_last_seen) < 30 if esp32_last_seen else False
    with _state_lock:
        return jsonify({
            "online":       esp32_alive,
            "etat":         _etat,
            "mode_continu": _mode_continu,
            "partial":      _partial,
            "messages":     list(_messages),
            "mqtt":         mqtt_connected,
        })

@app.route("/web_speak", methods=["POST"])
def route_web_speak():
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    text = str(data.get("text", "")).strip()
    if not text:
        return jsonify({"error": "Champ 'text' requis"}), 400
    mqtt_client.publish(TOPIC_SPEAK, json.dumps({"text": text}))
    log("SPEAK", f"→ bridge: {text[:60]}")
    return jsonify({"status": "ok"}), 202

@app.route("/keypad/<path:key>", methods=["POST"])
def route_keypad(key: str):
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    key = key.strip("/")
    # Mapper les noms d'actions vers les commandes MQTT ESP32
    ACTION_MAP = {
        "corps_content":       ("emotion", {"valeur": "content"}),
        "corps_triste":        ("emotion", {"valeur": "triste"}),
        "corps_surpris":       ("emotion", {"valeur": "surpris"}),
        "corps_colere":        ("emotion", {"valeur": "colere"}),
        "corps_amoureux":      ("emotion", {"valeur": "amoureux"}),
        "corps_neutre":        ("emotion", {"valeur": "neutre"}),
        "corps_danse":         ("danse",   {}),
        "corps_hoche":         ("hoche",   {}),
        "corps_tourne_gauche": ("servo",   {"angle": 10}),
        "corps_tourne_droite": ("servo",   {"angle": 170}),
        "corps_centre":        ("servo",   {"angle": 90}),
        "D":                   ("repos",   {}),
        "A":                   ("ecoute",  {}),
        "#":                   ("veille",  {}),
        "tete_gauche":         ("servo",   {"angle": 10}),
        "tete_droite":         ("servo",   {"angle": 170}),
        "tete_centre":         ("servo",   {"angle": 90}),
        "continu_on":          ("continu_on",  {}),
        "continu_off":         ("continu_off", {}),
    }
    if key in ACTION_MAP:
        action, kwargs = ACTION_MAP[key]
        send_command(action, **kwargs)
    else:
        send_command(key)
    return jsonify({"status": "ok"})

@app.route("/toggle_continu", methods=["POST"])
def route_toggle_continu():
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    global _mode_continu
    with _state_lock:
        _mode_continu = not _mode_continu
        new_mode = _mode_continu
    mode_str = "continu_on" if new_mode else "continu_off"
    mqtt_client.publish(TOPIC_SPEAK, json.dumps({"set_mode": mode_str}))
    log("MODE", f"Mode continu → {'ON' if new_mode else 'OFF'}")
    return jsonify({"mode_continu": new_mode})

@app.route("/mode", methods=["POST"])
def route_mode():
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    mode = str(data.get("mode", "")).strip()
    if not mode:
        return jsonify({"error": "Champ 'mode' requis"}), 400
    mqtt_client.publish(TOPIC_SPEAK, json.dumps({"set_mode": mode}))
    log("MODE", f"→ {mode}")
    return jsonify({"status": "ok"})

@app.route("/listen", methods=["POST"])
def route_listen():
    """Relaie l'audio brut du navigateur vers neo-bridge:5051/listen."""
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401

    audio_data   = request.get_data()
    content_type = request.content_type or "audio/webm"

    if not audio_data:
        return jsonify({"error": "Aucune donnée audio"}), 400

    import requests as _req
    try:
        resp = _req.post(
            "http://neo-bridge:5051/listen",
            data=audio_data,
            headers={"Content-Type": content_type},
            timeout=35,
        )
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        log("ERR", f"/listen bridge: {e}")
        return jsonify({"error": f"Bridge inaccessible: {e}"}), 502


@app.route("/servo", methods=["POST"])
def route_servo():
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    try:
        angle = max(0, min(180, int(data.get("angle", 90))))
    except (TypeError, ValueError):
        return jsonify({"error": "angle invalide"}), 400
    servo_state["pan"] = angle
    send_command("servo", angle=angle)
    return jsonify({"status": "ok", "angle": angle})

# ── Dashboard local (port 5050) ────────────────────────────────
@app.route("/")
def index():
    try:
        return send_from_directory("static", "index.html")
    except Exception:
        return "<h1>NEO Control</h1><p>Aucun frontend disponible.</p>", 200

@app.route("/api/connstate")
def api_connstate():
    return jsonify({**get_conn_state(), "servo": servo_state})

# ── SocketIO dashboard ────────────────────────────────────────
@socketio.on("connect")
def on_connect():
    emit("conn_state",  get_conn_state())
    emit("servo_state", servo_state)
    emit("logs_history", list(logs)[-60:])
    with _state_lock:
        emit("robot_state", {"etat": _etat, "mode_continu": _mode_continu, "partial": _partial})

@socketio.on("command")
def on_command(data):
    action = data.get("action", "")
    if not action:
        return
    # Mise à jour locale de l'angle servo pour le dashboard
    if action == "tete_gauche":
        servo_state["pan"] = max(10,  servo_state["pan"] - 15)
    elif action == "tete_droite":
        servo_state["pan"] = min(170, servo_state["pan"] + 15)
    elif action in ("tete_centre", "repos"):
        servo_state["pan"] = 90
    extra = {k: v for k, v in data.items() if k != "action"}
    send_command(action, **extra)
    socketio.emit("servo_state", servo_state)

@socketio.on("servo_angle")
def on_servo_angle(data):
    angle = max(10, min(170, int(data.get("pan", servo_state["pan"]))))
    servo_state["pan"] = angle
    send_command("servo", angle=angle)
    socketio.emit("servo_state", servo_state)

@socketio.on("chat")
def on_chat(data):
    message = data.get("message", "").strip()
    if not message:
        return
    log("CHAT", f"Tu → {message}")
    emit("chat_thinking", {})

    def _ask():
        reply = openclaw_send(message)
        if reply is None:
            socketio.emit("chat_reply", {"text": f"OpenClaw inaccessible ({OPENCLAW_WS})"})
            return
        log("CHAT", f"Neo → {reply[:100]}")
        socketio.emit("chat_reply", {"text": reply})
        if reply:
            mqtt_client.publish(TOPIC_SPEAK, json.dumps({"text": reply}))

    threading.Thread(target=_ask, daemon=True).start()

@socketio.on("get_logs")
def on_get_logs():
    emit("logs_history", list(logs))

@socketio.on("clear_logs")
def on_clear_logs():
    logs.clear()
    emit("logs_history", [])

# ── Main ──────────────────────────────────────────────────────
if __name__ == "__main__":
    threading.Thread(target=mqtt_loop, daemon=True).start()
    log("INFO", f"NEO Control démarré — MQTT:{MQTT_HOST}:{MQTT_PORT} | OpenClaw:{OPENCLAW_WS}")
    log("INFO", f"API REST sur http://0.0.0.0:5050 (NEO_API_KEY={'configurée' if NEO_API_KEY else 'MANQUANTE'})")
    socketio.run(app, host="0.0.0.0", port=5050, debug=False)
