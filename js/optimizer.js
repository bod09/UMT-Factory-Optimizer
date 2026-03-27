// UMT Factory Optimizer - Core Logic
// Shows the BEST option per chain based on what prestige items the player owns.
// No separate dup/non-dup variants - just the optimal result.

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

  // --- Prestige item helpers ---

  getEffectiveOreValue(ore) {
    if (this.prestigeItems.oreUpgrader) {
      const upgraded = getUpgradedOreValue(ore.name);
      if (upgraded !== null) return upgraded;
    }
    return ore.value;
  }

  // Transmuter: bar → gem → gem cutter(1.4x) → pair → prismatic(1.15x) → gem-to-bar = 1.61x
  transmuterMultiplier() {
    return this.prestigeItems.transmuters ? 1.61 : 1;
  }

  applySeller(val) {
    return this.hasDoubleSeller ? val * 2 : val;
  }

  // Nano Sifter: bonus ore from stone byproduct per ore smelted
  nanoBonus() {
    if (!this.prestigeItems.nanoSifter) return 0;
    // 0.5 stone per smelt → crush → 16.6% chance ore → process that ore
    const raw = 0.5 * 0.166 * NANO_SIFTER_AVG_VALUE;
    return this.applySeller(this.processBar(raw));
  }

  // --- Core bar processing pipeline ---
  // Clean(+10) → Polish(+10) → Infuse(1.25x) → Smelt(1.2x) → Temper(2x) → Transmute(1.61x)
  processBar(oreValue) {
    let v = oreValue + 10 + 10;
    if (this.prestigeItems.philosophersStone) v *= 1.25;
    v *= 1.20; // smelt
    v *= 2.00; // temper
    v *= this.transmuterMultiplier();
    return v;
  }

  // Duplicator: duplicate ore first → 2 copies at 50%, each gets flat bonuses
  // Returns total value from 1 ore (2 items sold)
  processDuplicatedOre(oreValue) {
    let half = oreValue * 0.50;
    let perCopy = half + 10 + 10;
    if (this.prestigeItems.philosophersStone) perCopy *= 1.25;
    perCopy *= 1.20 * 2.00;
    perCopy *= this.transmuterMultiplier();
    return perCopy * 2; // 2 copies
  }

  // --- Chain calculations ---
  // Each returns { value (after seller), oresNeeded, steps[] for breakdown }
  // Duplicator is integrated: placed on the most expensive intermediate when owned

  calcSimpleBar(oreValue) {
    const hasDup = this.prestigeItems.duplicator;
    const hasQA = this.budget >= 2000000;
    let steps = [];
    let val, ores;

    if (hasDup) {
      // Duplicate ore → 2 copies → process each → sell both
      val = this.processDuplicatedOre(oreValue);
      if (hasQA) val *= 1.20;
      val = this.applySeller(val);
      ores = 1;
      steps.push({ name: "Duplicate ore (50% each, 2 copies)", val: oreValue * 0.5 });
      steps.push({ name: "Each: Clean(+10) + Polish(+10)", val: oreValue * 0.5 + 20 });
    } else {
      val = this.processBar(oreValue);
      if (hasQA) val *= 1.20;
      val = this.applySeller(val);
      ores = 1;
    }
    val += this.nanoBonus() * ores;
    return { value: val, oresNeeded: ores };
  }

  // Helper: build casing from bars
  buildCasing(barVal) {
    let bolts = barVal + 5;
    let plate = barVal + 20;
    let frame = (barVal + bolts) * 1.25;
    return (frame + bolts + plate) * 1.30;
  }

  calcEngine(oreValue) {
    let bar = this.processBar(oreValue);
    let hasDup = this.prestigeItems.duplicator;
    let hasQA = this.budget >= 2000000;

    let plate = bar + 20;
    let mech = plate + 30;
    let pipe = plate + 20;
    let casing = this.buildCasing(bar);

    let val, ores;
    if (hasDup) {
      // Duplicate casing (most expensive, ~3 bars worth)
      let dupCasing = casing * 0.50;
      val = (mech + pipe + dupCasing) * 2.50;
      ores = 4; // saved 1 ore from casing duplication
    } else {
      val = (mech + pipe + casing) * 2.50;
      ores = 5;
    }
    if (hasQA) val *= 1.20;
    val = this.applySeller(val);
    val += this.nanoBonus() * ores;
    return { value: val, oresNeeded: ores };
  }

  calcTablet(oreValue) {
    let bar = this.processBar(oreValue);
    let hasDup = this.prestigeItems.duplicator;
    let hasQA = this.budget >= 2000000;

    let casing = this.buildCasing(bar);
    let glass = 30;
    let coil = bar + 20;
    let circuit = (glass + coil) * 2.00;

    let val, ores;
    if (hasDup) {
      // Duplicate casing
      let dupCasing = casing * 0.50;
      val = (dupCasing + glass + circuit) * 3.00;
      ores = 4;
    } else {
      val = (casing + glass + circuit) * 3.00;
      ores = 5;
    }
    if (hasQA) val *= 1.20;
    val = this.applySeller(val);
    val += this.nanoBonus() * ores;
    return { value: val, oresNeeded: ores };
  }

  calcSuperconductor(oreValue) {
    let bar = this.processBar(oreValue);
    let hasDup = this.prestigeItems.duplicator;
    let hasQA = this.budget >= 2000000;

    let alloy = (bar + bar) * 1.20;
    let ceramic = 150;

    let val, ores;
    if (hasDup) {
      // Duplicate alloy bar (2 bars → 1 alloy → dup → 2 alloys at 50%)
      let dupAlloy = alloy * 0.50;
      val = (dupAlloy + ceramic) * 3.00;
      ores = 1; // 2 bars for alloy, but dup halves consumption per product
    } else {
      val = (alloy + ceramic) * 3.00;
      ores = 2;
    }
    if (hasQA) val *= 1.20;
    val = this.applySeller(val);
    val += this.nanoBonus() * ores;
    return { value: val, oresNeeded: ores };
  }

  calcPowerCore(oreValue) {
    let bar = this.processBar(oreValue);
    let hasDup = this.prestigeItems.duplicator;
    let hasQA = this.budget >= 2000000;

    let casing = this.buildCasing(bar);
    let alloy = (bar + bar) * 1.20;
    let supercon = (alloy + 150) * 3.00;

    let coil = bar + 20;
    let casing2 = this.buildCasing(bar);
    let electro = (coil + casing2) * 1.50;

    let val, ores;
    if (hasDup) {
      // Duplicate casing (most expensive sub-component)
      let dupCasing = casing * 0.50;
      val = (dupCasing + supercon + electro) * 2.50;
      ores = 8; // saved ~2 ores from casing dup
    } else {
      val = (casing + supercon + electro) * 2.50;
      ores = 10;
    }
    if (hasQA) val *= 1.20;
    val = this.applySeller(val);
    val += this.nanoBonus() * ores;
    return { value: val, oresNeeded: ores };
  }

  calcExplosives(oreValue) {
    let bar = this.processBar(oreValue);
    let hasDup = this.prestigeItems.duplicator;
    let hasQA = this.budget >= 2000000;

    let casing = this.buildCasing(bar);
    let powder = 3; // $2 base + 1 refiner pass

    let val, ores;
    if (hasDup) {
      let dupCasing = casing * 0.50;
      val = dupCasing * powder;
      ores = 3;
    } else {
      val = casing * powder;
      ores = 5;
    }
    if (hasQA) val *= 1.20;
    val = this.applySeller(val);
    val += this.nanoBonus() * ores;
    return { value: val, oresNeeded: ores };
  }

  // === MAIN: Get best chains for an ore ===
  getBestChain(ore, budget) {
    const results = [];
    const oreValue = this.getEffectiveOreValue(ore);
    const wasUpgraded = oreValue !== ore.value;

    // Build label suffixes based on active prestige items
    const tags = [];
    if (wasUpgraded) tags.push("Upgraded");
    if (this.prestigeItems.transmuters) tags.push("Transmute");
    if (this.prestigeItems.duplicator) tags.push("Dup");
    if (this.prestigeItems.philosophersStone) tags.push("Infused");
    const suffix = tags.length ? " [" + tags.join(", ") + "]" : "";

    // Direct sell
    let directVal = this.applySeller(oreValue);
    results.push({ chain: "Direct Sell" + suffix, value: directVal, cost: 0, perOre: directVal, oresNeeded: 1 });

    // Simple bar processing (best available pipeline)
    if (budget >= 710) {
      const r = this.calcSimpleBar(oreValue);
      let label = "Processed Bar";
      if (budget >= 2000000) label += " + QA";
      results.push({ chain: label + suffix, value: r.value, cost: budget >= 2000000 ? 2050710 : 50710, perOre: r.value / r.oresNeeded, oresNeeded: r.oresNeeded });
    }

    // Multi-input chains
    const chains = [
      { name: "Engine", fn: "calcEngine", minBudget: 1200000 },
      { name: "Tablet", fn: "calcTablet", minBudget: 2600000 },
      { name: "Superconductor", fn: "calcSuperconductor", minBudget: 1200000 },
      { name: "Power Core", fn: "calcPowerCore", minBudget: 5700000 },
      { name: "Explosives", fn: "calcExplosives", minBudget: 2600000 },
    ];

    for (const c of chains) {
      if (budget >= c.minBudget) {
        const r = this[c.fn](oreValue);
        results.push({
          chain: c.name + suffix, value: r.value,
          cost: c.minBudget, perOre: r.value / r.oresNeeded, oresNeeded: r.oresNeeded,
        });
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
        "Buy Ore Smelter ($380) - 1.2x on ores",
        "Buy Iron Pickaxe ($500) - mine Cobalt/Aluminium",
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
        "Buy Optics Machine ($300K)",
        "Build ceramic casing: Dust → Clay → Ceramic ($150)",
      ]},
      { phase: "Phase 5: Mega Factories", budget: "$1M - $5M", time: "~25 min", actions: [
        "Buy Engine Factory ($1M) - 2.5x",
        "Buy Superconductor Constructor ($1M) - 3x",
        "Buy Infernum Pickaxe ($1M)",
        "Buy Output Belt 3 ($1M)",
        "Buy QA Machine ($2M) - +20% on finished products",
        "Buy Tablet Factory ($2.5M) - 3x",
        "Buy Laser Maker ($3.5M) - 2.75x",
        "Buy Power Core Assembler ($4.5M) - 2.5x",
      ]},
      { phase: "Phase 6: Push to Prestige", budget: "$5M - $20M", time: "~30 min", actions: [
        "Maximize throughput with parallel lines + all 4 output belts",
        "Use transmuter cross-chain for 1.61x bonus on bars",
        "Place duplicators on most expensive intermediates",
        "Loop items back through machines for extra multipliers",
        "Focus on Tablet (3x) or Superconductor (3x) chains",
        "Exa-Drill ($8M) for deep mining automation",
        "Reach $20M total earned to prestige!",
      ]},
    ];
  }
}
