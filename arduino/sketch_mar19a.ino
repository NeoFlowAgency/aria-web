// ============================================
// ROBOT IA FINAL ULTRA COMPLET v3
// Servo : GPIO 18
// OLED  : SDA=21, SCL=22
// Audio : BCLK=26, LRC=25, DIN=23
// Clavier : R1-R4=13,12,14,27  C1-C4=5,17,33,32
// WiFi : Freebox-C82B11
// Serveur : 192.168.1.9:5000
// ============================================

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ESP32Servo.h>
#include <Keypad.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include "driver/i2s.h"

// --- WiFi ---
const char* WIFI_SSID     = "Freebox-C82B11";
const char* WIFI_PASSWORD = "FREEGRELIER44";
const char* SERVEUR       = "http://192.168.1.9:5000";

// --- OLED ---
#define SCREEN_WIDTH   128
#define SCREEN_HEIGHT  64
#define OLED_RESET     -1
#define SCREEN_ADDRESS 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// --- Servo ---
Servo monServo;
const int PIN_SERVO = 18;
int positionActuelle = 90;

// --- Clavier ---
const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
byte rowPins[ROWS] = {13, 12, 14, 27};
byte colPins[COLS]  = {5, 17, 33, 32};
Keypad clavier = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// --- Audio I2S ---
#define I2S_BCLK    26
#define I2S_LRC     25
#define I2S_DIN     23
#define SAMPLE_RATE 22050

// --- Volume ---
int volume = 8000;
#define VOLUME_MIN  2000
#define VOLUME_MAX  15000
#define VOLUME_STEP 1500

// --- Serveur web ESP32 (evenements JSON, port 80) ---
WebServer server(80);

// --- Serveur audio TCP brut (stream WAV, port 8080) ---
// WebServer bufferise tout le body en RAM → OOM sur gros WAV
// WiFiServer lit en streaming direct → jouerAudioStreaming sans allocation
WiFiServer audioServer(8080);

// --- Veille ---
bool enVeille = false;

// --- Mode conversation continue ---
bool enModeContinu = false;

// --- Mode IA actuel ---
String modeIA = "neutre";

// --- Etat enregistrement serveur (retry si Flask pas encore pret) ---
bool esp32Enregistre = false;

// ===== SETUP I2S =====

void setupI2S() {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 128,
    .use_apll = false,
    .tx_desc_auto_clear = true
  };
  i2s_pin_config_t pins = {
    .bck_io_num   = I2S_BCLK,
    .ws_io_num    = I2S_LRC,
    .data_out_num = I2S_DIN,
    .data_in_num  = I2S_PIN_NO_CHANGE
  };
  i2s_driver_install(I2S_NUM_0, &config, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pins);
  i2s_zero_dma_buffer(I2S_NUM_0);
}

// ===== SONS =====

void bip(int frequence, int duree_ms) {
  int nb_samples = (SAMPLE_RATE * duree_ms) / 1000;
  int16_t buffer[128];
  float angle = 0;
  float increment = 2.0 * PI * frequence / SAMPLE_RATE;
  size_t bytes_written;
  for (int i = 0; i < nb_samples; i += 128) {
    for (int j = 0; j < 128; j++) {
      buffer[j] = (int16_t)(sin(angle) * volume);
      angle += increment;
    }
    i2s_write(I2S_NUM_0, buffer, sizeof(buffer), &bytes_written, portMAX_DELAY);
  }
}

