/* PCBS2 Case Workshop - UI layer.
 *
 * Layout: file list | field form | live card + diff + checks + XML.
 * The card preview is the point: it re-renders on every edit so you can see
 * what the shop will show without launching the game.
 *
 * No framework, no build step: this must open from a double-clicked file.
 */
(function () {
  'use strict';

  var P = window.PCBS2;

  var state = {
    icons: null,
    vanilla: null,
    byAsset: null,
    idIndex: null,     // ID -> name of the loaded file that claims it
    files: [],         // [{name, text, model, dirty}]
    current: -1,
    donor: null,
    diff: null,
    issues: [],
    scope: 'changed',  // changed | missing | same | added
    encoded: false     // true when running from file:// where paths are literal
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var el = function (tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };

  /* ------------------------------------------------------------- bootstrap */

  /* Data arrives as <script>-loaded globals rather than through fetch(). Under
   * file:// (double-clicking index.html) fetch is blocked by CORS, so bundling
   * the two JSON blobs as JS is what keeps this tool openable with no server.
   * Images are exempt from CORS, which is why icons/*.webp still load. */
  function boot() {
    state.encoded = location.protocol === 'file:';

    var v = window.PCBS2_VANILLA;
    var icons = window.PCBS2_ICONS;

    if (!v || !icons) {
      setStatus('data files missing — run tools/build_data_js.py', true);
      return;
    }
    if (!v.cases || !v.cases.length) {
      setStatus('vanilla table is empty — re-run tools/extract_vanilla.py', true);
      return;
    }

    state.vanilla = v;
    state.byAsset = Object.create(null);
    v.cases.forEach(function (c) {
      var a = String(c['Asset Path'] || '').trim();
      if (a && !state.byAsset[a]) state.byAsset[a] = c;
    });

    state.icons = icons;
    state.idIndex = Object.create(null);

    setStatus(v.case_count + ' vanilla cases · ' + icons.count + ' icons');
    enableUi();
  }

  function setStatus(msg, isErr) {
    var s = $('#status');
    s.textContent = msg;
    s.className = isErr ? 'status err' : 'status';
  }

  function enableUi() {
    ['#fileInput', '#folderInput', '#pickFiles', '#pickFolder', '#newBtn']
      .forEach(function (sel) { $(sel).disabled = false; });
  }

  /* ---------------------------------------------------------- file intake */

  function readFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || [])
      .filter(function (f) { return /\.xml$/i.test(f.name); });

    if (!files.length) {
      setStatus('no .xml files in that selection', true);
      return;
    }

    var pending = files.length;
    var loaded = [];
    var failed = [];

    files.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        loaded.push({ name: f.name, text: String(reader.result) });
        if (--pending === 0) finish();
      };
      reader.onerror = function () {
        failed.push(f.name);
        if (--pending === 0) finish();
      };
      reader.readAsText(f, 'utf-8');
    });

    function finish() {
      if (!loaded.length) {
        setStatus('could not read ' + (failed[0] || 'the selection'), true);
        return;
      }
      loaded.sort(function (a, b) { return a.name.localeCompare(b.name); });

      // Merge: drop duplicates by name so re-dropping a folder is idempotent.
      var have = Object.create(null);
      state.files.forEach(function (f) { have[f.name] = true; });
      loaded.forEach(function (f) {
        if (have[f.name]) {
          // Same file re-opened: keep position, refresh text.
          for (var i = 0; i < state.files.length; i++) {
            if (state.files[i].name === f.name) {
              state.files[i].text = f.text;
              state.files[i].model = P.parseModXml(f.text);
              state.files[i].dirty = false;
              return;
            }
          }
        }
        state.files.push({
          name: f.name,
          text: f.text,
          model: P.parseModXml(f.text),
          dirty: false
        });
      });

      rebuildIdIndex();
      renderFileList();
      var firstNew = state.files.length - loaded.length;
      openFile(state.current >= 0 ? state.current : Math.max(0, firstNew));
      setStatus('loaded ' + loaded.length + ' file' + (loaded.length === 1 ? '' : 's') +
        (failed.length ? ' · ' + failed.length + ' unreadable' : ''));
    }
  }

  /* Duplicate IDs across loaded files are a real failure mode: the loader keeps
   * one and discards the other, with no message. Index them up front. */
  function rebuildIdIndex() {
    state.idIndex = Object.create(null);
    state.files.forEach(function (f) {
      var id = String((f.model.map || {})['ID'] || '').trim();
      if (!id) return;
      if (!state.idIndex[id]) state.idIndex[id] = [];
      state.idIndex[id].push(f.name);
    });
  }

  function renderFileList() {
    var list = $('#fileList');
    list.innerHTML = '';
    var frag = document.createDocumentFragment();

    state.files.forEach(function (f, i) {
      var row = el('button', 'file-row');
      row.type = 'button';
      row.appendChild(el('span', 'file-name', f.name.replace(/\.xml$/i, '')));

      var name = String(f.model.map['Part Name'] || '—');
      row.appendChild(el('span', 'file-tag', name));

      var id = String(f.model.map['ID'] || '').trim();
      var clash = id && state.idIndex[id] && state.idIndex[id].length > 1;
      if (clash) row.classList.add('clash');
      if (f.dirty) row.classList.add('dirty');
      if (i === state.current) row.classList.add('on');

      row.title = id + (clash ? '  (duplicate ID across ' + state.idIndex[id].length + ' files)' : '');
      row.addEventListener('click', function () { openFile(i); });
      frag.appendChild(row);
    });

    list.appendChild(frag);
    $('#fileCount').textContent = String(state.files.length);

    var clashes = 0;
    Object.keys(state.idIndex).forEach(function (id) {
      if (state.idIndex[id].length > 1) clashes++;
    });
    var note = $('#clashNote');
    note.hidden = clashes === 0;
    note.textContent = clashes + ' duplicate ID' + (clashes === 1 ? '' : 's');
  }

  function openFile(i) {
    if (!state.files[i]) return;
    state.current = i;
    var f = state.files[i];

    // The form is rebuilt from the model, so commit any pending edit first.
    syncDonor();
    recompute();

    $('#landing').hidden = true;
    $('#editor').hidden = false;
    $('#closeBtn').hidden = false;
    $('#saveBtn').disabled = false;
    $('#saveAllBtn').disabled = false;

    renderFileList();
    renderForm();
    renderCard();
    renderDiff();
    renderIssues();
    renderSource();
    setStatus(f.name + (f.dirty ? ' · unsaved' : ''));
  }

  function syncDonor() {
    var m = state.files[state.current].model;
    var asset = String(m.map['Asset Path'] || '').trim() || m.prefabLine;
    state.donor = state.byAsset[asset] || null;
  }

  function recompute() {
    var m = state.files[state.current].model;
    var dup = Object.create(null);
    var mine = state.files[state.current].name;
    var id = String(m.map['ID'] || '').trim();
    if (id && state.idIndex[id]) {
      state.idIndex[id].forEach(function (n) { if (n !== mine) dup[n] = true; });
    }
    state.issues = P.check(m, state.icons, state.donor, { duplicateIds: dup });
    state.diff = state.donor
      ? P.diffAgainstDonor(m.fields, state.donor, state.vanilla.field_order)
      : null;
  }

  /* -------------------------------------------------------------- the form */

  function renderForm() {
    var m = state.files[state.current].model;
    var host = $('#form');
    host.innerHTML = '';

    if (m.truncated) {
      var warn = el('div', 'banner warn',
        'This file has no closing </table>; the export will repair it.');
      host.appendChild(warn);
    }

    if (m.prefabLine) {
      var note = el('div', 'prefab-note');
      note.appendChild(el('span', 'prefab-label', 'prefab'));
      note.appendChild(el('code', 'prefab-val', m.prefabLine));
      host.appendChild(note);
    }

    var groups = P.groupFields(m.order);
    groups.forEach(function (g) { host.appendChild(groupBox(g, m)); });
  }

  function groupBox(g, m) {
    var box = el('section', 'group');
    var changedInGroup = g.fields.filter(function (n) {
      return state.donor && String(state.donor[n] == null ? '' : state.donor[n]).trim() !==
        String(m.map[n] == null ? '' : m.map[n]).trim();
    }).length;

    var head = el('button', 'group-head');
    head.type = 'button';
    head.appendChild(el('span', 'group-arrow', '▸'));
    head.appendChild(el('span', 'group-title', g.label));
    if (changedInGroup) {
      head.appendChild(el('span', 'group-badge', changedInGroup + ' changed'));
    }
    head.appendChild(el('span', 'group-count', String(g.fields.length)));
    head.addEventListener('click', function () {
      box.classList.toggle('collapsed');
    });
    box.appendChild(head);

    var body = el('div', 'group-body');
    g.fields.forEach(function (name) {
      body.appendChild(fieldRow(name, m.map[name] == null ? '' : m.map[name]));
    });
    box.appendChild(body);
    return box;
  }

  function fieldRow(name, value) {
    var row = el('label', 'field');
    row.appendChild(el('span', 'field-name', name));

    var input = buildInput(name, value);
    input.dataset.field = name;
    input.className = 'field-input';
    input.addEventListener('input', function () { onEdit(name, input.value); });
    input.addEventListener('change', function () { onEdit(name, input.value); });

    /* Order matters: the donor hint pins itself to grid column 2 for a second
     * row, so the input has to be appended first. Appending the hint first
     * pushes the input onto a new row, and it ends up squeezed into the
     * 136px label column. */
    row.appendChild(input);
    decorateField(row, name, String(value));
    row.title = name;
    return row;
  }

  function buildInput(name, value) {
    var kind = P.controlFor(name);
    var input;

    if (kind === 'enum') {
      input = document.createElement('select');
      var opts = (P.ENUMS[name] || []).slice();
      // A value outside the known set must stay selectable, or opening a file
      // and saving it would silently rewrite the field.
      var unknown = value && opts.indexOf(value) === -1;
      if (!value || unknown) {
        input.appendChild(makeOption('', value ? value : '—'));
      }
      if (unknown) {
        // Keep the real value as the selected option, flagged.
        input.innerHTML = '';
        var keep = makeOption(value, value + '  (not a vanilla value)');
        keep.selected = true;
        input.appendChild(keep);
        opts.forEach(function (o) { input.appendChild(makeOption(o, o)); });
        return input;
      }
      opts.forEach(function (o) {
        var opt = makeOption(o, o);
        if (o === value) opt.selected = true;
        input.appendChild(opt);
      });
      return input;
    }

    if (kind === 'boolean') {
      input = document.createElement('select');
      var blank = makeOption('', '—');
      if (!value) blank.selected = true;
      input.appendChild(blank);
      P.YES_NO.forEach(function (o) {
        var opt = makeOption(o, o);
        if (o === value) opt.selected = true;
        input.appendChild(opt);
      });
      if (value && P.YES_NO.indexOf(value) === -1) {
        var odd = makeOption(value, value);
        odd.selected = true;
        input.appendChild(odd);
      }
      return input;
    }

    if (kind === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = value;
      return input;
    }

    if (kind === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 2;
      input.value = value;
      return input;
    }

    input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    if (kind === 'list') input.placeholder = 'comma, separated, values';
    return input;
  }

  function makeOption(value, text) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  }

  /* Tags a row as changed vs its donor and appends the vanilla value inline.
   * This is the whole point of the tool, so it lives in one function used by
   * both initial render and partial refresh. */
  function decorateField(row, name, value) {
    var has = state.donor &&
      Object.prototype.hasOwnProperty.call(state.donor, name);
    var dv = has ? String(state.donor[name] == null ? '' : state.donor[name]).trim() : '';
    row.classList.toggle('changed', !!(has && value.trim() !== dv));
    row.classList.toggle('extra', !!(state.donor && !has));

    var hint = row.querySelector('.donor-hint');
    if (has && value.trim() !== dv) {
      if (!hint) { hint = el('span', 'donor-hint'); row.appendChild(hint); }
      hint.textContent = dv === '' ? '(vanilla empty)' : 'vanilla: ' + dv;
    } else if (hint) {
      hint.remove();
    }
  }

  function onEdit(name, value) {
    var f = state.files[state.current];
    P.setValue(f.model, name, value);
    if (!f.dirty) { f.dirty = true; }

    if (name === 'Asset Path') syncDonor();
    if (name === 'ID') { rebuildIdIndex(); renderFileList(); }
    recompute();

    // Refresh only what the edit can affect, so typing stays smooth.
    renderCard();
    renderDiff();
    renderIssues();
    renderSource();
    refreshFormDecorations();
    markDirtyRow();
  }

  function refreshFormDecorations() {
    var rows = document.querySelectorAll('.field');
    Array.prototype.forEach.call(rows, function (row) {
      var input = row.querySelector('.field-input');
      if (!input) return;
      decorateField(row, input.dataset.field, String(input.value == null ? '' : input.value));
    });
    // Group badges depend on counts, so refresh the headers too.
    var heads = document.querySelectorAll('.group');
    Array.prototype.forEach.call(heads, function (box) {
      var title = box.querySelector('.group-title');
      var badge = box.querySelector('.group-badge');
      var body = box.querySelector('.group-body');
      if (!title || !body || !state.donor) return;
      var n = 0;
      Array.prototype.forEach.call(body.querySelectorAll('.field'), function (r) {
        if (r.classList.contains('changed')) n++;
      });
      if (n && !badge) {
        badge = el('span', 'group-badge', n + ' changed');
        var count = box.querySelector('.group-count');
        box.querySelector('.group-head').insertBefore(badge, count);
      } else if (n && badge) {
        badge.textContent = n + ' changed';
      } else if (!n && badge) {
        badge.remove();
      }
    });
  }

  function markDirtyRow() {
    var f = state.files[state.current];
    if (f.dirty) {
      var rows = document.querySelectorAll('.file-row');
      var row = rows[state.current];
      if (row) row.classList.add('dirty');
    }
  }

  /* Programmatic set, used by revert buttons: keeps the input in sync so the
   * DOM never shows a stale value. */
  function setField(name, value) {
    onEdit(name, value);
    var inputs = document.querySelectorAll('.field-input');
    Array.prototype.forEach.call(inputs, function (inp) {
      if (inp.dataset.field === name) {
        inp.value = value;
        if (inp.tagName === 'SELECT' && inp.value !== value) {
          // Value not in the option list: add it so the UI is truthful.
          inp.appendChild(makeOption(value, value));
          inp.value = value;
        }
      }
    });
    refreshFormDecorations();
  }

  /* ------------------------------------------------------------------ card */

  function renderCard() {
    var m = state.files[state.current].model;
    var f = m.map;
    var asset = String(f['Asset Path'] || '').trim() || m.prefabLine;
    var icon = P.resolveIcon(asset, state.icons);
    var url = P.iconUrl(icon, state.icons);

    var card = $('#card');
    card.innerHTML = '';

    var fig = el('div', 'card-figure');
    if (url) {
      var img = document.createElement('img');
      img.alt = icon.name;
      img.src = url;
      img.onerror = function () {
        // The manifest and the folder can drift after a partial re-export.
        fig.innerHTML = '';
        fig.appendChild(blankCard('image file missing — re-run export_icons.py'));
      };
      fig.appendChild(img);
    } else {
      fig.appendChild(blankCard(icon.kind === 'no-asset'
        ? 'no Asset Path' : 'no _MINI sprite'));
    }
    card.appendChild(fig);

    var meta = el('div', 'card-meta');
    meta.appendChild(el('div', 'card-manu', f['Manufacturer'] || 'no manufacturer'));
    meta.appendChild(el('div', 'card-name', f['Part Name'] || 'unnamed case'));

    var row2 = el('div', 'card-row');
    var price = P.num(f['Price']);
    row2.appendChild(el('span', 'card-price', price ? '$' + price.toFixed(0) : '$—'));
    row2.appendChild(el('span', 'card-level', 'Lv ' + (String(f['Level'] || '').trim() || '1')));
    meta.appendChild(row2);

    var badges = el('div', 'card-badges');
    [f['Case Size'], f['PSU size'] ? 'PSU ' + f['PSU size'] : '',
     String(f['Curved Glass'] || '').toLowerCase() === 'yes' ? 'curved glass' : '',
     String(f['Is Open Bench'] || '').toLowerCase() === 'yes' ? 'open bench' : '']
      .forEach(function (b) { if (b) badges.appendChild(el('span', 'badge', b)); });
    if (badges.childNodes.length) meta.appendChild(badges);

    card.appendChild(meta);

    var hint = el('div', 'card-hint');
    hint.innerHTML = icon.kind === 'mini'
      ? 'sprite <code>' + esc(icon.name) + '</code>'
      : icon.kind === 'missing'
        ? 'looked for <code>' + esc(P.lastSeg(asset)) + '_MINI</code>'
        : 'no asset path to resolve';
    card.appendChild(hint);

    $('#cardCaption').textContent = icon.kind === 'mini'
      ? 'what the shop will draw'
      : 'the shop will draw a blank white card';
    $('#cardCaption').className = 'card-caption' + (icon.kind === 'mini' ? '' : ' bad');
  }

  function blankCard(reason) {
    var b = el('div', 'blank-card');
    b.appendChild(el('div', 'blank-mark', '?'));
    b.appendChild(el('div', 'blank-reason', reason));
    return b;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ------------------------------------------------------------------ diff */

  function renderDiff() {
    var host = $('#diff');
    host.innerHTML = '';

    if (!state.donor) {
      host.appendChild(el('p', 'muted',
        'No vanilla case uses this Asset Path, so there is nothing to compare against.'));
      $('#donorName').textContent = '—';
      return;
    }

    var d = state.diff;
    $('#donorName').textContent =
      String(state.donor['Part Name'] || '?') + ' · ' + String(state.donor['ID'] || '?');

    /* Not every mismatch is a bug. Identity fields are supposed to differ, and
     * a derived field follows the fields it is built from. Counting them as
     * "forgot to change this" would double-count and cry wolf, so the tabs
     * separate them. */
    var identity = d.changed.filter(function (c) { return isReadonly(c.name); });
    var derived = d.changed.filter(function (c) { return isDerived(c.name); });
    var content = d.changed.filter(function (c) {
      return !isReadonly(c.name) && !isDerived(c.name);
    });

    var tabs = el('div', 'diff-tabs');
    [['changed', 'content', content.length],
     ['missing', 'missing', d.missing.length],
     ['identity', 'identity', identity.length],
     ['same', 'same', d.same.length],
     ['added', 'mod only', d.added.length]].forEach(function (t) {
      var b = el('button', 'diff-tab' + (state.scope === t[0] ? ' on' : ''));
      b.type = 'button';
      b.appendChild(el('span', null, t[1]));
      b.appendChild(el('span', 'diff-num', String(t[2])));
      b.addEventListener('click', function () {
        state.scope = t[0];
        renderDiff();
      });
      tabs.appendChild(b);
    });
    host.appendChild(tabs);

    var list = el('div', 'diff-list');

    if (state.scope === 'changed') {
      if (!content.length) list.appendChild(el('p', 'good', 'Every content field matches the donor.'));
      content.forEach(function (c) { list.appendChild(changedRow(c, true)); });
    } else if (state.scope === 'identity') {
      if (!identity.length) {
        list.appendChild(el('p', 'warn-note',
          'This file still carries the donor\'s ID and name. That is fine while ' +
          'drafting, but two parts with the same ID will overwrite each other.'));
      }
      identity.forEach(function (c) { list.appendChild(changedRow(c, false)); });
      if (derived.length) {
        list.appendChild(el('p', 'muted',
          'Derived fields (not counted): ' +
          derived.map(function (c) { return c.name; }).join(', ')));
      }
    } else if (state.scope === 'missing') {
      if (!d.missing.length) list.appendChild(el('p', 'good', 'No vanilla fields are missing.'));
      d.missing.forEach(function (c) {
        var row = el('div', 'diff-row missing');
        row.appendChild(el('span', 'diff-field', c.name));
        var vals = el('span', 'diff-vals');
        vals.appendChild(el('span', 'diff-was', 'vanilla: ' + (c.donor || '(empty)')));
        row.appendChild(vals);
        if (c.donor !== '' && !isReadonly(c.name)) {
          var add = el('button', 'diff-revert', 'add');
          add.type = 'button';
          add.title = 'Append ' + c.name + ' with the vanilla value';
          add.addEventListener('click', function () { setField(c.name, c.donor); });
          row.appendChild(add);
        }
        list.appendChild(row);
      });
    } else if (state.scope === 'added') {
      if (!d.added.length) list.appendChild(el('p', 'muted', 'Nothing extra.'));
      d.added.forEach(function (c) {
        var row = el('div', 'diff-row added');
        row.appendChild(el('span', 'diff-field', c.name));
        row.appendChild(el('span', 'diff-now', c.value || '(empty)'));
        list.appendChild(row);
      });
    } else {
      if (!d.same.length) list.appendChild(el('p', 'muted', 'Nothing identical.'));
      d.same.forEach(function (c) {
        var row = el('div', 'diff-row same');
        row.appendChild(el('span', 'diff-field', c.name));
        row.appendChild(el('span', 'diff-was no-strike', c.value || '(empty)'));
        list.appendChild(row);
      });
    }

    host.appendChild(list);
  }

  function changedRow(c, allowRevert) {
    var row = el('div', 'diff-row');
    row.appendChild(el('span', 'diff-field', c.name));
    var vals = el('span', 'diff-vals');
    vals.appendChild(el('span', 'diff-was', c.donor === '' ? '(empty)' : c.donor));
    vals.appendChild(el('span', 'diff-arrow', '→'));
    vals.appendChild(el('span', 'diff-now', c.mine === '' ? '(empty)' : c.mine));
    row.appendChild(vals);
    if (allowRevert && c.donor !== '') {
      var rev = el('button', 'diff-revert', 'revert');
      rev.type = 'button';
      rev.title = 'Set ' + c.name + ' back to "' + c.donor + '"';
      rev.addEventListener('click', function () { setField(c.name, c.donor); });
      row.appendChild(rev);
    }
    return row;
  }

  /* Fields that describe this file's identity rather than the borrowed prefab.
   * Reverting them to the donor's value would duplicate a vanilla part, so no
   * revert button is offered. */
  function isReadonly(name) {
    return P.IDENTITY_FIELDS.indexOf(name) !== -1;
  }

  function isDerived(name) {
    return P.DERIVED_FIELDS.indexOf(name) !== -1;
  }

  /* ---------------------------------------------------------------- issues */

  function renderIssues() {
    var host = $('#issues');
    host.innerHTML = '';

    var errs = state.issues.filter(function (i) { return i.level === 'error'; });
    var warns = state.issues.filter(function (i) { return i.level === 'warn'; });
    var infos = state.issues.filter(function (i) { return i.level === 'info'; });

    var head = el('div', 'issues-head');
    head.appendChild(el('span', 'pill err' + (errs.length ? '' : ' zero'), errs.length + ' error'));
    head.appendChild(el('span', 'pill warn' + (warns.length ? '' : ' zero'), warns.length + ' warn'));
    head.appendChild(el('span', 'pill info' + (infos.length ? '' : ' zero'), infos.length + ' note'));
    host.appendChild(head);

    if (!state.issues.length) {
      host.appendChild(el('p', 'good', 'No problems found.'));
      return;
    }

    state.issues.forEach(function (i) {
      var row = el('div', 'issue ' + i.level);
      row.appendChild(el('span', 'issue-code', i.code));
      row.appendChild(el('span', 'issue-msg', i.msg));
      host.appendChild(row);
    });
  }

  /* ---------------------------------------------------------------- source */

  function renderSource() {
    var text = P.buildModXml(state.files[state.current].model);
    $('#source').value = text;
    $('#sourceStats').textContent =
      state.files[state.current].model.fields.length + ' fields · ' + text.length + ' chars';
  }

  /* ------------------------------------------------------------------ save */

  function download() {
    var f = state.files[state.current];
    var text = P.buildModXml(f.model);
    var name = f.name.replace(/\.xml$/i, '') + '.xml';
    var blob = new Blob([text], { type: 'application/xml;charset=utf-8' });
    saveBlob(blob, name);
    f.dirty = false;
    renderFileList();
    setStatus('saved ' + name);
  }

  function saveAll() {
    var n = 0;
    state.files.forEach(function (f) {
      if (!f.dirty) return;
      var text = P.buildModXml(f.model);
      saveBlob(new Blob([text], { type: 'application/xml;charset=utf-8' }),
        f.name.replace(/\.xml$/i, '') + '.xml');
      f.dirty = false;
      n++;
    });
    renderFileList();
    setStatus(n ? 'saved ' + n + ' file' + (n === 1 ? '' : 's') : 'nothing to save');
  }

  /* Several downloads fired in a row get throttled by Chrome; stagger them. */
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 4000);
  }

  function copySource() {
    var ta = $('#source');
    var text = ta.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus('XML copied');
      }, function () { fallbackCopy(ta); });
    } else {
      fallbackCopy(ta);
    }
  }

  function fallbackCopy(ta) {
    ta.select();
    try { document.execCommand('copy'); setStatus('XML copied'); }
    catch (e) { setStatus('copy failed — select the text and press Ctrl+C', true); }
  }

  /* -------------------------------------------------------------- new case */

  function newCase() {
    // Start from a real vanilla case so all 77 fields exist and are sane.
    var base = state.vanilla.cases.filter(function (c) {
      return String(c['Part Name']).indexOf('4000D') !== -1 &&
        String(c['Asset Path'] || '').trim();
    })[0] || state.vanilla.cases.filter(function (c) {
      return String(c['Asset Path'] || '').trim();
    })[0];

    // Skip IDs already taken by vanilla or by a loaded file.
    var n = 30100;
    var taken = function (id) {
      if (state.idIndex[id]) return true;
      return state.vanilla.cases.some(function (c) { return c['ID'] === id; });
    };
    while (taken('Case_Custom_' + n)) n++;

    var model = P.modelFromVanilla(base, state.vanilla.field_order, 'Case_Custom_' + n);
    var f = {
      name: 'CASE_New Case.xml',
      text: P.buildModXml(model),
      model: model,
      dirty: true
    };
    state.files.unshift(f);
    rebuildIdIndex();
    renderFileList();
    openFile(0);
    setStatus('new case from ' + (base['Part Name'] || 'a vanilla row') + ' · ID Case_Custom_' + n);
  }

  /* ---------------------------------------------------------------- wiring */

  /* Keyboard: j/k walk the file list, Ctrl+S saves, 1-5 switch diff tabs.
   * Arrow keys are left alone while a field has focus, because up/down there
   * means "adjust the number". */
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (state.current >= 0) download();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        if (state.current + 1 < state.files.length) {
          e.preventDefault();
          openFile(state.current + 1);
        }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        if (state.current > 0) {
          e.preventDefault();
          openFile(state.current - 1);
        }
      } else if (e.key >= '1' && e.key <= '5') {
        var tabs = ['changed', 'missing', 'identity', 'same', 'added'];
        var pick = tabs[Number(e.key) - 1];
        if (pick) { state.scope = pick; renderDiff(); }
      }
    });
  }

  function wireDropZone(node) {
    ['dragenter', 'dragover'].forEach(function (ev) {
      node.addEventListener(ev, function (e) {
        e.preventDefault();
        node.classList.add('dragging');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      node.addEventListener(ev, function (e) {
        e.preventDefault();
        node.classList.remove('dragging');
      });
    });
    node.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) readFiles(e.dataTransfer.files);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('#fileInput').addEventListener('change', function (e) { readFiles(e.target.files); });
    $('#folderInput').addEventListener('change', function (e) { readFiles(e.target.files); });
    $('#pickFiles').addEventListener('click', function () { $('#fileInput').click(); });
    $('#pickFolder').addEventListener('click', function () { $('#folderInput').click(); });
    $('#newBtn').addEventListener('click', newCase);
    $('#saveBtn').addEventListener('click', download);
    $('#saveAllBtn').addEventListener('click', saveAll);
    $('#copyBtn').addEventListener('click', copySource);
    $('#closeBtn').addEventListener('click', function () {
      state.files = [];
      state.current = -1;
      state.donor = null;
      state.issues = [];
      state.diff = null;
      rebuildIdIndex();
      renderFileList();
      $('#editor').hidden = true;
      $('#landing').hidden = false;
      $('#closeBtn').hidden = true;
      $('#saveBtn').disabled = true;
      $('#saveAllBtn').disabled = true;
      setStatus('closed');
    });

    wireDropZone($('#landing'));
    wireDropZone($('#editor'));
    bindKeys();

    window.addEventListener('beforeunload', function (e) {
      var dirty = state.files.filter(function (f) { return f.dirty; }).length;
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
      return undefined;
    });

    boot();
  });
})();