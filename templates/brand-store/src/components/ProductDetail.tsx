import type { Product } from '../data/products';
import { money } from '../data/products';
import { ProductArt } from './ProductArt';

export function ProductDetail({ product, add }: { product: Product; add: (product: Product) => void }) {
  return <div className="detail-body"><div className="detail-art"><ProductArt product={product} /></div><p className="eyebrow">{product.category.name}</p><h3>{product.title}</h3><p className="detail-price">{money(product.price)}</p><p>{product.description}</p><button className="primary-button" onClick={() => add(product)}>Add to bag</button><p className="fine-print">Sample merchandise. No purchase or delivery service.</p></div>;
}
