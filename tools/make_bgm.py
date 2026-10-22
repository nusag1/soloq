"""幸とソロQ：アプリのBGM（オリジナルの lo-fi / chill）をコードだけで作る。PC3 で使う。

  python -X utf8 tools/make_bgm.py               # 全部作る
  python -X utf8 tools/make_bgm.py yoru ame      # 指定した曲だけ

- サンプル・外部の音源は使わない。エレピ（FM）、ベース、キック・スネア・ハット（ノイズ）、パッド、
  メロディ（ベル・カリンバ・フルートっぽい音）、レコードのぷちぷち・雨の音を、ぜんぶ numpy で合成する
- 曲の終わりと始まりがつながるように、全部を「輪っか」のバッファに書く（はみ出た余韻は頭に回る。
  リバーブ・テープのゆれ・フィルタも輪っかのまま計算する）ので、ループしても切れ目がない
- ラウドネスは ffmpeg の loudnorm で測って -16 LUFS・ピーク -1.5 dBFS 以下にそろえる
- 出力は bgm/<id>.mp3（ステレオ 44.1kHz 96kbps）と bgm/index.json（曲名・気分・秒数）
- 乱数の種は曲ごとに固定なので、何度作っても同じ曲になる
"""
import json, os, sys, glob, wave, subprocess, tempfile, itertools
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'bgm'
HOME = Path.home()
FFMPEG = os.environ.get('FFMPEG') or next(iter(sorted(glob.glob(str(HOME / 'tools' / 'ffmpeg-*' / 'bin' / 'ffmpeg.exe')))), 'ffmpeg')
SR = 44100
TARGET_LUFS = -16.0
CREDIT = '幸とソロQ オリジナル（開発部）'

NOTE = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8,
        'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
