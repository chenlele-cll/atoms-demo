import { useState } from 'react';
import { categories, products } from './data/products';
import type { CartLine, Category, Product } from './data/products';
import { Navbar } from './components/Navbar';
import { Card } from './components/Card';
import { StorePanel } from './components/StorePanel';
import { ProductDetail } from './components/ProductDetail';
import { CheckoutSideMenu } from './components/CheckoutSideMenu';

export default function App() {
  const [searchByTitle, setSearchByTitle] = useState('');
  const [searchByCategory, setSearchByCategory] = useState<Category>('All');
  const [cartProducts, setCartProducts] = useState<CartLine[]>([]);
  const [panel, setPanel] = useState<'cart' | Product | null>(null);
  const filteredItems = products.filter(item => (searchByCategory === 'All' || item.category.name === searchByCategory) && item.title.toLowerCase().includes(searchByTitle.trim().toLowerCase()));
  const count = cartProducts.reduce((sum, line) => sum + line.quantity, 0);
  const addProductsToCart = (product: Product) => {
    setCartProducts(current => current.some(line => line.product.id === product.id)
      ? current.map(line => line.product.id === product.id ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line)
      : [...current, { product, quantity: 1 }]);
    setPanel('cart');
  };
  const changeQuantity = (id: number, delta: number) => setCartProducts(current => current.map(line => line.product.id === id ? { ...line, quantity: Math.max(1, Math.min(99, line.quantity + delta)) } : line));
  const handleDelete = (id: number) => setCartProducts(current => current.filter(line => line.product.id !== id));
  const resetFilters = () => { setSearchByTitle(''); setSearchByCategory('All'); };

  return <>
    <Navbar category={searchByCategory} setCategory={setSearchByCategory} count={count} openCart={() => setPanel('cart')} />
    <main id="collection" className="collection">
      <section className="collection-intro"><div><p className="eyebrow">THE EVERYDAY COLLECTION / 01</p><h1>Good things,<br /><span>simply chosen.</span></h1><p>A little less noise. A little more considered.<br />Discover everyday pieces for your space and yourself.</p></div><div className="collection-stamp"><span>SHOPI</span><span>Objects for<br />the everyday.</span><span>EST. 2024</span></div></section>
      <section aria-label="Product collection">
        <div className="collection-toolbar"><div><h2>{searchByCategory === 'All' ? 'All products' : searchByCategory}</h2><p role="status">{filteredItems.length} {filteredItems.length === 1 ? 'piece' : 'pieces'} in the collection</p></div><label className="search"><span className="sr-only">Search products</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg><input type="search" placeholder="Search a product" value={searchByTitle} onChange={event => setSearchByTitle(event.target.value)} /></label></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">{filteredItems.map(item => <Card key={item.id} data={item} inCart={cartProducts.some(line => line.product.id === item.id)} showProduct={setPanel} addProductsToCart={addProductsToCart} />)}</div>
        {filteredItems.length === 0 && <div className="empty-results"><h3>No pieces found</h3><p>Try another search or explore all {categories.length - 1} categories.</p><button className="primary-button" onClick={resetFilters}>Reset filters</button></div>}
      </section>
    </main>
    <footer><a className="brand" href="#collection">Shopi.</a><p>A local storefront demonstration. Sample products and prices.</p><p>Adapted from jefercort/e-commerce. MIT licensed.</p></footer>
    {panel !== null && <StorePanel title={panel === 'cart' ? `Your bag (${count})` : 'Product detail'} close={() => setPanel(null)}>{panel === 'cart' ? <CheckoutSideMenu lines={cartProducts} changeQuantity={changeQuantity} handleDelete={handleDelete} close={() => setPanel(null)} /> : <ProductDetail product={panel} add={addProductsToCart} />}</StorePanel>}
  </>;
}