void sonEcoute()     { bip(800,100); delay(50); bip(1200,100); }
void sonReflexion()  { bip(440,80); delay(40); bip(494,80); delay(40); bip(523,80); }
void sonReponse()    { bip(1047,80); delay(30); bip(784,150); }
void sonJoyeux()     { bip(523,150); bip(659,150); bip(784,150); bip(1047,300); }
void sonTriste()     { bip(494,300); delay(100); bip(440,300); delay(100); bip(392,500); }
void sonSurpris()    { bip(440,80); delay(30); bip(880,80); delay(30); bip(1760,200); }
void sonNeutre()     { bip(660,100); delay(50); bip(660,100); }
void sonColere()     { bip(200,100); delay(30); bip(180,100); delay(30); bip(160,200); }
void sonAmoureux()   { bip(523,200); delay(50); bip(659,200); delay(50); bip(784,400); }
void sonVolumeUp()   { bip(880,60); bip(1047,60); }
void sonVolumeDown() { bip(1047,60); bip(880,60); }
void sonReveil()     { bip(440,100); delay(50); bip(660,100); delay(50); bip(880,200); }
void sonVeille()     { bip(880,200); delay(50); bip(660,150); delay(50); bip(440,300); }
void sonReset()      { bip(880,100); delay(50); bip(440,200); }
void sonErreur()     { bip(300,200); delay(50); bip(200,300); }
void sonDanse() {
  int notes[] = {523,523,659,523,784,740};
  int durees[] = {150,150,150,150,150,300};
  for (int i = 0; i < 6; i++) { bip(notes[i], durees[i]); delay(30); }
}
void sonDort() {
  int v = volume;
  for (int i = 0; i < 3; i++) {
    volume = max(v - (i * 1500), 500);
    bip(300, 400); delay(200);
    bip(250, 600); delay(400);
  }
  volume = v;
}

// ===== EXPRESSIONS OLED =====

void visageNeutre() {
  display.clearDisplay();
  display.drawCircle(38, 28, 12, WHITE);
  display.fillCircle(41, 26, 5, WHITE);
  display.drawCircle(90, 28, 12, WHITE);
  display.fillCircle(93, 26, 5, WHITE);
  display.drawLine(44, 50, 84, 50, WHITE);
  display.display();
}

void visageContent() {
  display.clearDisplay();
  display.drawCircle(38, 28, 12, WHITE);
  display.fillCircle(41, 26, 5, WHITE);
  display.drawCircle(90, 28, 12, WHITE);
  display.fillCircle(93, 26, 5, WHITE);
  display.drawCircle(64, 44, 16, WHITE);
  display.fillRect(44, 28, 40, 18, BLACK);
  display.display();
}

void visageTriste() {
  display.clearDisplay();
  display.drawCircle(38, 28, 12, WHITE);
  display.fillCircle(41, 26, 5, WHITE);
  display.drawCircle(90, 28, 12, WHITE);
  display.fillCircle(93, 26, 5, WHITE);
  display.drawCircle(64, 62, 16, WHITE);
  display.fillRect(44, 54, 40, 18, BLACK);
  display.display();
}

void visageSurpris() {
  display.clearDisplay();
  display.drawLine(26, 12, 50, 16, WHITE);
  display.drawLine(78, 16, 102, 12, WHITE);
  display.drawCircle(38, 30, 14, WHITE);
  display.fillCircle(38, 30, 5, WHITE);
  display.drawCircle(90, 30, 14, WHITE);
  display.fillCircle(90, 30, 5, WHITE);
  display.drawCircle(64, 52, 8, WHITE);
  display.display();
}

void visageColere() {
  display.clearDisplay();
  display.drawLine(24, 18, 50, 24, WHITE);
  display.drawLine(78, 24, 104, 18, WHITE);
  display.drawLine(26, 30, 50, 30, WHITE);
  display.drawLine(78, 30, 102, 30, WHITE);
  display.drawLine(44, 54, 54, 50, WHITE);
  display.drawLine(54, 50, 74, 50, WHITE);
  display.drawLine(74, 50, 84, 54, WHITE);
  display.display();
}

void visageAmoureux() {
  display.clearDisplay();
  display.fillTriangle(30, 24, 38, 16, 46, 24, WHITE);
  display.fillCircle(33, 26, 5, WHITE);
  display.fillCircle(43, 26, 5, WHITE);
  display.fillTriangle(82, 24, 90, 16, 98, 24, WHITE);
  display.fillCircle(85, 26, 5, WHITE);
  display.fillCircle(95, 26, 5, WHITE);
  display.drawCircle(64, 42, 18, WHITE);
  display.fillRect(44, 24, 40, 20, BLACK);
  display.display();
}

