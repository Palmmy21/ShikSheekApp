# ShikSheek — Landing page

Next.js (App Router) static site. Brand tokens, fonts (Prompt + Anuphan) and the real mascot art.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run build      # static export → out/
```

## Config

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_LINE_ADD_URL` | Optional override of the add-friend link (default: `https://line.me/R/ti/p/%40541ywsff`). |
| `NEXT_PUBLIC_SITE_URL` | Public URL, used for social-share metadata. |

## Deploy

- **Vercel:** import the repo, set **Root Directory = `web`**, add the two env vars. Framework preset: Next.js.
- **Anywhere static:** `npm run build` and upload `web/out/`.

## Assets

`public/mascot/*` are copies of `../assets/mascot/*`. After changing mascot art run from the repo root:
`node scripts/build-mascots.ts && cp assets/mascot/*.png web/public/mascot/ && node scripts/build-web-assets.ts`
(the last command regenerates `og.png`, `favicon.png`, `apple-touch-icon.png`).
