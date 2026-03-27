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

  // Get a representative ore for breakdown (highest value in range)
  const repOre = oresAtDepth.reduce((best, o) => o.value > best.value ? o : best, oresAtDepth[0]);

  results.forEach((result, idx) => {
    const card = document.createElement("div");
    card.className = `chain-card${idx === 0 ? " best" : ""}`;

    // Show per-ore breakdown
    const oreBreakdownHtml = result.oreBreakdown
      .sort((a, b) => b.perOre - a.perOre)
      .map(ob => `<span class="ore-breakdown-item"><strong>${ob.ore}</strong> ${formatMoney(ob.perOre)}</span>`)
      .join("");

    // Generate machine chain breakdown for the representative ore
    const chainBreakdown = getChainBreakdown(result.chain, repOre);
    const breakdownId = `breakdown-${idx}`;

    card.innerHTML = `
      <div class="chain-header">
        <span class="chain-name">${result.chain}</span>
        <span class="chain-value">${formatMoney(result.avgPerOre)} <small>avg/ore</small></span>
      </div>
      <div class="chain-details">
        <div class="chain-detail">Range: <strong>${formatMoney(result.minValue)} - ${formatMoney(result.maxValue)}</strong></div>
        <div class="chain-detail">Setup Cost: <strong>${formatMoney(result.cost)}</strong></div>
        <div class="chain-detail">Ores/Product: <strong>${result.oresNeeded}</strong></div>
        ${result.medals ? `<div class="chain-detail">Medals: <strong class="medal-cell">${result.medals}</strong></div>` : ""}
      </div>
      ${chainBreakdown ? `
        <button class="chain-breakdown-toggle" onclick="document.getElementById('${breakdownId}').classList.toggle('open')">Show breakdown (${repOre.name} $${repOre.value})</button>
        <div class="chain-breakdown" id="${breakdownId}">${chainBreakdown}</div>
      ` : ""}
      <div class="ore-breakdown">${oreBreakdownHtml}</div>
    `;
    container.appendChild(card);
  });
}

function getChainBreakdown(chainName, ore) {
  const p = optimizer.prestigeItems;
  const hasDS = optimizer.hasDoubleSeller;
  const hasQA = optimizer.budget >= 2000000;
  const hasDup = p.duplicator;
  const hasTrans = p.transmuters;

  let oreVal = optimizer.getEffectiveOreValue(ore);
  const wasUpgraded = oreVal !== ore.value;

  // Direct sell
  if (chainName.includes("Direct")) {
    let steps = [];
    let v = ore.value;
    steps.push(stepRow("Base ore", "", v));
    if (wasUpgraded) { v = oreVal; steps.push(stepRow("Ore Upgrader", "→ next tier", v)); }
    if (hasDS) { v *= 2; steps.push(stepRow("Double Seller", "x2", v)); }
    return steps.join("");
  }

  // Processed Bar (simple chain with all prestige items)
  if (chainName.includes("Processed")) {
    let steps = [];
    let v = ore.value;
    steps.push(stepRow("Base ore", "", v));
    if (wasUpgraded) { v = oreVal; steps.push(stepRow("Ore Upgrader", "→ next tier", v)); }

    if (hasDup) {
      let half = v * 0.5;
      steps.push(stepRow("Duplicator (2 copies)", "x0.5 each", half));
      let pc = half + 10 + 10;
      steps.push(stepRow("Each: Clean + Polish", "+$20", pc));
      if (p.philosophersStone) { pc *= 1.25; steps.push(stepRow("Each: Philosopher's Stone", "x1.25", pc)); }
      pc *= 1.20; steps.push(stepRow("Each: Smelt", "x1.2 → Bar", pc));
      pc *= 2.00; steps.push(stepRow("Each: Temper", "x2", pc));
      if (hasTrans) { pc *= 1.61; steps.push(stepRow("Each: Transmute loop", "x1.61", pc)); }
      if (hasQA) { pc *= 1.20; steps.push(stepRow("Each: QA", "x1.2", pc)); }
      let total = pc * 2;
      steps.push(stepRow("Total (2 copies)", "x2", total));
      if (hasDS) { total *= 2; steps.push(stepRow("Double Seller", "x2", total)); }
    } else {
      v = oreVal;
      v += 10; steps.push(stepRow("Ore Cleaner", "+$10", v));
      v += 10; steps.push(stepRow("Polisher", "+$10", v));
      if (p.philosophersStone) { v *= 1.25; steps.push(stepRow("Philosopher's Stone", "x1.25", v)); }
      v *= 1.20; steps.push(stepRow("Ore Smelter", "x1.2 → Bar", v));
      v *= 2.00; steps.push(stepRow("Tempering Forge", "x2", v));
      if (hasTrans) { v *= 1.61; steps.push(stepRow("Transmute loop", "x1.61", v)); }
      if (hasQA) { v *= 1.20; steps.push(stepRow("Quality Assurance", "x1.2", v)); }
      if (hasDS) { v *= 2; steps.push(stepRow("Double Seller", "x2", v)); }
    }
    if (p.nanoSifter) steps.push(stepRow("Nano Sifter bonus", "+byproduct", optimizer.nanoBonus()));
    return steps.join("");
  }

  // Multi-input chains
  if (chainName.includes("Engine")) return multiInputBreakdown("Engine", oreVal, p, hasQA, hasDS);
  if (chainName.includes("Tablet")) return multiInputBreakdown("Tablet", oreVal, p, hasQA, hasDS);
  if (chainName.includes("Superconductor")) return multiInputBreakdown("Superconductor", oreVal, p, hasQA, hasDS);
  if (chainName.includes("Power Core")) return multiInputBreakdown("PowerCore", oreVal, p, hasQA, hasDS);
  if (chainName.includes("Explosives")) return multiInputBreakdown("Explosives", oreVal, p, hasQA, hasDS);

  return "";
}

