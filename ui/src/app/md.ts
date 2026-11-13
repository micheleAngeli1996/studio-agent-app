// Markdown essenziale -> HTML sicuro (il testo viene prima neutralizzato).
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) {
      const buf: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const n = Math.min(h[1].length + 2, 5); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (l.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const row = (x: string) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(l); i += 2; const body: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) body.push(row(lines[i++]));
      out.push('<div class="tbl"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    const ul = /^\s*[-*]\s+/; const ol = /^\s*\d+[.)]\s+/;
    if (ul.test(l) || ol.test(l)) {
      const re = ul.test(l) ? ul : ol; const tag = re === ul ? 'ul' : 'ol'; const items: string[] = [];
      while (i < lines.length && (re.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (re.test(lines[i])) items.push(lines[i].replace(re, '')); else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      out.push(`<${tag}>` + items.map((x) => `<li>${inline(x)}</li>`).join('') + `</${tag}>`); continue;
    }
    if (/^\s*>\s?/.test(l)) { out.push(`<blockquote>${inline(l.replace(/^\s*>\s?/, ''))}</blockquote>`); i++; continue; }
    const p: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*]\s+|\s*\d+[.)]\s+|\s*\|)/.test(lines[i])) p.push(lines[i++]);
    if (!p.length) { p.push(lines[i++]); }
    out.push(`<p>${inline(p.join(' '))}</p>`);
  }
  return out.join('');
}

// Citazioni dei manuali -> link che aprono la pagina nel pannello Fonte (#cite:<libro>:<pagina>)
export function linkCitations(html: string): string {
  const rx = /(De Ninno|Adler)[^<]{0,60}?\bpp?\.\s*(\d{1,4})/g;
  return html.replace(/(<a\b[^>]*>.*?<\/a>)|(<code>.*?<\/code>)|([^<]+)/g, (all, a, code, text) => {
    if (!text) return all;
    return text.replace(rx, (m: string, who: string, page: string) => {
      let book = 'adler';
      if (who === 'De Ninno') book = /vol(?:ume)?\.?\s*(II|2)\b/.test(m) ? 'armonia2' : 'armonia1';
      return `<a class="cite" href="#cite:${book}:${page}">${m}</a>`;
    });
  });
}

export function firstSentence(md: string): string {
  const t = md.replace(/[#*`>|]/g, '').split('\n').map((x) => x.trim()).find((x) => x.length > 8) || '';
  const m = t.match(/^(.{20,180}?[.!?])(\s|$)/);
  return (m ? m[1] : t.slice(0, 180)).trim();
}
