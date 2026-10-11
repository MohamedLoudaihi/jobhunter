import { rankJob } from '../shared/career.js';
import { normalizeCountry, matchesPreferences, normalizeArbeitnow, normalizeRemotive, normalizeAdzuna } from '../shared/jobs.js';
export { normalizeCountry, countriesFromLocation, matchesPreferences, cleanDescription, safeExternalUrl } from '../shared/jobs.js';
import type { Job, Preferences, ResumeProfile, SearchResult, SourceStatus } from '../shared/types.js';

const CACHE_TTL = 15 * 60 * 1000;
const REMOTIVE_CACHE_TTL = 6 * 60 * 60 * 1000;
const ERROR_BACKOFF = 60_000;
const FETCH_TIMEOUT = 12_000;
const MAX_PROVIDER_BYTES = 12 * 1024 * 1024;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
interface SearcherOptions { fetcher?: Fetcher; env?: Record<string, string | undefined>; now?: () => number; }
interface CacheEntry { fetchedAt: number; jobs: Job[]; }
const ADZUNA_COUNTRIES = new Set('at au be br ca ch de es fr gb in it mx nl nz pl sg us za'.split(' '));

export function createJobSearcher(options: SearcherOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const failures = new Map<string, number>();
  const pending = new Map<string, Promise<Job[]>>();
  async function getJobs(cacheKey: string, url: string, convert: (body: unknown) => Job[], ttl: number): Promise<Job[]> {
    const saved = cache.get(cacheKey);
    if (saved && now() - saved.fetchedAt < ttl) return saved.jobs;
    const failedAt = failures.get(cacheKey);
    if (failedAt !== undefined && now() - failedAt < ERROR_BACKOFF) throw new Error('Source retry backoff');
    const existing = pending.get(cacheKey);
    if (existing) return existing;
    const request = (async () => {
      const response = await fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': 'JobHunter/0.1 (personal job search)' }, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (Number(response.headers.get('content-length')) > MAX_PROVIDER_BYTES) throw new Error('Response too large');
      if (!response.body) throw new Error('Empty response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_PROVIDER_BYTES) throw new Error('Response too large');
          chunks.push(value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      const jobs = convert(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (cache.size >= 100 && !cache.has(cacheKey)) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { jobs, fetchedAt: now() });
      failures.delete(cacheKey);
      return jobs;
    })();
    pending.set(cacheKey, request);
    try { return await request; } catch (error) { failures.set(cacheKey, now()); throw error; } finally { pending.delete(cacheKey); }
  }
  return async function searchJobs(profile: ResumeProfile, preferences: Preferences): Promise<SearchResult> {
    const sources: SourceStatus[] = [];
    const tasks: Promise<Job[]>[] = [];
    function source(name: string, key: string, url: string, convert: (body: unknown) => Job[], attribution: string, ttl = CACHE_TTL) {
      tasks.push(getJobs(key, url, convert, ttl).then(jobs => {
        sources.push({ name, status: 'ok', count: jobs.length, message: attribution });
        return jobs;
      }).catch(error => {
        const status = error instanceof Error && /^HTTP \d+$/.test(error.message) ? ` (${error.message})` : '';
        sources.push({ name, status: 'error', count: 0, message: `Could not reach ${name}${status}. Check network access and retry. No listings from this source were added.` });
        return [];
      }));
    }
    source('Arbeitnow', 'arbeitnow', 'https://www.arbeitnow.com/api/job-board-api', normalizeArbeitnow, 'Listings provided by Arbeitnow. This search covers the current public feed, not every job site.');
    source('Remotive', 'remotive', 'https://remotive.com/api/remote-jobs', normalizeRemotive, 'Listings provided by Remotive. Jobs may be delayed in the public feed; visit the original listing to apply.', REMOTIVE_CACHE_TTL);
    const selectedCountry = normalizeCountry(preferences.country)?.toLowerCase();
    if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY && selectedCountry && ADZUNA_COUNTRIES.has(selectedCountry)) {
      const url = new URL(`https://api.adzuna.com/v1/api/jobs/${selectedCountry}/search/1`);
      url.searchParams.set('app_id', env.ADZUNA_APP_ID);
      url.searchParams.set('app_key', env.ADZUNA_APP_KEY);
      url.searchParams.set('results_per_page', '50');
      url.searchParams.set('what', preferences.query.trim() || profile.skills.slice(0, 2).join(' '));
      source('Adzuna', `adzuna-${selectedCountry}-${preferences.query}-${profile.skills.slice(0, 2).join(' ')}`, url.toString(), body => normalizeAdzuna(body, selectedCountry), 'Listings provided by Adzuna. Visit the original listing for current details.');
    }
    const fetched = (await Promise.all(tasks)).flat();
    const seen = new Set<string>();
    const jobs = fetched.filter(job => {
      if (seen.has(job.url) || !matchesPreferences(job, preferences)) return false;
      seen.add(job.url);
      return true;
    }).map(job => rankJob(profile, job)).sort((a, b) => b.score - a.score || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).slice(0, 80);
    return { jobs, sources: sources.sort((a, b) => a.name.localeCompare(b.name)), searchedAt: new Date(now()).toISOString(), totalFetched: fetched.length };
  };
}

export const searchJobs = createJobSearcher();
