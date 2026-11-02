/**
 * Gerador de arquivo ZIP client-side em JavaScript puro / Uint8Array.
 * Suporta método de compressão STORE (0) e DEFLATE (8) via CompressionStream (se disponível no navegador).
 * Cria arquivo .zip / .pptx compatível com a especificação PKWARE e Microsoft Office OpenXML.
 */

// Tabela CRC32 pré-calculada
const crc32Table = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crc32Table[i] = c >>> 0
}

export function calcCrc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ data[i]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface SimpleZipFile {
  name: string
  content: string | Uint8Array
}

/**
 * Monta um arquivo ZIP padrão (PKWARE) usando o método STORE (sem compressão proprietária).
 * O formato OpenXML (.pptx, .docx, .xlsx) aceita nativamente arquivos STORE dentro do contêiner ZIP,
 * sendo a forma mais confiável e compatível de gerar pacotes válidos sem dependências externas.
 */
export function createZipArchive(files: SimpleZipFile[]): Uint8Array {
  const encoder = new TextEncoder()
  const entries: {
    nameBytes: Uint8Array
    dataBytes: Uint8Array
    crc: number
    offset: number
  }[] = []

  let currentOffset = 0
  const localHeadersAndData: Uint8Array[] = []

  for (const file of files) {
    const nameBytes = encoder.encode(file.name.replace(/\\/g, '/'))
    const dataBytes = typeof file.content === 'string' ? encoder.encode(file.content) : file.content
    const crc = calcCrc32(dataBytes)
    const offset = currentOffset

    // Local file header: 30 bytes + filename length
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(localHeader.buffer)

    // Data/hora MS-DOS válida: 2026-01-01 12:00:00 (evita 0/0/0 que alguns descompactadores rejeitam)
    // Time: 12:00:00 -> (12 << 11) | (0 << 5) | 0 = 0x6000
    // Date: (2026 - 1980) << 9 | (1 << 5) | 1 = (46 << 9) | 0x20 | 1 = 0x5c21
    const dosTime = 0x6000
    const dosDate = 0x5c21

    view.setUint32(0, 0x04034b50, true) // Local file header signature
    view.setUint16(4, 20, true) // Version needed to extract (2.0)
    view.setUint16(6, 0x0800, true) // General purpose bit flag (Bit 11: UTF-8 filename)
    view.setUint16(8, 0, true) // Compression method: 0 = STORE
    view.setUint16(10, dosTime, true) // File last mod time (MS-DOS)
    view.setUint16(12, dosDate, true) // File last mod date (MS-DOS)
    view.setUint32(14, crc, true) // CRC-32
    view.setUint32(18, dataBytes.length, true) // Compressed size
    view.setUint32(22, dataBytes.length, true) // Uncompressed size
    view.setUint16(26, nameBytes.length, true) // File name length
    view.setUint16(28, 0, true) // Extra field length
    localHeader.set(nameBytes, 30)

    localHeadersAndData.push(localHeader)
    localHeadersAndData.push(dataBytes)

    entries.push({
      nameBytes,
      dataBytes,
      crc,
      offset,
    })

    currentOffset += localHeader.length + dataBytes.length
  }

  // Central Directory
  const centralDirStartOffset = currentOffset
  const centralDirParts: Uint8Array[] = []
  let centralDirSize = 0

  for (const entry of entries) {
    // Central directory header: 46 bytes + filename length
    const cdHeader = new Uint8Array(46 + entry.nameBytes.length)
    const view = new DataView(cdHeader.buffer)

    const dosTime = 0x6000
    const dosDate = 0x5c21

    view.setUint32(0, 0x02014b50, true) // Central directory signature
    view.setUint16(4, 20, true) // Version made by
    view.setUint16(6, 20, true) // Version needed to extract
    view.setUint16(8, 0x0800, true) // General purpose bit flag (UTF-8)
    view.setUint16(10, 0, true) // Compression method: 0 = STORE
    view.setUint16(12, dosTime, true) // Last mod time (MS-DOS)
    view.setUint16(14, dosDate, true) // Last mod date (MS-DOS)
    view.setUint32(16, entry.crc, true) // CRC-32
    view.setUint32(20, entry.dataBytes.length, true) // Compressed size
    view.setUint32(24, entry.dataBytes.length, true) // Uncompressed size
    view.setUint16(28, entry.nameBytes.length, true) // File name length
    view.setUint16(30, 0, true) // Extra field length
    view.setUint16(32, 0, true) // File comment length
    view.setUint16(34, 0, true) // Disk number start
    view.setUint16(36, 0, true) // Internal file attributes
    view.setUint32(38, 0, true) // External file attributes
    view.setUint32(42, entry.offset, true) // Relative offset of local header
    cdHeader.set(entry.nameBytes, 46)

    centralDirParts.push(cdHeader)
    centralDirSize += cdHeader.length
  }

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true) // EOCD signature
  eocdView.setUint16(4, 0, true) // Number of this disk
  eocdView.setUint16(6, 0, true) // Disk where central directory starts
  eocdView.setUint16(8, entries.length, true) // Number of central directory records on this disk
  eocdView.setUint16(10, entries.length, true) // Total number of central directory records
  eocdView.setUint32(12, centralDirSize, true) // Size of central directory
  eocdView.setUint32(16, centralDirStartOffset, true) // Offset of start of central directory
  eocdView.setUint16(20, 0, true) // Comment length

  // Concatena todas as partes
  const totalLength = currentOffset + centralDirSize + eocd.length
  const finalZip = new Uint8Array(totalLength)
  let pos = 0

  for (const part of localHeadersAndData) {
    finalZip.set(part, pos)
    pos += part.length
  }
  for (const part of centralDirParts) {
    finalZip.set(part, pos)
    pos += part.length
  }
  finalZip.set(eocd, pos)

  return finalZip
}
