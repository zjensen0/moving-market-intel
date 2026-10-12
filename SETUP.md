# Setting up Moving Market Intelligence (Acumena Analytics)

Plain-language, start to finish. About 45 minutes the first time. You need three free accounts: GitHub (done), Supabase (the database and logins) and Cloudflare (hosts the website).

What you end up with:

- A website at `https://moving-market-intel.pages.dev` (or your own domain) where clients sign in.
- Each client company sees full detail for the markets in its plan, a preview with an upgrade prompt for every other market, and a "Your business" page built from the jobs they upload.
- An Admin page where you add companies, pick their markets and create invite codes.

Costs: Supabase Free (0 dollars) is enough to start; move to Pro (25 dollars a month) once you have paying clients, mainly so the project never pauses from inactivity. Cloudflare Pages Free is enough for a long time.

---

## 1. Create the database (Supabase)

1. Go to https://supabase.com/dashboard and sign up (use your Acumena email, not Deloitte).
2. **New project**. Name: `moving-market-intel`. Pick a strong database password and save it in your password manager (you rarely need it). Region: US East. Plan: Free.
3. Wait a minute for the project to start, then open **SQL Editor** in the left menu.
4. Open the file `supabase/migrations/0001_init.sql` from this repo, paste the whole thing into the SQL editor and click **Run**. It creates the tables, the access rules and the helper functions. You should see "Success. No rows returned."
5. Open **Project settings > API** (gear icon). Copy two values; you'll use them in steps 2 and 3:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **Publishable key** (Project settings > API Keys, starts with `sb_publishable_`). This one is safe to put in the website.
   - You don't need the secret (service role) key for anything. Leave it alone; it bypasses every access rule.

### Login settings

6. **Authentication > Providers > Email**: leave Email enabled. "Confirm email" on is fine (clients get a confirmation email the first time). If you want fewer steps for clients, turn "Confirm email" off; invite codes still control who gets in.
7. **Authentication > URL Configuration**: after step 3 you'll come back here and set **Site URL** to your website address (for example `https://moving-market-intel.pages.dev`) and add the same address under **Redirect URLs**. Without this, emailed sign-in links won't bring people back to the site.
8. Optional but recommended once you have clients: **Authentication > Email templates**: change the sender name to Acumena Analytics. Supabase's built-in email sender is limited to a few emails an hour; for real volume connect a free sending service under **Project settings > Auth > SMTP** (Resend or Brevo both have free tiers).

## 2. Add the admin data-loading rule

In the SQL Editor, open a new query, paste `supabase/migrations/0002_admin_market_data.sql` and Run. It lets platform admins (and nobody else) load market data from the website, so you never need the secret key.

## 3. Host the website (Cloudflare Pages)

1. Go to https://dash.cloudflare.com and sign up.
2. **Workers & Pages > Create > Pages > Connect to Git**. Authorize GitHub and pick `zjensen0/moving-market-intel`.
3. Build settings:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. **Environment variables** (add for Production, and again for Preview if you want preview builds to work):
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your publishable key
   - `NODE_VERSION` = `22`
5. **Save and Deploy**. The first build takes about two minutes. You get an address like `https://moving-market-intel.pages.dev`.
6. Go back to Supabase **Authentication > URL Configuration** and set Site URL and Redirect URLs to that address (step 1.7).
7. Optional: **Custom domains** in the Pages project to use something like `analytics.acumenasolutions.com`. Cloudflare walks you through the DNS record. Add that address to Supabase's Redirect URLs too.

From now on, every push to `main` on GitHub redeploys the site automatically.

## 4. Make yourself an admin

