import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeResume, buildCareerKit, rankJob } from '../shared/career';
import type { Job } from '../shared/types';

function listing(overrides: Partial<Job> = {}): Job {
  return { id: 'test-job', title: 'Developer', company: 'Example Company', location: 'France', countries: ['France'], remote: true, employmentType: 'full-time', description: 'Python, SQL and Docker.', url: 'https://example.com/careers/1', source: 'Example Jobs', publishedAt: null, salary: null, tags: [], score: 0, matchedSkills: [], missingSkills: [], matchExplanation: '', ...overrides };
}

test('skill detection respects token boundaries and punctuated names', () => {
  const profile = analyzeResume('Jane Doe\nSkills: JavaScript, MySQL, C++, C#, .NET, TypeScript, Dockerized applications, GitHub.', 'cv.txt');
  assert.deepEqual(profile.skills, ['JavaScript', 'TypeScript', 'C++', 'C#', '.NET', 'MySQL']);
  assert.equal(profile.name, 'Jane Doe');
});

test('explicitly denied experience is not treated as a qualification', () => {
  const profile = analyzeResume('Jane Doe\nNo experience with Java or Docker.\nPython (no professional experience).\nI am not proficient in C++.\nSQL skills.\nNo Java experience, but JavaScript projects.', 'cv.txt');
  assert.deepEqual(profile.skills, ['JavaScript', 'SQL']);
  const kit = buildCareerKit(profile, listing());
  assert.doesNotMatch(kit.coverLetter, /lists Python|lists Docker|lists Java\b|lists C\+\+/);
});

test('name extraction skips headings, contact details, role titles and addresses', () => {
  const profile = analyzeResume('CURRICULUM VITAE\njane@example.com\n12 Main Street\nSoftware Engineer\nJane Doe\nSkills: Python', 'resume.txt');
  assert.equal(profile.name, 'Jane Doe');
  assert.equal(analyzeResume('Contact Information\nNew York\ncontact@example.com\n123 Main Street\nSkills: SQL', 'cv.txt').name, '');
  assert.equal(analyzeResume('Python and SQL\nAcademic Background', 'cv.txt').name, '');
});

test('experience is extracted only when explicitly stated and is never summed from dates', () => {
  assert.equal(analyzeResume('Jane Doe\nExperience\nDeveloper 2010–2024\nAge: 38\nPython', 'cv.txt').yearsExperience, null);
  assert.equal(analyzeResume('Jane Doe\n5+ years of professional experience.\n2 years of experience with SQL.', 'cv.txt').yearsExperience, 5);
  assert.equal(analyzeResume('Name: Jane Doe\nExperience: 3 years\nExcel', 'cv.txt').yearsExperience, 3);
});

test('nontechnology skills cover healthcare, hospitality, business and trades', () => {
  const profile = analyzeResume('Nursing, patient care, CPR, food safety, housekeeping, bookkeeping, sales, welding, plumbing.', 'cv.txt');
  for (const skill of ['Nursing', 'Patient care', 'CPR', 'Food safety', 'Housekeeping', 'Bookkeeping', 'Sales', 'Welding', 'Plumbing']) {
    assert.ok(profile.skills.includes(skill), `${skill} should be detected`);
  }
});

test('recognizes common design, API, accessibility and testing terms', () => {
  const profile = analyzeResume('Figma, REST APIs, accessible design systems, automated tests and WCAG.', 'cv.txt');
  for (const skill of ['Figma', 'REST APIs', 'Accessibility', 'Design systems', 'Software testing']) {
    assert.ok(profile.skills.includes(skill), `${skill} should be detected`);
  }
});

test('keyword ranking is transparent, consistent and does not mutate the source listing', () => {
  const original = listing();
  const partial = rankJob(analyzeResume('Python and SQL', 'cv.txt'), original);
  const complete = rankJob(analyzeResume('Python, SQL and Docker', 'cv.txt'), original);
  assert.equal(partial.score, 67);
  assert.deepEqual(partial.matchedSkills, ['Python', 'SQL']);
  assert.deepEqual(partial.missingSkills, ['Docker']);
  assert.ok(complete.score > partial.score);
  assert.equal(complete.score, 100);
  assert.match(partial.matchExplanation, /2 of 3/);
  assert.match(partial.matchExplanation, /not a hiring probability/);
  assert.equal(original.score, 0);
  assert.deepEqual(original.matchedSkills, []);
});

test('letters mention resume overlap without inventing years, achievements or missing qualifications', () => {
  const profile = analyzeResume('Jane Doe\nSkills: Python\nExperience: Built a small script.', 'cv.txt');
  const kit = buildCareerKit(profile, listing());
  assert.match(kit.coverLetter, /Jane Doe/);
  assert.match(kit.coverLetter, /My resume lists Python/);
  assert.doesNotMatch(kit.coverLetter, /Docker|SQL|years|expert|proven|increased|revenue|address|phone/i);
  assert.ok(kit.suggestions.some(suggestion => /SQL and Docker/.test(suggestion.detail) && /do not add them/.test(suggestion.detail)));
  assert.match(kit.suggestions[0].detail, /numbers only when you can verify/);
});

test('letter grounds experience with an exact resume quote and prioritizes relevant evidence', () => {
  const statement = 'Built a Python scheduling script for my volunteer team.';
  const profile = analyzeResume(`Jane Doe\nExperience\nManaged inventory for a local shop.\n${statement}\nSkills\nPython`, 'cv.txt');
  const kit = buildCareerKit(profile, listing());
  assert.match(kit.coverLetter, /One example recorded in my resume is:/);
  assert.ok(kit.coverLetter.includes(`“${statement}”`));
  assert.ok(profile.text.includes(statement));
  assert.doesNotMatch(kit.coverLetter, /Managed inventory/);
});

test('letter omits evidence quotes when only ambiguous aspirations or personal details are available', () => {
  const profile = analyzeResume('Jane Doe\nSummary\nI want to build Python tools.\nSkills\nPython\nProjects\nPlanned a Python script.\nProvided my email address: jane@example.com', 'cv.txt');
  const kit = buildCareerKit(profile, listing());
  assert.doesNotMatch(kit.coverLetter, /One example|jane@example|Planned|want to build/);
});

test('empty resume and listings still give honest application guidance', () => {
  const profile = analyzeResume('', 'empty.txt');
  const job = listing({ title: 'Community Coordinator', description: 'Help our neighborhood.', tags: [] });
  const ranked = rankJob(profile, job);
  const kit = buildCareerKit(profile, job);
  assert.equal(ranked.score, 0);
  assert.deepEqual(ranked.missingSkills, []);
  assert.match(ranked.matchExplanation, /cannot assess fit/);
  assert.match(kit.coverLetter, /\[Your name\]/);
  assert.doesNotMatch(kit.coverLetter, /I have experience|qualified|years|expert/i);
  assert.match(kit.followUp, /5–7 business days/);
  assert.match(kit.followUp, /\[application date\]/);
  assert.ok(kit.applicationSteps.some(step => step.includes(job.url)));
  assert.ok(kit.applicationSteps.some(step => /Answer screening questions honestly/.test(step)));
  assert.ok(kit.questions.some(question => /work authorization/.test(question)));
});
