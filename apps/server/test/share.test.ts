import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeAttr, ogTags, safeImageUrl } from '../src/web/share.ts';

test('attribute escaping neutralises markup and quotes', () => {
  assert.equal(escapeAttr(`"><script>alert(1)</script>`), '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeAttr(`a'b&c`), 'a&#39;b&amp;c');
  assert.equal(escapeAttr('line\nbreak\u0000'), 'line break ');
});

test('OG tags from a hostile title contain no live markup', () => {
  const html = ogTags({
    title: `Evil" onload="x()"><img src=x onerror=alert(1)>`,
    description: '</head><script>steal()</script>',
    image: null,
    url: 'https://reeltale.net/series/evil',
  });
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(!/content="[^"]*"[^>]*onload=/.test(html));
  // Every tag is a meta tag.
  const tags = html.match(/<[^>]+>/g) ?? [];
  assert.ok(tags.every((t) => t.startsWith('<meta ')));
});

test('long titles and descriptions are clipped', () => {
  const html = ogTags({ title: 'x'.repeat(500), description: 'y'.repeat(5000), image: null, url: 'https://reeltale.net/series/x' });
  assert.ok(html.length < 1200);
});

test('only our own cover keys become image URLs', () => {
  const media = 'https://media.reeltale.net';
  assert.equal(safeImageUrl('public/covers/abc/1.webp', media), 'https://media.reeltale.net/public/covers/abc/1.webp');
  assert.equal(safeImageUrl('public/covers/../secrets', media), null);
  assert.equal(safeImageUrl('private/x.webp', media), null);
  assert.equal(safeImageUrl('https://evil.example/x.png', media), null);
  assert.equal(safeImageUrl(null, media), null);
});
