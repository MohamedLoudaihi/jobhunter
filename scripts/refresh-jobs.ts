import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_FEED_BYTES, normalizeArbeitnow, normalizeRemotive, parseJobSnapshot, readBoundedJson, toPublicJob } from '../shared/jobs.js';
import type { JobSnapshot, PublicJob, SnapshotSourceStatus } from '../shared/jobs.js';

const PROVIDERS = [
  { name: 'Arbeitnow', url: 'https://www.arbeitnow.com/api/job-board-api', normalize: normalizeArbeitnow, minimumInterval: 15 * 60 * 1000, attribution: 'Listings provided by Arbeitnow. This snapshot covers the public feed, not every job site.' },
  { name: 'Remotive', url: 'https://remotive.com/api/remote-jobs', normalize: normalizeRemotive, minimumInterval: 6 * 60 * 60 * 1000, attribution: 'Listings provided by Remotive. Its public API delays listings by 24 hours; visit the original listing to apply.' },
] as const;
interface RefreshOptions {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
}

/** CI must restore its prior public snapshot so polling timestamps survive each run. */
export async function refreshSnapshot(previous: JobSnapshot | null, options: RefreshOptions = {}): Promise<JobSnapshot> {
  const now = (options.now ?? Date.now)();
  const attemptedAt = new Date(now).toISOString();
  const fetcher = options.fetcher ?? fetch;
  const results = await Promise.all(PROVIDERS.map(async provider => {
    const previousSource = previous?.sources.find(source => source.name === provider.name);
    const previousJobs = previous?.jobs.filter(job => job.source === provider.name) ?? [];
    if (previousSource?.lastAttemptAt && now - Date.parse(previousSource.lastAttemptAt) < provider.minimumInterval) {
      return { jobs: previousJobs, source: { ...previousSource, count: previousJobs.length } };
    }
    try {
      const response = await fetcher(provider.url, { headers: { Accept: 'application/json', 'User-Agent': 'JobHunter/0.1 (public feed snapshot)' }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const jobs = provider.normalize(await readBoundedJson(response)).slice(0, 500).map(toPublicJob);
      return { jobs, source: { name: provider.name, status: 'ok' as const, count: jobs.length, message: provider.attribution, updatedAt: attemptedAt, lastAttemptAt: attemptedAt } };
    } catch {
      const source: SnapshotSourceStatus = {
        name: provider.name, status: 'error', count: previousJobs.length, updatedAt: previousSource?.updatedAt ?? null, lastAttemptAt: attemptedAt,
        message: `${provider.attribution} The latest refresh failed.${previousJobs.length ? ' Previous listings were retained and may have closed.' : ' No listings from this source are available.'}`,
      };
      return { jobs: previousJobs, source };
    }
  }));
  if (!previous && results.every(result => result.source.status === 'error')) throw new Error('No job provider could be reached. No empty or sample feed was published.');
  const seen = new Set<string>();
  const jobs: PublicJob[] = results.flatMap(result => result.jobs).filter(job => {
    if (seen.has(job.url)) return false;
    seen.add(job.url);
    return true;
  });
  const sources = results.map(result => ({ ...result.source, count: jobs.filter(job => job.source === result.source.name).length }));
  const attemptDates = sources.map(source => source.lastAttemptAt).filter((value): value is string => value !== null).sort();
  const snapshot: JobSnapshot = { version: 1, jobs, sources, searchedAt: attemptDates.at(-1) ?? previous?.searchedAt ?? attemptedAt, totalFetched: jobs.length };
  return parseJobSnapshot(snapshot);
}

export async function saveJobSnapshot(outputPath: string, options: RefreshOptions = {}): Promise<JobSnapshot> {
  let previous: JobSnapshot | null = null;
  try {
    const raw = await readFile(outputPath);
    if (raw.byteLength > MAX_FEED_BYTES) throw new Error('Existing snapshot too large');
    previous = parseJobSnapshot(JSON.parse(raw.toString('utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('The existing job snapshot is invalid; it was left unchanged.');
  }
  const snapshot = await refreshSnapshot(previous, options);
  const contents = JSON.stringify(snapshot);
  if (Buffer.byteLength(contents) > MAX_FEED_BYTES) throw new Error('The job snapshot exceeds the size limit; the previous file was left unchanged.');
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${contents}\n`, { mode: 0o644 });
  await rename(temporary, outputPath);
  return snapshot;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outputPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/jobs.json');
    const snapshot = await saveJobSnapshot(outputPath);
    for (const source of snapshot.sources) console.log(`${source.name}: ${source.status}, ${source.count} public listings, updated ${source.updatedAt ?? 'never'}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'The public job feed could not be refreshed.');
    process.exitCode = 1;
  }
}
