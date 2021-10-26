/// <reference path="../../../typings/globals/jquery/index.d.ts" />

$(document).ready(function(){
	$("#reset").click(() => $(".data .val input").val(""));

	$("#name").focus(() => {
		$("#submit")
			.removeClass("setWiFi")
			.addClass("setName")
			.text("Agg. nome");
	});

	$("#ssid, #pass").focus(() => {
		$("#submit")
			.removeClass("setName")
			.addClass("setWiFi")
			.text("Connetti");
	});

	$(".data .val input").keypress(e => {
		if(e.key == "Enter")
			$("#submit").trigger("click");
	});

	$("#submit").click(async function(){
		//Se voglio settare le impostazioni del WiFi.
		if($(this).hasClass("setWiFi")){
			const ssid = $("#ssid").val();
			const pass = $("#pass").val();
			
			if(ssid == ""){
				alert("Inserisci un SSID valido!");
				return;
			}

			if(pass == ""){
				alert("Inserisci una password valida!");
				$("#pass").focus();
				return;
			}

			$.post("/update/wifi", { ssid, pass });
			
			alert("Connessione in corso; il dispositivo verra' riavviato.");
			location.reload();
		}

		//Se voglio settare un nuovo nome per il dispositivo.
		else{
			const name = $("#name").val();
			await $.post("/update/name", { name });
			
			$("#name")
				.attr("placeholder", name)
				.val("");
		}
	});

	$("#refresh").click(async () => {
		$(".loading").show();

		//Refresh dei placeholder.
		let info;
		try{
			info = await $.get("/alive");
		}
		catch(e){
			alert("Errore " + e.status + ": " + e.statusText + "; ricaricare la pagina.");
			return;
		}

		$("#name").attr("placeholder", info.name);
		$("#ssid").attr("placeholder", info.ssid);

		//Refresh delle reti disponibili.
		let nets;
		try{
			nets = await $.get("/networks");
			// nets = [{ ssid: "test", rssi: 3 }, { ssid: "test1", rssi: 4 }];
		}
		catch(e){
			alert("Errore " + e.status + ": " + e.statusText + "; ricaricare la pagina.");
			return;
		}

		if(nets == null){
			$(".loading").hide();
			return;
		}

		let str = "";
		nets.forEach(e => {
			str += 	"<div class='network'>";
			str += 		"<div onclick='alert(\"" + e.ssid + "\")'>";
			str += 			"<h3>" + (e.ssid.length > 10 ? e.ssid.substring(0, 9) + "..." : e.ssid) + "&nbsp;</h3>";
			str += 			"<h5>(" + e.rssi + "%)</h5>";
			str += 		"</div>";
			str += 		"<div class='button' onclick=\"select('" + e.ssid + "');\"> Connetti </div>";
			str += 	"</div>";
		});

		$(".network").remove();
		$(".loading")
			.hide()
			.before(str);
	});

	$("#update-fs, #update-fw").click(async function(){
		const type = $(this).attr("id").substring(7, 10);
		
		 $.post("/update/" + type);

		let msg = "";
		msg += "Aggiornamento " + type.toUpperCase() + " in corso;\n";
		msg += "Durante tutto il corso dell'aggiornamento, il LED integrato lampeggiera'.\n";
		msg += "Ricorda di avviare un WebServer alla porta 5500 con il file binario dell'aggiornamento nella document root del server.";

		alert(msg);

		location.reload();
	});

	$("#refresh").trigger("click");
});

function select(ssid){
	$("#ssid").val(ssid);
	$("#pass").focus();
}
