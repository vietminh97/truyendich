// ===================================================================
// translate.js — Logic dịch & gọi API (tách từ index.html)
// 
// File này KHÔNG dùng type="module" — chạy như 1 classic script bình
// thường, dùng chung scope global với khối <script> chính trong index.html
// (giống cách tts.js đã tách trước đó). Vì vậy:
//  - Mọi hàm/biến top-level trong file này (S, setStatus, renderCh, updChItem,
//    updCtrl, saveSession, renderList, getKeys, getModel, getProvider, chNum,
//    applyReplace, checkNearestFailedPreload, closePopup, toggleSettings,
//    ensurePreload, ensureAuditPipeline, getParallelCount, auditChapterAddressing,
//    getCharMemOn, shouldDisableThinking, getPrompt, v.v.) vẫn được đọc/gọi bình
//    thường từ index.html vì cùng chia sẻ global scope giữa các thẻ <script> classic.
//  - S.xlatingSet (Set các chỉ số chương đang dịch, thay cho cờ boolean S.isXlating cũ) và
//    S.chapterCharSnapshot (snapshot thông tin nhân vật CHỐT SẴN cho từng chương, do pipeline
//    phân tích tuần tự ở index.html chuẩn bị trước — xem ensureAnalyzePipeline()) cho phép
//    xlate() bên dưới chạy THẬT SỰ song song nhiều chương cùng lúc mà không lẫn lộn ngữ cảnh
//    nhân vật giữa các chương (Luồng 1+2 trong tính năng "Dịch song song").
//  - QUAN TRỌNG: file này PHẢI được nạp SAU khối <script> chính (nơi khai báo
//    S = {...} và các hàm trên) vì phần Rate-Limit bên dưới có đoạn tự chạy ngay
//    khi nạp (resetOnPageLoad, clearExpiredQuotaBlocks(), setInterval) và có đọc
//    biến S. Xem thẻ <script src="translate.js"> được đặt ngay sau khối <script>
//    chính trong index.html.
// ===================================================================

// Rate limit: 4 req/min/key/model (per-minute local throttle, đếm theo từng key riêng biệt)
const RL = {};
// Semaphore đếm số request API dịch nội dung chương đang chạy CÙNG LÚC — trước đây là 1 khoá
// boolean (chỉ 1 request tại 1 thời điểm), nhưng giờ đã hỗ trợ dịch SONG SONG nhiều chương (xem
// "Số chương dịch song song" trong Cài đặt / getParallelCount() trong index.html), nên khoá cứng
// 1-request-1-lúc sẽ vô tình xếp hàng tuần tự MỌI request thật dù người dùng đã chọn song song
// nhiều chương — mất hết tác dụng của tính năng. Giờ cho phép tối đa getParallelCount() request
// đồng thời (đúng bằng số chương được phép dịch song song), vẫn giữ vai trò 1 lớp an toàn cuối
// cùng để không bao giờ bắn vượt quá số lượng request đã cấu hình (kể cả khi có request phụ khác
// như dịch tiêu đề/soát chất lượng/phân tích nhân vật chen vào cùng lúc).
let _apiLockCount = 0;
async function acquireApiLock(){
  let waited=false;
  while(_apiLockCount>=getParallelCount()){
    if(!waited){flowLog('api',`Đầy slot (${_apiLockCount}/${getParallelCount()}) — chờ tới lượt gọi API...`);waited=true;}
    await new Promise(r=>setTimeout(r,200));
  }
  _apiLockCount++;
  flowLog('api',`Chiếm slot gọi API: ${_apiLockCount}/${getParallelCount()} đang chạy.`);
}
function releaseApiLock(){
  _apiLockCount=Math.max(0,_apiLockCount-1);
  flowLog('api',`Trả slot gọi API: ${_apiLockCount}/${getParallelCount()} đang chạy.`);
}
function rlKeyId(model,key){return model+':'+key.slice(-8);}
function rlCheck(model,key){
  const id=rlKeyId(model,key);
  const now=Date.now();
  if(!RL[id])RL[id]=[];
  RL[id]=RL[id].filter(t=>now-t<60000);
  return RL[id].length<4; // 4 req/min/key (an toàn hơn giới hạn thật là 5)
}
function rlRecord(model,key){
  const id=rlKeyId(model,key);
  if(!RL[id])RL[id]=[];
  RL[id].push(Date.now());
}


// ===== DAILY RATE LIMIT (429 quota exhausted → skip đến ngày mai) =====
// key: 'dich-rl:<model>:<keyHash>'  value: timestamp khi bị block
function _rlDayKey(model,apiKey){
  // dùng 8 ký tự cuối của key để tránh lưu key thật
  const h=apiKey.slice(-8);
  return 'dich-rl:'+model+':'+h;
}
function rlDayBlocked(model,apiKey){
  try{
    const k=_rlDayKey(model,apiKey);
    const v=localStorage.getItem(k);
    if(!v)return false;
    const ts=parseInt(v);
    // Reset lúc 00:00 giờ Thái Bình Dương (America/Los_Angeles) — cùng lúc Gemini refresh quota
    if(ts<getLastPTMidnight()){localStorage.removeItem(k);return false;}
    return true;
  }catch(e){return false;}
}
function rlDayBlock(model,apiKey){
  try{localStorage.setItem(_rlDayKey(model,apiKey),Date.now().toString());}catch(e){}
}

// ===== AUTO RESET QUOTA LÚC 00:00 GIỜ THÁI BÌNH DƯƠNG =====
// Trả về timestamp của lần 00:00 PT (America/Los_Angeles) gần nhất đã qua
function getLastPTMidnight(){
  // Reset lúc 15:00 giờ Việt Nam (Asia/Ho_Chi_Minh = UTC+7)
  try{
    const now=new Date();
    const vnDateStr=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    // 15:00:00 VN = vnDateStr 08:00:00 UTC (UTC+7 → trừ 7h)
    const reset=new Date(vnDateStr+'T08:00:00Z').getTime();
    // Nếu mốc reset hôm nay chưa tới → lấy hôm qua
    return reset>now.getTime()?reset-86400000:reset;
  }catch(e){
    // Fallback: UTC+7 cố định
    const now=Date.now();
    const reset=Math.floor((now+7*3600000)/86400000)*86400000-7*3600000+8*3600000;
    return reset>now?reset-86400000:reset;
  }
}

// Xóa tất cả các block quota nếu chúng được đánh dấu TRƯỚC lần reset gần nhất
function clearExpiredQuotaBlocks(){
  try{
    const resetTime=getLastPTMidnight();
    const toDelete=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(!k||!k.startsWith('dich-rl:'))continue;
      const ts=parseInt(localStorage.getItem(k));
      if(ts&&ts<resetTime)toDelete.push(k);
    }
    if(toDelete.length){
      toDelete.forEach(k=>localStorage.removeItem(k));
      console.log('[AutoReset] Đã reset '+toDelete.length+' quota block(s) sau 00:00 PT.');
      S.keyIdx=0; // quay về key 1 sau khi reset quota
      S.activeModelIdx=0; // quay về model chính ban đầu sau khi reset quota
      if(typeof setStatus==='function')setStatus('🔄 Đã tự động reset quota — tiếp tục dịch từ key 1, model 1',4000);
    }
  }catch(e){}
}

// ===== RESET TOÀN BỘ RATE-LIMIT/QUOTA — dùng chung cho reload trang & retry sau lỗi =====
// Xóa TOÀN BỘ đánh dấu lỗi 429/503/quota, quay về key 1 / model 1,
// y hệt như khi reload lại file.
function resetAllRateLimitsAndQuota(){
  try{
    const toDelete=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k&&k.startsWith('dich-rl:'))toDelete.push(k);
    }
    if(toDelete.length){
      toDelete.forEach(k=>localStorage.removeItem(k));
      console.log('[ResetRateLimit] Đã xóa '+toDelete.length+' quota block(s).');
    }
    S.keyIdx=0;
    S.activeModelIdx=0;
  }catch(e){}
}

// ===== RESET LỖI KHI RELOAD TRANG =====
// Mỗi lần trang được load (reload file), xóa TOÀN BỘ đánh dấu lỗi 429/503/quota
// để bắt đầu dịch lại từ key 1 như mới hoàn toàn.
(function resetOnPageLoad(){
  resetAllRateLimitsAndQuota();
})();

// Chạy kiểm tra ngay lập tức và mỗi 15 phút (reset lúc 15:00 VN nếu không reload)
clearExpiredQuotaBlocks();
setInterval(clearExpiredQuotaBlocks,15*60*1000);


