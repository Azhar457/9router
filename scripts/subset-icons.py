#!/usr/bin/env python3
"""Subset the Material Symbols Outlined webfont to the icons the app actually uses.

The stock font ships ~4.3k glyphs / ~3.9 MB and is loaded on every dashboard page
even though the codebase references ~130 distinct icon names. This script:

  1. scans `src/**` for icon names (text inside `.material-symbols-outlined`
     spans, plus `icon=` / `iconRight=` prop values, plus any quoted snake_case
     literal that is a real glyph name in the font — a cheap safety net for
     dynamically-built names),
  2. rewrites the handful of names that do not exist in the shipped font,
  3. prunes the font's GSUB ligature rules to those icons (the icon is reached
     by typing its name; `rlig` maps the letter sequence to the glyph), and
  4. writes a woff2 to `public/fonts/`.

Result: ~3.9 MB -> ~110 KB, same rendering.

Skip safely (exit 0, full font stays) when fontTools/pyftsubset are unavailable,
so the build never breaks on a machine without the tooling.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

# Icon names the app uses that do not exist in the shipped font (they render as
# literal text today). Mapped to the closest glyph that does exist.
ICON_ALIASES = {
    "business": "business_center",
    "emoji_events": "trophy",
    "filter_off": "filter_alt_off",
    "revert": "undo",
    "security_update": "verified_user",
}

SPAN_RE = re.compile(r"material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*<")
ICON_PROP_RE = re.compile(r"\bicon(?:Right)?=[\"']([a-z0-9_]+)[\"']")
QUOTED_RE = re.compile(r"[\"']([a-z][a-z0-9_]{1,48})[\"']")

REQUIRED_TABLES = ("GSUB", "fvar", "glyf", "cmap")


def collect_icon_names(src_dir: Path) -> set[str]:
    names: set[str] = set()
    for path in src_dir.rglob("*.js"):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        names.update(SPAN_RE.findall(text))
        names.update(ICON_PROP_RE.findall(text))
        # Safety net: only in files that render icons, and only literals that
        # are real glyph names (checked by the caller).
        if "material-symbols" in text:
            names.update(QUOTED_RE.findall(text))
    names.discard("")
    return names


def prune_gsub(font, wanted: set[str]) -> int:
    """Drop ligature rules whose target glyph is not wanted. Returns kept count."""
    if "GSUB" not in font:
        return 0
    table = font["GSUB"].table
    kept = 0
    for lookup in table.LookupList.Lookup:
        for sub in lookup.SubTable:
            inner = getattr(sub, "ExtSubTable", sub)  # type 7 wraps the real lookup
            class_name = inner.__class__.__name__
            if class_name == "LigatureSubst":
                for first in list(inner.ligatures.keys()):
                    matching = [lig for lig in inner.ligatures[first] if lig.LigGlyph in wanted]
                    if matching:
                        inner.ligatures[first] = matching
                        kept += len(matching)
                    else:
                        del inner.ligatures[first]
            elif class_name == "SingleSubst" and inner.mapping:
                inner.mapping = {k: v for k, v in inner.mapping.items() if k in wanted or v in wanted}
    return kept


def build_subset(font, out: Path, unicodes: list[int]) -> dict:
    # Operates on the already-GSUB-pruned font: reloading the source here would
    # undo the pruning and retain every glyph the ligatures reference.
    from fontTools.subset import Options, Subsetter  # noqa: PLC0415

    options = Options()
    # `rlig` carries the icon-name -> glyph ligatures; `rclt` is required by the
    # font's own layout. Dropping either makes icons render as literal text.
    options.layout_features = ["rlig", "rclt"]
    options.name_IDs = ["*"]  # type: ignore[assignment]
    options.notdef_outline = True
    options.recalc_bounds = True
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(str(out))
    return {
        "glyphs": len(font.getGlyphOrder()),
        "axes": [a.axisTag for a in font["fvar"].axes] if "fvar" in font else [],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parent.parent
    parser.add_argument("--src", default=str(root / "src"))
    parser.add_argument(
        "--font",
        default=str(root / "node_modules" / "material-symbols" / "material-symbols-outlined.woff2"),
    )
    parser.add_argument("--out", default=str(root / "public" / "fonts" / "material-symbols-outlined.woff2"))
    parser.add_argument("--stamp", default=str(root / "scripts" / ".icon-subset.json"))
    args = parser.parse_args()

    try:
        from fontTools.ttLib import TTFont  # noqa: F401
    except ImportError:
        print("[subset-icons] fontTools not available — keeping the full icon font.")
        return 0

    source = Path(args.font)
    out = Path(args.out)
    if not source.is_file():
        print(f"[subset-icons] source font not found: {source}")
        return 0

    src_dir = Path(args.src)
    candidates = collect_icon_names(src_dir) if src_dir.is_dir() else set()

    from fontTools.ttLib import TTFont

    font = TTFont(str(source))
    glyphs = set(font.getGlyphOrder())
    cmap = font.getBestCmap()
    reverse = {name: cp for cp, name in cmap.items()}

    # Resolve aliases, then keep only names that really are glyphs.
    resolved = {ICON_ALIASES.get(name, name) for name in candidates}
    icons = {name for name in resolved if name in glyphs}
    dropped = sorted(resolved - icons)

    unicodes = {reverse[name] for name in icons if name in reverse}
    # Ligature inputs are the icon names themselves, so every ASCII letter,
    # digit and the punctuation used in names must stay in the cmap.
    unicodes |= {ord(ch) for ch in "abcdefghijklmnopqrstuvwxyz0123456789 .,:/_-'()"}
    unicodes = sorted(unicodes)

    kept = prune_gsub(font, icons)
    if not kept:
        print("[subset-icons] no ligature rules survived — keeping the full icon font.")
        return 0

    out.parent.mkdir(parents=True, exist_ok=True)
    info = build_subset(font, out, unicodes)

    before = source.stat().st_size
    after = out.stat().st_size
    print(
        f"[subset-icons] {len(icons)} icons, {kept} ligatures, "
        f"{before / 1024:.1f} KB -> {after / 1024:.1f} KB "
        f"({100 * (1 - after / before):.1f}% smaller), axes={info['axes']}"
    )
    if dropped:
        print(f"[subset-icons] skipped unknown names: {', '.join(dropped[:12])}")

    stamp = {
        "icons": sorted(icons),
        "source_size": before,
        "source_mtime": int(source.stat().st_mtime),
        "output_size": after,
        "sha1": hashlib.sha1(out.read_bytes()).hexdigest(),
    }
    Path(args.stamp).write_text(json.dumps(stamp, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
