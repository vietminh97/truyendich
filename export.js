// ===================================================================
// export.js — Xuất/tải xuống truyện dạng TXT và EPUB (tách từ index.html)
//
// Classic script (không type="module") — dùng chung global scope với khối
// <script> chính, giống cách tts.js/translate.js đã tách. Các hàm/biến ở đây
// (S, setStatus, applyReplace, stripTitle, cleanCensorChars, esc...) vẫn đọc/
// gọi bình thường qua global scope; XLATED_TAG_RE cũng được dùng lại ở phần
// SPLIT (nhận diện chương đã dịch lúc import lại) trong index.html.
// ===================================================================

// ===== DOWNLOAD TOÀN BỘ TRUYỆN (thay thế các chương đã dịch) =====
// Hậu tố "[ Dịch ]" chèn vào cuối tiêu đề các chương ĐÃ DỊCH lúc xuất file TXT/EPUB — hiển thị
// công khai (không ẩn) để người đọc cũng nhận biết được, đồng thời để tool tự nhận diện lại khi
// import file này (hoặc file đã dịch từ nơi khác có gắn thẻ tương tự) — coi nội dung (vốn đã là
// bản dịch) làm luôn bản dịch, không dịch nhầm/dịch lại từ đầu. Chỉ hoạt động đáng tin cậy ở chế độ
// chia chương theo MẪU TIÊU ĐỀ (không áp dụng cho chế độ chia theo số ký tự).
const XLATED_SUFFIX=' [ Dịch ]';
// Nhận diện các biến thể thẻ đánh dấu "đã dịch" ở tiêu đề chương: [ Dịch ], [Dịch], (Dịch), ( Dịch )...
// không phân biệt hoa/thường chữ D (theo yêu cầu người dùng), để nhận cả file dịch từ nơi khác.
const XLATED_TAG_RE=/[\(\[]\s*[Dd]ịch\s*[\)\]]/;
// ===== POPUP CHỌN KHOẢNG CHƯƠNG KHI TẢI XUỐNG TXT/EPUB =====
let _dlRangeFormat='txt';
function showDownloadRangePopup(format){
  _dlRangeFormat=format;
  document.getElementById('dlRangeTitle').textContent='Tải xuống '+(format==='epub'?'EPUB':'TXT');
  document.getElementById('dlFromChapter').value='';
  document.getElementById('dlToChapter').value='';
  document.getElementById('dlRangeOverlay').classList.add('show');
}
function closeDlRangePopup(){
  document.getElementById('dlRangeOverlay').classList.remove('show');
}
document.getElementById('dlRangeOverlay').addEventListener('mousedown',function(e){if(e.target===this)closeDlRangePopup();});
function confirmDownloadRange(){
  const total=S.chapters?S.chapters.length:0;
  const fromRaw=document.getElementById('dlFromChapter').value.trim();
  const toRaw=document.getElementById('dlToChapter').value.trim();
  let from=parseInt(fromRaw,10);
  if(!fromRaw||isNaN(from))from=1;
  let to;
  if(!toRaw||/^cu[oố]i\s*c[uù]ng$/i.test(toRaw)){
    to=total;
  } else {
    to=parseInt(toRaw,10);
    if(isNaN(to))to=total;
  }
  if(from<1)from=1;
  if(to>total)to=total;
  if(from>to){setStatus('Khoảng chương không hợp lệ ("Tải từ chương" phải nhỏ hơn hoặc bằng "Tới chương").',4000);return;}
  closeDlRangePopup();
  if(_dlRangeFormat==='epub')downloadFullStoryEpub(from,to);
  else downloadFullStory(from,to);
}
function downloadFullStory(fromCh,toCh){
  if(!S.chapters||S.chapters.length===0){setStatus('Chưa có truyện nào để tải xuống.',3000);return;}
  const total=S.chapters.length;
  const from=Math.max(1,fromCh||1);
  const to=Math.min(total,toCh||total);
  let translatedCount=0;
  const parts=[];
  for(let i=from-1;i<to;i++){
    const ch=S.chapters[i];
    const trans=S.translations[i];
    // Luôn xoá tiêu đề cũ (gốc hoặc do AI trả về) rồi chèn lại tiêu đề chuẩn theo cách chia chương của tool
    // Ưu tiên dùng tiêu đề ĐÃ DỊCH (S.translatedTitles) nếu có, kể cả khi nội dung
    // chương CHƯA dịch — người đọc vẫn biết chương nói về gì dù thân bài còn Hán tự.
    let body,title=S.translatedTitles[i]||ch.title;
    if(trans){
      translatedCount++;
      body=cleanCensorChars(applyReplace(stripTitle(trans,ch.title)));
      if(!XLATED_TAG_RE.test(title))title=title+XLATED_SUFFIX; // tránh gắn trùng nếu tiêu đề đã có sẵn thẻ
    } else {
      body=applyReplace(stripTitle(ch.content,ch.title));
    }
    parts.push((title+'\n\n'+body).trimEnd());
  }
  const fullText=parts.join('\n\n\n');
  const baseName=(S.fname||'truyen.txt').replace(/\.txt$/i,'');
  const rangeSuffix=(from===1&&to===total)?'':(' (ch.'+from+'-'+to+')');
  const outName=baseName+rangeSuffix+' (đã dịch '+translatedCount+'-'+(to-from+1)+').txt';
  const blob=new Blob([fullText],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=outName;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  setStatus(`Đã tải xuống truyện (${translatedCount}/${to-from+1} chương đã dịch).`,4000);
}
// ===== DOWNLOAD TOÀN BỘ TRUYỆN DẠNG EPUB =====
function epubUuid(){
  try{if(crypto&&crypto.randomUUID)return crypto.randomUUID();}catch(e){}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
    const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);
  });
}
function textToXhtmlParagraphs(text){
  return text.split(/\n{2,}/).map(function(block){
    block=block.trim();
    if(!block)return '';
    // giữ ngắt dòng đơn (vd: thoại từng dòng) bằng <br/>
    const lines=block.split(/\n/).map(function(l){return esc(l);});
    return '<p>'+lines.join('<br/>')+'</p>';
  }).filter(Boolean).join('\n');
}
async function downloadFullStoryEpub(fromCh,toCh){
  if(!S.chapters||S.chapters.length===0){setStatus('Chưa có truyện nào để tải xuống.',3000);return;}
  if(typeof JSZip==='undefined'){setStatus('Chưa tải được thư viện tạo EPUB (JSZip). Kiểm tra kết nối mạng rồi thử lại.',4000);return;}
  setStatus('Đang tạo file EPUB...',60000);
  try{
    const total=S.chapters.length;
    const from=Math.max(1,fromCh||1);
    const to=Math.min(total,toCh||total);
    let translatedCount=0;
    const chapterData=[];
    for(let i=from-1;i<to;i++){
      const ch=S.chapters[i];
      const trans=S.translations[i];
      // Ưu tiên dùng tiêu đề ĐÃ DỊCH (S.translatedTitles) nếu có, kể cả khi nội dung
      // chương CHƯA dịch — mục lục EPUB vẫn hiển thị tên chương tiếng Việt.
      let body,title=S.translatedTitles[i]||ch.title;
      if(trans){
        translatedCount++;
        body=cleanCensorChars(applyReplace(stripTitle(trans,ch.title)));
        if(!XLATED_TAG_RE.test(title))title=title+XLATED_SUFFIX; // tránh gắn trùng nếu tiêu đề đã có sẵn thẻ
      }else{
        body=applyReplace(stripTitle(ch.content,ch.title));
      }
      chapterData.push({title:title,body:body.trimEnd()});
    }
    const baseName=(S.fname||'truyen').replace(/\.(txt|epub)$/i,'');
    const bookId=epubUuid();
    const nowIso=new Date().toISOString().replace(/\.\d+Z$/,'Z');

    const zip=new JSZip();
    zip.file('mimetype','application/epub+zip',{compression:'STORE'});
    zip.folder('META-INF').file('container.xml',
      '<?xml version="1.0" encoding="UTF-8"?>\n'+
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'+
      '  <rootfiles>\n'+
      '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n'+
      '  </rootfiles>\n'+
      '</container>');

    const oebps=zip.folder('OEBPS');
    oebps.file('style.css',
      'body{font-family:serif;line-height:1.6;margin:1em;}\n'+
      'h1{font-size:1.3em;margin:0 0 1em;text-align:center;}\n'+
      'p{margin:0 0 1em;text-indent:1.5em;}\n'+
      'nav ol{list-style:none;padding-left:1em;}');

    const chapFolder=oebps.folder('chapters');
    const manifestItems=[];
    const spineItems=[];
    const navPoints=[];
    const ncxPoints=[];

    chapterData.forEach(function(ch,i){
      const id='chap'+String(i+1).padStart(4,'0');
      const fname=id+'.xhtml';
      const xhtml=
        '<?xml version="1.0" encoding="UTF-8"?>\n'+
        '<!DOCTYPE html>\n'+
        '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="vi" lang="vi">\n'+
        '<head><title>'+esc(ch.title)+'</title>\n'+
        '<link rel="stylesheet" type="text/css" href="../style.css"/></head>\n'+
        '<body>\n<h1>'+esc(ch.title)+'</h1>\n'+textToXhtmlParagraphs(ch.body)+'\n</body>\n</html>';
      chapFolder.file(fname,xhtml);
      manifestItems.push('    <item id="'+id+'" href="chapters/'+fname+'" media-type="application/xhtml+xml"/>');
      spineItems.push('    <itemref idref="'+id+'"/>');
      navPoints.push('      <li><a href="chapters/'+fname+'">'+esc(ch.title)+'</a></li>');
      ncxPoints.push(
        '    <navPoint id="np'+(i+1)+'" playOrder="'+(i+1)+'">\n'+
        '      <navLabel><text>'+esc(ch.title)+'</text></navLabel>\n'+
        '      <content src="chapters/'+fname+'"/>\n'+
        '    </navPoint>');
    });

    oebps.file('nav.xhtml',
      '<?xml version="1.0" encoding="UTF-8"?>\n'+
      '<!DOCTYPE html>\n'+
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="vi" lang="vi">\n'+
      '<head><title>Mục lục</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n'+
      '<body>\n<nav epub:type="toc" id="toc"><h1>Mục lục</h1><ol>\n'+navPoints.join('\n')+'\n</ol></nav>\n</body>\n</html>');

    oebps.file('toc.ncx',
      '<?xml version="1.0" encoding="UTF-8"?>\n'+
      '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n'+
      '  <head>\n'+
      '    <meta name="dtb:uid" content="urn:uuid:'+bookId+'"/>\n'+
      '  </head>\n'+
      '  <docTitle><text>'+esc(baseName)+'</text></docTitle>\n'+
      '  <navMap>\n'+ncxPoints.join('\n')+'\n  </navMap>\n'+
      '</ncx>');

    oebps.file('content.opf',
      '<?xml version="1.0" encoding="UTF-8"?>\n'+
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">\n'+
      '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'+
      '    <dc:identifier id="BookId">urn:uuid:'+bookId+'</dc:identifier>\n'+
      '    <dc:title>'+esc(baseName)+'</dc:title>\n'+
      '    <dc:language>vi</dc:language>\n'+
      '    <meta property="dcterms:modified">'+nowIso+'</meta>\n'+
      '  </metadata>\n'+
      '  <manifest>\n'+
      '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n'+
      '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n'+
      '    <item id="css" href="style.css" media-type="text/css"/>\n'+
      manifestItems.join('\n')+'\n'+
      '  </manifest>\n'+
      '  <spine toc="ncx">\n'+spineItems.join('\n')+'\n  </spine>\n'+
      '</package>');

    const blob=await zip.generateAsync({type:'blob',mimeType:'application/epub+zip'});
    const rangeSuffix=(from===1&&to===total)?'':(' (ch.'+from+'-'+to+')');
    const outName=baseName+rangeSuffix+' (đã dịch '+translatedCount+'-'+(to-from+1)+').epub';
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=outName;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(url);},2000);
    setStatus('Đã tải xuống EPUB ('+translatedCount+'/'+(to-from+1)+' chương đã dịch).',4000);
  }catch(err){
    console.error(err);
    setStatus('Lỗi khi tạo EPUB: '+(err&&err.message?err.message:err),5000);
  }
}
