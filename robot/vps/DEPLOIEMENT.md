# Guide de déploiement NEO — Architecture sans PC

## Architecture finale

```
Navigateur web ──► Vercel (Next.js) ──► VPS :5050 (neo-control)
                                              │
                                              ▼
                       ESP32 ◄── MQTT ── Mosquitto :1883
                       ESP32 ◄── MQTT ── neo-bridge :5051 (interne)
                                          │
                                          ├── Whisper STT
                                          ├── OpenClaw (ws://localhost:18789)
                                          └── edge-tts → audio MQTT → ESP32
```

---

## Étape 1 — VPS : déployer la stack

### 1.1 Connexion au VPS
```bash
ssh root@72.61.111.8
```

### 1.2 Arrêter les anciens services
```bash
cd /root/neo-mqtt && docker compose down 2>/dev/null || true
cd /root/mon-projet-robot/Neo && docker compose down 2>/dev/null || true
```

### 1.3 Créer le dossier et uploader les fichiers
```bash
mkdir -p /root/neo
cd /root/neo
```

Copie les fichiers depuis `neo-app/robot/vps/` :
- `app.py`
- `neo_bridge.py`
- `requirements.txt`
- `docker-compose.yml`
- `Dockerfile.control`
- `Dockerfile.bridge`
- `mosquitto/config/mosquitto.conf`

Commande depuis ton PC Windows :
```powershell
scp -r "C:\Users\Noakim Grelier\Desktop\neo-app\robot\vps\*" root@72.61.111.8:/root/neo/
```

### 1.4 Créer le fichier .env
```bash
cd /root/neo
cat > .env << 'EOF'
NEO_API_KEY=remplace-par-une-vraie-cle-secrete-longue
SECRET_KEY=autre-cle-aleatoire-differente
EOF
```

### 1.5 Créer les dossiers Mosquitto
```bash
mkdir -p /root/neo/mosquitto/{config,data,log}
chmod -R 777 /root/neo/mosquitto
```

### 1.6 Lancer la stack
```bash
cd /root/neo
docker compose --env-file .env up -d --build

# Vérifier que les 3 services tournent
docker compose ps

# Voir les logs (CTRL+C pour quitter)
docker compose logs -f
```

**Attendre ~2-3 minutes** que Whisper télécharge son modèle (~500MB).

### 1.7 Vérifier que le port 5050 est accessible
```bash
# Sur le VPS :
curl -H "X-NEO-Key: ta-cle" http://localhost:5050/status
# Doit retourner du JSON
```

### 1.8 Ouvrir le port 5050 dans le firewall
```bash
ufw allow 5050/tcp
```

---

## Étape 2 — Arduino : flasher le nouveau sketch

### 2.1 Installer la librairie PubSubClient
Dans l'IDE Arduino :
- `Sketch` → `Manage Libraries`
- Chercher **PubSubClient** (par Nick O'Leary)
- Installer

### 2.2 Ouvrir et modifier le sketch
Fichier : `C:\Users\Noakim Grelier\Documents\Arduino\sketch_mar19a\sketch_mar19a.ino`

Vérifier en haut du fichier :
```cpp
const char* MQTT_HOST = "72.61.111.8";  // IP VPS ✓
const char* WIFI_SSID     = "Freebox-C82B11";  // ton WiFi ✓
const char* WIFI_PASSWORD = "FREEGRELIER44";    // ✓

#define HAS_MICROPHONE false  // laisser false si pas de micro câblé
```

### 2.3 Téléverser
- Connecte l'ESP32 via USB
- Sélectionne le bon port COM
- Clique **Téléverser** (→)

### 2.4 Vérifier dans le Moniteur Série (115200 bauds)
Tu dois voir :
```
WiFi : 192.168.x.x
[MQTT] Connecté, topics souscrits
```

Et dans les logs VPS :
```
[INFO] ESP32 → {"type":"online","ip":"192.168.x.x"}
```

---

## Étape 3 — Vercel : variables d'environnement

Dans le dashboard Vercel de ton projet :
**Settings → Environment Variables**

Ajouter :
| Nom | Valeur |
|-----|--------|
| `FLASK_API_URL` | `http://72.61.111.8:5050` |
| `NEO_API_KEY`   | (même valeur que dans .env VPS) |

**Redéployer** (git push ou bouton Redeploy).

---

## Étape 4 — Test final

1. **Ouvre l'app web** → `/conversation`
2. **Clique le bouton micro bleu** → il devient rouge
3. **Parle** → il enregistre
4. **Reclique** → il envoie l'audio
5. Le robot doit :
   - Changer d'expression OLED (`reflechit`)
   - Répondre vocalement sur son haut-parleur
   - La conversation apparaît dans la page web

---

## Dépannage

### Le robot ne répond pas à l'audio
```bash
# VPS — logs du bridge
docker compose logs neo-bridge --tail=50

# Vérifier OpenClaw
curl http://localhost:18789
```

### MQTT ne connecte pas
```bash
docker compose logs mosquitto
# Port 1883 doit être accessible :
ufw allow 1883/tcp
```

### L'audio ne sort pas du haut-parleur
- Vérifier dans les logs Arduino que `neo/audio/ctl` et `neo/audio/data` sont reçus
- Ouvre le Moniteur Série → chercher `[AUDIO] Réception terminée`

### Micro navigateur "inaccessible"
- Le site doit être en HTTPS (Vercel = HTTPS par défaut ✓)
- Sur HTTP local : Chrome requiert `localhost` ou HTTPS pour `getUserMedia()`

---

## Commandes utiles VPS

```bash
# Relancer la stack
cd /root/neo && docker compose restart

# Voir les logs en temps réel
docker compose logs -f neo-bridge
docker compose logs -f neo-control

# Stopper
docker compose down

# Reconstruire après modif de code
docker compose up -d --build
```
