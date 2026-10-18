import React, { useEffect, useRef, useState } from 'react';
import siteConfig from '../data/siteConfig';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setIsOpen(false); toggle.current?.focus(); }
    };
    const media = window.matchMedia('(min-width: 768px)');
    const resize = (event: MediaQueryListEvent) => { if (event.matches) setIsOpen(false); };
    document.addEventListener('keydown', close);
    media.addEventListener('change', resize);
    return () => { document.removeEventListener('keydown', close); media.removeEventListener('change', resize); };
  }, [isOpen]);

  return <header className="portfolio-nav fixed top-0 left-0 w-full z-50 px-6 py-4 text-white">
    <nav aria-label="Main navigation" className="flex justify-between items-center gap-4">
      <a href="#hero" aria-label="Your Name home" onClick={() => setIsOpen(false)} className="text-2xl font-bold font-display tracking-tighter">{siteConfig.branding.initials}<span className="text-fluo">.</span></a>
      <button ref={toggle} type="button" className="md:hidden menu-toggle" aria-expanded={isOpen} aria-controls="portfolio-links" onClick={() => setIsOpen(!isOpen)}>{isOpen ? 'CLOSE' : 'MENU'} <span aria-hidden="true">{isOpen ? '\u00d7' : '\u2630'}</span></button>
      <div id="portfolio-links" className={`${isOpen ? 'flex' : 'hidden'} mobile-links md:flex gap-6 font-display text-sm tracking-widest`}>
        {siteConfig.navigation.map(item => <a key={item.href} href={item.href} onClick={() => setIsOpen(false)} className="hover:text-fluo">{item.title}</a>)}
        <a href="#contact" onClick={() => setIsOpen(false)} className="hire-link bg-fluo text-black px-6 py-2 font-bold">HIRE ME</a>
      </div>
    </nav>
  </header>;
}
