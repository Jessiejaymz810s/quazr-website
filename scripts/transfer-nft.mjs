import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";
import fs from "fs";
import path from "path";
import os from "os";

// Map of NFT ids to their mainnet mint addresses
const NFT_MINTS = {
  galactic_cat: "C7b5mxAXEHBYhBEKvFGy8s2HjmEDnAntuqVS18YTLoyW",
  quazr_core: "Fe3gRxHBiQzzHy5p9V1nJsGR96yDXoxZPFv8Nf74HQ5s",
  shiba_astronaut: "7SZqoyE9jwdN2kXi5JcLrRDyyr8wNAYeSYqgxwKTrY5h",
};

export async function transferNFT(recipientStr, nftId) {
  if (!NFT_MINTS[nftId]) {
    throw new Error(`Unknown nftId: ${nftId}. Valid: ${Object.keys(NFT_MINTS).join(", ")}`);
  }

  const recipient = new PublicKey(recipientStr);
  const mintAddress = NFT_MINTS[nftId];
  const mint = new PublicKey(mintAddress);

  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  // Load treasury keypair (same as used for minting)
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
  }
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const secretKey = new Uint8Array(keypairData);
  const keypair = Keypair.fromSecretKey(secretKey);

  console.log(`🚀 Transferring ${nftId} (${mintAddress})`);
  console.log(`   From treasury: ${keypair.publicKey.toString()}`);
  console.log(`   To recipient:  ${recipient.toString()}`);

  try {
    // Get or create the associated token accounts (creates ATA on recipient side if needed)
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      mint,
      keypair.publicKey
    );

    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      mint,
      recipient
    );

    console.log("   From ATA:", fromTokenAccount.address.toString());
    console.log("   To ATA:  ", toTokenAccount.address.toString());

    // Perform the transfer (1 unit = the NFT)
    const signature = await transfer(
      connection,
      keypair,
      fromTokenAccount.address,
      toTokenAccount.address,
      keypair.publicKey,
      1,           // amount
      [],          // multi signers
      "confirmed"
    );

    console.log(`✅ Success! Transaction: ${signature}`);
    console.log(`🔗 https://explorer.solana.com/tx/${signature}`);
    console.log(`🔗 NFT now at: https://explorer.solana.com/address/${mintAddress}`);

    return { success: true, signature, mint: mintAddress };
  } catch (err) {
    console.error("❌ Transfer failed:", err.message || err);
    throw err;
  }
}

async function main() {
  const recipientStr = process.argv[2];
  const nftId = process.argv[3];

  if (!recipientStr || !nftId || !NFT_MINTS[nftId]) {
    console.error("Usage: node scripts/transfer-nft.mjs <recipient-wallet-address> <galactic_cat | quazr_core | shiba_astronaut>");
    console.error("Example: node scripts/transfer-nft.mjs <buyer-address> galactic_cat");
    process.exit(1);
  }

  try {
    await transferNFT(recipientStr, nftId);
  } catch (err) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message || err);
  process.exit(1);
});