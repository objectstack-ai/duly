// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { CatalogPack, PackText } from '../index.js';

/**
 * ISO 9001 质量管理体系周期性履职包 — the recurring duties a certified
 * quality management system runs on, as a starting catalog.
 *
 * ── What this is, and what it is not ──────────────────────────────────────
 * Generic public knowledge of what an ISO 9001 quality management system
 * does again and again: internal audits, management review, supplier
 * evaluation, calibration, nonconforming output, document review, customer
 * satisfaction. It fits a manufacturer or a service business holding the
 * certificate. It is no customer's list, it is not certification advice, and
 * it reproduces nothing of the standard but clause numbers and clause titles.
 * Every organization adapts it: its positions, its cadences, its audit
 * programme.
 *
 * ── Citations: number and title only ──────────────────────────────────────
 * Each reference is an ISO 9001:2015 clause number with its title, checked
 * against the published clause list (English) and against GB/T 19001-2016,
 * China's identical adoption (Chinese titles). The standard's own text is
 * copyrighted and appears nowhere here: every "done" and "evidence" line is
 * this pack's own plain wording. ISO 9001:2015 is cited by edition on
 * purpose; a revised edition keeps the 4–10 clause structure, and moving the
 * pack to it is a change of the `iso` helper below. Flagged for domain review
 * on the PR that added it (#136).
 *
 * ── Shape ─────────────────────────────────────────────────────────────────
 * One entry per duty, one line per column, zh-CN first because it is this
 * pack's primary language. See `../README.md` for every column.
 */

/** One ISO 9001:2015 clause (GB/T 19001-2016 in Chinese), by number and title. */
const iso = (clause: string, zh: string, en: string): PackText => ({
  zh: `GB/T 19001-2016 ${clause} ${zh}`,
  en: `ISO 9001:2015 §${clause} (${en})`,
});
/** Two clauses on one line. */
const and = (a: PackText, b: PackText): PackText => ({
  zh: `${a.zh}；${b.zh.replace('GB/T 19001-2016 ', '')}`,
  en: `${a.en}; ${b.en.replace('ISO 9001:2015 ', '')}`,
});

