// ==UserScript==
// @name         YouTube - Max quality only
// @namespace    https://www.youtube.com/
// @version      2.1
// @author       AnnoyedDev
// @description  Set and lock to the highest avaible quality avaible on the current video played on YouTube and remove lower quality from the menu.
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://github.com/AnnoyedDev/Youtube-Max-Quality-Only.user.js/raw/refs/heads/main/youtube-max-quality-only.user.js
// @downloadURL  https://github.com/AnnoyedDev/Youtube-Max-Quality-Only.user.js/raw/refs/heads/main/youtube-max-quality-only.user.js
// ==/UserScript==

(function () {
  'use strict';

  const isVideo = (f) => f.mimeType?.startsWith('video/');
  const playable = (f) => !window.MediaSource || MediaSource.isTypeSupported(f.mimeType);
  function keepBestOnly(resp) {
    const sd = resp?.streamingData;
    if (!Array.isArray(sd?.adaptiveFormats)) return;
    const videos = sd.adaptiveFormats.filter((f) => isVideo(f) && playable(f));
    if (!videos.length) return;
    const max = Math.max(...videos.map((f) => f.width * f.height));
    sd.adaptiveFormats = sd.adaptiveFormats.filter(
      (f) => !isVideo(f) || (f.width * f.height === max && playable(f))
    );
  }

  function patch(obj) {
    if (obj && typeof obj === 'object') {
      keepBestOnly(obj);
      keepBestOnly(obj.playerResponse);
    }
    return obj;
  }

  let initial;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    configurable: true,
    get: () => initial,
    set: (v) => { initial = patch(v); },
  });

  const origParse = JSON.parse;
  JSON.parse = function (...args) {
    return patch(origParse.apply(this, args));
  };

  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    return origJson.call(this).then(patch);
  };

  try {
    const now = Date.now();
    localStorage.setItem('yt-player-quality', JSON.stringify({
      data: JSON.stringify({ quality: 4320, previousQuality: 4320 }),
      expiration: now + 365 * 864e5,
      creation: now,
    }));
  } catch (e) {}

  let lockedFor = '';
  function lock() {
    const p = document.getElementById('movie_player');
    if (!p?.setPlaybackQualityRange) return;
    if (!p.__maxQuality) {
      p.__maxQuality = true;
      p.addEventListener('onStateChange', lock);
      p.addEventListener('onPlaybackQualityChange', lock);
    }
    const best = p.getAvailableQualityLevels?.()[0];
    if (!best || best === 'auto') return;
    const key = (p.getVideoData?.().video_id || '') + best;
    if (key === lockedFor && p.getPlaybackQuality?.() === best) return;
    lockedFor = key;
    p.setPlaybackQualityRange(best, best);
  }
  document.addEventListener('yt-player-updated', lock);
  document.addEventListener('yt-navigate-finish', lock);

  new MutationObserver(() => {
    document.querySelectorAll('.ytp-quality-menu .ytp-menuitem').forEach((item) => {
      if (/^auto/i.test(item.textContent.trim())) item.style.display = 'none';
    });
  }).observe(document, { childList: true, subtree: true });
})();

