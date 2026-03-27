// UMT Factory Optimizer - Application Logic

const optimizer = new FactoryOptimizer();
const STORAGE_KEY = "umt-optimizer-config";

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- localStorage persistence ---
function saveConfig() {
  const config = {
    budget: $("#budget").value,
    zoneSelect: $("#zone-select").value,
    depthMin: $("#depth-min").value,
    depthMax: $("#depth-max").value,
    outputBelts: $("#output-belts").value,
    doubleSeller: $("#double-seller").checked,
    xxlBackpack: $("#xxl-backpack").checked,
    theoreticalMax: $("#theoretical-max").checked,
    prestigeItems: {},
    prestigeUpgrades: {},
  };
  $$("#prestige-items-config input[type='number']").forEach(inp => {
    config.prestigeItems[inp.id] = inp.value;
  });
  $$("#prestige-upgrades-config input[type='number']").forEach(inp => {
    config.prestigeUpgrades[inp.dataset.upgrade] = inp.value;
  });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch(e) {}
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const config = JSON.parse(raw);

    if (config.budget) $("#budget").value = config.budget;
    if (config.depthMin) $("#depth-min").value = config.depthMin;
    if (config.depthMax) $("#depth-max").value = config.depthMax;
    if (config.outputBelts) $("#output-belts").value = config.outputBelts;
    if (config.doubleSeller) $("#double-seller").checked = config.doubleSeller;
    if (config.xxlBackpack) $("#xxl-backpack").checked = config.xxlBackpack;
    if (config.theoreticalMax) $("#theoretical-max").checked = config.theoreticalMax;

    // Zone select
    if (config.zoneSelect) $("#zone-select").value = config.zoneSelect;

    // Budget display
    $("#budget-display").textContent = formatMoney(parseInt($("#budget").value) || 0);

    // Prestige item quantities
    if (config.prestigeItems) {
      Object.entries(config.prestigeItems).forEach(([id, val]) => {
        const inp = document.getElementById(id);
        if (inp) inp.value = val;
      });
    }

    // Prestige upgrade levels
    if (config.prestigeUpgrades) {
      $$("#prestige-upgrades-config input[type='number']").forEach(inp => {
        const val = config.prestigeUpgrades[inp.dataset.upgrade];
        if (val !== undefined) inp.value = val;
      });
    }
  } catch(e) {}
}

// Tab navigation
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initZoneSelect();
  initPrestigeUpgrades();
  attachEvents();

  // Load saved config BEFORE rendering content that depends on it
  loadConfig();
  updateDepthLabels();

  // Now render content that reads checkbox/input state
  initDatabase();
  initSpeedrun();
  initProgression();
  initPrestigeCosts();
  initBuilder();

  // Run initial optimization (no scroll on page load)
  runOptimizer(false);
});

function initTabs() {
  $$(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-content").forEach(t => t.classList.remove("active"));
      $(`#tab-${btn.dataset.tab}`).classList.add("active");
    });
  });

  // DB sub-tabs
  $$(".db-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".db-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".db-content").forEach(t => t.classList.remove("active"));
      $(`#db-${btn.dataset.db}`).classList.add("active");
    });
  });
}

function initZoneSelect() {
  const select = $("#zone-select");
  MINE_LAYERS.forEach(layer => {
    const opt = document.createElement("option");
    opt.value = `${layer.depthMin}-${layer.depthMax}`;
    opt.textContent = `${layer.name} (${layer.depthMin}-${layer.depthMax}m)`;
    select.appendChild(opt);
  });
  // Default to Bedrock
  select.value = "550-849";
  applyZone("550-849");
}

function applyZone(value) {
  if (value === "custom") return;
  const [min, max] = value.split("-").map(Number);
  $("#depth-min").value = min;
  $("#depth-max").value = max;
  updateDepthLabels();
}

function updateDepthLabels() {
  const minDepth = parseInt($("#depth-min").value) || 0;
  const maxDepth = parseInt($("#depth-max").value) || 0;
  $("#depth-min-layer").textContent = getLayerName(minDepth);
  $("#depth-max-layer").textContent = getLayerName(maxDepth);
}

function attachEvents() {
  $("#btn-optimize").addEventListener("click", () => runOptimizer(true));
  $("#budget").addEventListener("input", () => {
    $("#budget-display").textContent = formatMoney(parseInt($("#budget").value) || 0);
    saveConfig();
  });
  $("#theoretical-max").addEventListener("change", saveConfig);
  $("#zone-select").addEventListener("change", (e) => {
    applyZone(e.target.value);
    saveConfig();
  });
  $("#output-belts").addEventListener("change", saveConfig);
  $("#double-seller").addEventListener("change", saveConfig);
  $("#xxl-backpack").addEventListener("change", () => {
    saveConfig();
    renderSpeedrun();
    renderProgression();
  });
  // Switch to "Custom" when manually editing depths
  $("#depth-min").addEventListener("input", () => {
    $("#zone-select").value = "custom";
    updateDepthLabels();
    saveConfig();
  });
  $("#depth-max").addEventListener("input", () => {
    $("#zone-select").value = "custom";
    updateDepthLabels();
    saveConfig();
  });

  // Prestige item quantity inputs save on change
  $$("#prestige-items-config input[type='number']").forEach(inp => {
    inp.addEventListener("input", saveConfig);
  });
  // Prestige upgrade inputs save on change (delegated after they're created)
  $$("#prestige-upgrades-config input[type='number']").forEach(inp => {
    inp.addEventListener("input", saveConfig);
  });

  // Machine filter
  $$(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterMachines(btn.dataset.cat);
    });
  });
}

