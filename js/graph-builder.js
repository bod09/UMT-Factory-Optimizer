// UMT Factory Optimizer - Graph Builder (v2)
// Two-pass system: Pass 1 builds structure, Pass 2 propagates quantities.
// No quantity logic mixed into the tree walk.

class FlowGraphBuilder {
  static buildGraph(chainResult, registry, config, opts = {}, _unused = {}, flowMemo = null, actualOreCount = 0) {
    const { dupAt, productQty = 1 } = opts;
    const nodes = [];
    const edges = [];
    let nextId = 1;
    const visited = new Map();     // nodeKey → nodeId
    const finalOutput = new Map(); // nodeKey → final wrapped nodeId

    function nodeKey(machine, type, prefix) {
      return (prefix || "") + machine + ":" + type;
    }

    // ═══════════════════════════════════════════════════════
    // PASS 1: Build graph structure (all quantities = 0)
    // ═══════════════════════════════════════════════════════

    function walkNode(node, parentId, isEnhancement, isCheapPath) {
      if (!node) return null;

      // Ore processing chain (flat machines[] array)
      if (node.machines && Array.isArray(node.machines)) {
        return walkOreChain(node, parentId, isCheapPath);
      }

      if (!node.machine) return null;
      const machine = node.machine;
      if (machine === "smelter_byproduct" || machine === "byproduct_free" ||
          machine === "byproduct_source" || machine === "cycle_ref") return null;

      const m = registry.get(machine);
      const registryOutType = m?.outputs?.[0]?.type;
      const type = (registryOutType && registryOutType !== "same")
        ? registryOutType : (node.resolvedType || node.type || "?");

      const prefix = (isCheapPath || node._cheapPath) ? "cheap_" : "";
      const key = nodeKey(machine, type, prefix);
      const isCheap = isCheapPath || !!node._cheapPath;

      // Dedup: add edge from final wrapped output
      if (visited.has(key)) {
        const outputId = finalOutput.get(key) || visited.get(key);
        if (parentId !== null && outputId !== parentId) {
          edges.push({ from: outputId, to: parentId, itemType: type, quantity: 0,
            kind: isEnhancement ? "enhancement" : (isCheap ? "byproduct" : "main") });
        }
        return outputId;
      }

      // Create node (qty=0, set in Pass 2)
      const id = nextId++;
      visited.set(key, id);
      nodes.push({
        id, machine, type,
        name: m?.name || machine,
        value: Math.round(node.value || 0),
        quantity: 0,
        category: m?.category || "source",
        displayType: null, secondaryValue: null, chanceProduced: null,
      });

      // Edge to parent
      if (parentId !== null) {
        edges.push({ from: id, to: parentId, itemType: type, quantity: 0,
          kind: isEnhancement ? "enhancement" : (isCheap ? "byproduct" : "main") });
      }

      // Recurse into inputs
      if (node.inputs) {
        for (const child of node.inputs) {
          if (!child) continue;
          walkNode(child, id, false, isCheap || !!child._cheapPath);
        }
      }

      // Applied modifiers (inline wrapper nodes)
      let lastId = id;
      if (node.appliedModifiers) {
        for (const mod of node.appliedModifiers) {
          const modM = registry.get(mod.id);
          if (!modM) continue;
          const modType = mod.outputType || type;
          const modKey = nodeKey(mod.id, modType);
          if (visited.has(modKey)) {
            lastId = visited.get(modKey);
            continue;
          }
          const modId = nextId++;
          visited.set(modKey, modId);
          nodes.push({
            id: modId, machine: mod.id, type: modType,
            name: modM.name || mod.id, value: Math.round(node.value || 0),
            quantity: 0, category: modM.category || "metalwork",
          });
          edges.push({ from: lastId, to: modId, itemType: type, quantity: 0, kind: "main" });
          lastId = modId;
        }
        if (lastId !== id && parentId !== null) {
          const idx = edges.findIndex(e => e.from === id && e.to === parentId);
          if (idx >= 0) edges.splice(idx, 1);
          edges.push({ from: lastId, to: parentId, itemType: type, quantity: 0, kind: "main" });
        }
      }

      // Enhancement path
      if (node.enhancementPath) {
        let prevEnhId = lastId;
        for (const enhMachineId of node.enhancementPath) {
          const enhM = registry.get(enhMachineId);
          if (!enhM) continue;
          const enhOutType = enhM.outputs?.[0]?.type || type;
          const enhKey = nodeKey(enhMachineId, enhOutType);
          if (visited.has(enhKey)) {
            const existingId = visited.get(enhKey);
            edges.push({ from: prevEnhId, to: existingId, itemType: enhOutType, quantity: 0, kind: "enhancement" });
            prevEnhId = existingId;
            continue;
          }
          const enhId = nextId++;
          visited.set(enhKey, enhId);
          nodes.push({
            id: enhId, machine: enhMachineId, type: enhOutType,
            name: enhM.name || enhMachineId, value: Math.round(node.value || 0),
            quantity: 0, category: enhM.category || "jewelcrafting",
          });
          edges.push({ from: prevEnhId, to: enhId, itemType: enhOutType, quantity: 0, kind: "enhancement" });
          prevEnhId = enhId;
        }
        if (prevEnhId !== lastId && parentId !== null) {
          const idx = edges.findIndex(e => e.from === lastId && e.to === parentId);
          if (idx >= 0) edges.splice(idx, 1);
          edges.push({ from: prevEnhId, to: parentId, itemType: type, quantity: 0, kind: "enhancement" });
          lastId = prevEnhId;
        }
      }

      // Byproduct outputs
      if (node.byproductOutputs) {
        for (const bp of node.byproductOutputs) {
          if (!bp.result || !bp.type) continue;
          walkByproductChain(id, bp, isCheap);
        }
      }

      // Duplicator insertion (dupAt format: "type" or "type in terminal")
      const dupTargetType = dupAt?.split(" in ")[0];
      if (dupTargetType && type === dupTargetType && !visited.has(nodeKey("duplicator", type))) {
        const dupId = nextId++;
        visited.set(nodeKey("duplicator", type), dupId);
        nodes.push({
          id: dupId, machine: "duplicator", type,
          name: "Duplicator", value: Math.round(node.value || 0),
          quantity: 0, category: "prestige",
        });
        if (parentId !== null) {
          const idx = edges.findIndex(e => e.from === lastId && e.to === parentId);
          if (idx >= 0) edges.splice(idx, 1);
          edges.push({ from: lastId, to: dupId, itemType: type, quantity: 0, kind: "main" });
          edges.push({ from: dupId, to: parentId, itemType: type, quantity: 0, kind: "main" });
          lastId = dupId;
        }
      }

      // Record final wrapped output for dedup
      if (lastId !== id) finalOutput.set(key, lastId);
      return id;
    }

    function walkOreChain(node, parentId, isCheapPath) {
      const prefix = (isCheapPath || node._cheapPath) ? "cheap_" : "";
      let prevId = null;

      const oreKey = nodeKey(prefix + "ore_source", "ore");
      if (!visited.has(oreKey)) {
        const oreId = nextId++;
        visited.set(oreKey, oreId);
        nodes.push({
          id: oreId, machine: "ore_source", type: "ore",
          name: "Ore Input", value: Math.round(node.value || 0),
          quantity: 0, category: "source",
        });
        prevId = oreId;
      } else {
        prevId = visited.get(oreKey);
      }

      for (const machineId of node.machines) {
        if (machineId === "smelter_byproduct" || machineId === "byproduct_free" ||
            machineId === "byproduct_source" || machineId === "cycle_ref" ||
            machineId === "ore_source") continue;

        const m2 = registry.get(machineId);
        const mKey = nodeKey(prefix + machineId, "ore");
        if (visited.has(mKey)) { prevId = visited.get(mKey); continue; }

        const mId = nextId++;
        visited.set(mKey, mId);
        nodes.push({
          id: mId, machine: machineId, type: "ore",
          name: m2?.name || machineId, value: Math.round(node.value || 0),
          quantity: 0, category: m2?.category || "prestige",
        });
        if (prevId !== null) {
          edges.push({ from: prevId, to: mId, itemType: "ore", quantity: 0,
            kind: isCheapPath ? "byproduct" : "main" });
        }
        prevId = mId;
      }

      if (prevId !== null && parentId !== null) {
        edges.push({ from: prevId, to: parentId, itemType: "ore", quantity: 0,
          kind: isCheapPath ? "byproduct" : "main" });
      }
      return prevId;
    }

    function walkByproductChain(producerId, bp, isCheap) {
      const prefix = isCheap ? "cheap_" : "";

      // Create byproduct source node
      const sourceKey = nodeKey(prefix + "secondary_output", bp.type);
      let sourceId;
      if (visited.has(sourceKey)) {
        sourceId = visited.get(sourceKey);
      } else {
        sourceId = nextId++;
        visited.set(sourceKey, sourceId);
        nodes.push({
          id: sourceId, machine: "secondary_output", type: bp.type,
          name: ITEM_TYPES[bp.type] || bp.type,
          value: Math.round(bp.result?.value || 0),
          quantity: 0, category: "stonework",
        });
      }
      // Store ratio on the edge for Pass 2
      const producerMachine = registry.get(nodes.find(n => n.id === producerId)?.machine);
      edges.push({
        from: producerId, to: sourceId,
        itemType: bp.type, quantity: 0, kind: "byproduct",
        _bpRatio: producerMachine?.byproductRatio || 0.5,
      });

      // Walk downstream chain
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
      for (const step of sideSteps) {
        if (!step.machine) continue;
        const sideM = registry.get(step.machine);
        let sideType = sideM?.outputs?.[0]?.type || step.type || "?";
        if (sideType === "same") sideType = step.type || "?";

        const sideKey = nodeKey(step.machine, sideType);
        let sideId;

        if (visited.has(sideKey)) {
          sideId = visited.get(sideKey);
        } else {
          sideId = nextId++;
          visited.set(sideKey, sideId);

          const isChance = sideM?.effect === "chance" || step.isChanceMachine;
          const gemType = sideM?.gemType || step.gemType;
          const chance = sideM?.value || step.chance;
          let displayType = null, nodeValue = step.value || 0, secondaryValue = null, chanceProduced = null;

          if (isChance) {
            const ch = chance || 0.05;
            if (gemType) {
              displayType = `${gemType} Gem (${Math.round(ch * 100)}%)`;
              const gemData = typeof GEMS !== 'undefined' ? GEMS.find(g => g.name === gemType) : null;
              nodeValue = gemData?.value || step.byproductValue || 0;
              secondaryValue = step.value || 0;
              // Build tooltip path
              const path = [gemType + ' Gem'];
              const skipEff = new Set(['chance','transport','split','overflow','filter','gate','duplicate','preserve','set','combine']);
              for (const [gpId, gpM] of registry.machines) {
                if (!registry.isAvailable(gpId, config)) continue;
                if (!gpM.inputs || gpM.inputs.length !== 1) continue;
                if (skipEff.has(gpM.effect)) continue;
                if (gpM.inputs.some(inp => inp === 'gem' || inp.split('|').includes('gem')))
                  path.push(gpM.name || gpId);
              }
              const polisher = registry.get("polisher");
              if (polisher?.tag && registry.isAvailable("polisher", config)) path.push('Polisher');
              for (const [gpId, gpM] of registry.machines) {
                if (!registry.isAvailable(gpId, config) || gpM.effect !== 'combine') continue;
                if ((gpM.inputs || []).every(inp => inp === 'gem' || inp.split('|').includes('gem')))
                  path.push(gpM.name || gpId);
              }
              if (registry.isAvailable("quality_assurance", config)) path.push('QA');
              path.push('Sell');
              // qty placeholder — will be set in Pass 2 from actual node quantity
              chanceProduced = { qty: 0, label: `${gemType} Gem`, value: step.byproductValue || 0, path, _chance: ch };
            } else {
              const bpType = sideM?.byproducts?.[0]?.type || "ore";
              const bpLabel = ITEM_TYPES[bpType] || bpType;
              chanceProduced = { qty: 0, label: bpLabel, value: 0, path: [bpLabel, 'Ore Processing Chain', 'Sell'], _chance: ch };
              displayType = `${ITEM_TYPES[sideType] || sideType} (${Math.round((chance || 0.05) * 100)}% ${bpLabel})`;
            }
          }

          nodes.push({
            id: sideId, machine: step.machine,
            type: isChance && gemType ? "gem" : sideType,
            name: sideM?.name || step.machine,
            value: Math.round(nodeValue),
            quantity: 0, category: sideM?.category || "stonework",
            displayType, secondaryValue, chanceProduced,
          });
        }

        if (prevSideId !== sideId) {
          edges.push({
            from: prevSideId, to: sideId,
            itemType: step.type || sideType, quantity: 0, kind: "byproduct",
            _isChancePassthrough: !!step.isChanceMachine,
            _chance: step.chance || 0,
          });
          // Set finalOutput for modifier wrapping
          const prevNode = nodes.find(n => n.id === prevSideId);
          if (prevNode && sideType === (prevNode.type || '')) {
            finalOutput.set(nodeKey(prevNode.machine, prevNode.type), sideId);
          }
        }
        prevSideId = sideId;
      }
    }

    // === Build structure ===
    const qa = registry.get("quality_assurance");
    const hasQA = qa && registry.isAvailable("quality_assurance", config);

    const sellerId = nextId++;
    const sellerValue = chainResult.value * (hasQA ? (1 + qa.value) : 1) * (config.hasDoubleSeller ? 2 : 1);
    nodes.push({
      id: sellerId, machine: "seller", type: "sell",
      name: config.hasDoubleSeller ? "Double Seller (x2)" : "Seller",
      value: Math.round(sellerValue), quantity: productQty, category: "source", // Seller = demand root
    });

    // Terminal type: use registry output type of the terminal machine, not resolvedType
    // (resolvedType can be an input type like "casing" instead of "power_core")
    const terminalMachine = registry.get(chainResult.machine);
    const terminalType = terminalMachine?.outputs?.[0]?.type || chainResult.type || "?";

    let topParentId = sellerId;
    let qaNodeId = null;
    if (hasQA) {
      qaNodeId = nextId++;
      nodes.push({
        id: qaNodeId, machine: "quality_assurance", type: terminalType,
        name: "Quality Assurance",
        value: Math.round(chainResult.value * (1 + qa.value)),
        quantity: 0, category: qa.category || "multipurpose",
      });
      edges.push({ from: qaNodeId, to: sellerId, itemType: terminalType, quantity: 0, kind: "main" });
      topParentId = qaNodeId;
    }

    walkNode(chainResult, topParentId, false, false);

    // ═══════════════════════════════════════════════════════
    // PASS 2: Propagate quantities
    // ═══════════════════════════════════════════════════════

    const nodeById = new Map(nodes.map(n => [n.id, n]));

    // Build adjacency: who feeds whom
    // suppliersOf[nodeId] = [nodeIds that feed INTO this node] (edge.from values where edge.to = nodeId)
    const suppliersOf = new Map();
    for (const edge of edges) {
      if (!suppliersOf.has(edge.to)) suppliersOf.set(edge.to, []);
      suppliersOf.get(edge.to).push(edge.from);
    }
    // consumersOf[nodeId] = [nodeIds this feeds TO] (edge.to values where edge.from = nodeId)
    const consumersOf = new Map();
    for (const edge of edges) {
      if (!consumersOf.has(edge.from)) consumersOf.set(edge.from, []);
      consumersOf.get(edge.from).push(edge.to);
    }

    // --- Phase A: Top-down demand propagation ---
    // Reverse topo sort: seller first, ore_source last.
    // Use out-degree on main/enhancement edges (not byproduct).
    const outDegree = new Map();
    for (const n of nodes) outDegree.set(n.id, 0);
    for (const edge of edges) {
      if (edge.kind !== "byproduct") {
        outDegree.set(edge.from, (outDegree.get(edge.from) || 0) + 1);
      }
    }

    const topo = [];
    const topoQ = [];
    for (const [id, deg] of outDegree) {
      if (deg === 0) topoQ.push(id);
    }
    while (topoQ.length > 0) {
      const id = topoQ.shift();
      topo.push(id);
      // Decrement out-degree of this node's suppliers (via main/enhancement edges)
      for (const edge of edges) {
        if (edge.to === id && edge.kind !== "byproduct") {
          outDegree.set(edge.from, outDegree.get(edge.from) - 1);
          if (outDegree.get(edge.from) === 0) topoQ.push(edge.from);
        }
      }
    }

    // Propagate demand: each node pushes demand to its suppliers
    for (const id of topo) {
      const nd = nodeById.get(id);
      if (!nd) continue;

      const machine = registry.get(nd.machine);

      // Find all main/enhancement edges where this node is the consumer (edge.to = id)
      const supplierEdges = edges.filter(e => e.to === id && e.kind !== "byproduct");

      // Same-type combine (prismatic: 2 gems → 1 output):
      // Needs inputCount × demand from its supplier.
      // BUT NOT for enhancement edges — enhancement is a value loop on the same items.
      const isSameTypeCombine = machine?.effect === "combine" &&
        machine.inputs?.length >= 2 &&
        new Set(machine.inputs.flatMap(i => i.split("|"))).size === 1;

      for (const edge of supplierEdges) {
        const supplier = nodeById.get(edge.from);
        if (!supplier) continue;

        let demand = nd.quantity;

        // Same-type combine (prismatic 2:1, alloy 2:1): always multiply demand.
        // This is real physical consumption — 2 gems become 1 output, even in enhancement paths.
        if (isSameTypeCombine) {
          demand = nd.quantity * (machine.inputs?.length || 2);
        }

        // Duplicator: upstream only needs half (it doubles output)
        if (nd.machine === "duplicator") {
          demand = Math.ceil(nd.quantity / 2);
        }

        supplier.quantity += demand;
        edge.quantity = demand;
      }
    }

    // --- Phase A2: Forward supply propagation from ore_source ---
    // The demand propagation may produce quantities exceeding ore supply.
    // Fix: set ore_source to actualOreCount, then forward-propagate through
    // main/enhancement chain, halving at same-type combine machines.
    // This gives supply-constrained quantities that match what actually flows.
    const oreSourceNode = nodes.find(n => {
      if (n.machine !== "ore_source") return false;
      const key = [...visited.entries()].find(([k, v]) => v === n.id)?.[0];
      return key && !key.startsWith("cheap_");
    });
    if (oreSourceNode) {
      oreSourceNode.quantity = actualOreCount;
      // Forward BFS from ore_source through main/enhancement edges
      const supplyVisited = new Set([oreSourceNode.id]);
      const supplyQueue = [oreSourceNode.id];
      while (supplyQueue.length > 0) {
        const curId = supplyQueue.shift();
        const curNode = nodeById.get(curId);
        if (!curNode) continue;
        // Find edges FROM this node (it feeds downstream consumers)
        for (const edge of edges) {
          if (edge.from !== curId || edge.kind === "byproduct") continue;
          if (supplyVisited.has(edge.to)) continue;
          supplyVisited.add(edge.to);
          const downstream = nodeById.get(edge.to);
          if (!downstream) continue;
          // Don't override seller/QA — those are demand-driven (productQty)
          if (downstream.machine === "seller" || downstream.machine === "quality_assurance") continue;
          // Downstream gets same qty as supplier...
          let qty = curNode.quantity;
          // ...unless downstream is a same-type combine (halves)
          const dsMachine = registry.get(downstream.machine);
          const dsIsCombine = dsMachine?.effect === "combine" &&
            dsMachine.inputs?.length >= 2 &&
            new Set(dsMachine.inputs.flatMap(i => i.split("|"))).size === 1;
          if (dsIsCombine) {
            qty = Math.floor(qty / (dsMachine.inputs?.length || 2));
          }
          downstream.quantity = qty;
          edge.quantity = curNode.quantity; // Edge shows items flowing IN
          supplyQueue.push(edge.to);
        }
      }
    }

    // --- Phase B: Forward byproduct propagation ---
    // Now all producers have final quantities. Push byproduct quantities forward.
    for (const edge of edges) {
      if (edge.kind !== "byproduct") continue;
      const source = nodeById.get(edge.from);
      const target = nodeById.get(edge.to);
      if (!source || !target) continue;

      if (target.machine === "secondary_output") {
        // Byproduct source: qty = producer.quantity × ratio
        const ratio = edge._bpRatio || 0.5;
        const bpQty = Math.max(1, Math.round(source.quantity * ratio));
        target.quantity = bpQty;
        edge.quantity = bpQty;
      }
    }

    // BFS downstream from each secondary_output through byproduct edges
    for (const n of nodes) {
      if (n.machine !== "secondary_output") continue;
      let currentQty = n.quantity;
      const bpVisited = new Set([n.id]);
      const bpQueue = [n.id];
      while (bpQueue.length > 0) {
        const curId = bpQueue.shift();
        for (const edge of edges) {
          if (edge.from !== curId || edge.kind !== "byproduct") continue;
          if (bpVisited.has(edge.to)) continue;
          bpVisited.add(edge.to);

          const dsNode = nodeById.get(edge.to);
          if (!dsNode) continue;

          dsNode.quantity = currentQty;
          edge.quantity = currentQty;

          // Chance machines: items enter at currentQty, passthrough is reduced
          if (edge._isChancePassthrough) {
            const ch = edge._chance || 0.05;
            currentQty = Math.round(currentQty * (1 - ch));
          }

          // Update chance annotation with actual quantity
          if (dsNode.chanceProduced) {
            dsNode.chanceProduced.qty = dsNode.quantity * (dsNode.chanceProduced._chance || 0.05);
          }

          bpQueue.push(edge.to);
        }
      }
    }

    // Update edge quantities for split outputs (edges from nodes with multiple consumers)
    for (const edge of edges) {
      if (edge.quantity === 0 && edge.kind !== "byproduct") {
        const source = nodeById.get(edge.from);
        if (source) edge.quantity = source.quantity;
      }
    }

    // --- Phase C: Excess routing ---
    // Byproduct chain nodes that produce more than their main chain consumers
    // need get routed to QA → Seller to show where surplus goes.
    const excessTarget = qaNodeId || sellerId;

    const finalConsumersOf = new Map();
    for (const edge of edges) {
      if (!finalConsumersOf.has(edge.from)) finalConsumersOf.set(edge.from, []);
      finalConsumersOf.get(edge.from).push(edge);
    }

    for (const n of nodes) {
      if (n.quantity <= 0) continue;
      const outEdges = finalConsumersOf.get(n.id) || [];
      const mainOutEdges = outEdges.filter(e => e.kind !== "byproduct");
      if (mainOutEdges.length === 0) continue;

      let totalConsumed = 0;
      for (const e of mainOutEdges) {
        totalConsumed += e.quantity || 0;
      }

      const excess = n.quantity - totalConsumed;
      if (excess > 0 && totalConsumed > 0) {
        // Route excess to QA (or seller if no QA)
        edges.push({
          from: n.id, to: excessTarget,
          itemType: ITEM_TYPES[n.type] || n.type,
          quantity: excess, kind: "byproduct",
        });
      }
    }

    return { nodes, edges };
  }
}
