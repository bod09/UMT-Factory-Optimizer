// UMT Factory Optimizer - Unified Flow Optimizer
// Replaces separate ValueCalculator + ChainDiscoverer + calculateByproductValue + optimizeDuplicators
// ONE system: every item finds its optimal destination, duplicator is just a flow node

class FlowOptimizer {
  constructor(registry, config) {
    this.registry = registry;
    this.config = config;
    this.memo = new Map(); // type → best value per unit
    this.flowMemo = new Map(); // type → full flow result
  }

  // Main entry: find all optimal chains for a given ore value
  // Returns array of { chain, totalValue, totalOres, perOre, flowGraph, dupAt }
  discoverAll(oreValue) {
    this.memo.clear();
    this.flowMemo.clear();

    // Phase 1: compute per-unit value for every item type (forward propagation)
    // Start from ore, propagate through all machines
    this.computeAllValues(oreValue);

    // Phase 2: for each terminal product, build the full flow with quantities
    const terminals = this.findTerminals();
    const results = [];

    for (const terminalType of terminals) {
      const flow = this.buildFlow(terminalType, oreValue);
      if (!flow || flow.totalOres <= 0) continue;

      // Check budget
      if (flow.totalCost > this.config.budget) continue;

      results.push(flow);
    }

    // Add direct sell
    const ds = this.config.hasDoubleSeller ? 2 : 1;
    let directVal = oreValue;
    if (this.config.prestigeItems?.oreUpgrader) {
      const upgraded = getUpgradedOreValue(ORES.find(o => o.value === oreValue)?.name);
      if (upgraded) directVal = upgraded;
    }
    results.push({
      chain: "Direct Sell",
      totalValue: directVal * ds,
      totalOres: 1,
      perOre: directVal * ds,
      endType: "ore",
      flowGraph: null,
      totalCost: 0,
    });

    results.sort((a, b) => b.perOre - a.perOre);
    return results;
  }

  // Phase 1: Compute the best value per unit for every producible item type
  // This is a forward propagation: ore → bar → plate → casing → engine...
  // Each type gets its best value considering ALL possible processing paths
  computeAllValues(oreValue) {
    // Start with ore processing
    this.getItemValue("ore", oreValue);
  }

  // Get the best value per unit for an item type
  // Memoized to avoid recomputation
  getItemValue(type, baseOreValue) {
    if (this.memo.has(type)) return this.memo.get(type);

    // Prevent infinite recursion
    this.memo.set(type, null); // placeholder

    let result;

    if (type === "ore") {
      result = this.computeOreValue(baseOreValue);
    } else if (type === "stone") {
      // Stone is free (byproduct of smelting)
      result = { value: 0, oreCount: 0, perOre: 0, machines: ["smelter_byproduct"], isByproduct: true };
    } else if (type === "dust") {
      // Dust comes from crushing stone (free)
      result = { value: 1, oreCount: 0, perOre: 0, machines: ["smelter_byproduct", "crusher"], isByproduct: true };
    } else {
      result = this.computeBestProduction(type, baseOreValue);
    }

    this.memo.set(type, result);
    return result;
  }

  // Compute ore value after all processing (upgrade, clean, polish, philo)
  computeOreValue(baseValue) {
    let val = baseValue;
    const machines = ["ore_source"];

    // Ore upgrader
    if (this.config.prestigeItems?.oreUpgrader) {
      const oreName = ORES.find(o => o.value === baseValue)?.name;
      if (oreName) {
        const upgraded = getUpgradedOreValue(oreName);
        if (upgraded !== null) {
          val = upgraded;
          machines.push("ore_upgrader");
        }
      }
    }

    // Apply ore modifiers in order: flat bonuses first, then percent
    const skipMods = new Set(["quality_assurance", "duplicator", "crusher"]);
    const modifiers = this.registry.getModifiers("ore").filter(id => !skipMods.has(id));

    // Sort: upgrade_tier first, then flat, then percent
    const sorted = modifiers.map(id => ({ id, ...this.registry.get(id) }))
      .filter(m => m && this.registry.isAvailable(m.id, this.config))
      .sort((a, b) => {
        const order = { upgrade_tier: 0, flat: 1, percent: 2, multiply: 3 };
        return (order[a.effect] || 99) - (order[b.effect] || 99);
      });

    for (const mod of sorted) {
      if (mod.effect === "upgrade_tier") continue; // already handled
      if (mod.effect === "flat") { val += mod.value; machines.push(mod.id); }
      else if (mod.effect === "percent") { val *= (1 + mod.value); machines.push(mod.id); }
    }

    return { value: val, oreCount: 1, perOre: val, machines };
  }

