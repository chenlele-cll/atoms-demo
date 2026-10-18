export const categories = ['All', 'Clothes', 'Electronics', 'Furniture', 'Toys', 'Others'] as const;
export type Category = typeof categories[number];
export type Product = {
  id: number;
  title: string;
  price: number;
  category: { name: Category };
  description: string;
  color: string;
  shape: 'shirt' | 'headphones' | 'chair' | 'blocks' | 'bag' | 'lamp';
};
export type CartLine = { product: Product; quantity: number };
export const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

// Original local fixtures replace the upstream's mutable remote API catalog.
export const products: Product[] = [
  { id: 1, title: 'Everyday cotton tee', price: 32, category: { name: 'Clothes' }, description: 'A relaxed everyday silhouette in soft cotton. Sample product for exploring the collection.', color: '#b9c5aa', shape: 'shirt' },
  { id: 2, title: 'Studio headphones', price: 129, category: { name: 'Electronics' }, description: 'Over-ear headphones with a simple, comfortable profile. Illustrative specifications only.', color: '#d6b397', shape: 'headphones' },
  { id: 3, title: 'Arc lounge chair', price: 245, category: { name: 'Furniture' }, description: 'An easy chair with a curved back and warm wood frame. A sample piece for a quiet corner.', color: '#bc8c66', shape: 'chair' },
  { id: 4, title: 'Little building blocks', price: 28, category: { name: 'Toys' }, description: 'A playful collection of colorful geometric blocks. Sample illustration, not a safety-certified toy listing.', color: '#d4aa65', shape: 'blocks' },
  { id: 5, title: 'Market canvas tote', price: 24, category: { name: 'Others' }, description: 'A simple carryall for everyday essentials. Locally illustrated sample merchandise.', color: '#d3c3a0', shape: 'bag' },
  { id: 6, title: 'Orbit table lamp', price: 78, category: { name: 'Furniture' }, description: 'A sculptural little light for your desk or bedside. Sample product; no electrical specifications implied.', color: '#97aaa2', shape: 'lamp' },
  { id: 7, title: 'Weekend cotton tee', price: 36, category: { name: 'Clothes' }, description: 'An easy layering piece in a warm clay shade. Sample size and color are illustrative.', color: '#c98f7e', shape: 'shirt' },
  { id: 8, title: 'Travel headphones', price: 95, category: { name: 'Electronics' }, description: 'A compact over-ear silhouette for the daily journey. Local sample catalog item.', color: '#8999ab', shape: 'headphones' },
];
