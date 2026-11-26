'use strict'

const scopedSafes = () => D.safes.filter(s => !state.scopeSafe || s.id === state.scopeSafe)
const inScope = record => !state.scopeSafe || record.safe === state.scopeSafe
const fullSerial = serial => `<bdi dir="ltr" class="serial-token"><span class="serial-prefix">${escape(serial.slice(0, -4))}</span><b>${escape(serial.slice(-4))}</b></bdi>`
const serialLink = (serial, cls = 'textbtn') => button(isol(serial), 'serial-detail', { id: serial, cls })
const shortSite = id => local(D.safe(id)?.site)
const shiftRecord = serial => D.out().find(r => r.remaining.some(l => l.serial === serial))
const serialItem = serial => D.items.find(item => item.serials?.some(s => s.id === serial))
const serialState = (s, record) => s.state === 'signedOut' && record && D.overdue(record) ? 'overdue' : s.state
const stateGlyph = { inSafe: 'safe', signedOut: 'clock', overdue: 'clock', inCustody: 'clipboard', inRepair: 'repair', missingSerial: 'alert', lost: 'alert', writtenOff: 'close' }
const shiftOut = () => D.out().filter(inScope)
const seenSelection = () => shiftOut().filter(r => state.returnSelection.has(r.id))
const shiftSegments = ['out', 'dutyRoster', 'returnedToday']

