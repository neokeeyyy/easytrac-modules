// ==UserScript==
// @name         ACS
// @namespace    siretrac.compras.acs
// @version      3.4.0
// @description  Sidebar derecha estilo SIRETRAC para aceptar, despachar, recepcionar y cerrar compras de GasLP usando la sesiÃ³n del navegador.
// @author       ojuel
// @match        https://siretrac.cne.gob.mx/*
// @match        http://siretrac.cne.gob.mx/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_download
// @require      https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ============ CONFIGURACIÃ“N ============ */
  var DEFAULTS = {
    DESDE: '2026-08-10',        // rango de fechaCompra (Aceptar/Despachar) y fechaDespacho (Recepcionar)
    HASTA: '2026-08-16',
    VEHICULO: 'A002252',        // vehÃ­culo que despacha (Despachar)
    PLACAS: 'JU47194',          // placa del vehÃ­culo (Despachar)
    DELAY_MS: 800,              // espera entre operaciones
    DATA_RETRIES: 3,            // reintentos solo para consultas
    DATA_RETRY_BASE_MS: 100,    // backoff inicial de consultas
    CERRAR_AL_RECEPCIONAR: true,// cierra la compra (EsCierre, Destino=13) al recepcionar
    RECORRER_PERMISOS: true,    // recorre todos los permisos de la sesiÃ³n (si los descubre)
    PERMISOS: [],               // [] = descubrir del sitio; o forzar: [1295,2846,3076,3369,3920,4171,4201,4334,5621]
    PERMISO_FILTRO: '',         // permiso vendedor especÃ­fico; vacÃ­o = todos
    MOTIVO_CIERRE: '',           // motivo de cierre (>=5 caracteres) si la compra lo exige (Cerrar manual)
    INCLUIR_NO_CERRADAS_FACT: false, // Facturas: incluir compras de cualquier estatus, no solo cerradas
    VERBOSE: true                // diagnÃ³stico detallado en consola y estado del panel
  };

  var CONFIG = {};

  function cargarConfig() {
    try { CONFIG = Object.assign({}, DEFAULTS, JSON.parse(GM_getValue('acs_cfg', '{}'))); }
    catch (e) { CONFIG = Object.assign({}, DEFAULTS); }
  }
  function guardarConfig() { GM_setValue('acs_cfg', JSON.stringify(CONFIG)); }

  /* Estado de la UI (colapsada + pestaÃ±a activa), persistido entre navegaciones */
  var UI_STATE = { min: false, tab: 'inicio' };
  function cargarUI() {
    try { UI_STATE = Object.assign({ min: false, tab: 'inicio' }, JSON.parse(GM_getValue('acs_ui', '{}'))); }
    catch (e) { UI_STATE = { min: false, tab: 'inicio' }; }
  }
  function guardarUI() { GM_setValue('acs_ui', JSON.stringify(UI_STATE)); }

  function verboseLog(tipo, datos) {
    if (!CONFIG.VERBOSE) return;
    var prefijo = '[ACS][' + tipo + ']';
    try {
      console.log(prefijo + ' ' + JSON.stringify(datos, null, 2));
    } catch (e) {
      console.log(prefijo, datos);
    }
  }

  function textoRespuesta(res) {
    return String(res && res.text || '').replace(/\s+/g, ' ').slice(0, 1200);
  }

  /* ============ HELPERS DE FECHA ============ */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function isoToDMA(iso) { var p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function parseDia(s) { var p = String(s).split('/'); return new Date(+p[2], +p[1] - 1, +p[0]); }
  function parseISO(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function ahoraHora() { var d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
  function enRango(fechaDMA) {
    try { var fc = parseDia(fechaDMA); return fc >= parseISO(CONFIG.DESDE) && fc <= parseISO(CONFIG.HASTA); }
    catch (e) { return false; }
  }
  function pasaFiltroPermiso(compra) {
    if (CONFIG.PERMISO_FILTRO && String(compra && compra.permiso_Vendedor || '').trim() !== String(CONFIG.PERMISO_FILTRO).trim()) return false;
    return true;
  }
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
      option.value = permiso;
      option.textContent = permiso;
      select.appendChild(option);
    });
    select.value = actual;
    if (select.value !== actual) {
      CONFIG.PERMISO_FILTRO = '';
      guardarConfig();
    }
  }
  function fechaRegistroSQL(fdISO) {
    return fdISO + ' ' + ahoraHora();
  }
  function fechaRegistroRecepcionSQL(fdISO) {
    return fdISO + ' ' + ahoraHora();
  }

  /* ============ FETCH ============ */
  var HDRS = { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };

  function esperarMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function apiPost(url, body) {
    verboseLog('POST', { url: url, body: body });
    return fetch(url, { method: 'POST', headers: HDRS, body: body, credentials: 'same-origin' })
      .then(function (r) {
        return r.text().then(function (txt) {
          var j = null; try { j = JSON.parse(txt); } catch (e) {}
          var res = { status: r.status, text: txt, json: j };
          verboseLog('RESPUESTA', { url: url, status: r.status, json: j, text: textoRespuesta(res) });
          return res;
        });
      }).catch(function (e) {
        verboseLog('ERROR', { url: url, error: e.message });
        throw e;
      });
  }

  var HDRS_PLAIN = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };

  function apiPostPlain(url, body) {
    verboseLog('POST PLAIN', { url: url, body: body });
    return fetch(url, { method: 'POST', headers: HDRS_PLAIN, body: body, credentials: 'same-origin' })
      .then(function (r) {
        return r.text().then(function (txt) {
          var j = null; try { j = JSON.parse(txt); } catch (e) {}
          var res = { status: r.status, text: txt, json: j };
          verboseLog('RESPUESTA PLAIN', { url: url, status: r.status, json: j, text: textoRespuesta(res) });
          return res;
        });
      }).catch(function (e) {
        verboseLog('ERROR PLAIN', { url: url, error: e.message });
        throw e;
      });
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
            var res = { status: r.status, text: txt, json: json };
            verboseLog('RESPUESTA GET', { url: url, status: r.status, json: json, text: textoRespuesta(res) });
            if (intento < max && respuestaReintentable(res)) {
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

  /* ============ ESTADO / PROGRESO ============ */
  var STOP = false;
  var filas = [];
  var PROG = { total: 0, hecho: 0 };

  function detener() { STOP = true; }

  function progReset() { PROG = { total: 0, hecho: 0 }; progRender(''); }
  function progAdd(n) { PROG.total += (n || 0); progRender(''); }
  function progStep(msg) { PROG.hecho++; progRender(msg); }
  function progRender(msg) {
    var bar = document.getElementById('acs-bar-fill');
    var text = document.getElementById('acs-prog-text');
    var status = document.getElementById('acs-status');
    var pct = PROG.total ? Math.min(100, Math.round(PROG.hecho * 100 / PROG.total)) : 0;
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = PROG.hecho + ' / ' + PROG.total;
    if (status && msg) status.textContent = msg;
  }
  function actualizarResumen() {
    var summary = document.querySelector('#acs-summary');
    if (!summary) return;
    var rows = document.querySelectorAll('#acs-tabla tbody tr').length;
    var selected = document.querySelectorAll('#acs-tabla tbody input[type="checkbox"]:checked').length;
    summary.textContent = rows + ' visibles Â· ' + selected + ' seleccionadas';
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
      '|RazÃ³n Social Comprador=' + pick(dc, ['razonSocial_Comprador', 'razonSocialComprador', 'razonSocial']) +
      '|DirecciÃ³n Comprador=' + pick(dc, ['direccion_Comprador', 'direccionComprador', 'direccion']) +
      '|Permiso Suministrador=' + pick(ds, ['permiso_Vendedor', 'permisoVendedor', 'permiso']) +
      '|RazÃ³n Social Suministrador=' + pick(ds, ['razonSocial_Vendedor', 'razonSocialVendedor', 'razonSocial']) +
      '|DirecciÃ³n Suministrador=' + pick(ds, ['direccion_Vendedor', 'direccionVendedor', 'direccion']) +
      '|Representante legal=|RFC Representante legal=' +
      '|Fecha Registro=' + opt.fechaRegistro +
      '|Fecha de Despacho=' + opt.fechaDespacho +
      '|NÃºmero de Registro de Compra=' + opt.codigo +
      '|Volumen=' + opt.volumen +
      '|ID de VehÃ­culo=' + opt.idVehiculo +
      '|Placas=' + opt.placas;
  }

  function acuseRecepcion(o) {
    return '|Permiso Comprador=' + o.permC +
      '|RazÃ³n Social Comprador=' + o.rsC +
      '|DirecciÃ³n Comprador=' + o.dirC +
      '|Permiso Suministrador=' + o.permS +
      '|RazÃ³n Social Suministrador=' + o.rsS +
      '|DirecciÃ³n Suministrador=' + o.dirS +
      '|Representante legal=|RFC Representante legal=' +
      '|Fecha Registro=' + o.fechaRegistro +
      '|Fecha de RecepciÃ³n=' + o.fechaRecepcion +
      '|NÃºmero de Registro de Compra=' + o.numReg +
      '|Volumen=' + o.volumen +
      '|ID de VehÃ­culo=' + o.idVehiculo +
      '|Placas=' + o.placas;
  }

  /* ============ EXTRACCIÃ“N DE HTML ============ */
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
    } catch (e) {
      return '';
    }
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

  /* ============ CIERRE MANUAL REAL (Compras: CerrarCompra + GuardarCerrarCompra) ============ */
  function limpiarHtml(s) {
    return String(s).replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&oacute;/gi, 'Ã³').replace(/&aacute;/gi, 'Ã¡').replace(/&eacute;/gi, 'Ã©')
      .replace(/&iacute;/gi, 'Ã­').replace(/&uacute;/gi, 'Ãº').replace(/&ntilde;/gi, 'Ã±')
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
          throw new Error(expirada ? 'SesiÃ³n expirada' : 'CerrarCompra sin idComprador/idVendedor');
        }
        var idCompra = matchInput(h, 'id-compra') || c.idCompra;
        var codigo = mco ? mco[1] : (c.codigo || '');
        var mostrarMotivo = matchInput(h, 'mostrar-motivo-cierre') === '1';
        var motivo = mostrarMotivo ? (CONFIG.MOTIVO_CIERRE || '') : '';
        if (mostrarMotivo && String(motivo).trim().length < 5) {
          throw new Error('requiere motivo de cierre (>=5 caracteres) en configuraciÃ³n');
        }
        var volCierre = matchInput(h, 'idVolumenCierre') || '';
        var body = 'contenidoAcuse=' + encodeURIComponent(cadenaCierreCompra(h)) +
          '&idCompra=' + encodeURIComponent(idCompra) +
          '&strMotivoCierre=' + encodeURIComponent(motivo) +
          '&CodigoRegistro=' + encodeURIComponent(codigo) +
          '&idComprador=' + mc[1] +
          '&idVendedor=' + mv[1] +
          (volCierre ? '&volumenCierre=' + encodeURIComponent(volCierre) : '');
        return apiPost('/GasLP/Compras/GuardarCerrarCompra', body);
      })
      .then(function (res) {
        var j = res.json || {};
        if (j.result === true) return { ok: true, msg: '' };
        if (j.mensaje === 'SC') throw new Error('SesiÃ³n expirada');
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

    var W = 215.9;
    var originalW = 215.9;
    var shift = (W - originalW) / 2;
    var ptToMm = function (pt) { return pt * 25.4 / 72 + shift; };
    var xCenter = function (left, right) { return ptToMm((left + right) / 2); };
    var xRight = function (right) { return ptToMm(right); };

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('GAS DE OJUELOS,  S.A DE C.V.', xCenter(190.13, 349.20), 25, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text('KM. 6+500 CARRETERA OJUELOS-OCAMPO,', xCenter(195.65, 374.04), 34, { align: 'center' });
    doc.text('MUNICIPIO DE OJUELOS, ESTADO DE JALISCO', xCenter(192.17, 377.61), 39, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('PERMISO CRE:', xCenter(92.05, 151.95), 58, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(compra.permiso_Vendedor || '', xCenter(200.69, 308.64), 58, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('PRODUCTO GAS LP', xCenter(180.98, 260.56), 72, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('FECHA:', xCenter(105.74, 135.53), 81, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(fechaLarga, xRight(368.25), 81, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('LITROS TOTALES:', ptToMm(80.66), 95, { align: 'left' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(litrosFmt, xRight(296.50), 95, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('GRACIAS.', xRight(304.37), 105, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
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
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: formData,
      credentials: 'same-origin'
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
    (nodos || []).forEach(function (n) {
      salida.push(n);
      aplanarNodos(n.children || [], salida);
    });
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
    }).map(function (n) {
      return String(n.datos[0].idEntrega || n.id || '');
    }).filter(Boolean);

    return {
      rfc: objetivo.rfc || datos.rfc || '',
      idsEntrega: entregas
    };
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
          throw new Error(j.mensaje || j.message || 'UploadFiles rechazÃ³ el PDF');
        }

        var asignar = new FormData();
        asignar.append('file', pdf, filename);
        asignar.append('FechaRegistro', toISO(new Date()));
        asignar.append('DatosAcuse', 'Traspaso=SI');
        asignar.append('IdsEntrega', referencia.idsEntrega.join(','));
        return postMultipart('/GasLP/Facturas/GuardarAsignacionFactura', asignar).then(function (respuesta) {
          var resultado = respuesta.json || {};
          if (respuesta.status < 200 || respuesta.status >= 300 || resultado.success !== true) {
            throw new Error(resultado.mensaje || resultado.message || 'GuardarAsignacionFactura rechazÃ³ la asignaciÃ³n');
          }
          return { ok: true, idsEntrega: referencia.idsEntrega };
        });
      });
    });
  }

  /* ============ MÃ“DULO: ACEPTAR ============ */
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
            progStep('Aceptando ' + f.codigoRegistro + ' â†’ ' + (r.ok ? 'OK' : 'FALLO'));
          }).catch(function (e) { fila.set('FALLO', e.message); progStep('Aceptando ' + f.codigoRegistro + ' â†’ ERROR'); });
        }).then(function () { return espera(); });
      });
      return seq;
    });
  }

  /* ============ MÃ“DULO: DESPACHAR ============ */
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
          'idPermisoActividad_Comprador',
          'idPermisoActividadComprador',
          'idPermisoActividad',
          'idActComp',
          'idActividad',
          'idPermisoActividad_Vendedor',
          'idPermisoActividadVendedor'
        ]);
        return apiPost('/GasLP/Despacho/VerificaRegistroVehiculo2',
          'vehiculo=' + encodeURIComponent(CONFIG.VEHICULO) +
          '&CompradorId=' + dc.idComprador +
          '&idActComp=' + encodeURIComponent(idActComp) +
          '&idVendedor=' + dc.idVendedor +
          '&showIRE=false').then(function (vv) {
            var vvj = vv.json || {};
            var idVehiculo = vvj.idVehiculo ||
              (vvj.datos && vvj.datos.idVehiculo) ||
              (vvj.data && vvj.data.idVehiculo) ||
              (vvj.data && vvj.data.VehiculoId);
            if (!idVehiculo) throw new Error('VerificaRegistroVehiculo2 sin idVehiculo (' + vv.text.slice(0, 120) + ')');
            return { dc: dc, ds: ds, idVehiculo: idVehiculo };
          });
      })
      .then(function (ctx) {
        var dc = ctx.dc;
        var fd = fechaRegistroSQL(toISO(parseDia(f.fechaCompra || dc.fechaCompra)));
        var acuse = acuseDespacho(dc, ctx.ds, {
          fechaRegistro: fd,
          fechaDespacho: isoToDMA(fd.split(' ')[0]),
          codigo: f.codigoRegistro,
          volumen: dc.volumen_Solicitado,
          idVehiculo: ctx.idVehiculo,
          placas: CONFIG.PLACAS
        });
        var body = 'de[fechaRegistro]=' + encodeURIComponent(fd) +
          '&de[FechaDespacho]=' + encodeURIComponent(fd) +
          '&de[idCompra]=' + dc.idCompra +
          '&de[CantidadDespachada]=' + dc.volumen_Solicitado +
          '&de[IdVehiculo]=' + ctx.idVehiculo +
          '&de[TransportePlaca]=' + encodeURIComponent(CONFIG.PLACAS) +
          '&CodigoRegistro=' + encodeURIComponent(f.codigoRegistro) +
          '&idComprador=' + dc.idComprador +
          '&idVendedor=' + dc.idVendedor +
          '&complementoAcuse=' + encodeURIComponent(acuse) +
          '&regCompraFlete=false';
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
      verboseLog('RESUMEN DESPACHO', { recibidos: data.length, pendientes: pend.length, rango: CONFIG.DESDE + ' a ' + CONFIG.HASTA });
      progAdd(pend.length);
      progRender('Permiso ' + (permiso ? permiso.id : 'actual') + ': ' + pend.length + ' a despachar de ' + data.length);
      var seq = Promise.resolve();
      pend.forEach(function (f) {
        seq = seq.then(function () {
          if (STOP) return;
          var fila = nuevaFila('Despachar', permiso, f.codigoRegistro);
          return despacharUna(f).then(function (r) {
            fila.set(r.ok ? 'OK' : 'FALLO', r.msg);
            progStep('Despachando ' + f.codigoRegistro + ' â†’ ' + (r.ok ? 'OK' : 'FALLO'));
          }).catch(function (e) { fila.set('FALLO', e.message); progStep('Despachando ' + f.codigoRegistro + ' â†’ ERROR'); });
        }).then(function () { return espera(); });
      });
      return seq;
    });
  }

  /* ============ MÃ“DULO: RECEPCIONAR (+ cierre EsCierre) ============ */
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
          permC: matchText(h, 'datos-comprador-permiso'),
          rsC: matchText(h, 'datos-comprador-razon-social'),
          dirC: matchText(h, 'datos-comprador-direccion'),
          permS: matchText(h, 'datos-suministrador-permiso'),
          rsS: matchText(h, 'datos-suministrador-razon-social'),
          dirS: matchText(h, 'datos-suministrador-direccion'),
          fechaRegistro: fechaReg,
          fechaRecepcion: isoToDMA(fdISO),
          numReg: numReg,
          volumen: volumen,
          idVehiculo: idVehiculo,
          placas: placas
        });
        var body = 'idBodega=-1' +
          '&idEntrega=' + it.idEntrega +
          '&FechaRegistro=' + encodeURIComponent(fechaReg) +
          '&CostoFlete=*' +
          '&CantidadRecibida=' + encodeURIComponent(volumen) +
          '&CodigoRegistro=' + encodeURIComponent(it.codigoRegistro) +
          '&idComprador=' + it.idComprador +
          '&idVendedor=' + it.idVendedor +
          '&dataAcuse=' + encodeURIComponent(acuse);
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
                verboseLog('ID COMPRA RECEPCION', { codigo: it.codigoRegistro, idCompra: recuperado || null });
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
      verboseLog('RESUMEN RECEPCION', { recibidos: data.length, pendientes: pend.length, rango: CONFIG.DESDE + ' a ' + CONFIG.HASTA });
      progAdd(pend.length);
      progRender('Permiso ' + (permiso ? permiso.id : 'actual') + ': ' + pend.length + ' a recepcionar de ' + data.length);
      var seq = Promise.resolve();
      pend.forEach(function (it) {
        seq = seq.then(function () {
          if (STOP) return;
          var fila = nuevaFila('Recepcionar', permiso, it.codigoRegistro);
          return recepcionarUna(it).then(function (r) {
            if (r.ok && CONFIG.CERRAR_AL_RECEPCIONAR && r.idCompra) {
              return cerrarEntrega({
                idEntrega: r.idEntrega,
                codigo: r.codigo,
                idCompra: r.idCompra,
                base: '/GasLP/Recepcion/PaginaConfirmacion'
              }).then(function (c) {
                fila.set('OK', r.msg + ' Â· cierre: ' + (c.ok ? 'OK' : 'FALLO ' + c.detalle));
                progStep('Recepcionando ' + it.codigoRegistro + ' â†’ OK Â· cierre ' + (c.ok ? 'OK' : 'FALLO'));
              });
            }
            if (r.ok && CONFIG.CERRAR_AL_RECEPCIONAR && !r.idCompra) {
              fila.set('OK', r.msg + ' Â· sin idCompra en respuesta, usar pestaÃ±a Cerrar');
              progStep('Recepcionando ' + it.codigoRegistro + ' â†’ OK Â· cierre pendiente');
              return;
            }
            fila.set(r.ok ? 'OK' : 'FALLO', r.msg);
            progStep('Recepcionando ' + it.codigoRegistro + ' â†’ ' + (r.ok ? 'OK' : 'FALLO'));
          }).catch(function (e) { fila.set('FALLO', e.message); progStep('Recepcionando ' + it.codigoRegistro + ' â†’ ERROR'); });
        }).then(function () { return espera(); });
      });
      return seq;
    });
  }

  /* ============ MÃ“DULO: LISTAR TODO ============ */
  function moduloListarTodo(permiso) {
    return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-1').then(function (res) {
      var data = (res.json && res.json.data) || [];
      actualizarFiltroPermisos(data);
      var cand = data.filter(function (c) { return pasaFiltroPermiso(c) && c.idEstatus !== 4 && c.estatus !== 'Rechazada' && enRango(c.fechaCompra); });
      progAdd(cand.length);
      cand.forEach(function (c) {
        agregarCandidato(c, permiso);
        progStep(c.codigoRegistro + ' Â· ' + (c.estatus || c.idEstatus));
      });
      progRender(cand.length ? cand.length + ' compra' + (cand.length > 1 ? 's' : '') + ' en rango.' : 'Sin resultados.');
    }).catch(function (e) { progRender('ERROR: ' + e.message); });
  }

  /* ============ MÃ“DULO: FACTURAS DE TRASPASO ============ */
  var facturasCandidatas = [];

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
      '<td>' + compra.codigoRegistro + '</td>' +
      '<td>' + (compra.estatus || compra.idEstatus) + '</td>' +
      '<td>' + (compra.volumen_Solicitado || '?') + ' / ' + (compra.volumen_Entregado || '?') + '</td>' +
      '<td>' + (compra.fechaCompra || '') + '</td>' +
      '<td>' + (compra.permiso_Vendedor || '') + '</td>';
    document.querySelector('#acs-tabla tbody').appendChild(tr);
    actualizarResumen();
    return idx;
  }

  function marcarFilaFactura(idx, ok) {
    var ch = document.querySelector('.acs-factura-check[data-idx="' + idx + '"]');
    if (!ch) return;
    ch.checked = false;
    ch.disabled = true;
    var tr = ch.closest('tr');
    if (tr) tr.classList.add(ok ? 'acs-factura-ok' : 'acs-fail');
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
    STOP = false;
    limpiarTabla();
    facturasCandidatas = [];
    progReset();
    progRender('Buscando traspasos cerrados sin factura...');
    return obtenerPermisos().then(function (perms) {
      if (!perms.length) {
        return moduloFacturas(null);
      }
      var seq = Promise.resolve();
      perms.forEach(function (p) {
        seq = seq.then(function () {
          if (STOP) return;
          progRender('Facturas Â· permiso ' + p.id + '...');
          return cambiarPermiso(p).then(function () { return moduloFacturas(p); });
        });
      });
      return seq;
    });
  }

  function descargarFormatosRango() {
    STOP = false;
    limpiarTabla();
    facturasCandidatas = [];
    progReset();
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
        verboseLog('DESCARGA FORMATOS', { permiso: permiso ? permiso.id : 'actual', recibidos: data.length, candidatos: cand.length, rango: CONFIG.DESDE + ' a ' + CONFIG.HASTA });
        progAdd(cand.length);
        var seq = Promise.resolve();
        cand.forEach(function (c) {
          seq = seq.then(function () {
            if (STOP) return;
            var idx = agregarFacturaCandidata(c, permiso);
            progRender('Generando formato Â· ' + c.codigoRegistro + '...');
            var ok = false;
            try { ok = descargarFormato(c) !== false; } catch (e) {
              verboseLog('ERROR FORMATO', { registro: c.codigoRegistro, error: e.message });
            }
            marcarFilaFactura(idx, ok);
            if (ok) okCount++;
            progStep((ok ? 'PDF guardado Â· ' : 'FALLO PDF Â· ') + c.codigoRegistro);
          }).then(espera);
        });
        return seq;
      }).catch(function (e) { verboseLog('ERROR MODULO DESCARGA', { error: e.message }); progRender('ERROR: ' + e.message); });
    }

    return obtenerPermisos().then(function (perms) {
      if (!perms.length) {
        return moduloDescarga(null);
      }
      var seq = Promise.resolve();
      perms.forEach(function (p) {
        seq = seq.then(function () {
          if (STOP) return;
          progRender('â”€â”€ Permiso ' + p.id + ' â”€â”€');
          return cambiarPermiso(p).then(function () { return moduloDescarga(p); });
        });
      });
      return seq;
    }).then(function () {
      if (!STOP) progRender('âœ” Descarga terminada Â· ' + okCount + ' formato(s) guardado(s).');
    });
  }

  function subirFacturasSeleccionadas() {
    var checks = Array.prototype.slice.call(document.querySelectorAll('.acs-factura-check:checked'));
    if (!checks.length) { progRender('Selecciona traspasos para subir.'); return Promise.resolve(); }
    progReset();
    progAdd(checks.length);
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
          ch.checked = false;
          ch.disabled = true;
          ch.closest('tr').classList.add('acs-factura-ok');
          progStep('Traspaso subido Â· ' + item.compra.codigoRegistro);
        }).catch(function (e) {
          progStep('FALLO Â· ' + item.compra.codigoRegistro + (e.message ? ' Â· ' + e.message : ''));
        });
      }).then(espera);
    });
    return seq;
  }

  /* ============ MÃ“DULO: CERRAR ============ */
  var candidatos = [];

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
      cand.forEach(function (c) {
        agregarCandidato(c, permiso);
        progStep('Compra del dia ' + c.fechaCompra);
      });
      progRender(cand.length ? 'Compra del dia ' + cand[0].fechaCompra + ' Â· ' + cand.length + ' pendiente' + (cand.length > 1 ? 's' : '') : 'Sin compras sin cerrar.');
    }).catch(function (e) { progRender('ERROR: ' + e.message); });
  }

  function agregarCandidato(c, permiso) {
    if (candidatos.some(function (x) { return x.idCompra === c.idCompra; })) return;
    candidatos.push({ compra: c, idCompra: c.idCompra, permisoUrl: permiso ? permiso.url : null });
    var estatusTxt = c.estatus || (Number(c.idEstatus) === 1 ? 'Aceptada' : Number(c.idEstatus) === 0 ? 'Solicitada' : String(c.idEstatus));
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="checkbox" checked class="acs-cand-check" data-idx="' + (candidatos.length - 1) + '"></td>' +
      '<td>' + c.codigoRegistro + '</td>' +
      '<td>' + estatusTxt + '</td>' +
      '<td>' + (c.volumen_Solicitado || '?') + ' / ' + (c.volumen_Entregado || '?') + '</td>' +
      '<td>' + (c.fechaCompra || '') + '</td>' +
      '<td>' + (c.permiso_Vendedor || '') + '</td>';
    document.querySelector('#acs-tabla tbody').appendChild(tr);
    actualizarResumen();
  }

  function cerrarSeleccionadas() {
    var checks = Array.prototype.slice.call(document.querySelectorAll('.acs-cand-check:checked'));
    if (!checks.length) { progRender('Selecciona compras para cerrar.'); return Promise.resolve(); }
    progReset();
    progAdd(checks.length);
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
              progStep('Cerrada + PDF + traspaso subido Â· ' + c.compra.codigoRegistro);
            }, function () {
              progStep('Cerrada + PDF; traspaso pendiente Â· ' + c.compra.codigoRegistro);
            });
          } else {
            progStep('FALLO ' + r.msg + ' Â· ' + c.compra.codigoRegistro);
          }
        });
      }).then(espera);
    });
    return seq;
  }

  /* ============ TABLA ============ */
  function nuevaFila(modulo, permiso, registro) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + modulo + '</td><td>' + (permiso ? permiso.id : 'actual') + '</td><td>' + registro + '</td>' +
      '<td class="acs-est pend">â€¦</td><td class="acs-det"></td>';
    document.querySelector('#acs-tabla tbody').appendChild(tr);
    var est = tr.querySelector('.acs-est');
    var det = tr.querySelector('.acs-det');
    return {
      set: function (e, d) {
        est.textContent = e;
        est.className = 'acs-est ' + (e === 'OK' ? 'ok' : e === 'FALLO' ? 'fail' : 'pend');
        det.textContent = d || '';
      }
    };
  }

  function limpiarTabla() {
    document.querySelector('#acs-tabla tbody').innerHTML = '';
    candidatos = [];
    facturasCandidatas = [];
    actualizarResumen();
  }

  function espera() {
    return new Promise(function (res) { setTimeout(res, CONFIG.DELAY_MS); });
  }

  /* ============ ORQUESTADOR ============ */
  function runModulo(nombre, fn, contextUrl) {
    var init = contextUrl ? fetch(contextUrl, { credentials: 'same-origin' }) : Promise.resolve();
    return init.then(function () {
      // Despachar y Recepcionar no deben borrar la lista ni sus selecciones al iniciar.
      if (nombre !== 'Despachar' && nombre !== 'Recepcionar') limpiarTabla();
      progReset();
      progRender('Iniciando ' + nombre + ' | ' + CONFIG.DESDE + ' a ' + CONFIG.HASTA);
      verboseLog('MODULO', { nombre: nombre, desde: CONFIG.DESDE, hasta: CONFIG.HASTA, permiso: CONFIG.PERMISO_FILTRO || 'Todos' });
      if (!CONFIG.RECORRER_PERMISOS && nombre !== 'Despachar') {
        return fn(null).then(function () { progRender('âœ” MÃ³dulo ' + nombre + ' terminado.'); });
      }
      var obtenerPermisosModulo = nombre === 'Despachar' ? obtenerPermisosDespacho : obtenerPermisos;
      return obtenerPermisosModulo().then(function (perms) {
        if (!perms.length) {
          return fn(null).then(function () { progRender('âœ” MÃ³dulo ' + nombre + ' terminado (permiso actual).'); });
        }
        progRender('Permisos: ' + perms.map(function (p) { return p.id; }).join(', '));
        var seq = Promise.resolve();
        perms.forEach(function (p) {
          seq = seq.then(function () {
            if (STOP) return;
            progRender('â”€â”€ Permiso ' + p.id + ' â”€â”€');
            return cambiarPermiso(p).then(function () { return fn(p); });
          });
        });
        return seq.then(function () { progRender('âœ” MÃ³dulo ' + nombre + ' terminado.'); });
      });
    });
  }

  function ejecutarActivo() {
    STOP = false;
    var tab = tabActivo();
    function seguro(nombre, trabajo) {
      return Promise.resolve(trabajo).catch(function (e) {
        verboseLog('ERROR MODULO', { modulo: nombre, error: e.message, stack: e.stack });
        progRender('ERROR ' + nombre + ': ' + e.message);
      });
    }
    if (tab === 'inicio') {
      seguro('Inicio', flujoCompleto());
    } else if (tab === 'aceptar') seguro('Aceptar', runModulo('Aceptar', moduloAceptar, '/GasLP/AceptarRechazarCompras/Index'));
    else if (tab === 'despachar') seguro('Despachar', runModulo('Despachar', moduloDespachar, '/GasLP/Despacho/Index'));
    else if (tab === 'recepcionar') seguro('Recepcionar', runModulo('Recepcionar', moduloRecepcionar, '/GasLP/Recepcion/Index'));
    else if (tab === 'facturas') seguro('Facturas', escanearFacturas());
    else {
      seguro('Cerrar', runModulo('Cerrar', moduloCerrar, '/GasLP/Compras/Index')).then(function () {
        if (!STOP) progRender('Listo. Selecciona y usa "Cerrar seleccionadas".');
      });
    }
  }

  function flujoCompleto() {
    STOP = false;
    progReset();

    function pipeline() {
      var seq = Promise.resolve();
      var cerradas = 0, formatos = 0;

      function paso(nombre, fn, ctx) {
        seq = seq.then(function () {
          if (STOP) return;
          progRender(nombre + '...');
          return ctx ? fetch(ctx, { credentials: 'same-origin' }) : Promise.resolve();
        }).then(function () {
          if (STOP) return;
          return fn();
        }).then(function (res) {
          if (res && res.cerradas !== undefined) cerradas = res.cerradas;
          if (res && res.formatos !== undefined) formatos = res.formatos;
          if (STOP) return;
          progRender(nombre + ' OK.');
          return espera();
        });
      }

      var aceptarFn = function () {
        return listarAceptar().then(function (data) {
          var pend = data.filter(function (f) { return pasaFiltroPermiso(f) && Number(f.idEstatus) === 0 && enRango(f.fechaCompra); });
          if (!pend.length) { progRender('Aceptar: 0'); return; }
          progAdd(pend.length);
          progRender('Aceptando ' + pend.length + '...');
          var s = Promise.resolve();
          pend.forEach(function (f) {
            s = s.then(function () {
              if (STOP) return;
              return aceptarUna(f).then(function (r) {
                progStep((r.ok ? 'OK' : 'FALLO') + ' Â· ' + f.codigoRegistro);
              }).catch(function () { progStep('ERROR Â· ' + f.codigoRegistro); });
            }).then(function () { return espera(); });
          });
          return s;
        });
      };

      var despacharFn = function () {
        return listarDespacho().then(function (data) {
          var pend = data.filter(function (f) { return pasaFiltroPermiso(f) && Number(f.idEstatus) === 1 && enRango(f.fechaCompra); });
          if (!pend.length) { progRender('Despachar: 0'); return; }
          progAdd(pend.length);
          progRender('Despachando ' + pend.length + '...');
          var s = Promise.resolve();
          pend.forEach(function (f) {
            s = s.then(function () {
              if (STOP) return;
              return despacharUna(f).then(function (r) {
                progStep((r.ok ? 'OK' : 'FALLO') + ' Â· ' + f.codigoRegistro);
              }).catch(function () { progStep('ERROR Â· ' + f.codigoRegistro); });
            }).then(function () { return espera(); });
          });
          return s;
        });
      };

      var recepcionarFn = function () {
        return listarRecepcion().then(function (data) {
          var pend = data.filter(function (it) { return pasaFiltroPermiso(it) && Number(it.idEstatus) === 4 && enRango(it.fechaDespacho); });
          if (!pend.length) { progRender('Recepcionar: 0'); return; }
          progAdd(pend.length);
          progRender('Recepcionando ' + pend.length + '...');
          var s = Promise.resolve();
          pend.forEach(function (it) {
            s = s.then(function () {
              if (STOP) return;
              return recepcionarUna(it).then(function (r) {
                if (r.ok && CONFIG.CERRAR_AL_RECEPCIONAR && r.idCompra) {
                  return cerrarEntrega({ idEntrega: r.idEntrega, codigo: r.codigo, idCompra: r.idCompra, base: '/GasLP/Recepcion/PaginaConfirmacion' }).then(function (c) {
                    progStep('OK Â· cierre ' + (c.ok ? 'OK' : 'FALLO') + ' Â· ' + it.codigoRegistro);
                  });
                }
                progStep((r.ok ? 'OK' : 'FALLO') + ' Â· ' + it.codigoRegistro);
              }).catch(function () { progStep('ERROR Â· ' + it.codigoRegistro); });
            }).then(function () { return espera(); });
          });
          return s;
        });
      };

      var cerrarFn = function () {
        progRender('Buscando compras...');
    return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-1').then(function (res) {
          var data = (res.json && res.json.data) || [];
          actualizarFiltroPermisos(data);
          var cand = data.filter(function (c) {
            return pasaFiltroPermiso(c) && (Number(c.idEstatus) === 1 || c.estatus === 'Aceptada') && !c.fechaCierre && enRango(c.fechaCompra);
          });
          if (!cand.length) { progRender('Cerrar: 0'); return { cerradas: 0, formatos: 0 }; }
          progAdd(cand.length);
          progRender('Cerrando ' + cand.length + '...');
          var s = Promise.resolve();
          var okCount = 0;
          cand.forEach(function (c) {
            s = s.then(function () {
              if (STOP) return;
              return cerrarCompraManual({ idCompra: c.idCompra, codigo: c.codigoRegistro }).then(function (r) {
                if (r.ok) {
                  okCount++;
                  try { descargarFormato(c); } catch (e) {}
                  return subirFormatoTraspaso(c).then(function () {
                    progStep('Cerrada + PDF + traspaso subido Â· ' + c.codigoRegistro);
                  }, function () {
                    progStep('Cerrada + PDF; traspaso pendiente Â· ' + c.codigoRegistro);
                  });
                } else {
                  progStep('FALLO Â· ' + c.codigoRegistro);
                }
              }).catch(function () { progStep('ERROR Â· ' + c.codigoRegistro); });
            }).then(function () { return espera(); });
          });
          return s.then(function () { return { cerradas: okCount, formatos: okCount }; });
        });
      };

      paso('Aceptar', aceptarFn, '/GasLP/AceptarRechazarCompras/Index');
      paso('Despachar', despacharFn, '/GasLP/Despacho/Index');
      paso('Recepcionar', recepcionarFn, '/GasLP/Recepcion/Index');
      paso('Cerrar', cerrarFn, '/GasLP/Compras/Index');
      return seq.then(function () { return { cerradas: cerradas, formatos: formatos }; });
    }

    if (!CONFIG.RECORRER_PERMISOS) {
      return pipeline().then(function (r) {
        if (!STOP) progRender('Terminado. Cerradas: ' + r.cerradas + '. Formatos: ' + r.formatos + '.');
      });
    }

    return obtenerPermisos().then(function (perms) {
      if (!perms.length) {
        return pipeline().then(function (r) {
          if (!STOP) progRender('Terminado. Cerradas: ' + r.cerradas + '. Formatos: ' + r.formatos + '.');
        });
      }
      progRender('Permisos: ' + perms.map(function (p) { return p.id; }).join(', '));
      var totalC = 0, totalF = 0;
      var seq = Promise.resolve();
      perms.forEach(function (p) {
        seq = seq.then(function () {
          if (STOP) return;
          progRender('â”€â”€ Permiso ' + p.id + ' â”€â”€');
          return cambiarPermiso(p).then(function () {
            return pipeline();
          }).then(function (r) {
            totalC += r.cerradas;
            totalF += r.formatos;
          });
        });
      });
      return seq.then(function () {
        if (!STOP) progRender('Terminado (' + perms.length + ' permisos). Cerradas: ' + totalC + '. Formatos: ' + totalF + '.');
      });
    });
  }

  /* ============ UI ============ */
  var tabActiva = 'inicio';
  function tabActivo() { return tabActiva; }


  
  function init() {
    cargarConfig();
    verboseLog('acs', { version: '3.4.0', status: 'init' });
  }

  function destroy() {
    STOP = true;
  }

  ET.register({
    name: 'acs',
    version: '3.4.0',
    init: init,
    destroy: destroy,
    css: '',
    api: {
      ejecutar: ejecutarActivo,
      detener: detener,
      getConfig: function () { return CONFIG; },
      setConfig: function (cfg) { Object.assign(CONFIG, cfg); guardarConfig(); }
    }
  });
})();