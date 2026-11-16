/* Unit tests for web/js/pcbs2.js. No dependencies; run with `node --test`.
 *
 * These encode the facts the README claims, so a regression in any of them is
 * a broken promise rather than a cosmetic bug.
 */
const test = require('node:test');
const assert = require('node:assert');
const P = require('../web/js/pcbs2.js');

/* A minimal but realistic file: the bare prefab line, the blank leading cell,
 * then div-anchored fields in file order. */
const SAMPLE = [
  'Prefabs/Cases/Corsair/CAS_Corsair_iCUE_5000D_AirFlow',
  '<table>',
  '\t<tr>',
  '\t\t<td div=""></td>',
  '\t\t<td div="Part Type">Case</td>',
  '\t\t<td div="ID">Case_Custom_30020</td>',
  '\t\t<td div="Part Name">4000D Airflow</td>',
  '\t\t<td div="Manufacturer">Corsair</td>',
  '\t\t<td div="In Game">Yes</td>',
  '\t\t<td div="Price">219</td>',
  '\t\t<td div="Level">1</td>',
  '\t\t<td div="Asset Path">Prefabs/Cases/Corsair/CAS_Corsair_iCUE_5000D_AirFlow</td>',
  '\t\t<td div="Icon Path"></td>',
  '\t</tr>',
  '</table>',
  ''
].join('\n');

const ICONS = {
  sprites: {
    'CAS_Corsair_iCUE_5000D_AirFlow_MINI': { w: 256, h: 256, f: 'CAS_Corsair_iCUE_5000D_AirFlow_MINI.webp' },
    'CAS_Other_Case_MINI': { w: 256, h: 256, f: 'CAS_Other_Case_MINI.webp' }
  },
  lower: {
    'cas_corsair_icue_5000d_airflow_mini': 'CAS_Corsair_iCUE_5000D_AirFlow_MINI',
    'cas_other_case_mini': 'CAS_Other_Case_MINI'
  },
  count: 2
};

/* --------------------------------------------------------------- parsing */

test('parses the bare prefab line and every div-named field', () => {
  const m = P.parseModXml(SAMPLE);
  assert.strictEqual(m.prefabLine, 'Prefabs/Cases/Corsair/CAS_Corsair_iCUE_5000D_AirFlow');
  assert.strictEqual(m.map['Part Type'], 'Case');
  assert.strictEqual(m.map['Part Name'], '4000D Airflow');
  assert.strictEqual(m.fields.length, 9);
  assert.ok(m.hasBlankCell);
  assert.strictEqual(m.truncated, false);
});

test('keeps field order exactly as found in the file', () => {
  const m = P.parseModXml(SAMPLE);
  assert.deepStrictEqual(m.order.slice(0, 4), ['Part Type', 'ID', 'Part Name', 'Manufacturer']);
});

test('strips a UTF-8 BOM without eating the prefab line', () => {
  const m = P.parseModXml('\uFEFF' + SAMPLE);
  assert.strictEqual(m.prefabLine, 'Prefabs/Cases/Corsair/CAS_Corsair_iCUE_5000D_AirFlow');
});

test('accepts div anywhere in the tag, not just first', () => {
  const m = P.parseModXml('<table><tr><td style="x" div="Price">5</td></tr></table>');
  assert.strictEqual(m.map['Price'], '5');
});

test('decodes entities and trims surrounding whitespace', () => {
  const m = P.parseModXml('<table><tr><td div="Part Name">  A &amp; B &lt;x&gt; </td></tr></table>');
  assert.strictEqual(m.map['Part Name'], 'A & B <x>');
});

test('flags a table with no closing tag', () => {
  const m = P.parseModXml('<table><tr><td div="ID">x</td>');
  assert.strictEqual(m.truncated, true);
});

test('a file with no table at all yields no fields', () => {
  const m = P.parseModXml('just a stray line\n');
  assert.deepStrictEqual(m.fields, []);
  assert.strictEqual(m.prefabLine, 'just a stray line');
});

test('throws on a non-string rather than coercing silently', () => {
  assert.throws(() => P.parseModXml(null), /needs a string/);
});

/* --------------------------------------------------------------- writing */

test('round-trips the sample byte-for-byte', () => {
  const out = P.buildModXml(P.parseModXml(SAMPLE));
  assert.strictEqual(out, SAMPLE);
});

test('round-trip survives a second pass unchanged', () => {
  const once = P.buildModXml(P.parseModXml(SAMPLE));
  const twice = P.buildModXml(P.parseModXml(once));
  assert.strictEqual(once, twice);
});

