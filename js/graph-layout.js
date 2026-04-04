// UMT Factory Optimizer - Graph Layout Engine
// Wraps dagre for automatic Sugiyama layered DAG layout.
// Replaces the manual computeLayout() with its dual main/byproduct row split.

class GraphLayoutEngine {
  /**
   * Run dagre layout on a graph and write x,y positions back onto nodes.
   * Also computes edge routing points.
   * @param {Object} graphData - { nodes[], edges[] } from FlowGraphBuilder
   * @param {Object} opts - { nodeWidth, nodeHeight }
   * @returns {Object} - { nodes[] with x,y, edges[] with points[], width, height }
   */
  static layout(graphData, opts = {}) {
    const nodeWidth = opts.nodeWidth || 170;
    const nodeHeight = opts.nodeHeight || 50;

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "LR",        // Left to right flow
      nodesep: 20,           // Vertical gap between nodes in same layer
      ranksep: 120,          // Horizontal gap between layers
      edgesep: 8,            // Gap between edges
      marginx: 20,
      marginy: 20,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes
    for (const node of graphData.nodes) {
      // Taller node for chance machines with secondary value
      const h = (node.secondaryValue || node.chanceProduced) ? nodeHeight + 14 : nodeHeight;
      g.setNode(String(node.id), {
        width: nodeWidth,
        height: h,
        label: node.name,
      });
    }

    // Add edges
    for (const edge of graphData.edges) {
      g.setEdge(String(edge.from), String(edge.to), {
        label: edge.itemType || "",
        width: 1,
        height: 1,
      });
    }

    // Run dagre layout
    dagre.layout(g);

    // Read positions back onto nodes
    for (const node of graphData.nodes) {
      const dagreNode = g.node(String(node.id));
      if (dagreNode) {
        // dagre gives center coordinates; convert to top-left for SVG rendering
        node.x = dagreNode.x - nodeWidth / 2;
        node.y = dagreNode.y - (node.secondaryValue ? (nodeHeight + 14) / 2 : nodeHeight / 2);
      } else {
        node.x = 0;
        node.y = 0;
      }
    }

    // Read edge routing points
    for (const edge of graphData.edges) {
      const dagreEdge = g.edge(String(edge.from), String(edge.to));
      if (dagreEdge && dagreEdge.points) {
        edge.points = dagreEdge.points; // Array of {x, y} waypoints
      }
    }

    // Compute total dimensions
    const graphInfo = g.graph();
    return {
      nodes: graphData.nodes,
      edges: graphData.edges,
      width: (graphInfo.width || 800) + 80,
      height: (graphInfo.height || 400) + 80,
    };
  }
}
