// UMT Factory Optimizer - Core Logic
// Key mechanic: Tag inheritance - crafted items inherit ALL tags from ingredients.
// Tags (Cleaned, Polished, Tempered, Infused, QA Tested, Tuned) prevent re-application.
// Multiple machines of same type OK for throughput, but same item can't pass through twice.

class FactoryOptimizer {
  constructor() {
    this.prestigeLevel = 0;
    this.medals = 0;
    this.budget = 1000000;
    this.hasDoubleSeller = false;
    this.prestigeItems = {};
  }

  configure({ prestigeLevel = 0, budget = 1000000, hasDoubleSeller = false, prestigeItems = {} }) {
    this.prestigeLevel = prestigeLevel;
    this.medals = prestigeLevel;
    this.budget = budget;
    this.hasDoubleSeller = hasDoubleSeller;
    this.prestigeItems = prestigeItems;
  }

  // Helper: get fully pre-processed bar value from an ore
  // Clean (+$10) -> Polish (+$10) -> Infuse (1.25x if owned) -> Smelt (1.2x) -> Temper (2x)
  getProcessedBarValue(oreValue) {
    let val = oreValue;
    val += 10; // ore cleaner
    val += 10; // polisher
    if (this.prestigeItems.philosophersStone) val *= 1.25; // philosopher's stone
    val *= 1.20; // ore smelter
    val *= 2.00; // tempering forge
    return val;
  }

  // Helper: apply double seller
  applySeller(val) {
    return this.hasDoubleSeller ? val * 2 : val;
  }

  // Calculate value of an ore through a list of single-item processing steps
  calculateOreValue(ore, steps) {
    let value = ore.value;
    const tags = new Set();

    for (const stepId of steps) {
      const machine = MACHINES[stepId];
      if (!machine) continue;

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
          break;
        case "set":
          value = machine.value;
          break;
      }
    }

