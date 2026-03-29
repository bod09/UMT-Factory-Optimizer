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
            // Exclude "preserve" effect machines (transmuters) - they create cycles
            // Enhancement paths are discovered via _findEnhancementPath instead
            if (m.effect !== "preserve") {
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

    let finalResult = { ...qaResult, value: finalVal };

    // Duplicator optimization: test every position, support multiple dups
    if (this.config.prestigeItems?.duplicator && finalResult.recipeTree) {
      const best = this.optimizeDuplicators(finalResult);
      if (best) {
        const displayTree = this.injectDuplicatorNodes(finalResult.recipeTree, best.positions);
        finalResult = {
          ...finalResult,
          value: best.totalValue,
          oreCount: best.totalOres,
          recipeTree: displayTree,
          dupAt: best.label,
          productQty: best.productQty || 1,
        };
      }
    }

    return finalResult;
  }

  // === DUPLICATOR OPTIMIZATION SYSTEM ===
  // Tests every position in the recipe tree, supports unlimited duplicators,
  // handles excess selling, and produces a modified tree for graph display.

  optimizeDuplicators(baseResult) {
    const basePerOre = baseResult.value / baseResult.oreCount;
    const dsMultiplier = this.config.hasDoubleSeller ? 2 : 1;

    // Assign unique IDs to every node
    let nextId = 0;
    function assignIds(tree) {
      if (!tree) return;
      tree._dupId = nextId++;
      for (const inp of tree.inputs || []) assignIds(inp);
    }
    assignIds(baseResult.recipeTree);

    // Collect all candidate nodes (skip byproduct sources)
    const candidates = [];
    function collectCandidates(tree) {
      if (!tree) return;
      if (tree.machine !== "byproduct_source") {
        candidates.push(tree);
      }
      for (const inp of tree.inputs || []) collectCandidates(inp);
    }
    collectCandidates(baseResult.recipeTree);

    // Check if node A is an ancestor of node B
    function isAncestor(tree, ancestorId, descendantId) {
      if (!tree) return false;
      if (tree._dupId === ancestorId) {
        function hasDesc(n) {
          if (!n) return false;
          if (n._dupId === descendantId) return true;
          return (n.inputs || []).some(hasDesc);
        }
        return hasDesc(tree);
      }
      return (tree.inputs || []).some(inp => isAncestor(inp, ancestorId, descendantId));
    }

    let bestResult = null;

    // Test single duplicator placements
    for (const cand of candidates) {
      const result = this.evalTreeWithDups(baseResult.recipeTree, new Set([cand._dupId]), dsMultiplier);
      if (!result || result.totalOres <= 0) continue;
      const perOre = result.totalValue / result.totalOres;
      if (perOre > basePerOre && (!bestResult || perOre > bestResult.perOre)) {
        bestResult = { perOre, totalValue: result.totalValue, totalOres: result.totalOres,
          productQty: result.productQty || 1,
          positions: [cand._dupId], label: cand.machine + ":" + cand.type };
      }
    }

    // Test pairs of duplicators
    if (bestResult && candidates.length <= 30) {
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i], b = candidates[j];
          if (isAncestor(baseResult.recipeTree, a._dupId, b._dupId)) continue;
          if (isAncestor(baseResult.recipeTree, b._dupId, a._dupId)) continue;

          const result = this.evalTreeWithDups(baseResult.recipeTree, new Set([a._dupId, b._dupId]), dsMultiplier);
          if (!result || result.totalOres <= 0) continue;
          const perOre = result.totalValue / result.totalOres;
          if (perOre > bestResult.perOre) {
            bestResult = { perOre, totalValue: result.totalValue, totalOres: result.totalOres,
              productQty: result.productQty || 1,
              positions: [a._dupId, b._dupId],
              label: a.machine + ":" + a.type + " + " + b.machine + ":" + b.type };
          }
        }
      }
    }

    return bestResult;
  }

  // Core quantity-aware tree evaluator
  evalTreeWithDups(tree, dupNodeIds, dsMultiplier) {
    const result = this._evalDup(tree, dupNodeIds, 1);
    if (!result) return null;
    // Total = (per-item value × qty + excess) × DS
    const totalValue = (result.value * result.qty + result.excessValue) * dsMultiplier;
    return { totalValue, totalOres: result.oreCount, productQty: result.qty };
  }

  // Recursive: returns { value (per item), qty, oreCount, excessValue }
  _evalDup(node, dupNodeIds, qtyNeeded) {
    if (!node) return null;
    const isDuped = dupNodeIds.has(node._dupId);
    const machine = this.registry.get(node.machine);

    // Leaf nodes (ore_source, byproduct_source)
    if (!node.inputs || node.inputs.length === 0) {
      const qty = isDuped ? qtyNeeded * 2 : qtyNeeded;
      const valuePerItem = isDuped ? node.value * 0.5 : node.value;
      return { value: valuePerItem, qty, oreCount: (node.oreCount || 0) * qtyNeeded, excessValue: 0 };
    }

    const isSingleInput = node.inputs.length === 1;

    if (isSingleInput) {
      const childResult = this._evalDup(node.inputs[0], dupNodeIds, qtyNeeded);
      if (!childResult) return null;

      // Apply machine effect to each item independently
      let perItemValue;
      if (!machine) {
        perItemValue = childResult.value;
      } else {
        switch (machine.effect) {
          case "flat": perItemValue = childResult.value + machine.value; break;
          case "multiply": perItemValue = childResult.value * machine.value; break;
          case "percent": perItemValue = childResult.value * (1 + machine.value); break;
          case "set": perItemValue = machine.value; break;
          case "preserve": perItemValue = childResult.value; break;
          default:
            if (node.value > 0 && node.inputs[0].value > 0) {
              perItemValue = node.value * (childResult.value / node.inputs[0].value);
            } else { perItemValue = childResult.value; }
        }
      }

      let outQty = childResult.qty;
      let outValue = perItemValue;
      if (isDuped) { outQty *= 2; outValue *= 0.5; }

      return { value: outValue, qty: outQty, oreCount: childResult.oreCount, excessValue: childResult.excessValue };
    }

    // Multi-input (combine) machine
    // First pass: evaluate all inputs at base qty to find if any are duplicated
    const firstPass = [];
    for (const inp of node.inputs) {
      const res = this._evalDup(inp, dupNodeIds, qtyNeeded);
      if (!res) return null;
      firstPass.push(res);
    }

    // Find max qty from any duplicated input
    const maxQty = Math.max(...firstPass.map(r => r.qty));

    // If any input produces more (was duplicated), re-evaluate other inputs
    // at the higher qty so the combiner can run maxQty times
    const inputResults = [];
    for (let i = 0; i < node.inputs.length; i++) {
      if (firstPass[i].qty >= maxQty) {
        inputResults.push(firstPass[i]);
      } else {
        // Re-evaluate this input requesting maxQty items
        const res = this._evalDup(node.inputs[i], dupNodeIds, maxQty);
        if (!res) return null;
        inputResults.push(res);
      }
    }

    // Products = minQty (should now be maxQty if all inputs scaled up)
    const products = Math.min(...inputResults.map(r => r.qty));

    // Track excess from inputs that still produce more than needed
    let totalExcess = inputResults.reduce((s, r) => s + r.excessValue, 0);
    let totalOres = 0;
    for (let i = 0; i < inputResults.length; i++) {
      const r = inputResults[i];
      if (r.qty > products) {
        const excessQty = r.qty - products;
        totalExcess += excessQty * r.value * (this.config.hasDoubleSeller ? 2 : 1);
      }
      totalOres += r.oreCount;
    }

    // Combine effect
    let perProductValue;
    if (machine?.effect === "combine") {
      perProductValue = inputResults.reduce((s, r) => s + r.value, 0) * machine.value;
    } else {
      perProductValue = node.value;
    }

    let outQty = products;
    let outValue = perProductValue;
    if (isDuped) { outQty *= 2; outValue *= 0.5; }

    return { value: outValue, qty: outQty, oreCount: totalOres, excessValue: totalExcess };
  }

  // Inject duplicator nodes into a cloned recipe tree for graph display
  injectDuplicatorNodes(recipeTree, dupPositions) {
    function cloneTree(node) {
      if (!node) return null;
      return { ...node, inputs: (node.inputs || []).map(cloneTree) };
    }
    const tree = cloneTree(recipeTree);
    const dupSet = new Set(dupPositions);

    function injectDups(node) {
      if (!node) return node;
      if (node.inputs) {
        for (let i = 0; i < node.inputs.length; i++) {
          node.inputs[i] = injectDups(node.inputs[i]);
        }
      }
      if (dupSet.has(node._dupId)) {
        return {
          machine: "duplicator", type: node.type, value: node.value * 0.5,
          oreCount: node.oreCount, inputs: [node], _isDuplicator: true,
        };
      }
      return node;
    }
    return injectDups(tree);
  }


  resolveType(targetType, oreValue, visiting) {
    // Check if this type is a byproduct-origin type (produced from smelter byproducts,
    // not from ore). Detect dynamically: if the type can only be reached through
    // byproduct chains (stone/dust paths), it costs 0 ores.
    if (this._isByproductType(targetType)) {
      const value = this._getByproductTypeValue(targetType);
      const recipeTree = { machine: "byproduct_free", type: targetType, value, oreCount: 0, inputs: [], _isFreeByproduct: true };
      return { type: targetType, value, tags: new Set(), oreCount: 0, path: [{ machine: "byproduct_free", type: targetType, value }], recipeTree };
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

      // Build ore recipe tree: chain of modifiers applied
      let oreTree = { machine: "ore_source", type: "ore", value: oreValue, oreCount: 1, inputs: [] };
      for (const step of path.slice(1)) { // skip ore_source
        oreTree = { machine: step.machine, type: "ore", value: step.value, oreCount: 1, inputs: [oreTree] };
      }

      return { type: "ore", value: val, tags, oreCount: 1, path, recipeTree: oreTree };
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

      // Build path (flat for backwards compat)
      const path = [];
      for (const inp of inputStates) {
        path.push(...(inp.path || []));
      }
      path.push({ machine: machineId, type: targetType, value: outputValue, inputs: inputStates.map(s => s.type) });

      // Build recipe tree (hierarchical, for graph visualization)
      const recipeTree = {
        machine: machineId,
        type: targetType,
        value: outputValue,
        oreCount: totalOres,
        inputs: inputStates.map(s => s.recipeTree || { machine: "ore_source", type: s.type, value: s.value, oreCount: s.oreCount, inputs: [] }),
      };

      // Apply type-specific modifiers (Tempering Forge for bars, etc.)
      let result = { type: targetType, value: outputValue, tags: allTags, oreCount: totalOres, path, recipeTree };
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

    // Wrap recipe tree with this modifier
    const recipeTree = {
      machine: modId,
      type: item.type,
      value: newValue,
      oreCount: item.oreCount,
      inputs: [item.recipeTree || { machine: "unknown", type: item.type, value: item.value, oreCount: item.oreCount, inputs: [] }],
    };

    return { ...item, value: newValue, tags: newTags, path, recipeTree };
  }

  // Transmuter side path: bar → gem → gem_cutter → prismatic → gem_to_bar
  // Calculated from machine data, not hardcoded
  applyTransmuterSidePath(barItem) {
    const barToGem = this.registry.get("bar_to_gem");
    const gemCutter = this.registry.get("gem_cutter");
    const prismatic = this.registry.get("prismatic_crucible");
    const gemToBar = this.registry.get("gem_to_bar");

    if (!barToGem || !gemCutter || !prismatic || !gemToBar) return null;

    // 2 bars → bar_to_gem → 2 gems → gem_cutter each → 2 cut gems → prismatic (combine) → 1 bar
    const cutGemValue = barItem.value * (gemCutter.value || 1.4);
    // Prismatic combines 2 cut gems: (cutGem + cutGem) * 1.15
    const val = (cutGemValue + cutGemValue) * (prismatic.value || 1.15);
    // gem_to_bar (preserve)

    const newTags = new Set(barItem.tags);
    const path = [...(barItem.path || [])];
    path.push({ machine: "bar_to_gem", type: "gem", value: barItem.value });
    path.push({ machine: "gem_cutter", type: "cut_gem", value: barItem.value * gemCutter.value });
    path.push({ machine: "prismatic_crucible", type: "prismatic_gem", value: val });
    path.push({ machine: "gem_to_bar", type: "bar", value: val });

    // Recipe tree for transmuter side path
    const barTree = barItem.recipeTree || { machine: "ore_source", type: "bar", value: barItem.value, oreCount: barItem.oreCount, inputs: [] };
    const recipeTree = {
      machine: "gem_to_bar",
      type: "bar",
      value: val,
      oreCount: barItem.oreCount * 2,
      label: "Transmuter Side Path",
      inputs: [{
        machine: "prismatic_crucible",
        type: "prismatic_gem",
        value: val,
        oreCount: barItem.oreCount * 2,
        inputs: [
          { machine: "gem_cutter", type: "cut_gem", value: barItem.value * gemCutter.value, oreCount: barItem.oreCount, inputs: [
            { machine: "bar_to_gem", type: "gem", value: barItem.value, oreCount: barItem.oreCount, inputs: [barTree] }
          ]},
          { machine: "gem_cutter", type: "cut_gem", value: barItem.value * gemCutter.value, oreCount: barItem.oreCount, inputs: [
            { machine: "bar_to_gem", type: "gem", value: barItem.value, oreCount: barItem.oreCount, inputs: [barTree] }
          ]},
        ]
      }]
    };

    // 2 bars consumed (2 ores) → 1 enhanced bar
    return { ...barItem, value: val, tags: newTags, path, oreCount: barItem.oreCount * 2, recipeTree };
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

  // Check if a type originates from byproduct chains (not from ore)
  // Traces backwards through machine inputs to see if it reaches ore or only byproducts
  _isByproductType(type) {
    if (this._byproductTypeCache) return this._byproductTypeCache.has(type);

    // Build the cache: find all types reachable only through byproduct chains
    // Start from known byproduct origins: types produced as byproducts by any machine
    const byproductTypes = new Set();

    // Find all types that appear as byproducts of any machine
    for (const [, m] of this.registry.machines) {
      for (const bp of m.byproducts || []) {
        byproductTypes.add(bp.type);
      }
    }

    // Expand: any type producible ONLY from byproduct types is also a byproduct type
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 20) {
      changed = false;
      iterations++;
      for (const [machineId, m] of this.registry.machines) {
        if (!m.outputs?.[0]?.type) continue;
        const outType = m.outputs[0].type;
        if (byproductTypes.has(outType)) continue;
        // Check if ALL inputs are byproduct types or the same type (passthrough)
        const inputs = m.inputs || [];
        if (inputs.length === 0) continue;
        const allInputsByproduct = inputs.every(inp => {
          const types = inp.split("|");
          return types.some(t => byproductTypes.has(t) || t === "any");
        });
        if (allInputsByproduct) {
          byproductTypes.add(outType);
          changed = true;
        }
      }
    }

    // Don't count types that are also producible from ore chains
    // (e.g., "bar" can come from ore but stone comes from smelter byproduct)
    // Remove types that have a production path from ore
    const oreReachable = new Set(["ore", "bar"]);
    changed = true;
    iterations = 0;
    while (changed && iterations < 20) {
      changed = false;
      iterations++;
      for (const [, m] of this.registry.machines) {
        if (!m.outputs?.[0]?.type) continue;
        const outType = m.outputs[0].type;
        if (oreReachable.has(outType)) continue;
        const inputs = m.inputs || [];
        const anyInputFromOre = inputs.some(inp => {
          const types = inp.split("|");
          return types.some(t => oreReachable.has(t));
        });
        if (anyInputFromOre) {
          oreReachable.add(outType);
          changed = true;
        }
      }
    }

    // A type is a byproduct type if it's in byproductTypes but NOT in oreReachable
    // Exception: types that are in BOTH (like "dust" which can come from crusher(stone))
    // are still byproduct types because their PRIMARY source is free
    const finalByproductTypes = new Set();
    for (const t of byproductTypes) {
      if (!oreReachable.has(t) || t === "stone" || t === "dust") {
        finalByproductTypes.add(t);
      }
    }

    // Also add downstream types only reachable from these
    changed = true;
    iterations = 0;
    while (changed && iterations < 20) {
      changed = false;
      iterations++;
      for (const [, m] of this.registry.machines) {
        if (!m.outputs?.[0]?.type) continue;
        const outType = m.outputs[0].type;
        if (finalByproductTypes.has(outType)) continue;
        if (oreReachable.has(outType)) continue;
        const inputs = m.inputs || [];
        if (inputs.length === 0) continue;
        const allInputsByproduct = inputs.every(inp => {
          const types = inp.split("|");
          return types.some(t => finalByproductTypes.has(t) || t === "any");
        });
        if (allInputsByproduct) {
          finalByproductTypes.add(outType);
          changed = true;
        }
      }
    }

    this._byproductTypeCache = finalByproductTypes;
    return finalByproductTypes.has(type);
  }

  // Get the value for a byproduct type by tracing through machines
  _getByproductTypeValue(type) {
    // Find what machine produces this type and what value it sets
    for (const [, m] of this.registry.machines) {
      if (!m.outputs?.[0]) continue;
      if (m.outputs[0].type === type && m.effect === "set") {
        return m.value || 0;
      }
    }
    // Check byproduct entries
    for (const [, m] of this.registry.machines) {
      for (const bp of m.byproducts || []) {
        if (bp.type === type) return 0; // direct byproducts are free
      }
    }
    return 0;
  }
}

