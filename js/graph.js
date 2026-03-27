// UMT Factory Optimizer - Machine Graph & Path Discovery Engine
// Builds a directed graph from machine definitions and finds optimal production paths.

class MachineGraph {
  constructor(machines, config = {}) {
    this.machines = machines;
    this.config = config; // { budget, prestigeItems, hasDoubleSeller }
    // Maps: itemType → { producers: [machineId], consumers: [machineId] }
    this.typeGraph = new Map();
    this.build();
  }

  build() {
    this.typeGraph.clear();
    const ensure = (type) => {
      if (!this.typeGraph.has(type)) this.typeGraph.set(type, { producers: [], consumers: [] });
    };

    for (const [id, m] of Object.entries(this.machines)) {
      // Skip machines we can't afford or don't have medals for
      if (m.cost !== null && m.cost > (this.config.budget || Infinity)) continue;
      if (m.medals && !this.config.prestigeItems?.[this.prestigeKey(id)]) continue;

      // Register outputs
      const outType = m.outputType === "same" ? null : m.outputType;
      if (outType) {
        ensure(outType);
        this.typeGraph.get(outType).producers.push(id);
      }

      // Register inputs
      for (const inType of m.inputTypes || []) {
        if (inType === "any") continue;
        // Handle union types like "ring|amulet"
        for (const t of inType.split("|")) {
          ensure(t);
          this.typeGraph.get(t).consumers.push(id);
        }
      }

      // Register byproducts
      if (m.byproducts) {
        for (const bp of m.byproducts) {
          ensure(bp);
          this.typeGraph.get(bp).producers.push(id + "_byproduct");
        }
      }
    }
  }

  prestigeKey(machineId) {
    const map = {
      philosophers_stone: "philosophersStone",
      nano_sifter: "nanoSifter",
      ore_upgrader: "oreUpgrader",
      gem_to_bar: "transmuters",
      bar_to_gem: "transmuters",
      duplicator: "duplicator",
    };
    return map[machineId] || null;
  }
}

// === PATH FINDER ===
// Discovers all valid production paths from ore to sellable end-products.
// Uses pre-defined chain templates (more reliable than pure graph traversal
// for a game with specific machine interactions and tag rules).

class PathFinder {
  constructor(config = {}) {
    this.budget = config.budget || 1000000;
    this.prestigeItems = config.prestigeItems || {};
    this.hasDoubleSeller = config.hasDoubleSeller || false;
  }

  configure(config) {
    this.budget = config.budget || 1000000;
    this.prestigeItems = config.prestigeItems || {};
    this.hasDoubleSeller = config.hasDoubleSeller || false;
  }

  // === CORE VALUE HELPERS ===

  applySeller(v) { return this.hasDoubleSeller ? v * 2 : v; }

  transmuterMult() { return this.prestigeItems.transmuters ? 1.61 : 1; }

  getEffectiveOreValue(ore) {
    if (this.prestigeItems.oreUpgrader) {
      const upgraded = getUpgradedOreValue(ore.name);
      if (upgraded !== null) return upgraded;
    }
    return ore.value;
  }

  // Full bar processing: Clean → Polish → Infuse → Smelt → Temper → Transmuter side path
  processBar(oreVal) {
    let v = oreVal + 10 + 10; // clean + polish
    if (this.prestigeItems.philosophersStone) v *= 1.25;
    v *= 1.20; // smelt
    v *= 2.00; // temper
    v *= this.transmuterMult(); // side path
    return v;
  }

  // Duplicate ore: 2 copies at 50%, each gets flat bonuses independently
  processDupOre(oreVal) {
    let half = oreVal * 0.50;
    let perCopy = half + 10 + 10;
    if (this.prestigeItems.philosophersStone) perCopy *= 1.25;
    perCopy *= 1.20 * 2.00;
    perCopy *= this.transmuterMult();
    return perCopy * 2;
  }

