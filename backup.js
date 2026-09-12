// ===================================================================
// backup.js — Sao lưu/khôi phục dữ liệu: Google Drive + file .json local
// (tách từ index.html)
//
// Classic script (không type="module") — dùng chung global scope với khối
// <script> chính, giống tts.js/translate.js/export.js đã tách. Các hàm ở
// đây gọi ngược lại nhiều hàm còn ở index.html (S, setStatus, showPopup,
// saveSession, libGetAll, openLibDB, libGet, libPut, libLoad, loadSettings,
// loadPresets/savePresets/initPresets, etLoadRules, chNum...) — tất cả đều
// gọi bên trong hàm (deferred), không có lệnh chạy ngay khi nạp trang, nên
// thứ tự nạp so với các script khác không quan trọng.
// ===================================================================

// ===== GOOGLE DRIVE BACKUP (Google Identity Services, chỉ chạy phía trình duyệt) =====
// Lưu ý: KHÔNG đặt Client Secret ở đây — luồng "token client" này chỉ cần Client ID,
// và Client Secret không bao giờ được để trong code phía trình duyệt vì ai xem
// mã nguồn trang cũng đọc được (sẽ bị lộ ngay cả khi bạn không public code này).
const DRIVE_CLIENT_ID='937124838897-5r7k23h9sfriip4d5mdb2lsd51qv5r36.apps.googleusercontent.com';
const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
let _driveTokenClient=null;
let _driveAccessToken=null;
let _driveTokenExpiry=0;

function ensureDriveToken(){
  return new Promise((resolve,reject)=>{
    if(_driveAccessToken&&Date.now()<_driveTokenExpiry-60000){resolve(_driveAccessToken);return;}
    if(!window.google||!google.accounts||!google.accounts.oauth2){
      reject(new Error('Google Identity Services chưa tải xong (kiểm tra mạng rồi thử lại).'));return;
    }
    if(!_driveTokenClient){
      _driveTokenClient=google.accounts.oauth2.initTokenClient({
        client_id:DRIVE_CLIENT_ID,
        scope:DRIVE_SCOPE,
        callback:()=>{}
      });
    }
    _driveTokenClient.callback=(resp)=>{
      if(resp.error){reject(new Error(resp.error));return;}
      _driveAccessToken=resp.access_token;
      _driveTokenExpiry=Date.now()+((resp.expires_in||3600)*1000);
      resolve(_driveAccessToken);
    };
    _driveTokenClient.error_callback=(err)=>{reject(new Error(err&&err.message?err.message:'Đăng nhập Google bị hủy'));};
    _driveTokenClient.requestAccessToken({prompt:_driveAccessToken?'':''});
  });
}

async function driveUploadJSON(filename,obj){
  const token=await ensureDriveToken();
  const boundary='dichtr_backup_'+Date.now();
  const metadata={name:filename,mimeType:'application/json'};
  const body=
    '--'+boundary+'\r\n'+
    'Content-Type: application/json; charset=UTF-8\r\n\r\n'+
    JSON.stringify(metadata)+'\r\n'+
    '--'+boundary+'\r\n'+
    'Content-Type: application/json\r\n\r\n'+
    JSON.stringify(obj)+'\r\n'+
    '--'+boundary+'--';
  const res=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',{
    method:'POST',
    headers:{
      'Authorization':'Bearer '+token,
      'Content-Type':'multipart/related; boundary="'+boundary+'"'
    },
    body
  });
  if(!res.ok)throw new Error('Tải lên Drive thất bại (HTTP '+res.status+')');
  return res.json();
}

async function driveListBackups(){
  const token=await ensureDriveToken();
  const q=encodeURIComponent("name contains 'backup-' and mimeType='application/json' and trashed=false");
  const res=await fetch('https://www.googleapis.com/drive/v3/files?q='+q+'&orderBy=createdTime desc&fields=files(id,name,createdTime)&pageSize=30',{
    headers:{'Authorization':'Bearer '+token}
  });
  if(!res.ok)throw new Error('Không lấy được danh sách file trên Drive (HTTP '+res.status+')');
  const j=await res.json();
  return j.files||[];
}

