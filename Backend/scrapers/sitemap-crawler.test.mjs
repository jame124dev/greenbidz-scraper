/**
 * Offline unit tests for the pure helpers in sitemap-crawler.js.
 * Run: node --test scrapers/sitemap-crawler.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  parseSitemapXml,
  extractRobotsSitemaps,
  filterProductUrls,
  decodeXmlEntities,
  maybeGunzip,
  originOf,
  productUrlPatternFromProfile,
} from './sitemap-crawler.js';

test('parseSitemapXml: urlset with lastmod', () => {
  const xml = `<?xml version="1.0"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://shop.com/product/101</loc><lastmod>2026-06-01</lastmod></url>
      <url><loc>https://shop.com/about</loc></url>
    </urlset>`;
  const res = parseSitemapXml(xml);
  assert.equal(res.type, 'urlset');
  assert.equal(res.urls.length, 2);
  assert.equal(res.urls[0].loc, 'https://shop.com/product/101');
  assert.equal(res.urls[0].lastmod, '2026-06-01');
  assert.equal(res.urls[1].lastmod, null);
});

test('parseSitemapXml: sitemapindex returns child sitemaps, not urls', () => {
  const xml = `<?xml version="1.0"?>
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://shop.com/product-sitemap1.xml</loc></sitemap>
      <sitemap><loc>https://shop.com/product-sitemap2.xml</loc></sitemap>
    </sitemapindex>`;
  const res = parseSitemapXml(xml);
  assert.equal(res.type, 'index');
  assert.deepEqual(res.sitemaps, [
    'https://shop.com/product-sitemap1.xml',
    'https://shop.com/product-sitemap2.xml',
  ]);
  assert.equal(res.urls.length, 0);
});

test('parseSitemapXml: namespaced tags (ns:loc)', () => {
  const xml = `<ns:urlset xmlns:ns="...">
      <ns:url><ns:loc>https://shop.com/product/9</ns:loc></ns:url>
    </ns:urlset>`;
  const res = parseSitemapXml(xml);
  assert.equal(res.urls.length, 1);
  assert.equal(res.urls[0].loc, 'https://shop.com/product/9');
});

test('parseSitemapXml: decodes &amp; in loc', () => {
  const xml = `<urlset><url><loc>https://shop.com/p?a=1&amp;b=2</loc></url></urlset>`;
  const res = parseSitemapXml(xml);
  assert.equal(res.urls[0].loc, 'https://shop.com/p?a=1&b=2');
});

test('extractRobotsSitemaps: case-insensitive, multiple', () => {
  const robots = [
    'User-agent: *',
    'Disallow: /admin',
    'Sitemap: https://shop.com/sitemap_index.xml',
    'sitemap: https://shop.com/news-sitemap.xml',
  ].join('\n');
  assert.deepEqual(extractRobotsSitemaps(robots), [
    'https://shop.com/sitemap_index.xml',
    'https://shop.com/news-sitemap.xml',
  ]);
});

test('filterProductUrls: keeps matches, dedupes, derives externalId', () => {
  const entries = [
    { loc: 'https://shop.com/product/101', lastmod: '2026-06-01' },
    { loc: 'https://shop.com/about', lastmod: null },
    { loc: 'https://shop.com/product/101', lastmod: '2026-06-02' }, // dupe
    { loc: 'https://shop.com/product/202', lastmod: null },
  ];
  const out = filterProductUrls(entries, '/product/\\d+');
  assert.equal(out.length, 2);
  assert.equal(out[0].productUrl, 'https://shop.com/product/101');
  assert.equal(out[0].externalId, '101');
  assert.equal(out[0].lastmod, '2026-06-01'); // first wins on dupe
  assert.equal(out[1].externalId, '202');
});

test('filterProductUrls: shared seen-set dedupes across calls', () => {
  const seen = new Set();
  const a = filterProductUrls([{ loc: 'https://s.com/product/1', lastmod: null }], '/product/\\d+', seen);
  const b = filterProductUrls(
    [
      { loc: 'https://s.com/product/1', lastmod: null }, // already seen in call a
      { loc: 'https://s.com/product/2', lastmod: null },
    ],
    '/product/\\d+',
    seen,
  );
  assert.equal(a.length, 1);
  assert.equal(b.length, 1); // only product/2 is new
  assert.equal(b[0].externalId, '2');
});

test('filterProductUrls: accepts a RegExp too', () => {
  const out = filterProductUrls(
    [{ loc: 'https://x.com/buyer-marketplace/55', lastmod: null }],
    /\/buyer-marketplace\/\d+/,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].externalId, '55');
});

test('decodeXmlEntities: numeric + named', () => {
  assert.equal(decodeXmlEntities('a&amp;b&#38;c&#x26;d'), 'a&b&c&d');
});

test('maybeGunzip: round-trips gzip and passes plain text through', async () => {
  const plain = '<urlset><url><loc>https://x.com/product/1</loc></url></urlset>';
  const gz = zlib.gzipSync(Buffer.from(plain));
  assert.equal(await maybeGunzip(gz, 'https://x.com/sitemap.xml.gz'), plain);
  assert.equal(await maybeGunzip(Buffer.from(plain), 'https://x.com/sitemap.xml'), plain);
});

test('originOf: derives scheme://host from any path', () => {
  assert.equal(originOf('https://shop.com/category/tools?page=2'), 'https://shop.com');
});

test('productUrlPatternFromProfile: precedence discovery > pagination > urlPattern', () => {
  assert.equal(
    productUrlPatternFromProfile({
      discovery: { productUrlPattern: '/d/\\d+' },
      pagination: { productUrlPattern: '/p/\\d+' },
      urlPattern: 'https://x\\.com/u/\\d+',
    }),
    '/d/\\d+',
  );
  assert.equal(
    productUrlPatternFromProfile({
      pagination: { productUrlPattern: '/p/\\d+' },
      urlPattern: 'https://x\\.com/u/\\d+',
    }),
    '/p/\\d+',
  );
  assert.equal(
    productUrlPatternFromProfile({ urlPattern: 'https://x\\.com/u/\\d+' }),
    'https://x\\.com/u/\\d+',
  );
  assert.equal(productUrlPatternFromProfile({}), null);
  assert.equal(productUrlPatternFromProfile(null), null);
});
