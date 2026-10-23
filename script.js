/* =========================================================
   活动小本本 · 逻辑
   代码分六段，从上往下读：
     ① 常量        ② 日期工具      ③ 数据读写
     ④ 渲染界面    ⑤ 交互动作      ⑥ 启动
   没有用任何第三方库，全部是浏览器自带的能力。
   ========================================================= */


/* ---------- ① 常量 ---------- */

const STORAGE_KEY = 'campus_events_v1';     // 活动数据
const DELETED_KEY = 'campus_deleted_v1';    // 已删除的活动（历史里可以恢复）
const TAGS_KEY = 'campus_tags_v1';          // 类别列表（可以自己增删）
const LAST_TAG_KEY = 'campus_last_tag_v1';  // 记住上次选过的类别
const DEFAULT_TAGS = ['讲座', '比赛', '演出', '志愿'];
const FALLBACK_TAG = '未分类';              // 删掉某个类别后，原来的活动落到这里
const MAX_TAGS = 8;                         // 最多允许几个自定义类别
const UNDO_SECONDS = 5;                     // 删除后可撤销的秒数

// 活动的三种状态。点卡片上的状态按钮，就按这个顺序轮换。
const STATUSES = ['todo', 'doing', 'done'];
const STATUS_LABEL = { todo: '未开始', doing: '进行中', done: '已完成' };

// 类别配色：按类别在列表里的顺序取色。都选得够深，白字能看清。
// 这样颜色是「有含义的」——同一个类别到哪儿都是同一个颜色，不是随机撞色。
const TAG_COLORS = ['#2b2bff', '#c2185b', '#0a7d4f', '#a05a00', '#6a1fb0', '#b3261e'];

/** 给一个元素挂上它对应的类别颜色（元素没有 style 就跳过，方便测试） */
function setTagColor(el, tag) {
  if (!el.style || typeof el.style.setProperty !== 'function') return;
  const i = tags.indexOf(tag);
  el.style.setProperty('--tag-c', i >= 0 ? TAG_COLORS[i % TAG_COLORS.length] : '#666666');
}

/** 读一条活动的状态。老数据没有 status 字段，一律当成「未开始」。 */
function statusOf(ev) {
  return ev.status || 'todo';
}


/* ---------- ② 日期工具 ---------- */

/**
 * 返回今天的日期，格式固定为 "YYYY-MM-DD"。
 * 不用 toISOString()，因为它按 UTC 算，在东八区会差 8 小时导致日期错一天。
 */
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 返回"今天往后 n 天"的日期字符串。n 可以是负数（表示往前）。
 * 示例数据用它，这样不管哪天打开，示例都跨在"未来"和"过去"两边。
 */
function dateOffsetStr(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 算某个日期距离今天还有几天。
 * 正数 = 未来，0 = 今天，负数 = 已经过去几天。
 * 做法：把两端的年月日都换算成 UTC 零点再相减，避免时区和夏令时的干扰。
 */
function daysFromToday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);

  const [ty, tm, td] = todayStr().split('-').map(Number);
  const today = Date.UTC(ty, tm - 1, td);

  return Math.round((target - today) / 86400000);  // 86400000 = 一天的总毫秒数
}

/** 把天数差变成给人看的一句话 */
function dayLabel(diff) {
  if (diff === 0) return '今天';
  if (diff > 0) return `还剩 ${diff} 天`;
  return `已过期 ${-diff} 天`;
}


/* ---------- ③ 数据读写 ---------- */

/**
 * 从浏览器本地读出全部活动。
 * 任何异常（没有数据 / 内容损坏 / 格式不对）都按空列表处理，绝不让页面白屏。
 */
function loadEvents() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('存的不是数组');
    return parsed;
  } catch (err) {
    showWarn('本地数据读取异常，已按空列表显示。原有数据没有被删除。');
    return [];
  }
}

/** 把全部活动写回浏览器本地 */
function saveEvents() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

/** 读出「已删除」的历史（删掉的活动收在这里，不直接消失） */
function loadDeleted() {
  const raw = localStorage.getItem(DELETED_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function saveDeleted() {
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify(deleted));
  } catch (err) {
    /* 存不下就算了，别影响别的功能 */
  }
}

/** 记住上次用的类别，下次打开表单默认就选它 */
function saveLastTag(tag) {
  try { localStorage.setItem(LAST_TAG_KEY, tag); } catch (err) { /* 记不住就算了 */ }
}

function loadLastTag() {
  try {
    const tag = localStorage.getItem(LAST_TAG_KEY);
    return tags.includes(tag) ? tag : tags[0];
  } catch (err) {
    return tags[0];
  }
}

/**
 * 读出类别列表。
 * 没存过 → 用默认那四个；存坏了 → 也退回默认。绝不让页面白屏。
 */
function loadTags() {
  const raw = localStorage.getItem(TAGS_KEY);
  if (!raw) return DEFAULT_TAGS.slice();

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('存的不是数组');
    const cleaned = parsed.filter(t => typeof t === 'string' && t.trim() !== '');
    return cleaned.length > 0 ? cleaned : DEFAULT_TAGS.slice();
  } catch (err) {
    showWarn('本地类别数据读取异常，已改用默认类别。原有数据没有被删除。');
    return DEFAULT_TAGS.slice();
  }
}

function saveTags() {
  localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
}

/** 这个类别下现在有几条活动 */
function tagUsage(tag) {
  return events.filter(e => e.tag === tag).length;
}

/**
 * 列表上方要显示哪些筛选按钮：
 * 「全部」+ 自定义的类别 +（只有当真的有活动挂在「未分类」下时才显示它）
 */
function filterList() {
  const list = ['全部'].concat(tags);
  if (events.some(e => e.tag === FALLBACK_TAG)) list.push(FALLBACK_TAG);
  return list;
}

/**
 * 保证每个活动的类别都真实存在：
 * 不属于任何自定义类别、也不是「未分类」的，一律归到「未分类」。
 * （删类别时已经处理过，这里是兜底，防止旧数据出现"孤儿类别"。）
 */
function normalizeEventTags() {
  let changed = false;
  events.forEach(e => {
    if (e.tag !== FALLBACK_TAG && !tags.includes(e.tag)) {
      e.tag = FALLBACK_TAG;
      changed = true;
    }
  });
  if (changed) saveEvents();
}


/* ---------- ④ 渲染界面 ---------- */

/** 顶部统计："共 N 条 · 即将到来 M 条 · 已完成 K 条" */
function renderStats() {
  // 「即将到来」只数还没做完的——做完了就不该再占着提醒的位置
  const upcoming = events.filter(e => statusOf(e) !== 'done' && daysFromToday(e.date) >= 0).length;
  const doneCount = events.filter(e => statusOf(e) === 'done').length;

  document.getElementById('stats').textContent =
    `共 ${events.length} 条 · 即将到来 ${upcoming} 条 · 已完成 ${doneCount} 条`;
}

/** 表单里的类别按钮（内容跟着自定义列表走） */
function renderTagPicker() {
  const box = document.getElementById('tag-picker');
  box.innerHTML = '';

  tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-btn' + (tag === currentTag ? ' active' : '');
    btn.textContent = tag;
    setTagColor(btn, tag);
    btn.addEventListener('click', () => {
      currentTag = tag;
      saveLastTag(tag);
      renderTagPicker();
    });
    box.appendChild(btn);
  });
}

/** 列表上方的筛选按钮 */
function renderFilters() {
  const box = document.getElementById('filters');
  box.innerHTML = '';

  filterList().forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter' + (tag === currentFilter ? ' active' : '');
    btn.textContent = tag;
    setTagColor(btn, tag);
    btn.addEventListener('click', () => {
      currentFilter = tag;
      renderFilters();
      renderList();
    });
    box.appendChild(btn);
  });
}

/** "HH:MM" → 分钟数 */
function hmToMin(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 活动占用的时间段（分钟）；没填开始时间的返回 null（全天不参与撞车判断） */
function eventRange(ev) {
  const start = hmToMin(ev.startTime);
  if (start === null) return null;
  const end = hmToMin(ev.endTime);
  // 没填结束时间就按 1 小时算，够用来判断重不重叠
  return { start: start, end: end === null ? start + 60 : Math.max(end, start + 1) };
}

/**
 * 找出时间撞车的活动：同一天、时间段有交集、都还没完成。
 * 返回 Map<活动id, 和它撞车的活动数组>
 */
function findConflicts(list) {
  const byDate = new Map();
  (list || []).forEach(ev => {
    if (statusOf(ev) === 'done') return;
    if (!eventRange(ev)) return;
    if (!byDate.has(ev.date)) byDate.set(ev.date, []);
    byDate.get(ev.date).push(ev);
  });

  const map = new Map();
  byDate.forEach(dayList => {
    for (let i = 0; i < dayList.length; i++) {
      for (let j = i + 1; j < dayList.length; j++) {
        const a = eventRange(dayList[i]);
        const b = eventRange(dayList[j]);
        if (!a || !b) continue;
        if (a.start < b.end && b.start < a.end) {
          if (!map.has(dayList[i].id)) map.set(dayList[i].id, []);
          if (!map.has(dayList[j].id)) map.set(dayList[j].id, []);
          map.get(dayList[i].id).push(dayList[j]);
          map.get(dayList[j].id).push(dayList[i]);
        }
      }
    }
  });
  return map;
}

/** 造一张活动卡片的 DOM */
function buildCard(ev, diff) {
  const card = document.createElement('div');
  const st = statusOf(ev);
  card.id = 'card-' + ev.id;          // 删除时要靠这个找到它做退场动画
  // 已完成的整体变淡 + 划线；没完成但日期过了的，变灰
  card.className = 'card' + (st === 'done' ? ' done' : (diff < 0 ? ' past' : ''));
  if (ev.id === lastSavedId) card.classList.add('flash');

  const main = document.createElement('div');
  main.className = 'card-main';

  const title = document.createElement('p');
  title.className = 'card-title';
  title.textContent = ev.title;

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  const day = document.createElement('span');
  day.className = 'card-day' + (diff >= 0 && diff <= 3 ? ' soon' : '');
  day.textContent = dayLabel(diff);

  const date = document.createElement('span');
  date.textContent = ev.date;

  const tag = document.createElement('span');
  tag.className = 'card-tag';
  tag.textContent = '#' + ev.tag;
  setTagColor(tag, ev.tag);

  meta.append(day, date);

  // 填了具体时间的，在日期后面补一段「14:00」或「14:00–16:00」
  if (ev.startTime) {
    const time = document.createElement('span');
    time.className = 'card-time';
    time.textContent = ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime;
    meta.appendChild(time);
  }

  meta.appendChild(tag);

  // 和别的活动时间撞上了：给个琥珀色小标，悬停能看是哪几条
  const clash = conflictMap && conflictMap.get(ev.id);
  if (clash && clash.length) {
    const badge = document.createElement('span');
    badge.className = 'card-clash';
    badge.textContent = '撞车';
    badge.title = '时间重叠：' + clash.map(x => x.title).join('、');
    meta.appendChild(badge);
  }

  main.append(title, meta);

  if (ev.note) {
    const note = document.createElement('p');
    note.className = 'card-note';
    note.textContent = ev.note;

    // 备注太长（比如整段群消息原文）就折起来，别把卡片撑得老高。
    // 展开状态记在 expandedNotes 里，这样列表重画之后还是展开的。
    const isLong = ev.note.length > 40;
    const isOpen = expandedNotes.has(ev.id);

    if (isLong) {
      if (!isOpen) note.classList.add('clamped');
      main.appendChild(note);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'note-toggle';
      toggle.textContent = isOpen ? '收起' : '展开';
      toggle.addEventListener('click', () => {
        const wasClamped = note.classList.contains('clamped');
        note.classList.toggle('clamped', !wasClamped);
        toggle.textContent = wasClamped ? '收起' : '展开';

        if (wasClamped) {
          // 展开的那一下闪一下，让眼睛跟得上（只在真点「展开」时触发）
          note.classList.remove('note-flash');
          void note.offsetWidth;       // 强制重排，动画才会重新播
          note.classList.add('note-flash');
          expandedNotes.add(ev.id);
        } else {
          note.classList.remove('note-flash');
          expandedNotes.delete(ev.id);
        }
      });
      main.appendChild(toggle);
    } else {
      main.appendChild(note);
    }
  }

  // 右边一列按钮：状态切换 + 删除
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const statusBtn = document.createElement('button');
  statusBtn.type = 'button';
  statusBtn.className = 'status-btn status-' + st;
  statusBtn.textContent = STATUS_LABEL[st];
  statusBtn.title = '点一下换下一个状态';
  statusBtn.addEventListener('click', () => cycleStatus(ev));

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'card-edit';
  edit.textContent = '编辑';
  edit.addEventListener('click', () => startEdit(ev));

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'card-del';
  del.textContent = '删除';
  del.addEventListener('click', () => askDelete(ev));

  const btnRow = document.createElement('div');
  btnRow.className = 'card-btns';
  btnRow.append(edit, del);

  actions.append(statusBtn, btnRow);
  card.append(main, actions);
  return card;
}

/** 一条活动能被哪些写法搜到（日期要支持「10-25」「10月25」「2026/10/25」） */
function searchForms(ev) {
  const [y, m, d] = ev.date.split('-');
  const forms = [
    ev.date,
    y + '/' + m + '/' + d,
    (+m) + '月' + (+d) + '日',
    (+m) + '月' + (+d),
    (+m) + '-' + (+d),
    (+m) + '/' + (+d),
    m + d,
    y
  ];
  return forms.join(' ').toLowerCase();
}

/** 这条活动能不能匹配搜索词：多个词是「都要有」的关系 */
function matchesSearch(ev, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;

  const hay = [
    ev.title,
    ev.note,
    ev.tag,
    ev.startTime,
    ev.endTime,
    STATUS_LABEL[statusOf(ev)]
  ].filter(Boolean).join(' ').toLowerCase();

  const dates = searchForms(ev);

  return tokens.every(t => hay.indexOf(t) !== -1 || dates.indexOf(t) !== -1);
}

/** 渲染列表：按当前视图分「待办」和「历史」两套 */
function renderList() {
  const box = document.getElementById('list');
  box.innerHTML = '';

  // 时间撞车先算一遍，卡片上要用
  conflictMap = findConflicts(events);

  // 三个筛选条件叠加：类别（上面那排按钮）+ 某一天（日历点出来的）+ 搜索框
  const shown = events
    .filter(e => currentFilter === '全部' || e.tag === currentFilter)
    .filter(e => dayFilter === '' || e.date === dayFilter)
    .filter(e => matchesSearch(e, searchQuery));

  // 同一天里再按时间排；没填时间的（'99:99'）排最后
  const timeKey = e => e.startTime || '99:99';
  const timeAsc = (a, b) => timeKey(a).localeCompare(timeKey(b));
  const timeDesc = (a, b) => timeKey(b).localeCompare(timeKey(a));

  if (view === 'history') {
    renderHistory(box, shown, timeDesc);
  } else {
    renderActive(box, shown, timeAsc);
  }
}

/** 待办视图：只留「还没做完 + 日期今天及以后」，列表才干净 */
function renderActive(box, shown, timeAsc) {
  const todo = shown
    .filter(e => statusOf(e) !== 'done' && daysFromToday(e.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date) || timeAsc(a, b) || a.createdAt - b.createdAt);

  document.getElementById('filter-count').textContent =
    `当前 ${todo.length} 条` + (searchQuery.trim() ? `（搜「${searchQuery.trim()}」）` : '');

  if (todo.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';

    const strong = document.createElement('strong');
    const tip = document.createElement('p');
    tip.className = 'empty-tip';

    if (events.length === 0 && deleted.length === 0) {
      // 空状态 A：一条记录都还没有
      strong.textContent = '还没有任何活动';
      tip.textContent = '在上面记一条，或者点「载入示例数据」看看效果。';
      empty.append(strong, tip);
    } else if (searchQuery.trim() !== '') {
      // 空状态 B0：搜索没结果
      strong.textContent = `没搜到「${searchQuery.trim()}」`;
      tip.textContent = `全部里一共有 ${events.length} 条，换个词试试（名称、备注、类别、日期都能搜）。`;

      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'btn-ghost';
      clear.textContent = '清空搜索';
      clear.addEventListener('click', () => {
        searchQuery = '';
        const box = document.getElementById('search-input');
        if (box) box.value = '';
        const x = document.getElementById('search-clear');
        if (x) x.hidden = true;
        renderAll();
      });

      empty.append(strong, tip, clear);
    } else if (dayFilter !== '' || currentFilter !== '全部') {
      // 空状态 B：当前筛选下没有
      strong.textContent = dayFilter !== ''
        ? `${formatDateCN(dayFilter)} 这天没有活动`
        : `「${currentFilter}」下没有活动`;
      tip.textContent = `全部里一共有 ${events.length} 条。`;

      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn-ghost';
      back.textContent = '看全部';
      back.addEventListener('click', () => {
        currentFilter = '全部';
        dayFilter = '';
        renderAll();
      });

      empty.append(strong, tip, back);
    } else {
      // 空状态 C：待办清空了
      strong.textContent = '待办清空了';
      tip.textContent = '做完的、过期的、删掉的都收进了「历史」，点上面的「历史」能看到。';
      empty.append(strong, tip);
    }

    box.appendChild(empty);
    return;
  }

  // 过期的收在「历史」里，但待办页给个琥珀色入口，不然容易忘
  const overdueCount = events.filter(e => statusOf(e) !== 'done' && daysFromToday(e.date) < 0).length;
  if (overdueCount > 0) {
    const hint = document.createElement('button');
    hint.type = 'button';
    hint.className = 'overdue-hint';
    hint.textContent = '有 ' + overdueCount + ' 条已经过期、还没做完 → 去历史里处理';
    hint.addEventListener('click', () => setView('history'));
    box.appendChild(hint);
  }

  box.appendChild(groupTitle('即将到来', todo.length));
  todo.forEach(ev => box.appendChild(buildCard(ev, daysFromToday(ev.date))));}

/** 历史视图：已完成 / 已过期 / 已删除 */
function renderHistory(box, shown, timeDesc) {
  const done = shown
    .filter(e => statusOf(e) === 'done')
    .sort((a, b) => b.date.localeCompare(a.date) || timeDesc(a, b) || b.createdAt - a.createdAt);

  const expired = shown
    .filter(e => statusOf(e) !== 'done' && daysFromToday(e.date) < 0)
    .sort((a, b) => b.date.localeCompare(a.date) || timeDesc(a, b) || b.createdAt - a.createdAt);

  const removed = deleted
    .filter(e => currentFilter === '全部' || e.tag === currentFilter)
    .filter(e => dayFilter === '' || e.date === dayFilter)
    .filter(e => matchesSearch(e, searchQuery))
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

  const total = done.length + expired.length + removed.length;
  document.getElementById('filter-count').textContent =
    `历史 ${total} 条` + (searchQuery.trim() ? `（搜「${searchQuery.trim()}」）` : '');

  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const strong = document.createElement('strong');
    const tip = document.createElement('p');
    tip.className = 'empty-tip';
    strong.textContent = '历史是空的';
    tip.textContent = '做完的、过期的、删掉的都会收在这里，不会直接消失。';
    empty.append(strong, tip);
    box.appendChild(empty);
    return;
  }

  if (done.length > 0) {
    box.appendChild(groupTitle('已完成', done.length));
    done.forEach(ev => box.appendChild(buildCard(ev, daysFromToday(ev.date))));
  }

  if (expired.length > 0) {
    box.appendChild(groupTitle('已过期', expired.length));
    expired.forEach(ev => box.appendChild(buildCard(ev, daysFromToday(ev.date))));
  }

  if (removed.length > 0) {
    box.appendChild(groupTitle('已删除', removed.length));
    removed.forEach(ev => box.appendChild(buildDeletedCard(ev)));
  }
}

/** 已删除的那张卡：只能恢复或彻底删除 */
function buildDeletedCard(ev) {
  const card = document.createElement('div');
  card.className = 'card done deleted';
  card.id = 'card-' + ev.id;

  const main = document.createElement('div');
  main.className = 'card-main';

  const title = document.createElement('p');
  title.className = 'card-title';
  title.textContent = ev.title;

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  const date = document.createElement('span');
  date.textContent = ev.date;

  const tag = document.createElement('span');
  tag.className = 'card-tag';
  tag.textContent = '#' + ev.tag;
  setTagColor(tag, ev.tag);

  meta.append(date, tag);
  main.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'card-edit';
  restore.textContent = '恢复';
  restore.addEventListener('click', () => restoreDeleted(ev));

  const purge = document.createElement('button');
  purge.type = 'button';
  purge.className = 'card-del';
  purge.textContent = '彻底删除';
  purge.addEventListener('click', () => purgeDeleted(ev));

  const row = document.createElement('div');
  row.className = 'card-btns';
  row.append(restore, purge);

  actions.append(row);
  card.append(main, actions);
  return card;
}

