import { rankJob } from './career.js';
import type { Job, Preferences, ResumeProfile, SearchResult, SourceStatus } from './types.js';

const ISO_COUNTRIES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');
const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const aliases = new Map<string, string>(ISO_COUNTRIES.flatMap(code => [[code.toLowerCase(), code], [COUNTRY_NAMES.of(code)!.toLowerCase(), code]]));
for (const [name, code] of Object.entries({ uk: 'GB', britain: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', america: 'US', 'united states of america': 'US', korea: 'KR', 'south korea': 'KR', czechia: 'CZ', 'czech republic': 'CZ', uae: 'AE' })) aliases.set(name, code);
const EUROPE = 'AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB VA'.split(' ');
const EU = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ');
const cityCountries: Record<string, string> = {
  berlin: 'DE', hamburg: 'DE', munich: 'DE', münchen: 'DE', frankfurt: 'DE', cologne: 'DE', köln: 'DE', stuttgart: 'DE', düsseldorf: 'DE', dusseldorf: 'DE', leipzig: 'DE', dresden: 'DE', bonn: 'DE', nuremberg: 'DE', nürnberg: 'DE',
  paris: 'FR', lyon: 'FR', marseille: 'FR', toulouse: 'FR', nantes: 'FR', bordeaux: 'FR', london: 'GB', manchester: 'GB', edinburgh: 'GB', bristol: 'GB',
  tokyo: 'JP', osaka: 'JP', kyoto: 'JP', yokohama: 'JP', casablanca: 'MA', rabat: 'MA', marrakech: 'MA', tangier: 'MA', fes: 'MA',
  amsterdam: 'NL', rotterdam: 'NL', madrid: 'ES', barcelona: 'ES', lisbon: 'PT', dublin: 'IE', stockholm: 'SE', copenhagen: 'DK', vienna: 'AT', zurich: 'CH', zürich: 'CH',
  'new york': 'US', 'san francisco': 'US', 'los angeles': 'US', boston: 'US', seattle: 'US', austin: 'US', chicago: 'US', washington: 'US', toronto: 'CA', vancouver: 'CA', montreal: 'CA', sydney: 'AU', melbourne: 'AU', auckland: 'NZ', singapore: 'SG', dubai: 'AE', bangalore: 'IN', bengaluru: 'IN', mumbai: 'IN', delhi: 'IN',
};

export function normalizeCountry(country: string): string | null {
  const value = country.trim().toLowerCase();
  if (!value || ['any', 'all', 'worldwide', 'anywhere'].includes(value)) return null;
  return aliases.get(value) ?? null;
}

function boundaryMatch(text: string, word: string): boolean {
  return new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(text);
}

/** Countries describe published location eligibility, not citizenship or visa support. */
export function countriesFromLocation(location: string): string[] {
  const lowered = location.toLowerCase();
  const exclusion = lowered.split(/\b(?:except|excluding|but not|not including|not eligible in|not available in|not open to|not|no|but)\b/);
  if (exclusion.length > 1) {
    const allowed = countriesFromLocation(exclusion[0]);
    const excluded = countriesFromLocation(exclusion.slice(1).join(', '));
    // An unknown exception cannot safely establish country eligibility.
    if (!excluded.length) return [];
    return (allowed.includes('WORLDWIDE') ? ISO_COUNTRIES : allowed).filter(country => !excluded.includes(country));
  }
  const globalLabel = lowered.replace(/[(),/—–-]/g, ' ').replace(/\bremote\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (['worldwide', 'anywhere', 'global', 'anywhere in the world', 'worldwide anywhere', 'anywhere worldwide'].includes(globalLabel)) return ['WORLDWIDE'];
  // A global word plus extra location or working-hour requirements does not establish global eligibility.
  if (/\b(?:time\s?zones?|working\s+hours?|utc|gmt)\b/.test(lowered)) return [];
  const countries = new Set<string>();
  if (/\beurope\b|\beuropean countries\b/.test(lowered)) EUROPE.forEach(country => countries.add(country));
  if (/\beuropean union\b|\beu\b/.test(lowered)) EU.forEach(country => countries.add(country));
  if (/\bnorth america\b/.test(lowered)) ['US', 'CA', 'MX'].forEach(country => countries.add(country));
  if (/\bemea\b/.test(lowered)) [...EUROPE, ...'AE BH DZ EG IL IQ IR JO KW LB LY MA OM PS QA SA SY TN TR YE ZA NG KE GH TZ UG ET SN CI CM AO ZM ZW NA BW MZ MG MU'.split(' ')].forEach(country => countries.add(country));
  for (const [name, code] of aliases) {
    // Lowercase two-letter words such as "in" are not reliable country names.
    const shortCode = name.length === 2 && (location.trim().toUpperCase() === name.toUpperCase() || new RegExp(`(^|[,;/()])\\s*${name.toUpperCase()}\\s*([,;/()]|$)`).test(location) || ['us', 'uk', 'gb'].includes(name) && boundaryMatch(lowered, name));
    if (name.length === 2 ? shortCode : boundaryMatch(lowered, name)) countries.add(code);
  }
  if (countries.size === 0) for (const [city, code] of Object.entries(cityCountries)) if (boundaryMatch(lowered, city)) countries.add(code);
  return [...countries];
}

export function cleanDescription(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/g, entity => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' })[entity]!)
    .replace(/&#(\d+);/g, (_, code: string) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : '')
    .replace(/\n\s*\n\s*\n/g, '\n\n').trim().slice(0, 35_000);
}

export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

function string(value: unknown): string { return typeof value === 'string' ? value.slice(0, 1000) : ''; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, 50).map(entry => entry.slice(0, 100)) : []; }
function employment(value: string): string {
  const text = value.toLowerCase().replace(/_/g, '-');
  if (/full[- ]?time|permanent/.test(text)) return 'full-time';
  if (/part[- ]?time/.test(text)) return 'part-time';
  if (/contract|freelance/.test(text)) return 'contract';
  if (/intern/.test(text)) return 'internship';
  return text || 'unspecified';
}
function date(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}
function baseJob(job: Partial<Job> & Pick<Job, 'id' | 'title' | 'url'>): Job {
  return { company: '', location: '', countries: [], remote: false, employmentType: 'unspecified', description: '', source: '', publishedAt: null, salary: null, tags: [], score: 0, matchedSkills: [], missingSkills: [], matchExplanation: '', ...job };
}

export function matchesPreferences(job: Job, preferences: Preferences): boolean {
  const country = normalizeCountry(preferences.country);
  if (!country && !['', 'any', 'all', 'worldwide', 'anywhere'].includes(preferences.country.trim().toLowerCase())) return false;
  if (country && !job.countries.includes(country) && !job.countries.includes('WORLDWIDE')) return false;
  const text = `${job.title} ${job.description} ${job.tags.join(' ')}`.toLowerCase();
  if (preferences.query.trim() && !preferences.query.trim().toLowerCase().split(/\s+/).every(term => text.includes(term))) return false;
  const hybrid = /\bhybrid\b/.test(text);
  if (preferences.workMode === 'remote' && !job.remote) return false;
  if (preferences.workMode === 'hybrid' && !hybrid) return false;
  if (preferences.workMode === 'onsite' && (job.remote || hybrid)) return false;
  if (preferences.employmentType !== 'any' && job.employmentType !== preferences.employmentType) return false;
  if (preferences.experienceLevel !== 'any') {
    const senior = /\b(senior|lead|principal|staff|head|director)\b/.test(job.title.toLowerCase());
    const entry = /\b(junior|entry|intern|graduate|trainee|apprentice)\b/.test(job.title.toLowerCase());
    const mid = /\b(mid|intermediate|medior)\b/.test(job.title.toLowerCase()) || /\b[3-5]\+?\s*years?\b/.test(text);
    if (preferences.experienceLevel === 'senior' && !senior) return false;
    if (preferences.experienceLevel === 'entry' && !entry) return false;
    if (preferences.experienceLevel === 'mid' && (senior || entry || !mid)) return false;
  }
  return true;
}


export function normalizeArbeitnow(body: unknown): Job[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) throw new Error('Invalid response');
  return ((body as { data: Record<string, unknown>[] }).data).slice(0, 2000).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const url = safeExternalUrl(item.url);
    if (!url || !string(item.title)) return [];
    const location = string(item.location);
    return [baseJob({ id: `arbeitnow-${string(item.slug) || url}`, title: string(item.title), company: string(item.company_name), location, countries: countriesFromLocation(location), remote: item.remote === true, employmentType: employment(strings(item.job_types).join(' ')), description: cleanDescription(item.description), tags: strings(item.tags), url, source: 'Arbeitnow', publishedAt: date(item.created_at) })];
  });
}

export function normalizeRemotive(body: unknown): Job[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { jobs?: unknown }).jobs)) throw new Error('Invalid response');
  return ((body as { jobs: Record<string, unknown>[] }).jobs).slice(0, 2000).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const url = safeExternalUrl(item.url);
    if (!url || !string(item.title)) return [];
    const location = string(item.candidate_required_location);
    return [baseJob({ id: `remotive-${typeof item.id === 'number' ? item.id : string(item.id) || url}`, title: string(item.title), company: string(item.company_name), location: location || 'Location not specified', countries: countriesFromLocation(location), remote: true, employmentType: employment(string(item.job_type)), description: cleanDescription(item.description), tags: [...strings(item.tags), string(item.category)].filter(Boolean), url, source: 'Remotive', salary: string(item.salary) || null, publishedAt: date(item.publication_date) })];
  });
}

