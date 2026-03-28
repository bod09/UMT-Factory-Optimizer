// UMT Factory Optimizer - SVG Node Graph Visualizer
// Renders machine chains as interactive SVG node graphs

class GraphVisualizer {
  constructor() {
    this.nodeWidth = 160;
    this.nodeHeight = 52;
    this.layerGap = 200;
    this.nodeGap = 65;
    this.padding = 40;
  }

  // Render a chain's graph into a container element
  render(graph, container) {
    if (!graph || !graph.nodes || graph.nodes.length === 0) {
      container.innerHTML = '<div style="padding:1rem;color:#9ca3b4">No graph data available</div>';
      return;
    }

    // Layout
    const layout = this.computeLayout(graph);

    // SVG dimensions
    const maxX = Math.max(...layout.map(n => n.x)) + this.nodeWidth + this.padding * 2;
    const maxY = Math.max(...layout.map(n => n.y)) + this.nodeHeight + this.padding * 2;

    // Build SVG
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${maxX} ${maxY}`);
    svg.setAttribute("class", "chain-graph-svg");
    svg.style.width = "100%";
    svg.style.height = Math.min(maxY, 600) + "px";

    // Arrowhead marker
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7280"/>
      </marker>
      <marker id="arrow-dashed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563"/>
      </marker>
      <marker id="arrow-purple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#a855f7"/>
      </marker>
    `;
    svg.appendChild(defs);

    // Draw edges first (behind nodes)
    for (const edge of graph.edges) {
      const from = layout.find(n => n.id === edge.from);
      const to = layout.find(n => n.id === edge.to);
      if (!from || !to) continue;

      const path = this.createEdgePath(from, to, edge);
      svg.appendChild(path);

      // Edge label
      if (edge.itemType && !edge.dashed) {
        const label = this.createEdgeLabel(from, to, edge.itemType);
        svg.appendChild(label);
      }
    }

    // Draw nodes
    for (const node of layout) {
      const g = this.createNode(node);
      svg.appendChild(g);
    }

    // Pan/zoom support
    container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "graph-wrapper";
    wrapper.appendChild(svg);
    container.appendChild(wrapper);

    this.addPanZoom(svg, wrapper);
  }

  // Compute layout positions using layered approach
  computeLayout(graph) {
    const nodes = graph.nodes.map(n => ({ ...n }));

    // Group by layer
    const layers = {};
    for (const n of nodes) {
      const layer = n.layer || 0;
      if (!layers[layer]) layers[layer] = [];
      layers[layer].push(n);
    }

    // Assign positions
    const layerKeys = Object.keys(layers).map(Number).sort((a, b) => a - b);
    for (const layerIdx of layerKeys) {
      const layerNodes = layers[layerIdx];
      const x = this.padding + layerIdx * this.layerGap;

      for (let i = 0; i < layerNodes.length; i++) {
        layerNodes[i].x = x;
        layerNodes[i].y = this.padding + i * this.nodeGap;
      }
    }

    return nodes;
  }

