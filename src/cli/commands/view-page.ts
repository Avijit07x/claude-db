import type { ViewData } from './view.js';

export function renderPage(data: ViewData, live: boolean): string {
  const payload = JSON.stringify({ ...data, live }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>claude-db · memory</title>
<style>
  :root {
    --bg: #FAFAF7; --grid: #E7E5DC; --ink: #26231F; --muted: #6E6A62;
    --accent: #C0532F; --surface: #FFFFFF; --line: #D8D5CC;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1B1A18; --grid: #26241F; --ink: #E8E5DF; --muted: #9B968C;
      --accent: #D96B45; --surface: #232120; --line: #3A372F;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: var(--ink); font: 15px/1.55 ui-sans-serif, system-ui, sans-serif;
    background: linear-gradient(var(--grid) 1px, transparent 1px),
      linear-gradient(90deg, var(--grid) 1px, transparent 1px), var(--bg);
    background-size: 28px 28px;
  }
  main { max-width: 860px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font: 700 22px/1.2 ui-monospace, monospace; margin: 0; }
  h2 { font: 600 12px/1 ui-monospace, monospace; letter-spacing: 0.1em;
       text-transform: uppercase; color: var(--muted); margin: 28px 0 10px; }
  .meta { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .chip { background: var(--surface); border: 1px solid var(--line); border-radius: 999px;
          padding: 3px 12px; font: 500 12px ui-monospace, monospace; }
  .chip b { color: var(--accent); }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
  .row { display: flex; gap: 12px; align-items: baseline; padding: 9px 14px;
         border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: none; }
  .kind { font: 500 11px ui-monospace, monospace; color: var(--accent); min-width: 76px; }
  .when { font: 400 11px ui-monospace, monospace; color: var(--muted); min-width: 84px;
          font-variant-numeric: tabular-nums; }
  .title { flex: 1; min-width: 0; overflow-wrap: break-word; }
  .id { font: 400 11px ui-monospace, monospace; color: var(--muted); }
  input {
    width: 100%; padding: 10px 14px; font: inherit; color: inherit;
    background: var(--surface); border: 1px solid var(--line); border-radius: 6px;
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .live { color: var(--accent); font: 600 11px ui-monospace, monospace; }
  .empty { padding: 12px 14px; color: var(--muted); font-size: 13.5px; }
</style>
</head>
<body>
<main>
  <h1>claude-db <span class="live" id="live"></span></h1>
  <div class="meta" id="meta"></div>
  <div class="chips" id="chips"></div>

  <h2>Search memory</h2>
  <input id="q" type="search" placeholder="why is … / what did we decide about …" autocomplete="off">
  <div class="card" id="results" style="margin-top:10px; display:none"></div>

  <h2>Standing rules</h2>
  <div class="card" id="rules"></div>

  <h2>Recent sessions</h2>
  <div class="card" id="sessions"></div>

  <h2>Memory stream</h2>
  <div class="card" id="stream"></div>
</main>
<script id="data" type="application/json">${payload}</script>
<script>
  let data = JSON.parse(document.getElementById('data').textContent);
  const el = (id) => document.getElementById(id);
  const when = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  function row(parts) {
    const div = document.createElement('div');
    div.className = 'row';
    for (const [cls, text] of parts) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      div.appendChild(span);
    }
    return div;
  }
  function fill(id, rows, emptyText) {
    const box = el(id);
    box.textContent = '';
    if (rows.length === 0) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = emptyText;
      box.appendChild(d);
      return;
    }
    for (const r of rows) box.appendChild(r);
  }
  function render() {
    el('live').textContent = data.live ? '· live' : '· snapshot';
    el('meta').textContent = data.project + '  ·  ' + data.database +
      '  ·  code graph: ' + (data.scannedFiles > 0 ? data.scannedFiles + ' files scanned' : 'not built');
    el('chips').textContent = '';
    for (const [kind, count] of Object.entries(data.kinds).sort((a, b) => b[1] - a[1])) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const b = document.createElement('b');
      b.textContent = String(count);
      chip.appendChild(b);
      chip.appendChild(document.createTextNode(' ' + kind));
      el('chips').appendChild(chip);
    }
    fill('rules', data.rules.map((r) => row([["when", when(r.when).slice(0, 10)], ["title", r.title], ["id", r.id]])), 'No standing rules recorded yet.');
    fill('sessions', data.sessions.map((s) => row([["when", when(s.when)], ["title", s.summary || '(no summary yet)']])), 'No sessions recorded yet.');
    fill('stream', data.observations.map((o) => row([["kind", o.kind], ["when", when(o.when)], ["title", o.title], ["id", o.id]])), 'Nothing captured yet — memory is written as you work.');
  }
  render();

  if (data.live) {
    setInterval(async () => {
      try {
        const fresh = await (await fetch('/api/data')).json();
        data = Object.assign(fresh, { live: true });
        render();
      } catch {}
    }, 5000);

    let timer;
    el('q').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = el('q').value.trim();
        const box = el('results');
        if (q.length < 3) { box.style.display = 'none'; return; }
        try {
          const hits = await (await fetch('/api/search?q=' + encodeURIComponent(q))).json();
          box.style.display = '';
          fill('results', hits.map((h) => row([["kind", h.kind], ["when", when(h.when).slice(0, 10)], ["title", h.title], ["id", h.id]])), 'No matches.');
        } catch {}
      }, 250);
    });
  } else {
    el('q').placeholder = 'search needs the live viewer: claude-db view';
    el('q').disabled = true;
  }
</script>
</body>
</html>`;
}
