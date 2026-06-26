import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  updateV1,
  fetchMetadataFromSeeds,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import { publicKey, signerIdentity, createSignerFromKeypair } from "@metaplex-foundation/umi";
import fs from "fs";
import path from "path";
import os from "os";

// --- Configuration ---
const MINT_ADDRESS = "EqzogyGM1RKUdwpNgUeuWLy6L8wiFxGxFQcugkiPsemc";
const TOKEN_NAME = "Quazr";
const TOKEN_SYMBOL = "QZSOL";
const METADATA_URI = "https://raw.githubusercontent.com/Jessiejaymz810s/1sttoken1-14684bf365541cf108d53ec4e32cab3c0d2fa029-1-/main/token-metadata.json";
const RPC_URL = "https://api.mainnet-beta.solana.com";

async function main() {
  console.log("🚀 Setting up Metaplex UMI...");

  // Load keypair from default Solana CLI location
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const secretKey = new Uint8Array(keypairData);

  // Create UMI instance
  const umi = createUmi(RPC_URL).use(mplTokenMetadata());

  // Create signer from keypair
  const keypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  const signer = createSignerFromKeypair(umi, keypair);
  umi.use(signerIdentity(signer));

  console.log(`📍 Wallet: ${signer.publicKey}`);
  console.log(`🪙 Mint: ${MINT_ADDRESS}`);

  const mint = publicKey(MINT_ADDRESS);

  // First try to fetch existing metadata
  try {
    console.log("🔍 Checking for existing metadata...");
    const existingMetadata = await fetchMetadataFromSeeds(umi, { mint });
    console.log("📋 Existing metadata found, updating...");
    console.log(`   Current name: "${existingMetadata.name}"`);
    console.log(`   Current symbol: "${existingMetadata.symbol}"`);

    const tx = await updateV1(umi, {
      mint,
      authority: signer,
      data: {
        ...existingMetadata,
        name: TOKEN_NAME,
        symbol: TOKEN_SYMBOL,
        uri: METADATA_URI,
      },
    }).sendAndConfirm(umi);

    console.log("✅ Metadata updated successfully!");
  } catch (fetchError) {
    // No existing metadata, try to create it
    console.log("📝 No existing metadata found, creating new...");
    
    const { createMetadataAccountV3 } = await import("@metaplex-foundation/mpl-token-metadata");
    
    const tx = await createMetadataAccountV3(umi, {
      mint,
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

    console.log("✅ Metadata created successfully!");
  }

  console.log(`\n🔗 View your token on Solana Explorer:`);
  console.log(`   https://explorer.solana.com/address/${MINT_ADDRESS}?cluster=devnet`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
});
