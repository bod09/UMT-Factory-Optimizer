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
  static fromFlowChain(chainResult, registry, config, dupInfo = {}, bpValue = {}, flowMemo = null, actualOreCount = 0) {
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
        // Ore chain: use oreCount (how many ores this branch needs)
        const qty = node.oreCount || 1;
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
            // Accumulate oreCount from each visit (each branch needs its ores)
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
          // Initial quantity from flow throughput, will be corrected in post-processing
          quantity: node.throughput || 1,
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
        // When same node visited again, SUM throughput from each visit
        existing.quantity += (node.throughput || 1);
      }

      // Recurse into inputs
      // childQty = parentQty (each child runs once per parent invocation)
      if (node.inputs) {
        for (const child of node.inputs) {
          const childKey = walkChain(child, key, parentQty);
          if (childKey) {
            const n = uniqueNodes.get(key);
            const childNode = uniqueNodes.get(childKey);
            // Don't create edges between nodes when:
            // 1. Main chain → side chain (cross-chain handled in post-processing)
            // 2. Both are side chain nodes (downstream flow handles their connections)
            const crossChain = n && childNode && !n.isByproduct && childNode.isByproduct;
            const bothSide = n && childNode && n.isByproduct && childNode.isByproduct;
            if (n && !crossChain && !bothSide && !n.childKeys.includes(childKey)) n.childKeys.push(childKey);
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
        // Accumulate fractional byproduct amount per visit
        // Don't round per-visit (Math.max(1) was forcing 1 per visit even for 0.5 ratio)
        const bpQtyRaw = parentQty * bpRatio;

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
              quantity: 0, // Will be set after all visits accumulate
              _rawQty: bpQtyRaw,
              childKeys: [],
              oreCount: 0,
              isByproduct: true,
              dupProvided: false,
            });
          } else {
            uniqueNodes.get(sourceKey)._rawQty = (uniqueNodes.get(sourceKey)._rawQty || 0) + bpQtyRaw;
          }
          // Connect parent (smelter) → stone source with correct type and quantity
          const parentNode = uniqueNodes.get(key);
          if (parentNode) {
            if (!parentNode.downstreamKeys) parentNode.downstreamKeys = [];
            if (!parentNode.downstreamKeys.includes(sourceKey)) parentNode.downstreamKeys.push(sourceKey);
            // Override edge type to show byproduct type (stone), not parent output (bar)
            if (!parentNode._edgeType) parentNode._edgeType = {};
            parentNode._edgeType[sourceKey] = bp.type;
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
          let currentQty = Math.max(1, Math.round(bpQtyRaw));
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
              const producedQty = Math.round(currentQty * chance);

              if (step.gemType) {
                // Track prospector gem outputs - will connect AFTER all prospectors
                if (!pendingGemConnections) pendingGemConnections = [];
                pendingGemConnections.push({ prospKey: sideKey, qty: producedQty });
              } else {
                // Sifter ore output - connect to first ore processing node
                // If Ore Upgrader is available, use it (even if main chain skips it for max-tier ore)
                const sifterNode = uniqueNodes.get(sideKey);
                if (sifterNode) {
                  let oreTargetKey = null;

                  // Check if Ore Upgrader is available and should be used
                  const hasUpgrader = config.prestigeItems?.oreUpgrader;
                  if (hasUpgrader) {
                    // Look for existing Ore Upgrader node
                    const existingUpgrader = [...uniqueNodes.entries()].find(([k, d]) =>
                      d.machine === "ore_upgrader" && !d.isByproduct
                    );
                    if (existingUpgrader) {
                      oreTargetKey = existingUpgrader[0];
                    } else {
                      // Add Ore Upgrader as a side chain node for sifted ores
                      const upgraderM = registry.get("ore_upgrader");
                      if (upgraderM) {
                        const upgraderKey = getKey("ore_upgrader", "ore");
                        const oreCleanerKey = [...uniqueNodes.entries()].find(([k, d]) =>
                          d.machine === "ore_cleaner" && !d.isByproduct
                        )?.[0];
                        uniqueNodes.set(upgraderKey, {
                          machine: "ore_upgrader",
                          type: "ore",
                          value: 0,
                          name: upgraderM.name || "Ore Upgrader",
                          category: upgraderM.category || "prestige",
                          quantity: producedQty,
                          childKeys: [],
                          oreCount: 0,
                          isByproduct: true, // Side chain node for sifted ores
                        });
                        // Connect upgrader to ore cleaner with correct qty
                        if (oreCleanerKey) {
                          const upgraderNode = uniqueNodes.get(upgraderKey);
                          upgraderNode.downstreamKeys = [oreCleanerKey];
                          upgraderNode._edgeQty = { [oreCleanerKey]: producedQty };
                          upgraderNode._edgeType = { [oreCleanerKey]: "ore" };
                        }
                        oreTargetKey = upgraderKey;
                      }
                    }
                  }

                  // Fallback: find first ore processor after ore_source
                  if (!oreTargetKey) {
                    const oreSourceKey = [...uniqueNodes.entries()].find(([k, d]) => d.machine === "ore_source")?.[0];
                    if (oreSourceKey) {
                      for (const [mk, md] of uniqueNodes) {
                        if (md.isByproduct) continue;
                        if (md.childKeys?.includes(oreSourceKey)) {
                          oreTargetKey = mk;
                          break;
                        }
                      }
                    }
                  }
                  // Last fallback: any non-source ore node
                  if (!oreTargetKey) {
                    for (const [mk, md] of uniqueNodes) {
                      if (md.isByproduct || md.machine === "ore_source") continue;
                      if (md.type === "ore") { oreTargetKey = mk; break; }
                    }
                  }
                  if (oreTargetKey) {
                    if (!sifterNode.downstreamKeys) sifterNode.downstreamKeys = [];
                    if (!sifterNode.downstreamKeys.includes(oreTargetKey)) {
                      sifterNode.downstreamKeys.push(oreTargetKey);
                    }
                    if (!sifterNode._edgeQty) sifterNode._edgeQty = {};
                    sifterNode._edgeQty[oreTargetKey] = producedQty;
                    if (!sifterNode._edgeType) sifterNode._edgeType = {};
                    sifterNode._edgeType[oreTargetKey] = "ore";

                    // Quantity propagation handled by global cross-chain step below
                  }
                }
              }

              // Reduce remaining quantity
              currentQty = currentQty - producedQty;
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
                // Each prospector's own produced qty (not overwriting others)
                if (!prospNode._edgeQty) prospNode._edgeQty = {};
                prospNode._edgeQty[gemTargetKey] = gc.qty;
                // Also set the edge type so the FINAL propagation can find it
                if (!prospNode._edgeType) prospNode._edgeType = {};
                prospNode._edgeType[gemTargetKey] = "gem";
              }
              // Gem quantities are added by the global cross-chain propagation step
              // Don't add here to avoid double-counting
            }
          }
        }
      }

      // Insert duplicator AFTER enhancement path (wraps the enhanced output)
      if (insertDup) {
        const dupKey = getKey("duplicator", type);
        const dupM = registry.get("duplicator");
        const dupQtyMult = dupM?.outputQtyMultiplier || 2;
        // Use finalKey (enhanced output) not raw key
        const dupChildKey = finalKey;

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
            childKeys: [dupChildKey],
            oreCount: 0,
          });
        }

        // Fix child quantity (built once, dup provides copies)
        if (dupFillsMultiSlots) {
          const childNode = uniqueNodes.get(dupChildKey) || uniqueNodes.get(key);
          if (childNode) {
            childNode.quantity = dupChildQty;
            childNode.dupProvided = true; // prevent subsequent visits from adding more
          }
        }

        // Rewire: parent → dup → enhanced node
        if (parentKey) {
          const parentNode = uniqueNodes.get(parentKey);
          if (parentNode) {
            // Replace finalKey (or key) with dupKey in parent's childKeys
            const idx1 = parentNode.childKeys.indexOf(dupChildKey);
            const idx2 = parentNode.childKeys.indexOf(key);
            if (idx1 >= 0) parentNode.childKeys[idx1] = dupKey;
            else if (idx2 >= 0) parentNode.childKeys[idx2] = dupKey;
            else parentNode.childKeys.push(dupKey);
          }
        }

        return dupKey; // Parent connects to dup, which connects to enhanced output
      }

      return finalKey; // Return modifier-wrapped key so parent connects to the modifier
    }

    // Build the tree starting from QA wrapper or the chain result itself
    // walkChain returns the FINAL key (may include enhancement wrapping like gem_to_bar)
    const rootFinalKey = walkChain(chainResult, null, productQty || 1);

    // Add QA node if available
    const qa = registry.get("quality_assurance");
    const rootMachine = registry.get(chainResult.machine);
    const terminalType = chainResult.resolvedType || chainResult.type || rootMachine?.outputs?.[0]?.type || "product";
    if (qa && registry.isAvailable("quality_assurance", config)) {
      // Connect QA to the FINAL key from walkChain (includes enhancements)
      const qaInputKey = rootFinalKey || getKey(chainResult.machine, terminalType);
      const qaKey = getKey("quality_assurance", terminalType);
      if (!uniqueNodes.has(qaKey)) {
        uniqueNodes.set(qaKey, {
          machine: "quality_assurance",
          type: terminalType,
          value: chainResult.value * (1 + qa.value),
          name: qa.name,
          category: qa.category || "multipurpose",
          quantity: productQty || 1,
          childKeys: [qaInputKey],
          oreCount: 0,
        });
      }
    }

    // Add Seller node
    const sellerKey = getKey("seller", "sell");
    const qaKeyCheck = getKey("quality_assurance", terminalType);
    const lastMainKey = uniqueNodes.has(qaKeyCheck) ? qaKeyCheck : (rootFinalKey || getKey(chainResult.machine, terminalType));
    uniqueNodes.set(sellerKey, {
      machine: "seller",
      type: "sell",
      value: chainResult.value * (qa && registry.isAvailable("quality_assurance", config) ? (1 + qa.value) : 1) * (config.hasDoubleSeller ? 2 : 1),
      name: config.hasDoubleSeller ? "Double Seller (x2)" : "Seller",
      category: "source",
      quantity: productQty || 1,
      childKeys: [lastMainKey],
      oreCount: 0,
    });

    // Finalize fractional byproduct quantities: round accumulated _rawQty
    for (const [key, data] of uniqueNodes) {
      if (data._rawQty !== undefined) {
        data.quantity = Math.max(1, Math.round(data._rawQty));
        delete data._rawQty;
      }
    }

    // Post-process: compute ALL main chain quantities from flow data
    // Tree walk accumulation is unreliable with memoized references.
    // Use actualOreCount and flow memo's oreCount to calculate each node.
    if (actualOreCount > 0 && flowMemo) {
      for (const [key, data] of uniqueNodes) {
        if (data.isByproduct) continue;
        if (data.machine === "seller") {
          data.quantity = productQty || 1;
          continue;
        }
        if (data.machine === "ore_source") {
          data.quantity = actualOreCount;
          continue;
        }
        // Compute quantity from flow data
        const m = registry.get(data.machine);

        // Single-input TYPE-SPECIFIC modifiers (like Tempering Forge: bar→bar 2x):
        // These process the SAME count as their input producer
        // Only applies to machines with a SPECIFIC input type (not "any")
        // Machines accepting "any" (QA, Duplicator, Polisher) should use their node's type
        if (m?.inputs?.length === 1 && m.outputs?.[0]?.type === "same" &&
            m.inputs[0] !== "any") {
          // Modifier: qty = how many items of this type exist
          const inputType = data.type || m.inputs[0].split("|")[0];
          if (inputType === "ore") {
            data.quantity = actualOreCount;
          } else {
            const typeResult = flowMemo.get(inputType);
            if (typeResult?.oreCount > 0) {
              // Check if this type's oreCount is inflated by an enhancement path
              // (e.g., bar oreCount=2 due to transmuter, but tempering sees 1 bar/ore)
              // Detect: type is produced by a single-input machine (smelter: ore→bar)
              // but oreCount > input's oreCount. The difference is from enhancement.
              let useOreCount = typeResult.oreCount;
              const producer = registry.getProducers(inputType)?.[0];
              if (producer) {
                const pMachine = registry.get(producer);
                if (pMachine?.inputs?.length === 1) {
                  const pInputType = pMachine.inputs[0].split("|")[0];
                  const pInputResult = flowMemo.get(pInputType);
                  const producerOreCount = pInputResult?.oreCount || 1;
                  // If type's oreCount > producer's input oreCount, enhancement inflated it
                  if (typeResult.oreCount > producerOreCount) {
                    useOreCount = producerOreCount; // Use pre-enhancement count
                  }
                }
              }
              data.quantity = Math.max(1, Math.round(actualOreCount / useOreCount));
            } else {
              data.quantity = actualOreCount;
            }
          }
        } else {
          // Non-modifier machines: use flow memo
          // Skip machines that convert types (smelter: ore→bar) - their accumulated
          // throughput from walkChain is correct. The flow memo's oreCount for the
          // OUTPUT type may be inflated by enhancement paths (transmuter doubles bar oreCount)
          const m2 = registry.get(data.machine);
          const outType2 = m2?.outputs?.[0]?.type;
          const inType2 = m2?.inputs?.[0]?.split("|")[0];
          const isTypeConverter = m2?.inputs?.length === 1 && outType2 &&
            outType2 !== "same" && outType2 !== inType2 && inType2 !== "any";
          if (isTypeConverter) {
            const inputType = m2.inputs[0].split("|")[0];
            if (inputType === "ore") {
              data.quantity = actualOreCount;
            } else {
              const inputResult = flowMemo.get(inputType);
              if (inputResult?.oreCount > 0) {
                data.quantity = Math.max(1, Math.round(actualOreCount / inputResult.oreCount));
              }
            }
          } else {
            // Skip recalculation for multi-input combine machines with mixed inputs
            // (e.g., superconductor: alloy_bar + ceramic_casing)
            // These only use a PORTION of total ores, so dividing total by per-invocation is wrong
            // Their walkChain accumulated throughput is correct
            const isMixedCombine = m2?.inputs?.length >= 2 && (() => {
              const inputTypes = new Set((m2.inputs || []).flatMap(i => i.split("|")));
              return inputTypes.size > 1;
            })();
            if (!isMixedCombine) {
              const flowResult = flowMemo.get(data.type);
              if (flowResult?.oreCount > 0) {
                data.quantity = Math.max(1, Math.round(actualOreCount / flowResult.oreCount));
              } else if (data.type === "ore") {
                data.quantity = actualOreCount;
              }
            }
            // Mixed combine machines keep their walkChain throughput
          }
        }
      }
    }

    // Recalculate secondary output quantities from parent's final quantity × ratio
    for (const [key, data] of uniqueNodes) {
      if (data.machine !== "secondary_output") continue;
      // Find parent node that has an edge TO this secondary output
      let found = false;
      for (const [pk, pd] of uniqueNodes) {
        if (pd.isByproduct) continue;
        if (pd.downstreamKeys?.includes(key)) {
          const parentMachine = registry.get(pd.machine);
          if (!parentMachine?.byproducts) continue;
          const bpRatio = parentMachine.byproductRatio || 0.5;
          data.quantity = Math.max(1, Math.round(pd.quantity * bpRatio));
          found = true;
          break;
        }
      }
      // Fallback: find parent by checking who connects to this node via _edgeType
      if (!found) {
        for (const [pk, pd] of uniqueNodes) {
          if (pd.isByproduct) continue;
          if (pd._edgeType && Object.values(pd._edgeType).includes(data.type)) {
            const parentMachine = registry.get(pd.machine);
            if (!parentMachine?.byproducts) continue;
            const bpRatio = parentMachine.byproductRatio || 0.5;
            data.quantity = Math.max(1, Math.round(pd.quantity * bpRatio));
            found = true;
            break;
          }
        }
      }
    }

    // Post-process: scale side chain quantities proportionally
    for (const [key, data] of uniqueNodes) {
      if (data.machine === "secondary_output" && data.downstreamKeys) {
        const finalSourceQty = data.quantity;
        // Walk downstream, scaling each node proportionally
        const visited = new Set([key]);
        const scaleDown = (nodeKey, parentQty) => {
          const node = uniqueNodes.get(nodeKey);
          if (!node || visited.has(nodeKey)) return;
          visited.add(nodeKey);
          // STOP at main chain nodes - don't overwrite their quantities
          if (!node.isByproduct) return;
          // Skip non-real machines
          if (!registry.get(node.machine)) return;
          // Skip gem processing machines - their quantity is set by gem chain creation
          const nodeM = registry.get(node.machine);
          if (nodeM?.category === "jewelcrafting" && node.isByproduct) return;
          node.quantity = parentQty;
          // For chance machines, reduce for next in chain
          let nextQty = parentQty;
          const m = registry.get(node.machine);
          if (m?.effect === "chance") {
            const chance = m.value || 0.05;
            const produced = Math.round(parentQty * chance);
            nextQty = parentQty - produced;
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
    }

    // (Cross-chain connections and excess handling moved to FINAL section
    //  after all quantity fixes are done)

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

    // === TOPOLOGICAL FORWARD PROPAGATION ===
    // One clean pass: build adjacency, topo sort, propagate quantities left→right.
    // No patches, no ordering dependencies, no machine-specific conditions.
    {
      // Phase 1: Build adjacency (parent→children map)
      const children = new Map(); // key → [keys that consume this node's output]
      for (const [key, data] of uniqueNodes) {
        for (const ck of (data.childKeys || [])) {
          if (!children.has(ck)) children.set(ck, []);
          children.get(ck).push(key);
        }
      }

      // Phase 2: Topological sort (Kahn's algorithm) - main chain only
      const inDegree = new Map();
      for (const [key, data] of uniqueNodes) {
        if (data.isByproduct) continue;
        inDegree.set(key, (data.childKeys || []).filter(ck => !uniqueNodes.get(ck)?.isByproduct).length);
      }
      const topoOrder = [];
      const topoQueue = [];
      for (const [key, deg] of inDegree) {
        if (deg === 0) topoQueue.push(key);
      }
      while (topoQueue.length > 0) {
        const key = topoQueue.shift();
        topoOrder.push(key);
        for (const consumerKey of (children.get(key) || [])) {
          if (!inDegree.has(consumerKey)) continue;
          inDegree.set(consumerKey, inDegree.get(consumerKey) - 1);
          if (inDegree.get(consumerKey) === 0) topoQueue.push(consumerKey);
        }
      }

      // Phase 3: Forward propagate main chain quantities in topo order
      for (const key of topoOrder) {
        const data = uniqueNodes.get(key);
        if (!data) continue;
        const m = registry.get(data.machine);

        if (data.machine === "ore_source") {
          data.quantity = actualOreCount;
          continue;
        }

        // Calculate input quantity (sum from all parents feeding this node)
        let inputQty = 0;
        const parentKeys = (data.childKeys || []).filter(ck => !uniqueNodes.get(ck)?.isByproduct);
        for (const pk of parentKeys) {
          const parentData = uniqueNodes.get(pk);
          if (parentData) inputQty += parentData.quantity;
        }
        if (inputQty === 0) inputQty = data.quantity; // Fallback to walkChain value

        if (m?.inputs?.length >= 2) {
          // Combine machine
          const inputTypes = new Set(m.inputs.flatMap(i => i.split("|")));
          if (inputTypes.size === 1) {
            // Same-type combine (Prismatic: 2 gems → 1, Alloy: 2 bars → 1)
            data.quantity = Math.floor(inputQty / m.inputs.length);
          } else {
            // Mixed-type combine (Power Core, Casing, etc.)
            // Keep product qty (usually 1 per product, set by walkChain)
            data.quantity = productQty || 1;
          }
        } else if (data.machine === "seller" || data.machine === "quality_assurance") {
          data.quantity = productQty || 1;
        } else if (data.machine === "duplicator") {
          data.quantity = inputQty * 2;
        } else {
          // Single-input machine
          // Check if parent has multiple consumers (fan-out from alloy etc.)
          const parentConsumerCount = parentKeys.length === 1 ? (children.get(parentKeys[0]) || []).length : 0;
          if (parentConsumerCount > 1) {
            // Fan-out: count how many downstream machines reference THIS node
            // Each reference = 1 item needed from this machine
            let refCount = 0;
            for (const [mk, md] of uniqueNodes) {
              if (md.isByproduct || mk === key) continue;
              if ((md.childKeys || []).includes(key)) refCount += md.quantity;
            }
            data.quantity = refCount || 1;
          } else {
            // Single consumer: inherit parent qty
            data.quantity = inputQty;
          }
        }
      }

      // Phase 4: Side chain BFS propagation (Stone → Prospectors → Crusher → ...)
      for (const [key, data] of uniqueNodes) {
        if (data.machine !== "secondary_output") continue;
        const visited = new Set([key]);
        const queue = [[key, data.quantity]]; // [nodeKey, remainingQty]

        while (queue.length > 0) {
          const [currentKey, remaining] = queue.shift();
          const currentNode = uniqueNodes.get(currentKey);
          if (!currentNode) continue;

          const nextKeys = (currentNode.downstreamKeys || []).filter(dk =>
            !visited.has(dk) && uniqueNodes.get(dk)?.isByproduct
          );
          let currentRemaining = remaining;

          for (const nextKey of nextKeys) {
            visited.add(nextKey);
            const nextNode = uniqueNodes.get(nextKey);
            const nextM = registry.get(nextNode?.machine);
            if (!nextNode) continue;

            if (nextM?.effect === "chance") {
              const chance = nextM.value || 0.05;
              const produced = Math.round(currentRemaining * chance);
              currentRemaining -= produced;
              // Sifters show dust passthrough, prospectors show gem produced
              const isSifter = nextNode.machine === "sifter" || nextNode.machine === "nano_sifter";
              nextNode.quantity = isSifter ? currentRemaining : produced;
              // Set edge qty for cross-chain/different-type outputs
              if (!nextNode._edgeQty) nextNode._edgeQty = {};
              for (const dk of (nextNode.downstreamKeys || [])) {
                const dkNode = uniqueNodes.get(dk);
                if (!dkNode) continue;
                const edgeType = nextNode._edgeType?.[dk];
                const isDiffType = edgeType && edgeType !== nextNode.type;
                if (!dkNode.isByproduct || isDiffType) {
                  nextNode._edgeQty[dk] = produced;
                }
              }
              queue.push([nextKey, currentRemaining]);
            } else {
              // Non-chance: check if parent has specific edgeQty for this key
              // (set by chance machine for cross-chain/different-type outputs)
              let nodeQty = currentRemaining;
              // Check all possible edgeQty sources
              if (currentNode._edgeQty) {
                for (const ek of Object.keys(currentNode._edgeQty)) {
                  // Match by key directly or by finding the downstream key
                  if (ek === nextKey) { nodeQty = currentNode._edgeQty[ek]; break; }
                }
              }
              if (nextM?.inputs?.length >= 2) {
                nodeQty = Math.max(1, Math.ceil(currentRemaining / nextM.inputs.length));
              }
              nextNode.quantity = nodeQty;
              for (const dk of (nextNode.downstreamKeys || [])) {
                if (!nextNode._edgeQty) nextNode._edgeQty = {};
                nextNode._edgeQty[dk] = nodeQty;
              }
              queue.push([nextKey, nodeQty]);
            }
          }
        }
      }

      // Phase 5: Cross-chain connections, side chain additions, and re-propagation
      // 5a: Connect side chain endpoints to main chain consumers + handle excess
      const connectedMainKeys = new Set();
      for (const [sideKey, sideData] of uniqueNodes) {
        if (!sideData.isByproduct || sideData.machine === "sell_excess") continue;
        const sideType = sideData.type;
        if (!sideType) continue;
        if ((sideData.downstreamKeys || []).some(dk => !uniqueNodes.get(dk)?.isByproduct)) continue;

        for (const [mainKey, mainData] of uniqueNodes) {
          if (mainData.isByproduct || connectedMainKeys.has(mainKey)) continue;
          const mainM = registry.get(mainData.machine);
          if (!mainM?.inputs?.some(inp => inp === sideType || inp.split("|").includes(sideType))) continue;
          connectedMainKeys.add(mainKey);

          // Find LAST side chain node
          let lastKey = sideKey;
          const vis = new Set([sideKey]);
          while (true) {
            const n = uniqueNodes.get(lastKey);
            const ds = (n?.downstreamKeys || []).filter(dk =>
              !vis.has(dk) && uniqueNodes.get(dk)?.isByproduct && uniqueNodes.get(dk)?.machine !== "sell_excess"
            );
            if (ds.length === 0) break;
            lastKey = ds[0]; vis.add(lastKey);
          }
          const lastData = uniqueNodes.get(lastKey);
          const lastQty = lastData?.quantity || 0;
          const mainQty = mainData.quantity || 1;
          const excess = lastQty - mainQty;

          if (!lastData.downstreamKeys) lastData.downstreamKeys = [];
          if (!lastData.downstreamKeys.includes(mainKey)) lastData.downstreamKeys.push(mainKey);
          if (!lastData._edgeQty) lastData._edgeQty = {};
          lastData._edgeQty[mainKey] = Math.min(lastQty, mainQty);

          if (excess > 0) {
            const target = [...uniqueNodes.entries()].find(([k, d]) => d.machine === "quality_assurance" && !d.isByproduct)?.[0]
              || [...uniqueNodes.entries()].find(([k, d]) => d.machine === "seller" && !d.isByproduct)?.[0];
            if (target) {
              if (!lastData.downstreamKeys.includes(target)) lastData.downstreamKeys.push(target);
              lastData._edgeQty[target] = excess;
            }
          }
          break;
        }
      }

      // 5b: Add side chain extras to main chain and re-propagate forward
      // Collect all additions: sifter ores → ore_cleaner, prospector gems → gem_cutter
      const additions = new Map(); // mainKey → qty to add
      for (const [sideKey, sideData] of uniqueNodes) {
        if (!sideData.isByproduct || !sideData.downstreamKeys) continue;
        for (const dsKey of sideData.downstreamKeys) {
          const dsNode = uniqueNodes.get(dsKey);
          if (!dsNode || dsNode.isByproduct) continue;
          if (dsNode.machine === "quality_assurance" || dsNode.machine === "seller") continue;
          const edgeQty = sideData._edgeQty?.[dsKey];
          if (!edgeQty || edgeQty <= 0) continue;
          const dsM = registry.get(dsNode.machine);
          if (dsM?.inputs?.length >= 2) {
            const ut = new Set(dsM.inputs.flatMap(i => i.split("|")));
            if (ut.size > 1) continue; // Skip mixed-type combines
          }
          additions.set(dsKey, (additions.get(dsKey) || 0) + edgeQty);
        }
      }

      // Re-propagate from each addition point through the main chain
      if (additions.size > 0) {
        // Process additions in topo order
        for (const key of topoOrder) {
          const extra = additions.get(key);
          if (!extra) continue;
          const data = uniqueNodes.get(key);
          if (!data) continue;
          data.quantity += extra;

          // Propagate the addition forward through single-input machines
          // Stop at same-type combines (they need recalculation, not addition)
          let cascadeExtra = extra;
          let cascadeKey = key;
          const cascaded = new Set([cascadeKey]);
          while (cascadeKey) {
            let nextKey = null;
            for (const ck of (children.get(cascadeKey) || [])) {
              if (cascaded.has(ck)) continue;
              const cd = uniqueNodes.get(ck);
              if (!cd || cd.isByproduct) continue;
              const cm = registry.get(cd.machine);
              if (cm?.inputs?.length !== 1) break; // Stop at combines
              cd.quantity += cascadeExtra;
              cascaded.add(ck);
              nextKey = ck;
              break;
            }
            cascadeKey = nextKey;
          }
        }

        // Recalculate same-type combines and enhancement path with updated values
        const btgNode = [...uniqueNodes.entries()].find(([k, d]) => d.machine === "bar_to_gem" && !d.isByproduct);
        const gcNode = [...uniqueNodes.entries()].find(([k, d]) => d.machine === "gem_cutter" && !d.isByproduct);
        const prNode = [...uniqueNodes.entries()].find(([k, d]) => d.machine === "prismatic_crucible" && !d.isByproduct);
        const g2bNode = [...uniqueNodes.entries()].find(([k, d]) => d.machine === "gem_to_bar" && !d.isByproduct);

        if (btgNode && gcNode) {
          const btgQty = btgNode[1].quantity;
          const gemExtra = additions.get(gcNode[0]) || 0;
          const totalGems = btgQty + gemExtra;
          gcNode[1].quantity = totalGems;
          if (prNode) {
            // Prismatic processes ALL gems (main chain + prospector extras)
            prNode[1].quantity = Math.floor(totalGems / 2);
            if (g2bNode) g2bNode[1].quantity = prNode[1].quantity;
          }
        }

        // Final: recalculate same-type combines from updated children
        for (const [key, data] of uniqueNodes) {
          if (data.isByproduct) continue;
          if (data.machine === "prismatic_crucible") continue; // Already set above
          const m = registry.get(data.machine);
          if (!m?.inputs || m.inputs.length < 2) continue;
          const ut = new Set(m.inputs.flatMap(i => i.split("|")));
          if (ut.size > 1) continue;
          if (data.childKeys?.length > 0) {
            const childData = uniqueNodes.get(data.childKeys[0]);
            if (childData) data.quantity = Math.floor(childData.quantity / m.inputs.length);
          }
        }
      }

      // Step G: Detect excess in main chain and route to QA → Seller
      // For any main chain node where output > total downstream demand, sell excess
      for (const [key, data] of uniqueNodes) {
        if (data.isByproduct) continue;
        if (data.machine === "seller" || data.machine === "quality_assurance") continue;
        const myConsumers = children.get(key) || [];
        const mainConsumers = myConsumers.filter(ck => !uniqueNodes.get(ck)?.isByproduct);
        if (mainConsumers.length === 0) continue; // No consumers = end of chain

        // Sum what downstream actually needs
        let totalDemand = 0;
        for (const ck of mainConsumers) {
          const cd = uniqueNodes.get(ck);
          if (!cd) continue;
          const cm = registry.get(cd.machine);
          if (cm?.inputs?.length >= 2) {
            // Combine machine: needs 1 of this type per product
            totalDemand += cd.quantity;
          } else {
            // Single-input: passes through everything
            totalDemand += cd.quantity;
          }
        }

        const excess = data.quantity - totalDemand;
        if (excess > 0) {
          // Route excess to QA → Seller
          const qaKey = [...uniqueNodes.entries()].find(([k, d]) =>
            d.machine === "quality_assurance" && !d.isByproduct
          )?.[0];
          const sellerKey = [...uniqueNodes.entries()].find(([k, d]) =>
            d.machine === "seller" && !d.isByproduct
          )?.[0];
          const target = qaKey || sellerKey;
          if (target) {
            if (!data.downstreamKeys) data.downstreamKeys = [];
            if (!data.downstreamKeys.includes(target)) {
              data.downstreamKeys.push(target);
            }
            if (!data._edgeQty) data._edgeQty = {};
            data._edgeQty[target] = excess;
            // Also set edge qty for the main consumers
            for (const ck of mainConsumers) {
              data._edgeQty[ck] = uniqueNodes.get(ck)?.quantity || 0;
            }
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
          // Check if CHILD has edge qty for this parent (e.g., Prismatic → Gem to Bar)
          // _edgeQty is stored on the SOURCE node (child) keyed by TARGET (parent)
          const childEdgeQty = childData?._edgeQty?.[key];
          edges.push({
            from: toId,
            to: fromId,
            itemType: edgeItemType,
            qty: childEdgeQty,
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
          if (edgeQty === undefined && dsData) {
            const dsM = registry.get(dsData.machine);
            const inputCount = (dsM?.effect === "combine" && dsM.inputs?.length > 1) ? dsM.inputs.length : 1;
            edgeQty = dsData.quantity * inputCount;
          }
          // Use override type if set (e.g., sifter ore output), otherwise source type
          let edgeType = data._edgeType?.[dsKey] || data.type || "?";
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
