<?php
declare(strict_types=1);

$base = __DIR__;
$scripts = [
    'vendor/chess.js',
    'assets/js/pgn.js', 'assets/js/tactics.js', 'assets/js/openings.js', 'assets/js/analysis.js',
    'assets/js/engine.js', 'assets/js/coach.js', 'assets/js/training.js',
    'assets/js/ui-lib.js', 'assets/js/store.js', 'assets/js/board.js',
    'assets/js/view-game.js', 'assets/js/view-lib.js', 'assets/js/view-profile.js', 'assets/js/view-train.js',
    'assets/js/app.js',
];
$v = static fn(string $f): int => (int) (@filemtime($base . '/' . $f) ?: 0);
$writable = is_dir($base . '/data') ? is_writable($base . '/data') : is_writable($base);
?>
<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Entrenador de ajedrez · análisis de rendimiento</title>
    <link rel="stylesheet" href="assets/style.css?v=<?= $v('assets/style.css') ?>">
</head>
<body>
<header class="top">
    <h1>♞ Entrenador de ajedrez</h1>
    <span class="sub">Analiza cómo piensas, no solo qué jugadas fallaste</span>
</header>
<nav id="tabs" class="mtabs" aria-label="Secciones"></nav>
<div id="anbar" class="anbar" hidden>
    <div class="anbar-in"><span id="anbar-text"></span><button class="btn small secondary" id="anbar-cancel">Cancelar</button></div>
    <div class="progress"><div id="anbar-fill"></div></div>
</div>
<?php if (!$writable): ?>
    <p class="banner">La carpeta <code>data/</code> no es escribible por PHP: no se podrán guardar partidas. Dale permisos de escritura.</p>
<?php endif; ?>
<main id="view"><p class="hint center">Cargando…</p></main>
<footer class="foot">Motor: Stockfish (GPLv3) · Reglas: chess.js · Las puntuaciones describen patrones de juego a partir de tus partidas; no son un diagnóstico psicológico.</footer>
<?php foreach ($scripts as $s): ?>
<script src="<?= htmlspecialchars($s, ENT_QUOTES) ?>?v=<?= $v($s) ?>"></script>
<?php endforeach; ?>
</body>
</html>
