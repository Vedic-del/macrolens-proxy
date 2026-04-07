const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());

const FEEDS = {
  etMarkets: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
  etEconomy: 'https://economictimes.indiatimes.com/economy/rssfeeds/1373380680.cms',
  etPolicy: 'https://economictimes.indiatimes.com/news/economy/policy/rssfeeds/1015683419.cms',
  mint: 'https://www.livemint.com/rss/markets',
  bs: 'https://www.business-standard.com/rss/home_page_top_stories.rss',
  reuters: 'https://feeds.reuters.com/reuters/INbusinessNews',
  cnbc: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',
  yahoo: 'https://finance.yahoo.com/news/rssindex'
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
app.listen(PORT, () => console.log(`MacroLens proxy running on port ${PORT}`));
