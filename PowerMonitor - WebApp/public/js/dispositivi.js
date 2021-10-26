/// <reference path="../../typings/globals/jquery/index.d.ts" />

//Dopo la prima ricerca dispositivi, conterra' i risultati della ricerca stessa.
let devices;

$(document).ready(function(){
	//Disattivo il comportamento di default di ui.js sugli switch.
	$(".switch .body").unbind("click");

	events();
	$(".back, .loading").hide();

	//Verifico lo stato dei dispositivi.
	$(".device").each(async (i, e) => {
		const device = {
			name:	$(e).find(".title").first().text(),
			ip:		$(e).find(".ip a").html()
		}

		try{
			const info = await $.get("http://" + device.ip + "/alive");

			//Verifico anche se il dispositivo rispecchia la coppia registrata nome/ip.
			if(info && info.device == "PowerMonitor" && info.name == device.name){
				$(e)
					.find(".state span, .icon")
					.removeClass("offline")
					.addClass("online")
				
				const icon = $(e)
					.find(".icon")
					.clone();

				$(e)
					.find(".state span")
					.text("online ")
					.append(icon);
			}
		}
		catch(e){}
	});

	function events(){
		//Passo alla schermata di ricerca dispositivi.
		$(".new_device").click(async function(){
			$(".new_device, .device").hide();
			$(".back, .loading").show();

			try{
				devices = await $.get("/device/search");
			}

			catch(e){
				alert("Errore nella ricerca dei dispositivi: " + e.status + ": " + e.statusText + ".");
				$(".loading").hide();
				return;
			}

			devices.forEach((e, i) => {
				const clone = $("#template_device")
					.clone()
					.show();

				clone
					.addClass("device found");
				
				clone
					.find(".title")
					.text(e.name);
				
				clone
					.find(".ip a")
					.attr("href", "http://" + e.ip)
					.text(e.ip);
				
				clone
					.find(".icon")
					.addClass("online")
					.before(" online ")
					.parent()
					.addClass("online");

				clone
					.attr("onclick", "add_device(" + i + ")");

				$(".container").append(clone);
			});

			$(".loading").hide();
		});

		//Torno indietro alla schermata di gestione dei dispositivi registrati.
		$(".back").click(function(){
			$(".back, .loading").hide();
			$(".found").remove();

			$(".new_device, .device").show();
		});

		//Modifica del nome relativo ad un dispositivo registrato.
		$(".device .title").click(async function(){
			const ip = $(this).parent().find(".ip a").html();
			const name = $(this).text();
			const new_name = prompt("Inserisci un nuovo nome per il dispositivo:", name);

			if(new_name){
				try{
					await $.post("/device/change/name", { name, ip, new_name });
					
					//Modifico effettivamente il nome del dispositivo solamente se quest'ultimo e' online.
					if($(this).parent().find(".info_container .state span").hasClass("online"))
						await $.post("http://" + ip + "/update/name", { name: new_name });
				}
	
				catch(e){
					alert("Errore nella richiesta: " + e.status + ": " + e.statusText + ".");
				}

				location.reload();
			}
		});

		//Modifica dell'indirizzo IP relativo ad un dispositivo registrato.
		$(".device .info_container img").click(async function(){
			const ip = $(this).parent().find("a").html();
			const name = $(this).parent().parent().parent().find(".title").first().text();
			const new_ip = prompt("Inserisci il nuovo indirizzo IP del dispositivo:", ip);

			if(new_ip){
				try{
					await $.post("/device/change/ip", { name, ip, new_ip });
					location.reload();
				}
	
				catch(e){
					alert("Errore nella richiesta: " + e.status + ": " + e.statusText + ".");
					return;
				}
			}
		});

		$(".device .title, .device .info_container").hover(function(){
			$(this).find("img").toggle();
		});
	}
});

async function select_device(dev_id){
	const element = $("#device_" + dev_id + " .switch .body");
	const en = element.hasClass("switch_enabled");
	
	if(!en){
		try{
			await $.post("/device/select", {
				device_id:	dev_id
			});

			$(".switch .body").each((i, e) => {
				if(e != element[0])
					$(e).removeClass("switch_enabled");
			});

			element.addClass("switch_enabled");
		}

		catch(e){
			element.removeClass("switch_enabled");
			alert("Errore nella selezione del dispositivo: " + e.status + ": " + e.statusText + ".");
		}
	}
}

async function delete_device(dev_id){
	const name = $("#device_" + dev_id + " .title").first().text();
	const confirm = prompt("Sei sicuro di voler eliminare il dispositivo " + name + "?\nAnche tutti i dati ad esso associati verranno eliminati.\nDigita \"" + name + "\" per confermare l'eliminazione.");
	
	if(confirm == name)
		try{
			await $.post("/device/delete", {
				device_id:	dev_id
			});
	
			$("#device_" + dev_id).remove();
		}
	
		catch(e){
			alert("Errore nell'eliminazione del dispositivo: " + e.status + ": " + e.statusText + ".");
		}
}

async function add_device(index){
	try{
		await $.post("/device/add", devices[index]);
		location.assign("/dispositivi");
	}

	catch(e){
		alert("Errore: il dispositivo e' gia' stato registrato.");
	}
}
