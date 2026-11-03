# Cook or Click

Type a craving like "butter chicken for 4, I've got 40 minutes". The app compares:

- **Make at home:** Groq writes a recipe, and the backend prices the ingredients on Swiggy Instamart (cheapest pack combinations, staples you already have left out).
- **Order from outside:** the backend checks open restaurants on Swiggy Food that sell the dish, compares price, dish and restaurant ratings (adjusted for how many people rated), delivery time and distance, and keeps the best 5.

It then scores both on money, your time (valued at your ₹/hour), effort, quality and leftovers, shows a suggestion written to you, and a side-by-side table so you can judge for yourself. One click fills the matching Swiggy cart and shows the real bill. **The app never places an order.**

```
backend/   Express + TypeScript API, Swiggy MCP client, Groq, Prisma (Neon Postgres)
frontend/  Next.js (App Router) + Tailwind + shadcn/ui
```

## Prerequisites

- Node.js 20+ (built on 24)
- A [Neon](https://neon.tech) Postgres database
- A Groq API key
- A Swiggy account with at least one saved delivery address

## 1. Backend

```bash
cd backend
cp .env.example .env
```

Fill in `backend/.env`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`), with `?sslmode=require` |
| `DIRECT_URL` | Neon **direct** connection string (no `-pooler`). Used only by Prisma migrations |
| `GROQ_API_KEY` | Your Groq key |
| `GROQ_MODEL` | Default `openai/gpt-oss-120b`. (Groq shut down `llama-3.3-70b-versatile` on 16 Aug 2026.) |
| `TOKEN_ENC_KEY` | Output of `openssl rand -base64 32`. Encrypts Swiggy tokens in the database |
| `PORT` | `4000` |
| `FRONTEND_ORIGIN` | `http://localhost:3000` |
| `SWIGGY_REDIRECT_URL` | `http://localhost:4000/auth/callback` (see "Redirect URI" below) |

Then:

```bash
npm install
npx prisma generate                    # generates the client into src/generated/prisma
npx prisma migrate dev --name init     # creates the SwiggyAuth and Settings tables on Neon
npm test                               # unit + route tests, no network or database needed
npm run dev                            # http://localhost:4000
```

Check it: `curl http://localhost:4000/health` should return `{"status":"ok","db":"ok"}`.

## 2. Frontend

```bash
cd frontend
cp .env.example .env.local             # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm test
npm run dev                            # http://localhost:3000
```

## 3. First run

1. Open http://localhost:3000 and click **Connect Swiggy**. You land on Swiggy's page; enter your phone number and the OTP.
2. Swiggy sends you back to **Settings**. Pick your delivery address, set default servings, cooking skill, what an hour of your time is worth, and whether you have basic staples. Save.
3. Go home, type a craving (or click an example), and press **Cook or Click?**. It takes roughly 10–30 seconds.
4. Read the suggestion, the two cards and the side-by-side table.
5. Click **Fill Instamart cart** or **Fill Food cart** on any restaurant. Confirm, and the real Swiggy bill appears next to the estimate.
6. Open the Swiggy app to place the order yourself.

## Redirect URI

Swiggy allows `http://localhost...` redirect URIs for local development. During development, Swiggy's authorize endpoint accepted `http://localhost:4000/auth/callback`, so no proxy should be needed.

If the login page ever rejects it, use the always-allowed `http://localhost/callback`:

```bash
# backend/.env
SWIGGY_REDIRECT_URL="http://localhost/callback"

# in a second terminal (port 80; on macOS no sudo is needed, on Linux it may be)
npm run callback-proxy
```

The proxy only forwards the browser to `http://localhost:4000/auth/callback` with the same query string.

## How the suggestion is calculated

All weights and fee estimates live in `backend/src/config/app.ts`.

- **money** = cheapest cost per serving among all options ÷ this option's cost per serving
- **time** = 60% hands-on time (its rupee value at your ₹/hour, capped at ₹500) + 40% minutes until you can eat, multiplied by 0.4 if it misses your time limit
- **effort** = 1 − (difficulty − 1)/4 for cooking, 1 for ordering
- **quality** = ordering: 60% dish rating + 40% restaurant rating, each pulled toward 4.0★ when few people rated it (`(R·v + 4.0·50)/(v + 50)`); cooking: 0.6 / 0.75 / 0.9 for beginner / average / confident
- **leftovers** = extra servings, full bonus at 2
- **final** = `0.4·money + 0.35·(0.7·time + 0.3·effort) + 0.25·quality + 0.1·leftovers`

Fee estimates before "Fill cart": Food ₹40 delivery + 5% GST + ₹10 platform fee; Instamart ₹10 handling + ₹30 delivery under ₹199. These are labelled "est." in the UI.

Groq only writes the explanation, from numbers the code already computed. If its text contains a number that isn't in those facts, the app uses a plain template instead.

## Debug routes (not in production)

With `NODE_ENV` not set to `production` and Swiggy connected:

- `GET /api/debug/addresses` — raw `get_addresses`
- `GET /api/debug/search?server=food&q=butter%20chicken` — raw `search_menu` (`server=restaurants` for `search_restaurants`, `server=im` for Instamart `search_products`)
- `GET /api/debug/tools?server=food` — each live tool's input schema

## Manual smoke test against live Swiggy

1. `GET /auth/status` shows `connected: true` after login.
2. `GET /api/addresses` lists your saved addresses.
3. `/api/debug/search?server=food&q=butter%20chicken` and `server=im&q=chicken` return results.
4. `GET /api/debug/tools?server=food`: check that `update_food_cart` takes `cartItems` with `menu_item_id` and `quantity`. The Swiggy docs show two different shapes; the app uses the one from the tool reference. If the live schema differs, adjust `foodCartItem()` in `backend/src/cart/cartService.ts`.
5. Run a comparison in the UI, fill a Food cart, and confirm the same items show in the Swiggy app.
6. Repeat with the Instamart cart.

## Known limits

- Fees are estimated until you fill a cart.
- Recipe quantities, cooking times and "how many people one plate feeds" come from Groq and can vary.
- Food items with variants use the default variant and no add-ons; adjust in the Swiggy app.
- Swiggy provides ratings and rating counts, not review text.
- Filling a cart **replaces** your existing Swiggy Food or Instamart cart.
- Only the first page (10) of saved addresses is loaded.
- Decisions are kept in memory for 30 minutes so carts can be filled; restarting the backend clears them.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid environment configuration` on start | A variable in `backend/.env` is missing or `TOKEN_ENC_KEY` isn't 32 bytes |
| `/health` shows `db: error` | Check `DATABASE_URL`; Neon may be waking up, try again |
| "Your Swiggy session expired" | Click **Reconnect Swiggy** |
| Groq errors | Check `GROQ_API_KEY`, or try another model in `GROQ_MODEL` |
| Frontend says it can't reach the backend | Is `npm run dev` running in `backend/`? Does `NEXT_PUBLIC_API_URL` match? |
