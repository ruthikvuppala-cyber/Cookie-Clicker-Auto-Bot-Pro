/* Cookie-Clicker-Auto-Bot-Pro - a Frozen Cookies style automation + info mod for Cookie Clicker.
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
  var NAME = 'Cookie-Clicker-Auto-Bot-Pro';
  var MOD_ID = 'autoBaker';
  var TIP = 'Welcome! The bot is on: it clicks, buys and grabs golden cookies for you. Use the big switch to pause it, pick a preset, or open a section to fine-tune. Hover any setting for help. Cheat mode is optional and marks your save.';
  if (typeof Game === 'undefined' || !Game.ready) { console.log('[' + NAME + '] Game not ready yet.'); return; }
  var VERSION = '1.5';
  var LABEL = 'CHEATv' + VERSION;
  if (window.AutoBakerLoaded) {
    var running = (typeof window.AutoBakerLoaded === 'string') ? (/^\d/.test(window.AutoBakerLoaded) ? 'v' + window.AutoBakerLoaded : window.AutoBakerLoaded) : 'an older version';
    console.log('[' + NAME + '] Already loaded (' + running + ').');
    try { Game.Notify(NAME + ' ' + LABEL, 'Not loaded: ' + running + ' is already running in this tab. Refresh the page (Ctrl+Shift+R), then load it again.', [16, 5], 10); } catch (e) {}
    return;
  }
  window.AutoBakerLoaded = LABEL;

  /* ------------------------------------------------------------------ settings */
  var DEFAULTS = {
    click: true, clickSpeed: 'medium', clickFrenzy: true, clickFrenzyRate: 250,
    golden: true, wrath: false, reindeer: true, fortune: true,
    buy: true, bank: 'none', pasteMode: false,
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
    mode: 'bot', cheated: false, saveId: null, botInCheat: false,
    cheatAmt: '1e12', cheatBld: 'all', cheatBldN: 100, cheatGc: 'random', cheatLumps: 100,
    cheatCps: 1, cheatClick: 1, cheatFloorOn: false, cheatFloor: '1e15',
    enabled: true, tipSeen: false, seasonal: true, otherShimmers: true, seasonPop: false,
    panelX: null, panelY: null, minimized: false, openSecs: {},
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
    if (S.seasonal && S.seasonPop && Game.season === 'halloween') { if (a.length) popWrinklers(false); return; }   // wrinklers drop spooky cookies in Halloween
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
    if (!best) { status = 'Nothing worth buying right now'; return; }
    var reserve = bankTarget();
    var need = best.price + reserve - Game.cookies;
    info.wait = Math.max(need, 0) / Math.max(Game.cookiesPs, 0.1);
    if (need <= 0) {
      var bulk = (S.bulk > 1 && now() - reset.reincAt < 600000 && best.kind === 'building') ? S.bulk : 1;
      if (best.kind === 'building') best.ref.buy(bulk); else best.ref.buy();
      status = 'Bought ' + best.name;
    } else {
      if (S.wrinklerBuyPop && wrinklerValue() >= need) popWrinklers(true);
      status = 'Saving up for ' + best.name + ' (ready in ' + fmtTime(info.wait) + ')' + (reserve > 0 ? ', keeping ' + fmt(reserve) + ' spare' : '');
    }
  }

  /* ------------------------------------------------------------------ clicking */
  var clickAcc = 0, lastTick = now();
  function clickTick() {
    var t = now(), dt = (t - lastTick) / 1000; lastTick = t;
    if (!botActive() || !S.click || Game.OnAscend || Game.AscendTimer > 0) return;
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
        if (S.seasonal && S.reindeer) s.pop();
      } else if (S.seasonal && S.otherShimmers) {
        s.pop();                                       // any other kind of floating cookie the game adds
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

  function botActive() { return !!S.enabled && (S.mode !== 'cheat' || S.botInCheat); }

  /* ------------------------------------------------------------------ cheat mode */
  var ACH = 'Cheated cookies taste awful';
  function cheatOn() { return S.mode === 'cheat'; }

  // Cheating is remembered per save. Game.startDate is fixed for a save's whole life and changes on a wipe or when
  // a different save is loaded, so it identifies "this save".
  function saveKey() { return Game.startDate || null; }
  function forgetCheating(why) {
    var was = S.cheated || S.mode === 'cheat';
    S.cheated = false; S.saveId = null; S.mode = 'bot';
    Game.recalculateGains = 1;
    applyLayout();
    if (was) console.log('[Cookie-Clicker-Auto-Bot-Pro] Cheat state cleared: ' + why);
  }
  // While this save is loaded and has cheated, the shadow achievement is re-awarded whenever it is missing.
  function keepCheated() {
    if (!S.cheated) return;
    var A = Game.Achievements && Game.Achievements[ACH];
    if (A && !A.won) {
      Game.Win(ACH);
      try { if (Game.WriteSave) Game.WriteSave(); } catch (e) {}
    }
  }
  function parseAmt(str) {
    var m = String(str).trim().toLowerCase().replace(/,/g, '').match(/^([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*([a-z]*)$/);
    if (!m) return NaN;
    var mult = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, qa: 1e15, qi: 1e18, sx: 1e21, sp: 1e24, oc: 1e27, no: 1e30, dc: 1e33 }[m[2]];
    return mult === undefined ? NaN : parseFloat(m[1]) * mult;
  }
  function cheatMsg(t) {
    var el = panel && panel.querySelector('#abCheatMsg');
    if (el) el.textContent = t;
  }
  function cheatTick() {
    var key = saveKey();
    if (S.cheated) {
      if (S.saveId === null || S.saveId === undefined) S.saveId = key;               // adopt: older settings had no save id
      else if (key !== null && S.saveId !== key) forgetCheating('different or wiped save');
    }
    keepCheated();
    if (cheatOn() && S.cheatFloorOn) {
      var f = parseAmt(S.cheatFloor);
      if (f > 0 && Game.cookies < f) Game.cookies = f;
    }
  }
  function targetBuildings() {
    return S.cheatBld === 'all' ? Game.ObjectsById.slice() : [Game.Objects[S.cheatBld]].filter(Boolean);
  }
  function giveBuildings(o, n) {
    if (o.buyFree) o.buyFree(n);
    else { o.amount += n; o.bought = (o.bought || 0) + n; }
  }
  function quiet(fn) {                      // run fn without a notification for every achievement
    var keep = Game.Notify;
    Game.Notify = function () {};
    try { fn(); } finally { Game.Notify = keep; }
  }
  var SAFE_POOLS = { '': 1, cookie: 1, tech: 1 };
  function cheatAct(act, arg) {
    if (!cheatOn()) return;
    keepCheated();
    try {
      var n, M, c = 0;
      switch (act) {
        case 'addCookies': n = parseAmt(S.cheatAmt); if (!(n > 0)) return cheatMsg('Enter an amount like 5t or 1e15'); Game.Earn(n); cheatMsg('Added ' + fmt(n) + ' cookies'); break;
        case 'quick': n = parseAmt(arg); Game.Earn(n); cheatMsg('Added ' + fmt(n) + ' cookies'); break;
        case 'setCookies': n = parseAmt(S.cheatAmt); if (!(n >= 0)) return cheatMsg('Enter an amount like 5t or 1e15'); Game.cookies = n; cheatMsg('Bank set to ' + fmt(n)); break;
        case 'addBuildings': n = Math.floor(S.cheatBldN);
          targetBuildings().forEach(function (o) { giveBuildings(o, n); c++; });
          cheatMsg('Gave ' + n + ' to ' + c + ' building type(s)'); break;
        case 'setBuildings': n = Math.floor(S.cheatBldN);
          targetBuildings().forEach(function (o) {
            if (o.amount < n) giveBuildings(o, n - o.amount); else if (o.amount > n) o.sell(o.amount - n, 1);
            c++;
          });
          cheatMsg('Set ' + c + ' building type(s) to ' + n); break;
        case 'unlockUpgrades':
          Game.UpgradesById.forEach(function (u) { if (!u.bought && !u.unlocked && u.pool !== 'debug') { u.unlock(); c++; } });
          cheatMsg('Unlocked ' + c + ' upgrades'); break;
        case 'buyUpgrades':
          Game.UpgradesById.forEach(function (u) {
            if (u.bought || !u.unlocked || !(u.pool in SAFE_POOLS) || GRANDMA[u.name]) return;
            u.buy(1); c++;
          });
          cheatMsg('Bought ' + c + ' upgrades (skips Grandmapocalypse and toggles)'); break;
        case 'winAch':
          quiet(function () {
            Game.AchievementsById.forEach(function (a) { if (!a.won && a.pool !== 'shadow') { Game.Win(a.name); c++; } });
          });
          cheatMsg('Unlocked ' + c + ' achievements'); break;
        case 'seeds':
          M = Game.Objects['Farm'].minigame;
          if (!M) return cheatMsg('Garden not unlocked yet');
          M.plantsById.forEach(function (p) { if (M.unlockSeed(p)) c++; });
          cheatMsg('Unlocked ' + c + ' seeds'); break;
        case 'spawnGolden':
          var sh = new Game.shimmer('golden');
          if (S.cheatGc !== 'random') sh.force = S.cheatGc;
          cheatMsg('Spawned a golden cookie (' + S.cheatGc + ')'); break;
        case 'spawnReindeer': new Game.shimmer('reindeer'); cheatMsg('Spawned a reindeer'); break;
        case 'buff':
          if (arg === 'frenzy') Game.gainBuff('frenzy', 77, 7);
          else if (arg === 'click') Game.gainBuff('click frenzy', 13, 777);
          else if (arg === 'dragon') Game.gainBuff('dragonflight', 10, 1111);
          cheatMsg('Gave buff: ' + arg); break;
        case 'clearBuffs': for (var k in Game.buffs) Game.buffs[k].time = 0; cheatMsg('Cleared buffs'); break;
        case 'addLumps': n = Math.floor(S.cheatLumps); Game.lumps += n; if (Game.lumpsTotal !== undefined) Game.lumpsTotal += n; cheatMsg('Added ' + n + ' sugar lumps'); break;
        case 'mana':
          M = Game.Objects['Wizard tower'].minigame;
          if (!M) return cheatMsg('Wizard towers not unlocked yet');
          M.magic = M.magicM; cheatMsg('Mana refilled'); break;
      }
      Game.recalculateGains = 1;
    } catch (e) {
      cheatMsg('Failed: ' + (e && e.message ? e.message : e));
      console.error('[Cookie-Clicker-Auto-Bot-Pro] cheat ' + act, e);
    }
  }
  function setMode(m) {
    if (m === 'cheat' && !S.cheated) {
      var ok = true;
      try {
        ok = window.confirm('Switch to CHEAT mode?\n\nThis awards the "' + ACH + '" achievement on THIS save. It stays for as long as this save does, and it is gone if the save is wiped. Other saves are not affected.\n\nContinue?');
      } catch (e) {}
      if (!ok) return;
      S.cheated = true;
      S.saveId = saveKey();
    }
    S.mode = m;
    keepCheated();
    Game.recalculateGains = 1;
    applyLayout();
  }


  /* ------------------------------------------------------------------ loops */
  var lastRun = { stock: 0, garden: 0 };
  var lastErr = 0;
  function safe(name, fn) {
    try { fn(); }
    catch (e) {
      status = 'Error in ' + name + ': ' + (e && e.message ? e.message : e);
      if (now() - lastErr > 10000) { lastErr = now(); console.error('[' + NAME + '] ' + name, e); }
    }
  }
  function logic() {
    safe('cheat mode', cheatTick);
    if (!botActive()) { status = S.enabled ? 'Bot paused (cheat mode)' : 'Bot is switched off'; return; }
    safe('golden cookies', shimmerTick);
    safe('ascension', resetTick);
    if (resetting()) return;
    safe('Godzamok', godzTick);
    safe('spells', spellTick);
    safe('wrinklers', wrinklerTick);
    safe('sugar lumps', lumpTick);
    safe('Santa', santaTick);
    safe('Grandmapocalypse', apocalypseTick);
    safe('dragon', dragonTick);
    var t = now();
    if (t - lastRun.stock > 5000) { lastRun.stock = t; safe('stock market', stockTick); }
    if (t - lastRun.garden > 3000) { lastRun.garden = t; safe('garden', gardenTick); }
    if (S.buy) safe('auto-buy', autoBuy); else status = 'Auto-buy is off';
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
    ['fortune', 'bool', 'Fortune news'],
    ['h', 'Seasonal cookies'],
    ['seasonal', 'bool', 'Click seasonal cookies'],
    ['reindeer', 'bool', 'Christmas: reindeer'],
    ['otherShimmers', 'bool', 'Easter and others: floating cookies'],
    ['seasonPop', 'bool', 'Halloween: pop wrinklers for drops'],
    ['h', 'Buying'],
    ['buy', 'bool', 'Auto-buy'],
    ['bank', 'sel', 'Golden-cookie stash', [['none', 'None (spend it all)'], ['lucky', 'Lucky (small)'], ['frenzy', 'Lucky + Frenzy (large)'], ['chain', 'Cookie Chain (huge)']]],
    ['pasteMode', 'bool', 'Reverse buying order (advanced)'],
    ['blacklist', 'sel', 'Never buy', [['off', 'Nothing blocked'], ['safe', 'Grandma upgrades'], ['hardcore', 'All upgrades'], ['nobuild', 'All buildings']]],
    ['blacklistAuto', 'bool', 'Lift that block later on'],
    ['bulk', 'sel', 'Rebuild fast after ascending', [[1, 'Off'], [10, 'x10'], [100, 'x100']]],
    ['wizLimit', 'bool', 'Stop at max mana (Wizard Towers)'],
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
    ['fps', 'num', 'Game speed (advanced)', 10, 144],
    ['showTable', 'bool', 'Internal info table'],
    ['h', 'Cookies', 'cheat'],
    ['cheatAmt', 'text', 'Amount (5t, 1e15, 2qa)'],
    ['_c1', 'btns', '', [['Add cookies', 'addCookies'], ['Set bank', 'setCookies']]],
    ['_c2', 'btns', 'Quick add', [['1M', 'quick', '1e6'], ['1B', 'quick', '1e9'], ['1T', 'quick', '1e12'], ['1Qa', 'quick', '1e15'], ['1Qi', 'quick', '1e18']]],
    ['cheatFloorOn', 'bool', 'Keep bank topped up'],
    ['cheatFloor', 'text', 'Top-up amount'],
    ['h', 'Buildings', 'cheat'],
    ['cheatBld', 'sel', 'Building', null],
    ['cheatBldN', 'num', 'Amount', 1, 100000],
    ['_c3', 'btns', '', [['Add', 'addBuildings'], ['Set to amount', 'setBuildings']]],
    ['h', 'Unlocks', 'cheat'],
    ['_c4', 'btns', '', [['Unlock all upgrades', 'unlockUpgrades'], ['Buy all safe upgrades', 'buyUpgrades']]],
    ['_c5', 'btns', '', [['Unlock all achievements', 'winAch'], ['Unlock garden seeds', 'seeds']]],
    ['h', 'Golden & buffs', 'cheat'],
    ['cheatGc', 'sel', 'Golden effect', [['random', 'Random'], ['frenzy', 'Frenzy'], ['multiply cookies', 'Lucky'], ['click frenzy', 'Click frenzy'], ['building special', 'Building special'], ['dragonflight', 'Dragonflight'], ['dragon harvest', 'Dragon harvest'], ['cookie storm', 'Cookie storm'], ['blood frenzy', 'Elder frenzy'], ['ruin cookies', 'Ruin'], ['clot', 'Clot']]],
    ['_c6', 'btns', '', [['Spawn golden', 'spawnGolden'], ['Spawn reindeer', 'spawnReindeer']]],
    ['_c7', 'btns', 'Buffs', [['Frenzy x7', 'buff', 'frenzy'], ['Click x777', 'buff', 'click'], ['Dragonflight', 'buff', 'dragon'], ['Clear', 'clearBuffs']]],
    ['h', 'Multipliers', 'cheat'],
    ['cheatCps', 'num', 'CpS multiplier', 1, 1000000000],
    ['cheatClick', 'num', 'Click multiplier', 1, 1000000000],
    ['h', 'Misc', 'cheat'],
    ['cheatLumps', 'num', 'Sugar lumps', 1, 100000],
    ['_c8', 'btns', '', [['Add lumps', 'addLumps'], ['Refill mana', 'mana']]],
    ['botInCheat', 'bool', 'Keep the bot running in cheat mode']
  ];

  /* ------------------------------------------------------------------ friendly extras */
  var HELP = {
    click: "Clicks the big cookie for you.",
    clickSpeed: "How fast to click the big cookie. Faster is better, but it can slow down older computers.",
    clickFrenzy: "Clicks as fast as possible during Click Frenzy and Dragonflight, when each click is worth the most.",
    clickFrenzyRate: "Clicks per second used during Click Frenzy and Dragonflight (the game allows up to 250).",
    golden: "Clicks golden cookies the moment they appear.",
    wrath: "Also clicks red (wrath) golden cookies. Some of their effects are bad, so this is off by default.",
    seasonal: "Master switch for every seasonal cookie below. Turn it off to leave them all alone.",
    reindeer: "Clicks the reindeer that fly across the screen during Christmas.",
    otherShimmers: "Clicks any other floating cookie the game spawns, such as the Cookie Storm drops in Easter, so no seasonal cookie is missed.",
    fortune: "Clicks the news ticker whenever a fortune shows up.",
    buy: "Automatically buys whichever building or upgrade pays for itself fastest.",
    bank: "Cookies kept unspent so a golden cookie can pay out its full amount. None spends everything right away, which is fastest early in the game.",
    pasteMode: "Advanced: buys the least efficient things first. Almost nobody wants this.",
    blacklist: "Things the bot is never allowed to buy.",
    blacklistAuto: "Lifts the hardcore or no-buildings block once you have baked enough cookies.",
    bulk: "Right after you ascend, buys buildings in batches of 10 or 100 so you rebuild faster.",
    wizLimit: "Stops buying Wizard Towers once your mana bar is as big as it needs to be.",
    santa: "Levels up Santa automatically when you can afford it.",
    lumps: "Collects sugar lumps as soon as they are ripe.",
    wrinklers: "How to pop wrinklers, the worms that eat your cookies. Efficient waits until they are full.",
    wrinklerBuyPop: "Pops wrinklers when the cookies inside would let you afford the next purchase.",
    keepShiny: "Never pops shiny wrinklers, which can drop rare items.",
    seasonPop: "During Halloween, pops wrinklers as they appear because they drop spooky cookies. Works even if the wrinkler setting under Wrinklers is Off.",
    godz: "Sells cursors and farms during big click boosts so Godzamok gives a huge payout, then buys them back. Needs the spirit Godzamok in your pantheon.",
    godzCursors: "The most cursors to sell for the boost.",
    godzFarms: "The most farms to sell for the boost.",
    castHand: "Casts Force the Hand of Fate during a big production boost to get an extra golden cookie.",
    castConjure: "Casts Conjure Baked Goods when your mana is full.",
    castEdifice: "Casts Spontaneous Edifice when your mana is full.",
    castHaggler: "Casts Haggler's Charm when your mana is full.",
    ascend: "Ascends for you once you would gain enough heavenly chips.",
    ascendPct: "Ascend once the new chips would be this many percent of the chips you already have.",
    ascendMin: "Never ascend for fewer than this many new chips.",
    resetRoutine: "Before ascending: pops wrinklers, sells buildings and buys the Chocolate egg for extra cookies.",
    heavenlyBuy: "Spends heavenly chips on the cheapest available upgrades while you are ascended.",
    apocalypse: "Deliberately starts the Grandmapocalypse (angry grandmas), and can calm them again afterwards.",
    stock: "Buys stocks when they are cheap and sells them when they recover.",
    stockBuyPct: "Buy a stock once its price falls below this percent of its normal price.",
    stockSellPct: "Sell once the price rises above this percent of its normal price.",
    stockBudget: "How much of your spare cookies to spend on each purchase.",
    garden: "Unlock seeds plants a checkerboard so plants can mutate into new ones. Fill uses one seed everywhere.",
    gardenSeed: "The seed used by Fill with one seed.",
    dragonTrain: "Trains your dragon whenever you can afford the next level.",
    dragonPet: "Pets the dragon over and over, which can drop items.",
    dragonAura1: "The first dragon aura. Changing an aura can cost you a building.",
    dragonAura2: "The second dragon aura (needs a fully trained dragon).",
    format: "How big numbers are written.",
    graph: "What the little graph at the top shows.",
    fps: "Game speed. Experimental, so leave it alone unless you know why.",
    showTable: "Shows every possible purchase ranked by value.",
    cheatAmt: "Type a number such as 5t (trillion), 1e15 or 2qa (quadrillion).",
    cheatFloorOn: "Keeps your bank from ever dropping below the top-up amount.",
    cheatFloor: "The amount to keep in the bank.",
    cheatBld: "Which building the buttons below apply to.",
    cheatBldN: "How many buildings to add, or to set the building to.",
    cheatGc: "What the spawned golden cookie does when clicked.",
    cheatCps: "Multiplies your cookies per second. Only active in cheat mode.",
    cheatClick: "Multiplies the cookies you get per click. Only active in cheat mode.",
    cheatLumps: "How many sugar lumps to add.",
    botInCheat: "Lets the bot keep clicking and buying while you are in cheat mode."
  };
  var SUBS = { reindeer: 'seasonal', otherShimmers: 'seasonal', seasonPop: 'seasonal' };
  var WARN = {
    wrath: "Red cookies can take cookies away.",
    godz: "Temporarily sells lots of buildings.",
    dragonTrain: "Some levels sell buildings.",
    ascend: "Resets your progress and sells your buildings each time.",
    apocalypse: "Makes grandmas angry. Hard to undo."
  };
  var RISKY = {
    wrath: { on: function (v) { return v === true; }, msg: 'Red (wrath) golden cookies can have harmful effects, like losing cookies. Click them anyway?' },
    godz: { on: function (v) { return v === true; }, msg: 'Auto-Godzamok temporarily sells lots of cursors and farms, then buys them back. Turn it on?' },
    dragonTrain: { on: function (v) { return v === true; }, msg: 'Training the dragon can sacrifice (sell) buildings at some levels. Turn it on?' },
    ascend: { on: function (v) { return v === true; }, msg: 'Auto-ascend resets your progress and sells your buildings every time it ascends. Turn it on?' },
    apocalypse: { on: function (v) { return v !== 'off'; }, msg: 'This deliberately makes your grandmas angry (the Grandmapocalypse). It is hard to undo. Continue?' }
  };

  var PRESET_BASE = { enabled: true, click: true, clickSpeed: 'medium', clickFrenzy: true, golden: true, wrath: false, reindeer: true, fortune: true,
    buy: true, bank: 'none', blacklist: 'safe', wrinklers: 'off', seasonal: true, otherShimmers: true, seasonPop: false, lumps: true, santa: true, godz: false, ascend: false, dragonTrain: false,
    dragonPet: false, apocalypse: 'off', stock: false, garden: 'off', castHand: false, castConjure: false, castEdifice: false, castHaggler: false };
  function preset(extra) {
    var o = {}, k;
    for (k in PRESET_BASE) o[k] = PRESET_BASE[k];
    for (k in extra) o[k] = extra[k];
    return o;
  }
  var PRESETS = {
    safe: { label: 'Safe starter', set: preset({}) },
    balanced: { label: 'Balanced', set: preset({ clickSpeed: 'fast', wrinklers: 'efficient', reindeer: true, seasonPop: true, garden: 'unlock', castConjure: true }) },
    late: { label: 'Late game', set: preset({ clickSpeed: 'ultra', bank: 'lucky', wrinklers: 'efficient', reindeer: true, seasonPop: true, garden: 'unlock', stock: true, castConjure: true, castHand: true }) }
  };
  var noteTimer = null;
  function note(text) {
    var el = panel && panel.querySelector('#abNote');
    if (!el) return;
    el.textContent = text;
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { el.textContent = ''; }, 6000);
  }
  function applyPreset(name) {
    if (name === 'reset') {
      var go = true;
      try { go = window.confirm('Reset every bot setting to its default? Your panel position is kept.'); } catch (e) {}
      if (!go) return;
      var keep = { panelX: 1, panelY: 1, minimized: 1, openSecs: 1, tipSeen: 1 };
      keep.mode = 1; keep.cheated = 1; keep.saveId = 1;
      for (var d in DEFAULTS) if (!keep[d]) S[d] = JSON.parse(JSON.stringify(DEFAULTS[d]));
      note('All settings reset to their defaults');
    } else if (PRESETS[name]) {
      for (var k in PRESETS[name].set) S[k] = PRESETS[name].set[k];
      note('Applied preset: ' + PRESETS[name].label);
    }
    refreshControls(); applySettings();
  }
  function syncQuick() {
    if (!panel) return;
    panel.querySelectorAll('[data-q]').forEach(function (el) { el.classList.toggle('on', !!S[el.dataset.q]); });
    panel.querySelectorAll('[data-sub]').forEach(function (el) { el.classList.toggle('off', !S[el.dataset.sub]); });
    var ms = panel.querySelector('#abMasterState');
    if (ms) ms.textContent = S.enabled ? 'ON' : 'OFF';
    var dot = panel.querySelector('#abDot');
    if (dot) { dot.classList.toggle('on', botActive()); dot.title = botActive() ? 'Bot is running' : 'Bot is paused'; }
  }

  var CSS = [
    '#autoBakerPanel{--ac:#4aa3ff;--acrgb:74,163,255;--acl:#7cc4ff;--acp:#bfe0ff;position:fixed;z-index:100000;width:272px;background:linear-gradient(160deg,rgba(40,47,58,.97),rgba(24,28,35,.97));',
    'color:#d5dbe4;font:600 12.5px/1.35 Rajdhani,"Segoe UI",system-ui,sans-serif;letter-spacing:.2px;',
    'border:1px solid var(--ac);border-radius:10px;box-shadow:0 0 0 1px rgba(var(--acrgb),.15),0 0 22px rgba(var(--acrgb),.28),0 6px 24px rgba(0,0,0,.6)}',
    '#autoBakerPanel .abHead{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;cursor:move;touch-action:none;',
    'user-select:none;background:linear-gradient(180deg,#3d4756,#272e39);border-bottom:1px solid var(--ac);border-radius:9px 9px 0 0}',
    '#autoBakerPanel .abTitle{font:800 9px Orbitron,"Segoe UI",sans-serif;letter-spacing:.3px;white-space:nowrap;text-transform:uppercase;',
    'background:linear-gradient(90deg,var(--acp),var(--ac) 60%,var(--acl));-webkit-background-clip:text;background-clip:text;color:transparent;',
    'filter:drop-shadow(0 0 5px rgba(var(--acrgb),.55))}',
    '#autoBakerPanel .abVer{margin-left:6px;font:700 9px Orbitron,sans-serif;color:#7d8ba0;letter-spacing:.5px}',
    '#autoBakerPanel .abBtn{cursor:pointer;color:var(--acp);background:#2b333f;border:1px solid var(--ac);border-radius:5px;width:24px;height:20px;',
    'font-weight:800;line-height:17px;text-align:center;margin-left:10px;transition:all .15s}',
    '#autoBakerPanel .abBtn:hover{background:var(--ac);color:#0b1320;box-shadow:0 0 10px rgba(var(--acrgb),.8)}',
    '#autoBakerPanel .abBody{padding:8px;max-height:70vh;overflow:auto}',
    '#autoBakerPanel .abBody::-webkit-scrollbar{width:8px}',
    '#autoBakerPanel .abBody::-webkit-scrollbar-thumb{background:#4a5666;border-radius:4px}',
    '#autoBakerPanel .abBody::-webkit-scrollbar-thumb:hover{background:var(--ac)}',
    '#autoBakerPanel.abMin{width:auto;min-width:272px}',
    '#autoBakerPanel.abMin .abHead{border-bottom-color:transparent;border-radius:9px}',
    '#autoBakerPanel.abMin .abBody{display:none}',
    '#autoBakerPanel .abInfo{margin:0 0 8px;padding:6px 8px;background:rgba(10,14,20,.6);border:1px solid #38424f;border-left:3px solid var(--ac);border-radius:6px}',
    '#autoBakerPanel .abRow{display:flex;gap:8px;padding:1px 0}',
    '#autoBakerPanel .abLbl{flex:0 0 76px;font:700 10px Orbitron,"Segoe UI",sans-serif;letter-spacing:1px;text-transform:uppercase;color:#7d8ba0;padding-top:2px}',
    '#autoBakerPanel .abVal{flex:1;color:#eaf3ff;font-variant-numeric:tabular-nums;word-break:break-word}',
    '#autoBakerPanel details.abSect{margin:3px 0;border:1px solid #38424f;border-radius:6px;background:rgba(10,14,20,.35);overflow:hidden}',
    '#autoBakerPanel details.abSect[open]{border-color:var(--ac)}',
    '#autoBakerPanel summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:6px;padding:3px 8px;',
    'font:800 10.5px Orbitron,"Segoe UI",sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:var(--acp);',
    'background:linear-gradient(90deg,rgba(var(--acrgb),.16),transparent);user-select:none}',
    '#autoBakerPanel summary::-webkit-details-marker{display:none}',
    '#autoBakerPanel summary::before{content:"\\25B8";color:var(--ac);font-size:11px;width:10px}',
    '#autoBakerPanel details[open]>summary::before{content:"\\25BE"}',
    '#autoBakerPanel summary:hover{color:#fff;background:linear-gradient(90deg,rgba(var(--acrgb),.3),transparent)}',
    '#autoBakerPanel .abSecBody{padding:4px 9px 7px}',
    '#autoBakerPanel label{display:block;cursor:pointer;padding:1px 0}',
    '#autoBakerPanel label:hover{color:#fff}',
    '#autoBakerPanel input[type=checkbox]{accent-color:var(--ac);margin-right:4px}',
    '#autoBakerPanel input,#autoBakerPanel select{background:#161b22;color:#eaf3ff;border:1px solid #4a5666;border-radius:4px;',
    'font:600 12px Rajdhani,"Segoe UI",sans-serif;padding:1px 4px}',
    '#autoBakerPanel input:focus,#autoBakerPanel select:focus{outline:none;border-color:var(--ac);box-shadow:0 0 6px rgba(var(--acrgb),.6)}',
    '#autoBakerPanel table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}',
    '#autoBakerPanel th{color:#7d8ba0;font:700 9.5px Orbitron,sans-serif;letter-spacing:1px;text-transform:uppercase}',
    '#autoBakerPanel td,#autoBakerPanel th{padding:1px 3px}',
    '#autoBakerPanel tr:nth-child(even) td{background:rgba(255,255,255,.03)}',
    '#autoBakerPanel select{max-width:158px}',
    '#autoBakerPanel .abDot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#7d8ba0;margin-right:7px}',
    '#autoBakerPanel .abDot.on{background:#4ad07a;box-shadow:0 0 6px #4ad07a}',
    '#autoBakerPanel .abQuick{margin-bottom:6px;padding:6px 8px;border:1px solid #38424f;border-radius:6px;background:rgba(10,14,20,.35)}',
    '#autoBakerPanel .abMaster{display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;padding:3px 8px;margin-bottom:5px;',
    'border-radius:5px;border:1px solid var(--ac);background:rgba(var(--acrgb),.12);font:800 11px Orbitron,sans-serif;letter-spacing:1.2px;text-transform:uppercase;color:var(--acp)}',
    '#autoBakerPanel .abMaster.on{background:var(--ac);color:#0b1320}',
    '#autoBakerPanel .abChips{display:flex;gap:4px;margin-bottom:5px}',
    '#autoBakerPanel .abChip{flex:1;text-align:center;cursor:pointer;user-select:none;padding:2px 0;border:1px solid #4a5666;border-radius:12px;font:700 11px Rajdhani,sans-serif;color:#8d98a8;background:#161b22}',
    '#autoBakerPanel .abChip.on{border-color:var(--ac);color:var(--acp);background:rgba(var(--acrgb),.2)}',
    '#autoBakerPanel .abChip:hover{border-color:var(--ac)}',
    '#autoBakerPanel .abNote{min-height:14px;margin-top:3px;font-size:11.5px;color:#9fb3c8}',
    '#autoBakerPanel .abTip{margin-bottom:6px;padding:6px 8px;border:1px solid var(--ac);border-radius:6px;background:rgba(var(--acrgb),.10);font-size:12px;color:#e6eef8}',
    '#autoBakerPanel .abOk{margin-top:4px;cursor:pointer;color:var(--acp);background:rgba(var(--acrgb),.14);border:1px solid var(--ac);border-radius:5px;padding:2px 10px;font:700 11.5px Rajdhani,sans-serif}',
    '#autoBakerPanel .abOk:hover{background:var(--ac);color:#0b1320}',
    '#autoBakerPanel .abWarn{margin:0 0 3px 18px;font-size:11px;color:#e0b050}',
    '#autoBakerPanel .abSub{margin-left:16px}',
    '#autoBakerPanel .abSub.off{opacity:.45}',
    '#autoBakerPanel.abCheat{--ac:#ff4a4a;--acrgb:255,74,74;--acl:#ff8f8f;--acp:#ffc9c9;background:linear-gradient(160deg,rgba(56,38,40,.97),rgba(30,21,23,.97))}',
    '#autoBakerPanel.abCheat .abHead{background:linear-gradient(180deg,#5a3a3d,#2f2022)}',
    '#autoBakerPanel .abCheatOnly{display:none}',
    '#autoBakerPanel.abCheat .abCheatOnly{display:block}',
    '#autoBakerPanel.abCheat .abBotOnly{display:none}',
    '#autoBakerPanel .abModes{display:flex;margin-bottom:6px;border:1px solid var(--ac);border-radius:6px;overflow:hidden}',
    '#autoBakerPanel .abModes span{flex:1;text-align:center;padding:3px 0;cursor:pointer;user-select:none;background:rgba(10,14,20,.6);',
    'font:800 10px Orbitron,"Segoe UI",sans-serif;letter-spacing:1.2px;text-transform:uppercase;color:var(--acp);transition:background .15s}',
    '#autoBakerPanel .abModes span:hover{background:rgba(var(--acrgb),.25)}',
    '#autoBakerPanel .abModes span.on{background:var(--ac);color:#0b1320}',
    '#autoBakerPanel .abBanner{margin-bottom:6px;padding:4px 8px;border:1px solid var(--ac);border-left:3px solid var(--ac);border-radius:6px;background:rgba(var(--acrgb),.12);font-size:11.5px;color:var(--acp)}',
    '#autoBakerPanel .abBanner b{letter-spacing:1px;color:var(--ac)}',
    '#autoBakerPanel #abCheatMsg{color:#fff;min-height:14px}',
    '#autoBakerPanel .abBtns{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:3px 0}',
    '#autoBakerPanel .abBtnLbl{flex:0 0 100%;color:#7d8ba0;font:700 9.5px Orbitron,sans-serif;letter-spacing:1px;text-transform:uppercase}',
    '#autoBakerPanel .abAct{cursor:pointer;color:var(--acp);background:rgba(var(--acrgb),.14);border:1px solid var(--ac);border-radius:5px;',
    'padding:2px 8px;font:700 11.5px Rajdhani,"Segoe UI",sans-serif;transition:all .12s}',
    '#autoBakerPanel .abAct:hover{background:var(--ac);color:#0b1320;box-shadow:0 0 8px rgba(var(--acrgb),.7)}',
    '#autoBakerPanel .abAct:active{transform:translateY(1px)}'
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
    panel.classList.toggle('abCheat', cheatOn());
    panel.querySelectorAll('[data-mode]').forEach(function (el) { el.classList.toggle('on', el.dataset.mode === S.mode); });
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
    try {
      var fl = document.createElement('link');
      fl.rel = 'stylesheet';
      fl.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@700;800&family=Rajdhani:wght@500;600;700&display=swap';
      (document.head || document.body).appendChild(fl);
    } catch (e) {}

    panel = document.createElement('div');
    panel.id = 'autoBakerPanel';
    var html = '<div class="abHead" id="abHead"><span><span class="abDot" id="abDot" title="Bot is running"></span><span class="abTitle">' + NAME + '</span><span class="abVer">' + LABEL + '</span></span>' +
      '<span class="abBtn" id="abToggle" title="Minimize">–</span></div>' +
      '<div class="abBody" id="abBody">' +
      '<div class="abModes" id="abModes"><span data-mode="bot">Bot mode</span><span data-mode="cheat">Cheat mode</span></div>' +
      '<div class="abBanner abCheatOnly"><b>CHEAT MODE</b> · "Cheated cookies taste awful" unlocked<div id="abCheatMsg"></div></div>' +
      '<div class="abTip" id="abTip">' + TIP + '<br><button type="button" class="abOk" id="abTipOk">Got it</button></div>' +
      '<div class="abQuick abBotOnly">' +
      '<div class="abMaster" id="abMaster" data-q="enabled" title="Turn all automation on or off"><span>Bot</span><span id="abMasterState">ON</span></div>' +
      '<div class="abChips"><span class="abChip" data-q="buy" title="Auto-buy on or off">Buy</span><span class="abChip" data-q="click" title="Auto-click the big cookie on or off">Click</span><span class="abChip" data-q="golden" title="Golden cookies on or off">Golden</span><span class="abChip" data-q="seasonal" title="Seasonal cookies on or off">Seasonal</span></div>' +
      '<select id="abPreset" title="Apply a ready-made group of settings"><option value="">Presets...</option><option value="safe">Safe starter (recommended)</option><option value="balanced">Balanced</option><option value="late">Late game (everything on)</option><option value="reset">Reset all settings</option></select>' +
      '<div class="abNote" id="abNote"></div></div>' +
      '<div class="abInfo" id="abInfo"></div>' +
      '<canvas id="abGraph" width="254" height="52" style="width:254px;height:52px;display:block;margin-bottom:4px;background:rgba(10,14,20,.6);border:1px solid #38424f;border-radius:6px"></canvas>' +
      '<div id="abTable"></div>';
    var open = false;
    SCHEMA.forEach(function (r) {
      if (r[0] === 'h') {
        if (open) html += '</div></details>';
        html += '<details class="abSect ' + (r[2] === 'cheat' ? 'abCheatOnly' : 'abBotOnly') + '" data-sec="' + r[1] + '"><summary>' + r[1] + '</summary><div class="abSecBody">';
        open = true; return;
      }
      var k = r[0], t = r[1], label = r[2];
      var tip = HELP[k] ? ' title="' + HELP[k] + '"' : '';
      var sub = SUBS[k] ? ' class="abSub" data-sub="' + SUBS[k] + '"' : '';
      if (t === 'bool') html += '<label' + tip + sub + '><input type="checkbox" data-k="' + k + '"> ' + label + '</label>';
      else if (t === 'num') html += '<div' + tip + '>' + label + ' <input type="number" data-k="' + k + '" min="' + r[3] + '" max="' + r[4] + '" style="width:74px"></div>';
      else if (t === 'text') html += '<div' + tip + '>' + label + ' <input type="text" data-k="' + k + '" style="width:92px"></div>';
      else if (t === 'btns') html += '<div class="abBtns">' + (label ? '<span class="abBtnLbl">' + label + '</span>' : '') + r[3].map(function (b) {
        return '<button type="button" class="abAct" data-act="' + b[1] + '"' + (b[2] ? ' data-arg="' + b[2] + '"' : '') + '>' + b[0] + '</button>';
      }).join('') + '</div>';
      else {
        var opts = r[3] || [['all', 'All buildings']].concat(Game.ObjectsById.map(function (o) { return [o.name, o.name]; }));
        html += '<div' + tip + '>' + label + ' <select data-k="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></div>';
      }
      if (WARN[k]) html += '<div class="abWarn">&#9888; ' + WARN[k] + '</div>';
    });
    if (open) html += '</div></details>';
    html += '</div>';
    panel.innerHTML = html;
    document.body.appendChild(panel);
    infoEl = panel.querySelector('#abInfo'); tableEl = panel.querySelector('#abTable'); canvas = panel.querySelector('#abGraph');

    var types = {}; SCHEMA.forEach(function (r) { if (r[0] !== 'h') types[r[0]] = r; });
    panel.querySelectorAll('[data-k]').forEach(function (el) {
      el.addEventListener('change', function () {
        var k = el.dataset.k, r = types[k], v;
        if (r[1] === 'bool') v = el.checked;
        else if (r[1] === 'text') v = el.value;
        else if (r[1] === 'num') v = Math.min(r[4], Math.max(r[3], parseFloat(el.value) || DEFAULTS[k]));
        else v = isNaN(+el.value) ? el.value : +el.value;
        var risk = RISKY[k];
        if (risk && risk.on(v)) {
          var go = true;
          try { go = window.confirm(risk.msg); } catch (x) {}
          if (!go) { refreshControls(); return; }
        }
        S[k] = v; applySettings(); syncQuick();
      });
    });
    panel.querySelectorAll('details[data-sec]').forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (!S.openSecs) S.openSecs = {};
        S.openSecs[d.dataset.sec] = !!d.open;
      });
    });
    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var m = t.closest('[data-mode]');
      if (m) { setMode(m.dataset.mode); return; }
      var q = t.closest('[data-q]');
      if (q) { S[q.dataset.q] = !S[q.dataset.q]; refreshControls(); applySettings(); return; }
      if (t.closest('#abTipOk')) { S.tipSeen = true; refreshControls(); return; }
      var a = t.closest('[data-act]');
      if (a) cheatAct(a.dataset.act, a.dataset.arg);
    });
    panel.querySelector('#abPreset').addEventListener('change', function () {
      var v = this.value;
      this.value = '';
      if (v) applyPreset(v);
    });
    panel.querySelector('#abToggle').addEventListener('click', toggleMinimized);
    makeDraggable(panel.querySelector('#abHead'));
    window.addEventListener('resize', function () { clampPanel(); applyLayout(); });
    refreshControls();
  }
  function refreshControls() {
    if (!panel) return;
    panel.querySelectorAll('details[data-sec]').forEach(function (d) {
      d.open = !!(S.openSecs && S.openSecs[d.dataset.sec]);
    });
    panel.querySelectorAll('[data-k]').forEach(function (el) {
      var v = S[el.dataset.k];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    applyLayout();
    var tipEl = panel.querySelector('#abTip');
    if (tipEl) tipEl.style.display = S.tipSeen ? 'none' : '';
    syncQuick();
  }
  function applySettings() {
    if (S.fps >= 10 && Game.fps !== S.fps) Game.fps = S.fps;
    Game.recalculateGains = 1;
  }

  function line(a, b) { return '<div class="abRow"><span class="abLbl">' + a + '</span><span class="abVal">' + b + '</span></div>'; }
  function refreshInfo() {
    if (!infoEl) return;
    syncQuick();
    var h = line('Status', status);
    var b = info.best;
    if (b) {
      var pct = b.eff > 0 && isFinite(b.eff) ? '' : '';
      h += line('Next', b.name + ' for ' + fmt(b.price) + ' (+' + fmt(b.gain) + ' cps, pays back in ' + fmtTime(b.eff) + ')' + (info.wait > 0 ? ' · ready in ' + fmtTime(info.wait) : ''));
    }
    var bank = bankTarget();
    h += line('Cookies', fmt(Game.cookies) + (bank > 0 ? ' · keeping ' + fmt(bank) + ' spare' : ''));
    var gt = Game.shimmerTypes && Game.shimmerTypes.golden;
    if (gt) h += line('Golden', 'in ' + fmtTime((gt.minTime - gt.time) / Game.fps) + ' to ' + fmtTime((gt.maxTime - gt.time) / Game.fps));
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
    var SEASONS = { valentines: "Valentine's Day", fools: 'Business Day', halloween: 'Halloween', christmas: 'Christmas', easter: 'Easter' };
    if (Game.season && SEASONS[Game.season]) {
      var sh = Game.season === 'christmas' ? (S.reindeer ? 'reindeer are auto-clicked' : 'reindeer clicking is off')
        : Game.season === 'halloween' ? (S.seasonPop ? 'popping wrinklers for spooky cookies' : 'wrinklers drop spooky cookies')
        : Game.season === 'easter' ? (S.otherShimmers ? 'storm drops are auto-clicked' : 'storm drop clicking is off') : 'golden cookies are auto-clicked';
      h += line('Season', SEASONS[Game.season] + ' · ' + (S.seasonal || Game.season === 'valentines' || Game.season === 'fools' ? sh : 'seasonal clicking is off'));
    }
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
    var accent = cheatOn() ? '#ff4a4a' : '#4aa3ff';
    ctx.strokeStyle = accent; ctx.lineWidth = 1.8; ctx.shadowColor = accent; ctx.shadowBlur = 6; ctx.beginPath();
    vals.forEach(function (v, i) {
      var x = i / (vals.length - 1) * w, y = h - 4 - (v - lo) / (hi - lo) * (h - 8);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#9fb3c8'; ctx.font = '600 10px Rajdhani, sans-serif';
    ctx.fillText(key + ' (log) ' + fmt(hist[hist.length - 1][key]), 4, 10);
  }

  /* ------------------------------------------------------------------ register */
  function onKey(e) {
    if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
      if (Game.ExportSave) Game.ExportSave();
    }
  }

  Game.registerMod(MOD_ID, {
    init: function () {
      buildUI();
      applySettings();
      timers.push(setInterval(function () { try { clickTick(); } catch (e) { console.error('[' + NAME + ']', e); } }, 33));
      timers.push(setInterval(logic, 250));
      sample(); setTimeout(sample, 1500);
      timers.push(setInterval(sample, 5000));
      timers.push(setInterval(refreshInfo, 500));
      document.addEventListener('keydown', onKey);
      if (Game.registerHook) {
        Game.registerHook('cps', function (c) { return (cheatOn() && S.cheatCps > 1) ? c * S.cheatCps : c; });
        Game.registerHook('cookiesPerClick', function (c) { return (cheatOn() && S.cheatClick > 1) ? c * S.cheatClick : c; });
        Game.registerHook('reset', function (hard) { if (hard) forgetCheating('save wiped'); });
      }
      setTimeout(keepCheated, 2000);
      Game.Notify(NAME + ' ' + LABEL + ' is ready', 'The bot is on. Open a section to change settings, or pick a preset. Hover anything for help. Drag the title bar to move the panel.', [16, 5], 6);
    },
    save: function () { return JSON.stringify(S); },
    load: function (str) {
      S = JSON.parse(JSON.stringify(DEFAULTS));      // a loaded save brings its own settings; nothing carries over from the previous one
      try { var d = JSON.parse(str); for (var k in d) if (k in S) S[k] = d[k]; } catch (e) {}
      refreshControls(); applySettings();
      setTimeout(keepCheated, 500);
    }
  });
})();
