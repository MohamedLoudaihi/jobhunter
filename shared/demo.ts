import type { Job } from './types';

/** Fictional examples to explore the product; never returned by the live search API. */
export const SAMPLE_RESUME = `Alex Morgan
Frontend Developer
alex@example.com

SUMMARY
Frontend developer with 3 years of experience building accessible web applications with React, TypeScript, JavaScript, HTML, and CSS. Interested in thoughtful product teams and remote work.

EXPERIENCE
Frontend Developer — Example Digital Studio
2023–2026
Built React interfaces and reusable components for customer dashboards.
Integrated REST APIs and worked with designers in Figma to improve usability.
Added automated tests and documented components with the engineering team.
Collaborated using Git and Agile practices.

SKILLS
React, TypeScript, JavaScript, HTML, CSS, REST APIs, Git, Figma, Accessibility, Testing, Agile

EDUCATION
Bachelor of Science in Computer Science

LANGUAGES
English, French`;

const base: Omit<Job, 'id'|'title'|'company'|'location'|'description'|'tags'> = {
  countries: ['WORLDWIDE'], remote: true, employmentType: 'full-time', url: 'https://example.com',
  source: 'Demo', publishedAt: null, salary: null, score: 0,
  matchedSkills: [], missingSkills: [], matchExplanation: '',
};
export const DEMO_JOBS: Job[] = [
  {...base, id: 'demo-frontend', title: 'Frontend Developer', company: 'Northstar Studio', location: 'Worldwide · Remote',
    tags: ['React', 'TypeScript', 'Accessibility'],
    description: 'FICTIONAL EXAMPLE — not an open vacancy.\n\nHelp a small product team build accessible customer-facing tools. You will create React and TypeScript components, integrate REST APIs, and collaborate with designers in Figma.\n\nRequirements: React, TypeScript, JavaScript, HTML, CSS, Git, accessibility, and testing. Three years of frontend experience preferred.\n\nApplication: submit a résumé, a short cover letter, and a portfolio link. We value clear communication and thoughtful implementation.'},
  {...base, id: 'demo-product', title: 'Product Engineer', company: 'Fieldwork', location: 'Worldwide · Remote',
    tags: ['TypeScript', 'Node.js', 'PostgreSQL'],
    description: 'FICTIONAL EXAMPLE — not an open vacancy.\n\nBuild practical software for growing teams. Work across React interfaces, TypeScript services, and Node.js APIs backed by PostgreSQL.\n\nRequirements: React, TypeScript, JavaScript, Node.js, SQL, PostgreSQL, Git, testing, Agile. Familiarity with Docker is useful.\n\nApply with your résumé and a note describing a project you helped deliver.'},
  {...base, id: 'demo-ui', title: 'UI Developer', company: 'Goodform', location: 'Worldwide · Remote',
    tags: ['HTML', 'CSS', 'Figma'],
    description: 'FICTIONAL EXAMPLE — not an open vacancy.\n\nTurn Figma designs into responsive, accessible web experiences. Maintain a design system and collaborate closely with a product designer.\n\nRequirements: HTML, CSS, JavaScript, React, Figma, accessibility, Git. Experience with design systems and Tailwind CSS is a plus.\n\nSend your résumé and links to relevant interface work.'},
];
