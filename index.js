const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());

const FEEDS = {
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
  feRBI: 'https://www.financialexpress.com/about/rbi/feed/'
};

app.get('/feeds', async (req, res) => {
  const results = {};
  
  await Promise.allSettled(
    Object.entries(FEEDS).map(async ([key, url]) => {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MacroLensBot/1.0)'
          }
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
app.get('/market-data', async (req, res) => {
  const symbols = {
    usdinr: 'USDINR=X',
    brentCrude: 'BZ=F',
    gold: 'GC=F',
    sensex: '^BSESN',
    niftyBank: '^NSEBANK',
    india10y: '^IN10Y',
    us10y: '^TNX',
    vix: '^VIX'
  };

  const results = {};

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
          success: true,
          price: quote?.regularMarketPrice,
          previousClose: quote?.previousClose,
          currency: quote?.currency,
          sparkline: closes.filter(Boolean).slice(-5)
        };
      } catch (err) {
        results[key] = { success: false, error: err.message };
      }
    })
  );

  res.json(results);
});
// Source discovery + credibility testing
app.get('/discover-sources', async (req, res) => {
  try {
    // Step 1: Ask Gemini to suggest new RSS sources
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

    // Step 2: Test each URL — is it alive? Does it return RSS?
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
      .filter(r => r.credible); // Only return sources that actually work

    res.json({ sources: results, discoveredAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.listen(PORT, () => console.log(`MacroLens proxy running on port ${PORT}`));
