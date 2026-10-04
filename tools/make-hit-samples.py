# 爆头声：用真实的撞击录音（Kenney「Impact Sounds」，CC0）拼出来，再照着 CS:GO 那三声的指标调。
#
#   python tools/make-hit-samples.py <放录音的文件夹>
#
# 文件夹里放用到的那些录音，48kHz 单声道：<名字>.wav（16 位）或 <名字>.f32（原始 float32）。
# 原包里是 ogg，要先解码（浏览器的 decodeAudioData、ffmpeg 之类的都行）。
# 生成 public/sfx/hits.wav 和 public/js/client/hitsamples.js。
#
# 每一声 = 几层录音按时间叠起来（各自变一点调），然后：
#   1. 音色：各频段的能量占比往目标上靠（最多补 / 压 10 dB）；
#   2. 起伏：每 10 毫秒的响度往目标的轮廓上靠（最多补 16 dB、压 18 dB）；
# 目标（TARGET 里的数）是从游戏录屏里量出来的指标 —— 各频段能量占多少、响度怎么起伏，不是录屏里的声音本身。
import sys, os, wave
import numpy as np

SR = 48000        # 录音的采样率
RATE = 32000      # 输出的采样率
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_WAV = os.path.join(HERE, '..', 'public', 'sfx', 'hits.wav')
OUT_JS = os.path.join(HERE, '..', 'public', 'js', 'client', 'hitsamples.js')
EDGES = np.array([80, 125, 200, 315, 500, 800, 1250, 2000, 3150, 5000, 8000, 12500, 18000])

TARGET = {
    # 打中头盔：金属的「叮」，响度差不多平着拖 0.27 秒再收
    'hs_helmet': dict(
        bands=[-30.2, -18.3, -15.4, -7.5, -8.5, -7.9, -9.0, -9.5, -9.8, -10.8, -14.0, -21.8],
        env=[-2, -1, -2, -1, 0, 0, -1, -1, -2, -3, -2, -2, -2, -2, -3, -1, -1, -3, -2, -2, -6, -4, -3, -3, -4, -4, -4, -7, -11, -12, -11, -15, -16, -15, -19, -23, -17, -29, -29, -35]),
    # 没戴头盔（两种）：先一下脆的，停一下，再一团，后面还拖着
    'hs_nohelm': dict(
        bands=[-28.1, -20.7, -20.6, -17.9, -12.4, -8.2, -7.7, -6.2, -7.9, -9.7, -11.8, -19.2],
        env=[-2, -1, -1, 0, 0, -1, -2, -7, -14, -12, -7, 0, 0, 0, 0, -1, -1, -2, -2, -2, -2, -5, -6, -4, -5, -5, -8, -10, -11, -9, -6, -10, -14, -15, -14, -10, -11, -9, -9, -9,
             -15, -17, -21, -20, -18, -9, -8, -8, -7, -5, -6, -4, -16, -19, -23, -27, -27, -31, -32]),
    'hs_nohelm2': dict(
        bands=[-26.5, -23.6, -22.8, -17.4, -15.7, -9.9, -6.2, -6.5, -7.2, -9.5, -11.9, -20.3],
        env=[-4, -1, -1, -1, 0, 0, -2, -2, -2, -2, -3, -5, -8, -5, -2, -1, -1, -1, -3, -10, -11, -9, -8, -11, -10, -9, -10, -11, -11, -9, -9, -9, -15, -13, -14, -17, -16, -15, -14, -16,
             -17, -15, -20, -20, -18, -16, -14, -18, -13, -21, -23, -23, -17, -14, -21, -23, -23, -18, -21, -25, -27, -27, -27, -28, -33]),
}

