// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineTranslationBundle } from '@objectstack/spec';

/**
 * 简体中文 (zh-CN) — hand-written, unlike `en.ts`, which is generated.
 *
 * `test/i18n-coverage.test.ts` compares this file's key set against the key
 * set the walk derives from the metadata, in BOTH directions: a declared label
 * missing here fails, and a key here that no longer has a source fails. So a
 * renamed field or a deleted view cannot leave a dead entry behind, and a new
 * label cannot ship untranslated.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TERMINOLOGY — decided here, not left to a translator
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Six words in this product carry meaning a literal translation loses. The
 * decisions are recorded here because they have to be CONSISTENT across 230
 * keys, and because the reasoning is not recoverable from the English string
 * alone. Sources: `docs/product/design-principles.md`, `docs/product/data-model.md`
 * and the object file headers.
 *
 * **duty → 职责**  (`duly_duty`)
 *   The recurring obligation itself — the RULE that produces tasks, attached to
 *   a person by their position. 职责 is the ordinary business word for exactly
 *   that (岗位职责), and it is a standing thing rather than a work item, which
 *   is the distinction the whole product rests on.
 *   ⛔ NOT 任务 — that is `duly_task`, one occurrence of this.
 *   ⛔ NOT 义务 — legal/moral obligation; this is an organisational one.
 *
 * **task → 任务**  (`duly_task`)
 *   ONE dispatched occurrence of a duty, for one person, for one period. 任务
 *   is unambiguous in Chinese and, paired with 职责 above, keeps the pair as
 *   distinct as "duty"/"task" is in English — which the design principle
 *   *"A duty is not a task"* requires.
 *
 * **period → 周期**, and the FIELD is 所属周期
 *   The recurrence window a task belongs to (`2026-W34`, `2026-08`, `2026-Q3`).
 *   Bare 周期 beside 频率 ("frequency") reads as the cadence rather than the
 *   window, so `duly_task.period_key` is 所属周期 — "the period it belongs to".
 *   The anchor options stay 周期开始 / 周期结束, where the window reading is
 *   unambiguous.
 *
 * **standing → 常设**  (`form: 'standing'`)
 *   A standing duty NEVER completes and NEVER generates a task — "keep the
 *   register current", "answer the duty phone". 常设 is the register of 常设
 *   机构 / 常设委员会: established permanently, by its nature not a thing that
 *   finishes.
 *   ⛔ NOT 长期 ("long-term") or 持续 ("ongoing") — both read as a task that
 *   runs for a long time, which is precisely the misreading that makes people
 *   look for the tick box. The product invariant is that there is none.
 *
 * **governed → 组织认定**  (`source IN ('catalog','assigned')`)
 *   Work the ORGANISATION put on someone — from the role catalog, or assigned
 *   by a manager — as opposed to self-declared. 组织认定 says "the organisation
 *   established it", which is the property that makes a rate over it mean
 *   something.
 *   ⛔ NOT 纳入考核 ("counted towards assessment") — accurate about the metrics
 *   and wrong about the product: Duly scores nobody, and that word would import
 *   a performance-review frame the design deliberately refuses.
 *
 * **caliber → 口径**
 *   The internal name for what `source` decides: which population a number is
 *   computed over. 口径 is the standard Chinese term (统计口径) and is the right
 *   word if it ever surfaces. No user-facing label carries it today, so no key
 *   below uses it — recorded so the next translator does not invent a second
 *   word for it.
 *
 * Supporting choices, same reasoning, less contested:
 *   business unit → 部门 · role catalog → 岗位职责库 · assignment → 指派 ·
 *   dispatch → 派发 · not moving / stagnation → 停滞 · grace → 宽限期 ·
 *   lead time → 提前天数 · self-declared → 自行申报 · skip → 跳过.
 *
 * ── One label needed judgement rather than a swap (issue #18, round 2) ────
 * `due_offset_days.label` deliberately carries arithmetic inside display text
 * — `Offset (days, 0 = anchor day)` — because the zero point is where a
 * configurer otherwise makes an off-by-one no gate can see. The parenthetical
 * has to survive as an EXPLANATION, so it is rendered
 * 「偏移天数（0 = 锚点当天）」 rather than word-for-word; "anchor day" as a
 * literal compound carries nothing in Chinese. Its help text keeps the two
 * worked examples per anchor and is translated for sense, not structure.
 */
