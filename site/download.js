// Points the download button at the right file from the latest GitHub release.
(function () {
  var REPO = 'Nabhyaraj-Sonagara/Basalt';
  var RELEASES = 'https://github.com/' + REPO + '/releases/latest';
  var KINDS = [
    { id: 'mac-arm64', os: 'mac', label: 'macOS (Apple Silicon)', test: /-mac-arm64\.dmg$/ },
    { id: 'mac-x64', os: 'mac', label: 'macOS (Intel)', test: /-mac-x64\.dmg$/ },
    { id: 'win-x64', os: 'win', label: 'Windows installer', test: /\.exe$/ },
    { id: 'linux-appimage', os: 'linux', label: 'Linux AppImage', test: /\.AppImage$/ },
    { id: 'linux-deb', os: 'linux', label: 'Debian / Ubuntu (.deb)', test: /\.deb$/ },
  ];

  function detectOs() {
    var p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase();
    if (p.indexOf('mac') >= 0) return 'mac';
    if (p.indexOf('win') >= 0) return 'win';
    if (p.indexOf('linux') >= 0 || p.indexOf('x11') >= 0) return 'linux';
    return null;
  }
  function size(bytes) {
    return Math.round(bytes / 1e6) + ' MB';
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }

  var os = detectOs();
  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) {
      if (!r.ok) throw new Error('no release');
      return r.json();
    })
    .then(function (rel) {
      var found = KINDS.map(function (k) {
        var a = (rel.assets || []).filter(function (x) { return k.test.test(x.name); })[0];
        return a ? { kind: k, url: a.browser_download_url, size: a.size } : null;
      }).filter(Boolean);
      if (!found.length) return;
      document.getElementById('version').textContent = rel.tag_name;

      var list = document.getElementById('files');
      list.textContent = '';
      found.forEach(function (f) {
        var li = el('li');
        li.appendChild(el('a', { href: f.url }, f.kind.label));
        li.appendChild(el('span', {}, size(f.size)));
        list.appendChild(li);
      });

      var mine = found.filter(function (f) { return f.kind.os === os; });
      var primary = document.getElementById('primary');
      var alt = document.getElementById('alt');
      if (mine.length) {
        primary.href = mine[0].url;
        primary.textContent = 'Download for ' + mine[0].kind.label.replace(' installer', '');
        document.getElementById('meta').textContent = rel.tag_name + ' · ' + size(mine[0].size) + ' · Free and open source';
        mine.slice(1).forEach(function (f) {
          alt.appendChild(el('a', { href: f.url }, f.kind.label));
        });
      } else {
        primary.href = '#all';
      }
      alt.appendChild(el('a', { href: '#all' }, 'Other platforms'));
    })
    .catch(function () {
      document.getElementById('meta').textContent = 'The first release is on its way. Watch the GitHub repository for it.';
      document.getElementById('primary').href = RELEASES;
    });
})();

// Copy buttons for the one-line install commands.
for (const btn of document.querySelectorAll('button.copy[data-copy]')) {
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy)?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById(btn.dataset.copy));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      btn.textContent = 'Selected';
    }
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  });
}
