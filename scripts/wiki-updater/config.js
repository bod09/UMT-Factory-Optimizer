// Field classification: which fields come from wiki vs custom
export const WIKI_FIELDS = new Set(['name', 'cost', 'desc', 'category', 'size', 'medals']);
export const CUSTOM_FIELDS = new Set([
  'inputs', 'outputs', 'byproducts', 'effect', 'value', 'tag', 'tag2',
  'modifierImmune', 'orePool', 'gemType', 'gemValue', 'byproductRatio',
  'outputQtyMultiplier', 'cannotCrush', 'removedTags', 'preservedTags',
  'gamblingAdvantage', 'id'
]);

export const USER_AGENT = 'UMTFactoryOptimizer/1.0 (https://github.com/bod09/UMT-Factory-Optimizer; wiki-updater)';
export const API_BASE = 'https://umt.miraheze.org/w/api.php';

// Map wiki types to our category system
export const CATEGORY_MAP = {
  'Metalwork': 'metalwork',
  'Stonework': 'stonework',
  'Glasswork': 'glasswork',
  'Electronics': 'electronics',
  'Jewelcrafting': 'jewelcrafting',
  'Explosives': 'explosives',
  'Multipurpose': 'multipurpose',
  'Prestige': 'prestige',
  'Transport': 'transport',
};

// Machine name → machines.json ID mapping
// Some wiki names don't match our IDs, so we have explicit overrides
const ID_OVERRIDES = {
  'Power Core Assembler': 'power_core',
  'Superconductor Constructor': 'superconductor',
  'Prismatic Gem Crucible': 'prismatic_crucible',
  'Quality Assurance Machine': 'quality_assurance',
  'Gem To Bar Transmuter': 'gem_to_bar',
  'Bar To Gem Transmuter': 'bar_to_gem',
  'Mechanical Parts Maker': 'mech_parts_maker',
  'Philosophers Stone': 'philosophers_stone',
  "Philosopher's Stone": 'philosophers_stone',
  'Topaz Prospector': 'topaz_prospector',
  'Emerald Prospector': 'emerald_prospector',
  'Sapphire Prospector': 'sapphire_prospector',
  'Ruby Prospector': 'ruby_prospector',
  'Diamond Prospector': 'diamond_prospector',
  'Nano Sifter': 'nano_sifter',
  'Blasting Powder Refiner': 'blasting_powder_refiner',
  'Blasting Powder Chamber': 'blasting_powder_chamber',
  'Explosives Maker': 'explosives_maker',
  'Paint Mixer': 'paint_mixer',
  'Spraycan Machine': 'spraycan_machine',
};

export function nameToId(name) {
  if (ID_OVERRIDES[name]) return ID_OVERRIDES[name];
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}
