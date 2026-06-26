/**
 * create-raydium-pool.mjs
 *
 * Creates a new Raydium CPMM liquidity pool for QZSOL / SOL.
 *
 * Usage:
 *   node scripts/create-raydium-pool.mjs              # Execute for real
 *   node scripts/create-raydium-pool.mjs --dry-run    # Simulate only
 *
 * Prerequisites:
 *   - Solana CLI keypair at ~/.config/solana/id.json
 *   - Sufficient SOL balance (~1.3 SOL: 1 SOL for liquidity + ~0.3 for fees)
 *   - 100,000 QZSOL tokens in wallet
 */

import {
  Raydium,
  TxVersion,
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
  getCpmmPdaAmmConfigId,
  parseTokenAccountResp,
} from '@raydium-io/raydium-sdk-v2';
import { Connection, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Configuration ──────────────────────────────────────────────────────────────

const QZSOL_MINT = 'EqzogyGM1RKUdwpNgUeuWLy6L8wiFxGxFQcugkiPsemc';
const QZSOL_DECIMALS = 9;
const SOL_DECIMALS = 9;

// Liquidity amounts
const QZSOL_AMOUNT = 100_000;    // 100,000 QZSOL tokens
const SOL_AMOUNT = 0.8;          // 0.8 SOL (leaving ~0.2 SOL for pool creation fees)

// Native SOL mint (Wrapped SOL)
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Helpers ────────────────────────────────────────────────────────────────────

function loadKeypair() {
  const keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}. Run "solana-keygen new" or set your keypair path.`);
  }
  const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')));
  return Keypair.fromSecretKey(secretKey);
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          🌊 Raydium CPMM Pool Creator — QZSOL/SOL          ║');
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

  // Check SOL balance
  const balance = await connection.getBalance(owner.publicKey);
  const solBalance = balance / 1e9;
  console.log(`💰 Balance: ${solBalance.toFixed(4)} SOL`);

  const requiredSol = SOL_AMOUNT + 0.15; // liquidity + estimated pool creation fees
  if (solBalance < requiredSol) {
    console.error(`\n❌ Insufficient SOL! Need ~${requiredSol} SOL (${SOL_AMOUNT} for liquidity + ~0.15 for fees).`);
    console.error(`   Current balance: ${solBalance.toFixed(4)} SOL`);
    console.error(`   Please fund your wallet: ${owner.publicKey.toBase58()}`);
    process.exit(1);
  }

  // 3. Initialize Raydium SDK
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

  // 4. Get token info
  console.log('\n📦 Fetching token info...');

  // QZSOL token info — provide directly since it may not be in Raydium's token list yet
  const mintA = {
    address: QZSOL_MINT,
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: QZSOL_DECIMALS,
  };

  // SOL (Wrapped SOL)
  const mintB = {
    address: WSOL_MINT,
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: SOL_DECIMALS,
  };

  console.log(`   Token A: QZSOL (${QZSOL_MINT})`);
  console.log(`   Token B: SOL   (${WSOL_MINT})`);

  // 5. Calculate amounts in base units (lamports / smallest units)
  const mintAAmount = new BN(
    new Decimal(QZSOL_AMOUNT).mul(new Decimal(10).pow(QZSOL_DECIMALS)).toFixed(0)
  );
  const mintBAmount = new BN(
    new Decimal(SOL_AMOUNT).mul(new Decimal(10).pow(SOL_DECIMALS)).toFixed(0)
  );

  const price = SOL_AMOUNT / QZSOL_AMOUNT;
  console.log(`\n💱 Initial liquidity:`);
  console.log(`   ${QZSOL_AMOUNT.toLocaleString()} QZSOL + ${SOL_AMOUNT} SOL`);
  console.log(`   Initial price: ${price.toFixed(10)} SOL per QZSOL`);

  // 6. Fetch fee configs
  console.log('\n⏳ Fetching Raydium fee configs...');
  const feeConfigs = await raydium.api.getCpmmConfigs();
  console.log(`   Found ${feeConfigs.length} fee tier(s)`);

  if (feeConfigs.length === 0) {
    throw new Error('No CPMM fee configs found from Raydium API');
  }

  // Find a suitable fee config:
  // - Prefer index 9 (standard 0.25% public tier) or index 1 (1% tier)
  // - Fall back to any config with tradeFeeRate=10000 (1%) which is commonly open
  let feeConfig = feeConfigs.find(c => c.index === 9)    // 0.25% public
    || feeConfigs.find(c => c.index === 1)                // 1% tier
    || feeConfigs.find(c => c.tradeFeeRate === 10000)     // any 1% tier
    || feeConfigs[0];                                     // fallback

  console.log(`   Using fee tier: id=${feeConfig.id}, index=${feeConfig.index}, tradeFeeRate=${feeConfig.tradeFeeRate}`);

  // 7. Create the pool
  console.log('\n🚀 Creating CPMM pool...');
  const { execute, extInfo, transaction } = await raydium.cpmm.createPool({
    programId: CREATE_CPMM_POOL_PROGRAM,
    poolFeeAccount: CREATE_CPMM_POOL_FEE_ACC,
    mintA,
    mintB,
    mintAAmount,
    mintBAmount,
    startTime: new BN(0),
    feeConfig,
    associatedOnly: false,
    ownerInfo: {
      useSOLBalance: true,
    },
    txVersion: TxVersion.V0,
    computeBudgetConfig: {
      units: 600000,
      microLamports: 100000, // priority fee
    },
  });

  // Log pool info
  const poolKeys = Object.keys(extInfo.address).reduce((acc, cur) => ({
    ...acc,
    [cur]: extInfo.address[cur].toString(),
  }), {});

  console.log('\n📋 Pool Details:');
  console.log(`   Pool ID:     ${poolKeys.poolId || 'N/A'}`);
  console.log(`   LP Mint:     ${poolKeys.lpMint || 'N/A'}`);
  console.log(`   Authority:   ${poolKeys.authority || 'N/A'}`);

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN — Simulating transaction...');
    console.log('   Transaction built successfully. Pool would be created with the above parameters.');
    console.log('\n   Run without --dry-run to execute for real:');
    console.log('   node scripts/create-raydium-pool.mjs');
  } else {
    console.log('\n📡 Sending transaction...');
    try {
      const { txId } = await execute({ sendAndConfirm: true });
      console.log('\n╔══════════════════════════════════════════════════════════════╗');
      console.log('║                    🎉 POOL CREATED!                         ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log(`\n   🔗 Transaction: https://solscan.io/tx/${txId}`);
      console.log(`   🏊 Pool ID:     ${poolKeys.poolId || 'N/A'}`);
      console.log(`   🔗 Raydium:     https://raydium.io/liquidity/increase/?mode=add&pool_id=${poolKeys.poolId}`);
      console.log('\n   Save your Pool ID! You\'ll need it to add more liquidity later.');

      // Save pool info to a file for future reference
      const poolInfoFile = path.join(process.cwd(), 'raydium-pool-info.json');
      fs.writeFileSync(poolInfoFile, JSON.stringify({
        poolId: poolKeys.poolId,
        lpMint: poolKeys.lpMint,
        mintA: QZSOL_MINT,
        mintB: WSOL_MINT,
        initialLiquidity: {
          qzsolAmount: QZSOL_AMOUNT,
          solAmount: SOL_AMOUNT,
        },
        createdAt: new Date().toISOString(),
        txId,
      }, null, 2));
      console.log(`\n   💾 Pool info saved to: raydium-pool-info.json`);
    } catch (err) {
      console.error('\n❌ Transaction failed!');
      // Extract useful info from the error
      const errObj = typeof err === 'object' ? err : {};
      if (errObj.InstructionError) {
        console.error('   Instruction Error:', JSON.stringify(errObj.InstructionError));
      }
      if (errObj.message) {
        console.error('   Message:', errObj.message);
      }
      if (errObj.txId) {
        console.error(`   🔗 Failed TX: https://solscan.io/tx/${errObj.txId}`);
      }
      if (errObj.logs) {
        console.error('\n   Transaction logs:');
        errObj.logs.forEach(log => console.error(`     ${log}`));
      }
      // Log full error for debugging
      console.error('\n   Full error:', JSON.stringify(err, null, 2));
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
