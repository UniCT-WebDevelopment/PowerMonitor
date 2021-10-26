#include <PowerMonitor.h>

PowerMonitor::PowerMonitor(const int *V_samples, const int *I_samples, int dataLength){
	setDataReference(V_samples, I_samples, dataLength);
}

PowerMonitor::~PowerMonitor(){
	delete V_samples;
	delete I_samples;
}

void PowerMonitor::setDataReference(const int *V_samples, const int *I_samples, int dataLength){
	this->dataLength = dataLength;
	this->V_samples = V_samples;
	this->I_samples = I_samples;

	V_values = new float[dataLength];
	I_values = new float[dataLength];

	dataOk = true;
	calculationOk = false;
}

void PowerMonitor::clearDataReference(){
	dataOk = false;
	calculationOk = false;
}

void PowerMonitor::setDataParameters(PM_Parameters parameters){
	this->sampleRate = parameters.sampleRate;
	this->bitResolution = constrain(parameters.bitResolution, 8, 16);
	this->ADCMaxVoltage = parameters.ADCMaxVoltage;

	this->transformerRatio = parameters.transformerRatio;
	this->voltageDividerRatio = parameters.voltageDividerRatio;

	this->currentClampRatio = parameters.currentClampRatio;
	this->currentClampResistor = parameters.currentClampResistor;

	this->V_correctionFactor = parameters.V_correctionFactor;
	this->I_correctionFactor = parameters.I_correctionFactor;

	parametersOk = true;
	calculationOk = false;
}

void PowerMonitor::clearDataParameters(){
	parametersOk = false;
	calculationOk = false;
}

bool PowerMonitor::calculate(){
	if(!dataOk || !parametersOk)
		return false;
	
	//--------------------------------------------------------------------------------//
	//Calcolo di V_values, I_values e dei picchi.

	//Costanti ottenute dalla formula.
	float k = ADCMaxVoltage/pow(2, bitResolution);
	float k_V = k * (1 / voltageDividerRatio)/(transformerRatio + V_correctionFactor);
	float k_I = k * (1 / currentClampRatio + I_correctionFactor);

	//Valor medio di tensione/corrente.
	float mean_V = 0, mean_I = 0;

	for(int i=0; i<dataLength; i++){
		//In base alla formula di conversione, calcolo i valori reali.
		V_values[i] = ((float) V_samples[i]) * k_V;
		I_values[i] = ((float) I_samples[i])/currentClampResistor * k_I;

		//Nel frattempo, calcolo anche la somma per il calcolo del valor medio.
		mean_V += (float) V_values[i];
		mean_I += (float) I_values[i];
	}

	//Divido per il numero di campioni ed ottengo in valor medio di tensione/corrente.
	mean_V /= dataLength;
	mean_I /= dataLength;

	//Somma dei quadrati.
	float quadratic_sum_V = 0, quadratic_sum_I = 0;

	//Somma delle potenze istantanee.
	float instant_power = 0;

	//Picchi.
	V_peaks[0] = 0;
	V_peaks[1] = 0xFFFF;
	I_peaks[0] = 0;
	I_peaks[1] = 0xFFFF;

	for(int i=0; i<dataLength; i++){
		//Sottraggo ad ogni campione il valor medio.
		V_values[i] -= mean_V;
		I_values[i] -= mean_I;

		//Nel frattempo, calcolo la somma dei quadrati di V_values ed I_values
		//per calcolare Vrms ed Irms nello step successivo.
		quadratic_sum_V += pow(V_values[i], 2);
		quadratic_sum_I += pow(I_values[i], 2);

		//Nel frattempo, calcolo la somma delle potenze istantanee per calcolare W
		//nello step successivo.
		instant_power += V_values[i] * I_values[i];

		//Nel frattempo, calcolo anche i picchi.
		if(V_values[i] > V_peaks[0])
			V_peaks[0] = V_values[i];
		
		if(V_values[i] < V_peaks[1])
			V_peaks[1] = V_values[i];
		
		if(I_values[i] > I_peaks[0])
			I_peaks[0] = I_values[i];
		
		if(I_values[i] < I_peaks[1])
			I_peaks[1] = I_values[i];
	}

	//--------------------------------------------------------------------------------//
	//Calcolo di tutti gli altri parametri.

	Vrms = sqrt(quadratic_sum_V/dataLength);
	Irms = sqrt(quadratic_sum_I/dataLength);

	VA = Vrms * Irms;
	W = instant_power/dataLength;
	VAr = sqrt(pow(VA, 2) - pow(W, 2));
	pf = W/VA;

	//--------------------------------------------------------------------------------//
	//Constrain.

	if(Vrms < 0)
		Vrms = 0;
	
	if(Irms < 0)
		Irms = 0;

	if(VA < 0)
		VA = 0;
	
	if(W < 0)
		W = 0;

	if(VAr < 0)
		VAr = 0;
	
	if(pf < 0)
		pf = 0;

	//--------------------------------------------------------------------------------//

	calculationOk = true;
	return true;
}

float PowerMonitor::getVrms(){
	return (calculationOk ? Vrms : 0);
}

float PowerMonitor::getIrms(){
	return (calculationOk ? Irms : 0);
}

float PowerMonitor::getV_PositivePeak(){
	return (calculationOk ? V_peaks[0] : 0);
}

float PowerMonitor::getV_NegativePeak(){
	return (calculationOk ? V_peaks[1] : 0);
}

float PowerMonitor::getI_PositivePeak(){
	return (calculationOk ? I_peaks[0] : 0);
}

float PowerMonitor::getI_NegativePeak(){
	return (calculationOk ? I_peaks[1] : 0);
}

float PowerMonitor::getVpp(){
	return (calculationOk ? abs(V_peaks[0]) + abs(V_peaks[1]) : 0);
}

float PowerMonitor::getIpp(){
	return (calculationOk ? abs(I_peaks[0]) + abs(I_peaks[1]) : 0);
}

float PowerMonitor::apparentPower(){
	return (calculationOk ? VA : 0);
}

float PowerMonitor::activePower(){
	return (calculationOk ? W : 0);
}

float PowerMonitor::reactivePower(){
	return (calculationOk ? VAr : 0);
}

float PowerMonitor::powerFactor(){
	return (calculationOk ? pf : 0);
}

String PowerMonitor::toString(){
	char tmp[256];
	String str;

	sprintf(tmp, (const char*) F("Vmax: %.1fV, Vmin: %.1fV, Vpp: %.1fV\n"), getV_PositivePeak(), getV_NegativePeak(), getVpp());
	str += String(tmp);
	
	sprintf(tmp, (const char*) F("Imax: %.3fmA, Imin: %.3fmA, Ipp: %.3fmA\n"), getI_PositivePeak(), getI_NegativePeak(), getIpp());
	str += String(tmp);
	
	sprintf(tmp, (const char*) F("Vrms: %.1fV, Irms: %.3fmA\n"), getVrms(), getIrms());
	str += String(tmp);
	
	sprintf(tmp, (const char*) F("S: %.2fVA, P: %.2fW, Q: %.2fVAr, pf: %.3f\n"), apparentPower(), activePower(), reactivePower(), powerFactor());
	str += String(tmp);

	return str;
}
