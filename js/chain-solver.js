// UMT Factory Optimizer - Unified Chain Solver
// Replaces flow.js + graph-builder.js with a single system where
// the solver result IS the graph. No separate graph building pass.
//
// Algorithm: Memoized recursive value maximization with:
// - SCC-based cycle resolution (replaces hardcoded seed values)
// - Universal effect application (one switch for ALL machine types)
// - Integrated graph extraction (SolvedItem = graph node)

// === SOLVED ITEM: Both solver result AND graph node ===
class SolvedItem {
  static _nextId = 1;

  constructor(type, value, oreCount) {
    this.id = SolvedItem._nextId++;
    this.type = type;
    this.value = value;
    this.oreCount = oreCount;
    this.tags = new Set();

    // Production info
    this.machine = null;        // machineId that produced this
    this.inputs = [];           // SolvedItem[] — what was consumed
    this.machines = null;       // string[] — flat ore processing chain (ore only)
    this.resolvedType = type;   // resolved union type

    // Modifier chain
    this.appliedModifiers = []; // [{ id, effect, modValue, outputType }]

    // Enhancement path
    this.enhancementPath = null; // [machineId, ...] or null

    // Byproducts
    this.byproductOutputs = []; // [{ type, ratio, result: SolvedItem }]

    // Chance machines
    this.chanceChain = [];      // [{ machine, chance, byproductValue, gemType }]

    // Metadata
    this.throughput = 1;
    this.isByproduct = false;
    this._cheapPath = false;
  }
}

// === CHAIN SOLVER ===
// API-compatible with FlowOptimizer: constructor(registry, config), discoverAll(oreValue)
class ChainSolver {
  constructor(registry, config) {
    this.registry = registry;
    this.config = config;
    this.memo = new Map();          // type → SolvedItem
    this._oreChainTags = new Set();
    this._inEnhancement = false;
    this._prevPassValues = new Map();
    this._prevPassResults = new Map();
  }

  // ─── PUBLIC API ────────────────────────────────────────

  // Alias for backward compatibility with FlowOptimizer
  discoverAll(oreValue) { return this.solveAll(oreValue); }