// ChainDiscoverer removed - all chain discovery now handled by FlowOptimizer in flow.js

// === GRAPH GENERATOR ===
// Builds {nodes, edges} for visualization from a production path.

class GraphGenerator {
  // Build from recipe tree: collapsed view with quantities
  static fromRecipeTree(tree, registry, actualOreCount, config, productQty, flowInfo = {}) {
    const nodes = [];
    const edges = [];
    let nextId = 0;

    // Collapse identical sub-chains: find unique processing pipelines
    // Walk the tree and build a DAG
    function getNodeKey(treeNode) {
      // Key by machine + type to identify duplicates
      return treeNode.machine + ":" + treeNode.type;
    }

    // Flatten the tree into a linearized list of unique nodes
    // Count how many times each sub-chain appears (quantity)
    const uniqueNodes = new Map(); // key → { treeNode, quantity, children[] }

    function walkTree(treeNode, parentKey) {
      const key = getNodeKey(treeNode);

      if (uniqueNodes.has(key)) {
        // Same machine+type already exists - increment run count
        const existing = uniqueNodes.get(key);
        existing.quantity += 1;
        // Still add the edge from this to parent
        if (parentKey) {
          const edgeKey = key + "->" + parentKey;
          if (!existing.parentEdges.has(edgeKey)) {
            existing.parentEdges.add(edgeKey);
          }
        }
        return key;
      }

      const nodeData = {
        treeNode,
        quantity: 1,
        childKeys: [],
        parentEdges: new Set(),
      };
      if (parentKey) nodeData.parentEdges.add(key + "->" + parentKey);
      uniqueNodes.set(key, nodeData);

      // Walk children
      for (const child of treeNode.inputs || []) {
        const childKey = walkTree(child, key);
        if (!nodeData.childKeys.includes(childKey)) {
          nodeData.childKeys.push(childKey);
        }
      }

      return key;
    }

    walkTree(tree, null);

    // Fix quantities: walk the FULL tree counting every occurrence of each key
    // (the collapsing above undercounts due to shared object references from memoization)
    const flowCounts = new Map();
    function countFlows(treeNode) {
      if (!treeNode) return;
      const key = getNodeKey(treeNode);
      flowCounts.set(key, (flowCounts.get(key) || 0) + 1);
      for (const child of treeNode.inputs || []) {
        countFlows(child);
      }
    }
    countFlows(tree);
    // Apply corrected quantities
    for (const [key, data] of uniqueNodes) {
      data.quantity = flowCounts.get(key) || data.quantity;
    }

    // Scale quantities if duplicator changed the actual ore count
    // The recipe tree has the original structure, but the duplicator may need
    // more ores (e.g., doubling combiner inputs). Scale all quantities proportionally.
    if (actualOreCount) {
      const treeOreCount = flowCounts.get("ore_source:ore") || 1;
      if (actualOreCount !== treeOreCount && treeOreCount > 0) {
        const scale = actualOreCount / treeOreCount;
        for (const [key, data] of uniqueNodes) {
          data.quantity = Math.round(data.quantity * scale);
        }
      }
    }

    // Build nodes and edges from unique set
    const keyToId = new Map();

    // Topological sort: children first, then parents
    const sorted = [];
    const visited = new Set();
    function topoSort(key) {
      if (visited.has(key)) return;
      visited.add(key);
      const data = uniqueNodes.get(key);
      if (data) {
        for (const childKey of data.childKeys) {
          topoSort(childKey);
        }
      }
      sorted.push(key);
    }
    topoSort(getNodeKey(tree));

    // Assign layers based on depth from leaves
    const depthMap = new Map();
    for (const key of sorted) {
      const data = uniqueNodes.get(key);
      let maxChildDepth = -1;
      for (const ck of data.childKeys) {
        maxChildDepth = Math.max(maxChildDepth, depthMap.get(ck) || 0);
      }
      depthMap.set(key, maxChildDepth + 1);
    }

    for (const key of sorted) {
      const data = uniqueNodes.get(key);
      const tn = data.treeNode;
      // Skip byproduct_free nodes - they're shown in the byproduct sub-graph
      if (tn.machine === "byproduct_free" || tn._isFreeByproduct) {
        continue;
      }
      const machine = registry.get(tn.machine);
      let category = machine?.category || "source";
      let name = machine?.name || (tn.machine === "ore_source" ? "Ore Input" : tn.machine);
      if (tn.machine === "byproduct" || tn.machine === "byproduct_source" || tn.machine === "smelter_byproduct") {
        const typeName = ITEM_TYPES[tn.type] || tn.type;
        name = typeName + " (Byproduct)";
        category = "stonework";
      }
      if (tn.machine === "unknown") {
        name = ITEM_TYPES[tn.type] || tn.type;
      }
      if (tn.machine === "duplicator" || tn._isDuplicator) {
        name = "Duplicator";
        category = "prestige";
      }
      if (tn.machine === "excess_seller") {
        name = "Sell Excess";
        category = "source";
      }

      const id = nextId++;
      keyToId.set(key, id);

      nodes.push({
        id,
        name,
        type: tn.type,
        value: tn.value,
        category,
        layer: depthMap.get(key),
        quantity: data.quantity,
      });
    }

    // Create edges
    for (const key of sorted) {
      const data = uniqueNodes.get(key);
      const fromId = keyToId.get(key);
      for (const ck of data.childKeys) {
        const toId = keyToId.get(ck);
        if (toId !== undefined) {
          edges.push({ from: toId, to: fromId, itemType: uniqueNodes.get(ck).treeNode.type });
        }
      }
    }

    // Add byproduct processing chains using the flow system
    // For each machine that produces byproducts, resolve the optimal path
    // for each byproduct type through ALL available machines
    for (const [key, data] of uniqueNodes) {
      const tn = data.treeNode;
      const machine = registry.get(tn.machine);
      if (!machine?.byproducts) continue;

      const sourceId = keyToId.get(key);
      if (sourceId === undefined) continue;
      const sourceLayer = depthMap.get(key) || 0;
      const sourceQty = data.quantity || 1;
      const bpRatio = machine.byproductRatio || 0.5;

      for (const bp of machine.byproducts) {
        const bpQty = Math.round(sourceQty * bpRatio) || 1;
        let currentLayer = sourceLayer;

        // Byproduct source node
        const bpName = (ITEM_TYPES[bp.type] || bp.type) + " (Byproduct)";
        const bpId = nextId++;
        nodes.push({ id: bpId, name: bpName, type: bp.type, value: 0, category: "stonework",
          layer: currentLayer, isByproduct: true, quantity: bpQty });
        edges.push({ from: sourceId, to: bpId, itemType: bp.type, isByproduct: true });
        currentLayer++;

        // Use the flow system: find ALL machines that accept this type and build the chain
        const byproductChain = GraphGenerator._resolveByproductChain(bp.type, bpQty, registry, config, currentLayer);

        // Add all resolved chain nodes and edges to the graph
        const idMapping = new Map(); // local chain id → global graph id
        for (const chainNode of byproductChain.nodes) {
          const globalId = nextId++;
          idMapping.set(chainNode.id, globalId);
          nodes.push({ ...chainNode, id: globalId, isByproduct: true });
        }

        // Connect byproduct source to first chain node
        if (byproductChain.nodes.length > 0) {
          const firstChainId = idMapping.get(byproductChain.nodes[0].id);
          edges.push({ from: bpId, to: firstChainId, itemType: bp.type, isByproduct: true });
        }

        // Add chain edges
        for (const chainEdge of byproductChain.edges) {
          const fromId = idMapping.get(chainEdge.from);
          const toId = idMapping.get(chainEdge.to);
          if (fromId !== undefined && toId !== undefined) {
            edges.push({ ...chainEdge, from: fromId, to: toId });
          }
        }

        // Connect loop-back edges (sifted ore → ore processing chain)
        for (const loopBack of byproductChain.loopBacks) {
          const fromId = idMapping.get(loopBack.fromId);
          if (fromId === undefined) continue;

          // If sifted ores benefit from Ore Upgrader but it's not in the main graph,
          // add it as a byproduct-section node
          let target = null;
          if (loopBack.type === "ore" && flowInfo.siftedUsesUpgrader) {
            // Check if Ore Upgrader exists in main graph
            target = nodes.find(n => n.name === "Ore Upgrader");
            if (!target) {
              // Add Ore Upgrader node in the byproduct section
              const upgraderMachine = registry.get("ore_upgrader");
              if (upgraderMachine) {
                const upgraderId = nextId++;
                // Position at Ore Cleaner's layer - they'll stack vertically
                // (Ore Cleaner on main row, Ore Upgrader below in byproduct row)
                const oreCleanerNode = nodes.find(n => n.name === "Ore Cleaner");
                const upgraderLayer = oreCleanerNode ? (oreCleanerNode.layer || 1) : 1;
                const upgraderNode = {
                  id: upgraderId,
                  name: upgraderMachine.name,
                  type: "ore",
                  value: null,
                  category: upgraderMachine.category || "prestige",
                  layer: upgraderLayer,
                  isByproduct: true,
                };
                nodes.push(upgraderNode);
                target = upgraderNode;
                // Connect Ore Upgrader to the first ore processor in main chain
                const oreProcessors = nodes.filter(n =>
                  n.type === "ore" && !n.isByproduct && n.name !== "Ore Input" && n.name !== "Ore Upgrader"
                );
                oreProcessors.sort((a, b) => (a.layer || 0) - (b.layer || 0));
                const nextProcessor = oreProcessors[0];
                if (nextProcessor) {
                  edges.push({ from: upgraderId, to: nextProcessor.id, itemType: "ore", isByproduct: true });
                }
              }
            }
          }

          // Fallback: find first ore processor in main graph
          if (!target) {
            const processors = nodes.filter(n =>
              n.type === loopBack.type && !n.isByproduct && n.name !== "Ore Input"
            );
            processors.sort((a, b) => (a.layer || 0) - (b.layer || 0));
            target = processors[0] || nodes.find(n => n.name === "Ore Input");
          }

          if (target) {
            edges.push({ from: fromId, to: target.id, itemType: loopBack.type, isByproduct: true, isLoopBack: true });
          }
        }

        // Connect remaining outputs to main chain or sell
        for (const connect of byproductChain.connections) {
          let fromId = idMapping.get(connect.fromId);
          if (fromId === undefined) continue;

          // Check if the node that produced this connection is a DUPLICATE of a main graph machine
          // If so, remove the duplicate and connect from its parent instead
          const bpNode = byproductChain.nodes.find(n => n.id === connect.fromId);
          if (bpNode) {
            // Find if this machine already exists in the main graph
            for (const [nodeKey, nodeData] of uniqueNodes) {
              const mainNodeId = keyToId.get(nodeKey);
              if (mainNodeId === undefined) continue;
              const mainMachine = registry.get(nodeData.treeNode.machine);
              if (mainMachine?.name === bpNode.name) {
                // This machine exists in main graph - connect the byproduct chain's
                // PREVIOUS node directly to the main graph machine, skip the duplicate
                const parentEdge = byproductChain.edges.find(e => e.to === connect.fromId);
                if (parentEdge) {
                  const parentGlobalId = idMapping.get(parentEdge.from);
                  if (parentGlobalId !== undefined) {
                    edges.push({ from: parentGlobalId, to: mainNodeId, itemType: connect.type, isByproduct: true });
                    // Remove the duplicate node
                    const dupGlobalId = idMapping.get(connect.fromId);
                    const dupIdx = nodes.findIndex(n => n.id === dupGlobalId);
                    if (dupIdx !== -1) nodes.splice(dupIdx, 1);
                    // Remove edges to/from the duplicate
                    for (let i = edges.length - 1; i >= 0; i--) {
                      if (edges[i].from === dupGlobalId || edges[i].to === dupGlobalId) {
                        edges.splice(i, 1);
                      }
                    }
                  }
                }
                fromId = null; // skip further connection handling
                break;
              }
            }
          }
          if (fromId === null) continue;

          // Find a consumer for this type in the main graph
          let connected = false;
          for (const [nodeKey, nodeData] of uniqueNodes) {
            const nodeId = keyToId.get(nodeKey);
            if (nodeId === undefined) continue;
            const m = registry.get(nodeData.treeNode.machine);
            if (!m) continue;
            const accepts = (m.inputs || []).some(inp =>
              inp === connect.type || inp.split("|").includes(connect.type)
            );
            if (accepts) {
              edges.push({ from: fromId, to: nodeId, itemType: connect.type, isByproduct: true });
              connected = true;
              break;
            }
          }

          if (!connected) {
            // No consumer in main graph - add a sell node
            const sellId = nextId++;
            nodes.push({ id: sellId, name: "Sell " + (ITEM_TYPES[connect.type] || connect.type),
              type: connect.type, value: connect.value || 0, category: "source",
              layer: currentLayer + 1, isByproduct: true, quantity: connect.qty });
            edges.push({ from: fromId, to: sellId, itemType: connect.type, isByproduct: true });
          }
        }
      }
    }

    // Apply productQty to final product nodes (when duplicator doubles combiner output)
    const pQty = productQty || 1;
    if (pQty > 1) {
      // Find the root node (final product) and its direct parents (QA etc.)
      const rootData = uniqueNodes.get(getNodeKey(tree));
      if (rootData) rootData.quantity = pQty;
      // Also update nodes in the chain between the combiner output and root
      // Walk up from root: QA, electronic_tuner, etc.
      function updateUpstream(nodeKey) {
        const data = uniqueNodes.get(nodeKey);
        if (!data) return;
        data.quantity = Math.max(data.quantity, pQty);
        // Update the actual node object
        const nodeObj = nodes.find(n => n.id === keyToId.get(nodeKey));
        if (nodeObj) nodeObj.quantity = data.quantity;
      }
      // Update root and its single-input parents
      let currentKey = getNodeKey(tree);
      for (let i = 0; i < 5; i++) { // max 5 levels up (QA, tuner, etc.)
        updateUpstream(currentKey);
        const data = uniqueNodes.get(currentKey);
        if (!data || data.childKeys.length !== 1) break;
        // If this node has exactly 1 child and that child is a combine machine, stop
        const childData = uniqueNodes.get(data.childKeys[0]);
        if (childData && (data.treeNode.inputs || []).length > 1) break;
        currentKey = data.childKeys[0];
      }
    }

    // Add seller at end
    const rootKey = getNodeKey(tree);
    const rootId = keyToId.get(rootKey);
    if (rootId !== undefined) {
      const sellerId = nextId++;
      nodes.push({
        id: sellerId,
        name: "Seller",
        type: tree.type,
        value: tree.value,
        category: "source",
        layer: (depthMap.get(rootKey) || 0) + 1,
        quantity: pQty,
      });
      edges.push({ from: rootId, to: sellerId, itemType: tree.type });
    }

    return { nodes, edges };
  }

