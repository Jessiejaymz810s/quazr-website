import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import dotenv from 'dotenv';

dotenv.config();

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

async function checkAllAddresses() {
    const mnemonic = process.env.BTC_MNEMONIC;
    if (!mnemonic) {
        console.error('Error: BTC_MNEMONIC not found in .env');
        return;
    }

    console.log('Using mnemonic from .env\n');
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const network = bitcoin.networks.testnet;
    const root = bip32.fromSeed(seed, network);

    // 1. Taproot (BIP86)
    const path86 = "m/86'/1'/0'/0/0";
    const child86 = root.derivePath(path86);
    const { address: taproot } = bitcoin.payments.p2tr({
        internalPubkey: child86.publicKey.slice(1, 33),
        network,
    });

    // 2. Native SegWit (BIP84)
    const path84 = "m/84'/1'/0'/0/0";
    const child84 = root.derivePath(path84);
    const { address: nativeSegwit } = bitcoin.payments.p2wpkh({
        pubkey: child84.publicKey,
        network,
    });

    // 3. Nested SegWit (BIP49)
    const path49 = "m/49'/1'/0'/0/0";
    const child49 = root.derivePath(path49);
    const { address: nestedSegwit } = bitcoin.payments.p2sh({
        redeem: bitcoin.payments.p2wpkh({
            pubkey: child49.publicKey,
            network,
        }),
        network,
    });

    // 4. Legacy (BIP44)
    const path44 = "m/44'/1'/0'/0/0";
    const child44 = root.derivePath(path44);
    const { address: legacy } = bitcoin.payments.p2pkh({
        pubkey: child44.publicKey,
        network,
    });

    console.log('--- Bitcoin Testnet Addresses ---');
    console.log(`Taproot (P2TR):      ${taproot}  (Path: ${path86})`);
    console.log(`Native SegWit (Bech32): ${nativeSegwit}  (Path: ${path84})`);
    console.log(`Nested SegWit (P2SH):   ${nestedSegwit}  (Path: ${path49})`);
    console.log(`Legacy (P2PKH):         ${legacy}  (Path: ${path44})`);
    console.log('---------------------------------');
}

checkAllAddresses().catch(console.error);
