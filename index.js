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
  // Strategy: fetch HDFC Ltd NCD proxy (HDFCNCD.NS) as AAA 10Y approximation
  // OR use a fixed published spread from FBIL (scraped)
  try {
    const fbilRes = await fetch('https://www.fbil.org.in/BondMarket', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(8000),
    });
    const html = await fbilRes.text();
    // FBIL publishes AAA spread — look for spread value near "AAA" text
    const match = html.match(/AAA[^<]*?(\d+\.\d+)/i);
    const spread = match ? parseFloat(match[1]) : null;

    if (spread && spread > 0 && spread < 500) {
      results['aaaSpread'] = {
        success: true, price: spread, previousClose: spread, currency: 'bps', sparkline: [],
      };
    } else {
      // Fallback: compute from two Yahoo tickers that DO exist
      // LICHSGFIN.NS (LIC Housing, top AAA-rated NCD issuer) as AAA proxy
      const proxyBond = await yahooFetch('LICHSGFIN.NS');
      const gsec      = results['india10y'];
      if (proxyBond.success && gsec?.success && gsec.price) {
        // This gives a rough credit spread directionally, not exact bps
        results['aaaSpread'] = { success: false, error: 'AAA benchmark unavailable — FBIL/CCIL not accessible' };
      } else {
        results['aaaSpread'] = { success: false, error: 'AAA spread data unavailable' };
      }
    }
  } catch (err) {
    results['aaaSpread'] = { success: false, error: err.message };
  }

  // ── 3. India 5Y CDS ────────────────────────────────────────────────────────
  try {
    // Try investing.com first (more reliable table structure)
    const cdsRes = await fetch(
      'https://www.worldgovernmentbonds.com/cds-historical-data/india/5-years/',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    const html = await cdsRes.text();

    // Try multiple patterns since the page structure can vary
    let latest = null, prev = null;

    // Pattern 1: class="num"
    const m1 = [...html.matchAll(/class="num"[^>]*>([\d.]+)<\/td>/g)];
    if (m1.length >= 1) { latest = parseFloat(m1[0][1]); prev = m1[1] ? parseFloat(m1[1][1]) : null; }

    // Pattern 2: bare number in table cell near "India"
    if (!latest) {
      const m2 = html.match(/India[^<]*[\s\S]{0,200}?<td[^>]*>([\d]{2,4}\.?\d*)<\/td>/i);
      if (m2) latest = parseFloat(m2[1]);
    }

    // Pattern 3: data-value attribute
    if (!latest) {
      const m3 = html.match(/data-value="([\d.]+)"/);
      if (m3) latest = parseFloat(m3[1]);
    }

    if (latest && latest > 0 && latest < 2000) {
      results['indiaCds5y'] = {
        success: true, price: latest, previousClose: prev ?? latest, currency: 'bps', sparkline: [],
      };
    } else {
      results['indiaCds5y'] = { success: false, error: 'CDS parse failed — page structure may have changed' };
    }
  } catch (err) {
    results['indiaCds5y'] = { success: false, error: err.message };
  }

  res.json(results);
});

app.listen(PORT, () => console.log(`MacroLens proxy running on port ${PORT}`));
