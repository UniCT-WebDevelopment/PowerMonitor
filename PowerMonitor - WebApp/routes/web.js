var express = require("express");
var router = express.Router();

const os = require("os");
const fs = require("fs");

const ipInt = require("ip-to-int");
const $ = require("najax");

const mqtt = require("mqtt");
const mongoose = require("mongoose");
const tf = require("@tensorflow/tfjs-node");
const { exit } = require("process");
const ipToInt = require("ip-to-int");

console.clear();

//Costanti per checkErrors: indicano le massime e le minime finestre temporali che il client puo' specificare.
const TIME_LIMITS = {
	MAX:	{
		DAY:		183,
		HOUR:		48,
		MINUTE:	180,
		SECOND:	180,
	},

	MIN:	{
		DAY:		2,
		HOUR:		2,
		MINUTE:	15,
		SECOND:	30,
	}
}

//Costanti per l'incremento di un timestamp.
const DATETIME = {
	DAY:		1000 * 3600 * 24,
	HOUR:		1000 * 3600,
	MINUTE:	1000 * 60,
	SECOND:	1000
}

//Topic MQTT.
const REQUEST_TOPIC = "/PowerMonitor";
const DATA_TOPIC = "/PowerMonitor/data";
const POWER_TOPIC = "/PowerMonitor/state/data";

//Connessioni.
let connection;

//Riferimento al database.
let db;

//Json da file settings.json.
let settings;

//Lista di dispositivi registrati nel db.
let devices;

//Models del db.
let Value, Device, ValuesPerHour, PredictedValuesPerHour;

(async () => {
	connection = JSON.parse(await fs.promises.readFile("./data/connection.json"));

	//Setup di MongoDB, MQTT e del file settings.json.
	mongoose.connect("mongodb://" + connection.MONGO_SERVER + REQUEST_TOPIC, {
		useNewUrlParser:		true,
		useUnifiedTopology:	true,
		useFindAndModify:		false
	});

	db = mongoose.connection;

	db.on("error", () => {
		console.error("Impossibile effettuare la connessione al database all'indirizzo %s; uscita.", connection.MONGO_SERVER);
		exit(-1);
	});

	//Attendo l'apertura della connessione con il db.
	db.once("open", async () => {
		//------------------------------ SETUP DB ------------------------------//

		//Schema: descrizione del tipo di un record nella collection.

		//Collection di dati loggati.
		const ValueSchema = new mongoose.Schema({
			vrms:				Number,
			VA:					Number,
			W:					Number,
			timestamp:	Date,
			_cod:				String
		});

		//Collection di dati loggati raggruppati per ore.
		const ValuesPerHourSchema = new mongoose.Schema({
			vrms:				Number,
			VA:					Number,
			W:					Number,
			timestamp:	Date,
			_cod:				String
		});

		//Collection di dati predetti raggruppati per ore (usata solamente come buffer).
		const PredictedValuesPerHourSchema = new mongoose.Schema({
			vrms:				Number,
			VA:					Number,
			W:					Number,
			timestamp:	Date,
			_cod:				String
		});

		//Collection dei dispositivi registrati.
		const DeviceSchema = new mongoose.Schema({
			name:	String,
			ip:		String
		});
		
		//Model: hook ai dati di tipo ValueSchema della collection values (con la "s", tipo su Laravel che li mette al plurale).
		Value = mongoose.model("value", ValueSchema);
		ValuesPerHour = mongoose.model("values_per_hour", ValuesPerHourSchema);
		PredictedValuesPerHour = mongoose.model("predicted_values_per_hour", PredictedValuesPerHourSchema);
		Device = mongoose.model("device", DeviceSchema);

		//Leggo da db tutti i dati dei dispositivi registrati.
		devices = await getDevices();

		//------------------------------ SETUP MQTT ------------------------------//

		//Client MQTT.
		let client = mqtt.connect("mqtt://" + connection.MQTT_SERVER, {clientId: "PowerMonitor-Server"});
		
		client.on("connect", () => client.subscribe(DATA_TOPIC, {qos: 1}));
		client.on("error", error => console.log("MQTT connection error: " + error));

		//Massimo 60 campioni nel buffer.
		const DB_BUFFER_MAXLEN = 60;

		//Buffer di salvataggio dati.
		const db_buffer = [];

		client.on("message", async (topic, message, packet) => {
			switch(topic){
				case DATA_TOPIC:
					//Converto in oggetto i dati ricevuti da MQTT in JSON.
					const mqtt_data = JSON.parse(message.toString());

					//Tra tutti i dispositivi registrati, cerco l'id di quello interessato.
					let dev_id;

					devices.forEach(e => {
						if(e.ip == mqtt_data.ip && e.name == mqtt_data.name)
							dev_id = e.id;
					});

					//Se il dispositivo che invia dati non e' registrato, allora i dati non verranno salvati.
					if(!dev_id)
						return;

					//Converto i dati nel formato della collection del db.
					const db_data = new DB_Data(mqtt_data, new Date(), dev_id);

					//Salvo nel buffer il dato creato.
					db_buffer.push(db_data);
					
					//Se il buffer e' pieno, si salvano i dati nella collection del db.
					if(db_buffer.length >= DB_BUFFER_MAXLEN){
						// await Value.insertMany(db_buffer);
						db_buffer.splice(0);
					}
					break;
			}
		});

		//------------------------------ SETUP DATI DA FILE ------------------------------//

		settings = JSON.parse(await fs.promises.readFile("./data/settings.json"));
	});
})();

