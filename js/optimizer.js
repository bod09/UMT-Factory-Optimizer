// UMT Factory Optimizer - Core Logic
// Key mechanics:
// - Tag inheritance: crafted items inherit ALL tags from ingredients
// - Duplicator: can go ANYWHERE in chain. Both copies at 50% value. Products can't be re-duplicated.
// - Transmuters: bar↔gem conversion preserves value. Items already the target type pass through.
//   Cross-chain: bar→gem→gem cutter(1.4x)→gem-to-bar = free 1.4x on any bar
// - Passthrough: items that don't match a machine's input pass through without blocking

class FactoryOptimizer {
  constructor() {
    this.budget = 1000000;
    this.hasDoubleSeller = false;
    this.prestigeItems = {};
  }

  configure({ budget = 1000000, hasDoubleSeller = false, prestigeItems = {} }) {
    this.budget = budget;
    this.hasDoubleSeller = hasDoubleSeller;
    this.prestigeItems = prestigeItems;
  }

  getEffectiveOreValue(ore) {
    if (this.prestigeItems.oreUpgrader) {
      const upgraded = getUpgradedOreValue(ore.name);
      if (upgraded !== null) return upgraded;
    }
    return ore.value;
  }

  // Transmuter cross-chain bonus: bar → gem → gem cutter (1.4x) → gem-to-bar
  // Effectively multiplies bar value by 1.4x using the jewelcrafting chain
  applyTransmuterBonus(barVal) {
    if (!this.prestigeItems.transmuters) return barVal;
    // Bar → bar-to-gem → gem cutter (1.4x) → gem-to-bar → back as bar
    return barVal * 1.40;
  }

  // Full bar processing: Clean → Polish → Infuse → Smelt → Temper → Transmuter bonus
  getProcessedBarValue(oreValue) {
    let val = oreValue;
    val += 10; // ore cleaner
    val += 10; // polisher
    if (this.prestigeItems.philosophersStone) val *= 1.25;
    val *= 1.20; // ore smelter
    val *= 2.00; // tempering forge
    val = this.applyTransmuterBonus(val); // cross-chain if transmuters owned
    return val;
  }

  applySeller(val) {
    return this.hasDoubleSeller ? val * 2 : val;
  }

  getNanoSifterBonusPerOre() {
    if (!this.prestigeItems.nanoSifter) return 0;
    const rawBonus = 0.5 * 0.166 * NANO_SIFTER_AVG_VALUE;
    const processedBonus = this.getProcessedBarValue(rawBonus);
    return this.applySeller(processedBonus);
  }

  // Duplicator: finds optimal point and duplicates there
  // Duplicate a value → 2 copies at 50% each
  // Best used on the FINAL product (before selling) since it doubles item count
  // But flat bonuses after duplication apply to each copy independently
  applyDuplicator(finalVal) {
    if (!this.prestigeItems.duplicator) return finalVal;
    // Duplicate final product: 2 * (finalVal * 0.5) = finalVal (no gain on pure value)
    // BUT: duplicating BEFORE flat bonuses like QA (+20%) applies QA to both copies
    // Net: for late-chain duplicating, you get 2 items to sell from the same ores
    // The real gain is throughput: 2 products from the same ore input
    // For the optimizer (value per ore mined), we model it as:
    // Duplicate the product → 2 items at 50% = same total, but it means
    // you need half the ores for the same total output
    return finalVal; // Same per-ore value (2 * 50% = 100%)
    // The gain shows up in income estimates (double throughput)
  }

  // === CHAIN CALCULATIONS ===

  calculateEngineChainValue(oreValue) {
    let barVal = this.getProcessedBarValue(oreValue);
    let plateVal = barVal + 20;
    let mechPartsVal = plateVal + 30;
    let pipeVal = plateVal + 20;
    let boltsVal = barVal + 5;
    let frameVal = (barVal + boltsVal) * 1.25;
    let bolts2Val = barVal + 5;
    let plate2Val = barVal + 20;
    let casingVal = (frameVal + bolts2Val + plate2Val) * 1.30;
    let engineVal = (mechPartsVal + pipeVal + casingVal) * 2.50;
    if (this.budget >= 2000000) engineVal *= 1.20;
    return { value: this.applySeller(engineVal), oresNeeded: 5 };
  }

