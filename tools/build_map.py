#!/usr/bin/env python3
"""Bake raw OpenStreetMap data (Overpass JSON) into the compact map file the game loads.

Usage:
    python3 tools/fetch_osm.py [district ...]   # downloads data/raw/<district>.osm.json
    python3 tools/build_map.py [district ...]   # writes data/<district>.json

Districts are listed in tools/districts.py. Coordinates in the output are metres in a
local frame centred on the district's hub landmark (the Ferry Building clock tower,
the Palace of Fine Arts rotunda): +x is east, +z is south (three.js convention).
Map data © OpenStreetMap contributors, available under the ODbL.
"""
import json
import math
import re
import sys
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import linemerge, split, unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
from districts import DISTRICTS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
M_PER_DEG_LAT = 110_950.0

# Set per district by configure().
LAT0 = LON0 = M_PER_DEG_LON = None
BOUNDS = None
LAND_PROBES_LATLON = []
BRIDGE_MATCH = {"names": [], "refs": []}


def configure(d):
    global LAT0, LON0, M_PER_DEG_LON, BOUNDS, LAND_PROBES_LATLON, BRIDGE_MATCH
    LAT0, LON0 = d["origin"]
    M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))
    BOUNDS = box(*d["clip"])
    LAND_PROBES_LATLON = d["probes"]
    BRIDGE_MATCH = d["bridge"]


def is_bridge_way(tags):
    if tags.get("bridge") not in ("yes", "viaduct") or tags.get("highway") not in ("motorway", "trunk", "primary"):
        return False
    name = (tags.get("name") or "").lower()
    ref = tags.get("ref") or ""
    return any(n in name for n in BRIDGE_MATCH["names"]) or any(r in ref for r in BRIDGE_MATCH["refs"])

ROAD_WIDTH = {
    "motorway": 14, "trunk": 13, "primary": 13, "secondary": 11, "tertiary": 10,
    "residential": 9, "unclassified": 8, "service": 5, "pedestrian": 7,
    "motorway_link": 8, "trunk_link": 8, "primary_link": 8, "footway": 3,
}


def project(lat, lon):
    return ((lon - LON0) * M_PER_DEG_LON, -(lat - LAT0) * M_PER_DEG_LAT)


def parse_len(v):
    if v is None:
        return None
    v = str(v).strip().lower().replace(",", ".")
    m = re.match(r"^([0-9.]+)\s*(m|ft|')?", v)
    if not m:
        return None
    try:
        n = float(m.group(1))
    except ValueError:
        return None
    if m.group(2) in ("ft", "'"):
        n *= 0.3048
    return n


def stable_rand(seed):
    """Deterministic 0..1 value from an OSM id, so rebuilds are stable."""
    x = (seed * 2654435761) & 0xFFFFFFFF
    return (x % 10_000) / 10_000.0


def building_heights(tags, osm_id):
    h = parse_len(tags.get("height"))
    levels = parse_len(tags.get("building:levels"))
    if h is None and levels is not None:
        h = levels * 3.6 + 1.5
    if h is None:
        kind = tags.get("building", tags.get("building:part", "yes"))
        if kind in ("kiosk", "shed", "hut", "toilets"):
            h = 4.0
        elif kind in ("house", "residential", "detached"):
            h = 10.0
        elif kind in ("roof", "canopy"):
            return None
        else:
            h = 10.0 + 14.0 * stable_rand(osm_id)
    mh = parse_len(tags.get("min_height"))
    if mh is None and tags.get("building:min_level"):
        mh = (parse_len(tags.get("building:min_level")) or 0) * 3.6
    return max(h, 3.0), max(mh or 0.0, 0.0)


def clean_ring(coords):
    pts = []
    for p in coords:
        if not pts or math.dist(p, pts[-1]) > 0.35:
            pts.append(p)
    if len(pts) > 1 and math.dist(pts[0], pts[-1]) < 0.35:
        pts.pop()
    return pts


def poly_from_geom(geom):
    coords = [project(g["lat"], g["lon"]) for g in geom]
    pts = clean_ring(coords)
    if len(pts) < 3:
        return None
    poly = Polygon(pts)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty or poly.area < 4:
        return None
    if poly.geom_type == "MultiPolygon":
        poly = max(poly.geoms, key=lambda g: g.area)
    return poly.simplify(0.4, preserve_topology=True)


def ring_out(poly):
    """Exterior ring, counter-clockwise in x/z (y-up seen from above), 1 dp."""
    ring = list(poly.exterior.coords)[:-1]
    area = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1]
               for i in range(len(ring)))
    if area < 0:
        ring.reverse()
    return [[round(x, 1), round(z, 1)] for x, z in ring]


POINT_KINDS = ["tree", "lamp", "signal", "crossing", "bus", "bench", "bike", "bin", "water", "post", "hydrant", "bollard"]


