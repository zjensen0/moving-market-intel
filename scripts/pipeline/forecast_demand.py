"""90-day home-sales (move-demand) forecast for every metro, with a back-test.

What it predicts: for each metro, home sales over the next three months compared with the same
three months a year earlier (log growth). Metros where Zillow publishes no sales counts use new
listings instead. That growth is applied to last year's sales for those months, and the share of a
year's sales they represent turns the metro's household-moves estimate into "moves in the next 90 days".

Why sales: moves cluster around home closings, and new listings lead closings by one to two months,
so recent listings, recent sales and mortgage-rate changes carry real signal three months out.

Model: one gradient-boosted model pooled across all metros (small metros borrow strength from big
ones). Back-test: rolling origin. For every month from Jan 2023 to the last month with a known
answer, the model is refit only on data that existed at that time and scored against what actually
happened, then compared with two naive guesses: "same as last year" and "recent trend continues".
Ranges come from the back-test errors (10th to 90th percentile), separately for small, mid and large metros.

Inputs : data/zillow_monthly.csv, data/fred_series.csv (MORTGAGE30US), data/tool_data_v1.json
Outputs: data/forecast_demand.csv, data/forecast_backtest.json, data/forecast_backtest_detail.csv
"""
import json
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

D = "/home/claude/mmi/data"
H = 3  # months ahead

z = pd.read_csv(f"{D}/zillow_monthly.csv", dtype={"cbsa": str})
tool = json.load(open(f"{D}/tool_data_v1.json"))
metros = {m["c"]: m for m in tool["metros"]}

# ---- series per metro: sales where published, otherwise new listings
z["month"] = pd.PeriodIndex(z["month"], freq="M")
has_sales = z.groupby("cbsa")["sales_count"].apply(lambda s: s.notna().sum() >= 60)
z["y"] = np.where(z["cbsa"].map(has_sales), z["sales_count"], z["new_listings"])
z["src"] = np.where(z["cbsa"].map(has_sales), "sales", "listings")
W = z.pivot(index="month", columns="cbsa", values="y").sort_index()
L = z.pivot(index="month", columns="cbsa", values="new_listings").sort_index()
SRC = z.groupby("cbsa")["src"].first()
months = W.index

# ---- mortgage rate, monthly average
f = pd.read_csv(f"{D}/fred_series.csv")
mr = f[f.series_id == "MORTGAGE30US"].copy()
mr["month"] = pd.PeriodIndex(pd.to_datetime(mr["date"]), freq="M")
rate = mr.groupby("month")["value"].mean().reindex(months).ffill()

lg = lambda a, b: np.log(np.maximum(a, 1) / np.maximum(b, 1))
roll = lambda df, k: df.rolling(k, min_periods=k).sum()

S3, S12, L3 = roll(W, 3), roll(W, 12), roll(L, 3)
nat3 = W.sum(axis=1, min_count=50).rolling(3).sum()

rows = []
for i in range(12, len(months)):
    t = months[i]
    for c in W.columns:
        s3, s3y = S3[c].iloc[i], S3[c].iloc[i - 12]
        if not (np.isfinite(s3) and np.isfinite(s3y)) or s3y <= 0:
            continue
        r = {
            "origin": t, "cbsa": c,
            "g_s3": lg(s3, s3y),
            "g_s1": lg(W[c].iloc[i], W[c].iloc[i - 12]),
            "g_l3": lg(L3[c].iloc[i], L3[c].iloc[i - 12]) if np.isfinite(L3[c].iloc[i]) and np.isfinite(L3[c].iloc[i - 12]) else np.nan,
            "g_l1": lg(L[c].iloc[i], L[c].iloc[i - 12]) if np.isfinite(L[c].iloc[i]) and np.isfinite(L[c].iloc[i - 12]) else np.nan,
            "g_s12": lg(S12[c].iloc[i], S12[c].iloc[i - 12]) if i >= 23 and np.isfinite(S12[c].iloc[i - 12]) else np.nan,
            "d_rate12": rate.iloc[i] - rate.iloc[i - 12],
            "d_rate3": rate.iloc[i] - rate.iloc[i - 3],
            "rate": rate.iloc[i],
            "g_nat3": lg(nat3.iloc[i], nat3.iloc[i - 12]),
            "tgt_month": (t.month % 12) + 1,
            "log_size": np.log(max(S12[c].iloc[i], 1)) if np.isfinite(S12[c].iloc[i]) else np.nan,
        }
        if i + H < len(months):
            fut, futy = W[c].iloc[i + 1:i + 1 + H].sum(min_count=H), W[c].iloc[i - 11:i - 11 + H].sum(min_count=H)
            r["target"] = lg(fut, futy) if np.isfinite(fut) and np.isfinite(futy) else np.nan
        else:
            r["target"] = np.nan
        rows.append(r)
