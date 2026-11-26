'use strict'

// Both intake forms post to the same ledger. A blank opening balance is not a zero.
const stockKinds = {
  firearm: { group: 'firearms', art: 'pistol', tracking: 'serial' },
  ammunition: { group: 'ammo', art: 'rounds', tracking: 'quantity' },
  serial: { group: 'comms', art: 'radio', tracking: 'serial' },
  quantity: { group: 'accessories', art: 'case', tracking: 'quantity' },
  expiry: { group: 'nonlethal', art: 'spray', tracking: 'quantity', batches: true },
}
const controlledStock = item => ['firearms', 'ammo'].includes(item.group)
const trackingLabel = item => t(item.batches ? 'expiryTracking' : item.tracking === 'serial' ? 'trackSerial' : 'trackQuantity')
const westernDigits = text => String(text).replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) % 16))
const stockCode = text => westernDigits(text).trim().toUpperCase()
const splitSerials = text => stockCode(text).split(/[\s,،;؛]+/).filter(Boolean)
const stockCodeOk = code => /^[A-Z0-9][A-Z0-9._/-]{0,79}$/.test(code)
const stockNumber = input => input.value === '' ? null : Number(input.value)
const validStockNumber = n => n === null || Number.isSafeInteger(n) && n >= 0
const dateInputValue = iso => iso?.slice(0, 10).split('-').reverse().join('/') || ''
function parseStockDate(value, allowMonth = false) {
  const v = westernDigits(value).trim()
  const pieces = v.includes('/') ? v.split('/').reverse() : v.split('-')
  if (pieces.length === 2 && !allowMonth || ![2, 3].includes(pieces.length)) return ''
  const [year, month, day] = pieces
  if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || day !== undefined && !/^\d{1,2}$/.test(day)) return ''
  const iso = `${year}-${month.padStart(2, '0')}${day === undefined ? '' : `-${day.padStart(2, '0')}`}`
  const date = new Date(iso)
  return !Number.isNaN(+date) && date.toISOString().startsWith(iso) ? iso : ''
}
function dmyField(label, name, iso = '', { month = false } = {}) {
  const example = '17/09/2027'
  return field(label, name, `type="text" dir="ltr" maxlength="10" placeholder="${example}" value="${keyAttr(dateInputValue(iso))}" aria-describedby="help-${name}" autocomplete="off"`,
    `<span id="help-${name}">${month ? t('expiryFormat', { date: isol(example), month: isol('09/2027') }) : t('dateFormat', { example: isol(example) })}</span>`)
}
const batchEnd = expiry => expiry.length === 7
  ? new Date(Date.UTC(Number(expiry.slice(0, 4)), Number(expiry.slice(5, 7)), 0)).toISOString().slice(0, 10) : expiry
const registeredSerials = () => new Map(D.items.flatMap(item => (item.serials || []).map(s => [s.id.toUpperCase(), s.safe])))

