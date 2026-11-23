<?php
// Configuración opcional. Todo funciona sin tocar nada: sin motor de servidor se usa Stockfish WASM
// en el navegador (carpeta vendor/).
return [
    // Ruta o comando del Stockfish nativo (más rápido que WASM). Vacío = autodetectar
    // (/usr/games/stockfish, /usr/bin/stockfish, /usr/local/bin/stockfish o el PATH).
    // También puede indicarse con la variable de entorno STOCKFISH_PATH.
    'stockfish' => '',

    // Profundidad máxima aceptada por el endpoint del motor.
    'max_depth' => 22,

    // Token personal de Lichess (sin permisos) para comparar tus aperturas con partidas de maestros.
    // El explorador de aperturas de Lichess exige autenticación. Vacío = función desactivada.
    // También puede indicarse con la variable de entorno LICHESS_TOKEN.
    'lichess_token' => '',
];
