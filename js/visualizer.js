// UMT Factory Optimizer - SVG Node Graph Visualizer
// Renders machine chains as interactive SVG node graphs

class GraphVisualizer {
  constructor() {
    this.nodeWidth = 170;
    this.nodeHeight = 44;
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

    // Layout using dagre
    const layoutResult = GraphLayoutEngine.layout(graph, {
      nodeWidth: this.nodeWidth,
      nodeHeight: this.nodeHeight,
    });
    const layout = layoutResult.nodes;

    // SVG dimensions from dagre
    const maxX = layoutResult.width;
    const maxY = layoutResult.height;

    // Build SVG
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${maxX} ${maxY}`);
    svg.setAttribute("class", "chain-graph-svg");
    svg.style.width = "100%";
    svg.style.height = Math.min(maxY, 600) + "px";

    // Circle endpoint markers (orientation-independent)
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
      <marker id="dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6">
        <circle cx="5" cy="5" r="4" fill="#6b7280"/>
      </marker>
      <marker id="dot-byproduct" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6">
        <circle cx="5" cy="5" r="4" fill="#f59e0b"/>
      </marker>
      <marker id="dot-back" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6">
        <circle cx="5" cy="5" r="4" fill="#a855f7"/>
      </marker>
    `;
    svg.appendChild(defs);

    // Count outgoing edges per node (to detect splits)
    const outgoingCount = new Map();
    for (const edge of graph.edges) {
      outgoingCount.set(edge.from, (outgoingCount.get(edge.from) || 0) + 1);
    }

    // Draw edges first (behind nodes)
    const edgeElements = [];
    const labelElements = [];
    for (const edge of graph.edges) {
      const from = layout.find(n => n.id === edge.from);
      const to = layout.find(n => n.id === edge.to);
      if (!from || !to) continue;

      const path = this.createEdgePath(from, to, edge, layout);
      path.dataset.from = edge.from;
      path.dataset.to = edge.to;
      path.classList.add("graph-edge");
      svg.appendChild(path);
      edgeElements.push(path);

      // Edge label: show item type, and quantity ONLY when source splits
      if (edge.itemType) {
        const isSplit = (outgoingCount.get(edge.from) || 0) > 1;
        const showQty = isSplit ? edge.qty : null;
        const label = this.createEdgeLabel(from, to, edge.itemType, showQty, edge);
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

    // Tooltip for chance machine processing path
    let tooltipEl = null;
    const removeTooltip = () => {
      if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
    };

    const clearSelection = () => {
      selectedNodeId = null;
      removeTooltip();
      nodeElements.forEach(el => { el.style.opacity = ""; el.style.filter = ""; });
      edgeElements.forEach(el => { el.style.opacity = ""; el.style.strokeWidth = ""; });
      labelElements.forEach(el => { el.style.opacity = ""; });
    };

    const selectNode = (nodeId) => {
      removeTooltip();
      if (selectedNodeId === nodeId) { clearSelection(); return; }
      selectedNodeId = nodeId;

      // Show tooltip for chance machines
      const nodeData = layout.find(n => n.id === nodeId);
      if (nodeData?.chanceProduced?.path) {
        const cp = nodeData.chanceProduced;
        tooltipEl = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const tipX = nodeData.x + this.nodeWidth + 8;
        const tipY = nodeData.y;
        tooltipEl.setAttribute("transform", `translate(${tipX}, ${tipY})`);

        const pathStr = cp.path.join(' → ');
        const lines = [`${cp.qty < 1 ? cp.qty.toFixed(1) : Math.round(cp.qty)} ${cp.label}`, pathStr];
        if (cp.value > 0) lines.push(`= ${formatMoney(cp.value)} each`);

        const lineH = 14;
        const padX = 8, padY = 6;
        const maxW = Math.max(...lines.map(l => l.length * 5.5)) + padX * 2;
        const totalH = lines.length * lineH + padY * 2;

        const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        bg.setAttribute("x", 0); bg.setAttribute("y", 0);
        bg.setAttribute("width", maxW); bg.setAttribute("height", totalH);
        bg.setAttribute("rx", "4"); bg.setAttribute("fill", "#1a1d28");
        bg.setAttribute("stroke", "#f59e0b"); bg.setAttribute("stroke-width", "1");
        bg.setAttribute("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.5))");
        tooltipEl.appendChild(bg);

        lines.forEach((line, i) => {
          const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
          t.setAttribute("x", padX); t.setAttribute("y", padY + (i + 1) * lineH - 2);
          t.setAttribute("fill", i === 1 ? "#f59e0b" : "#e8eaf0");
          t.setAttribute("font-size", "10");
          t.setAttribute("font-family", "'JetBrains Mono', monospace");
          if (i === 0) t.setAttribute("font-weight", "600");
          t.textContent = line;
          tooltipEl.appendChild(t);
        });

        svg.appendChild(tooltipEl);
      }

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

  // Layout is now handled by GraphLayoutEngine (dagre) in graph-layout.js
  // computeLayout() removed - was 76 lines of manual layering with main/byproduct split

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
    const actualHeight = (node.secondaryValue || node.chanceProduced) ? this.nodeHeight + 14 : this.nodeHeight;
    rect.setAttribute("width", this.nodeWidth);
    rect.setAttribute("height", actualHeight);
    rect.setAttribute("rx", "6");
    rect.setAttribute("fill", "#222632");
    rect.setAttribute("stroke", node.selected ? "#f59e0b" : "#333848");
    rect.setAttribute("stroke-width", node.selected ? "2" : "1");
    g.appendChild(rect);

    // Color accent top bar (clipped to node's rounded shape)
    const clipId = `clip-${node.id}`;
    const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
    clipPath.setAttribute("id", clipId);
    const clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    clipRect.setAttribute("x", "1");
    clipRect.setAttribute("y", "1");
    clipRect.setAttribute("width", this.nodeWidth - 2);
    clipRect.setAttribute("height", actualHeight - 2);
    clipRect.setAttribute("rx", "5");
    clipPath.appendChild(clipRect);
    g.appendChild(clipPath);

    const accent = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    accent.setAttribute("x", "1");
    accent.setAttribute("y", "1");
    accent.setAttribute("width", this.nodeWidth - 2);
    accent.setAttribute("height", "4");
    accent.setAttribute("fill", color);
    accent.setAttribute("clip-path", `url(#${clipId})`);
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
    const typeLabel = node.displayType || ITEM_TYPES[node.type] || node.type || "";
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

    // Chance machine output annotation (e.g., "→ 0.3 Diamond Gem @ $5.1K")
    if (node.chanceProduced) {
      const cp = node.chanceProduced;
      const qtyStr = cp.qty < 1 ? cp.qty.toFixed(1) : Math.round(cp.qty);
      const label = cp.value > 0
        ? `→ ${qtyStr} ${cp.label} @ ${formatMoney(cp.value)}`
        : `→ ${qtyStr} ${cp.label}`;
      const prodText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      prodText.setAttribute("x", "8");
      prodText.setAttribute("y", "50");
      prodText.setAttribute("fill", "#f59e0b");
      prodText.setAttribute("font-size", "9");
      prodText.setAttribute("font-family", "'JetBrains Mono', monospace");
      prodText.setAttribute("font-weight", "500");
      prodText.textContent = label;
      g.appendChild(prodText);
    } else if (node.secondaryValue) {
      // Fallback: passthrough value for non-annotated chance machines
      const secText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      secText.setAttribute("x", this.nodeWidth - 8);
      secText.setAttribute("y", "50");
      secText.setAttribute("fill", "#9ca3b4");
      secText.setAttribute("font-size", "9");
      secText.setAttribute("font-family", "'JetBrains Mono', monospace");
      secText.setAttribute("text-anchor", "end");
      secText.textContent = `Pass: ${formatMoney(node.secondaryValue)}`;
      g.appendChild(secText);
    }

    // Quantity badge - always show flow quantity
    if (node.quantity !== undefined && node.quantity !== null) {
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

  // Create SVG path for an edge using dagre's computed waypoints
  createEdgePath(from, to, edge, allNodes) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "none");

    // Use dagre's computed edge points if available
    if (edge.points && edge.points.length >= 2) {
      const pts = edge.points;
      if (pts.length === 2) {
        // Straight line
        path.setAttribute("d", `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`);
      } else {
        // Smooth curve through waypoints
        let d = `M ${pts[0].x} ${pts[0].y}`;
        if (pts.length === 3) {
          // Quadratic bezier through midpoint
          d += ` Q ${pts[1].x} ${pts[1].y}, ${pts[2].x} ${pts[2].y}`;
        } else {
          // Smooth spline through all waypoints
          for (let i = 1; i < pts.length - 1; i++) {
            const curr = pts[i];
            const next = pts[i + 1];
            const midX = (curr.x + next.x) / 2;
            const midY = (curr.y + next.y) / 2;
            if (i === pts.length - 2) {
              d += ` Q ${curr.x} ${curr.y}, ${next.x} ${next.y}`;
            } else {
              d += ` Q ${curr.x} ${curr.y}, ${midX} ${midY}`;
            }
          }
        }
        path.setAttribute("d", d);
      }
    } else {
      // Fallback: simple bezier
      const x1 = from.x + this.nodeWidth;
      const y1 = from.y + this.nodeHeight / 2;
      const x2 = to.x;
      const y2 = to.y + this.nodeHeight / 2;
      const dx = x2 - x1;
      path.setAttribute("d", `M ${x1} ${y1} C ${x1 + dx * 0.4} ${y1}, ${x1 + dx * 0.6} ${y2}, ${x2} ${y2}`);
    }

    // Style by edge kind
    const kind = edge.kind || "main";
    if (kind === "byproduct") {
      path.setAttribute("stroke", "#f59e0b");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("stroke-dasharray", "6 3");
      path.setAttribute("marker-end", "url(#dot-byproduct)");
    } else if (kind === "enhancement") {
      path.setAttribute("stroke", "#a855f7");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("marker-end", "url(#dot-back)");
    } else if (kind === "chance") {
      path.setAttribute("stroke", "#f59e0b");
      path.setAttribute("stroke-width", "1");
      path.setAttribute("stroke-dasharray", "4 3");
      path.setAttribute("marker-end", "url(#dot-byproduct)");
    } else {
      path.setAttribute("stroke", "#6b7280");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("marker-end", "url(#dot)");
    }

    return path;
  }

  // Create edge label
  createEdgeLabel(from, to, itemType, qty, edge) {
    let label = ITEM_TYPES[itemType] || itemType;
    if (qty && qty > 1) label += ` x${qty}`;
    // Use dagre's edge midpoint if available
    let x, y;
    if (edge?.points && edge.points.length > 0) {
      const mid = edge.points[Math.floor(edge.points.length / 2)];
      x = mid.x;
      y = mid.y - 8;
    } else {
      x = (from.x + this.nodeWidth + to.x) / 2;
      y = (from.y + to.y) / 2 + this.nodeHeight / 2 - 5;
    }

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
      const dy = (e.clientY - startPoint.y) * (viewBox.width / wrapper.offsetWidth);
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

      // Zoom-out limit: snap back to original view
      if (newWidth >= origW || newHeight >= origH) {
        viewBox.x = origX;
        viewBox.y = origY;
        viewBox.width = origW;
        viewBox.height = origH;
        return;
      }

      // Zoom-in limit: stop when ~1 node fills the viewport
      const minWidth = 250;
      if (newWidth < minWidth) return;

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
