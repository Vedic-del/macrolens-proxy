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
app.listen(PORT, () => console.log(`MacroLens proxy running on port ${PORT}`));
