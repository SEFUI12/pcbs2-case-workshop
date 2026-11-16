"""Export every _MINI sprite from PCBS2's icon archive to WebP for the workshop UI.

Why _MINI: the shop card is resolved by taking the last segment of `Asset Path`
and looking up a Sprite named `<segment>_MINI`. Those are the only sprites with
real pixels -- the 512px base variants ship as blank placeholder artwork.

Output:
  web/icons/<name>.webp     one file per sprite
  web/icons/index.json      {name: {w,h,file}} plus a lowercased name index

Measured cost on a retail install: 2277 sprites, ~42s, ~10 MB of WebP.

Usage:
  python tools/export_icons.py --game "C:/Games/PCBS2"
  python tools/export_icons.py --game "C:/Games/PCBS2" --clean
"""
import argparse
import io
import json
import os
import re
import shutil
import sys
import time

try:
    import UnityPy
except ImportError:
    sys.exit("UnityPy is required:  pip install UnityPy")

ARCHIVE = os.path.join("PCBS2_Data", "resources.assets")
QUALITY = 88

# Sprite names become filenames. Windows forbids these, and a few shipped
# names contain them, so map them away rather than skipping the artwork.
_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_name(raw):
    """Filesystem-safe, still reversible enough to matter."""
    out = _UNSAFE.sub("_", raw).strip(" .")
    if not out:
        out = "unnamed"
    # Windows reserved device names
    if out.upper().split(".")[0] in {
        "CON", "PRN", "AUX", "NUL",
        *("COM%d" % i for i in range(1, 10)),
        *("LPT%d" % i for i in range(1, 10)),
    }:
        out = "_" + out
    return out


def find_archive(game):
    path = os.path.join(game, ARCHIVE)
    return path if os.path.isfile(path) else None


def collect(archive_path, only_mini=True):
    """Return [(obj, name)] for every sprite we care about.

    With only_mini (the default) we keep just the `_MINI` variants. Those are
    the only ones the shop card ever uses, and they are the only ones with real
    pixels -- exporting the 512px base set as well triples the output for
    artwork the game never draws (measured: 83.5 MB -> 10 MB).
    """
    env = UnityPy.load(archive_path)
    found = []
    for obj in env.objects:
        if obj.type.name != "Sprite":
            continue
        try:
            d = obj.read()
        except Exception:
            continue
        name = getattr(d, "m_Name", "") or ""
        if not name:
            continue
        if only_mini and not name.upper().endswith("_MINI"):
            continue
        found.append((obj, name))
    return found


def export(game, out_dir, quality=QUALITY, clean=False, only_mini=True):
    archive = find_archive(game)
    if not archive:
        sys.exit("Not a PCBS2 folder (missing %s): %s" % (ARCHIVE, game))

    icon_dir = os.path.join(out_dir, "icons")
    if clean and os.path.isdir(icon_dir):
        shutil.rmtree(icon_dir)
    os.makedirs(icon_dir, exist_ok=True)

    t0 = time.time()
    sprites = collect(archive, only_mini=only_mini)
    print("archive: %s" % archive)
    print("sprite objects: %d  (scan %.1fs)" % (len(sprites), time.time() - t0))

    index = {}
    lower = {}
    written = 0
    skipped = 0
    total_bytes = 0
    blank = []
    t1 = time.time()

    for i, (obj, name) in enumerate(sprites, 1):
        if i % 200 == 0 or i == len(sprites):
            pct = i * 100 // len(sprites)
            sys.stdout.write("\r  %d/%d  %d%%  %.1fs" % (i, len(sprites), pct,
                                                         time.time() - t1))
            sys.stdout.flush()

        try:
            d = obj.read()
            img = d.image
        except Exception:
            skipped += 1
            continue

        # A sprite whose alpha is entirely zero renders as nothing; note it but
        # still export, because the linter treats it as "sprite exists".
        if img.mode != "RGBA":
            img = img.convert("RGBA")

        buf = io.BytesIO()
        try:
            img.save(buf, "WEBP", quality=quality, method=4)
        except Exception:
            try:
                img.save(buf, "PNG")
            except Exception:
                skipped += 1
                continue

        fname = safe_name(name) + ".webp"
        with open(os.path.join(icon_dir, fname), "wb") as fh:
            fh.write(buf.getvalue())
        total_bytes += buf.tell()
        written += 1

        index[name] = {"w": img.width, "h": img.height, "f": fname}
        lower.setdefault(name.lower(), name)

    print()
    elapsed = time.time() - t1
    print("exported %d  skipped %d  %.1fs  %.1f MB"
          % (written, skipped, elapsed, total_bytes / 1024 / 1024))

    manifest = {
        "game": os.path.abspath(game),
        "count": written,
        "sprites": index,
        # The card lookup ignores case, so ship the case-folded index too and
        # the browser never has to linear-scan 2277 keys.
        "lower": lower,
    }
    man_path = os.path.join(icon_dir, "index.json")
    with open(man_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, separators=(",", ":"))
    print("manifest: %s  (%.1f KB)"
          % (man_path, os.path.getsize(man_path) / 1024))

    mini = sum(1 for n in index if n.upper().endswith("_MINI"))
    print("of those, %d end in _MINI (the ones the shop card actually uses)" % mini)
    if blank:
        print("blank alpha: %d" % len(blank))
    return 0


def main():
    ap = argparse.ArgumentParser(
        description="Export PCBS2 shop icon sprites to WebP for the workshop UI.")
    ap.add_argument("--game", required=True, help="PCBS2 install folder")
    ap.add_argument("--out", default=None,
                    help="project web/ folder (default: ../web next to this script)")
    ap.add_argument("--quality", type=int, default=QUALITY, help="WebP quality 1-100")
    ap.add_argument("--clean", action="store_true", help="wipe web/icons first")
    ap.add_argument("--all-sprites", action="store_true",
                    help="also export non-_MINI sprites (adds ~73 MB of unused artwork)")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    out = args.out or os.path.join(os.path.dirname(here), "web")
    return export(args.game, out, args.quality, args.clean,
                  only_mini=not args.all_sprites)


if __name__ == "__main__":
    sys.exit(main())