async function driveDeleteFile(fileId){
  const token=await ensureDriveToken();
  const res=await fetch('https://www.googleapis.com/drive/v3/files/'+fileId,{
    method:'DELETE',
    headers:{'Authorization':'Bearer '+token}
  });
  // 404 nghĩa là file đã bị xoá từ trước (vd xoá tay trên Drive) — coi như thành công, không cần báo lỗi
  if(!res.ok&&res.status!==404)throw new Error('Không xoá được file trên Drive (HTTP '+res.status+')');
}

// Số bản backup muốn giữ lại cho MỖI loại (toàn bộ / cài đặt / tủ truyện)
const DRIVE_BACKUP_KEEP=3;

// Dọn dẹp backup cũ trên Drive: chỉ giữ lại DRIVE_BACKUP_KEEP bản mới nhất của CÙNG loại vừa upload,
// xoá hết phần còn thừa. Chạy sau khi upload xong; nếu có lỗi thì chỉ log ra console (không setStatus lỗi)
// vì bản backup mới vẫn đã lưu thành công, không nên khiến người dùng tưởng backup thất bại.
async function driveCleanupOldBackups(type){
  try{
    const files=await driveListBackups(); // đã sort createdTime desc
    const sameType=files.filter(f=>backupTypeOfFilename(f.name)===type);
    const toDelete=sameType.slice(DRIVE_BACKUP_KEEP);
    for(const f of toDelete){
      try{await driveDeleteFile(f.id);}catch(e){console.warn('Xoá backup cũ thất bại:',f.name,e);}
    }
  }catch(e){
    console.warn('Dọn dẹp backup cũ trên Drive thất bại:',e);
  }
}

async function driveDownloadJSON(fileId){
  const token=await ensureDriveToken();
  const res=await fetch('https://www.googleapis.com/drive/v3/files/'+fileId+'?alt=media',{
    headers:{'Authorization':'Bearer '+token}
  });
  if(!res.ok)throw new Error('Không tải được file từ Drive (HTTP '+res.status+')');
  return res.json();
}

function destChoiceHTML(label){
  return '<div style="margin:10px 0 4px;">'+
    '<label id="popupDestChoice" data-dest="json" for="popupDestSwitch" '+
      'style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border2);border-radius:10px;cursor:pointer;width:100%;box-sizing:border-box;" '+
      'onclick="toggleDriveDest(event)">'+
      '<span style="width:31px;height:31px;border-radius:8px;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">'+
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-13.095 -19.5 113.49 117" style="width:25px;height:25px;">'+
          '<path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>'+
          '<path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 000 53h27.5z" fill="#00ac47"/>'+
          '<path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.5c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z" fill="#ea4335"/>'+
          '<path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>'+
          '<path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>'+
          '<path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>'+
        '</svg>'+
      '</span>'+
      '<div style="flex:1;min-width:0;font-size:14px;font-weight:500;">'+label+'</div>'+
      '<span id="popupDestSwitch" style="width:40px;height:24px;border-radius:12px;background:var(--border2);position:relative;flex-shrink:0;transition:background .15s;">'+
        '<span id="popupDestKnob" style="position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.3);"></span>'+
      '</span>'+
    '</label>'+
  '</div>';
}
function toggleDriveDest(e){
  if(e)e.preventDefault();
  const wrap=document.getElementById('popupDestChoice');
  const cur=wrap?wrap.dataset.dest:'json';
  setPopupDest(cur==='drive'?'json':'drive',true);
}
const LS_DRIVE_DEST='dich-drive-dest';
function setPopupDest(dest,persist){
  const wrap=document.getElementById('popupDestChoice');
  if(wrap)wrap.dataset.dest=dest;
  const sw=document.getElementById('popupDestSwitch');
  const knob=document.getElementById('popupDestKnob');
  if(sw&&knob){
    if(dest==='drive'){
      sw.style.background='var(--accent)';
      knob.style.left='18px';
    }else{
      sw.style.background='var(--border2)';
      knob.style.left='2px';
    }
  }
  // Ghi nhớ lựa chọn Drive/File cho lần sau — chỉ khi người dùng chủ động bấm chuyển (persist=true),
  // không ghi khi đang khởi tạo popup từ giá trị đã lưu.
  if(persist){try{localStorage.setItem(LS_DRIVE_DEST,dest);}catch(e){}}
}
// Đọc lựa chọn Drive/File đã lưu từ lần trước để khởi tạo trạng thái công tắc trong popup
function getSavedPopupDest(){
  try{return localStorage.getItem(LS_DRIVE_DEST)==='drive'?'drive':'json';}catch(e){return 'json';}
}
function getPopupDest(){
  const wrap=document.getElementById('popupDestChoice');
  return (wrap&&wrap.dataset.dest==='drive')?'drive':'json';
}

