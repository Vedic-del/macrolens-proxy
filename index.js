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
    india10y:     '^IN10Y',
    us10y:        '^TNX',
    niftyPsuBank: '^CNXPSUBANK',   // replaces sensex + niftyBank
    // sensex, niftyBank, vix — removed (equity/trader signals, not ARC-relevant)
  };

  const results = {};

  // ── 1. Standard Yahoo Finance fetches (parallel) ──────────────────────────
  await Promise.allSettled(
    Object.entries(symbols).map(async ([key, symbol]) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MacroLensBot/1.0)',
            'Accept': 'application/json'
          }
        });
        const data = await response.json();
        const quote = data?.chart?.result?.[0]?.meta;
        const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
        results[key] = {
          success:       true,
          price:         quote?.regularMarketPrice,
          previousClose: quote?.previousClose ?? quote?.chartPreviousClose,
          currency:      quote?.currency,
          sparkline:     closes.filter(Boolean).slice(-5)
        };
      } catch (err) {
        results[key] = { success: false, error: err.message };
      }
    })
  );

  // ── 2. AAA Corp Bond Spread (10Y AAA – 10Y G-Sec, in bps) ─────────────────
  // Computed from ^CRISIL10YAAA minus india10y already fetched above.
  // If Yahoo doesn't carry the CRISIL ticker, tile gracefully shows "—".
  try {
    const aaaUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent('^CRISIL10YAAA')}?interval=1d&range=5d`;
    const aaaRes = await fetch(aaaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MacroLensBot/1.0)',
        'Accept': 'application/json'
      }
    });
    const aaaData  = await aaaRes.json();
    const aaaYield = aaaData?.chart?.result?.[0]?.meta?.regularMarketPrice;
    const gsecYield = results['india10y']?.price;

    if (aaaYield && gsecYield) {
      const spread     = parseFloat(((aaaYield - gsecYield) * 100).toFixed(1)); // bps
      const aaaPrev    = aaaData?.chart?.result?.[0]?.meta?.previousClose;
      const gsecPrev   = results['india10y']?.previousClose;
      const spreadPrev = (aaaPrev && gsecPrev)
        ? parseFloat(((aaaPrev - gsecPrev) * 100).toFixed(1))
        : spread;
      results['aaaSpread'] = {
        success:       true,
        price:         spread,
        previousClose: spreadPrev,
        currency:      'bps',
        sparkline:     []
      };
    } else {
      results['aaaSpread'] = { success: false, error: 'AAA yield data unavailable from Yahoo' };
    }
  } catch (err) {
    results['aaaSpread'] = { success: false, error: err.message };
  }

  // ── 3. India 5Y CDS (scraped from worldgovernmentbonds.com) ───────────────
  // Server-side scrape — no CORS issues on Render. Returns bps.
  try {
    const cdsRes = await fetch(
      'https://www.worldgovernmentbonds.com/cds-historical-data/india/5-years/',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml'
        }
      }
    );
    const html = await cdsRes.text();
    // Rows in the table: <td class="num">NNN.NN</td>
    // First match = latest value, second = previous close
    const matches = [...html.matchAll(/class="num">([\d.]+)<\/td>/g)];
    const latest  = matches[0] ? parseFloat(matches[0][1]) : null;
    const prev    = matches[1] ? parseFloat(matches[1][1]) : null;

    if (latest) {
      results['indiaCds5y'] = {
        success:       true,
        price:         latest,
        previousClose: prev ?? latest,
        currency:      'bps',
        sparkline:     []
      };
    } else {
      results['indiaCds5y'] = { success: false, error: 'CDS parse failed — no numeric data found' };
    }
  } catch (err) {
    results['indiaCds5y'] = { success: false, error: err.message };
  }

  res.json(results);
});

// ─── SOURCE DISCOVERY + CREDIBILITY TESTING ───────────────────────────────────
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
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const cleanText = rawText.replace(/```json|```/g, '').trim();
    const suggestions = JSON.parse(cleanText);

    const tested = await Promise.allSettled(
      suggestions.map(async (source) => {
        try {
          const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}&count=3`;
          const testRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
          const testData = await testRes.json();
          const isValid = testData.status === 'ok' && testData.items?.length > 0;
          return {
            ...source,
            credible: isValid,
            sampleHeadline: isValid ? testData.items[0]?.title : null,
            lastPublished: isValid ? testData.items[0]?.pubDate : null
          };
        } catch {
          return { ...source, credible: false, sampleHeadline: null };
        }
      })
    );

    const results = tested
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(r => r.credible);

    res.json({ sources: results, discoveredAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`MacroLens proxy running on port ${PORT}`));