# 和音（根音からの音程）。エレピはルートを抜いた4声で弾き、ルートはベースが受け持つ
QUAL = {'maj9': [4, 7, 11, 14], 'maj7': [0, 4, 7, 11], 'm9': [3, 7, 10, 14], 'm7': [0, 3, 7, 10], 'm11': [3, 10, 14, 17],
        '9': [4, 7, 10, 14], '13': [4, 10, 14, 21], '7sus': [5, 7, 10, 14], '7b9': [4, 7, 10, 13], '69': [4, 7, 9, 14],
        'm6': [3, 7, 9, 14], '7': [0, 4, 7, 10]}


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ===== 曲の設計 =====
# prog: 8小節ぶん。各小節は [(根音, 種類, 何拍目から)]。form: (小節数, 鳴らす楽器)
TRACKS = [
    dict(id='yoru', title='夜のキュー待ち', mood='夜・落ち着く', seed=11, bpm=72, swing=0.60, lp=7500, rev=0.42, crackle=1.0,
         prog=[[('G', 'm9', 0)], [('C', '13', 0)], [('F', 'maj9', 0)], [('D', 'm9', 0)],
               [('Bb', 'maj9', 0)], [('A', 'm7', 0)], [('G', 'm9', 0)], [('C', '7sus', 0), ('C', '13', 2)]],
         comp=[[(0, 6, .8), (6, 10, .62)], [(0, 3, .78), (3, 7, .55), (10, 6, .6)]],
         bassp=[(0, 6, 'R'), (7, 2, 'R'), (10, 4, '5'), (14, 2, 'A')],
         kick=['X......x..X.....', 'X......x..X..x..'], snare=['....X.......X...', '....X.......X.gg'],
         hat=['X.x.X.x.X.x.X.xg', 'X.x.X.x.X.x.X.x.'], snare_kind='snare', lead='bell', lead_oct=0,
         form=[(2, 'ep bass'), (8, 'ep bass kick snare hat'), (8, 'ep bass kick snare hat mel'),
               (8, 'ep bass pad hat mel'), (8, 'ep bass kick snare hat'), (8, 'ep bass kick snare hat mel'),
               (4, 'ep bass kick snare hat'), (2, 'ep pad')]),
    dict(id='ame', title='雨のレンジ', mood='雨・しっとり', seed=23, bpm=70, swing=0.58, lp=6200, rev=0.5, crackle=0.4, rain=1.0,
         prog=[[('F', 'maj9', 0)], [('E', 'm7', 0)], [('A', 'm9', 0)], [('G', 'm7', 0), ('C', '9', 2)],
               [('F', 'maj9', 0)], [('E', 'm7', 0)], [('D', 'm9', 0)], [('G', '7sus', 0)]],
         comp=[[(0, 16, .7)], [(0, 7, .66), (8, 8, .52)]],
         bassp=[(0, 8, 'R'), (8, 4, '5'), (12, 4, 'R')],
         kick=['X.........X.....', 'X.........X..x..'], snare=['....x.......x...', '....x.......x..g'],
         hat=['x.g.x.g.x.g.x.g.', 'x.g.x.g.x.g.x.gg'], snare_kind='rim', lead='kalimba', lead_oct=0,
         form=[(2, 'ep pad'), (6, 'ep pad bass hat'), (8, 'ep bass kick snare hat mel'), (8, 'ep bass pad kick snare hat'),
               (8, 'ep bass kick snare hat mel'), (6, 'ep bass pad hat mel'), (2, 'ep pad')]),
    dict(id='asa', title='朝のウォームアップ', mood='朝・すっきり', seed=37, bpm=80, swing=0.56, lp=10500, rev=0.32, crackle=0.5,
         prog=[[('D', 'maj9', 0)], [('B', 'm9', 0)], [('E', 'm9', 0)], [('A', '13', 0)],
               [('G', 'maj9', 0)], [('F#', 'm7', 0)], [('E', 'm9', 0)], [('A', '7sus', 0), ('A', '13', 2)]],
         comp=[[(0, 3, .75), (3, 3, .55), (6, 4, .6), (12, 4, .55)], [(0, 6, .75), (6, 4, .55), (10, 6, .62)]],
         bassp=[(0, 3, 'R'), (3, 3, 'R'), (6, 2, '8'), (10, 3, '5'), (14, 2, 'A')],
         kick=['X.....x...X.....', 'X.....x...X..x..'], snare=['....X.......X...', '....X..g....X.g.'],
         hat=['x.g.X.g.x.g.X.g.', 'x.g.X.g.x.g.X.gg'], snare_kind='snare', lead='flute', lead_oct=0,
         form=[(2, 'ep bass hat'), (8, 'ep bass kick snare hat'), (8, 'ep bass kick snare hat mel'),
               (8, 'ep bass pad kick hat'), (8, 'ep bass kick snare hat mel'), (8, 'ep bass kick snare hat'),
               (8, 'ep bass kick snare hat mel'), (4, 'ep bass kick snare hat'), (2, 'ep pad')]),
    dict(id='kaeri', title='勝ったあとの帰り道', mood='ごきげん・あたたかい', seed=53, bpm=78, swing=0.62, lp=8200, rev=0.38, crackle=0.8,
         prog=[[('Db', 'maj9', 0)], [('C', '7b9', 0)], [('F', 'm9', 0)], [('Eb', 'm9', 0), ('Ab', '13', 2)],
               [('Db', 'maj9', 0)], [('C', '7b9', 0)], [('F', 'm9', 0)], [('Bb', 'm9', 0), ('Eb', '7sus', 2)]],
         comp=[[(0, 4, .78), (6, 4, .6), (10, 6, .62)], [(0, 7, .75), (7, 9, .6)]],
         bassp=[(0, 5, 'R'), (6, 2, '8'), (8, 3, 'R'), (11, 3, '5'), (14, 2, 'A')],
         kick=['X.....x...X.....', 'X.....x..X..x...'], snare=['....X.......X...', '....X.......X.g.'],
         hat=['X.xgX.x.X.xgX.x.', 'X.xgX.x.X.xgX.xx'], snare_kind='snare', lead='bell', lead_oct=0,
         form=[(2, 'ep bass'), (8, 'ep bass kick snare hat'), (8, 'ep bass kick snare hat mel'),
               (8, 'ep bass pad hat mel'), (8, 'ep bass kick snare hat'), (8, 'ep bass kick snare hat mel'),
               (4, 'ep bass kick snare hat'), (2, 'ep pad')]),
    dict(id='shinkokyu', title='連敗のあとの深呼吸', mood='リセット・ゆったり', seed=71, bpm=70, swing=0.55, lp=5800, rev=0.6, crackle=0.6,
         prog=[[('A', 'm9', 0)], [('F', 'maj9', 0)], [('C', 'maj9', 0)], [('G', '69', 0)],
               [('A', 'm9', 0)], [('F', 'maj9', 0)], [('D', 'm9', 0)], [('E', '7sus', 0), ('E', '7b9', 2)]],
         comp=[[(0, 16, .62)], [(0, 10, .6), (10, 6, .45)]],
         bassp=[(0, 12, 'R'), (12, 4, '5')],
         kick=['X.........x.....', 'X.........x.....'], snare=['................', '............g...'],
         hat=['..s...s...s...s.', '..s...s...s.s.s.'], snare_kind='rim', lead='flute', lead_oct=-12,
         form=[(4, 'pad ep'), (8, 'pad ep bass mel'), (8, 'pad ep bass kick hat'), (8, 'pad ep bass kick hat mel'),
               (8, 'pad ep bass'), (4, 'pad ep')]),
]


