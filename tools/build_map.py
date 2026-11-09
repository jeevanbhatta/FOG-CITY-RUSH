#!/usr/bin/env python3
"""Bake raw OpenStreetMap data (Overpass JSON) into the compact map file the game loads.

Usage:
    python3 tools/fetch_osm.py            # downloads data/raw/embarcadero.osm.json
    python3 tools/build_map.py            # writes data/embarcadero.json

Coordinates in the output are metres in a local frame centred on the Ferry
Building clock tower: +x is east, +z is south (three.js convention, -z = north).
Map data © OpenStreetMap contributors, available under the ODbL.
"""
import json
import math
import re
import sys
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import linemerge, split, unary_union

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "embarcadero.osm.json"
OUT = ROOT / "data" / "embarcadero.json"

# Ferry Building clock tower.
LAT0, LON0 = 37.79553, -122.39370
M_PER_DEG_LAT = 110_950.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))

# Playable square (metres) around the origin.
HALF = 900.0
BOUNDS = box(-HALF - 250, -HALF, HALF + 250, HALF + 400)

# Points we know are on land, used to pick the land side of the coastline.
LAND_PROBES_LATLON = [
    (37.7936, -122.3965),  # Market & Front
    (37.7975, -122.4010),  # Jackson Square
    (37.7890, -122.3960),  # 2nd & Mission
]

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
    if dx < 0:
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


def main():
    if not RAW.exists():
        sys.exit(f"Missing {RAW}. Run tools/fetch_osm.py first.")
    data = json.loads(RAW.read_text())
    elements = data["elements"]

    outlines, parts, roads, piers, parks, coast = [], [], [], [], [], []
    bridge_pts = []
    for el in elements:
        tags = el.get("tags", {})
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
            elif tags.get("man_made") == "pier":
                if closed:
                    poly = poly_from_geom(geom)
                else:
                    line = LineString([project(g["lat"], g["lon"]) for g in geom])
                    poly = line.buffer(float(parse_len(tags.get("width")) or 5) / 2, cap_style=2)
                if poly is not None and not poly.is_empty:
                    piers.append(poly)
            elif tags.get("leisure") == "park" and closed:
                poly = poly_from_geom(geom)
                if poly:
                    parks.append(poly)
            elif "highway" in tags:
                if tags.get("bridge") in ("yes", "viaduct") and tags.get("highway") == "motorway" and (
                        "bay bridge" in (tags.get("name") or "").lower() or "I 80" in (tags.get("ref") or "")):
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
            "name": "Embarcadero",
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
    }
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out_buildings)} buildings, {len(out_roads)} roads, "
          f"{len(out['piers'])} piers, {len(out['land'])} land polys, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
