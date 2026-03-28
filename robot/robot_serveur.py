# ============================================
# SERVEUR ROBOT IA v6 — WAKE WORD "neo"
# Wake word detection avec Whisper tiny
# VAD par RMS numpy (silence detection)
# Thread daemon + mutex acces micro
# API chat Ollama + filtre recherche web
# ============================================

import sys
import os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from flask import Flask, request, jsonify, send_file, Response
import whisper
import sounddevice as sd
import numpy as np
import requests as req
import wave
import io
import re
import threading
import time
import queue as _queue
import subprocess
import socket as _socket
import unicodedata
import json
import random
from piper import PiperVoice
from ddgs import DDGS

app = Flask(__name__)

@app.after_request
def _cors(response):
    """CORS permissif pour l'interface web Vercel."""
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-API-Key'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
    return response

@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def _options(path):
    return '', 204

# ============================================
# ÉTAT TEMPS RÉEL — Polling interface web
# ============================================
_web_etat = 'repos'           # état courant du robot
_web_mode_continu = False
_web_messages: list[dict] = []  # {role, text, ts}
_web_partial  = ''            # réponse ARIA en cours (streaming)
_web_lock = threading.Lock()

def _web_set_etat(etat: str):
    global _web_etat
    with _web_lock:
        _web_etat = etat

def _web_add_message(role: str, text: str):
    global _web_partial
    with _web_lock:
        _web_messages.append({'role': role, 'text': text, 'ts': time.time()})
        if role == 'aria':
            _web_partial = ''  # effacer le partiel quand la réponse est complète
        if len(_web_messages) > 50:
            _web_messages.pop(0)

def _web_append_partial(chunk: str):
    global _web_partial
    with _web_lock:
        _web_partial += chunk

# ============================================
# SSE — Server-Sent Events (interface web)
# ============================================
_sse_clients: list[_queue.Queue] = []
_sse_lock = threading.Lock()

def _broadcast_sse(event: str, data: dict):
    """Envoie un événement SSE à tous les clients connectés."""
    msg = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    with _sse_lock:
        dead = []
        for q in _sse_clients:
            try:
                q.put_nowait(msg)
            except _queue.Full:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)

def _check_api_key() -> bool:
    """Vérifie la clé API dans l'en-tête X-API-Key. Libre si non configurée."""
    expected = os.environ.get('ARIA_API_KEY', '')
    if not expected:
        return True
    return request.headers.get('X-API-Key', '') == expected

# --- Configuration ---
MODELE_WHISPER          = "large-v3"       # Meilleure transcription (RTX 5060Ti OK)
MODELE_RAPIDE           = "llama3.2:latest"  # 3B — 2.1s, francais correct, phrases courtes
MODELE_PUISSANT         = "qwen2.5:14b"     # 14B — 9.9s, meilleure qualite/concision, 9 Go RAM
MODELE_OLLAMA_FALLBACK  = MODELE_RAPIDE    # Fallback = rapide (toujours disponible)
MODELE_OLLAMA           = MODELE_OLLAMA_FALLBACK  # Mis a jour au demarrage (conserve pour compatibilite)
OLLAMA_URL      = "http://localhost:11434/api/generate"
OLLAMA_CHAT_URL = "http://localhost:11434/api/chat"
SAMPLE_RATE     = 16000
DUREE_ECOUTE    = 5
DEVICE_MICRO    = 2    # Microphone RIG-700HX (MME 44100Hz natif)
DEVICE_MICRO_WW = 1    # Voicemod MME — meilleur RMS (0.12) quand device 2 occupe par /ecouter
DEVICE_HP       = 4    # Haut-parleurs RIG-700HX
SAMPLE_RATE_WW  = 16000  # Direct 16kHz pour Whisper — evite resampling (device 1 Voicemod accepte)
WW_RMS_MIN      = 0.0006  # Seuil pre-filtre : silence max=0.0004, chunk voix ~0.0008
MODELE_VOIX     = "C:/Users/Noakim Grelier/Desktop/robot/voix/fr_FR-upmc-medium.onnx"

# --- Seuils VAD (Voice Activity Detection par RMS numpy) ---
VAD_SILENCE_RMS   = 0.015   # RMS en dessous = silence
VAD_SILENCE_DUREE = 1.5     # secondes de silence consecutif = fin de parole
VAD_MAX_DUREE     = 15.0    # duree max d'enregistrement question (secondes)
VAD_CHUNK_DUREE   = 0.2     # duree d'un chunk VAD (secondes)

# --- Wake word ---
WW_CHUNK_DUREE = 1.5        # secondes par fenetre d'ecoute wake word
WW_MOTS_LONGS  = [
    "neo", "néo", "nao", "néau", "neau",   # variantes phonetiques principales
    "nayo", "nieo", "neos", "néos",        # autres misrecognitions
    "hey neo", "hey nao", "hey néo",       # avec prefixe
    "new", "hey new",                      # transcription EN Whisper tiny de "neo"
]
WW_MOTS_SEULS  = ["no", "noe", "neon", "ne"]  # mots courts : detectes seulement si seuls

# --- ESP32 ---
esp32_ip = "192.168.1.147"  # IP par defaut, mise a jour via /register_esp32

# --- Etat global conversation ---
historique     = []
MAX_HISTORIQUE = 8
mode_actuel    = "neutre"

# --- Etat wake word ---
wake_word_actif     = True   # Active/desactive le wake word
wake_word_en_ecoute = False  # True = on ecoute une question

# Mutex : garantit qu'un seul thread accede au micro a la fois
micro_lock = threading.Lock()

# Interruption audio : mis a True pendant l'envoi WAV pour stopper immediatement
_audio_interrupt = threading.Event()

# Stop du thread d'interruption : mis a True quand l'audio est termine
_interrupt_thread_stop = threading.Event()

# True pendant envoi audio TCP vers ESP32 : thread interrupt utilise seuil RMS eleve
_audio_en_lecture = threading.Event()

# True pendant enregistrement VAD question : thread interrupt doit se taire
_ecoute_question = False

# Timestamp de la derniere interaction (pour relance apres silence)
_temps_derniere_interaction = 0.0
_DELAI_RELANCE = 30.0  # secondes avant question de relance

# Mode conversation continue (touche * ESP32)
_mode_continu = False
_dernier_echange_continu = 0.0
_MODE_CONTINU_TIMEOUT = 15.0  # secondes de silence → sortie automatique

# --- Persistance historique ---
HISTORIQUE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "historique.json")

_NATURE_ROBOT = (
    "Tu es un robot physique en carton. Tu n'as pas de vie physique : "
    "tu ne vas pas a des festivals, tu ne fais pas de sport, tu ne manges pas, "
    "tu ne sors pas. Si on te demande ce que tu fais ou ce que tu as fait, "
    "reponds en lien avec ta nature de robot : traiter des donnees, attendre des questions, "
    "analyser des informations, ecouter. N'invente JAMAIS d'activites humaines. "
    "En revanche tu peux VRAIMENT faire ces actions physiques : danser ([DANSE]), "
    "tourner la tete a droite ([TOURNE_DROITE]), a gauche ([TOURNE_GAUCHE]), centrer ([CENTRE]), "
    "hocher la tete ([HOCHE]), montrer des expressions OLED, et te mettre en veille ([VEILLE]). "
    "Utilise ces capacites quand c'est pertinent — ne dis JAMAIS que tu ne peux pas danser ou bouger ! "
    "INTERDIT : ecrire des didascalies ou indications sceniques "
    "(pas de 'pauses', 'aucune musique ne sort', '*fait semblant de*', etc.) — texte pur uniquement."
)

PERSONNALITES = {
    "neutre":     f"Tu es ARIA, un robot en carton construit par Noakim. Tu es curieux et bienveillant. {_NATURE_ROBOT} Reponds TOUJOURS en francais de facon naturelle et complete. Utilise TOUJOURS 'tu' et jamais 'vous'. Tutoie l'utilisateur. Texte simple uniquement, pas de markdown ni de listes. Quand des informations web recentes te sont fournies, utilise-les EN PRIORITE ABSOLUE sur tes connaissances d'entrainement qui peuvent etre obsoletes.",
    "drole":      f"Tu es ARIA, un robot en carton sarcastique et drole. {_NATURE_ROBOT} Reponds TOUJOURS en francais avec humour et esprit. Utilise TOUJOURS 'tu' et jamais 'vous'. Tutoie l'utilisateur. Texte simple uniquement, pas de markdown. Quand des informations web te sont fournies, utilise-les en priorite.",
    "serieux":    f"Tu es ARIA, un robot expert et precis. {_NATURE_ROBOT} Reponds TOUJOURS en francais de facon claire et complete. Utilise TOUJOURS 'tu' et jamais 'vous'. Tutoie l'utilisateur. Texte simple uniquement, pas de markdown. Quand des informations web te sont fournies, utilise-les en priorite absolue.",
    "affectueux": f"Tu es ARIA, un robot doux et attachant. {_NATURE_ROBOT} Reponds TOUJOURS en francais avec chaleur et tendresse. Utilise TOUJOURS 'tu' et jamais 'vous'. Tutoie l'utilisateur. Texte simple uniquement, pas de markdown. Quand des informations web te sont fournies, utilise-les en priorite.",
    "colere":     f"Tu es ARIA, un robot grognon et impatient. {_NATURE_ROBOT} Reponds TOUJOURS en francais de facon brusque et directe. Utilise TOUJOURS 'tu' et jamais 'vous'. Tutoie l'utilisateur. Texte simple uniquement, pas de markdown. Quand des informations web te sont fournies, utilise-les en priorite."
}

