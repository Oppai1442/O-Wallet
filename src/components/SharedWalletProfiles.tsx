import { useEffect, useMemo, useState } from 'react'
import { Archive, Copy, FolderOpen, Home, Mic, Pencil, Plus, RefreshCw, RotateCcw, Trash2, UserPlus, Users, WalletCards } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { useI18n } from '../i18n'
import { formatDateTime, formatMoney } from '../lib/format'
import { googleApiKeyConfigured, openDriveFolderUrl } from '../lib/drive'
import { openTrustedExternalUrl } from '../lib/security'
import {
  cancelSharedWalletDeletion,
  createSharedWallet,
  deleteSharedTransaction,
  finalizeSharedWalletDeletion,
  inviteSharedWalletMember,
  joinSharedWalletInvite,
  loadSharedWallet,
  readSharedInviteFromUrl,
  removeSharedWalletMember,
  renameSharedWallet,
  reopenSharedWalletFromArchive,
  scheduleSharedWalletDeletion,
  updateSharedWalletLedger,
  type SharedWalletLoaded,
} from '../lib/sharedWallet'
import {
  accountLabel,
  buildSharedArchive,
  categoryLabel,
  sharedAccountBalances,
  sharedLedgerOf,
  sharedTotals,
  sharedTransactionsAsPersonalShape,
} from '../lib/sharedLedger'
import type { SharedTransaction, SharedWalletArchive, SharedWalletLedger, SharedWalletMembership, SharedWalletRole } from '../types'
import { Badge, Button, Card, EmptyState, Input, Label, Select } from './ui'
import { LedgerAnalytics } from './LedgerAnalytics'
import { SharedProfileSettings } from './SharedProfileSettings'
import { SharedProfileTransactionModal } from './SharedProfileTransactionModal'

type Tab = 'overview' | 'transactions' | 'analytics' | 'members' | 'settings'

const COPY = {
  vi: {
    profiles: 'Wallet profiles', personal: 'Personal Wallet', personalHint: 'Ví cá nhân chính', sharedHint: 'Shared profile',
    overview: 'Tổng quan', transactions: 'Giao dịch', analytics: 'Phân tích', members: 'Thành viên', settings: 'Cài đặt',
    history: 'Shared history', archived: 'Đã lưu trữ', archiveReadOnly: 'Bản lưu chỉ đọc, tách hoàn toàn khỏi Personal Wallet.',
    reopen: 'Mở lại thành profile mới', deleteArchive: 'Xóa vĩnh viễn bản lưu này?', balance: 'Số dư', recent: 'Giao dịch gần đây',
    closing: 'Profile đang chờ xóa · chỉ đọc', eligible: 'Đủ điều kiện xóa sau', cancelDelete: 'Hủy xóa',
    danger: 'Vùng nguy hiểm', deleteHint: 'Profile chuyển read-only ngay. Sau 90 ngày, mỗi thành viên sẽ nhận archive riêng trong personal vault khi họ mở O-Wallet.',
    scheduleDelete: 'Lên lịch xóa sau 90 ngày', scheduleConfirm: 'Chuyển profile sang read-only và bắt đầu thời gian chờ 90 ngày?',
    analyticsTitle: 'Shared profile analytics', analyticsSubtitle: 'Chỉ phân tích dữ liệu của profile này, không cộng vào Personal Wallet.',
    switchPersonal: 'Mở Personal Wallet', createProfile: 'Tạo shared profile', profileName: 'Tên profile', noProfiles: 'Chưa có shared profile.',
  },
  en: {
    profiles: 'Wallet profiles', personal: 'Personal Wallet', personalHint: 'Primary personal wallet', sharedHint: 'Shared profile',
    overview: 'Overview', transactions: 'Transactions', analytics: 'Analytics', members: 'Members', settings: 'Settings',
    history: 'Shared history', archived: 'Archived', archiveReadOnly: 'This read-only archive is completely isolated from Personal Wallet.',
    reopen: 'Reopen as new profile', deleteArchive: 'Permanently delete this archive?', balance: 'Balance', recent: 'Recent transactions',
    closing: 'Profile scheduled for deletion · read-only', eligible: 'Eligible for deletion after', cancelDelete: 'Cancel deletion',
    danger: 'Danger zone', deleteHint: 'The profile becomes read-only immediately. After 90 days, each member receives an independent archive in their personal vault the next time they open O-Wallet.',
    scheduleDelete: 'Schedule deletion in 90 days', scheduleConfirm: 'Make this profile read-only and start the 90-day deletion window?',
    analyticsTitle: 'Shared profile analytics', analyticsSubtitle: 'Only this profile is analyzed; nothing is added to Personal Wallet.',
    switchPersonal: 'Open Personal Wallet', createProfile: 'Create shared profile', profileName: 'Profile name', noProfiles: 'No shared profiles yet.',
  },
} as const

