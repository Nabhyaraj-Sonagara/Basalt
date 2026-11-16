import { LabeledToggle } from './LabeledToggle';
import { useEffect, useState } from 'react';
import { Button, EmptyState, Icon, Toggle, type IconName } from '@basalt/ui';
import { splitFrontmatter, inferType, type Backlink, type UnlinkedMention } from '@basalt/core/browser';
import type { SemanticHit } from '@basalt/ai/types-only';
import { LocalComb } from './CombView';
import { plainSnippet } from './Sidebar';
import { Assistant } from './Assistant';
import { api, errorToast, openPath } from '../lib/actions';
import { activeTab, getState, noteTitle, setState, toast, useStore, type RightView } from '../lib/store';

function useActiveNotePath(): string | null {
  return useStore((s) => {
    const t = activeTab(s);
    return t?.kind === 'note' || t?.kind === 'canvas' ? t.path : null;
  });
}

function Backlinks({ path }: { path: string }) {
  const version = useStore((s) => s.version);
  const [linked, setLinked] = useState<Backlink[]>([]);
  const [unlinked, setUnlinked] = useState<UnlinkedMention[]>([]);
  const [showUnlinked, setShowUnlinked] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all([api().hive.backlinks(path), api().hive.unlinked(path)]).then(([a, b]) => {
      if (!live) return;
      setLinked(a);
      setUnlinked(b);
    });
    return () => {
      live = false;
    };
  }, [path, version]);

  const linkMention = async (m: UnlinkedMention) => {
    try {
      const text = await api().hive.read(m.source);
      const found = text.slice(m.start, m.end);
      const linktext = getState().resolver.linktextFor(path, m.source);
      const replacement = found.toLowerCase() === linktext.toLowerCase() && found === linktext ? `[[${linktext}]]` : `[[${linktext}|${found}]]`;
      await api().hive.write(m.source, text.slice(0, m.start) + replacement + text.slice(m.end));
      toast({ tone: 'success', title: `Linked from ${noteTitle(m.source)}` });
    } catch (err) {
      errorToast("Couldn't add the link", err);
    }
  };

  const groups = new Map<string, Backlink[]>();
  for (const b of linked) groups.set(b.source, [...(groups.get(b.source) ?? []), b]);

  return (
    <div className="panel-section">
      <div className="panel-label">Linked · {groups.size}</div>
      {groups.size ? (
        [...groups.entries()].map(([src, items]) => (
          <button key={src} className="back-card" onClick={() => openPath(src, { line: items[0].link.line })}>
            <b>{noteTitle(src)}</b>
            {items.slice(0, 3).map((b, i) => (
              <span key={i} className="back-context">
                {b.context.length > 160 ? b.context.slice(0, 160) + '…' : b.context}
              </span>
            ))}
          </button>
        ))
      ) : (
        <p className="muted pad">No notes link here yet.</p>
      )}
      <div className="panel-label row">
        <span>Unlinked mentions · {unlinked.length}</span>
        <LabeledToggle label="Show" checked={showUnlinked} onChange={setShowUnlinked} />
      </div>
      {showUnlinked
        ? unlinked.slice(0, 50).map((m, i) => (
            <div key={i} className="back-card mention">
              <button className="plain" onClick={() => openPath(m.source, { line: m.line })}>
                <b>{noteTitle(m.source)}</b>
                <span className="back-context">{m.context.slice(0, 160)}</span>
              </button>
              <Button size="sm" variant="secondary" icon="wikilink" onClick={() => void linkMention(m)}>
                Link
              </Button>
            </div>
          ))
        : null}
    </div>
  );
}

function Outline({ path }: { path: string }) {
  const note = useStore((s) => s.notesByPath.get(path));
  if (!note?.headings.length) return <EmptyState compact icon="note" title="No headings">Add headings with # to outline this note.</EmptyState>;
  const min = Math.min(...note.headings.map((h) => h.level));
  return (
    <ol className="outline">
      {note.headings.map((h, i) => (
        <li key={i} style={{ paddingLeft: (h.level - min) * 14 }}>
          <button onClick={() => openPath(path, { line: h.line })}>{h.text}</button>
        </li>
      ))}
    </ol>
  );
}

