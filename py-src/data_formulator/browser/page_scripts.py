# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""JavaScript that runs inside the page: the same on every driver (AppleScript, Playwright).

Each script is the body of an async function: it ``return``s a JSON-serializable value. They read the
page as rendered, including shadow DOM (web components), which ``innerText`` and ``querySelectorAll``
do not see.
"""

from __future__ import annotations

import json
import re

_PRELUDE = r"""
const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','CANVAS','IFRAME','OBJECT','HEAD','META','LINK','INPUT','SELECT','TEXTAREA']);
const BLOCK = new Set(['P','DIV','SECTION','ARTICLE','MAIN','HEADER','FOOTER','NAV','ASIDE','H1','H2','H3','H4','H5','H6',
  'UL','OL','LI','PRE','BLOCKQUOTE','TABLE','TR','FIGURE','FIGCAPTION','DL','DT','DD','FORM','FIELDSET','DETAILS','SUMMARY','HR']);
// Children as rendered: a shadow host shows its shadow tree, a slot the nodes assigned to it.
const kids = node => {
  if (node.shadowRoot) return [...node.shadowRoot.childNodes];
  if (node.tagName === 'SLOT') { const assigned = node.assignedNodes({flatten: true}); return assigned.length ? assigned : [...node.childNodes]; }
  return [...node.childNodes];
};
const hidden = el => { if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
  const s = getComputedStyle(el); return s.display === 'none' || s.visibility === 'hidden'; };
const clean = s => (s || '').replace(/\s+/g, ' ').trim();
const SHADOW = [...document.querySelectorAll('*')].some(el => el.shadowRoot);
const deepAll = (selector, root = document) => {
  const out = [];
  const visit = r => { out.push(...r.querySelectorAll(selector)); if (SHADOW) for (const el of r.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot); };
  if (root.shadowRoot) visit(root.shadowRoot);
  visit(root);
  return out;
};
const plain = node => {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return '';
  if (SKIP.has(node.tagName) || hidden(node)) return '';
  if (node.tagName === 'BR') return '\n';
  const inner = kids(node).map(plain).join('');
  if (node.tagName === 'TD' || node.tagName === 'TH') return inner + '\t';
  return BLOCK.has(node.tagName) ? '\n' + inner + '\n' : inner;
};
const textOf = node => !SHADOW ? (node.innerText || '')
  : plain(node).replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
"""

# What a page looks like right now: enough for the agent to decide what to read, and the
# signals that a person is needed (a sign-in form, a human-verification challenge).
PAGE_STATE = _PRELUDE + r"""
const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
const body = document.body ? textOf(document.body) : '';
const signals = [];
if (deepAll('input[type=password]').some(visible)) signals.push('password_field');
// Sites load invisible challenge scripts on ordinary pages: only a visible challenge on a near-empty page counts.
const challenge = deepAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],'
  + '#challenge-form,#challenge-running,.cf-turnstile,.h-captcha').some(visible);
if (/^(just a moment|attention required|verify you are human|are you a robot)/i.test(document.title) || (challenge && body.length < 3000))
  signals.push('captcha');
return { url: location.href, title: document.title, ready: document.readyState, signals, text_length: body.length,
         tables: deepAll('table,[role=table],[role=grid]').length, links: deepAll('a[href]').length,
         excerpt: body.replace(/\n{3,}/g, '\n\n').slice(0, 1500) };
"""

_READ = _PRELUDE + r"""
const MODE = __MODE__, MAX = __MAX__;
const abs = href => { try { return new URL(href, location.href).href; } catch (e) { return href || ''; } };
const cellText = cell => clean(SHADOW ? plain(cell) : cell.innerText);
const meta = { url: location.href, title: document.title };

const gridRows = root => {
  // HTML tables and ARIA grids (single-page apps often draw tables with divs).
  if (root.tagName === 'TABLE') {
    // Lay cells out on the grid: a row-spanning cell repeats down its rows; a column-spanning header
    // labels every column under it, while a spanning body cell fills only its first column.
    const rows = []; let header = 0; const carry = [];
    for (const tr of root.rows) {
      const cells = [];
      const head = (tr.cells.length > 0 && [...tr.cells].every(c => c.tagName === 'TH')) || tr.parentElement.tagName === 'THEAD';
      let col = 0;
      const skipCarried = () => { while (carry[col] && carry[col].left > 0) { cells[col] = carry[col].text; carry[col].left--; col++; } };
      for (const cell of tr.cells) {
        skipCarried();
        const text = cellText(cell), span = Math.min(cell.colSpan || 1, 50), down = Math.min(cell.rowSpan || 1, 1000);
        for (let i = 0; i < span; i++) {
          const value = i === 0 || head ? text : '';
          cells[col + i] = value;
          carry[col + i] = down > 1 ? { text: value, left: down - 1 } : null;
        }
        col += span;
      }
      skipCarried();
      if (rows.length === header && head) header++;
      rows.push(Array.from(cells, c => c || ''));
    }
    return { rows, header_rows: header, caption: clean(root.caption && root.caption.innerText) };
  }
  const rows = []; let header = 0;
  for (const row of deepAll('[role=row]', root)) {
    const cells = deepAll('[role=cell],[role=gridcell],[role=columnheader],[role=rowheader]', row);
    if (!cells.length) continue;
    if (rows.length === header && cells.every(c => c.getAttribute('role') === 'columnheader')) header++;
    rows.push(cells.map(cellText));
  }
  return { rows, header_rows: header, caption: clean(root.getAttribute('aria-label')) };
};

