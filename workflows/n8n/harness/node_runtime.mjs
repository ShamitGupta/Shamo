// A tiny n8n graph interpreter.
//
// WHY INTERPRET RATHER THAN RE-IMPLEMENT
// --------------------------------------
// The harness must not drift from the pipeline. The safest way to guarantee
// that is to execute the exact Code-node source that ships in the generated
// workflow JSON, rather than a parallel copy of the logic. So this walks the
// real connection graph and runs the real `jsCode` strings.
//
// validate_budget_v2_workflows.mjs already does this for a single node via
// `new Function("$input", "$", code)`. This generalises it to the whole graph.
//
// THE SAFETY PROPERTY
// -------------------
// Every non-Code node needs an explicit handler. An unhandled HTTP Request node
// THROWS. That is deliberate: it means the interpreter can never silently skip
// a real side effect -- a Supabase write, a Storage upload, a paid OpenAI call
// -- and quietly report a green run. If you see "no handler for", either add a
// stub or accept that this path genuinely needs the network.

/** Build the n8n `$input` object for a node's incoming items. */
function makeInput(items) {
  return {
    first: () => items[0],
    last: () => items[items.length - 1],
    all: () => items,
    item: items[0],
  };
}

/** Build the n8n `$('Node Name')` accessor over already-computed outputs. */
function makeNodeAccessor(outputs, nodeName) {
  return (name) => {
    if (!(name in outputs)) {
      throw new Error(
        `${nodeName} referenced $('${name}') but that node has not run. ` +
          "Either the graph order is wrong or the node was skipped by a branch.",
      );
    }
    const items = outputs[name];
    return {
      first: () => items[0],
      last: () => items[items.length - 1],
      all: () => items,
      item: items[0],
    };
  };
}

/**
 * Run a workflow graph.
 *
 * @param {object} options
 * @param {object} options.workflow      parsed workflow JSON
 * @param {string} options.startNode     node to begin at
 * @param {Array}  options.initialItems  items fed to the start node
 * @param {object} options.handlers      { [nodeName]: (items, ctx) => items }
 * @param {number} [options.maxSteps]
 * @param {boolean} [options.trace]
 */
export function runGraph({ workflow, startNode, initialItems, handlers = {}, maxSteps = 400, trace = false }) {
  const nodesByName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const outputs = {};
  const executed = [];

  let currentName = startNode;
  let currentItems = initialItems;
  let steps = 0;

  while (currentName) {
    if (steps++ > maxSteps) throw new Error(`Exceeded ${maxSteps} steps; the graph may be looping.`);
    const node = nodesByName.get(currentName);
    if (!node) throw new Error(`No node named "${currentName}" in this workflow.`);

    let branch = 0;
    let resultItems;

    if (handlers[currentName]) {
      const outcome = handlers[currentName](currentItems, { node, outputs });
      resultItems = Array.isArray(outcome) ? outcome : outcome.items;
      if (!Array.isArray(outcome) && typeof outcome.branch === "number") branch = outcome.branch;
    } else if (node.type === "n8n-nodes-base.code") {
      const fn = new Function("$input", "$", "$json", node.parameters.jsCode);
      const returned = fn(
        makeInput(currentItems),
        makeNodeAccessor(outputs, currentName),
        currentItems[0]?.json,
      );
      resultItems = Array.isArray(returned) ? returned : [returned];
    } else if (node.type === "n8n-nodes-base.if") {
      // Evaluate the single boolean condition against the incoming item.
      const raw = node.parameters?.conditions?.conditions?.[0]?.leftValue ?? "";
      const expression = String(raw).replace(/^=/, "").replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");
      const evaluate = new Function("$json", `return (${expression || "false"});`);
      const truthy = Boolean(evaluate(currentItems[0]?.json ?? {}));
      branch = truthy ? 0 : 1;
      resultItems = currentItems;
    } else if (node.type === "n8n-nodes-base.stickyNote" || node.type === "n8n-nodes-base.manualTrigger") {
      resultItems = currentItems;
    } else {
      // Partial results are attached so a caller can still inspect everything
      // that ran before the wall. Without this the whole run is lost to one
      // missing stub, which makes the interpreter painful to develop against.
      const error = new Error(
        `No handler for "${currentName}" (${node.type}). ` +
          "Add a stub to the handlers map, or this run needs the network.",
      );
      error.partial = { outputs, executed };
      throw error;
    }

    outputs[currentName] = resultItems;
    executed.push({ name: currentName, branch, items: resultItems.length });
    if (trace) console.log(`  ${currentName}  ->  ${resultItems.length} item(s)${branch ? ` [branch ${branch}]` : ""}`);

    const connections = workflow.connections[currentName]?.main ?? [];
    const next = connections[branch]?.[0]?.node ?? null;
    currentName = next;
    currentItems = resultItems;
  }

  return { outputs, executed, final: currentItems };
}

/** Convenience: wrap plain objects as n8n items. */
export const asItems = (objects) => objects.map((json) => ({ json }));
