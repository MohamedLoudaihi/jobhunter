import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { deflateRawSync } from 'node:zlib';
import { createApp } from '../server/index.js';
import { countriesFromLocation, createJobSearcher, matchesPreferences, safeExternalUrl } from '../server/jobs.js';
import { extractResumeText, MAX_RESUME_BYTES } from '../server/resume.js';
import { analyzeResume } from '../shared/career.js';
import type { Job, Preferences } from '../shared/types.js';

const resumeText = 'Jane Smith\nSoftware engineer with 5 years of experience building React and TypeScript applications. Skills: JavaScript, React, TypeScript, Node.js, SQL.';
const profile = analyzeResume(resumeText, 'jane.txt');
const preferences: Preferences = { country: 'Morocco', query: '', workMode: 'any', employmentType: 'any', experienceLevel: 'any' };
const emptyResult = { jobs: [], sources: [], searchedAt: new Date().toISOString(), totalFetched: 0 };

async function withApp(run: (base: string) => Promise<void>) {
  const server = createApp({ search: async () => emptyResult }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function minimalPdf(text: string, pageCount = 1): Buffer {
  const stream = `BT /F1 11 Tf 40 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array(pageCount).fill('3 0 R').join(' ')}] /Count ${pageCount} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets.slice(1).map(offset => `${offset.toString().padStart(10, '0')} 00000 n \n`).join('');
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(content);
}

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zip(files: Record<string, string>, fakeSize?: number): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [filename, text] of Object.entries(files)) {
    const name = Buffer.from(filename);
    const data = Buffer.from(text);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(fakeSize ?? data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(fakeSize ?? data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const directoryBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryBytes, end]);
}

function minimalDocx(): Buffer {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${resumeText}</w:t></w:r></w:p></w:body></w:document>`,
  });
}

test('health, pasted resume analysis, validated search, and sanitized malformed requests', async () => {
  await withApp(async base => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    assert.equal(health.headers.get('cache-control'), 'no-store');
    const analyzed = await fetch(`${base}/api/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: resumeText }) });
    assert.equal(analyzed.status, 200);
    const analyzedProfile = await analyzed.json();
    assert.ok(analyzedProfile.skills.includes('React'));
    assert.equal(analyzedProfile.text, resumeText);
    const search = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: analyzedProfile, preferences }) });
    assert.equal(search.status, 200);
    assert.deepEqual((await search.json()).jobs, []);
    const invalid = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile, preferences: { ...preferences, country: 'Atlantis' } }) });
    assert.equal(invalid.status, 400);
    const malformed = await fetch(`${base}/api/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"secret":"do-not-echo"' });
    assert.equal(malformed.status, 400);
    assert.ok(!(await malformed.text()).includes('do-not-echo'));
  });
});

test('TXT, valid PDF, and valid DOCX resumes extract usable text', async () => {
  assert.equal(await extractResumeText(Buffer.from(resumeText), 'resume.txt'), resumeText);
  assert.match(await extractResumeText(minimalPdf(resumeText.replace(/\n/g, ' ')), 'resume.pdf'), /React and TypeScript/);
  assert.match(await extractResumeText(minimalDocx(), 'resume.docx'), /React and TypeScript/);
  await withApp(async base => {
    for (const [filename, bytes] of [['resume.pdf', minimalPdf(resumeText.replace(/\n/g, ' '))], ['resume.docx', minimalDocx()]] as const) {
      const form = new FormData();
      form.set('resume', new Blob([new Uint8Array(bytes)]), filename);
      const response = await fetch(`${base}/api/resume`, { method: 'POST', body: form });
      assert.equal(response.status, 200, await response.clone().text());
      assert.ok((await response.json()).skills.includes('TypeScript'));
    }
  });
});

test('corrupt, unsupported, empty and oversized documents fail without persistence', async () => {
  await assert.rejects(extractResumeText(Buffer.from(resumeText), 'resume.exe'), /PDF, DOCX, or TXT/);
  await assert.rejects(extractResumeText(Buffer.from(resumeText), 'resume.pdf'), /does not look like a PDF/);
  await assert.rejects(extractResumeText(Buffer.from('tiny'), 'resume.txt'), /at least 40 characters/);
  await assert.rejects(extractResumeText(minimalPdf('', 3), 'blank.pdf'), /at least 40 characters/);
  await assert.rejects(extractResumeText(zip({ 'word/document.xml': 'small' }, 30 * 1024 * 1024), 'resume.docx'), /too large/);
  await assert.rejects(extractResumeText(zip({ 'word/document.xml': 'small' }, 4), 'resume.docx'), /expands/);
  await withApp(async base => {
    const form = new FormData();
    form.set('resume', new Blob([new Uint8Array(MAX_RESUME_BYTES + 1)]), 'large.txt');
    const response = await fetch(`${base}/api/resume`, { method: 'POST', body: form });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /smaller than 5 MB/);
  });
});

