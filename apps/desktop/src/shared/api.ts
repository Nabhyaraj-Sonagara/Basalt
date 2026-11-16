// The contract between the Electron main process and the renderer.
import type { Backlink, FileEntry, Graph, HiveSettings, SearchResult, TreeNode, UnlinkedMention, QueryRow, NoteQuery, PropertyInfo } from '@basalt/core/browser';
import type { ProviderConfig, ChatMessage, SemanticHit, ProviderKind } from '@basalt/ai/types-only';

export interface NoteSummary {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  headings: { level: number; text: string; line: number }[];
  blocks: string[];
  mtime: number;
  wordCount: number;
}

export interface HiveInfo {
  root: string;
  name: string;
  settings: HiveSettings;
}

export interface HiveSnapshot {
  info: HiveInfo;
  tree: TreeNode;
  files: FileEntry[];
  notes: NoteSummary[];
}

export type HiveChange = { type: 'create' | 'modify' | 'delete'; path: string } | { type: 'rename'; path: string; oldPath: string };

export interface ProviderSettings extends Omit<ProviderConfig, 'apiKey'> {
  hasKey: boolean;
}

export interface AiSettings {
  providers: ProviderSettings[];
  chatProvider: string | null;
  /** Provider id used for embeddings, or 'builtin'. */
  embeddings: string;
  keychain: boolean;
}

export interface ChatStart {
  id: string;
  providerId: string;
  messages: ChatMessage[];
  context: { notePath?: string; selection?: string; useHive: boolean };
}

export type ChatEvent = { id: string; type: 'delta'; text: string } | { id: string; type: 'done'; sources: string[] } | { id: string; type: 'error'; message: string };

export interface BasaltApi {
  app: {
    recent(): Promise<{ path: string; name: string; opened: number }[]>;
    pickFolder(): Promise<string | null>;
    openHive(path: string, opts?: { create?: boolean }): Promise<HiveSnapshot>;
    closeHive(): Promise<void>;
    sampleHivePath(): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    showInFolder(path: string): Promise<void>;
    cliCommand(): Promise<string>;
    initialHive(): Promise<string | null>;
  };
  hive: {
    snapshot(): Promise<HiveSnapshot>;
    read(path: string): Promise<string>;
    readSubpath(path: string, subpath?: string): Promise<string>;
    write(path: string, text: string): Promise<void>;
    create(path: string, text?: string, template?: string): Promise<string>;
    createFolder(path: string): Promise<string>;
    rename(from: string, to: string): Promise<{ path: string; updated: string[] }>;
    trash(path: string): Promise<void>;
    toggleTask(path: string, line: number): Promise<boolean | null>;
    setProperties(path: string, changes: Record<string, unknown>): Promise<void>;
    backlinks(path: string): Promise<Backlink[]>;
    unlinked(path: string): Promise<UnlinkedMention[]>;
    search(query: string): Promise<SearchResult[]>;
    tags(): Promise<{ tag: string; count: number }[]>;
    graph(): Promise<Graph>;
    query(q: NoteQuery): Promise<QueryRow[]>;
    properties(): Promise<PropertyInfo[]>;
    dailyNote(dateIso?: string): Promise<string>;
    uniqueNote(): Promise<string>;
    templates(): Promise<string[]>;
    saveSettings(patch: Partial<HiveSettings>): Promise<HiveSettings>;
    readConfig<T>(name: string): Promise<T | null>;
    writeConfig(name: string, data: unknown): Promise<void>;
    readConfigText(name: string): Promise<string | null>;
    writeConfigText(name: string, text: string): Promise<void>;
    snippets(): Promise<{ name: string; css: string }[]>;
    snapshots(path: string): Promise<{ time: number; file: string }[]>;
    readSnapshot(path: string, file: string): Promise<string>;
    saveAttachment(name: string, data: Uint8Array): Promise<string>;
    fileUrl(path: string): string;
    onChange(cb: (changes: HiveChange[]) => void): () => void;
  };
  ai: {
    presets(): Promise<{ id: string; kind: ProviderKind; label: string; baseUrl?: string; model: string; embeddingModel?: string; needsKey: boolean; local?: boolean }[]>;
    settings(): Promise<AiSettings>;
    saveProvider(p: ProviderSettings, apiKey?: string | null): Promise<AiSettings>;
    removeProvider(id: string): Promise<AiSettings>;
    setChatProvider(id: string | null): Promise<AiSettings>;
    setEmbeddings(id: string): Promise<AiSettings>;
    listModels(id: string): Promise<string[]>;
    chat(req: ChatStart): Promise<void>;
    cancel(id: string): Promise<void>;
    onChat(cb: (e: ChatEvent) => void): () => void;
    semanticSearch(query: string): Promise<SemanticHit[]>;
    related(path: string, unlinkedOnly?: boolean): Promise<SemanticHit[]>;
    reindex(): Promise<{ chunks: number }>;
    onIndexProgress(cb: (p: { done: number; total: number }) => void): () => void;
  };
}

declare global {
  interface Window {
    basalt: BasaltApi;
  }
}
