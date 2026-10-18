import { categories } from '../data/products';
import type { Category } from '../data/products';

export function Navbar({ category, setCategory, count, openCart }: {
  category: Category; setCategory: (category: Category) => void; count: number; openCart: () => void;
}) {
  return <header className="site-header">
    <div className="header-top"><a className="brand" href="#collection" onClick={() => setCategory('All')}>Shopi<span className="brand-dot">.</span></a><span className="header-note">Considered goods. Everyday living.</span>
      <button className="cart-button" onClick={openCart}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 7h14l1 14H4L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></svg>Bag <span className="cart-count">{count}</span></button>
    </div>
    <nav aria-label="Product categories">{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</nav>
  </header>;
}
