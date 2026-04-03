// UMT Factory Optimizer - Game Data (v0.5.4)
// Source: umt.miraheze.org
// All machines use normalized schema: inputTypes[], outputType, byproducts[], effect, value, tag

// === ITEM TYPE LABELS (for display) ===
const ITEM_TYPES = {
  ore: "Ore", bar: "Bar", alloy_bar: "Alloy Bar",
  bolts: "Bolts", plate: "Plate", pipe: "Pipe", coil: "Coil",
  frame: "Frame", casing: "Casing", mech_parts: "Mech Parts",
  filigree: "Filigree", engine: "Engine",
  stone: "Stone", dust: "Dust", metal_dust: "Metal Dust", gem_dust: "Gem Dust", clay: "Clay",
  ceramic_casing: "Ceramic Casing", bricks: "Bricks", cement: "Cement",
  glass: "Glass Sheet", lens: "Lens", optic: "Optic",
  circuit: "Circuit", electromagnet: "Electromagnet",
  superconductor: "Superconductor", tablet: "Tablet",
  laser: "Laser", power_core: "Power Core",
  gem: "Gem", cut_gem: "Cut Gem", prismatic_gem: "Prismatic Gem",
  ring: "Ring", amulet: "Amulet", gilded: "Gilded Item",
  blasting_powder: "Blasting Powder", explosives: "Explosives",
};

const CATEGORY_COLORS = {
  metalwork: "#3b82f6",
  stonework: "#6b7280",
  glasswork: "#22c55e",
  electronics: "#06b6d4",
  jewelcrafting: "#a855f7",
  explosives: "#ef4444",
  multipurpose: "#10b981",
  prestige: "#f59e0b",
  transport: "#64748b",
};

// Items the Gilder accepts as "jewelry" (confirmed)
const JEWELRY_TYPES = ["ring", "amulet"];

// Items the Electronic Tuner can apply to
const ELECTRONIC_TYPES = ["circuit", "electromagnet", "tablet", "laser", "power_core"];

// === ORES ===
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