def point_kind(tags):
    """Street furniture category for an OSM node, or None."""
    if tags.get("natural") == "tree":
        return "tree"
    hw = tags.get("highway")
    if hw == "street_lamp":
        return "lamp"
    if hw == "traffic_signals":
        return "signal"
    if hw == "crossing":
        return "crossing"
    if hw == "bus_stop":
        return "bus"
    am = tags.get("amenity")
    if am == "bench":
        return "bench"
    if am == "bicycle_parking":
        return "bike"
    if am == "waste_basket":
        return "bin"
    if am == "drinking_water":
        return "water"
    if am == "post_box":
        return "post"
    if tags.get("emergency") == "fire_hydrant":
        return "hydrant"
    if tags.get("barrier") == "bollard":
        return "bollard"
    return None


def find_bridge(pts, land):
    """Fit the Bay Bridge axis and find where it leaves the shore."""
    if len(pts) < 2:
        return None
    n = len(pts)
    cx = sum(p[0] for p in pts) / n
    cz = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - cx) ** 2 for p in pts)
    szz = sum((p[1] - cz) ** 2 for p in pts)
    sxz = sum((p[0] - cx) * (p[1] - cz) for p in pts)
    ang = 0.5 * math.atan2(2 * sxz, sxx - szz)
    dx, dz = math.cos(ang), math.sin(ang)
    # Point the axis from the end that sits on land out toward the water.
    proj = [((p[0] - cx) * dx + (p[1] - cz) * dz) for p in pts]
    lo, hi = min(proj), max(proj)
    lo_land = land.contains(Point(cx + dx * lo, cz + dz * lo))
    hi_land = land.contains(Point(cx + dx * hi, cz + dz * hi))
    if (hi_land and not lo_land) or (lo_land == hi_land and dx < 0):
        dx, dz = -dx, -dz
    # Walk along the axis from the inland end and stop at the first step into water.
    proj = [((p[0] - cx) * dx + (p[1] - cz) * dz) for p in pts]
    u = min(proj) - 50
    shore = None
    was_land = land.contains(Point(cx + dx * u, cz + dz * u))
    while u < max(proj) + 3000:
        on_land = land.contains(Point(cx + dx * u, cz + dz * u))
        if was_land and not on_land:
            shore = (cx + dx * u, cz + dz * u)
            break
        was_land = on_land
        u += 2
    if shore is None:
        return None
    return {"shore": [round(shore[0], 1), round(shore[1], 1)], "dir": [round(dx, 4), round(dz, 4)]}