# Phrases de relance si l'utilisateur ne repond plus apres 30 secondes
PHRASES_RELANCE = [
    "Tu es toujours là ?",
    "Il y a quelque chose que tu voulais me demander ?",
    "Tu veux qu'on parle d'autre chose ?",
    "Je t'écoute si tu as une question.",
    "Tu penses à quelque chose ?",
]

# Mots-cles de questions personnelles/conversationnelles → pas de recherche web
MOTS_PERSO = [
    'je m appelle', 'j appelle', 'mon nom est', 'je me nomme', 'je suis noakim',
    'comment je m appelle', 'tu te souviens', 'que t ai je dit', 'rappelle toi',
    'quest ce que j ai dit', 'tu sais mon', 'tu connais mon',
    'bonjour', 'salut', 'bonsoir', 'coucou', 'merci', 'au revoir', 'bye',
    'comment vas', 'ca va', 'comment tu vas', 'comment allez',
    'tu es qui', 'qui es tu', 'tu t appelles', 'ton nom',
    'tu penses', 'tu crois', 'tu aimes', 'tu preferes', 'est ce que tu',
    'qu est ce que tu', 'raconte moi', 'parle moi de toi',
    # Questions sur la conversation en cours → jamais de recherche web
    'derniere question', 'derniere fois', 'precedente', 'avant ca',
    'j ai dit', 'j ai demande', 'on a parle', 'on a dit', 'on parlait',
    'tu te rappelles', 'tu te souviens', 'dans cette conversation',
    'tout a l heure', 'il y a un moment',
]

# Pronoms personnels : contexte conversationnel → pas de recherche
MOTS_PERSO_SIMPLES = [
    ' tu ', ' toi ', ' moi ', ' je ', ' nous ', ' vous ',
    ' mon ', ' ma ', ' mes ', ' ton ', ' ta ', ' tes ',
    ' notre ', ' votre ', ' nos ', ' vos ',
]

# Mots signalant une question factuelle/d'actualite → recherche OUI
MOTS_ACTUALITE = [
    "aujourd'hui", "maintenant", "actuellement", "en ce moment",
    "2024", "2025", "2026", "recent", "recemment", "dernier", "derniere",
    "nouveau", "nouvelle", "vient de",
    "tarif", "combien coute", "combien ca coute",
    "meteo", "temperature", "temps qu il fait",
    "president", "premier ministre", "ministre", "gouvernement",
    "election", "vote", "referendum",
    "guerre", "conflit", "attaque", "attentat",
    "score", "resultat", "match", "classement",
    "bourse", "cotation", "cours de bourse", "bitcoin", "crypto",
    "mort", "deces", "decede", "est mort", "a gagne", "a perdu",
    "sorti", "sortie", "disponible", "lance", "annonce",
]

def _sans_accents(texte):
    """Supprime les accents pour comparaison insensible aux diacritiques."""
    return unicodedata.normalize('NFD', texte).encode('ascii', 'ignore').decode('ascii')

# ============================================
# CONTROLE CORPS PAR L'IA (balises [TAG])
# ============================================

_TAG_RE = re.compile(r'\[([A-Z_]+)\]')
TAGS_VALIDES = {
    'CONTENT', 'TRISTE', 'SURPRIS', 'COLERE', 'AMOUREUX', 'NEUTRE',
    'DANSE', 'HOCHE', 'TOURNE_DROITE', 'TOURNE_GAUCHE', 'CENTRE',
    'VEILLE',
}

def _extraire_et_dispatcher_tags(texte):
    """Extrait les balises [TAG] du texte, les envoie a l'ESP32, retourne texte nettoye."""
    global _mode_continu
    tags = _TAG_RE.findall(texte)
    for tag in tags:
        if tag == 'VEILLE':
            # Sortir du mode continu si actif, puis declencher la veille
            if _mode_continu:
                _mode_continu = False
                notifier_esp32("continu_off")
            notifier_esp32("veille_init")
        elif tag in TAGS_VALIDES:
            notifier_esp32(f"corps_{tag.lower()}")
    return _TAG_RE.sub('', texte).strip()

# ============================================
# PERSISTANCE HISTORIQUE
# ============================================