/** 从历史里把删掉的活动放回来 */
function restoreDeleted(ev) {
  deleted = deleted.filter(d => d.id !== ev.id);
  saveDeleted();

  const back = Object.assign({}, ev);
  delete back.deletedAt;
  events.push(back);

  saveEvents();
  normalizeEventTags();
  renderAll();
}

/** 彻底删除（不可撤销） */
function purgeDeleted(ev) {
  if (!confirm(`彻底删除「${ev.title}」吗？\n\n这一步不能撤销。`)) return;
  deleted = deleted.filter(d => d.id !== ev.id);
  saveDeleted();
  renderList();
}

function groupTitle(text, count) {
  const p = document.createElement('p');
  p.className = 'group-title';
  p.textContent = `${text}（${count}）`;
  return p;
}

/** 切换「待办 / 历史」两个视图 */
function setView(v) {
  view = v;
  const a = document.getElementById('tab-active');
  const h = document.getElementById('tab-history');
  if (a && a.classList) a.classList.toggle('active', v === 'active');
  if (h && h.classList) h.classList.toggle('active', v === 'history');
  renderList();
}

/** 把几块界面一起重画（小本本和日历是同一份数据的两种看法） */
function renderAll() {
  renderStats();
  renderFilters();     // 类别增删后筛选按钮也要跟着变
  renderList();
  renderDayChip();     // 上面那个「只看某天」的小标签
  renderCalendar();
  renderTodayPanel();  // 左栏日历下面的「今天 · 明天」
}

/** 顶部那条黄色警告（只在数据读不出来时显示） */
function showWarn(text) {
  const bar = document.getElementById('warn-bar');
  bar.textContent = text;
  bar.hidden = false;
}


/* ---------- ④之二 管理类别 ---------- */

/** 画出「管理类别」弹窗里的那一列 */
function renderTagManage() {
  const box = document.getElementById('tag-manage-list');
  box.innerHTML = '';

  tags.forEach(tag => {
    const row = document.createElement('div');
    row.className = 'tag-manage-row';

    const left = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'tag-manage-name';
    name.textContent = tag;
    left.appendChild(name);

    const n = tagUsage(tag);
    if (n > 0) {
      const count = document.createElement('span');
      count.className = 'tag-manage-count';
      count.textContent = `${n} 条活动在用`;
      left.appendChild(count);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tag-manage-del';
    del.textContent = '删除';
    del.addEventListener('click', () => deleteTag(tag));

    row.append(left, del);
    box.appendChild(row);
  });
}

/** 点「添加」 */
function addTag() {
  const input = document.getElementById('input-new-tag');
  const err = document.getElementById('tag-error');
  const name = input.value.trim();

  err.textContent = '';

  if (name === '') {
    err.textContent = '请输入类别名称';
    input.focus();
    return;
  }
  if (name === FALLBACK_TAG) {
    err.textContent = `「${FALLBACK_TAG}」是系统保留的，不能手动添加`;
    input.focus();
    return;
  }
  if (tags.includes(name)) {
    err.textContent = `已经有「${name}」了，不用重复添加`;
    input.focus();
    return;
  }
  if (tags.length >= MAX_TAGS) {
    err.textContent = `最多只能有 ${MAX_TAGS} 个类别，先删一个再加`;
    return;
  }

  tags.push(name);
  saveTags();

  input.value = '';
  renderTagManage();
  renderTagPicker();
  renderFilters();
  renderList();
}

/**
 * 点某个类别后面的「删除」。
 * 关键设计：如果有活动正在用这个类别，不阻止删除，而是把它们挪到「未分类」——
 * 因为本项目没有「编辑活动」功能，硬拦着会让人卡在死胡同里（改不了、也删不掉）。
 */
function deleteTag(tag) {
  const err = document.getElementById('tag-error');
  err.textContent = '';

  if (tags.length <= 1) {
    err.textContent = '至少要保留一个类别，不能全删光';
    return;
  }

  const n = tagUsage(tag);

  if (n > 0) {
    const ok = confirm(
      `有 ${n} 条活动正在用「${tag}」这个类别。\n\n` +
      `删除后，它们会变成「${FALLBACK_TAG}」——活动本身不会丢。\n\n` +
      `确定删除「${tag}」吗？`
    );
    if (!ok) return;

    events.forEach(e => { if (e.tag === tag) e.tag = FALLBACK_TAG; });
    saveEvents();
  } else {
    if (!confirm(`确定删除类别「${tag}」吗？`)) return;
  }

  tags = tags.filter(t => t !== tag);
  saveTags();

  // 当前筛选 / 表单选中的正好是被删掉的那个，就退回安全位置
  if (currentFilter === tag) currentFilter = '全部';
  if (currentTag === tag) currentTag = tags[0];

  renderTagManage();
  renderTagPicker();
  renderFilters();
  renderAll();
}

/** 打开 / 关闭「管理类别」弹窗 */
function openTagManage() {
  document.getElementById('tag-error').textContent = '';
  document.getElementById('input-new-tag').value = '';
  renderTagManage();
  document.getElementById('tags-overlay').hidden = false;
  document.getElementById('input-new-tag').focus();
}

function closeTagManage() {
  document.getElementById('tags-overlay').hidden = true;
}


/* ---------- ④之三 日历 ---------- */

/** 把年月日拼成 "YYYY-MM-DD"（月份在这里 +1，因为 JS 里月份是从 0 数的） */
function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 画出整个月历网格 */
function renderCalendar() {
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  document.getElementById('cal-title').textContent = `${calYear} 年 ${calMonth + 1} 月`;

  const firstDay = new Date(calYear, calMonth, 1);
  const offset = (firstDay.getDay() + 6) % 7;   // 让周一排在第一列（JS 里周日是 0）
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = todayStr();

  // 前面补几个空格，把 1 号顶到它该在的星期几
  for (let i = 0; i < offset; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-cell blank';
    grid.appendChild(blank);
  }

  // 格子够宽（≥68px）才在格子里显示任务标题，否则维持只有数字+圆点的紧凑样式。
  // 68px 是倒推出来的：10.5px 的汉字一行能放 5～6 个，「职业规划讲…」已经能区分。
  const gridW = grid.clientWidth || 0;
  const cellW = gridW ? (gridW - 24) / 7 : 0;      // 24 = 6 个 4px 间隙
  const expanded = cellW >= 68;
  if (expanded) grid.classList.add('expanded');
  else grid.classList.remove('expanded');

  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(calYear, calMonth, d);
    const dayEvents = events.filter(e => e.date === key);
    const pending = dayEvents.filter(e => statusOf(e) !== 'done').length;

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';
    if (key === today) cell.classList.add('today');
    if (key === calSelected) cell.classList.add('selected');
    if (key < today) cell.classList.add('past');    // "YYYY-MM-DD" 这种格式可以直接比大小

    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = d;
    cell.appendChild(num);

    // 圆点只数「还没做完的」——那天全做完了，就打一个灰勾；
    // 过去的日子里还有没做完的，圆点变琥珀色（过期了）
    if (pending > 0) {
      const dot = document.createElement('span');
      dot.className = 'cal-dot' + (key < today ? ' overdue' : '');
      dot.textContent = pending;
      if (key < today) dot.title = '这天还有 ' + pending + ' 条没完成，已经过期';
      cell.appendChild(dot);
    } else if (dayEvents.length > 0) {
      const dot = document.createElement('span');
      dot.className = 'cal-dot alldone';
      dot.textContent = '✓';
      cell.appendChild(dot);
    }

    // 拉宽之后，格子里直接列出当天任务（未完成的排在前面）
    if (expanded && dayEvents.length > 0) {
      const sorted = dayEvents.slice().sort((a, b) => {
        const ad = statusOf(a) === 'done' ? 1 : 0;
        const bd = statusOf(b) === 'done' ? 1 : 0;
        if (ad !== bd) return ad - bd;
        return (a.startTime || '99:99').localeCompare(b.startTime || '99:99');
      });

      sorted.slice(0, 3).forEach(ev => {
        const pill = document.createElement('span');
        pill.className = 'cal-pill status-' + statusOf(ev);
        pill.textContent = ev.title;
        pill.title = ev.title;          // 放不下时悬停看全名
        cell.appendChild(pill);
      });

      if (sorted.length > 3) {
        const more = document.createElement('span');
        more.className = 'cal-more';
        more.textContent = `+${sorted.length - 3}`;
        cell.appendChild(more);
      }
    }

    cell.addEventListener('click', () => selectDay(key));

    grid.appendChild(cell);
  }
}

/** 是不是一个真实存在的日期（会挡掉 2 月 30 日、40 月 18 日这种） */
function isValidDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const p = s.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
}

/** 拼日期，拼出来不合法就返回空字符串 */
function makeDateStr(y, mo, da) {
  const s = `${y}-${pad2(mo)}-${pad2(da)}`;
  return isValidDateStr(s) ? s : '';
}

/** 把 "2026-10-20" 说成 "10 月 20 日"；不是合法日期就原样返回（避免再出现 NaN） */
function formatDateCN(key) {
  if (!isValidDateStr(key)) return key || '';
  const p = key.split('-');
  return `${Number(p[1])} 月 ${Number(p[2])} 日`;
}

/**
 * 在日历上点了某一天：日历高亮它，右边的列表也只看这一天。
 * 这是「同一份数据的两种看法」——日历负责定位，列表负责细看。
 */
function selectDay(key) {
  calSelected = key;
  dayFilter = key;

  // 日历可能停在别的月份（最常见的是「明天」落在下个月），
  // 那样目标格根本没被画出来，粗看就是「点了没反应」。跟着跳过去。
  if (isValidDateStr(key)) {
    const p = key.split('-').map(Number);
    calYear = p[0];
    calMonth = p[1] - 1;
  }

  // 表单里的日期也跟着跳过去——想补录某天的活动时，点一下日历再填最顺手
  document.getElementById('input-date').value = key;
  renderAll();
}

/** 取消「只看某天」，回到按类别看的完整列表 */
function clearDayFilter() {
  dayFilter = '';
  calSelected = todayStr();   // 日历的高亮也回到今天，否则那格还蓝着、看起来像还筛着
  renderAll();
}

/** 列表上方那个「只看 X 月 X 日 ✕」的小标签 */
function renderDayChip() {
  const chip = document.getElementById('day-chip');
  if (dayFilter === '') {
    chip.hidden = true;
    return;
  }
  document.getElementById('day-chip-text').textContent =
    `只看 ${formatDateCN(dayFilter)}`;
  chip.hidden = false;
}

/** 翻月份：delta 传 -1 是上个月，+1 是下个月 */
function calShift(delta) {
  calMonth += delta;
  if (calMonth < 0) { calMonth = 11; calYear -= 1; }
  if (calMonth > 11) { calMonth = 0; calYear += 1; }
  renderCalendar();
}

/** 跳回今天所在的月份，选中今天，并让右边只看今天 */
function calGoToday() {
  const t = todayStr();
  const parts = t.split('-').map(Number);
  calYear = parts[0];
  calMonth = parts[1] - 1;
  selectDay(t);
}


/* ---------- ④之四 「今天 · 明天」面板 ---------- */

/**
 * 左栏日历下面那一块。
 * 它回答的问题和右边列表不一样：右边是「全部有哪些」，
 * 这里是「今明两天我该做什么」——打开页面扫一眼就够。
 */
function renderTodayPanel() {
  const box = document.getElementById('today-list');
  box.innerHTML = '';

  const today = todayStr();
  const tomorrow = dateOffsetStr(1);

  const todayItems = events.filter(e => e.date === today && statusOf(e) !== 'done');
  const tomorrowItems = events.filter(e => e.date === tomorrow && statusOf(e) !== 'done');

  document.getElementById('today-counts').textContent =
    `今天 ${todayItems.length} 条 · 明天 ${tomorrowItems.length} 条`;

  const rows = todayItems.map(ev => ({ ev: ev, label: '今' }))
    .concat(tomorrowItems.map(ev => ({ ev: ev, label: '明' })));

  // 今天在前；同一组里按时间先后
  rows.sort((a, b) => {
    if (a.label !== b.label) return a.label === '今' ? -1 : 1;
    return (a.ev.startTime || '99:99').localeCompare(b.ev.startTime || '99:99');
  });

  if (rows.length === 0) {
    // 空的时候也别摆烂：告诉用户下一条待办是什么
    const p = document.createElement('p');
    p.className = 'today-empty';

    const next = events
      .filter(e => statusOf(e) !== 'done' && daysFromToday(e.date) > 1)
      .sort((a, b) => a.date.localeCompare(b.date))[0];

    p.textContent = next
      ? `今明没有安排。最近：${formatDateCN(next.date)}（${dayLabel(daysFromToday(next.date))}）· ${next.title}`
      : '今明没有安排，也没有更晚的待办。';

    box.appendChild(p);
    return;
  }

  rows.slice(0, 4).forEach(r => box.appendChild(buildTodayRow(r.ev, r.label)));

  if (rows.length > 4) {
    const more = document.createElement('p');
    more.className = 'today-more';
    more.textContent = `还有 ${rows.length - 4} 条`;
    box.appendChild(more);
  }
}

/** 面板里的一行：今/明 + 状态点 + 名称 + 时间 + 状态按钮 */
function buildTodayRow(ev, label) {
  const st = statusOf(ev);

  const row = document.createElement('div');
  row.className = 'today-row status-' + st;

  const badge = document.createElement('span');
  badge.className = 'today-badge';
  badge.textContent = label;

  const dot = document.createElement('span');
  dot.className = 'today-dot';

  const title = document.createElement('span');
  title.className = 'today-title';
  title.textContent = ev.title;
  title.title = ev.title;                // 放不下时悬停看全名

  const time = document.createElement('span');
  time.className = 'today-time';
  time.textContent = ev.startTime || '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'today-status';
  btn.textContent = STATUS_LABEL[st];
  btn.title = '点一下换下一个状态';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();                 // 别顺带触发整行的「跳到那天」
    cycleStatus(ev);
  });

  row.append(badge, dot, title, time, btn);

  // 点整行 → 日历跳到那天、右边只看那天（和点日历格子是同一套行为）
  row.addEventListener('click', () => selectDay(ev.date));

  return row;
}


/* ---------- ④之五 智能识别 ---------- */

// 对话记录：{ role:'user'|'ai', text, image, parsed, source, sourceText, pending }
// 只存在内存里 —— 刷新页面就清空，不写 localStorage。
let chatMessages = [];

// 正在等模型回话。为 true 时不许再发 —— 聊天讲先后顺序，
// 两条同时飞出去，回来的顺序可能是反的，对话就串了。
let chatBusy = false;

// 这轮对话正在说的那条活动。用户说「改成周四」时，改的就是它。
// 只在内存里 —— 跟对话记录同生共死，刷新就清空。
let chatContext = { eventId: null };

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * 从一段文字里猜出「名称 / 日期 / 开始时间 / 结束时间 / 类别」。
 *
 * ⚠️ 说清楚：这是**规则识别**，不是 AI。只认固定写法
 * （「10月20日」「14:00」「晚上7点」这些），认不出来就留空。
 * 所以结果一定会填进表单让你看一眼再存，绝不偷偷写进去。
 */
function parseActivityText(text) {
  return {
    title: guessTitle(text),
    date: guessDate(text),
    startTime: guessStartTime(text),
    endTime: guessEndTime(text),
    tag: guessTag(text),
  };
}

/** 名称：取第一行 → 去掉【通知】这类短前缀 → 只取第一句 → 切掉日期时间部分 */
function guessTitle(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim() !== '') || text;

  let t = firstLine.trim();
  t = t.replace(/^[【\[][^】\]]{0,10}[】\]]\s*/, '');   // 去掉开头短的【通知】【提醒】等
  t = t.replace(/^[\s·•\-—:：,，]+/, '');

  // 微信里常见「大家注意：…」「通知：…」，把开头那个称呼去掉（只认这几种，别把活动名当称呼切了）
  if (/^(大家|各位|同学们?|同学|注意|通知|提醒|重要|紧急|备注|ps|PS)[^：:]{0,4}[：:]\s*/.test(t)) {
    t = t.replace(/^[^：:]{1,10}[：:]\s*/, '');
  }

  t = t.replace(/[。！？!?].*$/, '');                  // 只取第一句

  // 有的通知是「10月25日19:00 学院辩论赛报名截止」「本周三下午三点职业规划讲座」——
  // 日期时间在最前面，名称在它后面，这时把开头那段日期时间剥掉
  const stripLead = (s) => {
    let r = s;
    r = r.replace(/^\s*(?:20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|(?:本|这|下下?|上)?\s*(?:周|星期|礼拜)\s*[一二三四五六日天])\s*/, '');
    r = r.replace(/^\s*(?:上午|下午|晚上|中午|早上)?\s*(?:[一二三四五六七八九十]{1,3}\s*[点时](?:半|\d{1,2}分?)?|\d{1,2}[:：]\d{2})\s*/, '');
    r = r.replace(/^[，,、:：\s]+/, '');
    r = r.replace(/^(?:前|之前|以前|以后|后)\s*/, '');
    return r.trim();
  };
  const lead = stripLead(t);
  if (lead && lead.length >= 4 && lead !== t) t = lead;

  // 名称通常写在前面，所以想把第一个日期/时间之后的内容切掉。
  // 但不能见日期就切 —— 「周三晚上7点在三教…」切完只剩「周三晚上」，反而没法用。
  // 判断标准：日期前面有空格或标点（说明名称确实结束了），或者前面已经够长。
  const dateTimeSrc = '\\d{1,2}\\s*月\\s*\\d{1,2}\\s*[日号]'
                    + '|20\\d{2}[-\\/]\\d{1,2}[-\\/]\\d{1,2}'
                    + '|(?:本|这|下下?|上)?\\s*(?:周|星期|礼拜)\\s*[一二三四五六日天]'
                    + '|\\d{1,2}[:：]\\d{2}'
                    + '|\\d{1,2}\\s*[点时]';
  const dm = t.match(new RegExp('(\\s*)(?:' + dateTimeSrc + ').*$'));
  if (dm) {
    const before = t.slice(0, dm.index).trim();
    const separated = dm[1].length > 0 || /[\s，,、:：]$/.test(before);
    if (separated || before.length >= 5) t = before;
  }

  // 一句话写完的通知（「校园歌手大赛初赛 时间：10月20日」）切完会剩个「时间：」尾巴，
  // 这是字段名不是名称，去掉
  t = t.replace(/[\s，,、·:：]*(时间|地点|日期|主题|内容|名称|活动名称)\s*[:：]?\s*$/, '');

  // 微信通知常见长句：「职业规划讲座，本周三下午三点，三教201」——
  // 切掉日期后还剩前半句时，逗号后面通常是地点/要求，不是名称
  const comma = t.search(/[，,；;]/);
  if (comma >= 5) t = t.slice(0, comma);

  t = t.trim();
  if (t.length > 30) t = t.slice(0, 30) + '…';
  return t || '未命名活动';
}

