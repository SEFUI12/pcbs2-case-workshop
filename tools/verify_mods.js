#!/usr/bin/env node
/* Verify the workshop against a real mods folder.
 *
 *   node tools/verify_mods.js "C:/Games/PCBS2/mods"
 *   node tools/verify_mods.js --json <folder>      machine-readable
 *   node tools/verify_mods.js --self-test          README claims only
 *
 * Exits non-zero if any file fails to round-trip, or if any error-level check
 * fires. Warnings are reported but do not fail: they describe deliberate
 * choices as often as defects.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'web', 'js', 'pcbs2.js'));

/* ------------------------------------------------------------------ input */

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const selfTest = args.includes('--self-test');
const typeArg = (args.find(a => a.startsWith('--type=')) || '').split('=')[1] || null;
const dir = args.filter(a => !a.startsWith('--'))[0];

const vanilla = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'web', 'data', 'vanilla_cases.json'), 'utf8'));
const icons = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'web', 'icons', 'index.json'), 'utf8'));

const byAsset = new Map();
for (const c of vanilla.cases) {
  const a = String(c['Asset Path'] || '').trim();
  if (a && !byAsset.has(a)) byAsset.set(a, c);
}
const vanillaIds = new Map();
for (const c of vanilla.cases) if (c['ID']) vanillaIds.set(c['ID'], c);

/* ---------------------------------------------------------------- scanning */

function scan(folder) {
  const all = fs.readdirSync(folder)
    .filter(f => /\.xml$/i.test(f))
    .sort();

  const names = [];
  const skipped = [];
  for (const f of all) {
    if (!typeArg) { names.push(f); continue; }
    /* A mixed mods folder holds coolers, GPUs and so on. Reporting "Part Type
     * is not Case" for all of them is noise, so filter them out up front
     * instead of pretending they are failures. */
    const head = fs.readFileSync(path.join(folder, f), 'utf8').slice(0, 4000);
    const m = /div\s*=\s*"Part Type"\s*>([^<]*)</i.exec(head);
    const t = m ? m[1].trim() : '';
    if (t.toLowerCase() === typeArg.toLowerCase()) names.push(f);
    else skipped.push(f);
  }

  const rows = [];
  const totals = {
    files: names.length, roundtripFail: 0, errors: 0, warnings: 0,
    noDonor: 0, blankCard: 0, contentChanged: 0, identityChanged: 0,
    changed: 0, missing: 0, idClashWithVanilla: 0, duplicatesWithinSet: 0,
    skippedOtherType: skipped.length
  };
  const missingCounter = Object.create(null);
  const seenIds = new Map();

  for (const f of names) {
    const raw = fs.readFileSync(path.join(folder, f), 'utf8');
    const m = P.parseModXml(raw);
    const asset = String(m.map['Asset Path'] || '').trim() || m.prefabLine;
    const donor = byAsset.get(asset) || null;

    // Byte-exact round-trip is the hard promise: editing must not silently
    // rewrite a file the user did not touch.
    const rebuilt = P.buildModXml(m);
    const rt = rebuilt === raw;
    if (!rt) totals.roundtripFail++;

    const icon = P.resolveIcon(asset, icons);
    if (icon.kind !== 'mini') totals.blankCard++;

    const id = String(m.map['ID'] || '').trim();
    if (id) {
      seenIds.set(id, (seenIds.get(id) || 0) + 1);
      if (vanillaIds.has(id)) totals.idClashWithVanilla++;
    }

    const iss = P.check(m, icons, donor);
    const errs = iss.filter(i => i.level === 'error').length;
    const warns = iss.filter(i => i.level === 'warn').length;
    totals.errors += errs;
    totals.warnings += warns;

    let changed = 0, missing = 0, content = 0, identity = 0;
    if (donor) {
      const d = P.diffAgainstDonor(m.fields, donor, vanilla.field_order);
      changed = d.changed.length;
      missing = d.missing.length;
      /* Identity fields are meant to differ from the donor; derived fields are
       * recomputed from others. Counting them as "forgot to change" inflates
       * the number and hides what actually needs fixing. */
      identity = d.changed.filter(c => P.IDENTITY_FIELDS.indexOf(c.name) !== -1).length;
      content = d.changed.filter(c =>
        P.IDENTITY_FIELDS.indexOf(c.name) === -1 &&
        P.DERIVED_FIELDS.indexOf(c.name) === -1).length;

      totals.changed += changed;
      totals.contentChanged += content;
      totals.identityChanged += identity;
      totals.missing += missing;
      d.missing.forEach(x => {
        missingCounter[x.name] = (missingCounter[x.name] || 0) + 1;
      });
    } else {
      totals.noDonor++;
    }

    rows.push({
      file: f, id, name: m.map['Part Name'] || '', donor: donor ? donor['Part Name'] : null,
      changed, content, identity, missing,
      errors: errs, warnings: warns, icon: icon.kind,
      roundtrip: rt, fields: m.fields.length, truncated: !!m.truncated,
      errorList: iss.filter(i => i.level === 'error').map(i => i.code + ' ' + i.msg)
    });
  }

  seenIds.forEach((n, id) => { if (n > 1) totals.duplicatesWithinSet++; });
  return { rows, totals, missingCounter };
}

