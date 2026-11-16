import { LabeledToggle } from './LabeledToggle';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, EmptyState, Select, Tag } from '@basalt/ui';
import type { AiSettings, ChatEvent } from '../../shared/api';
import { api, createNote, errorToast, openLink, openPath } from '../lib/actions';
import { renderNoteHtml } from '../lib/render';
import { getState, noteTitle, setState, toast, useStore } from '../lib/store';
import { editorFor } from './Editor';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  error?: string;
  pending?: boolean;
}

// The conversation lives outside React so it survives switching panels.
let messages: Msg[] = [];
let streamingId: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const setMessages = (m: Msg[]) => {
  messages = m;
  emit();
};
const useMessages = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => messages);

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  api().ai.onChat((e: ChatEvent) => {
    if (e.id !== streamingId) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (e.type === 'delta') setMessages([...messages.slice(0, -1), { ...last, content: last.content + e.text }]);
    else if (e.type === 'done') {
      streamingId = null;
      setMessages([...messages.slice(0, -1), { ...last, pending: false, sources: e.sources }]);
    } else {
      streamingId = null;
      setMessages([...messages.slice(0, -1), { ...last, pending: false, error: e.message }]);
    }
  });
}

function markdownBlocks(text: string): string[] {
  return [...text.matchAll(/```(?:markdown|md)\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd());
}

function AssistantMessage({ m, notePath }: { m: Msg; notePath: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = renderNoteHtml(m.content || (m.pending ? '…' : ''), notePath ?? '');
  }, [m.content, m.pending, notePath]);
  const blocks = m.pending ? [] : markdownBlocks(m.content);
  const insert = (text: string) => {
    const tab = getState().panes.flatMap((p) => p.tabs).find((t) => t.path === notePath && t.kind === 'note');
    const view = tab ? editorFor(tab.id) : undefined;
    if (view) {
      const pos = view.state.selection.main.head;
      view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
      view.focus();
    } else if (notePath) {
      void api().hive.read(notePath).then((t) => api().hive.write(notePath, `${t.replace(/\s*$/, '')}\n\n${text}\n`));
      toast({ tone: 'success', title: `Added to ${noteTitle(notePath)}` });
    }
  };
  return (
    <div className="msg msg-assistant">
      <div
        ref={ref}
        className="prose msg-body"
        onClick={(e) => {
          const link = (e.target as HTMLElement).closest<HTMLElement>('a[data-target], a[data-external]');
          if (!link) return;
          e.preventDefault();
          if (link.dataset.external) void api().app.openExternal(link.dataset.external);
          else void openLink(link.dataset.target ?? '', link.dataset.subpath || undefined, notePath ?? '', {});
        }}
      />
      {m.error ? <div className="msg-error">{m.error}</div> : null}
      {blocks.map((b, i) => (
        <div key={i} className="msg-actions">
          <span className="muted">Draft {blocks.length > 1 ? i + 1 : ''}</span>
          {notePath ? (
            <Button size="sm" variant="secondary" onClick={() => insert(b)}>
              Insert into note
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="quiet"
            onClick={async () => {
              const title = /^#\s+(.+)$/m.exec(b)?.[1]?.replace(/[\\/:*?"<>|#^[\]]/g, '-') ?? 'Assistant draft';
              const p = await createNote(title, { text: b });
              if (p) openPath(p, { newTab: true });
            }}
          >
            Save as new note
          </Button>
        </div>
      ))}
      {m.sources?.length ? (
        <div className="msg-sources">
          <span className="muted">From your hive:</span>
          {m.sources.map((s) => (
            <Tag key={s} tone="stone" onClick={() => openPath(s)}>
              {noteTitle(s)}
            </Tag>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Assistant({ notePath }: { notePath: string | null }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const msgs = useMessages();
  const selection = useStore((s) => s.selection);
  const [input, setInput] = useState('');
  const [useNote, setUseNote] = useState(true);
  const [useHive, setUseHive] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listen();
    void api().ai.settings().then(setSettings);
  }, []);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [msgs]);

  if (!settings) return null;
  const chatProviders = settings.providers.filter((p) => p.model && (p.hasKey || p.kind === 'openai-compatible'));
  if (!chatProviders.length) {
    return (
      <EmptyState
        compact
        icon="highlight"
        title="Connect a model"
        actions={
          <Button variant="primary" onClick={() => setState({ settingsOpen: 'assistant' })}>
            Set up the assistant
          </Button>
        }
      >
        Use Claude, OpenAI, Gemini or a local model through Ollama or LM Studio. Keys stay in your system keychain.
      </EmptyState>
    );
  }
  const providerId = chatProviders.some((p) => p.id === settings.chatProvider) ? settings.chatProvider! : chatProviders[0].id;
  const streaming = msgs.some((m) => m.pending);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    const history = [...msgs.filter((m) => !m.error), { role: 'user' as const, content: text }];
    setMessages([...history, { role: 'assistant', content: '', pending: true }]);
    const id = `c${Date.now()}`;
    streamingId = id;
    try {
      await api().ai.chat({
        id,
        providerId,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        context: { notePath: useNote && notePath ? notePath : undefined, selection: selection || undefined, useHive },
      });
    } catch (err) {
      errorToast('The assistant could not start', err);
    }
  };

  return (
    <div className="assistant">
      <div className="assistant-head">
        <Select
          aria-label="Model"
          value={providerId}
          options={chatProviders.map((p) => ({ value: p.id, label: `${p.label} · ${p.model}` }))}
          onChange={(e) => void api().ai.setChatProvider(e.target.value).then(setSettings)}
        />
        <Button size="sm" variant="quiet" disabled={!msgs.length || streaming} onClick={() => setMessages([])}>
          Clear
        </Button>
      </div>
      <div className="assistant-msgs" ref={scroller} aria-live="polite">
        {!msgs.length ? (
          <div className="assistant-hints">
            <p className="muted">Ask about this note or your whole hive. Answers link the notes they use.</p>
            {['Summarise this note in five bullets', 'What links should this note have?', 'Draft a follow-up note with next steps'].map((s) => (
              <button key={s} className="hint" onClick={() => setInput(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
        {msgs.map((m, i) => (m.role === 'user' ? <div key={i} className="msg msg-user">{m.content}</div> : <AssistantMessage key={i} m={m} notePath={notePath} />))}
      </div>
      <div className="assistant-context">
        <LabeledToggle label={notePath ? `This note` : 'No note open'} checked={useNote && !!notePath} disabled={!notePath} onChange={setUseNote} />
        <LabeledToggle label="Search the hive" checked={useHive} onChange={setUseHive} />
        {selection ? <span className="chip">Selection · {selection.length} chars</span> : null}
      </div>
      <div className="assistant-input">
        <textarea
          rows={3}
          placeholder="Ask anything about your notes"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {streaming ? (
          <Button variant="secondary" onClick={() => streamingId && void api().ai.cancel(streamingId)}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" disabled={!input.trim()} onClick={() => void send()}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