  // Find the best way to produce an item type
  // Considers ALL machines that can produce it
  computeBestProduction(targetType, baseOreValue) {
    const producers = this.registry.getProducers(targetType);
    let bestResult = null;

    for (const machineId of producers) {
      const machine = this.registry.get(machineId);
      if (!this.registry.isAvailable(machineId, this.config)) continue;

      // Resolve each input
      const inputResults = [];
      let totalOres = 0;
      let valid = true;

      for (const inputSpec of machine.inputs || []) {
        const types = inputSpec.split("|");
        let bestInput = null;

        for (const t of types) {
          const input = this.getItemValue(t, baseOreValue);
          if (!input || input.value === null) continue;

          // For union types: pick best output per ore after applying machine effect
          if (!bestInput) {
            bestInput = { ...input, resolvedType: t };
          } else {
            // Compare per-ore after effect
            const simA = this.simulateEffect(machine, bestInput.value);
            const simB = this.simulateEffect(machine, input.value);
            const perOreA = bestInput.oreCount > 0 ? simA / bestInput.oreCount : simA;
            const perOreB = input.oreCount > 0 ? simB / input.oreCount : simB;
            if (perOreB > perOreA) {
              bestInput = { ...input, resolvedType: t };
            }
          }
        }

        if (!bestInput) { valid = false; break; }
        inputResults.push(bestInput);
        totalOres += bestInput.oreCount;
      }

      if (!valid || inputResults.length === 0) continue;

      // Apply machine effect
      let outputValue = this.applyMachineEffect(machine, inputResults);

      // Apply type-specific modifiers for the OUTPUT type
      // Skip modifiers that accept any INPUT type that was already in the inputs
      // (prevents re-applying tempering_forge to alloy_bar when bars were already tempered)
      const inputTypes = new Set(inputResults.map(r => r.resolvedType || ''));
      outputValue = this.applyModifiers(targetType, outputValue, inputTypes);

      // Apply transmuter side path for bars
      if (targetType === "bar" && this.config.prestigeItems?.transmuters) {
        const enhanced = this.computeTransmuterValue(outputValue);
        if (enhanced !== null) {
          const enhancedPerOre = enhanced.value / (totalOres * 2);
          const regularPerOre = outputValue / totalOres;
          if (enhancedPerOre > regularPerOre) {
            outputValue = enhanced.value;
            totalOres *= 2;
          }
        }
      }

      const perOre = totalOres > 0 ? outputValue / totalOres : outputValue;

      if (!bestResult || perOre > bestResult.perOre) {
        bestResult = {
          value: outputValue,
          oreCount: totalOres,
          perOre,
          machine: machineId,
          inputs: inputResults,
        };
      }
    }

    return bestResult;
  }

  // Simulate machine effect on a value (for union type comparison)
  simulateEffect(machine, inputValue) {
    switch (machine.effect) {
      case "flat": return inputValue + machine.value;
      case "multiply": return inputValue * machine.value;
      case "percent": return inputValue * (1 + machine.value);
      case "set": return machine.value;
      default: return inputValue;
    }
  }

