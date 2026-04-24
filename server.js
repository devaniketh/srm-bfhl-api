const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Your credentials ──────────────────────────────────────────
const USER_ID = "yourname_ddmmyyyy";          // e.g. "johndoe_17091999"
const EMAIL_ID = "you@college.edu";
const COLLEGE_ROLL_NUMBER = "RA2211000000000"; // your actual roll number
// ─────────────────────────────────────────────────────────────

const VALID_EDGE = /^[A-Z]->[A-Z]$/;

function parseInput(data) {
  const invalid_entries = [];
  const duplicate_edges = [];
  const seenEdges = new Set();
  const validEdges = [];

  for (let raw of data) {
    const entry = typeof raw === "string" ? raw.trim() : String(raw).trim();

    if (!VALID_EDGE.test(entry)) {
      // Self-loop check after format passes — but self-loop won't pass VALID_EDGE if A->A is 3 chars... actually it will
      invalid_entries.push(entry === raw ? entry : entry); // push trimmed
      // But spec says push the original? Let's push trimmed per "Trim whitespace first, then validate"
      // We push the trimmed version
      invalid_entries.push; // no-op, handled below
      continue;
    }

    // Self-loop
    const [parent, child] = entry.split("->");
    if (parent === child) {
      invalid_entries.push(entry);
      continue;
    }

    if (seenEdges.has(entry)) {
      if (!duplicate_edges.includes(entry)) duplicate_edges.push(entry);
    } else {
      seenEdges.add(entry);
      validEdges.push({ parent, child, raw: entry });
    }
  }

  return { invalid_entries, duplicate_edges, validEdges };
}

function buildHierarchies(validEdges) {
  // Diamond rule: first-encountered parent wins
  const childToParent = {}; // child -> parent (first seen)
  const parentToChildren = {}; // parent -> [children]
  const allNodes = new Set();

  for (const { parent, child } of validEdges) {
    allNodes.add(parent);
    allNodes.add(child);
    if (!(child in childToParent)) {
      childToParent[child] = parent;
      if (!parentToChildren[parent]) parentToChildren[parent] = [];
      parentToChildren[parent].push(child);
    }
    // else: discard silently (diamond/multi-parent)
  }

  // Find connected components
  const adj = {};
  for (const node of allNodes) adj[node] = new Set();
  for (const { parent, child } of validEdges) {
    adj[parent].add(child);
    adj[child].add(parent);
  }

  const visited = new Set();
  const components = [];

  for (const node of [...allNodes].sort()) {
    if (visited.has(node)) continue;
    const comp = [];
    const queue = [node];
    while (queue.length) {
      const n = queue.shift();
      if (visited.has(n)) continue;
      visited.add(n);
      comp.push(n);
      for (const nb of adj[n]) queue.push(nb);
    }
    components.push(comp.sort());
  }

  const hierarchies = [];

  for (const comp of components) {
    // Detect cycle using DFS on directed edges within component
    const hasCycle = detectCycle(comp, parentToChildren);

    if (hasCycle) {
      // Root = lexicographically smallest
      const root = comp[0];
      hierarchies.push({ root, tree: {}, has_cycle: true });
      continue;
    }

    // Find root(s): nodes in comp not appearing as a child
    const compSet = new Set(comp);
    const roots = comp.filter((n) => !(n in childToParent) || !compSet.has(childToParent[n]));

    // Should be exactly one root per non-cyclic component
    const root = roots.length > 0 ? roots[0] : comp[0];
    const tree = buildTree(root, parentToChildren);
    const depth = calcDepth(root, parentToChildren);
    hierarchies.push({ root, tree, depth });
  }

  return hierarchies;
}

function detectCycle(nodes, parentToChildren) {
  const nodeSet = new Set(nodes);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  for (const n of nodes) color[n] = WHITE;

  function dfs(u) {
    color[u] = GRAY;
    for (const v of (parentToChildren[u] || [])) {
      if (!nodeSet.has(v)) continue;
      if (color[v] === GRAY) return true;
      if (color[v] === WHITE && dfs(v)) return true;
    }
    color[u] = BLACK;
    return false;
  }

  for (const n of nodes) {
    if (color[n] === WHITE && dfs(n)) return true;
  }
  return false;
}

function buildTree(node, parentToChildren) {
  const children = parentToChildren[node] || [];
  if (children.length === 0) return {};
  const obj = {};
  for (const child of children) {
    obj[child] = buildTree(child, parentToChildren);
  }
  return { [node]: obj }; // wrap
}

// Actually the tree format in the spec is { "A": { "B": {...}, "C": {...} } }
// So the root key contains its children map
function buildTreeNode(node, parentToChildren) {
  const children = parentToChildren[node] || [];
  const obj = {};
  for (const child of children) {
    obj[child] = buildTreeNode(child, parentToChildren);
  }
  return obj;
}

function calcDepth(node, parentToChildren) {
  const children = parentToChildren[node] || [];
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((c) => calcDepth(c, parentToChildren)));
}

app.post("/bfhl", (req, res) => {
  const { data } = req.body;

  if (!Array.isArray(data)) {
    return res.status(400).json({ error: "data must be an array" });
  }

  const { invalid_entries, duplicate_edges, validEdges } = parseInput(data);
  const rawHierarchies = buildHierarchies(validEdges);

  // Re-build tree using correct format
  // parentToChildren rebuilt cleanly
  const childToParent = {};
  const parentToChildren = {};
  const allNodes = new Set();

  for (const { parent, child } of validEdges) {
    allNodes.add(parent);
    allNodes.add(child);
    if (!(child in childToParent)) {
      childToParent[child] = parent;
      if (!parentToChildren[parent]) parentToChildren[parent] = [];
      parentToChildren[parent].push(child);
    }
  }

  const hierarchies = rawHierarchies.map((h) => {
    if (h.has_cycle) return h;
    const treeContent = buildTreeNode(h.root, parentToChildren);
    return {
      root: h.root,
      tree: { [h.root]: treeContent },
      depth: h.depth,
    };
  });

  // Summary
  const nonCyclic = hierarchies.filter((h) => !h.has_cycle);
  const cyclic = hierarchies.filter((h) => h.has_cycle);

  let largest_tree_root = "";
  let maxDepth = -1;
  for (const h of nonCyclic) {
    if (h.depth > maxDepth || (h.depth === maxDepth && h.root < largest_tree_root)) {
      maxDepth = h.depth;
      largest_tree_root = h.root;
    }
  }

  return res.json({
    user_id: 12,
    email_id: "hi@gmail.com",
    college_roll_number: 12,
    hierarchies,
    invalid_entries,
    duplicate_edges,
    summary: {
      total_trees: nonCyclic.length,
      total_cycles: cyclic.length,
      largest_tree_root,
    },
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));