//------------------------------ Pagine web ------------------------------//

router.get("/dispositivi", async (req, res) => res.render("dispositivi", {
	css: ["/css/dispositivi.css"],
	js: ["/js/dispositivi.js"],

	title:				"PowerMonitor",
	header_text:	"Seleziona il dispositivo da monitorare",
	footer_text:	"PowerMonitor",
	menu_select:	0,

	selected_device:	settings.last_selected_device_id,

	//Codice con il quale e' stata chiamata la pagina (ad esempio se c'e' stato un errore che deve essere comunicato).
	code:					req.query.code,

	//Lista di dispositivi registrati.
	devices:			devices
}));

//Una route puo' anche essere definita cosi'.
router.route(["/", "/dashboard"])
	.get(async (req, res) => {
		const query = await getDevice();

		if(query)
			res.render("dashboard", {
				css: ["/css/dashboard.css"],
				js: [
					"/js/dashboard.js",
					"/js/chart-3.4.1.js",
					"/js/mqttws31.js"
				],

				title:				"PowerMonitor",
				header_text:	"Dati in real time",
				footer_text:	"Dispositivo monitorato: " + query.name,
				menu_select:	1,		//Elemento del menu' da selezionare (da colorare di bianco).

				MQTT_SERVER:		connection.MQTT_SERVER,
				REQUEST_TOPIC:	REQUEST_TOPIC,
				DATA_TOPIC:			DATA_TOPIC,
				POWER_TOPIC:		POWER_TOPIC,

				device:	{
					name:	query.name,
					ip:		query.ip
				}
			});
		
		else
			res.redirect("/dispositivi?code=1");
	});

router.get("/consumi", async (req, res) => {
	const query = await getDevice();
	
	if(query)
		res.render("consumi", {
			css: ["/css/consumi.css"],
			js: [
				"/js/consumi.js",
				"/js/chart-3.4.1.js"
			],
		
			title:				"PowerMonitor",
			header_text:	"Dati registrati",
			footer_text:	"Dispositivo monitorato: " + query.name,
			menu_select:	2
		});

	else
		res.redirect("/dispositivi?code=1");
});

//------------------------------ Endpoint di /consumi ------------------------------//

//Dati dal database.
router.get("/data", async (req, res) => {
	//JSON finale.
	const final = {
		state:	0,
		error:	null,
		values:	null
	}

	//Controllo errori nella richiesta.
	let check = checkErrors(req.query.group, req.query.from, req.query.to);
	if(check.error != null){
		final.state = 1;
		final.error = check.error;

		res.json(final);
		return;
	}

	//Se il parametro interpolation non e' definito, allora di default e' true.
	const interpolation = req.query.interpolation ? false : true;
	const group = req.query.group;
	let from = check.from;
	let to = check.to;

	check = await getData(group, from, to);
	if(check.error != null){
		final.state = 2;
		final.error = check.error;

		res.json(final);
		return;
	}

	const limit = check.limit;
	const date_inc = check.date_inc;
	const date_substr = check.date_substr;
	const ret = check.ret;

	if(!interpolation){
		final.values = ret.reverse();
		res.json(final);
		return;
	}

	/* ---------------------------------------- Interpolazione ---------------------------------------- */
	
	//Array con i valori di ritorno.
	const refined = [];

	//Dato che i dati sono dal piu' nuovo al piu' vecchio, inizio dalla data 'to'.
	const now = new Date(to.getTime() + date_inc);
	let busy = 0;
	let i = 0;

	//Inizio interpolazione.
	while(busy < limit){
		//Se ci sono ancora elementi dal db che posso leggere e se la data a cui sono arrivato (now) e' <= dell'i-esimo elemento del db.
		//Non e' un confronto tra date, ma un confronto tra stringhe ISO UTC che rappresentano le informazioni rilevanti della data in base
		//al raggruppamento che e' stato selezionato.
		now.setTime(now.getTime() - date_inc);

		if(i < ret.length && now.toISOString().substring(0, date_substr) <= ret[i].timestamp.toISOString().substring(0, date_substr))
			refined.push(ret[i++]);

		else
			refined.push(new DB_Data(
				new MQTT_Data(),
				new Date(now)
			));
		
		busy++;
	}

	//Dal piu' vecchio al piu' nuovo.
	final.values = refined.reverse();
	res.json(final);
});
//Mutex per quando il modello sta venendo trainato o per quando si sta facendo del fine tuning.
let model_mutex = false;

//Impostazioni per model.compile().
const compile_options = {
	optimizer:	tf.train.adam(),
	loss:				tf.losses.meanSquaredError,
	metrics:		["mse"]
};

