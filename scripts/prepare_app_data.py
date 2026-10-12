"""Build the app's data files from the project pipeline outputs (run in the data workspace).

Inputs:  /home/claude/mmi/data/tool_data_v1.json, data/geo/zcta_cbsa.csv, US state outlines (us-atlas)
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
