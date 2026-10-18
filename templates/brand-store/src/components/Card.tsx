import type { Product } from '../data/products';
import { money } from '../data/products';
import { ProductArt } from './ProductArt';

export function Card({ data, inCart, showProduct, addProductsToCart }: {
  data: Product; inCart: boolean; showProduct: (product: Product) => void; addProductsToCart: (product: Product) => void;
}) {
  return <article className="product-card">
    <div className="product-image">
      <button className="art-button" onClick={() => showProduct(data)} aria-label={`View ${data.title}`}><ProductArt product={data} /></button>
      <span className="category-label">{data.category.name}</span>
      <button className="add-button" onClick={() => addProductsToCart(data)} aria-label={`Add ${data.title} to cart`}><span aria-hidden="true">{inCart ? '\u2713' : '+'}</span></button>
    </div>
    <div className="product-caption"><button onClick={() => showProduct(data)}>{data.title}</button><span>{money(data.price)}</span></div>
  </article>;
}