export function normalizeAdzuna(body: unknown, selectedCountry: string): Job[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { results?: unknown }).results)) throw new Error('Invalid response');
  return ((body as { results: Record<string, unknown>[] }).results).slice(0, 2000).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const jobUrl = safeExternalUrl(item.redirect_url);
    if (!jobUrl || !string(item.title)) return [];
    const company = item.company as { display_name?: unknown } | undefined;
    const location = item.location as { display_name?: unknown } | undefined;
    const category = item.category as { label?: unknown } | undefined;
    const salary = typeof item.salary_min === 'number' && typeof item.salary_max === 'number' ? `${item.salary_min.toLocaleString('en-US')}–${item.salary_max.toLocaleString('en-US')} (currency shown on listing)` : null;
    return [baseJob({ id: `adzuna-${typeof item.id === 'number' ? item.id : string(item.id) || jobUrl}`, title: cleanDescription(item.title), company: string(company?.display_name), location: string(location?.display_name), countries: [selectedCountry.toUpperCase()], remote: /\bremote\b/i.test(`${string(item.title)} ${string(item.description)}`), employmentType: employment(`${string(item.contract_time)} ${string(item.contract_type)}`), description: cleanDescription(item.description), url: jobUrl, tags: [string(category?.label)].filter(Boolean), source: 'Adzuna', salary, publishedAt: date(item.created) })];
  });
}

