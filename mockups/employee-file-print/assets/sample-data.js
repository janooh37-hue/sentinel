/*
 * Shared sample data for the employee-file print mockups (activity + attendance).
 * Fictional person; shapes follow ActivityItemRead and EmployeeAttendanceDay.
 * Fields marked "enrich" do not exist on ActivityItemRead today: the redesign
 * would add them server-side (see mockups/plan/employee-file-print-brief.md).
 * Usage: <script src="assets/sample-data.js"></script> then window.SAMPLE.
 */
(function () {
  const employee = {
    id: 'G3190',
    name_en: 'Ahmed Saeed Al Mansoori',
    name_ar: 'أحمد سعيد المنصوري',
    job_en: 'Security Supervisor',
    job_ar: 'مشرف أمن',
    department_en: 'Operations',
    department_ar: 'العمليات',
    unit_en: 'Al Wathba Site',
    unit_ar: 'موقع الوثبة',
    post_en: 'Main Gate',
    post_ar: 'البوابة الرئيسية',
    nationality_en: 'UAE',
    nationality_ar: 'الإمارات',
    joined: '2019-03-14',
    status_en: 'Active',
    status_ar: 'على رأس العمل',
  };

  // Newest first, like recent_activity. `when` is ISO; date-only events use 00:00.
  const activity = [
    { when: '2026-10-27T10:42:00', kind: 'document', ref_id: 9811, summary: 'Generated salary_certificate',
      title_en: 'Salary certificate issued', title_ar: 'إصدار شهادة راتب', detail_en: 'Addressed to Emirates NBD', detail_ar: 'موجهة إلى بنك الإمارات دبي الوطني', actor: 'Mariam Al Kaabi', ref: 'HR/2026/4471' },
    { when: '2026-10-21T00:00:00', kind: 'violation', ref_id: 312, summary: 'Late arrival to post',
      title_en: 'Violation: late arrival to post', title_ar: 'مخالفة: التأخر عن الموقع', detail_en: 'Written warning · 2nd in 12 months', detail_ar: 'إنذار كتابي · الثانية خلال ١٢ شهرًا', actor: 'Khalid Al Hammadi', ref: 'V-0312' },
    { when: '2026-10-19T08:15:00', kind: 'ledger', ref_id: 5520, summary: 'Request for transfer to night rotation',
      title_en: 'Correspondence: request for transfer to night rotation', title_ar: 'مراسلة: طلب نقل إلى المناوبة الليلية', detail_en: 'Incoming · from the employee', detail_ar: 'وارد · من الموظف', actor: 'Records desk', ref: 'IN-2026-1187' },
    { when: '2026-10-12T00:00:00', kind: 'absence', ref_id: 77, summary: 'Absence',
      title_en: 'Absence recorded', title_ar: 'تسجيل غياب', detail_en: 'Unexcused · 1 day', detail_ar: 'بدون عذر · يوم واحد', actor: 'Attendance desk', ref: 'A-0077' },
    { when: '2026-09-30T13:05:00', kind: 'status', ref_id: 41, summary: 'active',
      from_status: 'on_leave', to_status: 'active', effective_date: '2026-09-30', status_event_kind: 'return',
      title_en: 'Returned from leave', title_ar: 'العودة من الإجازة', detail_en: 'Duty resumption confirmed', detail_ar: 'تأكيد مباشرة العمل', actor: 'Mariam Al Kaabi', ref: '' },
    { when: '2026-09-29T09:20:00', kind: 'document', ref_id: 9702, summary: 'Generated duty_resumption',
      title_en: 'Duty resumption form issued', title_ar: 'إصدار نموذج مباشرة عمل', detail_en: 'Signed by unit supervisor', detail_ar: 'موقع من مشرف الوحدة', actor: 'Mariam Al Kaabi', ref: 'HR/2026/4302' },
    { when: '2026-09-01T00:00:00', kind: 'leave', ref_id: 1440, summary: 'Annual Leave (28d)',
      leave_type_en: 'Annual leave', leave_type_ar: 'إجازة سنوية', start: '2026-09-01', end: '2026-09-28', days: 28, leave_status_en: 'Approved', leave_status_ar: 'معتمدة',
      title_en: 'Annual leave · 28 days', title_ar: 'إجازة سنوية · ٢٨ يومًا', detail_en: '1 Sep to 28 Sep 2026', detail_ar: '١ سبتمبر إلى ٢٨ سبتمبر ٢٠٢٦', actor: 'Fatima Al Dhaheri', ref: 'L-1440' },
    { when: '2026-08-31T14:00:00', kind: 'status', ref_id: 40, summary: 'on_leave',
      from_status: 'active', to_status: 'on_leave', effective_date: '2026-09-01', return_date: '2026-09-29', status_event_kind: 'departure',
      title_en: 'Departed on leave', title_ar: 'المغادرة في إجازة', detail_en: 'Expected back 29 Sep 2026', detail_ar: 'العودة المتوقعة ٢٩ سبتمبر ٢٠٢٦', actor: 'System', ref: '' },
    { when: '2026-08-24T11:30:00', kind: 'document', ref_id: 9590, summary: 'Generated leave_application',
      title_en: 'Leave application filed', title_ar: 'تقديم طلب إجازة', detail_en: 'Annual leave, 28 days', detail_ar: 'إجازة سنوية، ٢٨ يومًا', actor: 'Fatima Al Dhaheri', ref: 'HR/2026/4013' },
    { when: '2026-07-15T07:00:00', kind: 'duty_location', ref_id: 210, summary: 'transfer', event_type: 'transfer',
      from_department: 'Operations', from_unit: 'Mussafah Site', from_post: 'Patrol', to_department: 'Operations', to_unit: 'Al Wathba Site', to_post: 'Main Gate', reason: 'Rotation plan Q3',
      title_en: 'Transferred to Al Wathba Site · Main Gate', title_ar: 'نقل إلى موقع الوثبة · البوابة الرئيسية', detail_en: 'From Mussafah Site · Patrol. Reason: rotation plan Q3', detail_ar: 'من موقع مصفح · الدوريات. السبب: خطة التدوير للربع الثالث', actor: 'Khalid Al Hammadi', ref: 'T-0210' },
    { when: '2026-07-14T10:10:00', kind: 'ledger', ref_id: 5133, summary: 'Transfer memo, Al Wathba Site',
      title_en: 'Correspondence: transfer memo, Al Wathba Site', title_ar: 'مراسلة: مذكرة نقل، موقع الوثبة', detail_en: 'Outgoing · to Site Manager', detail_ar: 'صادر · إلى مدير الموقع', actor: 'Records desk', ref: 'OUT-2026-0904' },
    { when: '2026-06-03T00:00:00', kind: 'violation', ref_id: 288, summary: 'Uniform not to standard',
      title_en: 'Violation: uniform not to standard', title_ar: 'مخالفة: الزي غير مطابق', detail_en: 'Verbal notice', detail_ar: 'تنبيه شفهي', actor: 'Khalid Al Hammadi', ref: 'V-0288' },
    { when: '2026-05-18T00:00:00', kind: 'leave', ref_id: 1301, summary: 'Sick Leave (2d)',
      leave_type_en: 'Sick leave', leave_type_ar: 'إجازة مرضية', start: '2026-05-18', end: '2026-05-19', days: 2, leave_status_en: 'Approved', leave_status_ar: 'معتمدة',
      title_en: 'Sick leave · 2 days', title_ar: 'إجازة مرضية · يومان', detail_en: '18 May to 19 May 2026 · medical report attached', detail_ar: '١٨ مايو إلى ١٩ مايو ٢٠٢٦ · التقرير الطبي مرفق', actor: 'Fatima Al Dhaheri', ref: 'L-1301' },
    { when: '2026-04-02T12:45:00', kind: 'document', ref_id: 9100, summary: 'Generated experience_certificate',
      title_en: 'Experience certificate issued', title_ar: 'إصدار شهادة خبرة', detail_en: 'To whom it may concern', detail_ar: 'لمن يهمه الأمر', actor: 'Mariam Al Kaabi', ref: 'HR/2026/3155' },
    { when: '2026-02-10T09:00:00', kind: 'ledger', ref_id: 4410, summary: 'Training nomination, first aid',
      title_en: 'Correspondence: training nomination, first aid', title_ar: 'مراسلة: ترشيح لدورة الإسعافات الأولية', detail_en: 'Outgoing · to Training Centre', detail_ar: 'صادر · إلى مركز التدريب', actor: 'Records desk', ref: 'OUT-2026-0188' },
    { when: '2026-01-05T00:00:00', kind: 'leave', ref_id: 1180, summary: 'Emergency Leave (3d)',
      leave_type_en: 'Emergency leave', leave_type_ar: 'إجازة طارئة', start: '2026-01-05', end: '2026-01-07', days: 3, leave_status_en: 'Approved', leave_status_ar: 'معتمدة',
      title_en: 'Emergency leave · 3 days', title_ar: 'إجازة طارئة · ٣ أيام', detail_en: '5 Jan to 7 Jan 2026', detail_ar: '٥ يناير إلى ٧ يناير ٢٠٢٦', actor: 'Fatima Al Dhaheri', ref: 'L-1180' },
  ];

  const kinds = {
    document: { en: 'Document', ar: 'مستند' },
    leave: { en: 'Leave', ar: 'إجازة' },
    violation: { en: 'Violation', ar: 'مخالفة' },
    ledger: { en: 'Correspondence', ar: 'مراسلات' },
    absence: { en: 'Absence', ar: 'غياب' },
    duty_location: { en: 'Placement', ar: 'موقع العمل' },
    status: { en: 'Status', ar: 'الحالة' },
  };

  // Shift windows are illustrative. Devices do not record punch direction:
  // the app shows first and last punch, never "in" and "out".
  const shifts = {
    morning: { en: 'Morning', ar: 'الصباحية', letter: 'M', start: '05:00', end: '13:00' },
    noon: { en: 'Noon', ar: 'الظهيرة', letter: 'N', start: '13:00', end: '21:00' },
    night: { en: 'Night', ar: 'الليلية', letter: 'L', start: '21:00', end: '05:00' },
    office_day: { en: 'Office', ar: 'الدوام الرسمي', letter: 'O', start: '07:30', end: '15:30' },
  };
  const states = {
    verified: { en: 'On time', ar: 'في الوقت' },
    grace: { en: 'Inside grace', ar: 'داخل مدة السماح' },
    late: { en: 'Late past grace', ar: 'تأخر بعد السماح' },
    unpaired: { en: 'Single punch', ar: 'بصمة واحدة' },
    absent: { en: 'Absent', ar: 'غائب' },
    leave: { en: 'On leave', ar: 'في إجازة' },
    off: { en: 'Rest day', ar: 'راحة' },
  };

  // October 2026, a 2-on / 2-off style rotation. [day, shift|null, state, first, last, punches, lateMin]
  const raw = [
    [1, 'morning', 'verified', '04:48', '13:06', 2, 0],
    [2, 'morning', 'verified', '04:51', '13:02', 2, 0],
    [3, null, 'off'], [4, null, 'off'],
    [5, 'noon', 'grace', '13:22', '21:04', 2, 0],
    [6, 'noon', 'verified', '12:55', '21:10', 3, 0],
    [7, null, 'off'], [8, null, 'off'],
    [9, 'night', 'verified', '20:41', '05:03', 2, 0],
    [10, 'night', 'late', '21:47', '05:01', 2, 17],
    [11, null, 'off'],
    [12, 'morning', 'absent', null, null, 0, 0],
    [13, 'morning', 'verified', '04:50', '13:00', 2, 0],
    [14, 'morning', 'unpaired', '04:57', null, 1, 0],
    [15, null, 'off'], [16, null, 'off'],
    [17, 'noon', 'verified', '12:49', '21:02', 2, 0],
    [18, 'noon', 'verified', '12:58', '21:00', 2, 0],
    [19, 'office_day', 'grace', '07:51', '15:34', 2, 0],
    [20, null, 'off'],
    [21, 'night', 'late', '22:05', '05:00', 2, 35],
    [22, 'night', 'verified', '20:52', '05:06', 2, 0],
    [23, null, 'off'], [24, null, 'off'],
    [25, 'morning', 'verified', '04:46', '13:01', 2, 0],
    [26, 'morning', 'verified', '04:55', '13:12', 4, 0],
    [27, null, 'off'], [28, null, 'off'],
    [29, 'noon', 'verified', '12:51', '21:03', 2, 0],
    [30, 'noon', 'grace', '13:18', '21:01', 2, 0],
    [31, null, 'off'],
  ];
  const attendance = raw.map(([d, shift, state, first, last, punches, late]) => ({
    date: `2026-10-${String(d).padStart(2, '0')}`,
    shift_code: shift,
    state,
    first_punch: first ?? null,
    last_punch: last ?? null,
    punch_count: punches ?? 0,
    minutes_past_grace: late ?? 0,
    grace_minutes: 30,
    device: shift ? 'Wathba Gate T1' : null,
  }));

  const judged = attendance.filter((r) => r.shift_code && r.state !== 'leave');
  const summary = {
    scheduled: judged.length,
    on_time: judged.filter((r) => r.state === 'verified' || r.state === 'grace').length,
    late: judged.filter((r) => r.state === 'late').length,
    late_minutes: judged.reduce((n, r) => n + r.minutes_past_grace, 0),
    absent: judged.filter((r) => r.state === 'absent').length,
    single_punch: judged.filter((r) => r.state === 'unpaired').length,
    rest_days: attendance.filter((r) => !r.shift_code).length,
  };

  // Whole-year band: shifts worked per month (Sep mostly leave).
  const months = [
    ['2026-01', 19, 3], ['2026-02', 20, 0], ['2026-03', 21, 0], ['2026-04', 20, 0], ['2026-05', 18, 2],
    ['2026-06', 21, 0], ['2026-07', 21, 0], ['2026-08', 20, 0], ['2026-09', 2, 28], ['2026-10', 17, 0],
  ].map(([month, worked, leave]) => ({ month, worked, leave_days: leave }));

  const printedBy = { name_en: 'Mariam Al Kaabi', name_ar: 'مريم الكعبي', role_en: 'HR Officer', role_ar: 'موظف موارد بشرية' };

  window.SAMPLE = { employee, activity, kinds, shifts, states, attendance, summary, months, printedBy,
    office_ar: 'إدارة الموارد البشرية', office_en: 'Human Resources Department',
    company_ar: 'المجموعة العالمية للخدمات الأمنية', company_en: 'Global Security Services Group',
    contacts: { location: 'Abu Dhabi, United Arab Emirates', email: 'info@gss-group.net', web: 'www.gss-group.net', phone: '+9712 6666898', fax: '+971 2 666 8980' } };
})();
