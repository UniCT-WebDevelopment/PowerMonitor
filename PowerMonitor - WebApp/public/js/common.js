//Ritorna il valore di una variabile CSS.
const getCSSVar = name => $(":root").css("--" + name);

//Numero da trasformare in stringa preceduta da places zeri.
const leadingZeros = (num, places = 2) => String(num).padStart(places, '0');

//Costruttori
function Dataset(label, color, hidden = false){
	Object.assign(this, {
		data: new Array(),
		label: label,
		hidden: hidden,

		backgroundColor: color,
		borderColor: color,
		fill: false,
		// pointRadius: 1,
		radius: 0,
		borderWidth: 4,
		tension: 0.4,				//Interpolazione cubica.

		add: e => this.data.push(e),
		clear: () => this.data = [],
		addNew: e => {			//Aggiunge un nuovo elemento e rimuove quello piu' vecchio.
			this.data.push(e);
			this.data = this.data.splice(1, this.data.length);
		}
	});
}

function PMChart(title, x, y){
	Object.assign(this, {
		type: "line",
	
		options: {
			responsive: true,
			
			plugins: {
				legend: {
					position: "top"
				},
	
				title: {
					display: true,
					text: title
				}
			},
	
			interaction: {
				intersect: false,	//Appena si mette il puntatore sul grafico, stampa il valore assunto da tutte le curve.
				mode: "nearest",
				axis: "x"
			},
	
			hoverRadius: 6,
			animations: {
				radius: {					//Animazione hover.
					duration: 500,
					easing: "linear",
					loop: context => context.active
				},
	
				y: {
					duration: 0			//Per disattivare l'animazione all'update dei dati.
				}
			}
		},
	
		data: {
			labels: x,
			datasets: y
		}
	});
}
