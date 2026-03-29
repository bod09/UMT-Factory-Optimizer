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
    oreQuantity: $("#ore-quantity").value,
    oreSelect: $("#ore-select").value,
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
    if (config.oreQuantity) $("#ore-quantity").value = config.oreQuantity;
    if (config.oreSelect) {
      $("#ore-select").value = config.oreSelect;
      // Trigger the change handler to update UI state
      const depthDisabled = config.oreSelect !== "all";
      $("#depth-min").disabled = depthDisabled;
      $("#depth-max").disabled = depthDisabled;
      $("#zone-select").disabled = depthDisabled;
      $("#ore-select-hint").textContent = depthDisabled ? "Overrides depth" : "Uses depth range";
    }
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
  initBuilder();

  // Load machine registry from machines.json, then run optimizer + progression
  loadMachineRegistry().then(() => {
    runOptimizer(false);
    renderProgression();
  }).catch(() => {
    runOptimizer(false);
    renderProgression();
  });
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
  select.value = "550-849";
  applyZone("550-849");

  // Populate ore selector
  const oreSelect = $("#ore-select");
  ORES.forEach(ore => {
    const opt = document.createElement("option");
    opt.value = `ore:${ore.name}`;
    opt.textContent = `${ore.name} ($${ore.value.toLocaleString()})`;
    oreSelect.appendChild(opt);
  });
  if (typeof GEMS !== "undefined") {
    GEMS.forEach(gem => {
      const opt = document.createElement("option");
      opt.value = `gem:${gem.name}`;
      opt.textContent = `${gem.name} ($${gem.value.toLocaleString()})`;
      oreSelect.appendChild(opt);
    });
  }
  oreSelect.addEventListener("change", () => {
    const val = oreSelect.value;
    const depthDisabled = val !== "all";
    $("#depth-min").disabled = depthDisabled;
    $("#depth-max").disabled = depthDisabled;
    $("#zone-select").disabled = depthDisabled;
    $("#ore-select-hint").textContent = depthDisabled ? "Overrides depth" : "Uses depth range";
    saveConfig();
  });
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
  $("#ore-quantity").addEventListener("input", saveConfig);
  $("#double-seller").addEventListener("change", saveConfig);
  $("#xxl-backpack").addEventListener("change", () => {
    saveConfig();
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
  const oreQuantity = parseInt($("#ore-quantity")?.value) || 0;
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

  // Check if specific ore is selected
  const oreSelectVal = $("#ore-select")?.value || "all";
  let oresAtDepth, gemsAtDepth;

  if (oreSelectVal !== "all") {
    const [type, name] = oreSelectVal.split(":");
    if (type === "ore") {
      const ore = ORES.find(o => o.name === name);
      oresAtDepth = ore ? [ore] : [];
      gemsAtDepth = [];
    } else {
      const gem = GEMS?.find(g => g.name === name);
      oresAtDepth = gem ? [gem] : [];
      gemsAtDepth = [];
    }
  } else {
    oresAtDepth = getOresAtDepth(minDepth, maxDepth);
    gemsAtDepth = getGemsAtDepth(minDepth, maxDepth);
  }

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
          productQty: result.productQty || 1,
          graph: result.graph || null,
          usesDup: result.usesDup || false,
          oreBreakdown: [],
          totalValue: 0,
          totalPerOre: 0,
        });
      }
      const entry = chainMap.get(result.chain);
      // Use the graph with the most nodes (most complete chain)
      // Earlier ores might skip machines (e.g., max tier ore skips Ore Upgrader)
      if (result.graph && (!entry.graph || result.graph.nodes.length > entry.graph.nodes.length)) {
        entry.graph = result.graph;
        // Also update productQty and oresNeeded to match this graph's source
        if (result.productQty) entry.productQty = result.productQty;
        if (result.oresNeeded) entry.oresNeeded = result.oresNeeded;
      }
      entry.oreBreakdown.push({ ore: ore.name, value: result.value || result.totalValue, perOre: result.perOre, baseValue: ore.value });
      entry.totalValue += (result.value || result.totalValue || 0);
      entry.totalPerOre += result.perOre;
    }
  }

  // Calculate averages and sort
  const aggregated = [...chainMap.values()].map(entry => {
    const avgPerOre = entry.totalPerOre / entry.oreBreakdown.length;
    // If ore quantity set, calculate total profit for that many ores
    // Total batches = floor(oreQuantity / oresNeeded), total profit = batches * value per batch
    const batches = oreQuantity > 0 && entry.oresNeeded > 0
      ? Math.floor(oreQuantity / entry.oresNeeded)
      : 0;
    const totalBatchProfit = batches * (entry.totalValue / entry.oreBreakdown.length);

    return {
      ...entry,
      avgValue: entry.totalValue / entry.oreBreakdown.length,
      avgPerOre,
      minValue: Math.min(...entry.oreBreakdown.map(o => o.perOre)),
      maxValue: Math.max(...entry.oreBreakdown.map(o => o.perOre)),
      batchProfit: totalBatchProfit,
      batches,
      oreQuantity,
    };
  });

  // Sort by total batch profit if ore quantity set, otherwise per-ore
  if (oreQuantity > 0) {
    aggregated.sort((a, b) => b.batchProfit - a.batchProfit);
  } else {
    aggregated.sort((a, b) => b.avgPerOre - a.avgPerOre);
  }

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

    const showBatch = result.oreQuantity > 0 && result.batchProfit > 0;
    const batchHtml = showBatch
      ? `<div class="chain-detail" style="color:#22c55e">Batch (${result.oreQuantity} ores): <strong>${formatMoney(result.batchProfit)}</strong> (${result.batches} products)</div>`
      : "";

    card.innerHTML = `
      <div class="chain-header">
        <span class="chain-name">${result.chain}</span>
        <span class="chain-value">${showBatch ? formatMoney(result.batchProfit) + ' <small>total</small>' : formatMoney(result.avgPerOre || result.perOre) + ' <small>avg/ore</small>'}</span>
        ${idx === 0 ? '<span class="best-badge">BEST</span>' : ''}
      </div>
      <div class="chain-details">
        <div class="chain-detail">Per Ore: <strong>${formatMoney(result.avgPerOre || result.perOre)}</strong></div>
        <div class="chain-detail">Range: <strong>${result.minValue ? formatMoney(result.minValue) + " - " + formatMoney(result.maxValue) : formatMoney(result.perOre)}</strong></div>
        <div class="chain-detail">Setup Cost: <strong>${formatMoney(result.cost)}</strong></div>
        <div class="chain-detail">Ores/Product: <strong>${result.productQty > 1 ? (result.oresNeeded / result.productQty) + " (" + result.oresNeeded + " ores → " + result.productQty + " products)" : result.oresNeeded}</strong></div>
        ${result.usesDup ? '<div class="chain-detail" style="color:#f472b6">Duplicator active</div>' : ""}
        ${batchHtml}
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
          // Scale quantities by batch count if ore batch size is set
          const graphToRender = result.graph;
          if (result.batches > 1 && graphToRender.nodes) {
            for (const node of graphToRender.nodes) {
              if (node.quantity) node.quantity *= result.batches;
            }
          }
          graphVisualizer.render(graphToRender, graphEl);
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


// Dead code removed: _unused_getChainBreakdown, flowLegend, isBackpackItem, initPrestigeCosts

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
  renderConnections();
}

function renderConnections() {
  const grid = $("#connections-grid");
  if (!grid) return;
  grid.innerHTML = "";

  // Try to load from machines.json for the most up-to-date data
  fetch("data/machines.json").then(r => r.json()).then(data => {
    renderConnectionsFromData(grid, data.machines);
  }).catch(() => {
    // Fallback to in-memory MACHINES
    renderConnectionsFromMemory(grid);
  });
}

function renderConnectionsFromData(grid, machines) {
  grid.innerHTML = "";
  Object.entries(machines).forEach(([id, m]) => {
    const color = CATEGORY_COLORS[m.category] || "#6b7280";
    const inputs = (m.inputs || []).map(t => {
      return t.split("|").map(p => ITEM_TYPES[p] || p).join(" / ");
    }).join(" + ");

    let effectStr = "";
    if (m.effect === "flat") effectStr = `+$${m.value}`;
    else if (m.effect === "multiply" || m.effect === "combine") effectStr = `x${m.value}`;
    else if (m.effect === "percent") effectStr = `+${(m.value * 100).toFixed(0)}%`;
    else if (m.effect === "set") effectStr = `=$${m.value}`;
    else if (m.effect === "multiplicative") effectStr = "A × B";
    else if (m.effect === "chance") effectStr = `${(m.value * 100).toFixed(1)}%`;
    else effectStr = m.effect || "";

    const costStr = m.cost ? formatMoney(m.cost) : m.medals ? `${m.medals} Medals` : "Free";

    // Build outputs + byproducts
    let outputsHtml = "";
    if (m.outputs && m.outputs.length > 0) {
      m.outputs.forEach((out, i) => {
        const label = m.outputs.length > 1 ? `Output ${i + 1}:` : "Output:";
        const typeLabel = ITEM_TYPES[out.type] || out.type;
        const chanceStr = out.chance < 1.0 ? ` (${(out.chance * 100).toFixed(1)}%)` : "";
        outputsHtml += `<div class="conn-row"><span class="conn-label">${label}</span> <span class="conn-types conn-output">${typeLabel}${chanceStr}</span> <span style="color:var(--text-muted);font-size:0.65rem">${out.desc || ""}</span></div>`;
      });
    }
    if (m.byproducts && m.byproducts.length > 0) {
      m.byproducts.forEach((bp) => {
        const typeLabel = ITEM_TYPES[bp.type] || bp.type;
        const chanceStr = bp.chance < 1.0 ? ` (${(bp.chance * 100).toFixed(1)}%)` : "";
        outputsHtml += `<div class="conn-row"><span class="conn-label">Byproduct:</span> <span class="conn-types conn-byproduct">${typeLabel}${chanceStr}</span> <span style="color:var(--text-muted);font-size:0.65rem">${bp.desc || ""}</span></div>`;
      });
    }

    const card = document.createElement("div");
    card.className = "connection-card";
    card.innerHTML = `
      <div class="conn-header" style="border-left:3px solid ${color}">
        <strong>${m.name}</strong>
        <span class="conn-effect">${effectStr}</span>
      </div>
      <div class="conn-row"><span class="conn-label">Cost:</span> <span class="conn-types" style="color:var(--accent)">${costStr}</span></div>
      <div class="conn-row"><span class="conn-label">Inputs:</span> <span class="conn-types">${inputs || "Any"}</span></div>
      ${outputsHtml}
      ${m.tag ? `<div class="conn-row"><span class="conn-label">Tag:</span> <span class="conn-tag">${m.tag}</span></div>` : ""}
      ${m.size ? `<div class="conn-row"><span class="conn-label">Size:</span> <span style="color:var(--text-muted)">${m.size}</span></div>` : ""}
    `;
    grid.appendChild(card);
  });
}

function renderConnectionsFromMemory(grid) {
  grid.innerHTML = "";
  Object.entries(MACHINES).forEach(([id, m]) => {
    const color = CATEGORY_COLORS[m.category] || "#6b7280";
    const inputs = (m.inputTypes || []).map(t => t.split("|").map(p => ITEM_TYPES[p] || p).join(" / ")).join(" + ");
    const output = ITEM_TYPES[m.outputType] || m.outputType || "Same";

    let effectStr = "";
    if (m.effect === "flat") effectStr = `+$${m.value}`;
    else if (m.effect === "multiply" || m.effect === "combine") effectStr = `x${m.value}`;
    else if (m.effect === "percent") effectStr = `+${(m.value * 100).toFixed(0)}%`;
    else if (m.effect === "set") effectStr = `=$${m.value}`;
    else if (m.effect === "multiplicative") effectStr = "A × B";
    else if (m.effect === "chance") effectStr = `${(m.value * 100).toFixed(1)}%`;
    else effectStr = m.effect || "";

    const card = document.createElement("div");
    card.className = "connection-card";
    card.innerHTML = `
      <div class="conn-header" style="border-left:3px solid ${color}"><strong>${m.name}</strong><span class="conn-effect">${effectStr}</span></div>
      <div class="conn-row"><span class="conn-label">Inputs:</span> <span class="conn-types">${inputs || "Any"}</span></div>
      <div class="conn-row"><span class="conn-label">Output:</span> <span class="conn-types conn-output">${output}</span></div>
      ${m.tag ? `<div class="conn-row"><span class="conn-label">Tag:</span> <span class="conn-tag">${m.tag}</span></div>` : ""}
    `;
    grid.appendChild(card);
  });
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


// Progression (combined speedrun + upgrade paths)
function renderProgression() {
  const container = $("#progression-stages");
  if (!container) return;
  container.innerHTML = "";

  // Define budget stages - each builds on previous
  const stages = [
    { name: "Bootstrap", budgetMax: 500, ore: "Tin", oreVal: 10, desc: "Mine surface ores, sell with basic processing" },
    { name: "Smelting Setup", budgetMax: 5000, ore: "Lead", oreVal: 30, desc: "Smelt ores into bars for 1.2x value" },
    { name: "Early Chains", budgetMax: 50000, ore: "Silver", oreVal: 150, desc: "Build bolt/plate chains, start frame production" },
    { name: "Mid Game", budgetMax: 500000, ore: "Gold", oreVal: 350, desc: "Tempering Forge doubles bar value, build casing chain" },
    { name: "Advanced", budgetMax: 2000000, ore: "Titanium", oreVal: 500, desc: "Engine, Superconductor, and multi-input factories" },
    { name: "Mega Factories", budgetMax: 10000000, ore: "Mithril", oreVal: 3000, desc: "Power Core, Tablet, Laser - maximize per-ore value" },
    { name: "Push to Prestige", budgetMax: 20000000, ore: "Mithril", oreVal: 3000, desc: "Maximize throughput, reach $20M to prestige" },
  ];

  let prevMachines = new Set();

  stages.forEach((stage, idx) => {
    // Use FlowOptimizer at this budget to find best chain
    const stageConfig = {
      budget: stage.budgetMax,
      hasDoubleSeller: false, // no double seller until post-prestige
      prestigeItems: {},
    };
    const flowOpt = new FlowOptimizer(machineRegistry, stageConfig);
    const results = flowOpt.discoverAll(stage.oreVal);

    // Get best chain that fits budget
    const best = results.length > 0 ? results[0] : null;

    // Extract machines used in this chain
    const currentMachines = new Set();
    let totalCost = 0;
    if (best?.graph) {
      best.graph.nodes.forEach(n => {
        const m = machineRegistry.get(n.machineId);
        if (m && n.machineId !== "ore_source" && n.machineId !== "seller" &&
            !n.machineId.startsWith("byproduct") && !n.machineId.startsWith("sifted")) {
          currentMachines.add(n.machineId);
        }
      });
    }
    // Also extract from recipe tree if graph is missing
    if (best?.recipeTree) {
      const extractMachines = (node) => {
        if (!node) return;
        if (node.machine && node.machine !== "ore_source" && node.machine !== "seller") {
          currentMachines.add(node.machine);
        }
        if (node.inputs) node.inputs.forEach(extractMachines);
      };
      extractMachines(best.recipeTree);
    }

    // Calculate what's NEW this stage
    const newMachines = [];
    currentMachines.forEach(id => {
      if (!prevMachines.has(id)) {
        const m = machineRegistry.get(id);
        if (m) {
          newMachines.push({ id, name: m.name, cost: m.cost || 0 });
          totalCost += m.cost || 0;
        }
      }
    });
    newMachines.sort((a, b) => a.cost - b.cost);

    // Build card
    const card = document.createElement("div");
    card.className = "stage-card";
    card.dataset.phase = `STAGE ${idx + 1}`;

    const bestChainName = best ? best.chain : "Direct Sell";
    const bestPerOre = best ? formatMoney(best.perOre) : formatMoney(stage.oreVal);

    card.innerHTML = `
      <div class="stage-header">
        <span class="stage-name">${stage.name}</span>
        <div class="stage-meta">
          <span class="stage-budget">Budget: ${formatMoney(stage.budgetMax)}</span>
          <span class="stage-ore">Mining: ${stage.ore}</span>
        </div>
      </div>
      <div class="stage-desc">${stage.desc}</div>
      <div class="stage-best">
        <span class="stage-best-label">Best Chain:</span>
        <span class="stage-best-chain">${bestChainName}</span>
        <span class="stage-best-value">${bestPerOre}/ore</span>
      </div>
      ${newMachines.length > 0 ? `
        <div class="stage-purchases">
          <h4>New Machines to Buy</h4>
          <div class="priority-list">
            ${newMachines.map(m => `<span class="priority-item">${m.name} (${formatMoney(m.cost)})</span>`).join("")}
          </div>
        </div>
      ` : ""}
      <div class="stage-graph-container" id="stage-graph-${idx}"></div>
    `;
    container.appendChild(card);

    // Render mini graph if available
    if (best?.graph) {
      const graphContainer = card.querySelector(`#stage-graph-${idx}`);
      renderProgressionGraph(graphContainer, best.graph);
    }

    // Update previous machines for next stage
    prevMachines = new Set([...prevMachines, ...currentMachines]);
  });

  // Prestige cost table
  renderPrestigeCostTable();
}