//Train per la predizione di dati.
router.get("/train", (req, res) => {
	//Per la gestione automatica del garbage collector per i tensori.
	tf.tidy(() => {
		//tidy non accetta una funzione asincrona come parametro.
		(async () => {
			//JSON finale.
			const final = {
				state:	0,
				error:	null
			}

			//Se qualcuno sta usando la risorsa.
			if(model_mutex){
				final.state = -1;
				final.error = "Un fine tuning o un train sono gia' in corso; attendere.";
				
				res.json(final);
				return;
			}

			//Abbasso il mutex.
			model_mutex = true;

			//Ultimo dispositivo selezionato.
			const dev_id = settings.last_selected_device_id;

			//Vedo se nella collection values_per_hour ci sono dati relativi al dispositivo attualmente selezionato.
			const empty = (await ValuesPerHour.findOne( { _cod: dev_id } )) ? false : true;

			//Si usa per raggruppare i dati per ora.
			const format = "%d/%m/%Y %H";

			//Conterra' i dati da passare a tensorflow.
			let data;

			//Bufferizzazione dati raggruppati per ore.
			//Se e' vuota, la riempio con tutti i dati raggruppati per ore.
			if(empty){
				//Raggruppamento di tutti i dati per ora.
				//Dal piu' nuovo al piu' vecchio.
				data = await Value.aggregate([
					{
						$match:	{ _cod:	dev_id }
					},
					{
						$project:	{
							_id:	0,
							vrms:	1,
							VA:		1,
							W:		1,
							timestamp:	{ $dateToString: { format: format, date: "$timestamp" } },
							_cod:	1
						}
					},
					{
						$group: {
							//GROUP BY timestamp, _cod
							_id:	{
								timestamp:	"$timestamp",
								_cod:				"$_cod"
							},
							vrms: { $avg: "$vrms" },
							VA:		{ $avg: "$VA" },
							W:		{ $avg: "$W" },
						}
					},
					{
						$project: {
							_id:	0,
							vrms:	{ $trunc: ["$vrms", 1] },
							VA:		{ $trunc: ["$VA", 2] },
							W:		{ $trunc: ["$W", 2] },
							timestamp:	{ $dateFromString: { format: format, dateString: "$_id.timestamp" } },
							_cod:	"$_id._cod"
						}
					},
					{ $sort: { timestamp: 1 } }
				]);

				//Inserisco tutti i dati raggruppati per ore. 
				await ValuesPerHour.insertMany(data);
			}

			//Altrimenti, prendo dalla collection values tutti i document maggiori dell'ultimo in values_per_hour,
			//li raggruppo per ore e li appendo a values_per_hour, aggiornando cosi' la collection.
			else{
				//La data del record piu' recente.
				const latest = new Date((
					await ValuesPerHour
						.find({ _cod: dev_id })
						.sort({ timestamp: "desc" })
						.limit(1)
				)[0].timestamp);

				//Un'ora avanti, cosi' nella query posso filtrare prima del raggruppamento e tutto e' piu' veloce.
				latest.setHours(latest.getHours() + 1);

				//Tutti i record raggruppati per ore, piu' recenti di latest.
				const add = await Value.aggregate([
					{
						$match:	{
							timestamp:	{
								$gte:	latest,
							},
							_cod:	dev_id
						}
					},
					{
						$project:	{
							_id:	0,
							vrms:	1,
							VA:		1,
							W:		1,
							timestamp:	{ $dateToString: { format: format, date: "$timestamp" } },
							_cod:	1
						}
					},
					{
						$group: {
							//GROUP BY timestamp, _cod
							_id:	{
								timestamp:	"$timestamp",
								_cod:				"$_cod"
							},
							vrms: { $avg: "$vrms" },
							VA:		{ $avg: "$VA" },
							W:		{ $avg: "$W" },
						}
					},
					{
						$project: {
							_id:	0,
							vrms:	{ $trunc: ["$vrms", 1] },
							VA:		{ $trunc: ["$VA", 2] },
							W:		{ $trunc: ["$W", 2] },
							timestamp:	{ $dateFromString: { format: format, dateString: "$_id.timestamp" } },
							_cod:	"$_id._cod"
						}
					},
					{ $sort: { timestamp: 1 } }
				]);

				//Inserisco tutti i dati nuovi trovati.
				await ValuesPerHour.insertMany(add);

				//Infine, recupero tutti i dati raggruppati per ore.
				data = await ValuesPerHour.find();

				// Se ci sono valori strani, dove sono presenti solamente _id e __v,
				// (causa sconosciuta), immettere questa query in una mongosh.
				// db.values_per_hours.deleteMany({_cod: null})
			}

			//Train.
			tf.util.shuffle(data);

			//Tensori di input ed output.
			const values = normalizeData(getInputs(data), getExpected(data));

			//Creo il modello.
			const model = tf.sequential();

			//Aggiungo dei livelli al modello.
			model.add(tf.layers.dense({
				inputShape:	[5],
				units:			5,
				// activation:	"softmax"
			}));
		
			model.add(tf.layers.dense({
				units:	18,
				// activation:	"relu"
			}));
		
			model.add(tf.layers.dense({
				units:	3,
				// activation:	"relu"
			}));

			//Compilo il modello specificando le varie impostazioni.
			model.compile(compile_options);
		
			//Alleno il modello.
			try{
				await model.fit(values.input, values.expected, {
					epochs:		200,
					shuffle:	true
				});
			}
			catch(e){
				final.state = 1;
				final.error = "Il train del modello e' fallito: " + e;

				//Alzo il mutex.
				model_mutex = false;
				
				res.json(final);
				return;
			}

			//Salvo il modello.
			try{
				const device = await getDevice();
				await model.save("file://./data/model/" + device.name);
			}
			catch(e){
				final.state = 2;
				final.error = "Il salvataggio del modello e' fallito: " + e;

				//Alzo il mutex.
				model_mutex = false;
				
				res.json(final);
				return;
			}

			//Alzo il mutex.
			model_mutex = false;

			res.json(final);
		})();
	});
});