void visageDort(int stade = 3) {
  display.clearDisplay();
  if (stade == 1) {
    display.drawCircle(38, 28, 12, WHITE);
    display.fillRect(26, 20, 25, 8, BLACK);
    display.drawCircle(90, 28, 12, WHITE);
    display.fillRect(78, 20, 25, 8, BLACK);
  } else {
    display.drawLine(26, 28, 50, 28, WHITE);
    display.drawLine(78, 28, 102, 28, WHITE);
  }
  display.drawLine(50, 50, 78, 50, WHITE);
  display.setTextSize(1);
  display.setTextColor(WHITE);
  if (stade >= 1) { display.setCursor(95, 15); display.print("z"); }
  if (stade >= 2) { display.setCursor(105, 8); display.print("Z"); }
  if (stade >= 3) { display.setCursor(115, 2); display.print("Z"); }
  display.display();
}

void visageReflechit() {
  display.clearDisplay();
  display.drawCircle(38, 28, 12, WHITE);
  display.fillCircle(42, 23, 5, WHITE);
  display.drawCircle(90, 28, 12, WHITE);
  display.fillCircle(94, 23, 5, WHITE);
  display.drawLine(44, 50, 54, 46, WHITE);
  display.drawLine(54, 46, 64, 50, WHITE);
  display.drawLine(64, 50, 74, 46, WHITE);
  display.drawLine(74, 46, 84, 50, WHITE);
  display.display();
}

void visageEcoute() {
  display.clearDisplay();
  display.drawCircle(38, 28, 14, WHITE);
  display.fillCircle(38, 28, 5, WHITE);
  display.drawCircle(90, 28, 14, WHITE);
  display.fillCircle(90, 28, 5, WHITE);
  display.drawCircle(64, 50, 7, WHITE);
  display.display();
}

void visageParleOuvert() {
  display.clearDisplay();
  display.drawCircle(38, 28, 12, WHITE);
  display.fillCircle(41, 26, 5, WHITE);
  display.drawCircle(90, 28, 12, WHITE);
  display.fillCircle(93, 26, 5, WHITE);
  display.drawCircle(64, 50, 10, WHITE);
  display.fillCircle(64, 50, 6, WHITE);
  display.display();
}

void visageParle() {
  display.clearDisplay();
  display.drawCircle(38, 28, 12, WHITE);
  display.fillCircle(41, 26, 5, WHITE);
  display.drawCircle(90, 28, 12, WHITE);
  display.fillCircle(93, 26, 5, WHITE);
  display.drawCircle(64, 50, 5, WHITE);
  display.display();
}

void clignement() {
  display.clearDisplay();
  display.drawLine(26, 28, 50, 28, WHITE);
  display.drawLine(78, 28, 102, 28, WHITE);
  display.drawCircle(64, 44, 16, WHITE);
  display.fillRect(44, 28, 40, 18, BLACK);
  display.display();
  delay(150);
  visageContent();
}

void afficherErreur(String msg) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(WHITE);
  display.setCursor(0, 20);
  display.println("ERREUR :");
  display.setCursor(0, 38);
  display.println(msg);
  display.display();
}

// ===== SERVO =====

void servoVers(int cible) {
  monServo.attach(PIN_SERVO, 500, 2400);
  monServo.write(cible);
  delay(500);
  positionActuelle = cible;
  monServo.detach();
}

void servoProgressif(int cible, int vitesse = 10) {
  monServo.attach(PIN_SERVO, 500, 2400);
  if (positionActuelle < cible) {
    for (int pos = positionActuelle; pos <= cible; pos++) {
      monServo.write(pos);
      delay(vitesse);
    }
  } else {
    for (int pos = positionActuelle; pos >= cible; pos--) {
      monServo.write(pos);
      delay(vitesse);
    }
  }
  positionActuelle = cible;
  delay(100);
  monServo.detach();
}

void danse() {
  for (int i = 0; i < 5; i++) {
    monServo.attach(PIN_SERVO, 500, 2400);
    monServo.write(i % 2 == 0 ? 135 : 45);
    delay(250);
    monServo.detach();
    delay(50);
  }
  servoVers(90);
}

// ===== WIFI =====

void connecterWifi() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(WHITE);
  display.setCursor(0, 20);
  display.println("Connexion WiFi...");
  display.display();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int tentatives = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    tentatives++;
    if (tentatives > 20) {
      afficherErreur("WiFi echoue !");
      sonErreur();
      return;
    }
  }
  Serial.println("WiFi connecte : " + WiFi.localIP().toString());
  display.clearDisplay();
  display.setCursor(0, 20);
  display.println("WiFi connecte !");
  display.setCursor(0, 38);
  display.println(WiFi.localIP().toString());
  display.display();
  delay(1500);
}

