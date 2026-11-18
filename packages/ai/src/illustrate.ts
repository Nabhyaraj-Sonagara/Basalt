// Turning a note, a sketch or a photo into a picture Basalt can keep as text: a mind-map outline
// or a Mermaid diagram. The model only ever writes text; Basalt renders it.

export type IllustrationKind = 'mindmap' | 'flowchart' | 'sequence' | 'chart';

export const ILLUSTRATION_KINDS: { id: IllustrationKind; label: string }[] = [
  { id: 'mindmap', label: 'Mind map' },
  { id: 'flowchart', label: 'Flowchart' },
  { id: 'sequence', label: 'Sequence diagram' },
  { id: 'chart', label: 'Chart' },
];

const FORMATS: Record<IllustrationKind, string> = {
  mindmap: `Write a mind map as Markdown: one "# " heading for the central idea, then a nested bulleted list ("- ", two spaces per level) for the branches. Keep each branch to a few words. At most 4 levels deep. Output only the heading and the list.`,
  flowchart: `Write a Mermaid flowchart. Start with "flowchart TD" (or "flowchart LR" if it reads better left to right). Use short node labels in quotes, e.g. A["Start"] --> B{"Ready?"}. Output only the Mermaid source.`,
  sequence: `Write a Mermaid sequence diagram. Start with "sequenceDiagram", declare participants, then the messages in order. Output only the Mermaid source.`,
  chart: `Write a Mermaid chart of the numbers. Use "pie title ..." for parts of a whole, otherwise "xychart-beta" with a title, x-axis, y-axis and "bar" or "line" series. Use only numbers you can see or that are stated; never invent data. Output only the Mermaid source.`,
};

export interface IllustrationInput {
  kind: IllustrationKind;
  /** Title of the note the picture is about, if any. */
  title?: string;
  /** Note text to illustrate. */
  text?: string;
  /** True when a sketch or photo is attached to the request. */
  hasImage?: boolean;
  /** Anything extra the person asked for. */
  instructions?: string;
}

export function illustrationPrompt(input: IllustrationInput): { system: string; user: string } {
  const system = [
    'You turn notes, sketches and photos into clear diagrams inside a Markdown notes app.',
    FORMATS[input.kind],
    'Do not add explanations, apologies or code fences around the answer.',
    input.hasImage ? 'The picture may be a rough hand drawing, a whiteboard photo or a screenshot. Read its text and structure faithfully; tidy wording, but keep what it says.' : '',
  ]
    .filter(Boolean)
    .join('\n');
  const parts: string[] = [];
  if (input.hasImage) parts.push('Illustrate the attached picture.');
  if (input.text) parts.push(`Illustrate this note${input.title ? ` ("${input.title}")` : ''}:\n\n${input.text.slice(0, 40000)}`);
  if (!parts.length && input.title) parts.push(`Illustrate the topic "${input.title}".`);
  if (input.instructions?.trim()) parts.push(`Also: ${input.instructions.trim()}`);
  return { system, user: parts.join('\n\n') };
}

const MERMAID_START: Record<Exclude<IllustrationKind, 'mindmap'>, RegExp> = {
  flowchart: /^(flowchart|graph)\b/,
  sequence: /^sequenceDiagram\b/,
  chart: /^(pie\b|xychart-beta\b|xychart\b)/,
};

/** Pulls the diagram out of a model's answer, dropping chatter and fences. Throws if there is none. */
export function extractIllustration(kind: IllustrationKind, output: string): string {
  let text = output.replace(/\r\n/g, '\n').trim();
  const fence = /```[\w-]*\n([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1].trim();
  const lines = text.split('\n');
  if (kind === 'mindmap') {
    const start = lines.findIndex((l) => /^#\s+\S/.test(l) || /^\s*[-*+]\s+\S/.test(l));
    if (start < 0) throw new Error("The assistant didn't return a mind map. Try again, or pick another model.");
    const kept = lines.slice(start).filter((l, i) => i === 0 || /^\s*([-*+]|\d+[.)])\s+\S/.test(l) || !l.trim());
    return kept.join('\n').trim() + '\n';
  }
  const start = lines.findIndex((l) => MERMAID_START[kind].test(l.trim()));
  if (start < 0) throw new Error("The assistant didn't return a diagram. Try again, or pick another model.");
  return lines.slice(start).join('\n').trim() + '\n';
}