//Train per la predizione di dati.
router.get("/tune", (req, res) => {
	//Per la gestione automatica del garbage collector per i tensori.
	tf.tidy(() => {
		//tidy non accetta una funzione asincrona come parametro.
		(async () => {
			//JSON finale.
			const final = {
				state:	0,
				error:	null
			}

			//Se qualcuno sta usando la risorsa.
			if(model_mutex){
				final.state = -1;
				final.error = "Un fine tuning o un train sono gia' in corso; attendere.";

				res.json(final);
				return;
			}

			//Abbasso il mutex.
			model_mutex = true;

			//Caricamento modello pre-esistente.
			let model, device;
			try{
				device = await getDevice();
				model = await tf.loadLayersModel("file://./data/model/" + device.name + "/model.json");
			}
			catch(e){
				final.state = 1;
				final.error = "Il caricamento del modello e' fallito: " + e;

				//Alzo il mutex.
				model_mutex = false;
				
				res.json(final);
				return;
			}

			//Ultimo dispositivo selezionato.
			const dev_id = settings.last_selected_device_id;

			//Vedo se nella collection values_per_hour ci sono dati relativi al dispositivo attualmente selezionato.
			const empty = (await ValuesPerHour.findOne( { _cod: dev_id } )) ? false : true;

			//Si usa per raggruppare i dati per ora.
			const format = "%d/%m/%Y %H";

			//Conterra' i dati da passare a tensorflow.
			let data;

			//Se la collection values_per_hours e' vuota, si deve prima chiamare /train.
			if(empty){
				final.state = 2;
				final.error = "Il fine tuning del modello e' fallito: chiamare prima /train per creare un nuovo modello.";

				//Alzo il mutex.
				model_mutex = false;
				
				res.json(final);
				return;
			}

			//Prendo dalla collection values tutti i document maggiori dell'ultimo in values_per_hour,
			//li raggruppo per ore e li appendo a values_per_hour, aggiornando cosi' la collection.

			//La data del record piu' recente.
			const latest = new Date((
				await ValuesPerHour
					.find({ _cod: dev_id })
					.sort({ timestamp: "desc" })
					.limit(1)
			)[0].timestamp);

			//Un'ora avanti, cosi' nella query posso filtrare prima del raggruppamento ed e tutto e' piu' veloce.
			latest.setHours(latest.getHours() + 1);

			//Tutti i record raggruppati per ore, piu' recenti di latest.
			data = await Value.aggregate([
				{
					$match:	{
						timestamp:	{
							$gte:	latest,
						},
						_cod:	dev_id
					}
				},
				{
					$project:	{
						_id:	0,
						vrms:	1,
						VA:		1,
						W:		1,
						timestamp:	{ $dateToString: { format: format, date: "$timestamp" } },
						_cod:	1
					}
				},
				{
					$group: {
						//GROUP BY timestamp, _cod
						_id:	{
							timestamp:	"$timestamp",
							_cod:				"$_cod"
						},
						vrms: { $avg: "$vrms" },
						VA:		{ $avg: "$VA" },
						W:		{ $avg: "$W" },
					}
				},
				{
					$project: {
						_id:	0,
						vrms:	{ $trunc: ["$vrms", 1] },
						VA:		{ $trunc: ["$VA", 2] },
						W:		{ $trunc: ["$W", 2] },
						timestamp:	{ $dateFromString: { format: format, dateString: "$_id.timestamp" } },
						_cod:	"$_id._cod"
					}
				},
				{ $sort: { timestamp: 1 } }
			]);

			if(!data.length){
				final.state = 3;
				final.error = "Il fine tuning del modello e' fallito: non sono presenti dei dati recenti con cui fare il fine tuning.";

				//Alzo il mutex.
				model_mutex = false;
				
				res.json(final);
				return;
			}

			//Inserisco tutti i dati nuovi trovati (solamente per aggiornare la tabella).
			await ValuesPerHour.insertMany(data);

			//Fine tuning.
			tf.util.shuffle(data);

			//Tensori di input ed output.
			const values = normalizeData(getInputs(data), getExpected(data));
			
			//Compilo il modello specificando le varie impostazioni.
			model.compile(compile_options);

			//Supponendo che il modello sia gia' trainato con i dati gia' presenti in values_per_hours,
			//aggiungo i nuovi dati in "data" al modello cosi' da poter fare fine tuning.
			try{
				await model.fit(values.input, values.expected, {
					epochs:		50,
					shuffle:	true
				});
			}
			catch(e){
				final.state = 4;
				final.error = "Il fine tuning del modello e' fallito: " + e;

				//Alzo il mutex.
				model_mutex = false;
				
				res.json(final);
				return;
			}

			//Salvo il modello.
			try{
				await model.save("file://./data/model/" + device.name);
			}
			catch(e){
				final.state = 5;
				final.error = "Il salvataggio del modello e' fallito: " + e;

				//Alzo il mutex.
				model_mutex = false;
				
				res.json(final);
				return;
			}

			//Alzo il mutex.
			model_mutex = false;

			res.json(final);
		})();
	});
});

