# Storekeeper phone think-aloud — four tasks

For the user/facilitator to run **on the laptop dev URL**, with the actual storekeeper and his own phone. This is a script, not a report of a completed user study. No participant observations have been fabricated. The local static mockup can be evaluated separately after the baseline tasks; it is not the deployed dev application.

## Setup (facilitator)

- Parent supplies the existing tailnet-only dev URL from the laptop; do not copy its `.env`, database or private URL into this document. Verify it is the dev channel, not production, and the account has store editing permissions.
- Use Arabic first if that is the operator's working language; repeat key recognition in English only if appropriate. Keep his normal font size/theme, phone orientation and one-handed grip. Do not resize his preferred text to make the design fit.
- Have a non-sensitive sample HQ delivery note, packages with visible expiry and an agreed disposable test record. Agree which dev rows may be recorded. If safe test data cannot be arranged, stop before the final Record action and record that limitation. Never record fake inventory changes in production.
- Explain: **“We are checking the screen, not testing you. Please say what you see, what you think it means, and what you expect when you tap. There are no wrong answers.”** Arabic: **«نحن نختبر الشاشة، وليس أنت. قل لنا ماذا ترى، وماذا تفهم منه، وماذا تتوقع أن يحدث عند الضغط. لا توجد إجابات خاطئة.»**
- Don't teach the tabs or point to the next control. If he asks for help, ask “What would you try?” / «ماذا ستجرب؟». If blocked for about a minute, offer the minimum help and mark the task **assisted**, not successful unassisted. Do not read out expected stock or suggest count values.
- With consent, record screen/audio without names or confidential note contents. Otherwise take timestamps/quotes. Record device, browser, viewport, language, theme and text size. Stop recording before account/private details appear.

## 1. Receive an HQ delivery (scan + confirm)

**Say:** “HQ has delivered these goods and this note. Record what you actually received and keep the note with the delivery. One line needs correcting. Show me how you would do it.”

**Arabic:** «وصلت هذه المواد من الإدارة ومعها هذا الإيصال. سجّل ما استلمته فعليًا واحتفظ بالإيصال مع التوريد. يوجد سطر يحتاج إلى تصحيح. أرني كيف تفعل ذلك.»

**Do not say:** “Open Deliveries, press Scan, then Confirm.” Let him find it.

**Observe:** Does he find the single photo/upload action? Recognize items by drawing/name? Understand cartons vs loose? Compare the note with actual received stock? Notice an unmatched/uncertain line and correct item/expiry/quantity rather than assume OCR is correct? Confirm every retained line? Know the note is attached? If OCR unavailable naturally, can he continue manually with the same note? Do not deliberately break laptop OCR mid-session.

**Success:** correct goods, expiry, received quantities and discrepancy reason reviewed; unmatched line resolved or deliberately skipped; no automatic acceptance; final state and attachment understood. If attachment fails, can he identify retry rather than create another delivery?

**Neutral probes:** “What do you think this line means?” / «ماذا يعني هذا السطر؟»; “What would be recorded now?” / «ماذا سيُسجّل الآن؟»

## 2. Count the store (blind, interrupted)

**Say:** “It is time for this month's stock count. Count these items as they are on the shelf, including the different expiry dates. If a batch is empty, record that you checked it. Leave one batch for later.”

**Arabic:** «حان وقت جرد هذا الشهر. عدّ هذه المواد كما هي على الرف، مع تواريخ الصلاحية المختلفة. إذا كانت دفعة فارغة فسجّل أنك فحصتها. اترك دفعة واحدة لتعود إليها لاحقًا.»

After a few entries: **“You need to answer a call. Leave this screen, then come back and continue.”** / «تحتاج إلى الرد على مكالمة. اترك هذه الشاشة، ثم عد وأكمل.» First switch apps/back (non-destructive), then, only with consent and scratch/dev entries, reload to distinguish in-memory state from durable recovery. Today's behavior may lose work; capture what happened, do not pretend draft recovery already exists.