test('country eligibility handles restrictions conservatively and rejects unsafe links', () => {
  assert.deepEqual(countriesFromLocation('Remote'), []);
  assert.deepEqual(countriesFromLocation('US timezones'), []);
  assert.deepEqual(countriesFromLocation('Worldwide (US working hours)'), []);
  assert.deepEqual(countriesFromLocation('Remote (Worldwide)'), ['WORLDWIDE']);
  assert.ok(countriesFromLocation('Worldwide — must be based in Europe').includes('FR'));
  assert.ok(!countriesFromLocation('Worldwide — must be based in Europe').includes('MA'));
  assert.ok(countriesFromLocation('Worldwide, EU residents').includes('FR'));
  assert.ok(!countriesFromLocation('Worldwide, EU residents').includes('US'));
  assert.deepEqual(countriesFromLocation('Remote US'), ['US']);
  assert.deepEqual(countriesFromLocation('US Remote'), ['US']);
  assert.deepEqual(countriesFromLocation('Anywhere in the US'), ['US']);
  assert.ok(countriesFromLocation('Remote anywhere in Europe').includes('FR'));
  assert.ok(!countriesFromLocation('Remote anywhere in Europe').includes('MA'));
  assert.ok(countriesFromLocation('EMEA').includes('MA'));
  assert.ok(!countriesFromLocation('Worldwide excluding United States').includes('US'));
  assert.ok(countriesFromLocation('Worldwide excluding United States').includes('MA'));
  assert.ok(!countriesFromLocation('Worldwide, not US').includes('US'));
  assert.ok(!countriesFromLocation('US only (not Canada)').includes('CA'));
  assert.deepEqual(countriesFromLocation('Worldwide except an unknown location'), []);
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('https://user:password@example.com'), null);
  assert.equal(safeExternalUrl('https://example.com/job'), 'https://example.com/job');
  const job = { title: 'Software engineer', description: 'TypeScript', tags: [], countries: [], remote: true, employmentType: 'full-time' } as unknown as Job;
  assert.equal(matchesPreferences(job, preferences), false);
  assert.equal(matchesPreferences({ ...job, countries: ['WORLDWIDE'] }, preferences), true);
  assert.equal(matchesPreferences({ ...job, countries: ['WORLDWIDE'] }, { ...preferences, experienceLevel: 'senior' }), false);
});

test('live source adapter ranks real fixture data, excludes unknown countries and unsafe URLs', async () => {
  const search = createJobSearcher({ env: {}, fetcher: async url => new Response(JSON.stringify(url.includes('arbeitnow') ? { data: [
    { title: 'TypeScript Engineer', slug: 'germany', url: 'https://jobs.example/de', location: 'Berlin', description: '<p>React TypeScript</p>', tags: ['React'], company_name: 'Example', remote: true, job_types: ['full-time'] }, null,
  ] } : { jobs: [
    { id: 1, title: 'React Engineer', url: 'https://remotive.com/job/1', candidate_required_location: 'Worldwide', description: '<p>React TypeScript</p>', job_type: 'full_time' },
    { id: 2, title: 'React Engineer', url: 'https://remotive.com/job/2', candidate_required_location: 'United States', description: 'React' },
    { id: 3, title: 'React Engineer', url: 'https://remotive.com/job/3', candidate_required_location: '', description: 'React' },
    { id: 4, title: 'React Engineer', url: 'javascript:alert(1)', candidate_required_location: 'Worldwide', description: 'React' }, null,
  ] }), { headers: { 'Content-Type': 'application/json' } }) });
  const result = await search(profile, preferences);
  assert.equal(result.totalFetched, 4);
  assert.deepEqual(result.jobs.map(job => job.id), ['remotive-1']);
  assert.ok(result.jobs[0].score > 0);
  assert.ok(result.jobs[0].matchedSkills.includes('React'));
  assert.ok(result.sources.every(source => source.status === 'ok'));
  assert.match(result.sources.find(source => source.name === 'Remotive')!.message, /provided by Remotive/);
});

test('source cache respects Remotive polling guidance and coalesces concurrent searches', async () => {
  let timestamp = 1_000;
  let calls = 0;
  const search = createJobSearcher({ now: () => timestamp, env: {}, fetcher: async url => { calls++; return new Response(JSON.stringify(url.includes('arbeitnow') ? { data: [] } : { jobs: [] })); } });
  await Promise.all([search(profile, preferences), search(profile, preferences)]);
  assert.equal(calls, 2);
  timestamp += 20 * 60 * 1000;
  await search(profile, preferences);
  assert.equal(calls, 3);
  timestamp += 6 * 60 * 60 * 1000;
  await search(profile, preferences);
  assert.equal(calls, 5);
});

test('source failures never become fake results, redact diagnostics, and back off before retry', async () => {
  let timestamp = 1_000;
  let calls = 0;
  const search = createJobSearcher({ now: () => timestamp, env: {}, fetcher: async () => { calls++; throw new Error('https://provider/?app_key=super-secret'); } });
  const result = await search(profile, preferences);
  assert.deepEqual(result.jobs, []);
  assert.equal(result.totalFetched, 0);
  assert.ok(result.sources.every(source => source.status === 'error'));
  assert.ok(!JSON.stringify(result).includes('super-secret'));
  await search(profile, preferences);
  assert.equal(calls, 2);
  timestamp += 61_000;
  await search(profile, preferences);
  assert.equal(calls, 4);
});
