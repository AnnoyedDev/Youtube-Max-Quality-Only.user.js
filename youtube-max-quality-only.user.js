// ==UserScript==
// @name         YouTube - Max quality only
// @namespace    https://www.youtube.com/
// @version      1.0
// @author       AnnoyedDev
// @description  Set and lock to the highest avaible quality avaible on the current video played on YouTube and remove lower quality from the menu.
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const RECHECK_WINDOW_MS = 15000;
  const RECHECK_INTERVAL_MS = 1000;


  function getPlayer() {
    const p = document.getElementById('movie_player');
    return p && typeof p.getAvailableQualityLevels === 'function' ? p : null;
  }

  function getBestQualityLevel(player) {
    try {
      const levels = player.getAvailableQualityLevels();
      return levels && levels.length ? levels[0] : null;
    } catch (e) {
      return null;
    }
  }

  function lockToBestQuality(player) {
    const best = getBestQualityLevel(player);
    if (!best) return null;
    try {
      player.setPlaybackQualityRange(best, best);
    } catch (e) {}
    try {
      player.setPlaybackQuality(best);
    } catch (e) {}
    return best;
  }

  function ensureQualityChangeListener(player) {
    if (player.__qualityLockPatched) return;
    player.__qualityLockPatched = true;
    try {
      player.addEventListener('onPlaybackQualityChange', () => {
        lockToBestQuality(player);
      });
    } catch (e) {}
  }

  function watchQualityForCurrentVideo() {
    const player = getPlayer();
    if (!player) return;

    ensureQualityChangeListener(player);
    let currentBest = lockToBestQuality(player);

    const start = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - start > RECHECK_WINDOW_MS) {
        clearInterval(interval);
        return;
      }
      const best = getBestQualityLevel(player);
      if (best && best !== currentBest) {
        currentBest = lockToBestQuality(player);
      }
    }, RECHECK_INTERVAL_MS);
  }

  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(watchQualityForCurrentVideo, 300);
  });

  setTimeout(watchQualityForCurrentVideo, 300);


  function isQualityLikeLabel(text) {
    const t = text.trim();
    return /^\d{3,4}p/i.test(t) || /^auto/i.test(t);
  }

  function pruneQualityPanel(panel) {
    const items = Array.from(panel.querySelectorAll('.ytp-menuitem'));
    if (items.length < 2) return;

    const labels = items.map(
      (item) => item.querySelector('.ytp-menuitem-label')?.textContent || ''
    );
    const qualityLikeCount = labels.filter(isQualityLikeLabel).length;
    if (qualityLikeCount < items.length - 1) return;

    let kept = false;
    items.forEach((item, i) => {
      const label = labels[i].trim();
      if (/^auto/i.test(label)) {
        item.remove();
        return;
      }
      if (!kept) {
        kept = true;
        return;
      }
      item.remove();
    });
  }

  function scanForQualityPanels(root) {
    if (root.matches?.('.ytp-panel-menu')) pruneQualityPanel(root);
    root.querySelectorAll?.('.ytp-panel-menu').forEach(pruneQualityPanel);
  }

  const menuObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) scanForQualityPanels(node);
      });
    }
  });

  menuObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
