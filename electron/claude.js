// Avvia Claude Code in modalità non interattiva e ne legge lo stream di eventi.
const { spawn } = require('child_process');
const readline = require('readline');

const ALLOWED = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Agent', 'Task',
  'Bash(python tools/*)', 'Bash(python3 tools/*)', 'Bash(py tools/*)'];

function quote(a) { return /[\s()*"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a; }

function toolSummary(name, input = {}) {
  const short = (s) => String(s || '').replace(/\\/g, '/').split('/').slice(-2).join('/');
  if (name === 'Read') return `Legge ${short(input.file_path)}`;
  if (name === 'Grep') return `Cerca "${String(input.pattern || '').slice(0, 40)}"`;
  if (name === 'Glob') return `Cerca file ${input.pattern || ''}`;
  if (name === 'Bash') return `Esegue ${String(input.command || '').slice(0, 70)}`;
  if (name === 'Edit' || name === 'Write') return `Aggiorna ${short(input.file_path)}`;
  if (name === 'WebFetch') return `Consulta ${String(input.url || '').replace(/^https?:\/\//, '').slice(0, 50)}`;
  if (name === 'WebSearch') return `Cerca sul web "${String(input.query || '').slice(0, 40)}"`;
  if (name === 'Agent' || name === 'Task') return `Chiama lo specialista ${input.subagent_type || ''}`;
  return name;
}

/** ask({agent, prompt, resume}, {cwd, command, env}, onEvent) -> {cancel()} */
function ask({ agent, prompt, resume }, { cwd, command = 'claude', env }, onEvent) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--agent', agent,
    '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED];
  if (resume) args.push('--resume', resume);
  const win = process.platform === 'win32';
  const child = win
    ? spawn([command, ...args].map(quote).join(' '), { cwd, shell: true, windowsHide: true, env: env || process.env })
    : spawn(command, args, { cwd, env: env || process.env });
  let done = false;
  let stderr = '';
  const finish = (ev) => { if (!done) { done = true; onEvent(ev); } };
  child.on('error', (e) => finish({ type: 'error', message: e.code === 'ENOENT'
    ? 'Claude Code non trovato. Installa Claude Code e verifica che il comando "claude" funzioni dal terminale.'
    : String(e.message || e) }));
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const rl = readline.createInterface({ input: child.stdout });
  const streamed = new Set();      // messaggi di cui abbiamo già mostrato il testo carattere per carattere
  rl.on('line', (line) => {
    line = line.trim();
    if (!line.startsWith('{')) return;
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'stream_event' && !m.parent_tool_use_id) {
      const ev = m.event || {};
      if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'text') onEvent({ type: 'blockstart' });
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta' && ev.delta.text) {
        if (m.api_message_id) streamed.add(m.api_message_id);
        onEvent({ type: 'delta', text: ev.delta.text });
      }
      return;
    }
    if (m.type === 'rate_limit_event' && m.rate_limit_info) {
      const w = m.rate_limit_info.unifiedWindows || {};
      onEvent({ type: 'limits', fiveHour: w.five_hour || null, sevenDay: w.seven_day || null });
      return;
    }
    if (m.type === 'system' && m.subtype === 'init') {
      onEvent({ type: 'start', sessionId: m.session_id, model: m.model });
    } else if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
      if (m.parent_tool_use_id) return;                 // lavoro interno di uno specialista chiamato dal produttore
      for (const c of m.message.content) {
        if (c.type === 'text' && c.text && c.text.trim() && !streamed.has(m.message.id)) onEvent({ type: 'text', text: c.text });
        if (c.type === 'tool_use') onEvent({ type: 'tool', name: c.name, summary: toolSummary(c.name, c.input) });
      }
    } else if (m.type === 'result') {
      const u = m.usage || {};
      finish({
        type: 'done', ok: !m.is_error && m.subtype === 'success', result: m.result || '', sessionId: m.session_id,
        durationMs: m.duration_ms || 0, turns: m.num_turns || 0, costUsd: m.total_cost_usd ?? null,
        usage: {
          input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
          output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
        },
        message: m.is_error ? (m.result || m.subtype || 'Errore') : '',
      });
    }
  });
  child.on('close', (code) => finish({ type: 'error', message: (stderr.trim().split('\n').slice(-3).join(' ') || `Claude Code si è chiuso (codice ${code}) senza una risposta.`) }));
  child.stdin.on('error', () => {});
  child.stdin.write(prompt);
  child.stdin.end();
  return { cancel() { if (!done) { done = true; try { child.kill(); } catch {} onEvent({ type: 'error', message: 'Richiesta interrotta.' }); } } };
}

module.exports = { ask, toolSummary };
