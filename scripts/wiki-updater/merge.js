// Safe merge: update wiki fields, preserve custom fields
import { WIKI_FIELDS, CATEGORY_MAP, nameToId } from './config.js';

export function mergeWikiData(existingMachines, wikiMachines) {
  const changes = { updated: [], added: [], costChanges: [], descChanges: [] };
  const result = { ...existingMachines };

  for (const wiki of wikiMachines) {
    const id = nameToId(wiki.name);
    const category = CATEGORY_MAP[wiki.category] || wiki.category?.toLowerCase() || '';

    if (result[id]) {
      // Existing machine: only update wiki-sourced fields
      const existing = result[id];
      const machineChanges = [];

      // Check each wiki field
      // Only update name if significantly different (not just case/apostrophe)
      if (wiki.name && wiki.name.toLowerCase().replace(/['']/g, '') !== existing.name.toLowerCase().replace(/['']/g, '')) {
        machineChanges.push(`name: "${existing.name}" → "${wiki.name}"`);
        existing.name = wiki.name;
      }
      if (wiki.cost !== undefined && wiki.cost !== existing.cost) {
        machineChanges.push(`cost: ${existing.cost} → ${wiki.cost}`);
        changes.costChanges.push({ id, name: wiki.name, old: existing.cost, new: wiki.cost });
        existing.cost = wiki.cost;
      }
      if (wiki.medals !== undefined && wiki.medals !== existing.medals) {
        machineChanges.push(`medals: ${existing.medals} → ${wiki.medals}`);
        existing.medals = wiki.medals;
      }
      if (wiki.desc && wiki.desc !== existing.desc) {
        // Only flag, don't auto-update (descriptions often have custom additions)
        changes.descChanges.push({ id, name: wiki.name, old: existing.desc?.substring(0, 80), new: wiki.desc.substring(0, 80) });
        existing.desc = wiki.desc;
      }
      if (category && category !== existing.category) {
        machineChanges.push(`category: "${existing.category}" → "${category}"`);
        existing.category = category;
      }
      if (wiki.size && wiki.size !== existing.size) {
        machineChanges.push(`size: "${existing.size}" → "${wiki.size}"`);
        existing.size = wiki.size;
      }

      if (machineChanges.length > 0) {
        changes.updated.push({ id, name: wiki.name, changes: machineChanges });
      }
    } else {
      // New machine: add with wiki fields, empty custom fields
      result[id] = {
        name: wiki.name,
        cost: wiki.cost || 0,
        category: category,
        desc: wiki.desc || '',
        size: wiki.size || '',
        // Custom fields left empty - need manual setup
        inputs: [],
        outputs: [],
        effect: 'unknown',
        _needsSetup: true,
      };
      if (wiki.medals) result[id].medals = wiki.medals;
      if (wiki.event) result[id].event = true;
      changes.added.push({ id, name: wiki.name });
    }
  }

  return { machines: result, changes };
}