test('re-escapes ampersands on write', () => {
  const m = P.parseModXml('<table><tr><td div="Part Name">A &amp; B</td></tr></table>');
  assert.match(P.buildModXml(m), /A &amp; B/);
});

test('preserves a missing blank cell', () => {
  const noBlank = '<table>\n\t<tr>\n\t\t<td div="ID">x</td>\n\t</tr>\n</table>\n';
  const m = P.parseModXml(noBlank);
  assert.strictEqual(m.hasBlankCell, false);
  assert.doesNotMatch(P.buildModXml(m), /div=""/);
});

test('setValue appends a field that is not present yet', () => {
  const m = P.parseModXml(SAMPLE);
  P.setValue(m, 'Max PCI Size', '3');
  assert.strictEqual(m.map['Max PCI Size'], '3');
  assert.ok(m.order.includes('Max PCI Size'));
  assert.match(P.buildModXml(m), /<td div="Max PCI Size">3<\/td>/);
});

test('setValue updates in place without reordering', () => {
  const m = P.parseModXml(SAMPLE);
  const before = m.fields.map(f => f.name);
  P.setValue(m, 'Price', '1');
  assert.deepStrictEqual(m.fields.map(f => f.name), before);
  assert.strictEqual(m.map['Price'], '1');
});

/* --------------------------------------------------------------- resolve */

test('resolves the _MINI sprite by the last Asset Path segment', () => {
  const r = P.resolveIcon('Prefabs/Cases/Corsair/CAS_Corsair_iCUE_5000D_AirFlow', ICONS);
  assert.deepStrictEqual(r, { kind: 'mini', name: 'CAS_Corsair_iCUE_5000D_AirFlow_MINI' });
});

test('resolves case-insensitively', () => {
  const r = P.resolveIcon('prefabs/cases/corsair/cas_corsair_icue_5000d_airflow', ICONS);
  assert.strictEqual(r.name, 'CAS_Corsair_iCUE_5000D_AirFlow_MINI');
});

test('normalises backslashes so a Windows path resolves', () => {
  const r = P.resolveIcon('Prefabs\\Cases\\Corsair\\CAS_Corsair_iCUE_5000D_AirFlow', ICONS);
  assert.strictEqual(r.kind, 'mini');
});

test('reports missing, not a bare-sprite fallback', () => {
  /* The bare sprite existing is NOT enough: the game asks for _MINI. Falling
   * back here would turn a blank card into a false "fine". */
  const icons = { sprites: { CAS_Thing: { f: 'a.webp' } }, lower: {} };
  const r = P.resolveIcon('Prefabs/Cases/CAS_Thing', icons);
  assert.strictEqual(r.kind, 'missing');
  assert.strictEqual(r.name, null);
});

test('an empty or missing Asset Path is reported as no-asset', () => {
  assert.strictEqual(P.resolveIcon('', ICONS).kind, 'no-asset');
  assert.strictEqual(P.resolveIcon(null, ICONS).kind, 'no-asset');
  assert.strictEqual(P.resolveIcon('///', ICONS).kind, 'no-asset');
});

test('iconUrl builds a relative path and refuses a null hit', () => {
  const r = P.resolveIcon('Prefabs/Cases/Corsair/CAS_Corsair_iCUE_5000D_AirFlow', ICONS);
  assert.strictEqual(P.iconUrl(r, ICONS), 'icons/CAS_Corsair_iCUE_5000D_AirFlow_MINI.webp');
  assert.strictEqual(P.iconUrl({ kind: 'missing', name: null }, ICONS), null);
});

/* ------------------------------------------------------------------ diff */

const DONOR = {
  'Part Type': 'Case',
  'ID': 'Case_Corsair_5000D',
  'Part Name': 'iCUE 5000D Airflow',
  'Price': '219',
  'Max PCI Size': '3',
  'Case Size': 'Mid Tower'
};
const ORDER = Object.keys(DONOR);

test('splits fields into changed, missing, same and mod-only', () => {
  const fields = [
    { name: 'Part Type', value: 'Case' },
    { name: 'ID', value: 'Case_Custom_30020' },
    { name: 'Part Name', value: '4000D Airflow' },
    { name: 'Price', value: '219' },
    { name: 'Case Size', value: 'Micro' },
    { name: 'Icon Path', value: '' }
  ];
  const d = P.diffAgainstDonor(fields, DONOR, ORDER);
  assert.deepStrictEqual(d.changed.map(c => c.name).sort(),
    ['Case Size', 'ID', 'Part Name']);
  assert.deepStrictEqual(d.missing.map(c => c.name), ['Max PCI Size']);
  assert.deepStrictEqual(d.same.map(c => c.name), ['Part Type', 'Price']);
  assert.deepStrictEqual(d.added.map(c => c.name), ['Icon Path']);
});

