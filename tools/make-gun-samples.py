# 把真实枪声录音裁剪成游戏用的小文件。
#
# 录音来自「The Free Firearm Sound Library」（Still North Media 录制，CC0 公有领域，可以随便用）：
#   https://opengameart.org/content/the-free-firearm-sound-library  （下载 Prepared SFX Library.7z，194 MB，解压）
#
# 用法（要装 Python 和 numpy）：
#   python tools/make-gun-samples.py "解压出来的 Prepared SFX Library 目录"
# 输出：
#   public/sfx/guns.wav               所有枪声接在一起（单声道 32kHz 16bit，不到 1 MB）
#   public/js/client/gunsamples.js    每一声在文件里的位置和音量（audio.js 按它切开来用）
#
# 原始录音是 96kHz / 24bit / 立体声，每个文件里隔几秒打一枪。这里做的事：
#   找到每一声的起点 → 只取一个声道 → 需要的话变一点调 → 降到 32kHz → 去掉低频杂音 → 尾巴淡出
#   → 垫一层低频的「身体」（见 thump）→ 轻微压一下让声音更「实」，并把响度对齐到原来合成枪声的水平
#
# 为什么要垫低频：真实录音是在空旷的靶场录的，能量几乎全在开头那 15 毫秒的脆响里，之后 0.1 秒的低频很弱，
# 单独听很真，放在游戏里却显得单薄、没分量。所以在录音下面垫两层：「低频冲击」（200Hz 以下，耳机里胸口那一下）
# 和「闷响」（200~900Hz，手机喇叭也放得出来的厚度）。各垫多少，按「枪响后 15~120 毫秒这两段各有多响」来定（body 那一栏）。
import os
import struct
import sys

import numpy as np

RATE = 32000
SRC_RATE = 96000
PEAK = 0.85  # 峰值留一点余量：浏览器把 32kHz 换算成 48kHz 时波形会冒出去一点
# 游戏里的音色名: (录音文件, 用里面的第几声, 长度（秒）, 变调（小于 1 更低沉）, 前 0.2 秒的目标响度, 最多压到多大力度,
#                 body [低频身体要多响, 中低频身体要多响], 低频冲击 [起始 Hz, 落到 Hz, 下落快慢, 衰减], 闷响 [中心 Hz, 衰减])
CLIPS = {
    'ak47': ('AK-47/C_28P', [1, 2], 0.72, 1.0, 0.27, 3.0, [0.18, 0.205], [135, 46, 0.032, 0.085], [230, 0.06]),
    'm4a4': ('AR-15/D_32P', [0, 1], 0.62, 1.0, 0.18, 3.0, [0.093, 0.104], [160, 58, 0.025, 0.062], [280, 0.045]),
    'rifle': ('SKS/U_14P', [0, 1], 0.65, 1.0, 0.215, 3.0, [0.12, 0.167], [150, 52, 0.028, 0.07], [260, 0.052]),          # 加利尔、法玛斯
    'pistol': ('Walther PPQ/X_39P', [1, 2], 0.45, 1.0, 0.135, 3.0, [0.031, 0.085], [210, 85, 0.018, 0.045], [320, 0.033]),  # Glock、P250
    'deagle': ('1911/A_42P', [0, 1], 0.8, 0.9, 0.265, 3.0, [0.155, 0.218], [120, 40, 0.04, 0.12], [220, 0.075]),
    'smg': ('PPSh/P_30P', [0, 2], 0.4, 1.0, 0.12, 3.0, [0.026, 0.072], [190, 78, 0.018, 0.04], [320, 0.03]),              # MAC-10、MP9
    'ump45': ('Carl Gustav M45/G_31P', [0, 1], 0.45, 0.94, 0.168, 3.0, [0.084, 0.125], [170, 62, 0.022, 0.05], [280, 0.038]),
    'shotgun': ('Nova/O_21P', [0, 1], 0.95, 1.0, 0.342, 4.0, [0.233, 0.272], [110, 38, 0.05, 0.15], [200, 0.1]),
    'awp': ('Mosin Nagant/M_21P', [0, 1], 1.35, 0.93, 0.293, 4.0, [0.19, 0.227], [100, 35, 0.05, 0.18], [200, 0.09]),
    'ssg08': ('Tikka/W_29P', [0, 1], 1.0, 1.0, 0.232, 3.0, [0.13, 0.186], [130, 45, 0.035, 0.12], [240, 0.068]),
}