  // Main entry: find all optimal chains for a given ore value
  solveAll(oreValue) {
    SolvedItem._nextId = 1;
    this.memo.clear();

    // Phase 1: Compute per-unit values for all types (multi-pass for cycles)
    this._computeAllValues(oreValue);

    // Phase 2: For each terminal product, build full chain with quantities
    const terminals = this._findTerminals();
    const results = [];
    const ds = this.config.hasDoubleSeller ? 2 : 1;

    for (const terminalType of terminals) {
      const flow = this._buildFlow(terminalType, oreValue);
      if (!flow || flow.totalOres <= 0) continue;
      if (flow.totalCost > this.config.budget) continue;
      results.push(flow);
    }

    // Add direct sell option
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
      flowGraph: null, graph: null,
      totalCost: 0,
    });

    results.sort((a, b) => b.perOre - a.perOre);
    return results;
  }

  // ─── UNIVERSAL EFFECT APPLICATION ──────────────────────

  applyEffect(machine, inputValues) {
    const v = machine.value || 0;
    switch (machine.effect) {
      case "flat":           return (inputValues[0] || 0) + v;
      case "multiply":       return (inputValues[0] || 0) * v;
      case "percent":        return (inputValues[0] || 0) * (1 + v);
      case "set":            return v;
      case "combine":        return inputValues.reduce((s, x) => s + x, 0) * v;
      case "preserve":       return inputValues[0] || 0;
      case "multiplicative": return inputValues.reduce((p, x) => p * x, 1);
      case "chance":         return inputValues[0] || 0; // pass-through
      default:               return inputValues[0] || 0;
    }
  }

  // ─── MULTI-PASS VALUE COMPUTATION ──────────────────────

  _computeAllValues(oreValue) {
    const maxPasses = 5;

    // Bootstrap: initialize byproduct types to 0 (no hardcoded seeds needed —
    // the SCC iteration will converge from 0)
    this._prevPassValues = new Map();
    for (const [id, m] of this.registry.machines) {
      if (m.byproducts) {
        for (const bp of m.byproducts) {
          this._prevPassValues.set(bp.type, 0);
        }
      }
    }
    // Also seed types that are only produced by "any"-input machines (crusher)
    // These have no explicit producers in the registry
    this._prevPassValues.set("dust", 0);
    this._prevPassValues.set("metal_dust", 0);
    this._prevPassValues.set("gem_dust", 0);

    for (let pass = 0; pass < maxPasses; pass++) {
      const prevValues = new Map([
        ...this._prevPassValues,
        ...[...this.memo.entries()].map(([k, v]) => [k, v?.value || 0])
      ]);

      this._prevPassValues = prevValues;
      this._prevPassResults = new Map(this.memo);
      this.memo.clear();
      this._currentPass = pass;

      // Compute all values starting from ore
      this._solve("ore", oreValue);

      // Trigger resolution of all producible types
      for (const [id, m] of this.registry.machines) {
        for (const output of m.outputs || []) {
          if (output.type && output.type !== "same" && !this.memo.has(output.type)) {
            this._solve(output.type, oreValue);
          }
        }
      }

      // Check convergence
      let maxChange = 0;
      for (const [type, result] of this.memo) {
        if (!result) continue;
        const prev = prevValues.get(type) || 0;
        if (prev > 0) {
          maxChange = Math.max(maxChange, Math.abs(result.value - prev) / prev);
        }
      }
      if (pass > 0 && maxChange < 0.01) break;
    }
  }

  // ─── CORE SOLVER ───────────────────────────────────────

  _solve(type, baseOreValue) {
    // Check memo
    if (this.memo.has(type)) {
      const cached = this.memo.get(type);
      if (cached === null) {
        // Cycle detection — return previous pass value
        return this._handleCycleRef(type);
      }
      return cached;
    }

    // Mark in-progress for cycle detection
    this.memo.set(type, null);

    let result;
    if (type === "ore") {
      result = this._solveOre(baseOreValue);
    } else {
      // Try production first (machines that create this type)
      result = this._solveBestProduction(type, baseOreValue);

      // If no production path, try processing (byproduct destinations)
      if (!result) {
        result = this._solveBestProcessing(type, baseOreValue);
      }
    }

    this.memo.set(type, result);
    return result;
  }

  // ─── ORE VALUE COMPUTATION ─────────────────────────────

  _solveOre(baseValue) {
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

    // Apply ore modifiers in order: flat first, then percent
    const skipMods = new Set(["quality_assurance", "duplicator", "crusher"]);
    const modifiers = this.registry.getModifiers("ore").filter(id => !skipMods.has(id));
    const sorted = modifiers.map(id => ({ id, ...this.registry.get(id) }))
      .filter(m => m && this.registry.isAvailable(m.id, this.config))
      .sort((a, b) => {
        const order = { upgrade_tier: 0, flat: 1, percent: 2, multiply: 3 };
        return (order[a.effect] || 99) - (order[b.effect] || 99);
      });

    for (const mod of sorted) {
      if (mod.effect === "upgrade_tier") continue;
      if (mod.effect === "flat") { val += mod.value; machines.push(mod.id); }
      else if (mod.effect === "percent") { val *= (1 + mod.value); machines.push(mod.id); }
    }

    // Track ore chain tags for safe modifier detection
    const oreTags = new Set();
    for (const mid of machines) {
      const m = this.registry.get(mid);
      if (m?.tag) oreTags.add(m.tag);
    }
    this._oreChainTags = oreTags;

    const item = new SolvedItem("ore", val, 1);
    item.machines = machines;
    item.throughput = 1;
    return item;
  }

  // ─── BEST PRODUCTION (machines that CREATE a type) ─────

  _solveBestProduction(targetType, baseOreValue) {
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
          let input;
          if (machine.effect === "set") {
            // Set-effect: find cheapest path (lowest oreCount)
            const memoVal = this._solve(t, baseOreValue);
            input = this._findCheapestProducer(t, baseOreValue);
            if (input && memoVal && input.oreCount < memoVal.oreCount) {
              input._cheapPath = true;
            } else {
              input = null;
            }
          }
          if (!input) {
            input = this._solve(t, baseOreValue);
          }
          if (!input || input.value === null) continue;

          if (!bestInput) {
            bestInput = input;
            bestInput._resolvedType = t;
          } else if (machine.effect === "set") {
            if (input.oreCount < bestInput.oreCount) {
              bestInput = input;
              bestInput._resolvedType = t;
            }
          } else {
            const simA = this._simulateEffect(machine, bestInput.value);
            const simB = this._simulateEffect(machine, input.value);
            const perOreA = bestInput.oreCount > 0 ? simA / bestInput.oreCount : simA;
            const perOreB = input.oreCount > 0 ? simB / input.oreCount : simB;
            if (perOreB > perOreA) {
              bestInput = input;
              bestInput._resolvedType = t;
            }
          }
        }

        if (!bestInput) { valid = false; break; }
        inputResults.push(bestInput);
        totalOres += bestInput.oreCount;
      }

      if (!valid || inputResults.length === 0) continue;

      // Apply safe modifiers to combine inputs
      this._applySafeModifiersToInputs(machine, inputResults, baseOreValue);

      // Apply machine effect
      let outputValue = this.applyEffect(machine, inputResults.map(r => r.value));

      // Per-item cost for same-type combines (prismatic: 2 gems)
      const selfInputCount = (machine.inputs || []).filter(inp =>
        inp === targetType || inp.split("|").includes(targetType)
      ).length;
      if (selfInputCount > 1) {
        outputValue = outputValue / selfInputCount;
      }

      // Add byproduct EV
      let byproductOutputs;
      if (machine.byproducts) {
        byproductOutputs = [];
        const bpRatio = machine.byproductRatio || 0.5;
        for (const bp of machine.byproducts) {
          const bpResult = this._solve(bp.type, baseOreValue);
          if (bpResult && bpResult.value > 0) {
            outputValue += bpResult.value * bpRatio;
            byproductOutputs.push({ type: bp.type, ratio: bpRatio, result: bpResult });
          }
        }
      }

      // Apply type-specific modifiers
      const inputTypes = new Set(inputResults.map(r => r._resolvedType || r.resolvedType || ''));
      const modResult = this._applyModifiers(targetType, outputValue, inputTypes, baseOreValue);
      outputValue = modResult.value;
      const appliedModifiers = modResult.appliedModifiers;

      // Try enhancement paths
      let enhancementPath = null;
      if (!this._inEnhancement) {
        const enhanced = this._findEnhancementPath(targetType, outputValue, totalOres);
        if (enhanced && enhanced.value > outputValue) {
          outputValue = enhanced.value;
          totalOres = enhanced.oreCount;
          enhancementPath = enhanced.path;
        }
      }

      const perOre = totalOres > 0 ? outputValue / totalOres : outputValue;
      const throughput = Math.max(1, Math.round(totalOres / (inputResults.reduce((s, r) => s + (r.oreCount || 0), 0) || 1)));

      if (!bestResult || outputValue > bestResult.value) {
        const item = new SolvedItem(targetType, outputValue, totalOres);
        item.machine = machineId;
        item.inputs = inputResults;
        item.resolvedType = inputResults[0]?._resolvedType || targetType;
        item.throughput = throughput;
        item.byproductOutputs = byproductOutputs || [];
        item.appliedModifiers = appliedModifiers || [];
        item.enhancementPath = enhancementPath;
        bestResult = item;
      }
    }

    return bestResult;
  }

  // ─── BEST PROCESSING (for byproduct types) ────────────

  _solveBestProcessing(itemType, baseOreValue) {
    const ds = this.config.hasDoubleSeller ? 2 : 1;
    let bestValue = 0;
    let bestResult = null;

    for (const [machineId, m] of this.registry.machines) {
      if (!this.registry.isAvailable(machineId, this.config)) continue;
      const skipEffects = new Set(["transport", "split", "overflow", "filter", "gate", "duplicate", "percent"]);
      if (skipEffects.has(m.effect)) continue;
      const outputType = m.outputs?.[0]?.type;
      if (!outputType || outputType === "same" || outputType === "passthrough") continue;

      const acceptsType = (m.inputs || []).some(inp =>
        inp === itemType || inp.split("|").includes(itemType) || inp === "any"
      );
      if ((m.inputs || []).includes("any") && outputType === itemType) continue;
      if (!acceptsType) continue;
      if (m.effect === "chance") continue;

      // Multi-input: all other inputs must be free
      if (m.inputs.length >= 2) {
        let allFree = true;
        for (const inputSpec of m.inputs) {
          const types = inputSpec.split("|");
          const t = types.find(tt => tt === itemType) || types[0];
          if (t === itemType) continue;
          const ir = this._solve(t, baseOreValue);
          if (!ir || ir.oreCount > 0) { allFree = false; break; }
        }
        if (!allFree) continue;
      }

      // Compute output value
      const rawValues = { stone: 0, dust: 1, metal_dust: 1, gem_dust: 1, clay: 50, ceramic_casing: 150, glass: 30, gem: 0, bricks: 25, blasting_powder: 2 };
      const inputItemValue = rawValues[itemType] ?? (this._prevPassValues?.get(itemType) || 0);
      let machineOutputValue = 0;

      if (m.effect === "set") machineOutputValue = m.value || 0;
      else if (m.effect === "flat") machineOutputValue = inputItemValue + (m.value || 0);
      else if (m.effect === "multiply") machineOutputValue = inputItemValue * (m.value || 1);
      else if (m.effect === "combine") {
        const inputResults = (m.inputs || []).map(inp => {
          const t = inp.split("|").find(tt => tt === itemType) || inp.split("|")[0];
          if (t === itemType) return { value: inputItemValue || bestValue || 0 };
          const ir = this._solve(t, baseOreValue);
          return ir || { value: 0 };
        });
        machineOutputValue = this.applyEffect(m, inputResults.map(r => r.value));
        const selfInputCount = m.inputs.filter(inp =>
          inp === itemType || inp.split("|").includes(itemType)
        ).length;
        if (selfInputCount > 1) machineOutputValue /= selfInputCount;
      }

      // Follow downstream processing chain
      let finalValue = machineOutputValue;
      const visited = new Set([itemType, outputType]);
      let currentType = outputType;
      let currentValue = machineOutputValue;
      const downstreamChain = [];

      for (let depth = 0; depth < 5; depth++) {
        // Find chance machines for intermediate types
        const intermediateChance = this._findChanceMachines(currentType, baseOreValue);
        for (const ic of intermediateChance) {
          finalValue += ic.chanceEV;
          downstreamChain.push({
            machine: ic.id, type: currentType, value: finalValue,
            isChanceMachine: true, chance: ic.chance, byproductValue: ic.byproductValue,
          });
        }

        // Find best next processing step
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
          const skipEff = new Set(["chance", "transport", "split", "overflow", "filter", "gate", "duplicate", "preserve"]);
          if (skipEff.has(nextM.effect)) continue;

          let nextValue = this._simulateEffect(nextM, currentValue);
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

      // Apply safe modifiers to final byproduct value
      const oreChainTags = this._oreChainTags || new Set();
      for (const [modId, modM] of this.registry.machines) {
        if (!this.registry.isAvailable(modId, this.config)) continue;
        if (!modM.inputs || modM.inputs.length !== 1 || !modM.tag) continue;
        const accepts = modM.inputs.some(inp =>
          inp === "any" || inp === currentType || inp.split("|").includes(currentType)
        );
        if (!accepts) continue;
        const outType = modM.outputs?.[0]?.type;
        if (outType && outType !== "same" && outType !== currentType) continue;
        if (!["flat", "percent", "multiply"].includes(modM.effect)) continue;
        if (downstreamChain.some(d => d.machine === modId)) continue;
        if (!oreChainTags.has(modM.tag)) continue;
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
        const item = new SolvedItem(itemType, finalValue, 0);
        item.machine = machineId;
        item.resolvedType = outputType;
        item.isByproduct = true;
        item.downstreamChain = downstreamChain;
        bestResult = item;
      }
    }

    // Chain chance machines on top of best path
    if (bestResult) {
      const chanceResult = this._chainChanceMachines(itemType, baseOreValue, bestResult);
      if (chanceResult) bestResult = chanceResult;
    }

    return bestResult || new SolvedItem(itemType, 0, 0);
  }

  // ─── CHANCE MACHINES ───────────────────────────────────

  _findChanceMachines(itemType, baseOreValue) {
    const results = [];
    for (const [chId, chM] of this.registry.machines) {
      if (chM.effect !== "chance") continue;
      if (!this.registry.isAvailable(chId, this.config)) continue;
      const accepts = (chM.inputs || []).some(inp =>
        inp === itemType || inp.split("|").includes(itemType)
      );
      if (!accepts) continue;
      let bpValue = 0;
      if (chM.byproducts?.[0]?.type) {
        const bpResult = this._solve(chM.byproducts[0].type, baseOreValue);
        bpValue = (bpResult?.value || 0) * (this.config.hasDoubleSeller ? 2 : 1);
      }
      const chanceEV = (chM.value || 0.05) * bpValue;
      if (chanceEV > 0) {
        results.push({ id: chId, chance: chM.value || 0.05, byproductValue: bpValue, chanceEV,
          bpType: chM.byproducts?.[0]?.type || "unknown", gemType: chM.gemType });
      }
    }
    // Dedup by function
    results.sort((a, b) => b.chanceEV - a.chanceEV);
    const seen = new Set();
    return results.filter(r => {
      const key = r.gemType ? `gem:${r.gemType}` : r.bpType;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  _chainChanceMachines(itemType, baseOreValue, bestResult) {
    const ds = this.config.hasDoubleSeller ? 2 : 1;
    const chanceMachines = [];

    for (const [machineId, m] of this.registry.machines) {
      if (m.effect !== "chance") continue;
      if (!this.registry.isAvailable(machineId, this.config)) continue;
      const accepts = (m.inputs || []).some(inp =>
        inp === itemType || inp.split("|").includes(itemType) || inp === "any"
      );
      if (!accepts) continue;
      if ((m.inputs || []).includes("any") && !m.gemType && !m.byproducts?.length) continue;

      let byproductValue = 0;
      if (m.gemType) {
        const gemData = typeof GEMS !== 'undefined' ? GEMS.find(g => g.name === m.gemType) : null;
        let gemVal = gemData?.value || 0;

        // Chain gem processing in correct order:
        // 1. Single-input processors (gem_cutter: multiply 1.4x)
        // 2. Flat modifiers (polisher: +$10) — before percentages to maximize
        // 3. Same-type combines (prismatic: gem+gem combine 1.15x)
        // 4. QA (percent 1.2x) — last for max effect

        // Step 1: Find and apply single-input gem processors (multiply/flat)
        let processed = gemVal;
        const skipEff = new Set(["chance", "transport", "split", "overflow", "filter", "gate", "duplicate", "preserve", "set", "combine"]);
        for (const [procId, procM] of this.registry.machines) {
          if (!this.registry.isAvailable(procId, this.config)) continue;
          if (!procM.inputs || procM.inputs.length !== 1) continue;
          if (skipEff.has(procM.effect)) continue;
          const acceptsGem = procM.inputs.some(inp => inp === "gem" || inp.split("|").includes("gem"));
          if (!acceptsGem) continue;
          if (procM.effect === "multiply") processed *= procM.value;
          else if (procM.effect === "flat") processed += procM.value;
        }

        // Step 2: Polisher (+$10 flat) — before combines/QA so they amplify it
        if (this._oreChainTags?.has("Polished")) processed += 10;

        // Step 3: Same-type combines (prismatic: gem+gem → 1.15x combined)
        for (const [combId, combM] of this.registry.machines) {
          if (!this.registry.isAvailable(combId, this.config)) continue;
          if (combM.effect !== "combine") continue;
          const allGem = (combM.inputs || []).every(inp => inp === "gem" || inp.split("|").includes("gem"));
          if (!allGem) continue;
          const inputCount = (combM.inputs || []).length;
          // Combined value per gem input: (N gems × value) × multiplier / N
          processed = processed * inputCount * (combM.value || 1) / inputCount;
        }

        // Step 4: QA (1.2x percent) — last
        const qa = this.registry.get("quality_assurance");
        if (qa && this.registry.isAvailable("quality_assurance", this.config)) {
          processed *= (1 + qa.value);
        }

        byproductValue = processed * ds;
      } else if (m.byproducts?.[0]?.type) {
        const bpResult = this._solve(m.byproducts[0].type, baseOreValue);
        byproductValue = bpResult?.value || 0;
      }

      chanceMachines.push({ id: machineId, chance: m.value || 0.05, byproductValue, gemType: m.gemType });
    }

    chanceMachines.sort((a, b) => b.byproductValue - a.byproductValue);
    const seenFuncs = new Set();
    const deduped = chanceMachines.filter(cm => {
      const m = this.registry.get(cm.id);
      const key = cm.gemType ? `gem:${cm.gemType}` : (m?.byproducts?.[0]?.type || "unknown");
      if (seenFuncs.has(key)) return false;
      seenFuncs.add(key);
      return true;
    });

    if (deduped.length > 0) {
      let totalChanceEV = 0;
      let remaining = 1.0;
      const chain = [];
      for (const cm of deduped) {
        totalChanceEV += remaining * cm.chance * cm.byproductValue;
        remaining *= (1 - cm.chance);
        chain.push({ machine: cm.id, chance: cm.chance, byproductValue: cm.byproductValue, gemType: cm.gemType, remainingAfter: remaining });
      }
      const combinedValue = totalChanceEV + remaining * bestResult.value;
      if (combinedValue > bestResult.value) {
        const newItem = new SolvedItem(itemType, combinedValue, 0);
        newItem.machine = bestResult.machine;
        newItem.resolvedType = bestResult.resolvedType;
        newItem.isByproduct = true;
        newItem.downstreamChain = bestResult.downstreamChain;
        newItem.chanceChain = chain;
        return newItem;
      }
    }
    return null;
  }

  // ─── MODIFIERS ─────────────────────────────────────────

  _applyModifiers(type, value, skipInputTypes, baseOreValue) {
    // Skip machines that are handled elsewhere:
    // - ore_cleaner, philosophers_stone, ore_upgrader: ore chain modifiers only
    // - quality_assurance: applied at terminal product level in buildFlow
    // - duplicator, crusher: not value modifiers
    // Polisher: Only apply to byproduct-derived items (oreCount=0) like ceramic, glass.
    // Ore-derived items (bar, bolts, etc.) already inherit "Polished" from the ore chain.
    // Check via skipInputTypes: if any input is ore-derived, polisher tag is inherited.
    const skipAlways = new Set(["quality_assurance", "ore_cleaner", "philosophers_stone", "ore_upgrader", "duplicator", "crusher"]);
    const hasOreInputs = type === "ore" || (skipInputTypes && [...skipInputTypes].some(t => {
      const r = this.memo.get(t);
      return r && r.oreCount > 0;
    }));
    const modifiers = this.registry.getModifiers(type).filter(id => {
      if (skipAlways.has(id)) return false;
      // Polisher: skip if any input is ore-derived (they inherit Polished from ore chain)
      if (id === "polisher" && hasOreInputs) return false;
      return true;
    });
    const applied = [];

    for (const modId of modifiers) {
      const mod = this.registry.get(modId);
      if (!mod || !this.registry.isAvailable(modId, this.config)) continue;

      // Multi-input modifiers: other inputs must be free
      if (mod.inputs && mod.inputs.length > 1) {
        const hasTarget = mod.inputs.some(inp => inp === type || inp.split("|").includes(type));
        if (!hasTarget) continue;
        let allFree = true;
        for (const inp of mod.inputs) {
          if (inp === type || inp.split("|").includes(type)) continue;
          const types = inp.split("|");
          const anyFree = types.some(t => {
            const v = this._solve(t, 0);
            return v && v.oreCount === 0;
          });
          if (!anyFree) { allFree = false; break; }
        }
        if (!allFree) continue;
      }

      if (skipInputTypes && skipInputTypes.size > 0) {
        const modInputTypes = (mod.inputs || []).flatMap(i => i.split("|"));
        const alreadyApplied = modInputTypes.some(t => skipInputTypes.has(t));
        if (alreadyApplied && type !== modInputTypes[0]) continue;
      }

      const prev = value;
      switch (mod.effect) {
        case "flat": value += mod.value; break;
        case "multiply": value *= mod.value; break;
        case "percent": value *= (1 + mod.value); break;
      }
      if (value !== prev) {
        applied.push({ id: modId, effect: mod.effect, modValue: mod.value, outputType: type });
      }
    }
    return { value, appliedModifiers: applied };
  }

  _applySafeModifiersToInputs(machine, inputResults, baseOreValue) {
    const oreChainTags = this._oreChainTags || new Set();
    for (let i = 0; i < inputResults.length; i++) {
      const inp = inputResults[i];
      const inputProducer = this.registry.get(inp.machine);
      const isImmune = inputProducer?.outputs?.some(o => o.modifierImmune);
      if (isImmune) continue;
      const otherTags = new Set(oreChainTags);
      for (const [modId, modM] of this.registry.machines) {
        if (!this.registry.isAvailable(modId, this.config)) continue;
        if (!modM.inputs || modM.inputs.length !== 1 || !modM.tag) continue;
        if (!otherTags.has(modM.tag)) continue;
        if (!["flat", "percent", "multiply"].includes(modM.effect)) continue;
        const inpType = inp._resolvedType || inp.resolvedType || "?";
        const accepts = modM.inputs.some(i2 =>
          i2 === "any" || i2 === inpType || i2.split("|").includes(inpType)
        );
        if (!accepts) continue;
        if (inp.machines?.includes(modId)) continue;
        let newVal = inp.value;
        if (modM.effect === "flat") newVal += modM.value;
        else if (modM.effect === "percent") newVal *= (1 + modM.value);
        else if (modM.effect === "multiply") newVal *= modM.value;
        if (newVal > inp.value) {
          inputResults[i] = { ...inp, value: newVal, _modifiedBy: modId };
        }
      }
    }
  }

  // ─── ENHANCEMENT PATHS ─────────────────────────────────

  _findEnhancementPath(sourceType, sourceValue, sourceOres) {
    if (this._inEnhancement) return null;
    this._inEnhancement = true;
    try {
      const convertAway = [];
      for (const [id, m] of this.registry.machines) {
        if (!this.registry.isAvailable(id, this.config)) continue;
        if (m.effect !== "preserve") continue;
        const accepts = (m.inputs || []).some(inp =>
          inp === sourceType || inp.split("|").includes(sourceType)
        );
        const outType = m.outputs?.[0]?.type;
        if (accepts && outType && outType !== sourceType) {
          convertAway.push({ machineId: id, outputType: outType });
        }
      }

      let best = null;
      const skipMods = new Set(["quality_assurance", "duplicator", "crusher"]);

      for (const { machineId: awayId, outputType: intermediateType } of convertAway) {
        let processedValue = sourceValue;
        let processedOres = sourceOres;
        let processedType = intermediateType;

        // Apply modifiers
        const mods = this.registry.getModifiers(intermediateType).filter(id => !skipMods.has(id));
        for (const modId of mods) {
          const mod = this.registry.get(modId);
          if (!this.registry.isAvailable(modId, this.config)) continue;
          if (mod.effect === "multiply") processedValue *= mod.value;
          else if (mod.effect === "flat") processedValue += mod.value;
          processedType = mod.outputs?.[0]?.type || processedType;
        }

        // Single-input processors
        const processors = [];
        for (const [prodId, prod] of this.registry.machines) {
          if (!this.registry.isAvailable(prodId, this.config)) continue;
          if (skipMods.has(prodId)) continue;
          if (prod.effect !== "multiply" && prod.effect !== "flat") continue;
          if ((prod.inputs || []).length !== 1) continue;
          const accepts = (prod.inputs || []).some(inp =>
            inp === processedType || inp.split("|").includes(processedType) ||
            inp === intermediateType || inp.split("|").includes(intermediateType)
          );
          if (!accepts || prod.effect === "preserve") continue;
          if (prod.effect === "multiply") processedValue *= prod.value;
          else if (prod.effect === "flat") processedValue += prod.value;
          processedType = prod.outputs?.[0]?.type || processedType;
          processors.push(prodId);
        }

        // Same-type combines (prismatic: gem+gem)
        for (const [combId, comb] of this.registry.machines) {
          if (!this.registry.isAvailable(combId, this.config)) continue;
          if (comb.effect !== "combine") continue;
          const allSame = (comb.inputs || []).every(inp =>
            inp === processedType || inp.split("|").includes(processedType) ||
            inp === intermediateType || inp.split("|").includes(intermediateType)
          );
          if (!allSame) continue;

          const inputCount = (comb.inputs || []).length;
          const combinedValue = processedValue * inputCount * (comb.value || 1);
          const combinedOres = processedOres * inputCount;
          const combinedType = comb.outputs?.[0]?.type || processedType;

          // Find convert-back
          for (const [backId, backM] of this.registry.machines) {
            if (!this.registry.isAvailable(backId, this.config)) continue;
            if (backM.effect !== "preserve") continue;
            const acceptsBack = (backM.inputs || []).some(inp =>
              inp === combinedType || inp.split("|").includes(combinedType) ||
              inp === processedType || inp.split("|").includes(processedType)
            );
            if (!acceptsBack || backM.outputs?.[0]?.type !== sourceType) continue;
            const perOre = combinedOres > 0 ? combinedValue / combinedOres : combinedValue;
            if (!best || perOre > best.perOre) {
              best = { value: combinedValue, oreCount: combinedOres, perOre, path: [awayId, ...processors, combId, backId] };
            }
          }
        }

        // Without combine
        for (const [backId, backM] of this.registry.machines) {
          if (!this.registry.isAvailable(backId, this.config)) continue;
          if (backM.effect !== "preserve") continue;
          const accepts = (backM.inputs || []).some(inp =>
            inp === processedType || inp.split("|").includes(processedType)
          );
          if (!accepts || backM.outputs?.[0]?.type !== sourceType) continue;
          const perOre = processedOres > 0 ? processedValue / processedOres : processedValue;
          if (!best || perOre > best.perOre) {
            best = { value: processedValue, oreCount: processedOres, perOre, path: [awayId, ...processors, backId] };
          }
        }
      }

      return best;
    } finally {
      this._inEnhancement = false;
    }
  }

  // ─── CHEAPEST PRODUCER (for set-effect machines) ───────

  _findCheapestProducer(type, baseOreValue, depth = 0) {
    if (depth > 5) return null;
    const producers = this.registry.getProducers(type);
    let cheapest = null;

    for (const prodId of producers) {
      const prodM = this.registry.get(prodId);
      if (!this.registry.isAvailable(prodId, this.config)) continue;
      if (!prodM?.inputs?.length) continue;

      let totalOres = 0;
      let valid = true;
      const inputs = [];

      for (const inp of prodM.inputs) {
        const t = inp.split("|")[0];
        let resolved = this._findCheapestProducer(t, baseOreValue, depth + 1);
        if (!resolved) resolved = this._solve(t, baseOreValue);
        if (!resolved) { valid = false; break; }
        totalOres += resolved.oreCount;
        inputs.push(resolved);
      }

      if (!valid || totalOres <= 0) continue;

      const outputValue = this._simulateEffect(prodM, inputs[0]?.value || 0);
      const bpRatio = prodM.byproductRatio || 0;
      const cheapestBPRatio = cheapest ? (this.registry.get(cheapest.machine)?.byproductRatio || 0) : 0;

      if (!cheapest || totalOres < cheapest.oreCount ||
          (totalOres === cheapest.oreCount && bpRatio > cheapestBPRatio)) {
        const cleanInputs = inputs.map(inp => {
          if (inp.machines) return { ...inp, machines: ["ore_source"] };
          return inp;
        });

        let byproductOutputs;
        if (prodM.byproducts) {
          byproductOutputs = prodM.byproducts.map(bp => ({
            type: bp.type,
            ratio: prodM.byproductRatio || 0.5,
            result: this._solve(bp.type, baseOreValue) || new SolvedItem(bp.type, 0, 0),
          }));
        }

        const item = new SolvedItem(type, outputValue, totalOres);
        item.machine = prodId;
        item.inputs = cleanInputs;
        item.byproductOutputs = byproductOutputs || [];
        item._cheapPath = true;
        cheapest = item;
      }
    }

    return cheapest;
  }

  // ─── HELPERS ───────────────────────────────────────────

  _simulateEffect(machine, inputValue) {
    switch (machine.effect) {
      case "flat": return inputValue + machine.value;
      case "multiply": return inputValue * machine.value;
      case "percent": return inputValue * (1 + machine.value);
      case "set": return machine.value;
      default: return inputValue;
    }
  }

  _handleCycleRef(type) {
    const prevVal = this._prevPassValues?.get(type);
    if (prevVal > 0) {
      const prevResult = this._prevPassResults?.get(type);
      if (prevResult) return { ...prevResult, isCycleRef: true };
      const isFree = this.registry.isByproduct(type) ||
        this.registry.getProducers(type).length === 0;
      return new SolvedItem(type, prevVal, isFree ? 0 : 1);
    }
    return new SolvedItem(type, 0, 0);
  }

  _findTerminals() {
    const allOutputTypes = new Set();
    for (const [id, m] of this.registry.machines) {
      if (!m.outputs) continue;
      for (const out of m.outputs) {
        if (out.type && out.type !== "same") allOutputTypes.add(out.type);
      }
    }
    const skip = new Set(["stone", "ore"]);
    return [...allOutputTypes].filter(t => !skip.has(t));
  }

  // ─── DUPLICATOR ────────────────────────────────────────

  _findBestDup(chainResult, terminalType, oreValue, qaMultiplier, ds) {
    const baseValue = chainResult.value * qaMultiplier * ds;
    const baseOres = chainResult.oreCount;
    const basePerOre = baseOres > 0 ? baseValue / baseOres : 0;

    const dupConfig = this.config.prestigeItems?.duplicator;
    if (!dupConfig) return null;
    const dupCount = typeof dupConfig === 'number' ? dupConfig : (dupConfig ? 10 : 0);
    if (dupCount <= 0) return null;
    const maxDups = Math.min(dupCount, 3);

    let currentBest = null;
    let currentPerOre = basePerOre;
    const usedDupLocations = [];

    for (let d = 0; d < maxDups; d++) {
      let bestThisRound = null;

      // Strategy 1: Dup at ore level
      if (d === 0) {
        const oreDup = this._tryDupAtOre(oreValue, chainResult, qaMultiplier, ds);
        if (oreDup && oreDup.perOre > currentPerOre) bestThisRound = oreDup;
      }

      // Strategy 2: Dup at combiner inputs
      const combDups = this._tryDupAtCombiners(chainResult, terminalType, oreValue, qaMultiplier, ds);
      for (const dup of combDups) {
        if (usedDupLocations.includes(dup.dupAt)) continue;
        const dupType = dup.dupAt.split(" in ")[0];
        if (usedDupLocations.some(loc => loc.split(" in ")[0] === dupType)) continue;
        if (dup.perOre > (bestThisRound?.perOre || currentPerOre)) bestThisRound = dup;
      }

      if (!bestThisRound) break;
      usedDupLocations.push(bestThisRound.dupAt);
      currentBest = bestThisRound;
      currentPerOre = bestThisRound.perOre;
      if (d === 0 && maxDups === 1) break;
    }

    return currentBest;
  }

  _tryDupAtOre(oreValue, chainResult, qaMultiplier, ds) {
    let val = oreValue;
    if (this.config.prestigeItems?.oreUpgrader) {
      const oreName = ORES.find(o => o.value === oreValue)?.name;
      if (oreName) {
        const upgraded = getUpgradedOreValue(oreName);
        if (upgraded !== null) val = upgraded;
      }
    }
    val *= 0.5;
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
    const dupOreValue = val * 2;
    const normalOre = this._solve("ore", oreValue);
    if (!normalOre || normalOre.value <= 0) return null;
    const ratio = dupOreValue / normalOre.value;
    const dupChainValue = chainResult.value * ratio * qaMultiplier * ds;
    return {
      totalValue: dupChainValue, totalOres: chainResult.oreCount,
      perOre: chainResult.oreCount > 0 ? dupChainValue / chainResult.oreCount : 0,
      dupAt: "ore (before flat bonuses)", productQty: 1,
    };
  }

  _tryDupAtCombiners(chainResult, terminalType, oreValue, qaMultiplier, ds) {
    const results = [];
    if (!chainResult.machine) return results;
    const termMachine = this.registry.get(chainResult.machine);
    if (!termMachine?.inputs || termMachine.inputs.length < 2) return results;

    const inputs = chainResult.inputs || [];
    for (let i = 0; i < inputs.length; i++) {
      const dupInput = inputs[i];
      if (!dupInput || dupInput.value <= 0) continue;
      const dupInputValue = dupInput.value * 0.5;
      let otherInputOres = 0;

      let perProduct;
      if (termMachine.effect === "combine") {
        let sum = dupInputValue;
        for (let j = 0; j < inputs.length; j++) {
          if (j === i) continue;
          sum += inputs[j].value;
          otherInputOres += inputs[j].oreCount;
        }
        perProduct = sum * termMachine.value;
      } else if (termMachine.effect === "multiplicative") {
        let prod = dupInputValue;
        for (let j = 0; j < inputs.length; j++) {
          if (j === i) continue;
          prod *= inputs[j].value;
          otherInputOres += inputs[j].oreCount;
        }
        perProduct = prod;
      } else {
        const modInputs = inputs.map((inp, j) => j === i ? { ...inp, value: dupInputValue } : inp);
        perProduct = this.applyEffect(termMachine, modInputs.map(r => r.value));
        for (let j = 0; j < inputs.length; j++) {
          if (j === i) continue;
          otherInputOres += inputs[j].oreCount;
        }
      }

      // Check if dup fills multiple slots
      const dupType = dupInput.resolvedType || dupInput._resolvedType || '';
      const dupMachine = dupInput.machine || '';
      let dupUsedElsewhere = false;
      function containsMachine(node, target) {
        if (!node) return false;
        if (node.machine === target) return true;
        return (node.inputs || []).some(c => containsMachine(c, target));
      }
      for (let j = 0; j < inputs.length; j++) {
        if (j === i) continue;
        if ((inputs[j].resolvedType || inputs[j]._resolvedType || '') === dupType) { dupUsedElsewhere = true; break; }
        if (dupMachine && containsMachine(inputs[j], dupMachine)) { dupUsedElsewhere = true; break; }
      }

      let totalValue, totalOres, perOre, products;
      if (dupUsedElsewhere) {
        products = 1;
        totalOres = chainResult.oreCount - dupInput.oreCount;
        totalValue = perProduct * qaMultiplier * ds;
        perOre = totalOres > 0 ? totalValue / totalOres : 0;
      } else {
        products = 2;
        totalOres = dupInput.oreCount + otherInputOres * products;
        totalValue = perProduct * products * qaMultiplier * ds;
        perOre = totalOres > 0 ? totalValue / totalOres : 0;
      }

      results.push({
        totalValue, totalOres, perOre, productQty: products,
        dupAt: (dupType || dupMachine || 'input') + " in " + terminalType,
      });
    }

    // Nested combiners
    for (const input of inputs) {
      if (!input.machine) continue;
      const inputMachine = this.registry.get(input.machine);
      if (!inputMachine?.inputs || inputMachine.inputs.length < 2) continue;
      const nestedDups = this._tryDupAtCombiners(input, input.resolvedType || input._resolvedType || '', oreValue, qaMultiplier, ds);
      for (const dup of nestedDups) {
        const newInputValue = dup.totalValue / (qaMultiplier * ds * dup.productQty);
        const valueDiff = newInputValue - input.value;
        const newParentValue = (chainResult.value + valueDiff * termMachine.value) * qaMultiplier * ds;
        const newTotalOres = chainResult.oreCount - input.oreCount + dup.totalOres;
        const perOre = newTotalOres > 0 ? newParentValue / newTotalOres : 0;
        results.push({ totalValue: newParentValue, totalOres: newTotalOres, perOre, dupAt: dup.dupAt, productQty: 1 });
      }
    }

    return results;
  }

  // ─── FLOW BUILDING ─────────────────────────────────────

  _buildFlow(terminalType, oreValue) {
    const ds = this.config.hasDoubleSeller ? 2 : 1;
    const chainResult = this._solve(terminalType, oreValue);
    if (!chainResult || chainResult.value <= 0) return null;

    let finalValue = chainResult.value;
    const qa = this.registry.get("quality_assurance");
    const qaMultiplier = (qa && this.registry.isAvailable("quality_assurance", this.config)) ? (1 + qa.value) : 1;
    finalValue *= qaMultiplier * ds;

    let totalOres = chainResult.oreCount;
    let dupAt = null;
    let productQty = 1;

    if (this.config.prestigeItems?.duplicator) {
      const dupResult = this._findBestDup(chainResult, terminalType, oreValue, qaMultiplier, ds);
      if (dupResult && dupResult.perOre > finalValue / totalOres) {
        finalValue = dupResult.totalValue;
        totalOres = dupResult.totalOres;
        dupAt = dupResult.dupAt;
        productQty = dupResult.productQty;
      }
    }

    const totalValue = finalValue;
    const perOre = totalOres > 0 ? totalValue / totalOres : 0;

    // Build chain name
    const tags = [];
    if (this.config.prestigeItems?.oreUpgrader) tags.push("Upgraded");
    const usesTransmuter = this.config.prestigeItems?.transmuters &&
      this.registry.isAvailable("bar_to_gem", this.config) &&
      this.registry.isAvailable("gem_to_bar", this.config);
    if (usesTransmuter) tags.push("Transmute");
    if (this.config.prestigeItems?.philosophersStone) tags.push("Infused");
    if (dupAt) tags.push("Dup");
    const suffix = tags.length ? " [" + tags.join(", ") + "]" : "";
    const displayType = ITEM_TYPES[terminalType] || terminalType;

    // Build graph directly from solver results
    const graph = FlowGraphBuilder.buildGraph(
      chainResult, this.registry, this.config,
      { dupAt, productQty }, {}, this.memo, totalOres
    );

    return {
      chain: displayType + suffix,
      totalValue, totalOres, perOre,
      endType: terminalType,
      totalCost: this._sumCosts(chainResult),
      flowGraph: graph, graph,
      value: totalValue,
      oresNeeded: totalOres,
      cost: this._sumCosts(chainResult),
      dupAt, productQty,
    };
  }

  _sumCosts(chainResult) {
    if (!chainResult) return 0;
    let total = 0;
    const counted = new Set();
    const count = (result) => {
      if (!result) return;
      if (result.machine && !counted.has(result.machine)) {
        counted.add(result.machine);
        const m = this.registry.get(result.machine);
        if (m?.cost) total += m.cost;
      }
      if (result.inputs) for (const inp of result.inputs) count(inp);
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
    count(chainResult);
    return total;
  }
}

// Backward compatibility alias — optimizer.js and app.js use FlowOptimizer
const FlowOptimizer = ChainSolver;
