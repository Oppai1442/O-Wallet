import { useEffect, useMemo, useState } from 'react'
import { Copy, FolderOpen, Mail, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus, Users, WalletCards, X } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { useI18n } from '../i18n'
import { formatDateTime, formatMoney } from '../lib/format'
import { googleApiKeyConfigured, openDriveFolderUrl } from '../lib/drive'
import { openTrustedExternalUrl } from '../lib/security'
import {
  createSharedWallet,
  deleteSharedTransaction,
  inviteSharedWalletMember,
  joinSharedWalletInvite,
  loadSharedWallet,
  readSharedInviteFromUrl,
  removeSharedWalletMember,
  saveSharedTransaction,
  type SharedWalletLoaded,
} from '../lib/sharedWallet'
import type { AppSettings, SharedTransaction, SharedWalletMembership, SharedWalletRole } from '../types'
import { Badge, Button, Card, EmptyState, Input, Label, Select, Textarea } from './ui'

function localDateTimeValue(iso?: string) {
  const date = iso ? new Date(iso) : new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function groupFromUrl() {
  return new URL(window.location.href).searchParams.get('group') ?? ''
}

function setGroupUrl(groupId: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('page', 'shared')
  if (groupId) url.searchParams.set('group', groupId)
  else url.searchParams.delete('group')
  url.searchParams.delete('action')
  url.hash = ''
  window.history.replaceState({}, '', `${url.pathname}${url.search}`)
}

function membershipsEqual(a: SharedWalletMembership, b: SharedWalletMembership) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function sharedUiError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.startsWith('error.')) return error.message
  return fallback
}