  // Create SVG group for a node
  createNode(node) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${node.x}, ${node.y})`);
    g.setAttribute("class", "graph-node");
    if (node.chainIdx !== undefined) g.dataset.chainIdx = node.chainIdx;
    g.style.cursor = "pointer";

    const color = CATEGORY_COLORS[node.category] || "#6b7280";

    // Background rect
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", this.nodeWidth);
    rect.setAttribute("height", this.nodeHeight);
    rect.setAttribute("rx", "6");
    rect.setAttribute("fill", "#222632");
    rect.setAttribute("stroke", node.selected ? "#f59e0b" : "#333848");
    rect.setAttribute("stroke-width", node.selected ? "2" : "1");
    g.appendChild(rect);

    // Color accent top bar (flat, no rounding - sits inside the rounded rect)
    const accent = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    accent.setAttribute("x", "1");
    accent.setAttribute("y", "1");
    accent.setAttribute("width", this.nodeWidth - 2);
    accent.setAttribute("height", "3");
    accent.setAttribute("fill", color);
    g.appendChild(accent);

    // Machine name
    const nameText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    nameText.setAttribute("x", "8");
    nameText.setAttribute("y", "20");
    nameText.setAttribute("fill", "#e8eaf0");
    nameText.setAttribute("font-size", "11");
    nameText.setAttribute("font-family", "Inter, sans-serif");
    nameText.setAttribute("font-weight", "600");
    nameText.textContent = this.truncate(node.name, 22);
    g.appendChild(nameText);

    // Output type + value
    const typeLabel = ITEM_TYPES[node.type] || node.type || "";
    const valueStr = node.value ? formatMoney(node.value) : "";

    const detailText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    detailText.setAttribute("x", "8");
    detailText.setAttribute("y", "38");
    detailText.setAttribute("fill", "#9ca3b4");
    detailText.setAttribute("font-size", "10");
    detailText.setAttribute("font-family", "'JetBrains Mono', monospace");
    detailText.textContent = typeLabel;
    g.appendChild(detailText);

    if (valueStr) {
      const valText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      valText.setAttribute("x", this.nodeWidth - 8);
      valText.setAttribute("y", "38");
      valText.setAttribute("fill", "#22c55e");
      valText.setAttribute("font-size", "11");
      valText.setAttribute("font-family", "'JetBrains Mono', monospace");
      valText.setAttribute("font-weight", "600");
      valText.setAttribute("text-anchor", "end");
      valText.textContent = valueStr;
      g.appendChild(valText);
    }

    // Quantity badge - always show flow quantity
    if (node.quantity && node.quantity >= 1) {
      const badgeW = 28;
      const badgeH = 16;
      const badgeX = this.nodeWidth - badgeW - 4;
      const badgeY = 6;
      const badge = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      badge.setAttribute("x", badgeX);
      badge.setAttribute("y", badgeY);
      badge.setAttribute("width", badgeW);
      badge.setAttribute("height", badgeH);
      badge.setAttribute("rx", "8");
      badge.setAttribute("fill", "#f59e0b");
      g.appendChild(badge);

      const badgeText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      badgeText.setAttribute("x", badgeX + badgeW / 2);
      badgeText.setAttribute("y", badgeY + 12);
      badgeText.setAttribute("fill", "#000");
      badgeText.setAttribute("font-size", "10");
      badgeText.setAttribute("font-weight", "700");
      badgeText.setAttribute("text-anchor", "middle");
      badgeText.textContent = "x" + node.quantity;
      g.appendChild(badgeText);
    }

    // Hover effect
    g.addEventListener("mouseenter", () => {
      rect.setAttribute("stroke", color);
      rect.setAttribute("stroke-width", "2");
    });
    g.addEventListener("mouseleave", () => {
      rect.setAttribute("stroke", "#333848");
      rect.setAttribute("stroke-width", "1");
    });

    return g;
  }

  // Create SVG path for an edge (bezier curve)
  createEdgePath(from, to, edge) {
    const x1 = from.x + this.nodeWidth;
    const y1 = from.y + this.nodeHeight / 2;
    const x2 = to.x;
    const y2 = to.y + this.nodeHeight / 2;

    // For back-edges (looping), curve above
    const isBackEdge = to.x <= from.x;
    let d;

    if (isBackEdge) {
      const midY = Math.min(from.y, to.y) - 40;
      d = `M ${x1} ${y1} C ${x1 + 50} ${midY}, ${x2 - 50} ${midY}, ${x2} ${y2}`;
    } else {
      const cx = (x1 + x2) / 2;
      d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
    }

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");

    if (edge.isByproduct) {
      path.setAttribute("stroke", "#f59e0b");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("stroke-dasharray", "6 3");
      path.setAttribute("marker-end", "url(#arrow-dashed)");
    } else if (edge.dashed) {
      path.setAttribute("stroke", "#4b5563");
      path.setAttribute("stroke-width", "1");
      path.setAttribute("stroke-dasharray", "4 3");
      path.setAttribute("marker-end", "url(#arrow-dashed)");
    } else if (isBackEdge) {
      path.setAttribute("stroke", "#a855f7");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("marker-end", "url(#arrow-purple)");
    } else {
      path.setAttribute("stroke", "#6b7280");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("marker-end", "url(#arrow)");
    }

    return path;
  }

  // Create edge label
  createEdgeLabel(from, to, itemType) {
    const label = ITEM_TYPES[itemType] || itemType;
    const x = (from.x + this.nodeWidth + to.x) / 2;
    const y = (from.y + to.y) / 2 + this.nodeHeight / 2 - 5;

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", x);
    text.setAttribute("y", y);
    text.setAttribute("fill", "#6b7280");
    text.setAttribute("font-size", "8");
    text.setAttribute("font-family", "'JetBrains Mono', monospace");
    text.setAttribute("text-anchor", "middle");
    text.textContent = label;
    return text;
  }

  // Add pan/zoom to SVG
  addPanZoom(svg, wrapper) {
    let viewBox = svg.viewBox.baseVal;
    let isPanning = false;
    let startPoint = { x: 0, y: 0 };

    wrapper.addEventListener("mousedown", (e) => {
      if (e.target === svg || e.target === wrapper) {
        isPanning = true;
        startPoint = { x: e.clientX, y: e.clientY };
        wrapper.style.cursor = "grabbing";
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!isPanning) return;
      const dx = (e.clientX - startPoint.x) * (viewBox.width / wrapper.offsetWidth);
      const dy = (e.clientY - startPoint.y) * (viewBox.height / wrapper.offsetHeight);
      viewBox.x -= dx;
      viewBox.y -= dy;
      startPoint = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("mouseup", () => {
      isPanning = false;
      wrapper.style.cursor = "grab";
    });

    wrapper.addEventListener("wheel", (e) => {
      e.preventDefault();
      const scale = e.deltaY > 0 ? 1.1 : 0.9;
      const mx = e.offsetX / wrapper.offsetWidth;
      const my = e.offsetY / wrapper.offsetHeight;

      const newWidth = viewBox.width * scale;
      const newHeight = viewBox.height * scale;
      viewBox.x += (viewBox.width - newWidth) * mx;
      viewBox.y += (viewBox.height - newHeight) * my;
      viewBox.width = newWidth;
      viewBox.height = newHeight;
    });

    wrapper.style.cursor = "grab";
  }

  truncate(str, max) {
    return str.length > max ? str.substring(0, max - 1) + "…" : str;
  }
}

// Global instance
const graphVisualizer = new GraphVisualizer();
