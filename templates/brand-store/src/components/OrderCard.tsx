import type { CartLine } from '../data/products';
import { money } from '../data/products';
import { ProductArt } from './ProductArt';

export function OrderCard({ line, changeQuantity, handleDelete }: { line: CartLine; changeQuantity: (id: number, delta: number) => void; handleDelete: (id: number) => void }) {
  const { product, quantity } = line;
  return <li className="order-card">
    <div className="order-art"><ProductArt product={product} /></div>
    <div className="order-info"><h3>{product.title}</h3><p>{money(product.price)} each</p>
      <div className="quantity"><button aria-label={`Decrease ${product.title} quantity`} disabled={quantity <= 1} onClick={() => changeQuantity(product.id, -1)}>-</button><output aria-label={`${product.title} quantity`}>{quantity}</output><button aria-label={`Increase ${product.title} quantity`} disabled={quantity >= 99} onClick={() => changeQuantity(product.id, 1)}>+</button></div>
    </div>
    <div className="order-actions"><strong>{money(product.price * quantity)}</strong><button className="text-button" onClick={() => handleDelete(product.id)} aria-label={`Remove ${product.title}`}>Remove</button></div>
  </li>;
}
