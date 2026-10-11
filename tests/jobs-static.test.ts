import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { analyzeResume } from '../shared/career.js';
import { MAX_SNAPSHOT_JOBS, normalizeArbeitnow, normalizeRemotive, parseJobSnapshot, readBoundedJson, searchJobSnapshot, toPublicJob } from '../shared/jobs.js';
import type { JobSnapshot } from '../shared/jobs.js';
import type { Preferences } from '../shared/types.js';
import { createStaticJobSearcher } from '../src/job-search.js';
import { refreshSnapshot, saveJobSnapshot } from '../scripts/refresh-jobs.js';

const feedTime = Date.parse('2026-10-11T00:00:00.000Z');
const feedDate = new Date(feedTime).toISOString();
const profile = analyzeResume('Jane Candidate\nReact TypeScript developer with 5 years experience. Skills: React, TypeScript, JavaScript, Node.js, SQL.', 'private-resume.txt');
const preferences: Preferences = { country: 'Morocco', query: '', workMode: 'any', employmentType: 'any', experienceLevel: 'any' };
const remotivePayload = { jobs: [
  { id: 1, title: 'React Developer', company_name: 'Example Company', candidate_required_location: 'Worldwide', job_type: 'full_time', description: '<p>React and TypeScript applications.</p>', url: 'https://remotive.com/remote-jobs/software-dev/1', publication_date: '2026-10-10T12:00:00Z' },
  { id: 2, title: 'React Developer', candidate_required_location: 'US only', description: 'React', url: 'https://remotive.com/remote-jobs/software-dev/2' },
  { id: 3, title: 'React Developer', candidate_required_location: '', description: 'React', url: 'https://remotive.com/remote-jobs/software-dev/3' },
] };
const arbeitnowPayload = { data: [{ slug: 'ts-berlin', title: 'TypeScript Developer', company_name: 'German Company', location: 'Berlin', remote: true, tags: ['TypeScript'], job_types: ['full-time'], description: '<p>TypeScript and React.</p>', url: 'https://www.arbeitnow.com/jobs/ts-berlin' }] };

function snapshot(): JobSnapshot {
  const jobs = [...normalizeArbeitnow(arbeitnowPayload), ...normalizeRemotive(remotivePayload)].map(toPublicJob);
  return {
    version: 1, jobs, sources: [
      { name: 'Arbeitnow', status: 'ok', count: 1, message: 'Listings provided by Arbeitnow.', updatedAt: feedDate, lastAttemptAt: feedDate },
      { name: 'Remotive', status: 'ok', count: 3, message: 'Listings provided by Remotive; visit the original listing to apply.', updatedAt: feedDate, lastAttemptAt: feedDate },
    ], searchedAt: feedDate, totalFetched: jobs.length,
  };
}
const responseFor = (url: string) => new Response(JSON.stringify(url.includes('arbeitnow') ? arbeitnowPayload : remotivePayload), { headers: { 'Content-Type': 'application/json' } });

test('static search fetches the Pages base path without transmitting any candidate data', async () => {
  let calls = 0;
  const search = createStaticJobSearcher({ baseUrl: '/jobhunter/', now: () => feedTime + 1000, fetcher: async (url, init) => {
    calls++;
    assert.equal(url, '/jobhunter/jobs.json');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.body, undefined);
    assert.equal(init?.headers, undefined);
    assert.ok(!JSON.stringify({ url, init }).includes('Jane Candidate'));
    return new Response(JSON.stringify(snapshot()));
  } });
  const result = await search(profile, preferences);
  assert.equal(calls, 1);
  assert.deepEqual(result.jobs.map(job => job.id), ['remotive-1']);
  assert.ok(result.jobs[0].score > 0);
  assert.ok(result.jobs[0].matchedSkills.includes('React'));
  assert.equal(result.searchedAt, feedDate);
  assert.equal(result.updatedAt, feedDate);
  assert.match(result.sources.find(source => source.name === 'Remotive')!.message, /provided by Remotive/);
  assert.equal(result.totalFetched, 4);
});

test('snapshot validation bounds data, removes unsafe URLs, and strips candidate-derived fields', () => {
  const raw = snapshot();
  const candidate = { ...raw.jobs[0], score: 99, matchedSkills: ['private-secret'], resume: profile.text };
  const parsed = parseJobSnapshot({ ...raw, jobs: [candidate, { ...raw.jobs[1], url: 'javascript:alert(1)' }] });
  assert.equal(parsed.jobs.length, 1);
  assert.ok(!JSON.stringify(parsed).includes('private-secret'));
  assert.ok(!JSON.stringify(parsed).includes('Jane Candidate'));
  assert.ok(!('score' in parsed.jobs[0]));
  assert.ok(!('matchedSkills' in parsed.jobs[0]));
  assert.throws(() => parseJobSnapshot({ ...raw, jobs: Array(MAX_SNAPSHOT_JOBS + 1).fill(raw.jobs[0]) }), /invalid/);
  assert.throws(() => parseJobSnapshot({ ...raw, jobs: [{ ...raw.jobs[0], countries: 'WORLDWIDE' }] }), /invalid/);
  assert.throws(() => parseJobSnapshot({ ...raw, sources: [{ ...raw.sources[0], updatedAt: null }] }), /metadata/);
  assert.throws(() => parseJobSnapshot({ ...raw, searchedAt: 'not-a-date' }), /invalid/);
});