// ===== BACKUP & RESTORE =====
async function doBackup(type){
  // Flush bản dịch đang trong RAM vào IndexedDB/localStorage trước khi export
  if((type==='library'||type==='all')&&S.fname){
    await saveSession();
  }
  const data={version:'1.0',type,exportedAt:new Date().toISOString()};
  if(type==='settings'||type==='all'){
    data.settings=JSON.parse(localStorage.getItem('ds')||'{}');
    data.theme=localStorage.getItem('dt');
    data.auto=localStorage.getItem('dich-auto');
    data.presets=loadPresets();
    data.etRules=JSON.parse(localStorage.getItem('dich-et-rules')||'[]'); // quy tắc "Sửa text" (popup mới)
  }
  if(type==='library'||type==='all'){
    const allBooks=await libGetAll();
    // Merge bản dịch từ localStorage vào các book chưa có translations trong IndexedDB
    // (trường hợp fallback: IndexedDB bị chặn hoặc chưa saveSession lần nào)
    for(const bk of allBooks){
      if(!bk.translations||Object.keys(bk.translations).length===0){
        const lsKey='dich-tr:'+(bk.fname||bk.name+'.txt');
        try{
          const v=localStorage.getItem(lsKey);
          if(v){const d=JSON.parse(v);if(d&&d.translations&&Object.keys(d.translations).length>0){bk.translations=d.translations;bk.cur=d.cur??bk.cur;bk.ts=d.ts??bk.ts;bk.chapterTitles=d.chapterTitles??bk.chapterTitles;}}
        }catch(e){}
      }
    }
    data.library=allBooks;
    // Bản dịch + vị trí chương đang đọc (localStorage dich-tr:*) — giữ lại để tương thích restore cũ
    const sessions={};
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k&&k.startsWith('dich-tr:')){
        try{const v=JSON.parse(localStorage.getItem(k));if(v)sessions[k]=v;}catch(e){}
      }
    }
    data.sessions=sessions;
    // Bookmark (dich-bm:*)
    const bookmarks={};
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k&&k.startsWith('dich-bm:')){
        try{const v=JSON.parse(localStorage.getItem(k));if(v)bookmarks[k]=v;}catch(e){}
      }
    }
    data.bookmarks=bookmarks;
  }
  const suffix=type==='all'?'toan-bo':type==='settings'?'cai-dat':'tu-truyen';
  const filename='backup-'+suffix+'-'+new Date().toISOString().slice(0,10)+'.json';

  if(getPopupDest()==='drive'){
    setStatus('Đang đăng nhập & tải lên Google Drive...');
    try{
      await driveUploadJSON(filename,data);
      setStatus('Đã sao lưu lên Google Drive!',3500);
      // Dọn backup cũ ở nền, không đợi/không chặn UI (đã báo thành công ở trên rồi)
      driveCleanupOldBackups(type);
    }catch(e){
      setStatus('Lỗi sao lưu Drive: '+e.message,5000);
    }
    return;
  }

  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;
  a.download=filename;
  a.click();URL.revokeObjectURL(url);
  setStatus('Xuất file backup thành công!',3000);
}