  // Apply machine effect to compute output value
  applyMachineEffect(machine, inputResults) {
    switch (machine.effect) {
      case "flat": return inputResults[0].value + machine.value;
      case "multiply": return inputResults[0].value * machine.value;
      case "percent": return inputResults[0].value * (1 + machine.value);
      case "combine": return inputResults.reduce((s, r) => s + r.value, 0) * machine.value;
      case "set": return machine.value;
      case "preserve": return inputResults[0].value;
      case "multiplicative": return inputResults.reduce((p, r) => p * r.value, 1);
      default: return inputResults[0]?.value || 0;
    }
  }

  // Apply type modifiers (tempering forge, electronic tuner, etc.)
  // skipInputTypes: types that were already in the inputs (don't re-apply their modifiers)
  applyModifiers(type, value, skipInputTypes) {
    const skipMods = new Set(["quality_assurance", "ore_cleaner", "polisher", "philosophers_stone", "ore_upgrader", "duplicator", "crusher"]);
    const modifiers = this.registry.getModifiers(type).filter(id => !skipMods.has(id));

    for (const modId of modifiers) {
      const mod = this.registry.get(modId);
      if (!mod || !this.registry.isAvailable(modId, this.config)) continue;

      // Skip modifiers that also apply to input types (already applied in input chain)
      // e.g., tempering_forge accepts bar|alloy_bar - if input was "bar", skip for alloy_bar
      if (skipInputTypes && skipInputTypes.size > 0) {
        const modInputTypes = (mod.inputs || []).flatMap(i => i.split("|"));
        const alreadyApplied = modInputTypes.some(t => skipInputTypes.has(t));
        if (alreadyApplied && type !== modInputTypes[0]) continue;
        // But allow if the modifier is SPECIFICALLY for this output type
        // (e.g., electronic_tuner for electromagnet - electromagnet is in its input list)
        if (alreadyApplied && modInputTypes.includes(type)) {
          // This modifier is for THIS type specifically - allow it
        } else if (alreadyApplied) {
          continue;
        }
      }

      switch (mod.effect) {
        case "flat": value += mod.value; break;
        case "multiply": value *= mod.value; break;
        case "percent": value *= (1 + mod.value); break;
      }
    }
    return value;
  }

  // Compute transmuter side path value for a bar
  computeTransmuterValue(barValue) {
    const gemCutter = this.registry.get("gem_cutter");
    const prismatic = this.registry.get("prismatic_crucible");
    if (!gemCutter || !prismatic) return null;

    let val = barValue;
    val *= gemCutter.value; // 1.4x
    val *= prismatic.value; // 1.15x
    return { value: val };
  }

  // Find all terminal item types worth evaluating
  findTerminals() {
    const allOutputTypes = new Set();
    for (const [id, m] of this.registry.machines) {
      if (!m.outputs) continue;
      for (const out of m.outputs) {
        if (out.type && out.type !== "same") allOutputTypes.add(out.type);
      }
    }
    // Skip types that are only intermediates
    const skip = new Set(["stone", "ore"]);
    return [...allOutputTypes].filter(t => !skip.has(t));
  }

