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
    function walkNode(node, parentId, parentKey, isEnhancement, isCheapPath) {
      if (!node) return null;

      // Handle ore processing chain (flat machines[] array, no .machine property)
      if (node.machines && Array.isArray(node.machines)) {
        return walkOreChain(node, parentId, parentKey, isCheapPath);
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

      // Dedup: if already visited, just add edge from this to parent
      if (visited.has(key)) {
        const existingId = visited.get(key);
        if (parentId !== null && existingId !== parentId) {
          edges.push({
            from: existingId, to: parentId,
            itemType: type, quantity: 0, kind: isEnhancement ? "enhancement" : "main"
          });
        }
        return existingId;
      }

      // Create node
      const id = nextId++;
      visited.set(key, id);

      const isCheap = isCheapPath || !!node._cheapPath;
      const quantity = isCheap
        ? (node.oreCount || 1) // Cheap path: use flow's ore count directly
        : getQuantity(machine, type, node);

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

      // Recurse into inputs
      if (node.inputs) {
        for (const child of node.inputs) {
          if (!child) continue;
          const childIsCheap = isCheap || !!child._cheapPath;
          walkNode(child, id, key, false, childIsCheap);
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
        }
      }

      return id;
    }

    // Walk ore processing chain (flat machines[] array like [ore_upgrader, ore_cleaner, polisher, philosophers_stone])
    function walkOreChain(node, parentId, parentKey, isCheapPath) {
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
              // Build processing path for tooltip
              const path = [gemType + ' Gem'];
              const gemProcessors = [];
              for (const [gpId, gpM] of registry.machines) {
                if (!registry.isAvailable(gpId, config)) continue;
                const acceptsGem = (gpM.inputs || []).some(inp => inp === 'gem' || inp.split('|').includes('gem'));
                if (!acceptsGem) continue;
                const skip = new Set(['chance','transport','split','overflow','filter','gate','duplicate','preserve','set']);
                if (skip.has(gpM.effect)) continue;
                if (gpM.inputs.length > 1 && !gpM.inputs.every(inp => inp === 'gem' || inp.split('|').includes('gem'))) continue;
                gemProcessors.push({ id: gpId, name: gpM.name || gpId, effect: gpM.effect });
              }
              // Sort: single-input first (gem_cutter), then combine (prismatic)
              gemProcessors.sort((a, b) => {
                const am = registry.get(a.id);
                const bm = registry.get(b.id);
                return (am?.inputs?.length || 1) - (bm?.inputs?.length || 1);
              });
              for (const gp of gemProcessors) path.push(gp.name);
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
    walkNode(chainResult, topParentId, null, false, false);

    return { nodes, edges };
  }
}
