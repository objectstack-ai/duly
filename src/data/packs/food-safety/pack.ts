// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { CatalogPack } from '../index.js';

/**
 * 食品安全周期性履职包 — the recurring food-safety duties of a food
 * manufacturer, as a starting catalog.
 *
 * ── What this is, and what it is not ──────────────────────────────────────
 * Generic public knowledge: what the PRC Food Safety Law, GB 14881-2013 (the
 * general hygiene standard for food production), SAMR Order No. 60 (日管控 /
 * 周排查 / 月调度) and HACCP ask a food plant to do again and again. It is
 * no customer's list, and it is not legal advice. Every plant adapts it: which
 * positions it has, which checks it runs daily rather than weekly, and which
 * extra product standard applies.
 *
 * ── Citations: the number only where it was checked ───────────────────────
 * An article or clause number appears only where it was read against the
 * published text (Food Safety Law as amended 2021-04-29: Arts. 44–48, 50–52,
 * 63, 102; GB 14881-2013's clause list, incl. Appendix A; SAMR Order No. 60
 * Arts. 11–13 and 16). Everything else cites the framework alone (GB 2760,
 * GB 5749, HACCP), and a duty with no single source cites nothing rather than
 * a guess. Flagged for domain review on the PR that added it (#134).
 *
 * ── Shape ─────────────────────────────────────────────────────────────────
 * One entry per duty, one line per column, zh-CN first because it is this
 * pack's primary language. See `../README.md` for every column.
 */

/** 《中华人民共和国食品安全法》 (2021 amendment), by article. */
const law = (zh: string, en: number) => ({ zh: `《食品安全法》第${zh}条`, en: `PRC Food Safety Law, Art. ${en}` });
/** GB 14881-2013 《食品生产通用卫生规范》, by clause. */
const gb14881 = (clause: string, zh: string, en: string) => ({
  zh: `GB 14881-2013 ${clause} ${zh}`,
  en: `GB 14881-2013 §${clause} (${en})`,
});
/** 《企业落实食品安全主体责任监督管理规定》 (SAMR Order No. 60), by article. */
const order60 = (zh: string, en: number, zhTopic: string, enTopic: string) => ({
  zh: `《企业落实食品安全主体责任监督管理规定》第${zh}条（${zhTopic}）`,
  en: `SAMR Order No. 60, Art. ${en} (${enTopic})`,
});
/** Two citations on one line. */
const and = (a: { zh: string; en: string }, b: { zh: string; en: string }) => ({
  zh: `${a.zh}；${b.zh}`,
  en: `${a.en}; ${b.en}`,
});

