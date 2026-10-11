import type { CareerKit, Job, ResumeProfile, Suggestion } from './types';

// These are detected keywords, not independently verified qualifications.
const skillDictionary: Array<[string, string[]]> = [
  ['JavaScript', ['javascript', 'ecmascript']], ['TypeScript', ['typescript']],
  ['Python', ['python']], ['Java', ['java']], ['C++', ['c++']], ['C#', ['c#', 'c sharp']],
  ['.NET', ['.net', 'dotnet']], ['PHP', ['php']], ['Ruby', ['ruby']], ['Rust', ['rust']],
  ['Go', ['golang', 'go programming', 'go language']], ['R', ['r programming', 'r language', 'rstudio']],
  ['React', ['react', 'reactjs', 'react.js']], ['Vue', ['vue', 'vuejs', 'vue.js']],
  ['Angular', ['angular']], ['Node.js', ['node.js', 'nodejs']], ['Next.js', ['next.js', 'nextjs']],
  ['Django', ['django']], ['Flask', ['flask']], ['FastAPI', ['fastapi']], ['Spring', ['spring boot', 'spring framework']],
  ['REST APIs', ['rest api', 'rest apis', 'restful api', 'restful apis']],
  ['HTML', ['html', 'html5']], ['CSS', ['css', 'css3']], ['Tailwind CSS', ['tailwind', 'tailwindcss']],
  ['Figma', ['figma']], ['Design systems', ['design systems', 'design system']],
  ['Accessibility', ['accessibility', 'accessible', 'wcag']],
  ['SQL', ['sql', 'structured query language']], ['PostgreSQL', ['postgresql', 'postgres']],
  ['MySQL', ['mysql']], ['SQLite', ['sqlite']], ['MongoDB', ['mongodb']], ['Redis', ['redis']],
  ['Git', ['git']], ['Docker', ['docker']], ['Kubernetes', ['kubernetes', 'k8s']],
  ['AWS', ['aws', 'amazon web services']], ['Azure', ['azure']], ['Google Cloud', ['google cloud', 'gcp']],
  ['Linux', ['linux']], ['Bash', ['bash']], ['Terraform', ['terraform']],
  ['CI/CD', ['ci/cd', 'continuous integration', 'continuous delivery']],
  ['Software testing', ['testing', 'tests', 'software testing', 'unit testing', 'automated testing', 'automated tests', 'quality assurance', 'pytest', 'jest', 'playwright']],
  ['Agile', ['agile']], ['Scrum', ['scrum']], ['Machine learning', ['machine learning']],
  ['TensorFlow', ['tensorflow']], ['PyTorch', ['pytorch']], ['Data analysis', ['data analysis', 'data analytics']],
  ['Excel', ['excel', 'microsoft excel']], ['Power BI', ['power bi', 'powerbi']], ['Tableau', ['tableau']],
  ['Project management', ['project management']], ['Product management', ['product management']],
  ['Customer service', ['customer service', 'customer support']], ['Sales', ['sales']],
  ['CRM', ['crm', 'customer relationship management']], ['Salesforce', ['salesforce']], ['HubSpot', ['hubspot']],
  ['Marketing', ['marketing']], ['SEO', ['seo', 'search engine optimization']],
  ['Content writing', ['content writing']], ['Copywriting', ['copywriting']], ['Social media', ['social media']],
  ['Leadership', ['leadership', 'team leadership']], ['Communication', ['communication', 'communications']],
  ['Teamwork', ['teamwork', 'team collaboration']], ['Accounting', ['accounting']], ['Bookkeeping', ['bookkeeping']],
  ['Financial analysis', ['financial analysis']], ['QuickBooks', ['quickbooks']], ['SAP', ['sap']],
  ['Operations', ['operations']], ['Supply chain', ['supply chain']], ['Logistics', ['logistics']],
  ['Inventory management', ['inventory management', 'inventory control']], ['Procurement', ['procurement', 'purchasing']],
  ['Human resources', ['human resources', 'hr management']], ['Recruiting', ['recruiting', 'recruitment']],
  ['Research', ['research']], ['Teaching', ['teaching']], ['Tutoring', ['tutoring']],
  ['Nursing', ['nursing', 'registered nurse']], ['Patient care', ['patient care']],
  ['BLS', ['bls', 'basic life support']], ['First aid', ['first aid']], ['CPR', ['cpr', 'cardiopulmonary resuscitation']],
  ['Medical coding', ['medical coding']], ['Pharmacy', ['pharmacy', 'pharmacist']],
  ['Physiotherapy', ['physiotherapy', 'physical therapy']], ['Hospitality', ['hospitality']],
  ['Food safety', ['food safety']], ['HACCP', ['haccp']], ['Cooking', ['cooking', 'culinary']],
  ['Housekeeping', ['housekeeping']], ['Front desk', ['front desk', 'receptionist']], ['Event planning', ['event planning']],
  ['Welding', ['welding']], ['Electrical work', ['electrical work', 'electrician']], ['Plumbing', ['plumbing', 'plumber']],
  ['AutoCAD', ['autocad']], ['SolidWorks', ['solidworks']], ['CNC', ['cnc']], ['Carpentry', ['carpentry', 'carpenter']],
  ['Driving', ['driving', 'driver license', "driver's license", 'driving licence']], ['Forklift', ['forklift']],
  ['Translation', ['translation', 'translator']], ['English', ['english']], ['French', ['french']],
  ['Spanish', ['spanish']], ['German', ['german']], ['Arabic', ['arabic']], ['Japanese', ['japanese']],
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectSkills(text: string): string[] {
  return skillDictionary.filter(([, aliases]) => aliases.some(alias => {
    // Unicode letter boundaries avoid both Java/JavaScript and SQL/MySQL collisions.
    const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegex(alias)}(?=$|[^\\p{L}\\p{N}_])`, 'giu');
    return [...text.matchAll(pattern)].some(match => {
      const start = match.index! + match[0].length - alias.length;
      const prefix = text.slice(Math.max(0, start - 100), start).split(/[.!?;\n]|\b(?:but|however)\b/i).at(-1) ?? '';
      const suffix = text.slice(start + alias.length, start + alias.length + 60);
      // Obvious explicit negatives should never be presented as possessed skills.
      const negativeBefore = /\b(?:no|without|not|lack(?:ing)?)\s*$|\b(?:no|without|lack(?:ing)?(?:\s+of)?)\s+(?:(?:any|prior|professional|practical|working)\s+)*(?:experience|knowledge|proficiency|skills?|certification)[^.!?;\n]{0,80}$|\bnot\s+(?:proficient|familiar|experienced|skilled|certified)[^.!?;\n]{0,80}$|\b(?:do not|don't)\s+know[^.!?;\n]{0,80}$/i;
      const negativeAfter = /^\s*(?:[(:–—-]\s*)?(?:no|without)\s+(?:(?:prior|professional|practical)\s+)*(?:experience|knowledge|proficiency|skills?|certification)\b/i;
      return !negativeBefore.test(prefix) && !negativeAfter.test(suffix);
    });
  })).map(([skill]) => skill);
}

function extractName(text: string): string {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 8);
  const excluded = /\b(?:resume|curriculum|vitae|profile|summary|objective|experience|employment|history|education|academic|background|references|awards|certifications?|languages?|interests|volunteer|skills?|contact|address|phone|email|portfolio|linkedin|github|engineer|developer|manager|analyst|designer|consultant|specialist|technician|scientist|administrator|coordinator|director|officer|nurse|teacher|accountant|sales|marketing|customer|service|assistant|senior|junior|professional|graduate|bachelor|master|street|road|avenue|boulevard|lane|city|country|university|college|inc|ltd)\b/i;
  const locations = /^(?:new york|san francisco|los angeles|united states|united kingdom|south africa|new zealand|saudi arabia|hong kong|abu dhabi|rio de janeiro)$/i;
  for (const line of lines) {
    const explicit = line.match(/^(?:full\s+)?name\s*:\s*(.+)$/i);
    const candidate = (explicit?.[1] ?? line.split(/[|•]/)[0]).trim();
    if (candidate.length > 65 || excluded.test(candidate) || locations.test(candidate) || detectSkills(candidate).length) continue;
    // Unlabelled one-word headings and contact/address lines are deliberately not names.
    if (/^[\p{L}\p{M}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}\p{M}][\p{L}\p{M}'’.-]*){1,4}$/u.test(candidate)) return candidate;
  }
  return '';
}

function explicitExperience(text: string): number | null {
  const patterns = [
    /(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\s+(?:(?:of|professional|relevant|practical|hands-on|industry|work|working)\s+){0,4}(?:experience|exp)\b/gi,
    /\b(?:professional\s+|work\s+)?experience\s*[:—-]?\s*(?:of\s+)?(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/gi,
  ];
  const values = patterns.flatMap(pattern => [...text.matchAll(pattern)].map(match => Number(match[1]))).filter(value => value >= 0 && value <= 80);
  // Separate job dates or time spent at individual employers are not summed.
  return values.length ? Math.max(...values) : null;
}

export function analyzeResume(text: string, filename: string): ResumeProfile {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const skills = detectSkills(normalized);
  const yearsExperience = explicitExperience(normalized);
  const summary = [
    skills.length ? `${skills.length} recognized skill keywords: ${skills.slice(0, 6).join(', ')}${skills.length > 6 ? ', and more' : ''}.` : 'No recognized skill keywords found. Add clear skill names and relevant experience to improve matching.',
    yearsExperience === null ? 'Experience duration was not explicitly stated.' : `The resume explicitly mentions ${yearsExperience} years of experience.`,
  ].join(' ');
  return { name: extractName(normalized), text: normalized, skills, yearsExperience, summary, filename };
}

export function rankJob(profile: ResumeProfile, job: Job): Job {
  const requested = detectSkills([job.title, job.description, ...job.tags].join('\n'));
  const profileSkills = new Set(profile.skills);
  const matchedSkills = requested.filter(skill => profileSkills.has(skill));
  const missingSkills = requested.filter(skill => !profileSkills.has(skill));
  const score = requested.length ? Math.round(matchedSkills.length / requested.length * 100) : 0;
  const matchExplanation = requested.length
    ? `${matchedSkills.length} of ${requested.length} recognized listing skill keywords also appear in your resume (${score}% keyword coverage). This is a keyword comparison, not a hiring probability. Review the full listing for qualifications, location and eligibility.`
    : 'No recognized skill keywords were found in this listing. A keyword score cannot assess fit; review the full role and requirements.';
  return { ...job, score, matchedSkills, missingSkills, matchExplanation };
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function resumeEvidence(text: string, matched: string[]): string | null {
  let inEvidenceSection = false;
  let inOtherSection = false;
  const candidates: Array<{ text: string; relevance: number }> = [];
  for (const original of text.split('\n')) {
    const line = original.trim().replace(/^[•*–-]\s+/, '');
    const evidenceHeading = line.match(/^(?:professional\s+|work\s+)?(?:experience|employment|work history|projects?|volunteer work)\s*:?\s*$/i);
    if (evidenceHeading) { inEvidenceSection = true; inOtherSection = false; continue; }
    if (/^(?:skills?|education|contact|certifications?|languages?|summary|objective|personal information)\s*:?\s*$/i.test(line)) {
      inEvidenceSection = false; inOtherSection = true; continue;
    }
    if (inOtherSection) continue;
    const statement = line.replace(/^(?:experience|project)\s*:\s*/i, '');
    for (const sentence of statement.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      if (sentence.length < 18 || sentence.length > 350 || sentence.split(/\s+/).length < 4) continue;
      if (!/^(?:I\s+)?(?:built|developed|implemented|designed|managed|led|created|supported|delivered|maintained|prepared|assisted|coordinated|organized|organised|analyzed|analysed|conducted|taught|trained|served|provided|operated|repaired|installed|improved|reduced|increased|processed|handled|supervised|collaborated|worked)\b/i.test(sentence)) continue;
      if (/@|https?:\/\/|www\.|\b(?:phone|telephone|email|address|birth|nationality|contact|passport|marital|age|street|road)\b/i.test(sentence)) continue;
      const overlap = detectSkills(sentence).filter(skill => matched.includes(skill)).length;
      candidates.push({ text: sentence, relevance: overlap * 10 + (inEvidenceSection ? 1 : 0) });
    }
  }
  candidates.sort((a, b) => b.relevance - a.relevance);
  return candidates[0]?.text ?? null;
}

export function buildCareerKit(profile: ResumeProfile, job: Job): CareerKit {
  // Recompute so guidance stays consistent even when a caller passes an unranked listing.
  const ranked = rankJob(profile, job);
  const matched = ranked.matchedSkills.slice(0, 5);
  const missing = ranked.missingSkills.slice(0, 6);
  const suggestions: Suggestion[] = [];
  if (matched.length) {
    suggestions.push({ kind: 'evidence', title: `Show evidence for ${list(matched)}`, detail: `For ${job.title}, highlight a real responsibility or project that demonstrates ${list(matched)}. Write an action, the context and the result. Add numbers only when you can verify them; a keyword by itself does not demonstrate proficiency.` });
  } else {
    suggestions.push({ kind: 'evidence', title: 'Check fit before tailoring', detail: `No recognized skill keywords overlap with ${job.title}. Read the requirements and identify any relevant work, education or transferable experience you can honestly demonstrate. A low keyword score does not rule out a suitable role.` });
  }
  if (missing.length) {
    suggestions.push({ kind: 'skills', title: 'Review skills not detected in your resume', detail: `This listing mentions ${list(missing)}. If you already have these skills, add accurate examples using the employer's terminology. If you do not, do not add them as qualifications; consider learning them or asking which are essential. Keyword detection can miss equivalent experience.` });
  }
  suggestions.push({ kind: 'structure', title: `Tailor your opening to ${job.title}`, detail: `Use a short opening focused on ${job.title} at ${job.company}. Connect the employer's priorities to your actual experience. Keep clear headings for experience, skills and education, and make contact details easy to find. Verify dates, qualifications and every claim before sending.` });
  if (!/\b(?:experience|employment|work history|projects)\b/i.test(profile.text)) {
    suggestions.push({ kind: 'structure', title: 'Add a clear experience or projects section', detail: 'Describe work, volunteering, study or personal projects that you actually completed. Include your role and relevant responsibilities so a reviewer can see evidence beyond a skills list.' });
  }

  const connection = matched.length
    ? `My resume lists ${list(matched)}, which also appear in your job listing. I would welcome the opportunity to discuss the examples in my resume and how they relate to the responsibilities of this role.`
    : 'I have attached my resume for your review. I would welcome the opportunity to discuss my background and understand whether it meets the requirements of this role.';
  const evidence = resumeEvidence(profile.text, matched);
  const evidenceParagraph = evidence ? `\n\nOne example recorded in my resume is: “${evidence}”` : '';
  const signature = profile.name || '[Your name]';
  const coverLetter = `Dear Hiring Team,\n\nI am applying for the ${job.title} position at ${job.company}.\n\n${connection}${evidenceParagraph}\n\nI am interested in learning more about your team and its priorities. Thank you for considering my application. I would be happy to provide further information or discuss the position.\n\nKind regards,\n${signature}`;
  const applicationSteps = [
    `Open the original ${job.source} listing for ${job.title} at ${job.company}: ${job.url}. Confirm the role is still open and check the employer and application destination.`,
    `Read the complete requirements. Confirm location (${job.location || 'check the listing'}), work authorization, schedule and any required qualifications directly with the employer if unclear.`,
    'Tailor your resume with the recommendations above. Keep qualifications and experience accurate; explain transferable experience where relevant.',
    'Review this cover letter draft and add one specific, truthful example and a reason this employer interests you. Add contact information only if the application requires it.',
    'Apply through the original listing or employer careers page. Answer screening questions honestly, upload the requested files and save the confirmation and date in your application tracker.',
    'If no timeline is given, follow up after 5–7 business days using the template below. Follow the employer’s contact instructions and stop if they ask for no follow-ups.',
  ];
  const followUp = `Send after 5–7 business days from applying, unless the listing gives a different timeline. Replace placeholders and verify that you have applied before sending.\n\nSubject: Follow-up on my ${job.title} application\n\nDear Hiring Team,\n\nI applied for the ${job.title} position at ${job.company} on [application date]. I remain interested in the role and wanted to ask whether you can share the expected next steps or timeline. Please let me know if you need any additional information from me.\n\nThank you for your time.\n\nKind regards,\n${signature}`;
  const questions = [
    `What would success look like in the first three months for the ${job.title} role?`,
    matched.length ? `How does the team use ${list(matched.slice(0, 2))} in day-to-day work?` : 'Which qualifications are essential, and which can be learned on the job?',
    missing.length ? `What level of proficiency in ${list(missing.slice(0, 2))} is needed from day one, and is training available?` : 'What training or onboarding support is available?',
    'What are the interview stages and expected hiring timeline?',
    'Can you clarify the location, working arrangement and any work authorization requirements?',
  ];
  return { suggestions, coverLetter, applicationSteps, followUp, questions };
}