//Inferenze per la predizione di dati.
router.get("/predict", (req, res) => {
	tf.tidy(() => {
		(async () => {
			//JSON finale.
			const final = {
				state:	0,
				error:	null,
				values:	null
			}

			//Se qualcuno sta modificando la risorsa.
			if(model_mutex){
				final.state = -1;
				final.error = "Un fine tuning o un train sono in corso; attendere.";

				res.json(final);
				return;
			}

			//":00" e non ":00Z" perche' il tempo in input e' locale e non UTC.
			let from = req.query.from.substring(0, 13) + ":00";
			let to = req.query.to.substring(0, 13) + ":00";

			const group = req.query.group;

			//Controllo errori nella richiesta.
			const check = checkErrors(group, from, to);
			if(check.error != null){
				final.state = 1;
				final.error = check.error;

				res.json(final);
				return;
			}

			//Caricamento modello.
			let model, device;
			try{
				device = await getDevice();
				model = await tf.loadLayersModel("file://./data/model/" + device.name + "/model.json");
			}
			catch(e){
				final.state = 2;
				final.error = "Il caricamento del modello e' fallito: " + e;
				
				res.json(final);
				return;
			}

			//Calcolo tensore di input.
			const data = [];
			const now = new Date(from);

			from = new Date(from);
			to = new Date(to);

			while(now <= to){
				data.push({ timestamp: new Date(now) });
				now.setTime(now.getTime() + DATETIME.HOUR);
			}

			//Input.
			const values = normalizeData(getInputs(data)).input;

			//Predizioni.
			const predictions = unNormalizeData(model.predict(values));

			//Conversione dati.
			const output = (await predictions.array())
				.map((e, i) => new Prediction(e[0], e[1], e[2], data[i].timestamp));
			
			//Cancello le vecchie predizioni da predicted_values_per_hours...
			await PredictedValuesPerHour.deleteMany({});

			// Vecchio codice per mantenere le predizioni future gia' fatte nella collection...
			// $or:	[
			// 	{
			// 		timestamp:	{
			// 			$gte:	from,
			// 			$lte:	to
			// 		}
			// 	},
			// 	{
			// 		timestamp:	{
			// 			$lte:	new Date()
			// 		}
			// 	}
			// ]

			//...e le rimpiazzo con quelle nuove.
			await PredictedValuesPerHour.insertMany(output.map(e => ({ ...e, _cod: device._id })));

			//Se non vogliamo raggruppare i dati per un'unita' di tempo maggiore delle ore, ritorno subito i dati predetti.
			if(group == 'h'){
				final.values = output;
				res.json(final);
			}
			
			//Altrimenti, raggruppo i dati e li torno.
			else{
				const db_data = await getData(group, from, to, PredictedValuesPerHour);
			
				if(db_data.error != null){
					final.state = 3;
					final.error = check.error;

					res.json(final);
					return;
				}

				final.values = db_data.ret;
				res.json(final);
			}
		})();
	});
});

//------------------------------ Endpoint di /dispositivi ------------------------------//

//Aggiunta di un dispositivo.
router.post("/device/add", async (req, res) => {
	const device = {
		name:	req.body.name,
		ip:		req.body.ip
	}

	//Controllo se il dispositivo e' gia' stato registrato in precedenza.
	let add = true;
	devices.forEach(e => {
		if(device.name == e.name && device.ip == e.ip)
			add = false;
	});

	if(add){
		//Salvo nel db.
		const value = new Device(device);
		await value.save();

		//Aggiorno dal db la lista locale dei dispositivi registrati.
		devices = await getDevices();

		res.sendStatus(200);
	}
	else
		//Il dispositivo e' gia' stato registrato.
		res.sendStatus(500);
});

//Cancellazione di uno dei dispositivi.
router.post("/device/delete", async (req, res) => {
	await Device.deleteOne({ _id: req.body.device_id });
	await Value.deleteMany({ _id: req.body.device_id });

	devices = await getDevices();

	res.sendStatus(200);
});

//Selezione del dispositivo da monitorare.
router.post("/device/select", async (req, res) => {
	settings.last_selected_device_id = req.body.device_id;
	await fs.promises.writeFile("./data/settings.json", JSON.stringify(settings));

	res.sendStatus(200);
});

