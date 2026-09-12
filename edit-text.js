// =====================================================================
// edit-text.js — popup "Sửa văn bản" (find & replace) gắn với truyện đang
// mở thật trong app (S.fname), đồng bộ 1:1 với bản demo nâng cao
// "edit-text-advanced-demo.html": mỗi dòng quy tắc có thêm 3 tuỳ chọn
// Aa (phân biệt hoa/thường) / [W] (khớp đúng từ) / .* (regex), mỗi phạm
// vi có công tắc "Ưu tiên cụm dài trước" và nút "Chi tiết" (Xuất/Nhập
// quy tắc dạng text, gộp chung 1 ô nhập).
//
// UI: accordion — mỗi phạm vi ("Tất cả truyện" / "Truyện đang đọc") là 1
// khối bấm để mở ra bảng quy tắc bên trong. Không còn nút Hủy/Lưu riêng:
// đóng 1 khối (bấm lại header, chọn khối khác, hoặc đóng cả popup) sẽ tự
// dọn dòng trống rồi lưu ngay — xem etCleanupAndSaveScope().
//
// LƯU Ý MARKUP: ngoài #etScopeList, index.html cần có sẵn khối
//   <div class="et-io-panel" id="etIOPanel" style="display:none"></div>
// nằm cùng cấp trong .et-scroll (xem demo) để hiện panel "Chi tiết".
//
// File này nạp TRƯỚC khối <script> chính (xem chú thích tại chỗ gọi trong
// index.html) nên KHÔNG được đụng tới DOM/biến của khối chính ở top-level —
// chỉ etLoadRules() chạy ngay khi nạp, và nó chỉ đọc localStorage. Mọi hàm
// khác chỉ chạy khi được người dùng bấm (lúc đó S đã tồn tại).
// =====================================================================

const ET_RULES_KEY = 'dich-et-rules';
const ET_SORT_KEY = 'dich-et-sort'; // {[scopeKey]: true/false} — công tắc "Ưu tiên cụm dài trước"

let etRules = [];
let etNextId = 1;
let etSortPrefs = {};
let etScopes = []; // trạng thái UI (accordion) của popup đang mở, xem etBuildScopes()

// Icon "layers" (lớp chồng) — biểu tượng quen thuộc cho "áp dụng cho tất cả",
// tránh trùng icon tủ sách đã dùng cho "Tủ truyện" ở header của app.
const ET_ICON_ALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
const ET_ICON_READING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v17a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 18.5v-14Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/></svg>';
const ET_ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ET_ICON_CHEVRON = '<svg class="et-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const ET_ICON_ARROW = '<svg class="et-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
const ET_ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ET_ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const ET_ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
const ET_ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>';
const ET_ICON_PASTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>';
const ET_ICON_DETAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>';

// Ghi chú giải nghĩa các mã — đặt luôn trong ô nhập ở dạng dòng "#" (bị bỏ
// qua khi Lưu/Nhập), sắp xếp theo số từ thấp tới cao.
const ET_CODE_HELP =
  '# --------------------------------------------\n'
  + '# Mỗi dòng 1 quy tắc: [từ_khoá]=[thay_bằng]=[mã]\n'
  + '# Mã = 512 (mặc định)\n'
  + '# Mã = 513 = khớp đúng từ\n'
  + '# Mã = 514 = phân biệt hoa/thường\n'
  + '# Mã = 515 = khớp đúng từ + phân biệt hoa/thường\n'
  + '# Mã = 522 (bật regex .*)\n'
  + '# Mã = 523 = regex + khớp đúng từ\n'
  + '# Mã = 524 = regex + phân biệt hoa/thường\n'
  + '# Mã = 525 = regex + khớp đúng từ + phân biệt hoa/thường\n'
  + '# --------------------------------------------\n';