const tables = () => deepAll('table,[role=table],[role=grid]')
  .filter(t => !hidden(t) && !(t.tagName === 'TABLE' && t.querySelector('table')))
  .map(gridRows).filter(t => t.rows.length > 1 || (t.rows[0] || []).length > 1);

const markdown = () => {
  const root = deepAll('main,article,[role=main]')[0] || document.body;
  if (!root) return '';
  const out = [];
  let buffer = '';
  const inline = node => {
    if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
    if (node.nodeType !== 1 || SKIP.has(node.tagName) || hidden(node)) return '';
    const tag = node.tagName;
    if (tag === 'BR') return '\n';
    const inner = kids(node).map(inline).join('');
    if (BLOCK.has(tag)) return ' ' + inner + ' ';
    if (tag === 'A' && node.getAttribute('href') && clean(inner)) return `[${clean(inner)}](${abs(node.getAttribute('href'))})`;
    if ((tag === 'STRONG' || tag === 'B') && clean(inner)) return `**${clean(inner)}**`;
    if ((tag === 'EM' || tag === 'I') && clean(inner)) return `*${clean(inner)}*`;
    if (tag === 'CODE') return '`' + inner + '`';
    if (tag === 'IMG' && node.alt) return `![${clean(node.alt)}](${abs(node.getAttribute('src'))})`;
    return inner;
  };
  const flush = () => { const text = buffer.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim(); if (text) out.push(text); buffer = ''; };
  const block = (node, depth = 0) => {
    if (SKIP.has(node.tagName) || hidden(node)) return;
    const tag = node.tagName;
    if (/^H[1-6]$/.test(tag)) { flush(); const text = clean(textOf(node)); if (text) out.push('#'.repeat(+tag[1]) + ' ' + text); return; }
    if (tag === 'PRE') { flush(); out.push('```\n' + (node.innerText || '').replace(/\n+$/, '') + '\n```'); return; }
    if (tag === 'HR') { flush(); out.push('---'); return; }
    if (tag === 'TABLE') {
      flush(); const t = gridRows(node); if (!t.rows.length) return;
      const width = Math.max(...t.rows.map(r => r.length));
      const line = r => '| ' + [...r, ...Array(width - r.length).fill('')].map(c => c.replace(/\|/g, '\\|')).join(' | ') + ' |';
      const [head, ...rest] = t.rows;
      out.push([line(head), '|' + ' --- |'.repeat(width), ...rest.map(line)].join('\n')); return;
    }
    if (tag === 'UL' || tag === 'OL') {
      flush(); let n = 0;
      const items = kids(node).filter(li => li.nodeType === 1 && li.tagName === 'LI' && !hidden(li)).map(li => {
        n++; const marker = tag === 'OL' ? `${n}.` : '-';
        const nested = []; let text = '';
        for (const child of kids(li)) {
          if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) {
            const saved = out.length; block(child, depth + 1); nested.push(...out.splice(saved));
          } else text += inline(child);
        }
        return '  '.repeat(depth) + marker + ' ' + clean(text) + (nested.length ? '\n' + nested.join('\n') : '');
      });
      if (items.length) out.push(items.join('\n')); return;
    }
    if (tag === 'BLOCKQUOTE') { flush(); const text = clean(textOf(node)); if (text) out.push('> ' + text); return; }
    for (const child of kids(node)) {
      if (child.nodeType === 1 && (BLOCK.has(child.tagName) || child.shadowRoot)) { flush(); block(child, depth); }
      else buffer += inline(child);
    }
    flush();
  };
  block(root);
  return out.join('\n\n');
};

const links = () => {
  const seen = new Set(), list = [];
  for (const a of deepAll('a[href]')) {
    const href = a.href; if (!href || seen.has(href) || href.startsWith('javascript:')) continue;
    seen.add(href); list.push({ text: clean(textOf(a) || a.title || a.getAttribute('aria-label')).slice(0, 200), href });
    if (list.length >= 5000) break;
  }
  return list;
};

let content;
if (MODE === 'tables') content = tables();
else if (MODE === 'links') content = links();
else if (MODE === 'html') content = document.documentElement.outerHTML;
else if (MODE === 'text') content = document.body ? textOf(document.body) : '';
else content = markdown();
if (typeof content === 'string' && content.length > MAX) { meta.truncated = true; content = content.slice(0, MAX); }
return { ...meta, mode: MODE, content };
"""

READ_MODES = ("markdown", "text", "tables", "links", "html")
MAX_CONTENT_CHARS = 5_000_000


def read_script(mode: str, max_chars: int = MAX_CONTENT_CHARS) -> str:
    if mode not in READ_MODES:
        raise ValueError(f"Read the page as one of: {', '.join(READ_MODES)}.")
    return _READ.replace("__MODE__", json.dumps(mode)).replace("__MAX__", str(int(max_chars)))


def as_function_body(code: str) -> str:
    """The agent's code as an async function body: statements that ``return`` a value, or one bare expression."""
    stripped = code.strip().rstrip(";").strip()
    if re.search(r"(^|[;{}\s])return\b", stripped) or re.search(r"(^|[;\n])\s*(const|let|var|for|while|if|try|throw)\b", stripped):
        return code
    return f"return ({stripped});"
