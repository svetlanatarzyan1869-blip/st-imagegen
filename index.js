/*
 * ImageGen (proxy) — расширение SillyTavern.
 * Картинки по ходу ролёвки через прокси-генерацию (как в Tavo-версии).
 *
 * Два режима:
 *  - auto (по умолчанию, card-agnostic): бот пишет обычный ответ → расширение вырезает служебные
 *    теги → шлёт прозу в промпт-райтер → генерит картинку → вставляет ИНЛАЙН в текст (markdown).
 *    Карточку/пресет юзеру править НЕ нужно.
 *  - marker: модель сама вставляет [IMG]eng|rus|Name;Name2[/IMG] — заменяется на инлайн-картинку.
 *
 * Всё конфигурится в панели ST. DATA (зашифрованные ключи) — с сайта-конструктора.
 */

const KEY = 'imagegen_proxy';

const BASE_URLS = {
  link: 'https://linkapi-proxy-imgbb-key-cache.vercel.app/api/generate',
  naistera: 'https://naistera.vercel.app/api/generate',
  pollinations: 'https://pollinations-tavo.vercel.app/api/generate'
};
const MODELS = {
  link: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview', 'gemini-3-pro-image', 'gemini-2.5-flash-image', 'pro/gemini-3.1-flash-image-preview', 'pro/gemini-3-pro-image-preview', 'pro/gemini-2.5-flash-image', 'gpt-image-2', 'gpt-image-2-c'],
  naistera: ['flux', 'flux-realism', 'flux-anime', 'flux-3d', 'sdxl', 'sd-3.5-large'],
  pollinations: ['flux', 'zimage', 'klein', 'kontext', 'gptimage', 'gptimage-large', 'gpt-image-2', 'nova-canvas']
};

// Пресеты стилей — полный каталог из styles.json прокси (149 шт).
const STYLES = [
  'monet', 'manet', 'van_gogh', 'serov',
  'rembrandt', 'repin', 'klimt', 'dark_fantasy',
  'classic_fantasy', 'horror_illustration', 'art_nouveau', 'bilibin_v3',
  'pin_up', 'cinematic_realism', 'cinematic_art', 'film_noir',
  'sin_city', 'webcam_candid', 'oldschool_lowpoly', 'skyrim',
  'baldurs_gate_3', 'stalker', 'minecraft', 'mmo_2000s',
  'stardew_valley', 'genshin_impact', 'borderlands', 'point_and_click',
  'adventure_time', 'star_vs_evil', 'rick_and_morty', 'steven_universe',
  'winx_club', 'witch', 'bratz', 'tim_burton_2d',
  'anime_still', 'visual_novel', 'fourth_wall', 'manhwa',
  'chibi_manhwa', 'manga_bw', 'studio_ghibli', 'hokusai',
  'japanese_watercolor', 'sketch', 'linocut', 'pop_art',
  'soviet_mosaic', 'soviet_poster', 'spider_verse', 'arcane_v4',
  'matt_rhodes_bioware', 'stop_motion_puppet', 'tim_burton_stopmotion', 'cyberpunk_2077_photo_mode',
  'cyberpunk_2077_screenshot', 'fallout_4_photo_mode', 'fallout_4_screenshot', 'gta_san_andreas',
  'vtmb_bloodlines', 'league_of_legends_splash', 'cinestill_800t', 'kodak_portra_400',
  'fujifilm_pro_400h', 'fujifilm_velvia_50', 'lomography_cross_process', 'disposable_camera',
  'caravaggio', 'semi_real_roulette', 'alex_ross', 'artgerm',
  'charlie_bowater', 'cinematic_manhwa', 'guweiz', 'kyoto_animation',
  'luminist_oil', 'makoto_shinkai', 'moebius', 'nan_goldin',
  'peter_lindbergh', 'pre_raphaelite', 'retro_shoujo', 'ross_tran',
  'ufotable', 'takehiko_inoue', 'vhs_camcorder', 'vofan',
  'wlop', '80s_anime', 'yoshitaka_amano', 'annie_leibovitz',
  'avatar_the_last_airbender', 'bjd_doll', 'bloodborne_elden_ring', 'karl_bryullov',
  'cartoon_network', 'charcoal_portrait', 'clamp', 'cowboy_bebop',
  'vampire_hunter_d', 'disney_renaissance', 'dry_pastel', 'gachiakuta',
  'hand_painted_key_art', 'hellsing_ultimate', 'helmut_newton', 'hotline_miami',
  'infinity_nikki', 'inio_asano', 'junji_ito', 'junji_ito_manga_page',
  'kawaii', 'klaus', 'ilya_kuvshinov', 'malcolm_liepke',
  'life_is_strange_like', 'mike_mignola', 'national_geographic', 'neon_comic',
  'yuri_norshtein', 'overwatch', 'pascal_campion', 'persian_miniature',
  'persona_5', 'persona_5_no_text', 'polaroid_sx_70', 'rococo',
  'russian_collectible_book', 'russian_fairy_tale_book_illustration', 'andrei_rublev_russian_icon', 'john_singer_sargent',
  'egon_schiele', 'scrapbook_punk_zine_photomontage', 'scrapbook_semireal', 'silent_hill_2',
  'soft_oil_pastel', 'stained_glass_window', 'tarkovsky_kalatozov', 'trigger',
  'kodak_tri_x_400_ilford_hp5', 'viktor_vasnetsov', 'vivian_maier', 'mikhail_vrubel',
  'watercolor', 'wes_anderson', 'wolfwalkers', 'world_of_horror',
  'y2k_cellphone'
];

