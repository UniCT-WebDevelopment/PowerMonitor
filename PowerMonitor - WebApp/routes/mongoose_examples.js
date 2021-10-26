//PowerMonitorSchema.methods.nomeMetodo = function(){}		//Per aggiungere un metodo agli elementi del tipo PowerMonitorSchema.

//...

//Eseguo le query in questa funzione asincrona.
(async () => {
	//E' un op. asincrona, quindi prima ritrovo tutti i record corrispondenti
	// e poi li trasformo tramite map o altre funzioni.
	const res = await PowerMonitor.find().limit(3);
	// const results = res.map(e => e.p);
	console.log(res);

	/*
		Esempio di aggregazione:
		// GROUP BY _id="somma", SUM(vrms) as somma
		res = await PowerMonitor
		.aggregate()
		.limit(3)
		.group({ _id: "somma",  somma: { $sum: "$vrms" } });
	*/
})();