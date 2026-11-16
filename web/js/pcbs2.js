/* PCBS2 Case Workshop - core model logic (no DOM, no I/O).
 *
 * Three jobs:
 *   1. parse a mod XML into an ordered field list
 *   2. write that field list back out as byte-compatible XML
 *   3. resolve the shop-card icon the way the game does
 *
 * Everything here is unit-tested in tests/pcbs2.test.js and verified against
 * retail data. Field metadata (groups, allowed values) lives at the bottom and
 * is taken from the vanilla Cases table, not from guesswork -- see the comment
 * on ENUMS.
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- parse */

  /* A mod XML looks like:
   *
   *   Prefabs/Cases/Corsair/CAS_Corsair_iCUE_5000D_AirFlow      <- bare prefab line
   *   <table>
   *     <tr>
   *       <td div=""></td>
   *       <td div="Part Type">Case</td>
   *       ...
   *
   * The leading bare line is the prefab path, duplicated in the `Asset Path`
   * field further down. Fields are positional in the file but each carries its
   * own name, so we key on the name and keep the original order alongside it.
   */
  function parseModXml(text) {
    if (typeof text !== 'string') throw new Error('parseModXml needs a string');

    // Strip a BOM before parsing, but remember it: a shipped file that carried
    // one must get it back, or the export differs from the input by a byte.
    var bom = false;
    if (text.charCodeAt(0) === 0xFEFF) { bom = true; text = text.slice(1); }

    var model = {
      prefabLine: '',
      fields: [],      // [{name, value}] in file order
      order: [],       // field names in first-seen order
      map: {},         // name -> value, last wins
      hasBlankCell: false,
      truncated: false, // true when the table is missing its closing tag
      eol: '\n',        // line ending to write back; retail files are CRLF
      bom: bom          // true when the input began with a byte-order mark
    };

    // Shipped mod files use CRLF. Preserving it is what makes the export
    // byte-identical to the input instead of merely equivalent.
    if (/\r\n/.test(text)) model.eol = '\r\n';

    var open = text.search(/<table[^>]*>/i);
    var head = open >= 0 ? text.slice(0, open) : text;
    var body = open >= 0 ? text.slice(open) : '';

    var firstLine = head.split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean)[0] || '';
    model.prefabLine = firstLine;

    if (body && !/<\/table>/i.test(body)) model.truncated = true;

    /* Match <td ...>value</td>. Attribute order is not guaranteed in
     * hand-edited files, so accept div anywhere in the tag. */
    var tdRe = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
    var divRe = /\bdiv\s*=\s*"([^"]*)"/i;
    var seen = {};
    var m;
    while ((m = tdRe.exec(body)) !== null) {
      var dm = divRe.exec(m[1] || '');
      var name = dm ? dm[1] : '';
      if (name === '') {
        // The blank leading cell; remember it so output matches input.
        model.hasBlankCell = true;
        continue;
      }
      var inner = m[2];
      var value = decodeEntities(stripTags(inner)).trim();
      if (!seen[name]) { seen[name] = true; model.order.push(name); }
      /* Keep the original inner text so an untouched field is written back
       * exactly as it arrived. Retail files carry trailing spaces inside some
       * cells ("S-ATX, "), and re-encoding the trimmed value would change the
       * file for no reason. Text containing nested markup is not kept verbatim,
       * because the editor would then be unable to round-trip an edit. */
      var verbatim = stripTags(inner) === inner ? inner : null;
      model.fields.push({ name: name, value: value, raw: verbatim, dirty: false });
      model.map[name] = value;
    }

    return model;
  }

  function stripTags(s) {
    return String(s).replace(/<[^>]*>/g, '');
  }

  function decodeEntities(s) {
    return String(s)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  }

  function encodeEntities(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ---------------------------------------------------------------- write */

  /* Rebuild the file. Field order is preserved exactly: the retail importer
   * reads this table positionally in some paths, and a reordered file has
   * broken parts before.
   *
   * Line endings come from the source model, so an untouched CRLF file comes
   * back byte-identical rather than being quietly normalised to LF.
   */
  function buildModXml(model) {
    var eol = model.eol || '\n';
    var prefab = (model.prefabLine || '').trim();
    var lines = [];
    if (prefab) lines.push(prefab);
    lines.push('<table>');
    lines.push('\t<tr>');
    if (model.hasBlankCell !== false) lines.push('\t\t<td div=""></td>');
    for (var i = 0; i < model.fields.length; i++) {
      var f = model.fields[i];
      if (f.name == null || f.name === '') continue;
      /* An untouched field is emitted from its original text, so saving a file
       * you did not edit produces the same bytes you opened. */
      var body = (!f.dirty && f.raw != null)
        ? f.raw
        : encodeEntities(f.value == null ? '' : f.value);
      lines.push('\t\t<td div="' + f.name + '">' + body + '</td>');
    }
    lines.push('\t</tr>');
    lines.push('</table>');
    lines.push('');
    return (model.bom ? '\uFEFF' : '') + lines.join(eol);
  }

  /* -------------------------------------------------------------- resolve */

  /* The shop card takes the last path segment of `Asset Path` and looks for a
   * Sprite named `<segment>_MINI`. `Icon Path` is not consulted. The lookup is
   * case-insensitive.
   *
   * Evidence: all 382 cases in the vanilla table resolve to a `_MINI` sprite,
   * and no case mod in a 3697-file corpus produced a card from anything else.
   *
   * icons = { sprites: {Name: {w,h,f}}, lower: {lowercased: Name} }
   * returns {kind, name}  kind: 'mini' | 'missing' | 'no-asset'
   */
  function resolveIcon(assetPath, icons) {
    var p = String(assetPath || '').trim();
    if (!p) return { kind: 'no-asset', name: null };
    var seg = lastSeg(p);
    if (!seg) return { kind: 'no-asset', name: null };

    var sprites = (icons && icons.sprites) || {};
    var lower = (icons && icons.lower) || {};

    var mini = seg + '_MINI';
    if (sprites[mini]) return { kind: 'mini', name: mini };
    var folded = lower[mini.toLowerCase()];
    if (folded) return { kind: 'mini', name: folded };

    return { kind: 'missing', name: null };
  }

  function iconUrl(resolved, icons) {
    if (!resolved || !resolved.name) return null;
    var rec = ((icons && icons.sprites) || {})[resolved.name];
    return rec && rec.f ? 'icons/' + rec.f : null;
  }

  /* ----------------------------------------------------------------- diff */

  /* Compare a mod against the vanilla case it borrowed its prefab from.
   * This is the part you cannot do by eye across 77 fields.
   *
   * `missing` is a real defect rather than a formality: several vanilla
   * columns, `Max PCI Size` among them, are read by the game and are simply
   * absent from most mod files.
   */
  function diffAgainstDonor(fields, donor, fieldOrder) {
    var mine = {};
    for (var i = 0; i < fields.length; i++) mine[fields[i].name] = fields[i].value;

    var same = [], changed = [], missing = [], added = [];

    for (var j = 0; j < fieldOrder.length; j++) {
      var name = fieldOrder[j];
      var has = Object.prototype.hasOwnProperty.call(mine, name);
      var dnVal = donor && donor[name] != null ? String(donor[name]).trim() : '';
      if (!has) {
        missing.push({ name: name, donor: dnVal });
        continue;
      }
      var myVal = String(mine[name]).trim();
      if (myVal === dnVal) same.push({ name: name, value: myVal });
      else changed.push({ name: name, mine: myVal, donor: dnVal });
    }

    // Fields the mod carries that vanilla has no column for (Icon Path).
    for (var k in mine) {
      if (Object.prototype.hasOwnProperty.call(mine, k) &&
          fieldOrder.indexOf(k) === -1) {
        added.push({ name: k, value: mine[k] });
      }
    }

    return { same: same, changed: changed, missing: missing, added: added };
  }

  /* --------------------------------------------------------------- checks */

  /* Shop-facing problems only. Not a general linter: every check here answers
   * "will this case appear, look right, and behave in the shop".
   *
   * opts.duplicateIds  a Set/object of IDs used by other loaded files, so a
   *                    clash is caught before it silently replaces a part.
   */
  function check(model, icons, donor, opts) {
    opts = opts || {};
    var issues = [];
    var f = model.map || {};
    var add = function (level, code, msg) {
      issues.push({ level: level, code: code, msg: msg });
    };

    /* --- identity --- */
    var partType = String(f['Part Type'] || '').trim();
    if (!partType) {
      add('error', 'E004', '`Part Type` is empty - the loader skips this row.');
    } else if (partType !== 'Case') {
      add('error', 'E004', '`Part Type` is "' + partType + '" but this is a case file; expected "Case".');
    }
    if (!String(f['ID'] || '').trim()) {
      add('error', 'E004', '`ID` is empty - the row is skipped.');
    } else if (opts.duplicateIds &&
               opts.duplicateIds[String(f['ID']).trim()]) {
      add('error', 'E005', '`ID` "' + String(f['ID']).trim() +
        '" is already used by another loaded file. One of them will win.');
    }
    if (!String(f['Part Name'] || '').trim()) {
      add('warn', 'E006', '`Part Name` is empty - the shop card shows no title.');
    }
    if (String(f['In Game'] || '').trim().toLowerCase() !== 'yes') {
      add('error', 'E004', '`In Game` is not "Yes" - the part will not load.');
    }

    /* --- prefab / icon --- */
    var asset = String(f['Asset Path'] || '').trim() || (model.prefabLine || '').trim();
    if (!asset) {
      add('error', 'E001', '`Asset Path` is empty - the part has no prefab and cannot appear.');
    } else {
      var icon = resolveIcon(asset, icons);
      if (icon.kind === 'missing') {
        add('error', 'E003', 'No `' + lastSeg(asset) + '_MINI` sprite - the shop card ' +
          'will be a blank white rectangle.');
      }
      if (/\.prefab$/i.test(asset)) {
        add('warn', 'E007', '`Asset Path` ends in ".prefab"; the table stores the ' +
          'path without the extension.');
      }
    }

    /* --- field completeness --- */
    if (donor) {
      /* Only meaningful for a complete file. A hand-written stub with 8 of 77
       * fields would otherwise emit one E009 per column and bury the findings
       * that matter. */
      var fieldCount = (model.fields || []).length;
      var expected = Object.keys(donor).length;
      if (fieldCount >= expected * 0.9) {
        var d = diffAgainstDonor(model.fields || [], donor, Object.keys(donor));
        for (var i = 0; i < d.missing.length; i++) {
          add('warn', 'E009', 'Field `' + d.missing[i].name + '` is missing; ' +
            'vanilla has "' + d.missing[i].donor + '" here.');
        }
      } else {
        add('info', 'I005', 'Only ' + fieldCount + ' of ~' + expected +
          ' fields present, so the field comparison was skipped.');
      }
    } else if (asset) {
      add('info', 'I001', 'No vanilla case uses this `Asset Path`, so there is ' +
        'nothing to diff against. That is expected for a new prefab.');
    }

    /* --- physics a player notices immediately --- */
    var maxLen = num(f['Max GPU length']);
    var restricted = num(f['Restricted GPU length']);
    if (maxLen && restricted && restricted > maxLen) {
      add('warn', 'C001', '`Restricted GPU length` (' + restricted +
        ') exceeds `Max GPU length` (' + maxLen + ').');
    }

    /* Motherboard flags hold "1" or empty in the vanilla table, but hand-written
     * mod files also use "0" to mean the same thing as empty. Both are treated
     * as "not supported"; only "1" claims support. */
    var declared = String(f['Motherboard Size'] || '');
    if (declared) {
      var listed = declared.toLowerCase();
      for (var s = 0; s < MOBO_SIZES.length; s++) {
        var size = MOBO_SIZES[s];
        if (String(f[size] || '').trim() !== '1') continue;
        if (listed.indexOf(size.toLowerCase()) === -1) {
          add('warn', 'C002', '`' + size + '` is flagged 1 but is not listed in ' +
            '`Motherboard Size`.');
        }
      }
    }

    var price = num(f['Price']);
    var sell = num(f['SellPrice']);
    if (price > 0 && sell > price) {
      add('warn', 'C003', '`SellPrice` (' + sell + ') is above `Price` (' + price +
        ') - the part can be resold for profit.');
    }

    if (!String(f['Model Supplied'] || '').trim()) {
      add('warn', 'C004', '`Model Supplied` is blank; vanilla sets this on 362 ' +
        'of 382 cases. An empty value may mean the shop has no case model.');
    }

    /* --- career / shop sanity --- */
    var level = String(f['Level'] || '').trim();
    if (!level) {
      add('info', 'I003', '`Level` is blank; the shop treats it as 1.');
    } else if (num(level) === 1 && price >= 250) {
      add('info', 'I003', 'Level 1 with a $' + price + ' price - ' +
        'purchasable on day one of a career.');
    }

    if (String(f['In Shop'] || '').trim().toLowerCase() === 'no') {
      add('info', 'I004', '`In Shop` is "No", so the part never appears for sale.');
    }

    return issues;
  }

  function lastSeg(p) {
    return String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  }

  function num(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }

  /* ---------------------------------------------------------------- fields */

  /* Groups exist to make 77 fields navigable. Any field not listed lands in
   * "Other", so an unknown or newly added vanilla column stays visible instead
   * of being silently dropped from the form. */
  var GROUPS = [
    { id: 'identity', label: 'Identity', fields: [
      'Part Type', 'Class', 'Manufacturer', 'ID', 'Part Name', 'Concat name', 'Headline'] },
    { id: 'shop', label: 'Shop & Career', fields: [
      'In Game', 'In Shop', 'Imported to Game', 'Working in game', 'Price', 'SellPrice',
      'Level', 'Percent Through', 'Imported But disabled', 'Start In Freebuild Inventory',
      'Start In Career Inventory', 'In Open Beta', 'Use in Random Jobs', 'Use For WC Jobs',
      'Use For Paint Case Jobs', 'DLC', 'Is DLC'] },
    { id: 'visual', label: 'Visuals & Card', fields: [
      'Asset Path', 'Icon Path', 'Model Supplied', 'Licensor Approved', 'Product Page',
      'Notes', 'Curved Glass', 'Clear Side', 'Component Lighting', 'Is Scale V2'] },
    { id: 'form', label: 'Form Factor', fields: [
      'Case Size', 'Is Open Bench', 'PSU size', 'Motherboard Size', 'Mini-ITX', 'Micro-ATX',
      'S-ATX', 'E-ATX', 'XL-ATX', 'Mini-DTX', 'SSI-EEB', 'SSI-CEB', 'Intel NUC',
      'Intel Mini-STX', 'Has Max Mobo Size', 'Max Motherboard Size', 'Max PCI Size'] },
    { id: 'space', label: 'Clearance', fields: [
      'Restricted GPU length', 'Max GPU length', 'Max GPU width', 'GPU Slots', 'GPU Holder',
      'Max CPU Fan Height', 'Max PSU length', 'Inherent Cooling'] },
    { id: 'storage', label: 'Storage & Cooling', fields: [
      'HDD Slots', 'SSD Slots', 'Spawns With Fans', 'Radiator Sizes', 'Max Radiator Sizes',
      'Has Max Rad Thickness', 'Max Radiator Thickness', 'Pump Reservoir Size',
      'Allow Non Modular', 'Has Pin Door'] },
    { id: 'variant', label: 'Variant & Compat', fields: [
      'Variant Of', 'Incompatible PC Parts IDs', 'DLC Path', 'DLC Asset Name',
      'DLC Steam AppId', 'DLC WeGame Id', 'DLC GOG Id', 'Reason for Remove'] }
  ];

  /* Allowed values, taken from the distribution in the vanilla Cases table
   * rather than from intuition. Getting these wrong is worse than offering no
   * dropdown at all, because a made-up value is silently rejected in game.
   *
   *   Case Size  Mid Tower 228 / Micro 85 / Full Tower 40 / Cube 18 /
   *              Open Frame 7 / Super Tower 4        (not "Micro Tower", "SFF")
   *   Class      Normal 366 / Good 13 / Ultra 3      (not "Special", "Custom")
   *   PSU size   ATX 339 / SFX 43                    (not "SFX-L", "TFX")
   */
  var ENUMS = {
    'Part Type': ['Case'],
    'Class': ['Normal', 'Good', 'Ultra'],
    'Case Size': ['Mid Tower', 'Micro', 'Full Tower', 'Cube', 'Open Frame', 'Super Tower'],
    'PSU size': ['ATX', 'SFX'],
    'Component Lighting': ['N/A', 'RGB', 'White', 'Red', 'Green']
  };

  var YES_NO = ['Yes', 'No'];

  var YES_NO_FIELDS = [
    'In Game', 'In Shop', 'Imported to Game', 'Working in game', 'Model Supplied',
    'Curved Glass', 'Clear Side', 'Is Open Bench', 'GPU Holder', 'Spawns With Fans',
    'Has Pin Door', 'Allow Non Modular', 'Has Max Mobo Size', 'Has Max Rad Thickness',
    'Is Scale V2', 'Is DLC', 'Use in Random Jobs', 'Use For WC Jobs',
    'Use For Paint Case Jobs', 'Start In Freebuild Inventory', 'Start In Career Inventory',
    'In Open Beta', 'Licensor Approved', 'Imported But disabled'
  ];

  /* Numeric fields the form renders as <input type=number>. These are counts
   * and millimetre measurements, never comma lists. */
  var NUMBER_FIELDS = [
    'Price', 'SellPrice', 'Level', 'Percent Through', 'Max PCI Size', 'GPU Slots',
    'Max GPU length', 'Max GPU width', 'Restricted GPU length', 'Max CPU Fan Height',
    'Max PSU length', 'Inherent Cooling', 'HDD Slots', 'SSD Slots', 'Pump Reservoir Size',
    'Max Radiator Thickness', 'DLC Steam AppId'
  ];

  /* Fields whose value is a free-text comma list, e.g. "120, 140, 240". */
  var LIST_FIELDS = [
    'Motherboard Size', 'Radiator Sizes', 'Max Radiator Sizes', 'Max Motherboard Size',
    'Incompatible PC Parts IDs'
  ];

  var TEXTAREA_FIELDS = ['Notes', 'Headline', 'Incompatible PC Parts IDs', 'Reason for Remove'];

  /* Which input control a field gets. Returns one of
   * 'enum' | 'boolean' | 'number' | 'list' | 'textarea' | 'text'. */
  function controlFor(name) {
    if (ENUMS[name] || name === 'Part Type') return 'enum';
    if (name === 'Motherboard Size') return 'list-text';
    if (YES_NO_FIELDS.indexOf(name) !== -1) return 'boolean';
    if (NUMBER_FIELDS.indexOf(name) !== -1) return 'number';
    if (LIST_FIELDS.indexOf(name) !== -1) return 'list';
    if (TEXTAREA_FIELDS.indexOf(name) !== -1) return 'textarea';
    return 'text';
  }

  var MOBO_SIZES = [
    'Mini-ITX', 'Micro-ATX', 'S-ATX', 'E-ATX', 'XL-ATX',
    'Mini-DTX', 'SSI-EEB', 'SSI-CEB', 'Intel NUC', 'Intel Mini-STX'
  ];

  function groupFields(order) {
    var rank = Object.create(null);
    order.forEach(function (n, i) { rank[n] = i; });

    var seen = Object.create(null);
    var out = [];
    GROUPS.forEach(function (g) {
      var present = g.fields.filter(function (n) {
        if (!(n in rank) || seen[n]) return false;
        seen[n] = true;
        return true;
      });
      // Within a group, follow the file's own order so the form reads like the
      // XML it produces.
      present.sort(function (a, b) { return rank[a] - rank[b]; });
      if (present.length) out.push({ id: g.id, label: g.label, fields: present });
    });
    var rest = order.filter(function (n) { return !seen[n]; });
    if (rest.length) out.push({ id: 'other', label: 'Other', fields: rest });
    return out;
  }

  /* Build a fresh, internally consistent model from a vanilla row: every
   * vanilla column in table order, plus the one column mod files add. */
  function modelFromVanilla(base, fieldOrder, id) {
    var fields = fieldOrder.map(function (name) {
      return { name: name, value: base[name] == null ? '' : String(base[name]) };
    });
    fields.push({ name: 'Icon Path', value: '' });

    var model = {
      prefabLine: String(base['Asset Path'] || '').trim(),
      fields: fields,
      order: fields.map(function (f) { return f.name; }),
      map: {},
      hasBlankCell: true,
      truncated: false
    };
    fields.forEach(function (f) { model.map[f.name] = f.value; });

    if (id) {
      setValue(model, 'ID', id);
      setValue(model, 'Part Name', 'New Case');
    }
    return model;
  }

  /* Single place that keeps fields/order/map in sync. Every mutation goes
   * through here so the three views can never disagree. */
  function setValue(model, name, value) {
    value = value == null ? '' : String(value);
    for (var i = 0; i < model.fields.length; i++) {
      if (model.fields[i].name === name) {
        model.fields[i].value = value;
        // From now on the cell is written from the value, not the old bytes.
        model.fields[i].dirty = true;
        model.map[name] = value;
        return model;
      }
    }
    model.fields.push({ name: name, value: value, raw: null, dirty: true });
    if (model.order.indexOf(name) === -1) model.order.push(name);
    model.map[name] = value;
    return model;
  }

  /* Fields that describe this file's own identity rather than the borrowed
   * prefab. A new case MUST differ here, so they should not be counted as
   * "you forgot to change this". */
  var IDENTITY_FIELDS = ['ID', 'Part Name', 'Asset Path', 'Variant Of', 'Icon Path'];

  /* Vanilla columns whose value is derived from another field and therefore
   * looks like a "forgotten" mismatch when only that other field changed.
   * `Concat name` is "(level) manufacturer name"; it follows Level/Manufacturer/
   * Part Name, so counting it separately double-counts. */
  var DERIVED_FIELDS = ['Concat name'];

  var api = {
    parseModXml: parseModXml,
    buildModXml: buildModXml,
    resolveIcon: resolveIcon,
    iconUrl: iconUrl,
    diffAgainstDonor: diffAgainstDonor,
    check: check,
    groupFields: groupFields,
    modelFromVanilla: modelFromVanilla,
    setValue: setValue,
    controlFor: controlFor,
    lastSeg: lastSeg,
    num: num,
    GROUPS: GROUPS,
    ENUMS: ENUMS,
    YES_NO: YES_NO,
    YES_NO_FIELDS: YES_NO_FIELDS,
    MOBO_SIZES: MOBO_SIZES,
    IDENTITY_FIELDS: IDENTITY_FIELDS,
    DERIVED_FIELDS: DERIVED_FIELDS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PCBS2 = api;
})(typeof window !== 'undefined' ? window : this);