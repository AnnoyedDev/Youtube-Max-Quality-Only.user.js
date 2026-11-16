// ==UserScript==
// @name         YouTube - Max quality only
// @namespace    https://www.youtube.com/
// @version      2.3
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

  try {
    const q = CONFIG.maxQuality > 0 ? CONFIG.maxQuality : 4320;
    const now = Date.now();
    localStorage.setItem('yt-player-quality', JSON.stringify({
      data: JSON.stringify({ quality: q, previousQuality: q }),
      expiration: now + 365 * 864e5,
      creation: now,
    }));
  } catch (e) {}

  function pickBest(levels) {
    const real = levels.filter((l) => l && l !== 'auto');
    if (!real.length) return null;
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
        p.addEventListener('onPlaybackQualityChange', lockAll);
      } catch (e) {}
    }

    let levels;
    try { levels = p.getAvailableQualityLevels?.(); } catch { return; }
    if (!Array.isArray(levels)) return;
    const best = pickBest(levels);
    if (!best) return;

    const key = (p.getVideoData?.()?.video_id || '') + '|' + best;
    const prev = state.get(p);
    const now = Date.now();

    if (prev && prev.key === key) {
      if (now - prev.time < RETRY_MS) return;
      let preferred;
      try { preferred = p.getPreferredQuality?.(); } catch {}
      if (preferred !== undefined) {
        if (preferred === best) return;
      } else if (p.getPlaybackQuality?.() === best) {
        return;
      }
    }
    state.set(p, { key, time: now });

    try {
      p.setPlaybackQualityRange(best, best);
      log('locked on', best);
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
  for (const evt of ['loadeddata', 'playing']) {
    document.addEventListener(evt, (e) => {
      if (e.target instanceof HTMLVideoElement) lockAll();
    }, true);
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
