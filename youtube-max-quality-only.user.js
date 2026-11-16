// ==UserScript==
// @name         YouTube - Max quality only
// @namespace    https://www.youtube.com/
// @version      2.5
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
  const POLL_MS = 50;
  const POLL_MAX_MS = 8000;
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

  function availableLevels(p) {
    let levels = [];
    try {
      const data = p.getAvailableQualityData?.();
      if (Array.isArray(data) && data.length) {
        levels = data.filter((d) => d && d.isPlayable !== false).map((d) => d.quality);
      }
    } catch (e) {}
    if (!levels.length) {
      try { levels = p.getAvailableQualityLevels?.() || []; } catch (e) {}
    }
    const seen = new Set();
    return levels
      .filter((l) => l && l !== 'auto' && HEIGHTS[l] && !seen.has(l) && seen.add(l))
      .sort((a, b) => HEIGHTS[b] - HEIGHTS[a]);
  }

  function pickBest(levels) {
    if (CONFIG.maxQuality > 0) {
      return levels.find((l) => HEIGHTS[l] <= CONFIG.maxQuality) || levels[levels.length - 1];
    }
    return levels[0];
  }

  const applied = new WeakMap();

  function lockPlayer(p) {
    if (typeof p?.setPlaybackQualityRange !== 'function') return false;

    const levels = availableLevels(p);
    if (!levels.length) return false;

    const best = pickBest(levels);
    let videoId = '';
    try { videoId = p.getVideoData?.()?.video_id || ''; } catch (e) {}
    const key = videoId + '|' + best;

    if (applied.get(p) === key) {
      let preferred;
      try { preferred = p.getPreferredQuality?.(); } catch (e) {}
      if (preferred === undefined || preferred === best) return true;
    }
    applied.set(p, key);

    try {
      p.setPlaybackQualityRange(best, best);
      log('locked', videoId, 'on', best, 'among', levels.join(','));
    } catch (e) {
      log('lock failed', e);
    }
    return true;
  }

  function lockAll() {
    const players = document.querySelectorAll(PLAYERS);
    if (!players.length) return false;
    let done = true;
    players.forEach((p) => { if (!lockPlayer(p)) done = false; });
    return done;
  }

  let pollTimer = null;
  let pollUntil = 0;

  function trigger() {
    pollUntil = Date.now() + POLL_MAX_MS;
    if (lockAll() || pollTimer !== null) return;
    pollTimer = setInterval(() => {
      if (lockAll() || Date.now() > pollUntil) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }, POLL_MS);
  }

  for (const evt of ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated', 'pageshow']) {
    window.addEventListener(evt, trigger, true);
  }
  for (const evt of ['loadstart', 'loadedmetadata', 'canplay', 'playing']) {
    document.addEventListener(evt, (e) => {
      if (e.target instanceof HTMLVideoElement) trigger();
    }, true);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trigger);
  } else {
    trigger();
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
