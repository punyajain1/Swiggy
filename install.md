## What was added this round
- **Backend:**
  - Scoring and the verdict.
  - The comparison table rows.
  - The Groq explanation. If it mentions a number the code didn't calculate, the app uses a plain template instead.
  - Filling the Food and Instamart carts.
  - All routes: `/auth/*`, `/api/settings`, `/api/addresses`, `/api/decide` (limited to 10 requests a minute), `/api/cart/*`, plus debug routes.
  - Wiring for Neon.
  - The port-80 callback proxy.
- **Frontend:**
  - Header with your Swiggy connection status.
  - A setup prompt until you've connected and picked an address.
  - The Settings page.
  - The craving input with step-by-step progress.
  - Your two options shown side by side, with the suggested one marked "Recommended".
  - A list of up to 5 restaurants with ratings, distance, delivery time and offer.
  - The comparison table, with a tick on the winner of each row.
  - A confirmation dialog for "Fill cart" that shows the real bill next to the estimate.
- **Tests:** 11 backend test files and 2 frontend ones. They use fake Swiggy, Groq and database objects, so they need no network or Neon.

## How to try it

**1. Backend**
```bash
cd backend
cp .env.example .env
```
Fill in `.env`:
- `DATABASE_URL`: your Neon **pooled** connection string (the host contains `-pooler`)
- `DIRECT_URL`: your Neon **direct** connection string
- `GROQ_API_KEY`
- `TOKEN_ENC_KEY`: the output of `openssl rand -base64 32`

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm test
npm run dev
```
`curl localhost:4000/health` should return `{"status":"ok","db":"ok"}`.

**2. Frontend** (in a second terminal)
```bash
cd frontend
cp .env.example .env.local
npm install
npm test
npm run dev
```

**3. In the browser, at http://localhost:3000**
1. Click **Connect Swiggy** and log in with your phone number and OTP.
2. You land on Settings. Pick your address and preferences, then save.
3. Go back home, type something like "butter chicken for 4, I've got 40 minutes", and press **Cook or Click?**. It takes about 10–30 seconds.
4. Click **Fill Food cart** or **Fill Instamart cart**. Confirm, and you'll see the real Swiggy bill. Then place the order in the Swiggy app.

## Things to watch on the first real run
- **Food cart format:** The Swiggy docs show two different formats for filling the Food cart. I used the one from the tool reference. Once you're logged in, open `http://localhost:4000/api/debug/tools?server=food` and check that `update_food_cart` takes `cartItems` with `menu_item_id`. If it doesn't, that's a one-function fix in `backend/src/cart/cartService.ts`.
- **Redirect URI:** Swiggy accepted `http://localhost:4000/auth/callback` when I tested it. If login fails on the redirect, follow the "Redirect URI" section in the README to switch to the port-80 proxy.
- **Groq model:** The default is `openai/gpt-oss-120b`, because Groq has shut down `llama-3.3-70b-versatile`. You can change it with `GROQ_MODEL`.
- **Carts get replaced:** Filling a cart replaces whatever is already in your Swiggy Food or Instamart cart. The confirmation dialog warns about this.
- **No order placement:** The app can't place orders. The tools for placing orders and taking payment are blocked in code, and a test checks this.