const DEFAULTS = {
  enabled: true,
  mode: 'auto',        // 'auto' | 'marker'
  autoEvery: 1,        // auto: генерить каждый N-й ответ бота
  baseUrl: BASE_URLS.link,
  writerUrl: 'https://vision-proxy-tavo.vercel.app/api/promptwriter',
  provider: 'link',
  model: 'gemini-3.1-flash-image-preview',
  style: 'y2k_cellphone',
  edBg: '',    // редактор: фон/локация (english)
  edPose: '',  // редактор: поза/ракурс
  edHair: '',  // редактор: причёска/эмоция
  userId: '',
  data: '',            // зашифрованный DATA-блок с сайта (шаг «зашифровать ключи»)
  refs: [],            // [{name, url}]
  lastError: ''
};

function ctx() { return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null; }
function settings() {
  const c = ctx();
  if (!c) return Object.assign({}, DEFAULTS);
  c.extensionSettings[KEY] = Object.assign({}, DEFAULTS, c.extensionSettings[KEY] || {});
  return c.extensionSettings[KEY];
}
function saveSettings() { const c = ctx(); try { c.saveSettingsDebounced(); } catch (e) {} }
function toast(msg, type) { try { if (typeof toastr !== 'undefined') toastr[type || 'info'](msg, 'ImageGen'); } catch (e) {} }
function norm(s) { return (s || '').trim().toLowerCase(); }
function b64dJson(b64) { try { return JSON.parse(decodeURIComponent(escape(atob(b64)))); } catch (e) { try { return JSON.parse(atob(b64)); } catch (e2) { return null; } } }

