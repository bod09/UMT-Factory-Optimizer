// UMT Factory Optimizer - Game Data
// Source: umt.miraheze.org (v0.5.4)

const ORES = [
  { name: "Tin", value: 10, depth: "0-149m", depthMin: 0, depthMax: 149, hardness: 6 },
  { name: "Iron", value: 20, depth: "0-149m", depthMin: 0, depthMax: 149, hardness: 6 },
  { name: "Lead", value: 30, depth: "0-350m", depthMin: 0, depthMax: 350, hardness: 7 },
  { name: "Cobalt", value: 50, depth: "65-549m", depthMin: 65, depthMax: 549, hardness: 12 },
  { name: "Aluminium", value: 65, depth: "150-849m", depthMin: 150, depthMax: 849, hardness: 18 },
  { name: "Silver", value: 150, depth: "150-849m", depthMin: 150, depthMax: 849, hardness: 18 },
  { name: "Uranium", value: 180, depth: "400-849m", depthMin: 400, depthMax: 849, hardness: 18 },
  { name: "Vanadium", value: 240, depth: "400-1000m", depthMin: 400, depthMax: 1000, hardness: 22 },
  { name: "Tungsten", value: 300, depth: "850-1599m", depthMin: 850, depthMax: 1599, hardness: 45 },
  { name: "Gold", value: 350, depth: "550-1199m", depthMin: 550, depthMax: 1199, hardness: 22 },
  { name: "Titanium", value: 400, depth: "550-1599m", depthMin: 550, depthMax: 1599, hardness: 24 },
  { name: "Molybdenum", value: 600, depth: "1000-1599m", depthMin: 1000, depthMax: 1599, hardness: 75 },
  { name: "Plutonium", value: 1000, depth: "1000-1599m", depthMin: 1000, depthMax: 1599, hardness: 99 },
  { name: "Palladium", value: 1200, depth: "1200-1800m", depthMin: 1200, depthMax: 1800, hardness: 120 },
  { name: "Mithril", value: 2000, depth: "1800-2800m", depthMin: 1800, depthMax: 2800, hardness: 200 },
  { name: "Thorium", value: 3200, depth: "2100-2800m", depthMin: 2100, depthMax: 2800, hardness: 270 },
  { name: "Iridium", value: 3700, depth: "1800-2800m", depthMin: 1800, depthMax: 2800, hardness: 180 },
  { name: "Adamantium", value: 4500, depth: "2300-2800m", depthMin: 2300, depthMax: 2800, hardness: 300 },
  { name: "Rhodium", value: 15000, depth: "2300-2800m", depthMin: 2300, depthMax: 2800, hardness: 300 },
  { name: "Unobtainium", value: 30000, depth: "2500-2800m", depthMin: 2500, depthMax: 2800, hardness: 340 },
];

const GEMS_WITH_DEPTH = [
  { name: "Topaz", value: 75, depthMin: 0, depthMax: 549, hardness: 6, rarity: "Common" },
  { name: "Emerald", value: 200, depthMin: 150, depthMax: 849, hardness: 14, rarity: "Uncommon" },
  { name: "Sapphire", value: 250, depthMin: 150, depthMax: 849, hardness: 14, rarity: "Uncommon" },
  { name: "Ruby", value: 300, depthMin: 150, depthMax: 849, hardness: 18, rarity: "Uncommon" },
  { name: "Diamond", value: 1500, depthMin: 400, depthMax: 1800, hardness: 22, rarity: "Rare" },
  { name: "Poudretteite", value: 1700, depthMin: 550, depthMax: 1199, hardness: 75, rarity: "Very Rare" },
  { name: "Zultanite", value: 2300, depthMin: 1000, depthMax: 1599, hardness: 110, rarity: "Very Rare" },
  { name: "Grandidierite", value: 4500, depthMin: 1400, depthMax: 2100, hardness: 120, rarity: "Very Rare" },
  { name: "Musgravite", value: 5800, depthMin: 1900, depthMax: 2500, hardness: 150, rarity: "Extremely Rare" },
  { name: "Painite", value: 12000, depthMin: 2100, depthMax: 2500, hardness: 200, rarity: "Extremely Rare" },
];

