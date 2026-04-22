const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());

const FEEDS = {
  // --- EXISTING SOURCES ---
  etEconomy: 'https://economictimes.indiatimes.com/economy/rssfeeds/1373380680.cms',
  etPolicy: 'https://economictimes.indiatimes.com/news/economy/policy/rssfeeds/1015683419.cms',
  etFinance: 'https://economictimes.indiatimes.com/news/economy/finance/rssfeeds/1377065691.cms',
  mint: 'https://www.livemint.com/rss/economy',
  mintMoney: 'https://www.livemint.com/rss/money',
  bs: 'https://www.business-standard.com/rss/home_page_top_stories.rss',
  bsBanking: 'https://www.business-standard.com/rss/finance-10301.rss',
  cnbc: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',
  cnbcAsia: 'https://www.cnbc.com/id/100727362/device/rss/rss.html',
  bloombergIndia: 'https://feeds.bloomberg.com/india/news.rss',
  forbesIndia: 'https://www.forbesindia.com/rss/news.xml',
  financialExpress: 'https://www.financialexpress.com/economy/feed/',
  feRBI: 'https://www.financialexpress.com/about/rbi/feed/',

  // --- INDIAN GOVERNMENT & REGULATORY ---
  pib: 'https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3',
  sebi: 'https://www.sebi.gov.in/sebi_data/rss/sebirss.xml',
  finmin: 'https://finmin.nic.in/sites/default/files/rss.xml',
  rbiPress: 'https://www.rbi.org.in/rss/RBIPressReleases.aspx',

  // --- INDIAN BUSINESS MEDIA ---
  bqPrime: 'https://www.bqprime.com/rss',
  hinduBizLine: 'https://www.thehindubusinessline.com/economy/feeder/default.rss',
  moneycontrol: 'https://www.moneycontrol.com/rss/economy.xml',
  feEconomy: 'https://www.financialexpress.com/economy/feed/',

  // --- GLOBAL MACRO (INSTITUTIONAL) ---
  imf: 'https://www.imf.org/en/News/Rss?language=eng',
  worldBankIndia: 'https://feeds.worldbank.org/worldbank/india/rss.xml',
  bis: 'https://www.bis.org/rss/press_general.htm'
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
    india10y:     'IN10Y=RR',      // ← was ^IN10Y (wrong), now IN10Y=RR
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
