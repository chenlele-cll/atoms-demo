import React from 'react';
import headshot from '../assets/headshot-placeholder.svg';
import topo from '../assets/topo-pattern.svg';
import siteConfig from '../data/siteConfig';

export default function Hero() {
  const { branding, hero } = siteConfig;
  return <section id="hero" className="relative min-h-[100svh] w-full flex flex-col justify-center items-center overflow-hidden pt-28 pb-24">
    <div aria-hidden="true" className="absolute inset-0 opacity-30 pointer-events-none" style={{ backgroundImage: `url(${topo})` }} />
    <div aria-hidden="true" className="absolute top-1/4 left-1/4 w-96 h-96 bg-fluo rounded-full blur-[150px] opacity-20 pointer-events-none" />
    <div className="relative z-10 w-full max-w-6xl px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-[1fr_auto] items-center gap-10 lg:gap-16">
      <div className="text-center lg:text-left">
        <p className="text-fluo tracking-[0.3em] text-xs sm:text-sm md:text-base mb-4">{branding.roleLabel}</p>
        <h1 className="font-display text-[clamp(2.75rem,10vw,5.5rem)] sm:text-[clamp(3.5rem,9vw,6.5rem)] lg:text-9xl font-bold leading-[0.95] tracking-tighter">{branding.firstName}<br /><span className="text-outline">{branding.lastName}</span></h1>
        <p className="mt-4 text-gray-300 text-sm sm:text-base tracking-wide">{hero.subtitle}</p>
        <div aria-hidden="true" className="mt-8 flex flex-col items-center lg:items-start"><div className="w-px h-24 bg-gradient-to-b from-fluo to-transparent" /></div>
      </div>
      <div className="mx-auto lg:mx-0">
        <div className="w-[200px] sm:w-[240px] md:w-[300px] lg:w-[360px] aspect-[3/4] overflow-hidden rounded-[10px] bg-dark-secondary/40 ring-2 ring-fluo/20 shadow-lg">
          <img src={headshot} alt="Headshot placeholder: replace with your own portrait" width="360" height="450" className="w-full h-full object-cover object-[70%_32%] scale-[1.08] brightness-[0.95] contrast-[1.06] saturate-[0.92]" />
        </div>
      </div>
    </div>
    <div className="absolute bottom-8 left-10 font-mono text-xs text-gray-400 hidden md:block">EST. {branding.established}<br />LOC: {branding.location}</div>
    <a href="#about" className="absolute bottom-6 right-10 font-mono text-xs text-gray-400 hidden md:flex items-center text-right">SCROLL<br />TO EXPLORE</a>
  </section>;
}
