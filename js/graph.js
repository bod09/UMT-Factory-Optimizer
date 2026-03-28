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
    // Stone is the only true base byproduct - free from smelting
    if (targetType === "stone") {
      const recipeTree = { machine: "smelter_byproduct", type: "stone", value: 0, oreCount: 0, inputs: [] };
      return { type: "stone", value: 0, tags: new Set(), oreCount: 0, path: [{ machine: "smelter_byproduct", type: "stone", value: 0 }], recipeTree };
    }

    // Dust comes from Crusher(stone) - build the chain dynamically
    if (targetType === "dust") {
      const crusher = this.registry.get("crusher");
      if (crusher) {
        const stoneResult = this.resolveType("stone", oreValue, new Set(visiting));
        if (stoneResult) {
          const dustValue = crusher.value || 1; // crusher sets value to $1
          const path = [...(stoneResult.path || []), { machine: "crusher", type: "dust", value: dustValue }];
          const recipeTree = {
            machine: "crusher", type: "dust", value: dustValue, oreCount: 0,
            inputs: [stoneResult.recipeTree || { machine: "smelter_byproduct", type: "stone", value: 0, oreCount: 0, inputs: [] }],
          };
          return { type: "dust", value: dustValue, tags: new Set(), oreCount: 0, path, recipeTree };
        }
      }
      // Fallback
      const recipeTree = { machine: "crusher", type: "dust", value: 1, oreCount: 0, inputs: [] };
      return { type: "dust", value: 1, tags: new Set(), oreCount: 0, path: [{ machine: "crusher", type: "dust", value: 1 }], recipeTree };
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
}

// ChainDiscoverer removed - all chain discovery now handled by FlowOptimizer in flow.js

// === GRAPH GENERATOR ===
// Builds {nodes, edges} for visualization from a production path.