export const ISO_9001: CatalogPack = {
  id: 'iso-9001',
  title: { zh: 'ISO 9001 质量管理体系周期性履职', en: 'ISO 9001 quality management recurring duties' },

  positions: {
    top: { zh: '最高管理者', en: 'Top management' },
    qm: { zh: '质量经理', en: 'Quality manager' },
    auditor: { zh: '内审员', en: 'Internal auditor' },
    process: { zh: '过程负责人', en: 'Process owner' },
    production: { zh: '生产主管', en: 'Production supervisor' },
    docs: { zh: '文件管理员', en: 'Document controller' },
    supplier: { zh: '供应商质量工程师', en: 'Supplier quality engineer' },
    metrology: { zh: '计量管理员', en: 'Metrology coordinator' },
    cs: { zh: '客户服务主管', en: 'Customer service lead' },
  },

  duties: [
    // ── 最高管理者 Top management ─────────────────────────────────────────
    {
      position: 'top',
      name: { zh: '年度管理评审', en: 'Annual management review' },
      done: {
        zh: '主持一次管理评审会议，听取体系运行、目标达成、审核结果、顾客反馈、供方绩效和风险应对的汇报，作出改进、资源和体系变更的决定。',
        en: "Chair one management review: hear how the system ran, how the objectives went, the audit results, customer feedback, supplier performance and the risk actions, and decide on improvements, resources and changes to the system.",
      },
      evidence: { zh: '管理评审输入报告和会议纪要（决定、责任人、期限）。', en: 'The review input report and the minutes: each decision, its owner and its date.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -30, leadDays: 45, graceDays: 14,
      reference: iso('9.3', '管理评审', 'Management review'),
    },
    {
      position: 'top',
      name: { zh: '质量方针和质量目标年度评审', en: 'Annual quality policy and objectives review' },
      done: {
        zh: '确认质量方针仍适合组织的宗旨和环境，并为下一年度制定可测量的质量目标，分解到部门和责任人。',
        en: "Confirm the quality policy still fits the organization's purpose and situation, and set next year's measurable quality objectives, broken down to departments and owners.",
      },
      evidence: { zh: '批准的质量方针和年度质量目标分解表。', en: "The approved quality policy and the year's objectives table." },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -15, leadDays: 30, graceDays: 14,
      reference: and(iso('5.2', '方针', 'Policy'), iso('6.2', '质量目标及其实现的策划', 'Quality objectives and planning to achieve them')),
    },
    {
      position: 'top',
      name: { zh: '对质量管理体系负起领导责任', en: 'Lead the quality management system' },
      done: {
        zh: '质量方针和目标与经营方向一致，体系需要的资源到位，体系要求融入日常业务。这一项没有“完成”，只做确认。',
        en: 'The quality policy and objectives match the business direction, the system has the resources it needs, and its requirements are part of how the business actually runs. Never "done"; attested, not ticked.',
      },
      evidence: { zh: '管理评审决定的落实情况和资源配置记录。', en: 'How the management review decisions were carried out, and the resourcing records.' },
      form: 'standing',
      reference: iso('5.1', '领导作用和承诺', 'Leadership and commitment'),
    },

    // ── 质量经理 Quality manager ──────────────────────────────────────────
    {
      position: 'qm',
      name: { zh: '组织环境和相关方需求评审', en: 'Context and interested parties review' },
      done: {
        zh: '更新影响体系的内外部因素清单和相关方需求清单，标出有变化的项，判断是否需要调整体系范围、过程或风险清单。',
        en: 'Update the list of internal and external issues and the list of interested parties and their needs, mark what changed, and decide whether the scope, the processes or the risk register must change.',
      },
      evidence: { zh: '更新后的内外部因素清单和相关方需求清单。', en: 'The updated issues list and interested-parties list.' },
      form: 'recurring', frequency: 'semiannual', dueAnchor: 'period_end', dueOffsetDays: -20, leadDays: 30, graceDays: 10,
      reference: and(iso('4.1', '理解组织及其环境', 'Understanding the organization and its context'), iso('4.2', '理解相关方的需求和期望', 'Understanding the needs and expectations of interested parties')),
    },
    {
      position: 'qm',
      name: { zh: '风险和机遇登记册评审', en: 'Risk and opportunity register review' },
      done: {
        zh: '逐项复核风险和机遇登记册：新增识别到的风险，检查已定措施是否落实、是否有效，关闭已消除的项。',
        en: 'Go through the risk and opportunity register: add newly found risks, check that the agreed actions were taken and worked, and close what is gone.',
      },
      evidence: { zh: '更新后的风险和机遇登记册（措施、责任人、有效性结论）。', en: 'The updated register: actions, owners, and whether each action worked.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_end', dueOffsetDays: -10, leadDays: 14, graceDays: 7,
      reference: iso('6.1', '应对风险和机遇的措施', 'Actions to address risks and opportunities'),
    },
    {
      position: 'qm',
      name: { zh: '质量目标月度达成统计', en: 'Monthly quality objectives scorecard' },
      done: {
        zh: '收集上月各项质量目标的实际数据，与目标值比较；未达标的项要求责任部门说明原因和措施。',
        en: "Collect last month's figure for every quality objective and compare it with the target; ask the owning department for the cause and the action wherever one was missed.",
      },
      evidence: { zh: '质量目标月度统计表。', en: 'The monthly objectives scorecard.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 6, leadDays: 5, graceDays: 3,
      reference: iso('6.2', '质量目标及其实现的策划', 'Quality objectives and planning to achieve them'),
    },
    {
      position: 'qm',
      name: { zh: '季度质量数据分析报告', en: 'Quarterly quality data analysis' },
      done: {
        zh: '汇总本季度的过程绩效、产品合格率、顾客满意、供方绩效和不合格数据，分析趋势，提出需要改进的地方。',
        en: "Pull together the quarter's process performance, product conformity, customer satisfaction, supplier performance and nonconformity data, read the trends, and name what needs improving.",
      },
      evidence: { zh: '季度质量分析报告。', en: 'The quarterly quality analysis report.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_start', dueOffsetDays: 14, leadDays: 14, graceDays: 7,
      reference: iso('9.1.3', '分析与评价', 'Analysis and evaluation'),
    },
    {
      position: 'qm',
      name: { zh: '纠正措施有效性跟踪', en: 'Corrective action follow-up' },
      done: {
        zh: '检查所有未关闭的纠正措施：到期的是否完成，已完成的是否验证有效；无效的重新分析原因。',
        en: 'Go through every open corrective action: is what fell due done, and did what was done work? Reanalyse the cause of any that did not.',
      },
      evidence: { zh: '纠正措施跟踪表（原因分析、措施、验证结论）。', en: 'The corrective action log: cause, action, and the verdict on whether it worked.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_end', dueOffsetDays: -5, leadDays: 7, graceDays: 3,
      reference: iso('10.2', '不合格和纠正措施', 'Nonconformity and corrective action'),
    },
    {
      position: 'qm',
      name: { zh: '年度内部审核方案编制', en: 'Annual internal audit programme' },
      done: {
        zh: '按过程的重要性、上次审核结果和已发生的变更，排定本年度内审覆盖的过程、频次和审核员，确保审核员不审自己的工作。',
        en: "Plan the year's internal audits: which processes, how often and by whom, weighted by each process's importance, the last results and recent changes, and with no auditor auditing their own work.",
      },
      evidence: { zh: '经批准的年度内部审核方案。', en: 'The approved annual audit programme.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_start', dueOffsetDays: 14, leadDays: 30, graceDays: 14,
      reference: iso('9.2', '内部审核', 'Internal audit'),
    },
    {
      position: 'qm',
      name: { zh: '年度培训需求和能力评价', en: 'Annual competence and training needs review' },
      done: {
        zh: '对照各岗位的能力要求评价在岗人员，找出差距，制定下一年度培训计划，并评价本年度培训是否有效。',
        en: "Assess the people in each role against the role's competence requirements, find the gaps, plan next year's training, and judge whether this year's training worked.",
      },
      evidence: { zh: '岗位能力评价表和年度培训计划。', en: 'The competence assessments and the training plan.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -45, leadDays: 30, graceDays: 14,
      reference: and(iso('7.2', '能力', 'Competence'), iso('7.3', '意识', 'Awareness')),
    },
    {
      position: 'qm',
      name: { zh: '持续改进项目季度评审', en: 'Quarterly improvement project review' },
      done: {
        zh: '检查改进项目的进度和效果，把分析报告、审核和顾客反馈中发现的机会立为新项目，完成的项目确认收益。',
        en: 'Check the progress and results of the improvement projects, open new ones from what the analysis, the audits and customer feedback turned up, and confirm the benefit of the ones finished.',
      },
      evidence: { zh: '改进项目清单（状态、收益）。', en: 'The improvement project list, with status and benefit.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_end', dueOffsetDays: -3, leadDays: 14, graceDays: 7,
      reference: iso('10.3', '持续改进', 'Continual improvement'),
    },
    {
      position: 'qm',
      name: { zh: '认证监督审核准备', en: 'Certification audit preparation' },
      done: {
        zh: '在认证机构年度审核前，确认上次审核的不符合项已关闭，内审和管理评审已完成，相关记录可随时调阅。',
        en: "Before the certification body's annual visit, confirm the last visit's findings are closed, the internal audits and the management review are done, and the records are ready to show.",
      },
      evidence: { zh: '审核准备核对表和上次不符合项关闭证据。', en: "The readiness checklist and the close-out evidence for the last visit's findings." },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -60, leadDays: 30, graceDays: 14,
    },
    {
      position: 'qm',
      name: { zh: '体系变更按计划进行', en: 'Change the quality system only by plan' },
      done: {
        zh: '组织架构、过程或场所变化需要改动体系时，先评估目的和后果、资源和职责，再实施。这一项没有“完成”，只做确认。',
        en: 'When a reorganization, a new process or a new site means the system must change, its purpose, consequences, resources and responsibilities are worked out first. Never "done"; attested, not ticked.',
      },
      evidence: { zh: '变更策划记录。', en: 'The change plans.' },
      form: 'standing',
      reference: iso('6.3', '变更的策划', 'Planning of changes'),
    },

    // ── 内审员 Internal auditor ───────────────────────────────────────────
    {
      position: 'auditor',
      name: { zh: '按方案实施季度内部审核', en: 'Quarterly internal audit' },
      done: {
        zh: '按年度审核方案审核本季度排定的过程：编制检查表、现场审核、开出不符合项，并在审核后向受审部门和质量经理报告结果。',
        en: "Audit the processes the programme puts in this quarter: prepare the checklist, audit on site, raise the findings, and report the results to the audited department and the quality manager.",
      },
      evidence: { zh: '审核计划、检查表、不符合项报告和审核报告。', en: 'The audit plan, the checklist, the nonconformity reports and the audit report.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_end', dueOffsetDays: -14, leadDays: 21, graceDays: 7,
      reference: iso('9.2', '内部审核', 'Internal audit'),
    },
    {
      position: 'auditor',
      name: { zh: '内审不符合项关闭验证', en: 'Audit finding close-out check' },
      done: {
        zh: '回访到期的内审不符合项，查看整改证据，确认原因已消除后才关闭；证据不足的退回。',
        en: 'Go back to every audit finding that fell due, look at the evidence of the fix, and close it only once the cause is gone; send back the ones without enough evidence.',
      },
      evidence: { zh: '不符合项报告上的验证结论和签字。', en: "The verification verdict and sign-off on each finding." },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_end', dueOffsetDays: -3, leadDays: 7, graceDays: 3,
      reference: and(iso('9.2', '内部审核', 'Internal audit'), iso('10.2', '不合格和纠正措施', 'Nonconformity and corrective action')),
    },
    {
      position: 'auditor',
      name: { zh: '内审员能力年度确认', en: 'Annual internal auditor competence check' },
      done: {
        zh: '确认每名内审员本年度参加过审核或培训，熟悉现行体系文件和最新的审核要求；不满足的安排补训或暂停资格。',
        en: 'Confirm that every internal auditor audited or trained this year and knows the current system documents and audit requirements; retrain or suspend anyone who does not.',
      },
      evidence: { zh: '内审员名单和能力记录。', en: 'The auditor list and competence records.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -30, leadDays: 30, graceDays: 14,
      reference: iso('7.2', '能力', 'Competence'),
    },

    // ── 过程负责人 Process owner ──────────────────────────────────────────
    {
      position: 'process',
      name: { zh: '过程绩效指标月度评审', en: 'Monthly process KPI review' },
      done: {
        zh: '对照过程绩效指标检查本过程上月运行情况，偏离目标的分析原因，需要时启动纠正措施。',
        en: "Check last month's results for the process against its KPIs, find the cause of anything off target, and open a corrective action where one is needed.",
      },
      evidence: { zh: '过程绩效月报。', en: 'The monthly process performance report.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 4, leadDays: 5, graceDays: 3,
      reference: and(iso('4.4', '质量管理体系及其过程', 'Quality management system and its processes'), iso('9.1.1', '总则', 'General')),
    },
    {
      position: 'process',
      name: { zh: '不合格输出每周评审', en: 'Weekly nonconforming output review' },
      done: {
        zh: '对本周隔离的每一批不合格品或不合格服务作出处置决定（返工、让步接收、降级或报废），并确认已按决定执行。',
        en: "Decide what happens to every nonconforming batch or service held this week (rework, concession, downgrade or scrap), and confirm the decision was carried out.",
      },
      evidence: { zh: '不合格品评审单（处置决定、授权人）。', en: 'The nonconformance review forms: the decision and who authorized it.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 4, leadDays: 2, graceDays: 1,
      reference: iso('8.7', '不合格输出的控制', 'Control of nonconforming outputs'),
    },
    {
      position: 'process',
      name: { zh: '变更前评审和批准', en: 'Review and approve changes before they run' },
      done: {
        zh: '产品、工艺或服务提供方式的变更，在实施前经过评审和授权批准，结果有记录。这一项没有“完成”，只做确认。',
        en: 'Every change to a product, a process or the way a service is delivered is reviewed and authorized before it runs, and the outcome is recorded. Never "done"; attested, not ticked.',
      },
      evidence: { zh: '变更申请和评审批准记录。', en: 'The change requests and their review and approval records.' },
      form: 'standing',
      reference: iso('8.5.6', '更改控制', 'Control of changes'),
    },

    // ── 生产主管 Production supervisor ────────────────────────────────────
    {
      position: 'production',
      name: { zh: '生产过程受控日检', en: 'Daily production control check' },
      done: {
        zh: '开工后检查各工序使用的是现行作业指导书，设备和人员符合要求，规定的过程监控记录在按时填写。',
        en: 'After start-up, check that every operation works to the current work instruction, with the right equipment and qualified people, and that the required process records are being kept.',
      },
      evidence: { zh: '生产过程巡检记录。', en: 'The production round sheet.' },
      form: 'recurring', frequency: 'daily', dueAnchor: 'period_start', dueOffsetDays: 0, leadDays: 0, graceDays: 0,
      reference: iso('8.5.1', '生产和服务提供的控制', 'Control of production and service provision'),
    },
    {
      position: 'production',
      name: { zh: '产品放行记录复核', en: 'Product release record check' },
      done: {
        zh: '复核本周放行的每一批都有检验合格的证据和授权放行人签字；未完成规定检验就放行的，必须有授权批准。',
        en: 'Confirm every batch released this week has evidence it passed its checks and the signature of the person authorized to release it; anything released early carries an authorized approval.',
      },
      evidence: { zh: '放行记录。', en: 'The release records.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 1, leadDays: 2, graceDays: 1,
      reference: iso('8.6', '产品和服务的放行', 'Release of products and services'),
    },
    {
      position: 'production',
      name: { zh: '标识和可追溯性抽查', en: 'Identification and traceability spot check' },
      done: {
        zh: '在现场任抽三个批次，确认标识清楚、检验状态明确，并能从成品追到原材料批次和生产记录。',
        en: 'Pick three batches on the floor at random; confirm each is clearly identified with its inspection status, and can be traced from finished product back to material lots and production records.',
      },
      evidence: { zh: '追溯抽查记录。', en: 'The traceability spot-check record.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 9, leadDays: 7, graceDays: 3,
      reference: iso('8.5.2', '标识和可追溯性', 'Identification and traceability'),
    },
    {
      position: 'production',
      name: { zh: '生产设备预防性维护计划执行检查', en: 'Preventive maintenance plan check' },
      done: {
        zh: '核对本月到期的设备保养项目都已完成；未完成的说明原因并重新排期，影响质量的设备停用。',
        en: "Confirm every equipment maintenance task due this month was done; give a reason and a new date for any that was not, and take out of use any equipment whose condition puts quality at risk.",
      },
      evidence: { zh: '设备保养计划和保养记录。', en: 'The maintenance plan and the maintenance records.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_end', dueOffsetDays: -2, leadDays: 7, graceDays: 3,
      reference: iso('7.1.3', '基础设施', 'Infrastructure'),
    },
    {
      position: 'production',
      name: { zh: '在制品和成品防护检查', en: 'Product preservation check' },
      done: {
        zh: '检查在制品、成品的存放、包装、搬运和防护条件，确认没有损坏、混放或超期。',
        en: 'Check how work in progress and finished goods are stored, packed, handled and protected; confirm nothing is damaged, mixed up or past its date.',
      },
      evidence: { zh: '防护检查记录。', en: 'The preservation check record.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 14, leadDays: 7, graceDays: 3,
      reference: iso('8.5.4', '防护', 'Preservation'),
    },
    {
      position: 'production',
      name: { zh: '顾客和供方财产检查', en: 'Customer and supplier property check' },
      done: {
        zh: '清点在本单位保管的顾客或外部供方财产（来料、工装、图纸、数据），确认标识、保管完好；丢失或损坏的通知所有者。',
        en: 'Count the customer and supplier property in our keeping (free-issue material, tooling, drawings, data) and confirm it is marked and in good order; tell the owner of anything lost or damaged.',
      },
      evidence: { zh: '顾客财产台账和异常通知记录。', en: 'The customer property register and any notices sent.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_end', dueOffsetDays: -7, leadDays: 14, graceDays: 7,
      reference: iso('8.5.3', '顾客或外部供方的财产', 'Property belonging to customers or external providers'),
    },

    // ── 文件管理员 Document controller ────────────────────────────────────
    {
      position: 'docs',
      name: { zh: '受控文件到期评审', en: 'Controlled documents due for review' },
      done: {
        zh: '列出本月到达评审日期的受控文件，交给文件所有人评审；需要修订的进入修订流程，无需修订的更新评审日期。',
        en: 'List the controlled documents whose review date falls this month and send each to its owner; revise what needs it and re-date the rest.',
      },
      evidence: { zh: '文件评审记录和更新后的文件清单。', en: 'The review records and the updated document register.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 2, leadDays: 5, graceDays: 5,
      reference: iso('7.5.2', '创建和更新', 'Creating and updating'),
    },
    {
      position: 'docs',
      name: { zh: '现场文件版本核查', en: 'Point-of-use document check' },
      done: {
        zh: '到使用现场抽查文件，确认都是现行版本、清晰可读，作废文件已收回或明确标识。',
        en: 'Spot-check documents where they are used: current version, legible, and any obsolete copy withdrawn or clearly marked.',
      },
      evidence: { zh: '现场文件核查记录。', en: 'The point-of-use check record.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 9, leadDays: 5, graceDays: 3,
      reference: iso('7.5.3', '成文信息的控制', 'Control of documented information'),
    },
    {
      position: 'docs',
      name: { zh: '质量记录保存和处置检查', en: 'Quality record retention check' },
      done: {
        zh: '检查质量记录按规定期限保存、可检索、未损坏；超过保存期限的按规定处置并登记。',
        en: 'Check that quality records are kept for their set periods, can be found and are intact; dispose of the ones past their period as the procedure says, and log it.',
      },
      evidence: { zh: '记录清单和处置登记。', en: 'The records list and the disposal log.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_end', dueOffsetDays: -10, leadDays: 14, graceDays: 7,
      reference: iso('7.5.3', '成文信息的控制', 'Control of documented information'),
    },
    {
      position: 'docs',
      name: { zh: '外来文件有效性核查', en: 'External document currency check' },
      done: {
        zh: '核对在用的外来文件（产品标准、顾客图纸和规范、法规）是否仍为最新版本，发现更新的通知相关部门。',
        en: "Check that the external documents in use (product standards, customers' drawings and specifications, regulations) are still the latest editions, and tell the departments concerned about any that changed.",
      },
      evidence: { zh: '外来文件清单（版本、核查日期）。', en: 'The external documents list, with editions and check dates.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_start', dueOffsetDays: 20, leadDays: 14, graceDays: 7,
      reference: iso('7.5.3', '成文信息的控制', 'Control of documented information'),
    },

    // ── 供应商质量工程师 Supplier quality engineer ────────────────────────
    {
      position: 'supplier',
      name: { zh: '外部供方年度评价', en: 'Annual external provider re-evaluation' },
      done: {
        zh: '按评价准则对每一家合格供方作年度再评价（质量、交付、服务），更新合格供方名录，对不合格的限期整改或取消资格。',
        en: 'Re-evaluate every approved provider against the criteria (quality, delivery, service), update the approved list, and put any that fall short on a fix-by date or take them off it.',
      },
      evidence: { zh: '供方评价表和更新后的合格供方名录。', en: 'The evaluation forms and the updated approved-provider list.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_end', dueOffsetDays: -30, leadDays: 45, graceDays: 14,
      reference: iso('8.4.1', '总则', 'General'),
    },
    {
      position: 'supplier',
      name: { zh: '外部供方绩效月度监视', en: 'Monthly external provider scorecard' },
      done: {
        zh: '统计上月每家供方的来料合格率和准时交付率，对低于目标的发出改进要求并跟踪。',
        en: "Work out last month's incoming acceptance rate and on-time delivery for each provider, and send an improvement request to any below target, then follow it up.",
      },
      evidence: { zh: '供方月度绩效表和改进要求单。', en: 'The monthly provider scorecard and the improvement requests.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 7, leadDays: 5, graceDays: 3,
      reference: iso('8.4.2', '控制类型和程度', 'Type and extent of control'),
    },
    {
      position: 'supplier',
      name: { zh: '外购产品进货验证复核', en: 'Incoming verification review' },
      done: {
        zh: '复核本周到货的外购产品和外包服务都按规定的方式做了验证，不合格的已隔离并通知供方。',
        en: 'Confirm that every purchased product and outsourced service received this week was verified the way the control plan says, and that rejects were held and the provider told.',
      },
      evidence: { zh: '进货检验记录和退货或让步记录。', en: 'The incoming inspection records and any return or concession records.' },
      form: 'recurring', frequency: 'weekly', dueAnchor: 'period_start', dueOffsetDays: 2, leadDays: 2, graceDays: 1,
      reference: iso('8.4.2', '控制类型和程度', 'Type and extent of control'),
    },
    {
      position: 'supplier',
      name: { zh: '关键供方现场审核', en: 'Key provider on-site audit' },
      done: {
        zh: '按年度计划到关键供方现场审核一次，检查其质量控制能力，开出的问题跟踪到关闭。',
        en: "Audit one key provider on site as the year's plan sets out, check how well it controls quality, and follow its findings through to closure.",
      },
      evidence: { zh: '供方审核报告和问题跟踪记录。', en: 'The provider audit report and the findings log.' },
      form: 'recurring', frequency: 'semiannual', dueAnchor: 'period_end', dueOffsetDays: -30, leadDays: 30, graceDays: 14,
      reference: iso('8.4.2', '控制类型和程度', 'Type and extent of control'),
    },

    // ── 计量管理员 Metrology coordinator ──────────────────────────────────
    {
      position: 'metrology',
      name: { zh: '测量设备月度校准计划执行', en: 'Monthly calibration due list' },
      done: {
        zh: '列出下月到期的测量设备，按计划送检或内校；超期未校的立即停用并标识。',
        en: 'List the measuring equipment due next month and send it for calibration or calibrate it in house as planned; take anything overdue out of use at once and tag it.',
      },
      evidence: { zh: '校准计划、校准证书和停用标识记录。', en: 'The calibration plan, the certificates and the out-of-use tags.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_end', dueOffsetDays: -7, leadDays: 7, graceDays: 3,
      reference: iso('7.1.5.2', '测量溯源', 'Measurement traceability'),
    },
    {
      position: 'metrology',
      name: { zh: '失准测量设备影响评估', en: 'Out-of-tolerance impact review' },
      done: {
        zh: '复核本季度校准中发现失准的每台设备，确认已评估它上次合格校准以来测量结果的影响，并对受影响的产品采取了措施。',
        en: 'For every instrument found out of tolerance at calibration this quarter, confirm that the effect on results since its last good calibration was assessed, and that affected product was dealt with.',
      },
      evidence: { zh: '失准影响评估记录。', en: 'The out-of-tolerance assessments.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_end', dueOffsetDays: -5, leadDays: 14, graceDays: 7,
      reference: iso('7.1.5.2', '测量溯源', 'Measurement traceability'),
    },
    {
      position: 'metrology',
      name: { zh: '测量设备台账年度盘点', en: 'Annual measuring equipment inventory' },
      done: {
        zh: '把台账和现场逐台核对：每台设备有唯一编号、校准状态标识和校准周期，新增和报废的已登记。',
        en: 'Match the register against the floor instrument by instrument: each has a unique number, a calibration status label and an interval, and every new or scrapped one is logged.',
      },
      evidence: { zh: '盘点后的测量设备台账。', en: 'The checked equipment register.' },
      form: 'recurring', frequency: 'annual', dueAnchor: 'period_start', dueOffsetDays: 30, leadDays: 30, graceDays: 14,
      reference: iso('7.1.5', '监视和测量资源', 'Monitoring and measuring resources'),
    },

    // ── 客户服务主管 Customer service lead ────────────────────────────────
    {
      position: 'cs',
      name: { zh: '顾客满意度调查', en: 'Customer satisfaction survey' },
      done: {
        zh: '向主要顾客发放满意度调查或回访，统计结果，与上一次比较，把主要不满意项交给质量经理立项改进。',
        en: 'Survey or call the main customers, tally the results against the last round, and hand the main complaints to the quality manager as improvement items.',
      },
      evidence: { zh: '调查问卷、统计结果和改进项清单。', en: 'The survey, the results and the list of improvement items.' },
      form: 'recurring', frequency: 'semiannual', dueAnchor: 'period_end', dueOffsetDays: -20, leadDays: 30, graceDays: 14,
      reference: iso('9.1.2', '顾客满意', 'Customer satisfaction'),
    },
    {
      position: 'cs',
      name: { zh: '顾客投诉月度分析', en: 'Monthly customer complaint review' },
      done: {
        zh: '汇总上月所有顾客投诉和退货，确认每一项都已答复顾客，重复或严重的问题已开出纠正措施。',
        en: "Pull together last month's complaints and returns; confirm every customer got an answer, and that repeat or serious problems have a corrective action.",
      },
      evidence: { zh: '投诉台账和月度分析。', en: 'The complaint log and the monthly analysis.' },
      form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 5, leadDays: 5, graceDays: 3,
      reference: and(iso('9.1.2', '顾客满意', 'Customer satisfaction'), iso('10.2', '不合格和纠正措施', 'Nonconformity and corrective action')),
    },
    {
      position: 'cs',
      name: { zh: '交付后服务跟进', en: 'Post-delivery follow-up' },
      done: {
        zh: '检查本季度的保修、维修、退换和售后支持事项都已按承诺处理完，把发现的产品问题反馈给相关部门。',
        en: "Check that this quarter's warranty, repair, return and after-sales support cases were closed as promised, and pass the product problems they revealed to the departments concerned.",
      },
      evidence: { zh: '售后服务记录。', en: 'The after-sales service records.' },
      form: 'recurring', frequency: 'quarterly', dueAnchor: 'period_end', dueOffsetDays: -5, leadDays: 14, graceDays: 7,
      reference: and(iso('8.5.5', '交付后的活动', 'Post-delivery activities'), iso('8.2.1', '顾客沟通', 'Customer communication')),
    },
  ],
};
