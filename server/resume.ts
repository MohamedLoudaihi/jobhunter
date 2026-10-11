import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { inflateRawSync } from 'node:zlib';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const MAX_RESUME_CHARACTERS = 120_000;

export class ResumeError extends Error {}

/** Verify DOCX expansion bounds before passing the archive to the document parser. */
function validateDocxArchive(buffer: Buffer): void {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end === -1) throw new ResumeError('This DOCX archive could not be read. Try exporting a new copy or paste the text.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (count > 1000 || buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0) throw new ResumeError('This DOCX document is too complex. Export it as PDF or paste the text.');
  let expandedBytes = 0;
  const names = new Set<string>();
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new ResumeError('Invalid DOCX archive.');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const expectedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (flags & 1 || ![0, 8].includes(method) || expectedSize > 10 * 1024 * 1024 || localOffset + 30 > buffer.length) throw new ResumeError('This DOCX archive is encrypted or too large. Export a simple copy or paste the text.');
    names.add(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new ResumeError('Invalid DOCX archive.');
    const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (dataOffset + compressedSize > buffer.length) throw new ResumeError('Invalid DOCX archive.');
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const actualSize = method === 8 ? inflateRawSync(compressed, { maxOutputLength: 10 * 1024 * 1024 }).byteLength : compressed.byteLength;
    expandedBytes += actualSize;
    if (actualSize !== expectedSize || expandedBytes > 20 * 1024 * 1024) throw new ResumeError('This DOCX document expands to more than 20 MB. Export a simple copy or paste the text.');
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  if (!names.has('word/document.xml')) throw new ResumeError('This file is not a valid DOCX document.');
}

/** Files stay in memory and are discarded after this request. */
export async function extractResumeText(buffer: Buffer, filename: string): Promise<string> {
  if (buffer.length > MAX_RESUME_BYTES) throw new ResumeError('Please upload a resume smaller than 5 MB.');
  const extension = path.extname(filename).toLowerCase();
  let text: string;
  if (extension === '.txt') {
    if (buffer.includes(0)) throw new ResumeError('This file does not look like a plain-text resume.');
    text = buffer.toString('utf8');
  } else if (extension === '.pdf') {
    if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new ResumeError('This file does not look like a PDF.');
    const parser = new PDFParse({ data: buffer });
    try {
      if ((await parser.getInfo()).total > 40) throw new ResumeError('Please upload a resume with no more than 40 pages.');
      text = (await parser.getText({ pageJoiner: '' })).text;
    } finally {
      await parser.destroy();
    }
  } else if (extension === '.docx') {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new ResumeError('This file does not look like a DOCX document.');
    validateDocxArchive(buffer);
    text = (await mammoth.extractRawText({ buffer })).value;
  } else {
    throw new ResumeError('Upload a PDF, DOCX, or TXT resume.');
  }
  return validateResumeText(text);
}

export function validateResumeText(text: string): string {
  const cleaned = text.replace(/\u0000/g, '').trim();
  if (cleaned.length < 40) throw new ResumeError('Please include at least 40 characters of resume text. Scanned PDFs need OCR first; you can paste their text instead.');
  if (cleaned.length > MAX_RESUME_CHARACTERS) throw new ResumeError('This resume is too long. Please keep the extracted text below 120,000 characters.');
  return cleaned;
}