function etEsc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function etEscAttr(s){ return etEsc(s).replace(/"/g,'&quot;'); }

function etLoadRules(){
  try{
    const saved = JSON.parse(localStorage.getItem(ET_RULES_KEY) || '[]');
    if(Array.isArray(saved)){
      etRules = saved.map(r => ({
        id: r.id, scope: r.scope, find: r.find, replace: r.replace,
        regex: !!r.regex, matchCase: !!r.matchCase, wholeWord: !!r.wholeWord
      }));
    }
    etNextId = etRules.reduce((m,r)=>Math.max(m, r.id||0), 0) + 1;
  }catch(e){ etRules = []; }
}
function etSaveRules(){
  try{ localStorage.setItem(ET_RULES_KEY, JSON.stringify(etRules)); }catch(e){}
  etBroadcastRulesUpdated();
}
function etLoadSortPrefs(){
  try{ etSortPrefs = JSON.parse(localStorage.getItem(ET_SORT_KEY) || '{}') || {}; }
  catch(e){ etSortPrefs = {}; }
}
function etSaveSortPrefs(){
  try{ localStorage.setItem(ET_SORT_KEY, JSON.stringify(etSortPrefs)); }catch(e){}
}
etLoadRules();
etLoadSortPrefs();

// ===== ĐỒNG BỘ GIỮA CÁC TAB =====
// Quy tắc "Sửa văn bản" lưu ở localStorage nên tự share giữa các tab cùng
// gốc, nhưng KHÔNG có sự kiện nào báo cho tab khác biết để nạp lại — khác
// với bản dịch (lưu IndexedDB + BroadcastChannel 'nt-lib-sync' ở khối
// script chính). Dùng lại đúng tên channel đó (1 tên channel có thể có
// nhiều BroadcastChannel object lắng nghe độc lập, kể cả trong cùng tab,
// và không tự nhận lại message do chính mình gửi) để tab khác tự
// etLoadRules() lại ngay khi có tab lưu quy tắc mới — không cần F5, giống
// hệt cơ chế đồng bộ bản dịch. Tạo channel riêng tại đây (không dùng biến
// libSyncChannel của khối script chính) vì file này nạp TRƯỚC khối đó nên
// biến libSyncChannel chưa tồn tại lúc top-level code này chạy.
let etSyncChannel = null;
try{
  if('BroadcastChannel' in window){
    etSyncChannel = new BroadcastChannel('nt-lib-sync');
    etSyncChannel.addEventListener('message', function(ev){
      const msg = ev.data || {};
      if(msg.type !== 'et-rules-updated') return;
      etLoadRules();
      const overlay = document.getElementById('etOverlay');
      const popupOpen = overlay && overlay.classList.contains('show');
      if(popupOpen){
        // Chỉ nạp lại danh sách nếu KHÔNG có khối nào đang mở (đang gõ dở) ở
        // tab này — tránh xoá mất input đang nhập giữa chừng. Nếu có khối
        // đang mở, dữ liệu mới vẫn đã nằm trong etRules và sẽ hiện đúng ở
        // lần mở khối/mở popup kế tiếp.
        const anySelected = etScopes.some(s => s.selected);
        if(!anySelected){
          etScopes = etBuildScopes();
          etRenderScopeList();
        }
      }
      // Áp dụng ngay cho chương đang xem (nếu có truyện đang mở) — giống
      // etCleanupAndSaveScope() ở tab vừa lưu.
      try{
        if(typeof S !== 'undefined' && S.cur >= 0 && typeof renderCh === 'function') renderCh(S.cur);
      }catch(e){}
    });
  }
}catch(e){ console.warn('[ET Sync] BroadcastChannel không khả dụng ở trình duyệt này:', e); }

function etBroadcastRulesUpdated(){
  if(!etSyncChannel) return;
  try{ etSyncChannel.postMessage({type:'et-rules-updated', ts:Date.now()}); }catch(e){}
}

// Di chuyển quy tắc "Sửa text" bản CŨ (1 ô textarea chung, mỗi dòng dạng
// "A=B") sang etRules dạng mới, scope 'all' (bản cũ không phân biệt theo
// từng truyện). Có dedupe theo scope+find+replace để loadSettings() gọi lại
// nhiều lần (VD sau khi khôi phục file backup cũ) không bị tạo trùng.
function etMigrateLegacyTextReplace(raw){
  if(!raw || typeof raw !== 'string') return;
  const lines = raw.split('\n');
  let changed = false;
  for(const line of lines){
    const eq = line.indexOf('=');
    if(eq < 0) continue;
    const find = line.slice(0, eq).trim();
    const replace = line.slice(eq+1);
    if(!find) continue;
    const dup = etRules.some(r => r.scope==='all' && r.find===find && r.replace===replace);
    if(dup) continue;
    etRules.push({id: etNextId++, scope:'all', find, replace, regex:false, matchCase:false, wholeWord:false});
    changed = true;
  }
  if(changed) etSaveRules();
}

// Truyện đang mở trên trang — dùng thẳng S.fname thật của app.
function etCurrentStoryKey(){
  return (typeof S !== 'undefined' && S.fname) ? S.fname : '';
}
// Tên hiển thị cho khoá scope (bỏ đuôi .txt/.epub cho gọn) — dùng làm
// fallback khi không tra được tên thật từ tủ truyện (VD truyện đang mở
// chưa được lưu vào tủ, libCurrentId null).
function etDisplayName(key){
  return key === 'all' ? 'Tất cả truyện' : key.replace(/\.(txt|epub)$/i,'');
}

// Tên hiển thị cho "Truyện đang đọc": LUÔN lấy tên thật đang lưu trong tủ
// truyện (bk.name — cái người dùng đổi bằng nút "Đổi tên") thay vì tự suy
// ra từ S.fname (tên file gốc, không đổi theo khi đổi tên trong tủ). key
// (S.fname) chỉ dùng làm khoá scope ổn định của quy tắc, không dùng để
// hiển thị. libBooks/libCurrentId là biến của khối script chính; hàm này
// chỉ được gọi lúc người dùng mở popup (lúc đó khối chính đã chạy xong).
function etCurrentStoryDisplayName(key){
  try{
    if(typeof libCurrentId !== 'undefined' && libCurrentId && typeof libBooks !== 'undefined'){
      const bk = libBooks.find(b => b.id === libCurrentId);
      if(bk && bk.name) return bk.name;
    }
  }catch(e){}
  return etDisplayName(key);
}

/* ---------- Mã tuỳ chọn (regex/wholeWord/matchCase) <-> số, dùng khi
   Xuất/Nhập quy tắc dạng text (xem etOpenDetail). ---------- */
function etOptCode(r){ return (r.regex?522:512) + (r.wholeWord?1:0) + (r.matchCase?2:0); }
function etCodeToFlags(code){
  code = parseInt(code,10);
  if(isNaN(code)) return {regex:false, wholeWord:false, matchCase:false};
  const regex = code >= 520;
  const base = regex ? 522 : 512;
  const r = code - base;
  return { regex, wholeWord: (r===1||r===3), matchCase: (r===2||r===3) };
}

/* ---------- Xây RegExp từ 1 rule — dùng khi thực sự áp dụng quy tắc lên
   văn bản chương (regex tuỳ biến, khớp đúng từ, phân biệt hoa/thường).
   KHÔNG dùng lookbehind (?<!...): Safari <16.4 trên iPad cũ (iPad mini 4/Air
   2) ném lỗi "Invalid regular expression" ngay khi tạo RegExp có lookbehind
   — xem đúng cảnh báo này ở applyReplace() trong index.html. Biên phía
   trước được bắt bằng capture group (^|[^\p{L}\p{N}_]) thay cho lookbehind;
   xem etReplaceWithRule() bên dưới, nơi group này được nối lại vào kết quả. */
function etBuildRegex(rule){
  let pattern = rule.regex ? rule.find : rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if(rule.wholeWord) pattern = '(^|[^\\p{L}\\p{N}_])(?:' + pattern + ')(?![\\p{L}\\p{N}_])';
  const flags = 'gu' + (rule.matchCase ? '' : 'i');
  return new RegExp(pattern, flags);
}

// Áp 1 rule (đã có regex/matchCase/wholeWord) lên text — dùng bởi applyReplace()
// trong khối script chính cho các quy tắc có bật ít nhất 1 trong 3 tuỳ chọn.
// Khi wholeWord bật, etBuildRegex() thêm 1 capture group bắt biên phía trước
// (thay lookbehind) nên không thể replace bằng chuỗi thường — phải nối lại
// group đó trong callback. Dùng callback (không truyền thẳng rule.replace
// làm replacement pattern) để tránh $1/$&... trong nội dung thay bị hiểu
// nhầm thành cú pháp đặc biệt của String.replace.
function etReplaceWithRule(text, rule){
  const rx = etBuildRegex(rule);
  if(rule.wholeWord){
    return text.replace(rx, (full, pre) => (pre||'') + rule.replace);
  }
  return text.replace(rx, () => rule.replace);
}

// Danh sách quy tắc áp dụng cho chương đang xem: "Tất cả truyện" + quy tắc
// riêng của truyện đang mở. Được applyReplace() trong khối script chính gọi
// (mỗi rule nay có thêm .regex/.matchCase/.wholeWord — script chính nên
// dùng etBuildRegex(rule) thay cho so khớp chuỗi thường để tôn trọng đủ 3
// tuỳ chọn mới).
function etGetActiveRules(){
  const key = etCurrentStoryKey();
  return etRules.filter(r => r.scope === 'all' || (key && r.scope === key));
}

// Bản đầy đủ: gộp + sắp theo "Ưu tiên cụm dài trước" (mỗi phạm vi tôn trọng
// công tắc riêng của nó), theo đúng thứ tự áp dụng thực tế. Dùng hàm này
// thay etGetActiveRules() nếu script chính muốn áp dụng đúng thứ tự.
function etGetOrderedActiveRules(){
  const key = etCurrentStoryKey();
  const groups = [
    {scopeKey:'all', rules: etRules.filter(r => r.scope === 'all')},
  ];
  if(key) groups.push({scopeKey:key, rules: etRules.filter(r => r.scope === key)});

  const ordered = [];
  groups.forEach(g => {
    const list = g.rules.slice();
    if(etSortPrefs[g.scopeKey]){
      list.sort((a,b) => {
        const dl = b.find.length - a.find.length;
        if(dl !== 0) return dl;
        return a.find.localeCompare(b.find, 'vi');
      });
    }
    ordered.push(...list);
  });
  return ordered;
}

/* ---------- Data <-> draft rows ---------- */
const ET_MIN_ROWS = 3;
function etEmptyRow(){ return {id:null, find:'', replace:'', regex:false, matchCase:false, wholeWord:false}; }
function etRowsForScope(key){
  const rows = etRules.filter(r => r.scope === key).map(r => ({
    id:r.id, find:r.find, replace:r.replace, regex:!!r.regex, matchCase:!!r.matchCase, wholeWord:!!r.wholeWord
  }));
  while(rows.length < ET_MIN_ROWS) rows.push(etEmptyRow());
  const last = rows[rows.length-1];
  if(last.find.trim() !== '' || (last.replace||'').trim() !== '') rows.push(etEmptyRow());
  return rows;
}

function etBuildScopes(){
  const currentKey = etCurrentStoryKey();
  const scopes = [];
  scopes.push({
    id:'all', key:'all', name:'Tất cả truyện', meta:'', icon: ET_ICON_ALL,
    disabled:false, selected:false,
    sortByLength: !!etSortPrefs['all'],
    rows: etRowsForScope('all')
  });
  if(currentKey){
    scopes.push({
      id:'current', key:currentKey, name:'Truyện đang đọc', meta: etCurrentStoryDisplayName(currentKey), icon: ET_ICON_READING,
      disabled:false, selected:false,
      sortByLength: !!etSortPrefs[currentKey],
      rows: etRowsForScope(currentKey)
    });
  } else {
    scopes.push({
      id:'current', key:'', name:'Truyện đang đọc', meta:'Chưa mở truyện nào', icon: ET_ICON_READING,
      disabled:true, selected:false, sortByLength:false, rows:[]
    });
  }
  return scopes;
}

/* ---------- Open / close popup ---------- */
function openEditText(){
  etScopes = etBuildScopes();
  document.getElementById('etOverlay').classList.add('show');
  etShowList();
}
function closeEditText(){
  // Đóng khối đang mở (nếu có) trước — tự dọn dòng trống + lưu ngay.
  etScopes.forEach(s => { if(s.selected) etCleanupAndSaveScope(s); });
  document.getElementById('etOverlay').classList.remove('show');
}

/* ---------- Chuyển đổi giữa danh sách phạm vi và panel "Chi tiết" ---------- */
function etShowList(){
  const listEl = document.getElementById('etScopeList');
  const ioEl = document.getElementById('etIOPanel');
  listEl.style.display = '';
  if(ioEl) ioEl.style.display = 'none';
  etRenderScopeList();
}
function etShowIO(){
  const listEl = document.getElementById('etScopeList');
  const ioEl = document.getElementById('etIOPanel');
  listEl.style.display = 'none';
  if(ioEl) ioEl.style.display = '';
}

/* ---------- Save / cleanup ---------- */
function etCleanupAndSaveScope(scope){
  const cleaned = scope.rows.filter(r => r.find.trim() !== '' || (r.replace||'').trim() !== '');
  etRules = etRules.filter(r => r.scope !== scope.key);
  cleaned.forEach(r => {
    etRules.push({
      id: r.id || etNextId++, scope: scope.key, find: r.find.trim(), replace: r.replace,
      regex: !!r.regex, matchCase: !!r.matchCase, wholeWord: !!r.wholeWord
    });
  });
  etSaveRules();
  scope.rows = etRowsForScope(scope.key);
  // Áp dụng ngay cho chương đang xem (nếu có truyện đang mở), khỏi phải đóng
  // rồi mở lại chương mới thấy quy tắc mới có hiệu lực.
  try{
    if(typeof S !== 'undefined' && S.cur >= 0 && typeof renderCh === 'function') renderCh(S.cur);
  }catch(e){}
}

/* ---------- Accordion select ---------- */
function etSelectScope(id){
  const target = etScopes.find(s => s.id === id);
  if(!target || target.disabled) return;
  const wasSelected = target.selected;

  // Đóng khối khác đang mở -> dọn dòng trống + lưu.
  etScopes.forEach(s => {
    if(s.id !== id && s.selected){
      etCleanupAndSaveScope(s);
      s.selected = false;
    }
  });

  if(wasSelected){
    etCleanupAndSaveScope(target);
    target.selected = false;
  } else {
    target.selected = true;
  }
  etRenderScopeList();
}

/* ---------- Row editing ---------- */
function etUpdateCell(scopeId, rowIndex, field, value){
  const scope = etScopes.find(s => s.id === scopeId);
  if(!scope) return;
  scope.rows[rowIndex][field] = value;
}

// Được gọi khi người dùng focus vào 1 ô input. Nếu đó là dòng cuối cùng —
// tức dòng trống "dự phòng" để nhập — thì nối thêm 1 dòng trống mới ngay
// sau nó, để luôn có sẵn 1 dòng trống chờ nhập.
function etGrowIfLastRow(scopeId, rowIndex){
  const scope = etScopes.find(s => s.id === scopeId);
  if(!scope) return;
  if(rowIndex === scope.rows.length - 1){
    scope.rows.push(etEmptyRow());
    etRenderRulesTable(scope, {rowIndex});
  }
}

// Bấm 1 trong 3 nút tuỳ chọn Aa / [W] / .* trên 1 dòng quy tắc.
function etToggleOpt(scopeId, rowIndex, field){
  const scope = etScopes.find(s => s.id === scopeId);
  if(!scope) return;
  scope.rows[rowIndex][field] = !scope.rows[rowIndex][field];
  etRenderRulesTable(scope);
}

function etRemoveRow(scopeId, rowIndex){
  const scope = etScopes.find(s => s.id === scopeId);
  if(!scope) return;
  if(scope.rows.length <= 1) return;
  scope.rows.splice(rowIndex, 1);
  etRenderRulesTable(scope);
}

// Công tắc "Ưu tiên cụm dài trước" — riêng theo từng phạm vi, lưu lại để
// nhớ giữa các lần mở popup.
function etToggleSort(scopeId){
  const scope = etScopes.find(s => s.id === scopeId);
  if(!scope) return;
  scope.sortByLength = !scope.sortByLength;
  etSortPrefs[scope.key] = scope.sortByLength;
  etSaveSortPrefs();
  etRenderScopeList();
}

// Dòng "trống" = cả 2 ô Từ khoá/Thay bằng đều rỗng.
function etIsRowEmpty(row){
  return row.find.trim() === '' && (row.replace||'').trim() === '';
}

// Tìm dòng trống GẦN NHẤT tính từ fromIndex (dòng người dùng vừa dán vào),
// quét ra 2 phía, ưu tiên phía sau khi khoảng cách bằng nhau — để khi người
// dùng lỡ dán vào 1 dòng ĐÃ có dữ liệu, dữ liệu cũ không bị ghi đè: nội dung
// dán sẽ tự nhảy tới dòng trống gần đó (thường là dòng "dự phòng" ở cuối)
// thay vì đè lên dòng đang chọn. Nếu không còn dòng trống nào, trả về
// scope.rows.length để etApplyPastedLines tự thêm dòng mới ở cuối.
function etNearestEmptyRowIndex(scope, fromIndex){
  if(scope.rows[fromIndex] && etIsRowEmpty(scope.rows[fromIndex])) return fromIndex;
  for(let d = 1; d < scope.rows.length; d++){
    const after = fromIndex + d;
    if(after < scope.rows.length && etIsRowEmpty(scope.rows[after])) return after;
    const before = fromIndex - d;
    if(before >= 0 && etIsRowEmpty(scope.rows[before])) return before;
  }
  return scope.rows.length;
}

// Dán nhiều dòng dạng "A=B" (mỗi dòng 1 cặp Từ khoá=Thay bằng) — tự tách và
// đổ vào lần lượt từng dòng input bắt đầu từ startRowIndex (do caller quyết
// định — xem etNearestEmptyRowIndex(), thường là dòng trống gần nhất chứ
// KHÔNG phải dòng đang dán, để tránh đè dữ liệu cũ), tự thêm dòng mới nếu
// không đủ chỗ. Dòng nào không có dấu "=" thì coi cả dòng đó là "Từ khoá",
// để trống "Thay bằng" (thay vì bỏ qua dòng, vì người dùng có thể chỉ định
// thay bằng chuỗi rỗng — tức xoá từ khoá đó khi áp dụng).
// find luôn được trim (đồng bộ với etCleanupAndSaveScope), replace giữ
// nguyên (không trim) để không mất khoảng trắng cố ý ở đầu/cuối.
function etApplyPastedLines(scope, startRowIndex, rawText){
  const lines = rawText.split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
  if(!lines.length) return false;
  lines.forEach((line, i) => {
    const idx = startRowIndex + i;
    while(scope.rows.length <= idx) scope.rows.push(etEmptyRow());
    const eq = line.indexOf('=');
    if(eq >= 0){
      scope.rows[idx].find = line.slice(0, eq).trim();
      scope.rows[idx].replace = line.slice(eq+1);
    } else {
      scope.rows[idx].find = line.trim();
      scope.rows[idx].replace = '';
    }
  });
  // Luôn chừa sẵn 1 dòng trống ở cuối để nhập tiếp, giống etRowsForScope().
  const last = scope.rows[scope.rows.length-1];
  if(!etIsRowEmpty(last)) scope.rows.push(etEmptyRow());
  return true;
}

/* ---------- Render bảng quy tắc trong 1 khối phạm vi ---------- */
function etRenderRulesTable(scope, focusTarget){
  const block = document.querySelector('.et-scope-block[data-scope="'+scope.id+'"]');
  if(!block) return;
  const table = block.querySelector('.et-rules-table');

  const rowsHtml = '<div class="et-rows">' + scope.rows.map((row, i) => (
      '<div class="et-rule-row" data-row="'+i+'">'
        + '<div class="et-rule-inputs">'
          + '<input class="et-row-input" type="text" placeholder="Từ khoá..." value="'+etEscAttr(row.find)+'" data-field="find" data-row="'+i+'">'
          + ET_ICON_ARROW
          + '<input class="et-row-input" type="text" placeholder="Thay bằng..." value="'+etEscAttr(row.replace)+'" data-field="replace" data-row="'+i+'">'
        + '</div>'
        + '<div class="et-rule-actions">'
          + '<div class="et-opt-group">'
            + '<button type="button" class="et-opt-btn'+(row.matchCase?' active':'')+'" data-opt="matchCase" data-row="'+i+'" title="Phân biệt hoa/thường">Aa</button>'
            + '<button type="button" class="et-opt-btn'+(row.wholeWord?' active':'')+'" data-opt="wholeWord" data-row="'+i+'" title="Khớp đúng từ (Whole word)">[W]</button>'
            + '<button type="button" class="et-opt-btn'+(row.regex?' active':'')+'" data-opt="regex" data-row="'+i+'" title="Regex — biểu thức chính quy">.*</button>'
          + '</div>'
          + '<button class="et-row-del" type="button" data-row="'+i+'" title="Xoá dòng">'+ET_ICON_DEL+'</button>'
        + '</div>'
      + '</div>'
    )).join('') + '</div>';

  const sortRowHtml =
    '<div class="et-sort-row">'
      + '<label class="et-switch">'
        + '<input type="checkbox" '+(scope.sortByLength?'checked':'')+' data-sort-toggle="'+scope.id+'">'
        + '<span class="et-switch-track"></span>'
      + '</label>'
      + '<div class="et-sort-text">'
        + '<div class="et-sort-title">Ưu tiên cụm dài trước</div>'
      + '</div>'
      + '<div class="et-header-io">'
        + '<button type="button" class="et-detail-btn" data-io-detail="'+scope.id+'" title="Xem chi tiết quy tắc">'+ET_ICON_DETAIL+'</button>'
      + '</div>'
    + '</div>';

  table.innerHTML = rowsHtml + sortRowHtml;

  table.querySelectorAll('.et-row-input').forEach(inp => {
    const rowIndex = Number(inp.dataset.row);
    const field = inp.dataset.field;
    inp.addEventListener('input', () => etUpdateCell(scope.id, rowIndex, field, inp.value));
    inp.addEventListener('focus', () => etGrowIfLastRow(scope.id, rowIndex));
    // Dán dạng "A=B" (1 dòng hoặc nhiều dòng, mỗi dòng 1 cặp) — chỉ can thiệp
    // khi nội dung dán CÓ dấu "=" (ít nhất 1 dòng); dán văn bản thường (không
    // "=") thì để trình duyệt tự dán như bình thường vào đúng ô đang gõ.
    inp.addEventListener('paste', (e) => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if(!text || text.indexOf('=') < 0) return;
      e.preventDefault();
      const startRow = etNearestEmptyRowIndex(scope, rowIndex);
      const applied = etApplyPastedLines(scope, startRow, text);
      if(applied) etRenderRulesTable(scope);
    });
  });
  table.querySelectorAll('.et-opt-btn').forEach(btn => {
    btn.addEventListener('click', () => etToggleOpt(scope.id, Number(btn.dataset.row), btn.dataset.opt));
  });
  table.querySelectorAll('.et-row-del').forEach(btn => {
    btn.addEventListener('click', () => etRemoveRow(scope.id, Number(btn.dataset.row)));
  });
  const sortToggle = table.querySelector('[data-sort-toggle]');
  if(sortToggle) sortToggle.addEventListener('change', () => etToggleSort(scope.id));
  const detailBtn = table.querySelector('[data-io-detail]');
  if(detailBtn) detailBtn.addEventListener('click', () => etOpenDetail(scope.id));

  if(focusTarget && focusTarget.rowIndex !== undefined){
    const el = table.querySelector('.et-row-input[data-row="'+focusTarget.rowIndex+'"][data-field="find"]');
    if(el) el.focus();
  }
}

function etRenderScopeList(){
  const wrap = document.getElementById('etScopeList');
  wrap.innerHTML = etScopes.map(scope => {
    const metaCls = 'et-scope-meta' + (scope.id === 'current' && !scope.disabled ? ' accent' : '');
    return '<div class="et-scope-block'+(scope.selected?' selected':'')+(scope.disabled?' disabled':'')+'" data-scope="'+scope.id+'">'
      + '<button class="et-scope-header" type="button" data-toggle="'+scope.id+'">'
        + '<div class="et-scope-glyph">'+scope.icon+'</div>'
        + '<div class="et-scope-text">'
          + '<div class="et-scope-name">'+etEsc(scope.name)+'</div>'
          + (scope.meta ? '<div class="'+metaCls+'">'+etEsc(scope.meta)+'</div>' : '')
        + '</div>'
        + (scope.disabled ? '' : ET_ICON_CHEVRON)
      + '</button>'
      + '<div class="et-scope-rules"><div class="et-scope-rules-inner"><div class="et-rules-table"></div></div></div>'
    + '</div>';
  }).join('');

  wrap.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => etSelectScope(btn.dataset.toggle));
  });

  etScopes.forEach(scope => { if(!scope.disabled) etRenderRulesTable(scope); });
}