export const MAX_SNAPSHOT_JOBS = 1000;
export const MAX_FEED_BYTES = 12 * 1024 * 1024;
export const PUBLIC_SOURCES = ['Arbeitnow', 'Remotive'] as const;
export type PublicJob = Omit<Job, 'score' | 'matchedSkills' | 'missingSkills' | 'matchExplanation'>;
export interface SnapshotSourceStatus extends SourceStatus {
  updatedAt: string | null;
  lastAttemptAt: string | null;
}
export interface JobSnapshot {
  version: 1;
  jobs: PublicJob[];
  sources: SnapshotSourceStatus[];
  searchedAt: string;
  totalFetched: number;
}

/** A public feed never includes a candidate profile or profile-derived match fields. */
export function toPublicJob(job: Job): PublicJob {
  return {
    id: job.id.slice(0, 1200), title: job.title.slice(0, 1000), company: job.company.slice(0, 1000),
    location: job.location.slice(0, 1000), countries: job.countries.slice(0, 250), remote: job.remote,
    employmentType: job.employmentType.slice(0, 100), description: job.description.slice(0, 35_000),
    url: job.url, source: job.source, publishedAt: job.publishedAt, salary: job.salary?.slice(0, 1000) ?? null,
    tags: job.tags.slice(0, 50).map(tag => tag.slice(0, 100)),
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function boundedString(value: unknown, maximum: number): value is string { return typeof value === 'string' && value.length <= maximum; }
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
}

/** Validate public data before it reaches filtering/ranking, and drop invalid links. */
export function parseJobSnapshot(value: unknown): JobSnapshot {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.jobs) || value.jobs.length > MAX_SNAPSHOT_JOBS || !Array.isArray(value.sources) || value.sources.length > 2 || !timestamp(value.searchedAt) || !Number.isInteger(value.totalFetched) || (value.totalFetched as number) < 0 || (value.totalFetched as number) > 10_000) throw new Error('Job listings data is invalid. Please retry after the next feed update.');
  const sources: SnapshotSourceStatus[] = [];
  for (const source of value.sources) {
    if (!object(source) || !PUBLIC_SOURCES.includes(source.name as typeof PUBLIC_SOURCES[number]) || !['ok', 'error'].includes(source.status as string) || !Number.isInteger(source.count) || (source.count as number) < 0 || (source.count as number) > MAX_SNAPSHOT_JOBS || !boundedString(source.message, 2000) || !(source.updatedAt === null || timestamp(source.updatedAt)) || !(source.lastAttemptAt === null || timestamp(source.lastAttemptAt)) || source.status === 'ok' && source.updatedAt === null || sources.some(saved => saved.name === source.name)) throw new Error('Job source metadata is invalid. Please retry after the next feed update.');
    sources.push({ name: source.name as string, status: source.status as 'ok' | 'error', count: source.count as number, message: source.message, updatedAt: source.updatedAt as string | null, lastAttemptAt: source.lastAttemptAt as string | null });
  }
  const jobs: PublicJob[] = [];
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  for (const candidate of value.jobs) {
    if (!object(candidate) || !boundedString(candidate.id, 1200) || !boundedString(candidate.title, 1000) || !candidate.title.trim() || !boundedString(candidate.company, 1000) || !boundedString(candidate.location, 1000) || !Array.isArray(candidate.countries) || candidate.countries.length > 250 || !candidate.countries.every(code => typeof code === 'string' && (ISO_COUNTRIES.includes(code) || code === 'WORLDWIDE')) || typeof candidate.remote !== 'boolean' || !boundedString(candidate.employmentType, 100) || !boundedString(candidate.description, 35_000) || !boundedString(candidate.url, 4000) || !sources.some(source => source.name === candidate.source) || !(candidate.publishedAt === null || timestamp(candidate.publishedAt)) || !(candidate.salary === null || boundedString(candidate.salary, 1000)) || !Array.isArray(candidate.tags) || candidate.tags.length > 50 || !candidate.tags.every(tag => boundedString(tag, 100))) throw new Error('A job listing has invalid data. Please retry after the next feed update.');
    const url = safeExternalUrl(candidate.url);
    if (!url || seen.has(url) || seenIds.has(candidate.id)) continue;
    seen.add(url);
    seenIds.add(candidate.id);
    jobs.push(toPublicJob(baseJob({
      id: candidate.id, title: candidate.title, company: candidate.company, location: candidate.location,
      countries: candidate.countries as string[], remote: candidate.remote, employmentType: candidate.employmentType,
      description: cleanDescription(candidate.description), url, source: candidate.source as string,
      publishedAt: candidate.publishedAt as string | null, salary: candidate.salary as string | null, tags: candidate.tags as string[],
    })));
  }
  return { version: 1, jobs, sources: sources.map(source => ({ ...source, count: jobs.filter(job => job.source === source.name).length })), searchedAt: value.searchedAt, totalFetched: value.totalFetched as number };
}