// Thứ tự trong mảng này = thứ tự "cấp bậc" từ cao xuống thấp (KHÔNG phải thứ tự
// hiển thị trong dropdown). Dùng để tính chuỗi fallback CHỈ ĐI XUỐNG cấp thấp hơn
// (xem mOrder bên dưới) — model mới/mạnh hơn hết quota thì rơi xuống model kế tiếp
// trong danh sách này, KHÔNG BAO GIỜ quay lại model cấp cao hơn model người dùng
// đã chọn ban đầu.
const MODELS=["gemini-3.6-flash","gemini-3.5-flash","gemini-3-flash-preview","gemini-3.5-flash-lite"];
// ===== DEEPSEEK =====
// DeepSeek thực ra chỉ có 1 model API thật (V4 Flash) — nhưng cho phép chọn giữa 2 "chế độ"
// khác nhau về việc BẬT/TẮT thinking (reasoning_effort) khi dịch chính, đánh đổi tốc độ lấy
// chất lượng:
//  - "deepseek-v4-flash"         : TẮT thinking → nhanh hơn, nhưng dễ sót lỗi/xưng hô hơn.
//  - "deepseek-v4-flash-quality" : BẬT thinking (mặc định của DeepSeek) → chậm hơn rõ rệt,
//                                   nhưng model suy luận kỹ hơn trước khi trả lời, ít bị lỗi hơn.
// Cả 2 chỉ là "model ảo" ở phía app — khi gọi API thật sự đều map về đúng 1 chuỗi model
// "deepseek-v4-flash" (xem callDeepseekAPI). Giữ 2 giá trị riêng để: (1) hiển thị đúng 2 lựa
// chọn khác nhau trong dropdown model, (2) tách riêng rate-limit/quota tracking theo từng chế
// độ, (3) callAPIFull() dựa vào ĐÚNG giá trị này (không phải 1 cờ cấu hình rời) để quyết định
// disableThinking cho lượt dịch chính — nên khi fallback/escalate qua lại giữa 2 "model" này
// (xem MAIN_MODELS/LITE_MODEL bên dưới), lượt gọi API luôn tự động dùng đúng chế độ thinking
// tương ứng với model đang thử, không cần thêm state riêng.
const DEEPSEEK_MODELS=["deepseek-v4-flash","deepseek-v4-flash-quality"];
// Model ảo -> tên model thật gửi lên API DeepSeek. Không có trong bảng này thì coi model ảo
// CHÍNH LÀ tên thật luôn (áp dụng cho "deepseek-v4-flash").
const DEEPSEEK_REAL_MODEL={"deepseek-v4-flash-quality":"deepseek-v4-flash"};
const ALL_MODELS=MODELS.concat(DEEPSEEK_MODELS);
const MLBL={"gemini-3.6-flash":"3.6 Flash","gemini-3.5-flash":"3.5 Flash","gemini-3-flash-preview":"3 Flash","gemini-3.5-flash-lite":"3.5 Flash Lite","deepseek-v4-flash":"DeepSeek V4 Flash NT","deepseek-v4-flash-quality":"DeepSeek V4 Flash T"};

// ===================================================================
// ===== DỊCH TIÊU ĐỀ CHƯƠNG (riêng, gọi API nhẹ — không gộp vào lượt dịch nội dung) =====
// ===================================================================
// Model nhẹ dùng để dịch tiêu đề (cùng model dùng cho phân tích nhân vật trong
// character-memory.js — 'gemini-3.5-flash-lite', rẻ và đủ cho việc dịch câu ngắn).
// Không tham chiếu trực tiếp CHAR_ANALYSIS_MODEL vì character-memory.js được nạp
// SAU khối script này nên biến đó chưa tồn tại tại thời điểm khai báo ở đây.
// DeepSeek chỉ có 1 model — không có model nhẹ riêng như Gemini để dịch tiêu đề, dùng luôn
// hàm getTitleXlateModel() bên dưới thay vì hằng số cố định.
const TITLE_XLATE_MODEL='gemini-3.5-flash-lite';
function getTitleXlateModel(){return (typeof getProvider==='function'&&getProvider()==='deepseek')?getModel():TITLE_XLATE_MODEL;}
// Vì tiêu đề rất ngắn, có thể gộp nhiều tiêu đề vào 1 lần gọi API mà vẫn an toàn về
// giới hạn token đầu ra — 500 tiêu đề/lần là mức cân bằng giữa hiệu quả (ít lượt gọi)
// và độ tin cậy (JSON trả về không quá dài, tránh bị cắt giữa chừng).
const TITLE_BATCH_SIZE=500;
// Số lần tối đa dịch LẠI 1 tiêu đề nếu kết quả trả về vẫn còn sót ký tự Hán (model có
// thể không dịch được tên riêng/thuật ngữ đặc thù) — tránh vòng lặp gọi API vô hạn.
const MAX_TITLE_RETRY=3;
let _titleXlating=false;
// Đếm số lần đã thử dịch lại cho từng chỉ số chương (chỉ tồn tại trong phiên làm việc
// hiện tại, không cần lưu persist — reload trang thì thử lại từ đầu cũng không sao).
const _titleRetryCount={};
// Phát hiện ký tự Hán còn sót lại trong bản dịch (CJK Unified Ideographs + Extension A +
// Compatibility) — dùng để quyết định có cần gọi API dịch lại tiêu đề đó hay không.
const CJK_CHAR_RE=/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
function hasCJK(s){return CJK_CHAR_RE.test(s||'');}
// Tính tỷ lệ ký tự Hán (CJK) trên tổng số ký tự CHỮ (không tính khoảng trắng/số/dấu câu) trong
// văn bản — dùng để phát hiện bản dịch CẢ CHƯƠNG còn sót QUÁ NHIỀU tiếng Trung chưa được dịch.
// Khác hasCJK() ở trên (chỉ trả về CÓ/KHÔNG, dùng cho tiêu đề ngắn) — với nội dung cả chương cần
// biết MỨC ĐỘ sót nhiều hay ít để quyết định có đáng tự động dịch lại cả chương hay không, vì vài
// tên riêng/thuật ngữ còn sót rải rác là bình thường, không nên coi là lỗi và dịch lại tốn quota oan.
function cjkRatio(text){
  if(!text)return 0;
  const cjkCount=(text.match(new RegExp(CJK_CHAR_RE.source,'g'))||[]).length;
  if(!cjkCount)return 0;
  const letterCount=(text.match(/[\p{L}]/gu)||[]).length;
  return letterCount?cjkCount/letterCount:0;
}
// Ngưỡng % ký tự Hán còn sót (tính trên tổng ký tự chữ) để coi bản dịch chương là THIẾU NGHIÊM
// TRỌNG, cần tự động gọi API dịch lại cả chương — theo yêu cầu: trên 20% vẫn còn tiếng Trung.
const CHAPTER_CJK_RATIO_THRESHOLD=0.10;
// Số lần tối đa tự động dịch lại 1 chương chỉ vì lý do "còn sót tiếng Trung quá ngưỡng" (tránh
// vòng lặp gọi API vô hạn/tốn quota oan nếu bản chất chương đó không thể dịch sạch hết được, VD
// văn bản gốc lỗi/thiếu, hoặc model liên tục lặp lại đúng lỗi cũ).
const MAX_CHAPTER_CJK_RETRY=2;

// Tách "Chương N:" (giữ nguyên) và " - Phần X" (giữ nguyên, nếu có) ra khỏi phần tên
// chương cần dịch. Trả về null nếu tiêu đề không theo format chuẩn (Mở đầu, Toàn bộ
// truyện, Phần N do fallback chia theo ký tự...) hoặc không có phần tên riêng để dịch.
function extractTitleParts(title){
  const m=(title||'').match(/^(Chương\s+\d+:)\s*(.*?)(\s-\sPhần\s\d+)?$/);
  if(!m)return null;
  const body=(m[2]||'').trim();
  if(!body)return null;
  return {prefix:m[1],body,suffix:m[3]||''};
}

