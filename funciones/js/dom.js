// shared/js/dom.js
(function (global) {
  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  global.DOM = { qs, qsa };
})(window);