/* ---------------------------------------------------------------- reporting */

const pad = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);
const lpad = (s, n) => String(s == null ? '' : s).padStart(n);

function report(res, label) {
  const { rows, totals, missingCounter } = res;

  console.log('');
  console.log(`${pad('file', 30)}${pad('donor', 26)}${lpad('ctnt', 5)}${lpad('idn', 5)}` +
    `${lpad('miss', 6)}${lpad('err', 5)}${lpad('warn', 6)}  ${pad('icon', 8)}rt`);
  console.log('─'.repeat(100));
  for (const r of rows) {
    console.log(
      pad(r.file, 30) +
      pad(r.donor || '—', 26) +
      lpad(r.content, 5) + lpad(r.identity, 5) + lpad(r.missing, 6) +
      lpad(r.errors, 5) + lpad(r.warnings, 6) + '  ' +
      pad(r.icon, 8) + (r.roundtrip ? 'ok' : 'DIFF')
    );
  }

  console.log('\n=== totals ===');
  for (const [k, v] of Object.entries(totals)) {
    console.log(`  ${pad(k, 24)} ${v}`);
  }

  const dropped = Object.entries(missingCounter).sort((a, b) => b[1] - a[1]);
  if (dropped.length) {
    console.log('\n=== vanilla fields most often absent from a mod ===');
    for (const [k, v] of dropped.slice(0, 10)) {
      console.log(`  ${pad(k, 26)} ${v}/${totals.files}`);
    }
  }

  const bad = rows.filter(r => r.errors > 0 || !r.roundtrip);
  if (bad.length) {
    console.log('\n=== failures ===');
    for (const r of bad) {
      console.log(`  ${r.file}`);
      if (!r.roundtrip) console.log('    round-trip changed the file');
      r.errorList.forEach(e => console.log('    ' + e));
    }
  }

  const ok = totals.roundtripFail === 0 && totals.errors === 0;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${label}`);
  return ok;
}

/* -------------------------------------------------------------- self-test */

/* The README makes numeric claims. Check them against the shipped data so they
 * cannot quietly drift out of date. */
function runSelfTest() {
  const facts = [];

  const test = (label, actual, expected) => {
    facts.push({ label, actual, expected, ok: actual === expected });
  };

  test('vanilla cases', vanilla.cases.length, vanilla.case_count);
  test('vanilla fields', vanilla.field_order.length, 77);
  test('_MINI sprites in index', icons.count, Object.keys(icons.sprites).length);

  // Every vanilla case must resolve to a _MINI sprite. This is the finding the
  // whole card preview rests on.
  let resolved = 0, unresolved = [];
  for (const c of vanilla.cases) {
    const r = P.resolveIcon(String(c['Asset Path'] || '').trim(), icons);
    if (r.kind === 'mini') resolved++;
    else unresolved.push(c['ID']);
  }
  test('vanilla cases with a _MINI sprite', resolved, vanilla.cases.length);

  // Every sprite in the manifest must exist on disk, or the preview breaks.
  let present = 0;
  for (const rec of Object.values(icons.sprites)) {
    if (fs.existsSync(path.join(ROOT, 'web', 'icons', rec.f))) present++;
  }
  test('sprite files present on disk', present, icons.count);

  // The manifest must not advertise non-_MINI art: the card never uses it.
  const nonMini = Object.keys(icons.sprites).filter(k => !k.toUpperCase().endsWith('_MINI'));
  test('non-_MINI entries in manifest', nonMini.length, 0);

  // Every vanilla row must survive parse -> build untouched as a table.
  let rtOk = 0;
  for (const c of vanilla.cases) {
    const m = P.modelFromVanilla(c, vanilla.field_order);
    const again = P.parseModXml(P.buildModXml(m));
    if (again.fields.length === m.fields.length) rtOk++;
  }
  test('vanilla rows that round-trip', rtOk, vanilla.cases.length);

  const width = Math.max(...facts.map(f => f.label.length));
  console.log('');
  for (const f of facts) {
    const mark = f.ok ? 'ok  ' : 'FAIL';
    console.log(`  ${mark}  ${pad(f.label, width)}  ${f.actual}` +
      (f.ok ? '' : `   (expected ${f.expected})`));
  }
  if (unresolved.length) {
    console.log(`\n  cases with no _MINI sprite: ${unresolved.slice(0, 10).join(', ')}`);
  }

  const ok = facts.every(f => f.ok) && nonMini.length === 0;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  README claims`);
  return ok;
}

/* -------------------------------------------------------------------- main */

if (selfTest) {
  process.exit(runSelfTest() ? 0 : 1);
}

if (!dir) {
  console.error('usage: node tools/verify_mods.js "<mods folder>" [--json]');
  console.error('       node tools/verify_mods.js --self-test');
  process.exit(2);
}

if (!fs.existsSync(dir)) {
  console.error(`no such folder: ${dir}`);
  process.exit(2);
}

const res = scan(dir);

if (asJson) {
  console.log(JSON.stringify(res, null, 2));
} else {
  report(res, dir);
}

process.exit(res.totals.roundtripFail === 0 && res.totals.errors === 0 ? 0 : 1);