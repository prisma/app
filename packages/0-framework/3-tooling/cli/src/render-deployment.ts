/**
 * Pipeline step 8: renders a deploy's results as the app's own topology.
 *
 * Presentation lives here, beside the CLI that owns the terminal — core
 * assembles `DeploymentResult`s and never formats (ADR-0033). The rendered
 * values are the primitives each descriptor deliberately NAMED and apply
 * resolved; nothing here is scraped from a node's wiring outputs, which are
 * checked for presence but never for truth.
 */
import type { DeployedPrimitive, DeploymentResult } from '@internal/core/deploy';

/** Gap between the deepest tree label and the primitive column. */
const LABEL_GAP = 3;

interface TreeNode {
  readonly segment: string;
  readonly children: Map<string, TreeNode>;
  /** The result at exactly this address, if a node deployed here. Absent for a pure path segment (`auth` when only `auth.api` deployed). */
  result?: DeploymentResult;
}

const emptyNode = (segment: string): TreeNode => ({ segment, children: new Map() });

/** Builds the address tree, splitting each dot-address into its segments. */
function buildTree(results: readonly DeploymentResult[]): TreeNode {
  const root = emptyNode('');
  for (const result of results) {
    let node = root;
    for (const segment of result.address.split('.')) {
      let child = node.children.get(segment);
      if (child === undefined) {
        child = emptyNode(segment);
        node.children.set(segment, child);
      }
      node = child;
    }
    node.result = result;
  }
  return root;
}

interface Row {
  /** Tree guides + connector + segment name — what occupies the left column. */
  readonly label: string;
  /** Guides only, with this row's own connector blanked — the prefix a wrapped line carries. */
  readonly continuation: string;
  readonly result: DeploymentResult | undefined;
}

/** Flattens the tree to rows in address order, drawing the box guides. */
function toRows(node: TreeNode, guides: string, rows: Row[]): void {
  const children = Array.from(node.children.values());
  children.forEach((child, index) => {
    const isLast = index === children.length - 1;
    rows.push({
      label: `${guides}${isLast ? '└─ ' : '├─ '}${child.segment}`,
      // A wrapped line under this row keeps the ancestors' guides but not the
      // connector: the branch has already been drawn.
      continuation: `${guides}${isLast ? '   ' : '│  '}`,
      result: child.result,
    });
    toRows(child, `${guides}${isLast ? '   ' : '│  '}`, rows);
  });
}

/** `kind id` — the one line a primitive gets. */
const primitiveLine = (primitive: DeployedPrimitive): string => `${primitive.kind} ${primitive.id}`;

/** Pads `prefix` out to `width`, so every primitive starts in the same column. */
const pad = (prefix: string, width: number): string => prefix.padEnd(width, ' ');

/**
 * Renders a deploy's results as the app's own topology. Pure — returns the
 * string; the caller prints.
 */
export function renderDeployment(appName: string, results: readonly DeploymentResult[]): string {
  const rows: Row[] = [];
  toRows(buildTree(results), '', rows);

  // One column for every primitive in the tree, set by the widest label — so
  // the ids line up regardless of nesting depth.
  const column = Math.max(0, ...rows.map((row) => row.label.length)) + LABEL_GAP;

  const lines = [appName];
  for (const row of rows) {
    if (row.result === undefined) {
      // A pure path segment (`auth` when only `auth.api` deployed) — structure,
      // not a deployed node. Nothing to report against it.
      lines.push(row.label);
      continue;
    }
    if (row.result.primitives.length === 0) {
      lines.push(`${pad(row.label, column)}(no primitives reported)`);
      continue;
    }
    // The first primitive shares the label's line; the rest wrap into the
    // same column, as does a url.
    row.result.primitives.forEach((primitive, index) => {
      const prefix = index === 0 ? row.label : row.continuation;
      lines.push(`${pad(prefix, column)}${primitiveLine(primitive)}`);
      if (primitive.url !== undefined) {
        lines.push(`${pad(row.continuation, column)}${primitive.url}`);
      }
    });
  }
  return lines.join('\n');
}

/**
 * The report hook the generated stack file wires into `LowerOptions`. Prints a
 * leading blank line so the summary separates from alchemy's own apply output.
 */
export function deploymentReport(appName: string): (results: readonly DeploymentResult[]) => void {
  return (results) => {
    console.log('');
    console.log(renderDeployment(appName, results));
  };
}
