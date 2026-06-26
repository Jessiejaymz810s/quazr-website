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

function witnessStackToScriptWitness(witness) {
    let buffer = Buffer.allocUnsafe(0);
    function writeVarInt(i) {
        if (i < 0xfd) {
            buffer = Buffer.concat([buffer, Buffer.from([i])]);
        } else if (i <= 0xffff) {
            const b = Buffer.allocUnsafe(3);
            b[0] = 0xfd; b.writeUInt16LE(i, 1);
            buffer = Buffer.concat([buffer, b]);
        } else {
            const b = Buffer.allocUnsafe(5);
            b[0] = 0xfe; b.writeUInt32LE(i, 1);
            buffer = Buffer.concat([buffer, b]);
        }
    }
    writeVarInt(witness.length);
    witness.forEach((item) => {
        writeVarInt(item.length);
        buffer = Buffer.concat([buffer, item]);
    });
    return buffer;
}

async function deployBRC20() {
    const mnemonic = process.env.BTC_MNEMONIC;
    const ticker = 'quazr';
    const maxSupply = '21000000';
    const limitPerMint = '1000';

    console.log(`\n🚀 Deploying BRC-20 Ticker: ${ticker}`);

    const seed = await bip39.mnemonicToSeed(mnemonic);
    const root = bip32.fromSeed(seed, network);
    const child = root.derivePath("m/86'/0'/0'/0/0");
    const internalPubkey = toXOnly(child.publicKey);

    const brc20Data = JSON.stringify({
        p: "brc-20",
        op: "deploy",
        tick: ticker,
        max: maxSupply,
        lim: limitPerMint
    });
    
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

    const scriptTree = { output: inscriptionScript };
    const scriptTaproot = bitcoin.payments.p2tr({ internalPubkey, scriptTree, network });
    const { witness: controlBlockWitness } = bitcoin.payments.p2tr({
        internalPubkey,
        scriptTree,
        redeem: { output: inscriptionScript, redeemVersion: 0xc0 },
        network
    });
    const controlBlock = controlBlockWitness[controlBlockWitness.length - 1];

    const commitAddress = scriptTaproot.address;
    const fundingAddress = process.env.BTC_TAPROOT_ADDRESS;

    try {
        const { data: utxos } = await axios.get(`${MEMPOOL_API}/address/${fundingAddress}/utxo`);
        const utxo = utxos.sort((a, b) => b.value - a.value)[0];
        
        const psbtCommit = new bitcoin.Psbt({ network });
        psbtCommit.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: { value: BigInt(utxo.value), script: bitcoin.address.toOutputScript(fundingAddress, network) },
            tapInternalKey: internalPubkey
        });

        const revealFee = 3500;
        const commitValue = 1000 + revealFee;
        psbtCommit.addOutput({ address: commitAddress, value: BigInt(commitValue) });

        const commitFee = 2000;
        const changeValue = utxo.value - commitValue - commitFee;
        if (changeValue > 546) psbtCommit.addOutput({ address: fundingAddress, value: BigInt(changeValue) });

        psbtCommit.signInput(0, tweakSigner(child));
        psbtCommit.finalizeAllInputs();
        const commitTx = psbtCommit.extractTransaction();

        const psbtReveal = new bitcoin.Psbt({ network });
        psbtReveal.addInput({
            hash: commitTx.getId(),
            index: 0,
            witnessUtxo: { value: BigInt(commitValue), script: scriptTaproot.output },
            tapLeafScript: [{ leafVersion: 0xc0, script: inscriptionScript, controlBlock }]
        });
        psbtReveal.addOutput({ address: fundingAddress, value: BigInt(1000) });
        psbtReveal.signInput(0, child);
        psbtReveal.finalizeInput(0, (_idx, input) => ({
            finalScriptWitness: witnessStackToScriptWitness([input.tapScriptSig[0].signature, inscriptionScript, controlBlock])
        }));
        const revealTx = psbtReveal.extractTransaction();

        console.log('📡 Broadcasting Deployment...');
        await axios.post(`${MEMPOOL_API}/tx`, commitTx.toHex());
        await new Promise(r => setTimeout(r, 2000));
        await axios.post(`${MEMPOOL_API}/tx`, revealTx.toHex());

        console.log(`\n🎉 Deployment Successful!`);
        console.log(`🔗 Commit: https://mempool.space/testnet/tx/${commitTx.getId()}`);
        console.log(`🔗 Reveal: https://mempool.space/testnet/tx/${revealTx.getId()}`);
    } catch (e) {
        console.error('❌ Error:', e.response?.data || e.message);
    }
}
deployBRC20();
