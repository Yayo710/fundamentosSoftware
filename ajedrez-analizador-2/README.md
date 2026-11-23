# Entrenador de ajedrez · análisis de rendimiento

Aplicación en **PHP + HTML + JS + CSS** que analiza tus partidas con **Stockfish** y no se queda en
«esta jugada fue mala»: detecta **cómo juegas**, dónde te equivocas de forma recurrente y te
entrena con ejercicios sacados de **tus propios errores**.

## Ejecutar

```bash
cd ajedrez-analizador
php -S localhost:8000
```

Abre <http://localhost:8000>. También funciona en Apache/XAMPP (copia la carpeta a `htdocs`; PHP debe poder
escribir en `data/`). Requiere PHP 8.0+ y no necesita internet: `chess.js` y Stockfish (WebAssembly) van en `vendor/`.

**Primeros pasos**

1. **Ajustes** → escribe tu(s) nombre(s) de usuario (así sabe qué lado eres en cada partida).
2. **Biblioteca** → pega o sube tus PGN (un archivo con muchas partidas vale) o pulsa «Cargar ejemplo».
3. **Analizar pendientes** → el análisis corre en segundo plano con barra de progreso.
4. Explora **Diagnóstico**, **Aperturas**, **Tácticas**, **Tiempo** y practica en el **Entrenador**.

Con el motor del servidor (Stockfish nativo instalado: `apt install stockfish`, `brew install stockfish`…) el
análisis es varias veces más rápido; si no hay, se usa automáticamente Stockfish WASM en el navegador.

## Qué hace

| Módulo | Contenido |
|---|---|
| **Motor** | Stockfish con profundidad configurable (8–20), MultiPV 1–3, evaluación en centipeones y probabilidad de ganar, mejor jugada vs. jugada elegida, clasificación (Mejor, Excelente, Buena, Imprecisión, Error, Error grave), posiciones críticas («jugada única»), apertura / medio juego / final. |
| **Elegir bando** | Por nombre de usuario (automático), por partida (selector «Jugué con») o al importar. Se puede analizar solo tu bando (más rápido) o ambos. |
| **Diagnóstico** | Tabla de patrones con **puntuación 0–100 de gravedad**: sacrificios sin compensación, piezas indefensas sin aprovechar, simplificación innecesaria, ventajas ganadoras perdidas, juego rápido en posiciones complejas, juego pasivo, descuidos, ceguera ante amenazas, errores de cálculo, mala gestión del reloj, apertura descuidada y finales. Cada fila explica **cómo se mide**, muestra **ejemplos clicables** y da **consejos**. |
| **Aperturas** | Repertorio con blancas y negras: partidas, % victorias/tablas/derrotas, variante más usada, respuestas más frecuentes del rival, línea típica, **problema recurrente** (desarrollo tardío, enroque tardío, dama temprana, errores repetidos…) y comparación con **partidas de maestros** (Lichess). |
| **Tácticas** | Ataques dobles, clavadas, ensartadas, rayos X, descubiertos, desviaciones, sobrecargas, sacrificios (posicionales), redes de mate, zugzwang, piezas indefensas, casillas débiles y errores de cálculo. Para cada motivo: cuántas veces lo viste, cuántas lo **pasaste por alto** y cuántas lo **permitiste**. |
| **Tiempo** | Con relojes `[%clk]`: tiempo medio, por fase, sencillas vs. complejas, errores jugando rápido / tras pensar mucho / con poco tiempo, rendimiento por ritmo (bullet, blitz, rápidas, clásicas) y **mapa de momentos críticos** por partida. |
| **Entrenador** | Convierte cada error en un ejercicio: recupera la posición anterior, oculta la solución, **tú juegas en el tablero**, Stockfish compara tu respuesta con la mejor, y se guarda el resultado. **Repetición espaciada** (cajas de Leitner: 0, 1, 3, 7, 21 días) y panel de progreso por tema y fase. |
| **Partida** | Tablero navegable (← → Inicio Fin, F gira), barra y gráfica de evaluación, flechas con la mejor jugada, variantes MultiPV, **lectura del entrenador** de esa partida y tiempo por jugada. |

## Honestidad de los datos

- Todo se calcula con **tus partidas importadas**; nada se inventa. Si no hay muestra suficiente, la fila dice **«Sin datos»** y explica cuántas situaciones faltan.
- Las puntuaciones describen **patrones de juego**; no son un diagnóstico psicológico.
- Con pocas partidas (< 20) los porcentajes son orientativos.
- La detección táctica es **heurística** (se apoya en las líneas del motor): es muy útil para ver tendencias, pero no es exhaustiva.
- Profundidad < 10 da evaluaciones poco fiables; usa 12–14.

## Comparación con maestros (opcional)

El explorador de Lichess exige un **token personal** (gratis, sin permisos): créalo en
<https://lichess.org/account/oauth/token> y ponlo en `config.php` (`lichess_token`) o en la variable de
entorno `LICHESS_TOKEN`. Sin token, el resto funciona igual y esa comparación explica lo que falta.

## Estructura

```
index.php            página principal (carga los módulos)
api.php              biblioteca, perfil, entrenamiento, motor del servidor, maestros
config.php           ruta de Stockfish, profundidad máxima, token de Lichess
assets/js/           pgn · tactics · openings · analysis · engine · coach · training · store · board · vistas
assets/demo.pgn      8 partidas de ejemplo (jugador «Demo»)
vendor/              chess.js y Stockfish WASM
data/                tus datos (JSON); haz copia de seguridad copiando esta carpeta
tests/               core.test.js (Node + Stockfish real) y e2e.py (Playwright)
scripts/make-demo.js regenera assets/demo.pgn
```

## Pruebas

```bash
node tests/core.test.js [ruta/a/stockfish]       # núcleo con Stockfish real
php -S 127.0.0.1:8131 &  python3 tests/e2e.py http://127.0.0.1:8131/index.php /tmp   # navegador (pip install playwright)
```

## Licencias

Stockfish (GPLv3, ver `vendor/STOCKFISH-LICENSE.txt`) y chess.js (BSD-2). El código de este proyecto es tuyo.
