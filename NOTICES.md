# Notices

The MIT licence in `LICENSE` covers the source code, the tests and the
documentation written for this project.

## Bundled artwork

`web/icons/*.webp` are decoded from the sprite archive of a **retail** copy of
PC Building Simulator 2. They are included so the shop-card preview can be
accurate while running offline. They are **not** offered as a redistributable
asset pack, and no licence to that artwork is granted here.

If a rights holder objects, the correct fix is to delete `web/icons/*.webp` and
have each user run `tools/export_icons.py` against their own installation. The
application behaves identically either way — it only reads `web/icons/` and has
no network code.

## Trademarks

This project is not affiliated with or endorsed by Fusion Media, or by the
developers and publishers of PC Building Simulator 2. Product names, brand
names and case model names appearing in the extracted data belong to their
respective owners and are used only to describe compatibility.

## Extracted game data

`web/data/vanilla_cases.*` is a tabular extract of the game's own `Cases`
TextAsset — field names and shipped values for the 382 vanilla cases. It exists
so the tool can tell you which of your fields differ from the case your prefab
came from. It can be regenerated from any installation with
`tools/extract_vanilla.py`.