const MINE_LAYERS = [
  { name: "Surface", depthMin: 0, depthMax: 64 },
  { name: "The Mines", depthMin: 65, depthMax: 149 },
  { name: "The Depths", depthMin: 150, depthMax: 549 },
  { name: "Bedrock", depthMin: 550, depthMax: 849 },
  { name: "The Primordial", depthMin: 850, depthMax: 1199 },
  { name: "Tectonic Zone", depthMin: 1200, depthMax: 1599 },
  { name: "The Mantle", depthMin: 1600, depthMax: 2199 },
  { name: "The Underworld", depthMin: 2200, depthMax: 2800 },
];

// Get the layer name for a given depth
function getLayerName(depth) {
  const layer = MINE_LAYERS.find(l => depth >= l.depthMin && depth <= l.depthMax);
  return layer ? layer.name : "Beyond";
}

// Get all ores available at a given depth range
function getOresAtDepth(minDepth, maxDepth) {
  return ORES.filter(ore => ore.depthMin <= maxDepth && ore.depthMax >= minDepth);
}

// Get all gems available at a given depth range
function getGemsAtDepth(minDepth, maxDepth) {
  return GEMS_WITH_DEPTH.filter(gem => gem.depthMin <= maxDepth && gem.depthMax >= minDepth);
}

// Get required pickaxe hardness for a depth
function getRequiredPickaxe(depth) {
  const layer = MINE_LAYERS.find(l => depth >= l.depthMin && depth <= l.depthMax);
  if (!layer) return PICKAXES[PICKAXES.length - 1];
  // Match hardness to ores at that depth
  const ores = getOresAtDepth(depth, depth);
  const maxHardness = Math.max(...ores.map(o => o.hardness), 0);
  return PICKAXES.find(p => p.hardness >= maxHardness) || PICKAXES[PICKAXES.length - 1];
}

const GEMS = [
  { name: "Topaz", value: 75, depth: "0-549m", hardness: 6, rarity: "Common" },
  { name: "Emerald", value: 200, depth: "150-849m", hardness: 14, rarity: "Uncommon" },
  { name: "Sapphire", value: 250, depth: "150-849m", hardness: 14, rarity: "Uncommon" },
  { name: "Ruby", value: 300, depth: "150-849m", hardness: 18, rarity: "Uncommon" },
  { name: "Diamond", value: 1500, depth: "400-1800m", hardness: 22, rarity: "Rare" },
  { name: "Poudretteite", value: 1700, depth: "550-1199m", hardness: 75, rarity: "Very Rare" },
  { name: "Zultanite", value: 2300, depth: "1000-1599m", hardness: 110, rarity: "Very Rare" },
  { name: "Grandidierite", value: 4500, depth: "1400-2100m", hardness: 120, rarity: "Very Rare" },
  { name: "Musgravite", value: 5800, depth: "1900-2500m", hardness: 150, rarity: "Extremely Rare" },
  { name: "Painite", value: 12000, depth: "2100-2500m", hardness: 200, rarity: "Extremely Rare" },
];

// Ore Upgrader: upgrades ore to next tier (max Mithril)
// Order matches ORES array by value
const ORE_UPGRADE_MAP = {
  "Tin": "Iron",        // $10 -> $20
  "Iron": "Lead",       // $20 -> $30
  "Lead": "Cobalt",     // $30 -> $50
  "Cobalt": "Aluminium", // $50 -> $65
  "Aluminium": "Silver", // $65 -> $150
  "Silver": "Uranium",  // $150 -> $180
  "Uranium": "Vanadium", // $180 -> $240
  "Vanadium": "Tungsten", // $240 -> $300
  "Tungsten": "Gold",   // $300 -> $350
  "Gold": "Titanium",   // $350 -> $400
  "Titanium": "Molybdenum", // $400 -> $600
  "Molybdenum": "Plutonium", // $600 -> $1000
  "Plutonium": "Palladium", // $1000 -> $1200
  "Palladium": "Mithril", // $1200 -> $2000
  // Mithril and above cannot be upgraded
};

