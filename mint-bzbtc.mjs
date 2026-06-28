// mint-bzbtc.mjs – Mint BZBTC tokens to a specified wallet
// Usage: node mint-bzbtc.mjs <RECIPIENT_PUBLIC_KEY> <AMOUNT>
// Example: node mint-bzbtc.mjs B5v... 1

import { Connection, clusterApiUrl, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo, getMint } from "@solana/spl-token";
import fs from "fs";
import path from "path";
import os from "os";

// ---- Configuration ----
const MINT_ADDRESS = "9A8SCuHfuAKb7hFndy6gw6mniZJeUtoobymQpL6W8mcM"; // BZBTC token mint
const RPC_URL = "https://api.mainnet-beta.solana.com";
// -----------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: node mint-bzbtc.mjs <RECIPIENT_PUBLIC_KEY> <AMOUNT>");
    process.exit(1);
  }
  const recipient = args[0];
  const amount = Number(args[1]);
  if (isNaN(amount) || amount <= 0) {
    console.error("Invalid amount");
    process.exit(1);
  }

  // Load payer keypair (assumes Solana CLI keypair)
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(new Uint8Array(secret));

  const connection = new Connection(RPC_URL, "confirmed");

  // Get or create ATA for recipient
  const mintPublicKey = new PublicKey(MINT_ADDRESS);
  const recipientPublicKey = new PublicKey(recipient);
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mintPublicKey,
    recipientPublicKey,
    false,
    payer
  );

  // Determine token decimals for amount conversion
  const mintInfo = await getMint(connection, mintPublicKey);
  const decimals = mintInfo.decimals;
  const amountInBaseUnits = amount * Math.pow(10, decimals);

  // Mint tokens to recipient ATA
  const signature = await mintTo(
    connection,
    payer,
    mintPublicKey,
    ata.address,
    payer,
    amountInBaseUnits
  );

  console.log(`✅ Minted ${amount} BZBTC to ${recipient}`);
  console.log(`   Transaction: https://explorer.solana.com/tx/${signature}?cluster=mainnet-beta`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
