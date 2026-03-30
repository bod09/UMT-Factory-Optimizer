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

    // No separate gambling chain needed - the unified flow already evaluates
    // blast furnace vs ore smelter including secondary output value.
    // The "Bar" chain with blast furnace IS the gambling setup when it's more profitable.

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

    // Seed initial values for byproduct types so first pass can bootstrap
    // These are rough estimates - subsequent passes will refine them
    this.prevPassValues = new Map([
      ["stone", 0],
      ["dust", 1],
      ["clay", 50],
      ["ceramic_casing", 150],
      ["glass", 30],
    ]);

    for (let pass = 0; pass < maxPasses; pass++) {
      const prevValues = new Map([
        ...this.prevPassValues,
        ...[...this.memo.entries()].map(([k, v]) => [k, v?.value || 0])
      ]);

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
  // computeCrushRerollEV removed - crush/reroll is now handled by the unified
  // flow through resolveBestByproductDestination which evaluates all destinations

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
          // Check if this type is free (produced from secondary outputs, not from ores)
          // A type is free if: it's a known secondary output, OR no machine produces it from ores,
          // OR all its producers only use free inputs (detected from registry data)
          const isFreeType = this.registry.isByproduct(type) ||
            this.registry.getProducers(type).length === 0 ||
            this._isProducedFromFreeInputs(type);
          return { value: prevVal, oreCount: isFreeType ? 0 : 1, perOre: prevVal, machines: ["cycle_ref"], isCycleRef: true };
        }
      }
      return cached;
    }

    // Prevent infinite recursion - mark as in-progress
    this.memo.set(type, null);

    let result;

    if (type === "ore") {
      result = this.computeOreValue(baseOreValue);
    } else {
      // Find the best way to produce this type (what machine makes it from ore-based inputs)
      result = this.computeBestProduction(type, baseOreValue);

      // If no production path exists, this type comes from secondary outputs
      // (stone, dust, clay, etc.) - find the best processing chain for selling
      // Note: the VALUE of these items is already included in the parent machine's
      // byproduct bonus. This resolution is for the GRAPH to show the path.
      if (!result) {
        result = this.computeBestProcessing(type, baseOreValue);
      }
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

    // Track which tags the ore chain applies (for safe modifier detection on byproducts)
    const oreTags = new Set();
    for (const mid of machines) {
      const m = this.registry.get(mid);
      if (m?.tag) oreTags.add(m.tag);
    }
    this._oreChainTags = oreTags;

    return { value: val, oreCount: 1, perOre: val, machines, throughput: 1 };
  }

  // Find the most valuable processing chain for a free item type (stone, dust, clay, etc.)
  // Follows the ENTIRE chain to the final product: dust → clay_mixer → clay → ceramic_furnace → $150
  // Returns the final sellable value, not intermediate values.
  computeBestProcessing(itemType, baseOreValue) {
    const ds = this.config.hasDoubleSeller ? 2 : 1;

    // Use computeBestProduction to find the best machine that produces
    // something FROM this type. Since getProducers won't find these
    // (they're byproduct inputs, not outputs), we search manually.
    let bestValue = 0;
    let bestResult = null;

    for (const [machineId, m] of this.registry.machines) {
      if (!this.registry.isAvailable(machineId, this.config)) continue;

      // Skip transport, filter, and modifier machines - they don't produce value
      const skipEffects = new Set(["transport", "split", "overflow", "filter", "gate", "duplicate", "percent"]);
      if (skipEffects.has(m.effect)) continue;
      // Skip machines that output "same" or "passthrough" (modifiers, not producers)
      const outputType = m.outputs?.[0]?.type;
      if (!outputType || outputType === "same" || outputType === "passthrough") continue;

      // Check if this machine accepts our item type (including "any" inputs like crusher)
      const acceptsType = (m.inputs || []).some(inp =>
        inp === itemType || inp.split("|").includes(itemType) || inp === "any"
      );
      // Don't use "any" input machines (crusher) to crush dust back into dust
      if ((m.inputs || []).includes("any") && outputType === itemType) continue;
      if (!acceptsType) continue;

      if (m.effect === "chance") {
        // Chance machines are pass-through: item goes through AND continues
        // Collect them separately - they'll be chained after finding the best non-chance path
        continue;
      } else {
        // Any machine that accepts this type: evaluate its output value
        // This handles crusher (set), kiln (flat), clay_mixer (combine), etc.
        // All treated the same way - compute output value and compare

        // For multi-input machines, check all inputs are free (oreCount=0)
        if (m.inputs.length >= 2) {
          let allFree = true;
          for (const inputSpec of m.inputs) {
            const types = inputSpec.split("|");
            const t = types.find(tt => tt === itemType) || types[0];
            // Self-referential inputs (clay_mixer needs dust+dust when resolving dust)
            // are free - they're the same item we're evaluating
            if (t === itemType) continue;
            const ir = this.getItemValue(t, baseOreValue);
            if (!ir || ir.oreCount > 0) { allFree = false; break; }
          }
          if (!allFree) continue;
        }

        // Compute this machine's output value
        let machineOutputValue = 0;
        if (m.effect === "set") machineOutputValue = m.value || 0;
        else if (m.effect === "flat") machineOutputValue = m.value || 0;
        else if (m.effect === "multiply") machineOutputValue = 0;
        else if (m.effect === "combine") {
          // Combine: compute from inputs
          const inputResults = (m.inputs || []).map(inp => {
            const t = inp.split("|").find(tt => tt === itemType) || inp.split("|")[0];
            const ir = this.getItemValue(t, baseOreValue);
            return ir || { value: 0 };
          });
          machineOutputValue = this.applyMachineEffect(m, inputResults);
        }

        // For free items (oreCount=0), trace the output through processing-only chains
        // Use a limited recursive walk that ONLY follows free processing paths
        // (no production chains that would create feedback loops)
        let finalValue = machineOutputValue;
        const visited = new Set([itemType, outputType]);
        let currentType = outputType;
        let currentValue = machineOutputValue;
        const downstreamChain = []; // Full chain for graph: [{machine, type, value}, ...]

        // Follow processing chains: dust → clay_mixer → clay → ceramic_furnace → ceramic
        for (let depth = 0; depth < 5; depth++) {
          let bestNext = null;
          for (const [nextId, nextM] of this.registry.machines) {
            if (!this.registry.isAvailable(nextId, this.config)) continue;
            if (!nextM.inputs || nextM.inputs.length === 0) continue;
            const allSameType = nextM.inputs.every(inp =>
              inp === currentType || inp.split("|").includes(currentType)
            );
            if (!allSameType) continue;
            const nextOutput = nextM.outputs?.[0]?.type;
            if (!nextOutput || nextOutput === "same" || visited.has(nextOutput)) continue;
            const skipEffects = new Set(["chance", "transport", "split", "overflow", "filter", "gate", "duplicate", "preserve"]);
            if (skipEffects.has(nextM.effect)) continue;

            let nextValue = 0;
            if (nextM.effect === "set") nextValue = nextM.value || 0;
            else if (nextM.effect === "multiply") nextValue = currentValue * (nextM.value || 1);
            else if (nextM.effect === "flat") nextValue = currentValue + (nextM.value || 0);

            if (!bestNext || nextValue > bestNext.value) {
              bestNext = { machine: nextId, type: nextOutput, value: nextValue };
            }
          }
          if (!bestNext || bestNext.value <= currentValue) break;
          downstreamChain.push(bestNext);
          currentValue = bestNext.value;
          currentType = bestNext.type;
          visited.add(currentType);
          finalValue = currentValue;
        }

        // Apply modifiers to byproduct items ONLY if their tag is already present
        // on the main chain's ore processing (safe - combining items with same tag is fine).
        // Skip modifiers whose tag would be NEW (would block final product modifier).
        // Example: Polisher tag "Polished" is in ore chain → safe to polish ceramic (+$10)
        // QA tag "QA Tested" is NOT in ore chain → would block Power Core QA → skip
        const oreChainTags = this._oreChainTags || new Set();
        for (const [modId, modM] of this.registry.machines) {
          if (!this.registry.isAvailable(modId, this.config)) continue;
          if (!modM.inputs || modM.inputs.length !== 1) continue;
          if (!modM.tag) continue; // Only tagged modifiers need checking
          // Must accept this item type
          const accepts = modM.inputs.some(inp =>
            inp === "any" || inp === currentType || inp.split("|").includes(currentType)
          );
          if (!accepts) continue;
          const outType = modM.outputs?.[0]?.type;
          if (outType && outType !== "same" && outType !== currentType) continue;
          if (!["flat", "percent", "multiply"].includes(modM.effect)) continue;
          // Already in downstream chain?
          if (downstreamChain.some(d => d.machine === modId)) continue;
          // SAFE CHECK: is this modifier's tag already in the ore chain?
          // If yes, combining won't cause conflict. If no, skip it.
          if (!oreChainTags.has(modM.tag)) continue;
          // Apply the modifier
          let newVal = finalValue;
          if (modM.effect === "flat") newVal += modM.value;
          else if (modM.effect === "percent") newVal *= (1 + modM.value);
          else if (modM.effect === "multiply") newVal *= modM.value;
          if (newVal > finalValue) {
            finalValue = newVal;
            downstreamChain.push({ machine: modId, type: currentType, value: finalValue });
          }
        }

        if (finalValue > bestValue) {
          bestValue = finalValue;
          bestResult = {
            value: finalValue,
            machine: machineId,
            inputs: [],
            resolvedType: outputType,
            oreCount: 0,
            isByproduct: true,
            downstreamChain,
          };
        }
      }
    }

    // Chain pass-through chance machines (prospectors, sifters) ON TOP of the best path
    // These add value without consuming the item - stone passes through each one
    // Sort by byproduct value (highest first = Diamond before Topaz)
    const chanceMachines = [];
    for (const [machineId, m] of this.registry.machines) {
      if (m.effect !== "chance") continue;
      if (!this.registry.isAvailable(machineId, this.config)) continue;
      const acceptsType = (m.inputs || []).some(inp =>
        inp === itemType || inp.split("|").includes(itemType) || inp === "any"
      );
      if (!acceptsType) continue;
      // Don't use crusher-like "any" machines for chance
      if ((m.inputs || []).includes("any") && !m.gemType && !m.byproducts?.length) continue;

      let byproductValue = 0;
      if (m.gemType) {
        // Use raw gem value - prospector gems are sold directly
        // They could go through gem cutter etc. but that's a separate chain
        const gemData = GEMS.find(g => g.name === m.gemType);
        byproductValue = (gemData?.value || 0);
        // Apply polisher if safe (+$10)
        const oreChainTags = this._oreChainTags || new Set();
        if (oreChainTags.has("Polished")) byproductValue += 10;
        byproductValue *= ds;
      } else if (m.byproducts?.[0]?.type) {
        const bpResult = this.getItemValue(m.byproducts[0].type, baseOreValue);
        byproductValue = bpResult?.value || 0;
      }

      chanceMachines.push({
        id: machineId,
        chance: m.value || 0.05,
        byproductValue,
        gemType: m.gemType,
      });
    }

    // Sort: highest byproduct value first (Diamond before Topaz)
    chanceMachines.sort((a, b) => b.byproductValue - a.byproductValue);

    if (chanceMachines.length > 0 && bestResult) {
      // Chain all chance machines: each one processes remaining items
      let totalChanceEV = 0;
      let remainingFraction = 1.0;
      const chanceChain = [];

      for (const cm of chanceMachines) {
        const evFromThisMachine = remainingFraction * cm.chance * cm.byproductValue;
        totalChanceEV += evFromThisMachine;
        remainingFraction *= (1 - cm.chance);
        chanceChain.push({
          machine: cm.id,
          chance: cm.chance,
          byproductValue: cm.byproductValue,
          gemType: cm.gemType,
          remainingAfter: remainingFraction,
        });
      }

      // Total value = chance EV + remaining fraction × best non-chance path value
      const combinedValue = totalChanceEV + remainingFraction * bestResult.value;

      if (combinedValue > bestResult.value) {
        bestResult = {
          ...bestResult,
          value: combinedValue,
          chanceChain, // For graph display
        };
      }
    }

    return bestResult || { value: 0, machine: null, inputs: [] };
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

      // Apply safe modifiers to each input before combining
      // A modifier is safe if its tag is already on OTHER inputs (tag inheritance means
      // the combined product would get it anyway). This adds free value.
      // e.g., Polisher on glass (+$10) is safe because ores are already Polished.
      const oreChainTags = this._oreChainTags || new Set();
      for (let i = 0; i < inputResults.length; i++) {
        const inp = inputResults[i];
        // Check if this input type is immune to modifiers (from machines.json output data)
        // e.g., blasting powder "can only be improved by machines specific to it"
        const inputProducer = this.registry.get(inp.machine);
        const isImmune = inputProducer?.outputs?.some(o => o.modifierImmune);
        if (isImmune) continue;
        // Collect tags from ALL other inputs' ore chains
        // If any other input already has a tag, applying it to this input is free
        const otherTags = new Set(oreChainTags);

        // Apply each safe modifier
        for (const [modId, modM] of this.registry.machines) {
          if (!this.registry.isAvailable(modId, this.config)) continue;
          if (!modM.inputs || modM.inputs.length !== 1) continue;
          if (!modM.tag) continue;
          if (!otherTags.has(modM.tag)) continue; // Only safe if tag already exists
          if (!["flat", "percent", "multiply"].includes(modM.effect)) continue;
          // Check this modifier accepts the input type
          const inpType = inp.resolvedType || "?";
          const accepts = modM.inputs.some(i2 =>
            i2 === "any" || i2 === inpType || i2.split("|").includes(inpType)
          );
          if (!accepts) continue;
          // Check if already applied (machines list contains this modifier)
          if (inp.machines?.includes(modId)) continue;
          // Apply
          let newVal = inp.value;
          if (modM.effect === "flat") newVal += modM.value;
          else if (modM.effect === "percent") newVal *= (1 + modM.value);
          else if (modM.effect === "multiply") newVal *= modM.value;
          if (newVal > inp.value) {
            inputResults[i] = { ...inp, value: newVal, _modifiedBy: modId };
          }
        }
      }

      // Apply machine effect
      let outputValue = this.applyMachineEffect(machine, inputResults);

      // Add byproduct value: if this machine produces byproducts,
      // resolve their best destination and add to the output value
      let byproductNodes = [];
      if (machine.byproducts) {
        const bpRatio = machine.byproductRatio || 0.5;
        for (const bp of machine.byproducts) {
          const bpResult = this.getItemValue(bp.type, baseOreValue);
          if (bpResult && bpResult.value > 0) {
            // Byproduct value per input = bpResult.value × ratio
            outputValue += bpResult.value * bpRatio;
            byproductNodes.push({
              type: bp.type,
              ratio: bpRatio,
              result: bpResult,
            });
          }
        }
      }

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

      // Throughput: how many items this machine outputs per final product
      // = totalOres / ores needed for ONE invocation of this machine
      const oresPerInvocation = inputResults.reduce((sum, ir) => sum + (ir.oreCount || 0), 0) || 1;
      const throughput = Math.max(1, Math.round(totalOres / oresPerInvocation));

      if (!bestResult || perOre > bestResult.perOre) {
        bestResult = {
          value: outputValue,
          oreCount: totalOres,
          perOre,
          machine: machineId,
          inputs: inputResults,
          throughput,
          byproductOutputs: byproductNodes.length > 0 ? byproductNodes : undefined,
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
  // Check if a type is only produced from free (0-ore) inputs
  // e.g., dust comes from crusher which takes stone (free), clay comes from clay_mixer which takes dust (free)
  _isProducedFromFreeInputs(type) {
    // Check all machines that accept this type as input and produce something
    for (const [machineId, machine] of this.registry.machines) {
      if (!this.registry.isAvailable(machineId, this.config)) continue;
      const outputs = machine.outputs || [];
      for (const out of outputs) {
        if (out.type === type) {
          // This machine produces this type - check if ALL its inputs are free
          const inputs = machine.inputs || [];
          const allInputsFree = inputs.every(inp => {
            const types = inp.split("|");
            return types.some(t => {
              if (t === "any") return true; // "any" input = accepts free items
              const result = this.memo.get(t);
              return result && result.oreCount === 0;
            });
          });
          if (allInputsFree && inputs.length > 0) return true;
        }
      }
    }
    // Also check: if this type is a secondary output of any machine
    if (this.registry.isByproduct(type)) return true;
    return false;
  }

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

    // Byproduct value is now included in the chain result (unified flow)
    // No separate computeByproductFlow needed
    const totalValue = finalValue;
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

    // Build graph directly from flow chain result - single source of truth
    const graph = GraphGenerator.fromFlowChain(
      chainResult, this.registry, this.config,
      { dupAt, productQty }, {}, this.memo
    );

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
      // Check if the duplicated input type is used by OTHER inputs of the same combiner
      // e.g., Power Core needs casing (direct) AND electromagnet (which contains casing)
      // If so, the dup fills both needs from 1 build = 1 product, savings = dupInput ores
      const dupType = dupInput.resolvedType || '';
      const dupMachine = dupInput.machine || '';
      let dupUsedElsewhere = false;

      // Recursively check if a subtree contains the duplicated type's machine
      function containsMachine(node, targetMachine) {
        if (!node) return false;
        if (node.machine === targetMachine) return true;
        return (node.inputs || []).some(child => containsMachine(child, targetMachine));
      }

      // Only check OTHER top-level inputs of the SAME combiner
      // The dup input itself (inputs[i]) and its parent subtree don't count
      // e.g., Power Core: casing(i=0) is dup'd, check if electromagnet(i=2) contains casing_machine
      // But NOT: Tablet: bolts dup'd within casing - bolts appearing twice in casing's own subtree doesn't count
      for (let j = 0; j < inputs.length; j++) {
        if (j === i) continue;
        const otherInput = inputs[j];
        // Check if the other input IS the same type
        if ((otherInput.resolvedType || '') === dupType) {
          dupUsedElsewhere = true;
          break;
        }
        // Check if the other input's subtree contains the dup type's machine
        // This means the combiner genuinely needs the dup type from 2 independent sources
        if (dupMachine && containsMachine(otherInput, dupMachine)) {
          dupUsedElsewhere = true;
          break;
        }
      }

      let totalValue, totalOresNeeded, perOre, products;
      if (dupUsedElsewhere) {
        // Dup fills 2 slots in the same product = 1 product, save building 2nd copy
        products = 1;
        const savedOres = dupInput.oreCount;
        totalOresNeeded = chainResult.oreCount - savedOres;
        // Value is same as without dup (1 product at full value, but 50% on each dup copy)
        // The dup copies are at 50% value each, so the combine result is lower
        totalValue = perProduct * qaMultiplier * ds;
        perOre = totalOresNeeded > 0 ? totalValue / totalOresNeeded : 0;
      } else {
        // Dup doubles output = 2 products
        products = 2;
        totalOresNeeded = dupInput.oreCount + otherInputOres * products;
        totalValue = perProduct * products * qaMultiplier * ds;
        perOre = totalOresNeeded > 0 ? totalValue / totalOresNeeded : 0;
      }

      results.push({
        totalValue, totalOres: totalOresNeeded, perOre,
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

  // REMOVED: computeByproductFlow, findBestDestination, buildGamblingGraph
  // All handled by the unified flow through resolveBestByproductDestination
  // and byproductOutputs in computeBestProduction

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