// ===== MODE IA =====

void changerModeIA(String mode) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(String(SERVEUR) + "/mode");
  http.addHeader("Content-Type", "application/json");
  http.POST("{\"mode\":\"" + mode + "\"}");
  http.end();
  modeIA = mode;
  Serial.println("Mode IA : " + mode);
}

void effacerMemoireIA() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(String(SERVEUR) + "/memoire");
  http.sendRequest("DELETE");
  http.end();
  Serial.println("Memoire IA effacee !");
}

// ===== STREAMING AUDIO =====

// Retourne true = lecture complete, false = interrompue (connexion fermee par le serveur)
bool jouerAudioStreaming(WiFiClient* stream, int taille) {
  const size_t CHUNK = 512;
  uint8_t buffer[CHUNK];
  size_t bytes_written;
  int lu = 0;
  int headerOctets = 0;
  bool headerSaute = false;
  unsigned long dernierAnim    = 0;
  unsigned long derniereDonnee = millis();
  int etatAnim = 0;

  while (lu < taille) {
    int dispo = stream->available();
    if (dispo > 0) {
      int aLire = min((int)CHUNK, min(dispo, taille - lu));
      int nbLus = stream->readBytes(buffer, aLire);
      lu += nbLus;
      derniereDonnee = millis();

      if (!headerSaute) {
        headerOctets += nbLus;
        if (headerOctets >= 44) {
          headerSaute = true;
          int offset = 44 - (headerOctets - nbLus);
          if (nbLus - offset > 0) {
            i2s_write(I2S_NUM_0, buffer + offset,
                      nbLus - offset, &bytes_written, portMAX_DELAY);
          }
        }
      } else {
        i2s_write(I2S_NUM_0, buffer, nbLus, &bytes_written, portMAX_DELAY);

        // Animation energie-reactive : RMS des samples I2S → bouche suit la voix
        if (millis() - dernierAnim > 80) {
          dernierAnim = millis();
          int nSamples = nbLus / 2;
          if (nSamples > 0) {
            int32_t sumSq = 0;
            int16_t* samples = (int16_t*)buffer;
            for (int j = 0; j < nSamples; j++) {
              sumSq += (int32_t)samples[j] * samples[j];
            }
            float rmsChunk = sqrt((float)sumSq / nSamples);
            // Seuil 1500 sur int16 (~5% amplitude) : voix vs silence inter-mots
            if (rmsChunk > 1500) visageParleOuvert();
            else visageParle();
          }
        }
      }
    } else {
      // Verifier si le serveur a ferme la connexion (signal d'interruption)
      if (!stream->connected()) {
        i2s_zero_dma_buffer(I2S_NUM_0);
        Serial.println("[AUDIO] Connexion fermee par serveur — lecture interrompue");
        return false;
      }
      // Timeout : pas de donnees depuis 5 secondes
      if (millis() - derniereDonnee > 5000) {
        i2s_zero_dma_buffer(I2S_NUM_0);
        Serial.println("[AUDIO] Timeout — pas de donnees");
        return false;
      }
    }

    delay(1);
  }
  return true;  // lecture complete
}

// ===== INTERACTION IA =====

void interagirAvecIA(String phraseForce = "") {
  if (WiFi.status() != WL_CONNECTED) {
    afficherErreur("Pas de WiFi !");
    sonErreur();
    connecterWifi();
    return;
  }

  HTTPClient http;

  if (phraseForce != "") {
    visageReflechit();
    sonReflexion();
    http.begin(String(SERVEUR) + "/dire");
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(30000);
    int code = http.POST("{\"texte\":\"" + phraseForce + "\"}");
    if (code == 200) {
      Serial.println("Phrase predifinie envoyee !");
    }
    http.end();
    delay(500);
    visageContent();
    return;
  }

  // Écoute micro
  visageEcoute();
  sonEcoute();
  Serial.println("Envoi requete /ecouter...");

  http.begin(String(SERVEUR) + "/ecouter");
  http.setTimeout(40000);
  int code = http.POST("");

  if (code != 200) {
    Serial.println("Erreur serveur : " + String(code));
    afficherErreur("Erreur : " + String(code));
    sonErreur();
    visageTriste();
    delay(2000);
    visageContent();
    http.end();
    return;
  }

  visageReflechit();
  sonReflexion();

  int taille = http.getSize();
  Serial.println("Taille audio : " + String(taille));

  if (taille <= 44) {
    afficherErreur("Pas entendu !");
    sonTriste();
    visageTriste();
    delay(2000);
    visageContent();
    http.end();
    return;
  }

  sonReponse();
  servoVers(120);

  WiFiClient* stream = http.getStreamPtr();
  jouerAudioStreaming(stream, taille);
  http.end();

  servoVers(90);
  visageContent();
  Serial.println("Interaction terminee !");
}

