// UMT Factory Optimizer - Application Logic

const optimizer = new FactoryOptimizer();
const STORAGE_KEY = "umt-optimizer-config";

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Prestige spinner +/- buttons
function adjustPrestige(inputId, delta) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const min = parseInt(input.min) || 0;
  const max = parseInt(input.max) || 20;
  const current = parseInt(input.value) || 0;
  input.value = Math.max(min, Math.min(max, current + delta));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

// Starting Money: shows dollar amount ($250 per level)
function adjustStartMoney(delta) {
  const hidden = document.getElementById("starting-money-level");
  const display = document.getElementById("starting-money-display");
  if (!hidden || !display) return;
  const current = parseInt(hidden.value) || 0;
  const newVal = Math.max(0, current + delta);
  hidden.value = newVal;
  display.value = "$" + (newVal * 250).toLocaleString();
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

function updateStartMoneyDisplay() {
  const hidden = document.getElementById("starting-money-level");
  const display = document.getElementById("starting-money-display");
  if (hidden && display) {
    display.value = "$" + ((parseInt(hidden.value) || 0) * 250).toLocaleString();
  }
}

// --- localStorage persistence ---
function saveConfig() {
  const config = {
    budget: $("#budget").value,
    zoneSelect: $("#zone-select").value,
    depthMin: $("#depth-min").value,
    depthMax: $("#depth-max").value,
    oreQuantity: $("#ore-quantity").value,
    oreSelect: $("#ore-select").value,
    doubleSeller: $("#double-seller").checked,
    theoreticalMax: $("#theoretical-max").checked,
    startingMoneyLevel: $("#starting-money-level")?.value || "0",
    prestigeItems: {},
  };
  // Save prestige items from header
  $$(".prestige-header-item input[type='number']").forEach(inp => {
    if (inp.id) config.prestigeItems[inp.id] = inp.value;
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
    if (config.oreQuantity) $("#ore-quantity").value = config.oreQuantity;
    if (config.oreSelect && config.oreSelect !== "all") {
      $("#ore-select").value = config.oreSelect;
    }
    if (config.doubleSeller) $("#double-seller").checked = config.doubleSeller;
    if (config.theoreticalMax) $("#theoretical-max").checked = config.theoreticalMax;
    if (config.startingMoneyLevel) {
      const sml = $("#starting-money-level");
      if (sml) sml.value = config.startingMoneyLevel;
    }

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

    // Prestige upgrades removed (only Starting Money kept in header)
  } catch(e) {}
}

// Tab navigation
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initZoneSelect();
  attachEvents();

  // Load saved config BEFORE rendering content that depends on it
  loadConfig();
  updateStartMoneyDisplay();

  // Now render content that reads checkbox/input state
  initDatabase();
  // Factory Builder removed

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

  // Populate ore selector grouped by zone
  const oreSelect = $("#ore-select");
  // Group ores by zone
  const zones = {};
  ORES.forEach(ore => {
    const zone = getLayerName(ore.depthMin) || "Unknown";
    if (!zones[zone]) zones[zone] = [];
    zones[zone].push(ore);
  });
  // Add ores grouped by zone
  for (const [zone, ores] of Object.entries(zones)) {
    const group = document.createElement("optgroup");
    group.label = zone;
    ores.sort((a, b) => a.value - b.value).forEach(ore => {
      const opt = document.createElement("option");
      opt.value = `ore:${ore.name}`;
      opt.textContent = `${ore.name} ($${ore.value.toLocaleString()})`;
      group.appendChild(opt);
    });
    oreSelect.appendChild(group);
  }
  // Add gems in separate group
  if (typeof GEMS !== "undefined" && GEMS.length > 0) {
    const gemGroup = document.createElement("optgroup");
    gemGroup.label = "Gems";
    GEMS.sort((a, b) => a.value - b.value).forEach(gem => {
      const opt = document.createElement("option");
      opt.value = `gem:${gem.name}`;
      opt.textContent = `${gem.name} ($${gem.value.toLocaleString()})`;
      gemGroup.appendChild(opt);
    });
    oreSelect.appendChild(gemGroup);
  }
  oreSelect.addEventListener("change", () => {
    saveConfig();
    // Show ore info immediately when selected
    const val = oreSelect.value;
    if (val) {
      const [type, name] = val.split(":");
      const ore = type === "ore" ? ORES.find(o => o.name === name) : GEMS?.find(g => g.name === name);
      if (ore) renderOreSummary(ore);
      if (machineRegistry) runOptimizer(false);
    }
  });
}

function applyZone(value) {
  if (value === "custom") return;
  const [min, max] = value.split("-").map(Number);
  $("#depth-min").value = min;
  $("#depth-max").value = max;
}

function attachEvents() {
  // Optimize button removed - all inputs auto-update
  $("#budget").addEventListener("input", () => {
    $("#budget-display").textContent = formatMoney(parseInt($("#budget").value) || 0);
    saveConfig();
    if (machineRegistry) runOptimizer(false);
  });
  $("#theoretical-max").addEventListener("change", () => {
    saveConfig();
    if (machineRegistry) runOptimizer(false);
  });
  $("#zone-select").addEventListener("change", (e) => {
    applyZone(e.target.value);
    saveConfig();
  });
  $("#ore-quantity").addEventListener("input", () => {
    saveConfig();
    if (machineRegistry) runOptimizer(false);
  });
  $("#double-seller").addEventListener("change", () => {
    saveConfig();
    if (machineRegistry) { runOptimizer(false); renderProgression(); }
  });
  // Header prestige items - save on change + re-render all
  $$(".prestige-header-item input").forEach(inp => {
    inp.addEventListener("change", () => {
      saveConfig();
      updateStartMoneyDisplay();
      if (machineRegistry) { runOptimizer(false); renderProgression(); }
    });
  });
  // Switch to "Custom" when manually editing depths
  $("#depth-min").addEventListener("input", () => {
    $("#zone-select").value = "custom";
    saveConfig();
  });
  $("#depth-max").addEventListener("input", () => {
    $("#zone-select").value = "custom";
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

// initPrestigeUpgrades removed - only Starting Money kept in header

function runOptimizer(scrollToResults = false) {
  const theoreticalMax = $("#theoretical-max").checked;
  const budget = theoreticalMax ? 999999999 : (parseInt($("#budget").value) || 0);
  const minDepth = parseInt($("#depth-min").value) || 0;
  let maxDepth = parseInt($("#depth-max").value) || 0;
  // outputBelts removed - income estimate was inaccurate
  const oreQuantity = parseInt($("#ore-quantity")?.value) || 0;
  const hasDoubleSeller = theoreticalMax ? true : $("#double-seller").checked;

  // Clamp max >= min
  if (maxDepth < minDepth) {
    maxDepth = minDepth;
    $("#depth-max").value = maxDepth;
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

  // Get selected ore
  const oreSelectVal = $("#ore-select")?.value || "";
  if (!oreSelectVal || oreSelectVal === "all") {
    $("#chain-results").innerHTML = '<div class="chain-card">Select an ore to optimize.</div>';
    $("#optimizer-results").classList.remove("hidden");
    return;
  }

  const [type, name] = oreSelectVal.split(":");
  const selectedOre = type === "ore"
    ? ORES.find(o => o.name === name)
    : GEMS?.find(g => g.name === name);

  if (!selectedOre) {
    $("#chain-results").innerHTML = '<div class="chain-card">Ore not found.</div>';
    $("#optimizer-results").classList.remove("hidden");
    return;
  }

  // Show selected ore info
  renderOreSummary(selectedOre);

  // Run optimizer for this specific ore
  const results = optimizer.getBestChain(selectedOre, budget);

  // Calculate batch profit if ore quantity set
  const chainResults = results.map(result => {
    const batches = oreQuantity > 0 && result.oresNeeded > 0
      ? Math.floor(oreQuantity / result.oresNeeded)
      : 0;
    const batchProfit = batches * (result.value || result.totalValue || 0);

    return {
      ...result,
      avgPerOre: result.perOre,
      batchProfit,
      batches,
      oreQuantity,
    };
  });

  // Sort by total batch profit if ore quantity set, otherwise per-ore
  if (oreQuantity > 0) {
    chainResults.sort((a, b) => b.batchProfit - a.batchProfit);
  } else {
    chainResults.sort((a, b) => b.perOre - a.perOre);
  }

  renderChainResults(chainResults, [selectedOre]);

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

function renderOreSummary(ore) {
  const hint = $("#ore-info");
  if (!hint) return;
  const layer = ore.depthMin !== undefined ? getLayerName(ore.depthMin) : '';
  const depth = ore.depthMin !== undefined ? `${ore.depthMin}-${ore.depthMax}m` : '';
  const parts = [layer, depth].filter(Boolean);
  hint.textContent = parts.length > 0 ? parts.join(' | ') : '';
}

function renderChainResults(results, oresAtDepth) {
  const container = $("#chain-results");
  container.innerHTML = "";

  results.forEach((result, idx) => {
    const card = document.createElement("div");
    card.className = `chain-card${idx === 0 ? " best" : ""}`;

    const graphId = `graph-${idx}`;

    const showBatch = result.oreQuantity > 0 && result.batchProfit > 0;
    const batchHtml = showBatch
      ? `<div class="chain-detail" style="color:#22c55e">Batch (${result.oreQuantity} ores): <strong>${formatMoney(result.batchProfit)}</strong> (${result.batches} products)</div>`
      : "";

    card.innerHTML = `
      <div class="chain-header">
        <span class="chain-name">${result.chain}</span>
        <span class="chain-value">${showBatch ? formatMoney(result.batchProfit) + ' <small>total</small>' : formatMoney(result.perOre) + ' <small>/ore</small>'}</span>
      </div>
      <div class="chain-details">
        <div class="chain-detail">Per Ore: <strong>${formatMoney(result.perOre)}</strong></div>
        <div class="chain-detail">Setup Cost: <strong>${formatMoney(result.cost)}</strong></div>
        <div class="chain-detail">Ores/Product: <strong>${result.productQty > 1 ? Math.round(result.oresNeeded / result.productQty) + " (" + result.oresNeeded + " ores → " + result.productQty + " products)" : result.oresNeeded}</strong></div>
        ${result.usesDup ? '<div class="chain-detail" style="color:#f472b6">Duplicator active</div>' : ""}
        ${batchHtml}
      </div>
      ${result.graph ? `
        <button class="chain-breakdown-toggle" onclick="toggleGraph('${graphId}', this)">View Graph</button>
        <div class="graph-container hidden" id="${graphId}"></div>
      ` : ""}
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

// renderIncomeEstimate and formatTime removed - income estimates were inaccurate

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


// Generate progression stages dynamically from machine costs
function generateProgressionStages() {
  if (!machineRegistry) return [{ name: "Start", budgetMax: 0, ore: "Tin", oreVal: 10, desc: "Loading..." }];

  // Get all machine costs, sorted
  const machineCosts = [];
  for (const [id, m] of machineRegistry.machines) {
    if (m.cost && m.cost > 0 && !m.medals) {
      machineCosts.push({ id, name: m.name, cost: m.cost });
    }
  }
  machineCosts.sort((a, b) => a.cost - b.cost);

  if (machineCosts.length === 0) return [];

  // Define budget tiers at natural breakpoints
  // Use logarithmic spacing: each tier is roughly 5-10x the previous
  const tiers = [];
  const startingMoney = (parseInt($("#starting-money-level")?.value) || 0) * 250;

  // Stage 0: Starting money only (no mining yet)
  if (startingMoney > 0) {
    tiers.push({ budgetMax: startingMoney, name: "Starting Budget" });
  }

  // Find natural breakpoints where significant machines become available
  const breakpoints = [500, 2000, 5000, 15000, 50000, 150000, 500000, 1500000, 5000000, 20000000];

  for (const bp of breakpoints) {
    // Only add if there are NEW machines in this range vs previous
    const prevBudget = tiers.length > 0 ? tiers[tiers.length - 1].budgetMax : 0;
    const newMachines = machineCosts.filter(m => m.cost > prevBudget && m.cost <= bp);
    if (newMachines.length > 0) {
      // Name the stage after the most expensive new machine
      const keyMachine = newMachines[newMachines.length - 1];
      tiers.push({ budgetMax: bp, keyMachine: keyMachine.name });
    }
  }

  // Convert tiers to stages with appropriate ore
  const stageNames = ["Bootstrap", "Early Setup", "Basic Chains", "Mid Game",
    "Advanced", "Late Game", "Mega Factories", "Pre-Prestige", "Endgame", "Max"];

  return tiers.map((tier, idx) => {
    // Find best ore for this budget level
    // Cheap ores for early game, expensive for late
    const budget = tier.budgetMax;
    let ore, oreVal;
    if (budget <= 1000) { ore = "Tin"; oreVal = 10; }
    else if (budget <= 5000) { ore = "Lead"; oreVal = 30; }
    else if (budget <= 20000) { ore = "Cobalt"; oreVal = 50; }
    else if (budget <= 100000) { ore = "Silver"; oreVal = 150; }
    else if (budget <= 500000) { ore = "Gold"; oreVal = 350; }
    else if (budget <= 2000000) { ore = "Titanium"; oreVal = 500; }
    else { ore = "Mithril"; oreVal = 2000; }

    const name = tier.name || stageNames[Math.min(idx, stageNames.length - 1)];
    const desc = tier.keyMachine
      ? `${tier.keyMachine} now affordable`
      : "Start with prestige items and starting money";

    return { name, budgetMax: budget, ore, oreVal, desc };
  });
}

// Progression (combined speedrun + upgrade paths)
function renderProgression() {
  const container = $("#progression-stages");
  if (!container) return;
  container.innerHTML = "";

  // Generate stages dynamically from machine costs
  // Group machines into natural budget tiers
  const stages = generateProgressionStages();

  // Read current prestige config from header
  const currentPrestige = {
    philosophersStone: (parseInt($("#has-philosophers-stone")?.value) || 0) > 0,
    nanoSifter: (parseInt($("#has-nano-sifter")?.value) || 0) > 0,
    oreUpgrader: (parseInt($("#has-ore-upgrader")?.value) || 0) > 0,
    duplicator: (parseInt($("#has-duplicator")?.value) || 0) > 0,
    transmuters: (parseInt($("#has-transmuters")?.value) || 0) > 0,
  };
  const hasDoubleSeller = $("#double-seller")?.checked || false;
  const startingMoney = (parseInt($("#starting-money-level")?.value) || 0) * 250;

  let prevMachines = new Set();

  // Pre-compute ALL stages' results to check upgrade path compatibility
  const allStageResults = stages.map(stage => {
    const stageConfig = {
      budget: stage.budgetMax + startingMoney,
      hasDoubleSeller,
      prestigeItems: currentPrestige,
    };
    const flowOpt = new FlowOptimizer(machineRegistry, stageConfig);
    return flowOpt.discoverAll(stage.oreVal);
  });

  stages.forEach((stage, idx) => {
    const results = allStageResults[idx];

    // Pick best chain that builds toward the NEXT stage
    // Score: value/ore × upgrade_efficiency
    // upgrade_efficiency = how many of this stage's machines are reused in the next stage
    let best = null;
    if (results.length > 0) {
      const nextResults = idx < stages.length - 1 ? allStageResults[idx + 1] : null;
      const nextBestMachines = new Set();
      if (nextResults?.[0]?.graph) {
        nextResults[0].graph.nodes.forEach(n => {
          if (n.name && !n.isByproduct) nextBestMachines.add(n.name);
        });
      }

      let bestScore = -1;
      for (const result of results.slice(0, 5)) { // Check top 5 chains
        const thisMachines = new Set();
        if (result.graph) {
          result.graph.nodes.forEach(n => {
            if (n.name && !n.isByproduct) thisMachines.add(n.name);
          });
        }

        // Reuse score: what % of this stage's machines are in the next stage?
        let reuse = 0;
        if (nextBestMachines.size > 0) {
          thisMachines.forEach(m => { if (nextBestMachines.has(m)) reuse++; });
          reuse = thisMachines.size > 0 ? reuse / thisMachines.size : 0;
        } else {
          reuse = 1; // Last stage, no next to compare
        }

        // Score = per-ore value × (0.5 + 0.5 × reuse)
        // Reuse gives up to 50% bonus. A chain with 80% reuse at 90% value beats
        // a chain with 0% reuse at 100% value.
        const score = result.perOre * (0.5 + 0.5 * reuse);
        if (score > bestScore) {
          bestScore = score;
          best = result;
        }
      }
    }

    // Extract machines used in this chain from graph nodes
    const currentMachines = new Set();
    let totalCost = 0;
    const skipMachines = new Set(["ore_source", "seller", "secondary_output", "sell_excess", "byproduct_source"]);
    if (best?.graph) {
      best.graph.nodes.forEach(n => {
        // Use the machine field from graph nodes (set by fromFlowChain)
        const machineId = n.machineId || n.machine;
        if (machineId && !skipMachines.has(machineId) && !machineId.startsWith("excess_")) {
          currentMachines.add(machineId);
        }
      });
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
      ${best?.graph ? `<div class="stage-graph-container graph-container" id="stage-graph-${idx}"></div>` : ''}
    `;
    container.appendChild(card);

    // Render graph using shared GraphVisualizer (same as Factory Optimizer)
    if (best?.graph) {
      const graphContainer = card.querySelector(`#stage-graph-${idx}`);
      if (graphContainer) {
        graphVisualizer.render(best.graph, graphContainer);
        // Scale down for progression view
        const svg = graphContainer.querySelector('svg');
        if (svg) {
          svg.style.height = Math.min(parseInt(svg.style.height) || 300, 250) + 'px';
        }
      }
    }

    // Update previous machines for next stage
    prevMachines = new Set([...prevMachines, ...currentMachines]);
  });

  // Prestige cost table
  renderPrestigeCostTable();
}
function renderPrestigeCostTable() {
  const tbody = $("#prestige-cost-table");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (let i = 1; i <= 10; i++) {
    const cost = getPrestigeCost(i);
    const row = document.createElement("tr");
    row.innerHTML = `<td>${i}</td><td>${formatMoney(cost)}</td><td>${i}</td>`;
    tbody.appendChild(row);
  }
}

// Prestige cost table
// === FACTORY BUILDER ===

