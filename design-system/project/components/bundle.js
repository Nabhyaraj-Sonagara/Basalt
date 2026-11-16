/* @ds-bundle: {"format":4,"namespace":"Basalt","components":[{"name":"Logo"},{"name":"Icon"},{"name":"Button"},{"name":"Kbd"},{"name":"Tag"},{"name":"Task"},{"name":"Wikilink"},{"name":"Callout"},{"name":"HexAvatar"},{"name":"SearchField"},{"name":"TreeItem"},{"name":"Tabs"},{"name":"CommandPalette"},{"name":"Comb"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }
  function rest(props, omit) {
    var o = {};
    for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k) && omit.indexOf(k) < 0) o[k] = props[k];
    return o;
  }

  /* ---------- Icon ---------- */
  var ICONS = {
    note: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h4"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
    comb: '<g transform="translate(.6 0)"><path d="M12 8.1L10 11.56H6L4 8.1L6 4.64h4z"/><path d="M18.75 12l-2 3.46h-4l-2-3.46 2-3.46h4z"/><path d="M12 15.9l-2 3.46H6l-2-3.46 2-3.46h4z"/></g>',
    wikilink: '<path d="M7 4H4v16h3M10.5 7.5H8.5v9h2M17 4h3v16h-3M13.5 7.5h2v9h-2"/>',
    backlinks: '<path d="M3 12h7M7 9l3 3-3 3"/><path d="M16.5 7.5l3.9 2.25v4.5L16.5 16.5l-3.9-2.25v-4.5z"/>',
    search: '<path d="M10.5 4l5.63 3.25v6.5L10.5 17l-5.63-3.25v-6.5z"/><path d="M15.2 15.7L20 20.5"/>',
    tag: '<path d="M2.5 12L6 7h12l3.5 5L18 17H6z"/><path d="M8 12h.01"/>',
    daily: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/><path d="M12 12.6l2 1.15v2.3l-2 1.15-2-1.15v-2.3z"/>',
    task: '<path d="M12 3.5l7.36 4.25v8.5L12 20.5l-7.36-4.25v-8.5z"/><path d="M8.6 12.2l2.3 2.3 4.5-4.9"/>',
    settings: '<path d="M21 12l-4.5 7.8h-9L3 12l4.5-7.8h9z"/><circle cx="12" cy="12" r="3"/>',
    'new-note': '<path d="M12 3.5l7.36 4.25v8.5L12 20.5l-7.36-4.25v-8.5z"/><path d="M12 8.5v7M8.5 12h7"/>',
    command: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7.5 9.5l2.5 2.5-2.5 2.5M12.5 14.5h4"/>',
    highlight: '<path d="M5 20h14"/><path d="M14.5 4.5l4 4L10 17H6v-4z"/>',
    pin: '<path d="M12 21v-6"/><path d="M8 3h8l-1 6 3 3v3H6v-3l3-3z"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    external: '<path d="M8 16L16 8M10 8h6v6"/>',
    close: '<path d="M7 7l10 10M17 7L7 17"/>',
    warning: '<path d="M12 3.5l7.36 4.25v8.5L12 20.5l-7.36-4.25v-8.5z"/><path d="M12 8v5M12 16.2h.01"/>',
    info: '<path d="M12 3.5l7.36 4.25v8.5L12 20.5l-7.36-4.25v-8.5z"/><path d="M12 11v5M12 7.8h.01"/>'
  };
  function Icon(props) {
    var size = props.size || 16;
    var svg = ICONS[props.name] || ICONS.note;
    return h('svg', {
      className: cx('bs-icon', props.className),
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': props.label ? undefined : true,
      'aria-label': props.label, role: props.label ? 'img' : undefined,
      dangerouslySetInnerHTML: { __html: svg }
    });
  }
  Icon.names = Object.keys(ICONS);

  /* ---------- Logo ---------- */
  function Mark(size) {
    return h('svg', { className: 'bs-logo-mark', width: size, height: size, viewBox: '0 0 64 64', 'aria-hidden': true,
      dangerouslySetInnerHTML: { __html:
        '<path fill="#5a5249" d="M12 14 L22 21 V43 L12 36 Z"/><path fill="#3a352f" d="M22 21 H42 V43 H22 Z"/><path fill="#2a2622" d="M42 21 L52 14 V36 L42 43 Z"/>' +
        '<path fill="#5a5249" d="M12 38.5 L22 45.5 V57 L12 50 Z"/><path fill="#3a352f" d="M22 45.5 H42 V57 H22 Z"/><path fill="#2a2622" d="M42 45.5 L52 38.5 V50 L42 57 Z"/>' +
        '<path fill="#e8a317" d="M12 14 L22 7 H42 L52 14 L42 21 H22 Z"/><path fill="#f6c94e" d="M20 14 L26 9.8 H38 L44 14 L38 18.2 H26 Z"/>' +
        '<path fill="#e8a317" d="M22 21 H42 V23 Q42 25 40 25 H36 V31 A2 2 0 0 1 32 31 V25 H24 Q22 25 22 23 Z"/>' } });
  }
  function Logo(props) {
    var size = props.size || 32;
    var showWord = props.wordmark !== false;
    return h('span', { className: cx('bs-logo', props.className), role: 'img', 'aria-label': 'Basalt', style: { gap: Math.round(size * 0.18) + 'px' } },
      Mark(size),
      showWord ? h('span', { className: 'bs-logo-word', style: { fontSize: Math.round(size * 0.78) + 'px' } }, 'basalt') : null);
  }

  /* ---------- Button ---------- */
  function Button(props) {
    var variant = props.variant || 'secondary';
    var size = props.size || 'md';
    var other = rest(props, ['variant', 'size', 'icon', 'className', 'children', 'type']);
    return h('button', Object.assign({ type: props.type || 'button' }, other, {
      className: cx('bs-btn', 'bs-btn-' + variant, 'bs-btn-' + size, !props.children && 'bs-btn-icononly', props.className)
    }),
      props.icon ? h(Icon, { name: props.icon, size: size === 'sm' ? 14 : 16 }) : null,
      props.children ? h('span', null, props.children) : null);
  }

  /* ---------- Kbd ---------- */
  function Kbd(props) {
    return h('kbd', { className: cx('bs-kbd', props.className) }, props.children);
  }

  /* ---------- Tag ---------- */
  function Tag(props) {
    var label = String(props.children || '').replace(/^#/, '');
    var inner = h('span', { className: cx('bs-tag', props.active && 'bs-tag-active', props.tone === 'stone' && 'bs-tag-stone') },
      h('span', { className: 'bs-tag-hash', 'aria-hidden': true }, '#'),
      label,
      props.count != null ? h('span', { className: 'bs-tag-count' }, props.count) : null);
    if (props.onClick || props.href) {
      return h(props.href ? 'a' : 'button', {
        className: cx('bs-tag-hit', props.className), href: props.href, onClick: props.onClick,
        type: props.href ? undefined : 'button', 'aria-pressed': props.href ? undefined : !!props.active
      }, inner);
    }
    return h('span', { className: cx('bs-tag-hit', props.className) }, inner);
  }

  /* ---------- Task ---------- */
  function Task(props) {
    var controlled = props.checked != null;
    var st = React.useState(!!props.defaultChecked);
    var checked = controlled ? props.checked : st[0];
    function toggle() {
      if (props.disabled) return;
      if (!controlled) st[1](!checked);
      if (props.onChange) props.onChange(!checked);
    }
    return h('label', { className: cx('bs-task', checked && 'bs-task-done', props.disabled && 'bs-task-disabled', props.className) },
      h('button', { type: 'button', role: 'checkbox', 'aria-checked': checked, disabled: props.disabled, className: 'bs-task-cell', onClick: toggle },
        h('svg', { width: 18, height: 20, viewBox: '0 0 18 20', 'aria-hidden': true },
          h('polygon', { className: 'bs-task-ring', points: '9,0.5 17.2,5.25 17.2,14.75 9,19.5 0.8,14.75 0.8,5.25' }),
          h('polygon', { className: 'bs-task-hex', points: '9,3 15,6.5 15,13.5 9,17 3,13.5 3,6.5' }),
          h('path', { className: 'bs-task-check', d: 'M5.8 10.2l2.2 2.2 4.3-4.6' }))),
      h('span', { className: 'bs-task-text', onClick: toggle }, props.children));
  }

  /* ---------- Wikilink ---------- */
  function Wikilink(props) {
    var kind = props.external ? 'external' : props.unresolved ? 'unresolved' : 'internal';
    return h('a', {
      href: props.href || '#', onClick: props.onClick,
      className: cx('bs-link', 'bs-link-' + kind, props.className),
      title: kind === 'unresolved' ? 'Not written yet — click to create' : undefined
    }, props.children, kind === 'external' ? h(Icon, { name: 'external', size: 12, className: 'bs-link-ext' }) : null);
  }

  /* ---------- Callout ---------- */
  var CALLOUT_ICON = { note: 'note', tip: 'highlight', info: 'info', warning: 'warning' };
  var CALLOUT_TITLE = { note: 'Note', tip: 'Tip', info: 'Info', warning: 'Warning' };
  function Callout(props) {
    var kind = props.kind || 'note';
    return h('aside', { className: cx('bs-callout', 'bs-callout-' + kind, props.className), role: kind === 'warning' ? 'note' : undefined },
      h('div', { className: 'bs-callout-head' },
        h(Icon, { name: CALLOUT_ICON[kind] || 'note', size: 18 }),
        h('span', null, props.title || CALLOUT_TITLE[kind])),
      props.children ? h('div', { className: 'bs-callout-body' }, props.children) : null);
  }

  /* ---------- HexAvatar ---------- */
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '')[0] + ((parts[1] || '')[0] || '')).toUpperCase();
  }
  function HexAvatar(props) {
    var size = props.size || 32;
    var tone = props.tone || 'honey';
    return h('span', {
      className: cx('bs-avatar', 'bs-avatar-' + tone, props.className), role: 'img', 'aria-label': props.name,
      style: { width: size + 'px', height: Math.round(size * 1.1547) + 'px', fontSize: Math.round(size * 0.4) + 'px' }
    }, props.label || initials(props.name));
  }

  /* ---------- SearchField ---------- */
  function SearchField(props) {
    var other = rest(props, ['shortcut', 'className', 'placeholder']);
    return h('label', { className: cx('bs-search', props.className) },
      h(Icon, { name: 'search', size: 16 }),
      h('input', Object.assign({ type: 'search', placeholder: props.placeholder || 'Search the vault', 'aria-label': props.placeholder || 'Search the vault' }, other)),
      props.shortcut === null ? null : h(Kbd, null, props.shortcut || '⌘K'));
  }

  /* ---------- TreeItem ---------- */
  function TreeItem(props) {
    var kind = props.kind || 'note';
    var depth = props.depth || 0;
    return h('div', {
      role: 'treeitem', tabIndex: 0, 'aria-selected': !!props.active, 'aria-expanded': kind === 'folder' ? !!props.open : undefined,
      className: cx('bs-tree', props.active && 'bs-tree-active', props.className),
      style: { paddingLeft: (8 + depth * 16) + 'px' }, onClick: props.onClick
    },
      kind === 'folder'
        ? h('span', { className: cx('bs-tree-caret', props.open && 'bs-tree-caret-open') }, h(Icon, { name: 'chevron', size: 12 }))
        : h('span', { className: 'bs-tree-caret' }),
      h(Icon, { name: props.icon || kind, size: 16 }),
      h('span', { className: 'bs-tree-label' }, props.label),
      props.count != null ? h('span', { className: 'bs-tree-count' }, props.count) : null);
  }

  /* ---------- Tabs ---------- */
  function Tabs(props) {
    var tabs = props.tabs || [];
    return h('div', { role: 'tablist', className: cx('bs-tabs', props.className) },
      tabs.map(function (t) {
        var on = t.id === props.active;
        return h('div', {
          key: t.id, role: 'tab', tabIndex: on ? 0 : -1, 'aria-selected': on,
          className: cx('bs-tab', on && 'bs-tab-active'),
          onClick: props.onSelect ? function () { props.onSelect(t.id); } : undefined
        },
          t.pinned ? h(Icon, { name: 'pin', size: 12, className: 'bs-tab-pin' }) : null,
          h('span', { className: 'bs-tab-title' }, t.title),
          t.dirty ? h('span', { className: 'bs-tab-dirty', 'aria-label': 'Unsaved changes' }) : null,
          h('span', { className: 'bs-tab-close', 'aria-hidden': true }, h(Icon, { name: 'close', size: 12 })));
      }));
  }

  /* ---------- CommandPalette ---------- */
  function CommandPalette(props) {
    var items = props.items || [];
    var active = props.activeIndex || 0;
    return h('div', { className: cx('bs-palette', props.className), role: 'dialog', 'aria-label': 'Command palette' },
      h('div', { className: 'bs-palette-input' },
        h(Icon, { name: 'command', size: 18 }),
        h('input', { value: props.query || '', onChange: props.onQueryChange || function () {}, placeholder: props.placeholder || 'Type a command or a note title', 'aria-label': 'Command' })),
      h('ul', { className: 'bs-palette-list', role: 'listbox' },
        items.map(function (it, i) {
          return h('li', { key: i, role: 'option', 'aria-selected': i === active, className: cx('bs-palette-row', i === active && 'bs-palette-row-active') },
            h(Icon, { name: it.icon || 'note', size: 16 }),
            h('span', { className: 'bs-palette-label' }, it.label),
            it.hint ? h('span', { className: 'bs-palette-hint' }, it.hint) : null,
            it.shortcut ? h(Kbd, null, it.shortcut) : null);
        })),
      h('div', { className: 'bs-palette-foot' },
        h('span', null, h(Kbd, null, '↑↓'), ' move'),
        h('span', null, h(Kbd, null, '↵'), ' open'),
        h('span', null, h(Kbd, null, 'esc'), ' close')));
  }

  /* ---------- Comb ---------- */
  function hexPoints(cxp, cyp, r) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 3 * i;
      pts.push((cxp + r * Math.cos(a)).toFixed(2) + ',' + (cyp + r * Math.sin(a)).toFixed(2));
    }
    return pts.join(' ');
  }
  function Comb(props) {
    var cells = props.cells || [];
    var s = props.cellSize || 34;
    var gap = 2;
    var SQ3 = Math.sqrt(3);
    var pos = cells.map(function (c) { return { x: s * 1.5 * c.q, y: s * SQ3 * (c.r + c.q / 2), c: c }; });
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pos.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    if (!pos.length) { minX = minY = maxX = maxY = 0; }
    var pad = 4;
    var w = maxX - minX + 2 * s + 2 * pad, ht = maxY - minY + SQ3 * s + 2 * pad;
    var ox = -minX + s + pad, oy = -minY + SQ3 * s / 2 + pad;
    return h('svg', { className: cx('bs-comb', props.className), viewBox: '0 0 ' + w.toFixed(1) + ' ' + ht.toFixed(1), width: w, height: ht, role: 'img', 'aria-label': props.label || 'Comb view of linked notes' },
      pos.map(function (p, i) {
        var c = p.c, wgt = c.weight || 0;
        var cls = cx('bs-comb-cell', 'bs-comb-w' + wgt, c.active && 'bs-comb-active');
        return h('g', { key: i, className: cls, onClick: c.onClick },
          h('title', null, c.title || c.label || ''),
          h('polygon', { points: hexPoints(p.x + ox, p.y + oy, s - gap) }),
          c.label ? h('text', { x: p.x + ox, y: p.y + oy, textAnchor: 'middle', dominantBaseline: 'central' }, c.label) : null);
      }));
  }

  var api = { Logo: Logo, Icon: Icon, Button: Button, Kbd: Kbd, Tag: Tag, Task: Task, Wikilink: Wikilink, Callout: Callout, HexAvatar: HexAvatar, SearchField: SearchField, TreeItem: TreeItem, Tabs: Tabs, CommandPalette: CommandPalette, Comb: Comb };
  window.Basalt = Object.assign(window.Basalt || {}, api);
})();