class GraphGenerator {
  // Build from recipe tree: collapsed view with quantities
  static fromRecipeTree(tree, registry, actualOreCount, config, productQty) {
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

    // Add byproduct processing chain from machines with byproducts
    // All machines found from registry, quantities from byproductRatio and config
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
        let prevId = sourceId;
        let currentLayer = sourceLayer;

        // Byproduct source node (e.g., Stone from smelter)
        const bpName = (ITEM_TYPES[bp.type] || bp.type) + " (Byproduct)";
        const bpId = nextId++;
        nodes.push({ id: bpId, name: bpName, type: bp.type, value: 0, category: "stonework", layer: currentLayer, isByproduct: true, quantity: bpQty });
        edges.push({ from: sourceId, to: bpId, itemType: bp.type, isByproduct: true });
        prevId = bpId;
        currentLayer++;

        // Find machines that process this byproduct type from registry
        let remaining = bpQty;

        // Chance machines (prospectors): consume input at chance rate
        for (const [machineId, m] of registry.machines) {
          if (!m.inputs?.includes(bp.type) || m.effect !== "chance") continue;
          if (!registry.isAvailable(machineId, config)) continue;

          const produced = Math.round(remaining * (m.value || 0.05));
          const chanceId = nextId++;
          nodes.push({ id: chanceId, name: m.name || machineId, type: m.gemType || "gem",
            value: 0, category: m.category || "jewelcrafting", layer: currentLayer,
            isByproduct: true, quantity: produced || 1 });
          edges.push({ from: prevId, to: chanceId, itemType: bp.type, isByproduct: true });
          remaining = Math.round(remaining * (1 - (m.value || 0.05)));
          prevId = chanceId;
        }

        // Crusher: converts remaining to dust (find from registry)
        for (const [machineId, m] of registry.machines) {
          if (m.effect !== "set" || !m.outputs?.[0]) continue;
          if (!m.inputs?.includes("any") && !m.inputs?.includes(bp.type)) continue;
          if (m.outputs[0].type !== "dust") continue;
          if (!registry.isAvailable(machineId, config)) continue;

          const crushId = nextId++;
          nodes.push({ id: crushId, name: m.name || machineId, type: "dust",
            value: m.value || 1, category: m.category || "stonework", layer: currentLayer,
            isByproduct: true, quantity: remaining });
          edges.push({ from: prevId, to: crushId, itemType: bp.type, isByproduct: true });
          prevId = crushId;
          currentLayer++;
          break;
        }

        // Sifter/Nano Sifter: find best available from registry
        let dustRemaining = remaining;
        let bestSifter = null;

        // First check for chance_convert type
        for (const [machineId, m] of registry.machines) {
          if (!m.inputs?.includes("dust")) continue;
          if (m.effect !== "chance_convert" && machineId !== "sifter" && machineId !== "nano_sifter") continue;
          if (!registry.isAvailable(machineId, config)) continue;
          if (!bestSifter || (m.value || 0) > (bestSifter.m.value || 0)) {
            bestSifter = { id: machineId, m };
          }
        }

        if (bestSifter) {
          const { id: machineId, m } = bestSifter;
          const siftChance = m.value || 0.1;
          const oreProduced = Math.round(dustRemaining * siftChance);
          const siftId = nextId++;
          nodes.push({ id: siftId, name: m.name || machineId, type: "dust",
            value: 0, category: m.category || "prestige", layer: currentLayer,
            isByproduct: true, quantity: dustRemaining });
          // Dust entering sifter is main byproduct flow (not a secondary byproduct)
          edges.push({ from: prevId, to: siftId, itemType: "dust", isByproduct: false });

          // Ore output is the BYPRODUCT of sifting - connect back to ore cleaner in main graph
          if (oreProduced > 0) {
            // Find the ore_cleaner node in the main graph to loop back to
            const oreCleanerNode = nodes.find(n => n.name === "Ore Cleaner" || n.machineId === "ore_cleaner");
            if (oreCleanerNode) {
              // Loop back to ore cleaner with byproduct edge
              edges.push({ from: siftId, to: oreCleanerNode.id, itemType: "ore", isByproduct: true, isLoopBack: true });
            } else {
              // Fallback: find any ore-processing node in main graph
              const oreNode = nodes.find(n => n.type === "ore" && !n.isByproduct);
              if (oreNode) {
                edges.push({ from: siftId, to: oreNode.id, itemType: "ore", isByproduct: true, isLoopBack: true });
              } else {
                // Last resort: show as labeled node
                const oreOutId = nextId++;
                nodes.push({ id: oreOutId, name: "Ore → Ore Cleaner", type: "ore",
                  value: 0, category: "metalwork", layer: currentLayer,
                  isByproduct: true, quantity: oreProduced });
                edges.push({ from: siftId, to: oreOutId, itemType: "ore", isByproduct: true });
              }
            }
          }

          dustRemaining = dustRemaining - oreProduced;
          prevId = siftId;
          currentLayer++;
        }

        // Connect remaining dust to whatever dust-consuming machine exists in the main graph
        // The optimizer already chose the best dust path - find it automatically
        if (dustRemaining > 0) {
          let connected = false;

          // Find any machine in the main graph that accepts dust as input
          for (const [nodeKey, nodeData] of uniqueNodes) {
            const nodeId = keyToId.get(nodeKey);
            if (nodeId === undefined) continue;
            const m = registry.get(nodeData.treeNode.machine);
            if (!m) continue;
            // Check if this machine accepts dust (directly or via "any")
            const acceptsDust = (m.inputs || []).some(inp =>
              inp === "dust" || inp.split("|").includes("dust")
            );
            if (acceptsDust) {
              edges.push({ from: prevId, to: nodeId, itemType: "dust", isByproduct: true });
              connected = true;
              break;
            }
          }

          if (!connected) {
            // No dust consumer in main graph - find best from registry and show it
            let bestDustMachine = null;
            for (const [machineId, m] of registry.machines) {
              if (!registry.isAvailable(machineId, config)) continue;
              if (!(m.inputs || []).some(inp => inp === "dust" || inp.split("|").includes("dust"))) continue;
              if (machineId === "crusher" || machineId === "sifter" || machineId === "nano_sifter") continue;
              const outVal = m.value || 0;
              if (!bestDustMachine || outVal > bestDustMachine.value) {
                bestDustMachine = { id: machineId, ...m };
              }
            }

            if (bestDustMachine) {
              const dustMachineId = nextId++;
              nodes.push({ id: dustMachineId, name: bestDustMachine.name || bestDustMachine.id,
                type: bestDustMachine.outputs?.[0]?.type || "item",
                value: bestDustMachine.value || 0,
                category: bestDustMachine.category || "stonework",
                layer: currentLayer, isByproduct: true, quantity: dustRemaining });
              edges.push({ from: prevId, to: dustMachineId, itemType: "dust", isByproduct: true });
            } else {
              // Truly nothing - sell directly
              const dustSellId = nextId++;
              nodes.push({ id: dustSellId, name: "Sell Dust", type: "dust",
                value: 1, category: "source", layer: currentLayer,
                isByproduct: true, quantity: dustRemaining });
              edges.push({ from: prevId, to: dustSellId, itemType: "dust", isByproduct: true });
            }
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