// ===== VEILLE =====

void animationEndormissement() {
  servoProgressif(90, 10);
  visageDort(1);
  sonDort();
  delay(800);
  visageDort(2);
  delay(800);
  visageDort(3);
  delay(500);
  display.clearDisplay();
  display.display();
  display.ssd1306_command(SSD1306_DISPLAYOFF);
}

void reveil() {
  display.ssd1306_command(SSD1306_DISPLAYON);
  visageSurpris();
  sonReveil();
  delay(300);
  clignement();
  delay(200);
  visageContent();
  enVeille = false;
  changerModeIA("neutre");
  Serial.println("Robot reveille !");
}

// ===== SERVEUR AUDIO TCP (port 8080) =====
// Protocole : 4 octets little-endian (taille WAV) puis bytes WAV
// Reponse : 'K' quand lecture terminee, 'X' si erreur
// Pas de buffering RAM : stream direct vers jouerAudioStreaming()

void checkAudioServer() {
  WiFiClient client = audioServer.available();
  if (!client) return;

  Serial.println("[AUDIO] Connexion TCP (port 8080) | heap : " + String(ESP.getFreeHeap()));

  // Attendre les 4 octets de taille (uint32 little-endian), timeout 3s
  unsigned long t0 = millis();
  while (client.available() < 4 && millis() - t0 < 3000) delay(1);

  if (client.available() < 4) {
    Serial.println("[AUDIO] Timeout : taille non recue");
    client.write('X');
    client.stop();
    return;
  }

  uint8_t buf[4];
  client.readBytes(buf, 4);
  int taille = (int)buf[0]
             | ((int)buf[1] << 8)
             | ((int)buf[2] << 16)
             | ((int)buf[3] << 24);

  Serial.println("[AUDIO] Taille annoncee : " + String(taille) + " octets");

  if (taille <= 44) {
    Serial.println("[AUDIO] Taille invalide (<= 44)");
    client.write('X');
    client.stop();
    return;
  }

  // Verifier que le client envoie bien des donnees avant d'animer la bouche
  // (evite OLED qui anime sans son si le serveur coupe juste apres la connexion)
  unsigned long tAttente = millis();
  while (client.available() == 0 && client.connected() && millis() - tAttente < 2000) {
    delay(5);
  }
  if (!client.connected() || client.available() == 0) {
    Serial.println("[AUDIO] Client deconnecte avant envoi donnees — abandon");
    client.stop();
    visageContent();
    return;
  }

  // Connexion active + donnees presentes : demarrer lecture
  visageParleOuvert();
  sonReponse();
  servoVers(120);

  bool ok = jouerAudioStreaming(&client, taille);

  servoVers(90);
  visageContent();

  // Envoyer confirmation uniquement si lecture complete (sinon serveur a deja ferme)
  if (ok && client.connected()) {
    client.write('K');
    delay(10);
    Serial.println("[AUDIO] Lecture terminee.");
  } else if (!ok) {
    Serial.println("[AUDIO] Lecture interrompue.");
  }
  client.stop();
}

// ===== SERVEUR WEB ESP32 (port 80) =====

