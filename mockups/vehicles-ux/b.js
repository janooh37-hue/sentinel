/*
 * Direction B · Work queue.
 * The module gets its own service rail, the hub opens on what is waiting for an
 * action, registers become dense expandable rows, and every form docks beside
 * the list it belongs to instead of covering it.
 */
;(() => {
  const seg = (items, act, current) => `<div class="b-seg" role="group">${items.map((i) => `<button type="button" data-act="${act}" data-v="${i.k}" aria-pressed="${String(current) === String(i.k)}">${esc(i.l)}${i.n != null ? `<span class="mono">${i.n}</span>` : ''}</button>`).join('')}</div>`
  const head = ({ title, desc = '', right = '', count }) => `<header class="b-head"><div><h1>${title}${count != null ? `<span class="b-h-count mono">${count}</span>` : ''}</h1>${desc ? `<p>${desc}</p>` : ''}</div><div class="b-acts">${right}</div></header>`

  function rail() {
    const on = (r) => (S.route === r ? ' on' : '')
    return `<aside class="b-rail" aria-label="${t('heroTitle')}">
      <p class="b-rail-title">${t('heroTitle')}</p>
      <nav>
        <button type="button" class="b-nav${on('hub')}" data-act="go" data-to="hub" title="${t('overview')}"><span class="b-nav-ic">${K.ic('alert')}</span><span>${t('overview')}</span><b class="mono hot">${K.queue().length}</b></button>
        ${K.services().map((x) => `<button type="button" class="b-nav${x.id !== 'renew' ? on(x.to) : ''}" ${K.svcAttrs(x)} title="${x.title}">${K.art(x.art)}<span>${x.title}</span><b class="mono${x.hot ? ' hot' : ''}">${x.n}</b></button>`).join('')}
      </nav>
      <p class="b-rail-label">${t('manageFleet')}</p>
      <nav class="b-rail-admin">${K.admin().map((x) => `<button type="button" class="b-nav" ${K.actAttrs(x)} title="${x.title}">${K.art(x.art)}<span>${x.title}</span></button>`).join('')}</nav>
      <p class="b-rail-foot"><strong class="mono">${VEH.length}</strong> ${t('fleetSize')}</p>
    </aside>`
  }
  const page = (html) => `<div class="b-shell${S.overlay ? ' docked' : ''}">${rail()}<div class="scroll b-main"><div class="b-page">${html}</div></div></div>`

  function fleet() {
    return `<section class="b-sec"><header class="b-sec-head"><h2>${t('fleet')}</h2>
        <label class="b-search">${K.ic('search')}<input class="inp" type="search" dir="auto" placeholder="${t('search')}" aria-label="${t('search')}"></label>
        ${seg([{ k: '', l: t('allSites') }, ...SITES.map((s) => ({ k: s.id, l: loc(s.ar, s.en) }))], 'site', S.site ?? '')}</header>
      <div class="b-panel"><div class="tbl-wrap"><table class="tbl b-tbl"><thead><tr><th>${t('plate')}</th><th>${t('type')}</th><th>${t('licenseExpiry')}</th><th class="opt">${t('tabFines')}</th><th class="opt">${t('odometer')}</th><th class="end">${t('action')}</th></tr></thead>
      ${K.groups().map((g) => `<tbody><tr class="b-grp"><th colspan="6" scope="colgroup"><span dir="auto">${esc(loc(g.site.ar, g.site.en))}</span><span class="mono">${g.vehicles.length}</span></th></tr>${g.vehicles.map((v) => `<tr>
        <td>${K.plate(v.plate)}</td><td><span class="two-line"><strong dir="auto">${esc(K.vtype(v))}</strong><small>${esc(K.vcls(v))}</small></span></td><td>${K.licence(v)}</td>
        <td class="opt">${K.vehFines(v)}</td><td class="opt"><bdi class="mono ltr">${K.num(v.km)}</bdi> ${t('km')}</td><td><div class="acts">${K.rowActs(v)}</div></td></tr>`).join('')}</tbody>`).join('')}</table></div></div></section>`
  }

  function hub() {
    const q = K.queue()
    return page(`${head({ title: t('needsAttention'), desc: t('needsAttentionDesc'), count: q.length })}
      ${q.length ? `<ol class="b-queue">${q.map((x, i) => `<li class="b-q">${K.art(x.art)}
        <div class="b-q-main"><strong>${x.text}</strong><span>${K.plate(x.veh.plate, 'sm')}<span dir="auto">${esc(K.vtype(x.veh))}</span></span></div>
        <span class="b-q-state">${x.badge}</span>
        <button type="button" class="btn ${i < 2 ? 'primary' : 'secondary'}" ${K.actAttrs(x)}>${x.label}</button></li>`).join('')}</ol>` : `<p class="b-empty">${t('allClear')}</p>`}
      <div class="b-admin-inline">${K.admin().map((x) => `<button type="button" class="btn secondary" ${K.actAttrs(x)}>${x.title}</button>`).join('')}</div>
      ${fleet()}`)
  }

  /** One report: a dense row that opens in place. */
  function accRow(a, showVehicle) {
    const v = vOf(a.veh), has = K.hasIns(a), open = S.expand === a.id
    return `<li class="b-acc${open ? ' open' : ''}">
      <div class="b-acc-row">
        <button type="button" class="b-acc-main" data-act="expand" data-id="${a.id}" aria-expanded="${open}" aria-label="${t(open ? 'hideDetails' : 'details')} · ${esc(v.plate)} ${a.date}">
          ${K.ic('chevD', 'b-chev')}${K.date(a.date)}${showVehicle ? K.plate(v.plate, 'sm') : ''}<span class="b-acc-text" dir="auto">${esc(K.accDesc(a))}</span></button>
        <span class="b-acc-ins">${a.ins.status ? K.badge('claim', a.ins.status) : `<span class="faint">${t(has ? 'insuranceTitle' : 'insuranceNone')}</span>`}</span>
        ${K.badge('accident', a.status, a.id)}
      </div>
      ${open ? `<div class="b-acc-detail">
        <p class="b-acc-desc" dir="auto">${esc(K.accDesc(a))}</p>
        <dl class="ins-facts"><div><dt>${t('date')}</dt><dd>${K.date(a.date, a.time)}</dd></div><div><dt>${t('driver')}</dt><dd dir="auto">${esc(empName(a.emp))}</dd></div><div><dt>${t('location')}</dt><dd dir="auto">${esc(K.accLoc(a))}</dd></div><div><dt>${t('policeRef')}</dt><dd><bdi class="mono ltr">${esc(a.police) || '—'}</bdi></dd></div><div><dt>${t('photosLabel')}</dt><dd><bdi class="mono">${a.photos}</bdi></dd></div></dl>
        <div class="b-acc-cover">${K.cover()}${K.insFacts(a)}</div>
        <div class="b-acts"><button type="button" class="btn secondary" data-act="overlay" data-kind="insurance" data-id="${a.id}">${K.ic(has ? 'pencil' : 'plus')}${t(has ? 'editInsurance' : 'addInsurance')}</button>
          ${a.letter ? `<button type="button" class="btn secondary" data-act="noop">${K.ic('ext')}${t('openLetter')}</button>` : `<button type="button" class="btn primary" data-act="overlay" data-kind="letter" data-id="${a.id}">${K.ic('file')}${t('officialLetter')}</button>`}
          ${showVehicle ? `<button type="button" class="btn ghost" data-act="go" data-to="vehicle" data-id="${v.id}" data-tab="accidents">${t('vehicleDetail')}</button>` : ''}</div>
      </div>` : ''}
    </li>`
  }

  function accidents() {
    const open = ACC.filter((a) => a.status === 'open').length, rows = K.accidents()
    return page(`${head({ title: t('accidentsTitle'), desc: t('accidentsDesc'), right: `<button type="button" class="btn primary lg" data-act="overlay" data-kind="accident">${K.ic('plus')}${t('newReport')}</button>` })}
      ${seg([{ k: 'all', l: t('allStatuses'), n: ACC.length }, { k: 'open', l: t('openStatus'), n: open }, { k: 'closed', l: t('closedStatus'), n: ACC.length - open }], 'acFilter', S.acFilter)}
      <ul class="b-panel b-acc-list">${rows.map((a) => accRow(a, true)).join('')}</ul>`)
  }

  function maintenance() {
    return page(`${head({ title: t('maintenanceTitle'), desc: t('maintenanceDesc'), right: `<button type="button" class="btn secondary" data-act="noop">${K.ic('print')}${t('printOdometerForm')}</button><button type="button" class="btn primary lg" data-act="overlay" data-kind="maintenance">${K.ic('plus')}${t('addMaintenance')}</button>` })}
      <div class="b-bar">${seg([{ k: 'log', l: t('monthlyLog') }, { k: 'records', l: t('maintenanceRecords'), n: MNT.length }], 'mtab', S.mTab)}
        <p class="b-stat">${t('fleetKmDriven')} <strong><bdi class="mono ltr">${K.num(sum(VEH, (v) => v.driven))}</bdi> ${t('km')}</strong></p><p class="b-stat">${t('totalMaintenanceCost')} <strong>${K.aed(sum(MNT, (m) => m.cost))}</strong></p></div>
      <div class="b-panel">${S.mTab === 'log' ? K.tblLog() : K.tblMaint(MNT)}</div>`)
  }

  function fines() {
    const rows = K.fines()
    return page(`${head({ title: t('finesLedgerTitle'), desc: t('finesLedgerDesc'), right: `<button type="button" class="btn secondary" data-act="noop">${K.ic('file')}${t('finesReport')}</button><button type="button" class="btn primary" data-act="noop">${t('importFines')}</button>` })}
      <div class="b-bar">${seg(K.fineFilters(), 'fineFilter', S.fineFilter)}<p class="b-stat">${t('total')} <strong>${K.aed(sum(rows, (f) => f.amount))}</strong></p></div>
      <div class="b-panel">${K.tblFines(rows)}</div>`)
  }

  function vehicle() {
    const v = vOf(S.vehicleId), tab = S.tab
    const mine = (list) => list.filter((x) => x.veh === v.id)
    const empty = (key) => `<p class="b-empty">${t(key)}</p>`
    const body = tab === 'fines' ? (mine(FINES).length ? K.tblFines(mine(FINES), false) : empty('noFines'))
      : tab === 'accidents' ? (mine(ACC).length ? `<ul class="b-acc-list">${mine(ACC).map((a) => accRow(a, false)).join('')}</ul>` : empty('noAccidents'))
      : tab === 'maintenance' ? (mine(MNT).length ? K.tblMaint(mine(MNT), false) : empty('noMaintenance'))
      : empty('renewalsEmpty')
    const action = tab === 'accidents' ? `<button type="button" class="btn primary" data-act="overlay" data-kind="accident" data-id="${v.id}">${K.ic('plus')}${t('newReport')}</button>`
      : tab === 'maintenance' ? `<button type="button" class="btn secondary" data-act="noop">${t('requestMaintenance')}</button><button type="button" class="btn primary" data-act="overlay" data-kind="maintenance" data-id="${v.id}">${K.ic('plus')}${t('addMaintenance')}</button>`
      : tab === 'fines' ? `<button type="button" class="btn secondary" data-act="noop">${t('addFine')}</button>` : ''
    return page(`<div class="b-file">
      <aside class="b-file-side"><button type="button" class="link" data-act="go" data-to="hub">${K.ic('chevL', 'flip')}${t('fleet')}</button>
        ${K.plate(v.plate, 'xl')}<h1 dir="auto">${esc(K.vtype(v))}</h1><p class="muted">${esc(K.vcls(v))} · ${esc(siteName(v.site))}</p>
        <dl class="b-facts">${K.facts(v).slice(3).map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl>
        <div class="b-acts"><button type="button" class="btn ${expiryState(v.expiry) === 'valid' ? 'secondary' : 'primary'}" data-act="noop">${t('renew')}</button><button type="button" class="btn secondary" data-act="noop">${K.ic('pencil')}${t('editVehicle')}</button></div></aside>
      <div class="b-file-main"><div class="b-bar"><div class="b-tabs" role="group" aria-label="${t('vehicleDetail')}">${K.vehTabs(v).map(([k, l, n]) => `<button type="button" data-act="tab" data-v="${k}" aria-pressed="${tab === k}">${l}<span class="mono">${n}</span></button>`).join('')}</div><div class="b-acts">${action}</div></div>
        <div class="b-panel">${body}</div></div></div>`)
  }

  function overlay(spec) {
    const sections = spec.sections.map((s) => `<section class="b-fsec">${s.title ? `<h3>${s.title}${s.note ? `<small>${s.note}</small>` : ''}</h3>` : ''}${s.html}</section>`).join('')
    return `<form class="b-dock" data-form="${spec.form}" novalidate aria-labelledby="ov-title">
      <header><div><h2 id="ov-title">${spec.title}</h2><p>${spec.desc}</p></div><button type="button" class="btn ghost icon" data-act="close" aria-label="${t('close')}">${K.ic('x')}</button></header>
      <div class="b-dock-body">${K.formAlert()}${sections}${S.overlay.kind === 'letter' ? spec.paper : ''}</div>
      <footer><button type="button" class="btn ghost" data-act="close">${t('cancel')}</button><button type="submit" class="btn primary lg">${spec.submit}</button></footer>
    </form>`
  }

  V.b = { screen: () => ({ hub, accidents, maintenance, fines, vehicle })[S.route](), overlay }
})()