function initPrestigeUpgrades() {
  const container = $("#prestige-upgrades-config");
  PRESTIGE_UPGRADES.forEach(upgrade => {
    const row = document.createElement("div");
    row.className = "prestige-upgrade-row";
    row.innerHTML = `
      <span>${upgrade.name} (${upgrade.bonusPerLevel}/lvl)</span>
      <input type="number" value="0" min="0" max="20" data-upgrade="${upgrade.name}">
    `;
    container.appendChild(row);
  });
}

function runOptimizer(scrollToResults = false) {
  const theoreticalMax = $("#theoretical-max").checked;
  const budget = theoreticalMax ? 999999999 : (parseInt($("#budget").value) || 0);
  const minDepth = parseInt($("#depth-min").value) || 0;
  let maxDepth = parseInt($("#depth-max").value) || 0;
  const outputBelts = parseInt($("#output-belts").value) || 1;
  const hasDoubleSeller = theoreticalMax ? true : $("#double-seller").checked;

  // Clamp max >= min
  if (maxDepth < minDepth) {
    maxDepth = minDepth;
    $("#depth-max").value = maxDepth;
    updateDepthLabels();
  }

  // Read prestige item quantities (>0 means owned)
  const prestigeItems = theoreticalMax ? {
    philosophersStone: true,
    nanoSifter: true,
    oreUpgrader: true,
    duplicator: true,
    transmuters: true,
  } : {
    philosophersStone: (parseInt($("#has-philosophers-stone")?.value) || 0) > 0,
    nanoSifter: (parseInt($("#has-nano-sifter")?.value) || 0) > 0,
    oreUpgrader: (parseInt($("#has-ore-upgrader")?.value) || 0) > 0,
    duplicator: (parseInt($("#has-duplicator")?.value) || 0) > 0,
    transmuters: (parseInt($("#has-transmuters")?.value) || 0) > 0,
  };

  optimizer.configure({ prestigeLevel: 0, budget, hasDoubleSeller, prestigeItems });

  // Get all ores and gems at this depth
  const oresAtDepth = getOresAtDepth(minDepth, maxDepth);
  const gemsAtDepth = getGemsAtDepth(minDepth, maxDepth);

  // Render depth summary
  renderDepthSummary(minDepth, maxDepth, oresAtDepth, gemsAtDepth);

  if (oresAtDepth.length === 0) {
    $("#chain-results").innerHTML = '<div class="chain-card">No ores found at this depth range.</div>';
    $("#income-grid").innerHTML = "";
    $("#optimizer-results").classList.remove("hidden");
    return;
  }

  // Calculate weighted average across all ores at depth
  // Each chain gets an average value based on all ores that appear
  const chainMap = new Map();

  for (const ore of oresAtDepth) {
    const results = optimizer.getBestChain(ore, budget);
    for (const result of results) {
      if (!chainMap.has(result.chain)) {
        chainMap.set(result.chain, {
          chain: result.chain,
          cost: result.cost,
          medals: result.medals || 0,
          oresNeeded: result.oresNeeded,
          graph: result.graph || null,
          usesDup: result.usesDup || false,
          oreBreakdown: [],
          totalValue: 0,
          totalPerOre: 0,
        });
      }
      const entry = chainMap.get(result.chain);
      entry.oreBreakdown.push({ ore: ore.name, value: result.value, perOre: result.perOre, baseValue: ore.value });
      entry.totalValue += result.value;
      entry.totalPerOre += result.perOre;
    }
  }

  // Calculate averages and sort
  const aggregated = [...chainMap.values()].map(entry => ({
    ...entry,
    avgValue: entry.totalValue / entry.oreBreakdown.length,
    avgPerOre: entry.totalPerOre / entry.oreBreakdown.length,
    minValue: Math.min(...entry.oreBreakdown.map(o => o.perOre)),
    maxValue: Math.max(...entry.oreBreakdown.map(o => o.perOre)),
  }));

  aggregated.sort((a, b) => b.avgPerOre - a.avgPerOre);

  renderChainResults(aggregated, oresAtDepth);
  renderIncomeEstimate(aggregated, outputBelts, oresAtDepth.length);

  $("#optimizer-results").classList.remove("hidden");

  saveConfig();

  if (scrollToResults) {
    $("#optimizer-results").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderDepthSummary(minDepth, maxDepth, ores, gems) {
  const container = $("#depth-ore-summary");

  const requiredPick = getRequiredPickaxe(maxDepth);

  container.innerHTML = `
    <div class="depth-summary-content">
      <div class="depth-info">
        <h3>Mining ${minDepth}m - ${maxDepth}m</h3>
        <span class="depth-layers">${getLayerName(minDepth)}${getLayerName(minDepth) !== getLayerName(maxDepth) ? " to " + getLayerName(maxDepth) : ""}</span>
        <span class="depth-pickaxe">Requires: ${requiredPick.name} (${requiredPick.hardness} hardness)</span>
      </div>
      <div class="depth-resources">
        <div class="depth-ores">
          <span class="depth-label">Ores (${ores.length})</span>
          <div class="depth-tags">
            ${ores.map(o => `<span class="ore-tag" title="$${o.value}">${o.name} <em>$${o.value.toLocaleString()}</em></span>`).join("")}
          </div>
        </div>
        ${gems.length > 0 ? `
        <div class="depth-gems">
          <span class="depth-label">Gems (${gems.length})</span>
          <div class="depth-tags">
            ${gems.map(g => `<span class="gem-tag" title="$${g.value}">${g.name} <em>$${g.value.toLocaleString()}</em></span>`).join("")}
          </div>
        </div>` : ""}
      </div>
    </div>
  `;
}

function renderChainResults(results, oresAtDepth) {
  const container = $("#chain-results");
  container.innerHTML = "";

  results.forEach((result, idx) => {
    const card = document.createElement("div");
    card.className = `chain-card${idx === 0 ? " best" : ""}`;

    // Per-ore breakdown tags
    const oreBreakdownHtml = result.oreBreakdown
      ? result.oreBreakdown
          .sort((a, b) => b.perOre - a.perOre)
          .map(ob => `<span class="ore-breakdown-item"><strong>${ob.ore}</strong> ${formatMoney(ob.perOre)}</span>`)
          .join("")
      : "";

    const graphId = `graph-${idx}`;

    card.innerHTML = `
      <div class="chain-header">
        <span class="chain-name">${result.chain}</span>
        <span class="chain-value">${formatMoney(result.avgPerOre || result.perOre)} <small>avg/ore</small></span>
      </div>
      <div class="chain-details">
        <div class="chain-detail">Range: <strong>${result.minValue ? formatMoney(result.minValue) + " - " + formatMoney(result.maxValue) : formatMoney(result.perOre)}</strong></div>
        <div class="chain-detail">Setup Cost: <strong>${formatMoney(result.cost)}</strong></div>
        <div class="chain-detail">Ores/Product: <strong>${result.oresNeeded}</strong></div>
        ${result.usesDup ? '<div class="chain-detail" style="color:#f472b6">Duplicator active</div>' : ""}
      </div>
      ${result.graph ? `
        <button class="chain-breakdown-toggle" onclick="toggleGraph('${graphId}', this)">View Graph</button>
        <div class="graph-container hidden" id="${graphId}"></div>
      ` : ""}
      ${oreBreakdownHtml ? `<div class="ore-breakdown">${oreBreakdownHtml}</div>` : ""}
    `;
    container.appendChild(card);

    // Lazy render graph on first open
    if (result.graph) {
      card.querySelector(".chain-breakdown-toggle").addEventListener("click", function handler() {
        const graphEl = document.getElementById(graphId);
        if (graphEl && !graphEl.dataset.rendered) {
          graphVisualizer.render(result.graph, graphEl);
          graphEl.dataset.rendered = "true";
        }
      }, { once: true });
    }
  });
}

function toggleGraph(graphId, btn) {
  const el = document.getElementById(graphId);
  if (el) {
    el.classList.toggle("hidden");
    btn.textContent = el.classList.contains("hidden") ? "View Graph" : "Hide Graph";
  }
}

// Old text-based breakdowns removed - replaced by SVG graph visualizer
// See js/visualizer.js and js/graph.js

function _unused_getChainBreakdown(chainName, ore) {
  const p = optimizer.prestigeItems;
  const hasDS = optimizer.hasDoubleSeller;
  const hasQA = optimizer.budget >= 2000000;

  let oreVal = optimizer.getEffectiveOreValue(ore);
  const wasUpgraded = oreVal !== ore.value;

  if (chainName.includes("Direct")) {
    let s = [], v = ore.value;
    s.push(stepPlain("Ore", "", v));
    if (wasUpgraded) { v = oreVal; s.push(stepMult("Ore Upgrader", "next tier", v)); }
    if (hasDS) { v *= 2; s.push(stepSell("Double Seller", "x2", v)); }
    return s.join("");
  }

  // Standard bar pipeline (reused by all chains)
  function barPipeline(startVal) {
    let s = [], v = startVal;
    if (wasUpgraded) { v = oreVal; s.push(stepMult("Ore Upgrader", "next tier", v)); }
    v += 10; s.push(stepFlat("Ore Cleaner", "+$10", v));
    v += 10; s.push(stepFlat("Polisher", "+$10", v));
    if (p.philosophersStone) { v *= 1.25; s.push(stepMult("Philosopher's Stone", "x1.25", v)); }
    v *= 1.20; s.push(stepMult("Ore Smelter → Bar", "x1.2", v));
    // Stone byproduct routing
    if (p.nanoSifter) {
      s.push(stepPlain("  ↳ Stone → Crush → Nano Sifter → ore → back to start", "16.6%", ""));
    } else {
      s.push(stepPlain("  ↳ Stone → Crush → Kiln → Glass / Sifter", "byproduct", ""));
    }
    v *= 2.00; s.push(stepMult("Tempering Forge", "x2.0", v));
    if (p.transmuters) {
      // Side path: bar detours through gem chain once, then routed onward
      let sideSteps = "";
      sideSteps += stepLoop("Bar-to-Gem Transmuter", "→ Gem", v);
      v *= 1.40; sideSteps += stepLoop("Gem Cutter", "x1.4", v);
      v *= 1.15; sideSteps += stepLoop("Prismatic Crucible (pair 2)", "x1.15", v);
      sideSteps += stepLoop("Gem-to-Bar Transmuter", "→ Bar (route onward)", v);
      s.push(loopGroup(sideSteps));
    }
    return { s, v };
  }

  // Processed Bar
  if (chainName.includes("Processed")) {
    let s = [];
    let v = ore.value;
    s.push(stepPlain("Ore", "", v));

    if (p.duplicator) {
      if (wasUpgraded) { v = oreVal; s.push(stepMult("Ore Upgrader", "next tier", v)); }
      let half = v * 0.5;
      s.push(stepDup("DUPLICATOR", "2 copies at 50%", half));
      s.push(step("", "", "", "section")); // spacer
      s.push(stepFlat("Each → Ore Cleaner", "+$10", half + 10));
      let pc = half + 10 + 10;
      s.push(stepFlat("Each → Polisher", "+$10", pc));
      if (p.philosophersStone) { pc *= 1.25; s.push(stepMult("Each → Philosopher's Stone", "x1.25", pc)); }
      pc *= 1.20; s.push(stepMult("Each → Ore Smelter → Bar", "x1.2", pc));
      pc *= 2.00; s.push(stepMult("Each → Tempering Forge", "x2.0", pc));
      if (p.transmuters) {
        let lp = "";
        lp += stepLoop("Each → Bar-to-Gem", "side path →", pc);
        pc *= 1.40; lp += stepLoop("Each → Gem Cutter", "x1.4", pc);
        pc *= 1.15; lp += stepLoop("Each → Prismatic", "x1.15", pc);
        lp += stepLoop("Each → Gem→Bar", "→ back to Bar", pc);
        s.push(loopGroup(lp));
      }
      if (hasQA) { pc *= 1.20; s.push(stepMult("Each → Quality Assurance", "x1.2", pc)); }
      let total = pc * 2;
      s.push(stepCombine("2 copies combined", "x2", total));
      if (hasDS) { total *= 2; s.push(stepSell("Double Seller", "x2", total)); }
    } else {
      let { s: bs, v: bv } = barPipeline(v);
      s = s.concat(bs);
      v = bv;
      if (hasQA) { v *= 1.20; s.push(stepMult("Quality Assurance", "x1.2", v)); }
      if (hasDS) { v *= 2; s.push(stepSell("Double Seller", "x2", v)); }
    }
    if (p.nanoSifter) s.push(stepFlat("Nano Sifter (stone→dust→ore→back to Ore Cleaner)", "+bonus", optimizer.nanoBonus()));
    return s.join("");
  }

  // Multi-input chains
  let s = [];
  s.push(step("BAR PROCESSING (per ore)", "", "", "section"));
  s.push(stepPlain("Ore", "", ore.value));
  let { s: bs, v: barVal } = barPipeline(ore.value);
  s = s.concat(bs);

  let bolts = barVal + 5, plate = barVal + 20;
  let frame = (barVal + bolts) * 1.25;
  let casing = (frame + bolts + plate) * 1.30;

  if (chainName.includes("Engine")) {
    s.push(step("ENGINE ASSEMBLY (5 ores)", "", "", "section"));
    s.push(stepFlat("Ore 1 → Bar → Plate Stamper", "+$20 → Plate", plate));
    s.push(stepFlat("  Plate → Mech Parts Maker", "+$30 → Mech Parts", plate + 30));
    s.push(stepFlat("Ore 2 → Bar → Plate → Pipe Maker", "+$20 → Pipe", plate + 20));
    s.push(stepFlat("Ore 3 → Bar → Bolt Machine", "+$5 → Bolts", bolts));
    s.push(stepCombine("Ore 4 → Bar + Bolts → Frame Maker", "x1.25", frame));
    s.push(stepCombine("+ Bolts + Plate → Casing Machine", "x1.3", casing));
    let eng = ((plate+30) + (plate+20) + casing) * 2.50;
    s.push(stepCombine("Mech + Pipe + Casing → Engine Factory", "x2.5", eng));
    if (hasQA) { eng *= 1.20; s.push(stepMult("Quality Assurance", "x1.2", eng)); }
    if (hasDS) { eng *= 2; s.push(stepSell("Double Seller", "x2", eng)); }
  } else if (chainName.includes("Tablet")) {
    let coil = barVal + 20, glass = 30;
    let circuit = (glass + coil) * 2.0;
    let tab = (casing + glass + circuit) * 3.0;
    s.push(step("TABLET ASSEMBLY (5 ores)", "", "", "section"));
    s.push(stepCombine("Ores 1-4 → Casing", "x1.3", casing));
    s.push(stepPlain("Stone byproduct → Crush → Kiln", "→ Glass $30", glass));
    s.push(stepFlat("Ore 5 → Bar → Coiler", "+$20 → Coil", coil));
    s.push(stepCombine("Glass + Coil → Circuit Maker", "x2.0", circuit));
    s.push(stepCombine("Casing + Glass + Circuit → Tablet", "x3.0", tab));
    if (hasQA) { tab *= 1.20; s.push(stepMult("Quality Assurance", "x1.2", tab)); }
    if (hasDS) { tab *= 2; s.push(stepSell("Double Seller", "x2", tab)); }
  } else if (chainName.includes("Superconductor")) {
    let alloy = (barVal + barVal) * 1.20;
    let useAlloy = p.duplicator ? alloy * 0.50 : alloy;
    let sup = (useAlloy + 150) * 3.0;
    s.push(step("SUPERCONDUCTOR (" + (p.duplicator ? "1 ore w/ dup" : "2 ores") + ")", "", "", "section"));
    s.push(stepCombine("2 Bars → Alloy Furnace", "x1.2", alloy));
    if (p.duplicator) s.push(stepDup("DUPLICATOR on Alloy", "2 at 50% (saves 1 ore)", useAlloy));
    s.push(stepPlain("Stone → Crush → Clay → Ceramic", "→ $150", 150));
    s.push(stepCombine("Alloy + Ceramic → Superconductor", "x3.0", sup));
    if (hasQA) { sup *= 1.20; s.push(stepMult("Quality Assurance", "x1.2", sup)); }
    if (hasDS) { sup *= 2; s.push(stepSell("Double Seller", "x2", sup)); }
  } else if (chainName.includes("Power Core")) {
    let alloy = (barVal + barVal) * 1.20;
    let sup = (alloy + 150) * 3.0;
    let coil = barVal + 20;
    let electro = (coil + casing) * 1.50;
    let pc = (casing + sup + electro) * 2.50;
    s.push(step("POWER CORE (10 ores)", "", "", "section"));
    s.push(stepCombine("Ores 1-4 → Casing", "x1.3", casing));
    s.push(stepCombine("Ores 5-6 → Alloy Furnace", "x1.2", alloy));
    s.push(stepCombine("  + Ceramic → Superconductor", "x3.0", sup));
    s.push(stepFlat("Ore 7 → Bar → Coiler", "+$20 → Coil", coil));
    s.push(stepCombine("Ores 8-10 → 2nd Casing", "x1.3", casing));
    s.push(stepCombine("  Coil + Casing → Electromagnet", "x1.5", electro));
    s.push(stepCombine("Casing + Super + Electro → Core", "x2.5", pc));
    if (hasQA) { pc *= 1.20; s.push(stepMult("Quality Assurance", "x1.2", pc)); }
    if (hasDS) { pc *= 2; s.push(stepSell("Double Seller", "x2", pc)); }
  } else if (chainName.includes("Explosives")) {
    let exp = casing * 3;
    s.push(step("EXPLOSIVES (5 ores)", "", "", "section"));
    s.push(stepCombine("Ores 1-4 → Casing", "x1.3", casing));
    s.push(stepPlain("Stone → Crush → Dust", "→ Metal + Stone Dust", 1));
    s.push(stepFlat("  Blasting Powder Chamber", "→ Powder $2", 2));
    s.push(stepFlat("  Blasting Powder Refiner", "+$1 (once)", 3));
    s.push(stepCombine("Casing x Powder → Explosives", "MULTIPLY", exp));
    if (hasQA) { exp *= 1.20; s.push(stepMult("Quality Assurance", "x1.2", exp)); }
    if (hasDS) { exp *= 2; s.push(stepSell("Double Seller", "x2", exp)); }
  }

  if (p.nanoSifter) s.push(stepFlat("Nano Sifter (stone→dust→ore→back to Ore Cleaner)", "+bonus/ore", optimizer.nanoBonus()));
  return s.join("");
}

// Flow diagram helpers - no arrows for normal flow, just colored left borders
function step(name, effect, value, type = "") {
  const valStr = value === "" ? "" : (typeof value === "number" ? formatMoney(value) : value);
  if (type === "section") return `<div class="flow-section">${name}</div>`;
  return `<div class="flow-step s-${type}"><span class="flow-machine">${name}</span><span class="flow-effect">${effect}</span><span class="flow-value">${valStr}</span></div>`;
}

function stepFlat(name, effect, val) { return step(name, effect, val, "flat"); }
function stepMult(name, effect, val) { return step(name, effect, val, "mult"); }
function stepLoop(name, effect, val) { return step(name, effect, val, "loop"); }
function stepCombine(name, effect, val) { return step(name, effect, val, "combine"); }
function stepDup(name, effect, val) { return step(name, effect, val, "dup"); }
function stepSell(name, effect, val) { return step(name, effect, val, "sell"); }
function stepPlain(name, effect, val) { return step(name, effect, val, ""); }

// Wrap loop-back steps in a group with right-side arrow
function loopGroup(steps) {
  // Mark the last step in the group for the bottom dot
  steps = steps.replace(/flow-step s-loop"(?!.*flow-step s-loop")/, 'flow-step s-loop flow-loop-end"');
  return `<div class="flow-loop-group">${steps}</div>`;
}

// Color legend shown at top of each breakdown
function flowLegend() {
  return `<div class="flow-legend">
    <span class="flow-legend-item"><span class="flow-legend-color c-flat"></span>Flat bonus</span>
    <span class="flow-legend-item"><span class="flow-legend-color c-mult"></span>Multiplier</span>
    <span class="flow-legend-item"><span class="flow-legend-color c-combine"></span>Combine</span>
    <span class="flow-legend-item"><span class="flow-legend-color c-loop"></span>Side path</span>
    <span class="flow-legend-item"><span class="flow-legend-color c-dup"></span>Duplicator</span>
  </div>`;
}

function renderIncomeEstimate(results, outputBelts, oreCount) {
  const grid = $("#income-grid");
  grid.innerHTML = "";

  if (results.length === 0) return;

  const best = results[0];
  // Estimate ~8 items/min per belt as a reasonable conveyor speed
  const itemsPerMin = outputBelts * 8;
  const perMin = best.avgPerOre * itemsPerMin;
  const perHour = perMin * 60;

  const nextPrestigeCost = getPrestigeCost(1); // First prestige = $20M

  const cards = [
    { label: "Avg Per Ore", value: formatMoney(best.avgPerOre), note: `${best.chain}` },
    { label: "Per Minute", value: formatMoney(perMin), note: `${outputBelts} belt${outputBelts > 1 ? "s" : ""} (~${itemsPerMin} items/min)` },
    { label: "Per Hour", value: formatMoney(perHour), note: `${oreCount} ore types in range` },
    { label: `Time to ${formatMoney(nextPrestigeCost)}`, value: perHour > 0 ? formatTime(nextPrestigeCost / perHour * 60) : "N/A", note: "Next prestige" },
  ];

  cards.forEach(c => {
    const div = document.createElement("div");
    div.className = "income-card";
    div.innerHTML = `
      <div class="income-label">${c.label}</div>
      <div class="income-value">${c.value}</div>
      <div class="income-note">${c.note}</div>
    `;
    grid.appendChild(div);
  });
}

function formatTime(minutes) {
  if (minutes < 60) return `${minutes.toFixed(0)} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} hrs`;
  return `${(minutes / 1440).toFixed(1)} days`;
}

// Database rendering
function initDatabase() {
  renderOreTable();
  renderGemTable();
  renderMachineGrid();
  renderEquipment();
}

function renderOreTable() {
  const tbody = $("#ore-table tbody");
  ORES.forEach(ore => {
    // Calculate best processed value (clean + polish + infuse + smelt + temper + QA)
    let bestVal = (ore.value + 10 + 10) * 1.25 * 1.20 * 2.00 * 1.20;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${ore.name}</td>
      <td class="value-cell">$${ore.value.toLocaleString()}</td>
      <td class="mono">${ore.depth}</td>
      <td class="mono">${ore.hardness}</td>
      <td class="value-cell">${formatMoney(bestVal)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderGemTable() {
  const tbody = $("#gem-table tbody");
  GEMS.forEach(gem => {
    const rarityClass = `rarity-${gem.rarity.toLowerCase().replace(/ /g, "-")}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${gem.name}</td>
      <td class="value-cell">$${gem.value.toLocaleString()}</td>
      <td class="mono">${gem.depth}</td>
      <td class="mono">${gem.hardness}</td>
      <td class="${rarityClass}">${gem.rarity}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderMachineGrid() {
  const grid = $("#machine-grid");
  grid.innerHTML = "";

  Object.entries(MACHINES).forEach(([id, machine]) => {
    const card = document.createElement("div");
    card.className = "machine-card";
    card.dataset.category = machine.category;

    let costStr;
    if (machine.cost !== null && machine.cost !== undefined) {
      costStr = formatMoney(machine.cost);
    } else if (machine.medals) {
      costStr = `${machine.medals} Medal${machine.medals > 1 ? "s" : ""}`;
    } else {
      costStr = "Free";
    }

    let multiplierStr = "";
    if (machine.effect === "multiply" || machine.effect === "multiply_combined") {
      multiplierStr = `<span class="machine-multiplier">${machine.value}x multiplier</span>`;
    } else if (machine.effect === "percent") {
      multiplierStr = `<span class="machine-multiplier">+${(machine.value * 100).toFixed(0)}%</span>`;
    } else if (machine.effect === "flat" && machine.value) {
      multiplierStr = `<span class="machine-multiplier">+$${machine.value}</span>`;
    } else if (machine.effect === "multiplicative") {
      multiplierStr = `<span class="machine-multiplier">A x B (multiplicative)</span>`;
    }

    card.innerHTML = `
      <div class="machine-card-header">
        <span class="machine-name">${machine.name}</span>
        <span class="machine-cost ${machine.medals ? "medal-cell" : "cost-cell"}">${costStr}</span>
      </div>
      <span class="machine-category cat-${machine.category}">${machine.category}</span>
      <div class="machine-desc">${machine.desc}</div>
      ${multiplierStr}
      ${machine.size ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.25rem">Size: ${machine.size}</div>` : ""}
    `;
    grid.appendChild(card);
  });
}

function filterMachines(category) {
  $$(".machine-card").forEach(card => {
    if (category === "all" || card.dataset.category === category) {
      card.style.display = "";
    } else {
      card.style.display = "none";
    }
  });
}

function renderEquipment() {
  // Pickaxes
  const pickTbody = $("#pickaxe-table tbody");
  PICKAXES.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name}</td>
      <td class="cost-cell">${p.cost === 0 ? "Free" : formatMoney(p.cost)}</td>
      <td class="mono">${p.hardness}</td>
    `;
    pickTbody.appendChild(tr);
  });

  // Backpacks
  const bpTbody = $("#backpack-table tbody");
  BACKPACKS.forEach(b => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${b.name}</td>
      <td class="cost-cell">${b.robux ? `${b.robux} Robux` : b.cost === 0 ? "Free" : formatMoney(b.cost)}</td>
      <td class="mono">${b.capacity}</td>
    `;
    bpTbody.appendChild(tr);
  });

  // Vehicles
  const vTbody = $("#vehicle-table tbody");
  VEHICLES.forEach(v => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${v.name}</td>
      <td class="cost-cell">${v.medals ? `${v.medals} Medals` : v.cost === 0 ? "Free" : formatMoney(v.cost)}</td>
      <td class="mono">${v.capacity}</td>
      <td>${v.type}</td>
    `;
    vTbody.appendChild(tr);
  });

  // Unloader
  const uTbody = $("#unloader-table tbody");
  UNLOADER_LEVELS.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${u.level}</td>
      <td class="cost-cell">${u.cost === 0 ? "Free" : formatMoney(u.cost)}</td>
      <td class="mono">${u.capacity}</td>
    `;
    uTbody.appendChild(tr);
  });
}

// Backpack-related keywords to filter out
const BACKPACK_KEYWORDS = ["backpack", "Backpack"];

function isBackpackItem(text) {
  return BACKPACK_KEYWORDS.some(kw => text.includes(kw));
}

// Speedrun
function initSpeedrun() { renderSpeedrun(); }

function renderSpeedrun() {
  const container = $("#speedrun-steps");
  container.innerHTML = "";
  const hasXXL = $("#xxl-backpack").checked;
  const steps = optimizer.getFreshPrestigePath();

  steps.forEach((step, idx) => {
    let actions = step.actions;
    if (hasXXL) {
      actions = actions.filter(a => !isBackpackItem(a));
    }
    if (actions.length === 0) return;

    const card = document.createElement("div");
    card.className = "phase-card";
    card.dataset.phase = `PHASE ${idx + 1}`;

    card.innerHTML = `
      <div class="phase-header">
        <span class="phase-title">${step.phase.split(": ")[1] || step.phase}</span>
        <div class="phase-meta">
          <span>${step.budget}</span>
          <span>${step.time}</span>
        </div>
      </div>
      <ul class="phase-actions">
        ${actions.map(a => `<li>${a}</li>`).join("")}
      </ul>
    `;
    container.appendChild(card);
  });
}

// Progression
function initProgression() { renderProgression(); }

function renderProgression() {
  const container = $("#progression-stages");
  container.innerHTML = "";
  const hasXXL = $("#xxl-backpack").checked;

  PROGRESSION_STAGES.forEach(stage => {
    let priority = stage.priority;
    let tips = stage.tips;
    if (hasXXL) {
      priority = priority.filter(p => !isBackpackItem(p));
    }

    const card = document.createElement("div");
    card.className = "stage-card";

    card.innerHTML = `
      <div class="stage-header">
        <span class="stage-name">${stage.name}</span>
        <span class="stage-budget">${stage.budget}</span>
      </div>
      <div class="stage-tips">${tips}</div>
      <div class="stage-priority">
        <h4>Priority Purchases</h4>
        <div class="priority-list">
          ${priority.map(p => `<span class="priority-item">${p}</span>`).join("")}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Prestige cost table
// === FACTORY BUILDER ===
let builderChain = []; // array of machine IDs in order
let builderFilter = "all";

function initBuilder() {
  const list = $("#builder-machine-list");
  const catContainer = $("#builder-categories");
  const searchInput = $("#builder-search");
  const oreSelect = $("#builder-ore-select");

  // Populate ore selector
  ORES.forEach(ore => {
    const opt = document.createElement("option");
    opt.value = ore.value;
    opt.textContent = `${ore.name} ($${ore.value})`;
    oreSelect.appendChild(opt);
  });
  oreSelect.value = "350"; // default Gold
  oreSelect.addEventListener("change", updateBuilderValue);

  // Category filter buttons
  const categories = ["all", ...new Set(Object.values(MACHINES).map(m => m.category))];
  categories.forEach(cat => {
    const btn = document.createElement("button");
    btn.className = "builder-cat-btn" + (cat === "all" ? " active" : "");
    btn.textContent = cat;
    btn.style.borderLeftColor = CATEGORY_COLORS[cat] || "transparent";
    btn.addEventListener("click", () => {
      $$(".builder-cat-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      builderFilter = cat;
      renderBuilderMachines();
    });
    catContainer.appendChild(btn);
  });

  // Search
  searchInput.addEventListener("input", renderBuilderMachines);

  // Clear button
  $("#builder-clear").addEventListener("click", () => {
    builderChain = [];
    renderBuilderChain();
    updateBuilderValue();
  });

  renderBuilderMachines();
}

function renderBuilderMachines() {
  const list = $("#builder-machine-list");
  const search = ($("#builder-search")?.value || "").toLowerCase();
  list.innerHTML = "";

  Object.entries(MACHINES).forEach(([id, m]) => {
    if (builderFilter !== "all" && m.category !== builderFilter) return;
    if (search && !m.name.toLowerCase().includes(search)) return;

    const item = document.createElement("div");
    item.className = "builder-machine-item";

    let effectStr = "";
    if (m.effect === "flat") effectStr = `+$${m.value}`;
    else if (m.effect === "multiply" || m.effect === "combine") effectStr = `x${m.value}`;
    else if (m.effect === "percent") effectStr = `+${(m.value * 100).toFixed(0)}%`;
    else if (m.effect === "set") effectStr = `=$${m.value}`;
    else if (m.effect === "multiplicative") effectStr = "A×B";
    else if (m.effect === "chance") effectStr = `${(m.value * 100).toFixed(1)}%`;
    else effectStr = m.effect || "";

    const color = CATEGORY_COLORS[m.category] || "#6b7280";
    const costStr = m.cost ? formatMoney(m.cost) : m.medals ? `${m.medals}M` : "Free";

    item.innerHTML = `
      <div class="bm-cat" style="background:${color}"></div>
      <div style="flex:1">
        <div class="bm-name">${m.name}</div>
        <div style="font-size:0.65rem;color:var(--text-muted)">${costStr} | ${m.desc || ""}</div>
      </div>
      <div class="bm-effect">${effectStr}</div>
    `;

    item.addEventListener("click", () => {
      builderChain.push(id);
      updateBuilderValue();
    });

    list.appendChild(item);
  });
}

function renderBuilderChain() {
  const container = $("#builder-chain");
  // Keep the start node, remove everything else
  const startNode = container.querySelector(".builder-start-node");
  container.innerHTML = "";
  container.appendChild(startNode);

  const oreVal = parseInt($("#builder-ore-select").value) || 350;
  let currentVal = oreVal;
  let currentType = "ore";

  builderChain.forEach((machineId, idx) => {
    const m = MACHINES[machineId];
    if (!m) return;

    // Calculate value effect
    switch (m.effect) {
      case "flat": currentVal += m.value; break;
      case "percent": currentVal *= (1 + m.value); break;
      case "multiply": currentVal *= m.value; break;
      case "combine": currentVal *= m.value; break; // simplified - combines assume same value inputs
      case "set": currentVal = m.value; break;
    }

    if (m.outputType && m.outputType !== "same") currentType = m.outputType;
    const typeLabel = ITEM_TYPES[currentType] || currentType;
    const color = CATEGORY_COLORS[m.category] || "#6b7280";

    const node = document.createElement("div");
    node.className = "builder-node";
    node.style.borderLeftColor = color;
    node.style.background = color + "15";
    node.innerHTML = `
      <span class="bn-name">${m.name}</span>
      <span class="bn-val">${formatMoney(currentVal)}</span>
      <span class="bn-type">${typeLabel}</span>
    `;

    // Click to remove
    node.addEventListener("click", () => {
      builderChain.splice(idx, 1);
      updateBuilderValue();
    });

    container.appendChild(node);
  });
}

function updateBuilderValue() {
  const oreVal = parseInt($("#builder-ore-select").value) || 350;
  let val = oreVal;

  for (const machineId of builderChain) {
    const m = MACHINES[machineId];
    if (!m) continue;
    switch (m.effect) {
      case "flat": val += m.value; break;
      case "percent": val *= (1 + m.value); break;
      case "multiply": val *= m.value; break;
      case "combine": val *= m.value; break;
      case "set": val = m.value; break;
    }
  }

  $("#builder-value").textContent = formatMoney(val);

  // Update inline summary in topbar
  const inline = $("#builder-summary-inline");
  if (builderChain.length > 0) {
    const totalCost = builderChain.reduce((sum, id) => sum + (MACHINES[id]?.cost || 0), 0);
    const multiplier = val / oreVal;
    inline.innerHTML = `
      <span><span class="bsi-label">Mult: </span><span class="bsi-mult">${multiplier.toFixed(2)}x</span></span>
      <span><span class="bsi-label">Cost: </span><span class="bsi-cost">${formatMoney(totalCost)}</span></span>
      <span><span class="bsi-label">Machines: </span><span class="bsi-value">${builderChain.length}</span></span>
    `;
  } else {
    inline.innerHTML = "";
  }

  // Render graph in canvas
  const canvas = $("#builder-graph");
  if (builderChain.length > 0) {
    canvas.querySelector(".builder-empty-hint")?.remove();
    const graph = buildBuilderGraph(oreVal);
    graphVisualizer.render(graph, canvas);
  } else {
    canvas.innerHTML = '<div class="builder-empty-hint">Click machines from the sidebar to build your factory chain</div>';
  }
}

function buildBuilderGraph(oreVal) {
  const nodes = [];
  const edges = [];
  let id = 0;
  let val = oreVal;
  let currentType = "ore";

  const oreNode = { id: id++, name: "Ore Input", type: "ore", value: oreVal, category: "source", layer: 0 };
  nodes.push(oreNode);
  let prevNode = oreNode;

  builderChain.forEach((machineId, idx) => {
    const m = MACHINES[machineId];
    if (!m) return;

    switch (m.effect) {
      case "flat": val += m.value; break;
      case "percent": val *= (1 + m.value); break;
      case "multiply": val *= m.value; break;
      case "combine": val *= m.value; break;
      case "set": val = m.value; break;
    }

    const outType = (m.outputType && m.outputType !== "same") ? m.outputType : currentType;
    const node = { id: id++, name: m.name, type: outType, value: val, category: m.category, layer: idx + 1 };
    nodes.push(node);
    edges.push({ from: prevNode.id, to: node.id, itemType: currentType });

    // Byproducts
    if (m.byproducts) {
      m.byproducts.forEach(bp => {
        const bpNode = { id: id++, name: ITEM_TYPES[bp] || bp, type: bp, value: 0, category: "stonework", layer: idx + 1 };
        nodes.push(bpNode);
        edges.push({ from: node.id, to: bpNode.id, itemType: bp, dashed: true });
      });
    }

    currentType = outType;
    prevNode = node;
  });

  // Final sell node
  if (builderChain.length > 0) {
    const sellNode = { id: id++, name: "Seller", type: currentType, value: val, category: "source", layer: builderChain.length + 1 };
    nodes.push(sellNode);
    edges.push({ from: prevNode.id, to: sellNode.id, itemType: currentType });
  }

  return { nodes, edges };
}

function initPrestigeCosts() {
  const tbody = $("#prestige-cost-table");
  for (let i = 1; i <= 15; i++) {
    const cost = getPrestigeCost(i);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${i}</td>
      <td class="cost-cell">${formatMoney(cost)}</td>
      <td class="medal-cell">${i}</td>
    `;
    tbody.appendChild(tr);
  }
}
