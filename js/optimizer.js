// UMT Factory Optimizer - Core Logic

class FactoryOptimizer {
  constructor() {
    this.prestigeLevel = 0;
    this.medals = 0;
    this.budget = 1000000;
    this.hasDoubleSeller = false;
    this.prestigeUpgrades = {};
  }

  configure({ prestigeLevel = 0, budget = 1000000, hasDoubleSeller = false, prestigeUpgrades = {} }) {
    this.prestigeLevel = prestigeLevel;
    this.medals = prestigeLevel; // 1 medal per prestige
    this.budget = budget;
    this.hasDoubleSeller = hasDoubleSeller;
    this.prestigeUpgrades = prestigeUpgrades;
  }

  // Calculate value of an ore through a specific processing chain
  calculateOreValue(ore, steps) {
    let value = ore.value;
    let itemType = "ore";
    const tags = new Set();

    for (const stepId of steps) {
      const machine = MACHINES[stepId];
      if (!machine) continue;

      // Check tag restrictions
      if (machine.tag && tags.has(machine.tag)) continue;
      if (machine.tag) tags.add(machine.tag);

      switch (machine.effect) {
        case "flat":
          value += machine.value;
          break;
        case "percent":
          value *= (1 + machine.value);
          break;
        case "multiply":
          value *= machine.value;
          if (machine.output) itemType = machine.output;
          break;
        case "set":
          value = machine.value;
          if (machine.output) itemType = machine.output;
          break;
      }
    }

    if (this.hasDoubleSeller) value *= 2;
    return value;
  }

  // Calculate the full value chain for an ore going through various paths
  calculateChainValue(ore, chainId) {
    const chain = PROCESSING_CHAINS[chainId];
    if (!chain) return ore.value;

    // Check medal requirements
    if (chain.medals && this.medals < chain.medals) return null;

    if (chain.calcValue) {
      let val = chain.calcValue(ore.value);
      if (this.hasDoubleSeller) val *= 2;
      return val;
    }

    return this.calculateOreValue(ore, chain.steps);
  }

  // Comprehensive value calculation for complex multi-input chains
  calculateEngineChainValue(oreValue) {
    // Ore -> Clean (+$10) -> Polish (+$10) -> Infuse (1.25x if prestige) -> Smelt (1.2x) -> Temper (2x)
    let baseVal = oreValue;
    baseVal += 10; // clean
    baseVal += 10; // polish
    if (this.medals >= 3) baseVal *= 1.25; // philosopher's stone
    let barVal = baseVal * 1.20; // smelt
    let temperedBarVal = barVal * 2.00; // temper

    // For engine, we need 3 ores split into different paths:
    // Ore 1 -> bar -> temper -> plate -> mech parts
    let plateVal = temperedBarVal + 20; // plate stamper
    let mechPartsVal = plateVal + 30; // mech parts

    // Ore 2 -> bar -> temper -> plate -> pipe
    let pipeVal = plateVal + 20; // pipe maker

    // Ore 3 -> bar -> temper -> bolts (for frame + casing)
    let boltsVal = temperedBarVal + 5;

    // Ore 4 -> bar -> temper (for frame)
    let frameVal = (temperedBarVal + boltsVal) * 1.25; // frame maker

    // More bolts + plate for casing
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30; // casing machine

    // Engine = mech parts + pipe + casing
    let engineVal = (mechPartsVal + pipeVal + casingVal) * 2.50;

    // QA if available
    if (this.budget >= 2000000) {
      engineVal *= 1.20;
    }

    if (this.hasDoubleSeller) engineVal *= 2;
    return { engineVal, oresNeeded: 5 };
  }

  // Calculate tablet chain value
  calculateTabletChainValue(oreValue) {
    let baseVal = oreValue + 10 + 10; // clean + polish
    if (this.medals >= 3) baseVal *= 1.25;
    let barVal = baseVal * 1.20 * 2.00; // smelt + temper

    // Casing path (needs 4+ ores)
    let boltsVal = barVal + 5;
    let plateVal = barVal + 20;
    let frameVal = (barVal + boltsVal) * 1.25;
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30;

    // Glass from stone byproduct -> dust -> kiln
    let glassVal = 30;

    // Coil for circuit
    let coilVal = barVal + 20;

    // Circuit = glass + coil (2x)
    let circuitVal = (glassVal + coilVal) * 2.00;

    // Tablet = casing + glass + circuit (3x)
    let tabletVal = (casingVal + glassVal + circuitVal) * 3.00;

    if (this.budget >= 2000000) tabletVal *= 1.20; // QA
    if (this.hasDoubleSeller) tabletVal *= 2;
    return { tabletVal, oresNeeded: 5 };
  }

