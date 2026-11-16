/* @ds-bundle: {"format":4,"namespace":"Basalt","components":[{"name":"Logo"},{"name":"Icon"},{"name":"Button"},{"name":"Kbd"},{"name":"Tag"},{"name":"Task"},{"name":"Wikilink"},{"name":"Callout"},{"name":"HexAvatar"},{"name":"SearchField"},{"name":"TreeItem"},{"name":"Tabs"},{"name":"CommandPalette"},{"name":"Comb"},{"name":"EmptyState"},{"name":"HoverPreview"},{"name":"SettingRow"},{"name":"Toggle"},{"name":"Select"},{"name":"Toast"}]} */
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
        '<path fill="#6b6259" d="M12 14 L22 21 V43 L12 36 Z"/><path fill="#48423b" d="M22 21 H42 V43 H22 Z"/><path fill="#34302b" d="M42 21 L52 14 V36 L42 43 Z"/>' +
        '<path fill="#6b6259" d="M12 38.5 L22 45.5 V57 L12 50 Z"/><path fill="#48423b" d="M22 45.5 H42 V57 H22 Z"/><path fill="#34302b" d="M42 45.5 L52 38.5 V50 L42 57 Z"/>' +
        '<path fill="#9a9083" d="M12 14 L22 7 H42 L52 14 L42 21 H22 Z"/><path fill="#887e72" d="M20 14 L26 9.8 H38 L44 14 L38 18.2 H26 Z"/>' } });
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
      h('input', Object.assign({ type: 'search', placeholder: props.placeholder || 'Search this hive', 'aria-label': props.placeholder || 'Search this hive' }, other)),
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

  /* ---------- EmptyState ---------- */
  var CAUSEWAY = '<path fill="#6b6259" d="M8 34 L18 41 V69 L8 62 Z"/>' +
    '<path fill="#48423b" d="M18 41 H38 V69 H18 Z"/>' +
    '<path fill="#34302b" d="M38 41 L48 34 V62 L38 69 Z"/>' +
    '<path fill="#7d7468" d="M8 34 L18 27 H38 L48 34 L38 41 H18 Z"/>' +
    '<path fill="#6b6259" d="M72 44 L82 51 V73 L72 66 Z"/>' +
    '<path fill="#48423b" d="M82 51 H102 V73 H82 Z"/>' +
    '<path fill="#34302b" d="M102 51 L112 44 V66 L102 73 Z"/>' +
    '<path fill="#7d7468" d="M72 44 L82 37 H102 L112 44 L102 51 H82 Z"/>' +
    '<path fill="#6b6259" d="M40 18 L50 25 V49 L40 42 Z"/>' +
    '<path fill="#48423b" d="M50 25 H70 V49 H50 Z"/>' +
    '<path fill="#34302b" d="M70 25 L80 18 V42 L70 49 Z"/>' +
    '<path fill="#6b6259" d="M40 44.5 L50 51.5 V75 L40 68 Z"/>' +
    '<path fill="#48423b" d="M50 51.5 H70 V75 H50 Z"/>' +
    '<path fill="#34302b" d="M70 51.5 L80 44.5 V68 L70 75 Z"/>' +
    '<path fill="#9a9083" d="M40 18 L50 11 H70 L80 18 L70 25 H50 Z"/>' +
    '<path fill="#887e72" d="M48 18 L54 13.8 H66 L72 18 L66 22.2 H54 Z"/>';

  // Deterministic honeycomb: an oval clearing for the content, cells growing denser toward the edges. No gradients, just fewer cells.
  function combPattern(w, ht, r) {
    var cells = [], dx = 1.5 * r, dy = Math.sqrt(3) * r, cxp = w / 2, cyp = ht / 2;
    for (var c = -1; c * dx < w + r; c++) {
      for (var row = -1; row * dy < ht + r; row++) {
        var x = c * dx, y = row * dy + (c % 2 ? dy / 2 : 0);
        var ex = (x - cxp) / (w * 0.33), ey = (y - cyp) / (ht * 0.42);
        var e = Math.sqrt(ex * ex + ey * ey);
        var n = Math.abs(Math.sin(c * 12.9898 + row * 78.233) * 43758.5453) % 1;
        if (e < 1 || n > (e - 1) * 2.4) continue;
        cells.push(h('polygon', { key: c + ':' + row, className: n < 0.1 ? 'bs-empty-cell-accent' : 'bs-empty-cell', points: hexPoints(x, y, r - 1.5) }));
      }
    }
    return cells;
  }
  function EmptyState(props) {
    var compact = !!props.compact;
    var art = props.illustration === 'causeway'
      ? h('svg', { className: 'bs-empty-art', width: 120, height: 80, viewBox: '0 0 120 80', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: CAUSEWAY } })
      : h('span', { className: 'bs-empty-well' }, h(Icon, { name: props.icon || 'note', size: compact ? 18 : 24 }));
    var W = 640, H = 320;
    return h('section', { className: cx('bs-empty', compact && 'bs-empty-compact', props.className) },
      !compact && props.pattern !== false
        ? h('svg', { className: 'bs-empty-pattern', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': true }, combPattern(W, H, 22))
        : null,
      h('div', { className: 'bs-empty-body' },
        art,
        h('h2', { className: 'bs-empty-title' }, props.title),
        props.children ? h('div', { className: 'bs-empty-text' }, props.children) : null,
        props.actions ? h('div', { className: 'bs-empty-actions' }, props.actions) : null));
  }

  /* ---------- HoverPreview ---------- */
  function HoverPreview(props) {
    var unresolved = !!props.unresolved;
    var lines = props.maxLines || 6;
    return h('div', { className: cx('bs-hover', unresolved && 'bs-hover-unresolved', props.className), role: 'tooltip', style: props.style },
      h('div', { className: 'bs-hover-head' },
        h('span', { className: 'bs-hover-well' }, h(Icon, { name: unresolved ? 'new-note' : 'note', size: 14 })),
        h('div', { className: 'bs-hover-titles' },
          h('div', { className: 'bs-hover-title' }, props.title),
          props.path ? h('div', { className: 'bs-hover-path' }, props.path) : null),
        !unresolved && props.onOpen ? h(Button, { variant: 'quiet', size: 'sm', icon: 'external', 'aria-label': 'Open in new tab', onClick: props.onOpen }) : null),
      unresolved
        ? h('div', { className: 'bs-hover-body' },
            h('p', { className: 'bs-hover-empty' }, 'Not written yet. ', props.backlinks ? props.backlinks + (props.backlinks === 1 ? ' note links' : ' notes link') + ' here already.' : ''),
            h(Button, { variant: 'primary', size: 'sm', icon: 'new-note', onClick: props.onCreate }, 'Create note'))
        : h('div', { className: 'bs-hover-body' },
            props.heading ? h('div', { className: 'bs-hover-heading' }, props.heading) : null,
            h('div', { className: 'bs-hover-excerpt', style: { WebkitLineClamp: lines } }, props.children)),
      !unresolved && (props.tags || props.meta || props.backlinks != null)
        ? h('div', { className: 'bs-hover-foot' },
            (props.tags || []).map(function (t) { return h(Tag, { key: t }, t); }),
            h('span', { className: 'bs-hover-meta' },
              [props.meta, props.backlinks != null ? props.backlinks + ' backlinks' : null].filter(Boolean).join(' · ')))
        : null);
  }

  /* ---------- Toggle ---------- */
  function Toggle(props) {
    var controlled = props.checked != null;
    var st = React.useState(!!props.defaultChecked);
    var on = controlled ? props.checked : st[0];
    function flip() {
      if (props.disabled) return;
      if (!controlled) st[1](!on);
      if (props.onChange) props.onChange(!on);
    }
    return h('button', {
      type: 'button', role: 'switch', 'aria-checked': on, 'aria-label': props.label, 'aria-labelledby': props['aria-labelledby'],
      id: props.id, disabled: props.disabled, onClick: flip,
      className: cx('bs-toggle', on && 'bs-toggle-on', props.className)
    }, h('span', { className: 'bs-toggle-track' }, h('span', { className: 'bs-toggle-thumb' })));
  }

  /* ---------- Select ---------- */
  function Select(props) {
    var other = rest(props, ['options', 'className']);
    return h('span', { className: cx('bs-select', props.className) },
      h('select', other, (props.options || []).map(function (o) {
        var opt = typeof o === 'string' ? { value: o, label: o } : o;
        return h('option', { key: opt.value, value: opt.value }, opt.label);
      })),
      h(Icon, { name: 'chevron', size: 14, className: 'bs-select-caret' }));
  }

  /* ---------- SettingsGroup / SettingRow ---------- */
  function SettingsGroup(props) {
    return h('section', { className: cx('bs-settings', props.className) },
      props.title ? h('h3', { className: 'bs-settings-title' }, props.title) : null,
      props.description ? h('p', { className: 'bs-settings-desc' }, props.description) : null,
      h('div', { className: 'bs-settings-card' }, props.children));
  }
  var rowSeq = 0;
  function SettingRow(props) {
    var idRef = React.useRef(null);
    if (!idRef.current) idRef.current = 'bs-setting-' + (++rowSeq);
    var labelId = idRef.current + '-label';
    var control = props.children;
    // Give a single control element its accessible name from the row label, unless it already has one.
    if (React.isValidElement(control) && !control.props['aria-label'] && !control.props['aria-labelledby']) {
      control = React.cloneElement(control, { 'aria-labelledby': labelId });
    }
    return h('div', { className: cx('bs-setting', props.tone === 'danger' && 'bs-setting-danger', props.disabled && 'bs-setting-disabled', props.className) },
      h('div', { className: 'bs-setting-text' },
        h('div', { className: 'bs-setting-label', id: labelId },
          props.label,
          props.badge ? h(Tag, { tone: 'stone' }, props.badge) : null),
        props.description ? h('div', { className: 'bs-setting-desc' }, props.description) : null),
      h('div', { className: 'bs-setting-control' }, control));
  }

  /* ---------- Toast ---------- */
  var TOAST_ICON = { neutral: 'note', success: 'task', danger: 'warning', progress: 'info' };
  function Toast(props) {
    var tone = props.tone || 'neutral';
    var cells = 10;
    var filled = props.progress != null ? Math.round(Math.max(0, Math.min(1, props.progress)) * cells) : 0;
    return h('div', {
      className: cx('bs-toast', 'bs-toast-' + tone, props.className),
      role: tone === 'danger' ? 'alert' : 'status', 'aria-live': tone === 'danger' ? 'assertive' : 'polite'
    },
      h('span', { className: 'bs-toast-well' }, h(Icon, { name: props.icon || TOAST_ICON[tone] || 'note', size: 16 })),
      h('div', { className: 'bs-toast-text' },
        h('div', { className: 'bs-toast-title' }, props.title),
        props.children ? h('div', { className: 'bs-toast-desc' }, props.children) : null,
        props.progress != null
          ? h('div', { className: 'bs-toast-cells', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(props.progress * 100) },
              Array.apply(null, Array(cells)).map(function (_, i) { return h('span', { key: i, className: cx('bs-toast-cell', i < filled && 'bs-toast-cell-on') }); }))
          : null),
      props.action ? h(Button, { variant: 'quiet', size: 'sm', className: 'bs-toast-action', onClick: props.action.onClick }, props.action.label) : null,
      props.onClose ? h(Button, { variant: 'quiet', size: 'sm', icon: 'close', 'aria-label': 'Dismiss', className: 'bs-toast-close', onClick: props.onClose }) : null);
  }
  function ToastStack(props) {
    return h('div', { className: cx('bs-toasts', props.className), 'aria-label': 'Notifications' }, props.children);
  }

  var api = { Logo: Logo, Icon: Icon, Button: Button, Kbd: Kbd, Tag: Tag, Task: Task, Wikilink: Wikilink, Callout: Callout, HexAvatar: HexAvatar, SearchField: SearchField, TreeItem: TreeItem, Tabs: Tabs, CommandPalette: CommandPalette, Comb: Comb, EmptyState: EmptyState, HoverPreview: HoverPreview, SettingsGroup: SettingsGroup, SettingRow: SettingRow, Toggle: Toggle, Select: Select, Toast: Toast, ToastStack: ToastStack };
  window.Basalt = Object.assign(window.Basalt || {}, api);
})();
