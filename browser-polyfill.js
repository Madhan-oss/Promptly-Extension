// ──────────────────────────────────────────────────────────────
//  Promptly — Browser API Polyfill (v1.1.0)
//  Normalizes chrome.* and browser.* APIs for cross-browser
//  compatibility (Chrome, Firefox, Edge, Opera).
//
//  Firefox exposes `browser` (Promise-based).
//  Chrome/Edge/Opera expose `chrome` (callback-based).
//  This shim ensures `chrome` is always defined in all environments.
// ──────────────────────────────────────────────────────────────
(function () {
  'use strict';

  // If running in Firefox where only `browser` is defined, alias it to `chrome`
  if (
    typeof globalThis.browser !== 'undefined' &&
    typeof globalThis.chrome === 'undefined'
  ) {
    globalThis.chrome = globalThis.browser;
  }

  // If running in Chrome where only `chrome` is defined, create a `browser` alias
  // (Some third-party code expects `browser`)
  if (
    typeof globalThis.chrome !== 'undefined' &&
    typeof globalThis.browser === 'undefined'
  ) {
    globalThis.browser = globalThis.chrome;
  }
})();
