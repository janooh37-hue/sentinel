# Assets → Armory / خزنة السلاح

Bilingual approval mockup. There is no backend, login or persistent storage. The item list is based on the workbook. All quantities and serials are invented sample data. Names, G-numbers, licence numbers, site assignments, duty schedules and stock movements are examples, not live records. Actions change the preview until reload. Treat the mockup as an internal reference, not as authorisation to issue equipment.

## Open and preview

From the worktree root:

```sh
python -m http.server 8942 --bind 127.0.0.1
```

Open `http://127.0.0.1:8942/mockups/armory/index.html`. `index.html` holds the shell, both locale dictionaries, custody receipt and individual issue rules; `shift.js` handles the shift desk and Find; `stock.js` handles catalogue and stock intake; `returns.js` handles return and shift-check tasks. `data.js` derives balances and runs ledger assertions. `art.js`, `v2.css` and `fonts/` supply the artwork, layout and type. The shell and receipt use the GSSG wordmark.

| Preview | Query |
|---|---|
| Shift desk | `?tab=shift&safe=S2` (initial safe); `?safe=all` shows both safes |
| Item catalogue | `?tab=items&safe=all` |
| Add item | `?add=1`; `?add=firearm` opens Details with a kind selected |
| Receive stock | `?receive=1`; `?receive=rifle&safe=S2` preselects the item and safe |
| Rifle serial register and one serial’s history | `?item=rifle` or `?item=rifle&serial=SR-0110` |
| Serials not recorded | `?item=bodycam` (also `wand`) |
| Expiry batches | `?item=cartridge` (also `spray`) |
| Custody list and detail | `?tab=custody&custody=CU-0003` (also `CU-0001`, `CU-0002`, `CU-0004`) |
| Bilingual A4 custody receipt | `?receipt=CU-0003` (works in view-only mode) |
| Qualified guards | `?tab=guards` or `?tab=guards&filter=expiring` |
| Add or update a licence | `?licence=G4404` (add), `?licence=G4401` (update) |
| Audit: Decisions, Counts, Movements | `?tab=audit&pane=decisions`, `?tab=audit&pane=counts`, `?tab=audit&pane=movements` |
| North Gate shift check | `?check=S2`; `?check=S2&checkMissing=2` stages two unticked serials without saving |
| New blind monthly count | `?count=new` |
| Issue rifle, missing licence (on duty) | `?signout=1&kit=rifle&guard=G4406` |
| Issue pistol, off-duty reason and missing licence | `?signout=1&kit=pistol&guard=G4414` |
| Second firearm blocked | `?signout=1&kit=rifle&guard=G4403` |
| Issue equipment only | `?signout=1&kit=equipment` |
| Return with a staged shortfall (28 of 30) | `?signin=SO-0004` |
| Bulk return at North Gate | `?bulk=1&safe=S2` |
| Movement log filtered by serial and guard | `?tab=audit&pane=movements&serial=SR-0110&guard=G4403` |
| Second approver’s decision | `?decision=SI-0002-4&actor=reviewer` |
| Dashboard widget preview | `?widget=1` |
| Access and data states | `?view=edit`, `?view=readonly`, `?view=loading`, `?view=error`, `?view=empty` on any tab |
| Arabic and dark theme | `?lang=ar&theme=dark`, append either or both to other presets |

Use **Preview** to switch language, theme or state. In Audit, **Acting as** switches between the invented armorer and the second approver. `window.__armory.set({ item: 'rifle', lang: 'ar', theme: 'dark' })` applies the same preset keys without reload. The safe is remembered in the browser session. The older `today`, `equipment`, `counts` and `log` tab links still work. Reload to reset stock and sample records.

## Redesign v2

- **Shift, Items, Custody, Guards, Audit** stay visible on a phone. Shift groups the firearm rack, due returns and the handover check at the active safe. **Find** (or `/` on desktop) searches both safes for a partial serial, G-number, either name or a record ID.
- **Add item** creates a catalogue record; choose its kind, enter both names, select a category and drawing, and optionally link it to existing kits. These links do not change the approved issue quantities. Opening stock is set per safe; blank means not counted, not zero.
- **Receive stock** does not create an item by default. Record one delivery into one safe with one or more serial, quantity or batch lines. Serial entry accepts typed values, paste or a keyboard scanner; duplicates are blocked. Firearm and ammunition stock entries require a reference and a separate witness. A receipt records a new movement and does not overwrite an unknown opening balance. The catalogue's missing-item link keeps the delivery draft while you add the item.
- **Bulk return** records only confirmed lines. Check each serial, accessory set and ammunition count separately; an unchecked item or unfinished record stays out. The shift check remains a separate witnessed count, even if a serial was just returned. No camera-scanner permission or assumed counts.

## Decisions shown