  // Nano Sifter: ores go through Ore Upgrader (if owned) → full processing chain
  // Recursive: each bonus ore also produces stone → more bonus ores (geometric series)
  nanoBonus() {
    if (!this.prestigeItems.nanoSifter) return 0;
    const chance = 0.5 * 0.166; // 0.5 stone per smelt, 16.6% chance ore

    // Calculate average value of nano sifter ores AFTER upgrading
    let avgVal = 0;
    for (const oreName of NANO_SIFTER_ORES) {
      let val = ORES.find(o => o.name === oreName)?.value || 0;
      // Apply Ore Upgrader if owned
      if (this.prestigeItems.oreUpgrader) {
        const upgraded = getUpgradedOreValue(oreName);
        if (upgraded !== null) val = upgraded;
      }
      avgVal += val;
    }
    avgVal /= NANO_SIFTER_ORES.length;

    const bonusVal = this.applySeller(this.processBar(avgVal));
    return (chance * bonusVal) / (1 - chance);
  }

  // Electronic Tuner: +$50 on electronics items
  tunerBonus(itemType) {
    if (this.budget < 8500) return 0;
    if (ELECTRONIC_TYPES.includes(itemType)) return 50;
    return 0;
  }

  // Build casing from bar
  buildCasing(barVal) {
    let bolts = barVal + 5;
    let plate = barVal + 20;
    let frame = (barVal + bolts) * 1.25;
    return (frame + bolts + plate) * 1.30;
  }

  // === CHAIN DEFINITIONS ===
  // Each returns { name, value, oresNeeded, cost, graph (node/edge structure) }

