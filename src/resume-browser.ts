import { analyzeResume } from '../shared/career';
import type { ResumeProfile } from '../shared/types';

export const MAX_LOCAL_RESUME_BYTES = 5 * 1024 * 1024;
export const MAX_LOCAL_RESUME_CHARACTERS = 120_000;
const MAX_DOCX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_EXPANDED_BYTES = 20 * 1024 * 1024;

export class LocalResumeError extends Error {
  constructor(message: string) { super(message); this.name = 'ResumeError'; }
}

function aborted(): DOMException {
  return new DOMException('Resume parsing was cancelled.', 'AbortError');
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted();
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function validateLocalResumeText(text: string): string {
  const cleaned = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  if (cleaned.length < 40) throw new LocalResumeError('Please include at least 40 characters of resume text. Scanned PDFs need OCR first; you can paste their text instead.');
  if (cleaned.length > MAX_LOCAL_RESUME_CHARACTERS) throw new LocalResumeError('This resume is too long. Please keep the extracted text below 120,000 characters.');
  return cleaned;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

/** Validate actual expansion before Mammoth opens a DOCX. No entry is written to disk. */
export async function validateDocxArchiveLocally(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
  const invalid = () => new LocalResumeError('This DOCX archive could not be read. Export a new copy or paste the text.');
  const tooLarge = () => new LocalResumeError('This DOCX document is encrypted, too complex, or expands to more than 20 MB. Export a simple copy or paste the text.');
  checkAbort(signal);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fits = (offset: number, length: number) => offset >= 0 && length >= 0 && offset + length <= bytes.length;
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw invalid();
  const count = u16(end + 10);
  const centralSize = u32(end + 12);
  let offset = u32(end + 16);
  const centralEnd = offset + centralSize;
  if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== count || count > 1000 || count === 0xffff || centralEnd !== end || !fits(offset, centralSize)) throw tooLarge();
  const names = new Set<string>();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const { Inflate } = await abortable(import('fflate/browser'), signal);
  let totalExpanded = 0;
  let compressedChunks = 0;
  for (let entry = 0; entry < count; entry++) {
    checkAbort(signal);
    if (!fits(offset, 46) || offset + 46 > centralEnd || u32(offset) !== 0x02014b50) throw invalid();
    const flags = u16(offset + 8);
    const method = u16(offset + 10);
    const expectedCrc = u32(offset + 16);
    const compressedSize = u32(offset + 20);
    const expectedSize = u32(offset + 24);
    const nameLength = u16(offset + 28);
    const extraLength = u16(offset + 30);
    const commentLength = u16(offset + 32);
    const localOffset = u32(offset + 42);
    if (flags & 1 || ![0, 8].includes(method) || expectedSize > MAX_DOCX_ENTRY_BYTES || compressedSize === 0xffffffff || localOffset === 0xffffffff || u16(offset + 34) !== 0) throw tooLarge();
    if (!fits(offset + 46, nameLength + extraLength + commentLength) || offset + 46 + nameLength + extraLength + commentLength > centralEnd || !fits(localOffset, 30) || u32(localOffset) !== 0x04034b50) throw invalid();
    let name: string;
    try { name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); } catch { throw invalid(); }
    if (names.has(name)) throw invalid();
    names.add(name);
    const localNameLength = u16(localOffset + 26);
    const localExtraLength = u16(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (u16(localOffset + 6) !== flags || u16(localOffset + 8) !== method || !fits(localOffset + 30, localNameLength + localExtraLength) || !fits(dataOffset, compressedSize) || dataOffset + compressedSize > u32(end + 16)) throw invalid();
    let localName: string;
    try { localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)); } catch { throw invalid(); }
    if (localName !== name) throw invalid();
    if (!(flags & 8) && (u32(localOffset + 14) !== expectedCrc || u32(localOffset + 18) !== compressedSize || u32(localOffset + 22) !== expectedSize)) throw invalid();
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let actualSize = 0;
    let crc = 0xffffffff;
    const consume = (chunk: Uint8Array) => {
      actualSize += chunk.length;
      totalExpanded += chunk.length;
      if (actualSize > MAX_DOCX_ENTRY_BYTES || totalExpanded > MAX_DOCX_EXPANDED_BYTES) throw tooLarge();
      for (const byte of chunk) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    };
    try {
      if (method === 0) consume(compressed);
      else {
        const inflater = new Inflate(consume);
        // Tiny input chunks bound the transient output of a deceptive compressed entry.
        for (let position = 0; position < compressed.length; position += 1024) {
          checkAbort(signal);
          inflater.push(compressed.subarray(position, position + 1024), position + 1024 >= compressed.length);
          if (++compressedChunks % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        if (!compressed.length) throw invalid();
      }
    } catch (error) {
      if (error instanceof LocalResumeError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      throw invalid();
    }
    if (actualSize !== expectedSize || ((crc ^ 0xffffffff) >>> 0) !== expectedCrc) throw invalid();
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralEnd || !names.has('word/document.xml')) throw new LocalResumeError('This file is not a valid DOCX document.');
  checkAbort(signal);
}

async function pdfText(buffer: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  const [pdfjs, workerAsset] = await abortable(Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]), signal);
  checkAbort(signal);
  // Vite emits this asset under the configured Pages base path; no CDN is used.
  const port = new Worker(workerAsset.default, { type: 'module' });
  const worker = pdfjs.PDFWorker.create({ port, verbosity: 0 });
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer), worker, verbosity: 0,
    useWorkerFetch: false, useWasm: false,
    enableXfa: false, disableFontFace: true, useSystemFonts: false,
    isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    disableRange: true, disableStream: true, disableAutoFetch: true,
    stopAtErrors: true,
  });
  const onAbort = () => {
    void task.destroy().catch(() => undefined);
    worker.destroy();
    port.terminate();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const document = await abortable(task.promise, signal);
    if (document.numPages > 40) throw new LocalResumeError('Please upload a resume with no more than 40 pages.');
    let text = '';
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      checkAbort(signal);
      const page = await abortable(document.getPage(pageNumber), signal);
      try {
        const content = await abortable(page.getTextContent(), signal);
        for (const item of content.items) {
          if ('str' in item) text += `${item.str}${item.hasEOL ? '\n' : ' '}`;
          if (text.length > MAX_LOCAL_RESUME_CHARACTERS) throw new LocalResumeError('This resume is too long. Please keep the extracted text below 120,000 characters.');
        }
        text += '\n';
      } finally { page.cleanup(); }
    }
    return text;
  } catch (error) {
    if (error instanceof LocalResumeError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    if (error instanceof Error && (error.name === 'PasswordException' || /password/i.test(error.message))) throw new LocalResumeError('This PDF is password-protected. Export an unlocked copy or paste the resume text.');
    throw new LocalResumeError('This PDF could not be read. Export a new text-based PDF or paste the resume text.');
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!signal?.aborted) await task.destroy().catch(() => undefined);
    worker.destroy();
    port.terminate();
  }
}

