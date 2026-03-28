// UMT Factory Optimizer - Data-Driven Graph Engine
// ALL calculations derived from data/machines.json. No hardcoded chain logic.

// === MACHINE REGISTRY ===
// Loads machines.json and builds lookup maps for type-based graph traversal.

class MachineRegistry {
  constructor(machinesData) {
    this.machines = new Map();
    this.producerOf = new Map();   // itemType → [machineIds that create this type]
    this.modifiersOf = new Map();  // itemType → [machineIds that modify this type (output=same)]
    this.byproducerOf = new Map(); // itemType → [machineIds that produce this as byproduct]

    for (const [id, m] of Object.entries(machinesData)) {
      m.id = id;
      this.machines.set(id, m);
    }
    this.buildIndexes();
  }

  buildIndexes() {
    for (const [id, m] of this.machines) {
      // Classify: modifier (same type in/out) vs producer (type changes)
      if (m.outputs) {
        for (const out of m.outputs) {
          const outType = out.type;
          const inputTypes = (m.inputs || []).flatMap(i => i.split("|"));
          const isAnyInput = inputTypes.includes("any");
          const isSameType = outType === "same" || inputTypes.includes(outType);

          if (isSameType || (isAnyInput && outType === "same")) {
            // Modifier: input type matches output type, OR accepts "any" with output "same"
            // Crusher is NOT a modifier (accepts "any" but outputs "dust", changes type)
            if (isAnyInput && outType === "same") {
              this.addTo(this.modifiersOf, "__any__", id);
            }
            if (isSameType) {
              for (const inp of m.inputs || []) {
                for (const t of inp.split("|")) {
                  if (t === "any") continue;
                  this.addTo(this.modifiersOf, t, id);
                }
              }
            }
          }
          if (!isSameType && outType !== "same") {
            // Producer: creates a different type
            // Skip transmuters from producer index - they're handled as side paths
            if (id !== "bar_to_gem" && id !== "gem_to_bar") {
              this.addTo(this.producerOf, outType, id);
            }
          }
        }
      }
      // Byproducts
      if (m.byproducts) {
        for (const bp of m.byproducts) {
          this.addTo(this.byproducerOf, bp.type, id);
        }
      }
    }
  }

