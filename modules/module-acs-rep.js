// ==UserScript==
// @name         EASYTRAC ACS Repetir
// @namespace    easytrac.module.acsrep
// @version      1.7.0
// @description  Módulo ACS Repetir Compras — repetición automática + traspasos + presets
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ---- CSS ---- */
  var css = `
    #et-acsrep-pill {
      position:fixed;left:12px;z-index:2147483647;
      background:#6f6f6f;color:#fff;padding:9px 14px;border-radius:22px;
      font:bold 12px roboto,Arial,sans-serif;cursor:pointer;
      box-shadow:0 3px 10px rgba(0,0,0,.4);user-select:none;letter-spacing:.4px;
    }
    #et-acsrep-hist {
      position:fixed;left:12px;z-index:2147483647;
      background:#2EA836;color:#fff;padding:9px 14px;border-radius:22px;
      font:bold 12px roboto,Arial,sans-serif;cursor:pointer;
      box-shadow:0 3px 10px rgba(0,0,0,.4);user-select:none;
    }
    #et-acsrep-preset-btn {
      position:fixed;left:12px;z-index:2147483647;
      background:#1d3557;color:#fff;padding:9px 14px;border-radius:22px;
      font:bold 12px roboto,Arial,sans-serif;cursor:pointer;
      box-shadow:0 3px 10px rgba(0,0,0,.4);user-select:none;
    }
    #et-acsrep-preset-panel {
      display:none;position:fixed;left:12px;bottom:122px;z-index:2147483647;
      width:230px;background:#fff;color:#222;border-radius:8px;
      box-shadow:0 5px 20px rgba(0,0,0,.4);overflow:hidden;font-family:roboto,Arial,sans-serif;
    }
    #et-acsrep-burbuja {
      position:fixed;right:16px;bottom:64px;z-index:2147483647;
      background:#fff;border:2px solid #2EA836;border-radius:8px;padding:12px 16px;
      box-shadow:0 4px 18px rgba(0,0,0,.35);font-family:roboto,Arial,sans-serif;
    }
    .et-rep-fecha { background:#555;color:#fff;font-size:11px;font-weight:bold;padding:5px 8px;margin-top:10px;text-transform:capitalize; }
    .et-rep-table { width:100%;border-collapse:collapse;font-size:13px;background:#fff; }
    .et-rep-table th { background:#6f6f6f;color:#fff;padding:5px 8px;text-align:left; }
    .et-rep-table td { border:1px solid #ddd;padding:5px 8px; }
    .et-rep-vacio { text-align:center;color:#888;padding:16px;font-size:13px; }
  `;

  /* ---- Constantes ---- */
  var VERBOSE = true, MAX_RUNS = 30, ARMED_TTL = 10 * 60 * 1000, PENDING_TTL = 90 * 1000;
  var K_ENABLED = 'acsrep_enabled', K_PARAMS = 'acsrep_params', K_REGDATA = 'acsrep_regdata',
      K_PRESETS = 'acsrep_presets', K_PRESET = 'acsrep_preset_activo';
  var S_ARMED = 'acsrep_armed', S_REPEAT = 'acsrep_repeat', S_PENDING = 'acsrep_pending',
      S_CHAIN = 'acsrep_chain', S_RUNS = 'acsrep_runs', S_TRASPASOS = 'acsrep_traspasos',
      S_OK = 'acsrep_ok', S_FAIL = 'acsrep_fail';
  var URL_TIPO = '/GasLP/Compras/NuevoRegistro_SeleccionaTipoSuministrador',
      URL_SUM = '/GasLP/Compras/NuevoRegistro_SeleccionaSuministrador',
      URL_DATOS = '/GasLP/Compras/NuevoRegistro_IngresaDatos',
      URL_GUARDA = '/GasLP/Compras/GuardaCompraGasLP';

  var pageWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  var ultimoRegistrado = '', traspasoLoopActivo = false;
  var _destroyed = false, _iniciado = false;

  /* ---- Helpers ---- */
  function log(tag, d) {
    if (!VERBOSE) return;
    try { console.log('[REPETIR][' + tag + '] ' + JSON.stringify(d)); }
    catch (e) { console.log('[REPETIR][' + tag + ']', d); }
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function diaHoy() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function horaAhora() { var d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  var RE_FECHA = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),\s*(\d{1,2})\s+de\s+([a-záéíóúñü]+)\s+de\s+(\d{4})$/i;
  var MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

  function fechaDe(t) {
    var m = RE_FECHA.exec(t || ''); if (!m) return null;
    var mes = MESES[(m[3] || '').toLowerCase()]; if (!mes) return null;
    return ('0' + m[2]).slice(-2) + '/' + ('0' + mes).slice(-2) + '/' + m[4];
  }

  function cells(l) { return l.split('\t').map(function (c) { return c.trim(); }); }
  function esNumero(c) { if (!c) return false; return /^-?\d+(\.\d+)?$/.test(c.replace(/[$,\s]/g, '')); }
  function aNumero(c) { var v = parseFloat(c.replace(/[$,\s]/g, '')); return isNaN(v) ? 0 : v; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function fechaLarga(iso) {
    try {
      var p = String(iso).split('-'); if (p.length !== 3) return String(iso);
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      return DIAS_SEMANA[d.getDay()] + ' ' + pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + p[0];
    } catch (e) { return String(iso); }
  }

  var DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  var MAX_HISTORIAL = 500;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ===== POPUP HISTORIAL ===== */
  var winRef = null;

  function cargarRegistros() {
    try {
      var raw = JSON.parse(localStorage.getItem(K_REGDATA) || '{}');
      if (!raw || !Array.isArray(raw.lista)) return [];
      if (raw.v === 2) return raw.lista;
      return raw.lista.map(function (x) { return { n: x.n, f: raw.dia || diaHoy(), h: x.t || '' }; });
    } catch (e) { return []; }
  }

  function guardarRegistros(lista) { localStorage.setItem(K_REGDATA, JSON.stringify({ v: 2, lista: lista })); }

  function htmlPopup(lista) {
    var grupos = [], indice = {};
    lista.forEach(function (r) { var f = r.f || ''; if (!indice[f]) { indice[f] = []; grupos.push(f); } indice[f].push(r); });
    var secciones = '';
    grupos.forEach(function (f) {
      var filas = '';
      indice[f].forEach(function (r) { filas += '<tr><td>' + esc(r.n) + '</td><td style="text-align:center">' + esc(r.h || '') + '</td></tr>'; });
      secciones += '<div class="et-rep-fecha">' + esc(f ? fechaLarga(f) : 'Sin fecha') + ' · ' + indice[f].length + ' compra' + (indice[f].length > 1 ? 's' : '') + '</div>' +
        '<table class="et-rep-table"><thead><tr><th>Número de registro</th><th style="width:70px">Hora</th></tr></thead><tbody>' + filas + '</tbody></table>';
    });
    if (!secciones) secciones = '<div class="et-rep-vacio">Sin registros aún</div>';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Historial ET</title><style>' +
      'body{font-family:roboto,Arial,sans-serif;margin:0;background:#f1f1f1;color:#000}' +
      '#head{background:#6f6f6f;color:#fff;padding:9px 14px;font-weight:bold;font-size:14px}' +
      '#zona{background:#fff;border-bottom:3px solid #2EA836;padding:16px 14px;text-align:center}' +
      '#lbl{font-size:11px;color:#555;font-weight:bold;letter-spacing:.5px}' +
      '#ult{font-size:26px;font-weight:bold;color:#1b5e20;letter-spacing:1px;margin:8px 0 12px;user-select:text}' +
      'button{border:none;border-bottom:4px solid rgba(0,0,0,.25);color:#fff;font-weight:bold;font-size:13px;padding:8px 16px;cursor:pointer;border-radius:3px;margin:0 4px}' +
      '#copiar{background:#2EA836}#limpiar{background:#C60C0E}' +
      '#lista{padding:4px 10px 12px;overflow:auto;max-height:300px}' +
      '.et-rep-fecha{background:#555;color:#fff;font-size:11px;font-weight:bold;padding:5px 8px;margin-top:10px;text-transform:capitalize}' +
      'table{width:100%;border-collapse:collapse;font-size:13px;background:#fff}' +
      'th{background:#6f6f6f;color:#fff;padding:5px 8px;text-align:left}' +
      'td{border:1px solid #ddd;padding:5px 8px}' +
      '.et-rep-vacio{text-align:center;color:#888;padding:16px;font-size:13px}</style></head><body>' +
      '<div id="head">HISTORIAL DE COMPRAS REGISTRADAS</div>' +
      '<div id="zona"><div id="lbl">ÚLTIMO NÚMERO DE REGISTRO</div>' +
      '<div id="ult">' + esc(lista.length ? lista[0].n : '—') + '</div>' +
      '<button id="et-pop-copiar">Copiar número</button><button id="et-pop-limpiar">Limpiar historial</button></div>' +
      '<div id="lista">' + secciones + '</div></body></html>';
  }

  function abrirPopup(lista) {
    try {
      winRef = window.open('', 'ACS_REGISTROS', 'width=440,height=420');
      if (!winRef) { mostrarBurbuja(lista.length ? lista[0].n : ''); return false; }
      var d = winRef.document;
      d.open(); d.write(htmlPopup(lista)); d.close();
      try { winRef.focus(); } catch (e) {}
      var btnCopiar = d.getElementById('et-pop-copiar'), btnLimpiar = d.getElementById('et-pop-limpiar');
      if (btnCopiar) btnCopiar.addEventListener('click', function () {
        var n = d.getElementById('ult'), rango = d.createRange(), sel = d.defaultView.getSelection();
        rango.selectNodeContents(n); sel.removeAllRanges(); sel.addRange(rango);
        d.execCommand('copy'); sel.removeAllRanges();
        btnCopiar.textContent = '¡Copiado!'; setTimeout(function () { btnCopiar.textContent = 'Copiar número'; }, 1500);
      });
      if (btnLimpiar) btnLimpiar.addEventListener('click', function () { guardarRegistros([]); abrirPopup(cargarRegistros()); });
      return true;
    } catch (e) {
      log('POPUP ERROR', { error: e.message });
      mostrarBurbuja(lista.length ? lista[0].n : '');
      return false;
    }
  }

  function registrarNumero(num) {
    var lista = cargarRegistros();
    if (lista.some(function (x) { return x.n === num; })) { log('DUPLICADO', { num: num }); return; }
    lista.unshift({ n: num, f: diaHoy(), h: horaAhora() });
    if (lista.length > MAX_HISTORIAL) lista.length = MAX_HISTORIAL;
    guardarRegistros(lista);
    log('REGISTRO DETECTADO', { num: num, total: lista.length });
    if (!sessionStorage.getItem(S_TRASPASOS)) abrirPopup(lista);
  }

  function mostrarBurbuja(num) {
    var vieja = document.getElementById('et-acsrep-burbuja');
    if (vieja) vieja.remove();
    var b = document.createElement('div');
    b.id = 'et-acsrep-burbuja';
    b.innerHTML = '<div style="font-size:11px;font-weight:bold;color:#555">COMPRA REGISTRADA (popup bloqueado)</div>' +
      '<div style="font-size:20px;font-weight:bold;color:#1b5e20;margin-top:4px">' + esc(num) + '</div>';
    b.style.cssText = 'position:fixed;right:16px;bottom:64px;z-index:2147483647;background:#fff;border:2px solid #2EA836;border-radius:8px;padding:12px 16px;box-shadow:0 4px 18px rgba(0,0,0,.35);font-family:roboto,Arial,sans-serif;';
    var x = document.createElement('button');
    x.textContent = 'Cerrar';
    x.style.cssText = 'margin-top:8px;background:#6f6f6f;border:none;color:#fff;font-weight:bold;padding:4px 10px;border-radius:3px;cursor:pointer;display:block;width:100%';
    x.addEventListener('click', function () { b.remove(); });
    b.appendChild(x); document.body.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.remove(); }, 30000);
  }

  var RE_NUMERO = /N[uú]mero de registro de compra\s*:?\s*(LP\/\d+\/\d+\/\d+)/i;
  function escanearNumero() {
    try {
      var txt = document.body ? (document.body.innerText || '') : '';
      var m = RE_NUMERO.exec(txt);
      if (m) { registrarNumero(m[1]); return; }
      var m2 = /[?&]codigo=((?:LP|CNE%2FLP)(?:%2F|\/)\d+(?:%2F|\/)\d+(?:%2F|\/)\d+)/i.exec(location.href);
      if (m2) registrarNumero(decodeURIComponent(m2[1]));
    } catch (e) {}
  }

  function iniciarObservador() {
    var timer = null;
    try {
      var obs = new MutationObserver(function () {
        if (timer) return;
        timer = setTimeout(function () { timer = null; escanearNumero(); }, 400);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    setTimeout(escanearNumero, 600); setTimeout(escanearNumero, 1800);
  }

  /* ===== PILL ===== */
  function habilitado() { return localStorage.getItem(K_ENABLED) !== '0'; }

  function pintarPill() {
    var pill = document.getElementById('et-acsrep-pill');
    if (!pill) return;
    var on = habilitado();
    pill.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:7px;vertical-align:middle;background:' + (on ? '#2EA836' : '#C60C0E') + '"></span>REPETIR COMPRA ' + (on ? 'ON' : 'OFF') +
      '<span style="opacity:.75;font-weight:normal;margin-left:6px">' + (sessionStorage.getItem(S_RUNS) || 0) + '/' + MAX_RUNS + '</span>';
  }

  function estPillCss(bg) {
    return 'position:fixed;left:12px;z-index:2147483647;background:' + bg + ';color:#fff;padding:9px 14px;border-radius:22px;' +
      'font:bold 12px roboto,Arial,sans-serif;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.4);user-select:none;letter-spacing:.4px;';
  }

  /* ===== PRESETS ===== */
  function cargarPresets() { try { return JSON.parse(localStorage.getItem(K_PRESETS) || '[]') || []; } catch (e) { return []; } }
  function guardarPresets(lista) { localStorage.setItem(K_PRESETS, JSON.stringify(lista)); }
  function presetEnUso() { return localStorage.getItem(K_PRESET) || ''; }
  function guardarPresetEnUso(n) { localStorage.setItem(K_PRESET, n || ''); }
  function presetNombreSugerido(p) { return p.SC_Nombre || ('Planta SC ' + (p.SC_Id || '?')); }

  function listaPresetsPanel() {
    var sel = document.getElementById('et-acsrep-preset-sel');
    if (!sel) return;
    sel.innerHTML = '<option value="">— selecciona preset —</option>' + cargarPresets().map(function (pr) {
      return '<option value="' + esc(pr.nombre) + '">' + esc(pr.nombre) + '</option>';
    }).join('');
    var activo = presetEnUso();
    if (activo) sel.value = activo;
  }

  function guardarPresetActual() {
    var p = cargarParams();
    if (!p || (p.SC_Id === undefined && p.TipoSuministradorId === undefined)) {
      mostrarBurbuja('Aún no hay datos capturados.\nRegistra o captura una compra una vez y vuelve a presionar Guardar preset.');
      return;
    }
    var nombre = window.prompt('Nombre del preset (planta/distribuidor para tus estaciones):', presetNombreSugerido(p));
    if (!nombre) return;
    nombre = String(nombre).trim(); if (!nombre) return;
    var lista = cargarPresets(), idx = -1;
    for (var i = 0; i < lista.length; i++) if (lista[i].nombre === nombre) { idx = i; break; }
    if (idx === -1) lista.push({ nombre: nombre, params: p }); else lista[idx].params = p;
    guardarPresets(lista); guardarPresetEnUso(nombre);
    listaPresetsPanel();
    avisoVerde('Preset guardado: ' + nombre);
    log('PRESET GUARDADO', { nombre: nombre, params: p });
  }

  function abrirRegistro(p) {
    if (p.SC_Id !== undefined) {
      enviarForm(URL_DATOS, {
        TipoSuministradorId: p.TipoSuministradorId !== undefined ? p.TipoSuministradorId : '19',
        NombreTipoSuministrador: p.NombreTipoSuministrador || 'Distribuidor por Planta de Distribucion',
        SC_Id: p.SC_Id
      });
      return;
    }
    location.href = URL_TIPO;
  }

  function aplicarPreset(nombre) {
    if (!nombre) return;
    var pr = null;
    cargarPresets().forEach(function (x) { if (x.nombre === nombre) pr = x; });
    if (!pr) return;
    var p = pr.params || {};
    guardarPresetEnUso(nombre);
    guardarParams(p);
    pintarPill();
    avisoVerde('Preset «' + nombre + '» aplicado — abriendo el registro de compra');
    log('PRESET APLICADO', { nombre: nombre, params: p });
    setTimeout(function () { abrirRegistro(p); }, 250);
  }

  function eliminarPreset(nombre) {
    if (!nombre) return;
    guardarPresets(cargarPresets().filter(function (x) { return x.nombre !== nombre; }));
    if (presetEnUso() === nombre) guardarPresetEnUso('');
    listaPresetsPanel();
    avisoVerde('Preset eliminado: ' + nombre);
  }

  function iniciarPaneles() {
    var pbtn = document.createElement('div');
    pbtn.id = 'et-acsrep-preset-btn';
    pbtn.title = 'Presets de planta/tipo suministrador reutilizables en cualquier estación.\nGuardar: captura la planta del registro activo.\nAplicar: abre el registro directo con esa planta.';
    pbtn.textContent = 'PRESET' + (presetEnUso() ? ' ✓' : '');
    pbtn.style.cssText = estPillCss('#1d3557') + 'bottom:88px;';
    pbtn.addEventListener('click', function () {
      var pan = document.getElementById('et-acsrep-preset-panel');
      if (!pan) return;
      var visible = pan.style.display !== 'none';
      pan.style.display = visible ? 'none' : 'block';
      if (!visible) listaPresetsPanel();
    });
    document.body.appendChild(pbtn);

    var pan = document.createElement('div');
    pan.id = 'et-acsrep-preset-panel';
    pan.style.cssText = 'display:none;position:fixed;left:12px;bottom:122px;z-index:2147483647;width:230px;background:#fff;color:#222;' +
      'border-radius:8px;box-shadow:0 5px 20px rgba(0,0,0,.4);overflow:hidden;font-family:roboto,Arial,sans-serif;';
    pan.innerHTML =
      '<div style="background:#1d3557;color:#fff;font-weight:bold;font-size:12px;padding:8px 10px">PRESETS · planta / tipo</div>' +
      '<div style="padding:10px">' +
      '<select id="et-acsrep-preset-sel" style="width:100%;padding:5px;font-size:12px;border:1px solid #bbb;border-radius:3px"></select>' +
      '<div style="display:flex;gap:6px;margin-top:8px">' +
      '<button data-ac="aplicar" style="flex:1;background:#2EA836">Aplicar</button>' +
      '<button data-ac="guardar" style="flex:1;background:#ff9800">Guardar</button>' +
      '<button data-ac="eliminar" style="flex:1;background:#C60C0E">Eliminar</button>' +
      '</div>' +
      '<div style="margin-top:9px;font-size:11px;color:#555;line-height:1.4">' +
      'Guardar captura la planta del registro activo. Aplicar abre IngresaDatos con esa planta para cualquier estación.</div>' +
      '</div>';
    pan.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[data-ac]') : null;
      if (!b) return;
      var sel = document.getElementById('et-acsrep-preset-sel');
      var nombre = sel ? sel.value : '';
      var ac = b.getAttribute('data-ac');
      if (ac === 'guardar') guardarPresetActual();
      else if (ac === 'aplicar') aplicarPreset(nombre);
      else if (ac === 'eliminar') eliminarPreset(nombre);
    });
    document.body.appendChild(pan);
    listaPresetsPanel();
  }

  function iniciarPill() {
    var pill = document.createElement('div');
    pill.id = 'et-acsrep-pill';
    pill.title = 'Activa/desactiva la repetición automática del flujo de registro de compras.\nON: tras guardar una compra se reabre el formulario IngresaDatos.\nPegado de traspasos: en Compras, pega la plantilla semanal (ENTRADA POR TRASPASO KILOS).';
    pill.style.cssText = estPillCss('#6f6f6f') + 'bottom:12px;';
    pill.addEventListener('click', function () {
      var nuevo = habilitado() ? '0' : '1';
      localStorage.setItem(K_ENABLED, nuevo);
      sessionStorage.removeItem(S_CHAIN); sessionStorage.removeItem(S_ARMED); sessionStorage.removeItem(S_PENDING);
      sessionStorage.setItem(S_RUNS, '0');
      pintarPill();
      log('TOGGLE', { enabled: nuevo === '1' });
    });
    document.body.appendChild(pill);
    pintarPill();

    var hist = document.createElement('div');
    hist.id = 'et-acsrep-hist';
    hist.title = 'Abrir el historial de números de registro de compra (agrupado por fecha)';
    hist.textContent = 'HISTORIAL';
    hist.style.cssText = estPillCss('#2EA836') + 'bottom:50px;';
    hist.addEventListener('click', function () {
      var lista = cargarRegistros();
      if (!lista.length) { mostrarBurbuja('Aún no hay registros guardados'); return; }
      abrirPopup(lista);
    });
    document.body.appendChild(hist);

    iniciarPaneles();
  }

  /* ===== PARÁMETROS ===== */
  function cargarParams() { try { return JSON.parse(localStorage.getItem(K_PARAMS) || '{}') || {}; } catch (e) { return {}; } }
  function guardarParams(p) { localStorage.setItem(K_PARAMS, JSON.stringify(p)); }

  function capturarTipoDePaginaSuministrador() {
    try {
      var html = document.documentElement.innerHTML;
      var mI = /var\s+idTipoSuministrador\s*=\s*["'](\d+)["']/.exec(html);
      var mN = /var\s+NombreTipoSuministrador\s*=\s*["']([^"']+)["']/.exec(html);
      if (!mI && !mN) return;
      var p = cargarParams(), cambio = false;
      if (mI && p.TipoSuministradorId !== mI[1]) { p.TipoSuministradorId = mI[1]; cambio = true; }
      if (mN && p.NombreTipoSuministrador !== mN[1].trim()) { p.NombreTipoSuministrador = mN[1].trim(); cambio = true; }
      if (cambio) { guardarParams(p); log('PARAMS AUTO (página suministrador)', p); }
    } catch (e) {}
  }

  function capturarSCDePaginaDatos() {
    try {
      var html = document.documentElement.innerHTML;
      var m1 = /idVendedor\s*:\s*["']?(\d+)["']?/.exec(html);
      var m2 = /idComprador\s*:\s*["']?(\d+)["']?/.exec(html);
      var mn = /NombreComprador\s*[:=]\s*["']([^"']+)["']/.exec(html) || /razonSocial\s*[:=]\s*["']([^"']+)["']/.exec(html);
      if (!m1 && !m2) return;
      var p = cargarParams(), cambio = false;
      if (m1 && p.SC_Id !== m1[1]) { p.SC_Id = m1[1]; cambio = true; }
      if (m2 && p.idComprador !== m2[1]) { p.idComprador = m2[1]; cambio = true; }
      if (mn && p.NombreComprador !== mn[1].replace(/\s+/g, ' ').trim()) { p.NombreComprador = mn[1].replace(/\s+/g, ' ').trim(); cambio = true; }
      if (cambio) { guardarParams(p); log('PARAMS AUTO (página datos)', p); }
    } catch (e) {}
  }

  function instalarCapturaTipo() {
    var btn = document.getElementById('idbtonAceptar'), sel = document.getElementById('idRC_cmbTipoSuministrador');
    if (!btn || !sel) return;
    btn.addEventListener('click', function () {
      try {
        var v = sel.value, opt = sel.options[sel.selectedIndex];
        if (v && v !== '-1' && opt) {
          var p = cargarParams();
          p.TipoSuministradorId = String(v);
          p.NombreTipoSuministrador = String(opt.text).trim();
          guardarParams(p);
          log('PARAMS TIPO CAPTURADOS', { id: p.TipoSuministradorId, nombre: p.NombreTipoSuministrador });
        }
      } catch (e) {}
    }, true);
  }

  function instalarCapturaSuministrador() {
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest ? ev.target.closest('a') : null;
      if (!a) return;
      var oc = a.getAttribute('onclick') || '';
      var m = /ShowIngresaDatosCompra\((\d+)\)/.exec(oc);
      if (m) {
        var p = cargarParams(), cambio = false;
        if (p.SC_Id !== m[1]) { p.SC_Id = m[1]; cambio = true; }
        var nombreSC = String(a.textContent || '').replace(/\s+/g, ' ').trim();
        if (nombreSC && p.SC_Nombre !== nombreSC) { p.SC_Nombre = nombreSC; cambio = true; }
        if (cambio) { guardarParams(p); log('PARAMS SC CAPTURADOS', { SC_Id: p.SC_Id, SC_Nombre: p.SC_Nombre }); }
      }
    }, true);
  }

  /* ===== ENVÍO DE PASOS ===== */
  function rellenarForm(f, params) {
    Object.keys(params).forEach(function (k) {
      var v = String(params[k]);
      var els = f.querySelectorAll('[name="' + k + '"]');
      if (els.length > 1) {
        for (var i = 0; i < els.length; i++) if (String(els[i].value) === v) els[i].checked = true;
      } else if (els.length === 1) {
        els[0].value = v;
      } else {
        var inp = document.createElement('input');
        inp.type = 'hidden'; inp.name = k; inp.value = v;
        f.appendChild(inp);
      }
    });
  }

  function enviarForm(actionPath, params) {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      if ((f.getAttribute('action') || '').indexOf(actionPath) !== -1) {
        rellenarForm(f, params);
        log('SUBMIT FORM REAL', { action: actionPath, params: params });
        if (f.requestSubmit) f.requestSubmit(); else f.submit();
        return;
      }
    }
    f = document.createElement('form');
    f.method = 'POST'; f.action = actionPath;
    Object.keys(params).forEach(function (k) {
      var inp = document.createElement('input');
      inp.type = 'hidden'; inp.name = k; inp.value = String(params[k]);
      f.appendChild(inp);
    });
    var tok = document.querySelector('input[name="__RequestVerificationToken"]');
    if (tok) {
      var clon = document.createElement('input');
      clon.type = 'hidden'; clon.name = '__RequestVerificationToken'; clon.value = tok.value;
      f.appendChild(clon);
    }
    document.body.appendChild(f);
    log('SUBMIT FORM SINTETICO', { action: actionPath, params: params });
    f.submit();
  }

  /* ===== DETECCIÓN DEL GUARDADO ===== */
  function procesaRespuestaGuarda(txt) {
    var j = null;
    try { j = JSON.parse(txt); } catch (e) {}
    sessionStorage.removeItem(S_OK); sessionStorage.removeItem(S_FAIL);
    if (!j) { sessionStorage.removeItem(S_PENDING); return; }
    if (j.mensaje === 'SC' || j.message === 'SC') { sessionStorage.removeItem(S_PENDING); sessionStorage.setItem(S_FAIL, 'SC'); return; }
    if (j.result === true || j.success === true || j.result === 'true' || j.success === 'true') {
      sessionStorage.setItem(S_OK, String(Date.now()));
      armar();
      var msg = String(j.mensaje || '');
      if (/^[A-Za-z]+\//.test(msg)) { ultimoRegistrado = msg; registrarNumero(msg); }
    } else {
      sessionStorage.removeItem(S_PENDING);
      sessionStorage.setItem(S_FAIL, String(j.mensaje || ''));
      log('GUARDA FALLO', { texto: String(txt).slice(0, 200) });
    }
  }

  function armar() {
    instalarInterceptaNavegacion();
    sessionStorage.setItem(S_ARMED, String(Date.now()));
    sessionStorage.setItem(S_REPEAT, '1');
    sessionStorage.removeItem(S_PENDING);
    log('ARMADO · modo repetir activo', {});
  }

  function avisoVerde(txt) {
    var viejo = document.getElementById('et-acsrep-aviso');
    if (viejo) viejo.remove();
    var d = document.createElement('div');
    d.id = 'et-acsrep-aviso';
    d.textContent = txt;
    d.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#2EA836;color:#fff;font:bold 13px roboto,Arial,sans-serif;padding:10px 18px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.35);';
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.remove(); }, 6000);
  }

  function avisoTraspaso(msgs) {
    var viejo = document.getElementById('et-acsrep-traspaso-toast');
    if (viejo) viejo.remove();
    var d = document.createElement('div');
    d.id = 'et-acsrep-traspaso-toast';
    d.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#1d3557;color:#fff;font:bold 12px roboto,Arial,sans-serif;padding:10px 14px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.35);max-width:360px;';
    msgs.forEach(function (m) { var p = document.createElement('div'); p.textContent = m; d.appendChild(p); });
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.remove(); }, 8000);
  }

  function reiniciarFormulario() {
    try {
      document.querySelectorAll('.elemento').forEach(function (el) { el.disabled = false; });
      ['idFechaCompra', 'idVolumenComprado2', 'idPrecioAcordado'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.value = '';
      });
      var epN = document.getElementById('idEntParcialesNo'), epS = document.getElementById('idEntParcialesSi');
      if (epN) epN.checked = true;
      if (epS) epS.checked = false;
      var hd = document.getElementById('hdMsgErrorFecha'); if (hd) hd.value = '';
      var frm = document.getElementById('frmDatosCompra');
      if (frm) {
        frm.querySelectorAll('label.error').forEach(function (l) { l.remove(); });
        frm.querySelectorAll('.has-error,.has-success').forEach(function (el) { el.classList.remove('has-error', 'has-success'); });
        frm.querySelectorAll('span.form-control-feedback').forEach(function (s) { s.remove(); });
        frm.querySelectorAll('em.help-block').forEach(function (e2) { e2.remove(); });
      }
      var sg = document.getElementById('ShowbtonGuardar');
      if (sg) sg.style.display = 'none';
      var scf = document.getElementById('ShowbtonConfirmar');
      if (scf) scf.style.display = '';
      var scc = document.getElementById('ShowbtonCancelar');
      if (scc) scc.style.display = 'none';
      var fc = document.getElementById('idFechaCompra');
      setTimeout(function () { if (fc) fc.focus(); }, 80);
      log('FORM REINICIADO EN SITIO', {});
    } catch (e) { log('RESET ERROR', { error: e.message }); }
  }

  function instalarInterceptaNavegacion() {
    try {
      if (!pageWin || typeof pageWin.SendMethodPost !== 'function' || pageWin.__acsrepWrapped) return;
      var original = pageWin.SendMethodPost;
      pageWin.__acsrepWrapped = true;
      pageWin.SendMethodPost = function (url) {
        try {
          if (sessionStorage.getItem(S_REPEAT) === '1' && habilitado() && /PaginaConfirmacion/i.test(String(url))) {
            log('REDIRECT BLOQUEADO · abriendo la siguiente captura', { url: String(url) });
            continuarSiguienteCompra();
            return;
          }
        } catch (e) {}
        return original.apply(this, arguments);
      };
      log('SENDMETHODPOST INTERCEPTADO', {});
    } catch (e) { log('WRAP ERROR', { error: e.message }); }
  }

  function instalarParchesRed() {
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : ((input && input.url) || '');
        var metodo = ((init && init.method) || (input && input.method) || 'GET');
        var promesa = origFetch.apply(this, arguments);
        if (String(metodo).toUpperCase() === 'POST' && url.indexOf(URL_GUARDA) !== -1) {
          promesa.then(function (r) {
            try { r.clone().text().then(function (t) { procesaRespuestaGuarda(t); }).catch(function () {}); } catch (e) {}
          }).catch(function () {});
        }
        return promesa;
      };
    }
    try {
      var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (metodo, url) {
        this.__acsrep = { metodo: metodo, url: url };
        return XO.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        var self = this, info = this.__acsrep || {};
        if (String(info.metodo || '').toUpperCase() === 'POST' && String(info.url || '').indexOf(URL_GUARDA) !== -1) {
          this.addEventListener('load', function () {
            try { procesaRespuestaGuarda(self.responseText); } catch (e) {}
          });
        }
        return XS.apply(this, arguments);
      };
    } catch (e) { log('XHR PATCH ERROR', { error: e.message }); }
  }

  function instalarClickGuardar() {
    document.addEventListener('click', function (ev) {
      if (location.pathname.indexOf('NuevoRegistro_IngresaDatos') === -1) return;
      var t = ev.target.closest ? ev.target.closest('button,input[type=submit],input[type=button],a') : null;
      if (!t) return;
      var txt = String(t.innerText || t.value || '').toLowerCase();
      var f = t.closest ? t.closest('form') : null;
      var act = f ? (f.getAttribute('action') || '') : '';
      if (/guardar/.test(txt) || act.indexOf('GuardaCompraGasLP') !== -1) {
        sessionStorage.setItem(S_PENDING, String(Date.now()));
        log('PENDIENTE POR CLIC', {});
      }
    }, true);
  }

  function armedValido() {
    var v = parseInt(sessionStorage.getItem(S_ARMED) || '0', 10);
    if (v && Date.now() - v <= ARMED_TTL) return true;
    sessionStorage.removeItem(S_ARMED);
    return false;
  }

  function pendingValido() {
    var v = parseInt(sessionStorage.getItem(S_PENDING) || '0', 10);
    if (v && Date.now() - v <= PENDING_TTL) return true;
    sessionStorage.removeItem(S_PENDING);
    return false;
  }

  function continuarSiguienteCompra() {
    sessionStorage.removeItem(S_REPEAT); sessionStorage.removeItem(S_CHAIN);
    sessionStorage.removeItem(S_ARMED); sessionStorage.removeItem(S_PENDING);
    if (!habilitado()) return false;
    var runs = parseInt(sessionStorage.getItem(S_RUNS) || '0', 10);
    if (runs >= MAX_RUNS) {
      mostrarBurbuja('Límite de ' + MAX_RUNS + ' compras consecutivas alcanzado. Reacciona el botón REPETIR COMPRA para reiniciar.');
      return false;
    }
    sessionStorage.setItem(S_RUNS, String(runs + 1));
    pintarPill();
    avisoVerde((ultimoRegistrado ? ultimoRegistrado + ' registrada — ' : 'Compra registrada — ') + 'abriendo la siguiente captura');
    var p = cargarParams();
    abrirRegistro(p);
    return true;
  }

  /* ===== HANDLERS POR PÁGINA ===== */
  function cadenaActiva() { return sessionStorage.getItem(S_CHAIN) === '1' && habilitado(); }
  function apagarCadena() { sessionStorage.removeItem(S_CHAIN); pintarPill(); }

  function onPageConfirmacion() {
    if (!habilitado() || !(armedValido() || pendingValido())) return;
    escanearNumero();
    log('CONFIRMACION → siguiente captura', {});
    setTimeout(function () {
      if (armedValido() || pendingValido()) continuarSiguienteCompra();
    }, 800);
  }

  function onPageTipo() {
    instalarCapturaTipo();
    if (!cadenaActiva()) return;
    var p = cargarParams();
    if (p.TipoSuministradorId === undefined) { log('SIN PARAMS TIPO · cadena apagada', {}); apagarCadena(); return; }
    ejecutarYa('Tipo: ' + (p.NombreTipoSuministrador || p.TipoSuministradorId), function () {
      var sel = document.getElementById('idRC_cmbTipoSuministrador'), btn = document.getElementById('idbtonAceptar');
      if (sel && btn && sel.querySelector('option[value="' + p.TipoSuministradorId + '"]')) {
        sel.value = String(p.TipoSuministradorId);
        log('CONTINUAR NATIVO TIPO', { id: p.TipoSuministradorId });
        btn.click();
        return;
      }
      enviarForm(URL_SUM, { TipoSuministradorId: p.TipoSuministradorId, NombreTipoSuministrador: p.NombreTipoSuministrador });
    });
  }

  function onPageSuministrador() {
    capturarTipoDePaginaSuministrador();
    instalarCapturaSuministrador();
    if (!cadenaActiva()) return;
    var p = cargarParams();
    if (p.SC_Id === undefined) { log('SIN PARAMS PLANTA · cadena apagada', { params: p }); apagarCadena(); return; }
    ejecutarYa('Planta SC_Id: ' + p.SC_Id, function () {
      try {
        if (typeof window.ShowIngresaDatosCompra === 'function') {
          log('CONTINUAR NATIVO PLANTA', { SC_Id: p.SC_Id });
          window.ShowIngresaDatosCompra(parseInt(p.SC_Id, 10));
          return;
        }
      } catch (e) { log('NATIVO FALLA', { error: e.message }); }
      enviarForm(URL_DATOS, {
        TipoSuministradorId: p.TipoSuministradorId !== undefined ? p.TipoSuministradorId : '19',
        NombreTipoSuministrador: p.NombreTipoSuministrador || 'Distribuidor por Planta de Distribucion',
        SC_Id: p.SC_Id
      });
    });
  }

  function onPageDatos() {
    capturarSCDePaginaDatos();
    sessionStorage.removeItem(S_REPEAT);
    apagarCadena();
    log('EN INGRESADATOS', { params: cargarParams() });
  }

  function onPageIndex() {
    if (armedValido() || pendingValido()) {
      sessionStorage.removeItem(S_ARMED); sessionStorage.removeItem(S_PENDING);
      if (!habilitado()) return;
      var runs = parseInt(sessionStorage.getItem(S_RUNS) || '0', 10);
      if (runs >= MAX_RUNS) {
        mostrarBurbuja('Límite de ' + MAX_RUNS + ' repeticiones alcanzado. Reacciona el botón REPETIR COMPRA para reiniciar.');
        return;
      }
      sessionStorage.setItem(S_RUNS, String(runs + 1));
      sessionStorage.setItem(S_CHAIN, '1');
      pintarPill();
      ejecutarYa('Nueva compra (directo a IngresaDatos)', function () {
        var p = cargarParams();
        abrirRegistro(p);
      });
    }
  }

  /* ===== TRASPASOS ===== */
  function parsearTraspasosES(texto) {
    var lineas = texto.split(/\r?\n/), fechas = [], venta = null, traspaso = null, permiso = null, sucursal = null;
    for (var i = 0; i < lineas.length; i++) {
      var c = cells(lineas[i]), noVacias = c.filter(function (x) { return x !== ''; });
      for (var k = 0; k < c.length; k++) { var f = fechaDe(c[k]); if (f) fechas.push(f); }
      if (!noVacias.length) continue;
      var primer = noVacias[0].toUpperCase();
      if (primer.indexOf('VENTA LITROS') === 0) venta = c;
      if (primer.indexOf('ENTRADA POR TRASPASO') === 0) traspaso = c;
      if (primer.indexOf('SUCURSAL') === 0 && noVacias.length > 1) sucursal = noVacias[1];
      if (/^N[°º]?\s*DE\s*PERMISO/.test(primer)) {
        var m = /(?:CNE\/)?LP\/\d+\/\w+\/\w+\/\d+/i.exec(lineas[i]);
        if (m) permiso = m[0];
      }
    }
    if (fechas.length < 1 || !traspaso) return null;
    var iVenta = -1;
    if (venta) for (var x = 0; x < venta.length; x++) if (esNumero(venta[x]) || venta[x].replace(/[$\s]/g, '') === '-') { iVenta = x; break; }
    var iTras = -1;
    for (var a = 0; a < traspaso.length; a++) if (esNumero(traspaso[a])) { iTras = a; break; }
    if (iTras === -1) return null;
    var numsTras = [];
    for (var n2 = 0; n2 < traspaso.length; n2++) if (esNumero(traspaso[n2])) numsTras.push(aNumero(traspaso[n2]));
    var dayWidth = 3;
    if (iVenta >= 0) dayWidth = Math.max(1, Math.round((venta.length - iVenta) / fechas.length));
    var iCol0 = iVenta >= 0 ? iVenta : iTras;
    var dias = [];
    for (var d = 0; d < fechas.length; d++) {
      var kilos = null, base = iCol0 + d * dayWidth;
      for (var o = 0; o < dayWidth; o++) {
        var idx = base + o;
        if (idx < traspaso.length && esNumero(traspaso[idx])) { kilos = aNumero(traspaso[idx]); break; }
      }
      if (kilos !== null && kilos > 0) dias.push({ fecha: fechas[d], kilos: kilos });
    }
    if (!dias.length && numsTras.length && numsTras.length <= fechas.length) {
      for (var d2 = 0; d2 < fechas.length && d2 < numsTras.length; d2++) if (numsTras[d2] > 0) dias.push({ fecha: fechas[d2], kilos: numsTras[d2] });
    }
    return { dias: dias, permiso: permiso, sucursal: sucursal, fechas: fechas };
  }

  function parsearMiniTraspaso(texto) {
    var lineas = texto.split(/\r?\n/), fechas = [], hayCabecera = false, kilosLineas = [];
    for (var i = 0; i < lineas.length; i++) {
      var c = cells(lineas[i]), noVacias = c.filter(function (x) { return x !== ''; });
      for (var k = 0; k < c.length; k++) { var f = fechaDe(c[k]); if (f) fechas.push(f); }
      for (var j = 0; j < c.length; j++) if (c[j].toUpperCase() === 'VOLUMEN') hayCabecera = true;
      var nums = c.filter(esNumero);
      if (nums.length === 1) { var v = aNumero(nums[0]); if (v > 0) kilosLineas.push(v); }
    }
    if (fechas.length < 1 || !hayCabecera || !kilosLineas.length) return null;
    var dias = [];
    if (fechas.length === 1) dias.push({ fecha: fechas[0], kilos: kilosLineas[0] });
    else if (kilosLineas.length === fechas.length) for (var d = 0; d < fechas.length; d++) dias.push({ fecha: fechas[d], kilos: kilosLineas[d] });
    else return null;
    return { dias: dias, permiso: null, sucursal: null, fechas: fechas };
  }

  function obtenerFechasCompra() {
    return new Promise(function (resolve) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/GasLP/Compras/GetRegistrosCompras', true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          var fechas = [];
          if (xhr.status === 200) {
            try {
              var j = JSON.parse(xhr.responseText);
              if (j && j.success && Array.isArray(j.data)) j.data.forEach(function (r) {
                if (r && r.fechaCompra && fechas.indexOf(r.fechaCompra) === -1) fechas.push(r.fechaCompra);
              });
            } catch (e) {}
          }
          resolve(fechas);
        };
        xhr.send('idEstatus=-1');
      } catch (e) { resolve([]); }
    });
  }

  function urlIngresaDatos(st) {
    return URL_DATOS + '?TipoSuministradorId=' + st.tipo + '&NombreTipoSuministrador=' + encodeURIComponent(st.nombre) + '&SC_Id=' + st.sc;
  }

  function navegarAIngresaDatos(st) {
    try { pageWin.SendMethodPost(urlIngresaDatos(st)); }
    catch (e) { avisoTraspaso(['Error al navegar al formulario: ' + e.message]); }
  }

  function procesarTraspasos(texto, plan) {
    var dias = plan.dias.filter(function (x) { return x.kilos > 0; });
    if (!dias.length) { avisoTraspaso(['No hay días con traspaso en el bloque pegado.']); return; }
    var params = cargarParams(), sc = params.SC_Id;
    if (sc === undefined || sc === '' || sc === null) {
      avisoTraspaso(['No tengo la planta suministradora (SC_Id).', 'Haz una compra manual una vez para capturarla y vuelve a pegar.']);
      return;
    }
    var st = { dias: dias, idx: 0, res: [], tipo: params.TipoSuministradorId !== undefined ? params.TipoSuministradorId : '19', nombre: params.NombreTipoSuministrador || 'Distribuidor por Planta de Distribucion', sc: sc };
    sessionStorage.setItem(S_TRASPASOS, JSON.stringify(st));
    var avisos = [dias.length + ' traspaso(s) por registrar:'];
    for (var di = 0; di < dias.length && di < 10; di++) avisos.push('· ' + dias[di].fecha + ' — ' + dias[di].kilos + ' kg');
    if (dias.length > 10) avisos.push('· …');
    if (plan.sucursal) avisos.push('Sucursal del bloque: ' + plan.sucursal);
    if (plan.permiso) {
      var codigoPagina = document.getElementById('codigoregistro');
      if (codigoPagina && codigoPagina.value && String(codigoPagina.value).toUpperCase().replace(/\s/g, '') !== String(plan.permiso).toUpperCase().replace(/\s/g, '')) {
        avisos.push('Atención: el permiso del bloque (' + plan.permiso + ') no coincide con el de la página (' + codigoPagina.value + ').');
      }
    }
    avisoTraspaso(avisos);
    if (location.pathname.indexOf('NuevoRegistro_IngresaDatos') === -1) { navegarAIngresaDatos(st); return; }
    continuarTraspasos();
  }

  function registrarUnTraspaso(dia) {
    return new Promise(function (resolve) {
      var captura = [], origAlert = null, poll = null, finished = false;
      function terminar(texto) {
        if (finished) return;
        finished = true;
        if (poll) clearInterval(poll);
        if (origAlert) pageWin.alert = origAlert;
        resolve({ texto: texto });
      }
      try {
        if (pageWin && typeof pageWin.alert === 'function') {
          origAlert = pageWin.alert;
          pageWin.alert = function (m) { captura.push(String(m)); };
        }
        var f = document.getElementById('idFechaCompra');
        if (!f) { terminar('ERROR: no se encontró el formulario'); return; }
        f.value = dia.fecha;
        var tsi = document.getElementById('idTraspasoSi');
        if (tsi) { tsi.checked = true; try { tsi.click(); } catch (e) {} }
        var vol = document.getElementById('idVolumenComprado2');
        if (vol) {
          try { vol.value = (pageWin.formatNumber && pageWin.formatNumber.new) ? pageWin.formatNumber.new(dia.kilos, '') : String(dia.kilos); } catch (e) { vol.value = String(dia.kilos); }
        }
        var entNo = document.getElementById('idEntParcialesNo'), entSi = document.getElementById('idEntParcialesSi');
        if (entNo) entNo.checked = true;
        if (entSi) entSi.checked = false;
        var hd = document.getElementById('hdMsgErrorFecha'); if (hd) hd.value = '';
        sessionStorage.removeItem(S_OK); sessionStorage.removeItem(S_FAIL);
        var t0 = Date.now();
        poll = setInterval(function () {
          var ok = sessionStorage.getItem(S_OK), fail = sessionStorage.getItem(S_FAIL);
          if (ok) { terminar('registrado (número en tu historial)'); return; }
          if (fail) {
            var msg = fail || '';
            terminar(/registr|fecha|exist/i.test(msg) ? 'ya registrada, se omite' : 'ERROR: ' + (msg || captura.join(' | ') || 'respuesta inválida'));
            return;
          }
          if (Date.now() - t0 > 20000) terminar('ERROR: sin respuesta del servidor' + (captura.length ? '  + captura.join(' | ')' : ''));
        }, 250);
        var intentos = 0;
        function clickAceptar() {
          intentos++;
          var btn = document.getElementById('idbtonAceptar_Compra');
          if (btn) btn.click();
          setTimeout(function () {
            if (finished) return;
            var guardar = document.getElementById('ShowbtonGuardar');
            var visible = guardar && guardar.style.display !== 'none';
            if (visible) {
              var btnOK = document.getElementById('btnOKAddConfirmar');
              if (btnOK) { btnOK.click(); return; }
              terminar('ERROR: botón Confirmar no encontrado');
            } else if (intentos < 3) {
              clickAceptar();
            } else {
              var errores = [];
              var ems = document.querySelectorAll('.messageContainer em, #idErrorVolumen em, #msgAddFila');
              for (var i = 0; i < ems.length; i++) {
                var t2 = ems[i].textContent.replace(/\s+/g, ' ').trim();
                if (t2 && errores.indexOf(t2) === -1) errores.push(t2);
              }
              if (hd && hd.value && errores.indexOf(hd.value) === -1) errores.push(hd.value);
              terminar('ERROR validación: ' + (errores.join(' | ') || captura.join(' | ') || 'sin detalle'));
            }
          }, 1200);
        }
        clickAceptar();
      } catch (e) {
        terminar('ERROR: ' + e.message);
      }
    });
  }

  async function continuarTraspasos() {
    var raw = sessionStorage.getItem(S_TRASPASOS);
    if (!raw) return;
    var st;
    try { st = JSON.parse(raw); } catch (e) { sessionStorage.removeItem(S_TRASPASOS); return; }
    if (location.pathname.indexOf('NuevoRegistro_IngresaDatos') === -1) { navegarAIngresaDatos(st); return; }
    if (traspasoLoopActivo) return;
    traspasoLoopActivo = true;
    try {
      sessionStorage.removeItem(S_OK); sessionStorage.removeItem(S_FAIL);
      sessionStorage.removeItem(S_REPEAT); sessionStorage.removeItem(S_ARMED);
      sessionStorage.removeItem(S_PENDING); sessionStorage.removeItem(S_CHAIN);
      if (st.res.length && st.res[st.res.length - 1].texto === 'pendiente') st.res[st.res.length - 1].texto = 'registrado (confirmado por redirección)';
      var yaRegistradas = await obtenerFechasCompra();
      for (var i = st.idx; i < st.dias.length; i++) {
        var dia = st.dias[i];
        avisoTraspaso(['Traspaso ' + (i + 1) + ' de ' + st.dias.length + ': ' + dia.fecha + ' — ' + dia.kilos + ' kg']);
        if (yaRegistradas.indexOf(dia.fecha) !== -1) {
          st.idx = i + 1;
          st.res.push({ fecha: dia.fecha, kilos: dia.kilos, texto: 'ya registrada, se omite' });
          sessionStorage.setItem(S_TRASPASOS, JSON.stringify(st));
          await sleep(300);
          continue;
        }
        try { reiniciarFormulario(); } catch (e) {}
        await sleep(200);
        st.idx = i + 1;
        st.res.push({ fecha: dia.fecha, kilos: dia.kilos, texto: 'pendiente' });
        sessionStorage.setItem(S_TRASPASOS, JSON.stringify(st));
        var r = await registrarUnTraspaso(dia);
        st.res[st.res.length - 1].texto = r.texto;
        if (r.texto.indexOf('registrado') === 0 && yaRegistradas.indexOf(dia.fecha) === -1) yaRegistradas.push(dia.fecha);
        sessionStorage.setItem(S_TRASPASOS, JSON.stringify(st));
        await sleep(600);
      }
    } finally {
      traspasoLoopActivo = false;
    }
    var lineas = st.res.map(function (r) { return r.fecha + ': ' + r.kilos + ' kg — ' + r.texto; });
    sessionStorage.removeItem(S_TRASPASOS); sessionStorage.removeItem(S_REPEAT); sessionStorage.removeItem(S_ARMED);
    sessionStorage.removeItem(S_PENDING); sessionStorage.removeItem(S_CHAIN);
    try { pageWin.alert('Resumen de traspasos:\n\n' + lineas.join('\n')); } catch (e) {}
    location.href = '/GasLP/Compras/Index';
  }

  function instalarPasteTraspasos() {
    document.addEventListener('paste', function (e) {
      if (location.pathname.indexOf('/GasLP/Compras/') === -1) return;
      var cd = e.clipboardData || window.clipboardData;
      var texto = cd ? cd.getData('text/plain') : '';
      if (!texto || texto.indexOf('\t') < 0) return;
      var plan = parsearTraspasosES(texto) || parsearMiniTraspaso(texto);
      if (!plan) return;
      e.preventDefault(); e.stopPropagation();
      procesarTraspasos(texto, plan);
    }, true);
  }

  /* ===== ROUTER ===== */
  function enrutar() {
    var path = location.pathname;
    log('RUTA', { path: path, enabled: habilitado() });
    if (sessionStorage.getItem(S_TRASPASOS)) {
      if (path.indexOf('/GasLP/Compras/') !== -1) { setTimeout(function () { continuarTraspasos(); }, 500); return; }
    }
    if (path.indexOf('NuevoRegistro_SeleccionaTipoSuministrador') !== -1) onPageTipo();
    else if (path.indexOf('NuevoRegistro_SeleccionaSuministrador') !== -1) onPageSuministrador();
    else if (path.indexOf('NuevoRegistro_IngresaDatos') !== -1) onPageDatos();
    else if (path.indexOf('PaginaConfirmacion') !== -1) onPageConfirmacion();
    else if (path.indexOf('/GasLP/Compras/Index') !== -1) onPageIndex();
  }

  /* ===== INICIO ===== */
  function iniciar() {
    if (_destroyed) return;
    if (!document.body) { window.addEventListener('DOMContentLoaded', iniciar); return; }
    if (_iniciado) return;
    _iniciado = true;
    instalarParchesRed();
    instalarInterceptaNavegacion();
    instalarClickGuardar();
    instalarPasteTraspasos();
    iniciarObservador();
    iniciarPill();
    enrutar();
  }

  function destroy() {
    _destroyed = true;
    STOP = true;
    traspasoLoopActivo = false;
  }

  /* ===== REGISTRAR ===== */
  ET.register({
    name: 'acsRep',
    version: '1.7.0',
    init: iniciar,
    destroy: destroy,
    css: css,
    api: {
      habilitado: habilitado,
      alternar: function () {
        var nuevo = habilitado() ? '0' : '1';
        localStorage.setItem(K_ENABLED, nuevo);
        sessionStorage.removeItem(S_CHAIN); sessionStorage.removeItem(S_ARMED); sessionStorage.removeItem(S_PENDING);
        sessionStorage.setItem(S_RUNS, '0');
        pintarPill();
        log('TOGGLE', { enabled: nuevo === '1' });
      },
      cargarPresets: cargarPresets,
      guardarPresetActual: guardarPresetActual,
      aplicarPreset: aplicarPreset,
      eliminarPreset: eliminarPreset,
      cargarRegistros: cargarRegistros,
      limpiarHistorial: function () { guardarRegistros([]); abrirPopup(cargarRegistros()); },
      parsearTraspasos: parsearTraspasosES,
      procesarTraspasos: procesarTraspasos,
      continuarTraspasos: continuarTraspasos,
      detener: function () { STOP = true; }
    }
  });

  /* auto-iniciar si está habilitado */
  if (habilitado()) {
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
  }

})(window.ET);