//Ricerca di dispositivi nella rete locale.
router.get("/device/search", (req, res) => {
	//Ottengo le informazioni sulle interfaccie di rete su cui e' in ascolto il server.
	const net = os.networkInterfaces();

	//Dispositivi trovati.
	const ret = [];

	//Totale indirizzi da scansionare.
	let tot = 0;

	//Indirizzi scansionati.
	let cont = 0;

	//Scansione dei dispositivi.
	Object.keys(net).forEach(interface => {
		net[interface].forEach(e => {
			if(e.family == "IPv4" && e.address != "127.0.0.1"){
				//Calcolo l'indirizzo della rete (>>> 0 shifta di 0 posizioni castando ad unsigned int).
				const base = (ipInt(e.address).toInt() & ipInt(e.netmask).toInt()) >>> 0;
	
				//Calcolo il numero di indirizzi IPv4 nella rete basandomi sulla Netmask.
				const n = Math.pow(2, (32 - parseInt(e.cidr.substring(e.cidr.indexOf("/") + 1))));
	
				//Al totale indirizzi da scansionare, tolgo i due indirizzi della rete e del broadcast...
				tot += n - 2;
				
				//Parto da 1 e finisco ad n-1 per saltare indirizzo di rete e di broadcast. 
				for(let i=1; i<n-1; i++){
					const device_ip = ipInt(base + i).toIP();
	
					$.get("http://" + device_ip + "/alive")
						.success(resolved)
						.error(rejected);
				}
			}
		});
	});

	//Quando la get ad un indirizzo finisce bene.
	function resolved(data){
		data = JSON.parse(data);

		//Se e' effettivamente un dispositivo PowerMonitor.
		if(data.device == "PowerMonitor"){
			delete data.device;
			ret.push(data);
		}

		reply();
	}

	//Quando la get ad un indirizzo finisce male.
	function rejected(error){
		reply();
	}
	
	//In tutti e due i casi, incrementa il contatore; se si arrivano a scansionare tutti gli indirizzi: fine.
	async function reply(){
		cont++;

		//Se la scansione e' finita.
		if(cont == tot)
			res.json(ret);
	}
});

router.post("/device/change/name", async (req, res) => {
	await Device.findOneAndUpdate(
		{
			name:	req.body.name,
			ip:		req.body.ip
		},
		{
			name: req.body.new_name
		}
	);

	devices = await getDevices();
	res.sendStatus(200);
});

router.post("/device/change/ip", async (req, res) => {
	try{
		ipInt(req.body.new_ip).toInt();
		
		await Device.findOneAndUpdate(
			{
				name:	req.body.name,
				ip:		req.body.ip
			},
			{
				ip:	req.body.new_ip
			}
		);

		devices = await getDevices();
		res.sendStatus(200);
	}
	catch(e){
		//IP non valido.
		res.sendStatus(500);
	}
});

//------------------------------ Funzioni ------------------------------//

/*
	Verifica:
		-	Se le date inserite sono valide.
		-	Se la data finale e' antecedente a quella iniziale.
		-	Che i dati richiesti rientrino in un range temporale minimo e massimo dipendente del raggruppamento voluto dei dati.
		-	Se il raggruppamento dei dati selezionato e' valido.
	
	Parametri:
		char		group:		tipo di raggruppamento dei dati voluto.
		string	from, to:	stringa di una data (in ISO).

*/
function checkErrors(group, from, to){
	//JSON finale.
	const final = {
		error:	null,
		form:		null,
		to:			null
	}

	//Controllo di validita' delle date.
	if(from == "" || to == "" || Date.parse(from) == NaN || Date.parse(to) == NaN){
		final.error = "Una delle due date inserite non e' valida.";
		return final;
	}

	from = new Date(from);
	to = new Date(to);
	
	if(to <= from){
		final.error = "La data finale selezionata e' antecedente o uguale a quella iniziale.";
		return final;
	}

	let min, max, time_slice = to - from;
	let err_min, err_max;
	
	switch(group){
		case 'd':
			min = DATETIME.DAY * TIME_LIMITS.MIN.DAY;
			max = DATETIME.DAY * TIME_LIMITS.MAX.DAY;

			err_min = TIME_LIMITS.MIN.DAY + " giorni";
			err_max = TIME_LIMITS.MAX.DAY + " giorni";

			time_slice /= DATETIME.DAY;
			break;
		
		case 'h':
			min = DATETIME.HOUR * TIME_LIMITS.MIN.HOUR;
			max = DATETIME.HOUR * TIME_LIMITS.MAX.HOUR;

			err_min = TIME_LIMITS.MIN.HOUR + " ore";
			err_max = TIME_LIMITS.MAX.HOUR + " ore";

			time_slice /= DATETIME.HOUR;
			break;
		
		case 'm':
			min = DATETIME.MINUTE * TIME_LIMITS.MIN.MINUTE;
			max = DATETIME.MINUTE * TIME_LIMITS.MAX.MINUTE;

			err_min = TIME_LIMITS.MIN.MINUTE + " minuti";
			err_max = TIME_LIMITS.MAX.MINUTE + " minuti";

			time_slice /= DATETIME.MINUTE;
			break;

		case 's':
			min = DATETIME.SECOND * TIME_LIMITS.MIN.SECOND;
			max = DATETIME.SECOND * TIME_LIMITS.MAX.SECOND;

			err_min = TIME_LIMITS.MIN.SECOND + " secondi";
			err_max = TIME_LIMITS.MAX.SECOND + " secondi";

			time_slice /= DATETIME.SECOND;
			break;
		
		default:
			final.error = "Gruppo selezionato non valido.";
			return final;
			break;
	}

	const delta = to - from;
	
	if(delta < min || delta > max){
		final.error = "La data deve essere compresa tra " + err_min + " e " + err_max + ";\nhai inserito un periodo di tempo di " + time_slice.toFixed(2) + group;
		return final;
	}
	
	final.from = from;
	final.to = to;
	return final;
}

