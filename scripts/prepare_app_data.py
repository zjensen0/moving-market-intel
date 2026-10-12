"""Build the app's data files from the project pipeline outputs (run in the data workspace).

Inputs:  /home/claude/mmi/data/tool_data_v1.json, data/geo/zcta_cbsa.csv, US state outlines (us-atlas),
         data/forecast_demand.csv + data/forecast_backtest.json (scripts/forecast_demand.py)
Outputs: data/market_data.json          national block + every metro (demo bundle and Supabase loader)
         data/zip_cbsa.json      5-digit ZIP -> metro code, for mapping client job ZIPs
         data/us-states-albers.json   state outlines for the lanes map
"""
import csv
import json
import os

SRC = "/home/claude/mmi"
OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

tool = json.load(open(f"{SRC}/data/tool_data_v1.json"))

# 90-day demand forecast (scripts/forecast_demand.py)
fc_path = f"{SRC}/data/forecast_demand.csv"
if os.path.exists(fc_path):
    ints = lambda v: [int(x) for x in v.split("|")]
    fc = {}
    with open(fc_path, newline="") as f:
        for r in csv.DictReader(f):
            num = lambda k: (float(r[k]) if r[k] not in ("", "nan") else None)
            fc[r["cbsa"]] = {
                "src": r["source"], "m": r["months"].split("|"), "ly": ints(r["last_year"]), "f": ints(r["fcst"]),
                "lo": ints(r["fcst_lo"]), "hi": ints(r["fcst_hi"]),
                "g": num("growth"), "glo": num("growth_lo"), "ghi": num("growth_hi"), "r3": num("recent3"),
                "mv": int(num("moves90")) if num("moves90") is not None else None,
                "mvlo": int(num("moves90_lo")) if num("moves90_lo") is not None else None,
                "mvhi": int(num("moves90_hi")) if num("moves90_hi") is not None else None,
            }
    bt = json.load(open(f"{SRC}/data/forecast_backtest.json"))
    tool["fc"] = {
        "origin": bt["forecast_origin"], "months": bt["forecast_months"], "built": bt["built"],
        "period": bt["test_period"], "n": bt["forecasts_scored"],
        "mae": bt["model"]["mae_pct"], "dir": bt["model"]["direction_right"],
        "mae_trend": bt["trend_continues"]["mae_pct"], "mae_same": bt["same_as_last_year"]["mae_pct"],
        "by_year": {y: [v["model"]["mae_pct"], v["trend_continues"]["mae_pct"], v["same_as_last_year"]["mae_pct"]] for y, v in bt["by_year"].items()},
        "by_size": {k: v["model"]["mae_pct"] for k, v in bt["by_size"].items()},
    }
    for m in tool["metros"]:
        m["fc"] = fc.get(m["c"])
    print("forecasts attached:", sum(1 for m in tool["metros"] if m["fc"]))
with open(f"{OUT}/data/market_data.json", "w") as f:
    json.dump(tool, f, separators=(",", ":"))

zmap = {}
with open(f"{SRC}/data/geo/zcta_cbsa.csv", newline="") as f:
    for r in csv.DictReader(f):
        if r["type"] == "metro" and r["cbsa"]:
            zmap[r["zcta"]] = r["cbsa"]
with open(f"{OUT}/data/zip_cbsa.json", "w") as f:
    json.dump(zmap, f, separators=(",", ":"))

states = json.load(open(f"{SRC}/raw/usatlas/package/states-albers-10m.json"))
with open(f"{OUT}/data/us-states-albers.json", "w") as f:
    json.dump(states, f, separators=(",", ":"))
print("metros:", len(tool["metros"]), "zips:", len(zmap))