# ===== 輪っかのバッファ =====
class Ring:
    def __init__(self, n):
        self.n = n

    def add(self, buf, start, sig):
        """buf（(L,) か (2,L)）の start から sig を足す。はみ出た分は頭に回す"""
        L = self.n
        s = int(start) % L
        while sig.shape[-1] > 0:
            m = min(sig.shape[-1], L - s)
            buf[..., s:s + m] += sig[..., :m]
            sig = sig[..., m:]
            s = 0


def pan(sig, p):
    """p: -1(左)〜+1(右)。等パワー"""
    a = (p + 1) * np.pi / 4
    return np.stack([sig * np.cos(a), sig * np.sin(a)]).astype(np.float32)


def fmask(n, sr, hp=None, lp=None, order=2):
    f = np.fft.rfftfreq(n, 1 / sr)
    g = np.ones_like(f)
    if lp: g /= np.sqrt(1 + (f / lp) ** (2 * order))
    if hp: g *= 1 / np.sqrt(1 + (hp / np.maximum(f, 1e-3)) ** (2 * order))
    return g


def ffilt(x, hp=None, lp=None, order=2):
    n = x.shape[-1]
    return np.fft.irfft(np.fft.rfft(x, axis=-1) * fmask(n, SR, hp, lp, order), n=n, axis=-1).astype(np.float32)


def tt(sec):
    return np.arange(int(sec * SR)) / SR


def release(a, t, dur, r):
    off = t > dur
    a[off] *= np.exp(-(t[off] - dur) / r)
    return a


# ===== 楽器 =====
def ep(f, vel, dur):
    """エレピっぽい音：FM（比 1:1）で、弾いた瞬間だけ明るく"""
    t = tt(dur + 0.6)
    idx = vel * (1.8 * np.exp(-t / 0.2) + 0.45)
    ph = 2 * np.pi * f * t
    y = np.sin(ph + idx * np.sin(ph)) + 0.35 * np.sin(2 * ph * 1.0007)
    if f * 14 < SR / 2 - 2000:
        y += 0.08 * vel * np.sin(ph * 14) * np.exp(-t / 0.025)
    tau = float(np.clip(2.4 * np.sqrt(220 / f), 0.7, 3.2))
    a = np.minimum(t / 0.004, 1) * np.exp(-t / tau)
    a = release(a, t, dur, 0.12)
    return (y * a * vel ** 1.3 * 0.22).astype(np.float32)


def bass(f, vel, dur):
    t = tt(dur + 0.2)
    ph = 2 * np.pi * f * t
    y = np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.07 * np.sin(3 * ph)
    y = np.tanh(1.6 * y) / np.tanh(1.6)
    a = np.minimum(t / 0.01, 1) * np.exp(-t / 1.6)
    a = release(a, t, dur, 0.05)
    return (y * a * vel * 0.26).astype(np.float32)


def pad(f, vel, dur):
    t = tt(dur + 2.2)
    out = []
    for cents in ((-7, 3), (5, -4)):
        y = 0
        for c in cents:
            ff = f * 2 ** (c / 1200)
            for h, g in ((1, 1), (2, .3), (3, .1), (4, .04)):
                y = y + g * np.sin(2 * np.pi * ff * h * t + h * c)
        out.append(y)
    y = np.stack(out)
    a = np.minimum(t / 1.4, 1) ** 2
    a = release(a, t, dur, 0.9)
    return (y * a * vel * 0.045).astype(np.float32)