// ── чистка ответа до прозы (убираем <think>, [TAG]..[/TAG], <TAG>..</TAG>, одиночные [..] строки) ──
function stripToProse(mes) {
  let t = String(mes || '');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  t = t.replace(/\[([A-Za-z_]+)\][\s\S]*?\[\/\1\]/g, ' ');   // [HUD]..[/HUD], [IM]..[/IM], [CONSEQUENCE].., [CHAOS]..
  t = t.replace(/<([A-Za-z_]+)>[\s\S]*?<\/\1>/g, ' ');       // <DYNAMICS>..</DYNAMICS>
  t = t.replace(/^\s*\[[^\]\n]*\]\s*$/gm, ' ');              // одиночные [X: ...] строки
  t = t.replace(/^\s*[A-ZА-Я][A-ZА-Я0-9 _\-]{1,30}:.*$/gm, ' '); // утёкшие ярлыки ризонинга (WHO:, WORLD:, COLD READ:...)
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── маркер [IMG]eng|rus|chars[/IMG] ──
function parseMarker(text) {
  if (!text) return null;
  const m = text.match(/\[IMG\]([\s\S]*?)\[\/IMG\]/);
  if (!m) return null;
  const parts = m[1].split('|');
  const eng = (parts[0] || '').trim();
  let rus = (parts[1] || '').trim();
  let charsStr = (parts[2] || '').trim();
  if (!charsStr && parts.length === 2) { charsStr = rus; rus = eng; }
  const chars = [];
  if (charsStr && charsStr.indexOf('нет персонажей') < 0) {
    charsStr.split(';').forEach(function (p) {
      p = p.trim(); if (!p) return;
      const i = p.lastIndexOf(',');
      if (i > 0) chars.push({ name: p.slice(0, i).trim(), url: p.slice(i + 1).trim() });
      else chars.push({ name: p, url: '' });
    });
  }
  return { full: m[0], eng, rus, chars };
}

// имена из панели рефов, встречающиеся в тексте → [{name,url}]
function charsFromText(text) {
  const refs = settings().refs || [];
  const low = String(text || '').toLowerCase();
  const out = [];
  refs.forEach(function (r) { if (r.name && low.indexOf(norm(r.name)) >= 0) out.push({ name: r.name, url: r.url }); });
  return out;
}
// маркер пишет имена — ссылки берём из рефов панели
function resolveChars(chars) {
  const refs = settings().refs || [];
  return (chars || []).map(function (c) {
    if (c.url) return c;
    const f = refs.find(function (r) { return norm(r.name) === norm(c.name); });
    return f ? { name: c.name, url: f.url } : c;
  });
}

// Дописать редакторы сцены (фон/поза/причёска) к промпту.
function applyEditors(eng) {
  const s = settings();
  const extra = [s.edBg, s.edPose, s.edHair].map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  return extra.length ? (String(eng || '').trim() + ', ' + extra.join(', ')) : eng;
}

function buildUrl(eng, chars) {
  const s = settings();
  return s.baseUrl
    + '?data=' + encodeURIComponent(s.data)
    + '&characters=' + encodeURIComponent(JSON.stringify(chars || []))
    + '&prompt=' + encodeURIComponent(applyEditors(eng))
    + '&style=' + encodeURIComponent(s.style)
    + '&model=' + encodeURIComponent(s.model)
    + '&userId=' + encodeURIComponent(s.userId)
    + '&_r=' + Date.now();
}

function saveErrReport(kind, r, bodyText, info, exc, url) {
  const s = settings();
  const L = [];
  L.push('=== ImageGen (ST) error report ===');
  L.push('time: ' + new Date().toISOString());
  L.push('mode: ' + s.mode + ' | provider: ' + s.provider + ' | model: ' + s.model + ' | style: ' + s.style);
  L.push('userId: ' + s.userId);
  L.push('');
  L.push('--- error ---');
  L.push('type: ' + kind);
  if (r) { try { L.push('HTTP status: ' + r.status); } catch (e) {} }
  if (info) { try { L.push('X-ImageGen-Error: ' + JSON.stringify(info)); } catch (e) {} }
  if (exc) L.push('exception: ' + ((exc && exc.message) ? exc.message : String(exc)));
  if (bodyText) {
    const bt = String(bodyText);
    const s1 = bt.indexOf('<!--IGLOG'), s2 = bt.indexOf('IGLOG-->');
    if (s1 >= 0 && s2 > s1) { L.push(''); L.push('--- server log (Vercel) ---'); L.push(bt.slice(s1 + 9, s2).trim()); }
  }
  L.push('request URL: ' + String(url || '').replace(/data=[^&]*/, 'data=<hidden>'));
  try { L.push('UA: ' + navigator.userAgent); } catch (e) {}
  s.lastError = L.join('\n');
  saveSettings();
  try { $('#imagegen_lasterror').val(s.lastError); } catch (e) {}
}

