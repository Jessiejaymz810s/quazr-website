const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  console.log("Estimating deployment cost for FlashArbitrage...");

  // Compile if not already
  await hre.run("compile");

  // Get contract factory
  const FlashArbitrage = await ethers.getContractFactory("FlashArbitrage");

  // Constructor args
  const uniswapV2Factory = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"; // Mainnet Uniswap V2 Factory
  const routers = [
    "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2 Router
    "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"  // Sushiswap Router
  ];
  const minProfit = ethers.parseEther("0.005");

  // Get the deployment transaction
  const deployTx = await FlashArbitrage.getDeployTransaction(uniswapV2Factory, routers, minProfit);

  // Estimate the gas required
  const gasEstimate = await ethers.provider.estimateGas(deployTx);
  console.log(`\nGas Estimate: ${gasEstimate.toString()} units`);

  // Connect to mainnet to get real current gas prices
  const mainnetProvider = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com");
  const feeData = await mainnetProvider.getFeeData();
  
  const gasPrice = feeData.gasPrice;
  if (!gasPrice) {
      console.log("Could not fetch mainnet gas price.");
      return;
  }
  
  console.log(`Current Mainnet Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);

  // Calculate total cost in wei, then convert to ETH
  const totalCostWei = gasEstimate * gasPrice;
  const totalCostEth = ethers.formatEther(totalCostWei);

  console.log(`\n======================================`);
  console.log(`Estimated Deployment Cost: ${Number(totalCostEth).toFixed(5)} ETH`);
  console.log(`======================================`);
  
  // Try to fetch current ETH price for USD estimate
  try {
      const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
      const data = await response.json();
      if (data && data.ethereum && data.ethereum.usd) {
          const ethPrice = data.ethereum.usd;
          const costUsd = Number(totalCostEth) * ethPrice;
          console.log(`Current ETH Price: $${ethPrice}`);
          console.log(`Estimated Cost in USD: ~$${costUsd.toFixed(2)}`);
      }
  } catch (error) {
      // Ignore if fetch fails
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
