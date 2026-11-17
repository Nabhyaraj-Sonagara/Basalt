import { useEffect, useRef, useState, type ClipboardEvent as RClipboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { Button, Select } from '@basalt/ui';
import { parseMindmap, setFrontmatter, serializeMindmap } from '@basalt/core/browser';
import type { ChatImage, IllustrationKind } from '../../shared/api';
import { api, createNote, errorToast, openPath, saveMindmapNote } from '../lib/actions';
import { activeTab, getState, setState, toast, useStore } from '../lib/store';
import { editorFor } from './Editor';

const KINDS: { value: IllustrationKind; label: string }[] = [
  { value: 'mindmap', label: 'Mind map (new note)' },
  { value: 'flowchart', label: 'Flowchart' },
  { value: 'sequence', label: 'Sequence diagram' },
  { value: 'chart', label: 'Chart' },
];

type Source = 'note' | 'sketch' | 'picture';

/** Shrinks big photos before sending, so requests stay fast and cheap. */
async function toImage(src: string, max = 1600): Promise<{ image: ChatImage; bytes: Uint8Array; ext: string }> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const photo = /^data:image\/jpe?g/.test(src);
  const url = c.toDataURL(photo ? 'image/jpeg' : 'image/png', 0.88);
  const data = url.slice(url.indexOf(',') + 1);
  return { image: { mediaType: photo ? 'image/jpeg' : 'image/png', data }, bytes: Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)), ext: photo ? 'jpg' : 'png' };
}

function SketchPad({ onChange }: { onChange: (url: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const history = useRef<ImageData[]>([]);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
  }, []);
  const ctx = () => ref.current!.getContext('2d')!;
  const at = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const emit = () => onChange(dirty.current ? ref.current!.toDataURL('image/png') : null);
  return (
    <div className="sketch">
      <canvas
        ref={ref}
        width={720}
        height={420}
        className={`sketch-canvas ${tool}`}
        aria-label="Sketch pad"
        onPointerDown={(e) => {
          const c = e.currentTarget;
          history.current.push(ctx().getImageData(0, 0, c.width, c.height));
          if (history.current.length > 40) history.current.shift();
          drawing.current = true;
          dirty.current = true;
          c.setPointerCapture(e.pointerId);
          const p = at(e);
          const g = ctx();
          g.lineCap = 'round';
          g.lineJoin = 'round';
          g.strokeStyle = tool === 'pen' ? '#1f1b16' : '#fff';
          g.lineWidth = tool === 'pen' ? 3 : 22;
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x + 0.01, p.y);
          g.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = at(e);
          const g = ctx();
          g.lineTo(p.x, p.y);
          g.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          emit();
        }}
      />
      <div className="sketch-tools">
        <Button size="sm" variant={tool === 'pen' ? 'secondary' : 'quiet'} aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>
          Pen
        </Button>
        <Button size="sm" variant={tool === 'eraser' ? 'secondary' : 'quiet'} aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>
          Eraser
        </Button>
        <Button
          size="sm"
          variant="quiet"
          disabled={!history.current.length}
          onClick={() => {
            const prev = history.current.pop();
            if (prev) ctx().putImageData(prev, 0, 0);
            if (!history.current.length) dirty.current = false;
            emit();
          }}
        >
          Undo
        </Button>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            const c = ref.current!;
            history.current.push(ctx().getImageData(0, 0, c.width, c.height));
            ctx().fillStyle = '#fff';
            ctx().fillRect(0, 0, c.width, c.height);
            dirty.current = false;
            emit();
          }}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

/** Adds a Mermaid block to the note: at the cursor when it's open for editing, else at the end. */
async function insertDiagram(path: string, block: string): Promise<void> {
  const tab = activeTab();
  const view = tab?.path === path && !tab.mapText ? editorFor(tab.id) : undefined;
  if (view) {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const before = line.text.trim() ? '\n\n' : line.number > 1 && view.state.doc.line(line.number - 1).text.trim() ? '\n' : '';
    const insert = `${before}${block}\n`;
    view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length }, scrollIntoView: true });
    return;
  }
  const text = await api().hive.read(path);
  await api().hive.write(path, `${text.replace(/\s*$/, '')}\n\n${block}`);
}

