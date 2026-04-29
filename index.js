const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());

const FEEDS = {

  // ── ET ──────────────────────────────────────────────────────────────────────
  etEconomy:        'https://economictimes.indiatimes.com/economy/rssfeeds/1373380680.cms',
  etPolicy:         'https://economictimes.indiatimes.com/news/economy/policy/rssfeeds/1015683419.cms',
  etFinance:        'https://economictimes.indiatimes.com/news/economy/finance/rssfeeds/1377065691.cms',

  // ── MINT ────────────────────────────────────────────────────────────────────
  mint:             'https://www.livemint.com/rss/economy',
  mintMoney:        'https://www.livemint.com/rss/money',
  mintNews:         'https://www.livemint.com/rss/news',
  mintCompanies:    'https://www.livemint.com/rss/companies',
  mintIndustry:     'https://www.livemint.com/rss/industry',

  // ── CNBC ────────────────────────────────────────────────────────────────────
  cnbc:             'https://www.cnbc.com/id/20910258/device/rss/rss.html',
  cnbcAsia:         'https://www.cnbc.com/id/100727362/device/rss/rss.html',

  // ── GOOGLE NEWS: BY SOURCE ──────────────────────────────────────────────────
  gnBusinessStandard: 'https://news.google.com/rss/search?q=site:business-standard.com+economy+banking+RBI&hl=en-IN&gl=IN&ceid=IN:en',
  gnMoneycontrol:     'https://news.google.com/rss/search?q=site:moneycontrol.com+economy+RBI+banking&hl=en-IN&gl=IN&ceid=IN:en',
  gnBQPrime:          'https://news.google.com/rss/search?q=site:bqprime.com+economy+credit+banking&hl=en-IN&gl=IN&ceid=IN:en',
  gnBloomberg:        'https://news.google.com/rss/search?q=site:bloomberg.com+India+economy+RBI&hl=en-IN&gl=IN&ceid=IN:en',
  gnForbesIndia:      'https://news.google.com/rss/search?q=site:forbesindia.com+economy+banking&hl=en-IN&gl=IN&ceid=IN:en',
  gnHinduBizLine:     'https://news.google.com/rss/search?q=site:thehindubusinessline.com+economy+credit&hl=en-IN&gl=IN&ceid=IN:en',
  gnFinancialExpress: 'https://news.google.com/rss/search?q=site:financialexpress.com+economy+RBI+banking&hl=en-IN&gl=IN&ceid=IN:en',

  // ── GOOGLE NEWS: BY TOPIC ───────────────────────────────────────────────────
  gnNPA:            'https://news.google.com/rss/search?q=India+NPA+%22bad+loans%22+banking&hl=en-IN&gl=IN&ceid=IN:en',
  gnRBI:            'https://news.google.com/rss/search?q=RBI+%22Reserve+Bank%22+policy+rates+liquidity&hl=en-IN&gl=IN&ceid=IN:en',
  gnIBC:            'https://news.google.com/rss/search?q=India+IBC+NCLT+insolvency+%22distressed+assets%22&hl=en-IN&gl=IN&ceid=IN:en',
  gnCreditMarkets:  'https://news.google.com/rss/search?q=India+%22credit+market%22+%22bond+yield%22+spread&hl=en-IN&gl=IN&ceid=IN:en',
  gnSEBI:           'https://news.google.com/rss/search?q=SEBI+%22debt+market%22+India+bonds+regulation&hl=en-IN&gl=IN&ceid=IN:en',
  gnIMFWorldBank:   'https://news.google.com/rss/search?q=IMF+%22World+Bank%22+India+economy+growth&hl=en-IN&gl=IN&ceid=IN:en',
  gnGlobalMacro:    'https://news.google.com/rss/search?q=US+Fed+%22interest+rates%22+India+impact+dollar&hl=en-IN&gl=IN&ceid=IN:en',

};

app.get('/feeds', async (req, res) => {
  const results = {};
  await Promise.allSettled(
    Object.entries(FEEDS).map(async ([key, url]) => {
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MacroLensBot/1.0)' }
        });
        const xml = await response.text();
        results[key] = { success: true, data: xml };
      } catch (err) {
        results[key] = { success: false, error: err.message };
      }
    })
  );
  res.json(results);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;

// ── MARKET DATA ───────────────────────────────────────────────────────────────
app.get('/market-data', async (req, res) => {
  const symbols = {
    usdinr:       'USDINR=X',
    brentCrude:   'BZ=F',
    gold:         'GC=F',
    india10y:     'NIFTYGS10YR.NS',
    us10y:        '^TNX',
    niftyPsuBank: '^CNXPSUBANK',
  };

  const results = {};

  const yahooFetch = async (symbol) => {
    for (const host of ['query1', 'query2']) {
      try {
        const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        const meta   = data?.chart?.result?.[0]?.meta;
        const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
        if (meta?.regularMarketPrice) {
          return {
            success:       true,
            price:         meta.regularMarketPrice,
            previousClose: meta.previousClose ?? meta.chartPreviousClose,
            currency:      meta.currency,
            sparkline:     closes.filter(Boolean).slice(-5),
          };
        }
      } catch (_) {}
    }
    return { success: false, error: 'Yahoo fetch failed' };
  };

  await Promise.allSettled(
    Object.entries(symbols).map(async ([key, symbol]) => {
      results[key] = await yahooFetch(symbol);
    })
  );

  // AAA Spread
  try {
    const aaaRes  = await yahooFetch('^CRISIL10YAAA');
    const gsec    = results['india10y'];
    if (aaaRes.success && gsec?.success) {
      const spread = parseFloat(((aaaRes.price - gsec.price) * 100).toFixed(1));
      results['aaaSpread'] = { success: true, price: spread, previousClose: spread, currency: 'bps', sparkline: [] };
    } else {
      results['aaaSpread'] = { success: false, error: 'AAA benchmark unavailable' };
    }
  } catch (err) {
    results['aaaSpread'] = { success: false, error: err.message };
  }

  // India CDS 5Y
  try {
    const cdsRes = await fetch('https://www.worldgovernmentbonds.com/cds-historical-data/india/5-years/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' },
      signal: AbortSignal.timeout(10000),
    });
    const html    = await cdsRes.text();
    const matches = [...html.matchAll(/class="num"[^>]*>([\d.]+)<\/td>/g)];
    const latest  = matches[0] ? parseFloat(matches[0][1]) : null;
    const prev    = matches[1] ? parseFloat(matches[1][1]) : null;
    if (latest) {
      results['indiaCds5y'] = { success: true, price: latest, previousClose: prev ?? latest, currency: 'bps', sparkline: [] };
    } else {
      results['indiaCds5y'] = { success: false, error: 'CDS parse failed' };
    }
  } catch (err) {
    results['indiaCds5y'] = { success: false, error: err.message };
  }

  res.json(results);
});

