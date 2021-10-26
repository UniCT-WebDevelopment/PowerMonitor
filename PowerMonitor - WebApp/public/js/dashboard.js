/// <reference path="../../typings/globals/jquery/index.d.ts" />

const PLOT_LENGTH = 120;	//Lunghezza temporale dei grafici (120s).

$(document).ready(function(){
	const MQTT_ID = "PowerMonitor-Client-" + Math.floor(Math.random() * 0xFFFF);
	const client = new Paho.MQTT.Client(MQTT_SERVER, 9001, MQTT_ID);

	client.onConnectionLost = e => console.error("Connection to the MQTT Broker lost: " + e.errorMessage);
	client.onMessageArrived = m => {
		const topic = m.destinationName;
		const message = JSON.parse(m.payloadString);

		//Filtro i messaggi per ricevere solo quelli del dispositivo selezionato.
		if(message.name == device.name && message.ip == device.ip)
			switch(topic){
				case DATA_TOPIC:
					refresh(message);
					break;
				
				case POWER_TOPIC:
					const power = message.active ? true : false;

					if(power)
						$("#power_switch .body").addClass("switch_enabled");
					else
						$("#power_switch .body").removeClass("switch_enabled");
					break;
			}
	}

	client.connect({ 
		onSuccess: invocationContext => {
			console.log("Connected to the MQTT Broker at " + MQTT_SERVER + ".");

			client.subscribe(DATA_TOPIC);
			client.subscribe(POWER_TOPIC);

			//Richiede lo stato del dispositivo; per il pulsante power.
			client.send(REQUEST_TOPIC, JSON.stringify({ ...device, action: 2 }));
		},

		onFailure: (invocationContext, errorCode, errorMessage) => console.error("Connected to the MQTT Broker at " + MQTT_SERVER + "failed: " + errorMessage),
	});
	
	//LCD.
	let time = new Date(0);
	let watts = 0;
	
	//Auto aggiornamento dei grafici.
	let update_charts = true;

	const x = new Array();
	const y = new Array(
		new Array(
			new Dataset("VA", getCSSVar("plot_1")),
			new Dataset("W", getCSSVar("plot_3")),
			new Dataset("VAr", getCSSVar("plot_2"))
		),

		new Array(
			new Dataset("Power Factor", getCSSVar("plot_4"))
		),

		new Array(
			new Dataset("Vrms", getCSSVar("plot_5")),
			new Dataset("mArms", getCSSVar("plot_6"))
		)
	);

	reset_charts();

	//Disegno i grafici.
	const power_chart = new Chart($("#power_chart"), new PMChart("Potenza nel tempo", x, y[0]));
	const pf_chart = new Chart($("#pf_chart"), new PMChart("Fattore di potenza", x, y[1]));
	const vi_chart = new Chart($("#vi_chart"), new PMChart("Tensione e corrente RMS nel tempo", x, y[2]));

	//Gestione eventi.
	$("#power_switch .body").on("click", function(){
		const active = $(this).hasClass("switch_enabled");

		//Serve anche per quando si hanno piu' istanze di dashboard aperte.
		client.send(REQUEST_TOPIC, JSON.stringify({ ...device, action: active }));
	});

	$("#pause_switch .body").on("click", function(){
		update_charts = !$(this).hasClass("switch_enabled");
	});

	$("#clear_button").on("click", () => {
		reset_charts();

		power_chart.update();
		pf_chart.update();
		vi_chart.update();
	});

	//Funzioni.
	function reset_charts(){
		//Azzero i dati presenti.
		x.splice(0);

		y[0][0].clear();
		y[0][1].clear();
		y[0][2].clear();
		y[1][0].clear();
		y[2][0].clear();
		y[2][1].clear();

		//Aggiungo le ascisse e gli zeri.
		for(let i=0; i<PLOT_LENGTH; i++){
			x.push((PLOT_LENGTH - i) + 's');

			y[0][0].add(0);
			y[0][1].add(0);
			y[0][2].add(0);
			y[1][0].add(0);
			y[2][0].add(0);
			y[2][1].add(0);
		}
	}

	function refresh(data){
		time.setSeconds(time.getSeconds() + 1);
		$("#t").text(leadingZeros(time.getUTCHours()) + ':' + leadingZeros(time.getUTCMinutes()) + ':' + leadingZeros(time.getUTCSeconds()));

		if(!$.isEmptyObject(data)){
			$("#Vrms").text(data.v.rms.toFixed(1));
			$("#Irms").text(data.i.rms.toFixed(3));
			$("#VA").text(data.p.VA.toFixed(2));
			$("#W").text(data.p.W.toFixed(2));
			$("#VAr").text(data.p.VAr.toFixed(2));
			$("#pf").text(data.p.pf.toFixed(3));

			if(update_charts){
				power_chart.data.datasets[0].addNew(data.p.VA);
				power_chart.data.datasets[1].addNew(data.p.W);
				power_chart.data.datasets[2].addNew(data.p.VAr);
				pf_chart.data.datasets[0].addNew(data.p.pf);
				vi_chart.data.datasets[0].addNew(data.v.rms);
				vi_chart.data.datasets[1].addNew(data.i.rms * 1000);

				power_chart.update();
				pf_chart.update();
				vi_chart.update();
			}
		}

		//Calcolo dell'energia (kWh).

		/*
			kWh = (pot_media * ore) / 1000 =
					= (somma(potenze_istantanee) / sec * sec / 3600) / 1000 =
					= (somma(potenze_istantanee) / 3600) / 1000 =
					= somma(potenze_istantanee) / 3600000
		*/

		watts += data.p.W;
		$("#kWh").text((watts/3600000).toFixed(2));
	}
});