  calculateTabletChainValue(oreValue) {
    let barVal = this.getProcessedBarValue(oreValue);
    let boltsVal = barVal + 5;
    let plateVal = barVal + 20;
    let frameVal = (barVal + boltsVal) * 1.25;
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30;
    let glassVal = 30;
    let coilVal = barVal + 20;
    let circuitVal = (glassVal + coilVal) * 2.00;
    let tabletVal = (casingVal + glassVal + circuitVal) * 3.00;
    if (this.budget >= 2000000) tabletVal *= 1.20;
    return { value: this.applySeller(tabletVal), oresNeeded: 5 };
  }

  calculateSuperconductorValue(oreValue) {
    let barVal = this.getProcessedBarValue(oreValue);
    let alloyVal = (barVal + barVal) * 1.20;
    let ceramicVal = 150;
    let superVal = (alloyVal + ceramicVal) * 3.00;
    if (this.budget >= 2000000) superVal *= 1.20;
    return { value: this.applySeller(superVal), oresNeeded: 2 };
  }

  calculatePowerCoreValue(oreValue) {
    let barVal = this.getProcessedBarValue(oreValue);
    let boltsVal = barVal + 5;
    let plateVal = barVal + 20;
    let frameVal = (barVal + boltsVal) * 1.25;
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30;
    let alloyVal = (barVal + barVal) * 1.20;
    let ceramicVal = 150;
    let superVal = (alloyVal + ceramicVal) * 3.00;
    let coilVal = barVal + 20;
    let bolts2Val = barVal + 5;
    let plate2Val = barVal + 20;
    let frame2Val = (barVal + bolts2Val) * 1.25;
    let casing2Val = (frame2Val + bolts2Val + plate2Val) * 1.30;
    let electroVal = (coilVal + casing2Val) * 1.50;
    let pcVal = (casingVal + superVal + electroVal) * 2.50;
    if (this.budget >= 2000000) pcVal *= 1.20;
    return { value: this.applySeller(pcVal), oresNeeded: 10 };
  }

  calculateExplosivesValue(oreValue) {
    let barVal = this.getProcessedBarValue(oreValue);
    let boltsVal = barVal + 5;
    let plateVal = barVal + 20;
    let frameVal = (barVal + boltsVal) * 1.25;
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30;
    let powderVal = 3;
    let explosivesVal = casingVal * powderVal;
    if (this.budget >= 2000000) explosivesVal *= 1.20;
    return { value: this.applySeller(explosivesVal), oresNeeded: 5, powderVal };
  }

  // === MAIN OPTIMIZER ===