def _charger_historique():
    """Charge l'historique depuis historique.json au demarrage."""
    global historique
    try:
        if os.path.exists(HISTORIQUE_FILE):
            with open(HISTORIQUE_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                historique = data[-MAX_HISTORIQUE:]
                print(f"[MEMOIRE] Historique charge : {len(historique)} echange(s) depuis {HISTORIQUE_FILE}", flush=True)
    except Exception as e:
        print(f"[MEMOIRE] Erreur chargement historique: {e}", flush=True)

def _sauvegarder_historique():
    """Sauvegarde l'historique sur disque (appele apres chaque echange)."""
    try:
        with open(HISTORIQUE_FILE, 'w', encoding='utf-8') as f:
            json.dump(historique, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[MEMOIRE] Erreur sauvegarde historique: {e}", flush=True)

def _ajouter_historique(user, assistant):
    """Ajoute un echange a l'historique, taille-le, et sauvegarde."""
    global historique
    historique.append({"user": user, "assistant": assistant})
    if len(historique) > MAX_HISTORIQUE:
        historique.pop(0)
    _sauvegarder_historique()

_charger_historique()  # Chargement au demarrage

# Mots d'actualite ambigus : annules si text contient un pronom personnel
_MOTS_ACTUALITE_AMBIGUS = {_sans_accents(m) for m in ["maintenant", "actuellement", "en ce moment"]}

# Formules de demande explicite de recherche web → priorite absolue sur toutes les regles
_MOTS_CHERCHER_EXPLICITE = [
    "recherche sur internet", "regarde sur internet",
    "cherche sur internet", "cherche sur le net",
    "regarde en ligne", "va voir sur internet",
    "googlee", "transgene",
]

def doit_chercher(texte):
    """
    Filtre ameliore : recherche WEB uniquement pour questions factuelles/actualite.
    Regles par priorite :
     -1. Demande explicite ("regarde sur internet", "transgene") → Oui
      0. "aujourd'hui" + pronom robot → Non (conversationnel)
      1. Mot d'actualite fort → Oui (sauf si ambigu + pronom = conversationnel)
      2. Trop court (<5 mots) → Non
      3. Formule personnelle connue → Non
      4. Pronom personnel → Non (conversationnel)
      5. Nom propre hors 1er mot, hors debut de nouvelle phrase → Oui
      6. Par defaut → Non
    """
    texte_lower = texte.lower().strip()
    texte_norm  = _sans_accents(texte_lower)
    mots = texte.split()
    texte_padded = ' ' + texte_norm + ' '

    # Regle -1 : demande explicite de recherche → priorite absolue
    for mot in _MOTS_CHERCHER_EXPLICITE:
        if _sans_accents(mot) in texte_norm:
            return True

    # Regle 0 : "aujourd'hui" + question sur le robot → conversationnel
    PRONOMS_ROBOT = ["t as", "tu as", "tu fais", "t'as", "tu es", "tu vas", "tu faisais"]
    if "aujourd" in texte_norm:
        for pr in PRONOMS_ROBOT:
            if _sans_accents(pr) in texte_norm:
                return False

    # Pre-calcul : y a-t-il un pronom personnel dans le texte ?
    has_pronom = any(_sans_accents(p) in texte_padded for p in MOTS_PERSO_SIMPLES)

    # Regle 1 : mot d'actualite detecte EN PRIORITE
    for mot in MOTS_ACTUALITE:
        mot_norm = _sans_accents(mot)
        if mot_norm in texte_norm:
            # Mot ambigu (ex: "maintenant") + pronom = opinion personnelle, pas factuelle
            if mot_norm in _MOTS_ACTUALITE_AMBIGUS and has_pronom:
                continue
            return True

    # Regle 2 : trop court
    if len(mots) < 5:
        return False

    # Regle 3 : formule personnelle connue
    for mot in MOTS_PERSO:
        if _sans_accents(mot) in texte_norm:
            return False

    # Regle 4 : pronoms personnels → conversationnel
    if has_pronom:
        return False

    # Regle 5 : nom propre hors 1er mot, pas en debut de nouvelle phrase
    noms_propres = []
    for idx_m, m in enumerate(mots[1:], 1):
        if m and m[0].isupper() and len(m) > 2:
            prev = mots[idx_m - 1]
            if not (prev and prev[-1] in '.!?'):
                noms_propres.append(m)
    if len(noms_propres) >= 1:
        return True

    # Par defaut : pas de recherche
    return False

# ============================================
# ROUTAGE INTELLIGENT DES MODELES
# ============================================

def choisir_modele(texte, web_actif):
    """
    Selectionne le modele optimal selon la complexite de la requete.

    PUISSANT (llama3.1:70b) :
      - Recherche web active → question factuelle complexe
      - Premier message de la conversation (historique vide)
      - Question longue (>10 mots) avec noms propres → analyse profonde

    RAPIDE (llama3.1) :
      - Question courte en cours de conversation (<=8 mots, historique>0)
      - Tout le reste conversationnel
    """
    global historique

    mots = texte.split()
    nb_mots = len(mots)

    # 1. Web actif → question factuelle → modele puissant
    if web_actif:
        return MODELE_PUISSANT, "puissant", "web=oui"

    # 2. Premier message → pas d'historique → modele puissant pour bien demarrer
    if len(historique) == 0:
        return MODELE_PUISSANT, "puissant", "premier message"

    # 3. Suite courte de conversation → modele rapide
    if len(historique) > 0 and nb_mots <= 8:
        return MODELE_RAPIDE, "rapide", f"conversation ({nb_mots} mots)"

    # 4. Question longue avec noms propres → modele puissant
    noms_propres = [m for m in mots[1:] if m and m[0].isupper() and len(m) > 2]
    if nb_mots > 10 and len(noms_propres) >= 1:
        return MODELE_PUISSANT, "puissant", f"question complexe ({nb_mots} mots, {len(noms_propres)} noms propres)"

    # 5. Par defaut : rapide (conversationnel)
    return MODELE_RAPIDE, "rapide", "defaut"

# ============================================
# VERIFICATION MODELE OLLAMA
# ============================================

def _check_ollama_model():
    """
    Verifie la disponibilite des deux modeles de routage.
    MODELE_RAPIDE   (llama3.2:latest) : toujours present, pas de test (suppose OK)
    MODELE_PUISSANT (qwen2.5:14b)    : verifie presence dans la liste des tags Ollama
    Log le statut sans bloquer le demarrage — le routage se fera dynamiquement.
    """
    global MODELE_OLLAMA
    try:
        result = req.get("http://localhost:11434/api/tags", timeout=5)
        models_dispo = [m['name'] for m in result.json().get('models', [])]
        rapide_ok   = any(MODELE_RAPIDE   in m for m in models_dispo)
        puissant_ok = any(MODELE_PUISSANT in m for m in models_dispo)
        print(f"[OLLAMA] Modeles disponibles : {models_dispo}", flush=True)
        print(f"[OLLAMA] {MODELE_RAPIDE} : {'OK' if rapide_ok else 'ABSENT'}", flush=True)
        print(f"[OLLAMA] {MODELE_PUISSANT} : {'OK' if puissant_ok else 'ABSENT'}", flush=True)
        if not puissant_ok:
            print(f"[OLLAMA] {MODELE_PUISSANT} absent — pull en arriere-plan...", flush=True)
            subprocess.Popen(
                ["ollama", "pull", MODELE_PUISSANT],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        MODELE_OLLAMA = MODELE_RAPIDE if rapide_ok else MODELE_OLLAMA_FALLBACK
    except Exception as e:
        MODELE_OLLAMA = MODELE_OLLAMA_FALLBACK
        print(f"[OLLAMA] Impossible de verifier ({e}) — fallback : {MODELE_OLLAMA}", flush=True)

_check_ollama_model()

# ============================================
# CHARGEMENT MODELES
# ============================================

print("Chargement Whisper large-v3...", flush=True)
modele_whisper = whisper.load_model(MODELE_WHISPER)
print(f"Whisper {MODELE_WHISPER} pret !", flush=True)

print("Chargement Whisper tiny (wake word)...", flush=True)
modele_whisper_tiny = whisper.load_model("tiny")
print("Whisper tiny pret !", flush=True)

print("Chargement Piper...", flush=True)
voix_piper = PiperVoice.load(MODELE_VOIX)
print(f"Piper pret ! Sample rate : {voix_piper.config.sample_rate}", flush=True)

# ============================================
# FONCTIONS AUDIO
# ============================================

def ecouter_micro():
    """Enregistrement fixe (DUREE_ECOUTE secondes). Appeler avec micro_lock acquis."""
    print(f"Ecoute {DUREE_ECOUTE} secondes...", flush=True)
    audio = sd.rec(
        int(DUREE_ECOUTE * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype='float32',
        device=DEVICE_MICRO
    )
    sd.wait()
    print("Enregistrement termine !", flush=True)
    return audio.flatten()

_WHISPER_PROMPT = "Conversation en français avec un robot. Questions courtes et claires."

def transcrire(audio):
    """Transcription Whisper base."""
    print("Transcription...", flush=True)
    resultat = modele_whisper.transcribe(audio, language="fr", fp16=False,
                                         initial_prompt=_WHISPER_PROMPT)
    texte = resultat["text"].strip()
    print(f"Tu as dit : {texte}", flush=True)
    return texte

def resample_to_16k(audio, orig_sr):
    """Reechantillonnage lineaire vers 16000 Hz pour Whisper."""
    if orig_sr == SAMPLE_RATE:
        return audio
    n_new = int(len(audio) * SAMPLE_RATE / orig_sr)
    return np.interp(
        np.linspace(0, len(audio) - 1, n_new),
        np.arange(len(audio)),
        audio
    ).astype(np.float32)

def normaliser_audio(audio, target_rms=0.05):
    """Amplifie l'audio vers un niveau cible pour Whisper (max gain=20)."""
    rms = float(np.sqrt(np.mean(audio ** 2)))
    if rms < 1e-8:
        return audio
    gain = min(target_rms / rms, 20.0)
    return (audio * gain).astype(np.float32)

def enregistrer_avec_vad():
    """
    Enregistre jusqu'a detection de silence (VAD RMS numpy) ou timeout.
    Enregistre a SAMPLE_RATE_WW (44100Hz natif) puis resample -> 16kHz.
    Doit etre appele avec micro_lock DEJA ACQUIS.
    """
    chunk_size = int(VAD_CHUNK_DUREE * SAMPLE_RATE_WW)  # 0.2s * 44100 = 8820 samples
    max_chunks = int(VAD_MAX_DUREE / VAD_CHUNK_DUREE)
    silent_chunks_needed = int(VAD_SILENCE_DUREE / VAD_CHUNK_DUREE)
    silent_chunks = 0
    speech_started = False
    all_chunks = []

    print("[WW] Ecoute question (VAD actif, 44100Hz, silence=1.5s, max=15s)...", flush=True)
    for i in range(max_chunks):
        chunk = sd.rec(chunk_size, samplerate=SAMPLE_RATE_WW, channels=1,
                       dtype='float32', device=DEVICE_MICRO_WW)
        sd.wait()
        flat = chunk.flatten()
        all_chunks.append(flat)

        rms = float(np.sqrt(np.mean(flat ** 2)))

        if rms > WW_RMS_MIN:
            speech_started = True
            silent_chunks = 0
        elif speech_started:
            silent_chunks += 1
            if silent_chunks >= silent_chunks_needed:
                total = round(len(all_chunks) * VAD_CHUNK_DUREE, 1)
                print(f"[WW] Fin de parole detectee ({total}s)", flush=True)
                break

    if not all_chunks:
        return np.zeros(SAMPLE_RATE, dtype=np.float32)
    audio_raw = np.concatenate(all_chunks)
    return resample_to_16k(audio_raw, SAMPLE_RATE_WW)

def jouer_bips():
    """2 bips de confirmation sur le haut-parleur device DEVICE_HP."""
    sr_bip = 22050
    freq   = 880
    dur    = 0.12
    t   = np.linspace(0, dur, int(dur * sr_bip), endpoint=False)
    bip = (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    silence_court = np.zeros(int(0.08 * sr_bip), dtype=np.float32)
    audio_bips = np.concatenate([bip, silence_court, bip])
    sd.play(audio_bips, samplerate=sr_bip, device=DEVICE_HP)
    sd.wait()

def texte_vers_audio(texte):
    """Synthese vocale Piper → BytesIO WAV."""
    print("Synthese vocale...", flush=True)
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(voix_piper.config.sample_rate)
        voix_piper.synthesize_wav(texte, w)
    buffer.seek(0)
    return buffer

def texte_vers_numpy(texte):
    """Synthese vocale Piper → numpy float32 pour lecture via sounddevice."""
    buf = texte_vers_audio(texte)
    buf.seek(0)
    with wave.open(buf, 'rb') as wf:
        frames = wf.readframes(wf.getnframes())
    audio_np = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    return audio_np

# ============================================
# RECHERCHE WEB
# ============================================

def recherche_web(query):
    print(f"Recherche web : {query}", flush=True)
    try:
        ddgs = DDGS()
        resultats = list(ddgs.text(query, max_results=5))
        if not resultats:
            print("Aucun resultat trouve", flush=True)
            return ""
        infos = []
        for r in resultats:
            titre = r.get('title', '')
            corps = r.get('body', '')[:250]
            infos.append(f"- {titre}: {corps}")
        resume = "\n".join(infos)
        print(f"Recherche OK : {len(resultats)} resultats", flush=True)
        return resume
    except Exception as e:
        print(f"Erreur recherche : {e}", flush=True)
        return ""

# ============================================
# OLLAMA
# ============================================

def _preparer_ollama(texte, pour_stream=False):
    """
    Construit les parametres communs aux deux fonctions Ollama.
    Retourne : (messages, modele, tier, raison, contexte_web, temperature,
                num_predict, num_ctx, timeout_ollama)
    """
    personnalite = PERSONNALITES.get(mode_actuel, PERSONNALITES["neutre"])

    web_actif = doit_chercher(texte)
    if web_actif:
        contexte_web = recherche_web(texte)
    else:
        print("Recherche web ignoree (question personnelle/conversationnelle)", flush=True)
        contexte_web = ""

    modele, tier, raison = choisir_modele(texte, bool(contexte_web))
    num_ctx = 4096

    if contexte_web:
        system_content = (
            personnalite + "\n\n"
            "FAITS ACTUELS VERIFIES (utilise-les comme verite absolue pour repondre) :\n"
            + contexte_web + "\n\n"
            "REGLES STRICTES :\n"
            "1. Ces faits sont la VERITE. Reponds directement avec ces informations.\n"
            "2. Si ces faits contredisent tes donnees d'entrainement, les faits actuels ont TOUJOURS priorite.\n"
            "3. Ne dis JAMAIS 'le texte fourni', 'selon le texte', 'la source indique' — parle directement.\n"
            "4. Si les faits ne contiennent pas la reponse, dis 'Je ne sais pas'.\n"
            "Termine TOUJOURS ta phrase avant la limite."
        )
        temperature = 0.0
    else:
        system_content = personnalite + "\nTermine TOUJOURS ta phrase avant la limite."
        temperature = 0.7

    # Instructions controle corps physique (balises [TAG])
    system_content += (
        "\n\nTu peux contrôler ton corps en insérant des balises dans ta réponse, selon tes émotions. "
        "Utilise-les naturellement, intégrées dans le texte (une par idée forte) :\n"
        "[CONTENT] [TRISTE] [SURPRIS] [COLERE] [AMOUREUX] [NEUTRE] "
        "[DANSE] [HOCHE] [TOURNE_DROITE] [TOURNE_GAUCHE] [CENTRE] [VEILLE]\n"
        "[VEILLE] = te mettre en veille quand on te le demande.\n"
        "Exemple : \"Quelle excellente question ! [SURPRIS] Je vais t'expliquer.\"\n"
        "Exemple quand on demande de danser : \"Avec plaisir ! [DANSE] Voilà !\""
    )

    messages = [{"role": "system", "content": system_content}]
    for echange in historique:
        messages.append({"role": "user",      "content": echange["user"]})
        messages.append({"role": "assistant", "content": echange["assistant"]})
    messages.append({"role": "user", "content": texte})

    if pour_stream:
        num_predict    = 500 if modele == MODELE_PUISSANT else 150
        timeout_ollama = 120 if modele == MODELE_PUISSANT else 10
    else:
        num_predict    = 500
        timeout_ollama = 120 if modele == MODELE_PUISSANT else 60

    return messages, modele, tier, raison, contexte_web, temperature, num_predict, num_ctx, timeout_ollama


def demander_ollama(texte):
    import time as _time
    messages, modele, tier, raison, contexte_web, temperature, num_predict, num_ctx, timeout_ollama = \
        _preparer_ollama(texte, pour_stream=False)

    payload = {
        "model":    modele,
        "messages": messages,
        "stream":   False,
        "options":  {"temperature": temperature, "top_p": 0.9,
                     "num_predict": num_predict, "num_ctx": num_ctx},
    }

    print(f"[DEBUG] modele={modele} ({tier}) | raison={raison} | web={'oui' if contexte_web else 'non'} | historique={len(historique)} | num_ctx={num_ctx} | timeout={timeout_ollama}s", flush=True)
    t0 = _time.time()

    try:
        print("Ollama reflechit...", flush=True)
        reponse = req.post(OLLAMA_CHAT_URL, json=payload, timeout=timeout_ollama)

        print(f"[DEBUG] Ollama HTTP {reponse.status_code}", flush=True)
        data = reponse.json()
        print(f"[DEBUG] JSON cles={list(data.keys())} | done_reason={data.get('done_reason')} | done={data.get('done')}", flush=True)

        if "error" in data:
            print(f"[ERREUR OLLAMA] {data['error']}", flush=True)
            return f"Erreur moteur : {data['error'][:80]}"

        texte_reponse = data.get("message", {}).get("content", "").strip()
        print(f"[DEBUG] content brut (100 premiers chars) : {repr(texte_reponse[:100])}", flush=True)

        texte_reponse = re.sub(r'\*{1,2}([^*]+)\*{1,2}', r'\1', texte_reponse).strip()
        texte_reponse = texte_reponse.replace("ARIA:", "").strip()

        if not texte_reponse:
            print(f"[ERREUR] Content vide ! JSON complet : {data}", flush=True)
            texte_reponse = "Je n'ai pas pu generer de reponse."

        elapsed = _time.time() - t0
        print(f"[DEBUG] Temps Ollama : {elapsed:.1f}s ({modele} {tier})", flush=True)
        print(f"Reponse : {texte_reponse}", flush=True)

        _ajouter_historique(texte, texte_reponse)
        return texte_reponse

    except req.exceptions.Timeout:
        print(f"[ERREUR] Timeout Ollama apres {timeout_ollama}s", flush=True)
        return "Desole, le moteur IA a mis trop de temps a repondre !"
    except Exception as e:
        print(f"[ERREUR] Ollama exception : {type(e).__name__} : {e}", flush=True)
        return "Desole, probleme technique !"

# ============================================
# BOUCLE WAKE WORD (InputStream callback)
# ============================================

# File audio entre callback PortAudio et thread de traitement
_ww_queue       = _queue.Queue(maxsize=5)
_WW_BLOCKSIZE   = 2048   # Petit blocksize MME-compatible (MME refuse > 4096)
_WW_CHUNK_TOTAL = int(WW_CHUNK_DUREE * SAMPLE_RATE_WW)  # 66150 frames = 1.5s

# Accumulateur local au callback (liste mutable partagee par closure)
_ww_accum       = []
_ww_accum_count = [0]  # compteur de frames accumules

def _ww_callback(indata, frames, time_info, status):
    """
    Callback PortAudio avec petit blocksize (2048) compatible MME Windows.
    Accumule les blocs jusqu'a atteindre WW_CHUNK_DUREE secondes.
    """
    _ww_accum.append(indata.copy())
    _ww_accum_count[0] += frames
    if _ww_accum_count[0] >= _WW_CHUNK_TOTAL:
        full = np.concatenate(_ww_accum)[:_WW_CHUNK_TOTAL]
        _ww_accum.clear()
        _ww_accum_count[0] = 0
        try:
            _ww_queue.put_nowait(full.flatten())
        except _queue.Full:
            pass  # Queue pleine : on saute ce chunk

def notifier_esp32_sync(evenement):
    """
    Envoie un evenement a l'ESP32 de facon BLOQUANTE (attend la reponse HTTP).
    A utiliser pour les evenements critiques dont l'ordre doit etre garanti,
    notamment "parle" qui doit arriver AVANT la connexion TCP audio.
    """
    # Mettre à jour l'état web (même logique que notifier_esp32)
    if evenement in ('repos', 'ecoute', 'reflechit', 'parle'):
        _web_set_etat(evenement)
    global esp32_ip
    try:
        req.post(
            f"http://{esp32_ip}/evenement",
            json={"evenement": evenement},
            timeout=1.0
        )
    except Exception:
        pass

def notifier_esp32(evenement):
    """Envoie un evenement a l'ESP32 de facon non-bloquante (thread + timeout 500ms)."""
    # Mettre à jour l'état web (polling)
    global _web_mode_continu
    ETATS_WEB = {'repos', 'ecoute', 'reflechit', 'parle', 'veille_init',
                 'continu_on', 'continu_off'}
    if evenement in ETATS_WEB:
        etat_web = 'repos' if evenement in ('veille_init', 'continu_off') else evenement
        if etat_web in ('repos', 'ecoute', 'reflechit', 'parle'):
            _web_set_etat(etat_web)
    if evenement == 'continu_on':
        _web_mode_continu = True
        _broadcast_sse('mode_continu', {'actif': True})
    elif evenement == 'continu_off':
        _web_mode_continu = False
        _broadcast_sse('mode_continu', {'actif': False})
    # SSE (compatibilité)
    if evenement in ETATS_WEB:
        etat_sse = 'repos' if evenement in ('veille_init', 'continu_off') else evenement
        _broadcast_sse('status', {'etat': etat_sse})

    def _envoyer():
        global esp32_ip
        try:
            req.post(
                f"http://{esp32_ip}/evenement",
                json={"evenement": evenement},
                timeout=0.5
            )
        except Exception:
            pass  # ESP32 absent ou lent -> ignorer silencieusement
    threading.Thread(target=_envoyer, daemon=True).start()

def notifier_esp32_audio(wav_bytes):
    """
    Envoie WAV a l'ESP32 via socket TCP raw sur port 8080.
    Envoie par chunks de 4096 octets et verifie _audio_interrupt entre chaque chunk.
    Si _audio_interrupt est mis a True : ferme le socket immediatement.
    L'ESP32 detecte la deconnexion dans jouerAudioStreaming() et arrete le I2S.

    Protocole :
      -> 4 octets little-endian : taille totale du WAV
      -> N octets : contenu WAV (envoye par blocs de 4096)
      <- 1 octet : 'K' (lecture complete) ou absent (interruption)
    """
    global esp32_ip
    _audio_interrupt.clear()
    _audio_en_lecture.set()   # signal : l'ESP32 est en train de jouer → seuil RMS eleve
    taille = len(wav_bytes)
    CHUNK = 4096
    try:
        s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
        s.settimeout(30.0)
        s.connect((esp32_ip, 8080))
        s.sendall(taille.to_bytes(4, byteorder='little'))

        envoye = 0
        while envoye < taille:
            if _audio_interrupt.is_set():
                print(f"[WW] Audio interrompu apres {envoye}/{taille} octets", flush=True)
                s.close()
                _audio_en_lecture.clear()
                return
            fin = min(envoye + CHUNK, taille)
            s.sendall(wav_bytes[envoye:fin])
            envoye = fin

        rep = s.recv(4)
        s.close()
        print(f"[WW] Audio joue sur ESP32 ({taille} o, rep={rep})", flush=True)
    except Exception as e:
        print(f"[WW] Erreur envoi audio ESP32 (port 8080) : {e}", flush=True)
    finally:
        _audio_en_lecture.clear()  # lecture terminee (ou erreur)


def _lancer_ecoute_interruption():
    """
    Thread de detection d'interruption.

    Deux modes d'interruption :
      1. VOIX SOUTENUE : si l'utilisateur parle pendant >= 450ms → stop immediat
         (pas besoin de dire un mot specifique — parler suffit)
      2. MOT STOP : si Whisper detecte stop/arrete/silence/... → stop immediat

    Utilise DEVICE_MICRO_WW (device 1, Voicemod 16kHz natif) qui est libre
    pendant la reponse (le stream wake word est arrete).
    Seuil RMS abaisse a 0.025 pendant lecture audio (plus sensible que 0.04).
    """
    MOTS_STOP_NORM = [
        'stop', 'arrete', 'tais', 'silence', 'neo', 'chut', 'assez', 'ok stop'
    ]
    POLL_S             = 0.05
    MIN_AUDIO_S        = 0.30
    MAX_AUDIO_S        = 0.65
    VOICE_INTERRUPT_S  = 0.45   # 450ms de voix continue = interrompre sans stop word
    FRAMES_MIN         = int(MIN_AUDIO_S       * SAMPLE_RATE_WW)
    FRAMES_MAX         = int(MAX_AUDIO_S       * SAMPLE_RATE_WW)
    FRAMES_OVERLAP     = int(0.05              * SAMPLE_RATE_WW)
    RMS_VOICE          = 0.02

    _interrupt_thread_stop.clear()

    def _ecouter_continu():
        try:
            import ctypes
            ctypes.windll.kernel32.SetThreadPriority(
                ctypes.windll.kernel32.GetCurrentThread(), 2
            )
        except Exception:
            pass

        accum       = []
        accum_n     = [0]
        en_parole   = [False]
        voice_debut = [None]   # timestamp debut voix continue

        def cb(indata, frames, time_info, status):
            accum.append(indata.copy())
            accum_n[0] += frames

        try:
            stream_int = sd.InputStream(
                samplerate=SAMPLE_RATE_WW, channels=1, dtype='float32',
                device=DEVICE_MICRO_WW, blocksize=512, callback=cb
            )
            stream_int.start()
            print("[INTERRUPT] Thread demarre (device WW).", flush=True)
        except Exception as e:
            print(f"[INTERRUPT] Erreur ouverture micro WW: {e}", flush=True)
            return

        try:
            while not _audio_interrupt.is_set() and not _interrupt_thread_stop.is_set():
                time.sleep(POLL_S)

                if _ecoute_question:
                    accum.clear()
                    accum_n[0] = 0
                    en_parole[0] = False
                    voice_debut[0] = None
                    continue

                if not accum or accum_n[0] == 0:
                    continue

                bloc_all = np.concatenate(accum).flatten()
                chunk_n  = min(accum_n[0], int(0.1 * SAMPLE_RATE_WW))
                rms      = float(np.sqrt(np.mean(bloc_all[-chunk_n:] ** 2)))

                # Seuil pendant lecture audio : plus bas qu'avant (0.025 vs 0.04)
                rms_seuil = 0.025 if _audio_en_lecture.is_set() else RMS_VOICE

                if rms >= rms_seuil:
                    en_parole[0] = True
                    if voice_debut[0] is None:
                        voice_debut[0] = time.time()
                    # Interruption par voix soutenue (parler suffit)
                    elif time.time() - voice_debut[0] >= VOICE_INTERRUPT_S:
                        print(f"[INTERRUPT] >>> VOIX SOUTENUE {time.time()-voice_debut[0]:.2f}s — interruption <<<", flush=True)
                        _audio_interrupt.set()
                        return
                else:
                    voice_debut[0] = None  # remise a zero si silence

                # CAS 1 : voix detectee + buffer assez long → transcription stop word
                if en_parole[0] and accum_n[0] >= FRAMES_MIN:
                    bloc = bloc_all[:FRAMES_MAX]
                    slab = bloc_all[-FRAMES_OVERLAP:].reshape(-1, 1)
                    accum[:] = [slab]
                    accum_n[0] = FRAMES_OVERLAP
                    en_parole[0] = False

                    try:
                        result = modele_whisper_tiny.transcribe(
                            bloc, language="fr", fp16=False,
                            no_speech_threshold=0.4,
                            condition_on_previous_text=False,
                            initial_prompt="stop arrête tais-toi silence chut assez"
                        )
                        texte = _sans_accents(result.get("text", "").strip().lower())
                        if texte:
                            print(f"[INTERRUPT] '{texte}' (RMS={rms:.4f})", flush=True)
                        for mot in MOTS_STOP_NORM:
                            if mot in texte:
                                print(f"[INTERRUPT] >>> STOP detecte ('{mot}') <<<", flush=True)
                                _audio_interrupt.set()
                                return
                    except Exception:
                        pass

                # CAS 2 : buffer plein sans voix → purger
                elif accum_n[0] >= FRAMES_MAX and not en_parole[0]:
                    slab = bloc_all[-FRAMES_OVERLAP:].reshape(-1, 1)
                    accum[:] = [slab]
                    accum_n[0] = FRAMES_OVERLAP

        finally:
            try:
                stream_int.stop()
                stream_int.close()
            except Exception:
                pass
            print("[INTERRUPT] Thread arrete.", flush=True)

    threading.Thread(target=_ecouter_continu, daemon=True).start()


def demander_ollama_stream(texte):
    """
    Version streaming de demander_ollama.
    Yields chaque phrase complete au fur et a mesure de la generation Ollama.
    Ne sauvegarde PAS dans historique (la boucle_wake_word s'en charge).

    Decoupe sur : '. ' '! ' '? ' + fins de ligne equivalentes.
    """
    import time as _time
    messages, modele, tier, raison, contexte_web, temperature, num_predict, num_ctx, timeout_ollama = \
        _preparer_ollama(texte, pour_stream=True)

    payload = {
        "model":    modele,
        "messages": messages,
        "stream":   True,
        "options":  {"temperature": temperature, "top_p": 0.9, "num_predict": num_predict, "num_ctx": num_ctx},
    }

    print(f"[STREAM] modele={modele} ({tier}) | raison={raison} | web={'oui' if contexte_web else 'non'}", flush=True)
    t0 = _time.time()
    FINS = ['. ', '! ', '? ', '.\n', '!\n', '?\n']

    try:
        resp = req.post(OLLAMA_CHAT_URL, json=payload, stream=True, timeout=timeout_ollama)
        tampon = ""

        for line in resp.iter_lines():
            if not line:
                continue
            try:
                data = json.loads(line)
            except Exception:
                continue

            if "error" in data:
                print(f"[STREAM] Erreur Ollama: {data['error']}", flush=True)
                yield "Erreur moteur IA."
                return

            token = data.get("message", {}).get("content", "")
            tampon += token

            # Detecter fin de phrase
            for fin in FINS:
                if fin in tampon:
                    parties = tampon.split(fin, 1)
                    phrase = parties[0] + fin[0]
                    tampon  = parties[1]
                    phrase  = re.sub(r'\*{1,2}([^*]+)\*{1,2}', r'\1', phrase).strip()
                    phrase  = phrase.replace("ARIA:", "").strip()
                    if len(phrase) > 3:
                        print(f"[STREAM] Phrase prete ({_time.time()-t0:.1f}s): {phrase}", flush=True)
                        yield phrase
                    break

            if data.get("done", False):
                if tampon.strip():
                    reste = re.sub(r'\*{1,2}([^*]+)\*{1,2}', r'\1', tampon).strip()
                    reste = reste.replace("ARIA:", "").strip()
                    if len(reste) > 3:
                        yield reste
                print(f"[STREAM] Generation terminee en {_time.time()-t0:.1f}s", flush=True)
                return

    except req.exceptions.Timeout:
        print(f"[STREAM] Timeout Ollama ({timeout_ollama}s)", flush=True)
        yield "Desole, le moteur IA a mis trop de temps a repondre."
    except Exception as e:
        print(f"[STREAM] Erreur: {type(e).__name__}: {e}", flush=True)
        yield "Desole, probleme technique."


def boucle_wake_word():
    """
    Thread daemon : InputStream continu (blocksize=2048, compatible MME)
    → accumulation → queue → traitement 'neo'.
    """
    global wake_word_en_ecoute, _mode_continu, _dernier_echange_continu

    print(f"[WW] Ouverture InputStream device={DEVICE_MICRO_WW} @ {SAMPLE_RATE_WW}Hz blocksize={_WW_BLOCKSIZE}", flush=True)
    try:
        stream = sd.InputStream(
            samplerate=SAMPLE_RATE_WW,
            channels=1,
            dtype='float32',
            device=DEVICE_MICRO_WW,
            blocksize=_WW_BLOCKSIZE,
            callback=_ww_callback
        )
        stream.start()
        print(f"[WW] InputStream ouvert — chunk={_WW_CHUNK_TOTAL//44100:.1f}s via {_WW_CHUNK_TOTAL//_WW_BLOCKSIZE} blocs x {_WW_BLOCKSIZE}", flush=True)
    except Exception as e:
        print(f"[WW] ERREUR ouverture InputStream: {e}", flush=True)
        return

    try:
        while True:
            # --- Pause si desactive ---
            if not wake_word_actif:
                time.sleep(0.3)
                continue

            # --- Relance apres silence prolonge (mode normal uniquement) ---
            global _temps_derniere_interaction
            if (not _mode_continu
                    and len(historique) > 0
                    and _temps_derniere_interaction > 0
                    and time.time() - _temps_derniere_interaction > _DELAI_RELANCE):
                _temps_derniere_interaction = 0.0
                phrase_relance = random.choice(PHRASES_RELANCE)
                print(f"[WW] Relance apres {_DELAI_RELANCE}s de silence : {phrase_relance}", flush=True)
                stream.stop()
                try:
                    audio_rel = texte_vers_audio(phrase_relance)
                    notifier_esp32_sync("parle")  # synchrone : garanti avant le TCP audio
                    notifier_esp32_audio(audio_rel.getvalue())
                    notifier_esp32("repos")
                    _ajouter_historique("[silence]", phrase_relance)
                    _temps_derniere_interaction = time.time()
                except Exception as e:
                    print(f"[WW] Erreur relance: {e}", flush=True)
                stream.start()
                continue

            # --- Mode conversation continue : bypass detection wake word ---
            _mode_continu_actif_ce_tour = False
            if _mode_continu:
                if (_dernier_echange_continu > 0
                        and time.time() - _dernier_echange_continu > _MODE_CONTINU_TIMEOUT):
                    _mode_continu = False
                    notifier_esp32("continu_off")
                    notifier_esp32("repos")
                    print("[WW] Mode continu : timeout 15s — retour mode normal", flush=True)
                else:
                    print("[WW] Mode continu — ecoute directe", flush=True)
                    _mode_continu_actif_ce_tour = True
                    wake_word_en_ecoute = True
                    notifier_esp32("ecoute")
                    stream.stop()
                    while not _ww_queue.empty():
                        try: _ww_queue.get_nowait()
                        except: pass

            if not _mode_continu_actif_ce_tour:
                # --- Attendre un chunk (1.5s) du callback ---
                try:
                    audio_chunk = _ww_queue.get(timeout=2.0)
                except _queue.Empty:
                    continue

                audio_flat = audio_chunk.flatten()
                rms = float(np.sqrt(np.mean(audio_flat ** 2)))

                # --- Pre-filtre silence ---
                if rms < WW_RMS_MIN:
                    print(f"[WW] Silence RMS={rms:.6f} — skip", flush=True)
                    continue

                print(f"[WW] Fenetre {WW_CHUNK_DUREE}s | RMS={rms:.6f} | transcription...", flush=True)

                # --- Resample 44100 -> 16000 Hz + normalisation ---
                audio_16k = resample_to_16k(audio_flat, SAMPLE_RATE_WW)
                audio_16k = normaliser_audio(audio_16k, target_rms=0.05)

                # --- Transcription Whisper tiny ---
                try:
                    result_ww = modele_whisper_tiny.transcribe(
                        audio_16k,
                        language="en",
                        fp16=False,
                        no_speech_threshold=0.3,
                        condition_on_previous_text=False
                    )
                    texte_ww = result_ww.get("text", "").strip().lower()
                except Exception as e:
                    print(f"[WW] Erreur transcription: {e}", flush=True)
                    continue

                print(f"[WW] Whisper tiny: '{texte_ww}' | RMS={rms:.6f}", flush=True)

                # --- Detection wake word ---
                texte_ww_norm = re.sub(r'[^\w\s]', '', texte_ww).strip()
                mots_transcrits = texte_ww_norm.split()

                wake_detecte = False
                for wl in WW_MOTS_LONGS:
                    if wl in texte_ww_norm:
                        wake_detecte = True
                        break
                if not wake_detecte and len(mots_transcrits) <= 2:
                    for mot in mots_transcrits:
                        if mot in WW_MOTS_SEULS:
                            wake_detecte = True
                            break

                if not wake_detecte:
                    continue

                # === WAKE WORD DETECTE ===
                print("[WW] >>> WAKE WORD 'neo' DETECTE ! <<<", flush=True)
                wake_word_en_ecoute = True
                notifier_esp32("ecoute")

                # Stopper le stream pendant le traitement (evite feedback micro)
                stream.stop()
                while not _ww_queue.empty():
                    try: _ww_queue.get_nowait()
                    except: pass

                # --- 1. Bips de confirmation ---
                try:
                    jouer_bips()
                except Exception as e:
                    print(f"[WW] Erreur bips: {e}", flush=True)

            # --- 2. Enregistrer la question via VAD ---
            # Signaler au thread d'interruption de se taire pendant l'ecoute
            global _ecoute_question
            _ecoute_question = True
            acquired_q = micro_lock.acquire(timeout=3.0)
            if acquired_q:
                try:
                    audio_question = enregistrer_avec_vad()
                except Exception as e:
                    print(f"[WW] Erreur enregistrement question: {e}", flush=True)
                    audio_question = np.zeros(SAMPLE_RATE, dtype=np.float32)
                finally:
                    micro_lock.release()
            else:
                print("[WW] Impossible d'acquerir micro pour question", flush=True)
                audio_question = np.zeros(SAMPLE_RATE, dtype=np.float32)
            _ecoute_question = False

            # --- 3. Transcription question Whisper base ---
            try:
                result_q = modele_whisper.transcribe(audio_question, language="fr", fp16=False,
                                                     initial_prompt=_WHISPER_PROMPT)
                texte_question = result_q.get("text", "").strip()
                print(f"[WW] Question : '{texte_question}'", flush=True)
                if texte_question:
                    _broadcast_sse('question', {'texte': texte_question})
                    _web_add_message('user', texte_question)
            except Exception as e:
                print(f"[WW] Erreur transcription question: {e}", flush=True)
                texte_question = ""

            # --- 4. Ollama streaming + TTS phrase par phrase ---
            if len(texte_question) >= 2:
                notifier_esp32("reflechit")
                phrases_jouees = []
                interrompu = False
                try:
                    _lancer_ecoute_interruption()  # Thread continu pour toute la reponse

                    # Pipeline TTS asynchrone :
                    # _feeder  : lit le generateur Ollama → pousse phrases dans _phrases_q
                    # _synth   : tire phrases → Piper → pousse audio dans _audio_q
                    # main     : tire audio → ESP32, pendant que _synth prepare la suivante
                    # Gain : Piper phrase N+1 se synthetise pendant que l'ESP32 joue phrase N
                    _phrases_q = _queue.Queue()
                    _audio_q   = _queue.Queue(maxsize=2)

                    def _feeder():
                        try:
                            for _p in demander_ollama_stream(texte_question):
                                if _audio_interrupt.is_set():
                                    break
                                _p = _extraire_et_dispatcher_tags(_p)
                                if _p:  # ne pas envoyer phrase vide apres nettoyage des balises
                                    _broadcast_sse('reponse_chunk', {'chunk': _p})
                                    _web_append_partial(_p + ' ')
                                    _phrases_q.put(_p)
                        except Exception as _fe:
                            print(f"[FEEDER] Erreur: {_fe}", flush=True)
                        finally:
                            _broadcast_sse('reponse_fin', {})
                            _phrases_q.put(None)  # sentinelle fin de stream

                    def _synth():
                        try:
                            while True:
                                _item = _phrases_q.get()
                                if _item is None:
                                    return
                                if _audio_interrupt.is_set():
                                    return
                                try:
                                    _buf = texte_vers_audio(_item)
                                    _audio_q.put((_item, _buf.getvalue()))
                                except Exception as _se:
                                    print(f"[TTS] Erreur synthese: {_se}", flush=True)
                        finally:
                            _audio_q.put(None)  # sentinelle : toujours signalee

                    threading.Thread(target=_feeder, daemon=True).start()
                    threading.Thread(target=_synth,  daemon=True).start()

                    while True:
                        try:
                            _audio_item = _audio_q.get(timeout=2.0)
                        except _queue.Empty:
                            # timeout : verifier interruption, continuer si non
                            if _audio_interrupt.is_set():
                                _audio_interrupt.clear()
                                interrompu = True
                                break
                            continue
                        if _audio_item is None:
                            break  # sentinelle : plus rien a jouer
                        if _audio_interrupt.is_set():
                            _audio_interrupt.clear()
                            interrompu = True
                            break
                        _phrase_a_jouer, _audio_bytes = _audio_item
                        try:
                            if not phrases_jouees:
                                notifier_esp32_sync("parle")  # SYNCHRONE avant 1er audio
                            notifier_esp32_audio(_audio_bytes)
                            phrases_jouees.append(_phrase_a_jouer)
                        except Exception as _pe:
                            print(f"[WW] Erreur envoi phrase: {_pe}", flush=True)
                        if _audio_interrupt.is_set():
                            _audio_interrupt.clear()
                            interrompu = True
                            break

                    # Grace period : garder le thread actif 1.5s apres la derniere phrase
                    _grace_deadline = time.time() + 1.5
                    while time.time() < _grace_deadline:
                        if _audio_interrupt.is_set():
                            _audio_interrupt.clear()
                            interrompu = True
                            print("[WW] Stop detecte pendant grace period.", flush=True)
                            break
                        time.sleep(0.05)
                    # Arreter le thread d'interruption
                    _interrupt_thread_stop.set()
                    # Delai apres interruption : evite que "stop" soit capte par le wake word
                    if interrompu:
                        time.sleep(0.5)
                    # Pause courte en mode continu pour laisser le temps a l'ESP32
                    if _mode_continu:
                        time.sleep(0.5)
                    # Sauvegarder dans historique ce qui a ete effectivement joue
                    if phrases_jouees:
                        reponse_complete = " ".join(phrases_jouees)
                        _ajouter_historique(texte_question, reponse_complete)
                        _web_add_message('aria', reponse_complete)
                    _temps_derniere_interaction = time.time()
                    if _mode_continu:
                        _dernier_echange_continu = time.time()
                    print(f"[WW] {len(phrases_jouees)} phrase(s) jouee(s){'  [interrompu]' if interrompu else ''}.", flush=True)
                except Exception as e:
                    print(f"[WW] Erreur pipeline streaming: {e}", flush=True)
            else:
                print("[WW] Question vide, retour en ecoute.", flush=True)

            notifier_esp32("repos")
            wake_word_en_ecoute = False

            # Reprendre l'ecoute
            try:
                stream.start()
                print("[WW] InputStream repris.", flush=True)
            except Exception as e:
                print(f"[WW] ERREUR redemarrage stream: {e}", flush=True)
                break

    except Exception as e:
        print(f"[WW] Erreur fatale thread: {e}", flush=True)
    finally:
        try:
            stream.close()
        except Exception:
            pass
        print("[WW] InputStream ferme.", flush=True)

# ============================================
# ROUTES FLASK
# ============================================

@app.route('/ping', methods=['GET'], strict_slashes=False)
def route_ping():
    return jsonify({
        "status":          "ok",
        "modele":          MODELE_OLLAMA,
        "mode":            mode_actuel,
        "nb_echanges":     len(historique),
        "wake_word_actif": wake_word_actif
    })

@app.route('/status', methods=['GET'], strict_slashes=False)
def route_status():
    """Endpoint de polling pour l'interface web — retourne l'état courant et les messages récents."""
    with _web_lock:
        etat_copy     = _web_etat
        mode_copy     = _web_mode_continu
        messages_copy = list(_web_messages)
        partial_copy  = _web_partial
    return jsonify({
        "etat":         etat_copy,
        "mode_continu": mode_copy,
        "messages":     messages_copy,
        "partial":      partial_copy,
    })

@app.route('/ecouter', methods=['POST'], strict_slashes=False)
def route_ecouter():
    """
    Enregistrement pour l'ESP32.
    Acquiert micro_lock : attend que le wake word libere le micro (max 5s).
    """
    if not micro_lock.acquire(timeout=5.0):
        return jsonify({"erreur": "Micro occupe (wake word actif), reessayez dans 2s"}), 503
    try:
        audio = ecouter_micro()
        texte = transcrire(audio)
        if len(texte) < 2:
            reponse = "Pardon, je n ai pas entendu !"
        else:
            reponse = demander_ollama(texte)
        audio_buffer = texte_vers_audio(reponse)
        return send_file(
            audio_buffer,
            mimetype='audio/wav',
            as_attachment=False,
            download_name='reponse.wav'
        )
    except Exception as e:
        print(f"Erreur /ecouter : {e}", flush=True)
        return jsonify({"erreur": str(e)}), 500
    finally:
        micro_lock.release()

@app.route('/dire', methods=['POST'], strict_slashes=False)
def route_dire():
    data = request.get_json(force=True, silent=True) or {}
    texte = data.get("texte", "")
    if not texte:
        return jsonify({"reponse": "Pas de texte recu!"})
    reponse = demander_ollama(texte)
    return jsonify({"reponse": reponse})

@app.route('/mode', methods=['POST'], strict_slashes=False)
def route_mode():
    global mode_actuel
    data = request.get_json(force=True, silent=True) or {}
    nouveau_mode = data.get("mode", "")
    if nouveau_mode in PERSONNALITES:
        mode_actuel = nouveau_mode
        print(f"Mode change : {mode_actuel}", flush=True)
        return jsonify({"status": "ok", "mode": mode_actuel}), 200
    return jsonify({"status": "erreur", "message": f"Mode inconnu: '{nouveau_mode}'. Modes valides: {list(PERSONNALITES.keys())}"}), 400

@app.route('/memoire', methods=['DELETE'], strict_slashes=False)
def route_effacer_memoire():
    global historique
    historique = []
    _sauvegarder_historique()
    print("Historique efface !", flush=True)
    return jsonify({"status": "ok", "message": "Memoire effacee"}), 200

@app.route('/memoire', methods=['GET'], strict_slashes=False)
def route_voir_memoire():
    return jsonify({
        "nb_echanges": len(historique),
        "historique":  historique
    }), 200

@app.route('/register_esp32', methods=['POST'], strict_slashes=False)
def route_register_esp32():
    """L'ESP32 s'enregistre au demarrage avec son IP."""
    global esp32_ip
    data = request.get_json(force=True, silent=True) or {}
    ip = data.get("ip", "")
    if ip:
        esp32_ip = ip
        print(f"ESP32 enregistre : {esp32_ip}", flush=True)
        return jsonify({"status": "ok", "ip": esp32_ip}), 200
    return jsonify({"status": "erreur", "message": "Champ 'ip' manquant"}), 400

@app.route('/ip', methods=['GET'], strict_slashes=False)
def route_ip():
    """Retourne l'IP actuelle de l'ESP32."""
    return jsonify({"esp32_ip": esp32_ip}), 200

@app.route('/toggle_continu', methods=['POST'], strict_slashes=False)
def route_toggle_continu():
    """Active ou desactive le mode conversation continue (touche * ESP32)."""
    global _mode_continu, _dernier_echange_continu
    _mode_continu = not _mode_continu
    _dernier_echange_continu = time.time() if _mode_continu else 0.0
    etat = "active" if _mode_continu else "desactive"
    print(f"[WW] Mode conversation continue {etat}", flush=True)
    if _mode_continu:
        notifier_esp32("continu_on")
    else:
        notifier_esp32("continu_off")
        notifier_esp32("repos")
    return jsonify({"status": "ok", "mode_continu": _mode_continu}), 200

@app.route('/wake_word_status', methods=['GET'], strict_slashes=False)
def route_wake_word_status():
    """Retourne l'etat actuel du systeme wake word."""
    return jsonify({
        "wake_word_actif":     wake_word_actif,
        "wake_word_en_ecoute": wake_word_en_ecoute,
        "wake_word":           "neo",
        "device_micro_esp32":  DEVICE_MICRO,
        "device_micro_ww":     DEVICE_MICRO_WW,
        "sample_rate_ww":      SAMPLE_RATE_WW,
        "device_hp":           DEVICE_HP
    }), 200

@app.route('/wake_word_toggle', methods=['POST'], strict_slashes=False)
def route_wake_word_toggle():
    """Active ou desactive le wake word depuis l'ESP32."""
    global wake_word_actif
    data = request.get_json(force=True, silent=True) or {}

    if "actif" in data:
        # Valeur explicite fournie
        wake_word_actif = bool(data["actif"])
    else:
        # Bascule
        wake_word_actif = not wake_word_actif

    etat = "active" if wake_word_actif else "desactive"
    print(f"Wake word {etat}", flush=True)
    return jsonify({
        "status":          "ok",
        "wake_word_actif": wake_word_actif,
        "message":         f"Wake word {etat}"
    }), 200

@app.route('/stream/events', methods=['GET'], strict_slashes=False)
def route_stream_events():
    """SSE endpoint — diffuse les événements en temps réel à l'interface web."""
    if not _check_api_key():
        return jsonify({"error": "Unauthorized"}), 401

    def generate():
        q: _queue.Queue = _queue.Queue(maxsize=100)
        with _sse_lock:
            _sse_clients.append(q)
        try:
            # État initial
            yield f"event: status\ndata: {json.dumps({'etat': 'repos'})}\n\n"
            while True:
                try:
                    msg = q.get(timeout=25)
                    yield msg
                except _queue.Empty:
                    yield ': keepalive\n\n'
        finally:
            with _sse_lock:
                if q in _sse_clients:
                    _sse_clients.remove(q)

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )


@app.route('/keypad/<key>', methods=['POST'], strict_slashes=False)
def route_keypad(key):
    """Simule une touche du clavier 4×4 physique depuis l'interface web."""
    if not _check_api_key():
        return jsonify({"error": "Unauthorized"}), 401

    global _mode_continu, _dernier_echange_continu

    if key == '*':
        # Toggle mode continu (même effet que la touche * de l'ESP32)
        _mode_continu = not _mode_continu
        _dernier_echange_continu = time.time() if _mode_continu else 0.0
        if _mode_continu:
            notifier_esp32("continu_on")
        else:
            notifier_esp32("continu_off")
            notifier_esp32("repos")
        return jsonify({"status": "ok", "mode_continu": _mode_continu}), 200

    elif key == '#':
        # Veille
        _extraire_et_dispatcher_tags('[VEILLE]')
        return jsonify({"status": "ok"}), 200

    elif key.startswith('corps_'):
        # Contrôle du corps : corps_content, corps_danse, etc.
        notifier_esp32(key)
        return jsonify({"status": "ok"}), 200

    elif key == 'A':
        # Déclencher une écoute immédiate (mode continu one-shot)
        if not _mode_continu:
            _mode_continu = True
            _dernier_echange_continu = time.time()
            notifier_esp32("continu_on")
            # Se désactivera automatiquement après le premier échange (timeout 15s)
        return jsonify({"status": "ok"}), 200

    elif key == 'B':
        notifier_esp32("corps_hoche")
        return jsonify({"status": "ok"}), 200

    elif key == 'C':
        notifier_esp32("corps_danse")
        return jsonify({"status": "ok"}), 200

    elif key == 'D':
        notifier_esp32("repos")
        return jsonify({"status": "ok"}), 200

    else:
        # Touches numériques : ACK sans action (extensible)
        return jsonify({"status": "ok", "key": key}), 200


@app.route('/web_speak', methods=['POST'], strict_slashes=False)
def route_web_speak():
    """
    Faire parler le robot depuis l'interface web ou un agent IA externe.
    POST { "text": "Bonjour !" }
    Traite les balises [EXPRESSION] embarquées dans le texte.
    Répond immédiatement 202 — la parole s'exécute en arrière-plan.
    """
    if not _check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    texte = str(data.get('text', '')).strip()
    if not texte:
        return jsonify({"error": "Champ 'text' requis"}), 400

    def _parler():
        try:
            texte_net = _extraire_et_dispatcher_tags(texte)
            if not texte_net:
                return
            _web_set_etat('parle')
            notifier_esp32_sync("parle")
            audio = texte_vers_audio(texte_net)
            notifier_esp32_audio(audio.getvalue())
            _web_add_message('aria', texte_net)
        except Exception as e:
            print(f"[WEB_SPEAK] Erreur: {e}", flush=True)
        finally:
            _web_set_etat('repos')
            notifier_esp32("repos")

    threading.Thread(target=_parler, daemon=True).start()
    return jsonify({"status": "ok", "message": "Parole lancée"}), 202


@app.route('/servo', methods=['POST'], strict_slashes=False)
def route_servo():
    """
    Contrôle direct de l'angle du servomoteur (tête du robot).
    POST { "angle": 90 }   — valeur entre 0 et 180.
    """
    if not _check_api_key():
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    try:
        angle = int(float(data.get('angle', 90)))
        angle = max(0, min(180, angle))
    except (ValueError, TypeError):
        return jsonify({"error": "angle invalide (0–180 attendu)"}), 400
    notifier_esp32(f"servo_{angle}")
    return jsonify({"status": "ok", "angle": angle}), 200


# ============================================
# DEMARRAGE
# ============================================

if __name__ == '__main__':
    # Demarrer le thread wake word en daemon
    thread_ww = threading.Thread(target=boucle_wake_word, daemon=True, name="WakeWordThread")
    thread_ww.start()
    print(f"Thread wake word demarre : {thread_ww.name}", flush=True)

    print("=" * 55, flush=True)
    print("  SERVEUR ROBOT IA v7 - WAKE WORD 'neo'", flush=True)
    print(f"  Modele  : {MODELE_OLLAMA}", flush=True)
    print(f"  Mode    : {mode_actuel}", flush=True)
    print(f"  Micro   : device {DEVICE_MICRO} MME @ {SAMPLE_RATE}Hz (ESP32)", flush=True)
    print(f"  Micro WW: device {DEVICE_MICRO_WW} MME @ {SAMPLE_RATE_WW}Hz -> resample 16kHz", flush=True)
    print(f"  HP      : device {DEVICE_HP} (RIG-700HX)", flush=True)
    print("  Adresse : http://0.0.0.0:5000", flush=True)
    print("=" * 55, flush=True)
    app.run(host='0.0.0.0', port=5000, debug=False)
