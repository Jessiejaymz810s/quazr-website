// mint.js – public mint for Phantom / Solflare wallets
// Treasury address (receives SOL payment)
const TREASURY_ADDRESS = new solanaWeb3.PublicKey('ExnLqmHs1zMe4CbFtoygooiVSBomH2hwALWefeWQ1GHY');
let walletPublicKey = null;

console.log('mint.js loaded'); // debug

// Connect wallet (Phantom or Solflare)
async function connectWallet() {
  if (window.solana && window.solana.isPhantom) {
    try {
      const resp = await window.solana.connect();
      walletPublicKey = resp.publicKey;
      document.body.classList.add('wallet-connected');
      updateConnectButton();
      showToast('Wallet connected: ' + walletPublicKey.toString().slice(0, 4) + '...' + walletPublicKey.toString().slice(-4));
    } catch (e) {
      showToast('🚫 Wallet connection cancelled');
    }
  } else if (window.solflare) {
    try {
      await window.solflare.connect();
      walletPublicKey = window.solflare.publicKey;
      document.body.classList.add('wallet-connected');
      updateConnectButton();
      showToast('Wallet connected: ' + walletPublicKey.toString().slice(0, 4) + '...' + walletPublicKey.toString().slice(-4));
    } catch (e) {
      showToast('🚫 Solflare connection cancelled');
    }
  } else {
    showToast('⚠️ No supported Solana wallet found. Install Phantom or Solflare.');
  }
}

function updateConnectButton() {
  const btn = document.getElementById('connect-wallet');
  if (!btn || !walletPublicKey) return;
  const short = walletPublicKey.toString().slice(0, 4) + '...' + walletPublicKey.toString().slice(-4);
  btn.textContent = '✅ ' + short;
  btn.onclick = disconnectWallet;  // allow click to disconnect
}

async function disconnectWallet() {
  try {
    if (window.solana && window.solana.disconnect) await window.solana.disconnect();
    if (window.solflare && window.solflare.disconnect) await window.solflare.disconnect();
  } catch (_) {}
  walletPublicKey = null;
  document.body.classList.remove('wallet-connected');
  const btn = document.getElementById('connect-wallet');
  if (btn) {
    btn.textContent = 'Connect Wallet';
    btn.onclick = connectWallet;
  }
  showToast('Wallet disconnected');
}

// Fetch current SOL price (USD) from Coingecko
async function fetchSolPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await res.json();
    return data.solana.usd;
  } catch (_) {
    return null;
  }
}

// Public mint – send ~10 USD worth of SOL to treasury
// These are the actual on-chain NFT mint addresses (mainnet)
// After payment, the site will show a ready-to-run airdrop command using scripts/transfer-nft.mjs
const NFT_MINTS = {
  galactic_cat: {
    name: "Quazr Galactic Cat",
    mint: "C7b5mxAXEHBYhBEKvFGy8s2HjmEDnAntuqVS18YTLoyW",
    explorer: "https://explorer.solana.com/address/C7b5mxAXEHBYhBEKvFGy8s2HjmEDnAntuqVS18YTLoyW"
  },
  quazr_core: {
    name: "Quazr Core",
    mint: "Fe3gRxHBiQzzHy5p9V1nJsGR96yDXoxZPFv8Nf74HQ5s",
    explorer: "https://explorer.solana.com/address/Fe3gRxHBiQzzHy5p9V1nJsGR96yDXoxZPFv8Nf74HQ5s"
  },
  shiba_astronaut: {
    name: "Quazr Shiba Astronaut",
    mint: "7SZqoyE9jwdN2kXi5JcLrRDyyr8wNAYeSYqgxwKTrY5h",
    explorer: "https://explorer.solana.com/address/7SZqoyE9jwdN2kXi5JcLrRDyyr8wNAYeSYqgxwKTrY5h"
  }
};

