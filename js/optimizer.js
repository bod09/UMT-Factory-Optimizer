// UMT Factory Optimizer - Thin wrapper around PathFinder
// Maintains the same public API for app.js compatibility

class FactoryOptimizer {
  constructor() {
    this.pathFinder = new PathFinder();
  }

  configure(config) {
    this.pathFinder.configure(config);
    this.budget = config.budget;
    this.hasDoubleSeller = config.hasDoubleSeller;
    this.prestigeItems = config.prestigeItems;
  }

  getEffectiveOreValue(ore) {
    return this.pathFinder.getEffectiveOreValue(ore);
  }

  processBar(oreVal) {
    return this.pathFinder.processBar(oreVal);
  }

  nanoBonus() {
    return this.pathFinder.nanoBonus();
  }

  buildCasing(barVal) {
    return this.pathFinder.buildCasing(barVal);
  }

  getBestChain(ore, budget) {
    const oreValue = this.getEffectiveOreValue(ore);
    const chains = this.pathFinder.getAllChains(oreValue);

    // Filter by budget and add direct sell
    const results = [];

    // Direct sell
    const tags = [];
    if (this.prestigeItems.oreUpgrader && oreValue !== ore.value) tags.push("Upgraded");
    const directSuffix = tags.length ? " [" + tags.join(", ") + "]" : "";
    let directVal = this.pathFinder.applySeller(oreValue);
    results.push({ chain: "Direct Sell" + directSuffix, value: directVal, cost: 0, perOre: directVal, oresNeeded: 1 });

    // Add discovered chains
    for (const c of chains) {
      if (c.cost <= budget) {
        results.push(c);
      }
    }

    results.sort((a, b) => b.perOre - a.perOre);
    return results;
  }

  getRecommendedBuild(budget) {
    const stage = PROGRESSION_STAGES.find(s => s.budgetMax && budget <= s.budgetMax) || PROGRESSION_STAGES[PROGRESSION_STAGES.length - 1];
    return { stage };
  }

  getFreshPrestigePath() {
    return [
      { phase: "Phase 1: Bootstrap", budget: "$0 - $500", time: "~5 min", actions: [
        "Mine Tin/Iron/Lead at surface level",
        "Buy Copper Pickaxe ($50)",
        "Buy Ore Cleaner ($80) + Polisher ($250) - adds $20 per ore",
        "Buy Small Backpack ($100)",
        "Sell cleaned & polished ores directly",
      ]},
      { phase: "Phase 2: Smelting Setup", budget: "$500 - $10K", time: "~10 min", actions: [
        "Buy Ore Smelter ($380) - 1.2x on ores",
        "Buy Iron Pickaxe ($500)",
        "Buy Coiler ($1,750) + Bolt Machine ($2,800)",
        "Buy Plate Stamper ($3,000) + Crusher ($1,750)",
        "Buy Kiln ($4,750) for glass from dust",
        "Buy Steel Pickaxe ($5,000)",
        "Buy Minidumper ($5,000)",
        "Route stone: Crusher → Kiln → sell glass ($30)",
      ]},
      { phase: "Phase 3: Value Chains", budget: "$10K - $100K", time: "~15 min", actions: [
        "Buy Frame Maker ($10K) - 1.25x",
        "Buy Circuit Maker ($20K) - 2x",
        "Buy Platinum Pickaxe ($25K)",
        "Buy Casing Machine ($50K) - 1.3x",
        "Buy Tempering Forge ($50K) - 2x (HUGE)",
        "Temper bars BEFORE combining machines",
      ]},
      { phase: "Phase 4: Advanced", budget: "$100K - $1M", time: "~20 min", actions: [
        "Buy Alloy Furnace ($100K) for Superconductor chain",
        "Buy Output Belt 2 ($100K)",
        "Buy Titanium Pickaxe ($100K)",
        "Buy Super Crawler ($200K) - 180 capacity",
        "Buy Optics Machine ($300K) for Laser chain",
        "Build ceramic casing: Dust → Clay → Ceramic ($150)",
      ]},
      { phase: "Phase 5: Mega Factories", budget: "$1M - $5M", time: "~25 min", actions: [
        "Buy Engine Factory ($1M) - 2.5x",
        "Buy Superconductor Constructor ($1M) - 3x",
        "Buy Infernum Pickaxe ($1M)",
        "Buy Output Belt 3 ($1M)",
        "Buy QA Machine ($2M) - +20% on finished products",
        "Buy Amulet Maker ($2M) - 2x jewelcrafting",
        "Buy Tablet Factory ($2.5M) - 3x",
        "Buy Laser Maker ($3.5M) - 2.75x",
        "Buy Power Core Assembler ($4.5M) - 2.5x",
      ]},
      { phase: "Phase 6: Push to Prestige", budget: "$5M - $20M", time: "~30 min", actions: [
        "Maximize throughput with parallel lines + all 4 output belts",
        "Use transmuter side path for 1.61x bonus on bars",
        "Place duplicators on best intermediates per chain",
        "Electronic Tuner on circuits before Tablet (+$150 effective)",
        "Focus on highest per-ore chains from optimizer",
        "Exa-Drill ($8M) for deep mining automation",
        "Reach $20M total earned to prestige!",
      ]},
    ];
  }
}
