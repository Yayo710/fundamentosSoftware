<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$CFG = is_file(__DIR__ . '/config.php') ? (require __DIR__ . '/config.php') : [];

const DATA_DIR = __DIR__ . '/data';
const GAMES_DIR = DATA_DIR . '/games';
const CACHE_DIR = DATA_DIR . '/cache';
const MAX_PGN = 200000;
const MAX_RECORD = 3000000;

foreach ([DATA_DIR, GAMES_DIR, CACHE_DIR] as $d) {
    if (!is_dir($d)) {
        @mkdir($d, 0775, true);
    }
}

/* ---------- utilidades ---------- */

function out($data, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}

function body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

function validId(string $id): bool
{
    return (bool) preg_match('/^[a-f0-9]{40}$/', $id);
}

function readJson(string $file, $default = null)
{
    if (!is_file($file)) {
        return $default;
    }
    $j = json_decode((string) file_get_contents($file), true);
    return $j === null ? $default : $j;
}

function writeJson(string $file, $data): bool
{
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false || file_put_contents($tmp, $json, LOCK_EX) === false) {
        @unlink($tmp);
        return false;
    }
    return rename($tmp, $file);
}

function parseHeaders(string $pgn): array
{
    preg_match_all('/^\s*\[(\w+)\s+"((?:[^"\\\\]|\\\\.)*)"\]\s*$/m', $pgn, $m, PREG_SET_ORDER);
    $h = [];
    foreach ($m as $x) {
        $h[$x[1]] = stripslashes($x[2]);
    }
    return $h;
}

function countPlies(string $pgn): int
{
    $t = preg_replace('/^\s*\[.*\]\s*$/m', ' ', $pgn);
    $t = preg_replace('/\{[^}]*\}|;[^\n]*|\([^)]*\)|\$\d+/', ' ', (string) $t);
    $t = preg_replace('/\d+\.(\.\.)?/', ' ', (string) $t);
    $t = preg_replace('/(^|\s)(1-0|0-1|1\/2-1\/2|\*)(\s|$)/', ' ', (string) $t);
    $tokens = preg_split('/\s+/', trim((string) $t), -1, PREG_SPLIT_NO_EMPTY);
    return count($tokens ?: []);
}

function gameFile(string $id): string
{
    return GAMES_DIR . "/$id.json";
}

/* ---------- motor Stockfish del servidor ---------- */

function stockfishCommand(array $cfg): ?string
{
    $c = getenv('STOCKFISH_PATH') ?: ($cfg['stockfish'] ?? '');
    if (is_string($c) && $c !== '') {
        return $c;
    }
    foreach (['/usr/games/stockfish', '/usr/bin/stockfish', '/usr/local/bin/stockfish', '/opt/homebrew/bin/stockfish'] as $p) {
        if (is_file($p) && is_executable($p)) {
            return $p;
        }
    }
    if (function_exists('shell_exec')) {
        $w = @shell_exec(stripos(PHP_OS, 'WIN') === 0 ? 'where stockfish 2>NUL' : 'command -v stockfish 2>/dev/null');
        if (is_string($w) && trim($w) !== '') {
            return trim(strtok($w, "\r\n"));
        }
    }
    return null;
}

/** Ejecuta una consulta UCI y devuelve [{t:'cp'|'mate', v:int, pv:[uci…]}…] ordenadas por multipv. */
function runEngine(string $cmd, string $fen, int $depth, int $mpv, int $timeout = 90): array
{
    $null = DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null';
    $proc = @proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['file', $null, 'w']], $pipes);
    if (!is_resource($proc)) {
        throw new RuntimeException('No se pudo iniciar el motor');
    }
    stream_set_blocking($pipes[1], false);
    $send = static function (string $s) use ($pipes): void {
        @fwrite($pipes[0], $s . "\n");
    };
    $send('uci');
    $send('setoption name Threads value 1');
    $send('setoption name Hash value 64');
    $send('setoption name MultiPV value ' . $mpv);
    $send('isready');
    $send('position fen ' . $fen);
    $send('go depth ' . $depth);

    $buf = '';
    $lines = [];
    $best = null;
    $deadline = microtime(true) + $timeout;
    while (microtime(true) < $deadline && $best === null) {
        $r = [$pipes[1]];
        $w = null;
        $e = null;
        if (stream_select($r, $w, $e, 1) === false) {
            break;
        }
        if ($r) {
            $chunk = fread($pipes[1], 65536);
            if ($chunk === false || ($chunk === '' && feof($pipes[1]))) {
                break;
            }
            $buf .= $chunk;
        }
        while (($pos = strpos($buf, "\n")) !== false) {
            $line = rtrim(substr($buf, 0, $pos), "\r");
            $buf = substr($buf, $pos + 1);
            if (str_starts_with($line, 'bestmove')) {
                $best = trim(substr($line, 9));
                break;
            }
            if (str_starts_with($line, 'info') && str_contains($line, ' pv ') && !preg_match('/(lower|upper)bound/', $line)) {
                if (preg_match('/ score (cp|mate) (-?\d+)/', $line, $sc)) {
                    $k = preg_match('/ multipv (\d+)/', $line, $mm) ? (int) $mm[1] : 1;
                    $pv = preg_split('/\s+/', trim(substr($line, strpos($line, ' pv ') + 4)));
                    $lines[$k] = ['t' => $sc[1], 'v' => (int) $sc[2], 'pv' => array_slice($pv, 0, 10)];
                }
            }
        }
    }
    $send('quit');
    @fclose($pipes[0]);
    @fclose($pipes[1]);
    @proc_terminate($proc);
    @proc_close($proc);

    if ($best === null) {
        throw new RuntimeException('El motor no devolvió resultado');
    }
    ksort($lines);
    $lines = array_values($lines);
    if (!$lines) {
        $bm = explode(' ', $best)[0];
        if ($bm !== '' && $bm !== '(none)') {
            $lines[] = ['t' => 'cp', 'v' => 0, 'pv' => [$bm]];
        }
    }
    return $lines;
}