export const dulyChinese = defineTranslationBundle({
  'zh-CN': {
    objects: {
      // ── duly_duty — 职责：产生任务的那条规则 ─────────────────────────
      duly_duty: {
        label: '职责',
        pluralLabel: '职责',
        description: '附着在某个人身上的常设义务：应做什么、多久一次、以及在每个周期内的最后期限。',
        fields: {
          name: { label: '职责' },
          description: {
            label: '“做完”的标准',
            help: '用负责人自己的话写下的验收标准。选填——没写不影响任何流程。',
          },
          form: {
            label: '形式',
            options: {
              recurring: '周期性',
              one_off: '一次性',
              // 常设：永不完成，因此永不产生任务。见文件头的术语说明。
              standing: '常设',
            },
          },
          owner: {
            label: '负责人',
            help: '有且只有一个担责的人。“由团队负责”的工作等于没人负责。',
          },
          business_unit: {
            label: '部门',
            help: '汇总口径的锚点。创建时取自负责人的岗位。',
          },
          source: {
            label: '来源',
            options: {
              catalog: '岗位职责库',
              assigned: '主管指派',
              self: '自行申报',
            },
          },
          catalog_item: {
            label: '职责库条目',
            help: '当该职责由岗位职责库实例化而来时填写，以便职责库的修改可以重新下发。',
          },
          frequency: {
            label: '频率',
            help: '周期性职责必填。常设职责禁止填写——它永不派发，频率对它没有意义（`standing_no_frequency`）。一次性职责会忽略此项，它只由人工派发一次。',
            options: {
              daily: '每日',
              weekly: '每周',
              fortnightly: '每两周',
              monthly: '每月',
              quarterly: '每季度',
              semiannual: '每半年',
              annual: '每年',
            },
          },
          due_anchor: {
            label: '到期日锚定于',
            help: '把到期日锚定在周期内部。只有周期性职责需要；常设与一次性职责应留空（且禁止填写）。',
            options: {
              period_start: '周期开始',
              period_end: '周期结束',
            },
          },
          due_offset_days: {
            label: '偏移天数（0 = 锚点当天）',
            help: '相对锚点当天的天数，锚点当天即 0。锚定“周期开始”时：0 = 周期第一天，4 = 第五天。锚定“周期结束”时：0 = 周期最后一天，-3 = 最后一天往前三天。必须是整天，且不超过锚点前后各一年——超出这个范围的是笔误，不是排期。只有周期性职责有可供偏移的周期；常设与一次性职责应留空（且禁止填写）。',
          },
          lead_days: {
            label: '提前天数',
            help: '任务提前多少天出现在负责人的清单里。到期当天才出现的任务，出现时就已经晚了。必须是整天，最多一年。只有周期性职责会带提前量派发；常设与一次性职责应留空（且禁止填写）。',
          },
          grace_days: {
            label: '宽限期（天）',
            help: '到期后经过多少天，未完成的任务才算逾期。必须是整天，最多 30 天——逾期提醒只回溯 31 天，宽限期更长会让逾期第一天落在扫描窗口之外，提醒将永远不会触发。常设职责没有任务，因此没有意义；一次性职责的任务仍然适用。',
          },
          timezone: {
            label: '时区',
            help: 'IANA 名称（例如 Europe/Berlin）。周期边界与到期日按此时区计算。',
          },
          status: {
            label: '状态',
            options: {
              active: '启用',
              paused: '暂停',
              retired: '停用',
            },
          },
          effective_from: { label: '生效日期' },
          effective_to: { label: '失效日期' },
          last_dispatched_period: {
            label: '最后派发周期',
            help: '由系统写入。派发作业将其设为它最近一次创建过任务的周期。',
          },
        },
        _views: {
          mine: { label: '我的职责' },
          standing: { label: '常设职责' },
          catalog_tree: { label: '各团队应尽的职责' },
          default: { label: '全部职责' },
        },
      },

      // ── duly_task — 任务：职责的一次派发 ────────────────────────────
      duly_task: {
        label: '任务',
        pluralLabel: '任务',
        description: '职责的一次派发：由一个人在一个周期内承担。',
        fields: {
          subject: {
            label: '任务',
            help: '派发时从职责复制而来，因此改写职责的名称不会改写历史。',
          },
          duty: {
            label: '职责',
            help: '对于从未建模成职责的一次性工作，此处为空。',
          },
          owner: { label: '负责人' },
          business_unit: {
            label: '部门',
            help: '派发时从负责人处冗余写入，使汇总在此后的人员调动中依然成立。',
          },
          assignment: {
            label: '指派',
            help: '当该任务来自主管的一次指派分发时填写。一次指派，N 个彼此独立的任务。',
          },
          source: {
            label: '来源',
            options: {
              catalog: '岗位职责库',
              assigned: '主管指派',
              self: '自行申报',
            },
          },
          period_key: {
            label: '所属周期',
            help: '一次性任务没有周期，此处为空。',
          },
          due_date: { label: '到期' },
          visible_from: {
            label: '开始显示于',
            help: '到期日减去职责的提前天数。在此之前任务已存在，但不会占用视线。',
          },
          status: {
            label: '状态',
            options: {
              open: '待办',
              in_progress: '进行中',
              done: '已完成',
              skipped: '已跳过',
              cancelled: '已取消',
            },
          },
          skip_reason: {
            label: '跳过原因',
            help: '跳过是一种正当结果——“当时装置停车，没有任何东西需要申报”。记下原因，才不会让“跳过”变成“完成”的同义词。',
          },
          completed_at: { label: '完成时间' },
          // 逾期判定的两个「盖章」字段（#52）。用「宽限期」与职责上的
          // grace_days 保持同一个词，读者才能把两处联系起来；用「派发时」
          // 而不是「当时」，是因为这里要说清楚盖的是哪一刻的章。
          late_after: {
            label: '逾期起算日',
            help: '到期日加上派发这条任务时职责给出的宽限期。过了这一天仍未完成，或在这一天之后才完成，即为逾期。此值在派发时写入一次——之后修改职责的宽限期不会改动它。',
          },
          completed_late: {
            label: '逾期完成',
            help: '完成时间晚于「逾期起算日」时为是。此值在完成的那一刻写入一次，按当时生效的宽限期判定——之后修改职责的宽限期不会改动它。',
          },
          last_update_at: { label: '最后更新' },
          note: {
            label: '备注',
            help: '选填。完成任务从不要求填写——一道举证关卡会把 5 秒钟的勾选变成 5 分钟的差事，然后这份清单就没人用了。',
          },
        },
        _views: {
          my_week: { label: '我的本周' },
          late: { label: '逾期' },
          stalled: { label: '停滞' },
          calendar: { label: '日历' },
          board: { label: '看板' },
          schedule: { label: '排期' },
          recent: { label: '最近动态' },
          by_unit: {
            label: '按部门',
            description: '仅包含待办与进行中的工作。分组计数是在已加载的这一页上算出来的——按部门的权威口径在仪表板，这个视图用于浏览。',
          },
          default: { label: '全部任务' },
        },
        _actions: {
          duly_task_complete: {
            label: '完成',
            description: '把这个任务标记为已完成。一次点击，不问任何问题——撤销也只要一次点击。',
            successMessage: '已完成。',
          },
          duly_task_undo: {
            label: '撤销',
            description: '重新打开这个任务，完成时间会一并清除。',
            successMessage: '已重新打开。',
          },
          duly_task_skip: {
            label: '跳过',
            description: '跳过是一种正当结果——当时装置停车，没有任何东西需要申报。记下原因，才不会让“跳过”变成“完成”的同义词。',
            successMessage: '已跳过。',
            params: {
              skip_reason: {
                label: '跳过原因',
                placeholder: '当时装置停车，没有任何东西需要申报',
                helpText: '会保存在这个任务上。写得短没关系，留空不行。',
              },
            },
          },
        },
      },

      // ── duly_catalog_item — 岗位职责库条目 ──────────────────────────
      duly_catalog_item: {
        label: '职责库条目',
        pluralLabel: '岗位职责库',
        description: '附着在某个岗位上的职责模板。实例化到某个人身上，生成他的职责。',
        fields: {
          name: { label: '职责' },
          description: { label: '“做完”的标准' },
          position_code: {
            label: '岗位',
            help: '该职责所属的岗位。自由文本，因此客户可以先导入职责库，之后再在平台里建模岗位。',
          },
          form: {
            label: '形式',
            options: {
              recurring: '周期性',
              one_off: '一次性',
              standing: '常设',
            },
          },
          frequency: {
            label: '频率',
            help: '周期性职责必填。常设职责禁止填写——它永不派发，频率对它没有意义（`standing_no_frequency`）。一次性职责会忽略此项，它只由人工派发一次。',
            options: {
              daily: '每日',
              weekly: '每周',
              fortnightly: '每两周',
              monthly: '每月',
              quarterly: '每季度',
              semiannual: '每半年',
              annual: '每年',
            },
          },
          due_anchor: {
            label: '到期日锚定于',
            help: '把到期日锚定在周期内部。只有周期性职责需要；常设与一次性职责应留空（且禁止填写）。',
            options: {
              period_start: '周期开始',
              period_end: '周期结束',
            },
          },
          due_offset_days: {
            label: '偏移天数（0 = 锚点当天）',
            help: '相对锚点当天的天数，锚点当天即 0。锚定“周期开始”时：0 = 周期第一天，4 = 第五天。锚定“周期结束”时：0 = 周期最后一天，-3 = 最后一天往前三天。必须是整天，且不超过锚点前后各一年。只有周期性职责有可供偏移的周期；常设与一次性职责应留空（且禁止填写）。',
          },
          lead_days: {
            label: '提前天数',
            help: '必须是整天，最多一年。只有周期性职责会带提前量派发；常设与一次性职责应留空（且禁止填写）。',
          },
          grace_days: {
            label: '宽限期（天）',
            help: '必须是整天，最多 30 天——逾期提醒只回溯 31 天，宽限期更长就永远不会触发。常设职责没有任务，因此没有意义；一次性职责的任务仍然适用。',
          },
          regulation_ref: {
            label: '依据',
            help: '这项职责所履行的条款、标准或制度。它是把一份检查清单变成一个可用于审计的答复的东西。',
          },
          active: { label: '启用' },
        },
        _views: {
          default: { label: '岗位职责库' },
        },
        _actions: {
          duly_catalog_apply_to_people: {
            label: '应用到人员',
            description: '为选中的每个人创建这个岗位应尽的职责。可以放心重复执行——已经从职责库条目获得过职责的人会被跳过，不会重复创建。',
            params: {
              position_code: {
                label: '岗位',
                placeholder: 'plant_compliance_officer',
                helpText: '与 duly_catalog_item.position_code 精确匹配。自由文本——这个岗位不需要事先在平台里建模。',
              },
              users: {
                label: '人员',
                helpText: '每个人都会得到这个岗位职责库中每一条启用职责的独立副本。',
              },
            },
          },
        },
      },

      // ── duly_assignment — 指派：一件工作分发给若干人 ─────────────────
      duly_assignment: {
        label: '指派',
        pluralLabel: '指派',
        description: '一件交给若干人的工作，分发成彼此独立的任务。',
        fields: {
          subject: { label: '指派' },
          description: { label: '说明' },
          assigner: { label: '指派人' },
          assignees: {
            label: '指派给',
            help: '每一个名字都会变成一个彼此独立的任务。',
          },
          due_date: { label: '到期' },
          status: {
            label: '状态',
            options: {
              draft: '草稿',
              dispatched: '已派发',
              closed: '已关闭',
            },
          },
          needs_collection: {
            label: '全部完成后我需要跟进',
            help: '只有勾选了这一项，指派人才会得到一个属于自己的任务。否则，指派工作的主管不会因此给自己添一份待办清单。',
          },
          task_count: { label: '任务数' },
        },
        _views: {
          sent_by_me: { label: '我发出的' },
          default: { label: '指派' },
        },
      },

      // ── duly_log_entry — 工作日志：日历，而不是清单 ──────────────────
      duly_log_entry: {
        label: '工作记录',
        pluralLabel: '工作日志',
        description: '个人完成工作的记录。从不评分、从不排名、从不比较。',
        fields: {
          subject: { label: '你做了什么' },
          detail: { label: '详情' },
          owner: { label: '负责人' },
          logged_on: { label: '日期' },
          category: {
            label: '类别',
            options: {
              coordination: '跨团队协作',
              drafting: '起草／撰写',
              incident: '突发／计划外',
              meeting: '会议',
              support: '支援他人',
              other: '其他',
            },
          },
          visibility: {
            label: '可见范围',
            help: '默认仅自己可见。一份让人有顾虑的日志，没有人会认真记。',
            options: {
              private: '仅自己',
              manager: '我的主管',
            },
          },
          related_task: {
            label: '关联任务',
            help: '选填。把一条记录挂到某个组织认定的职责上，同时不让这条记录进入它的任何计分。',
          },
        },
        _views: {
          default: { label: '工作日志' },
        },
      },
    },

    apps: {
      duly_app: {
        // 产品名保持原样：Duly 是品牌，不翻译。
        label: 'Duly',
        navigation: {
          group_me: { label: '我的工作' },
          nav_my_week: { label: '我的本周' },
          nav_my_duties: { label: '我的职责' },
          nav_standing: { label: '常设职责' },
          nav_log: { label: '工作日志' },
          nav_board: { label: '看板' },
          group_team: { label: '团队' },
          nav_duty_health: { label: '职责健康度' },
          nav_late: { label: '逾期' },
          nav_stalled: { label: '停滞' },
          nav_assignments: { label: '指派' },
          nav_schedule: { label: '排期' },
          nav_recent: { label: '最近动态' },
          nav_by_unit: { label: '按部门' },
          group_setup: { label: '设置' },
          nav_catalog: { label: '岗位职责库' },
          nav_all_duties: { label: '全部职责' },
          nav_catalog_tree: { label: '各团队应尽的职责' },
        },
      },
    },

    dashboards: {
      duly_duty_health: {
        label: '职责健康度',
        description: '仅统计组织认定的职责——来自岗位职责库与主管指派的工作；自行申报的职责不计入这里的任何数字。按期与否，按每条任务派发当时自身的宽限期判定；分母只含已完成的工作——未完成的工作由「停滞」几块指标回答。',
        widgets: {
          not_moving_14d: {
            title: '停滞',
            description: '超过 14 天没有任何动静的、组织认定的待办任务。仅统计组织认定的职责，自行申报的工作不计入。',
          },
          not_moving_30d: {
            title: '停滞超过 30 天',
            description: '这是旁边那块指标的子集，不能与它相加。',
          },
          oldest_touch: {
            title: '最久未动的任务',
            description: '最停滞的那个待办任务上一次有动静的时间——是一个日期，不是一个分数。',
          },
          // 「按期率」用 #52 的原词。分母写清楚是「已完成」，是因为读者若
          // 默认分母是「应完成」，同一块指标会读出完全不同的数。
          on_time_rate: {
            title: '按期率',
            description: '在各自宽限期内完成的、组织认定的任务，占已完成的组织认定任务的比例。未完成的工作不计入这里。',
          },
          // 「逾期项」是方案 p8/p20 四卡之一。口径写全：判的是任务自身的逾期
          // 时点（派发当时按各自职责的宽限期钉住），不是「过了到期日」。
          overdue: {
            title: '逾期项',
            description: '已过自身逾期时点、仍未完成的组织认定任务。逾期时点 = 到期日 + 该条职责在派发当时给的宽限期。',
          },
          // 「清单完备度」按 review_status 计数，绝不按条目数——「谁的清单条目
          // 少」是产品明令禁止的排名。副标「N 条待确认 / M 条待审定」当前渲染
          // 不出来（平台缺口，见仪表盘文件头），所以这里不用静态文字假装有。
          list_completeness: {
            title: '清单完备度',
            description: '已审定的职责占组织认定职责清单的比例。已退役的职责分子分母都不计；暂停的职责仍然是欠着的，计入。',
          },
          not_moving_by_unit: {
            title: '停滞情况（按部门）',
            description: '各部门超过 14 天没有动静的、组织认定的待办任务。部门按名称排序，绝不按数量排序。',
          },
          coming_up: {
            title: '即将到期',
            description: '未来 14 天内到期的、组织认定的任务，按周分组。',
          },
          overdue_by_unit: {
            title: '各部门逾期项分布',
            description: '各部门已过自身逾期时点、仍未完成的组织认定任务。部门按名称排序，绝不按数量排序。',
          },
          // 方案 p20 的口径说明原话：「完成率只统计重复事项」。这张图数的是
          // 职责不是任务——常设职责永远不产生任务，所以它只在这里露面。
          work_mix: {
            title: '本月工作构成',
            description: '组织认定的职责清单按形态划分。这里数的是职责，不是任务——常设职责永远不产生任务；完成率只统计重复事项。',
          },
        },
      },
    },

    globalActions: {
      duly_catalog_apply: {
        label: '应用岗位职责库',
        description: '为选中的每个人创建这个岗位应尽的职责。可以放心重复执行——已经从职责库条目获得过职责的人会被跳过，不会重复创建。',
        params: {
          position_code: {
            label: '岗位',
            // 岗位代码是数据值，不翻译：它要与 duly_catalog_item.position_code 精确匹配。
            placeholder: 'plant_compliance_officer',
            helpText: '与 duly_catalog_item.position_code 精确匹配。自由文本——这个岗位不需要事先在平台里建模。',
          },
          users: {
            label: '人员',
            helpText: '每个人都会得到这个岗位职责库中每一条启用职责的独立副本。',
          },
        },
      },
      duly_catalog_sync: {
        label: '按职责库同步职责',
        description: '把岗位职责库中的节奏变更重新下发到由它创建的职责上。负责人、状态、时区与生效区间不受影响；来自已停用职责库条目的职责只会被报告，绝不会被删除。',
        params: {
          position_code: {
            label: '岗位',
            placeholder: 'plant_compliance_officer',
            helpText: '把同步限定在一个岗位。留空则同步每一条来自职责库的职责。',
          },
        },
      },
    },
  },
});