export const FOOD_SAFETY: CatalogPack = {
  id: 'food-safety',
  title: { zh: '食品安全周期性履职', en: 'Food safety recurring duties' },

  positions: {
    director: { zh: '食品安全总监', en: 'Food safety director' },
    officer: { zh: '食品安全员', en: 'Food safety officer' },
    qc: { zh: '质量检验员', en: 'Quality inspector' },
    production: { zh: '生产班组长', en: 'Production shift lead' },
    warehouse: { zh: '仓库管理员', en: 'Warehouse keeper' },
    sanitation: { zh: '卫生管理员', en: 'Sanitation lead' },
    maintenance: { zh: '设备维修主管', en: 'Maintenance lead' },
    procurement: { zh: '采购主管', en: 'Procurement lead' },
  },

  duties: [
    // ── 食品安全总监 Food safety director ─────────────────────────────────
    {
      position: 'director',
      name: { zh: '每周食品安全风险隐患排查', en: 'Weekly food safety risk review' },
      done: {
        zh: '对照风险管控清单组织至少一次风险隐患排查，每个问题落实整改责任人和期限。',
        en: 'Run at least one risk review against the risk control checklist; every finding gets an owner and a fix-by date.',
      },
      evidence: { zh: '《每周食品安全排查治理报告》', en: 'The weekly risk review and remediation report.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 4, leadDays: 2, graceDays: 1,
      reference: order60('十二', 12, '周排查', 'weekly review'),
    },
    {
      position: 'director',
      name: { zh: '每月食品安全调度汇报', en: 'Monthly food safety briefing to top management' },
      done: {
        zh: '向主要负责人汇报本月食品安全管理情况，研究解决存在的问题，明确下月工作重点。',
        en: "Brief the chief responsible person on the month's food safety management, settle the open problems and agree next month's priorities.",
      },
      evidence: { zh: '《每月食品安全调度会议纪要》', en: 'Minutes of the monthly food safety review meeting.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_end', dueOffsetDays: -3, leadDays: 7, graceDays: 3,
      reference: order60('十三', 13, '月调度', 'monthly review'),
    },
    {
      position: 'director',
      name: { zh: '食品安全自查评价', en: 'Quarterly food safety self-inspection' },
      done: {
        zh: '按自查清单对生产条件、过程控制和记录全面检查评价；不符合要求的立即整改，有潜在事故风险的停止生产并报告监管部门。',
        en: 'Inspect and evaluate premises, process controls and records against the self-inspection checklist; correct anything nonconforming at once, and where there is a risk of an incident, stop production and report it to the regulator.',
      },
      evidence: { zh: '自查记录和整改清单。', en: 'The self-inspection record and the corrective-action list.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_end', dueOffsetDays: -10, leadDays: 21, graceDays: 5,
      reference: law('四十七', 47),
    },
    {
      position: 'director',
      name: { zh: 'HACCP 计划年度评审', en: 'Annual HACCP plan review' },
      done: {
        zh: '复核危害分析、关键控制点和关键限值，确认与当前的产品、配方、工艺和设备一致；有变化的更新计划。',
        en: "Recheck the hazard analysis, critical control points and critical limits against today's products, recipes, process and equipment; update the plan wherever anything changed.",
      },
      evidence: { zh: '评审记录（参与人、结论）和更新后的 HACCP 计划版本。', en: 'The review record (who took part, what was decided) and the revised HACCP plan.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -30, leadDays: 60, graceDays: 14,
      reference: { zh: '《食品安全法》第四十八条；HACCP 体系', en: 'PRC Food Safety Law, Art. 48; HACCP' },
    },
    {
      position: 'director',
      name: { zh: '食品安全事故应急演练', en: 'Food safety incident drill' },
      done: {
        zh: '按本企业食品安全事故处置方案组织一次演练，检查各项防范措施是否落实，修订演练暴露的问题。',
        en: 'Run one drill against the incident response plan, check that every preventive measure is really in place, and fix what the drill exposed.',
      },
      evidence: { zh: '演练方案、签到表和演练总结。', en: 'The drill plan, the attendance sheet and the after-action notes.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -60, leadDays: 30, graceDays: 14,
      reference: law('一百零二', 102),
    },
    {
      position: 'director',
      name: { zh: '保持食品安全管理制度现行有效', en: 'Keep the food safety management system current' },
      done: {
        zh: '制度文件与实际做法一致，法规、标准或工艺变化后及时修订，现场使用的都是现行版本。这一项没有“完成”，只做确认。',
        en: 'The written procedures match what is actually done, are revised when a law, standard or process changes, and only current versions are in use. Never "done"; attested, not ticked.',
      },
      evidence: { zh: '文件清单（版本号、生效日期）。', en: 'The document register, with versions and effective dates.' },
      form: 'standing',
      reference: law('四十四', 44),
    },

    // ── 食品安全员 Food safety officer ────────────────────────────────────
    {
      position: 'officer',
      name: { zh: '每日食品安全检查', en: 'Daily food safety check' },
      done: {
        zh: '对照风险管控清单检查当天的生产过程；没有发现问题也要记录。',
        en: "Check the day's production against the risk control checklist; record it even when nothing is found.",
      },
      evidence: { zh: '《每日食品安全检查记录》，无问题时记为“零风险”。', en: 'The daily food safety check record; a clean day is logged as a zero-risk report.' },
      form: 'recurring', frequency: 'daily', dueAnchor: 'period_start', dueOffsetDays: 0, leadDays: 0, graceDays: 0,
      reference: order60('十一', 11, '日管控', 'daily control'),
    },
    {
      position: 'officer',
      name: { zh: '从业人员健康证明核查', en: 'Staff health certificate check' },
      done: {
        zh: '核对所有接触直接入口食品人员的健康证明，列出 30 天内到期的人员并通知本人和主管。',
        en: 'Check the health certificate of everyone who handles ready-to-eat food; list anyone expiring in the next 30 days and tell them and their supervisor.',
      },
      evidence: { zh: '健康证明核查表和到期提醒名单。', en: 'The health certificate check sheet and the expiry list.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 2, leadDays: 7, graceDays: 3,
      reference: and(law('四十五', 45), gb14881('6.3.1', '食品加工人员健康管理', 'health management of food handlers')),
    },
    {
      position: 'officer',
      name: { zh: '季度食品安全培训', en: 'Quarterly food safety training' },
      done: {
        zh: '按年度培训计划组织一次培训，覆盖新员工和换岗人员，并进行考核。',
        en: 'Run one session from the annual training plan, covering new starters and people who changed jobs, with an assessment.',
      },
      evidence: { zh: '签到表、培训材料和考核结果。', en: 'The attendance sheet, the training material and the assessment results.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_end', dueOffsetDays: -15, leadDays: 21, graceDays: 7,
      reference: and(law('四十四', 44), gb14881('12', '培训', 'training')),
    },
    {
      position: 'officer',
      name: { zh: '食品安全管理人员年度培训考核', en: 'Annual training and assessment of food safety managers' },
      done: {
        zh: '组织食品安全总监和食品安全员学习食品安全法律、法规、标准和专业知识，并进行考核。',
        en: 'Train the food safety director and officers on food safety law, regulations, standards and professional knowledge, and assess them.',
      },
      evidence: { zh: '培训和考核记录。', en: 'The training and assessment records.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -45, leadDays: 60, graceDays: 14,
      reference: order60('十六', 16, '培训考核', 'training and assessment'),
    },
    {
      position: 'officer',
      name: { zh: '产品追溯与模拟召回', en: 'Mock recall and traceability test' },
      done: {
        zh: '任选一个已出厂批次，向上追溯到原料批次、向下追溯到客户，记录用时，确认召回程序能执行。',
        en: 'Pick one shipped batch, trace it back to its raw-material lots and forward to its customers, time it, and confirm the recall procedure works.',
      },
      evidence: { zh: '模拟召回记录（批次、用时、追回率）。', en: 'The mock recall record: batch, time taken, share recovered.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -90, leadDays: 30, graceDays: 14,
      reference: and(law('六十三', 63), gb14881('11', '产品召回管理', 'product recall management')),
    },
    {
      position: 'officer',
      name: { zh: '法规标准更新跟踪', en: 'Regulation and standard update watch' },
      done: {
        zh: '检查本季度新发布或修订的食品安全法规和国家标准，判断对本企业的影响，需要时提出制度修订。',
        en: 'Check the food safety regulations and national standards issued or revised this quarter, judge what they change for this plant, and propose procedure changes where needed.',
      },
      evidence: { zh: '法规标准更新清单和影响评估。', en: 'The list of updates and the impact assessment.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_end', dueOffsetDays: -5, leadDays: 14, graceDays: 7,
    },

    // ── 质量检验员 Quality inspector ──────────────────────────────────────
    {
      position: 'qc',
      name: { zh: '进货查验记录核对', en: 'Incoming goods verification review' },
      done: {
        zh: '核对本周每批到货的原料、食品添加剂和包装材料都已查验供货者许可证和产品合格证明，并如实记录。',
        en: "Confirm that every delivery of raw materials, additives and packaging this week was checked for the supplier's licence and certificate of conformity, and recorded.",
      },
      evidence: { zh: '进货查验记录。', en: 'The incoming goods inspection records.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 1, leadDays: 2, graceDays: 1,
      reference: and(law('五十', 50), gb14881('7', '食品原料、食品添加剂和食品相关产品', 'raw materials, additives and food-related products')),
    },
    {
      position: 'qc',
      name: { zh: '出厂检验记录复核', en: 'Release inspection record review' },
      done: {
        zh: '复核本周每个出厂批次都有检验合格证明和出厂检验记录，没有未经检验或检验不合格就放行的。',
        en: 'Confirm that every batch released this week has a certificate of inspection and a release record, and that nothing left untested or after a failed test.',
      },
      evidence: { zh: '出厂检验记录。', en: 'The release inspection records.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 4, leadDays: 2, graceDays: 1,
      reference: law('五十一', 51),
    },
    {
      position: 'qc',
      name: { zh: '环境微生物监控', en: 'Environmental microbiological monitoring' },
      done: {
        zh: '按监控计划在食品接触面、加工环境和空气中取样检测；超出限值的追查原因并复测。',
        en: 'Sample food-contact surfaces, the processing environment and the air to the monitoring plan; trace the cause of any result over limit and retest.',
      },
      evidence: { zh: '取样记录、检测结果和超标处理记录。', en: 'The sampling log, the results, and what was done about any result over limit.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 2, leadDays: 2, graceDays: 1,
      reference: {
        zh: 'GB 14881-2013 8.2.2 食品加工过程的微生物监控及附录 A',
        en: 'GB 14881-2013 §8.2.2 (microbial monitoring) and Appendix A',
      },
    },
    {
      position: 'qc',
      name: { zh: '检验与监控仪器校准核查', en: 'Instrument calibration check' },
      done: {
        zh: '核对温度计、压力表、天平等检验和监控设备都在校准有效期内；到期的送检，不合格的停用。',
        en: 'Confirm that thermometers, pressure gauges, balances and other test and monitoring instruments are within calibration; send the due ones off and take failed ones out of use.',
      },
      evidence: { zh: '仪器校准台账和校准证书。', en: 'The calibration register and the certificates.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 5, leadDays: 7, graceDays: 3,
      reference: gb14881('5.2.2', '监控设备', 'monitoring equipment'),
    },
    {
      position: 'qc',
      name: { zh: '成品留样检查', en: 'Finished-goods retained sample check' },
      done: {
        zh: '检查每个批次的留样齐全、标识清楚、储存条件符合要求；超过留样期的按规定处置。',
        en: 'Check that every batch has its retained sample, clearly labelled and stored as required; dispose of samples past their retention period as the procedure says.',
      },
      evidence: { zh: '留样登记和处置记录。', en: 'The retained sample register and the disposal log.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 3, leadDays: 2, graceDays: 1,
    },
    {
      position: 'qc',
      name: { zh: '产品年度全项检验', en: 'Annual full-specification product test' },
      done: {
        zh: '按产品执行的食品安全标准，送有资质的检验机构做一次全项目检验；不合格项追查原因。',
        en: "Send each product to an accredited laboratory for a test against every parameter of its food safety standard; trace the cause of any failure.",
      },
      evidence: { zh: '检验报告。', en: 'The test reports.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -60, leadDays: 45, graceDays: 14,
      reference: law('五十二', 52),
    },
    {
      position: 'qc',
      name: { zh: '食品添加剂使用核查', en: 'Food additive use check' },
      done: {
        zh: '核对配方和投料记录中食品添加剂的品种、用量和使用范围符合 GB 2760，使用台账与库存一致。',
        en: 'Check that the additives in the recipes and batch records, their amounts and their uses comply with GB 2760, and that the usage log agrees with stock.',
      },
      evidence: { zh: '食品添加剂使用台账和核查记录。', en: 'The additive usage log and the check record.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_end', dueOffsetDays: -5, leadDays: 7, graceDays: 3,
      reference: { zh: 'GB 2760；GB 14881-2013 7.3 食品添加剂', en: 'GB 2760; GB 14881-2013 §7.3 (food additives)' },
    },

    // ── 生产班组长 Production shift lead ──────────────────────────────────
    {
      position: 'production',
      name: { zh: '关键控制点监控记录复核', en: 'CCP monitoring record check' },
      done: {
        zh: '复核当天每个关键控制点的监控记录完整、签名齐全；偏离关键限值的已采取纠偏措施并记录。',
        en: "Check that today's monitoring record for every critical control point is complete and signed, and that every deviation from a critical limit has a recorded corrective action.",
      },
      evidence: { zh: 'CCP 监控记录和纠偏记录。', en: 'The CCP monitoring log and the corrective-action log.' },
      form: 'recurring', frequency: 'daily', dueAnchor: 'period_start', dueOffsetDays: 0, leadDays: 0, graceDays: 0,
      reference: { zh: 'HACCP 体系（监控、纠偏、记录）', en: 'HACCP (monitoring, corrective action, records)' },
    },
    {
      position: 'production',
      name: { zh: '班前健康与卫生检查', en: 'Pre-shift health and hygiene check' },
      done: {
        zh: '开班前检查上岗人员：有发热、腹泻、手部伤口等情况的调离接触食品岗位；工作服、发帽和洗手消毒符合要求。',
        en: 'Before the shift, check everyone starting work: anyone with a fever, diarrhoea or a cut on the hands moves off food-handling work; workwear, hair covering and hand washing meet the rules.',
      },
      evidence: { zh: '晨检记录。', en: 'The pre-shift check record.' },
      form: 'recurring', frequency: 'daily', dueAnchor: 'period_start', dueOffsetDays: 0, leadDays: 0, graceDays: 0,
      reference: gb14881('6.3', '食品加工人员健康管理与卫生要求', 'health and hygiene of food handlers'),
    },
    {
      position: 'production',
      name: { zh: '金属探测器灵敏度验证', en: 'Metal detector sensitivity test' },
      done: {
        zh: '开机前和每班用标准测试块验证金属探测器能检出并剔除；验证失败时，隔离上次验证合格后生产的产品。',
        en: 'At start-up and every shift, prove with the test pieces that the metal detector detects and rejects; if it fails, hold everything made since the last good test.',
      },
      evidence: { zh: '金属探测器验证记录。', en: 'The metal detector test log.' },
      form: 'recurring', frequency: 'daily', dueAnchor: 'period_start', dueOffsetDays: 0, leadDays: 0, graceDays: 0,
      reference: gb14881('8.4', '物理污染的控制', 'control of physical contamination'),
    },
    {
      position: 'production',
      name: { zh: '生产批记录完整性检查', en: 'Batch record completeness review' },
      done: {
        zh: '检查本周每个生产批次的投料、工艺参数和包装记录完整，并能追溯到原料批次。',
        en: "Check that every batch made this week has complete ingredient, process and packing records that trace back to the raw-material lots.",
      },
      evidence: { zh: '批生产记录。', en: 'The batch production records.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 4, leadDays: 2, graceDays: 1,
      reference: and(law('四十六', 46), gb14881('14', '记录和文件管理', 'records and documents')),
    },
    {
      position: 'production',
      name: { zh: '玻璃及硬质塑料制品巡查', en: 'Glass and brittle plastics audit' },
      done: {
        zh: '对照登记清单检查生产区所有玻璃和硬质塑料制品完好；有破损的按破损处理程序处理。',
        en: 'Walk the register of glass and brittle plastic items in the production area and confirm each is intact; handle any breakage by the breakage procedure.',
      },
      evidence: { zh: '巡查记录。', en: 'The audit record.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 3, leadDays: 7, graceDays: 3,
      reference: gb14881('8.4', '物理污染的控制', 'control of physical contamination'),
    },

    // ── 仓库管理员 Warehouse keeper ───────────────────────────────────────
    {
      position: 'warehouse',
      name: { zh: '库房温湿度记录', en: 'Store temperature and humidity log' },
      done: {
        zh: '每天记录常温库、冷藏库和冷冻库的温湿度；超出范围的立即处理，并记录对产品的评估。',
        en: 'Log the temperature and humidity of the ambient, chilled and frozen stores every day; act at once on anything out of range and record the assessment of the product.',
      },
      evidence: { zh: '温湿度记录表。', en: 'The temperature and humidity log.' },
      form: 'recurring', frequency: 'daily', dueAnchor: 'period_start', dueOffsetDays: 0, leadDays: 0, graceDays: 0,
      reference: gb14881('10', '食品的贮存和运输', 'storage and transport'),
    },
    {
      position: 'warehouse',
      name: { zh: '库存先进先出与临期检查', en: 'Stock rotation and near-expiry check' },
      done: {
        zh: '检查原料和成品按先进先出（先到期先出）发放；临期、过期和不合格品已隔离、标识并登记。',
        en: 'Check that materials and finished goods go out first-expired-first-out, and that near-expiry, expired and nonconforming stock is segregated, labelled and logged.',
      },
      evidence: { zh: '库存检查记录和隔离品台账。', en: 'The stock check record and the quarantine log.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 1, leadDays: 2, graceDays: 1,
      reference: gb14881('10', '食品的贮存和运输', 'storage and transport'),
    },
    {
      position: 'warehouse',
      name: { zh: '运输车辆卫生检查', en: 'Delivery vehicle hygiene check' },
      done: {
        zh: '检查装运食品的车辆清洁、无异味，冷链车辆温度符合要求，不与有毒有害物品混装。',
        en: 'Check that vehicles carrying food are clean and odour-free, that refrigerated vehicles hold temperature, and that food never travels with toxic or hazardous goods.',
      },
      evidence: { zh: '车辆检查记录。', en: 'The vehicle check record.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 2, leadDays: 2, graceDays: 1,
      reference: gb14881('10', '食品的贮存和运输', 'storage and transport'),
    },

    // ── 卫生管理员 Sanitation lead ────────────────────────────────────────
    {
      position: 'sanitation',
      name: { zh: '清洁消毒执行检查', en: 'Cleaning and sanitising check' },
      done: {
        zh: '检查本周清洁消毒计划按区域和频次执行，消毒剂浓度有检测记录。',
        en: "Check that this week's cleaning and sanitising schedule was carried out area by area at the set frequency, and that sanitiser strength was tested and logged.",
      },
      evidence: { zh: '清洁消毒记录和消毒剂浓度记录。', en: 'The cleaning log and the sanitiser strength log.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 4, leadDays: 2, graceDays: 1,
      reference: gb14881('8.2.1', '清洁和消毒', 'cleaning and disinfection'),
    },
    {
      position: 'sanitation',
      name: { zh: '虫害控制检查', en: 'Pest control inspection' },
      done: {
        zh: '检查捕鼠器、诱虫灯和防虫设施，记录捕获情况并分析趋势；发现虫害迹象的立即处理。',
        en: 'Inspect the traps, insect lamps and proofing, log the catches and look at the trend; act at once on any sign of infestation.',
      },
      evidence: { zh: '虫害控制检查记录和趋势分析。', en: 'The pest control log and the trend analysis.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 5, leadDays: 7, graceDays: 3,
      reference: gb14881('6.4', '虫害控制', 'pest control'),
    },
    {
      position: 'sanitation',
      name: { zh: '废弃物存放与清运检查', en: 'Waste storage and removal check' },
      done: {
        zh: '检查废弃物按类别存放、容器加盖并及时清运，存放区域清洁。',
        en: 'Check that waste is sorted, kept in covered containers and removed on time, and that the waste area is clean.',
      },
      evidence: { zh: '废弃物清运记录。', en: 'The waste removal log.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 3, leadDays: 2, graceDays: 1,
      reference: gb14881('6.5', '废弃物处理', 'waste disposal'),
    },
    {
      position: 'sanitation',
      name: { zh: '工作服清洗管理检查', en: 'Workwear laundering check' },
      done: {
        zh: '检查工作服按区域区分、定期清洗消毒并有发放记录，不同清洁区的工作服不混放。',
        en: 'Check that workwear is distinguished by area, laundered and sanitised on schedule and issued against a record, and that clothing from different hygiene zones is kept apart.',
      },
      evidence: { zh: '工作服清洗和发放记录。', en: 'The laundering and issue log.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 8, leadDays: 7, graceDays: 3,
      reference: gb14881('6.6', '工作服管理', 'workwear management'),
    },
    {
      position: 'sanitation',
      name: { zh: '生产用水水质检测', en: 'Process water quality test' },
      done: {
        zh: '生产用水送检，确认符合 GB 5749；使用自备水源的同时检查水处理设施。',
        en: 'Send the process water for testing and confirm it meets GB 5749; with a private supply, inspect the treatment plant too.',
      },
      evidence: { zh: '水质检测报告。', en: 'The water test report.' },
      form: 'recurring', frequency: 'semiannual', dueAnchor: 'period_end', dueOffsetDays: -15, leadDays: 30, graceDays: 10,
      reference: { zh: 'GB 14881-2013 5.1.1 供水设施；GB 5749', en: 'GB 14881-2013 §5.1.1 (water supply); GB 5749' },
    },

    // ── 设备维修主管 Maintenance lead ─────────────────────────────────────
    {
      position: 'maintenance',
      name: { zh: '设备预防性维护', en: 'Preventive maintenance round' },
      done: {
        zh: '按保养计划完成本月的设备保养，检查食品接触部件没有磨损、松动和锈蚀。',
        en: "Complete this month's planned maintenance and check that no food-contact part is worn, loose or corroded.",
      },
      evidence: { zh: '设备保养记录。', en: 'The maintenance records.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 6, leadDays: 7, graceDays: 3,
      reference: gb14881('5.2.3', '设备的保养和维修', 'equipment maintenance and repair'),
    },
    {
      position: 'maintenance',
      name: { zh: '食品级润滑剂使用核查', en: 'Food-grade lubricant check' },
      done: {
        zh: '核对可能接触食品的部位只使用食品级润滑剂，润滑剂单独存放并有领用记录。',
        en: 'Confirm that only food-grade lubricants are used wherever they could reach food, and that lubricants are stored apart and issued against a record.',
      },
      evidence: { zh: '润滑剂清单和领用记录。', en: 'The lubricant list and the issue log.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_start', dueOffsetDays: 10, leadDays: 14, graceDays: 5,
      reference: gb14881('8.3', '化学污染的控制', 'control of chemical contamination'),
    },
    {
      position: 'maintenance',
      name: { zh: '厂房设施年度检查', en: 'Annual premises condition survey' },
      done: {
        zh: '检查屋顶、墙面、地面、门窗、排水和通风设施有无渗漏、冷凝水、脱落和破损，并制定维修计划。',
        en: 'Survey roofs, walls, floors, doors, windows, drains and ventilation for leaks, condensation, flaking and damage, and draw up the repair plan.',
      },
      evidence: { zh: '检查记录和维修计划。', en: 'The survey record and the repair plan.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -90, leadDays: 45, graceDays: 14,
      reference: gb14881('6.2', '厂房及设施卫生管理', 'hygiene of premises and facilities'),
    },

    // ── 采购主管 Procurement lead ─────────────────────────────────────────
    {
      position: 'procurement',
      name: { zh: '合格供应商年度评价', en: 'Annual approved-supplier review' },
      done: {
        zh: '逐个评价原料、食品添加剂和包装材料供应商的资质、检验报告和质量问题记录，更新合格供应商名录。',
        en: 'Review every supplier of raw materials, additives and packaging, their credentials, test reports and quality history, and update the approved supplier list.',
      },
      evidence: { zh: '供应商评价表和更新后的合格供应商名录。', en: 'The supplier evaluations and the updated approved supplier list.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -45, leadDays: 60, graceDays: 14,
      reference: and(law('五十', 50), gb14881('7.1', '一般要求', 'general requirements')),
    },
    {
      position: 'procurement',
      name: { zh: '供应商资质到期核查', en: 'Supplier licence expiry check' },
      done: {
        zh: '核对在用供应商的许可证和资质证明，30 天内到期的提前索取新证。',
        en: 'Check the licences and credentials of every supplier in use, and ask for the renewal of anything expiring in the next 30 days.',
      },
      evidence: { zh: '供应商资质台账。', en: 'The supplier credentials register.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 3, leadDays: 7, graceDays: 3,
      reference: law('五十', 50),
    },
    {
      position: 'procurement',
      name: { zh: '只从合格供应商采购', en: 'Buy only from approved suppliers' },
      done: {
        zh: '每一笔采购都来自合格供应商名录；名录外的供应商先评价、后下单。这一项没有“完成”，只做确认。',
        en: 'Every purchase is from a supplier on the approved list; a new supplier is evaluated before the first order. Never "done"; attested, not ticked.',
      },
      evidence: { zh: '合格供应商名录。', en: 'The approved supplier list.' },
      form: 'standing',
      reference: gb14881('7.1', '一般要求', 'general requirements'),
    },
  ],
};
