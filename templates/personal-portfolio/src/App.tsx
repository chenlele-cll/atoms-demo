import React, { useEffect } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import About from './components/About';
import Experience from './components/Experience';
import Projects from './components/Projects';
import Contact from './components/Contact';
import Footer from './components/Footer';

export default function App() {
  useEffect(() => { document.title = 'Your Name | Portfolio Template'; }, []);
  return <div className="bg-dark-bg min-h-screen text-white selection:bg-fluo selection:text-black font-sans">
    <a className="skip-link" href="#projects">Skip to projects</a>
    <Navbar />
    <main><Hero /><About /><Experience /><Projects /><Contact /></main>
    <Footer />
  </div>;
}