function renderProgressionGraph(container, graphData) {
  if (!container || !graphData || !graphData.nodes.length) return;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "progression-graph");

  const nodeWidth = 110;
  const nodeHeight = 36;
  const gapX = 20;
  const gapY = 44;

  // Use the layer property for horizontal positioning
  // Separate byproduct nodes (stonework category) to bottom row
  const isByproduct = (n) => n.category === "stonework" || n.name?.includes("Byproduct") || n.name?.includes("Sell Excess");
  const mainNodes = graphData.nodes.filter(n => !isByproduct(n));
  const byproductNodes = graphData.nodes.filter(n => isByproduct(n));

  // Sort main nodes by layer for left-to-right flow
  mainNodes.sort((a, b) => (a.layer || 0) - (b.layer || 0));
  byproductNodes.sort((a, b) => (a.layer || 0) - (b.layer || 0));

  mainNodes.forEach((node, i) => {
    node._x = i * (nodeWidth + gapX) + 10;
    node._y = 10;
  });

  byproductNodes.forEach((node, i) => {
    node._x = i * (nodeWidth + gapX) + 10;
    node._y = nodeHeight + gapY + 10;
  });

  const allNodes = [...mainNodes, ...byproductNodes];
  const totalWidth = Math.max(
    mainNodes.length * (nodeWidth + gapX) + 20,
    byproductNodes.length * (nodeWidth + gapX) + 20,
    200
  );
  const totalHeight = byproductNodes.length > 0 ? nodeHeight * 2 + gapY + 30 : nodeHeight + 30;

  svg.setAttribute("viewBox", `0 0 ${totalWidth} ${totalHeight}`);
  svg.style.width = "100%";
  svg.style.height = `${Math.min(totalHeight, 120)}px`;

  // Draw edges
  graphData.edges.forEach(edge => {
    const fromNode = allNodes.find(n => n.id === edge.from);
    const toNode = allNodes.find(n => n.id === edge.to);
    if (!fromNode || !toNode) return;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", fromNode._x + nodeWidth);
    line.setAttribute("y1", fromNode._y + nodeHeight / 2);
    line.setAttribute("x2", toNode._x);
    line.setAttribute("y2", toNode._y + nodeHeight / 2);
    line.setAttribute("stroke", isByproduct(fromNode) || isByproduct(toNode) ? "#f59e0b44" : "#4b556388");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);
  });

  // Category colors
  const catColors = {
    metalwork: "#3b82f6", stonework: "#6b7280", glasswork: "#22c55e",
    electronics: "#06b6d4", jewelcrafting: "#a855f7", explosives: "#ef4444",
    multipurpose: "#10b981", prestige: "#f59e0b", source: "#6b7280"
  };

  // Draw nodes
  allNodes.forEach(node => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const color = catColors[node.category] || "#6b7280";

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", node._x);
    rect.setAttribute("y", node._y);
    rect.setAttribute("width", nodeWidth);
    rect.setAttribute("height", nodeHeight);
    rect.setAttribute("rx", 4);
    rect.setAttribute("fill", "#1e293b");
    rect.setAttribute("stroke", color);
    rect.setAttribute("stroke-width", 1);
    g.appendChild(rect);

    // Top accent line
    const accent = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    accent.setAttribute("x", node._x);
    accent.setAttribute("y", node._y);
    accent.setAttribute("width", nodeWidth);
    accent.setAttribute("height", 3);
    accent.setAttribute("fill", color);
    g.appendChild(accent);

    // Machine name
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", node._x + 5);
    text.setAttribute("y", node._y + 16);
    text.setAttribute("fill", "#e2e8f0");
    text.setAttribute("font-size", "8");
    text.setAttribute("font-family", "Inter, sans-serif");
    text.setAttribute("font-weight", "600");
    text.textContent = (node.name || "?").substring(0, 18);
    g.appendChild(text);

    // Output type + value
    const typeName = ITEM_TYPES[node.type] || node.type || "";
    const valStr = node.value ? formatMoney(node.value) : "";
    const sub = document.createElementNS("http://www.w3.org/2000/svg", "text");
    sub.setAttribute("x", node._x + 5);
    sub.setAttribute("y", node._y + 28);
    sub.setAttribute("fill", "#9ca3b4");
    sub.setAttribute("font-size", "7");
    sub.setAttribute("font-family", "Inter, sans-serif");
    sub.textContent = typeName;
    g.appendChild(sub);

    if (valStr) {
      const val = document.createElementNS("http://www.w3.org/2000/svg", "text");
      val.setAttribute("x", node._x + nodeWidth - 5);
      val.setAttribute("y", node._y + 28);
      val.setAttribute("text-anchor", "end");
      val.setAttribute("fill", "#22c55e");
      val.setAttribute("font-size", "7");
      val.setAttribute("font-weight", "600");
      val.setAttribute("font-family", "JetBrains Mono, monospace");
      val.textContent = valStr;
      g.appendChild(val);
    }

    // Quantity badge
    if (node.quantity && node.quantity > 1) {
      const badge = document.createElementNS("http://www.w3.org/2000/svg", "text");
      badge.setAttribute("x", node._x + nodeWidth - 3);
      badge.setAttribute("y", node._y + 12);
      badge.setAttribute("text-anchor", "end");
      badge.setAttribute("fill", "#f59e0b");
      badge.setAttribute("font-size", "7");
      badge.setAttribute("font-weight", "700");
      badge.textContent = `x${node.quantity}`;
      g.appendChild(badge);
    }

    svg.appendChild(g);
  });

  container.appendChild(svg);
}