  // Phase 2: Build a complete flow for a terminal product
  // This traces the full production chain with quantities, byproducts, and duplicator
  buildFlow(terminalType, oreValue) {
    const ds = this.config.hasDoubleSeller ? 2 : 1;

    // Get the value chain for this terminal type
    const chainResult = this.getItemValue(terminalType, oreValue);
    if (!chainResult || chainResult.value <= 0) return null;

    // Apply QA
    let finalValue = chainResult.value;
    const qa = this.registry.get("quality_assurance");
    const qaMultiplier = (qa && this.registry.isAvailable("quality_assurance", this.config)) ? (1 + qa.value) : 1;
    finalValue *= qaMultiplier;
    finalValue *= ds;

    let totalOres = chainResult.oreCount;
    let dupAt = null;
    let productQty = 1;

    // Try duplicator at every point in the chain
    if (this.config.prestigeItems?.duplicator) {
      const dupResult = this.findBestDup(chainResult, terminalType, oreValue, qaMultiplier, ds);
      if (dupResult && dupResult.perOre > finalValue / totalOres) {
        finalValue = dupResult.totalValue;
        totalOres = dupResult.totalOres;
        dupAt = dupResult.dupAt;
        productQty = dupResult.productQty;
      }
    }

    // Add byproduct value
    const mainPerOre = totalOres > 0 ? finalValue / totalOres : 0;
    const bpValue = this.computeByproductFlow(totalOres, oreValue, mainPerOre);

    const totalValue = finalValue + bpValue.totalValue;
    const perOre = totalOres > 0 ? totalValue / totalOres : 0;

    // Build chain name
    const tags = [];
    if (this.config.prestigeItems?.oreUpgrader) tags.push("Upgraded");
    if (this.config.prestigeItems?.transmuters) tags.push("Transmute");
    if (this.config.prestigeItems?.philosophersStone) tags.push("Infused");
    if (dupAt) tags.push("Dup");
    const suffix = tags.length ? " [" + tags.join(", ") + "]" : "";
    const displayType = ITEM_TYPES[terminalType] || terminalType;

    return {
      chain: displayType + suffix,
      totalValue,
      totalOres,
      perOre,
      endType: terminalType,
      totalCost: this.sumCosts(chainResult),
      flowGraph: null, // TODO: build graph from flow data
      value: totalValue,
      oresNeeded: totalOres,
      cost: this.sumCosts(chainResult),
      dupAt,
      productQty,
    };
  }

  // === DUPLICATOR IN FLOW ===
  // The duplicator is just another option at each point in the chain.
  // For each item type in the chain, evaluate: "what if I duplicate here?"
  // 2 copies at 50% value → may help with flat bonuses or combiner inputs

  findBestDup(chainResult, terminalType, oreValue, qaMultiplier, ds) {
    const baseValue = chainResult.value * qaMultiplier * ds;
    const baseOres = chainResult.oreCount;
    const basePerOre = baseOres > 0 ? baseValue / baseOres : 0;

    let bestDup = null;

    // Strategy 1: Dup at ore level (before flat bonuses)
    // 2 ores at 50% → each gets +$10+$10 independently → gain extra flat bonuses
    const oreDupResult = this.tryDupAtOre(oreValue, chainResult, terminalType, qaMultiplier, ds);
    if (oreDupResult && oreDupResult.perOre > basePerOre) {
      bestDup = oreDupResult;
    }

    // Strategy 2: Dup at combiner inputs
    // For each combiner in the chain, try duplicating each input
    const combinerDups = this.tryDupAtCombiners(chainResult, terminalType, oreValue, qaMultiplier, ds);
    for (const dup of combinerDups) {
      if (dup.perOre > (bestDup?.perOre || basePerOre)) {
        bestDup = dup;
      }
    }

    return bestDup;
  }

  // Try duplicating at ore level: 2 copies at 50%, each gets flat bonuses independently
  tryDupAtOre(oreValue, chainResult, terminalType, qaMultiplier, ds) {
    // Compute ore value with dup: 2 copies at 50%
    let val = oreValue;

    // Ore upgrader
    if (this.config.prestigeItems?.oreUpgrader) {
      const oreName = ORES.find(o => o.value === oreValue)?.name;
      if (oreName) {
        const upgraded = getUpgradedOreValue(oreName);
        if (upgraded !== null) val = upgraded;
      }
    }

    // Dup: 50% value
    val *= 0.5;

    // Apply flat and percent modifiers to each copy
    const skipMods = new Set(["quality_assurance", "duplicator", "crusher"]);
    const modifiers = this.registry.getModifiers("ore").filter(id => !skipMods.has(id));
    const sorted = modifiers.map(id => ({ id, ...this.registry.get(id) }))
      .filter(m => m && this.registry.isAvailable(m.id, this.config))
      .sort((a, b) => {
        const order = { upgrade_tier: 0, flat: 1, percent: 2 };
        return (order[a.effect] || 99) - (order[b.effect] || 99);
      });

    for (const mod of sorted) {
      if (mod.effect === "upgrade_tier") continue;
      if (mod.effect === "flat") val += mod.value;
      else if (mod.effect === "percent") val *= (1 + mod.value);
    }

    // Total from 2 copies per ore
    const dupOreValue = val * 2;

    // Recalculate chain with this new ore value
    // The ratio of dup ore value to normal ore value
    const normalOreResult = this.getItemValue("ore", oreValue);
    if (!normalOreResult || normalOreResult.value <= 0) return null;

    const ratio = dupOreValue / normalOreResult.value;
    // Scale the chain value by this ratio (all downstream multipliers preserve the ratio)
    const dupChainValue = chainResult.value * ratio * qaMultiplier * ds;
    const dupOres = chainResult.oreCount; // same ore count

    return {
      totalValue: dupChainValue,
      totalOres: dupOres,
      perOre: dupOres > 0 ? dupChainValue / dupOres : 0,
      dupAt: "ore (before flat bonuses)",
      productQty: 1,
    };
  }

