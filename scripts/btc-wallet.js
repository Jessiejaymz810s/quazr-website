import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

async function generateWallet() {
    // Generate mnemonic if not exists
    let mnemonic = process.env.BTC_MNEMONIC;
    if (!mnemonic) {
        mnemonic = bip39.generateMnemonic();
        console.log('Generated new mnemonic.');
    } else {
        console.log('Using existing mnemonic from .env');
    }

    const seed = await bip39.mnemonicToSeed(mnemonic);
    const root = bip32.fromSeed(seed, bitcoin.networks.testnet);

    // Taproot derivation path (BIP86) using coin 0 (Mainnet path) to match user's wallet
    const path = "m/86'/0'/0'/0/0";
    const child = root.derivePath(path);

    const { address } = bitcoin.payments.p2tr({
        internalPubkey: child.publicKey.slice(1, 33),
        network: bitcoin.networks.testnet,
    });

    console.log('\n--- Bitcoin Testnet Wallet (Taproot) ---');
    console.log(`Address: ${address}`);
    console.log(`Path:    ${path}`);
    console.log('----------------------------------------\n');

    if (!process.env.BTC_MNEMONIC) {
        console.log('IMPORTANT: Save your mnemonic somewhere safe!');
        console.log(`Mnemonic: ${mnemonic}`);
        
        // Append to .env
        const envPath = '.env';
        const envContent = `\n# Bitcoin Testnet Mnemonic\nBTC_MNEMONIC="${mnemonic}"\nBTC_TAPROOT_ADDRESS="${address}"\n`;
        fs.appendFileSync(envPath, envContent);
        console.log('\nSaved BTC_MNEMONIC and BTC_TAPROOT_ADDRESS to .env');
    }

    console.log('\nNext Step: Fund this address using a Testnet faucet.');
    console.log('Suggested Faucets:');
    console.log('- https://coinfaucet.eu/en/btc-testnet/');
    console.log('- https://bitcoinfaucet.uo1.net/');
    console.log('- https://cryptopump.info/send.php');
}

generateWallet().catch(console.error);