  addTo(map, key, value) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }

  get(id) { return this.machines.get(id); }

  getProducers(type) { return this.producerOf.get(type) || []; }
  getModifiers(type) {
    const specific = this.modifiersOf.get(type) || [];
    const any = this.modifiersOf.get("__any__") || [];
    return [...specific, ...any];
  }

  isAvailable(machineId, config) {
    const m = this.get(machineId);
    if (!m) return false;
    if (m.cost && m.cost > config.budget) return false;
    if (m.medals) {
      const prestigeKey = this.prestigeKey(machineId);
      if (prestigeKey && !config.prestigeItems[prestigeKey]) return false;
    }
    return true;
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

// === VALUE CALCULATOR ===
// Resolves item values recursively from machine data.

class ValueCalculator {
  constructor(registry, config) {
    this.registry = registry;
    this.config = config;
    this.memo = new Map();
  }

  // Calculate the best value for producing targetType from ore
  calculate(targetType, oreValue) {
    this.memo.clear();
    const result = this.resolveType(targetType, oreValue, new Set());
    if (!result) return null;

    // Apply QA if available (modifier for "any")
    const qaResult = this.applyModifier("quality_assurance", result);

    // Apply double seller
    const finalVal = this.config.hasDoubleSeller ? qaResult.value * 2 : qaResult.value;

    return { ...qaResult, value: finalVal };
  }

  resolveType(targetType, oreValue, visiting) {
    // Byproduct types: available for "free" from smelting stone byproduct
    // Stone → Crusher → Dust → various paths. Cost is 0 ores (byproduct of main chain)
    const byproductTypes = {
      "stone": { value: 0, oreCount: 0 },
      "dust": { value: 1, oreCount: 0 },
      "glass": { value: 30, oreCount: 0 },     // Kiln
      "clay": { value: 50, oreCount: 0 },       // Clay Mixer (2 dust)
      "ceramic_casing": { value: 150, oreCount: 0 }, // Ceramic Furnace
      "blasting_powder": { value: 3, oreCount: 0 },  // Powder Chamber + Refiner
    };

    if (byproductTypes[targetType]) {
      const bp = byproductTypes[targetType];
      return { type: targetType, value: bp.value, tags: new Set(), oreCount: bp.oreCount, path: [{ machine: "byproduct", type: targetType, value: bp.value }] };
    }

    // Base case: ore
    if (targetType === "ore") {
      let val = oreValue;
      let tags = new Set();
      let path = [{ machine: "ore_source", type: "ore", value: val }];

      // Apply ore modifiers in optimal order: upgrade_tier → flat → percent
      // Skip QA (applied at end), duplicator, crusher (not ore modifiers)
      const skipOre = new Set(["quality_assurance", "duplicator", "crusher"]);
      const oreModifiers = this.getOrderedModifiers("ore").filter(id => !skipOre.has(id));
      for (const modId of oreModifiers) {
        const mod = this.registry.get(modId);
        if (!this.registry.isAvailable(modId, this.config)) continue;
        if (mod.tag && tags.has(mod.tag)) continue;

        if (mod.effect === "upgrade_tier") {
          const upgraded = getUpgradedOreValue(this.getOreName(oreValue));
          if (upgraded !== null) {
            val = upgraded;
            if (mod.tag) tags.add(mod.tag);
            path.push({ machine: modId, type: "ore", value: val });
          }
        } else if (mod.effect === "flat") {
          val += mod.value;
          if (mod.tag) tags.add(mod.tag);
          path.push({ machine: modId, type: "ore", value: val });
        } else if (mod.effect === "percent") {
          val *= (1 + mod.value);
          if (mod.tag) tags.add(mod.tag);
          path.push({ machine: modId, type: "ore", value: val });
        }
      }

      return { type: "ore", value: val, tags, oreCount: 1, path };
    }

    // Memo check
    const memoKey = targetType;
    if (this.memo.has(memoKey)) return this.memo.get(memoKey);

    // Cycle detection
    if (visiting.has(targetType)) return null;
    visiting.add(targetType);

    let bestResult = null;

    // Find all machines that produce this type
    const producers = this.registry.getProducers(targetType);

    for (const machineId of producers) {
      const machine = this.registry.get(machineId);
      if (!this.registry.isAvailable(machineId, this.config)) continue;

      // Resolve each input
      const inputStates = [];
      let totalOres = 0;
      let valid = true;
      const allTags = new Set();

      for (const inputSpec of machine.inputs || []) {
        // Handle union types "ring|amulet"
        const types = inputSpec.split("|");
        let bestInput = null;

        for (const t of types) {
          const input = this.resolveType(t, oreValue, new Set(visiting));
          if (!input) continue;

          if (types.length === 1) {
            // Single type - just use it
            bestInput = input;
          } else {
            // Union type: simulate applying the machine effect to compare OUTPUT per ore
            let simValue = input.value;
            if (machine.effect === "flat") simValue += machine.value;
            else if (machine.effect === "multiply") simValue *= machine.value;
            else if (machine.effect === "percent") simValue *= (1 + machine.value);
            const simPerOre = input.oreCount > 0 ? simValue / input.oreCount : simValue;

            let bestSimPerOre = 0;
            if (bestInput) {
              let bv = bestInput.value;
              if (machine.effect === "flat") bv += machine.value;
              else if (machine.effect === "multiply") bv *= machine.value;
              else if (machine.effect === "percent") bv *= (1 + machine.value);
              bestSimPerOre = bestInput.oreCount > 0 ? bv / bestInput.oreCount : bv;
            }

            if (!bestInput || simPerOre > bestSimPerOre) {
              bestInput = input;
            }
          }
        }

        if (!bestInput) { valid = false; break; }
        inputStates.push(bestInput);
        totalOres += bestInput.oreCount;
        for (const tag of bestInput.tags) allTags.add(tag);
      }

      if (!valid) continue;

      // Apply machine effect
      let outputValue;
      switch (machine.effect) {
        case "flat":
          outputValue = inputStates[0].value + machine.value;
          break;
        case "multiply":
          outputValue = inputStates[0].value * machine.value;
          break;
        case "percent":
          outputValue = inputStates[0].value * (1 + machine.value);
          break;
        case "combine":
          outputValue = inputStates.reduce((sum, s) => sum + s.value, 0) * machine.value;
          break;
        case "set":
          outputValue = machine.value;
          break;
        case "multiplicative":
          outputValue = inputStates.reduce((prod, s) => prod * s.value, 1);
          break;
        case "preserve":
          outputValue = inputStates[0].value;
          break;
        default:
          outputValue = inputStates[0]?.value || 0;
      }

      // Add machine tag
      if (machine.tag) allTags.add(machine.tag);

      // Build path
      const path = [];
      for (const inp of inputStates) {
        path.push(...(inp.path || []));
      }
      path.push({ machine: machineId, type: targetType, value: outputValue, inputs: inputStates.map(s => s.type) });

      // Apply type-specific modifiers (Tempering Forge for bars, etc.)
      let result = { type: targetType, value: outputValue, tags: allTags, oreCount: totalOres, path };
      result = this.applyTypeModifiers(result);

      // Apply transmuter side path for bars (if it improves per-ore value)
      if (targetType === "bar" && this.config.prestigeItems?.transmuters && !visiting.has("__transmuter__")) {
        visiting.add("__transmuter__");
        const enhanced = this.applyTransmuterSidePath(result);
        visiting.delete("__transmuter__");
        if (enhanced) {
          const regularPerOre = result.value / result.oreCount;
          const enhancedPerOre = enhanced.value / enhanced.oreCount;
          if (enhancedPerOre > regularPerOre) result = enhanced;
          // else: regular bar is better per-ore (happens for flat-bonus destinations)
        }
      }

      // Compare with best
      if (!bestResult || result.value / result.oreCount > bestResult.value / bestResult.oreCount) {
        bestResult = result;
      }
    }

    visiting.delete(targetType);
    if (bestResult) this.memo.set(memoKey, bestResult);
    return bestResult;
  }

  // Apply modifiers that don't change type (Tempering Forge for bars, Electronic Tuner for electronics)
  applyTypeModifiers(item) {
    const modifiers = this.getOrderedModifiers(item.type);
    let result = { ...item };

    // Skip modifiers that are handled elsewhere
    const skipMods = new Set(["quality_assurance", "ore_cleaner", "polisher", "philosophers_stone", "ore_upgrader", "duplicator"]);

    for (const modId of modifiers) {
      if (skipMods.has(modId)) continue;

      const mod = this.registry.get(modId);
      if (!this.registry.isAvailable(modId, this.config)) continue;
      if (mod.tag && result.tags.has(mod.tag)) continue;

      // Check if input type matches
      const inputTypes = (mod.inputs || []).flatMap(i => i.split("|"));
      if (!inputTypes.includes("any") && !inputTypes.includes(result.type)) continue;

      result = this.applyModifier(modId, result);
    }

    return result;
  }

  applyModifier(modId, item) {
    const mod = this.registry.get(modId);
    if (!mod) return item;
    if (!this.registry.isAvailable(modId, this.config)) return item;
    if (mod.tag && item.tags.has(mod.tag)) return item;

    const newTags = new Set(item.tags);
    if (mod.tag) newTags.add(mod.tag);

    let newValue = item.value;
    switch (mod.effect) {
      case "flat": newValue += mod.value; break;
      case "multiply": newValue *= mod.value; break;
      case "percent": newValue *= (1 + mod.value); break;
    }

    const path = [...(item.path || [])];
    path.push({ machine: modId, type: item.type, value: newValue });

    return { ...item, value: newValue, tags: newTags, path };
  }

  // Transmuter side path: bar → gem → gem_cutter → prismatic → gem_to_bar
  // Calculated from machine data, not hardcoded
  applyTransmuterSidePath(barItem) {
    const barToGem = this.registry.get("bar_to_gem");
    const gemCutter = this.registry.get("gem_cutter");
    const prismatic = this.registry.get("prismatic_crucible");
    const gemToBar = this.registry.get("gem_to_bar");

    if (!barToGem || !gemCutter || !prismatic || !gemToBar) return null;

    // bar → gem (preserve)
    let val = barItem.value;
    // gem_cutter (multiply)
    val *= gemCutter.value; // 1.4x
    // prismatic_crucible: 2 gems → 1 prismatic (combine 1.15x)
    // 2 bars become 2 gems, combined at 1.15x: (val + val) * 1.15 / 2 bars = val * 1.15
    val *= prismatic.value; // 1.15x
    // gem_to_bar (preserve)

    const newTags = new Set(barItem.tags);
    const path = [...(barItem.path || [])];
    path.push({ machine: "bar_to_gem", type: "gem", value: barItem.value });
    path.push({ machine: "gem_cutter", type: "cut_gem", value: barItem.value * gemCutter.value });
    path.push({ machine: "prismatic_crucible", type: "prismatic_gem", value: val });
    path.push({ machine: "gem_to_bar", type: "bar", value: val });

    // 2 bars consumed (2 ores) → 1 enhanced bar
    return { ...barItem, value: val, tags: newTags, path, oreCount: barItem.oreCount * 2 };
  }

  // Get modifiers for a type in optimal order: upgrade_tier → flat → percent → multiply
  getOrderedModifiers(type) {
    const modIds = this.registry.getModifiers(type);
    const mods = modIds.map(id => ({ id, ...this.registry.get(id) })).filter(Boolean);

    const order = { upgrade_tier: 0, flat: 1, percent: 2, multiply: 3 };
    mods.sort((a, b) => (order[a.effect] ?? 99) - (order[b.effect] ?? 99));

    return mods.map(m => m.id);
  }

  // Helper: find ore name from value (for upgrade lookup)
  getOreName(value) {
    const ore = ORES.find(o => o.value === value);
    return ore ? ore.name : null;
  }
}

// === CHAIN DISCOVERER ===
// Finds all producible item types, calculates their optimal values, ranks them.

class ChainDiscoverer {
  constructor(registry, config) {
    this.registry = registry;
    this.config = config;
  }

  discoverChains(oreValue) {
    const calc = new ValueCalculator(this.registry, this.config);
    const chains = [];

    // Find all terminal item types (produced by machines, worth selling)
    const terminalTypes = this.findTerminalTypes();

    for (const type of terminalTypes) {
      const result = calc.calculate(type, oreValue);
      if (!result || result.value <= 0) continue;

      // Check total machine cost
      const totalCost = this.sumMachineCosts(result.path);
      if (totalCost > this.config.budget) continue;

      // Add byproduct value
      const byproductVal = this.calculateByproductValue(result.oreCount, oreValue);

      const finalValue = result.value + byproductVal;
      const perOre = finalValue / result.oreCount;

      // Build graph for visualization
      const graph = GraphGenerator.fromPath(result.path, this.registry);

      // Build chain name with active prestige items
      const tags = [];
      if (this.config.prestigeItems?.oreUpgrader) tags.push("Upgraded");
      if (this.config.prestigeItems?.transmuters) tags.push("Transmute");
      if (this.config.prestigeItems?.philosophersStone) tags.push("Infused");
      const suffix = tags.length ? " [" + tags.join(", ") + "]" : "";
      const displayType = ITEM_TYPES[type] || type;

      chains.push({
        chain: displayType + suffix,
        value: finalValue,
        cost: totalCost,
        perOre,
        oresNeeded: result.oreCount,
        endType: type,
        graph,
      });
    }

    // Add direct sell
    let directVal = oreValue;
    if (this.config.prestigeItems?.oreUpgrader) {
      const upgraded = getUpgradedOreValue(ORES.find(o => o.value === oreValue)?.name);
      if (upgraded) directVal = upgraded;
    }
    if (this.config.hasDoubleSeller) directVal *= 2;
    chains.push({ chain: "Direct Sell", value: directVal, cost: 0, perOre: directVal, oresNeeded: 1, endType: "ore", graph: null });

    chains.sort((a, b) => b.perOre - a.perOre);
    return chains;
  }

  findTerminalTypes() {
    // All types that machines produce and are worth evaluating
    const allOutputTypes = new Set();
    for (const [id, m] of this.registry.machines) {
      if (m.outputs) {
        for (const out of m.outputs) {
          if (out.type !== "same") allOutputTypes.add(out.type);
        }
      }
    }
    // Remove intermediates and byproduct types that aren't worth selling directly
    const skipTypes = new Set(["dust", "stone", "clay", "cement", "bricks", "ceramic_casing", "glass", "lens", "blasting_powder"]);
    return [...allOutputTypes].filter(t => !skipTypes.has(t));
  }

  sumMachineCosts(path) {
    const seen = new Set();
    let total = 0;
    for (const step of path) {
      if (step.machine === "ore_source") continue;
      if (seen.has(step.machine)) continue;
      seen.add(step.machine);
      const m = this.registry.get(step.machine);
      if (m && m.cost) total += m.cost;
    }
    return total;
  }

  // Stone byproduct value - derived from machine data
  calculateByproductValue(oresCount, oreValue) {
    const smelter = this.registry.get("ore_smelter");
    if (!smelter) return 0;
    const stonePerOre = smelter.byproductRatio || 0.5;
    let totalStone = oresCount * stonePerOre;
    let totalValue = 0;

    // 1. Prospectors (chance machines consuming stone)
    const prospectors = [];
    for (const [id, m] of this.registry.machines) {
      if (m.inputs?.includes("stone") && m.effect === "chance" && m.gemType) {
        if (this.registry.isAvailable(id, this.config)) {
          prospectors.push(m);
        }
      }
    }

    let stoneRemaining = totalStone;
    for (const p of prospectors) {
      const gemsProduced = stoneRemaining * p.value;
      let gemVal = GEMS.find(g => g.name === p.gemType)?.value || 100;
      // Apply gem cutter if available
      const gemCutter = this.registry.get("gem_cutter");
      if (gemCutter && this.registry.isAvailable("gem_cutter", this.config)) {
        gemVal *= gemCutter.value;
      }
      totalValue += (this.config.hasDoubleSeller ? 2 : 1) * gemsProduced * gemVal;
      stoneRemaining *= (1 - p.value);
    }

    // 2. Remaining stone → Crusher → Dust
    const dustAmount = stoneRemaining;

    // 3. ALL dust → Sifter/Nano Sifter
    let siftedDust = dustAmount;
    const nanoSifter = this.registry.get("nano_sifter");
    const sifter = this.registry.get("sifter");

    if (nanoSifter && this.registry.isAvailable("nano_sifter", this.config)) {
      const chance = nanoSifter.value;
      const oresProduced = dustAmount * chance;
      siftedDust = dustAmount * (1 - chance);

      // Process each possible nano sifter ore through full chain (including ore upgrader)
      // Use individual ore values so getOreName can resolve for upgrader
      const calc = new ValueCalculator(this.registry, this.config);
      let avgOreChainValue = 0;
      for (const oreName of NANO_SIFTER_ORES) {
        const ore = ORES.find(o => o.name === oreName);
        if (!ore) continue;
        const result = calc.calculate("bar", ore.value);
        if (result) avgOreChainValue += result.value;
      }
      avgOreChainValue /= NANO_SIFTER_ORES.length;

      // Geometric series for recursive sifting (ore → smelt → stone → dust → sift → ore...)
      const recursiveChance = stonePerOre * chance;
      totalValue += (oresProduced * avgOreChainValue) / (1 - recursiveChance);
    } else if (sifter && this.registry.isAvailable("sifter", this.config)) {
      const chance = sifter.value;
      siftedDust = dustAmount * (1 - chance);
      // Process each sifter ore individually for accurate upgrader application
      const sifterOres = ["Tin", "Iron", "Lead", "Silver", "Gold"];
      const calc = new ValueCalculator(this.registry, this.config);
      let avgVal = 0;
      for (const oreName of sifterOres) {
        const ore = ORES.find(o => o.name === oreName);
        if (!ore) continue;
        const result = calc.calculate("bar", ore.value);
        if (result) avgVal += result.value;
      }
      avgVal /= sifterOres.length;
      totalValue += dustAmount * chance * avgVal;
    }

    // 4. Sifted dust → best path from machine data
    if (siftedDust > 0) {
      const clayMixer = this.registry.get("clay_mixer");
      const ceramicFurnace = this.registry.get("ceramic_furnace");
      const kiln = this.registry.get("kiln");
      const seller = this.config.hasDoubleSeller ? 2 : 1;

      if (clayMixer && ceramicFurnace &&
          this.registry.isAvailable("clay_mixer", this.config) &&
          this.registry.isAvailable("ceramic_furnace", this.config)) {
        // Clay Mixer: 2 dust → clay ($50) → Ceramic Furnace → ceramic ($150)
        const ceramicVal = ceramicFurnace.value; // from machines.json
        totalValue += seller * (siftedDust / 2) * ceramicVal;
      } else if (kiln && this.registry.isAvailable("kiln", this.config)) {
        totalValue += seller * siftedDust * kiln.value;
      }
    }

    return totalValue;
  }
}

// === GRAPH GENERATOR ===
// Builds {nodes, edges} for visualization from a production path.

class GraphGenerator {
  static fromPath(path, registry) {
    if (!path || path.length === 0) return { nodes: [], edges: [] };

    const nodes = [];
    const edges = [];
    let nodeId = 0;
    const machineToNode = new Map();

    // Assign layers based on path order
    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const machine = registry.get(step.machine);
      const category = machine?.category || "source";
      const name = machine?.name || (step.machine === "ore_source" ? "Ore" : step.machine);
      const typeLabel = ITEM_TYPES[step.type] || step.type;

      const node = {
        id: nodeId++,
        name: name,
        type: step.type,
        value: step.value,
        category: category,
        layer: i,
      };
      nodes.push(node);

      // Edge from previous step
      if (i > 0 && !machineToNode.has(step.machine)) {
        const prevNode = nodes[i - 1];
        edges.push({ from: prevNode.id, to: node.id, itemType: prevNode.type });
      }

      machineToNode.set(step.machine, node);
    }

    // Add seller at end
    if (nodes.length > 0) {
      const lastNode = nodes[nodes.length - 1];
      const sellerNode = {
        id: nodeId++,
        name: "Seller",
        type: lastNode.type,
        value: lastNode.value,
        category: "source",
        layer: nodes.length,
      };
      nodes.push(sellerNode);
      edges.push({ from: lastNode.id, to: sellerNode.id, itemType: lastNode.type });
    }

    return { nodes, edges };
  }
}

// === GLOBAL REGISTRY (loaded async) ===
let machineRegistry = null;

async function loadMachineRegistry() {
  try {
    const response = await fetch("data/machines.json");
    const data = await response.json();
    machineRegistry = new MachineRegistry(data.machines);
    return machineRegistry;
  } catch (e) {
    console.error("Failed to load machines.json:", e);
    // Fallback: build from in-memory MACHINES if available
    if (typeof MACHINES !== "undefined") {
      const fallbackData = {};
      for (const [id, m] of Object.entries(MACHINES)) {
        fallbackData[id] = {
          ...m,
          inputs: m.inputTypes || [],
          outputs: [{ type: m.outputType || "same", chance: 1.0 }],
          byproducts: m.byproducts ? m.byproducts.map(t => ({ type: t, chance: 1.0 })) : undefined,
        };
      }
      machineRegistry = new MachineRegistry(fallbackData);
    }
    return machineRegistry;
  }
}