X = pd.DataFrame(rows)
FEATS = ["g_s3", "g_s1", "g_l3", "g_l1", "g_s12", "d_rate12", "d_rate3", "rate", "g_nat3", "tgt_month", "log_size"]
print("rows", len(X), "with targets", X.target.notna().sum(), "origins", X.origin.min(), "to", X.origin.max())


def fit(train):
    m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=40,
                                      l2_regularization=1.0, random_state=0)
    m.fit(train[FEATS], train["target"])
    return m


# ---- back-test: rolling origin, refit every 3 months on data known at the time
known = X[X.target.notna()]
test_origins = [o for o in sorted(known.origin.unique()) if o >= pd.Period("2023-01", "M")]
preds = []
model = None
for k, o in enumerate(test_origins):
    if k % 3 == 0:
        train = known[known.origin <= o - H]  # targets fully observed by origin o
        model = fit(train)
    te = known[known.origin == o]
    p = te[["origin", "cbsa", "target", "g_s3", "log_size"]].copy()
    raw = model.predict(te[FEATS])
    # bias correction from earlier back-test errors only (what we'd have known at the time)
    past = [q for q in preds if q["origin"].iloc[0] <= o - H]
    bias = float(np.median(np.concatenate([(q["target"] - q["raw"]).values for q in past[-12:]]))) if past else 0.0
    p["raw"] = raw
    p["model"] = raw  # tested: a rolling bias correction (bias above) made 2023 worse and raised overall error, so it is not applied
    preds.append(p)
P = pd.concat(preds)
P["same_as_last_year"] = 0.0
P["trend_continues"] = P["g_s3"]
P["size"] = pd.cut(P["log_size"], [-1, np.log(12000), np.log(40000), 99], labels=["small", "mid", "large"])


def score(col, df=P):
    e = df[col] - df["target"]
    return {"mae_pct": round(float(np.mean(np.abs(np.expm1(df[col]) - np.expm1(df["target"])))) * 100, 2),
            "median_abs_pct": round(float(np.median(np.abs(np.expm1(df[col]) - np.expm1(df["target"])))) * 100, 2),
            "direction_right": round(float(np.mean(np.sign(df[col]) == np.sign(df["target"]))) * 100, 1) if col != "same_as_last_year" else None,
            "bias_pct": round(float(np.mean(e)) * 100, 2)}


bt = {"test_period": f"{test_origins[0]} to {test_origins[-1]} (forecast origins)", "forecasts_scored": int(len(P)),
      "metros": int(P.cbsa.nunique()),
      "model": score("model"), "same_as_last_year": score("same_as_last_year"), "trend_continues": score("trend_continues"),
      "by_size": {}, "by_year": {}}
for s, g in P.groupby("size", observed=True):
    bt["by_size"][str(s)] = {"model": score("model", g), "trend_continues": score("trend_continues", g), "n": int(len(g))}
for y, g in P.groupby(P.origin.dt.year):
    bt["by_year"][str(y)] = {"model": score("model", g), "same_as_last_year": score("same_as_last_year", g),
                             "trend_continues": score("trend_continues", g), "n": int(len(g))}
