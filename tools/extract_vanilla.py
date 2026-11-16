"""Extract the vanilla Cases table from PCBS2 into JSON for the Case Workshop.

The table lives in PCBS2_Data/sharedassets0.assets as a TextAsset named
"Cases". It is *not* a div-annotated XML like the mod files -- it is a plain
positional table where row 0 is the header and every later row is the same
length. Values must therefore be read by header index, not by name.

One quirk worth recording: the vanilla table has 78 columns while a mod XML has
77 `<td div="...">` cells. The extra column is the leading empty cell (the one
mod XMLs render as `<td div=""></td>`). So mapping is: vanilla[i] -> field
named header[i], and the blank header maps to the blank field.

Output: web/data/vanilla_cases.json
  {field_order: [...], cases: [{ID:..., ...}]}
"""
import argparse
import json
import os
import re
import sys

try:
    import UnityPy
except ImportError:
    sys.exit("UnityPy is required:  pip install UnityPy")

ARCHIVE = os.path.join("PCBS2_Data", "sharedassets0.assets")
TABLE = "Cases"

_TR = re.compile(r"<tr>(.*?)</tr>", re.S)
_TD = re.compile(r"<td[^>]*>(.*?)</td>", re.S)


def cells(chunk):
    """One table row -> list of stripped cell values."""
    out = []
    for raw in _TD.findall(chunk):
        # The tables also contain HTML entities and stray tags.
        v = re.sub(r"<[^>]+>", "", raw)
        v = (v.replace("&amp;", "&").replace("&lt;", "<")
              .replace("&gt;", ">").replace("&quot;", '"')
              .replace("&nbsp;", " ").replace("&#39;", "'"))
        out.append(v.strip())
    return out


def read_table(archive, table_name):
    env = UnityPy.load(archive)
    for obj in env.objects:
        if obj.type.name != "TextAsset":
            continue
        d = obj.read()
        if (getattr(d, "m_Name", "") or "") != table_name:
            continue
        return getattr(d, "m_Script", "") or ""
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    archive = os.path.join(args.game, ARCHIVE)
    if not os.path.isfile(archive):
        sys.exit("Not a PCBS2 folder (missing %s): %s" % (ARCHIVE, args.game))

    text = read_table(archive, TABLE)
    if text is None:
        sys.exit("TextAsset %r not found in %s" % (TABLE, archive))

    rows = _TR.findall(text)
    if not rows:
        sys.exit("No <tr> rows in the %s table" % TABLE)

    header = cells(rows[0])
    # header[0] is the blank leading cell that mod XMLs write as div="".
    fields = [h if h else "" for h in header]

    cases = []
    for chunk in rows[1:]:
        vals = cells(chunk)
        if not any(vals):
            continue
        # Normalise short rows rather than dropping them.
        if len(vals) < len(fields):
            vals = vals + [""] * (len(fields) - len(vals))
        rec = {}
        for name, val in zip(fields, vals):
            if name == "":
                continue
            rec[name] = val
        if not rec.get("ID"):
            continue
        cases.append(rec)

    manifest = {
        "source": os.path.abspath(archive),
        "table": TABLE,
        "field_order": [f for f in fields if f],
        "case_count": len(cases),
        "cases": cases,
    }

    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = args.out or os.path.join(os.path.dirname(here), "web", "data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "vanilla_cases.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, separators=(",", ":"))

    print("table:     %s" % TABLE)
    print("columns:   %d (1 blank + %d named)" % (len(fields), len(fields) - 1))
    print("cases:     %d" % len(cases))
    print("output:    %s (%.0f KB)"
          % (out_path, os.path.getsize(out_path) / 1024))

    # Sanity: every case must carry the fields the workshop depends on.
    required = ("ID", "Part Type", "Part Name", "Asset Path", "Price", "Level")
    for key in required:
        have = sum(1 for c in cases if c.get(key))
        print("  %-14s %d/%d" % (key, have, len(cases)))

    types = {}
    for c in cases:
        types[c.get("Part Type", "?")] = types.get(c.get("Part Type", "?"), 0) + 1
    print("  Part Type split: %s" % types)
    return 0


if __name__ == "__main__":
    sys.exit(main())