/** Parse in the user's browser. Resume bytes never enter a request or leave the device. */
export async function parseResumeLocally(file?: File, text?: string, filename?: string, signal?: AbortSignal): Promise<ResumeProfile> {
  checkAbort(signal);
  if (!file) return analyzeResume(validateLocalResumeText(text ?? ''), filename || 'Pasted resume');
  if (file.size > MAX_LOCAL_RESUME_BYTES) throw new LocalResumeError('Please upload a resume smaller than 5 MB.');
  const extension = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase();
  if (!['txt', 'pdf', 'docx'].includes(extension ?? '')) throw new LocalResumeError('Upload a PDF, DOCX, or TXT resume.');
  const buffer = await abortable(file.arrayBuffer(), signal);
  const bytes = new Uint8Array(buffer);
  let extracted: string;
  if (extension === 'txt') {
    if (bytes.includes(0)) throw new LocalResumeError('This file does not look like a UTF-8 plain-text resume. Export it as UTF-8 or paste the text.');
    try { extracted = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new LocalResumeError('This file does not look like a UTF-8 plain-text resume. Export it as UTF-8 or paste the text.'); }
    if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(extracted)) throw new LocalResumeError('This file does not look like a plain-text resume. Export a new copy or paste the text.');
  } else if (extension === 'pdf') {
    if (!new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new LocalResumeError('This file does not look like a PDF.');
    extracted = await pdfText(buffer, signal);
  } else {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new LocalResumeError('This file does not look like a DOCX document.');
    await validateDocxArchiveLocally(bytes, signal);
    try {
      const mammoth = (await abortable(import('mammoth'), signal)).default;
      extracted = (await abortable(mammoth.extractRawText({ arrayBuffer: buffer }), signal)).value;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new LocalResumeError('This DOCX document could not be read. Export a new copy or paste the text.');
    }
  }
  checkAbort(signal);
  return analyzeResume(validateLocalResumeText(extracted), filename || file.name);
}
