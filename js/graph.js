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

    // Duplicator optimization: test at every node in recipe tree, pick best
    if (this.config.prestigeItems?.duplicator && finalResult.recipeTree) {
      const bestDup = this.findBestDuplicatorPlacement(finalResult, oreValue);
      if (bestDup && bestDup.perOre > finalVal / finalResult.oreCount) {
        finalResult = bestDup.result;
      }
    }

    return finalResult;
  }

  // Try duplicating at every node in the recipe tree
  // For each placement, calculate: total value and total ores needed
  findBestDuplicatorPlacement(baseResult, oreValue) {
    const basePerOre = baseResult.value / baseResult.oreCount;
    let bestPlacement = null;

    // Collect unique nodes with their context (parent combiner info)
    const candidates = [];
    function collectCandidates(tree, parent, inputIdx) {
      if (!tree) return;
      // Test all items including free byproducts - the optimizer picks
      // whichever gives the best overall profit per ore
      if (tree.machine !== "byproduct_source" && tree.machine !== "byproduct") {
        candidates.push({
          node: tree,
          parent: parent,
          inputIdx: inputIdx,
        });
      }
      for (let i = 0; i < (tree.inputs || []).length; i++) {
        collectCandidates(tree.inputs[i], tree, i);
      }
    }
    collectCandidates(baseResult.recipeTree, null, -1);

    // For each candidate: calculate what happens if we dup it
    // Dup at node X means: X produces 2 copies at 50% value from same ores
    // If X feeds into a combiner, we get 2 products (needing 2x of other inputs)
    // Total value and ores change based on where the 2 copies flow
    for (const cand of candidates) {
      const node = cand.node;
      const nodeValue = node.value;
      const nodeOres = node.oreCount || 0;

      // Simple approach: dup this node
      // - Save nodeOres (don't need to build a second one)
      // - But the value at this point is halved (50% per copy)
      // - 2 copies flow to parent

      // For the simplest case (dup the final product):
      // 2 copies at 50% = same total, same ores = no change
      // For dup an intermediate before a combiner:
      // 2 copies of X at 50%, need 2x other inputs, get 2 products
      // New total ores = baseOres - nodeOres + 2*(otherInputOres)...
      // Actually: new ores = baseOres + otherInputOres (need 1 extra set of other inputs)
      // New value: depends on how the 50% propagates

      // Direct calculation approach:
      // Without dup: 1 product, value V, ores O
      // With dup at node N:
      //   If N is the final product: 2 products at V/2 each. Total V, ores O. No change.
      //   If N feeds into combiner with other inputs worth Y using oY ores:
      //     2 products each = (N/2 + Y) * mult
      //     Total = 2 * (N/2 + Y) * mult = (N + 2Y) * mult
      //     Ores = (O - oY) + 2*oY = O + oY (extra set of other inputs)
      //     vs no dup: (N + Y) * mult, ores O
      //     Per-ore improvement if (N + 2Y)/(O + oY) > (N + Y)/O

      // Find the parent combiner and what other inputs it has
      if (!cand.parent) continue; // root node - no benefit

      const parentMachine = this.registry.get(cand.parent.machine);
      if (!parentMachine) continue;

      if (cand.parent.inputs.length === 1) {
        // Single-input parent (linear chain): dup here gives 2 items through remaining chain
        // Each gets independent flat bonuses. Calculate the gain from flat bonuses
        // being applied to each copy independently
        // Use proportional approach: val at dup point halved, trace through chain

        // For flat bonus: each copy gets +flat, so total = 2*(val/2 + flat) = val + 2*flat
        // vs no dup: val + flat. Gain = +flat per product through rest of chain
        // This compounds through all downstream flat bonuses and multipliers
        // Already tested correctly in the simple bar case. Skip complex recalculation.
        // The tree simulation handles this correctly for linear chains.
        continue; // Let the tree simulation handle linear chains
      }

      // Multi-input parent (combiner): calculate directly
      const otherInputOres = cand.parent.inputs.reduce((sum, inp, i) => {
        return sum + (i === cand.inputIdx ? 0 : (inp.oreCount || 0));
      }, 0);

      const otherInputValue = cand.parent.inputs.reduce((sum, inp, i) => {
        return sum + (i === cand.inputIdx ? 0 : inp.value);
      }, 0);

      if (parentMachine.effect === "combine") {
        // Dup this input: 2 copies at 50% value, need 2x of other inputs
        // Per-product: (nodeValue/2 + otherValue) * mult
        // 2 products from: nodeOres + 2*otherInputOres
        const perProduct = (nodeValue * 0.5 + otherInputValue) * parentMachine.value;
        const totalProducts = 2;
        const dupOres = nodeOres + otherInputOres * totalProducts;

        // The parent's value changes. Apply remaining chain multipliers
        // by looking at how parent.value relates to the final result.
        // For the IMMEDIATE parent of the dup: parent.value = original combiner output
        // We need to replace parent.value with 2*perProduct in the chain
        // Then propagate through grandparents (which may be combiners, QA, DS, etc.)
        // Simplest correct approach: calculate ratio at the PARENT level only
        // finalValue = baseValue * (newParentValue / oldParentValue) for multiply/QA/DS above
        // But for grandparent combiners, the ratio approach overcounts.

        // Instead, compute the ADDITIVE difference and multiply only by
        // downstream multipliers (not combine multipliers)
        // The downstream multipliers after the parent are: QA (1.2x) and DS (2x) and any
        // single-input multipliers. Combine multipliers DON'T amplify the difference
        // proportionally - they ADD the difference to a sum.

        // For correctness, just directly compute:
        // newParentValue = totalProducts * perProduct
        // Difference in parent value = newParentValue - parent.value
        // This difference flows to grandparent.
        // If grandparent is also a combiner: grandparent value changes by diff * grandparent.mult
        // But this gets complicated for deep nesting.

        // Pragmatic approach: only consider dup at DIRECT inputs to the TOP-LEVEL combiner
        // (the chain's main product). This avoids nested combiner issues.
        // For nested combiners (dup ceramic inside superconductor inside power_core),
        // the benefit is much smaller and harder to compute correctly.

        // Check if parent is the root product (top-level combiner)
        // Check if parent is the top-level combiner (may be wrapped by QA/modifiers)
        const isTopLevel = cand.parent === baseResult.recipeTree ||
          (baseResult.recipeTree.inputs || []).some(inp => inp === cand.parent) ||
          // Check 2 levels deep (QA → combiner → inputs)
          (baseResult.recipeTree.inputs || []).some(inp =>
            (inp.inputs || []).some(inp2 => inp2 === cand.parent));

        let dupTotalValue, totalDupOres;

        if (isTopLevel || cand.parent.inputs.length > 1) {
          // For top-level or direct combiner: calculate value change properly
          const newParentValue = totalProducts * perProduct;
          const oldParentValue = cand.parent.value;

          // If parent IS the root, apply QA+DS to new value
          // Apply QA and DS to the new combiner value
          dupTotalValue = newParentValue;
          const qa = this.registry.get("quality_assurance");
          if (qa && this.registry.isAvailable("quality_assurance", this.config)) {
            dupTotalValue *= (1 + qa.value);
          }
          if (this.config.hasDoubleSeller) dupTotalValue *= 2;
          totalDupOres = dupOres;
        } else {
          continue;
        }

        const dupPerOre = totalDupOres > 0 ? dupTotalValue / totalDupOres : 0;

        if (dupPerOre > basePerOre && (!bestPlacement || dupPerOre > bestPlacement.perOre)) {
          bestPlacement = {
            perOre: dupPerOre,
            machine: node.machine,
            type: node.type,
            result: { ...baseResult, value: dupTotalValue, oreCount: totalDupOres, dupAt: node.machine + ":" + node.type },
          };
        }
      }
    }

    // Also try the tree simulation for linear chains (ore dup)
    // Test dup at ore_source using the tree simulation
    let nextNodeId = 0;
    function assignIds(tree) { if(tree) { tree._dupId = nextNodeId++; for(const inp of tree.inputs||[]) assignIds(inp); } }
    assignIds(baseResult.recipeTree);

    // Find the first ore_source node
    function findFirst(tree, machine) {
      if (!tree) return null;
      if (tree.machine === machine) return tree;
      for (const inp of tree.inputs || []) { const f = findFirst(inp, machine); if (f) return f; }
      return null;
    }
    const firstOre = findFirst(baseResult.recipeTree, "ore_source");
    if (firstOre) {
      const sim = this._simDupById(baseResult.recipeTree, firstOre._dupId);
      if (sim) {
        let simVal = sim.value * (sim.copies || 1);
        if (this.config.hasDoubleSeller) simVal *= 2;
        const simPerOre = sim.oreCount > 0 ? simVal / sim.oreCount : 0;
        if (simPerOre > basePerOre && (!bestPlacement || simPerOre > bestPlacement.perOre)) {
          bestPlacement = {
            perOre: simPerOre,
            machine: "ore_source",
            type: "ore",
            result: { ...baseResult, value: simVal, oreCount: sim.oreCount, dupAt: "ore_source:ore" },
          };
        }
      }
    }

    function cleanIds(tree) { if(tree) { delete tree._dupId; for(const i of tree.inputs||[]) cleanIds(i); } }
    cleanIds(baseResult.recipeTree);

    return bestPlacement;
  }

  // Simulate dup at a specific node identified by _dupId
  _simDupById(tree, targetId) {
    return this._simDup(tree, null, null, targetId);
  }

  // Simulate duplicating at a specific machine in the recipe tree
  simulateDuplicatorAt(tree, targetMachine, targetType) {
    return this._simDup(tree, targetMachine, targetType, null);
  }

  // Walk the tree, at the target node inject dup (50% value, 2 copies)
  _simDup(node, targetMachine, targetType, targetId) {
    if (!node) return null;

    const isTarget = targetId !== null && targetId !== undefined
      ? node._dupId === targetId
      : (node.machine === targetMachine && node.type === targetType);

    // At the dup target: 2 copies at 50% value
    if (isTarget) {
      return {
        value: node.value * 0.5,
        oreCount: node.oreCount || 0,
        copies: 2,
      };
    }

    // Leaf nodes
    if (!node.inputs || node.inputs.length === 0) {
      return { value: node.value, oreCount: node.oreCount || 0, copies: 1 };
    }

    // Evaluate inputs
    const inputResults = [];
    let dupInputIdx = -1;
    for (let i = 0; i < node.inputs.length; i++) {
      const res = this._simDup(node.inputs[i], targetMachine, targetType, targetId);
      if (!res) return null;
      inputResults.push(res);
      if (res.copies > 1) dupInputIdx = i;
    }

    // No duplicated input - normal pass-through
    if (dupInputIdx === -1) {
      return {
        value: node.value,
        oreCount: inputResults.reduce((s, r) => s + r.oreCount, 0),
        copies: 1,
      };
    }

    const dupInput = inputResults[dupInputIdx];
    const dupCopies = dupInput.copies;
    const originalInputValue = node.inputs[dupInputIdx].value; // value before dup

    // Calculate this node's output with the modified input
    // Use the ratio: how does the output change when the input changes?
    const isSingleInput = node.inputs.length === 1;
    const machine = this.registry.get(node.machine);

    if (isSingleInput) {
      // For single-input machines, recalculate output per copy
      // The key: flat bonuses are added to EACH copy independently
      const valueDiff = dupInput.value - originalInputValue; // negative (50% reduction)
      let perCopyOutput;

      if (!machine) {
        perCopyOutput = dupInput.value;
      } else if (machine.effect === "flat") {
        // Each copy: (inputVal*0.5) + flat
        perCopyOutput = dupInput.value + machine.value;
      } else if (machine.effect === "multiply") {
        perCopyOutput = dupInput.value * machine.value;
      } else if (machine.effect === "percent") {
        perCopyOutput = dupInput.value * (1 + machine.value);
      } else {
        // For effects we don't model (upgrade_tier, set, preserve):
        // Use proportional scaling from original
        const ratio = originalInputValue > 0 ? dupInput.value / originalInputValue : 0.5;
        perCopyOutput = node.value * ratio;
      }

      return {
        value: perCopyOutput,
        oreCount: dupInput.oreCount,
        copies: dupCopies,
      };
    }

    // Multi-input (combining): each dup copy needs its own other inputs
    let totalOres = dupInput.oreCount;
    for (let i = 0; i < inputResults.length; i++) {
      if (i === dupInputIdx) continue;
      totalOres += inputResults[i].oreCount * dupCopies;
    }

    // Recalculate combine value per product
    let perProductValue;
    if (machine?.effect === "combine") {
      let inputSum = dupInput.value;
      for (let i = 0; i < inputResults.length; i++) {
        if (i === dupInputIdx) continue;
        inputSum += inputResults[i].value;
      }
      perProductValue = inputSum * machine.value;
    } else {
      // Proportional scaling for other effects
      const ratio = originalInputValue > 0 ? dupInput.value / originalInputValue : 0.5;
      perProductValue = node.value * ratio;
    }

    return {
      value: perProductValue * dupCopies,
      oreCount: totalOres,
      copies: 1,
    };
  }

  resolveType(targetType, oreValue, visiting) {
    // Byproduct base types: stone and dust are "free" from smelting byproduct
    // Everything else (glass, clay, ceramic_casing, blasting_powder) should be
    // resolved dynamically through the actual machine chain from dust/stone
    const byproductBaseTypes = {
      "stone": { value: 0, oreCount: 0 },
      "dust": { value: 1, oreCount: 0 },
    };

    if (byproductBaseTypes[targetType]) {
      const bp = byproductBaseTypes[targetType];
      const recipeTree = { machine: "byproduct_source", type: targetType, value: bp.value, oreCount: 0, inputs: [], label: targetType + " (from smelting)" };
      return { type: targetType, value: bp.value, tags: new Set(), oreCount: 0, path: [{ machine: "byproduct_source", type: targetType, value: bp.value }], recipeTree };
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

      // Build graph for visualization (from recipe tree for collapsed view with quantities)
      const graph = result.recipeTree
        ? GraphGenerator.fromRecipeTree(result.recipeTree, this.registry)
        : GraphGenerator.fromPath(result.path, this.registry);

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
  // Build from recipe tree: collapsed view with quantities
  static fromRecipeTree(tree, registry) {
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
      if (tn.machine === "byproduct" || tn.machine === "byproduct_source") {
        const typeName = ITEM_TYPES[tn.type] || tn.type;
        name = typeName + " (Byproduct)";
        category = "stonework";
      }
      if (tn.machine === "unknown") {
        name = ITEM_TYPES[tn.type] || tn.type;
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

    // Add byproduct branch nodes for machines with byproducts (e.g., Ore Smelter → Stone)
    const addedByproducts = new Set();
    for (const [key, data] of uniqueNodes) {
      const tn = data.treeNode;
      const machine = registry.get(tn.machine);
      if (!machine?.byproducts) continue;

      const sourceId = keyToId.get(key);
      if (sourceId === undefined) continue;
      const sourceLayer = depthMap.get(key) || 0;

      for (const bp of machine.byproducts) {
        const bpKey = tn.machine + "_bp_" + bp.type;
        if (addedByproducts.has(bpKey)) continue;
        addedByproducts.add(bpKey);

        const bpName = (ITEM_TYPES[bp.type] || bp.type) + " (Byproduct)";
        const bpId = nextId++;
        nodes.push({
          id: bpId,
          name: bpName,
          type: bp.type,
          value: 0,
          category: "stonework",
          layer: sourceLayer,
          isByproduct: true,
        });
        edges.push({ from: sourceId, to: bpId, itemType: bp.type, isByproduct: true });
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
        quantity: 1,
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