// === ORE UPGRADER MAP ===
const ORE_UPGRADE_MAP = {
  "Tin": "Iron", "Iron": "Lead", "Lead": "Cobalt", "Cobalt": "Aluminium",
  "Aluminium": "Silver", "Silver": "Uranium", "Uranium": "Vanadium",
  "Vanadium": "Tungsten", "Tungsten": "Gold", "Gold": "Titanium",
  "Titanium": "Molybdenum", "Molybdenum": "Plutonium",
  "Plutonium": "Palladium", "Palladium": "Mithril",
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

// === MINE LAYERS ===
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

function getLayerName(depth) {
  const layer = MINE_LAYERS.find(l => depth >= l.depthMin && depth <= l.depthMax);
  return layer ? layer.name : "Beyond";
}

function getOresAtDepth(minDepth, maxDepth) {
  return ORES.filter(ore => ore.depthMin <= maxDepth && ore.depthMax >= minDepth);
}

function getGemsAtDepth(minDepth, maxDepth) {
  return GEMS_WITH_DEPTH.filter(gem => gem.depthMin <= maxDepth && gem.depthMax >= minDepth);
}

function getRequiredPickaxe(depth) {
  const ores = getOresAtDepth(depth, depth);
  const maxHardness = Math.max(...ores.map(o => o.hardness), 0);
  return PICKAXES.find(p => p.hardness >= maxHardness) || PICKAXES[PICKAXES.length - 1];
}

// === EQUIPMENT ===
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

// === ALL MACHINES (Normalized Schema) ===
const MACHINES = {
  // --- ONE-TIME MODIFIERS ---
  ore_cleaner: { name: "Ore Cleaner", cost: 80, category: "metalwork", inputTypes: ["ore"], outputType: "ore", effect: "flat", value: 10, tag: "Cleaned", desc: "+$10 to ores (once)" },
  polisher: { name: "Polisher", cost: 250, category: "multipurpose", inputTypes: ["any"], outputType: "same", effect: "flat", value: 10, tag: "Polished", desc: "+$10 to any item (once)" },
  philosophers_stone: { name: "Philosopher's Stone", cost: null, medals: 3, category: "prestige", inputTypes: ["ore"], outputType: "ore", effect: "percent", value: 0.25, tag: "Gold Infused", desc: "+25% ore value (once)" },
  quality_assurance: { name: "Quality Assurance", cost: 2000000, category: "multipurpose", inputTypes: ["any"], outputType: "same", effect: "percent", value: 0.20, tag: "QA Tested", desc: "+20% value (once)" },
  electronic_tuner: { name: "Electronic Tuner", cost: 8500, category: "electronics", inputTypes: ["circuit", "electromagnet", "tablet", "laser", "power_core"], outputType: "same", effect: "flat", value: 50, tag: "Tuned", desc: "+$50 to electronics (once)" },

  // --- SMELTING ---
  ore_smelter: { name: "Ore Smelter", cost: 380, category: "metalwork", inputTypes: ["ore"], outputType: "bar", byproducts: ["stone"], effect: "multiply", value: 1.20, desc: "Ore to Bar (1.2x) + Stone" },
  blast_furnace: { name: "Blast Furnace", cost: 25000, category: "metalwork", inputTypes: ["ore"], outputType: "bar", byproducts: ["stone"], effect: "multiply", value: 0.90, desc: "Ore to Bar (0.9x) + more Stone" },
  tempering_forge: { name: "Tempering Forge", cost: 50000, category: "metalwork", inputTypes: ["bar", "alloy_bar"], outputType: "same", effect: "multiply", value: 2.00, tag: "Tempered", desc: "2x bar/alloy value (once)" },

  // --- BAR PROCESSING ---
  coiler: { name: "Coiler", cost: 1750, category: "metalwork", inputTypes: ["bar", "alloy_bar"], outputType: "coil", effect: "flat", value: 20, desc: "Bar to Coil (+$20)" },
  bolt_machine: { name: "Bolt Machine", cost: 2800, category: "metalwork", inputTypes: ["bar", "alloy_bar"], outputType: "bolts", effect: "flat", value: 5, desc: "Bar to Bolts (+$5)" },
  plate_stamper: { name: "Plate Stamper", cost: 3000, category: "metalwork", inputTypes: ["bar", "alloy_bar"], outputType: "plate", effect: "flat", value: 20, desc: "Bar to Plate (+$20)" },

  // --- PLATE PROCESSING ---
  pipe_maker: { name: "Pipe Maker", cost: 4000, category: "metalwork", inputTypes: ["plate"], outputType: "pipe", effect: "flat", value: 20, desc: "Plate to Pipe (+$20)" },
  mech_parts_maker: { name: "Mechanical Parts Maker", cost: 8000, category: "metalwork", inputTypes: ["plate"], outputType: "mech_parts", effect: "flat", value: 30, desc: "Plate to Mech Parts (+$30)" },
  filigree_cutter: { name: "Filigree Cutter", cost: 50000, category: "metalwork", inputTypes: ["plate"], outputType: "filigree", effect: "percent", value: 0.20, desc: "Plate to Filigree (+20%)" },

  // --- COMBINING MACHINES ---
  frame_maker: { name: "Frame Maker", cost: 10000, category: "metalwork", inputTypes: ["bar", "bolts"], outputType: "frame", effect: "combine", value: 1.25, size: "2x3", desc: "Bar + Bolts = Frame (1.25x)" },
  casing_machine: { name: "Casing Machine", cost: 50000, category: "metalwork", inputTypes: ["frame", "bolts", "plate"], outputType: "casing", effect: "combine", value: 1.30, size: "3x3", desc: "Frame + Bolts + Plate = Casing (1.3x)" },
  alloy_furnace: { name: "Alloy Furnace", cost: 100000, category: "metalwork", inputTypes: ["bar", "bar"], outputType: "alloy_bar", effect: "combine", value: 1.20, size: "2x3", desc: "2 Bars = Alloy Bar (1.2x)" },
  engine_factory: { name: "Engine Factory", cost: 1000000, category: "metalwork", inputTypes: ["mech_parts", "pipe", "casing"], outputType: "engine", effect: "combine", value: 2.50, size: "3x3", desc: "Mech + Pipe + Casing = Engine (2.5x)" },

  // --- STONEWORK ---
  crusher: { name: "Crusher", cost: 1750, category: "stonework", inputTypes: ["any"], outputType: "dust", effect: "set", value: 1, desc: "Crushes anything to Dust ($1)" },
  sifter: { name: "Sifter", cost: 4000, category: "stonework", inputTypes: ["dust"], outputType: "ore", outputType2: "dust", effect: "chance", value: 0.10, size: "3x3", desc: "10% dust→ore, remaining dust passes through" },
  nano_sifter: { name: "Nano Sifter", cost: null, medals: 1, category: "prestige", inputTypes: ["dust"], outputType: "ore", outputType2: "dust", effect: "chance", value: 0.166, size: "3x3", desc: "16.6% dust→ore, remaining 83.4% dust passes through" },
  brick_mold: { name: "Brick Mold", cost: 2500, category: "stonework", inputTypes: ["dust"], outputType: "bricks", effect: "set", value: 25, desc: "Dust to Bricks ($25)" },
  cement_mixer: { name: "Cement Mixer", cost: 10000, category: "stonework", inputTypes: ["dust", "stone"], outputType: "cement", effect: "set", value: 30, desc: "Dust + Stone = Cement ($30)" },
  clay_mixer: { name: "Clay Mixer", cost: 20000, category: "stonework", inputTypes: ["dust", "dust"], outputType: "clay", effect: "set", value: 50, desc: "2 Dust = Clay ($50)" },
  ceramic_furnace: { name: "Ceramic Furnace", cost: 30000, category: "stonework", inputTypes: ["clay"], outputType: "ceramic_casing", effect: "set", value: 150, desc: "Clay to Ceramic Casing ($150)" },

  // --- GLASSWORK ---
  kiln: { name: "Kiln", cost: 4750, category: "multipurpose", inputTypes: ["dust"], outputType: "glass", effect: "set", value: 30, desc: "Dust to Glass Sheet ($30)" },
  lens_cutter: { name: "Lens Cutter", cost: 70000, category: "glasswork", inputTypes: ["glass"], outputType: "lens", effect: "flat", value: 50, desc: "Glass to Lens (+$50)" },
  optics_machine: { name: "Optics Machine", cost: 300000, category: "glasswork", inputTypes: ["lens", "pipe"], outputType: "optic", effect: "combine", value: 1.25, size: "3x2", desc: "Lens + Pipe = Optic (1.25x)" },

  // --- ELECTRONICS ---
  circuit_maker: { name: "Circuit Maker", cost: 20000, category: "electronics", inputTypes: ["glass", "coil"], outputType: "circuit", effect: "combine", value: 2.00, size: "3x3", desc: "Glass + Coil = Circuit (2x)" },
  magnetic_machine: { name: "Magnetic Machine", cost: 120000, category: "electronics", inputTypes: ["coil", "casing"], outputType: "electromagnet", effect: "combine", value: 1.50, size: "3x3", desc: "Coil + Casing = Electromagnet (1.5x)" },
  superconductor: { name: "Superconductor Constructor", cost: 1000000, category: "electronics", inputTypes: ["alloy_bar", "ceramic_casing"], outputType: "superconductor", effect: "combine", value: 3.00, size: "1x3", desc: "Alloy + Ceramic = Superconductor (3x)" },
  tablet_factory: { name: "Tablet Factory", cost: 2500000, category: "electronics", inputTypes: ["casing", "glass", "circuit"], outputType: "tablet", effect: "combine", value: 3.00, size: "3x4", desc: "Casing + Glass + Circuit = Tablet (3x)" },
  laser_maker: { name: "Laser Maker", cost: 3500000, category: "electronics", inputTypes: ["optic", "gem", "circuit"], outputType: "laser", effect: "combine", value: 2.75, size: "3x5", desc: "Optic + Gem + Circuit = Laser (2.75x)" },
  power_core: { name: "Power Core Assembler", cost: 4500000, category: "electronics", inputTypes: ["casing", "superconductor", "electromagnet"], outputType: "power_core", effect: "combine", value: 2.50, size: "5x5", desc: "Casing + Super + Electro = Power Core (2.5x)" },

  // --- JEWELCRAFTING ---
  gem_cutter: { name: "Gem Cutter", cost: 20000, category: "jewelcrafting", inputTypes: ["gem"], outputType: "cut_gem", effect: "multiply", value: 1.40, desc: "Gem to Cut Gem (1.4x)" },
  ring_maker: { name: "Ring Maker", cost: 15000, category: "jewelcrafting", inputTypes: ["gem", "coil"], outputType: "ring", effect: "combine", value: 1.70, size: "3x2", desc: "Gem + Coil = Ring (1.7x)" },
  prismatic_crucible: { name: "Prismatic Gem Crucible", cost: 100000, category: "jewelcrafting", inputTypes: ["gem", "gem"], outputType: "prismatic_gem", effect: "combine", value: 1.15, desc: "2 Gems = Prismatic Gem (1.15x)" },
  gilder: { name: "Gilder", cost: 500000, category: "jewelcrafting", inputTypes: ["filigree", "ring|amulet"], outputType: "gilded", effect: "combine", value: 1.50, size: "3x2", desc: "Filigree + Ring/Amulet = Gilded (1.5x)" },
  amulet_maker: { name: "Amulet Maker", cost: 2000000, category: "jewelcrafting", inputTypes: ["ring", "frame", "prismatic_gem"], outputType: "amulet", effect: "combine", value: 2.00, size: "5x3", desc: "Ring + Frame + Prismatic = Amulet (2x)" },

  // --- PROSPECTORS ---
  topaz_prospector: { name: "Topaz Prospector", cost: 2000, category: "jewelcrafting", inputTypes: ["stone"], outputType: "gem", gemType: "Topaz", effect: "chance", value: 0.05, desc: "Stone to Topaz (5%)" },
  emerald_prospector: { name: "Emerald Prospector", cost: 5000, category: "jewelcrafting", inputTypes: ["stone"], outputType: "gem", gemType: "Emerald", effect: "chance", value: 0.05, desc: "Stone to Emerald (5%)" },
  sapphire_prospector: { name: "Sapphire Prospector", cost: 8000, category: "jewelcrafting", inputTypes: ["stone"], outputType: "gem", gemType: "Sapphire", effect: "chance", value: 0.05, desc: "Stone to Sapphire (5%)" },
  ruby_prospector: { name: "Ruby Prospector", cost: 15000, category: "jewelcrafting", inputTypes: ["stone"], outputType: "gem", gemType: "Ruby", effect: "chance", value: 0.05, desc: "Stone to Ruby (5%)" },
  diamond_prospector: { name: "Diamond Prospector", cost: 30000, category: "jewelcrafting", inputTypes: ["stone"], outputType: "gem", gemType: "Diamond", effect: "chance", value: 0.05, desc: "Stone to Diamond (5%)" },

  // --- EXPLOSIVES ---
  blasting_powder_chamber: { name: "Blasting Powder Chamber", cost: 19000, category: "explosives", inputTypes: ["dust", "dust"], outputType: "blasting_powder", effect: "set", value: 2, desc: "Metal Dust + Stone Dust = Powder ($2)" },
  explosives_maker: { name: "Explosives Maker", cost: 19000, category: "explosives", inputTypes: ["blasting_powder", "casing"], outputType: "explosives", effect: "multiplicative", size: "3x5", desc: "Casing value x Powder value" },
  blasting_powder_refiner: { name: "Blasting Powder Refiner", cost: 2500000, category: "explosives", inputTypes: ["blasting_powder", "dust"], outputType: "blasting_powder", effect: "flat", value: 1, size: "3x3", desc: "Powder + Dust = Powder (+$1, once)" },

  // --- PRESTIGE ---
  ore_upgrader: { name: "Ore Upgrader", cost: null, medals: 3, category: "prestige", inputTypes: ["ore"], outputType: "ore", effect: "upgrade_tier", desc: "Upgrades ore one tier (max Mithril)" },
  gem_to_bar: { name: "Gem to Bar Transmuter", cost: null, medals: 4, category: "prestige", inputTypes: ["gem"], outputType: "bar", effect: "preserve", desc: "Gem to Bar (same value)" },
  bar_to_gem: { name: "Bar to Gem Transmuter", cost: null, medals: 4, category: "prestige", inputTypes: ["bar"], outputType: "gem", effect: "preserve", desc: "Bar to Gem (same value)" },
  duplicator: { name: "Duplicator", cost: null, medals: 8, category: "prestige", inputTypes: ["any"], outputType: "duplicate", effect: "duplicate", value: 0.50, size: "3x5", desc: "2 copies at 50% value (once per item)" },
};

// === PRESTIGE UPGRADES ===
const PRESTIGE_UPGRADES = [
  { name: "Walk Speed", bonusPerLevel: "+10%", medalCostFormula: "2^(level-1)" },
  { name: "Jump Height", bonusPerLevel: "+15%", medalCostFormula: "2^(level-1)" },
  { name: "Pickaxe Strength", bonusPerLevel: "+10%", medalCostFormula: "2^(level-1)" },
  { name: "Pickaxe Speed", bonusPerLevel: "+10%", medalCostFormula: "2^(level-1)" },
  { name: "Vehicle Power", bonusPerLevel: "+15%", medalCostFormula: "2^(level-1)" },
  { name: "Starting Money", bonusPerLevel: "+$250", medalCostFormula: "2^(level-1)" },
];

// PROGRESSION_STAGES removed - progression now data-driven from FlowOptimizer

// === PRESTIGE COST ===
function getPrestigeCost(level) {
  return 20000000 * Math.pow(2, level - 1);
}

// === FORMATTING ===
function formatMoney(amount) {
  if (amount >= 1000000000) return "$" + (amount / 1000000000).toFixed(2) + "B";
  if (amount >= 1000000) return "$" + (amount / 1000000).toFixed(2) + "M";
  if (amount >= 1000) return "$" + (amount / 1000).toFixed(1) + "K";
  return "$" + Math.round(amount);
}
