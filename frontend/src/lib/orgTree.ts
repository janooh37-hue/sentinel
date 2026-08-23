import type { OrgNodeRead } from './api'

export type OrgPerson = OrgNodeRead

export interface OrgNode {
  person: OrgPerson
  children: OrgNode[]
  depth: number
}

export interface OrgLayoutNode {
  node: OrgNode
  level: number
  w: number
  h: number
  x: number
  y: number
  hasChildren: boolean
  expanded: boolean
}

export interface OrgLayoutLink {
  id: string
  parentId: string
  px: number
  py: number
  cx: number
  cy: number
}

export interface OrgLayout {
  nodes: OrgLayoutNode[]
  links: OrgLayoutLink[]
  width: number
  height: number
  levels: Array<{ y: number; h: number; level: number }>
}

export const NODE_W = 200
export const NODE_H = 72
export const SIBLING_GAP = 14
export const ROOT_GAP = 44
export const LEVEL_GAP = 46
export const STEM = 22
export const MARGIN = 28
export const LINE_W = 2
export const LINE_W_LIN = 3

const orgCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function compareOrgPeople(a: OrgPerson, b: OrgPerson): number {
  const rank = (a.rank_order ?? Number.MAX_SAFE_INTEGER) - (b.rank_order ?? Number.MAX_SAFE_INTEGER)
  if (rank !== 0) return rank

  const designation = orgCollator.compare(
    a.designation_en ?? a.designation_ar ?? '',
    b.designation_en ?? b.designation_ar ?? '',
  )
  return designation || orgCollator.compare(a.id, b.id)
}

/** Turn the flat reporting relation into a stable, cycle-safe forest. */
export function buildForest(people: readonly OrgPerson[]): OrgNode[] {
  const byId = new Map<string, OrgNode>()
  for (const person of people) byId.set(person.id, { person, children: [], depth: 0 })

  const parentId = new Map<string, string>()
  for (const person of people) {
    if (person.supervisor_id && person.supervisor_id !== person.id && byId.has(person.supervisor_id)) {
      parentId.set(person.id, person.supervisor_id)
    }
  }

  // A persisted cycle is invalid but must remain viewable. Cut one deterministic
  // link from each cycle so every person still reaches a root.
  const visited = new Set<string>()
  for (const person of people) {
    if (visited.has(person.id)) continue
    const path: string[] = []
    const indexById = new Map<string, number>()
    let current: string | undefined = person.id
    while (current && !visited.has(current)) {
      const existingIndex = indexById.get(current)
      if (existingIndex !== undefined) {
        const rootId = path.slice(existingIndex).toSorted()[0]
        parentId.delete(rootId)
        break
      }
      indexById.set(current, path.length)
      path.push(current)
      current = parentId.get(current)
    }
    for (const id of path) visited.add(id)
  }

  const roots: OrgNode[] = []
  for (const person of people) {
    const node = byId.get(person.id)!
    const parent = parentId.has(person.id) ? byId.get(parentId.get(person.id)!) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  roots.sort((a, b) => compareOrgPeople(a.person, b.person))
  for (const root of roots) {
    root.depth = 0
    const stack: OrgNode[] = [root]
    while (stack.length) {
      const node = stack.pop()!
      node.children.sort((a, b) => compareOrgPeople(a.person, b.person))
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index]!
        child.depth = node.depth + 1
        stack.push(child)
      }
    }
  }
  return roots
}