function showBackupPopup(){
  const dlIco='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  const libIco='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  const setIco='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  showPopup({
    title:'Sao lưu dữ liệu',
    msg:'Chọn dữ liệu muốn xuất ra file <strong>.json</strong> để chuyển sang thiết bị khác.'+destChoiceHTML('Sao lưu vào Google Drive'),
    btns:[
      {label:'___all___',cls:'btn-p',cb:()=>doBackup('all')},
      {label:'___set___',cls:'btn',cb:()=>doBackup('settings')},
      {label:'___lib___',cls:'btn',cb:()=>doBackup('library')},
      {label:'Hủy',cls:'btn'},
    ]
  });
  setPopupDest(getSavedPopupDest());
  setTimeout(()=>{
    const btns=document.querySelectorAll('#popupBtns .btn');
    if(btns[0])btns[0].innerHTML=dlIco+'Toàn bộ';
    if(btns[1])btns[1].innerHTML=setIco+'Cài đặt';
    if(btns[2])btns[2].innerHTML=libIco+'Tủ truyện';
  },20);
}

function showRestorePopup(){
  const ulIco='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  const libIco='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  const setIco='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  showPopup({
    title:'Khôi phục dữ liệu',
    msg:'Chọn loại dữ liệu muốn khôi phục.<br><span style="color:var(--accent);font-size:12px;margin-top:6px;display:block;">&#9888; Sẽ ghi đè dữ liệu hiện tại.</span>'+destChoiceHTML('Khôi phục từ Google Drive'),
    btns:[
      {label:'___all___',cls:'btn-p',cb:()=>pickRestoreSource('all')},
      {label:'___set___',cls:'btn',cb:()=>pickRestoreSource('settings')},
      {label:'___lib___',cls:'btn',cb:()=>pickRestoreSource('library')},
      {label:'Hủy',cls:'btn'},
    ]
  });
  setPopupDest(getSavedPopupDest());
  setTimeout(()=>{
    const btns=document.querySelectorAll('#popupBtns .btn');
    if(btns[0])btns[0].innerHTML=ulIco+'Toàn bộ';
    if(btns[1])btns[1].innerHTML=setIco+'Cài đặt';
    if(btns[2])btns[2].innerHTML=libIco+'Tủ truyện';
  },20);
}

let _restoreType='all';

function pickRestoreSource(type){
  if(getPopupDest()==='drive')pickRestoreFileFromDrive(type);
  else pickRestoreFile(type);
}

function pickRestoreFile(type){
  _restoreType=type;
  const fi=document.getElementById('restoreFileInput');
  fi.value='';fi.click();
}

// Suy ra loại backup ('all'|'settings'|'library') từ tên file, dựa theo suffix do doBackup() đặt tên
function backupTypeOfFilename(name){
  if(/^backup-toan-bo-/.test(name))return 'all';
  if(/^backup-cai-dat-/.test(name))return 'settings';
  if(/^backup-tu-truyen-/.test(name))return 'library';
  return null;
}

// Chuyển tên file backup thành nhãn tiếng Việt dễ đọc, vd: backup-tu-truyen-2026-08-26.json -> "Backup tủ truyện 26/08/2026"
// displayType (tuỳ chọn): ép nhãn hiển thị theo loại đang restore ('all'|'settings'|'library') thay vì loại thực
// của file — dùng khi file nguồn là bản "toàn bộ" nhưng chỉ đang restore riêng phần cài đặt/tủ truyện,
// để tránh người dùng hiểu nhầm là sẽ khôi phục toàn bộ.
function backupDisplayName(name,displayType){
  const m=name.match(/^backup-(toan-bo|cai-dat|tu-truyen)-(\d{4})-(\d{2})-(\d{2})\.json$/);
  if(!m)return name;
  const t=displayType==='all'?'toan-bo':displayType==='settings'?'cai-dat':displayType==='library'?'tu-truyen':m[1];
  const label=t==='toan-bo'?'Backup toàn bộ':t==='cai-dat'?'Backup cài đặt':'Backup tủ truyện';
  return label+' '+m[4]+'/'+m[3]+'/'+m[2];
}