function serialPad(name, value = '') {
  return `<div class="serial-pad" data-serial-pad="${name}">
    <div class="record-top"><h4>${t('serialEntryLabel')}</h4>${button(t('scanSerials'), 'stock-scan', { id: name, glyph: 'scan', cls: 'ghost' })}</div>
    <label class="sr" for="f-${name}">${t('serialEntryLabel')}</label>
    <textarea id="f-${name}" name="${name}" dir="ltr" rows="2" maxlength="16000" spellcheck="false" autocapitalize="characters" aria-describedby="help-${name}" placeholder="${keyAttr(t('serialEntryPlaceholder'))}">${escape(value)}</textarea>
    <p id="help-${name}" class="desc">${t('serialPadHint')}</p><div class="pad-review" data-code-review aria-live="polite"></div>
  </div>`
}
function serialReview(pad, ids, known, count) {
  const codes = ids.map(id => ({ id, error: !stockCodeOk(id) ? t('invalidStockCode') : known.has(id) ? t('serialAlready', { safe: safeName(known.get(id)) })
    : count.get(id) > 1 ? t('serialRepeated') : '' }))
  const errors = codes.filter(c => c.error), good = codes.filter(c => !c.error)
  const tag = c => `<li class="code-chip${c.error ? ' danger-tone' : ''}">${isol(c.id)}${c.error ? ` <span>${c.error}</span>` : ''}</li>`
  const recovery = pad.querySelector('[data-code-review]')
  const markup = codes.length ? `<p class="desc">${t('serialReadyN', { n: good.length })}${errors.length ? ` · ${t('serialFixN', { n: errors.length })}` : ''}</p>
    <ul class="codes">${[...errors, ...good.slice(0, 10)].map(tag).join('')}</ul>${good.length > 10 ? `<details>${disclosure(t('moreSerials', { n: good.length - 10 }))}<ul class="codes">${good.slice(10).map(tag).join('')}</ul></details>` : ''}` : ''
  if (recovery.dataset.value !== markup) {
    recovery.dataset.value = markup
    recovery.innerHTML = markup
  }
  $('textarea', pad).setAttribute('aria-invalid', String(Boolean(errors.length)))
  return errors.length > 0
}
const qtyField = (label, name) => field(label, name, 'type="number" dir="ltr" inputmode="numeric" min="0" step="1"')
function stockBatchRow(name, id) {
  return `<div class="batch-fields" data-batch-row>
    ${field(t('batchNumber'), `${name}-batch-${id}`, 'dir="ltr" maxlength="80" autocapitalize="characters" spellcheck="false"')}
    ${dmyField(t('batchExpiry'), `${name}-expiry-${id}`, '', { month: true })}
    ${qtyField(t('quantity'), `${name}-qty-${id}`)}
    ${button(icon('close'), 'remove-stock-batch', { cls: 'iconbtn', accessible: t('removeBatch') })}
  </div>`
}
function stockEntry(item, name, { seed = '', opening = false } = {}) {
  if (item.tracking === 'serial') return serialPad(`${name}-serials`, seed) + (opening
    ? `<details class="pending-serials">${disclosure(t('serialsLater'))}${qtyField(t('unrecordedQty'), `${name}-pending`)}</details>` : '')
  if (item.batches) return `<div class="flow batch-editor" data-batch-entry="${name}"><div class="batch-list">${stockBatchRow(name, 0)}</div>
    <div class="actions">${button(t('addBatch'), 'add-stock-batch', { id: name, cls: 'secondary', glyph: 'plus' })}${opening ? checked(`${name}-zero`, t('countedZero')) : ''}</div></div>`
  return qtyField(t('quantity'), `${name}-qty`)
}
function readEntry(item, name, form) {
  const entry = { qty: null, pending: null, serials: [], batches: [], countedEmpty: false, invalid: '' }
  if (item.tracking === 'serial') {
    entry.serials = splitSerials(valueOf(`${name}-serials`, form))
    const pending = form.elements.namedItem(`${name}-pending`)
    entry.pending = pending ? stockNumber(pending) : null
    if (pending?.validity.badInput || !validStockNumber(entry.pending)) entry.invalid = 'needStockQuantity'
  } else if (item.batches) {
    entry.countedEmpty = Boolean(form.elements.namedItem(`${name}-zero`)?.checked)
    for (const row of $$(`[data-batch-entry="${name}"] [data-batch-row]`, form)) {
      const [ref, date, input] = $$('input', row)
      const id = stockCode(ref.value), expiry = parseStockDate(date.value, true), qty = stockNumber(input)
      if (!id && !date.value.trim() && qty === null && !input.validity.badInput) continue
      if (!stockCodeOk(id) || !expiry || !validStockNumber(qty) || !(qty > 0)) { entry.invalid = 'needBatchDetails'; continue }
      entry.batches.push({ id, expiry, qty })
    }
    if (entry.countedEmpty && entry.batches.length) entry.invalid = 'zeroOrBatches'
  } else {
    const input = form.elements.namedItem(`${name}-qty`)
    entry.qty = stockNumber(input)
    if (input.validity.badInput || !validStockNumber(entry.qty)) entry.invalid = 'needStockQuantity'
  }
  return entry
}
const entryCount = entry => (entry.qty || 0) + (entry.pending || 0) + entry.serials.length + entry.batches.reduce((n, b) => n + b.qty, 0)
const entryCounted = entry => entry.qty !== null || entry.pending !== null || entry.countedEmpty || entry.serials.length > 0 || entry.batches.length > 0
function inspectEntries(form, entries, { opening = false } = {}) {
  const count = new Map(), seenBatch = new Map(), known = registeredSerials()
  for (const { entry } of entries) for (const id of entry.serials) count.set(id, (count.get(id) || 0) + 1)
  let reason = ''
  for (const { item, safe, name, entry } of entries) {
    reason ||= entry.invalid
    const pad = $(`[data-serial-pad="${name}-serials"]`, form)
    if (pad && serialReview(pad, entry.serials, known, count)) reason ||= 'fixSerials'
    for (const batch of entry.batches) {
      const original = Array.isArray(item.batches) && item.batches.find(b => b.id === batch.id)
      const key = `${item.id || 'opening'}:${batch.id}`
      const stamp = batchEnd(batch.expiry), knownExpiry = seenBatch.get(key)
      if (original && batchEnd(original.expiry) !== stamp || knownExpiry && knownExpiry.expiry !== stamp) reason ||= 'batchExpiryConflict'
      if (knownExpiry?.safes.has(safe)) reason ||= 'batchRepeated'
      const used = knownExpiry || { expiry: stamp, safes: new Set() }
      used.safes.add(safe)
      seenBatch.set(key, used)
    }
    const preview = $(`[data-stock-preview="${name}"]`, form)
    if (preview) {
      const qty = entryCount(entry)
      const current = opening ? 0 : D.rollup(item).bySafe[safe].inSafe
      preview.hidden = !opening && !qty
      preview.innerHTML = opening ? (entryCounted(entry) ? t('openingN', { n: qty }) : t('stockOpeningHint')) : qty
        ? (current === null ? t('stockUnknownPreview', { n: qty }) : t('stockPreview', { before: current, after: current + qty })) : ''
    }
  }
  return reason
}
function wireStockTools(form, refresh) {
  let n = 0
  form.addEventListener('click', e => {
    const b = e.target.closest('button[data-action]')
    if (b?.dataset.action === 'stock-scan') {
      const input = $(`#f-${b.dataset.id}`, form)
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
      if (input.value && !/\s$/.test(input.value)) input.value += '\n'
    }
    if (b?.dataset.action === 'add-stock-batch') {
      const list = $('.batch-list', b.closest('[data-batch-entry]'))
      list.insertAdjacentHTML('beforeend', stockBatchRow(b.dataset.id, ++n))
      $('input', list.lastElementChild).focus()
      refresh()
    }
    if (b?.dataset.action === 'remove-stock-batch') {
      const section = b.closest('[data-batch-entry]')
      b.closest('[data-batch-row]').remove()
      $('[data-action="add-stock-batch"]', section).focus()
      refresh()
    }
  })
  form.addEventListener('keydown', e => {
    if (e.target.matches('[data-serial-pad] textarea') && e.key === 'Enter') {
      e.preventDefault()
      const input = e.target
      input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end')
      refresh()
    }
  })
}

