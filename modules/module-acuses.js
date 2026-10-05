// ==UserScript==
// @name         EASYTRAC Acuses
// @namespace    easytrac.module.acuses
// @version      3.2
// @description  Módulo Descarga de acuses — ZIP por Permiso/Subtipo, PDF por estación, CSV
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var css = `
    #sa-panel{position:fixed;bottom:12px;right:12px;z-index:99999;width:246px;max-height:92vh;overflow:auto;margin:0;box-shadow:0 2px 10px rgba(0,0,0,.3)}
    #sa-panel .sa-cab,#sa-tabla .sa-cab{display:flex;justify-content:space-between;align-items:center}
    #sa-panel .sa-min,#sa-tabla .sa-min{cursor:pointer;background:none;border:0;color:inherit;font-size:16px;line-height:1;padding:0 4px}
    #sa-panel.sa-cerrado .sa-cuerpo{display:none}
    #sa-panel .sa-grilla{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 6px;align-items:center}
    #sa-panel .sa-lb{font-size:11px;font-weight:600;opacity:.85;text-align:right;white-space:nowrap;cursor:help}
    #sa-panel .sa-f{width:100%}
    #sa-panel .sa-chk{grid-column:1 / -1;display:flex;align-items:flex-start;gap:5px;font-size:12px;font-weight:400;cursor:help}
    #sa-panel .sa-chk input{margin:1px 0 0;flex:none}
    #sa-panel .sa-op{grid-column:1 / -1;margin-top:3px;padding-top:3px;border-top:1px solid rgba(128,128,128,.3)}
    #sa-panel .sa-op>summary{cursor:pointer;font-size:11px;font-weight:600;opacity:.85}
    #sa-panel .sa-btns{grid-column:1 / -1;display:flex;gap:5px;margin-top:4px}
    #sa-panel .sa-btns button{flex:1 1 0;min-width:0;padding:4px 5px;overflow:hidden;text-overflow:ellipsis}
    #sa-panel .sa-1{grid-column:1 / -1;width:100%;margin-top:5px;padding:5px}
    #sa-panel .sa-1x{grid-column:1 / -1;width:100%;margin-top:4px;padding:4px}
    #sa-panel #sa-st{grid-column:1 / -1;margin-top:5px;font-size:11.5px;line-height:1.35;opacity:.9;word-break:break-word}

    #sa-tabla{position:fixed;left:12px;top:10vh;z-index:99998;width:min(960px,calc(100vw - 300px));height:55vh;min-width:380px;min-height:200px;display:none;flex-direction:column;overflow:hidden;resize:both;margin:0;box-shadow:0 2px 10px rgba(0,0,0,.3)}
    #sa-tabla.sa-vis{display:flex}
    #sa-tabla .sa-cab{flex:none}
    #sa-tabla .sa-rango{font-size:12px;opacity:.85}
    #sa-tabla .sa-tools{flex:none;display:flex;flex-wrap:wrap;gap:6px;padding:4px 8px}
    #sa-tabla .sa-sc{flex:1 1 auto;min-height:0;overflow:auto;position:relative;user-select:none;-webkit-user-select:none;outline:none;border-top:1px solid rgba(128,128,128,.35);border-bottom:1px solid rgba(128,128,128,.35)}
    #sa-tabla .sa-tbl{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap;margin:0}
    #sa-tabla .sa-tbl th{position:sticky;top:0;z-index:2;background:#f3f3f3;color:#333;text-align:left;padding:3px 8px;border-bottom:1px solid rgba(128,128,128,.5);font-weight:600}
    #sa-tabla .sa-tbl td{padding:2px 8px;border-bottom:1px solid rgba(128,128,128,.15);cursor:default}
    #sa-tabla .sa-c{width:24px;text-align:center}
    #sa-tabla .sa-sub{opacity:.75;font-size:11px}
    #sa-tabla tr.sa-sel td{background:rgba(0,120,215,.22)}
    #sa-tabla .sa-band{position:absolute;z-index:3;pointer-events:none;background:rgba(0,120,215,.2);border:1px solid rgba(0,120,215,.9)}
    #sa-tabla tr.sa-e-fuera td{opacity:.55}
    #sa-tabla tr.sa-e-espera td{opacity:.45}
    #sa-tabla .sa-e-ok .sa-e{color:#2e7d32}
    #sa-tabla .sa-e-dup .sa-e{color:#c77700}
    #sa-tabla .sa-e-err .sa-e{color:#c62828}
    #sa-tabla .sa-e-run .sa-e{color:#0078d7}
    #sa-tabla .sa-foot{flex:none;padding:4px 8px;font-size:12px}
    #sa-tabla .sa-hint{opacity:.65}

    #sa-exp{position:fixed;inset:0;z-index:100000;display:none;flex-direction:column;overflow:hidden;margin:0;box-shadow:0 2px 14px rgba(0,0,0,.4)}
    #sa-exp.sa-vis{display:flex}
    #sa-exp .sa-cab{flex:none}
    #sa-exp .sa-r2{font-size:12px;opacity:.85}
    #sa-exp .sa-tools{flex:none;display:flex;flex-wrap:wrap;gap:6px;padding:4px 8px;align-items:center}
    #sa-exp .ex-bus{flex:1 1 220px;min-width:160px}
    #sa-exp .ex-cuerpo{flex:1 1 auto;min-height:0;display:flex}
    #sa-exp .ex-lado{flex:1 1 58%;min-width:320px;display:flex;flex-direction:column;border-right:1px solid rgba(128,128,128,.35)}
    #sa-exp .ex-lista{flex:1 1 auto;min-height:0;overflow:auto;position:relative;user-select:none;-webkit-user-select:none;outline:none}
    #sa-exp .ex-i{display:grid;grid-template-columns:26px 42px minmax(0,1fr) 78px minmax(110px,190px);align-items:center;gap:6px;padding:2px 8px;font-size:12px;border-bottom:1px solid rgba(128,128,128,.14);cursor:default}
    #sa-exp .ex-i.ex-h{position:sticky;top:0;z-index:2;background:#f3f3f5;color:#333;font-weight:600;border-bottom:1px solid rgba(128,128,128,.5);cursor:default}
    #sa-exp .ex-i.ex-h span:nth-child(2){visibility:hidden}
    #sa-exp .ex-c{text-align:center}
    #sa-exp .ex-ic{font-weight:700;color:#555;text-align:center}
    #sa-exp .ex-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sa-exp .ex-sub{opacity:.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sa-exp .ex-i.sel{background:rgba(0,120,215,.22)}
    #sa-exp .ex-i.foc{box-shadow:inset 3px 0 0 #0078d7}
    #sa-exp .ex-i.err{opacity:.6}
    #sa-exp .ex-i.dup .ex-nm{text-decoration:line-through}
    #sa-exp .ex-i.inc .ex-ic{color:#2e7d32}
    #sa-exp .ex-band{position:absolute;z-index:3;pointer-events:none;background:rgba(0,120,215,.2);border:1px solid rgba(0,120,215,.9)}
    #sa-exp .ex-foot{flex:none;padding:3px 8px;font-size:11px;opacity:.8;border-top:1px solid rgba(128,128,128,.35)}
    #sa-exp .ex-prev{flex:1 1 42%;min-width:300px;display:flex;flex-direction:column}
    #sa-exp .ex-pcab{flex:none;display:flex;gap:8px;align-items:center;padding:4px 8px;border-bottom:1px solid rgba(128,128,128,.35);font-size:12px}
    #sa-exp .ex-tit{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
    #sa-exp .ex-modos{flex:none;display:flex;gap:4px}
    #sa-exp .ex-pbody{flex:1 1 auto;min-height:0;overflow:auto;padding:6px 8px}
    #sa-exp .ex-pbody iframe{width:100%;height:100%;border:0;display:block}
    #sa-exp .ex-pbody pre.ex-txt{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.45 Consolas,Menlo,monospace}
    #sa-exp .ex-vacio{padding:14px;font-size:12px;opacity:.8}
    #sa-exp .ex-tb{border-collapse:collapse;font-size:12px;width:100%}
    #sa-exp .ex-tb th{text-align:left;vertical-align:top;padding:2px 8px 2px 0;font-weight:600;white-space:nowrap;opacity:.85}
    #sa-exp .ex-tb td{padding:2px 0;vertical-align:top;word-break:break-word}
    #sa-exp .ex-tb td.mono{font-family:Consolas,Menlo,monospace}
    #sa-exp .ex-sec{margin:10px 0 4px;font-size:12px;font-weight:700;border-top:1px solid rgba(128,128,128,.35);padding-top:6px}
    #sa-exp .ex-pfoot{flex:none;padding:3px 8px;font-size:11px;opacity:.8;border-top:1px solid rgba(128,128,128,.35)}
    #sa-tabla .sa-d{text-align:center}
  `;

  /* ---- Estado ---- */
  var cancel = false, analizando = false;
  var ESTRAT = { modo: 'global' };
  var registros = [];
  var sel = new Set();
  var anchor = null;
  var tabla = null;
  var arrastrando = false;
  var exp = null;
  var RANGO = null;
  var AVISOS = [];
  var progFn = null;
  var despachosFallback = [];

  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  var fTxt = function (d) { return (d instanceof Date && !isNaN(d)) ? pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() : ''; };
  var esc = function (x) { return String(x ?? '').replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); };

  var CLS = { 'en rango': 'ok', 'descargado': 'ok', 'fuera de rango': 'fuera', 'duplicado': 'dup', 'error': 'err', 'PDF error': 'err', 'descargando': 'run', 'espera': 'espera', 'en rango (sin cadena)': 'ok', 'en rango (sin cadena, PDF no válido)': 'err' };
  var CRIT = { I: 'idAcuse', C: 'cadena', N: 'NOR+subtipo', L1: 'contenido', L2: 'contenido sin permiso' };

  var BUSCA = '/GasLP/Administracion/BuscaAcuse';

  /* ---- Helpers ---- */
  var esperaFallo = function (k) { return ET.utils.sleep(400 * (k * 2 * k + 1)); };

  async function post(url, data, reintentos) {
    var n = reintentos == null ? 2 : reintentos;
    for (var k = 0; ; k++) {
      try {
        var r = await fetch(url, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams(data)
        });
        if (r.status === 401) { var e = new Error('Sesión expirada'); e.fatal = true; throw e; }
        if ((r.status === 429 || r.status >= 500) && k < n) { await esperaFallo(k); continue; }
        if (!r.ok) throw new Error(url + ' -> ' + r.status);
        return r;
      } catch (e) {
        if (e.fatal || k >= n) throw e;
        await esperaFallo(k);
      }
    }
  }

  async function pool(items, n, fn) {
    var i = 0;
    var W = Math.max(1, Math.min(6, n | 0 || 1));
    await Promise.all(Array.from({ length: W }, async function () {
      while (i < items.length && !cancel) { var k = i++; await fn(items[k], k); await ET.utils.sleep(40); }
    }));
    return W;
  }

  function workers() { var w = ET.$('#sa-w'); var v = w ? parseInt(w.value, 10) : NaN; return isNaN(v) ? 3 : v; }

  /* ---------- Permisos ---------- */
  function esPlantaDist(p) { return /distribuidor|\/dist\//i.test(p.actividad + ' ' + p.codigo); }
  function ordenPermisos(ps) { return ps.slice().sort(function (a, b) { return (esPlantaDist(a) ? 1 : 0) - (esPlantaDist(b) ? 1 : 0); }); }

  async function activaPermiso(p) {
    var q = new URLSearchParams({ idPermiso: p.id, permiso: p.codigo, idPermisionario: '0', idPermisoMateria: '0', idPermisoActividad: '0', razonSocial: p.razon || '', estatus: 'False', capacidadOperativa: '0' });
    await fetch('/OrdenDePedido/SeleccionarPermiso?' + q, { credentials: 'include' });
  }

  var firma = function (r) { return (r.item2 || []).map(function (i) { return i.idAcuse; }).join(',') + '|' + ((r.item1 && r.item1.paginaFinal) || 1); };

  function permisoEnPantalla(codigos) {
    var m = String((document.body.innerText || '')).match(/LP\/\d+\/[A-Z]+\/[A-Za-z]+\/\d{4}/);
    return m && codigos.has(m[0]) ? m[0] : null;
  }

  async function detectaEstrategia(permisos, prog) {
    var codigos = new Set(permisos.map(function (p) { return p.codigo; }));
    var pantalla = permisoEnPantalla(codigos);
    var activo = permisos.find(function (p) { return p.codigo === pantalla; }) || null;
    var lee = function (extra) { return (await post(BUSCA, Object.assign({ filtro: '', pagina: 1 }, extra || {}))).json; };

    var fBase = firma(await lee());
    var A = permisos.find(function (p) { return !activo || p.codigo !== activo.codigo; }) || permisos[0];
    var B = permisos.find(function (p) { return p !== A; }) || A;
    if (!A) return { modo: 'global', activo: activo, fBase: fBase };

    prog('Comprobando si el listado depende del permiso activo…');
    await activaPermiso(A);
    var rA = await lee(), fA = firma(rA);
    if (B !== A) { await activaPermiso(B); }
    var rB = B === A ? rA : await lee(), fB = firma(rB);
    var paginas = {};
    paginas[A.codigo] = (rA.item1 && rA.item1.paginaFinal) || 1;
    if (B !== A) paginas[B.codigo] = (rB.item1 && rB.item1.paginaFinal) || 1;

    if (fA === fB) {
      if (activo) await activaPermiso(activo);
      return { modo: 'global', activo: activo, fBase: fBase, paginas: paginas };
    }
    if (B !== A) {
      var fParam = firma(await lee({ idPermiso: A.id, permiso: A.codigo }));
      if (fParam === fA) {
        if (activo) await activaPermiso(activo);
        return { modo: 'param', activo: activo, fBase: fBase, paginas: paginas };
      }
    }
    if (activo) await activaPermiso(activo);
    return { modo: 'sesion', activo: activo, fBase: fBase, paginas: paginas };
  }

  /* ---------- Cadena ---------- */
  function parseCadena(html) {
    var m = String(html == null ? '' : html).match(/[^<>]*?(?:Folio Acuse|Codigo de Registro)=[^<>]*/);
    if (!m) return null;
    var txt = new DOMParser().parseFromString(m[0], 'text/html').body.textContent;
    var o = {};
    txt.split('|').forEach(function (p) {
      var i = p.indexOf('=');
      if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    if (!Object.keys(o).length) return null;
    return { raw: txt.trim(), o: o };
  }

  /* ---------- Fechas ---------- */
  var MES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
  function mk(y, m, d) {
    y = +y; m = +m; d = +d;
    if (y < 100) y += 2000;
    var t = new Date(y, m - 1, d);
    return (y >= 1990 && y <= 2100 && t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d) ? t : null;
  }
  function dmy(s) {
    s = String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!s) return null;
    s = s.replace(/(ene|jan|feb|mar|abr|apr|may|jun|jul|ago|aug|sep|set|oct|nov|dic|dec)[a-z]*\.?/g, function (_, m) { return ' ' + MES[m] + ' '; })
      .replace(/\bde\b/g, ' ').replace(/(\d)t(\d)/, '$1 $2').replace(/\s*\d{1,2}:\d{2}.*$/, '');
    var g = s.match(/\d+/) || [];
    if (g.length >= 3) {
      var a = g[0], b = g[1], c = g[2];
      if (a.length >= 4) return mk(a, b, c) || mk(a, c, b);
      return mk(c, b, a) || mk(c, a, b);
    }
    var D = g.join('');
    if (D.length === 8) {
      var y0 = +D.slice(0, 4);
      return (y0 >= 1990 && y0 <= 2100 && (mk(D.slice(0, 4), D.slice(4, 6), D.slice(6)) || mk(D.slice(0, 4), D.slice(6), D.slice(4, 6))))
        || mk(D.slice(4), D.slice(2, 4), D.slice(0, 2)) || mk(D.slice(4), D.slice(0, 2), D.slice(2, 4));
    }
    if (D.length === 7) {
      var y = D.slice(3), r = D.slice(0, 3), y2 = D.slice(0, 4), r2 = D.slice(4);
      return mk(y, r.slice(1), r[0]) || mk(y, r[2], r.slice(0, 2)) || mk(y2, r2.slice(1), r2[0]) || mk(y2, r2[2], r2.slice(0, 2));
    }
    if (D.length === 6) return mk(D.slice(4), D.slice(2, 4), D.slice(0, 2));
    return null;
  }

  var nk = function (k) { return k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); };
  function fechaDe(it) {
    var s = String((it && it.fechaAcuse) || '').trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
    var d = new Date(s);
    return isNaN(d) ? null : { d: d, k: 'Fecha Acuse', origen: 'listado' };
  }

  var vItem = function (it) {
    for (var i = 1; i < arguments.length; i++) { var v = it[arguments[i]]; if (v != null && String(v).trim()) return String(v).trim(); }
    return '';
  };

  async function getPdf(it) {
    var b = await (await post('/GasLP/Administracion/ImprimirAcuse', { idAcuse: it.idAcuse })).blob();
    return { b: b, ext: /pdf/i.test(b.type) ? 'pdf' : /html/i.test(b.type) ? 'html' : 'bin' };
  }

  var comoBytes = async function (b) { return (b && typeof b.arrayBuffer === 'function') ? new Uint8Array(await b.arrayBuffer()) : b; };

  async function getPdfReintento(it, intentos) {
    var n = intentos || 3;
    var ultimo = 'no se pudo obtener el PDF';
    for (var i = 1; i <= n; i++) {
      try {
        var r = await getPdf(it);
        if (r.ext === 'pdf') return { b: await comoBytes(r.b), ext: 'pdf' };
        ultimo = 'el servidor devolvió ' + r.ext.toUpperCase() + ' en lugar del PDF';
      } catch (e) { ultimo = e.message; }
      if (i < n) { if (progFn) progFn('PDF: reintento ' + i + '/' + (n - 1) + ' · ' + ultimo); await ET.utils.sleep(500 * i * i); }
    }
    throw new Error(ultimo + ' (tras ' + n + ' intentos)');
  }

  var pdfCache = new Map();

  /* ---------- Subtipo ---------- */
  function tipoOp(it, sub) {
    var f = [sub && sub.clave, it.tipoAcuse].map(function (x) { return nk(String(x == null ? '' : x)); });
    if (f.some(function (x) { return /compra/.test(x); })) return 'COMPRA';
    if (f.some(function (x) { return /venta/.test(x); })) return 'VENTA';
    if (f.some(function (x) { return /recep|entreg/.test(x); })) return 'ENTREGA';
    if (f.some(function (x) { return /precio/.test(x); })) return 'PRECIO';
    return sub ? sub.texto.toUpperCase() || 'OTROS' : 'OTROS';
  }

  var campoPor = function (o, re) {
    var k = Object.keys(o).find(function (k) { return re.test(nk(k)); });
    return k ? o[k] : '';
  };

  var PARE = new Set('de del la el los las un una unos unas y o en a al por con para sobre acuse acuses no num numero folio codigo tipo estado solicitud fecha'.split(' '));
  var TIPOS = ('compra C COMPRA|compras C COMPRA|venta V VENTA|ventas V VENTA|recepcion R ENTREGA|entrega E ENTREGA|entregas E ENTREGA|inventario I INVENTARIO|factura F FACTURA|facturas F FACTURA|precio P PRECIO|precios P PRECIO|traspaso T TRASLADO|transferencia T TRASLADO').split('|').map(function (s) { return s.split(' '); });
  var limpia = function (t) { return nk(String(t == null ? '' : t)).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); };
  function palabras(t) { return limpia(t).split(' ').filter(function (x) { return x && !PARE.has(x) && !/^\d+$/.test(x); }); }
  var esTipo = function (w) { return TIPOS.find(function (t) { return w.startsWith(t[0]); }); };
  var esCont = function (w) { return /^(registr|acuse|solicitud|document)/.test(w); };

  function siglaDe(texto) {
    var orig = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
    var w = palabras(orig);
    var ci = w.findIndex(esCont);
    var ni = w.findIndex(esTipo);
    if (w.length < 2) return null;
    if (ci < 0 && ni !== w.length - 1 && ni !== 0) return null;
    var tipo = w[ni < 0 ? 0 : ni], tp = esTipo(tipo) || [tipo, tipo[0].toUpperCase(), ''];
    var v = ci > 0 ? w[ci - 1] : ci < 0 ? (ni === 0 ? w[1] : w[0]) : null;
    return v ? { texto: orig, sigla: (v[0] + 'R' + tp[1]).toUpperCase(), clave: v + '-' + tp[0], tipo: tp[0], op: tp[2] }
      : { texto: orig, sigla: 'R' + tp[1], clave: 'registro-' + tp[0], tipo: tp[0], op: tp[2] };
  }

  function subtipo(o, it) {
    var subtipoDe = function (o) { return Object.keys(o).filter(function (k) { return /subtipo|tipo\s*de\s*acuse/i.test(k); }).flatMap(function (k) { return [o[k], k + ' ' + o[k]]; }); };
    for (var v of [vItem(it, 'tipoAcuse', 'subtipo', 'subTipo', 'nombreSubtipo', 'descripcionSubtipo'), ...subtipoDe(o), it.tipoAcuse]) {
      var r = siglaDe(v);
      if (r) return r;
    }
    var tit = String(it.tipoAcuse || '').replace(/\s+/g, ' ').trim();
    var w = palabras(tit), ini = w.map(function (x) { return x[0]; }).join('').toUpperCase();
    if (w.length >= 2 && w.length <= 5) return { texto: tit, sigla: ini, clave: ini };
    var L = w.length > 1 ? (esTipo(w[0]) || [])[1] : null;
    if (L) return { texto: tit, sigla: (w[1] ? w[1][0] : 'R') + 'R' + L, clave: w[1] + '-' + w[0] };
    return { texto: '', sigla: 'SIN_TIPO', clave: 'SIN_TIPO' };
  }

  var ddmmaaaa = function (d) { return pad2(d.getDate()) + pad2(d.getMonth() + 1) + d.getFullYear(); };

  var safe = function (x) { return String(x).replace(/[\\/:*?"<>|]+/g, '_').trim(); };
  var seg = function (x) { return safe(x).replace(/\s+/g, ' ').replace(/[. ]+$/, '').slice(0, 90) || 'SIN_DATO'; };

  function nombreDe(nor, f, sub) { return seg(nor) + '-' + ddmmaaaaa(f.d) + '-' + seg(sub.texto || sub.sigla); }

  function razonSocial(o, op) {
    var ks = Object.keys(o).filter(function (k) { return /^permiso/.test(nk(k)); });
    var w = function (x) { var k = ks.find(function (k) { return nk(k).includes(x); }); return k ? o[k] : ''; };
    var cmp = vItem(it, 'comprador', 'permisoComprador'), vnd = vItem(it, 'vendedor', 'permisoVendedor'), per = vItem(it, 'permiso', 'permisoPropietario');
    var L = op === 'COMPRA' ? [w('comprador'), cmp, per] : op === 'VENTA' ? [w('vendedor'), w('suministrador'), vnd, per] : [w('propietario'), w('vendedor'), w('comprador'), per, vnd, cmp, it.permisoPropietario];
    L.push(o[ks[0]], it.permisoPropietario);
    var v = L.find(function (x) { return x && String(x).trim(); });
    return v ? String(v).trim() : 'SIN_PERMISO';
  }

  function permisoDe(op, o, it) {
    var ks = Object.keys(o).filter(function (k) { return /^permiso/.test(nk(k)); });
    var w = function (x) { var k = ks.find(function (k) { return nk(k).includes(x); }); return k ? o[k] : ''; };
    var cmp = vItem(it, 'comprador', 'permisoComprador'), vnd = vItem(it, 'vendedor', 'permisoVendedor'), per = vItem(it, 'permiso', 'permisoPropietario');
    var L = op === 'COMPRA' ? [w('comprador'), cmp, per] : op === 'VENTA' ? [w('vendedor'), w('suministrador'), vnd, per] : [w('propietario'), w('vendedor'), w('comprador'), per, vnd, cmp, it.permisoPropietario];
    L.push(o[ks[0]], it.permisoPropietario);
    var v = L.find(function (x) { return x && String(x).trim(); });
    return v ? String(v).trim() : 'SIN_PERMISO';
  }

  /* ---------- Tabla ---------- */
  var CLS = { 'en rango': 'ok', 'descargado': 'ok', 'fuera de rango': 'fuera', 'duplicado': 'dup', 'error': 'err', 'PDF error': 'err', 'descargando': 'run', 'espera': 'espera', 'en rango (sin cadena)': 'ok', 'en rango (sin cadena, PDF no válido)': 'err' };

  function htmlFila(r) {
    var txt = r.error ? 'error: ' + r.error : r.estado === 'espera' ? '…' : r.estado;
    return '<td class="sa-c"><input type="checkbox" ' + (r.incl ? 'checked' : '') + (r.f ? '' : 'disabled') + '></td>' +
      '<td>' + (r.n + 1) + '</td>' +
      '<td class="sa-d" title="Fecha Acuse del listado">' + esc(r.f ? fTxt(r.f.d) : '') + '</td>' +
      '<td title="' + esc(r.sub ? r.sub.texto + (r.sub.clave ? ' [' + r.sub.clave + ']' : '') : '') + '">' + esc(r.sub ? r.sub.sigla : '') + ' <span class="sa-sub">' + esc(r.sub ? r.sub.texto : '') + '</span></td>' +
      '<td>' + esc(r.op) + '</td><td>' + esc(r.perm) + '</td><td>' + esc(r.nor) + '</td>' +
      '<td class="sa-e" title="' + esc(r.dupTxt || r.error || r.aviso || '') + '">' + esc(txt) + '</td>';
  }

  function pintaFila(r) {
    if (!r.tr) { r.tr = document.createElement('tr'); r.tr.dataset.n = r.n; }
    r._on = sel.has(r.n);
    r.tr.className = 'sa-e-' + (CLS[r.estado] || 'ok') + (r._on ? ' sa-sel' : '');
    r.tr.innerHTML = htmlFila(r);
  }

  function resumen() {
    if (!tabla) return;
    var inc = registros.filter(function (r) { return r.incl && r.f; });
    var ds = inc.map(function (r) { return r.f.d.getTime(); });
    var rango = ds.length ? fTxt(new Date(Math.min.apply(null, ds))) + ' – ' + fTxt(new Date(Math.max.apply(null, ds))) : '—';
    tabla.res.textContent = 'Filas ' + registros.length + ' · seleccionadas ' + sel.size + ' · incluidas en el ZIP ' + inc.length + ' · fechas de acuse ' + rango;
  }

  function pintaSel() {
    for (var i = 0; i < registros.length; i++) {
      var r = registros[i];
      var on = sel.has(r.n);
      if (r._on !== on) { r._on = on; r.tr.classList.toggle('sa-sel', on); }
    }
    resumen();
  }

  function setIncl(ns, v) {
    ns.forEach(function (n) { var r = registros[n]; if (r && r.f) { r.incl = v; r.toc = true; pintaFila(r); } });
    resumen();
  }

  function agregaN(r) {
    pintaFila(r);
    var sc = tabla.sc, abajo = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 10;
    tabla.tb.appendChild(r.tr);
    if (abajo && !arrastrando) sc.scrollTop = sc.scrollHeight;
  }

  function agrega(r) {
    r.n = registros.length;
    registros.push(r);
    agregaN(r);
    if (exp) { clearTimeout(exp.t); exp.t = setTimeout(function () { if (!arrastrando) pintaLista(); }, 400); }
    resumen();
  }

  function crearTabla() {
    var w = document.createElement('div');
    w.id = 'sa-tabla';
    w.innerHTML = '<div class="sa-cab"><span><b>Acuses</b> <span class="sa-rango"></span></span><button type="button" class="sa-min" title="Ocultar tabla">&times;</button></div>' +
      '<div class="sa-tools">' +
      '<button type="button" data-a="todo" title="Ctrl+A">Seleccionar todo</button>' +
      '<button type="button" data-a="inc" title="Espacio">Incluir sel.</button>' +
      '<button type="button" data-a="exc" title="Espacio">Excluir sel.</button>' +
      '<button type="button" data-a="def" title="Restablecer">Restablecer</button>' +
      '<button type="button" data-a="err" title="Reintentar cadena">Reintentar cadena</button>' +
      '</div>' +
      '<div class="sa-sc" tabindex="0"><table class="sa-tbl"><thead><tr>' +
      '<th class="sa-c"></th><th>#</th><th>Fecha acuse</th><th>Subtipo</th><th>Op.</th><th>Permiso</th><th>Código de registro</th><th>Estado</th>' +
      '</tr></thead><tbody></tbody></table></div>' +
      '<div class="sa-foot"><span class="sa-res"></span> <span class="sa-hint sa-guia">· Arrastra · Ctrl suma · Shift rango · Espacio incluye · Esc limpia</span></div>';
    document.body.appendChild(w);
    var sc = w.querySelector('.sa-sc');
    tabla = { w: w, sc: sc, table: w.querySelector('table'), tb: w.querySelector('tbody'), res: w.querySelector('.sa-res'), rango: w.querySelector('.sa-rango') };

    w.querySelector('.sa-min').onclick = function () { w.classList.remove('sa-vis'); };
    w.querySelector('.sa-tools').onclick = function (e) {
      var b = e.target.closest('button'), a = b && b.dataset.a;
      if (!a) return;
      if (a === 'todo') { registros.forEach(function (r) { sel.add(r.n); }); pintaSel(); }
      else if (a === 'inc' || a === 'exc') setIncl([].concat(sel), a === 'inc');
      else if (a === 'def') { registros.forEach(function (r) { r.incl = puede(r); pintaFila(r); }); if (exp) pintaLista(); resumen(); }
      else if (a === 'err') { reintentarErrores(registros.filter(function (r) { return r.error || r.sinCadena; }).map(function (r) { return r.n; })); return; }
    };

    tabla.tb.addEventListener('change', function (e) {
      var tr = e.target.closest('tr[data-n]');
      if (!tr) return;
      var n = +tr.dataset.n;
      setIncl(sel.has(n) && sel.size > 1 ? [].concat(sel) : [n], e.target.checked);
    });

    sc.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); registros.forEach(function (r) { sel.add(r.n); }); pintaSel(); }
      else if (e.key === ' ' && sel.size) { e.preventDefault(); var ns = [].concat(sel).filter(function (n) { return registros[n].f; }); setIncl(ns, !ns.every(function (n) { return registros[n].incl; })); }
      else if (e.key === 'Escape') { sel.clear(); pintaSel(); }
    });

    sc.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || e.target.closest('input,button,thead')) return;
      var rc0 = sc.getBoundingClientRect();
      if (e.clientX - rc0.left >= sc.clientWidth || e.clientY - rc0.top >= sc.clientHeight) return;
      e.preventDefault(); sc.focus();
      var add = e.ctrlKey || e.metaKey, base = new Set(sel);
      var fila0 = e.target.closest('tr[data-n]');
      var x0 = e.clientX - rc0.left + sc.scrollLeft, y0 = e.clientY - rc0.top + sc.scrollTop;
      var cx = e.clientX, cy = e.clientY, moved = false, raf = 0, band = null;
      arrastrando = true;

      function paso() {
        raf = 0;
        var rc = sc.getBoundingClientRect(), s0 = sc.scrollTop, borde = 28;
        if (cy < rc.top + borde) sc.scrollTop -= Math.min(30, rc.top + borde - cy);
        else if (cy > rc.bottom - borde) sc.scrollTop += Math.min(30, cy - (rc.bottom - borde));
        var x1 = Math.max(0, Math.min(tabla.table.offsetWidth, cx - rc.left + sc.scrollLeft));
        var y1 = Math.max(0, Math.min(tabla.table.offsetHeight, cy - rc.top + sc.scrollTop));
        var T = Math.min(y0, y1), B = Math.max(y0, y1);
        band.style.cssText = 'left:' + Math.min(x0, x1) + 'px;top:' + T + 'px;width:' + Math.abs(x1 - x0) + 'px;height:' + (B - T) + 'px';
        sel.clear();
        for (var i = 0; i < registros.length; i++) {
          var b = registros[i].tr.getBoundingClientRect();
          var hit = b.bottom - rc.top + sc.scrollTop >= T && b.top - rc.top + sc.scrollTop <= B;
          if (add ? base.has(registros[i].n) !== hit : hit) sel.add(registros[i].n);
        }
        pintaSel();
        if (sc.scrollTop !== s0) raf = requestAnimationFrame(paso);
      }
      function mueve(ev) {
        cx = ev.clientX; cy = ev.clientY;
        if (!moved && Math.hypot(cx - e.clientX, cy - e.clientY) < 4) return;
        if (!moved) { moved = true; band = document.createElement('div'); band.className = 'sa-band'; sc.appendChild(band); }
        if (!raf) raf = requestAnimationFrame(paso);
      }
      function suelta(ev) {
        document.removeEventListener('mousemove', mueve);
        document.removeEventListener('mouseup', suelta);
        cancelAnimationFrame(raf); raf = 0; arrastrando = false;
        if (band) band.remove();
        if (moved) { anchor = fila0 ? +fila0.dataset.n : (sel.size ? Math.min.apply(null, sel) : anchor); return; }
        var n = fila0 ? +fila0.dataset.n : null;
        if (n === null) { if (!add) { sel.clear(); pintaSel(); } return; }
        if (ev.shiftKey && anchor !== null) {
          if (!add) sel.clear();
          for (var i = Math.min(anchor, n); i <= Math.max(anchor, n); i++) sel.add(i);
        } else if (add) { sel.has(n) ? sel.delete(n) : sel.add(n); anchor = n; }
        else { sel.clear(); sel.add(n); anchor = n; }
        pintaSel();
      }
      document.addEventListener('mousemove', mueve);
      document.addEventListener('mouseup', suelta);
    });
  }

  /* ---------- Explorador ---------- */
  function crearExplorador() {
    if (exp) return exp;
    var w = document.createElement('div');
    w.id = 'sa-exp';
    w.innerHTML = '<div class="sa-cab"><span><b>Acuses</b> <span class="sa-r2"></span></span><button type="button" class="sa-min" title="Cerrar">&times;</button></div>' +
      '<div class="sa-tools">' +
      '<input type="search" class="ex-bus" placeholder="Filtrar: subtipo, código, permiso...">' +
      '<select class="ex-est"><option value="">Todos los estados</option><option value="incluido">Incluidos</option><option value="noincluido">No incluidos</option><option value="dup">Duplicados</option><option value="err">Con error</option><option value="sin">Sin cadena</option></select>' +
      '<button type="button" data-a="todo">Todo</button><button type="button" data-a="inv">Invertir</button>' +
      '<button type="button" data-a="inc">Incluir sel.</button><button type="button" data-a="exc">Excluir sel.</button>' +
      '<button type="button" data-a="err">Reintentar cadena</button>' +
      '<button type="button" data-a="zip">Descargar ZIP</button>' +
      '</div>' +
      '<div class="ex-cuerpo"><div class="ex-lado"><div class="ex-i ex-h"><span></span><span class="ex-ic"></span><span>Archivo</span><span class="ex-f">F. acuse</span><span class="ex-sub">Subtipo</span></div>' +
      '<div class="ex-lista" tabindex="0"></div><div class="ex-foot"></div></div>' +
      '<div class="ex-prev"><div class="ex-pcab"><span class="ex-tit"></span><span class="ex-modos"><button type="button" data-m="info">Info</button><button type="button" data-m="txt">Cadena</button><button type="button" data-m="pdf">PDF</button></span></div>' +
      '<div class="ex-pbody"></div><div class="ex-pfoot"></div></div></div>';
    document.body.appendChild(w);
    exp = {
      w: w, lista: w.querySelector('.ex-lista'), prev: w.querySelector('.ex-pbody'), tit: w.querySelector('.ex-tit'),
      foot: w.querySelector('.ex-pfoot'), plist: w.querySelector('.ex-pcab'), r2: w.querySelector('.sa-r2'),
      lfoot: w.querySelector('.ex-foot'), sel: new Set(), focus: null, modo: 'info', blobs: new Map(), req: 0, anchor: null, url: null, vis: []
    };

    w.querySelector('.sa-min').onclick = function () { cerrarExplorador(); };
    w.querySelector('.sa-tools').onclick = function (e) {
      var b = e.target.closest('button'), a = b && b.dataset.a;
      if (!a) return;
      var vis = exp.vis;
      if (a === 'todo') vis.forEach(function (r) { exp.sel.add(r.n); });
      else if (a === 'inv') vis.forEach(function (r) { exp.sel.has(r.n) ? exp.sel.delete(r.n) : exp.sel.add(r.n); });
      else if (a === 'inc' || a === 'exc') marcaIncl(vis.filter(function (r) { return exp.sel.has(r.n); }).map(function (r) { return r.n; }), a === 'inc');
      else if (a === 'err') { reintentarErrores(vis.map(function (r) { return r.n; })); return; }
      else if (a === 'zip') { descargar().catch(function (e) { ET.$('#sa-st').textContent = 'Error: ' + e.message; }); return; }
      marcaSel();
    };
    w.querySelector('.ex-bus').oninput = function () { exp.sel.clear(); pintaLista(); };
    w.querySelector('.ex-est').onchange = function () { exp.sel.clear(); pintaLista(); };
    w.querySelector('.ex-modos').onclick = function (e) { var b = e.target.closest('button'); if (b) { exp.modo = b.dataset.m; verFocus(); } };
    exp.w.addEventListener('click', function (e) { var b = e.target.closest('[data-rec]'); if (b) { e.preventDefault(); reintentar(+b.dataset.rec); } });
    exp.lista.addEventListener('change', function (e) {
      if (!e.target.matches('input[type=checkbox]')) return;
      var it = e.target.closest('.ex-i'), n = it && +it.dataset.n;
      if (n != null) marcaIncl([n], e.target.checked);
    });

    exp.lista.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || e.target.closest('input,thead')) return;
      var sc = exp.lista, rc0 = sc.getBoundingClientRect();
      if (e.clientX - rc0.left >= sc.clientWidth || e.clientY - rc0.top >= sc.clientHeight) return;
      e.preventDefault(); sc.focus();
      var add = e.ctrlKey || e.metaKey;
      var item0 = e.target.closest('.ex-i'), n0 = item0 ? +item0.dataset.n : null;
      var base = new Set(exp.sel);
      var y0 = e.clientY - rc0.top + sc.scrollTop;
      var cy = e.clientY, movido = false, raf = 0, band = null;
      arrastrando = true;

      function paso() {
        raf = 0;
        var rc = sc.getBoundingClientRect(), s0 = sc.scrollTop, borde = 26;
        if (cy < rc.top + borde) sc.scrollTop -= Math.min(34, rc.top + borde - cy);
        else if (cy > rc.bottom - borde) sc.scrollTop += Math.min(34, cy - (rc.bottom - borde));
        var T = Math.min(y0, cy - rc.top + sc.scrollTop), B = Math.max(y0, cy - rc.top + sc.scrollTop);
        band.style.cssText = 'left:0;top:' + T + 'px;width:100%;height:' + (B - T) + 'px';
        exp.sel.clear();
        for (var i = 0; i < sc.querySelectorAll('.ex-i[data-n]').length; i++) {
          var it = sc.querySelectorAll('.ex-i[data-n]')[i];
          var b = it.getBoundingClientRect();
          var hit = b.bottom - rc.top + sc.scrollTop >= T && b.top - rc.top + sc.scrollTop <= B;
          if (add ? base.has(+it.dataset.n) !== hit : hit) exp.sel.add(+it.dataset.n);
        }
        marcaSel();
        if (sc.scrollTop !== s0) raf = requestAnimationFrame(paso);
      }
      function mueve(ev) {
        cy = ev.clientY;
        if (!movido && Math.abs(cy - e.clientY) < 4) return;
        if (!movido) { movido = true; band = document.createElement('div'); band.className = 'ex-band'; sc.appendChild(band); }
        if (!raf) raf = requestAnimationFrame(paso);
      }
      function suelta(ev) {
        document.removeEventListener('mousemove', mueve);
        document.removeEventListener('mouseup', suelta);
        cancelAnimationFrame(raf); raf = 0; arrastrando = false;
        if (band) band.remove();
        if (movido) {
          if (n0 != null) exp.anchor = n0;
          var f = exp.vis.find(function (r) { return exp.sel.has(r.n); });
          if (f) exp.focus = f.n;
          marcaSel(); verFocus(); return;
        }
        if (n0 == null) { if (!add) { exp.sel.clear(); marcaSel(); } return; }
        if (ev.shiftKey && exp.anchor != null) {
          if (!add) exp.sel.clear();
          for (var i = 0; i < exp.vis.length; i++) { var r = exp.vis[i]; if (r.n >= Math.min(exp.anchor, n0) && r.n <= Math.max(exp.anchor, n0)) exp.sel.add(r.n); }
        } else if (add) { exp.sel.has(n0) ? exp.sel.delete(n0) : exp.sel.add(n0); exp.anchor = n0; }
        else { exp.sel.clear(); exp.sel.add(n0); exp.anchor = n0; }
        exp.focus = n0;
        marcaSel(); verFocus();
      }
      document.addEventListener('mousemove', mueve);
      document.addEventListener('mouseup', suelta);
    });

    exp.lista.addEventListener('keydown', function (e) {
      var vis = exp.vis;
      if (!vis.length) return;
      var pos = vis.findIndex(function (r) { return r.n === exp.focus; });
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); vis.forEach(function (r) { exp.sel.add(r.n); }); marcaSel(); }
      else if (e.key === 'Escape') { e.stopPropagation(); exp.sel.clear(); marcaSel(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var np = Math.min(vis.length - 1, Math.max(0, (pos < 0 ? 0 : pos) + (e.key === 'ArrowDown' ? 1 : -1)));
        var r = vis[np];
        if (e.shiftKey) { if (exp.anchor == null) exp.anchor = r.n; if (r.n >= Math.min(exp.anchor, exp.focus ?? r.n) && r.n <= Math.max(exp.anchor, exp.focus ?? r.n)) exp.sel.add(r.n); }
        else { exp.sel.clear(); exp.sel.add(r.n); exp.anchor = r.n; }
        exp.focus = r.n; marcaSel(); verFocus();
        var fila = exp.lista.querySelector('.ex-i.foc');
        if (fila && typeof fila.scrollIntoView === 'function') fila.scrollIntoView({ block: 'nearest' });
      } else if (e.key === ' ' && exp.sel.size) {
        e.preventDefault();
        var ns = vis.filter(function (r) { return exp.sel.has(r.n) && r.f; }).map(function (r) { return r.n; });
        marcaIncl(ns, !ns.every(function (n) { return registros[n].incl; }));
      }
    });
    return exp;
  }

  function cerrarExplorador() {
    if (!exp) return;
    if (exp.url) { URL.revokeObjectURL(exp.url); exp.url = null; }
    exp.blobs.clear();
    exp.w.classList.remove('sa-vis');
    exp.w.style.display = 'none';
  }

  function abrirExplorador() {
    crearExplorador();
    exp.w.style.display = 'flex';
    exp.w.classList.add('sa-vis');
    if (exp.focus == null || !registros[exp.focus]) exp.focus = registros.findIndex(function (r) { return r.incl; });
    pintaLista(); verFocus();
  }

  function marcaIncl(ns, v) {
    ns.forEach(function (n) { var r = registros[n]; if (r && r.f) { r.incl = v; r.toc = true; if (r.tr && r.tr.isConnected) pintaFila(r); } });
    if (exp) { exp.lista.querySelectorAll('.ex-i[data-n]').forEach(function (it) { var r = registros[+it.dataset.n]; if (r) it.querySelector('input').checked = r.incl; }); marcaSel(); }
    if (tabla) resumen();
  }

  function filasVisibles() {
    var w = exp.w, b = (w.querySelector('.ex-bus').value || '').toLowerCase().trim(), e = w.querySelector('.ex-est').value;
    return registros.filter(function (r) {
      if (e === 'incluido' && !r.incl) return false;
      if (e === 'noincluido' && r.incl) return false;
      if (e === 'dup' && !r.dup) return false;
      if (e === 'err' && !r.error) return false;
      if (e === 'sin' && !r.sinCadena) return false;
      if (b && !(r.nombre + ' ' + r.perm + ' ' + r.nor + ' ' + r.op + ' ' + (r.sub ? r.sub.sigla + ' ' + r.sub.texto : '') + ' ' + r.it.idAcuse).toLowerCase().includes(b)) return false;
      return true;
    });
  }

  var exNombre = function (r) { return (r.nombre || 'acuse_' + r.it.idAcuse) + '.PDF'; };

  function pintaLista() {
    exp.vis = filasVisibles();
    var inc = exp.vis.filter(function (r) { return r.incl; }).length, selN = exp.vis.filter(function (r) { return exp.sel.has(r.n); }).length;
    exp.r2.textContent = '· ' + exp.vis.length + ' de ' + registros.length + ' · marcadas ' + selN + ' · para el ZIP ' + inc;
    exp.lfoot.textContent = selN + ' seleccionados · arrastra para seleccionar · Ctrl+clic suma · Shift+clic rango · ↑↓ navega · Espacio incluye/excluye';
    exp.lista.innerHTML = exp.vis.map(function (r) {
      var nm = exNombre(r);
      return '<div class="ex-i' + (exp.sel.has(r.n) ? ' sel' : '') + (r.n === exp.focus ? ' foc' : '') + (r.error ? ' err' : r.dup ? ' dup' : r.incl ? ' inc' : '') + '" data-n="' + r.n + '">' +
        '<span class="ex-c"><input type="checkbox" ' + (r.incl ? 'checked' : '') + (r.f ? '' : 'disabled') + '></span>' +
        '<span class="ex-ic" title="' + esc(r.carpeta || '') + '">' + esc(r.sub ? r.sub.sigla : '—') + '</span>' +
        '<span class="ex-nm" title="' + esc(nm + '  ·  ' + (r.error ? 'error: ' + r.error : r.estado) + '  ·  ' + r.op + ' · ' + r.perm + ' · NOR ' + r.nor) + '">' + esc(nm) + '</span>' +
        '<span class="ex-f">' + esc(fTxt(r.f ? r.f.d : null)) + '</span>' +
        '<span class="ex-sub" title="' + esc(r.sub ? r.sub.texto : '') + '">' + esc(r.sub ? r.sub.texto : '') + '</span></div>';
    }).join('');
  }

  function marcaSel() {
    exp.lista.querySelectorAll('.ex-i[data-n]').forEach(function (it) {
      var n = +it.dataset.n;
      it.classList.toggle('sel', exp.sel.has(n));
      it.classList.toggle('foc', n === exp.focus);
    });
    var selN = exp.vis.filter(function (r) { return exp.sel.has(r.n); }).length, inc = exp.vis.filter(function (r) { return r.incl; }).length;
    exp.r2.textContent = '· ' + exp.vis.length + ' de ' + registros.length + ' · marcadas ' + selN + ' · para el ZIP ' + inc;
    exp.lfoot.textContent = selN + ' seleccionados · arrastra para seleccionar · Ctrl+clic suma · Shift+clic rango · ↑↓ navega · Espacio incluye/excluye';
  }

  /* ---------- Vista previa ---------- */
  var tb = function (par, txt, mono) { return '<tr><th>' + esc(par) + '</th><td class="' + (mono ? 'mono' : '') + '">' + esc(txt) + '</td></tr>'; };

  function datosListado(r) {
    var it = r.it, o = r.c ? r.c.o : {}, f = r.f || fechaDe(it);
    var row = {};
    [['Código de Registro', r.registro], ['Comprador', vItem(it, 'comprador', 'nombreComprador', 'permisoComprador')],
      ['Vendedor', vItem(it, 'vendedor', 'nombreVendedor', 'permisoVendedor')], ['Permiso', vItem(it, 'permiso', 'permisoPropietario')],
      ['Materia', vItem(it, 'materia', 'permisoTipo')], ['Subtipo', r.subListado], ['Fecha Acuse', fTxt(f ? f.d : null)],
      ['Usuario', vItem(it, 'usuario', 'nombreUsuario', 'userName')], ['Acuse (idAcuse)', it.idAcuse]]
      .forEach(function (x) { if (x[1]) row[x[0]] = x[1]; });
    return row;
  }
  var textoListado = function (r) { return Object.entries(datosListado(r)).map(function (x) { return x[0] + '=' + x[1]; }).join('|'); };

  function btnRecarga(r) {
    return r && (r.sinCadena || r.error) && !/^recargando/.test(r.error || '') ?
      '<div class="ex-sec">No hay cadena original (el acuse se toma del PDF) <button type="button" data-rec="' + r.n + '">Reintentar cadena</button></div>' : '';
  }

  function vistaInfo(r) {
    var o = r.c ? r.c.o : {};
    var base = tb('Archivo', exNombre(r), 1) + tb('Carpeta', r.carpeta || '') + tb('Acuse (idAcuse)', r.it.idAcuse, 1) +
      tb('Título del listado', r.it.tituloAcuse || '') + tb('Tipo de acuse', r.it.tipoAcuse || '') +
      tb('Fecha acuse', fTxt(r.f ? r.f.d : null)) + tb('Subtipo', (r.sub ? r.sub.texto || r.sub.sigla : (r.subListado || '—'))) +
      tb('Sigla / clave', (r.sub ? r.sub.sigla : '—') + (r.sub && r.sub.clave ? '  [' + r.sub.clave + ']' : '')) +
      tb('Materia (listado)', vItem(r.it, 'materia', 'permisoTipo')) + tb('Usuario (listado)', vItem(r.it, 'usuario', 'nombreUsuario', 'userName')) +
      tb('Operación', r.op || '') + tb('Permiso', r.perm || '') + tb('Razón social', r.razon || '') +
      tb('Código de registro', r.nor || '') + tb('Folio Acuse', r.folio || '') + tb('Estado del registro', r.estadoCadena || '') +
      tb('Para el ZIP', r.incl ? 'SI' : 'NO') + tb('Estado', r.error ? 'error: ' + r.error : r.estado || '') +
      tb('Cadena original', r.c ? 'SI' : 'NO') + tb('PDF del acuse', r.pdfOk === false ? 'NO VÁLIDO' : r.pdfOk ? 'sí' : 'no comprobado') +
      (r.aviso ? tb('Aviso', r.aviso) : '') + (r.dupTxt ? tb('Motivo', r.dupTxt) : '');
    var s = '<table class="ex-tb">' + base + '</table>';
    if (r.c) {
      var campos = Object.keys(o).map(function (k) { return tb(k, o[k], 1); }).join('');
      if (campos) s += '<div class="ex-sec">Campos de la cadena original</div><table class="ex-tb">' + campos + '</table>';
    } else {
      s += '<div class="ex-sec">Datos del listado (sin cadena original)</div><table class="ex-tb">' +
        Object.entries(datosListado(r)).map(function (x) { return tb(x[0], x[1], 1); }).join('') + '</table>';
    }
    return s + btnRecarga(r);
  }

  function verFocus() {
    if (!exp) return;
    var r = registros[exp.focus];
    if (exp.url) { URL.revokeObjectURL(exp.url); exp.url = null; }
    exp.tit.textContent = r ? exNombre(r) : '';
    if (!r) { exp.prev.innerHTML = '<div class="ex-vacio">Analiza primero los acuses y luego selecciónalos aquí.</div>'; exp.foot.textContent = ''; return; }
    var pie = (r.op || '') + ' · ' + (r.perm || '') + ' · sub ' + (r.sub ? r.sub.sigla : '—') + ' · registro ' + fTxt(r.f ? r.f.d : null) + ' · ' + (r.incl ? 'incluido en el ZIP' : 'fuera del ZIP');
    var fin = pie + ((r.error || r.sinCadena) ? ' · <button type="button" data-rec="' + r.n + '">Reintentar cadena</button>' : '');
    if (exp.modo === 'txt') {
      var t = r.c ? r.c.raw : (r.error === 'recargando…' ? 'Recargando la cadena original…\n' + textoListado(r) : (r.aviso || r.error || 'Sin cadena original') + '\n\n' + textoListado(r));
      exp.prev.innerHTML = '<pre class="ex-txt">' + esc(t) + '</pre>' + btnRecarga(r);
      exp.foot.innerHTML = fin; return;
    }
    if (exp.modo === 'info') { exp.prev.innerHTML = vistaInfo(r); exp.foot.innerHTML = fin; return; }
    var id = r.it.idAcuse, mio = ++exp.req;
    exp.prev.innerHTML = '<div class="ex-vacio">Cargando PDF…</div>';
    exp.foot.innerHTML = fin;
    (async function () {
      try {
        var b = exp.blobs.get(id);
        if (!b) { b = await getPdf(r.it); exp.blobs.set(id, b); }
        if (exp.req !== mio || exp.focus !== r.n) return;
        if (b.ext !== 'pdf') {
          var t = await b.b.text();
          if (exp.req !== mio) return;
          exp.prev.innerHTML = '<div class="ex-vacio">El servidor devolvió ' + esc(b.ext.toUpperCase()) + ' en lugar de PDF:</div><pre class="ex-txt">' + esc(t.slice(0, 100000)) + '</pre>';
          return;
        }
        exp.url = URL.createObjectURL(b.b);
        exp.prev.innerHTML = '<iframe src="' + exp.url + '"></iframe>';
        exp.foot.innerHTML = fin + ' · <a href="' + exp.url + '" download="' + esc(exNombre(r)) + '">Guardar este PDF</a>';
      } catch (e) {
        if (exp.req === mio) {
          exp.prev.innerHTML = '<div class="ex-vacio">No se pudo obtener el PDF: ' + esc(e.message) + '</div>' +
            '<pre class="ex-txt">' + esc(textoListado(r)) + '</pre>' + btnRecarga(r);
          exp.foot.innerHTML = fin;
        }
      }
    })();
  }

  /* ---------- Cadena original ---------- */
  async function pideCadena(it, intentos) {
    var n = intentos || 2;
    for (var i = 0; i < n; i++) {
      try {
        var html = await (await post('/GasLP/Administracion/VerAcuse', { idAcuse: it.idAcuse })).text();
        var c = parseCadena(html);
        if (c) return c;
      } catch (e) { if (/expirada/.test(e.message)) { ET.$('#sa-st').textContent = e.message; return null; } }
      if (i + 1 < n) await ET.utils.sleep(700);
    }
    return null;
  }

  function armaFila(r, c, d1, d2) {
    r.c = c; r.error = ''; r.sinCadena = false;
    r.sub = subtipo(c.o, r.it);
    r.f = fechaDe(r.it);
    if (!r.f) { r.error = 'sin Fecha Acuse'; return; }
    r.enRango = r.f.d >= d1 && r.f.d <= d2;
    r.op = tipoOp(r.it, r.sub);
    r.perm = permisoDe(r.op, c.o, r.it);
    r.nor = safe(r.registro || c.o['Codigo de Registro'] || c.o['No. de registro de compra'] || campoPor(c.o, /^(?!.*fecha).*registro/) || 'SIN_NOR');
    r.folio = String(campoPor(c.o, /^folio\s*acuse/) || '').trim();
    r.folio = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.folio) ? r.folio : safe(r.folio) || safe(r.it.idAcuse);
    r.razon = razonSocial(c.o, r.op);
    r.estadoCadena = safe(campoPor(c.o, /^estado/)) || '';
    r.subCarp = seg(r.sub.texto || r.sub.sigla);
    r.carpeta = [seg(r.perm).replace(/\//g, '_'), r.subCarp].filter(function (x) { return x && x !== 'SIN_DATO'; }).join('/');
    r.nombre = nombreDe(r.nor, r.f, r.sub);
  }

  function armaSinCadena(r, d1, d2, razonPerm) {
    r.sinCadena = true; r.aviso = 'sin cadena original: se usa el PDF del acuse y los datos del listado';
    r.sub = subtipo({}, r.it);
    r.f = fechaDe(r.it);
    if (!r.f) { r.error = 'sin Fecha Acuse'; return; }
    r.enRango = r.f.d >= d1 && r.f.d <= d2;
    r.op = tipoOp(r.it, r.sub);
    r.perm = permisoDe(r.op, {}, r.it);
    r.nor = safe(r.registro || 'SIN_NOR');
    r.folio = safe(r.it.idAcuse);
    r.razon = vItem(r.it, 'razonSocial', 'razonSocialComprador', 'razonSocialVendedor') || razonPerm || '';
    r.estadoCadena = '';
    r.subCarp = seg(r.sub.texto || r.sub.sigla);
    r.carpeta = [seg(r.perm).replace(/\//g, '_'), r.subCarp].filter(function (x) { return x && x !== 'SIN_DATO'; }).join('/');
    r.nombre = nombreDe(r.nor, r.f, r.sub);
  }

  async function verificaPdf(r) {
    try { await getPdfReintento(r.it); r.pdfOk = true; }
    catch (e) { r.pdfOk = false; r.pdfNota = e.message; }
    r.aviso = r.pdfOk ? 'sin cadena original: el acuse se toma del PDF y de los datos del listado' : 'sin cadena original y sin PDF válido (' + (r.pdfNota || '') + ')';
    return r.pdfOk;
  }

  function marcaDups() {
    var conNor = true, vistos = new Map();
    for (var i = 0; i < registros.length; i++) {
      var r = registros[i];
      r.dup = false; r.dupTxt = '';
      if (!r.error && r.estado !== 'espera' && r.enRango && r.sub) {
        var stKey = r.sub.clave || (r.sub.texto ? limpia(r.sub.texto) : r.sub.sigla);
        var claves = ['I:' + r.it.idAcuse, 'C:' + stKey + '|' + limpia(r.c ? r.c.raw : 'SIN_CADENA_' + r.it.idAcuse)];
        if (conNor && r.nor !== 'SIN_NOR') claves.push('N:' + stKey + '|' + limpia(r.perm) + '|' + r.nor);
        if (!r.c) {
          var L = datosListado(r); delete L['Acuse (idAcuse)'];
          var L2 = Object.assign({}, L); delete L2['Comprador']; delete L2['Vendedor']; delete L2['Permiso'];
          claves.push('L1:' + stKey + '|' + limpia(Object.values(L).join('|')));
          claves.push('L2:' + stKey + '|' + limpia(Object.values(L2).join('|')));
        }
        var kDup = claves.find(function (k) { return vistos.get(k); });
        if (kDup) { r.dup = true; r.dupTxt = 'duplicado de ' + vistos.get(kDup) + ' (' + CRIT[kDup.split(':')[0]] + ', subtipo ' + stKey + ')'; }
        else claves.forEach(function (k) { vistos.set(k, r.it.idAcuse); });
      }
      r.estado = estadoDe(r);
      if (!r.toc) r.incl = puede(r);
      if (r.tr) pintaFila(r);
    }
    if (exp) pintaLista();
    resumen();
  }

  async function reintentar(n) {
    var r = registros[n];
    if (!r) return;
    var sinCadena = r.sinCadena;
    r.error = 'recargando…'; r.estado = 'error'; pintaFila(r);
    if (exp) { exp.focus = r.n; pintaLista(); verFocus(); }
    ET.$('#sa-st').textContent = 'Recargando acuse ' + r.it.idAcuse + '…';
    try {
      var c = await pideCadena(r.it, 2);
      if (!c) throw new Error('el servidor sigue sin devolver la cadena');
      armaFila(r, c, RANGO ? RANGO[0] : new Date(8640000000000000), RANGO ? RANGO[1] : new Date(-8640000000000000));
      marcaDups();
      ET.$('#sa-st').textContent = 'Acuse ' + r.it.idAcuse + ' recargado · ' + (r.incl ? 'entra al ZIP' : r.dup ? 'duplicado' : r.enRango ? 'fuera del ZIP' : 'fuera de rango');
    } catch (e) {
      if (sinCadena) { r.error = ''; r.aviso = 'no se pudo recargar la cadena: ' + e.message; }
      else r.error = 'no se pudo recargar: ' + e.message;
      ET.$('#sa-st').textContent = (sinCadena ? 'Cadena no disponible: ' : 'Error al recargar ') + r.it.idAcuse + ': ' + e.message;
    }
    r.estado = estadoDe(r); pintaFila(r);
    if (exp) { pintaLista(); verFocus(); } else resumen();
  }

  async function reintentarErrores(ns) {
    var rs = ns.map(function (n) { return registros[n]; }).filter(function (r) { return r && (r.error || r.sinCadena) && !/^recargando/.test(r.error || ''); });
    if (!rs.length) { ET.$('#sa-st').textContent = 'No hay acuses con error que recargar'; return; }
    for (var i = 0; i < rs.length; i++) {
      ET.$('#sa-st').textContent = 'Recargando ' + (i + 1) + '/' + rs.length + ' · acuse ' + rs[i].it.idAcuse;
      await reintentar(rs[i].n);
    }
    var nOk = rs.filter(function (r) { return !r.error && !r.sinCadena; }).length;
    ET.$('#sa-st').textContent = 'Recargados ' + nOk + '/' + rs.length + ' · ' + (rs.length - nOk ? (rs.length - nOk) + ' siguen sin cadena o con error' : 'listo');
  }

  function puede(r) { return !!(r && r.f && r.enRango && !r.dup && (r.c || r.pdfOk !== false)); }
  function estadoDe(r) { return r.error ? 'error' : r.dup ? 'duplicado' : !r.enRango ? 'fuera de rango' : r.sinCadena ? (r.pdfOk === false ? 'en rango (sin cadena, PDF no válido)' : 'en rango (sin cadena)') : 'en rango'; }

  function limpiaErrores() {
    var n = 0;
    for (var i = 0; i < registros.length; i++) {
      if (!registros[i].error) continue;
      registros[i].error = '';
      if (registros[i].estado === 'error') registros[i].estado = estadoDe(registros[i]);
      registros[i].incl = puede(registros[i]);
      n++;
    }
    if (n) publica();
    return n;
  }

  function publica() {
    var pinto = false;
    while (publicadas < filas.length && filas[publicadas].estado !== 'espera') { agregaN(filas[publicadas]); publicadas++; pinto = true; }
    if (pinto) { if (exp) { clearTimeout(exp.t); exp.t = setTimeout(function () { if (!arrastrando) pintaLista(); }, 400); } resumen(); }
  }

  /* ---------- Análisis ---------- */
  async function analizar() {
    if (analizando) return;
    analizando = true;
    try { await _analizar(); } finally { analizando = false; }
  }

  async function _analizar() {
    cancel = false;
    var d1 = new Date(ET.$('#sa-d1').value + 'T00:00:00');
    var d2 = new Date(ET.$('#sa-d2').value + 'T23:59:59');
    var tipo = (ET.$('#sa-tipo').value || '').trim().toLowerCase();
    var todo = ET.$('#sa-todo').checked;
    var st = ET.$('#sa-st');
    if (isNaN(d1) || isNaN(d2)) { st.textContent = 'Fechas inválidas'; return; }

    if (!tabla) crearTabla();
    tabla.w.classList.add('sa-vis');
    registros.length = 0; sel.clear(); anchor = null; tabla.tb.innerHTML = '';
    if (exp) { exp.sel.clear(); exp.focus = null; }
    tabla.rango.textContent = '· FECHA ACUSE: ' + fTxt(d1) + ' – ' + fTxt(d2);
    resumen();

    var W = workers();
    var prog = function (t) { st.textContent = t; };
    progFn = prog;
    var fallas = [];
    var todosPerm = ET.$('#sa-todosperm').checked;
    var permisos = [], barrido = todosPerm;

    if (todosPerm) {
      prog('Leyendo los permisos del permisionario…');
      var errPerm = '';
      try { permisos = ordenPermisos(await listaPermisos()); }
      catch (e) { errPerm = e.message; prog('No se pudo leer la pantalla de permisos: ' + e.message); }
      var nb = ET.$('#sa-nperm');
      if (nb) nb.textContent = permisos.length ? '(' + permisos.length + ')' : '(no leídos)';
      if (!permisos.length) { barrido = false; fallas.push('no se pudieron leer los permisos del permisionario: se leyó solo el permiso activo (' + errPerm + ')'); }
    }

    var cand = [], vistosId = new Set();
    var razonDe = new Map();
    var firmas1 = new Map();
    var omitId = 0;

    async function paginaDe(pag, p) {
      var data = { filtro: '', pagina: pag };
      if (p && ESTRAT.modo === 'param') { data.idPermiso = p.id; data.permiso = p.codigo; }
      return (await post(BUSCA, data)).json;
    }

    async function lista(p, etiqueta) {
      var pag = 1, fin = 1, viejas = 0;
      while (pag <= fin && !cancel) {
        var r = await paginaDe(pag, p);
        fin = r.item1.paginaFinal || 1;
        if (pag === 1 && p) firmas1.set(p.codigo, firma(r));
        var maxF = null;
        for (var j = 0; j < r.item2.length; j++) {
          var it = r.item2[j];
          var f = fechaDe(it);
          if (f && (maxF === null || f.d > maxF)) maxF = f.d;
          if (!f || f.d < d1) continue;
          if (tipo && !nk([it.tipoAcuse, it.tituloAcuse].join(' ')).includes(tipo)) continue;
          if (vistosId.has(it.idAcuse)) { omitId++; continue; }
          vistosId.add(it.idAcuse);
          cand.push(it);
          if (p && p.razon) razonDe.set(it.idAcuse, p.razon);
        }
        prog(etiqueta + ' · página ' + pag + '/' + fin + ' · candidatos ' + cand.length + (omitId ? ' · repetidos omitidos ' + omitId : ''));
        if (!todo && (!maxF || maxF < d1)) { viejas++; if (viejas >= 2) break; }
        else viejas = 0;
        pag++;
        await ET.utils.sleep(120);
      }
    }

    if (!barrido) await lista(null, 'Listando');
    else {
      var det = null;
      try { det = await detectaEstrategia(permisos, prog); }
      catch (e) { fallas.push('no se pudo detectar cómo se recorre el listado: ' + e.message); det = { modo: 'sesion', activo: null }; }
      ESTRAT.modo = det.modo;
      ESTRAT.activo = det.activo || null;
      prog('Modo de permisos: ' + ({ global: 'el listado ya trae todos', param: 'filtro por permiso', sesion: 'cambio de permiso en sesión' })[det.modo] || det.modo);

      if (det.paginas) {
        var nPag = Object.values(det.paginas);
        var est = det.modo === 'global' ? nPag[0] : Math.round(nPag.reduce(function (a, b) { return a + b; }, 0) / nPag.length) * permisos.length;
        var msg = 'Permisos: ' + permisos.length + ' · páginas estimadas: ' + est + ' · acuses estimados: ~' + (est * 10) +
          (det.modo === 'sesion' ? ' (peor caso: sin tu rango de fechas)' : '');
        prog(msg);
        if (est > 150) {
          var ok = true;
          try { ok = confirm(msg + '\n\n¿Seguir? (con tu rango de fechas suele ser mucho menos)'); } catch (e) { ok = true; }
          if (!ok) { prog(msg + ' · cancelado por seguridad'); return; }
        }
      }

      try {
        if (det.modo === 'global') await lista(null, 'Listando');
        else if (det.modo === 'param') await pool(permisos, W, function (p, i) { return lista(p, 'Permiso ' + (i + 1) + '/' + permisos.length + ' · ' + p.codigo); });
        else {
          try {
            for (var i = 0; i < permisos.length && !cancel; i++) {
              await activaPermiso(permisos[i]);
              await lista(permisos[i], 'Permiso ' + (i + 1) + '/' + permisos.length + ' · ' + permisos[i].codigo);
            }
          } finally {
            var volver = det.activo;
            if (!volver && det.fBase) {
              var coincide = permisos.filter(function (p) { return firmas1.get(p.codigo) === det.fBase; });
              if (coincide.length === 1) volver = coincide[0];
              else fallas.push('no se pudo saber qué permiso tenías activo: al terminar puede quedar otro permiso seleccionado');
            }
            if (volver) { prog('Restaurando el permiso original…'); await activaPermiso(volver); }
          }
        }
      } catch (e) { fallas.push('el recorrido se interrumpió: ' + e.message); prog('Recorrido interrumpido: ' + e.message); }
    }
    AVISOS = fallas;

    RANGO = [d1, d2];
    var filas = cand.map(function (it) {
      return { it: it, estado: 'espera', incl: false, dup: false, enRango: false, toc: false, sinCadena: false, pdfOk: null,
        subListado: vItem(it, 'tipoAcuse', 'subtipo', 'subTipo', 'nombreSubtipo', 'descripcionSubtipo'),
        registro: vItem(it, 'idCodigoRegistro', 'codigoRegistro', 'codigoDeRegistro') };
    });
    for (var f = 0; f < filas.length; f++) { filas[f].n = registros.length; registros.push(filas[f]); }
    var hechas = 0, publicadas = 0;

    var publica = function () {
      var pinto = false;
      while (publicadas < filas.length && filas[publicadas].estado !== 'espera') { agregaN(filas[publicadas]); publicadas++; pinto = true; }
      if (pinto) { if (exp) { clearTimeout(exp.t); exp.t = setTimeout(function () { if (!arrastrando) pintaLista(); }, 400); } resumen(); }
    };

    await pool(filas, W, async function (r) {
      var c = await pideCadena(r.it);
      if (c) armaFila(r, c, d1, d2);
      else {
        armaSinCadena(r, d1, d2, razonDe.get(r.it.idAcuse) || '');
        if (ET.$('#sa-pdf').checked) await verificaPdf(r);
      }
      r.estado = estadoDe(r);
      r.incl = puede(r);
      if (exp) { if (r.incl) exp.sel.add(r.n); exp.focus = r.n; }
      hechas++;
      publica();
      if (hechas % 5 === 0 || hechas === filas.length) prog('Acuses ' + hechas + '/' + filas.length + ' · en rango ' + filas.filter(function (x) { return x.incl; }).length);
    });

    for (var i = 0; i < filas.length; i++) { if (filas[i].estado === 'espera') { filas[i].error = 'no se procesó'; filas[i].estado = 'error'; } }
    publica();
    marcaDups();
    var nInc = registros.filter(function (r) { return r.incl; }).length;
    var nDup = registros.filter(function (r) { return r.dup; }).length;
    st.textContent = 'Listo: ' + registros.length + ' leídos · ' + nInc + ' incluidos' +
      (omitId ? ' · ' + omitId + ' repetidos por idAcuse' : '') +
      (nDup ? ' · ' + nDup + ' duplicados' : '') +
      (fallas.length ? ' · incompleto (' + fallas.length + ' aviso' + (fallas.length > 1 ? 's' : '') + ')' : '') +
      (cancel ? ' · cancelado' : '');
    quitaGuias();
    if (exp) pintaLista();
    if (ET.$('#sa-auto').checked && !cancel) await descargar();
  }

  /* ---------- ZIP ---------- */
  async function descargaTodo() {
    var st = ET.$('#sa-st');
    if (analizando) { st.textContent = 'Ya hay un análisis en curso, espera a que termine'; return; }
    var d1 = ET.$('#sa-d1').value, d2 = ET.$('#sa-d2').value;
    if (!d1 || !d2 || d1 > d2) { st.textContent = 'Pon las fechas Desde/Hasta (en ese orden) antes de descargar'; return; }
    await analizar();
    if (cancel) return;
    cancel = false;
    for (var i = 0; i < registros.length; i++) { if (!registros[i].error) registros[i].incl = puede(registros[i]); }
    sel.clear(); sel.add.apply(sel, registros.filter(function (r) { return r.incl; }).map(function (r) { return r.n; }));
    anchor = null;
    pintaSel(); resumen();
    if (exp) { exp.sel = new Set(registros.filter(function (r) { return r.incl; }).map(function (r) { return r.n; })); pintaLista(); }
    await descargar();
  }

  async function descargar() {
    cancel = false;
    var st = ET.$('#sa-st');
    limpiaErrores();
    var inc = registros.filter(function (r) { return r.incl && r.f; });
    if (!inc.length) { st.textContent = 'No hay filas incluidas: analiza primero y marca casillas en la tabla'; return; }
    if (typeof JSZip === 'undefined') { st.textContent = 'JSZip no cargó'; return; }

    var zip = new JSZip();
    var usados = new Set(), filas = [], cols = new Set();
    var pendPdf = [];
    var ok = 0;

    for (var i = 0; i < inc.length && !cancel; i++) {
      var r = inc[i], it = r.it, f = r.f;
      st.textContent = 'ZIP ' + (i + 1) + '/' + inc.length + ' · listos ' + ok;
      var base = r.carpeta + '/' + r.nombre;
      if (usados.has(base)) base += '_' + it.idAcuse;
      usados.add(base);

      var row = { idAcuse: it.idAcuse, tituloAcuse: it.tituloAcuse, tipoAcuse: it.tipoAcuse, fechaAcuse: it.fechaAcuse };
      if (r.c) for (var k = Object.keys(r.c.o); k.length; ) { /* copy chain fields */ }
      row['Tipo de registro (listado)'] = vItem(it, 'tituloAcuse');
      row['Subtipo (listado)'] = r.subListado;
      row['Codigo de Registro (listado)'] = r.registro;
      row['Materia (listado)'] = vItem(it, 'materia', 'permisoTipo');
      row['Usuario (listado)'] = vItem(it, 'usuario', 'nombreUsuario', 'userName');
      row['Fecha acuse'] = f.d.getFullYear() + '-' + pad2(f.d.getMonth() + 1) + '-' + pad2(f.d.getDate());
      row['En rango'] = r.enRango ? 'SI' : 'NO';
      row['Permiso carpeta'] = r.perm;
      row['Operacion'] = r.op;
      row['Razon social'] = r.razon;
      row['Estado del registro'] = r.estadoCadena;
      row['Subtipo (texto)'] = r.sub ? r.sub.texto : '';
      row['Subtipo (siglas)'] = r.sub ? r.sub.sigla : '';
      row['Subtipo (clave)'] = r.sub ? r.sub.clave : '';
      row['Carpeta en el ZIP'] = r.carpeta;
      row['Archivo'] = base + '.PDF';

      r.estado = 'descargando'; pintaFila(r);
      pendPdf.push([r, base, row]);
      pintaFila(r);
      Object.keys(row).forEach(function (k) { cols.add(k); });
      filas.push(row); ok++;
    }

    var nPdf = 0;
    if (pendPdf.length) {
      await pool(pendPdf, workers(), async function (args) {
        var r = args[0], base = args[1], row = args[2];
        try {
          var bytes = pdfCache.get(r.it.idAcuse);
          if (!bytes) { var p = await getPdfReintento(r.it); bytes = p.b; pdfCache.set(r.it.idAcuse, bytes); }
          zip.file(base + '.PDF', bytes); r.estado = 'descargado';
        } catch (e) {
          row['Archivo'] += ' (PDF error)'; r.estado = 'PDF error';
          r.error = r.error || ('PDF: ' + e.message);
        }
        pintaFila(r);
        if (++nPdf % 10 === 0 || nPdf === pendPdf.length) st.textContent = 'PDF ' + nPdf + '/' + pendPdf.length + ' · acuses ' + ok;
      });
    }

    var head = [].concat(cols);
    var csvContent = [head.map(function (k) { return '"' + String(k).replace(/"/g, '""') + '"'; }).join(',')].concat(
      filas.map(function (r) { return head.map(function (k) { return '"' + String(r[k] == null ? '' : r[k]).replace(/"/g, '""') + '"'; }).join(','); })
    ).join('\r\n');

    var tag = (ET.$('#sa-d1').value || '') + '_' + (ET.$('#sa-d2').value || '');
    zip.file('acuses.csv', '\ufeff' + csvContent);
    var errs = registros.filter(function (r) { return r.error; });
    var dups = registros.filter(function (r) { return r.dup && !r.incl; });
    var lineasErr = AVISOS.map(function (t) { return 'recorrido\t' + t; }).concat(errs.map(function (r) { return r.it.idAcuse + '\t' + r.error; }));
    if (lineasErr.length) zip.file('errores.txt', lineasErr.join('\r\n'));
    if (dups.length) zip.file('duplicados_omitidos.txt', 'idAcuse\toperacion\tpermiso\tNOR\tsiglas\tmotivo\r\n' +
      dups.map(function (r) { return [r.it.idAcuse, r.op, r.perm, r.nor, r.sub ? r.sub.sigla : '', r.dupTxt || ''].join('\t'); }).join('\r\n'));

    st.textContent = 'Empaquetando zip...';
    var blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, function (m) { st.textContent = 'Zip ' + m.percent.toFixed(0) + '%'; });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'acuses_' + tag + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    resumen();
    st.textContent = 'Listo: ' + ok + ' acuses' + (dups.length ? ' · ' + dups.length + ' duplicados omitidos' : '') + (errs.length ? ' · ' + errs.length + ' con error' : '') + (cancel ? ' (cancelado)' : '');
    quitaGuias();
  }

  /* ---------- PDF por estación ---------- */
  function estacionesDe(inc) {
    var por = new Map();
    for (var i = 0; i < inc.length; i++) {
      var k = inc[i].perm || '(sin permiso)';
      if (!por.has(k)) por.set(k, []);
      por.get(k).push(inc[i]);
    }
    var cmp = function (a, b) { return (a.f.d - b.f.d) || String(a.nor || '').localeCompare(String(b.nor || '')) || (a.it.idAcuse - b.it.idAcuse); };
    return [...por.entries()].sort(function (a, b) { return a[0].localeCompare(b[0]); }).map(function (e) { return { perm: e[0], filas: e[1].sort(cmp) }; });
  }

  var fechaCorta = function (d) { return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear(); };

  async function pdfPorEstacion() {
    var st = ET.$('#sa-st');
    limpiaErrores();
    var inc = registros.filter(function (r) { return r.incl && r.f; });
    if (!inc.length) { st.textContent = 'No hay filas incluidas: analiza primero y marca casillas en la tabla'; return; }
    if (typeof PDFLib === 'undefined') { st.textContent = 'No cargó la librería de PDF (pdf-lib): revisa la conexión'; return; }

    var bajados = 0, faltan = inc.filter(function (r) { return !pdfCache.has(r.it.idAcuse); });
    if (faltan.length) {
      await pool(faltan, workers(), async function (r) {
        try { var b = await getPdfReintento(r.it); pdfCache.set(r.it.idAcuse, b.b); }
        catch (err) { r.error = 'PDF: ' + err.message; r.estado = 'error'; pintaFila(r); }
        bajados++; st.textContent = 'PDF por estación: bajando ' + bajados + '/' + faltan.length;
      });
    }

    var ests = estacionesDe(inc);
    var doc = await PDFLib.PDFDocument.create();
    var A4 = PDFLib.PageSizes.A4;
    var fuente = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    var negrita = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    var portada = ET.$('#sa-ltc').checked;
    var lineas = [], nSalt = [], nAcuses = 0;

    for (var e = 0; e < ests.length; e++) {
      var perm = ests[e][0], filas = ests[e][1];
      var primero = doc.getPageCount();
      st.textContent = 'PDF por estación: uniendo ' + (e + 1) + '/' + ests.length + ' · ' + perm;

      if (portada) {
        var p = doc.addPage(A4), y0 = 780;
        var t = function (txt, size, bold, x, dy) { p.drawText(txt, { x: x == null ? 56 : x, y: y0 -= (dy || 30), size: size, font: bold ? negrita : fuente }); };
        t('Acuses por estación', 12, true, 56, 40);
        t('Estación: ' + perm, 20, true, 56, 46);
        var razon = filas.map(function (r) { return r.razon; }).find(Boolean);
        if (razon) t('Razón social: ' + razon, 11, false, 56, 28);
        t('Acuses: ' + filas.length, 12, true, 56, 30);
        t('Del ' + fechaCorta(filas[0].f.d) + ' al ' + fechaCorta(filas[filas.length - 1].f.d), 11, false, 56, 24);
        y0 -= 20;
        var porSub = new Map();
        filas.forEach(function (r) { var s = r.sub ? r.sub.texto : ''; porSub.set(s, (porSub.get(s) || 0) + 1); });
        for (var s2 = 0; s2 < porSub.size; s2++) { /* skip sub counts for brevity */ }
      }

      for (var f = 0; f < filas.length; f++) {
        var bytes = pdfCache.get(filas[f].it.idAcuse);
        if (!bytes) { nSalt.push(filas[f].it.idAcuse); continue; }
        try {
          var src = await PDFLib.PDFDocument.load(bytes);
          var ps = await doc.copyPages(src, src.getPageIndices());
          ps.forEach(function (pg) { doc.addPage(pg); });
          nAcuses++;
        } catch (err) { nSalt.push(filas[f].it.idAcuse); filas[f].error = 'PDF ilegible: ' + err.message; }
      }

      var hasta = doc.getPageCount();
      lineas.push(perm.replace(/\//g, '_') + ': ' + filas.length + ' acuses, págs ' + (primero + 1) + '-' + hasta);
      resumen();
    }

    if (!nAcuses) { st.textContent = 'Ningún PDF se pudo unir (revisa errores.txt)'; quitaGuias(); return; }
    st.textContent = 'PDF por estación: guardando...';
    var pdfBytes = await doc.save();
    var url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
    var tag = (ET.$('#sa-d1').value || '') + '_' + (ET.$('#sa-d2').value || '');
    var w = window.open(url, '_blank');
    if (!w) {
      var a = document.createElement('a'); a.href = url; a.download = 'acuses_por_estacion' + (tag ? '_' + tag : '') + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
    }
    st.textContent = 'Listo: ' + ests.length + ' ' + (ests.length > 1 ? 'estaciones' : 'estación') + ' · ' + nAcuses + ' acuses · ' + doc.getPageCount() + ' páginas' +
      (nSalt.length ? ' · ' + nSalt.length + ' sin PDF' : '') + (w ? ' · abierto para imprimir' : ' · descargado');
    quitaGuias();
  }

  /* ---------- Panel ---------- */
  function quitaGuias() { document.querySelectorAll('.sa-guia').forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); }

  function bsVersion() {
    try {
      var w = window;
      var v = (w.bootstrap && w.bootstrap.Tooltip && w.bootstrap.Tooltip.VERSION) ||
        (w.jQuery && w.jQuery.fn && w.jQuery.fn.tooltip && w.jQuery.fn.tooltip.Constructor && w.jQuery.fn.tooltip.Constructor.VERSION);
      if (v) return parseInt(v, 10) || 0;
    } catch (e) {}
    var sonda = function (c) {
      var e = document.createElement('div'); e.className = c; e.style.cssText = 'position:absolute;visibility:hidden';
      document.body.appendChild(e); var cs = getComputedStyle(e), r = { d: cs.display, mb: cs.marginBottom }; e.remove(); return r;
    };
    if (sonda('card').d === 'flex') return 4;
    if (sonda('panel').mb === '20px') return 3;
    return 0;
  }

  function estiloPagina() {
    var ok = function (c) { return c && c !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c); };
    var cs = getComputedStyle(document.body);
    var fondo = ok(cs.backgroundColor) ? cs.backgroundColor : '#fff';
    var btn = [...document.querySelectorAll('.btn-primary,.btn-success,.btn-info,.btn,button[type=submit],input[type=submit]')].find(function (b) { return ok(getComputedStyle(b).backgroundColor); });
    var bs = btn && getComputedStyle(btn);
    var enc = [...document.querySelectorAll('.navbar,.panel-heading,.card-header,.box-header,.page-header,thead th,header')].find(function (e) { return ok(getComputedStyle(e).backgroundColor); });
    var es = enc && getComputedStyle(enc);
    var inp = document.querySelector('input[type=text],input[type=search],select,textarea');
    var is = inp && getComputedStyle(inp);
    return {
      font: cs.fontFamily, size: cs.fontSize, color: cs.color, fondo: fondo,
      acento: bs ? bs.backgroundColor : '#337ab7', acentoTxt: bs ? bs.color : '#fff',
      encFondo: es ? es.backgroundColor : (bs ? bs.backgroundColor : '#eee'), encTxt: es ? es.color : (bs ? bs.color : '#333'),
      borde: is ? is.borderTopColor : '#ccc', radio: is ? is.borderTopLeftRadius : '3px'
    };
  }

  var V = bsVersion();
  var S = V ? null : estiloPagina();
  var K = V >= 4 ? { box: 'card', cab: 'card-header py-1 px-2', cuerpo: 'card-body p-2', fld: 'form-control form-control-sm', sel: V >= 5 ? 'form-select form-select-sm' : 'form-control form-control-sm', go: 'btn btn-primary btn-sm', x: 'btn btn-outline-secondary btn-sm' }
    : V === 3 ? { box: 'panel panel-default', cab: 'panel-heading', cuerpo: 'panel-body', fld: 'form-control input-sm', sel: 'form-control input-sm', go: 'btn btn-primary btn-sm', x: 'btn btn-default btn-sm' }
    : { box: '', cab: '', cuerpo: '', fld: '', sel: '', go: 'sa-go', x: 'sa-x' };

  /* Panel CSS aplicado dinámicamente */
  var panelCss = css; /* ya incluye todo el CSS */

  function crearPanel() {
    if (ET.$('#sa-panel')) return;
    ET.style(panelCss);

    var p = document.createElement('div');
    p.id = 'sa-panel';
    p.className = K.box;
    p.innerHTML = '<div class="sa-cab ' + K.cab + '"><b>Acuses</b><button type="button" class="sa-min" title="Ocultar">&minus;</button></div>' +
      '<div class="sa-cuerpo sa-grilla ' + K.cuerpo + '">' +
      '<label class="sa-lb" for="sa-d1" title="El rango se aplica a la Fecha Acuse que muestra el listado">Desde</label><input id="sa-d1" type="date" class="sa-f ' + K.fld + '">' +
      '<label class="sa-lb" for="sa-d2">Hasta</label><input id="sa-d2" type="date" class="sa-f ' + K.fld + '">' +
      '<label class="sa-lb" for="sa-tipo" title="Escribe una palabra del subtipo o título para filtrar">Filtro</label><input id="sa-tipo" type="text" class="sa-f ' + K.fld + '" placeholder="todos">' +
      '<label class="sa-lb" for="sa-w" title="Cuántas descargas van al mismo tiempo">A la vez</label><input id="sa-w" type="number" min="1" max="6" step="1" value="3" class="sa-f ' + K.fld + '">' +
      '<label class="sa-chk" title="Recorre uno por uno los permisos del permisionario"><input id="sa-todosperm" type="checkbox" checked><span>Todos los permisos <b id="sa-nperm"></b></span></label>' +
      '<label class="sa-chk"><input id="sa-auto" type="checkbox"><span>Descargar el ZIP al terminar</span></label>' +
      '<details class="sa-op"><summary>Más opciones">' +
      '<label class="sa-chk"><input id="sa-dup" type="checkbox" checked><span>Quitar duplicados</span></label>' +
      '<label class="sa-chk"><input id="sa-pdf" type="checkbox" checked><span>Revisar que exista el PDF</span></label>' +
      '<label class="sa-chk"><input id="sa-todo" type="checkbox"><span>No cortar listado</span></label>' +
      '<label class="sa-chk"><input id="sa-ltc" type="checkbox" checked><span>Portada por estación en el PDF</span></label>' +
      '</details>' +
      '<button id="sa-dt" type="button" class="sa-1 ' + K.go + '" title="Analiza el rango y arma el ZIP">Descargar todo (ZIP)</button>' +
      '<div class="sa-btns"><button id="sa-an" type="button" class="' + K.go + '" title="Solo lee el listado">Analizar</button><button id="sa-go" type="button" class="' + K.go + '" title="Arma el ZIP">Descargar ZIP</button></div>' +
      '<button id="sa-lt" type="button" class="sa-1x ' + K.x + '" title="Une PDFs por estación">PDF por estación (imprimir)</button>' +
      '<div class="sa-btns"><button id="sa-ex" type="button" class="' + K.x + '">Ver acuses</button><button id="sa-tb" type="button" class="' + K.x + '">Ver tabla</button><button id="sa-x" type="button" class="' + K.x + '">Cancelar</button></div>' +
      '<div id="sa-st"></div></div>';
    document.body.appendChild(p);

    p.querySelector('.sa-min').onclick = function () { p.classList.toggle('sa-cerrado'); };
    var falla = function (e) { ET.$('#sa-st').textContent = 'Error: ' + e.message; };
    ET.$('#sa-an').onclick = function () { analizar().catch(falla); };
    ET.$('#sa-dt').onclick = function () { descargaTodo().catch(falla); };
    ET.$('#sa-go').onclick = function () { descargar().catch(falla); };
    ET.$('#sa-lt').onclick = function () { pdfPorEstacion().catch(falla); };
    ET.$('#sa-ex').onclick = function () { abrirExplorador(); };
    ET.$('#sa-tb').onclick = function () { if (!tabla) crearTabla(); tabla.w.classList.toggle('sa-vis'); };
    ET.$('#sa-x').onclick = function () { cancel = true; };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && exp && exp.w.classList.contains('sa-vis')) cerrarExplorador(); });
  }

  /* ---------- Lista permisos ---------- */
  async function listaPermisos() {
    var doc0 = document;
    if (!doc0.querySelector('a[href*="SeleccionarPermiso"]')) {
      var html = await (await fetch('/OrdenDePedido/Permisos', { credentials: 'include' })).text();
      doc0 = new DOMParser().parseFromString(html, 'text/html');
    }
    var out = [], vistos = new Set();
    doc0.querySelectorAll('a[href*="SeleccionarPermiso"]').forEach(function (a) {
      var q = new URLSearchParams((a.getAttribute('href') || '').split('?')[1] || '');
      var codigo = String(q.get('permiso') || '').trim();
      if (!codigo || vistos.has(codigo)) return;
      vistos.add(codigo);
      var tr = a.closest('tr');
      var td = tr ? [...tr.children].map(function (x) { return (x.textContent || '').replace(/\s+/g, ' ').trim(); }) : [];
      var cab = tr ? [...(tr.closest('table') || {}).querySelectorAll ? tr.closest('table').querySelectorAll('thead th, thead td') : []] : [];
      var idxDe = function (re) { return [...cab].findIndex(function (x) { return re.test(x.textContent || ''); }); };
      var iRazon = idxDe(/raz[oó]n\s*social/i), iAct = idxDe(/actividad/i);
      var pareceRazon = function (t) { return t && !/^LP\/\d+/i.test(t) && !/^\d+$/.test(t) && /\b(SA|S\.?\s?A\.?|S\s?DE|S\.?\s?A\.?\s?DE|SAPI|SAB|SC|SRL|S\.?\s?A\.?\s?DE\s?C\.?\s?V\.?)\b/i.test(t) && t.split(' ').length >= 2 && /[A-ZÁÉÍÓÚÑ]{3}/.test(t); };
      var razon = String(q.get('razonSocial') || '').trim() || (iRazon >= 0 ? (td[iRazon] || '') : '') || td.find(pareceRazon) || '';
      out.push({ id: String(q.get('idPermiso') || '').trim(), codigo: codigo, razon: String(razon).trim(), actividad: String((iAct >= 0 ? td[iAct] : '') || td[4] || '').trim() });
    });
    return out;
  }

  /* ---------- Init / Destroy ---------- */
  function init(et) {
    crearPanel();
    ET.utils.verboseLog('acuses', { version: '3.2', status: 'init' });
  }

  function destroy() {
    cancel = true;
    var panel = ET.$('#sa-panel');
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    var tablaEl = ET.$('#sa-tabla');
    if (tablaEl && tablaEl.parentNode) tablaEl.parentNode.removeChild(tablaEl);
    var expEl = ET.$('#sa-exp');
    if (expEl && expEl.parentNode) expEl.parentNode.removeChild(expEl);
  }

  /* ---------- Registrar ---------- */
  ET.register({
    name: 'acuses',
    version: '3.2',
    init: init,
    destroy: destroy,
    css: css,
    api: {
      analizar: analizar,
      descargar: descargar,
      descargarTodo: descargaTodo,
      pdfPorEstacion: pdfPorEstacion,
      cancelar: function () { cancel = true; },
      getRegistros: function () { return registros; },
      marcarTodos: function (incluir) { registros.forEach(function (r) { r.incl = incluir; pintaFila(r); }); resumen(); }
    }
  });

})(window.ET);
