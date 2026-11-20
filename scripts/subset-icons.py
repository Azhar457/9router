#!/usr/bin/env python3
"""Subset the Material Symbols Outlined webfont to the icons the app actually uses.

The stock font ships ~4.3k glyphs / ~3.9 MB and is loaded on every dashboard page
even though the codebase references ~160 distinct icon names. This script:

  1. scans `src/**` for icon names — the text inside `.material-symbols-outlined`
     spans, plus `icon`/`iconRight` values (JSX attribute or object literal),
  2. maps each name through ICON_ALIASES when the shipped font has no such icon,
  3. keeps a name only if the font really has a **ligature** that types it (icons
     render by typing their name; GSUB `rlig` substitutes the letter sequence),
  4. prunes the GSUB ligature rules to those names, and
  5. writes a woff2 to `public/fonts/`.

Result: ~3.9 MB -> ~150 KB, same rendering.

Skip safely (exit 0, full font stays) when fontTools is unavailable, so the build
never breaks on a machine without the tooling.
"""

from __future__ import annotations

import argparse
import hashlib
import json
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
    "developer_mode": "terminal",
    "file_upload": "upload_file",
    "report_problem": "report",
    "restore": "history",
}

SPAN_RE = re.compile(r"material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*<")
# Both JSX attributes (`icon="x"`) and object/nav literals (`icon: "x"`), which is
# how the sidebar/header pass icons.
ICON_PROP_RE = re.compile(r"\bicon(?:Right)?\s*[:=]\s*[\"']([a-z0-9_]+)[\"']")
# Icon chosen by a conditional: `isDark ? "light_mode" : "dark_mode"`. Both
# branches are collected; non-icon branches are filtered out later by checking
# the font's ligature table.
TERNARY_RE = re.compile(r"\?\s*[\"']([a-z0-9_]+)[\"']\s*:\s*[\"']([a-z0-9_]+)[\"']")

# Characters that appear in icon names and therefore must stay in the cmap.
NAME_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789 .,:/_-'()"


def collect_icon_names(src_dir: Path) -> set[str]:
    """Icon names the app renders.

    Only two shapes are accepted. A looser "any quoted snake_case literal" net was
    tried and rejected: it matched hundreds of ordinary words (`loading`,
    `provider`, `session`, …) that were never rendered as icons.
    """
    names: set[str] = set()
    for path in src_dir.rglob("*.js"):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if "material-symbols" not in text and not ICON_PROP_RE.search(text):
            continue
        names.update(SPAN_RE.findall(text))
        names.update(ICON_PROP_RE.findall(text))
        for first, second in TERNARY_RE.findall(text):
            names.add(first)
            names.add(second)
    names.discard("")
    return names


def _glyph_char_map(font) -> dict[str, str]:
    """glyph name -> the character that types it (via cmap).

    The font maps its lowercase-named letter glyphs at BOTH cases' codepoints, so
    prefer the codepoint that spells the glyph name exactly — otherwise every
    reconstructed ligature comes out upper-case and matches nothing.
    """
    out: dict[str, str] = {}
    for cp, name in font.getBestCmap().items():
        if not (32 <= cp <= 0xFFFF):
            continue
        ch = chr(cp)
        if name not in out or ch == name:
            out[name] = ch
    return out


def collect_ligatures(font) -> list[tuple[str, str]]:
    """`(typed_text, target_glyph)` for every icon ligature in the font."""
    glyph_char = _glyph_char_map(font)
    result: list[tuple[str, str]] = []
    if "GSUB" not in font:
        return result
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            inner = getattr(sub, "ExtSubTable", sub)  # type 7 wraps the real lookup
            if inner.__class__.__name__ != "LigatureSubst":
                continue
            for first, ligatures in inner.ligatures.items():
                for lig in ligatures:
                    chars = [glyph_char.get(first), *(glyph_char.get(c) for c in lig.Component)]
                    if any(ch is None for ch in chars):
                        continue
                    result.append(("".join(ch for ch in chars if ch is not None), lig.LigGlyph))
    return result


def prune_gsub(font, wanted: set[str], ligatures: list[tuple[str, str]]) -> int:
    """Keep only ligature rules whose typed text is wanted. Returns kept count."""
    if "GSUB" not in font:
        return 0
    kept = 0
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            inner = getattr(sub, "ExtSubTable", sub)
            class_name = inner.__class__.__name__
            if class_name == "LigatureSubst":
                for first in list(inner.ligatures.keys()):
                    matching = [
                        lig for lig in inner.ligatures[first]
                        if lig.LigGlyph in wanted
                    ]
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

    from fontTools.ttLib import TTFont

    source = Path(args.font)
    out = Path(args.out)
    if not source.is_file():
        print(f"[subset-icons] source font not found: {source}")
        return 0

    src_dir = Path(args.src)
    candidates = collect_icon_names(src_dir) if src_dir.is_dir() else set()

    font = TTFont(str(source))
    ligatures = collect_ligatures(font)
    typeset = {text for text, _ in ligatures}

    # Resolve aliases, then keep only names the font can actually typeset.
    resolved = {ICON_ALIASES.get(name, name) for name in candidates}
    icons = {name for name in resolved if name in typeset}
    targets = {target for text, target in ligatures if text in icons}
    dropped = sorted(resolved - icons)

    glyph_cp = {name: cp for cp, name in font.getBestCmap().items()}
    unicodes = {glyph_cp[t] for t in targets if t in glyph_cp}
    unicodes |= {ord(ch) for ch in NAME_CHARS}
    unicodes = sorted(unicodes)

    kept = prune_gsub(font, targets, ligatures)
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
        print(f"[subset-icons] no ligature for: {', '.join(dropped[:12])}")

    Path(args.stamp).write_text(
        json.dumps(
            {
                "icons": sorted(icons),
                "source_size": before,
                "source_mtime": int(source.stat().st_mtime),
                "output_size": after,
                "sha1": hashlib.sha1(out.read_bytes()).hexdigest(),
            },
            indent=1,
        ),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
