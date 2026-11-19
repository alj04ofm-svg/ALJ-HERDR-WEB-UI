/** Codex attachment envelopes are transport metadata, not conversation prose. */
export function userMessage(text: string): { text: string; images: string[] } {
  const images: string[] = [];
  const clean = text.replace(/<image\b[^>]*\bpath="([^"\n]+)"[^>]*>[\s\S]*?<\/image>/g, (envelope, path: string) => {
    if (!/\bname=(?:\[Image #\d+\]|"\[Image #\d+\]")(?=\s|>)/.test(envelope.split(">")[0]!) || !path.startsWith("/") || !/\.(png|jpe?g|gif|webp)$/i.test(path)) return envelope;
    images.push(path);
    return "";
  });
  return { text: clean.trim(), images: [...new Set(images)] };
}