function getUpgradedOreValue(oreName) {
  const upgradedName = ORE_UPGRADE_MAP[oreName];
  if (!upgradedName) return null;
  const upgraded = ORES.find(o => o.name === upgradedName);
  return upgraded ? upgraded.value : null;
}

// Nano Sifter ore pool and average value
const NANO_SIFTER_ORES = ["Tin", "Iron", "Lead", "Cobalt", "Silver", "Uranium", "Tungsten", "Gold", "Plutonium", "Palladium", "Iridium"];
const NANO_SIFTER_AVG_VALUE = NANO_SIFTER_ORES.reduce((sum, name) => {
  const ore = ORES.find(o => o.name === name);
  return sum + (ore ? ore.value : 0);
}, 0) / NANO_SIFTER_ORES.length;

const PICKAXES = [
  { name: "Rusty Pickaxe", cost: 0, hardness: 7 },
  { name: "Copper Pickaxe", cost: 50, hardness: 12 },
  { name: "Iron Pickaxe", cost: 500, hardness: 20 },
  { name: "Steel Pickaxe", cost: 5000, hardness: 35 },
  { name: "Platinum Pickaxe", cost: 25000, hardness: 60 },
  { name: "Titanium Pickaxe", cost: 100000, hardness: 100 },
  { name: "Infernum Pickaxe", cost: 1000000, hardness: 200 },
  { name: "Diamond Pickaxe", cost: 2500000, hardness: 400 },
  { name: "Mithril Pickaxe", cost: 5000000, hardness: 600 },
  { name: "Adamantium Pickaxe", cost: 10000000, hardness: 800 },
  { name: "Unobtainium Pickaxe", cost: 25000000, hardness: 1000 },
];

const BACKPACKS = [
  { name: "Micro Backpack", cost: 0, capacity: 8 },
  { name: "Small Backpack", cost: 100, capacity: 12 },
  { name: "Medium Backpack", cost: 5000, capacity: 16 },
  { name: "Large Backpack", cost: 100000, capacity: 24 },
  { name: "XL Backpack", cost: 1500000, capacity: 36 },
  { name: "XXL Backpack", cost: null, capacity: 64, robux: 399 },
];

const VEHICLES = [
  { name: "Quadbike", cost: 0, capacity: 8, type: "cargo" },
  { name: "Cargo Quadbike", cost: 1000, capacity: 16, type: "cargo" },
  { name: "Minidumper", cost: 5000, capacity: 32, type: "cargo" },
  { name: "Mini-Truck", cost: 20000, capacity: 56, type: "cargo" },
  { name: "Super Crawler", cost: 200000, capacity: 180, type: "cargo" },
  { name: "Mini-Muncher", cost: 180000, capacity: 36, type: "drill" },
  { name: "Power Drill", cost: 800000, capacity: 48, type: "drill" },
  { name: "Exa-Drill", cost: 8000000, capacity: 120, type: "drill" },
  { name: "Minekart", cost: null, capacity: 12, type: "drill", medals: 4 },
];

const UNLOADER_LEVELS = [
  { level: 1, cost: 0, capacity: 12 },
  { level: 2, cost: 1000, capacity: 36 },
  { level: 3, cost: 20000, capacity: 108 },
  { level: 4, cost: 400000, capacity: 162 },
  { level: 5, cost: 8000000, capacity: 216 },
];

const OUTPUT_BELTS = [
  { belt: 1, cost: 0 },
  { belt: 2, cost: 100000 },
  { belt: 3, cost: 1000000 },
  { belt: 4, cost: 5000000 },
];