# 每一声用哪些录音：(名字, 什么时候开始（秒）, 变调（> 1 变高变短）, 音量)
RECIPE = {
    'hs_helmet': [
        ('impactTin_medium_004', 0, 1.153, 1.0),     # 主音，调到 777Hz 上下
        ('impactBell_heavy_000', 0, 0.9, 0.8),       # 低一点的一簇（340~600Hz）
        ('impactBell_heavy_001', 0, 1.4, 0.6),       # 拖得长的余音
        ('impactBell_heavy_003', 0.004, 1.1, 0.5),
        # 一堆不成倍数的金属泛音（几种金属敲击各变一点调叠起来，才有「哐」的那种杂）
        ('impactMetal_light_003', 0, 0.833, 0.8), ('impactMetal_light_000', 0, 1.0, 0.6), ('impactMetal_light_002', 0.002, 1.25, 0.6), ('impactMetal_light_001', 0.001, 0.7, 0.5),
        ('impactMetal_light_004', 0.003, 1.6, 0.5),
        ('impactMetal_heavy_001', 0, 1.0, 0.7), ('impactMetal_heavy_003', 0.001, 1.3, 0.6), ('impactMetal_medium_000', 0, 1.0, 0.6), ('impactMetal_medium_003', 0, 0.95, 0.6),
        ('impactGlass_medium_001', 0.002, 0.8, 0.5), ('impactGlass_medium_003', 0.004, 1.3, 0.4),
        # 敲上去那一下的脆响
        ('impactPlate_light_003', 0, 1.0, 0.9), ('impactPlate_light_000', 0.01, 1.2, 0.6), ('impactMining_000', 0, 1.0, 0.5),
    ],
    'hs_nohelm': [
        ('impactPlate_light_003', 0, 1.0, 1.0), ('impactMining_001', 0, 0.7, 0.8), ('impactPunch_heavy_002', 0, 1.2, 0.9), ('impactWood_light_000', 0.004, 1.3, 0.6),
        ('impactGlass_light_002', 0.105, 0.6, 1.0), ('impactPlate_light_000', 0.108, 0.85, 0.8), ('impactSoft_heavy_000', 0.105, 1.5, 0.8), ('impactMining_002', 0.112, 0.6, 0.6),
        ('impactGlass_medium_001', 0.22, 0.6, 0.6), ('impactPlate_medium_001', 0.235, 0.8, 0.5),
        ('impactGlass_light_004', 0.33, 0.5, 0.5), ('impactMining_004', 0.345, 0.55, 0.5),
        ('impactPunch_medium_003', 0.45, 1.3, 0.8), ('impactPlate_light_004', 0.452, 0.8, 0.7), ('impactGlass_light_000', 0.455, 0.55, 0.5),
    ],
    'hs_nohelm2': [
        ('impactPlate_light_002', 0, 0.9, 1.0), ('impactMining_003', 0, 0.6, 0.8), ('impactPunch_medium_002', 0, 1.2, 0.9), ('impactGeneric_light_000', 0.003, 1.4, 0.6),
        ('impactGlass_light_001', 0.05, 0.55, 0.8),
        ('impactPlate_light_001', 0.135, 0.9, 0.9), ('impactGlass_light_003', 0.138, 0.6, 0.9), ('impactSoft_heavy_002', 0.135, 1.5, 0.8),
        ('impactGlass_medium_003', 0.2, 0.6, 0.7), ('impactMining_000', 0.21, 0.6, 0.5),
        ('impactGlass_light_000', 0.32, 0.5, 0.5), ('impactPlate_medium_004', 0.33, 0.6, 0.5),
        ('impactGlass_medium_004', 0.45, 0.6, 0.4), ('impactWood_light_002', 0.46, 0.8, 0.3),
    ],
}

def load(d, name):
    p = os.path.join(d, name + '.wav')
    if os.path.exists(p):
        with wave.open(p) as w:
            assert w.getframerate() == SR and w.getsampwidth() == 2, p
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
            return x.reshape(-1, w.getnchannels()).mean(1)
    x = np.fromfile(os.path.join(d, name + '.f32'), dtype=np.float32).astype(np.float64)
    # 去掉开头的静音
    a = np.abs(x); k = int(np.argmax(a > a.max() * 0.03))
    return x[max(0, k - 48):]

def resample(x, r):
    n = int(len(x) / r)
    return np.interp(np.arange(n) * r, np.arange(len(x)), x)

def bands(x):
    n = 1 << int(np.ceil(np.log2(len(x))))
    S = np.abs(np.fft.rfft(x * np.hanning(len(x)), n)) ** 2
    f = np.fft.rfftfreq(n, 1 / SR)
    b = np.array([S[(f >= EDGES[i]) & (f < EDGES[i + 1])].sum() for i in range(len(EDGES) - 1)])
    return 10 * np.log10(b / b.sum() + 1e-12)