/** 日期：只认 2026-10-20 / 10月20日 / 10/20 / 周三 这几种写法；算出来不合法就返回空 */
function guessDate(text) {
  const y = new Date().getFullYear();

  let m = text.match(/(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return makeDateStr(m[1], m[2], m[3]);

  m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (m) return makeDateStr(y, m[1], m[2]);

  // 周三 / 本周三 / 下周三 / 下下周三 / 星期三 / 礼拜三
  // 微信里最常见的就是「本周三下午三点」这种相对说法
  const weekMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
  m = text.match(/(下下|下|本|这|上)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/);
  if (m) {
    const prefix = m[1] || '';
    const target = weekMap[m[2]];
    const now = new Date();
    let delta = target - now.getDay();

    if (prefix === '下') {
      if (delta <= 0) delta += 7;
    } else if (prefix === '下下') {
      delta += 14;
    } else if (prefix === '上') {
      if (delta >= 0) delta -= 7;
    } else if (prefix !== '本' && prefix !== '这') {
      if (delta < 0) delta += 7;      // 光说「周三」= 往后最近的那个周三
    }

    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta);
    return makeDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  // 前后都不能紧挨着数字或冒号 —— 否则 "16:40-18:10" 这种时间段
  // 会被当成「40 月 18 日」，塞进日期框后被浏览器拒收，界面上就显示 NaN。
  m = text.match(/(?<![\d:])(\d{1,2})[\/\-](\d{1,2})(?![\d:])/);
  if (m) return makeDateStr(y, m[1], m[2]);

  return '';
}

/** 开始时间：只认 14:00 / 下午3点 / 晚上7点半 / 上午9时 */
function guessStartTime(text) {
  let m = text.match(/(?<!\d)(\d{1,2})[:：](\d{2})(?!\d)/);
  if (m) return `${pad2(m[1])}:${m[2]}`;

  m = text.match(/(上午|早上|中午|下午|晚上)?\s*(\d{1,2})\s*[点时](半|\d{1,2}分?)?/);
  if (m) {
    let h = Number(m[2]);
    const period = m[1] || '';
    if ((period === '下午' || period === '晚上') && h < 12) h += 12;
    if (period === '中午' && h < 12) h = 12;
    if (period === '晚上' && h === 12) h = 0;      // 「晚上12点」是午夜，不是中午

    let min = 0;
    if (m[3] === '半') min = 30;
    else if (m[3]) min = Number(String(m[3]).replace(/分$/, '')) || 0;

    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${pad2(h)}:${pad2(min)}`;
    }
  }
  return '';
}

/** 结束时间：只认 14:00-16:00 / 14:00 至 16:00 这种明确写法 */
function guessEndTime(text) {
  const m = text.match(/(\d{1,2})[:：](\d{2})\s*[-–—~至到]\s*(\d{1,2})[:：](\d{2})/);
  return m ? `${pad2(m[3])}:${m[4]}` : '';
}

/** 类别：先看文字里有没有直接出现现有类别名，再按关键词猜 */
function guessTag(text) {
  for (let i = 0; i < tags.length; i++) {
    if (text.indexOf(tags[i]) !== -1) return tags[i];
  }
  const rules = [
    [/讲座|宣讲|分享会|论坛|报告|培训/, '讲座'],
    [/比赛|竞赛|大赛|初赛|决赛|选拔|挑战赛/, '比赛'],
    [/演出|晚会|音乐会|话剧|歌手|舞蹈/, '演出'],
    [/志愿|义工|公益|服务队/, '志愿'],
  ];
  for (let i = 0; i < rules.length; i++) {
    if (rules[i][0].test(text) && tags.indexOf(rules[i][1]) !== -1) return rules[i][1];
  }
  return tags[0];
}

/* ---------- AI 识别（可选：用户自己填 Key） ---------- */

const AI_BASE_KEY = 'campus_ai_base_v1';
const AI_MODEL_KEY = 'campus_ai_model_v1';
const AI_KEY_KEY = 'campus_ai_key_v1';
// 识别出活动之后怎么办：'auto' = AI 自己决定直接入库；'confirm' = 先挂在气泡上等人工确认
const AI_CONFIRM_KEY = 'campus_ai_confirm_v1';

// 默认指向 DeepSeek；用户可以在设置里改成任何「OpenAI 兼容」的接口
const AI_DEFAULT_BASE = 'https://api.deepseek.com/chat/completions';
const AI_DEFAULT_MODEL = 'deepseek-flash';

// ⚠️ 这个必须给够。deepseek-flash 是「推理模型」：
// 它先花一部分 token 在内部思考（reasoning_content），然后才输出正文。
// 不设 max_tokens 时，推理会把额度吃光，正文就是空的——
// 表现就是"调用成功但没有内容"，然后被当成失败退回规则识别。
const AI_MAX_TOKENS = 4000;

function loadAiConfig() {
  try {
    return {
      base: localStorage.getItem(AI_BASE_KEY) || '',
      model: localStorage.getItem(AI_MODEL_KEY) || '',
      key: localStorage.getItem(AI_KEY_KEY) || '',
      confirm: localStorage.getItem(AI_CONFIRM_KEY) === 'confirm' ? 'confirm' : 'auto'
    };
  } catch (err) {
    return { base: '', model: '', key: '', confirm: 'auto' };
  }
}

/** 是不是「先让我确认」模式 */
function aiNeedsConfirm() {
  return loadAiConfig().confirm === 'confirm';
}

/** 三项都填了才算配好；没配好就走规则识别 */
function aiReady() {
  const c = loadAiConfig();
  return !!(c.base && c.model && c.key);
}

/**
 * 把用户填的地址补全成真正能 POST 的地址。
 * 很多人会照抄官方文档里的 base_url（比如 https://api.deepseek.com），
 * 那个值是给 SDK 用的，SDK 会自动补 /chat/completions；
 * 我们直接 POST，少了这一段就会 404。
 */
function normalizeAiBase(base) {
  let u = String(base || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (/\/chat\/completions$/.test(u)) return u;
  return u + '/chat/completions';
}

/**
 * 跟模型聊一轮（OpenAI 兼容格式）。
 * 输入：这一句（文字或图片）+ 之前聊过的内容
 * 输出：{ reply: 给用户看的话, activity: null 或一条活动 }
 *
 * ⚠️ 浏览器直接调第三方 API 会遇到 CORS —— 有的服务允许、有的不允许；
 * 用 file:// 打开更严格。所以这里任何失败都往上抛，由调用方退回规则识别。
 */
async function aiChat(text, imageDataUrl, history) {
  const c = loadAiConfig();

  const today = todayStr();
  const weekday = '日一二三四五六'[new Date(today + 'T00:00:00').getDay()];

  // 把用户的清单带进上下文，它才答得上「我今天有什么」，也才知道要动的是哪几条。
  // 只发名称/日期/时间/类别/状态，**不发备注** —— 备注里可能是群消息原文，没必要送出去。
  // 给模型看的编号清单：行首 #N 就是它这一轮能动的那几条
  const index = [];
  const listLines = events
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.startTime || '').localeCompare(String(b.startTime || '')))
    .slice(0, 30)
    .map((e, i) => {
      index.push(e.id);
      return '#'.concat(String(i + 1), ' ', e.date, ' ', e.startTime || '全天', ' ', e.title,
        ' #', e.tag, ' [', STATUS_LABEL[statusOf(e)], ']');
    });

  const system = [
    '你是「活动小本本」里的助手。用这个网页的是个大学生，正在把散在各处的校园活动记下来。',
    '今天是 ' + today + '（星期' + weekday + '）。可选的类别只有：' + tags.join('、') + '。',
    '',
    '用户现在的活动清单（行首 #N 是编号，改动已有记录时用它，最多 30 条）：',
    listLines.join('\n') || '（一条都没有）',
    '',
    '说话方式：',
    '- 像同学之间聊天，简短、口语，一次不超过 60 字。不要客套，不要「作为AI」这类话。',
    '- 用户可能只是在闲聊、在问问题，也可能让你记事、改事、删事。正常回应就行。',
    '- 用户没在说活动、也没让你动手的时候，activities 和 ops 都给空数组、action 给 "none"。',
    '- 用户问「我今天有什么」「这周还有几件事」这类问题时，照上面那份清单回答，清单里没有就说没有，绝不编。',
    '- 日期统一写成 YYYY-MM-DD。拿不准的字段一律给空字符串，绝不编造。没说年份按今年算；说了「明年」就按明年。',
    '',
    '提醒（可选）：',
    '- 活动可以带一个 "remindMin"：0 = 到点提醒（默认），10/30/60/1440 = 提前这么多分钟，-1 = 不提醒。',
    '- 用户说「提前半小时提醒我」「前一天晚上说一声」时，把它算成分钟写进 remindMin（前一天晚上 ≈ 1440，按开始时间往前推）。没说就别给这个字段。',
    '',
    '一次可以交代好几件事：',
    '- 用户可能一口气说好几件（粘贴一段群聊、发一张通知截图，或者「周三讲座、周五比赛、下周一交材料」），**每一件都单独列出来**，最多 8 条。',
    '- 同一件事的重复说法（「周三下午三点」和「10月21日 15:00」）合成一条，不要拆成两条。',
    '- 只有当你确实读到了至少一件活动（有名称或日期）时，才放进 activities。',
    '',
    'activities 和 action 怎么给：',
    '- action 只有三种：',
    '  "new"  = 这些是**新**活动，之前没记过 → 程序会把它们写进列表',
    '  "edit" = 用户在**改**我上一轮刚给的那条（「改成周四」「地点不用记」「不是讲座是比赛」）→ activities 里只给这一条',
    '  "none" = 没有成形的活动，或者信息还不够（缺名称或缺日期）→ activities 给空数组',
    '- action 是 "new" 时，activities 里每一条的 title 和 date **都必须有值**；哪一条缺就丢掉那一条，不要留半条。',
    '- 用户又提到一件**不同**的事，即使和上一件很像，也算新的一条。',
    '- reply 用一句话说清你记了几条（例如「记了 3 条：讲座、辩论赛、交材料」），不要逐条重复细节。',
    '',
    '对已有记录动手（ops）：',
    '- 只能引用上面清单里出现过的编号，不要编号码里没有的；不确定是哪一条就别动。',
    '- 四种操作：',
    '  {"op":"complete","ids":[1,2]}   标成已完成（可以一次好几条）',
    '  {"op":"reopen","ids":[3]}       改回未开始',
    '  {"op":"delete","ids":[4]}       删掉（会进「已删除」，能恢复；程序会先让用户点确认）',
    '  {"op":"update","id":5,"activity":{"title":"...","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","tag":"类别名"}}  改某一条已存在的（只给要改的字段，用 {} 里的字段覆盖）',
    '- 例子：「把上周的都标成完成」→ 找到那几条的编号，一次给 complete；「删掉辩论赛」→ 找到它的编号给 delete；「把已完成那条改到周五」→ update。',
    '- 一次可以同时给 activities（新活动）和 ops（对旧的动手），但两件事别搞混。',
    '- 你要先说清打算动哪几条（在 thinking 里写），不要偷偷改。',
    '',
    'thinking 字段：',
    '- 用一两句话写你的判断（例如「清单里 10/19、10/20 两条还没完成，按你说的标完成」），用户会在气泡里看到，折叠起来。',
    '- 不要写思考过程的长篇大论，只写结论和依据。',
    '',
    '只输出一个 JSON 对象，不要 Markdown 代码块，不要多余的解释。格式：',
    '{"reply":"给用户看的一句话","thinking":"你的判断","activities":[],"ops":[],"action":"none"}',
    '或者',
    '{"reply":"...","thinking":"...","activities":[{"title":"...","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","tag":"类别名","remindMin":30}],"ops":[{"op":"complete","ids":[1,3]}],"action":"new"}'
  ].join('\n');

  const messages = [{ role: 'system', content: system }];

  // 之前聊过的（最多 10 条）。旧图片不重发，太费额度；
  // 上一轮识别出的活动用一句话带进上下文，模型才知道「改成周四」是改哪一条。
  (history || []).slice(-10).forEach(m => {
    if (!m.text) return;
    let content = m.text;
    const parsedList = Array.isArray(m.parsedList) && m.parsedList.length ? m.parsedList
      : (m.parsed ? [m.parsed] : []);
    if (parsedList.length) {
      content += '\n（上一轮我给出的活动：' +
        parsedList.map(p => describeParsed(p).replace(/\n/g, '；')).join('｜') + '）';
    }
    messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: content });
  });

  // 这一轮
  if (imageDataUrl) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: text ? text : '这张图里是什么活动？' },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ]
    });
  } else {
    messages.push({ role: 'user', content: text });
  }

  const body = {
    model: c.model,
    temperature: 0.3,              // 聊天要一点灵活性；识别靠提示词约束就够
    max_tokens: AI_MAX_TOKENS,     // 见上面 AI_MAX_TOKENS 的说明，别删
    messages: messages
  };

  const url = normalizeAiBase(c.base);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + c.key
    },
    body: JSON.stringify(body)
  });

  // 报错里带上实际请求的地址 —— 不然 404 根本看不出是地址错了
  if (!res.ok) throw new Error(`接口返回 ${res.status}（请求地址：${url}）`);

  const data = await res.json();
  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  // 推理模型（deepseek 系）会把内部推理单独放在 reasoning_content 里
  const reasoning = choice && choice.message && choice.message.reasoning_content;

  if (!content) {
    // 推理模型常见的坑：额度被内部推理吃光，正文是空的
    if (choice && choice.finish_reason === 'length') {
      throw new Error('模型把额度都用在推理上了（可以缩短要识别的文字，或换一个非推理模型）');
    }
    throw new Error('返回内容为空');
  }

  const parsed = parseAiReply(content, text, index);
  if (!parsed.thinking && reasoning) {
    parsed.thinking = String(reasoning).trim().slice(0, 500);
  }
  return parsed;
}

/**
 * 把模型返回的东西解析成 { reply, thinking, activity, activities, ops, action }。
 * 模型不一定完全听话：可能包一层 ```json、也可能干脆说人话。
 * 所以解析不出来时，把那整段话当成 reply —— 至少别让用户看到一句「解析失败」。
 *
 * index 是本轮清单里 #1..#N 对应的真实事件 id，用来把模型说的编号翻译回去。
 */
function parseAiReply(content, text, index) {
  let raw = String(content).trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  let got = null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try { got = JSON.parse(m[0]); } catch (err) { got = null; }
  }

  if (!got || typeof got !== 'object' || Array.isArray(got)) {
    return { reply: raw.slice(0, 300), thinking: '', activity: null, activities: [], ops: [], action: 'none' };
  }

  // 一次可能说好几件事：activities 数组优先；老的单个 activity 也认。
  const rawList = Array.isArray(got.activities)
    ? got.activities
    : (got.activity ? [got.activity] : []);

  const activities = [];
  const seen = new Set();

  rawList.slice(0, 8).forEach(item => {
    const a = normalizeActivity(item, text);
    if (!a) return;
    // 模型有时会把同一条复述两遍：同名同日期同时间只留一条
    const key = a.title + '|' + a.date + '|' + (a.startTime || '');
    if (seen.has(key)) return;
    seen.add(key);
    activities.push(a);
  });

  // 「改」只针对上一轮那一条，多给了也只取第一条
  const list = got.action === 'edit' ? activities.slice(0, 1) : activities;

  // 对已有记录的操作：把模型说的 #编号 翻成真实事件 id
  const ops = [];
  const idOf = (n) => {
    const i = Number(n);
    return Number.isInteger(i) && i >= 1 && i <= (index || []).length ? index[i - 1] : null;
  };

  (Array.isArray(got.ops) ? got.ops : []).slice(0, 10).forEach(op => {
    if (!op || typeof op !== 'object') return;
    const kind = String(op.op || '');

    if (kind === 'update') {
      const evId = idOf(op.id);
      if (!evId) return;
      // 只认模型真的给了的字段，不让规则识别去「猜」——改错一条比不改更糟
      const raw = (op.activity && typeof op.activity === 'object') ? op.activity : null;
      if (!raw) return;

      const patch = {};
      if (typeof raw.title === 'string' && raw.title.trim()) patch.title = raw.title.trim().slice(0, 50);
      if (isValidDateStr(raw.date)) patch.date = String(raw.date).trim();
      if (/^\d{2}:\d{2}$/.test(String(raw.startTime || ''))) patch.startTime = String(raw.startTime).trim();
      if (/^\d{2}:\d{2}$/.test(String(raw.endTime || ''))) patch.endTime = String(raw.endTime).trim();
      if (typeof raw.tag === 'string' && tags.indexOf(raw.tag) !== -1) patch.tag = raw.tag;
      if (raw.remindMin !== undefined && raw.remindMin !== null) {
        const n = Number(raw.remindMin);
        if (Number.isFinite(n) && n >= -1 && n <= 1440) patch.remindMin = Math.round(n);
      }

      if (!Object.keys(patch).length) return;
      ops.push({ kind: 'update', evId: evId, patch: patch });
      return;
    }

    if (kind !== 'complete' && kind !== 'reopen' && kind !== 'delete') return;

    const ids = Array.isArray(op.ids) ? op.ids : (op.id != null ? [op.id] : []);
    const evIds = ids.map(idOf).filter(Boolean);
    if (!evIds.length) return;
    ops.push({ kind: kind, evIds: evIds });
  });

  return {
    reply: typeof got.reply === 'string' ? got.reply.trim().slice(0, 300) : '',
    thinking: typeof got.thinking === 'string' ? got.thinking.trim().slice(0, 300) : '',
    activity: list[0] || null,
    activities: list,
    ops: ops,
    action: list.length ? (got.action === 'edit' ? 'edit' : 'new') : 'none'
  };
}

/**
 * 把模型给的 activity 逐项校验。
 * 给错的字段退回规则识别算出来的值；名称和日期都空的，就当它没认出活动。
 */
function normalizeActivity(a, text) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;

  const fallback = parseActivityText(text || '');
  const title = typeof a.title === 'string' ? a.title.trim().slice(0, 50) : '';
  const date = typeof a.date === 'string' ? a.date.trim() : '';

  if (!title && !isValidDateStr(date)) return null;

  // 提前多少分钟提醒：只认 -1（不提醒）到 1440（提前一天）之间的整数
  let remindMin = 0;
  if (a.remindMin !== undefined && a.remindMin !== null && a.remindMin !== '') {
    const n = Number(a.remindMin);
    if (Number.isFinite(n) && n >= -1 && n <= 1440) remindMin = Math.round(n);
  }

  return {
    title:     title || fallback.title,
    date:      isValidDateStr(date) ? date : fallback.date,
    startTime: /^\d{2}:\d{2}$/.test(a.startTime || '') ? a.startTime : fallback.startTime,
    endTime:   /^\d{2}:\d{2}$/.test(a.endTime || '') ? a.endTime : fallback.endTime,
    tag:       tags.indexOf(a.tag) !== -1 ? a.tag : guessTag(title + ' ' + (text || '')),
    remindMin: remindMin
  };
}

/** 「AI 识别设置」的展开收起、保存、清除 */
function initAiSettings() {
  const panel = document.getElementById('ai-panel');
  const state = document.getElementById('ai-state');
  const msg = document.getElementById('ai-msg');

  function refreshState() {
    const c = loadAiConfig();
    if (c.base && c.model && c.key) {
      state.textContent = '当前：AI 对话（' + c.model + '）' +
        (c.confirm === 'confirm' ? ' · 先确认' : '');
      state.classList.add('on');
    } else {
      state.textContent = '当前：规则识别';
      state.classList.remove('on');
    }
  }

  // 没存过配置时，把接口地址和模型名预先填好 —— 你只需要贴 Key
  const c0 = loadAiConfig();
  document.getElementById('ai-base').value = c0.base || AI_DEFAULT_BASE;
  document.getElementById('ai-model').value = c0.model || AI_DEFAULT_MODEL;
  document.getElementById('ai-key').value = c0.key;
  const confirmBox = document.getElementById('ai-confirm');
  if (confirmBox) confirmBox.value = c0.confirm;
  refreshState();

  document.getElementById('btn-ai-toggle').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });

  // 改「识别出活动之后」的处理方式：立即生效，不用点保存
  if (confirmBox) {
    confirmBox.addEventListener('change', () => {
      try {
        localStorage.setItem(AI_CONFIRM_KEY, confirmBox.value === 'confirm' ? 'confirm' : 'auto');
      } catch (err) { /* 存不进去就只影响这次 */ }
      refreshState();
      msg.classList.remove('ok');
      msg.textContent = confirmBox.value === 'confirm'
        ? '以后识别出的活动会先挂在对话里，你点「记下」或「全部同意」才进列表。'
        : '以后识别出的活动会直接记进列表，不用你确认。';
    });
  }

  document.getElementById('btn-ai-save').addEventListener('click', () => {
    const base = document.getElementById('ai-base').value.trim();
    const model = document.getElementById('ai-model').value.trim();
    const key = document.getElementById('ai-key').value.trim();

    msg.classList.remove('ok');
    msg.textContent = '';

    if (!base || !model || !key) {
      msg.textContent = '三项都要填。不确定填什么就先点「清除」，用规则识别。';
      return;
    }

    try {
      localStorage.setItem(AI_BASE_KEY, base);
      localStorage.setItem(AI_MODEL_KEY, model);
      localStorage.setItem(AI_KEY_KEY, key);
      if (confirmBox) {
        localStorage.setItem(AI_CONFIRM_KEY, confirmBox.value === 'confirm' ? 'confirm' : 'auto');
      }
    } catch (err) {
      msg.textContent = '这台浏览器的本地存储不可用，存不进去。';
      return;
    }

    refreshState();
    msg.classList.add('ok');
    msg.textContent = '已保存。现在可以跟它聊天了；连不上的时候会自动退回本机规则。';
  });

  document.getElementById('btn-ai-clear').addEventListener('click', () => {
    try {
      localStorage.removeItem(AI_BASE_KEY);
      localStorage.removeItem(AI_MODEL_KEY);
      localStorage.removeItem(AI_KEY_KEY);
    } catch (err) { /* 忽略 */ }

    document.getElementById('ai-base').value = '';
    document.getElementById('ai-model').value = '';
    document.getElementById('ai-key').value = '';
    if (confirmBox) confirmBox.value = 'auto';
    refreshState();
    msg.classList.add('ok');
    msg.textContent = '已清除，回到规则识别。';
  });
}

