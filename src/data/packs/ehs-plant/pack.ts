// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { CatalogPack, PackText } from '../index.js';

/**
 * 工厂 EHS 周期性履职包 — the recurring environment, health and safety duties
 * of a mid-size manufacturing plant, as a starting catalog (#137).
 *
 * ── Where this sits beside an EHS suite ───────────────────────────────────
 * An EHS suite owns incidents, findings and corrective actions. This pack
 * owns the other half: WHO does WHAT, on WHICH cadence, and what record shows
 * it was done. A finding from the weekly hazard check belongs in the suite;
 * the weekly hazard check itself belongs here.
 *
 * ── What this is, and what it is not ──────────────────────────────────────
 * Generic public knowledge of the duties Chinese work-safety, fire-protection,
 * special-equipment, occupational-health and environmental rules ask a plant
 * to repeat, plus the generic ISO 45001 / ISO 14001 cycle. It is no
 * customer's list, and it is not legal advice. Cadences are common practice,
 * not a statutory minimum read off a text: some plants must do more (a fire
 * safety key unit, a plant with severe occupational hazards), and the local
 * regulator's rule always wins.
 *
 * ── References name the obligation, never an article ──────────────────────
 * Unlike the food-safety pack, a reference here names the TYPE of obligation
 * and at most the public framework it belongs to (《安全生产法》, ISO 45001),
 * with no article or clause number and no quoted text. The card asks for
 * exactly that (#137), and a number nobody checked is worse than none.
 *
 * ── Shape ─────────────────────────────────────────────────────────────────
 * One entry per duty, one line per column, zh-CN first because it is this
 * pack's primary language. See `../README.md` for every column.
 */

/** An obligation type, under the public framework it belongs to. */
const ref = (zhFramework: string, zhType: string, enFramework: string, enType: string): PackText => ({
  zh: `${zhFramework}：${zhType}`,
  en: `${enFramework}: ${enType}`,
});

/** Two references on one line. */
const and = (a: PackText, b: PackText): PackText => ({ zh: `${a.zh}；${b.zh}`, en: `${a.en}; ${b.en}` });

const workSafety = (zh: string, en: string) => ref('《安全生产法》', zh, 'PRC Work Safety Law', en);
const fire = (zh: string, en: string) => ref('《消防法》', zh, 'PRC Fire Protection Law', en);
const specialEquipment = (zh: string, en: string) => ref('《特种设备安全法》', zh, 'PRC Special Equipment Safety Law', en);
const occupationalHealth = (zh: string, en: string) =>
  ref('《职业病防治法》', zh, 'PRC Occupational Disease Prevention Law', en);
const solidWaste = (zh: string, en: string) => ref('《固体废物污染环境防治法》', zh, 'PRC Solid Waste Law', en);
const dischargePermit = (zh: string, en: string) => ref('排污许可', zh, 'Pollutant discharge permit', en);
const iso45001 = (zh: string, en: string) => ref('ISO 45001', zh, 'ISO 45001', en);
const iso14001 = (zh: string, en: string) => ref('ISO 14001', zh, 'ISO 14001', en);