// ── Гардероб (SillyWardrobe): активный аутфит → залить на imgbb → реф ──
const outfitCache = {}; // outfitId -> url
async function uploadImage(base64) {
  const s = settings();
  const r = await fetch(s.baseUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: s.data, image: base64 })
  });
  const j = await r.json().catch(function () { return {}; });
  if (!r.ok || !j.url) throw new Error(j.error || ('upload HTTP ' + r.status));
  return j.url;
}
async function outfitRefs() {
  const w = (typeof window !== 'undefined') ? window.sillyWardrobe : null;
  if (!w || (w.isReady && !w.isReady())) return [];
  const out = [];
  for (const side of ['bot', 'user']) {
    let data = null;
    try { data = w.getActiveOutfitData ? w.getActiveOutfitData(side) : null; } catch (e) {}
    let b64 = data && data.base64;
    if (!b64) { try { b64 = w.getActiveOutfitBase64Async ? await w.getActiveOutfitBase64Async(side) : (w.getActiveOutfitBase64 ? w.getActiveOutfitBase64(side) : null); } catch (e) {} }
    if (!b64) continue;
    const id = (data && data.id) || (side + '_' + b64.length);
    if (!outfitCache[id]) {
      try { outfitCache[id] = await uploadImage(b64); console.log('[ImageGen] аутфit', side, 'залит:', outfitCache[id]); }
      catch (e) { console.warn('[ImageGen] аутфит upload fail:', e && e.message); continue; }
    }
    out.push({ name: (data && data.name) || (side + ' outfit'), url: outfitCache[id] });
  }
  return out;
}

// ── генерация (возвращает URL картинки) ──
async function generateFor(eng, chars) {
  chars = (chars || []).slice();
  try { const orefs = await outfitRefs(); if (orefs.length) chars = chars.concat(orefs); } catch (e) {}
  const u = buildUrl(eng, chars);
  console.log('[ImageGen] GET', u);
  let r;
  try { r = await fetch(u); }
  catch (e) {
    console.warn('[ImageGen] fetch threw (вероятно CORS на 302→ibb) → отдаю URL прокси:', e && e.message);
    return u; // <img> сам пройдёт редирект
  }
  const errHdr = r.headers.get('X-ImageGen-Error');
  if (errHdr) {
    const info = b64dJson(errHdr) || {};
    let body = ''; try { body = await r.text(); } catch (e) {}
    saveErrReport('provider_error', r, body, info, null, u);
    throw new Error(info.title || 'ошибка генерации');
  }
  if (!r.ok) {
    let body = ''; try { body = await r.text(); } catch (e) {}
    saveErrReport('http_' + r.status, r, body, null, null, u);
    throw new Error('HTTP ' + r.status);
  }
  console.log('[ImageGen] image URL:', r.url);
  return r.url || u;
}

// ── промпт-райтер (проза → английский промпт сцены) ──
async function callWriter(prose) {
  const s = settings();
  let r;
  try {
    r = await fetch(s.writerUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: s.data, scene: String(prose).slice(0, 4000), style: s.style })
    });
  } catch (e) { saveErrReport('writer_fetch_threw', null, '', null, e, s.writerUrl); throw new Error('промпт-райтер недоступен (CORS?)'); }
  if (!r.ok) { let b = ''; try { b = await r.text(); } catch (e) {} saveErrReport('writer_http_' + r.status, r, b, null, null, s.writerUrl); throw new Error('промпт-райтер HTTP ' + r.status); }
  let txt = ''; try { txt = await r.text(); } catch (e) {}
  txt = (txt || '').trim();
  if (txt.charAt(0) === '{') { try { const j = JSON.parse(txt); txt = j.prompt || j.result || j.text || ''; } catch (e) {} }
  return txt.trim();
}

