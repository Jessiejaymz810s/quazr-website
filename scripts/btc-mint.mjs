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

// Taproot tweak helper
function tweakSigner(signer, opts = {}) {
    let privateKey = signer.privateKey;
    if (!privateKey) return signer;
    if (signer.publicKey[0] === 3) privateKey = ecc.privateNegate(privateKey);

    const tweakedPrivKey = ecc.privateAdd(
        privateKey,
        bitcoin.crypto.taggedHash('TapTweak', toXOnly(signer.publicKey))
    );

    return ECPair.fromPrivateKey(Buffer.from(tweakedPrivKey), { network: signer.network });
}

// Helper to convert witness stack to script witness format
function witnessStackToScriptWitness(witness) {
    if (!witness || !Array.isArray(witness)) {
        console.error('❌ witnessStackToScriptWitness: witness is not an array!');
        throw new Error('witness is not an array');
    }
    console.log(`🛠️ Encoding witness stack with ${witness.length} items...`);
    let buffer = Buffer.allocUnsafe(0);

    function writeVarInt(i) {
        if (i < 0xfd) {
            buffer = Buffer.concat([buffer, Buffer.from([i])]);
        } else if (i <= 0xffff) {
            const b = Buffer.allocUnsafe(3);
            b[0] = 0xfd;
            b.writeUInt16LE(i, 1);
            buffer = Buffer.concat([buffer, b]);
        } else {
            const b = Buffer.allocUnsafe(5);
            b[0] = 0xfe;
            b.writeUInt32LE(i, 1);
            buffer = Buffer.concat([buffer, b]);
        }
    }

    writeVarInt(witness.length);
    witness.forEach((item, index) => {
        if (!item) {
            console.error(`❌ Witness item at index ${index} is undefined!`);
            throw new Error(`Witness item at index ${index} is undefined`);
        }
        writeVarInt(item.length);
        buffer = Buffer.concat([buffer, item]);
    });

    return buffer;
}