void handleEvenement() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"erreur\":\"body manquant\"}");
    return;
  }
  StaticJsonDocument<128> doc;
  DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if (err) {
    server.send(400, "application/json", "{\"erreur\":\"JSON invalide\"}");
    return;
  }
  String evt = doc["evenement"] | "";
  Serial.println("[WEB] Evenement : " + evt);

  // Reveil depuis veille si le serveur envoie un evenement alors qu'on dort
  if (enVeille && (evt == "ecoute" || evt == "reflechit" || evt == "parle")) {
    display.ssd1306_command(SSD1306_DISPLAYON);
    enVeille = false;
  }

  if (evt == "ecoute") {
    visageEcoute();
    sonEcoute();
    servoVers(90);
  } else if (evt == "reflechit") {
    visageReflechit();
    sonReflexion();
  } else if (evt == "parle") {
    // Ne pas animer ici : l'animation reelle se declenche dans checkAudioServer()
    // quand la connexion TCP audio est confirmee avec des donnees.
    // Juste afficher visage neutre comme etat "pret a parler".
    visageNeutre();
  } else if (evt == "repos") {
    visageContent();
    servoVers(90);
  } else if (evt == "continu_on") {
    enModeContinu = true;
    visageEcoute();
    sonReveil();
    Serial.println("[MODE] Conversation continue : ON");
  } else if (evt == "continu_off") {
    enModeContinu = false;
    visageContent();
    sonNeutre();
    Serial.println("[MODE] Conversation continue : OFF");
  } else if (evt == "veille_init") {
    // Repondre immediatement avant l'animation (qui bloque plusieurs secondes)
    server.send(200, "application/json", "{\"status\":\"ok\"}");
    enVeille = true;
    enModeContinu = false;
    sonVeille();
    animationEndormissement();
    return;
  } else if (evt.startsWith("corps_")) {
    String action = evt.substring(6);
    if      (action == "content")       visageContent();
    else if (action == "triste")        visageTriste();
    else if (action == "surpris")       visageSurpris();
    else if (action == "colere")        visageColere();
    else if (action == "amoureux")      visageAmoureux();
    else if (action == "neutre")        visageNeutre();
    else if (action == "danse")         danse();
    else if (action == "hoche") {
      for (int i = 0; i < 3; i++) {
        servoProgressif(70, 15); delay(100);
        servoProgressif(90, 15); delay(100);
      }
    }
    else if (action == "tourne_droite") servoVers(170);
    else if (action == "tourne_gauche") servoVers(10);
    else if (action == "centre")        servoVers(90);
  } else if (evt.startsWith("servo_")) {
    // Contrôle angle direct : servo_45, servo_90, servo_135, etc.
    int angle = constrain(evt.substring(6).toInt(), 0, 180);
    servoVers(angle);
  }

  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

bool enregistrerEsp32() {
  if (WiFi.status() != WL_CONNECTED) return false;
  String ip = WiFi.localIP().toString();
  HTTPClient http;
  http.begin(String(SERVEUR) + "/register_esp32");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST("{\"ip\":\"" + ip + "\"}");
  Serial.println("Enregistrement ESP32 -> HTTP " + String(code) + " | IP=" + ip);
  http.end();
  return (code == 200);
}

// ===== SETUP =====

void setup() {
  Serial.begin(115200);

  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println("ERREUR OLED !");
    while (true);
  }

  monServo.setPeriodHertz(50);
  monServo.attach(PIN_SERVO, 500, 2400);
  monServo.write(90);
  positionActuelle = 90;
  delay(500);
  monServo.detach();

  setupI2S();
  connecterWifi();

  // Serveur web ESP32 — reçoit les événements du serveur Flask
  server.on("/evenement", HTTP_POST, handleEvenement);
  server.begin();
  Serial.println("Serveur web ESP32 demarre sur port 80");

  audioServer.begin();
  Serial.println("Serveur audio TCP demarre sur port 8080");

  esp32Enregistre = enregistrerEsp32();

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(WHITE);
  display.setCursor(20, 20);
  display.println("Robot pret !");
  display.setCursor(10, 38);
  display.println("Appuie sur A !");
  display.display();

  sonJoyeux();
  delay(2000);
  visageContent();
  Serial.println("Robot pret !");
}

// ===== LOOP =====

