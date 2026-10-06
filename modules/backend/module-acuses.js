// ==UserScript==
// @name         SIRETRAC - Descarga de acuses (cadena original)
// @namespace    local.siretrac
// @version      3.2
// @description  ZIP de acuses de TODOS los permisos del permisionario: solo PDFs, en carpeta Permiso/Subtipo (archivo NOR-Fecha-Subtipo.PDF) y, en la raíz, acuses.csv más los errores y duplicados que haya. Además une los acuses de cada estación en un solo PDF (todos los subtipos, ordenados por Fecha Acuse y con portada por estación) para imprimir por lotes. El Subtipo real (tipoAcuse) manda, nunca el Tipo de registro; rango solo por Fecha Acuse; duplicados por contenido; acuses sin cadena válidos si su PDF existe. Cada PDF se reintenta hasta 3 veces si el servidor falla o devuelve HTML en vez del acuse, y no se vuelve a bajar lo ya bajado. Panel compacto con tabla y explorador PDF/TXT; al terminar el recorrido desaparecen las guías de uso.
// @include      /.*\/GasLP\/Administracion\/Acuse.*/
// @include      /.*\/OrdenDePedido\/Permisos.*/
// @run-at       document-idle
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  if (document.getElementById('sa-panel')) return;   // nunca dos paneles en la misma página
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let cancel = false, analizando = false;
  const ESTRAT = { modo: 'global' };   // cómo se recorren los permisos: global | param | sesion

  // Espera creciente entre reintentos: ~0.4 s, ~1.2 s, ~2.5 s
  const esperaFallo = k => sleep(400 * (k * 2 * k + 1));

  // Red con REINTENTOS. Un 401 es sesión caducada: no se reintenta, se avisa y se detiene.
  async function post(url, data, reintentos) {
    const n = reintentos == null ? 2 : reintentos;
    for (let k = 0; ; k++) {
      try {
        const r = await fetch(url, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams(data)
        });
        if (r.status === 401) { const e = new Error('Sesión expirada'); e.fatal = true; throw e; }
        if ((r.status === 429 || r.status >= 500) && k < n) { await esperaFallo(k); continue; }
        if (!r.ok) throw new Error(url + ' -> ' + r.status);
        return r;
      } catch (e) {
        if (e.fatal || k >= n) throw e;
        await esperaFallo(k);
      }
    }
  }

  // Pool: N funciones a la vez sobre una cola, respetando "Cancelar".
  async function pool(items, n, fn) {
    let i = 0;
    const W = Math.max(1, Math.min(6, n | 0 || 1));
    await Promise.all(Array.from({ length: W }, async () => {
      while (i < items.length && !cancel) { const k = i++; await fn(items[k], k); await sleep(40); }
    }));
    return W;
  }
  const workers = () => { const w = $('#sa-w'); const v = w ? parseInt(w.value, 10) : NaN; return isNaN(v) ? 3 : v; };
  const BUSCA = '/GasLP/Administracion/BuscaAcuse';

  // ---------- Permisos del permisionario ----------
  // La pantalla "Cambiar permiso" (OrdenDePedido/Permisos) ya trae los permisos en el HTML
  // (DataTable del cliente, sin paginación de servidor) y el id real está en el href de
  // "SeleccionarPermiso": la columna "Id Permiso" del HTML siempre trae 0 y no sirve.
  async function listaPermisos() {
    // Si la pantalla de permisos ya está a la vista (o llegó como modal dentro de esta misma página)
    // se lee del DOM de una vez, sin volver a pedirla por red.
    let doc0 = document;
    if (!doc0.querySelector('a[href*="SeleccionarPermiso"]'))
      doc0 = new DOMParser().parseFromString(
        await (await fetch('/OrdenDePedido/Permisos', { credentials: 'include' })).text(), 'text/html');
    const out = [], vistos = new Set();
    doc0.querySelectorAll('a[href*="SeleccionarPermiso"]').forEach(a => {
      const q = new URLSearchParams((a.getAttribute('href') || '').split('?')[1] || '');
      const codigo = String(q.get('permiso') || '').trim();   // el href puede traer saltos de línea
      if (!codigo || vistos.has(codigo)) return;
      vistos.add(codigo);
      const tr = a.closest('tr');
      const td = tr ? [...tr.children].map(x => (x.textContent || '').replace(/\s+/g, ' ').trim()) : [];
      // La razón social ya NO decide la carpeta del ZIP (esa es Permiso/Subtipo): se guarda para la
      // tabla, el CSV y los acuses sin cadena, donde es la única fuente (ahí no viene en el listado).
      // El href suele traerla vacía y la columna puede no ser la
      // que se supone, así que se busca por el encabezado de la tabla y, si no aparece, se toma la
      // celda que de verdad parece una razón social: varias palabras con letra grande y terminación
      // de sociedad (SA de CV, S de RL, SAPI...), que nunca es el permiso, un número ni la actividad.
      const cab = tr ? [...(tr.closest('table') || { }).querySelectorAll
        ? tr.closest('table').querySelectorAll('thead th, thead td') : []] : [];
      const idxDe = re => [...cab].findIndex(x => re.test(x.textContent || ''));
      const iRazon = idxDe(/raz[oó]n\s*social/i), iAct = idxDe(/actividad/i);
      const pareceRazon = t => t && !/^LP\/\d+/i.test(t) && !/^\d+$/.test(t) &&
        /\b(SA|S\.?\s?A\.?|S\s?DE|S\.?\s?A\.?\s?DE|SAPI|SAB|SC|SRL|S\.?\s?A\.?\s?DE\s?C\.?\s?V\.?)\b/i.test(t) &&
        t.split(' ').length >= 2 && /[A-ZÁÉÍÓÚÑ]{3}/.test(t);
      const razon = String(q.get('razonSocial') || '').trim() ||
        (iRazon >= 0 ? (td[iRazon] || '') : '') ||
        td.find(pareceRazon) || '';
      out.push({ id: String(q.get('idPermiso') || '').trim(), codigo, razon: String(razon).trim(),
        actividad: String((iAct >= 0 ? td[iAct] : '') || td[4] || '').trim() });
    });
    return out;
  }

  // La planta de distribución se barre AL FINAL: si un acuse sale en la estación y en la planta,
  // gana la copia de la estación (y el archivo queda en la carpeta de su propio permiso).
  const esPlantaDist = p => /distribuidor|\/dist\//i.test(p.actividad + ' ' + p.codigo);
  const ordenPermisos = ps => ps.slice().sort((a, b) => (esPlantaDist(a) ? 1 : 0) - (esPlantaDist(b) ? 1 : 0));

  // Cambia el permiso activo SIN navegar (misma pestaña, sesión incluida).
  async function activaPermiso(p) {
    const q = new URLSearchParams({ idPermiso: p.id, permiso: p.codigo, idPermisionario: '0',
      idPermisoMateria: '0', idPermisoActividad: '0', razonSocial: p.razon || '', estatus: 'False', capacidadOperativa: '0' });
    await fetch('/OrdenDePedido/SeleccionarPermiso?' + q, { credentials: 'include' });
  }

  // ---------- Cómo hay que recorrer los permisos ----------
  // NO se puede decidir mirando los campos del listado: una sola página trae acuses de VARIOS
  // permisos (el permisoPropietario cambia de fila en fila), así que contar propietarios da
  // "el listado ya es global" casi siempre y se dejan de barrer los demás permisos.
  // Se decide comparando el MISMO listado con dos permisos activados distintos.
  const firma = r => (r.item2 || []).map(i => i.idAcuse).join(',') + '|' + ((r.item1 && r.item1.paginaFinal) || 1);

  // El permiso que el usuario tenía activo. Primero se busca en la pantalla (es lo que SIRETRAC
  // muestra arriba); si no aparece, se deduce al final comparando la firma del listado inicial.
  function permisoEnPantalla(codigos) {
    const m = String((document.body.innerText || '')).match(/LP\/\d+\/[A-Z]+\/[A-Za-z]+\/\d{4}/);
    return m && codigos.has(m[0]) ? m[0] : null;
  }

  // 3-4 peticiones. Deja la sesión en un permiso conocido y devuelve cómo hay que recorrer:
  //   global -> el listado no cambia con el permiso activo: una sola pasada, no se toca la sesión.
  //   param  -> el servidor acepta idPermiso/permiso: los permisos se pueden pedir en paralelo.
  //   sesion -> hay que activar cada permiso con SeleccionarPermiso (y restaurarlo al salir).
  async function detectaEstrategia(permisos, prog) {
    const codigos = new Set(permisos.map(p => p.codigo));
    const pantalla = permisoEnPantalla(codigos);
    const activo = permisos.find(p => p.codigo === pantalla) || null;
    const lee = async extra => (await post(BUSCA, Object.assign({ filtro: '', pagina: 1 }, extra || {}))).json();

    const fBase = firma(await lee());                       // estado en el que está la sesión ahora
    const A = permisos.find(p => !activo || p.codigo !== activo.codigo) || permisos[0];
    const B = permisos.find(p => p !== A) || A;
    if (!A) return { modo: 'global', activo, fBase };

    prog('Comprobando si el listado depende del permiso activo…');
    await activaPermiso(A);
    const rA = await lee(), fA = firma(rA);
    if (B !== A) { await activaPermiso(B); }
    const rB = B === A ? rA : await lee(), fB = firma(rB);
    const paginas = {};
    paginas[A.codigo] = (rA.item1 && rA.item1.paginaFinal) || 1;
    if (B !== A) paginas[B.codigo] = (rB.item1 && rB.item1.paginaFinal) || 1;

    if (fA === fB) {                                        // el listado es igual con ambos permisos
      if (activo) await activaPermiso(activo);
      return { modo: 'global', activo, fBase, paginas };
    }
    // El listado SÍ depende del permiso. ¿Se le puede pedir uno concreto sin cambiar la sesión?
    if (B !== A) {
      const fParam = firma(await lee({ idPermiso: A.id, permiso: A.codigo }));
      if (fParam === fA) {                                  // el parámetro funciona: no hay que cambiar nada
        if (activo) await activaPermiso(activo);
        return { modo: 'param', activo, fBase, paginas };
      }
    }
    if (activo) await activaPermiso(activo);
    return { modo: 'sesion', activo, fBase, paginas };
  }

  // La cadena original llega como un nodo de texto del HTML:
  //   "Codigo de Registro=LP/20517/2026/00040|Folio Acuse=<GUID>|...|Estado=Cerrada|"
  // Se toma el nodo COMPLETO (solo corta en < y >) para que un valor con comillas no lo trunque.
  function parseCadena(html) {
    const m = String(html == null ? '' : html).match(/[^<>]*?(?:Folio Acuse|Codigo de Registro)=[^<>]*/);
    if (!m) return null;
    const txt = new DOMParser().parseFromString(m[0], 'text/html').body.textContent;
    const o = {};
    txt.split('|').forEach(p => {
      const i = p.indexOf('=');
      if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    if (!Object.keys(o).length) return null;
    return { raw: txt.trim(), o };
  }

  const MES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
  const mk = (y, m, d) => {
    y = +y; m = +m; d = +d;
    if (y < 100) y += 2000;
    const t = new Date(y, m - 1, d);
    return (y >= 1990 && y <= 2100 && t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d) ? t : null;
  };

  // Fecha tolerante: 14-092026, 1409/2026, 20260914, 14 sep 2026, ISO, con hora...
  function dmy(s) {
    s = String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!s) return null;
    s = s.replace(/(ene|jan|feb|mar|abr|apr|may|jun|jul|ago|aug|sep|set|oct|nov|dic|dec)[a-z]*\.?/g, (_, m) => ' ' + MES[m] + ' ')
         .replace(/\bde\b/g, ' ')
         .replace(/(\d)t(\d)/, '$1 $2')
         .replace(/\s*\d{1,2}:\d{2}.*$/, '');
    const g = s.match(/\d+/g) || [];
    if (g.length >= 3) {
      const [a, b, c] = g;
      if (a.length >= 4) return mk(a, b, c) || mk(a, c, b);
      return mk(c, b, a) || mk(c, a, b);
    }
    const D = g.join('');
    if (D.length === 8) {
      const y0 = +D.slice(0, 4);
      return (y0 >= 1990 && y0 <= 2100 && (mk(D.slice(0, 4), D.slice(4, 6), D.slice(6)) || mk(D.slice(0, 4), D.slice(6), D.slice(4, 6))))
        || mk(D.slice(4), D.slice(2, 4), D.slice(0, 2)) || mk(D.slice(4), D.slice(0, 2), D.slice(2, 4));
    }
    if (D.length === 7) {
      const y = D.slice(3), r = D.slice(0, 3), y2 = D.slice(0, 4), r2 = D.slice(4);
      return mk(y, r.slice(1), r[0]) || mk(y, r[2], r.slice(0, 2))
        || mk(y2, r2.slice(1), r2[0]) || mk(y2, r2[2], r2.slice(0, 2));
    }
    if (D.length === 6) return mk(D.slice(4), D.slice(2, 4), D.slice(0, 2));
    return null;
  }

  const nk = k => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // ÚNICA fecha que cuenta: la "Fecha Acuse" del listado. Las demás (de compra, venta, precio,
  // de registro dentro de la cadena...) se ignoran por completo.
  const fechaDe = it => {
    let s = String((it && it.fechaAcuse) || '').trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';  // sin hora: se lee en hora local, no UTC
    const d = new Date(s);
    return isNaN(d) ? null : { d, k: 'Fecha Acuse', origen: 'listado' };
  };

  // Columnas REALES del listado (item2 de /BuscaAcuse):
  //   Subtipo = tipoAcuse | Tipo de registro = tituloAcuse | Fecha Acuse = fechaAcuse
  //   Código de Registro = idCodigoRegistro | Materia = permisoTipo | Usuario = userName
  //   Comprador = permisoComprador | Vendedor = permisoVendedor | Permiso = permisoPropietario
  const vItem = (it, ...nombres) => {
    for (const n of nombres) { const v = it[n]; if (v != null && String(v).trim()) return String(v).trim(); }
    return '';
  };

  async function getPdf(it) {
    const b = await (await post('/GasLP/Administracion/ImprimirAcuse', { idAcuse: it.idAcuse })).blob();
    return { b, ext: /pdf/i.test(b.type) ? 'pdf' : /html/i.test(b.type) ? 'html' : 'bin' };
  }

  // pdf-lib y JSZip quieren bytes, no un Blob: se convierte una sola vez, al bajar el PDF. Si el
  // objeto no expone arrayBuffer() (no pasa con fetch), se devuelve tal cual.
  const comoBytes = async b => (b && typeof b.arrayBuffer === 'function') ? new Uint8Array(await b.arrayBuffer()) : b;

  // A veces el servidor contesta una página de HTML (error o sesión caída) en vez del acuse: son
  // respuestas "vivas", así que post() no las reintenta y había que pedirlo otra vez a mano.
  // Se reintenta varias veces con espera creciente antes de dar el acuse por perdido.
  // progFn lo conecta el análisis para poder avisar en la barra de estado (si no, en silencio).
  let progFn = null;
  async function getPdfReintento(it, intentos) {
    const n = intentos || 3;
    let ultimo = 'no se pudo obtener el PDF';
    for (let i = 1; i <= n; i++) {
      try {
        const r = await getPdf(it);
        if (r.ext === 'pdf') return { b: await comoBytes(r.b), ext: 'pdf' };
        ultimo = 'el servidor devolvió ' + r.ext.toUpperCase() + ' en lugar del PDF';
      } catch (e) { ultimo = e.message; }
      if (i < n) { if (progFn) progFn('PDF: reintento ' + i + '/' + (n - 1) + ' · ' + ultimo); await sleep(500 * i * i); }
    }
    throw new Error(ultimo + ' (tras ' + n + ' intentos)');
  }

  const safe = x => String(x).replace(/[\\/:*?"<>|]+/g, '_').trim();
  // PDF ya bajados (idAcuse -> bytes). El ZIP los guarda aquí y "PDF por estación" los reutiliza,
  // así que pedir el lote después del ZIP no vuelve a golpear el servidor.
  const pdfCache = new Map();

  // Tipo de operación: SOLO desde el SUBTIPO (tipoAcuse) y el texto del subtipo.
  // NUNCA desde "Tipo de registro" (tituloAcuse): no distingue y genera falsos duplicados.
  function tipoOp(it, sub) {
    const f = [sub && sub.clave, it.tipoAcuse].map(x => nk(String(x == null ? '' : x)));
    if (f.some(x => /compra/.test(x))) return 'COMPRA';
    if (f.some(x => /venta/.test(x))) return 'VENTA';
    if (f.some(x => /recep|entreg/.test(x))) return 'ENTREGA';
    if (f.some(x => /precio/.test(x))) return 'PRECIO';
    return safe(it.tipoAcuse || 'OTROS').toUpperCase() || 'OTROS';
  }

  // Busca un campo de la cadena por patrón (sin acentos, sin mayúsculas)
  const campoPor = (o, re) => {
    const k = Object.keys(o).find(k => re.test(nk(k)));
    return k ? o[k] : '';
  };

  // ---------- Sigla del subtipo = VERBO + R + TIPO  (ARR, CRC, NRC, RRC, DRC...) ----------
  // Universal: no hay lista de verbos; sale de las iniciales de CUALQUIER subtipo del listado.
  const PARE = new Set('de del la el los las un una unos unas y o en a al por con para sobre acuse acuses no num numero folio codigo tipo estado solicitud fecha'.split(' '));
  const TIPOS = ('compra C COMPRA|compras C COMPRA|venta V VENTA|ventas V VENTA|recepcion R ENTREGA|entrega E ENTREGA|' +
    'entregas E ENTREGA|inventario I INVENTARIO|factura F FACTURA|facturas F FACTURA|precio P PRECIO|precios P PRECIO|' +
    'traspaso T TRASLADO|transferencia T TRASLADO').split('|').map(s => s.split(' '));
  const limpia = t => nk(String(t == null ? '' : t)).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const palabras = t => limpia(t).split(' ').filter(x => x && !PARE.has(x) && !/^\d+$/.test(x));
  const esTipo = w => TIPOS.find(t => w.startsWith(t[0]));          // "compra..." -> [compra, C, COMPRA]
  const esCont = w => /^(registr|acuse|solicitud|document)/.test(w); // registro/registros...

  function siglaDe(texto) {
    const orig = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
    const w = palabras(orig);
    const ci = w.findIndex(esCont);                   // "Registro de ..."
    const ni = w.findIndex(esTipo);                  // "... de Compra"
    if (w.length < 2) return null;                   // muy corto: no es un subtipo
    if (ci < 0 && ni !== w.length - 1 && ni !== 0) return null;   // "Cliente: Compra de Gas Natural"
    const tipo = w[ni < 0 ? 0 : ni], [t, L, op] = esTipo(tipo) || [tipo, tipo[0].toUpperCase(), ''];
    const v = ci > 0 ? w[ci - 1] : ci < 0 ? (ni === 0 ? w[1] : w[0]) : null;
    return v ? { texto: orig, sigla: (v[0] + 'R' + L).toUpperCase(), clave: v + '-' + t, tipo: t, op }
      : { texto: orig, sigla: 'R' + L, clave: 'registro-' + t, tipo: t, op };
  }

  function subtipo(o, it) {
    // 1) columna "Subtipo" del listado = tipoAcuse. 2) campo "Subtipo" de la cadena original.
    // NUNCA se usa "Tipo de registro" (tituloAcuse): es igual para todos los acuses de un registro.
    const subtipoDe = o => Object.keys(o).filter(k => /subtipo|tipo\s*de\s*acuse/i.test(k)).flatMap(k => [o[k], k + ' ' + o[k]]);
  for (const v of [vItem(it, 'tipoAcuse', 'subtipo', 'subTipo', 'nombreSubtipo', 'descripcionSubtipo'),
      // fallback: SOLO campos que de verdad son subtipo. Escanear todas las claves del registro
      // armaba carpetas basura ("Codigo de Registro LP/30000/2026/00200") cuando no se reconoce el tipoAcuse.
      // Se prueba el valor suelto y con el nombre pegado ("Subtipo Aceptar..."), y se devuelve el valor,
      // porque el texto del subtipo acaba en el nombre de la carpeta y del TXT.
      ...subtipoDe(o),
      it.tipoAcuse])
      { const r = siglaDe(v); if (r) return r; }
    const tit = String(it.tipoAcuse || '').replace(/\s+/g, ' ').trim();
    const w = palabras(tit), ini = w.map(x => x[0]).join('').toUpperCase();
    if (w.length >= 2 && w.length <= 5) return { texto: tit, sigla: ini, clave: ini };
    const L = w.length > 1 ? (esTipo(w[0]) || [])[1] : null;   // p. ej. "Compra Especial" -> ERC
    if (L) return { texto: tit, sigla: (w[1] ? w[1][0] : 'R') + 'R' + L, clave: w[1] + '-' + w[0] };
    return { texto: '', sigla: 'SIN_TIPO', clave: 'SIN_TIPO' };
  }

  const ddmmaaaa = d => String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + d.getFullYear();
  const isoFecha = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  // Carpeta: sin barras, sin puntos al final (Windows), sin espacios dobles
  const seg = x => safe(x).replace(/\s+/g, ' ').replace(/[. ]+$/, '').slice(0, 90) || 'SIN_DATO';

  // Nombre del archivo con el SUBTIPO COMPLETO y sin siglas:
  //   LP/20517/2026/00040-29092026-Cerrar Registro de Compra
  // Así "Aceptar Registro de Compra" y "Cerrar Registro de Compra" nunca se confunden.
  const nombreDe = (nor, f, sub) => seg(nor) + '-' + ddmmaaaa(f.d) + '-' + seg(sub.texto || sub.sigla);

  // Razón social según la operación (Comprador / Suministrador).
  function razonSocial(o, op) {
    const k = Object.keys(o).find(x => /raz[oó]n\s*social/i.test(x) && (op === 'VENTA' ? /suministr|vended/i.test(x) : /comprador/i.test(x)))
      || Object.keys(o).find(x => /raz[oó]n\s*social/i.test(x));
    return seg(k ? o[k] : '');
  }

  // Permiso del acuse (define carpeta y nombre)
  function permisoDe(op, o, it) {
    const ks = Object.keys(o).filter(k => /^permiso/.test(nk(k)));
    const w = x => { const k = ks.find(k => nk(k).includes(x)); return k ? o[k] : ''; };
    // El listado ya trae las columnas "Comprador", "Vendedor" y "Permiso" del registro
    const cmp = vItem(it, 'comprador', 'permisoComprador'), vnd = vItem(it, 'vendedor', 'permisoVendedor'),
      per = vItem(it, 'permiso', 'permisoPropietario');
    const L = op === 'COMPRA' ? [w('comprador'), cmp, per]
      : op === 'VENTA' ? [w('vendedor'), w('suministrador'), vnd, per]
      : [w('propietario'), w('vendedor'), w('comprador'), per, vnd, cmp, it.permisoPropietario];
    L.push(o[ks[0]], it.permisoPropietario);
    const v = L.find(x => x && String(x).trim());
    return v ? String(v).trim() : 'SIN_PERMISO';
  }

  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';

  // ---------- Tabla de acuses: se llena en vivo; selección con arrastre tipo Explorador de Windows ----------
  const registros = [];      // una fila por acuse leído, en orden de aparición (n = posición)
  const sel = new Set();     // n de las filas seleccionadas (resaltadas)
  let anchor = null, tabla = null, arrastrando = false;
  const pad2 = n => String(n).padStart(2, '0');
  const fTxt = d => (d instanceof Date && !isNaN(d)) ? pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() : '';
  const esc = x => String(x ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const CLS = { 'en rango': 'ok', 'descargado': 'ok', 'fuera de rango': 'fuera', 'duplicado': 'dup', 'error': 'err', 'PDF error': 'err', 'descargando': 'run', 'espera': 'espera', 'en rango (sin cadena)': 'ok', 'en rango (sin cadena, PDF no válido)': 'err' };
  const CRIT = { I: 'idAcuse', C: 'cadena', N: 'NOR+subtipo', L1: 'contenido', L2: 'contenido sin permiso' };

  // Entra al ZIP todo acuse con Fecha Acuse dentro del rango y que no sea duplicado.
  // Un acuse SIN CADENA ORIGINAL también entra: lo que importa es que el PDF exista.
  // Solo se descarta si se comprobó que el servidor NO devuelve un PDF válido.
  const puede = r => !!(r && r.f && r.enRango && !r.dup && (r.c || r.pdfOk !== false));
  // Cada corrida arranca limpia: si no, un error de la corrida anterior (un PDF ilegible, una
  // cadena que no se pudo recargar) saldría en errores.txt y en la tabla como si fuera de ahora.
  const limpiaErrores = () => {
    let n = 0;
    for (const r of registros) {
      if (!r.error) continue;
      r.error = '';
      if (r.estado === 'error') r.estado = estadoDe(r);
      r.incl = puede(r);
      n++;
    }
    if (n) publica();
    return n;
  };
  // "sin cadena" NO es un error: es un acuse igual de válido, con el PDF y los datos del listado.
  const estadoDe = r => r.error ? 'error' : r.dup ? 'duplicado' : !r.enRango ? 'fuera de rango'
    : r.sinCadena ? (r.pdfOk === false ? 'en rango (sin cadena, PDF no válido)' : 'en rango (sin cadena)') : 'en rango';

  function htmlFila(r) {
    const txt = r.error ? 'error: ' + r.error : r.estado === 'espera' ? '…' : r.estado;
    return `<td class="sa-c"><input type="checkbox" ${r.incl ? 'checked' : ''} ${r.f ? '' : 'disabled'}></td>` +
      `<td>${r.n + 1}</td>` +
      `<td class="sa-d" title="Fecha Acuse del listado">${esc(r.f ? fTxt(r.f.d) : '')}</td>` +
      `<td title="${esc(r.sub ? r.sub.texto + (r.sub.clave ? ' [' + r.sub.clave + ']' : '') : '')}">${esc(r.sub ? r.sub.sigla : '')} <span class="sa-sub">${esc(r.sub ? r.sub.texto : '')}</span></td>` +
      `<td>${esc(r.op)}</td><td>${esc(r.perm)}</td><td>${esc(r.nor)}</td>` +
      `<td class="sa-e" title="${esc(r.dupTxt || r.error || r.aviso || '')}">${esc(txt)}</td>`;
  }

  function pintaFila(r) {
    if (!r.tr) { r.tr = document.createElement('tr'); r.tr.dataset.n = r.n; }
    r._on = sel.has(r.n);
    r.tr.className = 'sa-e-' + (CLS[r.estado] || 'ok') + (r._on ? ' sa-sel' : '');
    r.tr.innerHTML = htmlFila(r);
  }

  function resumen() {
    if (!tabla) return;
    const inc = registros.filter(r => r.incl && r.f);
    const ds = inc.map(r => r.f.d.getTime());
    const rango = ds.length ? fTxt(new Date(Math.min(...ds))) + ' – ' + fTxt(new Date(Math.max(...ds))) : '—';
    tabla.res.textContent = `Filas ${registros.length} · seleccionadas ${sel.size} · incluidas en el ZIP ${inc.length} · fechas de acuse ${rango}`;
  }

  function pintaSel() {
    for (const r of registros) {
      const on = sel.has(r.n);
      if (r._on !== on) { r._on = on; r.tr.classList.toggle('sa-sel', on); }
    }
    resumen();
  }

  function setIncl(ns, v) {
    ns.forEach(n => { const r = registros[n]; if (r && r.f) { r.incl = v; r.toc = true; pintaFila(r); } });
    resumen();
  }

  // Pinta una fila que ya tenía n asignado (fase de permisos: las filas nacen todas en orden).
  function agregaN(r) {
    pintaFila(r);
    const sc = tabla.sc, abajo = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 10;
    tabla.tb.appendChild(r.tr);
    if (abajo && !arrastrando) sc.scrollTop = sc.scrollHeight; // sigue la última fila si estabas al final
  }

  function agrega(r) {
    r.n = registros.length;
    registros.push(r);
    agregaN(r);
    if (exp) { clearTimeout(exp.t); exp.t = setTimeout(() => { if (!arrastrando) pintaLista(); }, 400); } // la lista se refresca sola
    resumen();
  }

  function crearTabla() {
    const w = document.createElement('div');
    w.id = 'sa-tabla';
    w.className = K.box;
    w.innerHTML = `<div class="sa-cab ${K.cab}"><span><b>Acuses</b> <span class="sa-rango"></span></span><button type="button" class="sa-min" title="Ocultar tabla">&times;</button></div>
      <div class="sa-tools">
        <button type="button" class="${K.x}" data-a="todo" title="Ctrl+A">Seleccionar todo</button>
        <button type="button" class="${K.x}" data-a="inc" title="Espacio">Incluir selección</button>
        <button type="button" class="${K.x}" data-a="exc" title="Espacio">Excluir selección</button>
        <button type="button" class="${K.x}" data-a="def" title="Marca solo lo que está en rango y no es duplicado">Restablecer</button>
        <button type="button" class="${K.x}" data-a="err" title="Vuelve a pedir la cadena original de las filas sin cadena o con error">Reintentar cadena / errores</button>
      </div>
      <div class="sa-sc" tabindex="0"><table class="sa-tbl"><thead><tr>
        <th class="sa-c"></th><th>#</th><th>Fecha acuse</th><th>Subtipo</th><th>Op.</th><th>Permiso</th><th>Código de registro</th><th>Estado</th>
      </tr></thead><tbody></tbody></table></div>
      <div class="sa-foot"><span class="sa-res"></span> <span class="sa-hint sa-guia">· Arrastra · Ctrl suma · Shift rango · Espacio incluye · Esc limpia</span></div>`;
    document.body.appendChild(w);
    const sc = w.querySelector('.sa-sc');
    tabla = { w, sc, table: w.querySelector('table'), tb: w.querySelector('tbody'), res: w.querySelector('.sa-res'), rango: w.querySelector('.sa-rango') };

    w.querySelector('.sa-min').onclick = () => w.classList.remove('sa-vis');
    w.querySelector('.sa-tools').onclick = e => {
      const b = e.target.closest('button'), a = b && b.dataset.a;
      if (!a) return;
      if (a === 'todo') { registros.forEach(r => sel.add(r.n)); pintaSel(); }
      else if (a === 'inc' || a === 'exc') setIncl([...sel], a === 'inc');
      else if (a === 'def') { registros.forEach(r => { r.incl = puede(r); pintaFila(r); }); if (exp) pintaLista(); resumen(); }
      else if (a === 'err') { reintentarErrores(registros.filter(r => r.error || r.sinCadena).map(r => r.n)); return; }
    };

    // Casilla "incluir": si la fila está dentro de una selección múltiple, aplica a todas las seleccionadas
    tabla.tb.addEventListener('change', e => {
      const tr = e.target.closest('tr[data-n]');
      if (!tr) return;
      const n = +tr.dataset.n;
      setIncl(sel.has(n) && sel.size > 1 ? [...sel] : [n], e.target.checked);
    });

    sc.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); registros.forEach(r => sel.add(r.n)); pintaSel(); }
      else if (e.key === ' ' && sel.size) {
        e.preventDefault();
        const ns = [...sel].filter(n => registros[n].f);
        setIncl(ns, !ns.every(n => registros[n].incl));
      } else if (e.key === 'Escape') { sel.clear(); pintaSel(); }
    });

    // Selección por arrastre (rectángulo), clic, Ctrl+clic y Shift+clic
    sc.addEventListener('mousedown', e => {
      if (e.button !== 0 || e.target.closest('input,button,thead')) return;
      const rc0 = sc.getBoundingClientRect();
      if (e.clientX - rc0.left >= sc.clientWidth || e.clientY - rc0.top >= sc.clientHeight) return; // barras de desplazamiento
      e.preventDefault(); sc.focus();
      const add = e.ctrlKey || e.metaKey, base = new Set(sel);
      const fila0 = e.target.closest('tr[data-n]');
      const x0 = e.clientX - rc0.left + sc.scrollLeft, y0 = e.clientY - rc0.top + sc.scrollTop;
      let cx = e.clientX, cy = e.clientY, moved = false, raf = 0, band = null;
      arrastrando = true;

      const paso = () => {
        raf = 0;
        const rc = sc.getBoundingClientRect(), s0 = sc.scrollTop, borde = 28;
        if (cy < rc.top + borde) sc.scrollTop -= Math.min(30, rc.top + borde - cy);           // autodesplazamiento
        else if (cy > rc.bottom - borde) sc.scrollTop += Math.min(30, cy - (rc.bottom - borde));
        const x1 = Math.max(0, Math.min(tabla.table.offsetWidth, cx - rc.left + sc.scrollLeft));
        const y1 = Math.max(0, Math.min(tabla.table.offsetHeight, cy - rc.top + sc.scrollTop));
        const T = Math.min(y0, y1), B = Math.max(y0, y1);
        band.style.cssText = `left:${Math.min(x0, x1)}px;top:${T}px;width:${Math.abs(x1 - x0)}px;height:${B - T}px`;
        sel.clear();
        for (const r of registros) {
          const b = r.tr.getBoundingClientRect();
          const hit = b.bottom - rc.top + sc.scrollTop >= T && b.top - rc.top + sc.scrollTop <= B;
          if (add ? base.has(r.n) !== hit : hit) sel.add(r.n); // con Ctrl invierte lo tocado
        }
        pintaSel();
        if (sc.scrollTop !== s0) raf = requestAnimationFrame(paso); // sigue desplazando mientras haya donde
      };
      const mueve = ev => {
        cx = ev.clientX; cy = ev.clientY;
        if (!moved && Math.hypot(cx - e.clientX, cy - e.clientY) < 4) return;
        if (!moved) { moved = true; band = document.createElement('div'); band.className = 'sa-band'; sc.appendChild(band); }
        if (!raf) raf = requestAnimationFrame(paso);
      };
      const suelta = ev => {
        document.removeEventListener('mousemove', mueve);
        document.removeEventListener('mouseup', suelta);
        cancelAnimationFrame(raf); raf = 0; arrastrando = false;
        if (band) band.remove();
        if (moved) { anchor = fila0 ? +fila0.dataset.n : (sel.size ? Math.min(...sel) : anchor); return; }
        const n = fila0 ? +fila0.dataset.n : null;
        if (n === null) { if (!add) { sel.clear(); pintaSel(); } return; } // clic en vacío
        if (ev.shiftKey && anchor !== null) {
          if (!add) sel.clear();
          for (let i = Math.min(anchor, n); i <= Math.max(anchor, n); i++) sel.add(i);
        } else if (add) { sel.has(n) ? sel.delete(n) : sel.add(n); anchor = n; }
        else { sel.clear(); sel.add(n); anchor = n; }
        pintaSel();
      };
      document.addEventListener('mousemove', mueve);
      document.addEventListener('mouseup', suelta);
    });
  }

  // ---------- pestaña "Ver acuses": lista tipo Explorador de Windows + vista previa ----------
  let exp = null; // { w, lista, prev, sel:Set, focus, modo, blobs:Map }

  function crearExplorador() {
    if (exp) return exp;
    const w = document.createElement('div');
    w.id = 'sa-exp';
    w.innerHTML = `<div class="sa-cab ${K.cab}"><span><b>Acuses</b> <span class="sa-r2"></span></span><button type="button" class="sa-min" title="Cerrar (Esc)">&times;</button></div>
      <div class="sa-tools">
        <input type="search" class="ex-bus ${K.fld}" placeholder="Filtrar: subtipo, código, permiso...">
        <select class="ex-est ${K.sel}">
          <option value="">Todos los estados</option><option value="incluido">Incluidos en el ZIP</option>
          <option value="noincluido">No incluidos</option><option value="dup">Duplicados</option><option value="err">Con error</option>
      <option value="sin">Sin cadena original</option>
        </select>
        <button type="button" class="${K.x}" data-a="todo" title="Ctrl+A">Todo</button>
        <button type="button" class="${K.x}" data-a="inv">Invertir</button>
        <button type="button" class="${K.x}" data-a="inc">Incluir sel.</button>
        <button type="button" class="${K.x}" data-a="exc">Excluir sel.</button>
        <button type="button" class="${K.x}" data-a="err" title="Vuelve a pedir la cadena original de los acuses sin cadena o con error">Reintentar cadena / errores</button>
        <button type="button" class="${K.go}" data-a="zip" title="Empaqueta lo marcado">Descargar ZIP</button>
      </div>
      <div class="ex-cuerpo">
        <div class="ex-lado">
          <div class="ex-i ex-h"><span></span><span class="ex-ic"></span><span>Archivo</span><span class="ex-f">F. acuse</span><span class="ex-sub">Subtipo de movimiento</span></div>
          <div class="ex-lista" tabindex="0"></div>
          <div class="ex-foot"></div>
        </div>
        <div class="ex-prev">
          <div class="ex-pcab"><span class="ex-tit"></span>
            <span class="ex-modos"><button type="button" class="${K.x}" data-m="info">Info</button><button type="button" class="${K.x}" data-m="txt">Cadena</button><button type="button" class="${K.x}" data-m="pdf">PDF</button></span>
          </div>
          <div class="ex-pbody"></div>
          <div class="ex-pfoot"></div>
        </div>
      </div>`;
    document.body.appendChild(w);
    exp = {
      w, lista: w.querySelector('.ex-lista'), prev: w.querySelector('.ex-pbody'), tit: w.querySelector('.ex-tit'),
      foot: w.querySelector('.ex-pfoot'), plist: w.querySelector('.ex-pcab'), r2: w.querySelector('.sa-r2'),
      lfoot: w.querySelector('.ex-foot'), sel: new Set(), focus: null, modo: 'info', blobs: new Map(), req: 0, anchor: null, url: null, vis: []
    };

    w.querySelector('.sa-min').onclick = () => cerrarExplorador();
    w.querySelector('.sa-tools').onclick = e => {
      const b = e.target.closest('button'), a = b && b.dataset.a;
      if (!a) return;
      const vis = exp.vis;
      if (a === 'todo') vis.forEach(r => exp.sel.add(r.n));
      else if (a === 'inv') vis.forEach(r => exp.sel.has(r.n) ? exp.sel.delete(r.n) : exp.sel.add(r.n));
      else if (a === 'inc' || a === 'exc') marcaIncl(exp.vis.filter(r => exp.sel.has(r.n)).map(r => r.n), a === 'inc');
      else if (a === 'err') { reintentarErrores(exp.vis.map(r => r.n)); return; }
      else if (a === 'zip') { descargar().catch(e => { $('#sa-st').textContent = 'Error: ' + e.message; }); return; }
      marcaSel();
    };
    w.querySelector('.ex-bus').oninput = () => { exp.sel.clear(); pintaLista(); };
    w.querySelector('.ex-est').onchange = () => { exp.sel.clear(); pintaLista(); };
    w.querySelector('.ex-modos').onclick = e => { const b = e.target.closest('button'); if (b) { exp.modo = b.dataset.m; verFocus(); } };
    // Enlaces "Reintentar cadena" del preview (info, cadena, pie del PDF)
    exp.w.addEventListener('click', e => { const b = e.target.closest('[data-rec]'); if (b) { e.preventDefault(); reintentar(+b.dataset.rec); } });

    // Casilla "incluido": refleja lo que se va a empaquetar en el ZIP
    exp.lista.addEventListener('change', e => {
      if (!e.target.matches('input[type=checkbox]')) return;
      const it = e.target.closest('.ex-i'), n = it && +it.dataset.n;
      if (n != null) marcaIncl([n], e.target.checked);
    });

    // Selección tipo Explorador: arrastre, clic, Ctrl+clic, Shift+clic, flechas y Espacio
    exp.lista.addEventListener('mousedown', e => {
      if (e.button !== 0 || e.target.closest('input,thead')) return;
      const sc = exp.lista, rc0 = sc.getBoundingClientRect();
      if (e.clientX - rc0.left >= sc.clientWidth || e.clientY - rc0.top >= sc.clientHeight) return;
      e.preventDefault(); sc.focus();
      const add = e.ctrlKey || e.metaKey;
      const item0 = e.target.closest('.ex-i'), n0 = item0 ? +item0.dataset.n : null;
      const base = new Set(exp.sel);
      const y0 = e.clientY - rc0.top + sc.scrollTop;
      let cy = e.clientY, movido = false, raf = 0, band = null;
      arrastrando = true;

      const paso = () => {
        raf = 0;
        const rc = sc.getBoundingClientRect(), s0 = sc.scrollTop, borde = 26;
        if (cy < rc.top + borde) sc.scrollTop -= Math.min(34, rc.top + borde - cy);
        else if (cy > rc.bottom - borde) sc.scrollTop += Math.min(34, cy - (rc.bottom - borde));
        const T = Math.min(y0, cy - rc.top + sc.scrollTop), B = Math.max(y0, cy - rc.top + sc.scrollTop);
        band.style.cssText = `left:0;top:${T}px;width:100%;height:${B - T}px`;
        exp.sel.clear();
        for (const it of sc.querySelectorAll('.ex-i[data-n]')) {
          const b = it.getBoundingClientRect();
          const hit = b.bottom - rc.top + sc.scrollTop >= T && b.top - rc.top + sc.scrollTop <= B;
          if (add ? base.has(+it.dataset.n) !== hit : hit) exp.sel.add(+it.dataset.n);
        }
        marcaSel();
        if (sc.scrollTop !== s0) raf = requestAnimationFrame(paso);
      };
      const mueve = ev => {
        cy = ev.clientY;
        if (!movido && Math.abs(cy - e.clientY) < 4) return;
        if (!movido) { movido = true; band = document.createElement('div'); band.className = 'ex-band'; sc.appendChild(band); }
        if (!raf) raf = requestAnimationFrame(paso);
      };
      const suelta = ev => {
        document.removeEventListener('mousemove', mueve);
        document.removeEventListener('mouseup', suelta);
        cancelAnimationFrame(raf); raf = 0; arrastrando = false;
        if (band) band.remove();
        if (movido) {
          if (n0 != null) exp.anchor = n0;
          const f = exp.vis.find(r => exp.sel.has(r.n));
          if (f) exp.focus = f.n;
          marcaSel(); verFocus(); return;
        }
        if (n0 == null) { if (!add) { exp.sel.clear(); marcaSel(); } return; }
        if (ev.shiftKey && exp.anchor != null) {
          if (!add) exp.sel.clear();
          for (const r of exp.vis) { if (r.n >= Math.min(exp.anchor, n0) && r.n <= Math.max(exp.anchor, n0)) exp.sel.add(r.n); }
        } else if (add) { exp.sel.has(n0) ? exp.sel.delete(n0) : exp.sel.add(n0); exp.anchor = n0; }
        else { exp.sel.clear(); exp.sel.add(n0); exp.anchor = n0; }
        exp.focus = n0;
        marcaSel(); verFocus();
      };
      document.addEventListener('mousemove', mueve);
      document.addEventListener('mouseup', suelta);
    });

    exp.lista.addEventListener('keydown', e => {
      const vis = exp.vis;
      if (!vis.length) return;
      const pos = vis.findIndex(r => r.n === exp.focus);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); vis.forEach(r => exp.sel.add(r.n)); marcaSel(); }
      else if (e.key === 'Escape') { e.stopPropagation(); exp.sel.clear(); marcaSel(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const np = Math.min(vis.length - 1, Math.max(0, (pos < 0 ? 0 : pos) + (e.key === 'ArrowDown' ? 1 : -1)));
        const r = vis[np];
        if (e.shiftKey) { if (exp.anchor == null) exp.anchor = r.n; if (r.n >= Math.min(exp.anchor, exp.focus ?? r.n) && r.n <= Math.max(exp.anchor, exp.focus ?? r.n)) exp.sel.add(r.n); }
        else { exp.sel.clear(); exp.sel.add(r.n); exp.anchor = r.n; }
        exp.focus = r.n; marcaSel(); verFocus();
        const fila = exp.lista.querySelector('.ex-i.foc');
        if (fila && typeof fila.scrollIntoView === 'function') fila.scrollIntoView({ block: 'nearest' });
      } else if (e.key === ' ' && exp.sel.size) {
        e.preventDefault();
        const ns = vis.filter(r => exp.sel.has(r.n) && r.f).map(r => r.n);
        marcaIncl(ns, !ns.every(n => registros[n].incl));
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
    if (exp.focus == null || !registros[exp.focus]) exp.focus = registros.findIndex(r => r.incl);
    pintaLista(); verFocus();
  }

  function marcaIncl(ns, v) {
    ns.forEach(n => { const r = registros[n]; if (r && r.f) { r.incl = v; r.toc = true; if (r.tr && r.tr.isConnected) pintaFila(r); } });
    if (exp) { exp.lista.querySelectorAll('.ex-i[data-n]').forEach(it => { const r = registros[+it.dataset.n]; if (r) it.querySelector('input').checked = r.incl; }); marcaSel(); }
    if (tabla) resumen();
  }

  function filasVisibles() {
    const w = exp.w, b = (w.querySelector('.ex-bus').value || '').toLowerCase().trim(), e = w.querySelector('.ex-est').value;
    return registros.filter(r => {
      if (e === 'incluido' && !r.incl) return false;
      if (e === 'noincluido' && r.incl) return false;
      if (e === 'dup' && !r.dup) return false;
      if (e === 'err' && !r.error) return false;
      if (e === 'sin' && !r.sinCadena) return false;
      if (b && !(r.nombre + ' ' + r.perm + ' ' + r.nor + ' ' + r.op + ' ' + (r.sub ? r.sub.sigla + ' ' + r.sub.texto : '') + ' ' + r.it.idAcuse).toLowerCase().includes(b)) return false;
      return true;
    });
  }

  const exNombre = r => (r.nombre || 'acuse_' + r.it.idAcuse) + '.PDF';

  function pintaLista() {
    exp.vis = filasVisibles();
    const inc = exp.vis.filter(r => r.incl).length, selN = exp.vis.filter(r => exp.sel.has(r.n)).length;
    exp.r2.textContent = `· ${exp.vis.length} de ${registros.length} · marcadas ${selN} · para el ZIP ${inc}`;
    exp.lfoot.textContent = `${selN} seleccionados · arrastra para seleccionar · Ctrl+clic suma · Shift+clic rango · ↑↓ navega · Espacio incluye/excluye`;
    exp.lista.innerHTML = exp.vis.map(r => {
      const nm = exNombre(r);
      return `<div class="ex-i${exp.sel.has(r.n) ? ' sel' : ''}${r.n === exp.focus ? ' foc' : ''}${r.error ? ' err' : r.dup ? ' dup' : r.incl ? ' inc' : ''}" data-n="${r.n}">` +
        `<span class="ex-c"><input type="checkbox" ${r.incl ? 'checked' : ''} ${r.f ? '' : 'disabled'}></span>` +
        `<span class="ex-ic" title="${esc(r.carpeta || '')}">${esc(r.sub ? r.sub.sigla : '—')}</span>` +
        `<span class="ex-nm" title="${esc(nm + '  ·  ' + (r.error ? 'error: ' + r.error : r.estado) + '  ·  ' + r.op + ' · ' + r.perm + ' · NOR ' + r.nor)}">${esc(nm)}</span>` +
        `<span class="ex-f">${esc(fTxt(r.f ? r.f.d : null))}</span>` +
        `<span class="ex-sub" title="${esc(r.sub ? r.sub.texto : '')}">${esc(r.sub ? r.sub.texto : '')}</span></div>`;
    }).join('');
  }

  function marcaSel() {
    exp.lista.querySelectorAll('.ex-i[data-n]').forEach(it => {
      const n = +it.dataset.n;
      it.classList.toggle('sel', exp.sel.has(n));
      it.classList.toggle('foc', n === exp.focus);
    });
    const selN = exp.vis.filter(r => exp.sel.has(r.n)).length, inc = exp.vis.filter(r => r.incl).length;
    exp.r2.textContent = `· ${exp.vis.length} de ${registros.length} · marcadas ${selN} · para el ZIP ${inc}`;
    exp.lfoot.textContent = `${selN} seleccionados · arrastra para seleccionar · Ctrl+clic suma · Shift+clic rango · ↑↓ navega · Espacio incluye/excluye`;
  }

  const tb = (par, txt, mono) => `<tr><th>${esc(par)}</th><td class="${mono ? 'mono' : ''}">${esc(txt)}</td></tr>`;

  // Lo que sabemos del acuse aunque no haya cadena original: todo lo del listado.
  function datosListado(r) {
    const it = r.it, o = {}, f = r.f || fechaDe(it);
    [['Código de Registro', r.registro], ['Comprador', vItem(it, 'comprador', 'nombreComprador', 'permisoComprador')],
      ['Vendedor', vItem(it, 'vendedor', 'nombreVendedor', 'permisoVendedor')],
      ['Permiso', vItem(it, 'permiso', 'permisoPropietario')], ['Materia', vItem(it, 'materia', 'permisoTipo')],
      ['Subtipo', r.subListado], ['Fecha Acuse', fTxt(f ? f.d : null)],
      ['Usuario', vItem(it, 'usuario', 'nombreUsuario', 'userName')], ['Acuse (idAcuse)', it.idAcuse]]
      .forEach(x => { if (x[1]) o[x[0]] = x[1]; });
    return o;
  }
  const textoListado = r => Object.entries(datosListado(r)).map(x => x[0] + '=' + x[1]).join('|');
  const btnRecarga = r => r && (r.sinCadena || r.error) && !/^recargando/.test(r.error || '') ?
    `<div class="ex-sec">No hay cadena original (el acuse se toma del PDF) <button type="button" class="${K.x}" data-rec="${r.n}">Reintentar cadena</button></div>` : '';

  function vistaInfo(r) {
    const o = r.c ? r.c.o : {};
    const base =
      tb('Archivo', exNombre(r), 1) + tb('Carpeta', r.carpeta || '') + tb('Acuse (idAcuse)', r.it.idAcuse, 1) +
      tb('Título del listado', r.it.tituloAcuse || '') + tb('Tipo de acuse', r.it.tipoAcuse || '') +
      tb('Fecha acuse', fTxt(r.f ? r.f.d : null)) +
      tb('Subtipo', (r.sub ? r.sub.texto || r.sub.sigla : (r.subListado || '—'))) +
      tb('Sigla / clave', (r.sub ? r.sub.sigla : '—') + (r.sub && r.sub.clave ? '  [' + r.sub.clave + ']' : '')) +
      tb('Materia (listado)', vItem(r.it, 'materia', 'permisoTipo')) + tb('Usuario (listado)', vItem(r.it, 'usuario', 'nombreUsuario', 'userName')) +
      tb('Operación', r.op || '') + tb('Permiso', r.perm || '') + tb('Razón social', r.razon || '') +
      tb('Código de registro', r.nor || '') + tb('Folio Acuse', r.folio || '') + tb('Estado del registro', r.estadoCadena || '') +
      tb('Para el ZIP', r.incl ? 'SI' : 'NO') + tb('Estado', r.error ? 'error: ' + r.error : r.estado || '') +
      tb('Cadena original', r.c ? 'SI' : 'NO') + tb('PDF del acuse', r.pdfOk === false ? 'NO VÁLIDO' : r.pdfOk ? 'sí' : 'no comprobado') +
      (r.aviso ? tb('Aviso', r.aviso) : '') +
      (r.dupTxt ? tb('Motivo', r.dupTxt) : '');
    let s = `<table class="ex-tb">${base}</table>`;
    if (r.c) { const campos = Object.keys(o).map(k => tb(k, o[k], 1)).join('');
      if (campos) s += '<div class="ex-sec">Campos de la cadena original</div><table class="ex-tb">' + campos + '</table>';
    } else {
      s += '<div class="ex-sec">Datos del listado (sin cadena original)</div><table class="ex-tb">' +
        Object.entries(datosListado(r)).map(([k, v]) => tb(k, v, 1)).join('') + '</table>';
    }
    return s + btnRecarga(r);
  }

  function verFocus() {
    if (!exp) return;
    const r = registros[exp.focus];
    if (exp.url) { URL.revokeObjectURL(exp.url); exp.url = null; }
    exp.tit.textContent = r ? exNombre(r) : '';
    if (!r) { exp.prev.innerHTML = '<div class="ex-vacio sa-guia">Analiza primero los acuses y luego selecciónalos aquí.</div>'; exp.foot.textContent = ''; return; }
    const pie = `${r.op || ''} · ${r.perm || ''} · sub ${r.sub ? r.sub.sigla : '—'} · registro ${fTxt(r.f ? r.f.d : null)} · ${r.incl ? 'incluido en el ZIP' : 'fuera del ZIP'}`;
    const fin = pie + ((r.error || r.sinCadena) ? ` · <button type="button" class="${K.x}" data-rec="${r.n}">Reintentar cadena</button>` : '');
    if (exp.modo === 'txt') {
      const t = r.c ? r.c.raw : (r.error === 'recargando…' ? 'Recargando la cadena original…\n' + textoListado(r)
        : (r.aviso || r.error || 'Sin cadena original') + '\n\n' + textoListado(r));
      exp.prev.innerHTML = '<pre class="ex-txt">' + esc(t) + '</pre>' + btnRecarga(r);
      exp.foot.innerHTML = fin; return;
    }
    if (exp.modo === 'info') { exp.prev.innerHTML = vistaInfo(r); exp.foot.innerHTML = fin; return; }
    // PDF: se pide bajo demanda y se cachea
    const id = r.it.idAcuse, mio = ++exp.req;
    exp.prev.innerHTML = '<div class="ex-vacio">Cargando PDF…</div>';
    exp.foot.innerHTML = fin;
    (async () => {
      try {
        let b = exp.blobs.get(id);
        if (!b) { b = await getPdf(r.it); exp.blobs.set(id, b); }
        if (exp.req !== mio || exp.focus !== r.n) return;
        if (b.ext !== 'pdf') {
          const t = await b.b.text();
          if (exp.req !== mio) return;
          exp.prev.innerHTML = '<div class="ex-vacio">El servidor devolvió ' + esc(b.ext.toUpperCase()) + ' en lugar de PDF:</div><pre class="ex-txt">' + esc(t.slice(0, 100000)) + '</pre>';
          return;
        }
        exp.url = URL.createObjectURL(b.b);
        exp.prev.innerHTML = `<iframe src="${exp.url}"></iframe>`;
        exp.foot.innerHTML = fin + ` · <a href="${exp.url}" download="${esc(exNombre(r))}">Guardar este PDF</a>`;
      } catch (e) {
        if (exp.req === mio) {
          exp.prev.innerHTML = '<div class="ex-vacio">No se pudo obtener el PDF: ' + esc(e.message) + '</div>' +
            '<pre class="ex-txt">' + esc(textoListado(r)) + '</pre>' + btnRecarga(r);
          exp.foot.innerHTML = fin;
        }
      }
    })();
  }

  // ---------- Paso 1: listar y leer cadenas (la tabla se llena en vivo) ----------
  let RANGO = null, AVISOS = [];

  // Pide la cadena original de un acuse (reintenta dos veces si el servidor falla)
  async function pideCadena(it, intentos = 2) {
    for (let n = 0; n < intentos; n++) {
      try {
        const html = await (await post('/GasLP/Administracion/VerAcuse', { idAcuse: it.idAcuse })).text();
        const c = parseCadena(html);
        if (c) return c;
      } catch (e) { if (/expirada/.test(e.message)) { $('#sa-st').textContent = e.message; return null; } }
      if (n + 1 < intentos) await sleep(700);
    }
    return null;
  }

  // Llena la fila con la cadena original. Todo sale del SUBTIPO del listado: sigla, carpeta y clave
  // de duplicado. Carpeta del ZIP: Permiso / Subtipo (dos niveles, sin razón social ni fecha).
  function armaFila(r, c, d1, d2) {
    r.c = c;
    r.error = '';
    r.sinCadena = false;
    r.sub = subtipo(c.o, r.it);
    r.f = fechaDe(r.it);
    if (!r.f) { r.error = 'sin Fecha Acuse'; return; }
    r.enRango = r.f.d >= d1 && r.f.d <= d2;
    r.op = tipoOp(r.it, r.sub);
    r.perm = permisoDe(r.op, c.o, r.it);
    r.nor = safe(r.registro || c.o['Codigo de Registro'] || c.o['No. de registro de compra'] ||
      campoPor(c.o, /^(?!.*fecha).*registro/) || 'SIN_NOR');
    const folio = String(campoPor(c.o, /^folio\s*acuse/) || '').trim();     // el Folio Acuse real es un GUID: no se usa para nombrar
    r.folio = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(folio) ? folio : safe(folio) || safe(r.it.idAcuse);
    r.razon = razonSocial(c.o, r.op);
    r.estadoCadena = safe(campoPor(c.o, /^estado/)) || '';
    r.subCarp = seg(r.sub.texto || r.sub.sigla);
    // Carpeta del ZIP: Permiso / Subtipo (dos niveles). La razón social, la fecha y el resto van en la
    // tabla y en acuses.csv, y la fecha además va en el nombre del archivo. Así todos los permisos
    // (compras con cadena y ventas sin cadena) caen en la misma estructura y nunca sueltos arriba.
    r.carpeta = [seg(r.perm).replace(/\//g, '_'), r.subCarp]
      .filter(x => x && x !== 'SIN_DATO').join('/');
    r.nombre = nombreDe(r.nor, r.f, r.sub);
  }

// Sin cadena original: NO es un error. El acuse sigue siendo válido porque existe el PDF;
// el TXT traerá los datos del listado. Si el servidor no devuelve un PDF válido, ahí sí se marca error.
// razonPerm es la razón social del permiso que se está barriendo: sin cadena no viene en el listado,
// pero el permiso sí la sabe, y así la carpeta del ZIP queda igual que la de los demás.
function armaSinCadena(r, d1, d2, razonPerm) {
    r.sinCadena = true;
    r.aviso = 'sin cadena original: se usa el PDF del acuse y los datos del listado';
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
    // Carpeta del ZIP: Permiso / Subtipo (dos niveles). La razón social, la fecha y el resto van en la
    // tabla y en acuses.csv, y la fecha además va en el nombre del archivo. Así todos los permisos
    // (compras con cadena y ventas sin cadena) caen en la misma estructura y nunca sueltos arriba.
    r.carpeta = [seg(r.perm).replace(/\//g, '_'), r.subCarp]
      .filter(x => x && x !== 'SIN_DATO').join('/');
    r.nombre = nombreDe(r.nor, r.f, r.sub);
  }

  // Un acuse sin cadena original igual es válido: lo que importa es que el PDF exista.
  // Se comprueba una sola vez para poder avisar (y excluir) si el servidor NO devuelve un PDF.
  async function verificaPdf(r) {
    try { await getPdfReintento(r.it); r.pdfOk = true; }
    catch (e) { r.pdfOk = false; r.pdfNota = e.message; }
    r.aviso = r.pdfOk ? 'sin cadena original: el acuse se toma del PDF y de los datos del listado'
      : 'sin cadena original y sin PDF válido (' + (r.pdfNota || '') + ')';
    return r.pdfOk;
  }

  // Antiduplicados (solo entre acuses dentro de rango): un acuse es duplicado si coincide el
  // CONTENIDO DE LA CADENA o el NÚMERO DE REGISTRO, y además es el MISMO SUBTIPO:
  //   idAcuse | cadena+subtipo | NOR+permiso+subtipo.
  // El NRC y el ARC del mismo NOR se conservan los dos, y el "Folio Acuse" (GUID) nunca es clave.
  function marcaDups() {
    const conNor = $('#sa-dup').checked, vistos = new Map();
    for (const r of registros) {
      r.dup = false; r.dupTxt = '';
      if (!r.error && r.estado !== 'espera' && r.enRango && r.sub) {
        const stKey = r.sub.clave || (r.sub.texto ? limpia(r.sub.texto) : r.sub.sigla);
        const claves = ['I:' + r.it.idAcuse, 'C:' + stKey + '|' + limpia(r.c ? r.c.raw : 'SIN_CADENA_' + r.it.idAcuse)];
        if (conNor && r.nor !== 'SIN_NOR') claves.push('N:' + stKey + '|' + limpia(r.perm) + '|' + r.nor);
        if (!r.c) {
          // Sin cadena original lo único comparable es el CONTENIDO DEL LISTADO. Un mismo acuse sale
          // en la estación y en la planta DIST, así que se compara sin idAcuse (L1) y también
          // ignorando las columnas de permiso (L2), para que se omita igual. Gana la primera copia.
          const L = datosListado(r);
          delete L['Acuse (idAcuse)'];
          const L2 = Object.assign({}, L);
          delete L2['Comprador']; delete L2['Vendedor']; delete L2['Permiso'];
          claves.push('L1:' + stKey + '|' + limpia(Object.values(L).join('|')));
          claves.push('L2:' + stKey + '|' + limpia(Object.values(L2).join('|')));
        }
        const kDup = claves.find(k => vistos.get(k));
        if (kDup) { r.dup = true; r.dupTxt = 'duplicado de ' + vistos.get(kDup) + ' (' + CRIT[kDup.split(':')[0]] + ', subtipo ' + stKey + ')'; }
        else claves.forEach(k => vistos.set(k, r.it.idAcuse));
      }
      r.estado = estadoDe(r);
      if (!r.toc) r.incl = puede(r);
      if (r.tr) pintaFila(r);
    }
    if (exp) pintaLista();
    resumen();
  }

  // Recarga la cadena original de un acuse sin ella (o con error) y rehace su fila.
  async function reintentar(n) {
    const r = registros[n];
    if (!r) return;
    const sinCadena = r.sinCadena;
    r.error = 'recargando…'; r.estado = 'error'; pintaFila(r);
    if (exp) { exp.focus = r.n; pintaLista(); verFocus(); }
    $('#sa-st').textContent = 'Recargando acuse ' + r.it.idAcuse + '…';
    try {
      const c = await pideCadena(r.it, 2);
      if (!c) throw new Error('el servidor sigue sin devolver la cadena');
      armaFila(r, c, ...(RANGO || [new Date(8640000000000000), new Date(-8640000000000000)]));
      marcaDups();
      $('#sa-st').textContent = `Acuse ${r.it.idAcuse} recargado · ${r.incl ? 'entra al ZIP' : r.dup ? 'duplicado' : r.enRango ? 'fuera del ZIP' : 'fuera de rango'}`;
    } catch (e) {
      // Si solo faltaba la cadena, esto NO es un error: el acuse sigue entrando por su PDF.
      if (sinCadena) { r.error = ''; r.aviso = 'no se pudo recargar la cadena: ' + e.message; }
      else r.error = 'no se pudo recargar: ' + e.message;
      $('#sa-st').textContent = (sinCadena ? 'Cadena no disponible: ' : 'Error al recargar ') + r.it.idAcuse + ': ' + e.message;
    }
    r.estado = estadoDe(r); pintaFila(r);
    if (exp) { pintaLista(); verFocus(); } else resumen();
  }

  // Recarga en bloque todos los acuses con error O sin cadena original que se le pasen.
  async function reintentarErrores(ns) {
    const rs = ns.map(n => registros[n]).filter(r => r && (r.error || r.sinCadena) && !/^recargando/.test(r.error || ''));
    if (!rs.length) { $('#sa-st').textContent = 'No hay acuses con error que recargar'; return; }
    for (let i = 0; i < rs.length; i++) {
      $('#sa-st').textContent = `Recargando ${i + 1}/${rs.length} · acuse ${rs[i].it.idAcuse}`;
      await reintentar(rs[i].n);
    }
    const nOk = rs.filter(r => !r.error && !r.sinCadena).length;
    $('#sa-st').textContent = `Recargados ${nOk}/${rs.length} · ${rs.length - nOk ? (rs.length - nOk) + ' siguen sin cadena o con error' : 'listo'}`;
  }

  async function analizar() {
    if (analizando) return;
    analizando = true;
    try { await _analizar(); } finally { analizando = false; }
  }

  async function _analizar() {
    cancel = false;
    const d1 = new Date($('#sa-d1').value + 'T00:00:00');
    const d2 = new Date($('#sa-d2').value + 'T23:59:59');
    const tipo = $('#sa-tipo').value.trim().toLowerCase();
    const todo = $('#sa-todo').checked;
    const st = $('#sa-st');
    if (isNaN(d1) || isNaN(d2)) { st.textContent = 'Fechas inválidas'; return; }

    if (!tabla) crearTabla();
    tabla.w.classList.add('sa-vis');
    registros.length = 0; sel.clear(); anchor = null; tabla.tb.innerHTML = '';
    if (exp) { exp.sel.clear(); exp.focus = null; }
    tabla.rango.textContent = '· FECHA ACUSE: ' + fTxt(d1) + ' – ' + fTxt(d2);
    resumen();

    // 1) LISTADO: un recorrido, o uno por cada permiso del permisionario
    const W = workers();
    const prog = t => { st.textContent = t; };
    progFn = prog;
    const fallas = [];
    const todosPerm = $('#sa-todosperm').checked;
    let permisos = [], barrido = todosPerm;
    // Si no se pueden leer los permisos, NO se cae el análisis: se sigue con el listado del permiso
    // activo (como antes) y se avisa, porque con la casilla marcada es mejor un barrido parcial
    // dicho que nada.
    if (todosPerm) {
      prog('Leyendo los permisos del permisionario…');
      let errPerm = '';
      try { permisos = ordenPermisos(await listaPermisos()); }
      catch (e) { errPerm = e.message; prog('No se pudo leer la pantalla de permisos: ' + e.message); }
      const nb = $('#sa-nperm');
      if (nb) nb.textContent = permisos.length ? '(' + permisos.length + ')' : '(no leídos)';
      if (!permisos.length) { barrido = false; fallas.push('no se pudieron leer los permisos del permisionario: se leyó solo el permiso activo (' + errPerm + ')'); }
    }

    const cand = [], vistosId = new Set();
    const razonDe = new Map();   // idAcuse -> razón social del permiso barriendo (para los acuses sin cadena)
    const firmas1 = new Map(); // permiso -> firma de su página 1 (para devolver el permiso del usuario)
    let omitId = 0;
    const paginaDe = async (pag, p) => {
      const data = { filtro: '', pagina: pag };
      if (p && ESTRAT.modo === 'param') { data.idPermiso = p.id; data.permiso = p.codigo; }
      return (await post(BUSCA, data)).json();
    };
    // Lee todas las páginas de un permiso (o del listado completo) y apila los candidatos nuevos.
    const lista = async (p, etiqueta) => {
      let pag = 1, fin = 1, viejas = 0;   // viejas = páginas seguidas sin nada del rango
      while (pag <= fin && !cancel) {
        const r = await paginaDe(pag, p);
        fin = r.item1.paginaFinal || 1;
        if (pag === 1 && p) firmas1.set(p.codigo, firma(r));
        let maxF = null;
        for (const it of r.item2) {
          const f = fechaDe(it);
          if (f && (maxF === null || f.d > maxF)) maxF = f.d;
          if (!f || f.d < d1) continue;
          if (tipo && !nk([it.tipoAcuse, it.tituloAcuse].join(' ')).includes(tipo)) continue;
          // El mismo acuse puede salir en la estación y en la planta DIST: se lee una sola vez.
          if (vistosId.has(it.idAcuse)) { omitId++; continue; }
          vistosId.add(it.idAcuse);
          cand.push(it);
          if (p && p.razon) razonDe.set(it.idAcuse, p.razon);
        }
        prog(`${etiqueta} · página ${pag}/${fin} · candidatos ${cand.length}` + (omitId ? ` · repetidos omitidos ${omitId}` : ''));
        // Corte por Fecha Acuse: se sigue mientras la página tenga ALGO del rango. Se usa la fecha
        // MÁS NUEVA de la página, no la más vieja: con 10 filas por página, una fila suelta más vieja
        // no debe cortar el recorrido (y con orden de fecha, una página entera más vieja sí lo indica).
        // Se tolera UNA página seguida sin nada del rango: el listado real no siempre viene ordenado
        // por fecha y una página vieja suelta en medio no debe esconder los acuses de las siguientes.
        if (!todo && (!maxF || maxF < d1)) { viejas++; if (viejas >= 2) break; }
        else viejas = 0;
        pag++;
        await sleep(120);
      }
    };

    // Si un permiso (o una página) falla tras los reintentos se anota el aviso y se sigue con lo demás:
    // es preferible entregar un barrido incompleto y dicho, que no entregar nada.
    if (!barrido) await lista(null, 'Listando');
    else {
      let det = null;
      try { det = await detectaEstrategia(permisos, prog); }
      catch (e) { fallas.push('no se pudo detectar cómo se recorre el listado: ' + e.message); det = { modo: 'sesion', activo: null }; }
      ESTRAT.modo = det.modo;
      ESTRAT.activo = det.activo || null;
      prog('Modo de permisos: ' + ({ global: 'el listado ya trae todos', param: 'filtro por permiso', sesion: 'cambio de permiso en sesión' })[det.modo] || det.modo);

      // Aviso de coste ANTES de arrancar. El paginaFinal del servidor es SIN filtrar por fechas,
      // o sea el peor caso: con el rango puesto se corta mucho antes.
      if (det.paginas) {
        const nPag = Object.values(det.paginas);
        const est = det.modo === 'global' ? nPag[0] : Math.round(nPag.reduce((a, b) => a + b, 0) / nPag.length) * permisos.length;
        const msg = `Permisos: ${permisos.length} · páginas estimadas: ${est} · acuses estimados: ~${est * 10}` +
          (det.modo === 'sesion' ? ' (peor caso: sin tu rango de fechas)' : '');
        prog(msg);
        if (est > 150) {
          let ok = true;
          try { ok = confirm(msg + '\n\n¿Seguir? (con tu rango de fechas suele ser mucho menos)'); } catch (e) { ok = true; }
          if (!ok) { prog(msg + ' · cancelado por seguridad'); return; }
        }
      }

      try {
        if (det.modo === 'global') await lista(null, 'Listando');
        else if (det.modo === 'param') await pool(permisos, W, (p, i) => lista(p, `Permiso ${i + 1}/${permisos.length} · ${p.codigo}`));
        else {
          try {
            for (let i = 0; i < permisos.length && !cancel; i++) {
              await activaPermiso(permisos[i]);
              await lista(permisos[i], `Permiso ${i + 1}/${permisos.length} · ${permisos[i].codigo}`);
            }
          }
          finally {
            // Se devuelve el permiso que tenía el usuario. Si no se pudo leer de la pantalla, se
            // busca el permiso cuyo listado (página 1) era idéntico al que había antes de empezar.
            let volver = det.activo;
            if (!volver && det.fBase) {
              const coincide = permisos.filter(p => firmas1.get(p.codigo) === det.fBase);
              if (coincide.length === 1) volver = coincide[0];
              else fallas.push('no se pudo saber qué permiso tenías activo: al terminar puede quedar otro permiso seleccionado');
            }
            if (volver) { prog('Restaurando el permiso original…'); await activaPermiso(volver); }
          }
        }
      }
      catch (e) { fallas.push('el recorrido se interrumpió: ' + e.message); prog('Recorrido interrumpido: ' + e.message); }
    }
    AVISOS = fallas;

    // 2) cadena original de cada candidato -> una fila en la tabla (varias a la vez)
    RANGO = [d1, d2];
    const filas = cand.map(it => ({ it, estado: 'espera', incl: false, dup: false, enRango: false, toc: false, sinCadena: false, pdfOk: null,
      subListado: vItem(it, 'tipoAcuse', 'subtipo', 'subTipo', 'nombreSubtipo', 'descripcionSubtipo'),
      registro: vItem(it, 'idCodigoRegistro', 'codigoRegistro', 'codigoDeRegistro') }));
    for (const r of filas) { r.n = registros.length; registros.push(r); }   // en orden de listado
    let hechas = 0, publicadas = 0;
    const publica = () => {                     // muestra las filas ya terminadas, en orden
      let pinto = false;
      while (publicadas < filas.length && filas[publicadas].estado !== 'espera') { agregaN(filas[publicadas]); publicadas++; pinto = true; }
      if (pinto) { if (exp) { clearTimeout(exp.t); exp.t = setTimeout(() => { if (!arrastrando) pintaLista(); }, 400); } resumen(); }
    };
    await pool(filas, W, async r => {
      const c = await pideCadena(r.it);
      if (c) armaFila(r, c, d1, d2);
      else {
        armaSinCadena(r, d1, d2, razonDe.get(r.it.idAcuse) || '');
        // Sin cadena original: se comprueba el PDF. Si es válido, el acuse entra normal al ZIP.
        if ($('#sa-pdf').checked) await verificaPdf(r);
      }
      r.estado = estadoDe(r);
      r.incl = puede(r);
      if (exp) { if (r.incl) exp.sel.add(r.n); exp.focus = r.n; }
      hechas++;
      publica();
      if (hechas % 5 === 0 || hechas === filas.length)
        prog(`Acuses ${hechas}/${filas.length} · en rango ${filas.filter(x => x.incl).length}`);
    });
    // lo que quedó a medias (Cancel) no se oculta: se reporta como no procesado
    for (const r of filas) if (r.estado === 'espera') { r.error = 'no se procesó'; r.estado = 'error'; }
    publica();

    // Al terminar se refrescan estados y duplicados (por si se tocó la selección o se recargó algo)
    marcaDups();
    const nInc = registros.filter(r => r.incl).length;
    const nDup = registros.filter(r => r.dup).length;
    st.textContent = `Listo: ${registros.length} leídos · ${nInc} incluidos` +
      (omitId ? ` · ${omitId} repetidos por idAcuse` : '') +
      (nDup ? ` · ${nDup} duplicados` : '') +
      (fallas.length ? ` · incompleto (${fallas.length} aviso${fallas.length > 1 ? 's' : ''})` : '') +
      (cancel ? ' · cancelado' : '');
    quitaGuias();
    if (exp) pintaLista();
    if ($('#sa-auto').checked && !cancel) await descargar();
  }

  // ---------- Paso 2: ZIP con las filas incluidas (casilla marcada en la tabla) ----------
  // Comando de un clic: analiza con el rango que está en el panel y arma el ZIP con todo lo que entra.
  // Siempre vuelve a analizar para no usar resultados de un rango anterior.
  async function descargaTodo() {
    const st = $('#sa-st');
    if (analizando) { st.textContent = 'Ya hay un análisis en curso, espera a que termine'; return; }
    const d1 = $('#sa-d1').value, d2 = $('#sa-d2').value;
    if (!d1 || !d2 || d1 > d2) { st.textContent = 'Pon las fechas Desde/Hasta (en ese orden) antes de descargar'; return; }
    await analizar();
    if (cancel) return;
    cancel = false;
    for (const r of registros) if (!r.error) r.incl = puede(r);
    sel.clear(); sel.add(...registros.filter(r => r.incl).map(r => r.n));
    anchor = null;
    pintaSel(); resumen();
    if (exp) { exp.sel = new Set(registros.filter(r => r.incl).map(r => r.n)); pintaLista(); }
    await descargar();
  }

  async function descargar() {
    cancel = false;
    const st = $('#sa-st');
    limpiaErrores();
    const inc = registros.filter(r => r.incl && r.f);
    if (!inc.length) { st.textContent = 'No hay filas incluidas: analiza primero y marca casillas en la tabla'; return; }
    if (typeof JSZip === 'undefined') { st.textContent = 'JSZip no cargó'; return; }
    // El ZIP solo lleva los PDF: el texto de la cadena y los datos del listado van en acuses.csv
    // y se pueden ver en el explorador, así que no se duplican en el ZIP.
    const zip = new JSZip(), usados = new Set(), filas = [], cols = new Set();
    const pendPdf = [];
    let ok = 0;

    // El nombre se resuelve EN SERIE: si no, dos acuses con el mismo nombre podrían calcularse a la
    // vez y pisarse. Solo el PDF se pide en paralelo.
    for (let i = 0; i < inc.length && !cancel; i++) {
      const r = inc[i], it = r.it, f = r.f;
      st.textContent = `ZIP ${i + 1}/${inc.length} · listos ${ok}`;
      let base = r.carpeta + '/' + r.nombre;
      // Evita que dos acuses con el mismo nombre se sobrescriban dentro del zip
      if (usados.has(base)) base += '_' + it.idAcuse;
      usados.add(base);

const row = { idAcuse: it.idAcuse, tituloAcuse: it.tituloAcuse, tipoAcuse: it.tipoAcuse, fechaAcuse: it.fechaAcuse, ...(r.c ? r.c.o : {}),
        'Tipo de registro (listado)': vItem(it, 'tituloAcuse'), 'Subtipo (listado)': r.subListado,
        'Codigo de Registro (listado)': r.registro, 'Materia (listado)': vItem(it, 'materia', 'permisoTipo'), 'Usuario (listado)': vItem(it, 'usuario', 'nombreUsuario', 'userName'),
        'Fecha acuse': f.d.getFullYear() + '-' + pad2(f.d.getMonth() + 1) + '-' + pad2(f.d.getDate()),
        'En rango': r.enRango ? 'SI' : 'NO',
        'Permiso carpeta': r.perm, 'Operacion': r.op, 'Razon social': r.razon, 'Estado del registro': r.estadoCadena,
        'Subtipo (texto)': r.sub.texto, 'Subtipo (siglas)': r.sub.sigla, 'Subtipo (clave)': r.sub.clave, 'Carpeta en el ZIP': r.carpeta, 'Archivo': base + '.PDF' };
      r.estado = 'descargando'; pintaFila(r);
      pendPdf.push([r, base, row]);
      pintaFila(r);
      Object.keys(row).forEach(k => cols.add(k));
      filas.push(row); ok++;
    }

    // Los PDF van en paralelo (varios workers). Cada uno se pide varias veces si el servidor
    // devuelve error o una página de HTML en vez del acuse.
    let nPdf = 0;
    if (pendPdf.length) {
      await pool(pendPdf, workers(), async ([r, base, row]) => {
        try {
          // Lanza si tras varios intentos no llega un PDF de verdad (página de error, HTML, red).
          // Eso NO es el acuse: no se guarda (un .HTML de 39 KB en el ZIP parece un acuse y no lo es)
          // y el acuse queda marcado con error para que se vea en la tabla y en errores.txt.
          let bytes = pdfCache.get(r.it.idAcuse);
          if (!bytes) { const p = await getPdfReintento(r.it); bytes = p.b; pdfCache.set(r.it.idAcuse, bytes); }
          zip.file(base + '.PDF', bytes); r.estado = 'descargado';
        }
        catch (e) {
          row['Archivo'] += ' (PDF error)'; r.estado = 'PDF error';
          r.error = r.error || ('PDF: ' + e.message);   // sale en errores.txt y en la tabla
        }
        pintaFila(r);
        if (++nPdf % 10 === 0 || nPdf === pendPdf.length) st.textContent = `PDF ${nPdf}/${pendPdf.length} · acuses ${ok}`;
      });
    }

    const head = [...cols];
    const csv = [head.map(q).join(',')].concat(filas.map(r => head.map(k => q(r[k])).join(','))).join('\r\n');
    const tag = $('#sa-d1').value + '_' + $('#sa-d2').value;
    zip.file('acuses.csv', '\ufeff' + csv);
    const errs = registros.filter(r => r.error);
    const dups = registros.filter(r => r.dup && !r.incl);
    // Fallos del recorrido (permiso o página que no respondió ni con reintentos) + errores de fila.
    const lineasErr = AVISOS.map(t => 'recorrido\t' + t).concat(errs.map(r => r.it.idAcuse + '\t' + r.error));
    if (lineasErr.length) zip.file('errores.txt', lineasErr.join('\r\n'));
    if (dups.length) zip.file('duplicados_omitidos.txt', 'idAcuse\toperacion\tpermiso\tNOR\tsiglas\tmotivo\r\n' +
      dups.map(r => [r.it.idAcuse, r.op, r.perm, r.nor, r.sub.sigla, r.dupTxt].join('\t')).join('\r\n'));
    st.textContent = 'Empaquetando zip...';
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, m => { st.textContent = 'Zip ' + m.percent.toFixed(0) + '%'; });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `acuses_${tag}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    resumen();
    st.textContent = `Listo: ${ok} acuses` + (dups.length ? ` · ${dups.length} duplicados omitidos` : '') + (errs.length ? ` · ${errs.length} con error` : '') + (cancel ? ' (cancelado)' : '');
    quitaGuias();
  }

  // ---------- Un PDF por estación, con TODOS los subtipos juntos, para imprimir por lotes ----------
  // El ZIP reparte cada acuse en su carpeta de Permiso/Subtipo. Esto hace lo contrario: junta en un
  // SOLO PDF los acuses de cada estación (sin importar el subtipo), ordenados por fecha y con una
  // portada por estación, para mandar a imprimir el lote completo de una vez.
  // "Estación" es el permiso del acuse (LP/20517/EXP/ES/2017 = la estación que recibe la entrega).
  function estacionesDe(inc) {
    const por = new Map();
    for (const r of inc) {
      const k = r.perm || '(sin permiso)';
      if (!por.has(k)) por.set(k, []);
      por.get(k).push(r);
    }
    // Dentro de la estación: por Fecha Acuse, luego NOR y idAcuse (para que el orden sea estable).
    const cmp = (a, b) => (a.f.d - b.f.d) || String(a.nor || '').localeCompare(String(b.nor || '')) || (a.it.idAcuse - b.it.idAcuse);
    return [...por.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([perm, filas]) => ({ perm, filas: filas.sort(cmp) }));
  }

  const fechaCorta = d => pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();

  async function pdfPorEstacion() {
    const st = $('#sa-st');
    limpiaErrores();
    const inc = registros.filter(r => r.incl && r.f);
    if (!inc.length) { st.textContent = 'No hay filas incluidas: analiza primero y marca casillas en la tabla'; return; }
    if (typeof PDFLib === 'undefined') { st.textContent = 'No cargó la librería de PDF (pdf-lib): revisa la conexión'; return; }

    // 1) Los que faltan se bajan en paralelo (los del ZIP ya están en caché y no se vuelven a pedir).
    let bajados = 0, faltan = inc.filter(r => !pdfCache.has(r.it.idAcuse));
    if (faltan.length) {
      await pool(faltan, workers(), async r => {
        try { const b = await getPdfReintento(r.it); pdfCache.set(r.it.idAcuse, b.b); }
        catch (err) { r.error = 'PDF: ' + err.message; r.estado = 'error'; pintaFila(r); }
        bajados++;
        st.textContent = `PDF por estación: bajando ${bajados}/${faltan.length}`;
      });
    }

    // 2) Se arma un único PDF: portada de la estación y luego sus acuses, estación por estación.
    const ests = estacionesDe(inc);
    const doc = await PDFLib.PDFDocument.create();
    const A4 = PDFLib.PageSizes.A4;
    const fuente = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const negrita = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const portada = $('#sa-ltc').checked;
    const lineas = [], nSalt = [];
    let nAcuses = 0;

    for (let e = 0; e < ests.length; e++) {
      const { perm, filas } = ests[e];
      const primero = doc.getPageCount();
      st.textContent = `PDF por estación: uniendo ${e + 1}/${ests.length} · ${perm}`;

      if (portada) {                       // separador: de un vistazo dónde acaba el lote de cada estación
        const p = doc.addPage(A4), y = () => 780;
        let y0 = y();
        const t = (txt, size, bold, x, dy) => p.drawText(txt, { x: x == null ? 56 : x, y: y0 -= (dy || 30), size: size, font: bold ? negrita : fuente });
        t('Acuses por estación', 12, true, 56, 40);
        t('Estación: ' + perm, 20, true, 56, 46);
        const razon = filas.map(r => r.razon).find(Boolean);
        if (razon) t('Razón social: ' + razon, 11, false, 56, 28);
        t('Acuses: ' + filas.length, 12, true, 56, 30);
        t('Del ' + fechaCorta(filas[0].f.d) + ' al ' + fechaCorta(filas[filas.length - 1].f.d), 11, false, 56, 24);
        y0 -= 20;
        const porSub = new Map();
        filas.forEach(r => porSub.set(r.sub.texto, (porSub.get(r.sub.texto) || 0) + 1));
        for (const [s, n] of porSub) t('· ' + s + ' (' + n + ')', 11, false, 70, 20);
      }

      for (const r of filas) {
        const bytes = pdfCache.get(r.it.idAcuse);
        if (!bytes) { nSalt.push(r.it.idAcuse); continue; }
        try {
          const src = await PDFLib.PDFDocument.load(bytes);
          const ps = await doc.copyPages(src, src.getPageIndices());
          ps.forEach(pg => doc.addPage(pg));
          nAcuses++;
        } catch (err) { nSalt.push(r.it.idAcuse); r.error = 'PDF ilegible: ' + err.message; }
      }

      const hasta = doc.getPageCount();
      lineas.push(perm.replace(/\//g, '_') + ': ' + filas.length + ' acuses, págs ' + (primero + 1) + '-' + hasta);
      resumen();
    }
    if (!nAcuses) { st.textContent = 'Ningún PDF se pudo unir (revisa errores.txt)'; quitaGuias(); return; }

    // 3) Se abre en una pestaña para imprimir de una sola vez (si el navegador lo bloquea, se descarga).
    st.textContent = 'PDF por estación: guardando...';
    const bytes = await doc.save();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const tag = ($('#sa-d1').value || '') + '_' + ($('#sa-d2').value || '');
    const w = window.open(url, '_blank');
    if (!w) {
      const a = document.createElement('a'); a.href = url; a.download = 'acuses_por_estacion' + (tag ? '_' + tag : '') + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
    }
    console.log('Acuses por estación:\n  ' + lineas.join('\n  '));
    st.textContent = `Listo: ${ests.length} ${ests.length > 1 ? 'estaciones' : 'estación'} · ${nAcuses} acuses · ${doc.getPageCount()} páginas` +
      (nSalt.length ? ` · ${nSalt.length} sin PDF` : '') + (w ? ' · abierto para imprimir' : ' · descargado');
    quitaGuias();
  }

  // ---------- Panel integrado con el CSS de la página ----------
  // Al acabar el recorrido se borran las ayudas de la interfaz (los textos de "cómo usar"): la
  // pantalla queda solo con los controles y los resultados, sin guías que ya no hacen falta.
  const quitaGuias = () => document.querySelectorAll('.sa-guia').forEach(n => n.remove());
  // Detecta Bootstrap (3, 4 o 5) y usa sus clases; si no hay, copia fuentes y colores de la página.
  function bsVersion() {
    try {
      const w = window;
      const v = (w.bootstrap && w.bootstrap.Tooltip && w.bootstrap.Tooltip.VERSION) ||
        (w.jQuery && w.jQuery.fn && w.jQuery.fn.tooltip && w.jQuery.fn.tooltip.Constructor && w.jQuery.fn.tooltip.Constructor.VERSION);
      if (v) return parseInt(v, 10) || 0;
    } catch (e) { /* sigue con la sonda */ }
    const sonda = c => {
      const e = document.createElement('div');
      e.className = c; e.style.cssText = 'position:absolute;visibility:hidden';
      document.body.appendChild(e);
      const cs = getComputedStyle(e), r = { d: cs.display, mb: cs.marginBottom };
      e.remove(); return r;
    };
    if (sonda('card').d === 'flex') return 4;
    if (sonda('panel').mb === '20px') return 3;
    return 0;
  }

  function estiloPagina() {
    const ok = c => c && c !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c);
    const cs = getComputedStyle(document.body);
    const fondo = ok(cs.backgroundColor) ? cs.backgroundColor : '#fff';
    const btn = [...document.querySelectorAll('.btn-primary,.btn-success,.btn-info,.btn,button[type=submit],input[type=submit]')]
      .find(b => ok(getComputedStyle(b).backgroundColor));
    const bs = btn && getComputedStyle(btn);
    const enc = [...document.querySelectorAll('.navbar,.panel-heading,.card-header,.box-header,.page-header,thead th,header')]
      .find(e => ok(getComputedStyle(e).backgroundColor));
    const es = enc && getComputedStyle(enc);
    const inp = document.querySelector('input[type=text],input[type=search],select,textarea');
    const is = inp && getComputedStyle(inp);
    return {
      font: cs.fontFamily, size: cs.fontSize, color: cs.color, fondo,
      acento: bs ? bs.backgroundColor : '#337ab7',
      acentoTxt: bs ? bs.color : '#fff',
      encFondo: es ? es.backgroundColor : (bs ? bs.backgroundColor : '#eee'),
      encTxt: es ? es.color : (bs ? bs.color : '#333'),
      borde: is ? is.borderTopColor : '#ccc',
      radio: is ? is.borderTopLeftRadius : '3px'
    };
  }

  const V = bsVersion();
  const S = V ? null : estiloPagina();
  const K = V >= 4 ? {
      box: 'card', cab: 'card-header py-1 px-2', cuerpo: 'card-body p-2',
      fld: 'form-control form-control-sm', sel: V >= 5 ? 'form-select form-select-sm' : 'form-control form-control-sm',
      go: 'btn btn-primary btn-sm', x: 'btn btn-outline-secondary btn-sm'
    } : V === 3 ? {
      box: 'panel panel-default', cab: 'panel-heading', cuerpo: 'panel-body',
      fld: 'form-control input-sm', sel: 'form-control input-sm',
      go: 'btn btn-primary btn-sm', x: 'btn btn-default btn-sm'
    } : { box: '', cab: '', cuerpo: '', fld: '', sel: '', go: 'sa-go', x: 'sa-x' };

  const css = `
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
    #sa-exp .ex-i.ex-h{position:sticky;top:0;z-index:2;background:#f3f3f3;color:#333;font-weight:600;border-bottom:1px solid rgba(128,128,128,.5);cursor:default}
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
  ` + (S ? `
    #sa-panel,#sa-tabla,#sa-exp{background:${S.fondo};color:${S.color};font:${S.size} ${S.font};border:1px solid ${S.borde};border-radius:${S.radio}}
    #sa-panel{overflow-x:hidden}
    #sa-panel .sa-cab,#sa-tabla .sa-cab,#sa-exp .sa-cab{background:${S.encFondo};color:${S.encTxt};padding:6px 8px}
    #sa-panel .sa-cuerpo{padding:8px}
    #sa-panel input:not([type=checkbox]),#sa-panel select,#sa-exp input:not([type=checkbox]),#sa-exp select{box-sizing:border-box;padding:3px 6px;font:inherit;color:inherit;background:${S.fondo};border:1px solid ${S.borde};border-radius:${S.radio}}
    #sa-panel button.sa-go,#sa-panel button.sa-x,#sa-tabla button.sa-x,#sa-exp button.sa-x{font:inherit;padding:4px 8px;cursor:pointer;border-radius:${S.radio}}
    #sa-panel button.sa-go{background:${S.acento};color:${S.acentoTxt};border:1px solid ${S.acento}}
    #sa-panel button.sa-x,#sa-tabla button.sa-x,#sa-exp button.sa-x{background:transparent;color:inherit;border:1px solid ${S.borde}}
  ` : '');
  const est = document.createElement('style');
  est.textContent = css;
  document.head.appendChild(est);

  const p = document.createElement('div');
  p.id = 'sa-panel';
  p.className = K.box;
  p.innerHTML = `<div class="sa-cab ${K.cab}"><b>Acuses</b><button type="button" class="sa-min" title="Ocultar">&minus;</button></div>
    <div class="sa-cuerpo sa-grilla ${K.cuerpo}">
      <label class="sa-lb" for="sa-d1" title="El rango se aplica a la Fecha Acuse que muestra el listado; las demás fechas se ignoran">Desde</label><input id="sa-d1" type="date" class="sa-f ${K.fld}">
      <label class="sa-lb" for="sa-d2">Hasta</label><input id="sa-d2" type="date" class="sa-f ${K.fld}">
      <label class="sa-lb" for="sa-tipo" title="Escribe una palabra del subtipo o de su título para quedarte solo con esos acuses. Vacío = todos">Filtro</label><input id="sa-tipo" type="text" class="sa-f ${K.fld}" placeholder="todos">
      <label class="sa-lb" for="sa-w" title="Cuántas descargas van al mismo tiempo: más es más rápido, pero carga el servidor (máx. 6)">A la vez</label><input id="sa-w" type="number" min="1" max="6" step="1" value="3" class="sa-f ${K.fld}">
      <label class="sa-chk" title="Recorre uno por uno los permisos del permisionario en vez de usar solo el permiso abierto"><input id="sa-todosperm" type="checkbox" checked><span>Todos los permisos <b id="sa-nperm"></b></span></label>
      <label class="sa-chk"><input id="sa-auto" type="checkbox"><span>Descargar el ZIP al terminar</span></label>
      <details class="sa-op">
        <summary>Más opciones</summary>
        <label class="sa-chk" title="Deja fuera el acuse si repite NOR o cadena y subtipo dentro del rango"><input id="sa-dup" type="checkbox" checked><span>Quitar duplicados</span></label>
        <label class="sa-chk" title="Antes del ZIP comprueba que cada acuse sin cadena tenga un PDF válido (si no, lo avisa)"><input id="sa-pdf" type="checkbox" checked><span>Revisar que exista el PDF</span></label>
        <label class="sa-chk" title="Recorre el listado completo aunque ya se haya pasado la Fecha Acuse de fin"><input id="sa-todo" type="checkbox"><span>No cortar listado</span></label>
        <label class="sa-chk" title="Cada estación empieza con una hoja que dice cuántas acuses trae y de qué subtipos"><input id="sa-ltc" type="checkbox" checked><span>Portada por estación en el PDF</span></label>
      </details>
      <button id="sa-dt" type="button" class="sa-1 ${K.go}" title="Analiza el rango y de una vez arma el ZIP con todo lo que entra">Descargar todo (ZIP)</button>
      <div class="sa-btns"><button id="sa-an" type="button" class="${K.go}" title="Solo lee el listado: no baja ningún archivo">Analizar</button><button id="sa-go" type="button" class="${K.go}" title="Arma el ZIP con lo que esté marcado en la tabla">Descargar ZIP</button></div>
      <button id="sa-lt" type="button" class="sa-1x ${K.x}" title="Une en un solo PDF los acuses de cada estación (todos los subtipos, ordenados por fecha) y lo abre para imprimir">PDF por estación (imprimir)</button>
      <div class="sa-btns"><button id="sa-ex" type="button" class="${K.x}">Ver acuses</button><button id="sa-tb" type="button" class="${K.x}">Ver tabla</button><button id="sa-x" type="button" class="${K.x}">Cancelar</button></div>
      <div id="sa-st"></div>
    </div>`;
  document.body.appendChild(p);
  p.querySelector('.sa-min').onclick = () => p.classList.toggle('sa-cerrado');
  const falla = e => { $('#sa-st').textContent = 'Error: ' + e.message; };
  // Al terminar el ZIP también se limpian las guías del panel y del explorador.
  $('#sa-an').onclick = () => analizar().catch(falla);
  $('#sa-dt').onclick = () => descargaTodo().catch(falla);
  $('#sa-go').onclick = () => descargar().catch(falla);
  $('#sa-lt').onclick = () => pdfPorEstacion().catch(falla);
  $('#sa-ex').onclick = () => abrirExplorador();
  $('#sa-tb').onclick = () => { if (!tabla) crearTabla(); tabla.w.classList.toggle('sa-vis'); };
  $('#sa-x').onclick = () => { cancel = true; };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && exp && exp.w.classList.contains('sa-vis')) cerrarExplorador();
  });
})();