// Gom tất cả tiêu đề chưa dịch (tối đa TITLE_BATCH_SIZE/lượt) và gọi API dịch 1 lần.
// Chạy song song với việc dịch nội dung chương (không await ở nơi gọi) — lỗi ở đây
// không ảnh hưởng tới luồng dịch chính, chỉ log cảnh báo và bỏ qua.
async function ensureTitlesTranslated(){
  if(_titleXlating||!S.chapters||!S.chapters.length)return;
  const myGen=S.gen; // phát hiện chuyển truyện giữa lúc đang dịch tiêu đề
  const keys=getKeys();
  if(!keys.length)return;
  const pending=[];
  for(let i=0;i<S.chapters.length&&pending.length<TITLE_BATCH_SIZE;i++){
    const parts=extractTitleParts(S.chapters[i].title);
    if(!parts)continue;
    if(S.translatedTitles[i]){
      // Đã có bản dịch — chỉ dịch LẠI nếu kết quả cũ vẫn còn ký tự Hán và chưa vượt
      // số lần thử lại cho phép. Luôn dịch lại từ tiêu đề GỐC (parts.body lấy từ
      // S.chapters[i].title, không đổi qua các lần dịch) để model có đủ ngữ cảnh gốc.
      if(!hasCJK(S.translatedTitles[i]))continue;
      const retries=_titleRetryCount[i]||0;
      if(retries>=MAX_TITLE_RETRY)continue;
      _titleRetryCount[i]=retries+1;
    }
    pending.push({id:i,text:parts.body});
  }
  if(!pending.length)return;
  console.log(`[Title Xlate] Phát hiện ${pending.length} tiêu đề chưa dịch, đang gọi API...`);
  _titleXlating=true;
  try{
    const reqText='Dịch các tiêu đề chương truyện sau sang tiếng Việt tự nhiên, ngắn gọn, đúng văn phong tiểu thuyết (không giải thích, không thêm ghi chú, không thêm số thứ tự). '+
      'Trả về DUY NHẤT 1 mảng JSON hợp lệ, mỗi phần tử dạng {"id":<số>,"vi":"<bản dịch>"}, giữ nguyên đúng "id" đã cho cho từng tiêu đề tương ứng, không thêm/bớt/đổi thứ tự phần tử. '+
      'Nếu 1 tiêu đề đã là tiếng Việt hoặc không rõ nghĩa để dịch, giữ nguyên nội dung gốc trong "vi".\n\nDanh sách:\n'+
      JSON.stringify(pending);
    const messages=[{role:'user',parts:[{text:reqText}]}];
    // Ngân sách token riêng cho lượt dịch tiêu đề — KHÔNG dùng ô "Max tokens" của người
    // dùng (ô đó dành cho dịch nội dung chương, có thể bị chỉnh thấp ~16-20k). Ước lượng
    // ~50 token/tiêu đề (kể cả overhead JSON) + biên an toàn, tối thiểu 4096, tối đa 32768.
    const titleMaxTok=Math.min(32768,Math.max(4096,pending.length*50+1000));
    let resultText=null,lastErr=null;
    for(let ki=0;ki<keys.length;ki++){
      try{
        // Dịch tiêu đề chương là tác vụ ngắn/đơn giản — tắt thinking khi dùng DeepSeek để
        // tiết kiệm token (không ảnh hưởng Gemini, model đó tự quản lý thinking riêng).
        const r=await callAPI(keys[ki],getTitleXlateModel(),messages,titleMaxTok,true);
        resultText=r.text;
        break;
      }catch(e){lastErr=e;}
    }
    if(!resultText){console.warn('[Title Xlate] Lỗi dịch tiêu đề, sẽ thử lại ở lượt sau:',lastErr?.message);return;}
    let arr=null;
    try{
      const jm=resultText.match(/\[[\s\S]*\]/);
      arr=JSON.parse(jm?jm[0]:resultText);
    }catch(e){console.warn('[Title Xlate] JSON trả về không hợp lệ:',resultText.slice(0,300));return;}
    if(!Array.isArray(arr))return;
    if(myGen!==S.gen)return; // đã chuyển sang truyện khác trong lúc chờ API → bỏ kết quả cũ
    let changed=false;
    for(const item of arr){
      const idx=item?.id;
      if(typeof idx!=='number'||!S.chapters[idx])continue;
      const parts=extractTitleParts(S.chapters[idx].title);
      if(!parts)continue;
      const vi=(item.vi||'').trim();
      if(!vi)continue;
      S.translatedTitles[idx]=`${parts.prefix} ${vi}${parts.suffix}`;
      changed=true;
    }
    if(changed){
      console.log(`[Title Xlate] Hoàn tất lượt dịch tiêu đề: ${arr.length} tiêu đề.`);
      saveSession();
      renderList();
      if(S.cur>=0)renderCh(S.cur);
    }
  }catch(e){
    console.warn('[Title Xlate] Lỗi:',e);
  }finally{
    _titleXlating=false;
    // Nếu còn tiêu đề chưa dịch (do bị giới hạn TITLE_BATCH_SIZE), HOẶC còn tiêu đề đã
    // dịch nhưng vẫn sót ký tự Hán và chưa hết lượt thử lại → tự chạy tiếp lượt sau
    const stillPending=S.chapters.some((ch,i)=>{
      if(!extractTitleParts(ch.title))return false;
      if(!S.translatedTitles[i])return true;
      return hasCJK(S.translatedTitles[i])&&(_titleRetryCount[i]||0)<MAX_TITLE_RETRY;
    });
    if(stillPending)setTimeout(()=>ensureTitlesTranslated(),500);
  }
}

function doTranslate(){
  S.everStarted=true;
  // Không còn tự ép bật "Tự động dịch" ở đây nữa — trạng thái bật/tắt giờ hoàn toàn do người
  // dùng tự quyết định qua nút #autoBtn (toggleAuto()). Mặc định ban đầu (lần đầu dùng tool,
  // chưa từng lưu lựa chọn) vẫn là BẬT — xem loadSettings() trong index.html.
  // không dịch lại nếu đã có bản dịch rồi
  if(S.translations[S.cur]){ensurePreload();return;}
  // Người dùng chủ động bấm Dịch cho đúng chương đang hiện popup "chương lỗi" → đóng popup
  if(_failedPopupChIdx===S.cur)closePopup();
  // Xóa flag lỗi — người dùng chủ động nhấn Dịch nên được thử lại
  delete S.failed[S.cur];
  if(S.autoFailed)delete S.autoFailed[S.cur];
  if(S.dismissedAutoFailedPreload)S.dismissedAutoFailedPreload.delete(S.cur);
  S.preloading.delete(S.cur);
  // Đánh dấu chương này đang được dịch thủ công để preload không chen vào
  if(!S.manualChapters)S.manualChapters=new Set();
  S.manualChapters.add(S.cur);
  // nếu chương này bị kẹt ở trạng thái "đang dịch" từ trước (VD lỗi dở dang), reset lại
  if(S.xlatingSet.has(S.cur)){S.xlatingSet.delete(S.cur);S.stopReq=false;}
  updCtrl();
  const targetCh=S.cur;
  xlate(targetCh).then(()=>{
    if(S.manualChapters)S.manualChapters.delete(targetCh);
    ensurePreload();
  });
  // QUAN TRỌNG: cũng gọi ensurePreload() ngay ở đây (không đợi xlate(targetCh) xong) — nếu không,
  // với LƯỢT DỊCH THỦ CÔNG ĐẦU TIÊN của cả truyện (trước đó chưa có lượt preload/ensurePreload nào
  // từng chạy), pipeline phân tích nhân vật (ensureAnalyzePipeline — xem index.html) chỉ được đánh
  // thức lần đầu SAU KHI xlate(targetCh) resolve — tức toàn bộ việc phân tích/cập nhật thông tin
  // nhân vật cho các chương dự bị phía sau phải ĐỨNG YÊN chờ đúng 1 chương đầu tiên dịch xong, thay
  // vì chạy song song ngay từ đầu như mọi chương sau đó (khi ensurePreload() đã được "mồi" 1 lần,
  // nó tự dây chuyền gọi lại chính nó liên tục nên không còn gặp lại vấn đề này nữa).
  ensurePreload();
}
function doRetranslate(){
  if(S.cur<0)return;
  if(_failedPopupChIdx===S.cur)closePopup();
  delete S.translations[S.cur];delete S.failed[S.cur];if(S.autoFailed)delete S.autoFailed[S.cur];
  if(S.dismissedAutoFailedPreload)S.dismissedAutoFailedPreload.delete(S.cur);
  S.preloading.delete(S.cur);
  // Đánh dấu "đang dịch thủ công" giống doTranslate() — tránh preload nền chen ngang dịch
  // trùng cho đúng chương này khi đang dịch song song nhiều chương.
  if(!S.manualChapters)S.manualChapters=new Set();
  S.manualChapters.add(S.cur);
  const targetCh=S.cur;
  updChItem(targetCh);
  xlate(targetCh).then(()=>{
    if(S.manualChapters)S.manualChapters.delete(targetCh);
    ensurePreload();
  });
  // Xem giải thích trong doTranslate(): mồi ensurePreload() ngay, không đợi xlate() xong.
  ensurePreload();
}