// Machine definitions with processing chain info
const MACHINES = {
  // One-time modifiers
  ore_cleaner: { name: "Ore Cleaner", cost: 80, category: "metalwork", input: ["ore"], output: "ore", effect: "flat", value: 10, tag: "Cleaned", desc: "Adds $10 to ores (once)" },
  polisher: { name: "Polisher", cost: 250, category: "multipurpose", input: ["any"], output: "same", effect: "flat", value: 10, tag: "Polished", desc: "Adds $10 to any item (once)" },
  philosophers_stone: { name: "Philosopher's Stone", cost: null, medals: 3, category: "prestige", input: ["ore"], output: "ore", effect: "percent", value: 0.25, tag: "Infused", desc: "+25% ore value (once)" },
  quality_assurance: { name: "Quality Assurance", cost: 2000000, category: "multipurpose", input: ["any"], output: "same", effect: "percent", value: 0.20, tag: "QA Tested", desc: "+20% value to any item (once)" },
  electronic_tuner: { name: "Electronic Tuner", cost: 8500, category: "electronics", input: ["electronic"], output: "same", effect: "flat", value: 50, tag: "Tuned", desc: "Adds $50 to electronics (once)" },

  // Smelting
  ore_smelter: { name: "Ore Smelter", cost: 380, category: "metalwork", input: ["ore"], output: "bar", effect: "multiply", value: 1.20, byproduct: "stone", desc: "Ore to Bar (1.2x), produces stone" },
  blast_furnace: { name: "Blast Furnace", cost: 25000, category: "metalwork", input: ["ore"], output: "bar", effect: "multiply", value: 0.90, byproduct: "stone", desc: "Ore to Bar (0.9x), more stone" },
  tempering_forge: { name: "Tempering Forge", cost: 50000, category: "metalwork", input: ["bar"], output: "bar", effect: "multiply", value: 2.00, tag: "Tempered", desc: "Doubles bar value (2x, once)" },

  // Bar processing
  coiler: { name: "Coiler", cost: 1750, category: "metalwork", input: ["bar"], output: "coil", effect: "flat", value: 20, desc: "Bar to Coil (+$20)" },
  bolt_machine: { name: "Bolt Machine", cost: 2800, category: "metalwork", input: ["bar"], output: "bolts", effect: "flat", value: 5, desc: "Bar to Bolts (+$5)" },
  plate_stamper: { name: "Plate Stamper", cost: 3000, category: "metalwork", input: ["bar"], output: "plate", effect: "flat", value: 20, desc: "Bar to Plate (+$20)" },

  // Plate processing
  pipe_maker: { name: "Pipe Maker", cost: 4000, category: "metalwork", input: ["plate"], output: "pipe", effect: "flat", value: 20, desc: "Plate to Pipe (+$20)" },
  mech_parts_maker: { name: "Mechanical Parts Maker", cost: 8000, category: "metalwork", input: ["plate"], output: "mech_parts", effect: "flat", value: 30, desc: "Plate to Mech Parts (+$30)" },
  filigree_cutter: { name: "Filigree Cutter", cost: 50000, category: "metalwork", input: ["plate"], output: "filigree", effect: "percent", value: 0.20, desc: "Plate to Filigree (+20%)" },

  // Combining machines
  frame_maker: { name: "Frame Maker", cost: 10000, category: "metalwork", inputs: ["bar", "bolts"], output: "frame", effect: "multiply_combined", value: 1.25, size: "2x3", desc: "Bar + Bolts = Frame (1.25x)" },
  casing_machine: { name: "Casing Machine", cost: 50000, category: "metalwork", inputs: ["frame", "bolts", "plate"], output: "casing", effect: "multiply_combined", value: 1.30, size: "3x3", desc: "Frame + Bolts + Plate = Casing (1.3x)" },
  alloy_furnace: { name: "Alloy Furnace", cost: 100000, category: "metalwork", inputs: ["bar", "bar"], output: "alloy_bar", effect: "multiply_combined", value: 1.20, size: "2x3", desc: "2 Bars = Alloy Bar (1.2x)" },
  engine_factory: { name: "Engine Factory", cost: 1000000, category: "metalwork", inputs: ["mech_parts", "pipe", "casing"], output: "engine", effect: "multiply_combined", value: 2.50, size: "3x3", desc: "Mech Parts + Pipe + Casing = Engine (2.5x)" },

  // Stonework
  crusher: { name: "Crusher", cost: 1750, category: "stonework", input: ["any"], output: "dust", effect: "set", value: 1, desc: "Crushes anything to Dust ($1)" },
  sifter: { name: "Sifter", cost: 4000, category: "stonework", input: ["dust"], output: "ore", effect: "chance", value: 0.10, size: "3x3", desc: "10% chance ore from dust" },
  nano_sifter: { name: "Nano Sifter", cost: null, medals: 1, category: "prestige", input: ["dust"], output: "ore", effect: "chance", value: 0.166, size: "3x3", desc: "16.6% chance ore from dust (better ores)" },
  brick_mold: { name: "Brick Mold", cost: 2500, category: "stonework", input: ["dust"], output: "bricks", effect: "set", value: 25, desc: "Dust to Bricks ($25)" },
  cement_mixer: { name: "Cement Mixer", cost: 10000, category: "stonework", inputs: ["dust", "stone"], output: "cement", effect: "set", value: 30, desc: "Dust + Stone = Cement ($30)" },
  clay_mixer: { name: "Clay Mixer", cost: 20000, category: "stonework", inputs: ["dust", "dust"], output: "clay", effect: "set", value: 50, desc: "2 Dust = Clay ($50)" },
  ceramic_furnace: { name: "Ceramic Furnace", cost: 30000, category: "stonework", input: ["clay"], output: "ceramic_casing", effect: "set", value: 150, desc: "Clay to Ceramic Casing ($150)" },

  // Glasswork
  kiln: { name: "Kiln", cost: 4750, category: "multipurpose", input: ["dust"], output: "glass", effect: "set", value: 30, desc: "Dust to Glass Sheet ($30)" },
  lens_cutter: { name: "Lens Cutter", cost: 70000, category: "glasswork", input: ["glass"], output: "lens", effect: "flat", value: 50, desc: "Glass to Lens (+$50)" },
  optics_machine: { name: "Optics Machine", cost: 300000, category: "glasswork", inputs: ["lens", "pipe"], output: "optic", effect: "multiply_combined", value: 1.25, size: "3x2", desc: "Lens + Pipe = Optic (1.25x)" },

  // Electronics
  circuit_maker: { name: "Circuit Maker", cost: 20000, category: "electronics", inputs: ["glass", "coil"], output: "circuit", effect: "multiply_combined", value: 2.00, size: "3x3", desc: "Glass + Coil = Circuit (2x)" },
  magnetic_machine: { name: "Magnetic Machine", cost: 120000, category: "electronics", inputs: ["coil", "casing"], output: "electromagnet", effect: "multiply_combined", value: 1.50, size: "3x3", desc: "Coil + Casing = Electromagnet (1.5x)" },
  superconductor: { name: "Superconductor Constructor", cost: 1000000, category: "electronics", inputs: ["alloy_bar", "ceramic_casing"], output: "superconductor", effect: "multiply_combined", value: 3.00, size: "1x3", desc: "Alloy Bar + Ceramic = Superconductor (3x)" },
  tablet_factory: { name: "Tablet Factory", cost: 2500000, category: "electronics", inputs: ["casing", "glass", "circuit"], output: "tablet", effect: "multiply_combined", value: 3.00, size: "3x4", desc: "Casing + Glass + Circuit = Tablet (3x)" },
  laser_maker: { name: "Laser Maker", cost: 3500000, category: "electronics", inputs: ["optic", "gem", "circuit"], output: "laser", effect: "multiply_combined", value: 2.75, size: "3x5", desc: "Optic + Gem + Circuit = Laser (2.75x)" },
  power_core: { name: "Power Core Assembler", cost: 4500000, category: "electronics", inputs: ["casing", "superconductor", "electromagnet"], output: "power_core", effect: "multiply_combined", value: 2.50, size: "5x5", desc: "Casing + Superconductor + Electromagnet = Power Core (2.5x)" },

  // Jewelcrafting
  gem_cutter: { name: "Gem Cutter", cost: 20000, category: "jewelcrafting", input: ["gem"], output: "cut_gem", effect: "multiply", value: 1.40, desc: "Gem to Cut Gem (1.4x)" },
  ring_maker: { name: "Ring Maker", cost: 15000, category: "jewelcrafting", inputs: ["gem", "coil"], output: "ring", effect: "multiply_combined", value: 1.70, size: "3x2", desc: "Gem + Coil = Ring (1.7x)" },
  prismatic_crucible: { name: "Prismatic Gem Crucible", cost: 100000, category: "jewelcrafting", inputs: ["gem", "gem"], output: "prismatic_gem", effect: "multiply_combined", value: 1.15, desc: "2 Gems = Prismatic Gem (1.15x)" },
  gilder: { name: "Gilder", cost: 500000, category: "jewelcrafting", inputs: ["filigree", "jewelry"], output: "gilded", effect: "multiply_combined", value: 1.50, size: "3x2", desc: "Filigree + Jewelry = Gilded (1.5x)" },
  amulet_maker: { name: "Amulet Maker", cost: 2000000, category: "jewelcrafting", inputs: ["ring", "frame", "prismatic_gem"], output: "amulet", effect: "multiply_combined", value: 2.00, size: "5x3", desc: "Ring + Frame + Prismatic Gem = Amulet (2x)" },

  // Prospectors
  topaz_prospector: { name: "Topaz Prospector", cost: 2000, category: "jewelcrafting", input: ["stone"], output: "gem", gemType: "Topaz", effect: "chance", value: 0.05, desc: "Stone to Topaz (5%)" },
  emerald_prospector: { name: "Emerald Prospector", cost: 5000, category: "jewelcrafting", input: ["stone"], output: "gem", gemType: "Emerald", effect: "chance", value: 0.05, desc: "Stone to Emerald (5%)" },
  sapphire_prospector: { name: "Sapphire Prospector", cost: 8000, category: "jewelcrafting", input: ["stone"], output: "gem", gemType: "Sapphire", effect: "chance", value: 0.05, desc: "Stone to Sapphire (5%)" },
  ruby_prospector: { name: "Ruby Prospector", cost: 15000, category: "jewelcrafting", input: ["stone"], output: "gem", gemType: "Ruby", effect: "chance", value: 0.05, desc: "Stone to Ruby (5%)" },
  diamond_prospector: { name: "Diamond Prospector", cost: 30000, category: "jewelcrafting", input: ["stone"], output: "gem", gemType: "Diamond", effect: "chance", value: 0.05, desc: "Stone to Diamond (5%)" },

  // Explosives
  blasting_powder_chamber: { name: "Blasting Powder Chamber", cost: 19000, category: "explosives", inputs: ["metal_dust", "stone_dust"], output: "blasting_powder", effect: "set", value: 2, desc: "Metal Dust + Stone Dust = Powder ($2)" },
  explosives_maker: { name: "Explosives Maker", cost: 19000, category: "explosives", inputs: ["blasting_powder", "casing"], output: "explosives", effect: "multiplicative", desc: "Casing × Powder value", size: "3x5" },
  blasting_powder_refiner: { name: "Blasting Powder Refiner", cost: 2500000, category: "explosives", inputs: ["blasting_powder", "metal_dust"], output: "blasting_powder", effect: "flat", value: 1, size: "3x3", desc: "Powder + Metal Dust = Powder (+$1)" },

  // Prestige
  ore_upgrader: { name: "Ore Upgrader", cost: null, medals: 3, category: "prestige", input: ["ore"], output: "ore", effect: "upgrade_tier", desc: "Upgrades ore one tier (max Mithril)" },
  gem_to_bar: { name: "Gem to Bar Transmuter", cost: null, medals: 4, category: "prestige", input: ["gem"], output: "bar", effect: "preserve", desc: "Gem to Bar (same value)" },
  bar_to_gem: { name: "Bar to Gem Transmuter", cost: null, medals: 4, category: "prestige", input: ["bar"], output: "gem", effect: "preserve", desc: "Bar to Gem (same value)" },
  duplicator: { name: "Duplicator", cost: null, medals: 8, category: "prestige", input: ["any"], output: "duplicate", effect: "duplicate", value: 0.50, size: "3x5", desc: "Duplicates item (both 50% value)" },
};

