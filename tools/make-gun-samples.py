# 把真实枪声录音做成游戏用的小文件。
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
#   找到每一声的起点 → 只取一个声道 → 需要的话变一点调 → 降到 32kHz → 调音色 → 加尾音 → 压一压、对齐响度
#
# 为什么要调：录音是在空旷的靶场近距离录的，能量集中在开头十几毫秒的脆响和 500Hz 以下，之后马上就没声了，
# 单独听很真，放进游戏里却又闷又短、没有力量感。游戏里的枪声是「设计」出来的：中高频很足（小喇叭上也够响），
# 后面拖着一段回声一样的尾音。所以这里照着 CS 里各把枪的听感来调（LIKE、尾音那几栏；没有单独量过的枪借用相近的）：
# 那些数是从游戏录屏里量出来的指标 —— 各频段的能量占多少、响完之后每秒落多少分贝 —— 不是录屏里的声音本身，
# 声音还是这套 CC0 录音加上程序合成的尾音。
import os
import struct
import sys

import numpy as np

RATE = 32000
SRC_RATE = 96000
PEAK = 0.85  # 峰值留一点余量：浏览器把 32kHz 换算成 48kHz 时波形会冒出去一点
BANDS = np.array([40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000.0])
# 各频段（BANDS 相邻两个数之间）的能量占比，dB。低频比量出来的留得多一些（录屏的低频被削过，戴耳机时还是要有一点分量）
LIKE = {
    'ak': [-27, -22, -18, -13.5, -7.4, -5.8, -8.6, -10.6, -11.6, -11.6, -12.2, -11.5, -17.5],
    'awp': [-25, -20.5, -17, -13.5, -9.2, -8.5, -8.2, -8.2, -8.5, -8.6, -11.7, -14.1, -20.9],
    'm4': [-29, -21.6, -15.9, -11.6, -8.8, -5.5, -6.1, -11, -12.5, -13.1, -14.1, -14.7, -17.8],
    'galil': [-28.3, -23.7, -15.5, -13.2, -8.4, -4.7, -7.9, -11.3, -12.3, -12.3, -13, -13.9, -17.2],
    'glock': [-27, -22.5, -20, -16.9, -8.6, -6.2, -7.3, -8.6, -9.7, -11.8, -12.7, -14.3, -19.5],
    'deagle': [-24, -21, -15.5, -12.5, -9.6, -8.8, -7.6, -8.7, -9.7, -9.9, -10.4, -11.6, -17.8],
    'ssg': [-28, -24, -20, -13.9, -8.8, -7, -8, -8.7, -10.6, -10, -11.6, -12, -16.5],
}
# 游戏里的音色名: (录音文件, 用里面的第几声, 长度（秒）, 变调（小于 1 更低沉）, 前 0.2 秒的目标响度, 最多压到多大力度,
#                 照哪种听感调, 尾音 [起始比开头那一下低多少 dB, 每秒落多少 dB, 先稳住多少秒再落],
#                 低频冲击 [起始 Hz, 落到 Hz, 下落快慢, 衰减], 低频冲击垫多少)
CLIPS = {
    'ak47': ('AK-47/C_28P', [1, 2], 0.72, 1.0, 0.27, 3.0, 'ak', [-8, 36, 0], [135, 46, 0.032, 0.085], 0.12),
    'm4a4': ('AR-15/D_32P', [0, 1], 0.62, 1.0, 0.19, 3.0, 'm4', [-3, 48, 0.06], [160, 58, 0.025, 0.062], 0.09),
    'rifle': ('SKS/U_14P', [0, 1], 0.65, 1.0, 0.215, 3.0, 'galil', [-3, 50, 0.08], [150, 52, 0.028, 0.07], 0.1),          # 加利尔、法玛斯
    'pistol': ('Walther PPQ/X_39P', [1, 2], 0.45, 1.0, 0.135, 3.0, 'glock', [-5, 48, 0.02], [210, 85, 0.018, 0.045], 0.06),  # Glock、P250
    'deagle': ('1911/A_42P', [0, 1], 0.8, 0.9, 0.265, 3.0, 'deagle', [-2, 40, 0.2], [120, 40, 0.04, 0.12], 0.12),
    'smg': ('PPSh/P_30P', [0, 2], 0.4, 1.0, 0.12, 3.0, 'ak', [-11, 65, 0], [190, 78, 0.018, 0.04], 0.05),              # MAC-10、MP9
    'ump45': ('Carl Gustav M45/G_31P', [0, 1], 0.45, 0.94, 0.168, 3.0, 'ak', [-10, 58, 0], [170, 62, 0.022, 0.05], 0.08),
    'shotgun': ('Nova/O_21P', [0, 1], 0.95, 1.0, 0.342, 4.0, 'awp', [-4, 30, 0.05], [110, 38, 0.05, 0.15], 0.14),
    'awp': ('Mosin Nagant/M_21P', [0, 1], 1.35, 0.93, 0.293, 4.0, 'awp', [-3, 24, 0.12], [100, 35, 0.05, 0.18], 0.14),
    'ssg08': ('Tikka/W_29P', [0, 1], 1.0, 1.0, 0.232, 3.0, 'ssg', [-5, 90, 0.13], [130, 45, 0.035, 0.12], 0.11),
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


def highpass(x, fc=45.0):
    """去掉 45Hz 以下的杂音。"""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    return np.fft.irfft(X * f * f / (f * f + fc * fc), len(x))


def rms200(x):
    return float(np.sqrt(np.mean(x[:int(RATE * 0.2)] ** 2)))


def spectrum(x):
    """各频段的能量占比（dB）：85 毫秒一帧、每次挪半帧，从枪响前半帧算到 0.47 秒（开头那一下「啪」也算进去）。"""
    n = 2730
    x = np.concatenate([np.zeros(n // 2), x[:int(RATE * 0.47)], np.zeros(n)])
    win, f = np.hanning(n), np.fft.rfftfreq(n, 1 / RATE)
    p = np.zeros(len(f))
    for i in range(0, len(x) - n, n // 2):
        p += np.abs(np.fft.rfft(x[i:i + n] * win)) ** 2
    b = np.array([p[(f >= BANDS[i]) & (f < BANDS[i + 1])].sum() for i in range(len(BANDS) - 1)])
    return 10 * np.log10(b / b.sum() + 1e-12)


def match(x, want):
    """把音色往 want（各频段能量占比）上调：缺的频段提上去、多的压下来，中间平滑过渡。
    低频最多只压不怎么提（-10 ~ +2 dB），中高频最多提 15 dB。"""
    g = np.array(want) - spectrum(x)
    g -= np.mean(g[4:8])  # 以 250~1600Hz 为准，其余频段相对它调
    fc = np.sqrt(BANDS[:-1] * BANDS[1:])
    g = np.where(fc < 250, np.clip(g, -10, 2), np.clip(g, -8, 15))
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    curve = np.interp(np.log(np.maximum(f, 1)), np.log(fc), g)
    return np.fft.irfft(np.fft.rfft(x) * 10 ** (curve / 20), len(x))


def tail(n, want, rate_db, hold, seed):
    """尾音：一段染成 want 这种音色的噪声，像回声一样拖在枪响后面。先稳住 hold 秒，再按每秒 rate_db 分贝落下去，
    越高的频率落得越快（越往后越闷）。开头的响度是 1。"""
    t = np.arange(n) / RATE
    W = np.fft.rfft(np.random.default_rng(seed).standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / RATE)
    out, tot = np.zeros(n), 0.0
    for b in range(len(BANDS) - 1):
        nb = np.fft.irfft(np.where((f >= BANDS[b]) & (f < BANDS[b + 1]), W, 0), n)
        amp = 10 ** (want[b] / 20)
        k = float(np.clip(1 + 0.45 * np.log2(np.sqrt(BANDS[b] * BANDS[b + 1]) / 630), 0.6, 2.2))
        out += nb / np.sqrt(np.mean(nb ** 2)) * amp * 10 ** (-rate_db * k * np.maximum(t - hold, 0) / 20)
        tot += amp * amp
    return out / np.sqrt(tot) * np.clip((t - 0.0015) / 0.004, 0, 1)  # 和录音的起点对齐（录音前面留了 1.5 毫秒），几毫秒内起来


def boom_layer(n, boom):
    """低频冲击：音高快速下落的一声闷响（戴耳机时胸口那一下；小喇叭放不出来，所以只是垫一点）。"""
    t = np.arange(n) / RATE
    f0, f1, ft, dec = boom
    ph = 2 * np.pi * np.cumsum(f1 + (f0 - f1) * np.exp(-t / ft)) / RATE
    low = np.sin(ph) * np.where(t < 0.0012, t / 0.0012, np.exp(-(t - 0.0012) / dec))
    return np.concatenate([np.zeros(int(RATE * 0.0015)), low])[:n]


def env_db(x, at):
    """枪响后 at 秒附近 10 毫秒的响度，相对最响的那 10 毫秒（dB）。"""
    h = int(RATE * 0.01)
    e = np.array([np.sqrt(np.mean(x[i:i + h] ** 2)) for i in range(0, len(x) - h, h)])
    i = min(len(e) - 1, int(at / 0.01))
    return 20 * np.log10(e[i] / e.max() + 1e-9)


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
    x = highpass(x)[:int(length * RATE)]
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
    for key, (rel, picks, length, pitch, target, most, like, tl, boom, boom_mix) in CLIPS.items():
        if rel not in cache:
            cache[rel] = read_wav(os.path.join(src, rel + '.wav'))
        a = cache[rel]
        shots = find_shots(a)
        want = LIKE[like]
        at, loud = [], []
        for p in picks:
            x = match(cut(a, shots[p], length, pitch), want)
            x = x / np.abs(x).max()
            h = int(RATE * 0.01)
            e0 = max(np.sqrt(np.mean(x[i:i + h] ** 2)) for i in range(0, int(RATE * 0.05), h // 2))  # 开头最响的那 10 毫秒
            x = x + e0 * 10 ** (tl[0] / 20) * tail(len(x), want, tl[1], tl[2], 7 + p) + boom_mix * boom_layer(len(x), boom)
            y, r, d = shape(x, target, most)
            y[-int(RATE * 0.03):] *= np.linspace(1, 0, int(RATE * 0.03))  # 尾音一直拖到最后：结尾收一下，免得「咔」一声
            pos = sum(len(s) for s in pack)
            pack += [y, gap]
            at.append([pos, len(y)])
            loud.append(r)
            sp = spectrum(y)
            print(f'{key:8s} 第 {p + 1}/{len(shots)} 声 {len(y) / RATE:.2f}s  压 {d:.2f}  响度 {r:.3f}/{target}'
                  f'  响完后 0.05/0.1/0.2/0.3/0.5 秒：{" ".join(f"{env_db(y, t):.0f}" for t in (0.05, 0.1, 0.2, 0.3, 0.5))} dB'
                  f'  音色差 {" ".join(f"{v:+.0f}" for v in sp - np.array(want))}')
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
