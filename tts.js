/* tts.js — Đọc văn bản (TTS) */
(function () {
  'use strict';

  // Preconnect/dns-prefetch tới archive.org càng sớm càng tốt để phát nhạc nền cùng audio
  ['https://archive.org', 'https://ia801500.us.archive.org'].forEach(origin => {
    ['preconnect', 'dns-prefetch'].forEach(rel => {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = origin;
      if (rel === 'preconnect') link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    });
  });

  const DEFAULT_VOICE = 'vi-VN-HoaiMyNeural';
  const DEFAULT_VOLUME = 80;
  // Danh sách nhạc nền
  const BGM_TRACKS = [
    { id: 'bgm1', name: 'Nhạc Trung 1', url: 'https://archive.org/download/background-chinese/Background%20Chinese%201.mp3' },
    { id: 'bgm2', name: 'Nhạc Trung 2', url: 'https://archive.org/download/background-chinese/Background%20Chinese%202.mp3' },
    { id: 'bgm3', name: 'Nhạc Trung 3', url: 'https://archive.org/download/background-chinese/Background%20Chinese%203.mp3' },
    { id: 'bgm4', name: 'Mưa và piano 1', url: 'https://archive.org/download/no-ads-rain-and-soft-piano-for-healing-sleep-relaxing-music-to-calm-the-mind-and-soothe-the-soul/Rain%20and%20Piano.mp3' },
    { id: 'bgm5', name: 'Mưa và piano 2', url: 'https://archive.org/download/pianoinstrumentrain/Piano%20Instrument%20Rain.mp3' },
    { id: 'bgm7', name: 'Mưa rơi', url: 'https://ia600603.us.archive.org/33/items/rain-on-roof/Rain%20On%20Roof.mp3' },
    { id: 'bgm6', name: 'Piano 1', url: 'https://archive.org/download/beautifulpianomusicvol1/Beautiful%20Piano%20Music%2C%20Vol%20%201.mp3' },
    { id: 'bgm8', name: 'Piano 2', url: 'https://archive.org/download/no-ads-rain-and-soft-piano-for-healing-sleep-relaxing-music-to-calm-the-mind-and-soothe-the-soul/Piano%202.mp3' },
    { id: 'bgm9', name: 'Piano 3', url: 'https://archive.org/download/no-ads-rain-and-soft-piano-for-healing-sleep-relaxing-music-to-calm-the-mind-and-soothe-the-soul/Piano%203.mp3' },
    { id: 'bgm10', name: 'Piano cùng thiên nhiên', url: 'https://archive.org/download/no-ads-rain-and-soft-piano-for-healing-sleep-relaxing-music-to-calm-the-mind-and-soothe-the-soul/Piano%204.mp3' },
  ];
  const DEFAULT_BGM_TRACK = 'bgm1';
  const DEFAULT_BGM_VOLUME = 20;
  // Các mốc tốc độ hiển thị
  const SPEED_STEPS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  // Bộ tốc độ thay thế — bật lên khi bấm icon sóng âm trạng thái, bấm lại
  // lần nữa để quay về bộ mặc định ở trên (xem rebuildSpeedButtons()).
  const SPEED_STEPS_ALT = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75];
  let speedStepsMode = 'default'; // 'default' | 'alt'
  const DEFAULT_SPEED = 1;
  // Số chunk tổng hợp giọng đọc thất bại LIÊN TIẾP tối đa trước khi coi là
  // mất mạng/lỗi kéo dài và DỪNG HẲN — thay vì cứ lỗi là "bỏ qua đoạn này"
  // rồi tua sang chunk kế tiếp vô hạn. Trước đây không có ngưỡng này nên
  // khi mất mạng, mọi chunk còn lại của chương (và cả chương kế tiếp, do
  // "Tự động chuyển chương") đều lỗi gần như tức thời → tua nhanh hết cả
  // chương trong im lặng (không có tiếng đọc), chỉ thấy highlight/tiến độ
  // vẫn chạy và thậm chí tự nhảy sang chương sau.
  const MAX_CONSECUTIVE_SYNTH_FAILURES = 5;
  const CHUNK0_RACE_SERVERS = 4;
  const SYNTH_RATE = '+0%';

  // ─── Icon SVG ─────────────────────────────
  const ICON_PLAY = '<svg class="tts-ico-play" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  const ICON_PAUSE = '<svg class="tts-ico-play" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
  // Icon "Dừng" (ô vuông) — thay cho icon Tạm dừng khi người dùng đã rời
  // khỏi chương đang phát (xem state.chapterDetached / setUIState).
  const ICON_STOP = '<svg class="tts-ico-play" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';
  // Icon "đoạn trước/sau" kiểu skip (vạch + tam giác), khớp với thiết kế cụm
  // play/prev/next mới (xem .tts-transport trong tts.css).
  const ICON_PREV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>';
  const ICON_NEXT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>';
  const ICON_BACK10 = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/><text x="12" y="15" text-anchor="middle" font-size="8" font-family="system-ui,sans-serif" font-weight="bold" stroke="none" fill="currentColor">10</text></svg>';
  const ICON_FORWARD10 = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/><text x="12" y="15" text-anchor="middle" font-size="8" font-family="system-ui,sans-serif" font-weight="bold" stroke="none" fill="currentColor">10</text></svg>';
  const ICON_LIGHTNING = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
  const ICON_VOLUME = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
  // Icon trạng thái (chấm tròn cũ đổi thành sóng âm 4 vạch) — đổi màu theo
  // trạng thái qua CSS (currentColor) thay vì đổi background như chấm tròn
  // trước đây.
  const ICON_STATUS_WAVE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="4" y1="15" x2="4" y2="9"/><line x1="9" y1="19" x2="9" y2="5"/><line x1="14" y1="17" x2="14" y2="7"/><line x1="19" y1="13" x2="19" y2="11"/></svg>';
  const ICON_CLOSE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const ICON_HEADPHONE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
  const ICON_MIC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  const ICON_CHEVRON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const ICON_CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const ICON_GEAR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  const ICON_MUSIC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  // Icon cho 2 công tắc trong Cài đặt: "Tự động chuyển chương" và
  // "Cuộn theo audio" — bị thiếu khi mang khung sườn từ file demo qua nên
  // trước đó gây lỗi ReferenceError lúc buildUI() chạy (khiến bấm nút Nghe
  // không thấy thanh audio hiện ra).
  const ICON_AUTOCHAPTER = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/><path d="m16 12 5 3-5 3v-6Z"/></svg>';
  const ICON_FOLLOWSCROLL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg>';
  // Icon cho công tắc "Nổi bật đoạn văn" (highlight đoạn đang đọc) — bút dạ
  // quang, tách riêng khỏi ICON_FOLLOWSCROLL (nay chỉ dùng cho "Tự động cuộn").
  const ICON_HIGHLIGHT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h3l6-6"/><path d="m14.5 6.5 3 3"/><path d="M16 3l5 5-6.5 6.5-5-5L16 3z"/></svg>';

  // ─── Danh sách giọng đọc ─────────────────────────────────
  // engine: 'edge' (mặc định, dùng Cloudflare Workers bên dưới) hoặc
  // 'tiktok' (dùng WebSocket TikTok TTS riêng, xem synthesizeTikTok()).
  const VOICES = [
    { id: 'vi-VN-HoaiMyNeural', label: 'Edge - Hoài My', engine: 'edge' },
    { id: 'vi-VN-NamMinhNeural', label: 'Edge - Nam Minh', engine: 'edge' },
    { id: 'BV074_streaming', label: 'Tiktok - Cô gái hoạt ngôn', engine: 'tiktok' },
    { id: 'BV421_vivn_streaming', label: 'Tiktok - Cô gái ngọt ngào', engine: 'tiktok' },
    { id: 'BV075_streaming', label: 'Tiktok - Thanh niên tự tin', engine: 'tiktok' },
    { id: 'vi_female_huong', label: 'Tiktok - Giọng nữ phổ thông', engine: 'tiktok' },
  ];
  const VOICE_ENGINE = new Map(VOICES.map(v => [v.id, v.engine || 'edge']));

  // ─── Cloudflare Workers ───────
  const SERVERS = [
    { url: 'https://edge-tts1.lilbabyfroggie.workers.dev/tts', type: 'auto' },
    { url: 'https://egde-tts2.quangnguyen251325.workers.dev/tts', type: 'auto' },
    { url: 'https://edge-tts3.hoannguyen251325.workers.dev/tts', type: 'auto' },
    { url: 'https://edge-tts4.manhnguyen251325.workers.dev/tts', type: 'auto' },
    { url: 'https://edge-tts5.thienco-tcc.workers.dev/tts', type: 'auto' },
    { url: 'https://edge-tts6.odes-agency.workers.dev/tts', type: 'auto' },
    { url: 'https://edge-tts7.thiencocac-tradecoin.workers.dev/tts', type: 'auto' },
    { url: 'https://edge-tts8.baileyserena1161.workers.dev/tts', type: 'auto' },
    { url: 'https://edge-tts9.leroyswanson351.workers.dev/tts', type: 'auto' },
    { url: 'https://edge-tts10.peayhoward.workers.dev/tts', type: 'auto' },
    { url: 'https://msedge-tts-json.nickmonty777.workers.dev/tts-json', type: 'json' },
    { url: 'https://msedge-tts-json.nickmonty2020.workers.dev/tts-json', type: 'json' },
  ];
  function b64ToBlob(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'audio/mpeg' });
  }
  let serverIndex = 0;
  async function fetchWorker(server, text, voice, rate, timeoutMs = 3500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, rate, pitch: '+0Hz', volume: '+0%' }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      const isAudio = ct.includes('audio') || (server.type === 'auto' && !ct.includes('json'));
      if (isAudio) return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
      const j = await res.json();
      const b64 = j.audio?.dataBase64 || j.audio?.data || (typeof j.audio === 'string' ? j.audio : null) || j.data || j.audioData || j.result;
      return b64 ? b64ToBlob(b64) : null;
    } catch (e) { clearTimeout(timer); return null; }
  }

  function raceBatchFast(batch, text, voice, rate, timeoutMs = 3500) {
    return new Promise((resolve) => {
      let pending = batch.length;
      if (!pending) { resolve(null); return; }
      let done = false;

      batch.forEach((server, idx) => {
        const startTime = Date.now();
        fetchWorker(server, text, voice, rate, timeoutMs).then(blob => {
          if (done) return;
          if (blob) {
            done = true;
            server.lastLatency = Date.now() - startTime;
            server.failCount = 0;
            resolve({ blob, serverIndexInBatch: idx });
          } else {
            server.failCount = (server.failCount || 0) + 1;
            pending--;
            if (pending === 0 && !done) {
              done = true;
              resolve(null);
            }
          }
        }).catch(() => {
          if (done) return;
          server.failCount = (server.failCount || 0) + 1;
          pending--;
          if (pending === 0 && !done) {
            done = true;
            resolve(null);
          }
        });
      });
    });
  }

  async function raceWorkers(text, voice, rate, raceCount = 4) {
    const sortedPool = [...SERVERS].sort((a, b) => {
      const failA = a.failCount || 0;
      const failB = b.failCount || 0;
      if (failA !== failB) return failA - failB;
      const latA = a.lastLatency || 9999;
      const latB = b.lastLatency || 9999;
      return latA - latB;
    });

    const pool = [];
    for (let k = 0; k < sortedPool.length; k++) {
      pool.push(sortedPool[(serverIndex + k) % sortedPool.length]);
    }
    while (pool.length) {
      const batch = pool.splice(0, raceCount);
      const res = await raceBatchFast(batch, text, voice, rate, 3500);
      if (res && res.blob) {
        const foundServer = batch[res.serverIndexInBatch];
        const realIdx = SERVERS.indexOf(foundServer);
        if (realIdx !== -1) serverIndex = realIdx;
        return res.blob;
      }
    }
    return null;
  }

  // ─── TikTok TTS (giọng riêng, qua WebSocket của TikTok) ─────────────
  // Hoàn toàn tách biệt với hàng Edge TTS (SERVERS/fetchWorker/raceWorkers)
  // ở trên — không dùng chung code, không dùng chung cache logic, chỉ dùng
  // chung "hình dạng" kết quả trả về: Promise<Blob|null>.
  const TIKTOK_WS_URL = 'wss://sami-normal-sg.capcutapi.com/internal/api/v1/ws?device_id=7486429558272460289&iid=7486431924195657473&app_id=359289&region=VN&update_version_code=5.7.1.2101&version_code=5.7.1&appKey=ddjeqjLGMn&device_type=macos&device_platform=macos';
  const TIKTOK_TOKEN = 'WTV6R2t6V3ZwNUIwQkFETutGxuveRZ9iTmOBC/a3wzMS7zzza86Ky9nIfYhyeoSiWYP1ZO04X7X1+RThg/zczU6u8ga3dTIJpduvWpCqrmr0Kv7BJf6tcGFgevJ/Jaa1slHj/l4NUJ/eCesl1dYBYQ51oKbuFnZjF7qXVWzsoz326XwRdNEmOufSHnuW+kuy+sS7K/sn3gVWsCC4XFi+FYntDxrVTYS/Pv2LtBgpgULmib5+5kMq2ZuJfCDYvq4NthciciB6KUCf1sOsu7VD/27Tquz8Q58NYALFvX85bjvxQJOz0iV3oUiip0RyqR1ltZPNI/LgN2OGCphyCgOJdlUUdgIbSJpaKL+5PMTM4yBuwCU4QPbYYzTs9x2ZA+7zt41ng+i5+EPtePyDjR4VFTz+7zglLw/E+KqN/nscyqLCyrumn4YgfQ3JYnSnz1WLE6q3aD175yweKBj9f9jyqxnLVmEYy9VjmoxuYNRgVmfT6M17bT9iL0PJTlJ6UqKHuNRT6ubv37ZSr961Gw+RJhyLUDBt8AD1B8YDdF4OImS+LgGjfujaY1agc4tfrnk4V4YcAXyTRlYwLMC9ATDp9CbiBrlMBmYm88gwGaTR9pbI2KcQ4Kg86jZYc6CxNM34sbMG/1LlmqvqLe+E3IG6ebOmyVbL+kYK70c1fT5TcmzVwX5O3JGkHHtFoeCmd4Eyyov6QsO1Jewx0gpjp05dqw==';

  // Trước đây mỗi chunk mở 1 WebSocket mới rồi đóng ngay sau khi xong.
  // Bắt tay WebSocket (mở TCP/TLS + handshake) tốn thời gian thật, cộng
  // dồn vào độ trễ MỖI chunk. Ở tốc độ nghe cao (2x-3x), thời lượng PHÁT
  // mỗi chunk co lại (playbackRate) nhưng thời gian TỔNG HỢP chunk kế
  // (network round-trip) không đổi → dễ hết buffer, gây khựng (gap).
  //
  // Cách mới: DÙNG CHUNG 1 kết nối WebSocket cho nhiều chunk liên tiếp
  // (mở 1 lần, gửi nhiều StartTask tuần tự trên cùng kết nối, chỉ mở lại
  // khi kết nối cũ đã đóng/lỗi hoặc đã rảnh quá lâu) — bớt hẳn chi phí
  // bắt tay lặp lại mỗi chunk. Vẫn giữ NGUYÊN nguyên tắc "1 tác vụ tại 1
  // thời điểm" (TIKTOK_CONCURRENCY = 1 ở dưới không đổi) nên không có 2
  // task chạy chồng cùng lúc dùng chung 1 token phiên — chỉ khác là chúng
  // giờ tuần tự trên CÙNG 1 kết nối thay vì mỗi task 1 kết nối riêng.
  const TIKTOK_IDLE_CLOSE_MS = 20000; // rảnh quá lâu thì đóng, tránh giữ WS chết không dùng
  let tiktokSocket = null;      // WebSocket đang mở và sẵn sàng dùng
  let tiktokSocketReady = null; // Promise<WebSocket|null> đang chờ mở kết nối (tránh mở trùng)
  let tiktokIdleTimer = null;

  function closeTiktokSocket() {
    clearTimeout(tiktokIdleTimer);
    if (tiktokSocket) { try { tiktokSocket.close(); } catch (_) {} }
    tiktokSocket = null;
    tiktokSocketReady = null;
  }

  function scheduleTiktokIdleClose() {
    clearTimeout(tiktokIdleTimer);
    tiktokIdleTimer = setTimeout(closeTiktokSocket, TIKTOK_IDLE_CLOSE_MS);
  }

  // Mở (hoặc tái sử dụng) kết nối WebSocket dùng chung cho TikTok TTS.
  function ensureTiktokSocket() {
    if (tiktokSocket && tiktokSocket.readyState === WebSocket.OPEN) {
      return Promise.resolve(tiktokSocket);
    }
    if (tiktokSocketReady) return tiktokSocketReady;

    tiktokSocketReady = new Promise((resolve) => {
      let ws;
      try { ws = new WebSocket(TIKTOK_WS_URL); } catch (e) { tiktokSocketReady = null; resolve(null); return; }
      ws.binaryType = 'arraybuffer';
      const openTimer = setTimeout(() => {
        try { ws.close(); } catch (_) {}
        tiktokSocketReady = null;
        resolve(null);
      }, 5000);

      ws.onopen = () => {
        clearTimeout(openTimer);
        tiktokSocket = ws;
        // Hẹn giờ tự đóng NGAY từ lúc mở kết nối — không chỉ sau khi 1
        // task hoàn tất. Cần thiết vì ensureTiktokSocket() giờ còn được
        // gọi để "prewarm" (mở sớm khi chọn giọng, xem selectVoice())
        // mà không có task nào theo sau ngay — nếu không hẹn giờ ở đây,
        // trường hợp người dùng mở thanh đọc rồi không bấm Play sẽ để
        // WebSocket treo mở vô thời hạn, không bao giờ tự đóng.
        // synthesizeTikTokRaw() vẫn sẽ clearTimeout(tiktokIdleTimer) khi
        // có task thật chạy, nên không xung đột gì với luồng cũ.
        scheduleTiktokIdleClose();
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(openTimer);
        if (tiktokSocket === ws) tiktokSocket = null;
        tiktokSocketReady = null;
        resolve(null);
      };
      ws.onclose = () => {
        if (tiktokSocket === ws) tiktokSocket = null;
        tiktokSocketReady = null;
      };
      // onmessage được gán riêng cho từng task trong synthesizeTikTokRaw()
      // ngay trước khi gửi StartTask — không gán cố định ở đây.
    });
    return tiktokSocketReady;
  }

  // Gửi 1 task StartTask trên 1 kết nối WebSocket (dùng chung hoặc tạm thời,
  // xem 2 hàm gọi bên dưới) và đợi TaskEnd/TaskFailed rồi mới resolve. Tách
  // riêng phần "gửi task + nghe kết quả" này ra khỏi việc MỞ kết nối, để
  // dùng chung được cho cả kết nối dùng chung (synthesizeTikTokRaw) lẫn kết
  // nối tạm mở riêng cho chunk "vượt rào" khi bị delay quá lâu
  // (synthesizeTikTokIsolated, xem runTikTokQueue()).
  function runTiktokTaskOnSocket(ws, text, speaker) {
    return new Promise((resolve) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) { resolve(null); return; }

      const chunks = [];
      let done = false;
      const hardTimer = setTimeout(() => finish(null), 20000);

      const onSocketDown = () => finish(null);
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(hardTimer);
        ws.onmessage = null;
        ws.removeEventListener('close', onSocketDown);
        ws.removeEventListener('error', onSocketDown);
        resolve(result);
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.event === 'TaskFailed') {
              finish(null);
            } else if (msg.event === 'TaskEnd' || msg.event === 'TaskFinished') {
              const total = chunks.reduce((s, c) => s + c.length, 0);
              const buf = new Uint8Array(total);
              let off = 0;
              for (const c of chunks) { buf.set(c, off); off += c.length; }
              finish(new Blob([buf], { type: 'audio/mpeg' }));
            }
          } catch {}
        } else if (event.data instanceof ArrayBuffer) {
          chunks.push(new Uint8Array(event.data));
        }
      };

      ws.addEventListener('close', onSocketDown);
      ws.addEventListener('error', onSocketDown);

      try {
        ws.send(JSON.stringify({
          appkey: 'ddjeqjLGMn',
          event: 'StartTask',
          namespace: 'TTS',
          payload: JSON.stringify({
            audio_config: { bit_rate: 128000, format: 'mp3', sample_rate: 24000 },
            speaker,
            text: (text || '').trim(),
          }),
          token: TIKTOK_TOKEN,
          version: 'sdk_v1',
        }));
      } catch (e) { finish(null); }
    });
  }

  // Chạy 1 task trên kết nối WebSocket DÙNG CHUNG (mở/tái sử dụng qua
  // ensureTiktokSocket() — xem lý do gộp kết nối ở comment phía trên). Đây
  // là đường đi BÌNH THƯỜNG cho mọi chunk.
  function synthesizeTikTokRaw(text, speaker) {
    return (async () => {
      const ws = await ensureTiktokSocket();
      if (!ws || ws.readyState !== WebSocket.OPEN) return null;
      clearTimeout(tiktokIdleTimer);
      const result = await runTiktokTaskOnSocket(ws, text, speaker);
      scheduleTiktokIdleClose();
      return result;
    })();
  }

  // Chạy 1 task trên 1 kết nối WebSocket TẠM THỜI, mở RIÊNG cho task này rồi
  // đóng lại ngay khi xong — KHÔNG đụng tới kết nối dùng chung (tiktokSocket)
  // để không tranh onmessage với task đang chạy trên đó. Chỉ dùng cho chunk
  // "vượt rào" khi chunk đang chạy trên kết nối dùng chung bị delay quá lâu
  // (xem TIKTOK_MAX_CHUNK_DELAY_MS trong runTikTokQueue()) — vì vậy vẫn có
  // lúc 2 kết nối TikTok cùng mở dùng chung 1 token, nhưng CHỈ xảy ra khi
  // thật sự cần (1 chunk bị kẹt) chứ không phải mặc định luôn song song.
  function synthesizeTikTokIsolated(text, speaker) {
    return new Promise((resolve) => {
      let ws;
      try { ws = new WebSocket(TIKTOK_WS_URL); } catch (e) { resolve(null); return; }
      ws.binaryType = 'arraybuffer';
      const openTimer = setTimeout(() => { try { ws.close(); } catch (_) {} resolve(null); }, 5000);
      ws.onopen = () => {
        clearTimeout(openTimer);
        runTiktokTaskOnSocket(ws, text, speaker).then(result => {
          try { ws.close(); } catch (_) {}
          resolve(result);
        });
      };
      ws.onerror = () => { clearTimeout(openTimer); resolve(null); };
    });
  }

  // Edge TTS bắn song song thoải mái vì mỗi request là 1 HTTP call
  // stateless tới nhiều Cloudflare Workers khác nhau (xem prefetch() ở
  // dưới: bắn trước luôn 5 chunk cùng lúc). TikTok TTS thì khác — mỗi
  // chunk là 1 WebSocket nhưng DÙNG CHUNG 1 token phiên (TIKTOK_TOKEN,
  // gắn với 1 device_id). Nếu bắn nhiều WebSocket cùng lúc dùng chung 1
  // token, dễ bị server TikTok từ chối/rớt kết nối vì trông giống truy
  // cập bất thường trên cùng 1 phiên — nên MẶC ĐỊNH vẫn giữ tuần tự
  // tuyệt đối (1 kết nối tại 1 thời điểm, TIKTOK_CONCURRENCY = 1). Để bù
  // lại tốc độ, chunk cho giọng TikTok được nới dài hơn
  // (TIKTOK_SENTENCES_PER_CHUNK, xem phần chia chunk phía dưới) thay vì
  // tăng số kết nối song song theo mặc định.
  const TIKTOK_CONCURRENCY = 1;
  // "Max delay": nếu 1 chunk đang tổng hợp mà quá thời gian này vẫn CHƯA
  // xong, không tiếp tục chờ nó chặn cả hàng đợi nữa — chủ động bắn trước
  // chunk dự bị (chunk kế tiếp trong hàng đợi) qua 1 kết nối tạm riêng
  // (synthesizeTikTokIsolated), để các chunk sau vẫn tiếp tục tổng hợp
  // được bình thường. Chunk chậm vẫn tiếp tục chạy nốt trên kết nối dùng
  // chung — khi nó xong, promise của đúng job đó resolve, và vì
  // state.cache (xem getChunkBlob()) đã gắn theo ĐÚNG chỉ số chunk ngay từ
  // đầu nên kết quả tự động "nối" đúng vào vị trí của nó, không cần logic
  // ghép nối gì thêm.
  const TIKTOK_MAX_CHUNK_DELAY_MS = 1500;
  let tiktokActive = 0;      // số task đang chạy thật sự (dùng chung + tạm)
  let tiktokExtraSlots = 0;  // số "vé" vượt rào đã cấp do delay, trả lại khi task chậm xong
  const tiktokQueue = [];
  function runTikTokQueue() {
    if (!tiktokQueue.length) return;
    if (tiktokActive >= TIKTOK_CONCURRENCY + tiktokExtraSlots) return;
    const job = tiktokQueue.shift();
    tiktokActive++;
    // Task đầu tiên đang rảnh chỗ dùng kết nối chung (rẻ, tái sử dụng);
    // mọi task "vượt rào" (chỉ chạy được nhờ tiktokExtraSlots > 0, tức là
    // kết nối chung đang bận vì có chunk khác chạy chậm) dùng kết nối tạm.
    const useShared = tiktokActive === 1;
    let grantedExtra = false;
    const delayTimer = setTimeout(() => {
      grantedExtra = true;
      tiktokExtraSlots++;
      runTikTokQueue();
    }, TIKTOK_MAX_CHUNK_DELAY_MS);
    const synthPromise = useShared
      ? synthesizeTikTokRaw(job.text, job.speaker)
      : synthesizeTikTokIsolated(job.text, job.speaker);
    synthPromise.then(result => {
      clearTimeout(delayTimer);
      tiktokActive--;
      if (grantedExtra) tiktokExtraSlots = Math.max(0, tiktokExtraSlots - 1);
      job.resolve(result);
      runTikTokQueue();
    });
  }

  // Chỉ dùng kênh WebSocket ở trên (đã bỏ hẳn kênh REST dùng cookie phiên
  // đăng nhập TikTok trước đây) — mọi chunk giọng TikTok đều xếp hàng qua
  // tiktokQueue/runTikTokQueue().
  function synthesizeTikTok(text, speaker) {
    return new Promise((resolve) => {
      tiktokQueue.push({ text, speaker, resolve });
      runTikTokQueue();
    });
  }

  async function synthesize(text, voice, rate, raceCount = 1) {
    // Giọng TikTok đi qua WebSocket riêng, không qua hàng Cloudflare
    // Workers (SERVERS) mà Edge TTS đang dùng — logic Edge TTS giữ
    // nguyên 100%, chỉ thêm nhánh rẽ ở đây.
    if (VOICE_ENGINE.get(voice) === 'tiktok') {
      return synthesizeTikTok(text, voice);
    }
    return raceWorkers(text, voice, rate, raceCount);
  }

  // ─── Chia văn bản thành từng chunk ──────────────────────
  // Mặc định: mỗi chunk gồm 2 câu (SENTENCES_PER_CHUNK). Nếu chunk ghép được
  // vẫn ngắn hơn MIN_CHUNK_CHARS ký tự thì gộp thêm câu kế tiếp cho đủ độ dài
  const SENTENCES_PER_CHUNK = 8;
  const MIN_CHUNK_CHARS = 120;
  // Đánh dấu 1 chunk KHÔNG có nội dung để đọc sau khi đã dọn ký tự đặc biệt
  // (VD: dòng phân cảnh chỉ toàn "***", "____", "———"...) — dùng để phân biệt
  // với trường hợp tổng hợp giọng đọc thật sự lỗi (blob null). Xem getChunkBlob().
  const EMPTY_CHUNK = Symbol('emptyChunk');
  // Riêng giọng TikTok: chunk dài hơn (3 câu thay vì 2). TikTok TTS chạy
  // tuần tự tuyệt đối (TIKTOK_CONCURRENCY = 1, xem bên trên) để an toàn
  // cho token phiên dùng chung — nhưng vì vậy mỗi chunk kế tiếp chỉ bắt
  // đầu tổng hợp SAU khi chunk trước xong. Chunk dài hơn → mỗi chunk phát
  // ra lâu hơn → có nhiều thời gian hơn để tổng hợp chunk kế trong lúc
  // chunk hiện tại đang phát, giảm khả năng bị khựng (gap) khi nghe ở tốc
  // độ nhanh (2x-3x). Không ảnh hưởng Edge TTS — Edge vẫn dùng
  // SENTENCES_PER_CHUNK = 2 như cũ.
  const TIKTOK_SENTENCES_PER_CHUNK = 2;
  // Trên 2x (tức 2.5x, 3x trong SPEED_STEPS): TRƯỚC ĐÂY nới chunk dài hơn
  // (4 câu) để bù thời gian tổng hợp qua WebSocket không đổi trong khi
  // thời lượng PHÁT co lại theo playbackRate. Nay giảm về lại 3 câu như
  // mức bình thường (đồng nhất, không tăng theo tốc độ nữa) — bù bằng
  // cách tăng độ sâu prefetch riêng cho giọng TikTok thay vì tăng độ dài
  // chunk (xem TIKTOK_PREFETCH_DEPTH bên dưới).
  const TIKTOK_SENTENCES_PER_CHUNK_FAST = 2;
  const TIKTOK_FAST_SPEED_THRESHOLD = 2;
  function chunkSizeForVoice(voiceId, speed = DEFAULT_SPEED) {
    if (VOICE_ENGINE.get(voiceId) !== 'tiktok') return SENTENCES_PER_CHUNK;
    return speed > TIKTOK_FAST_SPEED_THRESHOLD ? TIKTOK_SENTENCES_PER_CHUNK_FAST : TIKTOK_SENTENCES_PER_CHUNK;
  }

  // Độ sâu prefetch (số chunk kế tiếp bắn trước) — riêng cho giọng TikTok
  const PREFETCH_DEPTH = 8;
  const TIKTOK_PREFETCH_DEPTH = 12;
  function prefetchDepthForVoice(voiceId) {
    return VOICE_ENGINE.get(voiceId) === 'tiktok' ? TIKTOK_PREFETCH_DEPTH : PREFETCH_DEPTH;
  }

  function splitIntoSentences(text) {
    const clean = text.replace(/\r/g, '').trim();
    // Bảo vệ số có dấu chấm/phẩy nghìn khỏi bị tách câu (vd: 1.586.250 → placeholder),
    // nếu không dấu chấm trong số sẽ bị coi là chấm hết câu, cắt số làm đôi giữa 2
    // chunk audio khác nhau, đọc ngắt quãng sai. CHỈ bảo vệ khi số liền NGAY sát dấu
    // chấm/phẩy (không có khoảng trắng) — số cách ra bằng khoảng trắng (vd đếm
    // "1. 2. 3.") coi như cố tình tách, không bảo vệ.
    const DOT_PH = '\uE001', COM_PH = '\uE002';
    let protectedText = clean, _pp;
    do {
      _pp = protectedText;
      protectedText = protectedText.replace(/(\d)\.(\d)/g, '$1' + DOT_PH + '$2').replace(/(\d),(\d)/g, '$1' + COM_PH + '$2');
    } while (protectedText !== _pp);

    const paras = protectedText.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const sentences = [];
    for (const para of paras) {
      const matches = para.match(/[^.!?…]+[.!?…]+["'”)\]]*|[^.!?…]+$/g) || [para];
      for (const m of matches) {
        const s = m.trim();
        if (s) sentences.push(s);
      }
    }
    // Khôi phục dấu . và , gốc trong số
    return sentences.map(s => s.replace(new RegExp(DOT_PH, 'g'), '.').replace(new RegExp(COM_PH, 'g'), ','));
  }

  function splitIntoChunks(text, sentencesPerChunk = SENTENCES_PER_CHUNK, minChars = MIN_CHUNK_CHARS) {
    const sentences = splitIntoSentences(text);
    if (!sentences.length) return [];
    const chunks = [];
    let si = 0;
    while (si < sentences.length) {
      let sz = sentencesPerChunk;
      let chunk = sentences.slice(si, si + sz).join(' ');
      // Chunk quá ngắn (< minChars) → gộp thêm câu kế tiếp cho đủ độ dài
      while (chunk.length < minChars && si + sz < sentences.length) {
        sz++;
        chunk = sentences.slice(si, si + sz).join(' ');
      }
      chunks.push(chunk);
      si += sz;
    }
    return chunks.filter(Boolean);
  }

  // ── DỌN KÝ TỰ ĐẶC BIỆT trước khi gửi cho TTS ────────────────────────────
  // Chỉ tác động lên bản audio-text (không đụng state.chunks[i] gốc hiển thị
  // trên UI) — giống cách preprocessNumbersForTTS đang làm. Mục tiêu: loại
  // các ký tự không có giá trị phát âm (markdown thừa, ký tự trang trí, tag
  // lạ lọt vào văn bản...) khiến giọng đọc bị khựng/nuốt âm hoặc cố đọc
  // thành từ vô nghĩa. KHÔNG đụng tới +, -, /, %, ., , vì các bước xử lý số
  // /đơn vị bên dưới (preprocessNumbersForTTS) còn cần dùng tới.
  // ── ĐỔI DẤU CÂU TRUNG QUỐC SANG DẤU VIỆT NAM ────────────────────────────
  // Truyện dịch từ TQ hay lẫn dấu câu full-width TQ (，。！？…… v.v.) khiến
  // TTS đọc sai/ngắt nghỉ lạ. Đổi hết sang dấu Latin tương ứng TRƯỚC khi
  // qua các bước xử lý khác. Xử lý các cụm lặp/ghép TRƯỚC (dài → ngắn) rồi
  // mới tới từng ký tự đơn lẻ, tránh việc thay từng ký tự làm sai cụm.
  const CJK_PUNCT_COMBOS = [
    ['？？！', '?!'], ['！！？', '!?'],
    ['？？？', '?'], ['！！！', '!'],
    ['……。', '.'], ['……！', '!'], ['……？', '?'],
    ['！！。', '.'], ['？？。', '.'],
    ['，，，', ','], ['。。。', '.'],
    ['？！', '?!'], ['！？', '!?'],
    ['？？', '?'], ['！！', '!'],
    ['，，', ','], ['。。', '.'],
    ['……', '...'], ['——', '—'],
  ];
  const CJK_PUNCT_SINGLE = [
    ['，', ','], ['。', '.'], ['！', '!'], ['？', '?'],
    ['：', ':'], ['；', ';'], ['、', ','],
    ['“', '"'], ['”', '"'], ['‘', "'"], ['’', "'"],
    ['「', '"'], ['」', '"'], ['『', '"'], ['』', '"'],
    ['【', '['], ['】', ']'], ['《', '"'], ['》', '"'],
  ];
  function convertChinesePunctuationToVietnamese(text) {
    for (const [from, to] of CJK_PUNCT_COMBOS) {
      text = text.split(from).join(to);
    }
    for (const [from, to] of CJK_PUNCT_SINGLE) {
      text = text.split(from).join(to);
    }
    return text;
  }

  function cleanSpecialCharsForTTS(text) {
    // Đổi dấu câu Trung Quốc sang dấu Việt/Latin trước tiên
    text = convertChinesePunctuationToVietnamese(text);

    // Ký tự ẩn/điều khiển (zero-width space, BOM, dấu định hướng văn bản...)
    text = text.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u00AD]/g, '');

    // Markdown thừa: **bold**, __bold__, *italic*, `code`, ~~strike~~
    // → bỏ ký tự markdown, GIỮ lại nội dung chữ bên trong
    text = text.replace(/(\*\*\*|\*\*|\*|___|__|_|~~|`)/g, '');

    // Ngoặc vuông kiểu [1], [Chương 3], [nói thầm]... → giữ lại nội dung bên trong, chỉ bỏ dấu [ ]
    text = text.replace(/\[([^\]\n]{0,40})\]/g, ' $1 ');
    // Thẻ HTML/tag lạ lọt vào văn bản (vd <br>, <i>...) → xoá cả cụm
    text = text.replace(/<[^>\n]{0,80}>/g, ' ');

    // Ký tự đặc biệt/trang trí không mang nghĩa phát âm
    text = text.replace(/[#@*~^_|\\{}\[\]<>•●▪▫◆◇■□○◎☆★→←↑↓↔※§¶‣‰′″‡†×÷≈≠≤≥°™®©℗€£¥₫฿$]+/g, ' ');

    // Lặp nhiều dấu !,? liên tiếp (!!!, ???, !?!?) → gộp về 1 ký tự
    // (không đụng tới dấu ".", "…" vì "..." là dấu chấm lửng hợp lệ)
    text = text.replace(/([!?])\1{1,}/g, '$1');

    // Gộp khoảng trắng/tab thừa còn sót lại sau các bước xoá ở trên
    text = text.replace(/[ \t]{2,}/g, ' ');

    return text.trim();
  }

  // ── PREPROCESS NUMBERS & SIGNS cho TTS tiếng Việt ──────────────────────────
  // Chuyển số, dấu +/-, dấu thập phân, số lớn, giờ, ngày, đơn vị đo... sang
  // chữ tiếng Việt tự nhiên trước khi gửi cho TTS (vd: 10.000 => "10 nghìn").
  // Copy từ content.js của extension.
  function _readIntVN(n) {
    if (n === 0) return 'không';
    if (n < 0) return 'âm ' + _readIntVN(-n);
    const D = ['không','một','hai','ba','bốn','năm','sáu','bảy','tám','chín'];
    function r(x) {
      if (x === 0) return '';
      if (x < 10) return D[x];
      if (x < 100) {
        const t=Math.floor(x/10),u=x%10;
        if(t===1) return u===0?'mười':'mười '+(u===5?'lăm':D[u]);
        let s=D[t]+' mươi';
        if(u===1)s+=' mốt'; else if(u===4)s+=' tư'; else if(u===5)s+=' lăm'; else if(u>0)s+=' '+D[u];
        return s;
      }
      const h=Math.floor(x/100),rest=x%100; let s=D[h]+' trăm';
      if(rest>0){if(rest<10)s+=' lẻ '+(rest===5?'lăm':D[rest]);else s+=' '+r(rest);}
      return s;
    }
    const ty=Math.floor(n/1e9),trieu=Math.floor((n%1e9)/1e6),nghin=Math.floor((n%1e6)/1e3),con=n%1e3;
    const hasBig=ty>0||trieu>0||nghin>0;
    const parts=[];
    if(ty>0)parts.push(r(ty)+' tỷ');
    if(trieu>0)parts.push(r(trieu)+' triệu');
    if(nghin>0)parts.push(r(nghin)+' nghìn');
    if(con>0){
      if(hasBig&&con<100) parts.push('không trăm '+(con<10?'lẻ ':'')+r(con));
      else parts.push(r(con));
    }
    return parts.join(' ');
  }

  function _parseNumToken(raw) {
    // Phân biệt dấu phân cách nghìn hay thập phân:
    // Nếu nhóm sau dấu cuối cùng có đúng 3 chữ số => toàn bộ là số nguyên với sep nghìn
    // Nếu nhóm sau dấu cuối cùng có 1 hoặc 2 chữ số => đó là phần thập phân
    const groups = raw.split(/[.,]/);
    const last = groups[groups.length - 1];
    if (groups.length === 1) return { intRaw: raw, decStr: null };
    if (last.length === 3) {
      // Nhóm cuối đúng 3 chữ số => dấu phân cách nghìn
      return { intRaw: groups.join(''), decStr: null };
    }
    // Nhóm cuối 1, 2, hoặc 4+ chữ số => dấu thập phân
    return { intRaw: groups.slice(0, -1).join(''), decStr: last };
  }

  function _numTokenToText(raw) {
    const { intRaw, decStr } = _parseNumToken(raw);
    const D = ['không','một','hai','ba','bốn','năm','sáu','bảy','tám','chín'];
    let result = _readIntVN(parseInt(intRaw, 10));
    if (decStr !== null) result += ' phẩy ' + decStr.split('').map(c => D[+c] ?? c).join(' ');
    return result;
  }

  // ── SỐ LA MÃ (chỉ khi viết TOÀN BỘ CHỮ HOA, từ 2 ký tự trở lên) ─────────
  // Vd: "Chương VI", "Hồi IX" => đọc thành "Chương sáu", "Hồi chín". Bất kỳ
  // trường hợp nào khác (chữ thường "vi", "vi phạm", "vi rút"...; hoa/thường
  // lẫn lộn như "Vi" đầu câu; hay chỉ 1 ký tự hoa đứng riêng như "ông X",
  // "cô V") đều KHÔNG đụng tới — giữ nguyên y hệt văn bản gốc, đọc như từ
  // tiếng Việt bình thường.
  function _romanToInt(s) {
    const MAP = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    for (let i = 0; i < s.length; i++) {
      const cur = MAP[s[i]], next = MAP[s[i + 1]];
      total += (next && cur < next) ? -cur : cur;
    }
    return total;
  }
  // Định dạng số La Mã CHUẨN (không nhận kiểu viết sai như "IIII", "VX").
  const ROMAN_STRICT_RE = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
  function convertRomanNumeralsForTTS(text) {
    // KHÔNG có cờ 'i' (case-insensitive) — class ký tự chỉ gồm chữ HOA nên
    // tự động bỏ qua mọi từ có chữ thường, không cần xử lý gì thêm.
    return text.replace(/\b[IVXLCDM]+\b/g, function (m) {
      // Bỏ qua chuỗi 1 ký tự (I, V, X, C, D, M đứng riêng lẻ) — trong
      // truyện thường dùng để ẩn danh nhân vật (VD: "ông X", "cô V", "anh
      // D") chứ không phải số thứ tự chương, nên KHÔNG chuyển thành số.
      if (m.length < 2 || !ROMAN_STRICT_RE.test(m)) return m;
      const value = _romanToInt(m);
      if (value <= 0 || value > 3999) return m;
      return _readIntVN(value);
    });
  }

  // "vi" viết thường đứng riêng 1 từ (vd "tu vi", "vi phạm", "vi rút"...)
  // bị engine TTS TikTok đọc nhầm thành "sáu" (hiểu lầm là số La Mã VI),
  // dù JS không hề đổi thành số (xem convertRomanNumeralsForTTS ở trên).
  // Đây là lỗi ở chính engine, không sửa được từ phía mình — nên đổi cách
  // viết "vi" -> "vy" (đọc giống hệt "vi" trong tiếng Việt) trước khi gửi
  // đi để né engine hiểu nhầm. CHỈ áp dụng cho "vi" viết thường; "Vi" (tên
  // riêng viết hoa chữ đầu) và "VI" (số La Mã thật) không bị đụng tới.
  function convertLowercaseViForTTS(text) {
    return text.replace(/\bvi\b/g, 'vy');
  }

  function preprocessNumbersForTTS(text) {
    // -1. Dọn ký tự đặc biệt/markdown/tag lạ trước tiên — phải chạy TRƯỚC mọi
    // bước xử lý số bên dưới vì các bước đó dựa vào dấu . , + - / % còn nguyên vẹn.
    text = cleanSpecialCharsForTTS(text);

    // -0.5. Số La Mã viết hoa (Chương VI, Hồi IX...) => đọc thành số thường.
    // Chạy sớm, trước khi các bước bên dưới đụng tới chữ cái I V X L C D M
    // (vd bước đọc mã chữ+số) để không bị xử lý sai/chồng lấn.
    text = convertRomanNumeralsForTTS(text);

    // -0.4. "vi" viết thường -> "vy" để né engine TikTok đọc nhầm thành "sáu".
    text = convertLowercaseViForTTS(text);

    // 0. Số phải LIỀN dấu chấm/phẩy (không có khoảng trắng) mới coi là cùng
    // một số (vd "1.586.250" hoặc "1.2"). Nếu số cách dấu chấm bằng khoảng
    // trắng (vd đếm "1. 2. 3. 4. 5. ") thì coi là cố tình tách ra — mỗi số
    // được đọc riêng lẻ như bình thường, KHÔNG gộp lại. Vì vậy ở đây không
    // cần normalize/gộp gì thêm — số liền dấu chấm đã đúng dạng sẵn, còn số
    // cách khoảng trắng thì các bước xử lý số bên dưới tự đọc riêng từng số.

    // 0b. Từ phát âm đặc biệt: "gen" => "gien" (vd: gen tiến hoá, đột biến gen, gen di truyền)
    //     \b...\b để không đụng tới "gene", "gian", "nghiêm"...; giữ hoa/thường của chữ cái đầu
    text = text.replace(/\bgen\b/gi, function(m) {
      return m[0] === m[0].toUpperCase() ? 'Gien' : 'gien';
    });

    // 0c. Thuộc tính (kim, mộc, thuỷ, hoả, thổ, phong, lôi, quang, ám): đứng cạnh nhau thì bỏ dấu phẩy, đọc liền
    //     (vd: "kim, mộc, thuỷ" => "kim mộc thuỷ")
    {
      const elementWords = ['kim','mộc','thuỷ','thủy','hoả','hỏa','thổ','phong','lôi','quang','ám'];
      const w = '(?:' + elementWords.join('|') + ')';
      // Không dùng lookbehind (?<!\p{L}): Safari < 16.4 (nhiều iPad mini đời cũ) không hỗ
      // trợ cú pháp này, làm lỗi parse NGAY TỪ ĐẦU cả file tts.js => mất luôn mọi tính năng
      // TTS (kể cả nút nổi lẫn nút "Nghe"). Thay bằng kiểm tra ký tự đứng trước trong callback.
      text = text.replace(new RegExp(`${w}\\s*,\\s*(?=${w}(?!\\p{L}))`, 'giu'), function(m, offset, string){
        const prevCh = offset > 0 ? string[offset - 1] : '';
        if (prevCh && /\p{L}/u.test(prevCh)) return m;
        return m.replace(/\s*,\s*$/, ' ');
      });
    }

    // 1b. Giờ: HH:MM hoặc HH:MM:SS => 'X giờ Y phút [Z giây]'
    text = text.replace(/(^|[^\d])(\d{1,2}):(\d{2})(?::(\d{2}))?(?=[^\d]|$)/g, function(_, pre, h, m, s) {
      let out = _readIntVN(+h) + ' giờ ' + _readIntVN(+m) + ' phút';
      if (s !== undefined) out += ' ' + _readIntVN(+s) + ' giây';
      return pre + out;
    });
    // 1c. Ngày: DD/MM/YYYY hoặc DD/MM/YY => 'ngày D tháng M năm Y' (phải trước bước slash)
    text = text.replace(/(^|[^\d])(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?=[^\d]|$)/g, function(_, pre, d, m, y) {
      const year = y.length === 2 ? 2000 + +y : +y;
      return pre + 'ngày ' + _readIntVN(+d) + ' tháng ' + _readIntVN(+m) + ' năm ' + _readIntVN(year);
    });

    // 1e. Đơn vị đo lường: km/h km/giờ m/s kg cm mm kW Hz... => chữ đầy đủ
    // (chạy TRƯỚC bước đọc mã chữ+số bên dưới, để "m2"/"m3" được nhận diện là mét vuông/mét khối
    //  thay vì bị hiểu nhầm thành mã kiểu "M2", "M3")
    (function(){
      // KHÔNG dùng lookbehind (?<=...) / (?<!...) trong toàn bộ khối này: Safari trên iOS
      // cũ (<16.4 — nhiều iPad mini đời cũ vẫn kẹt ở bản Safari này) không hỗ trợ, khiến cả
      // file tts.js lỗi cú pháp ngay khi nạp => toàn bộ TTS (nút nổi lẫn nút "Nghe") biến mất.
      // Thay (?<=\d\s*) bằng nhóm bắt (\d\s*) rồi chèn lại qua $1; thay (?<![a-zA-Z]) bằng
      // kiểm tra ký tự đứng trước ngay trong hàm callback của replace().
      text=text.replace(/(\d\s*)m[\xb22](?!\w)/g,'$1 ___M2___').replace(/(\d\s*)m[\xb33](?!\w)/g,'$1 ___M3___');
      text=text.replace(/\bmili\s?m[e\xe9]t\b/gi,' mi li m\xe9t');
      text=text.replace(/km\s*\/\s*(?:h|gi\u1edd)(?!\w)/gi,' ki l\xf4 m\xe9t tr\xean gi\u1edd');
      text=text.replace(/km\s*\/\s*s(?!\w)/gi,' ki l\xf4 m\xe9t tr\xean gi\xe2y');
      text=text.replace(/m\s*\/\s*s(?!\w)/gi, function(m, offset, string){
        const prevCh = offset > 0 ? string[offset - 1] : '';
        if (/[a-zA-Z]/.test(prevCh)) return m;
        return ' m\xe9t tr\xean gi\xe2y';
      });
      [
        [/(\d\s*)km(?!\w)/gi,'$1 ki l\xf4 m\xe9t'],
        [/(\d\s*)cm(?!\w)/gi,'$1 x\u0103ng ti m\xe9t'],
        [/(\d\s*)mm(?!\w)/gi,'$1 mi li m\xe9t'],
        [/kg(?!\w)/gi, function(m, offset, string){
          const prevCh = offset > 0 ? string[offset - 1] : '';
          return /[a-zA-Z]/.test(prevCh) ? m : ' c\xe2n';
        }],
        [/(\d\s*)mg(?!\w)/gi,'$1 mi li gam'],
        [/(\d\s*)kWh(?!\w)/gi,'$1 ki l\xf4 o\xe1t gi\u1edd'],
        [/(\d\s*)kW(?!\w)/gi,'$1 ki l\xf4 o\xe1t'],
        [/(\d\s*)Hz(?!\w)/gi,'$1 h\xe9c'],
        [/(\d\s*)GB(?!\w)/gi,'$1 gi ga bai'],
        [/(\d\s*)MB(?!\w)/gi,'$1 m\xea ga bai'],
        [/(\d) m(?![\p{L}_\d])/gu,'$1 m\xe9t'],
        [/(\d) g(?![\p{L}_\d])/gu,'$1 gam'],
        [/(\d) W(?![\p{L}_\d])/gu,'$1 o\xe1t'],
        [/(\d) V(?![\p{L}_\d])/gu,'$1 v\xf4n'],
      ].forEach(function(p){text=text.replace(p[0],p[1]);});
      text=text.replace(/___M2___/g,'m\xe9t vu\xf4ng').replace(/___M3___/g,'m\xe9t kh\u1ed1i');
      text=text.replace(/^ +/,'').replace(/ {2,}/g,' ');
    })();

    // 1d2. Mã chữ+số (vd: B123, C230, Z1000, X801, D8100, D40, CDX510) => [tên từng chữ cái] + [từng chữ số]
    //   Mỗi chữ cái đọc theo tên riêng, số luôn đọc từng chữ số một, không rút gọn.
    //   (B123 => "bê một hai ba", Z1000 => "dét một không không không", CDX510 => "xê đê ích năm một không")
    //   Lưu ý: chạy SAU bước đơn vị đo (1e) ở trên để không "cướp" mất m2/m3/km/kg... đã được xử lý.
    text = (function(){
      const LETTER_VN = {
        A:'a',Ă:'á',Â:'ớ',B:'bê',C:'xê',D:'đê',Đ:'đê',E:'e',Ê:'ê',F:'ép',G:'gờ',H:'hát',
        I:'i',J:'gi',K:'ca',L:'lờ',M:'mờ',N:'nờ',O:'o',Ô:'ô',Ơ:'ơ',P:'pê',Q:'quy',R:'rờ',
        S:'ét',T:'tê',U:'u',Ư:'ư',V:'vê',W:'vê kép',X:'ích',Y:'i dài',Z:'dét'
      };
      const DIGIT_VN = ['không','một','hai','ba','bốn','năm','sáu','bảy','tám','chín'];
      function readDigitsByDigit(str){
        return str.split('').map(function(c){return DIGIT_VN[+c];}).join(' ');
      }
      return text.replace(/\b([A-Za-zĐđ]+)(\d+)\b/g, function(_, letters, digits){
        const letterWords = letters.split('').map(function(l){return LETTER_VN[l.toUpperCase()] || l;}).join(' ');
        return letterWords + ' ' + readDigitsByDigit(digits);
      });
    })();

    // 1d. /đơn_vị_thời_gian => 'mỗi ...' (vd: /ngày => mỗi ngày)
    text = text.replace(/\/(giây|phút|giờ|ngày|tháng|năm)(?!\w)/gi, function(_, unit) {
      return ' mỗi ' + unit.toLowerCase();
    });

    // 1a. Dấu / giữa 2 số => 'trên' (vd: 0/4500 => 0 trên 4500)
    text = text.replace(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/g, '$1 trên $2');

    // 1. Dấu +/- trước số (kèm % nếu có) => 'cộng/trừ X [phần trăm]'
    //    Pattern \d+(?:[.,]\d+)* : chỉ match dấu . hoặc , khi theo sau bởi chữ số
    //    => "10." chỉ match "10", dấu chấm câu không bị kéo vào
    text = text.replace(/(^|[\s(,;:[\]])([+\-−])(\d+(?:[.,]\d+)*)(%?)/g, function(_, pre, sign, num, pct) {
      var word = sign === '+' ? 'cộng' : 'trừ';
      return pre + word + ' ' + _numTokenToText(num) + (pct ? ' phần trăm' : '');
    });
    // 2. Số theo sau % => '... phần trăm'
    text = text.replace(/(\d+(?:[.,]\d+)*)%/g, function(_, num) {
      return _numTokenToText(num) + ' phần trăm';
    });
    // 3. Số còn lại
    text = text.replace(/\d+(?:[.,]\d+)*/g, function(num) {
      return _numTokenToText(num);
    });
    return text;
  }

  // ── SANITIZE TEXT trước khi gửi TTS ────────────────────────────────────────
  // Bỏ/thay ký tự đặc biệt khiến một số TTS server lỗi hoặc đọc sai. Chạy SAU
  // preprocessNumbersForTTS (đã dọn markdown/CJK/số...). Port từ content.js —
  // không dùng lookbehind nên giữ nguyên, không vướng vấn đề Safari/iPad cũ.
  function sanitizeText(text) {
    return text
      // Bỏ toàn bộ dấu nháy đơn và nháy đôi (cong + thẳng)
      .replace(/[\u2018\u2019\u201A\u201B\u0060']/g, '')    // ' ' ‚ ‛ ` ' → bỏ
      .replace(/[\u201C\u201D\u201E\u201F"]/g, '')           // " " „ ‟ "  → bỏ
      // Dấu chấm lửng → một dấu chấm
      .replace(/\u2026|\.{2,}/g, '.')                        // … ... ..   → .
      // Dấu gạch ngang dài → dấu phẩy + space (đọc tự nhiên hơn)
      .replace(/[\u2013\u2014\u2015]/g, ', ')               // – — ―      → ,
      // Ký tự zero-width / invisible
      .replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '')
      // Dấu ngoặc đặc biệt → bỏ
      .replace(/[\u2039\u203A\u00AB\u00BB]/g, '')           // ‹ › « »    → bỏ
      .replace(/[\u2768\u2769\u276A\u276B]/g, '')           // ❨❩❪❫
      // Dấu * # | ^ ~ \ dễ gây lỗi một số API
      .replace(/[*#|^\\~]/g, ' ')
      // Divider lines: chuỗi lặp lại toàn ký tự không phải chữ/số (=, -, _, ~, *, /, v.v.)
      // e.g. "========", "--------", "- - - -", "=====END=====" → bỏ hoàn toàn
      .replace(/^[\s\W_]*([^\w\s])\1{3,}[\s\W_]*$/gm, '')  // dòng thuần divider
      .replace(/(\S)\1{9,}/g, '$1')                          // chuỗi 10+ ký tự giống nhau liên tiếp → rút còn 1 ký tự
      // Dấu = còn lại → bỏ (không có nghĩa trong văn xuôi TTS)
      .replace(/=/g, '')
      // Nhiều space/newline liên tiếp → 1 space
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // ─── State & playback ────────────────────────────────────────────────────────
  const state = {
    playing: false,
    voice: DEFAULT_VOICE,
    speed: DEFAULT_SPEED,
    volume: DEFAULT_VOLUME / 100,
    autoNext: true,
    token: 0,
    uiState: 'idle',
    bgmOn: true,
    bgmVolume: DEFAULT_BGM_VOLUME / 100,
    bgmTrack: DEFAULT_BGM_TRACK,
    nextChap: null,
    fullChapter: true,
    expectedCur: null,
    expectedChaptersRef: null,
    expectedSig: null,
    chapterDetached: false,
    playingCur: null,
    playingChaptersRef: null,
    playingSig: null,
    fullChapterBlob: null,
  };

  // ─── Nhạc nền (archive.org) ────────────────────────────────────────────
  let bgmAudio = null;
  function getBgmTrack() {
    return BGM_TRACKS.find(t => t.id === state.bgmTrack) || BGM_TRACKS[0];
  }
  function getBgmAudio() {
    if (!bgmAudio) {
      bgmAudio = new Audio(getBgmTrack().url);
      bgmAudio.loop = true;
      bgmAudio.volume = state.bgmVolume;
      // preload="auto": xin trình duyệt tải sẵn trước càng nhiều càng tốt,
      // thay vì chỉ tải metadata rồi chờ lệnh play() mới tải tiếp.
      bgmAudio.preload = 'auto';
    }
    return bgmAudio;
  }
  // Tạo sẵn thẻ audio + bắt đầu buffer nhạc nền TRƯỚC khi người dùng bấm
  // Phát (nhưng không play()). Nhờ vậy lúc bấm Phát, nếu đã tải đủ dữ liệu,
  // play() sẽ chạy gần như ngay lập tức thay vì phải đợi tải từ đầu.
  function prewarmBgm() {
    if (!state.bgmOn) return;
    getBgmAudio();
  }
  function playBgm() {
    const a = getBgmAudio();
    a.volume = state.bgmVolume;
    a.play().catch(() => {});
  }
  function pauseBgm() {
    if (bgmAudio) bgmAudio.pause();
  }
  function switchBgmTrack(trackId) {
    state.bgmTrack = trackId;
    const wasPlaying = state.bgmOn && bgmAudio && !bgmAudio.paused;
    if (bgmAudio) {
      bgmAudio.pause();
      bgmAudio.src = getBgmTrack().url;
      bgmAudio.load();
    }
    if (wasPlaying) playBgm();
  }
  // Nhạc nền chỉ được PHÉP phát khi cả bgmOn (bật) VÀ TTS đang thực sự đọc
  // (state.playing). Gọi ở mọi nơi audio TTS chuyển sang play/pause/stop.
  function syncBgmWithTts() {
    if (state.bgmOn && state.playing) playBgm();
    else pauseBgm();
  }

  function getCurrentText() {
    const el = document.querySelector('#chContent .reading-content');
    if (el && el.innerText.trim()) return el.innerText.trim();
    const cc = document.getElementById('chContent');
    if (cc && !cc.querySelector('.reading-ph')) {
      const t = cc.innerText.trim();
      if (t) return t;
    }
    if (typeof S !== 'undefined' && S.chapters && S.chapters[S.cur]) {
      const ch = S.chapters[S.cur];
      const raw = (S.translations && S.translations[S.cur]) ? S.translations[S.cur] : ch.content;
      if (raw) {
        return (typeof cleanCensorChars === 'function' && typeof applyReplace === 'function' && typeof stripTitle === 'function')
          ? cleanCensorChars(applyReplace(stripTitle(raw, ch.title)))
          : raw.trim();
      }
    }
    return '';
  }

  async function synthesizeWithRetry(text, voice, rate, raceCount = 4, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const blob = await synthesize(text, voice, rate, raceCount);
      if (blob) return blob;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
      }
    }
    return null;
  }

  function splitChapterIntoBlocks(text, maxChars = 700) {
    if (!text) return [];
    const sentences = splitIntoSentences(text);
    const blocks = [];
    let cur = '';
    for (const s of sentences) {
      const trimmed = s.trim();
      if (!trimmed) continue;
      if (cur && (cur.length + trimmed.length + 1 > maxChars)) {
        blocks.push(cur.trim());
        cur = trimmed;
      } else {
        cur = cur ? (cur + ' ' + trimmed) : trimmed;
      }
    }
    if (cur.trim()) blocks.push(cur.trim());
    return blocks;
  }

  async function synthesizeBlocksParallel(blocks, myToken, onProgress) {
    const n = blocks.length;
    const blobs = new Array(n).fill(null);
    let completed = 0;
    const isTikTok = VOICE_ENGINE.get(state.voice) === 'tiktok';
    const concurrency = isTikTok ? 1 : 6;
    let queueIdx = 0;

    async function worker() {
      while (queueIdx < n) {
        if (myToken !== state.token) return;
        const i = queueIdx++;
        const blockText = blocks[i];
        const speechText = sanitizeText(preprocessNumbersForTTS(blockText));
        if (!speechText.trim()) {
          completed++;
          if (onProgress) onProgress(completed, n);
          continue;
        }

        const raceCount = (i === 0) ? CHUNK0_RACE_SERVERS : 3;
        const blob = await synthesizeWithRetry(speechText, state.voice, SYNTH_RATE, raceCount, 2);
        if (myToken !== state.token) return;
        blobs[i] = blob;
        completed++;
        if (onProgress) onProgress(completed, n);
      }
    }

    const workers = [];
    for (let w = 0; w < Math.min(concurrency, n); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (myToken !== state.token) return null;
    const validBlobs = blobs.filter(Boolean);
    if (!validBlobs.length) return null;
    return new Blob(validBlobs, { type: 'audio/mpeg' });
  }

  // Sinh HTML cho cụm nút tốc độ từ 1 bộ mốc (SPEED_STEPS hoặc SPEED_STEPS_ALT),
  // đánh dấu "on" cho nút khớp với activeSpeed.
  function renderSpeedButtonsHtml(steps, activeSpeed) {
    return steps.map(m =>
      `<button class="tts-spd${m === activeSpeed ? ' on' : ''}" data-mult="${m}">${m}x</button>`
    ).join('');
  }

  let ui = null;
  let chunkHighlightEls = []; // các thẻ <mark> đang bọc quanh chunk hiện tại (xem highlightChunkRange)
  function buildUI() {
    const root = document.createElement('div');
    root.id = 'tts-root';
    root.style.display = 'none';

    const speedBtnsHtml = renderSpeedButtonsHtml(SPEED_STEPS, DEFAULT_SPEED);

    const currentVoiceLabel = (VOICES.find(v => v.id === DEFAULT_VOICE) || VOICES[0]).label;
    const currentBgmLabel = (BGM_TRACKS.find(t => t.id === DEFAULT_BGM_TRACK) || BGM_TRACKS[0]).name;

    root.innerHTML = `
      <div class="tts-bar-outer">
        <!-- Bảng cài đặt neo ở #tts-bar-outer (không còn lồng trong .tts-bar/
             .tts-right) và ĐỨNG TRƯỚC .tts-bar trong DOM + z-index âm (xem
             tts.css) để nó luôn vẽ DƯỚI lớp audio bar — cạnh dưới của popup
             (bottom:100%) đặt sát cạnh trên của .tts-bar, nhờ vậy box-shadow
             của popup bị mặt kính của audio bar che mất, không đè lên thanh. -->
        <div class="tts-settings" id="tts-settings-panel">
          <div class="tts-set-row">
            <div class="tts-set-label"><span class="tts-set-label-left"><span class="tts-mini-ic">${ICON_MIC}</span>Giọng đọc</span></div>
            <div class="tts-dd" id="tts-voice-dd">
              <button type="button" class="tts-dd-trigger" id="tts-voice-trigger" title="Chọn giọng đọc">
                <span class="tts-dd-trigger-left"><span class="tts-mini-ic">${ICON_MIC}</span><span class="tts-dd-trigger-label" id="tts-voice-trigger-label">${currentVoiceLabel}</span></span>
                <span class="tts-mini-ic">${ICON_CHEVRON}</span>
              </button>
            </div>
          </div>

          <div class="tts-set-row">
            <div class="tts-set-titlesw">
              <span class="tts-set-label-left"><span class="tts-mini-ic">${ICON_MUSIC}</span>Nhạc nền</span>
              <span class="tts-switch on" id="tts-bgm-toggle-row" role="button" tabindex="0">
                <span class="tts-switch-track"></span>
                <span class="tts-switch-thumb"></span>
              </span>
            </div>
            <div class="tts-dd" id="tts-bgm-dd">
              <button type="button" class="tts-dd-trigger" id="tts-bgm-trigger" title="Chọn nhạc nền">
                <span class="tts-dd-trigger-left"><span class="tts-mini-ic">${ICON_MUSIC}</span><span class="tts-dd-trigger-label" id="tts-bgm-trigger-label">${currentBgmLabel}</span></span>
                <span class="tts-mini-ic">${ICON_CHEVRON}</span>
              </button>
            </div>
          </div>

          <div class="tts-set-row" id="tts-bgm-vol-row">
            <div class="tts-set-slider-row">
              <span class="tts-mini-ic">${ICON_VOLUME}</span>
              <input type="range" class="tts-vol-slider" id="tts-bgm-volume" min="0" max="100" step="1" value="${DEFAULT_BGM_VOLUME}" style="--v:${DEFAULT_BGM_VOLUME}">
            </div>
          </div>

          <div class="tts-set-row tts-set-volume">
            <div class="tts-set-label"><span>Âm lượng</span><span class="tts-set-val" id="tts-volume-num-panel">${DEFAULT_VOLUME}%</span></div>
            <div class="tts-set-slider-row">
              <span class="tts-mini-ic">${ICON_VOLUME}</span>
              <input type="range" id="tts-volume-panel" min="0" max="100" step="1" value="${DEFAULT_VOLUME}">
            </div>
          </div>

          <div class="tts-set-row">
            <label class="tts-switch-row" id="tts-autonext-row">
              <span class="tts-switch-row-label"><span class="tts-mini-ic">${ICON_AUTOCHAPTER}</span>Tự động chuyển chương</span>
              <span class="tts-switch on" id="tts-autonext">
                <span class="tts-switch-track"></span>
                <span class="tts-switch-thumb"></span>
              </span>
            </label>
          </div>
        </div>

        <!-- Hàng nhỏ mở rộng LÊN TRÊN thanh chính (đặt trước .tts-bar trong
             DOM để xếp phía trên nó theo luồng bình thường) — chỉ hiện khi
             người dùng đã rời khỏi chương đang phát (chapterDetached) hoặc đã tự next
             sang chương kế ở chế độ nền (không đổi trang hiển thị) — xem
             updateDetachedRow() trong tts.js. Bấm vào để quay lại đúng
             chương đang phát. -->
        <button type="button" class="tts-detached-row" id="tts-detached-row">
          <span class="tts-detached-ico">${ICON_STATUS_WAVE}</span>
          <span class="tts-detached-label" id="tts-detached-label"></span>
        </button>

        <!-- Hàng "Nghe tiếp đoạn dang dở?" — bấm vào để đọc tiếp đúng từ giây đã dừng -->
        <button type="button" class="tts-detached-row" id="tts-resume-row">
          <span class="tts-detached-ico">${ICON_STATUS_WAVE}</span>
          <span class="tts-detached-label">Nghe tiếp đoạn dang dở?</span>
        </button>

        <div class="tts-bar" id="tts-bar-el">
          <div class="tts-prog" id="tts-prog-track" title="Kéo hoặc bấm để tua">
            <div id="tts-progress-bar" class="tts-prog-fill"></div>
          </div>

          <div class="tts-transport">
            <button class="tts-tbtn" id="tts-prev" title="Chương trước">${ICON_PREV}</button>
            <button class="tts-tbtn" id="tts-back10" title="Lùi 10 giây">${ICON_BACK10}</button>
            <button class="tts-tbtn tts-tbtn-play" id="tts-playpause" title="Phát">${ICON_PLAY}</button>
            <button class="tts-tbtn" id="tts-forward10" title="Tới 10 giây">${ICON_FORWARD10}</button>
            <button class="tts-tbtn" id="tts-next" title="Chương sau">${ICON_NEXT}</button>
          </div>

          <div class="tts-time-wrap">
            <span class="tts-time" id="tts-time-display">00:00 / 00:00</span>
          </div>

          <div class="tts-status-row">
            <div class="tts-dot" id="tts-status-dot">${ICON_STATUS_WAVE}</div>
          </div>

          <div class="tts-speed-wrap">${speedBtnsHtml}</div>

          <div class="tts-divider"></div>

          <div class="tts-vol-wrap">
            <span class="tts-vol-icon">${ICON_VOLUME}</span>
            <input type="range" class="tts-vol-slider" id="tts-volume" min="0" max="100" step="1" value="${DEFAULT_VOLUME}" style="--v:${DEFAULT_VOLUME}">
          </div>

          <div class="tts-right">
            <button class="tts-tbtn tts-gear" id="tts-settings-btn" title="Cài đặt">${ICON_GEAR}</button>
            <button class="tts-tbtn" id="tts-close" title="Đóng">${ICON_CLOSE}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);

    // ---- dropdown nổi kiểu "pc-menu" cho Giọng đọc / Nhạc nền (thay <select>
    // gốc): menu được portal ra document.body, position:fixed, toạ độ tính
    // theo vị trí nút bấm — tránh bị cắt bởi overflow:hidden/scroll của
    // .tts-settings, và luôn nổi trên mọi thứ (kể cả popover cài đặt). ----
    // Danh sách các dropdown đang tồn tại (giọng đọc / nhạc nền...) — dùng để
    // tự đóng các dropdown khác mỗi khi 1 dropdown được mở, tránh 2 menu nổi
    // cùng lúc chồng lên nhau.
    const allDropdowns = [];
    function buildDropdown({ trigger, items, getValue, onSelect, note, icon }) {
      const menu = document.createElement('div');
      menu.className = 'tts-dd-menu';
      menu.innerHTML = `
        <div class="tts-dd-list">
          ${items.map(it => `<button type="button" class="tts-dd-item" data-val="${it.id}"><span class="tts-dd-item-left">${icon ? `<span class="tts-mini-ic">${icon}</span>` : ''}<span class="tts-dd-item-label">${it.label}</span></span>${ICON_CHECK}</button>`).join('')}
        </div>
        ${note ? `<div class="tts-dd-note">${note}</div>` : ''}
      `;
      document.body.appendChild(menu);
      const itemEls = [...menu.querySelectorAll('.tts-dd-item')];

      function syncActive() {
        const val = getValue();
        itemEls.forEach(el => el.classList.toggle('active', el.dataset.val === val));
      }
      function place() {
        const r = trigger.getBoundingClientRect();
        const width = Math.max(r.width, 200);
        menu.style.width = width + 'px';
        let left = r.left;
        left = Math.min(left, window.innerWidth - width - 8);
        left = Math.max(left, 8);
        menu.style.left = left + 'px';
        // Ưu tiên mở xuống dưới nút; nếu không đủ chỗ thì mở lên trên.
        const maxMenuH = Math.min(300, window.innerHeight - 16);
        menu.style.maxHeight = maxMenuH + 'px';
        const spaceBelow = window.innerHeight - r.bottom - 8;
        const spaceAbove = r.top - 8;
        if (spaceBelow >= 160 || spaceBelow >= spaceAbove) {
          menu.style.top = (r.bottom + 6) + 'px';
          menu.style.maxHeight = Math.max(120, Math.min(maxMenuH, spaceBelow)) + 'px';
        } else {
          const h = Math.max(120, Math.min(maxMenuH, spaceAbove));
          menu.style.top = (r.top - 6 - h) + 'px';
          menu.style.maxHeight = h + 'px';
        }
      }
      function open() {
        if (trigger.disabled) return;
        // Đóng tất cả dropdown khác trước khi mở dropdown này.
        allDropdowns.forEach(d => { if (d !== api) d.close(); });
        syncActive();
        place();
        menu.classList.add('open');
        trigger.classList.add('open');
      }
      function close() {
        menu.classList.remove('open');
        trigger.classList.remove('open');
      }
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.contains('open') ? close() : open();
      });
      itemEls.forEach(el => el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelect(el.dataset.val);
        syncActive();
        close();
      }));
      document.addEventListener('click', (e) => {
        if (!menu.classList.contains('open')) return;
        if (menu.contains(e.target) || e.target === trigger) return;
        close();
      });
      window.addEventListener('scroll', () => { if (menu.classList.contains('open')) place(); }, true);
      window.addEventListener('resize', () => { if (menu.classList.contains('open')) place(); });
      const api = { menu, syncActive, close, setLabel: (text) => { trigger.querySelector('.tts-dd-trigger-label').textContent = text; } };
      allDropdowns.push(api);
      return api;
    }

    ui = {
      root,
      bar: root.querySelector('#tts-bar-el'),
      progTrack: root.querySelector('#tts-prog-track'),
      progressBar: root.querySelector('#tts-progress-bar'),
      timeDisplay: root.querySelector('#tts-time-display'),
      prevBtn: root.querySelector('#tts-prev'),
      back10Btn: root.querySelector('#tts-back10'),
      playPauseBtn: root.querySelector('#tts-playpause'),
      forward10Btn: root.querySelector('#tts-forward10'),
      nextBtn: root.querySelector('#tts-next'),
      statusDot: root.querySelector('#tts-status-dot'),
      closeBtn: root.querySelector('#tts-close'),
      detachedRow: root.querySelector('#tts-detached-row'),
      detachedLabel: root.querySelector('#tts-detached-label'),
      resumeRow: root.querySelector('#tts-resume-row'),
      autoNextRow: root.querySelector('#tts-autonext-row'),
      autoNextBtn: root.querySelector('#tts-autonext'),
      speedBtns: [...root.querySelectorAll('.tts-spd')],
      volumeSlider: root.querySelector('#tts-volume'),
      volumeSliderPanel: root.querySelector('#tts-volume-panel'),
      volumeNumPanel: root.querySelector('#tts-volume-num-panel'),
      settingsBtn: root.querySelector('#tts-settings-btn'),
      settingsPanel: root.querySelector('#tts-settings-panel'),
      voiceTrigger: root.querySelector('#tts-voice-trigger'),
      bgmToggleRow: root.querySelector('#tts-bgm-toggle-row'),
      bgmToggleBtn: root.querySelector('#tts-bgm-toggle-row'),
      bgmVolRow: root.querySelector('#tts-bgm-vol-row'),
      bgmVolumeSlider: root.querySelector('#tts-bgm-volume'),
      bgmTrigger: root.querySelector('#tts-bgm-trigger'),
    };

    // ---- giọng đọc / nhạc nền: dropdown nổi kiểu "pc-menu" ----
    const voiceDropdown = buildDropdown({
      trigger: ui.voiceTrigger,
      items: VOICES.map(v => ({ id: v.id, label: v.label })),
      getValue: () => state.voice,
      onSelect: (id) => selectVoice(id, true),
      icon: ICON_MIC,
    });
    const bgmDropdown = buildDropdown({
      trigger: ui.bgmTrigger,
      items: BGM_TRACKS.map(t => ({ id: t.id, label: t.name })),
      getValue: () => state.bgmTrack,
      onSelect: (id) => selectBgmTrack(id),
      note: 'Nhắn tin cho admin qua page nếu muốn yêu cầu thêm nhạc nền: <a href="https://www.facebook.com/truyendichai" target="_blank" rel="noopener">Facebook</a>',
      icon: ICON_MUSIC,
    });
    ui.voiceDropdown = voiceDropdown;
    ui.bgmDropdown = bgmDropdown;

    // Khôi phục giọng đọc & âm lượng đã lưu
    const savedVoice = localStorage.getItem('tts_voice');
    if (savedVoice && VOICES.some(v => v.id === savedVoice)) {
      state.voice = savedVoice;
      selectVoice(savedVoice, false);
    }
    const savedVolume = parseInt(localStorage.getItem('tts_volume'), 10);
    if (!Number.isNaN(savedVolume) && savedVolume >= 0 && savedVolume <= 100) {
      state.volume = savedVolume / 100;
      ui.volumeSlider.value = savedVolume;
      ui.volumeSlider.style.setProperty('--v', savedVolume);
      ui.volumeSliderPanel.value = savedVolume;
      ui.volumeNumPanel.textContent = savedVolume + '%';
    }
    const savedSpeed = parseFloat(localStorage.getItem('tts_speed'));
    if (!Number.isNaN(savedSpeed) && savedSpeed >= SPEED_STEPS[0] && savedSpeed <= SPEED_STEPS[SPEED_STEPS.length - 1]) {
      state.speed = savedSpeed;
      ui.speedBtns.forEach(b => b.classList.toggle('on', parseFloat(b.dataset.mult) === savedSpeed));
    }
    const savedAutoNext = localStorage.getItem('tts_autonext');
    if (savedAutoNext === '0') {
      state.autoNext = false;
      ui.autoNextBtn.classList.remove('on');
    } else if (savedAutoNext === '1') {
      state.autoNext = true;
      ui.autoNextBtn.classList.add('on');
    }
    // savedAutoNext === null (chưa từng bấm) → giữ mặc định autoNext:true
    // đã set sẵn ở state ban đầu và class "on" đã có sẵn trong HTML.
    const savedBgmVolume = parseInt(localStorage.getItem('tts_bgm_volume'), 10);
    if (!Number.isNaN(savedBgmVolume) && savedBgmVolume >= 0 && savedBgmVolume <= 100) {
      state.bgmVolume = savedBgmVolume / 100;
      ui.bgmVolumeSlider.value = savedBgmVolume;
      ui.bgmVolumeSlider.style.setProperty('--v', savedBgmVolume);
    }
    const savedBgmTrack = localStorage.getItem('tts_bgm_track');
    if (savedBgmTrack && BGM_TRACKS.some(t => t.id === savedBgmTrack)) {
      state.bgmTrack = savedBgmTrack;
      ui.bgmDropdown.setLabel(getBgmTrack().name);
    }
    // Nhạc nền mặc định BẬT — chỉ tắt nếu người dùng đã từng chủ động tắt.
    const savedBgmOn = localStorage.getItem('tts_bgm_on');
    if (savedBgmOn === '0') {
      state.bgmOn = false;
      ui.bgmToggleBtn.classList.remove('on');
      ui.bgmTrigger.disabled = true;
      ui.bgmVolRow.classList.add('disabled');
    } else {
      state.bgmOn = true;
      ui.bgmToggleBtn.classList.add('on');
      ui.bgmTrigger.disabled = false;
      ui.bgmVolRow.classList.remove('disabled');
      prewarmBgm();
    }

    ui.playPauseBtn.addEventListener('click', onPlayPauseClick);
    ui.closeBtn.addEventListener('click', () => {
      stopReading('');
      closeSettingsPanel();
      root.style.display = 'none';
      setFloatBtnOn(false);
      updateFloatBtnVisibility();
      document.body.classList.remove('tts-open');
      if (ttsBarResizeObserver) ttsBarResizeObserver.disconnect();
      window.removeEventListener('resize', syncTtsBarHeight);
    });

    ui.prevBtn.addEventListener('click', () => playPrevChapter());
    ui.nextBtn.addEventListener('click', () => playNextChapter());
    if (ui.back10Btn) ui.back10Btn.addEventListener('click', () => seekAudioRelative(-10));
    if (ui.forward10Btn) ui.forward10Btn.addEventListener('click', () => seekAudioRelative(10));
    initSeekTrack(ui.progTrack);

    ui.autoNextRow.addEventListener('click', () => {
      state.autoNext = !state.autoNext;
      ui.autoNextBtn.classList.toggle('on', state.autoNext);
      localStorage.setItem('tts_autonext', state.autoNext ? '1' : '0');
    });

    // Hàng "Đang phát Chương X: ..." — chỉ hiện khi đã rời khỏi chương đang phát
    if (ui.detachedRow) {
      ui.detachedRow.addEventListener('click', () => {
        if (typeof nav !== 'function' || state.playingCur == null) return;
        nav(state.playingCur);
      });
    }
    // Hàng "Nghe tiếp từ mm:ss"
    if (ui.resumeRow) {
      ui.resumeRow.addEventListener('click', () => resumeSavedPoint());
    }

    // ---- tốc độ: nút nhanh trên thanh chính ----
    function setSpeed(mult) {
      state.speed = mult;
      ui.speedBtns.forEach(b => b.classList.toggle('on', parseFloat(b.dataset.mult) === mult));
      localStorage.setItem('tts_speed', mult);
      if (chapterAudio && state.playing) applySpeedToAudio(chapterAudio, mult);
      updatePositionState();
    }
    ui.speedBtns.forEach(btn => btn.addEventListener('click', () => setSpeed(parseFloat(btn.dataset.mult))));

    // ---- bấm icon sóng âm (trạng thái) → đổi cụm nút tốc độ sang bộ khác
    // (0.5/0.25/1/1.25/1.5/1.75) và ngược lại về bộ mặc định. ----
    function rebuildSpeedButtons() {
      const steps = speedStepsMode === 'alt' ? SPEED_STEPS_ALT : SPEED_STEPS;
      const wrap = root.querySelector('.tts-speed-wrap');
      if (!wrap) return;
      // Giữ nguyên tốc độ đang đọc nếu bộ mới cũng có mốc đó; nếu không, lấy
      // mốc gần nhất trong bộ mới rồi thực sự áp dụng (đổi playbackRate) qua
      // setSpeed() để tốc độ hiển thị và tốc độ NGHE luôn khớp nhau.
      let nextSpeed = state.speed;
      if (!steps.includes(nextSpeed)) {
        nextSpeed = steps.reduce((prev, curr) =>
          Math.abs(curr - state.speed) < Math.abs(prev - state.speed) ? curr : prev, steps[0]);
      }
      wrap.innerHTML = renderSpeedButtonsHtml(steps, nextSpeed);
      ui.speedBtns = [...wrap.querySelectorAll('.tts-spd')];
      ui.speedBtns.forEach(btn => btn.addEventListener('click', () => setSpeed(parseFloat(btn.dataset.mult))));
      if (nextSpeed !== state.speed) setSpeed(nextSpeed);
    }
    if (ui.statusDot) {
      ui.statusDot.title = 'Đổi bộ tốc độ';
      ui.statusDot.addEventListener('click', () => {
        speedStepsMode = speedStepsMode === 'alt' ? 'default' : 'alt';
        rebuildSpeedButtons();
      });
    }

    // ---- âm lượng: thanh chính + thanh trong panel (hiện ở mobile) đồng bộ 2 chiều ----
    function syncVolume(value) {
      state.volume = value / 100;
      ui.volumeSlider.value = value;
      ui.volumeSlider.style.setProperty('--v', value);
      ui.volumeSliderPanel.value = value;
      ui.volumeNumPanel.textContent = value + '%';
      localStorage.setItem('tts_volume', value);
      if (chapterAudio) chapterAudio.volume = state.volume;
    }
    ui.volumeSlider.addEventListener('input', () => syncVolume(ui.volumeSlider.value));
    ui.volumeSliderPanel.addEventListener('input', () => syncVolume(ui.volumeSliderPanel.value));

    // ---- bảng cài đặt: mở/đóng (popover neo dưới nút bánh răng) ----
    function openSettingsPanel() {
      ui.settingsPanel.classList.add('open');
      ui.settingsBtn.classList.add('open');
      requestAnimationFrame(syncTtsBarHeight);
    }
    function closeSettingsPanel() {
      ui.settingsPanel.classList.remove('open');
      ui.settingsBtn.classList.remove('open');
      voiceDropdown.close();
      bgmDropdown.close();
      requestAnimationFrame(syncTtsBarHeight);
    }
    ui.settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      ui.settingsPanel.classList.contains('open') ? closeSettingsPanel() : openSettingsPanel();
    });
    document.addEventListener('click', (e) => {
      if (!ui.settingsPanel.classList.contains('open')) return;
      if (ui.settingsPanel.contains(e.target) || e.target === ui.settingsBtn) return;
      closeSettingsPanel();
    });

    // ---- nhạc nền: bật/tắt + âm lượng + chọn bài (dropdown nổi) ----
    ui.bgmToggleRow.addEventListener('click', () => {
      state.bgmOn = !state.bgmOn;
      ui.bgmToggleBtn.classList.toggle('on', state.bgmOn);
      ui.bgmTrigger.disabled = !state.bgmOn;
      ui.bgmVolRow.classList.toggle('disabled', !state.bgmOn);
      localStorage.setItem('tts_bgm_on', state.bgmOn ? '1' : '0');
      if (state.bgmOn) prewarmBgm();
      syncBgmWithTts();
    });
    ui.bgmVolumeSlider.addEventListener('input', () => {
      const v = ui.bgmVolumeSlider.value;
      state.bgmVolume = v / 100;
      ui.bgmVolumeSlider.style.setProperty('--v', v);
      localStorage.setItem('tts_bgm_volume', v);
      if (bgmAudio) bgmAudio.volume = state.bgmVolume;
    });
    function selectBgmTrack(trackId) {
      const t = BGM_TRACKS.find(x => x.id === trackId);
      if (!t) return;
      localStorage.setItem('tts_bgm_track', trackId);
      ui.bgmDropdown.setLabel(t.name);
      switchBgmTrack(trackId);
    }
  }

  function selectVoice(voiceId, applyLive) {
    const v = VOICES.find(x => x.id === voiceId);
    if (!v || !ui) return;
    state.voice = voiceId;
    localStorage.setItem('tts_voice', voiceId);
    if (ui.voiceDropdown) ui.voiceDropdown.setLabel(v.label);
    // Prewarm WebSocket TikTok NGAY khi chọn giọng TikTok trong Cài đặt
    // — trước cả khi bấm Play — để bắt tay (handshake TCP/TLS) xong
    // sẵn từ trước, đỡ tốn thời gian chờ cho chunk audio ĐẦU TIÊN. Cùng
    // ý tưởng với prewarmBgm() đã có cho nhạc nền. Hàm ensureTiktokSocket()
    // tự dedupe nếu đã có kết nối/đang mở nên gọi lại nhiều lần vô hại.
    // Chạy ở cả lúc khôi phục giọng đã lưu (applyLive=false) lẫn khi
    // người dùng chủ động đổi giọng (applyLive=true).
    if (v.engine === 'tiktok') ensureTiktokSocket();
    if (applyLive && state.playing) {
      const curTime = chapterAudio ? chapterAudio.currentTime : 0;
      const text = getCurrentText();
      if (text) {
        startReading(text, state.fullChapter, curTime);
      }
    }
  }

  let floatBtn = null;
  // Nút "Nghe" trong toolbar mobile (#listenTbBtn, xem index.html) — chỉ hiện
  // ở mobile (<=680px, xem tts.css), thay thế nút "Nghe" tròn từng chèn dưới
  // đếm ký tự và nút nổi bên lề phải trên màn hình hẹp.
  let listenTbBtn = null;
  // Nút nổi chỉ hiện khi đang có 1 chương truyện được mở (#chView hiển thị).
  // Không có truyện nào mở (màn hình upload file) thì ẩn nút đi.
  function isChapterOpen() {
    const chView = document.getElementById('chView');
    if (!chView) return false;
    return getComputedStyle(chView).display !== 'none';
  }
  function updateFloatBtnVisibility() {
    const open = isChapterOpen();
    const panelOpen = !!(ui && ui.root && ui.root.style.display !== 'none');
    if (floatBtn) floatBtn.style.display = open ? 'flex' : 'none';
    // Nút "Nghe" trong toolbar mobile: chỉ cần bật/tắt disabled theo trạng
    // thái có chương đang mở hay không — ẩn/hiện theo bề rộng màn hình đã
    // do CSS lo (chỉ hiện ở <=680px).
    if (listenTbBtn) listenTbBtn.disabled = !open;
    // Nếu đang đọc mà chương bị đóng lại (vd. quay về màn hình upload),
    // ẩn luôn thanh đọc TTS cho gọn.
    if (!open && panelOpen) {
      window.toggleTtsReader();
    }
  }
  function watchChapterView() {
    const chView = document.getElementById('chView');
    if (!chView) return;
    const observer = new MutationObserver(updateFloatBtnVisibility);
    observer.observe(chView, { attributes: true, attributeFilter: ['style', 'class'] });
  }
  function buildFloatBtn() {
    floatBtn = document.createElement('button');
    floatBtn.className = 'tts-float-btn';
    floatBtn.title = 'Nghe đọc chương';
    floatBtn.innerHTML = ICON_HEADPHONE;
    floatBtn.addEventListener('click', () => window.toggleTtsReader());
    document.body.appendChild(floatBtn);
    listenTbBtn = document.getElementById('listenTbBtn');
    updateFloatBtnVisibility();
    watchChapterView();
  }
  function setFloatBtnOn(on) {
    if (floatBtn) floatBtn.classList.toggle('on', on);
    if (listenTbBtn) listenTbBtn.classList.toggle('btn-on', on);
  }

  function setStatus(msg, cls) {
    // Đã bỏ hiển thị text trạng thái — chỉ còn icon (chấm tròn đổi màu theo
    // trạng thái). Vẫn gán vào title để hiện tooltip khi rê chuột, không tốn
    // chỗ hiển thị nhưng vẫn giữ được thông tin chi tiết khi cần.
    if (ui.statusDot) ui.statusDot.title = msg;
  }

  // ─── Điều khiển trạng thái hiển thị: idle / loading / playing / paused ──────
  // Chỉ còn 1 nút play/pause gộp chung (ui.playPauseBtn) thay vì 3 nút
  // Phát/Dừng/Tạm dừng riêng biệt như trước — icon đổi theo trạng thái.
  // Nhãn "Chương N: Tiêu đề" của chương ĐANG PHÁT (state.playingCur) — dùng
  // đúng định dạng có sẵn của app (formatChTitle trong index.html đã ghép
  // sẵn "Chương N: ..." vào ch.title / S.translatedTitles), nên chỉ cần lấy
  // thẳng ra, ưu tiên tiêu đề đã dịch nếu có.
  function playingChapterLabel() {
    if (typeof S === 'undefined' || !S.chapters) return '';
    const idx = state.playingCur;
    if (idx == null || idx < 0 || !S.chapters[idx]) return '';
    const ch = S.chapters[idx];
    return (S.translatedTitles && S.translatedTitles[idx]) ? S.translatedTitles[idx] : (ch.title || '');
  }

  // Hiện/ẩn hàng nhỏ "Đang phát Chương N: ..." bên dưới thanh chính — chỉ
  // hiện khi người dùng đã rời khỏi chương đang phát (chapterDetached) và
  // audio vẫn còn phiên đọc (không phải idle). Gọi lại mỗi khi setUIState()
  // chạy, tức mọi lúc trạng thái phát/tạm dừng/tải hoặc chapterDetached đổi.
  function updateDetachedRow() {
    if (!ui || !ui.detachedRow) return;
    const show = state.chapterDetached && state.uiState !== 'idle';
    const label = show ? playingChapterLabel() : '';
    if (!show || !label) {
      ui.detachedRow.classList.remove('show');
      return;
    }
    if (ui.detachedLabel) ui.detachedLabel.textContent = 'Đang phát ' + label;
    ui.detachedRow.classList.add('show');
  }

  // Hiện/ẩn hàng "Nghe tiếp đoạn dang dở?" — cùng kiểu dáng với hàng "Đang
  // phát ..." ở trên nhưng ngược điều kiện: chỉ hiện khi thanh đang mở,
  // KHÔNG có gì đang đọc (uiState idle, để không đá hàng "Đang phát ..."),
  // và đúng chương đang hiển thị khớp với vị trí đã lưu (xem
  // getResumeForCurrentChapter()).
  function updateResumeRow() {
    if (!ui || !ui.resumeRow) return;
    if (ui.root.style.display === 'none') return; // thanh đang đóng, khỏi cần tính
    const show = state.uiState === 'idle' && !!getResumeForCurrentChapter();
    ui.resumeRow.classList.toggle('show', show);
  }

  function setUIState(s) {
    state.uiState = s;
    ui.statusDot.className = 'tts-dot';
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : (s === 'paused' ? 'paused' : 'none');
    }
    // Khi đã rời khỏi chương đang phát (chapterDetached), nút Tạm dừng đổi
    // thành nút Dừng — đỏ, bấm vào là dừng hẳn (xem onPlayPauseClick) thay
    // vì tạm dừng, vì chương đang đọc dở không còn hiển thị trên màn hình
    // nữa nên "tiếp tục" không còn nhiều ý nghĩa.
    const showStop = state.chapterDetached && (s === 'loading' || s === 'playing');
    ui.playPauseBtn.classList.toggle('tts-tbtn-stop', showStop);
    if (s === 'idle') {
      ui.playPauseBtn.innerHTML = ICON_PLAY;
      ui.playPauseBtn.title = 'Phát';
      ui.progressBar.style.width = '0%';
      setStatus('Sẵn sàng');
    } else if (s === 'loading') {
      ui.playPauseBtn.innerHTML = showStop ? ICON_STOP : ICON_PAUSE;
      ui.playPauseBtn.title = showStop ? 'Dừng' : 'Tạm dừng';
      ui.statusDot.classList.add('loading');
      setStatus('Đang tải…');
    } else if (s === 'playing') {
      ui.playPauseBtn.innerHTML = showStop ? ICON_STOP : ICON_PAUSE;
      ui.playPauseBtn.title = showStop ? 'Dừng' : 'Tạm dừng';
      ui.statusDot.classList.add('playing');
      setStatus('Đang phát');
    } else if (s === 'paused') {
      ui.playPauseBtn.innerHTML = ICON_PLAY;
      ui.playPauseBtn.title = 'Tiếp tục';
      ui.statusDot.classList.add('paused');
      setStatus('Tạm dừng');
    }
    updateDetachedRow();
    updateResumeRow();
    updateNavButtons();
  }

  function updateNavButtons() {
    if (!ui) return;
    if (typeof S !== 'undefined' && S.chapters) {
      const curChap = state.playingCur != null ? state.playingCur : S.cur;
      ui.prevBtn.disabled = (curChap <= 0);
      ui.nextBtn.disabled = (curChap >= S.chapters.length - 1);
    }
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  // ─── Single HTML5 Audio Engine for Full-Chapter Playback ──────────────────
  let chapterAudio = null;

  function getChapterAudio() {
    if (!chapterAudio) {
      chapterAudio = new Audio();
      chapterAudio.preload = 'auto';
      chapterAudio.preservesPitch = true;
      chapterAudio.mozPreservesPitch = true;
      chapterAudio.webkitPreservesPitch = true;
      chapterAudio.ontimeupdate = onAudioTimeUpdate;
      chapterAudio.onloadedmetadata = () => {
        applySpeedToAudio(chapterAudio, state.speed);
        updateTimeAndProgressUI();
        updatePositionState();
      };
      chapterAudio.onended = onAudioEnded;
      chapterAudio.onerror = (e) => {
        console.warn('Chapter audio error:', e);
        if (state.playing) {
          stopReading('Lỗi phát âm thanh chương.');
        }
      };
    }
    return chapterAudio;
  }

  function applySpeedToAudio(a, mult) {
    if (!a) return;
    try {
      a.preservesPitch = true;
      a.mozPreservesPitch = true;
      a.webkitPreservesPitch = true;
      a.defaultPlaybackRate = mult;
      a.playbackRate = mult;
    } catch (_) {}
  }

  // Getter compatibility
  Object.defineProperty(state, 'audioEl', {
    get() { return getChapterAudio(); },
    set(val) {
      if (val === null && chapterAudio) {
        try {
          chapterAudio.pause();
          chapterAudio.removeAttribute('src');
          chapterAudio.load();
        } catch (_) {}
      }
    },
    configurable: true,
    enumerable: true,
  });

  function getAudioElement() {
    return getChapterAudio();
  }

  function updateTimeAndProgressUI() {
    if (!chapterAudio || !ui) return;
    const cur = chapterAudio.currentTime || 0;
    const dur = chapterAudio.duration || 0;
    if (ui.timeDisplay) {
      ui.timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    }
    if (ui.progressBar && dur > 0) {
      const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
      ui.progressBar.style.width = pct.toFixed(1) + '%';
    }
  }

  function onAudioTimeUpdate() {
    if (!chapterAudio || !state.playing) return;
    updateTimeAndProgressUI();
    updatePositionState();

    const cur = chapterAudio.currentTime || 0;
    const dur = chapterAudio.duration || 0;
    if (cur > 3 && Math.floor(cur) % 3 === 0) {
      saveResumeTime(cur, dur);
    }

    if (state.autoNext && state.fullChapter && dur > 15 && cur >= dur * 0.75 && !state.nextChap) {
      prepareNextChapter();
    }
  }

  let isScrubbing = false;
  function initSeekTrack(trackEl) {
    if (!trackEl) return;

    function seekToEvent(e) {
      if (!chapterAudio || !chapterAudio.duration) return;
      const rect = trackEl.getBoundingClientRect();
      const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      chapterAudio.currentTime = ratio * chapterAudio.duration;
      updateTimeAndProgressUI();
      updatePositionState();
    }

    trackEl.addEventListener('click', (e) => {
      seekToEvent(e);
    });

    trackEl.addEventListener('mousedown', (e) => {
      isScrubbing = true;
      seekToEvent(e);
      const onMouseMove = (ev) => {
        if (!isScrubbing) return;
        seekToEvent(ev);
      };
      const onMouseUp = () => {
        isScrubbing = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    trackEl.addEventListener('touchstart', (e) => {
      isScrubbing = true;
      seekToEvent(e);
    }, { passive: true });

    trackEl.addEventListener('touchmove', (e) => {
      if (!isScrubbing) return;
      seekToEvent(e);
    }, { passive: true });

    trackEl.addEventListener('touchend', () => {
      isScrubbing = false;
    });
  }

  function seekAudioRelative(seconds) {
    const audio = getChapterAudio();
    if (!audio) return;
    const cur = audio.currentTime || 0;
    const dur = audio.duration || 0;
    let target = cur + seconds;
    if (target < 0) target = 0;
    if (dur > 0 && target >= dur) {
      if (state.autoNext) playNextChapter();
      else {
        audio.currentTime = dur;
        onAudioEnded();
      }
      return;
    }
    audio.currentTime = target;
    updateTimeAndProgressUI();
    updatePositionState();
  }

  function playNextChapter() {
    if (typeof S !== 'undefined' && S.chapters) {
      const curChap = state.playingCur != null ? state.playingCur : S.cur;
      if (curChap < S.chapters.length - 1) {
        if (typeof primeAudioPlayback === 'function') primeAudioPlayback();
        if (typeof nav === 'function') nav(curChap + 1);
        setTimeout(() => { if (typeof onPlayClick === 'function') onPlayClick(); }, 250);
      }
    }
  }

  function playPrevChapter() {
    if (typeof S !== 'undefined' && S.chapters) {
      const curChap = state.playingCur != null ? state.playingCur : S.cur;
      if (curChap > 0) {
        if (typeof primeAudioPlayback === 'function') primeAudioPlayback();
        if (typeof nav === 'function') nav(curChap - 1);
        setTimeout(() => { if (typeof onPlayClick === 'function') onPlayClick(); }, 250);
      }
    }
  }

  function updatePositionState() {
    const curAudio = getChapterAudio();
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && curAudio) {
      try {
        const dur = curAudio.duration;
        const pos = curAudio.currentTime;
        if (!isNaN(dur) && !isNaN(pos) && dur > 0) {
          navigator.mediaSession.setPositionState({
            duration: dur,
            playbackRate: curAudio.playbackRate || 1,
            position: Math.min(pos, dur)
          });
        }
      } catch (_) {}
    }
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      const chapTitle = playingChapterLabel() || ((typeof S !== 'undefined' && S.chapters && S.chapters[S.cur]) ? S.chapters[S.cur].title : '');
      navigator.mediaSession.metadata = new MediaMetadata({
        title: chapTitle || document.title,
        artist: 'TruyenDichAI',
        album: chapTitle || 'Truyện Dịch AI',
      });
    } catch (_) {}
  }

  function chapterSignature(idx) {
    if (typeof S === 'undefined' || !S.chapters || !S.chapters[idx]) return null;
    const ch = S.chapters[idx];
    const len = S.chapters.length;
    const title = ch.title || '';
    return idx + '::' + len + '::' + title;
  }

  function syncExpectedChapter() {
    if (typeof S === 'undefined') return;
    state.expectedCur = S.cur;
    state.expectedChaptersRef = S.chapters;
    state.expectedSig = chapterSignature(S.cur);
    updateNavButtons();
  }

  function syncPlayingChapter() {
    if (typeof S === 'undefined') return;
    state.playingCur = S.cur;
    state.playingChaptersRef = S.chapters;
    state.playingSig = chapterSignature(S.cur);
    updateNavButtons();
  }

  function resumeStorageKey() {
    return 'tts_resume::' + location.origin + location.pathname;
  }

  function saveResumeTime(cur, dur) {
    if (!state.fullChapter || !state.playingSig || cur < 5) return;
    if (dur && cur >= dur - 5) {
      clearResumePoint();
      return;
    }
    try {
      localStorage.setItem(resumeStorageKey(), JSON.stringify({
        sig: state.playingSig,
        time: Math.floor(cur),
        duration: Math.floor(dur)
      }));
    } catch (_) {}
  }

  function loadResumePoint() {
    try {
      const raw = localStorage.getItem(resumeStorageKey());
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function clearResumePoint() {
    try { localStorage.removeItem(resumeStorageKey()); } catch (_) {}
  }

  function getResumeForCurrentChapter() {
    if (typeof S === 'undefined' || !S.chapters) return null;
    const saved = loadResumePoint();
    if (!saved || !saved.sig) return null;
    return saved.sig === chapterSignature(S.cur) ? saved : null;
  }

  function resumeSavedPoint() {
    const saved = getResumeForCurrentChapter();
    if (!saved || !saved.time) return;
    const fullText = getCurrentText();
    if (!fullText) return;
    if (typeof primeAudioPlayback === 'function') primeAudioPlayback();
    startReading(fullText, true, saved.time);
  }

  function watchExternalChapterChange() {
    setInterval(() => {
      if (typeof S === 'undefined') return;
      updateResumeRow();
      updateNavButtons();
      if (state.expectedCur === null) { syncExpectedChapter(); return; }
      const curSig = chapterSignature(S.cur);
      const sigChanged = curSig !== state.expectedSig;
      if (sigChanged) {
        if (state.uiState !== 'idle') {
          const backToPlayingChapter = state.chapterDetached
            && curSig !== null && curSig === state.playingSig;
          if (backToPlayingChapter) {
            state.chapterDetached = false;
            setUIState(state.uiState);
          } else if (!state.chapterDetached) {
            state.chapterDetached = true;
            setUIState(state.uiState);
          }
        }
        syncExpectedChapter();
      }
    }, 400);
  }
  watchExternalChapterChange();

  function playPreparedBlob(blob, myToken, resumeTime = 0) {
    if (myToken !== state.token) return;
    const audio = getChapterAudio();
    const oldSrc = audio.src;
    const blobUrl = URL.createObjectURL(blob);
    audio.src = blobUrl;
    if (oldSrc && oldSrc.startsWith('blob:')) {
      try { URL.revokeObjectURL(oldSrc); } catch (_) {}
    }
    audio.volume = state.volume;
    applySpeedToAudio(audio, state.speed);
    if (resumeTime > 0) {
      try { audio.currentTime = resumeTime; } catch (_) {}
    }

    function doPlay() {
      if (myToken !== state.token) return;
      applySpeedToAudio(audio, state.speed);
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          if (myToken === state.token) {
            applySpeedToAudio(audio, state.speed);
            state.playing = true;
            setUIState('playing');
            syncBgmWithTts();
            updateMediaSession();
          }
        }).catch((err) => {
          console.warn('Play error:', err);
          if (myToken === state.token) {
            state.playing = false;
            setUIState('paused');
            setStatus('Chạm nút Phát để nghe');
          }
        });
      }
    }

    doPlay();
  }

  async function startReading(text, fullChapter = true, forceResumeTime = 0) {
    state.token++;
    const myToken = state.token;

    if (chapterAudio) {
      try {
        chapterAudio.pause();
        chapterAudio.onended = null;
        chapterAudio.onerror = null;
        if (chapterAudio.src && chapterAudio.src.startsWith('blob:')) {
          URL.revokeObjectURL(chapterAudio.src);
        }
      } catch (_) {}
    }

    state.nextChap = null;
    state.fullChapter = fullChapter;
    state.chapterDetached = false;
    syncPlayingChapter();

    setUIState('loading');
    setStatus('Đang tải âm thanh toàn bộ chương…');
    if (ui.progressBar) ui.progressBar.style.width = '5%';
    if (ui.timeDisplay) ui.timeDisplay.textContent = '00:00 / 00:00';

    const blocks = splitChapterIntoBlocks(text, 700);
    if (!blocks.length) {
      stopReading('Không có nội dung để đọc.');
      return;
    }

    const fullBlob = await synthesizeBlocksParallel(blocks, myToken, (done, total) => {
      if (myToken !== state.token) return;
      const pct = Math.round((done / total) * 100);
      if (ui.progressBar) ui.progressBar.style.width = pct + '%';
      setStatus(`Đang tải âm thanh: ${done}/${total} (${pct}%)`);
    });

    if (myToken !== state.token) return;
    if (!fullBlob) {
      stopReading('Lỗi tổng hợp giọng đọc cho chương này.');
      return;
    }

    state.fullChapterBlob = fullBlob;
    playPreparedBlob(fullBlob, myToken, forceResumeTime);
  }

  function startReadingBackground(text) {
    state.token++;
    const myToken = state.token;
    if (chapterAudio) {
      try {
        chapterAudio.pause();
        chapterAudio.onended = null;
        chapterAudio.onerror = null;
        if (chapterAudio.src && chapterAudio.src.startsWith('blob:')) {
          URL.revokeObjectURL(chapterAudio.src);
        }
      } catch (_) {}
    }
    state.nextChap = null;
    state.fullChapter = true;
    setUIState('loading');
    setStatus('Đang tải âm thanh chương kế (nền)…');

    const blocks = splitChapterIntoBlocks(text, 700);
    if (!blocks.length) {
      stopReading('Không có nội dung để đọc.');
      return;
    }

    synthesizeBlocksParallel(blocks, myToken, null).then(fullBlob => {
      if (myToken !== state.token) return;
      if (!fullBlob) {
        stopReading('Lỗi tổng hợp giọng đọc chương kế.');
        return;
      }
      state.fullChapterBlob = fullBlob;
      playPreparedBlob(fullBlob, myToken, 0);
    }).catch(() => {
      if (myToken === state.token) stopReading('Lỗi tải âm thanh.');
    });
  }

  function prepareNextChapter() {
    if (!state.autoNext || state.nextChap) return;
    if (typeof S === 'undefined' || typeof nav !== 'function') return;
    const baseCur = state.playingCur != null ? state.playingCur : S.cur;
    if (baseCur < 0 || baseCur >= S.chapters.length - 1) return;
    const ni = baseCur + 1;
    const prep = { blob: null, ready: false, failed: false, ni };
    state.nextChap = prep;
    const myToken = state.token;

    if (typeof _startPreload === 'function') _startPreload(ni);
    const started = Date.now();
    const poll = setInterval(() => {
      if (myToken !== state.token || state.nextChap !== prep) { clearInterval(poll); return; }
      const ch = (typeof S !== 'undefined') ? S.chapters[ni] : null;
      if (!ch) { clearInterval(poll); prep.failed = true; return; }
      const hasText = !!S.translations[ni] || !S.auto;
      if (hasText) {
        clearInterval(poll);
        const raw = S.translations[ni] || ch.content;
        const text = cleanCensorChars(applyReplace(stripTitle(raw, ch.title)));
        const blocks = splitChapterIntoBlocks(text, 700);
        if (!blocks.length) { prep.failed = true; return; }
        synthesizeBlocksParallel(blocks, myToken, null).then((blob) => {
          if (myToken !== state.token || state.nextChap !== prep) return;
          if (blob) {
            prep.blob = blob;
            prep.ready = true;
          } else {
            prep.failed = true;
          }
        }).catch(() => {
          prep.failed = true;
        });
      } else if (Date.now() - started > 35000) {
        clearInterval(poll);
        prep.failed = true;
      }
    }, 500);
  }

  async function finishChapterAutoNext() {
    if (typeof S === 'undefined' || typeof nav !== 'function') {
      stopReading('Đã đọc xong chương.');
      return;
    }
    const myToken = state.token;
    const wasDetached = state.chapterDetached;
    const baseCur = state.playingCur != null ? state.playingCur : S.cur;
    setUIState('loading');
    setStatus(wasDetached ? 'Đang tự động đọc tiếp chương kế (không đổi trang)…' : 'Đang chuyển chương tiếp theo…');

    let prep = state.nextChap;
    if (!prep && baseCur < S.chapters.length - 1) {
      prepareNextChapter();
      prep = state.nextChap;
    }

    if (prep) {
      const started = Date.now();
      while (!prep.ready && !prep.failed) {
        if (myToken !== state.token) return;
        if (Date.now() - started > 35000) { prep.failed = true; break; }
        await new Promise(r => setTimeout(r, 200));
      }
      if (myToken !== state.token) return;

      if (prep.ready && prep.blob && baseCur + 1 === prep.ni) {
        state.nextChap = null;
        if (!state.chapterDetached) {
          nav(prep.ni);
          syncExpectedChapter();
        }
        state.playingCur = prep.ni;
        state.playingChaptersRef = S.chapters;
        state.playingSig = chapterSignature(prep.ni);
        playPreparedBlob(prep.blob, myToken, 0);
        return;
      }
    }

    state.nextChap = null;
    if (baseCur >= S.chapters.length - 1) {
      clearResumePoint();
      stopReading('Đã đọc xong toàn bộ truyện.');
      return;
    }

    if (state.chapterDetached) {
      const ni = baseCur + 1;
      if (typeof _startPreload === 'function') _startPreload(ni);
      const started2 = Date.now();
      const poll = setInterval(() => {
        if (myToken !== state.token) { clearInterval(poll); return; }
        const ch = S.chapters[ni];
        if (!ch) { clearInterval(poll); stopReading('Không tìm thấy chương tiếp theo.'); return; }
        const hasText = !!S.translations[ni] || !S.auto;
        if (hasText) {
          clearInterval(poll);
          const raw = S.translations[ni] || ch.content;
          const text = cleanCensorChars(applyReplace(stripTitle(raw, ch.title)));
          state.playingCur = ni;
          state.playingChaptersRef = S.chapters;
          state.playingSig = chapterSignature(ni);
          startReadingBackground(text);
        } else if (Date.now() - started2 > 35000) {
          clearInterval(poll);
          stopReading('Chương tiếp theo chưa dịch xong, dừng đọc.');
        }
      }, 500);
      return;
    }

    nav(baseCur + 1);
    syncExpectedChapter();
    const started2 = Date.now();
    const poll = setInterval(() => {
      if (myToken !== state.token) { clearInterval(poll); return; }
      const text = getCurrentText();
      if (text) {
        clearInterval(poll);
        startReading(text, true);
      } else if (Date.now() - started2 > 35000) {
        clearInterval(poll);
        stopReading('Chương tiếp theo chưa dịch xong, dừng đọc.');
      }
    }, 500);
  }

  async function onAudioEnded() {
    if (!state.fullChapter) {
      stopReading('Đã đọc xong văn bản.');
      return;
    }
    clearResumePoint();
    if (state.autoNext) {
      await finishChapterAutoNext();
    } else {
      state.playing = false;
      setUIState('idle');
      setStatus('Đã đọc xong chương.');
      syncBgmWithTts();
    }
  }

  function stopReading(msg) {
    state.token++;
    if (chapterAudio) {
      try {
        chapterAudio.pause();
        chapterAudio.onended = null;
        chapterAudio.onerror = null;
        if (chapterAudio.src && chapterAudio.src.startsWith('blob:')) {
          URL.revokeObjectURL(chapterAudio.src);
        }
        chapterAudio.removeAttribute('src');
        chapterAudio.load();
      } catch (_) {}
    }
    state.fullChapterBlob = null;
    state.playing = false;
    state.nextChap = null;
    state.chapterDetached = false;
    state.playingCur = null;
    state.playingChaptersRef = null;
    syncBgmWithTts();
    if (ui) {
      setUIState('idle');
      if (ui.timeDisplay) ui.timeDisplay.textContent = '00:00 / 00:00';
      if (ui.progressBar) ui.progressBar.style.width = '0%';
      if (msg !== '' && msg !== undefined) setStatus(msg);
    }
  }

  const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
  function primeAudioPlayback() {
    try {
      const a = getChapterAudio();
      if (!state.playing) {
        if (!a.src || a.src === '' || a.src.startsWith('data:audio/wav')) {
          a.src = SILENT_WAV;
        }
        const p = a.play();
        if (p !== undefined) p.catch(() => {});
      }
    } catch (_) {}
  }

  function onPlayClick() {
    primeAudioPlayback();
    const text = getCurrentText();
    if (!text) { setStatus('Chưa có nội dung để đọc.'); return; }
    if (typeof window.showPlayTipOnce === 'function') window.showPlayTipOnce();
    startReading(text, true);
  }

  function onPauseClick() {
    if (state.playing) {
      if (chapterAudio) chapterAudio.pause();
      state.playing = false;
      setUIState('paused');
      syncBgmWithTts();
    } else if (chapterAudio && chapterAudio.src) {
      applySpeedToAudio(chapterAudio, state.speed);
      chapterAudio.play().catch(() => {});
      state.playing = true;
      setUIState('playing');
      syncBgmWithTts();
    }
  }

  function onPlayPauseClick() {
    primeAudioPlayback();
    if (state.uiState === 'idle') onPlayClick();
    else if (state.chapterDetached && (state.uiState === 'loading' || state.uiState === 'playing')) {
      stopReading('Đã dừng đọc.');
    } else onPauseClick();
  }

  // Tai nghe có thể gửi NHIỀU sự kiện phím Media Play/Pause dồn dập cho 1 cử
  // chỉ bấm (ví dụ double-tap), nên không thể chỉ chặn lần gọi thứ 2 — phải
  // gộp: mỗi lần có sự kiện mới thì huỷ hẹn giờ cũ, đặt hẹn giờ mới; chỉ khi
  // KHÔNG còn sự kiện nào đến thêm trong khoảng ngắn thì mới thực sự toggle.
  // Nhờ vậy dù tai nghe gửi 2, 3 hay 4 sự kiện liên tiếp, vẫn chỉ 1 lần toggle.
  let mediaToggleTimer = null;
  function mediaTogglePlayPause() {
    clearTimeout(mediaToggleTimer);
    mediaToggleTimer = setTimeout(() => {
      if (state.uiState === 'idle') onPlayClick(); else onPauseClick();
    }, 300);
  }
  function mediaForcePlay() {
    clearTimeout(mediaToggleTimer);
    mediaToggleTimer = setTimeout(() => {
      if (state.uiState === 'idle') onPlayClick(); else if (!state.playing) onPauseClick();
    }, 300);
  }
  function mediaForcePause() {
    clearTimeout(mediaToggleTimer);
    mediaToggleTimer = setTimeout(() => {
      if (state.playing) onPauseClick();
    }, 300);
  }

  // Nhấn phím Space (hoặc nút Play/Pause trên tai nghe/bàn phím — nhiều thiết
  // bị gửi nút này dưới dạng phím "Media Play/Pause" ở tầng bàn phím) để
  // Phát/Tạm dừng, thay vì Space cuộn trang. Chỉ khi thanh TTS đang mở,
  // không có popup nào đang hiện, và (với phím Space) người dùng không đang
  // gõ vào ô nhập liệu/nút bấm khác (để không phá hành vi Space mặc định ở đó).
  document.addEventListener('keydown', (e) => {
    const isSpace = e.code === 'Space' || e.key === ' ';
    const isMediaKey = e.key === 'MediaPlayPause' || e.key === 'MediaPlay' || e.key === 'MediaPause';
    if (!isSpace && !isMediaKey) return;
    if (!ui || ui.root.style.display === 'none') return;
    if (document.querySelector('.popup-overlay.show')) return;
    if (isSpace) {
      const active = document.activeElement;
      if (active) {
        const tag = active.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || active.isContentEditable) return;
      }
    }
    e.preventDefault();
    if (e.key === 'MediaPlay') { mediaForcePlay(); return; }
    if (e.key === 'MediaPause') { mediaForcePause(); return; }
    if (isSpace) {
      // Space bàn phím thật: toggle trực tiếp, không qua debounce dùng chung
      // với tai nghe (để gõ Space nhanh liên tục vẫn phản hồi mượt).
      if (state.uiState === 'idle') onPlayClick(); else onPauseClick();
    } else {
      mediaTogglePlayPause();
    }
  });

  // Điều khiển bằng nút tai nghe / Bluetooth / lock screen (Media Session API)
  // — cơ chế chuẩn mà AirPods trên macOS/iOS và nhiều tai nghe khác dùng để
  // gửi play/pause lên web (khác với phím Media Play/Pause ở tầng bàn phím
  // phía trên, dùng chung các hàm debounce để không bị toggle trùng lặp nếu
  // một thiết bị nào đó vô tình kích hoạt cả 2 cơ chế cùng lúc).
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => { mediaForcePlay(); });
      navigator.mediaSession.setActionHandler('pause', () => { mediaForcePause(); });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        playPrevChapter();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNextChapter();
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const offset = (details && details.seekOffset) || 10;
        seekAudioRelative(offset);
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const offset = (details && details.seekOffset) || 10;
        seekAudioRelative(-offset);
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details && details.seekTime != null && chapterAudio) {
          chapterAudio.currentTime = details.seekTime;
          updateTimeAndProgressUI();
          updatePositionState();
        }
      });
      navigator.mediaSession.setActionHandler('stop', () => { stopReading(); });
    } catch (_) {}
  }

  // Dừng đọc NGAY khi trình duyệt báo mất mạng ('offline') thay vì chờ lượt
  // tổng hợp giọng đọc kế tiếp thất bại rồi mới phát hiện (xem thêm bộ đếm
  // state.consecutiveFailures trong playChunk() — phòng trường hợp có mạng
  // nhưng không tới được server TTS, ví dụ lỗi DNS/firewall, browser vẫn
  // báo navigator.onLine = true nên không bắn sự kiện 'offline').
  window.addEventListener('offline', () => {
    if (state.uiState !== 'idle') {
      stopReading('Mất kết nối mạng, đã dừng đọc.');
    }
  });

  // Đo chiều cao thật của thanh TTS (thay vì đoán một con số cố định) rồi
  // ghi vào CSS variable --tts-bar-h. Nhờ vậy khoảng chừa cho nội dung/
  // nút nổi luôn khớp với chiều cao thực tế, không bị đẩy lên quá mức lẫn
  // không bị thiếu (dẫn tới bị thanh TTS đè lên).
  // Dùng ResizeObserver thay vì chỉ lắng nghe window resize, vì chiều cao
  // thanh TTS còn đổi khi NỘI DUNG đổi (câu đang đọc dài/ngắn khác nhau,
  // dòng trạng thái hiện/ẩn khi Phát/Tạm dừng...) — những thay đổi này
  // không kèm theo sự kiện resize cửa sổ nào cả.
  let ttsBarResizeObserver = null;
  function syncTtsBarHeight() {
    if (!ui || ui.root.style.display === 'none') return;
    // Đo .tts-bar-outer (bao ngoài .tts-bar) thay vì chỉ .tts-bar — để khi
    // hàng "Đang phát Chương N: ..." (.tts-detached-row) hiện ra phía trên
    // thanh chính, chiều cao chừa cho nội dung/nút nổi vẫn tính đúng luôn cả
    // phần đó, không bị đè lên. .tts-settings (popover cài đặt) không ảnh
    // hưởng vì nó position:absolute, không cộng vào chiều cao layout của
    // .tts-bar-outer.
    const bar = ui.root.querySelector('.tts-bar-outer');
    if (!bar) return;
    const h = bar.getBoundingClientRect().height;
    if (h > 0) document.documentElement.style.setProperty('--tts-bar-h', h + 'px');
  }

  window.toggleTtsReader = function () {
    if (typeof primeAudioPlayback === 'function') primeAudioPlayback();
    if (!ui) buildUI();
    const willOpen = ui.root.style.display === 'none';
    ui.root.style.display = willOpen ? 'flex' : 'none';
    setFloatBtnOn(willOpen);
    updateFloatBtnVisibility();
    // Chừa chỗ ở cuối nội dung + đẩy các nút nổi khác (lên đầu trang, sticker
    // hỗ trợ) lên trên, để thanh TTS không đè lên chúng khi đang mở.
    document.body.classList.toggle('tts-open', willOpen);
    if (willOpen) {
      // Vừa mở thanh nghe — kiểm tra xem đúng chương đang hiển thị có khớp
      // với vị trí "dang dở" đã lưu của truyện này không, để hiện/ẩn hàng
      // "Nghe tiếp đoạn dang dở?" ngay lập tức (không cần đợi tick định kỳ).
      updateResumeRow();
      const bar = ui.root.querySelector('.tts-bar-outer');
      if (bar) {
        if (!ttsBarResizeObserver) {
          ttsBarResizeObserver = new ResizeObserver(syncTtsBarHeight);
        }
        ttsBarResizeObserver.observe(bar);
      }
      // Đo ngay 1 lần (phòng khi trình duyệt không hỗ trợ ResizeObserver).
      requestAnimationFrame(syncTtsBarHeight);
      window.addEventListener('resize', syncTtsBarHeight);
      // Gợi ý cài VPN — chỉ hiện lần đầu mở thanh nghe (hàm này định nghĩa trong index.html).
      if (typeof window.showVpnHintOnce === 'function') window.showVpnHintOnce();
    } else {
      if (ttsBarResizeObserver) ttsBarResizeObserver.disconnect();
      window.removeEventListener('resize', syncTtsBarHeight);
    }
  };

  // Tạo nút "Nghe" nổi ở lề phải (giống nút float của extension)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildFloatBtn);
  } else {
    buildFloatBtn();
  }

  // ─── Tooltip khi bôi đen văn bản: nút loa → "Đọc văn bản" / "Đọc từ đây" ──
  const SVG_SEL_SPEAKER = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
  const SVG_SEL_READ = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>';
  const SVG_SEL_FROM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="13" y2="6"/><line x1="3" y1="10" x2="10" y2="10"/><line x1="3" y1="14" x2="8" y2="14"/><polyline points="14 10 19 15 14 20"/><line x1="19" y1="15" x2="9" y2="15"/></svg>';

  let selTip = null;
  let selExpanded = false;
  let selHideTimer = null;
  let selSavedRange = null;
  let selSavedText = null;

  // Mở thanh đọc (nếu đang đóng/chưa tạo) rồi bắt đầu đọc đoạn text chỉ định.
  // fullChapter=false (mặc định) cho "Đọc văn bản" — chỉ 1 đoạn bôi đen thủ
  // công, đọc xong là dừng, không tự next chương. "Đọc từ đây" thì đọc tới
  // hết chương nên truyền fullChapter=true để auto-next hoạt động đúng khi
  // đọc xong đoạn còn lại của chương.
  function readTextViaSelection(text, fullChapter = false) {
    if (!text) return;
    if (typeof primeAudioPlayback === 'function') primeAudioPlayback();
    if (!ui || ui.root.style.display === 'none') window.toggleTtsReader();
    startReading(text, fullChapter);
  }

  // Tính offset (số ký tự) của điểm bắt đầu vùng bôi đen tính từ đầu
  // .reading-content — dùng để cắt lấy phần text còn lại cho "Đọc từ đây".
  function getSelOffsetInContent(range) {
    const contentEl = document.querySelector('#chContent .reading-content');
    if (!contentEl) return -1;
    try {
      const preRange = document.createRange();
      preRange.selectNodeContents(contentEl);
      preRange.setEnd(range.startContainer, range.startOffset);
      return preRange.toString().length;
    } catch (_) { return -1; }
  }

  function hideSelTip() {
    if (!selTip) return;
    selTip.style.display = 'none';
    selExpanded = false;
    selTip.querySelector('#tts-sel-menu').classList.remove('open');
    clearTimeout(selHideTimer);
  }

  function showSelTip(x, y) {
    selExpanded = false;
    selTip.querySelector('#tts-sel-menu').classList.remove('open');
    selTip.style.left = x + 'px';
    selTip.style.top = y + 'px';
    selTip.style.display = 'flex';
  }

  function buildSelTooltip() {
    if (selTip) return;
    selTip = document.createElement('div');
    selTip.id = 'tts-sel-tooltip';
    selTip.innerHTML = `
      <button id="tts-sel-icon-btn" title="Đọc bằng giọng nói">${SVG_SEL_SPEAKER}</button>
      <div id="tts-sel-menu">
        <button id="tts-sel-read">${SVG_SEL_READ} Đọc văn bản</button>
        <button id="tts-sel-from">${SVG_SEL_FROM} Đọc từ đây</button>
      </div>`;
    document.body.appendChild(selTip);

    selTip.querySelector('#tts-sel-icon-btn').addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      selExpanded = !selExpanded;
      selTip.querySelector('#tts-sel-menu').classList.toggle('open', selExpanded);
    });

    selTip.querySelector('#tts-sel-read').addEventListener('mousedown', (e) => {
      e.preventDefault();
      hideSelTip();
      readTextViaSelection(selSavedText);
    });

    selTip.querySelector('#tts-sel-from').addEventListener('mousedown', (e) => {
      e.preventDefault();
      hideSelTip();
      const fullText = getCurrentText();
      const offset = selSavedRange ? getSelOffsetInContent(selSavedRange) : -1;
      const text = (offset >= 0 && fullText) ? fullText.slice(offset).trim() : selSavedText;
      readTextViaSelection(text, true);
    });

    document.addEventListener('mouseup', (e) => {
      if (e.target.closest('#tts-sel-tooltip') || e.target.closest('#tts-root')) return;
      clearTimeout(selHideTimer);
      selHideTimer = setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim();
        if (!text || sel.rangeCount === 0) { hideSelTip(); return; }

        // Chỉ hiện tooltip khi vùng bôi đen nằm trong nội dung chương đọc.
        const range = sel.getRangeAt(0);
        let node = range.commonAncestorContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        if (!node || !node.closest('#chContent .reading-content')) { hideSelTip(); return; }

        selSavedText = text;
        selSavedRange = range.cloneRange();

        const rects = selSavedRange.getClientRects();
        if (!rects.length) { hideSelTip(); return; }
        const first = rects[0];
        let tx = first.left - 36;
        let ty = first.top;
        tx = Math.max(4, tx);
        if (tx + 36 > window.innerWidth - 4) tx = window.innerWidth - 40;
        if (ty + 32 > window.innerHeight - 4) ty = window.innerHeight - 36;
        showSelTip(tx, ty);
      }, 50);
    });

    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('#tts-sel-tooltip')) return;
      hideSelTip();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideSelTip();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildSelTooltip);
  } else {
    buildSelTooltip();
  }
})();