/* ---------- explorador de maestros (Lichess) ---------- */

function httpGet(string $url, array $headers): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_HTTPHEADER => $headers, CURLOPT_FOLLOWLOCATION => true]);
        $res = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return [$code, is_string($res) ? $res : ''];
    }
    $ctx = stream_context_create(['http' => ['header' => implode("\r\n", $headers), 'timeout' => 20, 'ignore_errors' => true]]);
    $res = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach (($http_response_header ?? []) as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) {
            $code = (int) $m[1];
        }
    }
    return [$code, is_string($res) ? $res : ''];
}

/* ---------- enrutador ---------- */

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

switch ($action) {
    /* ===== biblioteca de partidas ===== */
    case 'games':
        $items = [];
        foreach (array_slice(glob(GAMES_DIR . '/*.json') ?: [], 0, 2000) as $f) {
            $r = readJson($f);
            if (is_array($r) && isset($r['id'])) {
                $items[] = $r;
            }
        }
        usort($items, fn($a, $b) => strcmp((string) ($b['headers']['Date'] ?? ''), (string) ($a['headers']['Date'] ?? '')) ?: strcmp((string) $b['saved'], (string) $a['saved']));
        out(['items' => $items]);

    case 'import':
        if ($method !== 'POST') {
            out(['error' => 'Método no permitido'], 405);
        }
        $list = body()['games'] ?? [];
        if (!is_array($list) || !$list || count($list) > 1000) {
            out(['error' => 'Lista de partidas vacía o demasiado grande (máx. 1000)'], 400);
        }
        $res = [];
        foreach ($list as $pgn) {
            $pgn = trim((string) $pgn);
            if ($pgn === '' || strlen($pgn) > MAX_PGN) {
                $res[] = ['id' => null, 'error' => 'PGN vacío o demasiado grande'];
                continue;
            }
            $id = sha1((string) preg_replace('/\s+/', ' ', $pgn));
            if (is_file(gameFile($id))) {
                $res[] = ['id' => $id, 'existed' => true];
                continue;
            }
            $ok = writeJson(gameFile($id), [
                'id' => $id, 'saved' => date('c'), 'headers' => parseHeaders($pgn), 'plies' => countPlies($pgn),
                'pgn' => $pgn, 'side' => null, 'meta' => null, 'analysis' => null, 'derived' => null,
            ]);
            $res[] = $ok ? ['id' => $id, 'existed' => false] : ['id' => null, 'error' => 'No se pudo escribir en data/games (revisa permisos)'];
        }
        out(['items' => $res]);

    case 'game_save':
        if ($method !== 'POST') {
            out(['error' => 'Método no permitido'], 405);
        }
        $b = body();
        $id = (string) ($b['id'] ?? '');
        if (!validId($id) || !is_file(gameFile($id))) {
            out(['error' => 'Partida no encontrada'], 404);
        }
        $r = readJson(gameFile($id), []);
        if (array_key_exists('side', $b)) {
            $r['side'] = in_array($b['side'], ['w', 'b'], true) ? $b['side'] : null;
        }
        foreach (['analysis', 'derived', 'meta'] as $k) {
            if (array_key_exists($k, $b)) {
                $r[$k] = is_array($b[$k]) ? $b[$k] : null;
            }
        }
        $r['saved'] = date('c');
        if (strlen((string) json_encode($r)) > MAX_RECORD) {
            out(['error' => 'El análisis es demasiado grande'], 413);
        }
        out(writeJson(gameFile($id), $r) ? ['ok' => true] : ['error' => 'No se pudo guardar'], 200);

    case 'game_delete':
        if ($method !== 'POST') {
            out(['error' => 'Método no permitido'], 405);
        }
        $ids = body()['ids'] ?? [];
        $n = 0;
        foreach ((array) $ids as $id) {
            if (is_string($id) && validId($id) && is_file(gameFile($id)) && unlink(gameFile($id))) {
                $n++;
            }
        }
        out(['ok' => true, 'deleted' => $n]);

    /* ===== perfil del jugador y progreso del entrenador ===== */
    case 'profile_get':
        out(['profile' => readJson(DATA_DIR . '/profile.json', new stdClass())]);

    case 'profile_save':
        $p = body()['profile'] ?? null;
        if (!is_array($p) || strlen((string) json_encode($p)) > 200000) {
            out(['error' => 'Perfil inválido'], 400);
        }
        out(writeJson(DATA_DIR . '/profile.json', $p) ? ['ok' => true] : ['error' => 'No se pudo guardar'], 200);

    case 'training_get':
        out(['training' => readJson(DATA_DIR . '/training.json', new stdClass())]);

    case 'training_save':
        $t = body()['training'] ?? null;
        if (!is_array($t) || strlen((string) json_encode($t)) > 2000000) {
            out(['error' => 'Progreso inválido'], 400);
        }
        out(writeJson(DATA_DIR . '/training.json', $t) ? ['ok' => true] : ['error' => 'No se pudo guardar'], 200);

    /* ===== motor del servidor ===== */
    case 'engine_status':
        $cmd = stockfishCommand($CFG);
        if (!$cmd || !function_exists('proc_open')) {
            out(['available' => false, 'message' => 'No se encontró Stockfish en el servidor (instálalo o indica la ruta en config.php).']);
        }
        try {
            $l = runEngine($cmd, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 1, 1, 15);
            out(['available' => (bool) $l, 'message' => 'Stockfish nativo disponible']);
        } catch (Throwable $e) {
            out(['available' => false, 'message' => 'El motor del servidor no responde: ' . $e->getMessage()]);
        }

    case 'engine':
        if ($method !== 'POST') {
            out(['error' => 'Método no permitido'], 405);
        }
        $b = body();
        $fen = trim((string) ($b['fen'] ?? ''));
        if (!preg_match('#^[1-8pnbrqkPNBRQK/]{15,80} [wb] (-|[KQkq]{1,4}) (-|[a-h][36]) \d{1,3} \d{1,4}$#', $fen)) {
            out(['error' => 'FEN inválido'], 400);
        }
        $depth = max(1, min((int) ($b['depth'] ?? 12), (int) ($CFG['max_depth'] ?? 22)));
        $mpv = max(1, min((int) ($b['multipv'] ?? 1), 5));
        $cmd = stockfishCommand($CFG);
        if (!$cmd) {
            out(['error' => 'No hay Stockfish en el servidor'], 503);
        }
        try {
            out(['lines' => runEngine($cmd, $fen, $depth, $mpv)]);
        } catch (Throwable $e) {
            out(['error' => $e->getMessage()], 500);
        }

    /* ===== explorador de maestros ===== */
    case 'masters':
        $fen = trim((string) ($_GET['fen'] ?? ''));
        if (!preg_match('#^[1-8pnbrqkPNBRQK/]{15,80} [wb] (-|[KQkq]{1,4}) (-|[a-h][36])( \d{1,3} \d{1,4})?$#', $fen)) {
            out(['error' => 'FEN inválido'], 400);
        }
        $cache = CACHE_DIR . '/masters_' . sha1($fen) . '.json';
        if (is_file($cache) && filemtime($cache) > time() - 30 * 86400) {
            out(readJson($cache, ['error' => 'caché ilegible']));
        }
        $token = getenv('LICHESS_TOKEN') ?: ($CFG['lichess_token'] ?? '');
        if (!$token) {
            out(['error' => 'no_token', 'message' => 'Falta el token de Lichess. El explorador de maestros exige autenticación: crea un token personal en lichess.org/account/oauth/token (sin permisos) y ponlo en config.php.'], 401);
        }
        [$code, $res] = httpGet(
            'https://explorer.lichess.ovh/masters?moves=8&topGames=0&fen=' . rawurlencode($fen),
            ['Authorization: Bearer ' . $token, 'Accept: application/json', 'User-Agent: ajedrez-analizador']
        );
        $j = json_decode($res, true);
        if ($code !== 200 || !is_array($j)) {
            out(['error' => 'explorer', 'message' => "El explorador de Lichess respondió $code"], $code === 401 ? 401 : 502);
        }
        $moves = [];
        foreach (($j['moves'] ?? []) as $m) {
            $moves[] = ['uci' => $m['uci'] ?? '', 'san' => $m['san'] ?? '', 'games' => (int) (($m['white'] ?? 0) + ($m['draws'] ?? 0) + ($m['black'] ?? 0)),
                'white' => (int) ($m['white'] ?? 0), 'draws' => (int) ($m['draws'] ?? 0), 'black' => (int) ($m['black'] ?? 0)];
        }
        $norm = ['total' => (int) (($j['white'] ?? 0) + ($j['draws'] ?? 0) + ($j['black'] ?? 0)), 'white' => (int) ($j['white'] ?? 0),
            'draws' => (int) ($j['draws'] ?? 0), 'black' => (int) ($j['black'] ?? 0), 'moves' => $moves, 'opening' => $j['opening']['name'] ?? null];
        writeJson($cache, $norm);
        out($norm);

    default:
        out(['error' => 'Acción desconocida'], 400);
}