/* ---------- 对话式识别 ---------- */

/** 往对话里放一条消息 */
function pushChat(msg) { chatMessages.push(msg); }

/** 把最后一条「正在理解…」删掉 */
function dropPending(token) {
  // 按「那条消息本身」删，不按位置删。
  // 连着发两条时，先回来的那条如果去弹「最后一条」，会把第二条的
  //「正在理解…」误删，自己那条反而永远挂着。
  if (token) {
    const i = chatMessages.indexOf(token);
    if (i !== -1) chatMessages.splice(i, 1);
    return;
  }

  const last = chatMessages[chatMessages.length - 1];
  if (last && last.pending) chatMessages.pop();
}

/** 把结构化结果说成人话 */
function describeParsed(p) {
  const when = p.startTime
    ? `${p.startTime}${p.endTime ? '–' + p.endTime : ''}`
    : '全天';
  const date = isValidDateStr(p.date) ? formatDateCN(p.date) : '没识别到日期';
  return `${p.title}\n${date} · ${when} · #${p.tag}`;
}

/** 画出整个对话 */
/**
 * 气泡里「对已有记录的操作」那一段：每行一个动作 + 执行/撤销按钮。
 * 删除是危险操作，所以那一行用红色按钮，而且不会自动执行。
 */
function renderOpsBlock(bubble, msg) {
  const box = document.createElement('div');
  box.className = 'chat-ops';

  const head = document.createElement('div');
  head.className = 'ops-head';
  head.textContent = '对已有记录的操作';
  box.appendChild(head);

  const states = Array.isArray(msg.opState) ? msg.opState : [];

  (msg.ops || []).forEach((op, i) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'op-row';

    const main = document.createElement('div');
    main.className = 'op-main';
    const label = document.createElement('span');
    label.className = 'op-label';
    label.textContent = describeOp(op);
    main.appendChild(label);
    rowEl.appendChild(main);

    const state = states[i];
    if (state === 'done') {
      const s = document.createElement('span');
      s.className = 'confirm-state';
      s.textContent = op.kind === 'delete' ? '✓ 已删除' : '✓ 已执行';
      rowEl.appendChild(s);

      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'btn-ghost op-undo';
      undo.textContent = '撤销';
      undo.addEventListener('click', () => undoOp(msg, i));
      rowEl.appendChild(undo);
    } else if (state === 'skipped') {
      const s = document.createElement('span');
      s.className = 'confirm-state confirm-state-skip';
      s.textContent = '已跳过';
      rowEl.appendChild(s);
    } else {
      const run = document.createElement('button');
      run.type = 'button';
      run.className = op.kind === 'delete' ? 'btn-danger op-run' : 'btn-primary op-run';
      run.textContent = op.kind === 'delete' ? '删除' : '执行';
      run.addEventListener('click', () => {
        applyOp(msg, i);
        renderChat();
      });
      rowEl.appendChild(run);
    }

    box.appendChild(rowEl);
  });

  const actions = document.createElement('div');
  actions.className = 'confirm-actions';

  const left = (msg.ops || []).filter((_, i) => !states[i]).length;
  if (left > 0) {
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'btn-primary';
    all.textContent = '全部执行（' + left + ' 条）';
    all.addEventListener('click', () => runPendingOps(msg));
    actions.appendChild(all);
  }

  const doneCount = states.filter(s => s === 'done').length;
  if (doneCount > 0) {
    const undoAll = document.createElement('button');
    undoAll.type = 'button';
    undoAll.className = 'btn-ghost chat-undo';
    undoAll.textContent = '撤销已执行的 ' + doneCount + ' 条';
    undoAll.addEventListener('click', () => undoAllOps(msg));
    actions.appendChild(undoAll);
  }

  if (actions.childNodes.length) box.appendChild(actions);
  bubble.appendChild(box);
}

function renderChat() {
  const log = document.getElementById('chat-log');
  if (!log) return;
  log.innerHTML = '';

  if (chatMessages.length === 0) {
    const tip = document.createElement('p');
    tip.className = 'chat-empty';
    tip.textContent = '随便聊，也可以直接把活动丢进来：打字、拖群消息、拖文档、拖截图都行。一次说好几件也行（比如「周三讲座、周五比赛、下周一交材料」），我自己逐条记进列表，不用你点存；记错了点「全部撤销」就回来。';
    log.appendChild(tip);
    return;
  }

  chatMessages.forEach((msg, i) => {
    const row = document.createElement('div');
    row.className = 'chat-msg ' + (msg.role === 'user' ? 'from-user' : 'from-ai');
    // 整个对话每次都重画，只有最新那条做入场动画
    if (i === chatMessages.length - 1) row.classList.add('chat-new');

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    if (msg.pending) bubble.classList.add('pending');

    if (msg.image) {
      const img = document.createElement('img');
      img.className = 'chat-img';
      img.src = msg.image;
      img.alt = '上传的图片';
      bubble.appendChild(img);
    }

    if (msg.text) {
      const p = document.createElement('p');
      p.className = 'chat-text';
      p.textContent = msg.text;
      bubble.appendChild(p);
    }

    // 它的判断放在回复下面，默认折叠，想看再点开
    if (msg.thinking) {
      const think = document.createElement('details');
      think.className = 'chat-think';
      const sum = document.createElement('summary');
      sum.textContent = '思考';
      const body = document.createElement('div');
      body.className = 'chat-think-body';
      body.textContent = msg.thinking;
      think.appendChild(sum);
      think.appendChild(body);
      bubble.appendChild(think);
    }

    if (msg.parsed) {
      const card = document.createElement('div');
      card.className = 'chat-parsed';

      const list = Array.isArray(msg.parsedList) && msg.parsedList.length
        ? msg.parsedList
        : [msg.parsed];
      card.textContent = (msg.source ? msg.source + '：\n' : '') +
        list.map(p => describeParsed(p)).join('\n\n');
      bubble.appendChild(card);

      const saved = msg.saved;

      // 已经自动写进列表了：只说结果，再给一个反悔的出口
      if (saved && saved.kind !== 'undone') {
        const items = Array.isArray(saved.items) ? saved.items : [];
        const created = items.filter(x => x.kind === 'created');
        const updated = items.filter(x => x.kind === 'updated');
        const dup = items.filter(x => x.kind === 'duplicate');

        const line = document.createElement('p');
        line.className = 'chat-saved';

        if (saved.kind === 'batch') {
          const bits = [];
          if (created.length) bits.push('✓ 记了 ' + created.length + ' 条');
          if (updated.length) bits.push('✓ 更新了 ' + updated.length + ' 条');
          if (dup.length) bits.push('列表里已有 ' + dup.length + ' 条');
          line.textContent = bits.join('，') || '列表里已经有这些了';
        } else {
          line.textContent =
            saved.kind === 'created'   ? '✓ 已经自动记进列表了' :
            saved.kind === 'updated'   ? '✓ 已经更新列表里那条' :
                                         '列表里已经有这条了';
        }
        bubble.appendChild(line);

        if (created.length || updated.length) {
          const undo = document.createElement('button');
          undo.type = 'button';
          undo.className = 'btn-ghost chat-undo';
          undo.textContent = (created.length + updated.length) > 1 ? '全部撤销' : '撤销';
          undo.addEventListener('click', () => undoChatSave(msg));
          bubble.appendChild(undo);
        }
      } else if (Array.isArray(msg.pending) && msg.pending.length) {
        // 确认模式：挂在气泡上等人工点头
        const box = document.createElement('div');
        box.className = 'chat-confirm';

        const savedItems = Array.isArray(msg.savedItems) ? msg.savedItems : [];
        const decisions = Array.isArray(msg.decisions) ? msg.decisions : [];
        const pendingLeft = msg.pending.filter((_, i) => !decisions[i]).length;

        msg.pending.forEach((a, i) => {
          const rowEl = document.createElement('div');
          rowEl.className = 'confirm-row';

          const main = document.createElement('div');
          main.className = 'confirm-main';

          const title = document.createElement('span');
          title.className = 'confirm-title';
          title.textContent = a.title;

          const meta = document.createElement('span');
          meta.className = 'confirm-meta';
          const when = a.startTime ? a.startTime + (a.endTime ? '–' + a.endTime : '') : '全天';
          meta.textContent = [formatDateCN(a.date), when, a.tag ? '#' + a.tag : '']
            .filter(Boolean).join(' · ');

          main.appendChild(title);
          main.appendChild(meta);
          rowEl.appendChild(main);

          const state = decisions[i];
          if (state === 'saved') {
            const done = document.createElement('span');
            done.className = 'confirm-state';
            done.textContent = '✓ 已记';
            rowEl.appendChild(done);
          } else if (state === 'skipped') {
            const skipped = document.createElement('span');
            skipped.className = 'confirm-state confirm-state-skip';
            skipped.textContent = '已跳过';
            rowEl.appendChild(skipped);
          } else {
            const ok = document.createElement('button');
            ok.type = 'button';
            ok.className = 'btn-primary confirm-one';
            ok.textContent = '记下';
            ok.addEventListener('click', () => confirmOne(msg, i));
            rowEl.appendChild(ok);
          }

          box.appendChild(rowEl);
        });

        const actions = document.createElement('div');
        actions.className = 'confirm-actions';

        if (pendingLeft > 0) {
          const all = document.createElement('button');
          all.type = 'button';
          all.className = 'btn-primary';
          all.textContent = '全部同意（' + pendingLeft + ' 条）';
          all.addEventListener('click', () => confirmAllPending(msg));
          actions.appendChild(all);

          const none = document.createElement('button');
          none.type = 'button';
          none.className = 'btn-ghost';
          none.textContent = '都不要';
          none.addEventListener('click', () => skipAllPending(msg));
          actions.appendChild(none);
        }

        if (savedItems.length) {
          const undo = document.createElement('button');
          undo.type = 'button';
          undo.className = 'btn-ghost chat-undo';
          undo.textContent = '撤销已记的 ' + savedItems.length + ' 条';
          undo.addEventListener('click', () => undoPendingSave(msg));
          actions.appendChild(undo);
        }

        if (actions.childNodes.length) box.appendChild(actions);
        bubble.appendChild(box);
      } else {
        // 还没存（信息不全，或者刚撤销过）：给个手动填表的出口
        const fill = document.createElement('button');
        fill.type = 'button';
        fill.className = 'btn-primary chat-fill';
        fill.textContent = '填入表单';
        fill.addEventListener('click', () => {
          applyParsedToForm(msg.parsed, msg.sourceText || '');
          document.getElementById('form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
          document.getElementById('input-title').focus();
        });
        bubble.appendChild(fill);
      }
    }

    // 对已有记录的操作（完成 / 改回 / 删除 / 修改）
    if (Array.isArray(msg.ops) && msg.ops.length) {
      renderOpsBlock(bubble, msg);
    }

    // 网络这边出错时给个「重试」，不用重新打字
    if (msg.retryText) {
      bubble.classList.add('chat-failed');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn-ghost chat-retry';
      retry.textContent = '重试';
      retry.addEventListener('click', () => {
        const input = document.getElementById('chat-text');
        if (!input) return;
        input.value = msg.retryText;
        document.getElementById('chat-send').click();
      });
      bubble.appendChild(retry);
    }

    row.appendChild(bubble);
    log.appendChild(row);
  });

  log.scrollTop = log.scrollHeight;
}

/** 把一长段文字压成一行预览，让用户看得见「到底读进去了什么」 */
function previewText(s) {
  const one = String(s).replace(/\s+/g, ' ').trim();
  return one.length > 80 ? one.slice(0, 80) + '…' : one;
}

/**
 * 问一轮：文字或图片 → 模型的话 +（可能有的）一条活动 → 放进对话。
 * 没配 AI / 调用失败时自动退回规则识别，并在消息里写明原因。
 */
async function askAI(text, imageDataUrl, label) {
  if (chatBusy) return;   // 上一轮还没回来，别插队

  // 太长的不往里送：既费额度，读出来也只会是一团乱
  if (text && text.length > 4000) {
    pushChat({
      role: 'ai',
      text: `这段文字太长了（${text.length} 字），一次最多 4000 字。请只贴和活动有关的那几句。`
    });
    renderChat();
    return;
  }

  // 先把聊天记录抄下来 —— 等会儿要当上下文发过去，
  // 必须在把这一句塞进去之前抄，否则它会重复两次。
  const history = chatMessages.filter(m => !m.pending);

  pushChat({
    role: 'user',
    text: label
      ? '【文件】' + label + (text ? '\n' + previewText(text) : '')
      : text,
    image: imageDataUrl || ''
  });
  renderChat();

  const thinking = { role: 'ai', text: '正在理解…', pending: true };
  pushChat(thinking);
  renderChat();

  setChatBusy(true);
  try {
    // ---------- 配了 AI：真正聊一轮 ----------
    if (aiReady()) {
      let got = null;
      let failReason = '';

      try {
        got = await aiChat(text, imageDataUrl, history);
      } catch (err) {
        failReason = err.message;
      }

      if (got) {
        // 一次可能识别出好几条。自动模式直接入库；确认模式先挂在气泡上等人工点头。
        const rawActs = Array.isArray(got.activities)
          ? got.activities
          : (got.activity ? [got.activity] : []);
        const acts = got.action !== 'none' ? rawActs : [];

        dropPending(thinking);
        deliverParsed(acts, {
          text: got.reply || (acts.length ? '记下了。' : (Array.isArray(got.ops) && got.ops.length ? '好。' : '我在。')),
          thinking: got.thinking || '',
          ops: got.ops || [],
          source: imageDataUrl ? 'AI 识图' : 'AI 识别',
          sourceText: text || '',
          action: got.action
        });
        return;
      }

      // 连不上：图片没法用规则兜底，只能报错
      if (imageDataUrl) {
        dropPending(thinking);
        pushChat({
          role: 'ai',
          text: 'AI 没能看懂这张图：' + failReason +
                '\n如果这个模型不支持看图，请换一个支持视觉的模型，或者把图里的字打出来。'
        });
        renderChat();
        return;
      }

      const parsed = parseActivityText(text);
      dropPending(thinking);
      deliverParsed(parsed ? [parsed] : [], {
        text: '刚才没连上 AI（' + failReason + '），我先用本机规则看了看：',
        source: '规则识别（AI 调用失败）',
        sourceText: text,
        action: 'new',
        retryText: text,
        failed: true
      });
      return;
    }

    // ---------- 没配 AI：只能走本机规则，聊不了天 ----------
    if (imageDataUrl) {
      dropPending(thinking);
      pushChat({
        role: 'ai',
        text: '看图片需要 AI：请在下面「AI 识别设置」里填一个支持看图的模型（比如 gpt-4o、qwen-vl-max）。不填的话，请把图里的字打出来。'
      });
      renderChat();
      return;
    }

    const parsed = parseActivityText(text);
    const willConfirm = aiNeedsConfirm();
    dropPending(thinking);
    deliverParsed(parsed ? [parsed] : [], {
      text: parsed
        ? (willConfirm
            ? '我先用本机规则认出了这条，点「记下」再写进列表。想让我真的会聊天，在下面填个 API Key。'
            : '我先用本机规则记下了。想让我真的会聊天，在下面填个 API Key。')
        : '我没读出日期，先不写进列表——你说个时间，比如「10月25日下午三点」。\n（想让我真的能聊天，得在下面「AI 识别设置」里填一个 API Key。）',
      source: '规则识别（没配 AI，用的是本机规则）',
      sourceText: text,
      action: 'new'
    });
  } finally {
    setChatBusy(false);
  }
}

/**
 * 请求还没回来时，把发送按钮按住。
 * 聊天是有先后顺序的 —— 两条同时发出去，回来的顺序可能是反的。
 */
function setChatBusy(on) {
  chatBusy = on;
  const btn = document.getElementById('chat-send');
  if (!btn) return;
  btn.disabled = on;
  btn.textContent = on ? '…' : '发送';
}

/** 点「发送」 */
function sendChat() {
  if (chatBusy) return;
  const box = document.getElementById('chat-text');
  if (!box) return;
  const text = box.value.trim();
  if (text === '') return;
  box.value = '';
  box.style.height = '';   // 收回一行高
  box.focus();
  askAI(text);
}

/**
 * 读 .docx。
 * .docx 本质是个 zip，正文在 word/document.xml 里。
 * 用浏览器自带的 DecompressionStream 解压，**不需要任何第三方库，也不联网**。
 */
async function readDocxText(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);

  // 从文件末尾往前找 zip 的「中央目录结束标记」 PK\x05\x06
  let eocd = -1;
  const stop = Math.max(0, u8.length - 65558);
  for (let i = u8.length - 22; i >= stop; i--) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 docx');

  const cdCount = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  let target = null;

  // 遍历中央目录，找 word/document.xml
  for (let n = 0; n < cdCount; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;

    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    // 有些工具（比如 .NET 的打包 API）会用反斜杠做路径分隔符，
    // 而标准 .docx 用正斜杠 —— 统一成正斜杠再比，两种都认。
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen))
      .replace(/\\/g, '/');

    if (name === 'word/document.xml') {
      target = { method, compSize, localOffset };
      break;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (!target) throw new Error('docx 里没找到正文');

  // 本地文件头的长度和中央目录里的可能不一样，得重新算数据起点
  const lo = target.localOffset;
  const lNameLen = dv.getUint16(lo + 26, true);
  const lExtraLen = dv.getUint16(lo + 28, true);
  const dataStart = lo + 30 + lNameLen + lExtraLen;
  const compressed = u8.subarray(dataStart, dataStart + target.compSize);

  let xmlBytes;
  if (target.method === 0) {
    xmlBytes = compressed;                       // 没压缩，直接用
  } else if (target.method === 8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('这个浏览器不支持解压 docx，请把文字复制出来粘贴');
    }
    const stream = new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    throw new Error('docx 用了不支持的压缩方式');
  }

  const xml = new TextDecoder('utf-8').decode(xmlBytes);
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/**
 * 从 PDF 里尽量把文字抠出来。
 *
 * ⚠️ 这是「尽力而为」：PDF 的字体编码五花八门，中文 PDF 常用 CID 字体，
 * 抠出来很可能是乱码。所以调用方会先做可读性检查（looksReadable），
 * 不合格就老老实实让用户复制文字，而不是硬塞一段乱码进去。
 */
async function readPdfText(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const latin = new TextDecoder('latin1').decode(u8);   // 单字节解码，方便按结构找

  const pieces = [];
  const re = /stream\r?\n/g;
  let m;

  while ((m = re.exec(latin)) !== null) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) continue;

    // 看这段流前面的字典里有没有 FlateDecode
    const dictStart = latin.lastIndexOf('<<', m.index);
    const dict = dictStart >= 0 ? latin.slice(dictStart, m.index) : '';
    const raw = u8.subarray(start, end);

    let content = null;

    if (/FlateDecode/.test(dict) && typeof DecompressionStream !== 'undefined') {
      try {
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate'));
        const out = new Uint8Array(await new Response(stream).arrayBuffer());
        content = new TextDecoder('latin1').decode(out);
      } catch (err) {
        content = null;
      }
    }

    if (content === null) content = new TextDecoder('latin1').decode(raw);

    // 只处理看起来像内容流的那些
    if (/BT|Tj|TJ/.test(content)) pieces.push(extractPdfStrings(content));
  }

  return pieces.join('').replace(/\s+/g, ' ').trim();
}

