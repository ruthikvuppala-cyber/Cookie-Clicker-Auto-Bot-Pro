/* eslint-disable */
/* global Game, Beautify */
/* This is a standalone game mod, not app code: it is never imported by the app, so the app's lint
   rules (no-undef for the game's own globals, no-empty on the deliberate try/catch guards, the
   react-hooks heuristic on Game.Objects['Farm'].minigame.useTool) do not apply to it. */
/* Cookie-Clicker-Auto-Bot - a Frozen Cookies style automation + info mod for Cookie Clicker.
 *
 * v2.4
 *   FIXES
 *   - "buy as many as you can afford" no longer fires on every tick: it is now an opt-in setting
 *     that buys the largest affordable batch of the best building in one go.
 *   - bulk-buy after ascending now also works when the bot is loaded mid-run or reloaded after an
 *     ascension it did not perform (it used to require the bot itself to have reincarnated).
 *   - auto-buy no longer stops dead when the game's buy mode is set to x10 / x100; only "sell"
 *     mode blocks it, and purchases always pass an explicit count.
 *   - the "next heavenly chip" cache, the CPS history and the chip history are cleared on
 *     reincarnation, on save import and on mod load, so the smart-ascend maths never runs on
 *     samples from a previous run.
 *   - applying settings now actually recalculates the economy (the old call set a property that
 *     does nothing, so a fresh toggle could leave stale CPS numbers on screen for a second).
 *   - the golden-cookie countdown is clamped at zero instead of showing a dash for a tick.
 *   - the spell costs are guarded against game versions that lack getSpellCost.
 *   - the Google Fonts <link> is only added once, even if the mod is loaded twice in a page.
 *
 *   NEW
 *   - "Buy as many as you can afford" (Buying) and "Pop when this many are attached" (Wrinklers).
 *   - hotkeys G (golden cookies on/off) and B (auto-buy on/off) next to P / S / R / E.
 *   - the status line reports how many were bought in one batch.
 *
 * AUTOMATION
 *   Auto-buy (efficiency based, with Lucky / Lucky+Frenzy / Chain banks, Pastemode, blacklists)
 *   Auto-click: big cookie, Click Frenzy / Dragonflight boost, golden cookies, wrath cookies, reindeer, fortune ticker
 *   Auto-Godzamok: sells cursors + farms during Dragonflight / Click Frenzy, rebuys afterwards
 *   Auto spell casting: Conjure Baked Goods, Force the Hand of Fate, Spontaneous Edifice, Haggler's Charm
 *   Sugar lumps: auto harvest
 *   Wrinkler popping (efficient / instant, season aware, spends wrinklers on purchases)
 *   Auto Santa upgrades, Wizard Tower limit (keeps max mana at 100)
 *   Auto-ascend with reset routine (pop wrinklers, sell buildings, Chocolate egg) + bulk-buy after reincarnation
 *   Save backups: timed export to browser storage and/or a downloadable file, plus a backup before every auto-ascend
 *   Smart auto-ascend (ascends when the chip rate stops beating the run's average), season cycling, custom never-buy list
 *   Background-tab safe timers (Web Worker), hotkeys (P pause, S save, R wipe save, E export),
 *   copy / paste of bot settings
 * INFO
 *   Next purchase + efficiency %, bank targets, GC / Frenzy timers, Heavenly Chip projections,
 *   internal info table (every purchase with efficiency, cost, delta CPS), history graph,
 *   number formatting, press "e" to open the save export string.
 *   Session log (what the bot bought, popped, cast, harvested) with download, optional sound / notification
 *   for rare golden-cookie buffs.
 *
 * PERFORMANCE (2.4)
 *   - buy scan: one economy recalculation per candidate instead of two, cached for 1s (best item is still
 *     bought instantly from the cache), so the scan costs ~8x less CPU
 *   - info panel / log / graph: only redrawn when their text actually changes, at 1 Hz instead of 2 Hz
 *   - clicking: burst capped per frame + adaptive easing when clicks start eating the frame budget
 *   - ascension countdown: "cookies until next chip" cached for 5s (it is a big search)
 *   - panel: heaviest title glow removed (it repainted on every panel update)
 *
 * LAYOUT (2.4)
 *   Settings are grouped into 8 categories, each holding small sections of related options:
 *   Clicking, Buying, Seasons, Minigames, Creatures and resources, Ascension, Saves and settings, Display and tools.
 *
 * Load: paste into the browser console on the game page, or use it as a Steam mod (main.js + info.txt).
 */