/*
	Recupera i dati dal database raggruppati nel modo specificato.
	
	Parametri:
		char	group:		tipo di raggruppamento dei dati voluto.
		Date	from, to:	delle date valide.

*/
async function getData(group, from, to, collection = Value){
	//JSON finale.
	const final = {
		error:				null,
		limit:				null,
		date_inc:			null,
		date_substr:	null,
		ret:					null
	}

	//id relativo al dispositivo attualmente selezionato.
	const dev_id = settings.last_selected_device_id;

	//Servono piu' sotto nell'interpolazione.
	let date_inc, date_substr;

	//Serve alla fine dello switch.
	let date_suffix;

	//Campo per il quale vogliamo raggruppare i dati (solo quando li vogliamo raggruppare).
	let format;

	switch(group){
		case 'd':
			date_inc = DATETIME.DAY;
			date_substr = 10;
			date_suffix = "T00:00Z";

			format = "%d/%m/%Y";
			break;
		
		case 'h':
			date_inc = DATETIME.HOUR;
			date_substr = 13;
			date_suffix = ":00Z";

			format = "%d/%m/%Y %H";
			break;
		
		case 'm':
			date_inc = DATETIME.MINUTE;
			date_substr = 16;
			date_suffix = "Z";

			format = "%d/%m/%Y %H:%M";
			break;

		case 's':
			date_inc = DATETIME.SECOND;
			date_substr = 19;
			date_suffix = "Z";
			break;
	}

	//Tolgo dalle date tutte le informazioni non rilevanti e le converto in UTC;
	//la 'Z' indica che stiamo specificando una data UTC e non locale
	//(le date nel db sono trattate in UTC).
	from = new Date(from.toISOString().substring(0, date_substr) + date_suffix);
	to = new Date(to.toISOString().substring(0, date_substr) + date_suffix);

	//Numero di record che il client vuole.
	let limit = Math.floor((to - from) / date_inc);

	//Se no la query torna es: dalle 15:00:00 alle 15:02:59...
	to.setTime(to.getTime() + date_inc);
	limit++;

	/* ---------------------------------------- Query ---------------------------------------- */

	//In base al tipo di raggruppamento richiesto, cambia il formato della data (GROUP BY data).
	//Se vogliamo i secondi, i dati non saranno raggruppati.
	let ret;

	if(group == 's')
		//Dal piu' nuovo al piu' vecchio.
		ret = await collection
			.find(
				{	//Selezione.
					timestamp:	{
						$gte:	from,
						$lte:	to
					},

					_cod:	dev_id
				},
				{	//Proiezione.
					_id:	0,
					_cod:	0,
					__v:	0
				}
			)
			.limit(limit)
			.sort({timestamp: "desc"});

	else
		//Raggruppamento dei dati in base al gruppo specificato dal client.
		//Dal piu' nuovo al piu' vecchio.
		ret = await collection.aggregate([
			{
				$match:	{
					timestamp:	{
						$gte:	from,
						$lte:	to
					},

					_cod:	dev_id
				}
			},
			{
				$project:	{
					_id:	0,
					vrms:	1,
					VA:		1,
					W:		1,
					timestamp:	{ $dateToString: { format: format, date: "$timestamp" } }
				}
			},
			{
				$group: {
					_id:	"$timestamp",
					vrms: { $avg: "$vrms" },
					VA:		{ $avg: "$VA" },
					W:		{ $avg: "$W" },
				}
			},
			{
				$project: {
					_id:	0,
					vrms:	{ $trunc: ["$vrms", 1] },
					VA:		{ $trunc: ["$VA", 2] },
					W:		{ $trunc: ["$W", 2] },
					timestamp:	{ $dateFromString: { format: format, dateString: "$_id" } },
				}
			},
			{ $sort: { timestamp: -1 } },
			{ $limit: limit }
		]);

	//Se non sono stati ritornati dati dalla query, ritorna un errore.
	if(ret.length == 0){
		final.error = "Non sono presenti dati nell'intervallo di tempo specificato.";
		return final;
	}
	
	final.limit = limit;
	final.date_inc = date_inc;
	final.date_substr = date_substr;
	final.ret = ret;
	
	return final;
}

//Dispositivo attualmente selezionato nel db.
const getDevice = async () => await Device.findOne({ _id: settings.last_selected_device_id });

//Dispositivi registrati nel db.
async function getDevices(){
	const ret = await Device.find();
	const results = [];

	ret.forEach(async e => results.push(new ClientDevice(e)));

	return results;
}