export function layoutForest(
  roots: readonly OrgNode[],
  { collapsed, maxLevel }: { collapsed: ReadonlySet<string>; maxLevel: number },
): OrgLayout {
  if (roots.length === 0) return { nodes: [], links: [], width: 0, height: 0, levels: [] }

  const order: Array<{ node: OrgNode; level: number; visibleChildren: OrgNode[] }> = []
  const pending = roots.toReversed().map((node) => ({ node, level: 0 }))
  while (pending.length) {
    const current = pending.pop()!
    const visibleChildren =
      collapsed.has(current.node.person.id) || current.level + 1 >= maxLevel
        ? []
        : current.node.children
    order.push({ ...current, visibleChildren })
    for (let index = visibleChildren.length - 1; index >= 0; index -= 1) {
      pending.push({ node: visibleChildren[index]!, level: current.level + 1 })
    }
  }

  const metrics = new Map<string, { width: number; centre: number }>()
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const current = order[index]!
    if (current.visibleChildren.length === 0) {
      metrics.set(current.node.person.id, { width: NODE_W, centre: NODE_W / 2 })
      continue
    }
    let childrenWidth = 0
    let firstCentre = 0
    let lastCentre = 0
    for (const [childIndex, child] of current.visibleChildren.entries()) {
      const childMetric = metrics.get(child.person.id)!
      if (childIndex === 0) firstCentre = childrenWidth + childMetric.centre
      lastCentre = childrenWidth + childMetric.centre
      childrenWidth += childMetric.width + SIBLING_GAP
    }
    childrenWidth -= SIBLING_GAP
    const width = Math.max(childrenWidth, NODE_W)
    metrics.set(current.node.person.id, {
      width,
      centre: width === childrenWidth ? (firstCentre + lastCentre) / 2 : width / 2,
    })
  }

  const levels = Array.from({ length: Math.max(...order.map((entry) => entry.level)) + 1 }, (_, level) => ({
    level,
    y: MARGIN + level * (NODE_H + LEVEL_GAP),
    h: NODE_H,
  }))
  const visibleById = new Map(order.map((entry) => [entry.node.person.id, entry]))
  const left = new Map<string, number>()
  let cursor = MARGIN
  for (const root of roots) {
    if (!visibleById.has(root.person.id)) continue
    left.set(root.person.id, cursor)
    cursor += metrics.get(root.person.id)!.width + ROOT_GAP
  }

  const nodes: OrgLayoutNode[] = []
  const nodesById = new Map<string, OrgLayoutNode>()
  for (const current of order) {
    const id = current.node.person.id
    const metric = metrics.get(id)!
    const x = (left.get(id) ?? MARGIN) + metric.centre - NODE_W / 2
    const entry: OrgLayoutNode = {
      node: current.node,
      level: current.level,
      w: NODE_W,
      h: NODE_H,
      x,
      y: levels[current.level]!.y,
      hasChildren: current.node.children.length > 0,
      expanded: current.node.children.length > 0 && !collapsed.has(id),
    }
    nodes.push(entry)
    nodesById.set(id, entry)

    if (current.visibleChildren.length === 0) continue
    const childrenWidth = current.visibleChildren.reduce(
      (total, child) => total + metrics.get(child.person.id)!.width,
      0,
    ) + SIBLING_GAP * (current.visibleChildren.length - 1)
    let childLeft = (left.get(id) ?? MARGIN) + (metric.width - childrenWidth) / 2
    for (const child of current.visibleChildren) {
      left.set(child.person.id, childLeft)
      childLeft += metrics.get(child.person.id)!.width + SIBLING_GAP
    }
  }

  const links: OrgLayoutLink[] = []
  for (const current of order) {
    const parent = nodesById.get(current.node.person.id)!
    for (const child of current.visibleChildren) {
      const childNode = nodesById.get(child.person.id)
      if (!childNode) continue
      links.push({
        id: child.person.id,
        parentId: current.node.person.id,
        px: parent.x + parent.w / 2,
        py: parent.y + parent.h,
        cx: childNode.x + childNode.w / 2,
        cy: childNode.y,
      })
    }
  }

  const width = Math.max(...nodes.map((node) => node.x + node.w)) + MARGIN
  const height = Math.max(...nodes.map((node) => node.y + node.h)) + MARGIN
  return { nodes, links, width, height, levels }
}

export function supervisorChain(people: readonly OrgPerson[], id: string): OrgPerson[] {
  const byId = new Map(people.map((person) => [person.id, person]))
  const result: OrgPerson[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current?.supervisor_id && !seen.has(current.supervisor_id)) {
    seen.add(current.supervisor_id)
    const supervisor = byId.get(current.supervisor_id)
    if (!supervisor) break
    result.push(supervisor)
    current = supervisor
  }
  return result
}

export function isBelow(people: readonly OrgPerson[], candidateId: string, ofId: string): boolean {
  return candidateId === ofId || supervisorChain(people, candidateId).some((person) => person.id === ofId)
}

export function directReports(people: readonly OrgPerson[], id: string): OrgPerson[] {
  return people.filter((person) => person.supervisor_id === id).toSorted(compareOrgPeople)
}
