/* Cookie Auto Bot Pro - a Frozen Cookies style automation + info mod for Cookie Clicker.
 *
 * AUTOMATION
 *   Auto-buy (efficiency based, with Lucky / Lucky+Frenzy / Chain banks, Pastemode, blacklists)
 *   Auto-click: big cookie, Click Frenzy / Dragonflight boost, golden cookies, wrath cookies, reindeer, fortune ticker
 *   Auto-Godzamok: sells cursors + farms during Dragonflight / Click Frenzy, rebuys afterwards
 *   Auto spell casting: Conjure Baked Goods, Force the Hand of Fate, Spontaneous Edifice, Haggler's Charm
 *   Auto sugar lump harvesting
 *   Wrinkler popping (efficient / instant, season aware, spends wrinklers on purchases)
 *   Auto Santa upgrades, Wizard Tower limit (keeps max mana at 100)
 *   Auto-ascend with reset routine (pop wrinklers, sell buildings, Chocolate egg) + bulk-buy after reincarnation
 * INFO
 *   Next purchase + efficiency %, bank targets, GC / Frenzy timers, Heavenly Chip projections,
 *   internal info table (every purchase with efficiency, cost, delta CPS), history graph,
 *   number formatting, press "e" to open the save export string.
 *
 * Load: paste into the browser console on the game page, or use it as a Steam mod (main.js + info.txt).
 */