//Da un timestamp, ricava gli imput corrispondenti da dare a tensorflow.
//data: dati da db.
function getInputs(data){
	//Input: timestamp, stagione, mese, settimana del mese, giorno della settimana, ora del giorno.
	const spring = "3-21", summer = "6-21", autumn = "9-21", winter = "12-21";

	// const timestamp = data.map(e => Date.parse(e.timestamp) / DATETIME.HOUR);
	const season = data.map(e => {
		const date_val = new Date(e.timestamp);
		const date = date_val.getMonth() + "-" + date_val.getDate();

		let season;
		if(date >= spring && date < summer)
			season = 1;		//Primavera.
			
		else if(date >= summer && date < autumn)
			season = 2;		//Estate.

		else if(date >= autumn && date < winter)
			season = 3;		//Autunno.

		else if(date >= winter && date < spring)
			season = 4;		//Inverno.

		return season;
	});

	const month = data.map(e => new Date(e.timestamp).getMonth());
	const week = data.map(e => {
		const day = new Date(e.timestamp).getDate();

		let q;
		if(day >= 1 && day < 8)
			q = 1;		//Primavera.
			
		else if(day >= 8 && day < 16)
			q = 2;		//Estate.

		else if(day >= 16 && day < 24)
			q = 3;		//Autunno.

		else if(day >= 24 && day < 32)
			q = 4;		//Inverno.

		return q;
	});

	const day = data.map(e => new Date(e.timestamp).getDay());
	const hour = data.map(e => new Date(e.timestamp).getHours());

	return { season, month, week, day, hour, length: season.length };
}

//Ritorna i 3 array contenenti vrms, VA, W.
//data: dati da db.
function getExpected(data){
	//Output: vrms, VA, W.

	const vrms = data.map(e => e.vrms);
	const VA = data.map(e => e.VA);
	const W = data.map(e => e.W);

	return { vrms, VA, W, length: vrms.length };
}

//Ritorna due tensor2d conteneti i dati normalizzati.
//input, expected: dati ottenuti rispettivamente da getInputs e getExpected.
function normalizeData(input, expected = null){
	return tf.tidy(() => {
		//Minimi e massimi dei valori in input ed expected.
		//I valori sono messi in tensor2d di dimensioni uguali al tensor2d di input o expected.
		const normalizingTensor = {
			input:	{
				min:	tf.tensor2d([
					Array(input.length).fill(1),
					Array(input.length).fill(1),
					Array(input.length).fill(1),
					Array(input.length).fill(0),
					Array(input.length).fill(0)
				]).transpose(),

				max:	tf.tensor2d([
					Array(input.length).fill(4),
					Array(input.length).fill(12),
					Array(input.length).fill(4),
					Array(input.length).fill(6),
					Array(input.length).fill(23)
				]).transpose()
			}
		}

		const res = {};

		input = tf.tensor2d([
			...input.season,
			...input.month,
			...input.week,
			...input.day,
			...input.hour
		], [5, input.length]).transpose();

		//Formula di normalizzazione.
		res.input = input.sub(normalizingTensor.input.min).div(normalizingTensor.input.max.sub(normalizingTensor.input.min));
		
		//Se abbiamo anche passato expected.
		if(expected){
			normalizingTensor.expected = {
				min:	tf.tensor2d([
					Array(expected.length).fill(207),
					Array(expected.length).fill(0),
					Array(expected.length).fill(0),
				]).transpose(),

				max:	tf.tensor2d([
					Array(expected.length).fill(253),
					Array(expected.length).fill(2340),
					Array(expected.length).fill(2340),
				]).transpose()
			}

			expected = tf.tensor2d([
				...expected.vrms,
				...expected.VA,
				...expected.W
			], [3, expected.length]).transpose();

			res.expected = expected.sub(normalizingTensor.expected.min).div(normalizingTensor.expected.max.sub(normalizingTensor.expected.min));
		}

		return res;
	});
}

//Ritorna un tensor2d contenenti i dati denormalizzati.
//resultTensor:	tensor2d contenente i risultati normalizzati.
function unNormalizeData(resultTensor){
	return tf.tidy(() => {
		//Minimi e massimi dei valori in resultTensor.
		//I valori sono messi in tensor2d di dimensioni uguali a resultTensor.

		const unNormalizingTensor = {
			min:	tf.tensor2d([
				Array(resultTensor.shape[0]).fill(207),
				Array(resultTensor.shape[0]).fill(0),
				Array(resultTensor.shape[0]).fill(0),
			]).transpose(),

			max:	tf.tensor2d([
				Array(resultTensor.shape[0]).fill(253),
				Array(resultTensor.shape[0]).fill(2340),
				Array(resultTensor.shape[0]).fill(2340),
			]).transpose()
		}

		//Formula di denormalizzazione.
		return resultTensor.mul(unNormalizingTensor.max.sub(unNormalizingTensor.min)).add(unNormalizingTensor.min);
	});
}

//------------------------------ Costruttori ------------------------------//

function MQTT_Data(val = 0){
	Object.assign(this, {
		v: { p_p: val, n_p: val, pp: val, rms: val },
		i: { p_p: val, n_p: val, pp: val, rms: val },
		p: { VA: val, W: val, VAr: val, pf: val }
	});
}

function DB_Data(mqtt_data, timestamp = new Date(), dev_id = null){
	const obj = {
		vrms:				mqtt_data.v.rms,
		VA:					mqtt_data.p.VA,
		W:					mqtt_data.p.W,
		timestamp:	timestamp
	}

	if(dev_id)
		obj._cod = dev_id;

	Object.assign(this, obj);
}

function Prediction(vrms, VA, W, timestamp){
	Object.assign(this, {vrms, VA, W, timestamp});
}

//Converte un valore di ritorno da db.devices a dei dati compatibili con il client.
function ClientDevice(device){
	device = device.toObject();

	device.id = device._id.toString();

	delete device._id;
	delete device.__v;

	Object.assign(this, device);
}

module.exports = router;