def read_wav(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:4] == b'RIFF' and data[8:12] == b'WAVE', path
    pos, fmt, raw = 12, None, None
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack('<I', data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b'fmt ':
            tag, ch, rate, _, _, bits = struct.unpack('<HHIIHH', body[:16])
            fmt = (ch, rate, bits)
        elif cid == b'data':
            raw = body
        pos += 8 + size + (size & 1)
    ch, rate, bits = fmt
    assert bits == 24 and rate == SRC_RATE, (path, fmt)
    b = np.frombuffer(raw[:len(raw) // 3 * 3], dtype=np.uint8).reshape(-1, 3).astype(np.int32)
    v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
    v = np.where(v & 0x800000, v - 0x1000000, v)
    a = v.astype(np.float64) / 8388608
    return a[:len(a) // ch * ch].reshape(-1, ch)


def find_shots(a):
    """每一声枪响大概在哪（采样点）。只要响的那几声，回声和拉栓声不算。"""
    mono = np.abs(a).max(axis=1)
    win = int(SRC_RATE * 0.002)
    env = np.convolve(mono, np.ones(win) / win, mode='same')
    th = env.max() * 0.4
    out, i, n = [], 0, len(env)
    while i < n:
        if env[i] > th:
            out.append(i)
            i += int(SRC_RATE * 0.8)  # 单发录音两声之间隔好几秒
        else:
            i += 1
    return out


def lowpass_fir(cut, taps=121):
    n = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * cut / SRC_RATE * n) * 2 * cut / SRC_RATE
    return h * np.blackman(taps)


def tone(x, rate, fc=45.0, shelf=1.8, fs=170.0):
    """去掉 45Hz 以下的杂音，再把 170Hz 以下抬高一点（真实录音的低频比较薄，抬一点开枪更有分量）。"""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / rate)
    hp = f * f / (f * f + fc * fc)
    low = 1 + (shelf - 1) / (1 + (f / fs) ** 4)
    return np.fft.irfft(X * hp * low, len(x))


def rms200(x):
    return float(np.sqrt(np.mean(x[:int(RATE * 0.2)] ** 2)))


def body(x, lo, hi):
    """枪响之后 15~120 毫秒、lo~hi 这段频率有多响：听起来的「分量」主要就在这里。"""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    X[(f < lo) | (f >= hi)] = 0
    y = np.fft.irfft(X, len(x))
    return float(np.sqrt(np.mean(y[int(RATE * 0.015):int(RATE * 0.12)] ** 2)))


def thump(n, boom, punch, seed):
    """垫在录音下面的两层，返回 (低频冲击, 闷响)：
    低频冲击 = 音高快速下落的正弦（胸口那一下）；闷响 = 只留 100~900Hz 的噪声，很快衰减（厚度）。"""
    t = np.arange(n) / RATE
    env = lambda att, dec: np.where(t < att, t / att, np.exp(-(t - att) / dec))
    f0, f1, ft, dec = boom
    ph = 2 * np.pi * np.cumsum(f1 + (f0 - f1) * np.exp(-t / ft)) / RATE
    low = np.sin(ph) * env(0.0012, dec)
    fc, pdec = punch
    N = np.fft.rfft(np.random.default_rng(seed).uniform(-1, 1, n))
    f = np.fft.rfftfreq(n, 1 / RATE)
    N *= (f / fc) / (1 + (f / fc) ** 2) / (1 + (f / (3 * fc)) ** 4)
    noise = np.fft.irfft(N, n)
    noise = noise / np.sqrt(np.mean(noise[:int(RATE * 0.05)] ** 2)) * env(0.001, pdec)
    pad = np.zeros(int(RATE * 0.0015))  # 和录音的起点对齐（录音前面留了 1.5 毫秒）
    return np.concatenate([pad, low])[:n], np.concatenate([pad, noise])[:n]


def shape(x, target, most):
    """把开头那一下尖峰压一压（软削波，力度最多到 most），让前 0.2 秒的响度尽量接近 target；峰值统一到 PEAK。
    返回 (波形, 实际响度, 用了多大力度)。还差的响度在游戏里用音量补（gunsamples.js 里的 g）。"""
    x = x / np.abs(x).max()
    lo, hi = 0.01, most
    for _ in range(30):
        d = (lo + hi) / 2
        y = np.tanh(x * d) / np.tanh(d) * PEAK
        if rms200(y) < target * PEAK / 0.9:
            lo = d
        else:
            hi = d
    y = np.tanh(x * lo) / np.tanh(lo) * PEAK
    return y, rms200(y) * 0.9 / PEAK, lo


def cut(a, at, length, pitch):
    # 这一声里更响的那个声道（两个话筒隔着一点距离，混在一起会发闷）
    w = a[at:at + int(SRC_RATE * 0.05)]
    x = a[:, int(np.argmax(np.abs(w).max(axis=0)))]
    # 精确起点：第一次超过峰值 8% 的地方，往前留 1.5 毫秒
    seg = np.abs(x[max(0, at - 2000):at + 4000])
    start = max(0, at - 2000) + int(np.argmax(seg > seg.max() * 0.08)) - int(SRC_RATE * 0.0015)
    n_src = int(length * SRC_RATE * pitch) + 2000
    x = x[start:start + n_src].copy()
    if pitch != 1.0:
        pos = np.arange(int(len(x) / pitch) - 2) * pitch
        i = pos.astype(int)
        x = x[i] * (1 - (pos - i)) + x[i + 1] * (pos - i)
    x = np.convolve(x, lowpass_fir(14500.0), mode='same')[::SRC_RATE // RATE]
    x = tone(x, RATE)[:int(length * RATE)]
    n = len(x)
    fi = int(RATE * 0.001)
    x[:fi] *= np.linspace(0, 1, fi)
    t0 = int(n * 0.55)
    x[t0:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n - t0))  # 尾巴淡出
    return x


def main():
    src = sys.argv[1]
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    pack, index, gap = [], {}, np.zeros(256)
    cache = {}
    for key, (rel, picks, length, pitch, target, most, want, boom, punch) in CLIPS.items():
        if rel not in cache:
            cache[rel] = read_wav(os.path.join(src, rel + '.wav'))
        a = cache[rel]
        shots = find_shots(a)
        at, loud = [], []
        for p in picks:
            x = cut(a, shots[p], length, pitch)
            x = x / np.abs(x).max()
            low, mid = thump(len(x), boom, punch, 7 + p)
            # 两层各垫多少：试到「压完之后、按游戏里的音量放出来」的低频 / 中低频身体正好是 want
            def made(ka, kb):
                y, r, d = shape(x + ka * low + kb * mid, target, most)
                k = min(1.6, target / r) * 0.9 / PEAK
                return y, r, d, body(y, 0, 200) * k, body(y, 200, 900) * k
            mix = [0.0, 0.0]
            for _ in range(4):
                for i, j in ((0, 3), (1, 4)):  # 轮流调两层（互相有一点影响，来回几遍就稳了）
                    lo, hi = 0.0, 4.0
                    for _ in range(14):
                        mix[i] = (lo + hi) / 2
                        if made(*mix)[j] < want[i]:
                            lo = mix[i]
                        else:
                            hi = mix[i]
                    mix[i] = lo
            y, r, d, b0, b1 = made(*mix)
            y[-int(RATE * 0.03):] *= np.linspace(1, 0, int(RATE * 0.03))  # 垫的低频拖得比录音长：结尾再收一下，免得「咔」一声
            pos = sum(len(s) for s in pack)
            pack += [y, gap]
            at.append([pos, len(y)])
            loud.append(r)
            print(f'{key:8s} 第 {p + 1}/{len(shots)} 声 {len(y) / RATE:.2f}s  垫 低频 {mix[0]:.2f} 闷响 {mix[1]:.2f}  压 {d:.2f}  响度 {r:.3f}/{target}  身体 {b0:.3f}/{want[0]}  {b1:.3f}/{want[1]}')
        # 压到头还不够响（或者本来就更响）的，用音量补齐
        # 目标响度是按峰值 0.9 定的；这里峰值是 PEAK，一并补回来
        index[key] = {'g': round(float(np.clip(target / np.mean(loud), 0.6, 1.6)) * 0.9 / PEAK, 2), 'at': at}
    data = np.concatenate(pack)
    pcm = np.clip(np.round(data * 32767), -32768, 32767).astype('<i2').tobytes()
    out = os.path.join(root, 'public', 'sfx')
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'guns.wav'), 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, RATE, RATE * 2, 2, 16) + b'data' + struct.pack('<I', len(pcm)) + pcm)
    lines = ['// 自动生成的（tools/make-gun-samples.py），不要手改。',
             '// 真实枪声录音来自 The Free Firearm Sound Library（Still North Media，CC0 公有领域）。',
             '// at：每一声在 sfx/guns.wav 里的 [起点, 长度]（采样点，按 rate 算）；g：音量补偿',
             'export const GUN_SAMPLES = {', "  file: 'sfx/guns.wav',", f'  rate: {RATE},', '  clips: {']
    for key, v in index.items():
        lines.append(f"    {key}: {{ g: {v['g']}, at: {v['at']} }},")
    lines += ['  },', '};', '']
    with open(os.path.join(root, 'public', 'js', 'client', 'gunsamples.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))
    print(f'写好了：guns.wav {len(pcm) + 44} 字节（{len(data) / RATE:.1f} 秒），gunsamples.js')


if __name__ == '__main__':
    main()