async function xlate(i,isPre=false){
  const keys=getKeys();
  if(!keys.length){
    // Tắt luôn chế độ tự động dịch để ensurePreload()/vòng preload không tiếp tục
    // kích hoạt thêm các lượt xlate() khác (mỗi lượt lại thiếu key) → tránh thông báo lặp lại.
    if(S.auto){S.auto=false;localStorage.setItem('dich-auto','0');updAutoBtn();}
    S.xlatingSet.delete(i);
    alert(`Vui lòng nhập ít nhất 1 ${getProvider()==='deepseek'?'DeepSeek':'Gemini'} API key trong Cài đặt!`);
    toggleSettings();
    updCtrl();
    return;
  }
  S.xlatingSet.add(i);S.stopReq=false;
  flowLog(2,`xlate() chương ${chNum(i)} — ${isPre?'nền/preload':'thủ công (nút Dịch)'} — model ưu tiên: ${getModel()} (${getProvider()}) — đang dịch song song: [${[...S.xlatingSet].map(chNum).join(', ')}]`);
  // Ghi lại "phiên" của truyện đang dịch tại thời điểm bắt đầu. Nếu người dùng chuyển
  // sang truyện khác trước khi lượt dịch này xong, S.gen sẽ đổi → dùng để phát hiện
  // kết quả đã lỗi thời ở cuối hàm, tránh ghi nhầm vào bản dịch của truyện mới.
  const myGen=S.gen;
  // Chỉ render khung đọc nếu chương i ĐANG được đọc (i===S.cur). Trước đây điều
  // kiện chỉ dựa vào !isPre nên khi bấm "Dịch lại" ở popup cho 1 chương preload
  // KHÔNG phải chương đang đọc, renderCh(i) vẫn chạy → màn hình bị "nhảy" sang
  // chương đó dù S.cur không đổi. Giờ dịch lại chương lỗi hoàn toàn ở nền, không
  // làm thay đổi chương đang hiển thị.
  if(!isPre&&i===S.cur)renderCh(i);
  updChItem(i);
  // Chương i vừa được thêm vào S.xlatingSet (dù là dịch nền/preload cho 1 chương KHÁC
  // chương đang xem) → cập nhật ngay nút Dịch/Dừng/Dịch lại của chương đang xem — updCtrl()
  // chỉ đọc S.xlatingSet.has(S.cur) nên các chương KHÁC đang dịch song song không còn ảnh
  // hưởng tới nút của chương đang xem như cờ S.isXlating toàn cục trước đây.
  updCtrl();
  const ch=S.chapters[i];
  const pref=getModel();
  const provider=getProvider();
  // ===== DANH SÁCH MODEL CHÍNH (chỉ 3 model: 3.6 Flash / 3.5 Flash / 3 Flash) =====
  // Model 3.5 Flash Lite KHÔNG nằm trong danh sách fallback "chính" này — nó chỉ được
  // dùng khi CẢ 3 model chính đã hết quota ngày ở TẤT CẢ API key (xem escalate bên dưới).
  // Lưu ý phân biệt 2 loại fallback khác nhau cho model chính:
  //  - Hết quota NGÀY (429 RPD) ở TẤT CẢ key: escalate "model chính" CHỈ ĐI XUỐNG cấp
  //    thấp hơn theo thứ tự cố định, không quay lại cấp cao hơn model đã chọn (persistent
  //    trong toàn phiên). VD: chọn 3.6 → 3.5 → 3 Flash → (hết quota mới tới Lite).
  //  - Lỗi 503/502/500: ĐI CẢ 2 CHIỀU, ưu tiên thử model CAO hơn trước — xem
  //    attemptOnKeyWithModelFallback bên dưới.
  // DeepSeek chỉ có 1 model (V4 Flash) nên không có gì để fallback/escalate lên/xuống —
  // LITE_MODEL trùng với chính model đó, MAIN_MODELS rỗng → mọi lượt thử luôn dùng đúng
  // 1 model này trên mỗi key, hết key thì chờ rồi thử lại (10s cho DeepSeek, 30s cho
  // Gemini — xem RETRY_WAIT_MS/vòng lặp bên dưới).
  const LITE_MODEL=provider==='deepseek'?'deepseek-v4-flash':'gemini-3.5-flash-lite';
  const MAIN_MODELS=(provider==='deepseek'?DEEPSEEK_MODELS:MODELS).filter(m=>m!==LITE_MODEL); // [3.6,3.5,3-flash] (rỗng nếu DeepSeek)
  const mainPrefIdx=MAIN_MODELS.indexOf(pref);
  // Nếu người dùng chọn thẳng Lite làm model mặc định → không còn model chính nào phía
  // trên để thử trước, coi như đã ở chế độ Lite ngay từ đầu.
  const mOrderMain=mainPrefIdx===-1?[]:MAIN_MODELS.slice(mainPrefIdx);
  // S.activeModelIdx: 0..mOrderMain.length-1 = đang dùng model chính tương ứng trong
  // mOrderMain; === mOrderMain.length nghĩa là đã hết quota ngày ở cả 3 model chính
  // (mọi key) → giờ dùng Lite làm "model chính" thay thế.
  // Tăng dần khi tất cả key hết quota ngày cho model chính hiện tại, reset về 0 khi
  // quota được reset (xem resetAllRateLimitsAndQuota / AutoReset).
  if(S.activeModelIdx===undefined)S.activeModelIdx=0;
  // Đảm bảo không vượt quá số model (kể cả vị trí "Lite" ở cuối)
  if(S.activeModelIdx>mOrderMain.length)S.activeModelIdx=0;
  let result=null,lastErr='';
  // Đếm số lỗi 503/502/500 LIÊN TIẾP (bất kể key/model nào), reset về 0 ngay khi có
  // 1 lượt gọi thành công. Dùng để tăng dần thời gian chờ (backoff) thay vì bắn
  // request dồn dập sang key/model kế tiếp ngay lập tức — tránh làm tình trạng
  // quá tải server (nguyên nhân gây 503) thêm trầm trọng.
  let consec503=0;
  // Số lần đã tự động dịch lại NGUYÊN CHƯƠNG này (trong lượt xlate() hiện tại) chỉ vì bản dịch
  // trả về còn sót quá CHAPTER_CJK_RATIO_THRESHOLD tiếng Trung — xem chỗ dùng ở vòng lặp chính
  // bên dưới. Cục bộ theo từng lượt gọi xlate() (không cần lưu persist) — mỗi lần người dùng
  // chủ động bấm "Dịch"/"Dịch lại" là 1 lượt xlate() mới, tự nhiên được thử lại từ đầu.
  let cjkRetryCount=0;

  // Giới hạn thời gian CHÍNH XÁC cho cả chương: quá CHAPTER_TIMEOUT_MS kể từ lúc bắt
  // đầu (kể cả đang chờ giữa chừng một lượt thử key/model) → dừng NGAY và đánh dấu
  // chương lỗi, không đợi cho lượt thử hiện tại chạy xong.
  // DeepSeek dịch chậm hơn Gemini khá nhiều, và người dùng DeepSeek thường chỉ nhập
  // đúng 1 key (không có nhiều key để xoay vòng) — nên áp mốc 6 phút của Gemini vào
  // đây là vô nghĩa, chỉ khiến chương bị bỏ cuộc oan trong khi vẫn có thể dịch được
  // nếu kiên nhẫn thử lại. Vì vậy KHÔNG giới hạn thời gian với DeepSeek: cứ liên tục
  // thử lại (mỗi vòng cách nhau 10s — xem RETRY_WAIT_MS bên dưới) tới khi thành công
  // hoặc người dùng chủ động bấm Dừng.
  const CHAPTER_TIMEOUT_MS=provider==='deepseek'?Infinity:10*60*1000; // 10 phút (chỉ Gemini)
  // Thời gian chờ khi lỗi (RPM/429, hoặc "hết mọi cách" ở vòng lặp ngoài) — DeepSeek chờ
  // NGẮN HƠN Gemini (10s thay vì 30s): DeepSeek chỉ có 1 model/thường 1 key nên không có
  // gì để xoay vòng thử trong lúc chờ, chờ lâu chỉ làm mất thời gian vô ích; còn Gemini có
  // nhiều model/key để thử nên vẫn giữ 30s như cũ (đủ để qua cơn giới hạn tần suất theo phút).
  const RETRY_WAIT_MS=provider==='deepseek'?10000:30000;
  const RETRY_WAIT_SEC=RETRY_WAIT_MS/1000;
  const xlateStartTs=Date.now();
  const msLeft=()=>CHAPTER_TIMEOUT_MS-(Date.now()-xlateStartTs);
  const isTimedOut=()=>msLeft()<=0;
  // Chờ tối đa `ms`, nhưng không bao giờ vượt quá thời gian còn lại trước deadline.
  // Trả về true nếu đã hết giờ (deadline đã tới) sau khi chờ xong.
  async function timedWait(ms){
    const w=Math.max(0,Math.min(ms,msLeft()));
    if(w>0)await new Promise(r=>setTimeout(r,w));
    return isTimedOut();
  }
  // Nhãn hiển thị mốc thời gian trong setStatus — tránh in ra "Infinitys" khi
  // CHAPTER_TIMEOUT_MS=Infinity (trường hợp DeepSeek không giới hạn thời gian).
  const timeoutLabel=CHAPTER_TIMEOUT_MS===Infinity?'không giới hạn':(CHAPTER_TIMEOUT_MS/1000)+'s';

  // ===== DỊCH TIÊU ĐỀ: luôn quét toàn bộ chương để dịch hết các tiêu đề còn thiếu
  // (không chỉ chương đang mở) — chạy song song, không await, không chặn dịch nội dung =====
  ensureTitlesTranslated();

  // ===== CHARACTER MEMORY (Luồng 1+2): dùng ĐÚNG snapshot đã được pipeline phân tích tuần tự
  // ở index.html chốt sẵn cho chương i (xem ensureAnalyzePipeline()/S.chapterCharSnapshot) —
  // KHÔNG tự phân tích lại ở đây nữa, để nhiều chương dịch song song không bao giờ ghi chồng
  // lên bộ nhớ nhân vật DÙNG CHUNG lộn xộn thứ tự. _startPreload() đã đảm bảo chỉ gọi xlate()
  // khi snapshot của chương i đã sẵn sàng.
  // Fallback: xlate() cũng được gọi TRỰC TIẾP (không qua gate của _startPreload) khi người dùng
  // chủ động bấm "Dịch"/"Dịch lại" — trường hợp này chưa chắc đã có snapshot, nên vẫn tự phân
  // tích tại chỗ như 1 lớp an toàn (lỗi ở bước này không bao giờ chặn dịch — tự nuốt mọi lỗi).
  // Dùng getChapterCharSnapshot(i) (index.html) thay vì gọi thẳng analyzeChapterCharacters(i) —
  // vì ensurePreload() giờ được gọi NGAY khi bắt đầu dịch thủ công (xem doTranslate()/doRetranslate()),
  // pipeline tuần tự (ensureAnalyzePipeline) có thể ĐANG CÙNG LÚC tự nhận đúng chương i này làm
  // target và cũng bắt đầu phân tích nó. getChapterCharSnapshot() đảm bảo dù bên nào khởi động
  // trước, chương i chỉ thực sự bị phân tích (gọi API) ĐÚNG 1 LẦN — bên gọi sau chỉ "đón" lại kết
  // quả của bên gọi trước, tránh tốn gấp đôi API cho cùng 1 chương.
  let characterContextText='';
  let appearedChars=[];
  if(getCharMemOn()){
    let snap=S.chapterCharSnapshot&&S.chapterCharSnapshot[i];
    if(!snap){
      flowLog(1,`Chương ${chNum(i)}: chưa có snapshot (dịch thủ công, bỏ qua gate của Luồng 1) — tự phân tích nhân vật tại chỗ.`);
      snap=await getChapterCharSnapshot(i);
      appearedChars=snap.appearedChars;
      characterContextText=snap.characterContextText;
      if(myGen===S.gen){
        // Chương này vừa được phân tích "tay" (ngoài pipeline tuần tự) — nếu nó đang nằm
        // TRƯỚC vị trí con trỏ phân tích tuần tự, đẩy con trỏ qua khỏi nó để pipeline không
        // tự phân tích lại chương đã có snapshot này.
        if(typeof _analyzeCursor!=='undefined'&&_analyzeCursor<=i)_analyzeCursor=i+1;
      }
    }else{
      flowLog(2,`Chương ${chNum(i)}: dùng snapshot nhân vật có sẵn từ Luồng 1 (${snap.appearedChars.length} nhân vật).`);
      appearedChars=snap.appearedChars;
      characterContextText=snap.characterContextText;
    }
    if(document.getElementById('charmemDrawer')?.classList.contains('open'))renderCharList();
  }

  // Thử 1 (key, model chính) cụ thể. Nếu gặp lỗi 503/502/500, KHÔNG đổi key — thử các
  // model khác trong CẢ 3 model chính (kể cả model CAO hơn model chính hiện tại, ưu
  // tiên thử cao hơn trước — xem cycle ở trên) NGAY TRÊN CÙNG KEY NÀY, cho tới khi
  // thành công hoặc hết sạch model để thử (lúc đó mới báo cho vòng lặp ngoài chuyển
  // sang key khác).
  // Nếu gặp lỗi 429 hết quota ngày (RPD) ở BẤT KỲ model nào trong lúc thử → đổi KEY
  // KHÁC NGAY LẬP TỨC (không cố các model khác trên cùng key), vì quota ngày là hạn mức
  // riêng theo từng cặp (model, key) — không phải model đó "tệ" mà là chính key đó đã
  // dùng hết phần của model này, không liên quan gì tới model khác.
  // Trả về { success, timedOut, mainModelDayBlocked, invalidKey }
  // mainModelDayBlocked=true nghĩa là chính MODEL CHÍNH (không phải model fallback) đã
  // hết quota ngày trên key này — dùng để vòng lặp ngoài biết khi nào TẤT CẢ key đều đã
  // hết quota ngày cho model chính, từ đó mới escalate lên model chính kế tiếp.
  async function attemptOnKeyWithModelFallback(ki2,mainIdx){
    const key=keys[ki2];
    const isLiteMain=mainIdx>=mOrderMain.length;
    const mainModel=isLiteMain?LITE_MODEL:mOrderMain[mainIdx];
    // 503/502/500 → thử lần lượt CẢ 3 model chính (không giới hạn ở mOrderMain, tức có
    // thể thử cả model CAO hơn model ưu tiên ban đầu), bắt đầu từ mainModel rồi ưu tiên
    // model CAO hơn trước — theo đúng thứ tự cao→thấp cố định trong MAIN_MODELS
    // (3.6→3.5→3 Flash). VD: mainModel=3.5 Flash lỗi 503 → thử 3.6 Flash (cao hơn)
    // trước, lỗi tiếp mới tới 3 Flash (thấp hơn).
    const cycle=isLiteMain?[LITE_MODEL]:[mainModel,...MAIN_MODELS.filter(m=>m!==mainModel)];
    let ci=0;
    while(true){
      if(S.stopReq)return{success:false};
      if(isTimedOut())return{success:false,timedOut:true};
      const model=cycle[ci];
      if(rlDayBlocked(model,key)){
        setStatus(`Key ${ki2+1}/${keys.length} · ${MLBL[model]||model} hết quota ngày → thử key khác...`);
        return{success:false,mainModelDayBlocked:model===mainModel};
      }
      // Nếu key này đang throttle theo phút, chờ cho đủ thay vì đổi ngay
      if(!rlCheck(model,key)){
        setStatus(`Key ${ki2+1}/${keys.length} · ${MLBL[model]||model} đang chờ rate limit (15s)...`);
        if(await timedWait(15000))return{success:false,timedOut:true};
      }
      try{
        setStatus(`Dịch ch.${chNum(i)} · Key ${ki2+1}/${keys.length} · ${MLBL[model]||model}`);
        rlRecord(model,key);
        await acquireApiLock();
        let r;
        try{ r=await callAPIFull(key,model,applyReplace(ch.content),i,ki2,keys.length,characterContextText); }
        finally{ releaseApiLock(); }
        if(r){
          result=r;
          consec503=0; // thành công → xoá luôn chuỗi lỗi 503 liên tiếp
          // Ghi nhớ key thành công để chương sau bắt đầu từ đây.
          S.keyIdx=ki2;
          return{success:true};
        }
      }catch(err){
        lastErr=err.message;
        // Log ra console MỌI lỗi (không chỉ 429 như trước) — status trên UI chỉ hiện
        // thoáng qua rồi bị đè ngay bởi status "chờ Xs..." ở vòng lặp ngoài, không đủ
        // thời gian để đọc; console thì luôn xem lại được (F12 → Console) để biết chính
        // xác model/key nào, lỗi gì, giúp chẩn đoán khi lỗi lặp lại liên tục.
        console.error(`[Dịch lỗi] ch.${chNum(i)} · key ...${key.slice(-6)} · ${MLBL[model]||model}:`,err.message);
        const is429=err.message.includes('429');
        const hasQuotaDayTag=err.message.includes('QUOTA_PER_DAY');
        const hasQuotaMinTag=err.message.includes('QUOTA_PER_MINUTE');
        // QUAN TRỌNG: chỉ coi là "hết quota NGÀY" khi có bằng chứng RÕ RÀNG (quotaId
        // chứa "PerDay"). Mặc định coi 429 là RPM (an toàn, có delay) trừ khi có cờ
        // PerDay rõ ràng.
        const isDailyQuota=is429&&hasQuotaDayTag;
        const isPerMin=is429&&!isDailyQuota;
        if(isDailyQuota){
          rlDayBlock(model,key);
          setStatus(`Key ${ki2+1}/${keys.length} · ${MLBL[model]||model} hết quota ngày (RPD) → thử key khác...`);
          return{success:false,mainModelDayBlocked:model===mainModel};
        }
        if(isPerMin){
          // RPM thực ra giới hạn theo CẶP (model, project) chứ KHÔNG gộp chung theo cả
          // project — tài liệu Gemini ghi rõ quotaId dạng "...PerModelPerMinute"/
          // "...PerMinutePerProjectPerModel" (ai.google.dev/gemini-api/docs/rate-limits),
          // và bộ đếm rlCheck/rlRecord phía trên cũng đã khoá theo model+key vì lý do này.
          // Nên đổi sang model KHÁC trên CÙNG key vẫn có cơ hội thành công (model đó có ô
          // đếm RPM riêng, chưa chắc đã đầy). Xoay hết cả 3 model chính trên key này (giống
          // cách xử lý 503 bên dưới) rồi mới thật sự chờ RETRY_WAIT_MS và đổi sang key khác.
          ci++;
          if(ci>=cycle.length){
            setStatus(`Key ${ki2+1}/${keys.length} · cả ${cycle.length} model đều giới hạn tần suất (RPM${hasQuotaMinTag?'':', chưa rõ loại'}) → chờ ${RETRY_WAIT_SEC}s rồi thử key khác...`);
            if(await timedWait(RETRY_WAIT_MS))return{success:false,timedOut:true};
            return{success:false};
          }
          setStatus(`Key ${ki2+1}/${keys.length} · ${MLBL[model]||model} giới hạn tần suất (RPM${hasQuotaMinTag?'':', chưa rõ loại → mặc định RPM'}) → chuyển sang model khác...`);
          continue;
        }
        const is400=err.message.includes('400');
        const isInvalidKey=is400&&(
          err.message.includes('API_KEY_INVALID')||err.message.includes('API key not valid')||
          err.message.includes('permission')
        );
        if(isInvalidKey){
          setStatus(`Key ${ki2+1}/${keys.length} · key không hợp lệ → thử key khác...`);
          return{success:false,invalidKey:true};
        }
        const isKeyBlock=is400&&(
          err.message.includes('location')||err.message.includes('USER_LOCATION')
        );
        if(isKeyBlock){
          // Dừng dịch ngay, chờ user đổi IP rồi mới tiếp tục
          setStatus('🚫 Bị chặn location — đang chờ bạn đổi IP...');
          flowLog(2,`Chương ${chNum(i)}: BỊ CHẶN LOCATION — tạm rời khỏi danh sách đang dịch, chờ người dùng đổi IP...`);
          S.xlatingSet.delete(i);updCtrl();renderCh(i);
          if(!S._shownLocationErr){
            S._shownLocationErr=true;
            await new Promise(res=>{
              _locationResumeResolve=res;
              showLocationErrPopup();
            });
          }
          // Sau khi user nhấn "Đã đổi IP": resume, retry cùng model/key
          S.xlatingSet.add(i);S.stopReq=false;
          flowLog(2,`Chương ${chNum(i)}: đã đổi IP, TIẾP TỤC dịch lại từ key ${ki2+1}/${keys.length}, model ${MLBL[model]||model}.`);
          setStatus(`Tiếp tục dịch ch.${chNum(i)} · Key ${ki2+1}/${keys.length} · ${MLBL[model]||model}`);
          updCtrl();renderCh(i);
          continue;
        }
        // Lỗi server tạm thời (503/502/500): ĐỔI MODEL, GIỮ NGUYÊN key — ưu tiên model
        // CAO hơn trước (xem cycle ở đầu hàm; chỉ Lite nếu đang ở chế độ Lite). Nếu đã
        // xoay hết cả 3 model chính trên key này mà vẫn lỗi → báo hết cách, để vòng lặp
        // ngoài chuyển sang key khác.
        const isServerErr=err.message.includes('503')||err.message.includes('502')||
          err.message.includes('500')||err.message.toLowerCase().includes('service unavailable')||
          err.message.toLowerCase().includes('internal server');
        if(isServerErr){
          consec503++;
          // Delay CỐ ĐỊNH khi gặp 503 LIÊN TIẾP (không tăng dần theo số lần):
          // 2 lần đầu thử ngay (0s) cho nhanh, từ lần 3 trở đi luôn chờ đúng
          // SERVER_ERR_DELAY_SEC giây — đơn giản, dễ đoán, vẫn đủ giãn request.
          const SERVER_ERR_DELAY_SEC=3;
          const waitSec=consec503<=2?0:SERVER_ERR_DELAY_SEC;
          const code=err.message.match(/\d{3}/)?.[0]||'5xx';
          ci++;
          if(ci>=cycle.length){
            if(waitSec>0){
              setStatus(`Key ${ki2+1}/${keys.length} · lỗi server (${code}) ở mọi model — đã ${consec503} lần liên tiếp → chờ ${waitSec}s rồi thử key khác...`);
              if(await timedWait(waitSec*1000))return{success:false,timedOut:true};
            }else{
              setStatus(`Key ${ki2+1}/${keys.length} · lỗi server (${code}) ở mọi model → thử key khác...`);
            }
            return{success:false};
          }
          if(waitSec>0){
            setStatus(`Key ${ki2+1}/${keys.length} · lỗi server tạm thời (${code}) với ${MLBL[model]||model} — đã ${consec503} lần liên tiếp → chờ ${waitSec}s rồi chuyển model khác...`);
            if(await timedWait(waitSec*1000))return{success:false,timedOut:true};
          }else{
            setStatus(`Key ${ki2+1}/${keys.length} · lỗi server tạm thời (${code}) với ${MLBL[model]||model} → chuyển sang model khác...`);
          }
          continue;
        }
        setStatus(`Key ${ki2+1}/${keys.length} · ${MLBL[model]||model} lỗi → thử key khác...`);
        return{success:false};
      }
    }
  }

  // Thử 1 "model chính" (mainIdx) trên TẤT CẢ key. Mỗi key sẽ tự xoay vòng qua các
  // model fallback khi gặp 503 (xem attemptOnKeyWithModelFallback), nhưng đổi key ngay
  // khi gặp hết quota ngày.
  // Trả về { success, allDayBlocked } — allDayBlocked = true nếu MỌI key đều hết quota
  // ngày CHO CHÍNH MODEL CHÍNH này (dùng để quyết định có escalate lên model chính kế
  // tiếp hay không).
  async function tryMainModelAllKeys(mainIdx){
    const mainModel=mainIdx>=mOrderMain.length?LITE_MODEL:mOrderMain[mainIdx];
    let allDayBlocked=true;
    for(let ki=0;ki<keys.length;ki++){
      if(S.stopReq)return{success:false,allDayBlocked:false};
      if(isTimedOut())return{success:false,allDayBlocked:false,timedOut:true};
      const ki2=(S.keyIdx+ki)%keys.length;
      const r=await attemptOnKeyWithModelFallback(ki2,mainIdx);
      if(r.success)return{success:true,allDayBlocked:false};
      if(r.timedOut)return{success:false,allDayBlocked:false,timedOut:true};
      if(!r.mainModelDayBlocked)allDayBlocked=false;
    }
    if(allDayBlocked)setStatus(`${MLBL[mainModel]||mainModel}: tất cả key đã hết quota ngày → chuyển model chính kế tiếp...`);
    return{success:false,allDayBlocked};
  }

  // ===== VÒNG LẶP CHÍNH =====
  // - Model chính = mOrderMain[S.activeModelIdx] (hoặc Lite nếu S.activeModelIdx đã
  //   vượt quá mOrderMain, tức đã hết quota ngày ở cả 3 model chính trên mọi key).
  // - Hết quota ngày ở TẤT CẢ key cho model chính hiện tại → escalate model chính lên
  //   model tiếp theo (persistent, không quay lại model cấp cao hơn).
  // - Lỗi 503/502/500: xử lý NGAY BÊN TRONG mỗi key (đổi model, giữ nguyên key) — xem
  //   attemptOnKeyWithModelFallback — nên ở tầng này không cần xử lý thêm.
  // - Hết mọi cách (kể cả Lite đã hết quota ngày ở mọi key, hoặc lỗi khác xảy ra ở mọi
  //   key) → chờ 30s, reset toàn bộ đánh dấu rate-limit/quota (y như reload file) rồi
  //   thử lại từ đầu (key 1 / model 1), lặp lại cho tới khi dịch được hoặc hết
  //   CHAPTER_TIMEOUT_MS / người dùng bấm Dừng.
  let giveUp=false;
  while(!result&&!S.stopReq){
    if(isTimedOut()){giveUp=true;break;}
    const mainRes=await tryMainModelAllKeys(S.activeModelIdx);
    if(S.stopReq)break;
    if(result){
      // Vừa dịch thành công — kiểm tra bản dịch có còn sót quá nhiều tiếng Trung không
      // TRƯỚC KHI chấp nhận kết quả này (xem cjkRatio/CHAPTER_CJK_RATIO_THRESHOLD ở trên).
      const ratio=cjkRatio(result);
      if(ratio>CHAPTER_CJK_RATIO_THRESHOLD&&cjkRetryCount<MAX_CHAPTER_CJK_RETRY){
        cjkRetryCount++;
        const pct=(ratio*100).toFixed(1);
        flowLog(2,`Chương ${chNum(i)}: bản dịch còn sót ~${pct}% ký tự Hán (>${(CHAPTER_CJK_RATIO_THRESHOLD*100)|0}%) — tự động dịch lại cả chương (lần ${cjkRetryCount}/${MAX_CHAPTER_CJK_RETRY})...`);
        setStatus(`⚠️ Ch.${chNum(i)} còn sót ~${pct}% tiếng Trung — tự động dịch lại (lần ${cjkRetryCount}/${MAX_CHAPTER_CJK_RETRY})...`);
        result=null; // bỏ kết quả này, quay lại vòng lặp để gọi API dịch lại nguyên chương
        continue;
      }
      if(ratio>CHAPTER_CJK_RATIO_THRESHOLD){
        // Đã hết lượt tự động dịch lại nhưng vẫn còn sót nhiều — chấp nhận kết quả hiện tại
        // (còn hơn không có bản dịch nào) để không tốn quota vô hạn, chỉ log cảnh báo.
        const pct=(ratio*100).toFixed(1);
        console.warn(`[Xlate] Ch.${chNum(i)}: vẫn còn ~${pct}% ký tự Hán sau ${MAX_CHAPTER_CJK_RETRY} lần tự động dịch lại — chấp nhận kết quả hiện tại.`);
        flowLog(2,`Chương ${chNum(i)}: vẫn còn ~${pct}% ký tự Hán sau ${MAX_CHAPTER_CJK_RETRY} lần tự động dịch lại — chấp nhận kết quả hiện tại, không thử thêm.`);
      }
      break;
    }
    if(mainRes.timedOut){giveUp=true;break;}

    if(mainRes.allDayBlocked&&S.activeModelIdx<mOrderMain.length){
      // Còn model chính khác (hoặc Lite) để escalate lên, thử ngay trong chương này.
      S.activeModelIdx++;
      const nextLabel=S.activeModelIdx>=mOrderMain.length?MLBL[LITE_MODEL]:MLBL[mOrderMain[S.activeModelIdx]];
      setStatus(`🔄 Chuyển model chính sang ${nextLabel}...`);
      continue;
    }

    // Không escalate được nữa (đã ở Lite mà vẫn hết quota ngày mọi key, hoặc lỗi khác
    // như 503/RPM xảy ra ở mọi key) → chờ 30s, reset, thử lại từ đầu.
    const elapsedSec=Math.round((Date.now()-xlateStartTs)/1000);
    setStatus(`⏳ Ch.${chNum(i)} lỗi tất cả model/key (đã ${elapsedSec}s/${timeoutLabel}) → chờ ${RETRY_WAIT_SEC}s rồi reset & thử lại từ key 1, model 1...`);
    if(await timedWait(RETRY_WAIT_MS)){giveUp=true;break;} // hết giờ ngay trong lúc chờ → bỏ cuộc luôn
    if(S.stopReq)break;
    resetAllRateLimitsAndQuota();
    consec503=0; // sang vòng mới → xoá luôn chuỗi 503 liên tiếp, tránh cộng dồn qua nhiều vòng
    S.activeModelIdx=0;
    setStatus(`🔄 Đã reset — đang dịch lại ch.${chNum(i)} từ key 1, model 1...`);
    // Vòng lặp ngoài sẽ tự chạy lại từ đầu (key 1) vì S.keyIdx=0
  }

  S.xlatingSet.delete(i);
  flowLog(2,`xlate() chương ${chNum(i)} kết thúc lượt gọi này sau ${Math.round((Date.now()-xlateStartTs)/1000)}s — kết quả: ${result?'THÀNH CÔNG':(giveUp?'BỎ CUỘC (hết thời gian)':'DỪNG (người dùng bấm Dừng)')}. Còn đang dịch song song: [${[...S.xlatingSet].map(chNum).join(', ')||'không có'}]`);
  // Truyện đang mở đã đổi (người dùng chuyển bộ khác) trong lúc lượt dịch này đang chờ
  // API trả về → kết quả này thuộc về truyện CŨ, không được ghi vào S.chapters/S.translations
  // của truyện hiện tại (khác chương, khác nội dung) vì sẽ gây xáo trộn dữ liệu 2 bộ.
  if(myGen!==S.gen){
    flowLog(2,`Bỏ kết quả dịch chương ${chNum(i)} — truyện đã đổi trong lúc chờ API (gen ${myGen}→${S.gen}).`);
    return;
  }
  if(result){
    S.translations[i]=cleanCensorChars(result);
    delete S.failed[i];
    if(i===S.cur)S.showOrig=false;
    // ===== SOÁT CHẤT LƯỢNG SAU DỊCH (Luồng 3 — tách RIÊNG khỏi lượt dịch này) =====
    // Trước đây auditChapterAddressing() chạy NGAY TẠI ĐÂY (await), nghĩa là chính chương vừa
    // dịch xong phải "đứng lại" chờ thêm 1 lượt gọi API nữa mới coi là xong hẳn, dù bản dịch đã
    // có sẵn để dùng — và với dịch SONG SONG nhiều chương, nhiều lượt audit dễ bắn cùng lúc gây
    // rate limit. Giờ chỉ cần đảm bảo snapshot nhân vật đã chốt (đã có sẵn ở appearedChars nếu
    // bật Character Memory) rồi GIAO LẠI cho pipeline soát chất lượng tuần tự ở index.html xử lý
    // (không await) — xem ensureAuditPipeline(), nó tự đọc lại đúng S.chapterCharSnapshot[i] và
    // tự xoá snapshot đó sau khi soát xong để nhẹ bộ nhớ.
    if(getCharMemOn()&&typeof ensureAuditPipeline==='function'){
      flowLog(2,`Chương ${chNum(i)}: đã dịch xong, giao cho Luồng 3 (soát chất lượng) xử lý tiếp — không chờ ở đây.`);
      ensureAuditPipeline();
    }
    setStatus(`💠 Đã dịch xong ${ch.title}`);
    saveSession();
  } else {
    // Tới đây khi: (a) người dùng chủ động bấm Dừng giữa lúc đang retry, hoặc
    // (b) tự động bỏ cuộc sau ~10 phút lỗi liên tục dù đã thử hết key/model.
    S.failed[i]=true;
    if(giveUp){
      // Đánh dấu riêng: chương này KHÔNG được tự động dịch lại khi người dùng
      // đọc tới (nav()) — chỉ dịch lại khi họ chủ động bấm Dịch/Dịch lại.
      if(!S.autoFailed)S.autoFailed={};
      S.autoFailed[i]=true;
      setStatus(`⚠️ Ch.${chNum(i)}: lỗi liên tục dù đã thử hết key/model (quá ${CHAPTER_TIMEOUT_MS/1000}s) — tạm bỏ qua, tiếp tục dịch các chương khác. Bấm 'Dịch' để thử lại chương này.`);
      // Báo popup ngay cả khi đây là 1 chương preload ở phía trước (chưa đọc tới),
      // miễn là nó là chương lỗi GẦN NHẤT tính từ chương đang đọc trở đi — xem
      // checkNearestFailedPreload(). Nếu đang có 1 popup lỗi khác gần hơn đang hiện,
      // hàm này sẽ không đè lên; chương này sẽ tự được báo sau khi chương gần hơn
      // được đóng/dịch xong/hoặc bị vượt qua.
      checkNearestFailedPreload();
    } else {
      setStatus(`⏹️ Đã dừng dịch ch.${chNum(i)}: ${lastErr.slice(0,120)}`);
    }
    // tự hiển thị bản gốc khi dừng/bỏ cuộc
    if(i===S.cur){S.showOrig=true;}
  }
  updChItem(i);
  if(i===S.cur)renderCh(i);
  // updCtrl() đọc S.xlatingSet.has(S.cur) — chỉ ảnh hưởng nút Dịch/Dừng/Dịch lại nếu ĐÚNG
  // chương đang xem vừa kết thúc lượt dịch này; gọi lại vô hại (no-op về mặt hiển thị) khi
  // đây là 1 chương KHÁC đang dịch song song ở nền, nên cứ gọi đều sau mỗi lượt cho chắc.
  updCtrl();
  // Sau mỗi lượt dịch/preload (dù thành công hay thất bại): kiểm tra lại xem popup
  // "chương lỗi" đang hiện (nếu có) còn hợp lệ không, và có chương lỗi nào gần chương
  // đang đọc hơn cần báo tiếp không (VD: chương i vừa dịch xong/hết lỗi → tự đóng
  // popup của nó và chuyển sang báo chương lỗi kế tiếp).
  checkNearestFailedPreload();
  return !!result;
}

