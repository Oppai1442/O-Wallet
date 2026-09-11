import { ChevronDown, ChevronRight, Folder, FolderPlus, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Category, Transaction, WalletEntity } from '../types'
import { categoryDepth, categoryDescendantIds, categoryPath, isCategoryGroup } from '../lib/categories'
import { useI18n } from '../i18n'
import { useWallet } from '../WalletContext'
import { Button, Card, Input, Label, Select } from './ui'

export function CategoryManager({ categories, transactions, onSave, onSaveMany }: {
  categories: Category[]
  transactions: Transaction[]
  onSave: (category: Category) => Promise<void>
  onSaveMany: (categories: Category[], removedIds?: string[]) => Promise<void>
}) {
  const { t, locale } = useI18n()
  const { settings, saveEntities } = useWallet()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(categories.filter((item) => !item.archived && isCategoryGroup(item)).map((item) => item.id)))
  const [name, setName] = useState('')
  const [nodeType, setNodeType] = useState<'group' | 'item'>('item')
  const [kind, setKind] = useState<Category['kind']>('expense')
  const [parentId, setParentId] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [editName, setEditName] = useState('')
  const [editKind, setEditKind] = useState<Category['kind']>('expense')

  const roleCopy = locale.startsWith('vi') ? {
    label: 'Loại danh mục',
    group: 'Nhóm danh mục',
    groupHint: 'Chỉ để gom các danh mục con. Không thể gán trực tiếp cho giao dịch.',
    item: 'Danh mục giao dịch',
    itemHint: 'Danh mục thực tế có thể chọn khi thêm giao dịch thu hoặc chi.',
  } : {
    label: 'Category role',
    group: 'Category group',
    groupHint: 'Organizes child categories. It cannot be assigned directly to a transaction.',
    item: 'Transaction category',
    itemHint: 'A real category that can be selected for an income or expense transaction.',
  }

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
    const id = crypto.randomUUID()
    await onSave({ id, name: value, nodeType, parentId: parentId || undefined, icon: nodeType === 'group' ? 'Folder' : 'Tag', kind: nodeType === 'group' ? 'both' : kind, archived: false, createdAt: timestamp, updatedAt: timestamp, deleted: false })
    setName('')
    setExpanded((current) => {
      const next = new Set(current)
      if (parentId) next.add(parentId)
      if (nodeType === 'group') next.add(id)
      return next
    })
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
    const nextCategories = used
      ? targets.map((item) => ({ ...item, archived: true, updatedAt: timestamp }))
      : targets.map((item) => ({ ...item, deleted: true, updatedAt: timestamp }))

    if (!settings) {
      await onSaveMany(nextCategories, [...ids])
      return
    }

    const nextRules = (settings.transactionRules ?? [])
      .map((rule) => ids.has(rule.categoryId ?? '') ? { ...rule, categoryId: undefined, updatedAt: timestamp } : rule)
      .filter((rule) => Boolean(rule.categoryId || rule.accountId))
    const nextDefaults = ids.has(settings.transactionDefaults?.categoryId ?? '')
      ? { ...settings.transactionDefaults, categoryId: undefined }
      : settings.transactionDefaults
    const nextSettings = {
      ...settings,
      budgets: (settings.budgets ?? []).filter((budget) => !ids.has(budget.categoryId)),
      transactionRules: nextRules,
      transactionDefaults: nextDefaults,
      updatedAt: timestamp,
    }
    await saveEntities<WalletEntity>([nextSettings, ...nextCategories])
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

    <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-950/30">
      <div className="mb-3 flex items-center justify-between gap-3"><div className="text-sm font-semibold text-stone-800 dark:text-stone-200">{t('categories.create')}</div>{parentId && <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setParentId('')}>{t('categories.backToRoot')}</button>}</div>
      {parentId && <div className="mb-3 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{t('categories.inside', { path: categoryPath(active.find((item) => item.id === parentId)!, active) })}</div>}

      <div>
        <Label>{roleCopy.label}</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" aria-pressed={nodeType === 'group'} onClick={() => setNodeType('group')} className={`flex min-w-0 items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${nodeType === 'group' ? 'border-stone-500 bg-white shadow-sm dark:border-stone-500 dark:bg-stone-900' : 'border-stone-200 bg-white/50 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-950/30 dark:hover:border-stone-700'}`}>
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"><Folder size={16} /></span>
            <span className="min-w-0"><span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">{roleCopy.group}</span><span className="mt-0.5 block text-xs leading-5 text-stone-500">{roleCopy.groupHint}</span></span>
          </button>
          <button type="button" aria-pressed={nodeType === 'item'} onClick={() => setNodeType('item')} className={`flex min-w-0 items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${nodeType === 'item' ? 'border-blue-500 bg-blue-50/70 shadow-sm dark:border-blue-500 dark:bg-blue-500/10' : 'border-stone-200 bg-white/50 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-950/30 dark:hover:border-stone-700'}`}>
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"><Tag size={16} /></span>
            <span className="min-w-0"><span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">{roleCopy.item}</span><span className="mt-0.5 block text-xs leading-5 text-stone-500">{roleCopy.itemHint}</span></span>
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_150px_220px_auto]">
        <div><Label>{t('categories.name')}</Label><Input id="category-create-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>{t('categories.kind')}</Label><Select disabled={nodeType === 'group'} value={kind} onChange={(e) => setKind(e.target.value as Category['kind'])}><option value="expense">{t('settings.kindExpense')}</option><option value="income">{t('settings.kindIncome')}</option><option value="both">{t('settings.kindBoth')}</option></Select></div>
        <div><Label>{t('categories.parent')}</Label><Select value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">{t('categories.root')}</option>{groups.map((group) => <option key={group.id} value={group.id}>{categoryPath(group, active)}</option>)}</Select></div>
        <div className="self-end"><Button className="w-full" onClick={() => void createCategory()}><Plus size={16} />{t('common.add')}</Button></div>
      </div>
    </div>

    <div className="mt-5 rounded-2xl border border-stone-200 p-2 dark:border-stone-800">{roots.length ? roots.map(row) : <div className="px-4 py-10 text-center text-sm text-stone-500">{t('categories.empty')}</div>}</div>
  </Card>
}