export async function readBoundedJson(response: Response, maximumBytes = MAX_FEED_BYTES): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > maximumBytes || !response.body) throw new Error('The job feed is too large or empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) throw new Error('The job feed is too large.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(data));
}

export function rankEligibleJobs(jobs: Job[], profile: ResumeProfile, preferences: Preferences): Job[] {
  const seen = new Set<string>();
  return jobs.filter(job => {
    if (seen.has(job.url) || !matchesPreferences(job, preferences)) return false;
    seen.add(job.url);
    return true;
  }).map(job => rankJob(profile, job)).sort((a, b) => b.score - a.score || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).slice(0, 80);
}

export interface StaticSearchResult extends SearchResult { updatedAt: string; }
export function searchJobSnapshot(snapshot: JobSnapshot, profile: ResumeProfile, preferences: Preferences, now = Date.now()): StaticSearchResult {
  const sources: SourceStatus[] = snapshot.sources.map(source => {
    const stale = !source.updatedAt || now - Date.parse(source.updatedAt) > 48 * 60 * 60 * 1000;
    return {
      name: source.name, status: stale ? 'error' : source.status, count: source.count,
      message: `${source.message}${source.updatedAt ? ` Feed updated ${source.updatedAt}.` : ' No successful feed update is available.'}${stale ? ' This feed is more than 48 hours old or unavailable. Listings may have closed; check the original listing before applying.' : ''}`,
    };
  });
  const successfulDates = snapshot.sources.map(source => source.updatedAt).filter((value): value is string => value !== null).sort();
  return { jobs: rankEligibleJobs(snapshot.jobs.map(job => baseJob(job)), profile, preferences), sources, searchedAt: snapshot.searchedAt, updatedAt: successfulDates.at(-1) ?? snapshot.searchedAt, totalFetched: snapshot.jobs.length };
}
