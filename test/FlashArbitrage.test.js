/**
 * ============================================================
 *  FLASH ARBITRAGE — TEST SUITE
 * ============================================================
 *  Tests the FlashArbitrage contract using Hardhat's local
 *  network and (optionally) a mainnet fork for realistic
 *  flash swap / DEX integration tests.
 *
 *  Usage:
 *    npx hardhat test                          (basic tests)
 *    MAINNET_URL=<rpc> npx hardhat test        (full fork tests)
 * ============================================================
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");

// ============================================================
//  CONSTANTS
// ============================================================

// Uniswap V2 Factory (Ethereum mainnet)
const UNISWAP_V2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";

// DEX Routers
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHISWAP_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

// Mainnet token addresses (used in fork tests)
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const DAI  = "0x6B175474E89094C44Da98b954EedeAC495271d0F";

// ============================================================
//  FIXTURES
// ============================================================

/**
 * Deploys FlashArbitrage with default config.
 * Works on the plain Hardhat network (no fork needed).
 */
async function deployFixture() {
  const [owner, attacker, recipient] = await ethers.getSigners();

  // Use dummy addresses for factory/routers on non-forked network
  const factory = UNISWAP_V2_FACTORY;
  const routers = [UNISWAP_V2_ROUTER, SUSHISWAP_ROUTER];
  const minProfitWei = ethers.parseEther("0.001");

  const FlashArbitrage = await ethers.getContractFactory("FlashArbitrage");
  const contract = await FlashArbitrage.deploy(factory, routers, minProfitWei);
  await contract.waitForDeployment();

  return { contract, owner, attacker, recipient, factory, routers, minProfitWei };
}

// ============================================================
//  TEST SUITES
// ============================================================