1. Open the website and choose **Create account** with your Acumena email. Confirm the email if asked. You'll land on the "Connect to your company" screen; that's expected, admins don't belong to a client company.
2. In Supabase, **SQL Editor**, run (with your email):
   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'you@acumenasolutions.com';
   ```
3. Reload the website. The first time, it asks you to **load the market data**: choose `market_data.json` (in the repo's `data` folder, or the copy I sent you). It takes under a minute. After that you see all 387 markets and the **Admin** tab.

To add a second admin later, run the same SQL for their email after they create an account.

## 5. Onboard a client

1. **Admin > Add a client company**: name, home market, plan (Selected markets or All markets). Add company.
2. In the company's panel, tick the markets they pay for and **Save markets**. The home market is always included.
3. **Create invite code**: choose Member or Owner (owners are just labeled differently for now), how long the code lasts and how many people can use it. Click **Copy message** and send it to your contact by email.
4. They go to the site, create an account with their work email, enter the code, and they're in. Colleagues use the same code while it has uses left.
5. They upload jobs on **Your business** (CSV from their moving software; the page shows which columns it reads and has a template). Their jobs are visible only to their own company and to admins.

To stop someone's access: **Admin > company > People > Remove**. To stop a whole company, set its markets to none or delete the company in Supabase **Table Editor > organizations** (this also deletes its jobs).

## 6. Updating the market data later

When the data pipeline produces a new `data/market_data.json`:

1. Commit it to the repo (so the demo build picks it up) and push.
2. On the website, **Admin > Market data**, choose the new file. Clients see the new data on their next page load.

The data sources, their release schedules and what each one feeds are listed on the site's **Data & methods** page.

## 7. Working on the code

- `npm run dev:demo` runs the demo locally (no database needed), at http://localhost:5173
- `npm run dev` runs the real app locally; put your Supabase values in a `.env.local` file (copy `.env.example`)
- `npm test` runs the unit tests (CSV reading, analytics); `npm run test:db` checks the database access rules against an in-memory Postgres
- `npm run build` builds the real site; `npm run build:demo` builds the one-file demo at `dist-demo/index.html`

## 8. Turn on Ask Acumena (AI questions)

Ask Acumena answers plain-English questions from the market data using Claude. It runs in a small server function (`functions/api/ask.ts`) on Cloudflare, so the AI key never reaches anyone's browser.

1. In Supabase, **SQL Editor**, run `supabase/migrations/0003_ai_questions.sql` (the question log and daily limit). Already done on the live project.
2. Create an API key at https://console.anthropic.com (Settings > API keys). Add a payment method and, under Limits, set a monthly spend limit you're comfortable with (for example $25).
3. In Cloudflare: **Workers & Pages > moving-market-intel > Settings > Variables and secrets > Add**. Type **Secret**, name `ANTHROPIC_API_KEY`, paste the key, save. Do this for Production.
4. **Deployments > latest > Retry deployment** so the function picks up the key.
5. Open the site, click **Ask Acumena**, and try a question.

Optional settings (same place, type Text): `AI_DAILY_LIMIT` (questions per person per day, default 25; admins get ten times that) and `AI_MODEL` (default `claude-sonnet-5-5`; `claude-haiku-5-5` is cheaper and faster but less thorough).

Cost: Claude Sonnet 5.5 is $2 per million input tokens and $10 per million output tokens (https://platform.claude.com/docs/en/models/overview). A typical question uses about 10,000–20,000 input tokens and under 1,000 output tokens, so roughly 3–5 cents. **Admin > Ask Acumena questions** shows every question and an estimated monthly cost.

What clients can see: the function reads data with the asking person's own login, so the same rules apply as everywhere else. They get rankings across all 387 metros (the same preview everyone sees) and full detail only for markets in their plan.

## If something goes wrong

- **"This copy of the site isn't connected to its database yet"**: the two `VITE_` variables are missing in Cloudflare. Add them and redeploy (Deployments > Retry).
- **Sign-in link opens a page that says the link is invalid or expired**: Site URL / Redirect URLs in Supabase don't match the site address (step 1.7), or the link was older than an hour.
- **A client sees "Not in your plan" for their home market**: tick it under Admin > Markets and save.
- **Ask Acumena says "isn't switched on yet"**: the `ANTHROPIC_API_KEY` secret is missing, or the site wasn't redeployed after adding it (section 8).
- **Admin tab missing after step 4**: the email in the SQL didn't match exactly, or you didn't reload. Check **Authentication > Users** for the exact address.
- **Market data load says "row-level security"**: step 2 wasn't run, or your login isn't in `platform_admins` yet (step 4).
