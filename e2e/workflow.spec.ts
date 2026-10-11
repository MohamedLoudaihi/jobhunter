import { test, expect } from '@playwright/test';
import { SAMPLE_RESUME, DEMO_JOBS } from '../shared/demo';
import { analyzeResume, rankJob } from '../shared/career';
import type { SearchResult } from '../shared/types';

const fixtureJob = rankJob(analyzeResume(SAMPLE_RESUME, 'test.txt'), {
  ...DEMO_JOBS[0], id: 'fixture-live', title: 'Test Frontend Engineer', company: 'Test Employer',
  source: 'Arbeitnow', url: 'https://example.com/careers/test-role',
});
const result: SearchResult = {
  jobs: [fixtureJob], sources: [{ name: 'Arbeitnow', status: 'ok', count: 1, message: 'Mocked provider for browser validation.' }],
  searchedAt: new Date().toISOString(), totalFetched: 1,
};

test('guided demo prepares a letter and persists application stages and notes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore a guided demo' }).click();
  await expect(page.getByText('Sample résumé and fictional job listings. These are not current vacancies.')).toBeVisible();
  await page.getByRole('button', { name: 'Frontend Developer', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Job details: Frontend Developer' });
  await expect(drawer.getByRole('link', { name: 'Apply at source' })).toHaveCount(0);
  await drawer.getByRole('tab', { name: 'Résumé tips' }).click();
  await expect(drawer.getByText(/Add numbers only when you can verify them/)).toBeVisible();
  await drawer.getByRole('tab', { name: 'Cover letter' }).click();
  const letter = drawer.getByLabel('Edit your cover letter');
  await expect(letter).toHaveValue(/Northstar Studio/);
  await expect(letter).toHaveValue(/Built React interfaces/);
  await letter.fill((await letter.inputValue()) + '\nReviewed by me.');
  const download = page.waitForEvent('download');
  await drawer.getByRole('button', { name: 'Download .txt', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/cover-letter.*\.txt/);
  await drawer.getByRole('tab', { name: 'Next steps' }).click();
  await expect(drawer.getByText('Good questions for your next conversation')).toBeVisible();
  await drawer.getByRole('button', { name: 'Save opportunity', exact: true }).click();
  await drawer.getByRole('button', { name: 'Close job details' }).click();
  await page.getByRole('button', { name: /^Applications/ }).click();
  await page.getByLabel('Stage for Frontend Developer').selectOption('Applied');
  await page.getByLabel('Your notes').fill('Submitted through careers page. Follow up next week.');
  await page.reload();
  await page.getByRole('button', { name: /^Applications/ }).click();
  await expect(page.getByLabel('Stage for Frontend Developer')).toHaveValue('Applied');
  await expect(page.getByLabel('Your notes')).toHaveValue('Submitted through careers page. Follow up next week.');
  await page.getByRole('button', { name: 'Plan your follow-up' }).click();
  await expect(page.getByRole('dialog').getByText(/Subject: Follow-up on my Frontend Developer application/)).toBeVisible();
  await page.getByRole('button', { name: 'Close job details' }).click();
  await page.getByRole('button', { name: 'Remove Frontend Developer from tracker' }).click();
  await expect(page.getByText('Make room for possibility.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('pasting a resume automatically searches and country and role filters refresh it', async ({ page }) => {
  const searches: any[] = [];
  await page.route('**/api/jobs', async route => {
    searches.push(route.request().postDataJSON());
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Paste résumé text/ }).click();
  await page.getByLabel('Your résumé text', { exact: true }).fill(SAMPLE_RESUME);
  await page.locator('.paste-area').getByRole('button', { name: 'Find my matches' }).click();
  await expect(page.getByRole('button', { name: fixtureJob.title, exact: true })).toBeVisible();
  expect(searches[0].profile.skills).toContain('React');
  await page.getByLabel('Country').selectOption({label:'Morocco'});
  await expect.poll(() => searches.at(-1)?.preferences.country).toBe('MA');
  await page.getByLabel('Role or keywords').fill('Frontend');
  await expect.poll(() => searches.at(-1)?.preferences.query).toBe('Frontend');
  await page.getByRole('button', { name: fixtureJob.title, exact: true }).click();
  await expect(page.getByRole('link', { name: 'Apply at source' })).toHaveAttribute('href', fixtureJob.url);
});

test('TXT upload extracts resume and starts search without storing resume in localStorage', async ({ page }) => {
  await page.route('**/api/jobs', route => route.fulfill({ json: result }));
  await page.goto('/');
  await page.getByLabel('Upload your résumé').setInputFiles({ name: 'alex-resume.txt', mimeType: 'text/plain', buffer: Buffer.from(SAMPLE_RESUME) });
  await expect(page.getByText('alex-resume.txt', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: fixtureJob.title, exact: true })).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain('alex@example.com');
  expect(storage).not.toContain('Built React interfaces');
});

test('unavailable sources show an honest empty state and manual job kits still work', async ({ page }) => {
  await page.route('**/api/jobs', route => route.fulfill({ json: { ...result, jobs: [], totalFetched: 0, sources: [{ name: 'Remotive', status: 'error', count: 0, message: 'Provider unavailable in this test.' }] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample résumé', exact: true }).click();
  await expect(page.getByText('Live job sources are temporarily unavailable.')).toBeVisible();
  await expect(page.locator('.job-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add a job listing', exact: true }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a job listing' });
  await form.getByLabel('Job title').fill('UI Engineer');
  await form.getByLabel('Company', { exact: true }).fill('Actual Listing Test');
  await form.getByLabel('Location').fill('Morocco');
  await form.getByLabel('Application URL').fill('https://example.com/careers/ui');
  await form.getByLabel('Full job description').fill('Build accessible React and TypeScript interfaces. Work with Figma and CSS. Python and Docker are useful extra skills.');
  await form.getByRole('button', { name: 'Build my application kit' }).click();
  const drawer = page.getByRole('dialog', { name: 'Job details: UI Engineer' });
  await expect(drawer.getByText('Via Your listing')).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Apply at source' })).toHaveAttribute('href', 'https://example.com/careers/ui');
  await drawer.getByRole('tab', { name: 'Cover letter' }).click();
  await expect(drawer.getByLabel('Edit your cover letter')).toHaveValue(/UI Engineer position at Actual Listing Test/);
  await expect(drawer.getByLabel('Edit your cover letter')).not.toHaveValue(/My resume lists.*(?:Python|Docker)/);
});

test('demo country and full-time filters keep worldwide examples', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore a guided demo' }).click();
  await expect(page.locator('.job-card')).toHaveCount(3);
  await page.getByLabel('Country').selectOption({label:'Japan'});
  await page.getByLabel('Job type').selectOption('full-time');
  await expect(page.locator('.job-card')).toHaveCount(3);
});

test('corrupt browser tracker entries do not crash the application', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jobhunter.applications.v1', JSON.stringify([{id:'broken',job:{title:'Broken listing'},stage:'Applied',notes:''}])));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: /^Applications/ }).click();
  await expect(page.getByText('Make room for possibility.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile layout supports demo, drawer and keyboard close without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore a guided demo' }).click();
  await expect(page.locator('.job-card')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Frontend Developer', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
