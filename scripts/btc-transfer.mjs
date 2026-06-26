import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

const network = bitcoin.networks.testnet;
const MEMPOOL_API = 'https://mempool.space/testnet/api';

const toXOnly = (pubKey) => (pubKey.length === 32 ? pubKey : pubKey.slice(1, 33));

// Taproot tweak helper for key-path spending
function tweakSigner(signer) {
    let privateKey = signer.privateKey;
    if (!privateKey) return signer;
    if (signer.publicKey[0] === 3) privateKey = ecc.privateNegate(privateKey);

    const tweakedPrivKey = ecc.privateAdd(
        privateKey,
        bitcoin.crypto.taggedHash('TapTweak', toXOnly(signer.publicKey))
    );

    return ECPair.fromPrivateKey(Buffer.from(tweakedPrivKey), { network: signer.network });
}

async function transferFunds() {
    const mnemonic = process.env.BTC_MNEMONIC;
    if (!mnemonic) throw new Error('BTC_MNEMONIC not found in .env.');

    // Derivation for the OLD address (source of funds)
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const root = bip32.fromSeed(seed, network);
    const oldChild = root.derivePath("m/86'/1'/0'/0/0");
    const oldInternalPubkey = toXOnly(oldChild.publicKey);
    
    const { address: oldAddress } = bitcoin.payments.p2tr({
        internalPubkey: oldInternalPubkey,
        network,
    });

    // Destination address (from .env)
    const newAddress = process.env.BTC_TAPROOT_ADDRESS;

    console.log(`\n🚀 Preparing to transfer funds...`);
    console.log(`📤 From (Old Address): ${oldAddress}`);
    console.log(`📥 To (New Address):   ${newAddress}`);

    try {
        console.log('🔍 Fetching UTXOs...');
        const { data: utxos } = await axios.get(`${MEMPOOL_API}/address/${oldAddress}/utxo`);
        
        if (utxos.length === 0) {
            console.log('❌ No UTXOs found in the old address.');
            return;
        }

        // Filter out possible inscriptions (usually 546 or 1000 sats)
        const pureUtxos = utxos.filter(u => u.value > 10000);
        
        if (pureUtxos.length === 0) {
            console.log('❌ No pure BTC UTXOs found (all seem to be inscriptions).');
            return;
        }

        const psbt = new bitcoin.Psbt({ network });
        let totalValue = 0;

        // Add pure UTXOs as inputs
        for (const utxo of pureUtxos) {
            psbt.addInput({
                hash: utxo.txid,
                index: utxo.vout,
                witnessUtxo: {
                    value: BigInt(utxo.value),
                    script: bitcoin.address.toOutputScript(oldAddress, network)
                },
                tapInternalKey: oldInternalPubkey
            });
            totalValue += utxo.value;
            console.log(`✅ Added UTXO: ${utxo.value} sats`);
        }

        // Estimate fee (simple estimation: 200 sats per input + base size)
        const estimatedFee = (pureUtxos.length * 150) + 200; 
        const amountToSend = totalValue - estimatedFee;

        if (amountToSend <= 546) { // Dust limit
            console.log(`❌ Total value (${totalValue}) is too low to cover fees.`);
            return;
        }

        console.log(`\n💰 Total Balance: ${totalValue} sats`);
        console.log(`💸 Estimated Fee: ${estimatedFee} sats`);
        console.log(`📬 Sending:      ${amountToSend} sats`);

        // Add output
        psbt.addOutput({
            address: newAddress,
            value: BigInt(amountToSend)
        });

        // Sign all inputs
        const tweakedChild = tweakSigner(oldChild);
        for (let i = 0; i < pureUtxos.length; i++) {
            psbt.signInput(i, tweakedChild);
        }
        
        psbt.finalizeAllInputs();

        const tx = psbt.extractTransaction();
        const txHex = tx.toHex();
        const txId = tx.getId();

        console.log(`\n📦 Transaction created: ${txId}`);

        // Broadcast
        console.log('📡 Broadcasting transaction...');
        await axios.post(`${MEMPOOL_API}/tx`, txHex);
        
        console.log('✅ Transfer Successful!');
        console.log(`🔗 View on Explorer: https://mempool.space/testnet/tx/${txId}`);

    } catch (error) {
        console.error('\n❌ Error:', error.response?.data || error.message);
    }
}

transferFunds().catch(console.error);