function missingBanner() {
  if (!showData()) return ''
  const missing = D.firearms().filter(s => s.state === 'missingSerial')
  if (!missing.length) return ''
  return `<div class="wrap"><div class="missing-banner" role="status">${icon('alert')}
    <div><b>${t('missingFirearmN', { n: missing.length })}</b><span>${joined(missing.map(s => `${isol(s.id)} · ${shortSite(s.safe)}`))}</span></div>
    ${link(t('discrepancies'), route({ tab: 'decisions' }), 'go-counts', { id: 'discrepancies', cls: 'textbtn', glyph: 'chevron' })}</div></div>`
}
function shiftRack(safes, out) {
  const firearms = D.firearms().filter(s => s.state !== 'writtenOff')
  return `<section class="panel section rack" aria-labelledby="rack-title">
    <div class="panel-head"><div><h2 id="rack-title">${icon('safe')} ${t('firearmsAtSafe')}</h2><p class="desc">${t('rackHint')}</p></div></div>
    ${safes.map(safe => {
      const owned = firearms.filter(s => s.safe === safe.id), check = D.checkFor(safe.id)
      const entries = owned.map(s => {
        const issue = out.find(r => r.remaining.some(l => l.serial === s.id))
        return { s, status: serialState(s, issue) }
      })
      const shown = state.rackFilter ? entries.filter(x => x.status === state.rackFilter || state.rackFilter === 'signedOut' && x.status === 'overdue') : entries
      const legend = ['inSafe', 'signedOut', 'inCustody', 'inRepair', 'missingSerial', 'lost'].map(status => {
        const n = owned.filter(s => s.state === status).length
        return !n ? '' : button(`<span>${t(status)} ${fmtN(n)}</span>`, 'rack-filter', {
          cls: `rack-key ${status === 'missingSerial' ? 'danger-tone' : ''}`, glyph: stateGlyph[status], id: status,
          attrs: `aria-pressed="${state.rackFilter === status}"`,
        })
      }).join('')
      return `<div class="rack-safe">
        ${safes.length > 1 ? `<h3 class="rack-site">${safeName(safe.id)}</h3>` : ''}
        ${D.items.filter(item => item.group === 'firearms').map(item => {
          const units = owned.filter(s => s.item === item.id), visible = shown.filter(x => x.s.item === item.id)
          if (!visible.length) return ''
          return `<div class="rack-line"><div class="ident">${art(item)}<div><h3>${local(item)}</h3><p class="desc">${t('rackSafeN', { n: units.filter(s => s.state === 'inSafe').length, total: units.length })}</p></div></div>
            <ul class="rack-units">${visible.map(({ s, status }) => `<li>${button(`${icon(stateGlyph[status])}${fullSerial(s.id)}<span class="rack-status">${t(status)}</span>`, 'serial-detail', {
              cls: `rack-tile ${status}`, id: s.id,
              accessible: `${item[state.lang]}, \u2066${s.id}\u2069, ${t(status)}${s.holder ? `, ${s.holder[state.lang]}` : ''}`,
              attrs: `title="${keyAttr(`${s.id} · ${t(status)}`)}"`,
            })}</li>`).join('')}</ul></div>`
        }).join('')}
        ${owned.length ? shown.length ? '' : `<p class="desc">${t('noMatchingSerials')}</p>` : `<p class="desc">${t('noFirearmsHere')}</p>`}
        <div class="rack-footer"><div class="rack-keys" role="group" aria-label="${t('rackBalance')}">${legend}${owned.length ? `<span class="desc">${t('assignedN', { n: owned.length })}</span>` : ''}</div>
          <div class="actions">${shiftStatus(check)}${!check && edit() ? button(t('checkIt'), 'check', { id: safe.id, cls: 'textbtn', accessible: `${t('shiftCheck')}: ${safe[state.lang]}` }) : ''}</div></div></div>`
    }).join('')}
  </section>`
}
function shiftQueue(out, returned, safes) {
  const roster = D.guards.filter(g => !g.former && safes.some(s => s.id === g.duty))
  const counts = [out.length, roster.length, returned.length]
  const selected = seenSelection(), total = state.shiftLane === 'out' ? out.length : state.shiftLane === 'dutyRoster' ? roster.length : returned.length
  const switcher = `<div class="segments shift-segments" role="group" aria-label="${t('shiftActivity')}">${shiftSegments.map((key, idx) => button(`<span>${t(key)} ${fmtN(counts[idx])}</span>`, 'shift-lane', { id: key, cls: 'segment', attrs: `aria-pressed="${state.shiftLane === key}"` })).join('')}</div>`
  let groups = ''
  for (const safe of safes) {
    const items = (state.shiftLane === 'out' ? out : state.shiftLane === 'dutyRoster' ? roster : returned).filter(r => (r.safe || r.duty) === safe.id)
    if (!items.length) continue
    groups += `${safes.length > 1 ? `<h3 class="list-site">${local(safe)}</h3>` : ''}<ul class="shift-list">${items.map(r => {
      if (state.shiftLane === 'dutyRoster') return `<li class="roster-row"><div>${guardIdentity(r.id)}</div><div class="meta">${r.course ? `${t('courseRound')} ${round(r.course)} · ${licenceChip(D.licenceStatus(r))}` : t('noCourse')}</div><p class="desc">${holdingsOverview(r.id, true)}</p></li>`
      const records = state.shiftLane === 'out' ? r.remaining : r.lines.map(l => ({ ...r.original.lines[l.index], qty: l.qty }))
      const line = mainLine(records)
      const overdue = state.shiftLane === 'out' && D.overdue(r)
      const outstanding = state.shiftLane === 'out' && D.remaining(r).length && D.returns.some(x => x.issue === r.id)
      const hasOtherItems = line && records.length > 1
      return `<li class="shift-row${overdue ? ' late' : ''}" data-record="${r.id}">
        ${edit() && state.shiftLane === 'out' ? `<label class="shift-select"><input type="checkbox" data-return-select="${r.id}" ${state.returnSelection.has(r.id) ? 'checked' : ''} aria-label="${keyAttr(tPlain('selectReturnFor', { name: D.guard(r.guard)[state.lang] }))}"></label>` : ''}
        <div class="shift-person">${guardIdentity(r.guard)}</div>
        <div class="shift-item">${line ? `<span class="name">${itemName(line.item)}${line.serial ? ` ${serialLink(line.serial, 'serial-inline')}` : ` · ${fmtN(D.units(line))}`}</span>` : ''}
          ${hasOtherItems ? `<p class="desc kit-sub">${kitSummary(records, line)}</p>` : ''}</div>
        <div class="shift-due">${state.shiftLane === 'out'
          ? `<span class="${overdue ? 'danger-tone name' : 'name'}">${overdue ? `${icon('clock')} ${duration(r)}` : t('dueAt', { time: timePair(r.due) })}</span>${r.licenceWarning ? `<p class="desc warning-tone">${t('accepted')}</p>` : ''}${outstanding ? `<p class="desc">${t('partialReturn')}</p>` : ''}`
          : `<span class="name">${stamp(r.at, false)} · ${t(r.ammo?.length ? 'returnReview' : D.remaining(r.original).length ? 'partialReturn' : 'fullReturn')}</span>`}</div>
        <div class="shift-row-actions">${edit() && state.shiftLane === 'out' ? button(t('signin'), 'signin', { id: r.id, cls: 'textbtn', accessible: `${t('signin')}: ${D.guard(r.guard)[state.lang]}` }) : ''}
          ${button(icon('chevron', 'mirror'), 'shift-record', { id: r.id, cls: 'iconbtn quiet', accessible: t('movementDetails') })}</div>
      </li>`
    }).join('')}</ul>`
  }
  return `<section class="panel section shift-queue" aria-labelledby="shift-queue"><div class="panel-head"><h2 id="shift-queue" tabindex="-1">${t('shiftActivity')}</h2>${switcher}</div>
    ${groups || `<p class="content muted">${t(state.shiftLane === 'out' ? 'noneOut' : state.shiftLane === 'dutyRoster' ? 'noRoster' : 'noneBack')}</p>`}
    ${edit() && selected.length && state.shiftLane === 'out' ? `<div class="bulk-toolbar"><span>${t('selectedN', { n: selected.length })}</span><div class="actions">
      ${button(t('returnSelected', { n: selected.length }), 'bulk-signin', { cls: 'primary' })}${button(t('clearSelection'), 'clear-selection', { cls: 'textbtn' })}</div></div>` : ''}
    ${total && state.shiftLane === 'out' ? `<p class="queue-note desc">${t('graceHint', { n: D.graceMinutes })}</p>` : ''}
  </section>`
}
function shiftRail(out, safes) {
  const pending = safes.filter(s => !D.checkFor(s.id)), a = D.alerts(), late = out.filter(D.overdue)
  const lists = []
  if (late.length) lists.push(button(t('overdueN', { n: late.length }), 'shift-lane', { id: 'out', cls: 'rail-link danger-tone', glyph: 'clock' }))
  const decisions = a.needsDecision.filter(v => !v.safe || inScope(v))
  if (decisions.length) lists.push(link(t('decisionN', { n: decisions.length }), route({ tab: 'decisions' }), 'tab', { id: 'decisions', cls: 'rail-link', glyph: 'chevron' }))
  for (const [mode, key] of [['expired', 'expiredBatchN'], ['expiring', 'expiringBatchN']]) {
    const affected = a[`${mode}Batches`].filter(b => !state.scopeSafe || b.stock[state.scopeSafe])
    if (affected.length) lists.push(link(t(key, { n: affected.length }), route({ tab: 'items', item: affected[0].item.id }), 'item', { id: affected[0].item.id, cls: 'rail-link', glyph: 'chevron' }))
  }
  const licenceAlerts = a.expiringLicences.length + a.missingLicences.length + a.expiredLicences.length
  if (licenceAlerts) lists.push(link(t('licenceAttentionN', { n: licenceAlerts }), route({ tab: 'guards' }), 'tab', { id: 'guards', cls: 'rail-link', glyph: 'chevron' }))
  const former = D.openCustody().find(c => inScope(c) && D.guard(issuePerson(c))?.former)
  if (former) lists.push(link(t('clearanceCustody'), route({ tab: 'custody', custody: former.id }), 'custody', { id: former.id, cls: 'rail-link', glyph: 'chevron' }))
  const when = D.shiftEnd()
  return `<aside class="shift-rail" aria-label="${t('handoverShift')}">
    <section class="panel rail-panel" aria-labelledby="handover-title"><div class="rail-head"><h2 id="handover-title">${t('handoverShift')}</h2><p class="desc">${t('shiftEndsAt', { time: isol(when.time) })}</p></div>
      <ol class="handover-steps">
        <li><span><b>${t('takeBack')}</b><span class="desc">${t('outWithCount', { n: out.length })}</span></span>${edit() && out.length ? button(t('signin'), 'bulk-signin', { cls: 'textbtn' }) : ''}</li>
        <li><span><b>${t('checkSafe')}</b><span class="desc${pending.length ? ' warning-tone' : ''}">${pending.length ? joined(pending.map(s => `${local(s.site)} · ${t('missingCheck')}`)) : t('done')}</span></span>
          ${edit() && pending.length ? button(t('startCheck'), 'check', { id: pending[0].id, cls: 'textbtn' }) : ''}</li>
        <li><span><b>${t('issueEquipment')}</b><span class="desc">${t('individualIssueHint')}</span></span></li>
      </ol></section>
    ${edit() ? `<section class="panel rail-panel"><div class="rail-head"><h2>${t('stockTasks')}</h2></div><div class="rail-stock actions">${button(t('receiveStock'), 'receive-stock', { cls: 'textbtn', glyph: 'package' })}${button(t('addItem'), 'add-item', { cls: 'textbtn', glyph: 'plus' })}</div></section>` : ''}
    <section class="panel rail-panel"><div class="rail-head"><h2>${t('needsAttention')}</h2></div>${lists.length ? `<ul class="rail-list">${lists.map(html => `<li>${html}</li>`).join('')}</ul>` : `<p class="content desc">${t('noAlerts')}</p>`}</section>
  </aside>`
}
function shiftView() {
  const safes = scopedSafes(), out = shiftOut()
  const back = D.backToday().map(r => {
    const original = D.recordFor(r)
    return { ...r, original, safe: original.safe, guard: original.guard }
  }).filter(inScope)
  return `${shiftRack(safes, out)}<div class="shift-work">${shiftQueue(out, back, safes)}${shiftRail(out, safes)}</div>`
}