/* =====================================================================
   XUẤT / NHẬP quy tắc — riêng cho từng phạm vi (từng truyện)
   Định dạng dòng: <từ khoá>=<thay bằng>=<mã>
   ===================================================================== */
function etExportText(scope){
  const rows = scope.rows.filter(r => !etIsRowEmpty(r));
  return rows.map(r => r.find + '=' + r.replace + '=' + etOptCode(r)).join('\n');
}

/* ---------- Panel "Chi tiết" — gộp chung Xuất + Nhập vào 1 ô nhập liệu ----------
   Mở ra sẵn có nội dung quy tắc hiện tại (dạng text), người dùng có thể:
   - Sao chép / Tải xuống nội dung đang có trong ô.
   - Dán nội dung khác vào ô (nếu ô đã có sẵn nội dung thì nối tiếp xuống
     dưới, không đè lên; ô đang trống thì dán trực tiếp).
   - Sửa trực tiếp trong ô rồi bấm Lưu để ghi đè danh sách quy tắc của phạm vi này. */
function etOpenDetail(scopeId){
  const scope = etScopes.find(s => s.id === scopeId);
  if(!scope) return;
  const panel = document.getElementById('etIOPanel');
  if(!panel) return;
  const rulesText = etExportText(scope);
  const text = ET_CODE_HELP + '\n' + rulesText;
  panel.innerHTML =
    '<button type="button" class="et-io-back" data-io-back="1">'+ET_ICON_BACK+' Quay lại danh sách</button>'
    + '<div class="et-io-title">Chi tiết quy tắc — '+etEsc(scope.name)+'</div>'
    + '<textarea class="et-io-textarea" id="etDetailArea" placeholder="Mỗi dòng 1 quy tắc — dạng: từ khoá=thay bằng=mã">'+etEsc(text)+'</textarea>'
    + '<div class="et-io-actions">'
      + '<button type="button" class="et-io-btn" data-io-copy="1">'+ET_ICON_COPY+' Sao chép</button>'
      + '<button type="button" class="et-io-btn" data-io-paste="1">'+ET_ICON_PASTE+' Dán</button>'
      + '<button type="button" class="et-io-btn" data-io-download="1">'+ET_ICON_DOWNLOAD+' Tải xuống</button>'
      + '<button type="button" class="et-io-btn primary" data-io-save="1">'+ET_ICON_CHECK+' Lưu</button>'
    + '</div>'
    + '<div class="et-io-msg-slot"></div>';

  panel.querySelector('[data-io-back]').addEventListener('click', etShowList);
  panel.querySelector('[data-io-copy]').addEventListener('click', etCopyDetail);
  panel.querySelector('[data-io-paste]').addEventListener('click', etPasteDetail);
  panel.querySelector('[data-io-download]').addEventListener('click', () => etDownloadExport(document.getElementById('etDetailArea').value, scope));
  panel.querySelector('[data-io-save]').addEventListener('click', () => etSaveDetail(scopeId));
  etShowIO();
}

