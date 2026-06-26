import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createNft,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  generateSigner,
  percentAmount,
  signerIdentity,
  createSignerFromKeypair,
} from "@metaplex-foundation/umi";
import fs from "fs";
import path from "path";
import os from "os";

// --- Configuration ---
const RPC_URL = "https://api.mainnet-beta.solana.com"; // Change to devnet for testing
const METADATA_BASE_URL = "https://raw.githubusercontent.com/Jessiejaymz810s/1sttoken1-14684bf365541cf108d53ec4e32cab3c0d2fa029-1-/main/metadata/nft/";

const NFTS = [
  {
    name: "Quazr Galactic Cat",
    uri: METADATA_BASE_URL + "galactic_cat.json",
  },
  {
    name: "Quazr Core",
    uri: METADATA_BASE_URL + "quazr_core.json",
  },
  {
    name: "Quazr Shiba Astronaut",
    uri: METADATA_BASE_URL + "shiba_astronaut.json",
  },
];

async function main() {
  console.log("🚀 Setting up Metaplex UMI for NFT Minting...");

  // Load keypair from default Solana CLI location
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}. Please ensure you have a Solana CLI identity.`);
  }
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const secretKey = new Uint8Array(keypairData);

  // Create UMI instance
  const umi = createUmi(RPC_URL).use(mplTokenMetadata());

  // Create signer from keypair
  const keypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  const signer = createSignerFromKeypair(umi, keypair);
  umi.use(signerIdentity(signer));

  console.log(`📍 Minting from Wallet: ${signer.publicKey}`);

  for (const nft of NFTS) {
    console.log(`\n💎 Minting NFT: "${nft.name}"...`);
    
    const mint = generateSigner(umi);
    
    try {
      const tx = await createNft(umi, {
        mint,
        name: nft.name,
        uri: nft.uri,
        sellerFeeBasisPoints: percentAmount(0), // 0% royalties for now
      }).sendAndConfirm(umi);

      console.log(`✅ Success! Mint Address: ${mint.publicKey}`);
      console.log(`🔗 View on Solana Explorer: https://explorer.solana.com/address/${mint.publicKey}`);
    } catch (err) {
      console.error(`❌ Failed to mint "${nft.name}":`, err.message || err);
    }
  }

  console.log("\n✨ All minting operations completed!");
}

main().catch((err) => {
  console.error("❌ Fatal Error:", err.message || err);
  process.exit(1);
});