test('whitespace-only differences do not count as changed', () => {
  const d = P.diffAgainstDonor(
    [{ name: 'Price', value: ' 219 ' }, { name: 'Part Type', value: 'Case' },
     { name: 'ID', value: 'Case_Corsair_5000D' }, { name: 'Part Name', value: 'iCUE 5000D Airflow' },
     { name: 'Case Size', value: 'Mid Tower' }, { name: 'Max PCI Size', value: '3' }],
    DONOR, ORDER);
  assert.deepStrictEqual(d.changed, []);
});

/* ---------------------------------------------------------------- checks */

function checked(fields, donor) {
  const model = {
    prefabLine: '',
    fields: Object.keys(fields).map(k => ({ name: k, value: fields[k] })),
    map: { ...fields }
  };
  return P.check(model, ICONS, donor || null);
}

const GOOD = {
  'Part Type': 'Case',
  'ID': 'Case_Custom_1',
  'Part Name': 'Test',
  'In Game': 'Yes',
  'Asset Path': 'Prefabs/Cases/Corsair/CAS_Corsair_iCUE_5000D_AirFlow',
  'Price': '120',
  'Level': '5',
  'Max GPU length': '360',
  'Restricted GPU length': '330',
  'Model Supplied': 'Yes'
};

test('a clean file raises no errors and no warnings', () => {
  const iss = checked(GOOD);
  assert.deepStrictEqual(iss.filter(i => i.level === 'error'), []);
  assert.deepStrictEqual(iss.filter(i => i.level === 'warn'), []);
});

test('E003 fires when the Asset Path has no _MINI sprite', () => {
  const iss = checked({ ...GOOD, 'Asset Path': 'Prefabs/Cases/Nope/Nope_9000' });
  const e = iss.find(i => i.code === 'E003');
  assert.ok(e, 'expected E003');
  assert.strictEqual(e.level, 'error');
});

test('E001 fires when there is no Asset Path anywhere', () => {
  const iss = checked({ ...GOOD, 'Asset Path': '' });
  assert.ok(iss.some(i => i.code === 'E001'));
});

test('E004 catches a wrong Part Type', () => {
  const iss = checked({ ...GOOD, 'Part Type': 'GPU' });
  assert.ok(iss.some(i => i.code === 'E004' && /expected "Case"/.test(i.msg)));
});

test('E004 catches In Game != Yes', () => {
  const iss = checked({ ...GOOD, 'In Game': 'No' });
  assert.ok(iss.some(i => i.code === 'E004' && /will not load/.test(i.msg)));
});

test('E005 catches an ID used by another loaded file', () => {
  const model = { prefabLine: '', map: GOOD, fields: [] };
  const iss = P.check(model, ICONS, null, { duplicateIds: { 'Case_Custom_1': true } });
  assert.ok(iss.some(i => i.code === 'E005'));
});

test('E009 reports fields the donor has and the file lacks', () => {
  const full = {};
  /* A file must be ~complete for E009 to run, or a stub would emit one warning
   * per column and bury the real findings. */
  for (let i = 0; i < 20; i++) full['Field ' + i] = 'x';
  const donor = { ...full, 'Max PCI Size': '3' };
  const model = { prefabLine: '', map: full, fields: Object.keys(full).map(k => ({ name: k, value: 'x' })) };
  const iss = P.check(model, ICONS, donor);
  assert.ok(iss.some(i => i.code === 'E009' && /Max PCI Size/.test(i.msg)));
});

test('I005 instead of E009 spam on a stub file', () => {
  const donor = {};
  for (let i = 0; i < 77; i++) donor['F' + i] = 'v';
  const model = { prefabLine: '', map: GOOD, fields: Object.keys(GOOD).map(k => ({ name: k, value: GOOD[k] })) };
  const iss = P.check(model, ICONS, donor);
  assert.ok(iss.some(i => i.code === 'I005'));
  assert.strictEqual(iss.filter(i => i.code === 'E009').length, 0);
});

test('C001 catches a restricted GPU length above the max', () => {
  const iss = checked({ ...GOOD, 'Max GPU length': '300', 'Restricted GPU length': '330' });
  assert.ok(iss.some(i => i.code === 'C001'));
});

