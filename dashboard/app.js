// Token Radar dashboard: renders window.RADAR_DATA (written by main.ts
// from the same board as board.json), with search, category/chain filters,
// a watchlist toggle, sorting, and a detail view for every protocol.
(function () {
  var D = window.RADAR_DATA;
  if (!D) { document.getElementById('detail').textContent = 'No data loaded.'; return; }
  var rows = D.rows, meta = D.meta;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    return '$' + Math.round(n / 1e3) + 'K';
  };
  var pct = function (v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  };
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  $('meta').innerHTML = '<b>' + rows.length + ' protocols</b> ranked<br>Snapshot ' + esc(meta.as_of) +
    ' · floor ' + fmt(meta.floor_usd) + '<br>' + meta.watchlist_rows + ' watchlist · ' +
    meta.live_token_protocols_set_aside + ' live-token protocols set aside';
  $('model').innerHTML = '<b>Value model.</b> ' + esc(meta.model);

  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  cats.forEach(function (c) { $('cat').appendChild(new Option(c, c)); });
  chains.forEach(function (c) { $('chain').appendChild(new Option(c, c)); });

  var selected = null;
  function filtered() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value, ch = $('chain').value, wl = $('watch').checked;
    var list = rows.filter(function (r) {
      if (wl && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (ch && r.chains.indexOf(ch) < 0) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var s = $('sort').value;
    list.sort(function (a, b) {
      if (s === 'value') return b.implied_value_usd - a.implied_value_usd;
      if (s === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (s === 'change') return (b.change_7d || 0) - (a.change_7d || 0);
      return a.rank - b.rank;
    });
    return list;
  }
  function render() {
    var list = filtered();
    $('rows').innerHTML = list.map(function (r) {
      var cls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      return '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="sel"' : '') + '>' +
        '<td>' + r.rank + '</td><td><b>' + esc(r.name) + '</b><br><span class="k">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + fmt(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num"><b>' + fmt(r.implied_value_usd) + '</b></td>' +
        '<td>' + (r.watchlist ? '<span class="tag">watchlist</span>' : '') + '</td></tr>';
    }).join('');
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols shown. Click a row for its detail and farm plan.';
    document.querySelectorAll('#rows tr').forEach(function (tr) {
      tr.addEventListener('click', function () { show(tr.getAttribute('data-slug')); });
    });
  }
  function bar(label, v, max) {
    return '<div><span>' + label + '</span><i><b style="width:' + Math.round(100 * v / max) + '%"></b></i><span>' + v.toFixed(2) + '</span></div>';
  }
  function show(slug) {
    selected = slug;
    var r = rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    var b = r.breakdown;
    $('detail').innerHTML =
      '<h2>' + esc(r.name) + '</h2><p class="k">Rank #' + r.rank + ' · ' + esc(r.slug) + ' · records no token' +
      (r.watchlist ? ' · <span class="tag">watchlist</span>' : '') + '</p>' +
      '<dl><dt>Implied value</dt><dd><b>' + fmt(r.implied_value_usd) + '</b></dd>' +
      '<dt>TVL</dt><dd>' + fmt(r.tvl_usd) + '</dd>' +
      '<dt>7d change</dt><dd>' + pct(r.change_7d) + '</dd>' +
      '<dt>Category</dt><dd>' + esc(r.category || '—') + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(r.chains.join(', ')) + '</dd>' +
      '<dt>Listed</dt><dd>' + esc(r.listed_at || 'unknown') + ' (' + b.age_days + ' days)</dd></dl>' +
      '<h3>Model breakdown</h3><div class="bars">' +
      bar('size', b.size_factor, 100) + bar('growth', b.growth_factor, 1.6) +
      bar('maturity', b.maturity_factor, 1.25) + bar('reach', b.reach_factor, 1.2) + '</div>' +
      '<h3>Farm plan</h3><ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    render();
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  ['q', 'cat', 'chain', 'sort', 'watch'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  render();
  if (rows.length) show(rows[0].slug);
})();
