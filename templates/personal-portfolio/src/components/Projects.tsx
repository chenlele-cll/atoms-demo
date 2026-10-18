import React, { useRef, useState } from 'react';
import { projects, type Project } from '../data/siteConfig';

const filters = ['All', 'Frontend', 'Data', 'AI'] as const;

export default function Projects() {
  const [filter, setFilter] = useState<typeof filters[number]>('All');
  const [selected, setSelected] = useState<Project | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const visible = projects.filter(project => filter === 'All' || project.category === filter);
  const close = () => { dialog.current?.close(); };

  return <section id="projects" className="py-24 px-4 sm:px-6 md:px-20 bg-dark-bg text-white">
    <div className="max-w-7xl mx-auto">
      <h2 className="section-title">PROJECTS</h2>
      <p className="text-gray-400 mb-8">Selected template examples. Explore details locally; source links open external websites.</p>
      <div role="group" aria-label="Filter projects" className="flex flex-wrap gap-3 mb-6">{filters.map(value => <button key={value} type="button" aria-pressed={filter === value} className="portfolio-button filter-button" onClick={() => setFilter(value)}>{value}</button>)}</div>
      <p aria-live="polite" className="font-mono text-xs text-gray-400 mb-6">{visible.length} {visible.length === 1 ? 'project' : 'projects'}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{visible.map(project => <article key={project.title} className="group relative bg-dark-secondary/40 p-6 sm:p-7 md:p-8 border border-gray-800 hover:border-fluo transition-colors">
        <div className="space-y-4">
          <h3 className="font-display text-xl sm:text-2xl md:text-3xl font-bold group-hover:text-fluo">{project.title}</h3>
          <p className="font-mono text-xs uppercase tracking-widest text-gray-400">{project.stack}</p>
          <p className="text-gray-400 text-sm sm:text-base leading-relaxed">{project.summary}</p>
          <button type="button" className="portfolio-button" aria-haspopup="dialog" onClick={event => {
            trigger.current = event.currentTarget; setSelected(project); dialog.current?.showModal();
          }}>View details<span className="sr-only">: {project.title}</span></button>
        </div>
      </article>)}</div>
      <dialog ref={dialog} aria-labelledby="project-title" aria-describedby="project-description" className="project-dialog" onClose={() => { setSelected(null); trigger.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
        {selected && <div className="p-6 sm:p-10 space-y-6">
          <p className="font-mono text-xs text-fluo uppercase tracking-widest">{selected.category} / Template example</p>
          <h3 id="project-title" className="font-display text-3xl sm:text-4xl">{selected.title}</h3>
          <p className="font-mono text-sm text-gray-400">{selected.stack}</p>
          <p id="project-description" className="text-gray-300 leading-relaxed">{selected.details}</p>
          {selected.source && <a className="portfolio-button" href={selected.source} target="_blank" rel="noopener noreferrer">Upstream source (external)</a>}
          <button type="button" autoFocus className="portfolio-button block" onClick={close}>Close details</button>
        </div>}
      </dialog>
    </div>
  </section>;
}
