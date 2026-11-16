import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState } from '@basalt/ui';
import { api, errorToast } from '../lib/actions';
import { noteTitle, setState, toast, useStore } from '../lib/store';
import { renderNoteHtml } from '../lib/render';

export function PromptDialog() {
  const prompt = useStore((s) => s.prompt);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!prompt) return;
    setValue(prompt.value);
    setTimeout(() => {
      ref.current?.focus();
      if (!prompt.multiline) ref.current?.select();
    }, 0);
  }, [prompt]);
  if (!prompt) return null;
  const close = () => setState({ prompt: null });
  const submit = () => {
    if (!prompt.message && !value.trim() && !prompt.multiline) return;
    close();
    prompt.onSubmit(value);
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className={`dialog${prompt.multiline ? ' dialog-wide' : ''}`}
        role="dialog"
        aria-label={prompt.title}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <h2>{prompt.title}</h2>
        {prompt.message ? <p>{prompt.message}</p> : null}
        {!prompt.message ? (
          prompt.multiline ? (
            <textarea ref={ref} className="dialog-textarea" aria-label={prompt.label} value={value} onChange={(e) => setValue(e.target.value)} rows={14} />
          ) : (
            <label className="dialog-field">
              <span>{prompt.label}</span>
              <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
          )
        ) : null}
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant={prompt.danger ? 'danger' : 'primary'} autoFocus={!!prompt.message}>
            {prompt.confirm}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function RecoveryDialog() {
  const path = useStore((s) => s.recoveryFor);
  const [snaps, setSnaps] = useState<{ time: number; file: string }[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!path) return;
    setChosen(null);
    setText('');
    void api().hive.snapshots(path).then(setSnaps);
  }, [path]);
  useEffect(() => {
    if (path && chosen) void api().hive.readSnapshot(path, chosen).then(setText);
  }, [path, chosen]);
  if (!path) return null;
  const close = () => setState({ recoveryFor: null });
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog dialog-recovery" role="dialog" aria-label="File recovery">
        <h2>Earlier versions of {noteTitle(path)}</h2>
        {snaps.length ? (
          <div className="recovery">
            <ul>
              {snaps.map((s) => (
                <li key={s.file}>
                  <button className={chosen === s.file ? 'on' : ''} onClick={() => setChosen(s.file)}>
                    {new Date(s.time).toLocaleString()}
                  </button>
                </li>
              ))}
            </ul>
            <div className="recovery-preview prose" dangerouslySetInnerHTML={{ __html: text ? renderNoteHtml(text, path) : '<p class="muted">Pick a version to preview it.</p>' }} />
          </div>
        ) : (
          <EmptyState compact icon="backlinks" title="No earlier versions yet">
            Basalt keeps a copy every few minutes while you edit.
          </EmptyState>
        )}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
          <Button
            variant="primary"
            disabled={!chosen}
            onClick={async () => {
              try {
                await api().hive.write(path, text);
                toast({ tone: 'success', title: 'Restored the earlier version' });
                close();
              } catch (e) {
                errorToast("Couldn't restore it", e);
              }
            }}
          >
            Restore this version
          </Button>
        </div>
      </div>
    </div>
  );
}
