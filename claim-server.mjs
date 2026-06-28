import http from 'http';
import { transferNFT } from './scripts/transfer-nft.mjs';

const PORT = 3001;
const TREASURY = 'ExnLqmHs1zMe4CbFtoygooiVSBomH2hwALWefeWQ1GHY';

const server = http.createServer(async (req, res) => {
  // CORS for local dev (localhost:8080 -> localhost:3001)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      message: 'Quazr Claim Server running',
      treasury: TREASURY,
      port: PORT
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/claim') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { recipient, nftId } = JSON.parse(body || '{}');

        if (!recipient || !nftId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'recipient and nftId required' }));
          return;
        }

        console.log(`\n📥 Incoming claim request: ${nftId} → ${recipient}`);

        const result = await transferNFT(recipient, nftId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          ...result,
          message: 'NFT transferred successfully!'
        }));
      } catch (err) {
        console.error('Claim error:', err.message || err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message || 'Transfer failed'
        }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n🚀 Quazr Claim Server running on http://localhost:${PORT}`);
  console.log(`   - POST /claim  { "recipient": "...", "nftId": "galactic_cat" }`);
  console.log(`   - Treasury: ${TREASURY}`);
  console.log(`\nRun this in a separate terminal while testing the site.`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});