export function SharedWallets() {
  const { settings, saveEntity, googleSession } = useWallet()
  const { t, locale } = useI18n()
  const memberships = settings?.sharedWallets ?? []
  const [selectedId, setSelectedId] = useState(() => groupFromUrl() || memberships[0]?.groupId || '')
  const membership = memberships.find((item) => item.groupId === selectedId)
  const [loaded, setLoaded] = useState<SharedWalletLoaded>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [createName, setCreateName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<SharedWalletRole, 'owner'>>('member')
  const [lastInvite, setLastInvite] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editTx, setEditTx] = useState<SharedTransaction>()
  const [pendingInvite, setPendingInvite] = useState(() => readSharedInviteFromUrl())

  useEffect(() => {
    if (!selectedId && memberships[0]) {
      setSelectedId(memberships[0].groupId)
      setGroupUrl(memberships[0].groupId)
    }
  }, [memberships, selectedId])

  useEffect(() => {
    if (!pendingInvite) return
    const existing = memberships.find((item) => item.groupId === pendingInvite.groupId)
    if (!existing) return
    setPendingInvite(undefined)
    setSelectedId(existing.groupId)
    setGroupUrl(existing.groupId)
  }, [memberships, pendingInvite])

  async function saveMembership(
    nextMembership: SharedWalletMembership,
    ownerSecrets?: Record<string, string>,
  ) {
    if (!settings) return
    const nextSecrets = { ...(settings.sharedWalletOwnerSecrets ?? {}) }
    if (ownerSecrets) nextSecrets[nextMembership.groupId] = ownerSecrets
    const next: AppSettings = {
      ...settings,
      sharedWallets: [
        ...(settings.sharedWallets ?? []).filter((item) => item.groupId !== nextMembership.groupId),
        nextMembership,
      ],
      sharedWalletOwnerSecrets: nextSecrets,
      updatedAt: new Date().toISOString(),
    }
    await saveEntity(next)
  }

  async function refreshGroup(target = membership, ownerSecretsOverride?: Record<string, string>) {
    if (!target || !googleSession) return
    setBusy(true)
    setError('')
    try {
      const ownerSecrets = ownerSecretsOverride ?? settings?.sharedWalletOwnerSecrets?.[target.groupId] ?? {}
      const result = await loadSharedWallet(googleSession.accessToken, target, ownerSecrets)
      setLoaded(result)
      if (!result.fromSnapshot && !membershipsEqual(result.membership, target)) {
        await saveMembership(result.membership)
      }
    } catch (loadError) {
      setError(sharedUiError(loadError, 'error.sharedLoadFailed'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setLoaded(undefined)
    if (membership && googleSession && googleApiKeyConfigured()) void refreshGroup(membership)
    // groupId is intentional: aliases and ordinary settings changes must not refetch the group.
  }, [membership?.groupId, googleSession?.accessToken])

  async function joinInvite() {
    if (!pendingInvite || !googleSession || !settings) return
    setBusy(true)
    setError('')
    try {
      const joined = await joinSharedWalletInvite(googleSession.accessToken, googleSession.user, pendingInvite)
      await saveMembership(joined)
      setPendingInvite(undefined)
      setSelectedId(joined.groupId)
      setGroupUrl(joined.groupId)
      await refreshGroup(joined)
    } catch (joinError) {
      setError(sharedUiError(joinError, 'error.sharedJoinFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function createGroup() {
    if (!googleSession || !settings || !createName.trim()) return
    if (!googleApiKeyConfigured()) { setError('error.sharedApiKeyMissing'); return }
    setBusy(true)
    setError('')
    try {
      const created = await createSharedWallet(googleSession.accessToken, googleSession.user, createName)
      const nextSettings: AppSettings = {
        ...settings,
        sharedWallets: [...(settings.sharedWallets ?? []), created.membership],
        sharedWalletOwnerSecrets: {
          ...(settings.sharedWalletOwnerSecrets ?? {}),
          [created.membership.groupId]: created.ownerSecrets,
        },
        updatedAt: new Date().toISOString(),
      }
      await saveEntity(nextSettings)
      setCreateName('')
      setSelectedId(created.membership.groupId)
      setGroupUrl(created.membership.groupId)
      setLoaded({ control: created.control, transactions: [], profiles: {}, snapshotCount: 0, membership: created.membership })
    } catch (createError) {
      setError(sharedUiError(createError, 'error.sharedCreateFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function invite() {
    if (!membership || !googleSession || !settings || !inviteEmail.trim()) return
    const ownerSecrets = settings.sharedWalletOwnerSecrets?.[membership.groupId] ?? {}
    setBusy(true)
    setError('')
    setLastInvite('')
    try {
      const result = await inviteSharedWalletMember(
        googleSession.accessToken,
        membership,
        ownerSecrets,
        inviteEmail,
        inviteRole,
      )
      await saveMembership(membership, result.ownerSecrets)
      setLastInvite(result.inviteUrl)
      setInviteEmail('')
      await refreshGroup(membership, result.ownerSecrets)
    } catch (inviteError) {
      setError(sharedUiError(inviteError, 'error.sharedInviteFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(memberId: string) {
    if (!membership || !googleSession || !settings) return
    if (!confirm(t('shared.removeConfirm'))) return
    setBusy(true)
    setError('')
    try {
      const result = await removeSharedWalletMember(
        googleSession.accessToken,
        membership,
        settings.sharedWalletOwnerSecrets?.[membership.groupId] ?? {},
        memberId,
      )
      await saveMembership(result.membership, result.ownerSecrets)
      await refreshGroup(result.membership, result.ownerSecrets)
    } catch (removeError) {
      setError(sharedUiError(removeError, 'error.sharedRemoveFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function saveAlias(memberId: string, value: string) {
    if (!settings || !membership) return
    const all = { ...(settings.sharedWalletAliases ?? {}) }
    const group = { ...(all[membership.groupId] ?? {}) }
    if (value.trim()) group[memberId] = value.trim().slice(0, 80)
    else delete group[memberId]
    all[membership.groupId] = group
    await saveEntity({ ...settings, sharedWalletAliases: all, updatedAt: new Date().toISOString() })
  }

  async function removeTransaction(id: string) {
    if (!membership || !googleSession || loaded?.fromSnapshot) return
    if (!confirm(t('shared.deleteTransactionConfirm'))) return
    setBusy(true)
    setError('')
    try {
      await deleteSharedTransaction(googleSession.accessToken, membership, id)
      await refreshGroup(membership)
    } catch (deleteError) {
      setError(sharedUiError(deleteError, 'error.sharedSaveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const aliases = membership ? settings?.sharedWalletAliases?.[membership.groupId] ?? {} : {}
  const memberMap = useMemo(
    () => new Map((loaded?.control.members ?? []).map((member) => [member.id, member])),
    [loaded],
  )
  const memberLabel = (memberId: string) => {
    const member = memberMap.get(memberId)
    const profile = loaded?.profiles[memberId]
    return aliases[memberId] || profile?.name || member?.canonicalName || member?.email || t('shared.unknownMember')
  }
  const now = Date.now()
  const activeTransactions = loaded?.transactions.filter((tx) => Date.parse(tx.occurredAt) <= now) ?? []
  const totals = activeTransactions.reduce((acc, tx) => {
    if (tx.type === 'income') acc.income += tx.amount
    else acc.expense += tx.amount
    return acc
  }, { income: 0, expense: 0 })
  const currency = loaded?.transactions[0]?.currency ?? settings?.defaultCurrency ?? 'VND'
  const readOnly = membership?.role === 'viewer' || Boolean(loaded?.fromSnapshot)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-white">{t('shared.title')}</h1>
          <p className="mt-1 text-sm text-stone-500">{t('shared.subtitle')}</p>
        </div>
        {membership && googleSession && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void refreshGroup()} disabled={busy}>
              <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> {t('shared.refresh')}
            </Button>
            <Button onClick={() => setShowAdd(true)} disabled={readOnly}>
              <Plus size={17} /> {t('shared.addTransaction')}
            </Button>
          </div>
        )}
      </div>

      {pendingInvite && (
        <Card className="border-stone-300 p-4 dark:border-stone-700 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold"><Mail size={17} /> {t('shared.inviteDetected')}</div>
              <div className="mt-2 truncate text-lg font-semibold">{pendingInvite.groupName}</div>
              <p className="mt-1 text-sm text-stone-500">{t('shared.inviteFor', { email: pendingInvite.invitedEmail })}</p>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-stone-500">{t('shared.joinPickerHint')}</p>
            </div>
            <Button onClick={() => void joinInvite()} disabled={busy || !googleSession || !googleApiKeyConfigured()}>
              <Users size={17} /> {t('shared.join')}
            </Button>
          </div>
        </Card>
      )}

      {!googleApiKeyConfigured() && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300">
          {t('shared.apiKeyMissingText')}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-500/10 dark:text-rose-300">
          {t(error)}
        </div>
      )}

      {!googleSession ? (
        <EmptyState title={t('shared.googleRequiredTitle')} text={t('shared.googleRequiredText')} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card className="p-3">
              <div className="mb-3 flex items-center gap-2 px-1"><WalletCards size={17} /><span className="text-sm font-semibold">{t('shared.wallets')}</span></div>
              <div className="space-y-1">
                {memberships.map((item) => (
                  <button
                    key={item.groupId}
                    onClick={() => { setSelectedId(item.groupId); setGroupUrl(item.groupId) }}
                    className={`w-full rounded-xl px-3 py-2.5 text-left text-sm ${selectedId === item.groupId ? 'bg-stone-100 font-semibold text-stone-950 dark:bg-stone-900 dark:text-white' : 'text-stone-600 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-900/60'}`}
                  >
                    <div className="truncate">{item.name}</div>
                    <div className="mt-0.5 text-[11px] text-stone-400">{t(`shared.role.${item.role}`)}</div>
                  </button>
                ))}
                {memberships.length === 0 && <div className="px-2 py-3 text-xs text-stone-500">{t('shared.noWallets')}</div>}
              </div>
            </Card>
            <Card className="p-4">
              <Label>{t('shared.createName')}</Label>
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder={t('shared.createPlaceholder')} maxLength={120} />
              <Button className="mt-3 w-full" onClick={() => void createGroup()} disabled={busy || !createName.trim() || !googleApiKeyConfigured()}>
                <Plus size={16} /> {t('shared.create')}
              </Button>
            </Card>
          </div>

          {!membership ? (
            <EmptyState title={t('shared.emptyTitle')} text={t('shared.emptyText')} />
          ) : (
            <div className="min-w-0 space-y-5">
              {loaded?.fromSnapshot && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300">
                  {t('shared.snapshotFallback')}
                </div>
              )}

              <Card className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2"><h2 className="text-xl font-semibold">{loaded?.control.name ?? membership.name}</h2><Badge>{t(`shared.role.${membership.role}`)}</Badge></div>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-stone-500">{t('shared.distributedStorage')}</p>
                  </div>
                  <Button variant="ghost" onClick={() => openTrustedExternalUrl(openDriveFolderUrl(membership.localRootId))}>
                    <FolderOpen size={16} /> {t('shared.openMyFolder')}
                  </Button>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900"><div className="text-xs text-stone-500">{t('shared.income')}</div><div className="mt-1 text-lg font-semibold text-emerald-600">{formatMoney(totals.income, currency, locale)}</div></div>
                  <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900"><div className="text-xs text-stone-500">{t('shared.expense')}</div><div className="mt-1 text-lg font-semibold text-rose-600">{formatMoney(totals.expense, currency, locale)}</div></div>
                  <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900"><div className="text-xs text-stone-500">{t('shared.net')}</div><div className="mt-1 text-lg font-semibold">{formatMoney(totals.income - totals.expense, currency, locale)}</div></div>
                </div>
                {loaded && <div className="mt-3 text-xs text-stone-400">{t('shared.snapshotHint', { count: loaded.snapshotCount })}</div>}
              </Card>

              <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
                <Card className="overflow-hidden">
                  <div className="border-b border-stone-200 px-4 py-3 text-sm font-semibold dark:border-stone-800">{t('shared.transactions')} · {loaded?.transactions.length ?? 0}</div>
                  {!loaded || loaded.transactions.length === 0 ? (
                    <div className="p-4"><EmptyState title={t('shared.noTransactions')} text={t('shared.noTransactionsText')} /></div>
                  ) : (
                    <div className="divide-y divide-stone-100 dark:divide-stone-800">
                      {loaded.transactions.map((tx) => {
                        const own = tx.createdByMemberId === membership.memberId
                        return (
                          <div key={`${tx.createdByMemberId}:${tx.id}`} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-center">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2"><span className="truncate font-medium">{tx.merchant || tx.description || t('transaction.noDescription')}</span><Badge tone={tx.type === 'income' ? 'green' : 'red'}>{t(`transaction.${tx.type}`)}</Badge></div>
                              <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-stone-500"><span>{formatDateTime(tx.occurredAt, locale)}</span>{tx.category && <span>{tx.category}</span>}<span>{t('shared.createdBy', { name: memberLabel(tx.createdByMemberId) })}</span></div>
                            </div>
                            <div className={`font-semibold ${tx.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>{tx.type === 'income' ? '+' : '-'}{formatMoney(tx.amount, tx.currency, locale)}</div>
                            <div className="flex justify-end gap-1">
                              {own && !loaded.fromSnapshot && membership.role !== 'viewer' && <>
                                <Button variant="ghost" className="px-2" onClick={() => setEditTx(tx)}><Pencil size={16} /></Button>
                                <Button variant="ghost" className="px-2 text-rose-500" onClick={() => void removeTransaction(tx.id)}><Trash2 size={16} /></Button>
                              </>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-2"><Users size={17} /><h3 className="font-semibold">{t('shared.members')}</h3></div>
                  <p className="mt-1 text-xs leading-5 text-stone-500">{t('shared.nicknameHint')}</p>
                  <div className="mt-4 space-y-3">
                    {loaded?.control.members.map((member) => {
                      const profile = loaded.profiles[member.id]
                      const canonical = profile?.name || member.canonicalName || member.email
                      return (
                        <div key={member.id} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{aliases[member.id] || canonical}</div>
                              <div className="truncate text-[11px] text-stone-400">{member.email}</div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-1"><Badge>{t(`shared.role.${member.role}`)}</Badge>{member.status === 'invited' && <Badge tone="amber">{t('shared.pending')}</Badge>}{member.status === 'removed' && <Badge tone="red">{t('shared.removed')}</Badge>}</div>
                          </div>
                          <Input className="mt-2" defaultValue={aliases[member.id] ?? ''} placeholder={t('shared.nicknamePlaceholder')} onBlur={(e) => void saveAlias(member.id, e.target.value)} />
                          {membership.role === 'owner' && member.id !== loaded.control.ownerMemberId && !loaded.fromSnapshot && (
                            <Button variant="ghost" className="mt-2 px-2 text-rose-500" onClick={() => void removeMember(member.id)}><Trash2 size={14} /> {t('shared.removeMember')}</Button>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {membership.role === 'owner' && !loaded?.fromSnapshot && (
                    <div className="mt-5 border-t border-stone-200 pt-4 dark:border-stone-800">
                      <div className="flex items-center gap-2 text-sm font-semibold"><UserPlus size={16} /> {t('shared.invite')}</div>
                      <p className="mt-1 text-xs leading-5 text-stone-500">{t('shared.inviteEmailHint')}</p>
                      <div className="mt-3 space-y-2">
                        <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@gmail.com" />
                        <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Exclude<SharedWalletRole, 'owner'>)}>
                          <option value="member">{t('shared.role.member')}</option>
                          <option value="viewer">{t('shared.role.viewer')}</option>
                        </Select>
                        <Button className="w-full" onClick={() => void invite()} disabled={busy || !inviteEmail.trim()}><UserPlus size={16} /> {t('shared.sendInvite')}</Button>
                      </div>
                      {lastInvite && (
                        <div className="mt-3 rounded-xl bg-stone-50 p-3 dark:bg-stone-900">
                          <div className="flex items-center gap-2 text-xs text-stone-500"><ShieldCheck size={14} /> {t('shared.inviteSent')}</div>
                          <Button variant="ghost" className="mt-1 px-2" onClick={() => void navigator.clipboard.writeText(lastInvite)}><Copy size={14} /> {t('common.copy')}</Button>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {(showAdd || editTx) && membership && googleSession && !loaded?.fromSnapshot && (
        <SharedTransactionModal
          membership={membership}
          transaction={editTx}
          onClose={() => { setShowAdd(false); setEditTx(undefined) }}
          onSaved={() => void refreshGroup(membership)}
        />
      )}
    </div>
  )
}

function SharedTransactionModal({ membership, transaction, onClose, onSaved }: { membership: SharedWalletMembership; transaction?: SharedTransaction; onClose: () => void; onSaved: () => void }) {
  const { googleSession, settings } = useWallet()
  const { t } = useI18n()
  const [type, setType] = useState<'expense' | 'income'>(transaction?.type ?? 'expense')
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '')
  const [currency, setCurrency] = useState(transaction?.currency ?? settings?.defaultCurrency ?? 'VND')
  const [occurredAt, setOccurredAt] = useState(localDateTimeValue(transaction?.occurredAt))
  const [category, setCategory] = useState(transaction?.category ?? '')
  const [merchant, setMerchant] = useState(transaction?.merchant ?? '')
  const [description, setDescription] = useState(transaction?.description ?? '')
  const [note, setNote] = useState(transaction?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!googleSession || !amount || Number(amount) <= 0) return
    setSaving(true)
    setError('')
    try {
      await saveSharedTransaction(googleSession.accessToken, membership, {
        id: transaction?.id ?? crypto.randomUUID(),
        type,
        amount: Number(amount),
        currency: currency.trim().toUpperCase() || 'VND',
        occurredAt: new Date(occurredAt).toISOString(),
        category: category.trim() || undefined,
        merchant: merchant.trim() || undefined,
        description: description.trim() || undefined,
        note: note.trim() || undefined,
        tags: transaction?.tags ?? [],
        createdAt: transaction?.createdAt,
      })
      onSaved()
      onClose()
    } catch (saveError) {
      setError(sharedUiError(saveError, 'error.sharedSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-xl rounded-t-3xl bg-white p-4 shadow-2xl dark:bg-stone-950 sm:rounded-2xl sm:p-5">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{transaction ? t('shared.editTransaction') : t('shared.addTransaction')}</h2><Button variant="ghost" className="px-2" onClick={onClose}><X size={18} /></Button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div><Label>{t('shared.type')}</Label><Select value={type} onChange={(e) => setType(e.target.value as 'expense' | 'income')}><option value="expense">{t('transaction.expense')}</option><option value="income">{t('transaction.income')}</option></Select></div>
          <div><Label>{t('modal.amount')}</Label><Input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><Label>{t('modal.currency')}</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={8} /></div>
          <div><Label>{t('modal.time')}</Label><Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></div>
          <div><Label>{t('modal.category')}</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('shared.categoryPlaceholder')} /></div>
          <div><Label>{t('modal.merchant')}</Label><Input value={merchant} onChange={(e) => setMerchant(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>{t('modal.description')}</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>{t('modal.note')}</Label><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        {error && <div className="mt-3 text-sm text-rose-600">{t(error)}</div>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button onClick={() => void save()} disabled={saving || !amount || Number(amount) <= 0}>{saving ? t('modal.saving') : t('common.save')}</Button></div>
      </div>
    </div>
  )
}