def bell(f, vel, dur):
    t = tt(max(dur, 0.4) + 1.6)
    ph = 2 * np.pi * f * t
    y = np.sin(ph + 1.2 * np.exp(-t / 0.3) * np.sin(2 * ph)) + 0.15 * np.sin(4.02 * ph) * np.exp(-t / 0.4)
    a = np.minimum(t / 0.003, 1) * np.exp(-t / 1.1)
    return (y * a * vel * 0.2).astype(np.float32)


def kalimba(f, vel, dur):
    t = tt(1.6)
    ph = 2 * np.pi * f * t
    y = np.sin(ph) + 0.35 * np.sin(5.4 * ph) * np.exp(-t / 0.05) + 0.1 * np.sin(2 * ph) * np.exp(-t / 0.3)
    a = np.minimum(t / 0.002, 1) * np.exp(-t / 0.55)
    return (y * a * vel * 0.24).astype(np.float32)


def flute(f, vel, dur, rng):
    t = tt(dur + 0.3)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(np.maximum(t - 0.25, 0) / 0.3, 1)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    y = np.sin(ph) + 0.18 * np.sin(2 * ph) + 0.05 * np.sin(3 * ph)
    br = ffilt(rng.standard_normal(len(t)).astype(np.float32), hp=f * 1.5, lp=f * 4) * 0.12 * np.exp(-t / 0.12)
    a = np.minimum(t / 0.06, 1) * (0.75 + 0.25 * np.exp(-t / 0.4))
    a = release(a, t, dur, 0.1)
    return ((y + br) * a * vel * 0.17).astype(np.float32)


def kick(vel):
    t = tt(0.5)
    f = 46 + 80 * np.exp(-t / 0.032)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    y = np.tanh(1.8 * y)
    return (y * vel * 0.45).astype(np.float32)


def snare(vel, rng, kind):
    if kind == 'rim':
        t = tt(0.12)
        n = ffilt(rng.standard_normal(len(t)).astype(np.float32), hp=1500, lp=5000) * np.exp(-t / 0.018)
        y = 0.6 * np.sin(2 * np.pi * 1650 * t) * np.exp(-t / 0.01) + n * 0.8 + 0.4 * np.sin(2 * np.pi * 420 * t) * np.exp(-t / 0.02)
        return (y * vel * 0.22).astype(np.float32)
    t = tt(0.35)
    n = ffilt(rng.standard_normal(len(t)).astype(np.float32), hp=1100, lp=6000) * np.exp(-t / 0.085)
    y = n * 0.9 + 0.55 * np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05)
    return (y * vel * 0.3).astype(np.float32)


def hat(vel, rng, kind='x'):
    if kind == 's':  # シェイカー
        t = tt(0.12)
        n = ffilt(rng.standard_normal(len(t)).astype(np.float32), hp=4000, lp=10000)
        return (n * np.minimum(t / 0.012, 1) * np.exp(-t / 0.035) * vel * 0.18).astype(np.float32)
    t = tt(0.08)
    n = ffilt(rng.standard_normal(len(t)).astype(np.float32), hp=7000, order=3)
    return (n * np.exp(-t / 0.018) * vel * 0.26).astype(np.float32)


# ===== 和音の弾き方（なめらかにつなぐ） =====
def voice(pcs, prev, lo=52, hi=76):
    opts = [[m for m in range(lo, hi + 1) if m % 12 == pc] for pc in pcs]
    best, bc = None, 1e9
    for combo in itertools.product(*opts):
        v = sorted(combo)
        if len(set(v)) < len(v) or v[-1] - v[0] > 15: continue
        if v[0] < 57 and v[1] - v[0] < 3: continue
        c = 0.25 * abs(np.mean(v) - 64)
        if prev: c += sum(abs(a - b) for a, b in zip(v, prev))
        if c < bc: best, bc = v, c
    return best


def chord_at(prog, bar, step):
    cur = None
    for root, q, beat in prog[bar % len(prog)]:
        if beat * 4 <= step: cur = (root, q, beat)
    return cur


def chord_end(prog, bar, step):
    ends = [b * 4 for _, _, b in prog[bar % len(prog)] if b * 4 > step]
    return min(ends) if ends else 16