**Observe:** Can he explain what he must enter before help? See drawing, pack and batch expiry together? Distinguish full cartons from loose jars/boxes/sleeves, and whole cartons where contents unknown? Understand an undated batch? Distinguish blank from an explicitly checked zero? Understand progress denominator? Find the skipped batch before submitting? Recover after interruption without repeating counts? Avoid any expected/system quantities while in counting mode?

**Success:** all required batches explicitly counted (including checked zero); missing entry found and corrected before durable record; date/month and review understood. On current dev, record loss/error discovery as a finding, not participant failure. Do not submit a second count in an already-counted month or backdate just to bypass uniqueness; use agreed dev fixture/month or stop before Record.

**Neutral probes:** “What are you being asked to count here?” / «ماذا يُطلب منك أن تعدّ هنا؟»; “How do you know what is left to do?” / «كيف تعرف ما الذي بقي؟»

## 3. Add a store item

**Say:** “A new consumable has arrived that is not in the store list. Add it so you can recognize it next month. Use this package to describe its name, contents and picture.”

**Arabic:** «وصلت مادة جديدة غير موجودة في قائمة المخزن. أضفها بحيث تتعرّف عليها الشهر القادم. استخدم العبوة لتحديد الاسم والمحتويات والرسم.»

**Observe:** Does he distinguish item identity from a delivery/batch? Choose the right category, drawing kind and colour? Separate brand/name from pack size? Understand that “contains” converts cartons to loose units, and leave unknown contents unknown rather than guess? Can he recognize the saved item at phone tile size without a cut-off name? For baseline dev, bilingual printed-label fields are not yet built: ask what words he expects on the drawing, then show the proposed mockup separately. Do not claim those controls exist today. Custom picture upload is an open question, not an offered task requirement.

**Success:** recognizable, accurate item in agreed dev fixture or a reviewed unsaved form; operator can explain counting unit and carton contents. Record whether adding a brand label needs help.

**Neutral probes:** “Which drawing would you look for on the shelf?” / «أي رسم ستبحث عنه على الرف؟»; “What does this number describe?” / «ماذا يصف هذا العدد؟»

## 4. Record a disposal

**Say:** “This package cannot be used because it is expired (or damaged). Record only what is being thrown away, from this batch, with the reason.”

**Arabic:** «هذه العبوة غير صالحة للاستخدام لانتهاء صلاحيتها (أو لتلفها). سجّل فقط الكمية التي ستُتلف من هذه الدفعة، مع السبب.»

**Observe:** Can he choose item by drawing, then the matching expiry batch? Is the unit unmistakable? Does he distinguish disposal from handover/count correction? Select the actual reason and review quantity/date before recording? Recognize completion and know what changed? Only save agreed disposable dev stock; otherwise stop before Record.

**Success:** correct item, expiry, unit, quantity and reason; no accidental count/handover entry; operator explains the resulting record. No real stock is physically discarded for this study.

**Neutral probe:** “Which package will this record refer to?” / «إلى أي عبوة سيشير هذا السجل؟»

## Debrief and evidence sheet

Ask: “Which step made you stop and think? Which drawing looked wrong? If you returned next month, where would you start?” / «أي خطوة جعلتك تتوقف وتفكر؟ أي رسم لم يطابق العبوة؟ إذا عدت الشهر القادم، من أين ستبدأ؟»

| Task | Unassisted / assisted / stopped | First action and time | Exact confusing words/taps | Quantity/expiry mistakes | Participant quote | Saved or stopped before record |
|---|---|---|---|---|---|---|
| Delivery | Not run | | | | | |
| Count + interruption | Not run | | | | | |
| New item | Not run | | | | | |
| Disposal | Not run | | | | | |

Keep observed behavior separate from recommendations. Note expected/actual recovery after app switch, navigation and reload separately. Send anonymized findings and mockup annotations to the parent; only the parent/user can approve Phase 2. A browser simulation or developer smoke is not a substitute for this phone session.