function stepRow(name, effect, value) {
  return `<div class="chain-step"><span class="chain-step-name">${name}</span><span class="chain-step-effect">${effect}</span><span class="chain-step-value">${formatMoney(value)}</span></div>`;
}

function multiInputBreakdown(type, oreValue, p, hasQA, hasDS) {
  let val = oreValue;
  val += 10; val += 10;
  if (p.philosophersStone) val *= 1.25;
  let rawBar = val * 1.20 * 2.00;
  let barVal = rawBar;
  if (p.transmuters) barVal *= 1.61;
  const hasDup = p.duplicator;

  let steps = [];
  steps.push(stepRow("Ore → Clean(+10) → Polish(+10)" + (p.philosophersStone ? " → Infuse(1.25x)" : ""), "", val));
  steps.push(stepRow("Smelt (x1.2) → Temper (x2)", "→ Bar", rawBar));
  if (p.transmuters) steps.push(stepRow("Transmute loop (Cut+Prismatic)", "x1.61", barVal));

  let bolts = barVal + 5, plate = barVal + 20;
  let frame = (barVal + bolts) * 1.25;
  let casing = (frame + bolts + plate) * 1.30;

  if (type === "Engine") {
    let mech = plate + 30, pipe = plate + 20;
    let engineVal = (mech + pipe + casing) * 2.50;
    steps.push(stepRow("Casing (Frame+Bolts+Plate)", "x1.3", casing));
    steps.push(stepRow("Mech Parts + Pipe", "", mech + pipe));
    steps.push(stepRow("→ Engine", "x2.5", engineVal));
    if (hasQA) { engineVal *= 1.20; steps.push(stepRow("QA", "x1.2", engineVal)); }
    if (hasDS) { engineVal *= 2; steps.push(stepRow("Double Seller", "x2", engineVal)); }
  } else if (type === "Tablet") {
    let glass = 30, coil = barVal + 20;
    let circuit = (glass + coil) * 2.00;
    let tabletVal = (casing + glass + circuit) * 3.00;
    steps.push(stepRow("Casing", "x1.3", casing));
    steps.push(stepRow("Glass (from stone dust)", "", glass));
    steps.push(stepRow("Coil + Glass → Circuit", "x2.0", circuit));
    steps.push(stepRow("→ Tablet", "x3.0", tabletVal));
    if (hasQA) { tabletVal *= 1.20; steps.push(stepRow("QA", "x1.2", tabletVal)); }
    if (hasDS) { tabletVal *= 2; steps.push(stepRow("Double Seller", "x2", tabletVal)); }
  } else if (type === "Superconductor") {
    let alloy = (barVal + barVal) * 1.20;
    let useAlloy = hasDup ? alloy * 0.50 : alloy;
    let superVal = (useAlloy + 150) * 3.00;
    steps.push(stepRow("2 Bars → Alloy", "x1.2", alloy));
    if (hasDup) steps.push(stepRow("Dup alloy (saves 1 ore, +3%)", "x0.5", useAlloy));
    steps.push(stepRow("Ceramic (from stone)", "flat", 150));
    steps.push(stepRow("→ Superconductor", "x3.0", superVal));
    if (hasQA) { superVal *= 1.20; steps.push(stepRow("QA", "x1.2", superVal)); }
    if (hasDS) { superVal *= 2; steps.push(stepRow("Double Seller", "x2", superVal)); }
  } else if (type === "PowerCore") {
    let alloy = (barVal + barVal) * 1.20;
    let superVal = (alloy + 150) * 3.00;
    let coil = barVal + 20;
    let electro = (coil + casing) * 1.50;
    let pcVal = (casing + superVal + electro) * 2.50;
    steps.push(stepRow("Casing", "x1.3", casing));
    steps.push(stepRow("Superconductor (Alloy+Ceramic)", "x3.0", superVal));
    steps.push(stepRow("Electromagnet (Coil+Casing)", "x1.5", electro));
    steps.push(stepRow("→ Power Core", "x2.5", pcVal));
    if (hasQA) { pcVal *= 1.20; steps.push(stepRow("QA", "x1.2", pcVal)); }
    if (hasDS) { pcVal *= 2; steps.push(stepRow("Double Seller", "x2", pcVal)); }
  } else if (type === "Explosives") {
    let expVal = casing * 3;
    steps.push(stepRow("Casing", "x1.3", casing));
    steps.push(stepRow("Powder ($2 + 1 refiner)", "= $3", 3));
    steps.push(stepRow("Casing × Powder → Explosives", "MULTIPLY", expVal));
    if (hasQA) { expVal *= 1.20; steps.push(stepRow("QA", "x1.2", expVal)); }
    if (hasDS) { expVal *= 2; steps.push(stepRow("Double Seller", "x2", expVal)); }
  }

  if (p.nanoSifter) steps.push(stepRow("Nano Sifter bonus", "+byproduct", optimizer.nanoBonus()));

  return steps.join("");
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
