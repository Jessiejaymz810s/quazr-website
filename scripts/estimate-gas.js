const hre = require("hardhat");

async function main() {
  const initialSupply = 1000000; // 1 million tokens
  console.log("Estimating gas for deploying QuazrToken on Ethereum Mainnet...");

  const QuazrToken = await hre.ethers.getContractFactory("QuazrToken");
  
  // Estimate gas limit required for deployment
  const deployTransaction = await QuazrToken.getDeployTransaction(initialSupply);
  const estimatedGasLimit = await hre.ethers.provider.estimateGas(deployTransaction);
  
  console.log(`\nEstimated Gas Limit: ${estimatedGasLimit.toString()} units`);

  // Get current gas price
  const feeData = await hre.ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice;
  
  if (!gasPrice) {
      console.log("Error: Could not retrieve current gas price.");
      return;
  }

  const gasPriceGwei = hre.ethers.formatUnits(gasPrice, "gwei");
  console.log(`Current Gas Price:   ${parseFloat(gasPriceGwei).toFixed(2)} Gwei`);

  // Calculate estimated total cost in ETH
  const estimatedCostWei = estimatedGasLimit * gasPrice;
  const estimatedCostEth = hre.ethers.formatEther(estimatedCostWei);

  console.log(`\n==============================================`);
  console.log(`Estimated Deployment Cost: ~${estimatedCostEth} ETH`);
  console.log(`==============================================`);
  
  console.log(`\nNOTE: You should fund your wallet with at least 20-30% more than this estimate`);
  console.log(`to account for gas price fluctuations during actual deployment.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
