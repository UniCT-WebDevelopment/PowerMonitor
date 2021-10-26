//pio remote run -t upload -r && pio remote device monitor

//Librerie.
//--------------------------------------------------------------------------------//

#include <Arduino.h>
#include <ESP8266WiFi.h>				//WiFi

#include <MCP3202.h>						//ADC
#include <PowerMonitor.h>				//PowerMonitor

#include <PubSubClient.h>				//MQTT

#include <ESP8266WebServer.h>		//WebServer
#include <ESP8266HTTPClient.h>
#include <ESP8266httpUpdate.h>

#include <ArduinoJSON.h>				//JSON
#include <LittleFS.h>						//Filesystem

//Struct e costanti.
//--------------------------------------------------------------------------------//

//Impostazioni del dispositivo.
struct SETTINGS_T{
	char name[32];	//Nome del dispositivo.
	char ssid[16];
	char pass[16];
};

//PIN
#define COIL D1

//Hotspot SSID
#define SOFTAP_SSID "PowerMonitor"

//Server MQTT
#define MQTT_SERVER "192.168.1.100"
#define MQTT_PORT 1883

//Topic MQTT
#define REQUEST_TOPIC "/PowerMonitor"
#define DATA_TOPIC "/PowerMonitor/data"
#define POWER_TOPIC "/PowerMonitor/state/data"

//Numero di campioni per calcolo.
//OCCHIO ALLA RAM! A 2048 gia' crasha.
//Verifica con Serial.println(ESP.getFreeHeap());
//NB: Se l'ESP crasha, in seriale viene stampato l'errore ed un dump.
#define SAMPLES 1536

//Definizione delle funzioni.
//--------------------------------------------------------------------------------//

void reconnect();

void saveSettings();
void loadSettings();

void setupPowerMonitor();
String parseJSON(PowerMonitor &pm);

//Oggetti.
//--------------------------------------------------------------------------------//

ESP8266WebServer server(80);

WiFiClient mqttClient;					//Serve per avere un'istanza di client da usare per l'MQTT.
PubSubClient mqtt(mqttClient);

MCP3202 adc(D8);
PowerMonitor pm;

//Variabili globali.
//--------------------------------------------------------------------------------//

//Impostazioni del dispositivo.
SETTINGS_T settings;

int V_samples[SAMPLES], I_samples[SAMPLES];

bool active = true;		//Attivazione del datalogging.
bool config = false;	//Modalita' di configurazione: true solo se la connessione al WiFi fallisce.

unsigned long t0;

//Codice.
//--------------------------------------------------------------------------------//

void setup(){
	//PIN.
	pinMode(LED_BUILTIN, OUTPUT);
	pinMode(COIL, OUTPUT);

	digitalWrite(COIL, active);

	//Configurazione del WiFi.
	if(!LittleFS.begin())
    ESP.restart();

	ESPhttpUpdate.setLedPin(LED_BUILTIN, LOW);

	//Caricamento impostazioni da settings.bin.
	loadSettings();

	WiFi.mode(WIFI_STA);
	WiFi.begin(settings.ssid, settings.pass);

	//Attendo la connessione al WiFi con 10 tentativi.
	int attempt = 0;
	while(WiFi.status() != WL_CONNECTED && attempt < 10){
		digitalWrite(LED_BUILTIN, LOW);
		delay(500);
		digitalWrite(LED_BUILTIN, HIGH);
		delay(500);

		attempt++;
  }

	//Se non riesco a connettermi.
	if(attempt >= 10){
		//Apertura dell'hotspot.
		WiFi.disconnect();
		WiFi.softAP(SOFTAP_SSID);

		//Disattivo il logging e mi metto in modalita' di configurazione.
		config = true;

		digitalWrite(LED_BUILTIN, LOW);
	}

	server.on("/networks", HTTP_GET, [](){
		digitalWrite(LED_BUILTIN, LOW);

		DynamicJsonDocument json(1024);
		int n = WiFi.scanNetworks();

		for(int i=0; i<n; i++){
			json[i]["ssid"] = WiFi.SSID(i);
			json[i]["rssi"] = WiFi.RSSI(i) * (-1);
		}

		String res;
		serializeJson(json, res);

		server.send(200, "application/json", res);

		digitalWrite(LED_BUILTIN, HIGH);
	});

	server.on("/update/wifi", HTTP_POST, [](){
		strcpy(settings.ssid, server.arg("ssid").c_str());
		strcpy(settings.pass, server.arg("pass").c_str());
		saveSettings();

		server.send(200);

		delay(500);
		ESP.restart();
	});

	server.on("/update/name", HTTP_POST, [](){
		strcpy(settings.name, server.arg("name").c_str());
		saveSettings();

		//Abilitazione CORS per XmlHttpRequest browser-side.
		server.sendHeader("Access-Control-Allow-Origin", "*");
		server.send(200);
	});

	server.on("/update/fw", HTTP_POST, [](){
		server.send(200, "text", "Updating firmware...");

		WiFiClient client;
		String url = "http://" + server.client().remoteIP().toString() + ":5500/firmware.bin";

		ESPhttpUpdate.update(client, url);
		ESP.restart();
	});

	server.on("/update/fs", HTTP_POST, [](){
		server.send(200, "text", "Updating LittleFS image...");

		WiFiClient client;
		String url = "http://" + server.client().remoteIP().toString() + ":5500/littlefs.bin";

		ESPhttpUpdate.updateFS(client, url);
		ESP.restart();
	});

	server.on("/alive", HTTP_GET, [](){
		DynamicJsonDocument json(1024);

		json["device"] = F("PowerMonitor");
		json["name"] = settings.name;
		json["ssid"] = settings.ssid;
		json["ip"] = WiFi.localIP();

		String res;
		serializeJson(json, res);

		//Abilitazione CORS per XmlHttpRequest browser-side.
		server.sendHeader("Access-Control-Allow-Origin", "*");
		server.send(200, "application/json", res);
	});

	server.serveStatic("/settings.bin", LittleFS, "/settings.bin");
	server.serveStatic("/", LittleFS, "/public/");
	
	server.begin();

	//Setup MQTT.
	mqtt.setServer(MQTT_SERVER, MQTT_PORT);
	mqtt.setCallback([](char *topic, byte *payload, unsigned int length){
		if(strcmp(topic, REQUEST_TOPIC) == 0){
			DynamicJsonDocument json(1024);
			deserializeJson(json, (char *)payload);

			//Filtro i messaggi per ricevere solo i miei.
			if(strcmp(json["name"], settings.name) == 0 && strcmp(json["ip"], WiFi.localIP().toString().c_str()) == 0){
				int action = json["action"];

				switch(action){
					case 0:
					case 1:
						active = json["action"];

					case 2:
						json.clear();

						json["name"] = settings.name;
						json["ip"] = WiFi.localIP();
						json["active"] = active;
						
						String res;
						serializeJson(json, res);

						mqtt.publish(POWER_TOPIC, res.c_str());
						break;
				}
			}

			digitalWrite(COIL, active);
		}
	});

	setupPowerMonitor();
	randomSeed(micros());
}

