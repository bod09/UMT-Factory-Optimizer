// UMT Factory Optimizer - SVG Node Graph Visualizer
// Renders machine chains as interactive SVG node graphs

class GraphVisualizer {
  constructor() {
    this.nodeWidth = 170;
    this.nodeHeight = 52;
    this.layerGap = 230;
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
    const edgeElements = [];
    const labelElements = [];
    for (const edge of graph.edges) {
      const from = layout.find(n => n.id === edge.from);
      const to = layout.find(n => n.id === edge.to);
      if (!from || !to) continue;

      const path = this.createEdgePath(from, to, edge);
      path.dataset.from = edge.from;
      path.dataset.to = edge.to;
      path.classList.add("graph-edge");
      svg.appendChild(path);
      edgeElements.push(path);

      // Edge label (show on all edges including byproduct/dashed)
      if (edge.itemType) {
        const label = this.createEdgeLabel(from, to, edge.itemType, edge.qty);
        label.dataset.from = edge.from;
        label.dataset.to = edge.to;
        label.classList.add("graph-edge-label");
        svg.appendChild(label);
        labelElements.push(label);
      }
    }

    // Draw nodes
    const nodeElements = new Map();
    for (const node of layout) {
      const g = this.createNode(node);
      g.dataset.nodeId = node.id;
      g.classList.add("graph-node");
      svg.appendChild(g);
      nodeElements.set(node.id, g);
    }

    // Click-to-highlight: click a node to show its connections
    let selectedNodeId = null;
    const clearSelection = () => {
      selectedNodeId = null;
      nodeElements.forEach(el => { el.style.opacity = ""; el.style.filter = ""; });
      edgeElements.forEach(el => { el.style.opacity = ""; el.style.strokeWidth = ""; });
      labelElements.forEach(el => { el.style.opacity = ""; });
    };

    const selectNode = (nodeId) => {
      if (selectedNodeId === nodeId) { clearSelection(); return; }
      selectedNodeId = nodeId;

      // Find connected edges and nodes
      const connectedNodes = new Set([nodeId]);
      const connectedEdges = new Set();
      edgeElements.forEach((el, idx) => {
        const from = parseInt(el.dataset.from);
        const to = parseInt(el.dataset.to);
        if (from === nodeId || to === nodeId) {
          connectedEdges.add(idx);
          connectedNodes.add(from);
          connectedNodes.add(to);
        }
      });

      // Dim everything
      nodeElements.forEach((el, id) => {
        if (connectedNodes.has(id)) {
          el.style.opacity = "1";
          el.style.filter = id === nodeId ? "brightness(1.3)" : "";
        } else {
          el.style.opacity = "0.15";
        }
      });
      edgeElements.forEach((el, idx) => {
        if (connectedEdges.has(idx)) {
          el.style.opacity = "1";
          el.style.strokeWidth = "3";
        } else {
          el.style.opacity = "0.08";
        }
      });
      labelElements.forEach(el => {
        const from = parseInt(el.dataset.from);
        const to = parseInt(el.dataset.to);
        const isConnected = from === nodeId || to === nodeId;
        el.style.opacity = isConnected ? "1" : "0.08";
      });
    };

    // Track drag vs click (don't deselect on drag)
    let mouseDownPos = null;
    let wasDrag = false;
    svg.addEventListener("mousedown", (e) => {
      mouseDownPos = { x: e.clientX, y: e.clientY };
      wasDrag = false;
    });
    svg.addEventListener("mousemove", (e) => {
      if (mouseDownPos) {
        const dist = Math.abs(e.clientX - mouseDownPos.x) + Math.abs(e.clientY - mouseDownPos.y);
        if (dist > 5) wasDrag = true;
      }
    });

    nodeElements.forEach((el, id) => {
      el.style.cursor = "pointer";
      el.addEventListener("mouseup", (e) => {
        if (!wasDrag) {
          e.stopPropagation();
          selectNode(id);
        }
      });
    });

    // Click empty space to deselect (only if not dragging)
    svg.addEventListener("mouseup", () => {
      if (!wasDrag && selectedNodeId !== null) clearSelection();
      mouseDownPos = null;
    });

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

    // Split into main chain and byproduct chain
    const mainNodes = nodes.filter(n => !n.isByproduct);
    const bpNodes = nodes.filter(n => n.isByproduct);

    // Layout main chain: group by layer, stack vertically within each layer
    const mainLayers = {};
    for (const n of mainNodes) {
      const layer = n.layer || 0;
      if (!mainLayers[layer]) mainLayers[layer] = [];
      mainLayers[layer].push(n);
    }

    const mainLayerKeys = Object.keys(mainLayers).map(Number).sort((a, b) => a - b);

    // Find the tallest layer to use as reference for centering
    let maxLayerHeight = 0;
    for (const layerIdx of mainLayerKeys) {
      const count = mainLayers[layerIdx].length;
      const height = (count - 1) * this.nodeGap + this.nodeHeight;
      maxLayerHeight = Math.max(maxLayerHeight, height);
    }

    // Position each layer centered relative to the tallest layer
    let mainMaxY = 0;
    for (const layerIdx of mainLayerKeys) {
      const layerNodes = mainLayers[layerIdx];
      const col = mainLayerKeys.indexOf(layerIdx);
      const x = this.padding + col * this.layerGap;
      const layerHeight = (layerNodes.length - 1) * this.nodeGap + this.nodeHeight;
      const yOffset = this.padding + (maxLayerHeight - layerHeight) / 2;
      for (let i = 0; i < layerNodes.length; i++) {
        layerNodes[i].x = x;
        layerNodes[i].y = yOffset + i * this.nodeGap;
        mainMaxY = Math.max(mainMaxY, layerNodes[i].y + this.nodeHeight);
      }
    }

    // Layout byproduct chain independently below main chain
    if (bpNodes.length > 0) {
      const rowGap = 60; // gap between main and byproduct rows
      const bpStartY = mainMaxY + rowGap;

      // Assign independent layers for byproduct nodes
      const bpLayers = {};
      for (const n of bpNodes) {
        const layer = n.layer || 0;
        if (!bpLayers[layer]) bpLayers[layer] = [];
        bpLayers[layer].push(n);
      }

      // Re-index byproduct layers starting from 0, centered like main flow
      const bpLayerKeys = Object.keys(bpLayers).map(Number).sort((a, b) => a - b);
      let maxBpLayerHeight = 0;
      for (const layerIdx of bpLayerKeys) {
        const count = bpLayers[layerIdx].length;
        const height = (count - 1) * this.nodeGap + this.nodeHeight;
        maxBpLayerHeight = Math.max(maxBpLayerHeight, height);
      }
      for (const layerIdx of bpLayerKeys) {
        const layerNodes = bpLayers[layerIdx];
        const col = bpLayerKeys.indexOf(layerIdx);
        const x = this.padding + col * this.layerGap;
        const layerHeight = (layerNodes.length - 1) * this.nodeGap + this.nodeHeight;
        const yOffset = bpStartY + (maxBpLayerHeight - layerHeight) / 2;
        for (let i = 0; i < layerNodes.length; i++) {
          layerNodes[i].x = x;
          layerNodes[i].y = yOffset + i * this.nodeGap;
        }
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
  // Two simple rules:
  //   1. Within same flow (same row): left→right using right/left ports
  //   2. Between flows (different rows): top/bottom ports
  createEdgePath(from, to, edge) {
    const dy = to.y - from.y;
    // Same flow = both main or both byproduct (use isByproduct flag, not Y position)
    const sameFlow = (!!from.isByproduct) === (!!to.isByproduct);

    let x1, y1, x2, y2;
    let connectionType;

    if (sameFlow) {
      // WITHIN a flow: always right side → left side
      connectionType = to.x > from.x ? 'horizontal' : 'back-edge';
      x1 = from.x + this.nodeWidth;
      y1 = from.y + this.nodeHeight / 2;
      x2 = to.x;
      y2 = to.y + this.nodeHeight / 2;
    } else {
      // BETWEEN flows: always top/bottom ports
      connectionType = 'vertical';
      if (dy > 0) {
        // Target is below: bottom of source → top of target
        x1 = from.x + this.nodeWidth / 2;
        y1 = from.y + this.nodeHeight;
        x2 = to.x + this.nodeWidth / 2;
        y2 = to.y;
      } else {
        // Target is above: top of source → bottom of target
        x1 = from.x + this.nodeWidth / 2;
        y1 = from.y;
        x2 = to.x + this.nodeWidth / 2;
        y2 = to.y + this.nodeHeight;
      }
    }

    let d;
    if (connectionType === 'horizontal') {
      // Gentle S-curve, last segment approaches target horizontally (arrow points right)
      const dx = x2 - x1;
      const cp1x = x1 + dx * 0.4;
      const cp2x = x1 + dx * 0.6;
      d = `M ${x1} ${y1} C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}`;
    } else if (connectionType === 'vertical') {
      // Straight line for short distances, curve for long
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);
      if (dx < 10) {
        // Nearly vertical: straight line
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else {
        // Diagonal: use quadratic bezier so arrow aligns with the line direction
        // The arrow will point along the line from control point to endpoint
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        d = `M ${x1} ${y1} Q ${cx} ${cy}, ${x2} ${y2}`;
      }
    } else {
      // back-edge: curve above both nodes
      const midY = Math.min(from.y, to.y) - 40;
      d = `M ${x1} ${y1} C ${x1 + 50} ${midY}, ${x2 - 50} ${midY}, ${x2} ${y2}`;
    }

    const isBackEdge = connectionType === 'back-edge';

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
  createEdgeLabel(from, to, itemType, qty) {
    let label = ITEM_TYPES[itemType] || itemType;
    if (qty && qty > 1) label += ` x${qty}`;
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

    // Store original bounds for clamping
    const origX = viewBox.x;
    const origY = viewBox.y;
    const origW = viewBox.width;
    const origH = viewBox.height;
    // Allow panning with some margin but can't go fully off-screen
    const margin = 100;

    const clampViewBox = () => {
      const minX = origX - margin;
      const minY = origY - margin;
      const maxX = origX + origW - viewBox.width + margin;
      const maxY = origY + origH - viewBox.height + margin;
      viewBox.x = Math.max(minX, Math.min(maxX, viewBox.x));
      viewBox.y = Math.max(minY, Math.min(maxY, viewBox.y));
    };

    wrapper.addEventListener("mousedown", (e) => {
      // Only start pan on empty space - not on nodes (which have graph-node class)
      const clickedNode = e.target.closest(".graph-node");
      if (clickedNode) return; // let node handlers deal with it
      isPanning = true;
      startPoint = { x: e.clientX, y: e.clientY };
      wrapper.style.cursor = "grabbing";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isPanning) return;
      const dx = (e.clientX - startPoint.x) * (viewBox.width / wrapper.offsetWidth);
      const dy = (e.clientY - startPoint.y) * (viewBox.height / wrapper.offsetHeight);
      viewBox.x -= dx;
      viewBox.y -= dy;
      clampViewBox();
      startPoint = { x: e.clientX, y: e.clientY };
    });

    document.addEventListener("mouseup", () => {
      if (isPanning) {
        isPanning = false;
        wrapper.style.cursor = "grab";
      }
    });

    wrapper.addEventListener("wheel", (e) => {
      e.preventDefault();
      const scale = e.deltaY > 0 ? 1.1 : 0.9;
      const mx = e.offsetX / wrapper.offsetWidth;
      const my = e.offsetY / wrapper.offsetHeight;

      const newWidth = viewBox.width * scale;
      const newHeight = viewBox.height * scale;

      // Limit zoom-out: can't zoom out further than showing all nodes
      if (newWidth > origW || newHeight > origH) return;

      viewBox.x += (viewBox.width - newWidth) * mx;
      viewBox.y += (viewBox.height - newHeight) * my;
      viewBox.width = newWidth;
      viewBox.height = newHeight;
      clampViewBox();
    });

    wrapper.style.cursor = "grab";
  }

  truncate(str, max) {
    return str.length > max ? str.substring(0, max - 1) + "…" : str;
  }
}

// Global instance
const graphVisualizer = new GraphVisualizer();