function copyForLocale(locale: string) {
  return locale.toLocaleLowerCase('en-US').startsWith('vi') ? COPY.vi : COPY.en
}
function groupFromUrl() { return new URL(window.location.href).searchParams.get('group') ?? '' }
function setGroupUrl(groupId: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('page', 'shared')
  if (groupId) url.searchParams.set('group', groupId)
  else url.searchParams.delete('group')
  url.searchParams.delete('action')
  url.hash = ''
  window.history.replaceState({}, '', `${url.pathname}${url.search}`)
}
function openPersonal() {
  const url = new URL(window.location.href)
  url.searchParams.set('page', 'home')
  url.searchParams.delete('group')
  url.searchParams.delete('action')
  window.location.assign(`${url.pathname}${url.search}`)
}
function membershipsEqual(a: SharedWalletMembership, b: SharedWalletMembership) { return JSON.stringify(a) === JSON.stringify(b) }
function sharedUiError(error: unknown, fallback: string) { return error instanceof Error && error.message.startsWith('error.') ? error.message : fallback }

export function SharedWalletProfiles() {
  const { settings, saveEntity, googleSession } = useWallet()
  const { t, locale } = useI18n()
  const L = copyForLocale(locale)
  const memberships = settings?.sharedWallets ?? []
  const archives = settings?.sharedWalletArchives ?? []
  const [selectedId, setSelectedId] = useState(() => groupFromUrl() || memberships[0]?.groupId || '')
  const membership = memberships.find((item) => item.groupId === selectedId)
  const [loaded, setLoaded] = useState<SharedWalletLoaded>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [createName, setCreateName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<SharedWalletRole, 'owner'>>('member')
  const [lastInvite, setLastInvite] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [voiceOnOpen, setVoiceOnOpen] = useState(false)
  const [editTx, setEditTx] = useState<SharedTransaction>()
  const [editName, setEditName] = useState('')
  const [pendingInvite, setPendingInvite] = useState(() => readSharedInviteFromUrl())
  const [archiveView, setArchiveView] = useState<SharedWalletArchive>()

  useEffect(() => {
    if (!selectedId && memberships[0]) { setSelectedId(memberships[0].groupId); setGroupUrl(memberships[0].groupId) }
  }, [memberships, selectedId])

  useEffect(() => {
    if (!pendingInvite) return
    const existing = memberships.find((item) => item.groupId === pendingInvite.groupId)
    if (!existing) return
    setPendingInvite(undefined); setSelectedId(existing.groupId); setGroupUrl(existing.groupId)
  }, [memberships, pendingInvite])

  async function saveMembership(nextMembership: SharedWalletMembership, ownerSecrets?: Record<string, string>) {
    if (!settings) return
    const secrets = { ...(settings.sharedWalletOwnerSecrets ?? {}) }
    if (ownerSecrets) secrets[nextMembership.groupId] = ownerSecrets
    await saveEntity({
      ...settings,
      sharedWallets: [...(settings.sharedWallets ?? []).filter((item) => item.groupId !== nextMembership.groupId), nextMembership],
      sharedWalletOwnerSecrets: secrets,
      updatedAt: new Date().toISOString(),
    })
  }

  async function refresh(target = membership, ownerSecretsOverride?: Record<string, string>) {
    if (!target || !googleSession) return
    setBusy(true); setError('')
    try {
      const result = await loadSharedWallet(googleSession.accessToken, target, ownerSecretsOverride ?? settings?.sharedWalletOwnerSecrets?.[target.groupId] ?? {})
      setLoaded(result); setEditName(result.control.name)
      if (!result.fromSnapshot && !membershipsEqual(result.membership, target)) await saveMembership({ ...result.membership, name: result.control.name })
    } catch (loadError) { setError(sharedUiError(loadError, 'error.sharedLoadFailed')) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    setLoaded(undefined); setTab('overview')
    if (membership && googleSession && googleApiKeyConfigured()) void refresh(membership)
  }, [membership?.groupId, googleSession?.accessToken])

  const aliases = membership ? settings?.sharedWalletAliases?.[membership.groupId] ?? {} : {}
  const memberMap = useMemo(() => new Map((loaded?.control.members ?? []).map((member) => [member.id, member])), [loaded])
  const memberName = (id: string) => aliases[id] || loaded?.profiles?.[id]?.name || memberMap.get(id)?.canonicalName || memberMap.get(id)?.email || t('shared.unknownMember')
  const ledger = loaded ? sharedLedgerOf(loaded.control, settings?.defaultCurrency ?? 'VND') : undefined
  const currency = ledger?.defaultCurrency ?? settings?.defaultCurrency ?? 'VND'
  const totals = sharedTotals(loaded?.transactions ?? [])
  const balances = ledger ? sharedAccountBalances(ledger, loaded?.transactions ?? []) : new Map<string, number>()
  const lifecycle = loaded?.control.lifecycle ?? { state: 'active' as const }
  const readOnly = membership?.role === 'viewer' || Boolean(loaded?.fromSnapshot) || lifecycle.state !== 'active'
  const due = lifecycle.state === 'closing' && Boolean(lifecycle.purgeAfter) && Date.parse(lifecycle.purgeAfter!) <= Date.now()

  async function createGroup() {
    if (!googleSession || !settings || !createName.trim()) return
    setBusy(true); setError('')
    try {
      const created = await createSharedWallet(googleSession.accessToken, googleSession.user, createName)
      await saveEntity({ ...settings, sharedWallets: [...memberships, created.membership], sharedWalletOwnerSecrets: { ...(settings.sharedWalletOwnerSecrets ?? {}), [created.membership.groupId]: created.ownerSecrets }, updatedAt: new Date().toISOString() })
      setCreateName(''); setSelectedId(created.membership.groupId); setGroupUrl(created.membership.groupId)
      setLoaded({ control: created.control, transactions: [], profiles: {}, snapshotCount: 0, membership: created.membership })
    } catch (createError) { setError(sharedUiError(createError, 'error.sharedCreateFailed')) }
    finally { setBusy(false) }
  }

  async function joinInvite() {
    if (!pendingInvite || !googleSession) return
    setBusy(true); setError('')
    try {
      const joined = await joinSharedWalletInvite(googleSession.accessToken, googleSession.user, pendingInvite)
      await saveMembership(joined); setPendingInvite(undefined); setSelectedId(joined.groupId); setGroupUrl(joined.groupId); await refresh(joined)
    } catch (joinError) { setError(sharedUiError(joinError, 'error.sharedJoinFailed')) }
    finally { setBusy(false) }
  }

  async function invite() {
    if (!membership || !googleSession || !settings || !inviteEmail.trim() || readOnly) return
    setBusy(true); setError(''); setLastInvite('')
    try {
      const result = await inviteSharedWalletMember(googleSession.accessToken, membership, settings.sharedWalletOwnerSecrets?.[membership.groupId] ?? {}, inviteEmail, inviteRole)
      await saveMembership(membership, result.ownerSecrets); setLastInvite(result.inviteUrl); setInviteEmail(''); await refresh(membership, result.ownerSecrets)
    } catch (inviteError) { setError(sharedUiError(inviteError, 'error.sharedInviteFailed')) }
    finally { setBusy(false) }
  }

  async function removeMember(id: string) {
    if (!membership || !googleSession || !settings || readOnly || !confirm(t('shared.removeConfirm'))) return
    setBusy(true); setError('')
    try {
      const result = await removeSharedWalletMember(googleSession.accessToken, membership, settings.sharedWalletOwnerSecrets?.[membership.groupId] ?? {}, id)
      await saveMembership(result.membership, result.ownerSecrets); await refresh(result.membership, result.ownerSecrets)
    } catch (removeError) { setError(sharedUiError(removeError, 'error.sharedRemoveFailed')) }
    finally { setBusy(false) }
  }

  async function saveAlias(id: string, value: string) {
    if (!settings || !membership) return
    const all = { ...(settings.sharedWalletAliases ?? {}) }
    const group = { ...(all[membership.groupId] ?? {}) }
    if (value.trim()) group[id] = value.trim().slice(0, 80); else delete group[id]
    all[membership.groupId] = group
    await saveEntity({ ...settings, sharedWalletAliases: all, updatedAt: new Date().toISOString() })
  }

  async function removeTransaction(id: string) {
    if (!membership || !googleSession || readOnly || !confirm(t('shared.deleteTransactionConfirm'))) return
    await deleteSharedTransaction(googleSession.accessToken, membership, id); await refresh(membership)
  }

  async function rename() {
    if (!membership || !googleSession || !settings || membership.role !== 'owner' || readOnly) return
    const result = await renameSharedWallet(googleSession.accessToken, membership, settings.sharedWalletOwnerSecrets?.[membership.groupId] ?? {}, editName)
    await saveMembership(result.membership)
    setLoaded((current) => current ? { ...current, control: result.control, membership: result.membership } : current)
  }

  async function saveLedger(next: SharedWalletLedger) {
    if (!membership || !googleSession || !settings || membership.role !== 'owner' || readOnly) return
    const result = await updateSharedWalletLedger(googleSession.accessToken, membership, settings.sharedWalletOwnerSecrets?.[membership.groupId] ?? {}, next)
    setLoaded((current) => current ? { ...current, control: result.control, membership: result.membership } : current)
  }

  async function scheduleDelete() {
    if (!membership || !loaded || !googleSession || !settings || membership.role !== 'owner' || !confirm(L.scheduleConfirm)) return
    const result = await scheduleSharedWalletDeletion(googleSession.accessToken, membership, settings.sharedWalletOwnerSecrets?.[membership.groupId] ?? {}, loaded.transactions)
    setLoaded({ ...loaded, control: result.control, membership: result.membership })
  }

  async function cancelDelete() {
    if (!membership || !loaded || !googleSession || !settings || membership.role !== 'owner') return
    const result = await cancelSharedWalletDeletion(googleSession.accessToken, membership, settings.sharedWalletOwnerSecrets?.[membership.groupId] ?? {})
    setLoaded({ ...loaded, control: result.control, membership: result.membership })
  }

  async function archiveAndFinalize() {
    if (!membership || !loaded || !googleSession || !settings || !due) return
    const names = Object.fromEntries(loaded.control.members.map((member) => [member.id, memberName(member.id)]))
    const archive = buildSharedArchive(loaded.control, loaded.transactions, names)
    const nextArchives = [...archives.filter((item) => item.originalGroupId !== membership.groupId), archive]
    await saveEntity({ ...settings, sharedWalletArchives: nextArchives, updatedAt: new Date().toISOString() })
    await finalizeSharedWalletDeletion(googleSession.accessToken, membership, settings.sharedWalletOwnerSecrets?.[membership.groupId] ?? {})
    const secrets = { ...(settings.sharedWalletOwnerSecrets ?? {}) }; delete secrets[membership.groupId]
    const nextAliases = { ...(settings.sharedWalletAliases ?? {}) }; delete nextAliases[membership.groupId]
    await saveEntity({ ...settings, sharedWalletArchives: nextArchives, sharedWallets: memberships.filter((item) => item.groupId !== membership.groupId), sharedWalletOwnerSecrets: secrets, sharedWalletAliases: nextAliases, updatedAt: new Date().toISOString() })
    setLoaded(undefined); setSelectedId(''); setGroupUrl(''); setArchiveView(archive)
  }

  useEffect(() => { if (due && !busy) void archiveAndFinalize() }, [due, membership?.groupId])

  async function deleteArchive(archive: SharedWalletArchive) {
    if (!settings || !confirm(L.deleteArchive)) return
    await saveEntity({ ...settings, sharedWalletArchives: archives.filter((item) => item.id !== archive.id), updatedAt: new Date().toISOString() }); setArchiveView(undefined)
  }

  async function reopenArchive(archive: SharedWalletArchive) {
    if (!settings || !googleSession) return
    const created = await reopenSharedWalletFromArchive(googleSession.accessToken, googleSession.user, archive)
    await saveEntity({ ...settings, sharedWallets: [...memberships, created.membership], sharedWalletOwnerSecrets: { ...(settings.sharedWalletOwnerSecrets ?? {}), [created.membership.groupId]: created.ownerSecrets }, updatedAt: new Date().toISOString() })
    setArchiveView(undefined); setSelectedId(created.membership.groupId); setGroupUrl(created.membership.groupId)
    setLoaded({ control: created.control, transactions: created.transactions, profiles: {}, snapshotCount: created.transactions.length, membership: created.membership })
  }

  if (archiveView) return <ArchiveProfile archive={archiveView} onBack={() => setArchiveView(undefined)} onDelete={() => void deleteArchive(archiveView)} onReopen={() => void reopenArchive(archiveView)} />

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><div className="text-xs font-semibold uppercase tracking-[.14em] text-stone-400">{L.profiles}</div><h1 className="mt-1 text-2xl font-semibold tracking-tight">{membership ? loaded?.control.name ?? membership.name : t('shared.title')}</h1><p className="mt-1 text-sm text-stone-500">{membership ? L.sharedHint : t('shared.subtitle')}</p></div>
      {membership && googleSession && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} className={busy ? 'animate-spin' : ''}/>{t('shared.refresh')}</Button><Button variant="secondary" onClick={() => { setVoiceOnOpen(true); setShowAdd(true) }} disabled={readOnly}><Mic size={16}/>{t('voice.entryButton')}</Button><Button onClick={() => { setVoiceOnOpen(false); setShowAdd(true) }} disabled={readOnly}><Plus size={16}/>{t('common.add')}</Button></div>}
    </div>

    {pendingInvite && <Card className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="font-semibold">{pendingInvite.groupName}</div><div className="text-xs text-stone-500">{t('shared.inviteFor', { email: pendingInvite.invitedEmail })}</div></div><Button onClick={() => void joinInvite()} disabled={busy}><Users size={16}/>{t('shared.join')}</Button></Card>}
    {!googleApiKeyConfigured() && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{t('shared.apiKeyMissingText')}</div>}
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-500/10 dark:text-rose-300">{t(error)}</div>}

    {!googleSession ? <EmptyState title={t('shared.googleRequiredTitle')} text={t('shared.googleRequiredText')} /> : <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <Card className="p-3">
          <div className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold"><WalletCards size={16}/>{L.profiles}</div>
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-900" onClick={openPersonal}><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"><Home size={16}/></span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{L.personal}</span><span className="block text-[11px] text-stone-400">{L.personalHint}</span></span></button>
          <div className="my-2 border-t border-stone-100 dark:border-stone-800"/>
          {memberships.map((item) => <button key={item.groupId} className={`w-full rounded-xl px-3 py-2.5 text-left ${item.groupId === selectedId ? 'bg-stone-100 dark:bg-stone-900' : 'hover:bg-stone-50 dark:hover:bg-stone-900/60'}`} onClick={() => { setSelectedId(item.groupId); setGroupUrl(item.groupId) }}><div className="truncate text-sm font-semibold">{item.name}</div><div className="mt-0.5 text-[11px] text-stone-400">{L.sharedHint} · {t(`shared.role.${item.role}`)}</div></button>)}
          {memberships.length === 0 && <div className="px-3 py-3 text-xs text-stone-500">{L.noProfiles}</div>}
        </Card>
        <Card className="p-4"><Label>{L.profileName}</Label><Input value={createName} onChange={(event) => setCreateName(event.target.value)} maxLength={120}/><Button className="mt-3 w-full" onClick={() => void createGroup()} disabled={busy || !createName.trim()}><Plus size={16}/>{L.createProfile}</Button></Card>
        {archives.length > 0 && <Card className="p-3"><div className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold"><Archive size={16}/>{L.history}</div>{archives.map((archive) => <button key={archive.id} className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-900" onClick={() => setArchiveView(archive)}><div className="truncate font-medium">{archive.name}</div><div className="text-[11px] text-stone-400">{new Date(archive.closedAt).toLocaleDateString(locale)}</div></button>)}</Card>}
      </aside>

      {!membership ? <EmptyState title={t('shared.emptyTitle')} text={t('shared.emptyText')} /> : <main className="min-w-0 space-y-5">
        {lifecycle.state === 'closing' && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300"><div className="font-semibold">{L.closing}</div><div className="mt-1">{L.eligible} {new Date(lifecycle.purgeAfter!).toLocaleString(locale)}</div>{membership.role === 'owner' && <Button variant="ghost" className="mt-2" onClick={() => void cancelDelete()}><RotateCcw size={14}/>{L.cancelDelete}</Button>}</div>}
        <ProfileHeader loaded={loaded} membership={membership} balances={balances} totals={totals} currency={currency} readOnly={readOnly}/>
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-stone-200 p-1 dark:border-stone-800">{(['overview','transactions','analytics','members','settings'] as Tab[]).map((id) => <button key={id} className={`shrink-0 rounded-lg px-3 py-2 text-sm ${tab === id ? 'bg-stone-950 text-white dark:bg-white dark:text-stone-950' : 'text-stone-500'}`} onClick={() => setTab(id)}>{L[id]}</button>)}</div>
        {tab === 'overview' && <Overview ledger={ledger} balances={balances} transactions={loaded?.transactions ?? []} currency={currency}/>} 
        {tab === 'transactions' && <TransactionList loaded={loaded} membership={membership} ledger={ledger} readOnly={readOnly} memberName={memberName} onEdit={setEditTx} onDelete={(id) => void removeTransaction(id)}/>} 
        {tab === 'analytics' && ledger && <LedgerAnalytics transactions={sharedTransactionsAsPersonalShape(loaded?.transactions ?? [])} categories={ledger.categories} currency={currency} title={L.analyticsTitle} subtitle={L.analyticsSubtitle}/>} 
        {tab === 'members' && <Members loaded={loaded} membership={membership} aliases={aliases} readOnly={readOnly} inviteEmail={inviteEmail} setInviteEmail={setInviteEmail} inviteRole={inviteRole} setInviteRole={setInviteRole} lastInvite={lastInvite} onInvite={() => void invite()} onAlias={(id, value) => void saveAlias(id, value)} onRemove={(id) => void removeMember(id)}/>} 
        {tab === 'settings' && ledger && <div className="space-y-5"><Card className="p-4 sm:p-5"><div className="flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1"><Label>{L.profileName}</Label><Input value={editName} onChange={(event) => setEditName(event.target.value)} disabled={membership.role !== 'owner' || readOnly}/></div><Button onClick={() => void rename()} disabled={membership.role !== 'owner' || readOnly || !editName.trim()}>{t('common.save')}</Button></div></Card><SharedProfileSettings ledger={ledger} transactions={loaded?.transactions ?? []} editable={membership.role === 'owner' && !readOnly} onSaveLedger={saveLedger}/>{membership.role === 'owner' && !readOnly && <Card className="border-rose-200 p-4 dark:border-rose-900"><div className="font-semibold text-rose-600">{L.danger}</div><p className="mt-1 text-sm text-stone-500">{L.deleteHint}</p><Button variant="secondary" className="mt-3 text-rose-600" onClick={() => void scheduleDelete()}><Trash2 size={15}/>{L.scheduleDelete}</Button></Card>}</div>}
      </main>}
    </div>}

    {(showAdd || editTx) && membership && googleSession && ledger && !readOnly && <SharedProfileTransactionModal membership={membership} ledger={ledger} transactions={loaded?.transactions ?? []} transaction={editTx} initialVoice={voiceOnOpen} onClose={() => { setShowAdd(false); setVoiceOnOpen(false); setEditTx(undefined) }} onSaved={() => void refresh(membership)} onSaveLedger={saveLedger}/>} 
  </div>
}

