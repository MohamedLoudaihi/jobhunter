import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Bookmark, BriefcaseBusiness, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clipboard, Compass, FileText, Globe2, GraduationCap, LoaderCircle, MapPin, Plus, Search, ShieldCheck, Sparkles, Sprout, Trash2, Upload, X } from 'lucide-react';
import type { Application, ApplicationStage, CareerKit, Job, Preferences, ResumeProfile, SearchResult } from '../shared/types';
import { analyzeResume, buildCareerKit, rankJob } from '../shared/career';
import { DEMO_JOBS, SAMPLE_RESUME } from '../shared/demo';
import { COUNTRIES } from './countries';
import { parseResumeLocally } from './resume-browser';
import { staticSearchJobs } from './job-search';

type Page = 'discover' | 'studio' | 'applications';
type DetailTab = 'overview' | 'resume' | 'letter' | 'apply';
const TRACKER_KEY = 'jobhunter.applications.v1';
const STAGES: ApplicationStage[] = ['Saved', 'Applied', 'Interview', 'Offer', 'Closed'];
const DEFAULT_PREFERENCES: Preferences = { country: '', query: '', workMode: 'any', employmentType: 'any', experienceLevel: 'any' };
const STATIC_MODE = import.meta.env.VITE_STATIC_MODE === 'true';

function readApplications(): Application[] {
  try {
    const items = JSON.parse(localStorage.getItem(TRACKER_KEY) ?? '[]');
    return Array.isArray(items) ? items.filter((item): item is Application => {
      const job = item?.job;
      const strings = (values: unknown): values is string[] => Array.isArray(values) && values.every(value => typeof value === 'string');
      return !!job && typeof item.id === 'string' && item.id === job.id && STAGES.includes(item.stage)
        && typeof item.notes === 'string' && typeof item.savedAt === 'string' && Number.isFinite(new Date(item.savedAt).getTime())
        && (item.appliedAt === null || (typeof item.appliedAt === 'string' && Number.isFinite(new Date(item.appliedAt).getTime())))
        && ['id', 'title', 'company', 'location', 'employmentType', 'description', 'url', 'source', 'matchExplanation'].every(key => typeof job[key] === 'string')
        && strings(job.countries) && strings(job.tags) && strings(job.matchedSkills) && strings(job.missingSkills)
        && typeof job.remote === 'boolean' && typeof job.score === 'number' && Number.isFinite(job.score)
        && (job.salary === null || typeof job.salary === 'string') && (job.publishedAt === null || typeof job.publishedAt === 'string');
    }).slice(0, 1000) : [];
  } catch { return []; }
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? `The request failed (${response.status}). Please try again.`);
  if (!data) throw new Error('The server returned an unexpected response. Please try again.');
  return data as T;
}

function initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'J'; }
function niceDate(value: string | null): string { if (!value) return 'Date not supplied'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date not supplied' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
function safeUrl(value: string): boolean { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } }
function downloadText(filename: string, text: string) { const blob = new Blob([text], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }

function Modal({ children, onClose, className, label }: { children: ReactNode; onClose: () => void; className: string; label: string }) {
  const element = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = element.current;
    const focusable = () => Array.from(modal?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex="0"]') ?? []);
    focusable()[0]?.focus();
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key === 'Tab') {
        const items = focusable(); const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className="drawer-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={element} className={className} role="dialog" aria-modal="true" aria-label={label}>{children}</div></div>;
}

function App() {
  const [page, setPage] = useState<Page>('discover');
  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [age, setAge] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [studioText, setStudioText] = useState('');
  const [parseLoading, setParseLoading] = useState(false);
  const [parseError, setParseError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [demo, setDemo] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  const [applications, setApplications] = useState<Application[]>(readApplications);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [letter, setLetter] = useState('');
  const [toast, setToast] = useState('');
  const [storageError, setStorageError] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [stageFilter, setStageFilter] = useState('All stages');
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const kit: CareerKit | null = useMemo(() => profile && selectedJob ? buildCareerKit(profile, selectedJob) : null, [profile, selectedJob]);
  const nextStepsKit: CareerKit | null = useMemo(() => selectedJob ? buildCareerKit(profile ?? { name: '', text: '', skills: [], yearsExperience: null, summary: '', filename: '' }, selectedJob) : null, [profile, selectedJob]);

  useEffect(() => { setLetter(kit?.coverLetter ?? ''); }, [kit]);
  useEffect(() => { setStudioText(profile?.text ?? ''); }, [profile]);
  useEffect(() => { setSelectedJob(current => current && profile ? rankJob(profile, current) : current); }, [profile]);
  useEffect(() => () => uploadAbort.current?.abort(), []);
  useEffect(() => {
    try { localStorage.setItem(TRACKER_KEY, JSON.stringify(applications)); setStorageError(''); }
    catch { setStorageError('Your browser could not save the application tracker. Keep this tab open to retain your changes.'); }
  }, [applications]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3500); return () => window.clearTimeout(timer); }, [toast]);

  useEffect(() => {
    if (!profile) { setResults(null); return; }
    const controller = new AbortController();
    setSearchLoading(true); setSearchError(''); setResults(null);
    const timer = window.setTimeout(async () => {
      if (demo) {
        let jobs = DEMO_JOBS.map(job => rankJob(profile, job));
        if (preferences.country) jobs = jobs.filter(job => job.countries.includes('WORLDWIDE') || job.countries.includes(preferences.country) || /worldwide/i.test(job.location));
        if (preferences.workMode === 'remote') jobs = jobs.filter(job => job.remote);
        if (preferences.workMode === 'onsite') jobs = jobs.filter(job => !job.remote && !/hybrid/i.test(job.description));
        if (preferences.workMode === 'hybrid') jobs = jobs.filter(job => /hybrid/i.test(job.description));
        if (preferences.employmentType !== 'any') jobs = jobs.filter(job => job.employmentType.toLowerCase() === preferences.employmentType);
        if (preferences.experienceLevel === 'entry') jobs = jobs.filter(job => /junior|entry|intern/i.test(job.title + ' ' + job.description));
        if (preferences.experienceLevel === 'senior') jobs = jobs.filter(job => /senior|lead/i.test(job.title + ' ' + job.description));
        if (preferences.experienceLevel === 'mid') jobs = jobs.filter(job => !/junior|entry|intern|senior|lead/i.test(job.title));
        if (preferences.query.trim()) jobs = jobs.filter(job => `${job.title} ${job.description} ${job.tags.join(' ')}`.toLowerCase().includes(preferences.query.trim().toLowerCase()));
        setResults({ jobs: jobs.sort((a, b) => b.score - a.score), sources: [{ name: 'Guided demo', status: 'ok', count: jobs.length, message: 'Fictional example jobs. These are not current vacancies.' }], searchedAt: new Date().toISOString(), totalFetched: DEMO_JOBS.length });
        setSearchLoading(false); return;
      }
      try {
        let data: SearchResult;
        if (STATIC_MODE) {
          data = await staticSearchJobs(profile, preferences, controller.signal);
        } else {
          const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile, preferences }), signal: controller.signal });
          data = await readResponse<SearchResult>(response);
        }
        if (!controller.signal.aborted) { setResults(data); setSearchLoading(false); }
      } catch (error) {
        if (!controller.signal.aborted) { setSearchError(error instanceof Error ? error.message : 'Job search is temporarily unavailable.'); setSearchLoading(false); }
      }
    }, 450);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [profile, preferences, demo, searchRevision]);

  async function parseResume(file?: File, text?: string, filename = 'pasted-resume.txt') {
    if (file && (!/\.(pdf|docx|txt)$/i.test(file.name) || file.size > 5 * 1024 * 1024)) { setParseError('Choose a PDF, DOCX, or TXT file smaller than 5 MB.'); return; }
    if (!file && (!text || text.trim().length < 40)) { setParseError('Paste at least 40 characters of your résumé so we can find useful matches.'); return; }
    uploadAbort.current?.abort();
    const controller = new AbortController(); uploadAbort.current = controller;
    setParseLoading(true); setParseError('');
    try {
      let data: ResumeProfile;
      if (STATIC_MODE) {
        data = await parseResumeLocally(file, text, file?.name || filename, controller.signal);
      } else {
        let body: BodyInit; let headers: HeadersInit | undefined;
        if (file) { const form = new FormData(); form.append('resume', file); body = form; }
        else { body = JSON.stringify({ text, filename }); headers = { 'Content-Type': 'application/json' }; }
        const response = await fetch('/api/resume', { method: 'POST', body, headers, signal: controller.signal });
        data = await readResponse<ResumeProfile>(response);
      }
      if (!controller.signal.aborted) { setProfile(data); setDemo(false); setPasteOpen(false); setPage('discover'); }
    } catch (error) { if (!controller.signal.aborted) setParseError(error instanceof Error ? error.message : 'We could not read this résumé. Try pasting its text.'); }
    finally { if (!controller.signal.aborted) setParseLoading(false); }
  }

  function startDemo() {
    uploadAbort.current?.abort(); setParseLoading(false); setParseError('');
    setPreferences(DEFAULT_PREFERENCES); setProfile(analyzeResume(SAMPLE_RESUME, 'sample-resume.txt')); setDemo(true); setPage('discover');
  }
  function resetProfile() { uploadAbort.current?.abort(); setProfile(null); setResults(null); setDemo(false); setParseLoading(false); setSearchLoading(false); setParseError(''); setSearchError(''); setPasteText(''); setPage('discover'); }
  function updatePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) { setPreferences(previous => ({ ...previous, [key]: value })); }
  function openJob(job: Job, tab: DetailTab = 'overview') { setSelectedJob(profile ? rankJob(profile, job) : job); setDetailTab(tab); }
  function isSaved(id: string): boolean { return applications.some(application => application.id === id); }
  function toggleSaved(job: Job) {
    if (isSaved(job.id)) { setApplications(previous => previous.filter(application => application.id !== job.id)); setToast('Job removed from your tracker.'); }
    else { setApplications(previous => [{ id: job.id, job, stage: 'Saved', savedAt: new Date().toISOString(), appliedAt: null, notes: '' }, ...previous]); setToast('Saved to your application tracker.'); }
  }
  function updateApplication(id: string, patch: Partial<Application>) { setApplications(previous => previous.map(application => application.id === id ? { ...application, ...patch, appliedAt: patch.stage === 'Applied' && !application.appliedAt ? new Date().toISOString() : application.appliedAt } : application)); }
  async function copy(text: string, label = 'Copied to clipboard') { try { await navigator.clipboard.writeText(text); setToast(label); } catch { setToast('Clipboard unavailable. Select the text and copy it manually.'); } }

  const pageNames: Record<Page, string> = { discover: 'Discover jobs', studio: 'Résumé studio', applications: 'Applications' };
  const activeApplications = applications.filter(application => application.stage !== 'Closed');
  const shownApplications = applications.filter(application => stageFilter === 'All stages' || application.stage === stageFilter);
  const allFeedsFailed = !!results && results.sources.length > 0 && results.sources.every(source => source.status === 'error');
  const noListingsAvailable = !!results && results.totalFetched === 0;
  const listingsStale = STATIC_MODE && !demo && !!results && Date.now() - new Date(results.searchedAt).getTime() > 48 * 60 * 60 * 1000;

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Main navigation">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('discover'); }}><span className="brand-mark"><Sprout size={24} strokeWidth={2.2} /></span><span className="brand-name">jobhunter<span className="brand-dot">.</span></span></a>
      <div className="nav-group-label">YOUR WORKSPACE</div>
      <nav className="sidebar-nav">
        <button className={`nav-item ${page === 'discover' ? 'active' : ''}`} onClick={() => setPage('discover')} aria-current={page === 'discover' ? 'page' : undefined}><Compass size={19} /><span>Discover jobs</span><ChevronRight size={15} /></button>
        <button className={`nav-item ${page === 'studio' ? 'active' : ''}`} onClick={() => setPage('studio')} aria-current={page === 'studio' ? 'page' : undefined}><FileText size={19} /><span>Résumé studio</span></button>
        <button className={`nav-item ${page === 'applications' ? 'active' : ''}`} onClick={() => setPage('applications')} aria-current={page === 'applications' ? 'page' : undefined}><BriefcaseBusiness size={19} /><span>Applications</span>{applications.length > 0 && <span className="nav-badge">{applications.length}</span>}</button>
      </nav>
      <div className="sidebar-guide"><span className="sidebar-guide-icon"><Sparkles size={20} /></span><h3>A little direction.<br />A big next step.</h3><p>From your first search to your follow-up. Your next chapter, all in one place.</p><button onClick={() => { setPage('discover'); if (!profile) setPasteOpen(true); }}>Start with your résumé <ArrowUpRight size={16} /></button></div>
      <div className="sidebar-bottom"><div className="sidebar-status"><span />Made for your next move</div><p>Thoughtful tools. Human decisions.</p></div>
    </aside>

    <main className="workspace">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={13} className="breadcrumb-separator" /><strong>{pageNames[page]}</strong></div><div className="topbar-right"><span className="privacy-note"><ShieldCheck size={15} /> {STATIC_MODE ? 'Your résumé stays in your browser.' : 'Résumé kept in this session'}</span><span className="avatar" title={profile?.name || 'Your workspace'}>{profile?.name ? initials(profile.name) : <span>Y</span>}</span></div></header>
      <div className="workspace-content">
        {storageError && <div className="notice-banner" role="status">{storageError}</div>}
        {page === 'discover' && <>
          <section className="hero">
            <div className="hero-copy"><div className="eyebrow"><span /> YOUR NEXT CHAPTER STARTS HERE</div><h1>Find work that<br /><span>feels like you.</span></h1><p className="hero-description">Your experience has a story. Let’s find its next chapter.<br className="desktop-break" /> Discover the right roles, put your best self forward, and keep moving.</p></div>
            <div className="hero-aside"><div className="hero-note-icon"><Sparkles size={25} /></div><h3>A smarter way<br />to make your next move.</h3><div className="hero-mini-steps"><div className="mini-step"><span>01</span> Share your experience</div><div className="mini-step"><span>02</span> Find your fit</div><div className="mini-step"><span>03</span> Apply with confidence</div></div><button className="hero-demo-button" onClick={startDemo}>Explore a guided demo <ArrowUpRight size={14} /></button></div>
          </section>

          {demo && <div className="demo-banner"><div><strong><Sparkles size={16} /> You’re exploring the guided demo</strong><p>Sample résumé and fictional job listings. These are not current vacancies.</p></div><button className="secondary-button" onClick={resetProfile}>Use my own résumé <ArrowRight size={15} /></button></div>}

          <section className="onboarding-grid" aria-label="Your job search setup">
            <div className="panel resume-card">
              <div className="section-heading"><span className="section-icon"><FileText size={20} /></span><div className="section-title"><h2>Your experience, the starting point</h2><p>We’ll use your résumé to find relevant opportunities.</p></div><span className="step-number">01</span></div>
              {profile ? <div className="profile-strip"><span className="profile-avatar">{initials(profile.name || 'Your resume')}</span><div className="profile-info"><span className="profile-ready"><CheckCheck size={14} /> Résumé ready</span><h3>{profile.name || 'Your résumé'}</h3><p>{profile.filename} · {profile.skills.length} skills detected{profile.yearsExperience !== null ? ` · ${profile.yearsExperience} years of experience` : ''}</p><div className="profile-skills">{profile.skills.slice(0, 5).map(skill => <span key={skill} className="skill-tag">{skill}</span>)}</div><div className="inline-actions"><button className="text-button" onClick={() => setPage('studio')}>Review your profile <ArrowUpRight size={13} /></button><button className="text-button profile-reset" onClick={resetProfile}>Replace résumé</button></div></div></div> : <>
                <div className={`resume-dropzone ${dragOver ? 'drag-over' : ''} ${parseLoading ? 'uploading' : ''}`} onDragOver={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={event => { event.preventDefault(); setDragOver(false); if (!parseLoading && event.dataTransfer.files[0]) void parseResume(event.dataTransfer.files[0]); }}>
                  <span className="dropzone-icon">{parseLoading ? <LoaderCircle className="spinner" size={27} /> : <Upload size={27} />}</span><h3>{parseLoading ? 'Getting to know your experience…' : 'Drop your résumé here'}</h3><p>{parseLoading ? 'Reading your résumé and identifying your skills.' : 'A little about you opens a world of possibility.'}</p><div className="dropzone-actions"><button className="primary-button" disabled={parseLoading} onClick={() => uploadInput.current?.click()}><Plus size={16} /> Choose a file</button></div><span className="file-types">PDF, DOCX, or TXT · up to 5 MB</span>
                  <input ref={uploadInput} className="sr-only" type="file" accept=".pdf,.docx,.txt" aria-label="Upload your résumé" disabled={parseLoading} onChange={event => { const file = event.target.files?.[0]; if (file) void parseResume(file); event.target.value = ''; }} />
                </div>
                <div className="upload-divider"><span>or</span></div><div className="inline-actions"><button className="text-button" disabled={parseLoading} onClick={() => setPasteOpen(value => !value)}><Clipboard size={15} /> Paste résumé text {pasteOpen ? <ChevronDown size={14} /> : <ArrowRight size={14} />}</button><button className="sample-button" disabled={parseLoading} onClick={() => void parseResume(undefined, SAMPLE_RESUME, 'sample-resume.txt')}>Try a sample résumé</button></div>
                {pasteOpen && <form className="paste-area" onSubmit={event => { event.preventDefault(); void parseResume(undefined, pasteText); }}><label className="field-label" htmlFor="resume-text">Your résumé text</label><textarea id="resume-text" className="textarea" value={pasteText} onChange={event => setPasteText(event.target.value)} placeholder="Paste your experience, skills, and education here…" rows={6} required minLength={40} disabled={parseLoading} /><button className="primary-button" disabled={parseLoading}>Find my matches <ArrowRight size={15} /></button></form>}
              </>}
              {parseError && <div className="error-banner" role="alert">{parseError}</div>}
              <p className="resume-privacy"><ShieldCheck size={13} /> {STATIC_MODE ? 'Your résumé stays in your browser and isn’t uploaded or saved to your tracker.' : 'Your résumé is processed for this search and isn’t saved to your tracker.'}</p>
            </div>
            <div className="panel preference-card"><div className="section-heading"><span className="section-icon"><Globe2 size={20} /></span><div className="section-title"><h2>Where do you want to go?</h2><p>Set the direction. We’ll take it from here.</p></div><span className="step-number">02</span></div>
              <div className="field"><label htmlFor="country" className="field-label">Country <span>YOUR NEXT DESTINATION</span></label><div className="input-icon"><MapPin size={17} /><select id="country" className="select" value={preferences.country} onChange={event => updatePreference('country', event.target.value)}><option value="">Any country</option>{COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}</select></div></div>
              <div className="field"><label htmlFor="job-query" className="field-label">Role or keywords <span>OPTIONAL</span></label><div className="input-icon"><Search size={17} /><input id="job-query" className="input" value={preferences.query} onChange={event => updatePreference('query', event.target.value)} placeholder="e.g. Product designer, Python" maxLength={150} /></div></div>
              <div className="filter-grid"><div className="field"><label htmlFor="work-mode" className="field-label">Work style</label><select id="work-mode" className="select" value={preferences.workMode} onChange={event => updatePreference('workMode', event.target.value as Preferences['workMode'])}><option value="any">Any work style</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select></div><div className="field"><label htmlFor="job-type" className="field-label">Job type</label><select id="job-type" className="select" value={preferences.employmentType} onChange={event => updatePreference('employmentType', event.target.value as Preferences['employmentType'])}><option value="any">Any job type</option><option value="full-time">Full-time</option><option value="part-time">Part-time</option><option value="contract">Contract</option><option value="internship">Internship</option></select></div></div>
              <div className="filter-grid"><div className="field"><label htmlFor="experience" className="field-label">Experience level</label><select id="experience" className="select" value={preferences.experienceLevel} onChange={event => updatePreference('experienceLevel', event.target.value as Preferences['experienceLevel'])}><option value="any">Any experience</option><option value="entry">Entry level</option><option value="mid">Mid level</option><option value="senior">Senior level</option></select></div><div className="field"><label htmlFor="age" className="field-label">Your age <span>OPTIONAL</span></label><input id="age" type="number" min="14" max="100" className="input" value={age} onChange={event => setAge(event.target.value)} placeholder="Not specified" /></div></div><p className="age-note">Age is a personal note only and never influences your matches.</p><div className="preference-footer"><button className="primary-button search-button" disabled={!profile || searchLoading || parseLoading} onClick={() => setSearchRevision(value => value + 1)}>{searchLoading ? <LoaderCircle size={16} className="spinner" /> : <Search size={16} />} {searchLoading ? 'Finding your fit…' : 'Find my matches'} <ArrowRight size={16} /></button><p>{profile ? 'Filters automatically refresh your matches.' : 'Upload your résumé to unlock your matches.'}</p></div>
            </div>
          </section>

          {!profile && <section className="features-row" aria-label="How Jobhunter helps"><Feature icon={<Compass size={20} />} title="Find your kind of work" text="Real listings, matched to your skills and the places you want to be." /><Feature icon={<FileText size={20} />} title="Make your experience shine" text="Job-specific résumé guidance and an editable cover letter draft." /><Feature icon={<BriefcaseBusiness size={20} />} title="Keep your next steps clear" text="Application guidance, a simple tracker, and thoughtful follow-ups." /></section>}

          {profile && <section className="results-section" aria-label="Job matches"><div className="results-toolbar"><div className="result-heading"><div className="eyebrow">A LITTLE CLOSER TO YOUR NEXT CHAPTER</div><h2>{demo ? 'Your example matches' : 'Opportunities for you'} {results && <span className="result-count">{results.jobs.length}</span>}</h2></div><div className="results-actions"><button className="secondary-button" onClick={() => setManualOpen(true)}><Plus size={15} /> Add a job listing</button><button className="text-button" disabled={searchLoading} onClick={() => setSearchRevision(value => value + 1)}>Refresh <Search size={14} /></button></div></div>
            {searchLoading && <div className="empty-state" role="status"><LoaderCircle size={28} className="spinner" /><h2>Looking for your next chapter</h2><p>{STATIC_MODE ? 'Loading job listings and matching them to your experience…' : 'Checking job sources and matching the details to your experience…'}</p></div>}
            {searchError && <div className="error-banner" role="alert"><strong>We couldn’t complete this search.</strong><p>{searchError}</p><button className="secondary-button" onClick={() => setSearchRevision(value => value + 1)}>Try again</button></div>}
            {results && <>
              {!demo && <div className="source-summary">{results.sources.map(source => <span key={source.name} className={`source-badge ${source.status === 'error' ? 'error' : ''}`} title={source.message}><span /> {source.name} · {source.status === 'ok' ? `${source.count} listings${STATIC_MODE ? '' : ' checked'}` : STATIC_MODE && source.count > 0 ? `${source.count} earlier listings` : 'unavailable'}</span>)}<span className="source-time">{STATIC_MODE ? `Last checked ${niceDate(results.searchedAt)}` : `Updated ${new Date(results.searchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}</span></div>}
              {listingsStale && <div className="source-notice" role="status"><CircleHelp size={16} /><div><strong>These listings haven’t refreshed in more than two days.</strong><p>Some roles may have closed. Check the original listing before applying, or add a job you found elsewhere.</p></div></div>}
              {!demo && results.sources.some(source => source.status === 'error') && <div className="source-notice"><CircleHelp size={16} /><div><strong>{allFeedsFailed ? (STATIC_MODE ? 'Job sources could not be refreshed.' : 'Live job sources are temporarily unavailable.') : (STATIC_MODE ? 'Some job sources could not be refreshed.' : 'Some job sources could not be reached.')}</strong><p>{results.sources.filter(source => source.status === 'error').map(source => `${source.name}: ${source.message}`).join(' ')}</p><p>You can paste a listing from any job board to create your application kit.</p></div></div>}
              {results.jobs.length ? <div className="jobs-grid">{results.jobs.map(job => <JobCard key={job.id} job={job} saved={isSaved(job.id)} onSave={() => toggleSaved(job)} onOpen={() => openJob(job)} />)}</div> : <div className="empty-state"><span className="empty-icon"><Search size={25} /></span><h2>{allFeedsFailed || noListingsAvailable ? 'Your next opportunity is still out there.' : 'A different direction might open a door.'}</h2><p>{allFeedsFailed || noListingsAvailable ? 'We don’t have listings to search right now. Explore the guided demo or add a listing you found elsewhere. Your résumé tools and tracker are ready.' : 'Try a broader role, another country, or fewer filters. You can also add a job listing yourself.'}</p><div className="inline-actions"><button className="secondary-button" onClick={() => setManualOpen(true)}><Plus size={15} /> Add a job listing</button>{!demo && <button className="text-button" onClick={startDemo}>Explore the guided demo <ArrowRight size={15} /></button>}</div></div>}
              <p className="ranking-note">Matches use skill overlap and résumé keywords, not a hiring prediction. {STATIC_MODE && !demo ? 'Listings refresh periodically. ' : ''}Review every listing and confirm it is still open at the source.</p>
            </>}
          </section>}
        </>}

        {page === 'studio' && <>
          <div className="page-heading"><div className="eyebrow">PUT YOUR BEST SELF FORWARD</div><h1>Your experience.<br /><span>A stronger story.</span></h1><p>Review what we found in your résumé, then make it work for the role you want.</p></div>
          {!profile ? <EmptyState icon={<FileText size={27} />} title="Every good story starts somewhere." text="Upload or paste your résumé to review your skills and create job-specific improvements." action={<button className="primary-button" onClick={() => setPage('discover')}>Add your résumé <ArrowRight size={16} /></button>} /> : <div className="studio-grid">
            <section className="panel studio-summary"><div className="section-heading"><span className="section-icon"><GraduationCap size={20} /></span><div className="section-title"><h2>Your résumé profile</h2><p>Check the detected details before applying.</p></div></div><h3 className="profile-name">{profile.name || 'Your résumé'}</h3><p className="muted">{profile.summary}</p><div className="profile-detail"><span>Experience detected</span><strong>{profile.yearsExperience !== null ? `${profile.yearsExperience} years` : 'Not specified'}</strong></div><div className="profile-detail"><span>Original file</span><strong>{profile.filename}</strong></div><h4>Skills we found</h4><div className="skill-tags">{profile.skills.length ? profile.skills.map(skill => <span className="skill-tag" key={skill}>{skill}</span>) : <p className="muted">No familiar skills detected. Add explicit skill names to your résumé text.</p>}</div><div className="notice-banner"><Sparkles size={16} /><p>Choose a role in Discover jobs to get targeted improvements and a cover letter. Only add skills and accomplishments you can honestly support.</p></div><button className="secondary-button full-width" onClick={() => setPage('discover')}>Find a role for your résumé <ArrowRight size={15} /></button></section>
            <section className="panel"><div className="section-heading"><span className="section-icon"><FileText size={20} /></span><div className="section-title"><h2>Give your résumé a second look</h2><p>Correct extraction errors or update your experience.</p></div></div><label className="field-label" htmlFor="studio-resume">Résumé text</label><textarea id="studio-resume" className="textarea studio-textarea" value={studioText} onChange={event => setStudioText(event.target.value)} rows={19} /><p className="muted small-text">Text is kept in this session. Reanalysis updates your profile and job matches.</p>{parseError && <div className="error-banner" role="alert">{parseError}</div>}<div className="studio-actions"><button className="secondary-button" onClick={() => downloadText('my-resume.txt', studioText)}><ArrowDownToLine size={16} /> Download text</button><button className="primary-button" disabled={parseLoading || studioText.trim().length < 40} onClick={() => { if (demo) { setProfile(analyzeResume(studioText, profile.filename)); setToast('Sample résumé profile updated.'); } else void parseResume(undefined, studioText, profile.filename); }}>{parseLoading ? <LoaderCircle size={16} className="spinner" /> : <Sparkles size={16} />} Reanalyze résumé</button></div></section>
          </div>}
        </>}

        {page === 'applications' && <>
          <div className="page-heading"><div className="eyebrow">ONE STEP AT A TIME</div><h1>Keep your next<br /><span>chapter on track.</span></h1><p>A little organization goes a long way. Your opportunities, notes, and next moves.</p></div>
          {applications.length === 0 ? <EmptyState icon={<Bookmark size={27} />} title="Make room for possibility." text="Save a job from your matches to start tracking your progress, from first interest to your next offer." action={<button className="primary-button" onClick={() => setPage('discover')}>Discover opportunities <ArrowRight size={16} /></button>} /> : <>
            <div className="tracker-toolbar"><div className="tracker-summary"><strong>{activeApplications.length}</strong> active opportunities <span>·</span> <strong>{applications.filter(application => application.appliedAt !== null).length}</strong> applications sent</div><label className="sr-only" htmlFor="stage-filter">Filter applications by stage</label><select id="stage-filter" className="select" value={stageFilter} onChange={event => setStageFilter(event.target.value)}><option>All stages</option>{STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></div>
            <div className="application-list">{shownApplications.map(application => <article className="panel application-card" key={application.id}><div className="application-top"><span className="company-logo">{initials(application.job.company)}</span><div className="application-main"><button className="application-title" onClick={() => openJob(application.job)}>{application.job.title}</button><p>{application.job.company} <span>·</span> {application.job.location}{application.job.source === 'Demo' ? ' · Fictional demo job' : ''}</p></div><div className="application-controls"><label className="sr-only" htmlFor={`stage-${application.id}`}>Stage for {application.job.title}</label><select className={`select stage-select stage-${application.stage.toLowerCase()}`} id={`stage-${application.id}`} value={application.stage} onChange={event => updateApplication(application.id, { stage: event.target.value as ApplicationStage })}>{STAGES.map(stage => <option key={stage}>{stage}</option>)}</select><button className="danger-button" aria-label={`Remove ${application.job.title} from tracker`} onClick={() => toggleSaved(application.job)}><Trash2 size={17} /></button></div></div><div className="application-meta"><span>Saved {niceDate(application.savedAt)}</span>{application.appliedAt && <span>Applied {niceDate(application.appliedAt)}</span>}<button className="text-button" onClick={() => openJob(application.job, 'apply')}>Application guide <ArrowUpRight size={13} /></button></div><label className="field-label" htmlFor={`notes-${application.id}`}>Your notes</label><textarea id={`notes-${application.id}`} className="textarea application-notes" rows={2} maxLength={10000} value={application.notes} placeholder="Contact name, application link, interview details, or your next step…" onChange={event => updateApplication(application.id, { notes: event.target.value })} />{['Applied', 'Interview'].includes(application.stage) && <div className="tracker-followup"><span><CheckCheck size={16} /> {application.stage === 'Applied' ? 'Give them 5–7 business days, unless the listing gives a timeline.' : 'Send a brief thank-you after your interview and confirm the next step.'}</span><button className="text-button" onClick={() => openJob(application.job, 'apply')}>Plan your follow-up <ArrowRight size={13} /></button></div>}</article>)}</div>{shownApplications.length === 0 && <p className="empty-state">No applications at this stage yet.</p>}
          </>}
          <p className="ranking-note"><ShieldCheck size={13} /> Saved jobs and your notes are stored in this browser. Stage changes are your own records; no applications or messages are sent.</p>
        </>}
      </div>
    </main>

    {selectedJob && <Modal className="job-drawer" label={`Job details: ${selectedJob.title}`} onClose={() => setSelectedJob(null)}><div className="drawer-header"><span>YOUR NEXT POSSIBILITY</span><button className="close-button" onClick={() => setSelectedJob(null)} aria-label="Close job details"><X size={21} /></button></div><div className="detail-banner"><div className="detail-company"><span className="company-logo">{initials(selectedJob.company)}</span><div><strong>{selectedJob.company}</strong><span>{selectedJob.source === 'Demo' ? 'Fictional demo listing' : `Via ${selectedJob.source}`}</span></div></div><h2 className="detail-title">{selectedJob.title}</h2><div className="detail-meta"><span><MapPin size={15} />{selectedJob.location}</span><span><BriefcaseBusiness size={15} />{selectedJob.employmentType}</span>{selectedJob.remote && <span><Globe2 size={15} />Remote</span>}</div>{selectedJob.salary && <p className="detail-salary">{selectedJob.salary}</p>}<div className="detail-match">{profile ? <><span><Sparkles size={16} /> {selectedJob.score}% skill match</span><p>{selectedJob.matchExplanation}</p></> : <p>Upload your résumé in this session to compare your current skills with this role.</p>}</div></div>
      <div className="detail-tabs" role="tablist" aria-label="Job application tools">{([['overview', 'The role'], ['resume', 'Résumé tips'], ['letter', 'Cover letter'], ['apply', 'Next steps']] as const).map(([tab, label]) => <button className={`detail-tab ${detailTab === tab ? 'active' : ''}`} key={tab} id={`tab-${tab}`} role="tab" aria-selected={detailTab === tab} aria-controls={`panel-${tab}`} onClick={() => setDetailTab(tab)}>{label}</button>)}</div>
      <div className="detail-content" id={`panel-${detailTab}`} role="tabpanel" aria-labelledby={`tab-${detailTab}`}>
        {detailTab === 'overview' && <><section className="detail-section"><h3>Where your experience connects</h3>{profile && selectedJob.matchedSkills.length ? <div className="skill-tags">{selectedJob.matchedSkills.map(skill => <span key={skill} className="skill-tag"><Check size={12} /> {skill}</span>)}</div> : <p className="muted">{profile ? 'No explicit skill overlap was detected. Read the full listing to judge the fit.' : 'Your résumé is not retained between sessions. Upload it again to review your current fit.'}</p>}{profile && selectedJob.missingSkills.length > 0 && <><h4>Skills to review</h4><div className="skill-tags">{selectedJob.missingSkills.map(skill => <span key={skill} className="skill-tag missing">{skill}</span>)}</div><p className="small-text muted">These appear in the listing but were not detected in your résumé. Add them only if you have the experience.</p></>}</section><section className="detail-section"><h3>About this role</h3><div className="detail-description">{selectedJob.description}</div></section><section className="detail-section source-detail"><h4>Listing information</h4><p>{selectedJob.source} · Posted {niceDate(selectedJob.publishedAt)}</p>{selectedJob.source !== 'Demo' && safeUrl(selectedJob.url) && <a className="text-button" href={selectedJob.url} target="_blank" rel="noopener noreferrer">Read the original listing <ArrowUpRight size={15} /></a>}<p className="small-text muted">Source listings may change or close. Confirm location, eligibility, compensation, and application instructions before applying.</p></section></>}
        {detailTab === 'resume' && <><section className="detail-section"><div className="eyebrow">MAKE THE CONNECTION CLEAR</div><h3>Small changes. A stronger application.</h3><p className="muted">Suggestions based on your résumé and this listing. Your experience stays yours.</p></section>{kit ? <div className="kit-suggestions">{kit.suggestions.map((suggestion, index) => <div className="suggestion-card" key={suggestion.title}><span className="suggestion-number">0{index + 1}</span><div><span className="suggestion-kind">{suggestion.kind}</span><h4>{suggestion.title}</h4><p>{suggestion.detail}</p></div></div>)}</div> : <div className="notice-banner">Upload your résumé to get recommendations for this role.</div>}<div className="notice-banner"><ShieldCheck size={16} /><p>Use real achievements and evidence. These recommendations do not add skills or experience to your résumé for you.</p></div>{kit && <div className="copy-row"><button className="secondary-button" onClick={() => downloadText('resume-improvements.txt', kit.suggestions.map(suggestion => `${suggestion.title}\n${suggestion.detail}`).join('\n\n'))}><ArrowDownToLine size={15} /> Download recommendations</button><button className="text-button" onClick={() => { setSelectedJob(null); setPage('studio'); }}>Edit résumé text <ArrowRight size={15} /></button></div>}</>}
        {detailTab === 'letter' && <><section className="detail-section"><div className="eyebrow">A HELLO THAT FEELS LIKE YOU</div><h3>Your cover letter, a first draft.</h3><p className="muted">A tailored starting point using only your provided experience. Edit it, check the details, and make it your own.</p></section>{kit ? <><label className="sr-only" htmlFor="cover-letter">Edit your cover letter</label><textarea id="cover-letter" className="textarea letter-box" rows={20} value={letter} onChange={event => setLetter(event.target.value)} /><div className="copy-row"><button className="primary-button" onClick={() => void copy(letter, 'Cover letter copied.')}><Clipboard size={15} /> Copy letter</button><button className="secondary-button" onClick={() => downloadText(`cover-letter-${selectedJob.company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`, letter)}><ArrowDownToLine size={15} /> Download .txt</button></div><p className="small-text muted">Replace placeholders and verify every claim before sending. This is a rule-based draft, not an AI-written or reviewed application.</p></> : <div className="notice-banner">Upload your résumé to generate a cover letter for this role.</div>}</>}
        {detailTab === 'apply' && <><section className="detail-section"><div className="eyebrow">YOUR NEXT MOVE, MADE CLEAR</div><h3>From interested to applied.</h3>{selectedJob.source === 'Demo' && <div className="notice-banner">This is a fictional demo job. Use these steps to explore the workflow; there is no real application to submit.</div>}<ol className="step-list">{(nextStepsKit?.applicationSteps ?? ['Read the original listing carefully and confirm the role is open.', 'Prepare your résumé and a cover letter that reflect your real experience.', 'Follow the employer’s instructions and save a copy of your application.', 'Mark the job as Applied in your tracker after you submit it.']).map(step => <li key={step}>{step}</li>)}</ol></section><section className="detail-section"><h3>A thoughtful follow-up</h3><p className="muted">After applying, wait about 5–7 business days or follow the employer’s stated timeline. Use the appropriate contact from the listing; don’t guess personal contact details.</p>{nextStepsKit && <><div className="followup-box">{nextStepsKit.followUp}</div><button className="text-button" onClick={() => void copy(nextStepsKit.followUp, 'Follow-up draft copied.')}><Clipboard size={14} /> Copy follow-up draft</button></>}</section>{nextStepsKit && <section className="detail-section"><h3>Good questions for your next conversation</h3><ul className="question-list">{nextStepsKit.questions.map(question => <li key={question}>{question}</li>)}</ul></section>}<div className="notice-banner">Applications and follow-ups are sent by you. Save the role, submit through the source, then update your tracker.</div></>}
      </div><div className="drawer-actions"><button className={`secondary-button drawer-save ${isSaved(selectedJob.id) ? 'saved' : ''}`} onClick={() => toggleSaved(selectedJob)}><Bookmark size={17} fill={isSaved(selectedJob.id) ? 'currentColor' : 'none'} />{isSaved(selectedJob.id) ? 'Saved to tracker' : 'Save opportunity'}</button>{selectedJob.source !== 'Demo' && safeUrl(selectedJob.url) ? <a className="primary-button" href={selectedJob.url} target="_blank" rel="noopener noreferrer">Apply at source <ArrowUpRight size={17} /></a> : <span className="muted small-text">{selectedJob.source === 'Demo' ? 'Demo · fictional listing' : 'No verified application link supplied'}</span>}</div></Modal>}
    {manualOpen && <ManualJobModal profile={profile} onClose={() => setManualOpen(false)} onAdd={job => { setManualOpen(false); openJob(job); setToast('Listing added. Your application tools are ready.'); }} />}
    {toast && <div className="toast" role="status"><Check size={17} /> {toast}</div>}
  </div>;
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <article className="feature"><span className="feature-icon">{icon}</span><div><h3>{title}</h3><p>{text}</p></div></article>; }
function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action: ReactNode }) { return <div className="panel empty-state"><span className="empty-icon">{icon}</span><h2>{title}</h2><p>{text}</p>{action}</div>; }
function JobCard({ job, saved, onSave, onOpen }: { job: Job; saved: boolean; onSave: () => void; onOpen: () => void }) {
  return <article className="job-card"><div className="job-card-top"><span className="company-logo">{initials(job.company)}</span><div className="company-meta"><strong>{job.company}</strong><span>{job.source === 'Demo' ? 'Fictional demo listing' : `Via ${job.source}`}</span></div><button className={`save-button ${saved ? 'saved' : ''}`} aria-label={`${saved ? 'Unsave' : 'Save'} ${job.title}`} aria-pressed={saved} onClick={onSave}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'} /></button></div><h3><button onClick={onOpen}>{job.title}</button></h3><div className="job-location"><MapPin size={14} /> {job.location}</div><div className="job-tags"><span className="job-tag">{job.employmentType}</span>{job.remote && <span className="job-tag">Remote</span>}{job.salary && <span className="job-tag salary-tag">{job.salary}</span>}</div><div className="job-match"><span><Sparkles size={14} /> Skills match</span><strong className="match-number">{job.score}%</strong></div><div className="match-progress"><i style={{ width: `${Math.min(100, Math.max(0, job.score))}%` }} /></div><p className="job-explanation">{job.matchedSkills.length ? `${job.matchedSkills.slice(0, 4).join(', ')}${job.matchedSkills.length > 4 ? ` +${job.matchedSkills.length - 4} more` : ''} align with your résumé.` : 'Explore the role to see whether your experience fits.'}</p><div className="job-card-footer"><span className="job-source">{job.source === 'Demo' ? 'Sample data' : niceDate(job.publishedAt)}</span><button className="view-job-button" onClick={onOpen}>Explore role <ArrowUpRight size={16} /></button></div></article>;
}

function ManualJobModal({ profile, onClose, onAdd }: { profile: ResumeProfile | null; onClose: () => void; onAdd: (job: Job) => void }) {
  const [fields, setFields] = useState({ title: '', company: '', location: '', url: '', description: '' });
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (fields.url && !safeUrl(fields.url)) { setError('Use a full http:// or https:// application URL.'); return; }
    const job: Job = { id: `manual-${crypto.randomUUID()}`, title: fields.title.trim(), company: fields.company.trim(), location: fields.location.trim() || 'Location not provided', url: fields.url.trim(), description: fields.description.trim(), countries: [], remote: /remote/i.test(fields.description + fields.location), employmentType: 'Not specified', source: 'Your listing', publishedAt: null, salary: null, tags: [], score: 0, matchedSkills: [], missingSkills: [], matchExplanation: 'Upload your résumé to compare skills.' };
    onAdd(profile ? rankJob(profile, job) : job);
  }
  return <Modal className="manual-dialog" label="Add a job listing" onClose={onClose}><div className="modal-header"><div><div className="eyebrow">AN OPPORTUNITY YOU FOUND</div><h2>Bring your next possibility here.</h2></div><button className="close-button" aria-label="Close add job listing" onClick={onClose}><X size={20} /></button></div><form onSubmit={submit}><div className="modal-body manual-job-form"><p className="muted">Paste a listing from any job board to get résumé advice, a cover letter, and a clear application plan.</p><div className="filter-grid"><div className="field"><label className="field-label" htmlFor="manual-title">Job title</label><input className="input" id="manual-title" required maxLength={200} value={fields.title} onChange={event => setFields(previous => ({ ...previous, title: event.target.value }))} placeholder="e.g. Frontend developer" /></div><div className="field"><label className="field-label" htmlFor="manual-company">Company</label><input className="input" id="manual-company" required maxLength={200} value={fields.company} onChange={event => setFields(previous => ({ ...previous, company: event.target.value }))} placeholder="Company name" /></div></div><div className="field"><label className="field-label" htmlFor="manual-location">Location <span>OPTIONAL</span></label><input className="input" id="manual-location" maxLength={200} value={fields.location} onChange={event => setFields(previous => ({ ...previous, location: event.target.value }))} placeholder="City, country, or remote" /></div><div className="field"><label className="field-label" htmlFor="manual-url">Application URL <span>OPTIONAL</span></label><input className="input" id="manual-url" type="url" maxLength={2000} value={fields.url} onChange={event => setFields(previous => ({ ...previous, url: event.target.value }))} placeholder="https://company.com/careers/role" /></div><div className="field"><label className="field-label" htmlFor="manual-description">Full job description</label><textarea className="textarea" id="manual-description" rows={7} required minLength={40} maxLength={100000} value={fields.description} onChange={event => setFields(previous => ({ ...previous, description: event.target.value }))} placeholder="Paste the responsibilities, requirements, and application instructions…" /></div>{error && <div className="error-banner" role="alert">{error}</div>}<p className="small-text muted">This listing was supplied by you and hasn’t been verified by Jobhunter.</p></div><div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Build my application kit <ArrowRight size={16} /></button></div></form></Modal>;
}

export default App;
