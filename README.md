<div align="center">

# Armoire

### Your closet, intelligently styled.

A private, AI-assisted wardrobe that turns owned clothes into curated outfits and identifies the pieces that would make the wardrobe work harder.

[![License: MIT](https://img.shields.io/badge/license-MIT-191919?style=flat-square)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-191919?style=flat-square)](package.json)
[![Hosted on Base44](https://img.shields.io/badge/hosted-Base44-6e302e?style=flat-square)](https://armoire-d4db6c05.base44.app)

**[Open the live Armoire demo](https://armoire-d4db6c05.base44.app)**

</div>

## What Armoire does

Armoire organizes a personal wardrobe, extracts garments from source photos, creates clean cutouts and modeled previews, recommends complete outfits from owned pieces, and identifies high-value wardrobe gaps.

- **Private accounts** — Base44 authentication and per-user wardrobe data.
- **Visual wardrobe** — searchable garment gallery with editable details and color palettes.
- **AI import pipeline** — source-photo analysis, cutout generation, review, and approval.
- **Style This** — curated outfits built from garments the user already owns.
- **Complete the Look** — a wardrobe-gap recommendation connected to Shopify product search and cart creation.
- **Saved outfits** — reusable looks with garments, occasion, season, and styling rationale.
- **Reliable hackathon demo** — 80 deterministic wardrobe pieces, 59 appearances, and 8 curated outfits for the dedicated demo account.

<table>
  <tr>
    <td width="50%" align="center"><strong>Your wardrobe at a glance</strong></td>
    <td width="50%" align="center"><strong>Every piece, beautifully presented</strong></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/gallery.png" alt="Armoire wardrobe gallery" /></td>
    <td><img src="docs/screenshots/editor.png" alt="Armoire modeled wardrobe editor" /></td>
  </tr>
</table>

## Hackathon demo path

The dedicated account is `vedant1311nov@gmail.com`. Its canonical Navy Overshirt flow produces a deterministic **Camel Chore Jacket** wardrobe-gap recommendation that complements 11 owned pieces.

If live Shopify search is unavailable, only this demo account receives three polished local commerce previews:

- Camel Chore Jacket — $89
- Camel Work Jacket — $105
- Sand Overshirt — $79

These records are explicitly marked `source: "demo-fixture"`. They never contain a Shopify variant ID and never call `cartCreate`; their CTA is **View Shopify Integration**. A real Shopify cart is created only from an available variant GID returned by the Storefront API.

See [the demo reset and seed runbook](docs/hackathon-demo.md) before presenting.

## Shopify integration

Storefront requests run only in Base44 backend functions. Authentication is attempted in this order:

1. Private Headless token using `Shopify-Storefront-Private-Token`
2. Public Headless token using `X-Shopify-Storefront-Access-Token`
3. Tokenless access as a final fallback

Private requests forward a validated buyer IP when Base44 supplies one. If public authentication succeeds after a private 401/403, the working public mode is reused for the current runtime and passed from product search into cart creation. Private credentials are never bundled into frontend code.

The deployed store must still contain active, available products published to the same Headless sales channel. Until Shopify accepts one of the configured tokens, the demo account safely uses the local preview above and no checkout is fabricated.

## Architecture

```text
React + Vite UI
      ↓
Base44 authentication and entities
      ↓
Base44 backend functions
      ├── OpenAI garment analysis and styling
      └── Shopify Storefront product search and cart creation
```

Core Base44 resources live under `base44/`:

- `entities/` — wardrobe items, source photos, import jobs, appearances, and outfits
- `functions/` — import, styling, demo seed/reset, Shopify search, and Shopify cart creation
- `shared/` — deterministic demo data and the server-only Shopify client
- `auth/` — application authentication configuration

## Local development

Requirements: Node.js 22+, npm, and access to the linked Base44 app.

```bash
git clone https://github.com/vedant-abrol/Armoire.git
cd Armoire
npm install
npx base44 login
```

Run the Base44 development server and Vite frontend in separate terminals:

```bash
npx base44 dev
```

```bash
npm run dev
```

Open [localhost:5173](http://localhost:5173).

## Base44 secrets

Configure these through Base44; never commit their values:

| Secret | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Garment analysis and generation |
| `SHOPIFY_STORE_DOMAIN` | The development store's `*.myshopify.com` domain |
| `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` | Server-side Headless Storefront access |
| `SHOPIFY_STOREFRONT_PUBLIC_TOKEN` | Public Headless fallback access |

## Validation and deployment

```bash
npm run check
npx base44 deploy -y
```

`npm run check` verifies the canonical demo assets and seed behavior, then builds the production frontend. `npx base44 deploy -y` publishes the entity schemas, backend functions, authentication configuration, and built site.

## Demo reset

Reset only canonical demo fixtures:

```bash
ARMOIRE_DEMO_PASSWORD='your-demo-account-password' npm run demo:reset
```

Seed or repair missing fixtures without deleting data:

```bash
ARMOIRE_DEMO_PASSWORD='your-demo-account-password' npm run demo:seed
```

The password is read from the process environment and is never stored or printed. Real wardrobe records are preserved by the normal reset path.

## Codex skills

Armoire includes two project skills for local asset workflows:

```text
$import-clothes Import garments from a photo folder and add approved assets to Armoire.

$generate-outfits Create modeled outfit ideas from clothes already in Armoire.
```

## Built with

React · Vite · Base44 · OpenAI · Shopify Storefront API · Sharp

## Acknowledgments

Armoire builds on the original open-source [Wardrobe project](https://github.com/tandpfun/wardrobe) and its vision for a personal, AI-powered closet.

## License

[MIT](LICENSE)
