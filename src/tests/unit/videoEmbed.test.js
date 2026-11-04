import { describe, it, expect } from 'vitest';
import { getEmbedUrl } from '@/lib/videoEmbed';

const ID = 'dQw4w9WgXcQ';
const YT = `https://www.youtube.com/embed/${ID}`;

describe('getEmbedUrl', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s`],
    [`https://www.youtube.com/watch?feature=share&v=${ID}`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abc123`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://youtube.com/shorts/${ID}?feature=share`],
    [`https://www.youtube.com/live/${ID}`],
    [`  https://www.youtube.com/shorts/${ID}  `],
  ])('embeds YouTube url %s', (url) => {
    expect(getEmbedUrl(url)).toBe(YT);
  });

  it.each([
    [`youtube.com/watch?v=${ID}`],
    [`www.youtube.com/watch?v=${ID}`],
    [`youtu.be/${ID}`],
    [`//youtu.be/${ID}`],
    [`//www.youtube.com/embed/${ID}`],
    [`music.youtube.com/watch?v=${ID}`],
    [`https://music.youtube.com/watch?v=${ID}`],
  ])('embeds YouTube url saved without scheme or from YouTube Music: %s', (url) => {
    expect(getEmbedUrl(url)).toBe(YT);
  });

  it('embeds schemeless Vimeo urls', () => {
    expect(getEmbedUrl('vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789');
    expect(getEmbedUrl('//vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789');
  });

  it('keeps the Vimeo privacy hash and takes the first numeric segment as the id', () => {
    expect(getEmbedUrl('https://vimeo.com/123456789/abcdef1234')).toBe('https://player.vimeo.com/video/123456789?h=abcdef1234');
    expect(getEmbedUrl('https://vimeo.com/123/456789')).toBe('https://player.vimeo.com/video/123?h=456789');
    expect(getEmbedUrl('https://vimeo.com/123456789?h=abcdef1234')).toBe('https://player.vimeo.com/video/123456789?h=abcdef1234');
    expect(getEmbedUrl('https://vimeo.com/channels/staffpicks/123456789')).toBe('https://player.vimeo.com/video/123456789');
    expect(getEmbedUrl('https://vimeo.com/123456789/bad-hash!')).toBe('https://player.vimeo.com/video/123456789');
  });

  it('embeds Vimeo urls', () => {
    expect(getEmbedUrl('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789');
    expect(getEmbedUrl('https://player.vimeo.com/video/123456789')).toBe('https://player.vimeo.com/video/123456789');
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['not a url'],
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['evil.example.com/watch?v=dQw4w9WgXcQ'],
    ['https://evil.example.com/?u=youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://notyoutube.com/watch?v=dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch'],
    ['https://www.youtube.com/shorts/'],
  ])('returns null for %s', (url) => {
    expect(getEmbedUrl(url)).toBeNull();
  });
});
