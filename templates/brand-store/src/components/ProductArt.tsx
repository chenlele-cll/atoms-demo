import type { Product } from '../data/products';

export function ProductArt({ product }: { product: Product }) {
  return <svg viewBox="0 0 320 280" role="img" aria-label={`Illustration of ${product.title}`}>
    <ellipse cx="160" cy="241" rx="92" ry="10" fill="#000" opacity=".06" />
    <g fill={product.color} stroke="#353a34" strokeWidth="3" strokeLinejoin="round">
      {product.shape === 'shirt' && <><path d="M122 57 80 78 54 126 92 144 109 120 109 229 211 229 211 120 228 144 266 126 240 78 198 57Q160 84 122 57Z" /><path d="M139 64Q160 99 181 64M118 216H202" fill="none" opacity=".45" /></>}
      {product.shape === 'headphones' && <><path d="M86 162V125a74 74 0 0 1 148 0v37h-19v-37a55 55 0 0 0-110 0v37Z" /><rect x="75" y="143" width="43" height="81" rx="18" /><rect x="202" y="143" width="43" height="81" rx="18" /><path d="M105 158V208M215 158V208" fill="none" opacity=".4" /></>}
      {product.shape === 'chair' && <><path d="M100 157 88 236M219 157 232 236" fill="none" strokeWidth="10" /><rect x="93" y="64" width="134" height="107" rx="31" /><path d="M89 151Q160 177 231 151L235 183Q160 206 85 183Z" /><path d="M115 86V143M205 86V143" fill="none" opacity=".3" /></>}
      {product.shape === 'blocks' && <><rect x="71" y="163" width="66" height="66" rx="4" /><rect x="147" y="163" width="66" height="66" rx="4" fill="#a6b6a0" /><path d="m142 83 44 70H98Z" fill="#cb9280" /><circle cx="226" cy="133" r="31" fill="#98aabd" /></>}
      {product.shape === 'bag' && <><path d="M98 107H222L237 230H83Z" /><path d="M129 124V86a31 31 0 0 1 62 0v38" fill="none" strokeWidth="9" /><path d="M140 169H180M148 181H172" fill="none" opacity=".45" /></>}
      {product.shape === 'lamp' && <><path d="M153 136H167V227H153Z" /><path d="M91 230Q160 210 229 230v8H91Z" /><path d="M105 61H215L250 150H70Z" /><path d="M122 75 103 133" fill="none" opacity=".35" /></>}
    </g>
  </svg>;
}
