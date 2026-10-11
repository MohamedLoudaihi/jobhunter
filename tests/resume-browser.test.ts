import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { MAX_LOCAL_RESUME_BYTES, parseResumeLocally, validateDocxArchiveLocally, validateLocalResumeText } from '../src/resume-browser';

const resume = 'Jane Doe\nExperience\nBuilt a Python reporting tool for a volunteer team.\nSkills: Python, SQL, Docker.';

test('local pasted and UTF-8 text parsing produce a profile without browser network or APIs', async () => {
  const pasted = await parseResumeLocally(undefined, resume, 'Pasted resume');
  const uploaded = await parseResumeLocally(new File([`\ufeff${resume}`], 'resume.TXT'));
  assert.equal(pasted.name, 'Jane Doe');
  assert.deepEqual(uploaded.skills, pasted.skills);
  assert.equal(uploaded.filename, 'resume.TXT');
  assert.equal(uploaded.yearsExperience, null);
});

test('local parser rejects invalid text, misleading file formats, oversized files and overlong pasted text', async () => {
  await assert.rejects(parseResumeLocally(new File([Uint8Array.of(0xff, 0xfe, 0, 1)], 'cv.txt')), /UTF-8 plain-text/);
  await assert.rejects(parseResumeLocally(new File([Uint8Array.of(0xc3, 0x28)], 'cv.txt')), /UTF-8 plain-text/);
  await assert.rejects(parseResumeLocally(new File([resume], 'cv.pdf')), /does not look like a PDF/);
  await assert.rejects(parseResumeLocally(new File([resume], 'cv.docx')), /does not look like a DOCX/);
  await assert.rejects(parseResumeLocally(new File([resume], 'cv.doc')), /PDF, DOCX, or TXT/);
  await assert.rejects(parseResumeLocally(new File([new Uint8Array(MAX_LOCAL_RESUME_BYTES + 1)], 'cv.txt')), /smaller than 5 MB/);
  await assert.rejects(parseResumeLocally(undefined, 'x'.repeat(120_001)), /120,000/);
  assert.throws(() => validateLocalResumeText('a blank PDF'), /Scanned PDFs need OCR/);
});

test('local parsing respects cancellation before reading or importing document parsers', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(parseResumeLocally(new File([resume], 'cv.txt'), undefined, undefined, controller.signal), { name: 'AbortError' });
});

test('DOCX preflight validates actual compressed and stored archive entries', async () => {
  for (const level of [0, 6] as const) {
    const bytes = zipSync({ 'word/document.xml': strToU8('<document><paragraph>Example resume text.</paragraph></document>'), '[Content_Types].xml': strToU8('<Types/>') }, { level });
    await validateDocxArchiveLocally(bytes);
  }
});

test('DOCX preflight rejects corrupt payloads and archives without a Word document', async () => {
  await assert.rejects(validateDocxArchiveLocally(Uint8Array.of(0x50, 0x4b, 0, 0)), /could not be read/);
  await assert.rejects(validateDocxArchiveLocally(zipSync({ 'example.txt': strToU8('plain text') })), /not a valid DOCX/);
  const bytes = zipSync({ 'word/document.xml': strToU8('<document>Example text here.</document>') }, { level: 0 });
  bytes[30 + 'word/document.xml'.length] ^= 1;
  await assert.rejects(validateDocxArchiveLocally(bytes), /could not be read/);
});

test('DOCX preflight bounds actual expansion even when ZIP metadata lies about sizes', async () => {
  const bytes = zipSync({ 'word/document.xml': new Uint8Array(11 * 1024 * 1024).fill(65) }, { level: 9 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 46 <= bytes.length; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, 100, true);
      const local = view.getUint32(offset + 42, true);
      view.setUint32(local + 22, 100, true);
      break;
    }
  }
  await assert.rejects(validateDocxArchiveLocally(bytes), /expands to more than 20 MB/);
});
