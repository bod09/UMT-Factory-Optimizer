#!/usr/bin/env node
// Discovery script: fetch wiki page and examine structure
// Run: node scripts/wiki-updater/discover.js

const USER_AGENT = 'UMTFactoryOptimizer/1.0 (https://github.com/bod09/UMT-Factory-Optimizer; wiki-updater)';
const API_BASE = 'https://umt.miraheze.org/w/api.php';

async function fetchPage(title) {
  const url = `${API_BASE}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json`;
  console.log(`Fetching: ${url}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
  });

  console.log(`Status: ${res.status}`);
  if (!res.ok) {
    const text = await res.text();
    console.log(`Response: ${text.substring(0, 500)}`);
    return null;
  }

  const data = await res.json();
  return data.parse?.wikitext?.['*'] || null;
}

async function fetchHTML(title) {
  const url = `${API_BASE}?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json`;
  console.log(`Fetching HTML: ${url}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
  });

  console.log(`Status: ${res.status}`);
  if (!res.ok) return null;

  const data = await res.json();
  return data.parse?.text?.['*'] || null;
}

async function listPages() {
  // Try getting all pages in a category or all pages
  const url = `${API_BASE}?action=query&list=allpages&aplimit=50&format=json`;
  console.log(`Listing pages: ${url}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
  });

  console.log(`Status: ${res.status}`);
  if (!res.ok) return null;

  const data = await res.json();
  return data.query?.allpages || null;
}

async function main() {
  console.log('=== UMT Wiki Discovery ===\n');

  // Step 1: Try listing pages
  console.log('--- Step 1: List all pages ---');
  const pages = await listPages();
  if (pages) {
    console.log(`Found ${pages.length} pages:`);
    pages.forEach(p => console.log(`  - ${p.title}`));
  }

  // Step 2: Try fetching the Machines page
  console.log('\n--- Step 2: Fetch "Machines" page wikitext ---');
  const wikitext = await fetchPage('Machines');
  if (wikitext) {
    console.log(`Wikitext length: ${wikitext.length} chars`);
    console.log('First 2000 chars:');
    console.log(wikitext.substring(0, 2000));
    console.log('\n...\n');

    // Look for templates/infoboxes
    const templates = wikitext.match(/\{\{[^}]+\}\}/g);
    if (templates) {
      console.log(`Found ${templates.length} templates:`);
      const unique = [...new Set(templates.map(t => t.split('|')[0] + '}}'))];
      unique.forEach(t => console.log(`  ${t}`));
    }

    // Look for tables
    const tables = wikitext.match(/\{\|[^]*?\|\}/g);
    if (tables) {
      console.log(`\nFound ${tables.length} tables`);
      console.log('First table (first 500 chars):');
      console.log(tables[0].substring(0, 500));
    }
  }

  // Step 3: Try Plots page (Build Shop)
  console.log('\n--- Step 3: Fetch "Plots" page ---');
  const plotsWiki = await fetchPage('Plots');
  if (plotsWiki) {
    console.log(`Wikitext length: ${plotsWiki.length} chars`);
    // Find machine-related sections
    const machineSection = plotsWiki.match(/==\s*Production\s*==[^]*?(?===|$)/);
    if (machineSection) {
      console.log('Production section (first 1000 chars):');
      console.log(machineSection[0].substring(0, 1000));
    }
  }

  // Step 4: Try fetching HTML to see rendered tables
  console.log('\n--- Step 4: Fetch "Machines" HTML ---');
  const html = await fetchHTML('Machines');
  if (html) {
    console.log(`HTML length: ${html.length} chars`);
    // Extract table rows
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g);
    if (rows) {
      console.log(`Found ${rows.length} table rows`);
      // Show first few rows
      rows.slice(0, 5).forEach((r, i) => {
        const cells = r.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g);
        if (cells) {
          const text = cells.map(c => c.replace(/<[^>]+>/g, '').trim()).join(' | ');
          console.log(`  Row ${i}: ${text}`);
        }
      });
    }
  }
}

main().catch(console.error);
