// ==UserScript==
// @name         YouTube - Max quality only
// @namespace    https://www.youtube.com/
// @version      2.2
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

  try {
    const q = CONFIG.maxQuality > 0 ? CONFIG.maxQuality : 4320;
    const now = Date.now();
    localStorage.setItem('yt-player-quality', JSON.stringify({
      data: JSON.stringify({ quality: q, previousQuality: q }),
      expiration: now + 365 * 864e5,
      creation: now,
    }));
  } catch (e) {}

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
    const best = Array.isArray(levels) ? levels.find((l) => l && l !== 'auto') : null;
    if (!best) return;

    const key = (p.getVideoData?.()?.video_id || '') + '|' + best;
    const prev = state.get(p);
    const now = Date.now();
    if (prev && prev.key === key) {
      if (p.getPlaybackQuality?.() === best) return;
      if (now - prev.time < 1000) return;
    }
    state.set(p, { key, time: now });

    try {
      p.setPlaybackQualityRange(best, best);
      p.setPlaybackQuality?.(best);
      log('locked on', best);
    } catch (e) {
      log('lock failed', e);
    }
  }

  function lockAll() {
    document.querySelectorAll('.html5-video-player').forEach(lockPlayer);
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
    document.querySelectorAll('.ytp-quality-menu .ytp-menuitem').forEach((item) => {
      const text = (item.querySelector('.ytp-menuitem-label') || item).textContent.trim();
      if (text && !/^\d/.test(text)) item.style.display = 'none';
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
