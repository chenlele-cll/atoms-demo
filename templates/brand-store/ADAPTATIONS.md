# Brand Store / Shopi

Template `brand-store`, version `1`, adapts Kevin Cortes's (@jefercort) [e-commerce](https://github.com/jefercort/e-commerce/tree/ec492d15f5614fa7f297714352e5c001f3daddd1) at full commit `ec492d15f5614fa7f297714352e5c001f3daddd1`. The original MIT [LICENSE](./LICENSE), including the 2024 copyright and attribution, is preserved verbatim. This is an adaptation of existing source, not model-generated storefront evidence.

## Provenance

[manifest.json](./manifest.json) records the selected upstream paths, their original Git blob SHA-1 and raw-byte SHA-256, and their adapted local paths. Hashes describe the original upstream bytes, not the adapted files. App, Home and Context are consolidated into `src/App.tsx`, so several upstream paths intentionally map to that file. LICENSE is the unmodified upstream file. Local fixtures, inline illustrations and StorePanel are new additions without upstream hash claims.

The selected source was inspected from a Git checkout of the pinned commit. It supplied a meaningful working starting point: Shopi navigation, category/title filtering, image/category/price cards, add-to-cart/check indicators, product-detail sidebar, cart rows, removal and subtotal. The upstream catalog itself is fetched dynamically from `api.escuelajs.co`; no upstream product dataset or product images are vendored or claimed here.

## Changes From Upstream

- Converted the selected JSX components to typed React TSX and relative imports. Consolidated context/provider, Home and routed App into one state owner. The entry uses React StrictMode, checks the root element, and imports the prepared CSS.
- Retained Shopi branding, all-category navigation, title search combined with category selection, the card grid with category tags and prices, product detail and the right-hand cart. Renamed upstream `Furnitures` to `Furniture`. Reworked the presentation into a responsive cream/olive storefront with an editorial introduction and local product illustrations; this is not a pixel-identical copy of upstream.
- Replaced the mutable external product API and external image URLs with eight original local sample records and six inline SVG illustration shapes. Titles, prices, descriptions and drawings are adaptation fixtures, not actual merchant inventory or upstream product data. The UI makes no product-data, image or font requests.
- Replaced React Router category routes with in-memory category buttons. Removed account, email, sign-in and order-history placeholders and their routes. Navigation stays within the preview and needs no router dependency.
- Preserved adding, removing, cart count and price totals; derive count and subtotal from cart lines. Added per-product quantity controls and repeat-add support, bounded to 1-99 units. Upstream allowed one unit per product and had no quantity stepper. Decrement at one is disabled; Remove deletes a line. The check indicator still permits another add.
- Removed upstream's misleading Checkout action, hardcoded order date and synthetic order creation. The cart offers Continue browsing and explicitly states that checkout, payment, shipping and order placement are unavailable.
- Replaced icon-package imports with small inline SVG or text symbols. Added semantic buttons, input labels, status text, focus outlines, 44px controls, reduced-motion styling and a native modal dialog for Escape handling, focus containment and focus return. Product detail and cart share one dialog, so they cannot overlap.
- Retained the upstream Tailwind directives and empty extension/plugin configuration, converted configuration to CommonJS, and added ordinary CSS for the adapted storefront. Responsive grid utilities are compiled by the existing preparation script. There is no Tailwind CDN or runtime style compilation.
- Runtime dependencies are only exact `react` / `react-dom` `18.3.1`. Upstream router and Heroicons dependencies are unnecessary after the above changes. No package scripts, development tools or dependencies are installed into the host by this template.

## Preparation And Limits

Call the existing exported `prepareCompanyTemplate` with an absolute `sourceDirectory` pointing here and an isolated `outputFile`. It emits `/src/main.tsx`, adapted TSX/TS, precompiled `/src/styles.css`, LICENSE and generated runtime package/HTML, validating imports, fixed dependencies, source identity, file/byte budgets and bundle digest. The shared script currently emits its generic company-landing HTML title; changing that shared script is outside this asset-only task.

Only `templates/brand-store/**` is delivered here. Catalog registration, platform routes, screenshots and integration of other selected templates belong to their respective owners. This directory does not make the template selectable in the application by itself.

Search, category, active panel and bag contents are preview-instance memory only and reset on reload. There is no storage, authentication, backend, checkout, payment, tax, shipping, stock validation or order submission. Quantity is an interface bound, not an inventory guarantee. Currency is illustrative USD. Bundler/runtime package delivery can still require network access in Sandpack even though catalog data and visuals are self-contained. Preparation proves format and stylesheet compilation; actual browser checks must be reported separately and do not establish deployment or commerce acceptance.

## Observed Verification

On 2026-10-18, preparation through the unmodified `prepareCompanyTemplate` export passed on Node 22.22.2, writing only to an approved temporary directory. The result contains 14 virtual files and 35,002 bytes of file content from 11 source files, below the 64-file and 2 MiB limits. All 12 provenance entries were checked against the pinned Git tree and SHA-256 of upstream bytes; LICENSE matched byte-for-byte.

A temporary harness compiled the prepared virtual files with esbuild, using separately installed exact React/React DOM 18.3.1. Strict TypeScript checking passed with React 18 declarations. The repository Playwright CLI drove this bundle in Google Chrome at desktop 1280x800 and mobile 375x812 sizes. Observed passing assertions covered category filtering, combined trimmed/case-insensitive title search, no-results/reset, product detail, adding from detail and grid, repeat additions, mixed-product subtotal and unit count, quantity increment/decrement and 1/99 bounds, removal, empty cart, Escape close, initial dialog focus, focus containment/return and cart reset on reload. Desktop collection, mobile collection and mobile cart had no horizontal overflow. Browser console reported no errors or warnings; request inspection showed no catalog/image/font service calls.

Local screenshots are in ignored `output/playwright/brand-store-desktop.png` and `output/playwright/brand-store-mobile.png`. These checks exercised the prepared bundle in a temporary browser harness, not the platform catalog or Sandpack integration. Shared generated directories, application code and other templates were not changed.
