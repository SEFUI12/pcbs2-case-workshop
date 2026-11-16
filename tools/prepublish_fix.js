/* Pre-publish fix-up for the 22 case mods.
 *
 * Four defects, all confirmed against the vanilla table:
 *   1. Max PCI Size missing from all 22 (vanilla: 381/382 hold "3")
 *   2. Level hardcoded to 1 (donors span 2..26; a 449 case at level 1 is unbuyable)
 *   3. Model Supplied blank on 趣造, "No" on 黑洞 5
 *   4. Start In Freebuild Inventory "No" on all 22 (vanilla: 342 Yes / 40 No)
 *
 * Writes fixed copies to _prepublish/, never touches the originals.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = 'C:/工作/spaces/2026_11_13_21-15-25/pcbs2-part-workshop';
const P = require(path.join(ROOT, 'web', 'js', 'pcbs2.js'));

const MODS = 'C:/Games/PCBS2/mods';
const OUT = path.join(ROOT, '..', '_prepublish');

const vanilla = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/vanilla_cases.json'), 'utf8'));
const byAsset = new Map();
for (const c of vanilla.cases) byAsset.set(String(c['Asset Path'] || '').trim(), c);

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(MODS).filter(f => /^CASE_.*\.xml$/i.test(f)).sort();
const report = [];

for (const f of files) {
  const src = path.join(MODS, f);
  const text = fs.readFileSync(src, 'utf8');
  const model = P.parseModXml(text);
  const before = model.fields.length;

  const get = (n) => {
    const x = model.fields.find(z => z.name === n);
    return x ? String(x.value || '').trim() : null;
  };

  const donor = byAsset.get(String(get('Asset Path') || ''));
  const changes = [];

  // 1. Max PCI Size -- vanilla uses "3" for 381 of 382.
  if (get('Max PCI Size') === null || get('Max PCI Size') === '') {
    P.setValue(model, 'Max PCI Size', '3');
    changes.push('Max PCI Size (missing)->3');
  }

  // 2. Level -- take the donor's level so unlock progression stays intact.
  const donorLevel = donor ? String(donor['Level'] || '').trim() : '';
  const myLevel = get('Level');
  if (donorLevel && myLevel !== donorLevel) {
    P.setValue(model, 'Level', donorLevel);
    changes.push(`Level ${myLevel}->${donorLevel}`);
  }

  // 3. Model Supplied -- "No" means the game builds geometry procedurally and
  //    the case looks wrong. Vanilla is 362 Yes / 2 No / 18 blank.
  const myModel = get('Model Supplied');
  if (myModel !== 'Yes') {
    P.setValue(model, 'Model Supplied', 'Yes');
    changes.push(`Model Supplied ${myModel || '(blank)'}->Yes`);
  }

  // 4. Start In Freebuild Inventory -- 342/382 vanilla cases are Yes. A case
  //    that cannot be placed in freebuild cannot be previewed or measured.
  const myFree = get('Start In Freebuild Inventory');
  if (myFree !== 'Yes') {
    P.setValue(model, 'Start In Freebuild Inventory', 'Yes');
    changes.push(`StartInFreebuild ${myFree}->Yes`);
  }

  const out = P.buildModXml(model);
  fs.writeFileSync(path.join(OUT, f), out, 'utf8');

  report.push({
    file: f,
    donor: donor ? String(donor['Part Name']) : null,
    fields: `${before}->${model.fields.length}`,
    changes: changes,
    bytes: `${Buffer.byteLength(text)}->${Buffer.byteLength(out)}`,
  });
}

console.log('== 修复结果 ==\n');
for (const r of report) {
  console.log(r.file.replace('.xml', '').padEnd(22)
    + String(r.fields).padStart(8) + '  '
    + (r.changes.length ? r.changes.join(', ') : '(无改动)'));
}

const noDonor = report.filter(r => !r.donor);
if (noDonor.length) {
  console.log('\n无捐赠者（Level 无法自动推导，需人工指定）：');
  for (const r of noDonor) console.log('  ' + r.file);
}

console.log('\n写入:', OUT);