void loop(){
	t0 = millis() + 1000;

	if(mqtt.connected()){
		//Acquisizione dei campioni e calcolo.
		for(int i=0; i<SAMPLES; i++){
			V_samples[i] = adc.read(0);
			I_samples[i] = adc.read(1);

			delayMicroseconds(100);
		}

		pm.calculate();
		mqtt.publish(DATA_TOPIC, parseJSON(pm).c_str());
	}

	do{
		//Se il server MQTT viene riavviato, tenta di riconnetterti (o connettiti al primo tentativo).
		if(!config && !mqtt.connected())
			reconnect();

		else
			mqtt.loop();
		
		server.handleClient();
	} while(millis() < t0 || !active || config);
}

//Definizione delle funzioni.
//--------------------------------------------------------------------------------//

void reconnect(){
	//Create a random client ID.
	String id = F("PowerMonitor-Publisher-");
	id += String(random(0xffff), HEX);

	//Attempt to connect.
	if(mqtt.connect(id.c_str()))
		mqtt.subscribe(REQUEST_TOPIC);			//Once connected, resubscribe.
	else
		delay(1000);
}

void saveSettings(){
	File file = LittleFS.open("/settings.bin", "w");
	file.write((uint8_t *) &settings, sizeof(SETTINGS_T));
	file.close();
}

void loadSettings(){
	File file = LittleFS.open("/settings.bin", "r");

	if(file){
		file.read((uint8_t *) &settings, sizeof(SETTINGS_T));
		file.close();
	}
	else{
		strcpy(settings.name, "New_PowerMonitor_device");
		strcpy(settings.ssid, "STASSID");
		strcpy(settings.pass, "STAPSK");
	}
}

void setupPowerMonitor(){
	//Se si dichiara qui', una volta usciti dalla funzione, verra' risparmiato un po' di spazio in RAM.
	PM_Parameters parameters;

	parameters.sampleRate = 10000;
	parameters.bitResolution = 12;
	parameters.ADCMaxVoltage = 3.3;

	parameters.transformerRatio = 0.144;
	parameters.voltageDividerRatio = 0.01;

	parameters.currentClampRatio = 0.0005;
	parameters.currentClampResistor = 220;

	parameters.V_correctionFactor = 0.024;
	parameters.I_correctionFactor = 120;

	pm.setDataReference(V_samples, I_samples, SAMPLES);
	pm.setDataParameters(parameters);
}

String parseJSON(PowerMonitor &pm){
	DynamicJsonDocument json(1024);
	String str;
	char tmp[64];

	sprintf(tmp, "%.1f", pm.getV_PositivePeak());
	json["v"]["p_p"] = strtod(tmp, NULL);

	sprintf(tmp, "%.1f", pm.getV_NegativePeak());
	json["v"]["n_p"] = strtod(tmp, NULL);

	sprintf(tmp, "%.1f", pm.getVpp());
	json["v"]["pp"] = strtod(tmp, NULL);

	sprintf(tmp, "%.1f", pm.getVrms());
	json["v"]["rms"] = strtod(tmp, NULL);

	sprintf(tmp, "%.3f", pm.getI_PositivePeak());
	json["i"]["p_p"] = strtod(tmp, NULL);

	sprintf(tmp, "%.3f", pm.getI_NegativePeak());
	json["i"]["n_p"] = strtod(tmp, NULL);

	sprintf(tmp, "%.3f", pm.getIpp());
	json["i"]["pp"] = strtod(tmp, NULL);

	sprintf(tmp, "%.3f", pm.getIrms());
	json["i"]["rms"] = strtod(tmp, NULL);

	sprintf(tmp, "%.2f", pm.apparentPower());
	json["p"]["VA"] = strtod(tmp, NULL);

	sprintf(tmp, "%.2f", pm.activePower());
	json["p"]["W"] = strtod(tmp, NULL);

	sprintf(tmp, "%.2f", pm.reactivePower());
	json["p"]["VAr"] = strtod(tmp, NULL);

	sprintf(tmp, "%.3f", pm.powerFactor());
	json["p"]["pf"] = strtod(tmp, NULL);

	json["name"] = settings.name;
	json["ip"] = WiFi.localIP();

	serializeJson(json, str);
	return str;
}

//--------------------------------------------------------------------------------//
