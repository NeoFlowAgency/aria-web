#!/usr/bin/env python3
"""
neo_bridge.py — Pont audio/IA pour robot NEO (VPS)

Pipeline complet :
  • Micro ESP32 (MQTT neo/audio/mic)
      → STT (faster-whisper)
      → OpenClaw (WebSocket Gateway)
      → TTS (edge-tts → PCM 22050Hz)
      → Audio ESP32 (MQTT neo/audio/data)

  • Commandes web (MQTT neo/speak)
      → TTS → Audio ESP32

  • HTTP POST /listen (port 5051, interne)
      ← audio brut depuis app.py (navigateur)
      → STT → OpenClaw → TTS → ESP32

  • Publie les états sur neo/state → lu par neo-control (app.py)
"""

import asyncio
import io
import json
import os
import re
import threading
import time
import wave
from collections import deque

import edge_tts
import paho.mqtt.client as mqtt
import requests as _req
from faster_whisper import WhisperModel
from pydub import AudioSegment

# ── Config ─────────────────────────────────────────────────────
MQTT_HOST   = os.environ.get("MQTT_HOST",   "127.0.0.1")
MQTT_PORT   = int(os.environ.get("MQTT_PORT", "1883"))

TOPIC_MIC      = "neo/audio/mic"
TOPIC_MIC_CTL  = "neo/audio/mic_ctl"
TOPIC_AUDIO    = "neo/audio/data"
TOPIC_AUDIO_CTL= "neo/audio/ctl"
TOPIC_CMD      = "neo/commandes"
TOPIC_SPEAK    = "neo/speak"
TOPIC_STATE    = "neo/state"

OPENCLAW_URL   = os.environ.get("OPENCLAW_URL",   "http://host.docker.internal:18790")
OPENCLAW_TOKEN = os.environ.get("OPENCLAW_TOKEN", "")
TTS_VOICE   = "fr-FR-DeniseNeural"

MIC_SAMPLE_RATE = 16000    # ESP32 enregistre en 16kHz
OUT_SAMPLE_RATE = 22050    # ESP32 joue en 22050Hz
CHUNK_SIZE      = 4096     # bytes par message MQTT audio
VAD_THRESH      = 400      # RMS pour détecter la voix
SILENCE_SEC     = 1.5      # silence avant traitement

# ── Whisper ─────────────────────────────────────────────────────
print("[Bridge] Chargement Whisper…")
whisper = WhisperModel("small", device="cpu", compute_type="int8")
print("[Bridge] Whisper prêt")

# ── État global ─────────────────────────────────────────────────
_state_lock   = threading.Lock()
_etat         = "repos"
_mode         = "neutre"
_mode_continu = False
_processing   = False
_messages     = deque(maxlen=50)

# ── Buffer micro ───────────────────────────────────────────────
audio_buf: list[bytes] = []
last_voice_time = time.time()
mic_recording   = False   # True quand esp32 envoie (après mic_ctl start)

# ── OpenClaw HTTP ──────────────────────────────────────────────
def openclaw_ask(text: str) -> str:
    try:
        resp = _req.post(
            f"{OPENCLAW_URL}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENCLAW_TOKEN}",
                "Content-Type": "application/json",
            },
            json={
                "model": "main",
                "messages": [{"role": "user", "content": text}],
                "stream": False,
            },
            timeout=30,
        )
        content = resp.json()["choices"][0]["message"]["content"]
        return content if content else "Désolé, je n'ai pas pu formuler de réponse."
    except Exception as e:
        print(f"[OpenClaw] Erreur: {e}")
        return "Désolé, problème de connexion avec mon cerveau."

# ── TTS + envoi MQTT ───────────────────────────────────────────
async def _tts_to_mp3(text: str) -> bytes:
    communicate = edge_tts.Communicate(text, TTS_VOICE)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return buf.getvalue()

def mp3_to_wav_pcm(mp3_data: bytes) -> bytes:
    """Convertit MP3 → WAV PCM 16-bit 22050Hz mono."""
    seg = AudioSegment.from_mp3(io.BytesIO(mp3_data))
    seg = seg.set_frame_rate(OUT_SAMPLE_RATE).set_channels(1).set_sample_width(2)
    buf = io.BytesIO()
    seg.export(buf, format="wav")
    return buf.getvalue()