/** 从 PDF 内容流里抠出文字串 */
function extractPdfStrings(content) {
  let out = '';
  let m;

  // (文字) Tj / (文字) '
  const re = /\((?:\\.|[^\\()])*\)\s*(?:Tj|TJ|'|")/g;
  while ((m = re.exec(content)) !== null) out += decodePdfString(m[0]);

  // [ (a) -100 (b) ] TJ
  const re2 = /\[((?:[^\[\]]|\\.)*)\]\s*TJ/g;
  while ((m = re2.exec(content)) !== null) {
    const r3 = /\((?:\\.|[^\\()])*\)/g;
    let mm;
    while ((mm = r3.exec(m[1])) !== null) out += decodePdfString(mm[0]);
  }

  return out;
}

function decodePdfString(s) {
  const body = s.slice(1, s.lastIndexOf(')'));
  return body
    .replace(/\\([nrtbf()\\])/g, (_, c) => ({
      n: '\n', r: '\r', t: '\t', b: '\b', '(': '(', ')': ')', '\\': '\\'
    }[c] || c))
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

/** 抠出来的东西像不像正常文字（主要是防乱码） */
function looksReadable(text) {
  if (!text || text.length < 4) return false;

  let good = 0;
  for (const ch of text) {
    if (/[一-龥A-Za-z0-9\s，。、：；！？（）《》【】()\-–—.,:;!?%#\/]/.test(ch)) good++;
  }
  return good / text.length > 0.6;
}

/**
 * 把识别结果填进表单 —— 只有用户点了「填入表单」才调用。
 * 名称/日期/时间/类别直接覆盖；备注只在空着的时候才用原文填，
 * 免得把你已经写好的备注冲掉。
 */
function applyParsedToForm(got, text) {
  // 日期再校验一次：AI 或规则都可能给出不存在的日期，
  // 直接塞进 <input type="date"> 会被浏览器拒收，界面上就变成 NaN。
  const dateVal = isValidDateStr(got.date) ? got.date : todayStr();

  document.getElementById('input-title').value = got.title || '';
  document.getElementById('input-date').value = dateVal;
  document.getElementById('input-start').value = got.startTime || '';
  document.getElementById('input-end').value = got.endTime || '';

  const noteBox = document.getElementById('input-note');
  if (noteBox.value.trim() === '' && text) {
    noteBox.value = String(text).slice(0, 500);
  }

  if (tags.indexOf(got.tag) !== -1) {
    currentTag = got.tag;
    saveLastTag(currentTag);
    renderTagPicker();
  }

  clearFieldErrors();
}

/**
 * 把识别出来的活动**直接写进列表** —— 用户不用点任何按钮。
 * 返回 { kind, id, before? }，kind 是 created / updated / duplicate。
 * 名称或日期缺一个就返回 null，一个字都不写（宁可让它再问一句）。
 */
function autoSaveActivity(a, action) {
  if (!a || !a.title || !isValidDateStr(a.date)) return null;

  // 说的是「改」，而且那一条还在 → 就地更新，绝不新加一条
  if (action === 'edit' && chatContext.eventId) {
    const ev = events.find(e => e.id === chatContext.eventId);
    if (ev) {
      const before = {
        title: ev.title, date: ev.date,
        startTime: ev.startTime || '', endTime: ev.endTime || '', tag: ev.tag
      };
      ev.title = a.title;
      ev.date = a.date;
      ev.startTime = a.startTime || '';
      ev.endTime = a.endTime || '';
      if (tags.indexOf(a.tag) !== -1) ev.tag = a.tag;
      // 只有模型明确给了提前量才改，别把用户设的提醒顺手清掉
      if (Number(a.remindMin) > 0 || Number(a.remindMin) === -1) ev.remindMin = Number(a.remindMin);

      saveEvents();
      flashSaved(ev.id);
      return { kind: 'updated', id: ev.id, before: before };
    }
  }

  // 一模一样的不存第二遍 —— 模型有时会把上一轮的东西再复述一次
  const dup = events.find(e =>
    e.title === a.title && e.date === a.date &&
    (e.startTime || '') === (a.startTime || ''));
  if (dup) {
    chatContext.eventId = dup.id;
    return { kind: 'duplicate', id: dup.id };
  }

  const ev = {
    id: 'e-' + Date.now(),
    title: a.title,
    date: a.date,
    startTime: a.startTime || '',
    endTime: a.endTime || '',
    tag: tags.indexOf(a.tag) !== -1 ? a.tag : FALLBACK_TAG,
    note: '',                      // 备注留空：对话里的原话不往这儿塞
    remindMin: Number.isFinite(Number(a.remindMin)) ? Number(a.remindMin) : 0,
    status: 'todo',
    createdAt: Date.now()
  };
  events.push(ev);
  saveEvents();

  chatContext.eventId = ev.id;
  flashSaved(ev.id);               // 让列表里那条闪一下，看得见它落进去了
  return { kind: 'created', id: ev.id };
}

/**
 * 让指定那条卡片高亮一下，1.2 秒后自动取消。
 * 不清掉的话，之后每次重画列表它都会再闪一次。
 */
function flashSaved(id) {
  lastSavedId = id;
  if (typeof setTimeout !== 'function') return;
  setTimeout(() => {
    if (lastSavedId !== id) return;
    lastSavedId = null;
    renderList();
  }, 1200);
}

/**
 * 一次把好几条写进列表（一句话交代了三件事那种）。
 * 每条单独走 autoSaveActivity，查重、flash 都是现成的。
 * 返回 { kind:'batch', items:[{kind,id,before?}] }，一条都没动就返回 null。
 */
function saveBatch(list, action) {
  const items = [];
  (list || []).forEach((a, i) => {
    // 「改」只作用在上一轮那一条上；同一批里的其余各条都按新条目处理
    const itemAction = action === 'edit' && i === 0 ? 'edit' : 'new';
    const saved = autoSaveActivity(a, itemAction);
    if (saved) items.push(saved);
  });
  if (!items.length) return null;
  return { kind: 'batch', items: items };
}

/**
 * 识别结果的统一出口。
 * - 自动模式（默认）：新活动立刻入库，改状态/改字段也立刻做；
 * - 确认模式：全都先挂在气泡上，等用户点头；
 * - 删除无论哪种模式都要用户点一下。
 */
function deliverParsed(list, opts) {
  opts = opts || {};
  const acts = (list || []).filter(Boolean);
  const ops = Array.isArray(opts.ops) ? opts.ops : [];

  const msg = {
    role: 'ai',
    text: opts.text || (acts.length ? '记下了。' : (ops.length ? '好。' : '我在。')),
    thinking: opts.thinking || '',
    parsed: acts[0] || null,
    parsedList: acts,
    source: opts.source || '',
    sourceText: opts.sourceText || '',
    retryText: opts.retryText || '',
    failed: !!opts.failed
  };

  if (acts.length) {
    if (aiNeedsConfirm()) {
      msg.pending = acts;
      msg.decisions = acts.map(() => null);   // null=待定 / 'saved' / 'skipped'
      msg.savedItems = [];
      msg.confirmAction = opts.action === 'edit' ? 'edit' : 'new';
    } else {
      msg.saved = saveBatch(acts, opts.action || 'new');
    }
  }

  if (ops.length) {
    msg.ops = ops;
    msg.opState = ops.map(() => null);        // null=待定 / 'done' / 'skipped'
    msg.opUndo = ops.map(() => null);

    // 自动模式下能直接做的先做掉；删除永远留给人点
    if (!aiNeedsConfirm()) {
      ops.forEach((op, i) => {
        if (op.kind !== 'delete') applyOp(msg, i);
      });
    }
  }

  pushChat(msg);
  if (msg.saved || (msg.opState || []).some(s => s === 'done')) renderAll();
  renderChat();
  return msg;
}

/* ---------- 对已有记录的操作（完成 / 改回 / 删除 / 修改） ---------- */

/** 这一行操作怎么说人话 */
function describeOp(op) {
  if (!op) return '';
  const ids = op.kind === 'update' ? [op.evId] : (op.evIds || []);
  const names = ids
    .map(id => {
      const ev = events.find(e => e.id === id);
      return ev ? ev.title : '（已不在了）';
    })
    .filter(Boolean);

  const what =
    op.kind === 'complete' ? '标记完成' :
    op.kind === 'reopen'   ? '改回未开始' :
    op.kind === 'delete'   ? '删除' :
                             '修改';

  if (op.kind === 'update' && op.patch) {
    const bits = [];
    if (op.patch.date) bits.push(op.patch.date);
    if (op.patch.startTime) bits.push(op.patch.startTime + (op.patch.endTime ? '–' + op.patch.endTime : ''));
    if (op.patch.title) bits.push('「' + op.patch.title + '」');
    if (op.patch.tag) bits.push('#' + op.patch.tag);
    if (op.patch.remindMin !== undefined) {
      bits.push(Number(op.patch.remindMin) === -1 ? '不提醒' :
        Number(op.patch.remindMin) === 0 ? '到点提醒' : '提前 ' + op.patch.remindMin + ' 分钟');
    }
    return what + '：' + names.join('、') + (bits.length ? ' → ' + bits.join(' ') : '');
  }

  return what + '：' + names.join('、');
}

/**
 * 真正执行第 i 条操作，并把「怎么撤回去」记下来。
 * 返回是否动了数据。
 */
function applyOp(msg, i) {
  const op = msg && msg.ops && msg.ops[i];
  if (!op) return false;
  if (msg.opState && msg.opState[i]) return false;   // 已经决定过了

  const markSkipped = () => {
    msg.opState[i] = 'skipped';
    return false;
  };

  if (op.kind === 'complete' || op.kind === 'reopen') {
    const before = [];
    (op.evIds || []).forEach(id => {
      const ev = events.find(e => e.id === id);
      if (!ev) return;
      before.push({ id: ev.id, status: statusOf(ev) });
      ev.status = op.kind === 'complete' ? 'done' : 'todo';
    });
    if (!before.length) return markSkipped();
    msg.opUndo[i] = { kind: 'status', items: before };
  } else if (op.kind === 'delete') {
    const before = [];
    (op.evIds || []).forEach(id => {
      const idx = events.findIndex(e => e.id === id);
      if (idx === -1) return;
      const ev = events[idx];
      before.push({ id: ev.id, snapshot: Object.assign({}, ev) });
      events.splice(idx, 1);
      if (editingId === ev.id) resetForm();
      // 和手动删除一样：收进「已删除」历史，随时能恢复
      deleted.push(Object.assign({}, ev, { deletedAt: Date.now() }));
    });
    if (!before.length) return markSkipped();
    saveDeleted();
    msg.opUndo[i] = { kind: 'delete', items: before };
  } else if (op.kind === 'update') {
    const ev = events.find(e => e.id === op.evId);
    if (!ev) return markSkipped();
    const before = {
      id: ev.id,
      fields: { title: ev.title, date: ev.date, startTime: ev.startTime || '', endTime: ev.endTime || '', tag: ev.tag }
    };
    const patch = op.patch || {};
    if (patch.title) ev.title = patch.title;
    if (patch.date) ev.date = patch.date;
    if (patch.startTime !== undefined) ev.startTime = patch.startTime;
    if (patch.endTime !== undefined) ev.endTime = patch.endTime;
    if (patch.tag) ev.tag = patch.tag;
    if (patch.remindMin !== undefined) ev.remindMin = patch.remindMin;
    msg.opUndo[i] = { kind: 'fields', items: [before] };
  } else {
    return markSkipped();
  }

  msg.opState[i] = 'done';
  saveEvents();
  renderAll();
  return true;
}

/** 把这一批里还没做的操作全做掉 */
function runPendingOps(msg) {
  if (!msg || !Array.isArray(msg.ops)) return;
  let changed = false;
  msg.ops.forEach((op, i) => {
    if (msg.opState[i]) return;
    if (applyOp(msg, i)) changed = true;
  });
  if (changed) renderAll();
  renderChat();
}

/** 撤销某一条操作 */
function undoOp(msg, i) {
  const u = msg && msg.opUndo && msg.opUndo[i];
  if (!u) return;

  if (u.kind === 'status') {
    u.items.forEach(x => {
      const ev = events.find(e => e.id === x.id);
      if (ev) ev.status = x.status;
    });
  } else if (u.kind === 'fields') {
    u.items.forEach(x => {
      const ev = events.find(e => e.id === x.id);
      if (ev) Object.assign(ev, x.fields);
    });
  } else if (u.kind === 'delete') {
    u.items.forEach(x => {
      const di = deleted.findIndex(d => d.id === x.id);
      if (di !== -1) deleted.splice(di, 1);
      if (!events.some(e => e.id === x.id)) events.push(Object.assign({}, x.snapshot));
    });
    saveDeleted();
  }

  msg.opState[i] = null;
  msg.opUndo[i] = null;
  saveEvents();
  renderAll();
  renderChat();
}

/** 撤销这一批里所有已执行的操作 */
function undoAllOps(msg) {
  if (!msg || !Array.isArray(msg.ops)) return;
  msg.ops.forEach((op, i) => {
    if (msg.opState[i] === 'done' && msg.opUndo[i]) {
      const u = msg.opUndo[i];
      if (u.kind === 'status') u.items.forEach(x => { const ev = events.find(e => e.id === x.id); if (ev) ev.status = x.status; });
      if (u.kind === 'fields') u.items.forEach(x => { const ev = events.find(e => e.id === x.id); if (ev) Object.assign(ev, x.fields); });
      if (u.kind === 'delete') u.items.forEach(x => {
        const di = deleted.findIndex(d => d.id === x.id);
        if (di !== -1) deleted.splice(di, 1);
        if (!events.some(e => e.id === x.id)) events.push(Object.assign({}, x.snapshot));
      });
      msg.opState[i] = null;
      msg.opUndo[i] = null;
    }
  });
  saveDeleted();
  saveEvents();
  renderAll();
  renderChat();
}

/** 确认模式下：点某一行的「记下」 */
function confirmOne(msg, i) {
  if (!msg || !Array.isArray(msg.pending)) return;
  if (msg.decisions[i]) return;             // 已经决定过了

  const action = msg.confirmAction === 'edit' && i === 0 ? 'edit' : 'new';
  const item = autoSaveActivity(msg.pending[i], action);
  if (item) {
    msg.savedItems = msg.savedItems || [];
    msg.savedItems.push(item);
    msg.decisions[i] = 'saved';
  } else {
    msg.decisions[i] = 'skipped';
  }

  if (msg.savedItems && msg.savedItems.length) renderAll();
  renderChat();
}

/** 确认模式下：批量同意（剩下没决定的全部入库） */
function confirmAllPending(msg) {
  if (!msg || !Array.isArray(msg.pending)) return;

  let added = 0;
  msg.pending.forEach((a, i) => {
    if (msg.decisions[i]) return;
    const action = msg.confirmAction === 'edit' && i === 0 ? 'edit' : 'new';
    const item = autoSaveActivity(a, action);
    if (item) {
      msg.savedItems = msg.savedItems || [];
      msg.savedItems.push(item);
      msg.decisions[i] = 'saved';
      added++;
    } else {
      msg.decisions[i] = 'skipped';
    }
  });

  if (added) renderAll();
  renderChat();
}

/** 确认模式下：都不要 */
function skipAllPending(msg) {
  if (!msg || !Array.isArray(msg.pending)) return;
  msg.decisions = msg.pending.map(() => 'skipped');
  renderChat();
}

/**
 * 撤掉一批已经写进去的记录（确认模式和自动模式共用）。
 * 返回是否真的动过数据。
 */
function undoSavedItems(items) {
  let touched = false;

  (items || []).forEach(it => {
    if (!it) return;

    if (it.kind === 'created') {
      const i = events.findIndex(e => e.id === it.id);
      if (i !== -1) {
        events.splice(i, 1);
        touched = true;
      }
    } else if (it.kind === 'updated' && it.before) {
      const ev = events.find(e => e.id === it.id);
      if (ev) {
        ev.title = it.before.title;
        ev.date = it.before.date;
        ev.startTime = it.before.startTime;
        ev.endTime = it.before.endTime;
        ev.tag = it.before.tag;
        touched = true;
      }
    }

    // 这一轮对话别再指着那条了，否则下一句「改成周五」会改到一条不存在的记录
    if (chatContext.eventId === it.id) chatContext.eventId = null;
  });

  return touched;
}

/** 确认模式下的「撤销」：把已入库的那几条撤掉，并让它们回到待确认 */
function undoPendingSave(msg) {
  if (!msg || !Array.isArray(msg.savedItems) || !msg.savedItems.length) return;
  if (!undoSavedItems(msg.savedItems)) return;

  lastSavedId = null;
  msg.savedItems = [];
  msg.decisions = (msg.pending || []).map(() => null);

  saveEvents();
  renderAll();
  renderChat();
}

/** 自动记错了？一键撤回（一条或一整批） */
function undoChatSave(msg) {
  const s = msg && msg.saved;
  if (!s) return;

  const items = Array.isArray(s.items)
    ? s.items
    : (s.kind === 'created' || s.kind === 'updated' ? [s] : []);
  if (!items.length) return;

  if (!undoSavedItems(items)) return;

  lastSavedId = null;

  saveEvents();
  renderAll();

  msg.saved = { kind: 'undone' };
  renderChat();
}

/** 接上四种入口：发送按钮、Enter、选文件、拖拽、粘贴 */
function setupChat() {
  const send = document.getElementById('chat-send');
  const textBox = document.getElementById('chat-text');
  const attach = document.getElementById('chat-attach');
  const fileInput = document.getElementById('chat-file');
  const log = document.getElementById('chat-log');

  if (send) send.addEventListener('click', sendChat);

  if (textBox) {
    textBox.addEventListener('keydown', ev => {
      // Enter 发送，Shift+Enter 换行
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        sendChat();
      }
    });

    // 打长句子时输入框自己长高，最多长到 CSS 里的 96px
    textBox.addEventListener('input', () => {
      textBox.style.height = 'auto';
      textBox.style.height = Math.min(96, textBox.scrollHeight) + 'px';
    });
  }

  if (attach && fileInput) {
    attach.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      handleChatFile(f);
      fileInput.value = '';
    });
  }

  // 拖拽到整个对话块（含输入行）都算数，不用非得瞄准上面那一小块
  const chatBox = document.getElementById('chat');
  if (chatBox && log) {
    ['dragenter', 'dragover'].forEach(name => {
      chatBox.addEventListener(name, ev => {
        ev.preventDefault();
        log.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      chatBox.addEventListener(name, ev => {
        ev.preventDefault();
        log.classList.remove('over');
      });
    });

    chatBox.addEventListener('drop', ev => {
      const dt = ev.dataTransfer;
      if (!dt) return;

      if (dt.files && dt.files.length > 0) {
        handleChatFile(dt.files[0]);
        return;
      }
      const text = dt.getData('text/plain');
      if (text) askAI(text);
    });
  }

  // 在页面空白处粘贴也能进来；焦点在输入框里时不抢，免得影响正常粘贴
  document.addEventListener('paste', ev => {
    const el = document.activeElement;
    const tagName = el && el.tagName ? el.tagName : '';
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') return;

    const text = ev.clipboardData && ev.clipboardData.getData('text');
    if (text) {
      ev.preventDefault();
      askAI(text);
    }
  });

  renderChat();
}

/** 把文件读成文字或图片，再交给对话 */
async function handleChatFile(f) {
  const name = (f.name || '').toLowerCase();
  const type = f.type || '';

  if (f.size > 10 * 1024 * 1024) {
    pushChat({ role: 'ai', text: '文件太大了（超过 10MB），先截一小段或压缩一下。' });
    renderChat();
    return;
  }

  // 图片 → 直接带 base64 给 AI 看
  if (type.indexOf('image/') === 0 || /\.(png|jpe?g|webp|gif|bmp)$/.test(name)) {
    if (f.size > 4 * 1024 * 1024) {
      pushChat({ role: 'ai', text: '图片太大了（超过 4MB），先压缩一下再拖。' });
      renderChat();
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(f);
      await askAI('', dataUrl, f.name);
    } catch (err) {
      pushChat({ role: 'ai', text: '读不了这张图：' + err.message });
      renderChat();
    }
    return;
  }

  // docx → 本地解压读正文
  if (/\.docx$/.test(name)) {
    try {
      const text = await readDocxText(f);
      await askAI(text, null, f.name);
    } catch (err) {
      pushChat({ role: 'ai', text: '读不了这个 docx：' + err.message });
      renderChat();
    }
    return;
  }

  // 老式 Office
  if (/\.(doc|xls|ppt)$/.test(name)) {
    pushChat({ role: 'ai', text: '老式 Office 格式（.doc/.xls/.ppt）本地解析不了。请另存为 .docx 或复制文字后再试。' });
    renderChat();
    return;
  }

  // pdf → 尽力抠文字；抠出来是乱码就如实说
  if (/\.pdf$/.test(name)) {
    const extracting = { role: 'ai', text: '正在从 PDF 里提取文字…', pending: true };
    pushChat(extracting);
    renderChat();
    try {
      const text = await readPdfText(f);
      dropPending(extracting);
      if (looksReadable(text)) {
        await askAI(text, null, f.name);
      } else {
        pushChat({
          role: 'ai',
          text: '这个 PDF 里的文字提取出来是乱码（多半嵌了特殊字体）。请把文字复制出来再粘贴，或者截个图拖进来（需要配 AI）。'
        });
        renderChat();
      }
    } catch (err) {
      dropPending(extracting);
      pushChat({ role: 'ai', text: '读不了这个 PDF：' + err.message + '。请把文字复制出来再粘贴。' });
      renderChat();
    }
    return;
  }

  // 其余：一律先当成 UTF-8 文本试着读
  try {
    const text = await readFileAsText(f);
    const bad = (text.match(/�/g) || []).length;

    if (text.trim() === '' || bad / Math.max(text.length, 1) > 0.02) {
      pushChat({
        role: 'ai',
        text: '这个文件不是纯文本，读不出文字。已支持：.txt .md .csv .docx .pdf 和图片；其他格式请把内容复制出来粘贴。'
      });
      renderChat();
      return;
    }

    await askAI(text, null, f.name);
  } catch (err) {
    pushChat({ role: 'ai', text: '读不了这个文件：' + err.message });
    renderChat();
  }
}

function readFileAsDataUrl(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('读不了这个文件'));
    r.readAsDataURL(f);
  });
}