export function IllustrateDialog() {
  const open = useStore((s) => s.illustrate);
  const notePath = useStore((s) => {
    const t = s.panes.find((p) => p.id === s.activePane)?.tabs.find((x) => x.id === s.panes.find((p) => p.id === s.activePane)?.active);
    // A diagram can't live inside a mind-map note (its body is the outline), so those count as no note.
    return t?.kind === 'note' && t.path && s.notesByPath.get(t.path)?.view !== 'mindmap' ? t.path : null;
  });
  const [source, setSource] = useState<Source>('sketch');
  const [kind, setKind] = useState<IllustrationKind>('flowchart');
  const [picture, setPicture] = useState<string | null>(null);
  const [sketch, setSketch] = useState<string | null>(null);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSource(open.source === 'note' && !notePath ? 'sketch' : open.source);
    setKind(open.kind ?? (open.source === 'note' ? 'mindmap' : 'flowchart'));
    setPicture(null);
    setSketch(null);
    setExtra('');
    setBusy(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const close = () => {
    if (busy) void api().ai.cancelIllustrate(busy);
    setState({ illustrate: null });
  };
  const imageUrl = source === 'sketch' ? sketch : source === 'picture' ? picture : null;
  const ready = source === 'note' ? !!notePath : !!imageUrl;

  const readFile = (f: File | null | undefined) => {
    if (!f || !f.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => setPicture(String(r.result));
    r.readAsDataURL(f);
  };
  const onPaste = (e: RClipboardEvent) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      setSource('picture');
      readFile(item.getAsFile());
    }
  };

  const run = async () => {
    const id = `il${Date.now()}`;
    setBusy(id);
    try {
      if (!getState().hive) throw new Error('Open a hive first.');
      const img = imageUrl ? await toImage(imageUrl) : null;
      const { text } = await api().ai.illustrate({ id, kind, notePath: source === 'note' ? notePath! : undefined, image: img?.image, instructions: extra });
      if (getState().illustrate === null) return;
      let attachment: string | null = null;
      if (img) attachment = await api().hive.saveAttachment(`${source === 'sketch' ? 'Sketch' : 'Picture'} ${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.${img.ext}`, img.bytes);
      const embed = attachment ? `![[${attachment}]]` : '';
      const title = notePath ? getState().notesByPath.get(notePath)?.title : undefined;
      if (kind === 'mindmap') {
        const root = parseMindmap(text, title ? `${title}` : 'Sketch');
        const near = notePath ?? undefined;
        const name = source === 'note' && title ? `${title} map` : `${root.text.slice(0, 60).replace(/[\\/:*?"<>|#^[\]]/g, '-') || 'Sketch'} map`;
        const p = await saveMindmapNote(name, root, near);
        if (p && (attachment || (source === 'note' && notePath))) {
          // Keep where the map came from in its properties; the body stays a clean outline.
          const props: Record<string, unknown> = {};
          if (attachment) props.source = embed.slice(1);
          else if (notePath) props.source = `[[${notePath.replace(/\.md$/i, '')}]]`;
          const cur = await api().hive.read(p);
          await api().hive.write(p, serializeMindmap(parseMindmap(cur, root.text), setFrontmatter(cur, props)));
        }
      } else {
        const block = `\`\`\`mermaid\n${text.trimEnd()}\n\`\`\`${embed ? `\n\n${embed}` : ''}`;
        if (notePath) await insertDiagram(notePath, block);
        else {
          const p = await createNote('Illustration', { text: `${block}\n` });
          if (p) openPath(p);
        }
        toast({ tone: 'success', title: 'Added the diagram', body: notePath ? 'Switch to reading view to see it drawn.' : undefined });
      }
      setState({ illustrate: null });
    } catch (e) {
      if (getState().illustrate) errorToast("Couldn't illustrate that", e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()} onPaste={onPaste}>
      <div className="dialog dialog-illustrate" role="dialog" aria-label="Illustrate">
        <h2>Illustrate</h2>
        <div className="seg" role="tablist" aria-label="Start from">
          {(['sketch', 'picture', 'note'] as Source[]).map((s) => (
            <button key={s} role="tab" aria-selected={source === s} className={source === s ? 'on' : ''} disabled={s === 'note' && !notePath} onClick={() => setSource(s)}>
              {s === 'sketch' ? 'Draw a sketch' : s === 'picture' ? 'Photo or picture' : 'This note'}
            </button>
          ))}
        </div>
        {source === 'sketch' ? <SketchPad onChange={setSketch} /> : null}
        {source === 'picture' ? (
          <div
            className={`drop${picture ? ' has' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              readFile(e.dataTransfer.files[0]);
            }}
          >
            {picture ? <img src={picture} alt="The picture to illustrate" /> : <p>Drop a photo of a whiteboard, a drawing or a screenshot here, or paste one.</p>}
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden aria-label="Choose a picture" onChange={(e) => readFile(e.target.files?.[0])} />
            <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
              {picture ? 'Choose another…' : 'Choose a picture…'}
            </Button>
          </div>
        ) : null}
        {source === 'note' ? <p className="muted">The assistant reads {getState().notesByPath.get(notePath ?? '')?.title ?? 'this note'} and draws it.</p> : null}
        <div className="illustrate-row">
          <label className="dialog-field">
            <span>Turn it into</span>
            <Select aria-label="Turn it into" value={kind} options={KINDS} onChange={(e) => setKind(e.target.value as IllustrationKind)} />
          </label>
          <label className="dialog-field grow">
            <span>Anything else? (optional)</span>
            <input value={extra} placeholder="e.g. left to right, keep it to 6 boxes" onChange={(e) => setExtra(e.target.value)} />
          </label>
        </div>
        <p className="muted small">
          {kind === 'mindmap' ? 'Creates a new mind-map note' : notePath ? 'Adds a Mermaid diagram to this note' : 'Creates a new note with a Mermaid diagram'}
          {source !== 'note' ? ', and saves the picture to your attachments.' : '.'} Uses the assistant's model, which must be able to see pictures.
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready || !!busy} onClick={() => void run()}>
            {busy ? 'Illustrating…' : 'Illustrate'}
          </Button>
        </div>
      </div>
    </div>
  );
}
