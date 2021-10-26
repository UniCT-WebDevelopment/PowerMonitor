#ifndef PowerMonitor_H
#define PowerMonitor_H

#include <Arduino.h>
#include <stdlib.h>
#include <math.h>

struct PM_Parameters{
	int sampleRate;									//Inutilizzato.
	int bitResolution;
	float ADCMaxVoltage;

	float transformerRatio;
	float voltageDividerRatio;
	
	float currentClampRatio;
	int currentClampResistor;

	float V_correctionFactor = 0;
	float I_correctionFactor = 0;
};

class PowerMonitor{
	private:
		//Dati.
		bool dataOk = false;												//I dati sono stati settati?

		const int *V_samples, *I_samples;						//Puntatore variabile a costanti intere; valori campionati.
		int dataLength;

		//Parametri per il calcolo.
		bool parametersOk = false;									//I parametri sono stati settati?

		int sampleRate;
		int bitResolution;
		float ADCMaxVoltage;

		float transformerRatio;
		float voltageDividerRatio;
		
		float currentClampRatio;
		int currentClampResistor;

		float V_correctionFactor;
		float I_correctionFactor;

		//Valori calcolati.
		bool calculationOk = false;									//I calcoli sono stati eseguiti?

		float *V_values, *I_values;									//Valori calcolati.
		float Vrms, Irms, V_peaks[2], I_peaks[2];
		float VA, W, VAr, pf;

	public:
		PowerMonitor(){}
		PowerMonitor(const int *V_samples, const int *I_samples, int dataLength);
		~PowerMonitor();

		void setDataReference(const int *V_samples, const int *I_samples, int dataLength);
		void clearDataReference();

		void setDataParameters(PM_Parameters parameters);
		void clearDataParameters();

		bool calculate();

		float getVrms();
		float getIrms();

		float getV_PositivePeak();
		float getV_NegativePeak();
		float getI_PositivePeak();
		float getI_NegativePeak();

		float getVpp();
		float getIpp();

		float apparentPower();
		float activePower();
		float reactivePower();
		float powerFactor();

		String toString();
};

#endif