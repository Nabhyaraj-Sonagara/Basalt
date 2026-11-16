export interface Pos {
  /** 0-based character offsets into the full file text. */
  start: number;
  end: number;
  /** 0-based line number of start. */
  line: number;
}

export interface LinkRef extends Pos {
  /** The exact source text, e.g. `[[Note#Heading|shown]]`. */
  raw: string;
  /** Link target without subpath or display, e.g. `Note` or `folder/Note.md`. */
  target: string;
  /** `#Heading` or `#^block`, including the leading `#`. */
  subpath?: string;
  display?: string;
  embed: boolean;
  kind: 'wiki' | 'markdown';
}

export interface Heading extends Pos {
  level: number;
  text: string;
}

export interface TagRef extends Pos {
  /** Tag without `#`, e.g. `project/basalt`. */
  tag: string;
}

export interface BlockId extends Pos {
  id: string;
}

export interface TaskItem extends Pos {
  text: string;
  status: ' ' | 'x' | 'X' | '-' | string;
  done: boolean;
}

export interface Section {
  /** Heading text this section sits under, or '' before the first heading. */
  heading: string;
  startLine: number;
  endLine: number;
}

export interface NoteMeta {
  frontmatter: Record<string, unknown>;
  /** Character offset where the body starts (after frontmatter). */
  bodyStart: number;
  aliases: string[];
  /** All tags, inline and frontmatter, without `#`, deduplicated. */
  tags: string[];
  inlineTags: TagRef[];
  links: LinkRef[];
  embeds: LinkRef[];
  headings: Heading[];
  blocks: BlockId[];
  tasks: TaskItem[];
  sections: Section[];
  wordCount: number;
}

export interface NoteRecord extends NoteMeta {
  path: string;
  /** File name without extension. */
  basename: string;
  /** frontmatter `title` if present, otherwise basename. */
  title: string;
  mtime: number;
  size: number;
}

export interface FileEntry {
  path: string;
  kind: 'file' | 'folder';
  /** Extension without dot, lowercase; '' for folders. */
  ext: string;
  mtime: number;
  size: number;
}

export interface TreeNode {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  ext: string;
  children?: TreeNode[];
}

export interface Backlink {
  source: string;
  link: LinkRef;
  /** The line containing the link, trimmed. */
  context: string;
}

export interface UnlinkedMention {
  source: string;
  line: number;
  context: string;
  start: number;
  end: number;
}

export interface SearchMatch {
  line: number;
  text: string;
  /** Ranges inside `text` to highlight. */
  ranges: [number, number][];
}

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  matches: SearchMatch[];
}

export interface GraphNode {
  id: string;
  title: string;
  resolved: boolean;
  degree: number;
  tags: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