function renderPrestigeCostTable() {
  const tbody = $("#prestige-cost-table");
  if (!tbody) return;
  tbody.innerHTML = "";
  let totalMedals = 0;
  for (let i = 1; i <= 10; i++) {
    totalMedals += i;
    const cost = getPrestigeCost(i);
    const row = document.createElement("tr");
    row.innerHTML = `<td>${i}</td><td>${formatMoney(cost)}</td><td>${totalMedals}</td>`;
    tbody.appendChild(row);
  }
}

// Prestige cost table
// === FACTORY BUILDER ===
let builderChain = []; // array of machine IDs in order
let builderFilter = "all";
let builderSelectedNode = -1; // index of selected node in chain, -1 = none
let builderSelectedPills = new Set(); // multiselect indices
let builderDragIdx = -1; // index being dragged

function initBuilder() {
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
  oreSelect.value = "350";
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
      builderSelectedNode = -1;
      renderBuilderMachines();
    });
    catContainer.appendChild(btn);
  });

  searchInput.addEventListener("input", renderBuilderMachines);

  // Clear button
  $("#builder-clear").addEventListener("click", () => {
    builderChain = [];
    builderSelectedNode = -1;
    builderSelectedPills.clear();
    updateBuilderValue();
  });

  initBuilderDragDrop();
  renderBuilderMachines();
}

