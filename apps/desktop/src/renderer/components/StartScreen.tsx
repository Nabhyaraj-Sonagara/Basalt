import { useEffect, useState } from 'react';
import { Button, EmptyState, Logo, TreeItem } from '@basalt/ui';
import causeway from '@basalt/ui/causeway';
import { api, openHive } from '../lib/actions';

export function StartScreen() {
  const [recent, setRecent] = useState<{ path: string; name: string; opened: number }[]>([]);
  useEffect(() => void api().app.recent().then(setRecent), []);
  const pick = async (create: boolean) => {
    const dir = await api().app.pickFolder();
    if (dir) await openHive(dir, create);
  };
  return (
    <div className="start">
      <div className="start-card">
        <Logo size={36} />
        <img className="start-art" src={causeway} alt="" />
        <EmptyState
          title="Open a hive"
          actions={
            <>
              <Button variant="primary" icon="folder" onClick={() => void pick(false)}>
                Open a folder
              </Button>
              <Button variant="secondary" icon="new-note" onClick={() => void pick(true)}>
                Create a new hive
              </Button>
            </>
          }
        >
          A hive is any folder of Markdown notes. Basalt works on the files where they are, so other apps and agents can use them too.
        </EmptyState>
        <div className="start-links">
          <Button
            variant="quiet"
            size="sm"
            onClick={async () => {
              const p = await api().app.sampleHivePath();
              if (p) await openHive(p);
            }}
          >
            Try the sample hive
          </Button>
        </div>
        {recent.length ? (
          <div className="start-recent">
            <div className="panel-label">Recent hives</div>
            {recent.map((r) => (
              <TreeItem key={r.path} kind="folder" icon="folder" label={<span title={r.path}>{r.name}</span>} onClick={() => void openHive(r.path)} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
