import { test, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { SAMPLE_RESUME } from '../shared/demo';

function pdfFixture(text: string): Buffer {
  const encoded = text.replace(/[\\()]/g, value => `\\${value}`);
  const stream = Buffer.from(`BT /F1 11 Tf 30 720 Td (${encoded}) Tj ET`);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream.toString()}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
function docxFixture(text: string): Buffer {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split('\n').map(line => `<w:p><w:r><w:t>${escape(line)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`),
  }));
}
const minimalResume = 'Alex Morgan Frontend Developer with 3 years of experience. Skills: React, TypeScript, JavaScript, HTML, CSS, Git, Figma.';

for (const fixture of [
  { name: 'alex.txt', type: 'text/plain', buffer: Buffer.from(SAMPLE_RESUME) },
  { name: 'alex.pdf', type: 'application/pdf', buffer: pdfFixture(minimalResume) },
  { name: 'alex.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFixture(SAMPLE_RESUME) },
]) {
  test(`Pages parses ${fixture.name} locally and matches real feed without API requests`, async ({ page }) => {
    const requests: { url: string; method: string }[] = [];
    const errors: string[] = [];
    page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('./');
    await page.getByLabel('Upload your résumé').setInputFiles({ name: fixture.name, mimeType: fixture.type, buffer: fixture.buffer });
    await expect(page.getByText(fixture.name, { exact: false })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.profile-skills')).toContainText('React');
    await expect(page.locator('.job-card').first()).toBeVisible();
    expect(requests.some(request => new URL(request.url).pathname === '/jobhunter/jobs.json')).toBe(true);
    expect(requests.some(request => request.url.includes('/api/') || request.method !== 'GET')).toBe(false);
    expect(requests.every(request => new URL(request.url).hostname === '127.0.0.1')).toBe(true);
    if (fixture.name.endsWith('pdf')) expect(requests.some(request => request.url.includes('/jobhunter/assets/pdf.worker'))).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('alex@example.com');
    expect(errors).toEqual([]);
  });
}

test('Pages provides job-specific letters and persistent tracking after pasted resume', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /Paste résumé text/ }).click();
  await page.getByLabel('Your résumé text', { exact: true }).fill(SAMPLE_RESUME);
  await page.locator('.paste-area').getByRole('button', { name: 'Find my matches' }).click();
  const card = page.locator('.job-card').first();
  await expect(card).toBeVisible();
  const title = await card.locator('h3 button').innerText();
  await card.locator('h3 button').click();
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('tab', { name: 'Cover letter' }).click();
  await expect(drawer.getByLabel('Edit your cover letter')).toHaveValue(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect(drawer.getByRole('link', { name: 'Apply at source' })).toHaveAttribute('href', /^https?:\/\//);
  await drawer.getByRole('button', { name: 'Save opportunity', exact: true }).click();
  await drawer.getByRole('button', { name: 'Close job details' }).click();
  await page.getByRole('button', { name: /^Applications/ }).click();
  await page.getByLabel(`Stage for ${title}`).selectOption('Applied');
  await page.getByLabel('Your notes').fill('Submitted; follow up in five business days.');
  await page.reload();
  await page.getByRole('button', { name: /^Applications/ }).click();
  await expect(page.getByLabel('Your notes')).toHaveValue('Submitted; follow up in five business days.');
  await page.getByRole('button', { name: 'Plan your follow-up' }).click();
  await expect(page.getByRole('dialog').getByText(/Subject: Follow-up on my/)).toBeVisible();
});

test('Pages rejects blank PDFs and unsafe uploads with useful guidance', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Upload your résumé').setInputFiles({ name: 'blank.pdf', mimeType: 'application/pdf', buffer: pdfFixture('') });
  await expect(page.getByRole('alert')).toContainText('OCR', { timeout: 15000 });
  await page.getByLabel('Upload your résumé').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('This is not a PDF') });
  await expect(page.getByRole('alert')).toContainText('does not look like a PDF');
  await page.getByLabel('Upload your résumé').setInputFiles({ name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 'a') });
  await expect(page.getByRole('alert')).toContainText('5 MB');
});

test('Pages guided demo supports mobile and does not show real application links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Explore a guided demo' }).click();
  await expect(page.locator('.job-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Frontend Developer', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Apply at source' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
