import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createMetadataAccountV3, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { publicKey, signerIdentity, createSignerFromKeypair } from "@metaplex-foundation/umi";
import fs from "fs";
import path from "path";
import os from "os";

const RPC_URL = "https://api.mainnet-beta.solana.com";
const MINT_ADDRESS = "791hDNsVndoQRuy6TELFjY7txcQ76WwjVzmquVXyWbST"; // The mint we just created
const TOKEN_NAME = "BZbtc";
const TOKEN_SYMBOL = "BZBTC";
const METADATA_URI = "https://raw.githubusercontent.com/Jessiejaymz810s/quazr-website/main/token-bzbtc-metadata.json";

async function main() {
  console.log(`🚀 Retrying metadata creation for mint: ${MINT_ADDRESS}`);

  const umi = createUmi(RPC_URL).use(mplTokenMetadata());
  
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secret));
  const signer = createSignerFromKeypair(umi, umiKeypair);
  umi.use(signerIdentity(signer));

  console.log("📝 Attaching metadata...");
  try {
    const tx = await createMetadataAccountV3(umi, {
      mint: publicKey(MINT_ADDRESS),
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
    console.log(`   https://explorer.solana.com/address/${MINT_ADDRESS}?cluster=mainnet-beta`);
  } catch (e) {
    console.error("Failed:", e.message || e);
    if (e.logs) console.log(e.logs);
  }
}

main();
