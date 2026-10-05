# EASYTRAC Modules

Colección de scripts de usuario (UserScript) para automatizar flujos operativos de SIRETRAC, orientados principalmente a procesos de Gas LP dentro del portal `siretrac.cne.gob.mx`.

Este repositorio centraliza varias funcionalidades modulares bajo un mismo namespace (`window.ET`), permitiendo cargar un orquestador principal que inicializa y coordina distintos módulos según la pantalla o la tarea que se esté realizando.

## ¿Qué es este proyecto?

`easytrac-modules` es una base de automatización y asistencia para usuarios de SIRETRAC. En lugar de ser una app web independiente, es un conjunto de scripts que se ejecutan en el navegador y extienden la interfaz de la plataforma con:

- llenado automático de formularios
- validación y pre-carga de datos
- automatización de registros y ventas
- gestión de fechas y formularios
- descarga y análisis de acuses/documentos
- manejo reutilizable de configuración, UI y eventos

El proyecto está diseñado para funcionar como un conjunto de módulos, donde cada uno encapsula una funcionalidad específica y comparte infraestructura común.

## Estructura del repositorio

```text
.
├── .gitignore
├── main/
│   └── main.user.js
├── modules/
│   ├── module-acs.js
│   ├── module-acs-rep.js
│   ├── module-acuses.js
│   ├── module-sales.js
│   ├── module-stoolkit.js
│   └── shared.js
└── README.md
```

## Módulos incluidos

### 1) `main/main.user.js`
Es el script principal y orquestador del sistema.

Funciones principales:
- inicializa el namespace global `window.ET`
- expone APIs de almacenamiento (`GM_getValue`, `GM_setValue`)
- agrega soporte para estilo global y descarga de archivos
- registra e inicializa cada módulo disponible
- crea una UI global de estado (botón de emergencia, diagnóstico rápido)
- emite eventos de readiness para depuración y coordinación

Este archivo es el punto de entrada del ecosistema y carga los módulos necesarios a través de `@require`.

### 2) `modules/shared.js`
Es el núcleo común que define la infraestructura reutilizable:
- `window.ET` como namespace global
- registro de módulos mediante `ET.register()`
- event bus (`ET.on`, `ET.emit`, `ET.off`)
- almacenamiento seguro con fallback a `localStorage`
- utilidades compartidas (`norm`, `sleep`, `fmtNum`, `esc`, etc.)
- helpers para construir paneles y toasts dentro de la aplicación

Funge como base sobre la que todos los demás módulos construyen sus lógica.

### 3) `modules/module-acs.js`
Módulo orientado a automatización de ACS (registro y flujo relacionado con SIRETRAC).

Incluye lógica para:
- manejar configuración del módulo
- controlar estado interno y UI
- procesar fechas y tiempos
- registrar comprobaciones, progreso y eventos
- automatizar pasos complejos del proceso de ACS

Es uno de los módulos más completos del proyecto y se encarga de la automatización de operaciones de negocio dentro del sistema.

### 4) `modules/module-acs-rep.js`
Módulo de repetición / traspasos / continuidad de registros.

Sus responsabilidades son:
- guardar historial de registros
- manejar presets y parámetros reutilizables
- navegar entre pantallas del flujo
- apoyar la repetición de procesos y manejo de cadenas de operación
- detectar estados, errores y escenarios de continuación

Está pensado para reforzar workflows repetitivos y de alta carga.

### 5) `modules/module-sales.js`
Módulo de ventas y captura masiva de información.

Características destacadas:
- detecta bloques de ventas desde texto pegado (por ejemplo, exportado desde Excel)
- interpreta fechas y meses en español
- parsea volúmenes, importes y totales
- identifica estados, municipios y sectores
- llena formularios de venta automáticamente
- soporta escenarios de "sin venta" y validación de resultados
- permite registrar información de estación de servicio o auto-tanque

Este módulo es una de las piezas más prácticas del proyecto, ya que automatiza el pegado de datos tabulares para completar procesos de venta.

