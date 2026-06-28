import { Connection, Keypair } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createMetadataAccountV3, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { publicKey, signerIdentity, createSignerFromKeypair } from "@metaplex-foundation/umi";
import fs from "fs";
import path from "path";
import os from "os";

// --- Configuration ---
const RPC_URL = "https://api.mainnet-beta.solana.com";
const TOKEN_NAME = "BZbtc";
const TOKEN_SYMBOL = "BZBTC";
const METADATA_URI = "https://raw.githubusercontent.com/Jessiejaymz810s/quazr-website/main/token-bzbtc-metadata.json";
const DECIMALS = 9;
const AMOUNT_TO_MINT = 1; // Exactly 1 token
// -----------------------

async function main() {
  console.log("🚀 Starting BZbtc creation process...");

  // 1. Connect and load wallet
  const connection = new Connection(RPC_URL, "confirmed");
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(new Uint8Array(secret));
  
  console.log(`📍 Payer Wallet: ${payer.publicKey.toBase58()}`);

  // 2. Create a brand new Token Mint
  console.log("🪙 Creating new Token Mint...");
  const mintAddress = await createMint(
    connection,
    payer,           // payer
    payer.publicKey, // mint authority
    payer.publicKey, // freeze authority
    DECIMALS         // decimals
  );
  console.log(`✅ Mint created! Address: ${mintAddress.toBase58()}`);

  // 3. Create Associated Token Account (ATA) for the payer
  console.log("💼 Creating token account for wallet...");
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mintAddress,
    payer.publicKey
  );

  // 4. Mint exactly 1 token
  console.log(`💎 Minting exactly ${AMOUNT_TO_MINT} ${TOKEN_SYMBOL}...`);
  const baseUnits = AMOUNT_TO_MINT * Math.pow(10, DECIMALS);
  await mintTo(
    connection,
    payer,
    mintAddress,
    tokenAccount.address,
    payer,
    baseUnits
  );
  console.log(`✅ Minted 1 ${TOKEN_SYMBOL} to ${payer.publicKey.toBase58()}`);

  // 5. Attach Metadata using Umi (Name, Symbol, Logo)
  console.log("📝 Attaching metadata (Name, Logo, etc.)...");
  const umi = createUmi(RPC_URL).use(mplTokenMetadata());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secret));
  const signer = createSignerFromKeypair(umi, umiKeypair);
  umi.use(signerIdentity(signer));

  const tx = await createMetadataAccountV3(umi, {
    mint: publicKey(mintAddress.toBase58()),
    mintAuthority: signer,
    payer: signer,
    updateAuthority: signer.publicKey,
    data: {
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      uri: METADATA_URI,
      sellerFeeBasisPoints: 0,
      creators: null,
      collection: null,
      uses: null,
    },
    isMutable: true,
    collectionDetails: null,
  }).sendAndConfirm(umi);

  console.log("✅ Metadata attached successfully!");
  console.log(`\n🎉 ALL DONE!`);
  console.log(`🔗 View your new BZbtc token here:`);
  console.log(`   https://explorer.solana.com/address/${mintAddress.toBase58()}?cluster=mainnet-beta`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