function readFileAsText(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('读不了这个文件'));
    r.readAsText(f, 'UTF-8');
  });
}


/* ---------- ④之六 拖拽调整左右栏宽度 ---------- */

const CAL_W_KEY = 'campus_cal_w_v1';   // 记住上次拖到的宽度
const MIN_CAL_W = 320;                 // 日历栏最小宽度
const MIN_LIST_W = 400;                // 右侧列表最小宽度

/**
 * 把想要的宽度夹在合理范围内。
 * 76 = 左右内边距(16+16) + 分隔条(12) + 两个栅格间隙(16+16)
 */
function clampCalWidth(px, containerWidth) {
  const max = Math.max(MIN_CAL_W, containerWidth - MIN_LIST_W - 76);
  return Math.max(MIN_CAL_W, Math.min(px, max));
}

/**
 * 左右栏之间那条分隔条的拖拽。
 * 用 Pointer Events 一套代码覆盖鼠标、触屏和手写笔。
 *
 * 流体质感：鼠标的位置是「目标宽度」，日历栏真正的宽度是「当前宽度」，
 * 每帧让当前宽度去追目标宽度。追的过程用弹簧算，于是——
 *   · 拖得越快，日历栏落后得越多，像被拽着甩出去
 *   · 分隔条中间那颗水珠被拉长，松手时弹回去
 *   · 松手会有一点过冲再回来，不是「啪」地一下停死
 * 开了「减少动态效果」的系统设置就直接跟手，不做这些。
 */
function setupSplitter() {
  const splitter = document.getElementById('splitter');
  const wrap = document.getElementById('wrap');
  if (!splitter || !wrap) return;

  let dragging = false;

  let targetW = 0;      // 鼠标/手指要求多宽
  let curW = 0;         // 日历栏现在多宽
  let vel = 0;          // 弹簧的速度
  let fluidRaf = 0;
  let frame = 0;
  let initialized = false;

  const reduced = prefersReducedMotion();

  function paint(w) {
    wrap.style.setProperty('--cal-w', w + 'px');
  }

  function setTarget(px) {
    targetW = clampCalWidth(px, wrap.clientWidth);

    // 第一次（读存档）和「减少动态效果」都直接贴上去，不从 0 飞过来
    if (reduced || !initialized) {
      initialized = true;
      curW = targetW;
      vel = 0;
      paint(curW);
      return targetW;
    }

    if (!fluidRaf && typeof requestAnimationFrame === 'function') {
      fluidRaf = requestAnimationFrame(stepFluid);
    } else if (typeof requestAnimationFrame !== 'function') {
      curW = targetW;
      paint(curW);
    }
    return targetW;
  }

  function stepFluid() {
    fluidRaf = 0;

    const gap = targetW - curW;

    // 贴上目标、也没有余速 → 真正停下
    if (Math.abs(gap) < 0.3 && Math.abs(vel) < 0.3) {
      curW = targetW;
      vel = 0;
      paint(curW);
      splitter.style.removeProperty('--stretch');
      renderCalendar();            // 停稳后再算一次，确认格子够不够宽显示任务
      return;
    }

    vel += gap * 0.28;
    vel *= 0.56;                   // 阻尼；越接近 0.5 越「黏」，越像糖浆
    curW += vel;

    paint(curW);

    // 速度越快，中间那颗水珠被拉得越长
    const stretch = Math.min(1.6, Math.abs(vel) / 12);
    splitter.style.setProperty('--stretch', stretch.toFixed(3));

    // 日历每两帧重算一次就够，别把主线程占满
    if ((frame++ & 1) === 0) renderCalendar();

    fluidRaf = requestAnimationFrame(stepFluid);
  }

  splitter.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    initialized = true;
    dragging = true;
    splitter.classList.add('dragging');
    document.body.classList.add('dragging-col');
    if (splitter.setPointerCapture) {
      try { splitter.setPointerCapture(ev.pointerId); } catch (err) { /* 忽略 */ }
    }
  });

  splitter.addEventListener('pointermove', ev => {
    if (!dragging) return;
    const rect = wrap.getBoundingClientRect();
    // 38 = 左内边距 16 + 间隙 16 + 分隔条一半 6
    setTarget(ev.clientX - rect.left - 38);
  });

  function stopDrag() {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    document.body.classList.remove('dragging-col');

    // 存「目标宽度」，不是这一帧正在弹跳的临时宽度
    try {
      if (targetW) localStorage.setItem(CAL_W_KEY, String(Math.round(targetW)));
    } catch (err) { /* 记不住就算了 */ }
  }

  splitter.addEventListener('pointerup', stopDrag);
  splitter.addEventListener('pointercancel', stopDrag);

  // 键盘也能调 —— 不用鼠标的人同样能用
  splitter.addEventListener('keydown', ev => {
    const cur = parseInt(wrap.style.getPropertyValue('--cal-w'), 10)
             || Math.round(wrap.clientWidth * 0.4);
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); setTarget(cur - 24); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); setTarget(cur + 24); }
  });

  // 恢复上次拖到的宽度
  try {
    const saved = parseInt(localStorage.getItem(CAL_W_KEY), 10);
    if (saved && !isNaN(saved)) setTarget(saved);
  } catch (err) { /* 没有就算了 */ }
}


/* ---------- ⑤ 交互动作 ---------- */

/** 检查表单。有问题就标红、写提示、把光标移过去，并返回 false */
function validateForm() {
  const titleBox = document.getElementById('input-title');
  const dateBox = document.getElementById('input-date');
  const titleErr = document.getElementById('error-title');
  const dateErr = document.getElementById('error-date');

  clearFieldErrors();

  let firstBad = null;

  if (titleBox.value.trim() === '') {
    titleBox.classList.add('invalid');
    titleErr.textContent = '请填写活动名称';
    firstBad = firstBad || titleBox;
  }

  if (dateBox.value === '') {
    dateBox.classList.add('invalid');
    dateErr.textContent = '请选择活动日期';
    firstBad = firstBad || dateBox;
  } else {
    // 日期兜底：正常用日期选择器不会出错，但手改 value / 粘贴进来时
    // 可能是 2026-13-45 这种明显不存在的日期
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateBox.value);
    const year = ymd ? Number(ymd[1]) : 0;
    if (!ymd || year < 2000 || year > 2100) {
      dateBox.classList.add('invalid');
      dateErr.textContent = '这个日期不太对（支持 2000–2100 年）';
      firstBad = firstBad || dateBox;
    }
  }

  // 时间：整体可以不填（= 全天）。填了结束时间就必须有开始时间，
  // 而且"HH:MM"这种格式可以直接按字符串比大小。
  const startBox = document.getElementById('input-start');
  const endBox = document.getElementById('input-end');
  const timeErr = document.getElementById('error-time');

  if (endBox.value !== '' && startBox.value === '') {
    startBox.classList.add('invalid');
    timeErr.textContent = '填了结束时间，也要填开始时间';
    firstBad = firstBad || startBox;
  } else if (startBox.value !== '' && endBox.value !== '' && endBox.value <= startBox.value) {
    endBox.classList.add('invalid');
    timeErr.textContent = '结束时间要晚于开始时间';
    firstBad = firstBad || endBox;
  }

  if (firstBad) {
    firstBad.focus();
    return false;
  }
  return true;
}

/** 「已经有一条一模一样的了」：给出可见提示，并留一个「仍然要存」的出口 */
function showDupWarning(ev) {
  const box = document.getElementById('dup-warning');
  if (!box) return;

  box.hidden = false;
  box.textContent = '';

  const text = document.createElement('span');
  text.className = 'dup-text';
  text.textContent = '已经有一条一样的了：' + formatDateCN(ev.date) + ' ' +
    (ev.startTime || '全天') + ' · ' + ev.title + '。';

  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'dup-again';
  again.textContent = '仍然要存';
  again.addEventListener('click', () => {
    allowDupOnce = true;
    const form = document.getElementById('event-form');
    if (form) form.requestSubmit();
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'dup-cancel';
  cancel.textContent = '算了';
  cancel.addEventListener('click', hideDupWarning);

  box.append(text, again, cancel);
  if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
}

function hideDupWarning() {
  const box = document.getElementById('dup-warning');
  if (!box) return;
  box.hidden = true;
  box.textContent = '';
}

/** 点「存一条」或「保存修改」——两种情况走同一个出口 */
function handleSubmit(e) {
  e.preventDefault();

  // 连点两次 / 回车重复提交：600ms 内只认第一下
  if (saveLock) return;

  if (!validateForm()) return;

  saveLock = true;
  setTimeout(() => { saveLock = false; }, 600);

  const titleBox = document.getElementById('input-title');
  const dateBox = document.getElementById('input-date');
  const startBox = document.getElementById('input-start');
  const endBox = document.getElementById('input-end');
  const noteBox = document.getElementById('input-note');
  const remindBox = document.getElementById('input-remind');
  const remindMin = remindBox ? Number(remindBox.value) : 0;

  const wasEditing = editingId !== null;

  // 一模一样的一条已经存在：不静默吞掉，也不直接存，给个可见的提示
  if (!wasEditing && !allowDupOnce) {
    const dup = events.find(x =>
      x.title === titleBox.value.trim() &&
      x.date === dateBox.value &&
      (x.startTime || '') === startBox.value);
    if (dup) {
      saveLock = false;
      showDupWarning(dup);
      return;
    }
  }
  allowDupOnce = false;
  hideDupWarning();

  let savedId = null;

  if (wasEditing) {
    // 编辑模式：就地更新原来那条。id 和 createdAt 都不动，
    // 所以它在列表里的位置、状态、是不是被筛出来，全都保持原样。
    const target = events.find(x => x.id === editingId);
    if (target) {
      target.title = titleBox.value.trim();
      target.date = dateBox.value;
      target.startTime = startBox.value;
      target.endTime = endBox.value;
      target.tag = currentTag;
      target.note = noteBox.value.trim();
      target.remindMin = remindMin;
      savedId = target.id;
    }
  } else {
    savedId = 'e-' + Date.now();
    events.push({
      id: savedId,
      title: titleBox.value.trim(),
      date: dateBox.value,
      startTime: startBox.value,   // "HH:MM"，空字符串表示全天
      endTime: endBox.value,       // 可选
      tag: currentTag,
      note: noteBox.value.trim(),
      remindMin: remindMin,        // 0=到点 / 正数=提前多少分钟 / -1=不提醒
      status: 'todo',              // 新记的一律从「未开始」起步
      createdAt: Date.now(),
    });
  }

  saveEvents();

  resetForm();                   // 退出编辑状态、清空表单（类别保留上次选的）
  lastSavedId = savedId;         // 让刚存的那张卡片高亮一下
  renderAll();

  // 反馈：按钮变成「已保存 ✓」/「已保存修改 ✓」
  const btn = document.getElementById('btn-save');
  btn.textContent = wasEditing ? '已保存修改 ✓' : '已保存 ✓';
  btn.classList.add('saved');
  setTimeout(() => {
    btn.textContent = '存一条';
    btn.classList.remove('saved');
  }, 1200);

  // 等渲染完把高亮去掉
  setTimeout(() => {
    lastSavedId = null;
    renderList();
  }, 1200);
}

/**
 * 点卡片上的状态按钮：未开始 → 进行中 → 已完成 → 未开始，转一圈。
 * 一个按钮搞定三种状态，不用下拉菜单——少一个控件，也少一层操作。
 */
function cycleStatus(ev) {
  const i = STATUSES.indexOf(statusOf(ev));
  ev.status = STATUSES[(i + 1) % STATUSES.length];
  saveEvents();
  renderAll();
}

/** 清掉输入框的红框和错误提示 */
function clearFieldErrors() {
  ['input-title', 'input-date', 'input-start', 'input-end'].forEach(id => {
    document.getElementById(id).classList.remove('invalid');
  });
  document.getElementById('error-title').textContent = '';
  document.getElementById('error-date').textContent = '';
  document.getElementById('error-time').textContent = '';
}

/** 系统里如果开了「减少动态效果」，就不做动画（无障碍要求，也防止有人晕动） */
function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
         typeof window.matchMedia === 'function' &&
         window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const SHATTER_STRIPS = 5;    // 切成几条横向碎片
const SHATTER_MS = 560;      // 碎片动画总时长

/**
 * 删除时的碎裂效果：把这张卡片复制成几条横向切片，
 * 每片带着不同的倾斜和横向漂移往下掉，同时快速淡出。
 *
 * 关于「不能挡住下面的任务」：
 *   碎片是 fixed 定位的浮层，理论上会从下面的卡片上飞过。
 *   所以这里让它们在动画的 45% 之前就淡到接近透明，
 *   加上只有 0.56 秒，实际能看清的"重叠"不到 0.2 秒。
 */
function shatterCard(cardEl) {
  const rect = cardEl.getBoundingClientRect();
  if (!rect || !rect.height) return;

  const layer = document.createElement('div');
  layer.className = 'shatter-layer';
  document.body.appendChild(layer);

  for (let i = 0; i < SHATTER_STRIPS; i++) {
    const piece = cardEl.cloneNode(true);
    piece.removeAttribute('id');       // 别留下重复的 id
    piece.removeAttribute('style');

    piece.classList.add('shatter-piece');
    piece.style.position = 'fixed';
    piece.style.left = rect.left + 'px';
    piece.style.top = rect.top + 'px';
    piece.style.width = rect.width + 'px';
    piece.style.height = rect.height + 'px';
    piece.style.margin = '0';
    piece.style.pointerEvents = 'none';
    piece.style.zIndex = '60';

    // 只留这一条横向切片，其余裁掉
    const step = 100 / SHATTER_STRIPS;
    piece.style.clipPath = `inset(${step * i}% 0 ${step * (SHATTER_STRIPS - 1 - i)}% 0)`;

    // 每片往不同方向散
    piece.style.setProperty('--dx', ((i % 2 === 0 ? 1 : -1) * (10 + i * 5)) + 'px');
    piece.style.setProperty('--rot', ((i - 2) * 2.2) + 'deg');
    piece.style.animationDelay = (i * 16) + 'ms';

    layer.appendChild(piece);
  }

  setTimeout(() => layer.remove(), SHATTER_MS + 200);
}

/**
 * 点卡片上的「编辑」：把这条的内容填回上面的表单。
 * 主按钮会变成「保存修改」，再点保存时就地更新这一条，不会变成新增。
 */
function startEdit(ev) {
  editingId = ev.id;

  document.getElementById('input-title').value = ev.title;
  document.getElementById('input-date').value = ev.date;
  document.getElementById('input-start').value = ev.startTime || '';
  document.getElementById('input-end').value = ev.endTime || '';
  document.getElementById('input-note').value = ev.note || '';
  const remindBox = document.getElementById('input-remind');
  if (remindBox) remindBox.value = String(Number.isFinite(Number(ev.remindMin)) ? Number(ev.remindMin) : 0);

  // 这条用的类别万一已经被删了，退回第一个，别让表单停在空状态
  currentTag = tags.includes(ev.tag) ? ev.tag : tags[0];
  saveLastTag(currentTag);
  renderTagPicker();

  clearFieldErrors();

  document.getElementById('editing-name').textContent = ev.title;
  document.getElementById('edit-banner').hidden = false;
  document.getElementById('form-panel').classList.add('editing');
  document.getElementById('btn-save').textContent = '保存修改';
  document.getElementById('btn-sample').hidden = true;

  document.getElementById('input-title').focus();
  document.getElementById('form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 「清除名称和备注」：只清这两个框，日期/时间/类别留着 ——
 * 因为多数时候是"这条录错了想重打"，日期类别往往还是对的。
 */
function clearNameAndNote() {
  document.getElementById('input-title').value = '';
  document.getElementById('input-note').value = '';
  document.getElementById('input-title').classList.remove('invalid');
  document.getElementById('error-title').textContent = '';
  document.getElementById('input-title').focus();
}

/** 把表单还原成「新增一条」的状态（不管是保存完了还是点了取消） */
function resetForm() {
  editingId = null;

  document.getElementById('input-title').value = '';
  document.getElementById('input-date').value = todayStr();
  document.getElementById('input-start').value = '';
  document.getElementById('input-end').value = '';
  document.getElementById('input-note').value = '';
  const remindBox = document.getElementById('input-remind');
  if (remindBox) remindBox.value = '0';

  clearFieldErrors();

  document.getElementById('edit-banner').hidden = true;
  document.getElementById('form-panel').classList.remove('editing');
  document.getElementById('btn-save').textContent = '存一条';
  document.getElementById('btn-sample').hidden = false;
}

/** 点卡片上的「删除」→ 先弹确认框 */
function askDelete(ev) {
  pendingDelete = ev;
  document.getElementById('dialog-title').textContent = ev.title;
  document.getElementById('overlay').hidden = false;
  document.getElementById('btn-confirm').focus();
}

function closeDialog() {
  pendingDelete = null;
  document.getElementById('overlay').hidden = true;
}

/** 确认删除 */
function confirmDelete() {
  if (!pendingDelete) return;
  const removed = pendingDelete;
  closeDialog();

  // 真正动手的部分：删数据、退出编辑、重画、弹出撤销条
  const finish = () => {
    events = events.filter(e => e.id !== removed.id);
    // 如果正在编辑的恰好就是这条，退出编辑状态，别让表单指向一条不存在的活动
    if (editingId === removed.id) resetForm();

    // 收进「已删除」历史 —— 不是直接消失，历史里还能恢复
    deleted.push(Object.assign({}, removed, { deletedAt: Date.now() }));
    saveDeleted();

    saveEvents();
    renderAll();
    showUndo(removed);
  };

  // 先让那张卡片碎掉落下，让你看清走的是哪一张，再真正删掉。
  // 系统里开了「减少动态效果」的话就跳过动画，直接删。
  const cardEl = document.getElementById('card-' + removed.id);
  const canAnimate = !!cardEl && !!cardEl.style && !prefersReducedMotion();

  if (canAnimate) {
    if (typeof cardEl.getBoundingClientRect === 'function') shatterCard(cardEl);

    // 原件同时收拢，下面的内容会上来
    cardEl.style.maxHeight = cardEl.offsetHeight + 'px';
    void cardEl.offsetHeight;          // 强制浏览器先认下这个起始高度，否则动画不生效
    cardEl.classList.add('leaving');
    setTimeout(finish, 240);
  } else {
    finish();
  }
}

/** 底部「已删除 · 撤销」提示条，5 秒后自动消失 */
function showUndo(removed) {
  undoSnapshot = removed;

  const bar = document.getElementById('undo-bar');
  document.getElementById('undo-text').textContent = `已删除「${removed.title}」`;
  bar.hidden = false;

  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, UNDO_SECONDS * 1000);
}

function hideUndo() {
  clearTimeout(undoTimer);
  undoSnapshot = null;
  document.getElementById('undo-bar').hidden = true;
}

/** 点「撤销」：把刚删的那条放回去 */
function undoDelete() {
  if (!undoSnapshot) return;

  // 从「已删除」历史里拿掉，再放回待办
  deleted = deleted.filter(d => d.id !== undoSnapshot.id);
  saveDeleted();

  events.push(undoSnapshot);
  saveEvents();
  hideUndo();
  renderAll();
}

/** 点「载入示例数据」：走和手动保存完全相同的路径写入 4 条 */
function loadSamples() {
  // 用当前真实存在的类别，免得示例数据落到一个已经被删掉的类别上
  const t0 = tags[0];
  const t1 = tags[1] || tags[0];
  const t2 = tags[2] || tags[0];

  // 四条示例刚好覆盖三种状态、三个分组，一载入就能看全所有样式
  const samples = [
    { title: '【合成数据】职业规划讲座',     date: dateOffsetStr(3),  tag: t0, status: 'todo',
      startTime: '18:30', endTime: '20:00',
      note: '示例备注：三教 201（本条为合成数据）' },
    { title: '【合成数据】校园歌手大赛初赛', date: dateOffsetStr(10), tag: t1, status: 'doing',
      startTime: '14:00', endTime: '',
      note: '示例备注：报名截止前一天（本条为合成数据）' },
    { title: '【合成数据】图书馆整理志愿',   date: dateOffsetStr(-2), tag: t2, status: 'todo',
      startTime: '', endTime: '',
      note: '示例备注：全天活动，用来演示"不填时间"的样子（本条为合成数据）' },
    { title: '【合成数据】社团招新面试',     date: dateOffsetStr(-5), tag: t0, status: 'done',
      startTime: '09:00', endTime: '11:00',
      note: '示例备注：已完成，用来演示「已完成」的样式（本条为合成数据）' },
  ];

  samples.forEach(s => {
    events.push({
      id: 'e-' + Date.now() + '-' + Math.floor(performance.now()),
      title: s.title,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      tag: s.tag,
      note: s.note,
      status: s.status,
      createdAt: Date.now(),
    });
  });

  saveEvents();
  renderAll();
}


/* ---------- ⑤之二 到点提醒 ---------- */

// 已经提醒过的（键 = 活动id@日期@开始时间），防止每 30 秒重复提醒同一条
const remindedKeys = new Set();

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 提醒时间点 = 开始时间 - 提前量。
 * 没填具体时间（全天）或设成「不提醒」的返回 null。
 */
function remindTarget(ev) {
  if (!/^\d{2}:\d{2}$/.test(ev.startTime || '')) return null;
  const before = Number(ev.remindMin);
  if (before === -1) return null;
  const start = new Date(ev.date + 'T' + ev.startTime + ':00');
  if (isNaN(start.getTime())) return null;
  const mins = Number.isFinite(before) ? before : 0;
  return new Date(start.getTime() - mins * 60000);
}

function reminderKey(ev) {
  return `${ev.id}@${ev.date}@${ev.startTime}@${Number(ev.remindMin) || 0}`;
}

/**
 * 此刻该提醒的活动：还没标成已完成、有具体时间、已经到（或过了）提醒点。
 * 只看「30 分钟内」，避免你下午打开页面时被早上九点的活动刷屏。
 */
function dueReminders() {
  const now = Date.now();
  return events.filter(ev => {
    if (statusOf(ev) === 'done') return false;
    const t = remindTarget(ev);
    if (!t) return false;
    const d = now - t.getTime();
    return d >= 0 && d < 30 * 60000;
  });
}

/**
 * 打开页面时先跑一次，把「今天已经过点的」全部标成已提醒。
 * 不然你下午三点打开页面，会被早上九点的活动一次性刷屏。
 */
function primeReminders() {
  dueReminders().forEach(ev => remindedKeys.add(reminderKey(ev)));
}

/** 每 30 秒查一次，有新的到点活动就弹提示 */
function checkReminders() {
  dueReminders().forEach(ev => {
    const key = reminderKey(ev);
    if (remindedKeys.has(key)) return;
    remindedKeys.add(key);
    showReminder(ev);
  });
}

/** 顶部提醒条 + 尝试发系统通知 + 不依赖权限的兜底（标题闪烁 + 提示音） */
function showReminder(ev) {
  const when = ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime;

  // 说「还有多久」比说「提前多少分钟」更贴切：按真实距离算
  let lead = '';
  const start = new Date(ev.date + 'T' + (ev.startTime || '00:00') + ':00');
  if (!isNaN(start.getTime())) {
    const mins = Math.round((start.getTime() - Date.now()) / 60000);
    if (mins > 0) {
      lead = mins < 60 ? `${mins} 分钟后 ` :
             mins < 1440 ? `${Math.round(mins / 60)} 小时后 ` :
                           `${Math.round(mins / 1440)} 天后 `;
    }
  }

  const text = `${lead}${when} · ${ev.title}`;

  showBanner(text);
  showAlert(ev, lead);        // 到点弹窗：直接跳出来，需要点一下才关
  systemNotify(lead ? '活动提醒' : '活动开始了', text);
  flashTitle(when);      // 页面在后台也能看到标签页标题在闪
  beep();                // 很轻的一声，不需要任何权限
}

/* --- 到点弹窗 --- */

const alertQueue = [];
let alertBusy = false;
let currentAlert = null;
const alertSnoozeTimers = new Map();

function showAlert(ev, lead) {
  alertQueue.push({ ev: ev, lead: lead || '' });
  pumpAlerts();
}

function pumpAlerts() {
  if (alertBusy) return;
  const next = alertQueue.shift();
  if (!next) return;

  alertBusy = true;
  currentAlert = next;
  const ev = next.ev;

  const title = document.getElementById('alert-title');
  const leadBox = document.getElementById('alert-lead');
  const eventBox = document.getElementById('alert-event');

  const start = new Date(ev.date + 'T' + (ev.startTime || '00:00') + ':00');
  const mins = isNaN(start.getTime()) ? null : Math.round((start.getTime() - Date.now()) / 60000);

  if (mins !== null && mins > 0) {
    title.textContent = '再过 ' + mins + ' 分钟开始';
    leadBox.textContent = '这是提前提醒，别忘了准备。';
  } else {
    title.textContent = '活动时间到了';
    leadBox.textContent = '';
  }

  const when = ev.endTime ? `${ev.startTime}–${ev.endTime}` : (ev.startTime || '全天');
  eventBox.textContent = ev.title + '\n' + formatDateCN(ev.date) + ' ' + when;

  const overlay = document.getElementById('alert-overlay');
  overlay.hidden = false;
  document.getElementById('alert-ok').focus();
}

function closeAlert() {
  const overlay = document.getElementById('alert-overlay');
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  alertBusy = false;
  currentAlert = null;
  pumpAlerts();          // 同时到点的还有别的活动，接着弹
}

function snoozeAlert(item) {
  if (!item) return closeAlert();
  const key = reminderKey(item.ev);
  if (alertSnoozeTimers.has(key)) clearTimeout(alertSnoozeTimers.get(key));
  alertSnoozeTimers.set(key, setTimeout(() => {
    alertSnoozeTimers.delete(key);
    showAlert(item.ev, item.lead);
  }, 5 * 60000));

  closeAlert();
  showBanner('好，5 分钟后再提醒你：' + item.ev.title);
}

function completeAlert(item) {
  if (!item) return closeAlert();
  const ev = events.find(e => e.id === item.ev.id);
  if (ev && statusOf(ev) !== 'done') {
    ev.status = 'done';
    saveEvents();
    renderAll();
    showBanner('已完成：' + ev.title);
  }
  closeAlert();
}

function initAlert() {
  const ok = document.getElementById('alert-ok');
  const snooze = document.getElementById('alert-snooze');
  const done = document.getElementById('alert-done');
  if (!ok || !snooze || !done) return;

  ok.addEventListener('click', closeAlert);
  snooze.addEventListener('click', () => snoozeAlert(currentAlert));
  done.addEventListener('click', () => completeAlert(currentAlert));

  document.addEventListener('keydown', ev => {
    const overlay = document.getElementById('alert-overlay');
    if (!overlay || overlay.hidden) return;
    if (ev.key === 'Escape' || ev.key === 'Enter') {
      ev.preventDefault();
      closeAlert();
    }
  });
}

/* --- 兜底一：标题闪烁（不需要权限） --- */
let titleTimer = null;

function flashTitle(brief) {
  if (!document.hidden) return;      // 页面在前台就不闪，别烦人
  if (titleTimer) return;

  let on = false;
  titleTimer = setInterval(() => {
    on = !on;
    document.title = on ? '⏰ ' + brief : '活动小本本';
  }, 800);
}

function stopFlashTitle() {
  if (!titleTimer) return;
  clearInterval(titleTimer);
  titleTimer = null;
  document.title = '活动小本本';
}

/* --- 兜底二：一声轻提示音（Web Audio，不需要权限） --- */
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.value = 880;

    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

    osc.start(t);
    osc.stop(t + 0.5);
  } catch (err) {
    // 浏览器可能因为「还没交互过」不让出声 —— 那就静音，不影响提醒条
  }
}

function showBanner(text) {
  document.getElementById('reminder-text').textContent = text;
  document.getElementById('reminder-bar').hidden = false;
}

function hideBanner() {
  document.getElementById('reminder-bar').hidden = true;
}

/**
 * 系统通知。
 * ⚠️ 浏览器要求「安全上下文」（https 或 localhost）。
 * 用 file:// 打开时，部分浏览器会直接拒绝授权 —— 拒绝就算了，
 * 页面内的提醒条照常工作，功能不会因此失效。
 */
function systemNotify(title, body) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    new Notification(title, { body: body });
  } catch (err) {
    /* 不支持或被拒绝，忽略即可 */
  }
}

