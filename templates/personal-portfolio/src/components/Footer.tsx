import React from 'react';
import siteConfig from '../data/siteConfig';

export default function Footer() {
  return <footer className="bg-dark-bg py-8 px-6 border-t border-gray-800 flex flex-col md:flex-row justify-between items-start gap-6 text-gray-400 font-mono text-xs">
    <div className="space-y-3"><p>Portfolio template / {siteConfig.branding.name} / EST. {siteConfig.branding.established}</p><p>Adapted from Martin Vizcaino's MIT-licensed react-engineer-portfolio.</p></div>
    <a href="https://github.com/veldig/react-engineer-portfolio" target="_blank" rel="noopener noreferrer" className="hover:text-fluo">UPSTREAM SOURCE (EXTERNAL)</a>
    <a href="#hero" className="hover:text-fluo">BACK TO TOP</a>
  </footer>;
}
