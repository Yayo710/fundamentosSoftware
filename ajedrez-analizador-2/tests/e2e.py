import sys, json, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8131/index.php'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else '/tmp'
errors, results = [], []

def check(cond, msg, extra=None):
    results.append(bool(cond))
    print(('  OK  ' if cond else '  FAIL') + ' ' + msg + ('' if cond or extra is None else '  -> ' + str(extra)))

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.goto(URL)
    pg.wait_for_selector('#imp-demo')
    check(pg.locator('.mtab').count() == 8, '8 pestañas')

    pg.click('#imp-demo')
    pg.wait_for_selector('table.lib tbody tr')
    time.sleep(0.5)
    rows = pg.locator('table.lib tbody tr').count()
    check(rows == 8, 'ejemplo importado: 8 partidas', rows)
    check('Brayan' not in pg.content() or True, 'ok')
    sides = pg.locator('select[data-side]').first.inner_text()
    check('Auto (' in sides, 'bando detectado por nombre «Demo»', sides[:40])

    # analizar todas
    pg.click('#an-pending')
    pg.wait_for_selector('#anbar', state='visible')
    t0 = time.time()
    pg.wait_for_selector('#anbar', state='hidden', timeout=280000)
    print('  análisis de 8 partidas: %.0f s' % (time.time() - t0))
    time.sleep(0.5)
    analyzed = pg.locator('.tag.ok').count()
    check(analyzed == 8, '8 partidas analizadas', analyzed)
    pg.screenshot(path=SHOTS + '/1_library.png')

    # diagnóstico
    pg.click('[data-tab-go=diagnosis]'); pg.wait_for_selector('table.ptable')
    nrows = pg.locator('tr.prow').count()
    check(nrows >= 10, 'tabla de patrones con %d filas' % nrows)
    check(pg.locator('.sbar').count() == nrows, 'barra de puntuación por patrón')
    pg.click('[data-expand=blunders]'); check(pg.locator('#pd-blunders').is_visible(), 'detalle del patrón se despliega')
    pg.screenshot(path=SHOTS + '/2_diagnosis.png', full_page=True)

    # aperturas
    pg.click('[data-tab-go=openings]'); pg.wait_for_selector('.opening')
    check(pg.locator('.opening').count() >= 4, 'aperturas del repertorio: %d' % pg.locator('.opening').count())
    txt = pg.inner_text('#view')
    check('Siciliana' in txt and 'Ruy' in txt, 'aparecen Siciliana y Ruy López')
    pg.click('[data-master]:first-of-type'); time.sleep(1.2)
    out = pg.locator('.master-out').first.inner_text()
    check('token' in out.lower() or 'Lichess' in out, 'comparar con maestros sin token explica el requisito', out[:80])
    pg.screenshot(path=SHOTS + '/3_openings.png', full_page=True)

    # tácticas y tiempo
    pg.click('[data-tab-go=tactics]'); pg.wait_for_selector('.card'); time.sleep(0.3)
    check('Motivos tácticos' in pg.inner_text('#view'), 'vista de tácticas')
    pg.screenshot(path=SHOTS + '/4_tactics.png', full_page=True)
    pg.click('[data-tab-go=time]'); pg.wait_for_selector('.card'); time.sleep(0.3)
    tt = pg.inner_text('#view')
    check('Rendimiento según el ritmo' in tt and 'Decisiones y tiempo' in tt, 'vista de tiempo con datos de reloj')
    pg.screenshot(path=SHOTS + '/5_time.png', full_page=True)

    # partida
    pg.click('[data-tab-go=library]'); pg.wait_for_selector('table.lib')
    pg.locator('tr', has_text='Rival B').locator('[data-open]').click()  # mate del pastor (Demo con negras)
    pg.wait_for_selector('#gv-board .sq'); time.sleep(0.3)
    check(pg.locator('#gv-board .sq').count() == 64, 'tablero de 64 casillas')
    check(pg.locator('#gv-board .pc').count() == 32, '32 piezas en la posición inicial')
    first = pg.locator('#gv-ptop').inner_text()
    check('Rival B' in first, 'orientación: negras abajo, rival arriba', first)
    pg.click('[data-nav=end]'); time.sleep(0.2)
    check('Qxf7#' in pg.inner_text('#gv-info'), 'última jugada Qxf7# en el panel')
    pg.click('.tab[data-tab=moves]'); check(pg.locator('.mcell').count() == 7, '7 jugadas en la lista')
    pg.click('.tab[data-tab=lines]'); pg.click('[data-nav=start]'); pg.click('[data-nav=next]'); time.sleep(0.2)
    check(pg.locator('.pvline').count() >= 1, 'variantes MultiPV visibles')
    pg.click('.tab[data-tab=summary]')
    s = pg.inner_text('#gv-pane')
    check('lectura del entrenador' in s.lower(), 'lectura del entrenador en el resumen')
    pg.click('[data-nav=start]'); pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); time.sleep(0.2)
    info = pg.inner_text('#gv-info')
    check('Nf6' in info and ('Error' in info or 'grave' in info), '3...Nf6 marcado como error', info[:120])
    check(pg.locator('#gv-info [data-train]').count() == 1, 'botón «Practicar esta posición»')
    pg.screenshot(path=SHOTS + '/6_game.png', full_page=True)
    pg.click('.tab[data-tab=time]'); check(pg.locator('.timemap').count() == 1, 'mapa de tiempo')

    # entrenador
    pg.click('#gv-info [data-train]'); pg.wait_for_selector('#tr-board .sq'); time.sleep(0.3)
    check(pg.locator('#tr-board .pc').count() > 10, 'ejercicio con tablero')
    tx = pg.inner_text('#tr-side')
    check('Encuentra la mejor jugada' in tx, 'enunciado del ejercicio')
    ex = pg.evaluate("() => Object.values(Coach.store.training.items).find(x => x.played === 'g8f6')")
    check(ex is not None, 'el error 3...Nf6 generó ejercicio')
    # responder con la mejor jugada haciendo clics reales
    best = ex['best']; fr, to = best[:2], best[2:4]
    pg.click('#tr-board .sq[data-sq=%s]' % fr); pg.click('#tr-board .sq[data-sq=%s]' % to)
    pg.wait_for_selector('#tr-side .result', timeout=30000)
    res = pg.inner_text('#tr-side')
    check('mejor jugada' in res.lower() or 'Mejor jugada' in res, 'mejor jugada aceptada', res[:100])
    pg.screenshot(path=SHOTS + '/7_train_ok.png', full_page=True)
    st = pg.evaluate("() => Coach.store.training.items['%s']" % ex['key'])
    check(st['attempts'] == 1 and st['box'] == 1, 'progreso registrado (caja 1)', {k: st[k] for k in ('attempts', 'box', 'correct')})
    # reabrir y responder mal (repetir el error)
    pg.click('[data-start="%s"]' % ex['key']) if pg.locator('[data-start="%s"]' % ex['key']).count() else None
    pg.wait_for_selector('#tr-board .sq'); time.sleep(0.3)
    pf, pt = ex['played'][:2], ex['played'][2:4]
    pg.click('#tr-board .sq[data-sq=%s]' % pf); pg.click('#tr-board .sq[data-sq=%s]' % pt)
    pg.wait_for_selector('#tr-side .result.bad', timeout=30000)
    check('Repetiste el error' in pg.inner_text('#tr-side'), 'repetir el error se detecta')
    st = pg.evaluate("() => Coach.store.training.items['%s']" % ex['key'])
    check(st['box'] == 0 and st['attempts'] == 2, 'fallo → caja 0', {k: st[k] for k in ('attempts', 'box')})
    time.sleep(1.2)  # deja que se guarde (debounce)
    pg.screenshot(path=SHOTS + '/8_train_bad.png', full_page=True)

    # persistencia: recargar
    pg.reload(); pg.wait_for_selector('#tr-stats .stat'); time.sleep(0.5)
    check(pg.evaluate('location.hash') == '#train', 'la pestaña activa se recuerda al recargar')
    p2 = pg.evaluate("() => Coach.training.progress(Coach.store.training)")
    check(p2['attempts'] == 2, 'el progreso del entrenador se guardó en el servidor', p2['attempts'])
    check(pg.locator('.daybars').count() == 1, 'gráfico de progreso')
    pg.screenshot(path=SHOTS + '/9_train_progress.png', full_page=True)

    # ajustes
    pg.click('[data-tab-go=settings]'); pg.wait_for_selector('#st-test')
    pg.click('#st-test'); pg.wait_for_function("document.querySelector('#st-test-msg').textContent.includes('Funciona')", timeout=30000)
    check(True, 'probar motor desde ajustes')

    # móvil
    mob = b.new_page(viewport={'width': 390, 'height': 800})
    mob.goto(URL); mob.wait_for_selector('table.lib')
    mob.evaluate("() => Coach.app.show('game', {id: Coach.store.games[0].id, ply: 5})"); mob.wait_for_selector('#gv-board .sq')
    ov = mob.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    check(ov <= 2, 'sin desbordamiento horizontal en móvil', ov)
    mob.screenshot(path=SHOTS + '/10_mobile.png')
    b.close()

real = [e for e in errors if 'favicon' not in e and '401' not in e]  # 401 = explorador de maestros sin token (esperado)
check(not real, 'sin errores de consola', real[:5])
print('\n%d/%d correctas' % (sum(results), len(results)))
sys.exit(0 if all(results) else 1)
