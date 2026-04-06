import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { inflateRawSync } from 'node:zlib';
import { createZipFromFile } from '../deployers/zip-util.js';

describe('createZipFromFile', () => {
  it('creates a valid zip archive', () => {
    const content = Buffer.from('console.log("hello world");');
    const zip = createZipFromFile('index.js', content);

    // Check local file header signature
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  });

  it('contains the correct filename', () => {
    const content = Buffer.from('test content');
    const zip = createZipFromFile('handler.js', content);

    // Filename starts at offset 30 in the local file header
    const filenameLen = zip.readUInt16LE(26);
    expect(filenameLen).toBe(10); // "handler.js"
    const filename = zip.subarray(30, 30 + filenameLen).toString('utf-8');
    expect(filename).toBe('handler.js');
  });

  it('can decompress to original content', () => {
    const originalContent = 'exports.handler = async () => ({ statusCode: 200 });';
    const content = Buffer.from(originalContent);
    const zip = createZipFromFile('index.js', content);

    // Extract the compressed data
    const compressedSize = zip.readUInt32LE(18);
    const filenameLen = zip.readUInt16LE(26);
    const dataOffset = 30 + filenameLen;
    const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);

    // Decompress and verify
    const decompressed = inflateRawSync(compressed);
    expect(decompressed.toString('utf-8')).toBe(originalContent);
  });

  it('stores correct uncompressed size', () => {
    const content = Buffer.from('a'.repeat(1000));
    const zip = createZipFromFile('test.js', content);

    const uncompressedSize = zip.readUInt32LE(22);
    expect(uncompressedSize).toBe(1000);
  });

  it('has end of central directory record', () => {
    const content = Buffer.from('test');
    const zip = createZipFromFile('test.js', content);

    // End of central directory signature should be at the end
    const eocdOffset = zip.length - 22;
    expect(zip.readUInt32LE(eocdOffset)).toBe(0x06054b50);
  });

  it('reports 1 file in central directory', () => {
    const content = Buffer.from('test');
    const zip = createZipFromFile('test.js', content);

    // End of central directory: number of records
    const eocdOffset = zip.length - 22;
    const numRecords = zip.readUInt16LE(eocdOffset + 10);
    expect(numRecords).toBe(1);
  });

  it('handles empty content', () => {
    const content = Buffer.from('');
    const zip = createZipFromFile('empty.js', content);

    // Should still be a valid zip
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(22)).toBe(0); // uncompressed size = 0
  });

  it('handles large content', () => {
    // ~100KB file (typical Lambda bundle might be 1-5MB)
    const content = Buffer.from('x'.repeat(100_000));
    const zip = createZipFromFile('large.js', content);

    // Verify it compresses (repeated chars compress well)
    expect(zip.length).toBeLessThan(content.length);

    // Verify decompression
    const compressedSize = zip.readUInt32LE(18);
    const filenameLen = zip.readUInt16LE(26);
    const dataOffset = 30 + filenameLen;
    const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);
    const decompressed = inflateRawSync(compressed);
    expect(decompressed.length).toBe(100_000);
  });

  it('uses DEFLATE compression method', () => {
    const content = Buffer.from('test');
    const zip = createZipFromFile('test.js', content);

    // Compression method at offset 8 in local header
    const method = zip.readUInt16LE(8);
    expect(method).toBe(8); // DEFLATE
  });
});