test('C002 uses the vanilla flag convention: "1" or empty, never "0"', () => {
  const iss = checked({ ...GOOD, 'Motherboard Size': 'Mini-ITX,', 'E-ATX': '1' });
  const c = iss.find(i => i.code === 'C002');
  assert.ok(c, 'expected C002');
  assert.match(c.msg, /E-ATX/);
});

test('C002 stays quiet when the flag agrees with the list', () => {
  const iss = checked({ ...GOOD, 'Motherboard Size': 'Mini-ITX, E-ATX,', 'E-ATX': '1' });
  assert.strictEqual(iss.filter(i => i.code === 'C002').length, 0);
});

test('C002 treats a "0" flag as unsupported, not as a claim', () => {
  /* Vanilla writes "1" or empty, but hand-written mods write "0". Treating "0"
   * as a claim would flag every correctly-empty flag. */
  const iss = checked({ ...GOOD, 'Motherboard Size': 'Mini-ITX,', 'E-ATX': '0' });
  assert.strictEqual(iss.filter(i => i.code === 'C002').length, 0);
});

test('C002 ignores a "1" flag when Motherboard Size is blank', () => {
  const iss = checked({ ...GOOD, 'Motherboard Size': '', 'E-ATX': '1' });
  assert.strictEqual(iss.filter(i => i.code === 'C002').length, 0);
});

test('C003 catches a SellPrice above Price', () => {
  const iss = checked({ ...GOOD, 'Price': '100', 'SellPrice': '150' });
  assert.ok(iss.some(i => i.code === 'C003'));
});

test('I003 notes a level-1 case priced for day one', () => {
  const iss = checked({ ...GOOD, 'Level': '1', 'Price': '400' });
  assert.ok(iss.some(i => i.code === 'I003'));
});

test('a blank Level is noted, not treated as an error', () => {
  const iss = checked({ ...GOOD, 'Level': '' });
  assert.ok(iss.some(i => i.code === 'I003'));
  assert.deepStrictEqual(iss.filter(i => i.level === 'error'), []);
});

/* ---------------------------------------------------------------- enums */

test('every enum value exists in the vanilla table', () => {
  /* This is the test that would have caught "Micro Tower", "Special" and
   * "SFX-L" -- invented values the game silently rejects. */
  const fs = require('fs');
  const path = require('path');
  const v = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'web', 'data', 'vanilla_cases.json'), 'utf8'));

  const seen = {};
  v.cases.forEach(c => {
    Object.keys(P.ENUMS).forEach(field => {
      const val = String(c[field] == null ? '' : c[field]).trim();
      if (!val) return;
      seen[field] = seen[field] || new Set();
      seen[field].add(val);
    });
  });

  Object.keys(P.ENUMS).forEach(field => {
    const allowed = P.ENUMS[field];
    const actual = seen[field] || new Set();
    allowed.forEach(v0 => {
      assert.ok(actual.has(v0),
        `ENUMS['${field}'] offers "${v0}", which appears in no vanilla case. ` +
        `Vanilla values: ${[...actual].join(', ')}`);
    });
  });
});

test('every enum value the vanilla table uses is offered in the dropdown', () => {
  const fs = require('fs');
  const path = require('path');
  const v = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'web', 'data', 'vanilla_cases.json'), 'utf8'));

  Object.keys(P.ENUMS).forEach(field => {
    const used = new Set(v.cases
      .map(c => String(c[field] == null ? '' : c[field]).trim())
      .filter(Boolean));
    const offered = new Set(P.ENUMS[field]);
    used.forEach(u => {
      assert.ok(offered.has(u),
        `Vanilla uses "${u}" for ${field} but the dropdown does not offer it.`);
    });
  });
});

test('yes/no fields only ever hold Yes, No or blank in vanilla', () => {
  const fs = require('fs');
  const path = require('path');
  const v = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'web', 'data', 'vanilla_cases.json'), 'utf8'));
  v.cases.forEach(c => {
    P.YES_NO_FIELDS.forEach(f => {
      const val = String(c[f] == null ? '' : c[f]).trim();
      assert.ok(val === '' || val === 'Yes' || val === 'No',
        `${f} holds "${val}" in case ${c.ID}`);
    });
  });
});

test('controlFor picks a control for every vanilla field', () => {
  const fs = require('fs');
  const path = require('path');
  const v = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'web', 'data', 'vanilla_cases.json'), 'utf8'));
  const valid = ['enum', 'boolean', 'number', 'list', 'textarea', 'text', 'list-text'];
  v.field_order.forEach(name => {
    const kind = P.controlFor(name);
    assert.ok(valid.includes(kind), `${name} -> ${kind}`);
  });
});

