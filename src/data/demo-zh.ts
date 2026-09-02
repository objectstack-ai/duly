// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The zh-CN half of the demo fixture: every human-readable string in
 * `demo-org.ts`, `demo-catalog.ts`, `demo-history.ts`, `demo-assignments.ts`
 * and `log-entry.seed.ts`, keyed by the English original.
 *
 * ── Why a dictionary keyed on the English string, and not a second fixture ─
 * The obvious alternative — a parallel `demo-org.zh.ts`, `demo-catalog.zh.ts`
 * and so on — duplicates the STRUCTURE as well as the prose: two arrays of
 * catalog items, two sets of cadences, two review-state distributions, two
 * copies of every comment explaining why a row is shaped the way it is. They
 * would drift, and the drift would be invisible: a Chinese demo with 19
 * catalog items and an English one with 20 is not a translation bug anybody
 * spots on a screen.
 *
 * Keying on the English string keeps ONE fixture with one shape, one history
 * planner and one set of invariants, and reduces "is it translated?" to a set
 * comparison a test can make. `test/seed-locale.test.ts` asserts both
 * directions of it:
 *
 *   - every string the fixture asks {@link t} for has an entry here (no line
 *     was forgotten), and
 *   - every entry here is asked for by the fixture (no entry is dead) — which
 *     is also what pins the English fixture byte-for-byte, because rewording
 *     an English line orphans its entry and goes red.
 *
 * ── Everything here is INVENTED — the hard rule, in Chinese too ───────────
 * 安岭集团 is not a company. 北门厂区 and 河畔厂区 are not sites. The twelve
 * people do not exist, their mailboxes are on RFC 2606's reserved `.example`
 * TLD, and every 《…》 reference is an internal policy number belonging to a
 * company that does not exist — not a Chinese national, industry or local
 * standard. A demo seed is screenshotted and pasted into decks; a real GB/T
 * number in one is a claim about a real regulation, and a real company name
 * is a claim about a real customer.
 *
 * ── Machine values are NOT here, deliberately ─────────────────────────────
 * Unit codes (`ARD`, `NGP-QA`), `period_key`s, select values (`in_hand`,
 * `awaiting_feedback`), timezones and frequencies are data the platform
 * matches on, not prose a reader sees. They are identical in both locales;
 * the zh-CN translations bundle is what renders the select values in Chinese,
 * and that is a different mechanism from this file.
 */

/**
 * The twelve people, and the mailbox each one keeps.
 *
 * `mailbox` is the local part of the address, in pinyin — `chen.zhiyuan`, not
 * `陈志远`. Two reasons, and the second is the load-bearing one:
 *
 *  - It is what a Chinese company's directory actually looks like.
 *  - `sys_user.email` is matched and displayed as an identifier. Keeping it
 *    ASCII means the seeded address survives every place an address is typed,
 *    pasted, or used as a natural key, in a demo whose whole point is that it
 *    is being shown to somebody.
 *
 * The `sys_user.name` — the natural key every `owner` reference resolves
 * against — IS Chinese. That is the string on screen.
 */
export const ZH_PEOPLE: Readonly<Record<string, { readonly name: string; readonly mailbox: string }>> = {
  'Nadia Ilves': { name: '陈志远', mailbox: 'chen.zhiyuan' },
  'Tomas Bergh': { name: '林建国', mailbox: 'lin.jianguo' },
  'Elin Halvorsen': { name: '赵秀兰', mailbox: 'zhao.xiulan' },
  'Owen Pryce': { name: '周文博', mailbox: 'zhou.wenbo' },
  'Marek Dvorak': { name: '王海涛', mailbox: 'wang.haitao' },
  'Priya Raman': { name: '李慧敏', mailbox: 'li.huimin' },
  'Sami Okonkwo': { name: '孙立新', mailbox: 'sun.lixin' },
  'Yuki Tanabe': { name: '吴佳颖', mailbox: 'wu.jiaying' },
  'Rosa Delgado': { name: '何雨桐', mailbox: 'he.yutong' },
  'Ibrahim Chaudhry': { name: '徐鹏程', mailbox: 'xu.pengcheng' },
  'Ana Ferreira': { name: '郑晓芸', mailbox: 'zheng.xiaoyun' },
  'Greta Lindqvist': { name: '冯乐言', mailbox: 'feng.leyan' },
};

