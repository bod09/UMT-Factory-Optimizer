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
  // Uses MULTI-PASS iterative resolution to discover convergent feedback loops:
  //   ore → furnace → stone → crush → dust → sift → ore (gambling/recycling)
  // Each pass uses previous pass values for cycle resolution.
  // Stops when values converge (< 1% change) or after maxPasses.
  computeAllValues(oreValue) {
    const maxPasses = 5;

    for (let pass = 0; pass < maxPasses; pass++) {
      const prevValues = new Map(
        [...this.memo.entries()].map(([k, v]) => [k, v?.value || 0])
      );

      // Clear memo for fresh computation, but keep previous values for cycle breaking
      this.prevPassValues = prevValues;
      this.memo.clear();
      this.currentPass = pass;

      // Compute all values: start from ore, then resolve ALL producible types
      this.getItemValue("ore", oreValue);
      // Trigger resolution of all types that machines can produce
      for (const [id, m] of this.registry.machines) {
        for (const output of m.outputs || []) {
          if (output.type && !this.memo.has(output.type)) {
            this.getItemValue(output.type, oreValue);
          }
        }
      }

      // Also compute the crush→sift reroll expected value
      this.crushRerollEV = this.computeCrushRerollEV(oreValue);

      // Check convergence: did any value change significantly?
      let maxChange = 0;
      for (const [type, result] of this.memo) {
        if (!result) continue;
        const prev = prevValues.get(type) || 0;
        if (prev > 0) {
          const change = Math.abs(result.value - prev) / prev;
          maxChange = Math.max(maxChange, change);
        }
      }

      if (pass > 0 && maxChange < 0.01) break; // Converged
    }
  }

  // Compute expected value of crushing an item and re-sifting the dust
  // This is the "gambling" strategy: crush → dust → nano sifter → random ore → process
  computeCrushRerollEV(baseOreValue) {
    const nanoSifter = this.registry.get("nano_sifter");
    if (!nanoSifter || !this.registry.isAvailable("nano_sifter", this.config)) return 0;

    // Get nano sifter ore pool from machines.json
    const orePool = nanoSifter.orePool || [];
    if (orePool.length === 0) return 0;

    // Sift chance
    const siftChance = 0.166;

    // Average value of a sifted ore after full processing
    let totalOreValue = 0;
    for (const poolOre of orePool) {
      // Each sifted ore goes through the full processing chain
      // Use previous pass value if available to break cycles
      const processedValue = this.prevPassValues?.get("bar") || 0;
      if (processedValue > 0) {
        // Scale by the ratio of this ore to the base ore used for bar calculation
        const baseOre = ORES.find(o => this.prevPassValues?.has("ore"))?.value || baseOreValue;
        const ratio = poolOre.value / (baseOre || 1);
        totalOreValue += processedValue * ratio;
      } else {
        totalOreValue += poolOre.value; // Fallback to raw value
      }
    }
    const avgSiftedOreValue = totalOreValue / orePool.length;

    // Expected value per dust through sifter
    // siftChance * avgOreValue + (1 - siftChance) * dustResidualValue
    // Dust residual: goes to clay mixer or kiln (best destination)
    const dustResidualValue = this.memo.get("clay")?.value || this.memo.get("glass")?.value || 30;

    return siftChance * avgSiftedOreValue + (1 - siftChance) * (dustResidualValue / 2);
  }

  // Get the best value per unit for an item type
  // Memoized to avoid recomputation
  // On cycle detection: returns previous pass value instead of null (enables convergent loops)
  getItemValue(type, baseOreValue) {
    if (this.memo.has(type)) {
      const cached = this.memo.get(type);
      // If null, we're in a cycle - return previous pass value to break it
      if (cached === null && this.prevPassValues?.has(type)) {
        const prevVal = this.prevPassValues.get(type);
        if (prevVal > 0) {
          return { value: prevVal, oreCount: 1, perOre: prevVal, machines: ["cycle_ref"], isCycleRef: true };
        }
      }
      return cached;
    }

    // Prevent infinite recursion - mark as in-progress
    this.memo.set(type, null);

    let result;

    if (type === "ore") {
      result = this.computeOreValue(baseOreValue);
    } else if (type === "stone") {
      result = { value: 0, oreCount: 0, perOre: 0, machines: ["smelter_byproduct"], isByproduct: true };
    } else if (type === "dust") {
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

    // Ore upgrader (only when it actually increases value)
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

      // Discover type conversion enhancements from registry
      // For any type, check if there's a convert→process→convert-back path that adds value
      // e.g., bar → bar_to_gem → gem → gem_cutter → prismatic → gem_to_bar → enhanced bar
      if (!this._inEnhancement) {
        const enhanced = this._findEnhancementPath(targetType, outputValue, totalOres);
        if (enhanced && enhanced.perOre > (totalOres > 0 ? outputValue / totalOres : outputValue)) {
          outputValue = enhanced.value;
          totalOres = enhanced.oreCount;
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

  // Discover enhancement paths: convert type → process → convert back
  // Searches registry for machines that convert type A → B (preserve) and B → A (preserve)
  // with processing machines in between that multiply value
  _findEnhancementPath(sourceType, sourceValue, sourceOres) {
    if (this._inEnhancement) return null;
    this._inEnhancement = true;

    try {
      // Find all "convert away" machines: take sourceType, output different type, preserve value
      const convertAway = [];
      for (const [id, m] of this.registry.machines) {
        if (!this.registry.isAvailable(id, this.config)) continue;
        if (m.effect !== "preserve") continue;
        const acceptsSource = (m.inputs || []).some(inp =>
          inp === sourceType || inp.split("|").includes(sourceType)
        );
        const outputType = m.outputs?.[0]?.type;
        if (acceptsSource && outputType && outputType !== sourceType) {
          convertAway.push({ machineId: id, outputType });
        }
      }

      let bestEnhancement = null;

      for (const { machineId: awayId, outputType: intermediateType } of convertAway) {
        // Find processing machines for the intermediate type (multiply, combine, etc.)
        // Build the best processing chain for intermediateType
        let processedValue = sourceValue;
        let processedOres = sourceOres;
        let processedType = intermediateType;

        // Find processing machines for the intermediate type
        // Include both modifiers (same type in/out) and single-input producers (gem→cut_gem)
        const skipMods = new Set(["quality_assurance", "duplicator", "crusher"]);

        // Modifiers (same type in/out)
        const mods = this.registry.getModifiers(intermediateType).filter(id => !skipMods.has(id));
        for (const modId of mods) {
          const mod = this.registry.get(modId);
          if (!this.registry.isAvailable(modId, this.config)) continue;
          if (mod.effect === "multiply") {
            processedValue *= mod.value;
            processedType = mod.outputs?.[0]?.type || processedType;
          } else if (mod.effect === "flat") {
            processedValue += mod.value;
          }
        }

        // Single-input producers that enhance the type (gem_cutter: gem → cut_gem at 1.4x)
        for (const [prodId, prod] of this.registry.machines) {
          if (!this.registry.isAvailable(prodId, this.config)) continue;
          if (skipMods.has(prodId)) continue;
          if (prod.effect !== "multiply" && prod.effect !== "flat") continue;
          if ((prod.inputs || []).length !== 1) continue; // single input only
          const acceptsType = (prod.inputs || []).some(inp =>
            inp === processedType || inp.split("|").includes(processedType) ||
            inp === intermediateType || inp.split("|").includes(intermediateType)
          );
          if (!acceptsType) continue;
          // Don't use machines that are also transmuters (preserve effect)
          if (prod.effect === "preserve") continue;

          if (prod.effect === "multiply") {
            processedValue *= prod.value;
          } else if (prod.effect === "flat") {
            processedValue += prod.value;
          }
          processedType = prod.outputs?.[0]?.type || processedType;
        }

        // Find combine machines where ALL inputs are the same intermediate type
        // (e.g., prismatic: gem + gem, NOT laser: optic + gem + circuit)
        for (const [combId, comb] of this.registry.machines) {
          if (!this.registry.isAvailable(combId, this.config)) continue;
          if (comb.effect !== "combine") continue;
          // ALL inputs must be the processed type (or union containing it)
          const allSameType = (comb.inputs || []).every(inp =>
            inp === processedType || inp.split("|").includes(processedType) ||
            inp === intermediateType || inp.split("|").includes(intermediateType)
          );
          if (!allSameType) continue;

          const inputCount = (comb.inputs || []).length;
          const combinedValue = processedValue * inputCount * (comb.value || 1);
          const combinedOres = processedOres * inputCount;
          const combinedType = comb.outputs?.[0]?.type || processedType;

          // Find "convert back" machine: takes combinedType (or processedType), outputs sourceType
          for (const [backId, backM] of this.registry.machines) {
            if (!this.registry.isAvailable(backId, this.config)) continue;
            if (backM.effect !== "preserve") continue;
            const acceptsCombined = (backM.inputs || []).some(inp =>
              inp === combinedType || inp.split("|").includes(combinedType) ||
              inp === processedType || inp.split("|").includes(processedType)
            );
            const backOutput = backM.outputs?.[0]?.type;
            if (!acceptsCombined || backOutput !== sourceType) continue;

            // Found a complete enhancement path!
            const enhancedPerOre = combinedOres > 0 ? combinedValue / combinedOres : combinedValue;
            if (!bestEnhancement || enhancedPerOre > bestEnhancement.perOre) {
              bestEnhancement = {
                value: combinedValue,
                oreCount: combinedOres,
                perOre: enhancedPerOre,
                path: [awayId, combId, backId],
              };
            }
          }
        }

        // Also try without combine (just convert → process → convert back)
        for (const [backId, backM] of this.registry.machines) {
          if (!this.registry.isAvailable(backId, this.config)) continue;
          if (backM.effect !== "preserve") continue;
          const acceptsProcessed = (backM.inputs || []).some(inp =>
            inp === processedType || inp.split("|").includes(processedType)
          );
          const backOutput = backM.outputs?.[0]?.type;
          if (!acceptsProcessed || backOutput !== sourceType) continue;

          const enhancedPerOre = processedOres > 0 ? processedValue / processedOres : processedValue;
          if (!bestEnhancement || enhancedPerOre > bestEnhancement.perOre) {
            bestEnhancement = {
              value: processedValue,
              oreCount: processedOres,
              perOre: enhancedPerOre,
              path: [awayId, backId],
            };
          }
        }
      }

      return bestEnhancement;
    } finally {
      this._inEnhancement = false;
    }
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
    // Check if transmuter is used: bar value > non-transmuter bar value means enhancement was applied
    const usesTransmuter = this.config.prestigeItems?.transmuters &&
      this.registry.isAvailable("bar_to_gem", this.config) &&
      this.registry.isAvailable("gem_to_bar", this.config);
    if (usesTransmuter) tags.push("Transmute");
    if (this.config.prestigeItems?.philosophersStone) tags.push("Infused");
    if (dupAt) tags.push("Dup");
    const suffix = tags.length ? " [" + tags.join(", ") + "]" : "";
    const displayType = ITEM_TYPES[terminalType] || terminalType;

    // Build recipe tree for graph visualization using the old ValueCalculator
    // (it has proper tree building with all machine paths)
    const vizCalc = new ValueCalculator(this.registry, this.config);
    const vizResult = vizCalc.calculate(terminalType, oreValue);
    let recipeTree = vizResult?.recipeTree || null;

    // If duplicator was used, inject it into the tree
    if (dupAt && recipeTree && this.config.prestigeItems?.duplicator) {
      // Use the old system's duplicator injection for the graph
      const oldDupResult = vizCalc.optimizeDuplicators({ ...vizResult, value: vizResult.value });
      if (oldDupResult) {
        recipeTree = vizCalc.injectDuplicatorNodes(recipeTree, oldDupResult.positions);
        // Update productQty from old system if it found a combiner dup
      }
    }

    // Check if sifted ores use the Ore Upgrader (for graph)
    const siftedUsesUpgrader = bpValue.flows?.some(f => f.siftedUsesUpgrader);

    // Build graph using existing GraphGenerator
    const graph = recipeTree
      ? GraphGenerator.fromRecipeTree(recipeTree, this.registry, totalOres, this.config, productQty, { siftedUsesUpgrader })
      : null;

    return {
      chain: displayType + suffix,
      totalValue,
      totalOres,
      perOre,
      endType: terminalType,
      totalCost: this.sumCosts(chainResult),
      flowGraph: graph,
      graph, // compatibility with old system
      value: totalValue,
      oresNeeded: totalOres,
      cost: this.sumCosts(chainResult),
      dupAt,
      productQty,
      recipeTree,
    };
  }

  // Build a recipe tree from the flow chain result for graph visualization
  buildRecipeTree(chainResult, hasQA) {
    if (!chainResult) return null;

    const tree = this._buildTreeNode(chainResult);

    // Wrap with QA if available
    if (hasQA && tree) {
      return {
        machine: "quality_assurance",
        type: tree.type,
        value: tree.value * 1.2,
        oreCount: tree.oreCount,
        inputs: [tree],
      };
    }
    return tree;
  }

  _buildTreeNode(result) {
    if (!result) return null;

    // Leaf: ore
    if (result.machines) {
      // Ore processing chain - build linear tree from machines list
      let node = { machine: "ore_source", type: "ore", value: 0, oreCount: 1, inputs: [] };
      for (const mid of result.machines) {
        if (mid === "ore_source") continue;
        node = { machine: mid, type: "ore", value: result.value, oreCount: 1, inputs: [node] };
      }
      // The final node should be a bar (smelter output)
      return node;
    }

    // Byproduct base
    if (result.isByproduct) {
      return { machine: "smelter_byproduct", type: result.resolvedType || "stone", value: result.value, oreCount: 0, inputs: [] };
    }

    // Production machine with inputs
    if (result.machine && result.inputs) {
      const inputTrees = result.inputs.map(inp => this._buildTreeNode(inp));
      return {
        machine: result.machine,
        type: result.resolvedType || result.inputs?.[0]?.resolvedType || "item",
        value: result.value,
        oreCount: result.oreCount,
        inputs: inputTrees.filter(Boolean),
      };
    }

    // Simple value result
    return {
      machine: result.machine || "unknown",
      type: result.resolvedType || "item",
      value: result.value,
      oreCount: result.oreCount || 0,
      inputs: [],
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
  computeByproductFlow(oreCount, oreValue, mainChainPerOre, smelterOverride) {
    // Try both smelters if no override, pick whichever gives best total including byproducts
    if (!smelterOverride) {
      const smelters = ["ore_smelter", "blast_furnace"].filter(id => this.registry.get(id));
      let bestResult = { totalValue: 0, flows: [], smelterId: null };
      for (const id of smelters) {
        const result = this.computeByproductFlow(oreCount, oreValue, mainChainPerOre, id);
        if (result.totalValue > bestResult.totalValue) {
          bestResult = { ...result, smelterId: id };
        }
      }
      return bestResult;
    }

    const smelter = this.registry.get(smelterOverride);
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

      // Sifted ores → compute value through FULL pipeline independently
      // Each sifted ore is a fresh ore going through Upgrader → Clean → Polish → etc
      // Use computeOreValue for each ore (handles all ore modifiers including Upgrader)
      // Then apply the same bar/processing multipliers from the main chain
      const sifterOrePool = bestSifter.id === "nano_sifter" ? NANO_SIFTER_ORES : ["Tin", "Iron", "Lead", "Silver", "Gold"];
      let avgOreValue = 0;
      let siftedUsesUpgrader = false;
      for (const oreName of sifterOrePool) {
        const ore = ORES.find(o => o.name === oreName);
        if (!ore) continue;
        // Check if this sifted ore benefits from Ore Upgrader
        if (this.config.prestigeItems?.oreUpgrader) {
          const upgraded = getUpgradedOreValue(oreName);
          if (upgraded !== null) siftedUsesUpgrader = true;
        }
        // Compute full ore processing value independently for THIS ore
        const siftedOreResult = this.computeOreValue(ore.value);
        // Apply the same bar processing chain (smelt, temper, transmute etc)
        // Use ratio: main chain bar value / main chain ore value = processing multiplier
        const mainOre = this.memo.get("ore");
        const mainBar = this.memo.get("bar");
        if (mainOre && mainBar && mainOre.value > 0) {
          // The multiplier from ore → bar (smelting, tempering, transmuters etc)
          const barMultiplier = mainBar.value / mainOre.value;
          let siftedBarVal = siftedOreResult.value * barMultiplier;
          // QA
          const qa = this.registry.get("quality_assurance");
          if (qa && this.registry.isAvailable("quality_assurance", this.config)) siftedBarVal *= (1 + qa.value);
          avgOreValue += siftedBarVal * ds;
        } else {
          avgOreValue += siftedOreResult.value * ds;
        }
      }
      avgOreValue /= sifterOrePool.length;

      // Geometric series for recursive sifting
      const recursiveChance = stonePerOre * chance;
      totalValue += (oresProduced * avgOreValue) / (1 - recursiveChance);
      flows.push({ machine: bestSifter.id, type: "ore", qty: oresProduced, value: avgOreValue, siftedUsesUpgrader });
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

    // Also consider: crush this item → dust → sift → reroll
    // Only for items that CAN be crushed (not dust itself)
    if (itemType !== "dust" && this.crushRerollEV > 0) {
      const crushRerollValue = this.crushRerollEV;
      if (crushRerollValue > bestValue) {
        bestValue = crushRerollValue;
        bestDest = "crush_reroll";
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
