(function () {
  var KEY = 'kaalera-theme', root = document.documentElement;
  function initial() {
    try { var s = localStorage.getItem(KEY); if (s === 'dark' || s === 'light') return s; } catch (e) {}
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function apply(t) {
    root.setAttribute('data-theme', t);
    var bs = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < bs.length; i++) {
      bs[i].textContent = t === 'dark' ? '\u2600' : '\u263E';
      bs[i].setAttribute('title', t === 'dark' ? 'Light mode' : 'Dark mode');
      bs[i].setAttribute('aria-pressed', String(t === 'dark'));
    }
  }
  apply(initial());
  document.addEventListener('DOMContentLoaded', function () { apply(root.getAttribute('data-theme')); });
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('.theme-toggle');
    if (!b) return;
    var t = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, t); } catch (err) {}
    apply(t);
  });
})();