    if (this.hasDoubleSeller) value *= 2;
    return value;
  }

  // === CHAIN CALCULATIONS ===
  // Each uses multiple ores. "oresNeeded" = how many ores consumed per product.
  // Tags are tracked: tempered bar -> bolts means bolts inherit Tempered tag.

  calculateEngineChainValue(oreValue) {
    let barVal = this.getProcessedBarValue(oreValue);

    // All bars are tempered, so all derivatives inherit Tempered tag
    // Ore 1 -> bar -> plate -> mech parts
    let plateVal = barVal + 20;
    let mechPartsVal = plateVal + 30;

    // Ore 2 -> bar -> plate -> pipe
    let pipeVal = plateVal + 20;

    // Ore 3 -> bar -> bolts
    let boltsVal = barVal + 5;

    // Ore 4 -> bar (for frame)
    let frameVal = (barVal + boltsVal) * 1.25;

    // Ore 5 -> bar -> bolts + plate for casing
    let bolts2Val = barVal + 5;
    let plate2Val = barVal + 20;
    let casingVal = (frameVal + bolts2Val + plate2Val) * 1.30;

    // Engine = mech parts + pipe + casing (2.5x)
    let engineVal = (mechPartsVal + pipeVal + casingVal) * 2.50;

    // QA on final product (tag not inherited from ingredients for QA)
    if (this.budget >= 2000000) engineVal *= 1.20;

    return { value: this.applySeller(engineVal), oresNeeded: 5 };
  }

  calculateTabletChainValue(oreValue) {
    let barVal = this.getProcessedBarValue(oreValue);

    // Casing path
    let boltsVal = barVal + 5;
    let plateVal = barVal + 20;
    let frameVal = (barVal + boltsVal) * 1.25;
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30;

    // Glass from stone byproduct (dust -> kiln = $30 flat)
    let glassVal = 30;

    // Coil from another bar
    let coilVal = barVal + 20;

    // Circuit = glass + coil (2x)
    let circuitVal = (glassVal + coilVal) * 2.00;

    // Tablet = casing + glass + circuit (3x)
    let tabletVal = (casingVal + glassVal + circuitVal) * 3.00;

    if (this.budget >= 2000000) tabletVal *= 1.20;
    return { value: this.applySeller(tabletVal), oresNeeded: 5 };
  }

  calculateSuperconductorValue(oreValue) {
    let barVal = this.getProcessedBarValue(oreValue);

    // Alloy bar = 2 tempered bars (1.2x combined)
    let alloyVal = (barVal + barVal) * 1.20;

    // Ceramic casing from stone byproduct ($150 flat)
    let ceramicVal = 150;

    // Superconductor = alloy + ceramic (3x)
    let superVal = (alloyVal + ceramicVal) * 3.00;

    if (this.budget >= 2000000) superVal *= 1.20;
    return { value: this.applySeller(superVal), oresNeeded: 2 };
  }

  calculatePowerCoreValue(oreValue) {
    let barVal = this.getProcessedBarValue(oreValue);

    // Casing
    let boltsVal = barVal + 5;
    let plateVal = barVal + 20;
    let frameVal = (barVal + boltsVal) * 1.25;
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30;

    // Superconductor
    let alloyVal = (barVal + barVal) * 1.20;
    let ceramicVal = 150;
    let superVal = (alloyVal + ceramicVal) * 3.00;

    // Electromagnet = coil + casing2 (1.5x)
    let coilVal = barVal + 20;
    let bolts2Val = barVal + 5;
    let plate2Val = barVal + 20;
    let frame2Val = (barVal + bolts2Val) * 1.25;
    let casing2Val = (frame2Val + bolts2Val + plate2Val) * 1.30;
    let electroVal = (coilVal + casing2Val) * 1.50;

    // Power Core = casing + superconductor + electromagnet (2.5x)
    let pcVal = (casingVal + superVal + electroVal) * 2.50;

    if (this.budget >= 2000000) pcVal *= 1.20;
    return { value: this.applySeller(pcVal), oresNeeded: 10 };
  }

  calculateLaserValue(oreValue, gemValue) {
    let barVal = this.getProcessedBarValue(oreValue);

    // Optic: glass ($30) -> lens ($80) + pipe (barVal+20) -> optic (1.25x)
    let glassVal = 30;
    let lensVal = glassVal + 50;
    let pipeVal = barVal + 20;  // from plate
    let opticVal = (lensVal + pipeVal) * 1.25;

    // Circuit: glass + coil (2x)
    let coilVal = barVal + 20;
    let circuitVal = (glassVal + coilVal) * 2.00;

    // Laser = optic + gem + circuit (2.75x)
    let laserVal = (opticVal + gemValue + circuitVal) * 2.75;

    if (this.budget >= 2000000) laserVal *= 1.20;
    return { value: this.applySeller(laserVal), oresNeeded: 3 };
  }

  // EXPLOSIVES CHAIN - multiplicative scaling
  // Powder value = $2 base + $1 from single refiner pass (only works once in practice)
  // Explosives value = casing_value * powder_value
  calculateExplosivesValue(oreValue) {
    let barVal = this.getProcessedBarValue(oreValue);

    // Metal casing (from ore chain)
    let boltsVal = barVal + 5;
    let plateVal = barVal + 20;
    let frameVal = (barVal + boltsVal) * 1.25;
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30;

    // Blasting powder: metal dust + stone dust -> $2 base
    // Refiner only works once per powder in practice -> $3
    let powderVal = 3;

    // Explosives = casing_value * powder_value (MULTIPLICATIVE)
    let explosivesVal = casingVal * powderVal;

    if (this.budget >= 2000000) explosivesVal *= 1.20;
    return { value: this.applySeller(explosivesVal), oresNeeded: 5, powderVal };
  }

  // Get best chains for a given ore and budget
  getBestChain(ore, budget) {
    const results = [];

    // Direct sell
    let directVal = ore.value;
    if (this.hasDoubleSeller) directVal *= 2;
    results.push({ chain: "Direct Sell", value: directVal, cost: 0, perOre: directVal, oresNeeded: 1 });

    // Basic processing: clean + polish + smelt
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
    if (budget >= 50710 && this.prestigeItems.philosophersStone) {
      let val = this.calculateOreValue(ore, ["ore_cleaner", "polisher", "philosophers_stone", "ore_smelter", "tempering_forge"]);
      results.push({ chain: "Full Pre-Processing (Infuse + Temper)", value: val, cost: 50710, perOre: val, oresNeeded: 1, medals: 3 });
    }

    // With QA on top
    if (budget >= 2050710) {
      let steps = ["ore_cleaner", "polisher", "ore_smelter", "tempering_forge", "quality_assurance"];
      if (this.prestigeItems.philosophersStone) steps.splice(2, 0, "philosophers_stone");
      let val = this.calculateOreValue(ore, steps);
      results.push({ chain: "Full Pre-Processing + QA", value: val, cost: 2050710, perOre: val, oresNeeded: 1 });
    }

    // Engine chain (needs casing + mech parts + pipe)
    if (budget >= 1200000) {
      const r = this.calculateEngineChainValue(ore.value);
      results.push({ chain: "Engine Factory Chain", value: r.value, cost: 1200000, perOre: r.value / r.oresNeeded, oresNeeded: r.oresNeeded });
    }

    // Tablet chain
    if (budget >= 2600000) {
      const r = this.calculateTabletChainValue(ore.value);
      results.push({ chain: "Tablet Factory Chain", value: r.value, cost: 2600000, perOre: r.value / r.oresNeeded, oresNeeded: r.oresNeeded });
    }

    // Superconductor
    if (budget >= 1200000) {
      const r = this.calculateSuperconductorValue(ore.value);
      results.push({ chain: "Superconductor Chain", value: r.value, cost: 1200000, perOre: r.value / r.oresNeeded, oresNeeded: r.oresNeeded });
    }

    // Power Core
    if (budget >= 5700000) {
      const r = this.calculatePowerCoreValue(ore.value);
      results.push({ chain: "Power Core Chain", value: r.value, cost: 5700000, perOre: r.value / r.oresNeeded, oresNeeded: r.oresNeeded });
    }

    // Explosives chain (needs refiner at $2.5M + other machines)
    if (budget >= 2600000) {
      const r = this.calculateExplosivesValue(ore.value);
      results.push({
        chain: "Explosives Chain",
        value: r.value, cost: 2600000, perOre: r.value / r.oresNeeded, oresNeeded: r.oresNeeded,
      });
    }

    // Duplicator variants (if owned) - duplicate a tempered bar then process both
    if (this.prestigeItems.duplicator && budget >= 50710) {
      let barVal = this.getProcessedBarValue(ore.value);
      // Duplicator: 2 copies at 50% each, but both can be further processed
      let dupBarVal = barVal * 0.50;
      // Each duplicated bar can still be used in chains
      // Net: 2 bars at 50% = same total value, but from 1 ore instead of 2
      // Best use: duplicate BEFORE combining in high-multiplier machines
      let dupVal = dupBarVal * 2; // Total from both copies, sold as bars
      if (this.hasDoubleSeller) dupVal *= 2;
      // Not worth it for simple bars, but for late-game products:
      // Duplicate a finished engine/tablet for 2x output at 50% value each = same value
      // Real value: duplicate early inputs to feed more machines
    }

    // Sort by value per ore (efficiency)
    results.sort((a, b) => b.perOre - a.perOre);
    return results;
  }

  // Get recommended factory build for a budget
  getRecommendedBuild(budget, medals) {
    this.medals = medals;
    const stage = PROGRESSION_STAGES.find(s => s.budgetMax && budget <= s.budgetMax) || PROGRESSION_STAGES[PROGRESSION_STAGES.length - 1];

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
          "Buy Blasting Powder Refiner ($2.5M) for explosives chain",
          "Buy Laser Maker ($3.5M) - 2.75x",
          "Buy Power Core Assembler ($4.5M) - 2.5x",
        ],
      },
      {
        phase: "Phase 6: Push to Prestige",
        budget: "$5M - $20M",
        time: "~30 min",
        actions: [
          "Maximize factory throughput with parallel lines",
          "Run multiple processing chains simultaneously",
          "Use all 4 output belts",
          "Explosives chain: loop powder through refiners for multiplicative scaling",
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
