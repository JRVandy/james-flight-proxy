const https = require('https');

module.exports = async (req, res) => {
  // CORS headers — allow calls from any origin (Claude, browsers, etc.)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'SERPAPI_KEY environment variable not set' });
  }

  // Pull parameters from the incoming request query string
  const {
    departure_id,
    arrival_id,
    outbound_date,
    return_date,
    travel_class = '1',   // 1=Economy, 2=Premium Economy, 3=Business, 4=First
    adults = '1',
    stops,                // 0=any, 1=nonstop, 2=1 stop or fewer
    type = '1',           // 1=round trip, 2=one way, 3=multi-city
    currency = 'USD',
    hl = 'en',
    gl = 'us'
  } = req.query;

  if (!departure_id || !arrival_id || !outbound_date) {
    return res.status(400).json({
      error: 'Missing required parameters: departure_id, arrival_id, outbound_date'
    });
  }

  // Build SerpAPI query string
  const params = new URLSearchParams({
    engine: 'google_flights',
    departure_id,
    arrival_id,
    outbound_date,
    travel_class,
    adults,
    type,
    currency,
    hl,
    gl,
    api_key: apiKey
  });

  if (return_date) params.append('return_date', return_date);
  if (stops !== undefined) params.append('stops', stops);

  const serpUrl = `https://serpapi.com/search?${params.toString()}`;

  try {
    const data = await new Promise((resolve, reject) => {
      https.get(serpUrl, (serpRes) => {
        let body = '';
        serpRes.on('data', chunk => body += chunk);
        serpRes.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Failed to parse SerpAPI response'));
          }
        });
      }).on('error', reject);
    });

    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'SerpAPI request failed', detail: err.message });
  }
};