// ── вставка markdown-картинки ИНЛАЙН в текст сообщения ──
function mdImage(url, caption) {
  // Инлайн-style: санитайзер ST его сохраняет (на нём держится вся разметка в сообщениях).
  const cap = String(caption || '').replace(/[<>]/g, '').trim();
  let h = '<div style="max-width:340px;margin:12px auto;padding:8px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.2);border-radius:12px;box-shadow:0 3px 12px rgba(0,0,0,.4);">';
  h += '<img src="' + url + '" width="320" style="display:block;width:100%;height:auto;border-radius:8px;" alt="">';
  if (cap) h += '<div style="margin-top:6px;font-size:.85em;opacity:.85;text-align:center;font-style:italic;">' + cap + '</div>';
  h += '</div>';
  return h;
}
function firstSentence(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^.{5,120}?[.!?…]/);
  return (m ? m[0] : t.slice(0, 110)).trim();
}
// Лоадер-плейсхолдер (крутится + текст). Спиннер через класс (keyframes в <head>).
function loadingBlock(token) {
  return '<div data-ig="' + token + '" style="max-width:340px;margin:12px auto;padding:22px 12px;text-align:center;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.2);border-radius:12px;">'
    + '<span style="display:inline-block;width:30px;height:30px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:imagegen-rot .9s linear infinite;vertical-align:middle;"></span>'
    + '<div style="margin-top:10px;font-size:.85em;opacity:.8;">Генерирую картинку…</div></div>';
}
// Позиция вставки: СЕРЕДИНА прозы, после </think>, мимо тегов и ярлыков ризонинга.
function placeInProse(mes, html) {
  const hasThink = /<think>/i.test(mes);
  const blocks = String(mes || '').split(/\n\s*\n/);
  let passedThink = !hasThink;
  const isProse = function (b) { return b && !/^[\[<]/.test(b) && !/^[A-ZА-Я][A-ZА-Я0-9 _\-]{1,30}:/.test(b); };
  const proseIdx = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i].trim();
    if (!passedThink) { if (/<\/think>/i.test(b)) passedThink = true; continue; }
    if (isProse(b)) proseIdx.push(i);
  }
  if (!proseIdx.length) for (let i = 0; i < blocks.length; i++) { if (isProse(blocks[i].trim())) proseIdx.push(i); }
  const target = proseIdx.length ? proseIdx[Math.floor((proseIdx.length - 1) / 2)] : blocks.length - 1;
  blocks.splice(target + 1, 0, html);
  return blocks.join('\n\n');
}
function rerender(mesId, message) {
  const c = ctx();
  try { c.updateMessageBlock(mesId, message); } catch (e) { console.error('[ImageGen] updateMessageBlock:', e); }
  try { c.saveChat(); } catch (e) {}
}

// ── создать отдельное сообщение с картинкой (для /imagegen) ──
function addImageMessage(imageUrl, title) {
  const c = ctx(); if (!c) return;
  const msg = {
    name: 'ImageGen', is_user: false, is_system: false,
    send_date: (typeof c.getMessageTimeStamp === 'function' ? c.getMessageTimeStamp() : new Date().toLocaleString()),
    mes: mdImage(imageUrl, title),
    extra: {}
  };
  c.chat.push(msg);
  try { c.addOneMessage(c.chat[c.chat.length - 1]); } catch (e) { console.error('[ImageGen] addOneMessage:', e); }
  try { c.saveChat(); } catch (e) {}
}

