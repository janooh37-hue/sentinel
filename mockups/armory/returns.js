'use strict'

function signin(issueId, { shortfall = false, opener } = {}) {
  const issue = D.out().find(r => r.id === issueId)
  if (issue) returnFlow([issue], { shortfall, opener })
}
function endCustody(id, opener) {
  const record = D.custodies.find(c => c.id === id && !c.ended)
  if (record) returnFlow([record], { custody: true, opener })
}
function bulkReturn(opener) {
  const available = shiftOut(), selected = seenSelection()
  const safe = state.scopeSafe || selected[0]?.safe || available[0]?.safe
  if (new Set(selected.map(r => r.safe)).size > 1) { toast(t('returnSameSafe')); return }
  const records = selected.length ? selected : available.filter(r => r.safe === safe)
  if (records.length) returnFlow(records, { bulk: true, opener })
}
function returnFlow(records, { custody = false, bulk = false, shortfall = false, opener }) {
  const safe = records[0].safe
  const rows = records.map((record, i) => {
    const remaining = D.remaining(record)
    return { record, i, kit: remaining.filter(l => !D.isAmmo(l.item)), ammo: remaining.find(l => D.isAmmo(l.item)) }
  })
  const title = t(custody ? 'endCustody' : bulk ? 'bulkReturn' : 'signin')
  const subtitle = bulk ? `${safeName(safe)} · ${t('returnKitsN', { n: rows.length })}`
    : `${custody ? local(custodian(records[0])) : personName(records[0].guard)} · ${isol(custody ? records[0].id : records[0].guard)} · ${safeName(safe)}`
  const specimen = (i, key) => `return-${i}-${key}`
  const ui = modal({
    title, subtitle, submit: bulk ? t('saveReturns') : title, opener, wide: bulk, variant: bulk ? 'return-bulk' : 'task-sheet',
    preset: custody ? {} : bulk ? { bulk: 1 } : { signin: records[0].id },
    first: bulk ? '#f-return-scan' : '#return-heading-0',
    body: `<div class="flow return-flow">
      ${bulk ? `<div class="return-scan">${field(t('scanReturn'), 'return-scan', 'dir="ltr" autocomplete="off" maxlength="80" spellcheck="false"')}
        <p id="return-scan-feedback" class="desc" role="status">${t('scanReturnHint')}</p></div>` : ''}
      ${rows.map(({ record, i, kit, ammo }) => {
        const name = key => specimen(i, key), guard = issuePerson(record)
        const nonserial = kit.filter(l => !l.serial)
        const returnLine = l => `<div class="return-line">
          ${unitIdentity(l, !l.serial ? `<span class="desc">${t('quantity')}: ${fmtN(l.qty)}</span>` : '')}
          ${checked(name(`line-${l.index}`), l.serial ? t('serialSeen') : t('returned'), false,
            `aria-label="${keyAttr(l.serial ? tPlain('checkedSerial', { serial: l.serial }) : `${t('returned')}: ${D.item(l.item)[state.lang]}`)}"`)}
          ${l.serial ? `<details id="${name(`condition-${l.index}`)}" class="condition-details" hidden>${disclosure(t('condition'))}
            ${select(t('condition'), name(`condition-${l.index}`), [['ok', t('ok')], ['repair', t('needsRepair')]], 'ok')}
            <div data-fault hidden>${textarea(t('fault'), name(`fault-${l.index}`), 'maxlength="160"')}</div></details>` : ''}</div>`
        return `<section class="return-set flow" data-return-row="${i}">
          <div class="record-top"><h3 tabindex="-1" id="return-heading-${i}">${custody ? local(custodian(record)) : `${personName(record.guard)} ${isol(record.guard)}`}</h3>${!custody && D.overdue(record) ? chip(duration(record), 'danger', 'clock') : ''}</div>
          ${kit.length ? `<fieldset class="fieldset return-kit"><legend>${t('options')}</legend>
            ${bulk ? kit.filter(l => l.serial).map(returnLine).join('') : kit.map(returnLine).join('')}
            ${bulk && nonserial.length ? `<details class="return-accessories">${disclosure(t('accessories'))}${nonserial.map(returnLine).join('')}</details>
              ${button(t('confirmAccessories'), 'confirm-accessories', { id: i, cls: 'textbtn' })}` : ''}</fieldset>` : ''}
          ${ammo ? `<fieldset class="fieldset return-ammo"><legend>${t('ammunition')}</legend>
            <div class="round-fields">${field(t('roundsReturned'), name('rounds'), `type="number" dir="ltr" inputmode="numeric" min="0" max="${ammo.qty}" step="1" value="${shortfall ? Math.max(0, ammo.qty - 2) : ''}"`)}
              ${button(t('allRounds', { n: ammo.qty }), 'full-rounds', { id: i, cls: 'secondary' })}</div>
            <p class="desc" id="${name('computation')}"></p>${bulk ? `<input type="checkbox" name="${name('rounds-confirm')}" hidden${shortfall ? ' checked' : ''}>` : checked(name('rounds-confirm'), t('roundsCounted'), shortfall)}</fieldset>
            <div class="flow" id="${name('ammo-details')}" hidden>${notice(t('shortfallHint'), 'warning-tone')}
              <div class="fieldpair names">${select(t('reason'), name('reason'), [['', t('chooseReason')], ...D.reasons.map(r => [r, t(r)])])}
                ${field(t('reference'), name('reference'), 'dir="ltr" maxlength="80"')}</div>
              <div id="${name('return-note')}" hidden>${textarea(t('reasonDetail'), name('detail'), 'maxlength="160"')}</div></div>` : ''}
          ${ammo || custody ? `<div id="${name('witness')}"${custody ? '' : ' hidden'}>${witnessField(name('witness'), record.safe, [guard], 'countWitness')}</div>` : ''}
          ${bulk ? `<p class="desc return-status" data-return-status="${i}" aria-live="polite"></p>` : ''}
        </section>`
      }).join('')}
    </div>`,
  })
  const form = ui.form, f = name => form.elements.namedItem(name)
  const read = (i, key) => valueOf(specimen(i, key), form)
  const fieldAt = (i, key) => f(specimen(i, key))
  const boxAt = (i, key) => $(`#${specimen(i, key)}`, form)
  function intake({ record, i, kit, ammo }) {
    const active = kit.filter(l => fieldAt(i, `line-${l.index}`).checked)
    const repair = l => l.serial && active.includes(l) && fieldAt(i, `condition-${l.index}`).value === 'repair'
    for (const unit of kit.filter(l => l.serial)) {
      const condition = boxAt(i, `condition-${unit.index}`)
      condition.hidden = !active.includes(unit)
      $('[data-fault]', condition).hidden = !repair(unit)
    }
    const amount = ammo && fieldAt(i, 'rounds'), counted = ammo && fieldAt(i, 'rounds-confirm').checked
    const validAmount = amount && amount.value !== '' && amount.validity.valid && Number.isSafeInteger(Number(amount.value))
    const qty = counted && validAmount ? Number(amount.value) : null
    const spent = qty === null ? 0 : ammo.qty - qty
    const witness = read(i, 'witness'), reason = read(i, 'reason'), reference = read(i, 'reference'), note = read(i, 'detail')
    if (ammo) {
      boxAt(i, 'ammo-details').hidden = !spent
      boxAt(i, 'witness').hidden = !custody && !spent
      boxAt(i, 'return-note').hidden = reason !== 'other'
      boxAt(i, 'computation').innerHTML = qty === null ? t('roundsIssued', { n: ammo.qty }) : t('ammoFinding', { issued: ammo.qty, returned: qty, short: spent })
      boxAt(i, 'computation').classList.toggle('warning-tone', Boolean(spent))
    }
    let error = ''
    if (counted && !validAmount || amount?.validity.badInput) error = 'countRoundsPrecisely'
    else if (!active.length && qty === null) error = 'needReturn'
    else if (active.some(l => repair(l) && read(i, `fault-${l.index}`).length < 3)) error = 'needFault'
    else if (spent && (!reason || reference.length < 3 || !/[\p{L}\p{N}].*[\p{L}\p{N}]/u.test(reference) || !witness)) error = 'needShortfall'
    else if (spent && reason === 'other' && note.length < 3) error = 'needReasonDetail'
    else if (custody && !witness) error = 'needWitness'
    if (bulk) {
      const label = $(`[data-return-status="${i}"]`, form)
      label.textContent = t(error === 'needReturn' ? 'notReadyReturn' : error || 'readyReturn')
      label.classList.toggle('warning-tone', Boolean(error && error !== 'needReturn'))
    }
    if (error) return { error }
    const lines = active.map(l => ({ index: l.index, qty: l.qty, ...(repair(l) && { repair: true, note: read(i, `fault-${l.index}`) }) }))
    if (qty > 0) lines.push({ index: ammo.index, qty })
    return { record, lines, witness, ammo: spent ? [{ index: ammo.index, spent, reason, reference, witness, note }] : [] }
  }
  function validate() {
    const planned = rows.map(intake), ready = planned.filter(r => !r.error).length
    if (!bulk) return planned[0].error ? t(planned[0].error) : ''
    $('#submit', form).innerHTML = ready ? t('recordReturnsN', { n: ready }) : t('saveReturns')
    return { progress: t('returnProgress', { ready, total: rows.length }), reason: ready ? '' : t('needReadyReturn') }
  }
  const refresh = () => ui.refresh(validate())
  form.addEventListener('click', e => {
    const button = e.target.closest('[data-action]')
    if (button?.dataset.action === 'full-rounds') {
      const { i, ammo } = rows[Number(button.dataset.id)]
      fieldAt(i, 'rounds').value = ammo.qty
      fieldAt(i, 'rounds-confirm').checked = true
      refresh()
    }
    if (button?.dataset.action === 'confirm-accessories') {
      const { i, kit } = rows[Number(button.dataset.id)]
      kit.filter(l => !l.serial).forEach(l => { fieldAt(i, `line-${l.index}`).checked = true })
      refresh()
    }
  })
  for (const { i, ammo } of rows) if (ammo) {
    fieldAt(i, 'rounds').oninput = () => { fieldAt(i, 'rounds-confirm').checked = fieldAt(i, 'rounds').value !== '' }
  }
  if (bulk) f('return-scan').onkeydown = e => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const code = stockCode(e.target.value), eligible = rows.flatMap(row => row.kit.filter(l => l.serial).map(l => [row, l]))
    const exact = eligible.find(([, line]) => line.serial.toUpperCase() === code)
    const matches = code.length >= 4 ? eligible.filter(([, line]) => line.serial.toUpperCase().endsWith(code)) : []
    const hit = exact || (matches.length === 1 && matches[0])
    const message = $('#return-scan-feedback', form)
    if (!hit) { message.textContent = t(matches.length > 1 ? 'ambiguousSerial' : 'unlistedReturnSerial'); return }
    const [row, line] = hit
    fieldAt(row.i, `line-${line.index}`).checked = true
    message.innerHTML = t('lastReturnScan', { serial: isol(line.serial), name: personName(row.record.guard) })
    e.target.value = ''
    refresh()
  }
  ui.start(validate, () => {
    const planned = rows.map(intake).filter(row => !row.error)
    for (const { record, lines, witness, ammo } of planned) {
      const receipt = { id: D.number('SI', D.returns), [custody ? 'custody' : 'issue']: record.id, at: D.now, actor: D.currentUser, lines,
        ...(custody && { witness }), ...(ammo.length && { ammo }) }
      D.returns.push(receipt)
      for (const l of lines.filter(l => l.repair)) {
        const original = record.lines[l.index]
        D.setSerialState(D.item(original.item), original.serial, 'inRepair', { actor: D.currentUser, witness: witness || undefined, note: l.note, action: 'sendRepair' })
      }
      if (custody && !D.remaining(record).length) {
        record.ended = D.today; record.endedAt = D.now; record.endedBy = D.currentUser
      }
      state.returnSelection.delete(record.id)
    }
    if (custody) {
      state.custodyFilter = 'all'
      complete(records[0].ended ? 'savedEnd' : 'savedReturn', '#custody-detail', actionSelector('custody', records[0].id))
    } else {
      if (state.tab === 'shift') state.shiftLane = D.out().some(r => inScope(r)) ? 'out' : 'returnedToday'
      complete(bulk ? 'savedBulkReturn' : 'savedReturn', state.tab === 'shift' ? '#shift-queue' : '#screen-title')
    }
  }, { dirty: () => $$('input', form).some(el => el.checked || !el.matches('[type="checkbox"]') && el.value), discardKey: 'discardReturn' })
}

