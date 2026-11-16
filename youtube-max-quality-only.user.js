// ==UserScript==
// @name         YouTube - Max quality only
// @namespace    https://www.youtube.com/
// @version      2.4
// @author       AnnoyedDev
// @description  Set and lock the highest available quality on the current YouTube video and remove the lower qualities from the menu.
// @match        https://www.youtube.com/*
// @match        https://www.youtube-nocookie.com/embed/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/AnnoyedDev/Youtube-Max-Quality-Only.user.js/raw/refs/heads/main/youtube-max-quality-only.user.js
// @downloadURL  https://github.com/AnnoyedDev/Youtube-Max-Quality-Only.user.js/raw/refs/heads/main/youtube-max-quality-only.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    filterFormats: true,
    maxQuality: 0,
    debug: false,
  };

  const PLAYERS = '#movie_player, #shorts-player';
  const RETRY_MS = 3000;
  const HEIGHTS = {
    highres: 4320,
    hd2880: 2880,
    hd2160: 2160,
    hd1440: 1440,
    hd1080: 1080,
    hd720: 720,
    large: 480,
    medium: 360,
    small: 240,
    tiny: 144,
  };

  const log = (...a) => CONFIG.debug && console.log('[Max quality]', ...a);

  const MS = window.MediaSource || window.ManagedMediaSource;
  const supportCache = new Map();

  const isVideo = (f) => typeof f?.mimeType === 'string' && f.mimeType.startsWith('video/');
  const area = (f) => (Number(f.width) || 0) * (Number(f.height) || 0);
  const label = (f) => parseInt(f.qualityLabel, 10) || Math.min(Number(f.width) || 0, Number(f.height) || 0);

  function playable(f) {
    if (!MS?.isTypeSupported) return true;
    let ok = supportCache.get(f.mimeType);
    if (ok === undefined) {
      try { ok = MS.isTypeSupported(f.mimeType); } catch { ok = true; }
      supportCache.set(f.mimeType, ok);
    }
    return ok;
  }

  function keepBestOnly(resp) {
    const sd = resp?.streamingData;
    if (!sd || !Array.isArray(sd.adaptiveFormats)) return;

    let videos = sd.adaptiveFormats.filter((f) => isVideo(f) && area(f) > 0 && playable(f));
    if (!videos.length) return;

    if (CONFIG.maxQuality > 0) {
      const capped = videos.filter((f) => label(f) <= CONFIG.maxQuality);
      if (capped.length) videos = capped;
    }

    const max = Math.max(...videos.map(area));
    const keep = new Set(videos.filter((f) => area(f) === max));
    if (!keep.size) return;

    const before = sd.adaptiveFormats.length;
    sd.adaptiveFormats = sd.adaptiveFormats.filter((f) => !isVideo(f) || keep.has(f));
    if (before !== sd.adaptiveFormats.length) {
      log('formats', before, '->', sd.adaptiveFormats.length, [...keep][0]?.qualityLabel);
    }
  }

  function patch(obj) {
    try {
      if (obj && typeof obj === 'object') {
        if (obj.streamingData) keepBestOnly(obj);
        if (obj.playerResponse?.streamingData) keepBestOnly(obj.playerResponse);
      }
    } catch (e) {
      log('patch failed', e);
    }
    return obj;
  }

  if (CONFIG.filterFormats) {
    try {
      let initial = patch(window.ytInitialPlayerResponse);
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        enumerable: true,
        get: () => initial,
        set: (v) => { initial = patch(v); },
      });
    } catch (e) {
      log('cannot hook ytInitialPlayerResponse', e);
    }

    const origParse = JSON.parse;
    JSON.parse = function parse(...args) {
      return patch(origParse.apply(this, args));
    };

    const origJson = Response.prototype.json;
    Response.prototype.json = function json(...args) {
      return origJson.apply(this, args).then(patch);
    };
  }

  try {
    const q = CONFIG.maxQuality > 0 ? CONFIG.maxQuality : 4320;
    const now = Date.now();
    localStorage.setItem('yt-player-quality', JSON.stringify({
      data: JSON.stringify({ quality: q, previousQuality: q }),
      expiration: now + 365 * 864e5,
      creation: now,
    }));
  } catch (e) {}

  function pickBest(real) {
    if (CONFIG.maxQuality > 0) {
      const allowed = real.find((l) => (HEIGHTS[l] || 0) <= CONFIG.maxQuality);
      return allowed || real[real.length - 1];
    }
    return real[0];
  }

  const hooked = new WeakSet();
  const state = new WeakMap();

  function lockPlayer(p) {
    if (typeof p?.setPlaybackQualityRange !== 'function') return;

    if (!hooked.has(p)) {
      hooked.add(p);
      try {
        p.addEventListener('onStateChange', lockAll);
      } catch (e) {}
    }

    let levels;
    try { levels = p.getAvailableQualityLevels?.(); } catch { return; }
    if (!Array.isArray(levels)) return;
    const real = levels.filter((l) => l && l !== 'auto');
    if (real.length < 2) return;

    const best = pickBest(real);
    const key = (p.getVideoData?.()?.video_id || '') + '|' + best;
    const prev = state.get(p);
    const now = Date.now();

    if (prev && prev.key === key) {
      if (now - prev.time < RETRY_MS) return;
      let preferred;
      try { preferred = p.getPreferredQuality?.(); } catch {}
      if (preferred === undefined || preferred === best) return;
    }
    state.set(p, { key, time: now });

    try {
      p.setPlaybackQualityRange(best, best);
      log('fallback lock on', best);
    } catch (e) {
      log('lock failed', e);
    }
  }

  function lockAll() {
    document.querySelectorAll(PLAYERS).forEach(lockPlayer);
  }

  for (const evt of ['yt-player-updated', 'yt-navigate-finish', 'yt-page-data-updated']) {
    document.addEventListener(evt, lockAll);
  }

  function cleanMenu() {
    document.querySelectorAll('.ytp-quality-menu').forEach((menu) => {
      const items = [...menu.querySelectorAll('.ytp-menuitem')].map((el) => {
        const text = (el.querySelector('.ytp-menuitem-label') || el).textContent.trim();
        return { el, value: /^\d/.test(text) ? parseInt(text, 10) : 0 };
      });
      const numbered = items.filter((i) => i.value > 0);
      if (!numbered.length) return;

      let top = numbered[0].value;
      if (CONFIG.maxQuality > 0) {
        const allowed = numbered.find((i) => i.value <= CONFIG.maxQuality);
        top = (allowed || numbered[numbered.length - 1]).value;
      }

      for (const { el, value } of items) {
        const display = value === top ? '' : 'none';
        if (el.style.display !== display) el.style.display = display;
      }
    });
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      cleanMenu();
    });
  }).observe(document, { childList: true, subtree: true });
})();