// Get the output type of a machine (or the chain up to that point)
function getBuilderOutputType(chainIndex) {
  let currentType = "ore";
  for (let i = 0; i <= chainIndex && i < builderChain.length; i++) {
    const m = MACHINES[builderChain[i]];
    if (m && m.outputType && m.outputType !== "same") currentType = m.outputType;
  }
  return currentType;
}

function renderBuilderMachines() {
  const list = $("#builder-machine-list");
  const search = ($("#builder-search")?.value || "").toLowerCase();
  list.innerHTML = "";

  // Determine filter type based on selected node or last in chain
  let filterType = null;
  if (builderSelectedNode >= 0) {
    filterType = getBuilderOutputType(builderSelectedNode);
  } else if (builderChain.length > 0) {
    filterType = getBuilderOutputType(builderChain.length - 1);
  }

  // Show filter indicator if filtering
  if (filterType) {
    const hint = document.createElement("div");
    hint.style.cssText = "padding:0.4rem;font-size:0.7rem;color:var(--accent);text-align:center;cursor:pointer;border-bottom:1px solid var(--border);margin-bottom:0.3rem";
    hint.innerHTML = `Showing: accepts <strong>${ITEM_TYPES[filterType] || filterType}</strong> <span style="color:var(--text-muted)">(click to show all)</span>`;
    hint.addEventListener("click", () => { builderSelectedNode = -2; renderBuilderMachines(); }); // -2 = force show all
    list.appendChild(hint);
  }

  Object.entries(MACHINES).forEach(([id, m]) => {
    if (builderFilter !== "all" && m.category !== builderFilter) return;
    if (search && !m.name.toLowerCase().includes(search)) return;

    // Filter by compatibility when a node is selected (not when -2 = show all)
    if (filterType && builderSelectedNode !== -2 && m.inputTypes) {
      const accepts = m.inputTypes.some(t => {
        if (t === "any") return true;
        return t.split("|").some(sub => sub === filterType);
      });
      if (!accepts) return;
    }

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
      if (builderSelectedNode >= 0) {
        builderChain.splice(builderSelectedNode + 1, 0, id);
        builderSelectedNode++;
      } else {
        builderChain.push(id);
      }
      updateBuilderValue();
      renderBuilderMachines(); // refresh filter for new last node
    });

    list.appendChild(item);
  });
}