// ── обработка ответа бота ──
const processed = new Set();
let autoCounter = 0;
async function handleMessage(mesId) {
  const s = settings();
  console.log('[ImageGen] handleMessage mesId', mesId, '| mode', s.mode);
  const c = ctx(); if (!c) return;
  const message = c.chat[mesId];
  if (!message || message.is_user || message.is_system) { console.log('[ImageGen] skip: не сообщение бота'); return; }
  const key = mesId + ':' + (message.swipe_id != null ? message.swipe_id : 0);
  if (processed.has(key)) { console.log('[ImageGen] skip: уже обработано', key); return; }

  if (!s.data) { console.log('[ImageGen] skip: пустой DATA'); toast('не задан DATA (настройки расширения)', 'warning'); return; }
  const token = 'ig' + Date.now();
  const ph = loadingBlock(token);

  if (s.mode === 'marker') {
    const parsed = parseMarker(message.mes || '');
    if (!parsed) { console.log('[ImageGen] skip: маркер [IMG] не найден'); return; }
    processed.add(key);
    message.mes = String(message.mes || '').replace(parsed.full, ph); // маркер → лоадер
    rerender(mesId, message);
    try {
      const url = await generateFor(parsed.eng, resolveChars(parsed.chars));
      message.mes = String(message.mes || '').replace(ph, mdImage(url, parsed.rus));
      rerender(mesId, message);
    } catch (e) {
      message.mes = String(message.mes || '').replace(ph, parsed.full); // вернуть маркер
      rerender(mesId, message);
      toast('Ошибка: ' + (e.message || e) + ' — см. отчёт', 'error');
    }
    return;
  }

  // auto
  autoCounter++;
  if (s.autoEvery > 1 && (autoCounter % s.autoEvery !== 0)) { console.log('[ImageGen] skip: частота (счётчик', autoCounter, ')'); return; }
  const prose = stripToProse(message.mes || '');
  console.log('[ImageGen] auto: длина прозы', prose.length);
  if (prose.length < 30) { console.log('[ImageGen] skip: проза короче 30 симв'); return; }
  processed.add(key);
  console.log('[ImageGen] auto: старт генерации, промпт-райтер →', s.writerUrl);
  message.mes = placeInProse(String(message.mes || ''), ph); // лоадер в середину прозы
  rerender(mesId, message);
  try {
    const eng = await callWriter(prose);
    if (!eng) throw new Error('пустой промпт от райтера');
    const chars = charsFromText(prose);
    const url = await generateFor(eng, chars);
    message.mes = String(message.mes || '')
      .replace(/\[IMG\][\s\S]*?\[\/IMG\]/g, '')       // остаточный маркер
      .replace(ph, mdImage(url, firstSentence(prose))) // лоадер → картинка
      .replace(/\n{3,}/g, '\n\n').trim();
    rerender(mesId, message);
  } catch (e) {
    message.mes = String(message.mes || '').replace(ph, '').replace(/\n{3,}/g, '\n\n').trim();
    rerender(mesId, message);
    toast('Ошибка: ' + (e.message || e) + ' — см. отчёт', 'error');
  }
}