  // Try duplicating at each combiner input in the chain
  tryDupAtCombiners(chainResult, terminalType, oreValue, qaMultiplier, ds) {
    const results = [];

    // Find the terminal machine (multi-input machine for the final product)
    if (!chainResult.machine) return results;
    const terminalMachine = this.registry.get(chainResult.machine);
    if (!terminalMachine) return results;
    // Must be a multi-input machine (combine, multiplicative, etc.)
    if (!terminalMachine.inputs || terminalMachine.inputs.length < 2) return results;

    // For each input to the combiner, try duplicating it
    const inputs = chainResult.inputs || [];
    for (let i = 0; i < inputs.length; i++) {
      const dupInput = inputs[i];
      if (!dupInput || dupInput.value <= 0) continue;

      // Dup this input: 2 copies at 50% value, need 2× of other inputs
      const dupInputValue = dupInput.value * 0.5;
      let otherInputOres = 0;

      // Calculate per-product value based on machine effect
      let perProduct;
      if (terminalMachine.effect === "combine") {
        let combineSum = dupInputValue;
        for (let j = 0; j < inputs.length; j++) {
          if (j === i) continue;
          combineSum += inputs[j].value;
          otherInputOres += inputs[j].oreCount;
        }
        perProduct = combineSum * terminalMachine.value;
      } else if (terminalMachine.effect === "multiplicative") {
        let product = dupInputValue;
        for (let j = 0; j < inputs.length; j++) {
          if (j === i) continue;
          product *= inputs[j].value;
          otherInputOres += inputs[j].oreCount;
        }
        perProduct = product;
      } else {
        // Generic multi-input: use applyMachineEffect with modified inputs
        const modInputs = inputs.map((inp, j) => j === i ? { ...inp, value: dupInputValue } : inp);
        perProduct = this.applyMachineEffect(terminalMachine, modInputs);
        for (let j = 0; j < inputs.length; j++) {
          if (j === i) continue;
          otherInputOres += inputs[j].oreCount;
        }
      }
      const products = 2; // 2 products from dup
      const totalOres = dupInput.oreCount + otherInputOres * products;

      // Apply QA and DS
      const totalValue = perProduct * products * qaMultiplier * ds;
      const perOre = totalOres > 0 ? totalValue / totalOres : 0;

      results.push({
        totalValue,
        totalOres,
        perOre,
        dupAt: (dupInput.resolvedType || dupInput.machine || 'input') + " in " + terminalType,
        productQty: products,
      });
    }

    // Also check nested combiners (e.g., dup casing inside electromagnet inside PC)
    // Recursively check each input that is itself a combiner
    for (const input of inputs) {
      if (!input.machine) continue;
      const inputMachine = this.registry.get(input.machine);
      if (!inputMachine || !inputMachine.inputs || inputMachine.inputs.length < 2) continue;

      const nestedDups = this.tryDupAtCombiners(input, input.resolvedType || '', oreValue, qaMultiplier, ds);
      for (const dup of nestedDups) {
        // Scale to account for this being just one input to the parent combiner
        // The gain from duplicating a nested input propagates through the parent combine
        const parentCombineValue = chainResult.value;
        const inputContribution = input.value / parentCombineValue;

        // New parent value: replace the original input value with the dup result
        const newInputValue = dup.totalValue / (qaMultiplier * ds * dup.productQty);
        const valueDiff = newInputValue - input.value;
        const newParentValue = (parentCombineValue + valueDiff * terminalMachine.value) * qaMultiplier * ds;
        const newTotalOres = chainResult.oreCount - input.oreCount + dup.totalOres;

        const perOre = newTotalOres > 0 ? newParentValue / newTotalOres : 0;

        results.push({
          totalValue: newParentValue,
          totalOres: newTotalOres,
          perOre,
          dupAt: dup.dupAt,
          productQty: 1, // nested dup doesn't double the parent
        });
      }
    }

    return results;
  }

