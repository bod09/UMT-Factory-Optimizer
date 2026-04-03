// Wiki API fetcher with rate limiting
import { USER_AGENT, API_BASE } from './config.js';

const DELAY_MS = 500; // Rate limit between requests
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiRequest(params) {
  const url = new URL(API_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().then(t => t.substring(0, 200))}`);
  return res.json();
}

// Get list of all machine names from the Machines page
export async function fetchMachineList() {
  const data = await apiRequest({ action: 'parse', page: 'Machines', prop: 'wikitext' });
  const wikitext = data.parse?.wikitext?.['*'] || '';

  // Detect event section boundary
  const eventSectionStart = wikitext.indexOf('=== Event ===');

  // Extract ItemTile templates: {{ItemTile|name=...|value=...}}
  const machines = [];
  const regex = /\{\{ItemTile\|name=([^|]+)\|[^}]*value=\{\{Credits\|(\d+)\}\}/g;
  let match;
  while ((match = regex.exec(wikitext)) !== null) {
    const isEvent = eventSectionStart >= 0 && match.index > eventSectionStart;
    machines.push({ name: match[1].trim(), cost: parseInt(match[2]), event: isEvent });
  }

  // Also check for medal-cost items (prestige)
  const medalRegex = /\{\{ItemTile\|name=([^|]+)\|[^}]*value=\{\{Medals\|(\d+)\}\}/g;
  while ((match = medalRegex.exec(wikitext)) !== null) {
    const isEvent = eventSectionStart >= 0 && match.index > eventSectionStart;
    machines.push({ name: match[1].trim(), medals: parseInt(match[2]), event: isEvent });
  }

  return machines;
}

// Fetch individual machine page and extract Infobox data
export async function fetchMachinePage(name) {
  await sleep(DELAY_MS);

  try {
    const data = await apiRequest({ action: 'parse', page: name, prop: 'wikitext', redirects: '1' });
    const wikitext = data.parse?.wikitext?.['*'] || '';

    // Handle redirects
    if (wikitext.startsWith('#REDIRECT')) {
      const target = wikitext.match(/\[\[([^\]]+)\]\]/)?.[1];
      if (target) return fetchMachinePage(target);
      return null;
    }

    // Extract Infobox machine template
    const infoboxMatch = wikitext.match(/\{\{(?:Template:)?Infobox machine([^]*?)\}\}/);
    if (!infoboxMatch) return null;

    const infobox = infoboxMatch[1];
    const fields = {};

    // Parse pipe-delimited fields
    const fieldRegex = /\|(\w+)\s*=\s*([^|]*?)(?=\|[A-Z]|\}\}|$)/gs;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(infobox)) !== null) {
      const key = fieldMatch[1].trim();
      let val = fieldMatch[2].trim();
      // Clean up wiki markup
      val = val.replace(/\[\[File:[^\]]+\]\]/g, '');
      val = val.replace(/\[\[([^\]|]+)\|?[^\]]*\]\]/g, '$1');
      val = val.replace(/<\/?[^>]+>/g, '');
      val = val.replace(/'''?/g, '');
      fields[key] = val.trim();
    }

    // Extract cost
    const costMatch = infobox.match(/\{\{Credits\|(\d+)\}\}/);
    const medalMatch = infobox.match(/\{\{Medals\|(\d+)\}\}/);
    if (costMatch) fields.cost = parseInt(costMatch[1]);
    if (medalMatch) fields.medals = parseInt(medalMatch[1]);

    // Check if event machine is currently removed/inactive
    const isRemoved = /has since been\s*'''?removed'''?/i.test(wikitext) ||
                       /no longer available/i.test(wikitext);
    if (isRemoved) fields._removed = true;

    fields._fullText = wikitext;

    return fields;
  } catch (e) {
    console.error(`Error fetching ${name}: ${e.message}`);
    return null;
  }
}

// Fetch all machine data
export async function fetchAllMachines() {
  console.log('Fetching machine list from Machines page...');
  const list = await fetchMachineList();
  console.log(`Found ${list.length} machines on wiki`);

  const machines = [];
  for (const item of list) {
    process.stdout.write(`  Fetching ${item.name}...`);
    const page = await fetchMachinePage(item.name);
    if (page) {
      // Merge list data with page data
      machines.push({
        name: page.Name || item.name,
        cost: page.cost || item.cost,
        medals: page.medals || item.medals,
        desc: page.Description || '',
        category: page.Type || '',
        size: page.Size || '',
        event: item.event || false,
        _removed: page._removed || false,
      });
      console.log(' OK');
    } else {
      console.log(' (no infobox)');
      machines.push({ name: item.name, cost: item.cost, medals: item.medals });
    }
  }

  return machines;
}
