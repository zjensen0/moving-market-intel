# Moving Market Intelligence — Acumena Analytics

Market intelligence for moving and storage companies, sold by Acumena. Clients sign in, see demand, long-distance lanes, competitors, labor and costs for the markets in their plan, and upload their own jobs to see how they stack up against the market.

- **Setup guide**: [SETUP.md](SETUP.md) (Supabase + Cloudflare Pages, about 45 minutes)
- **Demo**: `npm run build:demo` produces one self-contained HTML file with a sample client and no login

## What's in here

| Folder | What it is |
| --- | --- |
| `src/` | The web app (TypeScript, no framework; d3 for charts) |
| `src/views/` | Pages: market snapshot, compare markets, your business, admin, data & methods, sign-in |
| `src/business/` | Reading client CSVs, comparing jobs to the market, plain-language insights |
| `src/data/` | Two data sources with one interface: `supabase.ts` (live) and `demo.ts` (bundled sample) |
| `data/` | `market_data.json` (387 metros, built by the data pipeline), `zip_cbsa.json` (ZIP to metro), state outlines |
| `supabase/migrations/` | Database schema, access rules (row-level security) and helper functions |
| `scripts/` | `load_market_data.mjs` is an optional command-line loader (needs the secret key; the Admin page does the same without it); `prepare_app_data.py` builds the data files from the pipeline output |
| `tests/` | Unit tests (`npm test`) and database rule tests (`npm run test:db`) |

## How access works

- Every signed-in user belongs to at most one company (joined with an invite code). Admins are listed in `platform_admins`.
- `market_snapshots` rows are only readable when the company's plan includes that metro (or the plan is "all", or the reader is an admin). The database enforces this, not the front end.
- `client_jobs` rows are readable and writable only by that company's members and admins.
- The website only ever holds the publishable key. Admins load market data from the Admin page; database rules allow that for admins only.

## Data

All public sources; see the Data & methods page in the app for the list, dates and caveats. The pipeline that builds `market_data.json` lives outside this repo (Census, IRS, Zillow, FMCSA, BLS, EIA, Freddie Mac, USAspending).
