# Jobhunter

Jobhunter is a personal job-search workspace: read a résumé, find relevant listings, understand the fit, prepare a cover letter, and track applications and follow-ups.

## GitHub Pages version

The GitHub Pages build runs entirely in your browser. It supports PDF, DOCX, and TXT uploads, pasted résumé text, country and work-style filters, résumé recommendations, editable cover letters, manual job listings, and a persistent application tracker.

Your résumé is parsed locally and is not uploaded to GitHub, job providers, or an AI service. Text-based PDFs are supported; scanned PDFs require OCR elsewhere or pasted text. Files are limited to 5 MB and PDFs to 40 pages. Saved jobs, stages, and notes stay in this browser's local storage. Refreshing clears the active résumé, while tracked applications remain available. Follow-up templates can still be opened without re-uploading the résumé.

The guided demo uses visibly labeled **fictional jobs**, never mixed into live feed results. Real applications are submitted by you through each listing's original application link.

### Publish on GitHub Pages

This project is configured for the repository `MohamedLoudaihi/jobhunter`, with the site base path `/jobhunter/`.

1. Push the project to the repository's `main` branch.
2. In the repository, open **Settings → Pages → Build and deployment → Source**, and select **GitHub Actions**. An administrator must enable Pages initially; the workflow's standard token cannot do that itself.
3. Open **Actions → Publish Jobhunter → Run workflow** if the initial run occurred before Pages was enabled.
4. After the deploy job succeeds, open the site URL shown in that job or in Settings → Pages.

The workflow installs locked dependencies, validates the app, builds the static site, and deploys only `dist-pages`. It also runs roughly every six hours to refresh public listings. Feed timestamps are cached across deployments so manual workflow retries do not repeatedly poll Remotive. GitHub schedules can be delayed; the interface shows the last check and warns about old or failed feeds. Repository visibility or account plan can affect Pages availability; the workflow does not change repository visibility.

The expected URL after a successful deployment is `https://mohamedloudaihi.github.io/jobhunter/`. This URL is not proof of deployment; check the deploy job and the actual page response.

### Preview the Pages build

Requires Node.js 24 or newer:

```sh
npm ci
npm run refresh:jobs
npm run build:pages
npm run preview:pages
```

Open the address printed by Vite with `/jobhunter/` as its path. The static preview does not need the Express server. The bundled PDF worker and all other assets are served from the same site.

## Workflow

1. Upload or paste your résumé. Review extracted text and skills in Résumé studio.
2. Select a country, job keywords, work arrangement, employment type, and experience level. Uploading starts a search, and changing preferences refreshes matches.
3. Open a listing for its description, recognized skill overlap, missing keywords, résumé advice, a cover letter draft, and an application checklist.
4. Edit and verify the draft. Open the original listing and apply through the employer's instructions.
5. Save the job in Applications, record notes, and update its stage after submitting. Follow-up guidance includes a template and useful questions for the recruiter.

You can paste a real job description and application link from any board to prepare a kit when that board isn't represented in the public feeds.

## Matching and writing

This version uses a transparent keyword and résumé-analysis engine. Its score measures recognized listing keywords also found in your résumé; it is not a prediction of hiring success or confirmation that you meet every requirement. Missing keywords are prompts to review gaps, not instructions to invent experience. Only add skills and achievements you can support.

Cover letters and recommendations are deterministic drafts grounded in your résumé and the selected listing. They do not use a paid AI model or submit applications. Review every claim, contact detail, and employer requirement. Optional age stays a personal detail and does not influence ranking.

## Public job feeds

The Pages site downloads a public snapshot from its own `jobs.json` file. It then filters and ranks listings locally; candidate information never enters the feed request. The builder fetches Arbeitnow and Remotive using their public APIs, preserving attribution and original listing links.

Arbeitnow coverage is strongest in Europe, while Remotive focuses on remote roles. This is not a crawler of every job board and cannot guarantee coverage for every country or occupation. Country eligibility uses published provider location information and conservatively excludes unclear restrictions from specific-country results. Always confirm availability, work authorization, and application instructions in the original listing.

A failed refresh keeps a previous valid source's listings with its real successful-update timestamp and an explicit warning. Old results may have closed. The app does not substitute fictional jobs into feed results. Remotive attempts are separated by at least six hours using a cache retained between workflow runs; Arbeitnow attempts are separated by at least 15 minutes.

The build requires HTTPS access to `www.arbeitnow.com` and `remotive.com`. Enabling or inspecting Pages through the GitHub API requires `api.github.com`; verifying the public site requires `mohamedloudaihi.github.io`. Missing access must be configured through the environment's supported network settings.

## Optional full-stack local version

The original Express-backed development version remains available:

```sh
npm ci
npm run dev
```

Vite runs on port 5173 and proxies `/api` to the backend on port 3001. For a single production server:

```sh
npm run build
npm start
```

The backend parses uploads in memory and fetches the public feeds. Résumé files are not written to disk. `GET /api/health` checks the API. Production supports a `PORT` override; development uses port 3001 because of the Vite proxy.

The optional server-only Adzuna provider needs `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` with a supported country selected, plus HTTPS access to `api.adzuna.com`. Supply your own credentials securely, using an ignored `.env` file for local use. Never put secret keys in the Pages frontend or the published feed. Adzuna is not configured in the Pages version.

## Verification

```sh
npm test
npm run build
npm run build:pages
npm run test:pages
```

The Pages browser suite serves the production bundle at the real `/jobhunter/` subpath. It verifies actual TXT, PDF, and DOCX parsing, same-origin-only network requests, automatic matching, cover letters, persistent tracking, invalid uploads, and the mobile demo. It uses system Chromium when available; otherwise install Playwright Chromium in a network-enabled environment. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing browser.

`npm run test:e2e` separately checks the Express-backed workflow. Build the full-stack frontend first and avoid reusing an API-only server started before that build.

## Project layout

- `src/`: React interface, browser parsers, static discovery, and tracker.
- `shared/`: types, country and provider normalization, matching, guidance, and labeled demo data.
- `scripts/refresh-jobs.ts`: bounded public-feed refresh with safe failure retention.
- `public/jobs.json`: public listing seed, without résumé or matching data.
- `.github/workflows/pages.yml`: cached refresh, build, and Pages deployment.
- `server/`: optional Express API for local development.
- `tests/`, `e2e-pages/`, `e2e/`: unit, provider, and browser checks.

Use the existing checkout in cloud tasks. Each task is isolated; no Git worktree is required unless explicitly requested.