def send_audio_mqtt(client: mqtt.Client, wav_data: bytes):
    """Envoie un fichier WAV en chunks MQTT à l'ESP32."""
    client.publish(TOPIC_AUDIO_CTL, json.dumps({"type": "start"}))
    for i in range(0, len(wav_data), CHUNK_SIZE):
        client.publish(TOPIC_AUDIO, wav_data[i:i + CHUNK_SIZE])
        time.sleep(0.01)
    client.publish(TOPIC_AUDIO_CTL, json.dumps({"type": "end"}))

def speak_and_send(text: str, client: mqtt.Client):
    """Génère TTS et envoie audio + commandes à l'ESP32."""
    try:
        mp3 = asyncio.run(_tts_to_mp3(text))
        wav = mp3_to_wav_pcm(mp3)
        send_audio_mqtt(client, wav)
    except Exception as e:
        print(f"[TTS] Erreur: {e}")

# ── Extraction d'émotion dans la réponse OpenClaw ─────────────
EMOTION_TAGS = {
    r"\[content\]":   "content",
    r"\[triste\]":    "triste",
    r"\[surpris\]":   "surpris",
    r"\[colere\]":    "colere",
    r"\[amoureux\]":  "amoureux",
    r"\[neutre\]":    "neutre",
}
MOTION_TAGS = {
    r"\[danse\]":  "danse",
    r"\[hoche\]":  "hoche",
    r"\[repos\]":  None,
}

def extract_tags(text: str) -> tuple[str | None, str | None, str]:
    emotion = None
    motion  = None
    for pattern, em in EMOTION_TAGS.items():
        if re.search(pattern, text, re.IGNORECASE):
            emotion = em
    for pattern, mo in MOTION_TAGS.items():
        if re.search(pattern, text, re.IGNORECASE):
            motion = mo
    # Nettoyer tous les tags du texte parlé
    clean = re.sub(r"\[.*?\]", "", text).strip()
    return emotion, motion, clean

# ── Publication état ───────────────────────────────────────────
def publish_state(client: mqtt.Client, etat: str | None = None,
                  partial: str | None = None, message: dict | None = None):
    global _etat
    with _state_lock:
        if etat is not None:
            _etat = etat
    payload: dict = {}
    if etat     is not None: payload["etat"]    = etat
    if partial  is not None: payload["partial"] = partial
    if message  is not None:
        payload["message"] = message
        _messages.append(message)
    client.publish(TOPIC_STATE, json.dumps(payload))

# ── Pipeline complet d'une interaction ────────────────────────
def process_utterance(pcm_data: bytes, client: mqtt.Client):
    global _processing
    _processing = True

    try:
        # ── STT ──────────────────────────────────────────────
        publish_state(client, "ecoute")
        client.publish(TOPIC_CMD, json.dumps({"action": "ecoute"}))

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(MIC_SAMPLE_RATE)
            wf.writeframes(pcm_data)
        buf.seek(0)

        segments, _ = whisper.transcribe(buf, language="fr")
        text = " ".join(s.text for s in segments).strip()

        if not text:
            print("[STT] Rien compris")
            publish_state(client, "repos")
            client.publish(TOPIC_CMD, json.dumps({"action": "repos"}))
            return

        print(f"[STT] {text!r}")
        publish_state(client, message={"role": "user", "text": text,
                                       "ts": int(time.time())})

        # ── OpenClaw ─────────────────────────────────────────
        publish_state(client, "reflechit")
        client.publish(TOPIC_CMD, json.dumps({"action": "reflechit"}))

        reply = openclaw_ask(text)
        print(f"[Neo] {reply!r}")

        # ── Extraction tags d'émotion / mouvement ────────────
        emotion, motion, clean_reply = extract_tags(reply)

        if emotion:
            client.publish(TOPIC_CMD, json.dumps({"action": "emotion", "valeur": emotion}))
        if motion:
            client.publish(TOPIC_CMD, json.dumps({"action": motion}))

        # ── TTS + audio ───────────────────────────────────────
        publish_state(client, "parle", partial=clean_reply)
        client.publish(TOPIC_CMD, json.dumps({"action": "parle"}))

        speak_and_send(clean_reply, client)

        publish_state(client, message={"role": "aria", "text": clean_reply,
                                       "ts": int(time.time())})

    except Exception as e:
        print(f"[Bridge] Erreur traitement: {e}")

    finally:
        _processing = False
        publish_state(client, "repos", partial="")
        client.publish(TOPIC_CMD, json.dumps({"action": "repos"}))

