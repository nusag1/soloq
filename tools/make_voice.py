"""幸とソロQ：voice/lines.json から音声（MP3）を作る。PC3 で使う。

  python -X utf8 tools/make_voice.py            # 変わったものだけ作る
  python -X utf8 tools/make_voice.py --all      # 全部作り直す

- 声は VOICEVOX ENGINE（~/tools/windows-cpu/run.exe）。動いていなければこの中で起こして、終わったら止める
- MP3 は ffmpeg（~/tools/ffmpeg-*/bin/ffmpeg.exe）。モノラル 24kHz 32kbps（小さくするため）
- 出力は audio/<id>.mp3 と audio/index.json（秒数と、台本のハッシュ）
"""
import json, sys, io, math, struct, wave, time, subprocess, urllib.request, urllib.parse, glob, os, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINES = json.loads((ROOT / 'voice' / 'lines.json').read_text(encoding='utf-8'))
VOICES = json.loads((ROOT / 'voice' / 'voices.json').read_text(encoding='utf-8'))
OUT = ROOT / 'audio'
HOME = Path.home()
ENGINE_DIR = Path(os.environ.get('VOICEVOX_DIR', HOME / 'tools' / 'windows-cpu'))
FFMPEG = next(iter(sorted(glob.glob(str(HOME / 'tools' / 'ffmpeg-*' / 'bin' / 'ffmpeg.exe')))), 'ffmpeg')
API = 'http://127.0.0.1:50021'
RATE = 24000


def http(path, data=None, method='GET', timeout=120):
    req = urllib.request.Request(API + path, data=data, method=method, headers={'Content-Type': 'application/json'} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def engine_up():
    try: http('/version', timeout=3); return True
    except Exception: return False


def start_engine():
    if engine_up(): return None
    exe = ENGINE_DIR / 'run.exe'
    if not exe.exists(): sys.exit(f'VOICEVOX ENGINE が見つかりません：{exe}')
    p = subprocess.Popen([str(exe), '--host', '127.0.0.1', '--port', '50021'], cwd=str(ENGINE_DIR),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    for _ in range(180):
        if engine_up(): return p
        time.sleep(1)
    p.terminate(); sys.exit('VOICEVOX ENGINE が起動しませんでした')


def say(text, speaker, speed):
    q = json.loads(http('/audio_query?' + urllib.parse.urlencode({'text': text, 'speaker': speaker}), data=b'', method='POST'))
    q.update(speedScale=speed, outputSamplingRate=RATE, outputStereo=False, prePhonemeLength=0.05, postPhonemeLength=0.05)
    wav = http('/synthesis?' + urllib.parse.urlencode({'speaker': speaker}), data=json.dumps(q).encode(), method='POST', timeout=600)
    with wave.open(io.BytesIO(wav)) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, '想定外の WAV'
        return w.readframes(w.getnframes())


def silence(sec):
    return b'\0\0' * int(RATE * sec)


def chime():
    """ラジオのはじめの短い音（その場で作る）"""
    notes = [784, 988, 1175]
    total = int(RATE * 1.0)
    buf = [0.0] * total
    for i, f in enumerate(notes):
        start = int(RATE * 0.12 * i)
        for n in range(int(RATE * 0.7)):
            t = n / RATE
            if start + n < total:
                buf[start + n] += math.sin(2 * math.pi * f * t) * math.exp(-5 * t) * 0.2
    return b''.join(struct.pack('<h', int(max(-1, min(1, v)) * 32000)) for v in buf)


def make(item, radio):
    pcm = bytearray(chime() + silence(0.25) if radio else silence(0.05))
    for ln in item['lines']:
        v = VOICES[ln['s']]
        pcm += say(ln['t'], v['speaker'], v.get('speed', 1.08))
        pcm += silence(float(ln.get('gap', 0.35 if radio else 0.2)))
    wav_p = OUT / f"{item['id']}.wav"
    with wave.open(str(wav_p), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(bytes(pcm))
    mp3_p = OUT / f"{item['id']}.mp3"
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', str(wav_p), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
                    '-ar', '24000', '-ac', '1', '-b:a', '32k', '-map_metadata', '-1', str(mp3_p)], check=True)
    wav_p.unlink()  # この中で作った中間ファイル
    return round(len(pcm) / 2 / RATE, 1)


def main():
    OUT.mkdir(exist_ok=True)
    idx_p = OUT / 'index.json'
    idx = json.loads(idx_p.read_text(encoding='utf-8')) if idx_p.exists() else {}
    items = [(r, True) for r in LINES['radio']] + [(c, False) for cs in LINES['reactions'].values() for c in cs]
    todo = []
    for it, radio in items:
        h = hashlib.sha1(json.dumps(it['lines'], ensure_ascii=False).encode()).hexdigest()[:10]
        if '--all' in sys.argv or idx.get(it['id'], {}).get('h') != h or not (OUT / f"{it['id']}.mp3").exists():
            todo.append((it, radio, h))
    if not todo: print('変わったものはありません'); return
    p = start_engine()
    try:
        for i, (it, radio, h) in enumerate(todo):
            sec = make(it, radio)
            idx[it['id']] = {'sec': sec, 'h': h}
            print(f"{i + 1}/{len(todo)} {it['id']} {sec}s", flush=True)
            idx_p.write_text(json.dumps(idx, ensure_ascii=False, indent=0, sort_keys=True) + '\n', encoding='utf-8')
    finally:
        if p: p.terminate()
    total = sum(f.stat().st_size for f in OUT.glob('*.mp3'))
    print(f'合計 {total // 1024} KB')


if __name__ == '__main__':
    main()
