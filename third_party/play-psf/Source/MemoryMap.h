#pragma once

#include "Types.h"
#include <functional>
#include <vector>

enum MEMORYMAP_ENDIANNESS
{
	MEMORYMAP_ENDIAN_LSBF,
	MEMORYMAP_ENDIAN_MSBF,
};

class CMemoryMap
{
public:
	typedef std::function<uint32(uint32, uint32)> MemoryMapHandlerType;
	using SpuBusReadFunction = std::function<uint32(uint32, uint32)>;
	using SpuBusWriteFunction = std::function<void(uint32, uint32, uint32)>;

	enum MEMORYMAP_TYPE
	{
		MEMORYMAP_TYPE_MEMORY,
		MEMORYMAP_TYPE_FUNCTION
	};

	struct MEMORYMAPELEMENT
	{
		uint32 nStart;
		uint32 nEnd;
		void* pPointer;
		MemoryMapHandlerType handler;
		MEMORYMAP_TYPE nType;
	};
	typedef std::vector<MEMORYMAPELEMENT> MemoryMapListType;

	virtual ~CMemoryMap() = default;
	// Optional PS1 SPU bus adapter. Widths are bytes (1, 2 or 4); addresses
	// are physical, and all other mappings retain their original handlers.
	void SetSpuBusCallbacks(const SpuBusReadFunction&, const SpuBusWriteFunction&);
	uint8 GetByte(uint32);
	virtual uint16 GetHalf(uint32) = 0;
	virtual uint32 GetWord(uint32) = 0;
	virtual uint32 GetInstruction(uint32) = 0;
	virtual void SetByte(uint32, uint8);
	// CPU SB presents the source register on the 16-bit SPU bus.
	void SetByteFromRegister(uint32 address, uint32 value);
	virtual void SetHalf(uint32, uint16) = 0;
	virtual void SetWord(uint32, uint32) = 0;
	void InsertReadMap(uint32, uint32, void*, unsigned char);
	void InsertReadMap(uint32, uint32, const MemoryMapHandlerType&, unsigned char);
	void InsertWriteMap(uint32, uint32, void*, unsigned char);
	void InsertWriteMap(uint32, uint32, const MemoryMapHandlerType&, unsigned char);
	void InsertInstructionMap(uint32, uint32, void*, unsigned char);
	const MemoryMapListType& GetInstructionMaps();
	const MEMORYMAPELEMENT* GetReadMap(uint32) const;
	const MEMORYMAPELEMENT* GetWriteMap(uint32) const;
	const MEMORYMAPELEMENT* GetInstructionMap(uint32) const;

protected:
	static bool IsSpuBusAddress(uint32 address, uint32 width);
	SpuBusReadFunction m_spuBusRead;
	SpuBusWriteFunction m_spuBusWrite;

	static const MEMORYMAPELEMENT* GetMap(const MemoryMapListType&, uint32);

	MemoryMapListType m_instructionMap;
	MemoryMapListType m_readMap;
	MemoryMapListType m_writeMap;

private:
	static void InsertMap(MemoryMapListType&, uint32, uint32, void*, unsigned char);
	static void InsertMap(MemoryMapListType&, uint32, uint32, const MemoryMapHandlerType&, unsigned char);
};

class CMemoryMap_LSBF : public CMemoryMap
{
public:
	uint16 GetHalf(uint32) override;
	uint32 GetWord(uint32) override;
	uint32 GetInstruction(uint32) override;
	void SetHalf(uint32, uint16) override;
	void SetWord(uint32, uint32) override;
};
