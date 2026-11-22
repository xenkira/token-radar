# Token Radar — make.fun token-radar-01

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/xenkira/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/xenkira/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Entered on [make.fun](https://make.fun/bounty/token-radar-01) for the token-radar-01 bounty.

Pre-token protocols ranked by implied value, from the sealed DefiLlama snapshot
(758 protocols, snapshot 2026-11-14, watchlist floor $50M). The board holds 200
rows: all 40 watchlist protocols plus the 160 best-scoring eligible pre-token
protocols below the floor. Protocols that already record a token are never
ranked; they are counted separately as the live market.

## Value model

```
implied = round(5,000,000 * (tvl_usd/1e6)^0.55 * growth * maturity * reach / 1000) * 1000
growth   = 1 + clamp(change_7d, -50, 100)/100 * 0.6
maturity = 0.75 + min(age_days, 1460)/1460 * 0.50   (age from listed_at to as_of; unknown = 365)
reach    = 1 + 0.02 * min(chains-1, 10)
```

The same function scores every protocol; no name is special-cased. Eligibility
excludes token-bearing protocols and wrapped / staked / bridged products, CEXs,
bridges and liquid-staking products. Implied value is this entry's own claim
from the snapshot figures — not a prediction that a token will launch.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Requires Node 22.18 or later, standard library only, no network at runtime.
`main.ts` writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json` (via `vendor/makefun-board.ts`).
Open `out/dashboard/index.html` to use the dashboard: search, sort by rank /
implied value / TVL / 7d change, filter by category, chain or watchlist-only,
and click any row for its detail view and farm plan.
