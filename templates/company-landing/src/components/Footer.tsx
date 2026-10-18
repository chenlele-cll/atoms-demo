import { LogoIcon } from "./Icons";

export const Footer = () => {
  return (
    <footer id="footer">
      <hr className="w-11/12 mx-auto" />
      <section className="container py-20 grid md:grid-cols-3 gap-8">
        <div>
          <a href="#top" className="font-bold text-xl flex items-center"><LogoIcon />Shadcn / React</a>
          <p className="text-muted-foreground mt-4">Template demonstration · MIT licensed</p>
        </div>
        <nav aria-label="Footer navigation" className="flex flex-col gap-2">
          <h3 className="font-bold text-lg">Explore the template</h3>
          <a href="#features">Features</a>
          <a href="#pricing">Sample pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div>
          <h3 className="font-bold text-lg">Demonstration content</h3>
          <p className="text-muted-foreground mt-4">Plans, people and testimonials are samples. Registration, payments, subscriptions and message delivery are not connected.</p>
        </div>
      </section>
      <section className="container pb-14 text-center">
        <p>&copy; 2024 Landing page made by Leo Miranda. Source and license are available on the surrounding template page.</p>
      </section>
    </footer>
  );
};
