import type { Category, TransactionType } from '../types'

export function isCategoryGroup(category: Category) {
  return category.nodeType === 'group'
}

export function isCategoryItem(category: Category) {
  return category.nodeType !== 'group'
}

export function categoryPath(category: Category, categories: Category[], separator = ' › ') {
  const byId = new Map(categories.map((item) => [item.id, item]))
  const names: string[] = []
  const visited = new Set<string>()
  let current: Category | undefined = category
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    names.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return names.join(separator)
}

export function categoryDepth(category: Category, categories: Category[]) {
  const byId = new Map(categories.map((item) => [item.id, item]))
  let depth = 0
  let current = category.parentId ? byId.get(category.parentId) : undefined
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    depth += 1
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return depth
}

export function selectableCategories(categories: Category[], type?: TransactionType) {
  return categories
    .filter((category) => !category.archived)
    .filter(isCategoryItem)
    .filter((category) => !type || type === 'transfer' || category.kind === type || category.kind === 'both')
    .sort((a, b) => categoryPath(a, categories).localeCompare(categoryPath(b, categories), undefined, { sensitivity: 'base' }))
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/đ/g, 'd')
}

export function searchCategories(categories: Category[], query: string, type?: TransactionType, limit = 30) {
  const q = normalize(query.trim())
  const items = selectableCategories(categories, type)
  if (!q) return items.slice(0, limit)
  return items
    .map((category) => ({ category, path: categoryPath(category, categories) }))
    .filter(({ path }) => normalize(path).includes(q))
    .sort((a, b) => {
      const an = normalize(a.path)
      const bn = normalize(b.path)
      const ai = an.indexOf(q)
      const bi = bn.indexOf(q)
      if (ai !== bi) return ai - bi
      return a.path.length - b.path.length
    })
    .slice(0, limit)
    .map(({ category }) => category)
}

export function categoryDescendantIds(rootId: string, categories: Category[]) {
  const result = new Set<string>()
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift()!
    for (const child of categories.filter((item) => item.parentId === id)) {
      if (result.has(child.id)) continue
      result.add(child.id)
      queue.push(child.id)
    }
  }
  return result
}