  // Compute byproduct flow value
  // mainChainPerOre = opportunity cost of spending ores on the main chain
  computeByproductFlow(oreCount, oreValue, mainChainPerOre) {
    const smelter = this.registry.get("ore_smelter");
    if (!smelter) return { totalValue: 0, flows: [] };

    const ds = this.config.hasDoubleSeller ? 2 : 1;
    const stonePerOre = smelter.byproductRatio || 0.5;
    let totalStone = oreCount * stonePerOre;
    let totalValue = 0;
    const flows = [];

    // 1. Prospectors (stone → gems)
    let stoneRemaining = totalStone;
    for (const [id, m] of this.registry.machines) {
      if (!m.inputs?.includes("stone") || m.effect !== "chance" || !m.gemType) continue;
      if (!this.registry.isAvailable(id, this.config)) continue;

      const gemsProduced = stoneRemaining * (m.value || 0.05);
      const gemBaseVal = GEMS.find(g => g.name === m.gemType)?.value || 100;

      // Find best destination for this gem - including ore-costing chains
      const bestGemDest = this.findBestDestination("gem", gemBaseVal, mainChainPerOre);
      totalValue += gemsProduced * bestGemDest.valuePerUnit;
      flows.push({ machine: id, type: m.gemType, qty: gemsProduced, value: bestGemDest.valuePerUnit, dest: bestGemDest.dest });

      stoneRemaining *= (1 - (m.value || 0.05));
    }

    // 2. Remaining stone → crusher → dust
    const dustAmount = stoneRemaining;

    // 3. Dust → sifter
    let dustRemaining = dustAmount;
    let bestSifter = null;
    for (const [id, m] of this.registry.machines) {
      if (!m.inputs?.includes("dust")) continue;
      if (id !== "sifter" && id !== "nano_sifter") continue;
      if (!this.registry.isAvailable(id, this.config)) continue;
      if (!bestSifter || (m.value || 0) > (bestSifter.value || 0)) {
        bestSifter = { id, ...m };
      }
    }

    if (bestSifter) {
      const chance = bestSifter.byproductRatio || bestSifter.value || 0.1;
      const oresProduced = dustAmount * chance;
      dustRemaining = dustAmount * (1 - chance);

      // Sifted ores → find best terminal product (not just bar)
      const sifterOrePool = bestSifter.id === "nano_sifter" ? NANO_SIFTER_ORES : ["Tin", "Iron", "Lead", "Silver", "Gold"];
      let avgOreValue = 0;
      for (const oreName of sifterOrePool) {
        const ore = ORES.find(o => o.name === oreName);
        if (!ore) continue;
        // Find the best chain for this ore - use the main chain per-ore value
        // but cap at bar value to avoid recursive amplification
        const barResult = this.getItemValue("bar", ore.value);
        if (barResult) {
          let barVal = barResult.value;
          const qa = this.registry.get("quality_assurance");
          if (qa && this.registry.isAvailable("quality_assurance", this.config)) barVal *= (1 + qa.value);
          avgOreValue += barVal * ds;
        } else {
          avgOreValue += ore.value * ds;
        }
      }
      avgOreValue /= sifterOrePool.length;

      // Geometric series for recursive sifting
      const recursiveChance = stonePerOre * chance;
      totalValue += (oresProduced * avgOreValue) / (1 - recursiveChance);
      flows.push({ machine: bestSifter.id, type: "ore", qty: oresProduced, value: avgOreValue });
    }

    // 4. Remaining dust → find best destination
    if (dustRemaining > 0) {
      const bestDustDest = this.findBestDestination("dust", 1, mainChainPerOre);
      totalValue += dustRemaining * bestDustDest.valuePerUnit;
      flows.push({ machine: bestDustDest.dest, type: "dust", qty: dustRemaining, value: bestDustDest.valuePerUnit });
    }

    return { totalValue, flows };
  }