# interval widths from back-test residuals, by size
P["resid"] = P["target"] - P["model"]
Q = {str(s): (float(g.resid.quantile(0.1)), float(g.resid.quantile(0.9))) for s, g in P.groupby("size", observed=True)}
cover = []
for s, g in P.groupby("size", observed=True):
    lo, hi = Q[str(s)]
    cover.append(((g.resid >= lo) & (g.resid <= hi)).mean())
bt["interval"] = {"level": "80% (10th to 90th percentile of back-test errors)", "by_size_log": Q}
print(json.dumps({k: bt[k] for k in ["model", "same_as_last_year", "trend_continues", "by_size"]}, indent=1))
P.to_csv(f"{D}/forecast_backtest_detail.csv", index=False)

# ---- final model on everything known; forecast from the last month
final = fit(known)
last = X.origin.max()
cur = X[X.origin == last].copy()
recent = P[P.origin > P.origin.max() - 12]
BIAS = 0.0  # see back-test note; the ranges below come from actual errors and already carry the model's slight low lean
cur["yhat"] = final.predict(cur[FEATS]) + BIAS
cur["size"] = pd.cut(cur["log_size"], [-1, np.log(12000), np.log(40000), 99], labels=["small", "mid", "large"])
i = len(months) - 1
out = []
for _, r in cur.iterrows():
    c = r.cbsa
    lo_q, hi_q = Q.get(str(r["size"]), Q["mid"])
    ly = [W[c].iloc[i - 11 + k] for k in range(H)]  # same months last year
    if not all(np.isfinite(ly)):
        continue
    w12 = W[c].iloc[i - 11:i + 1]
    s12 = float(w12.mean() * 12) if w12.notna().sum() >= 10 else None
    m = metros.get(c)
    hhm = m.get("hhm") if m else None
    g, glo, ghi = float(r.yhat), float(r.yhat + lo_q), float(r.yhat + hi_q)
    fut = [v * np.exp(g) for v in ly]
    share = sum(fut) / s12 if s12 and s12 > 0 else None
    out.append({
        "cbsa": c, "source": SRC[c], "origin": str(last),
        "months": "|".join(str(last + k + 1) for k in range(H)),
        "last_year": "|".join(str(int(round(v))) for v in ly),
        "fcst": "|".join(str(int(round(v))) for v in fut),
        "fcst_lo": "|".join(str(int(round(v * np.exp(glo)))) for v in ly),
        "fcst_hi": "|".join(str(int(round(v * np.exp(ghi)))) for v in ly),
        "growth": round(float(np.expm1(g)), 4), "growth_lo": round(float(np.expm1(glo)), 4), "growth_hi": round(float(np.expm1(ghi)), 4),
        "moves90": int(round(hhm * share)) if hhm and share else None,
        "moves90_lo": int(round(hhm * share * np.exp(lo_q))) if hhm and share else None,
        "moves90_hi": int(round(hhm * share * np.exp(hi_q))) if hhm and share else None,
        "recent3": round(float(np.expm1(r.g_s3)), 4),
    })
F = pd.DataFrame(out)
F.to_csv(f"{D}/forecast_demand.csv", index=False)
bt["forecast_origin"] = str(last)
bt["forecast_months"] = [str(last + k + 1) for k in range(H)]
bt["built"] = pd.Timestamp.today().strftime("%Y-%m-%d")
json.dump(bt, open(f"{D}/forecast_backtest.json", "w"), indent=1)
print("forecast metros:", len(F), "| months:", bt["forecast_months"])
print(F.sort_values("growth").iloc[[0, 1, -2, -1]][["cbsa", "growth", "growth_lo", "growth_hi", "moves90"]])
print(F[F.cbsa.isin(["16740", "35620", "19820"])][["cbsa", "source", "fcst", "last_year", "growth", "growth_lo", "growth_hi", "moves90", "moves90_lo", "moves90_hi", "recent3"]].to_string())
