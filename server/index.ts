import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeResume } from '../shared/career.js';
import type { Preferences, ResumeProfile, SearchResult } from '../shared/types.js';
import { normalizeCountry, searchJobs } from './jobs.js';
import { extractResumeText, MAX_RESUME_BYTES, ResumeError, validateResumeText } from './resume.js';

const profileSchema = z.object({
  name: z.string().max(200), text: z.string().min(40).max(120_000), skills: z.array(z.string().max(100)).max(100),
  yearsExperience: z.number().min(0).max(80).nullable(), summary: z.string().max(3000), filename: z.string().max(250),
});
const preferencesSchema = z.object({
  country: z.string().max(100).refine(value => normalizeCountry(value) !== null || ['', 'any', 'all', 'worldwide', 'anywhere'].includes(value.trim().toLowerCase()), 'Choose a recognised country or Anywhere.'),
  query: z.string().max(150), workMode: z.enum(['any', 'remote', 'onsite', 'hybrid']),
  employmentType: z.enum(['any', 'full-time', 'part-time', 'contract', 'internship']), experienceLevel: z.enum(['any', 'entry', 'mid', 'senior']),
});
const pastedResumeSchema = z.object({ text: z.string().max(120_000), filename: z.string().max(250).optional() });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RESUME_BYTES, files: 1, fields: 3, fieldSize: 1024 } });
interface AppOptions { search?: (profile: ResumeProfile, preferences: Preferences) => Promise<SearchResult>; }

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '200kb' }));
  app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'JobHunter', adzunaConfigured: Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) }));
  app.post('/api/resume', upload.single('resume'), async (request, response) => {
    try {
      let text: string;
      let filename: string;
      if (request.file) {
        filename = path.basename(request.file.originalname).slice(0, 250);
        text = await extractResumeText(request.file.buffer, filename);
      } else {
        const parsed = pastedResumeSchema.safeParse(request.body);
        if (!parsed.success) { response.status(400).json({ error: 'Upload a PDF, DOCX, or TXT file, or paste resume text.' }); return; }
        filename = parsed.data.filename || 'Pasted resume';
        text = validateResumeText(parsed.data.text);
      }
      response.json(analyzeResume(text, filename));
    } catch (error) {
      response.status(400).json({ error: error instanceof ResumeError ? error.message : 'This document could not be read. Try a text-based PDF, DOCX, or TXT file, or paste your resume text.' });
    }
  });
  app.post('/api/jobs', async (request, response) => {
    const parsed = z.object({ profile: profileSchema, preferences: preferencesSchema }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Please provide a resume profile and valid search preferences.' });
      return;
    }
    try { response.json(await (options.search ?? searchJobs)(parsed.data.profile, parsed.data.preferences)); }
    catch { response.status(503).json({ error: 'Job search is temporarily unavailable. Please retry shortly.' }); }
  });
  app.use('/api', (_request, response) => response.status(404).json({ error: 'API endpoint not found.' }));
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
  }
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError) {
      response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Please upload a resume smaller than 5 MB.' : 'Upload one file using the resume field.' });
    } else if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'The request contains invalid JSON.' });
    } else if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413) {
      response.status(413).json({ error: 'This request is too large. Please shorten the pasted resume.' });
    } else {
      response.status(500).json({ error: 'The request could not be processed. Please retry.' });
    }
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  const server = createApp().listen(port, '0.0.0.0');
  server.once('listening', () => console.log(`JobHunter API listening on port ${port}`));
  server.once('error', error => {
    console.error(`JobHunter could not start on port ${port} (${(error as NodeJS.ErrnoException).code || 'server error'}).`);
    process.exitCode = 1;
  });
}