function recordDialog({ title, subtitle = '', body, opener, variant = 'record-sheet', preset = {}, first }) {
  discardDialog()
  overlayPreset = preset
  dialog.classList.remove('wide')
  dialog.dataset.variant = variant
  dialog.innerHTML = `<div class="giveform"><div class="givehead"><div><h2 id="dlg-title">${title}</h2>${subtitle ? `<p class="desc">${subtitle}</p>` : ''}</div>
    ${button(icon('close'), 'dismiss-reader', { cls: 'iconbtn', accessible: t('close') })}</div><div class="givebody">${body}</div></div>`
  dialog.onclick = e => {
    const ctl = e.target.closest('[data-action]')
    if (!ctl) return
    if (ctl.dataset.action === 'dismiss-reader') { dialog.close(); return }
    if (ctl.dataset.action === 'copy-serial') {
      if (!navigator.clipboard) { toast(t('copyFailed')); return }
      navigator.clipboard.writeText(ctl.dataset.id).then(() => toast(t('copiedSerial')), () => toast(t('copyFailed')))
      return
    }
    if (ctl.dataset.action.startsWith('find-')) return
    onClick(e)
  }
  dialog.onclose = () => {
    if (dialog.open) return
    dialog.onclick = null
    overlayPreset = {}
    sync()
    if (!focusTo(opener)) focusTo('#screen-title')
  }
  dialog.showModal()
  if (first) $(first, dialog)?.focus({ preventScroll: true })
  if (Object.keys(preset).length) sync()
}
function guardDetail(id, opener) {
  const g = D.guard(id)
  if (!g) return
  const movements = D.log().filter(m => m.guard === id).slice(0, 5)
  recordDialog({ title: local(g), subtitle: isol(g.id), opener,
    body: `<div class="flow"><div class="record-top">${g.former ? chip(t(g.former)) : licenceChip(D.licenceStatus(g))}
      ${edit() && !g.former ? button(t(g.licence ? 'updateLicence' : 'addLicence'), 'licence', { id, cls: 'secondary' }) : ''}</div>
      <dl class="fact-grid"><div><dt>${t('courseRound')}</dt><dd>${g.course ? round(g.course) : dash()}</dd></div>
      <div><dt>${t('securityNumber')}</dt><dd>${g.licence ? isol(g.licence.number) : dash()}</dd></div>
      <div><dt>${t('securityExpiry')}</dt><dd>${g.licence ? stamp(g.licence.expiry) : dash()}</dd></div></dl>
      <h3>${t('holdsNow')}</h3>${holdingsOverview(id)}
      <h3>${t('recentMovements')}</h3>${movements.length ? `<ul class="event-mini">${movements.map(m => `<li>${stamp(m.at)} · <b>${t(m.action)}</b>${m.safe ? ` · ${safeName(m.safe)}` : ''}</li>`).join('')}</ul>` : `<p class="desc">${t('noHistory')}</p>`}</div>`,
  })
}

