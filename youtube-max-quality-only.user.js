// ==UserScript==
// @name         YouTube - Max quality only
// @namespace    https://www.youtube.com/
// @version      2.0
// @author       AnnoyedDev
// @description  Set and lock to the highest avaible quality avaible on the current video played on YouTube and remove lower quality from the menu.
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
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
})();
