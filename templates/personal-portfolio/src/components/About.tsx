import React from 'react';
import siteConfig from '../data/siteConfig';

export default function About() {
  const { about } = siteConfig;
  return <section id="about" className="py-20 px-6 md:px-20 bg-dark-bg text-white relative overflow-hidden">
    <div aria-hidden="true" className="absolute left-6 md:left-20 top-0 bottom-0 w-px bg-gray-800" />
    <div className="max-w-4xl mx-auto relative z-10 pl-8 md:pl-0">
      <h2 className="font-display text-[clamp(2.25rem,8vw,4rem)] md:text-7xl font-bold mb-10 md:mb-12">{about.headline.primary}<br /><span className="text-fluo">{about.headline.accent}</span></h2>
      <div className="grid md:grid-cols-2 gap-10 md:gap-12">
        <div>{about.bio.map(text => <p key={text} className="text-gray-300 text-base sm:text-lg leading-relaxed mb-6">{text}</p>)}</div>
        <div><h3 className="font-display text-lg sm:text-xl mb-6 tracking-widest border-b border-gray-700 pb-2">CORE SKILLS</h3>
          <ul className="grid grid-cols-1 gap-4">{about.skills.map(skill => <li key={skill} className="flex items-center group"><span aria-hidden="true" className="w-2 h-2 shrink-0 bg-fluo mr-4 rounded-full" /><span className="text-base sm:text-lg group-hover:text-fluo">{skill}</span></li>)}</ul>
        </div>
      </div>
    </div>
  </section>;
}