function shiftRecordDialog(id, opener) {
  const receipt = D.returns.find(r => r.id === id), record = receipt ? D.recordFor(receipt) : D.issues.find(r => r.id === id)
  if (!record) return
  const displayLines = receipt ? receipt.lines.map(l => ({ ...record.lines[l.index], qty: l.qty })) : D.remaining(record)
  recordDialog({ title: t('movementDetails'), subtitle: `${personName(record.guard)} · ${isol(record.guard)} · ${isol(id)}`, opener,
    body: `<div class="flow"><dl class="fact-grid"><div><dt>${t('safe')}</dt><dd>${safeName(record.safe)}</dd></div><div><dt>${t('actor')}</dt><dd>${personName(receipt?.actor || record.actor)}</dd></div>
      <div><dt>${t(receipt ? 'signedInAt' : 'signedOutAt')}</dt><dd>${stamp(receipt?.at || record.issuedAt)}</dd></div><div><dt>${t('dueBack')}</dt><dd>${stamp(record.due)}</dd></div></dl>
      ${listLines(displayLines)}${receipt?.ammo?.length ? receipt.ammo.map(a => `<p class="desc warning-tone">${t('shortfall', { n: a.spent })} · ${t(a.reason)} · ${isol(a.reference)}</p>`).join('') : ''}
      ${!receipt && edit() && displayLines.length ? button(t('signin'), 'signin', { id: record.id, cls: 'primary' }) : ''}</div>`,
  })
}
function serialDetail(serial, opener) {
  const item = serialItem(serial)
  if (!item) return
  const s = D.serialLedger(item).find(row => row.id === serial)
  const r = shiftRecord(serial), status = serialState(s, r)
  const movements = D.log().filter(m => m.lines.some(l => l.serial === serial)).slice(0, 5)
  recordDialog({ title: isol(serial), subtitle: local(item), opener,
    body: `<div class="flow"><div class="record-top">${chip(t(status), status === 'overdue' || status === 'missingSerial' ? 'danger' : glyphs[s.state], stateGlyph[status])}
      ${button(t('copySerial'), 'copy-serial', { id: serial, glyph: 'copy', cls: 'textbtn' })}</div>
      <dl class="fact-grid"><div><dt>${t('safe')}</dt><dd>${safeName(s.safe)}</dd></div><div><dt>${t('holder')}</dt><dd>${s.holder ? `${local(s.holder)}${s.holder.id ? ` · ${isol(s.holder.id)}` : ''}` : dash()}</dd></div>
      <div><dt>${t('since')}</dt><dd>${stamp(s.since)}</dd></div>${s.note ? `<div><dt>${t('notes')}</dt><dd>${readableNote(s.note)}</dd></div>` : ''}</dl>
      <div class="actions">${r && edit() ? button(t('signin'), 'signin', { id: r.id, cls: 'primary' }) : ''}${edit() && ['inSafe', 'inRepair', 'lost'].includes(s.state) ? button(t('changeState'), 'state', { id: serial, attrs: `data-item="${item.id}"`, cls: 'secondary' }) : ''}
      ${link(t('openItem'), route({ tab: 'items', item: item.id, serial }), 'board-serial', { id: serial, attrs: `data-item="${item.id}"`, cls: 'textbtn' })}</div>
      <h3>${t('recentMovements')}</h3>${movements.length ? `<ul class="event-mini">${movements.map(m => `<li>${stamp(m.at)} · <b>${t(m.action)}</b>${m.guard ? ` · ${personName(m.guard)} ${isol(m.guard)}` : ''}</li>`).join('')}</ul>` : `<p class="desc">${t('noHistory')}</p>`}
      ${link(t('openLog'), route({ tab: 'log', serial }), 'serial-log', { id: serial, glyph: 'arrow' })}</div>`,
  })
}

