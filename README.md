<div align="center">

# Armoire

### Your closet, infinitely styled.

Turn the clothes you already own into a private digital wardrobe—and discover new ways to wear them with AI.

[![License: MIT](https://img.shields.io/badge/license-MIT-191919?style=flat-square)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-191919?style=flat-square)](package.json)
[![Local first](https://img.shields.io/badge/local--first-yes-191919?style=flat-square)](#private-by-design)

</div>

## Meet Armoire

Armoire transforms everyday outfit photos into an organized, visual wardrobe. It finds each garment, creates polished product cutouts, generates editorial modeled previews, and helps you build complete looks from pieces you already own.

Everything stays on your machine. Your clothes, photos, and personal style remain yours.

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

## From camera roll to curated closet

```text
Outfit photos  →  Garment detection  →  Clean cutouts  →  Modeled previews  →  Styled looks
```

- **Capture every piece** — detect individual garments from outfit and model photos.
- **Create clean cutouts** — turn each item into a polished, transparent product image.
- **See it styled** — generate an optional identity-preserving editorial preview.
- **Build new looks** — combine pieces from your wardrobe into complete modeled outfits.
- **Stay in control** — drag, drop, paste, edit, review, regenerate, and approve every item.

## Quick start

```bash
git clone https://github.com/vedant-abrol/Armoire.git
cd Armoire
npm install
cp .env.example .env
npm run dev
```

Add `OPENAI_API_KEY` to `.env`, then place a PNG reference photo at `data/model-reference.png` to enable importing and modeled previews.

Open [localhost:5173](http://localhost:5173) and start building your wardrobe.

## Bring your wardrobe in

### With Codex

Armoire includes two ready-to-use Codex skills: one imports clothes and creates modeled item photos; the other styles complete outfits and generates a personal lookbook.

```text
$import-clothes Import the clothes from ~/Pictures/outfits, create modeled photos, and add them to Armoire.

$generate-outfits Create modeled outfit ideas from my Armoire wardrobe.
```

The import skill reviews every cutout and modeled image before saving approved pieces to `data/library.json` and `data/imported/`. The outfit skill curates, generates, verifies, and saves complete looks under `data/`.

### With the web app

Configure `OPENAI_API_KEY` and `data/model-reference.png`, launch Armoire, and import photos directly through the browser. The interface supports drag and drop, paste, editing, review, regeneration, and approval.

## Private by design

Armoire is local-first. Originals, generation jobs, wardrobe data, and generated images are stored in your local `data/` directory—not in a hosted Armoire account.

Only the images required for AI processing are sent to the OpenAI API when you choose to import or generate something.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Required | Enables garment analysis and image generation |
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` | Detects and describes garments |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | Creates cutouts and modeled previews |
| `OPENAI_IMAGE_QUALITY` | `high` | Controls generated image quality |
| `WARDROBE_MODEL_REFERENCE` | `data/model-reference.png` | Sets the model identity reference |
| `WARDROBE_DATA_DIR` | `data` | Stores the local wardrobe library |

## For agents

When setting up Armoire for a user, ask how they want to import their clothes:

- **Codex:** Ask for a folder or camera-roll location and a model-reference PNG, then follow the bundled [import skill](.agents/skills/import-clothes/SKILL.md). After importing, offer to create modeled looks with the [outfit-generation skill](.agents/skills/generate-outfits/SKILL.md).
- **Web UI:** Help the user configure `OPENAI_API_KEY` and `data/model-reference.png`, then let them import through the app.

## Built with

React · Vite · OpenAI Responses API · OpenAI Images API · Sharp

## Acknowledgments

Armoire builds on the original open-source [Wardrobe project](https://github.com/tandpfun/wardrobe) and its vision for a personal, AI-powered closet.

## License

[MIT](LICENSE)