# 音色往目标上靠：每个频段补 / 压多少（最多 lim dB），频段之间平滑过渡
def match(x, target, lim=10.0, amount=0.85):
    cur = bands(x[:int(0.3 * SR)])
    g = np.clip((np.array(target) - cur) * amount, -lim, lim)
    g -= g.mean()
    cen = np.sqrt(EDGES[:-1] * EDGES[1:])
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    gd = np.interp(np.log(np.maximum(f, 20)), np.log(cen), g)
    return np.fft.irfft(X * 10 ** (gd / 20), len(x)), g

def contour(x, hop=0.01):
    h = int(SR * hop); n = len(x) // h
    e = np.sqrt((x[:n * h].reshape(n, h) ** 2).mean(1) + 1e-14)
    return 20 * np.log10(e / e.max())

# 起伏往目标上靠：每 10 毫秒算一个增益，帧与帧之间平滑过渡
def follow(x, env, lo=-18.0, hi=16.0, amount=0.9):
    h = int(SR * 0.01)
    env = np.array(env, dtype=float)
    n = min(len(env), len(x) // h)
    c = contour(x)[:n]
    c -= c.max()
    g = np.clip((env[:n] - c) * amount, lo, hi)
    t = (np.arange(n) + 0.5) * h
    gs = np.interp(np.arange(len(x)), t, g, left=g[0], right=g[-1])
    k = np.hanning(int(SR * 0.006)); k /= k.sum()
    gs = np.convolve(gs, k, mode='same')
    return x * 10 ** (gs / 20)

def build(d, key):
    T = TARGET[key]
    n = int((len(T['env']) * 0.01 + 0.03) * SR)
    x = np.zeros(n)
    for name, t0, r, g in RECIPE[key]:
        y = resample(load(d, name), r) * g
        i = int(t0 * SR); m = min(len(y), n - i)
        if m > 0: x[i:i + m] += y[:m]
    x, eq = match(x, T['bands'])
    x = follow(x, T['env'])
    x, _ = match(x, T['bands'], amount=0.6)       # 调完起伏音色会偏一点，再拉回来一次
    x = follow(x, T['env'], amount=0.7)
    x, _ = match(x, T['bands'], amount=0.5)
    # 收尾：最后 30 毫秒淡出；开头 1 毫秒淡入
    fo = int(0.03 * SR); x[-fo:] *= np.linspace(1, 0, fo) ** 2
    fi = int(0.001 * SR); x[:fi] *= np.linspace(0, 1, fi)
    x *= 0.9 / np.abs(x).max()
    got_b = bands(x[:int(0.3 * SR)]); got_e = contour(x)[:len(T['env'])]
    eb = float(np.sqrt(((got_b - np.array(T['bands'])) ** 2)[2:11].mean()))
    ee = float(np.sqrt(((got_e - np.array(T['env'])[:len(got_e)]) ** 2).mean()))
    print('%-11s 长 %.2f 秒  音色差 %.1f dB  起伏差 %.1f dB' % (key, len(x) / SR, eb, ee))
    print('   起伏：', ' '.join(str(int(round(v))) for v in got_e))
    return x

def main():
    d = sys.argv[1] if len(sys.argv) > 1 else '.'
    gap = int(0.008 * RATE)
    pcm, clips, pos = [], {}, 0
    for key in RECIPE:
        x = build(d, key)
        y = np.interp(np.arange(int(len(x) * RATE / SR)) * (SR / RATE), np.arange(len(x)), x)
        clips[key] = (pos, len(y))
        pcm.append(y); pcm.append(np.zeros(gap))
        pos += len(y) + gap
    data = (np.clip(np.concatenate(pcm), -1, 1) * 32767).astype('<i2')
    with wave.open(OUT_WAV, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(data.tobytes())
    with open(OUT_JS, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// 自动生成的（tools/make-hit-samples.py），不要手改。\n')
        f.write('// 爆头声：用 Kenney「Impact Sounds」（CC0 公有领域）里的真实撞击录音拼出来的。\n')
        f.write('// at：每一声在 sfx/hits.wav 里的 [起点, 长度]（采样点，按 rate 算）；g：音量补偿\n')
        f.write('export const HIT_SAMPLES = {\n  file: \'sfx/hits.wav\',\n  rate: %d,\n  clips: {\n' % RATE)
        for key, (a, n) in clips.items():
            f.write('    %s: { g: 1, at: [[%d, %d]] },\n' % (key, a, n))
        f.write('  },\n};\n')
    print('写好了', os.path.getsize(OUT_WAV), '字节')

if __name__ == '__main__':
    main()