// files đã được sắp xếp mới nhất trước (orderBy=createdTime desc), nên find() luôn trả bản mới nhất của từng loại
// So sánh createdTime giữa file riêng và file "toàn bộ" để chọn file nào thực sự mới hơn,
// thay vì luôn ưu tiên file riêng bất kể thời gian.
function newerFile(a,b){
  if(!a)return b;
  if(!b)return a;
  return new Date(a.createdTime).getTime()>=new Date(b.createdTime).getTime()?a:b;
}
function pickBackupSources(files,type){
  const allFile=files.find(f=>backupTypeOfFilename(f.name)==='all');
  const setFile=files.find(f=>backupTypeOfFilename(f.name)==='settings');
  const libFile=files.find(f=>backupTypeOfFilename(f.name)==='library');
  if(type==='settings')return {settings:newerFile(setFile,allFile)};
  if(type==='library')return {library:newerFile(libFile,allFile)};
  // type === 'all': so sánh thời gian để chọn nguồn mới nhất cho từng phần (settings/library),
  // giữa bản riêng lẻ và bản "toàn bộ"
  const bestSettings=newerFile(setFile,allFile);
  const bestLibrary=newerFile(libFile,allFile);
  if(bestSettings||bestLibrary)return {settings:bestSettings,library:bestLibrary};
  return {all:allFile};
}

async function pickRestoreFileFromDrive(type){
  setStatus('Đang đăng nhập & tải danh sách backup từ Drive...');
  let files;
  try{files=await driveListBackups();}catch(e){setStatus('Lỗi Drive: '+e.message,5000);return;}
  if(!files.length){setStatus('Không tìm thấy file backup nào trên Drive.',4000);return;}
  const src=pickBackupSources(files,type);
  setStatus('');

  if(!src.all&&!src.settings&&!src.library){
    setStatus('Không tìm thấy bản sao lưu phù hợp trên Drive.',4000);return;
  }

  if(type==='all'&&src.all){
    // Chỉ có bản "toàn bộ" — khôi phục trực tiếp từ 1 file
    const f=src.all;
    showPopup({
      title:'Khôi phục từ Drive',
      msg:'Bản sao lưu mới nhất: <b>'+backupDisplayName(f.name)+'</b><br><span style="color:var(--accent);font-size:12px;">&#9888; Sẽ ghi đè dữ liệu hiện tại.</span>',
      btns:[
        {label:backupDisplayName(f.name),cls:'btn-p',cb:()=>restoreFromDriveFile(f.id,'all')},
        {label:'Hủy',cls:'btn'},
      ]
    });
    return;
  }
  if(type==='all'){
    // Gộp bản sao lưu tủ truyện + cài đặt riêng lẻ (mới nhất mỗi loại)
    const names=[
      src.settings?backupDisplayName(src.settings.name,'settings'):null,
      src.library?backupDisplayName(src.library.name,'library'):null
    ].filter(Boolean).join('</b> và <b>');
    showPopup({
      title:'Khôi phục từ Drive',
      msg:'Sẽ khôi phục từ: <b>'+names+'</b><br><span style="color:var(--accent);font-size:12px;">&#9888; Sẽ ghi đè dữ liệu hiện tại.</span>',
      btns:[
        {label:'Khôi phục',cls:'btn-p',cb:()=>restoreAllFromDriveFiles(src.settings,src.library)},
        {label:'Hủy',cls:'btn'},
      ]
    });
    return;
  }
  // type === 'settings' hoặc 'library': dùng bản riêng nếu có, không thì fallback về bản "toàn bộ"
  // (nhãn hiển thị luôn ép theo `type` đang restore, tránh gây hiểu nhầm khi nguồn thực là bản "toàn bộ")
  const f=src.settings||src.library;
  showPopup({
    title:'Khôi phục từ Drive',
    msg:'Bản sao lưu mới nhất: <b>'+backupDisplayName(f.name,type)+'</b><br><span style="color:var(--accent);font-size:12px;">&#9888; Sẽ ghi đè dữ liệu hiện tại.</span>',
    btns:[
      {label:backupDisplayName(f.name,type),cls:'btn-p',cb:()=>restoreFromDriveFile(f.id,type)},
      {label:'Hủy',cls:'btn'},
    ]
  });
}

async function restoreFromDriveFile(fileId,type){
  setStatus('Đang tải file từ Drive...');
  let data;
  try{data=await driveDownloadJSON(fileId);}catch(e){setStatus('Lỗi Drive: '+e.message,5000);return;}
  await applyRestoreData(data,type);
}

