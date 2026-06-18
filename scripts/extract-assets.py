#!/usr/bin/env python3
"""Extract portrait + portfolio screenshots from the supplied Upwork .webarchive files.

Safari webarchives are binary plists. The useful images (profile portrait, portfolio
project screenshots, GitHub avatar) live in WebSubresources as raw bytes. We parse with
plistlib, classify by source URL, dedupe by sha256, and write into assets/img/.

Usage:  python3 scripts/extract-assets.py
Run from the repo root. Source .webarchive files are git-ignored local material.
"""
from __future__ import annotations

import hashlib
import os
import plistlib
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVES = [
    "upwork.webarchive",
    "upwork_proj1.webarchive",
    "upwork_proj2.webarchive",
    "upwork_proj3.webarchive",
]
SRC_DIR = os.path.join(ROOT, "private")  # local-only source material (git-ignored)
IMG_DIR = os.path.join(ROOT, "assets", "img")
PROJ_DIR = os.path.join(IMG_DIR, "projects")

# Source-URL substrings we explicitly skip (site chrome / 3rd-party widgets).
SKIP = (
    "cookielaw.org",
    "vuejs.org",
    "ui-images",
    "flags.png",
    "privacy-options",
    "uma-hero",
    "upwork-cloud-acquisition",
)


def classify(url: str) -> str | None:
    u = url.lower()
    if any(s in u for s in SKIP):
        return None
    if "profile-portraits" in u:
        return "portrait"
    if "portfolio" in u or "/profile/projects/" in u:
        return "project"
    if "avatars.githubusercontent.com" in u:
        return "avatar"
    return None  # ignore anything else


def png_size(data: bytes):
    if data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR":
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    return None


def main() -> int:
    os.makedirs(PROJ_DIR, exist_ok=True)
    seen: dict[str, dict] = {}  # sha256 -> record
    for name in ARCHIVES:
        path = os.path.join(SRC_DIR, name)
        if not os.path.exists(path):
            print(f"!! missing {name} (skipping)")
            continue
        with open(path, "rb") as fh:
            pl = plistlib.load(fh)
        for sub in pl.get("WebSubresources", []) or []:
            mime = str(sub.get("WebResourceMIMEType", ""))
            if not mime.startswith("image"):
                continue
            url = str(sub.get("WebResourceURL", ""))
            kind = classify(url)
            if not kind:
                continue
            data = sub.get("WebResourceData", b"") or b""
            if not data:
                continue
            digest = hashlib.sha256(data).hexdigest()
            if digest in seen:
                seen[digest]["archives"].add(name)
                continue
            seen[digest] = {
                "kind": kind, "mime": mime, "url": url, "data": data,
                "size": len(data), "sha": digest, "archives": {name},
            }

    portraits = [r for r in seen.values() if r["kind"] == "portrait"]
    avatars = [r for r in seen.values() if r["kind"] == "avatar"]
    projects = sorted((r for r in seen.values() if r["kind"] == "project"),
                      key=lambda r: r["size"], reverse=True)

    written = []

    def write(rec, relpath):
        full = os.path.join(IMG_DIR, relpath)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as fh:
            fh.write(rec["data"])
        dims = png_size(rec["data"])
        written.append((relpath, rec["size"], dims, sorted(rec["archives"])))

    for rec in portraits:
        write(rec, "portrait.png")
    for i, rec in enumerate(avatars, 1):
        write(rec, f"avatar-github{'' if i == 1 else i}.jpg")
    for i, rec in enumerate(projects, 1):
        write(rec, os.path.join("projects", f"proj-{i:02d}.png"))

    print(f"\nDeduped images: {len(seen)}  "
          f"(portrait={len(portraits)}, avatar={len(avatars)}, project={len(projects)})\n")
    print(f"{'file':32} {'bytes':>9}  {'dims':>12}  archives")
    print("-" * 78)
    for relpath, size, dims, archives in written:
        d = f"{dims[0]}x{dims[1]}" if dims else "-"
        tags = ",".join(a.replace("upwork", "").replace(".webarchive", "").strip("_") or "main"
                        for a in archives)
        print(f"assets/img/{relpath:21} {size:>9}  {d:>12}  {tags}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