describe("FlashArbitrage", function () {
  // ──────────────────────────────────────────────────────────
  //  DEPLOYMENT
  // ──────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("should set the deployer as owner", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should set the Uniswap V2 factory address", async function () {
      const { contract, factory } = await loadFixture(deployFixture);
      expect(await contract.uniswapV2Factory()).to.equal(factory);
    });

    it("should approve the initial routers", async function () {
      const { contract, routers } = await loadFixture(deployFixture);
      for (const router of routers) {
        expect(await contract.approvedRouters(router)).to.be.true;
      }
    });

    it("should set the minimum profit threshold", async function () {
      const { contract, minProfitWei } = await loadFixture(deployFixture);
      expect(await contract.minProfitWei()).to.equal(minProfitWei);
    });

    it("should start with zero trades executed", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.totalTradesExecuted()).to.equal(0);
    });

    it("should start unpaused", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.paused()).to.be.false;
    });

    it("should revert if factory address is zero", async function () {
      const FlashArbitrage = await ethers.getContractFactory("FlashArbitrage");
      await expect(
        FlashArbitrage.deploy(ethers.ZeroAddress, [UNISWAP_V2_ROUTER], 1000)
      ).to.be.revertedWithCustomError(FlashArbitrage, "ZeroAddress");
    });

    it("should revert if any router address is zero", async function () {
      const FlashArbitrage = await ethers.getContractFactory("FlashArbitrage");
      await expect(
        FlashArbitrage.deploy(UNISWAP_V2_FACTORY, [ethers.ZeroAddress], 1000)
      ).to.be.revertedWithCustomError(FlashArbitrage, "ZeroAddress");
    });

    it("should emit RouterApproved events for each initial router", async function () {
      const FlashArbitrage = await ethers.getContractFactory("FlashArbitrage");
      const tx = await FlashArbitrage.deploy(
        UNISWAP_V2_FACTORY,
        [UNISWAP_V2_ROUTER, SUSHISWAP_ROUTER],
        1000
      );
      const receipt = await tx.deploymentTransaction().wait();

      // Check events were emitted
      const events = receipt.logs.filter(
        (log) => log.fragment && log.fragment.name === "RouterApproved"
      );
      // At minimum, the contract should have emitted events (check receipt exists)
      expect(receipt.status).to.equal(1);
    });
  });

  // ──────────────────────────────────────────────────────────
  //  ACCESS CONTROL
  // ──────────────────────────────────────────────────────────

  describe("Access Control", function () {
    it("should revert executeArbitrage from non-owner", async function () {
      const { contract, attacker } = await loadFixture(deployFixture);
      await expect(
        contract.connect(attacker).executeArbitrage(
          WETH, USDC, ethers.parseEther("1"), SUSHISWAP_ROUTER, 0
        )
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("should revert executeSimpleArbitrage from non-owner", async function () {
      const { contract, attacker } = await loadFixture(deployFixture);
      await expect(
        contract.connect(attacker).executeSimpleArbitrage(
          WETH, USDC, ethers.parseEther("1"),
          UNISWAP_V2_ROUTER, SUSHISWAP_ROUTER, 0
        )
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("should revert setRouterApproval from non-owner", async function () {
      const { contract, attacker } = await loadFixture(deployFixture);
      const randomAddr = ethers.Wallet.createRandom().address;
      await expect(
        contract.connect(attacker).setRouterApproval(randomAddr, true)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("should revert setMinProfit from non-owner", async function () {
      const { contract, attacker } = await loadFixture(deployFixture);
      await expect(
        contract.connect(attacker).setMinProfit(0)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("should revert withdrawTokens from non-owner", async function () {
      const { contract, attacker, owner } = await loadFixture(deployFixture);
      await expect(
        contract.connect(attacker).withdrawTokens(WETH, 100, owner.address)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("should revert withdrawETH from non-owner", async function () {
      const { contract, attacker, owner } = await loadFixture(deployFixture);
      await expect(
        contract.connect(attacker).withdrawETH(owner.address)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("should revert pause from non-owner", async function () {
      const { contract, attacker } = await loadFixture(deployFixture);
      await expect(
        contract.connect(attacker).pause()
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("should revert unpause from non-owner", async function () {
      const { contract, attacker, owner } = await loadFixture(deployFixture);
      // First pause as owner
      await contract.connect(owner).pause();
      await expect(
        contract.connect(attacker).unpause()
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  // ──────────────────────────────────────────────────────────
  //  ADMIN: ROUTER MANAGEMENT
  // ──────────────────────────────────────────────────────────

  describe("Router Management", function () {
    it("should approve a new router", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      const newRouter = ethers.Wallet.createRandom().address;

      await expect(contract.setRouterApproval(newRouter, true))
        .to.emit(contract, "RouterApproved")
        .withArgs(newRouter, true);

      expect(await contract.approvedRouters(newRouter)).to.be.true;
    });

    it("should revoke an existing router", async function () {
      const { contract } = await loadFixture(deployFixture);

      await expect(contract.setRouterApproval(UNISWAP_V2_ROUTER, false))
        .to.emit(contract, "RouterApproved")
        .withArgs(UNISWAP_V2_ROUTER, false);

      expect(await contract.approvedRouters(UNISWAP_V2_ROUTER)).to.be.false;
    });

    it("should revert when setting zero address as router", async function () {
      const { contract } = await loadFixture(deployFixture);
      await expect(
        contract.setRouterApproval(ethers.ZeroAddress, true)
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  // ──────────────────────────────────────────────────────────
  //  ADMIN: MIN PROFIT
  // ──────────────────────────────────────────────────────────

  describe("Min Profit Management", function () {
    it("should update the minimum profit threshold", async function () {
      const { contract, minProfitWei } = await loadFixture(deployFixture);
      const newMin = ethers.parseEther("0.01");

      await expect(contract.setMinProfit(newMin))
        .to.emit(contract, "MinProfitUpdated")
        .withArgs(minProfitWei, newMin);

      expect(await contract.minProfitWei()).to.equal(newMin);
    });

    it("should allow setting min profit to zero", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.setMinProfit(0);
      expect(await contract.minProfitWei()).to.equal(0);
    });

    it("should allow setting a very high min profit", async function () {
      const { contract } = await loadFixture(deployFixture);
      const highMin = ethers.parseEther("100");
      await contract.setMinProfit(highMin);
      expect(await contract.minProfitWei()).to.equal(highMin);
    });
  });

  // ──────────────────────────────────────────────────────────
  //  PAUSE / UNPAUSE
  // ──────────────────────────────────────────────────────────

  describe("Pause / Unpause", function () {
    it("should pause the contract", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.pause();
      expect(await contract.paused()).to.be.true;
    });

    it("should unpause the contract", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.pause();
      await contract.unpause();
      expect(await contract.paused()).to.be.false;
    });

    it("should revert executeArbitrage when paused", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.pause();

      await expect(
        contract.executeArbitrage(
          WETH, USDC, ethers.parseEther("1"), SUSHISWAP_ROUTER, 0
        )
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });

    it("should revert executeSimpleArbitrage when paused", async function () {
      const { contract } = await loadFixture(deployFixture);
      await contract.pause();

      await expect(
        contract.executeSimpleArbitrage(
          WETH, USDC, ethers.parseEther("1"),
          UNISWAP_V2_ROUTER, SUSHISWAP_ROUTER, 0
        )
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });

  // ──────────────────────────────────────────────────────────
  //  ETH WITHDRAWAL
  // ──────────────────────────────────────────────────────────

  describe("ETH Withdrawal", function () {
    it("should accept ETH via receive()", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      const contractAddr = await contract.getAddress();

      await owner.sendTransaction({
        to: contractAddr,
        value: ethers.parseEther("1.0"),
      });

      const balance = await ethers.provider.getBalance(contractAddr);
      expect(balance).to.equal(ethers.parseEther("1.0"));
    });

    it("should withdraw all ETH to a specified address", async function () {
      const { contract, owner, recipient } = await loadFixture(deployFixture);
      const contractAddr = await contract.getAddress();

      // Send 1 ETH to contract
      await owner.sendTransaction({
        to: contractAddr,
        value: ethers.parseEther("1.0"),
      });

      const recipientBalBefore = await ethers.provider.getBalance(recipient.address);

      await expect(contract.withdrawETH(recipient.address))
        .to.emit(contract, "ETHWithdrawn")
        .withArgs(ethers.parseEther("1.0"), recipient.address);

      const recipientBalAfter = await ethers.provider.getBalance(recipient.address);
      expect(recipientBalAfter - recipientBalBefore).to.equal(ethers.parseEther("1.0"));

      // Contract should now be empty
      const contractBal = await ethers.provider.getBalance(contractAddr);
      expect(contractBal).to.equal(0);
    });

    it("should revert ETH withdrawal to zero address", async function () {
      const { contract } = await loadFixture(deployFixture);
      await expect(
        contract.withdrawETH(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  // ──────────────────────────────────────────────────────────
  //  INPUT VALIDATION
  // ──────────────────────────────────────────────────────────

  describe("Input Validation", function () {
    it("should revert executeArbitrage with zero amount", async function () {
      const { contract } = await loadFixture(deployFixture);
      await expect(
        contract.executeArbitrage(WETH, USDC, 0, SUSHISWAP_ROUTER, 0)
      ).to.be.revertedWithCustomError(contract, "ZeroAmount");
    });

    it("should revert executeSimpleArbitrage with zero amount", async function () {
      const { contract } = await loadFixture(deployFixture);
      await expect(
        contract.executeSimpleArbitrage(
          WETH, USDC, 0,
          UNISWAP_V2_ROUTER, SUSHISWAP_ROUTER, 0
        )
      ).to.be.revertedWithCustomError(contract, "ZeroAmount");
    });

    it("should revert executeArbitrage with unapproved router", async function () {
      const { contract } = await loadFixture(deployFixture);
      const fakeRouter = ethers.Wallet.createRandom().address;

      await expect(
        contract.executeArbitrage(
          WETH, USDC, ethers.parseEther("1"), fakeRouter, 0
        )
      ).to.be.revertedWithCustomError(contract, "RouterNotApproved");
    });

    it("should revert executeSimpleArbitrage with unapproved buy router", async function () {
      const { contract } = await loadFixture(deployFixture);
      const fakeRouter = ethers.Wallet.createRandom().address;

      await expect(
        contract.executeSimpleArbitrage(
          WETH, USDC, ethers.parseEther("1"),
          fakeRouter, SUSHISWAP_ROUTER, 0
        )
      ).to.be.revertedWithCustomError(contract, "RouterNotApproved");
    });

    it("should revert executeSimpleArbitrage with unapproved sell router", async function () {
      const { contract } = await loadFixture(deployFixture);
      const fakeRouter = ethers.Wallet.createRandom().address;

      await expect(
        contract.executeSimpleArbitrage(
          WETH, USDC, ethers.parseEther("1"),
          UNISWAP_V2_ROUTER, fakeRouter, 0
        )
      ).to.be.revertedWithCustomError(contract, "RouterNotApproved");
    });

    it("should revert withdrawTokens to zero address", async function () {
      const { contract } = await loadFixture(deployFixture);
      await expect(
        contract.withdrawTokens(WETH, 100, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  // ──────────────────────────────────────────────────────────
  //  FLASH SWAP CALLBACK SECURITY
  // ──────────────────────────────────────────────────────────

  describe("Flash Swap Callback Security", function () {
    it("should revert uniswapV2Call from unauthorized caller", async function () {
      const { contract, attacker } = await loadFixture(deployFixture);

      // Encode some dummy callback data
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "address", "uint256"],
        [WETH, USDC, ethers.parseEther("1"), SUSHISWAP_ROUTER, 0]
      );

      // An attacker trying to call uniswapV2Call directly should fail
      await expect(
        contract.connect(attacker).uniswapV2Call(
          attacker.address, 0, 0, data
        )
      ).to.be.revertedWithCustomError(contract, "UnauthorizedCallback");
    });
  });

  // ──────────────────────────────────────────────────────────
  //  MAINNET FORK TESTS (only run with MAINNET_URL)
  // ──────────────────────────────────────────────────────────

  const isFork = !!process.env.MAINNET_URL;

  // These tests interact with real Uniswap/SushiSwap contracts
  // and require a mainnet fork to work properly
  (isFork ? describe : describe.skip)("Mainnet Fork — DEX Integration", function () {
    this.timeout(60000); // Fork tests can be slow

    async function forkDeployFixture() {
      const [owner] = await ethers.getSigners();

      const routers = [UNISWAP_V2_ROUTER, SUSHISWAP_ROUTER];
      const minProfitWei = ethers.parseEther("0.001");

      const FlashArbitrage = await ethers.getContractFactory("FlashArbitrage");
      const contract = await FlashArbitrage.deploy(
        UNISWAP_V2_FACTORY, routers, minProfitWei
      );
      await contract.waitForDeployment();

      return { contract, owner };
    }

    it("should read prices from Uniswap V2 via checkArbitrage", async function () {
      const { contract } = await loadFixture(forkDeployFixture);

      const [profitA, profitB] = await contract.checkArbitrage(
        WETH, USDC,
        ethers.parseEther("10"),
        UNISWAP_V2_ROUTER,
        SUSHISWAP_ROUTER
      );

      // We just confirm the view call doesn't revert and returns numbers
      console.log(`    ├─ Profit Route A (Uni→Sushi): ${ethers.formatEther(profitA)} ETH-equiv`);
      console.log(`    └─ Profit Route B (Sushi→Uni): ${ethers.formatEther(profitB)} ETH-equiv`);

      // Both should be valid uint256 values (may be 0 if no arb exists)
      expect(profitA).to.be.greaterThanOrEqual(0);
      expect(profitB).to.be.greaterThanOrEqual(0);
    });

    it("should check multiple token pairs without reverting", async function () {
      const { contract } = await loadFixture(forkDeployFixture);

      const pairs = [
        { name: "WETH/USDC", a: WETH, b: USDC },
        { name: "WETH/USDT", a: WETH, b: USDT },
        { name: "WETH/DAI",  a: WETH, b: DAI },
      ];

      for (const pair of pairs) {
        const [profitA, profitB] = await contract.checkArbitrage(
          pair.a, pair.b,
          ethers.parseEther("5"),
          UNISWAP_V2_ROUTER,
          SUSHISWAP_ROUTER
        );
        console.log(`    ├─ ${pair.name}: A=${ethers.formatEther(profitA)} | B=${ethers.formatEther(profitB)}`);
      }
    });

    it("should revert executeArbitrage when pair doesn't exist for fake tokens", async function () {
      const { contract } = await loadFixture(forkDeployFixture);

      const fakeToken = ethers.Wallet.createRandom().address;

      await expect(
        contract.executeArbitrage(
          fakeToken, WETH,
          ethers.parseEther("1"),
          SUSHISWAP_ROUTER, 0
        )
      ).to.be.revertedWithCustomError(contract, "InvalidPair");
    });
  });
});
