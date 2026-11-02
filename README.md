# Content Watchtower

Content Watchtower is a small, separate MVP for planning content records, importing spreadsheet rows, checking quality signals, and exporting clean reports. It intentionally does not modify or depend on the existing `KE-Marcomm-Operations` repo.

## What It Does

- Dashboard with total records, ready items, review items, and average score.
- Pattern dashboard for exploring topic, SRA, format, image, timing, engagement, and 30-to-90-day growth patterns from imported performance data.
- Records table with search, filters, sorting, pagination, create, view, edit, and delete.
- CSV/XLSX import with a template, ASU Story Performance workbook support, row preview, validation, duplicate detection, and partial imports.
- Prediction page that estimates 30-day and 90-day pageviews from imported historical rows.
- Built-in example stories stay visible for orientation but are excluded from prediction training and performance patterns.
- Draft Review page that gives writers a readiness score, SEO critique, relevance angles, headline feedback, concrete draft edits, recommendations, and an editor checklist before publication. After reviewing, use **Download Word** to save the feedback and the draft it reviewed for later comparison.
- CSV/XLSX export of the currently filtered records.
- Optional GA4 product-event tracking with privacy filtering and a visible connector slot in Settings.
- Browser local storage for an easy-to-run side-project MVP.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`.

## Optional GA4

Copy `.env.example` to `.env.local` and set:

```bash
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

Only approved product events are sent. Record text, notes, IDs, emails, names, raw search text, and spreadsheet content are filtered out.

## Optional GA4 Import

Watchtower can preview aggregated GA4 page performance and import it into the same records used by predictions. Set the numeric property ID and a read-only server credential:

```bash
GA4_PROPERTY_ID=315631542
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/ga4-reader.json
VITE_GA4_IMPORT_ENDPOINT=http://127.0.0.1:8787/api/ga4/import
```

The Google credential must be a backend-only service account with Viewer access to the GA4 property. Do not put service-account JSON in any `VITE_` variable. The import queries aggregated page rows only and does not import user-level data.

## Optional AI Review Endpoint

Draft Review works locally by default. To connect a real model, run the backend AI endpoint and point the browser app to it:

```bash
OPENAI_API_KEY=your-server-side-key
OPENAI_MODEL=gpt-5-mini
AI_REVIEW_PORT=8787
AI_REVIEW_ALLOWED_ORIGIN=http://127.0.0.1:5173
VITE_AI_REVIEW_ENDPOINT=http://127.0.0.1:8787/api/review-draft
```

Keep model provider API keys on the server side only. Do not create `VITE_OPENAI_API_KEY`; Vite exposes `VITE_` variables to the browser. The AI endpoint returns structured recommendations while the app preserves local prediction and readability stats as fallback.

## Vercel Deployment

The Vercel branch includes a server-side API route at `/api/review-draft`, so production does not need `VITE_AI_REVIEW_ENDPOINT`.

1. Import `smitpatel13/Content-WatchTower` into Vercel.
2. Use branch `codex/vercel-deploy`.
3. Keep the framework preset as `Vite`.
4. Use build command `pnpm build` and output directory `dist`.
5. Add these Vercel environment variables:

```bash
OPENAI_API_KEY=your-server-side-key
OPENAI_MODEL=gpt-5-mini
AI_REVIEW_MAX_DRAFT_CHARS=16000
AI_REVIEW_TIMEOUT_MS=55000
```

Do not add any OpenAI key as a `VITE_` variable. If GA4 event tracking is approved, add `VITE_GA_MEASUREMENT_ID` separately. GA4 import still requires a backend read-only Google credential before it should be enabled in production.

## OpenAI Draft Review

For local development with both the frontend and AI backend:

```bash
pnpm dev:full
```

The AI backend:

- accepts only JSON requests from the configured origin
- removes obvious emails, phone numbers, and identifier-like strings before sending text to OpenAI
- limits request size and draft length
- returns a strict recommendation shape covering SEO, trend/relevance framing, draft rewrite guidance, evidence signals, and editor checklist items
- avoids logging draft text or API keys
- falls back to the local editorial review if the endpoint is unavailable

## Spreadsheet Format

The app supports the attached ASU workbook shape:

- `Updated` sheet is preferred when present.
- Headers can appear after the source row.
- 30-day and 90-day metric groups are detected from grouped headers.
- Calendar-style rows without metrics import as `Draft`.
- Prediction uses only rows with historical pageview metrics.

Simple templates can also use these columns:

- `Title`
- `Topic`
- `Planned Date`
- `Word Count`
- `Images`
- `Status`
- `Length`
- `SRA`
- `30-day Users`
- `30-day Sessions`
- `30-day Pageviews`
- `30-day Session Eng. Time`
- `30-day Bounce Rate`
- `90-day Users`
- `90-day Sessions`
- `90-day Pageviews`
- `90-day Session Eng. Time`
- `90-day Bounce Rate`

Optional columns:

- `Owner`
- `URL`
- `Notes`

Supported statuses are `Draft`, `Ready`, `Published`, and `Needs review`.

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Production Notes

This is deliberately lightweight. Local storage is good for a pilot or demo, but a team rollout should move records and imports to PostgreSQL, add authentication, and define retention rules before real operational use.
