/*
 * Layout of the chosen direction, «Counter and paper».
 *
 * Every page is read in the same order:
 *   1. the navy band says where you are;
 *   2. the counter, a white bar across the band's lower edge, starts a new
 *      request, so it is the first thing seen and the first thing reached;
 *   3. the register of what is already on record follows, quieter.
 * A request is then filled in on its own page beside the official paper it
 * produces.
 */
;(() => {
  const band = ({ title, desc = '', right = '', back = true, big = false, eyebrow = '' }) => `<header class="v-band${big ? ' big' : ''}"><div class="v-wrap">
    ${back ? `<button type="button" class="v-back" data-act="go" data-to="hub">${K.ic('chevL', 'flip')}${t('backHub')}</button>` : ''}
    <div class="v-band-row"><div>${eyebrow ? `<p class="v-eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1>${desc ? `<p class="v-band-desc">${desc}</p>` : ''}</div>${right ? `<div class="v-band-acts">${right}</div>` : ''}</div>
  </div></header>`
  const tabs = (items, act, current) => `<div class="v-tabs" role="group">${items.map((i) => `<button type="button" data-act="${act}" data-v="${i.k}" aria-pressed="${String(current) === String(i.k)}">${esc(i.l)}${i.n != null ? `<span class="mono">${i.n}</span>` : ''}</button>`).join('')}</div>`
  const page = (bandHtml, counter, body) => `<div class="scroll">${bandHtml}<div class="v-wrap v-body">${counter}${body}</div></div>`
  const month = (iso) => new Intl.DateTimeFormat(S.lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { month: 'short', year: 'numeric' }).format(new Date(iso))
  const empty = (key) => `<p class="v-empty">${t(key)}</p>`

  /**
   * The counter on a service page: name the vehicle, start the request. `kind`
   * is the form it opens, `list` the order the vehicles are offered in.
   */
  const counter = ({ art, title, desc, label, kind, list = VEH, extra = '' }) => `<section class="v-counter v-start" data-start aria-labelledby="start-title">
    ${K.art(art)}<div class="v-start-text"><h2 id="start-title">${title}</h2><p>${desc}</p></div>
    <div class="v-go"><div class="fld"><label for="start-veh">${t('vehicle')}</label><select class="inp" id="start-veh">${list.map((v) => `<option value="${v.id}">${esc(v.plate)} · ${esc(K.vtype(v))}</option>`).join('')}</select></div>
      <button type="button" class="btn primary v-cta" data-act="overlay" data-kind="${kind}" data-pick>${K.ic('plus')}${label}</button>${extra}</div>
  </section>`

  function hub() {
    const doors = `<section class="v-counter v-doors" aria-label="${t('heroTitle')}">${K.services().map((x) => `<div class="v-door">
      <button type="button" class="v-door-main" data-act="go" data-to="${x.to}">${K.art(x.art)}<span class="v-door-text"><strong>${x.title}</strong><small><b class="mono${x.hot ? ' hot' : ''}">${x.n}</b>${x.unit}</small></span>${K.ic('chevR', 'flip v-door-go')}</button>
      <button type="button" class="btn primary v-cta" ${K.actAttrs(x.make)}>${K.ic('plus')}${x.make.label}</button></div>`).join('')}</section>`
    return page(band({ big: true, back: false, eyebrow: t('heroEyebrow'), title: t('heroTitle'), desc: t('heroDesc'), right: `<p class="v-fleet"><strong class="mono">${VEH.length}</strong><span>${t('fleetSize')}</span></p>` }), doors,
      `<p class="v-admin"><span>${t('manageFleet')}</span>${K.admin().map((x) => `<button type="button" class="link" ${K.actAttrs(x)}>${x.title}</button>`).join('')}</p>
      <header class="v-sec-head"><div><h2>${t('fleet')}</h2><p>${t('fleetDesc')}</p></div>
        <div class="v-tools"><label class="v-search">${K.ic('search')}<input class="inp" type="search" dir="auto" placeholder="${t('search')}" aria-label="${t('search')}"></label><button type="button" class="btn secondary" data-act="noop">${t('importFines')}</button></div></header>
      ${tabs([{ k: '', l: t('allSites') }, ...SITES.map((s) => ({ k: s.id, l: loc(s.ar, s.en) }))], 'site', S.site ?? '')}
      ${K.groups().map((g) => `<section class="v-sheet"><header class="v-sheet-head"><h3 dir="auto">${esc(loc(g.site.ar, g.site.en))}</h3><span><bdi class="mono">${g.vehicles.length}</bdi> ${t('vehicles')}</span></header>${K.tblFleet(g.vehicles)}</section>`).join('')}`)
  }

  /** One report as a dated ledger entry. */
  function entry(a, showVehicle) {
    const v = vOf(a.veh), has = K.hasIns(a)
    return `<li class="v-entry">
      <div class="v-entry-date"><b class="mono">${a.date.slice(8)}</b><span>${month(a.date)}</span><small class="mono">${a.time}</small></div>
      <div class="v-entry-body">
        <div class="v-entry-top"><div>${showVehicle ? K.plate(v.plate) : ''}<h3 dir="auto">${esc(K.vtype(v))}</h3><span class="muted" dir="auto">${esc(empName(a.emp))}</span></div>${K.badge('accident', a.status, a.id)}</div>
        <p class="v-entry-desc" dir="auto">${esc(K.accDesc(a))}</p>
        <p class="v-entry-meta"><span>${t('location')}: <b dir="auto">${esc(K.accLoc(a))}</b></span><span>${t('policeRef')}: <bdi class="mono ltr">${esc(a.police) || '—'}</bdi></span><span>${t('photosLabel')}: <bdi class="mono">${a.photos}</bdi></span></p>
        <div class="v-entry-ins">${K.cover()}${K.insFacts(a)}</div>
        <div class="v-entry-acts">
          ${a.letter ? `<button type="button" class="btn secondary" data-act="noop">${K.ic('ext')}${t('openLetter')}</button>` : `<button type="button" class="btn secondary" data-act="overlay" data-kind="letter" data-id="${a.id}">${K.ic('file')}${t('officialLetter')}</button>`}
          <button type="button" class="btn secondary" data-act="overlay" data-kind="insurance" data-id="${a.id}">${K.ic(has ? 'pencil' : 'plus')}${t(has ? 'editInsurance' : 'addInsurance')}</button>
          ${showVehicle ? `<button type="button" class="btn ghost" data-act="go" data-to="vehicle" data-id="${v.id}" data-tab="accidents">${t('vehicleDetail')}</button>` : ''}</div>
      </div></li>`
  }
  const ledger = (rows, showVehicle, none) => (rows.length ? `<ol class="v-ledger">${rows.map((a) => entry(a, showVehicle)).join('')}</ol>` : `<section class="v-sheet">${empty(none)}</section>`)

  function accidents() {
    const open = ACC.filter((a) => a.status === 'open').length
    return page(band({ title: t('accidentsTitle'), desc: t('accidentsDesc') }),
      counter({ art: 'accident', title: t('startAccident'), desc: t('addAccidentDesc'), label: t('newReport'), kind: 'accident' }),
      `${tabs([{ k: 'all', l: t('allStatuses'), n: ACC.length }, { k: 'open', l: t('openStatus'), n: open }, { k: 'closed', l: t('closedStatus'), n: ACC.length - open }], 'acFilter', S.acFilter)}
      ${ledger(K.accidents(), true, 'noRecords')}`)
  }

  function maintenance() {
    return page(band({ title: t('maintenanceTitle'), desc: t('maintenanceDesc'), right: `<button type="button" class="btn v-ghost" data-act="noop">${K.ic('print')}${t('printOdometerForm')}</button>` }),
      counter({ art: 'maintenance', title: t('startMaintenance'), desc: t('addMaintenanceDesc'), label: t('addMaintenance'), kind: 'maintenance' }),
      `<div class="v-tabrow">${tabs([{ k: 'log', l: t('monthlyLog') }, { k: 'records', l: t('maintenanceRecords'), n: MNT.length }], 'mtab', S.mTab)}
        <dl class="v-stats"><div><dt>${t('fleetKmDriven')}</dt><dd><bdi class="mono ltr">${K.num(sum(VEH, (v) => v.driven))}</bdi> ${t('km')}</dd></div><div><dt>${t('totalMaintenanceCost')}</dt><dd>${K.aed(sum(MNT, (m) => m.cost))}</dd></div></dl></div>
      <section class="v-sheet">${S.mTab === 'log' ? K.tblLog() : K.tblMaint(MNT)}</section>`)
  }

  function fines() {
    const rows = K.fines()
    return page(band({ title: t('finesLedgerTitle'), desc: t('finesLedgerDesc'), right: `<button type="button" class="btn v-ghost" data-act="noop">${K.ic('file')}${t('finesReport')}</button>` }),
      counter({ art: 'fines', title: t('startFine'), desc: t('addFineDesc'), label: t('addFine'), kind: 'fine', extra: `<button type="button" class="btn secondary v-cta" data-act="noop">${t('importFines')}</button>` }),
      `<div class="v-tabrow">${tabs(K.fineFilters(), 'fineFilter', S.fineFilter)}<dl class="v-stats">${K.fineStats().map((s) => `<div><dt>${s.label}</dt><dd>${K.aed(s.amount)}</dd></div>`).join('')}</dl></div>
      <section class="v-sheet">${rows.length ? K.tblFines(rows) : empty('noRecords')}</section>`)
  }

  /** Licences by how soon they end. The counter offers the most urgent vehicle first. */
  function renewals() {
    const rows = K.licences()
    return page(band({ title: t('renewService'), desc: t('renewServiceDesc') }),
      counter({ art: 'licence-renewal', title: t('startRenewal'), desc: t('renewDesc'), label: t('renew'), kind: 'renew', list: K.byExpiry() }),
      `<div class="v-tabrow">${tabs(K.licenceFilters(), 'lxFilter', S.lxFilter)}<dl class="v-stats"><div><dt>${t('notifyBefore')}</dt><dd><bdi class="mono">30</bdi> ${t('days')}</dd></div></dl></div>
      <section class="v-sheet">${rows.length ? K.tblLicences(rows) : empty('noRecords')}</section>`)
  }

  function vehicle() {
    const v = vOf(S.vehicleId), tab = S.tab
    const mine = (list) => list.filter((x) => x.veh === v.id)
    const body = tab === 'fines' ? `<section class="v-sheet">${mine(FINES).length ? K.tblFines(mine(FINES), false) : empty('noFines')}</section>`
      : tab === 'accidents' ? ledger(mine(ACC), false, 'noAccidents')
      : tab === 'maintenance' ? `<section class="v-sheet">${mine(MNT).length ? K.tblMaint(mine(MNT), false) : empty('noMaintenance')}</section>`
      : tab === 'renewals' ? `<section class="v-sheet"><header class="v-sheet-head"><h3>${t('currentLicense')}</h3><span class="v-period"><bdi class="mono ltr">${v.start} → ${v.expiry}</bdi>${K.badge('expiry', expiryState(v.expiry))}</span></header></section>
        <section class="v-sheet"><header class="v-sheet-head"><h3>${t('renewalHistory')}</h3><span><bdi class="mono">${mine(RENEWALS).length}</bdi> ${t('records')}</span></header>${mine(RENEWALS).length ? `<div class="v-pad">${K.renewalList(mine(RENEWALS))}</div>` : empty('noRenewals')}</section>`
      : `<section class="v-sheet">${empty('tabUnchanged')}</section>`
    // Renew leads only while the licence needs it, as on today's vehicle file.
    const requests = [
      { art: 'accident', label: t('newReport'), attrs: `data-act="overlay" data-kind="accident" data-id="${v.id}"` },
      { art: 'maintenance', label: t('addMaintenance'), attrs: `data-act="overlay" data-kind="maintenance" data-id="${v.id}"` },
      { art: 'maintenance', label: t('requestMaintenance'), attrs: 'data-act="noop"' },
      { art: 'fines', label: t('addFine'), attrs: `data-act="overlay" data-kind="fine" data-id="${v.id}"` },
      { art: 'licence-renewal', label: t('renew'), attrs: `data-act="overlay" data-kind="renew" data-id="${v.id}"`, lead: expiryState(v.expiry) !== 'valid' },
    ]
    return page(band({ title: `${K.plate(v.plate, 'xl')}<span dir="auto">${esc(K.vtype(v))}</span>`, desc: `${esc(K.vcls(v))} · ${esc(siteName(v.site))}`, right: `<button type="button" class="btn v-ghost" data-act="noop">${K.ic('pencil')}${t('editVehicle')}</button>` }),
      `<section class="v-counter v-requests" aria-labelledby="req-title"><h2 id="req-title">${t('newForVehicle')}</h2>
        <div class="v-req-row">${requests.map((r) => `<button type="button" class="v-req${r.lead ? ' lead' : ''}" ${r.attrs}>${K.art(r.art)}<span>${r.label}</span>${K.ic('plus')}</button>`).join('')}</div></section>`,
      `<dl class="v-facts">${K.facts(v).slice(3).map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl>
      ${tabs(K.vehTabs(v).map(([k, l, n]) => ({ k, l, n })), 'tab', tab)}${body}`)
  }

  /** A request is its own page: the form at the start, the paper it produces at the end. */
  function overlay(spec) {
    const many = spec.sections.filter((s) => s.title).length > 1
    const sections = spec.sections.map((s, i) => `<section class="v-fsec">${s.title ? `<h3>${many ? `<span class="mono">${String(i + 1).padStart(2, '0')}</span>` : ''}${s.title}${s.note ? `<small>${s.note}</small>` : ''}</h3>` : ''}${s.html}</section>`).join('')
    const side = spec.paper ? `<aside class="v-side"><p class="v-side-label">${t('liveLetter')}</p>${spec.paper}</aside>` : spec.aside ? `<aside class="v-side"><div class="v-note" data-aside>${spec.aside}</div></aside>` : ''
    return `<form class="v-compose" data-form="${spec.form}" novalidate aria-labelledby="ov-title">
      <header class="v-band flat"><div class="v-wrap"><button type="button" class="v-back" data-act="close">${K.ic('chevL', 'flip')}${t('cancel')}</button>
        <div class="v-band-row"><div><h1 id="ov-title">${spec.title}</h1><p class="v-band-desc">${spec.desc}</p></div></div></div></header>
      <div class="scroll"><div class="v-wrap v-compose-grid${side ? '' : ' solo'}"><div class="v-form">${K.formAlert()}${sections}</div>${side}</div></div>
      <footer class="v-compose-foot"><div class="v-wrap"><button type="button" class="btn ghost lg" data-act="close">${t('cancel')}</button><button type="submit" class="btn primary lg">${spec.submit}</button></div></footer>
    </form>`
  }

  VIEW = { screen: () => ({ hub, accidents, maintenance, fines, renewals, vehicle })[S.route](), overlay }
})()
