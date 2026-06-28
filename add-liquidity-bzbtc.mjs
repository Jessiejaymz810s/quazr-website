// add-liquidity-bzbtc.mjs – Add ~$10 worth of SOL and matching BZBTC to a Raydium pool
// Usage: node add-liquidity-bzbtc.mjs <POOL_ID> <SOL_AMOUNT>
// Example: node add-liquidity-bzbtc.mjs 9QWw... 0.141044

#!/usr/bin/env node
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { Keypair } = require("@solana/web3.js");
const { getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");
const { Liquidity, Percent, Token, TokenAmount, toTokenAmount } = require("@raydium-io/raydium-sdk-v2");
const fs = require("fs");
const path = require("path");
const os = require("os");
const fetch = require("node-fetch");

// ---- Configuration ----
const RPC_URL = "https://api.mainnet-beta.solana.com";
// Treasury / fee address – you can reuse the same keypair that sent the $10 SOL
// The payer will be the wallet that holds the SOL and BZBTC tokens.
// ---------------------------------------------------------------

async function loadPayer() {
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: node add-liquidity-bzbtc.mjs <POOL_ID> <SOL_AMOUNT>");
    process.exit(1);
  }
  const [poolIdStr, solAmountStr] = args;
  const poolId = new PublicKey(poolIdStr);
  const solAmount = Number(solAmountStr);
  if (isNaN(solAmount) || solAmount <= 0) {
    console.error("Invalid SOL amount");
    process.exit(1);
  }

  const payer = await loadPayer();
  const connection = new Connection(RPC_URL, "confirmed");

  // Load the pool information via Raydium SDK
  const poolInfo = await Liquidity.getPoolInfo(connection, poolId);
  if (!poolInfo) {
    console.error("Failed to fetch pool info. Verify the POOL_ID is a Raydium pool address.");
    process.exit(1);
  }

  // Tokens involved in the pool
  const tokenA = poolInfo.baseToken; // usually SOL wrapped (WSOL)
  const tokenB = poolInfo.quoteToken; // BZBTC token

  // Compute lamports for the provided SOL amount
  const lamports = Math.round(solAmount * LAMPORTS_PER_SOL);

  // Determine how much BZBTC should be paired (simple 1:1 price ratio for now)
  // Adjust this logic according to your desired price.
  const priceRatio = 1; // 1 BZBTC per 1 SOL (placeholder)
  const bzbtcAmount = solAmount * priceRatio;

  // Convert to token amounts respecting decimals
  const solTokenAmount = toTokenAmount(tokenA, lamports);
  const bzbtcTokenAmount = toTokenAmount(tokenB, Math.round(bzbtcAmount * Math.pow(10, tokenB.decimals)));

  // Ensure ATAs exist for both tokens
  const ataA = await getOrCreateAssociatedTokenAccount(connection, payer, tokenA.mint, payer.publicKey);
  const ataB = await getOrCreateAssociatedTokenAccount(connection, payer, tokenB.mint, payer.publicKey);

  // Build the add‑liquidity instruction using Raydium SDK
  const addLiquidityTx = await Liquidity.makeAddLiquidityTransaction({
    connection,
    poolKeys: poolInfo,
    userKeys: {
      tokenAccountA: ataA.address,
      tokenAccountB: ataB.address,
      owner: payer.publicKey,
    },
    amountInA: solTokenAmount,
    amountInB: bzbtcTokenAmount,
    // 0.5% slippage tolerance – you may adjust
    slippage: new Percent(5, 1000),
    // optional add lp token destination; leaving undefined sends to default ATA
  });

  // Sign and send transaction
  addLiquidityTx.feePayer = payer.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  addLiquidityTx.recentBlockhash = blockhash;
  addLiquidityTx.partialSign(payer);
  const rawTx = addLiquidityTx.serialize();
  const signature = await connection.sendRawTransaction(rawTx);
  await connection.confirmTransaction(signature, "processed");

  console.log(`✅ Added liquidity to pool ${poolId.toBase58()}`);
  console.log(`   SOL added: ${solAmount} (~${lamports} lamports)`);
  console.log(`   BZBTC added (approx): ${bzbtcAmount}`);
  console.log(`   Transaction: https://explorer.solana.com/tx/${signature}?cluster=mainnet-beta`);
}

main().catch(err => {
  console.error("❌ Error adding liquidity:", err);
  process.exit(1);
});
