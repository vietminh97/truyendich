// ===================================================================
// ===== CHARACTER MEMORY (Ghi nhớ quan hệ nhân vật) =====
// ===================================================================
// KIẾN TRÚC: gọi ĐÚNG 1 LẦN model NHẸ (CHAR_MODEL_B) để trích xuất toàn bộ chương. Code tự bắt các
// "nghi vấn" (detectAddrSuspicion — model tự khai không chắc chắn, xưng hô tự mâu thuẫn với giới
// tính đã biết, hoặc lệch hẳn dữ liệu đã lưu mà không kèm correction) hoàn toàn bằng JS thuần, không
// tốn quota. CHỈ khi có nhân vật bị flag nghi vấn mới tốn thêm 1 lượt gọi "xác minh"
// (verifyFlaggedCharacters), và lượt đó chỉ gửi đúng những nhân vật bị flag kèm lý do, không phải
// toàn bộ chương — xem services quanh normalizeExtractedCharacter/detectAddrSuspicion.
// CHAR_MODEL_A chỉ dùng làm MODEL DỰ PHÒNG khi CHAR_MODEL_B lỗi/timeout.
const CHAR_MODEL_A='gemini-3.1-flash-lite';
const CHAR_MODEL_B='gemini-3.5-flash-lite';
const CHAR_ANALYSIS_TIMEOUT_MS=30000;
// Nhóm sắc thái thân mật/kính trọng của 1 cặp xưng hô — dùng để so sánh addrTone mới trích xuất với
// addrTone ĐÃ LƯU của nhân vật có THỰC SỰ lệch hẳn nhóm hay không (VD "muội"/"em" cùng nhóm "Thân
// mật" -> không phải lệch, không cần flag nghi vấn; "muội" vs "ngươi" -> khác nhóm rõ ràng -> mới
// đáng nghi, xem detectAddrSuspicion).
const CHARMEM_ADDR_TONES=['Suồng sã','Thân mật','Trung tính','Kính trọng','Xa cách/Thù địch'];
// Bảng GỢI Ý (không phải bắt buộc) các cặp "tự xưng/gọi đối phương" trung tính, tiêu biểu cho từng
// nhóm sắc thái ở trên — dùng làm "đường thoát" cho model dịch chính khi: (1) xưng hô cụ thể đã lưu
// của 1 nhân vật không khớp giọng văn của đúng câu đang dịch (VD câu bộc phát/mỉa mai khác hẳn giọng
// thường ngày), hoặc (2) 2 nhân vật PHỤ (không ai là MC) thoại trực tiếp với nhau mà bộ nhớ chưa có
// xưng hô cụ thể cho cặp này (kiến trúc hiện tại chỉ lưu addrThemToMc/addrMcToThem theo trục MC — xem
// hasPeerAddrContext). Liệt kê cả biến thể cổ trang/huyết thống LẪN hiện đại/đô thị cho mỗi nhóm, vì
// bảng này chỉ là NGUỒN GỢI Ý chung — việc chọn biến thể nào cho đúng thể loại/văn phong truyện vẫn do
// model dịch chính tự quyết dựa trên bối cảnh chương và chỉ dẫn xưng hô đã "chưng cất" từ prompt dịch
// chính của người dùng (promptGuidance), KHÔNG hardcode cứng theo thể loại ở đây.
const CHARMEM_ADDR_TONE_EXAMPLES={
  'Suồng sã':['tao/mày','ta/mi','tôi/ông (mỉa mai)'],
  'Thân mật':['huynh/muội','ca/muội','tỷ/muội','anh/em','cậu/tớ'],
  'Trung tính':['ta/ngươi','tôi/cậu','tôi/anh','tôi/chị'],
  'Kính trọng':['ta/ngài','tại hạ/các hạ','tôi/ngài','vãn bối/tiền bối'],
  'Xa cách/Thù địch':['ta/ngươi','bổn tọa/ngươi','ta/tên đó']
};
// Bỏ dấu tiếng Việt (Tống -> Tong) để ô tìm kiếm nhân vật chấp nhận gõ không dấu — chỉ dùng cho SO
// SÁNH khi lọc danh sách, KHÔNG đụng tới giá trị "name" thật lưu trong dữ liệu.
function stripVnDiacritics(s){
  return (s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/đ/g,'d').replace(/Đ/g,'D');
}

// ON/OFF thực sự (button bộ não thứ hai trong drawer) — mặc định BẬT, lưu localStorage
function getCharMemOn(){
  const v=localStorage.getItem('dich-charmem-on');
  return v===null?true:v==='1';
}
function setCharMemOn(v){
  localStorage.setItem('dich-charmem-on',v?'1':'0');
}
let _charDrawerOpen=false;
// Chế độ sắp xếp danh sách nhân vật trong drawer — 'mention' (mặc định, theo số lượt nhắc tới,
// hành vi gốc) hoặc 'az' (theo tên A→Z). Lưu lại vào localStorage giống hệt pattern libSort ở
// index.html (setLibSort/dich-lib-sort), nhưng tách riêng key vì đây là sắp xếp nhân vật, không
// phải sắp xếp tủ truyện.
let charMemSort=localStorage.getItem('dich-charmem-sort')==='az'?'az':'mention';
function setCharMemSort(mode){
  charMemSort=mode;
  localStorage.setItem('dich-charmem-sort',mode);
  renderCharList();
}
let _charEditingId=null;
let _charModalGender='Chưa rõ';
let _charMemSaveWarned=false;
// Chiều gộp đang chọn trong modal: 'into' = gộp nhân vật KHÁC vào nhân vật đang mở (mặc định,
// hành vi cũ) | 'out' = gộp CHÍNH nhân vật đang mở vào 1 nhân vật khác. Reset về 'into' mỗi khi
// mở/đóng modal (xem openCharModal/closeCharModal) để không giữ lựa chọn của lần sửa trước.
let _charMergeDir='into';
// Snapshot giá trị các field "có thể bị khoá user" (relationship/gender/addr.../statusCue) TẠI THỜI
// ĐIỂM MỞ MODAL (openCharModal) — để saveCharModal so sánh, chỉ đánh dấu source='user' cho field nào
// người dùng THỰC SỰ gõ sửa so với lúc mở lên, không phải cứ "ô có giá trị lúc bấm Lưu" là khoá (bug
// cũ: field do AI điền sẵn, user chỉ mở modal xem rồi bấm Lưu mà không đụng gì cũng bị khoá oan).
let _charModalInitial={};

function toggleCharMemDrawer(){
  _charDrawerOpen=!_charDrawerOpen;
  document.getElementById('charmemDrawer').classList.toggle('open',_charDrawerOpen);
  document.getElementById('charmemOverlay').classList.toggle('show',_charDrawerOpen);
  document.getElementById('btnCharMemOpen').classList.toggle('btn-on',_charDrawerOpen);
  document.body.classList.toggle('charmem-open',_charDrawerOpen);
  if(_charDrawerOpen){
    renderCharList();
  } else {
    // Đóng panel: xoá từ khoá tìm kiếm, hiện lại toàn bộ danh sách
    const inp=document.getElementById('charmemSearchInput');
    if(inp)inp.value='';
  }
}
function toggleCharMemOn(){
  const on=!getCharMemOn();
  setCharMemOn(on);
  updCharMemToggleBtn();
}
function updCharMemToggleBtn(){
  const on=getCharMemOn();
  const btn=document.getElementById('charmemToggleBtn');
  if(!btn)return;
  btn.classList.toggle('on',on);
  btn.title='Ghi nhớ quan hệ nhân vật';
}

// ===== LƯU TRỮ (theo từng bộ truyện) =====
function charMemStorageKey(){return 'dich-charm:'+(S.fname||'__noname__');}

// Quét và tự động di chuyển các key dich-charm:* / dich-charm-guidance:* từ localStorage sang IndexedDB
// để giải phóng ngay lập tức dung lượng 5MB bị nghẽn của localStorage cho người dùng.
async function cleanupCharMemLocalStorage(){
  try{
    if(typeof cfgSet!=='function')return;
    const keysToRemove=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k&&(k.startsWith('dich-charm:')||k.startsWith('dich-charm-guidance:'))){
        keysToRemove.push(k);
      }
    }
    for(const k of keysToRemove){
      const val=localStorage.getItem(k);
      if(val){
        await cfgSet(k, val);
        localStorage.removeItem(k);
      }
    }
    if(keysToRemove.length>0){
      console.log(`[Luồng 1][Lưu trữ] Đã tự động di chuyển ${keysToRemove.length} bộ nhớ nhân vật từ localStorage sang IndexedDB và giải phóng dung lượng.`);
    }
  }catch(e){
    console.warn('[Luồng 1][Lưu trữ] Lỗi khi dọn dẹp localStorage charMem',e);
  }
}

async function loadCharacterMemory(){
  let list=[];
  if(libCurrentId){
    try{
      const bk=await libGet(libCurrentId);
      list=(bk&&Array.isArray(bk.characters))?bk.characters:[];
    }catch(e){list=[];}
  } else {
    try{
      const key=charMemStorageKey();
      let raw=null;
      if(typeof cfgGet==='function'){
        raw=await cfgGet(key);
      }
      if(!raw){
        const lsVal=localStorage.getItem(key);
        if(lsVal){
          raw=lsVal;
          if(typeof cfgSet==='function'){
            try{
              await cfgSet(key, lsVal);
              localStorage.removeItem(key);
            }catch(_){}
          }
        }
      }
      list=typeof raw==='string'?JSON.parse(raw):(Array.isArray(raw)?raw:[]);
    }catch(e){list=[];}
  }
  S.characters=Array.isArray(list)?list:[];
  if(cleanupUnknownAddrValues(S.characters))await saveCharacterMemory();
  if(document.getElementById('charmemDrawer'))renderCharList();
  // Tiến hành dọn dẹp giải phóng localStorage chạy ngầm
  cleanupCharMemLocalStorage();
}

async function saveCharacterMemory(){
  if(libCurrentId){
    try{
      const bk=await libGet(libCurrentId);
      if(bk){bk.characters=S.characters;await libPut(bk);return;}
    }catch(e){console.warn('[Luồng 1][Lưu trữ] Lỗi lưu vào IndexedDB',e);}
  }
  const key=charMemStorageKey();
  const dataStr=JSON.stringify(S.characters);
  // Ưu tiên lưu vào IndexedDB (cfgSet) — dung lượng GBs, không bị hạn chế 5MB của localStorage
  if(typeof cfgSet==='function'){
    try{
      const ok=await cfgSet(key, dataStr);
      if(ok){
        try{localStorage.removeItem(key);}catch(e){}
        return;
      }
    }catch(e){
      console.warn('[Luồng 1][Lưu trữ] Lỗi lưu vào IndexedDB cfgSet',e);
    }
  }
  // Fallback sang localStorage nếu IndexedDB gặp lỗi
  try{
    localStorage.setItem(key,dataStr);
  }catch(e){
    console.warn('[Luồng 1][Lưu trữ] Lỗi lưu vào localStorage (có thể do đầy dung lượng trình duyệt)',e);
    cleanupCharMemLocalStorage();
    try{
      localStorage.setItem(key,dataStr);
      return;
    }catch(e2){}
    if(!_charMemSaveWarned&&typeof showInfoPopup==='function'){
      _charMemSaveWarned=true;
      showInfoPopup('Không lưu được dữ liệu nhân vật','Bộ nhớ trình duyệt (localStorage) có thể đã đầy. Hãy thử thêm bộ truyện này vào Tủ truyện (Thư viện) để lưu ổn định hơn trên IndexedDB.');
    }
  }
}