function etCopyDetail(){
  const ta = document.getElementById('etDetailArea');
  const msgSlot = document.querySelector('.et-io-msg-slot');
  const show = (ok, msg) => { msgSlot.innerHTML = '<div class="et-io-msg '+(ok?'ok':'err')+'">'+msg+'</div>'; };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(ta.value).then(
      () => show(true, 'Đã sao chép vào bộ nhớ tạm.'),
      () => show(false, 'Không sao chép được — hãy bôi đen và Ctrl+C thủ công.')
    );
  } else {
    ta.select();
    try{ document.execCommand('copy'); show(true, 'Đã sao chép vào bộ nhớ tạm.'); }
    catch(e){ show(false, 'Không sao chép được — hãy bôi đen và Ctrl+C thủ công.'); }
  }
}
// Bỏ các KHỐI bị TRÙNG LẶP, chỉ giữ lại lần xuất hiện ĐẦU TIÊN — dùng khi
// nối nội dung dán vào ô đã có sẵn dữ liệu, để không bị lặp lại cả khối
// ghi chú "#..." hay từng dòng quy tắc (từ khoá=thay bằng=mã) khi dán
// trùng nội dung cũ. Các dòng "#" liên tiếp được gộp thành 1 khối rồi mới
// so trùng — KHÔNG so từng dòng lẻ — để không xoá nhầm dòng phân cách
// "# ----" lặp lại NGAY TRONG một khối ghi chú hợp lệ (đầu và cuối khối).
// Dòng trống không bị coi là trùng (giữ nguyên để tách đoạn cho dễ đọc).
function etDedupeLines(text){
  const lines = text.split(/\r\n|\r|\n/);
  const blocks = [];
  let i = 0;
  while(i < lines.length){
    const trimmed = lines[i].trim();
    if(!trimmed){
      blocks.push([lines[i]]);
      i++;
      continue;
    }
    if(trimmed.startsWith('#')){
      const block = [lines[i]];
      i++;
      while(i < lines.length && lines[i].trim().startsWith('#')){
        block.push(lines[i]);
        i++;
      }
      blocks.push(block);
      continue;
    }
    blocks.push([lines[i]]);
    i++;
  }

  const seen = new Set();
  const out = [];
  blocks.forEach(block => {
    const isBlank = block.length === 1 && !block[0].trim();
    if(isBlank){ out.push(...block); return; }
    const key = block.map(l => l.trim()).join('\n');
    if(seen.has(key)) return;
    seen.add(key);
    out.push(...block);
  });
  return out.join('\n');
}
function etPasteDetail(){
  const ta = document.getElementById('etDetailArea');
  const msgSlot = document.querySelector('.et-io-msg-slot');
  if(navigator.clipboard && navigator.clipboard.readText){
    navigator.clipboard.readText().then(
      text => {
        // Nếu ô đã có nội dung sẵn thì nối thêm xuống dòng dưới (không đè lên);
        // chỉ gán trực tiếp khi ô đang trống. Sau khi nối, dọn trùng lặp —
        // dòng quy tắc hay dòng ghi chú nào đã có rồi thì chỉ giữ 1 bản.
        const old = ta.value;
        const merged = old.trim() ? old.replace(/\n+$/, '') + '\n' + text : text;
        ta.value = etDedupeLines(merged);
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.scrollTop = ta.scrollHeight;
      },
      () => { msgSlot.innerHTML = '<div class="et-io-msg err">Không đọc được bộ nhớ tạm — hãy dán thủ công bằng Ctrl+V.</div>'; }
    );
  } else {
    msgSlot.innerHTML = '<div class="et-io-msg err">Trình duyệt không hỗ trợ dán tự động — hãy dán thủ công bằng Ctrl+V.</div>';
  }
}
function etSaveDetail(scopeId){
  const scope = etScopes.find(s => s.id === scopeId);
  if(!scope) return;
  const raw = document.getElementById('etDetailArea').value;
  const msgSlot = document.querySelector('.et-io-msg-slot');
  const lines = raw.split(/\r\n|\r|\n/);
  const newRows = [];

  lines.forEach(line => {
    const trimmed = line.trim();
    if(!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('=');
    if(parts.length < 2) return;
    const find = parts[0].trim();
    if(!find) return;
    const replace = parts[1];
    const flags = parts.length >= 3 ? etCodeToFlags(parts[2]) : {regex:false, wholeWord:false, matchCase:false};
    newRows.push({id:null, find, replace, ...flags});
  });

  newRows.push(etEmptyRow());
  scope.rows = newRows;
  etCleanupAndSaveScope(scope);

  msgSlot.innerHTML = '<div class="et-io-msg ok">Đã lưu '+(newRows.length-1)+' quy tắc vào "'+etEsc(scope.name)+'".</div>';
  setTimeout(etShowList, 900);
}
function etDownloadExport(text, scope){
  const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'quy-tac-' + (scope.key||'truyen').replace(/[\\/:*?"<>|]/g,'_') + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
