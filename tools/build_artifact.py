#!/usr/bin/env python3
"""Package the game for publishing as a claude.ai Artifact.

The Artifact host wraps the page in its own <html>/<head>/<body>, so this strips those
tags from index.html and copies the modules and map data next to it in dist/artifact/.
"""
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist" / "artifact"


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    html = (ROOT / "index.html").read_text()
    html = re.sub(r"<!doctype html>\s*", "", html, flags=re.I)
    html = re.sub(r"</?html[^>]*>\s*", "", html, flags=re.I)
    html = re.sub(r"</?head>\s*", "", html, flags=re.I)
    html = re.sub(r"</?body>\s*", "", html, flags=re.I)
    html = re.sub(r'<meta charset="utf-8">\s*', "", html)
    html = re.sub(r'<meta name="viewport"[^>]*>\s*', "", html)
    # <title> must come first for the host to pick it up.
    title = re.search(r"<title>.*?</title>\s*", html).group(0)
    html = title + html.replace(title, "", 1)
    (OUT / "index.html").write_text(html)
    shutil.copytree(ROOT / "src", OUT / "src")
    (OUT / "data").mkdir()
    for data in sorted((ROOT / "data").glob("*.json")):
        shutil.copy(data, OUT / "data" / data.name)
    print("files:")
    for p in sorted(OUT.rglob("*")):
        if p.is_file():
            print(" ", p.relative_to(OUT), f"{p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