  getBestChain(ore, budget) {
    const results = [];
    const oreValue = this.getEffectiveOreValue(ore);
    const wasUpgraded = oreValue !== ore.value;
    const upgradeLabel = wasUpgraded ? ` [Upgraded: $${oreValue}]` : "";
    const hasDup = this.prestigeItems.duplicator;

    const addNanoBonus = (val, oresNeeded) => val + this.getNanoSifterBonusPerOre() * oresNeeded;

    // For duplicator: duplicating final product = 2 items from same ores
    // Per-ore value stays same, but throughput doubles
    // We show this as a separate "with Duplicator" variant with halved oresNeeded
    const addDupVariant = (name, val, cost, oresNeeded) => {
      if (hasDup && oresNeeded >= 2) {
        // Duplicate inputs: effectively halves ores needed for same output
        // Actually: duplicate the PRODUCT, get 2 at 50% = same value
        // But from factory perspective: you produce 2x items per cycle
        // Show as: same value, but note "2x throughput"
        results.push({
          chain: name + " + Dup" + upgradeLabel,
          value: val, cost, perOre: val / oresNeeded, oresNeeded,
          note: "Duplicator doubles output throughput"
        });
      }
    };

    // Direct sell
    let directVal = this.applySeller(oreValue);
    results.push({ chain: "Direct Sell" + upgradeLabel, value: directVal, cost: 0, perOre: directVal, oresNeeded: 1 });

    // Simple chains
    if (budget >= 710) {
      let val = (oreValue + 10 + 10) * 1.20;
      val = this.applySeller(val);
      val = addNanoBonus(val, 1);
      results.push({ chain: "Clean + Polish + Smelt" + upgradeLabel, value: val, cost: 710, perOre: val, oresNeeded: 1 });
    }

    if (budget >= 50710) {
      let val = (oreValue + 10 + 10) * 1.20 * 2.00;
      if (this.prestigeItems.transmuters) val *= 1.40;
      val = this.applySeller(val);
      val = addNanoBonus(val, 1);
      results.push({ chain: "Clean + Smelt + Temper" + (this.prestigeItems.transmuters ? " + Transmute" : "") + upgradeLabel, value: val, cost: 50710, perOre: val, oresNeeded: 1 });
    }

    if (budget >= 50710 && this.prestigeItems.philosophersStone) {
      let val = (oreValue + 10 + 10) * 1.25 * 1.20 * 2.00;
      if (this.prestigeItems.transmuters) val *= 1.40;
      val = this.applySeller(val);
      val = addNanoBonus(val, 1);
      results.push({ chain: "Infuse + Smelt + Temper" + (this.prestigeItems.transmuters ? " + Transmute" : "") + upgradeLabel, value: val, cost: 50710, perOre: val, oresNeeded: 1 });
    }

    if (budget >= 2050710) {
      let val = oreValue + 10 + 10;
      if (this.prestigeItems.philosophersStone) val *= 1.25;
      val = val * 1.20 * 2.00;
      if (this.prestigeItems.transmuters) val *= 1.40;
      val *= 1.20; // QA
      val = this.applySeller(val);
      val = addNanoBonus(val, 1);
      results.push({ chain: "Full Processing + QA" + (this.prestigeItems.transmuters ? " + Transmute" : "") + upgradeLabel, value: val, cost: 2050710, perOre: val, oresNeeded: 1 });
    }

    // Duplicator on simple bar: duplicate the finished bar, sell both
    if (hasDup && budget >= 50710) {
      let halfVal = oreValue * 0.50;
      let perCopy = halfVal + 10 + 10; // flat bonuses on each copy
      if (this.prestigeItems.philosophersStone) perCopy *= 1.25;
      perCopy *= 1.20 * 2.00;
      if (this.prestigeItems.transmuters) perCopy *= 1.40;
      if (budget >= 2000000) perCopy *= 1.20;
      let totalVal = perCopy * 2;
      totalVal = this.applySeller(totalVal);
      totalVal = addNanoBonus(totalVal, 1);
      results.push({
        chain: "Duplicate Ore + Process Both" + upgradeLabel, value: totalVal,
        cost: 2050710, perOre: totalVal, oresNeeded: 1,
      });
    }

    // Multi-input chains
    if (budget >= 1200000) {
      const r = this.calculateEngineChainValue(oreValue);
      let val = addNanoBonus(r.value, r.oresNeeded);
      results.push({ chain: "Engine Factory" + upgradeLabel, value: val, cost: 1200000, perOre: val / r.oresNeeded, oresNeeded: r.oresNeeded });
      addDupVariant("Engine Factory", val, 1200000, r.oresNeeded);
    }

    if (budget >= 2600000) {
      const r = this.calculateTabletChainValue(oreValue);
      let val = addNanoBonus(r.value, r.oresNeeded);
      results.push({ chain: "Tablet Factory" + upgradeLabel, value: val, cost: 2600000, perOre: val / r.oresNeeded, oresNeeded: r.oresNeeded });
      addDupVariant("Tablet Factory", val, 2600000, r.oresNeeded);
    }

    if (budget >= 1200000) {
      const r = this.calculateSuperconductorValue(oreValue);
      let val = addNanoBonus(r.value, r.oresNeeded);
      results.push({ chain: "Superconductor" + upgradeLabel, value: val, cost: 1200000, perOre: val / r.oresNeeded, oresNeeded: r.oresNeeded });
      addDupVariant("Superconductor", val, 1200000, r.oresNeeded);
    }

    if (budget >= 5700000) {
      const r = this.calculatePowerCoreValue(oreValue);
      let val = addNanoBonus(r.value, r.oresNeeded);
      results.push({ chain: "Power Core" + upgradeLabel, value: val, cost: 5700000, perOre: val / r.oresNeeded, oresNeeded: r.oresNeeded });
      addDupVariant("Power Core", val, 5700000, r.oresNeeded);
    }

    if (budget >= 2600000) {
      const r = this.calculateExplosivesValue(oreValue);
      let val = addNanoBonus(r.value, r.oresNeeded);
      results.push({ chain: "Explosives" + upgradeLabel, value: val, cost: 2600000, perOre: val / r.oresNeeded, oresNeeded: r.oresNeeded });
      addDupVariant("Explosives", val, 2600000, r.oresNeeded);
    }

    results.sort((a, b) => b.perOre - a.perOre);
    return results;
  }