function catalogueForm({ opener, preset = {}, onCreated, onCancel, onExisting } = {}) {
  const seededKind = Object.hasOwn(stockKinds, preset.kind) ? preset.kind : ''
  let step = seededKind ? 1 : 0, lastMode = '', current = seededKind || ''
  const safes = [...D.safes].sort((a, b) => Number(b.id === state.scopeSafe) - Number(a.id === state.scopeSafe))
  const ui = modal({
    title: t('addItem'), subtitle: t('createItemHint'), opener, first: seededKind ? '#f-name-en' : '[name="kind"]', wide: true,
    preset: { add: seededKind || 1 }, variant: 'stock-task', onCancel,
    body: `<div class="flow stock-create">
      <ol class="task-steps">${['kindLabel', 'itemDetails', 'openingStock'].map((key, i) => `<li data-step-label="${i}">${t(key)}</li>`).join('')}</ol>
      <section data-stock-step="0"><h3>${t('whatKind')}</h3><div class="kind-grid">
        ${Object.entries(stockKinds).map(([id, item]) => `<label class="kind-option"><input type="radio" name="kind" value="${id}"${id === current ? ' checked' : ''}>
          ${art(item)}<span><b>${t(`kind_${id}`)}</b><span class="desc">${t(`kind_${id}_hint`)}</span></span></label>`).join('')}
      </div><p class="desc">${t('kindLocked')}</p></section>
      <section class="flow" data-stock-step="1" hidden><h3>${t('itemDetails')}</h3>
        <div class="fieldpair names">${field(t('nameEn'), 'name-en', 'lang="en" dir="ltr" maxlength="100" required')}${field(t('nameAr'), 'name-ar', 'lang="ar" dir="rtl" maxlength="100" required')}</div>
        <div id="duplicate-item" class="notice warning-tone" hidden></div>
        <div class="fieldpair"><div id="item-group"></div>
          <div class="drawing-field">${select(t('drawing'), 'drawing', [...new Map(D.items.map(i => [i.art, i])).values()].map(i => [i.art, local(i)]))}<div id="drawing-preview"></div></div>
        </div>
        <details class="countgroup">${disclosure(t('kitMembership'))}
          <p class="desc">${t('kitMembershipHint')}</p><div class="filters">${Object.keys(D.kits).map(id => checked(`kit-${id}`, t(id === 'equipment' ? 'equipmentKit' : id))).join('')}</div>
        </details>
        <div id="kind-rule" class="notice"></div>
      </section>
      <section class="flow" data-stock-step="2" hidden><h3>${t('openingStock')}</h3>
        <div class="record-top" id="item-opening-summary"></div><p class="desc">${t('openingHint')}</p>
        <div id="opening-entries" class="opening-grid"></div>
        <div class="fieldpair names">${dmyField(t('openingDate'), 'stock-date', D.today)}${field(t('reference'), 'stock-reference', 'dir="ltr" maxlength="80"')}</div>
        <div id="opening-witness" hidden>${witnessField('stock-witness', state.scopeSafe)}</div>
        ${onCreated ? '' : checked('add-another', t('addAnother'))}
      </section>
    </div>`, submit: t('next'),
  })
  const form = ui.form, f = name => form.elements.namedItem(name), input = name => valueOf(name, form)
  const save = $('#submit', form), prev = document.createElement('button')
  prev.type = 'button'; prev.className = 'ghost'; prev.textContent = t('previous')
  save.before(prev)
  const kind = () => stockKinds[current]
  const fields = () => ({ en: input('name-en'), ar: input('name-ar'), group: lockedGroup() ? kind().group : input('item-group'), art: input('drawing'), tracking: kind().tracking,
    ...(kind().batches && { batches: true }), kits: Object.keys(D.kits).filter(id => f(`kit-${id}`).checked), kind: current })
  const lockedGroup = () => controlledStock(kind())
  const bySafe = () => safes.map(s => ({ item: kind(), name: `opening-${s.id}`, safe: s.id, entry: readEntry(kind(), `opening-${s.id}`, form) }))
  function drawKind() {
    const item = kind()
    if (!item || current === lastMode) return
    lastMode = current
    const groups = D.groups.filter(g => lockedGroup() ? g.id === item.group : !['firearms', 'ammo'].includes(g.id))
    $('#item-group', form).innerHTML = select(t('category'), 'item-group', groups.map(g => [g.id, local(g)]), preset.group || item.group)
    f('drawing').value = item.art
    $('#kind-rule', form).innerHTML = `${icon('clipboard')}<p>${t(`kind_${current}_rule`)}</p>`
    $('#opening-entries', form).innerHTML = safes.map(s => `<fieldset class="stock-safe"><legend>${local(s)}</legend>${stockEntry(item, `opening-${s.id}`, { opening: true })}
      <p class="desc stock-preview" data-stock-preview="opening-${s.id}"></p></fieldset>`).join('')
  }
  function showStep() {
    $$('[data-stock-step]', form).forEach(section => { section.hidden = Number(section.dataset.stockStep) !== step })
    $$('[data-step-label]', form).forEach(li => {
      const i = Number(li.dataset.stepLabel)
      if (i === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current')
      li.classList.toggle('passed', i < step)
    })
    prev.hidden = step === 0
    save.textContent = t(step === 2 ? 'saveItem' : 'next')
  }
  function validate() {
    if (!kind()) return t('chooseKind')
    if (step === 0) return ''
    const data = fields(), duplicate = D.items.find(i => i.en.toLowerCase() === data.en.toLowerCase() || i.ar === data.ar)
    const box = $('#duplicate-item', form)
    box.hidden = !duplicate
    const label = duplicate ? `${icon('alert')}<div><p>${t('itemExists', { item: local(duplicate) })}</p>${button(t('receiveStock'), 'receive-existing', { cls: 'textbtn', id: duplicate.id })}</div>` : ''
    if (box.innerHTML !== label) box.innerHTML = label
    $('#drawing-preview', form).innerHTML = art(data, 'lg')
    if (!data.en || !data.ar) return t('needBothNames')
    if (duplicate) return t('duplicateItem')
    if (step === 1) return ''
    const openings = bySafe(), issue = inspectEntries(form, openings, { opening: true })
    const total = openings.reduce((n, row) => n + entryCount(row.entry), 0), needsWitness = total > 0 && lockedGroup()
    $('#opening-witness', form).hidden = !needsWitness
    $('#item-opening-summary', form).innerHTML = `<b>${local(data)}</b><span class="desc">${trackingLabel(data)} · ${t('openingN', { n: total })}</span>`
    if (issue) return t(issue)
    const date = parseStockDate(input('stock-date'))
    if (!date || date > D.today) return t('needStockDate')
    if (needsWitness && !input('stock-reference')) return t('needStockReference')
    if (needsWitness && !input('stock-witness')) return t('needWitness')
    return ''
  }
  const refresh = () => ui.refresh(validate())
  form.addEventListener('change', event => {
    if (event.target.name === 'kind') { current = event.target.value; drawKind() }
  })
  form.addEventListener('input', event => {
    if (event.target.name === 'kind') { current = event.target.value; drawKind() }
  })
  const move = n => {
    step = n; showStep(); refresh()
    $('.givebody', form.parentElement).scrollTop = 0
    (n === 0 ? $('[name="kind"]:checked', form) : n === 1 ? f('name-en') : $(`[data-stock-step="2"] input:not([type="checkbox"]),[data-stock-step="2"] textarea`, form))?.focus()
  }
  prev.onclick = () => move(step - 1)
  form.addEventListener('click', e => {
    const target = e.target.closest('[data-action="receive-existing"]')
    if (target) {
      if (onExisting) onExisting(target.dataset.id)
      else receiveStock({ item: target.dataset.id, opener })
    }
  })
  drawKind()
  showStep()
  wireStockTools(form, refresh)
  ui.start(validate, () => {
    if (step < 2) { move(step + 1); return }
    const data = fields()
    const openings = bySafe().map(r => [r.safe, r.entry]), date = parseStockDate(input('stock-date'))
    const item = D.addCatalogueItem(data, openings, { date, reference: input('stock-reference'), witness: input('stock-witness') })
    if (onCreated) { D.assertLedger(); onCreated(item); return }
    const another = f('add-another')?.checked
    if (state.tab !== 'items') useTab('items')
    state.item = null
    state.category = state.query = ''
    state.stockView = 'all'
    const added = attrSelector('data-item-row', item.id)
    complete('savedItem', added, added)
    if (another) catalogueForm({ opener: actionSelector('add-item'), preset: { kind: current, group: data.group } })
  }, { dirty: () => Boolean(input('name-en') || input('name-ar') || kind() && bySafe().some(r => r.entry.invalid || entryCounted(r.entry))), discardKey: 'discardItem' })
}

function receiveStock({ item: initialItem = '', opener, seed = '', draft } = {}) {
  let key = 0
  const initialSafe = state.scopeSafe || D.safes[0].id
  const ui = modal({
    title: t('receiveStock'), subtitle: t('receiveHint'), submit: t('receiveStock'), opener, first: '#f-receive-item-1', wide: true,
    preset: { receive: initialItem || 1 }, variant: 'stock-task',
    body: `<div class="receive-grid"><div class="flow"><h3>${t('receiptItems')}</h3><div class="flow" id="receipt-lines"></div>
      <div class="actions">${button(t('addReceiptLine'), 'add-receipt-line', { cls: 'secondary', glyph: 'plus' })}${button(t('notListedAdd'), 'receive-add-item', { cls: 'textbtn' })}</div></div>
      <aside class="receive-context flow"><h3>${t('deliveryDetails')}</h3>
        ${select(t('toSafe'), 'receive-safe', safeOptions(), draft?.safe || initialSafe)}
        ${dmyField(t('stockDate'), 'receive-date', D.today)}
        ${select(t('deliverySource'), 'receive-source', ['supplier', 'headOffice', 'other'].map(id => [id, t(id)]), draft?.source || 'supplier')}
        ${field(t('reference'), 'receive-reference', `dir="ltr" maxlength="80" value="${keyAttr(draft?.reference || '')}"`)}
        <div id="receive-witness" hidden>${witnessField('receipt-witness', draft?.safe || initialSafe)}</div>
      </aside></div>`,
  })
  const form = ui.form, container = $('#receipt-lines', form), read = name => valueOf(name, form)
  const safe = () => read('receive-safe')
  const selected = line => D.item($('select', line).value)
  const draftRows = () => $$('[data-intake-line]', container).map(row => {
    const item = selected(row), name = row.dataset.intakeLine
    return { item, safe: safe(), name, entry: item ? readEntry(item, name, form) : null }
  })
  const pushLine = (itemId = '', codes = '', remembered) => {
    const seq = ++key, name = `intake-${seq}`
    container.insertAdjacentHTML('beforeend', `<section class="intake-line flow" data-intake-line="${name}">
      <div class="intake-head">${select(t('item'), `receive-item-${seq}`, [['', t('chooseItem')], ...D.items.map(item => [item.id, local(item)])], itemId)}
      ${button(icon('close'), 'remove-receipt-line', { cls: 'iconbtn', accessible: t('removeReceiptLine') })}</div>
      <div class="flow intake-entry"></div><p class="desc stock-preview" data-stock-preview="${name}" hidden></p>
      </section>`)
    const row = container.lastElementChild, picker = $('select', row)
    const paint = (initial = '') => {
      const item = selected(row)
      $('.intake-entry', row).innerHTML = item ? `${item.batches ? `<p class="desc">${trackingLabel(item)}</p>` : ''}${stockEntry(item, name, { seed: initial })}` : ''
      $('.stock-preview', row).hidden = !item
    }
    let pendingCode = codes
    picker.onchange = () => {
      paint(pendingCode)
      if (selected(row)?.tracking === 'serial') pendingCode = ''
    }
    paint(pendingCode)
    if (remembered && selected(row)) {
      const { serials, quantity, batches } = remembered
      if (serials !== undefined) form.elements.namedItem(`${name}-serials`).value = serials
      if (quantity !== undefined) form.elements.namedItem(`${name}-qty`).value = quantity
      if (batches.length) {
        const list = $('.batch-list', row)
        list.innerHTML = batches.map((_, n) => stockBatchRow(name, `draft${n}`)).join('')
        batches.forEach((values, n) => $$('input', list.children[n]).forEach((input, i) => { input.value = values[i] }))
      }
    }
    return picker
  }
  if (draft?.rows.length) draft.rows.forEach(row => pushLine(row.id, '', row))
  else pushLine(initialItem, seed)
  const witness = form.elements.namedItem('receipt-witness')
  if (draft?.witness) witness.value = draft.witness
  if (draft) form.elements.namedItem('receive-date').value = draft.date
  const ref = () => read('receive-reference')
  const date = () => parseStockDate(read('receive-date'))
  function validate() {
    const lines = draftRows(), entries = lines.filter(row => row.item)
    const needsWitness = entries.some(r => controlledStock(r.item))
    $('#receive-witness', form).hidden = !needsWitness
    const issue = inspectEntries(form, entries)
    if (!entries.length || entries.length !== lines.length) return t('chooseItem')
    if (new Set(entries.map(r => r.item.id)).size !== entries.length) return t('duplicateReceiptItem')
    if (issue) return t(issue)
    if (entries.some(r => !entryCount(r.entry))) return t('enterStock')
    if (!date() || date() > D.today) return t('needStockDate')
    if (!ref()) return t('needStockReference')
    if (needsWitness && !witness.value) return t('needWitness')
    return ''
  }
  const refresh = () => ui.refresh(validate())
  form.elements.namedItem('receive-safe').onchange = () => { witness.innerHTML = witnessOptions(safe(), [], 'witness', witness.value) }
  wireStockTools(form, refresh)
  form.addEventListener('click', e => {
    const b = e.target.closest('button[data-action]')
    if (b?.dataset.action === 'add-receipt-line') { pushLine().focus(); refresh() }
    if (b?.dataset.action === 'remove-receipt-line') {
      b.closest('[data-intake-line]').remove()
      if (!container.children.length) pushLine().focus()
      else $('[data-action="add-receipt-line"]', form).focus()
      refresh()
    }
    if (b?.dataset.action === 'receive-add-item') {
      const rows = $$('[data-intake-line]', container).map(row => {
        const name = row.dataset.intakeLine
        return { id: selected(row)?.id, serials: form.elements.namedItem(`${name}-serials`)?.value,
          quantity: form.elements.namedItem(`${name}-qty`)?.value,
          batches: $$('[data-batch-row]', row).map(batch => $$('input', batch).map(input => input.value)) }
      })
      const resume = { safe: safe(), date: form.elements.namedItem('receive-date').value, reference: ref(), source: read('receive-source'), witness: witness.value, rows }
      const resumeWithItem = id => {
        resume.rows = rows.filter(r => r.id)
        if (!resume.rows.some(r => r.id === id)) resume.rows.push({ id, batches: [] })
        receiveStock({ opener, draft: resume })
      }
      catalogueForm({ opener, onCancel: () => receiveStock({ opener, draft: resume }), onExisting: resumeWithItem, onCreated: newItem => resumeWithItem(newItem.id) })
    }
  })
  ui.start(validate, () => {
    const lines = draftRows()
    for (const line of lines) D.postStock(line.item, line.safe, line.entry, { date: date(), reference: ref(), witness: witness.value, source: read('receive-source') })
    if (state.tab !== 'items') useTab('items')
    state.scopeSafe = safe(); rememberSafe()
    state.query = state.category = ''; state.stockView = 'all'
    const changed = state.item ? '#equipment-detail' : attrSelector('data-item-row', lines[0].item.id)
    complete('savedStock', changed, changed)
  }, { dirty: () => Boolean(ref() || draftRows().some(r => r.item && entryCount(r.entry))), discardKey: 'discardReceipt' })
}
