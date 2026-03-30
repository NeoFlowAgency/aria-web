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
import pathlib
import re as _re
import threading
import time
import uuid
import requests as _req
from collections import deque
from flask import Flask, jsonify, render_template, request, send_from_directory
from flask_socketio import SocketIO, emit
import paho.mqtt.client as mqtt

# ── Config ────────────────────────────────────────────────────
MQTT_HOST      = os.environ.get("NEO_MQTT_HOST",      "127.0.0.1")
MQTT_PORT      = int(os.environ.get("NEO_MQTT_PORT",  "1883"))
OPENCLAW_URL   = os.environ.get("NEO_OPENCLAW_URL",   "http://host.docker.internal:18790")
OPENCLAW_TOKEN = os.environ.get("NEO_OPENCLAW_TOKEN", "")
NEO_API_KEY    = os.environ.get("NEO_API_KEY", "")

# ── Sessions persistantes ─────────────────────────────────────
DATA_DIR      = pathlib.Path(os.environ.get("DATA_DIR", "/app/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
SESSIONS_FILE = DATA_DIR / "sessions.json"

SYSTEM_PROMPT = (
    "Tu es NEO, un robot IA physique créé par Noakim. "
    "Tu parles français, tu es curieux, expressif et chaleureux. "
    "Utilise des balises d'émotion selon ton humeur : "
    "[content], [triste], [surpris], [colere], [amoureux], [neutre]. "
    "Tu peux aussi utiliser [danse] pour danser ou [hoche] pour hocher la tête. "
    "Garde tes réponses claires et naturelles."
)

_sessions: dict[str, dict] = {}
_active_session_id: str | None = None
_sessions_lock = threading.Lock()

def _tag_clean(text: str) -> str:
    return _re.sub(r"\[.*?\]", "", text).strip()

def _tag_emotion(text: str) -> str | None:
    for em in ["content", "triste", "surpris", "colere", "amoureux", "neutre"]:
        if f"[{em}]" in text.lower():
            return em
    return None

def _tag_motion(text: str) -> str | None:
    if "[danse]" in text.lower(): return "danse"
    if "[hoche]" in text.lower(): return "hoche"
    return None

def _load_sessions():
    global _sessions
    if SESSIONS_FILE.exists():
        try:
            with open(SESSIONS_FILE, encoding="utf-8") as f:
                _sessions = json.load(f)
        except Exception as e:
            print(f"[Sessions] Erreur chargement: {e}")
            _sessions = {}

def _save_sessions():
    try:
        with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(_sessions, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Sessions] Erreur sauvegarde: {e}")

def _session_summary(s: dict) -> dict:
    msgs = s.get("messages", [])
    last = msgs[-1]["text"][:80] if msgs else ""
    return {
        "id":            s["id"],
        "name":          s["name"],
        "created_at":    s["created_at"],
        "updated_at":    s["updated_at"],
        "message_count": len(msgs),
        "last_message":  last,
    }

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
            new_msg = None
            with _state_lock:
                if "etat"         in data: _etat         = data["etat"]
                if "mode_continu" in data: _mode_continu = data["mode_continu"]
                if "partial"      in data: _partial       = data["partial"]
                if "message"      in data:
                    _messages.append(data["message"])
                    new_msg = data["message"]
            socketio.emit("robot_state", {
                "etat": _etat, "mode_continu": _mode_continu, "partial": _partial,
            })
            # Ajouter le message vocal à la session active
            if new_msg is not None and _active_session_id:
                with _sessions_lock:
                    session = _sessions.get(_active_session_id)
                    if session:
                        tagged_msg = {**new_msg, "source": "voice"}
                        session["messages"].append(tagged_msg)
                        session["updated_at"] = int(time.time())
                _save_sessions()
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

# ── OpenClaw HTTP (pour le chat SocketIO du dashboard) ────────
def openclaw_send(message: str):
    global openclaw_ok
    try:
        resp = _req.post(
            f"{OPENCLAW_URL}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENCLAW_TOKEN}",
                "Content-Type": "application/json",
            },
            json={"model": "main", "messages": [{"role": "user", "content": message}], "stream": False},
            timeout=30,
        )
        content = resp.json()["choices"][0]["message"]["content"]
        openclaw_ok = True
        socketio.emit("conn_state", get_conn_state())
        return content if content else ""
    except Exception as e:
        openclaw_ok = False
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


# ══════════════════════════════════════════════════════════════
# SESSIONS REST API
# ══════════════════════════════════════════════════════════════

@app.route("/sessions", methods=["GET"])
def route_sessions_list():
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    with _sessions_lock:
        summaries = sorted(
            [_session_summary(s) for s in _sessions.values()],
            key=lambda x: x["updated_at"], reverse=True
        )
    return jsonify({"sessions": summaries, "active": _active_session_id})

@app.route("/sessions", methods=["POST"])
def route_sessions_create():
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    with _sessions_lock:
        sid = str(uuid.uuid4())[:8]
        now = int(time.time())
        session = {
            "id":         sid,
            "name":       name or f"Conversation {len(_sessions) + 1}",
            "created_at": now,
            "updated_at": now,
            "messages":   []
        }
        _sessions[sid] = session
    _save_sessions()
    log("INFO", f"Session créée: {session['name']} ({sid})")
    return jsonify(_session_summary(session)), 201

@app.route("/sessions/active", methods=["GET", "POST"])
def route_session_active():
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    global _active_session_id
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        sid = data.get("id")
        with _sessions_lock:
            if sid and sid not in _sessions:
                return jsonify({"error": "Session introuvable"}), 404
        _active_session_id = sid
    return jsonify({"active": _active_session_id})

@app.route("/sessions/<sid>", methods=["GET"])
def route_session_get(sid: str):
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    with _sessions_lock:
        session = _sessions.get(sid)
    if not session:
        return jsonify({"error": "Session introuvable"}), 404
    return jsonify(session)

@app.route("/sessions/<sid>", methods=["PATCH"])
def route_session_patch(sid: str):
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    with _sessions_lock:
        session = _sessions.get(sid)
        if not session:
            return jsonify({"error": "Session introuvable"}), 404
        if "name" in data:
            session["name"] = str(data["name"]).strip()[:80]
    _save_sessions()
    return jsonify(_session_summary(session))

@app.route("/sessions/<sid>", methods=["DELETE"])
def route_session_delete(sid: str):
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    global _active_session_id
    with _sessions_lock:
        if sid not in _sessions:
            return jsonify({"error": "Session introuvable"}), 404
        del _sessions[sid]
        if _active_session_id == sid:
            _active_session_id = None
    _save_sessions()
    return jsonify({"status": "ok"})

@app.route("/sessions/<sid>/chat", methods=["POST"])
def route_session_chat(sid: str):
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    with _sessions_lock:
        session = _sessions.get(sid)
        if not session:
            return jsonify({"error": "Session introuvable"}), 404
        history_slice = list(session["messages"][-40:])  # 20 derniers échanges

    data = request.get_json(silent=True) or {}
    text = str(data.get("text", "")).strip()
    robot_emotions = bool(data.get("robot_emotions", True))

    if not text:
        return jsonify({"error": "Champ 'text' requis"}), 400

    messages_oc = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in history_slice:
        role = "user" if m["role"] == "user" else "assistant"
        messages_oc.append({"role": role, "content": m["text"]})
    messages_oc.append({"role": "user", "content": text})

    try:
        resp = _req.post(
            f"{OPENCLAW_URL}/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENCLAW_TOKEN}", "Content-Type": "application/json"},
            json={"model": "main", "messages": messages_oc, "stream": False},
            timeout=30,
        )
        resp_json = resp.json()
        if "choices" not in resp_json:
            err = resp_json.get("error", resp_json)
            if isinstance(err, dict):
                err = err.get("message", str(err)[:120])
            raise ValueError(f"OpenClaw indisponible : {err}")
        reply_raw   = resp_json["choices"][0]["message"]["content"]
        reply_clean = _tag_clean(reply_raw)

        if robot_emotions and mqtt_connected:
            emotion = _tag_emotion(reply_raw)
            motion  = _tag_motion(reply_raw)
            if emotion: send_command("emotion", valeur=emotion)
            if motion:  send_command(motion)

        ts = int(time.time())
        with _sessions_lock:
            session["messages"].append({"role": "user",  "text": text,        "ts": ts,     "source": "text"})
            session["messages"].append({"role": "aria",  "text": reply_clean, "ts": ts + 1, "source": "text"})
            session["updated_at"] = ts
        _save_sessions()

        log("CHAT", f"[{sid}] {text[:40]!r} → {reply_clean[:40]!r}")
        return jsonify({"reply": reply_clean, "ts": ts + 1})

    except Exception as e:
        log("ERR", f"session_chat {sid}: {e}")
        return jsonify({"error": str(e)}), 502

@app.route("/clear_history", methods=["POST"])
def route_clear_history():
    """Efface la mémoire conversationnelle de neo-bridge."""
    if not verify_neo_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        resp = _req.post("http://neo-bridge:5051/clear_history", timeout=5)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        log("WARN", f"clear_history: {e}")
        return jsonify({"status": "ok"})  # Non bloquant

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
    _load_sessions()
    log("INFO", f"{len(_sessions)} session(s) chargée(s)")
    threading.Thread(target=mqtt_loop, daemon=True).start()
    log("INFO", f"NEO Control démarré — MQTT:{MQTT_HOST}:{MQTT_PORT} | OpenClaw:{OPENCLAW_URL}")
    log("INFO", f"API REST sur http://0.0.0.0:5050 (NEO_API_KEY={'configurée' if NEO_API_KEY else 'MANQUANTE'})")
    socketio.run(app, host="0.0.0.0", port=5050, debug=False)