/** 「开启桌面提醒」按钮：没授权时显示；被拒绝时显示「怎么办」 */
function initNotifyButton() {
  const btn = document.getElementById('btn-notify');
  if (typeof Notification === 'undefined') return;      // 浏览器不支持，当没这功能
  if (Notification.permission === 'granted') return;    // 已经授权，不用显示

  // 被拒绝过：浏览器不会再弹授权框了，告诉用户怎么手动开
  if (Notification.permission === 'denied') {
    btn.hidden = false;
    btn.textContent = '桌面通知被拒绝（点这里看怎么办）';
    btn.addEventListener('click', () => {
      showBanner(
        '浏览器已拒绝桌面通知，不会再弹授权框。修复办法：点地址栏左边的图标 → 网站权限 → 通知 → 允许；' +
        '或者 设置 → Cookie 和网站权限 → 通知 → 找到这个网站改成允许。' +
        '用 file:// 打开时可能根本没有这一项，部署到 https（比如 GitHub Pages）后就正常了。' +
        '在此之前，到点提醒仍然会用「顶部提示条 + 标题闪烁 + 提示音」提醒你。'
      );
      btn.hidden = true;
    });
    return;
  }

  // 还没做过选择：正常请求授权
  btn.hidden = false;
  btn.addEventListener('click', () => {
    try {
      const res = Notification.requestPermission();
      if (res && typeof res.then === 'function') {
        res.then(() => {
          if (Notification.permission === 'granted') {
            btn.hidden = true;
            showBanner('桌面提醒已开启 —— 页面开着时，到点会弹通知');
          } else {
            btn.textContent = '浏览器拒绝了桌面提醒';
            btn.disabled = true;
          }
        });
      }
    } catch (err) {
      btn.textContent = '这个浏览器不支持桌面提醒';
      btn.disabled = true;
    }
  });
}


/* ---------- ⑥ 启动 ---------- */

let events = [];
let tags = [];
let deleted = [];        // 已删除的活动（历史里可以恢复）
let view = 'active';     // 'active' = 待办，'history' = 历史
let currentFilter = '全部';
let currentTag = '';
let lastSavedId = null;
let pendingDelete = null;
let undoSnapshot = null;
let undoTimer = null;

// 正在编辑哪一条。null = 不在编辑状态，表单就是普通的「新增一条」
let editingId = null;

// 防连点：600ms 内只认第一次提交（网络慢、手抖连按都靠它挡）
let saveLock = false;
// 用户点了「仍然要存」之后，放开一次查重
let allowDupOnce = false;

// 这一轮渲染里，哪些活动和别的活动时间撞车了（id → 撞上的那几条）
var conflictMap = new Map();

// 哪些活动的长备注被展开了。记在这里，列表重画之后还是展开的。
const expandedNotes = new Set();

// 日历当前看到哪个月、选中了哪一天
let calYear = 0;
let calMonth = 0;
let calSelected = '';

// 右边列表是不是「只看某一天」。空字符串 = 没开启这个筛选。
// 注意：打开页面时日历虽然高亮今天，但 dayFilter 是空的——
// 否则你一进来就只看见今天那一条，会以为数据丢了。
let dayFilter = '';

// 搜索框里的关键词（名称/备注/类别/日期都能搜）
let searchQuery = '';

function init() {
  events = loadEvents();
  deleted = loadDeleted();
  tags = loadTags();
  normalizeEventTags();          // 兜底：把"孤儿类别"的活动归到「未分类」
  currentTag = loadLastTag();

  document.getElementById('input-date').value = todayStr();  // 日期默认今天

  // 日历打开时停在今天所在的月份，并选中今天
  calSelected = todayStr();
  const initParts = calSelected.split('-').map(Number);
  calYear = initParts[0];
  calMonth = initParts[1] - 1;

  renderTagPicker();
  renderFilters();
  renderAll();

  document.getElementById('event-form').addEventListener('submit', handleSubmit);
  document.getElementById('btn-sample').addEventListener('click', loadSamples);
  document.getElementById('btn-cancel').addEventListener('click', closeDialog);
  document.getElementById('btn-confirm').addEventListener('click', confirmDelete);
  document.getElementById('btn-undo').addEventListener('click', undoDelete);

  // 「取消编辑」：把表单还原成「新增一条」
  document.getElementById('btn-cancel-edit').addEventListener('click', resetForm);

  // 「清除名称和备注」
  document.getElementById('btn-clear-fields').addEventListener('click', clearNameAndNote);

  // AI 对话（打字 / 拖文件 / 拖截图 / 粘贴）+ AI 设置
  setupChat();
  initAiSettings();

  // 左右栏之间的拖拽分隔条
  setupSplitter();

  // 窗口大小变了，格子宽度也变了，重新判断要不要显示任务标题
  if (typeof window !== 'undefined' && window.addEventListener) {
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderCalendar, 150);
    });
  }

  // 待办 / 历史 两个视图
  document.getElementById('tab-active').addEventListener('click', () => setView('active'));
  document.getElementById('tab-history').addEventListener('click', () => setView('history'));

  // 到点提醒：先静默标记今天已过点的，再每 30 秒查一次
  primeReminders();
  checkReminders();
  setInterval(checkReminders, 30000);
  initNotifyButton();
  document.getElementById('btn-reminder-close').addEventListener('click', hideBanner);

  // 用户切回页面就停止闪标题
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) stopFlashTitle();
  });

  // 「管理类别」弹窗
  document.getElementById('btn-manage-tags').addEventListener('click', openTagManage);
  document.getElementById('btn-tags-done').addEventListener('click', closeTagManage);
  document.getElementById('btn-add-tag').addEventListener('click', addTag);
  document.getElementById('input-new-tag').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); addTag(); }   // 直接按回车也能添加
  });

  // 日历的翻月和「今天」
  document.getElementById('cal-prev').addEventListener('click', () => calShift(-1));
  document.getElementById('cal-next').addEventListener('click', () => calShift(1));
  document.getElementById('cal-today').addEventListener('click', calGoToday);

  // 取消「只看某天」
  document.getElementById('btn-clear-day').addEventListener('click', clearDayFilter);

  // 用户一开始打字，就把红框和提示去掉
  document.getElementById('input-title').addEventListener('input', () => {
    document.getElementById('input-title').classList.remove('invalid');
    document.getElementById('error-title').textContent = '';
  });
  document.getElementById('input-date').addEventListener('change', () => {
    document.getElementById('input-date').classList.remove('invalid');
    document.getElementById('error-date').textContent = '';
  });
}

/* ==========================================================
 * ⑧ 小工具：简报 / 统计 / 导入导出
 * ========================================================== */

/** 打开通用工具弹窗，build(body) 里往 body 里塞内容 */
function openTool(title, build) {
  const overlay = document.getElementById('tool-overlay');
  const body = document.getElementById('tool-body');
  document.getElementById('tool-title').textContent = title;
  body.innerHTML = '';
  build(body);
  overlay.hidden = false;
}

function closeTool() {
  const overlay = document.getElementById('tool-overlay');
  if (!overlay) return;
  overlay.hidden = true;
  document.getElementById('tool-body').innerHTML = '';
}

/** 今天往后 n 天的日期键 */
function datePlus(days) {
  const d = new Date(todayStr() + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

function timeLabelOf(ev) {
  if (!ev.startTime) return '全天';
  return ev.endTime ? ev.startTime + '–' + ev.endTime : ev.startTime;
}

/** 本机生成的一段简报（不花额度，随时能看） */
function briefingText() {
  const t = todayStr();
  const todayList = events
    .filter(e => e.date === t)
    .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));

  const overdue = events
    .filter(e => statusOf(e) !== 'done' && e.date < t)
    .sort((a, b) => a.date.localeCompare(b.date));

  const nextWeek = events
    .filter(e => statusOf(e) !== 'done' && e.date > t && e.date <= datePlus(7))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));

  const doneToday = todayList.filter(e => statusOf(e) === 'done').length;

  const lines = [];
  lines.push('今天 · ' + formatDateCN(t));
  lines.push('');

  if (!todayList.length) {
    lines.push('今天没有安排。');
  } else {
    lines.push('今天 ' + todayList.length + ' 条，已完成 ' + doneToday + ' 条：');
    todayList.forEach(e => {
      lines.push('· ' + timeLabelOf(e) + '  ' + e.title + '  #' + e.tag +
        (statusOf(e) === 'done' ? '  （已完成）' : ''));
    });
  }

  if (overdue.length) {
    lines.push('');
    lines.push('已经过期、还没做完 ' + overdue.length + ' 条：');
    overdue.slice(0, 6).forEach(e => {
      lines.push('· ' + formatDateCN(e.date) + '  ' + e.title + '  #' + e.tag);
    });
    if (overdue.length > 6) lines.push('…还有 ' + (overdue.length - 6) + ' 条');
  }

  if (nextWeek.length) {
    lines.push('');
    lines.push('未来 7 天 ' + nextWeek.length + ' 条：');
    nextWeek.slice(0, 8).forEach(e => {
      const d = daysFromToday(e.date);
      lines.push('· ' + (d === 1 ? '明天 ' : formatDateCN(e.date) + ' ') + timeLabelOf(e) + '  ' + e.title);
    });
    if (nextWeek.length > 8) lines.push('…还有 ' + (nextWeek.length - 8) + ' 条');
  }

  const total = events.length;
  const done = events.filter(e => statusOf(e) === 'done').length;
  if (total) {
    lines.push('');
    lines.push('全部 ' + total + ' 条，已完成 ' + done + ' 条（' + Math.round(done / total * 100) + '%）。');
  }

  return lines.join('\n');
}

/** 复制到剪贴板：先试 async API，不行就退回老办法 */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) { /* 继续走兜底 */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (err) {
    return false;
  }
}

/** 通用的一次性 AI 问答（简报润色用） */
async function aiAskOnce(system, user, maxTokens) {
  const c = loadAiConfig();
  const url = normalizeAiBase(c.base);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.key },
    body: JSON.stringify({
      model: c.model,
      temperature: 0.5,
      max_tokens: maxTokens || 700,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  if (!res.ok) throw new Error('接口返回 ' + res.status);
  const data = await res.json();
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  const text = msg && msg.content;
  if (!text) throw new Error('返回内容为空');
  return String(text).trim();
}

function openBrief() {
  openTool('简报', body => {
    const pre = document.createElement('pre');
    pre.className = 'tool-text';
    pre.textContent = briefingText();
    body.appendChild(pre);

    const row = document.createElement('div');
    row.className = 'tool-row';

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn-ghost';
    copy.textContent = '复制';
    copy.addEventListener('click', async () => {
      const ok = await copyText(pre.textContent);
      copy.textContent = ok ? '已复制 ✓' : '复制失败';
      setTimeout(() => { copy.textContent = '复制'; }, 1400);
    });
    row.appendChild(copy);

    if (aiReady()) {
      const polish = document.createElement('button');
      polish.type = 'button';
      polish.className = 'btn-primary';
      polish.textContent = '让 AI 写成一段话';
      polish.addEventListener('click', async () => {
        polish.disabled = true;
        polish.textContent = '正在写…';
        try {
          const out = await aiAskOnce(
            '你是学生的日程助理。把给你的清单写成两三句自然的口语，直接能发到班级群里。不要分点，不要加标题，不要编清单里没有的事。',
            pre.textContent,
            500
          );
          pre.textContent = out;
        } catch (err) {
          const tip = document.createElement('p');
          tip.className = 'tool-error';
          tip.textContent = '没写成：' + err.message;
          body.insertBefore(tip, row);
        }
        polish.disabled = false;
        polish.textContent = '让 AI 写成一段话';
      });
      row.appendChild(polish);
    }

    body.appendChild(row);
  });
}

/* ---------- 统计 ---------- */

function openStats() {
  openTool('统计', body => {
    const t = todayStr();
    const monthPrefix = t.slice(0, 7);   // "2026-10"

    const monthEvents = events.filter(e => e.date.startsWith(monthPrefix));
    const monthDone = monthEvents.filter(e => statusOf(e) === 'done').length;
    const overdue = events.filter(e => statusOf(e) !== 'done' && e.date < t).length;
    const rate = monthEvents.length ? Math.round(monthDone / monthEvents.length * 100) : 0;

    const grid = document.createElement('div');
    grid.className = 'stat-grid';

    const cards = [
      { num: monthEvents.length, label: '本月活动' },
      { num: monthDone, label: '本月完成' },
      { num: rate + '%', label: '本月完成率' },
      { num: overdue, label: '过期未完成' }
    ];
    cards.forEach(c => {
      const box = document.createElement('div');
      box.className = 'stat-card';
      const n = document.createElement('strong');
      n.textContent = c.num;
      const l = document.createElement('span');
      l.textContent = c.label;
      box.append(n, l);
      grid.appendChild(box);
    });
    body.appendChild(grid);

    const canvas = document.createElement('canvas');
    canvas.className = 'stat-canvas';
    body.appendChild(canvas);
    drawTagBars(canvas, monthEvents);
  });
}

function drawTagBars(canvas, monthEvents) {
  const dpr = window.devicePixelRatio || 1;
  const W = 480;
  const H = 220;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // 按类别数一数（本月）
  const counts = new Map();
  monthEvents.forEach(e => counts.set(e.tag, (counts.get(e.tag) || 0) + 1));
  const rows = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);

  ctx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#6b6255';
  ctx.fillText('本月活动 · 按类别', 4, 14);

  if (!rows.length) {
    ctx.fillStyle = '#a09480';
    ctx.fillText('这个月还没有活动', 4, 48);
    return;
  }

  const max = Math.max.apply(null, rows.map(r => r[1]));
  const top = 34;
  const rowH = 28;
  const labelW = 76;
  const barW = W - labelW - 46;

  rows.forEach((r, i) => {
    const y = top + i * rowH;

    ctx.fillStyle = '#4a4238';
    ctx.fillText(String(r[0]).slice(0, 5), 4, y + 15);

    const w = Math.max(6, Math.round(barW * r[1] / max));
    const grad = ctx.createLinearGradient(labelW, 0, labelW + barW, 0);
    grad.addColorStop(0, '#8fae86');
    grad.addColorStop(1, '#6f8c6b');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(labelW, y + 4, w, 14, 7) : ctx.rect(labelW, y + 4, w, 14);
    ctx.fill();

    ctx.fillStyle = '#6b6255';
    ctx.fillText(String(r[1]), labelW + w + 8, y + 15);
  });
}

