const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());

const FEEDS = {
  const FEEDS = {

  // ── ET (CONFIRMED WORKING) ──────────────────────────────────────────────────
  etEconomy:        'https://economictimes.indiatimes.com/economy/rssfeeds/1373380680.cms',
  etPolicy:         'https://economictimes.indiatimes.com/news/economy/policy/rssfeeds/1015683419.cms',
  etFinance:        'https://economictimes.indiatimes.com/news/economy/finance/rssfeeds/1377065691.cms',

  // ── MINT (CONFIRMED WORKING) ────────────────────────────────────────────────
  mint:             'https://www.livemint.com/rss/economy',
  mintMoney:        'https://www.livemint.com/rss/money',
  mintNews:         'https://www.livemint.com/rss/news',
  mintCompanies:    'https://www.livemint.com/rss/companies',
  mintIndustry:     'https://www.livemint.com/rss/industry',

  // ── CNBC (CONFIRMED WORKING) ────────────────────────────────────────────────
  cnbc:             'https://www.cnbc.com/id/20910258/device/rss/rss.html',
  cnbcAsia:         'https://www.cnbc.com/id/100727362/device/rss/rss.html',

  // ── GOOGLE NEWS: BY SOURCE (replaces all blocked direct feeds) ─────────────
  // BS, Moneycontrol, BQ, Bloomberg, FE, Forbes, Hindu BizLine all pulled via Google
  gnBusinessStandard: 'https://news.google.com/rss/search?q=site:business-standard.com+economy+banking+RBI&hl=en-IN&gl=IN&ceid=IN:en',
  gnMoneycontrol:     'https://news.google.com/rss/search?q=site:moneycontrol.com+economy+RBI+banking&hl=en-IN&gl=IN&ceid=IN:en',
  gnBQPrime:          'https://news.google.com/rss/search?q=site:bqprime.com+economy+credit+banking&hl=en-IN&gl=IN&ceid=IN:en',
  gnBloomberg:        'https://news.google.com/rss/search?q=site:bloomberg.com+India+economy+RBI&hl=en-IN&gl=IN&ceid=IN:en',
  gnForbesIndia:      'https://news.google.com/rss/search?q=site:forbesindia.com+economy+banking&hl=en-IN&gl=IN&ceid=IN:en',
  gnHinduBizLine:     'https://news.google.com/rss/search?q=site:thehindubusinessline.com+economy+credit&hl=en-IN&gl=IN&ceid=IN:en',
  gnFinancialExpress: 'https://news.google.com/rss/search?q=site:financialexpress.com+economy+RBI+banking&hl=en-IN&gl=IN&ceid=IN:en',

  // ── GOOGLE NEWS: BY TOPIC (ARC-specific — best signal for distressed assets) 
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

// ─── MARKET DATA — Credit & Macro Signals ────────────────────────────────────
// Tile lineup: USD/INR | Brent Crude | Gold | India 10Y
//              US 10Y  | Nifty PSU Bk | AAA-GSec Spread | India CDS 5Y

app.get('/market-data', async (req, res) => {
  const symbols = {
    usdinr:       'USDINR=X',
    brentCrude:   'BZ=F',
    gold:         'GC=F',
    india10y:     '^INBMK10Y',      
    us10y:        '^TNX',
    niftyPsuBank: '^CNXPSUBANK',
  };

  const results = {};

  // Helper — tries query1 first, falls back to query2
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
      } catch (_) { /* try next host */ }
    }
    return { success: false, error: 'Both Yahoo endpoints failed' };
  };

  // ── 1. Standard Yahoo symbols ──────────────────────────────────────────────
  await Promise.allSettled(
    Object.entries(symbols).map(async ([key, symbol]) => {
      results[key] = await yahooFetch(symbol);
    })
  );

// ── 2. AAA Corp Bond Spread ────────────────────────────────────────────────
// Source: BSE India bond data — HDFC AAA 10Y NCD vs G-Sec
// Both are Yahoo Finance tickers that actually exist
try {
  const [aaaRes, gsecRes] = await Promise.allSettled([
    yahooFetch('0P0001BW9T.BO'),  // HDFC AAA NCD — BSE-listed bond proxy
    yahooFetch('IN10Y=RR'),
  ]);

  const aaaPrice  = aaaRes.status === 'fulfilled'  ? aaaRes.value?.price  : null;
  const gsecPrice = gsecRes.status === 'fulfilled' ? gsecRes.value?.price : null;

  if (aaaPrice && gsecPrice) {
    const spread = parseFloat(((aaaPrice - gsecPrice) * 100).toFixed(1));
    results['aaaSpread'] = {
      success: true, price: spread,
      previousClose: spread, currency: 'bps', sparkline: []
    };
  } else {
    // Hard fallback: SEBI/RBI publish ~55-80 bps as typical AAA-GSec spread
    // Use Investing.com India corporate bond index
    const investRes = await fetch(
      'https://api.investing.com/api/financialdata/historical/21666?period=P1W&interval=PT1H',
      { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120', 'domain-id': 'in' } }
    );
    results['aaaSpread'] = { success: false, error: 'AAA benchmark not available via free APIs' };
  }
} catch (err) {
  results['aaaSpread'] = { success: false, error: err.message };
}
  // ── 3. India 5Y CDS ────────────────────────────────────────────────────────
  // ── 3. India 5Y CDS ────────────────────────────────────────────────────────
// Source: Stooq.com — carries sovereign CDS data, no auth required
try {
  const cdsRes = await fetch(
    'https://stooq.com/q/l/?s=cds5yinr&f=sd2t2ohlcv&h&e=csv',
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' },
      signal: AbortSignal.timeout(8000),
    }
  );
  const csv = await cdsRes.text();
  // CSV format: Symbol,Date,Time,Open,High,Low,Close,Volume
  const lines = csv.trim().split('\n');
  const latest = lines[1]?.split(',');
  const prev   = lines[2]?.split(',');
  const price  = latest ? parseFloat(latest[6]) : null; // Close column

  if (price && price > 0 && price < 2000) {
    results['indiaCds5y'] = {
      success: true,
      price: price,
      previousClose: prev ? parseFloat(prev[6]) : price,
      currency: 'bps',
      sparkline: lines.slice(1, 6).map(l => parseFloat(l.split(',')[6])).filter(Boolean).reverse()
    };
  } else {
    results['indiaCds5y'] = { success: false, error: 'CDS data unavailable from Stooq' };
  }
} catch (err) {
  results['indiaCds5y'] = { success: false, error: err.message };
}
  
  res.json(results);
});

app.listen(PORT, () => console.log(`MacroLens proxy running on port ${PORT}`));
