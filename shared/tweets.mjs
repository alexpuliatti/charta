import { stripFrontmatter } from './clip-markdown.mjs';

export const TWEET_TEXT_UNAVAILABLE = 'Tweet text hasn’t been saved yet. Open the original post to read it.';

/** Recognize saved posts without treating X profiles or unrelated links as tweets. */
export function isTweet(block) {
  if (block.curation?.genre === 'tweet') return true;
  if (['image', 'video', 'audio', 'file'].includes(block.type)) return false;
  try {
    const url = new URL(block.source?.url);
    return ['https:', 'http:'].includes(url.protocol)
      && /^(?:www\.|mobile\.)?(?:x\.com|twitter\.com)$/i.test(url.hostname)
      && /^\/(?:[^/]+\/status|i\/web\/status)\/\d+(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}

/** Use the captured body, never a summary, OCR description, or login screenshot. */
export function tweetText(block) {
  return stripFrontmatter(block.body || '')
    .replace(/!\[[^\]]*\]\([^\n)]*\)/g, '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}