async function mintNFT(nftId) {
  if (!walletPublicKey) {
    showToast('🔑 Connect your wallet first');
    return;
  }
  if (typeof solanaWeb3 === 'undefined') {
    showToast('❌ Solana library not loaded. Refresh the page.');
    return;
  }

  const nftInfo = NFT_MINTS[nftId];
  if (!nftInfo) {
    showToast('❌ Unknown NFT');
    return;
  }

  const priceUSD = 10;
  const solPrice = await fetchSolPrice();
  const lamports = solPrice
    ? Math.ceil((priceUSD / solPrice) * solanaWeb3.LAMPORTS_PER_SOL)
    : Math.ceil(0.001 * solanaWeb3.LAMPORTS_PER_SOL);
  const solAmount = (lamports / solanaWeb3.LAMPORTS_PER_SOL).toFixed(4);

  const confirmed = confirm(
    `Support Quazr & claim ${nftInfo.name}?\n\n` +
    `Cost: ~${solAmount} SOL (≈ $${priceUSD})\n` +
    `This sends SOL to the treasury.\n\n` +
    `Real airdrop: After payment, the owner runs a transfer script to send you the actual NFT on-chain.`
  );
  if (!confirmed) return;

  const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('mainnet-beta')); // mainnet - matches the live NFTs
  const transaction = new solanaWeb3.Transaction().add(
    solanaWeb3.SystemProgram.transfer({
      fromPubkey: walletPublicKey,
      toPubkey: TREASURY_ADDRESS,
      lamports,
    })
  );
  transaction.feePayer = walletPublicKey;

  try {
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    // Try modern sign + fallback
    let signedTx;
    if (window.solana && window.solana.signTransaction) {
      signedTx = await window.solana.signTransaction(transaction);
    } else if (window.solflare && window.solflare.signTransaction) {
      signedTx = await window.solflare.signTransaction(transaction);
    } else {
      throw new Error('No compatible wallet signing method found');
    }

    const signature = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(signature, 'processed');

    const recipient = walletPublicKey.toString();
    const transferCmd = `node scripts/transfer-nft.mjs ${recipient} ${nftId}`;

    const msg = `✅ Payment received for ${nftInfo.name}! Tx: ${signature.slice(0,8)}…\n` +
                `NFT Mint: ${nftInfo.mint}\n` +
                `View: ${nftInfo.explorer}`;

    showToast(`✅ Payment received! Attempting automatic airdrop...`);
    console.log('%c' + msg, 'color: #0f0; font-family: monospace');

    const claimInstructions = 
      '✅ Payment successful!\n\n' +
      msg + '\n\n' +
      'REAL AIRDROP / TRANSFER:\n' +
      '• If the claim server is running: the NFT should be transferred automatically.\n' +
      '• Otherwise, run this command:\n\n' +
      transferCmd + '\n\n' +
      'Start the server with: node claim-server.mjs (in another terminal)';

    // Try automatic claim via local server
    try {
      const response = await fetch('http://localhost:3001/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, nftId })
      });

      const data = await response.json();

      if (data.success && data.signature) {
        const autoMsg = `🚀 NFT AIRDROPPED!\n\n` +
                        `${nftInfo.name} sent to ${recipient}\n` +
                        `Tx: ${data.signature}\n\n` +
                        `View: https://explorer.solana.com/tx/${data.signature}`;
        console.log('%c' + autoMsg, 'color: #0f0; font-family: monospace');
        alert(autoMsg);
        showToast('🚀 NFT automatically airdropped!');
      } else {
        throw new Error(data.error || 'Server did not confirm transfer');
      }
    } catch (fetchErr) {
      // Server not running or error → fall back to manual command
      console.log('%c[CLAIM SERVER NOT RUNNING] Copy and run this command as owner:', 'color: #ff0; font-weight: bold');
      console.log('%c' + transferCmd, 'color: #0f0; font-family: monospace; font-size: 13px');

      alert(claimInstructions);
      showToast('Payment complete — see alert for claim instructions');
    }

  } catch (err) {
    console.error(err);
    showToast('❌ Payment failed: ' + (err.message || err));
  }
}

// Export to global scope
window.connectWallet = connectWallet;
window.mintNFT = mintNFT;