function valueToString(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function Properties({ path }: { path: string }) {
  const version = useStore((s) => s.version);
  const [fm, setFm] = useState<Record<string, unknown> | null>(null);
  const [newKey, setNewKey] = useState('');
  useEffect(() => {
    let live = true;
    void api()
      .hive.read(path)
      .then((t) => {
        if (live) setFm(splitFrontmatter(t).frontmatter);
      });
    return () => {
      live = false;
    };
  }, [path, version]);
  if (!fm) return null;
  const save = (changes: Record<string, unknown>) => void api().hive.setProperties(path, changes).catch((e) => errorToast("Couldn't save the property", e));
  const parseValue = (key: string, raw: string, old: unknown): unknown => {
    const type = inferType(key, old);
    if (type === 'list' || type === 'tags' || type === 'aliases') return raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (type === 'number') return raw.trim() === '' ? null : Number(raw);
    return raw;
  };
  return (
    <div className="properties">
      {Object.entries(fm).map(([k, v]) => {
        const type = inferType(k, v);
        return (
          <div key={k} className="prop-row">
            <label className="prop-key" htmlFor={`prop-${k}`} title={type}>
              {k}
            </label>
            {type === 'checkbox' ? (
              <Toggle id={`prop-${k}`} checked={!!v} onChange={(c) => save({ [k]: c })} />
            ) : (
              <input
                id={`prop-${k}`}
                className="prop-input"
                type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
                defaultValue={valueToString(v)}
                key={`${k}:${valueToString(v)}`}
                onBlur={(e) => {
                  if (e.target.value !== valueToString(v)) save({ [k]: parseValue(k, e.target.value, v) });
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            )}
            <Button size="sm" variant="quiet" icon="close" aria-label={`Remove ${k}`} onClick={() => save({ [k]: undefined })} />
          </div>
        );
      })}
      <form
        className="prop-row add"
        onSubmit={(e) => {
          e.preventDefault();
          const k = newKey.trim();
          if (!k || k in fm) return;
          save({ [k]: '' });
          setNewKey('');
        }}
      >
        <input className="prop-input" placeholder="Add a property" value={newKey} onChange={(e) => setNewKey(e.target.value)} aria-label="New property name" />
        <Button size="sm" variant="secondary" type="submit" disabled={!newKey.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

function Related({ path }: { path: string }) {
  const version = useStore((s) => s.version);
  const [hits, setHits] = useState<SemanticHit[] | null>(null);
  const [unlinkedOnly, setUnlinkedOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    const t = setTimeout(() => {
      api()
        .ai.related(path, unlinkedOnly)
        .then((h) => live && setHits(h))
        .catch((e) => live && setError((e as Error).message));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [path, unlinkedOnly, version]);
  const addLink = async (target: string) => {
    const text = await api().hive.read(path);
    const linktext = getState().resolver.linktextFor(target, path);
    await api().hive.write(path, `${text.replace(/\s*$/, '')}\n\n- Related: [[${linktext}]]\n`);
    toast({ tone: 'success', title: `Linked ${noteTitle(target)}` });
  };
  return (
    <div className="panel-section">
      <div className="panel-label row">
        <span>Similar notes</span>
        <LabeledToggle label="Not linked yet" checked={unlinkedOnly} onChange={setUnlinkedOnly} />
      </div>
      {error ? <p className="muted pad">{error}</p> : null}
      {hits?.length === 0 ? <p className="muted pad">Nothing similar yet.</p> : null}
      {hits?.map((h) => (
        <div key={h.path} className="back-card mention">
          <button className="plain" onClick={() => openPath(h.path)}>
            <b>{h.title}</b>
            <span className="back-context">{plainSnippet(h.snippet)}</span>
          </button>
          <Button size="sm" variant="quiet" icon="wikilink" aria-label={`Link ${h.title}`} onClick={() => void addLink(h.path)} />
        </div>
      ))}
    </div>
  );
}

const PANELS: { id: RightView; icon: IconName; label: string }[] = [
  { id: 'backlinks', icon: 'backlinks', label: 'Backlinks' },
  { id: 'outline', icon: 'note', label: 'Outline' },
  { id: 'properties', icon: 'tag', label: 'Properties' },
  { id: 'comb', icon: 'comb', label: 'Comb' },
  { id: 'related', icon: 'wikilink', label: 'Related' },
  { id: 'assistant', icon: 'highlight', label: 'Assistant' },
];

export function RightPanel() {
  const view = useStore((s) => s.rightView);
  const path = useActiveNotePath();
  const isNote = useStore((s) => activeTab(s)?.kind === 'note');
  const body = () => {
    if (view === 'assistant') return <Assistant notePath={isNote ? path : null} />;
    if (view === 'comb') return <LocalComb path={path} />;
    if (!path || !isNote) return <EmptyState compact icon="note" title="No note open">Open a note to see this.</EmptyState>;
    if (view === 'backlinks') return <Backlinks path={path} />;
    if (view === 'outline') return <Outline path={path} />;
    if (view === 'properties') return <Properties path={path} />;
    return <Related path={path} />;
  };
  return (
    <aside className="right-panel" aria-label="Note details">
      <div className="side-views" role="tablist" aria-label="Panels">
        {PANELS.map((p) => (
          <button key={p.id} role="tab" aria-selected={view === p.id} className={`side-view${view === p.id ? ' on' : ''}`} title={p.label} onClick={() => setState({ rightView: p.id })}>
            <Icon name={p.icon} size={16} label={p.label} />
          </button>
        ))}
      </div>
      <div className="panel-title">{PANELS.find((p) => p.id === view)?.label}</div>
      <div className="panel-body">{body()}</div>
    </aside>
  );
}
