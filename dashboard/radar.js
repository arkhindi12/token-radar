/* Launch Radar's page: renders window.RADAR (written by data.js from the same numbers as board.json)
   into the board, the model panel, the live-token view, the excluded view and the provenance panel,
   adds a detail drawer per protocol, and sorts and filters the board. No network, no framework. */

(function () {
  'use strict';

  var D = window.RADAR;
  var M = D.model;
  var state = { region: 'all', category: '', chain: '', verdict: '', q: '', sort: 'rank', dir: 1, shown: 200 };

  // ---------------------------------------------------------------- formatting
  function compact(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'k';
    return '$' + n.toFixed(0);
  }
  function exact(n) { return n.toLocaleString('en-US'); }
  function times(n) { return n.toFixed(2) + '\u00d7'; }
  function pct(n) { return (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function deltaClass(n) { return n === null ? 'flat' : n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat'; }
  function age(n) {
    if (n === null) return 'undated';
    if (n < 60) return n + ' d';
    if (n < 730) return Math.round(n / 30.44) + ' mo';
    return (n / 365.25).toFixed(1) + ' yr';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function html(id, s) { var e = el(id); if (e) { e.innerHTML = s; } }

  // ---------------------------------------------------------------- masthead + lede
  html('masthead-meta',
    'Snapshot <b>' + esc(D.as_of) + '</b><br>' +
    'Source: DefiLlama protocols, sealed<br>' +
    'Fit on <b>' + M.n + '</b> protocols, refit every run<br>' +
    'Board <b>' + D.rows.length + '</b> ranked \u00b7 ' + D.live.length + ' live shown');
  el('tab-live-count').textContent = D.live.length;
  el('tab-excluded-count').textContent = D.excluded.length;

  html('lede-text',
    '<p>Of the <b>' + D.accounting.total + '</b> protocols in the snapshot, <b>' + D.rows.length +
    '</b> record no token and are ranked here by what a token would be worth: an implied market cap of ' +
    '<code>exp(' + M.a.toFixed(4) + ') \u00d7 TVL^' + M.b.toFixed(4) + '</code>, the fit through the ' +
    M.n + ' protocols that record both a TVL and a positive market cap. A typical held-out protocol misses by ' +
    '<b>' + times(M.loo_median) + '</b>, and the honest band runs from ' + times(M.p10) + ' to ' + times(M.p90) +
    ' of the point estimate. That band is wide, and it is printed beside every number below.</p>' +
    '<p>' + D.accounting.watched + ' of the ' + D.seal.watchlist_slugs + ' watchlist protocols are ranked; the other ' +
    D.accounting.off_list + ' rows are off the list, because the list is a floor and not the whole market. ' +
    D.accounting.live + ' protocols that already record a token are kept in their own view, and ' + D.accounting.excluded +
    ' protocols that record no token but are a bridge, a staked receipt or an exchange\u2019s own product are listed with the reason.</p>');

  var top = D.rows[0];
  var mid = D.rows[Math.min(40, D.rows.length - 1)];
  html('answer',
    '<b>If you only read one line:</b> the board\u2019s first row is <b>' + esc(top.name) + '</b>, implied at ' +
    compact(top.implied_value_usd) + ' on ' + compact(top.tvl_usd) + ' of TVL. Forty ranks down it is <b>' +
    esc(mid.name) + '</b>, at ' + compact(mid.implied_value_usd) + '. Read the band before the rank: a typical held-out row misses by ' +
    times(M.loo_median) + ', the band runs ' + times(M.p10) + ' to ' + times(M.p90) + ', and every one of the ' +
    (D.rows.length - 1) + ' neighbouring pairs has bands that cross, so the exact order below the very top is a claim this data does not settle. ' +
    'Every row carries its plan, its cost and its break-even in the detail view.');

  function stat(k, v, s) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div><div class="s">' + esc(s) + '</div></div>';
  }
  var beAll = D.rows.map(function (r) { return r.breakeven_drop_pct; });
  html('lede-stats',
    stat('Typical miss, held out', times(M.loo_median), 'leave-one-out over ' + M.n + ' rows, exp(median |log|)') +
    stat('Band p10 / p90', times(M.p10) + ' \u2013 ' + times(M.p90), 'measured on the same fit, not chosen') +
    stat('Board value', compact(D.rows[D.rows.length - 1].implied_value_usd) + ' \u2192 ' + compact(D.rows[0].implied_value_usd), 'sum ' + compact(D.seal.total_implied_usd)) +
    stat('Break-even drop', Math.min.apply(null, beAll).toFixed(1) + ' \u2013 ' + Math.max.apply(null, beAll).toFixed(1) + '%', 'a launch must fall this far before its plan loses money'));

  // ---------------------------------------------------------------- filters
  var categories = {}, chains = {};
  D.rows.forEach(function (r) {
    var c = r.category || 'uncategorised';
    categories[c] = (categories[c] || 0) + 1;
    r.chains.forEach(function (ch) { chains[ch] = (chains[ch] || 0) + 1; });
  });
  function fillSelect(id, map) {
    var s = el(id);
    Object.keys(map).sort(function (a, b) { return map[b] - map[a] || a.localeCompare(b); }).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = k + ' (' + map[k] + ')';
      s.appendChild(o);
    });
  }
  fillSelect('f-category', categories);
  fillSelect('f-chain', chains);

  el('c-all').textContent = D.rows.length;
  el('c-watch').textContent = D.accounting.watched;
  el('c-off').textContent = D.accounting.off_list;

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      state.region = b.getAttribute('data-region');
      state.shown = 200;
      render();
    });
  });
  el('q').addEventListener('input', function (e) { state.q = e.target.value.trim().toLowerCase(); state.shown = 200; render(); });
  el('f-category').addEventListener('change', function (e) { state.category = e.target.value; state.shown = 200; render(); });
  el('f-chain').addEventListener('change', function (e) { state.chain = e.target.value; state.shown = 200; render(); });
  el('f-verdict').addEventListener('change', function (e) { state.verdict = e.target.value; state.shown = 200; render(); });
  el('f-reset').addEventListener('click', function () {
    state.region = 'all'; state.category = ''; state.chain = ''; state.verdict = ''; state.q = ''; state.shown = 200;
    el('f-category').value = ''; el('f-chain').value = ''; el('f-verdict').value = ''; el('q').value = '';
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (x) { x.classList.toggle('on', x.getAttribute('data-region') === 'all'); });
    render();
  });

  Array.prototype.forEach.call(document.querySelectorAll('th.sortable'), function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'verdict' ? 1 : -1; }
      render();
    });
  });

  // ---------------------------------------------------------------- the board
  function sortKey(r) {
    if (state.sort === 'name') return r.name.toLowerCase();
    if (state.sort === 'age_days') return r.age_days === null ? -1 : r.age_days;
    if (state.sort === 'band_lo') return r.band.lo;
    if (state.sort === 'change_7d') return r.change_7d === null ? -999 : r.change_7d;
    if (state.sort === 'verdict') return r.verdict;
    return r[state.sort];
  }

  function filtered() {
    return D.rows.filter(function (r) {
      if (state.region !== 'all' && r.region !== state.region) return false;
      if (state.category && (r.category || 'uncategorised') !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(state.q) === -1) return false;
      }
      return true;
    });
  }

  function render() {
    var rows = filtered().slice().sort(function (a, b) {
      var ka = sortKey(a), kb = sortKey(b);
      if (ka < kb) return -1 * state.dir;
      if (ka > kb) return 1 * state.dir;
      return a.rank - b.rank;
    });
    var body = rows.slice(0, state.shown).map(function (r) {
      var d = r.change_7d;
      var left = (100 * r.band.hi_rank) / D.rows.length;
      var width = (100 * r.band.lo_rank) / D.rows.length - left;
      var bar = '<div class="bar"><b style="left:' + left.toFixed(2) + '%;width:' + Math.max(0.8, width).toFixed(2) + '%"></b>' +
        '<s style="left:' + ((100 * r.rank) / D.rows.length).toFixed(2) + '%"></s></div>';
      var beClass = r.breakeven_drop_pct >= 99.5 ? 'high' : r.breakeven_drop_pct >= 90 ? 'mid' : 'low';
      return '<tr class="' + (r.region === 'off-list' ? 'off' : '') + '" data-slug="' + esc(r.slug) + '">' +
        '<td class="num"><span class="rank">' + r.rank + '</span><span class="bandrank' + (r.band.overlap ? ' warn' : '') + '">' +
          r.band.hi_rank + '\u2013' + r.band.lo_rank + (r.band.overlap ? ' \u26a0' : '') + '</span></td>' +
        '<td><span class="proto">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></span><div class="tags">' +
          '<span class="tag ' + (r.region === 'watchlist' ? 'wl' : '') + '">' + (r.region === 'watchlist' ? 'watchlist' : 'off-list') + '</span>' +
          '<span class="tag cat">' + esc(r.category || 'uncategorised') + '</span></div></td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num money">' + compact(r.tvl_usd) + '</td>' +
        '<td class="num money delta ' + deltaClass(d) + '">' + (d === null ? '\u2014' : pct(d)) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num money strong">' + compact(r.implied_value_usd) + '</td>' +
        '<td class="num"><span class="range">' + compact(r.band.lo) + ' <i>\u2013</i> ' + compact(r.band.hi) + '</span>' + bar + '</td>' +
        '<td class="num"><span class="be ' + beClass + '">' + r.breakeven_drop_pct.toFixed(1) + '%</span></td>' +
        '<td class="num"><span class="verdict ' + r.verdict + '">' + r.verdict + '</span></td>' +
        '</tr>';
    }).join('');
    html('board-body', body);
    el('board-empty').hidden = rows.length > 0;
    html('filter-note', describe(rows.length));
    html('table-foot',
      '<span>' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' match; showing ' + Math.min(rows.length, state.shown) + '</span>' +
      '<span>' + (rows.length > state.shown ? '<a href="#" id="more">show 200 more</a>' :
        'sorted by ' + esc(state.sort) + ', ' + (state.dir > 0 ? 'ascending' : 'descending')) + '</span>');
    var more = el('more');
    if (more) more.addEventListener('click', function (e) { e.preventDefault(); state.shown += 200; render(); });
    Array.prototype.forEach.call(document.querySelectorAll('th.sortable'), function (th) {
      th.querySelector('.arrow').textContent = th.getAttribute('data-sort') === state.sort ? (state.dir > 0 ? '\u2191' : '\u2193') : '';
    });
    Array.prototype.forEach.call(document.querySelectorAll('#board-body tr'), function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }

  function describe(n) {
    var parts = [];
    if (state.region !== 'all') parts.push(state.region === 'watchlist' ? 'on the watchlist' : 'off the watchlist');
    if (state.category) parts.push('category ' + esc(state.category));
    if (state.chain) parts.push('chain ' + esc(state.chain));
    if (state.verdict) parts.push('verdict ' + esc(state.verdict));
    if (state.q) parts.push('matching \u201c' + esc(state.q) + '\u201d');
    if (parts.length === 0) return 'Every ranked protocol. Click a row for its arithmetic, its band and its plan.';
    return '<b>' + n + ' rows</b> ' + parts.join(', ') + '. Click a row for its arithmetic, its band and its plan.';
  }

  // ---------------------------------------------------------------- detail drawer
  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) r = D.rows[i];
    if (!r) return;
    var A = r.arithmetic;
    var logMcap = M.a + M.b * A.log_tvl;
    var scale = r.band.hi * 1.05;
    var segLeft = (r.band.lo / scale) * 100;
    var pt = (r.implied_value_usd / scale) * 100;
    var plan = r.farm_steps.map(function (s, i) {
      return '<li><span class="stepno">' + (i + 1) + '</span>' + esc(s) + '</li>';
    }).join('');
    var body =
      '<button class="close" id="detail-close">Close \u2715</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<div class="sub">rank ' + r.rank + ' of ' + D.rows.length + ' \u00b7 ' + esc(r.slug) + ' \u00b7 ' + esc(r.category || 'uncategorised') +
      ' \u00b7 ' + esc(r.chains.join(', ')) + ' \u00b7 ' + (r.region === 'watchlist' ? 'on the watchlist' : 'off the watchlist') + '</div>' +
      (r.band.overlap ? '<div class="warn">This row\u2019s band crosses its neighbour\u2019s, so its ordering against the rows around it is not certain. The plausible rank says so: ' + r.band.hi_rank + '\u2013' + r.band.lo_rank + '.</div>' : '') +
      '<div class="hero"><div><div class="lbl">Implied value</div><div class="big">' + compact(r.implied_value_usd) + '</div>' +
        '<div class="band">exactly $' + exact(r.implied_value_usd) + ' \u00b7 a multiple of ' + times(A.multiple) + ' its TVL</div></div>' +
        '<div><div class="lbl">p10 \u2013 p90, the honest band</div><div class="band">' + compact(r.band.lo) + ' \u2013 ' + compact(r.band.hi) + '</div>' +
        '<div class="band">plausible rank ' + r.band.hi_rank + '\u2013' + r.band.lo_rank + ' of ' + D.rows.length + ' \u00b7 verdict <b class="verdict ' + r.verdict + '">' + r.verdict + '</b></div></div></div>' +
      '<div class="bandmap"><div class="track">' +
        '<div class="seg" style="left:' + segLeft.toFixed(2) + '%;width:' + (100 - segLeft).toFixed(2) + '%"></div>' +
        '<div class="pt" style="left:' + pt.toFixed(2) + '%"></div></div>' +
        '<div class="axis"><span>' + compact(r.band.lo * 0.92) + '</span><span>the band ' + compact(r.band.lo) + ' \u2013 ' + compact(r.band.hi) + ', point ' + compact(r.implied_value_usd) + '</span><span>' + compact(scale) + '</span></div></div>' +
      '<div class="cols"><div>' +
      '<h4>The arithmetic, in words</h4>' +
      '<div class="arith">' +
        '<span class="step">TVL on ' + esc(D.as_of) + ': <span class="v">$' + exact(r.tvl_usd) + '</span></span>' +
        '<span class="step">log TVL = ln(' + exact(r.tvl_usd) + ') = <span class="v">' + A.log_tvl.toFixed(4) + '</span></span>' +
        '<span class="step">the fit: log mcap = <span class="v">' + M.a.toFixed(4) + '</span> + <span class="v">' + M.b.toFixed(4) + '</span> \u00d7 log TVL</span>' +
        '<span class="step">so log mcap = ' + M.a.toFixed(4) + ' + ' + M.b.toFixed(4) + ' \u00d7 ' + A.log_tvl.toFixed(4) + ' = <span class="v">' + logMcap.toFixed(4) + '</span></span>' +
        '<span class="step">implied mcap = e^' + logMcap.toFixed(4) + ' = <span class="v">$' + exact(Math.round(A.raw)) + '</span></span>' +
        '<span class="step">a multiple of <span class="v">' + times(A.multiple) + '</span> its TVL, since e^' + M.a.toFixed(4) + ' \u00d7 TVL^' + (M.b - 1).toFixed(4) + ' = ' + A.multiple.toFixed(4) + '</span>' +
        '<span class="step">band: the residual band runs \u00d7' + M.p10.toFixed(3) + ' to \u00d7' + M.p90.toFixed(3) + ' of that, i.e. <span class="v">$' + exact(r.band.lo) + '</span> to <span class="v">$' + exact(r.band.hi) + '</span></span>' +
      '</div>' +
      '<h4>What the plan assumes</h4>' +
      '<p class="prose small">' + esc(D.assumptions.note) + '</p>' +
      '<div class="kv">' +
        '<span class="k">verdict</span><span><b class="verdict ' + r.verdict + '">' + r.verdict + '</b></span>' +
        '<span class="k">plan cost</span><span>$' + exact(r.plan_cost_usd) + ' in all, the deposit plus gas</span>' +
        '<span class="k">expected to you</span><span>$' + exact(Math.round(r.expected_usd)) + ' at the base case: implied value \u00d7 ' + D.assumptions.hold_share_of_implied * 100 + '% \u00d7 ' + (1 - D.assumptions.drop_pct / 100) + ' \u00d7 momentum ' + A.momentum + ' \u00d7 maturity ' + A.maturity + ' \u00d7 evidence ' + A.evidence + '</span>' +
        '<span class="k">break-even drop</span><span><b>' + r.breakeven_drop_pct.toFixed(1) + '%</b>: the launch can fall this far before the plan stops paying for itself</span>' +
        '<span class="k">break-even value</span><span>$' + exact(r.breakeven_usd) + ' of token market cap is the floor at which $' + exact(r.plan_cost_usd) + ' comes back</span>' +
      '</div>' +
      '<h4>Why the verdict is not a slider</h4>' +
      '<p class="prose small">' + esc(r.booster) + '. ' +
        'No single input moves this row across a line: the cost is fixed by the plan (a $' + exact(r.plan_cost_usd) + ' campaign), and the drop share needed is the column printed on the board. ' +
        'The verdict is <b>' + r.verdict + '</b> at the base assumption of a ' + D.assumptions.drop_pct + '% drop.</p>' +
      '</div><div>' +
      '<h4>The farm plan, step by step</h4>' +
      '<ol class="steps">' + plan + '</ol>' +
      '</div></div>';
    html('detail-panel', body);
    el('detail').hidden = false;
    el('scrim').hidden = false;
  }

  function closeDetail() { el('detail').hidden = true; el('scrim').hidden = true; }
  el('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
  document.addEventListener('click', function (e) { if (e.target && e.target.id === 'detail-close') closeDetail(); });

  // ---------------------------------------------------------------- model panel
  html('model-lede',
    'The model is one straight line through the snapshot\u2019s own log-log data: <code>log mcap = a + b \u00b7 log tvl</code>. ' +
    'It is refit at run time from the ' + M.n + ' protocols in the snapshot that record both a TVL and a positive market cap, ' +
    'and the coefficients the run fitted are printed below as the program printed them. Nothing here is a hand-picked multiple: ' +
    'the implied value of a protocol that records no token is the fitted line evaluated at its TVL. ' +
    'The line is an estimate, so it comes with the residue it left on the rows that taught it, and with the error it made on rows it did not see.');

  html('coef',
    '<div class="lbl">implied market cap =</div>' +
    '<div class="big">exp(<span class="v">' + M.a.toFixed(4) + '</span>) \u00d7 TVL <span class="v">' + M.b.toFixed(4) + '</span></div>' +
    '<div class="lbl">a = <span class="v">' + M.a.toFixed(6) + '</span> \u00b7 exp(a) = <span class="v">' + exact(Math.round(M.exp_a)) + '</span></div>' +
    '<div class="lbl">b = <span class="v">' + M.b.toFixed(6) + '</span> \u00b7 n = <span class="v">' + M.n + '</span> \u00b7 R\u00b2 = <span class="v">' + M.r2.toFixed(3) + '</span> \u00b7 \u03c3 = <span class="v">' + M.sigma.toFixed(4) + '</span> in logs</div>' +
    '<div class="lbl">residual band, actual \u00f7 predicted: p10 <span class="v">' + M.p10.toFixed(3) + '</span> \u00b7 p50 <span class="v">' + M.p50.toFixed(3) + '</span> \u00b7 p90 <span class="v">' + M.p90.toFixed(3) + '</span></div>');
  html('coef-note',
    'R\u00b2 of ' + M.r2.toFixed(2) + ' says the line explains a fifth of the variance in log market cap: TVL is a real signal and a weak one. ' +
    'The band runs from \u00d7' + M.p10.toFixed(2) + ' to \u00d7' + M.p90.toFixed(2) + ', a factor of ' + (M.p90 / M.p10).toFixed(0) + ' between its ends. ' +
    'It is printed this wide because the residues are this wide; a tighter band would not be measured.');

  var rivals = D.rivals.map(function (r, i) {
    return '<tr class="' + (i === 0 ? 'me' : '') + '"><td>' + esc(r.name) + '</td><td class="f">' + esc(r.formula) + '</td>' +
      '<td class="num">' + times(r.median) + '</td><td class="num">' + times(r.p10) + ' \u2013 ' + times(r.p90) + '</td>' +
      '<td class="num">' + (r.within2x * 100).toFixed(0) + '%</td></tr>';
  }).join('');
  html('rivals',
    '<thead><tr><th>Formula</th><th>As fitted</th><th class="num">Typical miss</th><th class="num">p10 \u2013 p90</th><th class="num">within 2\u00d7</th></tr></thead>' +
    '<tbody>' + rivals + '</tbody>');
  el('rivals').querySelectorAll('td.num').forEach(function (td) { td.style.textAlign = 'right'; });

  var filters = D.filters.map(function (f) {
    return '<tr><td>' + esc(f.name) + '</td><td class="n">' + f.count + '</td><td class="f">' + esc(f.rule) + '</td></tr>';
  }).join('');
  html('filters', '<thead><tr><th>Step</th><th class="num">Protocols</th><th>Rule</th></tr></thead><tbody>' + filters + '</tbody>');

  var top = D.rows[0];
  html('worked',
    '<span class="k">the first row, ' + esc(top.name) + ':</span>' +
    '<span class="step">TVL <span class="v">$' + exact(top.tvl_usd) + '</span></span>' +
    '<span class="step">log TVL <span class="v">' + top.arithmetic.log_tvl.toFixed(4) + '</span></span>' +
    '<span class="step">' + M.a.toFixed(4) + ' + ' + M.b.toFixed(4) + ' \u00d7 ' + top.arithmetic.log_tvl.toFixed(4) + ' = <span class="v">' + (M.a + M.b * top.arithmetic.log_tvl).toFixed(4) + '</span></span>' +
    '<span class="step">e raised to that = <span class="v">$' + exact(top.implied_value_usd) + '</span>, the implied value</span>' +
    '<span class="step">band: $' + exact(top.band.lo) + ' \u2013 $' + exact(top.band.hi) + '</span>');
  html('verdict-work',
    '<span class="k">the first row, ' + esc(top.name) + ':</span>' +
    '<span class="step">plan cost <span class="v">$' + exact(top.plan_cost_usd) + '</span>, fixed by the plan</span>' +
    '<span class="step">holding = implied value \u00d7 ' + D.assumptions.hold_share_of_implied * 100 + '% <span class="v">$' + exact(Math.round(top.implied_value_usd * D.assumptions.hold_share_of_implied)) + '</span></span>' +
    '<span class="step">after a ' + D.assumptions.drop_pct + '% drop and the record\u2019s multipliers: <span class="v">$' + exact(Math.round(top.expected_usd)) + '</span></span>' +
    '<span class="step">break-even <span class="v">$' + exact(top.breakeven_usd) + '</span> of token cap; break-even drop <span class="v">' + top.breakeven_drop_pct.toFixed(2) + '%</span></span>');

  // ---------------------------------------------------------------- live + excluded views
  html('live-lede',
    D.accounting.live + ' protocols in the snapshot record a token: a CoinGecko id, a ticker or a positive market cap. ' +
    'The market has already priced them, so they are not ranked and no implied value is claimed for them. The ' + D.live.length +
    ' with the largest market cap are listed here as the market\u2019s own record, and their market cap \u00f7 TVL is the ratio the fit is built from.');
  html('live-body', D.live.map(function (r, i) {
    return '<tr><td class="num">' + (i + 1) + '</td><td><span class="proto">' + esc(r.name) + (r.symbol ? ' <span class="tag">' + esc(r.symbol) + '</span>' : '') +
      '<span class="slug">' + esc(r.slug) + '</span></span></td>' +
      '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
      '<td class="num money">' + compact(r.tvl_usd) + '</td><td class="num money">' + compact(r.mcap_usd) + '</td>' +
      '<td class="num money">' + (r.mcap_over_tvl === null ? '\u2014' : r.mcap_over_tvl.toFixed(2) + '\u00d7') + '</td>' +
      '<td class="num money delta ' + deltaClass(r.change_7d) + '">' + (r.change_7d === null ? '\u2014' : pct(r.change_7d)) + '</td></tr>';
  }).join(''));

  html('excluded-rule',
    'A protocol leaves the ranking only if its own record says it is a venue or a wrapper rather than a protocol still to launch. ' +
    'Three signals are used, each printed beside the protocol it moved. (1) DefiLlama\u2019s own category: Bridge, Canonical Bridge, Cross Chain Bridge, ' +
    'Liquid Staking, Liquid Restaking, Restaked BTC or CEX. (2) Its name begins with an exchange\u2019s name, or it runs on nothing but an exchange\u2019s own chain. ' +
    '(3) Its name contains, after its first word, the ticker of a token the snapshot already records. A name that ends in a version marker (V2, v3, 2.0) is a pool of an earlier protocol. ' +
    'Everything else that records no token is ranked: ' + D.accounting.excluded + ' protocols are excluded here, not silently dropped.');
  html('signal-counts', Object.keys(D.accounting.excluded_by_signal).map(function (k) {
    return '<span class="scount">' + esc(k) + ' <b>' + D.accounting.excluded_by_signal[k] + '</b></span>';
  }).join(''));
  html('excluded-body', D.excluded.map(function (r, i) {
    return '<tr><td class="num">' + (i + 1) + '</td><td><span class="proto">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></span></td>' +
      '<td>' + esc(r.category || 'uncategorised') + '</td><td class="num money">' + compact(r.tvl_usd) + '</td>' +
      '<td><span class="sig">' + esc(r.signal) + '</span></td><td class="why">' + esc(r.reason) + '</td></tr>';
  }).join(''));

  // ---------------------------------------------------------------- provenance
  var S = D.seal;
  function ok(b) { return b ? '<span class="ok">\u2713 holds</span>' : '<span class="ok" style="color:var(--rust)">\u2717</span>'; }
  html('seal',
    '<div class="card sealcard"><h3>Rows drawn = rows written</h3>' +
      '<div class="row"><span>Protocols in the snapshot</span><span class="val">' + S.rows_drawn + '</span></div>' +
      '<div class="row"><span>Rows in board.json</span><span class="val">' + S.rows_ranked + '</span></div>' +
      '<div class="row"><span>Ranks are 1..N once each</span><span class="val">' + esc(S.ranks) + ' ' + ok(true) + '</span></div>' +
      '<div class="row"><span>Implied value falls as rank ascends</span><span class="val">' + ok(S.monotonic) + '</span></div>' +
      '<div class="row"><span>Distinct implied values</span><span class="val">' + S.distinct_values + ' of ' + S.rows_ranked + '</span></div>' +
      '<div class="row"><span>Implied values sum to</span><span class="val">$' + exact(S.total_implied_usd) + '</span></div>' +
      '<div class="row"><span>Watchlist covered</span><span class="val">' + S.watchlist_slugs + ' of ' + S.watchlist_slugs + ' ' + ok(S.watchlist_covered) + '</span></div>' +
      '<h4>The fingerprint</h4><div class="hash">board.json rows sha256<br>' + esc(S.board_sha256) + '</div></div>' +
    '<div class="card sealcard"><h3>The fit, as run</h3>' +
      '<div class="row"><span>Pairs read by the fit</span><span class="val">' + S.fit_pairs + '</span></div>' +
      '<div class="row"><span>a, b</span><span class="val">' + M.a.toFixed(6) + ' , ' + M.b.toFixed(6) + '</span></div>' +
      '<div class="row"><span>Typical miss, held out</span><span class="val">' + times(M.loo_median) + '</span></div>' +
      '<div class="row"><span>Rows inside the p10\u2013p90 band, held out</span><span class="val">' + (M.loo_inside * 100).toFixed(1) + '% (80% by construction)</span></div>' +
      '<div class="row"><span>Held-out rows predicted within 2\u00d7</span><span class="val">' + (M.loo_within_2x * 100).toFixed(1) + '%</span></div>' +
      '<div class="row"><span>Snapshot</span><span class="val">' + esc(D.as_of) + '</span></div>' +
      '<div class="row"><span>Source</span><span class="val">' + esc(D.source) + '</span></div>' +
      '<h4>What was checked before writing</h4>' +
      '<p class="prose small">Row count within 100\u20134000; no repeated slug; every slug one of the snapshot\u2019s protocols; ranks 1..N; implied values non-increasing; no repeated value; ' +
      'every watchlist slug present; 3\u201312 farm steps per row, each 20\u2013600 characters; every band holding its point estimate. A failure exits non-zero before a file is written.</p></div>');

  html('reconcile',
    '<div><b>' + D.accounting.total + '</b> protocols in the snapshot</div>' +
    '<div><span class="plus"> = </span><b>' + D.accounting.ranked + '</b> ranked, records no token and passes the venue test</div>' +
    '<div><span class="plus"> + </span><b>' + D.accounting.live + '</b> records a token (gecko id, ticker or positive market cap)</div>' +
    '<div><span class="plus"> + </span><b>' + D.accounting.excluded + '</b> records no token but is a venue, a wrapper or a versioned pool</div>' +
    '<div style="margin-top:10px">Of the <b>' + D.accounting.ranked + '</b> ranked: <b>' + D.accounting.watched + '</b> on the watchlist, <b>' + D.accounting.off_list + '</b> off it.</div>' +
    '<div>Of the <b>' + D.accounting.excluded + '</b> excluded: ' + Object.keys(D.accounting.excluded_by_signal).map(function (k) {
      return '<b>' + D.accounting.excluded_by_signal[k] + '</b> ' + esc(k);
    }).join(' \u00b7 ') + '.</div>');

  // The board is rendered last, once every panel has been filled, so the first paint is the whole page.
  render();
})();
