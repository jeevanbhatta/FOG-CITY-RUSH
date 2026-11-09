#!/usr/bin/env python3
"""Download the raw Embarcadero OpenStreetMap extract from the Overpass API.

Writes data/raw/embarcadero.osm.json. Run tools/build_map.py afterwards.
Respects HTTPS_PROXY from the environment. Map data © OpenStreetMap contributors.
"""
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "raw" / "embarcadero.osm.json"
ENDPOINT = "https://overpass-api.de/api/interpreter"

# south, west, north, east
BBOX = "37.7825,-122.4075,37.8040,-122.3780"
COAST_BBOX = "37.7700,-122.4200,37.8150,-122.3650"

QUERY = f"""
[out:json][timeout:120];
(
  way["building"]({BBOX});
  relation["building"]({BBOX});
  way["building:part"]({BBOX});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|pedestrian|footway|motorway_link|trunk_link|primary_link)$"]({BBOX});
  way["man_made"="pier"]({BBOX});
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


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = urllib.parse.urlencode({"data": QUERY}).encode()
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
        sys.exit("Could not download map data from Overpass.")
    OUT.write_bytes(raw)
    print(f"wrote {OUT.relative_to(ROOT)} ({len(raw) // 1024} KB)")


if __name__ == "__main__":
    sys.exit(main())
