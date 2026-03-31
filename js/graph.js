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
      // Use the ORIGINAL chain tree to check parent, not just the current graph walk parent
      // (bolts might be first visited from frame_maker but should be duped under casing_machine)
      let insertDup = false;
      if (dupTargetType && type === dupTargetType) {
        if (!dupParentType) {
          insertDup = true;
        } else {
          // Find the combiner matching dupParentType that contains this machine
          function findMatchingParent(searchNode, targetMachine, parentType) {
            if (!searchNode?.inputs) return false;
            for (const child of searchNode.inputs) {
              if (child.machine === targetMachine) {
                // Check if THIS node matches the parent type
                return searchNode.machine === parentType ||
                       searchNode.resolvedType === parentType;
              }
              // Also check if child's subtree contains the target
              if (findMatchingParent(child, targetMachine, parentType)) return true;
            }
            return false;
          }
          insertDup = findMatchingParent(chainResult, machine, dupParentType);
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
            const childNode = uniqueNodes.get(childKey);
            // Don't create edges from main chain to side chain nodes
            // Cross-chain connections are handled in post-processing
            const crossChain = n && childNode && !n.isByproduct && childNode.isByproduct;
            if (n && !crossChain && !n.childKeys.includes(childKey)) n.childKeys.push(childKey);
          }
        }
      }

      // Add modifier machines (Tempering Forge, Electronic Tuner, etc.) as visible nodes
      // These are applied by applyModifiers() but need to show in the graph
      let finalKey = key; // The key that connects to the parent (might be wrapped by modifiers)
      if (node.appliedModifiers) {
        for (const mod of node.appliedModifiers) {
          const modMachine = registry.get(mod.id);
          if (!modMachine) continue;
          const modKey = getKey(mod.id, mod.outputType || type);
          if (!uniqueNodes.has(modKey)) {
            uniqueNodes.set(modKey, {
              machine: mod.id,
              type: mod.outputType || type,
              value: node.value, // Value after this modifier
              name: modMachine.name || mod.id,
              category: modMachine.category || "metalwork",
              quantity: node.throughput || 1,
              childKeys: [finalKey], // Input is the previous node
              oreCount: node.oreCount,
              isByproduct: nodeIsSideChain,
              dupProvided: false,
            });
          } else {
            uniqueNodes.get(modKey).quantity += (node.throughput || 1);
          }
          finalKey = modKey; // Parent will now connect to this modifier instead
        }
      }

      // Add enhancement path machines (Bar→Gem→GemCutter→Prismatic→Gem→Bar)
      if (node.enhancementPath) {
        // Store path order on source node for post-processing
        const sourceGraphNode = uniqueNodes.get(key);
        if (sourceGraphNode) sourceGraphNode._enhPathOrder = node.enhancementPath;
        // Create enhancement nodes on first visit
        for (const enhMachineId of node.enhancementPath) {
          const enhMachine = registry.get(enhMachineId);
          if (!enhMachine) continue;
          const enhOutType = enhMachine.outputs?.[0]?.type || type;
          const enhKey = getKey(enhMachineId, enhOutType);
          if (!uniqueNodes.has(enhKey)) {
            uniqueNodes.set(enhKey, {
              machine: enhMachineId,
              type: enhOutType,
              value: node.value,
              name: enhMachine.name || enhMachineId,
              category: enhMachine.category || "jewelcrafting",
              quantity: 0, // Will be set in post-processing
              childKeys: [finalKey],
              oreCount: node.oreCount,
              isByproduct: nodeIsSideChain,
              dupProvided: false,
              _enhSourceKey: key, // Track which node this enhancement comes from
            });
          }
          finalKey = enhKey;
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

          // Build side chain: chance machines (prospectors) → first machine → downstream
          // Chance machines are pass-through: item goes through each, some produce byproducts
          const chanceSteps = (bp.result.chanceChain || []).map(c => ({
            machine: c.machine,
            type: bp.type, // Stone passes through, type stays the same
            value: bp.result.value, // Value represents total including chance EV
            isChanceMachine: true,
            gemType: c.gemType,
            chance: c.chance,
            byproductValue: c.byproductValue,
          }));

          const sideChainSteps = [
            ...chanceSteps,
            { machine: bp.result.machine, type: bp.result.resolvedType, value: bp.result.value },
            ...(bp.result.downstreamChain || [])
          ];

          let prevSideKey = sourceKey;
          let currentQty = bpQty;
          let pendingGemConnections = null;
          let pendingGemQAConnections = null;

          for (const step of sideChainSteps) {
            if (!step.machine) continue;
            const sideMachine = registry.get(step.machine);
            let sideType = sideMachine?.outputs?.[0]?.type || step.type || "?";
            // Resolve "same" to the actual item type flowing through
            if (sideType === "same") sideType = step.type || "?";
            const sideKey = getKey(step.machine, sideType);

            if (!uniqueNodes.has(sideKey)) {
              // For chance machines (prospectors), show gem type from registry
              const machineData = registry.get(step.machine);
              const gemType = machineData?.gemType || step.gemType;
              const chance = machineData?.value || step.chance;
              const isChance = machineData?.effect === "chance" || step.isChanceMachine;
              const displayType = isChance && gemType
                ? `${gemType} Gem (${Math.round((chance || 0.05) * 100)}%)`
                : (ITEM_TYPES[sideType] || sideType);
              // For chance machines, show BOTH produced item value and passthrough value
              let nodeValue = step.value || 0;
              let secondaryValue = null;
              if (isChance) {
                if (gemType) {
                  const gemData = typeof GEMS !== 'undefined' ? GEMS.find(g => g.name === gemType) : null;
                  nodeValue = gemData?.value || step.byproductValue || 0;
                  secondaryValue = step.value || 0; // Stone passthrough value
                } else if (step.byproductValue) {
                  nodeValue = step.byproductValue; // Ore value
                  secondaryValue = step.value || 0; // Dust passthrough value
                }
              }
              uniqueNodes.set(sideKey, {
                machine: step.machine,
                type: isChance && gemType ? "gem" : sideType,
                value: nodeValue,
                secondaryValue, // For chance machines: passthrough item value
                name: sideMachine?.name || step.machine,
                category: sideMachine?.category || "stonework",
                quantity: currentQty,
                childKeys: [],
                oreCount: 0,
                isByproduct: true,
                dupProvided: false,
                displayType, // Custom label for the type line
              });
            } else {
              const existing = uniqueNodes.get(sideKey);
              existing.quantity += currentQty;
              // Ensure displayType is set even on revisits
              if (!existing.displayType && step.isChanceMachine && step.gemType) {
                existing.displayType = `${step.gemType} Gem (${Math.round((step.chance || 0.05) * 100)}%)`;
                existing.type = "gem";
              }
            }

            // Connect previous → current (no self-loops)
            if (prevSideKey && prevSideKey !== sideKey) {
              const prevNode = uniqueNodes.get(prevSideKey);
              if (prevNode) {
                if (!prevNode.downstreamKeys) prevNode.downstreamKeys = [];
                if (!prevNode.downstreamKeys.includes(sideKey)) prevNode.downstreamKeys.push(sideKey);
              }
            }

            // For chance machines (prospectors/sifters), track remaining quantity
            // and add gem/ore output flowing to best destination via flow
            if (step.isChanceMachine) {
              const chance = step.chance || 0.05;
              const producedQty = Math.max(1, Math.round(currentQty * chance));

              if (step.gemType) {
                // Track prospector gem outputs - will connect AFTER all prospectors
                if (!pendingGemConnections) pendingGemConnections = [];
                pendingGemConnections.push({ prospKey: sideKey, qty: producedQty });
              } else {
                // Sifter ore output - connect to first ore processing node in main chain
                // The ore goes back through the full processing pipeline
                const sifterNode = uniqueNodes.get(sideKey);
                if (sifterNode) {
                  // Find the first ore processing machine in the main chain
                  let oreTargetKey = null;
                  for (const [mk, md] of uniqueNodes) {
                    if (md.isByproduct) continue;
                    const mData = registry.get(md.machine);
                    if (mData && (mData.inputs || []).some(inp =>
                      inp === "ore" || inp.split("|").includes("ore")
                    )) {
                      oreTargetKey = mk;
                      break;
                    }
                  }
                  // Fallback to ore_source if no processor found
                  if (!oreTargetKey) {
                    for (const [mk, md] of uniqueNodes) {
                      if (md.machine === "ore_source" || md.machine === "ore_upgrader" || md.machine === "ore_cleaner") {
                        oreTargetKey = mk;
                        break;
                      }
                    }
                  }
                  if (oreTargetKey) {
                    if (!sifterNode.downstreamKeys) sifterNode.downstreamKeys = [];
                    if (!sifterNode.downstreamKeys.includes(oreTargetKey)) {
                      sifterNode.downstreamKeys.push(oreTargetKey);
                    }
                    if (!sifterNode._edgeQty) sifterNode._edgeQty = {};
                    sifterNode._edgeQty[oreTargetKey] = producedQty;
                  }
                }
              }

              // Reduce remaining quantity
              currentQty = Math.max(1, currentQty - producedQty);
            }

            prevSideKey = sideKey;
          }

          // After all prospectors: connect gems to best processing
          if (pendingGemConnections && pendingGemConnections.length > 0) {
            const totalGems = pendingGemConnections.reduce((s, g) => s + g.qty, 0);

            // Find gem target: existing gem processor in ANY chain, or create new
            let gemTargetKey = null;
            for (const [mk, md] of uniqueNodes) {
              const mData = registry.get(md.machine);
              if (mData && (mData.inputs || []).some(inp =>
                inp === "gem" || inp === "cut_gem" || inp.split("|").includes("gem")
              )) {
                gemTargetKey = mk;
                break;
              }
            }

            // If no gem processor, create side chain gem machines
            // Follow the gem processing chain: gem → gem_cutter → prismatic → etc
            let lastGemKey = gemTargetKey;
            if (!gemTargetKey) {
              let currentGemType = "gem";
              let currentQtyInChain = totalGems;
              for (let depth = 0; depth < 5; depth++) {
                let bestGemMachine = null;
                for (const [gmId, gmM] of registry.machines) {
                  if (!registry.isAvailable(gmId, config)) continue;
                  if (!gmM.inputs || gmM.inputs.length === 0) continue;
                  // Accept single-input OR same-type combine (prismatic: gem+gem)
                  const allAccept = gmM.inputs.every(inp =>
                    inp === currentGemType || inp.split("|").includes(currentGemType)
                  );
                  if (!allAccept) continue;
                  const outType = gmM.outputs?.[0]?.type;
                  if (!outType || outType === "same") continue;
                  if (!["multiply", "flat", "percent", "combine"].includes(gmM.effect)) continue;
                  // Skip machines already in this gem chain
                  if (uniqueNodes.has(getKey(gmId, outType))) continue;
                  // Prefer single-input first (1.4x per gem > 1.15x per 2 gems)
                  // Only use combine if no single-input found, or it's a LATER step
                  const isSingle = gmM.inputs.length === 1;
                  if (!bestGemMachine ||
                      (isSingle && !bestGemMachine.isSingle) ||
                      (isSingle === bestGemMachine.isSingle && (gmM.value || 1) > (bestGemMachine.value || 1))) {
                    bestGemMachine = { id: gmId, machine: gmM, outType, value: gmM.value, isSingle };
                  }
                }
                if (!bestGemMachine) break;

                const gmKey = getKey(bestGemMachine.id, bestGemMachine.outType);
                // Combine machines reduce quantity (prismatic: 2 gems → 1)
                const inputCount = bestGemMachine.machine.inputs.length;
                if (bestGemMachine.machine.effect === "combine" && inputCount > 1) {
                  currentQtyInChain = Math.floor(currentQtyInChain / inputCount);
                  if (currentQtyInChain <= 0) break; // Not enough items to combine
                }
                if (!uniqueNodes.has(gmKey)) {
                  uniqueNodes.set(gmKey, {
                    machine: bestGemMachine.id, type: bestGemMachine.outType, value: 0,
                    name: bestGemMachine.machine.name || bestGemMachine.id,
                    category: bestGemMachine.machine.category || "jewelcrafting",
                    quantity: currentQtyInChain, childKeys: lastGemKey ? [lastGemKey] : [],
                    oreCount: 0, isByproduct: true, dupProvided: false,
                  });
                }
                // Connect previous gem machine → this one via downstreamKeys (for layer ordering)
                if (lastGemKey && lastGemKey !== gmKey) {
                  const prevGemNode = uniqueNodes.get(lastGemKey);
                  if (prevGemNode) {
                    if (!prevGemNode.downstreamKeys) prevGemNode.downstreamKeys = [];
                    if (!prevGemNode.downstreamKeys.includes(gmKey)) {
                      prevGemNode.downstreamKeys.push(gmKey);
                    }
                  }
                }
                if (!gemTargetKey) gemTargetKey = gmKey;
                lastGemKey = gmKey;
                currentGemType = bestGemMachine.outType;
              }
            }

            // Track last gem key for QA connection in post-processing
            if (lastGemKey) {
              if (!pendingGemQAConnections) pendingGemQAConnections = [];
              pendingGemQAConnections.push(lastGemKey);
            }

            // Connect each prospector to the gem target
            if (gemTargetKey) {
              for (const gc of pendingGemConnections) {
                const prospNode = uniqueNodes.get(gc.prospKey);
                if (!prospNode) continue;
                if (!prospNode.downstreamKeys) prospNode.downstreamKeys = [];
                if (!prospNode.downstreamKeys.includes(gemTargetKey)) {
                  prospNode.downstreamKeys.push(gemTargetKey);
                }
                if (!prospNode._edgeQty) prospNode._edgeQty = {};
                prospNode._edgeQty[gemTargetKey] = gc.qty;
              }
              // Only add extra gems if the target was from the MAIN chain enhancement path
              // (not a side chain gem machine we just created - those already have correct qty)
              const targetNode = uniqueNodes.get(gemTargetKey);
              if (targetNode && !targetNode.isByproduct) {
                targetNode._extraGemQty = (targetNode._extraGemQty || 0) + totalGems;
              }
            }
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
        // Find the combiner matching dupParentType that directly contains this machine
        function findDupParentCombiner(searchNode, targetMachine, targetParent) {
          if (!searchNode?.inputs) return null;
          for (const child of searchNode.inputs) {
            if (child.machine === targetMachine) {
              // Check if THIS node matches the target parent
              if (!targetParent ||
                  searchNode.machine === targetParent ||
                  searchNode.resolvedType === targetParent) {
                return searchNode;
              }
            }
            const found = findDupParentCombiner(child, targetMachine, targetParent);
            if (found) return found;
          }
          return null;
        }
        const parentCombiner = findDupParentCombiner(chainResult, machine, dupParentType);
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

      return finalKey; // Return modifier-wrapped key so parent connects to the modifier
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

    // Post-process: scale side chain quantities proportionally
    // The downstream chain was walked once with initial bpQty. The source node
    // accumulated its full qty from all visits. Scale downstream by the ratio.
    for (const [key, data] of uniqueNodes) {
      if (data.machine === "secondary_output" && data.downstreamKeys) {
        // Find initial qty (what the first walk used)
        // and final qty (accumulated from all visits)
        const finalSourceQty = data.quantity;
        // Walk downstream, scaling each node proportionally
        const visited = new Set([key]);
        const scaleDown = (nodeKey, parentQty) => {
          const node = uniqueNodes.get(nodeKey);
          if (!node || visited.has(nodeKey)) return;
          visited.add(nodeKey);
          // Skip non-real machines
          if (!registry.get(node.machine)) return;
          // Scale this node's quantity to match parent
          // Skip gem processing machines - their quantity is set by gem chain creation
          const nodeM = registry.get(node.machine);
          if (nodeM?.category === "jewelcrafting" && node.isByproduct) return;
          node.quantity = parentQty;
          // For chance machines, reduce for next in chain
          let nextQty = parentQty;
          const m = registry.get(node.machine);
          if (m?.effect === "chance") {
            const chance = m.value || 0.05;
            const produced = Math.max(1, Math.round(parentQty * chance));
            nextQty = Math.max(1, parentQty - produced);
            // Update gem sell nodes with correct produced qty
            for (const dsKey of (node.downstreamKeys || [])) {
              const dsNode = uniqueNodes.get(dsKey);
              if (dsNode && dsNode.machine?.startsWith("sell_")) {
                dsNode.quantity = produced;
                visited.add(dsKey);
              }
            }
          }
          // Multi-input machines divide quantity
          if (m?.inputs?.length >= 2) {
            nextQty = Math.max(1, Math.ceil(parentQty / m.inputs.length));
          }
          // Recurse into downstream (non-sell, non-visited)
          for (const dsKey of (node.downstreamKeys || [])) {
            if (!visited.has(dsKey)) {
              scaleDown(dsKey, nextQty);
            }
          }
        };
        // Start scaling from each downstream of the source
        for (const dsKey of data.downstreamKeys) {
          scaleDown(dsKey, finalSourceQty);
        }
      }
    }

    // Post-process: set enhancement path quantities by walking in order
    // Each source node has an enhancement path array [bar_to_gem, gem_cutter, prismatic, gem_to_bar]
    // Walk in order: start with source qty, halve at combine machines
    const processedSources = new Set();
    for (const [enhKey, enhData] of uniqueNodes) {
      if (!enhData._enhSourceKey || processedSources.has(enhData._enhSourceKey)) continue;
      processedSources.add(enhData._enhSourceKey);
      const sourceNode = uniqueNodes.get(enhData._enhSourceKey);
      if (!sourceNode) continue;
      // Find all enhancement nodes for this source, in path order
      const sourceResult = sourceNode._enhPathOrder; // Set during walkChain
      if (!sourceResult) continue;
      let qty = sourceNode.quantity;
      for (const mid of sourceResult) {
        const em = registry.get(mid);
        if (!em) continue;
        const eOutType = em.outputs?.[0]?.type || sourceNode.type;
        const eKey = getKey(mid, eOutType);
        if (em.effect === "combine" && (em.inputs || []).length > 1) {
          qty = Math.floor(qty / em.inputs.length);
        }
        const eNode = uniqueNodes.get(eKey);
        if (eNode) eNode.quantity = qty;
      }
    }

    // Post-process: add extra gem quantities from prospectors
    // (must be after enhancement qty reset which overwrites quantities)
    for (const [k, d] of uniqueNodes) {
      if (d._extraGemQty) {
        d.quantity += d._extraGemQty;
      }
    }

    // Post-process: connect side chain outputs to main chain consumers
    // e.g., Ceramic Furnace (side) → Superconductor Constructor (main)
    // Connect side chain outputs to main chain consumers + handle excess
    // Strategy: find the LAST node in each side chain, connect IT to main chain
    // This ensures items go through ALL processing (polisher, etc.) before entering main chain
    const connectedMainKeys = new Set(); // Prevent duplicate connections
    for (const [sideKey, sideData] of uniqueNodes) {
      if (!sideData.isByproduct) continue;
      if (sideData.machine === "sell_excess") continue;
      if (sideKey.startsWith("excess_")) continue;
      // Skip chance machines (prospectors/sifters) - their outputs are
      // already connected to main chain at gem/ore processing points
      const sideM = registry.get(sideData.machine);
      if (sideM?.effect === "chance") continue;
      const sideType = sideData.type;

      // Find main chain nodes that need this type as input
      for (const [mainKey, mainData] of uniqueNodes) {
        if (mainData.isByproduct) continue;
        const mainMachine = registry.get(mainData.machine);
        if (!mainMachine?.inputs) continue;
        const acceptsType = mainMachine.inputs.some(inp =>
          inp === sideType || inp.split("|").includes(sideType)
        );
        if (!acceptsType) continue;
        if (connectedMainKeys.has(mainKey)) continue; // Already connected
        connectedMainKeys.add(mainKey);

        // Find the LAST node in the side chain that outputs this type
        // (follow downstreamKeys to the end of the processing chain)
        let lastSideKey = sideKey;
        const visited = new Set([sideKey]);
        while (true) {
          const lastNode = uniqueNodes.get(lastSideKey);
          const dsKeys = (lastNode?.downstreamKeys || []).filter(dk =>
            !visited.has(dk) && uniqueNodes.get(dk)?.isByproduct &&
            uniqueNodes.get(dk)?.machine !== "sell_excess"
          );
          if (dsKeys.length === 0) break;
          lastSideKey = dsKeys[0];
          visited.add(lastSideKey);
        }

        const lastSideData = uniqueNodes.get(lastSideKey);
        const lastSideQty = lastSideData?.quantity || sideData.quantity;
        const mainQty = mainData.quantity || 1;
        const excess = lastSideQty - mainQty;

        // Connect LAST side chain node → main chain (not the producer)
        if (!lastSideData.downstreamKeys) lastSideData.downstreamKeys = [];
        if (!lastSideData.downstreamKeys.includes(mainKey)) {
          lastSideData.downstreamKeys.push(mainKey);
        }
        if (!lastSideData._edgeQty) lastSideData._edgeQty = {};
        lastSideData._edgeQty[mainKey] = mainQty;

        if (excess > 0) {
          // Excess items route through shared QA → Seller in the main chain
          // Find the main chain QA and Seller nodes
          const lastNode = uniqueNodes.get(lastSideKey);
          const mainQAEntry = [...uniqueNodes.entries()].find(([k, d]) =>
            d.machine === "quality_assurance" && !d.isByproduct
          );
          const mainSellerEntry = [...uniqueNodes.entries()].find(([k, d]) =>
            d.machine === "seller" && !d.isByproduct
          );

          // Connect last side node → QA (if available) or Seller
          const targetKey = mainQAEntry?.[0] || mainSellerEntry?.[0];
          if (targetKey && lastNode) {
            if (!lastNode.downstreamKeys) lastNode.downstreamKeys = [];
            if (!lastNode.downstreamKeys.includes(targetKey)) {
              lastNode.downstreamKeys.push(targetKey);
            }
            if (!lastNode._edgeQty) lastNode._edgeQty = {};
            lastNode._edgeQty[targetKey] = excess;
          }
        }
        break; // Only connect to first matching main node
      }
    }

    // (Gem processing connections handled inline during prospector node creation)

    // Post-process: connect side chain gem endpoints to QA → Seller
    // Must run AFTER cross-chain connections which may add ring_maker/laser_maker
    {
      const mainQA = [...uniqueNodes.entries()].find(([k, d]) =>
        d.machine === "quality_assurance" && !d.isByproduct
      );
      const mainSeller = [...uniqueNodes.entries()].find(([k, d]) =>
        d.machine === "seller" && !d.isByproduct
      );
      const sellTarget = mainQA?.[0] || mainSeller?.[0];
      if (sellTarget) {
        // Find all side chain gem endpoints (nodes with no downstream to main chain)
        for (const [key, data] of uniqueNodes) {
          if (!data.isByproduct) continue;
          const m = registry.get(data.machine);
          if (!m) continue;
          // Check if this is a gem processing machine (gem_cutter, prismatic)
          const isGemProcessor = m.category === "jewelcrafting" &&
            (m.inputs || []).some(inp => inp === "gem" || inp.split("|").includes("gem"));
          if (!isGemProcessor) continue;
          // Check if it has NO downstream to main chain QA/Seller
          const hasMainDownstream = (data.downstreamKeys || []).some(dk => {
            const dkData = uniqueNodes.get(dk);
            return dkData && !dkData.isByproduct;
          });
          if (hasMainDownstream) continue;
          // Connect to QA
          if (!data.downstreamKeys) data.downstreamKeys = [];
          if (!data.downstreamKeys.includes(sellTarget)) {
            data.downstreamKeys.push(sellTarget);
          }
        }
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
        displayType: data.displayType,
        value: Math.round(data.value),
        secondaryValue: data.secondaryValue ? Math.round(data.secondaryValue) : undefined,
        category: data.category,
        layer: depthMap.get(key) || 0,
        quantity: data.quantity,
        outputQtyMultiplier: registry.get(data.machine)?.outputQtyMultiplier || 1,
        isByproduct: data.isByproduct || false,
      });
    }

    const edgeSet = new Set(); // Track "from:to" pairs to prevent duplicates
    for (const [key, data] of uniqueNodes) {
      const fromId = keyToId.get(key);
      // Input edges: child → this node (left to right flow)
      for (const childKey of data.childKeys) {
        const toId = keyToId.get(childKey);
        if (toId !== undefined && toId !== fromId) {
          const edgePair = `${toId}:${fromId}`;
          if (edgeSet.has(edgePair)) continue;
          edgeSet.add(edgePair);
          const childData = uniqueNodes.get(childKey);
          let edgeItemType = childData?.type || "?";
          if (edgeItemType === "same") edgeItemType = data.type || "?";
          edges.push({
            from: toId,
            to: fromId,
            itemType: edgeItemType,
          });
        }
      }
      // Downstream edges: this node → downstream (secondary output flow)
      for (const dsKey of (data.downstreamKeys || [])) {
        const toId = keyToId.get(dsKey);
        if (toId !== undefined && toId !== fromId) {
          const edgePair = `${fromId}:${toId}`;
          if (edgeSet.has(edgePair)) continue;
          edgeSet.add(edgePair);
          const dsData = uniqueNodes.get(dsKey);
          // Edge quantity: from _edgeQty if set, otherwise use target's quantity
          // For combine machines, multiply by input count (items flowing IN)
          let edgeQty = data._edgeQty?.[dsKey];
          if (!edgeQty && dsData) {
            const dsM = registry.get(dsData.machine);
            const inputCount = (dsM?.effect === "combine" && dsM.inputs?.length > 1) ? dsM.inputs.length : 1;
            edgeQty = dsData.quantity * inputCount;
          }
          // Always use SOURCE type (what's flowing out of the source node)
          let edgeType = data.type || "?";
          // Resolve "same" to source type
          if (edgeType === "same") edgeType = data.type || "?";
          edges.push({
            from: fromId,
            to: toId,
            itemType: edgeType,
            isByproduct: true,
            qty: edgeQty,
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
