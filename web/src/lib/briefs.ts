export function extractKeyBullets(content: any, maxItems = 3): string[] {
  if (!content) return [];
  // If structured JSON
  if (typeof content === "object") {
    if (typeof (content as any).brief_markdown === "string") {
      const md = (content as any).brief_markdown as string;
      const fromMd = md
        .split(/\r?\n/)
        .filter((l: string) => /^\s*([-•*]|\d+\.)/.test(l))
        .map((l: string) => l.replace(/^\s*(?:\d+\.|[-•*])\s*/, ""));
      if (fromMd.length) return fromMd.slice(0, maxItems);
    }
    const possible = (content.key_points ||
      content.keyPoints ||
      content.context ||
      []) as any[];
    if (Array.isArray(possible) && possible.length) {
      return possible
        .map((x) => (typeof x === "string" ? x : (x?.text as string) || ""))
        .filter(Boolean)
        .slice(0, maxItems);
    }
    if (typeof content.summary === "string") {
      const fromSummary = content.summary
        .split(/\r?\n/)
        .filter((l: string) => /^\s*[-•*]/.test(l))
        .map((l: string) => l.replace(/^\s*[-•*]\s*/, ""));
      if (fromSummary.length) return fromSummary.slice(0, maxItems);
    }
    if (typeof content.text === "string") {
      const fromText = content.text
        .split(/\r?\n/)
        .filter((l: string) => /^\s*[-•*]/.test(l))
        .map((l: string) => l.replace(/^\s*[-•*]\s*/, ""));
      if (fromText.length) return fromText.slice(0, maxItems);
    }
  }
  // Plain text fallback
  const text = typeof content === "string" ? content : String(content);
  return text
    .split(/\r?\n/)
    .filter((l) => /^\s*([-•*]|\d+\.)/.test(l))
    .map((l) => l.replace(/^\s*(?:\d+\.|[-•*])\s*/, ""))
    .filter(Boolean)
    .slice(0, maxItems);
}