// A check records only observed serials. Not yet checked is not a missing finding.
const checkDrafts = new Map()
function shiftCheck(id, opener, missingPreview = 0) {
  const safe = D.safe(id)
  if (!safe || D.checkFor(id)) return
  const shift = D.shiftNow(), owned = D.firearms().filter(s => s.safe === id && s.state !== 'writtenOff')
  const expected = owned.filter(s => s.state === 'inSafe')
  const away = ['signedOut', 'inCustody', 'inRepair'].map(key => [key, owned.filter(s => s.state === key)])
  const unavailable = owned.filter(s => ['missingSerial', 'lost'].includes(s.state))
  const draftKey = `${id}:${D.today}:${shift.id}`, draft = checkDrafts.get(draftKey)
  const staged = clamp(missingPreview, 0, expected.length)
  const picked = new Set(staged ? expected.slice(staged).map(s => s.id) : draft?.seen)
  let reviewed = Boolean(staged), filter = 'all'
  const equation = t('checkEquation', { safe: expected.length, issued: away[0][1].length, custody: away[1][1].length,
    repair: away[2][1].length, extra: unavailable.length ? t('checkUnavailable', { n: unavailable.length }) : '', total: owned.length })
  const ui = modal({
    title: t('shiftCheck'), subtitle: `${local(safe)} · ${t(shift.id)} · ${safePeriod(shift)}`, opener, wide: true, variant: 'check-task',
    first: staged ? '#check-review-title' : '#f-check-scan',
    submit: t(staged ? 'saveCheck' : 'reviewCheck'), preset: { check: id, ...(staged && { checkMissing: staged }) },
    body: `<div class="flow">
      <div id="check-entry" class="flow"><div class="fieldpair">${field(t('scanCheck'), 'check-scan', 'dir="ltr" autocomplete="off" maxlength="80" spellcheck="false"')}
        ${witnessField('witness', id, [], 'countWitness')}</div>
      <p class="desc" id="check-scan-feedback" role="status">${t('checkHint')}</p>
      <div id="check-filters" class="segments" role="group" aria-label="${t('status')}"></div>
      <div id="observed-serials" class="flow">${expected.length ? D.items.filter(i => i.group === 'firearms').map(item => {
        const serials = expected.filter(s => s.item === item.id)
        return serials.length ? `<fieldset class="fieldset check-model"><legend>${local(item)}</legend><ul class="serial-checks">${serials.map(s => `<li data-check-code="${keyAttr(s.id)}">${checked(`serial-${s.id}`, isol(s.id), picked.has(s.id), 'data-presence')}</li>`).join('')}</ul></fieldset>` : ''
      }).join('') : `<p class="desc">${t('checkNone')}</p>`}</div></div>
      <section class="flow" id="check-review" aria-labelledby="check-review-title" hidden><h3 id="check-review-title" tabindex="-1">${t('checkReviewTitle')}</h3>
        <div id="missing-report" class="flow"></div>${button(t('resumeCounting'), 'review-back', { cls: 'secondary' })}</section>
      <details class="countgroup away-records">${disclosure(t('accountedElsewhere'))}<p class="desc">${equation}</p>
        ${[...away, ['notPresent', unavailable]].filter(([, serials]) => serials.length).map(([key, serials]) => `<section><h3>${t(key === 'signedOut' ? 'checkAway' : key)}</h3>
        <ul class="event-mini">${serials.map(s => `<li class="${s.state === 'missingSerial' ? 'danger-tone' : ''}">${itemName(s.item)} · ${isol(s.id)}${s.holder ? ` · ${local(s.holder)}${s.holder.id ? ` ${isol(s.holder.id)}` : ''}` : ''}</li>`).join('')}</ul></section>`).join('')}
      </details></div>`,
  })
  const form = ui.form, f = name => form.elements.namedItem(name), save = $('#submit', form)
  const review = $('#check-review', form), witness = f('witness'), scan = f('check-scan')
  const checkedSerial = s => f(`serial-${s.id}`).checked
  const present = () => expected.filter(checkedSerial), missing = () => expected.filter(s => !checkedSerial(s))
  const snapshot = () => ({ seen: present().map(s => s.id), witness: witness.value })
  if (draft?.witness && !staged) witness.value = draft.witness
  const pause = document.createElement('button')
  pause.type = 'button'; pause.className = 'secondary'; pause.textContent = t('pause')
  save.before(pause)
  pause.onclick = () => { checkDrafts.set(draftKey, snapshot()); dialog.close(); toast(t('checkPaused')) }
  let lastFilterValues = ''
  function validate() {
    const absent = missing(), seen = expected.length - absent.length, counts = `${filter}:${seen}`
    if (lastFilterValues !== counts) {
      lastFilterValues = counts
      $('#check-filters', form).innerHTML = [['all', 'all', expected.length], ['unchecked', 'toCheck', absent.length], ['checked', 'checkedItems', seen]].map(([key, label, count]) =>
        button(`<span>${t(label)} ${fmtN(count)}</span>`, 'check-filter', { id: key, cls: 'segment', attrs: `aria-pressed="${filter === key}"` })).join('')
      $$('[data-check-code]', form).forEach(row => { row.hidden = filter !== 'all' && (filter === 'checked') !== $('input', row).checked })
      $$('.check-model', form).forEach(group => { group.hidden = !$('[data-check-code]:not([hidden])', group) })
    }
    const unreviewed = !reviewed
    $('#check-entry', form).hidden = !unreviewed
    review.hidden = unreviewed
    save.classList.toggle('danger-button', reviewed && absent.length > 0)
    save.textContent = t(unreviewed ? 'reviewCheck' : absent.length ? 'reportAndSaveCheck' : 'saveCheck')
    if (reviewed) {
      const report = $('#missing-report', form)
      report.classList.toggle('danger-tone', Boolean(absent.length))
      if (!report.childElementCount) report.innerHTML = absent.length ? `${notice(`<p><b>${t('firearmsMissing', { n: absent.length })}</b></p><p>${joined(absent.map(s => isol(s.id)))}</p><p>${t('createsFindings')}</p>`, 'danger-tone')}
        ${checked('confirm-missing', t('reportMissing', { n: absent.length }))}` : `<p>${t('checkCount', { present: seen, expected: expected.length })}</p>`
      if (absent.length && !f('confirm-missing').checked) return { progress: t('checkCount', { present: seen, expected: expected.length }), reason: t('confirmMissing') }
    }
    return { progress: t('checkCount', { present: seen, expected: expected.length }), reason: witness.value || unreviewed ? '' : t('needWitness') }
  }
  const refresh = () => ui.refresh(validate())
  if (staged) {
    // The preset stages the reviewed evidence, but the witness still has to be chosen.
    review.append(witness.closest('label'))
  }
  form.addEventListener('click', e => {
    const target = e.target.closest('[data-action]')
    if (target?.dataset.action === 'check-filter') { filter = target.dataset.id; refresh(); $(actionSelector('check-filter', filter), form)?.focus() }
    if (target?.dataset.action === 'review-back') {
      $('.fieldpair', $('#check-entry', form)).append(witness.closest('label'))
      reviewed = false
      $('#missing-report', form).innerHTML = ''
      refresh(); scan.focus()
    }
  })
  scan.onkeydown = e => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const code = stockCode(scan.value), exact = expected.find(s => s.id.toUpperCase() === code)
    const hits = code.length >= 4 ? expected.filter(s => s.id.toUpperCase().endsWith(code)) : []
    const found = exact || (hits.length === 1 && hits[0])
    const feedback = $('#check-scan-feedback', form)
    if (!found) { feedback.textContent = t(hits.length > 1 ? 'ambiguousSerial' : 'notExpectedSerial'); return }
    f(`serial-${found.id}`).checked = true
    scan.value = ''
    feedback.innerHTML = t('lastCheckScan', { serial: isol(found.id), item: itemName(found.item) })
    refresh()
  }
  ui.start(validate, () => {
    if (!reviewed) {
      reviewed = true
      review.append(witness.closest('label'))
      refresh(); $('#check-review-title', form).focus()
      return
    }
    const absent = missing()
    const check = { id: D.number('SC', D.checks), safe: id, shift: shift.id, date: D.today, at: D.now, actor: D.currentUser, witness: witness.value,
      expected: expected.map(s => s.id), present: present().map(s => s.id), missing: absent.map(s => s.id) }
    D.checks.push(check)
    for (const item of D.items.filter(i => i.group === 'firearms')) {
      const missingHere = absent.filter(s => s.item === item.id).map(s => s.id)
      if (!missingHere.length) continue
      const ownedHere = expected.filter(s => s.item === item.id).length
      D.variances.push({ id: `${check.id}-${item.id}`, kind: 'shift', source: check.id, safe: id, item: item.id,
        expected: ownedHere, found: ownedHere - missingHere.length, serials: missingHere, missingSerials: missingHere, at: D.now,
        witness: witness.value, actor: D.currentUser })
      for (const serial of missingHere) D.setSerialState(item, serial, 'missingSerial', { actor: D.currentUser, witness: witness.value })
    }
    checkDrafts.delete(draftKey)
    complete('savedCheck', state.tab === 'shift' ? '#rack-title' : '#shift-checks')
  }, { dirty: () => Boolean(present().length || witness.value || f('confirm-missing')?.checked), discardKey: 'discardCheck' })
}
