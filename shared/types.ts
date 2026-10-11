export interface ResumeProfile {
  name: string;
  text: string;
  skills: string[];
  yearsExperience: number | null;
  summary: string;
  filename: string;
}
export interface Preferences {
  country: string;
  query: string;
  workMode: 'any' | 'remote' | 'onsite' | 'hybrid';
  employmentType: 'any' | 'full-time' | 'part-time' | 'contract' | 'internship';
  experienceLevel: 'any' | 'entry' | 'mid' | 'senior';
}
export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  countries: string[];
  remote: boolean;
  employmentType: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string | null;
  salary: string | null;
  tags: string[];
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  matchExplanation: string;
}
export interface SourceStatus { name: string; status: 'ok' | 'error'; count: number; message: string; }
export interface SearchResult { jobs: Job[]; sources: SourceStatus[]; searchedAt: string; totalFetched: number; }
export interface Suggestion { title: string; detail: string; kind: 'structure' | 'evidence' | 'skills'; }
export interface CareerKit { suggestions: Suggestion[]; coverLetter: string; applicationSteps: string[]; followUp: string; questions: string[]; }
export type ApplicationStage = 'Saved' | 'Applied' | 'Interview' | 'Offer' | 'Closed';
export interface Application { id: string; job: Job; stage: ApplicationStage; savedAt: string; appliedAt: string | null; notes: string; }