function newCharId(){return 'c-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}

// Nhận diện các cách AI/người dùng có thể ghi để chỉ "nhân vật chính"
function isProtagonistLabel(text){
  const t=(text||'').trim().toLowerCase();
  return t==='chính'||t==='nhân vật chính'||t==='bản thân'||t==='chính mình'||t==='chính chủ';
}
// Nguồn sự thật DUY NHẤT để biết 1 nhân vật có đang được coi là "nhân vật chính" hay không — MỌI
// nơi khác trong file (sắp xếp, hiện ngôi sao, prompt gửi AI...) đều phải gọi qua hàm này thay vì
// tự viết lại điều kiện `c.isProtagonist||isProtagonistLabel(c.relationship)`, để đảm bảo cờ
// `protagonistDenied` (người dùng bấm huỷ ngôi sao — xem toggleProtagonistStar) LUÔN được tôn trọng
// ở khắp nơi, kể cả khi field "relationship" vẫn còn giá trị kiểu "Nhân vật chính" (do AI ghi hoặc
// còn sót lại từ trước khi bị bấm huỷ).
function isCharProtagonist(c){
  if(!c)return false;
  if(c.protagonistDenied)return false;
  return !!(c.isProtagonist||isProtagonistLabel(c.relationship));
}
// Người dùng bấm vào ngôi sao trên 1 nhân vật ĐANG được coi là nhân vật chính — dùng khi AI nhận
// định sai (VD 1 chương kể nhiều về 1 nhân vật phụ khiến AI tưởng đó là nhân vật chính). Khác với
// việc chỉ xoá "isProtagonist" (không đủ, vì relationship vẫn có thể còn giữ nhãn "Nhân vật chính"
// khiến isCharProtagonist() vẫn trả về true ở chương sau) — set thêm cờ "protagonistDenied" để tạm
// thời CHẶN, kể cả khi AI tiếp tục tự gán lại nhãn này cho nhân vật ở các chương sau.
// Cờ này gỡ theo 2 cách: (1) NGAY LẬP TỨC khi CHÍNH người dùng tự tay xác nhận lại (sửa modal, hoặc
// bấm "Áp dụng" gợi ý); (2) TỰ ĐỘNG nếu AI vẫn tiếp tục đề xuất "Nhân vật chính" cho người này ở đủ
// CHARMEM_PROTAGONIST_RECONFIRM_THRESHOLD chương KHÁC NHAU sau đó (xem noteProtagonistSignal) — vì
// người dùng xác nhận việc AI đoán sai nhân vật chính là RẤT HIẾM, nên bằng chứng lặp lại nhiều lần
// độc lập nhiều khả năng là chính lần bấm huỷ mới là nhầm, không phải AI.
const CHARMEM_PROTAGONIST_RECONFIRM_THRESHOLD=3;
// Ngưỡng đối xứng cho LẦN GÁN ĐẦU TIÊN (chưa từng bị huỷ, chưa từng được xác nhận) — tránh việc 1-2
// chương viết theo góc nhìn nhân vật phụ (ngoại truyện, chương xen kẽ...) khiến AI vội vàng gán nhãn
// "nhân vật chính" ngay từ 1 chương duy nhất. Thấp hơn ngưỡng reconfirm ở trên vì đây là lúc CHƯA ai
// từng xác nhận gì cả (không phải đang "lật ngược" 1 quyết định huỷ của người dùng), nên không cần
// bằng chứng nặng bằng — xem noteProtagonistSignal.
const CHARMEM_PROTAGONIST_FIRST_THRESHOLD=2;
// Ngưỡng CAO HƠN dành riêng cho trường hợp truyện ĐÃ CÓ SẴN 1 nhân vật chính khác — không tự động
// thay thế nhân vật chính cũ (người dùng có thể tự bấm huỷ ngôi sao nếu muốn), mà chỉ tự động đánh
// dấu THÊM (cùng lúc có thể có nhiều nhân vật chính, VD truyện đa tuyến/song nam song nữ chính) khi
// đủ bằng chứng lặp lại nhiều lần độc lập — cao hơn hẳn ngưỡng "chưa có ai" ở trên vì rủi ro sai lệch
// khi đã có 1 người ổn định rồi lớn hơn nhiều so với lúc chưa xác định ai cả.
const CHARMEM_PROTAGONIST_ADDITIONAL_THRESHOLD=5;
function toggleProtagonistStar(id,event){
  if(event){event.stopPropagation();event.preventDefault();}
  const c=S.characters.find(x=>x.id===id);
  if(!c||!isCharProtagonist(c))return; // an toàn: nút chỉ hiện khi đang là NV chính, không cần chiều ngược lại
  c.isProtagonist=false;
  c.protagonistDenied=true;
  c.protagonistReconfirmVotes=[]; // reset đếm phiếu bầu mỗi lần huỷ mới, không cộng dồn từ lần huỷ trước
  saveCharacterMemory();
  renderCharList();
}
// AI (trong applyCharField) đề xuất "relationship" mang nhãn nhân vật chính cho 1 nhân vật —
// gọi hàm này thay vì tự set c.isProtagonist=true trực tiếp, để xử lý đúng cả 2 trường hợp:
//  - Chưa bị huỷ (protagonistDenied=false, mặc định): áp dụng ngay như hành vi gốc.
//  - Đang bị huỷ: KHÔNG áp dụng ngay, chỉ "ghi phiếu" cho chapterIdx hiện tại (Set, không đếm trùng
//    2 lần cùng 1 chương dù applyCharField gọi hàm này nhiều lượt khác nhau trong 1 lần phân tích).
//    Đủ CHARMEM_PROTAGONIST_RECONFIRM_THRESHOLD chương KHÁC NHAU cùng đề xuất -> tự động gỡ huỷ.
function noteProtagonistSignal(c,isRelationship,newVal,chapterIdx){
  if(!isRelationship||!isProtagonistLabel(newVal))return;
  // Nhánh 1: nhân vật ĐANG bị huỷ ngôi sao -> hành vi cũ, không đổi (phiếu bầu khôi phục).
  if(c.protagonistDenied){
    if(typeof chapterIdx!=='number')return; // không có chapterIdx -> không đủ tin cậy để tính phiếu
    const votes=new Set(c.protagonistReconfirmVotes||[]);
    votes.add(chapterIdx);
    c.protagonistReconfirmVotes=[...votes];
    if(c.protagonistReconfirmVotes.length>=CHARMEM_PROTAGONIST_RECONFIRM_THRESHOLD){
      c.protagonistDenied=false;c.isProtagonist=true;c.protagonistReconfirmVotes=[];
      c.protagonistPendingVotes=[];
      console.log(`[Luồng 1][Nhân vật chính] Tự động khôi phục "Nhân vật chính" cho ${c.name} sau ${CHARMEM_PROTAGONIST_RECONFIRM_THRESHOLD} chương khác nhau AI đều xác nhận lại (dù trước đó đã bị huỷ ngôi sao).`);
    }
    return;
  }
  // Nhánh 2: đã được xác nhận là nhân vật chính từ trước -> AI tái xác nhận, không cần làm gì thêm.
  if(c.isProtagonist)return;
  // Nhánh 3: ứng viên MỚI, chưa từng được xác nhận và cũng chưa từng bị huỷ. Nếu không có chapterIdx
  // thì không đủ tin cậy để tính phiếu theo chương -> giữ hành vi cũ, gán ngay.
  if(typeof chapterIdx!=='number'){c.isProtagonist=true;return;}
  // Ngưỡng khác nhau tuỳ truyện đã có sẵn nhân vật chính khác hay chưa: chưa có ai thì cần ít bằng
  // chứng hơn (CHARMEM_PROTAGONIST_FIRST_THRESHOLD chương) để tránh 1-2 chương ngoại truyện/góc nhìn
  // phụ vội vàng cướp ngôi; đã có 1 người ổn định rồi thì cần NHIỀU hơn hẳn (CHARMEM_PROTAGONIST_
  // ADDITIONAL_THRESHOLD chương) mới tự động đánh dấu THÊM 1 nhân vật chính nữa — không bao giờ tự
  // động THAY THẾ nhân vật chính cũ, người dùng vẫn có thể tự bấm huỷ ngôi sao nếu AI đánh dấu sai.
  const hasExisting=S.characters.some(x=>x.id!==c.id&&isCharProtagonist(x));
  const threshold=hasExisting?CHARMEM_PROTAGONIST_ADDITIONAL_THRESHOLD:CHARMEM_PROTAGONIST_FIRST_THRESHOLD;
  const votes=new Set(c.protagonistPendingVotes||[]);
  votes.add(chapterIdx);
  c.protagonistPendingVotes=[...votes];
  if(c.protagonistPendingVotes.length>=threshold){
    c.isProtagonist=true;c.protagonistPendingVotes=[];
    console.log(`[Luồng 1][Nhân vật chính] Xác nhận "${c.name}" là nhân vật chính sau ${threshold} chương khác nhau AI đều đề xuất${hasExisting?' (đánh dấu THÊM, không thay thế nhân vật chính hiện có)':''}.`);
  }
}
// AI thỉnh thoảng không ghi đúng literal "Chưa rõ" như prompt yêu cầu mà lại ghi bừa 1 ký hiệu
// "rỗng" quen thuộc kiểu bảng biểu (VD "-", "n/a", "none", "không có"...) khi không xác định được
// giá trị. Nếu không bắt các trường hợp này, chuỗi đó sẽ bị coi là 1 giá trị "thật" (xem isUnknownVal/
// isAddrUnknown bên dưới) -> tự động lưu vào nhân vật, tự hiện trong modal, và (với field xưng hô)
// bị gửi kèm vào prompt dịch (buildCharacterContextText) như 1 chỉ định xưng hô có thật dù chẳng có ý nghĩa gì.
// Dùng so khớp theo pattern thay vì so đúng nguyên văn "-" để bắt luôn các biến thể dài hơn (--, —, ...).
function isPlaceholderJunk(w){
  const t=(w||'').normalize('NFC').trim().toLowerCase();
  if(!t)return true;
  if(/^[-–—_.…]+$/.test(t))return true; // chỉ gồm dấu gạch/chấm, không chữ nào khác
  return ['n/a','na','none','null','không có','ko có','chưa có','không rõ','?','...'].includes(t);
}
// Coi 1 field dạng "1 giá trị duy nhất" (gender/relationship/statusCue/addrTone — khác field xưng hô
// nhiều-lựa-chọn, xem isAddrUnknown) là "chưa có dữ liệu" nếu rỗng, bằng "Chưa rõ", hoặc là 1 trong
// các ký hiệu "rỗng" mà AI hay lỡ ghi (xem isPlaceholderJunk) — có chuẩn hoá NFC trước khi so sánh
// để không bị lệch bởi encoding Unicode khác nhau (xem giải thích ở isAddrUnknown/cleanupUnknownAddrValues).
function isUnknownVal(v){
  const t=(v||'').normalize('NFC').trim();
  return !t||t==='Chưa rõ'||isPlaceholderJunk(t);
}

// ===== SẮP XẾP DANH SÁCH =====
// Bậc quan hệ: 0 = nhân vật chính, 1 = người thân/bạn bè thân thiết, 2 = quan hệ khác đã rõ, 3 = chưa rõ quan hệ
const CHARMEM_FAMILY_KW=['cha','mẹ','ba','má','bố','con','anh','em','chị','vợ','chồng','ông','bà','cô','dì','chú','bác','cậu','mợ','cháu','gia đình','họ hàng','người thân','huyết thống','ruột thịt','thúc','di nương','sư nương','nương tử','phu quân','thê tử'];
const CHARMEM_FRIEND_KW=['bạn','bằng hữu','huynh đệ','tỷ muội','huynh muội','tri kỷ','đồng đội','chiến hữu','bạn thân','thanh mai trúc mã','đạo hữu','sư huynh','sư tỷ','sư đệ','sư muội'];
function relCloseness(c){
  if(isCharProtagonist(c))return 0;
  const r=(c.relationship||'').trim().toLowerCase();
  if(isUnknownVal(r))return 3;
  if(CHARMEM_FAMILY_KW.some(k=>r.includes(k))||CHARMEM_FRIEND_KW.some(k=>r.includes(k)))return 1;
  return 2;
}
// Điểm đầy đủ thông tin: càng nhiều field đã biết thì điểm càng cao, xếp trước
function charInfoScore(c){
  let s=0;
  if(!isUnknownVal(c.gender))s++;
  if(!isUnknownVal(c.relationship))s++;
  if(c.note&&c.note.trim())s++;
  if(c.aliases&&c.aliases.length)s++;
  return s;
}
// Số lần nhân vật được nhắc tới (số chương đã xuất hiện) — càng nhiều càng quen thuộc, xếp trước.
// Từ bản này, số chương xuất hiện được lưu vào c.mentionChapters (mảng index chương, không trùng
// lặp) thay vì 1 con số cộng dồn đơn thuần — nhờ vậy dịch lại 1 chương (doRetranslate) không làm
// tăng ảo số lần xuất hiện. c.mentionCount (bản cũ) vẫn được đọc lại để tương thích ngược với dữ
// liệu đã lưu trước đây, cho tới khi nhân vật đó được phân tích lại lần đầu theo cơ chế mới.
function charMentionCount(c){
  if(Array.isArray(c.mentionChapters))return c.mentionChapters.length;
  return c.mentionCount||0;
}
// Giới hạn số nhân vật gửi kèm lên AI mỗi lần phân tích chương, để tránh payload phình to (tốn
// token/chi phí) khi truyện có rất nhiều nhân vật qua hàng trăm chương. Ưu tiên: nhân vật chính,
// rồi nhân vật vừa xuất hiện gần đây nhất, rồi nhân vật xuất hiện nhiều nhất — đây là nhóm nhân
// vật AI cần "nhớ đúng" nhất để dịch nhất quán chương hiện tại; nhân vật rất phụ, lâu không xuất
// hiện, ít thông tin thì bỏ bớt khỏi ngữ cảnh gửi đi (vẫn được LƯU đầy đủ, chỉ không gửi lên AI).
// Quét xem những nhân vật NÀO trong S.characters có tên chính hoặc alias xuất hiện literal (dạng
// chuỗi con) trong nội dung chương đang phân tích. Dùng để đảm bảo các nhân vật này LUÔN được đưa
// vào known-list gửi AI, kể cả khi họ bị rớt khỏi top 40 theo thứ hạng "gần đây/nổi bật" — tránh
// trường hợp 1 nhân vật phụ lâu không xuất hiện, ít thông tin, bị loại khỏi known-list, rồi bất ngờ
// tái xuất hiện ở chương sau: AI không có gì để đối chiếu nên rất dễ tạo ra 1 entry MỚI trùng lặp
// cho cùng 1 người thay vì nhận diện đúng.
function scanMentionedCharIds(chapterText){
  const ids=new Set();
  if(!chapterText)return ids;
  for(const c of S.characters){
    const names=[c.name,...(c.aliases||[])].filter(n=>n&&n.trim().length>=2);
    if(names.some(n=>chapterText.includes(n)))ids.add(c.id);
  }
  return ids;
}
// Giới hạn số nhân vật gửi kèm lên AI mỗi lần phân tích chương, để tránh payload phình to (tốn
// token/chi phí) khi truyện có rất nhiều nhân vật qua hàng trăm chương. Ưu tiên: nhân vật chính,
// rồi nhân vật vừa xuất hiện gần đây nhất, rồi nhân vật xuất hiện nhiều nhất — đây là nhóm nhân
// vật AI cần "nhớ đúng" nhất để dịch nhất quán chương hiện tại; nhân vật rất phụ, lâu không xuất
// hiện, ít thông tin thì bỏ bớt khỏi ngữ cảnh gửi đi (vẫn được LƯU đầy đủ, chỉ không gửi lên AI).
// NGOẠI LỆ: bất kỳ nhân vật nào có tên/alias xuất hiện literal trong nội dung chương hiện tại
// (chapterText) đều được ƯU TIÊN TUYỆT ĐỐI đưa vào known-list, kể cả khi rớt hạng top 40 — vì đây
// chính là nhân vật đang thực sự xuất hiện ở chương này, cần được AI đối chiếu đúng để tránh trùng.
const CHARMEM_KNOWN_LIMIT=30;
function selectKnownCharsForPrompt(chapterText){
  const mentionedIds=scanMentionedCharIds(chapterText);
  const list=S.characters.slice();
  list.sort((a,b)=>{
    const pa=isCharProtagonist(a)?0:1;
    const pb=isCharProtagonist(b)?0:1;
    if(pa!==pb)return pa-pb;
    const la=Array.isArray(a.mentionChapters)&&a.mentionChapters.length?Math.max(...a.mentionChapters):-1;
    const lb=Array.isArray(b.mentionChapters)&&b.mentionChapters.length?Math.max(...b.mentionChapters):-1;
    if(la!==lb)return lb-la;
    return charMentionCount(b)-charMentionCount(a);
  });
  // Nhân vật có "name" còn sót chữ Hán chưa dịch LUÔN được ép vào danh sách gửi cho AI (giống nhân
  // vật được nhắc tới trong chương), bất kể có xuất hiện trong chương này hay không và bất kể đã vượt
  // quá CHARMEM_KNOWN_LIMIT hay chưa — để cờ "needsTranslation" (xem buildCharExtractPrompt) luôn có
  // cơ hội được AI nhìn thấy và dịch lại ở MỌI lượt phân tích chương kế tiếp, không phải chờ đúng lúc
  // nhân vật đó tình cờ được nhắc tới hoặc lọt vào phần "rest" còn chỗ trống.
  const forced=list.filter(c=>mentionedIds.has(c.id)||containsCJK(c.name));
  const rest=list.filter(c=>!mentionedIds.has(c.id)&&!containsCJK(c.name));
  const fillCount=Math.max(0,CHARMEM_KNOWN_LIMIT-forced.length);
  const forcedIds=new Set(forced.map(c=>c.id));
  // Đánh dấu forced/rest ngay trên kết quả trả về, để buildCharExtractPrompt biết entry nào được
  // phép gửi đủ field xưng hô/statusCue/narrRef (forced — nhân vật thực sự có mặt trong chương, nơi
  // cơ chế correction/addrEvidence có thể kích hoạt) và entry nào nên cắt bớt (rest — nhân vật không
  // xuất hiện trong chương này, các field đó chỉ tốn token mà model không có bằng chứng để dùng tới).
  return forced.concat(rest.slice(0,fillCount)).map(c=>({...c,_charmemForced:forcedIds.has(c.id)}));
}
function sortCharList(list){
  return list.sort((a,b)=>{
    // Nhân vật chính luôn ghim ở đầu danh sách, không phụ thuộc số lần xuất hiện hay chế độ sort.
    const pa=isCharProtagonist(a)?0:1;
    const pb=isCharProtagonist(b)?0:1;
    if(pa!==pb)return pa-pb;
    // Chế độ A→Z: chỉ so tên, bỏ qua hẳn tiêu chí lượt nhắc tới/độ đầy đủ thông tin bên dưới.
    if(charMemSort==='az')return a.name.localeCompare(b.name,'vi');
    // Còn lại: nhân vật được nhắc tới nhiều hơn xếp trước — không còn ưu tiên theo nhóm quan hệ
    // (gia đình/bạn bè/khác/chưa rõ) như trước, vì tần suất xuất hiện phản ánh mức độ quan trọng
    // của nhân vật trong truyện tốt hơn.
    const ma=charMentionCount(a),mb=charMentionCount(b);
    if(ma!==mb)return mb-ma;
    return charInfoScore(b)-charInfoScore(a);
  });
}

// ===== RENDER DANH SÁCH =====
function charNotePreview(c){
  const t=(c.note||'').trim();
  if(!t)return '';
  return t.length>90?t.slice(0,90).trim()+'…':t;
}
function charMetaLine(c){
  const g=!isUnknownVal(c.gender)?c.gender:'Chưa rõ giới tính';
  const protagonist=isCharProtagonist(c);
  const r=!isUnknownVal(c.relationship)?c.relationship:'Chưa rõ quan hệ';
  const status=c.statusCue&&c.statusCue.trim()?` • ${c.statusCue.trim()}`:'';
  return (protagonist?`${g} • Nhân vật chính`:`${g} • ${r}`)+status;
}
function renderCharList(){
  const box=document.getElementById('charmemList');
  if(!box)return;
  updCharMemToggleBtn();
  const sortMentionBtn=document.getElementById('charmemSortMention');
  const sortAZBtn=document.getElementById('charmemSortAZ');
  if(sortMentionBtn)sortMentionBtn.classList.toggle('active',charMemSort==='mention');
  if(sortAZBtn)sortAZBtn.classList.toggle('active',charMemSort==='az');
  const q=(document.getElementById('charmemSearchInput')?.value||'').trim().toLowerCase();
  let list=S.characters.slice();
  if(q){
    // So khớp cả bản CÓ dấu (ưu tiên, chính xác hơn) lẫn bản ĐÃ BỎ DẤU, để gõ không dấu (VD "Tong")
    // vẫn tìm ra tên có dấu (VD "Tống") mà không làm lỏng lẻo tìm kiếm có dấu vốn đã hoạt động đúng.
    const qNoDiac=stripVnDiacritics(q);
    list=list.filter(c=>{
      const nameLower=c.name.toLowerCase();
      return nameLower.includes(q)||stripVnDiacritics(nameLower).includes(qNoDiac);
    });
  }
  // Nhân vật chính trước, rồi người thân/bạn bè, rồi nhân vật phụ khác;
  // trong mỗi nhóm, nhân vật được nhắc tới nhiều xếp trước, sau đó mới đến nhân vật đầy đủ thông tin hơn
  sortCharList(list);
  if(!list.length){
    box.innerHTML=`<div class="charmem-empty">${q?'Không tìm thấy nhân vật':'Chưa có dữ liệu nhân vật nào.'}</div>`;
    return;
  }
  box.innerHTML=list.map(c=>{
    const protagonist=isCharProtagonist(c);
    const hasConflict=!!(c.genderConflict||c.relationshipConflict);
    // Cảnh báo riêng khi "name" vẫn còn sót chữ Hán/Trung Quốc chưa được dịch (thường do AI bỏ sót,
    // nhất là với nhân vật chính bị nêu cố định trong prompt — xem needsTranslation trong
    // buildCharExtractPrompt). Hiển thị ngay trong danh sách để người dùng phát hiện và tự sửa qua
    // modal, thay vì phải chờ 1 chương sau đó tình cờ kích hoạt được cơ chế tự sửa của AI.
    const untranslated=containsCJK(c.name);
    return `
    <div class="char-item${hasConflict?' has-conflict':''}${untranslated?' has-untranslated':''}" data-id="${c.id}">
      <div class="char-item-top">
        <div class="char-item-name">${protagonist?`<span class="char-protagonist-star" onclick="toggleProtagonistStar('${c.id}',event)" title="Đây không phải nhân vật chính — bấm để bỏ đánh dấu"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l2.4 7.2H22l-6 4.4 2.3 7.1L12 16.3 5.7 20.7 8 13.6 2 9.2h7.6z"/></svg></span>`:''}<span>${esc(c.name)}</span>${hasConflict?'<span class="char-conflict-dot" title="AI phát hiện thông tin có thể sai — bấm Chỉnh sửa để xem gợi ý">!</span>':''}${untranslated?'<span class="char-untranslated-dot" title="Tên nhân vật vẫn còn sót chữ Hán/Trung Quốc chưa được dịch — bấm Chỉnh sửa để sửa lại thủ công">漢</span>':''}</div>
        <div class="char-item-actions">
          <button class="char-act-btn" onclick="openCharModal('${c.id}')" title="Chỉnh sửa"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
          <button class="char-act-btn delete" onclick="confirmDeleteChar('${c.id}')" title="Xóa"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        </div>
      </div>
      <div class="char-item-meta">${esc(charMetaLine(c))}</div>
      ${charNotePreview(c)?`<div class="char-item-note">${esc(charNotePreview(c))}</div>`:''}
    </div>`;
  }).join('');
}
// ===== MODAL CHỈNH SỬA =====
// Modal gốc (index.html) đặt .charmodal-btns làm CON của .charmodal-inner (vùng overflow-y:auto),
// dùng margin âm để tràn ra sát mép — hệ quả: thanh cuộn của trình duyệt chạy suốt cả vùng đó,
// đè lên luôn dải nút, và nút bị cuộn trôi theo nội dung. Hàm này chạy 1 lần (idempotent, kiểm tra
// parentElement trước khi move) để kéo .charmodal-btns ra làm anh em SAU .charmodal-inner, tức con
// trực tiếp của .charmodal-box — nhờ vậy thanh cuộn chỉ còn nằm trong phần thông tin, nút luôn cố
// định hiển thị ở đáy modal. Phần CSS tương ứng xem .charmodal-inner{flex:1;min-height:0} và
// .charmodal-btns (margin:0) trong character-memory.css.
function ensureCharModalBtnsFixed(){
  const overlay=document.getElementById('charModalOverlay');
  if(!overlay)return;
  const box=overlay.querySelector('.charmodal-box');
  const btns=overlay.querySelector('.charmodal-btns');
  if(box&&btns&&btns.parentElement!==box)box.appendChild(btns);
}
function openCharModal(id){
  ensureCharModalBtnsFixed();
  const c=S.characters.find(x=>x.id===id);
  if(!c)return;
  _charEditingId=id;
  document.getElementById('charFieldName').value=c.name||'';
  const relVal=isUnknownVal(c.relationship)?'':c.relationship;
  document.getElementById('charFieldRel').value=relVal;
  document.getElementById('charFieldAlias').value=(c.aliases||[]).join(', ');
  document.getElementById('charFieldNote').value=c.note||'';
  // Bắn sự kiện 'input' để spellcheck.js (gắn qua attachSpellcheck) chấm lại
  // ngay ghi chú có sẵn của nhân vật này, thay vì chỉ chấm khi user gõ mới.
  document.getElementById('charFieldNote').dispatchEvent(new Event('input'));
  // 2 field xưng hô — optional chaining vì input này cần được thêm thủ công vào modal HTML
  // (id gợi ý: charFieldAddrThemToMc / charFieldAddrMcToThem), không có thì bỏ qua an toàn.
  const inThem=document.getElementById('charFieldAddrThemToMc');
  const inMc=document.getElementById('charFieldAddrMcToThem');
  const addrThemVal=isAddrUnknown(c.addrThemToMc)?'':c.addrThemToMc;
  const addrMcVal=isAddrUnknown(c.addrMcToThem)?'':c.addrMcToThem;
  if(inThem)inThem.value=addrThemVal;
  if(inMc)inMc.value=addrMcVal;
  // Vai vế/địa vị (statusCue) — optional chaining vì input này cần được thêm thủ công vào modal HTML
  // (id gợi ý: charFieldStatusCue), không có thì bỏ qua an toàn.
  const inStatus=document.getElementById('charFieldStatusCue');
  const statusVal=isUnknownVal(c.statusCue)?'':c.statusCue;
  if(inStatus)inStatus.value=statusVal;
  // Cách gọi ngôi thứ 3 khi tường thuật (narrRef) — optional chaining vì input này cần được thêm
  // thủ công vào modal HTML (id gợi ý: charFieldNarrRef), không có thì bỏ qua an toàn.
  const inNarrRef=document.getElementById('charFieldNarrRef');
  const narrRefVal=isNarrRefUnknown(c.narrRef)?'':c.narrRef;
  if(inNarrRef)inNarrRef.value=narrRefVal;
  autoResizeCharNote(document.getElementById('charFieldNote'));
  initCharGender(c.gender||'Chưa rõ');
  _charModalInitial={name:c.name||'',relationship:relVal,gender:c.gender||'Chưa rõ',note:c.note||'',aliases:(c.aliases||[]).join(', '),addrThemToMc:addrThemVal,addrMcToThem:addrMcVal,statusCue:statusVal,narrRef:narrRefVal};
  populateMergeTargetSelect(id);
  setCharMergeDir('into');
  document.getElementById('charAdvToggle').classList.remove('open');
  document.getElementById('charMergeRow').classList.remove('open');
  renderCharConflictBanner(c);
  document.getElementById('charModalOverlay').classList.add('show');
}
// Hiển thị (hoặc ẩn nếu không còn) banner cảnh báo mâu thuẫn dữ liệu ở đầu modal sửa nhân vật —
// chỉ xuất hiện khi c.genderConflict/relationshipConflict có gợi ý đang chờ người dùng duyệt
// (trường hợp dữ liệu cũ đã được chính người dùng xác nhận trước đó nên hệ thống không tự sửa).
// Danh sách field có cơ chế "gợi ý sửa chờ duyệt" (conflict) — field:tên trong object nhân vật,
// conflictField:tên field lưu gợi ý, label:tên hiển thị. Thêm field mới chỉ cần thêm 1 dòng ở đây,
// không phải sửa lại applyCharConflict/dismissCharConflict/renderCharConflictBanner.
const CHARMEM_CONFLICT_CONFIG=[
  {field:'gender',conflictField:'genderConflict',label:'Giới tính'},
  {field:'relationship',conflictField:'relationshipConflict',label:'Mối quan hệ'},
  {field:'addrThemToMc',conflictField:'addrThemToMcConflict',label:'Xưng hô (họ → MC)'},
  {field:'addrMcToThem',conflictField:'addrMcToThemConflict',label:'Xưng hô (MC → họ)'},
  {field:'narrRef',conflictField:'narrRefConflict',label:'Cách gọi ngôi thứ 3'},
];
function renderCharConflictBanner(c){
  const host=document.querySelector('#charModalOverlay .charmodal-inner');
  if(!host)return;
  let banner=document.getElementById('charConflictBanner');
  const items=[];
  CHARMEM_CONFLICT_CONFIG.forEach(cfg=>{
    if(c[cfg.conflictField])items.push({field:cfg.field,label:cfg.label,cur:c[cfg.field]||'Chưa rõ',sug:c[cfg.conflictField].value,reason:c[cfg.conflictField].reason});
  });
  // Gợi ý "có thể là nhân vật chính khác" — khác cấu trúc với items ở trên (2 nhân vật, không phải
  // 1 field cũ/mới trên cùng 1 nhân vật) nên render riêng bằng 1 mẩu HTML khác, không gộp vào items.
  if(!items.length){
    if(banner)banner.remove();
    return;
  }
  if(!banner){
    banner=document.createElement('div');
    banner.id='charConflictBanner';
    banner.className='charmem-conflict-banner';
    host.insertBefore(banner,host.firstChild);
  }
  banner.innerHTML=items.map(it=>`
    <div class="charmem-conflict-item">
      <div class="charmem-conflict-text"><strong>⚠ AI phát hiện mâu thuẫn — ${esc(it.label)}:</strong> hiện đang là "${esc(it.cur)}", chương mới nhất gợi ý sửa thành "${esc(it.sug)}"${it.reason?` <span class="charmem-conflict-reason">(${esc(it.reason)})</span>`:''}</div>
      <div class="charmem-conflict-btns">
        <button type="button" class="btn btn-p" onclick="applyCharConflict('${c.id}','${it.field}')">Áp dụng gợi ý</button>
        <button type="button" class="btn" onclick="dismissCharConflict('${c.id}','${it.field}')">Bỏ qua</button>
      </div>
    </div>`).join('');
}
function autoResizeCharNote(el){
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,120)+'px';
}
function toggleCharAdv(){
  document.getElementById('charAdvToggle').classList.toggle('open');
  document.getElementById('charMergeRow').classList.toggle('open');
}
function populateMergeTargetSelect(excludeId){
  const sel=document.getElementById('charFieldMergeTarget');
  // Sắp theo alphabet (localeCompare tiếng Việt) để dễ tìm nhân vật muốn gộp khi danh sách dài,
  // thay vì giữ nguyên thứ tự thêm/phát hiện nhân vật trong S.characters (thứ tự đó không có ý
  // nghĩa gì với người dùng khi họ đang cần TÌM 1 cái tên cụ thể trong dropdown).
  const others=S.characters.filter(x=>x.id!==excludeId)
    .slice()
    .sort((a,b)=>(a.name||'').localeCompare(b.name||'','vi',{sensitivity:'base'}));
  sel.innerHTML='<option value="">— Chọn nhân vật —</option>'+
    others.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
  document.getElementById('charAdvToggle').style.display=others.length?'':'none';
}
// Set trực tiếp giới tính đang hiển thị trong modal, KHÔNG toggle — dùng khi NẠP dữ liệu nhân vật
// lúc mở modal (openCharModal). Tách riêng khỏi setCharGender() để tránh việc _charModalGender còn
// sót lại giá trị từ lần sửa nhân vật TRƯỚC ĐÓ (biến này không reset khi đóng modal) làm cho
// setCharGender() hiểu nhầm là "bấm lại chip đang chọn" rồi tự ý set về "Chưa rõ" — bug này khiến
// mở modal 1 nhân vật có giới tính TRÙNG với nhân vật vừa sửa trước đó sẽ bị hiển thị sai thành
// "Chưa rõ", và nếu người dùng bấm Lưu lúc này sẽ vô tình xoá mất dữ liệu giới tính đã có.
function initCharGender(g){
  _charModalGender=g||'Chưa rõ';
  document.querySelectorAll('#charFieldGenderRow .charmodal-chip').forEach(b=>{
    b.classList.toggle('active',b.dataset.val===_charModalGender);
  });
}
// Bấm chip giới tính trong modal — bấm lại chip đang active thì bỏ chọn (về "Chưa rõ").
function setCharGender(g){
  if(_charModalGender===g)g='Chưa rõ';
  initCharGender(g);
}
function closeCharModal(){
  document.getElementById('charModalOverlay').classList.remove('show');
  _charEditingId=null;
  _charModalGender='Chưa rõ';
  _charMergeDir='into';
}
// Chuyển đổi chiều gộp (xem khai báo _charMergeDir) — chỉ đổi trạng thái 2 chip, không đụng tới
// lựa chọn đang chọn trong select (danh sách "nhân vật khác" giống nhau cho cả 2 chiều).
function setCharMergeDir(dir){
  _charMergeDir=dir==='out'?'out':'into';
  document.getElementById('charMergeDirInto').classList.toggle('active',_charMergeDir==='into');
  document.getElementById('charMergeDirOut').classList.toggle('active',_charMergeDir==='out');
}
function parseAliasInput(v){
  return (v||'').split(',').map(s=>s.trim()).filter(Boolean);
}
async function saveCharModal(){
  if(!_charEditingId)return;
  const c=S.characters.find(x=>x.id===_charEditingId);
  if(!c)return;
  const name=document.getElementById('charFieldName').value.trim();
  if(!name){alert('Vui lòng nhập tên nhân vật.');return;}
  const rel=document.getElementById('charFieldRel').value.trim();
  const note=document.getElementById('charFieldNote').value;
  const aliasesStr=document.getElementById('charFieldAlias').value;
  const aliases=parseAliasInput(aliasesStr);
  // QUAN TRỌNG — race condition với AI chạy nền: giữa lúc modal đang MỞ (user đọc/gõ), 1 lượt phân
  // tích chương khác có thể đang chạy song song và cập nhật CHÍNH nhân vật này (VD AI cộng dồn thêm
  // narrRef, sửa statusCue, thêm note...) trực tiếp vào object `c` trong S.characters. Nếu code cứ
  // ghi đè MỌI field bằng giá trị đang có trong DOM (vốn được nạp TỪ LÚC MỞ modal, đã lỗi thời), thì
  // chỉ cần user bấm Lưu (dù chỉ để sửa 1 field khác, ví dụ chỉ sửa "Mối quan hệ") là các field khác
  // AI vừa cập nhật xong sẽ bị "hoàn tác" ngược lại giá trị cũ — mất dữ liệu AI mới thêm mà không ai
  // hay biết. Để tránh việc này: CHỈ ghi đè field nào giá trị trong DOM THỰC SỰ khác với lúc mở modal
  // (_charModalInitial, xem openCharModal) — tức người dùng có chủ đích sửa field đó. Field nào
  // người dùng không đụng tới thì bỏ qua hoàn toàn, giữ nguyên bất kỳ giá trị nào đang có trong `c`
  // tại THỜI ĐIỂM LƯU (có thể đã được AI cập nhật sau khi modal mở), thay vì lấy theo DOM cũ.
  if(name!==(_charModalInitial.name||'')){
    c.name=name;
  }
  if(_charModalGender!==(_charModalInitial.gender||'Chưa rõ')){
    c.gender=_charModalGender;
    c.genderSource=(_charModalGender&&_charModalGender!=='Chưa rõ')?'user':'ai';
    c.genderConflict=null;
  }
  if(rel!==(_charModalInitial.relationship||'')){
    c.relationship=rel||'Chưa rõ';
    c.relationshipSource=rel?'user':'ai';
    c.relationshipConflict=null;
    // Người dùng tự gõ/lưu quan hệ qua modal -> đây là hành động XÁC NHẬN THỦ CÔNG, luôn được tin
    // tưởng tuyệt đối: gỡ cờ "protagonistDenied" (nếu có) để isProtagonist phản ánh ĐÚNG những gì
    // user vừa gõ. Chỉ làm việc này khi user THỰC SỰ sửa relationship — nếu không, giữ nguyên cờ cũ,
    // tránh vô tình "hồi sinh" ngôi sao nhân vật chính chỉ vì user mở modal xem rồi bấm Lưu.
    c.isProtagonist=isProtagonistLabel(rel);
    c.protagonistDenied=false;
  }
  if(note!==(_charModalInitial.note||'')){
    c.note=note;
    c.noteSource=note.trim()?'user':'ai';
  }
  if(aliasesStr!==(_charModalInitial.aliases||'')){
    c.aliases=aliases;
  }
  const inThem=document.getElementById('charFieldAddrThemToMc');
  const inMc=document.getElementById('charFieldAddrMcToThem');
  const addrThem=inThem?inThem.value.trim():undefined;
  const addrMc=inMc?inMc.value.trim():undefined;
  // Chỉ ghi đè từng chiều xưng hô NẾU chính chiều đó thực sự đổi so với lúc mở modal — trước đây
  // ghi đè cả 2 chiều bất kể có đổi hay không (miễn input tồn tại), nay tách riêng để chiều không đổi
  // không bị ghi lại giá trị DOM cũ, phòng khi AI vừa cập nhật xong chiều đó trong lúc modal mở.
  const addrThemChanged=addrThem!==undefined&&addrThem!==(_charModalInitial.addrThemToMc||'');
  const addrMcChanged=addrMc!==undefined&&addrMc!==(_charModalInitial.addrMcToThem||'');
  if(addrThemChanged){c.addrThemToMc=addrThem||'Chưa rõ';c.addrThemToMcConflict=null;}
  if(addrMcChanged){c.addrMcToThem=addrMc||'Chưa rõ';c.addrMcToThemConflict=null;}
  // Chỉ khoá addrSource='user' nếu MỘT TRONG HAI ô xưng hô thực sự đổi giá trị so với lúc mở modal.
  // Người dùng chỉ mở modal xem rồi Lưu mà không sửa gì ở đây -> giữ nguyên nguồn cũ, không khoá oan.
  if(addrThemChanged||addrMcChanged){
    c.addrSource=(addrThem||addrMc)?'user':'ai';
  }
  const inStatus=document.getElementById('charFieldStatusCue');
  const statusCue=inStatus?inStatus.value.trim():undefined;
  // Người dùng thực sự sửa -> khoá lại (AI không ghi đè). Không đổi -> bỏ qua hoàn toàn (KHÔNG còn
  // nhánh "else" ghi lại giá trị DOM cũ như bản trước — đó chính là chỗ gây mất dữ liệu AI mới thêm).
  if(statusCue!==undefined&&statusCue!==(_charModalInitial.statusCue||'')){
    c.statusCue=statusCue;c.statusCueSource=statusCue?'user':'ai';
  }
  const inNarrRef=document.getElementById('charFieldNarrRef');
  const narrRef=inNarrRef?inNarrRef.value.trim():undefined;
  // Giống statusCue ở trên: chỉ ghi khi THỰC SỰ đổi so với lúc mở modal, không còn ghi lại DOM cũ khi
  // không đổi — tránh hoàn tác nhầm các lựa chọn narrRef mà AI vừa cộng dồn thêm trong lúc modal mở.
  if(narrRef!==undefined&&narrRef!==(_charModalInitial.narrRef||'')){
    c.narrRef=narrRef||'Chưa rõ';c.narrRefConflict=null;
    c.narrRefSource=narrRef?'user':'ai';
  }
  closeCharModal();
  await saveCharacterMemory();
  renderCharList();
}
// Gộp `source` vào `target` (target được giữ lại). Dùng chung cho cả gộp thủ công (nút trong
// modal) lẫn gộp tự động do AI phát hiện (xem applyAutoMerges). Tên + alias của nhân vật bị gộp
// được thêm vào aliases của đích để lần phân tích sau AI nhận đúng là 1 người.
function mergeCharacterInto(source,target,opts={}){
  const newAliases=new Set([...(target.aliases||[]),source.name,...(source.aliases||[])]);
  newAliases.delete(target.name);
  target.aliases=[...newAliases];
  // Bổ sung field còn thiếu ở đích từ nguồn, tôn trọng ưu tiên user > ai, không ghi đè field đã có
  if(isUnknownVal(target.gender)&&!isUnknownVal(source.gender)){
    target.gender=source.gender;target.genderSource=source.genderSource||'ai';
  }
  if(isUnknownVal(target.relationship)&&!isUnknownVal(source.relationship)){
    target.relationship=source.relationship;target.relationshipSource=source.relationshipSource||'ai';
  }
  if(!target.genderConflict&&source.genderConflict)target.genderConflict=source.genderConflict;
  if(!target.relationshipConflict&&source.relationshipConflict)target.relationshipConflict=source.relationshipConflict;
  // Nhớ lại TRƯỚC KHI ghi đè: target có đang hoàn toàn chưa có dữ liệu xưng hô nào không — dùng để
  // quyết định có nên nhận luôn addrTone của source hay không (xem bên dưới), tránh so target.addrTone
  // (đã bị ghi đè) mà tưởng nhầm là target "vẫn chưa có" trong khi thực ra vừa mới nhận dữ liệu.
  const targetAddrWasEmpty=isAddrUnknown(target.addrThemToMc)&&isAddrUnknown(target.addrMcToThem);
  if((!target.addrThemToMc||isAddrUnknown(target.addrThemToMc))&&source.addrThemToMc&&!isAddrUnknown(source.addrThemToMc))target.addrThemToMc=source.addrThemToMc;
  if((!target.addrMcToThem||isAddrUnknown(target.addrMcToThem))&&source.addrMcToThem&&!isAddrUnknown(source.addrMcToThem))target.addrMcToThem=source.addrMcToThem;
  // addrTone ghi nhận NHÓM sắc thái của cặp xưng hô ĐANG LƯU — nếu không merge theo, target vẫn giữ
  // addrTone cũ (thường là "Chưa rõ" nếu target trước đó chưa có xưng hô), trong khi target.addrThemToMc/
  // addrMcToThem vừa nhận dữ liệu thật từ source ở trên. Lần phân tích chương kế tiếp, addrToneSameGroup()
  // sẽ so sánh nhóm "Chưa rõ" (sai) với nhóm mới của chương đó, luôn trả về null (không so sánh được)
  // thay vì so đúng, khiến quyết định cộng dồn/thay thế xưng hô kém chính xác hơn cần thiết. Chỉ nhận
  // addrTone của source khi target THỰC SỰ chưa có xưng hô nào trước đó (không ghi đè 1 tone đã có ý nghĩa).
  if(targetAddrWasEmpty&&source.addrTone&&source.addrTone!=='Chưa rõ')target.addrTone=source.addrTone;
  if(!target.addrThemToMcConflict&&source.addrThemToMcConflict)target.addrThemToMcConflict=source.addrThemToMcConflict;
  if(!target.addrMcToThemConflict&&source.addrMcToThemConflict)target.addrMcToThemConflict=source.addrMcToThemConflict;
  // narrRef (cách gọi ngôi thứ 3 khi tường thuật): nếu target chưa có, nhận nguyên từ source; nếu cả
  // 2 đều đã có, cộng dồn các lựa chọn chưa trùng (giống addAddrCandidate) thay vì chọn 1 trong 2.
  if(isNarrRefUnknown(target.narrRef)&&!isNarrRefUnknown(source.narrRef)){
    target.narrRef=source.narrRef;target.narrRefSource=source.narrRefSource||'ai';
  } else if(!isNarrRefUnknown(target.narrRef)&&!isNarrRefUnknown(source.narrRef)){
    target.narrRef=addAddrCandidate(target.narrRef,source.narrRef);
  }
  if(!target.narrRefConflict&&source.narrRefConflict)target.narrRefConflict=source.narrRefConflict;
  target.note=mergeNoteText(target.note,source.note,target.noteSource);
  // Gộp 2 entry TRÙNG (cùng 1 người thật) -> nếu 1 trong 2 từng bị user bấm huỷ ngôi sao
  // (protagonistDenied), giữ nguyên sự huỷ đó cho entry gộp — không để bên kia "hồi sinh" lại
  // trạng thái nhân vật chính mà user đã chủ động phủ nhận cho đúng người này.
  target.protagonistDenied=target.protagonistDenied||source.protagonistDenied;
  if(source.isProtagonist&&!target.protagonistDenied)target.isProtagonist=true;
  // Gộp danh sách chương đã xuất hiện (không trùng lặp) thay vì cộng dồn số đếm, để tránh đếm
  // trùng nếu 1 chương từng được tính cho cả 2 nhân vật trước khi bị phát hiện là cùng 1 người.
  const chSet=new Set([...(target.mentionChapters||[]),...(source.mentionChapters||[])]);
  if(chSet.size){
    target.mentionChapters=[...chSet].sort((a,b)=>a-b);
  } else {
    target.mentionCount=(target.mentionCount||0)+(source.mentionCount||0);
  }
  S.characters=S.characters.filter(x=>x.id!==source.id);
  if(opts.auto){
    console.log(`[Luồng 1][Gộp trùng] Auto-merged: "${source.name}" -> "${target.name}"`);
  }
  return target;
}
// Gộp nhân vật thủ công từ modal — 2 chiều tuỳ theo _charMergeDir (xem khai báo + setCharMergeDir):
// - 'into' (mặc định, hành vi cũ): nhân vật chọn ở dropdown (other) bị gộp VÀO nhân vật đang mở popup
//   (current) — current được giữ lại làm tên chính, tên other chuyển thành tên phụ (alias) của current.
// - 'out': ngược lại — nhân vật ĐANG MỞ POPUP (current) bị gộp vào nhân vật chọn ở dropdown (other) —
//   other được giữ lại, tên current chuyển thành tên phụ (alias) của other. Vì current không còn tồn
//   tại sau khi gộp, modal phải đóng lại như bình thường.
async function doMergeChar(){
  if(!_charEditingId)return;
  const targetId=document.getElementById('charFieldMergeTarget').value;
  if(!targetId){alert('Vui lòng chọn nhân vật muốn gộp.');return;}
  const current=S.characters.find(x=>x.id===_charEditingId);
  const other=S.characters.find(x=>x.id===targetId);
  if(!current||!other)return;
  const into=_charMergeDir!=='out';
  const source=into?other:current;
  const target=into?current:other;
  showPopup({
    title:'Gộp nhân vật?',
    msg:`<strong>${esc(source.name)}</strong> sẽ được gộp vào <strong>${esc(target.name)}</strong> (coi là cùng 1 người). Thao tác này không ảnh hưởng bản gốc/bản dịch.`,
    btns:[
      {label:'Gộp',cls:'btn-p',cb:async()=>{
        mergeCharacterInto(source,target);
        closeCharModal();
        await saveCharacterMemory();
        renderCharList();
      }},
      {label:'Hủy',cls:'btn'},
    ]
  });
}
// ===== TỰ ĐỘNG GỘP NHÂN VẬT TRÙNG (do AI phát hiện) =====
// Kết hợp nội dung ghi chú của 2 nhân vật khi gộp, không ghi đè ghi chú do NGƯỜI DÙNG tự viết.
function mergeNoteText(targetNote,sourceNote,targetNoteSource){
  const tN=(targetNote||'').trim(),sN=(sourceNote||'').trim();
  if(!sN)return targetNote||'';
  if(!tN)return sN;
  if(targetNoteSource==='user')return targetNote; // ghi chú người dùng tự viết — không tự ý ghép thêm
  if(tN.toLowerCase().includes(sN.toLowerCase()))return targetNote;
  return trimAiNote(tN+'; '+sN);
}
// Xử lý danh sách "merges" AI trả về: mỗi mục {keep, duplicates:[...]} chỉ áp dụng cho các
// nhân vật ĐÃ CÓ SẴN trong S.characters (khớp theo tên chính hoặc alias). Bỏ qua an toàn nếu
// không tìm thấy nhân vật tương ứng, tránh gộp nhầm nhân vật mới vừa phát hiện trong chương này.
function applyAutoMerges(merges){
  if(!Array.isArray(merges)||!merges.length)return;
  for(const m of merges){
    if(!m||!m.keep||!Array.isArray(m.duplicates))continue;
    const target=findCharByNameOrAlias(String(m.keep));
    if(!target)continue;
    for(const dupName of m.duplicates){
      if(!dupName)continue;
      const source=findCharByNameOrAlias(String(dupName));
      if(!source||source.id===target.id)continue;
      // LƯỚI AN TOÀN: không BAO GIỜ tự động gộp (không hỏi user) 2 nhân vật đã có giới tính XÁC ĐỊNH
      // và KHÁC NHAU — đây là dấu hiệu gần như chắc chắn 2 người khác nhau, AI đề xuất gộp lúc này
      // nhiều khả năng là nhầm lẫn (VD nhầm 2 nhân vật cùng được gọi bằng 1 danh xưng nào đó). Nếu
      // không chặn, mọi field của source (kể cả narrRef) sẽ bị cộng dồn thẳng vào target ngay lập
      // tức, không qua bước duyệt nào — đúng cơ chế có thể gây ra hiện tượng "sửa nhân vật A thì
      // nhân vật B cũng đổi theo" mà không phải do AI phân tích gán trùng giá trị (xem
      // claimNarrRefCandidatesForBatch ở trên) mà do 2 nhân vật đã bị gộp làm một từ trước.
      if(!isUnknownVal(source.gender)&&!isUnknownVal(target.gender)&&source.gender!==target.gender){
        console.log(`[Luồng 1][Gộp trùng] Bỏ qua auto-merge "${source.name}" -> "${target.name}": giới tính khác nhau (${source.gender} vs ${target.gender}), nghi AI nhầm lẫn 2 nhân vật khác nhau.`);
        continue;
      }
      mergeCharacterInto(source,target,{auto:true});
    }
  }
}
// Ghi log để dev/người dùng kiểm tra trong console khi AI vừa tự động sửa lại 1 field
// (gender/relationship) do phát hiện dữ liệu cũ (vốn cũng chỉ do AI đoán) mâu thuẫn với
// bằng chứng rõ ràng trong chương vừa phân tích. Không hiện thông báo trên UI.
const CHARMEM_FIELD_LABEL={gender:'giới tính',relationship:'mối quan hệ'};
function notifyCharCorrection(charName,field,oldVal,newVal,reason){
  const label=CHARMEM_FIELD_LABEL[field]||field;
  const reasonTxt=reason?` (${reason})`:'';
  console.log(`[Luồng 1][Cập nhật] Đã tự sửa ${label} của "${charName}": ${oldVal} → ${newVal}${reasonTxt}`);
  renderCharList();
}
// Người dùng bấm "Áp dụng" gợi ý sửa (khi dữ liệu cũ đã được chính người dùng xác nhận trước đó,
// nên hệ thống không tự ý ghi đè mà chờ người dùng tự quyết định).
// sourceField theo field: gender/relationship có source riêng, 2 field xưng hô dùng chung addrSource.
function charSourceFieldFor(field){
  if(field==='gender')return 'genderSource';
  if(field==='relationship')return 'relationshipSource';
  if(field==='addrThemToMc'||field==='addrMcToThem')return 'addrSource';
  return field+'Source';
}
async function applyCharConflict(id,field){
  const c=S.characters.find(x=>x.id===id);
  if(!c)return;
  const cfg=CHARMEM_CONFLICT_CONFIG.find(x=>x.field===field);
  if(!cfg)return;
  const conflictField=cfg.conflictField;
  const sourceField=charSourceFieldFor(field);
  const conflict=c[conflictField];
  if(!conflict)return;
  c[field]=conflict.value;
  c[sourceField]='ai'; // vẫn tính là AI tự quản -> không khoá, chương sau AI vẫn có thể tự sửa tiếp mà không cần hỏi lại
  // User chủ động bấm "Áp dụng" gợi ý -> coi như xác nhận thủ công, gỡ luôn cờ protagonistDenied
  // (nếu có) để giá trị mới thực sự có hiệu lực, không bị chặn ngầm bởi 1 lần huỷ ngôi sao trước đó.
  if(field==='relationship'&&isProtagonistLabel(conflict.value)){c.isProtagonist=true;c.protagonistDenied=false;}
  c[conflictField]=null;
  await saveCharacterMemory();
  if(_charEditingId===id)openCharModal(id); else renderCharList();
}
// Người dùng bấm "Bỏ qua" -> giữ nguyên dữ liệu cũ, xoá gợi ý đi (AI sẽ không nhắc lại trừ khi
// phát hiện bằng chứng correction mới ở 1 chương khác).
async function dismissCharConflict(id,field){
  const c=S.characters.find(x=>x.id===id);
  if(!c)return;
  const cfg=CHARMEM_CONFLICT_CONFIG.find(x=>x.field===field);
  if(!cfg)return;
  c[cfg.conflictField]=null;
  await saveCharacterMemory();
  if(_charEditingId===id)openCharModal(id); else renderCharList();
}
function confirmDeleteChar(id){
  const c=S.characters.find(x=>x.id===id);
  if(!c)return;
  showPopup({
    title:'Xóa nhân vật này khỏi bộ nhớ?',
    msg:`<strong>${esc(c.name)}</strong> sẽ bị xóa khỏi Character Memory. Bản gốc và bản dịch không bị ảnh hưởng.`,
    btns:[
      {label:'Xóa',cls:'btn-d',cb:async()=>{
        S.characters=S.characters.filter(x=>x.id!==id);
        await saveCharacterMemory();
        renderCharList();
      }},
      {label:'Hủy',cls:'btn'},
    ]
  });
}

// ===================================================================
// ===== "CHƯNG CẤT" CHỈ DẪN XƯNG HÔ/THỂ LOẠI TỪ PROMPT DỊCH CHÍNH =====
// ===================================================================
// Prompt dịch chính (ô "promptText" ở index.html) là nơi DUY NHẤT người dùng có thể tự tay dặn
// riêng cho bộ truyện của họ (thể loại, cách xưng hô Tây phương hoá, glossary tên riêng...), nhưng
// buildCharExtractPrompt/buildAddressAuditPrompt trước đây hoàn toàn không biết gì về nội dung đó —
// chỉ dựa quy tắc chung chung. Nếu nhét NGUYÊN VĂN prompt dịch chính (có thể rất dài, lẫn cả hướng
// dẫn định dạng/thuật ngữ không liên quan) vào thẳng 2 prompt kia thì vừa tốn token vừa gây nhiễu.
// Giải pháp: gọi AI "chưng cất" 1 lần để lọc lấy đúng phần liên quan xưng hô/thể loại/tên riêng,
// rồi CACHE lại kết quả — chỉ gọi lại khi người dùng thực sự sửa nội dung prompt dịch chính (so
// bằng hash, không so nguyên văn để tiết kiệm chỗ lưu). Cache lưu theo TỪNG BỘ TRUYỆN (giống
// charMemStorageKey) vì các bộ khác nhau thường dùng prompt khác nhau.
function promptGuidanceStorageKey(){return 'dich-charm-guidance:'+(S.fname||'__noname__');}
// Hash chuỗi đơn giản (djb2 biến thể) — CHỈ dùng để phát hiện prompt dịch chính có bị sửa hay
// không (không cần chống va chạm mật mã học, chỉ cần đủ rẻ để không phải lưu lại nguyên văn prompt
// dài trong cache).
function simpleHash(s){
  let h=0;
  for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;}
  return h.toString(36);
}
function buildPromptGuidanceDistillPrompt(mainPrompt){
  return `Dưới đây là PROMPT DỊCH CHÍNH mà người dùng đang dùng để dịch truyện — có thể dài, chứa nhiều loại chỉ dẫn khác nhau (định dạng output, cách dịch thuật ngữ chuyên môn, ví dụ minh hoạ, quy tắc kỹ thuật khác...).\n\n`+
    `Nhiệm vụ DUY NHẤT: đọc và CHỈ TRÍCH XUẤT đúng phần liên quan tới XƯNG HÔ giữa các nhân vật, THỂ LOẠI/BỐI CẢNH của truyện (VD tu tiên, đô thị hiện đại, phương Tây/hải tặc, xuyên không, cận đại/dân quốc...), và bất kỳ QUY ƯỚC TÊN RIÊNG/CÁCH GỌI cụ thể nào người dùng đã dặn riêng cho từng nhân vật (nếu có) — BỎ QUA HOÀN TOÀN mọi phần không liên quan (định dạng output, cách dịch thuật ngữ không phải xưng hô, ví dụ minh hoạ, hướng dẫn kỹ thuật khác).\n\n`+
    `Trả lời NGẮN GỌN dạng vài gạch đầu dòng, KHÔNG QUÁ khoảng 120 từ, chỉ nêu đúng sự thật/chỉ dẫn cụ thể, không diễn giải dài dòng, không thêm tiêu đề hay markdown fence. Nếu prompt dịch chính không có bất kỳ nội dung nào liên quan tới xưng hô/thể loại/tên riêng, trả về ĐÚNG một chuỗi rỗng, không viết gì khác.\n\n`+
    `PROMPT DỊCH CHÍNH:\n${mainPrompt.slice(0,8000)}`;
}
// Lấy chỉ dẫn đã chưng cất từ prompt dịch chính — có cache theo hash, chỉ gọi AI lại khi nội dung
// prompt dịch chính thực sự đổi. Không bao giờ throw; lỗi thì trả về '' (2 bước kia tự quay lại dùng
// quy tắc chung chung như trước, không bị chặn dịch).
async function getMainPromptGuidance(){
  try{
    const mainPrompt=(typeof getPrompt==='function')?getPrompt():'';
    if(!mainPrompt)return '';
    const hash=simpleHash(mainPrompt);
    const gKey=promptGuidanceStorageKey();
    let cache=null;
    if(typeof cfgGet==='function'){
      try{
        const v=await cfgGet(gKey);
        cache=typeof v==='string'?JSON.parse(v):(typeof v==='object'?v:null);
      }catch(e){}
    }
    if(!cache){
      try{
        const lsVal=localStorage.getItem(gKey);
        if(lsVal){
          cache=JSON.parse(lsVal);
          if(typeof cfgSet==='function'){try{await cfgSet(gKey, lsVal);localStorage.removeItem(gKey);}catch(_){}}
        }
      }catch(e){cache=null;}
    }
    if(cache&&cache.hash===hash)return cache.guidance||'';
    const keys=getKeys();
    // Chưa có key để gọi API: nếu cache cũ (dù đã lệch hash vì prompt vừa đổi) vẫn còn, thà dùng tạm
    // còn hơn không có gì — tự cập nhật lại ở lượt gọi kế tiếp khi có key.
    if(!keys.length)return cache?cache.guidance||'':'';
    const promptText=buildPromptGuidanceDistillPrompt(mainPrompt);
    const messages=[{role:'user',parts:[{text:promptText}]}];
    // DeepSeek chỉ có 1 model — không có model NHẸ riêng như CHAR_MODEL_A của Gemini để tiết kiệm
    // chi phí, đành dùng thẳng model đang chọn.
    const distillModel=getProvider()==='deepseek'?getModel():CHAR_MODEL_A;
    let rawText=await callCharModel(keys,distillModel,messages,CHAR_ANALYSIS_TIMEOUT_MS);
    rawText=(rawText||'').trim().replace(/^```[a-z]*\s*/i,'').replace(/```\s*$/,'').trim();
    // Model đôi khi trả nguyên chữ "" hoặc '' thay vì để trống thật khi không có gì liên quan.
    if(rawText==='""'||rawText==="''")rawText='';
    const guidance=rawText.slice(0,1500); // lưới an toàn phòng model bỏ qua giới hạn ~120 từ đã dặn
    const gPayload=JSON.stringify({hash,guidance,ts:Date.now()});
    if(typeof cfgSet==='function'){
      try{await cfgSet(gKey, gPayload);localStorage.removeItem(gKey);}catch(e){}
    }else{
      try{localStorage.setItem(gKey,gPayload);}catch(e){}
    }
    console.log(guidance
      ?`[Luồng 1][Chưng cất prompt] Đã chưng cất chỉ dẫn xưng hô/thể loại từ prompt dịch chính:\n${guidance}`
      :'[Luồng 1][Chưng cất prompt] Prompt dịch chính không có nội dung nào liên quan xưng hô/thể loại — không có chỉ dẫn thêm.');
    return guidance;
  }catch(e){
    console.log('[Luồng 1][Chưng cất prompt] Lỗi chưng cất prompt dịch chính — 2 bước sau tạm dùng quy tắc chung chung:',e.message||e);
    return '';
  }
}

// ===== PHÂN TÍCH NHÂN VẬT TRƯỚC KHI DỊCH =====
// Ký tự trong khối CJK Unified Ideographs — dùng để phát hiện tên còn sót lại chữ Hán chưa dịch.
function containsCJK(s){return /[\u3400-\u9fff]/.test(s||'');}

// Gọi 1 model cụ thể với cơ chế thử lần lượt các API key + timeout, dùng chung cho mọi request nhỏ
// liên quan tới Character Memory (trích xuất nhân vật, xác minh nghi vấn...).
async function callCharModel(keys,model,messages,timeoutMs){
  async function tryAllKeys(){
    let lastErr='';
    for(let ki=0;ki<keys.length;ki++){
      try{
        // disableThinking=true: các lượt gọi ở đây (trích xuất/xác minh/chưng cất thông tin nhân
        // vật) đều là tác vụ NHẸ — tắt "nghĩ kỹ" để nhanh hơn + đỡ tốn token. Chỉ có tác dụng với
        // DeepSeek (Gemini tự quản lý riêng qua shouldDisableThinking() trong callAPI, không bị
        // ảnh hưởng bởi cờ này).
        const r=await callAPI(keys[ki],model,messages,undefined,true);
        return r.text;
      }catch(err){
        lastErr=err.message||String(err);
        continue;
      }
    }
    throw new Error(lastErr||'Tất cả key đều lỗi');
  }
  // DeepSeek thường chậm hơn Gemini khá nhiều và hay bị timeout ở bước lấy thông tin nhân vật
  // (30s không đủ) → KHÔNG áp timeout với DeepSeek, cứ chờ tới khi xong hoặc lỗi hẳn (giống cách
  // CHAPTER_TIMEOUT_MS=Infinity xử lý bước dịch chính cho DeepSeek). Chỉ Gemini mới bị giới hạn
  // timeoutMs (mặc định CHAR_ANALYSIS_TIMEOUT_MS).
  if(model.startsWith('deepseek'))return tryAllKeys();
  const timeoutPromise=new Promise((_,rej)=>setTimeout(()=>rej(new Error('TIMEOUT')),timeoutMs));
  return Promise.race([tryAllKeys(),timeoutPromise]);
}

// Dựng prompt trích xuất nhân vật cho lượt gọi model chính (xem analyzeChapterCharacters).
function buildCharExtractPrompt(chapterTextForAnalysis,promptGuidance){
  const known=selectKnownCharsForPrompt(chapterTextForAnalysis).map(c=>{
    const base={
      name:c.name,
      // Cờ báo hiệu tường minh cho model: "name" ở trên VẪN CÒN SÓT chữ Hán/Trung Quốc chưa được dịch
      // (lỗi từ lượt phân tích trước — nhất là với TÊN NHÂN VẬT CHÍNH vì bị nêu cố định trong
      // protagonistLine bên dưới nên model có xu hướng chỉ copy lại y nguyên mà không soát lại xem đã
      // dịch hay chưa). Để field JSON riêng, dễ model nhận ra hơn là chỉ dựa vào câu chữ mô tả trong
      // prompt — xem hướng dẫn xử lý needsTranslation ngay dưới prompt này.
      needsTranslation:containsCJK(c.name)?true:undefined,
      aliases:c.aliases&&c.aliases.length?c.aliases:undefined,
      gender:c.gender||'Chưa rõ',
      relationship:c.relationship||'Chưa rõ'
    };
    // Field note/xưng hô/statusCue/narrRef CHỈ thực sự hữu ích cho nhân vật thuộc nhóm "forced"
    // (đang thực sự xuất hiện/có mặt trong chương đang phân tích, hoặc còn sót chữ Hán) — vì cơ chế
    // correction/addrEvidence (xem hướng dẫn "correction" bên dưới) đòi hỏi CHÍNH chương này đưa ra
    // bằng chứng TRỰC TIẾP, mà điều đó gần như chỉ xảy ra được với nhân vật đã nằm trong "forced".
    // Với nhân vật thuộc "rest" (lấp đầy chỗ trống trong CHARMEM_KNOWN_LIMIT, không có mặt trong
    // chương này), gửi kèm các field này chỉ tốn token vì model không có căn cứ nào trong chương để
    // dùng tới — nên lược bỏ hết, kể cả "note".
    if(!c._charmemForced)return base;
    return {
      ...base,
      note:c.note&&c.note.trim()?c.note.trim():undefined,
      statusCue:c.statusCue&&c.statusCue.trim()?c.statusCue.trim():undefined,
      addrThemToMc:c.addrThemToMc||undefined,
      addrMcToThem:c.addrMcToThem||undefined,
      addrTone:c.addrTone&&c.addrTone!=='Chưa rõ'?c.addrTone:undefined,
      narrRef:c.narrRef&&!isNarrRefUnknown(c.narrRef)?c.narrRef:undefined
    };
  });
  // Nêu rõ TÊN nhân vật chính ngay từ đầu prompt (thay vì chỉ để AI tự mò trong "known" JSON) —
  // tránh việc model (nhất là model rẻ/lite) suy luận nhầm "mốc" nhân vật chính riêng cho từng
  // chương, dẫn tới field "relationship" của người khác bị ghi sai lệch/không liên quan tới MC.
  // LƯU Ý: chính vì tên nhân vật chính được nêu "đóng đinh" ở đây, model rất dễ chỉ copy lại y
  // nguyên chuỗi này mà quên mất là nó cần được KIỂM TRA/DỊCH nếu vẫn còn sót chữ Hán — nên khi phát
  // hiện protagonist.name còn CJK, phải chèn thêm câu nhắc riêng ngay trong chính protagonistLine
  // (không chỉ dựa vào needsTranslation trong "known" JSON phía dưới, vì protagonistLine xuất hiện
  // TRƯỚC và có trọng số nhắc lệnh mạnh hơn trong mắt model).
  const protagonist=S.characters.find(c=>isCharProtagonist(c));
  const protagonistNeedsFix=protagonist&&containsCJK(protagonist.name);
  const protagonistLine=protagonist
    ?`NHÂN VẬT CHÍNH của truyện đã được xác định là: "${protagonist.name}". BẮT BUỘC dùng CHÍNH XÁC người này làm mốc khi xác định "relationship" cho TẤT CẢ nhân vật khác bên dưới — không tự suy luận người khác làm nhân vật chính, kể cả khi người này không xuất hiện nhiều trong chương đang đọc.`+
      (protagonistNeedsFix
        ?` ⚠ LƯU Ý QUAN TRỌNG: cái tên "${protagonist.name}" nêu trên VẪN CÒN SÓT chữ Hán/Trung Quốc chưa được dịch (lỗi từ lượt phân tích trước) — việc dùng nó làm MỐC để tính "relationship" không có nghĩa là được phép giữ nguyên chữ Hán khi trả về entry "characters" của chính nhân vật này; BẮT BUỘC dịch tên này sang Hán Việt (hoặc phục hồi tên phương Tây nếu đúng là tên âm dịch, xem quy tắc "name" bên dưới) ngay trong lượt trích xuất này, và dùng tên ĐÃ DỊCH cho field "name" của nhân vật chính trong kết quả trả về.`
        :'')+
      `\n\n`
    :`Chưa xác định được nhân vật chính cụ thể — tự suy luận dựa vào người kể chuyện ngôi thứ nhất ("ta","tôi") hoặc nhân vật trung tâm/xuất hiện nhiều nhất của chương, rồi dùng người đó làm mốc khi xác định "relationship" cho nhân vật khác.\n\n`;
  // Chỉ dẫn xưng hô/thể loại/tên riêng đã "chưng cất" từ prompt dịch chính của người dùng (xem
  // getMainPromptGuidance) — cho phép bước trích xuất này bám sát ý người dùng thay vì chỉ dựa quy
  // tắc chung chung cho mọi thể loại truyện. Đặt SAU protagonistLine (mốc nhân vật chính) nhưng
  // TRƯỚC danh sách nhân vật đã biết, và nói rõ thứ tự ưu tiên khi có mâu thuẫn với quy tắc bắt buộc
  // bên dưới (VD định dạng "Chưa rõ", cách xác định relationship theo nhân vật chính...).
  const guidanceSection=promptGuidance
    ?`CHỈ DẪN THÊM từ prompt dịch chính của người dùng (đã lọc lại, chỉ giữ phần liên quan xưng hô/thể loại/tên riêng) — dùng để hiểu đúng bối cảnh/thể loại truyện và các quy ước riêng, nhưng khi mâu thuẫn với các QUY TẮC BẮT BUỘC liệt kê bên dưới (định dạng field, cách xác định relationship theo nhân vật chính...) thì QUY TẮC BẮT BUỘC luôn được ưu tiên hơn:\n${promptGuidance}\n\n`
    :'';
  const sys=`Bạn là công cụ trích xuất dữ liệu nhân vật cho một hệ thống dịch truyện. `+
    `Đọc đoạn văn bản gốc (có thể là tiếng Trung, tiếng Anh, hoặc ngôn ngữ khác) bên dưới và xác định TẤT CẢ nhân vật xuất hiện.\n\n`+
    protagonistLine+guidanceSection+
    `YÊU CẦU BẮT BUỘC:\n`+
    `- Chỉ trả về JSON, không thêm bất kỳ văn bản, giải thích hay markdown fence nào khác.\n`+
    `- Định dạng: {"characters":[{"name":"...","originalName":"...","sinoAlias":"...","gender":"Nam"|"Nữ"|"Chưa rõ","relationship":"...","addrThemToMc":[{"self":"...","callsMc":"..."}],"addrMcToThem":[{"self":"...","callsThem":"..."}],"addrEvidence":"trực tiếp"|"suy đoán"|"không có hội thoại","addrTone":"...","narrRef":"...","statusCue":"...","note":"...","correction":{"gender":true|false,"relationship":true|false,"addressing":true|false,"narrRef":true|false,"reason":"..."}}],"merges":[{"keep":"...","duplicates":["..."]}]}\n`+
    `- "name": tên nhân vật dùng để LƯU VÀO BỘ NHỚ (không phải để thay thế bản dịch chính văn), quy tắc tuỳ theo chữ viết của văn bản gốc: `+
    `NẾU văn bản gốc dùng CHỮ HÁN/TRUNG QUỐC: "name" BẮT BUỘC đã được phiên âm sang Hán Việt, TUYỆT ĐỐI CẤM còn sót bất kỳ ký tự chữ Hán/Trung Quốc nào. `+
    `Ví dụ chuyển đổi đúng (chữ Hán gốc → "name" phải ghi): 齐麟→"Tề Lân", 陈冬锡→"Trần Đông Tích", 王韵之→"Vương Vận Chi", 老黄→"Lão Hoàng", 汤音璇→"Thang Âm Tuyền". `+
    `NGOẠI LỆ QUAN TRỌNG cho tên phiên âm gốc phương Tây: nếu tên chữ Hán đó THỰC CHẤT là do tác giả DÙNG CHỮ HÁN ĐỂ PHIÊN ÂM (âm dịch/音译) một tên người phương Tây/tiếng Anh — thường gặp ở nhân vật ngoại quốc, bối cảnh đô thị/xuyên không/dị giới hiện đại có yếu tố nước ngoài — thì PHẢI dùng lại tên phương Tây gốc (cách viết tiếng Anh/Latin thông dụng, đúng chính tả) làm "name", KHÔNG dùng Hán Việt cho trường hợp này. `+
    `Ví dụ: 莱恩 (âm dịch từ "Ryan") → "name":"Ryan"; 约翰 (âm dịch từ "John") → "name":"John"; 迈克尔 (âm dịch từ "Michael") → "name":"Michael"; 艾米丽 (âm dịch từ "Emily") → "name":"Emily". `+
    `Chỉ áp dụng ngoại lệ này khi CHẮC CHẮN đây là âm dịch từ tên phương Tây (âm tiết phiên âm nghe rõ như phiên âm ngoại quốc, nhân vật có bối cảnh/quốc tịch/gốc gác phương Tây trong truyện) — nếu là tên người Hoa/Việt/Á Đông bản địa bình thường thì vẫn áp dụng quy tắc Hán Việt như trên, TUYỆT ĐỐI KHÔNG suy diễn bừa chỉ vì âm nghe lạ. `+
    `Khi áp dụng ngoại lệ này, BẮT BUỘC đồng thời điền field "sinoAlias" bằng đúng cách phiên âm Hán Việt của chữ Hán đó (VD 莱恩→"Lai Ân", 约翰→"Ước Hàn") để hệ thống lưu lại làm tên phụ, phòng khi bản dịch trước đây hoặc chương khác từng dùng cách viết Hán Việt này. Nếu KHÔNG rơi vào ngoại lệ này (tên bản địa bình thường, hoặc văn bản gốc không phải chữ Hán), để "sinoAlias":"". `+
    `NẾU văn bản gốc KHÔNG phải chữ Hán (VD tiếng Anh, chữ Latin, hay ngôn ngữ khác): GIỮ NGUYÊN "name" y hệt cách viết trong văn bản gốc (VD "John Carter"→"John Carter", "Dr. Ellen Ripley"→"Dr. Ellen Ripley") — TUYỆT ĐỐI KHÔNG tự ý phiên âm, Việt hoá, hay đổi cách viết tên, vì đây chỉ là dữ liệu để đối chiếu/ghi nhớ nhân vật, không phải bản dịch. `+
    `Nếu nhân vật này đã có sẵn trong danh sách "đã biết" ở trên (khớp qua tên chính hoặc alias), PHẢI dùng lại NGUYÊN VĂN "name" đã có sẵn đó — không tự đổi sang cách viết khác dù thấy "hay hơn"; chỉ áp dụng quy tắc trên cho nhân vật CHƯA có trong danh sách. `+
    `TRỪ MỘT NGOẠI LỆ: nếu "name" đã có sẵn đó trong danh sách "đã biết" là văn bản gốc chữ Hán nhưng vẫn còn sót lại ký tự chữ Hán/Trung Quốc chưa phiên âm (do lần trước bỏ sót), thì lần này BẮT BUỘC phải dịch tên đó sang Hán Việt ngay.\n`+
    `- Nếu nhân vật hoàn toàn KHÔNG có tên riêng nào được nêu trong toàn bộ nội dung đọc được (chỉ được nhắc tới qua quan hệ/chức danh, VD "cha của X", "quản gia", "một tên lính gác"), vẫn PHẢI đặt 1 "name" ngắn gọn để lưu (VD "Cha của Thẩm Quan", "Quản gia phủ họ Lâm") — nhưng nếu identifier này có nhắc tới TÊN của nhân vật khác, BẮT BUỘC dùng đúng "name" ĐÃ ĐƯỢC DỊCH (Hán Việt hoặc tên phương Tây theo quy tắc trên) của người đó, TUYỆT ĐỐI KHÔNG chèn nguyên chữ Hán/Trung Quốc của người đó vào identifier này dù chỉ 1 phần — quy tắc "TUYỆT ĐỐI CẤM còn sót chữ Hán" ở trên áp dụng cho CẢ loại "name" tự đặt kiểu này.\n`+
    `- "originalName": chữ/cách viết gốc của nhân vật đó xuất hiện trong đoạn văn bản đang đọc (chữ Hán nếu gốc là tiếng Trung; để trống nếu văn bản gốc không phải chữ Hán và trùng với "name"), dùng để đối chiếu nhận diện nhân vật ở các chương sau.\n`+
    `- "note": CHỈ ghi khi trong chương này có ĐẶC ĐIỂM NHẬN DẠNG cố định, lâu dài của nhân vật được xác nhận rõ ràng — dùng để phân biệt/gộp đúng người khi trùng tên `+
    `(VD hợp lệ: "Trưởng lão phái Thanh Vân", "có sẹo dài bên má trái", "tên thật là Lâm Mộ", "xuất thân từ Bắc Cương"). Tối đa ~20 từ, viết dạng cụm từ, không viết thành câu kể.\n`+
    `- TUYỆT ĐỐI KHÔNG ghi vào "note": hành động, lời thoại, cảm xúc, suy nghĩ, hay bất kỳ sự việc/diễn biến nào đang xảy ra trong chương `+
    `(VD CẤM ghi: "vừa đánh bại kẻ địch", "đang tức giận vì bị phản bội", "quyết định rời khỏi môn phái", "gặp lại người yêu cũ"). Đây KHÔNG phải nhật ký tóm tắt chương — chỉ là thẻ nhận dạng nhân vật.\n`+
    `- Nếu chương này không có đặc điểm nhận dạng mới nào (chỉ có hành động/sự kiện thông thường), BẮT BUỘC để "note":"" — KHÔNG cố gắng tóm tắt hay ghi lại bất cứ điều gì đã xảy ra với nhân vật đó. `+
    `Không lặp lại thông tin đã có sẵn trong "note" của nhân vật đó ở danh sách đã biết, không suy đoán, không bịa.\n`+
    `- "statusCue": mô tả NGẮN về VAI VẾ/ĐỊA VỊ của nhân vật này trong bối cảnh truyện, dùng để suy đoán xưng hô cho đúng — TUỲ THEO THỂ LOẠI mà chọn đúng loại thông tin: `+
    `truyện tu tiên/kiếm hiệp dùng cảnh giới tu luyện hoặc bối phận môn phái (VD "Kim Đan kỳ", "Trưởng lão", "đệ tử ngoại môn"); `+
    `truyện quan trường/công sở/học đường có hệ thống cấp bậc dùng chức vụ (VD "Tổng giám đốc", "Trưởng phòng", "Giáo viên chủ nhiệm"); `+
    `truyện cung đấu/cổ trang dùng thân phận (VD "Nhị hoàng tử", "Quý phi", "Đại tướng quân"); `+
    `truyện đô thị/hiện đại không có yếu tố đặc biệt nào ở trên thì dùng nhóm tuổi tác, chọn đúng mốc phù hợp với nhân vật `+
    `(VD từ nhỏ đến lớn: "trẻ sơ sinh/em bé", "thiếu nhi/nhi đồng" (~3-10 tuổi), "thiếu niên" (~11-15 tuổi, học sinh cấp 2), "học sinh cấp 3" (~16-18 tuổi), `+
    `"thanh niên" (~18-30 tuổi), "trung niên" (~40-55 tuổi), "cao niên/lão niên/người già" (~60 tuổi trở lên)). `+
    `CHỈ ghi khi có bằng chứng rõ ràng trong văn bản, để "" nếu không xác định được. Không lặp lại y nguyên nội dung đã có trong "note".\n`+
    `- "correction": CHỈ dùng khi trong danh sách "đã biết" ở trên, nhân vật này ĐÃ CÓ SẴN giá trị gender/relationship/addrThemToMc/addrMcToThem (khác "Chưa rõ"), `+
    `NHƯNG nội dung chương này đưa ra bằng chứng TRỰC TIẾP, RÕ RÀNG, KHÔNG THỂ HIỂU KHÁC rằng giá trị cũ đó SAI và cần sửa lại `+
    `(VD: nhân vật trước đó bị coi là nam nhưng chương này lộ rõ là nữ giả trai/cải trang; trước đó tưởng là "kẻ thù" nhưng chương này xác nhận trực tiếp là "huynh đệ thất lạc"). `+
    `LƯU Ý QUAN TRỌNG: khi nhân vật này TRỰC TIẾP gọi nhân vật chính (hoặc TỰ XƯNG) bằng một DANH XƯNG TỰ THÂN NÓ ĐÃ HÀM Ý RÕ MỘT LOẠI QUAN HỆ CỤ THỂ trong lời thoại — bất kể thể loại/văn phong nào, `+
    `cổ trang/tu tiên (VD "sư phụ", "lão sư", "nghĩa phụ", "phu quân", "chủ nhân", "thiếu chủ") hay đô thị/hiện đại/công sở (VD "sếp", "giám đốc" khi gọi cấp trên trực tiếp, "chồng"/"vợ", "má nuôi"/"ba nuôi", "thầy"/"cô" khi là giáo viên trực tiếp dạy nhân vật chính, "khách hàng" khi là quan hệ mua-bán trực tiếp) — `+
    `mà "relationship" đã lưu đang là giá trị KHÁC hẳn hoặc mơ hồ hơn (VD "Người qua đường", "Chưa rõ", "Kẻ thù", "Đồng nghiệp"), đây CŨNG được tính là bằng chứng trực tiếp đủ ngưỡng để sửa, giống hệt ví dụ gender/relationship ở trên — không chỉ dừng ở việc cập nhật addrThemToMc/addrMcToThem. `+
    `Ngược lại, những từ xưng hô chỉ mang sắc thái THÂN MẬT/XA CÁCH chung chung mà KHÔNG tự nó chỉ rõ một loại quan hệ cụ thể (VD "ngươi/ta" chuyển sang gọi thẳng tên, "anh/em" phiếm chỉ) thì CHỈ tính là thay đổi addressing, KHÔNG được suy ra thành correction cho relationship. `+
    `NGOẠI LỆ CẦN CẢNH GIÁC — "xưng hô THAY": tiếng Việt/văn hoá Á Đông có thói quen một người lớn gọi ai đó theo ĐÚNG VAI VẾ của con/em/cháu mình để giữ phép lịch sự trong gia đình, dù bản thân người nói KHÔNG có quan hệ đó (VD người mẹ gọi giáo viên của con là "thầy"/"cô" dù bản thân không phải học trò; người anh gọi sư phụ của em trai là "lão sư" theo đúng vai của em). Nếu văn bản chương này cho thấy danh xưng đó là gọi THAY cho quan hệ của một nhân vật khác (con/em/cháu...) chứ không phải quan hệ của chính người đang nói, TUYỆT ĐỐI KHÔNG suy ra correction cho relationship của người nói — trường hợp này vẫn có thể cộng dồn vào addrThemToMc/addrMcToThem như bình thường (vì họ thực sự có gọi câu đó), nhưng để relationship() giữ nguyên giá trị cũ. Chỉ áp dụng correction cho relationship khi có căn cứ rằng danh xưng đó phản ánh đúng quan hệ CỦA CHÍNH người đang nói với nhân vật chính. `+
    `Khi đúng trường hợp danh xưng chỉ rõ quan hệ như trên, PHẢI đặt cả "relationship" bằng giá trị mới (VD "Đệ tử", "Cấp dưới", "Vợ") VÀ "correction":{"relationship":true,"addressing":true,"reason":"..."} trong CÙNG một lượt, không được chỉ sửa xưng hô mà bỏ quên relationship. `+
    `Riêng "correction":{"addressing":true} có NGƯỠNG THẤP HƠN HẲN so với gender/relationship: chỉ cần chương này có LỜI THOẠI TRỰC TIẾP THẬT giữa 2 người, thể hiện RÕ một cách xưng hô KHÁC với "addrThemToMc"/"addrMcToThem" đã lưu — `+
    `dù chỉ là một sắc thái nhẹ hơn/ấm hơn một chút (VD đang xưng "ta/ngươi" mà câu thoại chương này chuyển sang gọi thẳng tên, hoặc chỉ 1-2 câu xưng "muội/ca ca" xen giữa những câu khác vẫn còn trang trọng) — `+
    `KHÔNG cần đợi một bước ngoặt tình tiết hẳn hoi kiểu giảng hoà/lộ thân phận như gender/relationship mới được đặt correction cho addressing. `+
    `Hễ có bằng chứng lời thoại thật khác với dữ liệu cũ là đặt "correction":{"addressing":true,"reason":"..."} và cập nhật lại 2 field xưng hô theo đúng câu chữ vừa đọc được — việc quyết định CỘNG DỒN thêm cách gọi mới hay THAY HẲN cách gọi cũ (nếu sắc thái đã đổi khác hẳn) do hệ thống lưu trữ tự xử lý sau khi nhận correction, AI không cần tự cân nhắc phần đó, cứ báo đúng những gì đọc được trong chương này. `+
    `Tương tự, nếu "narrRef" đã lưu không còn khớp với cách văn bản chương này thực sự gọi nhân vật đó ở ngôi thứ 3 (VD trước ghi "Chưa rõ" nay đã xác định được giới tính để suy đoán đại từ phù hợp, `+
    `hoặc trước chỉ có "hắn" nhưng đoạn tường thuật theo góc nhìn khác trong chương này còn cho thấy thêm biến thể "tên đó"), đặt "correction":{"narrRef":true,"reason":"..."} và cập nhật "narrRef" cho đầy đủ hơn (bổ sung, không xoá lựa chọn cũ trừ khi nó sai hẳn). `+
    `Nếu đúng trường hợp gender/relationship kể trên: đặt field "gender" (và/hoặc "relationship") ở trên bằng giá trị ĐÃ SỬA, đồng thời "correction":{"gender":true,"reason":"lý do ngắn gọn, VD: lộ thân phận nữ giả nam trang"}. `+
    `TUYỆT ĐỐI KHÔNG đặt correction:{"gender":true} hay {"relationship":true} chỉ vì suy luận khác với dữ liệu cũ, thấy mơ hồ, hoặc không chắc chắn 100% — trường hợp đó BẮT BUỘC giữ nguyên y hệt giá trị cũ (ngưỡng chặt này KHÔNG áp dụng cho "addressing", xem ngoại lệ riêng ở trên). `+
    `Correction cho gender/relationship là ngoại lệ hiếm, chỉ dùng khi chương văn bản TRỰC TIẾP phủ nhận thông tin cũ; correction cho addressing thì phổ biến hơn nhiều, cứ có lời thoại thật khác đi là dùng được, không cần bằng chứng nặng ký như gender/relationship.\n`+
    `- "merges": CHỈ dùng để báo cáo khi bạn phát hiện CHẮC CHẮN, có bằng chứng rõ ràng trong TOÀN BỘ nội dung chương này, rằng 2 (hoặc nhiều) nhân vật KHÁC NHAU `+
    `trong danh sách "đã biết" ở trên (không phải nhân vật mới chỉ vừa xuất hiện) thực ra LÀ CÙNG MỘT NGƯỜI — ví dụ chương này tiết lộ tên thật của một người trước giờ `+
    `chỉ được biết qua biệt danh/ngoại hiệu, hoặc xác nhận trực tiếp "X chính là Y". Mỗi mục: "keep" là tên chính (name) của nhân vật nên GIỮ LẠI (ưu tiên tên đã có nhiều thông tin/quen thuộc hơn), `+
    `"duplicates" là mảng tên chính (name) của (các) nhân vật trùng cần gộp vào. TUYỆT ĐỐI KHÔNG đoán mò hay suy luận lỏng lẻo — nếu không chắc chắn 100%, KHÔNG báo cáo (để mảng rỗng []). `+
    `Không tự tạo entry cho nhân vật mới trong "merges", chỉ dùng cho các tên đã có trong danh sách "đã biết".\n`+
    `- "relationship" là mối quan hệ của nhân vật đó với NHÂN VẬT CHÍNH của truyện, ghi NGẮN GỌN chỉ tên mối quan hệ, KHÔNG thêm cụm "của nhân vật chính" `+
    `(VD ghi "Mẫu thân", "Sư phụ", "Sư tỷ", "Phụ thân", "Bạn thân", "Kẻ thù", "Đồng nghiệp", "Hàng xóm"... — không ghi "Mẫu thân của nhân vật chính"). Dùng "Chưa rõ" nếu không đủ căn cứ.\n`+
    `- TUYỆT ĐỐI CẤM ghi CHỨC VỤ/NGHỀ NGHIỆP/CHỨC DANH của nhân vật đó vào "relationship" `+
    `(VD CẤM ghi vào relationship: "giáo viên toán trường Hoa Sư Nhất", "lớp trưởng lớp thể dục", "bảo vệ trường", "học sinh"...) — đây là lỗi rất hay gặp, PHẢI tránh tuyệt đối. `+
    `Nghề nghiệp/chức vụ chỉ được lưu vào "note" hoặc "statusCue" (nếu là đặc điểm nhận dạng cố định), KHÔNG BAO GIỜ được lưu vào "relationship". `+
    `Nghề nghiệp CHỈ được phép xuất hiện trong "relationship" khi chính nó LÀ mối quan hệ trực tiếp với nhân vật chính `+
    `(VD nhân vật chính là học sinh và người này trực tiếp DẠY nhân vật chính → được ghi "Giáo viên"; nhân vật chính là nhân viên và người này là quản lý trực tiếp → được ghi "Cấp trên"). `+
    `Nếu nhân vật đó chỉ đơn thuần làm việc/học cùng nơi với nhân vật chính nhưng KHÔNG có bằng chứng tương tác/quan hệ cụ thể nào với nhân vật chính, ghi "Đồng nghiệp" (nếu cùng làm) hoặc "Chưa rõ" — TUYỆT ĐỐI KHÔNG lấy chức danh của họ làm relationship chỉ vì không tìm được quan hệ nào khác.\n`+
    `- TUYỆT ĐỐI CẤM ghi vào "relationship" mối quan hệ của nhân vật đó với MỘT NHÂN VẬT PHỤ KHÁC (không phải nhân vật chính) `+
    `(VD CẤM ghi "vợ của Trần Đông Tích" nếu Trần Đông Tích không phải là nhân vật chính của truyện). `+
    `"relationship" LUÔN LUÔN chỉ được tính theo NHÂN VẬT CHÍNH; quan hệ giữa các nhân vật phụ với nhau (nếu cần lưu để nhận dạng) thì ghi vào "note", không ghi vào "relationship". `+
    `Nếu không xác định được quan hệ trực tiếp nào giữa nhân vật đó và nhân vật chính, BẮT BUỘC để "relationship":"Chưa rõ" — không được thay thế bằng bất kỳ thông tin nào khác (nghề nghiệp, quan hệ với người khác...) chỉ vì thiếu dữ kiện.\n`+
    `- "addrThemToMc": cách nhân vật này XƯNG HÔ khi trực tiếp nói chuyện với NHÂN VẬT CHÍNH — trả về MỘT MẢNG, mỗi phần tử là 1 lựa chọn xưng hô đầy đủ, `+
    `dạng object CÓ CẤU TRÚC RÕ RÀNG {"self":"<nhân vật này TỰ XƯNG gì>","callsMc":"<nhân vật này GỌI nhân vật chính là gì>"} — KHÔNG dùng chuỗi tự do kèm dấu "/" như định dạng cũ, `+
    `để tránh nhầm lẫn giữa phần tự xưng và phần gọi đối phương ngay từ lúc bạn sinh ra kết quả. `+
    `VD chỉ có 1 lựa chọn: [{"self":"muội","callsMc":"ca ca"}]. `+
    `Nếu chương cho thấy họ dùng NHIỀU cách xưng hô khác nhau tuỳ ngữ cảnh (VD lúc thân mật, lúc nghiêm túc) và cả 2 cách đều xuất hiện rõ ràng, `+
    `thêm từng object ĐẦY ĐỦ vào mảng (VD [{"self":"muội","callsMc":"ca ca"},{"self":"tiểu muội","callsMc":"đại ca"}]) — TUYỆT ĐỐI KHÔNG trộn "self" của lựa chọn này với "callsMc" của lựa chọn khác. `+
    `"addrMcToThem": ngược lại — cách NHÂN VẬT CHÍNH xưng hô khi nói với nhân vật này, CÙNG kiểu mảng object nhưng field thứ 2 tên là "callsThem" thay vì "callsMc": {"self":"<nhân vật chính TỰ XƯNG gì>","callsThem":"<nhân vật chính GỌI nhân vật này là gì>"}. `+
    `CHỈ điền khi trong chương có LỜI THOẠI trực tiếp giữa 2 người này thể hiện rõ cách xưng hô — không suy đoán từ ngôi kể chuyện hay từ cách người khác gọi họ. `+
    `Nếu chương không có đoạn hội thoại trực tiếp nào giữa họ, để MẢNG RỖNG [] cho cả 2 field — TUYỆT ĐỐI KHÔNG bịa theo quan hệ (VD không tự suy "là kẻ thù nên chắc chắn xưng ta/ngươi"). `+
    `Nếu chỉ xác định chắc chắn được 1 trong 2 phần của 1 lựa chọn (VD chỉ biết "callsMc" mà không rõ "self"), để phần còn lại là chuỗi rỗng "" trong CHÍNH object đó — KHÔNG bịa thêm cho đủ cặp, KHÔNG bỏ hẳn lựa chọn đó. `+
    `Khi cần CHỌN xưng hô cụ thể phù hợp (có hội thoại nhưng cách xưng hô chưa rõ ràng), ưu tiên dựa vào "statusCue"/vai vế trong bối cảnh truyện (cảnh giới tu luyện, chức vụ, thân phận...) nếu xác định được, `+
    `chỉ dùng tuổi tác thuần tuý làm căn cứ khi không có yếu tố vai vế nào khác rõ ràng hơn (VD truyện đô thị/hiện đại không có yếu tố tu luyện/chức vụ đặc biệt). `+
    `⚠ BẮT BUỘC — không được để trống khi CÓ hội thoại trực tiếp: nếu chương này xác nhận CÓ ít nhất 1 lượt lời thoại trực tiếp giữa nhân vật này và nhân vật chính, nhưng bản gốc lược chủ ngữ/tân ngữ hoặc xưng hô quá mơ hồ để trích xuất chính xác cặp cụ thể, TUYỆT ĐỐI KHÔNG để cả 2 field là mảng rỗng — PHẢI tự suy đoán tối thiểu 1 cặp thuộc nhóm sắc thái "Trung tính" (VD {"self":"tôi","callsMc":"cậu"} hoặc {"self":"ta","callsMc":"ngươi"}, xem thêm biến thể trong CHARMEM_ADDR_TONE_EXAMPLES) làm "đường nền" an toàn, dựa trên "relationship" và độ tuổi/vai vế suy ra được từ "statusCue" của cả 2 bên — rồi đặt "addrEvidence":"suy đoán" cho trường hợp này. Chỉ được để mảng rỗng đúng khi chương THỰC SỰ không có bất kỳ lượt thoại trực tiếp nào giữa 2 người (lúc đó "addrEvidence" phải là "không có hội thoại" như đã nêu ở trên). `+
    `⚠ ĐA DẠNG HOÁ NGAY CẢ KHI ĐÃ CÓ CẶP CỤ THỂ: quy tắc "Trung tính" ở trên chỉ là đường nền cho lúc KHÔNG trích được cặp nào — nhưng dù ĐÃ trích được 1 cặp cụ thể mang sắc thái đặc thù/thân phận/tôn ti từ hội thoại thật (VD "phu nhân/phu quân", "sư phụ/đệ tử", "tiểu thư/quản gia", các danh xưng chức vụ...), nếu cặp đó có "addrTone" KHÁC "Trung tính" VÀ mối quan hệ giữa 2 người thuộc dạng có thể hợp lý chuyển qua lại giữa xưng hô trang trọng và xưng hô đời thường tuỳ ngữ cảnh (VD vợ chồng, người yêu, bạn bè, anh em/đồng môn thân thiết, đồng nghiệp qua lại thân mật...), BẮT BUỘC bổ sung THÊM ít nhất 1 lựa chọn thuộc nhóm "Trung tính" vào CUỐI mảng, giữ nguyên cặp cụ thể đã có (KHÔNG xoá, KHÔNG thay thế) — mục đích là cung cấp nhiều biến thể xưng hô hơn để bước dịch sau này chọn đúng theo từng ngữ cảnh cụ thể trong chương, thay vì chỉ có duy nhất 1 cách gọi trang trọng xuyên suốt. CHỈ được bỏ qua việc bổ sung này khi: (a) cặp đã trích ra vốn dĩ đã thuộc nhóm "Trung tính", hoặc (b) bản chất mối quan hệ KHÔNG hợp lý để chuyển sang xưng hô trung tính (VD kẻ thù/xa cách hẳn, quan hệ chủ-tớ hoặc quân-thần nghiêm ngặt theo đúng bối cảnh truyện bắt buộc giữ tôn ti tuyệt đối, không có tình huống nào trong truyện cho phép nói chuyện xuề xoà). `+
    `⚠ NGÔN NGỮ CỦA "self"/"callsMc"/"callsThem" — áp dụng quy tắc CHẶT y hệt quy tắc "name" ở trên: NẾU văn bản gốc là chữ Hán/Trung Quốc, TUYỆT ĐỐI CẤM copy nguyên văn chữ Hán vào bất kỳ phần nào của các object xưng hô — PHẢI chuyển sang tiếng Việt trước khi điền vào field. `+
    `Với xưng hô Hán-Việt đã trở thành ước lệ quen thuộc trong truyện dịch (VD 哥哥→"ca ca"/"đại ca", 妹妹→"muội muội"/"tiểu muội", 师兄→"sư huynh", 前辈→"tiền bối"), giữ dạng phiên âm Hán Việt quen thuộc đó, KHÔNG dịch nghĩa cứng sang thuần Việt. `+
    `Với các cách xưng hô là TỪ GHÉP/CỤM CÓ NGHĨA cụ thể theo chức danh/nghề nghiệp (VD 保安哥哥 = "bảo vệ" + "ca ca") chứ không phải 1 xưng hô Hán-Việt ước lệ đơn lẻ, MẶC ĐỊNH dịch nghĩa tự nhiên sang tiếng Việt (VD 保安哥哥→"anh bảo vệ", 小妹妹→"em gái nhỏ"/"cô bé") — TRỪ KHI phần "CHỈ DẪN THÊM từ prompt dịch chính" ở trên (nếu có) xác nhận RÕ RÀNG truyện muốn giữ phong cách xưng hô Hán Việt/kiểu Trung (VD dặn dùng ca ca/tỷ tỷ/huynh muội thay vì anh/chị/em), thì lúc đó GIỮ phần chức danh ở dạng Hán Việt (phiên âm nếu là từ đã quen dùng dạng Hán Việt, hoặc dùng từ Hán Việt tương đương nếu có) rồi ghép với phần xưng hô ước lệ, thay vì Việt hoá toàn bộ cụm (VD 保安哥哥→"bảo vệ ca ca" thay vì "anh bảo vệ"). Dù theo nhánh nào, TUYỆT ĐỐI KHÔNG để nguyên cụm chữ Hán dù chỉ 1 phần — nhánh "giữ phong cách Hán Việt" vẫn phải phiên âm/dịch hết, không phải cái cớ để chừa lại chữ Hán gốc. `+
    `Đây là lỗi rất hay gặp (khác hẳn "name" đã được nhắc kỹ, field xưng hô này dễ bị bỏ sót) — PHẢI tự kiểm tra lại: nếu bất kỳ ký tự nào trong "self"/"callsMc"/"callsThem" vẫn còn là chữ Hán, đó là lỗi và phải sửa trước khi trả về kết quả.\n`+
    `- "addrEvidence": TỰ KHAI BÁO trung thực độ chắc chắn của 2 field xưng hô vừa điền ở trên — CHỈ được chọn 1 trong 3 giá trị cố định: `+
    `"trực tiếp" (có ít nhất 1 câu THOẠI TRỰC TIẾP thật giữa 2 người thể hiện rõ cách xưng hô vừa điền), `+
    `"suy đoán" (không có thoại trực tiếp đủ rõ, nhưng bạn vẫn suy đoán dựa vào quan hệ/vai vế/văn phong thể loại), `+
    `hoặc "không có hội thoại" (chương này không có đoạn thoại trực tiếp nào giữa 2 người — khi đó cả 2 field xưng hô ở trên PHẢI là mảng rỗng). `+
    `Hệ thống dùng field này để quyết định có cần đọc lại kỹ hơn hay không — TUYỆT ĐỐI KHÔNG chọn "trực tiếp" chỉ vì muốn kết quả trông chắc chắn hơn thực tế.\n`+
    `- "addrTone": xếp NHÓM sắc thái của cặp xưng hô addrThemToMc/addrMcToThem vừa xác định — CHỈ được chọn 1 trong các giá trị cố định: `+
    `${CHARMEM_ADDR_TONES.join(', ')}, hoặc "Chưa rõ" nếu cả 2 field xưng hô ở trên đều là mảng rỗng. `+
    `LƯU Ý khi mảng có NHIỀU lựa chọn khác nhóm sắc thái (VD vừa có cặp cụ thể vừa có cặp "Trung tính" bổ sung theo quy tắc ĐA DẠNG HOÁ ở trên): "addrTone" LUÔN LUÔN phản ánh nhóm sắc thái của lựa chọn ĐẦU TIÊN/CHÍNH (cặp có bằng chứng/mang sắc thái đặc thù nhất, không phải cặp "Trung tính" bổ sung thêm) — vì hệ thống dùng field này (dạng số ít) để theo dõi quan hệ có đổi hẳn nhóm sắc thái hay không giữa các chương, không phải liệt kê tất cả sắc thái đang có trong mảng.\n`+
    `- "narrRef": HOÀN TOÀN KHÁC addrThemToMc/addrMcToThem — 2 field đó là xưng hô khi nhân vật này NÓI CHUYỆN TRỰC TIẾP với nhân vật chính; `+
    `còn "narrRef" là (các) ĐẠI TỪ/CÁCH GỌI NGÔI THỨ 3 PHIẾM CHỈ mà lời văn TƯỜNG THUẬT dùng để chỉ nhân vật này, hoặc khi MỘT NGƯỜI KHÁC (không phải đang nói trực tiếp với họ) nhắc tới họ — CHỈ cần TRUNG TÍNH theo giới tính là đủ (VD "hắn"/"anh ta"/"y" cho nhân vật Nam, "nàng"/"cô ấy"/"thị" cho nhân vật Nữ), có thể kèm thêm vài biến thể phiếm chỉ khác sắc thái nhẹ như thân mật/suồng sã (VD "gã", "cô ta") hay xa cách/thù địch (VD "lão ta", "tên đó", "mụ", "con nhỏ đó") tuỳ góc nhìn tường thuật. `+
    `TUYỆT ĐỐI KHÔNG ghi các DANH XƯNG/CHỨC DANH KÍNH NGỮ CỤ THỂ như "ngài", "đại nhân", "bệ hạ", "tiền bối", "các hạ" — đây là XƯNG HÔ mang tính chức danh/địa vị, thuộc phạm vi addrThemToMc/addrMcToThem nếu xuất hiện trong hội thoại trực tiếp, KHÔNG PHẢI đại từ ngôi 3 phiếm chỉ nên không thuộc narrRef. `+
    `Vì đây là field chỉ cần đại từ TRUNG TÍNH/phiếm chỉ, được phép TỰ SUY ĐOÁN lựa chọn phù hợp dựa trên giới tính nhân vật, thể loại truyện và văn phong của đoạn tường thuật, KHÔNG cần bằng chứng chặt như addrEvidence — đây vốn là field mang tính GỢI Ý cho bước dịch chọn từ hợp ngữ cảnh, không phải field cần trích dẫn chính xác 1 câu chữ cụ thể.\n`+
    `TUYỆT ĐỐI KHÔNG ghi CÂU/CỤM MIÊU TẢ NGOẠI HÌNH, TRANG PHỤC hay ĐẶC ĐIỂM NHẬN DẠNG (VD "người mặc áo bào đen, khuôn mặt che kín", "gã đàn ông có vết sẹo dài trên má", "cô gái áo đỏ"), và cũng KHÔNG ghi biệt hiệu/biệt danh riêng (VD "Hắc y nhân", "Chu Tước vương") dù bản gốc dùng cách này để chỉ nhân vật — những cách gọi đó không phải đại từ phiếm chỉ trung tính, dễ lỗi thời khi tình tiết đổi; nếu không xác định được giới tính để chọn đại từ phù hợp, để "narrRef":"Chưa rõ".\n`+
    `TUYỆT ĐỐI CẤM copy y nguyên giá trị "relationship" (VD nhân vật có relationship="Sư tỷ") vào "narrRef" chỉ vì đó là mối quan hệ đã biết — đây là lỗi rất hay gặp, PHẢI tránh. `+
    `Ví dụ: nhân vật là "Sư tỷ" của nhân vật chính, nhưng khi tường thuật/kể chuyện, bản gốc dùng đại từ trung tính (VD tương đương "nàng") để chỉ cô ấy — trường hợp này PHẢI ghi "narrRef":"nàng" (đúng đại từ trung tính đang dùng), TUYỆT ĐỐI KHÔNG ghi "Sư tỷ" (đó là relationship, không phải đại từ ngôi 3 thật).\n`+
    `Nếu chương cho thấy nhân vật này có thể được gọi ngôi 3 theo NHIỀU SẮC THÁI KHÁC NHAU tuỳ góc nhìn/ngữ cảnh (VD phần lớn dùng trung tính "hắn", nhưng đoạn tường thuật theo góc nhìn kẻ thù dùng "tên đó"), `+
    `liệt kê TẤT CẢ các lựa chọn hợp lý, cách nhau bởi dấu phẩy (VD "hắn, tên đó") — không cần gắn nhãn phe/nhóm sắc thái, chỉ cần liệt kê đủ các đại từ phiếm chỉ phù hợp; `+
    `bước dịch sau này sẽ tự chọn lựa chọn phù hợp theo góc nhìn của đoạn văn đang dịch. Nếu không xác định được giới tính nhân vật để suy đoán đại từ phù hợp, để "Chưa rõ".\n`+
    `- Các bằng chứng sau ĐƯỢC TÍNH LÀ ĐỦ RÕ RÀNG để xác định giới tính, không cần chờ mô tả ngoại hình hay tên riêng: `+
    `danh xưng/xưng hô chỉ rõ giới tính (sư huynh/sư tỷ/sư đệ/sư muội, ca ca/tỷ tỷ/đệ đệ/muội muội, công tử/cô nương/tiểu thư/phu nhân/lão gia, thúc thúc/thẩm thẩm; `+
    `từ xưng hô gia đình: cha/ba/bố/phụ thân/gia phụ/ông nội/ông ngoại = Nam, mẹ/má/mẫu thân/gia mẫu/nương/bà nội/bà ngoại = Nữ, anh trai = Nam, chị gái = Nữ), `+
    `đại từ nhân xưng ngôi thứ 3 rõ giới tính (nàng, hắn, y, thị...), hoặc nhân vật tự xưng/được xác nhận trực tiếp là nam/nữ. `+
    `TUYỆT ĐỐI KHÔNG suy đoán/bịa giới tính hoặc quan hệ nếu bản gốc không cung cấp MỘT TRONG các bằng chứng trên — trong trường hợp đó hãy dùng "Chưa rõ".\n`+
    `- NHÂN VẬT CHÍNH dùng làm mốc tính "relationship" đã được nêu rõ ở đầu prompt này (mục "NHÂN VẬT CHÍNH của truyện..." hoặc mục tự suy luận nếu chưa xác định) — `+
    `luôn dùng ĐÚNG người đó, không tự đổi sang người khác dù chương này người đó ít xuất hiện. Ghi relationship NGẮN GỌN theo mốc đó `+
    `(VD "Phụ thân", "Sư tỷ" — không ghi thêm "của nhân vật chính"). KHÔNG tự gắn nhãn "chính"/"bản thân" cho field relationship của chính nhân vật chính đó (field này người dùng sẽ tự đánh dấu qua modal), `+
    `chỉ dùng nó làm mốc tham chiếu khi ghi relationship cho NHỮNG NGƯỜI KHÁC.\n`+
    `- Nếu bản gốc gọi cùng 1 nhân vật bằng 2 tên khác nhau ở 2 chỗ khác nhau trong CÙNG chương này (VD lỗi biên tập/dịch thô: "Ryan" và "Lai Ân" chỉ cùng 1 người) `+
    `và có đủ ngữ cảnh để khẳng định chắc chắn, chỉ trả về MỘT entry duy nhất dùng tên xuất hiện nhiều/rõ nghĩa hơn. Nếu không chắc chắn, coi là 2 nhân vật riêng — không đoán mò.\n`+
    `- Nếu không có nhân vật nào đủ rõ ràng, trả về {"characters":[]}.\n\n`+
    `Danh sách nhân vật đã biết từ trước, có kèm "aliases" là các tên gọi khác của CÙNG một người `+
    `(nếu nhân vật trong chương khớp với tên chính hoặc bất kỳ alias nào, hãy dùng ĐÚNG "name" chính này, `+
    `không tạo tên mới/biến thể; CHỈ liệt kê lại y nguyên, không cần suy luận lại, đối với những nhân vật đã có sẵn giá trị gender/relationship KHÁC "Chưa rõ"; `+
    `còn nhân vật nào trong danh sách này đang là "Chưa rõ" thì vẫn PHẢI cố gắng suy luận lại từ nội dung chương hiện tại, vì có thể chương này mới cung cấp đủ bằng chứng. `+
    `RIÊNG với nhân vật có "needsTranslation":true — nghĩa là "name" đang lưu VẪN CÒN SÓT chữ Hán/Trung Quốc chưa dịch — quy tắc "dùng lại y nguyên tên đã có" Ở TRÊN KHÔNG ÁP DỤNG cho riêng field "name" của nhân vật đó: `+
    `BẮT BUỘC phải dịch "name" sang Hán Việt (hoặc phục hồi tên phương Tây gốc nếu đúng là tên âm dịch — xem quy tắc "name" bên dưới) ngay trong lượt này, TUYỆT ĐỐI KHÔNG trả về lại y hệt chữ Hán đã có trong "name" của danh sách đã biết này, dù các field khác (gender/relationship/...) vẫn giữ nguyên như hướng dẫn):\n`+
    (known.length?JSON.stringify(known):'(chưa có dữ liệu)')+`\n\n`+
    `LƯU Ý ĐỊNH DẠNG: các giá trị "addrThemToMc"/"addrMcToThem" trong danh sách "đã biết" ở trên chỉ là chuỗi rút gọn kiểu "tự xưng/gọi đối phương" để bạn THAM KHẢO ngữ cảnh đã lưu trước đó — `+
    `khi TRẢ VỀ kết quả mới cho 2 field này trong "characters" bên dưới, BẮT BUỘC dùng đúng định dạng MẢNG OBJECT có cấu trúc rõ ràng như hướng dẫn chi tiết đã nêu ở trên, TUYỆT ĐỐI KHÔNG trả về dạng chuỗi "self/other" cũ.`;
  return sys+`\n\n---\n`+chapterTextForAnalysis+`\n\n---\nHãy trả JSON theo đúng yêu cầu ở trên.`;
}

// ===== CHUẨN HOÁ SCHEMA CÓ CẤU TRÚC (model trả về) VỀ CHUỖI LƯU TRỮ NỘI BỘ (bằng code JS thuần) =====
function normKey(s){return (s||'').trim().toLowerCase();}
// Model giờ trả addrThemToMc/addrMcToThem dưới dạng MẢNG OBJECT {self, callsMc|callsThem} (xem
// buildCharExtractPrompt) — tách self/other RÕ RÀNG ngay từ lúc sinh ra, không còn phải suy luận từ
// dấu "/" trong 1 chuỗi tự do. Hàm này chuyển mảng object đó về ĐÚNG định dạng chuỗi "self/other,
// self2/other2..." mà toàn bộ phần còn lại của hệ thống (lưu trữ, modal sửa, prompt dịch,
// splitAddrCandidates/parseAddrChoice...) đang dùng — nhờ vậy chỉ cần đổi CÁCH MODEL SINH RA dữ
// liệu, không phải viết lại toàn bộ pipeline lưu trữ/hiển thị đã có.
// otherKey: 'callsMc' (dùng cho addrThemToMc) hoặc 'callsThem' (dùng cho addrMcToThem).
function structuredAddrToString(raw,otherKey){
  if(typeof raw==='string')return raw; // model lỡ trả về chuỗi cũ (không tuân prompt) -> giữ nguyên, các hàm isAddrUnknown/splitAddrCandidates vẫn đọc được
  if(!Array.isArray(raw)||!raw.length)return 'Chưa rõ';
  const parts=raw.map(o=>{
    if(!o||typeof o!=='object')return '';
    const self=(o.self||'').toString().trim();
    const other=(o[otherKey]||'').toString().trim();
    if(!self&&!other)return '';
    // LỚP AN TOÀN CUỐI: model đôi khi lỡ copy nguyên chữ Hán vào "self"/otherKey dù prompt đã
    // yêu cầu BẮT BUỘC dịch sang tiếng Việt (xem buildCharExtractPrompt) — thà bỏ hẳn lựa chọn
    // xưng hô này (coi như "Chưa rõ") còn hơn lưu lại chữ Hán vào bộ nhớ nhân vật, vì dữ liệu
    // đó sẽ bị đem thẳng vào prompt dịch chính ở buildCharacterContextText, gây lỗi y hệt màn
    // hình "Thông tin nhân vật" hiện chữ Hán trong ô xưng hô.
    if(containsCJK(self)||containsCJK(other)){
      console.warn('[CharMem] Bỏ 1 lựa chọn xưng hô vì model còn để sót chữ Hán:',{self,other});
      return '';
    }
    if(self&&other)return `${self}/${other}`;
    return other||self; // chỉ biết 1 phần -> ghi đúng phần đó, không bịa phần còn lại
  }).filter(Boolean);
  return parts.length?parts.join(', '):'Chưa rõ';
}
// Chuyển 1 entry "characters" thô từ model (schema có cấu trúc) về dạng mà mergeAnalysisResults/
// applyCharField đang mong đợi (addrThemToMc/addrMcToThem là CHUỖI) — gọi ngay sau khi parse JSON,
// trước khi chạy heuristic nghi vấn hay merge vào S.characters. addrEvidence/addrTone giữ nguyên
// để detectAddrSuspicion bên dưới dùng.
function normalizeExtractedCharacter(f){
  if(!f||typeof f!=='object')return f;
  return {...f,
    addrThemToMc:structuredAddrToString(f.addrThemToMc,'callsMc'),
    addrMcToThem:structuredAddrToString(f.addrMcToThem,'callsThem')
  };
}

// ===== BẮT NGHI VẤN BẰNG CODE (không tốn thêm lượt gọi AI) =====
// Vài từ xưng hô TRỰC TIẾP (tự xưng, hoặc được gọi thẳng) mang sắc thái giới tính RÕ RÀNG trong
// tiếng Việt — dùng chung tinh thần với CHARMEM_NARRREF_GENDER_HINTS (khai báo cùng nhóm bên dưới
// cho narrRef) nhưng đây là bảng RIÊNG cho lời THOẠI TRỰC TIẾP (addrThemToMc/addrMcToThem), vì bộ
// từ dùng khi xưng hô trực tiếp (huynh/muội/thiếp...) khác hẳn bộ đại từ tường thuật (hắn/nàng...).
// Chỉ đưa vào các từ CHẮC CHẮN 1 giới, để tránh chặn nhầm những từ trung tính/dùng chung (ta, ngươi,
// tại hạ, con, cháu...).
const CHARMEM_SELFADDR_GENDER_HINTS={
  'thiếp':'Nữ','muội':'Nữ','tiểu muội':'Nữ','a muội':'Nữ','nô gia':'Nữ','bổn cô nương':'Nữ','nương nương':'Nữ',
  'huynh':'Nam','tiểu đệ':'Nam','đại ca':'Nam','bổn thiếu gia':'Nam','bổn công tử':'Nam','tại hạ huynh đệ':'Nam'
};
function selfAddrGenderHint(word){return CHARMEM_SELFADDR_GENDER_HINTS[normAddrWord(word)]||null;}
// Lấy các từ MÔ TẢ CHÍNH NHÂN VẬT ĐANG XÉT từ 1 field xưng hô đã chuẩn hoá thành chuỗi: với
// addrThemToMc đó là phần "self" (họ tự xưng); với addrMcToThem đó là phần "other" (MC gọi họ).
function collectCharSelfTerms(addrString,part){
  if(isAddrUnknown(addrString))return [];
  return splitAddrCandidates(addrString).map(cand=>parseAddrChoice(cand)[part]).filter(Boolean);
}
// Trả về MẢNG LÝ DO (string) nếu 1 nhân vật vừa trích xuất CẦN xác minh lại bằng 1 lượt gọi AI
// riêng — mảng rỗng nghĩa là đủ tin cậy, dùng thẳng không cần xác minh thêm. So sánh với 3 nguồn:
// chính bằng chứng model tự khai (addrEvidence), giới tính đã biết, và dữ liệu ĐÃ LƯU của nhân vật
// đó (existing).
function detectAddrSuspicion(f,existing){
  const reasons=[];
  const evidence=(f.addrEvidence||'').trim();
  const hasAddrValue=!isAddrUnknown(f.addrThemToMc)||!isAddrUnknown(f.addrMcToThem);
  if(hasAddrValue&&(evidence==='suy đoán'||evidence==='không có hội thoại')){
    reasons.push(`model tự khai addrEvidence="${evidence}" nhưng vẫn điền xưng hô cụ thể`);
  }
  // Chiều NGƯỢC LẠI: model tự khai bằng chứng "trực tiếp"/"suy đoán" (tức nhận là CÓ hội thoại)
  // nhưng lại để cả 2 field xưng hô rỗng — vi phạm thẳng quy tắc BẮT BUỘC ở buildCharExtractPrompt
  // (phải tự suy đoán tối thiểu 1 cặp "Trung tính" làm đường nền khi có hội thoại nhưng mơ hồ,
  // xem hướng dẫn "⚠ BẮT BUỘC" trong prompt trích xuất). Bắt bằng code (tự-mâu-thuẫn trong chính
  // output, không cần đọc lại văn bản gốc) rồi đẩy qua lượt xác minh có sẵn (verifyFlaggedCharacters
  // có gửi kèm văn bản gốc) để model xác minh tự chọn cặp phù hợp ngữ cảnh — KHÔNG hardcode cứng 1
  // cặp mặc định ở tầng code vì code không có statusCue/relationship/thể loại để chọn đúng biến thể.
  if(!hasAddrValue&&(evidence==='trực tiếp'||evidence==='suy đoán')){
    reasons.push(`model tự khai addrEvidence="${evidence}" nhưng lại để trống xưng hô — vi phạm quy tắc bắt buộc phải suy đoán tối thiểu 1 cặp "Trung tính"`);
  }
  const gender=(f.gender&&f.gender!=='Chưa rõ')?f.gender:(existing&&existing.gender&&existing.gender!=='Chưa rõ'?existing.gender:null);
  if(gender){
    const termsAboutThisChar=[
      ...collectCharSelfTerms(f.addrThemToMc,'self'),    // họ tự xưng khi nói với MC
      ...collectCharSelfTerms(f.addrMcToThem,'other')    // MC gọi họ là gì
    ];
    termsAboutThisChar.forEach(term=>{
      const hint=selfAddrGenderHint(term);
      if(hint&&hint!==gender)reasons.push(`xưng hô "${term}" mang sắc thái giới tính ${hint}, lệch với giới tính ${gender} đã xác định`);
    });
  }
  // So với dữ liệu ĐÃ LƯU: nếu nhân vật đã có xưng hô ổn định từ trước và chương này đề xuất 1 nhóm
  // sắc thái (addrTone) KHÁC HẲN mà model KHÔNG tự đặt correction.addressing — model có thể đã âm
  // thầm "trôi" khỏi dữ liệu cũ mà không nhận ra đó là 1 thay đổi cần báo cáo.
  if(existing&&isEstablishedAddrChar(existing)){
    const corr=(f.correction&&typeof f.correction==='object')?f.correction:{};
    const newTone=(f.addrTone||'').trim();
    if(!corr.addressing&&addrToneSameGroup(existing.addrTone,newTone)===false){
      reasons.push(`sắc thái xưng hô mới ("${newTone}") khác hẳn nhóm đã lưu ("${existing.addrTone}") nhưng không kèm correction.addressing`);
    }
  }
  return reasons;
}
// Gọi 1 lượt AI XÁC MINH — CHỈ gửi đúng những nhân vật bị code flag nghi vấn (không phải toàn bộ
// chương), kèm lý do nghi vấn cụ thể + văn bản gốc để model tự đối chiếu lại. Chỉ tốn thêm 1 lượt
// gọi khi CÓ nghi vấn thật, và model xác minh luôn so với BẰNG CHỨNG (văn bản gốc). Không throw —
// lỗi thì trả về [] và applyVerifiedOverrides() sẽ tự giữ nguyên đề xuất ban đầu.
async function verifyFlaggedCharacters(flagged,ch,keys,promptGuidance,model){
  if(!flagged.length)return [];
  try{
    console.log(`[Luồng 1][Xác minh] Code phát hiện ${flagged.length} nhân vật có dấu hiệu nghi vấn — gọi xác minh lại...`);
    const protagonist=S.characters.find(c=>isCharProtagonist(c));
    const protagonistLine=protagonist
      ?`Nhân vật chính của truyện đã được xác định là: "${protagonist.name}". Dùng CHÍNH XÁC người này làm mốc khi xác định "relationship" bên dưới.\n\n`
      :`Chưa xác định được nhân vật chính cụ thể — tự suy luận dựa vào người kể chuyện ngôi thứ nhất ("ta","tôi") hoặc nhân vật trung tâm của chương, rồi dùng người đó làm mốc.\n\n`;
    const guidanceLine=promptGuidance
      ?`CHỈ DẪN THÊM từ prompt dịch chính của người dùng (chỉ tham khảo, ưu tiên thấp hơn bằng chứng thật trong văn bản gốc bên dưới):\n${promptGuidance}\n\n`
      :'';
    const list=flagged.map(x=>({
      name:x.item.name,originalName:x.item.originalName,
      de_xuat:{gender:x.item.gender,relationship:x.item.relationship,addrThemToMc:x.item.addrThemToMc,addrMcToThem:x.item.addrMcToThem,addrTone:x.item.addrTone,narrRef:x.item.narrRef},
      nghi_van:x.reasons
    }));
    const prompt=`Bạn là bước XÁC MINH LẠI kết quả trích xuất nhân vật vừa thực hiện cho 1 chương truyện. Hệ thống (bằng code, không phải AI) đã phát hiện các nhân vật dưới đây có dấu hiệu nghi vấn (xem "nghi_van" của từng người) cần đọc lại văn bản gốc để xác nhận hoặc sửa lại. `+
      `Với MỖI nhân vật, đối chiếu "de_xuat" (đề xuất ban đầu) với văn bản gốc bên dưới, rồi trả về giá trị ĐÚNG NHẤT — giữ nguyên đề xuất cũ nếu xác nhận đúng, hoặc sửa lại nếu văn bản gốc cho thấy khác.\n\n`+
      protagonistLine+guidanceLine+
      `"addrTone" CHỈ được chọn 1 trong các giá trị: ${CHARMEM_ADDR_TONES.join(', ')}, hoặc "Chưa rõ". `+
      `"relationship" LUÔN tính theo nhân vật chính nêu trên, KHÔNG phải với nhân vật phụ khác, và KHÔNG được là chức vụ/nghề nghiệp trừ khi chính nó là quan hệ trực tiếp với nhân vật chính.\n\n`+
      `DANH SÁCH CẦN XÁC MINH:\n${JSON.stringify(list)}\n\n`+
      `Chỉ trả về JSON, không thêm văn bản/giải thích/markdown fence nào khác. PHẢI có đủ 1 entry cho MỖI nhân vật trong danh sách trên, dùng đúng "name" đã cho, addrThemToMc/addrMcToThem dùng ĐÚNG định dạng mảng object có cấu trúc như sau (KHÔNG dùng chuỗi "self/other" cũ):\n`+
      `{"characters":[{"name":"...","gender":"Nam"|"Nữ"|"Chưa rõ","relationship":"...","addrThemToMc":[{"self":"...","callsMc":"..."}],"addrMcToThem":[{"self":"...","callsThem":"..."}],"addrEvidence":"trực tiếp"|"suy đoán"|"không có hội thoại","addrTone":"...","narrRef":"...","correction":{"gender":true|false,"relationship":true|false,"addressing":true|false,"narrRef":true|false,"reason":"..."}}]}\n\n`+
      `VĂN BẢN GỐC CỦA CHƯƠNG:\n${cleanCensorChars(ch.content).slice(0,20000)}`;
    const messages=[{role:'user',parts:[{text:prompt}]}];
    const rawText=await callCharModel(keys,model,messages,CHAR_ANALYSIS_TIMEOUT_MS);
    const parsed=parseCharacterJSON(rawText);
    const resolved=(parsed&&Array.isArray(parsed.characters))?parsed.characters.map(normalizeExtractedCharacter):[];
    console.log('[Luồng 1][Xác minh] Xác minh hoàn tất.');
    return resolved;
  }catch(e){
    console.log('[Luồng 1][Xác minh] Xác minh lỗi — giữ nguyên đề xuất ban đầu:',e.message||e);
    return [];
  }
}
// Ghi đè kết quả đã xác minh (nếu có) trở lại vào danh sách "found" gốc, theo đúng "name". Nhân vật
// không nằm trong danh sách xác minh (không bị flag, hoặc model xác minh bỏ sót) giữ nguyên đề xuất
// ban đầu — không có gì để mất so với luồng cũ.
function applyVerifiedOverrides(found,verified){
  if(!verified.length)return found;
  return found.map(f=>{
    const v=verified.find(x=>normKey(x.name)===normKey(f.name));
    if(!v)return f;
    return {...f,...v,name:f.name,originalName:f.originalName||v.originalName||'',sinoAlias:f.sinoAlias||v.sinoAlias||''};
  });
}

// Trả về mảng các character object (đã merge vào S.characters) xuất hiện trong chương này.
// Không bao giờ throw — mọi lỗi đều bị nuốt, chỉ log console, để không chặn dịch.
async function analyzeChapterCharacters(chapterIdx){
  try{
    if(!getCharMemOn())return [];
    const ch=S.chapters[chapterIdx];
    if(!ch)return [];
    const keys=getKeys();
    if(!keys.length)return [];
    console.log(`[Luồng 1][Phân tích chương] Analyzing chapter ${chNum(chapterIdx)}...`);

    const chapterTextForAnalysis=cleanCensorChars(ch.content).slice(0,20000);
    const promptGuidance=await getMainPromptGuidance();
    const promptText=buildCharExtractPrompt(chapterTextForAnalysis,promptGuidance);
    const messages=[{role:'user',parts:[{text:promptText}]}];

    // 1 LƯỢT GỌI DUY NHẤT cho cả Gemini lẫn DeepSeek. Với DeepSeek (chỉ có 1 model), model dự phòng
    // để trống — lỗi là bỏ qua luôn, không có gì để thử lại.
    const isDeepseek=getProvider()==='deepseek';
    const primaryModel=isDeepseek?getModel():CHAR_MODEL_B;
    const fallbackModel=isDeepseek?null:CHAR_MODEL_A;
    const verifyModel=isDeepseek?getModel():CHAR_MODEL_B;

    let rawText;
    try{
      rawText=await callCharModel(keys,primaryModel,messages,CHAR_ANALYSIS_TIMEOUT_MS);
    }catch(e){
      if(!fallbackModel){
        console.log('[Luồng 1][Phân tích chương] Lỗi gọi API — bỏ qua chương này:',e.message||e);
        return [];
      }
      console.log('[Luồng 1][Phân tích chương] Model chính lỗi/timeout, thử model dự phòng...',e.message||e);
      try{
        rawText=await callCharModel(keys,fallbackModel,messages,CHAR_ANALYSIS_TIMEOUT_MS);
      }catch(e2){
        console.log('[Luồng 1][Phân tích chương] Cả model chính lẫn model dự phòng đều lỗi — bỏ qua chương này:',e2.message||e2);
        return [];
      }
    }
    let parsed=parseCharacterJSON(rawText);
    let found=parsed&&Array.isArray(parsed.characters)?parsed.characters:null;
    // JSON không parse được KHÔNG PHẢI lỗi gọi API (request vẫn thành công, model chỉ trả sai định
    // dạng — VD dư/thiếu dấu ngoặc) nên nhánh try/catch phía trên không bắt được trường hợp này —
    // trước bản sửa này, gặp là bỏ luôn chương dù còn model dự phòng chưa dùng tới. Garbled JSON
    // thường chỉ là lỗi phát sinh 1 lượt (không phải lỗi hệ thống như 503 ở trên), nên đáng thử lại
    // ĐÚNG 1 lần: có fallbackModel (Gemini) thì dùng fallback — đỡ lặp lại đúng kiểu lỗi format của
    // model chính; không có fallback (DeepSeek chỉ 1 model) thì thử lại CHÍNH model đó 1 lần.
    if(!found){
      const retryModel=fallbackModel||primaryModel;
      console.log(`[Luồng 1][Phân tích chương] Model trả JSON không parse được, thử lại 1 lần với ${retryModel}... Raw:`,rawText);
      try{
        const retryRaw=await callCharModel(keys,retryModel,messages,CHAR_ANALYSIS_TIMEOUT_MS);
        parsed=parseCharacterJSON(retryRaw);
        found=parsed&&Array.isArray(parsed.characters)?parsed.characters:null;
        if(!found){
          console.log('[Luồng 1][Phân tích chương] Thử lại vẫn không parse được — bỏ qua chương này. Raw:',retryRaw);
          return [];
        }
      }catch(e3){
        console.log('[Luồng 1][Phân tích chương] Lỗi gọi API khi thử lại — bỏ qua chương này:',e3.message||e3);
        return [];
      }
    }
    // Chuyển schema có cấu trúc (addrThemToMc/addrMcToThem dạng mảng object) về chuỗi lưu trữ nội
    // bộ NGAY LẬP TỨC, trước khi chạy heuristic hay merge — phần còn lại của pipeline (heuristic,
    // mergeAnalysisResults, applyCharField...) chỉ cần biết đúng 1 định dạng chuỗi như trước giờ.
    found=found.map(normalizeExtractedCharacter);

    // ===== CODE TỰ BẮT NGHI VẤN =====
    const flagged=[];
    found.forEach(f=>{
      const name=(f.name||'').trim();
      if(!name)return;
      const existing=findCharByNameOrAlias(name)||(f.originalName?findCharByNameOrAlias(f.originalName):null)||(f.sinoAlias?findCharByNameOrAlias(f.sinoAlias):null);
      const reasons=detectAddrSuspicion(f,existing);
      if(reasons.length)flagged.push({item:f,reasons});
    });
    if(flagged.length){
      const verified=await verifyFlaggedCharacters(flagged,ch,keys,promptGuidance,verifyModel);
      found=applyVerifiedOverrides(found,verified);
    }

    console.log(`[Luồng 1][Phân tích chương] Found ${found.length} characters.`);
    const merges=Array.isArray(parsed.merges)?parsed.merges:[];
    if(merges.length){
      console.log(`[Luồng 1][Phân tích chương] Detected ${merges.length} duplicate group(s) to merge.`);
      applyAutoMerges(merges);
    }
    const appeared=mergeAnalysisResults(found,chapterIdx);
    await saveCharacterMemory();
    console.log(`[Luồng 1][Phân tích chương] Completed.`);
    return appeared;
  }catch(e){
    console.log('[Luồng 1][Phân tích chương] Unexpected error — skipping:',e.message||e);
    return [];
  }
}

// ===================================================================
// ===== SOÁT XƯNG HÔ SAU KHI DỊCH XONG (dùng chung công tắc Character Memory) =====
// ===================================================================
// Khác với analyzeChapterCharacters() (chạy TRƯỚC khi dịch, đọc VĂN BẢN GỐC để thu thập dữ liệu
// nhân vật/xưng hô rồi nhét vào prompt dịch) — hàm này chạy SAU khi dịch xong, đọc chính BẢN DỊCH
// vừa ra để bắt lỗi model dịch tự "trôi"/quên mất xưng hô đã được dặn (hay gặp ở chương dài, càng
// về cuối càng dễ lẫn). Không dịch lại cả chương — chỉ yêu cầu model chỉ ra ĐÚNG câu sai (trích
// nguyên văn) + câu đã sửa, rồi tool tự thay thế bằng find-and-replace theo CÂU TRỌN VẸN (không phải
// theo từ đơn lẻ như "ngươi"/"ta" — những từ này dùng chung bởi rất nhiều nhân vật/lời trần thuật
// trong cùng 1 chương, thay theo từ sẽ sửa nhầm hàng loạt chỗ không liên quan).
function isEstablishedAddrChar(c){
  return (c.addrThemToMc&&!isAddrUnknown(c.addrThemToMc))||
    (c.addrMcToThem&&!isAddrUnknown(c.addrMcToThem))||
    (c.narrRef&&!isNarrRefUnknown(c.narrRef));
}
// Nhân vật có "Mối quan hệ" (với MC) hoặc "Vai vế/địa vị" đã ghi nhận — đủ để model TỰ SUY ĐOÁN
// xưng hô hợp thể loại khi 2 nhân vật PHỤ (không phải cặp với MC) thoại trực tiếp với nhau, dù
// kiến trúc lưu trữ hiện tại KHÔNG có bảng xưng hô 2 chiều cho cặp phụ-phụ (chỉ addrThemToMc/
// addrMcToThem giữa từng nhân vật với MC). KHÔNG lưu lại kết quả suy đoán này — chỉ dùng cho riêng
// audit của chương hiện tại, vì mục đích thật sự chỉ là bắt chỗ model dịch chính lỡ quên dặn (xưng
// hô hiện đại/sai vai vế), không phải xây thêm 1 nguồn dữ liệu xưng hô mới cần đồng bộ giữa các chương.
function hasPeerAddrContext(c){
  return (c.relationship&&!isUnknownVal(c.relationship))||(c.statusCue&&c.statusCue.trim());
}

// ===================================================================
// ===== KIỂM TRA CƠ HỌC CHO "fixes" CỦA auditChapterAddressing =====
// ===================================================================
// Trước bản sửa này, MỘT fix xưng hô chỉ được chấp nhận/loại dựa vào việc "before" có khớp DUY NHẤT
// 1 lần trong văn bản hay không (applyAddressFixes) — mọi lý do NGỮ NGHĨA (đúng phạm vi narrRef,
// đúng giới tính, đúng pattern ngữ pháp...) hoàn toàn dựa vào việc AI có tuân đúng prompt hay không,
// không có gì để code tự đối chiếu lại. Khối dưới đây thêm field "type"/"characterName"/
// "referentGender" vào schema (xem buildAddressAuditPrompt) để code tự kiểm tra CHÉO — không tin
// nguyên văn "reason" AI viết ra, chỉ tin những gì đo/đếm được trực tiếp trên chính văn bản hoặc đối
// chiếu với dữ liệu nhân vật đã lưu. Thêm loại "type" mới BẮT BUỘC viết kèm 1 nhánh kiểm tra tương
// ứng trong validateAuditFixes bên dưới — không chỉ thêm vào danh sách rồi bỏ mặc cho AI tự giác.
// ĐÃ THU HẸP PHẠM VI (xem thảo luận): bỏ hẳn các type cần code/AI tự xác định "nhân vật này là ai"
// rồi đối chiếu với gender/relationship/narrRef đã lưu (addr_dialogue, narr_ref, gender_mismatch) —
// đây chính là nguồn gây sửa NHẦM NGƯỜI (2 nhân vật trùng 1 phần tên nhưng khác record vẫn bị AI gộp
// nhầm khi tự khai "characterName"), vì code chỉ kiểm tra được AI có tự mâu thuẫn với chính nó hay
// không, không kiểm tra được AI có NHẬN DIỆN ĐÚNG NGƯỜI hay không. Bỏ luôn "grammar_position" (không
// phải lỗi xưng hô/sắc thái, thực tế gần như luôn bị loại ở validateAuditFixes).
// GIỮ 2 type THUẦN "sắc thái theo thể loại" — không cần biết nhân vật cụ thể là ai, không tra cứu
// gender/relationship đã lưu: narration_pronoun (đối chiếu NỘI BỘ, lệch so với phần còn lại của
// chương) và genre_tone (từ bản sửa sau: đối chiếu với HỆ XƯNG HÔ CHUẨN theo thể loại của chương —
// báo & SỬA cả khi cả chương lỡ dùng sai hệ, không chỉ khi có vài câu lệch so với số đông — xem giải
// thích ở buildAddressAuditPrompt).
// THÊM LẠI "chinh_ta" (đã từng bị bỏ vì tưởng có bước KIỂM TRA BẢN DỊCH khác đảm nhiệm — thực tế
// KHÔNG tồn tại bước nào khác trong toàn bộ pipeline dịch làm việc này, nên chính tả trước giờ chưa
// hề được soát) và THÊM MỚI "sot_dich" (text tiếng Trung/Anh còn sót lại chưa được dịch sang tiếng
// Việt) — cả 2 đều có kiểm tra cơ học riêng bên dưới (isSpellingOnlyFix cho chinh_ta,
// containsCJK/looksLikeUntranslatedEnglish cho sot_dich), cùng nguyên tắc "không tin AI tự khai, chỉ
// tin những gì đo/đếm được" như 2 type còn lại.
const AUDIT_FIX_TYPES=['narration_pronoun','genre_tone','chinh_ta','sot_dich'];

// Xác định vị trí idx trong text có đang nằm TRONG dấu ngoặc kép (lời thoại) hay không, bằng cách đếm
// dấu ngoặc mở/đóng xuất hiện TRƯỚC vị trí đó — thuần cơ học trên chính chuỗi ký tự, không hỏi lại AI.
// Dùng cho type "narr_ref": theo đúng "PHẠM VI ÁP DỤNG narrRef" đã nêu trong establishedSection ở
// trên, field này CHỈ áp dụng cho lời tường thuật NẰM NGOÀI dấu ngoặc kép — nếu "before" model trích
// ra lại đang nằm ngay trong lời thoại, đó là bằng chứng model đã tự vi phạm đúng phạm vi nó vừa được
// dặn, bất kể "reason" viết thuyết phục thế nào. Xử lý 2 kiểu ngoặc hay gặp trong bản dịch: ngoặc kép
// thẳng " (không phân biệt mở/đóng -> đếm số lần xuất hiện, lẻ = đang ở trong) và ngoặc kép cong
// “ ”/«  » (phân biệt rõ mở/đóng -> đếm lệch cặp mở nhiều hơn đóng = đang ở trong).
function isInsideQuote(text,idx){
  const before=text.slice(0,idx);
  const straightCount=(before.match(/"/g)||[]).length;
  if(straightCount%2===1)return true;
  const openCurly=(before.match(/[“„«]/g)||[]).length;
  const closeCurly=(before.match(/[”»]/g)||[]).length;
  return openCurly>closeCurly;
}
// "before" có thể không khớp CHÍNH XÁC trong text (lệch khoảng trắng/xuống dòng — xem
// buildLooseWhitespaceRegex ở applyAddressFixes) nhưng vẫn sẽ được ÁP DỤNG THẬT nhờ cơ chế khớp nới
// lỏng đó. Nếu isInsideQuote chỉ tra bằng text.indexOf(before) (khớp tuyệt đối) thì gặp đúng trường
// hợp lệch khoảng trắng này sẽ trả về -1 và BỊ COI LÀ "không xác định được vị trí" -> bỏ qua luôn
// kiểm tra ngoặc kép -> 1 fix narr_ref sai phạm vi (nằm trong lời thoại) vẫn lọt qua rồi được áp dụng
// thật ở bước sau bằng đúng cơ chế nới lỏng đó. Hàm này tìm vị trí THẬT SẼ ĐƯỢC DÙNG ĐỂ ÁP DỤNG (thử
// khớp tuyệt đối trước, không có thì thử regex nới lỏng khoảng trắng y hệt applyAddressFixes) rồi mới
// kiểm tra ngoặc kép tại đúng vị trí đó — khớp >1 lần (mơ hồ, applyAddressFixes cũng sẽ bỏ qua) thì
// không đoán, coi như không xác định được.
function findLikelyApplyIndex(text,before){
  const wordBoundaryOnly=!/\s/.test(before);
  const exact=findMatchPositions(text,before,wordBoundaryOnly);
  if(exact.length===1)return exact[0];
  if(exact.length===0){
    const re=buildLooseWhitespaceRegex(before);
    if(re){
      const matches=[...text.matchAll(re)];
      if(matches.length===1)return matches[0].index;
    }
  }
  return -1;
}

// Pattern cơ học cho type "grammar_position" (xem pronounAsNounSection): đại từ ngôi thứ 3 đứng sát
// 1 cụm lượng từ/chỉ định kiểu "một/loại/dạng/kẻ/người/hạng ~ như vậy/này/đó/ấy" ở 1 trong 2 thứ tự
// hay gặp khi dịch sát tiếng Trung: "một NÀNG như vậy" (đại từ ở giữa) hoặc "dạng này NÀNG" (đại từ ở
// cuối). Đây chỉ là 1 heuristic (không bắt được mọi biến thể câu chữ có thể có), nhưng đủ để chặn
// trường hợp model tự gắn type:"grammar_position" cho 1 câu KHÔNG hề chứa pattern này — khả năng cao
// là model đang lạm dụng type này để lách qua luật chặt hơn của các type khác (VD đổi hẳn xưng hô
// nhưng dán nhãn ngữ pháp cho có vẻ "an toàn").
const GRAMMAR_POS_RE=/(một|loại|dạng|kẻ|người|hạng)\s*(như vậy|như thế|này|đó|ấy)?\s*(nàng ta|hắn ta|nàng|hắn|y|thị|gã)\s*(như vậy|như thế|này|đó|ấy)?/i;
function matchesGrammarPositionPattern(before){
  if(!before)return false;
  const m=GRAMMAR_POS_RE.exec(before);
  if(!m)return false;
  return !!(m[2]||m[4]); // phải có ít nhất 1 cụm chỉ định thật đi kèm, không chỉ trùng ngẫu nhiên lượng từ+đại từ đứng cạnh nhau vì lý do khác
}

// Đối chiếu "referentGender" AI tự khai trong 1 fix với giới tính ĐÃ LƯU của đúng nhân vật đó (qua
// "characterName") — nếu lệch, đây là bằng chứng model đang tự mâu thuẫn với chính dữ liệu nó vừa
// được đọc (mục "DANH SÁCH GIỚI TÍNH ĐÃ BIẾT" trong prompt), không cần tin phần "reason" giải thích
// thêm. Không xác định được nhân vật hoặc nhân vật chưa có giới tính lưu sẵn -> không có gì để đối
// chiếu, coi là không mâu thuẫn (tránh loại oan khi thiếu dữ liệu).
function referentGenderMismatch(fx){
  if(!fx||!fx.characterName||!fx.referentGender)return false;
  const c=findCharByNameOrAlias(fx.characterName);
  if(!c||!c.gender||c.gender==='Chưa rõ')return false;
  const norm=v=>(v||'').normalize('NFC').trim().toLowerCase();
  return norm(c.gender)!==norm(fx.referentGender);
}

// LƯỚI AN TOÀN CHÍNH — chạy TRƯỚC applyAddressFixes, lọc theo "type" AI tự gắn cho từng fix bằng
// đúng 3 kiểm tra cơ học ở trên. Không đụng gì tới quy tắc so khớp "before" (đó vẫn do
// applyAddressFixes lo, xem đoạn count===1) — hàm này chỉ loại các fix mà chính "type" đã tự mâu
// thuẫn với bằng chứng đo được, trước khi tốn công so khớp/thay thế.
function validateAuditFixes(text,fixes){
  const kept=[],dropped=[];
  (fixes||[]).forEach(fx=>{
    const type=fx&&fx.type;
    const before=(fx&&fx.before||'').trim();
    const after=fx&&typeof fx.after==='string'?fx.after.trim():'';
    if(!before){dropped.push({fx,why:'thiếu "before"'});return;}
    // "type" là field BẮT BUỘC (xem buildAddressAuditPrompt) — model tự bịa giá trị lạ hoặc bỏ trống
    // đều là dấu hiệu không tuân đúng schema, KHÔNG được lọt qua.
    if(!type||!AUDIT_FIX_TYPES.includes(type)){
      dropped.push({fx,why:`"type" thiếu hoặc không hợp lệ ("${type}") — không thuộc danh sách cho phép (narration_pronoun/genre_tone/chinh_ta/sot_dich)`});
      return;
    }
    // narration_pronoun/genre_tone: tự đối chiếu NỘI BỘ trong chính chương, không tra cứu
    // characterName/gender đã lưu — không có kiểm tra cơ học riêng nào khác ngoài whitelist type ở
    // trên (các hàm hỗ trợ isInsideQuote/matchesGrammarPositionPattern/referentGenderMismatch giữ lại
    // trong file phòng khi cần dùng lại, nhưng KHÔNG còn được gọi ở đây).
    if(type==='chinh_ta'){
      // Chỉ chấp nhận fix ĐÚNG LÀ lỗi gõ nhỏ (số từ khác nhau ít, mỗi từ khác chỉ lệch vài ký tự) —
      // chặn model lợi dụng "chinh_ta" để viết lại cả câu dưới danh nghĩa sửa lỗi gõ.
      if(!isSpellingOnlyFix(before,after)){
        // LỐI THOÁT CÓ ĐIỀU KIỆN: 1 từ tiếng Anh lẫn nguyên vào câu tiếng Việt (VD "with" thay vì
        // "với") vẫn có thể bị model gắn nhầm type="chinh_ta" (nhìn bề ngoài giống lỗi gõ 1 từ),
        // trong khi Levenshtein per-word giữa 1 từ Latin thuần và 1 từ tiếng Việt có dấu tự nhiên
        // đã cao (VD lev("with","với")=4), khiến isSpellingOnlyFix loại oan. Dùng lại ĐÚNG kiểm tra
        // cơ học của type "sot_dich" (before chứa hư từ tiếng Anh thật — xem looksLikeRealEnglishSentence)
        // làm lối thoát ở đây: vẫn là bằng chứng đo được trên chuỗi ký tự, không tin AI tự khai,
        // chỉ đổi CĂN CỨ chấp nhận cho đúng bản chất lỗi (từ tiếng Anh sót lại) thay vì đòi hỏi
        // edit-distance thấp vốn chỉ đúng cho lỗi gõ tiếng Việt thuần.
        if(!looksLikeRealEnglishSentence(before)){
          dropped.push({fx,why:'type="chinh_ta" nhưng before/after khác nhau quá nhiều để là lỗi gõ thật (nghi model đang viết lại câu)'});
          return;
        }
      }
    }
    if(type==='sot_dich'){
      // Chỉ chấp nhận khi "before" THỰC SỰ chứa chữ Hán, hoặc chứa hư từ tiếng Anh chứng tỏ đây là 1
      // câu/cụm có ý nghĩa cần dịch — không phải chỉ 1 tên riêng tiếng Anh bị model nhầm là "sót dịch".
      if(!containsCJK(before)&&!looksLikeRealEnglishSentence(before)){
        dropped.push({fx,why:'type="sot_dich" nhưng "before" không chứa chữ Hán lẫn hư từ tiếng Anh nào — nghi chỉ là 1 tên riêng bị nhầm thành text sót dịch'});
        return;
      }
    }
    kept.push(fx);
  });
  return {kept,dropped};
}

// Dùng cho type "chinh_ta" (xem chinhTaSection/validateAuditFixes): giới hạn chặt để field này không
// biến thành cửa sau cho AI viết lại nguyên câu dưới danh nghĩa "sửa lỗi gõ". Quy tắc: số từ khác
// nhau giữa before/after phải ít (mặc định tối đa 2 từ), và MỖI từ khác nhau phải là lỗi gõ nhỏ thật
// sự (Levenshtein <=2), không phải 1 từ hoàn toàn khác nghĩa.
function levenshtein(a,b){
  a=a||'';b=b||'';
  const m=a.length,n=b.length;
  if(!m)return n; if(!n)return m;
  const dp=new Array(n+1);
  for(let j=0;j<=n;j++)dp[j]=j;
  for(let i=1;i<=m;i++){
    let prev=dp[0];dp[0]=i;
    for(let j=1;j<=n;j++){
      const tmp=dp[j];
      dp[j]=a[i-1]===b[j-1]?prev:1+Math.min(prev,dp[j],dp[j-1]);
      prev=tmp;
    }
  }
  return dp[n];
}
function isSpellingOnlyFix(before,after,maxChangedWords,maxEditDistancePerWord){
  maxChangedWords=maxChangedWords||2;
  maxEditDistancePerWord=maxEditDistancePerWord||2;
  const wb=(before||'').trim().split(/\s+/);
  const wa=(after||'').trim().split(/\s+/);
  if(wb.length!==wa.length)return false; // chính tả thật không đổi số lượng từ trong câu
  let changed=0;
  for(let i=0;i<wb.length;i++){
    if(wb[i]===wa[i])continue;
    changed++;
    if(changed>maxChangedWords)return false;
    if(levenshtein(wb[i],wa[i])>maxEditDistancePerWord)return false;
  }
  return changed>0;
}
// Dùng cho type "sot_dich" (xem sotDichSection/validateAuditFixes): kiểm tra cơ học để phân biệt
// "còn sót thật" (cần sửa) với "chỉ là 1 tên riêng tiếng Anh cố tình giữ nguyên" (KHÔNG được sửa —
// đúng yêu cầu gốc "không bao gồm tên tiếng Anh"). Không thể phân biệt tuyệt đối bằng code thuần,
// nhưng dùng 1 tín hiệu khá đáng tin: 1 CÂU/CỤM tiếng Anh THẬT (có ý cần dịch) hầu như luôn chứa ít
// nhất 1 hư từ/từ chức năng tiếng Anh phổ biến (mạo từ, đại từ, giới từ, động từ nối...) — còn 1 TÊN
// RIÊNG (người/địa danh/tên skill-vật phẩm giữ nguyên chủ ý) thường chỉ là 1-2-3 từ viết hoa đứng
// liền nhau, không có hư từ nào xen giữa. VD "John Smith" -> không khớp hư từ nào -> coi là tên riêng,
// bỏ qua; "He is my brother" -> khớp "he/is/my" -> chắc chắn là câu thật, không phải tên riêng.
const ENGLISH_FUNCTION_WORD_RE=/\b(the|a|an|is|are|was|were|am|be|been|being|and|but|or|not|no|this|that|these|those|with|from|have|has|had|will|would|can|could|should|shall|must|may|might|you|your|yours|he|him|his|she|her|hers|they|them|their|we|us|our|it|its|i|me|my|mine|to|of|in|on|at|for|as|by|what|who|whom|when|where|why|how|do|does|did|so|if|then|than|too|very|just|please|thank|thanks|sorry|okay|ok|yes|damn|hell|god|shit|fuck)\b/i;
function looksLikeRealEnglishSentence(s){
  return ENGLISH_FUNCTION_WORD_RE.test(s||'');
}

// ĐÃ THIẾT KẾ LẠI (xem thảo luận): bước soát xưng hô này KHÔNG còn nhận "appearedChars" để tự đối
// chiếu gender/relationship/narrRef của TỪNG nhân vật cụ thể nữa — mọi lỗi loại đó (gọi nhầm người
// do 2 nhân vật trùng 1 phần tên, gán sai giới tính, gán sai narrRef...) đã cho thấy code không có
// cách nào kiểm chứng được AI có "nhận diện đúng người" hay không, chỉ kiểm chứng được AI có tự mâu
// thuẫn với chính nó hay không — hai việc khác hẳn nhau. Việc đảm bảo xưng hô ĐÚNG TỪNG NHÂN VẬT nay
// chuyển hẳn sang cho bước DỊCH CHÍNH tự làm đúng ngay từ đầu (bằng cách được cấp bộ nhớ nhân vật làm
// ngữ cảnh khi dịch — xem buildCharacterContextForTranslation), không phải việc "sửa lại sau" của
// bước soát này nữa.
// Bước soát này gồm 4 việc, mỗi việc có kiểm tra cơ học riêng (xem validateAuditFixes) — KHÔNG tra
// cứu gender/relationship/narrRef đã lưu của bất kỳ ai (2 type sắc thái tự đối chiếu NỘI BỘ trong
// chính văn bản; 2 type còn lại đối chiếu trực tiếp trên chuỗi ký tự) nên không có nguy cơ nhầm người:
// 1. narration_pronoun: đại từ ngôi 3 TRUNG TÍNH khi tường thuật (hắn/nàng vs anh ấy/cô ấy) có bị
//    lẫn tông so với phần còn lại của chương hay không.
// 2. genre_tone: xưng hô trong LỜI THOẠI (huynh/tỷ/đệ/muội vs anh/em/chị...) có bị lẫn tông so với
//    phần còn lại của chương hay không.
// 3. chinh_ta: lỗi gõ/chính tả tiếng Việt thật sự (không phải lựa chọn từ ngữ/văn phong).
// 4. sot_dich: đoạn tiếng Trung/Anh còn sót lại CHƯA được dịch sang tiếng Việt, KHÔNG tính tên riêng
//    tiếng Anh cố tình giữ nguyên.
function buildAddressAuditPrompt(translatedText,promptGuidance){
  const pronounSection=`KIỂM TRA 1 — ĐẠI TỪ NGÔI THỨ 3 TRUNG TÍNH KHI TƯỜNG THUẬT (type:"narration_pronoun"): `+
    `tự đọc và suy luận thể loại/bối cảnh của CHÍNH chương này (VD tu tiên/huyền huyễn/cổ trang/kiếm hiệp Trung Hoa thường dùng "hắn/nàng/y/thị/gã..."; đô thị/hiện đại/khoa huyễn thường dùng "anh ấy/cô ấy/anh ta/cô ta..."; ĐÂY CHỈ LÀ VÍ DỤ MINH HOẠ CHO 2 TRƯỜNG HỢP PHỔ BIẾN NHẤT, KHÔNG PHẢI toàn bộ khả năng — nhiều bối cảnh không rơi gọn vào 1 trong 2 nhóm trên: VD truyện CẬN ĐẠI/DÂN QUỐC/thời chiến loạn có súng ống/xe hơi nhưng nhân vật vẫn xưng hô/lễ nghi kiểu cũ thì vẫn nên dùng "hắn/nàng/y/thị"; hay 1 thế giới kỳ ảo/hải tặc kiểu phương Tây (VD bối cảnh dạng One Piece — vừa có súng ống/tàu chiến vừa có yếu tố siêu nhiên, không phải bối cảnh Trung Hoa cổ trang lẫn đô thị hiện đại) thì phải tự đọc xem chính bản dịch đang nhất quán dùng nhóm nào (hắn/nàng, hay anh ấy/cô ấy, hay thậm chí gọi thẳng bằng tên không dùng đại từ) để lấy đó làm chuẩn, không mặc định ép vào 1 trong 2 nhóm ví dụ trên. `+
    `⚠ NGUYÊN TẮC CHUNG cho MỌI bối cảnh, không riêng gì các ví dụ kể trên: TUYỆT ĐỐI KHÔNG suy diễn thể loại chỉ dựa vào ĐẠO CỤ/CÔNG NGHỆ xuất hiện trong truyện (có súng, có xe hơi, có tàu chiến... không tự động đồng nghĩa với "hiện đại") — phải căn cứ vào chính CÁCH XƯNG HÔ/LỄ NGHI nhân vật đang dùng xuyên suốt phần còn lại của CHÍNH chương này mới là dấu hiệu đáng tin), `+
    `⚠ QUAN TRỌNG — phạm vi kiểm tra KHÔNG chỉ giới hạn ở 2 nhóm "cổ trang" vs "hiện đại" minh hoạ trên: bất kỳ lúc nào CÙNG 1 nhân vật, trong CÙNG 1 bối cảnh/thời điểm tường thuật, bị gọi bằng 2 đại từ ngôi 3 khác SẮC THÁI/MỨC ĐỘ TÔN TRỌNG nhau đều tính là lệch tông cần báo — VD vừa gọi "hắn" (trung tính) vừa gọi "ông" (kính trọng, thường dùng cho người lớn tuổi/địa vị cao) cho cùng 1 người trong cùng đoạn; hay lẫn "gã"/"tên đó" (khinh miệt) với "ông"/"ngài ấy" (kính trọng) cho cùng 1 người — dù cả 2 từ đều hợp lý riêng lẻ và không thuộc rõ về phe "cổ trang" hay "hiện đại" nào. CHỈ bỏ qua nếu chính văn bản cho thấy rõ lý do tường thuật chính đáng cho sự đổi khác đó (VD đoạn đang chuyển góc nhìn/POV sang 1 nhân vật khác thực sự tôn trọng người này, hoặc thái độ người kể chuyện với người đó thay đổi rõ rệt theo đúng diễn biến, có nêu lý do trong lời văn). `+
    `rồi soát xem lời văn TƯỜNG THUẬT (không phải lời thoại) trong bản dịch có chỗ nào LẪN đại từ khác sắc thái/thể loại, không nhất quán với phần còn lại của CHÍNH chương này hay không. `+
    `CHỈ báo lỗi khi rõ ràng lệch tông so với cách dùng xuyên suốt phần còn lại của chương (VD cả chương đều dùng "hắn/nàng" khi kể chuyện nhưng có vài câu lại lẫn "anh ấy/cô ấy", hoặc ngược lại) — không suy diễn theo 1 chuẩn thể loại chung chung bên ngoài, không đoán khi không chắc. `+
    `⚠ TRUYỆN 2 THẾ GIỚI/XUYÊN KHÔNG: nếu chương có cảnh diễn ra ở 2 bối cảnh khác hẳn nhau (VD nửa đầu ở Trái Đất hiện đại, nửa sau nhân vật xuyên/chuyển sang thế giới tu tiên khác, hoặc ngược lại) thì "phần còn lại của chương" để so sánh PHẢI hiểu là "phần cùng 1 bối cảnh/thế giới với câu đang xét", KHÔNG PHẢI toàn bộ chương gộp chung — đại từ đổi tông NGAY TẠI ranh giới chuyển cảnh (chỗ văn bản thể hiện rõ đang đổi bối cảnh/thế giới, VD chuyển đoạn, đổi địa điểm/thời đại, nhân vật vừa xuyên qua) là ĐÚNG theo dụng ý truyện, TUYỆT ĐỐI KHÔNG được coi là lỗi lẫn tông rồi ép đồng nhất về 1 kiểu. `+
    `⚠ CHỈ áp dụng mục này cho ĐẠI TỪ NGÔI THỨ 3 (hắn/nàng/y/thị/gã/anh ấy/cô ấy/anh ta/cô ta...) — TUYỆT ĐỐI KHÔNG áp dụng cho đại từ NGÔI THỨ NHẤT ("ta", "tôi", "chúng ta", "chúng tôi", "bọn ta", "bổn...") hay NGÔI THỨ HAI ("ngươi", "các ngươi", "ngài"...) dưới bất kỳ hình thức nào, dù chúng đứng ở đầu câu hay xuất hiện trong đoạn tường thuật lẫn lời thoại — đây không phải phạm vi của mục kiểm tra này, không được báo lỗi/đổi thành tên riêng chỉ vì câu đó có vẻ "mơ hồ về chủ thể".\n\n`;
  const genreToneSection=`KIỂM TRA 2 — LỆCH TÔNG THỂ LOẠI trong xưng hô lời thoại (type:"genre_tone"): `+
    `Bước 1 — XÁC ĐỊNH HỆ XƯNG HÔ CHUẨN của CHÍNH chương này: NẾU phần "CHỈ DẪN THÊM từ prompt dịch chính" ở trên (nếu có) đã nêu rõ thể loại/hệ xưng hô của truyện, dùng CHÍNH XÁC đó làm hệ chuẩn (xem ưu tiên đã nêu ở phần đó), KHÔNG tự suy luận lại theo nội dung riêng của chương này trừ khi chỉ dẫn không đề cập hoặc chương thuộc 1 thế giới/bối cảnh khác mà chỉ dẫn chưa nói rõ. Khi KHÔNG có chỉ dẫn nào như vậy, tự suy luận thể loại/bối cảnh của chương (tu tiên/huyền huyễn/cổ trang/kiếm hiệp Trung Hoa thường dùng hệ "ta/ngươi/ngài/các hạ/lão phu/bổn tọa/tại hạ" (ngôi 1+2) và "huynh/tỷ/đệ/muội/ca ca/tỷ tỷ..." (xưng hô thân tộc/đồng môn); đô thị/hiện đại/khoa huyễn thường dùng hệ "tôi/cậu/tao/mày/anh/em/chị..."; ĐÂY CHỈ LÀ VÍ DỤ MINH HOẠ CHO 2 TRƯỜNG HỢP PHỔ BIẾN NHẤT, KHÔNG PHẢI toàn bộ khả năng — bối cảnh CẬN ĐẠI/DÂN QUỐC/thời chiến loạn có súng ống thường pha trộn "tiên sinh/cô nương/thái thái/đại ca/huynh đệ"; bối cảnh kỳ ảo/hải tặc kiểu phương Tây (VD dạng One Piece) thì phải tự đọc xem chính bản dịch đang nhất quán xưng hô kiểu gì để lấy làm chuẩn, không ép vào 1 trong 2 nhóm ví dụ trên — ⚠ TUYỆT ĐỐI KHÔNG suy diễn thể loại chỉ dựa vào đạo cụ/công nghệ xuất hiện trong truyện, phải căn cứ vào chính cách xưng hô nhân vật đang dùng). Dù lấy hệ chuẩn theo cách nào ở trên, hệ đó KHÔNG PHẢI lấy theo cách xưng hô nào ĐANG XUẤT HIỆN NHIỀU HƠN trong bản dịch — nếu cả chương lỡ dịch sai toàn bộ sang hệ khác (VD toàn chương dùng "cậu" dù hệ chuẩn là huyền huyễn/tu tiên), đó VẪN là lỗi cần báo và sửa HẾT, không phải vì nó "nhất quán" mà bỏ qua. `+
    `Bước 2 — SOÁT: trong lời THOẠI (không phải lời tường thuật, đã có mục riêng ở trên), tìm MỌI từ xưng hô (cả từ TỰ XƯNG ngôi 1 lẫn từ GỌI ĐỐI PHƯƠNG ngôi 2) không thuộc hệ xưng hô chuẩn đã xác định ở Bước 1 — báo TẤT CẢ các chỗ vi phạm, kể cả khi từ sai đó xuất hiện lặp lại nhiều lần/xuyên suốt chương (không giới hạn ở vài câu lẻ tẻ khác biệt với phần còn lại). `+
    `⚠ DẤU HIỆU RÕ NHẤT — LỆCH TÔNG NGAY TRONG CÙNG 1 CÂU/LƯỢT THOẠI: nếu trong CÙNG 1 câu, cùng 1 người nói, từ tự xưng (ngôi 1) và từ gọi đối phương (ngôi 2) thuộc 2 hệ khác nhau (VD tự xưng "lão phu" — cổ trang — nhưng lại gọi đối phương là "cậu" — hiện đại, hoặc ngược lại), đây LUÔN là lỗi cần báo, không cần so sánh với phần còn lại của chương mới kết luận được. `+
    `⚠ TRUYỆN 2 THẾ GIỚI/XUYÊN KHÔNG: áp dụng CÙNG nguyên tắc như mục đại từ tường thuật ở trên — nếu 1 cuộc thoại diễn ra ở bối cảnh/thế giới hiện đại (VD nhân vật đang ở Trái Đất) thì xưng hô "anh/em" là ĐÚNG dù phần khác của chương (diễn ra ở thế giới tu tiên) đang dùng "huynh/muội"; hệ chuẩn ở Bước 1 phải xác định RIÊNG cho từng bối cảnh/thế giới xuất hiện trong chương, không gộp chung cả chương rồi ép 1 cảnh phải theo tông của cảnh khác, và không được dùng lý do "truyện 2 thế giới" để bỏ qua 1 lỗi thực sự nằm trong CÙNG 1 bối cảnh. `+
    `Bước 3 — SỬA ("after"): thay từ sai bằng ĐÚNG 1 từ cùng NGÔI (từ ngôi 1 sai thì thay bằng từ ngôi 1 đúng hệ, từ ngôi 2 sai thì thay bằng từ ngôi 2 đúng hệ — TUYỆT ĐỐI KHÔNG đổi ngôi khi sửa) thuộc hệ xưng hô chuẩn đã xác định ở Bước 1, giữ nguyên sắc thái thân mật/kính trọng/xa cách của câu gốc (VD "cậu" xa cách/lịch sự trong truyện tu tiên nên sửa thành "ngươi" hoặc "các hạ" chứ không phải "huynh" nếu ngữ cảnh không thân mật) — ƯU TIÊN chọn đúng từ đã xuất hiện ở chỗ khác trong CHÍNH chương này cho hệ chuẩn đó để nhất quán, chỉ khi chương chưa có từ nào thuộc hệ chuẩn để tham chiếu mới tự chọn 1 từ phổ biến, tự nhiên của hệ đó. `+
    `⚠ ĐÂY CHỈ LÀ SỬA HỆ/SẮC THÁI XƯNG HÔ CHUNG (ta/ngươi-hệ vs tôi/cậu-hệ, huynh/muội-hệ vs anh/em-hệ), TUYỆT ĐỐI KHÔNG đi xa hơn để phán đoán/đổi thành 1 DANH XƯNG/CHỨC VỤ/TÊN RIÊNG cụ thể (VD không tự đổi thành "đại trưởng lão", "sư phụ"...) vì việc đó cần biết đúng danh tính/vai vế của từng nhân vật — không thuộc phạm vi bước này (đã chuyển sang cho bước dịch chính lo ngay từ đầu dựa vào bộ nhớ nhân vật), chỉ cần đúng HỆ xưng hô phù hợp thể loại là đủ, không cần đúng tuyệt đối chức danh theo đúng người.\n\n`;
  const spellingSection=`KIỂM TRA 3 — CHÍNH TẢ (type:"chinh_ta"): tìm lỗi GÕ/CHÍNH TẢ tiếng Việt THẬT SỰ (gõ nhầm phím, sai dấu thanh, thiếu/thừa 1 chữ cái do lỗi đánh máy — VD "khoong" thay vì "không", "đựoc" thay vì "được", "chuyên" thay vì "chuyện" khi ngữ cảnh rõ ràng là danh từ "chuyện"). `+
    `TUYỆT ĐỐI KHÔNG sửa: lựa chọn từ ngữ/văn phong (dù bạn thấy có từ hay hơn), cách hành văn, thứ tự câu chữ, hay bất kỳ điều gì không phải lỗi gõ khách quan. "before" CHỈ trích ĐÚNG 1 TỪ bị sai (không phải cả câu, không phải cụm nhiều từ) trừ khi từ đó lặp lại nhiều nơi trong chương thì thêm tối thiểu 1-2 từ liền kề để đủ phân biệt vị trí. "after" là đúng CHÍNH TỪ đó đã sửa, không đổi gì khác xung quanh — nếu không chắc đây là lỗi gõ (có thể là lựa chọn từ ngữ có chủ đích) thì KHÔNG báo.\n\n`;
  const untranslatedSection=`KIỂM TRA 4 — TEXT CÒN SÓT CHƯA DỊCH (type:"sot_dich"): tìm các đoạn còn NGUYÊN chữ Hán (tiếng Trung) hoặc CÂU/CỤM tiếng Anh có Ý NGHĨA (chứa động từ/cấu trúc câu, VD "He said nothing", "I'm sorry") mà đáng lẽ phải được dịch sang tiếng Việt nhưng bị bỏ sót. `+
    `TUYỆT ĐỐI KHÔNG báo các TÊN RIÊNG tiếng Anh/Latin (tên người, địa danh, tên kỹ năng/vật phẩm/tổ chức...) mà bản dịch CỐ Ý giữ nguyên dạng gốc — chỉ báo khi đó thực sự là 1 câu/cụm CÓ Ý NGHĨA cần dịch, không phải 1-2-3 từ chỉ dùng để định danh. "after" là bản dịch tiếng Việt tự nhiên của đúng đoạn đó — không được để trống hay giữ nguyên tiếng Trung/Anh.\n\n`;

  // Cùng chỉ dẫn đã "chưng cất" từ prompt dịch chính như buildCharExtractPrompt (xem
  // getMainPromptGuidance/guidanceSection ở đó) — giúp bước soát này nhận ra đúng thể loại/quy ước
  // riêng của truyện thay vì chỉ đoán chung chung từ chính nội dung chương đang soát.
  const guidanceSection=promptGuidance
    ?`CHỈ DẪN THÊM từ prompt dịch chính của người dùng (đã lọc lại, chỉ giữ phần liên quan xưng hô/thể loại/tên riêng) — dùng để hiểu đúng bối cảnh/thể loại truyện khi soát. RIÊNG cho việc XÁC ĐỊNH HỆ XƯNG HÔ CHUẨN ở "Bước 1" của KIỂM TRA 2 bên dưới: nếu chỉ dẫn này đã nêu RÕ thể loại/hệ xưng hô của truyện, PHẢI dùng CHÍNH XÁC đó làm hệ chuẩn — ưu tiên hơn cả việc tự suy luận từ nội dung riêng của chương đang soát (chỉ dẫn này áp dụng xuyên suốt cả bộ truyện, đáng tin hơn suy luận lẻ tẻ theo từng chương); CHỈ tự suy luận thêm từ chương khi chỉ dẫn không đề cập, hoặc truyện có nhiều thế giới/bối cảnh mà chỉ dẫn không nói rõ cảnh nào dùng hệ nào. Với mọi phần khác của các QUY TẮC BẮT BUỘC liệt kê bên dưới (định dạng field/JSON, phạm vi mỗi loại kiểm tra, cách sửa giữ nguyên ngôi...), khi mâu thuẫn với chỉ dẫn này thì QUY TẮC BẮT BUỘC vẫn luôn được ưu tiên hơn:\n${promptGuidance}\n\n`
    :'';
  return `Bạn là bước SOÁT CHẤT LƯỢNG cho 1 chương truyện ĐÃ ĐƯỢC DỊCH XONG sang tiếng Việt (bên dưới). `+
    `Nhiệm vụ: tìm ĐÚNG 4 loại lỗi liệt kê dưới đây — (1) đại từ tường thuật lẫn tông, (2) xưng hô lời thoại sai hệ so với thể loại truyện (cần SỬA thành đúng hệ, không chỉ báo), (3) lỗi chính tả/gõ, (4) đoạn còn sót chưa dịch (Trung/Anh). `+
    `⚠ KHÔNG được sửa xưng hô CỤ THỂ của một nhân vật nào (ai tự xưng gì, ai gọi ai là gì, giới tính/vai vế của ai) — đó là việc của bước dịch chính (đã có bộ nhớ nhân vật để tự dịch đúng ngay từ đầu), KHÔNG PHẢI việc của bước soát này. `+
    `TUYỆT ĐỐI KHÔNG sửa bất cứ điều gì khác ngoài đúng 4 loại đã nêu (không đụng văn phong/hành văn/nội dung/cách ngắt câu nếu không phải 1 trong 4 loại lỗi trên), và KHÔNG dịch lại cả chương — chỉ báo đúng lỗi thực sự sai.\n\n`+
    guidanceSection+pronounSection+genreToneSection+spellingSection+untranslatedSection+
    `Với MỖI lỗi tìm được:\n`+
    `- "before": trích NGUYÊN VĂN từ bản dịch bên dưới, y hệt từng dấu câu/khoảng trắng, BẮT BUỘC CÀNG NGẮN CÀNG TỐT — mặc định chỉ trích ĐÚNG 1 câu chứa lỗi (thoại hoặc tường thuật), RIÊNG type "chinh_ta" chỉ trích ĐÚNG 1 từ (xem spellingSection). Chỉ khi đoạn trích lặp lại y hệt ở chỗ khác trong chương mới được thêm TỐI ĐA 1 câu/từ liền kề để đủ phân biệt — TUYỆT ĐỐI KHÔNG trích nguyên cả đoạn/nhiều đoạn văn dài chỉ để "cho chắc đủ duy nhất".\n`+
    `- "after": nguyên phần đó nhưng đã sửa đúng lỗi tương ứng — giữ nguyên mọi từ ngữ khác, chỉ đổi đúng phần sai. "after" PHẢI khác "before" — nếu rà lại thấy chỗ đó thực ra không sai thì KHÔNG được thêm vào mảng "fixes".\n`+
    `- Nói chung: chỉ báo cáo khi THỰC SỰ chắc chắn có lỗi — không đoán hay sửa những chỗ mơ hồ/chưa đủ căn cứ, không đoán khi thể loại vốn pha trộn có chủ đích, không đoán khi truyện 2 thế giới đang đổi cảnh đúng dụng ý, không báo tên riêng tiếng Anh là "sót dịch". Nếu soát cả chương không thấy lỗi nào, trả về {"fixes":[]}.\n`+
    `- BẮT BUỘC gắn đúng "type" cho MỖI fix — chỉ 1 trong 4 giá trị sau, không tự bịa giá trị khác: "narration_pronoun" (đại từ ngôi thứ 3 TRUNG TÍNH khi tường thuật bị lẫn tông), "genre_tone" (xưng hô lời thoại bị lẫn tông), "chinh_ta" (lỗi gõ/chính tả), "sot_dich" (còn sót tiếng Trung/Anh chưa dịch).\n`+
    `Chỉ trả về JSON, không thêm văn bản/giải thích/markdown fence nào khác:\n`+
    `{"fixes":[{"type":"narration_pronoun"|"genre_tone"|"chinh_ta"|"sot_dich","before":"...","after":"...","reason":"..."}]}\n`+
    `Nếu không có lỗi nào, trả về {"fixes":[]}.\n\n`+
    `BẢN DỊCH CẦN SOÁT:\n${translatedText}`;
}
// Áp dụng danh sách fixes vào translatedText, CHỈ khi "before" khớp DUY NHẤT 1 lần trong văn bản
// TẠI THỜI ĐIỂM áp dụng (kiểm tra lại sau mỗi lần thay, vì thay 1 chỗ có thể ảnh hưởng số lần khớp
// của các fix sau) — khớp 0 lần (model trích sai/model đã diễn giải lại thay vì trích nguyên văn)
// hoặc khớp >1 lần (không đủ ngữ cảnh để xác định đúng chỗ cần sửa) đều BỎ QUA, không đoán mò, tránh
// sửa nhầm sang câu khác dùng chung 1 xưng hô cho nhân vật/tình huống khác.
// Trước khi bỏ cuộc hẳn ở lần so khớp CHÍNH XÁC (exact), thử thêm 1 lần so khớp NỚI LỎNG KHOẢNG
// TRẮNG: model soát đôi khi trích "before" đúng từng chữ nhưng lệch số khoảng trắng/xuống dòng so với
// bản dịch gốc (dấu cách kép, xuống dòng thừa...) — những lỗi thật bị bỏ sót oan chỉ vì lý do này.
// Cách làm: biến "before" thành regex, coi MỌI khoảng trắng liên tiếp trong đó là "\s+" (khớp được
// bất kỳ kiểu khoảng trắng nào ở vị trí tương ứng), rồi vẫn áp dụng đúng quy tắc cũ — CHỈ áp dụng khi
// regex đó khớp DUY NHẤT 1 lần trong toàn chương, tuyệt đối không đoán mò khi mơ hồ.
function escapeRegExp(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function buildLooseWhitespaceRegex(before){
  const pattern=escapeRegExp(before).replace(/\s+/g,'\\s+');
  try{return new RegExp(pattern,'g');}catch(e){return null;}
}
// "before" KHÔNG chứa khoảng trắng (1 từ/token đơn — tình huống hay gặp nhất ở type "chinh_ta", nơi
// prompt CHO PHÉP trích ngắn chỉ đúng từ bị gõ sai thay vì cả câu như xưng hô) là trường hợp NGUY HIỂM
// nếu chỉ đếm bằng out.split(before).length-1 (đếm SUBSTRING thô): 1 từ ngắn (VD "anh") có thể là
// substring của 1 từ HOÀN TOÀN KHÁC (VD "khoanh", "thanh") mà không phải chính nó đứng riêng — nếu
// tổng số lần khớp kiểu này vô tình đúng bằng 1, code cũ sẽ thay thế NHẦM VÀO GIỮA 1 TỪ KHÁC, làm hỏng
// từ đó. \b chuẩn của JS regex không dùng được vì chỉ nhận diện ký tự ASCII, vỡ hoàn toàn với chữ có
// dấu tiếng Việt (coi mọi ranh giới dấu là "word boundary" giả). Tự cài ranh giới bằng cách kiểm tra
// ký tự NGAY TRƯỚC/SAU vị trí khớp có phải chữ/số hay không (dùng \p{L}/\p{N} — nhận diện đúng cả chữ
// có dấu tiếng Việt nhờ Unicode property, cần flag 'u').
const VN_WORD_CHAR=/[\p{L}\p{N}]/u;
function isWordChar(ch){return !!ch&&VN_WORD_CHAR.test(ch);}
// Trả về mảng vị trí (index) mà "before" khớp trong text — nếu wordBoundaryOnly=true, CHỈ tính các vị
// trí mà 2 đầu không dính liền 1 ký tự chữ/số khác (loại các khớp "chui vào giữa từ khác" nói trên).
function findMatchPositions(text,before,wordBoundaryOnly){
  const positions=[];
  let searchFrom=0;
  while(true){
    const idx=text.indexOf(before,searchFrom);
    if(idx===-1)break;
    if(wordBoundaryOnly){
      const beforeChar=idx>0?text[idx-1]:'';
      const afterChar=idx+before.length<text.length?text[idx+before.length]:'';
      if(isWordChar(beforeChar)||isWordChar(afterChar)){searchFrom=idx+1;continue;}
    }
    positions.push(idx);
    searchFrom=idx+1; // lùi 1 ký tự (không phải idx+before.length) để không bỏ sót các khớp chồng lấn
  }
  return positions;
}
function applyAddressFixes(text,fixes){
  let out=text,applied=0,skipped=0;
  for(const fx of (fixes||[])){
    const before=(fx&&fx.before||'').trim(),after=fx&&fx.after;
    if(!before||typeof after!=='string'){skipped++;continue;}
    // Lưới an toàn: model đôi khi trả về fix "rỗng" (before và after giống hệt nhau, thực chất không
    // có lỗi gì — xem log thực tế: reason "dư thừa không có lỗi") dù prompt đã dặn không được làm vậy.
    // Loại các entry này trước khi áp dụng, không tính là applied (không có gì thay đổi thật) lẫn
    // skipped (không phải do không khớp được vị trí) để log phản ánh đúng bản chất.
    if(before===after.trim()){
      console.log(`[Luồng 3] Bỏ qua 1 gợi ý sửa rỗng (before = after, không có thay đổi thật): "${before.slice(0,60)}..."`);
      continue;
    }
    const wordBoundaryOnly=!/\s/.test(before); // trích ngắn kiểu 1 từ (chinh_ta) -> bắt buộc soi ranh giới từ
    const positions=findMatchPositions(out,before,wordBoundaryOnly);
    if(positions.length===1){
      if(before.length>300){
        console.log(`[Luồng 3] Lưu ý: 1 gợi ý soát chất lượng trích "before" khá dài (${before.length} ký tự) — model có thể đang trích thừa đoạn văn không cần thiết thay vì chỉ 1 câu.`);
      }
      const idx=positions[0];
      out=out.slice(0,idx)+after+out.slice(idx+before.length);
      applied++;
      console.log(`[Luồng 3] Đã sửa: "${before}" -> "${after}"${fx.reason?` (${fx.reason})`:''}`);
      continue;
    }
    // Không khớp chính xác đúng 1 lần -> thử lại với so khớp nới lỏng khoảng trắng trước khi bỏ qua.
    // (chỉ có ý nghĩa với "before" nhiều từ — 1 token đơn không có khoảng trắng để nới lỏng)
    const looseRe=buildLooseWhitespaceRegex(before);
    const looseMatches=looseRe?(out.match(looseRe)||[]):[];
    if(looseRe&&looseMatches.length===1){
      looseRe.lastIndex=0;
      out=out.replace(looseRe,()=>after);
      applied++;
      console.log(`[Luồng 3] Đã sửa (khớp nới lỏng khoảng trắng): "${before.slice(0,60)}..." -> "${after.slice(0,60)}..."${fx.reason?` (${fx.reason})`:''}`);
      continue;
    }
    console.log(`[Luồng 3] Bỏ qua 1 gợi ý soát chất lượng (khớp ${positions.length} lần thay vì đúng 1 lần, kể cả sau khi nới lỏng khoảng trắng): "${before.slice(0,60)}..."`);
    skipped++;
  }
  return {text:out,applied,skipped};
}
// Hàm chính: gọi sau khi 1 chương đã dịch xong, dùng CHUNG công tắc Character Memory (không tách
// riêng). Không bao giờ throw, luôn trả về ít nhất bản dịch gốc nếu có bất kỳ lỗi/timeout nào, để
// không chặn dịch. Giờ soát cả 4 loại lỗi (xem buildAddressAuditPrompt): 2 loại sắc thái xưng hô theo
// thể loại (không tra cứu dữ liệu nhân vật, để tránh nhầm người) + chính tả + text Trung/Anh còn sót
// chưa dịch (tên riêng tiếng Anh không tính) — cả 2 loại thêm sau đều chỉ đối chiếu cơ học trực tiếp
// trên chuỗi ký tự (containsCJK/looksLikeRealEnglishSentence/isSpellingOnlyFix), không tra cứu dữ
// liệu nhân vật nên không phát sinh lại rủi ro nhầm người đã gặp trước đây.
// "appearedChars" không còn được dùng bên trong hàm này nữa (bước soát đã bỏ mọi tra cứu theo từng
// nhân vật cụ thể — xem buildAddressAuditPrompt) — vẫn giữ tham số này trong chữ ký hàm để không phải
// sửa nơi gọi hàm (translate.js) ngay lúc này; có thể xoá hẳn sau khi xác nhận không còn nơi nào cần.
async function auditChapterAddressing(chapterIdx,translatedText,appearedChars){
  try{
    if(!getCharMemOn())return translatedText;
    if(!translatedText||!translatedText.trim())return translatedText;
    const keys=getKeys();
    if(!keys.length)return translatedText;
    const promptGuidance=await getMainPromptGuidance();
    const promptText=buildAddressAuditPrompt(translatedText,promptGuidance);
    if(!promptText)return translatedText; // hầu như luôn có nội dung (khối đại từ ngôi thứ 3 không cần dữ liệu nhân vật) — chỉ rỗng nếu buildAddressAuditPrompt đổi logic sau này
    console.log(`[Luồng 3] Soát chất lượng bản dịch chương ${chNum(chapterIdx)}...`);
    const messages=[{role:'user',parts:[{text:promptText}]}];
    // Thử CHAR_MODEL_B trước; nếu lỗi/timeout (rất hay gặp do 503/quota, xem log) HOẶC gọi thành công
    // nhưng trả về JSON không parse được (model lỡ kèm text thừa/JSON cụt) đều coi là 1 lượt thất bại,
    // RETRY 1 lần bằng CHAR_MODEL_A (model khác hẳn) trước khi chấp nhận bỏ qua hẳn chương này. Trước
    // đây chỉ gọi 1 lần và JSON hỏng bị coi ngầm là "fixes rỗng" -> log sai thành "không có lỗi nào"
    // dù thực chất bước soát chưa chạy được chút nào — rất dễ đánh lừa người dùng tin nhầm là đã sạch.
    // DeepSeek chỉ có 1 model (không có cặp model NHẸ khác nhau như Gemini để đa dạng hoá lượt retry)
    // → thử lại chính model đó lần 2 (giống pattern distillModel ở getMainPromptGuidance).
    const auditModels=getProvider()==='deepseek'?[getModel(),getModel()]:[CHAR_MODEL_B,CHAR_MODEL_A];
    let rawText=null,parsed=null,lastErr=null;
    for(const model of auditModels){
      try{
        rawText=await callCharModel(keys,model,messages,CHAR_ANALYSIS_TIMEOUT_MS);
        parsed=parseCharacterJSON(rawText);
        if(parsed&&Array.isArray(parsed.fixes)){lastErr=null;break;}
        lastErr=new Error('JSON không parse được');
        console.log(`[Luồng 3] Soát chất lượng bản dịch: model ${model} trả JSON không hợp lệ, thử lại. Raw:`,rawText);
      }catch(e){
        lastErr=e;
        console.log(`[Luồng 3] Soát chất lượng bản dịch lỗi gọi API (${model}), thử lại...`,e.message||e);
      }
    }
    if(lastErr)throw lastErr; // cả 2 lần thử đều lỗi/JSON hỏng -> rơi vào catch bên dưới, giữ nguyên bản dịch
    // .normalize('NFC') BẮT BUỘC ở đây (cùng lý do đã ghi chú ở applyCharField): model trả "before"/
    // "after" đôi khi ở dạng NFD (dấu tách rời thành 2-3 code point) dù NHÌN GIỐNG HỆT bản dịch gốc
    // (đang ở NFC). Không chuẩn hoá thì isSpellingOnlyFix/levenshtein bên dưới đếm nhầm 1 nguyên âm có
    // dấu thành 2-3 "ký tự khác nhau" so với bản La-tinh không dấu (VD "At" so với "Ở" dạng NFD bị coi
    // lệch 3 ký tự thay vì đúng 1 phép sửa) -> fix đúng thật (lỗi gõ 1 chữ) bị loại oan ở kiểm tra cơ
    // học, và cũng khiến findMatchPositions ở applyAddressFixes không tìm thấy "before" trong text NFC.
    const fixes=(parsed.fixes||[]).map(fx=>({
      ...fx,
      before:typeof fx?.before==='string'?fx.before.normalize('NFC'):fx?.before,
      after:typeof fx?.after==='string'?fx.after.normalize('NFC'):fx?.after,
    }));
    if(!fixes.length){console.log('[Luồng 3] Soát chất lượng bản dịch: không có lỗi nào.');return translatedText;}
    // Lọc bằng kiểm tra cơ học (xem validateAuditFixes) TRƯỚC khi so khớp/áp dụng — loại các fix mà
    // chính "type" AI tự gắn đã mâu thuẫn với bằng chứng đo được trên văn bản/dữ liệu đã lưu, không
    // đợi tới bước so khớp "before" mới phát hiện.
    const {kept,dropped}=validateAuditFixes(translatedText,fixes);
    if(dropped.length)dropped.forEach(d=>console.log(`[Luồng 3] Loại 1 fix (kiểm tra cơ học, không tin "reason" AI viết): ${d.why} — "${(d.fx.before||'').slice(0,60)}..."`));
    if(!kept.length){console.log('[Luồng 3] Soát chất lượng bản dịch: toàn bộ fix đề xuất đều bị loại ở bước kiểm tra cơ học.');return translatedText;}
    const {text,applied,skipped}=applyAddressFixes(translatedText,kept);
    console.log(`[Luồng 3] Soát chất lượng bản dịch hoàn tất: sửa ${applied}, bỏ qua ${skipped} (không khớp duy nhất), loại ${dropped.length} (kiểm tra cơ học).`);
    return text;
  }catch(e){
    console.log('[Luồng 3] Soát chất lượng bản dịch lỗi — giữ nguyên bản dịch:',e.message||e);
    return translatedText;
  }
}

function parseCharacterJSON(text){
  if(!text)return null;
  let t=text.trim();
  t=t.replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```\s*$/,'');
  try{return JSON.parse(t);}catch(e){}
  // Cố gắng "sửa" bằng cách trích xuất khối {...} đầu tiên
  const m=t.match(/\{[\s\S]*\}/);
  if(m){
    try{return JSON.parse(m[0]);}catch(e){}
  }
  return null;
}

// Merge kết quả AI vào S.characters theo nguyên tắc USER DATA > EXISTING DATA > NEW AI DATA.
// Trả về mảng character objects (từ S.characters) tương ứng các nhân vật xuất hiện trong chương.
function findCharByNameOrAlias(name){
  const n=name.trim().toLowerCase();
  return S.characters.find(x=>x.name.trim().toLowerCase()===n||
    (x.aliases||[]).some(a=>a.trim().toLowerCase()===n));
}
// Các field mà 1 khi NGƯỜI DÙNG đã tự tay chỉnh sửa (source==='user') thì AI KHÔNG được tự động
// ghi đè nữa — chỉ "quan hệ nhân vật" và "xưng hô" 2 chiều. Gender/note vẫn để AI tự do cập nhật
// theo diễn biến truyện như trước (không thuộc danh sách khoá này).
// Mở khoá lại: người dùng XOÁ HẾT nội dung field đó trong modal (input rỗng) -> field về "Chưa rõ"
// và nguồn được reset về 'ai' ngay tại saveCharModal() -> curEmpty=true -> rơi vào nhánh điền tự do
// bên dưới như bình thường, không cần logic riêng ở đây.
const CHARMEM_USER_LOCK_FIELDS=['relationship','addrThemToMc','addrMcToThem','narrRef'];
// Số chương tối thiểu 1 nhân vật đã xuất hiện để bị coi là "dữ liệu ổn định" — từ ngưỡng này trở đi,
// 1 correction đơn lẻ không còn đủ để tự động ghi đè ngay (xem applyCharField).
const CHARMEM_EVIDENCE_ESTABLISHED_CHAPTERS=3;
// So sánh nhóm sắc thái CŨ (đang gắn với giá trị xưng hô đang lưu) và MỚI (chương vừa phân tích)
// để quyết định CỘNG DỒN hay THAY THẾ (xem applyCharField, nhánh isAddrField):
// - CÙNG nhóm (VD "ca ca" và "đại ca" đều "Thân mật") -> chỉ là biến thể khác của cùng 1 kiểu
//   xưng hô -> CỘNG DỒN, giữ lại cả 2.
// - KHÁC nhóm rõ ràng (VD "ngươi" Xa cách/Thù địch -> "ca ca" Thân mật) -> dấu hiệu quan hệ đã
//   thực sự đổi -> THAY THẾ hẳn, không giữ xưng hô cũ đã lỗi thời trong prompt gửi AI.
// Trả về true (cùng nhóm), false (khác nhóm), hoặc null (chưa đủ dữ liệu để so sánh -> mặc định
// an toàn hơn là CỘNG DỒN, tránh lỡ tay xoá mất 1 xưng hô vẫn còn đúng).
function addrToneSameGroup(oldTone,newTone){
  const o=(oldTone||'').trim(),n=(newTone||'').trim();
  if(!o||o==='Chưa rõ'||!n||n==='Chưa rõ')return null;
  return o===n;
}
// Trần số cặp xưng hô tối đa được phép cộng dồn cho 1 chiều (addrThemToMc hoặc addrMcToThem).
// Không giới hạn thì qua hàng trăm chương, 1 nhân vật có thể tích luỹ quá nhiều biến thể (VD
// "muội/ca ca, tiểu muội/đại ca, muội muội/ca, a muội/ca ca..."), khiến prompt dịch
// (buildCharacterContextText) rối và model dịch phải chọn giữa quá nhiều lựa chọn gần giống
// nhau — dễ chọn khác nhau giữa các chương, làm xưng hô kém nhất quán thay vì nhất quán hơn.
const CHARMEM_ADDR_MAX_CANDIDATES=5;
// Thêm 1 giá trị mới vào danh sách các cách xưng hô đang lưu (chuỗi cách nhau bởi dấu phẩy, xem
// splitAddrCandidates) — không thêm trùng (so khớp không phân biệt hoa/thường). Nếu sau khi thêm
// vượt quá CHARMEM_ADDR_MAX_CANDIDATES, bỏ bớt (các) cặp CŨ NHẤT ở đầu danh sách — cùng chiến lược
// "giữ thông tin gần đây nhất" như trimAiNote() bên dưới, vì cách xưng hô mới quan sát được thường
// phản ánh đúng diễn biến quan hệ hiện tại hơn cặp đã lưu từ rất lâu.
function addAddrCandidate(cur,newVal){
  const curList=splitAddrCandidates(cur);
  const curSet=curList.map(normAddrWord);
  // newVal cũng có thể tự nó là nhiều lựa chọn (VD AI trả về "muội/ca ca, tiểu muội/đại ca") —
  // thêm từng lựa chọn CHƯA CÓ vào danh sách, thay vì nhét nguyên cả cụm vào làm 1 mục.
  const toAdd=splitAddrCandidates(newVal).filter(v=>!curSet.includes(normAddrWord(v)));
  if(!toAdd.length)return cur;
  let combined=curList.concat(toAdd);
  if(combined.length>CHARMEM_ADDR_MAX_CANDIDATES){
    combined=combined.slice(combined.length-CHARMEM_ADDR_MAX_CANDIDATES);
  }
  return combined.join(', ');
}
// Cập nhật 1 field (gender/relationship/xưng hô) của nhân vật theo kết quả phân tích chương hiện tại:
//  1) Field đang trống/"Chưa rõ" -> điền luôn, đánh dấu nguồn 'ai'. (Bao gồm cả trường hợp người dùng
//     vừa xoá hết field bị khoá — vì lúc đó field đã được reset về rỗng + nguồn 'ai' từ saveCharModal.)
//  2) Field đã có giá trị: với gender/relationship, AI trả về giá trị GIỐNG HỆT -> không đổi gì; với
//     xưng hô (isAddrField), AI trả về giá trị đã CÓ SẴN trong danh sách nhiều-lựa-chọn -> cũng coi
//     như khớp, không đổi gì (chỉ huỷ gợi ý chờ duyệt cũ nếu có).
//  3) Field thuộc CHARMEM_USER_LOCK_FIELDS và đang do NGƯỜI DÙNG tự nhập (source==='user') -> AI
//     KHÔNG được tự ý ghi đè/xoá nữa. Nếu có "correction" (bằng chứng rõ ràng), chỉ lưu thành gợi ý
//     CHỜ DUYỆT (conflictField) để hiện banner trong modal sửa nhân vật, người dùng tự bấm "Áp dụng"/
//     "Bỏ qua"; nếu không có correction thì bỏ qua hoàn toàn, không nhắc gì.
//     NGOẠI LỆ riêng cho narrRef (xem nhánh field==='narrRef' bên trong): field này vẫn được AI tự
//     CỘNG DỒN thêm lựa chọn mới dù đã khoá, không cần qua banner — vì cộng dồn không xoá/thay gì cả.
//  4) Các trường hợp còn lại (field không bị khoá, hoặc đang do 'ai' tự đoán từ trước):
//     - AI trả về giá trị KHÁC nhưng KHÔNG kèm "correction" -> bỏ qua (nhiễu/suy luận yếu).
//     - AI trả về giá trị KHÁC và có "correction" -> ÁP DỤNG NGAY, không chờ duyệt (field này AI vẫn
//       đang tự quản lý, chưa có gì để "bảo vệ" khỏi bị ghi đè). Riêng field xưng hô (isAddrField):
//       thay vì ghi đè thẳng, so sánh nhóm sắc thái CŨ/MỚI (addrToneSameGroup) để quyết định CỘNG DỒN
//       thêm 1 cách gọi hợp lệ, hay THAY THẾ hẳn vì quan hệ đã thực sự đổi — xem addrToneSameGroup ở trên.
function applyCharField(c,field,sourceField,conflictField,newVal,isCorrection,reason,charName,isRelationship,chapterIdx,isAddrField,newTone){
  // Field xưng hô (isAddrField): dùng isAddrUnknown để bắt cả trường hợp AI trả nguyên chuỗi kiểu
  // "Chưa rõ / Chưa rõ" (không chỉ đúng y hệt "Chưa rõ") — xem isAddrUnknown ở trên. Các field khác
  // (gender/relationship...) vẫn so sánh trực tiếp như cũ, vì chúng không dùng định dạng nhiều-lựa-chọn.
  if(isAddrField?isAddrUnknown(newVal):newVal==='Chưa rõ')return; // chương này không cung cấp thông tin -> không đụng gì
  const cur=c[field];
  const curEmpty=isAddrField?isAddrUnknown(cur):(!cur||cur==='Chưa rõ');
  if(curEmpty){
    c[field]=newVal;c[sourceField]='ai';
    // AI tự gán -> nếu user đã huỷ ngôi sao, không áp dụng ngay mà tính vào phiếu bầu tự khôi phục
    // (xem noteProtagonistSignal) thay vì chặn cứng vĩnh viễn.
    noteProtagonistSignal(c,isRelationship,newVal,chapterIdx);
    if(c.pendingCorr)delete c.pendingCorr[field];
    console.log(`[Luồng 1][Cập nhật] Updated: ${charName}.${field}`);
    return;
  }
  // isAddrField: so khớp theo TẬP HỢP lựa chọn (đã tách bởi splitAddrCandidates) ở CẢ 2 bên, thay
  // vì so nguyên cụm newVal (chưa tách) với từng lựa chọn đã tách của cur — cách so cũ khiến 1 giá
  // trị nhiều-lựa-chọn (VD cur="ta/ngươi, ta/ngài") không bao giờ khớp lại với chính nó khi AI trả
  // về y hệt, vì "ta/ngươi, ta/ngài" không bằng riêng "ta/ngươi" hay riêng "ta/ngài". Khớp khi mọi
  // lựa chọn AI đề xuất đều đã có sẵn trong danh sách đang lưu.
  const alreadyMatches=isAddrField
    ?(()=>{
        const newCands=splitAddrCandidates(newVal).map(normAddrWord);
        const curCands=splitAddrCandidates(cur).map(normAddrWord);
        return newCands.length>0&&newCands.every(v=>curCands.includes(v));
      })()
    :newVal===cur;
  if(alreadyMatches){
    if(c[conflictField]){c[conflictField]=null;} // nếu còn gợi ý cũ treo lại từ trước, được AI tái xác nhận -> huỷ đi
    if(c.pendingCorr)delete c.pendingCorr[field];
    // QUAN TRỌNG: đây là trường hợp PHỔ BIẾN NHẤT khi 1 nhân vật đã bị huỷ ngôi sao — field
    // "relationship" thường VẪN còn giữ nguyên text "Nhân vật chính" từ trước lúc bị huỷ (huỷ chỉ
    // đổi isProtagonist/protagonistDenied, không xoá relationship), nên AI đề xuất lại y hệt giá trị
    // đang lưu -> rơi vào đúng nhánh "khớp sẵn" này. Nếu thiếu dòng dưới, phiếu bầu tự khôi phục sẽ
    // không bao giờ được tính trong tình huống hay gặp nhất, khiến cơ chế tự khôi phục gần như vô dụng.
    noteProtagonistSignal(c,isRelationship,newVal,chapterIdx);
    return;
  }
  const userLocked=CHARMEM_USER_LOCK_FIELDS.includes(field)&&c[sourceField]==='user';
  if(userLocked){
    // narrRef: khác với relationship/addrThemToMc/addrMcToThem — field này thường xuyên có NHIỀU
    // lựa chọn hợp lệ cùng lúc (tuỳ góc nhìn/phe), nên dù user đã tự sửa/khoá, AI vẫn được tự CỘNG
    // DỒN thêm lựa chọn ngôi thứ 3 MỚI (khác hẳn cái user đã gõ) mà KHÔNG cần chờ duyệt qua banner —
    // vì cộng dồn không xoá/thay bất cứ thứ gì user đã ghi, nên không có rủi ro để phải "Áp dụng"/
    // "Bỏ qua". narrRefSource VẪN giữ nguyên 'user' sau khi cộng dồn, để field tiếp tục được coi là
    // "đã khoá" (bảo vệ khỏi bị AI XOÁ/THAY THẾ hẳn ở những lượt phân tích sau, dù vẫn còn được thêm).
    if(field==='narrRef'){
      const merged=addAddrCandidate(cur,newVal);
      if(merged!==cur){
        c[field]=merged;
        if(c[conflictField])c[conflictField]=null;
        console.log(`[Luồng 1][Cập nhật] Auto-merged (user-locked, cộng dồn không thay): ${charName}.${field} -> ${merged}`);
      }
      return;
    }
    if(isCorrection){
      c[conflictField]={value:newVal,reason:reason||''};
      console.log(`[Luồng 1][Cập nhật] Pending suggestion (user-locked, chờ duyệt): ${charName}.${field} -> ${newVal}`);
    } else {
      console.log(`[Luồng 1][Cập nhật] Skipped: ${charName}.${field} - người dùng đã tự chỉnh sửa, AI không tự động cập nhật nữa`);
    }
    return;
  }
  if(!isCorrection){
    console.log(`[Luồng 1][Cập nhật] Skipped: ${charName}.${field} - đã có dữ liệu, không đủ căn cứ để sửa`);
    return;
  }
  // Field không bị user khoá, có correction hợp lệ -> áp dụng NGAY bằng logic tính toán cộng dồn/
  // thay thế sẵn có (xem addrToneSameGroup bên dưới cho field xưng hô), không chờ user duyệt và
  // không cần bằng chứng lặp lại ở chương khác nữa — banner "chờ duyệt" giờ CHỈ dành riêng cho field
  // đã bị user tự khoá (xem nhánh userLocked ở trên), tránh làm phiền với những field AI vẫn đang tự
  // quản lý (trước đây phần "established" từng chặn lại + hiện banner ngay cả khi user chưa từng đụng
  // vào field, khiến banner xuất hiện quá thường xuyên một cách không cần thiết).
  const oldVal=cur;

  if(isAddrField){
    const sameTone=addrToneSameGroup(c.addrTone,newTone);
    if(sameTone===false){
      // Khác nhóm sắc thái rõ ràng -> quan hệ đã đổi thật -> THAY THẾ hẳn, bỏ xưng hô cũ đã lỗi thời
      c[field]=newVal;
    } else {
      // Cùng nhóm sắc thái, hoặc chưa đủ dữ liệu để so sánh (null) -> an toàn hơn là CỘNG DỒN
      c[field]=addAddrCandidate(cur,newVal);
    }
  } else {
    c[field]=newVal;
  }
  c[sourceField]='ai';c[conflictField]=null;
  // Tương tự nhánh curEmpty ở trên — dùng chung cơ chế phiếu bầu tự khôi phục.
  noteProtagonistSignal(c,isRelationship,newVal,chapterIdx);
  console.log(`[Luồng 1][Cập nhật] Auto-corrected: ${charName}.${field} (${oldVal} -> ${c[field]})`);
  notifyCharCorrection(charName,field,oldVal,c[field],reason);
}
// SỔ ĐĂNG KÝ narrRef trong 1 ĐỢT phân tích (1 lần gọi mergeAnalysisResults, thường = 1 chương):
// key = giá trị narrRef đã chuẩn hoá (normAddrWord), value = id nhân vật ĐẦU TIÊN được gán giá trị
// đó trong đợt này. Mục đích: chặn bug "gán trùng narrRef cho 2 nhân vật khác nhau trong cùng 1
// đợt phân tích" — xảy ra khi model trích xuất nhầm lẫn 2 nhân vật (VD cả 2 đều được ai đó gọi là
// "chú" trong những đoạn khác nhau) và trả về CÙNG 1 giá trị narrRef cho cả 2 entry JSON. Vì
// applyCharField() ghi thẳng ngay khi field narrRef của nhân vật đang rỗng (không qua bước chờ
// duyệt), nếu không chặn ở đây thì cả 2 nhân vật sẽ lặng lẽ nhận cùng 1 narrRef sai — đúng triệu
// chứng "sửa/nhận narrRef ở 1 nhân vật thì nhân vật khác cũng bị đổi theo" mà người dùng gặp phải.
// Không chặn nếu giá trị đó đã thuộc về CHÍNH nhân vật đang xét (đang cộng dồn thêm cho chính họ).
// Bảng tra 1 số đại từ/cách gọi ngôi thứ 3 THÔNG DỤNG có sắc thái giới tính RÕ RÀNG trong tiếng Việt
// — đây CHÍNH LÀ loại từ mà narrRef được thiết kế để lưu (đại từ trung tính theo giới tính, có thể
// kèm vài biến thể thân mật/xa cách-thù địch nhẹ — xem buildCharExtractPrompt), không còn là trường
// hợp hiếm gặp như thiết kế cũ (trước đây narrRef chỉ lưu danh xưng kính ngữ/khinh miệt đặc biệt).
// Dùng để bắt ĐÚNG loại lỗi thực tế đã gặp: 1 giá trị narrRef mang nghĩa giới tính rõ ràng (VD "chú
// ấy") bị gán nhầm cho 1 nhân vật đã xác định là giới tính NGƯỢC LẠI (VD nhân vật Nữ) — do model
// trích xuất nhầm lẫn 2 nhân vật khác nhau trong chương.
// KHÔNG dùng để chặn việc nhiều nhân vật CÙNG giới tính dùng chung 1 đại từ phổ biến — VD rất nhiều
// nhân vật nam trong 1 chương đều được gọi là "hắn", nhiều nhân vật nữ đều được gọi là "nàng", đó là
// chuyện HOÀN TOÀN BÌNH THƯỜNG trong văn tường thuật, không phải dấu hiệu nhầm lẫn gì cả — nên các từ
// càng phổ biến/mơ hồ về giới tính (VD "y" dùng phiếm chỉ chung, không rõ hẳn nam/nữ) càng KHÔNG nên
// đưa vào bảng này để tránh chặn nhầm (bản trước dùng cách so trùng-giá-trị-trong-đợt đã mắc đúng
// lỗi này, nay bỏ đi) — chỉ những từ dưới đây mới đủ RÕ RÀNG về giới tính để dùng làm căn cứ chặn.
const CHARMEM_NARRREF_GENDER_HINTS={
  'hắn':'Nam','hắn ta':'Nam','gã':'Nam','gã ta':'Nam','gã đó':'Nam','lão':'Nam','lão ta':'Nam',
  'ông ta':'Nam','anh ta':'Nam','cậu ta':'Nam','chú ấy':'Nam','thằng đó':'Nam','tên đó':'Nam',
  'nàng':'Nữ','nàng ta':'Nữ','thị':'Nữ','ả':'Nữ','mụ':'Nữ','mụ ta':'Nữ','bà ta':'Nữ','cô ta':'Nữ',
  'chị ta':'Nữ','cô ấy':'Nữ','chị ấy':'Nữ','dì ấy':'Nữ','thím ấy':'Nữ','con nhỏ đó':'Nữ'
};
// Trả về 'Nam'/'Nữ' nếu candidate khớp CHÍNH XÁC (không phân biệt hoa/thường, đã chuẩn hoá) với 1 từ
// trong bảng trên, hoặc null nếu từ không nằm trong bảng (trung tính/không rõ giới tính) — null nghĩa
// là KHÔNG có ý kiến gì, không chặn.
function narrRefGenderHint(candidate){
  return CHARMEM_NARRREF_GENDER_HINTS[normAddrWord(candidate)]||null;
}
// Lọc bỏ khỏi narrRefRaw các lựa chọn nào có sắc thái giới tính RÕ RÀNG NGƯỢC với giới tính đã xác
// định (charGender) của chính nhân vật đang xét. Nếu charGender chưa rõ, không lọc gì (không có gì
// để đối chiếu). Chỉ lọc từng LỰA CHỌN cụ thể vi phạm, giữ nguyên các lựa chọn khác không vi phạm.
function filterNarrRefByGender(narrRefRaw,charGender){
  if(isNarrRefUnknown(narrRefRaw)||isUnknownVal(charGender))return narrRefRaw;
  const cands=splitAddrCandidates(narrRefRaw);
  const kept=[];
  cands.forEach(cand=>{
    const hint=narrRefGenderHint(cand);
    if(hint&&hint!==charGender){
      console.log(`[Luồng 1][Dọn narrRef] Bỏ qua narrRef "${cand}" vì mang sắc thái giới tính ${hint}, không khớp giới tính ${charGender} đã xác định của nhân vật — nghi AI nhầm lẫn 2 nhân vật.`);
      return;
    }
    kept.push(cand);
  });
  return kept.length?kept.join(', '):'Chưa rõ';
}
// Từ khoá đặc trưng cho CÂU MIÊU TẢ NGOẠI HÌNH/TRANG PHỤC (thay vì 1 đại từ ngôi 3 phiếm chỉ thật) —
// dùng để bắt lỗi narrRef bị lưu nhầm thành cả cụm miêu tả (VD "người mặc áo bào đen, khuôn mặt che
// kín") thay vì 1 đại từ ngắn gọn thật (VD "hắn", "tên đó", "con nhỏ đó"). Loại miêu tả này có 2
// vấn đề: (1) dài dòng, nếu bước dịch chọn lại nguyên văn cho lời tường thuật sau này sẽ gượng; (2)
// thường gắn với 1 THỜI ĐIỂM/TRẠNG THÁI CỤ THỂ (đang cải trang, đang bị thương...) nên lỗi thời ngay
// khi tình tiết đổi, nhưng vì narrRef chỉ CỘNG DỒN chứ không bao giờ tự thay/xoá (xem lý do ở
// mergeAnalysisResults bên dưới), nó sẽ tồn tại mãi trong danh sách nếu không lọc riêng.
const CHARMEM_NARRREF_DESCRIPTIVE_WORDS=[
  'mặc','khoác','đeo','trùm','choàng','diện', // hành động liên quan trang phục
  'khuôn mặt','gương mặt','mặt nạ','che mặt','bịt mặt','đôi mắt','ánh mắt','mái tóc','làn da',
  'bộ dạng','dáng người','dáng vẻ','thân hình','vóc dáng','trang phục','y phục','bộ áo','chiếc áo'
];
// Trần số TỪ tối đa cho 1 lựa chọn narrRef hợp lệ — 1 đại từ ngôi 3 phiếm chỉ thật (VD "hắn", "tên
// đó", "con nhỏ đó") hiếm khi quá 5 từ; câu miêu tả ngoại hình thường dài hơn hẳn.
// Cố tình để hơi rộng (5, không phải 2-3) để tránh lọc nhầm các cụm phiếm chỉ dài nhưng hợp lệ.
const CHARMEM_NARRREF_MAX_WORDS=5;
function isNarrRefDescriptivePhrase(cand){
  const t=(cand||'').trim();
  if(!t)return false;
  if(t.split(/\s+/).filter(Boolean).length>CHARMEM_NARRREF_MAX_WORDS)return true;
  const low=normAddrWord(t);
  return CHARMEM_NARRREF_DESCRIPTIVE_WORDS.some(kw=>low.includes(kw));
}
// Lọc bỏ khỏi narrRefRaw các lựa chọn là câu miêu tả ngoại hình/trang phục (xem
// isNarrRefDescriptivePhrase), chỉ giữ lại các lựa chọn còn lại là danh xưng/biệt hiệu thật. Dùng cả
// khi merge dữ liệu MỚI (chặn từ gốc, không cho lọt vào — xem mergeAnalysisResults) lẫn khi dọn dữ
// liệu CŨ đã lỡ lưu trước bản sửa này (xem cleanupDescriptiveNarrRef).
function stripDescriptivePhraseFromNarrRef(narrRefRaw){
  if(isNarrRefUnknown(narrRefRaw))return narrRefRaw;
  const cands=splitAddrCandidates(narrRefRaw);
  const kept=cands.filter(cand=>{
    if(isNarrRefDescriptivePhrase(cand)){
      console.log(`[Luồng 1][Dọn narrRef] Bỏ qua narrRef "${cand}" vì là câu miêu tả ngoại hình/trang phục, không phải đại từ ngôi 3 thật.`);
      return false;
    }
    return true;
  });
  return kept.length?kept.join(', '):'Chưa rõ';
}
// Dọn narrRef ĐANG LƯU của 1 nhân vật, loại các lựa chọn là câu miêu tả ngoại hình/trang phục (xem
// stripDescriptivePhraseFromNarrRef) — CHỈ áp dụng khi narrRefSource !== 'user' (người dùng đã tự
// gõ/khoá thì giữ nguyên, đúng nguyên tắc "user luôn được ưu tiên hơn ai" dùng nhất quán trong file
// này, xem cleanupUnknownAddrValues/cleanupLabelDuplicateFromExistingNarrRef). Gọi ở CẢ 2 nơi:
// (1) mergeAnalysisResults — soát lại MỖI KHI nhân vật được cập nhật qua 1 chương mới, để dọn ngay cả
// những giá trị đã lỡ lưu từ TRƯỚC bản sửa này, không chỉ chặn giá trị mới của riêng chương đang phân
// tích; (2) cleanupUnknownAddrValues — dọn 1 lượt toàn bộ dữ liệu cũ ngay khi tải truyện, để không
// phải đợi có chương mới mới được dọn.
function cleanupDescriptiveNarrRef(c){
  if(c.narrRefSource==='user')return false;
  if(!c.narrRef||isNarrRefUnknown(c.narrRef))return false;
  const stripped=stripDescriptivePhraseFromNarrRef(c.narrRef);
  const normalizedStripped=isNarrRefUnknown(stripped)?'':stripped;
  if(normalizedStripped!==c.narrRef){
    console.log(`[Luồng 1][Dọn narrRef] Dọn narrRef miêu tả ngoại hình/trang phục cho "${c.name}": "${c.narrRef}" -> "${normalizedStripped||'(rỗng)'}"`);
    c.narrRef=normalizedStripped;
    return true;
  }
  return false;
}
function mergeAnalysisResults(found,chapterIdx){
  const appeared=[];
  for(const f of found){
    const name=(f.name||'').trim();
    if(!name)continue;
    const origName=(f.originalName||'').trim();
    const sinoAlias=(f.sinoAlias||'').trim();
    let c=findCharByNameOrAlias(name)||(origName?findCharByNameOrAlias(origName):null)||(sinoAlias?findCharByNameOrAlias(sinoAlias):null);
    if(!c){
      // Nhân vật hoàn toàn mới: dùng tên đã dịch làm tên chính (chỉ dịch 1 lần duy nhất ở đây),
      // lưu tên gốc/tên thô (nếu có) và phiên âm Hán Việt (nếu tên chính là tên phương Tây được
      // phục hồi từ chữ Hán phiên âm — xem "sinoAlias" trong buildCharExtractPrompt) vào aliases,
      // để các chương sau nhận đúng dù bản gốc/bản dịch cũ còn dùng cách viết nào trong 2 cách đó.
      const aliasesInit=[origName,sinoAlias].filter((v,i,arr)=>v&&v.toLowerCase()!==name.toLowerCase()&&arr.indexOf(v)===i);
      c={
        id:newCharId(),name,gender:'Chưa rõ',relationship:'Chưa rõ',note:'',aliases:aliasesInit,
        // protagonistPendingVotes: phiếu bầu cho lần gán "nhân vật chính" (đối xứng với
        // protagonistReconfirmVotes bên dưới, dùng khi khôi phục sau khi bị huỷ) — xem noteProtagonistSignal.
        isProtagonist:false,protagonistDenied:false,protagonistPendingVotes:[],
        genderSource:'ai',relationshipSource:'ai',noteSource:'ai',mentionChapters:[],
        genderConflict:null,relationshipConflict:null,
        // Xưng hô 2 chiều với nhân vật chính — giải quyết case "kẻ thù nhưng AI dịch thành ngài".
        // Không lưu quan hệ có hướng đầy đủ giữa MỌI cặp nhân vật (phức tạp, tốn payload) — chỉ lưu
        // xưng hô giữa nhân vật này với NHÂN VẬT CHÍNH, cùng trục quy chiếu với field `relationship`.
        addrThemToMc:'',addrMcToThem:'',addrSource:'ai',
        addrThemToMcConflict:null,addrMcToThemConflict:null,
        // Cách gọi ngôi thứ 3 khi TƯỜNG THUẬT/nói VỀ nhân vật này (khác addrThemToMc/addrMcToThem —
        // xem giải thích ở buildCharExtractPrompt và buildCharacterContextText). Chỉ lưu đại từ
        // TRUNG TÍNH/phiếm chỉ theo giới tính, có thể chứa nhiều biến thể tuỳ sắc thái/góc nhìn
        // (VD "hắn, tên đó"), dùng chung định dạng nhiều-lựa-chọn với addr fields
        // (splitAddrCandidates/addAddrCandidate) nhưng không tách self/other.
        narrRef:'',narrRefSource:'ai',narrRefConflict:null,
        // "Vai vế/địa vị" theo bối cảnh truyện (cảnh giới tu luyện, chức vụ, thân phận, tuổi tác...)
        // — dùng để AI đoán xưng hô đúng hơn, tổng quát cho mọi thể loại (không cứng hoá theo tuổi).
        statusCue:'',statusCueSource:'ai',
        // Nhóm sắc thái của cặp xưng hô hiện tại (1 trong CHARMEM_ADDR_TONES) — chỉ dùng nội bộ để
        // phát hiện khi xưng hô mới trích xuất lệch hẳn nhóm đã lưu (xem detectAddrSuspicion), không
        // hiển thị cho người dùng.
        addrTone:'Chưa rõ',
        // Theo dõi đề xuất "correction" gần nhất cho từng field (value + chương đề xuất), dùng để gate:
        // nhân vật đã có nhiều dữ liệu ổn định thì chỉ tự sửa ngay khi 2 chương liên tiếp cùng đề xuất
        // 1 giá trị mới giống nhau; lần đầu chỉ đưa vào Conflict chờ duyệt (xem applyCharField).
        pendingCorr:{}
      };
      S.characters.push(c);
      console.log(`[Luồng 1][Tạo/Sửa nhân vật] Created: ${name}`);
    } else {
      // Nhân vật đã có sẵn — THÔNG THƯỜNG KHÔNG bao giờ đổi lại c.name (dù AI lần này dịch/viết
      // khác đi), giữ đúng nguyên tắc "chỉ dịch tên 1 lần".
      // NGOẠI LỆ DUY NHẤT: nếu c.name đang lưu vẫn còn SÓT chữ Hán (do lần phân tích trước model bỏ
      // qua yêu cầu dịch tên), và lần này có sẵn 1 "name" hợp lệ — không còn chữ Hán — khớp với đúng
      // nhân vật này (qua alias hoặc originalName), thì coi đây là dữ liệu vá lỗi và cho phép SỬA LẠI
      // c.name đúng 1 lần duy nhất. Kể từ khi đã có tên tiếng Việt, nhân vật này được xem là "đã dịch
      // tên xong" và áp dụng lại đúng nguyên tắc "không đổi tên" như bình thường ở các lần sau.
      const known=new Set([c.name.trim().toLowerCase(),...(c.aliases||[]).map(a=>a.trim().toLowerCase())]);
      let toAdd=[name,origName,sinoAlias].filter(v=>v&&!known.has(v.trim().toLowerCase()));
      if(containsCJK(c.name)&&name&&!containsCJK(name)){
        const oldName=c.name;
        c.name=name;
        toAdd=toAdd.filter(v=>v.trim().toLowerCase()!==name.trim().toLowerCase());
        if(!toAdd.some(v=>v.trim().toLowerCase()===oldName.trim().toLowerCase()))toAdd.push(oldName);
        console.log(`[Luồng 1][Tạo/Sửa nhân vật] Fixed untranslated name: "${oldName}" -> "${name}"`);
      }
      if(toAdd.length){
        c.aliases=[...(c.aliases||[]),...toAdd];
        console.log(`[Luồng 1][Tạo/Sửa nhân vật] Added alias(es) for ${c.name}: ${toAdd.join(', ')}`);
      }
    }
    // .normalize('NFC') BẮT BUỘC ở đây: văn bản do AI trả về đôi khi encode Unicode tiếng Việt ở
    // dạng NFD (dấu tách rời) dù NHÌN GIỐNG HỆT "Chưa rõ" viết tay trong code (dạng NFC). Nếu không
    // chuẩn hoá, so sánh chuỗi === 'Chưa rõ' ở applyCharField sẽ ÂM THẦM SAI (2 chuỗi trông y hệt
    // nhưng khác nhau ở byte) -> "Chưa rõ" bị lưu nhầm thành 1 xưng hô/giá trị thật, sau đó bị gửi
    // vào prompt dịch như thể đã xác định được, dù thực ra chẳng có ý nghĩa gì.
    const fg=(f.gender||'Chưa rõ').normalize('NFC').trim()||'Chưa rõ';
    const fr=(f.relationship||'Chưa rõ').normalize('NFC').trim()||'Chưa rõ';
    const fat=(f.addrThemToMc||'Chưa rõ').normalize('NFC').trim()||'Chưa rõ';
    const fam=(f.addrMcToThem||'Chưa rõ').normalize('NFC').trim()||'Chưa rõ';
    const fnarrRaw=(f.narrRef||'Chưa rõ').normalize('NFC').trim()||'Chưa rõ';
    // Lưới an toàn: loại bỏ lựa chọn nào trong fnarrRaw trùng y nguyên với relationship (cả giá trị
    // MỚI của chương này lẫn giá trị ĐANG LƯU trên nhân vật) — xem stripRelationshipCopyFromNarrRef.
    // Mở rộng lưới lọc sang statusCue: lỗi "copy nhãn thay vì đọc tường thuật thật" xảy ra y hệt với
    // statusCue (VD model copy "Đang giả chết" của statusCue vào narrRef) như với relationship, nên
    // lọc cả 2 nguồn nhãn, ở cả giá trị MỚI của chương này lẫn giá trị ĐANG LƯU trên nhân vật.
    let fnarr=stripRelationshipCopyFromNarrRef(fnarrRaw,[fr,c.relationship,f.statusCue,c.statusCue]);
    // Lấy TRƯỚC khi c.addrTone bị ghi đè bên dưới — tại đây c.addrTone vẫn còn là nhóm sắc thái CŨ
    // (gắn với giá trị xưng hô đang lưu), dùng để so sánh với nhóm sắc thái MỚI của chương này.
    const fatone=(f.addrTone||'').normalize('NFC').trim();
    const corr=(f.correction&&typeof f.correction==='object')?f.correction:{};
    applyCharField(c,'gender','genderSource','genderConflict',fg,!!corr.gender,corr.reason,name,false,chapterIdx);
    // Lọc theo giới tính SAU KHI gender của chương này đã được áp dụng ở trên (bắt cả trường hợp
    // gender vừa được xác nhận NGAY trong chương đang phân tích) — xem giải thích ở khai báo
    // filterNarrRefByGender phía trên. Chỉ chặn ĐÚNG các từ có sắc thái giới tính rõ ràng ngược với
    // giới tính đã biết, KHÔNG chặn việc nhiều nhân vật cùng giới dùng chung 1 đại từ phổ biến.
    fnarr=filterNarrRefByGender(fnarr,c.gender);
    // Chặn câu miêu tả ngoại hình/trang phục NGAY TỪ giá trị mới của chương này, trước khi nó có cơ
    // hội được cộng dồn vào narrRef đang lưu (xem isNarrRefDescriptivePhrase).
    fnarr=stripDescriptivePhraseFromNarrRef(fnarr);
    applyCharField(c,'relationship','relationshipSource','relationshipConflict',fr,!!corr.relationship,corr.reason,name,true,chapterIdx);
    // Dùng chung 1 cờ correction.addressing cho cả 2 chiều xưng hô, vì trên thực tế chúng luôn đổi
    // cùng lúc (VD lộ ra kẻ thù thật ra là ân nhân -> cả 2 chiều xưng hô đổi theo cùng 1 sự kiện).
    applyCharField(c,'addrThemToMc','addrSource','addrThemToMcConflict',fat,!!corr.addressing,corr.reason,name,false,chapterIdx,true,fatone);
    applyCharField(c,'addrMcToThem','addrSource','addrMcToThemConflict',fam,!!corr.addressing,corr.reason,name,false,chapterIdx,true,fatone);
    // narrRef: không truyền newTone (bỏ trống) -> addrToneSameGroup() luôn trả null -> applyCharField
    // luôn CỘNG DỒN thay vì thay thế. Đây là chủ ý: các đại từ ngôi thứ 3 khác nhau theo sắc thái/góc
    // nhìn (VD "hắn" trung tính và "tên đó" của góc nhìn thù địch) đều ĐÚNG cùng lúc, không phải cái
    // sau thay thế cái trước như trường hợp quan hệ đổi hẳn của addrThemToMc/addrMcToThem.
    applyCharField(c,'narrRef','narrRefSource','narrRefConflict',fnarr,!!corr.narrRef,corr.reason,name,false,chapterIdx,true);
    // Soát lại TOÀN BỘ narrRef đang lưu của nhân vật này (không chỉ giá trị mới vừa merge ở trên) —
    // dọn luôn các câu miêu tả đã lỡ tích luỹ từ TRƯỚC bản sửa này, mỗi khi nhân vật được cập nhật
    // qua 1 chương mới. Bỏ qua nếu người dùng đã tự sửa/khoá narrRef (narrRefSource==='user').
    cleanupDescriptiveNarrRef(c);
    updateStatusCue(c,f.statusCue);
    if(fatone&&fatone!=='Chưa rõ')c.addrTone=fatone;
    appendAiNote(c,f.note);
    // Chỉ tính là "xuất hiện thêm 1 chương" nếu chương này CHƯA từng được tính cho nhân vật đó —
    // nhờ vậy khi người dùng bấm "Dịch lại" 1 chương đã dịch, số lần xuất hiện không bị tăng ảo.
    if(typeof chapterIdx==='number'){
      if(!Array.isArray(c.mentionChapters))c.mentionChapters=[];
      if(!c.mentionChapters.includes(chapterIdx))c.mentionChapters.push(chapterIdx);
    } else {
      c.mentionCount=(c.mentionCount||0)+1;
    }
    appeared.push(c);
  }
  return appeared;
}
// Giới hạn tổng độ dài note (chỉ áp dụng cho note do AI tự ghi, không đụng note người dùng tự viết)
// để tránh note phình to vô hạn qua hàng trăm chương. Khi vượt ngưỡng, bỏ bớt các đoạn CŨ NHẤT
// (nối ở đầu chuỗi), giữ lại thông tin gần đây/mới nhất — vì thông tin mới thường quan trọng hơn
// (VD thân phận thật vừa lộ ra) và các đoạn cũ dễ đã "lỗi thời" theo diễn biến truyện.
const CHARMEM_NOTE_MAX_CHARS=280;
function trimAiNote(note){
  let segs=(note||'').split('; ').filter(Boolean);
  while(segs.length>1&&segs.join('; ').length>CHARMEM_NOTE_MAX_CHARS)segs.shift();
  let out=segs.join('; ');
  if(out.length>CHARMEM_NOTE_MAX_CHARS)out=out.slice(out.length-CHARMEM_NOTE_MAX_CHARS).trim();
  return out;
}
// Ghi/nối thêm thông tin tổng quan (note) do AI tự phát hiện mỗi lần dịch — tích luỹ dần theo
// từng chương. Cùng nguyên tắc với gender/relationship: chỉ TÊN nhân vật mới ưu tiên dữ liệu
// người dùng tự nhập, note (dù người dùng từng tự viết) vẫn được AI tự động bổ sung thêm.
function appendAiNote(c,newNoteText){
  const t=(newNoteText||'').trim();
  if(!t)return;
  const existing=(c.note||'').trim();
  if(!existing){
    c.note=trimAiNote(t);c.noteSource='ai';
    console.log(`[Luồng 1][Cập nhật] Updated: ${c.name}.note`);
    return;
  }
  // Tách newNoteText thành từng đoạn nhỏ (note tích luỹ qua nhiều chương bằng dấu nối '; ') rồi chỉ
  // thêm đoạn nào CHƯA có sẵn — so theo TỪNG ĐOẠN thay vì so nguyên cụm t, để tránh lặp lại y hệt 1
  // đoạn đã có nếu model nhắc lại thông tin cũ kèm thông tin mới trong cùng 1 câu note của chương này.
  const existingLower=existing.toLowerCase();
  const segs=t.split(/;\s*/).map(s=>s.trim()).filter(Boolean);
  const newSegs=segs.filter(s=>!existingLower.includes(s.toLowerCase()));
  if(!newSegs.length)return;
  c.note=trimAiNote(existing+'; '+newSegs.join('; '));
  c.noteSource='ai';
  console.log(`[Luồng 1][Cập nhật] Updated: ${c.name}.note (appended)`);
}

// Cập nhật "vai vế/địa vị" (statusCue) — khác note (tích luỹ) và khác gender/relationship (correction
// có gate): đây là thông tin MÔ TẢ HIỆN TẠI, dễ tự nhiên thay đổi theo diễn biến truyện (VD tu vi lên
// cảnh giới mới, thăng chức...), nên chỉ đơn giản GHI ĐÈ bằng giá trị mới nhất do AI cung cấp — TRỪ
// khi người dùng đã tự tay chỉnh sửa field này trong modal (statusCueSource==='user'), lúc đó AI
// không tự động ghi đè nữa (giữ đúng nguyên tắc user > ai).
function updateStatusCue(c,newVal){
  const v=(newVal||'').normalize('NFC').trim();
  if(!v||v==='Chưa rõ')return;
  if(c.statusCueSource==='user')return;
  if(c.statusCue===v)return;
  c.statusCue=v;c.statusCueSource='ai';
  console.log(`[Luồng 1][Cập nhật] Updated: ${c.name}.statusCue -> ${v}`);
}

// ===== NHÂN VẬT CHÍNH =====
// Không tự ý gán nhân vật chính từ suy đoán 1 chương — chỉ đánh dấu nếu user đã xác nhận qua modal.
// (Người dùng có thể đặt cờ isProtagonist thủ công bằng cách chỉnh sửa; giữ đơn giản, không tự động đoán.)

// Gắn kèm SAU giá trị xưng hô cụ thể đã lưu 1 gợi ý ngắn về các biến thể CÙNG nhóm sắc thái (xem
// CHARMEM_ADDR_TONE_EXAMPLES) — không thay thế giá trị đã lưu, chỉ cho model dịch chính biết có
// "đường lui" nếu đúng câu đang dịch lệch giọng so với cách xưng hô thường ngày đã ghi nhận (VD nhân
// vật vốn xưng "muội/ca ca" nhưng đang giận dữ quát lên) — xem hướng dẫn sử dụng ở cuối
// buildCharacterContextText. Không hiện gợi ý nếu chưa xác định được nhóm sắc thái (addrTone
// "Chưa rõ" hoặc rỗng) vì khi đó không biết dựa vào nhóm nào để gợi ý cho đúng.
function addrToneExampleHint(tone){
  const t=(tone||'').trim();
  const examples=CHARMEM_ADDR_TONE_EXAMPLES[t];
  if(!examples||!examples.length)return '';
  return ` (nhóm sắc thái "${t}" — nếu câu này rõ ràng lệch giọng thường ngày, có thể cân nhắc biến thể cùng nhóm như: ${examples.join(', ')})`;
}

// ===== BUILD CONTEXT CHO REQUEST DỊCH =====
function buildCharacterContextText(appearedChars){
  if(!appearedChars||!appearedChars.length)return '';
  let out='Đảm bảo thông tin các nhân vật sau đây được dịch chính xác và nhất quán:\n\n';
  appearedChars.forEach((c,idx)=>{
    out+=`${idx+1}. Tên nhân vật: ${c.name}\n`;
    if(c.aliases&&c.aliases.length)out+=`   Tên gọi khác/biệt danh (CÙNG là người này): ${c.aliases.join(', ')}\n`;
    out+=`   Giới tính: ${c.gender||'Chưa rõ'}\n`;
    out+=`   Mối quan hệ với nhân vật chính: ${c.relationship||'Chưa rõ'}\n`;
    if(c.addrThemToMc&&!isAddrUnknown(c.addrThemToMc))out+=`   Khi nói với nhân vật chính, ${c.name} tự xưng/gọi (định dạng "tự xưng/gọi đối phương"): ${c.addrThemToMc}${addrToneExampleHint(c.addrTone)}\n`;
    if(c.addrMcToThem&&!isAddrUnknown(c.addrMcToThem))out+=`   Khi nhân vật chính nói với ${c.name}, tự xưng/gọi (định dạng "tự xưng/gọi đối phương"): ${c.addrMcToThem}${addrToneExampleHint(c.addrTone)}\n`;
    if(c.narrRef&&!isNarrRefUnknown(c.narrRef))out+=`   Cách gọi NGÔI THỨ 3 khi TƯỜNG THUẬT/nói VỀ ${c.name} (không phải khi nói trực tiếp với ${c.name}), các lựa chọn tuỳ góc nhìn: ${c.narrRef}\n`;
    if(c.statusCue&&c.statusCue.trim())out+=`   Vai vế/địa vị: ${c.statusCue.trim()}\n`;
    if(c.note&&c.note.trim())out+=`   Ghi chú: ${c.note.trim()}\n`;
    out+='\n';
  });
  out+='Yêu cầu:\n'+
    '- Nếu nhân vật được gọi trong bản gốc bằng một trong các "tên gọi khác/biệt danh" ở trên thay vì tên chính, vẫn phải áp dụng ĐÚNG giới tính, quan hệ, xưng hô của người đó — biệt danh không thay đổi giới tính hay danh tính của nhân vật.\n'+
    '- Giữ đúng giới tính của nhân vật.\n'+
    '- Giữ đúng quan hệ giữa nhân vật và nhân vật chính.\n'+
    '- Nếu đã có xưng hô cụ thể ở trên: mỗi giá trị gồm 1 hoặc nhiều cặp "tự xưng/gọi đối phương" (dấu "/" ngăn xưng và hô trong CÙNG 1 cặp, dấu phẩy ngăn các cặp khác nhau nếu có nhiều cách tuỳ ngữ cảnh) — ƯU TIÊN chọn nguyên 1 cặp trong số đó phù hợp nhất với đoạn hội thoại, không phối lẫn xưng của cặp này với hô của cặp khác. CHỈ khi KHÔNG cặp nào trong số đã cho khớp giọng của đúng câu đang dịch (VD nhân vật thường ngày xưng hô thân mật nhưng câu này đang giận dữ/mỉa mai/xa cách hẳn), mới được chọn thêm 1 biến thể CÙNG NHÓM SẮC THÁI đã ghi kèm (xem gợi ý trong ngoặc sau mỗi dòng xưng hô ở trên) — không tự đổi sang nhóm sắc thái khác hẳn (VD đang "Thân mật" thì không tự nhảy sang "Xa cách/Thù địch").\n'+
    '- ⚠ DANH XƯNG/CHỨC VỤ/TÊN RIÊNG dùng làm "gọi đối phương" (VD "đại trưởng lão", "bệ hạ", "tướng quân", "giáo sư") KHÁC HẲN đại từ nhân xưng ngôi 2 thuần tuý (VD "ngươi", "ngài", "cậu", "anh") về CÁCH DÙNG trong câu, dù cả 2 đều có thể xuất hiện trong cùng field xưng hô ở trên: đại từ ngôi 2 thật thì lặp lại tự nhiên ở MỌI vị trí câu cần chỉ "đối phương" (chủ ngữ, tân ngữ...), còn danh xưng/chức vụ/tên riêng thì tiếng Việt chỉ dùng ở vị trí HÔ GỌI tự nhiên (mở đầu câu để gọi ai đó, hoặc thỉnh thoảng nhấn mạnh sự trang trọng) — TUYỆT ĐỐI KHÔNG lặp lại y nguyên danh xưng/chức vụ đó ở MỌI vị trí trong đoạn hội thoại như thể nó là 1 đại từ, vì đọc lên sẽ rất máy móc/kỳ quặc. '+
    'VD SAI (lặp "đại trưởng lão" ở mọi câu như đại từ): "Đại trưởng lão đang làm gì thế? Để ta giúp đại trưởng lão, đại trưởng lão mệt rồi, đại trưởng lão cứ việc nghỉ ngơi." '+
    'VD ĐÚNG (chỉ hô gọi 1 lần, các câu sau dùng đại từ ngôi 2 hợp sắc thái hoặc lược hẳn chủ ngữ/tân ngữ theo cách tiếng Việt tự nhiên vẫn hiểu rõ đang nói với ai): "Đại trưởng lão đang làm gì thế? Để ta giúp người một tay. Người mệt rồi, cứ nghỉ ngơi đi." '+
    'Khi cần đại từ ngôi 2 thay thế cho các câu sau, chọn 1 đại từ hợp nhóm sắc thái/vai vế của danh xưng đó (tham khảo bảng gợi ý theo sắc thái ở trên, hoặc suy luận từ chính "Vai vế/địa vị" đã ghi) — không tự bịa danh xưng khác ngoài danh xưng gốc đã cho khi thực sự cần HÔ GỌI lại.\n'+
    '- ⚠ LƯU Ý về danh xưng huyết thống tiếng Việt — áp dụng cho MỌI thể loại, không riêng cổ trang/tu tiên: cả cặp cổ trang (ca ca/huynh, muội/tỷ) LẪN cặp hiện đại (anh/em, chị/em) đều có tính HAI CHIỀU giống nhau: CÙNG MỘT TỪ có thể vừa dùng để TỰ XƯNG (ngôi thứ nhất, VD người anh tự xưng "anh") vừa dùng để GỌI ĐỐI PHƯƠNG (ngôi thứ hai, VD người em gọi lại là "anh") — khi ghép câu thoại, PHẢI xác định đúng ai đang nói và đang nói VỀ/VỚI ai trước khi chọn từ, để không lỡ biến câu "anh về rồi" (em chào đón anh) thành "em về rồi" (tự thông báo mình về) hay ngược lại — đảo lộn hẳn ai mới là người đang được nhắc tới trong câu là lỗi nghiêm trọng hơn nhiều so với chỉ lệch sắc thái xưng hô, và lỗi này xảy ra y hệt ở truyện đô thị/hiện đại như ở truyện cổ trang/tu tiên.\n'+
    '- Nếu chưa có xưng hô cụ thể nhưng chương này có hội thoại trực tiếp giữa họ: nhãn "Mối quan hệ" ở trên chỉ xác định huyết thống/vai vế, KHÔNG phải chỉ định xưng hô (VD không mặc định "em gái" thì phải xưng "em") — tự chọn xưng hô hợp văn phong/bối cảnh của truyện và cách bản gốc đang thể hiện, ưu tiên phản ánh đúng "Vai vế/địa vị" nếu có ghi ở trên, nhất quán với các chương trước.\n'+
    '- Với danh xưng PHIẾM CHỈ không có căn cứ huyết thống thật (VD "cô nương", "công tử"...) trong bối cảnh cổ trang/tu tiên/kiếm hiệp: không tự cho nhân vật xưng bằng từ GIA ĐÌNH HIỆN ĐẠI (VD "cháu" khi đối phương xưng "chú"/"cô") trừ khi bản gốc xác nhận rõ có quan hệ họ hàng thật — chọn cách xưng hợp văn phong cổ trang, theo tương quan vai vế/tuổi tác thể hiện trong "Vai vế/địa vị" hoặc hội thoại.\n'+
    '- QUAN TRỌNG — phân biệt 2 loại xưng hô độc lập nhau: mục "tự xưng/gọi đối phương" CHỈ áp dụng cho lời THOẠI TRỰC TIẾP giữa 2 người, có thể là danh xưng/chức danh cụ thể (VD "bệ hạ"); mục "Cách gọi ngôi thứ 3 khi tường thuật" CHỈ áp dụng cho lời VĂN TRẦN THUẬT hoặc khi một nhân vật khác NHẮC TỚI người này mà không nói trực tiếp với họ, và luôn là đại từ trung tính/phiếm chỉ (VD "hắn", "tên đó") chứ không phải chức danh — không dùng nhầm lẫn giữa 2 mục, dù cùng 1 nhân vật có thể được thoại trực tiếp gọi bằng chức danh ("bệ hạ") nhưng bị tường thuật bằng đại từ mang sắc thái khinh miệt ("lão ta"), hoặc ngược lại.\n'+
    '- Nếu "Cách gọi ngôi thứ 3" có nhiều lựa chọn, chọn theo đúng góc nhìn của đoạn đang dịch tại thời điểm đó, không tự thêm lựa chọn ngoài danh sách đã cho.\n'+
    '- Không tự ý thay đổi thông tin nhân vật đã được cung cấp.\n'+
    '- Nếu thông tin là "Chưa rõ", không được tự biến nó thành thông tin cụ thể nếu bản gốc không cung cấp đủ bằng chứng.\n'+
    '- XƯNG HÔ GIỮA 2 NHÂN VẬT PHỤ (không ai trong 2 người là nhân vật chính): bộ nhớ ở trên CHỈ lưu xưng hô của từng người với RIÊNG nhân vật chính, KHÔNG có xưng hô đã lưu sẵn cho cặp phụ-phụ này. Khi 2 nhân vật phụ thoại trực tiếp với nhau, tự suy luận 1 cặp "tự xưng/gọi đối phương" hợp lý dựa trên "Mối quan hệ"/"Vai vế địa vị" của cả 2 người ở trên, thể loại và văn phong truyện, đối chiếu với bảng gợi ý theo sắc thái sau: '+
    Object.entries(CHARMEM_ADDR_TONE_EXAMPLES).map(([tone,ex])=>`${tone} (VD: ${ex.join(', ')})`).join('; ')+
    '. Chọn ĐÚNG 1 nhóm sắc thái phù hợp quan hệ giữa 2 người đó (thân mật/xã giao trung tính/kính trọng/thù địch...) rồi lấy 1 biến thể hợp thể loại — KHÔNG bắt buộc dùng đúng nguyên văn ví dụ trong bảng, đó chỉ là gợi ý minh hoạ cho từng nhóm. Một khi đã chọn xong cho 1 cặp nhân vật trong 1 đoạn hội thoại, PHẢI giữ NHẤT QUÁN cách xưng hô đó xuyên suốt cả đoạn thoại, không đổi qua đổi lại giữa các lượt nói của cùng 1 cặp.';
  return out;
}

// ===================================================================
// ===== TIỆN ÍCH XỬ LÝ FIELD XƯNG HÔ (nhiều-lựa-chọn "tự xưng/gọi đối phương") =====
// ===================================================================
// Chuẩn hoá để so khớp không phân biệt hoa/thường và cách dựng dấu tiếng Việt (NFC).
function normAddrWord(s){return (s||'').toLowerCase().normalize('NFC').trim();}
// Mỗi ô xưng hô lưu 1 hoặc NHIỀU "lựa chọn" (cách nhau bằng dấu phẩy (,), chấm phẩy (;) hoặc chữ
// "hoặc") — nhiều lựa chọn xảy ra khi nhân vật dùng nhiều cách xưng hô khác nhau tuỳ ngữ cảnh
// (VD lúc nghiêm túc "muội/ca ca", lúc nhõng nhẽo "tiểu muội/đại ca" — cả 2 đều đúng, không phải
// lỗi). MỖI lựa chọn tự nó là 1 cặp TRỌN VẸN "tự xưng/gọi đối phương" (xem parseAddrChoice) —
// dấu gạch chéo (/) KHÔNG phải là dấu ngăn cách giữa các lựa chọn, mà nằm BÊN TRONG 1 lựa chọn để
// tách xưng và hô. VD: "ta/ngươi, ta/ngài" = 2 lựa chọn hợp lệ; "ta/ngươi" KHÔNG được hiểu thành
// 2 lựa chọn rời "ta" và "ngươi" như trước đây (đó là bug cũ khiến "ta/ngươi" so với chính nó bị
// báo mâu thuẫn — vì so sánh nguyên cụm chưa tách với từng mảnh đã tách). Hàm này CHỈ tách theo
// lựa chọn (không đụng vào dấu /); dùng parseAddrChoice để tách tiếp xưng/hô trong 1 lựa chọn.
function splitAddrCandidates(raw){
  return (raw||'').split(/[,;]|\s+hoặc\s+/i).map(s=>s.trim()).filter(Boolean);
}
// Tách 1 lựa chọn xưng hô (đã lấy từ splitAddrCandidates) thành 2 phần theo dấu "/" ĐẦU TIÊN:
// {self: tự xưng, other: cách gọi đối phương}. Cho phép nhập tắt không có "/" khi chỉ muốn ghi
// cách gọi đơn thuần, không khai tự xưng — lúc đó self rỗng, other là cả chuỗi.
function parseAddrChoice(choice){
  const s=(choice||'').trim();
  const i=s.indexOf('/');
  if(i===-1)return{self:'',other:s};
  return{self:s.slice(0,i).trim(),other:s.slice(i+1).trim()};
}
// Coi 1 giá trị xưng hô là "chưa có dữ liệu" nếu: rỗng, đúng bằng "Chưa rõ", là 1 ký hiệu "rỗng"
// kiểu bảng biểu mà AI hay lỡ ghi thay vì "Chưa rõ" (VD "-", "n/a", "không có" — xem isPlaceholderJunk),
// HOẶC sau khi tách theo splitAddrCandidates thì TẤT CẢ các lựa chọn đều rơi vào 1 trong các trường
// hợp trên — bắt cả kiểu AI lỡ viết "Chưa rõ / Chưa rõ" hoặc "- / -" (nhầm áp dụng định dạng
// "tự xưng / gọi đối phương" cho lúc không xác định được, thay vì chỉ ghi đúng 1 chữ "Chưa rõ" như
// yêu cầu trong prompt). Dùng hàm này ở MỌI nơi cần hỏi "field xưng hô này đã có giá trị thật chưa"
// thay vì so sánh === 'Chưa rõ' trực tiếp — so === sẽ để lọt các ký hiệu rác này qua như 1 xưng hô
// "thật", rồi bị lưu vào nhân vật và gửi kèm vào prompt dịch như thể đã xác định được.
function isAddrUnknown(v){
  const t=(v||'').normalize('NFC').trim();
  if(!t)return true;
  const cands=splitAddrCandidates(t);
  if(!cands.length)return true;
  const isJunkWord=w=>w==='chưa rõ'||isPlaceholderJunk(w);
  return cands.every(x=>{
    const{self,other}=parseAddrChoice(x);
    const parts=[self,other].filter(Boolean);
    if(!parts.length)return isJunkWord(normAddrWord(x));
    // 1 lựa chọn (VD "Chưa rõ/Chưa rõ") chỉ coi là "chưa có dữ liệu" khi CẢ 2 phần xưng và hô
    // đều rỗng/rác — còn nếu chỉ 1 phần rác nhưng phần kia có giá trị thật (VD "Chưa rõ/ngươi")
    // thì vẫn coi là ĐÃ có dữ liệu (phần "hô" đã xác định được dù chưa rõ tự xưng).
    return parts.every(p=>isJunkWord(normAddrWord(p)));
  });
}
// Field narrRef ("đại từ ngôi thứ 3 TRUNG TÍNH/phiếm chỉ khi TƯỜNG THUẬT/nói VỀ nhân vật — khác
// addrThemToMc/addrMcToThem là xưng hô/chức danh khi nói TRỰC TIẾP VỚI nhau) dùng CHUNG định dạng
// nhiều-lựa-chọn (splitAddrCandidates) nhưng KHÔNG có khái niệm "tự xưng/gọi đối phương" (không tách
// theo "/") — mỗi lựa chọn chỉ là 1 đại từ ngôi thứ 3 phiếm chỉ độc lập (VD "hắn", "tên đó", "nàng").
// Coi là "chưa có dữ liệu" nếu rỗng, đúng "Chưa rõ", hoặc mọi lựa chọn sau khi tách đều là rác (xem
// isPlaceholderJunk).
function isNarrRefUnknown(v){
  const t=(v||'').normalize('NFC').trim();
  if(!t)return true;
  const cands=splitAddrCandidates(t);
  if(!cands.length)return true;
  return cands.every(x=>{
    const w=normAddrWord(x);
    return w==='chưa rõ'||isPlaceholderJunk(w);
  });
}
// LƯỚI AN TOÀN CẤP CODE cho narrRef (phòng khi model rẻ không tuân đúng prompt): loại bỏ khỏi
// narrRef bất kỳ lựa chọn nào TRÙNG Y NGUYÊN với "relationship" đang lưu — lỗi hay gặp nhất là model
// lười copy thẳng relationship (VD "Sư tỷ") vào narrRef thay vì đọc thật xem chương tường thuật gọi
// nhân vật đó bằng gì, dù bản chất "Sư tỷ" chỉ là NHÃN QUAN HỆ chứ không phải bằng chứng tường thuật
// thật. Chỉ loại đúng lựa chọn trùng, không đụng các lựa chọn khác nếu narrRef có nhiều lựa chọn.
function stripRelationshipCopyFromNarrRef(narrRefRaw,relationshipVals){
  if(isNarrRefUnknown(narrRefRaw))return narrRefRaw;
  const relSet=(relationshipVals||[]).map(normAddrWord).filter(r=>r&&r!=='chưa rõ');
  if(!relSet.length)return narrRefRaw;
  const kept=splitAddrCandidates(narrRefRaw).filter(x=>!relSet.includes(normAddrWord(x)));
  return kept.length?kept.join(', '):'Chưa rõ';
}
// Dọn dữ liệu nhân vật CŨ đã lỡ bị lưu nhầm giá trị "Chưa rõ"/"Chưa rõ / Chưa rõ" hoặc các ký hiệu
// "rỗng" kiểu bảng biểu (VD "-", "n/a", "không có"...) vào field xưng hô (do AI trả về sai định dạng
// prompt yêu cầu, hoặc bug encoding/định dạng ở các phiên bản trước) — reset về rỗng để field mở lại
// cho AI tự động điền đúng ở chương sau, và modal hiển thị ô trống thay vì hiện chữ rác. Đồng thời
// chuẩn hoá lại gender/relationship/statusCue về đúng literal "Chưa rõ" (NFC) nếu bị lệch encoding
// hoặc cũng là ký hiệu rác tương tự, để các so sánh === 'Chưa rõ' còn sót lại trong code không bị
// đánh lừa.
// QUAN TRỌNG: mọi bước dọn dưới đây CHỈ động vào field khi nguồn của nó KHÔNG PHẢI 'user' (tức đang
// do AI tự quản lý) — nếu bạn đã tự tay gõ/khoá 1 field nào đó trong modal (kể cả khi giá trị đó
// TRÙNG với ký hiệu "rác" theo isPlaceholderJunk, VD bạn cố tình gõ "-" để đánh dấu điều gì đó),
// giá trị đó KHÔNG bị đụng vào — giữ đúng nguyên tắc "user luôn được ưu tiên hơn ai" dùng nhất quán
// ở mọi nơi khác trong file này (xem applyCharField/userLocked, updateStatusCue). Trước bản sửa này,
// cleanup chạy vô điều kiện bất kể nguồn — cùng loại lỗ hổng đã phát hiện và vá riêng cho narrRef,
// nay áp dụng nhất quán cho toàn bộ field xưng hô/gender/relationship/statusCue.
// Trả về true nếu có ít nhất 1 nhân vật được dọn (để quyết định có cần lưu lại không).
function cleanupUnknownAddrValues(list){
  if(!Array.isArray(list))return false;
  let changed=false;
  list.forEach(c=>{
    if(c.addrSource!=='user'){
      if(c.addrThemToMc&&isAddrUnknown(c.addrThemToMc)){c.addrThemToMc='';changed=true;}
      if(c.addrMcToThem&&isAddrUnknown(c.addrMcToThem)){c.addrMcToThem='';changed=true;}
      if(!c.addrThemToMc&&!c.addrMcToThem&&c.addrTone&&c.addrTone!=='Chưa rõ'){c.addrTone='Chưa rõ';changed=true;}
    }
    if(c.narrRefSource!=='user'&&c.narrRef&&isNarrRefUnknown(c.narrRef)){c.narrRef='';changed=true;}
    if(c.genderSource!=='user'&&c.gender&&isUnknownVal(c.gender)&&c.gender!=='Chưa rõ'){c.gender='Chưa rõ';changed=true;}
    if(c.relationshipSource!=='user'&&c.relationship&&isUnknownVal(c.relationship)&&c.relationship!=='Chưa rõ'){c.relationship='Chưa rõ';changed=true;}
    if(c.statusCueSource!=='user'&&c.statusCue&&isUnknownVal(c.statusCue)&&c.statusCue!==''){c.statusCue='';changed=true;}
    if(cleanupLabelDuplicateFromExistingNarrRef(c))changed=true;
    if(cleanupDescriptiveNarrRef(c))changed=true;
  });
  if(changed)console.log('[Luồng 1][Dọn dữ liệu cũ] Đã dọn xưng hô "Chưa rõ" bị lưu nhầm ở dữ liệu cũ (chỉ với field do AI tự quản lý).');
  return changed;
}
// Dọn narrRef CŨ đã lỡ bị lưu trùng y hệt relationship/statusCue của chính nhân vật đó (lỗi model
// copy nhãn thay vì đọc tường thuật thật — xem stripRelationshipCopyFromNarrRef). CHỈ áp dụng khi
// narrRefSource !== 'user': nếu bạn đã tự tay gõ/khoá narrRef trong modal (kể cả khi giá trị đó
// TRÙNG với relationship/statusCue — có thể truyện của bạn cố tình dùng lối xưng hô đó), giá trị
// KHÔNG bị đụng vào.
function cleanupLabelDuplicateFromExistingNarrRef(c){
  if(c.narrRefSource==='user')return false;
  if(!c.narrRef||isNarrRefUnknown(c.narrRef))return false;
  const stripped=stripRelationshipCopyFromNarrRef(c.narrRef,[c.relationship,c.statusCue]);
  const normalizedStripped=isNarrRefUnknown(stripped)?'':stripped;
  if(normalizedStripped!==c.narrRef){
    console.log(`[Luồng 1][Dọn dữ liệu cũ] Dọn narrRef trùng nhãn (chỉ vì đây là giá trị AI tự điền, không phải do bạn khoá) cho "${c.name}": "${c.narrRef}" -> "${normalizedStripped||'(rỗng)'}"`);
    c.narrRef=normalizedStripped;
    return true;
  }
  return false;
}