(function () {
  'use strict';
  if (typeof Game === 'undefined' || !Game.ready) { console.log('[Cookie Auto Bot Pro] Game not ready yet.'); return; }
  if (window.AutoBakerLoaded) { console.log('[Cookie Auto Bot Pro] Already loaded.'); return; }
  window.AutoBakerLoaded = true;

  /* ------------------------------------------------------------------ settings */
  var DEFAULTS = {
    click: true, clickSpeed: 'medium', clickFrenzy: true, clickFrenzyRate: 250,
    golden: true, wrath: false, reindeer: true, fortune: true,
    buy: true, bank: 'lucky', pasteMode: false,
    blacklist: 'safe', blacklistAuto: true,
    bulk: 1,
    wrinklers: 'off', wrinklerBuyPop: true, keepShiny: true,
    lumps: true, santa: true, wizLimit: false,
    godz: false, godzCursors: 500, godzFarms: 500,
    castHand: false, castConjure: false, castEdifice: false, castHaggler: false,
    ascend: false, ascendPct: 100, ascendMin: 1, resetRoutine: true, heavenlyBuy: false,
    stock: false, stockBuyPct: 50, stockSellPct: 100, stockBudget: 25,
    garden: 'off', gardenSeed: 'bakerWheat',
    dragonTrain: false, dragonPet: false, dragonAura1: 'none', dragonAura2: 'none',
    apocalypse: 'off',
    panelX: null, panelY: null, minimized: false,
    fps: 30, format: 'short', graph: 'cps', showTable: false
  };
  var S = JSON.parse(JSON.stringify(DEFAULTS));

  // Never auto-buy these (Grandmapocalypse triggers, covenants, toggles).
  var GRANDMA = { 'One mind': 1, 'Communal brainsweep': 1, 'Elder Pact': 1, 'Elder Pledge': 1,
                  'Elder Covenant': 1, 'Revoke Elder Covenant': 1 };
  var NEVER = { 'Chocolate egg': 1 };

  // Click speed presets (clicks per second). The game itself caps clicking at 250/s.
  var SPEEDS = { slow: 5, medium: 25, fast: 100, ultra: 250 };

  var status = 'Starting...';
  var info = { list: [], best: null, wait: 0 };
  var reset = { state: 'idle', t: 0, reincAt: 0 };
  var godz = { active: false, sold: {} };
  var hist = [];            // {t, cookies, cps, hc}
  var timers = [];

  /* ------------------------------------------------------------------ helpers */
  function now() { return Date.now(); }
  function buffMult() {
    var m = 1;
    for (var k in Game.buffs) { var b = Game.buffs[k]; if (b && b.multCpS) m *= b.multCpS; }
    return m;
  }
  function rawCps() {
    return Game.cookiesPsRaw || (Game.cookiesPs / Math.max(buffMult(), 0.0001));
  }
  function hasBuff(n) { return !!(Game.buffs && Game.buffs[n]); }
  function fmt(n) {
    if (n === Infinity || isNaN(n)) return '∞';
    if (S.format === 'raw') return Math.round(n).toLocaleString('en-US');
    if (S.format === 'sci') return n < 1000 ? String(Math.round(n * 100) / 100) : n.toExponential(3);
    return Beautify(n, 2);
  }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '–';
    if (sec < 60) return Math.ceil(sec) + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ' + Math.floor(sec % 60) + 's';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
    return Math.floor(sec / 86400) + 'd ' + Math.floor((sec % 86400) / 3600) + 'h';
  }
  function resetting() { return reset.state !== 'idle' || Game.OnAscend; }

  /* banks: cookies we refuse to spend so golden cookies pay out fully */
  function bankTarget() {
    var r = rawCps();
    if (S.bank === 'lucky') return r * 6000;        // Lucky! capped at 15 min of CPS => needs 6000 s of CPS
    if (S.bank === 'frenzy') return r * 6000 * 7;   // same, with a x7 Frenzy active
    if (S.bank === 'chain') return r * 21600 * 9;   // approximate max Cookie Chain payout
    return 0;
  }

  /* ------------------------------------------------------------------ purchase evaluation */
  function gainOf(apply, undo) {
    var base = rawCps(), g = base;
    try { apply(); Game.CalculateGains(); g = rawCps(); }
    finally { undo(); Game.CalculateGains(); }
    return g - base;
  }
  function wizFull() {
    var M = Game.Objects['Wizard tower'].minigame;
    return !!(M && M.magicM >= 100);
  }
  function blocked(c) {
    if (c.kind === 'upgrade') {
      if (NEVER[c.name]) return true;
      // In Grandmapocalypse mode the stages are bought explicitly (see apocalypseTick); never let the
      // efficiency loop buy a pledge/covenant on its own.
      if (S.apocalypse !== 'off' && (c.name === 'Elder Pledge' || c.name === 'Elder Covenant')) return true;
      if (S.blacklist !== 'off' && GRANDMA[c.name]) return true;
      if (S.blacklist === 'hardcore' && (!S.blacklistAuto || Game.cookiesEarned < 1e9)) return true;
    }
    if (c.kind === 'building') {
      if (S.blacklist === 'nobuild' && (!S.blacklistAuto || Game.cookiesEarned < 1e6)) return true;
      if (S.wizLimit && c.name === 'Wizard tower' && wizFull()) return true;
    }
    return false;
  }
  function candidates() {
    var list = [];
    Game.ObjectsById.forEach(function (o) {
      if (o.locked) return;
      var price = o.getPrice();
      var g = gainOf(function () { o.amount++; }, function () { o.amount--; });
      list.push({ kind: 'building', ref: o, name: o.name, price: price, gain: g });
    });
    Game.UpgradesInStore.forEach(function (u) {
      if (u.pool === 'toggle' || u.pool === 'debug') return;
      var price = u.getPrice();
      var g = gainOf(function () { u.bought = 1; }, function () { u.bought = 0; });
      list.push({ kind: 'upgrade', ref: u, name: u.name, price: price, gain: g });
    });
    var cps = Math.max(Game.cookiesPs, 0.1);
    list.forEach(function (c) {
      c.eff = c.gain > 0 ? c.price / c.gain : Infinity;                      // payback seconds
      c.score = c.gain > 0 ? c.eff + Math.max(c.price - Game.cookies, 0) / cps : Infinity;
      c.blocked = blocked(c);
    });
    return list;
  }
  function pickBest(list) {
    var best = null, pool = list.filter(function (c) { return !c.blocked && c.gain > 0; });
    pool.forEach(function (c) {
      if (!best || (S.pasteMode ? c.score > best.score : c.score < best.score)) best = c;
    });
    if (!best) { // cheap utility upgrades that show no CPS change
      list.forEach(function (c) {
        if (!c.blocked && c.kind === 'upgrade' && c.gain <= 0 && c.price < Game.cookies * 0.02) {
          if (!best || c.price < best.price) best = c;
        }
      });
    }
    return best;
  }

  /* ------------------------------------------------------------------ wrinklers */
  function attached() { return Game.wrinklers.filter(function (w) { return w.phase === 2 && w.sucked > 0; }); }
  function wrinklerValue() {
    return attached().reduce(function (a, w) { return a + w.sucked * 1.1; }, 0);
  }
  function popWrinklers(includeShiny) {
    Game.wrinklers.forEach(function (w) {
      if (w.phase !== 2) return;
      if (w.type === 1 && !includeShiny && S.keepShiny) return;
      w.hp = 0;
    });
  }
  function wrinklerTick() {
    var a = attached();
    if (S.apocalypse !== 'off') { if (a.length) popWrinklers(true); return; }   // Grandmapocalypse: pop everything, shinies too
    if (S.wrinklers === 'off') return;
    if (!a.length) return;
    if (S.wrinklers === 'instant') { popWrinklers(false); return; }
    var max = Game.getWrinklersMax ? Game.getWrinklersMax() : 10;
    if (Game.season === 'halloween') { popWrinklers(false); return; }   // season aware: Halloween cookie drops
    if (a.length >= max) popWrinklers(false);                           // free a slot when all are full
  }

  /* ------------------------------------------------------------------ auto-buy */
  function autoBuy() {
    if (Game.buyMode !== 1 || resetting()) return;
    var list = candidates();
    info.list = list;
    var best = pickBest(list);
    info.best = best;
    if (!best) { status = 'Nothing worth buying'; return; }
    var reserve = bankTarget();
    var need = best.price + reserve - Game.cookies;
    info.wait = Math.max(need, 0) / Math.max(Game.cookiesPs, 0.1);
    if (need <= 0) {
      var bulk = (S.bulk > 1 && now() - reset.reincAt < 600000 && best.kind === 'building') ? S.bulk : 1;
      if (best.kind === 'building') best.ref.buy(bulk); else best.ref.buy();
      status = 'Bought ' + best.name;
    } else {
      if (S.wrinklerBuyPop && wrinklerValue() >= need) popWrinklers(true);
      status = 'Saving for ' + best.name + ' (' + fmtTime(info.wait) + ')';
    }
  }

  /* ------------------------------------------------------------------ clicking */
  var clickAcc = 0, lastTick = now();
  function clickTick() {
    var t = now(), dt = (t - lastTick) / 1000; lastTick = t;
    if (!S.click || Game.OnAscend || Game.AscendTimer > 0) return;
    var rate = SPEEDS[S.clickSpeed] || SPEEDS.medium;
    if (S.clickFrenzy && (hasBuff('Click frenzy') || hasBuff('Dragonflight') || hasBuff('Cursed finger'))) {
      rate = Math.max(rate, S.clickFrenzyRate);
    }
    clickAcc += Math.min(dt, 0.25) * rate;
    var n = 0;
    while (clickAcc >= 1 && n < 10) { Game.ClickCookie(); clickAcc--; n++; }
    if (clickAcc > 10) clickAcc = 10;
  }
  function shimmerTick() {
    Game.shimmers.slice().forEach(function (s) {
      if (s.type === 'golden') {
        if (s.wrath && !S.wrath && S.apocalypse === 'off') return;
        if (S.golden) s.pop();
      } else if (s.type === 'reindeer') {
        if (S.reindeer) s.pop();
      }
    });
    if (S.fortune && Game.TickerEffect && Game.TickerEffect.type === 'fortune' && Game.TickerClicked) {
      Game.TickerClicked();
    }
  }

  /* ------------------------------------------------------------------ Godzamok */
  function godzTick() {
    if (!S.godz || !Game.hasGod || !Game.hasGod('ruin')) { godz.active = false; return; }
    var on = hasBuff('Dragonflight') || hasBuff('Click frenzy');
    if (on && !godz.active) {
      godz.active = true; godz.sold = {};
      [['Cursor', S.godzCursors], ['Farm', S.godzFarms]].forEach(function (p) {
        var o = Game.Objects[p[0]], n = Math.min(p[1], o.amount), before = o.amount;
        if (n > 0) { o.sell(n, 1); godz.sold[p[0]] = before - o.amount; }
      });
      status = 'Godzamok: sold cursors/farms';
    } else if (!on && godz.active) {
      godz.active = false;
      if (S.buy) for (var name in godz.sold) {
        if (godz.sold[name] > 0) Game.Objects[name].buy(godz.sold[name]);
      }
      godz.sold = {};
    }
  }

  /* ------------------------------------------------------------------ spells */
  function spellTick() {
    if (!(S.castHand || S.castConjure || S.castEdifice || S.castHaggler)) return;
    var M = Game.Objects['Wizard tower'].minigame;
    if (!M || !M.spells) return;
    function sp(k) { return M.spells[k]; }
    function cost(k) { return sp(k) ? M.getSpellCost(sp(k)) : Infinity; }
    function cast(k) { if (sp(k) && M.magic >= cost(k)) { M.castSpell(sp(k)); status = 'Cast ' + sp(k).name; return true; } return false; }
    var full = M.magic >= M.magicM - 0.5;
    var reserve = S.castHand ? cost('hand of fate') : 0;
    var boosted = buffMult() >= 7 || hasBuff('Dragon Harvest');
    var goldenOnScreen = Game.shimmers.some(function (s) { return s.type === 'golden'; });
    if (S.castHand && boosted && !goldenOnScreen && cast('hand of fate')) return;
    if (S.castConjure && (boosted || full) && M.magic >= cost('conjure baked goods') + reserve && cast('conjure baked goods')) return;
    if (S.castEdifice && full && M.magic >= cost('spontaneous edifice') + reserve && cast('spontaneous edifice')) return;
    if (S.castHaggler && full && M.magic >= cost("haggler's charm") + reserve && cast("haggler's charm")) return;
  }

  /* ------------------------------------------------------------------ misc automation */
  function lumpTick() {
    if (!S.lumps || !Game.canLumps || !Game.canLumps()) return;
    if (now() - Game.lumpT >= Game.lumpRipeAge) Game.clickLump();
  }
  function santaTick() {
    if (!S.santa || resetting() || !Game.Has('A festive hat') || Game.santaLevel >= 14) return;
    var cost = Math.pow(Game.santaLevel + 1, Game.santaLevel + 1);
    if (Game.cookies >= cost + bankTarget()) Game.UpgradeSanta();
  }

  /* ------------------------------------------------------------------ ascension */
  function pendingChips() {
    return Game.HowMuchPrestige(Game.cookiesReset + Game.cookiesEarned) - Game.prestige;
  }
  function buyHeavenly() {
    for (var i = 0; i < 60; i++) {
      var best = null;
      Game.UpgradesById.forEach(function (u) {
        if (u.pool !== 'prestige' || u.bought || !u.canBuy || !u.canBuy()) return;
        if (!best || u.getPrice() < best.getPrice()) best = u;
      });
      if (!best) break;
      best.buy();
    }
  }
  function resetTick() {
    var t = now();
    switch (reset.state) {
      case 'idle':
        if (!S.ascend || Game.OnAscend) return;
        var pend = pendingChips();
        if (pend > 0 && pend >= Math.max(S.ascendMin, Game.prestige * S.ascendPct / 100)) {
          if (S.resetRoutine) popWrinklers(true);
          reset.state = 'pop'; reset.t = t; status = 'Ascending...';
        }
        break;
      case 'pop':
        if (t - reset.t < 1500) break;
        if (S.resetRoutine) {
          Game.ObjectsById.forEach(function (o) { if (o.amount > 0) o.sell(-1, 1); });
          var egg = Game.Upgrades['Chocolate egg'];
          if (egg && !egg.bought && egg.canBuy && egg.canBuy()) egg.buy();
        }
        reset.state = 'go'; reset.t = t; break;
      case 'go':
        if (t - reset.t < 1500) break;
        Game.Ascend(true); reset.state = 'ascending'; reset.t = t; break;
      case 'ascending':
        if (Game.OnAscend && t - reset.t > 5000) {
          if (S.heavenlyBuy) buyHeavenly();
          reset.state = 'reinc'; reset.t = t;
        } else if (t - reset.t > 30000) { reset.state = 'idle'; }   // ascension did not happen
        break;
      case 'reinc':
        if (t - reset.t < 2000) break;
        Game.Reincarnate(true); reset.state = 'idle'; reset.reincAt = t; break;
    }
  }

  /* ------------------------------------------------------------------ Grandmapocalypse */
  var APOC = ['One mind', 'Communal brainsweep', 'Elder Pact'];
  function tryBuyUpgrade(name) {
    var u = Game.Upgrades[name];
    if (u && !u.bought && u.unlocked && u.canBuy()) { u.buy(); status = 'Bought ' + name; return true; }
    return false;
  }
  // 'full'    : walk through every stage (One mind -> Communal brainsweep -> Elder Pact), click wrath
  //             cookies, pop every wrinkler (shinies included).
  // 'pacify'  : same, then buy Elder Pledge / Elder Covenant to calm the grandmas down again.
  function apocalypseTick() {
    if (S.apocalypse === 'off') return;
    for (var i = 0; i < APOC.length; i++) {
      var u = Game.Upgrades[APOC[i]];
      if (u && !u.bought) { tryBuyUpgrade(APOC[i]); return; }   // stages unlock in order, so wait here
    }
    if (S.apocalypse === 'pacify') {
      var cov = Game.Upgrades['Elder Covenant'];
      if (cov && cov.bought) return;                                   // done: grandmas are calm for good
      if (!tryBuyUpgrade('Elder Covenant')) tryBuyUpgrade('Elder Pledge');   // pledging is what unlocks the covenant
    }
  }

  /* ------------------------------------------------------------------ stock market */
  function stockTick() {
    var B = Game.Objects['Bank'], M = B && B.minigame;
    if (!S.stock || !M || !M.goodsById || resetting()) return;
    var ovh = 0.01 * 20 * Math.pow(0.95, M.brokers || 0);     // buy-side overhead, shrinks with brokers
    M.goodsById.forEach(function (g) {
      if (g.active === false || g.active === 0) return;
      var v = g.val, rest = M.getRestingVal(g.id);
      var falling = g.mode === 2 || g.mode === 4;
      if (g.stock > 0) {
        var paid = g.prev || v;
        var profitable = v >= paid * (1 + ovh) * 1.05;
        if (profitable && (v >= rest * S.stockSellPct / 100 || (falling && v >= paid * (1 + ovh) * 1.1))) {
          if (M.sellGood(g.id, 10000)) status = 'Sold ' + g.symbol + ' at ' + (Math.round(v * 100) / 100);
          return;
        }
      }
      if (v <= rest * S.stockBuyPct / 100 && !falling) {
        var unit = Game.cookiesPsRawHighest * v * (1 + ovh);
        var budget = Math.max(Game.cookies - bankTarget(), 0) * S.stockBudget / 100;
        var n = Math.floor(Math.min(M.getGoodMaxStock(g) - g.stock, budget / Math.max(unit, 1e-9)));
        if (n >= 1 && M.buyGood(g.id, n)) status = 'Bought ' + n + ' ' + g.symbol;
      }
    });
  }

  /* ------------------------------------------------------------------ garden */
  var gardenIdx = 0;
  // 'unlock': plants a checkerboard and leaves the gaps empty so neighbouring plants can mutate into them,
  //           cycles through every unlocked seed, harvests anything mature (harvesting unlocks the seed).
  // 'fill'  : fills every unlocked tile with the chosen seed and replants after each harvest.
  function gardenTick() {
    var F = Game.Objects['Farm'], M = F && F.minigame;
    if (S.garden === 'off' || !M || !M.plot || M.freeze || resetting()) return;
    var usable = M.plantsById.filter(function (p) { return p.unlocked && p.plantable !== false && !p.weed; });
    var rows = M.plot.length, cols = M.plot[0].length;
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
      if (!M.isTileUnlocked(x, y)) continue;
      var tile = M.plot[y][x];
      if (tile[0] > 0) {
        var p = M.plantsById[tile[0] - 1];
        if (p.weed || (!p.immortal && tile[1] >= p.mature)) M.harvest(x, y, 1);
        continue;
      }
      if (!usable.length) continue;
      if (S.garden === 'unlock' && (x + y) % 2 !== 0) continue;
      var seed;
      if (S.garden === 'fill') {
        var want = M.plants[S.gardenSeed];
        seed = (want && want.unlocked) ? want : usable[0];
      } else seed = usable[gardenIdx++ % usable.length];
      M.useTool(seed.id, x, y);
    }
  }

  /* ------------------------------------------------------------------ dragon */
  var dragonAuraTry = 0;
  function auraId(name) {
    for (var id in Game.dragonAuras) if (Game.dragonAuras[id].name === name) return +id;
    return -1;
  }
  function setAura(name, slot) {
    if (name === 'none' || !Game.SetDragonAura || !Game.dragonAuras) return;
    var id = auraId(name);
    if (id < 0) return;
    if ((slot ? Game.dragonAura2 : Game.dragonAura) === id) return;
    if (Game.dragonLevel < id + 4) return;                                           // aura not unlocked yet
    if (slot && Game.dragonLevel < Game.dragonLevels.length - 1) return;           // second slot needs a fully trained dragon
    if (now() - dragonAuraTry < 30000) return;                                     // don't spam the confirm prompt
    dragonAuraTry = now();
    Game.SetDragonAura(id, slot);
    if (Game.ConfirmPrompt) Game.ConfirmPrompt();                                  // accept the building-sacrifice prompt
  }
  function dragonTick() {
    if (!(S.dragonTrain || S.dragonPet || S.dragonAura1 !== 'none' || S.dragonAura2 !== 'none')) return;
    if (!Game.Has('A crumbly egg') || !Game.dragonLevels || resetting()) return;
    if (S.dragonTrain && Game.dragonLevel < Game.dragonLevels.length - 1 && Game.dragonLevels[Game.dragonLevel].cost()) {
      Game.UpgradeDragon(); status = 'Trained dragon to level ' + Game.dragonLevel;
    }
    setAura(S.dragonAura1, 0);
    setAura(S.dragonAura2, 1);
    if (S.dragonPet && Game.Has('Pet the dragon') && Game.ClickSpecialPic) {
      var tab = Game.specialTab;
      Game.specialTab = 'dragon';
      try { Game.ClickSpecialPic(); } finally { Game.specialTab = tab; }
    }
  }

  /* ------------------------------------------------------------------ loops */
  var lastRun = { stock: 0, garden: 0 };
  function logic() {
    try {
      shimmerTick();
      resetTick();
      if (resetting()) return;
      godzTick();
      spellTick();
      wrinklerTick();
      lumpTick();
      santaTick();
      apocalypseTick();
      dragonTick();
      var t = now();
      if (t - lastRun.stock > 5000) { lastRun.stock = t; stockTick(); }
      if (t - lastRun.garden > 3000) { lastRun.garden = t; gardenTick(); }
      if (S.buy) autoBuy(); else status = 'Auto-buy off';
    } catch (e) { console.error('[Cookie Auto Bot Pro]', e); }
  }
  function sample() {
    try {
      var pend = Game.HowMuchPrestige ? pendingChips() : 0;
      hist.push({ t: now(), cookies: Game.cookies, cps: rawCps(), hc: Game.prestige + Math.max(pend, 0) });
      if (hist.length > 360) hist.shift();
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ UI */
  var panel, tableEl, infoEl, canvas;
  var SCHEMA = [
    ['h', 'Clicking'],
    ['click', 'bool', 'Auto-click cookie'],
    ['clickSpeed', 'sel', 'Click speed', [['slow', 'Slow (5/s)'], ['medium', 'Medium (25/s)'], ['fast', 'Fast (100/s)'], ['ultra', 'Ultra fast (250/s)']]],
    ['clickFrenzy', 'bool', 'Boost during Click Frenzy / Dragonflight'],
    ['clickFrenzyRate', 'num', 'Boosted rate (/s)', 1, 250],
    ['golden', 'bool', 'Golden cookies'],
    ['wrath', 'bool', 'Wrath cookies'],
    ['reindeer', 'bool', 'Reindeer'],
    ['fortune', 'bool', 'Fortune news'],
    ['h', 'Buying'],
    ['buy', 'bool', 'Auto-buy'],
    ['bank', 'sel', 'Bank', [['none', 'None'], ['lucky', 'Lucky'], ['frenzy', 'Lucky + Frenzy'], ['chain', 'Chain (approx)']]],
    ['pasteMode', 'bool', 'Pastemode (reverse efficiency)'],
    ['blacklist', 'sel', 'Blacklist', [['off', 'Off'], ['safe', 'Grandmapocalypse stop'], ['hardcore', 'Hardcore (no upgrades)'], ['nobuild', 'No buildings']]],
    ['blacklistAuto', 'bool', 'Auto-disable blacklist at goal'],
    ['bulk', 'sel', 'Bulk-buy after reincarnation', [[1, 'Off'], [10, 'x10'], [100, 'x100']]],
    ['wizLimit', 'bool', 'Wizard Tower limit (max mana 100)'],
    ['santa', 'bool', 'Auto Santa upgrades'],
    ['lumps', 'bool', 'Harvest sugar lumps'],
    ['h', 'Wrinklers'],
    ['wrinklers', 'sel', 'Popping', [['off', 'Off'], ['efficient', 'Efficient'], ['instant', 'Instant']]],
    ['wrinklerBuyPop', 'bool', 'Pop to afford purchases'],
    ['keepShiny', 'bool', 'Keep shiny wrinklers'],
    ['h', 'Godzamok'],
    ['godz', 'bool', 'Auto-Godzamok'],
    ['godzCursors', 'num', 'Cursor limit', 0, 9999],
    ['godzFarms', 'num', 'Farm limit', 0, 9999],
    ['h', 'Spells'],
    ['castHand', 'bool', 'Force the Hand of Fate'],
    ['castConjure', 'bool', 'Conjure Baked Goods'],
    ['castEdifice', 'bool', 'Spontaneous Edifice'],
    ['castHaggler', 'bool', "Haggler's Charm"],
    ['h', 'Ascension'],
    ['ascend', 'bool', 'Auto-ascend'],
    ['ascendPct', 'num', 'Ascend at +% more chips', 0, 100000],
    ['ascendMin', 'num', 'Minimum new chips', 1, 1e12],
    ['resetRoutine', 'bool', 'Reset routine (pop, sell, egg)'],
    ['heavenlyBuy', 'bool', 'Buy heavenly upgrades'],
    ['h', 'Grandmapocalypse'],
    ['apocalypse', 'sel', 'Run the apocalypse', [['off', 'Off (avoid it)'], ['full', 'Full (all stages)'], ['pacify', 'Full, then pacify']]],
    ['h', 'Stock market'],
    ['stock', 'bool', 'Auto-trade stocks'],
    ['stockBuyPct', 'num', 'Buy below % of resting price', 1, 100],
    ['stockSellPct', 'num', 'Sell above % of resting price', 50, 500],
    ['stockBudget', 'num', '% of spare cookies per buy', 1, 100],
    ['h', 'Garden'],
    ['garden', 'sel', 'Auto-garden', [['off', 'Off'], ['unlock', 'Unlock seeds (checkerboard)'], ['fill', 'Fill with one seed']]],
    ['gardenSeed', 'sel', 'Seed for "fill"', [['bakerWheat', "Baker's wheat"], ['thumbcorn', 'Thumbcorn'], ['cronerice', 'Cronerice'], ['gildmillet', 'Gildmillet'], ['clover', 'Ordinary clover'], ['goldenClover', 'Golden clover'], ['whiskerbloom', 'Whiskerbloom'], ['chimerose', 'Chimerose']]],
    ['h', 'Dragon'],
    ['dragonTrain', 'bool', 'Train dragon (sacrifices buildings!)'],
    ['dragonPet', 'bool', 'Pet the dragon'],
    ['dragonAura1', 'sel', 'Aura 1', [['none', 'Leave alone'], ['Radiant Appetite', 'Radiant Appetite'], ['Dragonflight', 'Dragonflight'], ['Elder Battalion', 'Elder Battalion'], ['Epoch Changer', 'Epoch Changer'], ['Breath of Milk', 'Breath of Milk'], ['Mind Over Matter', 'Mind Over Matter'], ['Reality Bending', 'Reality Bending'], ['Dragon Orbs', 'Dragon Orbs'], ["Dragon's Fortune", "Dragon's Fortune"], ['Master of the Armory', 'Master of the Armory']]],
    ['dragonAura2', 'sel', 'Aura 2', [['none', 'Leave alone'], ['Radiant Appetite', 'Radiant Appetite'], ['Dragonflight', 'Dragonflight'], ['Elder Battalion', 'Elder Battalion'], ['Epoch Changer', 'Epoch Changer'], ['Breath of Milk', 'Breath of Milk'], ['Mind Over Matter', 'Mind Over Matter'], ['Reality Bending', 'Reality Bending'], ['Dragon Orbs', 'Dragon Orbs'], ["Dragon's Fortune", "Dragon's Fortune"], ['Master of the Armory', 'Master of the Armory']]],
    ['h', 'Display'],
    ['format', 'sel', 'Numbers', [['short', 'Short'], ['sci', 'Scientific'], ['raw', 'Raw']]],
    ['graph', 'sel', 'Graph', [['cps', 'CPS'], ['cookies', 'Cookies'], ['hc', 'Heavenly chips']]],
    ['fps', 'num', 'FPS (experimental)', 10, 144],
    ['showTable', 'bool', 'Internal info table']
  ];

  var CSS = [
    '#autoBakerPanel{position:fixed;z-index:100000;width:280px;background:rgba(37,42,51,.96);color:#d5dbe4;font:12px/1.35 sans-serif;',
    'border:1px solid #4aa3ff;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.5)}',
    '#autoBakerPanel .abHead{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;cursor:move;touch-action:none;',
    'user-select:none;background:linear-gradient(#3a4452,#2c333f);border-radius:7px 7px 0 0}',
    '#autoBakerPanel .abTitle{color:#4aa3ff;font-weight:bold;letter-spacing:.3px}',
    '#autoBakerPanel .abBtn{cursor:pointer;color:#d5dbe4;background:#3b4452;border:1px solid #556070;border-radius:4px;width:22px;height:18px;',
    'line-height:15px;text-align:center;margin-left:10px}',
    '#autoBakerPanel .abBtn:hover{background:#4aa3ff;color:#0e1520}',
    '#autoBakerPanel .abBody{padding:8px 10px;max-height:75vh;overflow:auto}',
    '#autoBakerPanel.abMin{width:auto;min-width:190px}',
    '#autoBakerPanel.abMin .abHead{border-radius:7px}',
    '#autoBakerPanel.abMin .abBody{display:none}',
    '#autoBakerPanel .abInfo{margin:0 0 6px;padding:5px 6px;background:#1d2229;border:1px solid #3b4452;border-radius:5px}',
    '#autoBakerPanel .abSec{margin-top:8px;color:#4aa3ff;font-weight:bold;border-bottom:1px solid #3b4452}',
    '#autoBakerPanel summary{cursor:pointer;font-weight:bold}',
    '#autoBakerPanel input[type=checkbox]{accent-color:#4aa3ff}',
    '#autoBakerPanel input,#autoBakerPanel select{background:#1d2229;color:#d5dbe4;border:1px solid #556070;border-radius:3px}',
    '#autoBakerPanel table{border-collapse:collapse;width:100%;font-size:11px}',
    '#autoBakerPanel th{color:#8d98a8;font-weight:normal}',
    '#autoBakerPanel td,#autoBakerPanel th{padding:1px 3px}'
  ].join('');

  function clampPanel() {
    if (!panel || S.panelX === null) return;
    var maxX = Math.max(0, window.innerWidth - panel.offsetWidth), maxY = Math.max(0, window.innerHeight - panel.offsetHeight);
    S.panelX = Math.min(Math.max(0, S.panelX), maxX);
    S.panelY = Math.min(Math.max(0, S.panelY), maxY);
  }
  function applyLayout() {
    if (!panel) return;
    panel.classList.toggle('abMin', !!S.minimized);
    var btn = panel.querySelector('#abToggle');
    if (btn) { btn.textContent = S.minimized ? '+' : '–'; btn.title = S.minimized ? 'Restore' : 'Minimize'; }
    if (S.panelX === null) { panel.style.left = '8px'; panel.style.bottom = '8px'; panel.style.top = 'auto'; }
    else { clampPanel(); panel.style.left = S.panelX + 'px'; panel.style.top = S.panelY + 'px'; panel.style.bottom = 'auto'; }
  }
  function toggleMinimized() { S.minimized = !S.minimized; applyLayout(); }

  function makeDraggable(head) {
    var dragging = false, offX = 0, offY = 0;
    head.addEventListener('pointerdown', function (e) {
      if (e.target.id === 'abToggle' || (e.button !== undefined && e.button !== 0)) return;
      var r = panel.getBoundingClientRect();
      dragging = true; offX = e.clientX - r.left; offY = e.clientY - r.top;
      S.panelX = r.left; S.panelY = r.top;               // switch from bottom-anchored to top-anchored
      if (head.setPointerCapture) { try { head.setPointerCapture(e.pointerId); } catch (x) {} }
      e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      S.panelX = e.clientX - offX; S.panelY = e.clientY - offY;
      applyLayout();
    });
    function stop(e) {
      if (!dragging) return;
      dragging = false;
      if (head.releasePointerCapture) { try { head.releasePointerCapture(e.pointerId); } catch (x) {} }
    }
    head.addEventListener('pointerup', stop);
    head.addEventListener('pointercancel', stop);
    head.addEventListener('dblclick', function (e) { if (e.target.id !== 'abToggle') toggleMinimized(); });
  }

  function buildUI() {
    var st = document.createElement('style');
    st.id = 'autoBakerStyle';
    st.textContent = CSS;
    (document.head || document.body).appendChild(st);

    panel = document.createElement('div');
    panel.id = 'autoBakerPanel';
    var html = '<div class="abHead" id="abHead"><span class="abTitle">Cookie Auto Bot Pro</span>' +
      '<span class="abBtn" id="abToggle" title="Minimize">–</span></div>' +
      '<div class="abBody" id="abBody"><div class="abInfo" id="abInfo"></div>' +
      '<canvas id="abGraph" width="250" height="60" style="width:250px;height:60px;display:block;margin-bottom:4px"></canvas>' +
      '<div id="abTable"></div><details><summary>Settings</summary>';
    SCHEMA.forEach(function (r) {
      if (r[0] === 'h') { html += '<div class="abSec">' + r[1] + '</div>'; return; }
      var k = r[0], t = r[1], label = r[2];
      if (t === 'bool') html += '<label style="display:block;cursor:pointer"><input type="checkbox" data-k="' + k + '"> ' + label + '</label>';
      else if (t === 'num') html += '<div>' + label + ' <input type="number" data-k="' + k + '" min="' + r[3] + '" max="' + r[4] + '" style="width:80px"></div>';
      else html += '<div>' + label + ' <select data-k="' + k + '">' + r[3].map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></div>';
    });
    html += '</details></div>';
    panel.innerHTML = html;
    document.body.appendChild(panel);
    infoEl = panel.querySelector('#abInfo'); tableEl = panel.querySelector('#abTable'); canvas = panel.querySelector('#abGraph');

    var types = {}; SCHEMA.forEach(function (r) { if (r[0] !== 'h') types[r[0]] = r; });
    panel.querySelectorAll('[data-k]').forEach(function (el) {
      el.addEventListener('change', function () {
        var k = el.dataset.k, r = types[k], v;
        if (r[1] === 'bool') v = el.checked;
        else if (r[1] === 'num') v = Math.min(r[4], Math.max(r[3], parseFloat(el.value) || DEFAULTS[k]));
        else v = isNaN(+el.value) ? el.value : +el.value;
        S[k] = v; applySettings();
      });
    });
    panel.querySelector('#abToggle').addEventListener('click', toggleMinimized);
    makeDraggable(panel.querySelector('#abHead'));
    window.addEventListener('resize', function () { clampPanel(); applyLayout(); });
    refreshControls();
  }
  function refreshControls() {
    if (!panel) return;
    panel.querySelectorAll('[data-k]').forEach(function (el) {
      var v = S[el.dataset.k];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    applyLayout();
  }
  function applySettings() {
    if (S.fps >= 10 && Game.fps !== S.fps) Game.fps = S.fps;
  }

  function line(a, b) { return '<div><span style="opacity:.7">' + a + '</span> ' + b + '</div>'; }
  function refreshInfo() {
    if (!infoEl) return;
    var h = line('Status', status);
    var b = info.best;
    if (b) {
      var pct = b.eff > 0 && isFinite(b.eff) ? '' : '';
      h += line('Next', b.name + ' · ' + fmt(b.price) + ' · +' + fmt(b.gain) + ' cps · payback ' + fmtTime(b.eff) + ' · ' + fmtTime(info.wait));
    }
    var bank = bankTarget();
    h += line('Bank', fmt(Game.cookies) + ' / ' + fmt(bank) + ' (' + S.bank + ')');
    var gt = Game.shimmerTypes && Game.shimmerTypes.golden;
    if (gt) h += line('Next GC', fmtTime((gt.minTime - gt.time) / Game.fps) + ' – ' + fmtTime((gt.maxTime - gt.time) / Game.fps));
    var buffs = [];
    for (var k in Game.buffs) buffs.push(Game.buffs[k].name + ' ' + fmtTime(Game.buffs[k].time / Game.fps));
    if (buffs.length) h += line('Buffs', buffs.join(', '));
    try {
      var pend = pendingChips(), cps = Math.max(Game.cookiesPs, 0.01);
      var nextAt = Game.HowManyCookiesReset(Game.prestige + Math.max(pend, 0) + 1) - (Game.cookiesReset + Game.cookiesEarned);
      var rate = '';
      if (hist.length > 2) {
        var f = hist[0], l = hist[hist.length - 1], dt = (l.t - f.t) / 3600000;
        if (dt > 0) rate = ' · ' + fmt((l.hc - f.hc) / dt) + '/h';
      }
      h += line('Chips', fmt(Game.prestige) + ' +' + fmt(Math.max(pend, 0)) + ' (next in ' + fmtTime(nextAt / cps) + ')' + rate);
    } catch (e) {}
    if (S.wrinklers !== 'off' || S.wrinklerBuyPop) h += line('Wrinklers', attached().length + ' attached · worth ' + fmt(wrinklerValue()));
    try {
      var Bk = Game.Objects['Bank'].minigame, Fm = Game.Objects['Farm'].minigame;
      if (S.stock && Bk && Bk.goodsById) h += line('Stocks', 'profit ' + fmt(Bk.profit) + ' · holding ' + Bk.goodsById.filter(function (g) { return g.stock > 0; }).length + ' goods');
      if (S.garden !== 'off' && Fm) h += line('Garden', Fm.plantsUnlockedN + '/' + Fm.plantsN + ' seeds unlocked');
      if (S.apocalypse !== 'off') h += line('Grandmapocalypse', 'stage ' + (Game.elderWrath || 0) + '/3');
      if ((S.dragonTrain || S.dragonPet) && Game.dragonLevels) h += line('Dragon', 'level ' + Game.dragonLevel + '/' + (Game.dragonLevels.length - 1));
    } catch (e) {}
    infoEl.innerHTML = h;

    if (S.showTable) {
      var rows = info.list.filter(function (c) { return isFinite(c.score); }).sort(function (a, b2) { return a.score - b2.score; }).slice(0, 15);
      var best = rows.length ? rows[0].score : 1;
      tableEl.innerHTML = '<table style="width:100%;font-size:11px"><tr><th align="left">Item</th><th>Eff%</th><th>Cost</th><th>ΔCPS</th></tr>' +
        rows.map(function (c) {
          return '<tr' + (c.blocked ? ' style="opacity:.4"' : '') + '><td>' + c.name + '</td><td>' + Math.round(best / c.score * 100) +
            '</td><td>' + fmt(c.price) + '</td><td>' + fmt(c.gain) + '</td></tr>';
        }).join('') + '</table>';
    } else tableEl.innerHTML = '';
    drawGraph();
  }
  function drawGraph() {
    if (!canvas || !canvas.getContext || hist.length < 2) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width, h = canvas.height, key = S.graph;
    ctx.clearRect(0, 0, w, h);
    var vals = hist.map(function (p) { return Math.log10(Math.max(p[key], 1)); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 0.01) hi = lo + 0.01;
    ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.5; ctx.beginPath();
    vals.forEach(function (v, i) {
      var x = i / (vals.length - 1) * w, y = h - 4 - (v - lo) / (hi - lo) * (h - 8);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#d5dbe4'; ctx.font = '10px sans-serif';
    ctx.fillText(key + ' (log) ' + fmt(hist[hist.length - 1][key]), 4, 10);
  }

  /* ------------------------------------------------------------------ register */
  function onKey(e) {
    if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
      if (Game.ExportSave) Game.ExportSave();
    }
  }

  Game.registerMod('autoBaker', {
    init: function () {
      buildUI();
      applySettings();
      timers.push(setInterval(function () { try { clickTick(); } catch (e) { console.error('[Cookie Auto Bot Pro]', e); } }, 33));
      timers.push(setInterval(logic, 250));
      timers.push(setInterval(sample, 5000));
      timers.push(setInterval(refreshInfo, 500));
      document.addEventListener('keydown', onKey);
      Game.Notify('Cookie Auto Bot Pro loaded', 'Drag the title bar to move it, click – to minimize. Press "e" to export your save.', [16, 5], 5);
    },
    save: function () { return JSON.stringify(S); },
    load: function (str) {
      try { var d = JSON.parse(str); for (var k in d) if (k in S) S[k] = d[k]; } catch (e) {}
      refreshControls(); applySettings();
    }
  });
})();
