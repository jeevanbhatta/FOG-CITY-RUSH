#!/usr/bin/env python3
"""Download raw OpenStreetMap extracts for each district from the Overpass API.

Usage: python3 tools/fetch_osm.py [district ...]   (default: every district)
Writes data/raw/<district>.osm.json. Run tools/build_map.py afterwards.
Respects HTTPS_PROXY from the environment. Map data © OpenStreetMap contributors.
"""
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from districts import DISTRICTS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = "https://overpass-api.de/api/interpreter"


def query(BBOX, COAST_BBOX):
    return f"""
[out:json][timeout:120];
(
  way["building"]({BBOX});
  relation["building"]({BBOX});
  way["building:part"]({BBOX});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|pedestrian|footway|motorway_link|trunk_link|primary_link)$"]({BBOX});
  way["man_made"~"^(pier|breakwater|groyne)$"]({BBOX});
  way["natural"="coastline"]({COAST_BBOX});
  way["leisure"="park"]({BBOX});
  node["natural"="tree"]({BBOX});
  node["highway"~"^(street_lamp|traffic_signals|crossing|bus_stop)$"]({BBOX});
  node["amenity"~"^(bench|bicycle_parking|waste_basket|drinking_water|post_box)$"]({BBOX});
  node["emergency"="fire_hydrant"]({BBOX});
  node["barrier"="bollard"]({BBOX});
  way["railway"~"^(tram|light_rail)$"]({BBOX});
);
out body geom;
"""


def fetch(did):
    d = DISTRICTS[did]
    OUT = ROOT / "data" / "raw" / f"{did}.osm.json"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = urllib.parse.urlencode({"data": query(d["bbox"], d["coast"])}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={"User-Agent": "fog-city-rush-map-builder/0.1"})
    raw = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read()
            break
        except Exception as e:  # Overpass rate-limits busy clients; back off and retry.
            wait = 20 * (attempt + 1)
            print(f"attempt {attempt + 1} failed ({e}); retrying in {wait}s")
            time.sleep(wait)
    if raw is None:
        sys.exit(f"Could not download {did} from Overpass.")
    OUT.write_bytes(raw)
    print(f"wrote {OUT.relative_to(ROOT)} ({len(raw) // 1024} KB)")


def main():
    for did in sys.argv[1:] or list(DISTRICTS):
        fetch(did)
        time.sleep(5)  # be gentle with the public Overpass server


if __name__ == "__main__":
    sys.exit(main())
