# OFFSCRIPT

**Make plans. Break routines.**

Cook or Click + SideQuest.

One web app with two services behind one Swiggy login, like the service tabs in the Swiggy app. The home page (`/`) is a hub, and the header has a switcher.

| Service | Route | Reads from |
|---|---|---|
| **Cook or Click**: cook it at home or order in? | `/cook-or-click` | Swiggy Food, Instamart |
| **SideQuest**: plan any outing as a mini adventure | `/sidequest` | Swiggy Scenes, Dineout, Food, Instamart |

To add a third service, add an entry to `frontend/components/services.tsx` and a route folder.

## SideQuest

Plan any outing, not just a meal: a night out, a date, a birthday, a stay-in game night. Try "I have ₹1,000, three friends, and 5 hours. Give us an interesting evening in Delhi." or "Stay-in game night for 5 in Pune, snacks and a late dinner."

**Swiggy MCP is the only data source, and nothing depends on it.** Every quest tries all four services (Scenes, Dineout, Food, Instamart). Only a stay-in plan or an explicit "no" turns one off. The quest is built from whatever comes back, and if Swiggy has nothing (or is down) you still get a quest made of ideas. Free-form ideas only fill gaps: Swiggy's services rank above them when the planner chooses.

The result includes a **"What Swiggy added"** panel with one tile per service: *In your quest*, *Left out* (had options, none fit your time or budget), *Nothing found*, *Unavailable* (the call failed) or *Not needed*. A tight budget can leave a service out. For example, a table for four at a ₹400-for-two restaurant is ₹800, so ₹1,000 can't also cover everything else, and the panel says which service was dropped.

| Stop | Source | Used when |
|---|---|---|
| Event or show | Swiggy **Scenes** (real show times; ticket prices as the cheapest mix, e.g. one "Group Pass For 4" instead of four singles) | an out-and-social plan |
| Dinner or drinks | Swiggy **Dineout** (rating, cost for two, "Top rated" / "Good value" labels, and a check that the restaurant takes tables at the planned time) | you're going out to eat |
| Quest kit (snacks, props) | Swiggy **Instamart** (real prices, in-stock, fees) | every quest: a small kit when you're going out, a fuller one for stay-ins |
| Late-night food | Swiggy **Food** (delivered to your saved address; one portion each, or one per two people when the budget is tight) | every quest, unless you say no food |
| Walk, photo hunt, game round | **Ideas** written by Groq, tagged "Idea" in the UI | almost always |

What the live Swiggy tools actually return (checked against the real servers, not just the docs):

- **Dineout search and slots answer in text**, with `structuredContent: {}`. They are parsed in `backend/src/swiggy/textParsers.ts`, and the parsers throw on text they can't read, so a change in Swiggy's wording shows up as an error and not as "0 restaurants".
- **Dineout gives no rating counts**, so there is no "underrated" claim. Labels are only "Top rated" (4.5★+) and "Good value" (4.2★+ at ₹1,200 for two or less).
- **Dineout lists restaurants with no bookable slots.** Each shortlisted restaurant's tables are checked first, and the dinner is only placed inside its service hours.
- **Scenes `discover_events` was empty for Delhi, Mumbai and Bengaluru**, so events come from `search_events`. It matches every city, so results are filtered to the quest's metro by their "Locality, City" text and by venue distance from the city centre, then by whether a show falls in your window.

Ideas are not Swiggy data. The prompt forbids naming any business or venue and claiming hours, prices, crowds or weather, and alcohol or tobacco is filtered out in code. The UI says plainly that they are suggestions.

How a request is handled:

1. Groq reads the sentence: city, group size, budget, hours, start time, vibe, theme, and which services to use.
2. The chosen sources run in parallel (Scenes then Dineout near the event venue; Food; ideas and the Instamart price check).
3. The planner tries every combination of stops (at most 5), places them on the timeline (event at its show time, supplies first, delivery last, travel only when someone leaves home), drops what doesn't fit your hours, and penalises going over budget. Weights are in `backend/src/config/app.ts` under `sidequest`.
4. Groq writes the story and a side challenge per chapter. If it fails, or writes a number it wasn't given, a plain template is used.

SideQuest is read-only. It never books a table, buys a ticket, fills a cart or places an order. The Swiggy tools it can call are an allowlist in `backend/src/swiggy/callTool.ts` (Dineout: search and slots; Scenes: discover, collections and show listings; Instamart: product search), and tests check that no booking, cart or payment tool is on it.

Limits to know about:

- Swiggy addresses carry no coordinates, so the **city must be in your request** (or in your saved address). About 30 Indian cities are built in (`backend/src/sidequest/places.ts`).
- Late-night food and Instamart orders go to your saved Swiggy address. If that is in another city, the quest warns you.
- Travel times between stops are fixed estimates (30 min), and dinner cost is "cost for two" scaled to the group. Both are labelled estimates. In Delhi, a table for four is usually ₹2,000 or more, so a ₹1,000 budget leaves Dineout out and the coverage panel says so.
- Instamart picks the best-matching in-stock item that is not a bulk pack and costs ₹250 or less, and with a budget the kit is trimmed to about 15% of it. Check the cart in the Swiggy app.
- Dineout and Scenes are separate Swiggy MCP servers on the same OAuth login. **Reconnect Swiggy once** after upgrading, if the first SideQuest call is rejected.

---

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
- `GET /api/debug/tools?server=food` — each live tool's input schema (`food`, `im`, `dineout` or `scenes`; use `dineout` and `scenes` to check SideQuest's argument names)

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
