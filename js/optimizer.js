// UMT Factory Optimizer - Core Logic
// Key mechanics:
// - Tag inheritance: crafted items inherit ALL tags from ingredients
// - Duplicator: can go ANYWHERE. Best placed on most expensive intermediate before a combiner.
//   Both copies at 50% value. Products of duplicated items can't be re-duplicated.
// - Transmuters: bar↔gem preserves value. Extended gem path:
//   bar → gem → gem cutter(1.4x) → 2 cut gems → prismatic crucible(1.15x) → gem-to-bar
//   Net: 1.61x per pair of bars (or 1.4x for single bar)
// - Looping: items can flow backwards through factory as long as same tag isn't re-applied

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

  // Transmuter cross-chain: bar → gem → gem cutter (1.4x) → prismatic (1.15x on pairs) → gem-to-bar
  // For pairs of bars: combined * 1.4 * 1.15 / 2 bars = 1.61x per bar (averaged)
  // For single bar: just gem cutter = 1.4x
  // We use 1.61x since most chains use even numbers of bars or can pair them up
  applyTransmuterBonus(barVal) {
    if (!this.prestigeItems.transmuters) return barVal;
    // bar → gem → gem cutter (1.4x) → pair 2 cut gems → prismatic (1.15x combined) → gem-to-bar
    // Per bar: value * 1.4, then paired: (val*1.4 + val*1.4) * 1.15 / 2 = val * 1.4 * 1.15 = val * 1.61
    return barVal * 1.61;
  }

  // Full bar processing pipeline
  getProcessedBarValue(oreValue) {
    let val = oreValue;
    val += 10; // ore cleaner
    val += 10; // polisher
    if (this.prestigeItems.philosophersStone) val *= 1.25;
    val *= 1.20; // ore smelter
    val *= 2.00; // tempering forge
    val = this.applyTransmuterBonus(val);
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

  // === CHAIN CALCULATIONS ===
  // All return { value, oresNeeded }
  // "oresNeeded" tracks actual ore consumption including duplicator savings

  calculateEngineChainValue(oreValue, useDup = false) {
    let barVal = this.getProcessedBarValue(oreValue);
    let plateVal = barVal + 20;
    let mechPartsVal = plateVal + 30;
    let pipeVal = plateVal + 20;
    let boltsVal = barVal + 5;
    let frameVal = (barVal + boltsVal) * 1.25;
    let bolts2Val = barVal + 5;
    let plate2Val = barVal + 20;
    let casingVal = (frameVal + bolts2Val + plate2Val) * 1.30;

    // Duplicator: best on casing (most expensive intermediate, 3 ores worth)
    // Duplicate casing → 2 casings at 50%, each gets its own mech+pipe
    // Without dup: 5 ores → 1 engine
    // With dup on casing: 3 ores for casing(dup) + 2*2 ores for mech+pipe = 7 ores → 2 engines
    let oresNeeded = 5;
    let engineVal;

    if (useDup) {
      let dupCasing = casingVal * 0.50;
      engineVal = (mechPartsVal + pipeVal + dupCasing) * 2.50;
      // 2 engines from: 3 ores(casing) + 2*2 ores(mech+pipe) = 7 ores
      // But each engine has half-value casing
      oresNeeded = 4; // per engine: 7/2 rounded = 3.5, use 4 for conservative estimate
    } else {
      engineVal = (mechPartsVal + pipeVal + casingVal) * 2.50;
    }

    if (this.budget >= 2000000) engineVal *= 1.20;
    return { value: this.applySeller(engineVal), oresNeeded };
  }

  calculateTabletChainValue(oreValue, useDup = false) {
    let barVal = this.getProcessedBarValue(oreValue);
    let boltsVal = barVal + 5;
    let plateVal = barVal + 20;
    let frameVal = (barVal + boltsVal) * 1.25;
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30;
    let glassVal = 30;
    let coilVal = barVal + 20;
    let circuitVal = (glassVal + coilVal) * 2.00;

    let oresNeeded = 5;
    let tabletVal;

    if (useDup) {
      // Duplicate casing (most expensive), use with glass+circuit for each
      let dupCasing = casingVal * 0.50;
      tabletVal = (dupCasing + glassVal + circuitVal) * 3.00;
      oresNeeded = 4;
    } else {
      tabletVal = (casingVal + glassVal + circuitVal) * 3.00;
    }

    if (this.budget >= 2000000) tabletVal *= 1.20;
    return { value: this.applySeller(tabletVal), oresNeeded };
  }

  calculateSuperconductorValue(oreValue, useDup = false) {
    let barVal = this.getProcessedBarValue(oreValue);
    let alloyVal = (barVal + barVal) * 1.20;
    let ceramicVal = 150;

    let oresNeeded = 2;
    let superVal;

    if (useDup) {
      // Duplicate alloy bar before combining with ceramic
      let dupAlloy = alloyVal * 0.50;
      superVal = (dupAlloy + ceramicVal) * 3.00;
      // 2 supers from: 2 ores(alloy) + 0(ceramic from stone) = 2 ores for 2 items
      oresNeeded = 1; // per super
    } else {
      superVal = (alloyVal + ceramicVal) * 3.00;
    }

    if (this.budget >= 2000000) superVal *= 1.20;
    return { value: this.applySeller(superVal), oresNeeded };
  }

  calculatePowerCoreValue(oreValue, useDup = false) {
    let barVal = this.getProcessedBarValue(oreValue);

    // Casing (costs ~4 bars = most expensive)
    let boltsVal = barVal + 5;
    let plateVal = barVal + 20;
    let frameVal = (barVal + boltsVal) * 1.25;
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30;

    // Superconductor (costs ~2 bars)
    let alloyVal = (barVal + barVal) * 1.20;
    let ceramicVal = 150;
    let superVal = (alloyVal + ceramicVal) * 3.00;

    // Electromagnet (costs ~4 bars)
    let coilVal = barVal + 20;
    let bolts2Val = barVal + 5;
    let plate2Val = barVal + 20;
    let frame2Val = (barVal + bolts2Val) * 1.25;
    let casing2Val = (frame2Val + bolts2Val + plate2Val) * 1.30;
    let electroVal = (coilVal + casing2Val) * 1.50;

    let oresNeeded = 10;
    let pcVal;

    if (useDup) {
      // Duplicate casing (most expensive sub-component at ~4 ores)
      // 2 casings at 50% → each combines with super + electro for 2 power cores
      // Saves: 4 ores (don't need 2nd casing), costs: 2+4 extra for 2nd super+electro
      // Net: 4(casing dup) + 2(super) + 4(electro) + 2(super2) + 4(electro2) = 16 for 2 PCs = 8/PC
      let dupCasing = casingVal * 0.50;
      pcVal = (dupCasing + superVal + electroVal) * 2.50;
      oresNeeded = 8;
    } else {
      pcVal = (casingVal + superVal + electroVal) * 2.50;
    }

    if (this.budget >= 2000000) pcVal *= 1.20;
    return { value: this.applySeller(pcVal), oresNeeded };
  }

  calculateExplosivesValue(oreValue, useDup = false) {
    let barVal = this.getProcessedBarValue(oreValue);
    let boltsVal = barVal + 5;
    let plateVal = barVal + 20;
    let frameVal = (barVal + boltsVal) * 1.25;
    let casingVal = (frameVal + boltsVal + plateVal) * 1.30;
    let powderVal = 3;

    let oresNeeded = 5;
    let explosivesVal;

    if (useDup) {
      let dupCasing = casingVal * 0.50;
      explosivesVal = dupCasing * powderVal;
      oresNeeded = 3; // half the casing ores saved
    } else {
      explosivesVal = casingVal * powderVal;
    }

    if (this.budget >= 2000000) explosivesVal *= 1.20;
    return { value: this.applySeller(explosivesVal), oresNeeded, powderVal };
  }

  // === MAIN OPTIMIZER ===

  getBestChain(ore, budget) {
    const results = [];
    const oreValue = this.getEffectiveOreValue(ore);
    const wasUpgraded = oreValue !== ore.value;
    const uLabel = wasUpgraded ? ` [Upgraded]` : "";
    const tLabel = this.prestigeItems.transmuters ? " + Transmute" : "";
    const hasDup = this.prestigeItems.duplicator;

    const addNano = (val, n) => val + this.getNanoSifterBonusPerOre() * n;

    // --- Simple chains (1 ore → 1 product) ---

    // Direct sell
    let directVal = this.applySeller(oreValue);
    results.push({ chain: "Direct Sell" + uLabel, value: directVal, cost: 0, perOre: directVal, oresNeeded: 1 });

    // Clean + Polish + Smelt
    if (budget >= 710) {
      let val = this.applySeller((oreValue + 10 + 10) * 1.20);
      val = addNano(val, 1);
      results.push({ chain: "Clean + Polish + Smelt" + uLabel, value: val, cost: 710, perOre: val, oresNeeded: 1 });
    }

    // Clean + Smelt + Temper (+ Transmute if owned)
    if (budget >= 50710) {
      let val = (oreValue + 10 + 10) * 1.20 * 2.00;
      if (this.prestigeItems.transmuters) val *= 1.61;
      val = this.applySeller(val);
      val = addNano(val, 1);
      results.push({ chain: "Smelt + Temper" + tLabel + uLabel, value: val, cost: 50710, perOre: val, oresNeeded: 1 });
    }

    // With philosopher's stone
    if (budget >= 50710 && this.prestigeItems.philosophersStone) {
      let val = (oreValue + 10 + 10) * 1.25 * 1.20 * 2.00;
      if (this.prestigeItems.transmuters) val *= 1.61;
      val = this.applySeller(val);
      val = addNano(val, 1);
      results.push({ chain: "Infuse + Temper" + tLabel + uLabel, value: val, cost: 50710, perOre: val, oresNeeded: 1 });
    }

    // Full processing + QA
    if (budget >= 2050710) {
      let val = oreValue + 10 + 10;
      if (this.prestigeItems.philosophersStone) val *= 1.25;
      val *= 1.20 * 2.00;
      if (this.prestigeItems.transmuters) val *= 1.61;
      val *= 1.20;
      val = this.applySeller(val);
      val = addNano(val, 1);
      results.push({ chain: "Full + QA" + tLabel + uLabel, value: val, cost: 2050710, perOre: val, oresNeeded: 1 });
    }

    // Duplicator on simple bar (duplicate ore, process both copies)
    if (hasDup && budget >= 50710) {
      let halfVal = oreValue * 0.50;
      let perCopy = halfVal + 10 + 10;
      if (this.prestigeItems.philosophersStone) perCopy *= 1.25;
      perCopy *= 1.20 * 2.00;
      if (this.prestigeItems.transmuters) perCopy *= 1.61;
      if (budget >= 2000000) perCopy *= 1.20;
      let totalVal = this.applySeller(perCopy * 2);
      totalVal = addNano(totalVal, 1);
      results.push({ chain: "Dup Ore + Process Both" + tLabel + uLabel, value: totalVal, cost: 2050710, perOre: totalVal, oresNeeded: 1 });
    }

    // --- Multi-input chains ---
    const chainDefs = [
      { name: "Engine", fn: "calculateEngineChainValue", minBudget: 1200000 },
      { name: "Tablet", fn: "calculateTabletChainValue", minBudget: 2600000 },
      { name: "Superconductor", fn: "calculateSuperconductorValue", minBudget: 1200000 },
      { name: "Power Core", fn: "calculatePowerCoreValue", minBudget: 5700000 },
      { name: "Explosives", fn: "calculateExplosivesValue", minBudget: 2600000 },
    ];

    for (const def of chainDefs) {
      if (budget >= def.minBudget) {
        // Without duplicator
        const r = this[def.fn](oreValue, false);
        let val = addNano(r.value, r.oresNeeded);
        results.push({ chain: def.name + tLabel + uLabel, value: val, cost: def.minBudget, perOre: val / r.oresNeeded, oresNeeded: r.oresNeeded });

        // With duplicator (optimal placement on most expensive intermediate)
        if (hasDup) {
          const rd = this[def.fn](oreValue, true);
          let valD = addNano(rd.value, rd.oresNeeded);
          results.push({
            chain: def.name + " + Dup" + tLabel + uLabel, value: valD,
            cost: def.minBudget, perOre: valD / rd.oresNeeded, oresNeeded: rd.oresNeeded,
          });
        }
      }
    }

    results.sort((a, b) => b.perOre - a.perOre);
    return results;
  }

  getRecommendedBuild(budget) {
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
        "Transmuter cross-chain: bar→gem→gem cutter→prismatic→gem-to-bar = 1.61x bonus",
        "Loop items back through different machines for extra multipliers",
        "Diamond/Mithril Pickaxe for best ores",
        "Exa-Drill ($8M) for deep mining automation",
        "Reach $20M total earned to prestige!",
      ]},
    ];
  }
}
