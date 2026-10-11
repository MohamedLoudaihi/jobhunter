import { parseJobSnapshot, readBoundedJson, searchJobSnapshot } from '../shared/jobs.js';
import type { StaticSearchResult } from '../shared/jobs.js';
import type { Preferences, ResumeProfile } from '../shared/types.js';

interface StaticSearcherOptions {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  baseUrl?: string;
  now?: () => number;
}

export function createStaticJobSearcher(options: StaticSearcherOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.baseUrl ?? import.meta.env?.BASE_URL ?? '/';
  return async function search(profile: ResumeProfile, preferences: Preferences, signal?: AbortSignal): Promise<StaticSearchResult> {
    // A static GET downloads public listings. Candidate information stays in this browser.
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
    requestSignal.throwIfAborted();
    const response = await fetcher(`${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}jobs.json`, { method: 'GET', cache: 'no-cache', credentials: 'same-origin', signal: requestSignal });
    if (!response.ok) throw new Error(`Job listings could not be loaded (HTTP ${response.status}). Please retry after the feed refresh.`);
    const snapshot = parseJobSnapshot(await readBoundedJson(response));
    return searchJobSnapshot(snapshot, profile, preferences, (options.now ?? Date.now)());
  };
}

export const staticSearchJobs = createStaticJobSearcher();