  // Calculate superconductor chain value
  calculateSuperconductorValue(oreValue) {
    let baseVal = oreValue + 10 + 10;
    if (this.medals >= 3) baseVal *= 1.25;
    let barVal = baseVal * 1.20 * 2.00;

    // Alloy bar = 2 tempered bars (1.2x combined)
    let alloyVal = (barVal + barVal) * 1.20;

    // Ceramic casing from stone byproduct
    // stone -> crush -> dust -> clay mixer (2 dust = $50) -> ceramic furnace ($150)
    let ceramicVal = 150;

    // Superconductor = alloy + ceramic (3x)
    let superVal = (alloyVal + ceramicVal) * 3.00;

    if (this.hasDoubleSeller) superVal *= 2;
    return { superVal, oresNeeded: 2 };
  }

  // Calculate power core chain value
  calculatePowerCoreValue(oreValue) {
    let baseVal = oreValue + 10 + 10;
    if (this.medals >= 3) baseVal *= 1.25;
    let barVal = baseVal * 1.20 * 2.00;

    // Casing
    let boltsVal = barVal + 5;
    let plateVal = barVal + 20;
    let frameVal = (barVal + boltsVal) * 1.25;
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30;

    // Superconductor
    let alloyVal = (barVal + barVal) * 1.20;
    let ceramicVal = 150;
    let superVal = (alloyVal + ceramicVal) * 3.00;

    // Electromagnet = coil + casing (1.5x)
    let coilVal = barVal + 20;
    let casing2Val = (frameVal + boltsVal + plateVal) * 1.30;
    let electroVal = (coilVal + casing2Val) * 1.50;

    // Power Core = casing + superconductor + electromagnet (2.5x)
    let pcVal = (casingVal + superVal + electroVal) * 2.50;

    if (this.budget >= 2000000) pcVal *= 1.20; // QA
    if (this.hasDoubleSeller) pcVal *= 2;
    return { pcVal, oresNeeded: 10 };
  }

  // Get best chain for a given ore and budget
  getBestChain(ore, budget) {
    const results = [];

    // Direct sell
    let directVal = ore.value;
    if (this.hasDoubleSeller) directVal *= 2;
    results.push({ chain: "Direct Sell", value: directVal, cost: 0, perOre: directVal, oresNeeded: 1 });

    // Basic processing
    if (budget >= 710) {
      let val = this.calculateOreValue(ore, ["ore_cleaner", "polisher", "ore_smelter"]);
      results.push({ chain: "Clean + Polish + Smelt", value: val, cost: 710, perOre: val, oresNeeded: 1 });
    }

    // With tempering
    if (budget >= 50710) {
      let val = this.calculateOreValue(ore, ["ore_cleaner", "polisher", "ore_smelter", "tempering_forge"]);
      results.push({ chain: "Clean + Polish + Smelt + Temper", value: val, cost: 50710, perOre: val, oresNeeded: 1 });
    }

    // With philosopher's stone
    if (budget >= 50710 && this.medals >= 3) {
      let val = this.calculateOreValue(ore, ["ore_cleaner", "polisher", "philosophers_stone", "ore_smelter", "tempering_forge"]);
      results.push({ chain: "Full Pre-Processing (Infuse + Temper)", value: val, cost: 50710, perOre: val, oresNeeded: 1, medals: 3 });
    }

    // With QA on top
    if (budget >= 2050710) {
      let steps = ["ore_cleaner", "polisher", "ore_smelter", "tempering_forge", "quality_assurance"];
      if (this.medals >= 3) steps.splice(2, 0, "philosophers_stone");
      let val = this.calculateOreValue(ore, steps);
      results.push({ chain: "Full Pre-Processing + QA", value: val, cost: 2050710, perOre: val, oresNeeded: 1, medals: this.medals >= 3 ? 3 : 0 });
    }

    // Engine chain
    if (budget >= 1200000) {
      const { engineVal, oresNeeded } = this.calculateEngineChainValue(ore.value);
      results.push({ chain: "Engine Factory Chain", value: engineVal, cost: 1200000, perOre: engineVal / oresNeeded, oresNeeded });
    }

    // Tablet chain
    if (budget >= 2600000) {
      const { tabletVal, oresNeeded } = this.calculateTabletChainValue(ore.value);
      results.push({ chain: "Tablet Factory Chain", value: tabletVal, cost: 2600000, perOre: tabletVal / oresNeeded, oresNeeded });
    }

    // Superconductor
    if (budget >= 1200000) {
      const { superVal, oresNeeded } = this.calculateSuperconductorValue(ore.value);
      results.push({ chain: "Superconductor Chain", value: superVal, cost: 1200000, perOre: superVal / oresNeeded, oresNeeded });
    }

    // Power Core
    if (budget >= 5700000) {
      const { pcVal, oresNeeded } = this.calculatePowerCoreValue(ore.value);
      results.push({ chain: "Power Core Chain", value: pcVal, cost: 5700000, perOre: pcVal / oresNeeded, oresNeeded });
    }

    // Sort by value per ore (efficiency)
    results.sort((a, b) => b.perOre - a.perOre);
    return results;
  }