def build(did):
    d = DISTRICTS[did]
    configure(d)
    RAW = ROOT / "data" / "raw" / f"{did}.osm.json"
    OUT = ROOT / "data" / f"{did}.json"
    if not RAW.exists():
        sys.exit(f"Missing {RAW}. Run tools/fetch_osm.py {did} first.")
    data = json.loads(RAW.read_text())
    elements = data["elements"]

    outlines, parts, roads, piers, parks, coast = [], [], [], [], [], []
    bridge_pts = []
    points = {k: [] for k in POINT_KINDS}
    rails = []
    for el in elements:
        tags = el.get("tags", {})
        if el["type"] == "node":
            kind = point_kind(tags)
            if kind:
                x, z = project(el["lat"], el["lon"])
                if BOUNDS.contains(Point(x, z)):
                    points[kind].append([round(x, 1), round(z, 1)])
            continue
        geoms = []
        if el["type"] == "way" and "geometry" in el:
            geoms = [el["geometry"]]
        elif el["type"] == "relation":
            geoms = [m["geometry"] for m in el.get("members", [])
                     if m.get("role") == "outer" and "geometry" in m]
        for geom in geoms:
            closed = len(geom) > 3 and geom[0] == geom[-1]
            if "building:part" in tags and closed:
                poly = poly_from_geom(geom)
                if poly:
                    parts.append((poly, tags, el["id"]))
            elif "building" in tags and closed:
                poly = poly_from_geom(geom)
                if poly:
                    outlines.append((poly, tags, el["id"]))
            elif tags.get("natural") == "coastline":
                coast.append(LineString([project(g["lat"], g["lon"]) for g in geom]))
            elif tags.get("man_made") in ("pier", "breakwater", "groyne"):
                if closed:
                    poly = poly_from_geom(geom)
                else:
                    line = LineString([project(g["lat"], g["lon"]) for g in geom])
                    poly = line.buffer(float(parse_len(tags.get("width")) or 5) / 2, cap_style=2)
                if poly is not None and not poly.is_empty:
                    piers.append(poly)
            elif tags.get("railway") in ("tram", "light_rail"):
                if tags.get("tunnel") in ("yes",) or (tags.get("layer") or "0").lstrip("-") not in ("0", ""):
                    continue
                line = LineString([project(g["lat"], g["lon"]) for g in geom]).intersection(BOUNDS)
                for ln in ([line] if line.geom_type == "LineString" else getattr(line, "geoms", [])):
                    if ln.geom_type == "LineString" and ln.length > 5:
                        rails.append([[round(x, 1), round(z, 1)] for x, z in ln.simplify(0.4).coords])
            elif tags.get("leisure") == "park" and closed:
                poly = poly_from_geom(geom)
                if poly:
                    parks.append(poly)
            elif "highway" in tags:
                if is_bridge_way(tags):
                    bridge_pts += [project(g["lat"], g["lon"]) for g in geom]
                if tags.get("bridge") in ("yes", "viaduct") or tags.get("tunnel") in ("yes", "building_passage"):
                    continue
                if tags.get("layer") and tags["layer"].lstrip("-").isdigit() and int(tags["layer"]) != 0:
                    continue
                width = ROAD_WIDTH.get(tags["highway"])
                if width is None:
                    continue
                pts = [project(g["lat"], g["lon"]) for g in geom]
                roads.append((pts, width, tags["highway"], tags.get("name")))

    # Drop building outlines that are detailed by building:part pieces.
    part_union = unary_union([p for p, _, _ in parts]) if parts else None
    buildings = []
    for poly, tags, oid in outlines:
        if part_union is not None and poly.intersection(part_union).area > 0.5 * poly.area:
            continue
        buildings.append((poly, tags, oid))
    buildings += parts

    out_buildings = []
    for poly, tags, oid in buildings:
        if not BOUNDS.contains(poly.centroid):
            continue
        hh = building_heights(tags, oid)
        if hh is None:
            continue
        h, mh = hh
        if h - mh < 2.5:
            continue
        rec = {"p": ring_out(poly), "h": round(h, 1)}
        if mh > 0:
            rec["b"] = round(mh, 1)
        name = tags.get("name")
        if name:
            rec["n"] = name
        mat = tags.get("building:material") or tags.get("building:colour")
        if mat:
            rec["m"] = mat
        out_buildings.append(rec)

    # Land: split the play box with the coastline and keep pieces holding land probes.
    land_polys = []
    if coast:
        merged = linemerge(unary_union(coast))
        pieces = split(BOUNDS, merged)
        probes = [Point(project(*ll)) for ll in LAND_PROBES_LATLON]
        for g in pieces.geoms:
            if any(g.contains(p) for p in probes):
                land_polys.append(g)
    if not land_polys:
        land_polys = [BOUNDS]
    land = unary_union(land_polys + [p.intersection(BOUNDS) for p in piers])
    land = land.simplify(0.6, preserve_topology=True)
    land_list = [land] if land.geom_type == "Polygon" else list(land.geoms)

    def poly_list(polys):
        res = []
        for p in polys:
            p = p.intersection(BOUNDS)
            for g in ([p] if p.geom_type == "Polygon" else getattr(p, "geoms", [])):
                if g.geom_type == "Polygon" and g.area > 20:
                    res.append(ring_out(g))
        return res

    out_roads = []
    for pts, width, kind, name in roads:
        line = LineString(pts).intersection(BOUNDS)
        if line.is_empty:
            continue
        lines = [line] if line.geom_type == "LineString" else [g for g in getattr(line, "geoms", []) if g.geom_type == "LineString"]
        for ln in lines:
            ln = ln.simplify(0.5)
            coords = [[round(x, 1), round(z, 1)] for x, z in ln.coords]
            if len(coords) >= 2:
                rec = {"p": coords, "w": width, "k": kind}
                if name:
                    rec["n"] = name
                out_roads.append(rec)

    bridge = find_bridge(bridge_pts, land)

    out = {
        "meta": {
            "bridge": bridge,
            "id": did,
            "name": d["name"],
            "origin": {"lat": LAT0, "lon": LON0},
            "bounds": [round(c, 1) for c in BOUNDS.bounds],
            "attribution": "Map data © OpenStreetMap contributors (ODbL)",
            "mPerDeg": [round(M_PER_DEG_LON, 3), round(M_PER_DEG_LAT, 3)],
        },
        "land": poly_list(land_list),
        "piers": poly_list([p for p in piers]),
        "parks": poly_list(parks),
        "roads": out_roads,
        "buildings": out_buildings,
        "points": points,
        "rails": rails,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print("points:", {k: len(v) for k, v in points.items()}, "rails:", len(rails))
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out_buildings)} buildings, {len(out_roads)} roads, "
          f"{len(out['piers'])} piers, {len(out['land'])} land polys, {OUT.stat().st_size // 1024} KB")


def main():
    for did in sys.argv[1:] or list(DISTRICTS):
        build(did)


if __name__ == "__main__":
    main()