async function callAPI(key,model,messages,maxTokOverride,disableThinking){
  // DeepSeek dùng API khác hẳn Gemini (OpenAI-compatible: messages{role,content} thay vì
  // contents{role,parts:[{text}]}, header Authorization Bearer thay vì ?key=) — tách riêng hàm,
  // TỰ CHUYỂN ĐỔI định dạng messages ở đây để mọi nơi gọi callAPI() (callAPIFull, character-memory.js)
  // không cần biết/quan tâm đang dùng AI nào, cứ luôn dựng messages theo định dạng Gemini như cũ.
  // disableThinking: chỉ có tác dụng khi model là DeepSeek (Gemini tự quản lý riêng qua
  // shouldDisableThinking() bên dưới) — dùng cho các lượt gọi nhẹ, không cần suy luận sâu
  // như dịch tiêu đề chương.
  if(model.startsWith('deepseek'))return callDeepseekAPI(key,model,messages,maxTokOverride,disableThinking);
  const maxTok=maxTokOverride||parseInt(document.getElementById('maxTokens').value)||65536;
  // Không gửi temperature/top_p/top_k: các tham số này đã bị Google deprecated
  // cho toàn bộ dòng Gemini 3.x, và với các model đời mới (như gemini-3.5-flash-lite)
  // gửi kèm sẽ bị API trả về lỗi 400 (INVALID_ARGUMENT) thay vì chỉ bị bỏ qua như trước.
  const genCfg={maxOutputTokens:maxTok};
  if(model==='gemini-3.6-flash'||model==='gemini-3.5-flash'||model==='gemini-3.5-flash-lite'){
    // Tự động tắt "nghĩ kỹ" nếu tên prompt đang active khớp từ khoá trong prompt-thinking-override.js
    // (file tuỳ chọn — nếu không có file đó, typeof check bên dưới sẽ bỏ qua an toàn, không lỗi).
    // Dùng thinkingLevel (chuẩn mới của Google cho dòng Gemini 3.x) thay vì thinkingBudget (kiểu cũ).
    // Lưu ý: KHÔNG được gửi cả thinkingLevel lẫn thinkingBudget cùng lúc (sẽ bị lỗi 400).
    if(typeof shouldDisableThinking==='function'&&shouldDisableThinking()){
      genCfg.thinkingConfig={thinkingLevel:'minimal'};
    }
    // Nếu không tắt: không set thinkingConfig, để model tự dùng mức mặc định
    // (medium cho 3.5 Flash, minimal cho 3.5 Flash Lite — tương đương "dynamic" cũ)
  }
  const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:messages,generationConfig:genCfg})});
  if(!res.ok){
    const e=await res.text();
    // Phân biệt chính xác 429 do hết quota/NGÀY (RPD) hay do gọi dồn dập/PHÚT (RPM)
    // bằng cách đọc field "quotaId" trong JSON lỗi gốc (không bị cắt bớt), vì Google
    // trả về rõ ràng dạng "...PerDay..." hoặc "...PerMinute..." trong đó.
    // Cắt message ở 300 ký tự (như cũ) thường làm mất field này → nhận nhầm mọi 429
    // thành "hết quota ngày". Gắn cờ QUOTA_PER_DAY/QUOTA_PER_MINUTE để xử lý ở nơi gọi.
    let quotaTag='';
    try{
      const ej=JSON.parse(e);
      const details=ej?.error?.details||[];
      const violations=details.flatMap(d=>Array.isArray(d.violations)?d.violations:[]);
      const qid=violations.map(v=>v.quotaId||'').join('|');
      if(/PerDay/i.test(qid))quotaTag='QUOTA_PER_DAY';
      else if(/PerMinute/i.test(qid))quotaTag='QUOTA_PER_MINUTE';
    }catch(_){/* không phải JSON hoặc thiếu field → bỏ qua, dùng fallback heuristic cũ */}
    if(res.status===429){
      // Log đầy đủ (không cắt) toàn bộ body lỗi gốc, kèm nhãn đã phân loại được,
      // để tiện so sánh trực tiếp 429-RPD khác gì 429-RPM/không rõ loại.
      console.warn(`[429 FULL] model=${model} key=...${key.slice(-8)} phanLoai=${quotaTag||'(không xác định)'}\n`, e);
    }
    throw new Error(`${res.status}${quotaTag?' '+quotaTag:''}: ${e.slice(0,300)}`);
  }
  const d=await res.json();
  const text=d?.candidates?.[0]?.content?.parts?.[0]?.text;
  const finishReason=d?.candidates?.[0]?.finishReason||'STOP';
  if(!text)throw new Error('API không trả về nội dung');
  return {text,finishReason};
}

