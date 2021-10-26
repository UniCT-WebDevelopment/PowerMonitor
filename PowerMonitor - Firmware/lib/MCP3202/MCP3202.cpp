#include <MCP3202.h>

MCP3202::MCP3202(uint8_t CS){
	this->CS = CS;

	pinMode(CS, OUTPUT);
  digitalWrite(CS, HIGH);

	SPI.begin();
  // SPI.setClockDivider(SPI_CLOCK_DIV8);
}

uint16_t MCP3202::read(uint8_t ch){
	/*
		MCU PIN:
		Dout	X X X X X X X A			B C D X X X   X   X  X			X  X  X  X  X  X  X  X
		Din		X X X X X X X X			X X X X 0 B11 B10 B9 B8			B7 B6 B5 B4 B3 B2 B1 B0
		A:	Start bit.
		B:	1: Mod. singola, 0: Mod. differenziale.
		C:
			Mod. sing.:
				0:	Leggi da CH0.
				1:	Leggi da CH1.
			Mod. diff.:
				0: CH0: IN+, CH1: IN-.
				1: CH0: IN-, CH1: IN+.
		D:	1: MSB First, 0: LSB First (Per LSB leggere Datasheet).
	*/

  uint8_t msb, lsb, command = B10100000;

  if(ch == 1)
		command = B11100000;
	
  digitalWrite(CS, LOW);

		SPI.transfer(1);	//Start bit.
		msb = SPI.transfer(command) & 0x0F;
		lsb = SPI.transfer(0);

  digitalWrite(CS, HIGH);

  return ((int16_t) msb) << 8 | lsb;
}
