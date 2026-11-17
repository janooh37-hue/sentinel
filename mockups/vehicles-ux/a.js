/*
 * Direction A · Sharper register.
 * Today's page map and dialogs, with the hierarchy turned up: the live figure
 * leads each service, administration leaves the service row, the description
 * leads each accident report, and forms are split into numbered sections.
 */
;(() => {
  const head = ({ title, desc, right = '', eyebrow = '' }) => `<header class="a-head">
    <div>${eyebrow ? `<p class="a-eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1><p class="a-sub">${desc}</p></div>
    <div class="a-acts">${right}</div></header>`
  const chips = (items, act, current) => `<div class="a-chips" role="group">${items.map((i) => `<button type="button" class="chip" data-act="${act}" data-v="${i.k}" aria-pressed="${String(current) === String(i.k)}">${esc(i.l)}${i.n != null ? `<span class="n">${i.n}</span>` : ''}</button>`).join('')}</div>`
  const page = (html) => `<div class="scroll"><div class="a-page">${html}</div></div>`

  function fleet() {
    return `<section class="a-ledger">
      <header class="a-sec-head"><div><h2>${t('fleet')}</h2><p>${t('fleetDesc')}</p></div>
        <div class="a-acts"><button type="button" class="btn secondary" data-act="noop">${K.ic('print')}${t('output.print')}</button><button type="button" class="btn primary" data-act="noop">${t('importFines')}</button></div></header>
      <div class="a-tools"><label class="a-search">${K.ic('search')}<input class="inp" type="search" dir="auto" placeholder="${t('search')}" aria-label="${t('search')}"></label>
        ${chips([{ k: '', l: t('allSites') }, ...SITES.map((s) => ({ k: s.id, l: loc(s.ar, s.en) }))], 'site', S.site ?? '')}</div>
      ${K.groups().map((g) => `<section class="a-group"><header><h3 dir="auto">${esc(loc(g.site.ar, g.site.en))}</h3><span class="a-count mono" aria-label="${g.vehicles.length} ${t('vehicles')}">${g.vehicles.length}</span></header>${K.tblFleet(g.vehicles)}</section>`).join('')}
    </section>`
  }

  function hub() {
    return page(`${head({ eyebrow: t('heroEyebrow'), title: t('heroTitle'), desc: t('heroDesc'), right: `<p class="a-fleet"><strong class="mono">${K.summary().vehicles}</strong><span>${t('fleetSize')}</span></p>` })}
      <div class="a-services" role="group" aria-label="${t('heroTitle')}">${K.services().map((x) => `<button type="button" class="a-svc${x.hot ? ' hot' : ''}" ${K.svcAttrs(x)}>
        ${K.art(x.art)}<span class="a-svc-text"><strong>${x.title}</strong><small>${x.desc}</small></span>
        <span class="a-svc-fig"><b class="mono">${x.n}</b><span>${x.unit}</span></span></button>`).join('')}</div>
      <div class="a-admin"><span>${t('manageFleet')}</span>${K.admin().map((x) => `<button type="button" class="btn secondary" ${K.actAttrs(x)}>${x.title}</button>`).join('')}</div>
      ${fleet()}`)
  }

  function accCard(a, showVehicle) {
    const v = vOf(a.veh), has = K.hasIns(a)
    return `<article class="a-acc">
      <header><div class="a-acc-id">${showVehicle ? K.plate(v.plate) : ''}<h3 dir="auto">${esc(K.vtype(v))}</h3></div>${K.badge('accident', a.status, a.id)}</header>
      <p class="a-acc-meta">${K.date(a.date, a.time)} · <span dir="auto">${esc(empName(a.emp))}</span></p>
      <p class="a-acc-desc" dir="auto">${esc(K.accDesc(a))}</p>
      <dl class="a-acc-facts"><div><dt>${t('location')}</dt><dd dir="auto">${esc(K.accLoc(a))}</dd></div><div><dt>${t('policeRef')}</dt><dd><bdi class="mono ltr">${esc(a.police) || '—'}</bdi></dd></div></dl>
      <div class="a-acc-ins">${K.cover()}${has ? K.insFacts(a) : `<p class="muted">${t('insuranceNone')}</p>`}
        <button type="button" class="link" data-act="overlay" data-kind="insurance" data-id="${a.id}">${K.ic(has ? 'pencil' : 'plus')}${t(has ? 'editInsurance' : 'addInsurance')}</button></div>
      <footer>${showVehicle ? `<button type="button" class="btn secondary" data-act="go" data-to="vehicle" data-id="${v.id}" data-tab="accidents">${t('open')}</button>` : ''}
        ${a.letter ? `<button type="button" class="btn secondary" data-act="noop">${K.ic('ext')}${t('openLetter')}</button>` : `<button type="button" class="btn primary" data-act="overlay" data-kind="letter" data-id="${a.id}">${K.ic('file')}${t('officialLetter')}</button>`}
        <span class="a-acc-photos">${t('photosLabel')}: <bdi class="mono">${a.photos}</bdi></span></footer>
    </article>`
  }

  function accidents() {
    const open = ACC.filter((a) => a.status === 'open').length, rows = K.accidents()
    const box = (v, inner, n) => `<button type="button" class="a-box" data-act="acFilter" data-v="${v}" aria-pressed="${S.acFilter === v}">${inner}<strong class="mono">${n}</strong></button>`
    return page(`${K.back()}${head({ title: t('accidentsTitle'), desc: t('accidentsDesc'), right: `<button type="button" class="btn primary lg" data-act="overlay" data-kind="accident">${K.ic('plus')}${t('newReport')}</button>` })}
      <div class="a-boxes" role="group" aria-label="${t('status')}">${box('all', `<span class="muted">${t('records')}</span>`, ACC.length)}${box('open', K.badge('accident', 'open'), open)}${box('closed', K.badge('accident', 'closed'), ACC.length - open)}</div>
      <div class="a-cards">${rows.map((a) => accCard(a, true)).join('')}</div>
      <p class="a-foot" aria-live="polite"><bdi>${rows.length} ${t('records')}</bdi></p>`)
  }

  function maintenance() {
    const tabs = [{ k: 'log', l: t('monthlyLog') }, { k: 'records', l: t('maintenanceRecords'), n: MNT.length }]
    return page(`${K.back()}${head({ title: t('maintenanceTitle'), desc: t('maintenanceDesc'), right: `<button type="button" class="btn secondary" data-act="noop">${K.ic('print')}${t('printOdometerForm')}</button><button type="button" class="btn primary lg" data-act="overlay" data-kind="maintenance">${K.ic('plus')}${t('addMaintenance')}</button>` })}
      <dl class="a-totals"><div><dt>${t('fleetKmDriven')}</dt><dd><bdi class="mono ltr">${K.num(sum(VEH, (v) => v.driven))}</bdi> <small>${t('km')}</small></dd></div><div><dt>${t('totalMaintenanceCost')}</dt><dd>${K.aed(sum(MNT, (m) => m.cost))}</dd></div></dl>
      ${chips(tabs, 'mtab', S.mTab)}
      <div class="a-panel">${S.mTab === 'log' ? K.tblLog() : K.tblMaint(MNT)}</div>`)
  }

  function fines() {
    const rows = K.fines()
    return page(`${K.back()}${head({ title: t('finesLedgerTitle'), desc: t('finesLedgerDesc'), right: `<button type="button" class="btn secondary" data-act="noop">${K.ic('file')}${t('finesReport')}</button><button type="button" class="btn primary" data-act="noop">${t('importFines')}</button>` })}
      ${chips(K.fineFilters(), 'fineFilter', S.fineFilter)}
      <div class="a-panel">${K.tblFines(rows)}<p class="a-total"><span>${t('total')}</span>${K.aed(sum(rows, (f) => f.amount))}</p></div>`)
  }

  function vehicle() {
    const v = vOf(S.vehicleId), tab = S.tab
    const mine = (list) => list.filter((x) => x.veh === v.id)
    const empty = (key) => `<p class="a-empty">${t(key)}</p>`
    const body = tab === 'fines' ? (mine(FINES).length ? K.tblFines(mine(FINES), false) : empty('noFines'))
      : tab === 'accidents' ? `<div class="a-tabhead"><button type="button" class="btn primary" data-act="overlay" data-kind="accident" data-id="${v.id}">${K.ic('plus')}${t('newReport')}</button></div>${mine(ACC).length ? `<div class="a-cards pad">${mine(ACC).map((a) => accCard(a, false)).join('')}</div>` : empty('noAccidents')}`
      : tab === 'maintenance' ? `<div class="a-tabhead"><button type="button" class="btn secondary" data-act="noop">${t('requestMaintenance')}</button><button type="button" class="btn primary" data-act="overlay" data-kind="maintenance" data-id="${v.id}">${K.ic('plus')}${t('addMaintenance')}</button></div>${mine(MNT).length ? K.tblMaint(mine(MNT), false) : empty('noMaintenance')}`
      : empty('renewalsEmpty')
    return page(`${K.back()}${head({ title: `${t('vehicleDetail')} ${K.plate(v.plate, 'lg')}`, desc: `${esc(K.vtype(v))} · ${esc(siteName(v.site))}`,
      right: `<button type="button" class="btn secondary" data-act="noop">${K.ic('pencil')}${t('editVehicle')}</button><button type="button" class="btn ${expiryState(v.expiry) === 'valid' ? 'secondary' : 'primary'}" data-act="noop">${t('renew')}</button><button type="button" class="btn secondary" data-act="noop">${t('addFine')}</button>` })}
      <div class="a-panel a-over"><div class="a-photo">${K.ic('car')}</div><dl class="a-facts">${K.facts(v).slice(1).map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl></div>
      ${chips(K.vehTabs(v).map(([k, l, n]) => ({ k, l, n })), 'tab', tab)}
      <div class="a-panel">${body}</div>`)
  }

  function overlay(spec) {
    const numbered = spec.sections.filter((s) => s.title).length > 1
    const sections = spec.sections.map((s, i) => `<section class="a-fsec">${s.title ? `<h3>${numbered ? `<span class="a-step mono">${i + 1}</span>` : ''}${s.title}${s.note ? `<small>${s.note}</small>` : ''}</h3>` : ''}${s.html}</section>`).join('')
    const side = S.overlay.kind === 'letter' ? spec.paper : ''
    return `<div class="a-dim"><form class="a-dialog${spec.wide || side ? ' wide' : ''}" data-form="${spec.form}" novalidate role="dialog" aria-modal="true" aria-labelledby="ov-title">
      <header><div><h2 id="ov-title">${spec.title}</h2><p>${spec.desc}</p></div><button type="button" class="btn ghost icon" data-act="close" aria-label="${t('close')}">${K.ic('x')}</button></header>
      <div class="a-dialog-body${side && sections ? ' split' : ''}">${sections ? `<div class="a-fsecs">${K.formAlert()}${sections}</div>` : ''}${side ? `<div>${side}</div>` : ''}</div>
      <footer><button type="button" class="btn ghost" data-act="close">${t('cancel')}</button><button type="submit" class="btn primary">${spec.submit}</button></footer>
    </form></div>`
  }

  V.a = { screen: () => ({ hub, accidents, maintenance, fines, vehicle })[S.route](), overlay }
})()