  // Resolve the optimal processing chain for a byproduct type using the registry
  // Returns { nodes, edges, loopBacks, connections } for the byproduct sub-graph
  static _resolveByproductChain(itemType, quantity, registry, config, startLayer) {
    const nodes = [];
    const edges = [];
    const loopBacks = []; // { fromId, type } - items that loop back to main chain
    const connections = []; // { fromId, type, qty, value } - items that connect to main graph or sell
    let nextId = 0;
    let currentLayer = startLayer;
    let currentType = itemType;
    let currentQty = quantity;
    let prevId = null;
    const visitedTypes = new Set(); // prevent processing same type twice
    const usedMachines = new Set(); // prevent using same machine twice
    let iterations = 0;

    while (currentQty > 0 && !visitedTypes.has(currentType) && iterations < 10) {
      iterations++;
      visitedTypes.add(currentType);

      // Find ALL machines that accept this type as input
      const candidates = [];
      for (const [machineId, m] of registry.machines) {
        if (!registry.isAvailable(machineId, config)) continue;
        if (usedMachines.has(machineId)) continue;
        const hasAnyInput = (m.inputs || []).includes("any");
        const acceptsType = (m.inputs || []).some(inp =>
          inp === currentType || inp.split("|").includes(currentType)
        );
        if (!acceptsType && !hasAnyInput) continue;
        // "any" input machines (crusher): only allow for specific conversions
        if (hasAnyInput && !acceptsType) {
          // Only allow if it converts to a different type (stone→dust)
          if (m.effect !== "set") continue;
          // Don't crush items that have better uses
          if (currentType === "dust" || currentType === "ore" || currentType === "bar") continue;
        }
        candidates.push({ machineId, machine: m });
      }

      if (candidates.length === 0) {
        // Nothing processes this type - sell it
        connections.push({ fromId: prevId, type: currentType, qty: currentQty, value: 0 });
        break;
      }

      // Separate chance machines:
      // Sifters: have a tag (Sifted) preventing re-processing, only one can run per item
      // Prospectors: no tag, multiple can chain, sort by byproduct value (highest first)
      const allChanceMachines = candidates.filter(c => c.machine.effect === "chance");
      const sifters = allChanceMachines.filter(c => c.machine.tag);
      const prospectors = allChanceMachines.filter(c => !c.machine.tag);
      // Sort prospectors by byproduct value (gemValue) highest first
      prospectors.sort((a, b) => (b.machine.gemValue || 0) - (a.machine.gemValue || 0));

      // Prospectors: stone passes through (main flow, solid line), gems are byproduct (dotted)
      // Sorted highest value first (Diamond → Ruby → Sapphire → Emerald → Topaz)
      for (const { machineId, machine } of prospectors) {
        const gemChance = machine.value || 0.05;
        const gemsProduced = Math.round(currentQty * gemChance);

        const nodeId = nextId++;
        const gemType = machine.byproducts?.[0]?.type || machine.gemType || "gem";
        nodes.push({ id: nodeId, name: machine.name || machineId, type: currentType,
          value: machine.gemValue || 0, category: machine.category || "jewelcrafting",
          layer: currentLayer, quantity: currentQty });

        if (prevId !== null) {
          // Stone entering prospector is main flow (solid)
          edges.push({ from: prevId, to: nodeId, itemType: currentType, isByproduct: false });
        }

        // Gem byproduct (dotted line)
        if (gemsProduced > 0) {
          connections.push({ fromId: nodeId, type: gemType, qty: gemsProduced,
            value: machine.gemValue || 0, isByproduct: true });
        }

        currentQty = Math.round(currentQty * (1 - gemChance));
        prevId = nodeId;
        currentLayer++;
        usedMachines.add(machineId);
      }

      // Sifters BEFORE converters: passthrough input, produce byproduct at chance rate
      if (sifters.length > 0) {
        // Pick best (highest chance)
        sifters.sort((a, b) => (b.machine.value || 0) - (a.machine.value || 0));
        const { machineId, machine } = sifters[0];
        const siftChance = machine.value || 0.1;
        const converted = Math.round(currentQty * siftChance);
        const remaining = currentQty - converted;

        const nodeId = nextId++;
        nodes.push({ id: nodeId, name: machine.name || machineId, type: currentType,
          value: 0, category: machine.category || "prestige",
          layer: currentLayer, quantity: currentQty });

        if (prevId !== null) {
          // Dust entering sifter is main flow, not byproduct
          edges.push({ from: prevId, to: nodeId, itemType: currentType, isByproduct: false });
        }

        // Converted output (ore) loops back to main chain
        if (converted > 0) {
          const outputType = machine.byproducts?.[0]?.type || "ore";
          loopBacks.push({ fromId: nodeId, type: outputType, qty: converted });
        }

        // Remaining continues as same type with Sifted tag
        currentQty = remaining;
        prevId = nodeId;
        currentLayer++;
        usedMachines.add(machineId);
      }

      // Crusher/converter: changes type (stone → dust, etc.)
      // Runs AFTER sifters so sifters get first pass at the items
      if (currentQty > 0) {
        const converters = candidates.filter(c =>
          c.machine.effect === "set" && c.machine.outputs?.[0]?.type &&
          c.machine.outputs[0].type !== currentType && !usedMachines.has(c.machineId) &&
          // Only single-input converters (crusher), not multi-input (cement_mixer needs dust+stone)
          (c.machine.inputs || []).length <= 1 || (c.machine.inputs || []).every(i => i === currentType || i === "any")
        );
        if (converters.length > 0) {
          // Pick the highest value converter (best output)
          converters.sort((a, b) => (b.machine.value || 0) - (a.machine.value || 0));
          const { machineId, machine } = converters[0];
          const outputType = machine.outputs[0].type;
          const nodeId = nextId++;
          nodes.push({ id: nodeId, name: machine.name || machineId, type: outputType,
            value: machine.value || 1, category: machine.category || "stonework",
            layer: currentLayer, quantity: currentQty });

          if (prevId !== null) {
            // Main flow continues (solid line) - stone→crusher, dust→clay etc.
            edges.push({ from: prevId, to: nodeId, itemType: currentType, isByproduct: false });
          }
          prevId = nodeId;
          currentLayer++;
          usedMachines.add(machineId);
          currentType = outputType;
          continue; // Restart loop with new type
        }
      }

      // Regular processors: flat/multiply/combine on remaining items
      if (currentQty > 0) {
        const processors = candidates.filter(c =>
          c.machine.effect !== "chance" && c.machine.effect !== "set" &&
          c.machine.effect !== "chance_convert" &&
          c.machineId !== "sifter" && c.machineId !== "nano_sifter" &&
          c.machineId !== "crusher"
        );

        if (processors.length > 0) {
          // Pick best value processor
          processors.sort((a, b) => (b.machine.value || 0) - (a.machine.value || 0));
          const { machineId, machine } = processors[0];
          const outputType = machine.outputs?.[0]?.type || currentType;
          const nodeId = nextId++;
          nodes.push({ id: nodeId, name: machine.name || machineId, type: outputType,
            value: machine.value || 0, category: machine.category || "stonework",
            layer: currentLayer, quantity: Math.ceil(currentQty / (machine.inputs?.length || 1)) });

          if (prevId !== null) {
            edges.push({ from: prevId, to: nodeId, itemType: currentType, isByproduct: false });
          }

          // Output goes to main chain or sell
          connections.push({ fromId: nodeId, type: outputType,
            qty: Math.ceil(currentQty / (machine.inputs?.length || 1)),
            value: machine.value || 0 });
          break;
        } else {
          // Nothing left to process - sell remaining
          connections.push({ fromId: prevId, type: currentType, qty: currentQty, value: 0 });
          break;
        }
      }

      break; // Safety: prevent infinite loop
    }

    return { nodes, edges, loopBacks, connections };
  }

  // Legacy: flat path-based graph (for factory builder)
  static fromPath(path, registry) {
    if (!path || path.length === 0) return { nodes: [], edges: [] };

    const nodes = [];
    const edges = [];
    let nodeId = 0;
    const machineToNode = new Map();

    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const machine = registry.get(step.machine);
      const category = machine?.category || "source";
      const name = machine?.name || (step.machine === "ore_source" ? "Ore" : step.machine);

      const node = {
        id: nodeId++,
        name: name,
        type: step.type,
        value: step.value,
        category: category,
        layer: i,
      };
      nodes.push(node);

      if (i > 0 && !machineToNode.has(step.machine)) {
        const prevNode = nodes[i - 1];
        edges.push({ from: prevNode.id, to: node.id, itemType: prevNode.type });
      }

      machineToNode.set(step.machine, node);
    }

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