function renderChainStrip() {
  const container = $("#chain-strip-items");
  const trash = $("#chain-strip-trash");
  container.innerHTML = "";

  const oreVal = parseInt($("#builder-ore-select").value) || 350;
  let val = oreVal;

  builderChain.forEach((machineId, idx) => {
    const m = MACHINES[machineId];
    if (!m) return;

    // Calculate running value
    switch (m.effect) {
      case "flat": val += m.value; break;
      case "percent": val *= (1 + m.value); break;
      case "multiply": val *= m.value; break;
      case "combine": val *= m.value; break;
      case "set": val = m.value; break;
    }

    // Arrow between pills
    if (idx > 0) {
      const arrow = document.createElement("span");
      arrow.className = "chain-strip-arrow";
      arrow.textContent = "→";
      container.appendChild(arrow);
    }

    const pill = document.createElement("div");
    pill.className = "chain-pill";
    if (builderSelectedPills.has(idx)) pill.classList.add("selected");
    pill.dataset.idx = idx;

    const color = CATEGORY_COLORS[m.category] || "#6b7280";
    pill.innerHTML = `<div class="cp-color" style="background:${color}"></div><span class="cp-name">${m.name}</span><span class="cp-val">${formatMoney(val)}</span>`;

    // Click: select/deselect (shift = multiselect)
    pill.addEventListener("click", (e) => {
      if (pill.dataset.wasDragged) { delete pill.dataset.wasDragged; return; }
      if (e.shiftKey) {
        if (builderSelectedPills.has(idx)) builderSelectedPills.delete(idx);
        else builderSelectedPills.add(idx);
      } else {
        if (builderSelectedPills.has(idx) && builderSelectedPills.size === 1) {
          builderSelectedPills.clear();
          builderSelectedNode = -1;
        } else {
          builderSelectedPills.clear();
          builderSelectedPills.add(idx);
          builderSelectedNode = idx;
        }
      }
      renderChainStrip();
      renderBuilderMachines();
    });

    // Custom mouse-based drag
    pill.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let isDragging = false;

      const onMove = (me) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        if (!isDragging && Math.abs(dx) + Math.abs(dy) > 5) {
          isDragging = true;
          pill.classList.add("dragging");
          builderDragIdx = idx;
        }
        if (isDragging) {
          // Check if over trash
          const trashRect = trash.getBoundingClientRect();
          if (me.clientX >= trashRect.left && me.clientX <= trashRect.right &&
              me.clientY >= trashRect.top && me.clientY <= trashRect.bottom) {
            trash.classList.add("drag-over");
          } else {
            trash.classList.remove("drag-over");
          }
          // Check which pill we're over for reorder
          const allPills = container.querySelectorAll(".chain-pill");
          allPills.forEach(p => p.style.borderLeftColor = "");
          for (const p of allPills) {
            const r = p.getBoundingClientRect();
            if (me.clientX >= r.left && me.clientX <= r.right && p !== pill) {
              p.style.borderLeftColor = "var(--accent)";
              p.style.borderLeftWidth = "3px";
              break;
            }
          }
        }
      };

      const onUp = (me) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        pill.classList.remove("dragging");
        trash.classList.remove("drag-over");
        container.querySelectorAll(".chain-pill").forEach(p => { p.style.borderLeftColor = ""; p.style.borderLeftWidth = ""; });

        if (!isDragging) return;
        pill.dataset.wasDragged = "true"; // prevent click from firing

        // Check if dropped on trash
        const trashRect = trash.getBoundingClientRect();
        if (me.clientX >= trashRect.left && me.clientX <= trashRect.right &&
            me.clientY >= trashRect.top && me.clientY <= trashRect.bottom) {
          if (builderSelectedPills.size > 1 && builderSelectedPills.has(idx)) {
            const selected = [...builderSelectedPills].sort((a, b) => b - a);
            for (const i of selected) builderChain.splice(i, 1);
            builderSelectedPills.clear();
          } else {
            builderChain.splice(idx, 1);
          }
          builderSelectedNode = -1;
          updateBuilderValue();
          return;
        }

        // Check if dropped on another pill (reorder)
        const allPills = container.querySelectorAll(".chain-pill");
        for (const p of allPills) {
          const targetIdx = parseInt(p.dataset.idx);
          if (isNaN(targetIdx) || targetIdx === idx) continue;
          const r = p.getBoundingClientRect();
          if (me.clientX >= r.left && me.clientX <= r.right) {
            const [item] = builderChain.splice(idx, 1);
            const insertAt = idx < targetIdx ? targetIdx : targetIdx;
            builderChain.splice(insertAt, 0, item);
            updateBuilderValue();
            return;
          }
        }

        builderDragIdx = -1;
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    container.appendChild(pill);
  });
}

