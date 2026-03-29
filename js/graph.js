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
  getByproducers(type) { return this.byproducerOf.get(type) || []; }
  isByproduct(type) { return this.byproducerOf.has(type); }
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

// ValueCalculator removed - all value calculation handled by FlowOptimizer in flow.js
// ChainDiscoverer removed - all chain discovery handled by FlowOptimizer in flow.js

// === GRAPH GENERATOR ===
// Builds {nodes, edges} for visualization from a production path.

class GraphGenerator {
  // Build graph directly from FlowOptimizer chain result
  // This is the PRIMARY graph builder - uses flow data as single source of truth
  static fromFlowChain(chainResult, registry, config, dupInfo = {}, bpValue = {}, flowMemo = null) {
    const nodes = [];
    const edges = [];
    let nextId = 0;
    const { dupAt, productQty = 1 } = dupInfo;

    // Parse dupAt to find target machine and parent
    // e.g., "casing in power_core" → targetType="casing", parentType="power_core"
    // e.g., "ore (before flat bonuses)" → targetMachine="ore_source"
    let dupTargetType = null, dupParentType = null, dupTargetMachine = null;
    if (dupAt) {
      if (dupAt.includes("ore (before")) {
        dupTargetMachine = "ore_source";
      } else {
        const parts = dupAt.split(" in ");
        dupTargetType = parts[0];
        dupParentType = parts[1] || null;
      }
    }

    // Step 1: Walk chain result, build unique nodes with quantities
    const uniqueNodes = new Map(); // key → { machine, type, value, oreCount, quantity, childKeys[] }

    function getKey(machine, type) {
      return (machine || "unknown") + ":" + (type || "?");
    }

    // Check if a subtree contains a specific machine (for dup multi-slot detection)
    function subtreeContainsMachine(node, targetMachine) {
      if (!node) return false;
      if (node.machine === targetMachine) return true;
      return (node.inputs || []).some(child => subtreeContainsMachine(child, targetMachine));
    }

    // Recursively walk the chain result tree
    function walkChain(node, parentKey, parentQty) {
      if (!node) return null;

      // Handle ore processing chain (flat machines[] array)
      // Chain goes: ore_source → ore_upgrader → ore_cleaner → polisher → philosophers_stone
      // In the graph, each machine is a CHILD of the next (reversed for layer assignment)
      // so ore_source gets the highest layer (leftmost) and last machine connects to parent
      if (node.machines && !node.inputs) {
        // Ore chain: each machine processes all ores from the parent
        // parentQty carries the parent machine's throughput
        const qty = parentQty;
        const machineKeys = [];

        // Create all nodes first (skip byproduct placeholders)
        for (const machineId of node.machines) {
          if (machineId === "smelter_byproduct" || machineId === "byproduct_free" || machineId === "byproduct_source" || machineId === "cycle_ref") continue;
          const m = registry.get(machineId);
          const type = "ore";
          const key = getKey(machineId, type);

          if (!uniqueNodes.has(key)) {
            uniqueNodes.set(key, {
              machine: machineId,
              type,
              value: node.value,
              name: m?.name || (machineId === "ore_source" ? "Ore Input" : machineId),
              category: m?.category || "source",
              quantity: qty,
              childKeys: [],
              oreCount: machineId === "ore_source" ? node.oreCount : 0,
            });
          } else {
            uniqueNodes.get(key).quantity += qty;
          }
          machineKeys.push(key);
        }

        // Link in REVERSE: each machine's child is the PREVIOUS one
        // This makes ore_source the deepest leaf = highest layer = leftmost
        for (let i = 1; i < machineKeys.length; i++) {
          const currentNode = uniqueNodes.get(machineKeys[i]);
          if (currentNode && !currentNode.childKeys.includes(machineKeys[i - 1])) {
            currentNode.childKeys.push(machineKeys[i - 1]);
          }
        }

        // Connect LAST machine (philosophers_stone) to parent (smelter)
        const lastKey = machineKeys[machineKeys.length - 1];
        if (parentKey && lastKey) {
          const pn = uniqueNodes.get(parentKey);
          if (pn && !pn.childKeys.includes(lastKey)) pn.childKeys.push(lastKey);
        }

        return lastKey; // Return last key so parent connects to it
      }

      const machine = node.machine || "unknown";

      // Skip placeholder nodes only (not real machines)
      if (machine === "smelter_byproduct" || machine === "byproduct_free" || machine === "byproduct_source" || machine === "cycle_ref") {
        return null;
      }
      // oreCount=0 nodes (glass, ceramic, etc.) are real items from secondary outputs.
      // Show them in the graph as side chain nodes - they're legitimate inputs.
      // Mark them as side chain for visual separation.

      // Get output type: registry is ground truth, then flow data
      const m = registry.get(machine);
      const registryOutputType = m?.outputs?.[0]?.type;
      // Use registry output type first (what this machine actually produces)
      // Skip "same" since that means the output matches input (modifiers)
      const type = (registryOutputType && registryOutputType !== "same")
        ? registryOutputType
        : (node.resolvedType || node.type || "?");
      const key = getKey(machine, type);

      // Byproduct-sourced nodes (oreCount=0) are now part of the unified chain
      // They get isByproduct flag for visual placement in the bottom row

      // Check if this node should have a duplicator inserted
      let insertDup = false;
      if (dupTargetType && type === dupTargetType && parentKey) {
        // Check if parent matches dupParentType (by output type OR machine ID)
        const parentNode = uniqueNodes.get(parentKey);
        if (!dupParentType ||
            parentNode?.machine === dupParentType ||
            parentNode?.type === dupParentType) {
          insertDup = true;
        }
      }
      if (dupTargetMachine && machine === dupTargetMachine) {
        insertDup = true;
      }

      // Create or update node
      // Side chain = secondary output processing (stone, dust, clay, ceramic, glass)
      // These come from machine secondary outputs, not directly from mined ores
      const nodeIsSideChain = node.isByproduct ||
        (node.oreCount === 0 && machine !== "ore_source" && machine !== "seller" && machine !== "quality_assurance");
      if (!uniqueNodes.has(key)) {
        uniqueNodes.set(key, {
          machine,
          type,
          value: node.value,
          name: m?.name || machine,
          category: m?.category || "source",
          // Throughput from flow: how many items this machine outputs
          quantity: node.throughput || node.oreCount || 1,
          childKeys: [],
          oreCount: node.oreCount,
          isByproduct: nodeIsSideChain,
          dupProvided: false,
        });
      } else {
        const existing = uniqueNodes.get(key);
        if (existing.dupProvided) {
          const dupKey = getKey("duplicator", type);
          if (uniqueNodes.has(dupKey)) {
            return dupKey;
          }
        }
        // When same node visited from multiple parents, SUM throughput
        existing.quantity += (node.throughput || 1);
      }

      // Pass this node's throughput to children so they know how many items flow through
      const nodeThru = node.throughput || 1;
      const qtyMult = m?.outputQtyMultiplier || 1;
      const childQty = qtyMult > 1 ? Math.ceil(nodeThru / qtyMult) : nodeThru;

      // Recurse into inputs
      if (node.inputs) {
        for (const child of node.inputs) {
          const childKey = walkChain(child, key, childQty);
          if (childKey) {
            const n = uniqueNodes.get(key);
            if (n && !n.childKeys.includes(childKey)) n.childKeys.push(childKey);
          }
        }
      }

      // Secondary outputs (stone from smelter, etc.) - walk them like any other output
      if (node.byproductOutputs) {
        const bpRatio = registry.get(machine)?.byproductRatio || 0.5;
        // Per-invocation: how many secondary items THIS visit produces
        // The node is visited multiple times; each visit adds to the total
        const bpQty = Math.max(1, Math.round(nodeThru * bpRatio));

        for (const bp of node.byproductOutputs) {
          if (!bp.result || !bp.type) continue;

          // Create source node for the secondary output (e.g., "Stone")
          const sourceKey = getKey("secondary_output", bp.type);
          const typeName = ITEM_TYPES[bp.type] || bp.type;
          const isFirstVisit = !uniqueNodes.has(sourceKey);
          if (isFirstVisit) {
            uniqueNodes.set(sourceKey, {
              machine: "secondary_output",
              type: bp.type,
              value: bp.result.value || 0,
              name: typeName,
              category: "stonework",
              quantity: bpQty,
              childKeys: [],
              oreCount: 0,
              isByproduct: true,
              dupProvided: false,
            });
          } else {
            uniqueNodes.get(sourceKey).quantity += bpQty;
          }
          // Connect parent (smelter) → stone source
          const parentNode = uniqueNodes.get(key);
          if (parentNode) {
            if (!parentNode.downstreamKeys) parentNode.downstreamKeys = [];
            if (!parentNode.downstreamKeys.includes(sourceKey)) parentNode.downstreamKeys.push(sourceKey);
          }

          // Only walk the downstream chain on FIRST visit
          // Subsequent visits just accumulate the source quantity
          // Downstream quantities will be scaled in post-processing
          if (!isFirstVisit) continue;

          // Build side chain: first machine (from result) then downstream chain
          const sideChainSteps = [
            { machine: bp.result.machine, type: bp.result.resolvedType, value: bp.result.value },
            ...(bp.result.downstreamChain || [])
          ];

          let prevSideKey = sourceKey;
          let currentQty = bpQty;

          for (const step of sideChainSteps) {
            if (!step.machine) continue;
            const sideMachine = registry.get(step.machine);
            const sideType = sideMachine?.outputs?.[0]?.type || step.type || "?";
            const sideKey = getKey(step.machine, sideType);

            if (!uniqueNodes.has(sideKey)) {
              uniqueNodes.set(sideKey, {
                machine: step.machine,
                type: sideType,
                value: step.value || 0,
                name: sideMachine?.name || step.machine,
                category: sideMachine?.category || "stonework",
                quantity: currentQty,
                childKeys: [],
                oreCount: 0,
                isByproduct: true,
                dupProvided: false,
              });
            } else {
              uniqueNodes.get(sideKey).quantity += currentQty;
            }

            // Connect previous → current (no self-loops)
            if (prevSideKey && prevSideKey !== sideKey) {
              const prevNode = uniqueNodes.get(prevSideKey);
              if (prevNode) {
                if (!prevNode.downstreamKeys) prevNode.downstreamKeys = [];
                if (!prevNode.downstreamKeys.includes(sideKey)) prevNode.downstreamKeys.push(sideKey);
              }
            }

            prevSideKey = sideKey;
          }
        }
      }

      // Insert duplicator between parent and this node
      if (insertDup) {
        const dupKey = getKey("duplicator", type);
        const dupM = registry.get("duplicator");
        const dupQtyMult = dupM?.outputQtyMultiplier || 2;

        // Check if dup fills multiple slots: does the parent combiner
        // use this machine's type in OTHER inputs' subtrees?
        let dupFillsMultiSlots = false;
        // Walk from the parent in the ORIGINAL chain result tree
        // to check if other inputs contain this machine
        function findOriginalParent(searchNode, targetMachine) {
          if (!searchNode?.inputs) return null;
          for (const child of searchNode.inputs) {
            if (child.machine === targetMachine) return searchNode;
            const found = findOriginalParent(child, targetMachine);
            if (found) return found;
          }
          return null;
        }
        // Find the combiner that contains this dup target
        const parentCombiner = dupParentType
          ? findOriginalParent(chainResult, machine)
          : null;
        if (parentCombiner?.inputs) {
          for (const sibling of parentCombiner.inputs) {
            if (sibling.machine === machine) continue; // skip the dup target itself
            if (subtreeContainsMachine(sibling, machine)) {
              dupFillsMultiSlots = true;
              break;
            }
          }
        }

        // For multi-slot: dup provides both slots, child built once
        const dupChildQty = dupFillsMultiSlots
          ? Math.ceil(parentQty / dupQtyMult)
          : parentQty;

        if (!uniqueNodes.has(dupKey)) {
          uniqueNodes.set(dupKey, {
            machine: "duplicator",
            type,
            value: node.value * 0.5,
            name: "Duplicator",
            category: "prestige",
            quantity: dupChildQty * dupQtyMult,
            childKeys: [key],
            oreCount: 0,
          });
        }

        // Fix child quantity (built once, dup provides copies)
        if (dupFillsMultiSlots) {
          const childNode = uniqueNodes.get(key);
          if (childNode) {
            childNode.quantity = dupChildQty;
            childNode.dupProvided = true; // prevent subsequent visits from adding more
          }
        }

        // Rewire: parent → dup → this node
        if (parentKey) {
          const parentNode = uniqueNodes.get(parentKey);
          if (parentNode) {
            const idx = parentNode.childKeys.indexOf(key);
            if (idx >= 0) parentNode.childKeys[idx] = dupKey;
            else parentNode.childKeys.push(dupKey);
          }
        }

        return dupKey; // Parent connects to dup, not directly to this node
      }

      return key;
    }

    // Build the tree starting from QA wrapper or the chain result itself
    walkChain(chainResult, null, productQty || 1);

    // Add QA node if available
    const qa = registry.get("quality_assurance");
    const rootMachine = registry.get(chainResult.machine);
    const terminalType = chainResult.resolvedType || chainResult.type || rootMachine?.outputs?.[0]?.type || "product";
    if (qa && registry.isAvailable("quality_assurance", config)) {
      const rootKey = getKey(chainResult.machine, terminalType);
      const qaKey = getKey("quality_assurance", terminalType);
      if (!uniqueNodes.has(qaKey)) {
        uniqueNodes.set(qaKey, {
          machine: "quality_assurance",
          type: terminalType,
          value: chainResult.value * (1 + qa.value),
          name: qa.name,
          category: qa.category || "multipurpose",
          quantity: productQty || 1,
          childKeys: [rootKey],
          oreCount: 0,
        });
      }
    }

    // Add Seller node
    const sellerKey = getKey("seller", "sell");
    const qaKeyCheck = getKey("quality_assurance", terminalType);
    const lastMainKey = uniqueNodes.has(qaKeyCheck) ? qaKeyCheck : getKey(chainResult.machine, terminalType);
    uniqueNodes.set(sellerKey, {
      machine: "seller",
      type: "sell",
      value: chainResult.value * (qa && registry.isAvailable("quality_assurance", config) ? (1 + qa.value) : 1) * (config.hasDoubleSeller ? 2 : 1),
      name: "Seller",
      category: "source",
      quantity: productQty || 1,
      childKeys: [lastMainKey],
      oreCount: 0,
    });

    // Post-process: scale side chain quantities based on final source quantities
    // The downstream chain was walked once with qty=1. Scale based on actual source qty.
    for (const [key, data] of uniqueNodes) {
      if (data.machine === "secondary_output" && data.downstreamKeys) {
        const sourceQty = data.quantity; // Final accumulated quantity (e.g., 12 stone)
        // Walk downstream and scale quantities
        let currentQty = sourceQty;
        const visited = new Set([key]);
        let currentKey = key;
        while (true) {
          const node = uniqueNodes.get(currentKey);
          if (!node?.downstreamKeys?.length) break;
          const nextKey = node.downstreamKeys[0]; // Follow first downstream
          if (visited.has(nextKey)) break;
          visited.add(nextKey);
          const nextNode = uniqueNodes.get(nextKey);
          if (!nextNode) break;
          // Adjust qty for multi-input machines
          const nextMachine = registry.get(nextNode.machine);
          if (nextMachine?.inputs?.length >= 2) {
            currentQty = Math.max(1, Math.ceil(currentQty / nextMachine.inputs.length));
          }
          nextNode.quantity = currentQty;
          currentKey = nextKey;
        }
      }
    }

    // Post-process: connect side chain outputs to main chain consumers
    // e.g., Ceramic Furnace (side) → Superconductor Constructor (main)
    // Also calculate excess and add sell nodes
    for (const [sideKey, sideData] of uniqueNodes) {
      if (!sideData.isByproduct) continue;
      if (sideData.machine === "sell_excess") continue; // Don't connect sell nodes to main chain
      if (sideKey.startsWith("excess_")) continue; // Don't connect excess modifier nodes to main chain
      const sideType = sideData.type;
      const sideQty = sideData.quantity;

      // Find main chain nodes that need this type as input
      for (const [mainKey, mainData] of uniqueNodes) {
        if (mainData.isByproduct) continue;
        const mainMachine = registry.get(mainData.machine);
        if (!mainMachine?.inputs) continue;
        // Check if this main machine accepts the side chain's output type
        const acceptsType = mainMachine.inputs.some(inp =>
          inp === sideType || inp.split("|").includes(sideType)
        );
        if (!acceptsType) continue;

        // Connect side → main (cross-chain edge)
        if (!sideData.downstreamKeys) sideData.downstreamKeys = [];
        if (!sideData.downstreamKeys.includes(mainKey)) {
          sideData.downstreamKeys.push(mainKey);
        }

        // Calculate excess: side produces sideQty, main needs mainQty
        const mainQty = mainData.quantity || 1;
        const excess = sideQty - mainQty;
        if (excess > 0) {
          // Build a chain of modifier nodes for excess items
          // Excess items ARE sold directly so modifiers are safe here
          let excessValue = sideData.value || 0;
          let prevKey = sideKey; // Start from the side chain producer

          // Find all value-adding modifiers, sorted: flat first, then multipliers
          const modifiers = [];
          for (const [modId, modM] of registry.machines) {
            if (!registry.isAvailable(modId, config)) continue;
            if (!modM.inputs || modM.inputs.length !== 1) continue;
            const accepts = modM.inputs.some(inp =>
              inp === "any" || inp === sideType || inp.split("|").includes(sideType)
            );
            if (!accepts) continue;
            const outType = modM.outputs?.[0]?.type;
            if (outType && outType !== "same" && outType !== sideType) continue;
            if (!["flat", "percent", "multiply"].includes(modM.effect)) continue;
            // Skip if this modifier already exists in the main chain (reuse it instead)
            modifiers.push({ id: modId, machine: modM });
          }
          modifiers.sort((a, b) => {
            const order = { flat: 0, percent: 1, multiply: 1 };
            return (order[a.machine.effect] ?? 2) - (order[b.machine.effect] ?? 2);
          });

          // Create separate modifier nodes in side chain for cheap machines,
          // then connect to shared main chain nodes (QA, Seller) at the end.
          // Cheap machines like Polisher ($250) get their own side chain node.
          // QA and Seller are shared - everything sold goes through one Seller.
          for (const mod of modifiers) {
            let newVal = excessValue;
            if (mod.machine.effect === "flat") newVal += mod.machine.value;
            else if (mod.machine.effect === "percent") newVal *= (1 + mod.machine.value);
            else if (mod.machine.effect === "multiply") newVal *= mod.machine.value;
            if (newVal <= excessValue) continue;

            excessValue = newVal;

            // Check if this modifier exists in the main chain and is shared (QA, Seller)
            // The Seller's childKeys chain tells us what feeds it (QA → Combiner → ...)
            const existingMain = [...uniqueNodes.entries()].find(([k, d]) =>
              d.machine === mod.id && !d.isByproduct
            );
            // Share if this machine is between the final product and the Seller
            // (QA is right before Seller - share it. Polisher is in ore chain - don't share)
            const sellerEntry = [...uniqueNodes.entries()].find(([k, d]) => d.machine === "seller");
            const isNearSeller = existingMain && sellerEntry && (() => {
              const sellerData = uniqueNodes.get(sellerEntry[0]);
              // Check if seller's child chain includes this modifier
              if (sellerData?.childKeys?.includes(existingMain[0])) return true;
              // Also check 2 levels deep (Seller → QA → Combiner)
              for (const ck of sellerData?.childKeys || []) {
                const child = uniqueNodes.get(ck);
                if (child?.childKeys?.includes(existingMain[0])) return true;
              }
              return false;
            })();

            if (existingMain && isNearSeller) {
              // Share the main chain node (e.g., QA → Seller)
              const prevNode = uniqueNodes.get(prevKey);
              if (prevNode) {
                if (!prevNode.downstreamKeys) prevNode.downstreamKeys = [];
                if (!prevNode.downstreamKeys.includes(existingMain[0])) {
                  prevNode.downstreamKeys.push(existingMain[0]);
                }
              }
              prevKey = existingMain[0];
              // Don't need to connect further - main QA already connects to Seller
            } else {
              // Create new modifier node in side chain
              const modKey = getKey("excess_" + mod.id, sideType);
              if (!uniqueNodes.has(modKey)) {
                uniqueNodes.set(modKey, {
                  machine: mod.id,
                  type: sideType,
                  value: excessValue,
                  name: mod.machine.name || mod.id,
                  category: mod.machine.category || "multipurpose",
                  quantity: excess,
                  childKeys: [],
                  oreCount: 0,
                  isByproduct: true,
                  dupProvided: false,
                });
              }
              const prevNode = uniqueNodes.get(prevKey);
              if (prevNode) {
                if (!prevNode.downstreamKeys) prevNode.downstreamKeys = [];
                if (!prevNode.downstreamKeys.includes(modKey)) {
                  prevNode.downstreamKeys.push(modKey);
                }
              }
              prevKey = modKey;
            }
          }

          // If we didn't connect to main QA/Seller, connect to main Seller directly
          const lastNodeData = uniqueNodes.get(prevKey);
          const connectedToMain = lastNodeData && !lastNodeData.isByproduct;
          if (!connectedToMain) {
            const mainSellerKey = [...uniqueNodes.entries()].find(([k, d]) =>
              d.machine === "seller" && !d.isByproduct
            );
            if (mainSellerKey) {
              if (!lastNodeData.downstreamKeys) lastNodeData.downstreamKeys = [];
              if (!lastNodeData.downstreamKeys.includes(mainSellerKey[0])) {
                lastNodeData.downstreamKeys.push(mainSellerKey[0]);
              }
            }
          }
        }
        break; // Only connect to first matching main node
      }
    }

    // Step 2: Assign layers (depth from leaves)
    const depthMap = new Map();
    const layerVisited = new Set();
    function assignLayer(key) {
      if (layerVisited.has(key)) return depthMap.get(key) || 0;
      layerVisited.add(key);
      const data = uniqueNodes.get(key);
      if (!data) return 0;
      let maxChildDepth = -1;
      for (const ck of data.childKeys) {
        maxChildDepth = Math.max(maxChildDepth, assignLayer(ck));
      }
      const depth = maxChildDepth + 1;
      depthMap.set(key, depth);
      // Assign layers to downstream (side chain) nodes sequentially
      // Each downstream node goes 1 layer further right
      function assignDownstreamLayers(keys, startLayer) {
        let layer = startLayer;
        for (const dk of keys) {
          if (layerVisited.has(dk)) continue;
          layerVisited.add(dk);
          layer++;
          depthMap.set(dk, layer);
          const dkData = uniqueNodes.get(dk);
          if (dkData?.downstreamKeys) {
            layer = assignDownstreamLayers(dkData.downstreamKeys, layer);
          }
        }
        return layer;
      }
      if (data.downstreamKeys?.length) {
        assignDownstreamLayers(data.downstreamKeys, depth);
      }
      return depth;
    }
    // Start from seller (root)
    assignLayer(sellerKey);

    // Step 3: Build graph nodes and edges
    const keyToId = new Map();
    for (const [key, data] of uniqueNodes) {
      const id = nextId++;
      keyToId.set(key, id);

      nodes.push({
        id,
        machine: data.machine,
        name: data.name,
        type: data.type,
        value: Math.round(data.value),
        category: data.category,
        layer: depthMap.get(key) || 0,
        quantity: data.quantity,
        outputQtyMultiplier: registry.get(data.machine)?.outputQtyMultiplier || 1,
        isByproduct: data.isByproduct || false,
      });
    }

    for (const [key, data] of uniqueNodes) {
      const fromId = keyToId.get(key);
      // Input edges: child → this node (left to right flow)
      for (const childKey of data.childKeys) {
        const toId = keyToId.get(childKey);
        if (toId !== undefined && toId !== fromId) { // No self-loops
          const childData = uniqueNodes.get(childKey);
          edges.push({
            from: toId,
            to: fromId,
            itemType: childData?.type || "?",
          });
        }
      }
      // Downstream edges: this node → downstream (secondary output flow)
      for (const dsKey of (data.downstreamKeys || [])) {
        const toId = keyToId.get(dsKey);
        if (toId !== undefined && toId !== fromId) { // No self-loops
          const dsData = uniqueNodes.get(dsKey);
          edges.push({
            from: fromId,
            to: toId,
            itemType: dsData?.type || "?",
            isByproduct: true,
          });
        }
      }
    }

    // Byproduct sub-graph is now part of the unified chain result
    // Nodes with isByproduct flag are placed in the bottom row by the visualizer

    return { nodes, edges };
  }

  // fromRecipeTree, _resolveByproductChain, fromPath removed - all dead code
  // Graph is now built exclusively from FlowOptimizer chain results via fromFlowChain
}

// === GLOBAL REGISTRY (loaded async) ===
let machineRegistry = null;

async function loadMachineRegistry() {
  try {
    const response = await fetch("data/machines.json?v=" + Date.now());
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
