/*
 * ImageGen (proxy) — расширение SillyTavern.
 * Порт логики Tavo-плагина: ловит маркер [IMG]eng|rus|chars[/IMG] в ответе бота,
 * дёргает прокси генерации (тот же, что у Tavo-версии), вставляет картинку в сообщение.
 *
 * Прокси-контракт (GET): {baseUrl}?data=<DATA>&characters=<json>&prompt=<eng>&style=<style>&model=<model>&userId=<uid>
 *   -> 302 -> URL картинки (ImgBB). CORS *. При ошибке: SVG + заголовок X-ImageGen-Error (base64 {title,advice,retry})
 *   + в теле <!--IGLOG ... IGLOG--> серверный лог.
 *
 * MVP: авто-картинка по маркеру + /imagegen для ручного теста + панель настроек + отчёт о последней ошибке.
 * НЕ в MVP: редакторы одежды/фона/причёски, промпт-райтер, мульти-реф лиц (итерации позже).
 */

const NAME = 'st-imagegen';
const KEY = 'imagegen_proxy';

const DEFAULTS = {
  enabled: true,
  baseUrl: 'https://linkapi-proxy-imgbb-key-cache.vercel.app/api/generate',
  provider: 'link',
  model: 'gemini-3.1-flash-image-preview',
  style: 'y2k_cellphone',
  userId: '',
  data: '', // зашифрованный DATA-блок с сайта (шаг «зашифровать ключи»). Пусто = не сконфигурировано.
  refs: [], // [{name, url}] — референсы персонажей (правятся в панели)
  lastError: ''
};

// Прокси по провайдерам (baseUrl подставляется при смене провайдера).
const BASE_URLS = {
  link: 'https://linkapi-proxy-imgbb-key-cache.vercel.app/api/generate',
  naistera: 'https://naistera.vercel.app/api/generate',
  pollinations: 'https://pollinations-tavo.vercel.app/api/generate'
};

// Списки моделей по провайдерам (для выпадашки). Совпадают с сайтом-конструктором.
const MODELS = {
  link: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview', 'gemini-3-pro-image', 'gemini-2.5-flash-image', 'pro/gemini-3.1-flash-image-preview', 'pro/gemini-3-pro-image-preview', 'pro/gemini-2.5-flash-image', 'gpt-image-2', 'gpt-image-2-c'],
  naistera: ['flux', 'flux-realism', 'flux-anime', 'flux-3d', 'sdxl', 'sd-3.5-large'],
  pollinations: ['flux', 'zimage', 'klein', 'kontext', 'gptimage', 'gptimage-large', 'gpt-image-2', 'nova-canvas']
};

function ctx() {
  return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
}
function settings() {
  const c = ctx();
  if (!c) return { ...DEFAULTS };
  c.extensionSettings[KEY] = Object.assign({}, DEFAULTS, c.extensionSettings[KEY] || {});
  return c.extensionSettings[KEY];
}
function saveSettings() {
  const c = ctx();
  try { c.saveSettingsDebounced(); } catch (e) {}
}
function toast(msg, type) {
  try { if (typeof toastr !== 'undefined') toastr[type || 'info'](msg, 'ImageGen'); } catch (e) {}
}

// ── маркер ──
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

function norm(s) { return (s || '').trim().toLowerCase(); }

// Модель в маркере пишет ИМЕНА; ссылки подставляем из рефов панели (если в маркере нет своей).
function resolveChars(chars) {
  const refs = settings().refs || [];
  return (chars || []).map(function (c) {
    if (c.url) return c;
    const found = refs.find(function (r) { return norm(r.name) === norm(c.name); });
    return found ? { name: c.name, url: found.url } : c;
  });
}

function buildUrl(eng, chars) {
  const s = settings();
  let url = s.baseUrl
    + '?data=' + encodeURIComponent(s.data)
    + '&characters=' + encodeURIComponent(JSON.stringify(chars || []))
    + '&prompt=' + encodeURIComponent(eng)
    + '&style=' + encodeURIComponent(s.style)
    + '&model=' + encodeURIComponent(s.model)
    + '&userId=' + encodeURIComponent(s.userId);
  return url + '&_r=' + Date.now();
}

function b64dJson(b64) {
  try { return JSON.parse(decodeURIComponent(escape(atob(b64)))); } catch (e) {
    try { return JSON.parse(atob(b64)); } catch (e2) { return null; }
  }
}