// Gọi DeepSeek (OpenAI-compatible: POST /chat/completions, key trong header Authorization).
// messages đầu vào vẫn ở định dạng Gemini {role,parts:[{text}]} (do callAPIFull/character-memory.js
// dựng chung 1 kiểu cho cả 2 AI) — tự chuyển sang {role,content} của OpenAI ở đây.
async function callDeepseekAPI(key,model,messages,maxTokOverride,disableThinking){
  const maxTok=maxTokOverride||parseInt(document.getElementById('maxTokens').value)||65536;
  const oaMessages=messages.map(m=>({
    role:m.role==='model'?'assistant':m.role,
    content:(m.parts||[]).map(p=>p.text||'').join(''),
  }));
  // "model" ở đây có thể là 1 trong 2 model ẢO ("deepseek-v4-flash" / "deepseek-v4-flash-quality"
  // — xem DEEPSEEK_MODELS) chỉ khác nhau ở việc BẬT/TẮT thinking, KHÔNG phải 2 model thật khác
  // nhau — API DeepSeek chỉ biết đúng 1 tên model thật. Map lại đúng tên thật trước khi gửi đi,
  // giữ nguyên "model" gốc cho mọi chỗ khác (status hiển thị, rate-limit tracking...).
  const realModel=DEEPSEEK_REAL_MODEL[model]||model;
  const body={model:realModel,messages:oaMessages,max_tokens:maxTok};
  // DeepSeek V4 (Flash/Pro) mặc định BẬT thinking (reasoning_effort=high) — kể cả câu hỏi
  // 1 dòng cũng tốn hàng trăm token suy luận trước khi trả lời (xem api-docs.deepseek.com/
  // guides/thinking_mode). Với các lượt gọi ngắn/đơn giản như dịch tiêu đề chương, tắt hẳn
  // bằng "thinking":{"type":"disabled"} để tiết kiệm token + thời gian, không cần đổi model.
  if(disableThinking)body.thinking={type:'disabled'};
  const res=await fetch('https://api.deepseek.com/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
    body:JSON.stringify(body),
  });
  if(!res.ok){
    const e=await res.text();
    throw new Error(`${res.status}: ${e.slice(0,300)}`);
  }
  const d=await res.json();
  const choice=d?.choices?.[0];
  const text=choice?.message?.content;
  // OpenAI dùng finish_reason:'length' khi bị cắt do hết token — quy về 'MAX_TOKENS' để tái
  // dùng nguyên logic "bù đoạn" đã có trong callAPIFull (vốn viết theo quy ước của Gemini).
  const finishReason=choice?.finish_reason==='length'?'MAX_TOKENS':'STOP';
  if(!text)throw new Error('API không trả về nội dung');
  return {text,finishReason};
}

