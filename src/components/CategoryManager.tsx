import { ChevronDown, ChevronRight, Folder, FolderPlus, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Category, Transaction } from '../types'
import { categoryDepth, categoryDescendantIds, categoryPath, isCategoryGroup } from '../lib/categories'
import { useI18n } from '../i18n'
import { Button, Card, Input, Label, Select } from './ui'

export function CategoryManager({ categories, transactions, onSave, onSaveMany }: {
  categories: Category[]
  transactions: Transaction[]
  onSave: (category: Category) => Promise<void>
  onSaveMany: (categories: Category[]) => Promise<void>
}) {
  const { t, locale } = useI18n()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [nodeType, setNodeType] = useState<'group' | 'item'>('group')
  const [kind, setKind] = useState<Category['kind']>('expense')
  const [parentId, setParentId] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [editName, setEditName] = useState('')
  const [editKind, setEditKind] = useState<Category['kind']>('expense')

  const active = categories.filter((item) => !item.archived)
  const groups = active.filter(isCategoryGroup).sort((a, b) => categoryPath(a, active).localeCompare(categoryPath(b, active), locale))
  const children = useMemo(() => {
    const map = new Map<string, Category[]>()
    for (const category of active) {
      const key = category.parentId ?? '__root__'
      map.set(key, [...(map.get(key) ?? []), category])
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, locale))
    return map
  }, [active, locale])

  async function createCategory() {
    const value = name.trim()
    if (!value) return
    const timestamp = new Date().toISOString()
    await onSave({ id: crypto.randomUUID(), name: value, nodeType, parentId: parentId || undefined, icon: nodeType === 'group' ? 'Folder' : 'Tag', kind: nodeType === 'group' ? 'both' : kind, archived: false, createdAt: timestamp, updatedAt: timestamp, deleted: false })
    setName('')
    if (parentId) setExpanded((current) => new Set(current).add(parentId))
  }

  function startChild(parent: Category, childType: 'group' | 'item') {
    setParentId(parent.id); setNodeType(childType); setName('')
    setExpanded((current) => new Set(current).add(parent.id))
    requestAnimationFrame(() => document.getElementById('category-create-name')?.focus())
  }

  async function saveEdit(category: Category) {
    const value = editName.trim()
    if (!value) return
    await onSave({ ...category, name: value, kind: isCategoryGroup(category) ? 'both' : editKind, updatedAt: new Date().toISOString() })
    setEditingId(undefined)
  }

  async function remove(category: Category) {
    const descendantIds = categoryDescendantIds(category.id, active)
    const ids = new Set([category.id, ...descendantIds])
    const used = transactions.filter((tx) => ids.has(tx.categoryId)).length
    if (!confirm(used ? t('categories.deleteUsedConfirm', { count: used }) : t('categories.deleteConfirm'))) return
    const timestamp = new Date().toISOString()
    const targets = active.filter((item) => ids.has(item.id))
    if (used) {
      // Archive instead of erasing names used by history. Archived nodes disappear from pickers/tree,
      // but existing transactions still retain a readable path.
      await onSaveMany(targets.map((item) => ({ ...item, archived: true, updatedAt: timestamp })))
    } else {
      await onSaveMany(targets.map((item) => ({ ...item, deleted: true, updatedAt: timestamp })))
    }
  }

  function row(category: Category) {
    const isGroup = isCategoryGroup(category)
    const childRows = children.get(category.id) ?? []
    const isOpen = expanded.has(category.id)
    const depth = categoryDepth(category, active)
    const editing = editingId === category.id
    return <div key={category.id}>
      <div className="group flex min-w-0 items-center gap-2 rounded-xl px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-900/70" style={{ paddingLeft: `${8 + depth * 22}px` }}>
        {isGroup ? <button type="button" className="rounded-md p-1 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800" onClick={() => setExpanded((current) => { const next = new Set(current); next.has(category.id) ? next.delete(category.id) : next.add(category.id); return next })}>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button> : <span className="w-7" />}
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isGroup ? 'bg-stone-100 text-stone-500 dark:bg-stone-800' : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'}`}>{isGroup ? <Folder size={15} /> : <Tag size={15} />}</span>
        {editing ? <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_130px_auto]"><Input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} />{!isGroup && <Select value={editKind} onChange={(e) => setEditKind(e.target.value as Category['kind'])}><option value="expense">{t('settings.kindExpense')}</option><option value="income">{t('settings.kindIncome')}</option><option value="both">{t('settings.kindBoth')}</option></Select>}<Button className="px-3" onClick={() => void saveEdit(category)}>{t('common.save')}</Button></div> : <>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">{category.name}</div>{!isGroup && <div className="text-[11px] text-stone-400">{t(`transaction.${category.kind === 'both' ? 'expense' : category.kind}`)}{category.kind === 'both' ? ` / ${t('transaction.income')}` : ''}</div>}</div>
          {isGroup && <><Button variant="ghost" className="hidden px-2 text-xs sm:inline-flex" onClick={() => startChild(category, 'group')}><FolderPlus size={14} />{t('categories.subgroup')}</Button><Button variant="ghost" className="px-2 text-xs" onClick={() => startChild(category, 'item')}><Plus size={14} />{t('categories.item')}</Button></>}
          <Button variant="ghost" className="px-2 opacity-60 group-hover:opacity-100" onClick={() => { setEditingId(category.id); setEditName(category.name); setEditKind(category.kind) }}><Pencil size={14} /></Button>
          <Button variant="ghost" className="px-2 text-rose-500 opacity-60 group-hover:opacity-100" onClick={() => void remove(category)}><Trash2 size={14} /></Button>
        </>}
      </div>
      {isGroup && isOpen && childRows.map(row)}
    </div>
  }

  const roots = children.get('__root__') ?? []
  return <Card className="p-4 sm:p-5">
    <div><h2 className="text-base font-semibold text-stone-950 dark:text-white">{t('settings.categories')}</h2><p className="mt-1 text-sm text-stone-500">{t('categories.managerHint')}</p></div>
    <div className="mt-5 rounded-2xl border border-stone-200 p-2 dark:border-stone-800">{roots.length ? roots.map(row) : <div className="px-4 py-10 text-center text-sm text-stone-500">{t('categories.empty')}</div>}</div>
    <div className="mt-5 border-t border-stone-100 pt-4 dark:border-stone-800">
      <div className="mb-3 flex items-center justify-between gap-3"><div className="text-sm font-semibold text-stone-800 dark:text-stone-200">{t('categories.create')}</div>{parentId && <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setParentId('')}>{t('categories.backToRoot')}</button>}</div>
      {parentId && <div className="mb-3 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{t('categories.inside', { path: categoryPath(active.find((item) => item.id === parentId)!, active) })}</div>}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px_150px_220px_auto]">
        <div><Label>{t('categories.name')}</Label><Input id="category-create-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>{t('categories.type')}</Label><Select value={nodeType} onChange={(e) => setNodeType(e.target.value as 'group' | 'item')}><option value="group">{t('categories.group')}</option><option value="item">{t('categories.item')}</option></Select></div>
        <div><Label>{t('categories.kind')}</Label><Select disabled={nodeType === 'group'} value={kind} onChange={(e) => setKind(e.target.value as Category['kind'])}><option value="expense">{t('settings.kindExpense')}</option><option value="income">{t('settings.kindIncome')}</option><option value="both">{t('settings.kindBoth')}</option></Select></div>
        <div><Label>{t('categories.parent')}</Label><Select value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">{t('categories.root')}</option>{groups.map((group) => <option key={group.id} value={group.id}>{categoryPath(group, active)}</option>)}</Select></div>
        <div className="self-end"><Button className="w-full" onClick={() => void createCategory()}><Plus size={16} />{t('common.add')}</Button></div>
      </div>
    </div>
  </Card>
}