function saveErrReport(kind, r, bodyText, info, exc, url) {
  const s = settings();
  const L = [];
  L.push('=== ImageGen (ST) error report ===');
  L.push('time: ' + new Date().toISOString());
  L.push('provider: ' + s.provider);
  L.push('model: ' + s.model);
  L.push('style: ' + s.style);
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

// ── генерация + вставка ──
async function generateFor(eng, chars, url) {
  // url необязателен (для ручного теста передаём готовый)
  const u = url || buildUrl(eng, chars);
  console.log('[ImageGen] GET', u);
  let r;
  try {
    r = await fetch(u);
  } catch (e) {
    // В браузере частая причина: CORS при следовании 302 на хост картинки (i.ibb.co).
    // Генерация при этом обычно УСПЕШНА — отдаём URL прокси, <img> сам пройдёт редирект.
    console.warn('[ImageGen] fetch threw (вероятно CORS на редиректе) → отдаю URL прокси напрямую:', e && e.message);
    return u;
  }
  const errHdr = r.headers.get('X-ImageGen-Error');
  if (errHdr) {
    const info = b64dJson(errHdr) || {};
    let body = ''; try { body = await r.text(); } catch (e) {}
    saveErrReport('provider_error', r, body, info, null, u);
    throw new Error(info.title || 'Ошибка генерации');
  }
  if (!r.ok) {
    let body = ''; try { body = await r.text(); } catch (e) {}
    saveErrReport('http_' + r.status, r, body, null, null, u);
    throw new Error('Запрос не удался (HTTP ' + r.status + ')');
  }
  console.log('[ImageGen] resolved image URL:', r.url);
  return r.url || u; // после 302 = финальный URL картинки (ImgBB); если пусто — URL прокси
}

function attachImage(mesId, imageUrl, title) {
  const c = ctx(); if (!c) return;
  const message = c.chat[mesId];
  if (!message) { console.warn('[ImageGen] нет сообщения с id', mesId); return; }
  if (!message.extra) message.extra = {};
  message.extra.image = imageUrl;
  message.extra.title = title || '';
  message.extra.inline_image = true;
  const el = $('#chat').find('.mes[mesid="' + mesId + '"]');
  console.log('[ImageGen] attach → mesId', mesId, '| DOM-элемент найден:', el.length, '| url:', imageUrl);
  try {
    if (typeof c.appendMediaToMessage === 'function') { c.appendMediaToMessage(message, el); console.log('[ImageGen] appendMediaToMessage вызван'); }
    else console.warn('[ImageGen] appendMediaToMessage отсутствует в getContext()');
  } catch (e) { console.error('[ImageGen] appendMediaToMessage error:', e); }
  try { c.saveChat(); } catch (e) {}
}

async function handleMessage(mesId) {
  const s = settings();
  if (!s.enabled) return;
  const c = ctx(); if (!c) return;
  const message = c.chat[mesId];
  if (!message || message.is_user || message.is_system) return;
  if (message.extra && message.extra.image) return; // уже есть картинка
  const parsed = parseMarker(message.mes || '');
  if (!parsed) return;
  if (!s.data) { toast('ImageGen: не задан DATA (настройки расширения)', 'warning'); return; }

  // убрать маркер из видимого текста (оставить русскую подпись курсивом)
  try {
    message.mes = (message.mes || '').replace(parsed.full, parsed.rus ? ('*' + parsed.rus + '*') : '').trim();
    if (typeof c.updateMessageBlock === 'function') c.updateMessageBlock(mesId, message);
  } catch (e) { /* если нет updateMessageBlock — маркер спрячет companion-регекс, см. README */ }

  try {
    toast('Генерирую картинку…');
    const imgUrl = await generateFor(parsed.eng, resolveChars(parsed.chars));
    attachImage(mesId, imgUrl, parsed.rus || parsed.eng);
  } catch (e) {
    toast('Ошибка: ' + (e && e.message ? e.message : e) + ' — см. отчёт в настройках', 'error');
  }
}

// ── UI настроек ──
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function populateModels() {
  const s = settings();
  const list = MODELS[s.provider] || MODELS.link;
  const sel = $('#imagegen_model');
  sel.empty();
  list.forEach(function (m) { sel.append('<option value="' + esc(m) + '">' + esc(m) + '</option>'); });
  if (list.indexOf(s.model) < 0) { s.model = list[0]; saveSettings(); }
  sel.val(s.model);
}

function renderRefs() {
  const s = settings();
  const box = $('#imagegen_refs');
  box.empty();
  (s.refs || []).forEach(function (r, i) {
    const row = $('<div class="imagegen-ref-row" style="display:flex;gap:4px;margin-bottom:4px;align-items:center;"></div>');
    const nm = $('<input class="text_pole" type="text" placeholder="имя" style="flex:0 0 30%;">').val(r.name);
    const url = $('<input class="text_pole" type="text" placeholder="ссылка на фото (i.ibb.co/...)" style="flex:1;">').val(r.url);
    const del = $('<div class="menu_button" title="удалить" style="flex:0 0 auto;">✕</div>');
    nm.on('input', function () { settings().refs[i].name = $(this).val(); saveSettings(); });
    url.on('input', function () { settings().refs[i].url = $(this).val(); saveSettings(); });
    del.on('click', function () { settings().refs.splice(i, 1); saveSettings(); renderRefs(); });
    row.append(nm).append(url).append(del);
    box.append(row);
  });
  if (!(s.refs || []).length) box.append('<div class="imagegen-hint" style="opacity:.6;font-size:.9em;">Пока нет персонажей. Добавь имя + ссылку на фото.</div>');
}

function injectSettingsUI() {
  const s = settings();
  const html = `
  <div class="imagegen-settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>ImageGen (proxy)</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <label class="checkbox_label"><input id="imagegen_enabled" type="checkbox"> Включено</label>
        <label>Провайдер</label>
        <select id="imagegen_provider" class="text_pole">
          <option value="link">link (LinkAPI)</option>
          <option value="naistera">naistera</option>
          <option value="pollinations">pollinations</option>
        </select>
        <label>Модель</label>
        <select id="imagegen_model" class="text_pole"></select>
        <label>Стиль</label>
        <input id="imagegen_style" class="text_pole" type="text">
        <label>userId (для кэша)</label>
        <input id="imagegen_userid" class="text_pole" type="text">
        <label>DATA (зашифрованные ключи — шаг «зашифровать» на сайте)</label>
        <textarea id="imagegen_data" class="text_pole" rows="2" placeholder="IV==:ENC..."></textarea>
        <hr>
        <label><b>Персонажи (рефы)</b> — модель пишет имена, ссылки подставятся сами</label>
        <div id="imagegen_refs"></div>
        <div class="menu_button" id="imagegen_addref" style="margin-top:4px;">+ добавить персонажа</div>
        <hr>
        <label>Прокси (baseUrl)</label>
        <input id="imagegen_baseurl" class="text_pole" type="text">
        <hr>
        <label>Отчёт о последней ошибке</label>
        <textarea id="imagegen_lasterror" class="text_pole" rows="6" readonly></textarea>
        <div class="menu_button" id="imagegen_copyerr">Скопировать отчёт</div>
      </div>
    </div>
  </div>`;
  $('#extensions_settings2').append(html);

  $('#imagegen_enabled').prop('checked', s.enabled).on('input', function () { settings().enabled = $(this).prop('checked'); saveSettings(); });
  $('#imagegen_baseurl').val(s.baseUrl).on('input', function () { settings().baseUrl = $(this).val(); saveSettings(); });
  $('#imagegen_provider').val(s.provider).on('change', function () {
    const p = $(this).val();
    settings().provider = p;
    if (BASE_URLS[p]) { settings().baseUrl = BASE_URLS[p]; $('#imagegen_baseurl').val(BASE_URLS[p]); }
    saveSettings(); populateModels();
  });
  $('#imagegen_model').on('change', function () { settings().model = $(this).val(); saveSettings(); });
  $('#imagegen_style').val(s.style).on('input', function () { settings().style = $(this).val(); saveSettings(); });
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
  populateModels();
  renderRefs();
}

// ── slash-команда для ручного теста ──
function registerCommands() {
  const c = ctx(); if (!c) return;
  const fn = async (args, value) => {
    const eng = (value || '').trim();
    if (!eng) { toast('Использование: /imagegen <english prompt>', 'warning'); return ''; }
    try {
      toast('Генерирую…');
      const imgUrl = await generateFor(eng, []);
      const mesId = c.chat.length - 1;
      if (mesId >= 0) attachImage(mesId, imgUrl, eng);
      return imgUrl;
    } catch (e) { toast('Ошибка: ' + (e && e.message ? e.message : e), 'error'); return ''; }
  };
  try {
    // современный API
    const P = c.SlashCommandParser;
    if (P && P.addCommandObject && c.SlashCommand) {
      P.addCommandObject(c.SlashCommand.fromProps({
        name: 'imagegen',
        callback: fn,
        helpString: 'Сгенерировать картинку по английскому промпту через ImageGen-прокси',
        returns: 'url картинки'
      }));
      return;
    }
  } catch (e) {}
  try { c.registerSlashCommand('imagegen', fn, [], 'Сгенерировать картинку через ImageGen-прокси', true, true); } catch (e) {}
}

// ── init ──
jQuery(async function () {
  const c = ctx();
  if (!c) { console.error('[ImageGen] SillyTavern.getContext недоступен'); return; }
  settings(); // init defaults
  try { injectSettingsUI(); } catch (e) { console.error('[ImageGen] settings UI:', e); }
  try { registerCommands(); } catch (e) { console.error('[ImageGen] commands:', e); }
  try {
    // CHARACTER_MESSAGE_RENDERED — текст финализирован и DOM-элемент существует (нужен для appendMediaToMessage).
    c.eventSource.on(c.eventTypes.CHARACTER_MESSAGE_RENDERED, handleMessage);
  } catch (e) { console.error('[ImageGen] event subscribe:', e); }
  console.log('[ImageGen] loaded');
});