/* ---------- 导入 / 导出 ---------- */

function exportData() {
  const payload = {
    app: '活动小本本',
    version: 1,
    exportedAt: new Date().toISOString(),
    tags: tags.slice(),
    events: events.map(e => Object.assign({}, e)),
    deleted: deleted.map(e => Object.assign({}, e))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '活动小本本-备份-' + todayStr().replace(/-/g, '') + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);

  showBanner('已导出 ' + events.length + ' 条活动（含 ' + deleted.length + ' 条已删除）');
}

/** 把外来数据整理成能用的活动对象，坏的直接丢掉 */
function normalizeImported(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(item => {
    if (!item || typeof item !== 'object') return;
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 50) : '';
    const date = typeof item.date === 'string' && isValidDateStr(item.date) ? item.date : '';
    if (!title || !date) return;

    const status = ['todo', 'doing', 'done'].indexOf(item.status) !== -1 ? item.status : 'todo';
    const startTime = /^\d{2}:\d{2}$/.test(String(item.startTime || '')) ? item.startTime : '';
    const endTime = /^\d{2}:\d{2}$/.test(String(item.endTime || '')) ? item.endTime : '';

    out.push({
      id: typeof item.id === 'string' && item.id ? item.id : 'e-' + Date.now() + '-' + out.length,
      title: title,
      date: date,
      startTime: startTime,
      endTime: endTime,
      tag: typeof item.tag === 'string' && item.tag ? item.tag : '未分类',
      note: typeof item.note === 'string' ? item.note.slice(0, 500) : '',
      remindMin: Number.isFinite(Number(item.remindMin)) ? Number(item.remindMin) : 0,
      status: status,
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now()
    });
  });
  return out;
}

function openImportReview(incoming, incomingDeleted, incomingTags) {
  openTool('导入', body => {
    const info = document.createElement('p');
    info.className = 'tool-note';
    info.textContent = '文件里有 ' + incoming.length + ' 条活动、' + incomingDeleted.length +
      ' 条已删除记录。现在列表里有 ' + events.length + ' 条。选一种合并方式：';
    body.appendChild(info);

    const row = document.createElement('div');
    row.className = 'tool-row';

    const merge = document.createElement('button');
    merge.type = 'button';
    merge.className = 'btn-primary';
    merge.textContent = '合并导入';
    merge.addEventListener('click', () => applyImport(incoming, incomingDeleted, incomingTags, 'merge'));
    row.appendChild(merge);

    const replace = document.createElement('button');
    replace.type = 'button';
    replace.className = 'btn-danger';
    replace.textContent = '覆盖导入';
    replace.addEventListener('click', () => applyImport(incoming, incomingDeleted, incomingTags, 'replace'));
    row.appendChild(replace);

    body.appendChild(row);

    const warn = document.createElement('p');
    warn.className = 'tool-note';
    warn.textContent = '「合并」只加列表里没有的；「覆盖」会清空当前全部活动，换成文件里的（删除也一样）。';
    body.appendChild(warn);
  });
}

function applyImport(incoming, incomingDeleted, incomingTags, mode) {
  if (mode === 'replace') {
    events = incoming.map(e => Object.assign({}, e));
    deleted = normalizeImported(incomingDeleted).map(e => Object.assign({}, e, { deletedAt: Date.now() }));
    if (incomingTags.length) tags = Array.from(new Set(incomingTags.filter(t => typeof t === 'string' && t)));
  } else {
    const ids = new Set(events.map(e => e.id));
    const keys = new Set(events.map(e => (e.title + '|' + e.date + '|' + (e.startTime || ''))));
    let added = 0;
    incoming.forEach(e => {
      const key = e.title + '|' + e.date + '|' + (e.startTime || '');
      if (ids.has(e.id) || keys.has(key)) return;
      ids.add(e.id);
      keys.add(key);
      events.push(Object.assign({}, e));
      added++;
    });
    // 标签取并集
    incomingTags.forEach(t => {
      if (typeof t === 'string' && t && tags.indexOf(t) === -1) tags.push(t);
    });
    events.forEach(e => { if (tags.indexOf(e.tag) === -1) tags.push(e.tag); });

    saveAll();
    renderAll();
    closeTool();
    showBanner('合并导入 ' + added + ' 条（跳过重复 ' + (incoming.length - added) + ' 条）');
    return;
  }

  saveAll();
  renderAll();
  closeTool();
  showBanner('已覆盖导入 ' + events.length + ' 条活动');
}

/** 导入时用来兜底的保存（saveEvents / saveDeleted / 标签） */
function saveAll() {
  saveEvents();
  saveDeleted();
  saveTags();
}

function readImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data = null;
    try {
      data = JSON.parse(String(reader.result));
    } catch (err) {
      openTool('导入失败', body => {
        const p = document.createElement('p');
        p.className = 'tool-note';
        p.textContent = '这个文件不是 JSON，或者内容被改坏了。';
        body.appendChild(p);
      });
      return;
    }

    const rawEvents = Array.isArray(data) ? data : (data && Array.isArray(data.events) ? data.events : null);
    if (!rawEvents) {
      openTool('导入失败', body => {
        const p = document.createElement('p');
        p.className = 'tool-note';
        p.textContent = '文件里没找到活动列表（应该有一个 events 数组）。';
        body.appendChild(p);
      });
      return;
    }

    const incoming = normalizeImported(rawEvents);
    const incomingDeleted = normalizeImported(data && data.deleted);
    const incomingTags = (data && Array.isArray(data.tags)) ? data.tags : [];

    if (!incoming.length) {
      openTool('导入失败', body => {
        const p = document.createElement('p');
        p.className = 'tool-note';
        p.textContent = '文件里的活动都缺名称或日期，一条能用的都没有。';
        body.appendChild(p);
      });
      return;
    }

    openImportReview(incoming, incomingDeleted, incomingTags);
  };

  reader.readAsText(file);
}

function initTools() {
  const brief = document.getElementById('btn-brief');
  if (brief) brief.addEventListener('click', openBrief);

  const stats = document.getElementById('btn-stats');
  if (stats) stats.addEventListener('click', openStats);

  const exp = document.getElementById('btn-export');
  if (exp) exp.addEventListener('click', exportData);

  const imp = document.getElementById('btn-import');
  const fileInput = document.getElementById('import-file');
  if (imp && fileInput) {
    imp.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) readImportFile(f);
    });
  }

  const close = document.getElementById('tool-close');
  if (close) close.addEventListener('click', closeTool);

  const overlay = document.getElementById('tool-overlay');
  if (overlay) {
    overlay.addEventListener('click', ev => {
      if (ev.target === overlay) closeTool();
    });
  }

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && overlay && !overlay.hidden) closeTool();
  });
}

/* ---------- ⑨ 深浅色 / 搜索框 ---------- */

const THEME_KEY = 'campus_theme_v1';

/** 把主题落到 <html data-theme>，按钮图标跟着变 */
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'dark' || mode === 'light') root.setAttribute('data-theme', mode);
  else root.removeAttribute('data-theme');

  const btn = document.getElementById('btn-theme');
  if (btn) {
    btn.textContent = mode === 'dark' ? '☀️' : '🌙';
    btn.title = mode === 'dark' ? '切到浅色' : '切到深色';
  }
}

function initTheme() {
  let saved = '';
  try { saved = localStorage.getItem(THEME_KEY) || ''; } catch (err) { /* 忽略 */ }

  // 没手动选过就跟着系统走
  const prefersDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const mode = (saved === 'dark' || saved === 'light') ? saved : (prefersDark ? 'dark' : 'light');
  applyTheme(mode);

  const btn = document.getElementById('btn-theme');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* 忽略 */ }
    applyTheme(next);
  });
}

function initSearch() {
  const box = document.getElementById('search-input');
  const clear = document.getElementById('search-clear');
  if (!box || !clear) return;

  const sync = () => {
    searchQuery = box.value;
    clear.hidden = !box.value;
    renderList();
  };

  box.addEventListener('input', sync);

  box.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      box.value = '';
      sync();
    }
  });

  clear.addEventListener('click', () => {
    box.value = '';
    sync();
    box.focus();
  });
}
/* ---------- ⑪ 从微信聊天记录里找活动 ---------- */

const WX_MAX_CHARS = 18000;      // 一次最多扫这么多字，控制 AI 花费
const WX_CHUNK_CHARS = 3000;     // 发给 AI 的每段长度
const WX_DEMO = [
  '2026-10-20 09:12:03 班长',
  '【通知】本周三下午三点职业规划讲座，地点三教201，请提前十分钟签到。',
  '',
  '2026-10-20 09:15:41 学习委员',
  '大家注意：10月25日19:00 学院辩论赛报名截止，要参加的私聊我。',
  '',
  '2026-10-21 08:30:00 团支书',
  '下周一前交二轮考核材料，电子版发我邮箱。'
].join('\n');

/** 把聊天记录切成一条条消息（认「2026-10-20 09:12」这种时间行） */
function splitChatMessages(text) {
  const lines = String(text || '').split(/\r?\n/);
  const timeRe = /^\s*\d{2,4}[-/年]\d{1,2}[-/月]\d{1,2}日?(\s+\d{1,2}:\d{2}(:\d{2})?)?/;
  const out = [];
  let cur = '';

  lines.forEach(line => {
    if (timeRe.test(line) && cur.trim()) {
      out.push(cur.trim());
      cur = line + '\n';
    } else {
      cur += line + '\n';
    }
  });
  if (cur.trim()) out.push(cur.trim());

  return out.length ? out : [String(text || '')];
}

/** 按字数把消息打包，别一段太长 */
function chunkMessages(messages, size) {
  const chunks = [];
  let cur = '';
  messages.forEach(m => {
    if (cur && cur.length + m.length > size) {
      chunks.push(cur);
      cur = '';
    }
    cur += m + '\n\n';
  });
  if (cur.trim()) chunks.push(cur);
  return chunks.slice(0, 6);
}

/** 让 AI 从一段聊天里挑活动；失败就抛出去，由调用方退回规则 */
async function askAiForActivities(chunkText) {
  const today = todayStr();
  const system = [
    '你是一个校园活动助理。下面是一段微信聊天记录，请找出里面提到的**校园活动**（讲座、比赛、招新、报名、体测、会议、截止日期等）。',
    '今天是 ' + today + '。',
    '只输出一个 JSON 数组，不要 Markdown 代码块，不要解释。每个元素：',
    '{"title":"活动名","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","tag":"类别"}',
    '规则：',
    '- 类别只能从这些里选：' + tags.join('、') + '；都不像就用「未分类」。',
    '- 日期写成 YYYY-MM-DD；没说年份按今年；「下周一」这种按今天推算。',
    '- 时间没提就留空字符串；拿不准的字段一律留空，绝不编。',
    '- 同一件事只说一次，不要重复。',
    '- 没有活动就输出 []。'
  ].join('\n');

  const out = await aiAskOnce(system, chunkText, 1200);
  const raw = String(out).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  let arr = null;
  const m = raw.match(/\[[\s\S]*\]/);
  if (m) {
    try { arr = JSON.parse(m[0]); } catch (err) { arr = null; }
  }
  if (!Array.isArray(arr)) return [];

  return arr.slice(0, 12).map(item => {
    if (!item || typeof item !== 'object') return null;
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 50) : '';
    const date = typeof item.date === 'string' && isValidDateStr(item.date) ? item.date : '';
    if (!title || !date) return null;
    return {
      title: title,
      date: date,
      startTime: /^\d{2}:\d{2}$/.test(String(item.startTime || '')) ? item.startTime : '',
      endTime: /^\d{2}:\d{2}$/.test(String(item.endTime || '')) ? item.endTime : '',
      tag: tags.indexOf(item.tag) !== -1 ? item.tag : '未分类'
    };
  }).filter(Boolean);
}

function dedupeActivities(list) {
  const seen = new Set();
  const out = [];
  list.forEach(a => {
    const key = a.title + '|' + a.date + '|' + (a.startTime || '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  });
  return out;
}

/** 去掉消息开头的「时间 发送人」行，只留正文 */
function messageBody(msg) {
  const lines = String(msg || '').split(/\r?\n/);
  if (lines.length && /^\s*\d{2,4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(lines[0])) lines.shift();
  if (lines.length && lines[0].trim().length <= 12 && !/[，。！？,.!?]/.test(lines[0])) lines.shift();
  return lines.join('\n').trim();
}

/** 扫聊天记录：配了 AI 用 AI，没配就退回规则 */
async function scanChatForActivities(raw) {
  const text = String(raw || '').slice(0, WX_MAX_CHARS);
  const messages = splitChatMessages(text);

  if (aiReady()) {
    const chunks = chunkMessages(messages, WX_CHUNK_CHARS);
    const found = [];
    let lastErr = null;
    for (let i = 0; i < chunks.length; i++) {
      try {
        const list = await askAiForActivities(chunks[i]);
        list.forEach(a => found.push(a));
      } catch (err) {
        lastErr = err;
        break;
      }
    }
    if (found.length || !lastErr) return dedupeActivities(found);
    throw lastErr;          // AI 完全失败，交给调用方提示
  }

  const found = [];
  messages.forEach(m => {
    const body = messageBody(m);
    if (!body) return;

    // 整段先试一次；不行就逐行试（有的记录一条消息里只有一行）
    let p = parseActivityText(body);
    if (!(p && p.title && p.date)) {
      body.split(/\r?\n/).forEach(line => {
        const q = parseActivityText(line);
        if (q && q.title && q.date && !(p && p.date)) p = q;
      });
    }
    if (p && p.title && p.date) found.push(p);
  });
  return dedupeActivities(found);
}

function openWechat() {
  openTool('从微信聊天记录找活动', body => {
    const state = { raw: '', name: '', candidates: [] };

    const note = document.createElement('p');
    note.className = 'tool-note';
    note.textContent = '把导出的聊天记录拖进来，或直接粘贴。文件只在你的浏览器里读，不会自动上传；如果你配了 AI，只有被扫描的那段文字会发给你的 AI 服务商。';
    body.appendChild(note);

    const row = document.createElement('div');
    row.className = 'tool-row';

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'btn-primary';
    pick.textContent = '选择聊天记录文件';

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.txt,.json,.csv,.html,.md,.log,text/plain';
    file.hidden = true;

    const demo = document.createElement('button');
    demo.type = 'button';
    demo.className = 'btn-ghost';
    demo.textContent = '看一段示例';

    row.append(pick, demo, file);
    body.appendChild(row);

    const info = document.createElement('p');
    info.className = 'wx-info';
    body.appendChild(info);

    const paste = document.createElement('textarea');
    paste.id = 'wx-paste';
    paste.rows = 4;
    paste.placeholder = '或者把聊天记录粘贴到这里…';
    body.appendChild(paste);

    const actions = document.createElement('div');
    actions.className = 'tool-row';
    const scan = document.createElement('button');
    scan.type = 'button';
    scan.className = 'btn-primary';
    scan.textContent = '开始查找';
    actions.appendChild(scan);
    body.appendChild(actions);

    const results = document.createElement('div');
    body.appendChild(results);

    function setRaw(text, name) {
      state.raw = text;
      state.name = name || '';
      info.textContent = name
        ? '已读入 ' + name + '（' + text.length + ' 字）'
        : (text ? '已读入 ' + text.length + ' 字' : '');
    }

    pick.addEventListener('click', () => { file.value = ''; file.click(); });
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { setRaw(String(reader.result || ''), f.name); paste.value = ''; };
      reader.readAsText(f);
    });

    demo.addEventListener('click', () => {
      paste.value = WX_DEMO;
      setRaw(WX_DEMO, '示例聊天记录');
    });

    paste.addEventListener('input', () => {
      if (paste.value.trim()) setRaw(paste.value, '');
    });

    scan.addEventListener('click', async () => {
      const raw = paste.value.trim() || state.raw;
      if (!raw.trim()) {
        info.textContent = '先选一个文件，或者把聊天记录粘贴进来。';
        return;
      }

      scan.disabled = true;
      scan.textContent = '查找中…';
      results.innerHTML = '';

      try {
        const list = await scanChatForActivities(raw);
        scan.disabled = false;
        scan.textContent = '开始查找';

        if (!list.length) {
          const none = document.createElement('p');
          none.className = 'tool-note';
          none.textContent = '没找到能记的活动。可以换一段记录，或者在聊天里把时间说清楚一点。';
          results.appendChild(none);
          return;
        }

        renderWxCandidates(results, list);
      } catch (err) {
        scan.disabled = false;
        scan.textContent = '开始查找';
        const tip = document.createElement('p');
        tip.className = 'tool-note';
        tip.textContent = 'AI 没连上（' + err.message + '），可以再试一次，或者清掉 AI 设置用本机规则。';
        results.appendChild(tip);
      }
    });
  });
}

/** 找到的候选活动：逐条勾选 / 全部记入 */
function renderWxCandidates(box, list) {
  box.innerHTML = '';

  const head = document.createElement('p');
  head.className = 'tool-note';
  head.textContent = '找到 ' + list.length + ' 条可能的安排，勾选要记入的：';
  box.appendChild(head);

  const ul = document.createElement('div');
  ul.className = 'wx-list';

  const checks = [];
  list.forEach(a => {
    const row = document.createElement('label');
    row.className = 'wx-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.idx = String(checks.length);

    const main = document.createElement('span');
    main.className = 'wx-main';
    const title = document.createElement('strong');
    title.textContent = a.title;
    const meta = document.createElement('span');
    meta.className = 'wx-meta';
    meta.textContent = formatDateCN(a.date) + ' ' +
      (a.startTime ? a.startTime + (a.endTime ? '–' + a.endTime : '') : '全天') +
      (a.tag ? ' · #' + a.tag : '');
    main.append(title, meta);

    row.append(cb, main);
    ul.appendChild(row);
    checks.push(cb);
  });
  box.appendChild(ul);

  const actions = document.createElement('div');
  actions.className = 'tool-row';

  const saveAll = document.createElement('button');
  saveAll.type = 'button';
  saveAll.className = 'btn-primary';
  saveAll.textContent = '全部记入';
  saveAll.addEventListener('click', () => commitWx(list));

  const saveChecked = document.createElement('button');
  saveChecked.type = 'button';
  saveChecked.className = 'btn-ghost';
  saveChecked.textContent = '只记勾选的';
  saveChecked.addEventListener('click', () => {
    const picked = list.filter((_, i) => checks[i] && checks[i].checked);
    if (!picked.length) {
      showBanner('一条都没勾选');
      return;
    }
    commitWx(picked);
  });

  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'btn-ghost';
  none.textContent = '都不记';
  none.addEventListener('click', closeTool);

  actions.append(saveAll, saveChecked, none);
  box.appendChild(actions);
}

function commitWx(list) {
  const saved = saveBatch(list, 'new');
  const items = saved && Array.isArray(saved.items) ? saved.items : [];
  const created = items.filter(x => x.kind === 'created').length;
  const dup = items.filter(x => x.kind === 'duplicate').length;

  renderAll();
  closeTool();

  showBanner('记入 ' + created + ' 条' + (dup ? '，另有 ' + dup + ' 条列表里已经有了' : ''));
}
function initWechat() {
  const btn = document.getElementById('btn-wechat');
  if (btn) btn.addEventListener('click', openWechat);
}

initTools();
initAlert();
initTheme();
initSearch();
initWechat();
init();
