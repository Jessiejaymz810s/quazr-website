const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
require('dotenv').config();

// --- Configuration ---
const CHAIN_ID = 1; // Ethereum Mainnet
const RPC_URL = process.env.MAINNET_RPC_URL || 'https://eth.drpc.org'; // Fallback to public RPC
const FLASHBOTS_RELAY = 'https://relay.flashbots.net';

const SAFE_PK = process.env.PRIVATE_KEY;
const COMPROMISED_PK = process.env.COMPROMISED_PRIVATE_KEY;

if (!SAFE_PK || !COMPROMISED_PK) {
    console.error("❌ PRIVATE_KEY and COMPROMISED_PRIVATE_KEY must be set in .env");
    process.exit(1);
}

const APPROVALS_TO_REVOKE = [
    { name: "USDD_2 (1inch)", token: "0x0C10bF8FcB7Bf5412187A595ab97a3609160b5c6", spender: "0x1111111254EEB25477B68fb85Ed929f73A960582" },
    { name: "USDD_2 (Uniswap)", token: "0x0C10bF8FcB7Bf5412187A595ab97a3609160b5c6", spender: "0x9277a463A508F45115FdEaf22FfeDA1B16352433" },
    { name: "USDT (0x)", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", spender: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF" },
    { name: "MATIC (Hop)", token: "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0", spender: "0x4C9faD010D8be90Aba505c85eacc483dFf9b8Fa9" },
    { name: "DAI (Polygon Bridge)", token: "0x6B175474E89094C44Da98b954EedeAC495271d0F", spender: "0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf" },
    { name: "DAI (Uniswap)", token: "0x6B175474E89094C44Da98b954EedeAC495271d0F", spender: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" },
    { name: "DAPP (MetaMask)", token: "0x5D0fa08AEb173AdE44B0Cf7F31d506D8E04f0ac8", spender: "0x881D40237659C251811CEC9c364ef91dC08D300C" },
    { name: "DAPP (Polygon Bridge)", token: "0x5D0fa08AEb173AdE44B0Cf7F31d506D8E04f0ac8", spender: "0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf" },
    { name: "Che (Polygon Bridge)", token: "0x25a1DE1C3eE658FE034B8914a1D8d34110423AF8", spender: "0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf" },
    { name: "USDC (0xe66B...)", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", spender: "0xe66B31678d6C16E9ebf358268a790B763C133750" },
    { name: "USDC (0x617D...)", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", spender: "0x617Dee16B86534a5d792A4d7A62FB491B544111E" },
    { name: "USDC (MetaMask)", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", spender: "0x881D40237659C251811CEC9c364ef91dC08D300C" },
    { name: "USDC (1inch)", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", spender: "0x11111112542D85B3EF69AE05771c2dCCff4fAa26" },
    { name: "BUSD (MetaMask)", token: "0x4Fabb145d64652a948d72533023f6E7A623C7C53", spender: "0x881D40237659C251811CEC9c364ef91dC08D300C" },
];

const ERC20_ABI = ["function approve(address spender, uint256 amount) public returns (bool)"];

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const authSigner = ethers.Wallet.createRandom(); // Flashbots auth signer

    const safeWallet = new ethers.Wallet(SAFE_PK, provider);
    const compWallet = new ethers.Wallet(COMPROMISED_PK, provider);

    console.log(`📍 Safe Wallet: ${safeWallet.address}`);
    console.log(`📍 Compromised Wallet: ${compWallet.address}`);

    const flashbotsProvider = await FlashbotsBundleProvider.create(
        provider,
        authSigner,
        FLASHBOTS_RELAY
    );

    const feeData = await provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas * 2n; // 2x to ensure inclusion
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas * 2n;

    console.log("🛠️ Building revoke transactions...");
    const transactions = [];
    let nonce = await provider.getTransactionCount(compWallet.address);

    for (const approval of APPROVALS_TO_REVOKE) {
        const contract = new ethers.Contract(approval.token, ERC20_ABI, compWallet);
        const txData = await contract.approve.populateTransaction(approval.spender, 0);
        
        transactions.push({
            signer: compWallet,
            transaction: {
                ...txData,
                chainId: CHAIN_ID,
                type: 2,
                maxFeePerGas,
                maxPriorityFeePerGas,
                gasLimit: 60000, // Safe limit for approve
                nonce: nonce++,
            }
        });
        console.log(`   - Queued revoke for ${approval.name}`);
    }

    // Estimate total gas cost for revokes
    const totalGasLimit = BigInt(transactions.length) * 60000n;
    const gasFundingAmount = totalGasLimit * maxFeePerGas;

    console.log(`💰 Estimated Gas Funding: ${ethers.formatEther(gasFundingAmount)} ETH`);

    // Add gas funding transaction as the FIRST transaction in the bundle
    const fundingTx = {
        signer: safeWallet,
        transaction: {
            to: compWallet.address,
            value: gasFundingAmount,
            chainId: CHAIN_ID,
            type: 2,
            maxFeePerGas,
            maxPriorityFeePerGas,
            gasLimit: 21000,
            nonce: await provider.getTransactionCount(safeWallet.address),
        }
    };

    const bundle = [fundingTx, ...transactions];

    console.log("🧪 Simulating bundle...");
    const blockNumber = await provider.getBlockNumber();
    const simulation = await flashbotsProvider.simulate(bundle, blockNumber + 1);

    if ("error" in simulation) {
        console.error(`❌ Simulation Error: ${simulation.error.message}`);
        process.exit(1);
    }

    console.log("✅ Simulation successful! Sending bundle...");
    
    // Send for the next 10 blocks
    for (let i = 1; i <= 10; i++) {
        const targetBlock = blockNumber + i;
        const bundleSubmission = await flashbotsProvider.sendBundle(bundle, targetBlock);
        console.log(`🚀 Bundle submitted for block ${targetBlock}`);
    }

    console.log("\n⏳ Monitoring for inclusion...");
    // In a real scenario, you'd wait for the bundle to be included.
}

main().catch(console.error);