  getRecommendedBuild(budget, medals) {
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
    return { stage, machineCosts, totalMachineCost, affordable: totalMachineCost <= budget };
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
        "Buy Ore Smelter ($380) - 1.2x multiplier on ores",
        "Buy Iron Pickaxe ($500) - mine Cobalt/Aluminium",
        "Buy Coiler ($1,750) + Bolt Machine ($2,800)",
        "Buy Plate Stamper ($3,000) + Crusher ($1,750)",
        "Buy Kiln ($4,750) for glass from dust",
        "Buy Steel Pickaxe ($5,000) - access deeper ores",
        "Buy Minidumper ($5,000) for faster hauling",
        "Route stone byproduct: Crusher -> Kiln -> sell glass ($30 each)",
      ]},
      { phase: "Phase 3: Value Chain", budget: "$10K - $100K", time: "~15 min", actions: [
        "Buy Frame Maker ($10K) - Bar + Bolts = Frame (1.25x)",
        "Buy Circuit Maker ($20K) - Glass + Coil = Circuit (2x)",
        "Buy Platinum Pickaxe ($25K) - mine Gold/Titanium",
        "Buy Casing Machine ($50K) - Frame + Bolts + Plate = Casing (1.3x)",
        "Buy Tempering Forge ($50K) - 2x bar value (HUGE upgrade)",
        "Always temper bars BEFORE using in combining machines",
      ]},
      { phase: "Phase 4: Advanced Chains", budget: "$100K - $1M", time: "~20 min", actions: [
        "Buy Alloy Furnace ($100K) - for Superconductor chain",
        "Buy Output Belt 2 ($100K) - double throughput",
        "Buy Titanium Pickaxe ($100K) - mine deep ores",
        "Buy Super Crawler ($200K) - 180 capacity",
        "Buy Optics Machine ($300K) for laser chain",
        "Build ceramic casing: Dust -> Clay -> Ceramic ($150)",
      ]},
      { phase: "Phase 5: Mega Factories", budget: "$1M - $5M", time: "~25 min", actions: [
        "Buy Engine Factory ($1M) - 2.5x multiplier",
        "Buy Superconductor Constructor ($1M) - 3x multiplier",
        "Buy Infernum Pickaxe ($1M) - mine Iridium",
        "Buy Output Belt 3 ($1M)",
        "Buy QA Machine ($2M) - +20% on finished products",
        "Buy Tablet Factory ($2.5M) - 3x multiplier",
        "Buy Laser Maker ($3.5M) - 2.75x",
        "Buy Power Core Assembler ($4.5M) - 2.5x",
      ]},
      { phase: "Phase 6: Push to Prestige", budget: "$5M - $20M", time: "~30 min", actions: [
        "Maximize factory throughput with parallel lines",
        "Use all 4 output belts",
        "Focus on highest-multiplier chains (Tablet 3x, Superconductor 3x)",
        "Use Transmuters to cross-chain for extra 1.4x gem cutter bonus",
        "Diamond/Mithril Pickaxe for best ores",
        "Exa-Drill ($8M) for deep mining automation",
        "Reach $20M total earned to prestige!",
      ]},
    ];
  }
}