- Shift and the home widget surface a missing firearm ahead of overdue issues. Overdue shows the time since the due date once the 30-minute grace expires. Issue rows retain the issuing armorer, kit changes and outstanding lines.
- Shift issues are paperless. Due back defaults to the end of this shift and is capped at the end of the next. Use custody for longer periods. The prototype does not record a guard signature for a shift issue.
- A weapons course gates rifle or pistol selection, and a guard with an open firearm on shift or in custody cannot receive another. The armorer cannot issue to their own account. An equipment-only issue does not require a weapons course. An expiring licence is advisory; a missing or expired licence requires acknowledgement and can be corrected inline. The current-duty list is preferred for shift issues, and anyone else needs an off-duty reason. Duty does not rank custody recipients.
- Kit quantities and available serials are limited to the issuing safe. Exceeding the kit’s usual rounds takes a reason. Right and left holsters keep separate balances. Recording serials against a known unrecorded balance does not increase stock. The shift rack shows one tile per rifle and pistol; a serial detail records repair, loss, write-off and transfer with a reason and witness. Audit → Movements preserves those records.
- Return and End custody share item-by-item return and an explicit rounds count. Unchecked items stay out or in custody. A serial sent to repair requires a fault note. An ammunition shortfall requires a reason, a reference of at least three characters and a witness. The armorer picks a witness, with on-duty employees at that site first. The involved guard and recording armorer cannot witness; a decision also excludes the discrepancy recorder.
- Long-term custody can be handed over to a person or site. Partial returns leave the record open; closing the last line preserves it in history. The bilingual A4 receipt leads with the UI language and includes the wordmark, custody ID, holder, licence number for firearm custody, equipment, condition, notes and dated signature fields. View-only users can print it but cannot change records.
- Shift checks count firearms, not ammunition. They reconcile in-safe, signed-out, in-custody and repair stock, and call out missing or lost serials separately. Saving unchecked firearms requires an explicit report. The missing serials become unavailable and show up in the discrepancy queue; the completed check shows the red result. The last seven days include a missed night check. The monthly count is blind: add only observed serials, enter zero where nothing is present, and see expected numbers only after saving. A dirty count or shift check prompts before closing.
- Discrepancies require a different authorised decision-maker and a decision witness. **Found** restores a missing serial to a safe or adds recovered rounds to stock. **Used in training** settles a shortfall as expended without counting it twice. **Lost** records the serial as lost. **Recording error** changes no stock. The outcome and two roles are visible in the decision history. Open custody is flagged for a former guard on clearance.
- The real app would gate the route with `armory.view` and all writes with `armory.edit`; only admins grant them, and neither belongs to the manager preset. This mockup does not create capabilities, edit employee files or persist transactions.

## Sample arithmetic

The fixed clock is 26 November 2026 at 14:20, Asia/Dubai. Across both safes there are **5 out now**, **2 overdue**, **2 back today** and **1 discrepancy awaiting a decision**. North Gate has the only missing current shift check. There are **0 missing firearms** in the baseline. One batch is expired (15 cartridges) and one is expiring soon (10 spray units). Of 14 active qualified guards, **4 licences expire in 20 days**, **9 are missing** and **1 is expired**. Five more qualified guards are former employees. Of the **4 custody records**, **3 are active**, including one radio held by a former guard.

| Rounds | Safe | Opening | In safe | Out on shift | In custody | Expended |
|---|---|---:|---:|---:|---:|---:|
| Sultan rifle | HQ | 540 | 510 | 30 | 0 | 0 |
| Sultan rifle | North Gate | 360 | 298 | 60 | 0 | 2 |
| Caracal pistol | HQ | 240 | 228 | 12 | 0 | 0 |
| Caracal pistol | North Gate | 160 | 136 | 12 | 12 | 0 |

In safe + out on shift + in custody + expended = opening + received, per ammunition type and safe. The rifle ledger starts at **510 + 298 + 90 + 0 + 2 = 900**. The book total of 898 excludes 2 physically unreturned rounds while they await a decision. The registers contain **12 rifles** and **12 pistols**. One pistol is written off, leaving **11 active** and **4 in the HQ safe**. The **35 TETRA radios** are split across **21 in the HQ safe**, **8 in the North Gate safe**, and **6 in custody**. Serial assignments reconcile to exactly one state per serial. The monthly history shows the resolved sling discrepancy (12 of 13 counted; later found in the vehicle). **Not counted** is not zero, and quantity can be known before serials are recorded.

## Questions before the real build

1. Which sites hold the two safes? The demo uses Al Watbha HQ and North Gate.
2. Are taser cartridges within scope and what are their actual expiry batches? The workbook does not list them.
3. How many riot gear suits are held, and are their serials available?
4. Are the sample shift times (06:00 to 18:00; 18:00 to 06:00) and 30-minute overdue grace correct?
5. For a month-only batch expiry, should the system use the last day of that month? This preview does.
6. Who reviews discrepancies and, when a decision changes stock, what authorisation and evidence does that correction need?
7. Should a witness confirm by PIN or sign in separately?
8. May a guard carry a rifle and a pistol together?
9. Should the guard confirm a shift sign-out (PIN or signature pad)?
10. Must the paper copy always lead with Arabic?
11. Should the clearance form use the sheet’s terms or keep its own (`مسدس كهربائي` / `مسدس صاعق`, `بخاخ مسيل للدموع` / `رذاذ الفلفل`, `جهاز تترا` / `جهاز اللاسلكي`)?
12. Is the sheet’s `مخزن` for a magazine clear enough next to the Assets **المخزن** (Store) tab?
13. Use the app date and time controls in production; confirm the input locale and 24-hour display.
14. Which scanners and label formats do sites use? This preview supports typed input, paste and keyboard-mode scanners only.
15. Who approves opening balances, and how should a new model or kit part be approved for issue?
