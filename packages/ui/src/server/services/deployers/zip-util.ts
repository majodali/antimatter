/**
 * Minimal ZIP archive creator for single-file Lambda bundles.
 * Uses Node.js built-in zlib for DEFLATE compression.
 * No external dependencies needed.
 */

import { deflateRawSync } from 'node:zlib';

/**
 * Create a ZIP archive containing a single file.
 *
 * @param filename — the name the file should have inside the zip (e.g. "index.js")
 * @param content — the raw file content as a Buffer
 * @returns a Buffer containing a valid ZIP archive
 */
export function createZipFromFile(filename: string, content: Buffer): Buffer {
  const filenameBytes = Buffer.from(filename, 'utf-8');

  // Compress the content with DEFLATE (raw, no zlib/gzip header)
  const compressed = deflateRawSync(content, { level: 6 });

  const crc = crc32(content);
  const uncompressedSize = content.length;
  const compressedSize = compressed.length;

  // DOS date/time: use a fixed timestamp for reproducibility
  const dosTime = 0x0000; // 00:00:00
  const dosDate = 0x0021; // 1980-01-01

  // --- Local file header ---
  const localHeader = Buffer.alloc(30 + filenameBytes.length);
  localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
  localHeader.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
  localHeader.writeUInt16LE(0, 6);          // General purpose bit flag
  localHeader.writeUInt16LE(8, 8);          // Compression method: DEFLATE
  localHeader.writeUInt16LE(dosTime, 10);   // Last mod file time
  localHeader.writeUInt16LE(dosDate, 12);   // Last mod file date
  localHeader.writeUInt32LE(crc, 14);       // CRC-32
  localHeader.writeUInt32LE(compressedSize, 18);   // Compressed size
  localHeader.writeUInt32LE(uncompressedSize, 22); // Uncompressed size
  localHeader.writeUInt16LE(filenameBytes.length, 26); // File name length
  localHeader.writeUInt16LE(0, 28);         // Extra field length
  filenameBytes.copy(localHeader, 30);

  // --- Central directory header ---
  const centralHeader = Buffer.alloc(46 + filenameBytes.length);
  centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
  centralHeader.writeUInt16LE(20, 4);         // Version made by
  centralHeader.writeUInt16LE(20, 6);         // Version needed
  centralHeader.writeUInt16LE(0, 8);          // General purpose bit flag
  centralHeader.writeUInt16LE(8, 10);         // Compression method: DEFLATE
  centralHeader.writeUInt16LE(dosTime, 12);   // Last mod file time
  centralHeader.writeUInt16LE(dosDate, 14);   // Last mod file date
  centralHeader.writeUInt32LE(crc, 16);       // CRC-32
  centralHeader.writeUInt32LE(compressedSize, 20);   // Compressed size
  centralHeader.writeUInt32LE(uncompressedSize, 24); // Uncompressed size
  centralHeader.writeUInt16LE(filenameBytes.length, 28); // File name length
  centralHeader.writeUInt16LE(0, 30);         // Extra field length
  centralHeader.writeUInt16LE(0, 32);         // File comment length
  centralHeader.writeUInt16LE(0, 34);         // Disk number start
  centralHeader.writeUInt16LE(0, 36);         // Internal file attributes
  centralHeader.writeUInt32LE(0, 38);         // External file attributes
  centralHeader.writeUInt32LE(0, 42);         // Relative offset of local header
  filenameBytes.copy(centralHeader, 46);

  // --- End of central directory ---
  const centralDirOffset = localHeader.length + compressed.length;
  const centralDirSize = centralHeader.length;
  const endOfCentral = Buffer.alloc(22);
  endOfCentral.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  endOfCentral.writeUInt16LE(0, 4);          // Number of this disk
  endOfCentral.writeUInt16LE(0, 6);          // Disk where central directory starts
  endOfCentral.writeUInt16LE(1, 8);          // Number of central directory records on this disk
  endOfCentral.writeUInt16LE(1, 10);         // Total number of central directory records
  endOfCentral.writeUInt32LE(centralDirSize, 12);    // Size of central directory
  endOfCentral.writeUInt32LE(centralDirOffset, 16);  // Offset of start of central directory
  endOfCentral.writeUInt16LE(0, 20);         // Comment length

  return Buffer.concat([localHeader, compressed, centralHeader, endOfCentral]);
}

// ---------------------------------------------------------------------------
// CRC-32 implementation (IEEE 802.3 / ISO 3309 polynomial)
// ---------------------------------------------------------------------------

const CRC_TABLE = makeCrcTable();

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