/** The people's display names, folded into the dictionary below. */
const PEOPLE_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(ZH_PEOPLE).map(([english, person]) => [english, person.name]),
);

/**
 * Everything else.
 *
 * Grouped in the order a reader meets it: the org, the positions, the
 * catalog, the duties instantiated from it, what happened to the tasks, the
 * two assignments, and the personal work log.
 *
 * Duty names follow the fixture's own naming rule — the obligation, then the
 * SCOPE its owner actually covers — with the English `Name — Scope` spelled
 * `名称—范围` here. The scope is what keeps duty names unique, and unique is
 * not decoration: `duly_task.duty` is resolved as a natural key against
 * `duly_duty.name`, so two duties sharing a name would silently hang one
 * person's tasks off another person's duty.
 */
export const ZH_CN: Readonly<Record<string, string>> = {
  ...PEOPLE_NAMES,

  // ── Business units ──────────────────────────────────────────────────────
  'Ardenline Group': '安岭集团',
  'Northgate Plant': '北门厂区',
  'Riverside Plant': '河畔厂区',
  'Central Office': '集团总部',
  'Northgate Operations': '北门生产部',
  'Northgate Quality': '北门质量部',

  // ── Position codes (#117 item 3) ────────────────────────────────────────
  // `duly_catalog_item.position_code` is free text, and the demo used to show
  // `plant_compliance_officer` in the 岗位 column — a machine spelling on a
  // screen a human reads.
  'Plant compliance officer': '厂区合规专员',
  'Shift supervisor': '班组长',
  'Quality technician': '质量技术员',

  // ── Catalog items: name, then description, then the clause it discharges ─
  'Emissions return': '排放申报',
  'Submit the site emissions figures for the month, with the meter readings they were derived from.':
    '提交本月厂区排放数据，并附上据以计算的仪表读数。',
  'Group Environment Standard GE-02 §5': '《集团环境标准 GE-02》第5条',

  'Waste transfer log review': '废物转移台账复核',
  'Check every transfer note raised last month against the carrier register; flag anything unmatched.':
    '将上月开具的每一张转移联单与承运登记册逐笔核对，标出对不上的条目。',
  'Group Environment Standard GE-04 §2': '《集团环境标准 GE-04》第2条',

  'Effluent sampling record': '废水取样记录',
  'Draw and log the weekly outfall sample. Record the result even when it is within limits.':
    '每周在排放口取样并登记。即使结果在限值以内也要记录。',
  'Site Discharge Consent DC-11 cl.4': '《厂区排放许可 DC-11》第4款',

  'Permit condition review': '许可条件复核',
  'Walk the permit conditions one by one and record, for each, the evidence that it was met this quarter.':
    '逐条走查许可条件，并为每一条记录本季度已满足的证据。',
  'Group Environment Standard GE-09 §1': '《集团环境标准 GE-09》第1条',

  'Site environmental audit': '厂区环境审核',
  'Full walk-round audit against the group environmental standard, with findings and owners.':
    '对照集团环境标准做一次完整的巡查审核，列出发现项及其责任人。',
  'Group Assurance Plan AP-3 §6': '《集团保证计划 AP-3》第6条',

  'Annual environmental statement': '年度环境报告',
  "Compile the year's environmental performance into the statement the group publishes.":
    '汇总全年环境绩效，形成集团对外发布的年度环境报告。',
  'Group Environment Standard GE-01 §8': '《集团环境标准 GE-01》第8条',

  'Keep the permit register current': '保持许可台账实时更新',
  'The register reflects the permits actually in force — no expiry passes without the entry being updated. Never "done"; attested, not ticked.':
    '台账要反映当前真正生效的许可——不允许任何一份到期而条目未更新。它永远不会“完成”：只做确认，不打勾。',
  'Group Environment Standard GE-09 §4': '《集团环境标准 GE-09》第4条',

  'Shift handover record': '交接班记录',
  'Written handover for every shift change in the week: state of the line, anything left open.':
    '本周每一次交接班都要留下书面记录：产线状态，以及尚未了结的事项。',
  'Works Instruction WI-120 §3': '《作业指导书 WI-120》第3条',

  'Line safety walk': '产线安全巡查',
  'Walk the line against the safety checklist with an operator present. Log what you fixed on the spot.':
    '由操作工陪同，对照安全检查表走查产线。当场整改的内容要记录下来。',
  'Site Safety Standard SS-07 §2': '《厂区安全标准 SS-07》第2条',

  'Toolbox talk record': '班前安全讲话记录',
  'Run one toolbox talk with the shift and record who attended.':
    '与本班组开展一次班前安全讲话，并记录参加人员。',
  'Site Safety Standard SS-07 §5': '《厂区安全标准 SS-07》第5条',

  'Lifting equipment check': '起重器具检查',
  'Visual check and tag review of every sling, hoist and eyebolt on the line.':
    '对产线上每一条吊带、每台葫芦、每个吊环做外观检查并复核标签。',
  'Works Instruction WI-204 §1': '《作业指导书 WI-204》第1条',

  'Contractor induction refresh': '承包商入场培训复训',
  'Re-run the site induction for every contractor still holding a pass, and retire the passes nobody claimed.':
    '为仍持有通行证的每一位承包商重做一次入场培训，并注销无人认领的通行证。',
  'Site Safety Standard SS-15 §3': '《厂区安全标准 SS-15》第3条',

  'Answer the duty phone': '值班电话应答',
  'The out-of-hours phone is carried and answered. There is no version of this that is ever finished.':
    '非工作时间的值班电话随身携带并接听。这件事没有任何一种“做完”的说法。',
  'Works Instruction WI-002 §1': '《作业指导书 WI-002》第1条',

  'Overtime justification summary': '加班事由汇总',
  'One line per overtime shift worked: why it was needed and what it covered.':
    '每一个加班班次写一行：为什么需要，做了哪些事。',
  'People Policy PP-22 cl.6': '《人事政策 PP-22》第6款',

  'Calibration verification': '计量校准核查',
  'Verify each instrument against its reference standard and record the deviation, in range or not.':
    '用标准器逐台核查仪器，并记录偏差——无论是否在允差以内。',
  'Quality Manual QM-31 §4': '《质量手册 QM-31》第4条',

  'Retained sample review': '留样复查',
  'Inspect the retained samples due for review and dispose of anything past its retention window.':
    '检查到期需要复查的留样，并处置超过留存期的样品。',
  'Quality Manual QM-18 §2': '《质量手册 QM-18》第2条',

  'Nonconformance log review': '不合格记录复核',
  'Review every nonconformance raised last month and confirm each one has an owner and a closing date.':
    '复核上月开具的每一条不合格记录，确认每条都有责任人和关闭日期。',
  'Quality Manual QM-05 §3': '《质量手册 QM-05》第3条',

  'Cleaning verification swabs': '清洁验证涂抹检测',
  'Swab the changeover points after the weekly clean and log the plate counts.':
    '每周清洁后在换型点位做涂抹取样，并登记菌落计数。',
  'Quality Manual QM-22 §7': '《质量手册 QM-22》第7条',

  'Instrument drift check': '仪器漂移检查',
  "Compare this month's calibration deviations against the last three and note any instrument trending out.":
    '将本月的校准偏差与前三个月对比，记下任何出现走偏趋势的仪器。',

  'Commissioning file handover': '试车资料移交',
  'Hand the commissioning file to operations: as-built drawings, test records, spares list, signed off.':
    '向生产部门移交试车资料：竣工图、试验记录、备件清单，并完成签署。',
  'Project Standard PS-06 §5': '《项目标准 PS-06》第5条',

  // ── Duties — the catalog instantiated onto people ───────────────────────
  'Emissions return — Northgate': '排放申报—北门厂区',
  'Waste transfer log review — Northgate': '废物转移台账复核—北门厂区',
  'Permit condition review — Northgate': '许可条件复核—北门厂区',
  'Site environmental audit — Northgate': '厂区环境审核—北门厂区',
  'Keep the permit register current — Northgate': '保持许可台账实时更新—北门厂区',
  'Annual environmental statement — Ardenline': '年度环境报告—安岭集团',
  'Answer the duty phone — Northgate Quality': '值班电话应答—北门质量部',
  'Calibration verification — Lab 1': '计量校准核查—1号实验室',
  'Retained sample review — Lab 1': '留样复查—1号实验室',
  'Nonconformance log review — Northgate Quality': '不合格记录复核—北门质量部',
  'Calibration verification — Lab 2': '计量校准核查—2号实验室',
  'Instrument drift check — Lab 2': '仪器漂移检查—2号实验室',
  'Shift handover record — Line A': '交接班记录—A线',
  'Line safety walk — Line A': '产线安全巡查—A线',
  'Line safety walk — Line B': '产线安全巡查—B线',
  'Toolbox talk record — Line B': '班前安全讲话记录—B线',
  'Contractor induction refresh — Northgate': '承包商入场培训复训—北门厂区',
  'Lifting equipment check — Line C': '起重器具检查—C线',
  'Overtime justification summary — Northgate Operations': '加班事由汇总—北门生产部',
  'Emissions return — Riverside': '排放申报—河畔厂区',
  'Permit condition review — Riverside': '许可条件复核—河畔厂区',
  'Waste transfer log review — Riverside': '废物转移台账复核—河畔厂区',
  'Line safety walk — Riverside': '产线安全巡查—河畔厂区',
  'Toolbox talk record — Riverside': '班前安全讲话记录—河畔厂区',
  'Nonconformance log review — Riverside': '不合格记录复核—河畔厂区',
  'Keep the permit register current — Ardenline': '保持许可台账实时更新—安岭集团',
  'Commissioning file handover — Riverside upgrade': '试车资料移交—河畔厂区改造',

  // ── Self-declared duties, and the cadence descriptions they carry ───────
  'Keep up with regulator bulletins': '跟进监管通报',
  "Read the month's bulletins and note anything that changes what the site owes.":
    '读完本月的通报，记下其中改变厂区义务的内容。',
  'Monthly quality trend read': '每月质量趋势研读',
  "Half an hour with the month's nonconformances and calibration deviations, looking for the shape rather than the individual events.":
    '花半小时看本月的不合格与校准偏差，找的是整体走势，而不是单个事件。',
  'Track my own training hours': '记录本人培训学时',
  'Log the hours and what they were spent on, so the year-end return is not reconstructed from memory.':
    '记下学时和用途，免得年终填报时全靠回忆拼凑。',
  'Monthly site performance note': '每月厂区运行手记',
  'A page on how the site actually ran this month — written for myself, not for a report.':
    '用一页纸写下本月厂区的实际运行情况——写给自己看，不是写报告。',

  // ── The returned duty's reason (`duly_duty.review_note`) ────────────────
  'Reading the bulletins is not the duty — the duty is recording what changed and who has to act. Rewrite the acceptance bar and send it back.':
    '读通报本身不是这项职责——职责是记录改了什么、由谁去落实。请重写验收标准后再提交。',

  // ── What happened to the tasks: notes, and the one skip reason ──────────
  'Meter 3 was swapped mid-period — figures split across the two serials, both attached.':
    '3号仪表在期中更换过——数据按两个表号分开统计，两份都已附上。',
  'Waiting on the reference standard to come back from the calibration house.':
    '等标准器从校准机构返回。',
  'Booked for the week of the shutdown so the lines are cold.':
    '已约在停机检修那一周，届时产线处于冷态。',
  'Two of the night shift still to attend; running a repeat session.':
    '夜班还有两人没参加，另安排一次补讲。',
  'Pass list pulled from the gatehouse; fourteen to chase.':
    '通行证名单已从门卫处调取，还有十四人要催。',
  'Line A was down for the rebuild for the whole period — there was no line to walk.':
    '整个周期 A 线都在大修停机——没有产线可巡。',

  // ── The two assignments, and the notes their tasks carry ────────────────
  'Winter shutdown readiness check': '冬季停机检修准备检查',
  'Before the shutdown window opens, confirm your area is ready: isolations listed, spares on site, contractors booked. One line per point — no report.':
    '停机窗口开始前，确认你负责的区域已准备就绪：隔离点已列出、备件已到场、承包商已预约。每项写一行即可，不必写报告。',
  'Q3 supplier certificate sweep': '三季度供应商证书清查',
  'Pull the current certificate for every approved supplier you buy from and flag any that expired during the quarter.':
    '调取你所采购的每一家合格供应商的现行证书，标出本季度内已到期的。',
  'Isolations listed and countersigned. Spares are on site bar the two long-lead seals.':
    '隔离点已列出并会签。备件除两件长周期密封件外均已到场。',
  'Contractor slot still to be confirmed for the Line C isolation.':
    'C 线隔离的承包商时间段还没定下来。',
  'As-builts and test records in; waiting on the spares list from the supplier.':
    '竣工图和试验记录已到，等供应商的备件清单。',

  // ── The personal work log ───────────────────────────────────────────────
  'Walked the new starter through the permit register': '带新同事过了一遍许可台账',
  'Rewrote the sampling instruction after the lab query': '因实验室提问重写了取样作业指导',
  'The old wording let two people read the hold time differently. Now it names the clock.':
    '旧写法让两个人对保留时间有两种理解。现在写明了以哪个时间为准。',
  'Chased the carrier for three missing transfer notes': '向承运方催了三张缺失的转移联单',
  'Standing call with the regulator liaison': '与监管联络人的例行通话',
  'Out-of-hours callout: effluent alarm on the north outfall': '非工作时间出勤：北排放口废水报警',
  'False alarm on a blocked float. Logged with maintenance; no discharge event.':
    '浮球卡阻导致的误报。已报维修登记，未发生排放事件。',
  'Drafted the shutdown environmental brief': '起草了停机检修的环境说明',
  'Sat in on the Riverside permit review to compare approaches': '旁听河畔厂区的许可复核，比较两边的做法',
  'Half a day rebuilding the meter reading spreadsheet': '花半天重做了仪表读数表格',
  'It had grown three tabs nobody owned. Now one tab, one owner.':
    '它长出了三个没人负责的页签。现在一个页签、一个负责人。',
  'Recalibrated the bench balance after the move': '搬迁后重新校准了台秤',
  'Covered the goods-in checks while Ibrahim was on leave': '徐鹏程休假期间代做来料检验',
  'Traced the drift on the pH probe back to the buffer batch': '把 pH 电极的漂移追到了缓冲液批次上',
  'Buffer was out of date. Quarantined the batch and reran the affected checks.':
    '缓冲液已过期。该批次已隔离，受影响的检测已重做。',
  'Wrote up the retained-sample disposal procedure': '编写了留样处置规程',
  'Lab handover meeting with the night shift': '与夜班的实验室交接会',
  'Helped operations read the swab results': '帮生产部门解读涂抹检测结果',
  'Sorted the supplier certificate folder into something findable': '把供应商证书文件夹整理成找得到东西的样子',
};