(function () {
  'use strict';
  var NAME = 'Cookie-Clicker-Auto-Bot';
  var MOD_ID = 'autoBakerPlain';
  var TIP = 'Welcome! The bot is on: it clicks, buys and grabs golden cookies for you. Use the big switch to pause it, pick a preset, or open a section to fine-tune. Hover any setting for help.';
  if (typeof Game === 'undefined' || !Game.ready) { console.log('[' + NAME + '] Game not ready yet.'); return; }
  var VERSION = '2.4';
  var LABEL = 'v' + VERSION;
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
    buy: true, buyMax: false, bank: 'none', pasteMode: false,
    blacklist: 'safe', blacklistAuto: true,
    bulk: 1,
    wrinklers: 'off', wrinklerBuyPop: true, keepShiny: true, wrinklerCap: 10,
    lumps: true,
    santa: true, wizLimit: false,
    godz: false, godzCursors: 500, godzFarms: 500,
    castHand: false, castConjure: false, castEdifice: false, castHaggler: false,
    conjureBank: false,
    ascend: false, ascendMode: 'percent', ascendSmartMin: 30, ascendPct: 100, ascendMin: 1, resetRoutine: true, heavenlyBuy: false,
    backup: 'off', backupMin: 15, backupKeep: 3, backupAscend: true,
    notifyRare: 'off', logOn: true,
    customBlacklist: '', seasonSwitch: 'off', seasonMinutes: 20, seasonHome: 'none',
    bgProtect: true, hotkeys: true,
    stock: false, stockBuyPct: 50, stockSellPct: 100, stockBudget: 25,
    garden: 'off', gardenSeed: 'bakerWheat',
    dragonTrain: false, dragonPet: false, dragonAura1: 'none', dragonAura2: 'none',
    apocalypse: 'off',
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

  // Buffs worth a sound / notification (the rare golden-cookie outcomes).
  var RARE_BUFFS = { 'Click frenzy': 1, 'Dragonflight': 1, 'Elder frenzy': 1, 'Cookie storm': 1, 'Building special': 1, 'Everything must go': 1 };
  var LUMP_TYPES = ['normal', 'bifurcated', 'golden', 'meaty', 'caramelized'];
  var SEASON_ORDER = ['christmas', 'halloween', 'valentines', 'easter'];
  var SEASON_BISCUITS = { christmas: 'Festive biscuit', halloween: 'Ghostly biscuit', valentines: 'Lovesick biscuit', easter: 'Bunny biscuit', fools: "Fool's biscuit" };

  var status = 'Starting...';
  var info = { list: [], best: null, wait: 0 };
  var reset = { state: 'idle', t: 0, reincAt: 0 };
  var godz = { active: false, sold: {} };
  var hist = [];            // {t, cookies, cps, hc}
  var timers = [];
  var logList = [];         // {t, m}  session log
  var sess = { start: Date.now(), bought: 0, popped: 0, golden: 0, lumps: 0, casts: 0, backups: 0 };
  var seenBuffs = {};
  var bk = { last: Date.now() };
  var LS_IDX = 'abBackupIndex';
  var LS_SETTINGS = 'abBotSettings';   // bot settings, mirrored here every time the game saves
  var chipHist = [];        // {t, p}: pending heavenly chips over the last ~10 minutes (smart ascend)
  var seasonRun = { mode: 'off', idx: 0, since: 0, done: false };
  var hb = { worker: null, timer: null, mode: '', lastLogic: 0, lastBackup: 0 };
  var customBL = { src: null, map: {} };
  var stockPaid = {};       // good id -> average price per share the bot paid (cost basis)
  var evalCache = { t: 0 }; // when the buy list was last fully evaluated (perf: the scan is expensive)

  /* ------------------------------------------------------------------ helpers */
  function now() { return Date.now(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
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
  function logEvent(msg) {
    if (!S.logOn) return;
    logList.push({ t: now(), m: msg });
    if (logList.length > 500) logList.shift();
  }
  function customBlocked(name) {
    if (customBL.src !== S.customBlacklist) {
      customBL.src = S.customBlacklist; customBL.map = {};
      String(S.customBlacklist || '').split(',').forEach(function (n) { n = n.trim().toLowerCase(); if (n) customBL.map[n] = 1; });
    }
    return !!customBL.map[String(name).toLowerCase()];
  }
  var audioCtx = null;
  function beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.25);
    } catch (e) {}
  }
  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch (e) {} }, 1000);
    } catch (e) { console.error('[' + NAME + '] download failed', e); }
  }
  /* banks: cookies we refuse to spend so golden cookies pay out fully */
  function bankTarget() {
    var r = rawCps();
    if (S.bank === 'lucky') return r * 6000;        // Lucky! capped at 15 min of CPS => needs 6000 s of CPS
    if (S.bank === 'frenzy') return r * 6000 * 7;   // same, with a x7 Frenzy active
    if (S.bank === 'chain') return r * 21600 * 9;   // approximate max Cookie Chain payout
    return 0;
  }
  // True for the first 10 minutes of a run, whether the bot performed the ascension or not. Bulk buying
  // only makes sense while rebuilding, so this is what gates it now (it used to need the bot's own reset).
  function rebuilding() {
    var start = reset.reincAt || Game.startDate || 0;
    return start > 0 && now() - start < 600000;
  }
  // Everything that only makes sense inside one run: clear it when the run changes.
  function forgetRun() {
    hist = [];
    chipHist = [];
    nextChipCache.t = 0;
    evalCache.t = 0;
    info.best = null;
    seasonRun.idx = 0; seasonRun.since = 0; seasonRun.done = false;
  }

  /* ------------------------------------------------------------------ purchase evaluation */
  // One economy recalculation per candidate (the undo does not recalculate: CalculateGains is a full
  // recompute, so the next candidate's pass already rebuilds a clean state). candidates() restores it
  // once at the end. This is the single biggest CPU saving in the bot.
  function gainOf(base, apply, undo) {
    var g = base;
    try { apply(); Game.CalculateGains(); g = rawCps(); }
    finally { undo(); }
    return g - base;
  }
  function wizFull() {
    var M = Game.Objects['Wizard tower'].minigame;
    return !!(M && M.magicM >= 100);
  }
  function blocked(c) {
    if (customBlocked(c.name)) return true;
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
    var base = rawCps();
    Game.ObjectsById.forEach(function (o) {
      if (o.locked) return;
      var price = o.getPrice();
      var g = gainOf(base, function () { o.amount++; }, function () { o.amount--; });
      list.push({ kind: 'building', ref: o, name: o.name, price: price, gain: g });
    });
    Game.UpgradesInStore.forEach(function (u) {
      if (u.pool === 'toggle' || u.pool === 'debug') return;
      var price = u.getPrice();
      var g = gainOf(base, function () { u.bought = 1; }, function () { u.bought = 0; });
      list.push({ kind: 'upgrade', ref: u, name: u.name, price: price, gain: g });
    });
    Game.CalculateGains();                       // one restore for the whole scan
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
  // How many of this building we could buy right now and still leave the bank alone. The price of the
  // n-th extra copy grows by the game's 15% each time, which is exactly what getPrice() applies.
  function affordableCount(c, reserve) {
    if (c.kind !== 'building') return 1;
    var price = c.price, budget = Game.cookies - reserve, n = 0;
    while (n < 100 && budget >= price) { budget -= price; price *= 1.15; n++; }
    return n;
  }

  /* ------------------------------------------------------------------ wrinklers */
  function attached() { return Game.wrinklers.filter(function (w) { return w.phase === 2 && w.sucked > 0; }); }
  // Cookies that popping would return. Shiny wrinklers are left out when "keep shiny" is on, unless includeShiny is true.
  function wrinklerValue(includeShiny) {
    return attached().reduce(function (a, w) {
      if (!includeShiny && w.type === 1 && S.keepShiny) return a;
      return a + w.sucked * 1.1;
    }, 0);
  }
  function popWrinklers(includeShiny) {
    var list = Game.wrinklers.filter(function (w) {
      return w.phase === 2 && w.hp > 0 && !(w.type === 1 && !includeShiny && S.keepShiny);
    });
    if (!list.length) return;
    var v = 0;
    list.forEach(function (w) { v += w.sucked * 1.1; w.hp = 0; });
    sess.popped += list.length;
    logEvent('Popped ' + list.length + ' wrinkler' + (list.length > 1 ? 's' : '') + ' (~' + fmt(v) + ' cookies)');
  }
  function wrinklerTick() {
    var a = attached();
    if (S.apocalypse !== 'off') { if (a.length) popWrinklers(true); return; }   // Grandmapocalypse: pop everything, shinies too
    if (S.seasonal && S.seasonPop && Game.season === 'halloween') { if (a.length) popWrinklers(false); return; }   // wrinklers drop spooky cookies in Halloween
    if (S.wrinklers === 'off') return;
    if (!a.length) return;
    if (S.wrinklers === 'instant') { popWrinklers(false); return; }
    var max = Game.getWrinklersMax ? Game.getWrinklersMax() : 10;
    var cap = Math.min(max, Math.max(1, Math.round(S.wrinklerCap) || max));     // efficient mode: pop at this many
    if (Game.season === 'halloween') { popWrinklers(false); return; }   // season aware: Halloween cookie drops
    if (a.length >= cap) popWrinklers(false);                           // free the slots
  }

  /* ------------------------------------------------------------------ auto-buy */
  function autoBuy() {
    // Only "sell" mode stops the bot. Bulk modes (x10 / x100) are fine: every purchase below passes its
    // own explicit count, so the bot does not depend on the game's buy mode at all.
    if (Game.buyMode === 0 || resetting()) return;
    // While Godzamok has sold buildings for a boost, buying would just rebuy them straight away and undo the trick.
    if (godz.active) { status = 'Godzamok: holding purchases until the boost ends'; return; }
    // The scan touches every building and upgrade, so it runs once a second; the cached best item is
    // still bought the moment you can afford it, so buying stays instant.
    var t = now();
    if (!info.best || t - evalCache.t >= 1000) {
      evalCache.t = t;
      var list = candidates();
      info.list = list;
      info.best = pickBest(list);
    }
    var best = info.best;
    if (!best) { status = 'Nothing worth buying right now'; return; }
    var reserve = bankTarget();
    var need = best.price + reserve - Game.cookies;
    info.wait = Math.max(need, 0) / Math.max(Game.cookiesPs, 0.1);
    if (need <= 0) {
      var count = 1;
      if (best.kind === 'building') {
        if (rebuilding() && S.bulk > 1) count = S.bulk;
        if (S.buyMax) count = Math.max(count, affordableCount(best, reserve));
        count = Math.min(count, 100);
        best.ref.buy(count);
      } else {
        best.ref.buy();
      }
      status = 'Bought ' + best.name + (count > 1 ? ' x' + count : '');
      sess.bought += count;
      logEvent('Bought ' + best.name + (count > 1 ? ' x' + count : '') + ' for ' + fmt(best.price));
      info.best = null; evalCache.t = 0;             // prices and the store changed: rescan next tick
    } else {
      if (S.wrinklerBuyPop && wrinklerValue(false) >= need) popWrinklers(false);   // never spends shinies while "keep shiny" is on
      status = 'Saving up for ' + best.name + ' (ready in ' + fmtTime(info.wait) + ')' + (reserve > 0 ? ', keeping ' + fmt(reserve) + ' spare' : '');
    }
  }

  /* ------------------------------------------------------------------ clicking */
  var clickAcc = 0, lastTick = now(), clickCost = 0;
  function perfNow() { return (window.performance && window.performance.now) ? window.performance.now() : now(); }
  function clickTick() {
    var t = now(), dt = (t - lastTick) / 1000; lastTick = t;
    if (!botActive() || !S.click || Game.OnAscend || Game.AscendTimer > 0) return;
    var rate = SPEEDS[S.clickSpeed] || SPEEDS.medium;
    if (S.clickFrenzy && (hasBuff('Click frenzy') || hasBuff('Dragonflight') || hasBuff('Cursed finger'))) {
      rate = Math.max(rate, S.clickFrenzyRate);
    }
    // Adaptive easing: if clicking is eating the frame, slow the click rate instead of stuttering the game.
    if (clickCost > 2.5) rate = Math.max(10, rate * 2.5 / clickCost);
    clickAcc += Math.min(dt, 0.25) * rate;
    if (clickAcc > 10) clickAcc = 10;                 // never dump a huge burst into a single frame
    if (clickAcc < 1) return;
    var n = Math.min(Math.floor(clickAcc), 8);
    clickAcc -= n;
    var t0 = perfNow();
    for (var i = 0; i < n; i++) Game.ClickCookie();
    var cost = perfNow() - t0;
    clickCost = clickCost * 0.8 + cost * 0.2;         // smoothed cost per frame
  }
  function shimmerTick() {
    Game.shimmers.slice().forEach(function (s) {
      if (s.type === 'golden') {
        if (s.wrath && !S.wrath && S.apocalypse === 'off') return;
        if (S.golden) { s.pop(); sess.golden++; }
      } else if (s.type === 'reindeer') {
        if (S.seasonal && S.reindeer) { s.pop(); sess.golden++; }
      } else if (S.seasonal && S.otherShimmers) {
        { s.pop(); sess.golden++; }   // any other kind of floating cookie the game adds
      }
    });
    if (S.fortune && Game.TickerEffect && Game.TickerEffect.type === 'fortune' && Game.TickerClicked) {
      Game.TickerClicked();
    }
  }

  /* ------------------------------------------------------------------ buff watcher (rare alerts + log) */
  function rareAlert(name) {
    if (S.notifyRare === 'off') return;
    if (S.notifyRare === 'notify' || S.notifyRare === 'both') {
      try { Game.Notify('Rare golden cookie!', name + ' just started.', [10, 14], 8); } catch (e) {}
    }
    if (S.notifyRare === 'sound' || S.notifyRare === 'both') beep();
  }
  function buffWatch() {
    var cur = {};
    for (var k in Game.buffs) {
      cur[k] = true;
      if (!seenBuffs[k]) {
        seenBuffs[k] = true;
        var b = Game.buffs[k];
        logEvent('Buff started: ' + (b.name || k) + ' (' + fmtTime(b.time / Game.fps) + ')');
        if (RARE_BUFFS[k]) rareAlert(b.name || k);
      }
    }
    for (var s in seenBuffs) if (!cur[s]) delete seenBuffs[s];
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
      logEvent('Godzamok: sold ' + (godz.sold.Cursor || 0) + ' cursors and ' + (godz.sold.Farm || 0) + ' farms');
    } else if (!on && godz.active) {
      godz.active = false;
      if (S.buy) for (var name in godz.sold) {
        if (godz.sold[name] > 0) Game.Objects[name].buy(godz.sold[name]);
      }
      logEvent('Godzamok: bought buildings back');
      godz.sold = {};
    }
  }

  /* ------------------------------------------------------------------ spells */
  function spellTick() {
    if (!(S.castHand || S.castConjure || S.castEdifice || S.castHaggler)) return;
    var M = Game.Objects['Wizard tower'].minigame;
    if (!M || !M.spells) return;
    function sp(k) { return M.spells[k]; }
    // Not every game version exposes getSpellCost; without it the spell simply never looks affordable.
    function cost(k) { return (sp(k) && M.getSpellCost) ? M.getSpellCost(sp(k)) : Infinity; }
    function cast(k) {
      if (sp(k) && M.magic >= cost(k)) {
        M.castSpell(sp(k)); status = 'Cast ' + sp(k).name; sess.casts++;
        logEvent('Cast ' + sp(k).name);
        return true;
      }
      return false;
    }
    var full = M.magic >= M.magicM - 0.5;
    var reserve = S.castHand ? cost('hand of fate') : 0;
    var boosted = buffMult() >= 7 || hasBuff('Dragon Harvest');
    var goldenOnScreen = Game.shimmers.some(function (s) { return s.type === 'golden'; });
    var bankOK = !S.conjureBank || Game.cookies >= bankTarget();      // Conjure only while the golden-cookie bank is full
    if (S.castHand && boosted && !goldenOnScreen && cast('hand of fate')) return;
    if (S.castConjure && bankOK && (boosted || full) && M.magic >= cost('conjure baked goods') + reserve && cast('conjure baked goods')) return;
    if (S.castEdifice && full && M.magic >= cost('spontaneous edifice') + reserve && cast('spontaneous edifice')) return;
    if (S.castHaggler && full && M.magic >= cost("haggler's charm") + reserve && cast("haggler's charm")) return;
  }

  /* ------------------------------------------------------------------ misc automation */
  var lastLump = 0;
  function lumpTick() {
    if (!S.lumps || !Game.canLumps || !Game.canLumps()) return;
    if (now() - lastLump > 2000 && now() - Game.lumpT >= Game.lumpRipeAge) {
      lastLump = now();
      var type = LUMP_TYPES[Game.lumpCurrentType] || 'normal', before = Game.lumps;
      Game.clickLump();
      sess.lumps++;
      logEvent('Harvested a ' + type + ' sugar lump (' + before + ' before)');
    }
  }
  function santaTick() {
    if (!S.santa || resetting() || !Game.Has('A festive hat') || Game.santaLevel >= 14) return;
    var cost = Math.pow(Game.santaLevel + 1, Game.santaLevel + 1);
    if (Game.cookies >= cost + bankTarget()) { Game.UpgradeSanta(); logEvent('Santa upgraded to level ' + (Game.santaLevel)); }
  }

  /* ------------------------------------------------------------------ seasons */
  function switchSeason(name) {
    var u = Game.Upgrades[SEASON_BISCUITS[name]];
    if (!u || !u.canBuy || !u.canBuy() || buffMult() > 1.5) return false;     // price scales with CpS: never switch during a frenzy
    var price = u.getPrice();
    if (Game.cookies < price + bankTarget()) return false;
    u.buy(); status = 'Season: switched to ' + name;
    logEvent('Season switched to ' + name + ' for ' + fmt(price));
    return true;
  }
  // Cycles through every season, staying seasonMinutes in each so its cookies can drop, then moves to the chosen home season.
  function seasonTick() {
    if (S.seasonSwitch === 'off' || !Game.Has('Season switcher')) return;
    var r = seasonRun;
    if (r.mode !== S.seasonSwitch) { r.mode = S.seasonSwitch; r.idx = 0; r.since = 0; r.done = false; }
    if (r.done) return;
    var target = SEASON_ORDER[r.idx];
    if (Game.season !== target) { switchSeason(target); return; }
    if (!r.since) { r.since = now(); logEvent('Season: staying in ' + target + ' for ' + S.seasonMinutes + ' min'); }
    if (now() - r.since >= S.seasonMinutes * 60000) {
      r.idx++; r.since = 0;
      if (r.idx >= SEASON_ORDER.length) {
        r.done = true;
        logEvent('Season cycle finished');
        if (S.seasonHome !== 'none' && Game.season !== S.seasonHome) switchSeason(S.seasonHome);
      }
    }
  }

  /* ------------------------------------------------------------------ save backups */
  /* ------------------------------------------------------------------ settings persistence */
  function persistSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(S)); } catch (e) {}
  }
  // Autosave: every option change is written to browser storage straight away, so nothing is lost if the tab
  // dies before the game's next save. Writes are synchronous and tiny (a few KB of JSON).
  function autosaveSettings() { persistSettings(); }
  function restoreSettings() {
    try {
      var str = localStorage.getItem(LS_SETTINGS);
      if (!str) return;
      var d = JSON.parse(str);
      for (var k in d) if (k in S) S[k] = d[k];
    } catch (e) {}
  }

  function readIndex() {
    try { return JSON.parse(localStorage.getItem(LS_IDX) || '[]'); } catch (e) { return []; }
  }
  function writeIndex(idx) {
    try { localStorage.setItem(LS_IDX, JSON.stringify(idx)); } catch (e) {}
  }
  function backupNow(reason, mode) {
    mode = mode || S.backup;
    if (mode === 'off') return false;
    var str = null;
    try { str = Game.WriteSave(1); } catch (e) {}
    if (!str || typeof str !== 'string') { note('Backup failed: could not read the save'); return false; }
    bk.last = now();
    var d = new Date();
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    var where = [];
    if (mode === 'local' || mode === 'both') {
      var key = 'abBackup_' + stamp, idx = readIndex(), saved = false;
      var put = function () { localStorage.setItem(key, str); };
      try { put(); saved = true; }
      catch (e) {                                           // storage full: drop the oldest backup and retry once
        if (idx.length) {
          var o = idx.shift();
          try { localStorage.removeItem(o.k); } catch (x) {}
          try { put(); saved = true; } catch (x2) {}
        }
      }
      if (saved) {
        idx.push({ k: key, t: now(), r: reason });
        while (idx.length > Math.max(1, S.backupKeep)) {
          var old = idx.shift();
          try { localStorage.removeItem(old.k); } catch (x3) {}
        }
        writeIndex(idx);
        where.push('browser storage');
      }
    }
    if (mode === 'file' || mode === 'both') {
      download('CookieClicker-backup-' + stamp + '.txt', str);
      where.push('file');
    }
    if (!where.length) { note('Backup failed: browser storage is full or blocked'); return false; }
    sess.backups++;
    logEvent('Backup (' + reason + ') saved to ' + where.join(' + '));
    note('Backup saved to ' + where.join(' + '));
    return true;
  }
  function restoreBackup() {
    var idx = readIndex();
    if (!idx.length) { note('No local backups found'); return; }
    var last = idx[idx.length - 1], str = null;
    try { str = localStorage.getItem(last.k); } catch (e) {}
    if (!str) { note('Newest backup is missing'); return; }
    dialog({
      title: 'Restore backup?',
      msg: 'Replace your current game with the newest local backup (' + new Date(last.t).toLocaleString() + ')? Your current progress will be overwritten.',
      ok: 'Restore', cancel: 'Cancel',
      onOk: function () {
        logEvent('Restoring backup from ' + new Date(last.t).toLocaleString());
        try { (Game.ImportSaveCode || Game.LoadSave).call(Game, str); } catch (e) { note('Restore failed: ' + e.message); }
      }
    });
  }
  function backupTick() {
    if (S.backup === 'off' || Game.OnAscend) return;
    if (now() - bk.last >= Math.max(1, S.backupMin) * 60000) backupNow('timed');
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
  // Smart ascend: the best time to restart is when the run's chip income (last ~10 min) falls to its own average.
  function smartAscendReady(pend) {
    if (pend < Math.max(1, S.ascendMin)) return false;
    var runH = (now() - (Game.startDate || reset.reincAt || sess.start)) / 3600000;
    if (runH * 60 < S.ascendSmartMin || chipHist.length < 20) return false;
    var first = chipHist[0], last = chipHist[chipHist.length - 1], dtH = (last.t - first.t) / 3600000;
    if (dtH <= 0 || runH <= 0) return false;
    return (last.p - first.p) / dtH <= pend / runH;
  }
  function resetTick() {
    var t = now();
    switch (reset.state) {
      case 'idle':
        if (!S.ascend || Game.OnAscend) return;
        var pend = pendingChips();
        var ready = S.ascendMode === 'smart' ? smartAscendReady(pend) : (pend > 0 && pend >= Math.max(S.ascendMin, Game.prestige * S.ascendPct / 100));
        if (ready) {
          if (S.backup !== 'off' && S.backupAscend) backupNow('before ascend', 'local');
          logEvent('Ascending for +' + fmt(pend) + ' heavenly chips');
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
        Game.Reincarnate(true); reset.state = 'idle'; reset.reincAt = t;
        forgetRun();                                                 // every sample belongs to the old run
        stockPaid = {};                                              // the stock market starts over after an ascension
        logEvent('Reincarnated');
        break;
    }
  }

  /* ------------------------------------------------------------------ Grandmapocalypse */
  var APOC = ['One mind', 'Communal brainsweep', 'Elder Pact'];
  function tryBuyUpgrade(name) {
    var u = Game.Upgrades[name];
    if (u && !u.bought && u.unlocked && u.canBuy()) { u.buy(); status = 'Bought ' + name; logEvent('Bought ' + name); return true; }
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
      if (g.stock <= 0) delete stockPaid[g.id];
      if (g.stock > 0) {
        // Cost basis is what this bot actually paid. Without one (bought by hand or before loading) fall back to the resting price.
        var paid = stockPaid[g.id] || rest;
        var profitable = v >= paid * (1 + ovh) * 1.05;
        if (profitable && (v >= rest * S.stockSellPct / 100 || (falling && v >= paid * (1 + ovh) * 1.1))) {
          if (M.sellGood(g.id, 10000)) { delete stockPaid[g.id]; status = 'Sold ' + g.symbol + ' at ' + (Math.round(v * 100) / 100); logEvent(status); }
          return;
        }
      }
      if (v <= rest * S.stockBuyPct / 100 && !falling) {
        var unit = Game.cookiesPsRawHighest * v * (1 + ovh);
        var budget = Math.max(Game.cookies - bankTarget(), 0) * S.stockBudget / 100;
        var n = Math.floor(Math.min(M.getGoodMaxStock(g) - g.stock, budget / Math.max(unit, 1e-9)));
        if (n >= 1) {
          var before = g.stock;
          if (M.buyGood(g.id, n)) {
            stockPaid[g.id] = (((stockPaid[g.id] || v) * before) + v * n) / Math.max(before + n, 1);   // weighted average price
            status = 'Bought ' + n + ' ' + g.symbol; logEvent(status);
          }
        }
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
  // The game asks "are you sure?" when an aura changes. Accept it through whichever hook this game version offers.
  function acceptPrompt() {
    try {
      if (Game.ConfirmDragonAura) { Game.ConfirmDragonAura(); return; }
      if (Game.ConfirmPrompt) { Game.ConfirmPrompt(); return; }
      var yes = document.getElementById('promptOption0');
      if (yes) yes.click();
    } catch (e) {}
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
    acceptPrompt();
  }
  function dragonTick() {
    if (!(S.dragonTrain || S.dragonPet || S.dragonAura1 !== 'none' || S.dragonAura2 !== 'none')) return;
    if (!Game.Has('A crumbly egg') || !Game.dragonLevels || resetting()) return;
    if (S.dragonTrain && Game.dragonLevel < Game.dragonLevels.length - 1 && Game.dragonLevels[Game.dragonLevel].cost()) {
      Game.UpgradeDragon(); status = 'Trained dragon to level ' + Game.dragonLevel;
      logEvent(status);
    }
    setAura(S.dragonAura1, 0);
    setAura(S.dragonAura2, 1);
    if (S.dragonPet && Game.Has('Pet the dragon') && Game.ClickSpecialPic) {
      var tab = Game.specialTab;
      Game.specialTab = 'dragon';
      try { Game.ClickSpecialPic(); } finally { Game.specialTab = tab; }
    }
  }

  function botActive() { return !!S.enabled; }


  /* ------------------------------------------------------------------ loops */
  var lastRun = { stock: 0, garden: 0, season: 0 };
  var lastErr = 0;
  function safe(name, fn) {
    try { fn(); }
    catch (e) {
      status = 'Error in ' + name + ': ' + (e && e.message ? e.message : e);
      if (now() - lastErr > 10000) { lastErr = now(); console.error('[' + NAME + '] ' + name, e); }
    }
  }
  function logic() {
    if (!botActive()) { status = 'Bot is switched off'; return; }
    safe('golden cookies', shimmerTick);
    safe('buff watcher', buffWatch);
    safe('ascension', resetTick);
    if (resetting()) return;
    var t = now();
    safe('Godzamok', godzTick);
    safe('spells', spellTick);
    safe('wrinklers', wrinklerTick);
    safe('sugar lumps', lumpTick);
    safe('Santa', santaTick);
    safe('Grandmapocalypse', apocalypseTick);
    safe('dragon', dragonTick);
    if (t - lastRun.season > 10000) { lastRun.season = t; safe('seasons', seasonTick); }
    if (t - lastRun.stock > 5000) { lastRun.stock = t; safe('stock market', stockTick); }
    if (t - lastRun.garden > 3000) { lastRun.garden = t; safe('garden', gardenTick); }
    if (S.buy) safe('auto-buy', autoBuy); else status = 'Auto-buy is off';
  }
  function sample() {
    try {
      var pend = Game.HowMuchPrestige ? pendingChips() : 0;
      hist.push({ t: now(), cookies: Game.cookies, cps: rawCps(), hc: Game.prestige + Math.max(pend, 0) });
      if (hist.length > 360) hist.shift();
      chipHist.push({ t: now(), p: Math.max(pend, 0) });
      while (chipHist.length && now() - chipHist[0].t > 600000) chipHist.shift();
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ UI */
  var panel, tableEl, infoEl, canvas;
  var uiEls = null;                 // cached control nodes (perf: no querySelectorAll while refreshing)
  var lastInfoHtml = '', lastLogSig = '', lastGraphSig = '';
  var nextChipCache = { t: 0, v: 0 };

  // Every option lives in exactly one section ('h' rows start a section). CATS below groups the sections into categories.
  var SCHEMA = [
    /* ---- Clicking ---- */
    ['h', 'Big cookie'],
    ['click', 'bool', 'Auto-click cookie'],
    ['clickSpeed', 'sel', 'Click speed', [['slow', 'Slow (5/s)'], ['medium', 'Medium (25/s)'], ['fast', 'Fast (100/s)'], ['ultra', 'Ultra fast (250/s)']]],
    ['clickFrenzy', 'bool', 'Boost during Click Frenzy / Dragonflight'],
    ['clickFrenzyRate', 'num', 'Boosted rate (/s)', 1, 250],
    ['h', 'Golden cookies and news'],
    ['golden', 'bool', 'Golden cookies'],
    ['wrath', 'bool', 'Wrath cookies'],
    ['fortune', 'bool', 'Fortune news'],

    /* ---- Buying ---- */
    ['h', 'Auto-buy'],
    ['buy', 'bool', 'Auto-buy'],
    ['buyMax', 'bool', 'Buy as many as you can afford'],
    ['bank', 'sel', 'Golden-cookie stash', [['none', 'None (spend it all)'], ['lucky', 'Lucky (small)'], ['frenzy', 'Lucky + Frenzy (large)'], ['chain', 'Cookie Chain (huge)']]],
    ['pasteMode', 'bool', 'Reverse buying order (advanced)'],
    ['h', 'Never buy'],
    ['blacklist', 'sel', 'Never buy', [['off', 'Nothing blocked'], ['safe', 'Grandma upgrades'], ['hardcore', 'All upgrades'], ['nobuild', 'All buildings']]],
    ['blacklistAuto', 'bool', 'Lift that block later on'],
    ['customBlacklist', 'txt', 'Also never buy (names, comma separated)'],

    /* ---- Seasons ---- */
    ['h', 'Seasonal cookies'],
    ['seasonal', 'bool', 'Click seasonal cookies'],
    ['reindeer', 'bool', 'Christmas: reindeer'],
    ['otherShimmers', 'bool', 'Easter and others: floating cookies'],
    ['seasonPop', 'bool', 'Halloween: pop wrinklers for drops'],
    ['h', 'Season cycling'],
    ['seasonSwitch', 'sel', 'Season cycling', [['off', 'Off'], ['cycle', 'Cycle through all seasons']]],
    ['seasonMinutes', 'num', 'Minutes in each season', 5, 240],
    ['seasonHome', 'sel', 'Finish in', [['none', 'Stay in the last one'], ['christmas', 'Christmas'], ['halloween', 'Halloween'], ['valentines', "Valentine's Day"], ['easter', 'Easter'], ['fools', 'Business Day']]],
    ['h', 'Santa'],
    ['santa', 'bool', 'Auto Santa upgrades'],

    /* ---- Minigames ---- */
    ['h', 'Spells'],
    ['castHand', 'bool', 'Force the Hand of Fate'],
    ['castConjure', 'bool', 'Conjure Baked Goods'],
    ['conjureBank', 'bool', 'Conjure only when the stash is full'],
    ['castEdifice', 'bool', 'Spontaneous Edifice'],
    ['castHaggler', 'bool', "Haggler's Charm"],
    ['wizLimit', 'bool', 'Stop at max mana (Wizard Towers)'],
    ['h', 'Godzamok'],
    ['godz', 'bool', 'Auto-Godzamok'],
    ['godzCursors', 'num', 'Cursor limit', 0, 9999],
    ['godzFarms', 'num', 'Farm limit', 0, 9999],
    ['h', 'Stock market'],
    ['stock', 'bool', 'Auto-trade stocks'],
    ['stockBuyPct', 'num', 'Buy below % of resting price', 1, 100],
    ['stockSellPct', 'num', 'Sell above % of resting price', 50, 500],
    ['stockBudget', 'num', '% of spare cookies per buy', 1, 100],
    ['h', 'Garden'],
    ['garden', 'sel', 'Auto-garden', [['off', 'Off'], ['unlock', 'Unlock seeds (checkerboard)'], ['fill', 'Fill with one seed']]],
    ['gardenSeed', 'sel', 'Seed for "fill"', [['bakerWheat', "Baker's wheat"], ['thumbcorn', 'Thumbcorn'], ['cronerice', 'Cronerice'], ['gildmillet', 'Gildmillet'], ['clover', 'Ordinary clover'], ['goldenClover', 'Golden clover'], ['whiskerbloom', 'Whiskerbloom'], ['chimerose', 'Chimerose']]],

    /* ---- Creatures and resources ---- */
    ['h', 'Wrinklers'],
    ['wrinklers', 'sel', 'Popping', [['off', 'Off'], ['efficient', 'Efficient'], ['instant', 'Instant']]],
    ['wrinklerCap', 'num', 'Pop when this many are attached', 1, 10],
    ['wrinklerBuyPop', 'bool', 'Pop to afford purchases'],
    ['keepShiny', 'bool', 'Keep shiny wrinklers'],
    ['h', 'Sugar lumps'],
    ['lumps', 'bool', 'Harvest sugar lumps'],
    ['h', 'Dragon'],
    ['dragonTrain', 'bool', 'Train dragon (sacrifices buildings!)'],
    ['dragonPet', 'bool', 'Pet the dragon'],
    ['dragonAura1', 'sel', 'Aura 1', [['none', 'Leave alone'], ['Radiant Appetite', 'Radiant Appetite'], ['Dragonflight', 'Dragonflight'], ['Elder Battalion', 'Elder Battalion'], ['Epoch Changer', 'Epoch Changer'], ['Breath of Milk', 'Breath of Milk'], ['Mind Over Matter', 'Mind Over Matter'], ['Reality Bending', 'Reality Bending'], ['Dragon Orbs', 'Dragon Orbs'], ["Dragon's Fortune", "Dragon's Fortune"], ['Master of the Armory', 'Master of the Armory']]],
    ['dragonAura2', 'sel', 'Aura 2', [['none', 'Leave alone'], ['Radiant Appetite', 'Radiant Appetite'], ['Dragonflight', 'Dragonflight'], ['Elder Battalion', 'Elder Battalion'], ['Epoch Changer', 'Epoch Changer'], ['Breath of Milk', 'Breath of Milk'], ['Mind Over Matter', 'Mind Over Matter'], ['Reality Bending', 'Reality Bending'], ['Dragon Orbs', 'Dragon Orbs'], ["Dragon's Fortune", "Dragon's Fortune"], ['Master of the Armory', 'Master of the Armory']]],
    ['h', 'Grandmapocalypse'],
    ['apocalypse', 'sel', 'Run the apocalypse', [['off', 'Off (avoid it)'], ['full', 'Full (all stages)'], ['pacify', 'Full, then pacify']]],

    /* ---- Ascension ---- */
    ['h', 'Auto-ascend'],
    ['ascend', 'bool', 'Auto-ascend'],
    ['ascendMode', 'sel', 'Ascend when', [['percent', 'Chips gained reach a %'], ['smart', 'Chip rate stops improving (smart)']]],
    ['ascendSmartMin', 'num', 'Smart: minimum run (minutes)', 1, 1440],
    ['ascendPct', 'num', 'Ascend at +% more chips', 0, 100000],
    ['ascendMin', 'num', 'Minimum new chips', 1, 1e12],
    ['h', 'Reset and rebuild'],
    ['resetRoutine', 'bool', 'Reset routine (pop, sell, egg)'],
    ['heavenlyBuy', 'bool', 'Buy heavenly upgrades'],
    ['bulk', 'sel', 'Rebuild fast after ascending', [[1, 'Off'], [10, 'x10'], [100, 'x100']]],

    /* ---- Saves and settings ---- */
    ['h', 'Backups'],
    ['backup', 'sel', 'Save backups', [['off', 'Off'], ['local', 'Browser storage'], ['file', 'Download a file'], ['both', 'Both']]],
    ['backupMin', 'num', 'Every N minutes', 1, 1440],
    ['backupKeep', 'num', 'Browser backups to keep', 1, 10],
    ['backupAscend', 'bool', 'Also back up before auto-ascending'],
    ['_bkNow', 'btn', 'Back up now', 'backup'],
    ['_bkRestore', 'btn', 'Restore newest browser backup', 'restore'],
    ['h', 'Save files'],
    ['_saveExp', 'btn', 'Export save to a file', 'saveexport'],
    ['_saveImp', 'btn', 'Import a save (paste or file)', 'saveimport'],
    ['h', 'Bot settings'],
    ['_setExp', 'btn', 'Copy bot settings', 'setexport'],
    ['_setImp', 'btn', 'Paste bot settings', 'setimport'],

    /* ---- Display and tools ---- */
    ['h', 'Display'],
    ['format', 'sel', 'Numbers', [['short', 'Short'], ['sci', 'Scientific'], ['raw', 'Raw']]],
    ['graph', 'sel', 'Graph', [['cps', 'CPS'], ['cookies', 'Cookies'], ['hc', 'Heavenly chips']]],
    ['showTable', 'bool', 'Internal info table'],
    ['h', 'Alerts'],
    ['notifyRare', 'sel', 'Rare golden cookie alert', [['off', 'Off'], ['notify', 'Notification'], ['sound', 'Sound'], ['both', 'Notification + sound']]],
    ['h', 'Session log'],
    ['logOn', 'bool', 'Keep a session log'],
    ['_logDl', 'btn', 'Download log', 'logdl'],
    ['_logClear', 'btn', 'Clear log', 'logclear'],
    ['_log', 'log'],
    ['h', 'Controls'],
    ['hotkeys', 'bool', 'Hotkeys: P pause, S save, R wipe save, G golden, B buy'],
    ['bgProtect', 'bool', 'Keep working in background tabs'],
    ['fps', 'num', 'Game speed (advanced)', 10, 144],
  ];
  var SCHEMA_TYPES = {};
  SCHEMA.forEach(function (r) { if (r[0] !== 'h') SCHEMA_TYPES[r[0]] = r; });

  // Categories: each groups related sections of the schema above. Sections not listed here are shown after the categories.
  var CATS = [
    ['Clicking', ['Big cookie', 'Golden cookies and news']],
    ['Buying', ['Auto-buy', 'Never buy']],
    ['Seasons', ['Seasonal cookies', 'Season cycling', 'Santa']],
    ['Minigames', ['Spells', 'Godzamok', 'Stock market', 'Garden']],
    ['Creatures and resources', ['Wrinklers', 'Sugar lumps', 'Dragon', 'Grandmapocalypse']],
    ['Ascension', ['Auto-ascend', 'Reset and rebuild']],
    ['Saves and settings', ['Backups', 'Save files', 'Bot settings']],
    ['Display and tools', ['Display', 'Alerts', 'Session log', 'Controls']]
  ];

  /* ------------------------------------------------------------------ friendly extras */
  var HELP = {
    click: "Clicks the big cookie for you.",
    clickSpeed: "How fast to click the big cookie. Faster is better, but it can slow down older computers.",
    clickFrenzy: "Clicks as fast as possible during Click Frenzy and Dragonflight, when each click is worth the most.",
    clickFrenzyRate: "Clicks per second used during Click Frenzy and Dragonflight (the game allows up to 250).",
    golden: "Clicks golden cookies the moment they appear.",
    wrath: "Also clicks red (wrath) golden cookies. Some of their effects are bad, so this is off by default.",
    seasonal: "Master switch for the seasonal cookie options below. Turn it off to leave them all alone.",
    reindeer: "Clicks the reindeer that fly across the screen during Christmas.",
    otherShimmers: "Clicks any other floating cookie the game spawns, such as the Cookie Storm drops in Easter, so no seasonal cookie is missed.",
    fortune: "Clicks the news ticker whenever a fortune shows up.",
    buy: "Automatically buys whichever building or upgrade pays for itself fastest.",
    buyMax: "Buys the largest batch of the best building you can afford in one go, instead of one at a time. Never dips into the golden-cookie stash. Handy while rebuilding, but it can spend a lot in a single tick.",
    bank: "Cookies kept unspent so a golden cookie can pay out its full amount. None spends everything right away, which is fastest early in the game.",
    pasteMode: "Advanced: buys the least efficient things first. Almost nobody wants this.",
    blacklist: "Things the bot is never allowed to buy.",
    blacklistAuto: "Lifts the hardcore or no-buildings block once you have baked enough cookies.",
    bulk: "Right after you ascend, buys buildings in batches of 10 or 100 so you rebuild faster. Also applies when you reload the bot during the first ten minutes of a run.",
    wizLimit: "Stops buying Wizard Towers once your mana bar is as big as it needs to be.",
    santa: "Levels up Santa automatically when you can afford it.",
    lumps: "Collects sugar lumps as soon as they are ripe. The game rolls the lump type (normal, bifurcated, golden, meaty, caramelized) by itself, so it cannot be chosen; the log records which kind you got.",
    wrinklers: "How to pop wrinklers, the worms that eat your cookies. Efficient waits until you have as many as the number below.",
    wrinklerCap: "Efficient mode pops everything once this many wrinklers are attached. Ten is the maximum the game allows.",
    wrinklerBuyPop: "Pops wrinklers when the cookies inside would let you afford the next purchase.",
    keepShiny: "Never pops shiny wrinklers, which can drop rare items.",
    seasonPop: "During Halloween, pops wrinklers as they appear because they drop spooky cookies. Works even if the wrinkler setting under Wrinklers is Off.",
    godz: "Sells cursors and farms during big click boosts so Godzamok gives a huge payout, then buys them back. Needs the spirit Godzamok in your pantheon.",
    godzCursors: "The most cursors to sell for the boost.",
    godzFarms: "The most farms to sell for the boost.",
    castHand: "Casts Force the Hand of Fate during a big production boost to get an extra golden cookie. It can backfire, as the spell sometimes spawns a bad one.",
    castConjure: "Casts Conjure Baked Goods when your mana is full, or during a boost.",
    conjureBank: "Only casts Conjure Baked Goods while your cookies are at or above the golden-cookie stash target (needs a stash other than None).",
    castEdifice: "Casts Spontaneous Edifice when your mana is full.",
    castHaggler: "Casts Haggler's Charm when your mana is full.",
    ascend: "Ascends for you once you would gain enough heavenly chips.",
    ascendPct: "Ascend once the new chips would be this many percent of the chips you already have.",
    ascendMin: "Never ascend for fewer than this many new chips.",
    resetRoutine: "Before ascending: pops wrinklers, sells buildings and buys the Chocolate egg for extra cookies.",
    heavenlyBuy: "Spends heavenly chips on the cheapest available upgrades while you are ascended.",
    backup: "Exports your save on a timer. Browser storage keeps the last few copies inside this browser; Download saves a text file each time (your browser may ask to allow multiple downloads).",
    backupMin: "Minutes between automatic backups.",
    backupKeep: "How many backups to keep in browser storage. The oldest are deleted first.",
    backupAscend: "Makes an extra browser-storage backup right before each automatic ascension.",
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
    notifyRare: "Plays a beep and/or shows a game notification when a rare golden-cookie buff starts: Click Frenzy, Dragonflight, Elder Frenzy, Cookie Storm, Building Special or Everything Must Go. Browsers only allow sound after you have clicked on the page once.",
    logOn: "Records what the bot bought, popped, cast, harvested and backed up this session (kept in memory, cleared when you reload).",
    customBlacklist: "Exact names of buildings or upgrades the bot must never buy, separated by commas. Not case sensitive.",
    ascendMode: "Percent ascends once the chips you would gain reach the percentage below. Smart ascends when the chips earned in the last ten minutes fall to the run's own average rate, which is the best moment to restart.",
    ascendSmartMin: "Smart mode never ascends before the run has lasted this many minutes.",
    seasonSwitch: "Needs the Season switcher heavenly upgrade. Buys the season biscuits in turn so every season's cookies can drop. Never switches during a frenzy, because the price scales with your CpS.",
    seasonMinutes: "How long to stay in each season before moving to the next.",
    seasonHome: "The season to move to once the cycle is finished.",
    hotkeys: "P pauses or resumes the bot, S saves the game, R wipes your save (after a warning), G switches golden-cookie clicking, B switches auto-buy. E always opens the export string. Ignored while you type in a box.",
    bgProtect: "Runs the bot's timers in a Web Worker so clicking and golden cookies keep working at full speed while the tab is hidden.",
    format: "How big numbers are written.",
    graph: "What the little graph at the top shows.",
    fps: "Game speed. Experimental, so leave it alone unless you know why.",
    showTable: "Shows every possible purchase ranked by value.",
  };
  var SUBS = { reindeer: 'seasonal', otherShimmers: 'seasonal', seasonPop: 'seasonal' };
  var WARN = {
    wrath: "Red cookies can take cookies away.",
    godz: "Temporarily sells lots of buildings.",
    castHand: "Can occasionally spawn a bad golden cookie.",
    dragonTrain: "Some levels sell buildings.",
    ascend: "Resets your progress and sells your buildings each time.",
    apocalypse: "Makes grandmas angry. Hard to undo."
  };
  var RISKY = {
    wrath: { on: function (v) { return v === true; }, title: 'Wrath cookies', msg: 'Red (wrath) golden cookies can have harmful effects, like losing cookies. Click them anyway?' },
    godz: { on: function (v) { return v === true; }, title: 'Auto-Godzamok', msg: 'Auto-Godzamok temporarily sells lots of cursors and farms, then buys them back. Turn it on?' },
    dragonTrain: { on: function (v) { return v === true; }, title: 'Train dragon', msg: 'Training the dragon can sacrifice (sell) buildings at some levels. Turn it on?' },
    ascend: { on: function (v) { return v === true; }, title: 'Auto-ascend', msg: 'Auto-ascend resets your progress and sells your buildings every time it ascends. Turn it on?' },
    apocalypse: { on: function (v) { return v !== 'off'; }, title: 'Grandmapocalypse', msg: 'This deliberately makes your grandmas angry (the Grandmapocalypse). It is hard to undo. Continue?' }
  };

  var PRESET_BASE = { enabled: true, click: true, clickSpeed: 'medium', clickFrenzy: true, golden: true, wrath: false, reindeer: true, fortune: true,
    buy: true, buyMax: false, bank: 'none', blacklist: 'safe', wrinklers: 'off', seasonal: true, otherShimmers: true, seasonPop: false, lumps: true, santa: true, godz: false, ascend: false, dragonTrain: false,
    dragonPet: false, apocalypse: 'off', stock: false, garden: 'off', castHand: false, castConjure: false, castEdifice: false, castHaggler: false,
    conjureBank: false, backup: 'off', notifyRare: 'off' };
  function preset(extra) {
    var o = {}, k;
    for (k in PRESET_BASE) o[k] = PRESET_BASE[k];
    for (k in extra) o[k] = extra[k];
    return o;
  }
  var PRESETS = {
    safe: { label: 'Safe starter', set: preset({}) },
    balanced: { label: 'Balanced', set: preset({ clickSpeed: 'fast', wrinklers: 'efficient', reindeer: true, seasonPop: true, garden: 'unlock', castConjure: true, backup: 'local' }) },
    late: { label: 'Late game', set: preset({ clickSpeed: 'ultra', bank: 'lucky', wrinklers: 'efficient', reindeer: true, seasonPop: true, garden: 'unlock', stock: true, castConjure: true, castHand: true, conjureBank: true, backup: 'local', notifyRare: 'notify' }) }
  };
  var noteTimer = null;
  function note(text) {
    var el = panel && panel.querySelector('#abNote');
    if (!el) return;
    el.textContent = text;
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { el.textContent = ''; }, 6000);
  }

  /* ------------------------------------------------------------------ warning dialogs (replace the browser's white confirm / prompt boxes) */
  var dlgEl = null;
  function closeDialog() {
    if (dlgEl && dlgEl.parentNode) dlgEl.parentNode.removeChild(dlgEl);
    dlgEl = null;
  }
  // o: { title, msg, input (show a text box), value, select (preselect the text), ok, cancel, noCancel, onOk(value), onCancel() }
  function dialog(o) {
    if (!panel) return;
    closeDialog();
    var wrap = document.createElement('div');
    wrap.className = 'abDlgBack';
    wrap.innerHTML = '<div class="abDlg" role="alertdialog" aria-modal="true">' +
      '<div class="abDlgHead">&#9888; ' + esc(o.title || 'Warning') + '</div>' +
      '<div class="abDlgMsg">' + esc(o.msg || '') + '</div>' +
      (o.input ? '<div class="abDlgIn"><textarea class="abDlgText" rows="4" spellcheck="false"></textarea></div>' : '') +
      (o.file ? '<div class="abDlgIn"><input type="file" class="abDlgFile" accept=".txt,text/plain"><div class="abDlgHint">…or choose a save file</div></div>' : '') +
      '<div class="abDlgBtns">' +
      (o.noCancel ? '' : '<button type="button" class="abDlgBtn" data-d="no">' + esc(o.cancel || 'Cancel') + '</button>') +
      '<button type="button" class="abDlgBtn abDlgGo" data-d="yes">' + esc(o.ok || 'OK') + '</button>' +
      '</div></div>';
    panel.appendChild(wrap);
    dlgEl = wrap;
    var ta = wrap.querySelector('textarea');
    if (ta) {
      ta.value = o.value || '';
      setTimeout(function () { try { ta.focus(); if (o.select) ta.select(); } catch (e) {} }, 0);
    }
    var fi = wrap.querySelector('.abDlgFile');
    if (fi && ta) fi.addEventListener('change', function () {
      var f = fi.files && fi.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { ta.value = String(fr.result || '').trim(); };
      fr.readAsText(f);
    });
    wrap.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-d]') : null;
      if (!b) return;
      var yes = b.dataset.d === 'yes', val = ta ? ta.value : null;
      closeDialog();
      if (yes) { if (o.onOk) o.onOk(val); }
      else if (o.onCancel) o.onCancel();
    });
  }

  function stampNow() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  function exportSaveFile() {
    var str = null;
    try { str = Game.WriteSave(1); } catch (e) {}
    if (!str || typeof str !== 'string') { note('Export failed: could not read the save'); return; }
    download('CookieClicker-save-' + stampNow() + '.txt', str);
    note('Save exported to a file');
    logEvent('Save exported to a file');
  }
  function loadSaveString(str) {
    str = String(str || '').trim();
    if (!str) { note('Nothing to import'); return; }
    var fn = Game.ImportSaveCode || Game.ImportSave || Game.LoadSave;   // the importer is named differently across versions
    if (typeof fn !== 'function') { note('This game version has no save importer'); return; }
    try {
      fn.call(Game, str);
      forgetRun();                                                      // the imported save is a different run
      logEvent('Imported a save');
      toast(NAME, 'Save imported');
    } catch (e) { note('Import failed: ' + (e && e.message ? e.message : e)); }
  }
  function importSaveDialog() {
    dialog({
      title: 'Import a save',
      msg: 'Paste a save string below, or choose a .txt save file. This replaces your current game — export a backup first if you might want it back.',
      input: true, file: true, ok: 'Import save', cancel: 'Cancel',
      onOk: loadSaveString
    });
  }

  function wipeSave() {
    dialog({
      title: 'Wipe your save?',
      msg: 'WARNING: this deletes ALL game progress — cookies, buildings, upgrades, achievements, prestige and heavenly chips. Your bot settings are left alone. Export a save first if you might want it back.',
      ok: 'Wipe save', cancel: 'Cancel',
      onOk: function () {
        if (typeof Game.HardReset !== 'function') { toast(NAME, 'Wipe not available'); return; }
        Game.HardReset(true);                       // true: skip the game's own prompt, we just asked
        forgetRun();
        logEvent('Save wiped (hotkey)');
        toast(NAME, 'Save wiped');
      }
    });
  }

  function applyPreset(name) {
    if (name === 'reset') {
      dialog({
        title: 'Reset all bot settings?',
        msg: 'WARNING: this resets ALL bot settings (auto-buy, ascension, backups, blacklists and everything else) to their defaults. Your game progress and save are not touched.',
        ok: 'Reset settings', cancel: 'Cancel',
        onOk: function () {
          var keep = { panelX: 1, panelY: 1, minimized: 1, openSecs: 1, tipSeen: 1 };
          for (var d in DEFAULTS) if (!keep[d]) S[d] = JSON.parse(JSON.stringify(DEFAULTS[d]));
          note('All settings reset to their defaults');
          refreshControls(); applySettings();
        }
      });
      return;
    }
    if (PRESETS[name]) {
      for (var k in PRESETS[name].set) S[k] = PRESETS[name].set[k];
      note('Applied preset: ' + PRESETS[name].label);
    }
    refreshControls(); applySettings();
  }
  function syncQuick() {
    if (!panel || !uiEls) return;
    uiEls.q.forEach(function (el) { el.classList.toggle('on', !!S[el.dataset.q]); });
    uiEls.sub.forEach(function (el) { el.classList.toggle('off', !S[el.dataset.sub]); });
    if (uiEls.ms) uiEls.ms.textContent = S.enabled ? 'ON' : 'OFF';
    if (uiEls.dot) uiEls.dot.classList.toggle('on', botActive());
    if (uiEls.master) uiEls.master.classList.toggle('on', !!S.enabled);
  }

  var CSS = [
    '#autoBakerPanel{--ac:#4aa3ff;--acrgb:74,163,255;--acl:#7cc4ff;--acp:#bfe0ff;--rd:#ff5a5a;--rdrgb:255,90,90;--rdp:#ffc4c4;position:fixed;z-index:100000;width:246px;max-width:calc(100vw - 12px);background:linear-gradient(160deg,rgba(40,47,58,.97),rgba(24,28,35,.97));',
    'color:#d5dbe4;font:600 12.5px/1.35 Rajdhani,"Segoe UI",system-ui,sans-serif;letter-spacing:.2px;',
    'border:1px solid var(--ac);border-radius:10px;box-shadow:0 0 0 1px rgba(var(--acrgb),.15),0 0 14px rgba(var(--acrgb),.2),0 6px 18px rgba(0,0,0,.55)}',
    '#autoBakerPanel .abHead{display:flex;align-items:center;justify-content:space-between;padding:5px 8px;cursor:move;touch-action:none;',
    'user-select:none;background:linear-gradient(180deg,#3d4756,#272e39);border-bottom:1px solid var(--ac);border-radius:9px 9px 0 0}',
    '#autoBakerPanel .abTitle{font:800 9px Orbitron,"Segoe UI",sans-serif;letter-spacing:.3px;white-space:nowrap;text-transform:uppercase;',
    'background:linear-gradient(90deg,var(--acp),var(--ac) 60%,var(--acl));-webkit-background-clip:text;background-clip:text;color:transparent}',
    '#autoBakerPanel .abVer{margin-left:6px;font:700 9px Orbitron,sans-serif;color:#7d8ba0;letter-spacing:.5px}',
    '#autoBakerPanel .abBtn{cursor:pointer;color:var(--acp);background:#2b333f;border:1px solid var(--ac);border-radius:5px;width:24px;height:20px;',
    'font-weight:800;line-height:17px;text-align:center;margin-left:10px;transition:all .15s}',
    '#autoBakerPanel .abBtn:hover{background:var(--ac);color:#0b1320}',
    '#autoBakerPanel .abBody{padding:6px;max-height:68vh;overflow:auto;overscroll-behavior:contain}',
    '#autoBakerPanel .abBody::-webkit-scrollbar{width:8px}',
    '#autoBakerPanel .abBody::-webkit-scrollbar-thumb{background:#4a5666;border-radius:4px}',
    '#autoBakerPanel .abBody::-webkit-scrollbar-thumb:hover{background:var(--ac)}',
    '#autoBakerPanel.abMin{width:auto;min-width:0;max-width:calc(100vw - 12px)}',
    /* narrow windows: shrink the panel so it still fits next to the game */
    '#autoBakerPanel.abNarrow{width:186px;font-size:11px}',
    '#autoBakerPanel.abNarrow .abBody{padding:6px;max-height:60vh}',
    '#autoBakerPanel.abNarrow .abInfo{padding:5px 6px}',
    '#autoBakerPanel.abNarrow .abLbl{flex:0 0 56px;font-size:9px;letter-spacing:.5px}',
    '#autoBakerPanel.abNarrow .abVal{font-size:11px}',
    '#autoBakerPanel.abNarrow summary{font-size:9.5px;letter-spacing:1px;padding:3px 6px}',
    '#autoBakerPanel.abNarrow details.abCat>summary{font-size:10.5px;letter-spacing:1.2px}',
    '#autoBakerPanel.abNarrow .abChip{font-size:10px}',
    '#autoBakerPanel.abNarrow .abTitle{font-size:8px}',
    '#autoBakerPanel.abNarrow select{max-width:104px}',
    '#autoBakerPanel.abNarrow input[type=number]{width:54px!important}',
    '#autoBakerPanel.abNarrow canvas{width:100%!important}',
    '#autoBakerPanel.abNarrow .abDlg{width:100%}',
    '#autoBakerPanel.abMin .abHead{border-bottom-color:transparent;border-radius:9px}',
    '#autoBakerPanel.abMin .abBody{display:none}',
    '#autoBakerPanel .abInfo{margin:0 0 5px;padding:4px 6px;background:rgba(10,14,20,.6);border:1px solid #38424f;border-left:3px solid var(--ac);border-radius:5px}',
    '#autoBakerPanel .abRow{display:flex;gap:6px;padding:0}',
    '#autoBakerPanel .abLbl{flex:0 0 62px;font:700 9px Orbitron,"Segoe UI",sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#7d8ba0;padding-top:2px}',
    '#autoBakerPanel .abVal{flex:1;min-width:0;color:#eaf3ff;font-size:11.5px;line-height:1.3;font-variant-numeric:tabular-nums;word-break:break-word}',
    '#autoBakerPanel details.abSect{margin:2px 0;border:1px solid #38424f;border-radius:6px;background:rgba(10,14,20,.35);overflow:hidden}',
    '#autoBakerPanel details.abSect[open]{border-color:var(--ac)}',
    '#autoBakerPanel details.abCat{margin:4px 0;border:1px solid #4a5666;border-radius:8px;background:rgba(10,14,20,.25);overflow:hidden}',
    '#autoBakerPanel details.abCat[open]{border-color:var(--ac)}',
    '#autoBakerPanel details.abCat>summary{padding:5px 9px;font-size:11.5px;letter-spacing:1.6px;background:linear-gradient(90deg,rgba(var(--acrgb),.3),transparent)}',
    '#autoBakerPanel .abCatBody{padding:1px 3px 3px}',
    '#autoBakerPanel summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:5px;padding:2px 6px;',
    'font:800 10px Orbitron,"Segoe UI",sans-serif;letter-spacing:1.2px;text-transform:uppercase;color:var(--acp);',
    'background:linear-gradient(90deg,rgba(var(--acrgb),.16),transparent);user-select:none}',
    '#autoBakerPanel summary::-webkit-details-marker{display:none}',
    '#autoBakerPanel summary::before{content:"\\25B8";color:var(--ac);font-size:11px;width:10px}',
    '#autoBakerPanel details[open]>summary::before{content:"\\25BE"}',
    '#autoBakerPanel summary:hover{color:#fff;background:linear-gradient(90deg,rgba(var(--acrgb),.3),transparent)}',
    '#autoBakerPanel .abSecBody{padding:3px 7px 5px}',
    '#autoBakerPanel label{display:block;cursor:pointer;padding:0}',
    '#autoBakerPanel label:hover{color:#fff}',
    '#autoBakerPanel input[type=checkbox]{accent-color:var(--ac);margin-right:4px}',
    '#autoBakerPanel input,#autoBakerPanel select,#autoBakerPanel textarea{background:#161b22;color:#eaf3ff;border:1px solid #4a5666;border-radius:4px;',
    'font:600 12px Rajdhani,"Segoe UI",sans-serif;padding:1px 4px}',
    '#autoBakerPanel input:focus,#autoBakerPanel select:focus{outline:none;border-color:var(--ac)}',
    '#autoBakerPanel table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}',
    '#autoBakerPanel th{color:#7d8ba0;font:700 9.5px Orbitron,sans-serif;letter-spacing:1px;text-transform:uppercase}',
    '#autoBakerPanel td,#autoBakerPanel th{padding:1px 3px}',
    '#autoBakerPanel tr:nth-child(even) td{background:rgba(255,255,255,.03)}',
    '#autoBakerPanel select{max-width:142px}',
    '#autoBakerPanel .abDot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#7d8ba0;margin-right:7px}',
    '#autoBakerPanel .abDot.on{background:#4ad07a}',
    '#autoBakerPanel .abQuick{margin-bottom:5px;padding:5px 6px;border:1px solid #38424f;border-radius:5px;background:rgba(10,14,20,.35)}',
    '#autoBakerPanel .abMaster{display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;padding:3px 8px;margin-bottom:5px;',
    'border-radius:5px;border:1px solid var(--ac);background:rgba(var(--acrgb),.12);font:800 11px Orbitron,sans-serif;letter-spacing:1.2px;text-transform:uppercase;color:var(--acp)}',
    '#autoBakerPanel .abMaster.on{background:var(--ac);color:#0b1320}',
    '#autoBakerPanel .abChips{display:flex;gap:3px;margin-bottom:4px}',
    '#autoBakerPanel .abChip{flex:1;text-align:center;cursor:pointer;user-select:none;padding:2px 0;border:1px solid #4a5666;border-radius:12px;font:700 11px Rajdhani,sans-serif;color:#8d98a8;background:#161b22}',
    '#autoBakerPanel .abChip.on{border-color:var(--ac);color:var(--acp);background:rgba(var(--acrgb),.2)}',
    '#autoBakerPanel .abChip:hover{border-color:var(--ac)}',
    '#autoBakerPanel .abNote{min-height:14px;margin-top:3px;font-size:11.5px;color:#9fb3c8}',
    '#autoBakerPanel .abTip{margin-bottom:4px;padding:4px 6px;border:1px solid var(--ac);border-radius:6px;background:rgba(var(--acrgb),.10);font-size:12px;color:#e6eef8}',
    '#autoBakerPanel .abOk{margin-top:4px;cursor:pointer;color:var(--acp);background:rgba(var(--acrgb),.14);border:1px solid var(--ac);border-radius:5px;padding:2px 10px;font:700 11.5px Rajdhani,sans-serif}',
    '#autoBakerPanel .abOk:hover{background:var(--ac);color:#0b1320}',
    /* inline warnings: small red boxes in the same style as the rest of the panel */
    '#autoBakerPanel .abWarn{margin:1px 0 4px 16px;padding:3px 7px;font-size:11px;color:var(--rdp);background:rgba(var(--rdrgb),.12);',
    'border:1px solid var(--rd);border-left:3px solid var(--rd);border-radius:5px}',
    '#autoBakerPanel .abSub{margin-left:16px}',
    '#autoBakerPanel .abSub.off{opacity:.45}',
    '#autoBakerPanel .abLog{margin-top:4px;max-height:130px;overflow:auto;padding:4px 6px;background:rgba(10,14,20,.6);border:1px solid #38424f;border-radius:5px;font-size:11px;color:#c3cfdd;word-break:break-word}',
    '#autoBakerPanel .abLog div{padding:1px 0}',
    '#autoBakerPanel .abLog .abT{color:#7d8ba0;margin-right:4px}',
    /* warning dialog: replaces the browser confirm / prompt boxes */
    '#autoBakerPanel .abDlgBack{position:fixed;left:0;top:0;right:0;bottom:0;z-index:100001;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(0,0,0,.55)}',
    '#autoBakerPanel .abDlg{width:300px;max-width:100%;color:#f3d6d6;background:linear-gradient(160deg,rgba(62,30,34,.98),rgba(32,17,20,.98));',
    'border:1px solid var(--rd);border-radius:10px;box-shadow:0 0 0 1px rgba(var(--rdrgb),.18),0 0 18px rgba(var(--rdrgb),.28),0 6px 20px rgba(0,0,0,.6)}',
    '#autoBakerPanel .abDlgHead{padding:8px 10px;font:800 10.5px Orbitron,"Segoe UI",sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:var(--rdp);',
    'background:linear-gradient(180deg,#5c2a2f,#3a1c20);border-bottom:1px solid var(--rd);border-radius:9px 9px 0 0}',
    '#autoBakerPanel .abDlgMsg{padding:10px 10px 8px;font-size:12.5px;white-space:pre-wrap;word-break:break-word}',
    '#autoBakerPanel .abDlgIn{padding:0 10px 8px}',
    '#autoBakerPanel .abDlgFile{display:block;width:100%;box-sizing:border-box;color:#ffe9e9;background:#1a0f11;border:1px solid #7a3a40;border-radius:4px;padding:2px;font:600 11.5px Rajdhani,sans-serif}',
    '#autoBakerPanel .abDlgHint{margin-top:3px;font-size:11px;color:#b58a8f}',
    '#autoBakerPanel .abDlgText{display:block;width:100%;box-sizing:border-box;resize:vertical;color:#ffe9e9;background:#1a0f11;border:1px solid #7a3a40}',
    '#autoBakerPanel .abDlgText:focus{outline:none;border-color:var(--rd)}',
    '#autoBakerPanel .abDlgBtns{display:flex;gap:6px;justify-content:flex-end;padding:0 10px 10px}',
    '#autoBakerPanel .abDlgBtn{cursor:pointer;color:var(--rdp);background:rgba(var(--rdrgb),.12);border:1px solid var(--rd);border-radius:5px;padding:2px 12px;font:700 11.5px Rajdhani,sans-serif}',
    '#autoBakerPanel .abDlgBtn:hover{background:rgba(var(--rdrgb),.3);color:#fff}',
    '#autoBakerPanel .abDlgGo{background:var(--rd);color:#2a0b0d}',
    '#autoBakerPanel .abDlgGo:hover{background:#ff7a7a;color:#1a0507}',
  ].join('');

  // The graph follows the panel's real width, so it never spills out in a narrow window.
  function sizeGraph() {
    if (!canvas || !canvas.parentNode) return;
    var w = Math.max(140, canvas.parentNode.clientWidth - 2);
    canvas.style.width = '100%';
    if (canvas.width !== w) { canvas.width = w; lastGraphSig = ''; }
  }
  function clampPanel() {
    if (!panel || S.panelX === null) return;
    var maxX = Math.max(0, window.innerWidth - panel.offsetWidth), maxY = Math.max(0, window.innerHeight - panel.offsetHeight);
    S.panelX = Math.min(Math.max(0, S.panelX), maxX);
    S.panelY = Math.min(Math.max(0, S.panelY), maxY);
  }
  function applyLayout() {
    if (!panel) return;
    panel.classList.toggle('abMin', !!S.minimized);
    panel.classList.toggle('abNarrow', window.innerWidth < 560);   // compact layout on narrow windows
    sizeGraph();
    var btn = panel.querySelector('#abToggle');
    if (btn) { btn.textContent = S.minimized ? '+' : '–'; btn.title = S.minimized ? 'Restore' : 'Minimize'; }
    if (S.panelX === null) { panel.style.left = '8px'; panel.style.bottom = '8px'; panel.style.top = 'auto'; }
    else { clampPanel(); panel.style.left = S.panelX + 'px'; panel.style.top = S.panelY + 'px'; panel.style.bottom = 'auto'; }
  }
  function toggleMinimized() { S.minimized = !S.minimized; applyLayout(); autosaveSettings(); }

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
      autosaveSettings();                        // the panel was moved: save the new spot
    }
    head.addEventListener('pointerup', stop);
    head.addEventListener('pointercancel', stop);
    head.addEventListener('dblclick', function (e) { if (e.target.id !== 'abToggle') toggleMinimized(); });
  }

  function logText() {
    return logList.map(function (e) {
      var d = new Date(e.t);
      return '[' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '] ' + e.m;
    }).join('\n');
  }
  var SETTINGS_SKIP = { panelX: 1, panelY: 1, minimized: 1, openSecs: 1, tipSeen: 1, enabled: 1 };
  function exportSettings() {
    var o = {};
    for (var k in S) if (!SETTINGS_SKIP[k]) o[k] = S[k];
    var str = 'ABOT2:' + btoa(unescape(encodeURIComponent(JSON.stringify(o))));
    function fallback() {
      dialog({ title: 'Copy bot settings', msg: 'Copy this string and keep it somewhere safe. Use "Paste bot settings" to load it again.', input: true, value: str, select: true, ok: 'Done', noCancel: true });
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(str).then(function () { note('Settings copied to the clipboard'); }, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }
  function importSettings() {
    dialog({
      title: 'Paste bot settings', msg: 'Paste a bot settings string below, then press Import.', input: true, ok: 'Import', cancel: 'Cancel',
      onOk: function (str) { if (str && str.trim()) applyImport(str); }
    });
  }
  function applyImport(str) {
    var imp;
    try {
      str = str.trim();
      if (str.indexOf('ABOT2:') !== 0) throw new Error('not a settings string');
      imp = JSON.parse(decodeURIComponent(escape(atob(str.slice(6)))));
    } catch (e) { note('That is not a valid settings string'); return; }
    var clean = {};
    for (var k in imp) {
      if (!(k in DEFAULTS) || SETTINGS_SKIP[k]) continue;
      var v = imp[k], r = SCHEMA_TYPES[k], d = DEFAULTS[k];
      if (typeof v !== typeof d) continue;
      if (r && r[1] === 'num') { if (!isFinite(v)) continue; v = Math.min(r[4], Math.max(r[3], v)); }
      else if (r && r[1] === 'sel' && r[3] && !r[3].some(function (o) { return String(o[0]) === String(v); })) continue;
      else if (r && r[1] === 'txt') v = String(v).slice(0, 2000);
      clean[k] = v;
    }
    function finish() {
      for (var c in clean) S[c] = clean[c];
      refreshControls(); applySettings();
      note('Imported ' + Object.keys(clean).length + ' settings');
      logEvent('Imported bot settings');
    }
    var risky = [];
    for (var rk in RISKY) if (rk in clean && RISKY[rk].on(clean[rk]) && !RISKY[rk].on(S[rk])) risky.push(rk);
    if (risky.length) {
      dialog({
        title: 'Risky settings',
        msg: 'This import switches on risky options (' + risky.join(', ') + '). They can sell buildings, reset your run or anger the grandmas. Apply the settings anyway?',
        ok: 'Apply anyway', cancel: 'Cancel', onOk: finish
      });
    } else finish();
  }
  function doAct(act) {
    if (act === 'backup') backupNow('manual', 'both');
    else if (act === 'restore') restoreBackup();
    else if (act === 'logdl') {
      var d = new Date();
      download('CookieClicker-bot-log-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.txt',
        logList.length ? logText() : 'The log is empty.');
    }
    else if (act === 'setexport') exportSettings();
    else if (act === 'setimport') importSettings();
    else if (act === 'saveexport') exportSaveFile();
    else if (act === 'saveimport') importSaveDialog();
    else if (act === 'logclear') { logList = []; lastLogSig = ''; note('Log cleared'); refreshInfo(); }
  }

  function buildUI() {
    var st = document.createElement('style');
    st.id = 'autoBakerStyle';
    st.textContent = CSS;
    (document.head || document.body).appendChild(st);
    try {
      // Only one font <link>, even if the mod is injected twice into the same page.
      if (!document.getElementById('autoBakerFonts')) {
        var fl = document.createElement('link');
        fl.id = 'autoBakerFonts';
        fl.rel = 'stylesheet';
        fl.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@700;800&family=Rajdhani:wght@500;600;700&display=swap';
        (document.head || document.body).appendChild(fl);
      }
    } catch (e) {}

    panel = document.createElement('div');
    panel.id = 'autoBakerPanel';
    var html = '<div class="abHead" id="abHead"><span><span class="abDot" id="abDot" title="Bot is running"></span><span class="abTitle">' + NAME + '</span><span class="abVer">' + LABEL + '</span></span>' +
      '<span class="abBtn" id="abToggle" title="Minimize">–</span></div>' +
      '<div class="abBody" id="abBody">' +
      '<div class="abTip" id="abTip">' + TIP + '<br><button type="button" class="abOk" id="abTipOk">Got it</button></div>' +
      '<div class="abQuick abBotOnly">' +
      '<div class="abMaster" id="abMaster" data-q="enabled" title="Turn all automation on or off"><span>Bot</span><span id="abMasterState">ON</span></div>' +
      '<div class="abChips"><span class="abChip" data-q="buy" title="Auto-buy on or off">Buy</span><span class="abChip" data-q="click" title="Auto-click the big cookie on or off">Click</span><span class="abChip" data-q="golden" title="Golden cookies on or off">Golden</span><span class="abChip" data-q="seasonal" title="Seasonal cookies on or off">Seasonal</span></div>' +
      '<select id="abPreset" title="Apply a ready-made group of settings"><option value="">Presets...</option><option value="safe">Safe starter (recommended)</option><option value="balanced">Balanced</option><option value="late">Late game (everything on)</option><option value="reset">Reset all settings</option></select>' +
      '<div class="abNote" id="abNote"></div></div>' +
      '<div class="abInfo" id="abInfo"></div>' +
      '<canvas id="abGraph" width="230" height="42" style="width:100%;height:42px;display:block;margin-bottom:3px;background:rgba(10,14,20,.6);border:1px solid #38424f;border-radius:5px"></canvas>' +
      '<div id="abTable"></div>';
    var mainHtml = html, secHtml = {}, secOrder = [], cur = null;
    html = '';                                           // each section's controls are collected on their own, then grouped into categories
    SCHEMA.forEach(function (r) {
      if (r[0] === 'h') {
        if (cur !== null) secHtml[cur] = html;
        html = ''; cur = r[1]; secOrder.push(cur);
        return;
      }
      var k = r[0], t = r[1], label = r[2];
      if (t === 'btn') { html += '<div><button type="button" class="abOk" data-act="' + r[3] + '">' + label + '</button></div>'; return; }
      if (t === 'log') { html += '<div class="abLog" id="abLog"></div>'; return; }
      if (t === 'txt') { html += '<div' + (HELP[k] ? ' title="' + HELP[k] + '"' : '') + '>' + label + '<br><input type="text" data-k="' + k + '" maxlength="2000" style="width:100%;box-sizing:border-box"></div>'; return; }
      var tip = HELP[k] ? ' title="' + HELP[k] + '"' : '';
      var sub = SUBS[k] ? ' class="abSub" data-sub="' + SUBS[k] + '"' : '';
      if (t === 'bool') html += '<label' + tip + sub + '><input type="checkbox" data-k="' + k + '"> ' + label + '</label>';
      else if (t === 'num') html += '<div' + tip + '>' + label + ' <input type="number" data-k="' + k + '" min="' + r[3] + '" max="' + r[4] + '" style="width:74px"></div>';
      else {
        var opts = r[3] || [['all', 'All buildings']].concat(Game.ObjectsById.map(function (o) { return [o.name, o.name]; }));
        html += '<div' + tip + '>' + label + ' <select data-k="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></div>';
      }
      if (WARN[k]) html += '<div class="abWarn">&#9888; ' + WARN[k] + '</div>';
    });
    if (cur !== null) secHtml[cur] = html;
    html = mainHtml;
    function sect(name) {
      return '<details class="abSect" data-sec="' + name + '"><summary>' + name + '</summary><div class="abSecBody">' + secHtml[name] + '</div></details>';
    }
    var used = {};
    CATS.forEach(function (c) {
      var inner = '';
      c[1].forEach(function (n) { if (secHtml[n] !== undefined) { inner += sect(n); used[n] = 1; } });
      if (inner) html += '<details class="abCat abBotOnly" data-sec="cat:' + c[0] + '"><summary>' + c[0] + '</summary><div class="abCatBody">' + inner + '</div></details>';
    });
    secOrder.forEach(function (n) { if (!used[n]) html += '<div class="abBotOnly">' + sect(n) + '</div>'; });
    html += '</div>';
    panel.innerHTML = html;
    document.body.appendChild(panel);
    infoEl = panel.querySelector('#abInfo'); tableEl = panel.querySelector('#abTable'); canvas = panel.querySelector('#abGraph');
    sizeGraph();

    // cache the control nodes once so the 1 Hz refresh never walks the DOM again
    uiEls = {
      q: panel.querySelectorAll('[data-q]'),
      sub: panel.querySelectorAll('[data-sub]'),
      k: panel.querySelectorAll('[data-k]'),
      secs: panel.querySelectorAll('details[data-sec]'),
      ms: panel.querySelector('#abMasterState'),
      dot: panel.querySelector('#abDot'),
      master: panel.querySelector('#abMaster')
    };

    var types = {}; SCHEMA.forEach(function (r) { if (r[0] !== 'h') types[r[0]] = r; });
    uiEls.k.forEach(function (el) {
      el.addEventListener('change', function () {
        var k = el.dataset.k, r = types[k], v;
        if (r[1] === 'bool') v = el.checked;
        else if (r[1] === 'txt') v = String(el.value).slice(0, 2000);
        else if (r[1] === 'num') {
          var n = parseFloat(el.value);
          if (!isFinite(n)) n = DEFAULTS[k];                       // an empty box falls back to the default, but 0 is a valid value
          v = Math.min(r[4], Math.max(r[3], n));
        }
        else v = isNaN(+el.value) ? el.value : +el.value;
        var risk = RISKY[k];
        if (risk && risk.on(v)) {
          refreshControls();                                       // show the old value until the person confirms
          dialog({
            title: risk.title || 'Warning', msg: risk.msg, ok: 'Turn it on', cancel: 'Cancel',
            onOk: function () { S[k] = v; refreshControls(); applySettings(); }
          });
          return;
        }
        S[k] = v; applySettings(); syncQuick();
      });
    });
    uiEls.secs.forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (!S.openSecs) S.openSecs = {};
        S.openSecs[d.dataset.sec] = !!d.open;
      });
    });
    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('.abDlgBack')) return;                         // dialog clicks are handled by the dialog itself
      var a = t.closest('[data-act]');
      if (a) { doAct(a.dataset.act); return; }
      var q = t.closest('[data-q]');
      if (q) { S[q.dataset.q] = !S[q.dataset.q]; refreshControls(); applySettings(); return; }
      if (t.closest('#abTipOk')) { S.tipSeen = true; refreshControls(); return; }
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
    if (uiEls) uiEls.secs.forEach(function (d) {
      d.open = !!(S.openSecs && S.openSecs[d.dataset.sec]);
    });
    if (uiEls) uiEls.k.forEach(function (el) {
      var v = S[el.dataset.k];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    applyLayout();
    var tipEl = panel.querySelector('#abTip');
    if (tipEl) tipEl.style.display = S.tipSeen ? 'none' : '';
    syncQuick();
    lastInfoHtml = '';                       // force the next info refresh to paint
  }
  function applySettings() {
    if (S.fps >= 10 && Game.fps !== S.fps) Game.fps = S.fps;
    // Recalculate now: the old version assigned to a non-existent Game.recalculateGains property, so a
    // fresh toggle could leave the panel showing stale CPS until the game's next tick.
    try { Game.CalculateGains(); } catch (e) {}
    if (panel) startHeartbeat();
    autosaveSettings();                          // every option change is saved immediately
  }

  function line(a, b) { return '<div class="abRow"><span class="abLbl">' + a + '</span><span class="abVal">' + b + '</span></div>'; }
  function refreshLog() {
    var el = panel && panel.querySelector('#abLog');
    if (!el) return;
    for (var d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
      if (!d.open) return;                              // only redraw while its section and category are open
    }
    var sig = logList.length + ':' + (logList.length ? logList[logList.length - 1].t : 0);
    if (sig === lastLogSig) return;                     // nothing new: keep the existing DOM
    lastLogSig = sig;
    var keepScroll = el.scrollTop;                      // redrawing must not throw the scroll position away
    var last = logList.slice(-40).reverse();
    el.innerHTML = last.length ? last.map(function (e) {
      var d2 = new Date(e.t);
      return '<div><span class="abT">' + pad(d2.getHours()) + ':' + pad(d2.getMinutes()) + ':' + pad(d2.getSeconds()) + '</span>' + esc(e.m) + '</div>';
    }).join('') : '<div>Nothing logged yet.</div>';
    el.scrollTop = keepScroll;
  }
  function refreshInfo() {
    if (!infoEl) return;
    syncQuick();
    var h = line('Status', esc(status));
    var b = info.best;
    if (b) {
      h += line('Next', esc(b.name) + ' for ' + fmt(b.price) + ' (+' + fmt(b.gain) + ' cps, pays back in ' + fmtTime(b.eff) + ')' + (info.wait > 0 ? ' · ready in ' + fmtTime(info.wait) : ''));
    }
    var bank = bankTarget();
    h += line('Cookies', fmt(Game.cookies) + (bank > 0 ? ' · keeping ' + fmt(bank) + ' spare' : ''));
    var gt = Game.shimmerTypes && Game.shimmerTypes.golden;
    if (gt) h += line('Golden', 'in ' + fmtTime(Math.max(0, (gt.minTime - gt.time) / Game.fps)) + ' to ' + fmtTime(Math.max(0, (gt.maxTime - gt.time) / Game.fps)));
    var buffs = [];
    for (var k in Game.buffs) buffs.push(esc(Game.buffs[k].name) + ' ' + fmtTime(Game.buffs[k].time / Game.fps));
    if (buffs.length) h += line('Buffs', buffs.join(', '));
    try {
      var pend = pendingChips(), cps = Math.max(Game.cookiesPs, 0.01);
      // "cookies until the next chip" is a search, so it is cached for a few seconds (perf)
      if (now() - nextChipCache.t > 5000) {
        nextChipCache.t = now();
        nextChipCache.v = Game.HowManyCookiesReset(Game.prestige + Math.max(pend, 0) + 1) - (Game.cookiesReset + Game.cookiesEarned);
      }
      var nextAt = nextChipCache.v;
      var rate = '';
      if (hist.length > 2) {
        var f = hist[0], l = hist[hist.length - 1], dt = (l.t - f.t) / 3600000;
        if (dt > 0) rate = ' · ' + fmt((l.hc - f.hc) / dt) + '/h';
      }
      h += line('Chips', fmt(Game.prestige) + ' +' + fmt(Math.max(pend, 0)) + ' (next in ' + fmtTime(nextAt / cps) + ')' + rate);
      if (S.ascend && S.ascendMode === 'smart' && chipHist.length > 1) {
        var c0 = chipHist[0], c1 = chipHist[chipHist.length - 1], hrs = (c1.t - c0.t) / 3600000;
        var runHrs = (now() - (Game.startDate || reset.reincAt || sess.start)) / 3600000;
        if (hrs > 0 && runHrs > 0) h += line('Ascend', 'now ' + fmt((c1.p - c0.p) / hrs) + '/h · run average ' + fmt(Math.max(pend, 0) / runHrs) + '/h');
      }
    } catch (e) {}
    var SEASONS = { valentines: "Valentine's Day", fools: 'Business Day', halloween: 'Halloween', christmas: 'Christmas', easter: 'Easter' };
    if (Game.season && SEASONS[Game.season]) {
      var sh = Game.season === 'christmas' ? (S.reindeer ? 'reindeer are auto-clicked' : 'reindeer clicking is off')
        : Game.season === 'halloween' ? (S.seasonPop ? 'popping wrinklers for spooky cookies' : 'wrinklers drop spooky cookies')
        : Game.season === 'easter' ? (S.otherShimmers ? 'storm drops are auto-clicked' : 'storm drop clicking is off') : 'golden cookies are auto-clicked';
      h += line('Season', SEASONS[Game.season] + ' · ' + (S.seasonal || Game.season === 'valentines' || Game.season === 'fools' ? sh : 'seasonal clicking is off'));
    }
    if (S.wrinklers !== 'off' || S.wrinklerBuyPop) h += line('Wrinklers', attached().length + ' attached · worth ' + fmt(wrinklerValue(true)));
    try {
      var Bk = Game.Objects['Bank'].minigame, Fm = Game.Objects['Farm'].minigame;
      if (S.stock && Bk && Bk.goodsById) h += line('Stocks', 'profit ' + fmt(Bk.profit) + ' · holding ' + Bk.goodsById.filter(function (g) { return g.stock > 0; }).length + ' goods');
      if (S.garden !== 'off' && Fm) h += line('Garden', Fm.plantsUnlockedN + '/' + Fm.plantsN + ' seeds unlocked');
      if (S.apocalypse !== 'off') h += line('Grandmapocalypse', 'stage ' + (Game.elderWrath || 0) + '/3');
      if ((S.dragonTrain || S.dragonPet) && Game.dragonLevels) h += line('Dragon', 'level ' + Game.dragonLevel + '/' + (Game.dragonLevels.length - 1));
    } catch (e) {}
    if (S.backup !== 'off') h += line('Backup', 'last ' + fmtTime((now() - bk.last) / 1000) + ' ago · next in ' + fmtTime(Math.max(0, S.backupMin * 60 - (now() - bk.last) / 1000)));
    if (S.logOn) h += line('Session', sess.bought + ' bought · ' + sess.popped + ' popped · ' + sess.golden + ' cookies clicked' + (sess.lumps ? ' · ' + sess.lumps + ' lumps' : '') + (sess.casts ? ' · ' + sess.casts + ' casts' : ''));
    if (h !== lastInfoHtml) { infoEl.innerHTML = h; lastInfoHtml = h; }   // repaint only when the text changed
    refreshLog();

    if (S.showTable) {
      var rows = info.list.filter(function (c) { return isFinite(c.score); }).sort(function (a, b2) { return a.score - b2.score; }).slice(0, 15);
      var best = rows.length ? rows[0].score : 1;
      tableEl.innerHTML = '<table style="width:100%;font-size:11px"><tr><th align="left">Item</th><th>Eff%</th><th>Cost</th><th>ΔCPS</th></tr>' +
        rows.map(function (c) {
          return '<tr' + (c.blocked ? ' style="opacity:.4"' : '') + '><td>' + esc(c.name) + '</td><td>' + Math.round(best / c.score * 100) +
            '</td><td>' + fmt(c.price) + '</td><td>' + fmt(c.gain) + '</td></tr>';
        }).join('') + '</table>';
    } else if (tableEl.innerHTML) tableEl.innerHTML = '';
    drawGraph();
  }
  function drawGraph() {
    if (!canvas || !canvas.getContext || hist.length < 2) return;
    var key = S.graph, p = hist[hist.length - 1];
    var sig = hist.length + '|' + key + '|' + p[key];
    if (sig === lastGraphSig) return;                  // only redraw when a new sample arrives
    lastGraphSig = sig;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var vals = hist.map(function (q) { return Math.log10(Math.max(q[key], 1)); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 0.01) hi = lo + 0.01;
    ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.8; ctx.beginPath();
    vals.forEach(function (v, i) {
      var x = i / (vals.length - 1) * w, y = h - 4 - (v - lo) / (hi - lo) * (h - 8);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#9fb3c8'; ctx.font = '600 10px Rajdhani, sans-serif';
    ctx.fillText(key + ' (log) ' + fmt(p[key]), 4, 10);
  }

  /* ------------------------------------------------------------------ heartbeat */
  // Browsers slow normal timers in hidden tabs to ~1/s. A Web Worker's timer is not slowed, so it drives the bot.
  function heartbeat() {
    try { clickTick(); } catch (e) { console.error('[' + NAME + ']', e); }
    var t = now();
    if (t - hb.lastLogic >= 250) { hb.lastLogic = t; try { logic(); } catch (e) { console.error('[' + NAME + ']', e); } }
    if (t - hb.lastBackup >= 30000) { hb.lastBackup = t; try { backupTick(); } catch (e) { console.error('[' + NAME + ']', e); } }
  }
  function stopHeartbeat() {
    if (hb.timer) { clearInterval(hb.timer); hb.timer = null; }
    if (hb.worker) { try { hb.worker.terminate(); } catch (e) {} hb.worker = null; }
  }
  function startHeartbeat() {
    var mode = (S.bgProtect && window.Worker && window.Blob && window.URL && URL.createObjectURL) ? 'worker' : 'timer';
    if (mode === hb.mode && (hb.worker || hb.timer)) return;
    stopHeartbeat();
    hb.mode = mode;
    if (mode === 'worker') {
      try {
        var url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},33)'], { type: 'text/javascript' }));
        hb.worker = new Worker(url);
        hb.worker.onmessage = heartbeat;
        hb.worker.onerror = function () { stopHeartbeat(); hb.mode = 'timer'; hb.timer = setInterval(heartbeat, 33); };
        return;
      } catch (e) { stopHeartbeat(); }
    }
    hb.mode = 'timer';
    hb.timer = setInterval(heartbeat, 33);
  }

  /* ------------------------------------------------------------------ register */
  function toast(title, text) { try { Game.Notify(title, text, [16, 5], 4); } catch (e) {} }
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (dlgEl) {                                                    // a warning box is open: only Escape does anything
      if (e.key === 'Escape') {
        var b = dlgEl.querySelector('[data-d="no"]') || dlgEl.querySelector('[data-d="yes"]');
        if (b) b.click();
      }
      return;
    }
    var tag = e.target && e.target.tagName ? e.target.tagName : '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
    var k = (e.key || '').toLowerCase();
    if (k === 'e') { if (Game.ExportSave) Game.ExportSave(); return; }
    if (!S.hotkeys) return;
    if (k === 'p') {
      S.enabled = !S.enabled; refreshControls(); applySettings();
      logEvent(S.enabled ? 'Bot resumed (hotkey)' : 'Bot paused (hotkey)');
      toast(NAME, S.enabled ? 'Bot resumed' : 'Bot paused');
    } else if (k === 's') {
      try { Game.WriteSave(); logEvent('Game saved (hotkey)'); toast(NAME, 'Game saved'); } catch (x) { toast(NAME, 'Save failed'); }
    } else if (k === 'r') {
      wipeSave();                     // asks for confirmation first
    } else if (k === 'g') {
      S.golden = !S.golden; refreshControls(); applySettings();
      toast(NAME, S.golden ? 'Golden cookies: on' : 'Golden cookies: off');
    } else if (k === 'b') {
      S.buy = !S.buy; refreshControls(); applySettings();
      toast(NAME, S.buy ? 'Auto-buy: on' : 'Auto-buy: off');
    }
  }

  Game.registerMod(MOD_ID, {
    init: function () {
      restoreSettings();                                  // settings last mirrored when the game saved
      forgetRun();                                        // no samples before this load belong to the current run
      buildUI();
      applySettings();
      for (var k in Game.buffs) seenBuffs[k] = true;       // buffs already running when the bot loads don't trigger alerts
      bk.last = now();
      startHeartbeat();
      sample(); setTimeout(sample, 1500);
      timers.push(setInterval(sample, 5000));
      timers.push(setInterval(refreshInfo, 1000));          // 1 Hz: the panel is the second biggest CPU user
      document.addEventListener('keydown', onKey);
      logEvent('Bot ' + LABEL + ' started');
      Game.Notify(NAME + ' ' + LABEL + ' is ready', 'The bot is on. Open a section to change settings, or pick a preset. Hover anything for help. Drag the title bar to move the panel. New: G / B hotkeys, "buy as many as you can afford", wrinkler pop threshold.', [16, 5], 6);
    },
    save: function () { persistSettings(); return JSON.stringify(S); },   // the game calls this on every save
    load: function (str) {
      S = JSON.parse(JSON.stringify(DEFAULTS));      // a loaded save brings its own settings; nothing carries over from the previous one
      try { var d = JSON.parse(str); for (var k in d) if (k in S) S[k] = d[k]; } catch (e) {}
      forgetRun();                                   // a loaded save starts a new run: drop the old samples
      refreshControls(); applySettings(); persistSettings();
    }
  });
})();