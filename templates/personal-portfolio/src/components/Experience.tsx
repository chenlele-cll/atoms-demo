import React from 'react';
import siteConfig from '../data/siteConfig';

export default function Experience() {
  return <section id="experience" className="py-24 px-4 sm:px-6 md:px-20 bg-dark-bg text-white">
    <div className="max-w-7xl mx-auto">
      <h2 className="section-title">EXPERIENCE</h2>
      <p className="text-gray-400 mb-8 font-mono text-sm">Sample career history from the original template. Replace with your own experience.</p>
      <div className="space-y-8">{siteConfig.experience.map(exp => <article key={exp.title} className="relative border border-gray-800 bg-dark-secondary p-6 sm:p-7 md:p-10 overflow-hidden">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-fluo opacity-20" />
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-6">
          <div><h3 className="font-display text-xl sm:text-2xl md:text-3xl font-bold">{exp.title}</h3><p className="text-light-text mt-1">{exp.org}</p></div>
          <p className="font-mono text-xs tracking-widest text-gray-400 uppercase">{exp.dates}</p>
        </div>
        <ul className="list-disc pl-5 space-y-3 text-gray-300 text-sm sm:text-base leading-relaxed">{exp.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>
      </article>)}</div>
    </div>
  </section>;
}
