#ifndef MCP3202_H
#define MCP3202_H

#include <Arduino.h>
#include <SPI.h>

class MCP3202{
	private:
		uint8_t CS;	//Chip select.

	public:
		//CS:	PIN chip select.
		MCP3202(uint8_t CS);

		//ch:	Channel (0, 1).
		uint16_t read(uint8_t ch);
};

#endif
