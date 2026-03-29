// UMT Factory Optimizer - Uses data-driven MachineRegistry from graph.js
// All calculations derived from machines.json via MachineRegistry → FlowOptimizer

class FactoryOptimizer {
  constructor() {
    this.config = {};
  }

  configure(config) {
    this.config = {
      budget: config.budget || 1000000,
      hasDoubleSeller: config.hasDoubleSeller || false,
      prestigeItems: config.prestigeItems || {},
    };
    if (machineRegistry) {
      this.flowOptimizer = new FlowOptimizer(machineRegistry, this.config);
    }
  }

  getBestChain(ore, budget) {
    if (!this.flowOptimizer) {
      return [{ chain: "Loading...", value: 0, cost: 0, perOre: 0, oresNeeded: 1 }];
    }
    return this.flowOptimizer.discoverAll(ore.value);
  }
}