// Loại bỏ ký tự kiểm duyệt: · chèn giữa từ (g·iết) và ~ ở cuối âm tiết (a~ ưm~)
function cleanCensorChars(t){
  // Xóa · chèn giữa các ký tự chữ cái (kể cả tiếng Việt có dấu)
  t=t.replace(/([a-zA-ZÀ-ỹ\u0300-\u036f])·([a-zA-ZÀ-ỹ\u0300-\u036f])/g,'$1$2');
  // Lặp lại để xử lý chuỗi nhiều · liên tiếp (g·i·ế·t)
  let prev='';
  while(prev!==t){prev=t;t=t.replace(/([a-zA-ZÀ-ỹ\u0300-\u036f])·([a-zA-ZÀ-ỹ\u0300-\u036f])/g,'$1$2');}
  // Xóa · còn sót lại đứng riêng lẻ bên cạnh chữ (trường hợp ở đầu/cuối từ)
  t=t.replace(/·([a-zA-ZÀ-ỹ\u0300-\u036f])/g,'$1');
  t=t.replace(/([a-zA-ZÀ-ỹ\u0300-\u036f])·/g,'$1');
  // Xóa ~ theo sau âm tiết (a~ ưm~ kiểu đó) — giữ ~ đứng độc lập
  t=t.replace(/([a-zA-ZÀ-ỹ\u0300-\u036f])~(\s|$)/g,'$1$2');
  // Xóa ~ đứng trước dấu cách hoặc cuối chuỗi, sau chữ số
  t=t.replace(/([0-9])~(\s|$)/g,'$1$2');
  return t;
}

