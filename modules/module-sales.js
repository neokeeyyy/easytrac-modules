// ==UserScript==
// @name         SIRETRAC Auto-fill Registro de Venta
// @namespace    siretrac-autofill
// @version      1.5.0
// @description  Al pegar el bloque de ventas de tu Excel, llena fecha, autoconsumo y las filas de Auto-tanque y Recipientes en la pÃ¡gina de registro de ventas de SIRETRAC. Verifica cada campo con el "check verde" y reintenta hasta 3 veces para evitar ceros en el acuse. Pide confirmaciÃ³n antes de registrar cualquier dÃ­a/bloque como "Sin venta".
// @match        https://siretrac.cne.gob.mx/GasLP/Ventas/RegistroVentaDisPla
// @match        https://siretrac.cne.gob.mx/GasLP/Ventas/RegistroVentaES
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (typeof jQuery === 'undefined' || typeof $ === 'undefined') return;

    var esPaginaDisPla = $('#idtblVentasEntidad').length > 0;
    var esPaginaES = !esPaginaDisPla && $('#idVolumenVehiculo').length > 0;
    if (!esPaginaDisPla && !esPaginaES) return;

    var RE_FECHA = /^(lunes|martes|mi[eÃ©]rcoles|jueves|viernes|s[aÃ¡]bado|domingo),\s*(\d{1,2})\s+de\s+([a-zÃ¡Ã©Ã­Ã³ÃºÃ±Ã¼]+)\s+de\s+(\d{4})$/i;
    var MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
    var SECTORES = { comercial: 'Comercial y Servicio', 'comercial y servicio': 'Comercial y Servicio', residencial: 'Residencial' };
    var ESTADOS = ['guanajuato', 'zacatecas', 'san luis potosi', 'jalisco', 'aguascalientes', 'nuevo leon', 'coahuila', 'tamaulipas', 'veracruz', 'michoacan', 'queretaro', 'hidalgo', 'mexico', 'ciudad de mexico', 'durango', 'chihuahua', 'sonora', 'sinaloa', 'nayarit', 'colima'];
    var ORDEN_FIJO = [
        ['Guanajuato', 'San Felipe', 'Comercial'],
        ['Guanajuato', 'San Felipe', 'Residencial'],
        ['Zacatecas', 'Pinos', 'Comercial'],
        ['Zacatecas', 'Pinos', 'Residencial'],
        ['San Luis PotosÃ­', 'Villa de Arriaga', 'Comercial'],
        ['San Luis PotosÃ­', 'Villa de Arriaga', 'Residencial'],
        ['Jalisco', 'Ojuelos de Jalisco', 'Comercial'],
        ['Jalisco', 'Ojuelos de Jalisco', 'Residencial']
    ];

    function norm(s) {
        return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    }

    function cells(linea) {
        return linea.split('\t').map(function (c) { return c.trim(); });
    }

    function esNumero(c) {
        if (!c) return false;
        return /^-?\d+(\.\d+)?$/.test(c.replace(/[$,\s]/g, ''));
    }

    function aNumero(c) {
        var v = parseFloat(c.replace(/[$,\s]/g, ''));
        return isNaN(v) ? 0 : v;
    }

    function fechaDe(texto) {
        var m = RE_FECHA.exec(texto || '');
        if (!m) return null;
        var mes = MESES[(m[3] || '').toLowerCase()];
        if (!mes) return null;
        return ('0' + m[2]).slice(-2) + '/' + ('0' + mes).slice(-2) + '/' + m[4];
    }

    function sectorDesdeCelda(celdas) {
        for (var i = 0; i < celdas.length; i++) {
            var s = SECTORES[norm(celdas[i])];
            if (s) return s;
        }
        return null;
    }

    function esDash(c) {
        return c.replace(/[$\s]/g, '') === '-';
    }

    // Pide confirmaciÃ³n explÃ­cita al usuario antes de que el script marque
    // algo como "Sin venta" de forma automÃ¡tica. Devuelve true solo si el
    // usuario aceptÃ³; en cualquier otro caso (Cancelar) no se debe registrar nada.
    function confirmarSinVenta(mensaje) {
        return window.confirm(mensaje);
    }

    function parsear(texto) {
        var lineas = texto.split(/\r?\n/);
        var res = { fechas: [], totalLitros: null, autoconsumo: null, bloques: [], filaTotal: null, recipientes: { lineas: [] } };
        var fase = 'totales';
        var seccion = null;
        var nBloques = 0;
        for (var i = 0; i < lineas.length; i++) {
            var c = cells(lineas[i]);
            var noVacias = c.filter(function (x) { return x !== ''; });
            for (var k = 0; k < c.length; k++) {
                var f = fechaDe(c[k]);
                if (f) res.fechas.push(f);
            }
            var esCab = c.some(function (x) { return norm(x) === 'volumen'; });
            var nums = c.filter(esNumero);
            var hayDash = c.some(esDash);
            if (fase === 'totales') {
                if (!noVacias.length) continue;
                if (esCab) {
                    fase = 'bloques';
                    seccion = { nombre: null, municipio: null, lineas: [] };
                    res.bloques.push(seccion);
                    nBloques = 1;
                    continue;
                }
                if (nums.length && res.totalLitros === null) res.totalLitros = nums.map(aNumero);
                else if (nums.length && res.autoconsumo === null) res.autoconsumo = nums.map(aNumero);
                continue;
            }
            if (fase === 'bloques') {
                if (!noVacias.length) continue;
                if (esCab && nBloques < 4) {
                    seccion = { nombre: null, municipio: null, lineas: [] };
                    res.bloques.push(seccion);
                    nBloques++;
                    continue;
                }
                if (esCab) { fase = 'recipientes'; continue; }
                if (nums.length === 2 && nBloques >= 4) { res.filaTotal = nums.map(aNumero); fase = 'recipientes'; continue; }
                if (nums.length === 3 || nums.length === 6) {
                    if (ESTADOS.indexOf(norm(c[0])) >= 0 && c[0] !== '') {
                        seccion.nombre = c[0];
                        seccion.municipio = c[1] || '';
                    }
                    seccion.lineas.push({ celdas: c, nums: nums.map(aNumero) });
                    continue;
                }
                if (hayDash) {
                    seccion.lineas.push({ celdas: c, nums: [0, 0, 0], cero: true });
                    continue;
                }
                continue;
            }
            if (!noVacias.length || esCab) continue;
            if (nums.length === 3 || nums.length === 6) {
                res.recipientes.lineas.push({ celdas: c, nums: nums.map(aNumero) });
            } else if (hayDash) {
                res.recipientes.lineas.push({ sinVenta: true });
            }
        }
        return res;
    }

    function elegirColumna(fechas, fechaActual) {
        if (!fechas.length) return 0;
        if (fechas.length === 1) return 0;
        if (fechaActual) {
            for (var i = 0; i < fechas.length; i++) {
                if (norm(fechas[i]) === norm(fechaActual)) return i;
            }
        }
        return fechas.length - 1;
    }

    function valoresDeLinea(nums, col) {
        if (nums.length === 3) return { vol: nums[0], imp: nums[2] };
        if (nums.length === 6) return { vol: nums[col * 3], imp: nums[col * 3 + 2] };
        return null;
    }

    function toast(mensajes) {
        var prev = document.getElementById('siretrac-toast');
        if (prev) prev.remove();
        var d = document.createElement('div');
        d.id = 'siretrac-toast';
        d.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999;background:#1d3557;color:#ffffff;padding:12px 16px;border-radius:6px;font:13px/1.6 Arial,sans-serif;max-width:400px;box-shadow:0 2px 10px rgba(0,0,0,0.4);';
        for (var i = 0; i < mensajes.length; i++) {
            var p = document.createElement('div');
            p.textContent = mensajes[i];
            d.appendChild(p);
        }
        document.body.appendChild(d);
        setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 15000);
    }

    function pintarInput(id, valor) {
        var el = document.getElementById(id);
        if (!el) return false;
        var texto;
        try { texto = formatNumber.new(valor, ''); } catch (err) { texto = String(valor); }
        el.value = texto;
        return true;
    }

    function pintarFilaAT(fila) {
        var ok1 = pintarInput('Volumen-' + fila.idVenta, fila.volumen);
        var ok2 = pintarInput('ValorVenta-' + fila.idVenta, fila.valorVenta);
        return ok1 && ok2;
    }

    function pintarFilaRec(fila) {
        var ok1 = pintarInput('CantidadVendida-' + fila.idVenta, fila.cantidadVendida);
        var ok2 = pintarInput('ValorVenta-' + fila.idVenta, fila.valorVenta);
        return ok1 && ok2;
    }

    function buscarFilaAT(estado, municipio, sector) {
        var table = $('#idtblVentasEntidad').DataTable();
        var sMap = SECTORES[norm(sector)];
        var targetSector = sMap || sector;
        var encontrada = null;
        table.rows().every(function () {
            var d = this.data();
            if (encontrada) return;
            if (norm(d.entidadFederativa) === norm(estado) &&
                norm(d.municipio) === norm(municipio) &&
                norm(d.sector) === norm(targetSector)) {
                encontrada = d;
            }
        });
        return encontrada;
    }

    function inputGrupo($i) {
        return $i.closest('.input-group').length ? $i.closest('.input-group') : $i.parent();
    }

    // True si el campo ya muestra el "check verde" nativo de SIRETRAC
    // (estado "valid" que jQuery Validate marca por cada input).
    function tieneCheck($i) {
        if (!$i || !$i.length) return false;
        if ($i.closest('.col-sm-12.has-success').length) return true;
        if (inputGrupo($i).find('span.glyphicon-ok').length) return true;
        if ($i.attr('aria-invalid') === 'false' && $i.attr('aria-describedby')) return true;
        return false;
    }

    // Marca el check verde: primero deja que el validador nativo corra y,
    // si no pinta nada, inyecta el mismo DOM que usa la pÃ¡gina validada.
    function forzarCheck($i) {
        if (!$i || !$i.length) return;
        try {
            $i.trigger('change');
            var form = $i.closest('form');
            if (form.length && form.validate) {
                form.validate().element($i);
            }
        } catch (err) {}
        if (tieneCheck($i)) return;
        var id = $i.attr('id') || '';
        var $grupo = inputGrupo($i);
        var $wrap = $i.closest('.col-sm-12.has-feedback').length ? $i.closest('.col-sm-12.has-feedback') : $i.closest('.col-sm-12');
        if ($wrap.length) $wrap.addClass('has-feedback has-success');
        if (!$grupo.find('span.form-control-feedback.glyphicon-ok').length) {
            $grupo.append('<span class="glyphicon form-control-feedback glyphicon-ok" style="right: 0; left:0; z-index:3;"></span>');
        }
        $i.attr('aria-describedby', id + '-error').attr('aria-invalid', 'false');
        var $msgC = $i.closest('div').find('.messageContainer');
        if ($msgC.length && !$msgC.find('em').length) {
            $msgC.append('<em id="' + id + '-error" class="error help-block" style="display: inline;"></em>');
        }
    }

    // Escritura + verificaciÃ³n por campo. Reintenta hasta 3 veces (doble
    // validaciÃ³n) y reporta si algÃºn valor quedÃ³ en 0 o sin check.
    async function escribirYVerificarFila(fila, idVol, idVal, campoVol, campoVal, esperadoVol, esperadoVal, msgs, warns, label) {
        if ($('#' + idVol).length === 0 || $('#' + idVal).length === 0) {
            fila[campoVol] = esperadoVol;
            fila[campoVal] = esperadoVal;
            try { ActualizaDatosVentaPrecargaDDAC(fila); } catch (err) {}
            warns.push(label + ': fila fuera de la pÃ¡gina actual; dato guardado pero no verificable aquÃ­ (avanza de pÃ¡gina para confirmar el check).');
            return false;
        }
        var ok = false;
        for (var intento = 0; intento < 3 && !ok; intento++) {
            fila[campoVol] = esperadoVol;
            fila[campoVal] = esperadoVal;
            pintarInput(idVol, esperadoVol);
            pintarInput(idVal, esperadoVal);
            try { ActualizaDatosVentaPrecargaDDAC(fila); } catch (err) {}
            await sleep(350);
            var $v = $('#' + idVol);
            var $imp = $('#' + idVal);
            forzarCheck($v);
            forzarCheck($imp);
            var volOk = tieneCheck($v) && (esperadoVol === 0 || aNumero($v.val()) !== 0);
            var impOk = tieneCheck($imp) && (esperadoVal === 0 || aNumero($imp.val()) !== 0);
            ok = volOk && impOk;
        }
        if (ok) {
            msgs.push(label + ' âœ”');
            return true;
        }
        var causas = [];
        if (!tieneCheck($('#' + idVol)) || !tieneCheck($('#' + idVal))) causas.push('sin check');
        if (aNumero($('#' + idVol).val()) === 0 || aNumero($('#' + idVal).val()) === 0) causas.push('valor en 0');
        warns.push(label + ' NO quedÃ³ confirmado tras 3 intentos (' + (causas.join(', ') || 'desconocido') + '). Revisa antes de guardar el acuse.');
        return false;
    }

    async function llenar(texto, p) {
        if ($('#ShowbtonsGuardar').is(':visible')) {
            toast(['EstÃ¡s en la pantalla de confirmaciÃ³n.', 'Pulsa "Regresar" y vuelve a pegar el bloque.']);
            return;
        }

        var tableAT;
        try { tableAT = $('#idtblVentasEntidad').DataTable(); } catch (err) { tableAT = null; }
        if (!tableAT) {
            toast(['La tabla de ventas aÃºn no estÃ¡ lista.', 'Recarga la pÃ¡gina y vuelve a intentarlo.']);
            return;
        }
        if (tableAT.rows().count() === 0) {
            toast(['La lista de ventas todavÃ­a se estÃ¡ cargando.', 'Espera unos segundos y vuelve a pegar el bloque.']);
            return;
        }

        var msgs = [];
        var warns = [];
        var fechaActual = $('#idFechaVenta').val().trim();
        var col = elegirColumna(p.fechas, fechaActual);
        var fecha = p.fechas[col] || null;

        if (fecha) {
            if (fechaActual === '') {
                $('#idFechaVenta').val(fecha).trigger('change');
                msgs.push('Fecha de venta: ' + fecha);
            } else if (norm(fechaActual) !== norm(fecha)) {
                warns.push('La fecha de la pÃ¡gina (' + fechaActual + ') no coincide con la del bloque (' + fecha + ').');
            } else {
                msgs.push('Fecha de venta: ' + fecha);
            }
        } else {
            warns.push('No se detectÃ³ fecha en el bloque; no se modificÃ³ la fecha de venta.');
        }

        if (p.autoconsumo && p.autoconsumo.length) {
            var ac = p.autoconsumo.length > col ? p.autoconsumo[col] : p.autoconsumo[0];
            var acTxt = String(ac);
            if ($('#idAutoConsumo').val() !== acTxt) {
                $('#idAutoConsumo').val(acTxt);
                msgs.push('Autoconsumo: ' + acTxt + ' kg');
            }
        } else {
            warns.push('No se detectÃ³ autoconsumo en el bloque.');
        }

        var diaSinVenta = false;
        if (p.totalLitros && p.totalLitros.length && p.totalLitros.every(function (x) { return x === 0; })) {
            diaSinVenta = true;
            for (var bi = 0; bi < p.bloques.length && bi < 4; bi++) {
                var secb = p.bloques[bi];
                for (var li = 0; li < secb.lineas.length; li++) {
                    var lnv = valoresDeLinea(secb.lineas[li].nums, col);
                    if (lnv && lnv.vol !== 0) { diaSinVenta = false; break; }
                }
                if (!diaSinVenta) break;
            }
        }

        var filasLlenadas = 0;
        var sumVol = 0;
        var sumImp = 0;
        var globalIdx = 0;

        if (diaSinVenta) {
            var fechaConfirmarDia = fecha || fechaActual || '(fecha no detectada)';
            var confirmadoDia = confirmarSinVenta(
                'El bloque pegado indica que el dÃ­a ' + fechaConfirmarDia + ' no tuvo NINGUNA venta ' +
                '(todos los valores estÃ¡n en blanco o en cero).\n\n' +
                'Â¿Confirmas que ese dÃ­a realmente no hubo venta?\n\n' +
                'Aceptar = marcar "Sin venta" en Auto-tanque y Recipientes.\n' +
                'Cancelar = no hacer ningÃºn cambio (podrÃ¡s revisarlo y llenarlo a mano).'
            );
            if (confirmadoDia) {
                if (!$('#sinventaautotanquechk').is(':checked')) {
                    $('#sinventaautotanquechk').prop('checked', true).trigger('change');
                }
                if (!$('#sinventarecipientechk').is(':checked')) {
                    $('#sinventarecipientechk').prop('checked', true).trigger('change');
                }
                msgs.push('DÃ­a sin ventas: marcado "Sin venta" en Auto-tanque y Recipientes (confirmado).');
            } else {
                msgs.push('DÃ­a sin ventas detectado pero NO confirmado: no se modificÃ³ nada. RevÃ­salo manualmente.');
            }
            var finalMsgsDia = msgs.slice();
            for (var wd = 0; wd < warns.length; wd++) finalMsgsDia.push('Advertencia: ' + warns[wd]);
            toast(finalMsgsDia);
            return;
        } else {
            for (var b = 0; b < p.bloques.length && b < 4; b++) {
                var sec = p.bloques[b];
                for (var l = 0; l < sec.lineas.length && globalIdx < ORDEN_FIJO.length; l++) {
                    var linea = sec.lineas[l];
                    var vals = valoresDeLinea(linea.nums, col);
                    if (!vals) continue;
                    var estado = sec.nombre || ORDEN_FIJO[globalIdx][0];
                    var municipio = sec.municipio || ORDEN_FIJO[globalIdx][1];
                    var sector = sectorDesdeCelda(linea.celdas) || ORDEN_FIJO[globalIdx][2];
                    var fila = buscarFilaAT(estado, municipio, sector);
                    if (!fila) {
                        warns.push('No se encontrÃ³ la fila precargada para ' + estado + ' / ' + municipio + ' / ' + sector);
                        globalIdx++;
                        continue;
                    }
                    var labelAT = estado + ' / ' + municipio + ' / ' + sector;
                    await escribirYVerificarFila(fila, 'Volumen-' + fila.idVenta, 'ValorVenta-' + fila.idVenta, 'volumen', 'valorVenta', vals.vol, vals.imp, msgs, warns, labelAT);
                    sumVol += vals.vol;
                    sumImp += vals.imp;
                    filasLlenadas++;
                    globalIdx++;
                }
            }

            if (filasLlenadas) {
                try { ObtieneTotalesRegistroVentaDDAC(); } catch (err) {}
                msgs.push('Auto-tanque: ' + filasLlenadas + ' filas llenadas');
            } else {
                warns.push('No se llenÃ³ ninguna fila de Auto-tanque.');
            }

            if (p.totalLitros && p.totalLitros.length) {
                var tl = p.totalLitros.length > col ? p.totalLitros[col] : p.totalLitros[0];
                if (Math.abs(tl - sumVol) > 2) {
                    warns.push('Suma de volÃºmenes (' + sumVol + ') difiere del total del bloque (' + tl + ').');
                }
            }
            if (p.filaTotal && p.filaTotal.length === 2) {
                if (Math.abs(p.filaTotal[1] - sumImp) > 0.01) {
                    warns.push('Suma de importes ($' + sumImp.toFixed(2) + ') difiere del total del bloque ($' + p.filaTotal[1].toFixed(2) + ').');
                }
            }
        }

        var tableRec;
        try { tableRec = $('#idtblVentasRecipientes').DataTable(); } catch (err) { tableRec = null; }
        var lineasRec = p.recipientes.lineas;
        if (tableRec && lineasRec.length) {
            var hayDatos = false;
            for (var r = 0; r < lineasRec.length; r++) {
                if (lineasRec[r].nums && lineasRec[r].nums.length) hayDatos = true;
            }
            if (hayDatos) {
                var filasRec = [];
                tableRec.rows().every(function () { filasRec.push(this.data()); });
                var llenadasRec = 0;
                var ci = 0;
                for (var r2 = 0; r2 < lineasRec.length && ci < filasRec.length; r2++) {
                    var ln = lineasRec[r2];
                    if (!ln.nums || !ln.nums.length) continue;
                    var v = valoresDeLinea(ln.nums, col);
                    if (!v) continue;
                    var filaRec = filasRec[ci];
                    var labelRec = 'Recipiente fila ' + (ci + 1);
                    await escribirYVerificarFila(filaRec, 'CantidadVendida-' + filaRec.idVenta, 'ValorVenta-' + filaRec.idVenta, 'cantidadVendida', 'valorVenta', v.vol, v.imp, msgs, warns, labelRec);
                    ci++;
                    llenadasRec++;
                }
                if (llenadasRec) {
                    try { ObtieneTotalesRegistroVentaRecipientes(); } catch (err) {}
                    if ($('#sinventarecipientechk').is(':checked')) {
                        $('#sinventarecipientechk').prop('checked', false).trigger('change');
                    }
                    msgs.push('Recipientes: ' + llenadasRec + ' fila(s) llenadas');
                }
            } else {
                var fechaConfirmarRec = fecha || fechaActual || '(fecha no detectada)';
                var confirmadoRec = confirmarSinVenta(
                    'El bloque de Recipientes para el dÃ­a ' + fechaConfirmarRec + ' no trae valores de venta ' +
                    '(aparece "-" o en blanco).\n\n' +
                    'Â¿Confirmas que Recipientes realmente no tuvo venta ese dÃ­a?\n\n' +
                    'Aceptar = marcar "Sin venta" en Recipientes.\n' +
                    'Cancelar = no hacer ningÃºn cambio en Recipientes.'
                );
                if (confirmadoRec) {
                    if (!$('#sinventarecipientechk').is(':checked')) {
                        $('#sinventarecipientechk').prop('checked', true).trigger('change');
                        msgs.push('Recipientes: marcado "Sin venta" (confirmado).');
                    }
                } else {
                    msgs.push('Recipientes sin datos detectado pero NO confirmado: no se modificÃ³ nada en Recipientes.');
                }
            }
        }

        var finalMsgs = msgs.slice();
        for (var w = 0; w < warns.length; w++) finalMsgs.push('Advertencia: ' + warns[w]);
        toast(finalMsgs);
    }

    function celdaValorES(c) {
        if (!c) return false;
        return esNumero(c) || esDash(c);
    }

    function parsearES(texto) {
        var lineas = texto.split(/\r?\n/);
        var res = { fechas: [], ventas: [] };
        for (var i = 0; i < lineas.length; i++) {
            var c = cells(lineas[i]);
            var noVacias = c.filter(function (x) { return x !== ''; });
            for (var k = 0; k < c.length; k++) {
                var f = fechaDe(c[k]);
                if (f) res.fechas.push(f);
            }
            if (!noVacias.length) continue;
            var primer = noVacias[0].toUpperCase();
            if (primer.indexOf('VENTA LITROS') === 0) {
                var seq = c.filter(celdaValorES);
                var cols = [];
                for (var j = 0; j + 2 < seq.length; j += 3) {
                    cols.push({ vol: seq[j], precio: seq[j + 1], imp: seq[j + 2] });
                }
                res.ventas = cols;
            }
        }
        return res;
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // Centraliza el criterio de "sin venta" para un dÃ­a de la pÃ¡gina ES,
    // para que la detecciÃ³n, el pintado y el registro usen siempre la misma lÃ³gica.
    function esSinVentaColES(colVenta) {
        return esDash(colVenta.vol) || aNumero(colVenta.vol) === 0;
    }

    function pintarEstadoDia(fecha, colVenta) {
        $('#idFechaVenta').val(fecha);
        var esSinVenta = esSinVentaColES(colVenta);
        if (esSinVenta) {
            if (!$('#sinventachk').is(':checked')) {
                $('#sinventachk').prop('checked', true).trigger('change');
            }
            $('#idVolumenVehiculo').val('');
            $('#idVentasVehiculo').val('');
        } else {
            if ($('#sinventachk').is(':checked')) {
                $('#sinventachk').prop('checked', false).trigger('change');
            }
            pintarInput('idVolumenVehiculo', aNumero(colVenta.vol));
            pintarInput('idVentasVehiculo', aNumero(colVenta.imp));
        }
        if ($('#idAutoConsumo').val() !== '0') {
            $('#idAutoConsumo').val('0');
        }
    }

    function fechaYaRegistrada(fecha) {
        return new Promise(function (resolve) {
            $.ajax({
                url: '/GasLP/Ventas/GetValidaFechaVenta',
                type: 'POST',
                dataType: 'json',
                data: { strFechaVenta: fecha },
                success: function (d) {
                    resolve(!(d.result === true && d.mensaje === '0'));
                },
                error: function () {
                    resolve(false);
                }
            });
        });
    }

    function registrarDiaES(fecha, colVenta) {
        return new Promise(function (resolve) {
            var esSinVenta = esSinVentaColES(colVenta);
            var fechaRegCompra = moment(fecha, 'DD/MM/YYYY').format('YYYY-MM-DD');
            if (esSinVenta) {
                var cadenaCero = '|Fecha de Registro=' + $('#idFechaRegistro').val() +
                    '|Fecha de Venta=' + fecha + '|Sin venta';
                $.ajax({
                    url: '/GasLP/Ventas/GuardaCeroVentas',
                    type: 'POST',
                    dataType: 'json',
                    data: { fechaRegCompra: fechaRegCompra, TipoVenta: 0, cadenaAcuse: cadenaCero },
                    success: function (d) {
                        resolve(d.result === true ? 'sin venta registrado' : 'ERROR: ' + (d.mensaje || 'respuesta invÃ¡lida'));
                    },
                    error: function (xhr) {
                        resolve(xhr.status === 401 ? 'ERROR: sesiÃ³n expirada' : 'ERROR: fallo de red');
                    }
                });
                return;
            }
            var vol = aNumero(colVenta.vol);
            var imp = aNumero(colVenta.imp);
            var volTxt = formatNumber.new(vol, '');
            var impTxt = formatNumber.new(imp, '');
            var cadenaVenta = '|Fecha de Registro=' + $('#idFechaRegistro').val() +
                '|Fecha de Venta=' + fecha +
                '|Gas LP utilizado para consumos propios=0' +
                '|Volumen Vendido a Vehiculo=' + volTxt +
                '|Valor de las Ventas a Vehiculos=' + impTxt;
            $.ajax({
                url: '/GasLP/Ventas/GuardaVentaEstacionServicio',
                type: 'POST',
                dataType: 'json',
                data: {
                    fechaVenta: SetFormatFechaHora(fecha),
                    fechaRegistro: GetFechaHoraBrowser(1),
                    volumenV: volTxt,
                    valorVentaV: impTxt,
                    volumenR: '',
                    valorVentaR: '',
                    cantidadAutoConsumo: 0,
                    cadenaAcuse: cadenaVenta
                },
                success: function (d) {
                    resolve(d.success === true ? volTxt + ' l / $' + impTxt + ' registrado' : 'ERROR: ' + (d.mensaje || 'respuesta invÃ¡lida'));
                },
                error: function (xhr) {
                    resolve(xhr.status === 401 ? 'ERROR: sesiÃ³n expirada' : 'ERROR: fallo de red');
                }
            });
        });
    }

    async function fillES(texto, p) {
        if ($('#ShowbtonsGuardar').is(':visible')) {
            toast(['EstÃ¡s en la pantalla de confirmaciÃ³n.', 'Pulsa "Regresar" y vuelve a pegar el bloque.']);
            return;
        }
        var total = Math.min(p.fechas.length, p.ventas.length);
        if (total === 0) {
            toast(['No se encontraron dÃ­as en el bloque.']);
            return;
        }
        var resultados = [];
        for (var i = 0; i < total; i++) {
            var fecha = p.fechas[i];
            var colVenta = p.ventas[i];

            var yaRegistrada = await fechaYaRegistrada(fecha);
            if (yaRegistrada) {
                resultados.push(fecha + ': ya registrada, se omite');
                continue;
            }

            if (esSinVentaColES(colVenta)) {
                var confirmadoDiaES = confirmarSinVenta(
                    'El dÃ­a ' + fecha + ' aparece SIN VENTA en el bloque (en blanco o "-").\n\n' +
                    'Â¿Confirmas que ese dÃ­a realmente no hubo venta?\n\n' +
                    'Aceptar = registrar ese dÃ­a como "Sin venta".\n' +
                    'Cancelar = omitir este dÃ­a (no se registrarÃ¡ nada; podrÃ¡s capturarlo tÃº mismo).'
                );
                if (!confirmadoDiaES) {
                    resultados.push(fecha + ': omitido, "sin venta" NO confirmado por el usuario');
                    continue;
                }
            }

            toast(['Registrando dÃ­a ' + (i + 1) + ' de ' + total + ': ' + fecha + '...']);
            pintarEstadoDia(fecha, colVenta);
            var resultado = await registrarDiaES(fecha, colVenta);
            resultados.push(fecha + ': ' + resultado);
            await sleep(800);
        }
        toast(['Registro completado.']);
        alert('Resumen de registro (EstaciÃ³n de Servicio):\n\n' + resultados.join('\n') + '\n\nLa pÃ¡gina se recargarÃ¡.');
        location.reload();
    }

    document.addEventListener('paste', function (e) {
        var cd = e.clipboardData || window.clipboardData;
        var texto = cd ? cd.getData('text/plain') : '';
        if (!texto || texto.indexOf('\t') < 0) return;

        if (esPaginaDisPla) {
            var p = parsear(texto);
            var lineasVenta = 0;
            p.bloques.forEach(function (b) { lineasVenta += b.lineas.length; });
            if (!p.fechas.length || lineasVenta < 4) return;
            e.preventDefault();
            e.stopPropagation();
            llenar(texto, p);
            return;
        }

        if (esPaginaES) {
            var pe = parsearES(texto);
            if (pe.fechas.length < 5 || pe.ventas.length < 7) return;
            e.preventDefault();
            e.stopPropagation();
            fillES(texto, pe);
        }
    });

  function init() {
    ET.utils.verboseLog('sales', { version: '1.5.0', status: 'init' });
  }

  function destroy() {}

  ET.register({
    name: 'sales',
    version: '1.5.0',
    init: init,
    destroy: destroy,
    css: '',
    api: {
      llenar: llenar,
      parsear: parsear,
      parsearES: parsearES,
      fillES: fillES
    }
  });
})();