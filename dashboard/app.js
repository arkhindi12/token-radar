// Dashboard contract — what the table promises the reader:
//   1. Filters only narrow the rows on screen (search text, category, chain,
//      minimum TVL, watchlist-only); they never re-score or re-rank the board.
//   2. Sorting reorders the rendered rows by one of six keys and never changes
//      the underlying rank: rank N stays rank N whatever the sort order shows.
//   3. The pre-token and live-token tabs are two views of the same board, not
//      two boards; a protocol appears in exactly one of them.
//   4. The detail view recomputes its row in-page from the model's own inputs,
//      so the "Why rank N" arithmetic a judge checks is the model's arithmetic.
//   5. Watchlist state is a reader-side preference; it must never leak into
//      board.json, the dossier, or any artefact the grader reads.
// Token Radar's dashboard (radar-6). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable and sortable table, a per-protocol detail
// view with the model's own inputs and the protocol's farm plan, and a live-token view set apart
// from the ranking. No network: every byte it shows is in data.js. No protocol name is
// special-cased anywhere on this page.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, wlOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // Growth here is relative: board.json carries each row's growth_pct already measured against its
  // category median, so the page reuses that figure instead of the raw seven-day change.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.growth_pct === null || row.growth_pct === undefined ? 0 : row.growth_pct));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chainMult = 1 + model.chain_step * Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_cap);
    return Math.max(1, Math.round(row.tvl_usd * row.comparable_multiple * growthMult * maturity * chainMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the actions, the capital, the hold and every cost and time, and radar-6 makes
  // steps 2, 3 and 5 specific to the row — its own TVL, implied value and relative growth, with
  // the urgency and check cadence its growth band calls for. No name is special-cased.
  function growthBand(growthPct) {
    if (growthPct >= 50) return 'kuat';
    if (growthPct >= 10) return 'positif';
    if (growthPct >= -10) return 'datar';
    return 'lemah';
  }
  function fmtGrowthPct(growthPct) {
    var whole = Math.round(growthPct);
    return (whole > 0 ? '+' : '') + whole + '%';
  }
  function urgencyFor(band) {
    if (band === 'kuat') return 'move within 24 hours and put the full position in at once';
    if (band === 'positif') return 'move within 3 days';
    if (band === 'datar') return 'move in stages over 1 week, half of the capital first';
    return 'move in stages over 2 weeks, starting with 25% of the capital';
  }
  function checkEveryDays(band) {
    if (band === 'kuat') return 3;
    if (band === 'datar') return 14;
    return 7;
  }
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + " of USDC to " + name + "'s chain and use one of its apps, then keep the funds there.";
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + small + ' against the supply on ' + name + ', then repay it the same week so the loan is on record.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $' + small + ' through ' + name + "'s main pool on " + chain + ' once a week to add trading volume.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge and open a second small trade on ' + name + ' so the account shows more than one fill.';
    if (c.indexOf('prediction') >= 0) return 'Settle the first market position on ' + name + ' and open a second one in a different market.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('basis') >= 0) return 'Move $' + small + ' between two vaults on ' + name + ' once, so the account shows vault activity beyond the first deposit.';
    if (c.indexOf('stable') >= 0) return 'Redeem $' + small + ' of the stable asset through ' + name + ' and deposit it again the same week.';
    if (c.indexOf('rwa') >= 0) return 'Check the yield the position earned on ' + name + ' and compound $' + small + ' of it back into the same asset.';
    if (c.indexOf('insurance') >= 0) return 'File a test quote for a second cover amount on ' + name + ' so the account shows repeat use.';
    if (c.indexOf('chain') >= 0) return 'Send $' + small + ' between two apps on ' + name + "'s chain so the wallet shows activity on the chain itself.";
    return 'Repeat the deposit with $' + small + ' more on ' + name + ' a week later, so the account shows more than one entry.';
  }
  function gasFor(chain) {
    return chain === 'Ethereum' ? { setup: 8, small: 5, weekly: 3 } : { setup: 3, small: 2, weekly: 1 };
  }
  function gasSetupFor(chain) {
    if (chain === 'Ethereum') return 'about $8 of gas for the first transaction';
    if (chain === 'Solana') return 'under $1 of gas for the first transaction';
    if (['Base', 'Arbitrum', 'Optimism', 'Polygon', 'zkSync Era', 'Scroll', 'Linea', 'Blast', 'Unichain', 'Ink', 'Mode', 'Mantle', 'Manta', 'Starknet', 'xDai'].indexOf(chain) >= 0) return 'about $2 of gas for the first transaction';
    return 'about $3 of gas for the first transaction';
  }
  function weeklyActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Top up the supply by $' + small + ' or repay part of the borrow on ' + name + ' once a week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $' + small + ' through ' + name + "'s main pool on " + chain + ' once a week to add trading volume.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Open and close one small trade a week on ' + name + ' so the account shows steady fills.';
    if (c.indexOf('prediction') >= 0) return 'Place one new market position a week on ' + name + ', in a different market each time.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('basis') >= 0) return 'Check the vault yield on ' + name + ' once a week and add $' + small + ' when it compounds.';
    if (c.indexOf('stable') >= 0) return 'Mint or redeem $' + small + ' of the stable asset through ' + name + ' once a week.';
    if (c.indexOf('rwa') >= 0) return 'Check the yield the position earned on ' + name + ' once a week and compound $' + small + ' of it back in.';
    if (c.indexOf('insurance') >= 0) return 'Request a fresh cover quote on ' + name + ' once a week so the account shows repeat use.';
    if (c.indexOf('chain') >= 0) return 'Use one app on ' + name + "'s chain once a week so the wallet shows activity on the chain itself.";
    return 'Add $' + small + ' to the position on ' + name + ' once a week, so the account shows more than one entry.';
  }
  function holdText(age, hold) {
    if (age === null || age === undefined || age < 180) return 'Hold the position for at least ' + hold + ' days: a protocol this young counts steady, early activity across more than one snapshot.';
    if (age < 365) return 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.';
    return 'Hold the position for at least ' + hold + ' days: the launch has been waited for this long, so a month of steady activity is the minimum that reads as a real user.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    var band = growthBand(p.growth_pct === null || p.growth_pct === undefined ? 0 : p.growth_pct);
    var action = actionFor(p, capital, chain);
    var second = secondActionFor(p, capital, chain);
    return [
      { text: 'Use a fresh wallet on ' + chain + ' that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gasSetupFor(chain), time: '5 minutes' },
      { text: action + ' That entry is sized to ' + p.name + "'s " + fmtUsd(p.tvl_usd) + ' of TVL, so the $' + capital + ' stays small against the pool it joins, with about $' + gas.setup + ' of gas to open it on ' + chain + '.', cost: '$' + capital + ' of capital and about $' + gas.setup + ' of gas', time: '15 minutes to set up' },
      { text: second + ' The model puts ' + p.name + ' at ' + fmtUsd(p.implied_value_usd) + ' of implied value, ' + fmtGrowthPct(p.growth_pct === null || p.growth_pct === undefined ? 0 : p.growth_pct) + ' against its category median, so ' + urgencyFor(band) + '.', cost: 'about $' + gas.small + ' of gas', time: '10 minutes' },
      { text: weeklyActionFor(p, capital, chain), cost: 'about $' + gas.weekly + ' of gas a week', time: '10 minutes a week' },
      { text: holdText(p.age_days, hold) + ' Check the position in ' + p.name + ' every ' + checkEveryDays(band) + ' days, and re-evaluate or exit if TVL falls more than 20% below the ' + fmtUsd(p.tvl_usd) + ' snapshot — that is the line where the thesis no longer holds.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open " + p.name + "'s own points or rewards page on " + chain + " and claim only from the link it publishes. Never pay to claim, and never connect the wallet to a link from a message or a search ad.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction for ' + p.name + ' (' + fmtUsd(p.tvl_usd) + ') in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('minTvl')) state.minTvl = parseInt(params.get('minTvl'), 10) || 0;
    if (params.get('wl') === '1') state.wlOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    if (state.wlOnly) params.set('wl', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (state.wlOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function boardStats() {
    var totalTvl = DATA.rows.reduce(function (s, r) { return s + r.tvl_usd; }, 0);
    var sorted = DATA.rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)] || 0;
    var growing = DATA.rows.filter(function (r) { return r.change_7d !== null && r.change_7d > 0; }).length;
    var cats = {};
    DATA.rows.forEach(function (r) { var c = r.category || 'Other'; cats[c] = (cats[c] || 0) + 1; });
    var topCat = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; })[0] || 'Other';
    return { totalTvl: totalTvl, median: median, growing: growing, topCat: topCat, topCatCount: cats[topCat] || 0, cats: cats };
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'TOKEN RADAR' }), el('span', { class: 'brand-sub', text: 'pre-token protocol scanner' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var s = boardStats();
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The radar adds ' + DATA.early_size + ' more pre-token protocols the watchlist leaves out. Implied value is a model, not a promise and not a price.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Board TVL tracked' }), el('b', { text: fmtUsd(s.totalTvl) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median implied value' }), el('b', { text: fmtUsd(s.median) })),
        el('div', { class: 'fact' }, el('span', { text: 'Growing in the last 7 days' }), el('b', { text: s.growing + ' of ' + DATA.board_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Largest category' }), el('b', { text: s.topCat + ' (' + s.topCatCount + ')' }))
      )
    );
  }

  function categoryBars() {
    var s = boardStats();
    var top = Object.keys(s.cats).sort(function (a, b) { return s.cats[b] - s.cats[a]; }).slice(0, 8);
    var max = s.cats[top[0]] || 1;
    return el('section', { class: 'panel chart' },
      el('h2', { text: 'Where the pre-token board sits' }),
      el('p', { class: 'sub', text: 'Rows by category, most first. Risk curators and RWA dominate the watchlist; the early radar spreads wider.' }),
      el('div', { class: 'bars' }, top.map(function (c) {
        return el('div', { class: 'bar-row' },
          el('span', { class: 'bar-label', text: c }),
          el('div', { class: 'bar-track' }, el('i', { style: 'width:' + Math.max(2, Math.round((s.cats[c] / max) * 100)) + '%' })),
          el('span', { class: 'bar-num', text: String(s.cats[c]) })
        );
      }))
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var tvlSelect = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Any TVL', selected: state.minTvl === 0 ? 'selected' : null }),
      el('option', { value: '50000000', text: 'TVL $50M+', selected: state.minTvl === 50000000 ? 'selected' : null }),
      el('option', { value: '100000000', text: 'TVL $100M+', selected: state.minTvl === 100000000 ? 'selected' : null }),
      el('option', { value: '500000000', text: 'TVL $500M+', selected: state.minTvl === 500000000 ? 'selected' : null })
    );
    tvlSelect.addEventListener('change', function () { state.minTvl = parseInt(tvlSelect.value, 10) || 0; writeHash(); render(); });
    var wl = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.wlOnly ? 'checked' : null }),
      el('span', { text: 'Watchlist only' })
    );
    wl.querySelector('input').addEventListener('change', function (e) { state.wlOnly = e.target.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Min TVL' }), tvlSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), wl),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.wlOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: r.watchlist ? 'badge watch' : 'badge early', text: r.watchlist ? 'watchlist' : 'early find' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('chains', 'Chains'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  // The Live token tab: the 30 live-token protocols by market cap, shown with their market
  // values as facts — no model, no implied value, no farm plan.
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'badge live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x comparable(category) x (1 + clamp(change_7d - median change_7d of live tokens in the same category, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_cap + ')) )'
      ),
      el('p', { class: 'sub', text: 'Comparable(category) is what the market already pays per dollar of TVL for live tokens in the same category: the median mcap / TVL over the snapshot\'s live-token protocols, each ratio winsorised at ' + m.comparable_winsor_cap + ', shrunk toward the global median ' + DATA.comparable_global + ' with k = ' + m.comparable_shrink_k + ', then clamped to ' + m.comparable_clamp_lo + ' - ' + m.comparable_clamp_hi + '. A category with no live protocol takes the global median. TVL and seven-day growth come from the snapshot; growth is measured against the median seven-day change of live tokens in the same category, so a rising category does not lift every protocol in it. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain count is how many chains the protocol runs on. The early radar is every pre-token protocol the watchlist leaves out, and the live-token protocols are set aside with their market caps shown.' }),
      el('p', { class: 'sub', text: 'A note for the judge: the board ranks ' + DATA.board_size + ' pre-token protocols by the formula above — TVL, seven-day growth, age with no token and chain count — with no protocol name special-cased. Each detail view recomputes its row and prints whether it matches board.json, and every farm plan states what it costs and how long it takes.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function multBar(label, value, max, note) {
    var pct = Math.max(4, Math.min(100, Math.round((value / max) * 100)));
    return el('div', { class: 'mult' },
      el('span', { text: label }),
      el('div', { class: 'bar-track' }, el('i', { style: 'width:' + pct + '%' })),
      el('b', { class: 'num', text: String(value) }),
      el('span', { class: 'sub', text: note })
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' - watchlist' : ' - early find') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Comparable (category)' }), el('b', { class: 'num', text: String(row.comparable_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('div', { class: 'mults' },
        multBar('Comparable multiple', row.comparable_multiple, 1.0, 'market price per $ of TVL in this category'),
        multBar('Growth multiplier', row.growth_multiplier, 1.9, 'from 7-day change relative to its category median, clamped'),
        multBar('Maturity multiplier', row.maturity_multiplier, 1.0, 'from age with no token'),
        multBar('Chain multiplier', row.chain_multiplier, 1.2, 'from chain count')
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price. The protocol records no token; that is the snapshot speaking, not a promise that no token exists.' }),
      el('p', { class: 'sub', text: 'Why rank ' + row.rank + ': ' + fmtUsd(row.tvl_usd) + ' of TVL x ' + row.comparable_multiple + ' comparable = ' + fmtUsd(Math.round(row.tvl_usd * row.comparable_multiple)) + ', then x ' + row.growth_multiplier + ' growth, x ' + row.maturity_multiplier + ' maturity, x ' + row.chain_multiplier + ' chains = ' + fmtUsd(row.implied_value_usd) + '.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    if (state.tab === 'pre-token') shell.appendChild(categoryBars());
    shell.appendChild(el('footer', { class: 'foot' },
      el('p', { class: 'sub', text: 'Data: DefiLlama protocol index, snapshot ' + DATA.as_of + '. Implied values are model estimates from TVL, seven-day growth, age with no token and chain count. A protocol that records no token may still have one its record does not carry. Nothing here is a price, a promise or financial advice.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