  getAllChains(oreVal) {
    const chains = [];
    const bar = this.processBar(oreVal);
    const hasDup = this.prestigeItems.duplicator;
    const hasQA = this.budget >= 2000000;
    const nano = this.nanoBonus();

    // Helper: apply final modifiers
    const finish = (val, type, ores) => {
      val += this.tunerBonus(type);
      if (hasQA) val *= 1.20;
      val = this.applySeller(val);
      val += nano * ores;
      return val;
    };

    // Helper: try dup on intermediate, return best option
    const bestDup = (noDupVal, noDupOres, dupVal, dupOres) => {
      if (!hasDup) return { val: noDupVal, ores: noDupOres, dup: false };
      const noDupPerOre = noDupVal / noDupOres;
      const dupPerOre = dupVal / dupOres;
      if (dupPerOre > noDupPerOre) return { val: dupVal, ores: dupOres, dup: true };
      return { val: noDupVal, ores: noDupOres, dup: false };
    };

    // 1. PROCESSED BAR (simple sell)
    if (this.budget >= 710) {
      let noDupVal = finish(bar, "bar", 1);
      let dupVal = hasDup ? finish(this.processDupOre(oreVal), "bar", 1) : 0;
      let best = bestDup(noDupVal, 1, dupVal, 1);
      chains.push(this.makeChain("Processed Bar", best.val, best.ores, 50710, "bar", bar, oreVal, best.dup));
    }

    // 2. ENGINE: mech_parts + pipe + casing → 2.5x
    if (this.budget >= 1200000) {
      let plate = bar + 20;
      let mech = plate + 30, pipe = plate + 20;
      let casing = this.buildCasing(bar);
      let engineVal = (mech + pipe + casing) * 2.50;
      // Dup casing: batch 4(casing) + 2*(1 mech + 1 pipe) = 8 → 2 engines
      let dupEngVal = (mech + pipe + casing * 0.5) * 2.50;
      let noDup = finish(engineVal, "engine", 5);
      let dup = hasDup ? finish(dupEngVal, "engine", 4) : 0;
      let best = bestDup(noDup, 5, dup, 4);
      chains.push(this.makeChain("Engine", best.val, best.ores, 1200000, "engine", engineVal, oreVal, best.dup));
    }

    // 3. TABLET: casing + glass + circuit → 3x
    if (this.budget >= 2600000) {
      let casing = this.buildCasing(bar);
      let glass = 30, coil = bar + 20;
      let circuit = (glass + coil) * 2.00 + this.tunerBonus("circuit");
      let tabletVal = (casing + glass + circuit) * 3.00;
      // Dup casing: batch 4 + 1*2 = 6 → 2 tablets
      let dupTabVal = (casing * 0.5 + glass + circuit) * 3.00;
      let noDup = finish(tabletVal, "tablet", 5);
      let dup = hasDup ? finish(dupTabVal, "tablet", 3) : 0;
      let best = bestDup(noDup, 5, dup, 3);
      chains.push(this.makeChain("Tablet", best.val, best.ores, 2600000, "tablet", tabletVal, oreVal, best.dup));
    }

    // 4. SUPERCONDUCTOR: alloy + ceramic → 3x
    if (this.budget >= 1200000) {
      let alloy = (bar + bar) * 1.20;
      let ceramic = 150;
      let superVal = (alloy + ceramic) * 3.00;
      // Dup alloy: batch 2 → 2 supers
      let dupSuperVal = (alloy * 0.5 + ceramic) * 3.00;
      let noDup = finish(superVal, "superconductor", 2);
      let dup = hasDup ? finish(dupSuperVal, "superconductor", 1) : 0;
      let best = bestDup(noDup, 2, dup, 1);
      chains.push(this.makeChain("Superconductor", best.val, best.ores, 1200000, "superconductor", superVal, oreVal, best.dup));
    }

    // 5. POWER CORE: casing + superconductor + electromagnet → 2.5x
    if (this.budget >= 5700000) {
      let casing = this.buildCasing(bar);
      let alloy = (bar + bar) * 1.20;
      let supercon = (alloy + 150) * 3.00;
      let coil = bar + 20;
      let electro = (coil + this.buildCasing(bar)) * 1.50 + this.tunerBonus("electromagnet");
      let pcVal = (casing + supercon + electro) * 2.50;
      // Dup casing: batch 4 + (2+5)*2 = 18 → 2 PCs
      let dupPcVal = (casing * 0.5 + supercon + electro) * 2.50;
      let noDup = finish(pcVal, "power_core", 11);
      let dup = hasDup ? finish(dupPcVal, "power_core", 9) : 0;
      let best = bestDup(noDup, 11, dup, 9);
      chains.push(this.makeChain("Power Core", best.val, best.ores, 5700000, "power_core", pcVal, oreVal, best.dup));
    }

    // 6. EXPLOSIVES: casing × powder → multiplicative
    if (this.budget >= 2600000) {
      let casing = this.buildCasing(bar);
      let powder = 3;
      let expVal = casing * powder;
      // Dup casing: batch 4 → 2 explosives (powder free from dust)
      let dupExpVal = casing * 0.5 * powder;
      let noDup = finish(expVal, "explosives", 5);
      let dup = hasDup ? finish(dupExpVal, "explosives", 2) : 0;
      let best = bestDup(noDup, 5, dup, 2);
      chains.push(this.makeChain("Explosives", best.val, best.ores, 2600000, "explosives", expVal, oreVal, best.dup));
    }

    // 7. LASER: optic + gem + circuit → 2.75x
    if (this.budget >= 3800000) {
      let glass = 30;
      let lens = glass + 50;
      let plate = bar + 20;
      let pipe = plate + 20;
      let optic = (lens + pipe) * 1.25;
      let coil = bar + 20;
      let circuit = (glass + coil) * 2.00 + this.tunerBonus("circuit");
      // Gem value: use average gem at depth, or use transmuted bar value
      let gemVal = this.prestigeItems.transmuters ? bar : 500; // avg gem fallback
      let laserVal = (optic + gemVal + circuit) * 2.75;
      let noDup = finish(laserVal, "laser", 4);
      chains.push(this.makeChain("Laser", noDup, 4, 3800000, "laser", laserVal, oreVal, false));
    }

    // 8. AMULET: ring + frame + prismatic → 2x
    if (this.budget >= 2100000) {
      let coil = bar + 20;
      let gemVal = this.prestigeItems.transmuters ? bar : 500;
      let ring = (gemVal + coil) * 1.70;
      let bolts = bar + 5;
      let frame = (bar + bolts) * 1.25;
      let prismatic = (gemVal + gemVal) * 1.15;
      let amuletVal = (ring + frame + prismatic) * 2.00;
      // Needs: 1 ore(coil) + 1 gem(ring) + 2 ore(frame) + 2 gems(prismatic) = 3 ores + 3 gems
      let ores = this.prestigeItems.transmuters ? 6 : 6; // 3 ores + 3 gems (gems from transmuted bars or mined)
      let noDup = finish(amuletVal, "amulet", ores);
      chains.push(this.makeChain("Amulet", noDup, ores, 2100000, "amulet", amuletVal, oreVal, false));
    }

    // 9. GILDED RING: filigree + ring → 1.5x
    if (this.budget >= 550000) {
      let plate = bar + 20;
      let filigree = plate * 1.20;
      let coil = bar + 20;
      let gemVal = this.prestigeItems.transmuters ? bar : 500;
      let ring = (gemVal + coil) * 1.70;
      let gildedVal = (filigree + ring) * 1.50;
      let ores = this.prestigeItems.transmuters ? 3 : 3;
      let noDup = finish(gildedVal, "gilded", ores);
      chains.push(this.makeChain("Gilded Ring", noDup, ores, 550000, "gilded", gildedVal, oreVal, false));
    }

    // 10. GILDED AMULET: filigree + amulet → 1.5x
    if (this.budget >= 2600000) {
      let plate = bar + 20;
      let filigree = plate * 1.20;
      let coil = bar + 20;
      let gemVal = this.prestigeItems.transmuters ? bar : 500;
      let ring = (gemVal + coil) * 1.70;
      let bolts = bar + 5;
      let frame = (bar + bolts) * 1.25;
      let prismatic = (gemVal + gemVal) * 1.15;
      let amuletVal = (ring + frame + prismatic) * 2.00;
      let gildedVal = (filigree + amuletVal) * 1.50;
      let ores = this.prestigeItems.transmuters ? 7 : 7;
      let noDup = finish(gildedVal, "gilded", ores);
      chains.push(this.makeChain("Gilded Amulet", noDup, ores, 2600000, "gilded", gildedVal, oreVal, false));
    }

    return chains;
  }