async function mintBRC20() {
    const mnemonic = process.env.BTC_MNEMONIC;
    if (!mnemonic) {
        throw new Error('BTC_MNEMONIC not found in .env.');
    }

    const ticker = 'quazr';
    const amount = '1000';
    console.log(`\n🚀 Preparing to mint BRC-20: ${ticker} (Amount: ${amount})`);

    // 1. Setup Wallet
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const root = bip32.fromSeed(seed, network);
    const child = root.derivePath("m/86'/0'/0'/0/0");
    const internalPubkey = toXOnly(child.publicKey);

    // 2. Define Inscription
    const brc20Data = JSON.stringify({
        p: "brc-20",
        op: "mint",
        tick: ticker,
        amt: amount
    });
    
    // Ordinals Inscription Script (Envelope)
    const inscriptionScript = bitcoin.script.compile([
        internalPubkey,
        bitcoin.opcodes.OP_CHECKSIG,
        bitcoin.opcodes.OP_0,
        bitcoin.opcodes.OP_IF,
        Buffer.from('ord'),
        bitcoin.opcodes.OP_1,
        Buffer.from('text/plain;charset=utf-8'),
        bitcoin.opcodes.OP_0,
        Buffer.from(brc20Data),
        bitcoin.opcodes.OP_ENDIF
    ]);

    const scriptTree = {
        output: inscriptionScript
    };

    const scriptTaproot = bitcoin.payments.p2tr({
        internalPubkey,
        scriptTree,
        network
    });

    const { witness: controlBlockWitness } = bitcoin.payments.p2tr({
        internalPubkey,
        scriptTree,
        redeem: { output: inscriptionScript, redeemVersion: 0xc0 },
        network
    });
    const controlBlock = controlBlockWitness[controlBlockWitness.length - 1];

    const commitAddress = scriptTaproot.address;
    const fundingAddress = process.env.BTC_TAPROOT_ADDRESS;

    console.log(`📍 Funding Address: ${fundingAddress}`);
    console.log(`📍 Commit Address:  ${commitAddress}`);

    try {
        console.log('🔍 Fetching UTXOs...');
        const { data: utxos } = await axios.get(`${MEMPOOL_API}/address/${fundingAddress}/utxo`);
        
        if (utxos.length === 0) {
            console.log('\n❌ No UTXOs found. If you just sent funds, wait for them to appear in the mempool.');
            return;
        }

        // Use the largest UTXO
        const utxo = utxos.sort((a, b) => b.value - a.value)[0];
        console.log(`✅ Using UTXO: ${utxo.txid}:${utxo.vout} (${utxo.value} sats)`);

        // 3. Create Commit Transaction
        const psbtCommit = new bitcoin.Psbt({ network });
        psbtCommit.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
                value: BigInt(utxo.value),
                script: bitcoin.address.toOutputScript(fundingAddress, network)
            },
            tapInternalKey: internalPubkey
        });

        const revealFee = 3000;
        const commitValue = 1000 + revealFee;

        psbtCommit.addOutput({
            address: commitAddress,
            value: BigInt(commitValue)
        });

        const commitFee = 1500;
        const changeValue = utxo.value - commitValue - commitFee;
        if (changeValue > 546) {
            psbtCommit.addOutput({
                address: fundingAddress,
                value: BigInt(changeValue)
            });
        }

        const tweakedChild = tweakSigner(child);
        psbtCommit.signInput(0, tweakedChild);
        psbtCommit.finalizeAllInputs();

        const commitTx = psbtCommit.extractTransaction();
        const commitTxHex = commitTx.toHex();
        const commitTxId = commitTx.getId();

        console.log(`\n📦 Commit Transaction created: ${commitTxId}`);

        // 4. Create Reveal Transaction
        const psbtReveal = new bitcoin.Psbt({ network });
        
        const tapLeafScript = {
            leafVersion: 0xc0,
            script: inscriptionScript,
            controlBlock: controlBlock
        };

        psbtReveal.addInput({
            hash: commitTxId,
            index: 0,
            witnessUtxo: {
                value: BigInt(commitValue),
                script: scriptTaproot.output
            },
            tapLeafScript: [tapLeafScript]
        });

        psbtReveal.addOutput({
            address: fundingAddress,
            value: BigInt(1000)
        });

        psbtReveal.signInput(0, child);
        
        const customFinalizer = (_inputIndex, input) => {
            const scriptSig = input.tapScriptSig?.[0];
            if (!scriptSig) throw new Error('Signature not found in PSBT input.');

            const witness = [
                scriptSig.signature,
                inscriptionScript,
                controlBlock,
            ];
            return {
                finalScriptWitness: witnessStackToScriptWitness(witness)
            };
        };

        psbtReveal.finalizeInput(0, customFinalizer);

        const revealTx = psbtReveal.extractTransaction();
        const revealTxHex = revealTx.toHex();
        const revealTxId = revealTx.getId();

        console.log(`📦 Reveal Transaction created: ${revealTxId}`);

        // 5. Broadcast
        console.log('\n📡 Broadcasting transactions...');
        
        try {
            await axios.post(`${MEMPOOL_API}/tx`, commitTxHex);
            console.log('✅ Commit TX broadcasted!');
            
            console.log('⏳ Waiting 2 seconds before broadcasting Reveal TX...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            await axios.post(`${MEMPOOL_API}/tx`, revealTxHex);
            console.log('✅ Reveal TX broadcasted!');
            
            console.log('\n🎉 Minting Successful!');
            console.log(`🔗 View Commit: https://mempool.space/testnet/tx/${commitTxId}`);
            console.log(`🔗 View Reveal: https://mempool.space/testnet/tx/${revealTxId}`);
            
        } catch (broadcastError) {
            console.error('\n❌ Broadcast Error:', broadcastError.response?.data || broadcastError.message);
        }

    } catch (error) {
        console.error('\n❌ Error:', error.message);
    }
}

mintBRC20().catch(console.error);