### 6) `modules/module-stoolkit.js`
Módulo de utilidad para apoyo en formularios y validación de fechas.

Incluye:
- panel flotante con entrada de fecha
- validación del formato de calendario
- ajustes auxiliares para formularios de compra/venta
- compatibilidad con herramientas de UI si están disponibles
- soporte para mantener flujo consistente en pantallas con requisitos de fecha

Es un módulo de soporte práctico para escenarios específicos dentro del proceso operativo.

### 7) `modules/module-acuses.js`
Módulo orientado a gestión y análisis de acuses/documentos.

Abarca:
- búsqueda y procesamiento de registros
- análisis de fechas y permisos
- extracción/visualización de datos asociados a acuses
- explorador de registros
- selección y descarga de PDFs
- verificación del estado de documentos
- exportación de resultados y manejo de errores

Es un módulo de administración documental y operativa, útil para seguimiento y revisión de acuses y documentos asociados.

## Cómo funciona

El proyecto no es un proyecto estándar de Node.js o React; es un conjunto de UserScript que se ejecuta dentro del navegador con soporte de usuarioscript managers como:

- Tampermonkey
- Violentmonkey
- Greasemonkey

El flujo típico es:

1. Se instala `main.user.js` en el navegador.
2. El script descarga o carga los módulos declarados con `@require`.
3. `shared.js` crea el namespace `ET`.
4. El orquestador principal carga cada módulo y los inicializa.
5. Cada módulo se activa según la página y el contexto de SIRETRAC en que se encuentre el usuario.
6. Los módulos interactúan con DOM, formularios y APIs del sitio para automatizar tareas repetitivas.

## Requisitos

- navegador con soporte de usuarioscripts
- acceso a `siretrac.cne.gob.mx`
- jQuery incluido por la dependencia del script principal
- permisos del navegador para ejecutar scripts en el dominio del sistema

## Instalación

1. Usa un gestor de userscripts compatible.
2. Importa el archivo `main/main.user.js`.
3. Asegúrate de que la extensión tenga permisos sobre el dominio de SIRETRAC.
4. Recarga la página de SIRETRAC para que se inicien los módulos.

## Notas importantes

- Este repositorio está orientado a automatización funcional específica del sistema SIRETRAC y no es un proyecto genérico de frontend.
- La estructura del proyecto es modular y extensible: cada script puede funcionar de manera independiente o como parte del conjunto global.
- El código está escrito en JavaScript puro, sin dependencias de build ni bundler.
- La lógica se apoya mucho en manipulación del DOM y en datos del portal institucional, por lo que puede requerir ajustes conforme cambie la plataforma.

## Uso recomendado

- Instalar solo el script principal (`main.user.js`), ya que este se encarga de cargar los demás módulos.
- Revisar el estado del sistema mediante el botón global `ET` que crea el orquestador.
- Utilizar los módulos según la operación a realizar:
  - `sales` para importar y completar ventas
  - `stoolkit` para apoyo en formularios y validación de fechas
  - `acuses` para analizar y descargar documentos
  - `acs` y `acs-rep` para flujos de registro y continuidad

## Propósito general

`easytrac-modules` es un conjunto de herramientas de apoyo para acelerar tareas repetitivas, reducir errores manuales y facilitar la gestión operativa dentro de SIRETRAC.

## Licencia

No se indica una licencia explícita en el repositorio. Si revisas el contenido del proyecto en GitHub, confirma la licencia antes de reutilizarlo en entornos productivos o públicos.

## Resumen corto

Proyecto JavaScript modular para automatizar procesos de SIRETRAC con UserScript, compuesto por un orquestador principal y varios módulos especializados en ventas, fechas, acuses, ACS y utilidades compartidas.

---

Si quieres, puedo dejarte una segunda versión del README más orientada a:
- perfil técnico para GitHub,
- uso doméstico/operativo para usuarios finales,
- o una versión más elegante y comercial con badges y secciones premium.

