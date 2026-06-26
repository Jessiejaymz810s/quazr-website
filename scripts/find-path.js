import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import dotenv from 'dotenv';

dotenv.config();

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

async function findPath() {
    const mnemonic = process.env.BTC_MNEMONIC;
    const targetAddress = "tb1ppfzukdgpczjqgzf997mc5lj5m7tgzt3w2qd0a4pz58z5dl8ljj4sewylsn";
    
    console.log(`Searching for ${targetAddress} using mnemonic in .env...\n`);
    
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const network = bitcoin.networks.testnet;
    const root = bip32.fromSeed(seed, network);

    const paths = [
        "m/86'/1'/0'/0/0",
        "m/86'/1'/0'/0/1",
        "m/86'/1'/1'/0/0",
        "m/86'/0'/0'/0/0", // Mainnet path on Testnet network (sometimes happens)
        "m/44'/1'/0'/0/0",
        "m/84'/1'/0'/0/0",
    ];

    for (const path of paths) {
        try {
            const child = root.derivePath(path);
            const { address } = bitcoin.payments.p2tr({
                internalPubkey: child.publicKey.slice(1, 33),
                network,
            });
            if (address === targetAddress) {
                console.log(`MATCH FOUND! Path: ${path}`);
                return;
            }
            console.log(`Tried ${path}: ${address}`);
        } catch (e) {}
    }

    console.log('\nNo match found in common paths. The mnemonic in .env likely does not belong to this address.');
}

findPath().catch(console.error);
