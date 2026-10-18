import React, { useState } from 'react';
import siteConfig from '../data/siteConfig';

export default function Contact() {
  const [status, setStatus] = useState('');
  const { contact } = siteConfig;
  async function copyEmail() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(contact.email);
      setStatus('Sample address copied. Replace it before publishing.');
    } catch {
      setStatus(`Copy unavailable here. Select the sample address manually: ${contact.email}`);
    }
  }
  return <section id="contact" className="py-20 px-6 md:px-20 bg-dark-bg text-white min-h-[60vh] flex items-center relative">
    <div aria-hidden="true" className="absolute bottom-0 right-0 w-full h-1/2 bg-gradient-to-t from-fluo/5 to-transparent pointer-events-none" />
    <div className="max-w-5xl mx-auto w-full relative"><div className="grid md:grid-cols-2 gap-10 md:gap-16">
      <h2 className="font-display text-[clamp(2.5rem,9vw,5rem)] md:text-8xl font-bold leading-tight">{contact.headline.split('\n').map(line => <React.Fragment key={line}>{line}<br /></React.Fragment>)}</h2>
      <div className="flex flex-col justify-center space-y-6">
        <p className="text-base sm:text-lg md:text-xl text-gray-300">{contact.subhead}</p>
        <p className="font-display text-xl text-fluo select-all">{contact.email}</p>
        <p className="text-gray-400 text-sm leading-relaxed">Sample contact address. This local preview sends no messages. Replace it with your own address before publishing; no contact service or resume is connected.</p>
        <div><button type="button" onClick={copyEmail} className="portfolio-button">Copy sample email</button><p role="status" className="text-sm text-gray-300 mt-3 min-h-[3rem]">{status}</p></div>
      </div>
    </div></div>
  </section>;
}
