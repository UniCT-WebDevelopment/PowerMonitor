/// <reference path="../../typings/globals/jquery/index.d.ts" />

$(document).ready(async function(){
	events();
	
	//Riferimenti ai grafici.
	let power_chart, pf_chart, vi_chart;

	//Aggiusto le date di #from e #to.
	const to = new Date();
	const from = new Date(to);

	from.setMinutes(from.getMinutes() - from.getTimezoneOffset() - 2);
	to.setMinutes(to.getMinutes() - to.getTimezoneOffset());

  $("#from").attr("value", from.toISOString().substring(0, 16));
	$("#to").attr("value", to.toISOString().substring(0, 16));

	//Dati grafici.
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

	await refresh($("#group_by").val(), $("#from").val(), $("#to").val());

	//Funzioni.
	async function refresh(group, from, to, destroy = false){
		$("#loading").show();

		const url = $("#update_button").hasClass("print") ? "/data" : "/predict";
		let ret = await $.get(url, {
			group:	group,
			from:		from,
			to:			to
		});

		//Se non ci sono stati errori.
		if(ret.state == 0){
			const n = ret.values.length;

			//Azzero i dati presenti.
			x.splice(0);

			y[0][0].clear();
			y[0][1].clear();
			y[0][2].clear();
			y[1][0].clear();
			y[2][0].clear();
			y[2][1].clear();

			//Serve per il calcolo dell'energia.
			let ore, pot_media = 0;

			//Aggiungo le ascisse ed i dati.
			ret.values.forEach((e, i) => {
				const refined = new Data(e);
				let date = refined.timestamp;

				switch(group){
					case 'd':
						date = leadingZeros(date.getDate()) + "/" + leadingZeros(date.getMonth() + 1) + "/" + leadingZeros(date.getFullYear());
						ore = n * 24;
						break;
		
					case 'h':
						date = leadingZeros(date.getDate()) + "/" + leadingZeros(date.getMonth() + 1) + "/" + leadingZeros(date.getFullYear()) + ", " + leadingZeros(date.getHours());
						ore = n;
						break;

					case 'm':
						date = leadingZeros(date.getHours()) + ":" + leadingZeros(date.getMinutes());
						ore = n / 60;
						break;

					case 's':
						date = leadingZeros(date.getHours()) + ":" + leadingZeros(date.getMinutes()) + ":" + leadingZeros(date.getSeconds());
						ore = n / 3600;
						break;
				}

				x.push(date);

				y[0][0].add(refined.p.VA);
				y[0][1].add(refined.p.W);
				y[0][2].add(refined.p.VAr);
				y[1][0].add(refined.p.pf);
				y[2][0].add(refined.vrms);
				y[2][1].add(refined.irms * 1000);

				pot_media += refined.p.W;
			});

			if(destroy){
				try{
					//Resetto i grafici.
					power_chart.destroy();
					pf_chart.destroy();
					vi_chart.destroy();
				}
				catch(e){}
			}

			//Disegno i grafici.
			power_chart = new Chart($("#power_chart"), new PMChart("Potenza nel tempo", x, y[0]));
			pf_chart = new Chart($("#pf_chart"), new PMChart("Fattore di potenza", x, y[1]));
			vi_chart = new Chart($("#vi_chart"), new PMChart("Tensione e corrente RMS nel tempo", x, y[2]));

			pot_media /= n;
			$("#kWh span").text( ((pot_media * ore) / 1000).toFixed(2) );

			/*
				Calcolo dell'energia (kWh).

				kWh = (pot_media * ore) / 1000 =
						= (somma(potenze_istantanee) / n * ore) / 1000
			*/
		}

		else
			alert("Errore: " + ret.error);
		
		$("#loading").hide();
	}

	//Gestione eventi.
	function events(){
		$("#update_button").on("click", () => refresh($("#group_by").val(), $("#from").val(), $("#to").val(), true));

		let last_group = 's';
		$("#group_by").on("change", function(){
			last_group = $("#group_by").val();
		});

		$("#from, #to")
			.on("change", () => {
				last_group = $("#group_by").val();
				
				const from = new Date($("#from").val());
				const to = new Date($("#to").val());
				const now = new Date();

				if(from > now && to > now){
					$("#update_button")
						.removeClass("print")
						.addClass("predict")
						.text("Predici");

					$("#group_by")
						.empty()
						.append("<option value='d'" + (last_group == 'd' ? "selected" : "") + ">Giorni</option>")
						.append("<option value='h'" + (last_group == 'h' ? "selected" : "") + ">Ore</option>");
				}
				
				else{
					$("#update_button")
						.removeClass("predict")
						.addClass("print")
						.text("Aggiorna");

					$("#group_by")
						.empty()
						.append("<option value='d'" + (last_group == 'd' ? "selected" : "") + ">Giorni</option>")
						.append("<option value='h'" + (last_group == 'h' ? "selected" : "") + ">Ore</option>")
						.append("<option value='m'" + (last_group == 'm' ? "selected" : "") + ">Minuti</option>")
						.append("<option value='s' " + (last_group == 's' ? "selected" : "") + ">Secondi</option>");
				}
			})
			.on("keypress", k => {
				if(k.key == "Enter"){
					$("#from").trigger("change");
					$("#update_button").trigger("click");
				}
			});
		
		$("#model_actions .button").click(async function(){
			$("#loading").show();

			const id = $(this).attr("id");
			const page = id.substring(0, id.indexOf("_button"));

			try{
				const ret = await $.get("/" + page);

				if(ret.state != 0)
					alert("Errore: " + ret.e);
			}

			catch(e){
				alert("Errore nella richiesta: " + e.status + ": " + e.statusText + ".");
			}

			$(".loading").hide();
		});
	}
});

//Costruttori.
function Data(data){
	const vrms = data.vrms;
	const VA = data.VA;
	const W = data.W;
	const timestamp = new Date(data.timestamp);

	const irms = (vrms > 0 ? VA / vrms : 0);
	const VAr = Math.sqrt(Math.pow(VA, 2) - Math.pow(W, 2));
	const pf = (VA > 0 ? W / VA : 0);

	Object.assign(this, {
		vrms:		parseFloat(vrms.toFixed(1)),
		irms:		parseFloat(irms.toFixed(3)),
		p:	{
			VA:		parseFloat(VA.toFixed(2)),
			W:		parseFloat(W.toFixed(2)),
			VAr:	parseFloat(VAr.toFixed(2)),
			pf:		parseFloat(pf.toFixed(3)),
		},
		timestamp:	timestamp
	});
}