test('regional listings, full descriptions and missing provider IDs remain valid public data', () => {
  const longDescription = `${'Detailed job responsibilities. '.repeat(240)}Required: TypeScript and React.`;
  const normalized = normalizeRemotive({ jobs: [
    { title: 'Europe Developer', candidate_required_location: 'Europe', description: longDescription, url: 'https://remotive.com/remote-jobs/software-dev/europe' },
    { title: 'EMEA Developer', candidate_required_location: 'EMEA', description: 'TypeScript', url: 'https://remotive.com/remote-jobs/software-dev/emea' },
  ] });
  assert.ok(normalized[0].countries.includes('XK'));
  assert.notEqual(normalized[0].id, normalized[1].id);
  const parsed = parseJobSnapshot({ ...snapshot(), jobs: normalized.map(toPublicJob) });
  assert.equal(parsed.jobs.length, 2);
  assert.ok(parsed.jobs[0].description.endsWith('Required: TypeScript and React.'));
  assert.ok(parsed.jobs[0].description.length > 6000);
});

test('old snapshot listings remain real records and clearly warn that they may have closed', () => {
  const result = searchJobSnapshot(snapshot(), profile, preferences, feedTime + 49 * 60 * 60 * 1000);
  assert.equal(result.jobs.length, 1);
  assert.ok(result.sources.every(source => source.status === 'error'));
  assert.ok(result.sources.every(source => source.message.includes('more than 48 hours')));
  assert.ok(result.sources.every(source => source.message.includes(feedDate)));
  assert.equal(result.searchedAt, feedDate);
});

test('provider refresh preserves failed-source records and the actual original update date', async () => {
  const refreshedAt = feedTime + 7 * 60 * 60 * 1000;
  const result = await refreshSnapshot(snapshot(), { now: () => refreshedAt, fetcher: async url => {
    if (url.includes('remotive')) throw new Error('Network failure with private diagnostics');
    return responseFor(url);
  } });
  const remotive = result.sources.find(source => source.name === 'Remotive')!;
  assert.equal(remotive.status, 'error');
  assert.equal(remotive.updatedAt, feedDate);
  assert.equal(remotive.lastAttemptAt, new Date(refreshedAt).toISOString());
  assert.equal(remotive.count, 3);
  assert.equal(result.jobs.filter(job => job.source === 'Remotive').length, 3);
  assert.match(remotive.message, /retained/);
  assert.ok(!JSON.stringify(result).includes('private diagnostics'));
  const localResults = searchJobSnapshot(result, profile, preferences, refreshedAt);
  assert.equal(localResults.jobs.length, 1);
});

test('Remotive successful and failed polling timestamps survive separate refresh invocations', async () => {
  let calls: string[] = [];
  const first = await refreshSnapshot(null, { now: () => feedTime, fetcher: async url => { calls.push(url); return responseFor(url); } });
  assert.equal(calls.length, 2);
  calls = [];
  const second = await refreshSnapshot(first, { now: () => feedTime + 1000, fetcher: async url => { calls.push(url); return responseFor(url); } });
  assert.equal(calls.length, 0);
  assert.equal(second.searchedAt, first.searchedAt);
  calls = [];
  const third = await refreshSnapshot(second, { now: () => feedTime + 60 * 60 * 1000, fetcher: async url => { calls.push(url); return responseFor(url); } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('arbeitnow'));
  const failed = await refreshSnapshot(third, { now: () => feedTime + 7 * 60 * 60 * 1000, fetcher: async () => { throw new Error('unavailable'); } });
  calls = [];
  await refreshSnapshot(failed, { now: () => feedTime + 8 * 60 * 60 * 1000, fetcher: async url => { calls.push(url); return responseFor(url); } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('arbeitnow'));
  const remotive = failed.sources.find(source => source.name === 'Remotive')!;
  assert.equal(remotive.updatedAt, feedDate);
  assert.equal(remotive.lastAttemptAt, new Date(feedTime + 7 * 60 * 60 * 1000).toISOString());
});

test('first-time failure publishes no empty/demo feed and invalid prior files remain unchanged', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jobhunter-public-feed-'));
  const file = path.join(directory, 'jobs.json');
  try {
    const fetcher = async () => { throw new Error('provider unavailable'); };
    await assert.rejects(saveJobSnapshot(file, { fetcher, now: () => feedTime }), /No job provider/);
    await assert.rejects(stat(file), { code: 'ENOENT' });
    const invalidContents = '{"jobs":"invalid"}';
    await writeFile(file, invalidContents);
    await assert.rejects(saveJobSnapshot(file, { fetcher, now: () => feedTime }), /left unchanged/);
    assert.equal(await readFile(file, 'utf8'), invalidContents);
    await writeFile(file, JSON.stringify(snapshot()));
    const previous = await saveJobSnapshot(file, { fetcher, now: () => feedTime + 7 * 60 * 60 * 1000 });
    assert.equal(previous.jobs.length, 4);
    assert.ok(previous.sources.every(source => source.status === 'error'));
    assert.equal(parseJobSnapshot(JSON.parse(await readFile(file, 'utf8'))).jobs.length, 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('bounded feed reader cancels oversized streams before JSON parsing', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedJson(new Response(stream), 5), /too large/);
  assert.equal(cancelled, true);
  await assert.rejects(readBoundedJson(new Response('{}', { headers: { 'Content-Length': '999' } }), 5), /too large/);
});

test('static missing dataset and cancelled requests never silently use sample data', async () => {
  const search = createStaticJobSearcher({ baseUrl: '/jobhunter', fetcher: async () => new Response('Missing', { status: 404 }) });
  await assert.rejects(search(profile, preferences), /HTTP 404/);
  let requested = false;
  const cancelledSearch = createStaticJobSearcher({ fetcher: async () => { requested = true; return new Response(JSON.stringify(snapshot())); } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cancelledSearch(profile, preferences, controller.signal), { name: 'AbortError' });
  assert.equal(requested, false);
});