/* ---------------------------------------------------------------- groups */

test('grouping covers every field exactly once', () => {
  const fs = require('fs');
  const path = require('path');
  const v = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'web', 'data', 'vanilla_cases.json'), 'utf8'));
  const order = v.field_order.concat(['Icon Path']);
  const groups = P.groupFields(order);
  const flat = groups.flatMap(g => g.fields);

  // Every field appears, once, and nothing invented.
  assert.strictEqual(flat.length, order.length);
  assert.deepStrictEqual([...flat].sort(), [...order].sort());
  assert.ok(groups.every(g => g.fields.length > 0));

  // Group members keep the file's field order, so the form reads like the file.
  groups.forEach(g => {
    const idx = g.fields.map(n => order.indexOf(n));
    assert.deepStrictEqual(idx, idx.slice().sort((a, b) => a - b),
      `group "${g.label}" is out of file order`);
  });
});

/* --------------------------------------------------- byte-exact round trip */

/* "Round-trip is byte-identical" is the promise the export makes. These are the
 * four things that broke it in practice, each kept as a regression test. */

test('preserves CRLF line endings', () => {
  const crlf = SAMPLE.replace(/\n/g, '\r\n');
  const m = P.parseModXml(crlf);
  assert.strictEqual(m.eol, '\r\n');
  assert.strictEqual(P.buildModXml(m), crlf);
});

test('preserves LF when the file used LF', () => {
  const m = P.parseModXml(SAMPLE);
  assert.strictEqual(m.eol, '\n');
  assert.strictEqual(P.buildModXml(m), SAMPLE);
});

test('preserves a byte-order mark', () => {
  const withBom = '\uFEFF' + SAMPLE;
  const m = P.parseModXml(withBom);
  assert.strictEqual(m.bom, true);
  assert.strictEqual(P.buildModXml(m), withBom);
});

test('does not add a BOM to a file that had none', () => {
  const m = P.parseModXml(SAMPLE);
  assert.strictEqual(m.bom, false);
  assert.ok(!P.buildModXml(m).startsWith('\uFEFF'));
});

test('keeps trailing spaces inside a cell it did not edit', () => {
  /* Retail files contain "S-ATX, " with a trailing space. Re-encoding the
   * trimmed value changed the file for no reason. */
  const raw = '<table>\n\t<tr>\n\t\t<td div="Motherboard Size">Mini-ITX, S-ATX, </td>\n\t</tr>\n</table>\n';
  const m = P.parseModXml(raw);
  assert.strictEqual(m.map['Motherboard Size'], 'Mini-ITX, S-ATX,');
  assert.strictEqual(P.buildModXml(m), raw);
});

test('an edited field is re-encoded from its value, not its old bytes', () => {
  const raw = '<table>\n\t<tr>\n\t\t<td div="Price"> 219 </td>\n\t</tr>\n</table>\n';
  const m = P.parseModXml(raw);
  P.setValue(m, 'Price', '250');
  const out = P.buildModXml(m);
  assert.match(out, /<td div="Price">250<\/td>/);
  assert.doesNotMatch(out, / 219 /);
});

test('untouched fields keep their bytes while a neighbour changes', () => {
  const m = P.parseModXml(SAMPLE);
  P.setValue(m, 'Price', '1');
  const out = P.buildModXml(m);
  // The whole file is rebuilt, but only Price should differ.
  assert.strictEqual(out, SAMPLE.replace('<td div="Price">219</td>', '<td div="Price">1</td>'));
});

/* --------------------------------------------------------------- fixtures */

test('modelFromVanilla yields all vanilla fields plus Icon Path', () => {
  const fs = require('fs');
  const path = require('path');
  const v = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'web', 'data', 'vanilla_cases.json'), 'utf8'));
  const base = v.cases[0];
  const m = P.modelFromVanilla(base, v.field_order, 'Case_Custom_99999');
  assert.strictEqual(m.fields.length, v.field_order.length + 1);
  assert.strictEqual(m.map['ID'], 'Case_Custom_99999');
  assert.strictEqual(m.map['Part Name'], 'New Case');
  assert.strictEqual(m.map['Icon Path'], '');
  // The model must already be exportable.
  assert.match(P.buildModXml(m), /<td div="ID">Case_Custom_99999<\/td>/);
});