  // Find the best destination for a free item
  // Considers ALL machines that accept this type, including ones that need ores
  // mainChainPerOre = opportunity cost of spending ores
  findBestDestination(itemType, itemValue, mainChainPerOre) {
    const ds = this.config.hasDoubleSeller ? 2 : 1;
    let bestValue = itemValue * ds; // baseline: sell raw
    let bestDest = "sell";

    // Try all machines that accept this type
    for (const [machineId, m] of this.registry.machines) {
      if (!this.registry.isAvailable(machineId, this.config)) continue;
      if (machineId === "crusher" || machineId === "sifter" || machineId === "nano_sifter") continue;

      const acceptsItem = (m.inputs || []).some(inp =>
        inp === itemType || inp.split("|").includes(itemType) || inp === "any"
      );
      if (!acceptsItem) continue;

      let outputValue = 0;
      let extraOres = 0;

      if (m.inputs.length === 1) {
        // Single-input machine: apply effect directly
        outputValue = this.simulateEffect(m, itemValue) * ds;
      } else if (m.effect === "combine") {
        // Combiner: need other inputs from ores
        // The NET gain from using this free item is:
        // The free item's VALUE CONTRIBUTION to the combine × multiplier × QA × DS
        // minus the opportunity cost of ores spent on other inputs
        let otherInputsAvailable = true;
        for (const inputSpec of m.inputs) {
          const types = inputSpec.split("|");
          if (types.includes(itemType) || types.includes("any")) continue;
          // Need this input from ores
          const inputResult = this.getItemValue(types[0], mainChainPerOre / ds);
          if (!inputResult || inputResult.value === null) { otherInputsAvailable = false; break; }
          extraOres += inputResult.oreCount;
        }
        if (!otherInputsAvailable) continue;

        // The gain from the free item = its contribution × combine multiplier
        // Apply QA if available
        let freeItemGain = itemValue * m.value;
        const qa = this.registry.get("quality_assurance");
        if (qa && this.registry.isAvailable("quality_assurance", this.config)) {
          freeItemGain *= (1 + qa.value);
        }
        freeItemGain *= ds;
        outputValue = freeItemGain;
      } else {
        outputValue = this.simulateEffect(m, itemValue) * ds;
      }

      // Net value = gain from free item - opportunity cost of any extra ores spent
      const netValue = outputValue - (extraOres * mainChainPerOre);

      if (netValue > bestValue) {
        bestValue = netValue;
        bestDest = machineId;
      }
    }

    return { valuePerUnit: bestValue, dest: bestDest };
  }

  // Sum machine costs for a chain result
  sumCosts(chainResult) {
    if (!chainResult) return 0;
    let total = 0;
    const counted = new Set();

    const countMachine = (result) => {
      if (!result) return;
      if (result.machine && !counted.has(result.machine)) {
        counted.add(result.machine);
        const m = this.registry.get(result.machine);
        if (m?.cost) total += m.cost;
      }
      if (result.inputs) {
        for (const inp of result.inputs) countMachine(inp);
      }
      // Also count machines from the machines list
      if (result.machines) {
        for (const mid of result.machines) {
          if (!counted.has(mid) && mid !== "ore_source" && mid !== "smelter_byproduct") {
            counted.add(mid);
            const m = this.registry.get(mid);
            if (m?.cost) total += m.cost;
          }
        }
      }
    };
    countMachine(chainResult);
    return total;
  }
}