  // Get recommended factory build for a budget
  getRecommendedBuild(budget, medals) {
    this.medals = medals;
    const stage = PROGRESSION_STAGES.find(s => s.budgetMax && budget <= s.budgetMax) || PROGRESSION_STAGES[PROGRESSION_STAGES.length - 1];

    // Calculate machine costs for stage
    const machineCosts = [];
    let totalMachineCost = 0;
    for (const machineId of stage.machines) {
      const machine = MACHINES[machineId];
      if (machine && machine.cost) {
        machineCosts.push({ id: machineId, ...machine });
        totalMachineCost += machine.cost;
      }
    }

    return {
      stage,
      machineCosts,
      totalMachineCost,
      affordable: totalMachineCost <= budget,
    };
  }

  // Get fresh prestige speedrun path
  getFreshPrestigePath() {
    const steps = [
      {
        phase: "Phase 1: Bootstrap",
        budget: "$0 - $500",
        time: "~5 min",
        actions: [
          "Mine Tin/Iron/Lead at surface level",
          "Buy Copper Pickaxe ($50)",
          "Buy Ore Cleaner ($80) + Polisher ($250) - adds $20 per ore",
          "Buy Small Backpack ($100)",
          "Sell cleaned & polished ores directly",
        ],
      },
      {
        phase: "Phase 2: Smelting Setup",
        budget: "$500 - $10K",
        time: "~10 min",
        actions: [
          "Buy Ore Smelter ($380) - 1.2x multiplier on ores",
          "Buy Iron Pickaxe ($500) - mine Cobalt/Aluminium",
          "Buy Coiler ($1,750) + Bolt Machine ($2,800)",
          "Buy Plate Stamper ($3,000) + Crusher ($1,750)",
          "Buy Kiln ($4,750) for glass from dust",
          "Buy Steel Pickaxe ($5,000) - access deeper ores",
          "Buy Minidumper ($5,000) for faster hauling",
          "Route stone byproduct through Crusher -> Kiln -> sell glass",
        ],
      },
      {
        phase: "Phase 3: Value Chain",
        budget: "$10K - $100K",
        time: "~15 min",
        actions: [
          "Buy Frame Maker ($10K) - Bar + Bolts = Frame (1.25x)",
          "Buy Circuit Maker ($20K) - Glass + Coil = Circuit (2x)",
          "Buy Ring Maker ($15K) if mining gems",
          "Buy Platinum Pickaxe ($25K) - mine Gold/Titanium",
          "Buy Casing Machine ($50K) - Frame + Bolts + Plate = Casing (1.3x)",
          "Buy Tempering Forge ($50K) - 2x bar value (HUGE upgrade)",
          "Always temper bars BEFORE using in combining machines",
        ],
      },
      {
        phase: "Phase 4: Advanced Chains",
        budget: "$100K - $1M",
        time: "~20 min",
        actions: [
          "Buy Alloy Furnace ($100K) - for Superconductor chain",
          "Buy Output Belt 2 ($100K) - double throughput",
          "Buy Titanium Pickaxe ($100K) - mine deep ores",
          "Buy Magnetic Machine ($120K)",
          "Buy Super Crawler ($200K) - 180 capacity",
          "Buy Optics Machine ($300K) for laser chain",
          "Build ceramic casing path: Dust -> Clay -> Ceramic ($150)",
          "Start Superconductor chain when budget allows",
        ],
      },
      {
        phase: "Phase 5: Mega Factories",
        budget: "$1M - $5M",
        time: "~25 min",
        actions: [
          "Buy Engine Factory ($1M) - 2.5x multiplier",
          "Buy Superconductor Constructor ($1M) - 3x multiplier",
          "Buy Infernum Pickaxe ($1M) - mine Iridium",
          "Buy Output Belt 3 ($1M)",
          "Buy QA Machine ($2M) - +20% on finished products",
          "Buy Amulet Maker ($2M) for gem processing",
          "Buy Tablet Factory ($2.5M) - 3x multiplier",
          "Buy Laser Maker ($3.5M) - 2.75x",
          "Buy Power Core Assembler ($4.5M) - 2.5x",
        ],
      },
      {
        phase: "Phase 6: Push to Prestige",
        budget: "$5M - $20M",
        time: "~30 min",
        actions: [
          "Maximize factory throughput",
          "Run multiple parallel processing lines",
          "Use all 4 output belts",
          "Focus on highest-multiplier chains (Tablet 3x, Superconductor 3x)",
          "Diamond/Mithril Pickaxe for best ores",
          "Exa-Drill ($8M) for deep mining automation",
          "Reach $20M total earned to prestige!",
        ],
      },
    ];

    return steps;
  }

  // Estimate income per minute for a given setup
  estimateIncome(ore, chain, throughputPerMin = 10) {
    const chainResults = this.getBestChain(ore, this.budget);
    const bestChain = chainResults.find(c => c.chain === chain) || chainResults[0];
    return {
      perItem: bestChain.value,
      perMinute: bestChain.value * (throughputPerMin / bestChain.oresNeeded),
      chain: bestChain.chain,
    };
  }
}