// ── SOURCE DISCOVERY ──────────────────────────────────────────────────────────
app.get('/discover-sources', async (req, res) => {
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are helping build a macroeconomic news dashboard for an Indian Asset Reconstruction Company. 
              Suggest 8 high-quality, publicly accessible RSS feed URLs that would be relevant for tracking: 
              Indian credit markets, RBI policy, banking sector, NPAs, distressed assets, Indian economy, and global macro trends affecting India.
              Focus on institutional sources: government bodies, regulators, reputed financial media.
              Return ONLY a valid JSON array, no markdown, no explanation:
              [{"name": "Source Name", "url": "https://rss-url-here", "category": "Indian Regulatory|Indian Media|Global Macro", "rationale": "one line why this is relevant"}]`
            }]
          }]
        })
      }
    );
    const geminiData = await geminiRes.json();
    const rawText    = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const cleanText  = rawText.replace(/```json|```/g, '').trim();
    const suggestions = JSON.parse(cleanText);

    const tested = await Promise.allSettled(
      suggestions.map(async (source) => {
        try {
          const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}&count=3`;
          const testRes  = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
          const testData = await testRes.json();
          const isValid  = testData.status === 'ok' && testData.items?.length > 0;
          return { ...source, credible: isValid, sampleHeadline: isValid ? testData.items[0]?.title : null };
        } catch {
          return { ...source, credible: false, sampleHeadline: null };
        }
      })
    );

    const results = tested.filter(r => r.status === 'fulfilled').map(r => r.value).filter(r => r.credible);
    res.json({ sources: results, discoveredAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ─────────────────────────────────────────────────────────────
// Google News URL resolver
// Decodes news.google.com/rss/articles/<ID> → real publisher URL
// ─────────────────────────────────────────────────────────────
const resolveCache = new Map(); // articleId -> { url, ts }
const RESOLVE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function extractArticleId(rawUrl) {
  // Matches /articles/<ID> or /rss/articles/<ID> or /read/<ID>
  const m = rawUrl.match(/\/(?:rss\/)?(?:articles|read)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function decodeGoogleNewsId(articleId) {
  // Step A — fetch the article page to grab signature + timestamp
  const pageRes = await fetch(`https://news.google.com/rss/articles/${articleId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await pageRes.text();
  const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts  = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sig || !ts) throw new Error('signature/timestamp not found in article page');

  // Step B — call batchexecute with the signed payload
  const payload =
    '[[["Fbv4je","[\\"garturlreq\\",[[\\"X\\",\\"X\\",[\\"X\\",\\"X\\"],null,null,1,1,\\"US:en\\",null,1,null,null,null,null,null,0,1],\\"X\\",\\"X\\",1,[1,1,1],1,1,null,0,0,null,0],\\"' +
    articleId + '\\",' + ts + ',\\"' + sig + '\\"]",null,"generic"]]]';

  const beRes = await fetch(
    'https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: 'f.req=' + encodeURIComponent(payload),
    }
  );
  const text = await beRes.text();

  const HEADER = '[\\"garturlres\\",\\"';
  const FOOTER = '\\",';
  const i = text.indexOf(HEADER);
  if (i === -1) throw new Error('garturlres header not found');
  const tail = text.substring(i + HEADER.length);
  const j = tail.indexOf(FOOTER);
  if (j === -1) throw new Error('garturlres footer not found');
  return tail.substring(0, j);
}

app.get('/resolve', async (req, res) => {
  const target = req.query.url;
  if (!target || typeof target !== 'string') {
    return res.status(400).json({ url: null, error: 'missing url' });
  }

  // Non-Google URLs: just echo back (frontend already handles direct URLs).
  if (!target.includes('news.google.com')) {
    return res.json({ url: target });
  }

  const id = extractArticleId(target);
  if (!id) return res.json({ url: null, error: 'could not extract article id' });

  const cached = resolveCache.get(id);
  if (cached && Date.now() - cached.ts < RESOLVE_TTL_MS) {
    return res.json({ url: cached.url, cached: true });
  }

  try {
    const finalUrl = await decodeGoogleNewsId(id);
    resolveCache.set(id, { url: finalUrl, ts: Date.now() });
    res.json({ url: finalUrl });
  } catch (err) {
    res.json({ url: null, error: err.message });
  }
});

app.listen(PORT, () => console.log(`MacroLens proxy running on port ${PORT}`));