// ── UI ──
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function populateModels() {
  const s = settings();
  const list = MODELS[s.provider] || MODELS.link;
  const sel = $('#imagegen_model'); sel.empty();
  list.forEach(function (m) { sel.append('<option value="' + esc(m) + '">' + esc(m) + '</option>'); });
  if (list.indexOf(s.model) < 0) { s.model = list[0]; saveSettings(); }
  sel.val(s.model);
}
function populateStyles() {
  const s = settings();
  const sel = $('#imagegen_style_sel'); sel.empty();
  STYLES.forEach(function (v) { sel.append('<option value="' + esc(v) + '">' + esc(v) + '</option>'); });
  sel.append('<option value="__custom__">— свой стиль —</option>');
  if (STYLES.indexOf(s.style) >= 0) { sel.val(s.style); $('#imagegen_style_custom').hide(); }
  else { sel.val('__custom__'); $('#imagegen_style_custom').val(s.style).show(); }
}
function renderRefs() {
  const s = settings();
  const box = $('#imagegen_refs'); box.empty();
  (s.refs || []).forEach(function (r, i) {
    const row = $('<div style="display:flex;gap:4px;margin-bottom:4px;align-items:center;"></div>');
    const nm = $('<input class="text_pole" type="text" placeholder="имя" style="flex:0 0 30%;">').val(r.name);
    const url = $('<input class="text_pole" type="text" placeholder="ссылка на фото (i.ibb.co/...)" style="flex:1;">').val(r.url);
    const del = $('<div class="menu_button" title="удалить" style="flex:0 0 auto;">✕</div>');
    nm.on('input', function () { settings().refs[i].name = $(this).val(); saveSettings(); });
    url.on('input', function () { settings().refs[i].url = $(this).val(); saveSettings(); });
    del.on('click', function () { settings().refs.splice(i, 1); saveSettings(); renderRefs(); });
    row.append(nm).append(url).append(del); box.append(row);
  });
  if (!(s.refs || []).length) box.append('<div style="opacity:.6;font-size:.9em;">Пока нет персонажей. Добавь имя + ссылку на фото.</div>');
}
function injectSettingsUI() {
  const s = settings();
  const html = `
  <div class="imagegen-settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header"><b>ImageGen (proxy)</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
      <div class="inline-drawer-content">
        <label>Режим</label>
        <select id="imagegen_mode" class="text_pole">
          <option value="auto">Авто (картинка из ответа бота — карточку не трогать)</option>
          <option value="marker">Маркер [IMG] (модель сама вставляет)</option>
        </select>
        <label>Как часто в авто-режиме</label>
        <select id="imagegen_every" class="text_pole">
          <option value="1">каждый ответ</option>
          <option value="2">каждый 2-й</option>
          <option value="3">каждый 3-й</option>
        </select>
        <label>Провайдер</label>
        <select id="imagegen_provider" class="text_pole">
          <option value="link">link (LinkAPI)</option>
          <option value="naistera">naistera</option>
          <option value="pollinations">pollinations</option>
        </select>
        <label>Модель</label>
        <select id="imagegen_model" class="text_pole"></select>
        <label>Стиль</label>
        <select id="imagegen_style_sel" class="text_pole"></select>
        <input id="imagegen_style_custom" class="text_pole" type="text" placeholder="свой стиль (текстом)" style="display:none;margin-top:4px;">
        <label>userId (для кэша)</label>
        <input id="imagegen_userid" class="text_pole" type="text">
        <label>DATA (зашифрованные ключи — кнопка «📋 DATA» на сайте)</label>
        <textarea id="imagegen_data" class="text_pole" rows="2" placeholder="IV==:ENC..."></textarea>
        <hr>
        <label><b>Редакторы сцены</b> (по-английски, применяются ко всем картинкам; пусто = не применять)</label>
        <label>Фон / локация</label>
        <input id="imagegen_ed_bg" class="text_pole" type="text" placeholder="напр. dim dorm room, rainy courtyard">
        <label>Поза / ракурс</label>
        <input id="imagegen_ed_pose" class="text_pole" type="text" placeholder="напр. full body shot, close-up, from behind">
        <label>Причёска / эмоция</label>
        <input id="imagegen_ed_hair" class="text_pole" type="text" placeholder="напр. wet hair, tired look">
        <hr>
        <label><b>Персонажи (рефы)</b> — их имена в тексте → подставится фото</label>
        <div id="imagegen_refs"></div>
        <div class="menu_button" id="imagegen_addref" style="margin-top:4px;">+ добавить персонажа</div>
        <hr>
        <label>Отчёт о последней ошибке</label>
        <textarea id="imagegen_lasterror" class="text_pole" rows="6" readonly></textarea>
        <div class="menu_button" id="imagegen_copyerr">Скопировать отчёт</div>
      </div>
    </div>
  </div>`;
  $('#extensions_settings2').append(html);

  $('#imagegen_mode').val(s.mode).on('change', function () { settings().mode = $(this).val(); saveSettings(); });
  $('#imagegen_every').val(String(s.autoEvery)).on('change', function () { settings().autoEvery = parseInt($(this).val(), 10) || 1; saveSettings(); });
  $('#imagegen_provider').val(s.provider).on('change', function () { const p = $(this).val(); settings().provider = p; if (BASE_URLS[p]) settings().baseUrl = BASE_URLS[p]; saveSettings(); populateModels(); });
  $('#imagegen_model').on('change', function () { settings().model = $(this).val(); saveSettings(); });
  $('#imagegen_style_sel').on('change', function () {
    const v = $(this).val();
    if (v === '__custom__') { $('#imagegen_style_custom').show().focus(); settings().style = $('#imagegen_style_custom').val() || ''; }
    else { $('#imagegen_style_custom').hide(); settings().style = v; }
    saveSettings();
  });
  $('#imagegen_style_custom').on('input', function () { settings().style = $(this).val(); saveSettings(); });
  $('#imagegen_ed_bg').val(s.edBg).on('input', function () { settings().edBg = $(this).val(); saveSettings(); });
  $('#imagegen_ed_pose').val(s.edPose).on('input', function () { settings().edPose = $(this).val(); saveSettings(); });
  $('#imagegen_ed_hair').val(s.edHair).on('input', function () { settings().edHair = $(this).val(); saveSettings(); });
  $('#imagegen_userid').val(s.userId).on('input', function () { settings().userId = $(this).val(); saveSettings(); });
  $('#imagegen_data').val(s.data).on('input', function () { settings().data = $(this).val(); saveSettings(); });
  $('#imagegen_addref').on('click', function () { settings().refs.push({ name: '', url: '' }); saveSettings(); renderRefs(); });
  $('#imagegen_lasterror').val(s.lastError);
  $('#imagegen_copyerr').on('click', function () {
    const t = $('#imagegen_lasterror').val() || '';
    if (!t.trim()) { toast('Ошибок пока не было'); return; }
    try { navigator.clipboard.writeText(t).then(function () { toast('Скопировано'); }, function () { $('#imagegen_lasterror').focus().select(); }); }
    catch (e) { $('#imagegen_lasterror').focus().select(); }
  });
  populateModels(); populateStyles(); renderRefs();
}

