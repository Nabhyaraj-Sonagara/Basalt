import type { SemanticHit } from './semantic';

export interface AssistantContext {
  hiveName: string;
  agentsGuide?: string;
  currentNote?: { path: string; text: string };
  selection?: string;
  retrieved?: (SemanticHit & { text?: string })[];
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

/** Builds the assistant's system prompt. Stable parts come first so providers can cache them. */
export function buildSystemPrompt(ctx: AssistantContext): string {
  const parts = [
    `You are the assistant inside Basalt, a Markdown note-taking app. You are helping someone work in their hive "${ctx.hiveName}", a folder of linked Markdown notes.`,
    'Write in plain, warm, concise language. Format answers as Markdown. When you refer to a note from the hive, link it as [[Note name]] so it is clickable. When you draft note content, put it in a fenced ```markdown block so it can be inserted. Only claim something is in the hive if it appears in the notes below; say so when the notes do not answer the question.',
  ];
  if (ctx.agentsGuide?.trim()) parts.push(`<hive_conventions>\n${ctx.agentsGuide.trim()}\n</hive_conventions>`);
  if (ctx.currentNote) {
    parts.push(`<current_note path="${escapeAttr(ctx.currentNote.path)}">\n${ctx.currentNote.text}\n</current_note>`);
  }
  if (ctx.selection?.trim()) parts.push(`<selection>\n${ctx.selection}\n</selection>`);
  if (ctx.retrieved?.length) {
    const notes = ctx.retrieved
      .map((r) => `<note path="${escapeAttr(r.path)}"${r.heading ? ` section="${escapeAttr(r.heading)}"` : ''}>\n${r.text ?? r.snippet}\n</note>`)
      .join('\n');
    parts.push(`Notes from the hive that may be relevant:\n<retrieved_notes>\n${notes}\n</retrieved_notes>`);
  }
  return parts.join('\n\n');
}