const PRESTIGE_UPGRADES = [
  { name: "Walk Speed", bonusPerLevel: "+10%", medalCostFormula: "2^(level-1)" },
  { name: "Jump Height", bonusPerLevel: "+15%", medalCostFormula: "2^(level-1)" },
  { name: "Pickaxe Strength", bonusPerLevel: "+10%", medalCostFormula: "2^(level-1)" },
  { name: "Pickaxe Speed", bonusPerLevel: "+10%", medalCostFormula: "2^(level-1)" },
  { name: "Vehicle Power", bonusPerLevel: "+15%", medalCostFormula: "2^(level-1)" },
  { name: "Starting Money", bonusPerLevel: "+$250", medalCostFormula: "2^(level-1)" },
];

// Prestige cost formula: 20M * 2^(level-1)
function getPrestigeCost(level) {
  return 20000000 * Math.pow(2, level - 1);
}

// Total medals from N prestiges
function getTotalMedals(prestiges) {
  return prestiges;
}

// Processing chain definitions for the optimizer
const PROCESSING_CHAINS = {
  // Basic sell (no processing)
  direct_sell: {
    name: "Direct Sell",
    steps: [],
    totalCost: 0,
    applicableTo: ["ore", "gem"],
  },

  // Basic ore processing
  basic_ore: {
    name: "Clean + Polish + Smelt",
    steps: ["ore_cleaner", "polisher", "ore_smelter"],
    totalCost: 710,
    applicableTo: ["ore"],
    calcValue: (oreVal) => (oreVal + 10 + 10) * 1.20,
  },

  // With tempering
  tempered_ore: {
    name: "Clean + Polish + Smelt + Temper",
    steps: ["ore_cleaner", "polisher", "ore_smelter", "tempering_forge"],
    totalCost: 50710,
    applicableTo: ["ore"],
    calcValue: (oreVal) => (oreVal + 10 + 10) * 1.20 * 2.00,
  },

  // With philosopher's stone
  infused_tempered: {
    name: "Clean + Polish + Infuse + Smelt + Temper",
    steps: ["ore_cleaner", "polisher", "philosophers_stone", "ore_smelter", "tempering_forge"],
    totalCost: 50710,
    medals: 3,
    applicableTo: ["ore"],
    calcValue: (oreVal) => (oreVal + 10 + 10) * 1.25 * 1.20 * 2.00,
  },

  // Engine chain
  engine_chain: {
    name: "Full Engine Chain",
    steps: ["ore_cleaner", "polisher", "ore_smelter", "tempering_forge", "plate_stamper", "pipe_maker", "mech_parts_maker", "bolt_machine", "frame_maker", "casing_machine", "engine_factory"],
    totalCost: 1131830,
    applicableTo: ["ore"],
    desc: "Multiple ores needed: some go to plates/pipes/mech parts, some to bolts, some to frames, all combine into engine",
  },

  // Tablet chain
  tablet_chain: {
    name: "Tablet Chain",
    steps: ["ore_smelter", "tempering_forge", "casing_machine", "circuit_maker", "tablet_factory"],
    totalCost: 2575130,
    applicableTo: ["ore"],
    desc: "Needs ores for casing + stone byproduct for glass + coils for circuits",
  },

  // Power Core chain
  power_core_chain: {
    name: "Power Core Chain",
    steps: ["casing_machine", "superconductor", "magnetic_machine", "power_core"],
    totalCost: 5670000,
    applicableTo: ["ore"],
    desc: "Highest-tier electronics. Needs casing, superconductor, electromagnet",
  },
};