function finder(opener) {
  recordDialog({ title: t('findArmory'), subtitle: t('findHint'), opener, variant: 'finder', first: '#armory-find',
    body: `<div class="flow">${searchField('armory-find', '', t('findPlaceholder'))}<div id="find-results" aria-live="polite"></div></div>`,
  })
  const input = $('#armory-find', dialog), results = $('#find-results', dialog)
  const clear = $('[data-action="clear-search"]', dialog)
  const groups = (title, entries) => entries.length ? `<section class="find-group"><h3>${title}</h3><ul>${entries.join('')}</ul></section>` : ''
  const foundRow = (title, meta, actions) => `<li><span><span class="name">${title}</span><span class="desc">${meta}</span></span><div class="actions">${actions}</div></li>`
  function draw() {
    const q = input.value.trim(), u = westernDigits(q).toUpperCase()
    clear.hidden = !q
    if (!showData()) { results.innerHTML = `<p class="desc">${t('nothingHere')}</p>`; return }
    const serials = q ? D.items.flatMap(i => i.serials?.filter(s => s.id.toUpperCase().includes(u)).map(s => [i, s.id]) || []).slice(0, 8)
      : D.out().filter(inScope).flatMap(r => r.remaining.filter(l => l.serial).map(l => [D.item(l.item), l.serial])).slice(0, 4)
    const guards = (q ? D.guards.filter(g => matchesPerson(g, westernDigits(q))) : []).slice(0, 7)
    const items = q ? D.items.filter(i => rowMatches(q, i.en, i.ar, i.id)).slice(0, 7) : []
    const custody = q ? D.custodies.filter(c => rowMatches(q, c.id, c.holder, custodian(c).en, custodian(c).ar)).slice(0, 6) : []
    let body = groups(t(q ? 'serialList' : 'recentSerials'), serials.map(([item, serial]) => {
      const r = shiftRecord(serial), s = D.serialLedger(item).find(row => row.id === serial), status = serialState(s, r)
      return foundRow(`${local(item)} · ${isol(serial)}`, `${chip(t(status), status === 'overdue' || status === 'missingSerial' ? 'danger' : '')} ${safeName(s.safe)}${s.holder ? ` · ${local(s.holder)}` : ''}`,
        `${r && edit() ? button(t('signin'), 'signin', { id: r.id, cls: 'secondary' }) : ''}${button(t('viewRecord'), 'serial-detail', { id: serial, cls: 'textbtn' })}`)
    }))
    body += groups(t('guards'), guards.map(g => {
      const open = D.out().find(r => r.guard === g.id)
      return foundRow(`${local(g)} · ${isol(g.id)}`, g.former ? t(g.former) : holdingsOverview(g.id, true),
        `${open && edit() ? button(t('signin'), 'signin', { id: open.id, cls: 'secondary' }) : ''}${button(t('viewRecord'), 'find-guard', { id: g.id, cls: 'textbtn' })}`)
    }))
    body += groups(t('custody'), custody.map(c => foundRow(`${local(custodian(c))} · ${isol(c.id)}`, itemSummary(c.ended ? c.lines : D.remaining(c)),
      button(t('viewRecord'), 'custody', { id: c.id, cls: 'textbtn' }))))
    body += groups(t('itemsTab'), items.map(i => foundRow(local(i), trackingLabel(i), button(t('openItem'), 'item', { id: i.id, cls: 'textbtn' }))))
    if (q && !body) body = `<p class="desc">${t('nothingFound', { query: `<bdi>${escape(q)}</bdi>` })}</p>${stockCodeOk(u) && edit() ? button(t('receiveUnknownSerial'), 'find-receive', { id: u, cls: 'secondary' }) : ''}`
    if (!q && edit()) body += `<div class="actions">${button(t('addItem'), 'add-item', { cls: 'secondary', glyph: 'plus' })}${button(t('receiveStock'), 'receive-stock', { cls: 'secondary', glyph: 'package' })}</div>`
    results.innerHTML = body
  }
  clear.dataset.action = 'find-clear'
  clear.onclick = () => { input.value = ''; draw(); input.focus() }
  input.addEventListener('input', e => { if (!e.isComposing) draw() })
  input.addEventListener('keydown', e => {
    if (['ArrowDown', 'Enter'].includes(e.key)) {
      e.preventDefault()
      const target = $('button', results)
      if (e.key === 'Enter' && input.value.trim()) target?.click()
      else target?.focus()
    }
  })
  results.addEventListener('click', e => {
    const ctl = e.target.closest('button')
    if (ctl?.dataset.action === 'find-guard') {
      const g = D.guard(ctl.dataset.id)
      discardDialog(); useTab('guards'); state.guardQuery = g.id; state.showFormer = Boolean(g.former)
      render('#screen-title'); sync({ push: true }); scrollToTop()
    }
    if (ctl?.dataset.action === 'find-receive') receiveStock({ opener, seed: ctl.dataset.id })
  })
  draw()
}
