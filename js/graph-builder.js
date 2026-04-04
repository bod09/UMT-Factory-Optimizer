// UMT Factory Optimizer - Graph Builder
// Single-pass graph construction from FlowOptimizer chain results.
// No post-processing phases, no dual edge systems, no promotion hacks.

class FlowGraphBuilder {
  /**
   * Build a {nodes[], edges[]} graph from a flow chain result.
   * @param {Object} chainResult - Tree from FlowOptimizer.evaluateFullChain()
   * @param {MachineRegistry} registry
   * @param {Object} config
   * @param {Object} opts - { dupAt, productQty }
   * @param {Map} flowMemo - FlowOptimizer.memo (type → {value, oreCount, ...})
   * @param {number} actualOreCount - Total ores feeding the chain
   */
  static buildGraph(chainResult, registry, config, opts = {}, _unused = {}, flowMemo = null, actualOreCount = 0) {
    const { dupAt, productQty = 1 } = opts;
    const nodes = [];
    const edges = [];
    let nextId = 1;
    const visited = new Map(); // nodeKey → nodeId (dedup)
    const finalOutput = new Map(); // nodeKey → final output nodeId (after modifiers/enhancement)

    // Helper: get display-ready quantity for a machine/type
    function getQuantity(machine, type, node) {
      if (machine === "ore_source") return actualOreCount;
      if (machine === "seller" || machine === "quality_assurance") return productQty;
      if (machine === "duplicator") return node?.throughput ? node.throughput * 2 : productQty;

      // Byproduct types (oreCount=0) get quantity from parent ratio
      if (flowMemo) {
        const memo = flowMemo.get(type);
        if (memo && memo.oreCount > 0) {
          return Math.max(1, Math.ceil(actualOreCount / memo.oreCount));
        }
      }

      // Fallback to throughput from flow
      return node?.throughput || 1;
    }

    // Helper: create a unique key for dedup
    function nodeKey(machine, type, prefix) {
      return (prefix || "") + machine + ":" + type;
    }

    // Walk the flow chain tree recursively, creating nodes and edges
    // parentQty: how many items the parent needs from this node
    function walkNode(node, parentId, parentKey, isEnhancement, isCheapPath, parentQty) {
      if (!node) return null;
      if (parentQty === undefined) parentQty = productQty;

      // Handle ore processing chain (flat machines[] array, no .machine property)
      if (node.machines && Array.isArray(node.machines)) {
        return walkOreChain(node, parentId, parentKey, isCheapPath, parentQty);
      }

      if (!node.machine) return null;
      const machine = node.machine;
      if (machine === "smelter_byproduct" || machine === "byproduct_free" ||
          machine === "byproduct_source" || machine === "cycle_ref") return null;

      const m = registry.get(machine);
      const registryOutType = m?.outputs?.[0]?.type;
      const type = (registryOutType && registryOutType !== "same")
        ? registryOutType
        : (node.resolvedType || node.type || "?");

      // Cheap path nodes get prefixed keys to avoid merging with main chain
      const prefix = (isCheapPath || node._cheapPath) ? "cheap_" : "";
      const key = nodeKey(machine, type, prefix);

      // Dedup: if already visited, add edge from the FINAL output
      // (after modifiers/enhancement, not the raw producer)
      if (visited.has(key)) {
        const outputId = finalOutput.get(key) || visited.get(key);
        if (parentId !== null && outputId !== parentId) {
          edges.push({
            from: outputId, to: parentId,
            itemType: type, quantity: parentQty, kind: isEnhancement ? "enhancement" : "main"
          });
        }
        return outputId;
      }

      // Create node
      const id = nextId++;
      visited.set(key, id);

      const isCheap = isCheapPath || !!node._cheapPath;
      const quantity = isCheap
        ? (node.oreCount || 1)
        : parentQty; // Use demand from parent, not global formula

      nodes.push({
        id, machine, type,
        name: m?.name || machine,
        value: Math.round(node.value || 0),
        quantity,
        category: m?.category || "source",
        displayType: null,
        secondaryValue: null,
      });

      // Edge to parent
      if (parentId !== null) {
        edges.push({
          from: id, to: parentId,
          itemType: type,
          quantity,
          kind: isEnhancement ? "enhancement" : (isCheap ? "byproduct" : "main")
        });
      }

      // Recurse into inputs — each input needs `quantity` items
      if (node.inputs) {
        for (const child of node.inputs) {
          if (!child) continue;
          const childIsCheap = isCheap || !!child._cheapPath;
          walkNode(child, id, key, false, childIsCheap, quantity);
        }
      }

      // Applied modifiers become inline nodes
      let lastId = id;
      if (node.appliedModifiers) {
        for (const mod of node.appliedModifiers) {
          const modM = registry.get(mod.id);
          if (!modM) continue;
          const modType = mod.outputType || type;
          const modKey = nodeKey(mod.id, modType);
          if (visited.has(modKey)) {
            // Already exists, just wire edge
            const existingModId = visited.get(modKey);
            // Rewire: parent should connect to modifier, modifier connects to us
            // Remove the direct edge from lastId to parentId and add modifier in between
            lastId = existingModId;
            continue;
          }
          const modId = nextId++;
          visited.set(modKey, modId);
          nodes.push({
            id: modId, machine: mod.id, type: modType,
            name: modM.name || mod.id,
            value: Math.round(node.value || 0),
            quantity: getQuantity(mod.id, modType, node),
            category: modM.category || "metalwork",
          });
          // Modifier takes input from previous node
          edges.push({
            from: lastId, to: modId,
            itemType: type, quantity: getQuantity(mod.id, modType, node),
            kind: "main"
          });
          lastId = modId;
        }
        // If modifiers were added, rewire the parent edge
        if (lastId !== id && parentId !== null) {
          // Remove the direct id→parentId edge and add lastId→parentId
          const directIdx = edges.findIndex(e => e.from === id && e.to === parentId);
          if (directIdx >= 0) edges.splice(directIdx, 1);
          edges.push({
            from: lastId, to: parentId,
            itemType: type, quantity,
            kind: "main"
          });
        }
      }

      // Enhancement path: bar → gem → gem_cutter → prismatic → gem_to_bar
      if (node.enhancementPath) {
        let prevEnhId = lastId;
        for (const enhMachineId of node.enhancementPath) {
          const enhM = registry.get(enhMachineId);
          if (!enhM) continue;
          const enhOutType = enhM.outputs?.[0]?.type || type;
          const enhKey = nodeKey(enhMachineId, enhOutType);
          if (visited.has(enhKey)) {
            const existingId = visited.get(enhKey);
            edges.push({
              from: prevEnhId, to: existingId,
              itemType: enhOutType, quantity: getQuantity(enhMachineId, enhOutType, node),
              kind: "enhancement"
            });
            prevEnhId = existingId;
            continue;
          }
          const enhId = nextId++;
          visited.set(enhKey, enhId);
          const enhQty = getQuantity(enhMachineId, enhOutType, node);
          nodes.push({
            id: enhId, machine: enhMachineId, type: enhOutType,
            name: enhM.name || enhMachineId,
            value: Math.round(node.value || 0),
            quantity: enhQty,
            category: enhM.category || "jewelcrafting",
          });
          edges.push({
            from: prevEnhId, to: enhId,
            itemType: enhOutType, quantity: enhQty,
            kind: "enhancement"
          });
          prevEnhId = enhId;
        }
        // Rewire parent edge to come from last enhancement node
        if (prevEnhId !== lastId && parentId !== null) {
          const directIdx = edges.findIndex(e => e.from === lastId && e.to === parentId);
          if (directIdx >= 0) edges.splice(directIdx, 1);
          edges.push({
            from: prevEnhId, to: parentId,
            itemType: type, quantity,
            kind: "enhancement"
          });
          lastId = prevEnhId;
        }
      }

      // Byproduct outputs (stone from blast furnace, etc.)
      if (node.byproductOutputs) {
        const bpRatio = m?.byproductRatio || 0.5;
        for (const bp of node.byproductOutputs) {
          if (!bp.result || !bp.type) continue;
          walkByproductChain(id, bp, quantity, bpRatio, isCheap);
        }
      }

      // Duplicator insertion
      if (dupAt && type === dupAt && !visited.has(nodeKey("duplicator", type))) {
        const dupId = nextId++;
        visited.set(nodeKey("duplicator", type), dupId);
        nodes.push({
          id: dupId, machine: "duplicator", type,
          name: "Duplicator",
          value: Math.round(node.value || 0),
          quantity: quantity * 2,
          category: "prestige",
        });
        // Rewire: find edge from lastId→parentId, replace with lastId→dup→parentId
        if (parentId !== null) {
          const directIdx = edges.findIndex(e => e.from === lastId && e.to === parentId);
          if (directIdx >= 0) edges.splice(directIdx, 1);
          edges.push({ from: lastId, to: dupId, itemType: type, quantity, kind: "main" });
          edges.push({ from: dupId, to: parentId, itemType: type, quantity: quantity * 2, kind: "main" });
          lastId = dupId;
        }
      }

      // Record the final output node (after modifiers/enhancement/dup wrapping)
      // so dedup can connect to the RIGHT node, not the raw producer
      if (lastId !== id) {
        finalOutput.set(key, lastId);
      }

      return id;
    }

    // Walk ore processing chain (flat machines[] array like [ore_upgrader, ore_cleaner, polisher, philosophers_stone])
    function walkOreChain(node, parentId, parentKey, isCheapPath, parentQty) {
      const prefix = (isCheapPath || node._cheapPath) ? "cheap_" : "";
      let prevId = null;

      // Process in reverse (ore_source first, then upgrader, cleaner, etc.)
      // Create ore_source as the leftmost node
      const oreKey = nodeKey(prefix + "ore_source", "ore");
      if (!visited.has(oreKey)) {
        const oreId = nextId++;
        visited.set(oreKey, oreId);
        const oreQty = isCheapPath ? 1 : actualOreCount;
        nodes.push({
          id: oreId, machine: "ore_source", type: "ore",
          name: "Ore Input", value: Math.round(node.value || 0),
          quantity: oreQty, category: "source",
        });
        prevId = oreId;
      } else {
        prevId = visited.get(oreKey);
      }

      // Walk each machine in the ore processing chain
      for (const machineId of node.machines) {
        if (machineId === "smelter_byproduct" || machineId === "byproduct_free" ||
            machineId === "byproduct_source" || machineId === "cycle_ref") continue;

        const m2 = registry.get(machineId);
        const mKey = nodeKey(prefix + machineId, "ore");
        if (visited.has(mKey)) {
          prevId = visited.get(mKey);
          continue;
        }

        const mId = nextId++;
        visited.set(mKey, mId);
        const mQty = isCheapPath ? 1 : getQuantity(machineId, "ore", node);
        nodes.push({
          id: mId, machine: machineId, type: "ore",
          name: m2?.name || machineId,
          value: Math.round(node.value || 0),
          quantity: mQty,
          category: m2?.category || "prestige",
        });
        if (prevId !== null) {
          edges.push({
            from: prevId, to: mId,
            itemType: "ore", quantity: mQty,
            kind: isCheapPath ? "byproduct" : "main"
          });
        }
        prevId = mId;
      }

      // Connect last ore chain node to parent
      if (prevId !== null && parentId !== null) {
        edges.push({
          from: prevId, to: parentId,
          itemType: "ore", quantity: isCheapPath ? 1 : actualOreCount,
          kind: isCheapPath ? "byproduct" : "main"
        });
      }

      return prevId;
    }

    // Walk byproduct chain (stone → prospectors → crusher → etc.)
    function walkByproductChain(producerId, bp, parentQty, bpRatio, isCheap) {
      const bpQty = Math.max(1, Math.round(parentQty * bpRatio));
      const prefix = isCheap ? "cheap_" : "";

      // Create source node for byproduct type
      const sourceKey = nodeKey(prefix + "secondary_output", bp.type);
      let sourceId;
      if (visited.has(sourceKey)) {
        sourceId = visited.get(sourceKey);
        // Update quantity
        const sourceNode = nodes.find(n => n.id === sourceId);
        if (sourceNode) sourceNode.quantity += bpQty;
      } else {
        sourceId = nextId++;
        visited.set(sourceKey, sourceId);
        nodes.push({
          id: sourceId, machine: "secondary_output", type: bp.type,
          name: ITEM_TYPES[bp.type] || bp.type,
          value: Math.round(bp.result?.value || 0),
          quantity: bpQty,
          category: "stonework",
        });
      }
      // Edge from producer to byproduct source
      edges.push({
        from: producerId, to: sourceId,
        itemType: bp.type, quantity: bpQty, kind: "byproduct"
      });

      // Walk the downstream chain (chance machines, then processing)
      const chanceSteps = (bp.result.chanceChain || []).map(c => ({
        machine: c.machine, type: bp.type,
        value: bp.result.value, isChanceMachine: true,
        gemType: c.gemType, chance: c.chance,
        byproductValue: c.byproductValue,
      }));

      const sideSteps = [
        ...chanceSteps,
        { machine: bp.result.machine, type: bp.result.resolvedType, value: bp.result.value },
        ...(bp.result.downstreamChain || [])
      ];

      let prevSideId = sourceId;
      let remaining = bpQty;

      for (const step of sideSteps) {
        if (!step.machine) continue;
        const sideM = registry.get(step.machine);
        let sideType = sideM?.outputs?.[0]?.type || step.type || "?";
        if (sideType === "same") sideType = step.type || "?";

        const sideKey = nodeKey(step.machine, sideType);
        let sideId;

        if (visited.has(sideKey)) {
          sideId = visited.get(sideKey);
          const existing = nodes.find(n => n.id === sideId);
          if (existing) existing.quantity += remaining;
        } else {
          sideId = nextId++;
          visited.set(sideKey, sideId);

          // Chance machine display
          const isChance = sideM?.effect === "chance" || step.isChanceMachine;
          const gemType = sideM?.gemType || step.gemType;
          const chance = sideM?.value || step.chance;
          let displayType = null;
          let nodeValue = step.value || 0;
          let secondaryValue = null;

          // Chance machine annotation: show what it produces
          let chanceProduced = null;
          if (isChance) {
            const ch = chance || 0.05;
            const producedQty = remaining * ch;
            if (gemType) {
              displayType = `${gemType} Gem (${Math.round(ch * 100)}%)`;
              const gemData = typeof GEMS !== 'undefined' ? GEMS.find(g => g.name === gemType) : null;
              nodeValue = gemData?.value || step.byproductValue || 0;
              secondaryValue = step.value || 0;
              // Build processing path for tooltip — must match solver order:
              // 1. Single-input processors (Gem Cutter)
              // 2. Polisher (+flat, before % machines)
              // 3. Same-type combines (Prismatic)
              // 4. QA (% last)
              const path = [gemType + ' Gem'];
              const skipEff = new Set(['chance','transport','split','overflow','filter','gate','duplicate','preserve','set','combine']);

              // Step 1: single-input gem processors
              for (const [gpId, gpM] of registry.machines) {
                if (!registry.isAvailable(gpId, config)) continue;
                if (!gpM.inputs || gpM.inputs.length !== 1) continue;
                if (skipEff.has(gpM.effect)) continue;
                const acceptsGem = gpM.inputs.some(inp => inp === 'gem' || inp.split('|').includes('gem'));
                if (!acceptsGem) continue;
                path.push(gpM.name || gpId);
              }

              // Step 2: Polisher (flat, before combines/QA)
              const polisher = registry.get("polisher");
              if (polisher?.tag && registry.isAvailable("polisher", config)) {
                path.push('Polisher');
              }

              // Step 3: same-type gem combines (Prismatic)
              for (const [gpId, gpM] of registry.machines) {
                if (!registry.isAvailable(gpId, config)) continue;
                if (gpM.effect !== 'combine') continue;
                const allGem = (gpM.inputs || []).every(inp => inp === 'gem' || inp.split('|').includes('gem'));
                if (!allGem) continue;
                path.push(gpM.name || gpId);
              }

              // Step 4: QA (percent, last)
              if (registry.isAvailable("quality_assurance", config)) {
                path.push('QA');
              }
              path.push('Sell');
              chanceProduced = { qty: producedQty, label: `${gemType} Gem`, value: step.byproductValue || 0, path };
            } else {
              // Sifter-type: produces ore byproduct
              const bpType = sideM?.byproducts?.[0]?.type || "ore";
              const bpLabel = ITEM_TYPES[bpType] || bpType;
              const sifterPath = [bpLabel, 'Ore Processing Chain', 'Sell'];
              chanceProduced = { qty: producedQty, label: bpLabel, value: 0, path: sifterPath };
              displayType = `${ITEM_TYPES[sideType] || sideType} (${Math.round(ch * 100)}% ${bpLabel})`;
            }
          }

          nodes.push({
            id: sideId, machine: step.machine,
            type: isChance && gemType ? "gem" : sideType,
            name: sideM?.name || step.machine,
            value: Math.round(nodeValue),
            quantity: remaining,
            category: sideM?.category || "stonework",
            displayType, secondaryValue, chanceProduced,
          });
        }

        if (prevSideId !== sideId) {
          edges.push({
            from: prevSideId, to: sideId,
            itemType: step.type || sideType, quantity: remaining,
            kind: "byproduct"
          });

          // If this step is a modifier wrapping the previous step (same output type),
          // set finalOutput so dedup routes through the modifier, not the raw producer
          const prevNode = nodes.find(n => n.id === prevSideId);
          if (prevNode && sideType === (prevNode.type || '')) {
            const prevKey = nodeKey(prevNode.machine, prevNode.type);
            finalOutput.set(prevKey, sideId);
          }
        }

        // Chance machines reduce remaining
        if (step.isChanceMachine) {
          const ch = step.chance || 0.05;
          remaining = Math.round(remaining * (1 - ch));
        }

        prevSideId = sideId;
      }
    }

    // === Build the graph ===

    // Terminal node: the machine that produces the final product
    const terminalType = chainResult.resolvedType || chainResult.type || "?";
    const terminalMachine = chainResult.machine;

    // Add QA if available
    const qa = registry.get("quality_assurance");
    const hasQA = qa && registry.isAvailable("quality_assurance", config);

    // Add Seller
    const sellerId = nextId++;
    const sellerValue = chainResult.value * (hasQA ? (1 + qa.value) : 1) * (config.hasDoubleSeller ? 2 : 1);
    nodes.push({
      id: sellerId, machine: "seller", type: "sell",
      name: config.hasDoubleSeller ? "Double Seller (x2)" : "Seller",
      value: Math.round(sellerValue),
      quantity: productQty, category: "source",
    });

    let topParentId = sellerId;

    // Add QA
    if (hasQA) {
      const qaId = nextId++;
      nodes.push({
        id: qaId, machine: "quality_assurance", type: terminalType,
        name: "Quality Assurance",
        value: Math.round(chainResult.value * (1 + qa.value)),
        quantity: productQty, category: qa.category || "multipurpose",
      });
      edges.push({
        from: qaId, to: sellerId,
        itemType: terminalType, quantity: productQty, kind: "main"
      });
      topParentId = qaId;
    }

    // Walk the chain tree
    walkNode(chainResult, topParentId, null, false, false, productQty);

    // === QUANTITY PROPAGATION ===
    // The tree walk sets initial quantities from parentQty, but shared nodes
    // (alloy_furnace used by 5 consumers) only got the FIRST consumer's qty.
    // Fix: top-down BFS from seller, each node's qty = sum of consumer demand.
    const nodeById = new Map(nodes.map(n => [n.id, n]));

    // Build consumer map: for each node, which nodes consume it? (edges FROM this TO consumer)
    const consumersOf = new Map(); // nodeId → [consumerId, ...]
    for (const edge of edges) {
      if (!consumersOf.has(edge.from)) consumersOf.set(edge.from, []);
      consumersOf.get(edge.from).push(edge.to);
    }
    // Build supplier map: for each node, which nodes supply it? (edges TO this FROM supplier)
    const suppliersOf = new Map();
    for (const edge of edges) {
      if (!suppliersOf.has(edge.to)) suppliersOf.set(edge.to, []);
      suppliersOf.get(edge.to).push(edge.from);
    }

    // Topological sort (BFS from seller) then propagate quantities top-down
    const inDegree = new Map();
    for (const n of nodes) inDegree.set(n.id, 0);
    for (const edge of edges) {
      inDegree.set(edge.from, (inDegree.get(edge.from) || 0) + 1);
    }
    // Start from nodes with no consumers (seller)
    const topo = [];
    const q = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) q.push(id);
    }
    while (q.length > 0) {
      const id = q.shift();
      topo.push(id);
      for (const suppId of (suppliersOf.get(id) || [])) {
        inDegree.set(suppId, inDegree.get(suppId) - 1);
        if (inDegree.get(suppId) === 0) q.push(suppId);
      }
    }

    // Propagate: each node's qty = sum of qty demanded by its consumers
    // Seller starts at productQty, everything flows down from there
    for (const id of topo) {
      const nd = nodeById.get(id);
      if (!nd) continue;

      // For the root (seller), keep productQty
      const consumers = consumersOf.get(id) || [];
      if (consumers.length > 0) {
        // This node's qty = sum of what each consumer needs from it
        let totalDemand = 0;
        for (const consId of consumers) {
          const consNode = nodeById.get(consId);
          if (consNode) totalDemand += consNode.quantity;
        }
        // Only update if we have consumer demand (don't override root nodes)
        if (totalDemand > 0 && nd.machine !== "seller" && nd.machine !== "quality_assurance") {
          nd.quantity = totalDemand;
        }
      }
    }

    return { nodes, edges };
  }
}