  // Build the graph structure for a chain (for SVG visualization)
  makeChain(name, value, oresNeeded, cost, endType, rawVal, oreVal, usesDup) {
    // Build active tags
    const tags = [];
    if (this.prestigeItems.oreUpgrader) tags.push("Upgraded");
    if (this.prestigeItems.transmuters) tags.push("Transmute");
    if (this.prestigeItems.philosophersStone) tags.push("Infused");
    if (usesDup) tags.push("Dup");
    const suffix = tags.length ? " [" + tags.join(", ") + "]" : "";

    // Build node graph for visualization
    const graph = this.buildChainGraph(name, oreVal, endType, usesDup);

    return {
      chain: name + suffix,
      value,
      cost,
      perOre: value / oresNeeded,
      oresNeeded,
      endType,
      usesDup,
      graph,
    };
  }

  // Generate the node/edge graph for SVG rendering
  buildChainGraph(chainName, oreVal, endType, usesDup) {
    const nodes = [];
    const edges = [];
    let id = 0;
    const bar = this.processBar(oreVal);

    const addNode = (name, type, value, category, layer) => {
      const n = { id: id++, name, type, value, category, layer };
      nodes.push(n);
      return n;
    };

    const addEdge = (from, to, itemType, dashed = false) => {
      edges.push({ from: from.id, to: to.id, itemType, dashed });
    };

    // Bar processing pipeline (shared by all chains)
    const oreNode = addNode("Ore", "ore", oreVal, "source", 0);
    let prevNode = oreNode;
    let currentVal = oreVal;

    if (this.prestigeItems.oreUpgrader) {
      currentVal = getUpgradedOreValue({ name: "placeholder", value: oreVal }?.name) || oreVal;
      // Actually use the effective value
      const n = addNode("Ore Upgrader", "ore", currentVal, "prestige", 1);
      addEdge(prevNode, n, "ore");
      prevNode = n;
    }

    currentVal += 10;
    const cleanNode = addNode("Ore Cleaner", "ore", currentVal, "metalwork", 2);
    addEdge(prevNode, cleanNode, "ore");

    currentVal += 10;
    const polishNode = addNode("Polisher", "ore", currentVal, "multipurpose", 3);
    addEdge(cleanNode, polishNode, "ore");
    prevNode = polishNode;

    if (this.prestigeItems.philosophersStone) {
      currentVal *= 1.25;
      const n = addNode("Philosopher's Stone", "ore", currentVal, "prestige", 4);
      addEdge(prevNode, n, "ore");
      prevNode = n;
    }

    currentVal *= 1.20;
    const smeltNode = addNode("Ore Smelter", "bar", currentVal, "metalwork", 5);
    addEdge(prevNode, smeltNode, "ore");

    // Stone byproduct
    const stoneNode = addNode("Stone (byproduct)", "stone", 0, "stonework", 5);
    addEdge(smeltNode, stoneNode, "stone", true);

    if (this.prestigeItems.nanoSifter) {
      const crushNode = addNode("Crusher", "dust", 1, "stonework", 6);
      addEdge(stoneNode, crushNode, "stone", true);
      const nanoNode = addNode("Nano Sifter (16.6%)", "ore", Math.round(this.nanoBonus()), "prestige", 7);
      addEdge(crushNode, nanoNode, "dust", true);
      // Route back: nano ore → Ore Upgrader (if owned) → Ore Cleaner → full chain
      if (this.prestigeItems.oreUpgrader) {
        // Find the upgrader node (layer 1)
        const upgraderNode = nodes.find(n => n.name === "Ore Upgrader");
        if (upgraderNode) addEdge(nanoNode, upgraderNode, "ore", true);
        else addEdge(nanoNode, cleanNode, "ore", true);
      } else {
        addEdge(nanoNode, cleanNode, "ore", true);
      }
    }

    currentVal *= 2.00;
    const temperNode = addNode("Tempering Forge", "bar", currentVal, "metalwork", 6);
    addEdge(smeltNode, temperNode, "bar");
    prevNode = temperNode;

    if (this.prestigeItems.transmuters) {
      currentVal *= 1.61; // side path result
      const sideStart = addNode("Bar→Gem Transmuter", "gem", currentVal / 1.61, "prestige", 7);
      addEdge(prevNode, sideStart, "bar");
      const cutNode = addNode("Gem Cutter", "cut_gem", currentVal / 1.15, "jewelcrafting", 8);
      addEdge(sideStart, cutNode, "gem");
      const prismNode = addNode("Prismatic Crucible", "prismatic_gem", currentVal, "jewelcrafting", 9);
      addEdge(cutNode, prismNode, "cut_gem");
      const sideEnd = addNode("Gem→Bar Transmuter", "bar", currentVal, "prestige", 10);
      addEdge(prismNode, sideEnd, "prismatic_gem");
      prevNode = sideEnd;
    }

    // Now add chain-specific nodes based on endType
    // (This gives the visualizer the complete graph)
    // The specific chain assembly nodes would be added here per chain type
    // For now, return the bar processing graph - chain-specific nodes TBD

    return { nodes, edges, barNode: prevNode, barValue: currentVal };
  }
}
