const $ = (id) => document.getElementById(id);
const key = () => `log_${String(Date.now()).padStart(15, '0')}_${Math.random().toString(36).slice(2, 8)}`;

async function readLog() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('log_')).sort();
  return { all, keys, entries: keys.flatMap((k) => all[k]) };
}

async function refresh() {
  const { all, entries } = await readLog();
  const bytes = await chrome.storage.local.getBytesInUse(null);
  const on = all.recording === true;
  $('status').textContent = `${on ? '● Recording' : 'Stopped'} · ${entries.length} entries · ${(bytes / 1024 / 1024).toFixed(1)} MB`;
  $('toggle').textContent = on ? 'Stop recording' : 'Start recording';
  $('toggle').classList.toggle('on', on);
}

function marker(text) {
  return chrome.storage.local.set({ [key()]: [{ t: new Date().toISOString(), type: 'marker', text }] });
}

$('toggle').onclick = async () => {
  const { recording } = await chrome.storage.local.get('recording');
  const on = recording !== true;
  if (on) await chrome.storage.local.set({ recording: true });
  await marker(on ? 'recording started' : 'recording stopped');
  if (!on) await chrome.storage.local.set({ recording: false });
};

$('snapshot').onclick = () => chrome.storage.local.set({ snapshotRequest: Date.now() });

$('addMarker').onclick = async () => {
  const text = $('marker').value.trim();
  if (!text) return;
  await marker(text);
  $('marker').value = '';
};

$('export').onclick = async () => {
  const { entries } = await readLog();
  entries.sort((a, b) => a.t.localeCompare(b.t));
  const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), entries }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `timelog-recording-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  a.click();
};

$('clear').onclick = async () => {
  if (!confirm('Delete the whole log?')) return;
  const { keys } = await readLog();
  await chrome.storage.local.remove(keys);
};

chrome.storage.onChanged.addListener(refresh);
refresh();
