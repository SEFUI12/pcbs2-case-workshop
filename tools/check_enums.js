/* Check every enumerated field in the release set against the vanilla table.
 *
 * The game matches several fields against fixed string lists. A typo there does
 * not throw -- the part just stops being classified, which is invisible until a
 * player reports it. This catches that before upload.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = 'C:/工作/spaces/2026_11_13_21-15-25/pcbs2-part-workshop';
const P = require(path.join(ROOT, 'web', 'js', 'pcbs2.js'));

const DIR = 'C:/工作/spaces/2026_11_13_21-15-25/_prepublish';
const vanilla = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/vanilla_cases.json'), 'utf8'));

// Fields the game compares against a closed set. Derived from the vanilla table
// itself: any field where the distinct value count is small AND the values look
// like tokens rather than free text.
const ENUM_FIELDS = ['Part Type', 'Class', 'Case Size', 'PSU size', 'Component Lighting'];

const allowed = {};
for (const f of ENUM_FIELDS) {
  const s = new Set();
  for (const c of vanilla.cases) s.add(String(c[f] || '').trim());
  allowed[f] = s;
}

// Motherboard Size is a comma-separated list of tokens, checked separately.
const moboSizes = new Set(P.MOBO_SIZES);

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.xml')).sort();
let problems = 0;

for (const f of files) {
  const m = P.parseModXml(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const g = (n) => {
    const x = m.fields.find(z => z.name === n);
    return x ? String(x.value || '').trim() : '';
  };

  for (const field of ENUM_FIELDS) {
    const v = g(field);
    if (!v) { console.log(`${f}  ${field}: (empty)`); problems++; continue; }
    if (!allowed[field].has(v)) {
      console.log(`${f}  ${field}: ${JSON.stringify(v)} 不在游戏取值里`);
      problems++;
    }
  }

  // Motherboard Size: every token must be a known size.
  const mobo = g('Motherboard Size');
  for (const t of mobo.split(',').map(x => x.trim()).filter(Boolean)) {
    if (!moboSizes.has(t)) {
      console.log(`${f}  Motherboard Size: ${JSON.stringify(t)} 不是已知尺寸`);
      problems++;
    }
  }
}

console.log(problems ? `\n发现 ${problems} 个问题` : '\n枚举字段全部合法');
console.log('\n各字段允许值:');
for (const f of ENUM_FIELDS) console.log('  ' + f + ':', [...allowed[f]].filter(Boolean).join(' / '));