# ===== 1曲つくる =====
def render(T):
    rng = np.random.default_rng(T['seed'])
    nbars = sum(n for n, _ in T['form'])
    bar_s = 60 / T['bpm'] * 4
    step_s = bar_s / 16
    L = int(round(nbars * bar_s * SR))
    Lsec = L / SR
    R = Ring(L)
    dry = np.zeros((2, L), np.float32)    # ドラム・ベース・ぷちぷち
    music = np.zeros((2, L), np.float32)  # エレピ・パッド・メロディ（キックで少しだけ沈む）
    epbus = np.zeros(L, np.float32)
    send = np.zeros((2, L), np.float32)   # リバーブへ
    pump = np.zeros(L, np.float32)
    flags = []
    for n, f in T['form']: flags += [set(f.split())] * n
    sw = (T['swing'] - 0.5) * 2 * step_s

    def at(bar, step, jitter=0.006):
        return (bar * bar_s + step * step_s + (sw if step % 2 else 0) + rng.normal(0, jitter)) * SR

    hv = lambda v: v * float(np.clip(1 + rng.normal(0, 0.08), 0.75, 1.2))
    lvl = {'X': 1.0, 'x': 0.75, 'g': 0.38, 's': 0.8}
    kicks = [kick(1.0) for _ in range(2)]
    prev = None
    voicings = {}
    # --- 和音（エレピ・パッド） ---
    for bar in range(nbars):
        fl = flags[bar]
        for root, q, beat in T['prog'][bar % len(T['prog'])]:
            pcs = [(NOTE[root] + i) % 12 for i in QUAL[q]]
            prev = voice(pcs, prev)
            voicings[(bar, beat)] = (root, q, prev)
        comp = T['comp'][bar % 2]
        if 'ep' in fl:
            for st, ln, v in comp:
                ch = chord_at(T['prog'], bar, st)
                root, q, notes = voicings[(bar, ch[2])]
                end = chord_end(T['prog'], bar, st)
                dur = min(ln, end - st) * step_s * 0.95
                t0 = at(bar, st, 0.008)
                for i, m in enumerate(notes):
                    R.add(epbus, t0 + i * rng.uniform(0.006, 0.016) * SR, ep(mtof(m), hv(v) * (0.85 if i == 0 else 1), dur))
        if 'pad' in fl:
            for root, q, beat in T['prog'][bar % len(T['prog'])]:
                end = chord_end(T['prog'], bar, beat * 4)
                notes = voicings[(bar, beat)][2]
                for i, m in enumerate(notes):
                    R.add(music, at(bar, beat * 4, 0), pad(mtof(m + 12 if i > 1 else m), 1.0, (end - beat * 4) * step_s))
    # --- ベース ---
    for bar in range(nbars):
        if 'bass' not in flags[bar]: continue
        for st, ln, kind in T['bassp']:
            ch = chord_at(T['prog'], bar, st)
            r = NOTE[ch[0]] + 36
            if r < 38: r += 12
            if kind == 'A':
                if rng.random() < 0.45: continue
                nxt = chord_at(T['prog'], bar + 1, 0) if st >= 12 else chord_at(T['prog'], bar, st + 2)
                nr = NOTE[nxt[0]] + 36
                if nr < 38: nr += 12
                m = nr + (1 if rng.random() < 0.5 else -1)
            else:
                m = r + {'R': 0, '5': 7, '8': 12}[kind]
            end = chord_end(T['prog'], bar, st)
            dur = min(ln, end - st) * step_s * 0.9
            R.add(dry, at(bar, st, 0.005), pan(bass(mtof(m), hv(0.9), dur), 0))
    # --- ドラム ---
    snares = [snare(1.0, rng, T['snare_kind']) for _ in range(4)]
    hats = [hat(1.0, rng) for _ in range(6)]
    shakers = [hat(1.0, rng, 's') for _ in range(4)]
    for bar in range(nbars):
        fl = flags[bar]
        var = 1 if bar % 4 == 3 else 0
        nxt_fl = flags[(bar + 1) % nbars]
        fill = 'snare' in fl and 'snare' not in nxt_fl
        if 'kick' in fl:
            for st, c in enumerate(T['kick'][var]):
                if c == '.': continue
                t0 = at(bar, st, 0.004)
                R.add(dry, t0, pan(kicks[st % 2] * hv(lvl[c]), 0))
                env = np.exp(-tt(0.35) / 0.12).astype(np.float32) * lvl[c]
                R.add(pump, t0, env)
        if 'snare' in fl:
            pat = T['snare'][var]
            if fill: pat = pat[:12] + 'X.gx'
            for st, c in enumerate(pat):
                if c == '.': continue
                s = snares[rng.integers(4)] * hv(lvl[c])
                t0 = at(bar, st, 0.007)
                R.add(dry, t0, pan(s, 0.08))
                R.add(send, t0, pan(s * 0.35, 0))
        if 'hat' in fl:
            for st, c in enumerate(T['hat'][var]):
                if c == '.': continue
                src = shakers if c == 's' else hats
                R.add(dry, at(bar, st, 0.005), pan(src[rng.integers(len(src))] * hv(lvl[c]), 0.3 if c != 's' else -0.25))
    # --- メロディ（2小節のモチーフを A A' B A'' で） ---
    def motif(r):
        steps, out, s = [], [], 0
        while s < 32:
            if r.random() < (0.55 if s % 4 == 0 else 0.3 if s % 2 == 0 else 0.12):
                steps.append(s)
            s += 1
        steps = steps[:6] if len(steps) > 6 else steps
        if len(steps) < 3: steps = [0, 6, 10, 16]
        cont = np.cumsum(r.integers(-2, 3, len(steps))).tolist()
        for i, st in enumerate(steps):
            nx = steps[i + 1] if i + 1 < len(steps) else 32
            out.append((st, max(2, min(nx - st, 8)), cont[i]))
        return out
    mr = np.random.default_rng(T['seed'] + 1000)
    mA, mB = motif(mr), motif(mr)
    mA2 = mA[:-1] + [(mA[-1][0], mA[-1][1], mA[-1][2] - 2)]
    mA3 = mA[:-1] + [(mA[-1][0], 8, 0)]
    phrases = [mA, mA2, mB, mA3]
    center = 76 + T['lead_oct']
    for bar in range(0, nbars, 2):
        if 'mel' not in flags[bar]: continue
        ph = phrases[(bar // 2) % 4]
        for st, ln, c in ph:
            b2, s2 = bar + st // 16, st % 16
            if b2 >= nbars or 'mel' not in flags[b2]: continue
            ch = chord_at(T['prog'], b2, s2)
            pcs = {(NOTE[ch[0]] + i) % 12 for i in QUAL[ch[1]] + [0]}
            allowed = [m for m in range(center - 10, center + 11) if m % 12 in pcs]
            anchor = min(range(len(allowed)), key=lambda i: abs(allowed[i] - center))
            m = allowed[int(np.clip(anchor + c, 0, len(allowed) - 1))]
            dur = ln * step_s * 0.9
            v = hv(0.62 if s2 % 4 == 0 else 0.5)
            if T['lead'] == 'bell': sig = bell(mtof(m), v, dur)
            elif T['lead'] == 'kalimba': sig = kalimba(mtof(m), v, dur)
            else: sig = flute(mtof(m), v, dur, rng)
            p = pan(sig, 0.15 * rng.uniform(-1, 1))
            t0 = at(b2, s2, 0.01)
            R.add(music, t0, p)
            R.add(send, t0, p * 0.9)
    # --- エレピのトレモロ（左右にゆっくり揺れる） ---
    def lfo_f(f): return max(1, round(f * Lsec)) / Lsec  # ループで位相がそろう周波数
    tL = np.arange(L, dtype=np.float32) / SR
    trem = np.sin(2 * np.pi * lfo_f(T['bpm'] / 60 * 2) * tL).astype(np.float32)
    music[0] += epbus * (1 + 0.22 * trem)
    music[1] += epbus * (1 - 0.22 * trem)
    del epbus
    send += music * 0.45
    # キックで少し沈む（ゆるいサイドチェイン）
    music *= (1 - 0.22 * np.clip(pump, 0, 1))[None, :]
    del pump
    dry += music
    del music
    # --- リバーブ（輪っかのまま畳み込み） ---
    ir_t = np.arange(int(2.8 * SR)) / SR
    for c in range(2):
        ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / 0.45)
        ir[:int(0.018 * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))
        X = np.fft.rfft(send[c]) * np.fft.rfft(ir, n=L) * fmask(L, SR, hp=180, lp=4500)
        dry[c] += np.fft.irfft(X, n=L).astype(np.float32) * T['rev']
        del X
    del send
    # --- レコードのぷちぷち・雨 ---
    nz = np.zeros((2, L), np.float32)
    k = int(7 * Lsec * T['crackle'])
    pos = rng.integers(0, L, k)
    amp = (10 ** rng.uniform(-2.6, -1.1, k) * rng.choice([-1, 1], k)).astype(np.float32)
    for c in range(2):
        sel = rng.random(k) < 0.7
        np.add.at(nz[c], pos[sel], amp[sel])
    nz = ffilt(nz, hp=1200, lp=8000)
    nz += ffilt(rng.standard_normal((2, L)).astype(np.float32) * 0.004 * T['crackle'], hp=3000, lp=9000)
    if T.get('rain'):
        rain = ffilt(rng.standard_normal((2, L)).astype(np.float32), hp=500, lp=5500, order=1)
        swell = 1 + 0.35 * np.sin(2 * np.pi * lfo_f(0.07) * tL) + 0.15 * np.sin(2 * np.pi * lfo_f(0.23) * tL + 1)
        nz += rain * (0.022 * T['rain'] * swell).astype(np.float32)
        del rain, swell
    dry += nz
    del nz
    # --- 仕上げ：低音・高音をけずってあたたかく、テープのゆれ ---
    dry = ffilt(dry, hp=40, lp=T['lp'])
    d = (0.004 + 0.0012 * np.sin(2 * np.pi * lfo_f(0.45) * tL) + 0.00015 * np.sin(2 * np.pi * lfo_f(5.7) * tL)) * SR
    idx = np.arange(L) - d
    i0 = np.floor(idx).astype(np.int64)
    fr = (idx - i0).astype(np.float32)
    i0 %= L
    i1 = (i0 + 1) % L
    for c in range(2):
        dry[c] = dry[c][i0] * (1 - fr) + dry[c][i1] * fr
    del idx, i0, i1, fr, tL, d
    return dry, nbars


def soft_limit(x, ceil=0.84):
    k = ceil * 0.8
    a = np.abs(x)
    over = a > k
    y = x.copy()
    y[over] = np.sign(x[over]) * (k + (ceil - k) * np.tanh((a[over] - k) / (ceil - k)))
    return y


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').T.tobytes()
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm)


