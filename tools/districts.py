"""Neighbourhoods the game can load. Each one is fetched and baked into data/<id>.json.

origin   lat/lon of the local (0, 0): the district's hub landmark.
bbox     south, west, north, east for OpenStreetMap features.
coast    a larger box for the coastline, so it fully crosses the play area.
clip     playable box in local metres: min x, min z, max x, max z (+z is south).
probes   lat/lon points known to be on land, to pick the land side of the coastline.
bridge   how to recognise the suspension bridge's OSM ways (name or ref substring).
"""

DISTRICTS = {
    "embarcadero": {
        "name": "Embarcadero",
        "origin": (37.79553, -122.39370),  # Ferry Building clock tower
        "bbox": "37.7825,-122.4075,37.8040,-122.3780",
        "coast": "37.7700,-122.4200,37.8150,-122.3650",
        "clip": (-1150, -900, 1150, 1300),
        "probes": [(37.7936, -122.3965), (37.7975, -122.4010), (37.7890, -122.3960)],
        "bridge": {"names": ["bay bridge"], "refs": ["I 80"]},
    },
    "marina": {
        "name": "Marina & Crissy Field",
        "origin": (37.80286, -122.44842),  # Palace of Fine Arts rotunda
        "bbox": "37.7960,-122.4805,37.8120,-122.4335",
        "coast": "37.7900,-122.4900,37.8235,-122.4200",
        "clip": (-2780, -2350, 1150, 650),
        "probes": [(37.8010, -122.4370), (37.8000, -122.4600), (37.8030, -122.4520)],
        "bridge": {"names": ["golden gate bridge"], "refs": []},  # US 101 also tags the Presidio viaducts
    },
}
