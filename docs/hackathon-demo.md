# Armoire hackathon demo

Only `vedant1311nov@gmail.com` can invoke the demo seed and reset functions. The backend verifies the authenticated email and never accepts an email address from the caller.

## Before the demo

Reset only canonical fixture records, then recreate the 80-item wardrobe, 59 appearance records, and 8 outfits:

```bash
ARMOIRE_DEMO_PASSWORD='your-demo-account-password' npm run demo:reset
```

The password is read from the process environment and is not saved or printed. The default reset deletes only records with `demoFixture === true`; real Phase 3 imports remain untouched.

To idempotently add or update missing canonical fixtures without deleting anything:

```bash
ARMOIRE_DEMO_PASSWORD='your-demo-account-password' npm run demo:seed
```

`--include-real-data` is the explicit destructive override. Do not use it before a normal demo:

```bash
ARMOIRE_DEMO_PASSWORD='your-demo-account-password' npm run demo:reset -- --include-real-data
```

## Local fixture checks

Regenerate deterministic static SVGs and validate every reference:

```bash
npm run demo:assets
npm run demo:verify
```

Demo fixtures never call OpenAI Images. Real uploaded photos and generated garments continue to use private Base44 file URIs and the existing Phase 2/3 pipeline.