// Dịch đầy đủ 1 chương, tự động bù nếu bị MAX_TOKENS
async function callAPIFull(key,model,origContent,chIdx,ki,kTotal,characterContextText){
  const prompt=getPrompt();
  const MAX_CONT=8; // tối đa 8 lần tiếp nối để tránh vòng lặp vô tận
  // Làm sạch ký tự kiểm duyệt trong bản gốc trước khi gửi AI
  origContent=cleanCensorChars(origContent);
  // Character Memory: đính kèm thông tin nhân vật liên quan ở CẢ 2 vị trí —
  // (1) NGAY SAU prompt, TRƯỚC nội dung gốc: đóng vai trò "priming" — để model đọc
  //     toàn bộ văn bản gốc dưới một khung quan hệ nhân vật đã biết trước (VD biết
  //     ngay từ đầu A-B là anh em), thay vì phải tự suy luận quan hệ trong lúc đọc
  //     rồi mới đối chiếu lại với ghi chú ở cuối.
  // (2) Ngay trước câu "Hãy dịch...": giữ lại như cũ — nhắc lại lần cuối đúng lúc
  //     model chuẩn bị sinh ra bản dịch (tận dụng hiệu ứng recency).
  // Lặp lại 2 lần không tốn nhiều token (charBlock vốn đã lọc gọn — chỉ liệt kê nhân
  // vật liên quan tới chương này) nhưng giúp model vừa được định hướng trước vừa
  // được nhắc đúng lúc cần dùng — 2 lớp bổ sung cho nhau, không thay thế nhau.
  const charBlock=characterContextText?('\n\n---\n'+characterContextText):'';
  // Bật/tắt thinking khi dịch chính bằng DeepSeek theo ĐÚNG model ảo người dùng đang chọn (xem
  // DEEPSEEK_MODELS/MLBL) — KHÔNG còn hardcode tắt luôn như trước:
  //  - model="deepseek-v4-flash"         → tắt thinking (nhanh, chất lượng kém).
  //  - model="deepseek-v4-flash-quality" → giữ nguyên thinking mặc định của DeepSeek (chậm,
  //    chất lượng tốt hơn — đặc biệt với xưng hô/mạch văn phức tạp).
  // disableThinking KHÔNG ảnh hưởng gì tới Gemini (chỉ callDeepseekAPI đọc tham số này — xem
  // callAPI()), nên biểu thức dưới đây vô hại khi model là Gemini (luôn ra false, bị bỏ qua).
  const dsDisableThinking=(model==='deepseek-v4-flash');
  let messages=[{role:'user',parts:[{text:prompt+charBlock+'\n\n---\n'+origContent+'\n\n---\nHãy dịch chương truyện phía trên theo đúng các yêu cầu đã nêu ở đầu.'+charBlock}]}];
  let {text:translated,finishReason}=await callAPI(key,model,messages,undefined,dsDisableThinking);
  if(finishReason==='STOP')return translated;
  // Bị MAX_TOKENS → tiếp tục bù
  let cont=0;
  while(finishReason==='MAX_TOKENS'&&cont<MAX_CONT){
    if(S.stopReq)break;
    cont++;
    setStatus(`Dịch ch.${chNum(chIdx)} · bù đoạn ${cont} · Key ${ki+1}/${kTotal} · ${MLBL[model]||model}`);
    // Gửi lại: nội dung gốc + bản dịch dở, yêu cầu dịch tiếp
    messages=[
      {role:'user',parts:[{text:prompt+'\n\n---\n'+origContent+'\n\n---\nHãy dịch chương truyện phía trên theo đúng các yêu cầu đã nêu ở đầu.'}]},
      {role:'model',parts:[{text:translated}]},
      {role:'user',parts:[{text:'Bản dịch bị dừng giữa chừng. Hãy tiếp tục dịch phần còn lại của văn bản gốc (chỉ trả về phần tiếp theo, không lặp lại phần đã dịch).'}]},
    ];
    const res=await callAPI(key,model,messages,undefined,dsDisableThinking);
    translated+=res.text;
    finishReason=res.finishReason;
    if(finishReason==='STOP')break;
  }
  return translated;
}