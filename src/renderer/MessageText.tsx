import type { ReactNode } from "react";

// A deliberately small text formatter. Model output is never inserted as HTML.
function safeLink(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; }
  catch { return null; }
}
function inline(text: string, openLink: (url: string) => Promise<void>): ReactNode[] {
  const parts = text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>]+|\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const markdown = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    const address = markdown ? markdown[2] : part.startsWith("http") ? part.replace(/[.,;!?]+$/, "") : "";
    const url = address && safeLink(address);
    if (!url) return part;
    return <span key={index}><a href={url} onClick={event => { event.preventDefault(); void openLink(url).catch(() => {}); }}>{markdown ? markdown[1] : address}</a>{!markdown && part.slice(address.length)}</span>;
  });
}

export function MessageText({ text, openLink = url => window.callme.openLink(url) }: { text: string; openLink?: (url: string) => Promise<void> }) {
  const blocks = text.split(/\n\s*\n/);
  return <>{blocks.map((block, index) => {
    const lines = block.split("\n");
    if (lines.every(line => /^\s*[-*]\s+/.test(line))) return <ul key={index}>{lines.map((line, item) => <li key={item}>{inline(line.replace(/^\s*[-*]\s+/, ""), openLink)}</li>)}</ul>;
    if (lines.every(line => /^\s*\d+[.)]\s+/.test(line))) return <ol key={index}>{lines.map((line, item) => <li key={item}>{inline(line.replace(/^\s*\d+[.)]\s+/, ""), openLink)}</li>)}</ol>;
    if (/^#{1,4}\s+/.test(block) && lines.length === 1) return <h3 key={index}>{inline(block.replace(/^#{1,4}\s+/, ""), openLink)}</h3>;
    return <p key={index}>{inline(block, openLink)}</p>;
  })}</>;
}