# ── Handler neo/speak (texte direct depuis web/OpenClaw) ──────
def handle_speak(payload: bytes, client: mqtt.Client):
    try:
        data = json.loads(payload.decode())
    except Exception:
        return

    # Changement de mode continu
    if "set_mode" in data:
        global _mode, _mode_continu
        new_mode = data["set_mode"]
        _mode = new_mode
        _mode_continu = (new_mode == "continu_on")
        print(f"[Bridge] Mode → {new_mode}")
        client.publish(TOPIC_STATE, json.dumps({"mode_continu": _mode_continu}))
        return

    text = data.get("text", "").strip()
    if not text or _processing:
        return

    def _run():
        global _processing
        _processing = True
        try:
            emotion, motion, clean = extract_tags(text)
            if emotion:
                client.publish(TOPIC_CMD, json.dumps({"action": "emotion", "valeur": emotion}))
            if motion:
                client.publish(TOPIC_CMD, json.dumps({"action": motion}))

            publish_state(client, "parle", partial=clean)
            client.publish(TOPIC_CMD, json.dumps({"action": "parle"}))

            speak_and_send(clean, client)

            publish_state(client, message={"role": "aria", "text": clean,
                                           "ts": int(time.time())})
        finally:
            _processing = False
            publish_state(client, "repos", partial="")
            client.publish(TOPIC_CMD, json.dumps({"action": "repos"}))

    threading.Thread(target=_run, daemon=True).start()

# ── VAD helpers ────────────────────────────────────────────────
import math, struct, os, tempfile

def rms(data: bytes) -> float:
    try:
        samples = struct.unpack(f"{len(data)//2}h", data[:len(data) - len(data)%2])
        return math.sqrt(sum(s * s for s in samples) / len(samples)) if samples else 0.0
    except Exception:
        return 0.0

# ── MQTT callbacks ─────────────────────────────────────────────
def on_message(client, userdata, msg):
    global audio_buf, last_voice_time, mic_recording

    if msg.topic == TOPIC_MIC:
        if _processing:
            return
        level = rms(msg.payload)
        if level > VAD_THRESH:
            last_voice_time = time.time()
            audio_buf.append(bytes(msg.payload))
        elif audio_buf:
            audio_buf.append(bytes(msg.payload))
            if time.time() - last_voice_time > SILENCE_SEC:
                pcm = b"".join(audio_buf)
                audio_buf.clear()
                threading.Thread(target=process_utterance,
                                 args=(pcm, client), daemon=True).start()

    elif msg.topic == TOPIC_MIC_CTL:
        try:
            data = json.loads(msg.payload.decode())
            t = data.get("type", "")
            if t == "start":
                audio_buf.clear()
                last_voice_time = time.time()
                mic_recording = True
                print("[Bridge] Micro ESP32 : début enregistrement")
            elif t == "end":
                mic_recording = False
                if audio_buf and not _processing:
                    pcm = b"".join(audio_buf)
                    audio_buf.clear()
                    threading.Thread(target=process_utterance,
                                     args=(pcm, client), daemon=True).start()
        except Exception as e:
            print(f"[Bridge] mic_ctl: {e}")

    elif msg.topic == TOPIC_SPEAK:
        handle_speak(msg.payload, client)

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        client.subscribe(TOPIC_MIC)
        client.subscribe(TOPIC_MIC_CTL)
        client.subscribe(TOPIC_SPEAK)
        print(f"[Bridge] MQTT connecté — écoute sur {TOPIC_MIC}, {TOPIC_SPEAK}")
        publish_state(client, "repos")
    else:
        print(f"[Bridge] MQTT erreur rc={rc}")

