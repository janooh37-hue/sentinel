/*
 * Direction C · Counter and paper.
 * Navy carries the module: a full-width band holds the title and the service
 * doors. Registers read as dated ledger entries, and a service is filled in on
 * its own page beside the official paper it produces, which fills in as the
 * operator types.
 */
;(() => {
  const band = ({ title, desc = '', right = '', back = true, extra = '', big = false, eyebrow = '' }) => `<header class="c-band${big ? ' big' : ''}"><div class="c-wrap">
    ${back ? `<button type="button" class="c-back" data-act="go" data-to="hub">${K.ic('chevL', 'flip')}${t('backHub')}</button>` : ''}
    <div class="c-band-row"><div>${eyebrow ? `<p class="c-eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1>${desc ? `<p class="c-band-desc">${desc}</p>` : ''}</div><div class="c-band-acts">${right}</div></div>
    ${extra}</div></header>`
  const tabs = (items, act, current) => `<div class="c-tabs" role="group">${items.map((i) => `<button type="button" data-act="${act}" data-v="${i.k}" aria-pressed="${String(current) === String(i.k)}">${esc(i.l)}${i.n != null ? `<span class="mono">${i.n}</span>` : ''}</button>`).join('')}</div>`
  const page = (bandHtml, body) => `<div class="scroll">${bandHtml}<div class="c-wrap c-body">${body}</div></div>`
  const month = (iso) => new Intl.DateTimeFormat(S.lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { month: 'short', year: 'numeric' }).format(new Date(iso))

  function hub() {
    const doors = `<div class="c-doors" role="group" aria-label="${t('heroTitle')}">${K.services().map((x) => `<button type="button" class="c-door" ${K.svcAttrs(x)}>
      ${K.art(x.art)}<span class="c-door-text"><strong>${x.title}</strong><small><b class="mono${x.hot ? ' hot' : ''}">${x.n}</b>${x.unit}</small></span>${K.ic('chevR', 'flip c-door-go')}</button>`).join('')}</div>`
    return page(band({ big: true, back: false, eyebrow: t('heroEyebrow'), title: t('heroTitle'), desc: t('heroDesc'), right: `<p class="c-fleet"><strong class="mono">${VEH.length}</strong><span>${t('fleetSize')}</span></p>`, extra: doors }),
      `<p class="c-admin"><span>${t('manageFleet')}</span>${K.admin().map((x) => `<button type="button" class="link" ${K.actAttrs(x)}>${x.title}</button>`).join('')}</p>
      <header class="c-sec-head"><div><h2>${t('fleet')}</h2><p>${t('fleetDesc')}</p></div>
        <div class="c-tools"><label class="c-search">${K.ic('search')}<input class="inp" type="search" dir="auto" placeholder="${t('search')}" aria-label="${t('search')}"></label><button type="button" class="btn primary" data-act="noop">${t('importFines')}</button></div></header>
      ${tabs([{ k: '', l: t('allSites') }, ...SITES.map((s) => ({ k: s.id, l: loc(s.ar, s.en) }))], 'site', S.site ?? '')}
      ${K.groups().map((g) => `<section class="c-sheet"><header class="c-sheet-head"><h3 dir="auto">${esc(loc(g.site.ar, g.site.en))}</h3><span><bdi class="mono">${g.vehicles.length}</bdi> ${t('vehicles')}</span></header>${K.tblFleet(g.vehicles)}</section>`).join('')}`)
  }

  /** One report as a dated ledger entry. */
  function entry(a, showVehicle) {
    const v = vOf(a.veh), has = K.hasIns(a)
    return `<li class="c-entry">
      <div class="c-entry-date"><b class="mono">${a.date.slice(8)}</b><span>${month(a.date)}</span><small class="mono">${a.time}</small></div>
      <div class="c-entry-body">
        <div class="c-entry-top"><div>${showVehicle ? K.plate(v.plate) : ''}<h3 dir="auto">${esc(K.vtype(v))}</h3><span class="muted" dir="auto">${esc(empName(a.emp))}</span></div>${K.badge('accident', a.status, a.id)}</div>
        <p class="c-entry-desc" dir="auto">${esc(K.accDesc(a))}</p>
        <p class="c-entry-meta"><span>${t('location')}: <b dir="auto">${esc(K.accLoc(a))}</b></span><span>${t('policeRef')}: <bdi class="mono ltr">${esc(a.police) || '—'}</bdi></span><span>${t('photosLabel')}: <bdi class="mono">${a.photos}</bdi></span></p>
        <div class="c-entry-ins">${K.cover()}${K.insFacts(a)}</div>
        <div class="c-entry-acts">
          ${a.letter ? `<button type="button" class="btn secondary" data-act="noop">${K.ic('ext')}${t('openLetter')}</button>` : `<button type="button" class="btn primary" data-act="overlay" data-kind="letter" data-id="${a.id}">${K.ic('file')}${t('officialLetter')}</button>`}
          <button type="button" class="btn secondary" data-act="overlay" data-kind="insurance" data-id="${a.id}">${K.ic(has ? 'pencil' : 'plus')}${t(has ? 'editInsurance' : 'addInsurance')}</button>
          ${showVehicle ? `<button type="button" class="btn ghost" data-act="go" data-to="vehicle" data-id="${v.id}" data-tab="accidents">${t('vehicleDetail')}</button>` : ''}</div>
      </div></li>`
  }

  function accidents() {
    const open = ACC.filter((a) => a.status === 'open').length, rows = K.accidents()
    return page(band({ title: t('accidentsTitle'), desc: t('accidentsDesc'), right: `<button type="button" class="btn c-inv lg" data-act="overlay" data-kind="accident">${K.ic('plus')}${t('newReport')}</button>` }),
      `${tabs([{ k: 'all', l: t('allStatuses'), n: ACC.length }, { k: 'open', l: t('openStatus'), n: open }, { k: 'closed', l: t('closedStatus'), n: ACC.length - open }], 'acFilter', S.acFilter)}
      <ol class="c-ledger">${rows.map((a) => entry(a, true)).join('')}</ol>`)
  }

  function maintenance() {
    return page(band({ title: t('maintenanceTitle'), desc: t('maintenanceDesc'), right: `<button type="button" class="btn c-ghost" data-act="noop">${K.ic('print')}${t('printOdometerForm')}</button><button type="button" class="btn c-inv lg" data-act="overlay" data-kind="maintenance">${K.ic('plus')}${t('addMaintenance')}</button>` }),
      `<dl class="c-figures"><div><dt>${t('fleetKmDriven')}</dt><dd><bdi class="mono ltr">${K.num(sum(VEH, (v) => v.driven))}</bdi> <small>${t('km')}</small></dd></div><div><dt>${t('totalMaintenanceCost')}</dt><dd>${K.aed(sum(MNT, (m) => m.cost))}</dd></div></dl>
      ${tabs([{ k: 'log', l: t('monthlyLog') }, { k: 'records', l: t('maintenanceRecords'), n: MNT.length }], 'mtab', S.mTab)}
      <section class="c-sheet">${S.mTab === 'log' ? K.tblLog() : K.tblMaint(MNT)}</section>`)
  }

  function fines() {
    const rows = K.fines()
    return page(band({ title: t('finesLedgerTitle'), desc: t('finesLedgerDesc'), right: `<button type="button" class="btn c-ghost" data-act="noop">${K.ic('file')}${t('finesReport')}</button><button type="button" class="btn c-inv" data-act="noop">${t('importFines')}</button>` }),
      `${tabs(K.fineFilters(), 'fineFilter', S.fineFilter)}
      <section class="c-sheet">${K.tblFines(rows)}<p class="c-total"><span>${t('total')}</span>${K.aed(sum(rows, (f) => f.amount))}</p></section>`)
  }

  function vehicle() {
    const v = vOf(S.vehicleId), tab = S.tab
    const mine = (list) => list.filter((x) => x.veh === v.id)
    const empty = (key) => `<p class="c-empty">${t(key)}</p>`
    const body = tab === 'fines' ? `<section class="c-sheet">${mine(FINES).length ? K.tblFines(mine(FINES), false) : empty('noFines')}</section>`
      : tab === 'accidents' ? (mine(ACC).length ? `<ol class="c-ledger">${mine(ACC).map((a) => entry(a, false)).join('')}</ol>` : `<section class="c-sheet">${empty('noAccidents')}</section>`)
      : tab === 'maintenance' ? `<section class="c-sheet">${mine(MNT).length ? K.tblMaint(mine(MNT), false) : empty('noMaintenance')}</section>`
      : `<section class="c-sheet">${empty('renewalsEmpty')}</section>`
    const action = tab === 'accidents' ? `<button type="button" class="btn primary" data-act="overlay" data-kind="accident" data-id="${v.id}">${K.ic('plus')}${t('newReport')}</button>`
      : tab === 'maintenance' ? `<button type="button" class="btn secondary" data-act="noop">${t('requestMaintenance')}</button><button type="button" class="btn primary" data-act="overlay" data-kind="maintenance" data-id="${v.id}">${K.ic('plus')}${t('addMaintenance')}</button>`
      : tab === 'fines' ? `<button type="button" class="btn secondary" data-act="noop">${t('addFine')}</button>` : ''
    return page(band({ title: `${K.plate(v.plate, 'xl')}<span dir="auto">${esc(K.vtype(v))}</span>`, desc: `${esc(K.vcls(v))} · ${esc(siteName(v.site))}`,
      right: `<button type="button" class="btn c-ghost" data-act="noop">${K.ic('pencil')}${t('editVehicle')}</button><button type="button" class="btn c-inv" data-act="noop">${t('renew')}</button>` }),
      `<dl class="c-facts">${K.facts(v).slice(3).map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl>
      <div class="c-tabrow">${tabs(K.vehTabs(v).map(([k, l, n]) => ({ k, l, n })), 'tab', tab)}<div class="c-tools">${action}</div></div>${body}`)
  }

  /** A service is its own page: the form at the start, the paper it produces at the end. */
  function overlay(spec) {
    const many = spec.sections.filter((s) => s.title).length > 1
    const sections = spec.sections.map((s, i) => `<section class="c-fsec">${s.title ? `<h3>${many ? `<span class="mono">${String(i + 1).padStart(2, '0')}</span>` : ''}${s.title}${s.note ? `<small>${s.note}</small>` : ''}</h3>` : ''}${s.html}</section>`).join('')
    const side = spec.paper ? `<aside class="c-side"><p class="c-side-label">${t('liveLetter')}</p>${spec.paper}</aside>` : spec.aside ? `<aside class="c-side"><div class="c-note">${spec.aside}</div></aside>` : ''
    return `<form class="c-compose" data-form="${spec.form}" novalidate aria-labelledby="ov-title">
      <header class="c-band"><div class="c-wrap"><button type="button" class="c-back" data-act="close">${K.ic('chevL', 'flip')}${t('cancel')}</button>
        <div class="c-band-row"><div><h1 id="ov-title">${spec.title}</h1><p class="c-band-desc">${spec.desc}</p></div></div></div></header>
      <div class="scroll"><div class="c-wrap c-compose-grid${side ? '' : ' solo'}"><div class="c-form">${K.formAlert()}${sections}</div>${side}</div></div>
      <footer class="c-compose-foot"><div class="c-wrap"><button type="button" class="btn ghost lg" data-act="close">${t('cancel')}</button><button type="submit" class="btn primary lg">${spec.submit}</button></div></footer>
    </form>`
  }

  V.c = { screen: () => ({ hub, accidents, maintenance, fines, vehicle })[S.route](), overlay }
})()