function ProfileHeader({ loaded, membership, balances, totals, currency, readOnly }: { loaded?: SharedWalletLoaded; membership: SharedWalletMembership; balances: Map<string, number>; totals: { income: number; expense: number; net: number }; currency: string; readOnly: boolean }) {
  const { t, locale } = useI18n(); const L = copyForLocale(locale)
  return <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{loaded?.control.name ?? membership.name}</h2><Badge>{t(`shared.role.${membership.role}`)}</Badge>{readOnly && <Badge tone="amber">Read-only</Badge>}</div><p className="mt-1 text-xs text-stone-500">{t('shared.distributedStorage')}</p></div><Button variant="ghost" onClick={() => openTrustedExternalUrl(openDriveFolderUrl(membership.localRootId))}><FolderOpen size={15}/>{t('shared.openMyFolder')}</Button></div><div className="mt-4 grid gap-3 sm:grid-cols-4"><Stat label={t('shared.income')} value={formatMoney(totals.income,currency,locale)} tone="green"/><Stat label={t('shared.expense')} value={formatMoney(totals.expense,currency,locale)} tone="red"/><Stat label={t('shared.net')} value={formatMoney(totals.net,currency,locale)}/><Stat label={L.balance} value={formatMoney([...balances.values()].reduce((sum,value)=>sum+value,0),currency,locale)}/></div></Card>
}
function Stat({label,value,tone}:{label:string;value:string;tone?:'green'|'red'}) { return <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900"><div className="text-xs text-stone-500">{label}</div><div className={`mt-1 font-semibold ${tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-rose-600' : ''}`}>{value}</div></div> }
function Overview({ ledger, balances, transactions, currency }: { ledger?: SharedWalletLedger; balances: Map<string, number>; transactions: SharedTransaction[]; currency: string }) {
  const { t, locale } = useI18n(); const L = copyForLocale(locale)
  const activeAccounts = ledger?.accounts.filter((item) => !item.deleted && !item.archived) ?? []
  return <div className="grid gap-5 lg:grid-cols-2"><Card className="p-4"><div className="font-semibold">{t('settings.accounts')}</div><div className="mt-3 space-y-2">{activeAccounts.map((account) => <div key={account.id} className="flex justify-between gap-3 text-sm"><span className="truncate">{account.name}</span><span>{formatMoney(balances.get(account.id) ?? account.openingBalance, account.currency || currency, locale)}</span></div>)}{activeAccounts.length === 0 && <div className="text-sm text-stone-500">{t('accounts.empty')}</div>}</div></Card><Card className="p-4"><div className="font-semibold">{L.recent}</div><div className="mt-3 space-y-2">{transactions.slice(0,8).map((tx) => <div key={`${tx.createdByMemberId}:${tx.id}`} className="flex justify-between gap-3 text-sm"><span className="truncate">{tx.merchant || tx.description || t('transaction.noDescription')}</span><span>{formatMoney(tx.amount,tx.currency,locale)}</span></div>)}</div></Card></div>
}
function TransactionList({ loaded, membership, ledger, readOnly, memberName, onEdit, onDelete }: { loaded?: SharedWalletLoaded; membership: SharedWalletMembership; ledger?: SharedWalletLedger; readOnly: boolean; memberName: (id:string)=>string; onEdit:(tx:SharedTransaction)=>void; onDelete:(id:string)=>void }) {
  const { t, locale } = useI18n()
  if (!loaded?.transactions.length) return <Card className="p-4"><EmptyState title={t('shared.noTransactions')} text={t('shared.noTransactionsText')}/></Card>
  return <Card className="overflow-hidden"><div className="divide-y divide-stone-100 dark:divide-stone-800">{loaded.transactions.map((tx) => { const own = tx.createdByMemberId === membership.memberId; return <div key={`${tx.createdByMemberId}:${tx.id}`} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap gap-2"><span className="truncate font-semibold">{tx.merchant || tx.description || t('transaction.noDescription')}</span><Badge tone={tx.type === 'income' ? 'green' : tx.type === 'expense' ? 'red' : 'slate'}>{t(`transaction.${tx.type}`)}</Badge></div><div className="mt-1 flex flex-wrap gap-x-2 text-xs text-stone-500"><span>{formatDateTime(tx.occurredAt,locale)}</span><span>{categoryLabel(tx.categoryId,ledger?.categories??[]) || tx.category || t('categories.uncategorized')}</span><span>{accountLabel(tx.accountId,ledger?.accounts??[])}</span><span>{tx.sourceCreatedByName || memberName(tx.createdByMemberId)}</span></div></div><div className={`font-semibold ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'expense' ? 'text-rose-600' : ''}`}>{tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{formatMoney(tx.amount,tx.currency,locale)}</div><div className="flex justify-end gap-1">{own && !readOnly && <><Button variant="ghost" className="px-2" onClick={() => onEdit(tx)}><Pencil size={15}/></Button><Button variant="ghost" className="px-2 text-rose-500" onClick={() => onDelete(tx.id)}><Trash2 size={15}/></Button></>}</div></div> })}</div></Card>
}
function Members({ loaded, membership, aliases, readOnly, inviteEmail, setInviteEmail, inviteRole, setInviteRole, lastInvite, onInvite, onAlias, onRemove }: { loaded?:SharedWalletLoaded; membership:SharedWalletMembership; aliases:Record<string,string>; readOnly:boolean; inviteEmail:string; setInviteEmail:(value:string)=>void; inviteRole:Exclude<SharedWalletRole,'owner'>; setInviteRole:(value:Exclude<SharedWalletRole,'owner'>)=>void; lastInvite:string; onInvite:()=>void; onAlias:(id:string,value:string)=>void; onRemove:(id:string)=>void }) {
  const { t } = useI18n()
  return <Card className="p-4"><div className="grid gap-3 lg:grid-cols-2">{loaded?.control.members.map((member) => <div key={member.id} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800"><div className="flex justify-between gap-2"><div className="min-w-0"><div className="truncate text-sm font-semibold">{aliases[member.id] || member.canonicalName || member.email}</div><div className="truncate text-[11px] text-stone-400">{member.email}</div></div><Badge>{t(`shared.role.${member.role}`)}</Badge></div><Input className="mt-2" defaultValue={aliases[member.id] ?? ''} onBlur={(event) => onAlias(member.id,event.target.value)}/>{membership.role === 'owner' && member.id !== loaded.control.ownerMemberId && !readOnly && <Button variant="ghost" className="mt-2 text-rose-500" onClick={() => onRemove(member.id)}><Trash2 size={14}/>{t('shared.removeMember')}</Button>}</div>)}</div>{membership.role === 'owner' && !readOnly && <div className="mt-5 border-t border-stone-200 pt-4 dark:border-stone-800"><div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]"><Input type="email" value={inviteEmail} onChange={(event)=>setInviteEmail(event.target.value)} placeholder="name@gmail.com"/><Select value={inviteRole} onChange={(event)=>setInviteRole(event.target.value as Exclude<SharedWalletRole,'owner'>)}><option value="member">{t('shared.role.member')}</option><option value="viewer">{t('shared.role.viewer')}</option></Select><Button onClick={onInvite}><UserPlus size={15}/>{t('shared.sendInvite')}</Button></div>{lastInvite && <Button variant="ghost" className="mt-2" onClick={() => void navigator.clipboard.writeText(lastInvite)}><Copy size={14}/>{t('common.copy')}</Button>}</div>}</Card>
}
function ArchiveProfile({ archive, onBack, onDelete, onReopen }: { archive:SharedWalletArchive; onBack:()=>void; onDelete:()=>void; onReopen:()=>void }) {
  const { t, locale } = useI18n(); const L = copyForLocale(locale); const [tab,setTab] = useState<'overview'|'transactions'|'analytics'>('overview')
  return <div className="space-y-5"><div className="flex flex-wrap justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><Archive size={20}/><h1 className="text-2xl font-semibold">{archive.name}</h1><Badge>{L.archived}</Badge></div><p className="mt-1 text-sm text-stone-500">{L.archiveReadOnly}</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={onBack}>{t('common.back')}</Button><Button variant="secondary" onClick={onReopen}><RotateCcw size={15}/>{L.reopen}</Button><Button variant="ghost" className="text-rose-600" onClick={onDelete}><Trash2 size={15}/>{t('common.delete')}</Button></div></div><div className="flex gap-1 rounded-xl border border-stone-200 p-1 dark:border-stone-800">{(['overview','transactions','analytics'] as const).map((id) => <button key={id} className={`rounded-lg px-3 py-2 text-sm ${tab === id ? 'bg-stone-950 text-white dark:bg-white dark:text-stone-950' : ''}`} onClick={() => setTab(id)}>{L[id]}</button>)}</div>{tab === 'overview' && <Overview ledger={archive.ledger} balances={new Map(Object.entries(archive.finalBalances))} transactions={archive.transactions} currency={archive.ledger.defaultCurrency}/>} {tab === 'transactions' && <Card className="overflow-hidden"><div className="divide-y divide-stone-100 dark:divide-stone-800">{archive.transactions.map((tx) => <div key={`${tx.createdByMemberId}:${tx.id}`} className="flex justify-between gap-3 p-3 text-sm"><span className="min-w-0 truncate">{tx.merchant || tx.description || t('transaction.noDescription')} · {archive.memberNames[tx.createdByMemberId]}</span><span>{formatMoney(tx.amount,tx.currency,locale)}</span></div>)}</div></Card>} {tab === 'analytics' && <LedgerAnalytics transactions={sharedTransactionsAsPersonalShape(archive.transactions)} categories={archive.ledger.categories} currency={archive.ledger.defaultCurrency} title={L.analyticsTitle} subtitle={L.archiveReadOnly}/>}</div>
}
