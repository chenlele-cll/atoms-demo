export type Project = {
  title: string;
  category: 'Frontend' | 'Data' | 'AI';
  stack: string;
  summary: string;
  details: string;
  source?: string;
};

export const projects: Project[] = [
  {
    title: 'Portfolio Template', category: 'Frontend', stack: 'React, Vite, Tailwind',
    summary: 'Responsive portfolio template with clean sections and a bold visual identity.',
    details: 'This local adaptation of the upstream portfolio demonstrates responsive navigation, project filtering, and project details. The original template also includes animation and a resume download; this preview omits those integrations.',
    source: 'https://github.com/veldig/react-engineer-portfolio',
  },
  {
    title: 'Product Analytics Dashboard', category: 'Data', stack: 'Node.js, Postgres, D3.js',
    summary: 'End-to-end analytics pipeline with interactive dashboards for leadership insights.',
    details: 'Sample project description from the upstream template. It illustrates an analytics pipeline and leadership dashboards. No dashboard application, production data, or external demo is included in this portfolio snapshot.',
  },
  {
    title: 'AI-Assist Knowledge Base', category: 'AI', stack: 'Python, FastAPI, Vector DB',
    summary: 'LLM-powered internal search experience that reduces support triage time.',
    details: 'Sample project description from the upstream template. It illustrates internal knowledge search and support triage. No model endpoint, vector database, or working knowledge-base service is connected.',
  },
];

const siteConfig = {
  branding: {
    name: 'Your Name', firstName: 'Your', lastName: 'Name', initials: 'YN',
    roleLabel: 'SOFTWARE ENGINEER', location: 'Your City, Country', established: '2026',
  },
  navigation: [
    { title: 'HOME', href: '#hero' }, { title: 'ABOUT', href: '#about' },
    { title: 'EXPERIENCE', href: '#experience' }, { title: 'PROJECTS', href: '#projects' },
    { title: 'CONTACT', href: '#contact' },
  ],
  hero: { subtitle: 'Backend systems - AI orchestration - Product-minded' },
  about: {
    headline: { primary: 'ENGINEER.', accent: 'BUILDER.' },
    bio: [
      'Backend-focused software engineer with strong foundations in object-oriented programming and scalable system design. I specialize in building high-performance applications and developing large-scale data workflows in cloud environments.',
      'Passionate about engineering reliable AI systems that solve complex problems. Add your education, impact metrics, and specialties here.',
    ],
    skills: ['Java / Python / C++', 'FastAPI / Django', 'AWS / Docker / K8s', 'React / TypeScript', 'PostgreSQL / SQL', 'LLM Orchestration'],
  },
  experience: [
    {
      title: 'Senior Software Engineer', org: 'Company Name', dates: '2023 - Present',
      bullets: [
        'Owned backend platform reliability for a multi-tenant SaaS product serving 100k+ users.',
        'Designed event-driven workflows to automate onboarding and reduce manual ops by 40%.',
        'Partnered with product and design to ship three high-impact features in one quarter.',
      ],
    },
    {
      title: 'Software Engineer', org: 'Startup Name', dates: '2021 - 2023',
      bullets: [
        'Built an internal analytics dashboard for cross-functional stakeholders.',
        'Implemented CI/CD pipelines and infrastructure-as-code for rapid deployments.',
        'Improved API response times by 35% through caching and query optimization.',
      ],
    },
  ],
  contact: {
    headline: "LET'S\nTALK", subhead: 'Open to software engineering opportunities and focused collaborations.',
    email: 'hello@example.com',
  },
};

export default siteConfig;