# ── Serveur HTTP interne (port 5051) ──────────────────────────
# Utilisé par app.py pour relayer l'audio du navigateur
from flask import Flask as _BFlask, request as _breq, jsonify as _bjson

_bridge_http = _BFlask("bridge_http")
_bridge_mqtt_client: mqtt.Client | None = None


@_bridge_http.route("/listen", methods=["POST"])
def bridge_listen():
    """
    Reçoit audio brut (webm/wav/mp3) depuis app.py.
    Fait STT → OpenClaw → TTS → ESP32.
    Retourne {"heard": str, "reply": str}.
    """
    audio_bytes = _breq.get_data()
    if not audio_bytes:
        return _bjson({"error": "Aucune donnée audio"}), 400

    # Déterminer l'extension à partir du Content-Type
    ct = _breq.content_type or "audio/webm"
    if "mp4" in ct or "m4a" in ct:
        ext = ".mp4"
    elif "ogg" in ct:
        ext = ".ogg"
    elif "wav" in ct:
        ext = ".wav"
    else:
        ext = ".webm"

    # Sauvegarder dans un fichier temporaire
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        f.write(audio_bytes)
        tmppath = f.name

    try:
        # STT
        segments, _ = whisper.transcribe(tmppath, language="fr")
        text = " ".join(s.text for s in segments).strip()

        if not text:
            return _bjson({"heard": "", "reply": "Je n'ai pas entendu."})

        print(f"[Listen/STT] {text!r}")

        # OpenClaw
        reply = openclaw_ask(text)
        emotion, motion, clean = extract_tags(reply)

        # Envoyer au robot
        if _bridge_mqtt_client:
            if emotion:
                _bridge_mqtt_client.publish(
                    TOPIC_CMD, json.dumps({"action": "emotion", "valeur": emotion})
                )
            if motion:
                _bridge_mqtt_client.publish(
                    TOPIC_CMD, json.dumps({"action": motion})
                )

            # TTS + audio ESP32 en arrière-plan
            threading.Thread(
                target=_listen_speak,
                args=(clean, _bridge_mqtt_client),
                daemon=True,
            ).start()

            # Publier dans l'historique
            ts = int(time.time())
            publish_state(_bridge_mqtt_client,
                          message={"role": "user",  "text": text,  "ts": ts})
            publish_state(_bridge_mqtt_client,
                          message={"role": "aria",  "text": clean, "ts": ts + 1})

        return _bjson({"heard": text, "reply": clean})

    except Exception as e:
        print(f"[Listen] Erreur: {e}")
        return _bjson({"error": str(e)}), 500
    finally:
        os.unlink(tmppath)


def _listen_speak(text: str, client: mqtt.Client):
    global _processing
    _processing = True
    try:
        publish_state(client, "parle", partial=text)
        client.publish(TOPIC_CMD, json.dumps({"action": "parle"}))
        speak_and_send(text, client)
    finally:
        _processing = False
        publish_state(client, "repos", partial="")
        client.publish(TOPIC_CMD, json.dumps({"action": "repos"}))


def _start_http():
    _bridge_http.run(host="0.0.0.0", port=5051, debug=False, use_reloader=False)


# ── Main ───────────────────────────────────────────────────────
def main():
    global _bridge_mqtt_client

    client = mqtt.Client()
    _bridge_mqtt_client = client
    client.on_connect = on_connect
    client.on_message = on_message

    # Démarrer le serveur HTTP interne
    threading.Thread(target=_start_http, daemon=True).start()
    print(f"[Bridge] HTTP interne démarré sur :5051")

    print(f"[Bridge] Connexion MQTT {MQTT_HOST}:{MQTT_PORT}…")
    while True:
        try:
            client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            client.loop_forever()
        except Exception as e:
            print(f"[Bridge] Erreur: {e} — reconnexion dans 5s")
            time.sleep(5)


if __name__ == "__main__":
    main()
