import type { CartLine } from '../data/products';
import { money } from '../data/products';
import { OrderCard } from './OrderCard';

export function CheckoutSideMenu({ lines, changeQuantity, handleDelete, close }: { lines: CartLine[]; changeQuantity: (id: number, delta: number) => void; handleDelete: (id: number) => void; close: () => void }) {
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  return <><div className="cart-body">{lines.length ? <ul>{lines.map(line => <OrderCard key={line.product.id} line={line} changeQuantity={changeQuantity} handleDelete={handleDelete} />)}</ul> : <div className="empty-cart"><p>Your bag is waiting.</p><p>Add something from the collection to get started.</p><button className="primary-button" onClick={close}>Explore the collection</button></div>}</div>
    <div className="cart-summary"><div><span>Subtotal</span><strong data-testid="subtotal">{money(total)}</strong></div><p className="fine-print">Local demo only. No checkout, payment, shipping or order placement. Your bag resets when this preview reloads.</p><button className="primary-button" onClick={close}>Continue browsing</button></div></>;
}
