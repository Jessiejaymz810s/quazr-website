/**
 * add-raydium-liquidity.mjs
 *
 * Adds more liquidity to an existing Raydium CPMM pool for QZSOL / SOL.
 *
 * Usage:
 *   node scripts/add-raydium-liquidity.mjs --sol 1            # Add 1 SOL worth of liquidity
 *   node scripts/add-raydium-liquidity.mjs --amount 50000     # Add 50,000 QZSOL worth
 *   node scripts/add-raydium-liquidity.mjs --dry-run          # Simulate only
 *
 * The script reads the pool ID from raydium-pool-info.json (created by create-raydium-pool.mjs)
 * or you can set the POOL_ID environment variable.
 */

import {
  Raydium,
  TxVersion,
  parseTokenAccountResp,
} from '@raydium-io/raydium-sdk-v2';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Configuration ──────────────────────────────────────────────────────────────

const QZSOL_DECIMALS = 9;
const SOL_DECIMALS = 9;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const DRY_RUN = process.argv.includes('--dry-run');

// Parse --sol flag (in SOL, e.g., --sol 1) or --amount flag (in QZSOL tokens)
const solFlagIdx = process.argv.indexOf('--sol');
const amountFlagIdx = process.argv.indexOf('--amount');

const USE_SOL = solFlagIdx !== -1;
let DEPOSIT_AMOUNT;
let DEPOSIT_DECIMALS;

if (USE_SOL) {
  DEPOSIT_AMOUNT = Number(process.argv[solFlagIdx + 1]);
  DEPOSIT_DECIMALS = SOL_DECIMALS;
} else {
  DEPOSIT_AMOUNT = amountFlagIdx !== -1 ? Number(process.argv[amountFlagIdx + 1]) : 100_000;
  DEPOSIT_DECIMALS = QZSOL_DECIMALS;
}

if (isNaN(DEPOSIT_AMOUNT) || DEPOSIT_AMOUNT <= 0) {
  console.error('❌ Invalid amount value. Must be a positive number.');
  console.error('   Usage: --sol 1  OR  --amount 50000');
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function loadKeypair() {
  const keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
  }
  const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')));
  return Keypair.fromSecretKey(secretKey);
}

function getPoolId() {
  // Check env var first
  if (process.env.POOL_ID) return process.env.POOL_ID;

  // Check raydium-pool-info.json
  const poolInfoPath = path.join(process.cwd(), 'raydium-pool-info.json');
  if (fs.existsSync(poolInfoPath)) {
    const info = JSON.parse(fs.readFileSync(poolInfoPath, 'utf-8'));
    if (info.poolId) {
      console.log(`   Pool ID loaded from raydium-pool-info.json`);
      return info.poolId;
    }
  }

  console.error('❌ No pool ID found!');
  console.error('   Either:');
  console.error('   1. Run create-raydium-pool.mjs first to create the pool');
  console.error('   2. Set POOL_ID environment variable: POOL_ID=<your_pool_id> node scripts/add-raydium-liquidity.mjs');
  process.exit(1);
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        💧 Raydium CPMM — Add Liquidity (QZSOL/SOL)         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  if (DRY_RUN) {
    console.log('🧪 DRY RUN MODE — transaction will be simulated but NOT sent\n');
  }

  // 1. Load wallet
  const owner = loadKeypair();
  console.log(`📍 Wallet:  ${owner.publicKey.toBase58()}`);

  // 2. Connect
  const connection = new Connection(RPC_URL, 'confirmed');
  console.log(`🌐 RPC:     ${RPC_URL}`);

  // Check balance
  const balance = await connection.getBalance(owner.publicKey);
  console.log(`💰 Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  // 3. Get pool ID
  const poolId = getPoolId();
  console.log(`🏊 Pool ID: ${poolId}`);

  // 4. Initialize Raydium SDK
  console.log('\n⏳ Initializing Raydium SDK...');
  const raydium = await Raydium.load({
    owner,
    connection,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    disableLoadToken: false,
    blockhashCommitment: 'finalized',
  });
  console.log('✅ SDK initialized');

  // 5. Fetch pool info
  console.log('\n📦 Fetching pool info...');
  let poolInfo, poolKeys;

  const data = await raydium.api.fetchPoolById({ ids: poolId });
  poolInfo = data[0];

  if (!poolInfo) {
    console.error('❌ Pool not found. Make sure the pool ID is correct.');
    process.exit(1);
  }

  console.log(`   Pool type:  ${poolInfo.type}`);
  console.log(`   Token A:    ${poolInfo.mintA.symbol || poolInfo.mintA.address}`);
  console.log(`   Token B:    ${poolInfo.mintB.symbol || poolInfo.mintB.address}`);

  // 6. Calculate deposit amount
  const inputAmount = new BN(
    new Decimal(DEPOSIT_AMOUNT).mul(new Decimal(10).pow(DEPOSIT_DECIMALS)).toFixed(0)
  );

  const slippage = { numerator: new BN(1), denominator: new BN(100) }; // 1% slippage
  // baseIn=true means amount is in token A (QZSOL), baseIn=false means amount is in token B (SOL)
  const baseIn = !USE_SOL;

  if (USE_SOL) {
    console.log(`\n💱 Deposit amount: ${DEPOSIT_AMOUNT} SOL (+ matching QZSOL calculated automatically)`);
  } else {
    console.log(`\n💱 Deposit amount: ${DEPOSIT_AMOUNT.toLocaleString()} QZSOL (+ matching SOL calculated automatically)`);
  }

  // 7. Add liquidity
  console.log('\n🚀 Building add-liquidity transaction...');
  const { execute } = await raydium.cpmm.addLiquidity({
    poolInfo,
    poolKeys,
    inputAmount,
    slippage,
    baseIn,
    txVersion: TxVersion.V0,
    ownerInfo: {
      useSOLBalance: true,
    },
    computeBudgetConfig: {
      units: 600000,
      microLamports: 100000,
    },
  });

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN — Transaction built successfully.');
    if (USE_SOL) {
      console.log(`   Would deposit ${DEPOSIT_AMOUNT} SOL + matching QZSOL`);
    } else {
      console.log(`   Would deposit ${DEPOSIT_AMOUNT.toLocaleString()} QZSOL + matching SOL`);
    }
    console.log('\n   Run without --dry-run to execute:');
    console.log('   node scripts/add-raydium-liquidity.mjs --sol 1');
  } else {
    console.log('\n📡 Sending transaction...');
    try {
      const { txId } = await execute({ sendAndConfirm: true });
      console.log('\n╔══════════════════════════════════════════════════════════════╗');
      console.log('║                 🎉 LIQUIDITY ADDED!                         ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log(`\n   🔗 Transaction: https://solscan.io/tx/${txId}`);
      console.log(`   🏊 Pool:        https://raydium.io/liquidity/increase/?mode=add&pool_id=${poolId}`);
    } catch (err) {
      console.error('\n❌ Transaction failed:', err.message || err);
      if (err.logs) {
        console.error('\nTransaction logs:');
        err.logs.forEach(log => console.error(`   ${log}`));
      }
      process.exit(1);
    }
  }

  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