// Upgrade path stages
const PROGRESSION_STAGES = [
  {
    name: "Starter",
    budget: "0 - $5K",
    budgetMax: 5000,
    equipment: ["Rusty Pickaxe", "Micro Backpack", "Quadbike"],
    machines: ["ore_cleaner", "polisher"],
    tips: "Mine Tin/Iron/Lead near surface. Sell directly or add Ore Cleaner + Polisher for +$20 per ore.",
    priority: ["Copper Pickaxe ($50)", "Small Backpack ($100)", "Ore Cleaner ($80)", "Polisher ($250)", "Ore Smelter ($380)"],
  },
  {
    name: "Early Game",
    budget: "$5K - $50K",
    budgetMax: 50000,
    equipment: ["Steel Pickaxe", "Medium Backpack", "Minidumper"],
    machines: ["ore_cleaner", "polisher", "ore_smelter", "coiler", "bolt_machine", "plate_stamper", "pipe_maker", "kiln", "crusher"],
    tips: "Start building processing chains. Smelt ores into bars. Use stone byproduct through Crusher -> Kiln for glass. Reach deeper ores.",
    priority: ["Steel Pickaxe ($5K)", "Minidumper ($5K)", "Coiler ($1.75K)", "Bolt Machine ($2.8K)", "Plate Stamper ($3K)", "Pipe Maker ($4K)", "Sifter ($4K)", "Kiln ($4.75K)"],
  },
  {
    name: "Mid Game",
    budget: "$50K - $500K",
    budgetMax: 500000,
    equipment: ["Platinum Pickaxe", "Large Backpack", "Super Crawler"],
    machines: ["ore_cleaner", "polisher", "ore_smelter", "tempering_forge", "coiler", "bolt_machine", "plate_stamper", "frame_maker", "casing_machine", "filigree_cutter", "alloy_furnace", "circuit_maker", "ring_maker", "gem_cutter"],
    tips: "Tempering Forge (2x bar value) is huge. Build Frame Maker + Casing Machine chain. Start Circuit Maker for electronics. Add gem processing.",
    priority: ["Tempering Forge ($50K)", "Casing Machine ($50K)", "Alloy Furnace ($100K)", "Output Belt 2 ($100K)", "Super Crawler ($200K)", "Optics Machine ($300K)"],
  },
  {
    name: "Late Game",
    budget: "$500K - $5M",
    budgetMax: 5000000,
    equipment: ["Titanium Pickaxe", "XL Backpack", "Power Drill"],
    machines: ["ore_cleaner", "polisher", "ore_smelter", "tempering_forge", "alloy_furnace", "casing_machine", "engine_factory", "superconductor", "circuit_maker", "tablet_factory", "quality_assurance", "amulet_maker"],
    tips: "Engine Factory (2.5x) and Superconductor Constructor (3x) are game-changers. Tablet Factory (3x) is the highest electronics multiplier. QA Machine adds 20% to finished products.",
    priority: ["Engine Factory ($1M)", "Superconductor ($1M)", "Amulet Maker ($2M)", "QA Machine ($2M)", "Tablet Factory ($2.5M)", "Laser Maker ($3.5M)", "Power Core ($4.5M)"],
  },
  {
    name: "Pre-Prestige",
    budget: "$5M - $20M",
    budgetMax: 20000000,
    equipment: ["Diamond Pickaxe+", "Exa-Drill"],
    machines: ["All late game machines", "power_core", "laser_maker", "blasting_powder_refiner"],
    tips: "Maximize output value. Multiple processing lines recommended. Consider the Explosives chain for multiplicative scaling. Target $20M for first prestige.",
    priority: ["Output Belt 3 ($1M)", "Unloader 5 ($8M)", "Exa-Drill ($8M)", "Maximize factory throughput"],
  },
  {
    name: "Post-Prestige",
    budget: "Medals",
    budgetMax: null,
    equipment: ["Keep Robux items"],
    machines: ["nano_sifter", "philosophers_stone", "ore_upgrader", "duplicator"],
    tips: "First medal: Nano Sifter (best value). Then Philosopher's Stone + Ore Upgrader at 3 medals each. Transmuters at 4 medals. Duplicator at 8 medals. Invest in permanent prestige upgrades.",
    priority: ["Nano Sifter (1 Medal)", "Philosopher's Stone (3 Medals)", "Ore Upgrader (3 Medals)", "Gem/Bar Transmuters (4 Medals each)", "Duplicator (8 Medals)", "Prestige stat upgrades"],
  },
];

// Format currency
function formatMoney(amount) {
  if (amount >= 1000000000) return "$" + (amount / 1000000000).toFixed(2) + "B";
  if (amount >= 1000000) return "$" + (amount / 1000000).toFixed(2) + "M";
  if (amount >= 1000) return "$" + (amount / 1000).toFixed(1) + "K";
  return "$" + amount.toFixed(0);
}
