// ==UserScript==
// @name         EASYTRAC ACS
// @namespace    easytrac.module.acs
// @version      3.4.0
// @description  Módulo ACS — automatización completa de compras SIRETRAC
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_download
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ============ CSS ============ */
  var css = `
    #et-acs-sidebar {
      position:fixed;right:16px;top:60px;z-index:2147483647;
      width:320px;max-height:calc(100vh - 80px);
      background:#f5f5f5;border:1px solid #ccc;border-radius:8px;
      box-shadow:0 4px 16px rgba(0,0,0,.3);font:12px Arial,sans-serif;
      display:none;flex-direction:column;overflow:hidden;
    }
    #et-acs-sidebar.et-visible { display:flex; }
    .et-acs-cab {
      background:#1d3557;color:#fff;padding:8px 10px;
      font-weight:bold;font-size:13px;display:flex;justify-content:space-between;align-items:center;
    }
    .et-acs-cab button { background:none;border:none;color:#fff;font-size:16px;cursor:pointer; }
    .et-acs-tabs { display:flex;border-bottom:1px solid #ccc; }
    .et-acs-tab {
      flex:1;padding:6px 4px;text-align:center;cursor:pointer;
      background:#e0e0e0;border:none;border-bottom:2px solid transparent;font-size:11px;
    }
    .et-acs-tab.et-active { background:#fff;border-bottom-color:#2EA836;font-weight:bold; }
    .et-acs-body { flex:1;overflow:auto;padding:8px;max-height:400px; }
    .et-acs-tabc { display:none; }
    .et-acs-tabc.et-active { display:block; }
    .et-acs-row { margin:4px 0;display:flex;gap:4px;align-items:center; }
    .et-acs-row label { width:90px;font-size:11px;color:#555; }
    .et-acs-row input { flex:1;padding:3px;border:1px solid #bbb;border-radius:3px;font-size:11px; }
    .et-acs-btn {
      background:#2EA836;color:#fff;border:none;border-radius:4px;
      padding:5px 10px;cursor:pointer;font-weight:bold;font-size:11px;margin:2px;
    }
    .et-acs-btn:hover { background:#258a2c; }
    .et-acs-btn:disabled { background:#999;cursor:default; }
    .et-acs-log { font-size:11px;max-height:200px;overflow:auto;background:#fff;border:1px solid #ddd;padding:4px; }
    .et-acs-log div { padding:1px 0;border-bottom:1px solid #eee; }
    .et-acs-summary { font-size:11px;color:#666;margin:4px 0; }
    #et-acs-summary { font-size:11px;color:#666; }
    .et-acs-tabla { width:100%;border-collapse:collapse;font-size:11px; }
    .et-acs-tabla th { background:#1d3557;color:#fff;padding:3px 4px;text-align:left; }
    .et-acs-tabla td { padding:2px 4px;border-bottom:1px solid #ddd; }
    .et-acs-tabla tr:hover { background:#f0f0f0; }
    .et-acs-tabla input[type=checkbox] { margin:0; }
    .et-ok { color:#2EA836;font-weight:bold; }
    .et-fail { color:#C60C0E;font-weight:bold; }
    .et-stopped { color:#ff9800;font-weight:bold; }
  `;

  /* ============ CONFIGURACIÓN ============ */
  var DEFAULTS = {
    DESDE: '2026-08-10', HASTA: '2026-08-16',
    VEHICULO: 'A002252', PLACAS: 'JU47194',
    DELAY_MS: 800, DATA_RETRIES: 3, DATA_RETRY_BASE_MS: 100,
    CERRAR_AL_RECEPCIONAR: true, RECORRER_PERMISOS: true,
    PERMISOS: [], PERMISO_FILTRO: '', MOTIVO_CIERRE: '',
    INCLUIR_NO_CERRADAS_FACT: false, VERBOSE: true,
    EXCLUIR_DIST_PLA: false, CIERRE_METHOD: 'GET'
  };

  var CONFIG = {};
  function cargarConfig() {
    try { CONFIG = Object.assign({}, DEFAULTS, JSON.parse(GM_getValue('acs_cfg', '{}'))); }
    catch (e) { CONFIG = Object.assign({}, DEFAULTS); }
  }
  function guardarConfig() { GM_setValue('acs_cfg', JSON.stringify(CONFIG)); }

  var UI_STATE = { min: false, tab: 'inicio' };
  function cargarUI() {
    try { UI_STATE = Object.assign({ min: false, tab: 'inicio' }, JSON.parse(GM_getValue('acs_ui', '{}'))); }
    catch (e) { UI_STATE = { min: false, tab: 'inicio' }; }
  }
  function guardarUI() { GM_setValue('acs_ui', JSON.stringify(UI_STATE)); }

  function verboseLog(tipo, datos) {
    if (!CONFIG.VERBOSE) return;
    try { console.log('[ACS][' + tipo + '] ' + JSON.stringify(datos, null, 2)); }
    catch (e) { console.log('[ACS][' + tipo + ']', datos); }
  }

  function textoRespuesta(res) {
    return String(res && res.text || '').replace(/\s+/g, ' ').slice(0, 1200);
  }

  /* ============ HELPERS DE FECHA ============ */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function isoToDMA(iso) { var p = String(iso || '').split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function parseDia(s) { var p = String(s || '').split('/'); return new Date(+p[2], +p[1] - 1, +p[0]); }
  function parseISO(s) { var p = String(s || '').split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function ahoraHora() { var d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
  function enRango(fechaDMA) {
    try { var fc = parseDia(fechaDMA); return fc >= parseISO(CONFIG.DESDE) && fc <= parseISO(CONFIG.HASTA); }
    catch (e) { return false; }
  }
  function pasaFiltroPermiso(compra) {
    if (CONFIG.PERMISO_FILTRO && String(compra && compra.permiso_Vendedor || '').trim() !== String(CONFIG.PERMISO_FILTRO).trim()) return false;
    return true;
  }

  /* ============ FETCH ============ */
  var HDRS = { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };

  function esperarMs(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function apiPost(url, body) {
    verboseLog('POST', { url: url, body: body });
    return fetch(url, { method: 'POST', headers: HDRS, body: body, credentials: 'same-origin' })
      .then(function (r) {
        return r.text().then(function (txt) {
          var j = null; try { j = JSON.parse(txt); } catch (e) {}
          verboseLog('RESP', { url: url, status: r.status, json: j });
          return { status: r.status, text: txt, json: j };
        });
      }).catch(function (e) { verboseLog('ERR', { url: url, error: e.message }); throw e; });
  }

  var HDRS_PLAIN = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
  function apiPostPlain(url, body) {
    verboseLog('POST PLAIN', { url: url, body: body });
    return fetch(url, { method: 'POST', headers: HDRS_PLAIN, body: body, credentials: 'same-origin' })
      .then(function (r) {
        return r.text().then(function (txt) {
          var j = null; try { j = JSON.parse(txt); } catch (e) {}
          return { status: r.status, text: txt, json: j };
        });
      }).catch(function (e) { verboseLog('ERR PLAIN', { url: url, error: e.message }); throw e; });
  }

  function respuestaReintentable(res) {
    return !res || !res.json || res.status === 408 || res.status === 429 || res.status >= 500;
  }

  function apiPostDatos(url, body) {
    var intento = 0;
    var max = Math.max(1, Number(CONFIG.DATA_RETRIES) || 3);
    function ejecutar() {
      intento++;
      return apiPost(url, body).then(function (res) {
        if (intento < max && respuestaReintentable(res)) {
          return esperarMs((Number(CONFIG.DATA_RETRY_BASE_MS) || 100) * Math.pow(2, intento - 1)).then(ejecutar);
        }
        return res;
      }).catch(function (e) {
        if (intento < max) {
          return esperarMs((Number(CONFIG.DATA_RETRY_BASE_MS) || 100) * Math.pow(2, intento - 1)).then(ejecutar);
        }
        throw e;
      });
    }
    return ejecutar();
  }

  /* ============ ESTADO / PROGRESO ============ */
  var STOP = false;
  var filas = [];
  var PROG = { total: 0, hecho: 0 };
  var candidatos = [];
  var facturasCandidatas = [];

  function detener() { STOP = true; }
  function progReset() { PROG = { total: 0, hecho: 0 }; progRender(''); }
  function progAdd(n) { PROG.total += (n || 0); progRender(''); }
  function progStep(msg) { PROG.hecho++; progRender(msg); }
  function progRender(msg) {
    var bar = document.getElementById('et-acs-bar-fill');
    var text = document.getElementById('et-acs-prog-text');
    var status = document.getElementById('et-acs-status');
    var pct = PROG.total ? Math.min(100, Math.round(PROG.hecho * 100 / PROG.total)) : 0;
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = PROG.hecho + ' / ' + PROG.total;
    if (status && msg) status.textContent = msg;
  }

  function actualizarResumen() {
    var summary = document.querySelector('#et-acs-summary');
    if (!summary) return;
    var rows = document.querySelectorAll('#et-acs-tabla tbody tr').length;
    var selected = document.querySelectorAll('#et-acs-tabla tbody input[type=checkbox]:checked').length;
    summary.textContent = rows + ' visibles · ' + selected + ' seleccionadas';
  }

  /* ============ ACUSES ============ */
  function pick(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]) !== '') return String(obj[k]);
    }
    return '';
  }

  function acuseDespacho(dc, ds, opt) {
    return '|Permiso Comprador=' + pick(dc, ['permiso_Comprador', 'permisoComprador', 'permiso']) +
      '|Razón Social Comprador=' + pick(dc, ['razonSocial_Comprador', 'razonSocialComprador', 'razonSocial']) +
      '|Dirección Comprador=' + pick(dc, ['direccion_Comprador', 'direccionComprador', 'direccion']) +
      '|Permiso Suministrador=' + pick(ds, ['permiso_Vendedor', 'permisoVendedor', 'permiso']) +
      '|Razón Social Suministrador=' + pick(ds, ['razonSocial_Vendedor', 'razonSocialVendedor', 'razonSocial']) +
      '|Dirección Suministrador=' + pick(ds, ['direccion_Vendedor', 'direccionVendedor', 'direccion']) +
      '|Representante legal=|RFC Representante legal=' +
      '|Fecha Registro=' + opt.fechaRegistro +
      '|Fecha de Despacho=' + opt.fechaDespacho +
      '|Número de Registro de Compra=' + opt.codigo +
      '|Volumen=' + opt.volumen +
      '|ID de Vehículo=' + opt.idVehiculo +
      '|Placas=' + opt.placas;
  }

  function acuseRecepcion(o) {
    return '|Permiso Comprador=' + o.permC +
      '|Razón Social Comprador=' + o.rsC +
      '|Dirección Comprador=' + o.dirC +
      '|Permiso Suministrador=' + o.permS +
      '|Razón Social Suministrador=' + o.rsS +
      '|Dirección Suministrador=' + o.dirS +
      '|Representante legal=|RFC Representante legal=' +
      '|Fecha Registro=' + o.fechaRegistro +
      '|Fecha de Recepción=' + o.fechaRecepcion +
      '|Número de Registro de Compra=' + o.numReg +
      '|Volumen=' + o.volumen +
      '|ID de Vehículo=' + o.idVehiculo +
      '|Placas=' + o.placas;
  }

  /* ============ EXTRACCIÓN DE HTML ============ */
  function matchInput(html, id) {
    var re = new RegExp("(?:id|name)\\s*=\\s*[\"']" + id + "[\"'][^>]*?value\\s*=\\s*[\"']([^\"']*)[\"']", 'i');
    var m = html.match(re);
    if (m) return m[1];
    var re2 = new RegExp("value\\s*=\\s*[\"']([^\"']*)[\"'][^>]*?(?:id|name)\\s*=\\s*[\"']" + id + "[\"']", 'i');
    var m2 = html.match(re2);
    return m2 ? m2[1] : '';
  }

  function matchText(html, id) {
    var re = new RegExp("(?:id|class)\\s*=\\s*[\"'][^\"']*\\b" + id + "\\b[^\"']*[\"'][^>]*>([^<]*)<", 'i');
    var m = html.match(re);
    return m ? m[1].trim() : '';
  }

  /* ============ PERMISOS ============ */
  function escanearPermisos(html) {
    var lista = [];
    var vistos = {};
    var re = /href\s*=\s*["']([^"']*SeleccionarPermiso[^"']*)["']/gi;
    var m;
    while ((m = re.exec(html))) {
      var href = m[1].replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
      if (href.indexOf('idPermiso') === -1) continue;
      var idm = href.match(/idPermiso=(\d+)/);
      if (!idm || vistos[idm[1]]) continue;
      vistos[idm[1]] = true;
      var url = href.indexOf('http') === 0 ? href : href.indexOf('/') === 0 ? href : '/' + href;
      lista.push({ id: idm[1], url: url });
    }
    return lista;
  }

  function obtenerPermisos() {
    var lista = escanearPermisos(document.documentElement.outerHTML);
    if (lista.length) return Promise.resolve(lista);
    return fetch('/OrdenDePedido/SeleccionarPermiso', { credentials: 'same-origin' })
      .then(function (r) { return r.text(); })
      .then(function (html) { return escanearPermisos(html); })
      .then(function (encontrados) {
        if (encontrados.length) return encontrados;
        return CONFIG.PERMISOS.map(function (id) {
          return { id: String(id), url: '/OrdenDePedido/SeleccionarPermiso?idPermiso=' + id + '&permiso=&idPermisionario=0&idPermisoMateria=0&idPermisoActividad=0&razonSocial=&estatus=False&capacidadOperativa=0' };
        });
      })
      .catch(function () {
        return CONFIG.PERMISOS.map(function (id) {
          return { id: String(id), url: '/OrdenDePedido/SeleccionarPermiso?idPermiso=' + id + '&permiso=&idPermisionario=0&idPermisoMateria=0&idPermisoActividad=0&razonSocial=&estatus=False&capacidadOperativa=0' };
        });
      });
  }

  function permisoUrlPorId(id) {
    return '/OrdenDePedido/SeleccionarPermiso?idPermiso=' + encodeURIComponent(id) +
      '&permiso=&idPermisionario=0&idPermisoMateria=0&idPermisoActividad=0&razonSocial=&estatus=False&capacidadOperativa=0';
  }

  function permisoDeUrl(url) {
    try {
      var idx = String(url).indexOf('?');
      var params = new URLSearchParams(idx === -1 ? '' : url.substring(idx + 1));
      return params.get('permiso') || '';
    } catch (e) { return ''; }
  }

  var despachosFallback = [];

  function obtenerPermisosDespacho() {
    return obtenerPermisos().then(function (permisosComprador) {
      var encontrados = {};
      despachosFallback = [];
      var vistosFallback = {};
      var permisosPorTexto = {};
      permisosComprador.forEach(function (permiso) {
        var texto = permisoDeUrl(permiso.url).trim().toUpperCase();
        if (texto) permisosPorTexto[texto] = permiso;
      });
      var secuencia = Promise.resolve();
      permisosComprador.forEach(function (permisoComprador) {
        secuencia = secuencia.then(function () {
          return cambiarPermiso(permisoComprador).then(function () {
            return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-1')
              .then(function (res) {
                var data = (res.json && res.json.data) || [];
                data.forEach(function (compra) {
                  if (Number(compra.idEstatus) === 1 && !vistosFallback[compra.idCompra]) {
                    vistosFallback[compra.idCompra] = true;
                    despachosFallback.push(compra);
                  }
                  var proveedor = String(compra.permiso_Vendedor || '').trim();
                  var m = proveedor.match(/^(?:LP|H)\/(\d+)/i);
                  if (!m) return;
                  var permisoOriginal = permisosPorTexto[proveedor.toUpperCase()];
                  var clave = permisoOriginal ? permisoOriginal.id : proveedor.toUpperCase();
                  if (encontrados[clave]) return;
                  encontrados[clave] = {
                    id: permisoOriginal ? permisoOriginal.id : m[1],
                    url: permisoOriginal ? permisoOriginal.url : permisoUrlPorId(m[1]),
                    permiso: proveedor
                  };
                });
              });
          });
        });
      });
      return secuencia.then(function () {
        return Object.keys(encontrados).map(function (id) { return encontrados[id]; });
      });
    }).then(function (permisosPlanta) {
      verboseLog('PERMISOS DESPACHO', permisosPlanta);
      return permisosPlanta;
    });
  }

  function cambiarPermiso(p) {
    var idx = p.url.indexOf('?');
    var path = idx === -1 ? p.url : p.url.substring(0, idx);
    var qs = idx === -1 ? '' : p.url.substring(idx + 1);
    verboseLog('CAMBIO PERMISO', { id: p.id, permiso: p.permiso || '', url: p.url });
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs, credentials: 'same-origin' }).catch(function (e) {
      progRender('No se pudo cambiar al permiso ' + p.id + ': ' + e.message);
    });
  }

  function cerrarEntrega(opts) {
    var qs = 'Destino=13&numero=' + opts.idEntrega + '&codigo=' + encodeURIComponent(opts.codigo) + '&idCompra=' + opts.idCompra;
    var url = opts.base + '?' + qs;
    return apiPost(url, '').then(function (res) {
      return { ok: res.status === 200 && res.text.indexOf('SesionExpirada') === -1, detalle: 'HTTP ' + res.status };
    });
  }

  /* ============ CIERRE MANUAL ============ */
  function limpiarHtml(s) {
    return String(s).replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
      .replace(/&oacute;/gi, 'ó').replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é')
      .replace(/&iacute;/gi, 'í').replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ')
      .replace(/\s+/g, ' ').trim();
  }

  function cadenaCierreCompra(html) {
    var heads = [];
    var m;
    var reTh = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    while ((m = reTh.exec(html))) heads.push(limpiarHtml(m[1]));
    var cells = [];
    var body = html.match(/<tbody>[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>/i);
    if (body) {
      var reTd = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      while ((m = reTd.exec(body[1]))) cells.push(limpiarHtml(m[1]));
    }
    var cadena = '';
    for (var i = 0; i < heads.length; i++) {
      var val = cells[i] !== undefined ? cells[i] : '';
      if (val === '') continue;
      cadena += (heads[i] === 'Estado' ? heads[i] + '=Cerrada' : heads[i] + '=' + val) + '|';
    }
    return cadena;
  }

  function cerrarCompraManual(c) {
    return apiPostPlain('/GasLP/Compras/CerrarCompra', 'idCompra=' + encodeURIComponent(c.idCompra))
      .then(function (det) {
        var h = det.text;
        var mc = h.match(/idComprador:\s*(\d+)/);
        var mv = h.match(/idVendedor:\s*(\d+)/);
        var mco = h.match(/CodigoRegistro:\s*['"]([^'"]+)['"]/);
        if (!mc || !mv) {
          var expirada = h.indexOf('/Home/SesionExpiradaPage') !== -1 && h.indexOf('CerrarCompraAceptada') === -1;
          throw new Error(expirada ? 'Sesión expirada' : 'CerrarCompra sin idComprador/idVendedor');
        }
        var idCompra = matchInput(h, 'id-compra') || c.idCompra;
        var codigo = mco ? mco[1] : (c.codigo || '');
        var mostrarMotivo = matchInput(h, 'mostrar-motivo-cierre') === '1';
        var motivo = mostrarMotivo ? (CONFIG.MOTIVO_CIERRE || '') : '';
        if (mostrarMotivo && String(motivo).trim().length < 5) {
          throw new Error('requiere motivo de cierre (>=5 caracteres) en configuración');
        }
        var volCierre = matchInput(h, 'idVolumenCierre') || '';
        var body = 'contenidoAcuse=' + encodeURIComponent(cadenaCierreCompra(h)) +
          '&idCompra=' + encodeURIComponent(idCompra) +
          '&strMotivoCierre=' + encodeURIComponent(motivo) +
          '&CodigoRegistro=' + encodeURIComponent(codigo) +
          '&idComprador=' + mc[1] + '&idVendedor=' + mv[1] +
          (volCierre ? '&volumenCierre=' + encodeURIComponent(volCierre) : '');
        return apiPost('/GasLP/Compras/GuardarCerrarCompra', body);
      })
      .then(function (res) {
        var j = res.json || {};
        if (j.result === true) return { ok: true, msg: '' };
        if (j.mensaje === 'SC') throw new Error('Sesión expirada');
        return { ok: false, msg: j.mensaje || res.text.slice(0, 200) };
      });
  }

  /* ============ FORMATO DE TRASPASO ============ */
  function generarFormatoTraspaso(compra) {
    var kg = parseFloat(compra.volumen_Entregado) || 0;
    var litros = (kg / 0.515).toFixed(0);
    var fecha = compra.fechaCompra || '';
    var diasSemana = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var p = String(fecha).split('/');
    var d = p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]) : new Date();
    var fechaLarga = diasSemana[d.getDay()] + ', ' + d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
    var litrosFmt = Number(litros).toLocaleString('es-MX');

    var doc = new jspdf.jsPDF({ unit: 'mm', orientation: 'portrait', format: 'letter' });
    var W = 215.9, originalW = 215.9;
    var shift = (W - originalW) / 2;
    var ptToMm = function (pt) { return pt * 25.4 / 72 + shift; };
    var xCenter = function (left, right) { return ptToMm((left + right) / 2); };
    var xRight = function (right) { return ptToMm(right); };

    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('GAS DE OJUELOS,  S.A DE C.V.', xCenter(190.13, 349.20), 25, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    doc.text('KM. 6+500 CARRETERA OJUELOS-OCAMPO,', xCenter(195.65, 374.04), 34, { align: 'center' });
    doc.text('MUNICIPIO DE OJUELOS, ESTADO DE JALISCO', xCenter(192.17, 377.61), 39, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('PERMISO CRE:', xCenter(92.05, 151.95), 58, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    doc.text(compra.permiso_Vendedor || '', xCenter(200.69, 308.64), 58, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('PRODUCTO GAS LP', xCenter(180.98, 260.56), 72, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('FECHA:', xCenter(105.74, 135.53), 81, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(fechaLarga, xRight(368.25), 81, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('LITROS TOTALES:', ptToMm(80.66), 95, { align: 'left' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text(litrosFmt, xRight(296.50), 95, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text('GRACIAS.', xRight(304.37), 105, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('FIN DEL REPORTE', xCenter(137.66, 208.87), 114, { align: 'center' });

    return doc;
  }

  function nombreArchivoTraspaso(codigoRegistro) {
    var m = String(codigoRegistro).match(/LP\/(\d+)\/\d+\/(\d+)/);
    if (!m) return 'formato_traspaso.pdf';
    var permiso = m[1];
    var num = parseInt(m[2], 10);
    var contador = String(num).padStart(3, '0');
    return 'LP-' + permiso + '-' + contador + '.pdf';
  }

  function descargarFormato(compra) {
    var doc = generarFormatoTraspaso(compra);
    var filename = nombreArchivoTraspaso(compra.codigoRegistro || '');
    var blob = doc.output('blob');
    var url = URL.createObjectURL(blob);
    try {
      GM_download({ url: url, name: filename, saveAs: false });
      return true;
    } catch (e) {
      doc.save(filename);
      return true;
    }
  }

  function postMultipart(url, formData) {
    return fetch(url, {
      method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: formData, credentials: 'same-origin'
    }).then(function (r) {
      return r.text().then(function (txt) {
        var json = null;
        try { json = JSON.parse(txt); } catch (e) {}
        return { status: r.status, text: txt, json: json };
      });
    });
  }

  function aplanarNodos(nodos, salida) {
    salida = salida || [];
    (nodos || []).forEach(function (n) { salida.push(n); aplanarNodos(n.children || [], salida); });
    return salida;
  }

  function buscarNodoFactura(compra, nodos) {
    var todos = aplanarNodos(nodos, []);
    var objetivo = todos.filter(function (n) {
      if (n.tipo !== 'RegistroCompra') return false;
      var d = n.datos && n.datos[0];
      return d && (String(d.idCompra) === String(compra.idCompra) || d.codigoRegistro === compra.codigoRegistro);
    })[0];
    if (!objetivo) return null;
    var datos = objetivo.datos && objetivo.datos[0] || {};
    var entregas = aplanarNodos(objetivo.children || [], []).filter(function (n) {
      return n.tipo === 'RegistroEntrega' && n.datos && n.datos[0];
    }).map(function (n) { return String(n.datos[0].idEntrega || n.id || ''); }).filter(Boolean);
    return { rfc: objetivo.rfc || datos.rfc || '', idsEntrega: entregas };
  }

  function subirFormatoTraspaso(compra) {
    return fetch('/GasLP/Facturas/Index', { credentials: 'same-origin' }).then(function () {
      return getJsonDatos('/GasLP/Facturas/GetNodosDespachosSinFactura?traspaso=true');
    }).then(function (nodos) {
      var referencia = buscarNodoFactura(compra, nodos);
      if (!referencia) throw new Error('compra sin nodo de factura: ' + compra.codigoRegistro);
      if (!referencia.idsEntrega.length) throw new Error('compra sin entrega para asignar: ' + compra.codigoRegistro);
      var doc = generarFormatoTraspaso(compra);
      var filename = nombreArchivoTraspaso(compra.codigoRegistro || '');
      var pdf = doc.output('blob');
      var validar = new FormData();
      validar.append('file', pdf, filename);
      validar.append('RFCcompra', referencia.rfc);
      return postMultipart('/GasLP/Facturas/UploadFiles', validar).then(function (res) {
        var j = res.json || {};
        if (res.status < 200 || res.status >= 300 || j.success !== true) {
          throw new Error(j.mensaje || j.message || 'UploadFiles rechazó el PDF');
        }
        var asignar = new FormData();
        asignar.append('file', pdf, filename);
        asignar.append('FechaRegistro', toISO(new Date()));
        asignar.append('DatosAcuse', 'Traspaso=SI');
        asignar.append('IdsEntrega', referencia.idsEntrega.join(','));
        return postMultipart('/GasLP/Facturas/GuardarAsignacionFactura', asignar).then(function (respuesta) {
          var resultado = respuesta.json || {};
          if (respuesta.status < 200 || respuesta.status >= 300 || resultado.success !== true) {
            throw new Error(resultado.mensaje || resultado.message || 'GuardarAsignacionFactura rechazó la asignación');
          }
          return { ok: true, idsEntrega: referencia.idsEntrega };
        });
      });
    });
  }

  function getJsonDatos(url) {
    var intento = 0;
    var max = Math.max(1, Number(CONFIG.DATA_RETRIES) || 3);
    function ejecutar() {
      intento++;
      verboseLog('GET ' + intento + '/' + max, { url: url });
      return fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) {
          return r.text().then(function (txt) {
            var json = null;
            try { json = JSON.parse(txt); } catch (e) {}
            if (intento < max && respuestaReintentable({ status: r.status, json: json })) {
              return esperarMs((Number(CONFIG.DATA_RETRY_BASE_MS) || 100) * Math.pow(2, intento - 1)).then(ejecutar);
            }
            if (!json && intento >= max) throw new Error('respuesta no JSON en ' + url);
            return json;
          });
        }).catch(function (e) {
          if (intento < max) {
            return esperarMs((Number(CONFIG.DATA_RETRY_BASE_MS) || 100) * Math.pow(2, intento - 1)).then(ejecutar);
          }
          throw e;
        });
    }
    return ejecutar();
  }

  /* ============ MÓDULO: ACEPTAR ============ */
  function listarAceptar() {
    return apiPostDatos('/GasLP/AceptarRechazarCompras/GetRegistrosCompras', 'idEstatus=-2')
      .then(function (res) { return (res.json && res.json.data) || []; });
  }

  function aceptarUna(f) {
    return apiPost('/GasLP/AceptarRechazarCompras/Aceptar', 'idCompra=' + f.idCompra + '&CodigoRegistro=' + encodeURIComponent(f.codigoRegistro))
      .then(function (det) {
        var mv = det.text.match(/var idVendedor\s*=\s*"(\d+)"/);
        var mc = det.text.match(/var idComprador\s*=\s*"(\d+)"/);
        if (!mv || !mc) throw new Error('detalle sin idVendedor/idComprador');
        return apiPost('/GasLP/AceptarRechazarCompras/Guardar_AceptarCompra',
          'idCompra=' + f.idCompra + '&CodigoRegistro=' + encodeURIComponent(f.codigoRegistro) +
          '&idComprador=' + mc[1] + '&idVendedor=' + mv[1] + '&cadenaAcuse=');
      })
      .then(function (res) {
        if (res.json && res.json.result === true) return { ok: true, msg: '' };
        return { ok: false, msg: (res.json && (res.json.mensaje || res.json.message)) || res.text.slice(0, 200) };
      });
  }

  function moduloAceptar(permiso) {
    return listarAceptar().then(function (data) {
      var pend = data.filter(function (f) { return pasaFiltroPermiso(f) && Number(f.idEstatus) === 0 && enRango(f.fechaCompra); });
      progAdd(pend.length);
      progRender('Permiso ' + (permiso ? permiso.id : 'actual') + ': ' + pend.length + ' a aceptar de ' + data.length);
      var seq = Promise.resolve();
      pend.forEach(function (f) {
        seq = seq.then(function () {
          if (STOP) return;
          var fila = nuevaFila('Aceptar', permiso, f.codigoRegistro);
          return aceptarUna(f).then(function (r) {
            fila.set(r.ok ? 'OK' : 'FALLO', r.msg);
            progStep('Aceptando ' + f.codigoRegistro + ' → ' + (r.ok ? 'OK' : 'FALLO'));
          }).catch(function (e) { fila.set('FALLO', e.message); progStep('Aceptando ' + f.codigoRegistro + ' → ERROR'); });
        }).then(function () { return espera(); });
      });
      return seq;
    });
  }

  /* ============ MÓDULO: DESPACHAR ============ */
  function listarDespacho(permiso) {
    return apiPostDatos('/GasLP/Despacho/GetRegistrosComprasDespacho', 'idEstatus=-2')
      .then(function (res) {
        var data = (res.json && res.json.data) || [];
        if (data.length) return data;
        var textoPermiso = String(permiso && (permiso.permiso || permisoDeUrl(permiso.url)) || '').trim().toUpperCase();
        var respaldo = textoPermiso ? despachosFallback.filter(function (compra) {
          return String(compra.permiso_Vendedor || '').trim().toUpperCase() === textoPermiso;
        }) : despachosFallback;
        verboseLog('RESPALDO DESPACHO', { permiso: textoPermiso || 'actual', registros: respaldo.length });
        return respaldo;
      });
  }

  function despacharUna(f) {
    return apiPost('/GasLP/Despacho/VerificaRegistroCompra', 'prefixCodigoRegistro=' + encodeURIComponent(f.codigoRegistro) + '&proceso=2')
      .then(function (v) {
        var j = v.json || {};
        var d = j.data || j;
        var dc = d.datosCompra;
        var ds = d.datosSuministrador;
        if (!dc) throw new Error('VerificaRegistroCompra sin datosCompra');
        var idActComp = pick(dc, [
          'idPermisoActividad_Comprador', 'idPermisoActividadComprador', 'idPermisoActividad',
          'idActComp', 'idActividad', 'idPermisoActividad_Vendedor', 'idPermisoActividadVendedor'
        ]);
        return apiPost('/GasLP/Despacho/VerificaRegistroVehiculo2',
          'vehiculo=' + encodeURIComponent(CONFIG.VEHICULO) +
          '&CompradorId=' + dc.idComprador + '&idActComp=' + encodeURIComponent(idActComp) +
          '&idVendedor=' + dc.idVendedor + '&showIRE=false').then(function (vv) {
            var vvj = vv.json || {};
            var idVehiculo = vvj.idVehiculo || (vvj.datos && vvj.datos.idVehiculo) || (vvj.data && vvj.data.idVehiculo) || (vvj.data && vvj.data.VehiculoId);
            if (!idVehiculo) throw new Error('VerificaRegistroVehiculo2 sin idVehiculo (' + vv.text.slice(0, 120) + ')');
            return { dc: dc, ds: ds, idVehiculo: idVehiculo };
          });
      })
      .then(function (ctx) {
        var dc = ctx.dc;
        var fd = fechaRegistroSQL(toISO(parseDia(f.fechaCompra || dc.fechaCompra)));
        var acuse = acuseDespacho(dc, ctx.ds, {
          fechaRegistro: fd, fechaDespacho: isoToDMA(fd.split(' ')[0]),
          codigo: f.codigoRegistro, volumen: dc.volumen_Solicitado,
          idVehiculo: ctx.idVehiculo, placas: CONFIG.PLACAS
        });
        var body = 'de[fechaRegistro]=' + encodeURIComponent(fd) +
          '&de[FechaDespacho]=' + encodeURIComponent(fd) + '&de[idCompra]=' + dc.idCompra +
          '&de[CantidadDespachada]=' + dc.volumen_Solicitado + '&de[IdVehiculo]=' + ctx.idVehiculo +
          '&de[TransportePlaca]=' + encodeURIComponent(CONFIG.PLACAS) +
          '&CodigoRegistro=' + encodeURIComponent(f.codigoRegistro) +
          '&idComprador=' + dc.idComprador + '&idVendedor=' + dc.idVendedor +
          '&complementoAcuse=' + encodeURIComponent(acuse) + '&regCompraFlete=false';
        return apiPost('/GasLP/Despacho/Guardar_CompraDespacho', body);
      })
      .then(function (res) {
        var j = res.json || {};
        if (j.result === true || j.success === true || j.result === 'true') return { ok: true, msg: '' };
        return { ok: false, msg: (j.mensaje || j.message) || res.text.slice(0, 200) };
      });
  }

  function moduloDespachar(permiso) {
    return listarDespacho(permiso).then(function (data) {
      var pend = data.filter(function (f) {
        var pasa = pasaFiltroPermiso(f) && Number(f.idEstatus) === 1 && enRango(f.fechaCompra);
        verboseLog('FILTRO DESPACHO', { registro: f.codigoRegistro, estatus: f.idEstatus, fecha: f.fechaCompra, permiso: f.permiso_Vendedor, incluido: pasa });
        return pasa;
      });
      progAdd(pend.length);
      progRender('Permiso ' + (permiso ? permiso.id : 'actual') + ': ' + pend.length + ' a despachar de ' + data.length);
      var seq = Promise.resolve();
      pend.forEach(function (f) {
        seq = seq.then(function () {
          if (STOP) return;
          var fila = nuevaFila('Despachar', permiso, f.codigoRegistro);
          return despacharUna(f).then(function (r) {
            fila.set(r.ok ? 'OK' : 'FALLO', r.msg);
            progStep('Despachando ' + f.codigoRegistro + ' → ' + (r.ok ? 'OK' : 'FALLO'));
          }).catch(function (e) { fila.set('FALLO', e.message); progStep('Despachando ' + f.codigoRegistro + ' → ERROR'); });
        }).then(function () { return espera(); });
      });
      return seq;
    });
  }

  /* ============ MÓDULO: RECEPCIONAR ============ */
  function listarRecepcion() {
    return apiPostDatos('/GasLP/Recepcion/GetListaDespachoRecepcion', 'idEstatus=-2')
      .then(function (res) { return (res.json && res.json.data) || []; });
  }

  function recepcionarUna(it) {
    return apiPost('/GasLP/Recepcion/AceptarRecepcion', 'idEntrega=' + it.idEntrega + '&CodigoRegistro=' + encodeURIComponent(it.codigoRegistro))
      .then(function (det) {
        var h = det.text;
        var volumen = matchInput(h, 'idVolumenCompra') || it.cantidadDespachada || '';
        var placas = matchInput(h, 'idPlacas') || CONFIG.PLACAS;
        var idVehiculo = matchInput(h, 'idVehiculo') || it.idVehiculo || '';
        var numReg = matchInput(h, 'idNoRegistroCompra') || it.codigoRegistro;
        var fd = matchInput(h, 'fecha-despacho') || it.fechaDespacho;
        var fdISO = toISO(parseDia(fd));
        var fechaReg = fechaRegistroRecepcionSQL(fdISO);
        var acuse = acuseRecepcion({
          permC: matchText(h, 'datos-comprador-permiso'), rsC: matchText(h, 'datos-comprador-razon-social'),
          dirC: matchText(h, 'datos-comprador-direccion'), permS: matchText(h, 'datos-suministrador-permiso'),
          rsS: matchText(h, 'datos-suministrador-razon-social'), dirS: matchText(h, 'datos-suministrador-direccion'),
          fechaRegistro: fechaReg, fechaRecepcion: isoToDMA(fdISO), numReg: numReg,
          volumen: volumen, idVehiculo: idVehiculo, placas: placas
        });
        var body = 'idBodega=-1&idEntrega=' + it.idEntrega + '&FechaRegistro=' + encodeURIComponent(fechaReg) +
          '&CostoFlete=*' + '&CantidadRecibida=' + encodeURIComponent(volumen) +
          '&CodigoRegistro=' + encodeURIComponent(it.codigoRegistro) + '&idComprador=' + it.idComprador +
          '&idVendedor=' + it.idVendedor + '&dataAcuse=' + encodeURIComponent(acuse);
        return apiPost('/GasLP/Recepcion/Guardar_AceptarRecepcionRegistroDespacho', body)
          .then(function (res) {
            var j = res.json || {};
            if (j.result !== true) {
              return { ok: false, msg: (j.mensaje || j.message) || res.text.slice(0, 200), idCompra: j.idCompra };
            }
            var idCompra = String(j.idCompra || '').replace(/^"+|"+$/g, '').trim();
            if (idCompra && idCompra !== '0') {
              return { ok: true, msg: '', idCompra: idCompra, idEntrega: it.idEntrega, codigo: it.codigoRegistro };
            }
            return apiPost('/GasLP/Despacho/VerificaRegistroCompra',
              'prefixCodigoRegistro=' + encodeURIComponent(it.codigoRegistro) + '&proceso=2')
              .then(function (verificacion) {
                var datos = verificacion.json && verificacion.json.datosCompra;
                var recuperado = datos && datos.idCompra ? String(datos.idCompra) : '';
                return { ok: true, msg: '', idCompra: recuperado || null, idEntrega: it.idEntrega, codigo: it.codigoRegistro };
              });
          });
      });
  }

  function moduloRecepcionar(permiso) {
    return listarRecepcion().then(function (data) {
      var pend = data.filter(function (it) {
        var pasa = pasaFiltroPermiso(it) && Number(it.idEstatus) === 4 && enRango(it.fechaDespacho);
        verboseLog('FILTRO RECEPCION', { registro: it.codigoRegistro, entrega: it.idEntrega, estatus: it.idEstatus, fecha: it.fechaDespacho, permiso: it.permiso_Vendedor, incluido: pasa });
        return pasa;
      });
      progAdd(pend.length);
      progRender('Permiso ' + (permiso ? permiso.id : 'actual') + ': ' + pend.length + ' a recepcionar de ' + data.length);
      var seq = Promise.resolve();
      pend.forEach(function (it) {
        seq = seq.then(function () {
          if (STOP) return;
          var fila = nuevaFila('Recepcionar', permiso, it.codigoRegistro);
          return recepcionarUna(it).then(function (r) {
            if (r.ok && CONFIG.CERRAR_AL_RECEPCIONAR && r.idCompra) {
              return cerrarEntrega({ idEntrega: r.idEntrega, codigo: r.codigo, idCompra: r.idCompra, base: '/GasLP/Recepcion/PaginaConfirmacion' }).then(function (c) {
                fila.set('OK', r.msg + ' · cierre: ' + (c.ok ? 'OK' : 'FALLO ' + c.detalle));
                progStep('Recepcionando ' + it.codigoRegistro + ' → OK · cierre ' + (c.ok ? 'OK' : 'FALLO'));
              });
            }
            if (r.ok && CONFIG.CERRAR_AL_RECEPCIONAR && !r.idCompra) {
              fila.set('OK', r.msg + ' · sin idCompra en respuesta, usar pestaña Cerrar');
              progStep('Recepcionando ' + it.codigoRegistro + ' → OK · cierre pendiente');
              return;
            }
            fila.set(r.ok ? 'OK' : 'FALLO', r.msg);
            progStep('Recepcionando ' + it.codigoRegistro + ' → ' + (r.ok ? 'OK' : 'FALLO'));
          }).catch(function (e) { fila.set('FALLO', e.message); progStep('Recepcionando ' + it.codigoRegistro + ' → ERROR'); });
        }).then(function () { return espera(); });
      });
      return seq;
    });
  }

  /* ============ MÓDULO: LISTAR TODO ============ */
  function moduloListarTodo(permiso) {
    return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-1').then(function (res) {
      var data = (res.json && res.json.data) || [];
      actualizarFiltroPermisos(data);
      var cand = data.filter(function (c) { return pasaFiltroPermiso(c) && c.idEstatus !== 4 && c.estatus !== 'Rechazada' && enRango(c.fechaCompra); });
      progAdd(cand.length);
      cand.forEach(function (c) { agregarCandidato(c, permiso); progStep(c.codigoRegistro + ' · ' + (c.estatus || c.idEstatus)); });
      progRender(cand.length ? cand.length + ' compra' + (cand.length > 1 ? 's' : '') + ' en rango.' : 'Sin resultados.');
    }).catch(function (e) { progRender('ERROR: ' + e.message); });
  }

  /* ============ MÓDULO: FACTURAS ============ */
  function listarNodosFacturasTraspaso() {
    return getJsonDatos('/GasLP/Facturas/GetNodosDespachosSinFactura?traspaso=true');
  }

  function agregarFacturaCandidata(compra, permiso, referencia) {
    for (var i = 0; i < facturasCandidatas.length; i++) {
      if (String(facturasCandidatas[i].compra.idCompra) === String(compra.idCompra)) return i;
    }
    facturasCandidatas.push({ compra: compra, permisoUrl: permiso ? permiso.url : null, referencia: referencia });
    var idx = facturasCandidatas.length - 1;
    var tr = document.createElement('tr');
    tr.className = 'acs-factura-row';
    tr.innerHTML = '<td><input type="checkbox" checked class="acs-factura-check" data-idx="' + idx + '"></td>' +
      '<td>' + compra.codigoRegistro + '</td><td>' + (compra.estatus || compra.idEstatus) + '</td>' +
      '<td>' + (compra.volumen_Solicitado || '?') + ' / ' + (compra.volumen_Entregado || '?') + '</td>' +
      '<td>' + (compra.fechaCompra || '') + '</td><td>' + (compra.permiso_Vendedor || '') + '</td>';
    document.querySelector('#et-acs-tabla tbody').appendChild(tr);
    actualizarResumen();
    return idx;
  }

  function moduloFacturas(permiso) {
    return fetch('/GasLP/Compras/Index', { credentials: 'same-origin' }).then(function () {
      return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-1');
    }).then(function (res) {
      var data = (res.json && res.json.data) || [];
      return fetch('/GasLP/Facturas/Index', { credentials: 'same-origin' }).then(function () {
        return listarNodosFacturasTraspaso();
      }).then(function (nodos) {
        actualizarFiltroPermisos(data);
        data.filter(function (c) {
          var cerrada = c.idEstatus === 2 || String(c.fechaCierre || '').trim() !== '';
          return pasaFiltroPermiso(c) && cerrada && c.idEstatus !== 4 && c.estatus !== 'Rechazada' && enRango(c.fechaCompra);
        }).forEach(function (c) {
          var ref = buscarNodoFactura(c, nodos);
          if (ref) agregarFacturaCandidata(c, permiso, ref);
        });
        progRender('Facturas: ' + facturasCandidatas.length + ' traspaso(s) pendiente(s).');
      });
    }).catch(function (e) { progRender('ERROR: ' + e.message); });
  }

  function escanearFacturas() {
    STOP = false; limpiarTabla(); facturasCandidatas = []; progReset();
    progRender('Buscando traspasos cerrados sin factura...');
    return obtenerPermisos().then(function (perms) {
      if (!perms.length) return moduloFacturas(null);
      var seq = Promise.resolve();
      perms.forEach(function (p) {
        seq = seq.then(function () {
          if (STOP) return;
          progRender('Facturas · permiso ' + p.id + '...');
          return cambiarPermiso(p).then(function () { return moduloFacturas(p); });
        });
      });
      return seq;
    });
  }

  function descargarFormatosRango() {
    STOP = false; limpiarTabla(); facturasCandidatas = []; progReset();
    var okCount = 0;
    progRender('Buscando compras del ' + CONFIG.DESDE + ' al ' + CONFIG.HASTA + '...');

    function moduloDescarga(permiso) {
      return fetch('/GasLP/Compras/Index', { credentials: 'same-origin' }).then(function () {
        return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-1');
      }).then(function (res) {
        var data = (res.json && res.json.data) || [];
        actualizarFiltroPermisos(data);
        var cand = data.filter(function (c) {
          if (!pasaFiltroPermiso(c) || !enRango(c.fechaCompra)) return false;
          if (c.estatus === 'Rechazada') return false;
          if (CONFIG.INCLUIR_NO_CERRADAS_FACT) return true;
          return Number(c.idEstatus) === 2 || String(c.fechaCierre || '').trim() !== '';
        });
        progAdd(cand.length);
        var seq = Promise.resolve();
        cand.forEach(function (c) {
          seq = seq.then(function () {
            if (STOP) return;
            var idx = agregarFacturaCandidata(c, permiso);
            progRender('Generando formato · ' + c.codigoRegistro + '...');
            var ok = false;
            try { ok = descargarFormato(c) !== false; } catch (e) { verboseLog('ERROR FORMATO', { registro: c.codigoRegistro, error: e.message }); }
            marcarFilaFactura(idx, ok);
            if (ok) okCount++;
            progStep((ok ? 'PDF guardado · ' : 'FALLO PDF · ') + c.codigoRegistro);
          }).then(espera);
        });
        return seq;
      }).catch(function (e) { verboseLog('ERROR MODULO DESCARGA', { error: e.message }); progRender('ERROR: ' + e.message); });
    }

    return obtenerPermisos().then(function (perms) {
      if (!perms.length) return moduloDescarga(null);
      var seq = Promise.resolve();
      perms.forEach(function (p) {
        seq = seq.then(function () {
          if (STOP) return;
          progRender('── Permiso ' + p.id + ' ──');
          return cambiarPermiso(p).then(function () { return moduloDescarga(p); });
        });
      });
      return seq;
    }).then(function () {
      if (!STOP) progRender('✔ Descarga terminada · ' + okCount + ' formato(s) guardado(s).');
    });
  }

  function subirFacturasSeleccionadas() {
    var checks = Array.prototype.slice.call(document.querySelectorAll('.acs-factura-check:checked'));
    if (!checks.length) { progRender('Selecciona traspasos para subir.'); return Promise.resolve(); }
    progReset(); progAdd(checks.length);
    var seq = Promise.resolve();
    checks.forEach(function (ch) {
      seq = seq.then(function () {
        if (STOP) return;
        var item = facturasCandidatas[+ch.dataset.idx];
        if (!item) { progStep('Registro no disponible'); return; }
        var cambiar = item.permisoUrl ? cambiarPermiso({ url: item.permisoUrl }) : Promise.resolve();
        return cambiar.then(function () {
          progRender('Subiendo ' + item.compra.codigoRegistro + '...');
          return subirFormatoTraspaso(item.compra);
        }).then(function () {
          ch.checked = false; ch.disabled = true;
          ch.closest('tr').classList.add('acs-factura-ok');
          progStep('Traspaso subido · ' + item.compra.codigoRegistro);
        }).catch(function (e) { progStep('FALLO · ' + item.compra.codigoRegistro + (e.message ? ' · ' + e.message : '')); });
      }).then(espera);
    });
    return seq;
  }

  /* ============ MÓDULO: CERRAR ============ */
  function moduloCerrar(permiso) {
    return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-2').then(function (res) {
      var data = (res.json && res.json.data) || [];
      actualizarFiltroPermisos(data);
      var cand = data.filter(function (c) {
        var aceptada = Number(c.idEstatus) === 1 || c.estatus === 'Aceptada';
        var sinCierre = !c.fechaCierre;
        return pasaFiltroPermiso(c) && aceptada && sinCierre && enRango(c.fechaCompra);
      });
      progAdd(cand.length);
      cand.forEach(function (c) { agregarCandidato(c, permiso); progStep('Compra del dia ' + c.fechaCompra); });
      progRender(cand.length ? 'Compra del dia ' + cand[0].fechaCompra + ' · ' + cand.length + ' pendiente' + (cand.length > 1 ? 's' : '') : 'Sin compras sin cerrar.');
    }).catch(function (e) { progRender('ERROR: ' + e.message); });
  }

  function agregarCandidato(c, permiso) {
    if (candidatos.some(function (x) { return x.idCompra === c.idCompra; })) return;
    candidatos.push({ compra: c, idCompra: c.idCompra, permisoUrl: permiso ? permiso.url : null });
    var estatusTxt = c.estatus || (Number(c.idEstatus) === 1 ? 'Aceptada' : Number(c.idEstatus) === 0 ? 'Solicitada' : String(c.idEstatus));
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="checkbox" checked class="acs-cand-check" data-idx="' + (candidatos.length - 1) + '"></td>' +
      '<td>' + c.codigoRegistro + '</td><td>' + estatusTxt + '</td>' +
      '<td>' + (c.volumen_Solicitado || '?') + ' / ' + (c.volumen_Entregado || '?') + '</td>' +
      '<td>' + (c.fechaCompra || '') + '</td><td>' + (c.permiso_Vendedor || '') + '</td>';
    document.querySelector('#et-acs-tabla tbody').appendChild(tr);
    actualizarResumen();
  }

  function cerrarSeleccionadas() {
    var checks = Array.prototype.slice.call(document.querySelectorAll('.acs-cand-check:checked'));
    if (!checks.length) { progRender('Selecciona compras para cerrar.'); return Promise.resolve(); }
    progReset(); progAdd(checks.length);
    var seq = Promise.resolve();
    checks.forEach(function (ch) {
      seq = seq.then(function () {
        if (STOP) return;
        var c = candidatos[+ch.dataset.idx];
        if (!c || !c.idCompra) { progStep('sin idCompra'); return; }
        var pre = c.permisoUrl ? cambiarPermiso({ url: c.permisoUrl }) : Promise.resolve();
        return pre.then(function () {
          progRender('Cerrando ' + c.compra.codigoRegistro + '...');
          return cerrarCompraManual({ idCompra: c.idCompra, codigo: c.compra.codigoRegistro });
        }).then(function (r) {
          if (r.ok) {
            try { descargarFormato(c.compra); } catch (e) {}
            return subirFormatoTraspaso(c.compra).then(function () {
              progStep('Cerrada + PDF + traspaso subido · ' + c.compra.codigoRegistro);
            }, function () { progStep('Cerrada + PDF; traspaso pendiente · ' + c.compra.codigoRegistro); });
          } else {
            filaSetFallo(ch, r.msg);
            progStep('FALLO cierre · ' + c.compra.codigoRegistro);
          }
        }).catch(function (e) { filaSetFallo(ch, e.message); progStep('ERROR cierre · ' + c.compra.codigoRegistro); });
      }).then(espera);
    });
    return seq;
  }

  /* ============ UI: SIDEBAR ============ */
  function nuevaFila(accion, permiso, codigo) {
    var tr = document.createElement('tr');
    var permisoText = permiso ? (permiso.permiso || permiso.id || '') : '';
    tr.innerHTML = '<td>' + accion + '</td><td>' + (permisoText || '?') + '</td><td class="et-codigo">' + codigo + '</td><td class="et-estado">pendiente</td>';
    document.querySelector('#et-acs-tabla tbody').appendChild(tr);
    actualizarResumen();
    return {
      set: function (estado, msg) {
        var td = tr.querySelectorAll('td');
        if (td[3]) { td[3].textContent = estado; td[3].className = 'et-estado et-' + (estado === 'OK' ? 'ok' : 'fail'); }
        if (td[4]) td[4].textContent = msg ? msg.slice(0, 80) : '';
        actualizarResumen();
      }
    };
  }

  function espera() { return new Promise(function (r) { setTimeout(r, Number(CONFIG.DELAY_MS) || 800); }); }

  function fechaRegistroSQL(fdISO) { return fdISO + ' ' + ahoraHora(); }
  function fechaRegistroRecepcionSQL(fdISO) { return fdISO + ' ' + ahoraHora(); }

  function actualizarFiltroPermisos(data) {
    var select = document.querySelector('#acs-permiso');
    if (!select) return;
    var actual = CONFIG.PERMISO_FILTRO || select.value || '';
    var vistos = {};
    (data || []).forEach(function (c) {
      var permiso = String(c.permiso_Vendedor || '').trim();
      if (permiso) vistos[permiso] = true;
    });
    select.innerHTML = '<option value="">Todos</option>';
    Object.keys(vistos).sort().forEach(function (permiso) {
      var option = document.createElement('option');
      option.value = permiso; option.textContent = permiso;
      select.appendChild(option);
    });
    select.value = actual;
    if (select.value !== actual) { CONFIG.PERMISO_FILTRO = ''; guardarConfig(); }
  }

  function limpiarTabla() {
    var tb = document.querySelector('#et-acs-tabla tbody');
    if (tb) tb.innerHTML = '';
    progReset();
  }

  function marcarFilaFactura(idx, ok) {
    var ch = document.querySelector('.acs-factura-check[data-idx="' + idx + '"]');
    if (!ch) return;
    ch.checked = false; ch.disabled = true;
    var tr = ch.closest('tr');
    if (tr) tr.classList.add(ok ? 'acs-factura-ok' : 'acs-fail');
  }

  function filaSetFallo(ch, msg) {
    ch.checked = false; ch.disabled = true;
    var tr = ch.closest('tr');
    if (tr) tr.classList.add('acs-fail');
  }

  /* ============ UI: CREAR SIDEBAR ============ */
  function crearSidebar() {
    if (document.getElementById('et-acs-sidebar')) return;

    var sidebar = document.createElement('div');
    sidebar.id = 'et-acs-sidebar';
    sidebar.innerHTML =
      '<div class="et-acs-cab"><span>ACS EASYTRAC</span><button id="et-acs-cerrar">&times;</button></div>' +
      '<div class="et-acs-tabs">' +
        '<button class="et-acs-tab et-active" data-tab="inicio">Inicio</button>' +
        '<button class="et-acs-tab" data-tab="aceptar">Aceptar</button>' +
        '<button class="et-acs-tab" data-tab="despachar">Despachar</button>' +
        '<button class="et-acs-tab" data-tab="recepcionar">Recepcionar</button>' +
        '<button class="et-acs-tab" data-tab="cerrar">Cerrar</button>' +
        '<button class="et-acs-tab" data-tab="facturas">Facturas</button>' +
      '</div>' +
      '<div class="et-acs-body" id="et-acs-body"></div>' +
      '<div style="padding:4px 8px;border-top:1px solid #ccc;font-size:11px;background:#fff;">' +
        '<span id="et-acs-status">Listo</span> · <span id="et-acs-prog-text">0 / 0</span>' +
        '<div style="background:#ddd;height:4px;border-radius:2px;margin-top:2px;"><div id="et-acs-bar-fill" style="background:#2EA836;height:100%;width:0%;transition:width .3s;"></div></div>' +
      '</div>';
    document.body.appendChild(sidebar);

    // tabs
    sidebar.querySelectorAll('.et-acs-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        sidebar.querySelectorAll('.et-acs-tab').forEach(function (t) { t.classList.remove('et-active'); });
        tab.classList.add('et-active');
        var tabName = tab.dataset.tab;
        UI_STATE.tab = tabName;
        guardarUI();
        mostrarTab(tabName);
      });
    });

    // cerrar
    document.getElementById('et-acs-cerrar').addEventListener('click', function () {
      sidebar.classList.remove('et-visible');
      UI_STATE.min = true;
      guardarUI();
    });

    // boton flotante para abrir
    var openBtn = document.createElement('button');
    openBtn.id = 'et-acs-open';
    openBtn.textContent = 'ACS';
    openBtn.title = 'Abrir panel ACS';
    openBtn.style.cssText = 'position:fixed;right:16px;bottom:60px;z-index:2147483646;' +
      'background:#1d3557;color:#fff;border:none;border-radius:20px;padding:6px 12px;' +
      'font:bold 12px Arial,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);';
    openBtn.addEventListener('click', function () {
      sidebar.classList.toggle('et-visible');
      UI_STATE.min = !sidebar.classList.contains('et-visible');
      guardarUI();
    });
    document.body.appendChild(openBtn);

    // restaurar tab
    mostrarTab(UI_STATE.tab || 'inicio');
  }

  function mostrarTab(tabName) {
    var body = document.getElementById('et-acs-body');
    if (!body) return;

    // limpiar
    body.innerHTML = '';

    if (tabName === 'inicio') {
      body.innerHTML =
        '<div class="et-acs-row"><label>Desde</label><input id="et-acs-desde" value="' + ET.utils.esc(CONFIG.DESDE) + '"></div>' +
        '<div class="et-acs-row"><label>Hasta</label><input id="et-acs-hasta" value="' + ET.utils.esc(CONFIG.HASTA) + '"></div>' +
        '<div class="et-acs-row"><label>Vehículo</label><input id="et-acs-vehiculo" value="' + ET.utils.esc(CONFIG.VEHICULO) + '"></div>' +
        '<div class="et-acs-row"><label>Placas</label><input id="et-acs-placas" value="' + ET.utils.esc(CONFIG.PLACAS) + '"></div>' +
        '<div class="et-acs-row"><label>Delay (ms)</label><input id="et-acs-delay" value="' + (CONFIG.DELAY_MS || 800) + '" type="number"></div>' +
        '<div class="et-acs-row"><label>Permiso filtro</label><input id="et-acs-permiso" value="' + ET.utils.esc(CONFIG.PERMISO_FILTRO) + '" placeholder="vacío=todos"></div>' +
        '<div class="et-acs-row"><label>Motivo cierre</label><input id="et-acs-motivo" value="' + ET.utils.esc(CONFIG.MOTIVO_CIERRE) + '" placeholder=">=5 caracteres"></div>' +
        '<div class="et-acs-row"><label><input type="checkbox" id="et-acs-cerrar-rec" ' + (CONFIG.CERRAR_AL_RECEPCIONAR ? 'checked' : '') + '> Cerrar al recepcionar</label></div>' +
        '<div class="et-acs-row"><label><input type="checkbox" id="et-acs-incluir-nc" ' + (CONFIG.INCLUIR_NO_CERRADAS_FACT ? 'checked' : '') + '> Incluir no cerradas (fact)</label></div>' +
        '<button class="et-acs-btn" id="et-acs-btn-aceptar">Aceptar</button>' +
        '<button class="et-acs-btn" id="et-acs-btn-despachar">Despachar</button>' +
        '<button class="et-acs-btn" id="et-acs-btn-recepcionar">Recepcionar</button>' +
        '<button class="et-acs-btn" id="et-acs-btn-cerrar">Cerrar</button>' +
        '<button class="et-acs-btn" id="et-acs-btn-facturas">Facturas</button>' +
        '<button class="et-acs-btn" id="et-acs-btn-descargar">Descargar formatos</button>' +
        '<button class="et-acs-btn" id="et-acs-btn-subir">Subir seleccionadas</button>' +
        '<button class="et-acs-btn" id="et-acs-btn-parar" style="background:#C60C0E;">Parar</button>' +
        '<div id="et-acs-summary" class="et-acs-summary"></div>';

      // eventos
      document.getElementById('et-acs-btn-aceptar').addEventListener('click', function () {
        CONFIG.DESDE = document.getElementById('et-acs-desde').value;
        CONFIG.HASTA = document.getElementById('et-acs-hasta').value;
        CONFIG.VEHICULO = document.getElementById('et-acs-vehiculo').value;
        CONFIG.PLACAS = document.getElementById('et-acs-placas').value;
        CONFIG.DELAY_MS = parseInt(document.getElementById('et-acs-delay').value) || 800;
        CONFIG.PERMISO_FILTRO = document.getElementById('et-acs-permiso').value;
        CONFIG.MOTIVO_CIERRE = document.getElementById('et-acs-motivo').value;
        CONFIG.CERRAR_AL_RECEPCIONAR = document.getElementById('et-acs-cerrar-rec').checked;
        CONFIG.INCLUIR_NO_CERRADAS_FACT = document.getElementById('et-acs-incluir-nc').checked;
        guardarConfig();
        STOP = false; candidatos = []; facturasCandidatas = [];
        moduloAceptar(null);
      });
      document.getElementById('et-acs-btn-despachar').addEventListener('click', function () {
        CONFIG.DESDE = document.getElementById('et-acs-desde').value;
        CONFIG.HASTA = document.getElementById('et-acs-hasta').value;
        CONFIG.VEHICULO = document.getElementById('et-acs-vehiculo').value;
        CONFIG.PLACAS = document.getElementById('et-acs-placas').value;
        CONFIG.DELAY_MS = parseInt(document.getElementById('et-acs-delay').value) || 800;
        CONFIG.PERMISO_FILTRO = document.getElementById('et-acs-permiso').value;
        guardarConfig(); STOP = false; candidatos = []; facturasCandidatas = [];
        moduloDespachar(null);
      });
      document.getElementById('et-acs-btn-recepcionar').addEventListener('click', function () {
        CONFIG.DELAY_MS = parseInt(document.getElementById('et-acs-delay').value) || 800;
        CONFIG.PERMISO_FILTRO = document.getElementById('et-acs-permiso').value;
        guardarConfig(); STOP = false;
        moduloRecepcionar(null);
      });
      document.getElementById('et-acs-btn-cerrar').addEventListener('click', function () {
        CONFIG.DELAY_MS = parseInt(document.getElementById('et-acs-delay').value) || 800;
        CONFIG.PERMISO_FILTRO = document.getElementById('et-acs-permiso').value;
        guardarConfig(); STOP = false; candidatos = [];
        moduloCerrar(null);
      });
      document.getElementById('et-acs-btn-facturas').addEventListener('click', function () {
        CONFIG.DELAY_MS = parseInt(document.getElementById('et-acs-delay').value) || 800;
        CONFIG.PERMISO_FILTRO = document.getElementById('et-acs-permiso').value;
        CONFIG.INCLUIR_NO_CERRADAS_FACT = document.getElementById('et-acs-incluir-nc').checked;
        guardarConfig(); STOP = false; facturasCandidatas = [];
        escanearFacturas();
      });
      document.getElementById('et-acs-btn-descargar').addEventListener('click', function () {
        CONFIG.INCLUIR_NO_CERRADAS_FACT = document.getElementById('et-acs-incluir-nc').checked;
        guardarConfig(); STOP = false; facturasCandidatas = [];
        descargarFormatosRango();
      });
      document.getElementById('et-acs-btn-subir').addEventListener('click', function () {
        subirFacturasSeleccionadas();
      });
      document.getElementById('et-acs-btn-parar').addEventListener('click', function () {
        STOP = true;
        progRender('⛔ PARADO');
      });
    }
  }

  /* ============ INIT / DESTROY ============ */
  function init(et) {
    cargarConfig();
    cargarUI();
    ET.style(css);
    crearSidebar();
    ET.utils.verboseLog('acs', { version: '3.4.0', status: 'init' });
  }

  function destroy() {
    STOP = true;
    var sidebar = document.getElementById('et-acs-sidebar');
    if (sidebar && sidebar.parentNode) sidebar.parentNode.removeChild(sidebar);
    var openBtn = document.getElementById('et-acs-open');
    if (openBtn && openBtn.parentNode) openBtn.parentNode.removeChild(openBtn);
  }

  /* ============ REGISTRAR ============ */
  ET.register({
    name: 'acs',
    version: '3.4.0',
    init: init,
    destroy: destroy,
    css: css,
    api: {
      listarAceptar: listarAceptar,
      moduloAceptar: moduloAceptar,
      listarDespacho: listarDespacho,
      moduloDespachar: moduloDespachar,
      listarRecepcion: listarRecepcion,
      moduloRecepcionar: moduloRecepcionar,
      moduloListarTodo: moduloListarTodo,
      escanearFacturas: escanearFacturas,
      descargarFormatosRango: descargarFormatosRango,
      subirFacturasSeleccionadas: subirFacturasSeleccionadas,
      moduloCerrar: moduloCerrar,
      cerrarSeleccionadas: cerrarSeleccionadas,
      detener: detener,
      getConfig: function () { return CONFIG; },
      setConfig: function (cfg) { Object.assign(CONFIG, cfg); guardarConfig(); }
    }
  });

})(window.ET);
