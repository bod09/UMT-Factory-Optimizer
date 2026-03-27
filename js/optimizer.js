// UMT Factory Optimizer - Core Logic
// Key mechanics:
// - Tag inheritance: crafted items inherit ALL tags from ingredients
// - Tags (Cleaned, Polished, Tempered, Infused, QA Tested) prevent re-application
// - Ore Upgrader: upgrades ore one tier before processing (max Mithril)
// - Duplicator: duplicate raw ore → 2 copies at 50% value, both get full flat bonuses
// - Nano Sifter: 16.6% chance ore from dust (stone byproduct bonus income)

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

  // Get the effective ore value after Ore Upgrader (if owned)
  getEffectiveOreValue(ore) {
    if (this.prestigeItems.oreUpgrader) {
      const upgraded = getUpgradedOreValue(ore.name);
      if (upgraded !== null) return upgraded;
    }
    return ore.value;
  }

  // Helper: get fully pre-processed bar value from an ore value
  // Clean (+$10) -> Polish (+$10) -> Infuse (1.25x if owned) -> Smelt (1.2x) -> Temper (2x)
  getProcessedBarValue(oreValue) {
    let val = oreValue;
    val += 10; // ore cleaner
    val += 10; // polisher
    if (this.prestigeItems.philosophersStone) val *= 1.25;
    val *= 1.20; // ore smelter
    val *= 2.00; // tempering forge
    return val;
  }

  // Helper: apply double seller
  applySeller(val) {
    return this.hasDoubleSeller ? val * 2 : val;
  }

  // Nano Sifter bonus: stone byproduct from smelting produces extra ores
  // Per ore smelted: ~0.5 stone produced -> crush to dust -> 16.6% chance of ore
  // Expected bonus value per ore smelted = 0.5 * 0.166 * avgNanoSifterOreValue
  getNanoSifterBonusPerOre() {
    if (!this.prestigeItems.nanoSifter) return 0;
    // Each smelted ore produces ~0.5 stone -> crush -> dust -> 16.6% chance
    // The produced ore can itself be processed through the same chain
    const rawBonus = 0.5 * 0.166 * NANO_SIFTER_AVG_VALUE;
    // Process the bonus ore through basic chain (clean+polish+smelt+temper)
    const processedBonus = this.getProcessedBarValue(rawBonus);
    return this.applySeller(processedBonus);
  }

  // Duplicator: duplicate raw ore before processing
  // 2 copies at 50% value each, but flat bonuses (+$10 clean, +$10 polish) apply to EACH
  // This makes duplicating early profitable: flat bonuses are doubled in total
  getDuplicatorMultiplier() {
    if (!this.prestigeItems.duplicator) return 1;
    // 2 copies at 50% value = items sold doubles, but base halved
    // Net: total value = 2 * process(oreValue * 0.5)
    // vs without: 1 * process(oreValue)
    // Due to flat bonuses: 2*(V/2 + 10 + 10) = V + 40 vs V + 20
    // So duplicator adds +20 flat effectively (extra $10+$10 from second copy)
    return 2; // 2 items produced per ore mined
  }

  // Calculate single-ore chain value (for simple chains)
  calculateOreValue(ore, steps) {
    let value = ore.value;
    const tags = new Set();

    for (const stepId of steps) {
      const machine = MACHINES[stepId];
      if (!machine) continue;
      if (machine.tag && tags.has(machine.tag)) continue;
      if (machine.tag) tags.add(machine.tag);

      switch (machine.effect) {
        case "flat": value += machine.value; break;
        case "percent": value *= (1 + machine.value); break;
        case "multiply": value *= machine.value; break;
        case "set": value = machine.value; break;
      }
    }

    if (this.hasDoubleSeller) value *= 2;
    return value;
  }

  // === MULTI-INPUT CHAIN CALCULATIONS ===

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

    // Helper to add nano sifter bonus to any chain that smelts
    const addNanoBonus = (val, oresNeeded) => {
      const bonus = this.getNanoSifterBonusPerOre() * oresNeeded;
      return val + bonus;
    };

    // Helper to apply duplicator (doubles items from same ore count)
    const applyDuplicator = (val, oreValue, oresNeeded) => {
      if (!this.prestigeItems.duplicator) return { val, oresNeeded };
      // Duplicate each ore: 2 copies at 50% value, each gets flat bonuses
      // For simple chains: value = 2 * process(oreValue/2) vs 1 * process(oreValue)
      // For multi-input: halve the ore value input, double the output
      return { val, oresNeeded }; // Applied via separate chain variants below
    };

    // Direct sell
    let directVal = this.applySeller(oreValue);
    results.push({ chain: "Direct Sell" + upgradeLabel, value: directVal, cost: 0, perOre: directVal, oresNeeded: 1 });

    // Basic: clean + polish + smelt
    if (budget >= 710) {
      let val = (oreValue + 10 + 10) * 1.20;
      val = this.applySeller(val);
      val = addNanoBonus(val, 1);
      results.push({ chain: "Clean + Polish + Smelt" + upgradeLabel, value: val, cost: 710, perOre: val, oresNeeded: 1 });
    }

    // With tempering
    if (budget >= 50710) {
      let val = (oreValue + 10 + 10) * 1.20 * 2.00;
      val = this.applySeller(val);
      val = addNanoBonus(val, 1);
      results.push({ chain: "Clean + Polish + Smelt + Temper" + upgradeLabel, value: val, cost: 50710, perOre: val, oresNeeded: 1 });
    }

    // With philosopher's stone
    if (budget >= 50710 && this.prestigeItems.philosophersStone) {
      let val = (oreValue + 10 + 10) * 1.25 * 1.20 * 2.00;
      val = this.applySeller(val);
      val = addNanoBonus(val, 1);
      results.push({ chain: "Infuse + Smelt + Temper" + upgradeLabel, value: val, cost: 50710, perOre: val, oresNeeded: 1 });
    }

    // With QA
    if (budget >= 2050710) {
      let val = oreValue + 10 + 10;
      if (this.prestigeItems.philosophersStone) val *= 1.25;
      val = val * 1.20 * 2.00 * 1.20;
      val = this.applySeller(val);
      val = addNanoBonus(val, 1);
      results.push({ chain: "Full Processing + QA" + upgradeLabel, value: val, cost: 2050710, perOre: val, oresNeeded: 1 });
    }

    // Duplicator variants: duplicate ore first, then process both copies
    // 2 copies at 50% value, each gets flat bonuses independently
    if (this.prestigeItems.duplicator && budget >= 50710) {
      let halfVal = oreValue * 0.50;
      // Each copy: clean (+10) + polish (+10) + smelt (1.2x) + temper (2x)
      let perCopy = halfVal + 10 + 10;
      if (this.prestigeItems.philosophersStone) perCopy *= 1.25;
      perCopy *= 1.20 * 2.00;
      if (budget >= 2000000) perCopy *= 1.20; // QA each copy
      let totalVal = perCopy * 2; // 2 copies from 1 ore
      totalVal = this.applySeller(totalVal);
      totalVal = addNanoBonus(totalVal, 1); // still 1 ore's worth of stone
      results.push({
        chain: "Duplicator + Process Both" + upgradeLabel, value: totalVal,
        cost: 2050710, perOre: totalVal, oresNeeded: 1,
        note: "Duplicate ore first, process both copies"
      });
    }

    // Multi-input chains (use effective ore value)
    if (budget >= 1200000) {
      const r = this.calculateEngineChainValue(oreValue);
      let val = addNanoBonus(r.value, r.oresNeeded);
      results.push({ chain: "Engine Factory" + upgradeLabel, value: val, cost: 1200000, perOre: val / r.oresNeeded, oresNeeded: r.oresNeeded });
    }

    if (budget >= 2600000) {
      const r = this.calculateTabletChainValue(oreValue);
      let val = addNanoBonus(r.value, r.oresNeeded);
      results.push({ chain: "Tablet Factory" + upgradeLabel, value: val, cost: 2600000, perOre: val / r.oresNeeded, oresNeeded: r.oresNeeded });
    }

    if (budget >= 1200000) {
      const r = this.calculateSuperconductorValue(oreValue);
      let val = addNanoBonus(r.value, r.oresNeeded);
      results.push({ chain: "Superconductor" + upgradeLabel, value: val, cost: 1200000, perOre: val / r.oresNeeded, oresNeeded: r.oresNeeded });
    }

    if (budget >= 5700000) {
      const r = this.calculatePowerCoreValue(oreValue);
      let val = addNanoBonus(r.value, r.oresNeeded);
      results.push({ chain: "Power Core" + upgradeLabel, value: val, cost: 5700000, perOre: val / r.oresNeeded, oresNeeded: r.oresNeeded });
    }

    if (budget >= 2600000) {
      const r = this.calculateExplosivesValue(oreValue);
      let val = addNanoBonus(r.value, r.oresNeeded);
      results.push({ chain: "Explosives" + upgradeLabel, value: val, cost: 2600000, perOre: val / r.oresNeeded, oresNeeded: r.oresNeeded });
    }

    results.sort((a, b) => b.perOre - a.perOre);
    return results;
  }

  // Get recommended factory build
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
        "Buy Ring Maker ($15K) if mining gems",
        "Buy Platinum Pickaxe ($25K) - mine Gold/Titanium",
        "Buy Casing Machine ($50K) - Frame + Bolts + Plate = Casing (1.3x)",
        "Buy Tempering Forge ($50K) - 2x bar value (HUGE upgrade)",
        "Always temper bars BEFORE using in combining machines",
      ]},
      { phase: "Phase 4: Advanced Chains", budget: "$100K - $1M", time: "~20 min", actions: [
        "Buy Alloy Furnace ($100K) - for Superconductor chain",
        "Buy Output Belt 2 ($100K) - double throughput",
        "Buy Titanium Pickaxe ($100K) - mine deep ores",
        "Buy Magnetic Machine ($120K)",
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
        "Diamond/Mithril Pickaxe for best ores",
        "Exa-Drill ($8M) for deep mining automation",
        "Reach $20M total earned to prestige!",
      ]},
    ];
  }
}