def measure(path):
    r = subprocess.run([FFMPEG, '-hide_banner', '-nostats', '-i', str(path), '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    j = r.stderr[r.stderr.rindex('{'):r.stderr.rindex('}') + 1]
    d = json.loads(j)
    return float(d['input_i']), float(d['input_tp'])


def main():
    only = set(sys.argv[1:])
    OUT.mkdir(exist_ok=True)
    idx_path = OUT / 'index.json'
    index = json.loads(idx_path.read_text(encoding='utf-8')) if idx_path.exists() else {}
    tmp = Path(os.environ.get('BGM_TMP') or tempfile.gettempdir())
    for T in TRACKS:
        if only and T['id'] not in only: continue
        print(f"♪ {T['id']} {T['title']} …", flush=True)
        x, nbars = render(T)
        x *= 0.5 / max(1e-9, float(np.max(np.abs(x))))
        wav = tmp / f"bgm_{T['id']}.wav"
        write_wav(wav, x)
        I, _ = measure(wav)
        x *= 10 ** ((TARGET_LUFS - I) / 20)
        x = soft_limit(x)
        write_wav(wav, x)
        I, tp = measure(wav)
        mp3 = OUT / f"{T['id']}.mp3"
        subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav), '-c:a', 'libmp3lame', '-b:a', '96k',
                        '-id3v2_version', '3', '-metadata', f"title={T['title']}", '-metadata', f'artist={CREDIT}',
                        '-metadata', 'album=幸とソロQ BGM', str(mp3)], check=True)
        sec = round(x.shape[1] / SR, 2)
        index[T['id']] = {'title': T['title'], 'mood': T['mood'], 'bpm': T['bpm'], 'bars': nbars, 'sec': sec,
                          'lufs': round(I, 1), 'tp': round(tp, 1), 'kb': round(mp3.stat().st_size / 1024)}
        print(f"  {sec:.1f}秒  {I:.1f} LUFS  TP {tp:.1f} dB  {mp3.stat().st_size / 1024:.0f} KB", flush=True)
        os.replace(wav, tmp / f"bgm_{T['id']}_last.wav")
        del x
    order = [T['id'] for T in TRACKS]
    index = {k: index[k] for k in order if k in index}
    idx_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
