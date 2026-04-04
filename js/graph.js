// UMT Factory Optimizer - Machine Registry & Graph Engine
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
      if (m.outputs) {
        for (const out of m.outputs) {
          const outType = out.type;
          const inputTypes = (m.inputs || []).flatMap(i => i.split("|"));
          const isAnyInput = inputTypes.includes("any");
          const isSameType = outType === "same" || inputTypes.includes(outType);

          if (isSameType || (isAnyInput && outType === "same")) {
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
            if (m.effect !== "preserve") {
              this.addTo(this.producerOf, outType, id);
            }
          }
        }
      }
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
    if (m.event && !m.eventActive) return false;
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

// Legacy compatibility stub - delegates to FlowGraphBuilder
class GraphGenerator {
  static fromFlowChain(chainResult, registry, config, dupInfo = {}, bpValue = {}, flowMemo = null, actualOreCount = 0) {
    return FlowGraphBuilder.buildGraph(chainResult, registry, config, dupInfo, bpValue, flowMemo, actualOreCount);
  }
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