// Set up trash bin and keyboard handlers ONCE
function initBuilderDragDrop() {
  const trash = $("#chain-strip-trash");
  if (!trash || trash.dataset.bound) return;
  trash.dataset.bound = "true";

  trash.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    trash.classList.add("drag-over");
  });

  trash.addEventListener("dragleave", () => {
    trash.classList.remove("drag-over");
  });

  trash.addEventListener("drop", (e) => {
    e.preventDefault();
    trash.classList.remove("drag-over");
    const fromIdx = parseInt(e.dataTransfer.getData("text/plain"));

    if (builderSelectedPills.size > 1 && builderSelectedPills.has(fromIdx)) {
      const selected = [...builderSelectedPills].sort((a, b) => b - a);
      for (const i of selected) builderChain.splice(i, 1);
      builderSelectedPills.clear();
    } else if (!isNaN(fromIdx)) {
      builderChain.splice(fromIdx, 1);
    }
    builderSelectedNode = -1;
    updateBuilderValue();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      if (builderSelectedPills.size > 0 && document.getElementById("tab-builder")?.classList.contains("active")) {
        e.preventDefault();
        const selected = [...builderSelectedPills].sort((a, b) => b - a);
        for (const i of selected) builderChain.splice(i, 1);
        builderSelectedPills.clear();
        builderSelectedNode = -1;
        updateBuilderValue();
      }
    }
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

    // Add drag + click handlers to SVG graph nodes
    const svgNodes = canvas.querySelectorAll(".graph-node");
    const svg = canvas.querySelector("svg");
    const trash = $("#chain-strip-trash");

    svgNodes.forEach(nodeEl => {
      const nodeIdx = parseInt(nodeEl.dataset?.chainIdx);
      if (isNaN(nodeIdx) || nodeIdx < 0) return;

      nodeEl.style.cursor = "grab";

      nodeEl.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        let isDragging = false;
        let ghost = null;
        let dropIndicator = null;
        let dropTargetIdx = -1;

        const onMove = (me) => {
          const dx = me.clientX - startX;
          const dy = me.clientY - startY;

          if (!isDragging && Math.abs(dx) + Math.abs(dy) > 5) {
            isDragging = true;
            nodeEl.style.opacity = "0.3";
            document.body.style.cursor = "grabbing";

            // Ghost label
            ghost = document.createElement("div");
            ghost.style.cssText = "position:fixed;pointer-events:none;z-index:1000;padding:4px 10px;background:#222632;border:2px solid #f59e0b;border-radius:6px;font-size:12px;color:#e8eaf0;font-family:monospace;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.4);";
            ghost.textContent = MACHINES[builderChain[nodeIdx]]?.name || "Node";
            document.body.appendChild(ghost);

            // SVG drop indicator (dotted rect)
            dropIndicator = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            dropIndicator.setAttribute("width", "160");
            dropIndicator.setAttribute("height", "52");
            dropIndicator.setAttribute("rx", "6");
            dropIndicator.setAttribute("fill", "none");
            dropIndicator.setAttribute("stroke", "#f59e0b");
            dropIndicator.setAttribute("stroke-width", "2");
            dropIndicator.setAttribute("stroke-dasharray", "6 4");
            dropIndicator.style.display = "none";
            svg.appendChild(dropIndicator);
          }

          if (isDragging && ghost) {
            ghost.style.left = (me.clientX + 14) + "px";
            ghost.style.top = (me.clientY - 14) + "px";

            // Trash highlight
            const trashRect = trash.getBoundingClientRect();
            const overTrash = me.clientX >= trashRect.left && me.clientX <= trashRect.right &&
                me.clientY >= trashRect.top && me.clientY <= trashRect.bottom;
            trash.classList.toggle("drag-over", overTrash);
            if (overTrash) ghost.style.borderColor = "#ef4444";
            else ghost.style.borderColor = "#f59e0b";

            // Find nearest drop target node and show indicator at its position
            dropTargetIdx = -1;
            dropIndicator.style.display = "none";
            svgNodes.forEach(n => {
              const rect = n.querySelector("rect");
              if (rect) { rect.setAttribute("stroke", "#333848"); rect.setAttribute("stroke-width", "1"); }
            });

            if (!overTrash) {
              for (const n of svgNodes) {
                if (n === nodeEl) continue;
                const tIdx = parseInt(n.dataset?.chainIdx);
                if (isNaN(tIdx) || tIdx < 0) continue;
                const r = n.getBoundingClientRect();
                if (me.clientX >= r.left - 20 && me.clientX <= r.right + 20 &&
                    me.clientY >= r.top - 20 && me.clientY <= r.bottom + 20) {
                  dropTargetIdx = tIdx;
                  // Show dotted indicator at this node's SVG position
                  const transform = n.getAttribute("transform");
                  const match = transform?.match(/translate\(([^,]+),\s*([^)]+)\)/);
                  if (match) {
                    dropIndicator.setAttribute("x", match[1]);
                    dropIndicator.setAttribute("y", match[2]);
                    dropIndicator.style.display = "";
                  }
                  const rect = n.querySelector("rect");
                  if (rect) { rect.setAttribute("stroke", "#f59e0b"); rect.setAttribute("stroke-width", "2"); }
                  break;
                }
              }
            }
          }
        };

        const onUp = (me) => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          nodeEl.style.opacity = "";
          document.body.style.cursor = "";
          trash.classList.remove("drag-over");
          if (ghost) { ghost.remove(); ghost = null; }
          if (dropIndicator) { dropIndicator.remove(); dropIndicator = null; }

          if (isDragging) {
            // Trash drop
            const trashRect = trash.getBoundingClientRect();
            if (me.clientX >= trashRect.left && me.clientX <= trashRect.right &&
                me.clientY >= trashRect.top && me.clientY <= trashRect.bottom) {
              builderChain.splice(nodeIdx, 1);
              builderSelectedNode = -1;
              updateBuilderValue();
              return;
            }
            // Reorder drop
            if (dropTargetIdx >= 0 && dropTargetIdx !== nodeIdx) {
              const [item] = builderChain.splice(nodeIdx, 1);
              builderChain.splice(dropTargetIdx, 0, item);
              updateBuilderValue();
              return;
            }
          } else {
            // Click = toggle selection
            builderSelectedNode = (builderSelectedNode === nodeIdx) ? -1 : nodeIdx;
            renderChainStrip();
            renderBuilderMachines();
          }
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    });
  } else {
    canvas.innerHTML = '<div class="builder-empty-hint">Click machines from the sidebar to build your factory chain</div>';
  }

  renderChainStrip();
  renderBuilderMachines();
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
    const isSelected = (builderSelectedNode === idx);
    const node = { id: id++, name: m.name, type: outType, value: val, category: m.category, layer: idx + 1, chainIdx: idx, selected: isSelected };
    nodes.push(node);
    edges.push({ from: prevNode.id, to: node.id, itemType: currentType });

    // Byproducts
    if (m.byproducts) {
      m.byproducts.forEach(bp => {
        const bpNode = { id: id++, name: ITEM_TYPES[bp] || bp, type: bp, value: 0, category: "stonework", layer: idx + 1, isByproduct: true };
        nodes.push(bpNode);
        edges.push({ from: node.id, to: bpNode.id, itemType: bp, isByproduct: true });
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