// Khôi phục "toàn bộ" từ 2 file riêng lẻ (cài đặt + tủ truyện), dùng khi không có bản backup "toàn bộ" gộp sẵn
async function restoreAllFromDriveFiles(settingsFile,libraryFile){
  setStatus('Đang tải file từ Drive...');
  try{
    if(settingsFile){
      const data=await driveDownloadJSON(settingsFile.id);
      await applyRestoreData(data,'settings');
    }
    if(libraryFile&&(!settingsFile||libraryFile.id!==settingsFile.id)){
      const data=await driveDownloadJSON(libraryFile.id);
      await applyRestoreData(data,'library');
    }
    setStatus('Khôi phục thành công! Mở truyện trong tủ để tiếp tục đọc.',5000);
  }catch(e){setStatus('Lỗi Drive: '+e.message,5000);}
}

async function doRestoreFile(input){
  const file=input.files[0];if(!file)return;
  let data;
  try{data=JSON.parse(await file.text());}catch{setStatus('File không hợp lệ',4000);return;}
  await applyRestoreData(data,_restoreType);
}

async function applyRestoreData(data,type){
  if(type==='settings'||type==='all'){
    if(data.settings)localStorage.setItem('ds',JSON.stringify(data.settings));
    if(data.theme)localStorage.setItem('dt',data.theme);
    if(data.auto!=null)localStorage.setItem('dich-auto',data.auto);
    if(data.presets&&Array.isArray(data.presets)&&data.presets.length){savePresets(data.presets);initPresets();}
    // Quy tắc "Sửa text" (popup mới) — chỉ ghi đè khi file backup có sẵn field này
    // (backup từ bản mới); backup từ bản CŨ không có field này, để etRules hiện tại
    // nguyên vẹn cho loadSettings() bên dưới di chuyển (migrate) quy tắc "A=B" cũ vào.
    if(data.etRules&&Array.isArray(data.etRules)){
      localStorage.setItem('dich-et-rules',JSON.stringify(data.etRules));
      if(typeof etLoadRules==='function')etLoadRules(); // nạp lại vào biến etRules trong bộ nhớ
    }
    loadSettings();
  }
  if(type==='library'||type==='all'){
    // Khôi phục tủ truyện (IndexedDB)
    if(data.library&&Array.isArray(data.library)){
      const db=await openLibDB();
      // QUAN TRỌNG: phải ghi CẢ 2 store trong CÙNG 1 transaction — 'books' (đầy đủ) và
      // META_STORE/'booksMeta' (bản nhẹ dùng để hiển thị tủ truyện). Trước đây chỗ này
      // chỉ ghi vào 'books' rồi gọi libLoad() — nhưng libLoad() giờ đọc danh sách tủ
      // truyện từ META_STORE, nên phục hồi xong META_STORE vẫn trống/cũ → tủ truyện
      // trông như "không đọc được" dù dữ liệu đầy đủ đã nằm đúng trong 'books'.
      await new Promise(resolve=>{
        const tx=db.transaction([LIB_STORE,META_STORE],'readwrite');
        const store=tx.objectStore(LIB_STORE);
        const metaStore=tx.objectStore(META_STORE);
        store.clear();
        metaStore.clear();
        for(const bk of data.library){
          store.put(bk);
          metaStore.put(bookToMeta(bk));
        }
        tx.oncomplete=resolve;
        tx.onerror=resolve;
        tx.onabort=resolve;
      });
      await libLoad();
    }
    // Khôi phục bản dịch + vị trí chương đang đọc
    if(data.sessions){
      // Xóa session cũ trước
      const oldKeys=[];
      for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('dich-tr:'))oldKeys.push(k);}
      oldKeys.forEach(k=>localStorage.removeItem(k));
      // Ghi session mới — gia hạn TTL về hiện tại để không bị xóa ngay
      for(const [k,v] of Object.entries(data.sessions)){
        try{v.ts=Date.now();localStorage.setItem(k,JSON.stringify(v));}catch(e){}
      }
    }
    // Khôi phục bookmark
    if(data.bookmarks){
      const oldBm=[];
      for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('dich-bm:'))oldBm.push(k);}
      oldBm.forEach(k=>localStorage.removeItem(k));
      for(const [k,v] of Object.entries(data.bookmarks)){
        try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}
      }
    }
  }
  setStatus('Khôi phục thành công! Mở truyện trong tủ để tiếp tục đọc.',5000);
}