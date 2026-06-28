// add-sol-to-treasury.mjs – Transfer ~$10 worth of SOL to the treasury address
// Usage: node add-sol-to-treasury.mjs
// The script fetches the current SOL price from CoinGecko, calculates the lamports
// needed for $10, and sends the transfer from the local Solana CLI keypair.

import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import os from "os";
import fetch from "node-fetch"; // ensure node-fetch is available

// ---- Configuration ----
const TREASURY_ADDRESS = new PublicKey("ExnLqmHs1zMe4CbFtoygooiVSBomH2hwALWefeWQ1GHY");
const RPC_URL = "https://api.mainnet-beta.solana.com";
const USD_AMOUNT = 10; // $10 worth of SOL
// -----------------------

async function fetchSolPriceUsd() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const data = await res.json();
    return data.solana.usd;
  } catch (e) {
    console.error("Failed to fetch SOL price:", e);
    return null;
  }
}

async function main() {
  // Load payer keypair (same as used in other scripts)
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const { Keypair } = await import("@solana/web3.js");
  const payer = Keypair.fromSecretKey(new Uint8Array(secret));

  const connection = new Connection(RPC_URL, "confirmed");

  const price = await fetchSolPriceUsd();
  if (!price) {
    console.error("Unable to determine SOL price – aborting.");
    process.exit(1);
  }
  const lamports = Math.ceil((USD_AMOUNT / price) * LAMPORTS_PER_SOL);
  const solAmount = (lamports / LAMPORTS_PER_SOL).toFixed(6);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: TREASURY_ADDRESS,
      lamports,
    })
  );
  transaction.feePayer = payer.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  // Sign and send
  transaction.partialSign(payer);
  const serialized = transaction.serialize();
  const signature = await connection.sendRawTransaction(serialized);
  await connection.confirmTransaction(signature, "processed");

  console.log(`✅ Sent $${USD_AMOUNT} (≈ ${solAmount} SOL) to treasury.`);
  console.log(`   Transaction: https://explorer.solana.com/tx/${signature}?cluster=mainnet-beta`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