void loop() {
  server.handleClient();   // Evenements JSON port 80 (non-bloquant)
  checkAudioServer();      // Connexions audio TCP port 8080 (non-bloquant)

  // --- Reconnexion WiFi automatique toutes les 10s ---
  static unsigned long dernierCheckWifi = 0;
  if (millis() - dernierCheckWifi > 10000) {
    dernierCheckWifi = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WIFI] Connexion perdue — reconnexion...");
      connecterWifi();
      esp32Enregistre = false;  // forcer re-enregistrement apres reconnexion
    }
    // --- Retry enregistrement si Flask n'etait pas pret au boot ---
    if (!esp32Enregistre && WiFi.status() == WL_CONNECTED) {
      Serial.println("[WIFI] Retry enregistrement ESP32...");
      esp32Enregistre = enregistrerEsp32();
    }
  }

  char touche = clavier.getKey();
  if (!touche) return;

  Serial.print("Touche : ");
  Serial.println(touche);

  // Réveil depuis veille
  if (enVeille) {
    reveil();
    return;
  }

  switch (touche) {

    // ===== IA =====
    case 'A':
      changerModeIA("neutre");
      interagirAvecIA();
      break;

    case '3':
      // Phrase prédéfinie — présentation
      changerModeIA("drole");
      interagirAvecIA("Presente toi en une phrase drole et dis quelque chose d interessant !");
      break;

    // ===== SERVO =====
    case 'B':
      // Progressif gauche
      visageContent();
      servoProgressif(10, 10);
      break;

    case 'C':
      // Progressif droite
      visageContent();
      servoProgressif(170, 10);
      break;

    case 'D':
      // Retour centre progressif
      visageNeutre();
      servoProgressif(90, 8);
      delay(200);
      visageContent();
      break;

    // ===== VOLUME =====
    case '1':
      volume = min(volume + VOLUME_STEP, VOLUME_MAX);
      sonVolumeUp();
      Serial.println("Volume + : " + String(volume));
      break;

    case '2':
      volume = max(volume - VOLUME_STEP, VOLUME_MIN);
      sonVolumeDown();
      Serial.println("Volume - : " + String(volume));
      break;

    // ===== RESET COMPLET =====
    case '4':
      sonReset();
      effacerMemoireIA();
      changerModeIA("neutre");
      visageNeutre();
      positionActuelle = (positionActuelle > 90) ? 170 : 10;
      servoProgressif(90, 8);
      volume = 8000;
      delay(300);
      visageContent();
      Serial.println("Reset complet !");
      break;

    // ===== DANSE =====
    case '5':
      changerModeIA("drole");
      visageContent();
      sonDanse();
      danse();
      break;

    // ===== CONTENT =====
    case '6':
      changerModeIA("drole");
      visageContent();
      sonJoyeux();
      break;

    // ===== EASTER EGG COLÈRE =====
    case '7':
      changerModeIA("colere");
      visageColere();
      sonColere();
      servoProgressif(0, 5);
      delay(200);
      servoProgressif(180, 5);
      delay(200);
      servoProgressif(90, 8);
      visageNeutre();
      break;

    // ===== EASTER EGG AMOUREUX =====
    case '8':
      changerModeIA("affectueux");
      visageAmoureux();
      sonAmoureux();
      servoProgressif(130, 12);
      delay(600);
      servoProgressif(50, 12);
      delay(600);
      servoProgressif(90, 10);
      break;

    // ===== VEILLE =====
    case '9':
      Serial.println("Mise en veille...");
      sonVeille();
      enVeille = true;
      animationEndormissement();
      break;

    // ===== TEST SON =====
    case '0':
      visageContent();
      sonJoyeux();
      delay(200);
      clignement();
      delay(200);
      sonDanse();
      break;

    // ===== MODE CONVERSATION CONTINUE =====
    case '*':
      enModeContinu = !enModeContinu;
      if (WiFi.status() == WL_CONNECTED) {
        HTTPClient http;
        http.begin(String(SERVEUR) + "/toggle_continu");
        http.addHeader("Content-Type", "application/json");
        http.POST("{}");
        http.end();
      }
      if (enModeContinu) {
        visageEcoute();
        sonReveil();
        Serial.println("Mode continu : ON");
      } else {
        visageContent();
        sonNeutre();
        Serial.println("Mode continu : OFF");
      }
      break;

    // ===== RESET WIFI =====
    case '#':
      Serial.println("Reset WiFi...");
      sonReset();
      visageNeutre();
      WiFi.disconnect();
      delay(500);
      connecterWifi();
      visageContent();
      break;
  }
}