export const EHS_PLANT: CatalogPack = {
  id: 'ehs-plant',
  title: { zh: '工厂 EHS 周期性履职', en: 'Plant EHS recurring duties' },

  positions: {
    manager: { zh: 'EHS 经理', en: 'EHS manager' },
    safety: { zh: '专职安全员', en: 'Safety officer' },
    fire: { zh: '消防安全管理员', en: 'Fire safety custodian' },
    equipment: { zh: '特种设备管理员', en: 'Special equipment custodian' },
    waste: { zh: '危险废物管理员', en: 'Hazardous waste custodian' },
    health: { zh: '职业健康专员', en: 'Occupational health coordinator' },
    environment: { zh: '环保设施运行员', en: 'Environmental facilities operator' },
    shift: { zh: '车间当班班长', en: 'Workshop shift leader' },
  },

  duties: [
    // ── EHS 经理 EHS manager ───────────────────────────────────────────────
    {
      position: 'manager',
      name: { zh: '每月安全生产例会', en: 'Monthly EHS committee meeting' },
      done: {
        zh: '召开一次安全生产例会，通报本月隐患、事件和整改进度，对未关闭的问题明确责任人和期限。',
        en: "Hold one EHS committee meeting: report the month's hazards, incidents and fix progress, and give every open item an owner and a fix-by date.",
      },
      evidence: { zh: '会议纪要和签到表。', en: 'The minutes and the attendance sheet.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_end', dueOffsetDays: -5, leadDays: 7, graceDays: 3,
      reference: workSafety('安全生产管理机构与例会', 'safety management meetings'),
    },
    {
      position: 'manager',
      name: { zh: '年度安全生产责任书签订', en: 'Annual EHS responsibility letters' },
      done: {
        zh: '下达本年度安全生产和环保目标，与各部门、各岗位负责人签订责任书，覆盖全部在岗人员。',
        en: "Set this year's safety and environmental targets and have every department and position head sign a responsibility letter, so that nobody on site is left out.",
      },
      evidence: { zh: '签字的责任书和目标分解表。', en: 'The signed letters and the target breakdown.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_start', dueOffsetDays: 30, leadDays: 30, graceDays: 14,
      reference: workSafety('全员安全生产责任制', 'safety responsibility for every position'),
    },
    {
      position: 'manager',
      name: { zh: '年度危险源辨识与风险评价更新', en: 'Annual hazard identification and risk assessment update' },
      done: {
        zh: '组织各部门重新辨识危险源、评价风险等级，更新风险分级管控清单；工艺、设备或场所有变化的一并纳入。',
        en: 'Have every department identify hazards and rate the risks again, and update the risk control register; include every process, equipment or site change since the last round.',
      },
      evidence: { zh: '更新后的风险分级管控清单和评价记录。', en: 'The revised risk control register and the assessment records.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -60, leadDays: 45, graceDays: 14,
      reference: and(workSafety('风险分级管控', 'risk grading and control'), iso45001('危险源辨识', 'hazard identification')),
    },
    {
      position: 'manager',
      name: { zh: '年度环境因素识别与合规性评价', en: 'Annual environmental aspects and compliance evaluation' },
      done: {
        zh: '更新环境因素清单和重要环境因素，逐条对照适用的环保要求评价合规情况，不合规的列入整改。',
        en: 'Update the environmental aspects list and the significant aspects, evaluate compliance against each applicable environmental requirement, and put every gap on the fix list.',
      },
      evidence: { zh: '环境因素清单和合规性评价报告。', en: 'The aspects list and the compliance evaluation report.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -45, leadDays: 45, graceDays: 14,
      reference: iso14001('环境因素与合规义务评价', 'environmental aspects and compliance evaluation'),
    },
    {
      position: 'manager',
      name: { zh: 'EHS 管理评审', en: 'Annual EHS management review' },
      done: {
        zh: '向最高管理者汇报一年的 EHS 绩效、目标完成、事件和审核结果，形成评审结论和下一年的改进事项。',
        en: "Report the year's EHS performance, targets, incidents and audit results to top management, and record the conclusions and next year's improvements.",
      },
      evidence: { zh: '管理评审报告和会议纪要。', en: 'The management review report and minutes.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -20, leadDays: 30, graceDays: 14,
      reference: and(iso45001('管理评审', 'management review'), iso14001('管理评审', 'management review')),
    },
    {
      position: 'manager',
      name: { zh: '保持 EHS 管理制度和操作规程现行有效', en: 'Keep the EHS procedures and work instructions current' },
      done: {
        zh: '制度和操作规程与现场实际一致，法规、工艺或设备变化后及时修订，岗位上使用的都是现行版本。这一项没有“完成”，只做确认。',
        en: 'The procedures and work instructions match what is actually done, are revised when a rule, process or machine changes, and only current versions are in use at the workstations. Never "done"; attested, not ticked.',
      },
      evidence: { zh: '制度清单（版本号、生效日期）。', en: 'The procedure register, with versions and effective dates.' },
      form: 'standing',
      reference: workSafety('安全生产规章制度和操作规程', 'safety rules and operating procedures'),
    },

    // ── 专职安全员 Safety officer ──────────────────────────────────────────
    {
      position: 'safety',
      name: { zh: '每日安全巡查', en: 'Daily site safety patrol' },
      done: {
        zh: '巡查生产现场、仓库和外包作业点，发现的隐患当场纠正或登记；没有发现问题也要记录。',
        en: 'Walk the production floor, the stores and every contractor work point; correct a hazard on the spot or log it, and record the patrol even when nothing is found.',
      },
      evidence: { zh: '巡查记录。', en: 'The patrol record.' },
      form: 'recurring', frequency: 'daily', dueAnchor: 'period_start', dueOffsetDays: 0, leadDays: 0, graceDays: 0,
      reference: workSafety('安全生产检查', 'safety inspection'),
    },
    {
      position: 'safety',
      name: { zh: '每周事故隐患排查', en: 'Weekly hazard check' },
      done: {
        zh: '按风险分级管控清单组织一次隐患排查，每条隐患登记、定级，落实整改责任人、措施和期限；上周的整改逐条复查。',
        en: "Run one hazard check against the risk control register: log and grade every hazard, give each an owner, a fix and a date, and re-check last week's fixes one by one.",
      },
      evidence: { zh: '隐患排查治理台账。', en: 'The hazard log, with each fix and its re-check.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 3, leadDays: 2, graceDays: 1,
      reference: workSafety('事故隐患排查治理', 'hazard identification and remediation'),
    },
    {
      position: 'safety',
      name: { zh: '每月危险作业票证审核', en: 'Monthly permit-to-work audit' },
      done: {
        zh: '抽查本月的动火、受限空间、高处、临时用电等危险作业票，核对审批、气体检测、监护和关闭是否齐全。',
        en: "Sample this month's permits for hot work, confined space, work at height and temporary power, and check each one's approval, gas test, standby person and close-out.",
      },
      evidence: { zh: '作业票抽查记录和问题清单。', en: 'The permit sample record and the list of gaps.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 5, leadDays: 7, graceDays: 3,
      reference: workSafety('危险作业现场安全管理', 'hazardous work on site'),
    },
    {
      position: 'safety',
      name: { zh: '每季度相关方安全检查', en: 'Quarterly contractor safety review' },
      done: {
        zh: '检查在厂承包商和外来施工单位的资质、安全协议、人员培训和现场作业情况，不合格的停工整改。',
        en: 'Check every contractor on site for its qualifications, safety agreement, worker induction and how it actually works; stop any job that fails until it is fixed.',
      },
      evidence: { zh: '相关方检查记录和安全协议清单。', en: 'The contractor review record and the list of safety agreements.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_end', dueOffsetDays: -10, leadDays: 14, graceDays: 7,
      reference: workSafety('发包、出租和相关方安全管理', 'contractor and tenant safety'),
    },
    {
      position: 'safety',
      name: { zh: '专项应急预案演练', en: 'Emergency response drill' },
      done: {
        zh: '按专项应急预案或现场处置方案组织一次演练（如化学品泄漏、触电、机械伤害），评估效果并修订预案暴露的问题。',
        en: 'Run one drill against a specific response plan (a chemical spill, an electric shock, a machine injury), assess how it went, and fix what it exposed in the plan.',
      },
      evidence: { zh: '演练方案、签到表、照片和演练评估。', en: 'The drill plan, attendance sheet, photos and the drill assessment.' },
      form: 'recurring', frequency: 'semiannual', dueAnchor: 'period_end', dueOffsetDays: -30, leadDays: 30, graceDays: 10,
      reference: workSafety('生产安全事故应急预案演练', 'emergency plan drills'),
    },
    {
      position: 'safety',
      name: { zh: '年度全员安全教育培训', en: 'Annual safety training for all staff' },
      done: {
        zh: '按年度培训计划完成全员安全再培训，考核合格；主要负责人和安全管理人员完成规定学时。',
        en: "Complete the year's refresher safety training for everyone on the annual plan, with a passed test; the chief responsible person and the safety staff complete their required hours.",
      },
      evidence: { zh: '培训计划、签到表、试卷或考核记录。', en: 'The training plan, attendance sheets and test records.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -60, leadDays: 60, graceDays: 14,
      reference: workSafety('安全生产教育和培训', 'safety training'),
    },
    {
      position: 'safety',
      name: { zh: '特种作业人员持证上岗', en: 'Keep special-operations certificates valid' },
      done: {
        zh: '电工、焊工、高处作业等特种作业人员都持有有效证件，到期前安排复审；无证人员不上岗。这一项没有“完成”，只做确认。',
        en: 'Every electrician, welder, work-at-height operator and other special-operations worker holds a valid certificate, renewed before it lapses; nobody without one does the work. Never "done"; attested, not ticked.',
      },
      evidence: { zh: '特种作业人员持证台账（证号、有效期）。', en: 'The certificate register, with numbers and expiry dates.' },
      form: 'standing',
      reference: workSafety('特种作业人员持证上岗', 'certified special-operations workers'),
    },

    // ── 消防安全管理员 Fire safety custodian ───────────────────────────────
    {
      position: 'fire',
      name: { zh: '每日防火巡查', en: 'Daily fire patrol' },
      done: {
        zh: '巡查用火用电、安全出口和疏散通道、消防车通道和重点部位，发现问题当场处置或登记。',
        en: 'Patrol the use of fire and electricity, the exits and escape routes, the fire-engine access and the high-risk areas; deal with a problem on the spot or log it.',
      },
      evidence: { zh: '防火巡查记录。', en: 'The fire patrol record.' },
      form: 'recurring', frequency: 'daily', dueAnchor: 'period_start', dueOffsetDays: 0, leadDays: 0, graceDays: 0,
      reference: fire('防火巡查', 'fire patrols'),
    },
    {
      position: 'fire',
      name: { zh: '每月灭火器检查', en: 'Monthly fire extinguisher inspection' },
      done: {
        zh: '逐具检查灭火器的位置、压力、铅封、喷管和有效期，过期或失效的及时送修更换，并在检查卡上签字。',
        en: "Check every extinguisher's place, pressure, seal, hose and service date; send any lapsed or faulty one for service or replace it, and sign its tag.",
      },
      evidence: { zh: '灭火器检查记录和检查卡。', en: 'The extinguisher log and the signed tags.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 3, leadDays: 7, graceDays: 3,
      reference: fire('消防器材日常检查', 'routine checks of fire equipment'),
    },
    {
      position: 'fire',
      name: { zh: '每月防火检查', en: 'Monthly fire safety inspection' },
      done: {
        zh: '检查消火栓、应急照明、疏散指示、防火门、报警和喷淋系统的状态，以及消防安全制度的落实情况，问题落实整改。',
        en: 'Inspect the hydrants, emergency lighting, exit signs, fire doors, alarm and sprinkler systems, and whether the fire safety rules are followed; get every problem fixed.',
      },
      evidence: { zh: '防火检查记录和整改单。', en: 'The inspection record and the fix list.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 8, leadDays: 7, graceDays: 3,
      reference: fire('防火检查', 'fire safety inspections'),
    },
    {
      position: 'fire',
      name: { zh: '灭火和应急疏散演练', en: 'Fire evacuation drill' },
      done: {
        zh: '按灭火和应急疏散预案组织一次全员演练，记录疏散用时，结合演练做一次消防安全培训。',
        en: 'Run one site-wide drill against the fire and evacuation plan, record the evacuation time, and give a fire safety briefing with it.',
      },
      evidence: { zh: '演练记录（时间、参加人数、疏散用时）和照片。', en: 'The drill record (time, headcount, evacuation time) and photos.' },
      form: 'recurring', frequency: 'semiannual', dueAnchor: 'period_end', dueOffsetDays: -45, leadDays: 30, graceDays: 10,
      reference: fire('灭火和应急疏散演练', 'fire and evacuation drills'),
    },
    {
      position: 'fire',
      name: { zh: '年度建筑消防设施检测', en: 'Annual fire system test by a licensed provider' },
      done: {
        zh: '委托有资质的消防技术服务机构对建筑消防设施全面检测，对检测发现的问题落实整改。',
        en: 'Have a licensed fire technical service provider test every building fire system, and get every issue it finds fixed.',
      },
      evidence: { zh: '消防设施检测报告和整改记录。', en: "The provider's test report and the fix record." },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -90, leadDays: 45, graceDays: 14,
      reference: fire('建筑消防设施检测', 'building fire system testing'),
    },

    // ── 特种设备管理员 Special equipment custodian ─────────────────────────
    {
      position: 'equipment',
      name: { zh: '叉车和起重设备班前点检', en: 'Pre-shift forklift and crane check' },
      done: {
        zh: '使用前检查叉车、行车的制动、限位、钢丝绳、吊钩和报警装置，发现异常立即停用并报修。',
        en: 'Before use, check the brakes, limit switches, wire ropes, hooks and alarms on every forklift and overhead crane; take anything abnormal out of service and report it.',
      },
      evidence: { zh: '点检表。', en: 'The pre-use checklist.' },
      form: 'recurring', frequency: 'daily', dueAnchor: 'period_start', dueOffsetDays: 0, leadDays: 0, graceDays: 0,
      reference: specialEquipment('使用前检查', 'pre-use checks'),
    },
    {
      position: 'equipment',
      name: { zh: '每月特种设备自行检查', en: 'Monthly special equipment self-inspection' },
      done: {
        zh: '对锅炉、压力容器、压力管道、电梯、起重机械和场内机动车辆做一次自行检查和维护保养，记录问题和处理情况。',
        en: 'Self-inspect and service every boiler, pressure vessel, pressure pipe, lift, crane and site vehicle once, and record every problem and what was done about it.',
      },
      evidence: { zh: '自行检查和维护保养记录。', en: 'The self-inspection and maintenance records.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_end', dueOffsetDays: -5, leadDays: 7, graceDays: 3,
      reference: specialEquipment('定期自行检查和维护保养', 'periodic self-inspection and maintenance'),
    },
    {
      position: 'equipment',
      name: { zh: '特种设备定期检验申报', en: 'Book statutory inspections of special equipment' },
      done: {
        zh: '对照检验有效期，在到期前向检验机构申报定期检验，安全阀、压力表等安全附件一并校验；检验后更新合格标志。',
        en: 'Against each due date, book the statutory inspection with the inspection body before it falls due, with the safety valves, gauges and other safety accessories calibrated at the same time; update the pass tags after.',
      },
      evidence: { zh: '检验申报记录、检验报告和安全附件校验证书。', en: 'The booking, the inspection reports and the accessory calibration certificates.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -60, leadDays: 45, graceDays: 14,
      reference: specialEquipment('定期检验', 'statutory periodic inspection'),
    },
    {
      position: 'equipment',
      name: { zh: '保持特种设备档案和作业人员证件有效', en: 'Keep the special equipment register and operator licences current' },
      done: {
        zh: '每台特种设备都已办理使用登记、建立安全技术档案；叉车、起重、锅炉等作业人员都持有效证件。这一项没有“完成”，只做确认。',
        en: 'Every item of special equipment is registered for use and has its technical file, and every forklift, crane and boiler operator holds a valid licence. Never "done"; attested, not ticked.',
      },
      evidence: { zh: '特种设备台账和作业人员持证清单。', en: 'The equipment register and the operator licence list.' },
      form: 'standing',
      reference: specialEquipment('使用登记、安全技术档案和作业人员持证', 'registration, technical files and licensed operators'),
    },

    // ── 危险废物管理员 Hazardous waste custodian ───────────────────────────
    {
      position: 'waste',
      name: { zh: '每周危险废物台账核对', en: 'Weekly hazardous waste log reconciliation' },
      done: {
        zh: '核对本周各类危险废物的产生、入库、出库和库存量，台账与实物、转移联单一致。',
        en: "Reconcile this week's hazardous waste generated, stored, shipped and on hand by type, so that the log, the stock and the transfer manifests agree.",
      },
      evidence: { zh: '危险废物管理台账。', en: 'The hazardous waste log.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 4, leadDays: 2, graceDays: 1,
      reference: solidWaste('危险废物管理台账', 'hazardous waste records'),
    },
    {
      position: 'waste',
      name: { zh: '每月危险废物贮存场所检查', en: 'Monthly hazardous waste store inspection' },
      done: {
        zh: '检查贮存场所的标识、分区、防渗防漏、防雨和泄漏收集设施，确认贮存时间没有超过规定期限。',
        en: 'Inspect the store for its signs, separation, impermeable floor, rain cover and spill containment, and confirm that nothing has been kept longer than allowed.',
      },
      evidence: { zh: '贮存场所检查记录和照片。', en: 'The store inspection record and photos.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 6, leadDays: 7, graceDays: 3,
      reference: solidWaste('危险废物贮存', 'hazardous waste storage'),
    },
    {
      position: 'waste',
      name: { zh: '年度危险废物管理计划备案', en: 'Annual hazardous waste management plan filing' },
      done: {
        zh: '制定本年度危险废物管理计划（种类、产生量、贮存和处置去向），按当地要求在系统中备案，并申报上年度情况。',
        en: "Draw up this year's hazardous waste plan (types, quantities, storage and where it goes), file it as the local authority requires, and declare last year's figures.",
      },
      evidence: { zh: '备案回执和管理计划。', en: 'The filed plan and its acknowledgement.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_start', dueOffsetDays: 45, leadDays: 30, graceDays: 14,
      reference: solidWaste('危险废物管理计划和申报', 'hazardous waste management plan and declaration'),
    },
    {
      position: 'waste',
      name: { zh: '危险废物处置单位资质复核', en: 'Annual check of the licensed waste contractor' },
      done: {
        zh: '核对处置单位和运输单位的经营许可证类别、有效期和处置能力，续签处置合同。',
        en: "Check the disposer's and the haulier's licence categories, expiry dates and capacity, and renew the disposal contract.",
      },
      evidence: { zh: '许可证复印件和处置合同。', en: 'Copies of the licences and the signed contract.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -45, leadDays: 30, graceDays: 14,
      reference: solidWaste('委托持证单位利用处置', 'licensed disposal contractors'),
    },

    // ── 职业健康专员 Occupational health coordinator ───────────────────────
    {
      position: 'health',
      name: { zh: '在岗期间职业健康检查', en: 'In-service occupational health examinations' },
      done: {
        zh: '组织接触职业病危害的员工完成在岗期间职业健康检查，把结果书面告知本人；有禁忌或疑似职业病的按规定调岗和报告。',
        en: 'Have every employee exposed to an occupational hazard examined, tell each one their result in writing, and move or report anyone with a contraindication or a suspected occupational disease as the rules require.',
      },
      evidence: { zh: '体检报告、告知记录和处理记录。', en: 'The examination reports, the notices and the follow-up records.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -90, leadDays: 45, graceDays: 14,
      reference: occupationalHealth('职业健康监护', 'health surveillance'),
    },
    {
      position: 'health',
      name: { zh: '职业病危害因素检测', en: 'Workplace exposure monitoring' },
      done: {
        zh: '委托有资质的机构检测噪声、粉尘、化学毒物等职业病危害因素，结果在现场公布；超标的点位制定整改措施。',
        en: 'Have a qualified provider measure noise, dust, chemical and other exposures, post the results where people work, and plan a fix for every point over the limit.',
      },
      evidence: { zh: '检测报告、公告照片和整改措施。', en: 'The monitoring report, a photo of the posting and the fixes.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -120, leadDays: 45, graceDays: 14,
      reference: occupationalHealth('职业病危害因素定期检测', 'periodic exposure monitoring'),
    },
    {
      position: 'health',
      name: { zh: '每月劳动防护用品发放与佩戴检查', en: 'Monthly PPE issue and use check' },
      done: {
        zh: '按岗位标准发放劳动防护用品，抽查现场佩戴情况，到期或损坏的及时更换。',
        en: 'Issue PPE to each position as its standard requires, spot-check that it is worn on the floor, and replace whatever is expired or damaged.',
      },
      evidence: { zh: '发放记录和佩戴抽查记录。', en: 'The issue record and the spot-check record.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 10, leadDays: 7, graceDays: 3,
      reference: occupationalHealth('个人使用的职业病防护用品', 'personal protective equipment'),
    },
    {
      position: 'health',
      name: { zh: '职业病危害告知与警示标识检查', en: 'Quarterly hazard notice and warning sign check' },
      done: {
        zh: '检查有危害岗位的告知卡、警示标识和公告栏是否齐全、清晰、内容与最新检测结果一致。',
        en: 'Check that every hazardous workstation has its notice card, warning signs and notice board, legible and in line with the latest monitoring results.',
      },
      evidence: { zh: '检查记录和照片。', en: 'The check record and photos.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_start', dueOffsetDays: 15, leadDays: 14, graceDays: 7,
      reference: occupationalHealth('职业病危害告知和警示标识', 'hazard notices and warning signs'),
    },
    {
      position: 'health',
      name: { zh: '保持职业健康监护档案完整', en: 'Keep occupational health records complete' },
      done: {
        zh: '每名接触危害的员工都有职业健康监护档案，上岗前、在岗期间、离岗时的检查结果齐全，员工离职时可按要求提供复印件。这一项没有“完成”，只做确认。',
        en: 'Every exposed employee has a health surveillance file, complete with the pre-placement, in-service and exit results, and a leaver can be given a copy on request. Never "done"; attested, not ticked.',
      },
      evidence: { zh: '职业健康监护档案目录。', en: 'The index of health surveillance files.' },
      form: 'standing',
      reference: occupationalHealth('职业健康监护档案', 'health surveillance records'),
    },

    // ── 环保设施运行员 Environmental facilities operator ───────────────────
    {
      position: 'environment',
      name: { zh: '每日环保设施运行记录', en: 'Daily pollution-control equipment log' },
      done: {
        zh: '记录污水处理和废气治理设施的运行参数、药剂投加和异常情况；设施停运或异常的按规定报告。',
        en: "Log the wastewater and exhaust treatment plant's running readings, chemical dosing and anything abnormal; report a stoppage or a fault as the rules require.",
      },
      evidence: { zh: '环保设施运行台账。', en: 'The treatment plant running log.' },
      form: 'recurring', frequency: 'daily', dueAnchor: 'period_start', dueOffsetDays: 0, leadDays: 0, graceDays: 0,
      reference: dischargePermit('污染防治设施正常运行和台账', 'running and logging pollution controls'),
    },
    {
      position: 'environment',
      name: { zh: '排污许可自行监测', en: 'Discharge permit self-monitoring' },
      done: {
        zh: '按排污许可证载明的点位、项目和频次完成自行监测（自测或委托），数据按要求公开或上传。',
        en: "Complete the self-monitoring the discharge permit sets out (points, parameters, frequency), in-house or by a lab, and publish or upload the data as required.",
      },
      evidence: { zh: '监测报告和数据公开记录。', en: 'The monitoring reports and the publication record.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_end', dueOffsetDays: -3, leadDays: 7, graceDays: 3,
      reference: dischargePermit('自行监测', 'self-monitoring'),
    },
    {
      position: 'environment',
      name: { zh: '排污许可执行报告', en: 'Discharge permit compliance report' },
      done: {
        zh: '汇总本期的排放量、监测结果和设施运行情况，按许可证要求的频次提交执行报告。',
        en: "Total up the period's emissions, monitoring results and treatment plant running, and submit the compliance report at the frequency the permit sets.",
      },
      evidence: { zh: '提交的执行报告和回执。', en: 'The submitted report and its receipt.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_start', dueOffsetDays: 10, leadDays: 14, graceDays: 5,
      reference: dischargePermit('执行报告', 'compliance reporting'),
    },
    {
      position: 'environment',
      name: { zh: '突发环境事件应急演练', en: 'Environmental emergency drill' },
      done: {
        zh: '按突发环境事件应急预案组织一次演练（如废水超标排放、化学品泄漏进入雨水管网），检查应急物资和截流设施。',
        en: 'Run one drill against the environmental emergency plan (an off-spec discharge, a chemical spill reaching the storm drains), and check the spill kit and the shut-off valves.',
      },
      evidence: { zh: '演练记录、应急物资清单和照片。', en: 'The drill record, the spill kit list and photos.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -75, leadDays: 30, graceDays: 14,
      reference: iso14001('应急准备和响应', 'emergency preparedness and response'),
    },

    // ── 车间当班班长 Workshop shift leader ─────────────────────────────────
    {
      position: 'shift',
      name: { zh: '班前安全讲话', en: 'Pre-shift safety briefing' },
      done: {
        zh: '开班前讲清当班的作业内容、风险和防护要求，确认人员状态和劳保穿戴。',
        en: "Before the shift starts, go through the shift's work, its risks and the protection it needs, and check that everyone is fit to work and wearing their PPE.",
      },
      evidence: { zh: '班前会记录。', en: 'The briefing record.' },
      form: 'recurring', frequency: 'daily', dueAnchor: 'period_start', dueOffsetDays: 0, leadDays: 0, graceDays: 0,
      reference: workSafety('班组安全管理', 'crew-level safety management'),
    },
    {
      position: 'shift',
      name: { zh: '每周班组安全活动', en: 'Weekly crew safety session' },
      done: {
        zh: '组织一次班组安全活动：学习操作规程或事故案例，讨论本周发现的隐患和未遂事件。',
        en: "Hold one crew safety session: go over a work instruction or an incident case, and talk through this week's hazards and near misses.",
      },
      evidence: { zh: '班组安全活动记录和签到。', en: 'The session record and attendance.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 2, leadDays: 2, graceDays: 1,
      reference: iso45001('员工协商和参与', 'worker consultation and participation'),
    },
    {
      position: 'shift',
      name: { zh: '每周设备安全防护装置检查', en: 'Weekly machine guarding and interlock check' },
      done: {
        zh: '检查本班组设备的防护罩、急停按钮、安全联锁和光幕是否完好有效，失效的停机报修。',
        en: "Check every guard, emergency stop, safety interlock and light curtain on the crew's machines, and stop and report any machine where one does not work.",
      },
      evidence: { zh: '设备安全防护检查表。', en: 'The guarding checklist.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 4, leadDays: 2, graceDays: 1,
      reference: workSafety('安全设备的维护、保养和定期检测', 'maintenance and testing of safety devices'),
    },
    {
      position: 'shift',
      name: { zh: '岗位应急处置卡演练', en: 'Monthly workstation emergency card drill' },
      done: {
        zh: '在岗位上按应急处置卡演练一次，每名员工说得出、做得到本岗位的报警、停机和撤离步骤。',
        en: 'Rehearse the workstation emergency card once on the job, so that every crew member can say and do the alarm, shutdown and evacuation steps for their own post.',
      },
      evidence: { zh: '演练记录和签到。', en: 'The drill record and attendance.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_end', dueOffsetDays: -7, leadDays: 7, graceDays: 3,
      reference: workSafety('现场处置方案', 'on-site response procedures'),
    },
  ],
};
