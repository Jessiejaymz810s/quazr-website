const hre = require("hardhat");

async function main() {
  const initialSupply = 1000000; // 1 million tokens
  console.log("Deploying QuazrToken...");

  const QuazrToken = await hre.ethers.getContractFactory("QuazrToken");
  const quazr = await QuazrToken.deploy(initialSupply);

  await quazr.waitForDeployment();

  console.log(`QuazrToken deployed to: ${await quazr.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
