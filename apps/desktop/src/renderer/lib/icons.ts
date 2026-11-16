import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon, type IconName } from '@basalt/ui';

const cache = new Map<string, string>();

/** SVG markup for a design-system icon, for HTML produced outside React (Markdown, CodeMirror widgets). */
export function iconSvg(name: string, size = 18): string {
  const key = `${name}:${size}`;
  let svg = cache.get(key);
  if (!svg) {
    svg = renderToStaticMarkup(createElement(Icon, { name: name as IconName, size }));
    cache.set(key, svg);
  }
  return svg;
}