// ── slash-команды ──
function registerCommands() {
  const c = ctx(); if (!c) return;
  const genManual = async (args, value) => {
    const eng = (value || '').trim();
    if (!eng) { toast('Использование: /imagegen <english prompt>', 'warning'); return ''; }
    try { toast('Генерирую…'); const url = await generateFor(eng, []); addImageMessage(url, eng); return url; }
    catch (e) { toast('Ошибка: ' + (e.message || e), 'error'); return ''; }
  };
  const genFromLast = async () => {
    const chat = c.chat;
    for (let i = chat.length - 1; i >= 0; i--) {
      if (!chat[i].is_user && !chat[i].is_system) { processed.delete(i + ':' + (chat[i].swipe_id || 0)); await handleMessage(i); return ''; }
    }
    toast('Нет ответа бота для картинки', 'warning'); return '';
  };
  try {
    const P = c.SlashCommandParser;
    if (P && P.addCommandObject && c.SlashCommand) {
      P.addCommandObject(c.SlashCommand.fromProps({ name: 'imagegen', callback: genManual, helpString: 'Картинка по английскому промпту (своё сообщение)' }));
      P.addCommandObject(c.SlashCommand.fromProps({ name: 'imgnow', callback: genFromLast, helpString: 'Картинка по последнему ответу бота (инлайн)' }));
      return;
    }
  } catch (e) {}
  try { c.registerSlashCommand('imagegen', genManual, [], 'Картинка по промпту', true, true); } catch (e) {}
  try { c.registerSlashCommand('imgnow', genFromLast, [], 'Картинка по последнему ответу', true, true); } catch (e) {}
}

jQuery(async function () {
  const c = ctx();
  if (!c) { console.error('[ImageGen] SillyTavern.getContext недоступен'); return; }
  settings();
  try {
    $('head').append('<style>@keyframes imagegen-rot{to{transform:rotate(360deg);}}</style>');
  } catch (e) {}
  try { injectSettingsUI(); } catch (e) { console.error('[ImageGen] settings UI:', e); }
  try { registerCommands(); } catch (e) { console.error('[ImageGen] commands:', e); }
  try { c.eventSource.on(c.eventTypes.CHARACTER_MESSAGE_RENDERED, handleMessage); }
  catch (e) { console.error('[ImageGen] event subscribe:', e); }
  console.log('[ImageGen] loaded (mode:', settings().mode, ')');
});
