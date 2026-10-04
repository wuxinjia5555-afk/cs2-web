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
#   → 轻微压一下让声音更「实」，并把响度对齐到原来合成枪声的水平（这样各把枪的音量设置不用改）
import os
import struct
import sys

import numpy as np

RATE = 32000
SRC_RATE = 96000
PEAK = 0.85  # 峰值留一点余量：浏览器把 32kHz 换算成 48kHz 时波形会冒出去一点
# 游戏里的音色名: (录音文件, 用里面的第几声, 长度（秒）, 变调（小于 1 更低沉）, 前 0.2 秒的目标响度, 最多压到多大力度)
CLIPS = {
    'ak47': ('AK-47/C_28P', [1, 2], 0.72, 1.0, 0.243, 3.0),
    'm4a4': ('AR-15/D_32P', [0, 1], 0.62, 1.0, 0.166, 3.0),
    'rifle': ('SKS/U_14P', [0, 1], 0.65, 1.0, 0.205, 3.0),             # 加利尔、法玛斯
    'pistol': ('Walther PPQ/X_39P', [1, 2], 0.45, 1.0, 0.131, 3.0),    # Glock、P250
    'deagle': ('1911/A_42P', [0, 1], 0.8, 0.9, 0.258, 3.0),
    'smg': ('PPSh/P_30P', [0, 2], 0.4, 1.0, 0.117, 3.0),               # MAC-10、MP9
    'ump45': ('Carl Gustav M45/G_31P', [0, 1], 0.45, 0.94, 0.165, 3.0),
    'shotgun': ('Nova/O_21P', [0, 1], 0.95, 1.0, 0.342, 4.0),
    'awp': ('Mosin Nagant/M_21P', [0, 1], 1.35, 0.93, 0.293, 4.0),
    'ssg08': ('Tikka/W_29P', [0, 1], 1.0, 1.0, 0.232, 3.0),
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
    for key, (rel, picks, length, pitch, target, most) in CLIPS.items():
        if rel not in cache:
            cache[rel] = read_wav(os.path.join(src, rel + '.wav'))
        a = cache[rel]
        shots = find_shots(a)
        at, loud = [], []
        for p in picks:
            y, r, d = shape(cut(a, shots[p], length, pitch), target, most)
            pos = sum(len(s) for s in pack)
            pack += [y, gap]
            at.append([pos, len(y)])
            loud.append(r)
            print(f'{key:8s} {rel:24s} 第 {p + 1}/{len(shots)} 声  {len(y) / RATE:.2f}s  压 {d:.2f}  响度 {r:.3f}（目标 {target}）')
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
