// Runs in the background while the plugin is on. `basalt` is the plugin SDK (see docs/plugins.md).
const GOAL = 500;

async function refresh() {
  const note = await basalt.notes.active();
  if (!note) return basalt.ui.status('');
  const words = (note.text.match(/\S+/g) || []).length;
  await basalt.ui.status(`Goal ${Math.min(100, Math.round((words / GOAL) * 100))}% of ${GOAL}`);
}

basalt.on('note-open', refresh);
setInterval(refresh, 3000);
refresh();

basalt.commands.add({ id: 'timestamp', name: 'Insert timestamp' }, () => basalt.editor.insert(new Date().toLocaleString()));
