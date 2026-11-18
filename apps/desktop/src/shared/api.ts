// The contract between the Electron main process and the renderer.
import type { Backlink, FileEntry, Graph, HiveSettings, SearchResult, TreeNode, UnlinkedMention, QueryRow, NoteQuery, PropertyInfo } from '@basalt/core/browser';
import type { ProviderConfig, ChatMessage, SemanticHit, ProviderKind, ChatImage, IllustrationKind } from '@basalt/ai/types-only';
export type { ChatImage, IllustrationKind };

export interface NoteSummary {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  headings: { level: number; text: string; line: number }[];
  blocks: string[];
  mtime: number;
  wordCount: number;
  /** Frontmatter `view`, e.g. 'mindmap'. */
  view?: string;
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

export type PluginPermission = 'read' | 'write';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  permissions: PluginPermission[];
  main: string;
  panel?: string;
}

/** A folder in .basalt/plugins: its manifest, or why it can't load. */
export interface PluginInfo {
  folder: string;
  manifest?: PluginManifest;
  error?: string;
}

export interface IllustrateRequest {
  /** Lets the renderer cancel the request. */
  id?: string;
  kind: IllustrationKind;
  /** Note to illustrate. */
  notePath?: string;
  /** A sketch or photo to illustrate. */
  image?: ChatImage;
  instructions?: string;
  /** Defaults to the assistant's chat model. */
  providerId?: string;
}

export type ChatEvent = { id: string; type: 'delta'; text: string } | { id: string; type: 'done'; sources: string[] } | { id: string; type: 'error'; message: string };

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported';
  /** The running version. */
  version: string;
  latest?: string;
  percent?: number;
  /** Set when the update has to be downloaded by hand (unsigned macOS builds). */
  downloadUrl?: string;
  error?: string;
}

/** A basalt:// link, with its hive resolved to a folder the user has opened before. */
export interface UriRequest {
  action: 'open' | 'new' | 'daily' | 'search';
  hivePath: string | null;
  file?: string;
  name?: string;
  content?: string;
  query?: string;
  error?: string;
}

export interface SyncStatus {
  /** Sync server address ('' until set). */
  server: string;
  email: string | null;
  signedIn: boolean;
  /** False when the OS keychain isn't available; then sign-in lasts until Basalt quits. */
  keychain: boolean;
  /** The remote hive the open hive syncs with. */
  linked: { hiveId: string; name: string; paused: boolean } | null;
  state: 'off' | 'idle' | 'syncing' | 'paused' | 'offline' | 'error';
  lastSync: number | null;
  error: string | null;
  /** Conflict copies made this session (hive paths). */
  conflicts: string[];
}

export type ConnectClientId = 'claude-desktop' | 'claude-code' | 'codex';

export interface ConnectStatus {
  id: ConnectClientId;
  label: string;
  /** The plan the app runs on, e.g. "Claude Pro or Max". */
  plan: string;
  installed: boolean;
  /** The open hive is set up in this app. */
  connected: boolean;
}

export interface LocalModels {
  id: 'ollama' | 'lmstudio';
  label: string;
  baseUrl: string;
  models: string[];
  embeddingModels: string[];
}

export interface AppInfo {
  version: string;
  platform: string;
  /** Set in a pop-out window: the note it shows. */
  popout: string | null;
}

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
    info(): Promise<AppInfo>;
    /** Save dialog; writes `text` to the chosen file. Returns the path, or null if cancelled. */
    saveTextFile(defaultName: string, text: string): Promise<string | null>;
    /** Open dialog for a text file (for example a theme). Returns its contents, or null if cancelled. */
    openTextFile(extensions: string[]): Promise<string | null>;
    popout(path: string): Promise<void>;
    setSpellcheck(on: boolean): Promise<void>;
    takePendingUri(): Promise<UriRequest | null>;
    onUri(cb: (u: UriRequest) => void): () => void;
    /** Menu bar and context-menu commands, by command id. */
    onCommand(cb: (id: string) => void): () => void;
    checkForUpdates(): Promise<UpdateStatus>;
    installUpdate(): Promise<void>;
    updateStatus(): Promise<UpdateStatus>;
    onUpdate(cb: (s: UpdateStatus) => void): () => void;
  };
  hive: {
    snapshot(): Promise<HiveSnapshot>;
    read(path: string): Promise<string>;
    readSubpath(path: string, subpath?: string): Promise<string>;
    write(path: string, text: string): Promise<void>;
    create(path: string, text?: string, template?: string): Promise<string>;
    createFolder(path: string): Promise<string>;
    rename(from: string, to: string): Promise<{ path: string; updated: string[] }>;
    merge(source: string, target: string): Promise<{ path: string; updated: string[] }>;
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
  sync: {
    status(): Promise<SyncStatus>;
    setServer(url: string): Promise<SyncStatus>;
    signUp(email: string, password: string): Promise<SyncStatus>;
    signIn(email: string, password: string): Promise<SyncStatus>;
    signOut(): Promise<SyncStatus>;
    usage(): Promise<{ usageBytes: number; quotaBytes: number } | null>;
    remoteHives(): Promise<{ id: string; name: string }[]>;
    /** Links the open hive to a remote hive, or to a new one when `remoteId` is null. */
    connect(remoteId: string | null): Promise<SyncStatus>;
    disconnect(): Promise<SyncStatus>;
    setPaused(paused: boolean): Promise<SyncStatus>;
    now(): Promise<SyncStatus>;
    onStatus(cb: (s: SyncStatus) => void): () => void;
  };
  plugins: {
    list(): Promise<PluginInfo[]>;
    /** Asks for a plugin folder and copies it into this hive; resolves with its id, or null if cancelled. */
    install(): Promise<string | null>;
    remove(id: string): Promise<void>;
    reveal(): Promise<void>;
  };
  connect: {
    status(): Promise<ConnectStatus[]>;
    /** Sets the open hive up in an AI app; resolves with what to do next (e.g. restart the app). */
    add(id: ConnectClientId): Promise<string>;
    remove(id: ConnectClientId): Promise<void>;
    /** The command other MCP clients can use to start Basalt for the open hive. */
    launchCommand(): Promise<{ command: string; args: string[] }>;
  };
  ai: {
    presets(): Promise<{ id: string; kind: ProviderKind; label: string; baseUrl?: string; model: string; embeddingModel?: string; needsKey: boolean; local?: boolean }[]>;
    settings(): Promise<AiSettings>;
    saveProvider(p: ProviderSettings, apiKey?: string | null): Promise<AiSettings>;
    removeProvider(id: string): Promise<AiSettings>;
    setChatProvider(id: string | null): Promise<AiSettings>;
    setEmbeddings(id: string): Promise<AiSettings>;
    listModels(id: string): Promise<string[]>;
    /** Opens OpenRouter in the browser to approve Basalt, then saves the key it returns. */
    signInOpenRouter(): Promise<AiSettings>;
    detectLocal(): Promise<LocalModels[]>;
    /** Adds a model server found on this computer, with the chosen models. */
    useLocal(id: 'ollama' | 'lmstudio', model: string, embeddingModel?: string): Promise<AiSettings>;
    chat(req: ChatStart): Promise<void>;
    cancel(id: string): Promise<void>;
    /** Asks the chat model for a mind-map outline or Mermaid diagram of a note or picture. */
    illustrate(req: IllustrateRequest): Promise<{ text: string }>;
    cancelIllustrate(id: string): Promise<void>;
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
