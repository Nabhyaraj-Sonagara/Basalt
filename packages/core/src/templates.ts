import dayjs from 'dayjs';

export interface TemplateContext {
  title: string;
  date?: Date;
}

/**
 * Template variables:
 *   {{title}}  {{date}}  {{time}}  {{date:YYYY-MM-DD}}  {{time:HH:mm}}
 *   {{yesterday}} {{tomorrow}} (with optional :FORMAT)
 */
export function applyTemplate(template: string, ctx: TemplateContext, formats = { date: 'YYYY-MM-DD', time: 'HH:mm' }): string {
  const now = dayjs(ctx.date ?? new Date());
  return template.replace(/\{\{\s*(title|date|time|yesterday|tomorrow)(?::([^}]+))?\s*\}\}/g, (_m, name: string, fmt?: string) => {
    switch (name) {
      case 'title':
        return ctx.title;
      case 'date':
        return now.format(fmt?.trim() || formats.date);
      case 'time':
        return now.format(fmt?.trim() || formats.time);
      case 'yesterday':
        return now.subtract(1, 'day').format(fmt?.trim() || formats.date);
      case 'tomorrow':
        return now.add(1, 'day').format(fmt?.trim() || formats.date);
      default:
        return _m;
    }
  });
}

export function formatDate(date: Date, format: string): string {
  return dayjs(date).format(format);
}

/** Path of the daily note for `date`, e.g. `Daily/2026-11-16.md`. The format may contain `/` for subfolders. */
export function dailyNotePath(date: Date, format: string, folder: string): string {
  const name = dayjs(date).format(format || 'YYYY-MM-DD');
  return `${folder ? folder.replace(/\/+$/, '') + '/' : ''}${name}.md`;
}

/** Name for the unique-note creator, e.g. `202611160912 Untitled`. */
export function uniqueNoteName(date: Date, format = 'YYYYMMDDHHmm', suffix = ''): string {
  return `${dayjs(date).format(format)}${suffix ? ' ' + suffix : ''}`;
}
